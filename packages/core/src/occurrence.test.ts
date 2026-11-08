import { describe, expect, it } from "vitest";
import { type FormulaProfile, type Json, type Machine, type RootTypes, type Signature, type ValueType, check, context, evaluate, formulaMachine, member, typeCheck } from "./index.ts";
import { narrowType } from "./types.ts";

const SIGS: Readonly<Record<string, Signature | readonly Signature[]>> = {
  add: { params: ["number", "number"], to: "number" },
  concat: { params: ["text", "text"], to: "text" },
  isNum: { params: ["unknown"], to: "bool", proves: "number" },
  isThere: { params: ["unknown"], to: "bool", present: true },
  over: [
    { params: ["number"], to: "bool", proves: "number" },
    { params: ["text"], to: "bool", proves: "text" },
  ],
  plain: { params: ["unknown"], to: "bool" },
  save: { params: ["unknown"], to: "bool" },
};
const PROFILE: FormulaProfile = {
  ops: {
    add: (a, b) => (a as number) + (b as number),
    concat: (a, b) => `${String(a)}${String(b)}`,
    isNum: (value) => typeof value === "number",
    isThere: (value) => value !== undefined,
    over: (value) => typeof value === "number",
    plain: () => true,
    save: () => true,
  },
  sigs: SIGS,
};
const machine = formulaMachine(PROFILE);
const LIT = { declaredType: "lit" } as const;

const op = (name: string, ...value: Json[]): Json => ({ type: ["ops", name], value });
const ref = (...value: Json[]): Json => ({ type: "ref", value });
const lit = (value: Json): Json => value;
const when = (test: Json, then: Json, other?: Json): Json => ({ type: "if", value: { test, then, ...(other === undefined ? {} : { else: other }) } });
const and = (...value: Json[]): Json => ({ type: "and", value });
const or = (...value: Json[]): Json => ({ type: "or", value });

const EITHER: ValueType = { union: ["number", "text"] };
const X = ref("self", "x");
const THEN = op("add", X, lit(1));
const OTHER = op("concat", X, lit("!"));
const roots = (type: ValueType): RootTypes => ({ self: { record: { x: type } } });

/** This function gives the reasons of the type issues of a check. */
function issues(doc: Json, rootTypes: RootTypes, on: Machine = machine, names: readonly string[] = []): readonly string[] {
  return typeCheck(on, doc, { ...LIT, rootTypes, names })
    .issues.filter((issue) => issue.code === "#TYPE!" || issue.code === "#N/A")
    .map((issue) => issue.reason);
}

describe("narrowing in a branch", () => {
  it("[STATIC.OCCURRENCE] narrows a path in then, and gives the reverse in else", () => {
    expect(issues(THEN, roots(EITHER))).toHaveLength(1);
    expect(issues(OTHER, roots(EITHER))).toHaveLength(1);
    expect(issues(when(op("isNum", X), THEN, OTHER), roots(EITHER))).toEqual([]);
  });

  it("[STATIC.OCCURRENCE] keeps the type in a branch that the proof does not reach", () => {
    expect(issues(when(op("isNum", X), OTHER, THEN), roots(EITHER))).toHaveLength(2);
    expect(issues(when(op("plain", X), THEN, OTHER), roots(EITHER))).toHaveLength(2);
  });

  it("[STATIC.OCCURRENCE] reads the test first, in each order of the fields", () => {
    const doc: Json = { type: "if", value: { then: THEN, else: OTHER, test: op("isNum", X) } };
    expect(issues(doc, roots(EITHER))).toEqual([]);
  });

  it("[STATIC.OCCURRENCE] narrows a name, and a binding of the same name hides the narrowing", () => {
    const name = ref("names", "n");
    const types: RootTypes = { names: { n: EITHER } };
    expect(issues(when(op("isNum", name), op("add", name, lit(1)), op("concat", name, lit("!"))), types, machine, ["n"])).toEqual([]);
    const hides: Json = { type: "let", value: { bind: { n: lit("text") }, body: op("add", name, lit(1)) } };
    expect(issues(when(op("isNum", name), hides), types, machine, ["n"])).toHaveLength(1);
  });

  it("[STATIC.OCCURRENCE] gives a name of the type unknown the proved type", () => {
    const name = ref("names", "n");
    expect(issues(when(op("isNum", name), op("concat", name, lit("!"))), {}, machine, ["n"])).toHaveLength(1);
    expect(issues(when(op("isNum", name), op("add", name, lit(1))), {}, machine, ["n"])).toEqual([]);
  });

  it("[STATIC.OCCURRENCE] narrows a field of a field, and each root", () => {
    const deep = ref("world", "a", "b");
    const types: RootTypes = { world: { record: { a: { record: { b: EITHER } } } } };
    expect(issues(when(op("isNum", deep), op("add", deep, lit(1)), op("concat", deep, lit("!"))), types)).toEqual([]);
    const event = ref("event", "x");
    expect(issues(when(op("isNum", event), op("add", event, lit(1))), { event: { record: { x: EITHER } } })).toEqual([]);
  });

  it("[STATIC.OCCURRENCE] keeps the other members of a union in else, and removes the values of a set", () => {
    const three: ValueType = { union: ["number", "text", "bool"] };
    expect(issues(when(op("isNum", X), lit(0), OTHER), roots(three))).toHaveLength(1);
    const set = (doc: Json): ValueType => typeCheck(machine, doc, { ...LIT, rootTypes: roots({ one: [1, 2, "a"] }) }).type;
    expect(set(when(op("isNum", X), X, lit(null)))).toEqual({ one: [1, 2, null] });
    expect(set(when(op("isNum", X), lit(null), X))).toEqual({ one: [null, "a"] });
  });

  it("[STATIC.OCCURRENCE] gives each branch a value of its narrowed type", () => {
    const doc = when(op("isNum", X), THEN, OTHER);
    const typing = typeCheck(machine, doc, { ...LIT, rootTypes: roots(EITHER) });
    expect(typing.issues).toEqual([]);
    for (const value of [1, "a"]) {
      const run = evaluate(machine, doc, context({ self: { x: value } }), LIT);
      expect(run.result.ok).toBe(true);
      if (run.result.ok) expect(member(run.result.value, typing.type, machine.domains)).toBe(true);
    }
  });

  it("[STATIC.OCCURRENCE] gives a member of the narrowed type for each pair of a type and a value", () => {
    const types: readonly ValueType[] = [EITHER, "number", "text", { one: [1, "a"] }, { union: ["number", "bool"] }, { union: ["text", { list: "number" }] }];
    const values: readonly Json[] = [1, "a", true, [2]];
    let seen = 0;
    for (const type of types) {
      for (const self of [{ record: { x: type }, closed: true }, { record: { x: type }, optional: ["x"], closed: true }] as readonly ValueType[]) {
        const typing = typeCheck(machine, { type: "if", value: { test: op("isNum", X), then: ref("self"), else: ref("self") } }, { ...LIT, rootTypes: { self } });
        expect(typing.issues).toEqual([]);
        for (const value of values) {
          if (!member(value, type, machine.domains)) continue;
          seen += 1;
          const run = evaluate(machine, { type: "if", value: { test: op("isNum", X), then: ref("self"), else: ref("self") } }, context({ self: { x: value } }), LIT);
          expect(run.result).toEqual({ ok: true, value: { x: value } });
          expect(member({ x: value }, typing.type, machine.domains), JSON.stringify([type, value])).toBe(true);
        }
      }
    }
    expect(seen).toBeGreaterThan(15);
  });
});

describe("narrowing by presence", () => {
  const OPTIONAL: ValueType = { record: { x: "number" }, optional: ["x"], closed: true };
  const typeOf = (doc: Json, self: ValueType): ValueType => typeCheck(machine, doc, { ...LIT, rootTypes: { self } }).type;

  it("[STATIC.OCCURRENCE-PRESENT] makes an optional field needed in then, and removes it in else", () => {
    expect(issues(when(op("isThere", X), X, X), { self: OPTIONAL })).toEqual(["The value at self has no field x."]);
    expect(typeOf(when(op("isThere", X), ref("self"), lit(null)), OPTIONAL)).toEqual({ union: [{ record: { x: "number" }, closed: true }, { one: [null] }] });
    expect(typeOf(when(op("isThere", X), lit(null), ref("self")), OPTIONAL)).toEqual({ union: [{ one: [null] }, { record: {}, closed: true }] });
  });

  it("[STATIC.OCCURRENCE-PRESENT] keeps a needed field in else, and keeps an open record open", () => {
    expect(issues(when(op("isThere", X), X, X), { self: { record: { x: "number" }, closed: true } })).toEqual([]);
    expect(narrowType({ record: { x: "number" }, optional: ["x"] }, { path: ["self", "x"], fact: "absent" }, 1, undefined)).toEqual({ record: { x: "never" }, optional: ["x"] });
  });

  it("[STATIC.OCCURRENCE-PRESENT] proves a field with a type, and the reverse leaves the field optional", () => {
    const self: ValueType = { record: { x: EITHER }, optional: ["x"], closed: true };
    expect(typeOf(when(op("isNum", X), ref("self"), lit(null)), self)).toEqual({ union: [{ record: { x: "number" }, closed: true }, { one: [null] }] });
    expect(typeOf(when(op("isNum", X), lit(null), ref("self")), self)).toEqual({ union: [{ one: [null] }, { record: { x: "text" }, optional: ["x"], closed: true }] });
    expect(typeOf(when(op("isNum", X), lit(null), ref("self")), OPTIONAL)).toEqual({ union: [{ one: [null] }, { record: {}, closed: true }] });
  });
});

describe("narrowing in and and or", () => {
  it("[STATIC.OCCURRENCE-LOGIC] and narrows its later terms, and or gives them the reverse", () => {
    const big = op("isNum", op("add", X, lit(1)));
    expect(issues(and(op("isNum", X), big), roots(EITHER))).toEqual([]);
    expect(issues(and(big, op("isNum", X)), roots(EITHER))).toHaveLength(1);
    expect(issues(or(op("isNum", X), op("plain", OTHER)), roots(EITHER))).toEqual([]);
    expect(issues(or(op("isNum", X), big), roots(EITHER))).toHaveLength(1);
  });

  it("[STATIC.OCCURRENCE-LOGIC] carries a proof over each term after it", () => {
    expect(issues(and(op("isNum", X), op("plain", X), op("plain", THEN)), roots(EITHER))).toEqual([]);
  });

  it("[STATIC.OCCURRENCE-LOGIC] gives a branch the proofs of a test with and or or", () => {
    const y = ref("self", "y");
    const self: ValueType = { record: { x: EITHER, y: EITHER } };
    expect(issues(when(and(op("isNum", X), op("isNum", y)), op("add", X, y)), { self })).toEqual([]);
    expect(issues(when(or(op("isNum", X), op("isNum", y)), lit(1), op("concat", X, y)), { self })).toEqual([]);
  });

  it("[STATIC.OCCURRENCE-LOGIC] proves nothing for the other result of a test with two terms", () => {
    const y = ref("self", "y");
    const self: ValueType = { record: { x: EITHER, y: EITHER } };
    expect(issues(when(and(op("isNum", X), op("isNum", y)), lit(1), OTHER), { self })).toHaveLength(1);
    expect(issues(when(or(op("isNum", X), op("isNum", y)), THEN, lit(1)), { self })).toHaveLength(1);
    expect(issues(when(and(op("isNum", X)), THEN, OTHER), { self })).toEqual([]);
    expect(issues(when(or(op("isNum", X)), THEN, OTHER), { self })).toEqual([]);
  });

  it("[STATIC.OCCURRENCE-LOGIC] gives a deep test the proofs of its term", () => {
    let test = op("isNum", X);
    for (let index = 0; index < 900; index += 1) test = and(test);
    expect(issues(when(test, THEN, OTHER), roots(EITHER))).toEqual([]);
  });
});

describe("the paths that narrow", () => {
  it("[STATIC.OCCURRENCE-PATH] does not narrow a path with a computed step, or a computed test", () => {
    const computed = ref("self", ref("names", "key"));
    const self: ValueType = { record: { x: EITHER } };
    expect(typeCheck(machine, when(op("isNum", computed), computed, lit(null)), { ...LIT, names: ["key"], rootTypes: { self } }).type).not.toEqual({ union: ["number", { one: [null] }] });
    expect(issues(when(op("isNum", op("concat", X, lit("!"))), THEN), roots(EITHER))).toHaveLength(2);
  });

  it("[STATIC.OCCURRENCE-PATH] does not narrow through a list, a union or an overload", () => {
    const item = ref("self", "x", 0);
    expect(issues(when(op("isNum", item), op("add", item, lit(1))), roots({ list: EITHER }))).toHaveLength(1);
    const field = ref("self", "x", "a");
    const records: ValueType = { union: [{ record: { a: "number" } }, { record: { a: "text" } }] };
    expect(issues(when(op("isNum", field), op("add", field, lit(1))), roots(records))).toHaveLength(1);
    expect(issues(when(op("over", X), THEN, THEN), roots("number"))).toEqual([]);
    expect(issues(when(op("over", X), THEN, OTHER), roots("number"))).toHaveLength(1);
  });

  it("[STATIC.OCCURRENCE-PATH] ignores a test without an argument, and a bad proved type gives an issue", () => {
    expect(issues(when(op("isNum"), lit(1)), {})).toEqual([]);
    const bad = formulaMachine({ ...PROFILE, sigs: { ...SIGS, isNum: { params: ["unknown"], to: "bool", proves: "nmber" } } });
    const found = check(bad, when(op("isNum", X), lit(1)), { ...LIT, types: true, rootTypes: roots(EITHER) }).filter((issue) => issue.reason.includes("proved type"));
    expect(found).toHaveLength(1);
  });
});

describe("a narrowing and the effects", () => {
  const facts: Machine["facts"] = (path, code) => (path[1] === "save" ? { effects: ["save"] } : machine.facts?.(path, code));
  const effects: Machine = { ...machine, facts };

  it("[STATIC.OCCURRENCE-EFFECT] does not narrow a root in a document with an effect", () => {
    const doc = when(op("isNum", X), and(op("save", X), op("plain", THEN)));
    expect(issues(doc, roots(EITHER))).toEqual([]);
    expect(issues(doc, roots(EITHER), effects)).toHaveLength(1);
  });

  it("[STATIC.OCCURRENCE-EFFECT] still narrows a name, because an effect does not change it", () => {
    const name = ref("names", "n");
    const doc = when(op("isNum", name), and(op("save", name), op("plain", op("add", name, lit(1)))));
    expect(issues(doc, { names: { n: EITHER } }, effects, ["n"])).toEqual([]);
  });
});
