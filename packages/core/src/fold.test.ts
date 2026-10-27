import { describe, expect, it } from "vitest";
import {
  type Effect,
  type FormulaProfile,
  type Json,
  type Key,
  type Machine,
  type Random,
  type Read,
  STD_MACHINE,
  agree,
  fail,
  formulaDefinitions,
  formulaMachine,
  generate,
  makeContext,
  ok,
  prepare,
  typesOf,
} from "./index.ts";

/* The folds of closed pure parts (K13, D43). */

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });
const op = (name: string, ...args: Json[]): Json => ({ type: ["ops", name], value: args });

/** A machine with a record kind and a number kind. Each evaluator counts its calls. */
function counting(): { readonly machine: Machine; readonly calls: { record: number; number: number } } {
  const calls = { record: 0, number: 0 };
  const machine: Machine = {
    world: {
      defaults: {},
      kinds: {
        rec: { verbs: { eval: "t.rec" }, parts: { shape: "map", of: "num" }, pure: true },
        num: { verbs: { eval: "t.num" }, pure: true },
      },
    },
    evaluators: {
      "t.rec": ({ parts }) => {
        calls.record += 1;
        const out: Record<string, unknown> = {};
        for (const part of parts) {
          const result = part.evaluate();
          if (!result.ok) return result;
          out[part.key] = result.value;
        }
        return ok(out);
      },
      "t.num": ({ doc }) => {
        calls.number += 1;
        return typeof doc.value === "number" ? ok(doc.value) : fail("#VALUE!", "num needs a number.");
      },
    },
  };
  return { machine, calls };
}

/** A formula machine with the operation `count`, which counts its calls. `pure` marks it pure in the profile. */
function withCount(pure: boolean): { readonly machine: Machine; readonly calls: unknown[]; readonly profile: FormulaProfile } {
  const calls: unknown[] = [];
  const ops = {
    count: (value: unknown) => {
      calls.push(value);
      return value;
    },
    add: (a: number, b: number) => a + b,
  };
  const profile: FormulaProfile = pure ? { ops, pure: ["count", "add"] } : { ops };
  return { machine: formulaMachine(profile), calls, profile };
}

/** This function tells if a value and each object in it are frozen. */
function deeplyFrozen(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
}

describe("the fold of a closed pure part", () => {
  it("[PLAN.FOLD] a record of literal fields evaluates one time, when the plan compiles, and gives a deeply frozen value", () => {
    const { machine, calls } = counting();
    const plan = prepare(machine, { type: "rec", value: { a: 1, b: 2, c: 3 } });
    expect(calls).toEqual({ record: 1, number: 3 });
    const first = plan.evaluate();
    plan.evaluate();
    plan.evaluate();
    expect(first).toEqual({ ok: true, value: { a: 1, b: 2, c: 3 } });
    expect(calls).toEqual({ record: 1, number: 3 });
    expect(deeplyFrozen(first)).toBe(true);
  });

  it("[PLAN.FOLD] a formula of literals, records, lists, if, and, or and let folds, and the operations that a profile marks pure fold too", () => {
    const { machine, calls } = withCount(true);
    const doc: Json = {
      type: "let",
      value: {
        bind: { x: op("count", 2) },
        body: {
          type: "record",
          value: {
            sum: op("add", ref("names", "x"), 1),
            list: { type: "list", value: [1, "a", { type: "lit", value: { deep: [true] } }] },
            pick: { type: "if", value: { test: { type: "and", value: [true, { type: "or", value: [false, true] }] }, then: "yes", else: "no" } },
          },
        },
      },
    };
    const plan = prepare(machine, doc);
    expect(calls).toEqual([2]);
    const result = plan.evaluate();
    expect(result).toEqual({ ok: true, value: { sum: 3, list: [1, "a", { deep: [true] }], pick: "yes" } });
    plan.evaluate();
    expect(calls).toEqual([2]);
    expect(deeplyFrozen(result)).toBe(true);
    // The same document with the option fold: false evaluates the operation at each evaluation.
    const unfolded = prepare(machine, doc, { fold: false });
    unfolded.evaluate();
    unfolded.evaluate();
    expect(calls).toEqual([2, 2, 2]);
    expect(unfolded.evaluate()).toEqual(result);
  });

  it("[PLAN.FOLD] an operation that the profile does not mark pure does not fold, and it runs at each evaluation", () => {
    const { machine, calls } = withCount(false);
    const plan = prepare(machine, { type: "record", value: { a: op("count", 1) } });
    expect(calls).toEqual([]);
    plan.evaluate();
    plan.evaluate();
    expect(calls).toEqual([1, 1]);
  });

  it("[PLAN.FOLD] a part with a free reference does not fold, and it reads the context of each evaluation", () => {
    const { machine, calls } = withCount(true);
    const plan = prepare(machine, { type: "record", value: { a: op("count", ref("names", "x")), b: 2 } });
    expect(plan.evaluate(makeContext({ x: 1 }))).toEqual({ ok: true, value: { a: 1, b: 2 } });
    expect(plan.evaluate(makeContext({ x: 5 }))).toEqual({ ok: true, value: { a: 5, b: 2 } });
    expect(calls).toEqual([1, 5]);
    // A reference through a binding to reference data reads the free name y (DEREF.READER), thus the let does not fold.
    const held = prepare(machine, { type: "let", value: { bind: { x: { type: "lit", value: ref("names", "y") } }, body: ref("names", "x") } });
    expect(held.evaluate(makeContext({ y: 7 }))).toEqual({ ok: true, value: 7 });
    expect(held.evaluate(makeContext({ y: 8 }))).toEqual({ ok: true, value: 8 });
  });

  it("[PLAN.FOLD] a part with an effect does not fold, and the effect happens at each evaluation", () => {
    const effects: Effect[] = [];
    const say = (declared: boolean): Machine => ({
      world: { kinds: { say: { verbs: { eval: "t.say" }, pure: true, ...(declared ? { effects: ["log"] } : {}) } }, defaults: {} },
      evaluators: { "t.say": ({ effect }) => effect("log", "hi") },
    });
    for (const declared of [true, false]) {
      // The second machine marks the kind pure, but its code causes an effect. The probe refuses the fold.
      const plan = prepare(say(declared), { type: "say", value: null });
      const ctx = makeContext({}, ["log"]);
      plan.evaluate(ctx, { effects });
      plan.evaluate(ctx, { effects });
    }
    expect(effects).toHaveLength(4);
  });

  it("[PLAN.FOLD] a part whose code reads a root of the context directly does not fold", () => {
    const machine: Machine = {
      world: { kinds: { who: { verbs: { eval: "t.who" }, pure: true } }, defaults: {} },
      evaluators: { "t.who": ({ context }) => ok(context.self === null ? "nobody" : String(context.self)) },
    };
    const plan = prepare(machine, { type: "who", value: null });
    expect(plan.evaluate(makeContext({}, [], "me"))).toEqual({ ok: true, value: "me" });
    expect(plan.evaluate(makeContext())).toEqual({ ok: true, value: "nobody" });
  });

  it("[PLAN.FOLD] a closed node of a tree does not fold, because its result depends on the self of its context (TREE.SELF)", () => {
    // The box reads nothing outside itself. In the open tree of the panel, it gives its node, and the panel reads its parent.
    const box: Json = { type: "box", value: { width: 1 } };
    const doc: Json = { type: "panel", value: { width: 2, height: ref("self", "children", 0, "parent", "width"), children: { type: "list", value: [box] } } };
    const expected = { ok: true, value: { width: 2, height: 2, children: [{ width: 1 }] } };
    expect(prepare(STD_MACHINE, doc).evaluate()).toEqual(expected);
    expect(prepare(STD_MACHINE, doc, { fold: false }).evaluate()).toEqual(expected);
    // The node resolves self, and the probe of the fold refuses that read. Thus each evaluation reads the self again.
    const reads: Read[] = [];
    expect(prepare(STD_MACHINE, box).evaluate(makeContext(), { reads })).toEqual({ ok: true, value: { width: 1 } });
    expect(reads.map((read) => read.path)).toEqual([["self"]]);
  });

  it("[PLAN.FOLD] a closure of fn does not fold, and a plan with a trace or with the option fold: false has no folds", () => {
    const { machine, calls } = withCount(true);
    // The body reads the parameter p, thus only the closure is closed, and it keeps its context.
    const call: Json = { type: "call", value: { fn: { type: "fn", value: { params: ["p"], body: op("count", ref("names", "p")) } }, args: [3] } };
    const closure = prepare(machine, call);
    expect(calls).toEqual([]);
    expect(closure.evaluate()).toEqual({ ok: true, value: 3 });
    expect(calls).toEqual([3]);
    calls.length = 0;
    const doc: Json = { type: "record", value: { a: op("count", 1) } };
    for (const options of [{ trace: true }, { fold: false }]) {
      const plan = prepare(machine, doc, options);
      const first = plan.evaluate();
      const second = plan.evaluate();
      expect(first.ok && second.ok && first.value !== second.value).toBe(true);
      expect(first.ok && Object.isFrozen(first.value)).toBe(false);
    }
    expect(calls).toEqual([1, 1, 1, 1]);
  });

  it("[PLAN.FOLD] a folded part that reads its own names gives each read to a list of reads, as the plan without folds does", () => {
    const { machine } = withCount(true);
    const doc: Json = { type: "let", value: { bind: { x: 2 }, body: op("add", ref("names", "x"), ref("names", "x")) } };
    const folded: Read[] = [];
    const unfolded: Read[] = [];
    expect(prepare(machine, doc).evaluate(makeContext(), { reads: folded })).toEqual({ ok: true, value: 4 });
    expect(prepare(machine, doc, { fold: false }).evaluate(makeContext(), { reads: unfolded })).toEqual({ ok: true, value: 4 });
    expect(folded).toHaveLength(2);
    expect(folded).toEqual(unfolded);
  });
});

describe("the shared values of a plan", () => {
  it("[PLAN.SHARED] two evaluations of one plan give the same frozen object for a folded part, and the document of the host stays as it was", () => {
    const { machine } = withCount(true);
    const data = { deep: { list: [1, 2] } };
    const doc: Json = { type: "record", value: { a: { type: "lit", value: data }, b: op("add", 1, 2) } };
    const plan = prepare(machine, doc);
    const first = plan.evaluate();
    const second = plan.evaluate(makeContext({ other: 1 }));
    expect(first.ok && second.ok && first.value === second.value).toBe(true);
    const value = (first.ok ? first.value : undefined) as { a: typeof data; b: number };
    expect(value).toEqual({ a: data, b: 3 });
    expect(value.a).not.toBe(data);
    expect(() => {
      value.b = 4;
    }).toThrow(TypeError);
    expect(() => {
      value.a.deep.list.push(3);
    }).toThrow(TypeError);
    // The fold copies the data, thus the host can still change its own document.
    expect(Object.isFrozen(data) || Object.isFrozen(data.deep.list)).toBe(false);
  });

  it("[PLAN.SHARED] a fold keeps the field __proto__ as data, and a result that is not plain data does not fold", () => {
    const { machine } = withCount(true);
    const plan = prepare(machine, { type: "lit", value: JSON.parse('{"__proto__": {"x": 1}}') as Json });
    const result = plan.evaluate();
    expect(result.ok && Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(result.ok && Object.hasOwn(result.value as object, "__proto__")).toBe(true);
    class Box {
      constructor(readonly v: number) {}
    }
    const boxes: Machine = { world: { kinds: { box: { verbs: { eval: "t.box" }, pure: true } }, defaults: {} }, evaluators: { "t.box": () => ok(new Box(1)) } };
    const boxed = prepare(boxes, { type: "box", value: null });
    const one = boxed.evaluate();
    const two = boxed.evaluate();
    expect(one.ok && two.ok && one.value !== two.value && !Object.isFrozen(one.value)).toBe(true);
  });
});

describe("folds on generated documents", () => {
  it("[PLAN.FOLD] the plan with folds and the plan without folds agree on generated formulas, and some parts fold", () => {
    const { machine, calls, profile } = withCount(true);
    const types = [...typesOf(machine.world), ["ops", "count"], ["ops", "count"], ["ops", "add"]];
    let fewer = 0;
    for (let index = 0; index < 300; index += 1) {
      // Some literals hold reference data, which resolves in the context of its reader (DEREF.READER).
      const data = (type: readonly Key[], rng: Random): Json | undefined => (type.join(".") === "lit" && rng.chance(0.15) ? ref("names", rng.pick(["a", "b"])) : undefined);
      const doc = generate(machine.world, { seed: 7_000_000 + index, declaredType: "lit", names: ["a", "b"], types, data });
      const ctx = makeContext({ a: 1, b: "two" });
      // The default tiers of agree include the plan without folds (folds).
      const outcome = agree(machine, doc, ctx, { strict: true, declaredType: "lit", definitions: formulaDefinitions(profile) });
      expect(outcome.ok, outcome.ok ? "" : `${outcome.tier}: ${outcome.reason} ${JSON.stringify(doc)}`).toBe(true);
      const folded = prepare(machine, doc, { declaredType: "lit" });
      const unfolded = prepare(machine, doc, { declaredType: "lit", fold: false });
      calls.length = 0;
      folded.evaluate(ctx);
      const withFolds = calls.length;
      calls.length = 0;
      unfolded.evaluate(ctx);
      if (withFolds < calls.length) fewer += 1;
    }
    expect(fewer).toBeGreaterThan(10);
  });
});
