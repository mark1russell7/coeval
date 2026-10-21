import { describe, expect, it } from "vitest";
import {
  type HostThing,
  type Machine,
  STD_MACHINE,
  THING,
  check,
  context,
  docEquals,
  formulaKinds,
  formulaMachine,
  lookupKind,
  mapRefs,
  nearestWalker,
  prepare,
  refsOf,
  resolve,
  splitParts,
  stored,
  walk,
} from "./index.ts";

const world = { kinds: formulaKinds(), defaults: {} };
const machine = formulaMachine({ ops: { add: (a: number, b: number) => a + b } });

describe("shapes", () => {
  it("[SHAPE.RECORD] a record names a shape for each field, and the other fields are data", () => {
    const split = splitParts(
      { shape: "record", fields: { bind: { shape: "map", of: "lit" }, body: { shape: "term" } }, required: ["body"] },
      { bind: { a: 1, b: 2 }, body: { type: "ref", value: ["names", "a"] }, note: "data" },
    );
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.parts.map((part) => part.key)).toEqual(["bind.a", "bind.b", "body"]);
    expect(split.parts[0]).toMatchObject({ path: ["bind", "a"], of: "lit", item: 1 });
    expect(split.data).toEqual({ bind: {}, note: "data" });
    expect(split.fill(["A", "B", "BODY"])).toEqual({ bind: { a: "A", b: "B" }, body: "BODY", note: "data" });
  });

  it("[SHAPE.REQUIRED] a missing required field is a reason, with its place", () => {
    const split = splitParts({ shape: "record", fields: { body: { shape: "term" } }, required: ["body"] }, { other: 1 });
    expect(split).toMatchObject({ ok: false, reason: "The field body is missing.", at: [] });
    expect(splitParts({ shape: "list" }, { not: "a list" })).toMatchObject({ ok: false, reason: "The value must be a list." });
  });

  it("[SHAPE.DEEP] a deep shape finds each envelope at any depth, and keeps the rest as data", () => {
    const value = { a: [1, { type: "lit", value: 2 }], b: { c: { type: "ref", value: ["names", "x"] } }, d: "text" };
    const split = splitParts({ shape: "deep" }, value);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.parts.map((part) => part.path)).toEqual([["a", 1], ["b", "c"]]);
    expect(split.fill(["two", "x"])).toEqual({ a: [1, "two"], b: { c: "x" }, d: "text" });
  });

  it("[SHAPE.PROTO] a field named __proto__ stays a field", () => {
    const value = JSON.parse('{"__proto__": {"type": "lit", "value": 1}}') as never;
    const split = splitParts({ shape: "map" }, value);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    const filled = split.fill(["one"]) as Record<string, unknown>;
    expect(Object.hasOwn(filled, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(filled)).toBe(Object.prototype);
  });

  it("[WORLD.FALLBACK] a namespace with a fallback answers each other key", () => {
    const found = lookupKind(world, ["ops", "math", "add"]);
    expect(found).toMatchObject({ ok: true, path: ["ops", "math", "add"] });
    expect(lookupKind(world, ["ops"])).toMatchObject({ ok: false, reason: "not-a-kind" });
    expect(lookupKind(world, "nothing")).toMatchObject({ ok: false, reason: "unknown" });
  });
});

describe("documents", () => {
  it("[DOC.STORED] a stored document has the keys of its store beside its envelope", () => {
    const read = stored({ _id: "p1", type: "page", value: { sections: [] } }, ["_id", "_schemaVersion"]);
    expect(read).toEqual({ envelope: { type: "page", value: { sections: [] } }, header: { _id: "p1" } });
    expect(stored({ _id: "p1", other: 1, type: "page", value: 1 }, ["_id"])).toBeUndefined();
  });

  it("[DOC.EQUALS] two documents are equal when their values are equal, in any order of the fields", () => {
    expect(docEquals({ type: "lit", value: { a: 1, b: [2, 3] } }, { value: { b: [2, 3], a: 1 }, type: "lit" })).toBe(true);
    expect(docEquals([1, 2], [2, 1])).toBe(false);
    let deep: unknown = 0;
    for (let index = 0; index < 100000; index += 1) deep = [deep];
    expect(docEquals(deep, deep)).toBe(true);
  });

  it("[DOC.RECORD] only a plain object is a record", () => {
    expect(splitParts({ shape: "map" }, new Date(0) as never)).toMatchObject({ ok: false });
  });
});

describe("references", () => {
  it("[DEREF.PLAIN] a plain navigation reads a value shaped like a reference as data", () => {
    const data = { cell: { type: "ref", value: ["names", "x"] } };
    const ctx = context({ names: { data, x: 5 } });
    expect(resolve({ world }, ctx, ["names", "data", "cell"])).toMatchObject({ ok: true, thing: 5 });
    expect(resolve({ world, plain: true }, ctx, ["names", "data", "cell"])).toMatchObject({ ok: true, thing: data.cell });
  });

  it("[DEREF.ROOTS] a navigation can close roots", () => {
    const ctx = context({ names: { a: 1 } });
    expect(resolve({ world, roots: ["names"] }, ctx, ["world", "lit"])).toMatchObject({ ok: false, code: "#REF!" });
    expect(resolve({ world, roots: ["names"] }, ctx, ["names", "a"])).toMatchObject({ ok: true, thing: 1 });
  });

  it("[DEREF.CODES] an unknown name is #NAME?, a missing field is #N/A", () => {
    const ctx = context({ names: { a: { b: 1, u: undefined } } });
    expect(resolve({ world }, ctx, ["names", "z"])).toMatchObject({ ok: false, code: "#NAME?" });
    expect(resolve({ world }, ctx, ["names", "a", "c"])).toMatchObject({ ok: false, code: "#N/A" });
    expect(resolve({ world }, ctx, ["names", "a", "u"])).toMatchObject({ ok: true, thing: undefined });
    expect(resolve({ world }, context({ names: { xs: [1, 2, 3] } }), ["names", "xs", "length"])).toMatchObject({ ok: true, thing: 3 });
  });

  it("[DEREF.PATH] a host thing can answer the keys of a path in one call", () => {
    const calls: string[] = [];
    const store: HostThing = {
      [THING]: true,
      label: "store",
      deref: () => undefined,
      toJson: () => null,
      resolve: (keys) => {
        calls.push(keys.join("."));
        return keys[0] === "n1" ? { thing: 42 } : undefined;
      },
    };
    const ctx = context({ world: store });
    expect(resolve({ world }, ctx, ["world", "n1", "value"])).toMatchObject({ ok: true, thing: 42 });
    expect(resolve({ world }, ctx, ["world", "n2"])).toMatchObject({ ok: false, code: "#N/A" });
    expect(calls).toEqual(["n1.value", "n2"]);
  });

  it("[TREE.NEAREST-MATCH] a host gives the walker nearest its own test of a type", () => {
    const leaf = { kind: "leaf", up: { kind: "card", name: "c1", up: null } };
    const walker = nearestWalker({ matches: (node, wanted) => (node as { kind?: unknown } | null)?.kind === wanted, maxHops: 8 });
    const nav = { world: { kinds: { nearest: { verbs: { step: "near" } } }, defaults: {} }, walkers: { near: walker } };
    const found = resolve(nav, context({ self: leaf }), ["self", { type: "nearest", value: { type: "card", follow: "up" } }, "name"]);
    expect(found).toMatchObject({ ok: true, thing: "c1" });
  });

  it("[DEREF.HOPS] a resolution can skip the record of hops", () => {
    const ctx = context({ names: { a: { b: 1 } } });
    expect(resolve({ world }, ctx, ["names", "a", "b"], { hops: false }).hops).toEqual([]);
    expect(resolve({ world }, ctx, ["names", "a", "b"]).hops).toHaveLength(3);
  });
});

describe("the static kit", () => {
  const doc = {
    type: "let",
    value: {
      bind: { a: { type: "ref", value: ["names", "x"] } },
      body: { type: ["ops", "add"], value: [{ type: "ref", value: ["names", "a"] }, { type: "ref", value: ["world", "n1"] }] },
    },
  };

  it("[STATIC.WALK] a walk visits each document with its place and the names it sees", () => {
    const seen: string[] = [];
    walk(world, doc, (v) => {
      seen.push(`${v.place.join(".") || "root"}:${[...v.names].join(",")}`);
    });
    expect(seen).toEqual(["root:", "bind.a:", "body:a", "body.0:a", "body.1:a"]);
  });

  it("[STATIC.REFS] refsOf finds the free references: the dependencies", () => {
    const refs = refsOf(world, doc);
    expect(refs.map((use) => `${use.path.join(".")}:${use.free ? "free" : "bound"}`)).toEqual(["names.x:free", "names.a:bound", "world.n1:free"]);
    expect(refs[2]?.at).toEqual(["value", "body", "value", 1]);
  });

  it("[STATIC.MAP] mapRefs changes the free references and shares the rest", () => {
    const next = mapRefs(world, doc, (use) => (use.root === "world" ? { type: "ref", value: ["names", "n1"] } : undefined)) as typeof doc;
    expect(next.value.body.value[1]).toEqual({ type: "ref", value: ["names", "n1"] });
    expect(next.value.bind).toBe(doc.value.bind);
    expect(doc.value.body.value[1]).toEqual({ type: "ref", value: ["world", "n1"] });
  });

  it("[STATIC.CHECK] check finds the problems before a run, each with its place", () => {
    const bad = {
      type: "list",
      value: [
        { type: "nothing", value: 1 },
        { type: "ref", value: ["names", "y"] },
        { type: "ref", value: ["here", "y"] },
        { type: "let", value: { body: 1 } },
      ],
    };
    const issues = check(machine, bad, { names: ["x"] });
    expect(issues.map((issue) => `${issue.code}@${issue.place.join(".")}`)).toEqual(["#KIND?@0", "#NAME?@1", "#REF!@2", "#VALUE!@3"]);
    expect(check(machine, doc, { names: ["x"] })).toEqual([]);
    expect(check(machine, doc, { names: "any" })).toEqual([]);
  });

  it("[STATIC.SEQ] check knows that a step reads only the steps before it", () => {
    const seq = {
      type: "seq",
      value: [
        { type: "log", value: [{ type: "ref", value: ["names", "later"] }] },
        { type: "text", value: "x", name: "later" },
        { type: "log", value: [{ type: "ref", value: ["names", "last"] }] },
      ],
    };
    const issues = check(STD_MACHINE, seq);
    expect(issues).toEqual([{ code: "#NAME?", place: [0, 0], reason: "The name later is bound by a later step." }]);
  });

  it("[STATIC.CAP] check finds an effect that the capabilities do not permit", () => {
    const callWorld: Machine = {
      ...STD_MACHINE,
      world: { kinds: { ...STD_MACHINE.world.kinds, git: { kinds: {}, fallback: { verbs: { eval: "data.text" }, effects: "type" } } }, defaults: {} },
    };
    const issues = check(callWorld, { type: ["git", "push"], value: "main" }, { caps: ["git.pull"] });
    expect(issues).toEqual([{ code: "#CAP!", place: [], reason: "The capabilities do not permit the effect git.push." }]);
    expect(check(callWorld, { type: ["git", "push"], value: "main" }, { caps: ["git"] })).toEqual([]);
  });

  it("[STATIC.AGREES] a document that checks evaluates without the errors that check finds", () => {
    const ok = prepare(machine, doc).evaluate(context({ names: { x: 2 }, world: { n1: 3 } }));
    expect(ok).toEqual({ ok: true, value: 5 });
  });
});
