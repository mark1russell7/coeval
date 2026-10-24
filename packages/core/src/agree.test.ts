import { describe, expect, it } from "vitest";
import {
  type AgreeOptions,
  type CompiledEvaluator,
  type Context,
  type Effect,
  type EvalError,
  type FormulaProfile,
  type GenerateOptions,
  type HostThing,
  type Json,
  type Key,
  type Machine,
  type Result,
  type Steps,
  type TierResult,
  STD_MACHINE,
  THING,
  agree,
  check,
  context,
  docEquals,
  fail,
  formulaDefinitions,
  formulaEvaluators,
  formulaMachine,
  generate,
  isRef,
  jsTruthy,
  lookupKind,
  ok,
  prepare,
  random,
  reference,
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

/** The rule of the tests for a value that is not JSON: two boxes are the same when their contents are the same. */
function boxes(a: unknown, b: unknown): boolean | undefined {
  return a instanceof Box && b instanceof Box ? sameValue(a.v, b.v, boxes) : undefined;
}

/**
 * This function tells if a value is deeper than a limit. A part of the standard `tree.node` that reads its own node
 * recurses until the stack of the host overflows, and the node hides the overflow in a deep value. This is the known
 * gap that L2a fixes (R3 P1). The tiers use different numbers of frames, thus their values have different depths.
 */
function deeper(value: unknown, limit: number): boolean {
  let here: unknown = value;
  for (let depth = 0; depth < limit; depth += 1) {
    if (typeof here !== "object" || here === null) return false;
    const values = Object.values(here);
    here = values.find((item) => typeof item === "object" && item !== null);
  }
  return true;
}

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

const CONFIGS: readonly Config[] = [
  { name: "standard", machine: waiting, options: STD_OPTIONS, agree: { strict: true } },
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
    name: "language",
    machine: language,
    options: { ...formulaOptions(language), types: LANGUAGE_TYPES },
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
 * A name that nothing binds has the same code and place, when the reference at the place names it itself and the
 * host adopts no values.
 */
function sameInCheck(machine: Machine, doc: unknown, error: EvalError, declared: { readonly declaredType?: string }): "reason" | "place" | undefined {
  if (error.code === "#NAME?" && /^The language has no (operation|extension) /.test(error.reason)) return "reason";
  if (error.code === "#VALUE!" && / The kind is .+\.$/.test(error.reason)) return "reason";
  const name = /^The context has no name (.+)\.$/.exec(error.reason)?.[1];
  // A host that adopts the names answers their steps itself (DEREF.ADOPT). Its deref cannot give a name whose value
  // is undefined, thus such a name is unbound in a run and bound for check.
  if (error.code !== "#NAME?" || name === undefined || machine.adopt !== undefined) return undefined;
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
    if (!outcome.ok && (deeper(outcome.plan.ok ? outcome.plan.value : null, 64) || deeper(outcome.other.ok ? outcome.other.value : null, 64))) {
      count(codes, "tree.node cycle (L2a)");
      continue;
    }
    if (!outcome.ok) {
      findings.push({ seed, reason: outcome.reason, doc, plan: outcome.plan, other: outcome.other, tier: outcome.tier });
      continue;
    }
    const result = outcome.result;
    count(codes, result.ok ? "value" : result.error.code);
    // A rule of the host for effects (CAP.HOOK) is outside check, thus such a machine skips this test.
    if (result.ok || config.machine.permits !== undefined) continue;
    const error = result.error;
    const same = sameInCheck(config.machine, doc, error, declared);
    if (!STATIC_CODES.has(error.code) && same === undefined) continue;
    const issues = check(config.machine, doc, { ...declared, names: Object.keys(ctx.names), caps: ctx.caps });
    if (STATIC_CODES.has(error.code) && issues.length === 0) {
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
      const machine = formulaMachine(STRICT, { evaluators: { [name]: mutant } });
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
