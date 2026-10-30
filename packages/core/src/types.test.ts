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
  extendDomain,
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

const BASES = ["null", "undefined", "bool", "number", "text", "finite", "whole", "length", "px", "color"] as const;

/** The JSON values that the generator puts in `one`, and that the samples of `unknown` use. */
const VALUES: readonly Json[] = [null, true, false, 0, -0, 1, 1.5, -2, "", "a", "#00ff00", [], [1], [1, "a"], [[2]], {}, { a: 1 }, { a: "x" }, { a: 1, b: true }, { c: null }];

/** The samples of each base type. Each sample is a member of its base type. */
const BASE_SAMPLES: Readonly<Record<string, readonly unknown[]>> = {
  null: [null],
  undefined: [undefined],
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

/** This function gives a random member of a type, or `NONE` when it finds none. `samples` gives the members of each base type. */
function sampleOf(rng: Random, type: ValueType, samples: Readonly<Record<string, readonly unknown[]>> = BASE_SAMPLES): unknown {
  if (type === "unknown") return rng.pick(VALUES);
  if (type === "never") return NONE;
  if (typeof type === "string") return rng.pick(samples[type] as readonly unknown[]);
  if ("list" in type) {
    const items = Array.from({ length: rng.int(3) }, () => sampleOf(rng, type.list, samples));
    return items.filter((item) => item !== NONE);
  }
  if ("record" in type) {
    const out: Record<string, unknown> = {};
    for (const [name, field] of Object.entries(type.record)) {
      const optional = type.optional?.includes(name) === true;
      if (optional && rng.chance(0.5)) continue;
      const value = sampleOf(rng, field, samples);
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
    const found = type.union.map((each) => sampleOf(rng, each, samples)).filter((value) => value !== NONE);
    return found.length === 0 ? NONE : rng.pick(found);
  }
  return type.one.length === 0 ? NONE : rng.pick(type.one);
}

/** This function tells if a sample is `undefined` or holds `undefined` at some depth. */
function holdsUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(holdsUndefined);
  return typeof value === "object" && value !== null && Object.values(value).some(holdsUndefined);
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
      // JSON has no undefined, thus `one` cannot hold a sample with it.
      if (value !== NONE && typeof value !== "function" && !holdsUndefined(value)) out.push({ one: [value as Json] });
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

/**
 * The domains of a language with covers (D85): neg and nonneg split number, zero and plus split nonneg, and empty and
 * filled split text. NaN and the infinities are not negative, thus nonneg and plus hold them.
 */
const COVERED: Readonly<Record<string, Domain>> = {
  ...DOMAINS,
  number: { ...(STD_DOMAINS["number"] as Domain), covers: [["neg", "nonneg"]] },
  neg: { is: (value) => (value as number) < 0, under: ["number"], summary: "A negative number." },
  nonneg: { is: (value) => !((value as number) < 0), under: ["number"], covers: [["zero", "plus"]], summary: "A number that is not negative." },
  zero: { is: (value) => value === 0, under: ["nonneg"], summary: "Zero or -0." },
  plus: { is: (value) => value !== 0, under: ["nonneg"], summary: "A number that is not negative and not zero." },
  text: { ...(STD_DOMAINS["text"] as Domain), covers: [["empty", "filled"]] },
  empty: { is: (value) => value === "", under: ["text"], values: [""], summary: "The empty text." },
  filled: { is: (value) => value !== "", under: ["text"], summary: "A text that is not empty." },
};

/** The samples of each base type of `COVERED`. Each sample is a member of its base type. */
const COVER_SAMPLES: Readonly<Record<string, readonly unknown[]>> = {
  ...BASE_SAMPLES,
  number: [0, -0, 1.5, -3, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
  neg: [-3, -0.5, Number.NEGATIVE_INFINITY],
  nonneg: [0, -0, 2, Number.NaN, Number.POSITIVE_INFINITY],
  zero: [0, -0],
  plus: [2, Number.NaN, Number.POSITIVE_INFINITY],
  empty: [""],
  filled: ["a", "#00ff00"],
};

/**
 * This function finds the false covers of a language from samples: each sample of a covered domain that no domain of
 * the cover holds. A test helper uses it, because `fits` trusts the covers.
 */
function falseCovers(domains: Readonly<Record<string, Domain>>, samples: Readonly<Record<string, readonly unknown[]>>): readonly string[] {
  const out: string[] = [];
  for (const [name, domain] of Object.entries(domains)) {
    for (const cover of domain.covers ?? []) {
      for (const value of samples[name] ?? []) if (!cover.some((part) => member(value, part, domains))) out.push(`${name}: ${String(value)} is in no domain of ${cover.join(", ")}`);
    }
  }
  return out;
}

/**
 * This function tests a seeded corpus of records with covered fields and union fields over a language (D90). The
 * unions hold the type splits of each record by the covers of the language. Thus a false cover gives a fit.
 */
function splitCorpus(domains: Readonly<Record<string, Domain>>): {
  readonly pairs: number;
  readonly total: number;
  readonly split: number;
  readonly cover: number;
  readonly checked: number;
  readonly bad: readonly string[];
} {
  type Rec = { record: Record<string, ValueType>; optional?: string[]; closed?: true };
  const plain: Record<string, Domain> = {};
  for (const [name, domain] of Object.entries(domains)) {
    const { covers: _covers, ...rest } = domain;
    plain[name] = rest;
  }
  const leaves: readonly ValueType[] = [
    "number",
    "nonneg",
    "text",
    "bool",
    "null",
    "whole",
    { union: ["number", "null"] },
    { union: ["nonneg", "text"] },
    { union: [{ record: { x: "bool" } }, { record: { y: "number" } }] },
  ];
  const wide: readonly ValueType[] = [...leaves, "neg", "zero", "plus", "empty", "filled", { one: [true] }, { union: ["neg", "text"] }];
  const rng = random(90);
  const shapeOf = (fields: Record<string, ValueType>, open: number): Rec => {
    const optional = Object.keys(fields).filter(() => rng.chance(0.2));
    return { record: fields, ...(optional.length > 0 ? { optional } : {}), ...(rng.chance(open) ? {} : { closed: true }) };
  };
  const innerOf = (from: readonly ValueType[]): Rec => {
    const fields: Record<string, ValueType> = {};
    for (const name of ["x", "y"]) if (rng.chance(0.8)) fields[name] = rng.pick(from);
    return shapeOf(fields, 0.6);
  };
  const outerOf = (from: readonly ValueType[]): Rec => {
    const fields: Record<string, ValueType> = { a: rng.chance(0.6) ? rng.pick(from) : innerOf(from) };
    if (rng.chance(0.5)) fields["b"] = rng.pick(from);
    return shapeOf(fields, 0.7);
  };
  const pathsOf = (type: Rec, prefix: readonly string[]): string[][] =>
    Object.entries(type.record).flatMap(([key, field]) => (typeof field === "object" && "record" in field ? pathsOf(field as Rec, [...prefix, key]) : [[...prefix, key]]));
  const fieldAt = (type: Rec, path: readonly string[]): ValueType => path.reduce<ValueType>((at, key) => (at as Rec).record[key] as ValueType, type);
  const narrowed = (type: Rec, path: readonly string[], to: ValueType): Rec => {
    const [key, ...rest] = path as [string, ...string[]];
    const fields: Record<string, ValueType> = {};
    for (const [name, field] of Object.entries(type.record)) {
      if (name === key) fields[name] = rest.length === 0 ? to : narrowed(field as Rec, rest, to);
      else fields[name] = typeof field === "string" && rng.chance(0.1) ? rng.pick(wide) : field;
    }
    const optional = (type.optional ?? []).filter((name) => name !== key || rest.length > 0 || rng.chance(0.5));
    return { record: fields, ...(optional.length > 0 ? { optional } : {}), ...(type.closed === true && rng.chance(0.7) ? { closed: true } : {}) };
  };
  // The cases of a field: the first cover of its domain, the members of a union, or the values of bool.
  const coverOf = (type: ValueType): readonly string[] | undefined => (typeof type === "string" ? domains[type]?.covers?.[0] : undefined);
  const casesOf = (type: ValueType): ValueType[] => {
    const first: ValueType[] = coverOf(type) !== undefined ? [...(coverOf(type) ?? [])] : typeof type === "object" && "union" in type ? [...type.union] : type === "bool" ? [{ one: [true] }, { one: [false] }] : [type];
    // A case with its own cover, or a record with a field of bool, sometimes splits again.
    const again = first.flatMap((each): ValueType[] => {
      if (coverOf(each) !== undefined && rng.chance(0.4)) return [...(coverOf(each) ?? [])];
      if (typeof each === "object" && "record" in each && each.record["x"] === "bool" && rng.chance(0.5)) return [true, false].map((value) => ({ record: { x: { one: [value] } } }));
      return [each];
    });
    return again.map((each) => (rng.chance(0.15) ? rng.pick(wide) : each));
  };
  const founds: Rec[] = Array.from({ length: 120 }, () => outerOf(leaves));
  const unions: ValueType[] = Array.from({ length: 40 }, () => ({ union: Array.from({ length: 1 + rng.int(3) }, () => outerOf(wide)) }));
  for (const found of [...founds, ...founds]) {
    const paths = pathsOf(found, []).filter((path) => casesOf(fieldAt(found, path)).length > 1);
    if (paths.length === 0) continue;
    const path = rng.pick(paths);
    let parts = casesOf(fieldAt(found, path)).map((to) => narrowed(found, path, to));
    // A second path sometimes splits each part again: a cover split and a value split together.
    const others = paths.filter((other) => other[0] !== path[0]);
    if (others.length > 0 && rng.chance(0.4)) {
      const second = rng.pick(others);
      parts = parts.flatMap((part) => casesOf(fieldAt(part, second)).map((to) => narrowed(part, second, to)));
    }
    if (parts.length > 1 && rng.chance(0.2)) parts.splice(rng.int(parts.length), 1);
    unions.push({ union: parts });
  }
  let pairs = 0;
  let split = 0;
  let cover = 0;
  let checked = 0;
  const bad: string[] = [];
  for (const found of founds) {
    const members = Array.from({ length: 10 }, () => sampleOf(rng, found, COVER_SAMPLES)).filter((value) => value !== NONE);
    for (const value of members) if (!member(value, found, domains)) bad.push(`${JSON.stringify(value)} is not in ${JSON.stringify(found)}`);
    for (const expected of unions) {
      if (!fits(found, expected, domains)) continue;
      pairs += 1;
      if (!(expected as { union: ValueType[] }).union.some((each) => fits(found, each, domains))) split += 1;
      if (!fits(found, expected, plain)) cover += 1;
      for (const value of members) {
        checked += 1;
        if (!member(value, expected, domains)) bad.push(`${String(value)}: ${JSON.stringify(found)} fits ${JSON.stringify(expected)}`);
      }
    }
  }
  return { pairs, total: founds.length * unions.length, split, cover, checked, bad };
}

/** This function tests a seeded corpus of types over the domains of `COVERED`: each pair that fits, with the sampled members of `found`. */
function coverCorpus(domains: Readonly<Record<string, Domain>>): { readonly types: number; readonly pairs: number; readonly cover: number; readonly checked: number; readonly bad: readonly string[] } {
  // The same domains without covers. The pairs that fit only with the covers are the pairs of the cover rule.
  const plain: Record<string, Domain> = {};
  for (const [name, domain] of Object.entries(domains)) {
    const { covers: _covers, ...rest } = domain;
    plain[name] = rest;
  }
  const bases = ["number", "neg", "nonneg", "zero", "plus", "whole", "finite", "text", "empty", "filled", "bool", "null", "never"] as const;
  const children = [["neg", "nonneg"], ["neg", "zero", "plus"], ["empty", "filled"], ["zero", "plus"], ["neg", "zero"]] as const;
  const rng = random(85);
  const typeAt = (depth: number): ValueType => {
    if (depth <= 0 || rng.chance(0.4)) return rng.chance(0.3) ? { union: [...rng.pick(children), ...(rng.chance(0.3) ? [rng.pick(bases)] : [])] } : rng.pick(bases);
    const next = (): ValueType => typeAt(depth - 1);
    switch (rng.int(3)) {
      case 0:
        return { list: next() };
      case 1: {
        const names = ["a", "b"].filter(() => rng.chance(0.6));
        const record: Record<string, ValueType> = {};
        for (const name of names) record[name] = next();
        return { record, ...(rng.chance(0.5) ? { closed: true } : {}) };
      }
      default:
        return { union: Array.from({ length: 1 + rng.int(3) }, next) };
    }
  };
  const pool: ValueType[] = Array.from({ length: 160 }, () => typeAt(2));
  let pairs = 0;
  let cover = 0;
  let checked = 0;
  const bad: string[] = [];
  for (const found of pool) {
    const members = Array.from({ length: 8 }, () => sampleOf(rng, found, COVER_SAMPLES)).filter((value) => value !== NONE);
    for (const value of members) if (!member(value, found, domains)) bad.push(`${String(value)} is not in ${JSON.stringify(found)}`);
    for (const expected of pool) {
      if (!fits(found, expected, domains)) continue;
      pairs += 1;
      if (!fits(found, expected, plain)) cover += 1;
      for (const value of members) {
        checked += 1;
        if (!member(value, expected, domains)) bad.push(`${String(value)}: ${JSON.stringify(found)} fits ${JSON.stringify(expected)}`);
      }
    }
  }
  return { types: pool.length, pairs, cover, checked, bad };
}

describe("value types and value domains", () => {
  it("[TYPE.BASE] the kernel has unknown, never, null, undefined, bool, number and text, and each text names a base type", () => {
    expect(Object.keys(STD_DOMAINS).sort()).toEqual(["bool", "null", "number", "text", "undefined"]);
    expect(member(null, "null")).toBe(true);
    expect(member(undefined, "null")).toBe(false);
    // The base type undefined holds only undefined (D48). JSON has no such value, thus no `one` holds it.
    expect(member(undefined, "undefined")).toBe(true);
    for (const value of [null, 0, false, "", Number.NaN, [], {}, () => undefined]) expect(member(value, "undefined"), String(value)).toBe(false);
    expect(member(new Array(2), { list: "undefined" })).toBe(true);
    expect(member({ a: undefined }, { record: { a: "undefined" }, closed: true })).toBe(true);
    expect(member({}, { record: { a: "undefined" } })).toBe(false);
    expect(member(undefined, { union: ["null", "undefined"] })).toBe(true);
    expect(typeIssues("undefined")).toEqual([]);
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
    // An open record splits its finite field over a union (K178, D84). A record does not split over a record.
    const split: ValueType = { union: [{ record: { a: { one: [true] } } }, { record: { a: { one: [false] } } }] };
    expect(fits({ record: { a: "bool" } }, split)).toBe(true);
    expect(fits({ record: { a: "number" } }, split)).toBe(false);
  });

  it("[TYPE.FITS] never is the bottom: it fits each type, and only an empty type fits it", () => {
    for (const type of poolOf(5, 60, true)) expect(fits("never", type, DOMAINS)).toBe(true);
    expect(fits({ union: [] }, "number")).toBe(true);
    expect(fits({ one: [] }, "never")).toBe(true);
    expect(fits({ union: ["never", { one: [] }] }, "never")).toBe(true);
    for (const type of ["null", "number", { list: "never" }, { one: [null] }, { record: {} }] as const) expect(fits(type, "never")).toBe(false);
  });

  it("[TYPE.FITS] the base type undefined fits only itself, unions with it and unknown, and no other base type fits it", () => {
    for (const other of ["null", "bool", "number", "text", { one: [null] }, { list: "unknown" }, { record: {} }] as const) {
      expect(fits("undefined", other), JSON.stringify(other)).toBe(false);
      expect(fits(other, "undefined"), JSON.stringify(other)).toBe(false);
    }
    expect(fits("undefined", "undefined")).toBe(true);
    expect(fits("undefined", { union: ["number", "undefined"] })).toBe(true);
    expect(fits("undefined", "unknown")).toBe(true);
    expect(fits("never", "undefined")).toBe(true);
    expect(fits({ one: [] }, "undefined")).toBe(true);
    // A domain of a language with the parent undefined fits it, and its test adds the test of undefined.
    const absent: Domain = { is: () => true, under: ["undefined"], summary: "A value that the host left out." };
    expect(fits("absent", "undefined", { absent })).toBe(true);
    expect(member(null, "absent", { absent })).toBe(false);
    // The join of undefined and another type is a union, and the union holds both.
    expect(join("undefined", "number")).toEqual({ union: ["undefined", "number"] });
    expect(join({ one: [1] }, "undefined")).toEqual({ union: [{ one: [1] }, "undefined"] });
    expect(join("undefined", "undefined")).toBe("undefined");
    expect(join("undefined", "unknown")).toBe("unknown");
    expect(typeText({ union: ["number", "undefined"] })).toBe("number | undefined");
  });

  it("[TYPE.FITS-FINITE] a type with few members fits when each member is a member of expected", () => {
    // A base type with a list of values: bool, null and undefined of the kernel.
    expect(fits("bool", { one: [true, false] })).toBe(true);
    expect(fits("bool", { union: [{ one: [true] }, { one: [false] }] })).toBe(true);
    expect(fits("bool", { union: [{ one: [false, 1] }, { list: "text" }, { one: [true] }] })).toBe(true);
    expect(fits("bool", { one: [true] })).toBe(false);
    expect(fits("null", { one: [null, 1] })).toBe(true);
    expect(fits({ union: ["null", "bool"] }, { one: [false, null, true] })).toBe(true);
    expect(fits({ union: ["undefined", "bool"] }, { union: [{ one: [true, false] }, "undefined"] })).toBe(true);
    // A base type without a list does not fit a `one`.
    expect(fits("number", { one: [0, 1] })).toBe(false);
    expect(fits("text", { one: [""] })).toBe(false);
    // The parts of a list and of a record get the rule, and a closed record with few members splits over its fields.
    expect(fits({ list: "bool" }, { list: { one: [true, false] } })).toBe(true);
    expect(fits({ record: { a: "bool" } }, { record: { a: { one: [true, false] } } })).toBe(true);
    const flags: ValueType = { record: { a: "bool", b: "null" }, optional: ["b"], closed: true };
    expect(fits(flags, { one: [{ a: true }, { a: false }, { a: true, b: null }, { b: null, a: false }] })).toBe(true);
    expect(fits(flags, { one: [{ a: true }, { a: false }, { a: true, b: null }] })).toBe(false);
    const split: ValueType = { union: [{ record: { a: { one: [true] } } }, { record: { a: { one: [false] }, b: "unknown" }, optional: ["b"] }] };
    expect(fits({ record: { a: "bool" }, closed: true }, split)).toBe(true);
    expect(fits({ record: { a: "bool" } }, { one: [{ a: true }, { a: false }] })).toBe(false);
    // A record with a needed field without members has no members, and a list of never holds only the empty list.
    expect(fits({ record: { a: "never", b: "number" } }, "text")).toBe(true);
    expect(fits({ record: { a: "never" }, optional: ["a"] }, "text")).toBe(false);
    expect(fits({ list: "never" }, { one: [[]] })).toBe(true);
    expect(fits({ list: "never" }, "never")).toBe(false);
    // A domain of a language declares its values. A value that fails a test does not count, and a parent gives its list.
    const domains: Readonly<Record<string, Domain>> = {
      align: { is: (value) => value === "left" || value === "right", values: ["left", "right", "up"], under: ["text"] },
      on: { is: (value) => value === true, under: ["bool"] },
      many: { is: (value) => typeof value === "number", values: Array.from({ length: 65 }, (_, index) => index), under: ["number"] },
    };
    expect(fits("align", { one: ["right", "left"] }, domains)).toBe(true);
    expect(fits("on", { one: [true] }, domains)).toBe(true);
    expect(fits("on", { one: [false] }, domains)).toBe(false);
    // A list of more than 64 values does not count.
    expect(fits("many", { one: Array.from({ length: 65 }, (_, index) => index) }, domains)).toBe(false);
    // The strict join reads the rule too. Thus bool and the `one` of its values join to the later type.
    expect(join("bool", { one: [true, false] })).toEqual({ one: [true, false] });
    expect(join({ one: [true, false] }, "bool")).toBe("bool");
    expect(join({ one: [true] }, { one: [false] })).toEqual({ one: [true, false] });
  });

  it("[TYPE.FITS-FINITE] an open record splits a field with few members over a union of records (D84)", () => {
    const bool: (value: boolean) => ValueType = (value) => ({ one: [value] });
    // The example of K178: each value of the field a gives a record, and each record fits a member of the union.
    const byA: ValueType = { union: [{ record: { a: bool(true) } }, { record: { a: bool(false) } }] };
    expect(fits({ record: { a: "bool" } }, byA)).toBe(true);
    expect(fits({ record: { a: "bool", b: "number" } }, byA)).toBe(true);
    expect(fits({ record: { a: "bool" } }, { union: [{ record: { a: bool(true) } }, { record: { b: "number" } }] })).toBe(false);
    // A two-field split: the split of a does not give a fit, thus each record of the split splits b.
    const both: ValueType = {
      union: [{ record: { a: bool(true), b: "null" } }, { record: { a: bool(false), b: "null" } }, { record: { a: "bool", b: bool(true) } }, { record: { a: "bool", b: bool(false) } }],
    };
    const two: ValueType = { record: { a: "bool", b: { union: ["null", "bool"] } } };
    expect(fits(two, both)).toBe(true);
    expect(fits(two, { union: (both as { union: ValueType[] }).union.slice(0, 3) })).toBe(false);
    // An optional field gives a record without the field too. Thus the union needs a member for the absent case.
    const optionalA: ValueType = { record: { a: "bool" }, optional: ["a"] };
    expect(fits(optionalA, { union: [...(byA as { union: ValueType[] }).union, { record: { a: "never" }, optional: ["a"] }] })).toBe(true);
    expect(fits(optionalA, { union: [{ record: { a: bool(true) }, optional: ["a"] }, { record: { a: bool(false) } }] })).toBe(true);
    expect(fits(optionalA, byA)).toBe(false);
    // The other fields of an open record stop the fit: a member of the union that holds only known fields refuses them.
    expect(fits({ record: { a: "bool" } }, { union: [{ record: { a: bool(true) }, closed: true }, { record: { a: bool(false) } }] })).toBe(false);
    expect(fits({ record: { a: "bool", b: "text" } }, { union: [{ record: { a: bool(true), b: "number" } }, { record: { a: bool(false) } }] })).toBe(false);
    // An open record does not split over a `one`: its other fields hold each value.
    expect(fits({ record: { a: "bool" } }, { one: [{ a: true }, { a: false }] })).toBe(false);
    // A closed and an open record: the closed record fits each member, the open record fits only the open members.
    const mixed: ValueType = { union: [{ record: { a: bool(true) }, closed: true }, { record: { a: bool(false) } }] };
    expect(fits({ record: { a: "bool" }, closed: true }, mixed)).toBe(true);
    expect(fits({ record: { a: "bool" } }, mixed)).toBe(false);
    expect(fits({ union: [{ record: { a: "bool" }, closed: true }, { record: { a: bool(false), b: "text" } }] }, mixed)).toBe(true);
    // A closed record with more than 64 members splits too. Each record of the split gets the finite rule.
    const seven = Object.fromEntries(["a", "b", "c", "d", "e", "f", "g"].map((key) => [key, "bool"])) as Record<string, ValueType>;
    const wide: ValueType = { record: seven, closed: true };
    expect(fits(wide, { union: [{ record: { ...seven, a: bool(true) }, closed: true }, { record: { ...seven, a: bool(false) }, closed: true }] })).toBe(true);
    expect(fits(wide, { union: [{ record: { ...seven, a: bool(true) }, closed: true }, { record: { ...seven, a: bool(false), g: bool(true) }, closed: true }] })).toBe(false);
    // A split builds at most 64 records. Seven fields against a union of each member need 254 records, thus the rule refuses.
    const eachMember = (keys: readonly string[]): ValueType => {
      const members: ValueType[] = [];
      for (let bits = 0; bits < 2 ** keys.length; bits += 1) members.push({ record: Object.fromEntries(keys.map((key, index) => [key, bool(((bits >> index) & 1) === 1)])) });
      return { union: members };
    };
    expect(fits({ record: seven }, eachMember(Object.keys(seven)))).toBe(false);
    expect(fits({ record: { a: "bool", b: "bool", c: "bool" } }, eachMember(["a", "b", "c"]))).toBe(true);
    // The gradual rule of unknown does not change: a field of unknown does not split, and unknown in found fits.
    expect(fits({ record: { a: "unknown" } }, byA)).toBe(true);
    expect(fits({ record: { a: "bool", b: "unknown" } }, { union: [{ record: { a: bool(true), b: "number" } }, { record: { a: bool(false), b: "text" } }] })).toBe(true);
  });

  it("[TYPE.FITS-PATH] a split narrows a field of a record in a field by its path, with one budget at each depth (D89)", () => {
    const bool: (value: boolean) => ValueType = (value) => ({ one: [value] });
    const inA = (fields: Record<string, ValueType>, more: { optional?: string[]; closed?: true } = {}): ValueType => ({ record: { a: { record: fields, ...more } } });
    // The example of K185: the path a.x gives a record for each value, and each record fits a member of the union.
    const byX: ValueType = { union: [inA({ x: bool(true) }), inA({ x: bool(false) })] };
    expect(fits(inA({ x: "bool" }), byX)).toBe(true);
    expect(fits({ record: { a: { record: { x: "bool", y: "text" } }, b: "number" } }, byX)).toBe(true);
    expect(fits(inA({ x: "bool" }), { union: [inA({ x: bool(true) }), inA({ x: "null" })] })).toBe(false);
    // Two depths: the path a.b.x.
    const deep = (x: ValueType): ValueType => ({ record: { a: { record: { b: { record: { x } } } } } });
    expect(fits(deep("bool"), { union: [deep(bool(true)), deep(bool(false))] })).toBe(true);
    expect(fits(deep("bool"), { union: [deep(bool(true)), deep("null")] })).toBe(false);
    // An inner optional field also gives the absent case. An open inner record gets an optional field of type never.
    const optionalX = inA({ x: "bool" }, { optional: ["x"] });
    expect(fits(optionalX, byX)).toBe(false);
    expect(fits(optionalX, { union: [...(byX as { union: ValueType[] }).union, inA({ x: "never" }, { optional: ["x"] })] })).toBe(true);
    // A closed inner record with a field without a finite list splits by its path too. Its absent case removes the field.
    const closed = inA({ x: "bool", n: "number" }, { optional: ["x"], closed: true });
    const parts: ValueType[] = [inA({ x: bool(true), n: "number" }, { closed: true }), inA({ x: bool(false), n: "number" }, { closed: true })];
    expect(fits(closed, { union: [...parts, inA({ n: "number" }, { closed: true })] })).toBe(true);
    expect(fits(closed, { union: parts })).toBe(false);
    // An inner field stops the fit: the record for true has a field of text, and the union needs a number there.
    expect(fits(inA({ x: "bool", y: "text" }), { union: [inA({ x: bool(true), y: "number" }), inA({ x: bool(false) })] })).toBe(false);
    // The fields of the record split first, then the paths. Each record of the split of b splits a.x.
    const withB: ValueType = { record: { a: { record: { x: "bool" } }, b: "bool" } };
    const four: ValueType[] = [];
    for (const b of [true, false]) for (const x of [true, false]) four.push({ record: { a: { record: { x: bool(x) } }, b: bool(b) } });
    expect(fits(withB, { union: four })).toBe(true);
    expect(fits(withB, { union: four.slice(1) })).toBe(false);
    // Since D90, a union in a field splits into its members, and a path goes on into a member (K191).
    const either: ValueType = { record: { a: { union: [{ record: { x: "bool" } }, { record: { y: "null" } }] } } };
    expect(fits(either, { union: [...(byX as { union: ValueType[] }).union, inA({ y: "null" })] })).toBe(true);
    // The gradual rule of unknown does not change.
    expect(fits(inA({ x: "unknown" }), byX)).toBe(true);
    expect(fits({ record: { a: "unknown" } }, byX)).toBe(true);
    // One budget of 64 records serves the split at each depth. Five fields at a.k need 62 records, six fields need 126.
    const keysOf = (count: number): string[] => ["k1", "k2", "k3", "k4", "k5", "k6"].slice(0, count);
    const allOf = (keys: readonly string[]): ValueType[] => {
      const members: ValueType[] = [];
      for (let bits = 0; bits < 2 ** keys.length; bits += 1) members.push({ record: Object.fromEntries(keys.map((key, index) => [key, bool(((bits >> index) & 1) === 1)])) });
      return members;
    };
    const flags = (count: number): ValueType => ({ record: Object.fromEntries(keysOf(count).map((key) => [key, "bool"])) });
    expect(fits({ record: { a: flags(5) } }, { union: allOf(keysOf(5)).map((each) => ({ record: { a: each } })) })).toBe(true);
    expect(fits({ record: { a: flags(6) } }, { union: allOf(keysOf(6)).map((each) => ({ record: { a: each } })) })).toBe(false);
    // A split inside the work of a split takes from the same budget. The split of b builds 2 records, and each splits a in the shapes.
    const nested = (count: number): ValueType => ({ union: [true, false].map((b) => ({ record: { b: bool(b), a: { union: allOf(keysOf(count)) } } })) });
    expect(fits({ record: { b: "bool", a: flags(4) } }, nested(4))).toBe(true);
    expect(fits({ record: { b: "bool", a: flags(5) } }, nested(5))).toBe(false);
    // Each split alone fits under the budget: a by itself needs 62 records.
    expect(fits(flags(5), { union: allOf(keysOf(5)) })).toBe(true);
  });

  it("[TYPE.FITS-FINITE] a merge compares the values of two domains, and extendDomain keeps them", () => {
    const align: Domain = { is: (value) => value === "left" || value === "right", values: ["left", "right"], under: ["text"] };
    expect(Object.keys(mergeMachines({ domains: { align } }, { domains: { align: { ...align, values: ["left", "right"] } } }).domains ?? {})).toEqual(["align"]);
    expect(conflictsOf(() => mergeMachines({ domains: { align } }, { domains: { align: { ...align, values: ["left"] } } }))).toHaveLength(1);
    expect(conflictsOf(() => mergeMachines({ domains: { align } }, { domains: { align: { is: align.is, under: ["text"] } } }))).toHaveLength(1);
    const extended = extendDomain("bool", { under: ["truth"] })({ world: { kinds: {}, defaults: {} }, evaluators: {} });
    expect(extended.domains?.["bool"]?.values).toEqual([true, false]);
    const truth: Domain = { is: () => true };
    expect(fits("bool", { one: [false, true] }, { ...extended.domains, truth })).toBe(true);
  });

  it("[TYPE.FITS-SOUND] a sampled member of found is a member of expected for each pair that fits, in a seeded corpus of finite types", () => {
    // The domains of a small language: a list with a value that fails the test, and a domain that a parent gives its list.
    const domains: Readonly<Record<string, Domain>> = {
      ...DOMAINS,
      align: { is: (value) => value === "left" || value === "right", values: ["left", "right", "up"], under: ["text"] },
      on: { is: (value) => value === true, under: ["bool"] },
    };
    // The same domains without the lists. The pairs that fit only with the lists are the pairs of the finite rule.
    const plain: Readonly<Record<string, Domain>> = {
      ...DOMAINS,
      null: { is: (value) => value === null },
      undefined: { is: (value) => value === undefined },
      bool: { is: (value) => typeof value === "boolean" },
      align: { is: domains["align"]?.is as Domain["is"], under: ["text"] },
      on: { is: domains["on"]?.is as Domain["is"], under: ["bool"] },
    };
    const samples: Readonly<Record<string, readonly unknown[]>> = { ...BASE_SAMPLES, align: ["left", "right"], on: [true] };
    const bases = ["null", "undefined", "bool", "on", "align", "number", "text", "whole", "never"] as const;
    const values: readonly Json[] = [true, false, null, 0, 1, "left", "right", "a", [], [true], {}, { a: true }, { a: false }, { a: null, b: true }];
    const typeAt = (rng: Random, depth: number): ValueType => {
      if (depth <= 0 || rng.chance(0.35)) return rng.chance(0.75) ? rng.pick(bases) : { one: values.filter(() => rng.chance(0.2)) };
      const next = (): ValueType => typeAt(rng, depth - 1);
      switch (rng.int(3)) {
        case 0:
          return { list: next() };
        case 1: {
          const names = ["a", "b"].filter(() => rng.chance(0.6));
          const record: Record<string, ValueType> = {};
          for (const name of names) record[name] = next();
          const optional = names.filter(() => rng.chance(0.3));
          return { record, ...(optional.length > 0 ? { optional } : {}), ...(rng.chance(0.7) ? { closed: true } : {}) };
        }
        default:
          return { union: Array.from({ length: 1 + rng.int(3) }, next) };
      }
    };
    const rng = random(48);
    const pool: ValueType[] = [];
    for (let index = 0; index < 240; index += 1) {
      const type = typeAt(rng, 3);
      pool.push(type);
      // A `one` of samples of an earlier type gives more pairs that fit.
      if (index % 3 === 0) {
        const items = Array.from({ length: 4 }, () => sampleOf(rng, type, samples)).filter((value) => value !== NONE && !holdsUndefined(value));
        pool.push({ one: items as Json[] });
      }
    }
    let pairs = 0;
    let finite = 0;
    let checked = 0;
    for (const found of pool) {
      const members = Array.from({ length: 6 }, () => sampleOf(rng, found, samples)).filter((value) => value !== NONE);
      for (const value of members) expect(member(value, found, domains), `${JSON.stringify(value)} in ${JSON.stringify(found)}`).toBe(true);
      for (const expected of pool) {
        if (!fits(found, expected, domains)) continue;
        pairs += 1;
        if (!fits(found, expected, plain)) finite += 1;
        for (const value of members) {
          checked += 1;
          if (!member(value, expected, domains)) expect.fail(`${JSON.stringify(value)}: ${JSON.stringify(found)} fits ${JSON.stringify(expected)}`);
        }
      }
    }
    // The corpus holds 320 types and 102400 pairs. The counts pin the corpus: a change to the generator shows here.
    expect(pool.length).toBe(320);
    expect(pairs).toBeGreaterThan(10000);
    expect(finite).toBeGreaterThan(350);
    expect(checked).toBeGreaterThan(25000);
  });

  it("[TYPE.FITS-SOUND] a sampled member of an open record with finite fields is a member of each union of records that it fits (D84)", () => {
    const domains: Readonly<Record<string, Domain>> = {
      ...DOMAINS,
      align: { is: (value) => value === "left" || value === "right", values: ["left", "right", "up"], under: ["text"] },
      on: { is: (value) => value === true, under: ["bool"] },
    };
    const samples: Readonly<Record<string, readonly unknown[]>> = { ...BASE_SAMPLES, align: ["left", "right"], on: [true] };
    const leaves: readonly ValueType[] = ["null", "bool", "on", "align", "undefined", { one: [true] }, { one: [false] }, { one: ["left"] }, { one: [null, 1] }];
    const wide: readonly ValueType[] = [...leaves, "number", "text", { union: ["bool", "null"] }, { list: "bool" }];
    const fieldOf = (rng: Random, from: readonly ValueType[]): ValueType => (rng.chance(0.2) ? { union: [rng.pick(from), rng.pick(from)] } : rng.pick(from));
    const recordOf = (rng: Random, from: readonly ValueType[], open: number): ValueType => {
      const names = ["a", "b", "c"].filter((_, index) => index < 2 || rng.chance(0.3)).filter(() => rng.chance(0.8));
      const record: Record<string, ValueType> = {};
      for (const name of names) record[name] = fieldOf(rng, from);
      const optional = names.filter(() => rng.chance(0.25));
      return { record, ...(optional.length > 0 ? { optional } : {}), ...(rng.chance(open) ? {} : { closed: true }) };
    };
    const rng = random(84);
    const founds: ValueType[] = Array.from({ length: 120 }, () => recordOf(rng, leaves, 0.75));
    const unions: ValueType[] = Array.from({ length: 100 }, () => ({ union: Array.from({ length: 1 + rng.int(4) }, () => recordOf(rng, wide, 0.7)) }));
    // A union of the split of a found record by one field, with a wider type for some fields, gives more pairs that fit.
    for (const found of founds.slice(0, 60)) {
      const { record, optional = [], closed } = found as { record: Record<string, ValueType>; optional?: readonly string[]; closed?: boolean };
      const keys = Object.keys(record);
      if (keys.length === 0) continue;
      const key = rng.pick(keys);
      const parts = Array.from({ length: 1 + rng.int(3) }, () => {
        const fields: Record<string, ValueType> = { ...record, [key]: rng.pick(leaves) };
        for (const name of keys) if (name !== key && rng.chance(0.3)) fields[name] = rng.pick(wide);
        const kept = optional.filter((name) => name !== key || rng.chance(0.5));
        return { record: fields, ...(kept.length > 0 ? { optional: kept } : {}), ...(closed === true && rng.chance(0.5) ? { closed: true } : {}) };
      });
      unions.push({ union: parts });
    }
    let pairs = 0;
    let split = 0;
    let checked = 0;
    for (const found of founds) {
      const members = Array.from({ length: 8 }, () => sampleOf(rng, found, samples)).filter((value) => value !== NONE);
      for (const value of members) expect(member(value, found, domains), `${JSON.stringify(value)} in ${JSON.stringify(found)}`).toBe(true);
      for (const expected of unions) {
        if (!fits(found, expected, domains)) continue;
        pairs += 1;
        // A pair fits by the split when no member of the union alone takes the record, and the record is open.
        if ((found as { closed?: boolean }).closed !== true && !(expected as { union: ValueType[] }).union.some((each) => fits(found, each, domains))) split += 1;
        for (const value of members) {
          checked += 1;
          if (!member(value, expected, domains)) expect.fail(`${JSON.stringify(value)}: ${JSON.stringify(found)} fits ${JSON.stringify(expected)}`);
        }
      }
    }
    // The corpus holds 120 records, 159 unions and 19080 pairs. A split without the absent case of an optional field fails here.
    expect(founds.length * unions.length).toBe(19080);
    expect(pairs).toBeGreaterThan(2000);
    expect(split).toBeGreaterThan(50);
    expect(checked).toBeGreaterThan(15000);
  });

  it("[TYPE.FITS-SOUND] a sampled member of a nested record with finite inner fields is a member of each union of nested records that it fits (D89)", () => {
    const domains: Readonly<Record<string, Domain>> = {
      ...DOMAINS,
      align: { is: (value) => value === "left" || value === "right", values: ["left", "right", "up"], under: ["text"] },
      on: { is: (value) => value === true, under: ["bool"] },
    };
    const samples: Readonly<Record<string, readonly unknown[]>> = { ...BASE_SAMPLES, align: ["left", "right"], on: [true] };
    const leaves: readonly ValueType[] = ["null", "bool", "on", "align", "undefined", { one: [true] }, { one: [false] }, { one: ["left"] }, { one: [null, 1] }];
    const wide: readonly ValueType[] = [...leaves, "number", "text", { union: ["bool", "null"] }, { list: "bool" }];
    const SPLIT: readonly ValueType[] = ["bool", "align", { one: [null, 1] }];
    type Rec = { record: Record<string, ValueType>; optional?: string[]; closed?: true };
    const shapeOf = (fields: Record<string, ValueType>, rng: Random, open: number): Rec => {
      const optional = Object.keys(fields).filter(() => rng.chance(0.25));
      return { record: fields, ...(optional.length > 0 ? { optional } : {}), ...(rng.chance(open) ? {} : { closed: true }) };
    };
    // An inner record has finite fields x and y, and a closed inner record sometimes has a field n without a finite list.
    const innerOf = (rng: Random, from: readonly ValueType[], depth: number): Rec => {
      const fields: Record<string, ValueType> = {};
      for (const name of ["x", "y"]) if (rng.chance(0.8)) fields[name] = rng.pick(rng.chance(0.5) ? from : SPLIT);
      if (depth > 1 && rng.chance(0.3)) fields["z"] = innerOf(rng, from, depth - 1);
      if (rng.chance(0.3)) fields["n"] = "number";
      return shapeOf(fields, rng, 0.6);
    };
    const outerOf = (rng: Random, from: readonly ValueType[]): Rec => {
      const fields: Record<string, ValueType> = { a: innerOf(rng, from, 2) };
      if (rng.chance(0.3)) fields["b"] = rng.pick(from);
      if (rng.chance(0.3)) fields["c"] = innerOf(rng, from, 1);
      return shapeOf(fields, rng, 0.7);
    };
    // The paths of a record type to its fields with a finite type.
    const pathsOf = (type: Rec, prefix: readonly string[]): string[][] =>
      Object.entries(type.record).flatMap(([key, field]) => (typeof field === "object" && "record" in field ? pathsOf(field as Rec, [...prefix, key]) : [[...prefix, key]]));
    // A copy of a record type with the field at a path narrowed, the other fields sometimes wider, and the optional fields sometimes needed.
    const narrowed = (rng: Random, type: Rec, path: readonly string[], to: ValueType): Rec => {
      const [key, ...rest] = path as [string, ...string[]];
      const fields: Record<string, ValueType> = {};
      for (const [name, field] of Object.entries(type.record)) {
        if (name === key) fields[name] = rest.length === 0 ? to : narrowed(rng, field as Rec, rest, to);
        else fields[name] = typeof field === "string" && field !== "number" && rng.chance(0.1) ? rng.pick(wide) : field;
      }
      // Only the field at the end of the path can become needed: a needed record on the path refuses each found record.
      const optional = (type.optional ?? []).filter((name) => name !== key || rest.length > 0 || rng.chance(0.5));
      return { record: fields, ...(optional.length > 0 ? { optional } : {}), ...(type.closed === true && rng.chance(0.7) ? { closed: true } : {}) };
    };
    const rng = random(89);
    const founds: Rec[] = Array.from({ length: 120 }, () => outerOf(rng, leaves));
    const unions: ValueType[] = Array.from({ length: 40 }, () => ({ union: Array.from({ length: 1 + rng.int(4) }, () => outerOf(rng, wide)) }));
    // The field at a path of a found record: a type with few members, or a record.
    const fieldAt = (type: Rec, path: readonly string[]): ValueType => path.reduce<ValueType>((at, key) => (at as Rec).record[key] as ValueType, type);
    // A case for each member of a type with few members. A case sometimes is a random type instead.
    const casesOf = (rng: Random, type: ValueType): ValueType[] => {
      const values: readonly unknown[] = type === "bool" ? [true, false] : type === "align" ? ["left", "right"] : type === "on" ? [true] : typeof type === "object" && "one" in type ? type.one : [];
      const cases: ValueType[] = values.length === 0 ? [type] : values.map((value) => ({ one: [value as Json] }));
      return cases.map((each) => (rng.chance(0.2) ? rng.pick(leaves) : each));
    };
    // A union of the split of a found record by one path at depth two or more gives more pairs that fit.
    for (const found of [...founds, ...founds]) {
      const paths = pathsOf(found, []).filter((path) => path.length > 1 && fieldAt(found, path) !== "number");
      if (paths.length === 0) continue;
      const path = rng.pick(paths);
      const parts = casesOf(rng, fieldAt(found, path)).map((to) => narrowed(rng, found, path, to));
      if (parts.length > 1 && rng.chance(0.2)) parts.splice(rng.int(parts.length), 1);
      unions.push({ union: parts });
    }
    let pairs = 0;
    let nested = 0;
    let checked = 0;
    for (const found of founds) {
      const members = Array.from({ length: 10 }, () => sampleOf(rng, found, samples)).filter((value) => value !== NONE);
      for (const value of members) expect(member(value, found, domains), `${JSON.stringify(value)} in ${JSON.stringify(found)}`).toBe(true);
      // A record without a field of its own that splits fits a union only by a path, when no member of the union alone takes it.
      const flat = Object.entries(found.record).every(([, field]) => typeof field === "object" && "record" in field);
      for (const expected of unions) {
        if (!fits(found, expected, domains)) continue;
        pairs += 1;
        if (flat && !(expected as { union: ValueType[] }).union.some((each) => fits(found, each, domains))) nested += 1;
        for (const value of members) {
          checked += 1;
          if (!member(value, expected, domains)) expect.fail(`${JSON.stringify(value)}: ${JSON.stringify(found)} fits ${JSON.stringify(expected)}`);
        }
      }
    }
    // The corpus holds 120 records, 274 unions and 32880 pairs. A split without the absent case at depth two fails here.
    expect(founds.length * unions.length).toBe(32880);
    expect(pairs).toBeGreaterThan(450);
    expect(nested).toBeGreaterThan(100);
    expect(checked).toBeGreaterThan(4500);
  });

  it("[TYPE.FITS-COVER] a base type fits a union that holds each domain of a cover of its line (D85)", () => {
    const plain: Readonly<Record<string, Domain>> = { ...COVERED, number: STD_DOMAINS["number"] as Domain };
    // The example of K179: neg and nonneg split number, thus number fits their union, in each order and with more members.
    expect(fits("number", { union: ["neg", "nonneg"] }, COVERED)).toBe(true);
    expect(fits("number", { union: ["nonneg", "text", "neg"] }, COVERED)).toBe(true);
    expect(fits("number", { union: ["neg", "nonneg"] }, plain)).toBe(false);
    // A cover of a domain in the line serves each domain under it, also through two levels of parents.
    expect(fits("whole", { union: ["neg", "nonneg"] }, COVERED)).toBe(true);
    expect(fits("px", { union: ["neg", "nonneg"] }, COVERED)).toBe(true);
    // A domain of a cover gets its own covers: zero and plus split nonneg.
    expect(fits("number", { union: ["neg", "zero", "plus"] }, COVERED)).toBe(true);
    expect(fits("nonneg", { union: ["plus", "zero"] }, COVERED)).toBe(true);
    // A partial union does not fit: each domain of the cover must fit a member.
    expect(fits("number", { union: ["neg"] }, COVERED)).toBe(false);
    expect(fits("number", { union: ["neg", "zero"] }, COVERED)).toBe(false);
    expect(fits("number", { union: ["zero", "plus"] }, COVERED)).toBe(false);
    expect(fits("whole", { union: ["neg", "plus"] }, COVERED)).toBe(false);
    // A domain of a cover also gets the finite rule. Thus a cover by domains with values fits a `one`.
    expect(fits("text", { union: ["empty", "filled"] }, COVERED)).toBe(true);
    expect(fits("text", { union: [{ one: [""] }, "filled"] }, COVERED)).toBe(true);
    const sides: Readonly<Record<string, Domain>> = {
      side: { is: (value) => value === "l" || value === "r", under: ["text"], covers: [["left", "right"]] },
      left: { is: (value) => value === "l", under: ["side"], values: ["l"] },
      right: { is: (value) => value === "r", under: ["side"], values: ["r"] },
    };
    expect(fits("side", { one: ["r", "l"] }, sides)).toBe(true);
    expect(fits("side", { one: ["l"] }, sides)).toBe(false);
    // The rule starts only against a union or a `one`, and the strict join reads it too.
    expect(fits("number", "nonneg", COVERED)).toBe(false);
    expect(join("number", { union: ["neg", "nonneg"] }, COVERED)).toEqual({ union: ["neg", "nonneg"] });
    // Since D90, a split of a record uses a cover too (K186).
    expect(fits({ record: { a: "number" } }, { union: [{ record: { a: "neg" } }, { record: { a: "nonneg" } }] }, COVERED)).toBe(true);
  });

  it("[TYPE.FITS-COVER] a cover that is empty, or that names the domain or a name outside its line, does not count", () => {
    const withCover = (covers: readonly (readonly string[])[], more: Readonly<Record<string, Domain>> = {}): Readonly<Record<string, Domain>> => ({
      ...COVERED,
      ...more,
      number: { ...(STD_DOMAINS["number"] as Domain), covers },
    });
    // rest holds the same values as nonneg, but it is not under number. A ghost has no domain, thus it reads as unknown.
    const rest: Domain = { is: (value) => typeof value === "number" && !(value < 0) };
    expect(fits("number", { union: ["neg", "rest"] }, withCover([["neg", "rest"]], { rest }))).toBe(false);
    expect(fits("number", { union: ["neg", "nonneg"] }, withCover([["neg", "ghost"]]))).toBe(false);
    expect(fits("number", { union: ["neg", "nonneg"] }, withCover([["neg", "unknown"]]))).toBe(false);
    expect(fits("number", { union: ["text"] }, withCover([[], ["number"]]))).toBe(false);
    // A bad cover does not stop a good cover after it.
    expect(fits("number", { union: ["neg", "nonneg"] }, withCover([["neg", "ghost"], ["neg", "nonneg"]]))).toBe(true);
    // The gradual rule of unknown does not change.
    expect(fits("unknown", { union: ["neg", "nonneg"] }, COVERED)).toBe(true);
    expect(fits("number", { union: ["neg", "unknown"] }, COVERED)).toBe(true);
    // A cycle of covers ends: each domain is under the other, and each covers the other.
    const cycle: Readonly<Record<string, Domain>> = {
      a: { is: (value) => typeof value === "number", under: ["b"], covers: [["b"]] },
      b: { is: (value) => typeof value === "number", under: ["a"], covers: [["a"]] },
    };
    expect(fits("a", { union: ["text"] }, cycle)).toBe(false);
    // The rule tests at most 64 domains of covers. A cover of 65 domains does not fit, a cover of 64 domains fits.
    const wide = (count: number): Readonly<Record<string, Domain>> => {
      const out: Record<string, Domain> = { wide: { is: (value) => typeof value === "number", covers: [Array.from({ length: count }, (_, index) => `w${index}`)] } };
      for (let index = 0; index < count; index += 1) out[`w${index}`] = { is: (value) => value === index, under: ["wide"], values: [index] };
      return out;
    };
    const all = (count: number): ValueType => ({ one: Array.from({ length: count }, (_, index) => index) });
    expect(fits("wide", all(64), wide(64))).toBe(true);
    expect(fits("wide", all(65), wide(65))).toBe(false);
  });

  it("[TYPE.FITS-COVER] a merge compares the covers of two domains, and extendDomain keeps and adds them", () => {
    const number = COVERED["number"] as Domain;
    expect(Object.keys(mergeMachines({ domains: { number } }, { domains: { number: { ...number, covers: [["neg", "nonneg"]] } } }).domains ?? {})).toEqual(["number"]);
    expect(conflictsOf(() => mergeMachines({ domains: { number } }, { domains: { number: { ...number, covers: [["neg", "zero", "plus"]] } } })).map((item) => item.path)).toEqual([["domains", "number"]]);
    expect(conflictsOf(() => mergeMachines({ domains: { number } }, { domains: { number: STD_DOMAINS["number"] as Domain } }))).toHaveLength(1);
    // An extension adds a cover to a kernel domain, and a cover that the domain has already does not change.
    const world = { world: { kinds: {}, defaults: {} }, evaluators: {} };
    const added = extendDomain("number", { covers: [["neg", "nonneg"]] })(world);
    expect(added.domains?.["number"]?.covers).toEqual([["neg", "nonneg"]]);
    const again = extendDomain("number", { covers: [["neg", "nonneg"], ["neg", "zero", "plus"]] })({ ...world, domains: COVERED });
    expect(again.domains?.["number"]?.covers).toEqual([["neg", "nonneg"], ["neg", "zero", "plus"]]);
    expect(extendDomain("number", { under: ["real"] })({ ...world, domains: COVERED }).domains?.["number"]?.covers).toEqual([["neg", "nonneg"]]);
    expect(fits("number", { union: ["neg", "nonneg"] }, { ...COVERED, ...added.domains })).toBe(true);
  });

  it("[TYPE.FITS-SOUND] a sampled member of found is a member of expected for each pair that fits, with a language that declares true covers (D85)", () => {
    // The samples hold each member that a cover can miss: NaN, the infinities and -0.
    expect(falseCovers(COVERED, COVER_SAMPLES)).toEqual([]);
    const run = coverCorpus(COVERED);
    // The corpus holds 160 types and 25600 pairs. The counts pin the corpus: a change to the generator shows here.
    expect(run.types).toBe(160);
    expect(run.pairs).toBeGreaterThan(3000);
    expect(run.cover).toBeGreaterThan(200);
    expect(run.checked).toBeGreaterThan(15000);
    expect(run.bad).toEqual([]);
    // A false cover: neg and zero do not hold NaN or 2. The helper finds it from the samples, and the corpus finds a counterexample.
    const wrong: Readonly<Record<string, Domain>> = { ...COVERED, number: { ...(COVERED["number"] as Domain), covers: [["neg", "zero"]] } };
    expect(falseCovers(wrong, COVER_SAMPLES).length).toBeGreaterThan(0);
    expect(coverCorpus(wrong).bad.length).toBeGreaterThan(0);
  });

  it("[TYPE.FITS-SPLIT-TYPE] a split of a record narrows a covered field to each domain of a cover (D90)", () => {
    const of = (a: ValueType, more: { optional?: string[]; closed?: true } = {}): ValueType => ({ record: { a }, ...more });
    const halves: ValueType = { union: [of("neg"), of("nonneg")] };
    // The example of K186: neg and nonneg cover number, thus the record splits into a record for each domain.
    expect(fits(of("number"), halves, COVERED)).toBe(true);
    expect(fits(of("number"), halves, { ...COVERED, number: STD_DOMAINS["number"] as Domain })).toBe(false);
    expect(fits(of("number"), { union: [of("neg"), of("zero")] }, COVERED)).toBe(false);
    expect(fits(of("number", { closed: true }), { union: [of("neg", { closed: true }), of("nonneg", { closed: true })] }, COVERED)).toBe(true);
    // A case splits again by a cover of its own domain: zero and plus cover nonneg.
    expect(fits(of("number"), { union: [of("neg"), of("zero"), of("plus")] }, COVERED)).toBe(true);
    expect(fits(of("nonneg"), { union: [of("zero"), of("plus")] }, COVERED)).toBe(true);
    // A nested covered field splits by its path.
    const inA = (x: ValueType): ValueType => ({ record: { a: { record: { x } } } });
    expect(fits(inA("number"), { union: [inA("neg"), inA("nonneg")] }, COVERED)).toBe(true);
    expect(fits(inA("number"), { union: [inA("neg"), inA("plus")] }, COVERED)).toBe(false);
    // A cover split and a value split together. The value split of b comes first, then each record splits a.
    const both = (a: ValueType, b: ValueType): ValueType => ({ record: { a, b } });
    const four: ValueType[] = [];
    for (const b of [true, false]) for (const a of ["neg", "nonneg"]) four.push(both(a, { one: [b] }));
    expect(fits(both("number", "bool"), { union: four }, COVERED)).toBe(true);
    expect(fits(both("number", "bool"), { union: four.slice(1) }, COVERED)).toBe(false);
    // An optional covered field also gives the absent case.
    expect(fits(of("number", { optional: ["a"] }), halves, COVERED)).toBe(false);
    expect(fits(of("number", { optional: ["a"] }), { union: [of("neg"), of("nonneg"), of("never", { optional: ["a"] })] }, COVERED)).toBe(true);
    // The gradual rule of unknown does not change.
    expect(fits(of("unknown"), halves, COVERED)).toBe(true);
  });

  it("[TYPE.FITS-SPLIT-TYPE] a split uses the first valid cover of the line, and ignores an invalid cover", () => {
    const of = (a: ValueType): ValueType => ({ record: { a } });
    const withCover = (covers: readonly (readonly string[])[], more: Readonly<Record<string, Domain>> = {}): Readonly<Record<string, Domain>> => ({
      ...COVERED,
      ...more,
      number: { ...(STD_DOMAINS["number"] as Domain), covers },
    });
    const halves: ValueType = { union: [of("neg"), of("nonneg")] };
    expect(fits(of("number"), halves, withCover([["neg", "ghost"]]))).toBe(false);
    expect(fits(of("number"), halves, withCover([[], ["number"], ["neg", "unknown"]]))).toBe(false);
    expect(fits(of("number"), halves, withCover([["neg", "ghost"], ["neg", "nonneg"]]))).toBe(true);
    // A cover of a parent serves a field of a domain under it: whole is under number.
    expect(fits(of("whole"), halves, COVERED)).toBe(true);
    // Only the first valid cover splits a field. The cover rule of a base type alone tests each cover.
    const lo: Domain = { is: (value) => (value as number) < 1, under: ["number"] };
    const hi: Domain = { is: (value) => !((value as number) < 1), under: ["number"] };
    const two = withCover([["neg", "nonneg"], ["lo", "hi"]], { lo, hi });
    expect(fits("number", { union: ["lo", "hi"] }, two)).toBe(true);
    expect(fits(of("number"), { union: [of("lo"), of("hi")] }, two)).toBe(false);
    expect(fits(of("number"), { union: [of("lo"), of("hi")] }, withCover([["lo", "hi"]], { lo, hi }))).toBe(true);
    // A cycle of covers ends: each domain is under the other, and each covers the other.
    const cycle: Readonly<Record<string, Domain>> = {
      a: { is: (value) => typeof value === "number", under: ["b"], covers: [["b"]] },
      b: { is: (value) => typeof value === "number", under: ["a"], covers: [["a"]] },
    };
    expect(fits(of("a"), { union: [of("text")] }, cycle)).toBe(false);
  });

  it("[TYPE.FITS-SPLIT-TYPE] a union in a field splits into its members, and a path goes on into a member (K191)", () => {
    const of = (a: ValueType): ValueType => ({ record: { a } });
    expect(fits(of({ union: ["number", "text"] }), { union: [of("number"), of("text")] })).toBe(true);
    expect(fits(of({ union: ["number", "text"] }), { union: [of("number"), of("null")] })).toBe(false);
    // The example of K191: the member with x splits again by the path a.x.
    const either = of({ union: [{ record: { x: "bool" } }, { record: { y: "null" } }] });
    const three: ValueType[] = [of({ record: { x: { one: [true] } } }), of({ record: { x: { one: [false] } } }), of({ record: { y: "null" } })];
    expect(fits(either, { union: three })).toBe(true);
    expect(fits(either, { union: three.slice(1) })).toBe(false);
    // A member splits again by its cover, thus a union and a cover work together.
    expect(fits(of({ union: ["number", "text"] }), { union: [of("neg"), of("nonneg"), of("text")] }, COVERED)).toBe(true);
    expect(fits(of({ union: ["number", "text"] }), { union: [of("neg"), of("nonneg")] }, COVERED)).toBe(false);
  });

  it("[TYPE.FITS-SPLIT-TYPE] one budget of 64 records serves the value splits and the type splits", () => {
    const wide = (count: number): Readonly<Record<string, Domain>> => {
      const out: Record<string, Domain> = { wide: { is: (value) => typeof value === "number", covers: [Array.from({ length: count }, (_, index) => `w${index}`)] } };
      for (let index = 0; index < count; index += 1) out[`w${index}`] = { is: (value) => value === index, under: ["wide"], values: [index] };
      return out;
    };
    const each = (count: number, b?: boolean): ValueType[] =>
      Array.from({ length: count }, (_, index) => ({ record: { a: { one: [index] }, ...(b === undefined ? {} : { b: { one: [b] } }) } }));
    // A cover of 64 domains builds 64 records. A cover of 65 domains needs 65 records, thus the rule refuses it.
    expect(fits({ record: { a: "wide" } }, { union: each(64) }, wide(64))).toBe(true);
    expect(fits({ record: { a: "wide" } }, { union: each(65) }, wide(65))).toBe(false);
    // The value split of b comes first: 2 records, then 31 records for each. The order with the cover first needs 93.
    const withB: ValueType = { record: { a: "wide", b: "bool" } };
    expect(fits(withB, { union: [...each(31, true), ...each(31, false)] }, wide(31))).toBe(true);
    expect(fits(withB, { union: [...each(32, true), ...each(32, false)] }, wide(32))).toBe(false);
  });

  it("[TYPE.FITS-SOUND] a sampled member of a record with covered fields and union fields is a member of each union of its type splits that it fits (D90)", () => {
    expect(falseCovers(COVERED, COVER_SAMPLES)).toEqual([]);
    const run = splitCorpus(COVERED);
    expect(run.bad).toEqual([]);
    // The corpus holds 120 records, 244 unions and 29280 pairs. The counts pin the corpus: a change to the generator shows here.
    expect(run.total).toBe(29280);
    expect(run.pairs).toBe(1176);
    expect(run.split).toBe(374);
    expect(run.cover).toBe(144);
    expect(run.checked).toBe(11760);
    // A false cover: neg and zero do not hold 1.5. The corpus then finds a counterexample.
    const wrong: Readonly<Record<string, Domain>> = { ...COVERED, number: { ...(COVERED["number"] as Domain), covers: [["neg", "zero"]] } };
    expect(splitCorpus(wrong).bad.length).toBeGreaterThan(0);
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
    expect(Object.keys(both.domains ?? {}).sort()).toEqual(["bool", "color", "null", "number", "text", "undefined"]);
    // A restriction removes a domain by its path.
    const without = restrictMachine(both, [["domains", "color"]]);
    expect(Object.keys(without.domains ?? {})).not.toContain("color");
    expect(fits("color", "number", without.domains)).toBe(true);
  });

  it("[TYPE.MERGE] a merge compares the codecs of two domains (D80)", () => {
    const codec = { encode: (value: unknown) => String(value), decode: (data: Json) => BigInt(data as string) };
    const big: Domain = { is: (value) => typeof value === "bigint", codec };
    // The same functions give one domain, also in a copy of the codec.
    expect(mergeMachines({ domains: { big } }, { domains: { big: { ...big, codec: { ...codec } } } }).domains?.["big"]).toBe(big);
    // Another codec, or no codec, gives another document for the same member, thus it is a conflict.
    const other = { ...codec, encode: (value: unknown) => `n${String(value)}` };
    expect(conflictsOf(() => mergeMachines({ domains: { big } }, { domains: { big: { ...big, codec: other } } })).map((item) => item.path)).toEqual([["domains", "big"]]);
    expect(conflictsOf(() => mergeMachines({ domains: { big } }, { domains: { big: { is: big.is } } }))).toHaveLength(1);
    // The later part names the path in replaces, and its codec wins.
    const replaced = mergeMachines({ domains: { big } }, { domains: { big: { ...big, codec: other } }, replaces: [["domains", "big"]] });
    expect(replaced.domains?.["big"]?.codec).toBe(other);
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
