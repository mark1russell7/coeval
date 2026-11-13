import { describe, expect, it } from "vitest";
import {
  STD_CAPS,
  STD_MACHINE,
  WORK_LIMIT,
  agree,
  argsKey,
  check,
  context,
  docEquals,
  documentKey,
  encodeValue,
  evaluate,
  fail,
  formulaDefinitions,
  formulaMachine,
  join,
  makeContext,
  mergeMachines,
  ok,
  prepare,
  random,
  reference,
  referenceRun,
  run,
  sameValue,
  stepper,
  typeCheck,
  typeFromSamples,
  typeFromSchema,
  type Code,
  type Context,
  type Evaluator,
  type Json,
  type Kind,
  type Machine,
  type Result,
  type TreeContract,
  type ValueType,
} from "./index.ts";
import { RUNTIME, type InputWithRuntime } from "./evaluate.ts";

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
    const results = [prepare(machine, doc).evaluate(context()), evaluate(machine, doc, context()).result, reference(machine, doc, context(), { definitions }), stepper(machine, doc, context(), { profile: { ops } })];
    for (const result of results) {
      expect(result.ok).toBe(true);
      const closure = (result as { readonly value: (n: number) => number }).value;
      for (let index = 0; index < 10; index += 1) expect(closure(index)).toBe(index + 1);
    }
    // One application from the host still has the limit: a recursion in it stops.
    const looped = bind({ f: fn(["self", "n"], when(op("lt", name("n"), 9), call(name("self"), name("self"), op("add", name("n"), 1)), name("n"))) }, fn(["n"], call(name("f"), name("f"), name("n"))));
    for (const result of [prepare(machine, looped).evaluate(context()), reference(machine, looped, context(), { definitions }), stepper(machine, looped, context(), { profile: { ops } })]) {
      const closure = (result as { readonly value: (n: number) => number }).value;
      expect(closure(8)).toBe(9);
      expect(() => closure(0)).toThrow(/maxWork/);
      expect(closure(8)).toBe(9);
    }
  });

  it("[WORK.AFTER-EQUATION] a call from the host of a kept closure keeps one count, also across the nodes that its equations make", () => {
    const formulas = formulaMachine({ ops });
    const machine = (maxWork: number): Machine => ({
      ...formulas,
      evaluators: { ...STD_MACHINE.evaluators, ...formulas.evaluators },
      world: { ...formulas.world, kinds: { ...STD_MACHINE.world.kinds, ...formulas.world.kinds, ...kinds } },
      maxWork,
    });
    // Each application makes a tree, and its equations make two nodes. 7 applications and 14 nodes cost 7 + 14 x 8 = 119 points.
    const twice = call(name("self"), name("self"), op("add", name("n"), 1));
    const body = bind({ t: node("binP", { d: 0, limit: 1, y: self("x") }) }, when(op("lt", name("n"), 2), op("add", twice, twice), ref("names", "t", "y")));
    const ctx = treeContext();
    const inside = bind({ g: fn(["self", "n"], body) }, call(name("g"), name("g"), 0));
    expect(agreed(machine(119), inside, ctx, { definitions })).toEqual(ok(8));
    expect(agreed(machine(118), inside, ctx, { definitions })).toMatchObject({ ok: false, error: { code: "#WORK!" } });
    // The same work from the host, with one more application for the closure of the root. A node of an equation has its
    // own runtime, and its point does not start a new count. The reference evaluates the node in the state of the
    // evaluation that made the closure.
    const kept = bind({ g: fn(["self", "n"], body) }, fn(["n"], call(name("g"), name("g"), name("n"))));
    const tiers = [(limit: number) => prepare(machine(limit), kept).evaluate(ctx), (limit: number) => reference(machine(limit), kept, ctx, { definitions })];
    for (const tier of tiers) {
      const closure = (limit: number) => (tier(limit) as { readonly value: (n: number) => number }).value;
      expect(closure(120)(0)).toBe(8);
      expect(() => closure(119)(0)).toThrow(/maxWork/);
      const one = closure(120);
      for (let index = 0; index < 3; index += 1) expect(one(0)).toBe(8);
    }
  });

  it("[WORK.KEEPS] a plan marks the end of its evaluation only with an evaluator that can keep its runtime", () => {
    const uses = (evaluator: Evaluator): number => {
      const base = machineOf(3);
      const machine: Machine = { ...base, evaluators: { ...base.evaluators, "test.keep": evaluator } };
      const result = prepare(machine, { type: "number", value: 1, own: { eval: "test.keep" } }).evaluate(context());
      const keep = (result as { readonly value: () => void }).value;
      let done = 0;
      try {
        for (; done < 5; done += 1) keep();
      } catch {
        return done;
      }
      return done;
    };
    const compile = (): Code => (_ctx, rt) => ok(() => rt.spend?.(2));
    expect(uses({ compile, keeps: true })).toBe(5);
    expect(
      uses((input) => {
        const runtime = (input as InputWithRuntime)[RUNTIME];
        return ok(() => runtime?.spend?.(2));
      }),
    ).toBe(5);
    // Without the field, the plan has no end. Thus the count goes on, and the limit stops the second use.
    expect(uses({ compile })).toBe(1);
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

  // With the stepper, the 60 cases used 0.614 of the timeout in CI, thus each test examines one part of 15 cases (K250, D96).
  // The draws happen once, in the order of one loop, thus the parts examine the same cases as one test.
  const seeds = random(216);
  const cases = Array.from({ length: 60 }, () => {
    const width = 1 + seeds.int(3);
    const levels = 1 + seeds.int(4);
    const range = 1 + seeds.int(4);
    const plain = seeds.chance(0.5);
    const helper = seeds.chance(0.5);
    const extra = 8 + seeds.int(40);
    const chain = 1 + seeds.int(6);
    const sharedExtra = 3 + seeds.int(30);
    return { width, levels, range, plain, helper, extra, chain, sharedExtra };
  });
  const agreesParts = 4;
  const agreesTotals = { cases: 0, parts: 0 };
  for (let part = 0; part < agreesParts; part += 1) {
    it(`[WORK.AGREES] on generated documents, each tier gives the same result at each limit around the true work: part ${part + 1} of ${agreesParts}`, () => {
      const size = cases.length / agreesParts;
      for (const { width, levels, range, plain, helper, extra, chain, sharedExtra } of cases.slice(part * size, (part + 1) * size)) {
        const inner = branching(width);
        const doc = plain ? inner : op("map", fn(["item"], inner), op("range", range));
        const ctx = context({ names: { limit: levels } });
        const work = applications(width, levels);
        for (const maxWork of [1, work - 1, work, work + 1, 3 * work, 3 * work + 3, 200]) {
          const outcome = agree(machineOf(Math.max(1, maxWork)), doc, ctx, { strict: true, definitions });
          expect(outcome, outcome.ok ? "" : outcome.reason).toMatchObject({ ok: true });
          // The stepper gives the result of the reference at each limit (STEPPER.WORK).
          const machine = machineOf(Math.max(1, maxWork));
          expect(stepper(machine, doc, ctx, { profile: { ops } }), `${maxWork}`).toEqual(reference(machine, doc, ctx, { definitions }));
        }
        // A generated tree: a chain of generated levels and shared lists under the same limits.
        const tree = helper ? node("binH", { d: 0, limit: levels, y: self("x") }) : node("binP", { d: 0, limit: levels, y: self("x") });
        const nodes = 2 ** (levels + 1) - 2;
        for (const maxWork of [0, 8 * nodes - 1, 8 * nodes, 7, extra]) agreed(treeMachine(maxWork), tree);
        const shared = sharedChain(chain);
        for (const maxWork of [0, 1, 2, sharedExtra]) agreed(treeMachine(maxWork), shared);
        agreesTotals.cases += 1;
      }
      agreesTotals.parts += 1;
    });
  }

  it("[WORK.AGREES] the parts of the agreement examine all 60 generated cases", () => {
    expect(agreesTotals).toEqual({ cases: 60, parts: agreesParts });
  });
});

/** A union of two copies of the term below it, `length` times: one shared term with 2^length ways to its leaf (D207). */
function unionChain(length: number, leaf: ValueType): ValueType {
  let type = leaf;
  for (let index = 0; index < length; index += 1) type = { union: [type, type] };
  return type;
}

/** A record of two copies of the value below it, `length` times: one shared value with 2^length ways to its leaf. */
function valueChain(length: number, leaf: unknown): unknown {
  let value = leaf;
  for (let index = 0; index < length; index += 1) value = { a: value, b: value };
  return value;
}

describe("the limit of work of a pass of types, and the walks of values that share their parts (K259, D207)", () => {
  // A chain of 40 has 2^40 ways to its leaf. A walk that reads each way does not end.
  const LENGTH = 40;
  const LIT = { declaredType: "lit" } as const;
  const TYPES_PASS = `The work of one pass of types is more than ${WORK_LIMIT} points. The field maxWork of the machine sets the limit.`;
  /** A check of the field `a` of the host name `x`, with the type `x` for the name. */
  const field = (x: ValueType, machine: Machine = formulaMachine()) => typeCheck(machine, ref("names", "x", "a"), { ...LIT, names: ["x"], rootTypes: { names: { x } } });

  it("[TYPE.WORK] a check of types past maxWork stops with one #WORK! at the document on the top of its stack, and the type is unknown", () => {
    const record: ValueType = { record: { a: "number" }, closed: true };
    expect(field(unionChain(4, record))).toMatchObject({ type: "number", issues: [] });
    // The step into the shared union reads each way to the leaf, thus the pass of a chain of 40 stops at the limit.
    expect(field(unionChain(LENGTH, record))).toMatchObject({ type: "unknown", issues: [{ code: "#WORK!", place: [], reason: TYPES_PASS, at: [] }] });
    expect(check(formulaMachine(), ref("names", "x", "a"), { ...LIT, types: true, names: ["x"], rootTypes: { names: { x: unionChain(LENGTH, record) } } })).toEqual([
      { code: "#WORK!", place: [], reason: TYPES_PASS, at: [] },
    ]);
    // The field maxWork of the machine is the limit of the pass. A pass under the limit gives the same result as before.
    const small = (maxWork: number) => field(unionChain(4, record), { ...formulaMachine(), maxWork });
    expect(small(1).issues.map((issue) => [issue.code, issue.reason])).toEqual([["#WORK!", "The work of one pass of types is more than 1 points. The field maxWork of the machine sets the limit."]]);
    expect(small(1).type).toBe("unknown");
    expect(small(1000)).toMatchObject({ type: "number", issues: [] });
    expect(field(unionChain(LENGTH, record), { ...formulaMachine(), maxWork: 10 }).issues.map((issue) => issue.code)).toEqual(["#WORK!"]);
  });

  it("[TYPE.WORK] a join outside a check of types is a pass of its own, and past the limit the join is unknown", () => {
    const record: ValueType = { record: { a: "number" }, closed: true };
    expect(join(unionChain(4, record), "text")).toEqual({ union: [record, "text"] });
    expect(join(unionChain(LENGTH, record), "text")).toBe("unknown");
  });

  it("[TYPE.WORK] typeFromSchema stops past the limit with one issue, and the type is unknown", () => {
    // Each level holds the level below it in two properties, as one object of JavaScript. A $ref reads one time, but
    // a shared object reads at each place.
    const schema = (length: number): unknown => {
      let part: unknown = { type: "number" };
      for (let index = 0; index < length; index += 1) part = { type: "object", properties: { a: part, b: part } };
      return part;
    };
    expect(typeFromSchema(schema(4)).issues).toEqual([]);
    expect(typeFromSchema(schema(LENGTH))).toEqual({
      type: "unknown",
      issues: [{ at: [], reason: `The work of the reading is more than ${WORK_LIMIT} points (#WORK!). The type reads the schema as unknown.` }],
    });
  });

  it("[TYPE.SHARED] typeFromSamples reads a sample that shares its parts one time for each depth, and the type shares its parts", () => {
    const type = typeFromSamples([valueChain(LENGTH, 1)]) as { readonly record: Readonly<Record<string, ValueType>> };
    expect(type.record["a"]).toBe(type.record["b"]);
    expect(typeFromSamples([valueChain(2, 1)])).toEqual(typeFromSamples([{ a: { a: 1, b: 1 }, b: { a: 1, b: 1 } }]));
  });

  it("[EXT.ENCODE] encodeValue writes a container at two places one time, thus the document shares its parts", () => {
    const doc = encodeValue({}, valueChain(LENGTH, Number.NaN)) as { readonly type: string; readonly value: Readonly<Record<string, unknown>> };
    expect(doc.type).toBe("record");
    expect(doc.value["a"]).toBe(doc.value["b"]);
    expect(encodeValue({}, valueChain(1, Number.NaN))).toEqual(encodeValue({}, { a: Number.NaN, b: Number.NaN }));
  });

  it("[DOC.SHARED] docEquals and sameValue read each pair of containers one time, thus two values that share their parts compare at once", () => {
    expect(docEquals(valueChain(LENGTH, 1), valueChain(LENGTH, 1))).toBe(true);
    expect(docEquals(valueChain(LENGTH, 1), valueChain(LENGTH, 2))).toBe(false);
    expect(docEquals(valueChain(LENGTH, [1, -0]), valueChain(LENGTH, [1, 0]))).toBe(false);
    expect(sameValue(valueChain(LENGTH, 1), valueChain(LENGTH, 1))).toBe(true);
    expect(sameValue(valueChain(LENGTH, 1), valueChain(LENGTH, 2))).toBe(false);
  });

  it("[TREE.KEY-ROOM] argsKey and documentKey read each distinct part one time, and a key past 16000000 characters is undefined", () => {
    // The key of a chain of n levels over 1 has 12 * 2^n - 11 characters: 12582901 for 20 levels, 25165813 for 21.
    expect(argsKey(valueChain(2, -0))).toBe('{"a":{"a":-0,"b":-0},"b":{"a":-0,"b":-0}}');
    expect(documentKey({ b: valueChain(1, 1), a: [] })).toBe('{"b":{"a":1,"b":1},"a":[]}');
    expect(argsKey(valueChain(20, 1))).toHaveLength(12582901);
    expect(documentKey(valueChain(20, 1))).toHaveLength(12582901);
    expect(argsKey(valueChain(21, 1))).toBeUndefined();
    expect(argsKey(valueChain(LENGTH, 1))).toBeUndefined();
    expect(documentKey(valueChain(LENGTH, 1))).toBeUndefined();
    // A value that is not JSON data still gives undefined.
    expect(argsKey(valueChain(3, Number.NaN))).toBeUndefined();
  });
});
