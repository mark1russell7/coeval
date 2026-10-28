import { describe, expect, it } from "vitest";
import {
  type AgreeOptions,
  type CompiledEvaluator,
  type CompiledRunner,
  type Context,
  type Definitions,
  type Effect,
  type EvalError,
  type FormulaProfile,
  type GenerateOptions,
  type HostThing,
  type Json,
  type Key,
  type Machine,
  type MachinePart,
  type Result,
  type Runtime,
  type Steps,
  type TierInput,
  type TierResult,
  Failure,
  STD_DEFINITIONS,
  STD_MACHINE,
  THING,
  agree,
  check,
  context,
  docEquals,
  evaluate,
  fail,
  formulaDefinitions,
  formulaEvaluators,
  formulaMachine,
  generate,
  isEnvelope,
  isRef,
  isStackOverflow,
  jsTruthy,
  lookupKind,
  mergeMachines,
  nodeAt,
  ok,
  permits,
  prepare,
  random,
  reference,
  run,
  sameValue,
  typeName,
  typesOf,
  walk,
} from "./index.ts";

/** The number of documents for each configuration. CI and a nightly run can raise it with COEVAL_AGREE_COUNT. */
const COUNT = Number(process.env["COEVAL_AGREE_COUNT"] ?? 300);
const SEED = Number(process.env["COEVAL_AGREE_SEED"] ?? 1);

/* The values of the contexts: hard leaves, an envelope, a reference, a cycle, and host things with and without resolve. */

class Box {
  constructor(readonly v: unknown) {}
}

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

const proto: Record<string, unknown> = { a: 1 };
Object.defineProperty(proto, "__proto__", { value: 3, enumerable: true, writable: true, configurable: true });

const parent = thing("node panel", { width: 4, a: 1 }, false, "panel");
const self = thing("node box", { width: 2, x: [1, 2], parent }, true, "box");

const NAMES: Readonly<Record<string, unknown>> = {
  a: 1,
  b: [1, "two", null],
  x: proto,
  n: Number.NaN,
  last: -0,
  ["__proto__"]: { a: { type: "number", value: 5 } },
  env: { type: "number", value: 5 },
  hop: { type: "ref", value: ["names", "a"] },
  loop: { type: "ref", value: ["names", "loop"] },
  u: undefined,
  h: thing("host", { a: 2, b: { x: 1 } }, true),
  k: thing("plain host", { a: 3 }, false),
  f: (value: unknown) => [value],
};

function names(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(NAMES)) Object.defineProperty(out, key, { value: NAMES[key], enumerable: true, writable: true, configurable: true });
  return out;
}

const CONTEXTS: readonly Context[] = [
  context({ names: names(), caps: ["log", "write"], self, event: { a: 1, x: { a: 2 } } }),
  context({ names: names(), caps: [] }),
  context({ names: names(), caps: [["log"]], self: { a: 1, parent: null } }),
];

/* The standard world, with a runner that waits, and a narrow limit of depth. */

const waiting: Machine = {
  ...STD_MACHINE,
  world: {
    ...STD_MACHINE.world,
    kinds: {
      ...STD_MACHINE.world.kinds,
      wait: { verbs: { eval: "test.wait" }, side: "run" },
      both: { verbs: { eval: "test.all" }, parts: { shape: "list" } },
      grant: { verbs: { eval: "test.grant" }, parts: { shape: "list" } },
    },
  },
  evaluators: {
    ...STD_MACHINE.evaluators,
    // The evaluator asks for more capabilities for its part. The kernel gives only the capabilities of the parent (CAP.NARROW).
    "test.grant": ({ parts, context: ctx }) => parts[0]?.evaluate({ ...ctx, caps: ["log", "write", "more"] }) ?? ok(null),
  },
  runners: {
    ...STD_MACHINE.runners,
    "test.wait": function* (): Steps {
      yield Promise.resolve();
      return ok(null);
    },
    "test.all": function* ({ parts, all }): Steps {
      const results = yield* all(parts, { failFast: true, concurrency: 2 });
      return ok(results.map((result) => (result.ok ? result.value : result.error.code)));
    },
  },
};

const STD_OPTIONS: Omit<GenerateOptions, "seed"> = {
  names: Object.keys(NAMES),
  own: ["math.add", "list.all", "nothing"],
  data: (type, rng) => {
    const name = type.join(".");
    if (name === "number") return rng.chance(0.9) ? rng.pick([0, 1, 2, 3.5, -1]) : "1";
    if (name === "text") return rng.chance(0.9) ? rng.pick(["", "a", "b"]) : 1;
    if (name === "bool") return rng.chance(0.9) ? rng.chance(0.5) : 0;
    if (name === "nearest") return rng.pick<Json>([{ type: "panel" }, { type: "box", self: true }, { type: "none" }, "panel"]);
    return undefined;
  },
};

/*
 * Compiled code that tries to give its parts more capabilities than its document has (CAP.NARROW-CODE, R7 P2). The
 * definitions of the reference try the same with function code, which the kernel narrows.
 */

const WIDE: readonly string[] = ["log", "write", "more"];

/** This function gives the context with more capabilities that each kind below gives its parts. */
function widened(ctx: Context): Context {
  return { ...ctx, caps: WIDE };
}

/** This function gives the values of results in their order, or the first error. */
function valuesOf(results: Iterable<Result>): Result {
  const values: unknown[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

/** A compiled evaluator that gives each part a context with more capabilities. */
const widenCode: CompiledEvaluator = {
  compile: ({ parts }) => (ctx, rt) => valuesOf(parts.map((part) => part.code(widened(ctx), rt))),
};

/** A compiled runner that gives each part a context with more capabilities. */
const widenRun: CompiledRunner = {
  compileRun: ({ parts }) =>
    function* (ctx, rt): Steps {
      const results: Result[] = [];
      for (const part of parts) {
        const result = yield* part.run(widened(ctx), rt);
        results.push(result);
        if (!result.ok) break;
      }
      return valuesOf(results);
    },
};

/** A compiled evaluator that causes its own effect in a context with more capabilities. */
const shoutCode: CompiledEvaluator = {
  compile: ({ parts, place }) => (ctx, rt) => {
    const values = valuesOf(parts.map((part) => part.code(ctx, rt)));
    return values.ok ? rt.effect(widened(ctx), "log", values.value, place) : values;
  },
};

const widening: Machine = {
  ...waiting,
  world: {
    ...waiting.world,
    kinds: {
      ...waiting.world.kinds,
      widen: { verbs: { eval: "test.widen" }, parts: { shape: "list" } },
      widenRun: { verbs: { eval: "test.widen-run" }, parts: { shape: "list" } },
      widenLog: { verbs: { eval: "test.widen" }, parts: { shape: "list" }, caps: [{ rule: "only", caps: ["log"] }] },
      shout: { verbs: { eval: "test.shout" }, parts: { shape: "list", of: "text" }, effects: ["log"] },
    },
  },
  evaluators: { ...waiting.evaluators, "test.widen": widenCode, "test.shout": shoutCode },
  runners: { ...waiting.runners, "test.widen-run": widenRun },
};

const WIDENING_DEFINITIONS: Definitions = {
  evaluators: {
    "test.widen": ({ parts, context: ctx }) => valuesOf(parts.map((part) => part.evaluate(widened(ctx)))),
    "test.shout": ({ parts, effect }) => {
      const values = valuesOf(parts.map((part) => part.evaluate()));
      return values.ok ? effect("log", values.value) : values;
    },
  },
  runners: {
    "test.widen-run": function* ({ parts, context: ctx }): Steps {
      const results: Result[] = [];
      for (const part of parts) {
        const result = yield* part.evaluate(widened(ctx));
        results.push(result);
        if (!result.ok) break;
      }
      return valuesOf(results);
    },
  },
};

const WIDENING_KINDS = new Set(["widen", "widenRun", "widenLog"]);

/** The documents of `widening` often have a kind that widens, and they prefer effects in its parts. */
const WIDENING_OPTIONS: Omit<GenerateOptions, "seed"> = {
  ...STD_OPTIONS,
  types: [...typesOf(widening.world), ...[...WIDENING_KINDS, "shout"].flatMap((kind) => [[kind], [kind], [kind]])],
  hints: (type) => (WIDENING_KINDS.has(String(type[0])) ? [["log"], ["write"], ["shout"], ["seq"], ["ref"]] : undefined),
};

/* The formula kit, with test profiles. */

const calls: unknown[] = [];

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
  tick: (value: unknown) => {
    calls.push(value);
    return value;
  },
  apply: (fn: (value: unknown) => unknown, value: unknown) => fn(value),
  map: (fn: (value: unknown) => unknown, items: readonly unknown[]) => items.map((item) => fn(item)),
  keys: (value: object) => Object.keys(value),
  box: (value: unknown) => new Box(value),
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
  bad: () => {
    throw new Error("bad extension");
  },
};

const PROFILES: Readonly<Record<string, FormulaProfile>> = {
  strict: { ops: OPS, lazy: LAZY, ext: EXT },
  loose: {
    ops: OPS,
    lazy: LAZY,
    ext: EXT,
    truthy: jsTruthy,
    logic: "value",
    otherwise: undefined,
    omit: (error) => error.code === "#N/A",
    missing: (value) => value === undefined,
    check: (value) => (typeof value === "number" && !Number.isFinite(value) ? fail("#NUM!", "The number is not finite.") : undefined),
    combine: (errors) => ({ code: "#MANY", reason: `${errors.length} parts failed.` }),
  },
  table: {
    ops: (name) => {
      if (name === "trap") throw new Error("The table has no trap.");
      return Object.hasOwn(OPS, name) ? OPS[name] : undefined;
    },
    truthy: (value) => (value === 1 ? true : value === 0 ? false : undefined),
    otherwise: "none",
  },
};

const OP_TYPES: readonly (readonly Key[])[] = [...Object.keys(OPS).map((name) => ["ops", ...name.split(".")]), ["ops", "nothing"], ["ops", "trap"], ["ops", "ifError"], ["ops", "second"]];
const EXT_TYPES: readonly (readonly Key[])[] = [["ext", "undefined"], ["ext", "number"], ["ext", "here"], ["ext", "count"], ["ext", "bad"], ["ext", "nope"]];

function formulaOptions(machine: Machine): Omit<GenerateOptions, "seed"> {
  return {
    declaredType: "lit",
    names: Object.keys(NAMES),
    types: [...typesOf(machine.world), ...OP_TYPES, ...EXT_TYPES],
    own: ["formula.lit", "formula.list", "nothing"],
    hints: (type, path) => (type[0] === "call" && path[0] === "fn" ? [["fn"], ["ref"]] : type[0] === "ops" && (type[1] === "map" || type[1] === "apply") ? [["fn"]] : undefined),
    data: (type, rng) => {
      const name = type.join(".");
      if (name === "ext.number") return rng.pick(["NaN", "-0", "Infinity", "-Infinity", "bad"]);
      if (name === "lit" && rng.chance(0.1)) return { type: "ref", value: ["names", "a"] };
      return undefined;
    },
  };
}

/* A language on the formula kit: a deep shape for ref with step documents, an address, permitted kinds and data shapes. */

const language: Machine = formulaMachine(PROFILES["loose"], {
  // The kind ref of the language replaces the kind ref of the kit (WORLD.REPLACE).
  replaces: [["world", "kinds", "ref"]],
  world: {
    kinds: {
      ref: { verbs: { eval: "formula.ref" }, parts: { shape: "deep" } },
      moves: { kinds: {}, fallback: { verbs: { eval: "formula.step", step: "walk.at" }, parts: { shape: "deep" } } },
      probe: { verbs: { eval: "test.probe" }, parts: { shape: "record", fields: { target: { shape: "term", of: "lit", address: true } }, required: ["target"] } },
      pick: { verbs: { eval: "formula.list" }, parts: { shape: "list", item: { shape: "term", of: "lit", kinds: [["lit"], ["ops"]] } } },
      set: { verbs: { eval: "formula.list" }, parts: { shape: "list", of: "lit", distinct: true } },
      range: {
        verbs: { eval: "test.fill" },
        parts: {
          shape: "record",
          fields: { lo: { shape: "number", min: 0 }, hi: { shape: "number", whole: true, max: 9 }, mode: { shape: "one", values: ["a", "b"] }, label: { shape: "text" }, body: { shape: "term", of: "lit" } },
          required: ["body"],
          closed: true,
        },
      },
      fence: { verbs: { eval: "test.fill" }, parts: { shape: "record", fields: { open: { shape: "term", of: "lit" }, shut: { shape: "term", of: "lit" } } }, caps: [{ rule: "mask", in: [["shut"]] }, { rule: "only", caps: ["log"] }] },
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
    "test.fill": ({ parts, fill }) => {
      const results = parts.map((part) => part.evaluate());
      const failed = results.find((result) => !result.ok);
      return failed ?? ok(fill(results.map((result) => (result.ok ? result.value : null))));
    },
    "test.say": ({ parts, effect }) => {
      const results = parts.map((part) => part.evaluate());
      const failed = results.find((result) => !result.ok);
      return failed ?? effect("log", results.map((result) => (result.ok ? result.value : null)));
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

const LANGUAGE_TYPES: readonly (readonly Key[])[] = [...typesOf(language.world), ["moves", "up"], ["moves", "at"], ...OP_TYPES.slice(0, 4), ["ext", "here"]];

/* The language with a default of step: the walker walk.at walks a step document of each kind without the verb step (VERB.LADDER). */
const defaulted: Machine = mergeMachines(language, { world: { defaults: { step: "walk.at" } } });

/** The rule of the tests for a value that is not JSON: two boxes are the same when their contents are the same. */
function boxes(a: unknown, b: unknown): boolean | undefined {
  return a instanceof Box && b instanceof Box ? sameValue(a.v, b.v, boxes) : undefined;
}

/*
 * Trees: mostly nodes, lists and references from self, with the attributes of the tree kinds as keys and longer paths.
 * Thus a path reads an attribute of the node, of its parent, of a child or of a sibling, and some paths form cycles.
 */
const TREE_OPTIONS: Omit<GenerateOptions, "seed"> = {
  ...STD_OPTIONS,
  types: [["panel"], ["panel"], ["box"], ["box"], ["list"], ["ref"], ["ref"], ["add"], ["number"], ["if"], ["greater"], ["nearest"]],
  roots: ["self"],
  keys: ["width", "height", "children", "children", "parent", "parent", 0, 1, "type", "a"],
  steps: 4,
  maxDepth: 5,
  maxSize: 30,
};

/* The configurations of the harness. */

interface Config {
  readonly name: string;
  readonly machine: Machine;
  readonly options: Omit<GenerateOptions, "seed">;
  readonly agree: AgreeOptions;
}

function formulaConfig(name: string, profile: FormulaProfile, more: Partial<Machine> = {}): Config {
  const machine = formulaMachine(profile, more);
  return {
    name,
    machine,
    options: formulaOptions(machine),
    agree: { strict: true, definitions: formulaDefinitions(profile), declaredType: "lit", observe: () => calls.splice(0), equal: boxes },
  };
}

/** A navigator that adopts each record with the field `a` as a host thing. A path then reads it through the thing. */
function adopt(value: unknown): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.hasOwn(value, "a")
    ? thing("adopted", value as Record<string, unknown>, false)
    : value;
}

const STRICT = PROFILES["strict"] as FormulaProfile;
const LOOSE = PROFILES["loose"] as FormulaProfile;

/* Two languages in one machine (MACHINE.AGREES): the formula kit, and a language that extends the namespace ops and adds kinds. */

const SECOND: MachinePart = {
  world: {
    kinds: {
      ops: { kinds: { twice: { verbs: { eval: "second.twice" }, parts: { shape: "list", of: "lit" } } } },
      shout: { verbs: { eval: "second.shout" }, parts: { shape: "list", of: "lit" }, effects: ["log"] },
      double: { type: "ref", value: ["world", "ops", "twice"] },
    },
  },
  evaluators: {
    "second.twice": ({ parts }) => {
      const results = parts.map((part) => part.evaluate());
      const failed = results.find((result) => !result.ok);
      if (failed !== undefined) return failed;
      const [first] = results;
      return first?.ok === true && typeof first.value === "number" ? ok(first.value * 2) : fail("#VALUE!", "twice needs one number.");
    },
    "second.shout": ({ parts, effect }) => {
      const results = parts.map((part) => part.evaluate());
      const failed = results.find((result) => !result.ok);
      return failed ?? effect("log", results.map((result) => (result.ok ? result.value : null)));
    },
  },
};

const composed: Machine = mergeMachines(formulaMachine(STRICT), SECOND);

/** A mock of the host (AGREE.MOCK). Its answer depends only on the effect and its address, thus each tier gets the same answer. */
function hostMock(effect: Effect): unknown {
  if (effect.payload === "b") throw new Failure({ code: "#MOCK", reason: "The mock refuses b." });
  if (effect.payload === "") throw new Error("The mock refuses an empty text.");
  return effect.kind === "write" ? { stored: effect.address } : [effect.address, effect.payload];
}

const CONFIGS: readonly Config[] = [
  { name: "standard", machine: waiting, options: STD_OPTIONS, agree: { strict: true } },
  { name: "standard, a mock of the host", machine: waiting, options: STD_OPTIONS, agree: { strict: true, perform: hostMock } },
  { name: "standard, compiled code that widens", machine: widening, options: WIDENING_OPTIONS, agree: { strict: true, definitions: WIDENING_DEFINITIONS } },
  { name: "trees", machine: STD_MACHINE, options: TREE_OPTIONS, agree: { strict: true } },
  {
    name: "standard, depth 3 and a rule of the host",
    machine: { ...STD_MACHINE, maxDepth: 3, permits: (caps, kind) => kind[0] !== "write" && caps.length > 0 },
    options: { ...STD_OPTIONS, maxDepth: 5 },
    agree: { strict: true },
  },
  ...Object.entries(PROFILES).map(([name, profile]) => formulaConfig(`formula, ${name}`, profile)),
  formulaConfig("formula, plain values", STRICT, { plain: true }),
  formulaConfig("formula, closed roots", STRICT, { roots: ["names", "world"] }),
  formulaConfig("formula, adopted things", STRICT, { adopt }),
  {
    name: "two languages in one machine",
    machine: composed,
    options: { ...formulaOptions(composed), types: [...typesOf(composed.world), ...OP_TYPES, ...EXT_TYPES, ["ops", "twice"]] },
    agree: { strict: true, definitions: formulaDefinitions(STRICT), declaredType: "lit", observe: () => calls.splice(0), equal: boxes },
  },
  {
    name: "language",
    machine: language,
    options: { ...formulaOptions(language), types: LANGUAGE_TYPES },
    agree: { strict: true, definitions: formulaDefinitions(LOOSE), declaredType: "lit", observe: () => calls.splice(0) },
  },
  {
    name: "language, a default of step",
    machine: defaulted,
    options: { ...formulaOptions(defaulted), types: LANGUAGE_TYPES },
    agree: { strict: true, definitions: formulaDefinitions(LOOSE), declaredType: "lit", observe: () => calls.splice(0) },
  },
];

interface Finding {
  readonly seed: number;
  readonly reason: string;
  readonly doc: unknown;
  readonly plan: Result;
  readonly other?: Result;
  readonly tier: string;
}

interface Outcome {
  readonly findings: readonly Finding[];
  /** The documents that `check` passed, and that gave an error that `check` finds (STATIC.AGREES). */
  readonly unchecked: readonly Finding[];
  readonly kinds: ReadonlyMap<string, number>;
  readonly codes: ReadonlyMap<string, number>;
}

/** The codes that `check` finds before a run. A document that `check` passes does not give them (STATIC.AGREES). */
const STATIC_CODES = new Set(["#KIND?", "#PART?", "#NOEVAL", "#CAP!", "#DEPTH!"]);

/**
 * This function tells if `check` must give the error of a run at the same place (STATIC.AGREES). An unknown
 * operation or extension (STATIC.KNOWN) and a value without its shape (FORMULA.FN-PARAMS) also have the same reason.
 * A name that nothing binds has the same code and place, when the reference at the place names it itself.
 */
function sameInCheck(machine: Machine, doc: unknown, error: EvalError, declared: { readonly declaredType?: string }): "reason" | "place" | undefined {
  if (error.code === "#NAME?" && /^The language has no (operation|extension) /.test(error.reason)) return "reason";
  if (error.code === "#VALUE!" && / The kind is .+\.$/.test(error.reason)) return "reason";
  const name = /^The context has no name (.+)\.$/.exec(error.reason)?.[1];
  // A host that adopts the names answers their steps itself (DEREF.ADOPT). Its things tell a name bound to undefined
  // from a missing name with has (DEREF.HOST-UNDEFINED), thus check and a run agree.
  if (error.code !== "#NAME?" || name === undefined) return undefined;
  // A reference that a path reaches and follows can name an unbound name too (DEREF.COLLAPSE). check cannot know it.
  let named = false;
  walk(machine.world, doc, (visit) => {
    if (!docEquals(visit.place, error.place ?? [])) return undefined;
    const path = visit.doc.value;
    named ||= isRef(visit.doc) && Array.isArray(path) && path[0] === "names" && String(path[1]) === name;
    return "skip";
  }, declared);
  return named ? "place" : undefined;
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item: unknown) => (typeof item === "function" ? "<fn>" : item === undefined ? "<undefined>" : item));
  } catch {
    return String(value);
  }
}

function count(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function harness(config: Config, total: number): Outcome {
  const findings: Finding[] = [];
  const unchecked: Finding[] = [];
  const kinds = new Map<string, number>();
  const codes = new Map<string, number>();
  const declared = config.options.declaredType === undefined ? {} : { declaredType: config.options.declaredType };
  for (let index = 0; index < total; index += 1) {
    const seed = SEED * 1_000_003 + index;
    const doc = generate(config.machine.world, { ...config.options, seed });
    walk(config.machine.world, doc, (visit) => count(kinds, typeName(visit.doc.type)), declared);
    const ctx = CONTEXTS[index % CONTEXTS.length] as Context;
    const outcome = agree(config.machine, doc, ctx, config.agree);
    if (!outcome.ok) {
      findings.push({ seed, reason: outcome.reason, doc, plan: outcome.plan, other: outcome.other, tier: outcome.tier });
      continue;
    }
    const result = outcome.result;
    count(codes, result.ok ? "value" : result.error.code);
    // check asks the rule of the host for effects too (CAP.PERMITS), thus a machine with the hook permits takes this test.
    if (result.ok) continue;
    const error = result.error;
    const same = sameInCheck(config.machine, doc, error, declared);
    // An overflow of the stack of the host gives #DEPTH! too, but check finds only a nesting deeper than the limit.
    const staticCode = STATIC_CODES.has(error.code) && !(error.code === "#DEPTH!" && isStackOverflow(error.cause));
    if (!staticCode && same === undefined) continue;
    const issues = check(config.machine, doc, { ...declared, names: Object.keys(ctx.names), caps: ctx.caps });
    if (staticCode && issues.length === 0) {
      unchecked.push({ seed, reason: `check passed the document, and the plan gives ${error.code}.`, doc, plan: result, tier: "check" });
    }
    const place = error.place ?? [];
    if (same !== undefined && !issues.some((issue) => issue.code === error.code && docEquals(issue.place, place) && (same === "place" || issue.reason === error.reason))) {
      unchecked.push({ seed, reason: `the plan gives ${error.code} at [${place.join(", ")}] ("${error.reason}"), and check does not give it there.`, doc, plan: result, tier: "check" });
    }
  }
  return { findings, unchecked, kinds, codes };
}

const outcomes = new Map<string, Outcome>();

function outcomeOf(config: Config): Outcome {
  let outcome = outcomes.get(config.name);
  if (outcome === undefined) {
    outcome = harness(config, COUNT);
    outcomes.set(config.name, outcome);
  }
  return outcome;
}

function report(findings: readonly Finding[]): readonly string[] {
  return findings.slice(0, 3).map((item) => `${item.tier}, seed ${item.seed}: ${item.reason}\n  doc ${show(item.doc)}\n  plan ${show(item.plan)}\n  other ${show(item.other)}`);
}

describe("one meaning", () => {
  for (const config of CONFIGS) {
    it("[PLAN.AGREES] the plan, the traced plan, a second evaluation and the reference agree on generated documents: " + config.name, () => {
      const outcome = outcomeOf(config);
      expect(report(outcome.findings), `results ${show(Object.fromEntries(outcome.codes))}`).toEqual([]);
    }, 300_000);
  }

  it("[MACHINE.AGREES] a merged machine of two languages evaluates through the plan, the reference and agree, on generated documents", () => {
    const config = CONFIGS.find((item) => item.machine === composed) as Config;
    const outcome = outcomeOf(config);
    expect(report(outcome.findings)).toEqual([]);
    expect(report(outcome.unchecked)).toEqual([]);
    // The documents reach the kinds of both languages: the kit, the namespace that the second language extends, and its alias.
    for (const kind of ["let", "ops.add", "ops.twice", "double", "shout"]) expect(outcome.kinds.get(kind) ?? 0, kind).toBeGreaterThan(0);
  });

  it("[CAP.NARROW-CODE] compiled code that widens the contexts of its parts agrees with the reference on generated documents, and causes no effect that the root does not permit", () => {
    const config = CONFIGS.find((item) => item.machine === widening) as Config;
    const outcome = outcomeOf(config);
    expect(report(outcome.findings)).toEqual([]);
    for (const kind of [...WIDENING_KINDS, "shout"]) expect(outcome.kinds.get(kind) ?? 0, kind).toBeGreaterThan(0);
    const leaks: string[] = [];
    let refused = 0;
    for (let index = 0; index < COUNT; index += 1) {
      const seed = SEED * 1_000_003 + index;
      const doc = generate(widening.world, { ...WIDENING_OPTIONS, seed });
      const wide: (readonly Key[])[] = [];
      walk(widening.world, doc, (visit) => {
        if (WIDENING_KINDS.has(typeName(visit.doc.type))) wide.push(visit.place);
        return undefined;
      });
      const plan = prepare(widening, doc);
      for (const ctx of CONTEXTS) {
        const effects: Effect[] = [];
        const result = plan.evaluate(ctx, { effects });
        for (const effect of effects) if (!permits(ctx.caps, effect.path)) leaks.push(`seed ${seed}: ${effect.kind} at [${effect.place.join(", ")}] under ${show(ctx.caps)}`);
        // A refused effect under a kind that widens: without the grant, the plan caused it.
        const place = result.ok ? undefined : result.error.code === "#CAP!" ? result.error.place : undefined;
        if (place !== undefined && wide.some((at) => place.length > at.length && at.every((key, step) => key === place[step]))) refused += 1;
      }
    }
    expect(leaks.slice(0, 3)).toEqual([]);
    expect(refused, `${refused} refused effects under a kind that widens`).toBeGreaterThan(COUNT / 20);
  });

  it("[STATIC.AGREES] a generated document that check passes gives none of the errors that check finds", () => {
    for (const config of CONFIGS) expect(report(outcomeOf(config).unchecked), config.name).toEqual([]);
  });

  it("[GEN.REACH] the generated documents reach each kind, and give values and errors", () => {
    for (const config of CONFIGS) {
      const outcome = outcomeOf(config);
      const types = (config.options.types ?? typesOf(config.machine.world)).map((type) => type.join("."));
      expect(types.filter((type) => !outcome.kinds.has(type)), `${config.name}: kinds that no document reached`).toEqual([]);
      const errors = [...outcome.codes.keys()].filter((code) => code.startsWith("#"));
      expect(outcome.codes.get("value") ?? 0, config.name).toBeGreaterThan(COUNT / 10);
      expect(errors.length, `${config.name}: ${show(Object.fromEntries(outcome.codes))}`).toBeGreaterThanOrEqual(4);
    }
    // The trees read attributes, and some reads form a cycle (TREE.CYCLE).
    const trees = outcomeOf(CONFIGS.find((config) => config.name === "trees") as Config);
    expect(trees.codes.get("#CYCLE!") ?? 0, show(Object.fromEntries(trees.codes))).toBeGreaterThan(0);
  });
});

describe("the disagreements that the harness found", () => {
  it("[PLAN.FAIL-LATE] a compiler that throws fails only its own document, when it evaluates, with its place", () => {
    const profile = PROFILES["table"] as FormulaProfile;
    const machine = formulaMachine(profile);
    const options: AgreeOptions = { definitions: formulaDefinitions(profile), declaredType: "lit", strict: true };
    const trap = { type: ["ops", "trap"], value: [] };
    const unused = { type: "if", value: { test: 1, then: "yes", else: trap } };
    expect(agree(machine, unused, context(), options)).toMatchObject({ ok: true, result: ok("yes") });
    const used = { type: "list", value: [1, trap] };
    expect(agree(machine, used, context(), options)).toMatchObject({
      ok: true,
      result: { ok: false, error: { code: "#CALC!", place: [1], reason: "The evaluator formula.op threw: Error: The table has no trap." } },
    });
  });

  it("[CAP.NARROW-CODE] the probe of R7: compiled code that gives its part log and write under a root without capabilities causes no effect, as in the reference", async () => {
    const options: AgreeOptions = { strict: true, definitions: WIDENING_DEFINITIONS };
    const log = (text: string): Json => ({ type: "log", value: [text] });
    const write: Json = { type: "write", value: { key: "k", value: { type: "number", value: 1 } } };
    // Before K91, the plan caused the effect log and gave ["hi"], and the reference gave #CAP!.
    const probe = { type: "widen", value: [log("hi")] };
    const effects: Effect[] = [];
    expect(prepare(widening, probe).evaluate(context(), { effects })).toMatchObject({ ok: false, error: { code: "#CAP!", place: [0] } });
    expect(effects).toEqual([]);
    expect(reference(widening, probe, context(), { definitions: WIDENING_DEFINITIONS })).toMatchObject({ ok: false, error: { code: "#CAP!", place: [0] } });
    expect(agree(widening, probe, context(), options)).toMatchObject({ ok: true });
    expect(nodeAt(evaluate(widening, probe).trace, [0])?.caps).toEqual([]);
    // A compiled runner, a rule only under compiled code and the own effect of compiled code keep the grant too.
    const cases: readonly (readonly [Json, Context, string | undefined])[] = [
      [{ type: "widenRun", value: [log("a")] }, context(), "#CAP!"],
      [{ type: "widenLog", value: [log("a")] }, context(), "#CAP!"],
      [{ type: "widenLog", value: [write] }, context({ caps: ["log", "write"] }), "#CAP!"],
      [{ type: "shout", value: ["a"] }, context(), "#CAP!"],
      [{ type: "widen", value: [write, log("a")] }, context({ caps: [["log"]] }), "#CAP!"],
      [{ type: "widen", value: [log("a")] }, context({ caps: [["log"]] }), undefined],
    ];
    for (const [doc, ctx, code] of cases) {
      const outcome = agree(widening, doc, ctx, options);
      expect(outcome, show(doc)).toMatchObject({ ok: true });
      if (!outcome.ok) continue;
      expect(outcome.result.ok ? undefined : outcome.result.error.code, show(doc)).toBe(code);
      for (const effect of outcome.effects) expect(permits(ctx.caps, effect.path), show(doc)).toBe(true);
    }
    // The root caps of a part gives the capabilities of the document, not the wider list.
    expect(agree(widening, { type: "widen", value: [{ type: "ref", value: ["caps"] }] }, context({ caps: ["log"] }), options)).toMatchObject({ ok: true, result: ok([["log"]]) });
    // A run keeps the grant: the host sees no effect.
    const performed: Effect[] = [];
    const perform = (effect: Effect): null => {
      performed.push(effect);
      return null;
    };
    const done = await run(widening, { type: "widenRun", value: [log("a")] }, context(), { perform });
    expect(done.result).toMatchObject({ ok: false, error: { code: "#CAP!", place: [0] } });
    expect(performed).toEqual([]);
    // A context that compiled code makes without a spread has no grant, thus its part gets no capabilities.
    const fresh: CompiledEvaluator = { compile: ({ parts }) => (ctx, rt) => valuesOf(parts.map((part) => part.code(context({ names: ctx.names, world: ctx.world, caps: ctx.caps }), rt))) };
    const machine: Machine = {
      ...widening,
      world: { ...widening.world, kinds: { ...widening.world.kinds, fresh: { verbs: { eval: "test.fresh" }, parts: { shape: "list" } } } },
      evaluators: { ...widening.evaluators, "test.fresh": fresh },
    };
    expect(prepare(machine, { type: "fresh", value: [log("a")] }).evaluate(context({ caps: ["log"] }))).toMatchObject({ ok: false, error: { code: "#CAP!", place: [0] } });
  });

  it("[CAP.CAPS-GRANT] compiled code that widens its context reads the root caps through the grant, as the reference reads them", () => {
    // Each kind reads the root caps in a context that its compiled code makes. The definitions read the context of the document.
    const read = (make: (ctx: Context) => Context): CompiledEvaluator => ({
      compile: () => (ctx, rt) => {
        const found = rt.resolve(make(ctx), ["caps"]);
        return found.ok ? ok(found.thing) : fail(found.code, found.reason);
      },
    });
    const kinds = { peek: { verbs: { eval: "test.peek" } }, narrowPeek: { verbs: { eval: "test.narrow-peek" } }, freshPeek: { verbs: { eval: "test.fresh-peek" } } };
    const machine: Machine = {
      ...widening,
      world: { ...widening.world, kinds: { ...widening.world.kinds, ...kinds } },
      evaluators: {
        ...widening.evaluators,
        "test.peek": read(widened),
        "test.narrow-peek": read((ctx) => ({ ...ctx, caps: [] })),
        "test.fresh-peek": read((ctx) => context({ names: ctx.names, world: ctx.world, caps: WIDE })),
      },
    };
    const definitions: Definitions = {
      ...WIDENING_DEFINITIONS,
      evaluators: {
        ...WIDENING_DEFINITIONS.evaluators,
        "test.peek": ({ resolve }) => {
          const found = resolve(["caps"]);
          return found.ok ? ok(found.thing) : fail(found.code, found.reason);
        },
      },
    };
    const peek: Json = { type: "peek", value: null };
    // Before K100, the plan gave the wider list ["log", "write", "more"] for each of these contexts.
    for (const caps of [[], ["log"], [["log"]], ["write", "log"], ["log.a"]] as const) {
      const ctx = context({ caps });
      const outcome = agree(machine, peek, ctx, { strict: true, definitions });
      expect(outcome, show(caps)).toMatchObject({ ok: true, result: ok(caps) });
      expect(prepare(machine, peek).evaluate(ctx), show(caps)).toEqual(ok(caps));
      expect(evaluate(machine, peek, ctx).result, show(caps)).toEqual(ok(caps));
      expect(reference(machine, peek, ctx, { definitions }), show(caps)).toEqual(ok(caps));
    }
    // A context that the code narrows keeps its own list, and a context without a spread has no grant, thus no capabilities.
    const all = context({ caps: ["log", "write"] });
    expect(prepare(machine, { type: "narrowPeek", value: null }).evaluate(all)).toEqual(ok([]));
    expect(prepare(machine, peek).evaluate(context({ caps: ["log", "write", "more", "net"] }))).toEqual(ok(WIDE));
    expect(prepare(machine, { type: "freshPeek", value: null }).evaluate(all)).toEqual(ok([]));
    // A part of a kind that widens gets the meet with its document (CAP.MEET), here the list of the document.
    // Before K152, the part got the items of the wider list that its document permits, and the read gave ["log"].
    expect(agree(machine, { type: "widen", value: [peek] }, context({ caps: [["log"]] }), { strict: true, definitions })).toMatchObject({ ok: true, result: ok([[["log"]]]) });
  });

  it("[CAP.MEET] code that widens a context to a coarser capability keeps the meet with its document for each part, effect and walker, as the reference does", () => {
    // Each kind gives the coarser list ["log"]. Under the document ["log.a"], the meet is ["log.a"].
    const coarse = (ctx: Context): Context => ({ ...ctx, caps: ["log"] });
    const STEP: Json = { type: "capsStep", value: null };
    const path: readonly unknown[] = ["names", STEP];
    const found = (resolution: ReturnType<Runtime["resolve"]>): Result => (resolution.ok ? ok(resolution.thing) : fail(resolution.code, resolution.reason));
    const machine: Machine = {
      ...widening,
      world: {
        ...widening.world,
        kinds: {
          ...widening.world.kinds,
          logA: { verbs: { eval: "test.log-a" }, effects: ["log.a"] },
          coarse: { verbs: { eval: "test.coarse" }, parts: { shape: "list" } },
          coarseFn: { verbs: { eval: "test.coarse-fn" }, parts: { shape: "list" } },
          shoutA: { verbs: { eval: "test.shout-a" }, effects: ["log.a"] },
          walkCoarse: { verbs: { eval: "test.walk-coarse" } },
          capsStep: { verbs: { step: "test.caps-step" } },
        },
      },
      evaluators: {
        ...widening.evaluators,
        "test.log-a": ({ effect }) => effect("log.a", "a"),
        "test.coarse": { compile: ({ parts }) => (ctx, rt) => valuesOf(parts.map((part) => part.code(coarse(ctx), rt))) },
        "test.coarse-fn": ({ parts, context: ctx }) => valuesOf(parts.map((part) => part.evaluate(coarse(ctx)))),
        "test.shout-a": { compile: () => (ctx, rt) => rt.effect(coarse(ctx), "log.a", "a", []) },
        "test.walk-coarse": { compile: () => (ctx, rt) => found(rt.resolve(coarse(ctx), path)) },
      },
      walkers: { ...widening.walkers, "test.caps-step": ({ context: ctx }) => ({ ok: true, thing: ctx.caps }) },
    };
    const definitions: Definitions = {
      ...WIDENING_DEFINITIONS,
      evaluators: {
        ...WIDENING_DEFINITIONS.evaluators,
        "test.coarse": ({ parts, context: ctx }) => valuesOf(parts.map((part) => part.evaluate(coarse(ctx)))),
        "test.shout-a": ({ effect }) => effect("log.a", "a"),
        "test.walk-coarse": ({ resolve }) => found(resolve(path)),
      },
    };
    const logA: Json = { type: "logA", value: null };
    const cases: readonly (readonly [Json, readonly string[], Result])[] = [
      // Before K152, the part, the own effect and the part of function code gave #CAP!, and the walker read ["log"].
      [{ type: "coarse", value: [logA] }, ["log.a"], ok(["a"])],
      [{ type: "coarseFn", value: [logA] }, ["log.a"], ok(["a"])],
      [{ type: "shoutA", value: null }, ["log.a"], ok("a")],
      [{ type: "walkCoarse", value: null }, ["log.a"], ok(["log.a"])],
      // The meet keeps the results of a document that permits the coarser list, and of a document without capabilities.
      [{ type: "coarse", value: [logA] }, ["log"], ok(["a"])],
      [{ type: "walkCoarse", value: null }, ["log"], ok(["log"])],
      [{ type: "coarse", value: [logA] }, [], fail("#CAP!", "The context has no capability for the effect log.a.", { place: [0] })],
      [{ type: "shoutA", value: null }, ["log.b"], fail("#CAP!", "The context has no capability for the effect log.a.", { place: [] })],
      [{ type: "walkCoarse", value: null }, [], ok([])],
    ];
    for (const [doc, caps, want] of cases) {
      const ctx = context({ caps });
      const outcome = agree(machine, doc, ctx, { strict: true, definitions });
      expect(outcome, `${show(doc)} under ${show(caps)}`).toMatchObject({ ok: true, result: want });
      expect(prepare(machine, doc).evaluate(ctx), `${show(doc)} under ${show(caps)}`).toMatchObject(want);
      if (!outcome.ok) continue;
      for (const effect of outcome.effects) expect(permits(caps, effect.path), show(doc)).toBe(true);
    }
    // A walker under code that narrows keeps the narrowed list, and code cannot widen a part beyond the meet.
    const narrowed: Machine = { ...machine, evaluators: { ...machine.evaluators, "test.walk-coarse": { compile: () => (ctx, rt) => found(rt.resolve({ ...ctx, caps: [] }, path)) } } };
    expect(prepare(narrowed, { type: "walkCoarse", value: null }).evaluate(context({ caps: ["log"] }))).toEqual(ok([]));
    expect(prepare(machine, { type: "coarse", value: [{ type: "write", value: { key: "k", value: { type: "number", value: 1 } } }] }).evaluate(context({ caps: ["log.a", "write"] }))).toMatchObject({ ok: false, error: { code: "#CAP!", place: [0] } });
  });

  it("[RUN.WAIT] a runner that waits under a parent that cannot wait gives #CALC! with its own place", () => {
    const doc = { type: "add", value: [1, { type: "wait", value: null }] };
    expect(agree(waiting, doc, context(), { strict: true })).toMatchObject({ ok: true, result: { ok: false, error: { code: "#CALC!", place: [1] } } });
    expect(agree(waiting, { type: "wait", value: null }, context(), { strict: true })).toMatchObject({ ok: true, result: { ok: false, error: { code: "#CALC!", place: [] } } });
  });

  it("[VALUE.DEPTH] an endless recursion gives #DEPTH!, also when the test of the overflow overflows the stack itself", () => {
    const profile: FormulaProfile = { ops: { loop: (fn: (self: unknown) => unknown) => fn(fn) } };
    const machine = formulaMachine(profile);
    const body = { type: ["ops", "loop"], value: [{ type: "ref", value: ["names", "g"] }] };
    const doc = { type: ["ops", "loop"], value: [{ type: "fn", value: { params: ["g"], body } }] };
    for (let pad = 0; pad < 8; pad += 1) {
      const deeper = (n: number): Result => (n > 0 ? deeper(n - 1) : prepare(machine, doc).evaluate());
      expect(deeper(pad * 9)).toMatchObject({ ok: false, error: { code: "#DEPTH!" } });
    }
    expect(agree(machine, doc, context(), { definitions: formulaDefinitions(profile), declaredType: "lit" })).toMatchObject({ ok: true });
    let list: unknown = { type: "number", value: 1 };
    for (let index = 0; index < 1000; index += 1) list = { type: "list", value: [list] };
    expect(agree(STD_MACHINE, list, context(), { strict: true })).toMatchObject({ ok: true });
  });

  it("[FORMULA.STEPS] the step documents of a path evaluate before the path reads a name whose binding failed", () => {
    const doc = {
      type: "let",
      value: {
        bind: { bad: { type: "ref", value: ["names", "nope"] } },
        body: { type: "ref", value: ["names", "bad", { type: ["moves", "at"], value: { type: "ref", value: ["names", "missing"] } }] },
      },
    };
    const outcome = agree(language, doc, context(), { definitions: formulaDefinitions(LOOSE), declaredType: "lit", strict: true });
    expect(outcome).toMatchObject({ ok: true, result: { ok: false, error: { code: "#NAME?", place: ["body", 2], reason: "The context has no name missing." } } });
  });
});

describe("the reference interpreter", () => {
  it("[REF.DIRECT] the reference compiles nothing: a compiled evaluator needs a definition, or the reference gives #NOEVAL", () => {
    let compiles = 0;
    const counted: CompiledEvaluator = {
      compile: () => {
        compiles += 1;
        return () => ok(1);
      },
    };
    const machine: Machine = { world: { kinds: { one: { verbs: { eval: "one" } } }, defaults: {} }, evaluators: { one: counted } };
    const doc = { type: "one", value: null };
    expect(reference(machine, doc, context(), { definitions: { evaluators: { one: () => ok(1) } } })).toEqual(ok(1));
    expect(reference(machine, doc)).toMatchObject({ ok: false, error: { code: "#NOEVAL", place: [], reason: "The reference has no definition of the compiled evaluator one." } });
    expect(compiles).toBe(0);
  });

  it("[REF.FORMULA] formulaDefinitions gives a definition for each evaluator of the formula kit", () => {
    expect(Object.keys(formulaDefinitions().evaluators ?? {}).sort()).toEqual(Object.keys(formulaEvaluators()).sort());
  });

  it("[REF.TREE] the reference reads the decorated tree with its own definition, also without the option definitions", () => {
    const definition = STD_DEFINITIONS.evaluators?.["tree.node"];
    expect(typeof definition).toBe("function");
    expect(definition).not.toBe(STD_MACHINE.evaluators["tree.node"]);
    // The kind probe tells how many symbol keys the node of its self has. The two readings make different nodes.
    const probe: Machine = {
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, probe: { verbs: { eval: "test.probe" } } } },
      evaluators: { ...STD_MACHINE.evaluators, "test.probe": ({ context: ctx }) => ok(Object.getOwnPropertySymbols(ctx.self).length) },
    };
    const doc = { type: "panel", value: { width: { type: "probe", value: null } } };
    expect(prepare(probe, doc).evaluate()).toEqual(ok({ width: 2 }));
    expect(reference(probe, doc)).toEqual(ok({ width: 1 }));
    // A machine with another evaluator under the name tree.node gets that evaluator in the reference too.
    let calls = 0;
    const other: Machine = {
      ...STD_MACHINE,
      evaluators: {
        ...STD_MACHINE.evaluators,
        "tree.node": () => {
          calls += 1;
          return ok("mine");
        },
      },
    };
    expect(reference(other, doc)).toEqual(ok("mine"));
    expect(calls).toBe(1);
  });

  it("[REF.EFFECTS] the reference records each effect with its kind, payload and place, and narrows the capabilities by the contracts", () => {
    const effects: Effect[] = [];
    const doc = { type: "seq", value: [{ type: "log", value: ["a"] }, { type: "pure", value: [{ type: "log", value: ["b"] }] }] };
    expect(reference(STD_MACHINE, doc, context({ caps: ["log"] }), { effects })).toMatchObject({ ok: false, error: { code: "#CAP!", place: [1, 0] } });
    expect(effects.map((effect) => [effect.kind, effect.payload, effect.place])).toEqual([["log", "a", [0]]]);
  });
});

describe("agree", () => {
  it("[AGREE.VALUES] values compare by structure, each leaf with Object.is, closures by parameters, and other objects by the rule of the caller", () => {
    expect(sameValue({ a: [1, { b: Number.NaN }] }, { a: [1, { b: Number.NaN }] })).toBe(true);
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameValue(0, -0)).toBe(false);
    expect(sameValue([1], [1, 2])).toBe(false);
    expect(sameValue(new Box(1), new Box(1))).toBe(false);
    expect(sameValue(new Box(1), new Box(1), boxes)).toBe(true);
    const machine = formulaMachine();
    const fn = (params: readonly string[]): unknown => ({ type: "fn", value: { params, body: 1 } });
    const closure = (params: readonly string[]): unknown => {
      const result = reference(machine, fn(params), context(), { definitions: formulaDefinitions(), declaredType: "lit" });
      return result.ok ? result.value : undefined;
    };
    const planned = prepare(machine, fn(["a"])).evaluate();
    expect(sameValue(planned.ok ? planned.value : undefined, closure(["a"]))).toBe(true);
    expect(sameValue(planned.ok ? planned.value : undefined, closure(["b"]))).toBe(false);
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    const other: Record<string, unknown> = {};
    other["self"] = other;
    expect(sameValue(cycle, other)).toBe(true);
  });

  it("[AGREE.ERRORS] errors compare by code, and by place when both have one; strict also compares the reason and needs a place", () => {
    const tier = (result: Result) => (): Result => result;
    const doc = { type: "ref", value: ["names", "nope"] };
    const machine = formulaMachine();
    const base: AgreeOptions = { tiers: [], declaredType: "lit" };
    expect(agree(machine, doc, context(), { ...base, other: tier(fail("#NAME?", "Another reason.")) })).toMatchObject({ ok: true });
    expect(agree(machine, doc, context(), { ...base, strict: true, other: tier(fail("#NAME?", "Another reason.", { place: [] })) })).toMatchObject({ ok: false, tier: "other" });
    expect(agree(machine, doc, context(), { ...base, strict: true, other: tier(fail("#NAME?", "The context has no name nope.")) })).toMatchObject({ ok: false, reason: "An error #NAME? has no place." });
    expect(agree(machine, doc, context(), { ...base, other: tier(fail("#NAME?", "x", { place: [0] })) })).toMatchObject({ ok: false, tier: "other" });
    expect(agree(machine, doc, context(), { ...base, other: tier(fail("#N/A", "x")) })).toMatchObject({ ok: false, tier: "other" });
    const overflow = new RangeError("Maximum call stack size exceeded");
    expect(agree(machine, doc, context(), { ...base, other: tier(fail("#DEPTH!", "The stack overflowed.", { cause: overflow })) })).toMatchObject({ ok: true });
  });

  it("[AGREE.EFFECTS] the effects must have the same kinds, places and payloads in the same order, and the host must see the same calls", () => {
    const doc = { type: "seq", value: [{ type: "log", value: ["a"] }, { type: "write", value: { key: "k", value: { type: "text", value: "b" } } }] };
    const ctx = context({ caps: ["log", "write"] });
    const outcome = agree(STD_MACHINE, doc, ctx, { strict: true });
    expect(outcome.ok && outcome.effects.map((effect) => effect.kind)).toEqual(["log", "write"]);
    const reversed = (): TierResult => ({ result: outcome.ok ? outcome.result : ok(null), effects: outcome.ok ? [...outcome.effects].reverse() : [] });
    expect(agree(STD_MACHINE, doc, ctx, { tiers: [], other: reversed })).toMatchObject({ ok: false, tier: "other", reason: "The effect 0 differs: log at [0] in the plan, and write at [1] in the tier." });
    let seen = 0;
    expect(agree(STD_MACHINE, doc, ctx, { tiers: ["again"], observe: () => (seen += 1) })).toMatchObject({ ok: false, tier: "again", reason: "The host saw other calls in the tier." });
  });

  it("[AGREE.MOCK] each tier gets the mock of agree, thus the tiers agree on documents with effects, with the same addresses and outcomes", () => {
    const config = CONFIGS.find((item) => item.agree.perform !== undefined) as Config;
    expect(report(outcomeOf(config).findings)).toEqual([]);
    const doc = { type: "seq", value: [{ type: "log", value: ["a"] }, { type: "write", value: { key: "k", value: { type: "ref", value: ["names", "last"] } } }] };
    const ctx = context({ caps: ["log", "write"] });
    const outcome = agree(STD_MACHINE, doc, ctx, { strict: true, perform: hostMock });
    expect(outcome).toMatchObject({ ok: true, result: ok({ stored: "1#0" }) });
    const effects = outcome.ok ? outcome.effects : [];
    expect(effects.map((effect) => [effect.address, effect.outcome])).toEqual([
      ["0#0", ok(["0#0", "a"])],
      ["1#0", ok({ stored: "1#0" })],
    ]);
    // The second tier of a language gets the mock too.
    let given: unknown;
    const tier = (_doc: unknown, _ctx: Context, input: TierInput): TierResult => {
      given = input.perform;
      return { result: ok({ stored: "1#0" }), effects };
    };
    expect(agree(STD_MACHINE, doc, ctx, { tiers: [], perform: hostMock, other: tier })).toMatchObject({ ok: true });
    expect(given).toBe(hostMock);
    // A tier with another outcome or another address disagrees.
    const other = (changed: Partial<Effect>) => (): TierResult => ({ result: ok({ stored: "1#0" }), effects: effects.map((effect, index) => (index === 0 ? { ...effect, ...changed } : effect)) });
    expect(agree(STD_MACHINE, doc, ctx, { tiers: [], perform: hostMock, other: other({ outcome: ok("other") }) })).toMatchObject({
      ok: false,
      reason: "The outcome of the effect 0 differs. The plan and the tier give different values.",
    });
    expect(agree(STD_MACHINE, doc, ctx, { tiers: [], perform: hostMock, other: other({ address: "9#0" }) })).toMatchObject({
      ok: false,
      reason: "The effect 0 has the address 0#0 in the plan, and 9#0 in the tier.",
    });
    // A Failure of the mock gives the same error in each tier.
    expect(agree(STD_MACHINE, { type: "log", value: ["b"] }, ctx, { strict: true, perform: hostMock })).toMatchObject({
      ok: true,
      result: { ok: false, error: { code: "#MOCK", place: [] } },
    });
  });

  it("[AGREE.TIER] a language compares its own second tier with the plan, and agree names the tier that disagrees", () => {
    const machine = formulaMachine(STRICT);
    const doc = { type: ["ops", "add"], value: [{ type: "ref", value: ["names", "a"] }, 2] };
    const ctx = context({ names: { a: 1 } });
    const loops = (_doc: unknown, given: Context): Result => ok((given.names["a"] as number) + 2);
    expect(agree(machine, doc, ctx, { other: loops, definitions: formulaDefinitions(STRICT) })).toMatchObject({ ok: true, result: ok(3) });
    expect(agree(machine, doc, ctx, { tiers: [], other: () => ok(4) })).toMatchObject({ ok: false, tier: "other", plan: ok(3), other: ok(4) });
    const broken = (): Result => {
      throw new Error("no loop");
    };
    expect(agree(machine, doc, ctx, { tiers: [], other: broken })).toMatchObject({ ok: false, tier: "other", other: { ok: false, error: { code: "#CALC!" } } });
    expect(agree(machine, doc, ctx, { definitions: formulaDefinitions({}) })).toMatchObject({ ok: false, tier: "reference" });
  });

  it("[AGREE.MUTANT] the harness finds a tier that changes the order of the parts, or that evaluates a branch that the reference does not", () => {
    const real = formulaEvaluators(STRICT);
    const mutants: Readonly<Record<string, CompiledEvaluator>> = {
      "formula.op": { compile: (input) => (real["formula.op"] as CompiledEvaluator).compile({ ...input, parts: [...input.parts].reverse() }) },
      "formula.if": {
        compile: (input) => {
          const code = (real["formula.if"] as CompiledEvaluator).compile(input);
          return (ctx, rt) => {
            for (const part of input.parts) part.code(ctx, rt);
            return code(ctx, rt);
          };
        },
      },
    };
    for (const [name, mutant] of Object.entries(mutants)) {
      const machine = formulaMachine(STRICT, { evaluators: { [name]: mutant }, replaces: [["evaluators", name]] });
      const options = formulaOptions(machine);
      let found = false;
      // A document that shows the mutant of if is rare: a branch that the test does not select must call the host.
      for (let seed = 0; seed < 10000 && !found; seed += 1) {
        const doc = generate(machine.world, { ...options, seed });
        found = !agree(machine, doc, CONTEXTS[0], { definitions: formulaDefinitions(STRICT), declaredType: "lit", observe: () => calls.splice(0), equal: boxes }).ok;
      }
      expect(found, name).toBe(true);
    }
  });
});

describe("the generator", () => {
  it("[GEN.SEED] a seed gives the same document, and another seed gives another document", () => {
    const machine = formulaMachine(STRICT);
    const options = formulaOptions(machine);
    const docs = Array.from({ length: 50 }, (_, seed) => generate(machine.world, { ...options, seed }));
    expect(docs.every((doc, seed) => docEquals(doc, generate(machine.world, { ...options, seed })))).toBe(true);
    expect(new Set(docs.map((doc) => JSON.stringify(doc))).size).toBeGreaterThan(40);
    const a = random(7);
    const b = random(7);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
  });

  it("[GEN.PATHS] the options roots and steps limit the roots and the length of the paths", () => {
    const lengths = new Set<number>();
    for (let seed = 0; seed < 200; seed += 1) {
      const doc = generate(STD_MACHINE.world, { ...TREE_OPTIONS, seed, malformed: 0 });
      walk(STD_MACHINE.world, doc, (visit) => {
        const path = visit.doc.value;
        if (!isRef(visit.doc) || !Array.isArray(path)) return undefined;
        expect(path[0]).toBe("self");
        lengths.add(path.length - 1);
        return undefined;
      });
    }
    expect(Math.max(...lengths)).toBe(4);
    const short = generate(STD_MACHINE.world, { ...STD_OPTIONS, seed: 1 });
    expect(docEquals(short, generate(STD_MACHINE.world, { ...STD_OPTIONS, seed: 1, roots: ["self", "names", "world", "event", "caps"], steps: 2 }))).toBe(true);
  });

  it("[GEN.STEPS] with a default of step, a path gets step documents of kinds without the verb step, and a seed gives the same document", () => {
    /** This function gives the kinds of the step documents of generated paths, and if each kind has the verb step. */
    const stepKinds = (machine: Machine): Map<string, boolean> => {
      const options = { ...formulaOptions(machine), types: LANGUAGE_TYPES, malformed: 0 };
      const kinds = new Map<string, boolean>();
      for (let seed = 0; seed < 1000; seed += 1) {
        const doc = generate(machine.world, { ...options, seed });
        expect(docEquals(doc, generate(machine.world, { ...options, seed }))).toBe(true);
        walk(machine.world, doc, (visit) => {
          const path = visit.doc.value;
          if (!isRef(visit.doc) || !Array.isArray(path)) return undefined;
          for (const step of path.slice(1)) {
            const found = isEnvelope(step) ? lookupKind(machine.world, step.type) : undefined;
            if (found?.ok === true) kinds.set(found.path.join("."), Object.hasOwn(found.kind.verbs, "step"));
          }
          return undefined;
        }, { declaredType: "lit" });
      }
      return kinds;
    };
    // Without a default of step, only the kinds with the verb step walk.
    expect([...stepKinds(language).values()]).toEqual(expect.arrayContaining([true]));
    expect([...stepKinds(language).values()]).not.toContain(false);
    // With a default of step, the default serves the step documents of the other kinds.
    expect([...stepKinds(defaulted).values()].filter((walks) => !walks).length).toBeGreaterThan(3);
  });

  it("[GEN.CONTRACTS] without malformed choices, each document follows the contracts of its kinds: check finds no problem", () => {
    const strict = formulaMachine(STRICT);
    // The types of the options name some unknown operations on purpose. The machine knows the others (STATIC.KNOWN).
    const knownBy = (machine: Machine, types: readonly (readonly Key[])[]): readonly (readonly Key[])[] =>
      types.filter((type) => {
        const found = lookupKind(machine.world, type);
        return !found.ok || machine.known === undefined || machine.known(found.path, found.kind.verbs["eval"] ?? "") === true;
      });
    const cases: readonly (readonly [Machine, Omit<GenerateOptions, "seed">])[] = [
      [strict, { ...formulaOptions(strict), types: knownBy(strict, formulaOptions(strict).types ?? []), own: [], malformed: 0 }],
      [language, { ...formulaOptions(language), types: knownBy(language, LANGUAGE_TYPES), own: [], malformed: 0 }],
    ];
    for (const [machine, options] of cases) {
      for (let seed = 0; seed < 300; seed += 1) {
        const doc = generate(machine.world, { ...options, seed });
        expect(check(machine, doc, { declaredType: "lit", names: Object.keys(NAMES) }), show(doc)).toEqual([]);
      }
    }
  });

  it("[GEN.MALFORMED] malformed choices give unknown kinds, unknown operations, bad shapes, values without a type and names that nothing binds", () => {
    const found = new Set<string>();
    for (let seed = 0; seed < 300; seed += 1) {
      const doc = generate(STD_MACHINE.world, { ...STD_OPTIONS, seed, malformed: 0.2 });
      for (const issue of check(STD_MACHINE, doc, { names: Object.keys(NAMES) })) found.add(issue.code);
    }
    expect([...found]).toEqual(expect.arrayContaining(["#KIND?", "#NAME?", "#PART?", "#REF!", "#VALUE!"]));
    // The options name only known operations. The generator adds an unknown name under each namespace with a fallback.
    const strict = formulaMachine(STRICT);
    const types = typesOf(strict.world).concat(OP_TYPES.slice(0, 4));
    const reasons = new Set<string>();
    for (let seed = 0; seed < 300; seed += 1) {
      const doc = generate(strict.world, { ...formulaOptions(strict), types, seed, malformed: 0.2 });
      for (const issue of check(strict, doc, { declaredType: "lit", names: Object.keys(NAMES) })) reasons.add(issue.reason);
    }
    expect([...reasons]).toEqual(expect.arrayContaining(["The language has no operation nope.", "The language has no extension nope."]));
  });
});
