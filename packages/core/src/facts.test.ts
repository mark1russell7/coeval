import { describe, expect, it } from "vitest";
import {
  type CompiledEvaluator,
  type CompiledRunner,
  type Context,
  type DocFacts,
  type EvalFn,
  type EvalInput,
  type Evaluator,
  type FormulaProfile,
  type GenerateOptions,
  type HostThing,
  type Json,
  type Key,
  type Kind,
  type Machine,
  type Result,
  type ResolveOptions,
  type RunFn,
  type RunInput,
  type Runner,
  type Runtime,
  type StaticRead,
  ROOTS,
  STD_MACHINE,
  THING,
  context,
  docEquals,
  evaluate,
  factsOf,
  fail,
  flatten,
  formulaFacts,
  formulaKinds,
  formulaMachine,
  generate,
  jsTruthy,
  mergeMachines,
  ok,
  prepare,
  refsOf,
  sameValue,
  typesOf,
  walk,
} from "./index.ts";

/** The number of documents for each configuration of the property tests. CI can raise it with COEVAL_FACTS_COUNT. */
const COUNT = Number(process.env["COEVAL_FACTS_COUNT"] ?? 1000);

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });

/* The values of the contexts: host things with and without resolve, a reference in the data, a cycle and a function. */

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

const parent = thing("node panel", { width: 4, a: 1 }, false, "panel");
const self = thing("node box", { width: 2, x: [1, 2], parent }, true, "box");

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
};

/** The names that a reference in the data of a name reaches (DEREF.COLLAPSE). A read of the name reads them too. */
const IN_DATA: Readonly<Record<string, readonly string[]>> = { hop: ["a"], loop: ["loop"] };

const CONTEXTS: readonly Context[] = [
  context({ names: NAMES, caps: ["log", "write"], self, event: { a: 1, x: { a: 2 } } }),
  context({ names: NAMES, caps: [] }),
  context({ names: NAMES, caps: [["log"]], self: { a: 1, parent: null }, event: [1, 2] }),
];

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
  "math.max": (...args: number[]) => Math.max(...args),
  boom: () => {
    throw new Error("boom");
  },
  apply: (fn: (value: unknown) => unknown, value: unknown) => fn(value),
  map: (fn: (value: unknown) => unknown, items: readonly unknown[]) => items.map((item) => fn(item)),
  keys: (value: object) => Object.keys(value),
  box: (value: unknown) => new Box(value),
  // A clock: its result changes at each call, also with the same arguments.
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
  pure: ["add", "neg", "pair", "math.max", "apply", "map", "keys", "box", "ifError", "second"],
  volatile: ["now"],
};

/** More references in the generated documents: each one is a read to compare with the facts. */
const MORE_REFS: readonly (readonly Key[])[] = Array.from({ length: 8 }, () => ["ref"]);

const OP_TYPES: readonly (readonly Key[])[] = [...Object.keys(OPS).map((name) => ["ops", ...name.split(".")]), ["ops", "ifError"], ["ops", "second"], ["ops", "nothing"]];
const EXT_TYPES: readonly (readonly Key[])[] = [["ext", "undefined"], ["ext", "number"], ["ext", "here"], ["ext", "count"]];

function formulaOptions(machine: Machine, more: readonly (readonly Key[])[] = []): Omit<GenerateOptions, "seed"> {
  return {
    declaredType: "lit",
    names: Object.keys(NAMES),
    types: [...typesOf(machine.world), ...OP_TYPES, ...EXT_TYPES, ...more, ...MORE_REFS, ["if"], ["and"], ["fn"]],
    own: ["formula.lit", "formula.list", "nothing"],
    hints: (type, path) => (type[0] === "call" && path[0] === "fn" ? [["fn"], ["ref"]] : type[0] === "ops" && (type[1] === "map" || type[1] === "apply") ? [["fn"]] : undefined),
    data: (type, rng) => {
      const name = type.join(".");
      if (name === "ext.number") return rng.pick(["NaN", "-0", "Infinity", "bad"]);
      if (name === "lit" && rng.chance(0.1)) return ref("names", "a");
      return undefined;
    },
  };
}

/* A language on the formula kit: a deep shape for ref with step documents, an address and an effect. */

const language: Machine = formulaMachine(LOOSE, {
  replaces: [["world", "kinds", "ref"]],
  world: {
    kinds: {
      ref: { verbs: { eval: "formula.ref" }, parts: { shape: "deep" }, pure: true },
      moves: { kinds: {}, fallback: { verbs: { eval: "formula.step", step: "walk.at" }, parts: { shape: "deep" }, pure: true } },
      probe: { verbs: { eval: "test.probe" }, parts: { shape: "record", fields: { target: { shape: "term", of: "lit", address: true } }, required: ["target"] }, pure: true },
      say: { verbs: { eval: "test.say" }, parts: { shape: "list", of: "lit" }, effects: ["log"] },
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
    "test.say": ({ parts, effect }) => {
      const results = parts.map((part) => part.evaluate());
      return results.find((result) => !result.ok) ?? effect("log", results.map((result) => (result.ok ? result.value : null)));
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

/* The standard world, and trees with references between the attributes of their nodes. */

const STD_OPTIONS: Omit<GenerateOptions, "seed"> = {
  types: [...typesOf(STD_MACHINE.world), ...MORE_REFS, ["if"], ["pure"], ["seq"]],
  names: Object.keys(NAMES),
  own: ["math.add", "list.all", "nothing"],
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

/* The record of the reads of an evaluation: each resolution, with the place of the document that asked for it. */

interface Resolution {
  readonly place: readonly Key[];
  readonly path: readonly unknown[];
}

const BASE: unique symbol = Symbol("base");

/**
 * This function gives a machine whose evaluators and runners record each resolution with the place of their
 * document. A resolution goes through one runtime of the record, thus the record has it one time.
 */
function recording(machine: Machine, log: Resolution[]): Machine {
  let muted = 0;
  const proxy = (rt: Runtime, place: readonly Key[]): Runtime => {
    const base = (rt as Runtime & { readonly [BASE]?: Runtime })[BASE] ?? rt;
    const wrapped = {
      [BASE]: base,
      machine: base.machine,
      running: base.running,
      resolve: (ctx, path, options) => {
        if (muted === 0) log.push({ place, path });
        return base.resolve(ctx, path, options);
      },
      effect: (ctx, kind, payload, at) => base.effect(ctx, kind, payload, at),
      runEffect: (ctx, kind, payload, at) => base.runEffect(ctx, kind, payload, at),
      all: (list, options) => base.all(list, options),
    } satisfies Runtime & { readonly [BASE]: Runtime };
    return wrapped;
  };
  const viaInput = <I extends EvalInput | RunInput>(input: I): I =>
    ({
      ...input,
      resolve: (path: readonly unknown[], options?: ResolveOptions) => {
        log.push({ place: input.place, path });
        muted += 1;
        try {
          return input.resolve(path, options);
        } finally {
          muted -= 1;
        }
      },
    }) as I;
  const evaluators: Record<string, Evaluator> = {};
  for (const [name, evaluator] of Object.entries(machine.evaluators)) {
    evaluators[name] =
      typeof evaluator === "function"
        ? ((input) => (evaluator as EvalFn)(viaInput(input))) satisfies EvalFn
        : ({ compile: (input) => ((code) => (ctx, rt) => code(ctx, proxy(rt, input.place)))((evaluator as CompiledEvaluator).compile(input)) } satisfies CompiledEvaluator);
  }
  const runners: Record<string, Runner> = {};
  for (const [name, runner] of Object.entries(machine.runners ?? {})) {
    runners[name] =
      typeof runner === "function"
        ? ((input) => (runner as RunFn)(viaInput(input))) satisfies RunFn
        : ({ compileRun: (input) => ((code) => (ctx, rt) => code(ctx, proxy(rt, input.place)))((runner as CompiledRunner).compileRun(input)) } satisfies CompiledRunner);
  }
  return { ...machine, evaluators, runners };
}

/** This function tells if a static read covers a resolution: the same root, and its keys start the path. */
function covers(read: StaticRead, path: readonly unknown[]): boolean {
  if (read.root !== path[0]) return false;
  if (read.exact && path.length !== read.keys.length + 1) return false;
  return read.keys.every((key, index) => path[index + 1] === key);
}

function key(place: readonly Key[]): string {
  return JSON.stringify(place.map(String));
}

/** Two results are the same when their values are the same by `sameValue`, or their errors have one code and place. */
function sameOutcome(a: Result, b: Result): boolean {
  if (a.ok && b.ok) return sameValue(a.value, b.value, (x, y) => (x instanceof Box && y instanceof Box ? sameValue(x.v, y.v) : undefined));
  return !a.ok && !b.ok && a.error.code === b.error.code && docEquals(a.error.place ?? [], b.error.place ?? []);
}

/**
 * This function gives a context in which each value that no read reaches is another value. A read of `names`
 * without a name reaches each name. A read of a name reaches the names that a reference in its data reaches too.
 */
function unread(ctx: Context, facts: DocFacts): { readonly ctx: Context; readonly changed: number } {
  const roots = new Set(facts.reads.map((read) => read.root));
  const names = new Set<string>();
  let allNames = false;
  for (const read of facts.reads) {
    if (read.root !== "names") continue;
    const first = read.keys[0];
    if (first === undefined) allNames = true;
    else for (const name of [String(first), ...(IN_DATA[String(first)] ?? [])]) names.add(name);
  }
  let changed = 0;
  const next: Record<string, unknown> = {};
  for (const name of Object.keys(ctx.names)) {
    const keep = allNames || names.has(name);
    next[name] = keep ? ctx.names[name] : { changed: name };
    if (!keep) changed += 1;
  }
  const other = (root: "self" | "event"): unknown => {
    if (roots.has(root)) return ctx[root];
    changed += 1;
    return { changed: root };
  };
  return { ctx: { names: next, self: other("self"), event: other("event"), world: ctx.world, caps: roots.has("caps") ? ctx.caps : ["changed"] }, changed };
}

interface Outcome {
  /** The resolutions that no static read covers (FACTS.SOUND). */
  readonly uncovered: readonly string[];
  /** The eager reads that did not evaluate, while each document around them gave a value (FACTS.LAZY). */
  readonly skipped: readonly string[];
  /** The pure documents whose result changed with a value that no read reaches (FACTS.PURE). */
  readonly impure: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item: unknown) => (typeof item === "function" ? "<fn>" : item === undefined ? "<undefined>" : item));
  } catch {
    return String(value);
  }
}

/** This function evaluates the generated documents of a configuration, and compares each evaluation with the facts. */
function harness(config: Config, machine: Machine = config.machine, total: number = COUNT): Outcome {
  const uncovered: string[] = [];
  const skipped: string[] = [];
  const impure: string[] = [];
  const counts: Record<string, number> = { resolutions: 0, eager: 0, lazy: 0, inexact: 0, address: 0, pure: 0, changed: 0, volatile: 0 };
  const declared = config.options.declaredType === undefined ? {} : { declaredType: config.options.declaredType };
  const log: Resolution[] = [];
  const recorded = recording(machine, log);
  for (let index = 0; index < total; index += 1) {
    const seed = 7_000_003 + index;
    const doc = generate(machine.world, { ...config.options, seed });
    const ctx = CONTEXTS[index % CONTEXTS.length] as Context;
    const facts = factsOf(machine, doc, declared);
    const bound = new Set(refsOf(machine.world, doc, declared).filter((use) => !use.free).map((use) => key(use.place)));
    for (const read of facts.reads) {
      if (read.lazy) counts["lazy"] = (counts["lazy"] ?? 0) + 1;
      if (!read.exact) counts["inexact"] = (counts["inexact"] ?? 0) + 1;
      if (read.address) counts["address"] = (counts["address"] ?? 0) + 1;
    }
    if (facts.volatile) counts["volatile"] = (counts["volatile"] ?? 0) + 1;

    // FACTS.SOUND: each resolution of an evaluation has a static read at its place that covers it.
    log.length = 0;
    const result = prepare(recorded, doc, declared).evaluate(ctx);
    for (const resolution of log) {
      counts["resolutions"] = (counts["resolutions"] ?? 0) + 1;
      const root = resolution.path[0];
      if (typeof root !== "string" || !(ROOTS as readonly string[]).includes(root)) continue;
      const at = key(resolution.place);
      if (facts.reads.some((read) => key(read.place) === at && covers(read, resolution.path))) continue;
      if (bound.has(at)) continue;
      uncovered.push(`seed ${seed}: ${show(resolution.path)} at ${at}\n  doc ${show(doc)}`);
    }

    // FACTS.LAZY: an eager read evaluates when each document around it gives a value.
    const trace = flatten(evaluate(machine, doc, ctx, declared).trace);
    const results = new Map<string, boolean>();
    for (const node of trace) results.set(key(node.path), (results.get(key(node.path)) ?? false) || node.result.ok);
    const chains = new Map<string, readonly string[]>();
    walk(
      machine.world,
      doc,
      (visit) => {
        const around: string[] = [];
        for (let up = visit.parent; up !== undefined; up = up.parent) around.push(key(up.place));
        chains.set(key(visit.place), around);
        return undefined;
      },
      declared,
    );
    for (const read of facts.reads) {
      if (read.lazy) continue;
      const at = key(read.place);
      const around = chains.get(at) ?? [];
      if (!around.every((place) => results.get(place) === true)) continue;
      counts["eager"] = (counts["eager"] ?? 0) + 1;
      if (!results.has(at)) skipped.push(`seed ${seed}: the read ${show(read.path)} at ${at} did not evaluate\n  doc ${show(doc)}`);
    }

    // FACTS.PURE: a pure document gives the same result when each value that no read reaches changes.
    if (!facts.pure) continue;
    counts["pure"] = (counts["pure"] ?? 0) + 1;
    const other = unread(ctx, facts);
    if (other.changed === 0) continue;
    counts["changed"] = (counts["changed"] ?? 0) + 1;
    const again = prepare(machine, doc, declared).evaluate(other.ctx);
    if (!sameOutcome(result, again)) impure.push(`seed ${seed}: ${show(result)} and then ${show(again)}\n  doc ${show(doc)}`);
  }
  return { uncovered, skipped, impure, counts };
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

describe("the static facts of generated documents", () => {
  it("[FACTS.SOUND] each path that a plan resolves has a static read at its place that covers it", () => {
    for (const config of CONFIGS) {
      const outcome = outcomeOf(config);
      expect(outcome.uncovered.slice(0, 3), `${config.name}: ${show(outcome.counts)}`).toEqual([]);
      expect(outcome.counts["resolutions"] ?? 0, config.name).toBeGreaterThan(COUNT / 5);
    }
  }, 120_000);

  it("[FACTS.LAZY] an eager read evaluates in each evaluation in which each document around it gives a value", () => {
    for (const config of CONFIGS) {
      const outcome = outcomeOf(config);
      expect(outcome.skipped.slice(0, 3), config.name).toEqual([]);
      expect(outcome.counts["eager"] ?? 0, config.name).toBeGreaterThan(COUNT / 10);
    }
    // The generated documents reach lazy reads, reads after a step document and addresses.
    expect(CONFIGS.every((config) => (outcomeOf(config).counts["lazy"] ?? 0) > 0)).toBe(true);
    expect(outcomeOf(CONFIGS[1] as Config).counts["inexact"] ?? 0).toBeGreaterThan(0);
    expect(outcomeOf(CONFIGS[5] as Config).counts["address"] ?? 0).toBeGreaterThan(0);
    // A contract that forgets the lazy rule of if gives a read that the harness finds.
    const { lazy: _rule, ...eagerIf } = formulaKinds()["if"] as Kind;
    const forgetful = formulaMachine(STRICT, { world: { kinds: { if: eagerIf } }, replaces: [["world", "kinds", "if"]] });
    expect(harness(CONFIGS[2] as Config, forgetful).skipped.length).toBeGreaterThan(0);
  }, 120_000);

  it("[FACTS.PURE] a pure document gives the same result when each value that no read reaches changes", () => {
    for (const config of CONFIGS) {
      const outcome = outcomeOf(config);
      expect(outcome.impure.slice(0, 3), config.name).toEqual([]);
    }
    const pure = CONFIGS.reduce((sum, config) => sum + (outcomeOf(config).counts["changed"] ?? 0), 0);
    expect(pure).toBeGreaterThan(COUNT);
    expect(outcomeOf(CONFIGS[2] as Config).counts["volatile"] ?? 0).toBeGreaterThan(0);
    // A volatile operation that the profile does not name gives another result, and the harness finds it.
    const unmarked = formulaMachine({ ...STRICT, volatile: [] });
    expect(harness(CONFIGS[2] as Config, unmarked).impure.length).toBeGreaterThan(0);
  }, 120_000);
});

/* The rules on small documents. */

const machine = formulaMachine(STRICT);

describe("factsOf", () => {
  it("[FACTS.READS] the reads are the free references from a root, with their keys, places and JSON paths", () => {
    const doc = {
      type: "let",
      value: {
        bind: { x: ref("names", "a", "b") },
        body: { type: ["ops", "pair"], value: [ref("names", "x"), { type: "list", value: [ref("self", "width"), ref("event"), ref("caps"), ref("world", "lit"), ref("nowhere", "a")] }] },
      },
    };
    const facts = factsOf(machine, doc);
    expect(facts.reads.map((read) => [read.root, read.keys, read.exact, read.place, read.at])).toEqual([
      ["names", ["a", "b"], true, ["bind", "x"], ["value", "bind", "x"]],
      ["self", ["width"], true, ["body", 1, 0], ["value", "body", "value", 1, "value", 0]],
      ["event", [], true, ["body", 1, 1], ["value", "body", "value", 1, "value", 1]],
      ["caps", [], true, ["body", 1, 2], ["value", "body", "value", 1, "value", 2]],
      ["world", ["lit"], true, ["body", 1, 3], ["value", "body", "value", 1, "value", 3]],
    ]);
    expect(facts.size).toBe(10);
    // A step document ends the keys: the plan resolves a path that starts with them.
    const tree = factsOf(STD_MACHINE, ref("self", "parent", { type: "nearest", value: { type: "panel" } }, "width"));
    expect(tree.reads).toMatchObject([{ root: "self", keys: ["parent"], exact: false, lazy: false, address: false }]);
    // A reference in an address position is an address. It still resolves its path.
    expect(factsOf(language, { type: "probe", value: { target: ref("names", "h") } }).reads).toMatchObject([{ root: "names", keys: ["h"], address: true }]);
    // A bare root value gets its declared type.
    expect(factsOf(machine, [1, ref("names", "a")], { declaredType: "list" }).reads).toMatchObject([{ keys: ["a"], place: [1], at: [1] }]);
  });

  it("[FACTS.LAZY] a read under a branch of if, a later term of and or or, the body of fn or a lazy operation is lazy", () => {
    const lazyOf = (target: Machine, doc: unknown): readonly [string, boolean][] => factsOf(target, doc).reads.map((read) => [read.keys.join("."), read.lazy]);
    const branch = { type: "if", value: { test: ref("names", "t"), then: ref("names", "a"), else: { type: "list", value: [ref("names", "b")] } } };
    expect(lazyOf(machine, branch)).toEqual([["t", false], ["a", true], ["b", true]]);
    expect(lazyOf(machine, { type: "and", value: [ref("names", "p"), ref("names", "q"), ref("names", "r")] })).toEqual([["p", false], ["q", true], ["r", true]]);
    expect(lazyOf(machine, { type: "or", value: [ref("names", "p"), ref("names", "q")] })).toEqual([["p", false], ["q", true]]);
    expect(lazyOf(machine, { type: "fn", value: { params: ["x"], body: { type: ["ops", "add"], value: [ref("names", "x"), ref("names", "y")] } } })).toEqual([["y", true]]);
    expect(lazyOf(machine, { type: ["ops", "ifError"], value: [ref("names", "p"), ref("names", "q")] })).toEqual([["p", true], ["q", true]]);
    expect(lazyOf(machine, { type: ["ops", "add"], value: [ref("names", "p"), ref("names", "q")] })).toEqual([["p", false], ["q", false]]);
    // Each attribute of a node evaluates on demand (TREE.LAZY). The node itself reads the root self (FACTS.KIND-READS).
    // The first part of pure is the only part that it evaluates.
    expect(lazyOf(STD_MACHINE, { type: "panel", value: { width: ref("self", "a") } })).toEqual([["", false], ["a", true]]);
    expect(lazyOf(STD_MACHINE, { type: "pure", value: [ref("names", "p"), ref("names", "q")] })).toEqual([["p", false], ["q", true]]);
    // A rule after counts only the parts that its patterns match.
    const counted: Machine = {
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, pick: { verbs: { eval: "list.all" }, parts: { shape: "record", fields: ["a", "b", "c"] }, lazy: [{ in: [["b"], ["c"]], after: 1 }] } } },
    };
    expect(lazyOf(counted, { type: "pick", value: { a: ref("names", "a"), b: ref("names", "b"), c: ref("names", "c") } })).toEqual([["a", false], ["b", false], ["c", true]]);
    // An own entry names an evaluator that the contract of the kind does not describe: each of its parts is lazy.
    expect(lazyOf(machine, { type: "list", own: { eval: "formula.lit" }, value: [ref("names", "a")] })).toEqual([["a", true]]);
    expect(lazyOf(machine, { type: "list", own: { eval: "formula.list" }, value: [ref("names", "a")] })).toEqual([["a", false]]);
  });

  it("[FACTS.SIDE] the side is run when one kind of the document is on the run side", () => {
    expect(factsOf(STD_MACHINE, { type: "add", value: [1, 2] }).side).toBe("derive");
    expect(factsOf(STD_MACHINE, { type: "seq", value: [{ type: "number", value: 1 }, { type: "log", value: ["x"] }] }).side).toBe("run");
    expect(factsOf(STD_MACHINE, { type: "if", value: { test: { type: "bool", value: false }, then: { type: "log", value: ["x"] } } })).toMatchObject({ side: "run", pure: false });
  });

  it("[FACTS.EFFECTS] the effects are the kinds of effects that the contracts declare, each one time, in the order of the document", () => {
    const log = { type: "log", value: ["x"] };
    const write = { type: "write", value: { key: "k", value: { type: "number", value: 1 } } };
    expect(factsOf(STD_MACHINE, { type: "seq", value: [log, write, log] }).effects).toEqual(["log", "write"]);
    expect(factsOf(STD_MACHINE, { type: "add", value: [1] }).effects).toEqual([]);
    // The effects "type" of a call give the type of the document itself.
    const call: Kind = { verbs: { eval: "call" }, parts: { shape: "deep" }, side: "run", effects: "type" };
    const open: Machine = { world: { kinds: { fs: { kinds: {}, fallback: call } }, defaults: {} }, evaluators: { call: () => ok(null) } };
    expect(factsOf(open, { type: ["fs", "read.json"], value: { path: "a" } })).toMatchObject({ effects: ["fs.read.json"], side: "run", pure: false });
  });

  it("[FACTS.PURE] a document is pure when each kind declares pure, and it has no effect, no own evaluator and no unknown kind", () => {
    expect(factsOf(STD_MACHINE, { type: "add", value: [1, ref("names", "a")] }).pure).toBe(true);
    expect(factsOf(STD_MACHINE, { type: "log", value: ["x"] }).pure).toBe(false);
    expect(factsOf(STD_MACHINE, { type: "nothing", value: 1 }).pure).toBe(false);
    expect(factsOf(machine, { type: "list", own: { eval: "formula.lit" }, value: [1] }).pure).toBe(false);
    // An extension of the profile gets the context, thus it can read outside resolve. A standard extension is pure.
    expect(factsOf(machine, { type: ["ext", "here"], value: null }).pure).toBe(false);
    expect(factsOf(machine, { type: ["ext", "number"], value: "NaN" }).pure).toBe(true);
    // An operation is pure only when the profile names it.
    expect(factsOf(formulaMachine({ ops: OPS }), { type: ["ops", "add"], value: [1, 2] }).pure).toBe(false);
    expect(factsOf(formulaMachine({ ops: OPS, pure: ["add"] }), { type: ["ops", "add"], value: [1, 2] }).pure).toBe(true);
    // A step document is pure when its kind is pure.
    expect(factsOf(STD_MACHINE, ref("self", { type: "nearest", value: { type: "panel" } })).pure).toBe(true);
    const unknownStep = factsOf(STD_MACHINE, ref("self", { type: "zzz", value: 1 }));
    expect(unknownStep.pure).toBe(false);
  });

  it("[FACTS.VOLATILE] a volatile operation or kind, or a read that the host marks, makes a document volatile; a read of event and an effect do not", () => {
    expect(factsOf(machine, { type: ["ops", "now"], value: [] })).toMatchObject({ volatile: true, pure: false });
    expect(factsOf(machine, { type: "list", value: [ref("event", "key")] })).toMatchObject({ volatile: false, pure: true });
    expect(factsOf(STD_MACHINE, { type: "log", value: ["x"] })).toMatchObject({ volatile: false, pure: false });
    // The host marks the read of a function that reads a clock.
    const doc = { type: "call", value: { fn: ref("names", "random"), args: [] } };
    expect(factsOf(machine, doc)).toMatchObject({ volatile: false, pure: true });
    expect(factsOf(machine, doc, { volatile: (read) => read.root === "names" && read.keys[0] === "random" })).toMatchObject({ volatile: true, pure: false });
    // A kind and a kind of step documents declare volatile in their contracts.
    const clocks: Machine = {
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, now: { verbs: { eval: "data.number" }, volatile: true }, live: { verbs: { step: "walk.nearest" }, pure: true, volatile: true } } },
    };
    expect(factsOf(clocks, { type: "list", value: [{ type: "now", value: 1 }] })).toMatchObject({ volatile: true, pure: false });
    expect(factsOf(clocks, ref("self", { type: "live", value: { type: "panel" } }))).toMatchObject({ volatile: true, pure: false });
  });

  it("[FACTS.HOOK] the hook facts of a machine answers for the code of a name and wins over the contract; mergeMachines composes the hooks in order", () => {
    const kinds = { x: { verbs: { eval: "a" } }, y: { verbs: { eval: "b" }, pure: true } };
    const one: EvalFn = () => ok(1);
    const first = (_path: readonly Key[], code: string) => (code === "a" ? { pure: true } : undefined);
    const second = (_path: readonly Key[], code: string) => (code === "b" ? { pure: false, volatile: true } : code === "a" ? { pure: false } : undefined);
    const merged = mergeMachines({ world: { kinds }, evaluators: { a: one, b: one }, facts: first }, { facts: second });
    expect([merged.facts?.(["x"], "a"), merged.facts?.(["y"], "b"), merged.facts?.(["z"], "c")]).toEqual([{ pure: true }, { pure: false, volatile: true }, undefined]);
    expect(factsOf(merged, { type: "x", value: null })).toMatchObject({ pure: true, volatile: false });
    expect(factsOf(merged, { type: "y", value: null })).toMatchObject({ pure: false, volatile: true });
    // A hook does not answer for a name whose code a later part replaces. One hook in two parts is one hook.
    const replaced = mergeMachines({ world: { kinds }, evaluators: { a: one }, facts: first }, { evaluators: { a: () => ok(2) }, replaces: [["evaluators", "a"]] });
    expect(replaced.facts?.(["x"], "a")).toBeUndefined();
    expect(mergeMachines({ facts: first }, { facts: first }).facts).toBe(first);
    // The hook can answer for the evaluator of an own entry.
    expect(factsOf(merged, { type: "y", own: { eval: "a" }, value: null }).pure).toBe(true);
  });

  it("[FACTS.KIND-READS] a kind declares the roots that its code resolves as a whole, and each document of the kind reads them", () => {
    // Each node of a tree resolves self (TREE.SELF). The read has the place of the node, and the lazy mark of its way.
    const tree = { type: "panel", value: { width: 1, children: { type: "list", value: [{ type: "box", value: { width: 2 } }] } } };
    const facts = factsOf(STD_MACHINE, tree);
    expect(facts.pure).toBe(true);
    expect(facts.reads.map((read) => [read.root, read.keys, read.exact, read.lazy, read.path, read.place])).toEqual([
      ["self", [], true, false, ["self"], []],
      ["self", [], true, true, ["self"], ["children", 0]],
    ]);
    // The hook can give the roots for a name, and the contract does not describe the code of an own entry.
    const kinds = { peek: { verbs: { eval: "peek" }, pure: true, reads: ["event" as const] } };
    const peeker: Machine = { world: { kinds, defaults: {} }, evaluators: { peek: () => ok(1), other: () => ok(2) }, facts: (_path, code) => (code === "other" ? { reads: ["names"] } : undefined) };
    expect(factsOf(peeker, { type: "peek", value: null }).reads).toMatchObject([{ root: "event", keys: [], exact: true, place: [] }]);
    expect(factsOf(peeker, { type: "peek", own: { eval: "other" }, value: null }).reads).toMatchObject([{ root: "names", keys: [] }]);
    // A host marks a declared read volatile, as a reference.
    expect(factsOf(peeker, { type: "peek", value: null }, { volatile: (read) => read.root === "event" }).volatile).toBe(true);
  });

  it("[FACTS.VERB] the option verb names the verb whose code the facts describe, and only the hook describes the code of another verb", () => {
    const formats: Machine = { ...STD_MACHINE, world: { ...STD_MACHINE.world, defaults: { ...STD_MACHINE.world.defaults, format: "show" } } };
    const doc = { type: "if", value: { test: ref("names", "t"), then: ref("names", "a") } };
    expect(factsOf(formats, doc, { verb: "eval" })).toMatchObject({ pure: true });
    const other = factsOf(formats, doc, { verb: "format" });
    expect([other.pure, other.reads.map((read) => read.lazy)]).toEqual([false, [true, true]]);
    const described: Machine = { ...formats, facts: (_path, code) => (code === "show" ? { pure: true, lazy: [] } : undefined) };
    const answered = factsOf(described, doc, { verb: "format" });
    expect([answered.pure, answered.reads.map((read) => read.lazy)]).toEqual([true, [false, false]]);
    // The reads, the side and the effects do not depend on the verb.
    const log = { type: "seq", value: [ref("names", "a"), { type: "log", value: ["x"] }] };
    expect(factsOf(formats, log, { verb: "format" })).toMatchObject({ side: "run", effects: ["log"], reads: [{ keys: ["a"] }] });
    // A step document runs the walker that the ladder finds. An own entry of step names code that the contract does not describe.
    const step = (own?: Readonly<Record<string, string>>): Json => ref("self", { type: "nearest", ...(own === undefined ? {} : { own }), value: { type: "panel" } });
    expect([factsOf(STD_MACHINE, step()).pure, factsOf(STD_MACHINE, step({ step: "walk.other" })).pure, factsOf(STD_MACHINE, step({ step: "walk.nearest" })).pure]).toEqual([true, false, true]);
  });

  it("[FACTS.PROFILE] formulaMachine gives the hook facts of its profile: lazy, pure and volatile operations, and the extensions", () => {
    const facts = formulaFacts(STRICT);
    expect(facts(["ops", "add"], "formula.op")).toEqual({ pure: true, volatile: false });
    expect(facts(["ops", "now"], "formula.op")).toEqual({ pure: false, volatile: true });
    expect(facts(["ops", "second"], "formula.op")).toEqual({ pure: true, volatile: false, lazy: [{}] });
    expect(facts(["ops", "nothing"], "formula.op")).toBeUndefined();
    expect(facts(["ext", "number"], "formula.ext")).toEqual({ pure: true });
    expect(facts(["ext", "here"], "formula.ext")).toEqual({ pure: false });
    // A profile names its pure extensions in pureExt (D47). The mark pure: true covers only the operations.
    const named = formulaFacts({ ...STRICT, pureExt: ["count", "nothing"] });
    expect([named(["ext", "count"], "formula.ext"), named(["ext", "here"], "formula.ext"), named(["ext", "nothing"], "formula.ext")]).toEqual([{ pure: true }, { pure: false }, undefined]);
    expect(facts(["if"], "formula.if")).toBeUndefined();
    expect(formulaFacts({ ops: OPS, pure: ["neg"] })(["ops", "add"], "formula.op")).toEqual({ pure: false, volatile: false });
    expect(formulaFacts({})(["ops", "add"], "formula.op")).toBeUndefined();
    // The kinds of the kit declare their facts in their contracts.
    const kit = formulaKinds();
    expect(["lit", "ref", "record", "list", "let", "fn", "call", "if", "and", "or"].every((name) => (kit[name] as Kind).pure === true)).toBe(true);
    expect((kit["if"] as Kind).lazy).toEqual([{ in: [["then"], ["else"]] }]);
    expect(machine.facts).toBeDefined();
  });
});
