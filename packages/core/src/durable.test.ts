import { describe, expect, it } from "vitest";
import {
  type CompiledEvaluator,
  type Context,
  type FormulaProfile,
  type GenerateOptions,
  type HostThing,
  type Json,
  type Key,
  type Machine,
  type Random,
  Held,
  STD_MACHINE,
  THING,
  context,
  durable,
  factsOf,
  fail,
  formulaMachine,
  generate,
  isClosure,
  jsTruthy,
  ok,
  prepare,
  random,
  sameResult,
  typesOf,
} from "./index.ts";

/** The number of runs for each configuration of the property test. CI can raise it with COEVAL_DURABLE_COUNT. */
const COUNT = Number(process.env["COEVAL_DURABLE_COUNT"] ?? 200);

/** The number of commands in one run: reads, changes of data, edits and new machines. */
const STEPS = 40;

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

/** The rule of the tests for two results: a box compares its value, and two closures compare their parameters. */
function equal(a: unknown, b: unknown): boolean | undefined {
  if (a instanceof Box || b instanceof Box) return a instanceof Box && b instanceof Box && sameResult(ok(a.v), ok(b.v), equal);
  if (isClosure(a) || isClosure(b)) {
    const params = (value: unknown): unknown => (value as Readonly<Record<symbol, { readonly params: readonly string[] }>>)[Symbol.for("coeval.closure")]?.params;
    return isClosure(a) && isClosure(b) && JSON.stringify(params(a)) === JSON.stringify(params(b));
  }
  return undefined;
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item: unknown) => (typeof item === "function" ? "<fn>" : item === undefined ? "<undefined>" : item instanceof Held ? `<held ${item.error.code}>` : item));
  } catch {
    return String(value);
  }
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

const EXT: NonNullable<FormulaProfile["ext"]> = {
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

/* The data: names, host things, a reference in the data, a cycle, a function and a held error. */

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
  f: (value: unknown) => [value],
  err: new Held({ code: "#HELD", reason: "The binding failed." }),
};

/** The new values of a name. Each one differs from some names, and some are equal to an old value by structure. */
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

const SELVES: readonly unknown[] = [self, parent, null, { a: 1, width: 3, parent: null }, thing("node box", { width: 3, x: [1, 2], parent }, true, "box")];
const EVENTS: readonly unknown[] = [null, { a: 1, x: { a: 2 } }, { a: 2 }, [1, 2]];
const CAPS: readonly (readonly (readonly string[] | string)[])[] = [[], ["log"], ["log", "write"], [["log"]]];

const CONTEXTS: readonly Context[] = [
  context({ names: NAMES, caps: ["log", "write"], self, event: { a: 1, x: { a: 2 } } }),
  context({ names: NAMES, caps: [] }),
  context({ names: NAMES, caps: [["log"]], self: { a: 1, width: 3, parent: null }, event: [1, 2] }),
];

/** This function gives a new context with one or two changes: a name, `self`, `event` or the capabilities. */
function change(ctx: Context, rng: Random): Context {
  const names: Record<string, unknown> = { ...ctx.names };
  let next: Context = ctx;
  const count = 1 + rng.int(2);
  for (let step = 0; step < count; step += 1) {
    const what = rng.int(8);
    if (what < 5) {
      const name = rng.pick([...Object.keys(NAMES), "extra"]);
      if (rng.chance(0.15)) delete names[name];
      else names[name] = rng.pick(VALUES);
    } else if (what === 5) {
      next = { ...next, self: rng.pick(SELVES) };
    } else if (what === 6) {
      next = { ...next, event: rng.pick(EVENTS) };
    } else {
      next = { ...next, caps: rng.pick(CAPS) };
    }
  }
  return { ...next, names };
}

/* The configurations: each one has two machines that read the same documents. */

const MORE_REFS: readonly (readonly Key[])[] = Array.from({ length: 8 }, () => ["ref"]);
const OP_TYPES: readonly (readonly Key[])[] = [...Object.keys(OPS).map((name) => ["ops", name]), ["ops", "ifError"], ["ops", "second"]];
const EXT_TYPES: readonly (readonly Key[])[] = [["ext", "undefined"], ["ext", "number"], ["ext", "here"], ["ext", "count"]];

const strictMachine = formulaMachine(STRICT);
const looseMachine = formulaMachine(LOOSE);

const FORMULA_OPTIONS: Omit<GenerateOptions, "seed"> = {
  declaredType: "lit",
  names: Object.keys(NAMES),
  types: [...typesOf(strictMachine.world), ...OP_TYPES, ...EXT_TYPES, ...MORE_REFS, ["if"], ["and"], ["fn"], ["let"]],
  hints: (type, path) => (type[0] === "call" && path[0] === "fn" ? [["fn"], ["ref"]] : type[0] === "ops" && (type[1] === "map" || type[1] === "apply") ? [["fn"]] : undefined),
  data: (type, rng) => {
    const name = type.join(".");
    if (name === "ext.number") return rng.pick(["NaN", "-0", "Infinity", "bad"]);
    if (name === "lit" && rng.chance(0.1)) return ref("names", "a");
    return undefined;
  },
};

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
  readonly machines: readonly Machine[];
  readonly options: Omit<GenerateOptions, "seed">;
}

/** A copy of the standard machine: the same code, but another machine object, thus each plan compiles again. */
const stdCopy: Machine = { ...STD_MACHINE };

const CONFIGS: readonly Config[] = [
  { name: "formula", machines: [strictMachine, looseMachine], options: FORMULA_OPTIONS },
  { name: "standard", machines: [STD_MACHINE, stdCopy], options: STD_OPTIONS },
  { name: "trees", machines: [STD_MACHINE, stdCopy], options: TREE_OPTIONS },
];

/* The harness: a host with three nodes, and random commands. */

const KEYS: readonly string[] = ["p", "q", "r"];

interface Outcome {
  /** The reads whose result is not the same as a new evaluation (DURABLE.SOUND). */
  readonly stale: readonly string[];
  /** The reads that compiled a document that compiled before with the same machine (DURABLE.DATA). */
  readonly recompiled: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
}

/**
 * This function runs random commands against a durable cache, and it compares each result with a new evaluation.
 * A mutant host forgets to tell the cache each change of data, thus the harness can find stale results.
 */
function harness(config: Config, mutant = false, total: number = COUNT): Outcome {
  const stale: string[] = [];
  const recompiled: string[] = [];
  const counts: Record<string, number> = {};
  const add = (name: string, by = 1): void => {
    counts[name] = (counts[name] ?? 0) + by;
  };
  const declared = config.options.declaredType === undefined ? {} : { declaredType: config.options.declaredType };
  for (let index = 0; index < total; index += 1) {
    const seed = 7_000_003 + index;
    const rng = random(seed);
    let at = 0;
    let machine = config.machines[0] as Machine;
    const store = durable(machine, declared);
    let made = 0;
    const make = (): unknown => generate(machine.world, { ...config.options, seed: seed * 31 + made++ });
    const docs = new Map<string, unknown>(KEYS.map((key) => [key, make()]));
    let ctx = CONTEXTS[index % CONTEXTS.length] as Context;
    // The document objects that compiled with the machine now. A read of one of them compiles nothing.
    let compiled = new Set<unknown>();
    for (let step = 0; step < STEPS; step += 1) {
      const what = rng.int(12);
      if (what < 5) {
        const key = rng.pick(KEYS);
        const doc = docs.get(key);
        const before = store.counts.compiles;
        const result = store.evaluate(key, doc, ctx);
        add("reads");
        if (typeof doc === "object" && doc !== null) {
          if (compiled.has(doc) && store.counts.compiles !== before) recompiled.push(`${config.name} seed ${seed} step ${step}: ${show(doc)}`);
          compiled.add(doc);
        }
        const fresh = prepare(machine, doc, declared).evaluate(ctx);
        // A volatile document, or a result that is new at each evaluation, has no one result to compare.
        if (factsOf(machine, doc, declared).volatile || !sameResult(fresh, prepare(machine, doc, declared).evaluate(ctx), equal)) {
          add("unrepeatable");
          continue;
        }
        add("compared");
        if (!sameResult(result, fresh, equal)) stale.push(`${config.name} seed ${seed} step ${step}: ${show(result)} and then ${show(fresh)}\n  doc ${show(doc)}`);
      } else if (what < 8) {
        ctx = change(ctx, rng);
        if (!mutant) store.changeData();
        add("data");
      } else if (what === 8) {
        // A new context object with the same data, in the same data epoch.
        ctx = { ...ctx, names: { ...ctx.names } };
        add("copies");
      } else if (what === 9) {
        // A change of data that changes no value: each read verifies.
        store.changeData();
        add("empty");
      } else if (what === 10) {
        docs.set(rng.pick(KEYS), make());
        store.changeStructure();
        add("edits");
      } else {
        at = (at + 1) % config.machines.length;
        machine = config.machines[at] as Machine;
        store.changeStructure(machine);
        compiled = new Set();
        add("machines");
      }
    }
    const work = store.counts;
    add("evaluations", work.evaluations);
    add("verifications", work.verifications);
    add("reuses", work.reuses);
  }
  return { stale, recompiled, counts };
}

/* The rules on small documents. A compiled evaluator counts each compilation and each evaluation. */

let compiles = 0;
let runs = 0;
let hooks = 0;

/** This function makes a machine whose kind `tick` gives `value`, and counts the work of the kernel. */
function counting(value: number): Machine {
  const tick: CompiledEvaluator = {
    compile: () => {
      compiles += 1;
      return () => {
        runs += 1;
        return ok(value);
      };
    },
  };
  const base = formulaMachine(
    { ops: OPS, ext: EXT, pure: true },
    { world: { kinds: { tick: { verbs: { eval: "test.tick" }, pure: true } }, defaults: {} }, evaluators: { "test.tick": tick } },
  );
  const facts = base.facts;
  return {
    ...base,
    facts: (path, code) => {
      hooks += 1;
      return facts?.(path, code);
    },
  };
}

const TICK: Json = { type: "tick", value: null };
/** A pure document: it reads the name `a`. */
const PURE: Json = { type: "list", value: [TICK, ref("names", "a")] };
/** A document that is not pure: an extension of the profile reads the context outside `resolve`. */
const IMPURE: Json = { type: "list", value: [TICK, { type: ["ext", "count"], value: null }] };

describe("two levels of durability", () => {
  it("[DURABLE.EPOCHS] durable keeps one epoch for the structure and one for the data, and a change of the structure changes both", () => {
    const first = counting(1);
    const second = counting(2);
    const store = durable(first);
    expect(store.epochs).toEqual({ structure: 0, data: 0 });
    expect(store.machine).toBe(first);
    const kept = store.epochs;
    store.changeData();
    store.changeData();
    expect(store.epochs).toEqual({ structure: 0, data: 2 });
    // An edit of a document is a change of the structure, and also a change of the data of its readers.
    store.changeStructure();
    expect(store.epochs).toEqual({ structure: 1, data: 3 });
    expect(store.machine).toBe(first);
    store.changeStructure(second);
    expect(store.epochs).toEqual({ structure: 2, data: 4 });
    expect(store.machine).toBe(second);
    // The epochs are a snapshot: an object that a schedule keeps does not change.
    expect(kept).toEqual({ structure: 0, data: 0 });
  });

  it("[DURABLE.DATA] a change of data compiles nothing and computes no facts, a pure document verifies its reads, and another document evaluates again", () => {
    const store = durable(counting(1));
    compiles = 0;
    hooks = 0;
    expect(store.evaluate("p", PURE, context({ names: { a: 1, b: 2 } }))).toEqual(ok([1, 1]));
    expect(store.evaluate("q", IMPURE, context({ names: { a: 1, b: 2 } }))).toEqual(ok([1, 2]));
    expect(compiles).toBe(2);
    const facts = hooks;
    expect(facts).toBeGreaterThan(0);

    // A change of data that the pure document does not read: it keeps its result without an evaluation.
    store.changeData();
    runs = 0;
    const next = context({ names: { a: 1, b: 3, c: 4 } });
    expect(store.evaluate("p", PURE, next)).toEqual(ok([1, 1]));
    expect(runs).toBe(0);
    // The extension reads outside resolve, thus the document is not pure, and it evaluates again.
    expect(store.evaluate("q", IMPURE, next)).toEqual(ok([1, 3]));
    expect(runs).toBe(1);

    // A change of data that the pure document reads: it evaluates again.
    store.changeData();
    expect(store.evaluate("p", PURE, context({ names: { a: 5 } }))).toEqual(ok([1, 5]));
    expect(runs).toBe(2);

    // No change of data compiled a document or computed its facts.
    expect(compiles).toBe(2);
    expect(hooks).toBe(facts);
    expect(store.counts).toEqual({ compiles: 2, facts: 2, evaluations: 4, verifications: 2, reuses: 1 });

    // The rule of the host for two things goes to verifyReads: two dates with the same time are the same.
    const time = (a: unknown, b: unknown): boolean | undefined => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : undefined);
    const dates = durable(counting(1), { equal: time });
    const plain = durable(counting(1));
    const read = ref("names", "when");
    for (const cache of [dates, plain]) cache.evaluate("d", read, context({ names: { when: new Date(0) } }));
    for (const cache of [dates, plain]) cache.changeData();
    for (const cache of [dates, plain]) cache.evaluate("d", read, context({ names: { when: new Date(0) } }));
    expect(dates.counts).toMatchObject({ evaluations: 1, reuses: 1 });
    expect(plain.counts).toMatchObject({ evaluations: 2, reuses: 0 });
  });

  it("[DURABLE.STRUCTURE] an edit compiles only the new document, and a new machine drops each plan, each fact and each result", () => {
    const store = durable(counting(1));
    const other: Json = { type: "list", value: [TICK, ref("names", "b")] };
    const ctx = context({ names: { a: 1, b: 2 } });
    store.evaluate("p", PURE, ctx);
    store.evaluate("q", other, ctx);
    const plan = store.plan(PURE);
    const facts = store.facts(PURE);
    compiles = 0;

    // An edit gives a new document object for the node q. Only that document compiles.
    const edited: Json = { type: "list", value: [TICK, ref("names", "a"), ref("names", "b")] };
    store.changeStructure();
    expect(store.evaluate("q", edited, ctx)).toEqual(ok([1, 1, 2]));
    expect(store.evaluate("p", PURE, ctx)).toEqual(ok([1, 1]));
    expect(compiles).toBe(1);
    expect(store.plan(PURE)).toBe(plan);
    expect(store.facts(PURE)).toBe(facts);
    expect(store.counts).toMatchObject({ compiles: 3, facts: 3 });

    // A new machine drops each plan, each fact and each result. Each result follows the new machine.
    store.changeStructure(counting(2));
    expect(store.evaluate("p", PURE, ctx)).toEqual(ok([2, 1]));
    expect(store.plan(PURE)).not.toBe(plan);
    expect(store.facts(PURE)).not.toBe(facts);
    expect(compiles).toBe(2);

    // A value document has its own plan, also -0 beside 0.
    const values = durable(counting(1), { declaredType: "lit" });
    expect(values.plan(0)).not.toBe(values.plan(-0));
    expect(values.plan(-0)).toBe(values.plan(-0));
    const zero = values.evaluate("z", -0, context());
    expect(zero.ok && Object.is(zero.value, -0)).toBe(true);
  });

  it("[DURABLE.REUSE] in one data epoch a key gives its result again without an evaluation, and each key has its own result", () => {
    const store = durable(counting(1));
    runs = 0;
    expect(store.evaluate("p", PURE, context({ names: { a: 1 } }))).toEqual(ok([1, 1]));
    // A new context object with the same data, in the same data epoch, keeps the result.
    expect(store.evaluate("p", PURE, context({ names: { a: 1 } }))).toEqual(ok([1, 1]));
    expect(runs).toBe(1);
    // One document at two nodes: each key has its own result, as one formula at each cell of a grid.
    expect(store.evaluate("cell 2", PURE, context({ names: { a: 2 } }))).toEqual(ok([1, 2]));
    expect(store.evaluate("p", PURE, context({ names: { a: 1 } }))).toEqual(ok([1, 1]));
    expect(runs).toBe(2);
    // Another document at the same key evaluates.
    expect(store.evaluate("p", IMPURE, context({ names: { a: 1 } }))).toEqual(ok([1, 1]));
    expect(runs).toBe(3);
    // forget drops the result of a key.
    store.forget("cell 2");
    expect(store.evaluate("cell 2", PURE, context({ names: { a: 2 } }))).toEqual(ok([1, 2]));
    expect(runs).toBe(4);
    expect(store.counts).toMatchObject({ compiles: 2, evaluations: 4, reuses: 2, verifications: 0 });
  });
});

describe("two levels of durability with generated documents", () => {
  it("[DURABLE.SOUND] after random edits, new machines and changes of data, each result is the same as a new evaluation", () => {
    for (const config of CONFIGS) {
      const outcome = harness(config);
      expect(outcome.stale.slice(0, 3), `${config.name}: ${show(outcome.counts)}`).toEqual([]);
      expect(outcome.recompiled.slice(0, 3), config.name).toEqual([]);
      // The harness reaches each command and each answer of the cache.
      for (const name of ["compared", "data", "copies", "empty", "edits", "machines", "verifications", "reuses"]) {
        expect(outcome.counts[name] ?? 0, `${config.name}: ${name}`).toBeGreaterThan(COUNT);
      }
      expect(outcome.counts["compared"] ?? 0, config.name).toBeGreaterThan(COUNT * 10);
    }
    // A host that does not tell the cache a change of data gets stale results, and the harness finds them.
    expect(harness(CONFIGS[0] as Config, true, COUNT / 2).stale.length).toBeGreaterThan(0);
  }, 120_000);
});
