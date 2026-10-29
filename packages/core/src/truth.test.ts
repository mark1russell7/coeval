import { describe, expect, it } from "vitest";
import { type FormulaProfile, type Issue, type Json, type Machine, type OpFn, type Random, type Result, type Signature, type ValueType, check, evaluate, formulaMachine, member, random, typeCheck } from "./index.ts";

/*
 * K50: the declared type of a truth for an own truthy (D81).
 */

/** The number of documents of the property. CI and a nightly run can raise it with COEVAL_AGREE_COUNT. */
const COUNT = Number(process.env["COEVAL_AGREE_COUNT"] ?? 300);
const SEED = Number(process.env["COEVAL_AGREE_SEED"] ?? 1);

const LIT = { declaredType: "lit" } as const;
const op = (name: string, ...args: Json[]): Json => ({ type: ["ops", name], value: args });
const ref = (...path: Json[]): Json => ({ type: "ref", value: path });
const when = (test: Json, then: Json, other?: Json): Json => ({ type: "if", value: other === undefined ? { test, then } : { test, then, else: other } });
const bind = (names: Readonly<Record<string, Json>>, body: Json): Json => ({ type: "let", value: { bind: names, body } });
const and = (...terms: Json[]): Json => ({ type: "and", value: terms });
const or = (...terms: Json[]): Json => ({ type: "or", value: terms });

/** The signatures of a small language. */
const SIGS: Readonly<Record<string, Signature>> = {
  add: { params: ["number", "number"], to: "number" },
  gt: { params: ["number", "number"], to: "bool" },
  concat: { params: ["text"], rest: "text", to: "text" },
  not: { params: ["bool"], to: "bool" },
};

/** The operations. Each one fails for arguments outside its signature, thus it keeps its signature. */
const OPS: Readonly<Record<string, OpFn>> = {
  add: (a, b) => {
    if (typeof a !== "number" || typeof b !== "number") throw new Error("add takes two numbers.");
    return a + b;
  },
  gt: (a, b) => {
    if (typeof a !== "number" || typeof b !== "number") throw new Error("gt takes two numbers.");
    return a > b;
  },
  concat: (...items) => {
    if (items.length === 0 || items.some((item) => typeof item !== "string")) throw new Error("concat takes texts.");
    return items.join("");
  },
  not: (value) => {
    if (typeof value !== "boolean") throw new Error("not takes a truth value.");
    return !value;
  },
};

/** The truth of a language with numbers as truths: `0` is false, and each other number is true. A text has no truth. */
const numberTruthy = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : typeof value === "number" ? value !== 0 : undefined);

/** The declared type of the truths of `numberTruthy`. */
const TRUTH: ValueType = { union: ["bool", "number"] };

const BASE: FormulaProfile = { ops: OPS, sigs: SIGS };
const declared = formulaMachine({ ...BASE, truthy: numberTruthy, truthType: TRUTH });
const undeclared = formulaMachine({ ...BASE, truthy: numberTruthy });
const standard = formulaMachine(BASE);

/** This function gives the type issues of a check, without the other issues. */
function typeIssuesOf(machine: Machine, doc: unknown): readonly Issue[] {
  return check(machine, doc, { ...LIT, types: true }).filter((issue) => issue.code === "#TYPE!");
}

/** This function gives the place, the reason, the expected type and the found type of each type issue. */
function issuesOf(machine: Machine, doc: unknown): readonly unknown[] {
  return typeIssuesOf(machine, doc).map((issue) => [issue.place, issue.reason, issue.expected, issue.found]);
}

/** This function evaluates a document whose bare values are literals. */
const run = (machine: Machine, doc: Json): Result => evaluate(machine, doc, undefined, "lit").result;

/** This function tells if a result is the error of a value without a truth. */
function truthError(result: Result): boolean {
  return !result.ok && result.error.code === "#VALUE!" && result.error.reason.includes("must give a truth value");
}

describe("the declared type of a truth", () => {
  it("[TYPE.TRUTH] an own truthy with truthType refuses a test of if outside the type, and accepts one in it", () => {
    expect(issuesOf(declared, when("a", 1, 2))).toEqual([[["test"], 'The test of if has the type "a". It must have the type bool | number.', TRUTH, { one: ["a"] }]]);
    expect(issuesOf(declared, when(op("concat", "a"), 1, 2))).toEqual([[["test"], "The test of if has the type text. It must have the type bool | number.", TRUTH, "text"]]);
    for (const test of [1, 0, true, op("add", 1, 2), op("gt", 1, 2), bind({ n: 3 }, ref("names", "n"))]) {
      expect(typeIssuesOf(declared, when(test, 1, 2)), JSON.stringify(test)).toEqual([]);
    }
    // A type issue does not change an evaluation: the test "a" gives #VALUE! at the run, with types and without them.
    expect(run(declared, when("a", 1, 2))).toEqual(run(undeclared, when("a", 1, 2)));
    expect(truthError(run(declared, when("a", 1, 2)))).toBe(true);
    expect(check(declared, when("a", 1, 2), LIT).filter((issue) => issue.code === "#TYPE!")).toEqual([]);
  });

  it("[TYPE.TRUTH] an own truthy with truthType refuses a term of and or of or outside the type, and accepts one in it", () => {
    expect(issuesOf(declared, and(1, "x", true))).toEqual([[[1], 'The term 2 of and has the type "x". It must have the type bool | number.', TRUTH, { one: ["x"] }]]);
    expect(issuesOf(declared, or(op("concat", "a"), 0))).toEqual([[[0], "The term 1 of or has the type text. It must have the type bool | number.", TRUTH, "text"]]);
    expect(issuesOf(declared, or(null, [1]))).toEqual([
      [[0], "The term 1 of or has the type null. It must have the type bool | number.", TRUTH, { one: [null] }],
      [[1], "The term 2 of or has the type [1]. It must have the type bool | number.", TRUTH, { one: [[1]] }],
    ]);
    expect(typeIssuesOf(declared, and(1, op("add", 1, 2), false))).toEqual([]);
    expect(typeIssuesOf(declared, or(0, op("gt", 1, 2), and(1, 2)))).toEqual([]);
  });

  it("[TYPE.TRUTH] the result of and and or is a truth value, or with the logic value the join of the terms", () => {
    expect(typeCheck(declared, and(1, 2), LIT)).toMatchObject({ type: "bool", issues: [] });
    const valued = formulaMachine({ ...BASE, truthy: numberTruthy, truthType: TRUTH, logic: "value" });
    expect(typeCheck(valued, and(1, op("add", 1, 2)), LIT)).toMatchObject({ type: "number", issues: [] });
    expect(typeCheck(valued, or(true, 0), LIT)).toMatchObject({ type: { one: [true, 0] }, issues: [] });
    expect(typeCheck(valued, and(), LIT).type).toEqual({ one: [true] });
    // A truth of numbers only refuses the result bool of and as a test, because its truthy refuses true.
    const numbers = formulaMachine({ ...BASE, truthy: (value) => (typeof value === "number" ? value !== 0 : undefined), truthType: "number" });
    expect(issuesOf(numbers, when(and(1, 2), "a", "b"))).toEqual([[["test"], "The test of if has the type bool. It must have the type number.", "number", "bool"]]);
    expect(truthError(run(numbers, when(and(1, 2), "a", "b")))).toBe(true);
  });

  it("[TYPE.TRUTH] the check examines the declared type one time, and a profile without truthy ignores it", () => {
    const bad = formulaMachine({ ...BASE, truthy: numberTruthy, truthType: { list: "nmber" } as ValueType });
    expect(typeIssuesOf(bad, and(when(1, 2, 3), 4)).map((issue) => [issue.place, issue.reason])).toEqual([[[], "The truth type of the profile is not a correct value type. The machine has no domain nmber."]]);
    // The standard truth keeps its rule: a test must be a truth value, also with a truthType.
    const ignored = formulaMachine({ ...BASE, truthType: "number" });
    for (const machine of [standard, ignored]) {
      expect(issuesOf(machine, when(1, "a", "b"))).toEqual([[["test"], "The test of if has the type 1. It must have the type bool.", "bool", { one: [1] }]]);
      expect(issuesOf(machine, and(true, "x")).map((issue) => (issue as readonly unknown[])[1])).toEqual(['The term 2 of and has the type "x". It must have the type bool.']);
      expect(typeIssuesOf(machine, when(op("gt", 1, 2), "a", "b"))).toEqual([]);
    }
  });

  it("[TYPE.TRUTH] an own truthy without truthType accepts each type at a test and at a term, as before", () => {
    for (const doc of [when("a", 1, 2), when(null, 1), and(1, "x", true), or(op("concat", "a"), [1])]) {
      expect(typeIssuesOf(undeclared, doc), JSON.stringify(doc)).toEqual([]);
    }
    expect(typeCheck(undeclared, when("a", 1, 2), LIT).type).toEqual({ one: [1, 2] });
  });

  it("[TYPE.TRUTH-SOUND] a generated document that checks under a declared truth type gives no error of a truth", () => {
    for (const logic of ["boolean", "value"] as const) {
      const profile: FormulaProfile = { ...BASE, truthy: numberTruthy, truthType: TRUTH, logic };
      const machine = formulaMachine(profile);
      const loose = formulaMachine({ ...BASE, truthy: numberTruthy, logic });
      const rng = random(SEED);
      let accepted = 0;
      let refused = 0;
      let caught = 0;
      for (let index = 0; index < COUNT; index += 1) {
        const doc = truthDoc(rng, 4, []);
        const typing = typeCheck(machine, doc, LIT);
        const result = run(machine, doc);
        // Without the declaration, the check accepts more documents, and some of them give an error of a truth.
        if (typeCheck(loose, doc, LIT).issues.length === 0 && truthError(result)) caught += 1;
        if (typing.issues.length > 0) {
          refused += 1;
          continue;
        }
        accepted += 1;
        expect(truthError(result), `${logic}: ${JSON.stringify(doc)}`).toBe(false);
        if (result.ok) expect(member(result.value, typing.type, machine.domains), `${logic}: ${JSON.stringify(doc)}`).toBe(true);
      }
      expect(accepted, logic).toBeGreaterThan(COUNT / 10);
      expect(refused, logic).toBeGreaterThan(COUNT / 10);
      expect(caught, logic).toBeGreaterThan(0);
    }
  });
});

/** The literals of the generated documents: truths, numbers and values without a truth. */
const LITERALS: readonly Json[] = [0, 1, -2.5, true, false, "", "a", null, [], [1], { a: 1 }];

/**
 * This function builds a random document of tests and terms of truths, operations, literals and names of `let`. A
 * name has the type of its binding, thus no part of the type `unknown` reaches a test or a term.
 */
function truthDoc(rng: Random, depth: number, names: readonly string[]): Json {
  if (names.length > 0 && rng.chance(0.2)) return ref("names", rng.pick(names));
  if (depth <= 0 || rng.chance(0.2)) return rng.pick(LITERALS);
  const sub = (more: readonly string[] = names): Json => truthDoc(rng, depth - 1, more);
  const name = rng.pick(["a", "b"]);
  const forms: readonly (() => Json)[] = [
    () => when(sub(), sub(), sub()),
    () => when(sub(), sub()),
    () => (rng.chance(0.5) ? and(sub(), sub()) : or(sub(), sub())),
    () => op(rng.pick(["add", "gt"]), sub(), sub()),
    () => op("concat", sub(), sub()),
    () => op("not", sub()),
    () => bind({ [name]: sub() }, sub([...names, name])),
  ];
  return rng.pick(forms)();
}
