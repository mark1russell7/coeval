import { describe, expect, it } from "vitest";
import { type FormulaProfile, type Machine, type Result, agree, check, context, evaluate, fail, formulaDefinitions, formulaMachine, isClosure, jsTruthy, ok, prepare, reference } from "./index.ts";

const ref = (...path: unknown[]): unknown => ({ type: "ref", value: path });
const op = (name: string, ...args: unknown[]): unknown => ({ type: ["ops", ...name.split(".")], value: args });

const OPS = {
  add: (a: number, b: number) => a + b,
  "math.neg": (a: number) => -a,
  div: (a: number, b: number) => a / b,
  boom: () => {
    throw new Error("no");
  },
  map: (fn: (item: unknown) => unknown, items: readonly unknown[]) => items.map((item) => fn(item)),
};

function evalWith(profile: FormulaProfile, doc: unknown, names: Record<string, unknown> = {}): Result {
  return prepare(formulaMachine(profile), doc, { declaredType: "lit" }).evaluate(context({ names }));
}

const strict = (doc: unknown, names: Record<string, unknown> = {}): Result => evalWith({ ops: OPS }, doc, names);

describe("the formula kit", () => {
  it("[FORMULA.LIT] a bare value in a term position is a literal, and lit keeps a value with an envelope shape", () => {
    expect(strict(op("add", 1, 2))).toEqual(ok(3));
    expect(strict({ type: "lit", value: { type: "ref", value: ["names", "x"] } })).toEqual(ok({ type: "ref", value: ["names", "x"] }));
    expect(strict(7)).toEqual(ok(7));
  });

  it("[FORMULA.REF] a reference gives what its path reaches, and a profile can call a value missing", () => {
    expect(strict(ref("names", "x", "y"), { x: { y: 4 } })).toEqual(ok(4));
    expect(strict(ref("names", "nope"))).toMatchObject({ ok: false, error: { code: "#NAME?" } });
    expect(evalWith({ missing: (value) => value === null }, ref("names", "x"), { x: null })).toMatchObject({ ok: false, error: { code: "#N/A" } });
  });

  it("[FORMULA.RECORD] a record evaluates each field, and a profile can leave out an absent field", () => {
    const doc = { type: "record", value: { a: op("add", 1, 1), b: ref("names", "missing") } };
    expect(strict({ type: "record", value: { a: op("add", 1, 1), b: "text" } })).toEqual(ok({ a: 2, b: "text" }));
    expect(strict(doc)).toMatchObject({ ok: false, error: { code: "#NAME?", place: ["b"] } });
    expect(evalWith({ ops: OPS, omit: (error) => error.code === "#NAME?" }, doc)).toEqual(ok({ a: 2 }));
  });

  it("[FORMULA.LIST] a list evaluates each item, and stops at the first error", () => {
    expect(strict({ type: "list", value: [1, op("add", 1, 1), ref("names", "x")] }, { x: 3 })).toEqual(ok([1, 2, 3]));
    expect(strict({ type: "list", value: [ref("names", "a"), ref("names", "b")] })).toMatchObject({ ok: false, error: { place: [0] } });
  });

  it("[FORMULA.LET] each binding sees the names around the let, and a failed binding fails only when it is read", () => {
    const doc = { type: "let", value: { bind: { x: 10, y: ref("names", "x") }, body: op("add", ref("names", "x"), ref("names", "y")) } };
    expect(strict(doc, { x: 1 })).toEqual(ok(11));
    const lazy = { type: "let", value: { bind: { bad: ref("names", "nope"), good: 2 }, body: ref("names", "good") } };
    expect(strict(lazy)).toEqual(ok(2));
    const read = { type: "let", value: { bind: { bad: ref("names", "nope") }, body: ref("names", "bad") } };
    expect(strict(read)).toMatchObject({ ok: false, error: { code: "#NAME?" } });
    const through = { type: "let", value: { bind: { bad: ref("names", "nope") }, body: ref("names", "bad", "field") } };
    expect(strict(through)).toMatchObject({ ok: false, error: { code: "#NAME?", reason: "The context has no name nope." } });
  });

  it("[FORMULA.FN] fn makes a function, call applies it, and an operation of the host can call it", () => {
    const double = { type: "fn", value: { params: ["n"], body: op("add", ref("names", "n"), ref("names", "n")) } };
    expect(strict({ type: "call", value: { fn: double, args: [4] } })).toEqual(ok(8));
    const fn = strict(double);
    expect(fn.ok && isClosure(fn.value)).toBe(true);
    expect(strict(op("map", double, { type: "list", value: [1, 2] }))).toEqual(ok([2, 4]));
    const failing = { type: "fn", value: { params: ["n"], body: ref("names", "nope") } };
    expect(strict(op("map", failing, { type: "list", value: [1] }))).toMatchObject({ ok: false, error: { code: "#NAME?" } });
    expect(strict({ type: "fn", value: { params: ["a", "a"], body: 1 } })).toMatchObject({ ok: false, error: { code: "#VALUE!" } });
    expect(strict({ type: "call", value: { fn: 3, args: [] } })).toMatchObject({ ok: false, error: { code: "#VALUE!" } });
  });

  it("[FORMULA.FN-PARAMS] the contract of fn declares params as a list of different texts, thus check and a run give the same #VALUE!", () => {
    const machine = formulaMachine({ ops: OPS });
    const fn = (params: unknown): unknown => ({ type: "fn", value: { params, body: 1 } });
    const cases: readonly (readonly [unknown, string, readonly (string | number)[]])[] = [
      [fn([1]), "The value must be a text. (at params.0) The kind is fn.", ["params", 0]],
      [fn(["a", "a"]), "The items of the list must be different. (at params.1) The kind is fn.", ["params", 1]],
      [fn("a"), "The value must be a list. (at params) The kind is fn.", ["params"]],
    ];
    for (const [doc, reason, at] of cases) {
      const label = JSON.stringify(doc);
      expect(check(machine, doc), label).toEqual([{ code: "#VALUE!", place: [], reason, at: ["value", ...at] }]);
      expect(prepare(machine, doc).evaluate(), label).toEqual({ ok: false, error: { code: "#VALUE!", reason, place: [] } });
      expect(reference(machine, doc, context(), { definitions: formulaDefinitions({ ops: OPS }) }), label).toEqual({ ok: false, error: { code: "#VALUE!", reason, place: [] } });
    }
    // A list of texts stays data, also when it is empty: a function without parameters works.
    const none = { type: "call", value: { fn: { type: "fn", value: { params: [], body: 7 } }, args: [] } };
    expect(check(machine, none)).toEqual([]);
    expect(strict(none)).toEqual(ok(7));
  });

  it("[FORMULA.IF] if evaluates only the branch that the test selects; a profile gives the truth of a value", () => {
    const doc = (test: unknown): unknown => ({ type: "if", value: { test, then: "yes", else: ref("names", "nope") } });
    expect(strict(doc(true))).toEqual(ok("yes"));
    expect(strict(doc(1))).toMatchObject({ ok: false, error: { code: "#VALUE!" } });
    expect(evalWith({ truthy: jsTruthy }, doc(1))).toEqual(ok("yes"));
  });

  it("[FORMULA.OTHERWISE] a profile gives the value of an if without else, also undefined", () => {
    const doc = { type: "if", value: { test: false, then: 1 } };
    expect(evalWith({}, doc)).toEqual(ok(null));
    expect(evalWith({ otherwise: "none" }, doc)).toEqual(ok("none"));
    expect(evalWith({ otherwise: undefined }, doc)).toEqual(ok(undefined));
    expect(evalWith({ otherwise: undefined }, { type: "if", value: { test: false, then: 1, else: 2 } })).toEqual(ok(2));
  });

  it("[FORMULA.LOGIC] and and or stop early; a profile can give the value that decided", () => {
    expect(strict({ type: "and", value: [true, false, ref("names", "nope")] })).toEqual(ok(false));
    expect(strict({ type: "or", value: [false, true, ref("names", "nope")] })).toEqual(ok(true));
    expect(evalWith({ truthy: jsTruthy, logic: "value" }, { type: "or", value: [0, "", "x"] })).toEqual(ok("x"));
    expect(evalWith({ truthy: jsTruthy, logic: "value" }, { type: "and", value: [1, 0, 2] })).toEqual(ok(0));
  });

  it("[FORMULA.OPS] an operation gets the values of its arguments, in order, and stops at the first error", () => {
    expect(strict(op("math.neg", 3))).toEqual(ok(-3));
    expect(strict(op("add", ref("names", "a"), ref("names", "b")))).toMatchObject({ ok: false, error: { reason: "The context has no name a." } });
    expect(strict(op("nothing", 1))).toMatchObject({ ok: false, error: { code: "#NAME?" } });
    expect(strict(op("boom"))).toMatchObject({ ok: false, error: { code: "#CALC!" } });
    const finite: FormulaProfile = { ops: OPS, check: (value) => (typeof value === "number" && !Number.isFinite(value) ? fail("#NUM!", "The number is not finite.") : undefined) };
    expect(evalWith(finite, op("div", 1, 0))).toMatchObject({ ok: false, error: { code: "#NUM!" } });
    expect(evalWith({ ops: (name) => (name === "seven" ? () => 7 : undefined) }, op("seven"))).toEqual(ok(7));
  });

  it("[FORMULA.LAZY] a lazy operation evaluates only the arguments that it needs", () => {
    const ifError = (args: readonly (() => Result)[]): Result => {
      const first = args[0]?.() ?? fail("#ARGS", "ifError needs two arguments.");
      return first.ok ? first : (args[1]?.() ?? first);
    };
    const profile: FormulaProfile = { lazy: { ifError } };
    expect(evalWith(profile, op("ifError", ref("names", "nope"), "fallback"))).toEqual(ok("fallback"));
    expect(evalWith(profile, op("ifError", 1, ref("names", "nope")))).toEqual(ok(1));
  });

  it("[FORMULA.EXT] the standard extensions give the values that JSON cannot write", () => {
    expect(strict({ type: ["ext", "undefined"], value: null })).toEqual(ok(undefined));
    expect(strict({ type: ["ext", "number"], value: "-0" })).toEqual(ok(-0));
    expect(strict({ type: ["ext", "number"], value: "NaN" })).toEqual(ok(Number.NaN));
    expect(strict({ type: ["ext", "nothing"], value: 1 })).toMatchObject({ ok: false, error: { code: "#NAME?" } });
    expect(evalWith({ ext: { now: () => ok("today") } }, { type: ["ext", "now"], value: null })).toEqual(ok("today"));
  });

  it("[FORMULA.DEPTH] a deep formula evaluates to its depth limit", () => {
    let doc: unknown = 0;
    for (let index = 0; index < 900; index += 1) doc = op("add", doc, 1);
    expect(strict(doc)).toEqual(ok(900));
  });

  it("[FORMULA.CALL-DEPTH] each application of a closure counts one level, thus an endless recursion gives one #DEPTH! in each tier", () => {
    const ops = { ...OPS, lt: (a: number, b: number) => a < b };
    const definitions = formulaDefinitions({ ops });
    // f(self, n) applies itself until n reaches the name limit. The name step chooses the application: call or the host map.
    const again = { type: "call", value: { fn: ref("names", "self"), args: [ref("names", "self"), op("add", ref("names", "n"), 1)] } };
    const viaMap = op("map", { type: "fn", value: { params: ["m"], body: { type: "call", value: { fn: ref("names", "self"), args: [ref("names", "self"), ref("names", "m")] } } } }, { type: "list", value: [op("add", ref("names", "n"), 1)] });
    const recursion = (step: unknown): unknown => {
      const body = { type: "if", value: { test: op("lt", ref("names", "n"), ref("names", "limit")), then: step, else: ref("names", "n") } };
      return { type: "let", value: { bind: { f: { type: "fn", value: { params: ["self", "n"], body } } }, body: { type: "call", value: { fn: ref("names", "f"), args: [ref("names", "f"), 0] } } } };
    };
    const tiers = (machine: Machine, doc: unknown, limit: number): readonly Result[] => {
      const ctx = context({ names: { limit } });
      const plan = prepare(machine, doc);
      return [plan.evaluate(ctx), plan.evaluate(ctx), evaluate(machine, doc, ctx).result, reference(machine, doc, ctx, { definitions })];
    };
    const deep = (levels: number, place: readonly (string | number)[]): Result => fail("#DEPTH!", `The applications of functions nest deeper than ${levels} levels.`, { place });
    const machine = formulaMachine({ ops });
    // The default limit is a quarter of maxDepth: 250 nested applications. An endless recursion stops at the application past it.
    for (const limit of [Number.MAX_SAFE_INTEGER, 250]) {
      for (const result of tiers(machine, recursion(again), limit)) expect(result).toEqual(deep(250, ["bind", "f", "body", "then"]));
      for (const result of tiers(machine, recursion(viaMap), limit)) expect(result).toEqual(deep(250, ["bind", "f", "body", "then", 0, "body"]));
      expect(agree(machine, recursion(again), context({ names: { limit } }), { definitions, strict: true })).toMatchObject({ ok: true, result: { ok: false } });
    }
    // A deep recursion under the limit gives its value in each tier: 250 applications, and 248 through the host map.
    for (const result of tiers(machine, recursion(again), 249)) expect(result).toEqual(ok(249));
    for (const result of tiers(machine, recursion(viaMap), 124)) expect(result).toEqual(ok(JSON.parse(`${"[".repeat(124)}124${"]".repeat(124)}`)));
    // The limit follows maxDepth. The count goes down after each return, thus a host loop of many applications stays under it.
    const small: Machine = { ...machine, maxDepth: 40 };
    for (const result of tiers(small, recursion(again), 9)) expect(result).toEqual(ok(9));
    for (const result of tiers(small, recursion(again), 10)) expect(result).toEqual(deep(10, ["bind", "f", "body", "then"]));
    const items = Array.from({ length: 1000 }, (_, index) => index);
    const loop = op("map", { type: "fn", value: { params: ["x"], body: op("add", ref("names", "x"), 1) } }, { type: "lit", value: items });
    for (const result of tiers(small, loop, 0)) expect(result).toEqual(ok(items.map((x) => x + 1)));
  });

  it("[PLAN.COMPILE-SPEED] a compilation without a trace records no trace, and a record keeps a field named __proto__", () => {
    const machine = formulaMachine({ ops: OPS });
    const record = (n: number): unknown => ({ type: "record", value: { a: ref("names", "x"), b: op("add", n, 1), ["__proto__"]: n } });
    expect(prepare(machine, JSON.parse(JSON.stringify(record(1)))).evaluate(context({ names: { x: 0 } }))).toSatisfy((result: Result) => {
      const value = result.ok ? (result.value as Record<string, unknown>) : {};
      return Object.hasOwn(value, "__proto__") && value["__proto__"] === 1 && Object.getPrototypeOf(value) === Object.prototype;
    });
    // The time of a compilation is a case of the bench (K200).
    expect(prepare(machine, record(2)).traced).toBe(false);
  });

  it("[FORMULA.SPEED] a plan evaluates a small formula many times with the same result", () => {
    const plan = prepare(formulaMachine({ ops: OPS }), op("add", ref("names", "x"), op("add", ref("names", "y"), 1)));
    const ctx = context({ names: { x: 1, y: 2 } });
    // The time of an evaluation is a case of the bench (K200).
    let last: Result = ok(0);
    for (let index = 0; index < 100000; index += 1) last = plan.evaluate(ctx);
    expect(last).toEqual(ok(4));
  });
});
