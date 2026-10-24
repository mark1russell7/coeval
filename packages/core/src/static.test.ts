import { describe, expect, it } from "vitest";
import {
  type HostThing,
  type Json,
  type Machine,
  type Result,
  type Runner,
  STD_CAPS,
  STD_MACHINE,
  STD_WORLD,
  THING,
  check,
  context,
  docEquals,
  formulaDefinitions,
  formulaKinds,
  formulaMachine,
  isKind,
  lookupKind,
  makeContext,
  mapRefs,
  nearestWalker,
  partsOf,
  prepare,
  reference,
  refsOf,
  resolve,
  run,
  sameValue,
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

  it("[WORLD.OPEN] a world with a fallback answers each first key that it does not have", () => {
    const call = { verbs: { eval: "call" }, parts: { shape: "deep" }, effects: "type" } as const;
    const open = { kinds: { ...formulaKinds(), git: { kinds: {}, fallback: call }, alias: { type: "ref", value: ["world", "lit"] } }, defaults: {}, fallback: call } as const;
    expect(lookupKind(open, ["fs", "read.json"])).toMatchObject({ ok: true, kind: call, path: ["fs", "read.json"] });
    expect(lookupKind(open, "anything")).toMatchObject({ ok: true, kind: call });
    expect(lookupKind(open, "lit")).toMatchObject({ ok: true, path: ["lit"] });
    expect(lookupKind(open, ["git", "push"])).toMatchObject({ ok: true, kind: call });
    expect(lookupKind(open, "alias")).toMatchObject({ ok: true, path: ["lit"], aliases: 1 });
    // The fallback answers only a first key: a namespace without a fallback still refuses its unknown keys
    expect(lookupKind(open, ["ops", "x"])).toMatchObject({ ok: true });
    expect(lookupKind({ ...open, kinds: { closed: { kinds: {} } } }, ["closed", "x"])).toMatchObject({ ok: false, reason: "unknown" });
    const docMachine: Machine = { world: open, evaluators: { call: () => ({ ok: true, value: "called" }) } };
    expect(check(docMachine, { type: ["fs", "read"], value: { path: "a" } })).toEqual([]);
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

  it("[DOC.HOST-EQUALS] a value that is not plain JSON is equal only to itself, and a cycle does not stop the comparison", () => {
    class Point {
      constructor(readonly x: number) {}
    }
    const date = new Date(0);
    // Each pair has no own keys, or the same own keys, thus a comparison of the own keys finds them equal.
    const pairs: readonly (readonly [unknown, unknown])[] = [
      [new Date(0), new Date(1)],
      [new Map([["a", 1]]), new Map([["a", 2]])],
      [new Set([1]), new Set([2])],
      [new Point(1), new Point(1)],
      [() => 1, () => 1],
      [{ at: new Date(0) }, { at: new Date(0) }],
      [[new Point(1)], [new Point(1)]],
      [new Point(1), { x: 1 }],
    ];
    for (const [a, b] of pairs) expect(docEquals(a, b), String(a)).toBe(false);
    expect(docEquals(date, date)).toBe(true);
    expect(docEquals({ at: date, list: [date] }, { list: [date], at: date })).toBe(true);
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { a: [1] });
    expect(docEquals(bare, { a: [1] })).toBe(true);
    expect(docEquals([1], { 0: 1 })).toBe(false);
    // A cycle of records ends: the pairs that the comparison already visits are not compared again.
    const x: Record<string, unknown> = { n: 1 };
    x["self"] = x;
    const y: Record<string, unknown> = { n: 1 };
    y["self"] = y;
    expect(docEquals(x, y)).toBe(true);
    expect(docEquals(x, { n: 1, self: { n: 2, self: null } })).toBe(false);
    // A list shape with distinct items sees two different dates as different items.
    expect(splitParts({ shape: "list", item: { shape: "none" }, distinct: true }, [new Date(0), new Date(0)] as never)).toMatchObject({ ok: true });
    // sameValue of agree uses the same rules, and it adds a rule for closures: the same parameters are the same.
    for (const [a, b] of pairs) expect(sameValue(a, b), String(a)).toBe(false);
    const two = (body: number): unknown => {
      const result = prepare(machine, { type: "fn", value: { params: ["n"], body } }).evaluate();
      return result.ok ? result.value : undefined;
    };
    expect(sameValue(two(1), two(2))).toBe(true);
    expect(docEquals(two(1), two(1))).toBe(false);
  });

  it("[DOC.PARTS-OF] partsOf gives the kind and the parts of a document, and the plan, the reference and check read it the same way", () => {
    const aliased = { kinds: { ...formulaKinds(), sum: { type: "ref", value: ["world", "ops", "add"] } }, defaults: {} } as const;
    const read = partsOf(aliased, { type: "sum", value: [1, { type: "ref", value: ["names", "a"] }] });
    expect(read).toMatchObject({ ok: true, declared: false, typePath: ["ops", "add"], kind: { verbs: { eval: "formula.op" } } });
    if (!read.ok || !read.split.ok) throw new Error("The document has parts.");
    expect(read.split.parts.map((part) => part.key)).toEqual(["0", "1"]);
    expect(partsOf(world, 7, "lit")).toMatchObject({ ok: true, doc: { type: "lit", value: 7 }, declared: true, typePath: ["lit"] });
    expect(partsOf(world, 7)).toEqual({ ok: false, code: "#PART?", reason: "The value has no envelope, and its position declares no type." });
    // A kind that the world does not have gives no kind, and the value is data.
    expect(partsOf(world, { type: "nothing", value: [1] })).toMatchObject({ ok: true, kind: undefined, typePath: undefined, split: { ok: true, parts: [] } });
    // The reason of a value without its shape names the kind. A run, the reference and check give the same reason.
    const bad = { type: "let", value: { bind: { a: 1 } } };
    const reason = "The field body is missing. The kind is let.";
    expect(partsOf(world, bad)).toMatchObject({ ok: true, split: { ok: false, reason, at: [] } });
    expect(prepare(machine, bad).evaluate()).toEqual({ ok: false, error: { code: "#VALUE!", reason, place: [] } });
    expect(reference(machine, bad, makeContext(), { definitions: formulaDefinitions({}) })).toEqual({ ok: false, error: { code: "#VALUE!", reason, place: [] } });
    expect(check(machine, bad)).toEqual([{ code: "#VALUE!", place: [], reason, at: ["value"] }]);
    const deep = partsOf(world, { type: "fn", value: { params: ["a", 2], body: 1 } });
    expect(deep).toMatchObject({ ok: true, split: { ok: false, reason: "The value must be a text. (at params.1) The kind is fn.", at: ["params", 1] } });
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

  it("[DEREF.QUICK] a resolution without hops asks a host thing for the keys one time, also from the root world", () => {
    const calls: string[] = [];
    const store: HostThing = {
      [THING]: true,
      label: "store",
      deref: () => undefined,
      toJson: () => null,
      resolve: (keys) => {
        calls.push(keys.join("."));
        if (keys[0] === "r") return { thing: { type: "ref", value: ["names", "x"] } };
        return keys[0] === "n1" ? { thing: 42 } : undefined;
      },
    };
    const ctx = context({ world: store, names: { s: store, x: 7 } });
    expect(resolve({ world }, ctx, ["world", "n1", "value"], { hops: false })).toEqual({ ok: true, thing: 42, hops: [] });
    expect(resolve({ world }, ctx, ["names", "s", "n1"], { hops: false })).toMatchObject({ ok: true, thing: 42 });
    expect(resolve({ world }, ctx, ["world", "n2"], { hops: false })).toEqual({ ok: false, code: "#N/A", reason: "The path n2 reaches nothing.", hops: [] });
    expect(calls).toEqual(["n1.value", "n1", "n2"]);
    expect(resolve({ world }, ctx, ["world", "r"], { hops: false })).toMatchObject({ ok: true, thing: 7 });
    expect(resolve({ world, plain: true }, ctx, ["world", "r"], { hops: false })).toMatchObject({ ok: true, thing: { type: "ref", value: ["names", "x"] } });
    expect(resolve({ world }, context({ world: store }), ["world"], { hops: false })).toMatchObject({ ok: true, thing: store });
  });

  it("[TREE.NEAREST-MATCH] a host gives the walker nearest its own test of a type", () => {
    const leaf = { kind: "leaf", up: { kind: "card", name: "c1", up: null } };
    const walker = nearestWalker({ matches: (node, wanted) => (node as { kind?: unknown } | null)?.kind === wanted, maxHops: 8 });
    const nav = { world: { kinds: { nearest: { verbs: { step: "near" } } }, defaults: {} }, walkers: { near: walker } };
    const found = resolve(nav, context({ self: leaf }), ["self", { type: "nearest", value: { type: "card", follow: "up" } }, "name"]);
    expect(found).toMatchObject({ ok: true, thing: "c1" });
  });

  it("[DEREF.ADOPT] a navigation can adopt each value that a path reaches, also a value that a let binds", () => {
    const lensed = (value: unknown): unknown => {
      if (typeof value !== "object" || value === null || !Object.hasOwn(value, "lens")) return value;
      const lens = (value as { readonly lens: Readonly<Record<string, unknown>> }).lens;
      const thing: HostThing = { [THING]: true, label: "lensed", deref: (key) => lens[String(key)], toJson: () => value };
      return thing;
    };
    const card = { lens: { width: 300 }, width: "raw" };
    expect(resolve({ world, adopt: lensed }, context({ names: { card } }), ["names", "card", "width"])).toMatchObject({ ok: true, thing: 300 });
    expect(resolve({ world }, context({ names: { card } }), ["names", "card", "width"])).toMatchObject({ ok: true, thing: "raw" });
    const adopting = formulaMachine({}, { adopt: lensed });
    const doc = { type: "let", value: { bind: { c: { type: "ref", value: ["names", "card"] } }, body: { type: "ref", value: ["names", "c", "width"] } } };
    expect(prepare(adopting, doc).evaluate(context({ names: { card } }))).toEqual({ ok: true, value: 300 });
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
    expect(issues).toEqual([{ code: "#NAME?", place: [0, 0], reason: "The name later is bound by a later step.", at: ["value", 0, "value", 0, "value", 1] }]);
  });

  it("[STATIC.CAP] check finds an effect that the capabilities do not permit", () => {
    const callWorld: Machine = {
      ...STD_MACHINE,
      world: { kinds: { ...STD_MACHINE.world.kinds, git: { kinds: {}, fallback: { verbs: { eval: "data.text" }, effects: "type" } } }, defaults: {} },
    };
    const issues = check(callWorld, { type: ["git", "push"], value: "main" }, { caps: ["git.pull"] });
    expect(issues).toEqual([{ code: "#CAP!", place: [], reason: "The capabilities do not permit the effect git.push.", at: [] }]);
    expect(check(callWorld, { type: ["git", "push"], value: "main" }, { caps: ["git"] })).toEqual([]);
  });

  it("[STATIC.AGREES] a document that checks evaluates without the errors that check finds", () => {
    const ok = prepare(machine, doc).evaluate(context({ names: { x: 2 }, world: { n1: 3 } }));
    expect(ok).toEqual({ ok: true, value: 5 });
  });

  it("[STATIC.AGREES] check finds the #CAP! of a run at the same place, also when a kind narrows the capabilities", async () => {
    const cases: readonly (readonly [Json, readonly string[]])[] = [
      [{ type: "pure", value: [log] }, STD_CAPS],
      [log, ["write"]],
      [write, ["log"]],
      [{ type: "seq", value: [log, { type: "pure", value: [{ type: "seq", value: [write] }] }] }, STD_CAPS],
      [{ type: "seq", value: [log, write] }, STD_CAPS],
      [{ type: "pure", value: [{ type: "add", value: [1, 2] }] }, STD_CAPS],
      [{ type: "split", value: { inner: write, outer: log } }, STD_CAPS],
      [{ type: "split", value: { inner: log, outer: write } }, STD_CAPS],
      [{ type: "split", value: { inner: log, outer: { type: "pure", value: [write] } } }, ["log.debug", "write"]],
    ];
    for (const [doc, caps] of cases) {
      const issues = check(splitMachine, doc, { caps }).filter((issue) => issue.code === "#CAP!");
      const done = await run(splitMachine, doc, makeContext({}, caps), { perform: () => null });
      const label = JSON.stringify(doc);
      if (done.result.ok) expect(issues, label).toEqual([]);
      else {
        expect(done.result.error.code, label).toBe("#CAP!");
        expect(issues[0]?.place, label).toEqual(done.result.error.place);
      }
    }
  });

  it("[STATIC.KNOWN] check gives the #NAME? of an operation or an extension that the language does not have, as a run does", () => {
    const seven = (): number => 7;
    const profile = {
      ops: { add: (a: number, b: number) => a + b },
      lazy: { first: (args: readonly (() => Result)[]) => args[0]?.() ?? { ok: true as const, value: null } },
      ext: { now: () => ({ ok: true as const, value: "today" }) },
    };
    const language = formulaMachine(profile, { world: { kinds: { minus: { type: "ref", value: ["world", "ops", "sub"] } }, defaults: {} } });
    const op = (name: string, ...args: Json[]): Json => ({ type: ["ops", ...name.split(".")], value: args });
    const cases: readonly (readonly [Json, string | undefined])[] = [
      [op("add", 1, 2), undefined],
      [op("first", 1), undefined],
      [{ type: ["ext", "now"], value: null }, undefined],
      [{ type: ["ext", "number"], value: "NaN" }, undefined],
      [op("nope", 1), "The language has no operation nope."],
      [op("math.max", 1), "The language has no operation math.max."],
      [{ type: ["ext", "nope"], value: 1 }, "The language has no extension nope."],
      // The path of the kind comes after each alias, as in a run.
      [{ type: "minus", value: [1] }, "The language has no operation sub."],
      [{ type: "list", value: [1, op("nope")] }, "The language has no operation nope."],
    ];
    for (const [doc, reason] of cases) {
      const issues = check(language, doc);
      const result = prepare(language, doc).evaluate();
      const direct = reference(language, doc, makeContext(), { definitions: formulaDefinitions(profile) });
      const label = JSON.stringify(doc);
      if (reason === undefined) {
        expect(issues, label).toEqual([]);
        expect(result.ok, label).toBe(true);
        continue;
      }
      const place = (doc as { readonly type: unknown }).type === "list" ? [1] : [];
      expect(issues, label).toEqual([{ code: "#NAME?", place, reason, at: place.length === 0 ? [] : ["value", 1] }]);
      expect(result, label).toEqual({ ok: false, error: { code: "#NAME?", reason, place } });
      expect(direct, label).toEqual(result);
    }
    // A profile whose ops is a function answers through a call. A call that throws gives #CALC! in a run, not #NAME?.
    const table = formulaMachine({
      ops: (name) => {
        if (name === "trap") throw new Error("no trap");
        return name === "seven" ? seven : undefined;
      },
    });
    expect(check(table, op("seven"))).toEqual([]);
    expect(check(table, op("six")).map((issue) => issue.reason)).toEqual(["The language has no operation six."]);
    expect(check(table, op("trap"))).toEqual([]);
    expect(prepare(table, op("trap")).evaluate()).toMatchObject({ ok: false, error: { code: "#CALC!" } });
    // An own entry answers first, thus the evaluator of the operation does not run.
    expect(check(language, { type: ["ops", "nope"], value: [1], own: { eval: "formula.list" } })).toEqual([]);
    // A language adds its own hook for its own evaluators, and it can replace an evaluator of the kit.
    const moves = formulaMachine(profile, {
      world: { kinds: { moves: { kinds: {}, fallback: { verbs: { eval: "test.move" } } } }, defaults: {} },
      evaluators: { "test.move": ({ typePath }) => (typePath[1] === "up" ? { ok: true, value: "up" } : { ok: false, error: { code: "#NAME?", reason: "No such move." } }) },
      known: (path, evaluator) => (evaluator !== "test.move" || path[1] === "up" ? true : "No such move."),
    });
    expect(check(moves, { type: ["moves", "left"], value: null })).toEqual([{ code: "#NAME?", place: [], reason: "No such move.", at: [] }]);
    expect(check(moves, { type: ["moves", "up"], value: null })).toEqual([]);
    expect(check(moves, op("nope"))).toHaveLength(1);
    const replaced = formulaMachine(profile, { evaluators: { "formula.op": () => ({ ok: true, value: 0 }) } });
    expect(check(replaced, op("nope"))).toEqual([]);
    // A machine without the hook does not check the names.
    const { known: _known, ...plain } = language;
    expect(check(plain, op("nope"))).toEqual([]);
  });

  it("[STATIC.NARROW] check tests each effect against the capabilities of its own document, as the kinds narrow them", () => {
    expect(check(STD_MACHINE, { type: "pure", value: [log] }, { caps: STD_CAPS })).toEqual([
      { code: "#CAP!", place: [0], reason: "The capabilities do not permit the effect log here. The kind pure around it narrows them for its parts.", at: ["value", 0] },
    ]);
    const nested = { type: "seq", value: [log, { type: "pure", value: [{ type: "seq", value: [write] }] }] };
    expect(check(STD_MACHINE, nested, { caps: STD_CAPS }).map((issue) => `${issue.code}@${issue.place.join(".")}`)).toEqual(["#CAP!@1.0.0"]);
    expect(check(STD_MACHINE, nested)).toEqual([]);
    const seen: string[] = [];
    walk(STD_WORLD, nested, (v) => {
      seen.push(`${v.place.join(".") || "root"}:${v.caps?.join(",") ?? "none"}`);
    }, { caps: STD_CAPS });
    expect(seen).toEqual(["root:log,write", "0:log,write", "0.0:log,write", "1:log,write", "1.0:", "1.0.0:", "1.0.0.value:"]);
    const split = check(splitMachine, { type: "split", value: { inner: write, outer: write } }, { caps: STD_CAPS });
    expect(split.map((issue) => `${issue.code}@${issue.place.join(".")}`)).toEqual(["#CAP!@inner"]);
    expect(split[0]?.reason).toBe("The capabilities do not permit the effect write here. The kind split around it narrows them for its parts.");
  });

  it("[CAP.DECLARED] each kind of the standard world that causes an effect declares it, thus check finds a #CAP! for it", () => {
    expect(check(STD_MACHINE, log, { caps: [] })).toEqual([{ code: "#CAP!", place: [], reason: "The capabilities do not permit the effect log.", at: [] }]);
    expect(check(STD_MACHINE, write, { caps: ["log"] }).map((issue) => issue.reason)).toEqual(["The capabilities do not permit the effect write."]);
    expect(check(STD_MACHINE, { type: "seq", value: [log, write] }, { caps: STD_CAPS })).toEqual([]);
    for (const [name, entry] of Object.entries(STD_WORLD.kinds)) {
      if (isKind(entry) && entry.side === "run") expect(entry.effects, name).toBeDefined();
    }
  });
});

const log = { type: "log", value: ["x"] };
const write = { type: "write", value: { key: "k", value: { type: "number", value: 1 } } };

/** This runner evaluates the parts of a record in order, and it gives the last result. */
const inOrder: Runner = function* ({ parts }) {
  let last: { readonly ok: true; readonly value: unknown } | undefined;
  for (const part of parts) {
    const result = yield* part.evaluate();
    if (!result.ok) return result;
    last = result;
  }
  return last ?? { ok: true, value: null };
};

/** The standard machine with a kind split: its part inner gets only the capability log. */
const splitMachine: Machine = {
  ...STD_MACHINE,
  world: {
    ...STD_MACHINE.world,
    kinds: {
      ...STD_MACHINE.world.kinds,
      split: { verbs: { eval: "in-order" }, parts: { shape: "record", fields: ["inner", "outer"] }, caps: [{ rule: "only", caps: ["log"], in: [["inner"]] }] },
    },
  },
  runners: { ...STD_MACHINE.runners, "in-order": inOrder },
};
