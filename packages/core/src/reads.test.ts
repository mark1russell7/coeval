import { describe, expect, it } from "vitest";
import {
  type Context,
  type EvalFn,
  type FormulaProfile,
  type GenerateOptions,
  type HostThing,
  type Json,
  type Key,
  type Machine,
  type Read,
  type StaticRead,
  Held,
  STD_MACHINE,
  THING,
  context,
  evaluate,
  factsOf,
  fail,
  formulaMachine,
  generate,
  isClosure,
  isHostThing,
  jsTruthy,
  mergeMachines,
  ok,
  prepare,
  random,
  refsOf,
  run,
  sameResult,
  typesOf,
  verifyReads,
} from "./index.ts";

/** The number of documents for each configuration of the property tests. CI can raise it with COEVAL_READS_COUNT. */
const COUNT = Number(process.env["COEVAL_READS_COUNT"] ?? 1000);

/** The number of new contexts for each document. */
const CHANGES = 3;

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });

function thing(label: string, fields: Readonly<Record<string, unknown>>, withResolve: boolean, type?: string): HostThing {
  const base = {
    [THING]: true as const,
    label,
    ...(type === undefined ? {} : { type }),
    deref: (key: Key) => (Object.hasOwn(fields, String(key)) ? fields[String(key)] : undefined),
    has: (key: Key) => Object.hasOwn(fields, String(key)),
    toJson: () => fields,
  };
  if (!withResolve) return base;
  return {
    ...base,
    resolve: (keys: readonly Key[]) => {
      let here: unknown = fields;
      for (const key of keys) {
        if (typeof here !== "object" || here === null || !Object.hasOwn(here, String(key))) return undefined;
        here = (here as Record<string, unknown>)[String(key)];
      }
      return { thing: here };
    },
  };
}

class Box {
  constructor(readonly v: unknown) {}
}

/** The rule of the tests for two values: a box compares its value, and two closures compare their parameters. */
function equal(a: unknown, b: unknown): boolean | undefined {
  if (a instanceof Box || b instanceof Box) return a instanceof Box && b instanceof Box && sameResult(ok(a.v), ok(b.v), equal);
  if (isClosure(a) || isClosure(b)) {
    const params = (value: unknown): unknown => (value as Readonly<Record<symbol, { readonly params: readonly string[] }>>)[Symbol.for("coeval.closure")]?.params;
    return isClosure(a) && isClosure(b) && JSON.stringify(params(a)) === JSON.stringify(params(b));
  }
  return undefined;
}

/* The formula kit with test profiles: pure, volatile and lazy operations, and extensions that read the context. */

let clock = 0;

const OPS: Readonly<Record<string, (...args: never[]) => unknown>> = {
  add: (a: unknown, b: unknown) => {
    if (typeof a === "number" && typeof b === "number") return a + b;
    if (typeof a === "string" && typeof b === "string") return a + b;
    throw new TypeError("add needs two numbers or two texts.");
  },
  neg: (a: number) => -a,
  pair: (a: unknown, b: unknown) => [a, b],
  apply: (fn: (value: unknown) => unknown, value: unknown) => fn(value),
  map: (fn: (value: unknown) => unknown, items: readonly unknown[]) => items.map((item) => fn(item)),
  keys: (value: object) => Object.keys(value),
  box: (value: unknown) => new Box(value),
  now: () => (clock += 1),
};

const LAZY: FormulaProfile["lazy"] = {
  ifError: (args) => {
    const first = args[0]?.() ?? fail("#ARGS", "ifError needs an argument.");
    return first.ok ? first : (args[1]?.() ?? first);
  },
  second: (args) => args[1]?.() ?? fail("#ARGS", "second needs two arguments."),
};

const EXT: FormulaProfile["ext"] = {
  here: (_data, ctx) => ok(ctx.self === null ? "none" : "self"),
  count: (_data, ctx) => ok(Object.keys(ctx.names).length),
};

const STRICT: FormulaProfile = { ops: OPS, lazy: LAZY, ext: EXT, pure: true, volatile: ["now"] };
const LOOSE: FormulaProfile = {
  ops: OPS,
  lazy: LAZY,
  ext: EXT,
  truthy: jsTruthy,
  logic: "value",
  otherwise: undefined,
  omit: (error) => error.code === "#N/A",
  missing: (value) => value === undefined,
  combine: (errors) => ({ code: "#MANY", reason: `${errors.length} parts failed.` }),
  pure: ["add", "neg", "pair", "apply", "map", "keys", "box", "ifError", "second"],
  volatile: ["now"],
};

/* A language on the formula kit: a deep shape for ref with step documents, and an address. */

const language: Machine = formulaMachine(LOOSE, {
  replaces: [["world", "kinds", "ref"]],
  world: {
    kinds: {
      ref: { verbs: { eval: "formula.ref" }, parts: { shape: "deep" }, pure: true },
      moves: { kinds: {}, fallback: { verbs: { eval: "formula.step", step: "walk.at" }, parts: { shape: "deep" }, pure: true } },
      probe: { verbs: { eval: "test.probe" }, parts: { shape: "record", fields: { target: { shape: "term", of: "lit", address: true } }, required: ["target"] }, pure: true },
    },
    defaults: {},
  },
  evaluators: {
    "test.probe": ({ parts }) => {
      const target = parts[0]?.evaluate() ?? fail("#VALUE!", "probe needs a target.");
      if (!target.ok) return target;
      const value = target.value as Partial<HostThing> | null;
      return ok(typeof value === "object" && value !== null && value[THING] === true ? `thing ${String(value.label)}` : typeof value);
    },
  },
  walkers: {
    "walk.at": ({ data, here, deref }) => {
      const key = Array.isArray(data) ? data[0] : data;
      if (typeof key !== "string" && typeof key !== "number") return { ok: false, reason: "The step needs a key." };
      const reached = deref(here, key);
      return reached === undefined ? { ok: false, reason: `The step ${String(key)} reaches nothing.`, code: "#REF!" } : { ok: true, thing: reached };
    },
  },
});

/** A navigator that adopts each record with the field `a` as a host thing. */
function adopt(value: unknown): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.hasOwn(value, "a")
    ? thing("adopted", value as Record<string, unknown>, false)
    : value;
}

/* The contexts: host things with and without resolve, a reference in the data, a cycle, a function and a held error. */

const parent = thing("node panel", { width: 4, a: 1 }, false, "panel");
const self = thing("node box", { width: 2, x: [1, 2], parent }, true, "box");
const held = new Held({ code: "#HELD", reason: "The binding failed." });

const NAMES: Readonly<Record<string, unknown>> = {
  a: 1,
  b: [1, "two", null],
  x: { a: 1 },
  n: Number.NaN,
  last: -0,
  env: { type: "number", value: 5 },
  hop: ref("names", "a"),
  loop: ref("names", "loop"),
  u: undefined,
  h: thing("host", { a: 2, b: { x: 1 } }, true),
  k: thing("plain host", { a: 3 }, false),
  f: (value: unknown) => [value],
  err: held,
};

const CONTEXTS: readonly Context[] = [
  context({ names: NAMES, caps: ["log", "write"], self, event: { a: 1, x: { a: 2 } } }),
  context({ names: NAMES, caps: [] }),
  context({ names: NAMES, caps: [["log"]], self: { a: 1, width: 3, parent: null }, event: [1, 2] }),
];

/** The new values of a name: each one differs from some names, and some are equal to an old value by structure. */
const VALUES: readonly unknown[] = [
  0,
  1,
  2,
  -0,
  Number.NaN,
  "two",
  null,
  undefined,
  [1, "two", null],
  [1, 2],
  { a: 1 },
  { a: 2 },
  ref("names", "b"),
  ref("names", "a"),
  thing("other host", { a: 2, b: { x: 1 } }, true),
  new Held({ code: "#HELD", reason: "Another binding failed." }),
  (value: unknown) => [value],
];

/** This function gives a new context with one to three changes: a name, `self`, `event` or the capabilities. */
function change(ctx: Context, seed: number): Context {
  const rng = random(seed);
  let names: Record<string, unknown> = { ...ctx.names };
  let next: Context = { ...ctx, names };
  const count = 1 + rng.int(3);
  for (let step = 0; step < count; step += 1) {
    const what = rng.int(10);
    if (what < 6) {
      const name = rng.pick([...Object.keys(NAMES), "extra"]);
      if (rng.chance(0.15)) delete names[name];
      else names[name] = rng.pick(VALUES);
    } else if (what === 6) {
      next = { ...next, self: rng.pick<unknown>([self, parent, null, { a: 1, width: 3, parent: null }, thing("node box", { width: 3, x: [1, 2], parent }, true, "box")]) };
    } else if (what === 7) {
      next = { ...next, event: rng.pick<unknown>([null, { a: 1, x: { a: 2 } }, { a: 2 }, [1, 2]]) };
    } else if (what === 8) {
      next = { ...next, caps: rng.pick<readonly (readonly string[] | string)[]>([[], ["log"], ["log", "write"], [["log"]]]) };
    } else {
      // A new record of the same names: each read gives the same thing again.
      names = { ...names };
      next = { ...next, names };
    }
    next = { ...next, names };
  }
  return next;
}

/* The generated documents of each configuration. */

const MORE_REFS: readonly (readonly Key[])[] = Array.from({ length: 8 }, () => ["ref"]);
const OP_TYPES: readonly (readonly Key[])[] = [...Object.keys(OPS).map((name) => ["ops", name]), ["ops", "ifError"], ["ops", "second"]];
const EXT_TYPES: readonly (readonly Key[])[] = [["ext", "undefined"], ["ext", "number"], ["ext", "here"], ["ext", "count"]];

function formulaOptions(machine: Machine, more: readonly (readonly Key[])[] = []): Omit<GenerateOptions, "seed"> {
  return {
    declaredType: "lit",
    names: Object.keys(NAMES),
    types: [...typesOf(machine.world), ...OP_TYPES, ...EXT_TYPES, ...more, ...MORE_REFS, ["if"], ["and"], ["fn"], ["let"]],
    hints: (type, path) => (type[0] === "call" && path[0] === "fn" ? [["fn"], ["ref"]] : type[0] === "ops" && (type[1] === "map" || type[1] === "apply") ? [["fn"]] : undefined),
    data: (type, rng) => {
      const name = type.join(".");
      if (name === "ext.number") return rng.pick(["NaN", "-0", "Infinity", "bad"]);
      if (name === "lit" && rng.chance(0.1)) return ref("names", "a");
      return undefined;
    },
  };
}

const STD_OPTIONS: Omit<GenerateOptions, "seed"> = {
  types: [...typesOf(STD_MACHINE.world), ...MORE_REFS, ["if"], ["pure"], ["seq"]],
  names: Object.keys(NAMES),
  data: (type, rng) => {
    const name = type.join(".");
    if (name === "number") return rng.chance(0.9) ? rng.pick([0, 1, 2, 3.5, -1]) : "1";
    if (name === "text") return rng.chance(0.9) ? rng.pick(["", "a", "b"]) : 1;
    if (name === "bool") return rng.chance(0.9) ? rng.chance(0.5) : 0;
    if (name === "nearest") return rng.pick<Json>([{ type: "panel" }, { type: "box", self: true }, "panel"]);
    return undefined;
  },
};

const TREE_OPTIONS: Omit<GenerateOptions, "seed"> = {
  ...STD_OPTIONS,
  types: [["panel"], ["panel"], ["box"], ["box"], ["list"], ["ref"], ["ref"], ["add"], ["number"], ["if"], ["greater"], ["nearest"]],
  roots: ["self"],
  keys: ["width", "height", "children", "children", "parent", "parent", 0, 1, "type", "a"],
  steps: 4,
  maxDepth: 5,
  maxSize: 30,
};

interface Config {
  readonly name: string;
  readonly machine: Machine;
  readonly options: Omit<GenerateOptions, "seed">;
}

const strictMachine = formulaMachine(STRICT);

const CONFIGS: readonly Config[] = [
  { name: "standard", machine: STD_MACHINE, options: STD_OPTIONS },
  { name: "trees", machine: STD_MACHINE, options: TREE_OPTIONS },
  { name: "formula, strict", machine: strictMachine, options: formulaOptions(strictMachine) },
  { name: "formula, loose", machine: formulaMachine(LOOSE), options: formulaOptions(formulaMachine(LOOSE)) },
  { name: "formula, adopted things", machine: formulaMachine(STRICT, { adopt }), options: formulaOptions(strictMachine) },
  { name: "language", machine: language, options: formulaOptions(language, [["moves", "up"], ["moves", "at"]]) },
];

/* The harness: record, change the context, verify, and evaluate again. */

function show(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item: unknown) => (typeof item === "function" ? "<fn>" : item === undefined ? "<undefined>" : item instanceof Held ? `<held ${item.error.code}>` : item));
  } catch {
    return String(value);
  }
}

/** This function tells if a static read covers the path of a dynamic read: the same root, and its keys start the path. */
function covers(read: StaticRead, path: readonly unknown[]): boolean {
  if (read.root !== path[0]) return false;
  if (read.exact && path.length !== read.keys.length + 1) return false;
  return read.keys.every((key, index) => path[index + 1] === key);
}

interface Outcome {
  /** The verifications that said "same", while the new evaluation gave another result (READS.SOUND). */
  readonly stale: readonly string[];
  /** The changed reads whose new answer is the same as the old one (READS.CHANGED). */
  readonly wrong: readonly string[];
  /** The free reads that no static read covers (READS.SUBSET). */
  readonly uncovered: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
}

/**
 * This function records the reads of the generated documents of a configuration, and verifies them in new contexts.
 * The function `keep` chooses the reads that the verification gets, thus a test can drop some of them.
 */
function harness(config: Config, keep: (read: Read) => boolean = () => true, total: number = COUNT): Outcome {
  const stale: string[] = [];
  const wrong: string[] = [];
  const uncovered: string[] = [];
  const counts: Record<string, number> = { reads: 0, pure: 0, unrepeatable: 0, same: 0, reuse: 0, touched: 0, changed: 0, kept: 0, inner: 0 };
  const add = (name: string, by = 1): void => {
    counts[name] = (counts[name] ?? 0) + by;
  };
  const machine = config.machine;
  const declared = config.options.declaredType === undefined ? {} : { declaredType: config.options.declaredType };
  for (let index = 0; index < total; index += 1) {
    const seed = 9_000_011 + index;
    const doc = generate(machine.world, { ...config.options, seed });
    const ctx = CONTEXTS[index % CONTEXTS.length] as Context;
    const facts = factsOf(machine, doc, declared);
    const plan = prepare(machine, doc, declared);
    const reads: Read[] = [];
    const before = plan.evaluate(ctx, { reads });
    add("reads", reads.length);

    // READS.SUBSET: each free read that the kernel did not add has a static read that covers it.
    const bound = new Set(
      refsOf(machine.world, doc, declared)
        .filter((use) => !use.free)
        .map((use) => String(use.path[1])),
    );
    for (const read of reads) {
      if (read.kept === true) add("kept");
      if (!read.free) add("inner");
      if (!read.free || read.kept === true) continue;
      if (facts.reads.some((fact) => covers(fact, read.path))) continue;
      const [root, name] = read.path;
      const text = String(name);
      // The read of a name that holds an error has only the name.
      const isHeld =
        root === "names" && read.path.length === 2 && read.reached.ok && read.reached.value instanceof Held && facts.reads.some((fact) => fact.root === "names" && fact.keys[0] === name);
      // A name that a kind binds to the value of the context reads as free.
      const coincides = root === "names" && bound.has(text) && Object.hasOwn(ctx.names, text);
      if (!isHeld && !coincides) uncovered.push(`seed ${seed}: ${show(read.path)}\n  doc ${show(doc)}`);
    }

    // READS.SOUND: when the reads verify, a new evaluation gives the old result.
    if (!facts.pure) continue;
    add("pure");
    if (!sameResult(before, plan.evaluate(ctx), equal)) {
      add("unrepeatable");
      continue;
    }
    const kept = reads.filter(keep);
    for (let turn = 0; turn < CHANGES; turn += 1) {
      const next = change(ctx, seed * 7 + turn);
      const check = verifyReads(plan, kept, next, { equal });
      const after = plan.evaluate(next);
      if (check.same) {
        add("same");
        const named = kept.filter((read) => read.free && read.kept !== true && read.path[0] === "names" && typeof read.path[1] === "string");
        // A list with a free read keeps its result, also when the new context has a new value for a name that it reads.
        if (kept.some((read) => read.free && read.kept !== true)) add("reuse");
        if (named.some((read) => !Object.is(next.names[read.path[1] as string], ctx.names[read.path[1] as string]))) add("touched");
        if (!sameResult(before, after, equal)) stale.push(`seed ${seed}: ${show(before)} and then ${show(after)}\n  doc ${show(doc)}`);
        continue;
      }
      add("changed");
      if (sameResult(check.read.reached, check.now, equal)) wrong.push(`seed ${seed}: read ${check.index} ${show(check.read.path)}`);
    }
  }
  return { stale, wrong, uncovered, counts };
}

const outcomes = new Map<string, Outcome>();

function outcomeOf(config: Config): Outcome {
  let outcome = outcomes.get(config.name);
  if (outcome === undefined) {
    outcome = harness(config);
    outcomes.set(config.name, outcome);
  }
  return outcome;
}

describe("the reads of generated documents", () => {
  it("[READS.SOUND] when each free read of a pure document reaches the same thing in a new context, a new evaluation gives the same result", () => {
    for (const config of CONFIGS) {
      const outcome = outcomeOf(config);
      expect(outcome.stale.slice(0, 3), `${config.name}: ${show(outcome.counts)}`).toEqual([]);
      expect(outcome.wrong.slice(0, 3), config.name).toEqual([]);
      expect(outcome.counts["changed"] ?? 0, config.name).toBeGreaterThan(0);
    }
    // The harness reaches each answer: an old result that stays, and a changed read.
    const total = (name: string): number => CONFIGS.reduce((sum, config) => sum + (outcomeOf(config).counts[name] ?? 0), 0);
    expect(total("same")).toBeGreaterThan(COUNT);
    expect(total("changed")).toBeGreaterThan(COUNT);
    expect(total("reuse")).toBeGreaterThan(COUNT / 2);
    expect(total("touched")).toBeGreaterThan(0);
    expect(total("kept")).toBeGreaterThan(0);
    expect(total("inner")).toBeGreaterThan(0);
    // A list without the reads of whole roots keeps stale results of trees, and the harness finds them. The root of a
    // tree reads the whole root self (TREE.SELF), and the kernel adds the kept reads.
    expect(harness(CONFIGS[1] as Config, (read) => read.path.length > 1).stale.length).toBeGreaterThan(0);
  }, 120_000);

  it("[READS.SUBSET] each free read of an evaluation has a static read of factsOf with its root and the start of its path", () => {
    for (const config of CONFIGS) {
      const outcome = outcomeOf(config);
      expect(outcome.uncovered.slice(0, 3), `${config.name}: ${show(outcome.counts)}`).toEqual([]);
      expect(outcome.counts["reads"] ?? 0, config.name).toBeGreaterThan(COUNT / 5);
    }
  }, 120_000);

  it("[PLAN.PATH-SAME] a plan with compiled paths gives the result and the reads of a traced evaluation, which resolves each path again", () => {
    // A node of a tree is a new thing in each evaluation, thus two host things compare by their labels.
    const same = (a: unknown, b: unknown): boolean | undefined =>
      equal(a, b) ?? (isHostThing(a) && isHostThing(b) ? a.label === b.label && (a.label.startsWith("node") || Object.is(a.toJson(), b.toJson())) : undefined);
    const differences: string[] = [];
    let reads = 0;
    for (const config of CONFIGS) {
      const machine = config.machine;
      const declared = config.options.declaredType === undefined ? {} : { declaredType: config.options.declaredType };
      for (let index = 0; index < Math.ceil(COUNT / 2); index += 1) {
        const seed = 9_100_003 + index;
        const doc = generate(machine.world, { ...config.options, seed });
        const ctx = CONTEXTS[index % CONTEXTS.length] as Context;
        const compiled: Read[] = [];
        const again: Read[] = [];
        // The clock of the operation now starts again, thus both evaluations see the same times.
        clock = 0;
        const result = prepare(machine, doc, declared).evaluate(ctx, { reads: compiled });
        clock = 0;
        const traced = evaluate(machine, doc, ctx, { ...declared, reads: again }).result;
        reads += compiled.length;
        const where = `${config.name}, seed ${seed}: ${show(doc)}`;
        if (!sameResult(result, traced, same)) differences.push(`${where}
  ${show(result)} and ${show(traced)}`);
        if (compiled.length !== again.length) differences.push(`${where}
  ${compiled.length} and ${again.length} reads`);
        compiled.forEach((read, at) => {
          const other = again[at] as Read | undefined;
          const fits = other !== undefined && show(read.path) === show(other.path) && read.free === other.free && read.kept === other.kept && sameResult(read.reached, other.reached, same);
          if (!fits) differences.push(`${where}
  read ${at}: ${show(read)} and ${show(other)}`);
        });
      }
    }
    expect(differences.slice(0, 3)).toEqual([]);
    expect(reads).toBeGreaterThan(COUNT);
  }, 120_000);
});

/* The rules on small documents. */

const machine = formulaMachine(STRICT);
const names = (record: Readonly<Record<string, unknown>>): Context => context({ names: record });
const paths = (reads: readonly Read[]): readonly (readonly unknown[])[] => reads.map((read) => read.path);

describe("the reads of an evaluation", () => {
  it("[READS.RECORD] evaluate, plan.evaluate, run and plan.run record each resolution with its path, what it reached and the mark free", async () => {
    const doc = { type: "list", value: [ref("names", "a"), ref("names", "x", "a"), ref("names", "nope")] };
    const ctx = names({ a: 1, x: { a: 2 } });
    const plan = prepare(machine, doc);
    const reads: Read[] = [];
    const result = plan.evaluate(ctx, { reads });
    expect(reads.map((read) => [read.path, read.reached.ok ? read.reached.value : read.reached.error.code, read.free])).toEqual([
      [["names", "a"], 1, true],
      [["names", "x", "a"], 2, true],
      [["names", "nope"], "#NAME?", true],
    ]);
    // Without the list, the evaluation gives the same result.
    expect(sameResult(result, plan.evaluate(ctx))).toBe(true);
    const viaEvaluate: Read[] = [];
    const viaRun: Read[] = [];
    const viaPlanRun: Read[] = [];
    expect(sameResult(evaluate(machine, doc, ctx, { reads: viaEvaluate }).result, result)).toBe(true);
    expect(sameResult((await run(machine, doc, ctx, { reads: viaRun })).result, result)).toBe(true);
    expect(sameResult(await plan.run(ctx, { reads: viaPlanRun }), result)).toBe(true);
    for (const list of [viaEvaluate, viaRun, viaPlanRun]) expect(paths(list)).toEqual(paths(reads));
    // A host thing keeps its identity in the read. An exception of the host gives the error value of the read.
    const host = thing("host", { a: 1 }, false);
    const boom: HostThing = { [THING]: true, label: "boom", deref: () => { throw new Error("boom"); }, toJson: () => null };
    const things: Read[] = [];
    const answer = prepare(machine, { type: "list", value: [ref("names", "h"), ref("names", "boom", "a")] }).evaluate(names({ h: host, boom }), { reads: things });
    expect(answer).toMatchObject({ ok: false, error: { code: "#CALC!" } });
    expect(things[0]?.reached).toEqual({ ok: true, value: host });
    expect(things[1]?.reached).toMatchObject({ ok: false, error: { code: "#CALC!", reason: "The resolution of a path threw: Error: boom" } });
    // A reference through a name that holds an error gives that error, and it reads the name.
    const failed: Read[] = [];
    expect(prepare(machine, ref("names", "err", "a")).evaluate(names({ err: held }), { reads: failed })).toEqual({ ok: false, error: { ...held.error, place: [] } });
    expect(failed).toEqual([{ path: ["names", "err"], reached: { ok: true, value: held }, free: true }]);
  });

  it("[READS.ORDER] the reads are in the order of the resolutions, and the reads of the step documents of a path come first", () => {
    const reads: Read[] = [];
    prepare(machine, { type: "list", value: [ref("names", "b"), ref("names", "a"), ref("names", "b")] }).evaluate(names({ a: 1, b: 2 }), { reads });
    expect(paths(reads)).toEqual([["names", "b"], ["names", "a"], ["names", "b"]]);
    // The step document of the path reads the name k. Its value is a part of the path that the reference resolves.
    const steps: Read[] = [];
    const doc = ref("names", "x", { type: ["moves", "at"], value: [ref("names", "k")] });
    const result = prepare(language, doc).evaluate(names({ x: { a: 1, b: 2 }, k: "b" }), { reads: steps });
    expect(result).toEqual({ ok: true, value: 2 });
    expect(paths(steps)).toEqual([["names", "k"], ["names", "x", { type: ["moves", "at"], value: ["b"] }]]);
    // A new value of k changes the first read, thus the verification does not resolve the old path.
    const check = verifyReads(language, steps, names({ x: { a: 1, b: 2 }, k: "a" }));
    expect(check).toMatchObject({ same: false, index: 0, now: { ok: true, value: "a" } });
  });

  it("[READS.FREE] a read of a name that a kind binds, or of a self that a kind sets, is not free, and the verification skips it", () => {
    const reads: Read[] = [];
    const doc = { type: "let", value: { bind: { y: ref("names", "a") }, body: { type: ["ops", "pair"], value: [ref("names", "y"), ref("names", "b")] } } };
    prepare(machine, doc).evaluate(names({ a: 1, b: 2 }), { reads });
    expect(reads.map((read) => [read.path, read.free])).toEqual([
      [["names", "a"], true],
      [["names", "y"], false],
      [["names", "b"], true],
    ]);
    // The context has another y, and the document does not read it.
    expect(verifyReads(machine, reads, names({ a: 1, b: 2, y: 5 }))).toEqual({ same: true });
    // A parameter of fn is a binding too. The operation map uses the closure in the evaluation.
    const mapped: Read[] = [];
    const lambda = { type: ["ops", "map"], value: [{ type: "fn", value: { params: ["v"], body: { type: ["ops", "add"], value: [ref("names", "v"), ref("names", "a")] } } }, ref("names", "list")] };
    expect(prepare(machine, lambda).evaluate(names({ a: 1, list: [1, 2] }), { reads: mapped })).toEqual({ ok: true, value: [2, 3] });
    expect(mapped.filter((read) => read.kept !== true).map((read) => [read.path[1], read.free])).toEqual([
      ["list", true],
      ["v", false],
      ["a", true],
      ["v", false],
      ["a", true],
    ]);
    // A node of a tree is the self of its attributes. The root of the tree reads the root self itself (TREE.SELF).
    const tree: Read[] = [];
    prepare(STD_MACHINE, { type: "panel", value: { width: 2, height: ref("self", "width") } }).evaluate(context({ self: { width: 9 } }), { reads: tree });
    expect(tree.filter((read) => read.kept !== true).map((read) => [read.path, read.free])).toEqual([
      [["self"], true],
      [["self", "width"], false],
    ]);
  });

  it("[READS.KEPT] a closure of fn adds a read of each root, and a read of a self that a kind sets adds a read of the root self", () => {
    // A kind that sets another self can give the old self on. The first read of the new self adds a kept read of the root self.
    // The kind reads its self directly to give it on, thus it does not declare pure (C4).
    const within: EvalFn = ({ parts, context: ctx }) => parts[0]?.evaluate({ ...ctx, self: { inner: ctx.self } }) ?? ok(null);
    const kinds = { ...STD_MACHINE.world.kinds, within: { verbs: { eval: "t.within" }, parts: { shape: "list" as const } } };
    const setter: Machine = { ...STD_MACHINE, world: { ...STD_MACHINE.world, kinds }, evaluators: { ...STD_MACHINE.evaluators, "t.within": within } };
    const kept: Read[] = [];
    const inner = prepare(setter, { type: "within", value: [ref("self", "inner", "w")] });
    expect(inner.evaluate(context({ self: { w: 5 } }), { reads: kept })).toEqual({ ok: true, value: 5 });
    expect(kept.map((read) => [read.path, read.free, read.kept === true])).toEqual([
      [["self"], true, true],
      [["self", "inner", "w"], false, false],
    ]);
    expect(verifyReads(inner, kept, context({ self: { w: 7 } }))).toMatchObject({ same: false, index: 0, now: { ok: true, value: { w: 7 } } });
    // The root of a tree reads the root self itself, thus the kernel adds no kept read of self (TREE.SELF).
    const tree: Read[] = [];
    const doc = { type: "panel", value: { width: ref("self", "parent", "w"), height: ref("self", "width") } };
    const plan = prepare(STD_MACHINE, doc);
    expect(plan.evaluate(context({ self: { w: 5 } }), { reads: tree })).toEqual({ ok: true, value: { width: 5, height: 5 } });
    expect(tree.map((read) => [read.path, read.free, read.kept === true])).toEqual([
      [["self"], true, false],
      [["self", "parent", "w"], false, false],
      [["self", "width"], false, false],
    ]);
    expect(verifyReads(plan, tree, context({ self: { w: 5 } }))).toEqual({ same: true });
    expect(verifyReads(plan, tree, context({ self: { w: 7 } }))).toMatchObject({ same: false, index: 0, now: { ok: true, value: { w: 7 } } });
    // A closure keeps the context for a later use: each root is a kept read, one time in an evaluation.
    const reads: Read[] = [];
    const lambda = { type: "fn", value: { params: ["v"], body: { type: ["ops", "add"], value: [ref("names", "v"), ref("names", "y")] } } };
    const pair = { type: "list", value: [lambda, lambda] };
    const result = prepare(machine, pair).evaluate(names({ y: 1 }), { reads });
    expect(reads.map((read) => [read.path, read.kept])).toEqual([
      [["self"], true],
      [["names"], true],
      [["world"], true],
      [["event"], true],
      [["caps"], true],
    ]);
    expect(verifyReads(machine, reads, names({ y: 1 }))).toEqual({ same: true });
    expect(verifyReads(machine, reads, names({ y: 2 }))).toMatchObject({ same: false, index: 1 });
    // Without the kept reads, the list is empty, and the old closures read the old context.
    expect(verifyReads(machine, reads.filter((read) => read.kept !== true), names({ y: 2 }))).toEqual({ same: true });
    const [first] = (result as { readonly value: readonly ((v: number) => number)[] }).value;
    expect(first?.(1)).toBe(2);
  });

  it("[READS.VERIFY] verifyReads resolves each free read again and compares it with sameResult; the same things keep the old result", () => {
    const doc = { type: ["ops", "pair"], value: [ref("names", "a"), ref("names", "x")] };
    const plan = prepare(machine, doc);
    const reads: Read[] = [];
    plan.evaluate(names({ a: 1, x: { p: [1] }, other: 1 }), { reads });
    // A plan or a machine. A name that the document does not read can change, and a new record can have the same fields.
    expect(verifyReads(plan, reads, names({ a: 1, x: { p: [1] }, other: 2 }))).toEqual({ same: true });
    expect(verifyReads(machine, reads, names({ a: 1, x: { p: [1] } }))).toEqual({ same: true });
    // The rules of sameResult: -0 is not 0, NaN is NaN, and a date is the same only as itself.
    const values = (a: unknown): Read[] => {
      const list: Read[] = [];
      plan.evaluate(names({ a, x: null }), { reads: list });
      return list;
    };
    expect(verifyReads(plan, values(0), names({ a: -0, x: null })).same).toBe(false);
    expect(verifyReads(plan, values(Number.NaN), names({ a: Number.NaN, x: null })).same).toBe(true);
    const date = new Date(0);
    expect(verifyReads(plan, values(date), names({ a: new Date(0), x: null })).same).toBe(false);
    // The rule of the host answers first, for example for two dates.
    const byTime = (a: unknown, b: unknown): boolean | undefined => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : undefined);
    expect(verifyReads(plan, values(date), names({ a: new Date(0), x: null }), { equal: byTime }).same).toBe(true);
    // An error of a read compares its code and its reason.
    expect(verifyReads(plan, values(1), names({ x: null })).same).toBe(false);
    // A reference gives the error of a name that holds a held error, before the rest of its path. The resolution does not show it.
    const field = prepare(machine, ref("names", "n", "a"));
    const fieldReads: Read[] = [];
    field.evaluate(names({ n: { a: 1 } }), { reads: fieldReads });
    expect(verifyReads(field, fieldReads, names({ n: held }))).toEqual({ same: false, index: 0, read: fieldReads[0], now: { ok: false, error: held.error } });
    expect(field.evaluate(names({ n: held }))).toMatchObject({ ok: false, error: { code: "#HELD" } });
    // The other way: the read of the held name sees the new value.
    const heldReads: Read[] = [];
    field.evaluate(names({ n: held }), { reads: heldReads });
    expect(verifyReads(field, heldReads, names({ n: { a: 1 } })).same).toBe(false);
    expect(verifyReads(field, heldReads, names({ n: held })).same).toBe(true);
    // Code that asks for the hops gets them in its read, and the verification compares each hop.
    const counting: EvalFn = ({ data, resolve }) => {
      const found = resolve(data as readonly Json[], { hops: true });
      return ok(found.hops.length);
    };
    const hopping = mergeMachines(STD_MACHINE, { world: { kinds: { hops: { verbs: { eval: "test.hops" }, pure: true } } }, evaluators: { "test.hops": counting } });
    const hopReads: Read[] = [];
    const hopPlan = prepare(hopping, { type: "hops", value: ["names", "via"] });
    expect(hopPlan.evaluate(names({ via: ref("names", "a"), a: 1, b: 1 }), { reads: hopReads })).toEqual({ ok: true, value: 5 });
    expect(hopReads[0]?.hops?.map((hop) => hop.by)).toEqual(["root", "default", "root", "default", "collapse"]);
    // The same thing at the end of another chain of references is another read for this code.
    expect(verifyReads(hopPlan, hopReads, names({ via: ref("names", "b"), a: 1, b: 1 })).same).toBe(false);
    expect(verifyReads(hopPlan, hopReads, names({ via: ref("names", "a"), a: 1, b: 1 })).same).toBe(true);
    // The first hop holds the record of the names, thus a change of another name changes the hops too.
    expect(verifyReads(hopPlan, hopReads, names({ via: ref("names", "a"), a: 1, b: 2 })).same).toBe(false);
  });

  it("[READS.CHANGED] verifyReads gives the first read that reaches another thing, with its index and its new answer, and it stops there", () => {
    const plan = prepare(machine, { type: "list", value: [ref("names", "a"), ref("names", "b"), ref("names", "c")] });
    const reads: Read[] = [];
    plan.evaluate(names({ a: 1, b: 2, c: 3 }), { reads });
    const check = verifyReads(plan, reads, names({ a: 1, b: 20, c: 30 }));
    expect(check).toEqual({ same: false, index: 1, read: reads[1], now: { ok: true, value: 20 } });
    const missing = verifyReads(plan, reads, names({ a: 1, b: 2 }));
    expect(missing).toMatchObject({ same: false, index: 2, now: { ok: false, error: { code: "#NAME?" } } });
  });

  it("[READS.LAZY] a part that the evaluation skips has no reads, thus a change in it keeps the old result", () => {
    const doc = { type: "if", value: { test: ref("names", "t"), then: ref("names", "a"), else: ref("names", "b") } };
    const plan = prepare(machine, doc);
    const reads: Read[] = [];
    plan.evaluate(names({ t: true, a: 1, b: 2 }), { reads });
    expect(paths(reads)).toEqual([["names", "t"], ["names", "a"]]);
    expect(verifyReads(plan, reads, names({ t: true, a: 1, b: 99 }))).toEqual({ same: true });
    expect(verifyReads(plan, reads, names({ t: false, a: 1, b: 2 }))).toMatchObject({ same: false, index: 0 });
    // The terms of and after a false term do not evaluate.
    const and: Read[] = [];
    prepare(machine, { type: "and", value: [ref("names", "p"), ref("names", "q")] }).evaluate(names({ p: false, q: true }), { reads: and });
    expect(paths(and)).toEqual([["names", "p"]]);
    // The static facts mark the branches lazy, and the dynamic reads have only the branch that the test selected.
    expect(factsOf(machine, doc).reads.map((read) => read.lazy)).toEqual([false, true, true]);
  });

  it("[READS.DATA] a reference in the data that a resolution follows is a part of one read, and a change of its target changes that read", () => {
    const plan = prepare(machine, ref("names", "hop"));
    const reads: Read[] = [];
    expect(plan.evaluate(names({ hop: ref("names", "a"), a: 1 }), { reads })).toEqual({ ok: true, value: 1 });
    expect(reads).toEqual([{ path: ["names", "hop"], reached: { ok: true, value: 1 }, free: true }]);
    expect(verifyReads(plan, reads, names({ hop: ref("names", "a"), a: 2 }))).toMatchObject({ same: false, index: 0, now: { ok: true, value: 2 } });
    expect(verifyReads(plan, reads, names({ hop: ref("names", "c"), a: 2, c: 1 }))).toEqual({ same: true });
    // factsOf counts the same read: the reference, not its target.
    expect(factsOf(machine, ref("names", "hop")).reads.map((read) => read.keys)).toEqual([["hop"]]);
  });
});

