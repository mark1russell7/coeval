import { describe, expect, it } from "vitest";
import {
  type Domain,
  type Json,
  type MergeConflict,
  type Random,
  type ValueType,
  MergeError,
  STD_DOMAINS,
  STD_MACHINE,
  fits,
  formulaMachine,
  join,
  member,
  mergeMachines,
  random,
  restrictMachine,
  typeIssues,
  typeText,
} from "./index.ts";

/** The domains of a small language: refinements of numbers, a unit of length and a color. */
const isColor = (value: unknown): boolean => typeof value === "string" && /^#[0-9a-f]{6}$/.test(value);
const DOMAINS: Readonly<Record<string, Domain>> = {
  finite: { is: (value) => Number.isFinite(value), under: ["number"], summary: "A finite number." },
  whole: { is: (value) => Number.isInteger(value), under: ["finite"], summary: "A whole number." },
  length: { is: (value) => (value as number) >= 0, under: ["number"], summary: "A length that is not negative." },
  // The test of px accepts each value: the parents length and number test it.
  px: { is: () => true, under: ["length"], summary: "A length in pixels." },
  color: { is: isColor, under: ["text"], summary: "A color, for example #00ff00." },
};

const BASES = ["null", "bool", "number", "text", "finite", "whole", "length", "px", "color"] as const;

/** The JSON values that the generator puts in `one`, and that the samples of `unknown` use. */
const VALUES: readonly Json[] = [null, true, false, 0, -0, 1, 1.5, -2, "", "a", "#00ff00", [], [1], [1, "a"], [[2]], {}, { a: 1 }, { a: "x" }, { a: 1, b: true }, { c: null }];

/** The samples of each base type. Each sample is a member of its base type. */
const BASE_SAMPLES: Readonly<Record<string, readonly unknown[]>> = {
  null: [null],
  bool: [true, false],
  number: [0, -0, 1.5, -3, Number.NaN, Number.POSITIVE_INFINITY],
  text: ["", "a", "#00ff00"],
  finite: [0, 2, -1.5],
  whole: [0, 3, -2],
  length: [0, 2.5, Number.POSITIVE_INFINITY],
  px: [0, 4],
  color: ["#00ff00", "#123abc"],
};

const NONE: unique symbol = Symbol("none");

/** This function makes a random value type. Without `unknown`, the type has no `unknown` at any depth. */
function typeOf(rng: Random, depth: number, withUnknown: boolean): ValueType {
  const leaves: readonly ValueType[] = withUnknown ? [...BASES, "never", "unknown"] : [...BASES, "never"];
  if (depth <= 0 || rng.chance(0.3)) return rng.pick(leaves);
  const next = (): ValueType => typeOf(rng, depth - 1, withUnknown);
  switch (rng.int(5)) {
    case 0:
      return { list: next() };
    case 1: {
      const names = ["a", "b", "c"].filter(() => rng.chance(0.5));
      const record: Record<string, ValueType> = {};
      for (const name of names) record[name] = next();
      const optional = names.filter(() => rng.chance(0.4));
      return { record, ...(optional.length > 0 ? { optional } : {}), ...(rng.chance(0.5) ? { closed: true } : {}) };
    }
    case 2:
      return { fn: Array.from({ length: rng.int(3) }, next), to: next() };
    case 3:
      return { union: Array.from({ length: rng.int(4) }, next) };
    default:
      return { one: VALUES.filter(() => rng.chance(0.15)) };
  }
}

/** This function gives a random member of a type, or `NONE` when it finds none. */
function sampleOf(rng: Random, type: ValueType): unknown {
  if (type === "unknown") return rng.pick(VALUES);
  if (type === "never") return NONE;
  if (typeof type === "string") return rng.pick(BASE_SAMPLES[type] as readonly unknown[]);
  if ("list" in type) {
    const items = Array.from({ length: rng.int(3) }, () => sampleOf(rng, type.list));
    return items.filter((item) => item !== NONE);
  }
  if ("record" in type) {
    const out: Record<string, unknown> = {};
    for (const [name, field] of Object.entries(type.record)) {
      const optional = type.optional?.includes(name) === true;
      if (optional && rng.chance(0.5)) continue;
      const value = sampleOf(rng, field);
      if (value === NONE) {
        if (optional) continue;
        return NONE;
      }
      out[name] = value;
    }
    // An open record can have other fields, with each value.
    const others = ["a", "b", "c"].filter((name) => !Object.hasOwn(type.record, name));
    if (type.closed !== true && others.length > 0 && rng.chance(0.5)) out[rng.pick(others)] = rng.pick(VALUES);
    return out;
  }
  if ("fn" in type) return () => 0;
  if ("union" in type) {
    const found = type.union.map((each) => sampleOf(rng, each)).filter((value) => value !== NONE);
    return found.length === 0 ? NONE : rng.pick(found);
  }
  return type.one.length === 0 ? NONE : rng.pick(type.one);
}

/** This function makes a list of random types, and adds a list, a union and a `one` of each, so that many pairs fit. */
function poolOf(seed: number, count: number, withUnknown: boolean): readonly ValueType[] {
  const rng = random(seed);
  const out: ValueType[] = [];
  for (let index = 0; index < count; index += 1) {
    const type = typeOf(rng, 3, withUnknown);
    out.push(type);
    if (index % 4 === 0) out.push({ list: type }, { union: [type, rng.pick(BASES)] });
    if (index % 4 === 1) {
      const value = sampleOf(rng, type);
      if (value !== NONE && typeof value !== "function") out.push({ one: [value as Json] });
    }
  }
  return out;
}

/** This function gives the conflicts of a merge, or no conflicts when the merge succeeds. */
function conflictsOf(merge: () => unknown): readonly MergeConflict[] {
  try {
    merge();
  } catch (error) {
    if (error instanceof MergeError) return error.conflicts;
    throw error;
  }
  return [];
}

describe("value types and value domains", () => {
  it("[TYPE.BASE] the kernel has unknown, never, null, bool, number and text, and each text names a base type", () => {
    expect(Object.keys(STD_DOMAINS).sort()).toEqual(["bool", "null", "number", "text"]);
    expect(member(null, "null")).toBe(true);
    expect(member(undefined, "null")).toBe(false);
    expect(member(false, "bool")).toBe(true);
    expect(member(0, "bool")).toBe(false);
    for (const value of [0, -0, 1.5, Number.NaN, Number.NEGATIVE_INFINITY]) expect(member(value, "number")).toBe(true);
    expect(member("1", "number")).toBe(false);
    expect(member("", "text")).toBe(true);
    expect(member(["a"], "text")).toBe(false);
    for (const value of [undefined, null, 0, "a", [], {}, () => 1, new Date(0)]) {
      expect(member(value, "unknown")).toBe(true);
      expect(member(value, "never")).toBe(false);
    }
  });

  it("[TYPE.TERM] the terms list, record, fn, union and one build types, and member tests their values at each depth", () => {
    expect(member([1, 2], { list: "number" })).toBe(true);
    expect(member([1, "a"], { list: "number" })).toBe(false);
    expect(member({ 0: 1 }, { list: "number" })).toBe(false);
    // A hole of a list holds undefined.
    expect(member(new Array(2), { list: "number" })).toBe(false);
    const person: ValueType = { record: { name: "text", age: "number" }, optional: ["age"] };
    expect(member({ name: "Ada" }, person)).toBe(true);
    expect(member({ name: "Ada", age: 36, extra: true }, person)).toBe(true);
    expect(member({ name: "Ada", age: "36" }, person)).toBe(false);
    expect(member({ age: 36 }, person)).toBe(false);
    expect(member({ name: "Ada", extra: true }, { ...person, closed: true })).toBe(false);
    expect(member({ name: "Ada" }, { ...person, closed: true })).toBe(true);
    // A record type holds only plain records, as DOC.RECORD says.
    expect(member(new Date(0), { record: {} })).toBe(false);
    // A field with the name __proto__ is a field.
    const proto = JSON.parse('{ "record": { "__proto__": "number" }, "closed": true }') as ValueType;
    expect(member(JSON.parse('{ "__proto__": 1 }'), proto)).toBe(true);
    expect(member({}, proto)).toBe(false);
    // A function type tests only that the value is a function.
    expect(member((a: number) => a, { fn: ["number"], to: "number" })).toBe(true);
    expect(member("f", { fn: [], to: "unknown" })).toBe(false);
    expect(member(1, { union: ["text", "number"] })).toBe(true);
    expect(member(null, { union: ["text", "number"] })).toBe(false);
    expect(member(null, { union: [] })).toBe(false);
    // `one` compares with docEquals, thus -0 is not 0, and a record compares by its fields.
    expect(member({ b: 2, a: 1 }, { one: [{ a: 1, b: 2 }, "x"] })).toBe(true);
    expect(member(-0, { one: [0] })).toBe(false);
    expect(member("y", { one: [] })).toBe(false);
  });

  it("[TYPE.MEMBER] a member of a domain passes the test of the domain and the test of each parent, and a test that throws gives false", () => {
    expect(member(3, "whole", DOMAINS)).toBe(true);
    expect(member(3.5, "whole", DOMAINS)).toBe(false);
    // The test of whole accepts no infinity, and the test of finite refuses it too.
    expect(member(Number.POSITIVE_INFINITY, "finite", DOMAINS)).toBe(false);
    // The test of px accepts each value, but its parents length and number refuse these values.
    expect(member(4, "px", DOMAINS)).toBe(true);
    expect(member(-4, "px", DOMAINS)).toBe(false);
    expect(member("4", "px", DOMAINS)).toBe(false);
    const throws: Domain = {
      is: () => {
        throw new Error("no test");
      },
    };
    expect(member(1, "odd", { odd: throws })).toBe(false);
    expect(member(1, { union: ["odd", "number"] }, { odd: throws })).toBe(true);
  });

  it("[TYPE.MEMBER] a member of found is a member of each type that found fits, for generated types and samples without unknown", () => {
    const pool = poolOf(23, 90, false);
    const rng = random(7);
    let checked = 0;
    for (const found of pool) {
      for (let round = 0; round < 3; round += 1) {
        const value = sampleOf(rng, found);
        if (value === NONE) continue;
        expect(member(value, found, DOMAINS), `${JSON.stringify(value)} in ${JSON.stringify(found)}`).toBe(true);
        for (const expected of pool) {
          if (!fits(found, expected, DOMAINS)) continue;
          checked += 1;
          expect(member(value, expected, DOMAINS), `${JSON.stringify(value)}: ${JSON.stringify(found)} fits ${JSON.stringify(expected)}`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it("[TYPE.FITS] the rules of the terms: unions, one, lists, records with width and closed records, and functions", () => {
    // The example of R5: the argument of ops.concat is a number where a text must be.
    expect(fits("number", "text")).toBe(false);
    expect(fits({ list: { record: { sku: "text", qty: "number" } } }, { list: "unknown" })).toBe(true);
    expect(fits({ union: ["number", "text"] }, { union: ["text", "null", "number"] })).toBe(true);
    expect(fits({ union: ["number", "text"] }, "number")).toBe(false);
    expect(fits({ one: [1, 2.5] }, "number")).toBe(true);
    expect(fits({ one: [1, "a"] }, "number")).toBe(false);
    expect(fits({ one: [1] }, { one: [1, 2] })).toBe(true);
    expect(fits("number", { one: [1] })).toBe(false);
    expect(fits({ list: "whole" }, { list: "number" }, DOMAINS)).toBe(true);
    expect(fits({ list: "number" }, { list: "whole" }, DOMAINS)).toBe(false);
    // Width: a record with more fields fits a record with fewer fields, unless that record is closed.
    const point: ValueType = { record: { x: "number", y: "number" } };
    const point3: ValueType = { record: { x: "number", y: "number", z: "number" } };
    expect(fits(point3, point)).toBe(true);
    expect(fits(point, point3)).toBe(false);
    expect(fits(point3, { ...point, closed: true })).toBe(false);
    expect(fits({ ...point, closed: true }, { ...point3, optional: ["z"] })).toBe(true);
    // An open record without an optional field fits only when that field is unknown: its other fields hold each value.
    expect(fits(point, { ...point3, optional: ["z"] })).toBe(false);
    expect(fits(point, { record: { x: "number", z: "unknown" }, optional: ["z"] })).toBe(true);
    expect(fits({ ...point, optional: ["y"] }, point)).toBe(false);
    expect(fits(point, { ...point, optional: ["y"] })).toBe(true);
    // Functions: fewer parameters, each expected parameter fits its parameter, and the result fits.
    expect(fits({ fn: ["number"], to: "whole" }, { fn: ["whole", "text"], to: "number" }, DOMAINS)).toBe(true);
    expect(fits({ fn: ["whole"], to: "number" }, { fn: ["number"], to: "number" }, DOMAINS)).toBe(false);
    expect(fits({ fn: ["number", "number"], to: "number" }, { fn: ["number"], to: "number" })).toBe(false);
    expect(fits({ fn: [], to: "number" }, { list: "number" })).toBe(false);
    // The relation is sound, not complete.
    expect(fits("bool", { one: [true, false] })).toBe(false);
  });

  it("[TYPE.FITS] never is the bottom: it fits each type, and only an empty type fits it", () => {
    for (const type of poolOf(5, 60, true)) expect(fits("never", type, DOMAINS)).toBe(true);
    expect(fits({ union: [] }, "number")).toBe(true);
    expect(fits({ one: [] }, "never")).toBe(true);
    expect(fits({ union: ["never", { one: [] }] }, "never")).toBe(true);
    for (const type of ["null", "number", { list: "never" }, { one: [null] }, { record: {} }] as const) expect(fits(type, "never")).toBe(false);
  });

  it("[TYPE.FITS] fits is reflexive, and transitive for generated types without unknown", () => {
    const pool = poolOf(11, 120, false);
    const table = pool.map((found) => pool.map((expected) => fits(found, expected, DOMAINS)));
    pool.forEach((type, index) => expect(table[index]?.[index], JSON.stringify(type)).toBe(true));
    let chains = 0;
    for (let a = 0; a < pool.length; a += 1) {
      for (let b = 0; b < pool.length; b += 1) {
        if (a === b || table[a]?.[b] !== true) continue;
        for (let c = 0; c < pool.length; c += 1) {
          if (b === c || table[b]?.[c] !== true) continue;
          chains += 1;
          if (table[a]?.[c] !== true) expect.fail(`${JSON.stringify(pool[a])} fits ${JSON.stringify(pool[b])}, which fits ${JSON.stringify(pool[c])}`);
        }
      }
    }
    expect(chains).toBeGreaterThan(20000);
    // With the gradual top, the relation is not transitive: a list of numbers fits a list of unknown, which fits a list of texts.
    expect(fits({ list: "number" }, { list: "unknown" }) && fits({ list: "unknown" }, { list: "text" })).toBe(true);
    expect(fits({ list: "number" }, { list: "text" })).toBe(false);
  });

  it("[TYPE.UNKNOWN] unknown is the gradual top: it fits each type, each type fits it, and it holds each value", () => {
    for (const type of poolOf(3, 80, true)) {
      expect(fits(type, "unknown", DOMAINS)).toBe(true);
      expect(fits("unknown", type, DOMAINS)).toBe(true);
    }
    expect(fits({ record: { a: "unknown" } }, { record: { a: "color" } }, DOMAINS)).toBe(true);
    expect(fits({ union: ["number", "unknown"] }, "text")).toBe(false);
    expect(fits("text", { union: ["number", "unknown"] })).toBe(true);
  });

  it("[TYPE.UNKNOWN] a term that is not a value type, a base type without a domain and a term that is too deep read as unknown", () => {
    // A later term, for example a type variable, reads as unknown, thus an older check does not fail.
    for (const term of [{ var: "A" }, { interval: [0, 1] }, { list: "number", extra: 1 }, { list: "a", union: [] }, 3, null, ["number"], { fn: [] }, { record: {}, closed: "yes" }]) {
      expect(fits(term as ValueType, "number")).toBe(true);
      expect(fits("number", term as ValueType)).toBe(true);
      expect(member("anything", term as ValueType)).toBe(true);
    }
    expect(fits("colr", "number", DOMAINS)).toBe(true);
    expect(member(1, { list: "colr" }, DOMAINS)).toBe(false);
    let deep: ValueType = "number";
    for (let index = 0; index < 10_000; index += 1) deep = { list: deep };
    expect(fits(deep, deep)).toBe(true);
    expect(fits(deep, "text")).toBe(false);
    expect(member([[1]], deep)).toBe(false);
    // Below the deepest term, the rest of the type reads as unknown.
    let nested: unknown = "a";
    for (let index = 0; index < 300; index += 1) nested = [nested];
    expect(member(nested, deep)).toBe(true);
    // A table entry with the name unknown or never has no effect.
    const odd: Domain = { is: () => false };
    expect(member(1, "unknown", { unknown: odd })).toBe(true);
    expect(fits("number", "never", { never: { is: () => true } })).toBe(false);
  });

  it("[TYPE.UNKNOWN] fits, member and typeIssues do not throw for random JSON", () => {
    const rng = random(99);
    const junk = (depth: number): unknown => {
      const keys = ["list", "record", "fn", "to", "union", "one", "optional", "closed", "a"];
      if (depth <= 0 || rng.chance(0.3)) return rng.pick<unknown>([null, true, 0, "number", "text", "unknown", "never", "whole", "zz", [], {}]);
      if (rng.chance(0.3)) return Array.from({ length: rng.int(3) }, () => junk(depth - 1));
      const out: Record<string, unknown> = {};
      for (const key of keys) if (rng.chance(0.25)) out[key] = junk(depth - 1);
      return out;
    };
    for (let index = 0; index < 2000; index += 1) {
      const a = junk(4) as ValueType;
      const b = junk(4) as ValueType;
      expect(() => [fits(a, b, DOMAINS), member(junk(3), a, DOMAINS), typeIssues(a, DOMAINS)]).not.toThrow();
    }
  });

  it("[TYPE.ISSUES] typeIssues lists each term that is not a value type, each base type without a domain and a term that is too deep", () => {
    expect(typeIssues({ record: { a: "number", b: { list: "color" } }, optional: ["a"], closed: true }, DOMAINS)).toEqual([]);
    expect(typeIssues({ fn: ["unknown"], to: { union: ["never", { one: [1, "a"] }] } })).toEqual([]);
    expect(typeIssues({ record: { a: "colr", b: { var: "A" } }, optional: ["c", 1], closed: "yes" }, DOMAINS)).toEqual([
      { at: ["optional", 0], reason: "The optional field c is not a field of the record." },
      { at: ["optional", 1], reason: "The optional field 1 is not a field of the record." },
      { at: ["closed"], reason: "The value of closed is true or false." },
      { at: ["record", "a"], reason: "The machine has no domain colr." },
      { at: ["record", "b"], reason: "A value type is a text, or a record with one of the keys list, record, fn, union, one and the keys that go with it." },
    ]);
    expect(typeIssues({ fn: "number" })).toEqual([
      { at: ["fn"], reason: "The value of fn is a list of value types." },
      { at: [], reason: "A function type has the key to: the type of its result." },
    ]);
    expect(typeIssues({ union: [3, { one: 1 }] }).map((issue) => issue.at)).toEqual([["union", 0], ["union", 1, "one"]]);
    expect(typeIssues("color")).toEqual([{ at: [], reason: "The machine has no domain color." }]);
    let deep: ValueType = "number";
    for (let index = 0; index < 300; index += 1) deep = { list: deep };
    const issues = typeIssues(deep);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toBe("The value type is deeper than 256 terms.");
    expect(issues[0]?.at).toHaveLength(257);
  });

  it("[TYPE.DOMAIN] a base type fits itself and each parent of its domain through each level, and a cycle of parents ends", () => {
    expect(fits("px", "length", DOMAINS)).toBe(true);
    expect(fits("px", "number", DOMAINS)).toBe(true);
    expect(fits("whole", "number", DOMAINS)).toBe(true);
    expect(fits("number", "whole", DOMAINS)).toBe(false);
    expect(fits("px", "finite", DOMAINS)).toBe(false);
    expect(fits("color", "text", DOMAINS)).toBe(true);
    expect(fits("color", "number", DOMAINS)).toBe(false);
    expect(fits("px", { union: ["color", "length"] }, DOMAINS)).toBe(true);
    const loop: Readonly<Record<string, Domain>> = { a: { is: () => true, under: ["b"] }, b: { is: () => true, under: ["a", "number"] } };
    expect(fits("a", "b", loop) && fits("b", "a", loop) && fits("a", "number", loop)).toBe(true);
    expect(fits("a", "text", loop)).toBe(false);
    expect(member(1, "a", loop)).toBe(true);
    expect(member("1", "a", loop)).toBe(false);
  });

  it("[TYPE.OPEN] a language adds its domains in its machine, without a change to the kernel, and the kernel domains stay", () => {
    const machine = formulaMachine({}, { domains: { color: DOMAINS["color"] as Domain } });
    expect(machine.domains?.["number"]).toBe(STD_DOMAINS["number"]);
    expect(fits("color", "text", machine.domains)).toBe(true);
    expect(member("#00ff00", "color", machine.domains)).toBe(true);
    expect(member("green", "color", machine.domains)).toBe(false);
    expect(typeIssues({ list: "color" }, machine.domains)).toEqual([]);
    expect(typeIssues({ list: "color" }, STD_MACHINE.domains)).toHaveLength(1);
    // A table without a kernel domain gets it from STD_DOMAINS.
    const own: Readonly<Record<string, Domain>> = { color: DOMAINS["color"] as Domain };
    expect(member(1, "number", own) && fits("color", "text", own) && typeIssues("bool", own).length === 0).toBe(true);
    // A table that names a kernel domain gives its own test, for example numbers of a language without NaN.
    const strict: Readonly<Record<string, Domain>> = { number: { is: (value) => typeof value === "number" && !Number.isNaN(value) } };
    expect(member(Number.NaN, "number", strict)).toBe(false);
    expect(member(Number.NaN, "number")).toBe(true);
  });

  it("[TYPE.MERGE] mergeMachines merges domains name by name, and two different domains with one name are a conflict", () => {
    const color = DOMAINS["color"] as Domain;
    const other: Domain = { is: (value) => typeof value === "string", under: ["text"] };
    // One object, or the same test, parents and summary, gives one domain, in each order.
    const ab = mergeMachines({ domains: { color } }, { domains: { color: { ...color } } }, { domains: { px: DOMAINS["px"] as Domain } });
    const ba = mergeMachines({ domains: { px: DOMAINS["px"] as Domain } }, { domains: { color: { ...color } } }, { domains: { color } });
    expect(Object.keys(ab.domains ?? {}).sort()).toEqual(["color", "px"]);
    expect(Object.keys(ba.domains ?? {}).sort()).toEqual(["color", "px"]);
    const conflicts = conflictsOf(() => mergeMachines({ domains: { color } }, { domains: { color: other } }));
    expect(conflicts).toEqual([{ path: ["domains", "color"], parts: [0, 1], reason: "Two parts give two different domains for this base type." }]);
    expect(conflictsOf(() => mergeMachines({ domains: { color } }, { domains: { color: { ...color, under: ["text", "length"] } } }))).toHaveLength(1);
    // The later part names the path in replaces, and its domain wins.
    const replaced = mergeMachines({ domains: { color } }, { domains: { color: other }, replaces: [["domains", "color"]] });
    expect(member("green", "color", replaced.domains)).toBe(true);
    // The formula kit gives the kernel domains. Another number is a conflict, unless the language replaces it.
    const strict: Domain = { is: (value) => typeof value === "number" && !Number.isNaN(value) };
    expect(conflictsOf(() => formulaMachine({}, { domains: { number: strict } })).map((item) => item.path)).toEqual([["domains", "number"]]);
    const own = formulaMachine({}, { domains: { number: strict }, replaces: [["domains", "number"]] });
    expect(member(Number.NaN, "number", own.domains)).toBe(false);
    // Two languages on the kit share the kernel domains, and their own domains join.
    const kit = formulaMachine({}, { domains: { color } });
    const both = mergeMachines({ domains: STD_DOMAINS }, { domains: STD_MACHINE.domains ?? {} }, { domains: kit.domains ?? {} });
    expect(Object.keys(both.domains ?? {}).sort()).toEqual(["bool", "color", "null", "number", "text"]);
    // A restriction removes a domain by its path.
    const without = restrictMachine(both, [["domains", "color"]]);
    expect(Object.keys(without.domains ?? {})).not.toContain("color");
    expect(fits("color", "number", without.domains)).toBe(true);
  });

  it("[TYPE.JOIN] the join holds each member of both types, and both types fit it, for generated types without unknown", () => {
    const pool = poolOf(31, 50, false);
    const rng = random(13);
    let checked = 0;
    for (const a of pool) {
      for (const b of pool) {
        const joined = join(a, b, DOMAINS);
        const label = `${JSON.stringify(a)} join ${JSON.stringify(b)} = ${JSON.stringify(joined)}`;
        expect(fits(a, joined, DOMAINS) && fits(b, joined, DOMAINS), label).toBe(true);
        for (const side of [a, b]) {
          const value = sampleOf(rng, side);
          if (value === NONE) continue;
          checked += 1;
          expect(member(value, joined, DOMAINS), `${JSON.stringify(value)}: ${label}`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it("[TYPE.JOIN] unknown absorbs, never is the unit, and lists, records, one and unions join by their parts", () => {
    for (const type of poolOf(17, 30, true)) {
      expect(join("unknown", type, DOMAINS)).toBe("unknown");
      expect(join(type, "never", DOMAINS)).toBe(type);
      expect(join(type, type, DOMAINS)).toBe(type);
    }
    expect(join({ one: [1] }, { one: [2] })).toEqual({ one: [1, 2] });
    expect(join({ one: [1] }, { one: [2, 1] })).toEqual({ one: [2, 1] });
    expect(join("number", { one: [1] })).toBe("number");
    expect(join("whole", "finite", DOMAINS)).toBe("finite");
    expect(join("number", "text")).toEqual({ union: ["number", "text"] });
    expect(join({ list: { one: [1] } }, { list: { one: ["a"] } })).toEqual({ list: { one: [1, "a"] } });
    expect(join({ union: ["number", { one: ["a"] }] }, { one: ["b"] })).toEqual({ union: ["number", { one: ["a", "b"] }] });
    // The strict form keeps the join sound: a list of unknown items is wider than a list of numbers.
    expect(join({ list: "unknown" }, { list: "number" })).toEqual({ list: "unknown" });
    // Two closed records: a field of one record is optional. An open record keeps only the common fields.
    expect(join({ record: { a: "number" }, closed: true }, { record: { b: "text" }, closed: true })).toEqual({ record: { a: "number", b: "text" }, optional: ["a", "b"], closed: true });
    expect(join({ record: { a: "number", c: "bool" } }, { record: { a: "text" }, closed: true })).toEqual({ record: { a: { union: ["number", "text"] } } });
    expect(join({ record: { a: "number" }, optional: ["a"], closed: true }, { record: { a: "whole" }, closed: true }, DOMAINS)).toEqual({ record: { a: "number" }, optional: ["a"], closed: true });
    // A field with the name __proto__ stays an own field.
    const proto = join(JSON.parse('{"record":{"__proto__":{"one":[1]}},"closed":true}') as ValueType, JSON.parse('{"record":{"__proto__":{"one":[2]}},"closed":true}') as ValueType);
    expect(member(JSON.parse('{"__proto__":2}'), proto)).toBe(true);
    expect(member({}, proto)).toBe(false);
  });

  it("[TYPE.TEXT] typeText gives a short text of each term for the reason of an issue", () => {
    const cases: readonly (readonly [unknown, string])[] = [
      ["number", "number"],
      ["color", "color"],
      [{ list: "text" }, "list<text>"],
      [{ record: { a: "number", b: "text" }, optional: ["b"], closed: true }, "{a: number, b?: text}"],
      [{ record: { a: "number" } }, "{a: number, ...}"],
      [{ record: {} }, "{...}"],
      [{ record: {}, closed: true }, "{}"],
      [{ record: { "a b": "null" }, closed: true }, '{"a b": null}'],
      [{ fn: ["number", "text"], to: "bool" }, "(number, text) => bool"],
      [{ union: ["number", "null"] }, "number | null"],
      [{ union: [] }, "never"],
      [{ one: [] }, "never"],
      [{ one: [1, "a", null, [true]] }, '1 | "a" | null | [true]'],
      [{ list: { union: ["number", "text"] } }, "list<number | text>"],
      [{ union: [{ fn: [], to: "number" }, "null"] }, "(() => number) | null"],
      [{ fn: ["number"], to: { union: ["text", "null"] } }, "(number) => (text | null)"],
      [{ var: "A" }, "unknown"],
      [{ list: "number", extra: 1 }, "unknown"],
    ];
    for (const [type, text] of cases) expect(typeText(type as ValueType), JSON.stringify(type)).toBe(text);
    // A long list of values and a long value are cut.
    expect(typeText({ one: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })).toBe("1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | … 4 more");
    expect(typeText({ one: ["x".repeat(100)] })).toHaveLength(40);
    // A deep term and a value that JSON cannot write do not throw.
    let deep: ValueType = "number";
    for (let index = 0; index < 400; index += 1) deep = { list: deep };
    expect(typeText(deep)).toMatch(/^list<.*unknown.*>$/);
    expect(typeText({ one: [10n as unknown as Json] })).toBe("10");
  });
});
