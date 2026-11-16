import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type AddOn, type LayerFault, type LayerFinding, type LayerParse, type Layered, LAYER_CODES, LAYER_LEVELS, checkLayers, isLayerName, readLayer } from "./layers.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** The context of the sample core: the `id` of each record of the core. */
interface Core {
  readonly ids: readonly string[];
}

/** The layer of the sample add-on `cost/1`: a price for each record of the core. */
interface Cost {
  readonly prices: Readonly<Record<string, number>>;
}

/** A sample add-on. It counts its calls, so a test can tell that a function did not start. */
interface Counted extends AddOn<Cost, Core> {
  calls: { parse: number; check: number };
}

function costAddOn(schema = "cost/1"): Counted {
  const calls = { parse: 0, check: 0 };
  return {
    schema,
    calls,
    parse(value: unknown): LayerParse<Cost> {
      calls.parse += 1;
      if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, errors: ["A cost layer is a record."] };
      const prices = (value as { prices?: unknown }).prices;
      if (typeof prices !== "object" || prices === null) return { ok: false, errors: ["The field `prices` is not a record.", "A cost layer needs the field `prices`."] };
      return { ok: true, layer: { prices: prices as Record<string, number> } };
    },
    check(layer: Cost, core: Core): readonly LayerFault[] {
      calls.check += 1;
      const faults: LayerFault[] = [];
      for (const [id, price] of Object.entries(layer.prices)) {
        if (!core.ids.includes(id)) faults.push({ level: "error", code: "price-record", at: id, message: `The price of "${id}" names no record of the core.` });
        if (price < 0) faults.push({ level: "warning", code: "price-negative", at: id, message: `The price of "${id}" is ${String(price)}.`, other: "zero" });
      }
      return faults;
    },
  };
}

/** A second sample add-on with a different layer type. It gives one fault with the context that it got. */
function noteAddOn(seen: unknown[]): AddOn<string, Core> {
  return {
    schema: "note/2",
    parse: (value) => (typeof value === "string" ? { ok: true, layer: value } : { ok: false, errors: ["A note layer is a text."] }),
    check: (layer, core) => {
      seen.push(core);
      return [{ level: "warning", code: "note", at: "", message: layer }];
    },
  };
}

const CORE: Core = { ids: ["a", "b"] };

describe("the layers of a document", () => {
  it("[LAYERS.NAME] a name is a word, a slash and a version", () => {
    for (const name of ["spend/1", "electrical/12", "a/0", "two-words/3", "x9-y/10"]) expect(isLayerName(name), name).toBe(true);
    for (const name of ["", "spend", "spend/", "/1", "Spend/1", "spend/v1", "spend/1.0", "spend/-1", "9a/1", "-a/1", "a_b/1", "a:b/1", "a b/1", "spend/1 ", " spend/1", "spend/1\n", "a/1/2", "__proto__"]) {
      expect(isLayerName(name), JSON.stringify(name)).toBe(false);
    }
  });

  it("[LAYERS.NAME] a layer with a bad name gets one error, and no add-on reads it", () => {
    const bad = costAddOn("Cost");
    const findings = checkLayers({ layers: { Cost: { prices: {} } } }, [bad], CORE);
    expect(findings).toEqual([{ level: "error", code: "layer-name", layer: "Cost", at: "", message: 'The layer "Cost" has a name that is not a word, a slash and a version, for example "spend/1".' }]);
    expect(bad.calls).toEqual({ parse: 0, check: 0 });
  });

  it("[LAYERS.UNKNOWN] a layer of no add-on of the list gets a warning, and the document keeps the layer", () => {
    const doc: Layered = Object.freeze({ layers: Object.freeze({ "light/1": Object.freeze({ lamps: 2 }) }) });
    const findings = checkLayers(doc, [costAddOn()], CORE);
    expect(findings).toEqual([{ level: "warning", code: "layer-unknown", layer: "light/1", at: "", message: 'The document has the layer "light/1", and no add-on of the check reads it. The document keeps the layer.' }]);
    expect(doc).toEqual({ layers: { "light/1": { lamps: 2 } } });
    expect(checkLayers(doc, [], CORE)).toEqual(findings);
  });

  it("[LAYERS.FORM] a layer that its add-on cannot read gets one error for each fault of its form, and no check", () => {
    const cost = costAddOn();
    const findings = checkLayers({ layers: { "cost/1": { prices: 4 } } }, [cost], CORE);
    expect(findings).toEqual([
      { level: "error", code: "layer-form", layer: "cost/1", at: "", message: "The field `prices` is not a record." },
      { level: "error", code: "layer-form", layer: "cost/1", at: "", message: "A cost layer needs the field `prices`." },
    ]);
    expect(cost.calls).toEqual({ parse: 1, check: 0 });
  });

  it("[LAYERS.CHECK] the faults of the meaning come from the add-on, with the name of the layer and in the order of the add-on", () => {
    const cost = costAddOn();
    const findings = checkLayers({ layers: { "cost/1": { prices: { z: -1, a: 3, c: 2 } } } }, [cost], CORE);
    expect(findings).toEqual([
      { level: "error", code: "price-record", layer: "cost/1", at: "z", message: 'The price of "z" names no record of the core.' },
      { level: "warning", code: "price-negative", layer: "cost/1", at: "z", message: 'The price of "z" is -1.', other: "zero" },
      { level: "error", code: "price-record", layer: "cost/1", at: "c", message: 'The price of "c" names no record of the core.' },
    ]);
    expect(cost.calls).toEqual({ parse: 1, check: 1 });
  });

  it("[LAYERS.CHECK] each add-on gets the context of the caller, and add-ons with different layer types are one list", () => {
    const seen: unknown[] = [];
    const addOns: readonly AddOn<unknown, Core>[] = [costAddOn(), noteAddOn(seen)];
    const findings = checkLayers({ layers: { "note/2": "Read the meter.", "cost/1": { prices: { a: 1 } } } }, addOns, CORE);
    expect(findings).toEqual([{ level: "warning", code: "note", layer: "note/2", at: "", message: "Read the meter." }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(CORE);
  });

  it("[LAYERS.ORDER] the findings are in the order of the layer names, for each order of the fields and of the add-ons", () => {
    const layers = { "note/2": "n", "cost/1": { prices: { q: 1 } }, "light/1": {}, Bad: 1 };
    const turned = { Bad: 1, "light/1": {}, "cost/1": { prices: { q: 1 } }, "note/2": "n" };
    const first = checkLayers({ layers }, [costAddOn(), noteAddOn([])], CORE);
    const second = checkLayers({ layers: turned }, [noteAddOn([]), costAddOn()], CORE);
    expect(first.map((finding: LayerFinding) => `${finding.layer} ${finding.code}`)).toEqual(["Bad layer-name", "cost/1 price-record", "light/1 layer-unknown", "note/2 note"]);
    expect(second).toEqual(first);
  });

  it("[LAYERS.FIRST] the first add-on of a name reads the layer", () => {
    const first = costAddOn();
    const second = costAddOn();
    checkLayers({ layers: { "cost/1": { prices: {} } } }, [first, second], CORE);
    expect(first.calls).toEqual({ parse: 1, check: 1 });
    expect(second.calls).toEqual({ parse: 0, check: 0 });
  });

  it("[LAYERS.NONE] a document with no layers has no finding and no layer", () => {
    const cost = costAddOn();
    expect(checkLayers({}, [cost], CORE)).toEqual([]);
    expect(checkLayers({ layers: undefined }, [cost], CORE)).toEqual([]);
    expect(checkLayers({ layers: {} }, [cost], CORE)).toEqual([]);
    expect(readLayer({}, cost)).toBeUndefined();
    expect(readLayer({ layers: {} }, cost)).toBeUndefined();
    expect(cost.calls).toEqual({ parse: 0, check: 0 });
  });

  it("[LAYERS.READ] readLayer gives the read of the layer of one add-on, and it reads only an own field", () => {
    const cost = costAddOn();
    expect(readLayer({ layers: { "cost/1": { prices: { a: 2 } } } }, cost)).toEqual({ ok: true, layer: { prices: { a: 2 } } });
    expect(readLayer({ layers: { "cost/1": null } }, cost)).toEqual({ ok: false, errors: ["A cost layer is a record."] });
    // A layer with the value `undefined` is a layer: the add-on reads it and tells its form.
    expect(readLayer({ layers: { "cost/1": undefined } }, cost)).toEqual({ ok: false, errors: ["A cost layer is a record."] });
    const inherited = Object.create({ "cost/1": { prices: {} } }) as Record<string, unknown>;
    expect(readLayer({ layers: inherited }, cost)).toBeUndefined();
    expect(readLayer({ layers: {} }, { schema: "constructor", parse: () => ({ ok: true, layer: 1 }) })).toBeUndefined();
    expect(checkLayers({ layers: inherited }, [cost], CORE)).toEqual([]);
  });

  it("[LAYERS.CODES] the codes and the levels are lists, so a host can show each one", () => {
    expect(LAYER_CODES).toEqual(["layer-name", "layer-unknown", "layer-form"]);
    expect(LAYER_LEVELS).toEqual(["error", "warning"]);
  });

  it("[LAYERS.ALONE] the module of the entry imports nothing", () => {
    const source = readFileSync(join(here, "layers.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/\bfrom\s+["']/);
    expect(code).not.toMatch(/\brequire\s*\(/);
  });
});
