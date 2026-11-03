import { describe, expect, it } from "vitest";
import {
  STD_CAPS,
  STD_MACHINE,
  WORK_LIMIT,
  agree,
  context,
  evaluate,
  fail,
  formulaDefinitions,
  formulaMachine,
  makeContext,
  mergeMachines,
  ok,
  prepare,
  random,
  reference,
  referenceRun,
  run,
  type Context,
  type Json,
  type Kind,
  type Machine,
  type Result,
  type TreeContract,
} from "./index.ts";

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });
const op = (name: string, ...args: Json[]): Json => ({ type: ["ops", name], value: args });
const name = (key: string): Json => ref("names", key);
const call = (fn: Json, ...args: Json[]): Json => ({ type: "call", value: { fn, args } });
const fn = (params: readonly string[], body: Json): Json => ({ type: "fn", value: { params: [...params], body } });
const when = (test: Json, then: Json, otherwise: Json): Json => ({ type: "if", value: { test, then, else: otherwise } });
const bind = (names: Record<string, Json>, body: Json): Json => ({ type: "let", value: { bind: names, body } });

let hostCalls = 0;
const ops = {
  add: (a: number, b: number) => a + b,
  lt: (a: number, b: number) => a < b,
  map: (each: (item: unknown) => unknown, items: readonly unknown[]) => items.map((item) => each(item)),
  range: (count: number) => Array.from({ length: count }, (_, index) => index),
  mark: (value: unknown) => {
    hostCalls += 1;
    return value;
  },
};
const definitions = formulaDefinitions({ ops });
const machineOf = (maxWork?: number): Machine => formulaMachine({ ops }, maxWork === undefined ? {} : { maxWork });

/** A recursion with `width` calls of itself at each level, down to the name `limit`. */
const branching = (width: number): Json => {
  const next = (): Json => call(name("self"), name("self"), op("add", name("n"), 1));
  let sum = next();
  for (let index = 1; index < width; index += 1) sum = op("add", sum, next());
  return bind({ f: fn(["self", "n"], when(op("lt", name("n"), name("limit")), sum, 1)) }, call(name("f"), name("f"), 0));
};

/** The applications of a full tree of the given width and levels: 2^(levels + 1) - 1 for width 2. */
const applications = (width: number, levels: number): number => (width === 1 ? levels + 1 : (width ** (levels + 1) - 1) / (width - 1));

/** The plan two times, the traced evaluation and the reference, as FORMULA.CALL-DEPTH compares them. */
const tiers = (machine: Machine, doc: unknown, ctx: Context): readonly Result[] => {
  const plan = prepare(machine, doc);
  return [plan.evaluate(ctx), plan.evaluate(ctx), evaluate(machine, doc, ctx).result, reference(machine, doc, ctx, { definitions })];
};

const reasonOver = (limit: number): string => `The work of one evaluation is more than ${limit} points. The field maxWork of the machine sets the limit.`;

/** A kind of a decorated tree: each field is an attribute, and a bare field is a number. */
const treeKind = (tree?: TreeContract): Kind => ({
  verbs: { eval: "tree.node" },
  parts: { shape: "record", fields: {}, rest: { shape: "term", of: "number" } },
  caps: [{ rule: "mask" }],
  pure: true,
  lazy: [{}],
  reads: ["self"],
  ...(tree === undefined ? {} : { tree }),
});
const node = (type: string, value: Record<string, Json> = {}): Json => ({ type, value });
const path = (...steps: Json[]): Json => ({ type: "ref", value: steps });
const add = (...items: Json[]): Json => ({ type: "add", value: items });
const self = (...steps: Json[]): Json => path("self", ...steps);
const list = (...items: Json[]): Json => ({ type: "list", value: items });
const quote = (doc: Json): Json => ({ type: ["tree", "quote"], value: doc });
const greater = (a: Json, b: Json): Json => ({ type: "greater", value: [a, b] });
const below = (kind: string): Json => node(kind, { d: add(self("parent", "d"), 1) });
const total: Json = { type: "if", value: { test: greater(self("limit"), self("d")), then: add(self("l", "x"), self("r", "x")), else: { type: "number", value: 1 } } };

const kinds: Record<string, Kind> = {
  // Two generated subtrees at each level (TREE.HIGHER).
  binH: treeKind({ attributes: { limit: { copy: true }, l: { higher: quote(below("binH")) }, r: { higher: quote(below("binH")) } }, equations: { x: total } }),
  // Two nodes from plain equations at each level.
  binP: treeKind({ attributes: { limit: { copy: true } }, equations: { l: below("binP"), r: below("binP"), x: total } }),
  bag: treeKind(),
};
const treeMachine = (maxWork?: number): Machine => ({
  ...STD_MACHINE,
  world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, ...kinds } },
  ...(maxWork === undefined ? {} : { maxWork }),
});
const treeContext = (): Context => makeContext({}, STD_CAPS);

/** Each tier of `agree` gives the same result, also the same reason. */
const agreed = (machine: Machine, doc: Json, ctx: Context = treeContext(), options: { readonly definitions?: typeof definitions } = {}): Result => {
  const outcome = agree(machine, doc, ctx, { strict: true, ...options });
  expect(outcome, outcome.ok ? "" : outcome.reason).toMatchObject({ ok: true });
  return outcome.ok ? outcome.result : fail("#N/A", "The tiers disagree.");
};

/** A chain of attributes where each attribute holds the next one two times. The walk of the JSON doubles at each level. */
const sharedChain = (levels: number): Json => {
  const value: Record<string, Json> = { [`a${levels}`]: 1 };
  for (let index = levels - 1; index >= 0; index -= 1) value[`a${index}`] = list(self(`a${index + 1}`), self(`a${index + 1}`));
  return node("bag", value);
};

describe("the limit of work of one evaluation (K216, D134)", () => {
  it("[WORK.LIMIT] each application of a closure counts one point, and the point past maxWork gives one #WORK! in each tier", () => {
    const doc = branching(2);
    const ctx = context({ names: { limit: 6 } });
    const count = applications(2, 6);
    expect(count).toBe(127);
    for (const result of tiers(machineOf(count), doc, ctx)) expect(result).toEqual(ok(64));
    for (const result of tiers(machineOf(count - 1), doc, ctx)) expect(result).toMatchObject({ ok: false, error: { code: "#WORK!", reason: reasonOver(count - 1) } });
    expect(agreed(machineOf(count - 1), doc, ctx, { definitions })).toMatchObject({ ok: false, error: { code: "#WORK!" } });
  });

  it("[WORK.DEFAULT] the default limit stops a recursion of 20 levels with two branches, and it leaves a recursion of 16 levels legal", { timeout: 60000 }, () => {
    expect(WORK_LIMIT).toBe(200000);
    const doc = branching(2);
    const plan = prepare(machineOf(), doc);
    expect(plan.evaluate(context({ names: { limit: 16 } }))).toEqual(ok(65536));
    const ctx = context({ names: { limit: 20 } });
    for (const result of [plan.evaluate(ctx), evaluate(machineOf(), doc, ctx).result]) expect(result).toMatchObject({ ok: false, error: { code: "#WORK!", reason: reasonOver(WORK_LIMIT) } });
    // The reference reads the same default. A flat map reaches it with less memory than a recursion.
    const flat = op("map", fn(["item"], name("item")), op("range", WORK_LIMIT + 1));
    expect(reference(machineOf(), flat, context(), { definitions })).toMatchObject({ ok: false, error: { code: "#WORK!", reason: reasonOver(WORK_LIMIT) } });
  });

  it("[WORK.OPTION] the field maxWork raises the limit, and Infinity removes it. Two different values of a merge are a conflict", () => {
    const ctx = context({ names: { limit: 10 } });
    expect(prepare(machineOf(2047), branching(2)).evaluate(ctx)).toEqual(ok(1024));
    expect(prepare(machineOf(Number.POSITIVE_INFINITY), branching(2)).evaluate(ctx)).toEqual(ok(1024));
    expect(prepare(machineOf(2046), branching(2)).evaluate(ctx)).toMatchObject({ ok: false, error: { code: "#WORK!" } });
    expect(() => mergeMachines({ maxWork: 1 }, { maxWork: 2 })).toThrow(/maxWork/);
    expect(mergeMachines({ maxWork: 1 }, { maxWork: 1 }).maxWork).toBe(1);
  });

  it("[WORK.HOST] an application by a host operation counts one point", () => {
    const each = fn(["item"], op("add", name("item"), 1));
    const doc = op("map", each, op("range", name("count")));
    expect(tiers(machineOf(5), doc, context({ names: { count: 5 } }))).toEqual(Array.from({ length: 4 }, () => ok([1, 2, 3, 4, 5])));
    for (const result of tiers(machineOf(5), doc, context({ names: { count: 6 } }))) expect(result).toMatchObject({ ok: false, error: { code: "#WORK!" } });
  });

  it("[WORK.RUN] a run gives the error of the evaluation, in the plan, in run and in the reference", async () => {
    const doc = branching(2);
    const ctx = context({ names: { limit: 6 } });
    const machine = machineOf(100);
    const expected = prepare(machine, doc).evaluate(ctx);
    expect(expected).toMatchObject({ ok: false, error: { code: "#WORK!" } });
    expect(await prepare(machine, doc).run(ctx)).toEqual(expected);
    expect((await run(machine, doc, ctx)).result).toEqual(expected);
    expect(await referenceRun(machine, doc, ctx, { definitions })).toEqual(expected);
  });

  it("[WORK.AFTER] after the end of an evaluation, each application from the host has a new count", () => {
    const machine = machineOf(3);
    const doc = fn(["n"], op("add", name("n"), 1));
    const results = [prepare(machine, doc).evaluate(context()), evaluate(machine, doc, context()).result, reference(machine, doc, context(), { definitions })];
    for (const result of results) {
      expect(result.ok).toBe(true);
      const closure = (result as { readonly value: (n: number) => number }).value;
      for (let index = 0; index < 10; index += 1) expect(closure(index)).toBe(index + 1);
    }
    // One application from the host still has the limit: a recursion in it stops.
    const looped = bind({ f: fn(["self", "n"], when(op("lt", name("n"), 9), call(name("self"), name("self"), op("add", name("n"), 1)), name("n"))) }, fn(["n"], call(name("f"), name("f"), name("n"))));
    for (const result of [prepare(machine, looped).evaluate(context()), reference(machine, looped, context(), { definitions })]) {
      const closure = (result as { readonly value: (n: number) => number }).value;
      expect(closure(8)).toBe(9);
      expect(() => closure(0)).toThrow(/maxWork/);
      expect(closure(8)).toBe(9);
    }
  });

  it("[WORK.PREPARE] prepare does no work of a closure and evaluates no equation of a tree, thus a document past the limit prepares at once", () => {
    const counted = bind({ f: fn(["n"], op("mark", name("n"))) }, call(name("f"), 1));
    hostCalls = 0;
    const plan = prepare(machineOf(), counted);
    expect(hostCalls).toBe(0);
    expect(plan.evaluate()).toEqual(ok(1));
    expect(hostCalls).toBe(1);
    // A tree of 40 levels with two branches: a probe of the tree does not end. The limit of work ends the evaluation.
    const machine = treeMachine(1000);
    const tree = node("binH", { d: 0, limit: 40, y: self("x") });
    expect(prepare(machine, tree).evaluate(treeContext())).toMatchObject({ ok: false, error: { code: "#WORK!" } });
  });

  it("[WORK.HIGHER] a higher attribute with two subtrees at each level gives one #WORK! in each tier", () => {
    const doc = node("binH", { d: 0, limit: 4, y: self("x") });
    // 30 generated nodes cost 240 points.
    expect(agreed(treeMachine(240), doc)).toEqual(ok({ d: 0, limit: 4, y: 16 }));
    expect(agreed(treeMachine(239), doc)).toMatchObject({ ok: false, error: { code: "#WORK!" } });
    expect(prepare(treeMachine(), node("binH", { d: 0, limit: 20, y: self("x") })).evaluate(treeContext())).toMatchObject({ ok: false, error: { code: "#WORK!" } });
  });

  it("[WORK.NODE] a node that an equation makes costs 8 points, and a node of the text of a document costs nothing", () => {
    const doc = node("binP", { d: 0, limit: 4, y: self("x") });
    expect(agreed(treeMachine(240), doc)).toEqual(ok({ d: 0, limit: 4, y: 16 }));
    expect(agreed(treeMachine(239), doc)).toMatchObject({ ok: false, error: { code: "#WORK!" } });
    // A large document of plain nodes spends no point. The limit 0 stops only a counted point.
    let big: Json = node("bag", { a: 1 });
    for (let level = 0; level < 12; level += 1) big = { type: "bag", value: { l: big, r: big, b: 2 } };
    expect(prepare(treeMachine(0), big).evaluate(treeContext()).ok).toBe(true);
  });

  it("[WORK.EQUATION] each equation of a tree adds to the one count of the evaluation", () => {
    const each: Json = { type: "let", value: { bind: { f: fn(["n"], op("add", name("n"), 1)) }, body: call(name("f"), 1) } };
    const tree = formulaMachine({ ops });
    // The attributes b0, b1 and b2 each apply a closure one time, each in an equation with its own runtime.
    const outerKind = treeKind({ equations: { a: list(...Array.from({ length: 3 }, (_, index) => self(`b${index}`))), b0: each, b1: each, b2: each } });
    const machine = (maxWork: number): Machine => ({ ...tree, evaluators: { ...STD_MACHINE.evaluators, ...tree.evaluators }, world: { ...tree.world, kinds: { ...STD_MACHINE.world.kinds, ...tree.world.kinds, outer: outerKind } }, maxWork });
    const root: Json = { type: "outer", value: { z: self("a") } };
    expect(agreed(machine(3), root, makeContext({}, STD_CAPS), { definitions: { ...definitions } })).toEqual(ok({ z: [2, 2, 2] }));
    expect(agreed(machine(2), root, makeContext({}, STD_CAPS), { definitions: { ...definitions } })).toMatchObject({ ok: false, error: { code: "#WORK!" } });
  });

  it("[WORK.SHARED] the JSON of a tree counts each second visit of a shared list, record or node", () => {
    // The attribute a(10 - L) has 2^L - 1 lists in its JSON. The sum for L from 1 to 10 is 2036 visits of 10 lists.
    const doc = sharedChain(10);
    expect(agreed(treeMachine(2026), doc).ok).toBe(true);
    expect(agreed(treeMachine(2025), doc)).toMatchObject({ ok: false, error: { code: "#WORK!" } });
    expect(prepare(treeMachine(), sharedChain(40)).evaluate(treeContext())).toMatchObject({ ok: false, error: { code: "#WORK!" } });
  });

  it("[WORK.AGREES] on generated documents, each tier gives the same result at each limit around the true work", () => {
    const seeds = random(216);
    for (let index = 0; index < 60; index += 1) {
      const width = 1 + seeds.int(3);
      const levels = 1 + seeds.int(4);
      const inner = branching(width);
      const mapped = op("map", fn(["item"], inner), op("range", 1 + seeds.int(4)));
      const doc = seeds.chance(0.5) ? inner : mapped;
      const ctx = context({ names: { limit: levels } });
      const work = applications(width, levels);
      for (const maxWork of [1, work - 1, work, work + 1, 3 * work, 3 * work + 3, 200]) {
        const outcome = agree(machineOf(Math.max(1, maxWork)), doc, ctx, { strict: true, definitions });
        expect(outcome, outcome.ok ? "" : outcome.reason).toMatchObject({ ok: true });
      }
      // A generated tree: a chain of generated levels and shared lists under the same limits.
      const tree = seeds.chance(0.5) ? node("binH", { d: 0, limit: levels, y: self("x") }) : node("binP", { d: 0, limit: levels, y: self("x") });
      const nodes = 2 ** (levels + 1) - 2;
      for (const maxWork of [0, 8 * nodes - 1, 8 * nodes, 7, 8 + seeds.int(40)]) agreed(treeMachine(maxWork), tree);
      const shared = sharedChain(1 + seeds.int(6));
      for (const maxWork of [0, 1, 2, 3 + seeds.int(30)]) agreed(treeMachine(maxWork), shared);
    }
  });
});
