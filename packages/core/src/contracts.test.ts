import { describe, expect, it } from "vitest";
import { type DocVisit, type EvalError, type Machine, check, context, formulaKinds, formulaMachine, ok, prepare, refsOf, splitParts, walk } from "./index.ts";

const ref = (...path: unknown[]): unknown => ({ type: "ref", value: path });
const op = (name: string, ...args: unknown[]): unknown => ({ type: ["ops", name], value: args });

describe("contracts with data", () => {
  it("[SHAPE.DATA] a data shape gives the type of a value: a text, a number in limits, or one of some values", () => {
    const limit = { shape: "number", whole: true, min: 0, max: 10 } as const;
    expect(splitParts(limit, 3)).toMatchObject({ ok: true, parts: [] });
    expect(splitParts(limit, 2.5)).toMatchObject({ ok: false, reason: "The value must be a whole number." });
    expect(splitParts(limit, -1)).toMatchObject({ ok: false, reason: "The value must be 0 or more." });
    expect(splitParts(limit, 11)).toMatchObject({ ok: false, reason: "The value must be 10 or less." });
    expect(splitParts(limit, "3")).toMatchObject({ ok: false, reason: "The value must be a number." });
    expect(splitParts({ shape: "number" }, 0.5)).toMatchObject({ ok: true });
    expect(splitParts({ shape: "text" }, "x")).toMatchObject({ ok: true });
    expect(splitParts({ shape: "text" }, 1)).toMatchObject({ ok: false, reason: "The value must be a text." });
    expect(splitParts({ shape: "one", values: [4, 8, null] }, null)).toMatchObject({ ok: true });
    expect(splitParts({ shape: "one", values: [4, 8] }, 5)).toMatchObject({ ok: false, reason: "The value must be one of [4,8]." });
    const record = { shape: "record", fields: { n: { shape: "one", values: [4, 8] } } } as const;
    expect(splitParts(record, { n: 6 })).toMatchObject({ ok: false, at: ["n"] });
  });

  it("[SHAPE.CLOSED] a closed record permits only its named fields", () => {
    const closed = { shape: "record", fields: { body: { shape: "term" } }, closed: true } as const;
    expect(splitParts(closed, { body: 1 })).toMatchObject({ ok: true });
    expect(splitParts(closed, { body: 1, extra: 2 })).toMatchObject({ ok: false, reason: "The field extra is not a field of this kind.", at: ["extra"] });
    expect(splitParts({ ...closed, closed: false }, { body: 1, extra: 2 })).toMatchObject({ ok: true });
  });

  it("[SHAPE.KINDS] a term can permit only the parts of some kinds", () => {
    const axis = { shape: "term", kinds: [["axes"], ["ref"]] } as const;
    expect(splitParts(axis, { type: ["axes", "all"], value: {} })).toMatchObject({ ok: true });
    expect(splitParts(axis, { type: "ref", value: ["self"] })).toMatchObject({ ok: true });
    expect(splitParts(axis, { type: ["ops", "add"], value: [] })).toMatchObject({ ok: false, reason: "The kind ops.add is not permitted here. The permitted kinds are axes, ref." });
    expect(splitParts(axis, 3)).toMatchObject({ ok: false, reason: "A value without an envelope is not permitted here. The permitted kinds are axes, ref." });
    expect(splitParts({ shape: "term", of: "lit", kinds: [["lit"]] }, 3)).toMatchObject({ ok: true });
    expect(splitParts({ shape: "term", kinds: [["axes", "all"]] }, { type: ["axes"], value: {} })).toMatchObject({ ok: false });
  });

  it("[SHAPE.DISTINCT] a list can permit no two equal items", () => {
    const params = { shape: "list", item: { shape: "text" }, distinct: true } as const;
    expect(splitParts(params, ["a", "b"])).toMatchObject({ ok: true, parts: [] });
    expect(splitParts(params, ["a", "b", "a"])).toMatchObject({ ok: false, reason: "The items of the list must be different.", at: [2] });
    expect(splitParts(params, ["a", 1])).toMatchObject({ ok: false, reason: "The value must be a text.", at: [1] });
  });
});

describe("the scale of the static kit", () => {
  const world = { kinds: formulaKinds(), defaults: {} };

  it("[STATIC.LINEAR] a walk of a very deep document is linear, and a visit knows its parent and its slot", () => {
    let doc: unknown = ref("names", "x");
    for (let index = 0; index < 100_000; index += 1) doc = op("add", doc, 1);
    const start = performance.now();
    const refs = refsOf(world, doc);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.place).toHaveLength(100_000);
    expect(performance.now() - start).toBeLessThan(5000);
    let deepest: DocVisit | undefined;
    walk(world, op("add", { type: "let", value: { bind: { a: 1 }, body: ref("names", "a") } }, 2), (v) => {
      if (v.depth === 2) deepest = v;
    });
    expect(deepest?.slot).toEqual(["body"]);
    expect(deepest?.parent?.slot).toEqual([0]);
    expect(deepest?.parent?.parent?.parent).toBeUndefined();
    expect(deepest?.place).toEqual([0, "body"]);
    expect(deepest?.at).toEqual(["value", 0, "value", "body"]);
  });

  it("[STATIC.AT] check gives the JSON path of each problem, to the value with the problem", () => {
    const machine: Machine = formulaMachine(
      {},
      { world: { kinds: { box: { verbs: { eval: "formula.lit" }, parts: { shape: "record", fields: { n: { shape: "number" } }, closed: true } } }, defaults: {} } },
    );
    const issues = check(machine, { type: "list", value: [1, { type: "box", value: { n: 1, m: 2 } }] });
    expect(issues).toEqual([{ code: "#VALUE!", place: [1], at: ["value", 1, "value", "m"], reason: "The field m is not a field of this kind. (at m) The kind is box." }]);
    expect(check(machine, ref("names", "q")).map((issue) => issue.at)).toEqual([["value", 1]]);
    expect(check({ ...machine, roots: ["names"] }, ref("world", "q")).map((issue) => issue.at)).toEqual([["value", 0]]);
    expect(check(machine, ref()).map((issue) => issue.at)).toEqual([["value"]]);
  });

  it("[STATIC.PATH] check finds a reference whose value is not a path", () => {
    const machine = formulaMachine({});
    expect(check(machine, { type: "ref", value: "x" })).toEqual([{ code: "#VALUE!", place: [], at: ["value"], reason: "The value of ref is a path: a list that starts with a root." }]);
    expect(check(machine, { type: "list", value: [{ type: "ref", value: {} }] }).map((issue) => issue.at)).toEqual([["value", 0, "value"]]);
    expect(check(machine, { type: "ref", value: ["names", "x"] }, { names: ["x"] })).toEqual([]);
  });
});

describe("the errors of the parts", () => {
  const combine = (errors: readonly EvalError[]): EvalError => ({ code: "#ARGS", reason: `${errors.length} parts failed.`, cause: errors });
  const machine = formulaMachine({ ops: { add: (a: number, b: number) => a + b, neg: (a: number) => -a }, combine });
  const run = (doc: unknown): unknown => prepare(machine, doc).evaluate(context({ names: { x: 1 } }));

  it("[FORMULA.COMBINE] with combine, each part evaluates: one error stays, and two errors combine", () => {
    expect(run(op("add", ref("names", "x"), 2))).toEqual(ok(3));
    expect(run(op("add", ref("names", "a"), 2))).toMatchObject({ ok: false, error: { code: "#NAME?" } });
    const two = run(op("add", ref("names", "a"), ref("names", "b")));
    expect(two).toMatchObject({ ok: false, error: { code: "#ARGS", reason: "2 parts failed." } });
    expect(run(op("neg", ref("names", "a")))).toMatchObject({ ok: false, error: { code: "#NAME?" } });
    expect(run({ type: "record", value: { p: ref("names", "a"), q: ref("names", "b") } })).toMatchObject({ ok: false, error: { code: "#ARGS" } });
    expect(run({ type: "record", value: { p: ref("names", "x"), q: 2 } })).toEqual(ok({ p: 1, q: 2 }));
    expect(run({ type: "list", value: [ref("names", "a"), ref("names", "b"), 1] })).toMatchObject({ ok: false, error: { code: "#ARGS" } });
    expect(run({ type: "list", value: [ref("names", "x"), 1] })).toEqual(ok([1, 1]));
    // A field that the profile omits is absent, also with combine.
    const omitting = formulaMachine({ combine, omit: (error) => error.code === "#NAME?" });
    expect(prepare(omitting, { type: "record", value: { p: ref("names", "a"), q: 2 } }).evaluate()).toEqual(ok({ q: 2 }));
  });
});
