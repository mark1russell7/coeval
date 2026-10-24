import { describe, expect, it } from "vitest";
import {
  type DerefCode,
  type EvalFn,
  type Json,
  type Key,
  type Kind,
  type Machine,
  type MachinePart,
  type MergeConflict,
  type Random,
  type Runner,
  type Walker,
  type World,
  type WorldEntry,
  type WorldPart,
  MergeError,
  STD_EVALUATORS,
  STD_MACHINE,
  STD_WORLD,
  check,
  context,
  docEquals,
  fail,
  formulaKinds,
  formulaMachine,
  lookupKind,
  mergeMachines,
  mergeWorlds,
  ok,
  prepare,
  random,
  restrictMachine,
  restrictWorld,
} from "./index.ts";

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

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

const alias = (...path: Key[]): WorldEntry => ({ type: "ref", value: ["world", ...path] });
const op = (name: string, ...args: Json[]): Json => ({ type: ["ops", ...name.split(".")], value: args });

const num: Kind = { verbs: { eval: "data.number" }, summary: "A number." };
const txt: Kind = { verbs: { eval: "data.text" }, summary: "A text." };
const call: Kind = { verbs: { eval: "data.text" }, effects: "type" };
const deep: Kind = { verbs: { eval: "formula.ref" }, parts: { shape: "deep" } };

const one: EvalFn = () => ok(1);
const two: EvalFn = () => ok(2);
const runner: Runner = function* () {
  return ok("runner");
};

describe("the merge of worlds", () => {
  it("[WORLD.MERGE] equal entries give one entry, namespaces merge key by key with their fallbacks, and the defaults merge by verb", () => {
    const add: Kind = { verbs: { eval: "formula.op" }, summary: "add" };
    const neg: Kind = { verbs: { eval: "formula.op" }, summary: "neg" };
    const fallback: Kind = { verbs: { eval: "formula.op" } };
    const a: World = deepFreeze({ kinds: { number: num, ops: { kinds: { add }, fallback }, sum: alias("ops", "add") }, defaults: { view: "view.card" } });
    const b: WorldPart = deepFreeze({
      // A copy is equal by docEquals, and a field with the value undefined is absent, as in JSON.
      kinds: { number: { ...num, side: undefined } as unknown as Kind, ops: { kinds: { neg } }, sum: alias("ops", "add"), text: txt },
      defaults: { view: "view.card", format: "format.plain" },
      fallback: call,
    });
    const merged = mergeWorlds(a, b);
    expect(merged.kinds["number"]).toBe(num);
    expect(Object.keys(merged.kinds)).toEqual(["number", "ops", "sum", "text"]);
    expect(lookupKind(merged, ["ops", "add"])).toMatchObject({ ok: true, kind: add });
    expect(lookupKind(merged, ["ops", "neg"])).toMatchObject({ ok: true, kind: neg });
    // The fallback of the namespace stays, and the world keeps the fallback of the later part.
    expect(lookupKind(merged, ["ops", "mul"])).toMatchObject({ ok: true, kind: fallback });
    expect(lookupKind(merged, ["sum"])).toMatchObject({ ok: true, kind: add, aliases: 1 });
    expect(lookupKind(merged, ["git", "status"])).toMatchObject({ ok: true, kind: call });
    expect(merged.defaults).toEqual({ view: "view.card", format: "format.plain" });
    // A merge does not change its parts, and a merge of one world gives an equal world.
    expect(docEquals(mergeWorlds(a), a)).toBe(true);
    expect(mergeWorlds()).toEqual({ kinds: {}, defaults: {} });
  });

  it("[WORLD.CONFLICT] two different entries at one path are a conflict, and the merge throws one error with each conflict", () => {
    const parts: readonly WorldPart[] = [
      { kinds: { x: num, y: num, ns: { kinds: {}, fallback: num }, al: alias("x"), same: num }, defaults: { view: "view.a" }, fallback: num },
      { kinds: { x: txt, y: { kinds: {} }, ns: { kinds: {}, fallback: txt }, al: alias("y"), same: num }, defaults: { view: "view.b" }, fallback: txt },
    ];
    expect(conflictsOf(() => mergeWorlds(...parts))).toEqual([
      { path: ["kinds", "x"], parts: [0, 1], reason: "Two parts give two different kinds." },
      { path: ["kinds", "y"], parts: [0, 1], reason: "One part gives a kind, and the other part gives a namespace." },
      { path: ["kinds", "ns", "fallback"], parts: [0, 1], reason: "Two parts give two different fallback kinds." },
      { path: ["kinds", "al"], parts: [0, 1], reason: "Two parts give two different aliases." },
      { path: ["defaults", "view"], parts: [0, 1], reason: "Two parts give two different defaults for this verb." },
      { path: ["fallback"], parts: [0, 1], reason: "Two parts give two different fallback kinds." },
    ]);
    expect(() => mergeWorlds(...parts)).toThrow('The merge has 6 conflicts. At ["kinds","x"], the parts 0 and 1: Two parts give two different kinds.');
    // A conflict names the part that gave the earlier entry, also inside a namespace.
    expect(conflictsOf(() => mergeWorlds({ kinds: { a: num } }, { kinds: { b: num, ns: { kinds: { c: num } } } }, { kinds: { b: txt, ns: { kinds: { c: txt } } } }))).toEqual([
      { path: ["kinds", "b"], parts: [1, 2], reason: "Two parts give two different kinds." },
      { path: ["kinds", "ns", "kinds", "c"], parts: [1, 2], reason: "Two parts give two different kinds." },
    ]);
    // The formula kit and the standard world both have the kinds list, if and ref.
    expect(conflictsOf(() => mergeWorlds({ kinds: formulaKinds() }, STD_WORLD)).map((item) => item.path)).toEqual([
      ["kinds", "list"],
      ["kinds", "if"],
      ["kinds", "ref"],
    ]);
  });

  it("[WORLD.REPLACE] a part names the paths that it replaces, and a part can be a function of the merge before it", () => {
    const kit = { kinds: formulaKinds() };
    const replaced = mergeWorlds(kit, { kinds: { ref: deep }, replaces: [["kinds", "ref"]] });
    expect(replaced.kinds["ref"]).toBe(deep);
    expect(Object.hasOwn(replaced, "replaces")).toBe(false);
    // A namespace that replaces wins whole, with no merge below it: the fallback of the kit goes.
    const ops = mergeWorlds(kit, { kinds: { ops: { kinds: { add: num } } }, replaces: [["kinds", "ops"]] });
    expect(lookupKind(ops, ["ops", "add"])).toMatchObject({ ok: true, kind: num });
    expect(lookupKind(ops, ["ops", "mul"])).toMatchObject({ ok: false, reason: "unknown" });
    // A fallback, a default and the fallback of the world can be replaced too.
    const earlier: WorldPart = { kinds: { ns: { kinds: {}, fallback: num } }, defaults: { view: "view.a" }, fallback: num };
    const later: WorldPart = { kinds: { ns: { kinds: {}, fallback: txt } }, defaults: { view: "view.b" }, fallback: txt, replaces: [["kinds", "ns", "fallback"], ["defaults", "view"], ["fallback"]] };
    expect(mergeWorlds(earlier, later)).toEqual({ kinds: { ns: { kinds: {}, fallback: txt } }, defaults: { view: "view.b" }, fallback: txt });
    // A path that replaces nothing is not a problem. A mark on the earlier part does not replace a later entry.
    expect(mergeWorlds({ kinds: { a: num }, replaces: [["kinds", "zzz"]] })).toEqual({ kinds: { a: num }, defaults: {} });
    expect(conflictsOf(() => mergeWorlds({ kinds: { ref: deep }, replaces: [["kinds", "ref"]] }, kit)).map((item) => item.path)).toEqual([["kinds", "ref"]]);
    // After a replacement, a later part merges with the new entry, and a conflict names the part that replaced.
    expect(conflictsOf(() => mergeWorlds(kit, { kinds: { ref: deep }, replaces: [["kinds", "ref"]] }, { kinds: { ref: formulaKinds()["ref"] as Kind } }))).toEqual([
      { path: ["kinds", "ref"], parts: [1, 2], reason: "Two parts give two different kinds." },
    ]);
    // A function of the merge before it reads the entry that it replaces (prev, as an overlay of Nix).
    const extended = mergeWorlds(kit, (prev) => ({ kinds: { ref: { ...(prev.kinds["ref"] as Kind), parts: { shape: "deep" } } }, replaces: [["kinds", "ref"]] }));
    expect(extended.kinds["ref"]).toEqual({ ...(formulaKinds()["ref"] as Kind), parts: { shape: "deep" } });
    expect(mergeWorlds((prev) => ({ kinds: { size: { verbs: { eval: String(Object.keys(prev.kinds).length) } } } }))).toEqual({ kinds: { size: { verbs: { eval: "0" } } }, defaults: {} });
  });
});

/* Random parts for the laws of the merge. The pools are small, thus two parts often share a path. */

const LEAVES: readonly WorldEntry[] = [num, txt, { ...num }, alias("a"), alias("b")];

function randomNamespace(rng: Random, depth: number): WorldEntry {
  const kinds: Record<string, WorldEntry> = {};
  for (const key of ["p", "q"]) if (rng.chance(0.5)) kinds[key] = depth > 0 && rng.chance(0.3) ? randomNamespace(rng, depth - 1) : rng.pick(LEAVES);
  return rng.chance(0.4) ? { kinds, fallback: rng.pick([num, txt]) } : { kinds };
}

function randomWorld(rng: Random): World {
  const kinds: Record<string, WorldEntry> = {};
  for (const key of ["a", "b", "c"]) if (rng.chance(0.4)) kinds[key] = rng.pick(LEAVES);
  if (rng.chance(0.7)) kinds["ns"] = randomNamespace(rng, 1);
  const defaults: Record<string, string> = rng.chance(0.3) ? { view: rng.pick(["view.a", "view.b"]) } : {};
  return rng.chance(0.15) ? { kinds, defaults, fallback: rng.pick([num, txt]) } : { kinds, defaults };
}

const FNS: readonly EvalFn[] = [one, two];
const ROOTS = [["names"], ["names", "self"], ["self", "names"]] as const;

function randomMachine(rng: Random): Machine {
  const evaluators: Record<string, EvalFn> = {};
  for (const key of ["x", "y"]) if (rng.chance(0.4)) evaluators[key] = rng.pick(FNS);
  return {
    world: randomWorld(rng),
    evaluators,
    ...(rng.chance(0.2) ? { maxDepth: rng.pick([10, 20]) } : {}),
    ...(rng.chance(0.2) ? { roots: rng.pick(ROOTS) } : {}),
  };
}

type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly paths: readonly string[] };

function attempt<T>(merge: () => T): Outcome<T> {
  try {
    return { ok: true, value: merge() };
  } catch (error) {
    if (!(error instanceof MergeError)) throw error;
    return { ok: false, paths: error.conflicts.map((item) => JSON.stringify(item.path)).sort() };
  }
}

/** Two machines are the same when their worlds are equal, and each other field has the same values. */
function sameMachine(a: Machine, b: Machine): boolean {
  const { world: x, roots: rootsA, ...restA } = a;
  const { world: y, roots: rootsB, ...restB } = b;
  const roots = (list: readonly string[] | undefined): readonly string[] | undefined => (list === undefined ? undefined : [...list].sort());
  return docEquals(x, y) && docEquals(restA, restB) && docEquals(roots(rootsA), roots(rootsB));
}

function sameOutcome<T>(a: Outcome<T>, b: Outcome<T>, equal: (x: T, y: T) => boolean): boolean {
  return a.ok && b.ok ? equal(a.value, b.value) : a.ok === b.ok;
}

describe("the laws of the merge", () => {
  it("[WORLD.LAWS] without replaces, a merge of worlds or of machines is commutative, associative and idempotent", () => {
    const laws = <T extends object>(name: string, make: (rng: Random) => T, merge: (...parts: T[]) => T, equal: (x: T, y: T) => boolean): void => {
      let merged = 0;
      for (let seed = 0; seed < 1500; seed += 1) {
        const rng = random(seed);
        const [a, b, c] = [make(rng), make(rng), make(rng)];
        const ab = attempt(() => merge(a, b));
        const ba = attempt(() => merge(b, a));
        expect(sameOutcome(ab, ba, equal), `${name}, seed ${seed}: a merge of two parts in another order`).toBe(true);
        // For two parts, the conflicts are the same too.
        if (!ab.ok && !ba.ok) expect(ab.paths, `${name}, seed ${seed}`).toEqual(ba.paths);
        const flat = attempt(() => merge(a, b, c));
        const left = attempt(() => merge(merge(a, b), c));
        const right = attempt(() => merge(a, merge(b, c)));
        expect(sameOutcome(flat, left, equal) && sameOutcome(flat, right, equal), `${name}, seed ${seed}: associativity`).toBe(true);
        expect(sameOutcome(attempt(() => merge(c, a, b)), flat, equal), `${name}, seed ${seed}: three parts in another order`).toBe(true);
        expect(equal(merge(a, a), merge(a)) && equal(merge(a), a), `${name}, seed ${seed}: idempotence`).toBe(true);
        if (flat.ok) merged += 1;
      }
      // The pools give both merges that succeed and merges with conflicts.
      expect(merged, name).toBeGreaterThan(100);
      expect(merged, name).toBeLessThan(1400);
    };
    laws("worlds", randomWorld, (...parts) => mergeWorlds(...parts), docEquals);
    laws("machines", randomMachine, (...parts) => mergeMachines(...parts), sameMachine);
  });
});

describe("the merge of machines", () => {
  const walkA: Walker = () => ({ ok: true, thing: 1 });
  const walkB: Walker = () => ({ ok: true, thing: 2 });
  const derefA: DerefCode = () => undefined;
  const derefB: DerefCode = () => undefined;
  const permitsA = (): boolean => true;
  const adoptA = (value: unknown): unknown => value;

  it("[MACHINE.MERGE] the tables of the code merge by name, a function is equal only to itself, and each other field is one value", () => {
    const merged = mergeMachines(
      { world: { kinds: { one: { verbs: { eval: "one" } } } }, evaluators: { one }, derefs: { d: derefA }, walkers: { w: walkA }, maxDepth: 50, roots: ["names", "self"] },
      { world: { kinds: { one: { verbs: { eval: "one" } }, two: { verbs: { eval: "two" } } } }, evaluators: { one, two }, walkers: { w: walkA }, maxDepth: 50, roots: ["self", "names"], plain: true, permits: permitsA, adopt: adoptA },
    );
    expect(merged.evaluators).toEqual({ one, two });
    expect(merged).toMatchObject({ derefs: { d: derefA }, walkers: { w: walkA }, maxDepth: 50, roots: ["names", "self"], plain: true, permits: permitsA, adopt: adoptA });
    expect(prepare(merged, { type: "two", value: null }).evaluate()).toEqual(ok(2));
    // An absent field has no value: a machine without runners gets none.
    expect(Object.hasOwn(merged, "runners")).toBe(false);
    const earlier: MachinePart = { world: { kinds: { k: num } }, evaluators: { one }, derefs: { d: derefA }, walkers: { w: walkA }, permits: permitsA, adopt: adoptA, roots: ["names"], plain: false, maxDepth: 10 };
    const later: MachinePart = { world: { kinds: { k: txt } }, evaluators: { one: two }, derefs: { d: derefB }, walkers: { w: walkB }, permits: () => false, adopt: (value) => value, roots: ["self"], plain: true, maxDepth: 20 };
    expect(conflictsOf(() => mergeMachines(earlier, later)).map((item) => [item.path, item.reason])).toEqual([
      [["world", "kinds", "k"], "Two parts give two different kinds."],
      [["evaluators", "one"], "Two parts give two different evaluators for this name."],
      [["derefs", "d"], "Two parts give two different deref codes for this name."],
      [["walkers", "w"], "Two parts give two different walkers for this name."],
      [["permits"], "Two parts give two different values for permits."],
      [["adopt"], "Two parts give two different values for adopt."],
      [["roots"], "Two parts give two different values for roots."],
      [["plain"], "Two parts give two different values for plain."],
      [["maxDepth"], "Two parts give two different values for maxDepth."],
    ]);
    // The path of each conflict in the replaces of the later part resolves it. A world names its own paths too.
    const paths = conflictsOf(() => mergeMachines(earlier, later)).map((item) => item.path);
    const replacing = mergeMachines(earlier, { ...later, replaces: paths.slice(1), world: { kinds: { k: txt }, replaces: [["kinds", "k"]] } });
    expect(replacing).toMatchObject({ world: { kinds: { k: txt } }, evaluators: { one: two }, derefs: { d: derefB }, walkers: { w: walkB }, roots: ["self"], plain: true, maxDepth: 20 });
    expect(replacing.permits).toBe(later.permits);
    // The standard machine merges with itself.
    expect(sameMachine(mergeMachines(STD_MACHINE, STD_MACHINE), mergeMachines(STD_MACHINE))).toBe(true);
  });

  it("[MACHINE.RUNNER] a runner hides the evaluator of its name, thus one part gives both, and a replacement replaces both", () => {
    expect(conflictsOf(() => mergeMachines({ evaluators: { x: one } }, { evaluators: {}, runners: { x: runner } }))).toEqual([
      { path: ["runners", "x"], parts: [0, 1], reason: "The runner of one part hides the evaluator of the other part, because a runner wins over an evaluator of its name." },
    ]);
    expect(conflictsOf(() => mergeMachines({ evaluators: {}, runners: { x: runner } }, { evaluators: { x: one } })).map((item) => item.parts)).toEqual([[0, 1]]);
    // One part gives both: the evaluator of another part is the same code.
    expect(conflictsOf(() => mergeMachines({ evaluators: { x: one }, runners: { x: runner } }, { evaluators: { x: one } }))).toEqual([]);
    expect(conflictsOf(() => mergeMachines(STD_MACHINE, { evaluators: STD_EVALUATORS }))).toEqual([]);
    // The later part replaces the code of x: its evaluator answers, and the earlier runner goes.
    const kinds = { world: { kinds: { x: { verbs: { eval: "x" } } } } };
    const replaced = mergeMachines({ ...kinds, evaluators: { x: one }, runners: { x: runner } }, { evaluators: { x: two }, replaces: [["evaluators", "x"]] });
    expect(replaced.runners).toEqual({});
    expect(prepare(replaced, { type: "x", value: null }).evaluate()).toEqual(ok(2));
    const byRunner = mergeMachines({ ...kinds, evaluators: { x: one } }, { evaluators: {}, runners: { x: runner }, replaces: [["runners", "x"]] });
    expect(byRunner.evaluators).toEqual({});
    expect(prepare(byRunner, { type: "x", value: null }).evaluate()).toEqual(ok("runner"));
  });

  it("[MACHINE.KNOWN] the hooks known compose in the order of the parts, and a hook does not answer for a name that a later part replaces", () => {
    const first = (_path: readonly Key[], evaluator: string): true | string => (evaluator === "a" ? "The first part has no a." : true);
    const second = (_path: readonly Key[], evaluator: string): true | string => (evaluator === "a" || evaluator === "b" ? "The second part has no a or b." : true);
    const merged = mergeMachines({ evaluators: { a: one, b: one }, known: first }, { known: second });
    expect([merged.known?.(["a"], "a"), merged.known?.(["b"], "b"), merged.known?.(["c"], "c")]).toEqual(["The first part has no a.", "The second part has no a or b.", true]);
    const replaced = mergeMachines({ evaluators: { a: one }, known: first }, { evaluators: { a: two }, replaces: [["evaluators", "a"]] });
    expect(replaced.known?.(["a"], "a")).toBe(true);
    expect(Object.hasOwn(replaced, "runners")).toBe(false);
    // A hook in two parts is one hook. One hook stays the same function.
    expect(mergeMachines({ known: first }, { known: first }).known).toBe(first);
    // check reads the composed hook.
    const world = { kinds: { a: { verbs: { eval: "a" } }, b: { verbs: { eval: "b" } } } };
    expect(check(mergeMachines({ world, evaluators: { a: one, b: one }, known: first }, { known: second }), { type: "b", value: null })).toEqual([
      { code: "#NAME?", place: [], reason: "The second part has no a or b.", at: [] },
    ]);
  });
});

describe("the restrictions of worlds and machines", () => {
  it("[WORLD.RESTRICT] restrictWorld removes the entries at the paths, and it does not change the world", () => {
    const add: Kind = { verbs: { eval: "formula.op" }, summary: "add" };
    const fallback: Kind = { verbs: { eval: "formula.op" } };
    const world: World = deepFreeze({
      kinds: { number: num, text: txt, ops: { kinds: { add, mul: add }, fallback }, sum: alias("ops", "add"), size: alias("number") },
      defaults: { view: "view.card", format: "format.plain" },
      fallback: call,
    });
    const restricted = restrictWorld(world, [["kinds", "text"], ["kinds", "ops", "kinds", "add"], ["kinds", "ops", "fallback"], ["defaults", "view"], ["fallback"], ["kinds", "number"]]);
    expect(Object.keys(restricted.kinds)).toEqual(["ops", "sum", "size"]);
    expect(restricted.defaults).toEqual({ format: "format.plain" });
    expect(Object.hasOwn(restricted, "fallback")).toBe(false);
    // The namespace keeps its other keys, and without its fallback it knows only them.
    expect(lookupKind(restricted, ["ops", "mul"])).toMatchObject({ ok: true, kind: add });
    expect(lookupKind(restricted, ["ops", "neg"])).toMatchObject({ ok: false, reason: "unknown" });
    // An alias to a removed entry names no kind, and the closed world has no kind for an unknown key.
    expect(lookupKind(restricted, ["sum"])).toMatchObject({ ok: false, reason: "unknown" });
    expect(lookupKind(restricted, ["size"])).toMatchObject({ ok: false, reason: "unknown" });
    expect(lookupKind(restricted, ["git", "status"])).toMatchObject({ ok: false, reason: "unknown" });
    // A path that names no entry changes nothing, and an entry that stays is the same object.
    const same = restrictWorld(world, [["kinds", "zzz"], ["kinds", "number", "kinds", "x"], ["kinds", "ops", "kinds", "zzz"], ["kinds"], ["defaults", "zzz"], ["zzz"]]);
    expect(docEquals(same, world)).toBe(true);
    expect(same.kinds["ops"]).toBe(world.kinds["ops"]);
    expect(restrictWorld(world, [["kinds", "text"]]).kinds["number"]).toBe(num);
    // A removed namespace goes with each entry in it. In the open world, the fallback of the world then answers.
    expect(lookupKind(restrictWorld(world, [["kinds", "ops"]]), ["ops", "mul"])).toMatchObject({ ok: true, kind: call });
    expect(lookupKind(restrictWorld(world, [["kinds", "ops"], ["fallback"]]), ["ops", "mul"])).toMatchObject({ ok: false, reason: "unknown" });
    // The key __proto__ is a key as each other key.
    const proto = mergeWorlds({ kinds: JSON.parse('{"__proto__": {"verbs": {"eval": "x"}}, "a": {"verbs": {"eval": "a"}}}') as Record<string, WorldEntry> });
    expect(Object.keys(restrictWorld(proto, [["kinds", "__proto__"]]).kinds)).toEqual(["a"]);
  });

  it("[MACHINE.RESTRICT] restrictMachine removes entries of the world and the code of names, thus an own entry cannot reach the code", () => {
    const walkA: Walker = () => ({ ok: true, thing: 1 });
    const derefA: DerefCode = () => undefined;
    const machine: Machine = deepFreeze({
      world: { kinds: { x: { verbs: { eval: "x" } }, y: { verbs: { eval: "y" } } }, defaults: {} },
      evaluators: { x: one, y: two },
      runners: { x: runner },
      derefs: { d: derefA },
      walkers: { w: walkA },
      maxDepth: 10,
    });
    const restricted = restrictMachine(machine, [["world", "kinds", "x"], ["evaluators", "x"], ["derefs", "d"], ["walkers", "w"]]);
    expect(Object.keys(restricted.world.kinds)).toEqual(["y"]);
    // The evaluator and the runner of a name are its code: a path to either one removes both.
    expect(restricted).toMatchObject({ evaluators: { y: two }, runners: {}, derefs: {}, walkers: {}, maxDepth: 10 });
    expect(Object.keys(restricted.evaluators)).toEqual(["y"]);
    expect(restrictMachine(machine, [["runners", "x"]]).evaluators).toEqual({ y: two });
    // An own entry names an evaluator directly. Only the removal of the code refuses it.
    const own = { type: "y", own: { eval: "x" }, value: null };
    expect(prepare(restrictMachine(machine, [["world", "kinds", "x"]]), own).evaluate()).toEqual(ok("runner"));
    expect(check(restricted, own).map((issue) => issue.code)).toEqual(["#NOEVAL"]);
    expect(prepare(restricted, own).evaluate()).toMatchObject({ ok: false, error: { code: "#NOEVAL" } });
    // A path that names no entry changes nothing. Each other field stays.
    const same = restrictMachine(machine, [["evaluators", "zzz"], ["maxDepth"], ["world", "zzz"], ["evaluators", "x", "more"]]);
    expect(sameMachine(same, machine)).toBe(true);
    expect(same.runners).toEqual({ x: runner });
    expect(Object.hasOwn(restrictMachine({ world: { kinds: {}, defaults: {} }, evaluators: { x: one } }, [["evaluators", "x"]]), "runners")).toBe(false);
  });
});

describe("the formula kit through the merge", () => {
  it("[FORMULA.EXTEND] a language extends the namespace ops of the kit, and a different kind or evaluator with the name of a kit entry is a conflict", () => {
    const profile = { ops: { add: (a: number, b: number) => a + b } };
    const twice: EvalFn = ({ parts }) => {
      const result = parts[0]?.evaluate() ?? fail("#VALUE!", "twice needs a part.");
      return result.ok && typeof result.value === "number" ? ok(result.value * 2) : result.ok ? fail("#VALUE!", "twice needs a number.") : result;
    };
    const language = formulaMachine(profile, {
      world: { kinds: { ops: { kinds: { twice: { verbs: { eval: "lang.twice" }, parts: { shape: "list", of: "lit" } } } } }, fallback: call },
      evaluators: { "lang.twice": twice },
    });
    // Before K32, the namespace ops of the language replaced the namespace of the kit, and ops.add gave #KIND?.
    expect(prepare(language, op("add", 1, 2)).evaluate()).toEqual(ok(3));
    expect(prepare(language, op("twice", op("add", 1, 2))).evaluate()).toEqual(ok(6));
    expect(check(language, op("nope", 1)).map((issue) => issue.reason)).toEqual(["The language has no operation nope."]);
    expect(check(language, op("twice", 1))).toEqual([]);
    // The fallback of the world of the language reaches the machine, thus the world is open (WORLD.OPEN).
    expect(lookupKind(language.world, ["git", "status"])).toMatchObject({ ok: true, kind: call });
    // An entry equal to the entry of the kit is no conflict. A different entry is a conflict, unless the language replaces it.
    expect(conflictsOf(() => formulaMachine(profile, { world: { kinds: { lit: formulaKinds()["lit"] as Kind } } }))).toEqual([]);
    expect(conflictsOf(() => formulaMachine(profile, { world: { kinds: { ref: deep } } }))).toEqual([{ path: ["world", "kinds", "ref"], parts: [0, 1], reason: "Two parts give two different kinds." }]);
    expect(conflictsOf(() => formulaMachine(profile, { evaluators: { "formula.lit": () => ok(0) } })).map((item) => item.path)).toEqual([["evaluators", "formula.lit"]]);
    expect(conflictsOf(() => formulaMachine(profile, { world: { kinds: { ops: { kinds: {}, fallback: num } } } })).map((item) => item.path)).toEqual([["world", "kinds", "ops", "fallback"]]);
    const deepRef = formulaMachine(profile, { world: { kinds: { ref: deep } }, replaces: [["world", "kinds", "ref"]] });
    expect(deepRef.world.kinds["ref"]).toBe(deep);
    expect(prepare(deepRef, { type: "ref", value: ["names", "x"] }).evaluate(context({ names: { x: 4 } }))).toEqual(ok(4));
  });
});
