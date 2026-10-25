import { describe, expect, it } from "vitest";
import {
  type Cap,
  type CompiledEvaluator,
  type CompiledRunner,
  type Context,
  type Definitions,
  type DocVisit,
  type Effect,
  type EvalFn,
  type FormulaProfile,
  type GenerateOptions,
  type HostThing,
  type Json,
  type Key,
  type Machine,
  type MachinePart,
  type Plan,
  type Read,
  type Result,
  type Run,
  type Steps,
  Failure,
  STD_CAPS,
  STD_MACHINE,
  THING,
  context,
  docEquals,
  evaluate,
  fail,
  flatten,
  formulaDefinitions,
  formulaMachine,
  generate,
  isClosure,
  isEnvelope,
  isHostThing,
  isRecord,
  isStackOverflow,
  jsTruthy,
  mergeMachines,
  ok,
  permits,
  prepare,
  random,
  reference,
  sameResult,
  typeName,
  typesOf,
  walk,
} from "./index.ts";

/*
 * The law tests of the semantics (K93, R7 P4, D37). Each law follows from rules of docs/SEMANTICS.md, and each test
 * examines generated documents and machines. Each law states its conditions, and a test counts the cases that a
 * condition skips. The equations of effects come with S4.
 */

/** The number of documents for each law and configuration. CI raises it with COEVAL_AGREE_COUNT, as for the agreement harness. */
const COUNT = Number(process.env["COEVAL_AGREE_COUNT"] ?? 300);
const SEED = Number(process.env["COEVAL_AGREE_SEED"] ?? 1);

/* The values of the contexts: hard leaves, an envelope, a reference, a cycle, host things and a host function. */

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

/** This function copies the names, also the own field `__proto__`. Each call gives a new record. */
function names(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(NAMES)) Object.defineProperty(out, key, { value: NAMES[key], enumerable: true, writable: true, configurable: true });
  return out;
}

const ROOTS: readonly { readonly self: unknown; readonly event: unknown; readonly caps: readonly Cap[] }[] = [
  { self, event: { a: 1, x: { a: 2 } }, caps: ["log", "write"] },
  { self: null, event: null, caps: [] },
  { self: { a: 1, parent: null }, event: null, caps: [["log"]] },
];

/** This function gives a new context: one of three sets of roots, with the given capabilities or with its own. */
function contextOf(index: number, caps?: readonly Cap[]): Context {
  const roots = ROOTS[index % ROOTS.length] as (typeof ROOTS)[number];
  return context({ names: names(), self: roots.self, event: roots.event, caps: caps ?? roots.caps });
}

const CLOSURE = Symbol.for("coeval.closure");

function paramsOf(fn: object): unknown {
  return (fn as { readonly [CLOSURE]?: { readonly params: readonly string[] } })[CLOSURE]?.params;
}

/**
 * The rule of the tests for the values that each evaluation makes again (D15: identity is not a part of the meaning).
 * Two boxes compare their contents, and two closures of `fn` compare their parameters. Two different host things
 * compare their labels and types, because each evaluation makes new nodes of a tree.
 */
function equal(a: unknown, b: unknown): boolean | undefined {
  if (a instanceof Box || b instanceof Box) return a instanceof Box && b instanceof Box && sameResult(ok(a.v), ok(b.v), equal);
  if (isClosure(a) || isClosure(b)) return isClosure(a) && isClosure(b) && docEquals(paramsOf(a), paramsOf(b));
  if (isHostThing(a) && isHostThing(b) && a !== b) return a.label === b.label && (a as { readonly type?: unknown }).type === (b as { readonly type?: unknown }).type;
  return undefined;
}

/** A mock of the host (RUN.MOCK). Its answer depends only on the kind and the payload of an effect, not on its address. */
function mock(effect: Effect): unknown {
  if (effect.payload === "b") throw new Failure({ code: "#MOCK", reason: "The mock refuses b." });
  if (effect.payload === "") throw new Error("The mock refuses an empty text.");
  return [effect.kind, effect.payload];
}

/* The standard world and its trees. */

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

/** Trees: mostly nodes, lists and references from self, with the attributes as keys. Some paths form cycles. */
const TREE_OPTIONS: Omit<GenerateOptions, "seed"> = {
  ...STD_OPTIONS,
  types: [["panel"], ["panel"], ["box"], ["box"], ["list"], ["ref"], ["ref"], ["add"], ["number"], ["if"], ["greater"], ["nearest"]],
  roots: ["self"],
  keys: ["width", "height", "children", "children", "parent", "parent", 0, 1, "type", "a"],
  steps: 4,
  maxDepth: 5,
  maxSize: 30,
};

/**
 * Trees for TREE.ORDER-FREE: no malformed choice, and short paths through the attributes. The root stops at the first
 * failed attribute, thus a tree with fewer errors demands more attributes in each order.
 */
const ORDER_OPTIONS: Omit<GenerateOptions, "seed"> = {
  ...STD_OPTIONS,
  malformed: 0,
  data: (type, rng) => (type.join(".") === "number" ? rng.pick([0, 1, 2, 3.5, -1]) : type.join(".") === "nearest" ? rng.pick<Json>([{ type: "panel" }, { type: "box", self: true }]) : undefined),
  types: [["panel"], ["panel"], ["box"], ["box"], ["ref"], ["ref"], ["ref"], ["add"], ["number"]],
  roots: ["self"],
  keys: ["width", "height", "children", "parent", "parent", 0],
  steps: 3,
  maxDepth: 4,
  maxSize: 20,
};

/* Compiled code that tries to give its parts more capabilities than its document has (CAP.NARROW-CODE). */

const WIDE: readonly string[] = ["log", "write", "more"];

function widened(ctx: Context): Context {
  return { ...ctx, caps: WIDE };
}

function valuesOf(results: Iterable<Result>): Result {
  const values: unknown[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

const widenCode: CompiledEvaluator = {
  compile: ({ parts }) => (ctx, rt) => valuesOf(parts.map((part) => part.code(widened(ctx), rt))),
};

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

const shoutCode: CompiledEvaluator = {
  compile: ({ parts, place }) => (ctx, rt) => {
    const values = valuesOf(parts.map((part) => part.code(ctx, rt)));
    return values.ok ? rt.effect(widened(ctx), "log", values.value, place) : values;
  },
};

const widening: Machine = mergeMachines(STD_MACHINE, {
  world: {
    kinds: {
      widen: { verbs: { eval: "test.widen" }, parts: { shape: "list" } },
      widenRun: { verbs: { eval: "test.widen-run" }, parts: { shape: "list" } },
      widenLog: { verbs: { eval: "test.widen" }, parts: { shape: "list" }, caps: [{ rule: "only", caps: ["log"] }] },
      shout: { verbs: { eval: "test.shout" }, parts: { shape: "list", of: "text" }, effects: ["log"] },
    },
  },
  evaluators: { "test.widen": widenCode, "test.shout": shoutCode },
  runners: { "test.widen-run": widenRun },
});

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

const WIDENING_OPTIONS: Omit<GenerateOptions, "seed"> = {
  ...STD_OPTIONS,
  types: [...typesOf(widening.world), ...["widen", "widenRun", "widenLog", "shout"].flatMap((kind) => [[kind], [kind]])],
  hints: (type) => (["widen", "widenRun", "widenLog"].includes(String(type[0])) ? [["log"], ["write"], ["shout"], ["seq"]] : undefined),
};

/* The formula kit, with two test profiles, and a language on it. */

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

const STRICT: FormulaProfile = { ops: OPS, lazy: LAZY, ext: EXT };
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
};

const OP_TYPES: readonly (readonly Key[])[] = [...Object.keys(OPS).map((name) => ["ops", ...name.split(".")]), ["ops", "nothing"], ["ops", "ifError"], ["ops", "second"]];
const EXT_TYPES: readonly (readonly Key[])[] = [["ext", "undefined"], ["ext", "number"], ["ext", "here"], ["ext", "count"], ["ext", "bad"], ["ext", "nope"]];

function formulaOptions(machine: Machine, types: readonly (readonly Key[])[] = [...typesOf(machine.world), ...OP_TYPES, ...EXT_TYPES]): Omit<GenerateOptions, "seed"> {
  return {
    declaredType: "lit",
    names: Object.keys(NAMES),
    types,
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

/** A language: a deep shape for ref with step documents, an address, data shapes, capability rules and an effect. */
const language: Machine = formulaMachine(LOOSE, {
  replaces: [["world", "kinds", "ref"]],
  world: {
    kinds: {
      ref: { verbs: { eval: "formula.ref" }, parts: { shape: "deep" } },
      moves: { kinds: {}, fallback: { verbs: { eval: "formula.step", step: "walk.at" }, parts: { shape: "deep" } } },
      probe: { verbs: { eval: "test.probe" }, parts: { shape: "record", fields: { target: { shape: "term", of: "lit", address: true } }, required: ["target"] } },
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

const LANGUAGE_TYPES: readonly (readonly Key[])[] = [...typesOf(language.world), ["moves", "up"], ["moves", "at"], ...OP_TYPES.slice(0, 4), ["ext", "here"], ["say"], ["fence"]];

/* The configurations of the laws. */

interface Config {
  readonly name: string;
  readonly machine: Machine;
  readonly options: Omit<GenerateOptions, "seed">;
  readonly definitions?: Definitions;
}

function formulaConfig(name: string, profile: FormulaProfile): Config {
  const machine = formulaMachine(profile);
  return { name, machine, options: formulaOptions(machine), definitions: formulaDefinitions(profile) };
}

const STANDARD: Config = { name: "standard", machine: STD_MACHINE, options: STD_OPTIONS };
const TREES: Config = { name: "trees", machine: STD_MACHINE, options: TREE_OPTIONS };
const FORMULA_STRICT = formulaConfig("formula, strict", STRICT);
const FORMULA_LOOSE = formulaConfig("formula, loose", LOOSE);
const LANGUAGE: Config = { name: "language", machine: language, options: { ...formulaOptions(language, LANGUAGE_TYPES) }, definitions: formulaDefinitions(LOOSE) };
const WIDENING: Config = { name: "compiled code that widens", machine: widening, options: WIDENING_OPTIONS, definitions: WIDENING_DEFINITIONS };

/* The tiers: the plan and the reference interpreter, each with the mock and a list of effects. */

interface Outcome {
  readonly result: Result;
  readonly effects: readonly Effect[];
  /** The reads of the plan. The reference does not record reads. */
  readonly reads?: readonly Read[];
}

type Tier = (config: Config, machine: Machine, doc: unknown, ctx: Context) => Outcome;

function declaredOf(config: Config): { readonly declaredType?: string } {
  return config.options.declaredType === undefined ? {} : { declaredType: config.options.declaredType };
}

function evaluateOnce(plan: Plan, ctx: Context): Outcome {
  const effects: Effect[] = [];
  const reads: Read[] = [];
  const result = plan.evaluate(ctx, { effects, reads, perform: mock });
  return { result, effects, reads };
}

const planned: Tier = (config, machine, doc, ctx) => evaluateOnce(prepare(machine, doc, declaredOf(config)), ctx);

const referred: Tier = (config, machine, doc, ctx) => {
  const effects: Effect[] = [];
  const definitions = config.definitions === undefined ? {} : { definitions: config.definitions };
  return { result: reference(machine, doc, ctx, { ...declaredOf(config), ...definitions, effects, perform: mock }), effects };
};

const TIERS: readonly (readonly [string, Tier])[] = [
  ["plan", planned],
  ["reference", referred],
];

/* The comparisons. */

/** A function from the places of one document to the places of the same parts in another document. */
type Move = (place: readonly Key[]) => readonly Key[];

const stay: Move = (place) => place;

/** This function moves each place that starts with one of the prefixes `from` to its prefix `to`. */
function moving(pairs: readonly (readonly [readonly Key[], readonly Key[]])[]): Move {
  return (place) => {
    for (const [from, to] of pairs) if (from.length <= place.length && from.every((key, index) => key === place[index])) return [...to, ...place.slice(from.length)];
    return place;
  };
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item: unknown) => (typeof item === "function" ? "<fn>" : item === undefined ? "<undefined>" : item)) ?? String(value);
  } catch {
    return String(value);
  }
}

function text(result: Result): string {
  return result.ok ? `the value ${show(result.value)}` : `${result.error.code} at [${(result.error.place ?? []).join(", ")}] ("${result.error.reason}")`;
}

/**
 * This function gives the difference of two results, or `undefined` when they are the same. Without a move, the rules
 * of `sameResult` decide. A move changes the places, thus two errors then need the same code and the moved place.
 */
function resultDiffers(a: Result, b: Result, move: Move = stay): string | undefined {
  if (a.ok && b.ok) return sameResult(a, b, equal) ? undefined : `${text(a)} and ${text(b)}`;
  if (!a.ok && !b.ok && move === stay) return sameResult(a, b) ? undefined : `${text(a)} and ${text(b)}`;
  if (!a.ok && !b.ok) return a.error.code === b.error.code && docEquals(a.error.place === undefined ? undefined : move(a.error.place), b.error.place) ? undefined : `${text(a)} and ${text(b)}`;
  return `${text(a)} and ${text(b)}`;
}

function countOf(address: string | undefined): string | undefined {
  return address?.slice(address.lastIndexOf("#"));
}

/** This function gives the difference of two lists of effects: the kinds, the places, the payloads, the addresses and the outcomes. */
function effectsDiffer(a: readonly Effect[], b: readonly Effect[], move: Move = stay): string | undefined {
  if (a.length !== b.length) return `${a.length} and ${b.length} effects`;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] as Effect;
    const y = b[index] as Effect;
    if (x.kind !== y.kind || !docEquals(move(x.place), y.place) || !sameResult(ok(x.payload), ok(y.payload), equal)) {
      return `the effect ${index}: ${x.kind} at [${x.place.join(", ")}] and ${y.kind} at [${y.place.join(", ")}]`;
    }
    if (move === stay ? x.address !== y.address : countOf(x.address) !== countOf(y.address)) return `the effect ${index}: the addresses ${x.address} and ${y.address}`;
    const why = x.outcome !== undefined && y.outcome !== undefined ? resultDiffers(x.outcome, y.outcome, move) : x.outcome === y.outcome ? undefined : "one outcome";
    if (why !== undefined) return `the outcome of the effect ${index}: ${why}`;
  }
  return undefined;
}

/** This function gives the difference of two lists of reads: the paths, what they reached and the marks. */
function readsDiffer(a: readonly Read[], b: readonly Read[]): string | undefined {
  if (a.length !== b.length) return `${a.length} and ${b.length} reads`;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] as Read;
    const y = b[index] as Read;
    if (!sameResult(ok(x.path), ok(y.path), equal) || !sameResult(x.reached, y.reached, equal) || x.free !== y.free || x.kept !== y.kept) return `the read ${index} of ${show(x.path)}`;
  }
  return undefined;
}

function outcomesDiffer(a: Outcome, b: Outcome, move: Move = stay): string | undefined {
  return resultDiffers(a.result, b.result, move) ?? effectsDiffer(a.effects, b.effects, move);
}

/** An overflow of the stack of the host is the one permitted difference of two evaluations (AGREE.ERRORS, K94). */
function overflowed(result: Result): boolean {
  return !result.ok && result.error.code === "#DEPTH!" && isStackOverflow(result.error.cause);
}

interface Finding {
  readonly config: string;
  readonly seed: number;
  readonly reason: string;
  readonly doc: unknown;
}

function report(findings: readonly Finding[]): readonly string[] {
  return findings.slice(0, 3).map((item) => `${item.config}, seed ${item.seed}: ${item.reason}\n  doc ${show(item.doc)}`);
}

function seedOf(index: number): number {
  return SEED * 1_000_003 + index;
}

/* The changes of a document. */

/** This function copies a list or a plain record, also its own field `__proto__`, in the order of its keys. */
function copyOf(value: unknown, keys?: readonly string[]): unknown {
  if (Array.isArray(value)) return [...(value as readonly unknown[])];
  const record = value as Readonly<Record<string, unknown>>;
  const out: Record<string, unknown> = {};
  for (const key of keys ?? Object.keys(record)) Object.defineProperty(out, key, { value: record[key], enumerable: true, writable: true, configurable: true });
  return out;
}

function valueAt(value: unknown, at: readonly Key[]): unknown {
  let here = value;
  for (const key of at) here = (here as Readonly<Record<string, unknown>>)[String(key)];
  return here;
}

/** This function gives a new value with `change` at the JSON path `at`. The containers on the way are new. */
function replaceAt(value: unknown, at: readonly Key[], change: unknown): unknown {
  if (at.length === 0) return change;
  const [key, ...rest] = at;
  const out = copyOf(value) as Record<string, unknown>;
  Object.defineProperty(out, String(key), { value: replaceAt(out[String(key)], rest, change), enumerable: true, writable: true, configurable: true });
  return out;
}

function placeKey(place: readonly (string | Key)[]): string {
  return place.map(String).join("\u0001");
}

/** This function lists the results of each place of a trace, in the order of the starts. */
function resultsByPlace(run: Run): Map<string, Result[]> {
  const out = new Map<string, Result[]>();
  for (const node of flatten(run.trace)) {
    const key = placeKey(node.path);
    const list = out.get(key);
    if (list === undefined) out.set(key, [node.result]);
    else list.push(node.result);
  }
  return out;
}

/** This function tells if a value is plain JSON, thus a literal can hold it. */
function isJson(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item: unknown) => isJson(item, depth + 1));
  return isRecord(value) && Object.keys(value).every((key) => isJson(value[key], depth + 1));
}

/* EVAL.SEALED: a part with a JSON result gives way to a literal of that result. */

/** A literal for the standard world: its value is its result. */
const LIT: MachinePart = {
  world: { kinds: { lit: { verbs: { eval: "test.lit" }, pure: true } } },
  evaluators: { "test.lit": ({ data }) => ok(data) },
};

/** A kind whose code reads the JSON of its parts in `doc.value`. Thus it breaks the obligation C5. */
const PEEK: MachinePart = {
  world: { kinds: { peek: { verbs: { eval: "test.peek" }, parts: { shape: "list", of: "number" }, pure: true } } },
  evaluators: {
    "test.peek": ({ doc, parts }) => {
      for (const part of parts) {
        const result = part.evaluate();
        if (!result.ok) return result;
      }
      return ok((doc.value as readonly unknown[]).map((item) => (isEnvelope(item) ? typeName(item.type) : typeof item)));
    },
  },
};

const sealedStandard = mergeMachines(STD_MACHINE, LIT);
const peeking = mergeMachines(STD_MACHINE, LIT, PEEK);

const SEALED_CONFIGS: readonly Config[] = [
  { ...STANDARD, machine: sealedStandard },
  { ...TREES, machine: sealedStandard },
  FORMULA_STRICT,
  FORMULA_LOOSE,
  LANGUAGE,
];

const PEEKING: Config = { name: "a kind that reads doc.value", machine: peeking, options: { ...STD_OPTIONS, types: [...typesOf(peeking.world), ["peek"], ["peek"], ["peek"]] } };

interface SealedOutcome {
  readonly findings: readonly Finding[];
  /** The number of parts that a literal replaced. */
  readonly replaced: number;
  /** The number of documents without a part that evaluates one time to a JSON value. */
  readonly skipped: number;
}

/**
 * This function examines EVAL.SEALED on generated documents. A part that evaluates one time to a JSON value changes
 * to a literal of that value, with the same header. The parent then gives the same result, and the effects outside
 * the part stay the same, in the plan and in the reference.
 */
function sealedLaw(config: Config): SealedOutcome {
  const findings: Finding[] = [];
  let replaced = 0;
  let skipped = 0;
  const machine = config.machine;
  for (let index = 0; index < COUNT; index += 1) {
    const seed = seedOf(index);
    const doc = generate(machine.world, { ...config.options, seed });
    const ctx = contextOf(index);
    const runs = resultsByPlace(evaluate(machine, doc, ctx, { ...declaredOf(config), perform: mock }));
    const visits: DocVisit[] = [];
    walk(machine.world, doc, (visit) => void visits.push(visit), declaredOf(config));
    const candidates = visits.filter((visit) => {
      const results = runs.get(placeKey(visit.place));
      const only = results?.length === 1 ? results[0] : undefined;
      return visit.place.length > 0 && only !== undefined && only.ok && isJson(only.value);
    });
    if (candidates.length === 0) {
      skipped += 1;
      continue;
    }
    const rng = random(seed);
    const before = TIERS.map(([, tier]) => tier(config, machine, doc, ctx));
    for (let pick = Math.min(2, candidates.length); pick > 0; pick -= 1) {
      const visit = rng.pick(candidates);
      const result = (runs.get(placeKey(visit.place)) as Result[])[0] as { readonly ok: true; readonly value: unknown };
      const original = valueAt(doc, visit.at);
      const header = isEnvelope(original) && typeof (original as { readonly name?: unknown }).name === "string" ? { name: (original as { readonly name: string }).name } : {};
      const changed = replaceAt(doc, visit.at, { type: "lit", value: result.value, ...header });
      replaced += 1;
      const inside = (effect: Effect): boolean => visit.place.every((key, step) => String(key) === String(effect.place[step]));
      TIERS.forEach(([name, tier], at) => {
        const old = before[at] as Outcome;
        const now = tier(config, machine, changed, ctx);
        const why = resultDiffers(old.result, now.result) ?? effectsDiffer(old.effects.filter((effect) => !inside(effect)), now.effects.filter((effect) => !inside(effect)));
        if (why !== undefined) findings.push({ config: config.name, seed, reason: `${name}: a literal at [${visit.place.join(", ")}] changes ${why}`, doc });
      });
    }
  }
  return { findings, replaced, skipped };
}

/* CAP.MONOTONE: fewer capabilities. */

/** The capabilities of the law, and the pairs of more and fewer capabilities. */
const CAPS: readonly (readonly Cap[])[] = [["log", "write"], ["log"], ["write"], []];
const FEWER: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
  [0, 3],
];

/** One question of an effect to the capabilities: its kind, and the answer. */
interface Attempt {
  readonly kind: string;
  readonly allowed: boolean;
}

/** This function gives a machine that records each question of an effect to its rule, and gives the same answer. */
function asking(machine: Machine, log: { list: Attempt[] }): Machine {
  const rule = machine.permits;
  return {
    ...machine,
    permits: (caps, kind, ctx) => {
      const allowed = rule === undefined ? permits(caps, kind) : rule(caps, kind, ctx);
      log.list.push({ kind: kind.join("."), allowed });
      return allowed;
    },
  };
}

/**
 * This function examines CAP.MONOTONE for one pair of evaluations. Up to the first effect that fewer capabilities
 * refuse and more capabilities permit, the two evaluations ask the same questions and get the same answers. Without
 * such an effect, they give the same result and the same effects.
 */
function monotone(more: Outcome, fewer: Outcome, a: readonly Attempt[], b: readonly Attempt[]): { readonly why?: string; readonly split: boolean } {
  let index = 0;
  while (index < a.length && index < b.length && a[index]?.kind === b[index]?.kind && a[index]?.allowed === b[index]?.allowed) index += 1;
  const allowed = a.slice(0, index).filter((attempt) => attempt.allowed).length;
  const before = effectsDiffer(more.effects.slice(0, allowed), fewer.effects.slice(0, allowed));
  if (index === a.length && index === b.length) {
    const why = outcomesDiffer(more, fewer);
    return why === undefined ? { split: false } : { why, split: false };
  }
  const x = a[index];
  const y = b[index];
  if (x !== undefined && y !== undefined && x.kind === y.kind && x.allowed && !y.allowed) return before === undefined ? { split: true } : { why: `before the first refusal, ${before}`, split: true };
  const asked = (attempt: Attempt | undefined): string => (attempt === undefined ? "no question" : `${attempt.kind} ${attempt.allowed ? "permitted" : "refused"}`);
  return { why: `the question ${index} of an effect: ${asked(x)} with more capabilities, and ${asked(y)} with fewer`, split: false };
}

interface MonotoneOutcome {
  readonly findings: readonly Finding[];
  /** The number of pairs that gave the same result and caused at least one effect. */
  readonly same: number;
  /** The number of pairs that split at an effect that only more capabilities permit. */
  readonly split: number;
  /** The number of documents that read the root caps. */
  readonly skipped: number;
}

function monotoneLaw(config: Config): MonotoneOutcome {
  const findings: Finding[] = [];
  let same = 0;
  let split = 0;
  let skipped = 0;
  const log = { list: [] as Attempt[] };
  const machine = asking(config.machine, log);
  for (let index = 0; index < COUNT; index += 1) {
    const seed = seedOf(index);
    const doc = generate(config.machine.world, { ...config.options, seed });
    const runs = TIERS.map(([name, tier]) => ({
      name,
      outcomes: CAPS.map((caps) => {
        log.list = [];
        const outcome = tier(config, machine, doc, contextOf(index, caps));
        return { outcome, attempts: log.list };
      }),
    }));
    // A read of the root caps sees the capabilities as a value. The law holds only for a document without such a read.
    const reads = runs[0]?.outcomes.flatMap(({ outcome }) => outcome.reads ?? []) ?? [];
    if (reads.some((read) => read.path[0] === "caps" && read.kept !== true) || runs.some((run) => run.outcomes.some(({ outcome }) => overflowed(outcome.result)))) {
      skipped += 1;
      continue;
    }
    for (const run of runs) {
      for (const [wide, narrow] of FEWER) {
        const more = run.outcomes[wide] as (typeof run.outcomes)[number];
        const fewer = run.outcomes[narrow] as (typeof run.outcomes)[number];
        const checked = monotone(more.outcome, fewer.outcome, more.attempts, fewer.attempts);
        if (checked.why !== undefined) findings.push({ config: config.name, seed, reason: `${run.name}, ${show(CAPS[wide])} and ${show(CAPS[narrow])}: ${checked.why}`, doc });
        else if (checked.split) split += 1;
        else if (more.outcome.effects.length > 0) same += 1;
      }
    }
  }
  return { findings, same, split, skipped };
}

/* COMPOSE.CONSERVATIVE: an extension with new kinds. */

const yell: EvalFn = ({ parts, effect }) => {
  const values = valuesOf(parts.map((part) => part.evaluate()));
  return values.ok ? effect("log", values.value) : values;
};

/** New kinds for the standard world: a new kind, an alias, a kind in a namespace of the base, a new namespace and a default of a new verb. */
const STD_MORE: MachinePart = {
  world: {
    kinds: {
      yell: { verbs: { eval: "more.yell" }, parts: { shape: "list", of: "text" }, side: "run", effects: ["log"] },
      twice: { type: "ref", value: ["world", "add"] },
      math: { kinds: { mean: { verbs: { eval: "more.mean" }, parts: { shape: "list", of: "number" }, pure: true } } },
      extra: { kinds: { one: { verbs: { eval: "more.one" }, pure: true } } },
    },
    defaults: { format: "more.format" },
  },
  evaluators: {
    "more.yell": yell,
    "more.mean": ({ parts }) => {
      const values = valuesOf(parts.map((part) => part.evaluate()));
      return values.ok ? ok((values.value as number[]).reduce((sum, value) => sum + value, 0) / Math.max(1, (values.value as number[]).length)) : values;
    },
    "more.one": () => ok(1),
    "more.format": () => ok("text"),
  },
};

/** New kinds for the formula kit: an operation in the namespace `ops`, which has a fallback, an alias and a kind with an effect. */
const FORMULA_MORE: MachinePart = {
  world: {
    kinds: {
      ops: { kinds: { twice: { verbs: { eval: "more.twice" }, parts: { shape: "list", of: "lit" } } } },
      double: { type: "ref", value: ["world", "ops", "twice"] },
      yell: { verbs: { eval: "more.yell" }, parts: { shape: "list", of: "lit" }, effects: ["log"] },
    },
  },
  evaluators: {
    "more.twice": ({ parts }) => {
      const values = valuesOf(parts.map((part) => part.evaluate()));
      return values.ok ? ok(values.value) : values;
    },
    "more.yell": yell,
  },
};

/** New kinds for the language: a step in the namespace `moves`, which has a fallback, and a new walker. */
const LANGUAGE_MORE: MachinePart = {
  world: { kinds: { moves: { kinds: { jump: { verbs: { eval: "formula.step", step: "more.jump" }, parts: { shape: "deep" } } } } } },
  walkers: { "more.jump": ({ here }) => ({ ok: true, thing: here }) },
};

const COMPOSE_CASES: readonly (readonly [Config, readonly MachinePart[]])[] = [
  [STANDARD, [STD_MORE]],
  [FORMULA_STRICT, [FORMULA_MORE]],
  [LANGUAGE, [FORMULA_MORE, LANGUAGE_MORE]],
];

/**
 * This function compares the reads of a document in the base and in the extension. The first read that differs must
 * be a read of the root `world` with the same path: the document reads an entry that the extension changed.
 */
function worldChange(base: readonly Read[], more: readonly Read[]): "same" | "world" | string {
  for (let index = 0; index < Math.max(base.length, more.length); index += 1) {
    const x = base[index];
    const y = more[index];
    if (x !== undefined && y !== undefined && readsDiffer([x], [y]) === undefined) continue;
    if (x !== undefined && y !== undefined && x.path[0] === "world" && sameResult(ok(x.path), ok(y.path), equal)) return "world";
    return `the read ${index} differs: ${show(x?.path)} and ${show(y?.path)}`;
  }
  return "same";
}

/* TREE.ORDER-FREE: another order of the attributes of each node. */

/** This function tells if a document is a node of a tree: a `panel` or a `box` without an own entry for another evaluator. */
function isNode(visit: DocVisit | undefined): boolean {
  const kind = visit?.typePath?.[0];
  return (kind === "panel" || kind === "box") && (visit?.doc as { readonly own?: unknown } | undefined)?.own === undefined;
}

/**
 * This function changes the order of the fields of each node of `panel` and `box`. It gives the new document, the
 * number of nodes that changed, and the places of the documents inside a node: the attributes and their parts.
 */
function reordered(machine: Machine, doc: unknown, seed: number): { readonly doc: unknown; readonly moved: number; readonly inside: ReadonlySet<string> } {
  const rng = random(seed);
  const nodes: (readonly Key[])[] = [];
  const inside = new Set<string>();
  walk(machine.world, doc, (visit) => {
    for (let above = visit.parent; above !== undefined; above = above.parent) if (isNode(above)) inside.add(placeKey(visit.place));
    if (isNode(visit) && !visit.declared && isRecord(visit.doc.value) && Object.keys(visit.doc.value).length > 1) nodes.push([...visit.at, "value"]);
  });
  let out = doc;
  for (const at of nodes) {
    const keys = Object.keys(valueAt(out, at) as object);
    const turn = 1 + rng.int(keys.length - 1);
    out = replaceAt(out, at, copyOf(valueAt(out, at), [...keys.slice(turn), ...keys.slice(0, turn)]));
  }
  return { doc: out, moved: nodes.length, inside };
}

/** This function tells if an evaluation met a cycle of demands, or an overflow of the stack of the host. */
function cyclic(run: Run): boolean {
  return flatten(run.trace).some((node) => !node.result.ok && (node.result.error.code === "#CYCLE!" || overflowed(node.result)));
}

/**
 * The result of a root of a tree, and of each document around it: the same value in each order, or an error in each
 * order. The root gives the first error of its attributes in their order, thus that error can differ.
 */
function treeDiffers(a: Result, b: Result): string | undefined {
  if (a.ok !== b.ok) return `${text(a)} and ${text(b)}`;
  return a.ok ? resultDiffers(a, b) : undefined;
}

/* SEQ.LAWS: the steps of seq and the scope of their names. */

const HEADERS = ["x", "a", "n", "last"] as const;

/** The steps: small documents of the standard world, often with an effect or a sequence. */
const STEP_OPTIONS: Omit<GenerateOptions, "seed"> = {
  ...STD_OPTIONS,
  types: [...typesOf(STD_MACHINE.world), ["log"], ["log"], ["write"], ["seq"], ["seq"], ["ref"]],
  maxDepth: 3,
  maxSize: 12,
};

function seq(steps: readonly unknown[]): Json {
  return { type: "seq", value: steps as Json[] };
}

/** This function gives a step with a header, when the step is an envelope. */
function named(step: unknown, header: string | undefined): unknown {
  return header === undefined || !isEnvelope(step) ? step : { ...(step as object), name: header };
}

/** This function gives a step that first reads a name, and then gives the list of that name and the result of the step. */
function reading(step: unknown, name: string | undefined): unknown {
  return name === undefined ? step : { type: "list", value: [{ type: "ref", value: ["names", name] }, step] };
}

/* The tests. */

describe("the laws of the semantics", () => {
  it("[EVAL.SEALED] a part that evaluates one time to a JSON value gives way to a literal of that value, and the parent gives the same result, for code that keeps C5", () => {
    const outcomes = SEALED_CONFIGS.map((config) => [config.name, sealedLaw(config)] as const);
    expect(report(outcomes.flatMap(([, outcome]) => outcome.findings))).toEqual([]);
    for (const [name, outcome] of outcomes) expect(outcome.replaced, `${name}: ${outcome.skipped} documents without a part to replace`).toBeGreaterThan(COUNT / 5);
    // The law needs the obligation C5: a kind whose code reads the JSON of its parts sees the literal.
    expect(sealedLaw(PEEKING).findings.length).toBeGreaterThan(0);
  }, 120_000);

  it("[EVAL.DETERMINISTIC] the same machine, document and context give the same result, effects and reads again, also after an evaluation in another context, in the plan and in the reference", () => {
    let compared = 0;
    let skipped = 0;
    for (const config of [STANDARD, TREES, FORMULA_STRICT, FORMULA_LOOSE, LANGUAGE, WIDENING]) {
      const findings: Finding[] = [];
      for (let index = 0; index < COUNT; index += 1) {
        const seed = seedOf(index);
        const doc = generate(config.machine.world, { ...config.options, seed });
        const first = contextOf(index);
        const other = contextOf(index + 1);
        const plan = prepare(config.machine, doc, declaredOf(config));
        const a1 = evaluateOnce(plan, first);
        const b1 = evaluateOnce(plan, other);
        const a2 = evaluateOnce(plan, first);
        const b2 = planned(config, config.machine, doc, other);
        const x1 = referred(config, config.machine, doc, first);
        const y1 = referred(config, config.machine, doc, other);
        const x2 = referred(config, config.machine, doc, first);
        const y2 = referred(config, config.machine, doc, other);
        if ([a1, b1, a2, b2, x1, y1, x2, y2].some((outcome) => overflowed(outcome.result))) {
          skipped += 1;
          continue;
        }
        compared += 1;
        const pairs: readonly (readonly [string, Outcome, Outcome])[] = [
          ["the plan", a1, a2],
          ["the plan in the other context, and a new plan", b1, b2],
          ["the reference", x1, x2],
          ["the reference in the other context", y1, y2],
        ];
        for (const [name, x, y] of pairs) {
          const why = outcomesDiffer(x, y) ?? (x.reads !== undefined && y.reads !== undefined ? readsDiffer(x.reads, y.reads) : undefined);
          if (why !== undefined) findings.push({ config: config.name, seed, reason: `${name}: ${why}`, doc });
        }
      }
      expect(report(findings), config.name).toEqual([]);
    }
    expect(skipped, "documents with an overflow of the stack").toBeLessThan(compared / 20);
  }, 120_000);

  it("[CAP.MONOTONE] fewer capabilities never change the result of an evaluation without a refused effect, and never permit an effect that more capabilities refused", () => {
    for (const config of [STANDARD, LANGUAGE, WIDENING]) {
      const outcome = monotoneLaw(config);
      expect(report(outcome.findings), config.name).toEqual([]);
      expect(outcome.split, `${config.name}: pairs that split at a refused effect`).toBeGreaterThan(COUNT / 10);
      expect(outcome.same, `${config.name}: pairs with the same effects`).toBeGreaterThan(COUNT / 20);
      expect(outcome.skipped, `${config.name}: documents that read the root caps`).toBeLessThan(COUNT / 2);
    }
  }, 120_000);

  it("[COMPOSE.CONSERVATIVE] an extension with new kinds and no conflict keeps the result of each document that names no new kind and reads no changed entry of the world", () => {
    for (const [config, parts] of COMPOSE_CASES) {
      const merged = mergeMachines(config.machine, ...parts);
      const findings: Finding[] = [];
      let compared = 0;
      let skipped = 0;
      for (let index = 0; index < COUNT; index += 1) {
        const seed = seedOf(index);
        const doc = generate(config.machine.world, { ...config.options, seed });
        const ctx = contextOf(index);
        const base = planned(config, config.machine, doc, ctx);
        const more = planned(config, merged, doc, ctx);
        const change = worldChange(base.reads ?? [], more.reads ?? []);
        if (change === "world" || overflowed(base.result) || overflowed(more.result)) {
          skipped += 1;
          continue;
        }
        compared += 1;
        const why = change === "same" ? (outcomesDiffer(base, more) ?? outcomesDiffer(referred(config, config.machine, doc, ctx), referred(config, merged, doc, ctx))) : change;
        if (why !== undefined) findings.push({ config: config.name, seed, reason: why, doc });
      }
      expect(report(findings), config.name).toEqual([]);
      expect(compared, `${config.name}: ${skipped} documents read a changed entry of the world`).toBeGreaterThan(COUNT * 0.7);
    }
  }, 120_000);

  it("[TREE.ORDER-FREE] another order of the attributes of each node gives each document of a tree without a cycle the same result", () => {
    const findings: Finding[] = [];
    let compared = 0;
    let skipped = 0;
    for (let index = 0; index < COUNT; index += 1) {
      const seed = seedOf(index);
      const doc = generate(STD_MACHINE.world, { ...ORDER_OPTIONS, seed });
      const changed = reordered(STD_MACHINE, doc, seed);
      if (changed.moved === 0) continue;
      const ctx = contextOf(index);
      const runA = evaluate(STD_MACHINE, doc, ctx);
      const runB = evaluate(STD_MACHINE, changed.doc, ctx);
      const refA = reference(STD_MACHINE, doc, ctx);
      const refB = reference(STD_MACHINE, changed.doc, ctx);
      // A cycle of demands gives #CYCLE! at the reference that closes it, thus its place depends on the order (T-CYCLE).
      if (cyclic(runA) || cyclic(runB) || [refA, refB].some((result) => !result.ok && result.error.code === "#CYCLE!")) {
        skipped += 1;
        continue;
      }
      compared += 1;
      const a = resultsByPlace(runA);
      const b = resultsByPlace(runB);
      for (const [place, results] of a) {
        const others = b.get(place);
        if (results.length !== 1 || others?.length !== 1) continue;
        // A document inside a node gives the same result. A root and the documents around it give a value in each order or in none.
        const why = (changed.inside.has(place) ? resultDiffers : treeDiffers)(results[0] as Result, others[0] as Result);
        if (why !== undefined) findings.push({ config: "trees", seed, reason: `the document at [${place.split("\u0001").join(", ")}]: ${why}`, doc });
      }
      const why = treeDiffers(runA.result, runB.result) ?? treeDiffers(refA, refB);
      if (why !== undefined) findings.push({ config: "trees", seed, reason: `the tree: ${why}`, doc });
    }
    expect(report(findings)).toEqual([]);
    expect(compared, `${skipped} documents with a cycle`).toBeGreaterThan(COUNT / 4);
  }, 120_000);

  it("[SEQ.LAWS] seq with one step gives the step, the steps at the end or the start of a sequence group into a nested sequence by the rules of names, and a name reaches only the later steps of its own sequence", () => {
    for (const [, tier] of TIERS) expect(tier(STANDARD, STD_MACHINE, seq([]), contextOf(0)).result).toEqual(ok(null));
    const findings: Finding[] = [];
    const reached = new Map<string, number>();
    for (let index = 0; index < COUNT; index += 1) {
      const seed = seedOf(index);
      const rng = random(seed);
      const [a, b, c] = [0, 1, 2].map((step) => generate(STD_MACHINE.world, { ...STEP_OPTIONS, seed: seed * 3 + step }));
      const header = (): string | undefined => (rng.chance(0.5) ? rng.pick(HEADERS) : undefined);
      const [ha, hb, hc] = [header(), header(), header()];
      const hs = rng.pick(HEADERS);
      const laws: readonly (readonly [string, unknown, unknown, Move])[] = [
        // The unit: seq with one step gives the result and the effects of the step, one level deeper.
        ["one step", named(a, ha), seq([named(a, ha)]), (place) => [0, ...place]],
        // The steps after the first group into a nested sequence, also with names: a sequence passes its names in.
        [
          "a nested tail",
          seq([named(a, ha), named(reading(b, ha), hb), named(reading(c, hb), hc)]),
          seq([named(a, ha), seq([named(reading(b, ha), hb), named(reading(c, hb), hc)])]),
          moving([[[1], [1, 0]], [[2], [1, 1]]]),
        ],
        // The first steps group into a nested sequence when only the last of them has a name. The group gets the name.
        ["a nested head", seq([a, named(b, hb), named(reading(c, hb), hc)]), seq([named(seq([a, b]), hb), named(reading(c, hb), hc)]), moving([[[0], [0, 0]], [[1], [0, 1]], [[2], [1]]])],
        // The name of a step of a nested sequence does not reach the steps after that sequence.
        ["the scope of a name", seq([a, reading(c, hs)]), seq([seq([named(a, hs)]), reading(c, hs)]), moving([[[0], [0, 0]]])],
      ];
      for (const [law, flat, nested, move] of laws) {
        for (const [name, tier] of TIERS) {
          const x = tier(STANDARD, STD_MACHINE, flat, contextOf(index, STD_CAPS));
          const y = tier(STANDARD, STD_MACHINE, nested, contextOf(index, STD_CAPS));
          const why = outcomesDiffer(x, y, move);
          if (why !== undefined) findings.push({ config: law, seed, reason: `${name}: ${why}`, doc: nested });
          for (const kind of [x.result.ok ? "value" : "error", ...(x.effects.length > 0 ? ["effects"] : [])]) reached.set(kind, (reached.get(kind) ?? 0) + 1);
        }
      }
    }
    expect(report(findings)).toEqual([]);
    for (const kind of ["value", "error", "effects"]) expect(reached.get(kind) ?? 0, kind).toBeGreaterThan(COUNT / 4);
  }, 120_000);
});
