import { describe, expect, it } from "vitest";
import { STD_CAPS, evaluate, makeContext, typed, walk, type Json, type World } from "@mark1russell7/coeval";
import { SITE_MACHINE } from "../glyphs/Explorer.tsx";
import { SITE_WORLD } from "../glyphs/View.tsx";
import { HOLE_CODE, editorOf, emptyDoc, isHole, kindsAt, namesAt, newHole } from "./contract.ts";
import { SITE_SYNTAX, docText, readText } from "./syntax.ts";

const evaluated = (doc: Json) => evaluate(SITE_MACHINE, doc, makeContext({}, STD_CAPS));

describe("the kind hole", () => {
  it("evaluates to an error value with its place", () => {
    const run = evaluated(typed("add", [2, newHole()]));
    expect(run.result.ok).toBe(false);
    if (run.result.ok) return;
    expect(run.result.error.code).toBe(HOLE_CODE);
    expect(run.result.error.place).toEqual([1]);
  });

  it("has a text, thus a document with a hole round-trips", () => {
    const doc = typed("if", { test: newHole(), then: typed("number", 1) });
    const printed = docText(doc);
    expect(printed).toMatchObject({ ok: true });
    if (!printed.ok) return;
    expect(readText(printed.text)).toEqual({ ok: true, doc });
  });

  it("tells a hole from another document", () => {
    expect(isHole(newHole())).toBe(true);
    expect(isHole(typed("number", 1))).toBe(false);
    expect(isHole(undefined)).toBe(false);
  });
});

describe("the editors from the contracts", () => {
  it("gives each kind of the site world a document that evaluates, from its contract alone", () => {
    const names = kindsAt(SITE_WORLD, newHole(), []);
    expect(names).toContain("if");
    expect(names).toContain("math.product");
    expect(names).toContain("tree.quote");
    expect(names).not.toContain("tree.named");
    expect(names).not.toContain("nearest");
    expect(names).not.toContain("hole");
    expect(names).not.toContain("kind");
    for (const name of names) {
      const doc = emptyDoc(SITE_WORLD, name);
      expect(() => evaluated(doc)).not.toThrow();
      expect(typeof editorOf(SITE_WORLD, name).form).toBe("string");
    }
  });

  it("gives each document of an editor a text that reads back to it, thus the text pane follows each edit (C17b)", () => {
    const bad: string[] = [];
    for (const name of kindsAt(SITE_WORLD, newHole(), [])) {
      const doc = emptyDoc(SITE_WORLD, name, SITE_SYNTAX);
      const printed = docText(doc);
      if (!printed.ok) bad.push(`${name}: ${printed.reason}`);
      else if (JSON.stringify(readText(printed.text)) !== JSON.stringify({ ok: true, doc })) bad.push(`${name}: ${printed.text}`);
    }
    expect(bad).toEqual([]);
  });

  it("gives an input for a data shape", () => {
    expect(editorOf(SITE_WORLD, "number")).toEqual({ form: "number", whole: false });
    expect(editorOf(SITE_WORLD, "text")).toEqual({ form: "text" });
    expect(editorOf(SITE_WORLD, "bool")).toEqual({ form: "one", values: [true, false] });
    expect(editorOf(SITE_WORLD, "ref")).toEqual({ form: "path" });
  });

  it("gives a record one editor for each field, and marks the required ones", () => {
    expect(editorOf(SITE_WORLD, "if")).toEqual({
      form: "record",
      fields: [
        { key: "test", required: true },
        { key: "then", required: true },
        { key: "else", required: false },
      ],
    });
    expect(editorOf(SITE_WORLD, "write")).toEqual({
      form: "record",
      fields: [
        { key: "key", required: true, data: { form: "text" } },
        { key: "value", required: true },
      ],
    });
  });

  it("makes a hole for each required position", () => {
    expect(emptyDoc(SITE_WORLD, "if")).toEqual(typed("if", { test: newHole(), then: newHole() }));
    expect(emptyDoc(SITE_WORLD, "write")).toEqual(typed("write", { key: "", value: newHole() }));
    expect(emptyDoc(SITE_WORLD, "add")).toEqual(typed("add", []));
    expect(emptyDoc(SITE_WORLD, "number")).toEqual(typed("number", 0));
    expect(emptyDoc(SITE_WORLD, "bool")).toEqual(typed("bool", true));
    expect(emptyDoc(SITE_WORLD, "math.product")).toEqual(typed(["math", "product"], []));
  });

  it("gives a field of a list an empty list, a form with a least count its holes, and a path the root self (D178)", () => {
    expect(editorOf(SITE_WORLD, "handle")).toMatchObject({ form: "record", fields: [{ key: "with", required: true, parts: "list" }, { key: "return" }, { key: "body" }] });
    expect(emptyDoc(SITE_WORLD, "handle")).toEqual(typed("handle", { with: [], body: newHole() }));
    expect(emptyDoc(SITE_WORLD, "log")).toEqual(typed("log", []));
    expect(emptyDoc(SITE_WORLD, "log", SITE_SYNTAX)).toEqual(typed("log", [newHole()]));
    expect(emptyDoc(SITE_WORLD, "add", SITE_SYNTAX)).toEqual(typed("add", []));
    expect(emptyDoc(SITE_WORLD, "ref")).toEqual(typed("ref", ["self"]));
    expect(docText(emptyDoc(SITE_WORLD, "log", SITE_SYNTAX))).toEqual({ ok: true, text: "log(hole())" });
  });

  it("respects the limits of a number and the first value of a menu", () => {
    const world: World = {
      defaults: {},
      kinds: {
        small: { verbs: {}, parts: { shape: "number", min: 5, max: 9, whole: true } },
        low: { verbs: {}, parts: { shape: "number", max: -2 } },
        pick: { verbs: {}, parts: { shape: "one", values: ["a", "b"] } },
        one: { verbs: {}, parts: { shape: "term", of: "number" } },
        map: { verbs: {}, parts: { shape: "map" } },
        data: { verbs: {}, parts: { shape: "deep" } },
      },
    };
    expect(editorOf(world, "small")).toEqual({ form: "number", whole: true, min: 5, max: 9 });
    expect(emptyDoc(world, "small")).toEqual(typed("small", 5));
    expect(emptyDoc(world, "low")).toEqual(typed("low", -2));
    expect(emptyDoc(world, "pick")).toEqual(typed("pick", "a"));
    expect(emptyDoc(world, "one")).toEqual(typed("one", newHole()));
    expect(emptyDoc(world, "map")).toEqual(typed("map", {}));
    expect(emptyDoc(world, "data")).toEqual(typed("data", null));
    expect(editorOf(world, "missing")).toEqual({ form: "none" });
  });
});

describe("the positions of a document", () => {
  const world: World = {
    defaults: {},
    kinds: {
      number: { verbs: {} },
      text: { verbs: {} },
      math: { kinds: { sum: { verbs: {} }, product: { verbs: {} } } },
      only: { verbs: {}, parts: { shape: "list", item: { shape: "term", kinds: [["number"], ["math"]] } } },
      rule: { verbs: {}, parts: { shape: "record", fields: { first: { shape: "term", kinds: [["text"]] }, free: { shape: "term" } } } },
    },
  };

  it("[SHAPE.KINDS] lists only the kinds that a position permits", () => {
    const doc = typed("only", [newHole()]);
    expect(kindsAt(world, doc, ["0"])).toEqual(["number", "math.sum", "math.product"]);
    expect(kindsAt(world, doc, [])).toEqual(["number", "text", "math.sum", "math.product", "only", "rule"]);
  });

  it("[SHAPE.KINDS] reads the position of a field", () => {
    const doc = typed("rule", { first: newHole(), free: newHole() });
    expect(kindsAt(world, doc, ["first"])).toEqual(["text"]);
    expect(kindsAt(world, doc, ["free"])).toHaveLength(6);
  });

  it("lists the names that the walk sees at a position", () => {
    const doc = typed("seq", [typed("number", 1, { name: "a" }), typed("number", 2, { name: "b" }), typed("ref", ["names", "a"])]);
    expect(namesAt(SITE_WORLD, doc, ["2"])).toEqual(expect.arrayContaining(["a", "b"]));
    expect(namesAt(SITE_WORLD, doc, ["1"])).toContain("a");
    expect(namesAt(SITE_WORLD, doc, ["1"])).not.toContain("b");
    expect(namesAt(SITE_WORLD, doc, ["9"])).toEqual([]);
  });

  it("walks a hole as a document with no parts", () => {
    const seen: string[] = [];
    walk(SITE_WORLD, typed("list", [newHole()]), (visit) => {
      seen.push(visit.at.join("/"));
    });
    expect(seen).toEqual(["", "value/0"]);
  });
});
