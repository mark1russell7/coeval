import { describe, expect, it } from "vitest";
import {
  type CompiledEvaluator,
  type Context,
  type DerefCode,
  type Envelope,
  type HostThing,
  type Json,
  type Key,
  type Machine,
  type Navigator,
  type Read,
  type Resolution,
  type Runtime,
  type Walker,
  type World,
  Held,
  THING,
  context,
  evaluate,
  formulaMachine,
  isHostThing,
  isRecord,
  ok,
  prepare,
  random,
  resolve,
  worldThing,
} from "./index.ts";
import { compilePath } from "./deref.ts";
import { resolveCompiled } from "./evaluate.ts";

/** The number of random paths of the property test. CI can raise it with COEVAL_PATHS_COUNT. */
const COUNT = Number(process.env["COEVAL_PATHS_COUNT"] ?? 4000);

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });

/** The calls of the host, in their order. The host things and the code of the navigators write into it. */
let calls: string[] = [];

function host(label: string, fields: Readonly<Record<string, unknown>>, options: { readonly resolve?: boolean; readonly has?: boolean; readonly gives?: unknown } = {}): HostThing {
  const base: HostThing = {
    [THING]: true,
    label,
    deref: (key: Key) => {
      calls.push(`${label}.deref(${String(key)})`);
      return Object.hasOwn(fields, String(key)) ? fields[String(key)] : undefined;
    },
    toJson: () => fields,
  };
  const has = options.has === true ? { has: (key: Key) => (calls.push(`${label}.has(${String(key)})`), Object.hasOwn(fields, String(key))) } : {};
  if (options.resolve !== true) return { ...base, ...has };
  return {
    ...base,
    ...has,
    resolve: (keys: readonly Key[]) => {
      calls.push(`${label}.resolve(${keys.join(".")})`);
      if (options.gives !== undefined) return { thing: options.gives };
      let here: unknown = fields;
      for (const key of keys) {
        if (typeof here !== "object" || here === null || !Object.hasOwn(here, String(key))) return undefined;
        here = (here as Record<string, unknown>)[String(key)];
      }
      return { thing: here };
    },
  };
}

/* The navigators: worlds with and without defaults, the code of deref and step, plain, closed roots and adopt. */

const DEREFS: Readonly<Record<string, DerefCode>> = {
  "d.kind": (doc, key) => (calls.push(`d.kind(${String(key)})`), key === "x" ? `kind x of ${JSON.stringify(doc.value)}` : undefined),
  "d.own": (_doc, key) => (calls.push(`d.own(${String(key)})`), `own ${String(key)}`),
  "d.default": (_doc, key) => (calls.push(`d.default(${String(key)})`), key === "y" ? "default y" : undefined),
  // A code with has gives a field that holds undefined (DEREF.KIND-UNDEFINED).
  "d.held": Object.assign((doc: Envelope, key: Key) => (calls.push(`d.held(${String(key)})`), fieldOf(doc, key)), {
    has: (doc: Envelope, key: Key) => (calls.push(`d.held.has(${String(key)})`), isRecord(doc.value) && Object.hasOwn(doc.value, String(key))),
  }),
};

/** This function gives a field of the value of a document, or `undefined`. */
function fieldOf(doc: Envelope, key: Key): unknown {
  return isRecord(doc.value) && Object.hasOwn(doc.value, String(key)) ? (doc.value as Record<string, unknown>)[String(key)] : undefined;
}

const WALKERS: Readonly<Record<string, Walker>> = {
  "walk.at": ({ data, here, deref, has }) => {
    calls.push(`walk.at(${JSON.stringify(data)})`);
    if (typeof data !== "string" && typeof data !== "number") return { ok: false, reason: "The step needs a key." };
    const reached = deref(here, data);
    // The walker tells a field that holds undefined with has (DEREF.WALKER-UNDEFINED).
    return reached === undefined && has?.(here, data) !== true ? { ok: false, reason: `No field ${String(data)}.`, code: "#REF!" } : { ok: true, thing: reached };
  },
  "walk.same": ({ here }) => (calls.push("walk.same"), { ok: true, thing: here }),
};

const KINDS: World["kinds"] = {
  point: { verbs: { deref: "d.kind" } },
  held: { verbs: { deref: "d.held" } },
  flat: { verbs: {} },
  moves: { kinds: {}, fallback: { verbs: { step: "walk.at" } } },
  spot: { type: "ref", value: ["world", "point"] },
};

const PLAIN_WORLD: World = { kinds: KINDS, defaults: {} };
const DEFAULT_WORLD: World = { kinds: KINDS, defaults: { deref: "d.default", step: "walk.same" } };

/** This function adopts each record with the field `a` as a host thing, as a host with signals does. */
function adopt(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isHostThing(value) || !Object.hasOwn(value, "a")) return value;
  return host("adopted", value as Record<string, unknown>);
}

const NAVIGATORS: readonly Navigator[] = [
  { world: PLAIN_WORLD },
  { world: PLAIN_WORLD, derefs: DEREFS, walkers: WALKERS },
  { world: DEFAULT_WORLD, derefs: DEREFS, walkers: WALKERS },
  { world: PLAIN_WORLD, derefs: DEREFS, walkers: WALKERS, plain: true },
  { world: DEFAULT_WORLD, derefs: DEREFS, roots: ["names", "self"] },
  { world: PLAIN_WORLD, derefs: DEREFS, walkers: WALKERS, adopt },
];

/* The contexts: hard values, envelopes, references in the data, a cycle and host things. */

const NAMES: Readonly<Record<string, unknown>> = {
  a: 1,
  b: [10, "two", null],
  x: { a: 1, b: { c: 2 } },
  n: Number.NaN,
  z: -0,
  u: undefined,
  proto: JSON.parse('{"__proto__": 5, "a": 2}') as unknown,
  p: { type: "point", value: { x: 1, y: 2 } },
  hu: { type: "held", value: { a: 1, u: undefined } },
  q: { type: "point", value: { x: 1 }, own: { deref: "d.own" } },
  s: { type: "spot", value: { x: 3 } },
  e: { type: "flat", value: [1, 2] },
  unk: { type: "nope", value: { x: 9 } },
  typed: { type: "point", other: 1 },
  tref: { type: "ref", value: "no list" },
  hop: ref("names", "a"),
  loop: ref("names", "loop"),
  deep: ref("names", "x", "b"),
  h: host("h", { a: { b: 1 }, u: undefined, r: ref("names", "a") }, { resolve: true, has: true }),
  k: host("k", { a: 3, u: undefined }),
  r: host("r", {}, { resolve: true, gives: ref("names", "x") }),
  held: new Held({ code: "#HELD", reason: "The binding failed." }),
  arr: [[1, [2]], { a: [3] }],
};

const CONTEXTS: readonly Context[] = [
  context({ names: NAMES, self: host("self", { a: 1, width: 2 }, { resolve: true }), event: [1, { a: 2 }], world: worldThing(PLAIN_WORLD) }),
  context({ names: NAMES, self: { a: { b: 1 }, width: 3 }, event: null, world: host("store", { n1: { value: 42 } }, { resolve: true }) }),
];

const ROOT_STEPS: readonly unknown[] = ["names", "names", "names", "self", "event", "world", "caps", "nope", 3];

const STEPS: readonly unknown[] = [
  ...Object.keys(NAMES),
  "c",
  "y",
  "value",
  "type",
  "length",
  "__proto__",
  "width",
  "n1",
  "point",
  "verbs",
  0,
  1,
  2,
  "0",
  "1",
  -0,
  1.5,
  -1,
  null,
  { type: ["moves", "at"], value: 0 },
  { type: ["moves", "at"], value: "a" },
  { type: ["moves", "at"], value: "x", own: { step: "walk.same" } },
  { type: "point", value: 1 },
  { type: "nope", value: 1 },
];

/** This function gives a random path: a root, then up to four steps. Some paths are empty. */
function randomPath(seed: number): readonly unknown[] {
  const rng = random(seed);
  if (rng.chance(0.02)) return [];
  const path: unknown[] = [rng.pick(ROOT_STEPS)];
  const count = rng.int(5);
  for (let index = 0; index < count; index += 1) path.push(rng.pick(STEPS));
  return path;
}

/** This function gives a short text of a thing. An adopted thing compares by the value under it. */
function thingText(thing: unknown): unknown {
  return isHostThing(thing) && thing.label === "adopted" ? ["adopted", thing.toJson()] : thing;
}

/** This function tells the first difference of two resolutions without hops, or `undefined`. */
function differs(a: Resolution, b: Resolution): string | undefined {
  if (a.ok !== b.ok) return `ok ${String(a.ok)} and ${String(b.ok)}`;
  if (a.ok && b.ok) {
    const [x, y] = [thingText(a.thing), thingText(b.thing)];
    if (Array.isArray(x) && Array.isArray(y)) return Object.is(x[1], y[1]) ? undefined : "another adopted value";
    return Object.is(x, y) ? undefined : `the things ${String(x)} and ${String(y)}`;
  }
  if (!a.ok && !b.ok && (a.code !== b.code || a.reason !== b.reason)) return `the errors ${a.code} ${a.reason} and ${b.code} ${b.reason}`;
  return undefined;
}

/** This function resolves a path, and gives the resolution and the calls of the host. */
function traced(run: () => Resolution): { readonly found: Resolution | string; readonly calls: readonly string[] } {
  calls = [];
  let found: Resolution | string;
  try {
    found = run();
  } catch (error) {
    found = `threw ${String(error)}`;
  }
  return { found, calls };
}

describe("compiled paths", () => {
  it("[PLAN.PATH] a static path compiles at prepare time: the ladder of step answers one time, and each evaluation walks the values", () => {
    let asked = 0;
    // The table of the walkers counts each question of the ladder.
    const walkers = new Proxy(WALKERS, {
      getOwnPropertyDescriptor: (target, key) => {
        asked += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const base = formulaMachine({}, { world: { kinds: { moves: KINDS["moves"] as never }, defaults: {} } });
    const machine: Machine = { ...base, walkers };
    const doc = ref("names", "b", { type: ["moves", "at"], value: 1 });
    const ctx = context({ names: NAMES });
    const plan = prepare(machine, doc);
    const once = asked;
    expect(once).toBeGreaterThan(0);
    for (let index = 0; index < 3; index += 1) expect(plan.evaluate(ctx)).toEqual({ ok: true, value: "two" });
    expect(asked).toBe(once);
    // A trace records the hops, thus it resolves the steps again, and the ladder answers at each evaluation.
    expect(evaluate(machine, doc, ctx).result).toEqual({ ok: true, value: "two" });
    expect(asked).toBeGreaterThan(once);
  });

  it("[PLAN.PATH] the list of reads records the steps of the document, and a compiled path gives the resolution of resolve", () => {
    const doc = { type: "ref", value: ["names", "x", "b", "c"] };
    const ctx = context({ names: NAMES });
    const reads: Read[] = [];
    expect(prepare(formulaMachine(), doc).evaluate(ctx, { reads })).toEqual({ ok: true, value: 2 });
    expect(reads).toHaveLength(1);
    expect(reads[0]?.path).toBe(doc.value);
    const nav: Navigator = { world: PLAIN_WORLD };
    for (const path of [["names", "x", "b", "c"], ["names", "h", "a", "b"], ["names", "nope"], ["caps"], ["nope", "a"], []]) {
      expect(compilePath(nav, path).resolve(ctx)).toEqual(resolve(nav, ctx, path, { hops: false }));
    }
  });

  it("[PLAN.PATH] a runtime of another navigator resolves the steps again, and a runtime that wraps the kernel gets the steps", () => {
    // The evaluator compiles its path for a navigator that closes the root names.
    const closed: Navigator = { world: PLAIN_WORLD, roots: ["self"] };
    const probe: CompiledEvaluator = {
      compile: ({ doc }) => {
        const compiled = compilePath(closed, doc.value as readonly unknown[]);
        return (ctx, rt) => {
          const found = resolveCompiled(rt, ctx, compiled);
          return found.ok ? { ok: true, value: found.thing } : { ok: false, error: { code: found.code, reason: found.reason } };
        };
      },
    };
    const machine = formulaMachine({}, { world: { kinds: { probe: { verbs: { eval: "test.probe" } } }, defaults: {} }, evaluators: { "test.probe": probe } });
    const ctx = context({ names: { a: 7 } });
    expect(compilePath(closed, ["names", "a"]).resolve(ctx)).toMatchObject({ ok: false, code: "#REF!" });
    expect(prepare(machine, { type: "probe", value: ["names", "a"] }).evaluate(ctx)).toEqual({ ok: true, value: 7 });
    const seen: unknown[] = [];
    const rt: Runtime = {
      machine,
      running: false,
      resolve: (c: Context, path: readonly unknown[]) => (seen.push(path), resolve(machine, c, path, { hops: false })),
      effect: () => ok(null),
      runEffect: function* () {
        return ok(null);
      },
      all: function* () {
        return [];
      },
    };
    const compiled = compilePath(machine, ["names", "a"]);
    expect(resolveCompiled(rt, ctx, compiled)).toMatchObject({ ok: true, thing: 7 });
    expect(seen).toEqual([compiled.path]);
  });

  /**
   * This function compares a compiled path with resolve without hops and with hops, and writes each difference.
   *
   * @returns The resolution of the compiled path, or `undefined` when a resolution threw.
   */
  function compare(nav: Navigator, ctx: Context, path: readonly unknown[], where: string, differences: string[]): Resolution | undefined {
    const dynamic = traced(() => resolve(nav, ctx, path, { hops: false }));
    const compiled = compilePath(nav, path);
    const fast = traced(() => compiled.resolve(ctx));
    const full = traced(() => resolve(nav, ctx, path));
    if (typeof dynamic.found === "string" || typeof fast.found === "string" || typeof full.found === "string") {
      if (dynamic.found !== fast.found) differences.push(`${where}: ${String(dynamic.found)} and ${String(fast.found)}`);
      return undefined;
    }
    const reason = differs(dynamic.found, fast.found) ?? differs(full.found, fast.found);
    if (reason !== undefined) differences.push(`${where}: ${reason}`);
    if (JSON.stringify(dynamic.calls) !== JSON.stringify(fast.calls)) differences.push(`${where}: the calls ${dynamic.calls.join(" ")} and ${fast.calls.join(" ")}`);
    if (fast.found.hops.length !== 0) differences.push(`${where}: hops`);
    return fast.found;
  }

  it("[PLAN.PATH-SAME] a compiled path gives the thing, the error, the reason and the calls of the host of resolve without hops, for random paths", () => {
    const differences: string[] = [];
    let quick = 0;
    for (let index = 0; index < COUNT; index += 1) {
      const path = randomPath(31_000_017 + index);
      const nav = NAVIGATORS[index % NAVIGATORS.length] as Navigator;
      const ctx = CONTEXTS[Math.floor(index / NAVIGATORS.length) % CONTEXTS.length] as Context;
      const found = compare(nav, ctx, path, `path ${JSON.stringify(path)}, navigator ${index % NAVIGATORS.length}`, differences);
      if (found?.ok === true) quick += 1;
    }
    expect(differences.slice(0, 5)).toEqual([]);
    // The paths reach values and errors in each navigator.
    expect(quick).toBeGreaterThan(COUNT / 10);
    expect(quick).toBeLessThan(COUNT - COUNT / 10);
  });
  it("[DEREF.KIND-UNDEFINED] [DEREF.WALKER-UNDEFINED] a compiled path and resolve agree on a field that holds undefined, in each navigator", () => {
    const at = (key: string): Json => ({ type: ["moves", "at"], value: key });
    const paths: readonly (readonly unknown[])[] = [
      ["names", "hu", "u"],
      ["names", "hu", "nope"],
      ["names", "hu", "a"],
      ["names", "hu", at("u")],
      ["names", "h", at("u")],
      ["names", "k", at("u")],
      ["names", "x", at("nope")],
    ];
    const differences: string[] = [];
    const answers: unknown[] = [];
    for (const [index, nav] of NAVIGATORS.entries()) {
      for (const path of paths) {
        const found = compare(nav, CONTEXTS[0] as Context, path, `path ${JSON.stringify(path)}, navigator ${index}`, differences);
        if (index === 1) answers.push(found === undefined ? "threw" : found.ok ? found.thing : found.code);
      }
    }
    expect(differences).toEqual([]);
    // The code of the kind and the walker tell the field that holds undefined. The thing k has no has, thus it keeps the old reading.
    expect(answers).toEqual([undefined, "#N/A", 1, undefined, undefined, "#REF!", "#REF!"]);
  });
});

describe("the memo of the kinds", () => {
  /** This function gives a world whose kinds count each lookup of a key. */
  function counted(defaults: Readonly<Record<string, string>> = {}): { readonly world: World; readonly lookups: () => number } {
    let lookups = 0;
    const kinds = new Proxy(KINDS, {
      getOwnPropertyDescriptor: (target, key) => {
        lookups += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    return { world: { kinds, defaults }, lookups: () => lookups };
  }

  it("[PLAN.KIND-MEMO] a step on an envelope looks up the kind of its type one time for each world", () => {
    const { world, lookups } = counted();
    const nav: Navigator = { world, derefs: DEREFS, walkers: WALKERS };
    const ctx = context({ names: NAMES });
    expect(resolve(nav, ctx, ["names", "p", "x"])).toMatchObject({ ok: true, thing: "kind x of {\"x\":1,\"y\":2}" });
    const first = lookups();
    expect(first).toBeGreaterThan(0);
    expect(resolve(nav, ctx, ["names", "p", "x"])).toMatchObject({ ok: true, thing: "kind x of {\"x\":1,\"y\":2}" });
    expect(resolve(nav, ctx, ["names", "s", "x"], { hops: false })).toMatchObject({ ok: true, thing: "kind x of {\"x\":3}" });
    const aliased = lookups();
    expect(aliased).toBeGreaterThan(first);
    // The type of a step document is looked up one time too.
    expect(resolve(nav, context({ names: { b: [1, 2] } }), ["names", "b", { type: ["moves", "at"], value: 1 }])).toMatchObject({ ok: true, thing: 2 });
    const stepped = lookups();
    expect(resolve(nav, context({ names: { b: [1, 2] } }), ["names", "b", { type: ["moves", "at"], value: 0 }])).toMatchObject({ ok: true, thing: 1 });
    expect(resolve(nav, ctx, ["names", "s", "x"])).toMatchObject({ ok: true });
    expect(lookups()).toBe(stepped);
  });

  it("[PLAN.KIND-MEMO] the memo keeps the ladder of deref and step: own, then kind, then default, and an unknown kind stops it", () => {
    for (let turn = 0; turn < 2; turn += 1) {
      const nav: Navigator = { world: DEFAULT_WORLD, derefs: DEREFS, walkers: WALKERS };
      const ctx = context({ names: NAMES });
      const by = (path: readonly unknown[]): unknown => {
        const found = resolve(nav, ctx, path);
        return found.ok ? [found.thing, found.hops.at(-1)?.by] : found.code;
      };
      expect(by(["names", "q", "z"])).toEqual(["own z", "own"]);
      expect(by(["names", "p", "x"])).toEqual(["kind x of {\"x\":1,\"y\":2}", "kind"]);
      expect(by(["names", "e", "y"])).toEqual(["default y", "default"]);
      expect(by(["names", "e", 0])).toBe("#N/A");
      // The world does not have the kind nope: no rung answers, and the step goes into the value.
      expect(by(["names", "unk", "x"])).toEqual([9, "default"]);
      expect(by(["names", "b", { type: "point", value: 1 }])).toEqual([NAMES["b"], "step"]);
      expect(resolve({ ...nav, world: PLAIN_WORLD }, ctx, ["names", "b", { type: "point", value: 1 }])).toMatchObject({ ok: false, code: "#STEP?" });
      expect(resolve({ ...nav, world: PLAIN_WORLD }, ctx, ["names", "e", "y"])).toMatchObject({ ok: false, code: "#N/A" });
    }
  });

  it("[PLAN.KIND-MEMO] each world has its own memo, and a full memo starts again with the same answers", () => {
    const other: World = { kinds: { point: { verbs: { deref: "d.own" } } }, defaults: {} };
    const ctx = context({ names: NAMES });
    expect(resolve({ world: PLAIN_WORLD, derefs: DEREFS }, ctx, ["names", "p", "x"])).toMatchObject({ ok: true, thing: "kind x of {\"x\":1,\"y\":2}" });
    expect(resolve({ world: other, derefs: DEREFS }, ctx, ["names", "p", "x"])).toMatchObject({ ok: true, thing: "own x" });
    const { world, lookups } = counted();
    const nav: Navigator = { world, derefs: DEREFS };
    const names: Record<string, unknown> = {};
    for (let index = 0; index < 1500; index += 1) names[`t${index}`] = { type: `t${index}`, value: { x: index } };
    for (let index = 0; index < 1500; index += 1) expect(resolve(nav, context({ names }), ["names", `t${index}`, "x"], { hops: false })).toMatchObject({ ok: true, thing: index });
    expect(resolve(nav, ctx, ["names", "p", "x"])).toMatchObject({ ok: true, thing: "kind x of {\"x\":1,\"y\":2}" });
    const before = lookups();
    expect(resolve(nav, ctx, ["names", "p", "x"])).toMatchObject({ ok: true });
    expect(lookups()).toBe(before);
  });
});
