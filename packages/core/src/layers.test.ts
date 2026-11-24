import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type AddOn,
  type JoinFinding,
  type LayerFault,
  type LayerFinding,
  type LayerFragment,
  type LayerJoiner,
  type LayerParse,
  type LayerPiece,
  type Layered,
  type LayersJoin,
  JOIN_CODES,
  LAYER_CODES,
  LAYER_LEVELS,
  checkLayers,
  isLayerName,
  joinLayers,
  joinRecords,
  joinSetting,
  readLayer,
} from "./layers.ts";

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

/** The sample add-on `cost/1` with its join. One value is the add-on and the join. */
interface CostJoiner {
  readonly joiner: AddOn<Cost, Core> & LayerJoiner<Cost>;
  /** The counts of the calls of `parse` and `check`. */
  readonly calls: { parse: number; check: number };
  /** The pieces of each call of `join`. */
  readonly joins: (readonly LayerPiece<Cost>[])[];
}

/** This function makes the sample join. It refuses a record with a price in two fragments. */
function costJoiner(schema = "cost/1"): CostJoiner {
  const addOn = costAddOn(schema);
  const joins: (readonly LayerPiece<Cost>[])[] = [];
  const joiner: AddOn<Cost, Core> & LayerJoiner<Cost> = {
    schema,
    parse: (value) => addOn.parse(value),
    check: (layer, core) => addOn.check(layer, core),
    join(pieces) {
      joins.push(pieces);
      const prices = new Map<string, number>();
      const owner = new Map<string, string>();
      const errors: string[] = [];
      for (const piece of pieces) {
        for (const [id, price] of Object.entries(piece.layer.prices)) {
          const before = owner.get(id);
          if (before === undefined) {
            owner.set(id, piece.from);
            prices.set(id, price);
          } else errors.push(`The fragments "${before}" and "${piece.from}" each have a price of "${id}".`);
        }
      }
      return errors.length === 0 ? { ok: true, layer: { prices: Object.fromEntries(prices) } } : { ok: false, errors };
    },
  };
  return { joiner, calls: addOn.calls, joins };
}

/** A second sample join with a different layer type: the notes of the fragments, one on each line. */
function noteJoiner(): LayerJoiner<string> {
  return {
    schema: "note/2",
    parse: (value) => (typeof value === "string" ? { ok: true, layer: value } : { ok: false, errors: ["A note layer is a text."] }),
    join: (pieces) => ({ ok: true, layer: pieces.map((piece) => piece.layer).join("\n") }),
  };
}

function fragment(name: string, layers?: Readonly<Record<string, unknown>>): LayerFragment {
  return { name, doc: layers === undefined ? {} : { layers } };
}

/** This function gives the layers of a join that has no finding. */
function layersOf(join: LayersJoin): Readonly<Record<string, unknown>> {
  if (!join.ok) throw new Error(`The join has findings: ${JSON.stringify(join.findings)}`);
  return join.layers;
}

/** This function gives the findings of a join that has no layers. */
function findingsOf(join: LayersJoin): readonly JoinFinding[] {
  if (join.ok) throw new Error(`The join has no finding: ${JSON.stringify(join.layers)}`);
  return join.findings;
}

/** This function gives a record with the fields of a record in the reverse order. */
function turned(layers: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(layers).reverse());
}

describe("the join of the layers of fragments", () => {
  it("[LAYERS.JOIN-ONE] a layer of one fragment stays as it is, and no add-on reads it", () => {
    const cost = costJoiner();
    const light = Object.freeze({ lamps: 2 });
    const unread = Object.freeze({ prices: 4 });
    const join = joinLayers([fragment("a", { "light/1": light }), fragment("b", { "cost/1": unread, Bad: 1 }), fragment("c")], [cost.joiner]);
    expect(join).toEqual({ ok: true, layers: { Bad: 1, "cost/1": { prices: 4 }, "light/1": { lamps: 2 } } });
    expect(layersOf(join)["light/1"]).toBe(light);
    expect(layersOf(join)["cost/1"]).toBe(unread);
    expect(cost.calls).toEqual({ parse: 0, check: 0 });
    expect(cost.joins).toEqual([]);
  });

  it("[LAYERS.JOIN-MANY] a layer of two or more fragments goes to the join of the first add-on of its name, in the order of the fragments", () => {
    const first = costJoiner();
    const second = costJoiner();
    const join = joinLayers(
      [fragment("b.json", { "cost/1": { prices: { y: 2 } } }), fragment("none.json"), fragment("a.json", { "cost/1": { prices: { x: 1 } } }), fragment("c.json", { "cost/1": { prices: { z: 3 } } })],
      [first.joiner, second.joiner],
    );
    expect(JSON.stringify(join)).toBe('{"ok":true,"layers":{"cost/1":{"prices":{"y":2,"x":1,"z":3}}}}');
    expect(first.joins).toEqual([
      [
        { from: "b.json", layer: { prices: { y: 2 } } },
        { from: "a.json", layer: { prices: { x: 1 } } },
        { from: "c.json", layer: { prices: { z: 3 } } },
      ],
    ]);
    expect(first.calls).toEqual({ parse: 3, check: 0 });
    expect(second.joins).toEqual([]);
    expect(second.calls).toEqual({ parse: 0, check: 0 });
    // `join` gets the layer that `parse` gave, not the value of the fragment.
    const trimmed: LayerJoiner<string> = { ...noteJoiner(), parse: (value) => (typeof value === "string" ? { ok: true, layer: value.trim() } : { ok: false, errors: ["A note layer is a text."] }) };
    expect(joinLayers([fragment("a", { "note/2": " one " }), fragment("b", { "note/2": "two  " })], [trimmed])).toEqual({ ok: true, layers: { "note/2": "one\ntwo" } });
  });

  it("[LAYERS.JOIN-TWICE] a layer of two or more fragments with no add-on gets one error, and the function joins no records itself", () => {
    // The three values are equal. The function still does not select one: only an add-on knows the meaning of a layer.
    const join = joinLayers([fragment("a", { "light/1": { lamps: 1 } }), fragment("b", { "light/1": { lamps: 1 } }), fragment("c", { "light/1": { lamps: 1 } })], [costJoiner().joiner]);
    expect(join).toEqual({
      ok: false,
      findings: [{ level: "error", code: "layer-twice", layer: "light/1", at: "", from: ["a", "b", "c"], message: 'The fragments "a", "b", "c" each have the layer "light/1", and no add-on of the join joins it.' }],
    });
  });

  it("[LAYERS.JOIN-NAME] a layer of two or more fragments with a bad name gets one error, and no add-on reads it", () => {
    const bad = costJoiner("Cost");
    const join = joinLayers([fragment("a", { Cost: { prices: { x: 1 } } }), fragment("b", { Cost: { prices: { y: 2 } } })], [bad.joiner]);
    expect(join).toEqual({
      ok: false,
      findings: [{ level: "error", code: "layer-name", layer: "Cost", at: "", from: ["a", "b"], message: 'The layer "Cost" has a name that is not a word, a slash and a version, for example "spend/1".' }],
    });
    expect(bad.calls).toEqual({ parse: 0, check: 0 });
    expect(bad.joins).toEqual([]);
    // The message is the message of `checkLayers` for the same name.
    expect(findingsOf(join)[0]?.message).toBe(checkLayers({ layers: { Cost: 1 } }, [], CORE)[0]?.message);
  });

  it("[LAYERS.JOIN-FORM] a layer that its add-on cannot read gets one error for each fault of its form, with its fragment, and no join", () => {
    const cost = costJoiner();
    const join = joinLayers([fragment("a", { "cost/1": { prices: { x: 1 } } }), fragment("b", { "cost/1": { prices: 4 } }), fragment("c", { "cost/1": null })], [cost.joiner]);
    expect(join).toEqual({
      ok: false,
      findings: [
        { level: "error", code: "layer-form", layer: "cost/1", at: "", from: ["b"], message: "The field `prices` is not a record." },
        { level: "error", code: "layer-form", layer: "cost/1", at: "", from: ["b"], message: "A cost layer needs the field `prices`." },
        { level: "error", code: "layer-form", layer: "cost/1", at: "", from: ["c"], message: "A cost layer is a record." },
      ],
    });
    expect(cost.calls).toEqual({ parse: 3, check: 0 });
    expect(cost.joins).toEqual([]);
  });

  it("[LAYERS.JOIN-FAULT] each fault of the join of an add-on is one error, with the fragments of the layer", () => {
    const join = joinLayers(
      [fragment("a", { "cost/1": { prices: { x: 1, y: 1 } } }), fragment("other", { "note/2": "n" }), fragment("b", { "cost/1": { prices: { y: 2 } } }), fragment("c", { "cost/1": { prices: { x: 3 } } })],
      [costJoiner().joiner],
    );
    expect(join).toEqual({
      ok: false,
      findings: [
        { level: "error", code: "layer-join", layer: "cost/1", at: "", from: ["a", "b", "c"], message: 'The fragments "a" and "b" each have a price of "y".' },
        { level: "error", code: "layer-join", layer: "cost/1", at: "", from: ["a", "b", "c"], message: 'The fragments "a" and "c" each have a price of "x".' },
      ],
    });
  });

  it("[LAYERS.JOIN-ALL] a join with a finding gives no layers", () => {
    const join = joinLayers([fragment("a", { "cost/1": { prices: { x: 1 } }, "note/2": "one" }), fragment("b", { "cost/1": { prices: { x: 2 } }, "light/1": {} })], [costJoiner().joiner]);
    expect(findingsOf(join).map((finding) => finding.code)).toEqual(["layer-join"]);
    expect(join).not.toHaveProperty("layers");
  });

  it("[LAYERS.JOIN-ORDER] the layers and the findings are in the order of the layer names, for each order of the fields and of the add-ons", () => {
    const a = { "note/2": "one", "cost/1": { prices: { x: 1 } }, "light/1": { lamps: 1 }, Bad: 1 };
    const b = { "cost/1": { prices: { y: 2 } }, "note/2": "two", "zone/1": [] };
    const first = joinLayers([fragment("a", a), fragment("b", b)], [costJoiner().joiner, noteJoiner()]);
    const second = joinLayers([fragment("a", turned(a)), fragment("b", turned(b))], [noteJoiner(), costJoiner().joiner]);
    expect(JSON.stringify(first)).toBe('{"ok":true,"layers":{"Bad":1,"cost/1":{"prices":{"x":1,"y":2}},"light/1":{"lamps":1},"note/2":"one\\ntwo","zone/1":[]}}');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    const c = { "note/2": 5, "light/1": {}, "cost/1": { prices: { x: 9 } } };
    const faulty = joinLayers([fragment("a", a), fragment("c", c)], [costJoiner().joiner, noteJoiner()]);
    expect(findingsOf(faulty).map((finding: LayerFinding) => `${finding.layer} ${finding.code}`)).toEqual(["cost/1 layer-join", "light/1 layer-twice", "note/2 layer-form"]);
    expect(joinLayers([fragment("a", turned(a)), fragment("c", turned(c))], [noteJoiner(), costJoiner().joiner])).toEqual(faulty);
  });

  it("[LAYERS.JOIN-OWN] the join reads only an own field of layers, and a layer with the name __proto__ stays a field", () => {
    const inherited = Object.create({ "cost/1": { prices: { x: 1 } } }) as Record<string, unknown>;
    const proto = JSON.parse('{ "__proto__": { "polluted": true }, "cost/1": { "prices": { "y": 2 } } }') as Record<string, unknown>;
    const cost = costJoiner();
    const layers = layersOf(joinLayers([fragment("a", inherited), fragment("b", proto)], [cost.joiner]));
    expect(Object.keys(layers)).toEqual(["__proto__", "cost/1"]);
    expect(Object.hasOwn(layers, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(layers)).toBe(Object.prototype);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    // Only the fragment "b" has the layer as an own field, so no join starts.
    expect(layers["cost/1"]).toBe(proto["cost/1"]);
    expect(cost.joins).toEqual([]);
    const twice = joinLayers([fragment("b", proto), fragment("c", proto)], []);
    expect(findingsOf(twice).map((finding) => `${finding.layer} ${finding.code}`)).toEqual(["__proto__ layer-name", "cost/1 layer-twice"]);
  });

  it("[LAYERS.JOIN-PURE] the join does not change a fragment, and no fragment gives no layer", () => {
    const frozen = (name: string, prices: Record<string, number>): LayerFragment =>
      Object.freeze({ name, doc: Object.freeze({ layers: Object.freeze({ "cost/1": Object.freeze({ prices: Object.freeze(prices) }), "note/2": name }) }) });
    const fragments = Object.freeze([frozen("a", { x: 1 }), frozen("b", { y: 2 })]);
    const before = JSON.stringify(fragments);
    expect(layersOf(joinLayers(fragments, [costJoiner().joiner, noteJoiner()]))).toEqual({ "cost/1": { prices: { x: 1, y: 2 } }, "note/2": "a\nb" });
    expect(JSON.stringify(fragments)).toBe(before);
    expect(joinLayers([], [costJoiner().joiner])).toEqual({ ok: true, layers: {} });
    expect(joinLayers([fragment("a"), { name: "b", doc: { layers: undefined } }, fragment("c", {})], [])).toEqual({ ok: true, layers: {} });
  });

  it("[LAYERS.JOIN-CHECK] checkLayers examines the joined layers, with the same value as the add-on and the join", () => {
    const cost = costJoiner();
    const join = joinLayers([fragment("a", { "cost/1": { prices: { a: 1 } } }), fragment("b", { "cost/1": { prices: { q: -2 } }, "light/1": {} })], [cost.joiner]);
    const findings = checkLayers({ layers: layersOf(join) }, [cost.joiner], CORE);
    expect(findings.map((finding) => `${finding.layer} ${finding.code} ${finding.at}`)).toEqual(["cost/1 price-record q", "cost/1 price-negative q", "light/1 layer-unknown "]);
    // `parse` reads the joined layer: 2 reads for the join, and 1 read for the check.
    expect(cost.calls).toEqual({ parse: 3, check: 1 });
  });

  it("[LAYERS.JOIN-CODES] the codes of the join are a list, so a host can show each one", () => {
    expect(JOIN_CODES).toEqual(["layer-name", "layer-twice", "layer-form", "layer-join"]);
    const a = { Bad: 1, "light/1": 1, "cost/1": { prices: { x: 1 } }, "note/2": 1 };
    const b = { Bad: 2, "light/1": 2, "cost/1": { prices: { x: 2 } }, "note/2": "n" };
    const findings = findingsOf(joinLayers([fragment("a", a), fragment("b", b)], [noteJoiner(), costJoiner().joiner]));
    // One join gives each code, and each finding is an error.
    expect(findings.map((finding) => finding.code)).toEqual(["layer-name", "layer-join", "layer-twice", "layer-form"]);
    expect([...new Set(findings.map((finding) => finding.code))].sort()).toEqual([...JOIN_CODES].sort());
    for (const finding of findings) expect(finding.level).toBe("error");
  });
});

/** A sample layer for the tools of a join: one setting, and a list of records with an `id`. */
interface Stock {
  readonly unit?: string | undefined;
  readonly days?: number | undefined;
  readonly items?: readonly StockItem[] | undefined;
}

interface StockItem {
  readonly id: string;
  readonly count: number;
}

function piece(from: string, layer: Stock): LayerPiece<Stock> {
  return { from, layer };
}

function stockItems(layer: Stock): readonly StockItem[] | undefined {
  return layer.items;
}

function stockId(item: StockItem): string {
  return item.id;
}

function stockUnit(layer: Stock): string | undefined {
  return layer.unit;
}

describe("the tools of the join of an add-on", () => {
  it("[LAYERS.RECORDS] joinRecords gives the records in the order of the pieces, and each piece keeps its order", () => {
    const a = piece("a", { items: [{ id: "z", count: 1 }, { id: "b", count: 2 }] });
    const c = piece("c", { items: [{ id: "a", count: 3 }] });
    const before = JSON.stringify([a, c]);
    // The piece "b" has no list.
    const join = joinRecords([a, piece("b", {}), c], stockItems, stockId, "item");
    expect(join).toEqual({ items: [{ id: "z", count: 1 }, { id: "b", count: 2 }, { id: "a", count: 3 }], twice: [], errors: [] });
    // The items are the records of the pieces, and the function does not change a piece.
    expect(join.items[0]).toBe(a.layer.items?.[0]);
    expect(JSON.stringify([a, c])).toBe(before);
    expect(joinRecords([], stockItems, stockId, "item")).toEqual({ items: [], twice: [], errors: [] });
  });

  it("[LAYERS.RECORDS-TWICE] a key that two or more fragments have is one fault, also when the records are equal", () => {
    const a = piece("a", { items: [{ id: "z", count: 1 }, { id: "b", count: 1 }] });
    const b = piece("b", { items: [{ id: "b", count: 1 }, { id: "k", count: 9 }] });
    // The fragment "c" has the key "b" two times. Its name comes one time.
    const c = piece("c", { items: [{ id: "z", count: 2 }, { id: "b", count: 3 }, { id: "b", count: 4 }] });
    const join = joinRecords([a, b, c], stockItems, stockId, "item");
    expect(join.items.map((item) => item.id)).toEqual(["z", "b", "b", "k", "z", "b", "b"]);
    // The keys are in the order of the first record of each key, not in the order of the texts.
    expect(join.twice).toEqual([
      { key: "z", from: ["a", "c"], message: 'The fragments "a", "c" each have the item "z".' },
      { key: "b", from: ["a", "b", "c"], message: 'The fragments "a", "b", "c" each have the item "b".' },
    ]);
    // The messages are the faults for the result of the join of an add-on.
    expect(join.errors).toEqual(['The fragments "a", "c" each have the item "z".', 'The fragments "a", "b", "c" each have the item "b".']);
  });

  it("[LAYERS.RECORDS-ONE] a key that one fragment has two times is no fault of the join, and two fragments with one name are two fragments", () => {
    const twice = piece("a", { items: [{ id: "x", count: 1 }, { id: "x", count: 2 }, { id: "__proto__", count: 3 }, { id: "constructor", count: 4 }] });
    const join = joinRecords([twice, piece("b", { items: [{ id: "y", count: 5 }] })], stockItems, stockId, "item");
    expect(join.items.map((item) => item.count)).toEqual([1, 2, 3, 4, 5]);
    expect(join.twice).toEqual([]);
    expect(join.errors).toEqual([]);
    // The function counts the fragments by their position.
    const same = joinRecords([piece("a", { items: [{ id: "x", count: 1 }] }), piece("a", { items: [{ id: "x", count: 1 }] })], stockItems, stockId, "item");
    expect(same.twice).toEqual([{ key: "x", from: ["a", "a"], message: 'The fragments "a", "a" each have the item "x".' }]);
  });

  it("[LAYERS.RECORDS-EQUAL] with the option equal, a record equal to the first record of its key joins it, and a different record is a fault", () => {
    const same = (first: StockItem, other: StockItem): boolean => first.count === other.count;
    const a = piece("a", { items: [{ id: "x", count: 1 }, { id: "y", count: 2 }] });
    // The fragment "b" repeats "x" after its first record. The repeat stays for `check` of the add-on.
    const b = piece("b", { items: [{ id: "x", count: 1 }, { id: "x", count: 7 }, { id: "z", count: 3 }] });
    const c = piece("c", { items: [{ id: "y", count: 2 }] });
    const join = joinRecords([a, b, c], stockItems, stockId, "item", { equal: same });
    expect(join).toEqual({ items: [{ id: "x", count: 1 }, { id: "y", count: 2 }, { id: "x", count: 7 }, { id: "z", count: 3 }], twice: [], errors: [] });
    // Each fragment with a different first record is in the fault, in the order of the fragments.
    const d = piece("d", { items: [{ id: "y", count: 5 }] });
    const e = piece("e", { items: [{ id: "y", count: 6 }, { id: "x", count: 1 }] });
    const faults = joinRecords([a, c, d, e], stockItems, stockId, "item", { equal: same });
    expect(faults.twice).toEqual([{ key: "y", from: ["a", "d", "e"], message: 'The fragments "a", "d", "e" each have the item "y", and the records are not equal.' }]);
    expect(faults.errors).toEqual([faults.twice[0]?.message]);
    // With no option, equal records of two fragments are a fault.
    expect(joinRecords([a, c], stockItems, stockId, "item").errors).toEqual(['The fragments "a", "c" each have the item "y".']);
  });

  it("[LAYERS.RECORDS-TEXT] with the options equal and text, the message gives the first record of the key in each fragment of the fault", () => {
    const same = (first: StockItem, other: StockItem): boolean => first.count === other.count;
    const text = (item: StockItem): string => JSON.stringify(item);
    const a = piece("a", { items: [{ id: "y", count: 2 }] });
    const c = piece("c", { items: [{ id: "y", count: 2 }] });
    // The fragment "d" has a later record of "y". Only its first record is in the message.
    const d = piece("d", { items: [{ id: "y", count: 5 }, { id: "y", count: 8 }] });
    const e = piece("e", { items: [{ id: "y", count: 6 }] });
    const join = joinRecords([a, c, d, e], stockItems, stockId, "item", { equal: same, text });
    const message = 'The fragments "a", "d", "e" each have the item "y", and the records are not equal.\n  "a": {"id":"y","count":2}\n  "d": {"id":"y","count":5}\n  "e": {"id":"y","count":6}';
    expect(join.twice).toEqual([{ key: "y", from: ["a", "d", "e"], message }]);
    expect(join.errors).toEqual([message]);
    // The option changes only the message. The records are the records with no text.
    expect(join.items).toEqual(joinRecords([a, c, d, e], stockItems, stockId, "item", { equal: same }).items);
    // With equal records, the join calls no text and gives no fault.
    const calls: StockItem[] = [];
    const quiet = joinRecords([a, c], stockItems, stockId, "item", { equal: same, text: (item) => (calls.push(item), text(item)) });
    expect(quiet.errors).toEqual([]);
    expect(calls).toEqual([]);
    // With no equal, the option text changes nothing.
    expect(joinRecords([a, c], stockItems, stockId, "item", { text })).toEqual(joinRecords([a, c], stockItems, stockId, "item"));
  });

  it("[LAYERS.SETTING] joinSetting gives the value of the first piece that gives the setting", () => {
    const pieces = [piece("a", {}), piece("b", { unit: "kg" }), piece("c", { unit: "kg" }), piece("d", {})];
    expect(joinSetting(pieces, stockUnit, "unit")).toEqual({ value: "kg", errors: [] });
    // No piece gives the setting.
    const none = joinSetting([piece("a", {}), piece("b", {})], stockUnit, "unit");
    expect(none.value).toBeUndefined();
    expect(none.errors).toEqual([]);
    expect(joinSetting([], stockUnit, "unit")).toEqual({ value: undefined, errors: [] });
    // The values 0, false and the empty text are values.
    expect(joinSetting(pieces, () => 0, "count")).toEqual({ value: 0, errors: [] });
    expect(joinSetting(pieces, () => false, "flag")).toEqual({ value: false, errors: [] });
    expect(joinSetting(pieces, () => "", "unit")).toEqual({ value: "", errors: [] });
  });

  it("[LAYERS.SETTING-DIFF] each piece with a different value is one fault, with the two fragments and the two values", () => {
    // The piece "d" has the value of the first piece again, after a different value.
    const pieces = [piece("a", {}), piece("b", { unit: "kg", days: 30 }), piece("c", { unit: "g", days: 30 }), piece("d", { unit: "kg" }), piece("e", { unit: "lb", days: 60 })];
    expect(joinSetting(pieces, stockUnit, "unit")).toEqual({
      value: "kg",
      errors: ['The fragment "b" has the unit "kg", and the fragment "c" has "g".', 'The fragment "b" has the unit "kg", and the fragment "e" has "lb".'],
    });
    expect(joinSetting(pieces, (layer) => layer.days, "count of days")).toEqual({ value: 30, errors: ['The fragment "b" has the count of days 30, and the fragment "e" has 60.'] });
  });

  it("[LAYERS.TOOLS] the messages of the tools are faults of the join of an add-on, and joinLayers gives each one", () => {
    const stock: LayerJoiner<Stock> = {
      schema: "stock/1",
      parse: (value) => ({ ok: true, layer: value as Stock }),
      join(pieces) {
        const unit = joinSetting(pieces, stockUnit, "unit");
        const items = joinRecords(pieces, stockItems, stockId, "item");
        const errors = [...unit.errors, ...items.errors];
        return errors.length === 0 ? { ok: true, layer: { unit: unit.value, items: items.items } } : { ok: false, errors };
      },
    };
    const a = fragment("a", { "stock/1": { unit: "kg", items: [{ id: "x", count: 1 }] } });
    const b = fragment("b", { "stock/1": { items: [{ id: "y", count: 2 }] } });
    expect(joinLayers([a, b], [stock])).toEqual({ ok: true, layers: { "stock/1": { unit: "kg", items: [{ id: "x", count: 1 }, { id: "y", count: 2 }] } } });
    const c = fragment("c", { "stock/1": { unit: "g", items: [{ id: "x", count: 5 }] } });
    expect(findingsOf(joinLayers([a, c], [stock]))).toEqual([
      { level: "error", code: "layer-join", layer: "stock/1", at: "", from: ["a", "c"], message: 'The fragment "a" has the unit "kg", and the fragment "c" has "g".' },
      { level: "error", code: "layer-join", layer: "stock/1", at: "", from: ["a", "c"], message: 'The fragments "a", "c" each have the item "x".' },
    ]);
  });
});
