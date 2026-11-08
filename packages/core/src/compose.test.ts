import { describe, expect, it } from "vitest";
import {
  type AgreeOptions,
  type Context,
  type EvalFn,
  type Failed,
  type GenerateOptions,
  type Json,
  type Key,
  type Kind,
  type Machine,
  type MachinePart,
  type MergeConflict,
  type Namespace,
  type Part,
  type WorldEntry,
  type WorldPart,
  MergeError,
  agree,
  check,
  context,
  docEquals,
  fail,
  formulaDefinitions,
  formulaEvaluators,
  formulaKinds,
  formulaMachine,
  generate,
  lookupKind,
  mergeMachines,
  mergeWorlds,
  ok,
  prepare,
  restrictMachine,
  typesOf,
} from "./index.ts";
import { kindAt } from "./world.ts";

/*
 * The composition checklist (R6 P1, K34). Each test is one mode of composition from Erdweg, Giarrusso and Rendel
 * (2012), with small languages. A test asserts what the mode gives today with prepare, check and agree. A mode that
 * does not work today has a second test, skipped, with the target behavior and the roadmap item that proposes it.
 */

const op = (name: string, ...args: Json[]): Json => ({ type: ["ops", ...name.split(".")], value: args });
const doc = (type: string, value: Json): Json => ({ type, value });
const name = (key: string): Json => ({ type: "ref", value: ["names", key] });
const alias = (...path: Key[]): WorldEntry => ({ type: "ref", value: ["world", ...path] });

/** This function gives the values of the parts in order, or the first error. */
function valuesOf(parts: readonly Part[]): unknown[] | Failed {
  const values: unknown[] = [];
  for (const part of parts) {
    const result = part.evaluate();
    if (!result.ok) return result;
    values.push(result.value);
  }
  return values;
}

/** This function makes an evaluator from a function of the values of the parts. */
function ofValues(fn: (values: readonly unknown[]) => ReturnType<EvalFn>): EvalFn {
  return ({ parts }) => {
    const values = valuesOf(parts);
    return Array.isArray(values) ? fn(values) : values;
  };
}

const isNumber = (value: unknown): value is number => typeof value === "number";

/* The base: the formula kit with two operations. Each composition below uses this one machine. */

const PROFILE = { ops: { add: (a: number, b: number) => a + b, mul: (a: number, b: number) => a * b } };
const BASE: Machine = formulaMachine(PROFILE);
const DEFINITIONS = formulaDefinitions(PROFILE);
const OP_KIND = (formulaKinds()["ops"] as Namespace).fallback as Kind;

/* Extension one: statistics. It adds a kind, an alias, and an operation to the namespace ops of the kit. */

const mean: EvalFn = ofValues((values) => (values.length > 0 && values.every(isNumber) ? ok(values.reduce((a, b) => a + b, 0) / values.length) : fail("#VALUE!", "mean needs one number or more.")));
const twice: EvalFn = ofValues(([value]) => (isNumber(value) ? ok(value * 2) : fail("#VALUE!", "twice needs a number.")));

const STATS: MachinePart = {
  world: {
    kinds: {
      mean: { verbs: { eval: "stats.mean" }, parts: { shape: "list", of: "lit" }, summary: "The mean of its terms." },
      avg: alias("mean"),
      ops: { kinds: { twice: { verbs: { eval: "stats.twice" }, parts: { shape: "list", of: "lit" }, summary: "Two times its term." } } },
    },
  },
  evaluators: { "stats.mean": mean, "stats.twice": twice },
};

/* Extension two: texts. It does not know the statistics. It also adds an operation to the namespace ops. */

const upper: EvalFn = ofValues(([value]) => (typeof value === "string" ? ok(value.toUpperCase()) : fail("#VALUE!", "upper needs a text.")));
const join: EvalFn = ofValues((values) => (values.every((value) => typeof value === "string" || isNumber(value)) ? ok(values.join("")) : fail("#VALUE!", "join needs texts and numbers.")));

const TEXT: MachinePart = {
  world: {
    kinds: {
      upper: { verbs: { eval: "text.upper" }, parts: { shape: "term", of: "lit" }, summary: "Its term in upper case." },
      ops: { kinds: { join: { verbs: { eval: "text.join" }, parts: { shape: "list", of: "lit" }, summary: "Its terms as one text." } } },
    },
  },
  evaluators: { "text.upper": upper, "text.join": join },
};

/* Extension three: the verb format. It adds entries to the kinds of the base, and it does not copy a kind. */

const terms: EvalFn = ofValues((values) => ok(`(${values.join(", ")})`));

const FORMAT: MachinePart = {
  world: {
    verbs: ["format"],
    extends: [
      { kind: ["kinds", "ops", "fallback"], verbs: { format: "format.terms" } },
      { kind: ["kinds", "lit"], verbs: { format: "format.lit" } },
    ],
  },
  evaluators: { "format.terms": terms, "format.lit": ({ doc }) => ok(JSON.stringify(doc.value)) },
};

/* The harness: each composed machine must agree with the reference interpreter, on given and generated documents. */

const NAMES: Readonly<Record<string, unknown>> = { x: 2, s: "ab", f: (value: unknown) => value };
const HOST: Context = context({ names: NAMES, caps: ["log"] });
const FORMULA_AGREE: AgreeOptions = { definitions: DEFINITIONS, declaredType: "lit", strict: true };

function verdict(machine: Machine, item: unknown, options: AgreeOptions): string {
  const outcome = agree(machine, item, HOST, options);
  return outcome.ok ? "agrees" : `${outcome.tier}: ${outcome.reason}`;
}

function agreesOn(machine: Machine, docs: readonly Json[], options: AgreeOptions = FORMULA_AGREE): void {
  for (const item of docs) expect(verdict(machine, item, options), JSON.stringify(item)).toBe("agrees");
}

/** This function generates documents for a machine, and gives the number that evaluate to a value. Each one must agree. */
function agreesOnGenerated(machine: Machine, options: Omit<GenerateOptions, "seed">, agreeOptions: AgreeOptions, count = 200): number {
  let values = 0;
  for (let seed = 0; seed < count; seed += 1) {
    const item = generate(machine.world, { ...options, seed });
    const outcome = agree(machine, item, HOST, agreeOptions);
    expect(outcome.ok ? "agrees" : `${outcome.tier}: ${outcome.reason}`, `seed ${seed}`).toBe("agrees");
    if (outcome.ok && outcome.result.ok) values += 1;
  }
  return values;
}

/** The options of `generate` for a formula machine. A namespace with a fallback needs its keys in the types. */
function formulaOptions(machine: Machine, ops: readonly string[]): Omit<GenerateOptions, "seed"> {
  return {
    declaredType: "lit",
    names: Object.keys(NAMES),
    types: [...typesOf(machine.world), ...["add", "mul", "nope", ...ops].map((key) => ["ops", key]), ["ext", "number"], ["ext", "undefined"]],
    hints: (type, path) => (type[0] === "call" && path[0] === "fn" ? [["fn"], ["ref"]] : undefined),
  };
}

function conflictsOf(merge: () => unknown): readonly MergeConflict[] {
  try {
    merge();
  } catch (error) {
    if (error instanceof MergeError) return error.conflicts;
    throw error;
  }
  return [];
}

/** Two machines are the same when their worlds are equal and each evaluator name has the same code. */
function sameMachine(a: Machine, b: Machine): boolean {
  const names = Object.keys(a.evaluators);
  return docEquals(a.world, b.world) && names.length === Object.keys(b.evaluators).length && names.every((key) => a.evaluators[key] === b.evaluators[key]);
}

describe("the composition checklist", () => {
  it("[COMPOSE.EXTEND] a language extends the base with new kinds and operations, and the base does not know the extension", () => {
    const stats = mergeMachines(BASE, STATS);
    // The new kinds, the alias and the new operation evaluate beside the kit and its operations.
    expect(prepare(stats, doc("mean", [1, 2, 6])).evaluate()).toEqual(ok(3));
    expect(prepare(stats, doc("avg", [op("add", 1, 2), 5])).evaluate()).toEqual(ok(4));
    expect(prepare(stats, op("twice", op("mul", 2, 3))).evaluate()).toEqual(ok(12));
    const local = { type: "let", value: { bind: { m: doc("mean", [name("x"), 4]) }, body: op("twice", name("m")) } };
    expect(prepare(stats, local).evaluate(HOST)).toEqual(ok(6));
    // check knows the kinds of the extension, and the hook of the kit still names an unknown operation.
    expect(check(stats, local, { declaredType: "lit", names: ["x"] })).toEqual([]);
    expect(check(stats, op("nope", 1), { declaredType: "lit" }).map((issue) => issue.reason)).toEqual(["The language has no operation nope."]);
    agreesOn(stats, [doc("mean", [1, 2, 6]), doc("avg", [op("add", 1, 2), 5]), op("twice", op("mul", 2, 3)), local, doc("mean", []), op("twice", "a")]);
    // formulaMachine with the extension gives the same world and the same evaluator names.
    const direct = formulaMachine(PROFILE, STATS);
    expect(docEquals(direct.world, stats.world)).toBe(true);
    expect(Object.keys(direct.evaluators).sort()).toEqual(Object.keys(stats.evaluators).sort());
    // The base does not change, and it does not know the kinds of the extension.
    expect(check(BASE, doc("mean", [1]), { declaredType: "lit" }).map((issue) => issue.code)).toEqual(["#KIND?"]);
    expect(prepare(BASE, op("twice", 1)).evaluate()).toMatchObject({ ok: false, error: { code: "#NAME?", reason: "The language has no operation twice." } });
  });

  it("[COMPOSE.RESTRICT] a language removes kinds and their code, closes a namespace, or narrows a position or the capabilities", () => {
    // A total language: the kit without fn and call. Without functions, each document stops, as in JsonLogic.
    const total = restrictMachine(BASE, [["world", "kinds", "fn"], ["world", "kinds", "call"], ["evaluators", "formula.fn"], ["evaluators", "formula.call"]]);
    const fnDoc = { type: "fn", value: { params: ["x"], body: name("x") } };
    expect(check(total, fnDoc)).toEqual([{ code: "#KIND?", place: [], reason: "The world has no kind fn.", at: [] }]);
    expect(prepare(total, fnDoc).evaluate()).toMatchObject({ ok: false, error: { code: "#KIND?" } });
    expect(prepare(total, op("add", 1, 2)).evaluate()).toEqual(ok(3));
    agreesOn(total, [op("add", 1, 2), fnDoc, { type: "if", value: { test: true, then: op("mul", 2, 3) } }]);
    expect(agreesOnGenerated(total, formulaOptions(total, []), FORMULA_AGREE, 100)).toBeGreaterThan(10);
    // The base does not change.
    expect(prepare(BASE, { type: "call", value: { fn: fnDoc, args: [5] } }).evaluate()).toEqual(ok(5));
    // An own entry names an evaluator directly. Thus a restriction of the world alone keeps the code of call.
    const viaOwn = { type: "record", own: { eval: "formula.call" }, value: { fn: name("f") } };
    const worldOnly = restrictMachine(BASE, [["world", "kinds", "fn"], ["world", "kinds", "call"]]);
    expect(prepare(worldOnly, viaOwn).evaluate(context({ names: { f: () => 42 } }))).toEqual(ok(42));
    expect(check(total, viaOwn, { names: ["f"] }).map((issue) => issue.code)).toEqual(["#NOEVAL"]);
    expect(prepare(total, viaOwn).evaluate(context({ names: { f: () => 42 } }))).toMatchObject({ ok: false, error: { code: "#NOEVAL" } });
    // Fewer operations: the namespace ops loses its fallback, and it gets back only add.
    const onlyAdd = mergeMachines(restrictMachine(BASE, [["world", "kinds", "ops", "fallback"]]), { world: { kinds: { ops: { kinds: { add: OP_KIND } } } } });
    expect(prepare(onlyAdd, op("add", 1, 2)).evaluate()).toEqual(ok(3));
    expect(check(onlyAdd, op("mul", 1, 2)).map((issue) => issue.reason)).toEqual(["The world has no kind ops.mul."]);
    agreesOn(onlyAdd, [op("add", 1, 2), op("mul", 1, 2)]);
    // Fewer kinds at one position: the terms of sum permit only literals and operations (SHAPE.KINDS).
    const sum: EvalFn = ofValues((values) => (values.every(isNumber) ? ok(values.reduce((a, b) => a + b, 0)) : fail("#VALUE!", "sum needs numbers.")));
    const narrow = mergeMachines(BASE, {
      world: { kinds: { sum: { verbs: { eval: "safe.sum" }, parts: { shape: "list", of: "lit", item: { shape: "term", of: "lit", kinds: [["lit"], ["ops"]] } } } } },
      evaluators: { "safe.sum": sum },
    });
    expect(prepare(narrow, doc("sum", [1, op("add", 1, 1)])).evaluate()).toEqual(ok(3));
    const nested = doc("sum", [1, { type: "let", value: { bind: {}, body: 2 } }]);
    expect(check(narrow, nested).map((issue) => [issue.code, issue.reason])).toEqual([["#VALUE!", "The kind let is not permitted here. The permitted kinds are lit, ops. (at 1) The kind is sum."]]);
    agreesOn(narrow, [doc("sum", [1, op("add", 1, 1)]), nested]);
    // Fewer capabilities for a part: the rule mask gives the part of quiet no capabilities (CAP.CONTRACT).
    const caps = mergeMachines(BASE, {
      world: { kinds: { log: { verbs: { eval: "io.log" }, parts: { shape: "term", of: "lit" }, effects: ["log"] }, quiet: { verbs: { eval: "io.quiet" }, parts: { shape: "term", of: "lit" }, caps: [{ rule: "mask" }] } } },
      evaluators: { "io.log": ({ parts, effect }) => effect("log", valuesOf(parts)), "io.quiet": ofValues(([value]) => ok(value)) },
    });
    expect(check(caps, doc("log", 1), { caps: ["log"] })).toEqual([]);
    expect(check(caps, doc("quiet", doc("log", 1)), { caps: ["log"] }).map((issue) => issue.code)).toEqual(["#CAP!"]);
    expect(prepare(caps, doc("quiet", doc("log", 1))).evaluate(HOST)).toMatchObject({ ok: false, error: { code: "#CAP!" } });
    agreesOn(caps, [doc("log", 1), doc("quiet", doc("log", 1))]);
  });

  /* Two independent languages, each with its own small world. They share one kind and its code, and glue joins them. */

  const show: EvalFn = ofValues(([value]) => (typeof value === "string" || isNumber(value) ? ok(String(value)) : fail("#VALUE!", "show needs a text or a number.")));
  const SHOW: Kind = { verbs: { eval: "shared.show" }, parts: { shape: "term" }, summary: "Its term as a text." };
  const NUMBERS: MachinePart = {
    world: {
      kinds: {
        num: { verbs: { eval: "num.value" }, parts: { shape: "number" }, summary: "A number." },
        sum: { verbs: { eval: "num.sum" }, parts: { shape: "list", of: "num" }, summary: "The sum of its numbers." },
        show: SHOW,
      },
    },
    evaluators: {
      "num.value": ({ data }) => ok(data),
      "num.sum": ofValues((values) => (values.every(isNumber) ? ok(values.reduce((a, b) => a + b, 0)) : fail("#VALUE!", "sum needs numbers."))),
      "shared.show": show,
    },
  };
  const TEXTS: MachinePart = {
    world: {
      kinds: {
        str: { verbs: { eval: "str.value" }, parts: { shape: "text" }, summary: "A text." },
        concat: { verbs: { eval: "str.concat" }, parts: { shape: "list", of: "str" }, summary: "Its texts as one text." },
        show: { ...SHOW },
      },
    },
    evaluators: {
      "str.value": ({ data }) => ok(data),
      "str.concat": ofValues((values) => (values.every((value) => typeof value === "string") ? ok(values.join("")) : fail("#VALUE!", "concat needs texts."))),
      "shared.show": show,
    },
  };
  // The glue: an alias, and a kind that reads a text and gives a number. Its part declares the type str.
  const GLUE: MachinePart = {
    world: { kinds: { plus: alias("sum"), len: { verbs: { eval: "glue.len" }, parts: { shape: "term", of: "str" }, summary: "The length of its text." } } },
    evaluators: { "glue.len": ofValues(([value]) => (typeof value === "string" ? ok(value.length) : fail("#VALUE!", "len needs a text."))) },
  };
  const MIXED = doc("concat", ["n=", doc("show", doc("plus", [1, doc("len", "abc")]))]);

  it("[COMPOSE.UNIFY] two independent languages merge, their equal kinds give one entry, and glue joins them", () => {
    const unified = mergeMachines(NUMBERS, TEXTS, GLUE);
    // The shared kind is one entry, and the shared evaluator is one function.
    expect(unified.world.kinds["show"]).toBe(SHOW);
    expect(unified.evaluators["shared.show"]).toBe(show);
    expect(sameMachine(mergeMachines(TEXTS, NUMBERS, GLUE), unified)).toBe(true);
    // One document uses both languages through the glue.
    expect(prepare(unified, MIXED).evaluate()).toEqual(ok("n=4"));
    expect(check(unified, MIXED)).toEqual([]);
    expect(check(unified, doc("concat", [doc("len", "abc")])).map((issue) => issue.code)).toEqual([]);
    expect(prepare(unified, doc("concat", [doc("len", "abc")])).evaluate()).toMatchObject({ ok: false, error: { code: "#VALUE!" } });
    // Without the glue, the languages do not know each other.
    expect(check(mergeMachines(NUMBERS, TEXTS), MIXED).map((issue) => issue.reason)).toEqual(["The world has no kind plus."]);
    const plain: AgreeOptions = { strict: true };
    agreesOn(unified, [MIXED, doc("show", doc("sum", [1, 2])), doc("concat", ["a", doc("show", "b")]), doc("show", doc("concat", []))], plain);
    const data = (type: readonly Key[], rng: { pick<T>(items: readonly T[]): T }): Json | undefined => (type[0] === "num" ? rng.pick([0, 1, 7]) : type[0] === "str" ? rng.pick(["", "a", "bc"]) : undefined);
    expect(agreesOnGenerated(unified, { data }, plain)).toBeGreaterThan(20);
  });

  // K41 (D46): equal profiles give the same evaluators and hooks of the kit. A function is equal only to itself (D17).
  it("[COMPOSE.UNIFY] two languages that each build the formula kit with one profile merge", () => {
    const unified = mergeMachines(formulaMachine(PROFILE, STATS), formulaMachine(PROFILE, TEXT));
    expect(sameMachine(unified, mergeMachines(BASE, STATS, TEXT))).toBe(true);
    expect(sameMachine(mergeMachines(formulaMachine(PROFILE, TEXT), formulaMachine(PROFILE, STATS)), unified)).toBe(true);
    agreesOn(unified, [op("join", doc("upper", "ab"), op("twice", 3))]);
    expect(prepare(unified, op("join", doc("upper", "ab"), op("twice", doc("mean", [1, 5])))).evaluate()).toEqual(ok("AB6"));
    // The kit gives one hook known. Thus the merged machine names an unknown operation one time.
    expect(unified.known).toBe(BASE.known);
    expect(unified.facts).toBe(BASE.facts);
    expect(check(unified, op("nope", 1), { declaredType: "lit" }).map((issue) => issue.reason)).toEqual(["The language has no operation nope."]);
    // A profile in a new object with the same fields gives the same kit, also with a key that the kit does not read.
    const copy = { ...PROFILE, note: "a key of the host" } as typeof PROFILE;
    expect(sameMachine(mergeMachines(formulaMachine(copy, STATS), formulaMachine(PROFILE, TEXT)), unified)).toBe(true);
    expect(formulaEvaluators(PROFILE)["formula.op"]).toBe(BASE.evaluators["formula.op"]);
    expect(formulaEvaluators(PROFILE)).not.toBe(formulaEvaluators(PROFILE));
    expect(Object.isFrozen(BASE.evaluators["formula.op"])).toBe(true);
  });

  it("[COMPOSE.UNIFY] two profiles with different fields give different kits, and their machines conflict", () => {
    const kitNames = Object.keys(formulaEvaluators(PROFILE)).sort();
    const conflictNames = (other: Parameters<typeof formulaMachine>[0]): string[] =>
      conflictsOf(() => mergeMachines(formulaMachine(PROFILE, STATS), formulaMachine(other, TEXT)))
        .map((item) => (item.path[0] === "evaluators" ? String(item.path[1]) : JSON.stringify(item.path)))
        .sort();
    // A rule of the language differs.
    expect(conflictNames({ ...PROFILE, logic: "value" })).toEqual(kitNames);
    // A function is equal only to itself: an equal truth function and a record with the same operations differ.
    expect(conflictNames({ ...PROFILE, truthy: (value) => value === true })).toEqual(kitNames);
    expect(conflictNames({ ops: { ...PROFILE.ops } })).toEqual(kitNames);
    // An own otherwise with the value undefined differs from no otherwise.
    expect(conflictNames({ ...PROFILE, otherwise: undefined })).toEqual(kitNames);
    // Two lists are equal by their items.
    expect(conflictNames({ ...PROFILE, pure: ["add"] })).toEqual(kitNames);
    expect(conflictsOf(() => mergeMachines(formulaMachine({ ...PROFILE, pure: ["add"] }), formulaMachine({ ...PROFILE, pure: ["add"] })))).toEqual([]);
    // The mark pureExt is a field of the canonical form too (D47). A profile with it gives other facts and folds.
    const ext = { tag: () => ok("t") };
    const unmarked = formulaMachine({ ext });
    const marked = formulaMachine({ ext, pureExt: ["tag"] });
    expect(conflictsOf(() => mergeMachines(unmarked, marked)).map((item) => String(item.path[1])).sort()).toEqual(kitNames);
    expect(marked.facts).not.toBe(unmarked.facts);
    expect(marked.evaluators["formula.ext"]).not.toBe(unmarked.evaluators["formula.ext"]);
    expect([unmarked.facts?.(["ext", "tag"], "formula.ext"), marked.facts?.(["ext", "tag"], "formula.ext")]).toEqual([{ pure: false }, { pure: true }]);
    expect(conflictsOf(() => mergeMachines(formulaMachine({ ext, pureExt: ["tag"] }), formulaMachine({ ext, pureExt: ["tag"] })))).toEqual([]);
    // The replacement of the kit of one language still resolves each conflict.
    const other = formulaMachine({ ...PROFILE, otherwise: "none" }, TEXT);
    const replaced = mergeMachines(formulaMachine(PROFILE, STATS), { ...other, replaces: kitNames.map((key) => ["evaluators", key]) });
    expect(prepare(replaced, { type: "if", value: { test: false, then: 1 } }).evaluate()).toEqual(ok("none"));
  });

  it("[COMPOSE.UNIFY] a change of a field of a profile object gives a new kit, and an old machine keeps its kit", () => {
    const profile: { ops: typeof PROFILE.ops; otherwise?: unknown; pure: string[] } = { ops: PROFILE.ops, pure: ["add"] };
    const before = formulaMachine(profile);
    expect(formulaMachine(profile).evaluators["formula.if"]).toBe(before.evaluators["formula.if"]);
    profile.otherwise = "none";
    const after = formulaMachine(profile);
    expect(after.evaluators["formula.if"]).not.toBe(before.evaluators["formula.if"]);
    const open = { type: "if", value: { test: false, then: 1 } };
    expect(prepare(before, open).evaluate()).toEqual(ok(null));
    expect(prepare(after, open).evaluate()).toEqual(ok("none"));
    // A list is a copy in the canonical form, thus a change in place gives a new kit too.
    profile.pure.push("mul");
    expect(formulaMachine(profile).facts).not.toBe(after.facts);
    // A profile object keeps its kit while it lives, also after many other profiles.
    for (let index = 0; index < 40; index += 1) formulaMachine({ ...PROFILE, otherwise: index });
    expect(formulaMachine(PROFILE).evaluators["formula.op"]).toBe(BASE.evaluators["formula.op"]);
  });

  it("[COMPOSE.SELF-EXTEND] a host adds kinds that a document gives as data, and a document alone cannot bring code", () => {
    // The kinds of a language are JSON. A document can give them when each verb names an evaluator of the machine.
    const given = JSON.parse(
      JSON.stringify({ kinds: { plus: alias("ops", "add"), pair: { verbs: { eval: "formula.list" }, parts: { shape: "list", of: "lit" }, summary: "Its terms." } } }),
    ) as WorldPart;
    const machine = mergeMachines(BASE, { world: given });
    expect(prepare(machine, doc("plus", [1, 2])).evaluate()).toEqual(ok(3));
    expect(prepare(machine, doc("pair", [1, doc("plus", [1, 1])])).evaluate()).toEqual(ok([1, 2]));
    expect(check(machine, doc("pair", [1, doc("plus", [1, 1])]))).toEqual([]);
    agreesOn(machine, [doc("plus", [1, 2]), doc("pair", [1, doc("plus", [1, 1])]), doc("plus", ["a"])]);
    // In one document, let, fn and call give a name to a function. This is an abstraction, not a new kind.
    const local = { type: "let", value: { bind: { double: { type: "fn", value: { params: ["x"], body: op("add", name("x"), name("x")) } } }, body: { type: "call", value: { fn: name("double"), args: [3] } } } };
    expect(prepare(BASE, local).evaluate()).toEqual(ok(6));
    expect(check(BASE, local)).toEqual([]);
    agreesOn(BASE, [local]);
    // A document cannot bring code. An own entry names an evaluator of the machine, and an unknown name gives #NOEVAL.
    const own = { type: "list", own: { eval: "lang.double" }, value: [3] };
    expect(check(BASE, own)).toEqual([{ code: "#NOEVAL", place: [], reason: "No rung gives an evaluator for list.", at: [] }]);
    expect(prepare(BASE, own).evaluate()).toMatchObject({ ok: false, error: { code: "#NOEVAL" } });
    agreesOn(BASE, [own]);
  });

  // Target, skipped: K40. A language that is only data: its kinds are JSON, and its evaluator is a formula document
  // (D1). Today an evaluator is code: a function or a compiler. The run gives #CALC! for an evaluator that is a document.
  it.skip("[COMPOSE.SELF-EXTEND] target (K40): a language defines a kind and its evaluator by documents only", () => {
    const part = JSON.parse(
      JSON.stringify({
        world: { kinds: { double: { verbs: { eval: "doc.double" }, parts: { shape: "list", of: "lit" } } } },
        evaluators: { "doc.double": { type: "fn", value: { params: ["x"], body: op("add", name("x"), name("x")) } } },
      }),
    ) as MachinePart;
    const machine = mergeMachines(BASE, part);
    expect(prepare(machine, doc("double", [3])).evaluate()).toEqual(ok(6));
    expect(check(machine, doc("double", [op("add", 1, 2)]))).toEqual([]);
    agreesOn(machine, [doc("double", [3]), doc("double", [op("add", 1, 2)])]);
  });

  it("[COMPOSE.EXTEND-UNIFY] two independent extensions of one base compose without glue, in each order", () => {
    const both = mergeMachines(BASE, STATS, TEXT);
    // The order of the parts does not change the machine (WORLD.LAWS).
    expect(sameMachine(mergeMachines(BASE, TEXT, STATS), both)).toBe(true);
    expect(sameMachine(mergeMachines(TEXT, STATS, BASE), both)).toBe(true);
    // Both extensions add to the namespace ops of the kit, and its fallback stays.
    for (const key of ["twice", "join", "add", "anything"]) expect(lookupKind(both.world, ["ops", key]).ok, key).toBe(true);
    const mixed = op("join", doc("upper", name("s")), "=", op("twice", doc("mean", [1, op("add", 2, 3)])));
    expect(prepare(both, mixed).evaluate(HOST)).toEqual(ok("AB=6"));
    expect(check(both, mixed, { declaredType: "lit", names: ["s"] })).toEqual([]);
    agreesOn(both, [mixed, doc("upper", doc("mean", [1])), op("join", op("nope"))]);
    expect(agreesOnGenerated(both, formulaOptions(both, ["twice", "join"]), FORMULA_AGREE)).toBeGreaterThan(20);
  });

  it("[COMPOSE.INCREMENTAL] a language extends an extension at run time, reaches the entry that it replaces, and new plans use it", () => {
    const stats = mergeMachines(BASE, STATS);
    const plan = prepare(stats, doc("avg", [1, 2]));
    expect(plan.evaluate()).toEqual(ok(1.5));
    // A third language extends the statistics. It wraps the evaluator of mean that it replaces (prev).
    const rounded = (prev: Machine): MachinePart => {
      const earlier = prev.evaluators["stats.mean"] as EvalFn;
      return {
        world: { kinds: { mean: { ...(prev.world.kinds["mean"] as Kind), summary: "The mean of its terms, rounded." } } },
        evaluators: {
          "stats.mean": (input) => {
            const result = earlier(input);
            return result.ok && isNumber(result.value) ? ok(Math.round(result.value)) : result;
          },
        },
        replaces: [["world", "kinds", "mean"], ["evaluators", "stats.mean"]],
      };
    };
    const later = mergeMachines(stats, rounded);
    expect(prepare(later, doc("avg", [1, 2])).evaluate()).toEqual(ok(2));
    expect((later.world.kinds["mean"] as Kind).summary).toBe("The mean of its terms, rounded.");
    // A plan keeps the machine that it compiled against. The earlier machine does not change.
    expect(plan.machine).toBe(stats);
    expect(plan.evaluate()).toEqual(ok(1.5));
    expect(prepare(stats, doc("mean", [1, 2])).evaluate()).toEqual(ok(1.5));
    // Without replaces, the same wrap is a conflict.
    expect(conflictsOf(() => mergeMachines(stats, (prev) => ({ ...rounded(prev), replaces: [] }))).map((item) => item.path)).toEqual([
      ["world", "kinds", "mean"],
      ["evaluators", "stats.mean"],
    ]);
    // A language added at run time: an old plan of its kind gives #KIND?, and a new plan compiles against it.
    const upperDoc = doc("upper", doc("show", "x"));
    expect(prepare(later, doc("upper", "ab")).evaluate()).toMatchObject({ ok: false, error: { code: "#KIND?" } });
    const grown = mergeMachines(later, TEXT);
    expect(prepare(grown, doc("upper", "ab")).evaluate()).toEqual(ok("AB"));
    expect(check(grown, op("join", doc("avg", [1, 2]), doc("upper", "ab")))).toEqual([]);
    expect(check(grown, upperDoc).map((issue) => issue.reason)).toEqual(["The world has no kind show."]);
    agreesOn(grown, [op("join", doc("avg", [1, 2]), doc("upper", "ab")), doc("mean", [1, 2, 2]), upperDoc]);
  });

  it("[COMPOSE.EXTEND-VERB] a language adds a verb that it owns to the kinds of other languages, and it copies no kind", () => {
    const op = ["kinds", "ops", "fallback"];
    const add = { type: ["ops", "add"], value: [1, 2] };
    const machine = mergeMachines(BASE, FORMAT);
    expect(prepare(machine, add, { verb: "format" }).evaluate()).toEqual(ok("(1, 2)"));
    // The verb eval of the kind and the base do not change, and the result of the merge has no marks.
    expect(prepare(machine, add).evaluate()).toEqual(ok(3));
    expect((formulaKinds()["ops"] as Namespace).fallback?.verbs["format"]).toBeUndefined();
    expect(BASE.world).not.toHaveProperty("verbs");
    expect(machine.world).not.toHaveProperty("extends");
    expect(machine.world).not.toHaveProperty("verbs");
    // The order of the parts does not change the machine, and two equal parts give one entry.
    expect(sameMachine(mergeMachines(FORMAT, BASE), machine)).toBe(true);
    expect(sameMachine(mergeMachines(BASE, FORMAT, FORMAT), machine)).toBe(true);
    expect(mergeWorlds(FORMAT.world as WorldPart, BASE.world)).toEqual(machine.world);
    // A path reaches a kind at each depth, and the fallback of the world.
    const stats = mergeMachines(BASE, STATS, {
      world: {
        verbs: ["format"],
        extends: [
          { kind: ["kinds", "mean"], verbs: { format: "format.terms" } },
          { kind: ["kinds", "ops", "kinds", "twice"], verbs: { format: "format.terms" } },
        ],
      },
      evaluators: { "format.terms": terms },
    });
    expect(kindAt(stats.world, ["mean"])?.verbs).toEqual({ eval: "stats.mean", format: "format.terms" });
    expect(kindAt(stats.world, ["ops", "twice"])?.verbs).toEqual({ eval: "stats.twice", format: "format.terms" });
    const open = mergeWorlds({ fallback: { verbs: { eval: "a" } } }, { verbs: ["format"], extends: [{ kind: ["fallback"], verbs: { format: "b" } }] });
    expect(open.fallback?.verbs).toEqual({ eval: "a", format: "b" });
    // Two languages with one verb each add to one kind, and a function part reads the entries before it.
    const size: WorldPart = { verbs: ["size"], extends: [{ kind: op, verbs: { size: "size.op" } }] };
    const both = mergeWorlds(BASE.world, FORMAT.world as WorldPart, size, (prev) => {
      expect((prev.kinds["ops"] as Namespace).fallback?.verbs).toMatchObject({ format: "format.terms", size: "size.op" });
      return {};
    });
    expect(Object.keys((both.kinds["ops"] as Namespace).fallback?.verbs ?? {})).toEqual([...Object.keys(OP_KIND.verbs), "format", "size"]);
    // A part needs no ownership for a kind that it gives.
    const here = { kinds: { mine: { verbs: { eval: "a" } } }, extends: [{ kind: ["kinds", "mine"], verbs: { view: "b" } }] };
    expect(kindAt(mergeWorlds(here), ["mine"])?.verbs).toEqual({ eval: "a", view: "b" });
  });

  it("[COMPOSE.PIRACY] a foreign verb on a foreign kind is a conflict, and each conflict of an entry has its mark", () => {
    const path = ["world", "kinds", "ref", "verbs", "format"];
    const entry = { kind: ["kinds", "ref"], verbs: { format: "rival.format" } };
    const pirate: MachinePart = { world: { extends: [entry] } };
    expect(conflictsOf(() => mergeMachines(BASE, pirate))).toEqual([{ path, parts: [0, 1], reason: "A part adds a verb that it does not own to a kind that it does not give." }]);
    // Another part that owns the verb does not make the entry legal.
    expect(conflictsOf(() => mergeMachines(BASE, FORMAT, pirate)).map((item) => item.path)).toEqual([path]);
    // The mark replaces says that the language knows what it takes.
    expect(kindAt(mergeMachines(BASE, FORMAT, { world: { extends: [entry], replaces: [path.slice(1)] } }).world, ["ref"])?.verbs["format"]).toBe("rival.format");
    // The kernel owns its verbs.
    const kernel = { verbs: ["eval"], extends: [{ kind: ["kinds", "ref"], verbs: { eval: "rival.eval" } }] };
    expect(conflictsOf(() => mergeMachines(BASE, { world: kernel })).map((item) => [item.path, item.reason])).toEqual([
      [["world", "verbs", "eval"], "The kernel owns this verb."],
      [["world", "kinds", "ref", "verbs", "eval"], "Two parts give two different evaluators for this verb of this kind."],
    ]);
    const taken = { ...kernel, replaces: [["verbs", "eval"], ["kinds", "ref", "verbs", "eval"]] };
    expect(kindAt(mergeMachines(BASE, { world: taken }).world, ["ref"])?.verbs["eval"]).toBe("rival.eval");
    // Two different parts do not own one verb, in each order.
    const other: WorldPart = { verbs: ["format"], extends: [{ kind: ["kinds", "ref"], verbs: { format: "format.terms" } }] };
    const owners = { path: ["verbs", "format"], parts: [0, 1], reason: "Two parts own this verb." };
    expect(conflictsOf(() => mergeWorlds(BASE.world, other, FORMAT.world as WorldPart))).toContainEqual({ ...owners, parts: [1, 2] });
    expect(conflictsOf(() => mergeWorlds(FORMAT.world as WorldPart, other))).toContainEqual(owners);
    expect(conflictsOf(() => mergeWorlds(other, FORMAT.world as WorldPart))).toContainEqual(owners);
    // Two entries for one verb of one kind conflict, and the mark of the later part gives its evaluator.
    const rival = { ...other, extends: [{ kind: ["kinds", "ops", "fallback"], verbs: { format: "rival.format" } }] };
    const verb = ["kinds", "ops", "fallback", "verbs", "format"];
    const twice: readonly WorldPart[] = [BASE.world, FORMAT.world as WorldPart, { ...rival, replaces: [["verbs", "format"]] }];
    expect(conflictsOf(() => mergeWorlds(...twice))).toEqual([{ path: verb, parts: [1, 2], reason: "Two parts give two different evaluators for this verb of this kind." }]);
    const later = mergeWorlds(...twice.slice(0, 2), { ...rival, replaces: [["verbs", "format"], verb] });
    expect((later.kinds["ops"] as Namespace).fallback?.verbs["format"]).toBe("rival.format");
    // An entry for a path without a kind is a conflict, and the mark drops the entry. An alias is not a kind.
    for (const kind of [["kinds", "nope"], ["kinds", "ops", "kinds", "nope"], ["kinds", "nope", "kinds", "x"], ["fallback"], ["defaults"], []]) {
      const lost = [...kind, "verbs", "format"];
      expect(conflictsOf(() => mergeWorlds(BASE.world, { verbs: ["format"], extends: [{ kind, verbs: { format: "a" } }] })).map((item) => [item.path, item.reason])).toEqual([[lost, "A part adds a verb to a path without a kind."]]);
      expect(mergeWorlds(BASE.world, { verbs: ["format"], extends: [{ kind, verbs: { format: "a" } }], replaces: [lost] })).toEqual(BASE.world);
    }
    const alias: WorldPart = { kinds: { other: { type: "ref", value: ["kinds", "ref"] } }, verbs: ["format"], extends: [{ kind: ["kinds", "other"], verbs: { format: "a" } }] };
    expect(conflictsOf(() => mergeWorlds(BASE.world, alias)).map((item) => item.reason)).toEqual(["A part adds a verb to a path without a kind."]);
    // A key of the prototype stays an own entry.
    const proto = JSON.parse('{ "verbs": { "__proto__": "a" } }') as { readonly verbs: Readonly<Record<string, string>> };
    const odd = mergeWorlds(BASE.world, { verbs: ["__proto__"], extends: [{ kind: ["kinds", "ref"], verbs: proto.verbs }] });
    expect(Object.getOwnPropertyDescriptor(kindAt(odd, ["ref"])?.verbs, "__proto__")?.value).toBe("a");
  });

  it("[COMPOSE.CONFLICT] two extensions that each compose with the base can conflict, and the error lists each path for replaces", () => {
    const median: EvalFn = ofValues((values) => {
      if (values.length === 0 || !values.every(isNumber)) return fail("#VALUE!", "median needs one number or more.");
      const sorted = [...values].sort((a, b) => a - b);
      return ok(sorted[Math.floor(sorted.length / 2)]);
    });
    const thrice: EvalFn = ofValues(([value]) => (isNumber(value) ? ok(value * 3) : fail("#VALUE!", "twice needs a number.")));
    const RIVAL: MachinePart = {
      world: {
        kinds: {
          mean: { verbs: { eval: "rival.median" }, parts: { shape: "list", of: "lit" }, summary: "The median of its terms." },
          ops: { kinds: { twice: { verbs: { eval: "stats.twice" }, parts: { shape: "list", of: "lit" }, summary: "Three times its term." } } },
        },
      },
      evaluators: { "rival.median": median, "stats.twice": thrice },
    };
    // Each extension composes with the base alone.
    expect(prepare(mergeMachines(BASE, STATS), doc("mean", [1, 5, 6])).evaluate()).toEqual(ok(4));
    expect(prepare(mergeMachines(BASE, RIVAL), doc("mean", [1, 5, 6])).evaluate()).toEqual(ok(5));
    // Together they conflict. The host gets one error when it builds the machine, before a document exists.
    expect(() => mergeMachines(BASE, STATS, RIVAL)).toThrow(MergeError);
    expect(() => mergeMachines(BASE, STATS, RIVAL)).toThrow(/^The merge has 3 conflicts\./);
    const conflicts = conflictsOf(() => mergeMachines(BASE, STATS, RIVAL));
    expect(conflicts).toEqual([
      { path: ["world", "kinds", "mean"], parts: [1, 2], reason: "Two parts give two different kinds." },
      { path: ["world", "kinds", "ops", "kinds", "twice"], parts: [1, 2], reason: "Two parts give two different kinds." },
      { path: ["evaluators", "stats.twice"], parts: [1, 2], reason: "Two parts give two different evaluators for this name." },
    ]);
    // The paths of the conflicts are the marks replaces of the later part. Then the later part wins at each path.
    const resolved = mergeMachines(BASE, STATS, { ...RIVAL, replaces: conflicts.map((item) => item.path) });
    expect(prepare(resolved, doc("avg", [1, 5, 6])).evaluate()).toEqual(ok(5));
    expect(prepare(resolved, op("twice", 2)).evaluate()).toEqual(ok(6));
    agreesOn(resolved, [doc("avg", [1, 5, 6]), op("twice", 2), doc("mean", [])]);
    // A mark on the earlier part does not replace a later entry, thus the order matters only with replaces.
    expect(conflictsOf(() => mergeMachines(BASE, { ...RIVAL, replaces: conflicts.map((item) => item.path) }, STATS))).toHaveLength(3);
  });
});
