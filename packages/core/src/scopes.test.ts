import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type DocVisit,
  type GenerateOptions,
  type Json,
  type Key,
  type Machine,
  type NamesSource,
  type PartSlot,
  type ScopeRule,
  type World,
  STD_MACHINE,
  check,
  formulaMachine,
  generate,
  isEnvelope,
  isRecord,
  makeContext,
  partsOf,
  pathMatches,
  prepare,
  refsOf,
  typeCheck,
  walk,
} from "./index.ts";

/*
 * The scale of the scope rules (K257, D201). A wide sequence of named steps and a deep nest of binders take time and
 * memory linear in their size. Each answer stays as it was: the names of each visit equal those of the lists of each
 * part that the walk made before (the copy below), in the same order.
 */

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });
const op = (name: string, ...args: Json[]): Json => ({ type: ["ops", name], value: args });

/** The formula kit with the operation add. */
const FORMULA: Machine = formulaMachine({
  ops: {
    add: (a: unknown, b: unknown) => {
      if (typeof a === "number" && typeof b === "number") return a + b;
      throw new TypeError("add needs two numbers.");
    },
  },
});

/**
 * A sequence of `n` named steps. Each step adds 1 to the step before it, by its name or by `last`, and each 1000th step
 * also adds the first step.
 */
function wideSeq(n: number): { readonly doc: Json; readonly value: number } {
  const steps: Json[] = [];
  let value = 0;
  let first = 0;
  for (let index = 0; index < n; index += 1) {
    const before: Json = index === 0 ? 1 : index % 3 === 1 ? ref("names", "last") : ref("names", `s${index - 1}`);
    const more = index % 1000 === 999;
    steps.push({ type: "add", value: [before, more ? ref("names", "s0") : 1], name: `s${index}` });
    value = (index === 0 ? 1 : value) + (more ? first : 1);
    if (index === 0) first = value;
  }
  return { doc: { type: "seq", value: steps }, value };
}

/**
 * A nest of `depth` binders. Each level binds `x` again, and it binds `v<k>` to the `x` around it. Each tenth level is
 * a function that a call applies. The other levels are `let`. The body at the bottom reads names of the top, the middle
 * and the bottom.
 */
function nest(depth: number): { readonly doc: Json; readonly value: Json } {
  const half = depth >> 1;
  const last = `v${depth - 1}`;
  let body: Json = { type: "list", value: [ref("names", "x"), ref("names", "v0"), ref("names", `v${half}`), ref("names", last), op("add", ref("names", "x"), ref("names", last))] };
  for (let level = depth - 1; level >= 0; level -= 1) {
    const outer: Json = level === 0 ? -1 : ref("names", "x");
    body =
      level % 10 === 9
        ? { type: "call", value: { fn: { type: "fn", value: { params: ["x", `v${level}`], body } }, args: [level, outer] } }
        : { type: "let", value: { bind: { x: level, [`v${level}`]: outer }, body } };
  }
  return { doc: body, value: [depth - 1, -1, half - 1, depth - 2, 2 * depth - 3] };
}

describe("the scale of the scope rules", () => {
  it("[STATIC.LINEAR] [SEQ.NAMES] a sequence of 20000 named steps: check, the type check and prepare give the right answers", () => {
    const { doc } = wideSeq(20_000);
    expect(check(STD_MACHINE, doc)).toEqual([]);
    const typing = typeCheck(STD_MACHINE, doc);
    expect(typing.issues).toEqual([]);
    expect(typing.places).toHaveLength(20_000 * 3 + 1);
    expect(prepare(STD_MACHINE, doc).root.code).toBeTypeOf("function");
    // A step that reads a later name, a step that reads `last` first, and an unknown name.
    const steps = [...((doc as { readonly value: Json[] }).value as Json[])];
    steps[0] = { type: "add", value: [ref("names", "last"), 1], name: "s0" };
    steps[10] = { type: "add", value: [ref("names", "s9"), ref("names", "s19999")], name: "s10" };
    steps[20] = { type: "add", value: [ref("names", "s19"), ref("names", "nope")], name: "s20" };
    const issues = check(STD_MACHINE, { type: "seq", value: steps });
    expect(issues.map((issue) => [issue.code, issue.place, issue.reason])).toEqual([
      ["#NAME?", [0, 0], "The name last is bound by a later step."],
      ["#NAME?", [10, 1], "The name s19999 is bound by a later step."],
      ["#NAME?", [20, 1], "Nothing binds the name nope."],
    ]);
  }, 60_000);

  it("[STATIC.LINEAR] [SEQ.NAMES] a plan of a sequence of 2000 named steps gives the right value", () => {
    // The runner of seq copies its names at each step. Thus the evaluation of a wide sequence is a limit of D201.
    const { doc, value } = wideSeq(2000);
    expect(prepare(STD_MACHINE, doc).evaluate(makeContext())).toEqual({ ok: true, value });
  }, 60_000);

  it("[STATIC.LINEAR] a nest of 900 binders: check, the type check and prepare give the right answers", () => {
    const { doc, value } = nest(900);
    expect(check(FORMULA, doc, { declaredType: "lit" })).toEqual([]);
    const typing = typeCheck(FORMULA, doc, { declaredType: "lit" });
    expect(typing.issues).toEqual([]);
    expect(prepare(FORMULA, doc, { declaredType: "lit" }).evaluate(makeContext())).toEqual({ ok: true, value });
  }, 60_000);

  it("[STATIC.LINEAR] a nest of 20000 binders, with a higher limit of depth: check and the type check give the right answers", () => {
    const { doc } = nest(20_000);
    const machine: Machine = { ...FORMULA, maxDepth: 100_000 };
    expect(check(machine, doc, { declaredType: "lit" })).toEqual([]);
    expect(typeCheck(machine, doc, { declaredType: "lit" }).issues).toEqual([]);
    // `prepare` compiles with a recursion of the host. Past the stack of the host, it gives `#DEPTH!` (a limit of D201).
    expect(prepare(machine, doc, { declaredType: "lit" }).evaluate(makeContext())).toMatchObject({ ok: false, error: { code: "#DEPTH!" } });
    // A read of a name that no level binds, at the bottom.
    let bottom: Json = ref("names", "nope");
    for (let level = 19_999; level >= 0; level -= 1) bottom = { type: "let", value: { bind: { [`v${level}`]: level }, body: bottom } };
    expect(check(machine, bottom, { declaredType: "lit" }).map((issue) => [issue.code, issue.place.length, issue.reason])).toEqual([["#NAME?", 20_000, "Nothing binds the name nope."]]);
  }, 60_000);
});

/* A copy of the lists that the walk made before K257: the names of each part, and the names of the later parts. */

function valueAt(value: unknown, path: readonly Key[]): unknown {
  let here: unknown = value;
  for (const key of path) {
    if (Array.isArray(here)) here = here[Number(key)];
    else if (isRecord(here) && Object.hasOwn(here, String(key))) here = here[String(key)];
    else return undefined;
  }
  return here;
}

function headerName(item: Json): string | undefined {
  return isEnvelope(item) && typeof (item as { readonly name?: unknown }).name === "string" ? (item as { readonly name: string }).name : undefined;
}

function namesOf(source: NamesSource, value: unknown, covered: readonly PartSlot[]): readonly string[] {
  if ("fixed" in source) return source.fixed;
  if ("keysAt" in source) {
    const at = valueAt(value, source.keysAt);
    return isRecord(at) ? Object.keys(at) : [];
  }
  if ("listAt" in source) {
    const at = valueAt(value, source.listAt);
    return Array.isArray(at) ? (at as readonly unknown[]).filter((item): item is string => typeof item === "string") : [];
  }
  if ("textAt" in source) {
    const at = valueAt(value, source.textAt);
    if (typeof at === "string") return [at];
    return source.otherwise === undefined ? [] : [source.otherwise];
  }
  return covered.map((slot) => headerName(slot.item)).filter((name): name is string => name !== undefined);
}

function oldScopes(rules: readonly ScopeRule[] | undefined, value: unknown, slots: readonly PartSlot[]): { readonly sees: readonly (readonly string[])[]; readonly later: readonly (readonly string[])[] } {
  const sees: string[][] = slots.map(() => []);
  const later: string[][] = slots.map(() => []);
  for (const rule of rules ?? []) {
    const covered = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => rule.in.some((pattern) => pathMatches(slot.path, pattern)));
    if (rule.sequential !== true) {
      const names = namesOf(rule.names, value, covered.map(({ slot }) => slot));
      for (const { index } of covered) sees[index]?.push(...names);
      continue;
    }
    if ("headers" in rule.names) {
      covered.forEach(({ index }, position) => {
        const before = covered.slice(0, position).map(({ slot }) => headerName(slot.item)).filter((name): name is string => name !== undefined);
        const after = covered.slice(position).map(({ slot }) => headerName(slot.item)).filter((name): name is string => name !== undefined);
        sees[index]?.push(...before);
        later[index]?.push(...after);
      });
      continue;
    }
    const names = namesOf(rule.names, value, covered.map(({ slot }) => slot));
    covered.forEach(({ index }, position) => {
      if (position > 0) sees[index]?.push(...names);
      else later[index]?.push(...names);
    });
  }
  return { sees, later };
}

interface Expected {
  readonly names: readonly string[];
  readonly later: readonly string[];
}

const sameKeys = (a: readonly Key[], b: readonly Key[]): boolean => a.length === b.length && a.every((key, index) => key === b[index]);

/** The names and the later names of a visit, from those of its parent and the copy of the old lists. */
function expectedOf(world: World, v: DocVisit, seen: ReadonlyMap<DocVisit, Expected>, host: readonly string[]): Expected {
  const parent = v.parent;
  if (parent === undefined) return { names: [...new Set(host)], later: [] };
  const up = seen.get(parent);
  if (up === undefined) throw new Error("The walk visits a part before its parent.");
  const read = partsOf(world, parent.doc);
  if (!read.ok || !read.split.ok) throw new Error("The walk visits a part of a document without parts.");
  const index = read.split.parts.findIndex((slot) => sameKeys(slot.path, v.slot));
  const { sees, later } = oldScopes(parent.kind?.scope, parent.doc.value, read.split.parts);
  const extra = sees[index] ?? [];
  const hidden = later[index] ?? [];
  return {
    names: extra.length === 0 ? up.names : [...new Set([...up.names, ...extra])],
    later: hidden.length === 0 ? up.later : [...new Set([...up.later, ...hidden])],
  };
}

const HOST = ["a", "b", "x"] as const;
/** The names to test with `has`: each name of the generator, two names that nothing binds, and a key of each object. */
const PROBES = ["a", "b", "x", "n", "last", "__proto__", "unbound", "zz", "toString"] as const;

interface Corpus {
  readonly name: string;
  readonly machine: Machine;
  readonly options: Omit<GenerateOptions, "seed">;
}

const SEQUENCES: Corpus = {
  name: "sequences",
  machine: STD_MACHINE,
  options: {
    names: [...HOST],
    types: [["seq"], ["seq"], ["seq"], ["seq"], ["add"], ["number"], ["ref"], ["ref"], ["list"], ["log"]],
    data: (type, rng) => (type.join(".") === "number" ? rng.pick([0, 1, 2]) : undefined),
    roots: ["names"],
    steps: 1,
    maxDepth: 5,
    maxSize: 30,
  },
};

const BINDERS: Corpus = {
  name: "binders",
  machine: FORMULA,
  options: {
    declaredType: "lit",
    names: [...HOST],
    types: [["let"], ["let"], ["let"], ["fn"], ["fn"], ["call"], ["call"], ["ref"], ["ref"], ["list"], ["record"], ["ops", "add"], ["lit"]],
    hints: (type, path) => (type[0] === "call" && path[0] === "fn" ? [["fn"], ["ref"]] : undefined),
    roots: ["names"],
    steps: 1,
    maxDepth: 5,
    maxSize: 30,
  },
};

const COUNT = 300;

describe("the names of each visit", () => {
  for (const corpus of [SEQUENCES, BINDERS]) {
    it(`[STATIC.LINEAR] the names and the later names of each visit equal the old lists, in order, during and after the walk: ${corpus.name}`, () => {
      let visits = 0;
      let scoped = 0;
      let shadowed = 0;
      for (let seed = 1; seed <= COUNT; seed += 1) {
        const doc = generate(corpus.machine.world, { ...corpus.options, seed });
        const seen = new Map<DocVisit, Expected>();
        const declared = corpus.options.declaredType === undefined ? {} : { declaredType: corpus.options.declaredType };
        walk(
          corpus.machine.world,
          doc,
          (v) => {
            const expected = expectedOf(corpus.machine.world, v, seen, HOST);
            seen.set(v, expected);
            // During the visit, `has` reads the counts of the walk.
            for (const probe of PROBES) {
              expect(v.names.has(probe)).toBe(expected.names.includes(probe));
              expect(v.later.has(probe)).toBe(expected.later.includes(probe));
            }
            expect([...v.names]).toEqual(expected.names);
            expect([...v.later]).toEqual(expected.later);
            expect(v.names.size).toBe(expected.names.length);
            const up = v.parent === undefined ? undefined : seen.get(v.parent);
            if (up !== undefined && expected.names.length === up.names.length && expected.names !== up.names) shadowed += 1;
            if (expected.names.some((name) => !(HOST as readonly string[]).includes(name)) || expected.later.length > 0) scoped += 1;
          },
          { ...declared, names: [...HOST] },
        );
        // After the walk, each view reads the layers of its binders.
        for (const [v, expected] of seen) {
          for (const probe of PROBES) {
            expect(v.names.has(probe)).toBe(expected.names.includes(probe));
            expect(v.later.has(probe)).toBe(expected.later.includes(probe));
          }
          expect([...v.names.keys()]).toEqual(expected.names);
          expect(new Set(v.later)).toEqual(new Set(expected.later));
        }
        visits += seen.size;
      }
      // Many visits see names of the scope rules (284 of 1168 in the binders, 1067 of 1592 in the sequences). The corpus
      // also binds names again: a part that sees only names that its parent sees.
      expect(visits).toBeGreaterThan(COUNT * 3);
      expect(scoped).toBeGreaterThan(COUNT / 3);
      expect(shadowed).toBeGreaterThan(0);
    }, 120_000);
  }
});

/*
 * The answers of each tier on the generated documents (K257, D201). The file `golden/scopes.json` holds a digest of
 * the answers of each document on the source of main before K257. `COEVAL_GOLDEN=write` writes the file again.
 */

const GOLDEN = new URL("../golden/scopes.json", import.meta.url);
/** The values of the names of the host. They are deeply frozen, thus a plan can fix them (PLAN.FIXED). */
const HOST_VALUES: Readonly<Record<string, unknown>> = Object.freeze({ a: 1, b: "two", x: Object.freeze([1, 2]) });

/** The JSON text of a value. A function, `undefined`, a number that JSON does not have and a collection get a text. */
function textOf(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "function") return "<function>";
    if (item === undefined) return "<undefined>";
    if (typeof item === "number" && !Number.isFinite(item)) return String(item);
    if (typeof item === "bigint") return `${item}n`;
    if (item instanceof Map) return { map: [...item] };
    if (item instanceof Set) return { set: [...item] };
    return item;
  });
}

/** The answers of the check, the references, the type check and three plans for one document, as one text. */
function answersOf(corpus: Corpus, doc: unknown): string {
  const declared = corpus.options.declaredType === undefined ? {} : { declaredType: corpus.options.declaredType };
  const issues = check(corpus.machine, doc, { ...declared, names: [...HOST] });
  const refs = refsOf(corpus.machine.world, doc, declared).map((use) => [use.place, use.at, use.root, use.path, use.free, use.address]);
  const typing = typeCheck(corpus.machine, doc, { ...declared, names: [...HOST] });
  const values = [{}, { fold: false }, { fixed: { names: HOST_VALUES } }].map((more) => {
    try {
      return prepare(corpus.machine, doc, { ...declared, ...more }).evaluate(makeContext(HOST_VALUES));
    } catch (error) {
      return { thrown: String(error) };
    }
  });
  return textOf({ issues, refs, type: typing.type, typeIssues: typing.issues, places: typing.places, values });
}

const digestOf = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

describe("the answers on generated documents", () => {
  it("[STATIC.LINEAR] [STATIC.REFS] the issues, the references, the types and the values equal those of main before K257", () => {
    const digests: Record<string, string[]> = {};
    for (const corpus of [SEQUENCES, BINDERS]) {
      const list: string[] = [];
      for (let seed = 1; seed <= COUNT; seed += 1) list.push(digestOf(answersOf(corpus, generate(corpus.machine.world, { ...corpus.options, seed }))));
      digests[corpus.name] = list;
    }
    if (process.env["COEVAL_GOLDEN"] === "write") writeFileSync(GOLDEN, `${JSON.stringify({ version: 1, count: COUNT, digests }, null, 2)}\n`);
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as { readonly count: number; readonly digests: Readonly<Record<string, readonly string[]>> };
    expect(golden.count).toBe(COUNT);
    for (const corpus of [SEQUENCES, BINDERS]) {
      const differ = (digests[corpus.name] ?? []).flatMap((digest, index) => (digest === golden.digests[corpus.name]?.[index] ? [] : [index + 1]));
      // The first seed that differs, with its answers, for a reader of a failure.
      const first = differ[0];
      expect({ corpus: corpus.name, differ, first: first === undefined ? undefined : answersOf(corpus, generate(corpus.machine.world, { ...corpus.options, seed: first })) }).toEqual({ corpus: corpus.name, differ: [], first: undefined });
    }
  }, 120_000);
});
