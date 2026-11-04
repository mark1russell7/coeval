import { describe, expect, it } from "vitest";
import {
  type Configuration,
  type Context,
  type Effect,
  type EvalInput,
  type FormulaProfile,
  type Json,
  type Machine,
  type Result,
  Failure,
  context,
  fail,
  formulaDefinitions,
  formulaMachine,
  mergeMachines,
  ok,
  reference,
  stepper,
  stepperNext,
  stepperStart,
} from "./index.ts";

import type { Shape } from "./world.ts";

const PROFILE: FormulaProfile = {
  ops: {
    add: (...items: readonly unknown[]) => (items as readonly number[]).reduce((sum, item) => sum + item, 0),
    apply: (fn: unknown, value: unknown) => (fn as (item: unknown) => unknown)(value),
  },
};
const MACHINE = formulaMachine(PROFILE);
const DEFINED = formulaDefinitions(PROFILE);

const lit = (value: Json): Json => ({ type: "lit", value });
const name = (key: string): Json => ({ type: "ref", value: ["names", key] });
const op = (key: string, ...items: readonly Json[]): Json => ({ type: ["ops", key], value: items as Json });
const fn = (params: readonly string[], body: Json): Json => ({ type: "fn", value: { params, body } as never });
const call = (target: Json, ...args: readonly Json[]): Json => ({ type: "call", value: { fn: target, args } as never });
const letIn = (bind: Readonly<Record<string, Json>>, body: Json): Json => ({ type: "let", value: { bind, body } as never });
const when = (test: Json, then: Json, other?: Json): Json => ({ type: "if", value: { test, then, ...(other === undefined ? {} : { else: other }) } as never });

/** This function compares the stepper with the reference on one document. */
function same(machine: Machine, doc: unknown, at: Context = context(), definitions = {}, profile: FormulaProfile = {}): Result {
  const expected = reference(machine, doc, at, { definitions });
  const got = stepper(machine, doc, at, { profile, definitions });
  expect(got).toEqual(expected);
  return got;
}

describe("the stepper of the formula kit", () => {
  describe.each<[string, Json]>([
    ["a literal", lit(1)],
    ["a list", { type: "list", value: [lit(1), { type: "list", value: [lit(2)] }] }],
    ["a record", { type: "record", value: { a: lit(1), b: op("add", lit(1), lit(2)) } }],
    ["a let with a failed binding that the body reads", letIn({ a: name("gone") }, op("add", name("a"), lit(1)))],
    ["a let with a failed binding that the body does not read", letIn({ a: name("gone") }, lit(1))],
    ["a let without bindings", letIn({}, lit(2))],
    ["a call", call(fn(["a", "b"], op("add", name("a"), name("b"))), lit(1), lit(2))],
    ["a call of a value", call(lit(1))],
    ["a function with two equal params", fn(["a", "a"], lit(1))],
    ["a failed test", when(name("gone"), lit(1))],
    ["a test without a truth value", when(lit(1), lit(1))],
    ["a true test", when(lit(true), lit(1), lit(2))],
    ["a false test without else", when(lit(false), lit(1))],
    ["an and", { type: "and", value: [lit(true), lit(false), name("gone")] }],
    ["an empty or", { type: "or", value: [] }],
    ["an or without a truth value", { type: "or", value: [lit(1)] }],
    ["an unknown operation", op("gone", lit(1))],
    ["an unknown extension", { type: ["ext", "gone"], value: 1 }],
    ["a kind that the world does not have", { type: "gone", value: 1 }],
    ["a bad value", { type: "let", value: { body: lit(1) } }],
    ["a value without an envelope", 1],
    ["a path without steps", { type: "ref", value: [] }],
    ["a path with a computed step", { type: "ref", value: ["names", { type: "lit", value: "a" }] }],
    ["a step document", { type: "step", value: [lit(1)] }],
  ])("%s", (_name, doc) => {
    it("[STEPPER.FORMULA] the document gives the result of the reference", () => {
      same(MACHINE, doc, context({ names: { a: 3 } }), DEFINED, PROFILE);
    });
  });

  it("[STEPPER.CLOSURE] a closure in a result is a host function, and a host can call it", () => {
    const result = stepper(MACHINE, letIn({ b: lit(2) }, fn(["a"], op("add", name("a"), name("b")))), context(), { profile: PROFILE });
    const value = result.ok ? (result.value as (item: number) => number) : undefined;
    expect(value?.(3)).toBe(5);
    const held = stepper(MACHINE, letIn({ b: name("gone") }, fn([], name("b"))), context(), { profile: PROFILE });
    const broken = held.ok ? (held.value as () => unknown) : undefined;
    expect(() => broken?.()).toThrow(Failure);
  });

  it("[STEPPER.CLOSURE] an operation of the host calls a closure through a nested stepper", () => {
    const doc = op("apply", fn(["a"], op("add", name("a"), lit(1))), lit(2));
    expect(same(MACHINE, doc, context(), DEFINED, PROFILE)).toEqual(ok(3));
  });

  it("[STEPPER.LIMIT] the applications of functions have the limit of the reference", () => {
    const machine = { ...MACHINE, maxDepth: 8 };
    const loop = fn(["f"], call(name("f"), name("f")));
    same(machine, call(loop, loop), context(), DEFINED, PROFILE);
  });

  it("[STEPPER.PROFILE] an exception of a rule of the profile names the evaluator", () => {
    const profile: FormulaProfile = {
      truthy: () => {
        throw new Error("no truth");
      },
    };
    same(formulaMachine(profile), when(lit(1), lit(2)), context(), formulaDefinitions(profile), profile);
  });
});

describe("the judgments that the stepper reads itself", () => {
  const value = (input: EvalInput): Result => ok({ value: input.fill(input.parts.map((part) => part.key)), data: input.data, keys: input.parts.map((part) => part.key) } as never);
  const shaped = (parts: Shape): Machine => ({ world: { kinds: { lit: { verbs: { eval: "show" } }, k: { verbs: { eval: "show" }, parts } } }, evaluators: { show: value } }) as never;

  describe.each<[string, Shape, Json]>([
    ["no parts", { shape: "none" }, [1]],
    ["a term", { shape: "term", of: "lit" }, 1],
    ["a text", { shape: "text" }, 1],
    ["a good text", { shape: "text" }, "a"],
    ["a number", { shape: "number" }, "a"],
    ["a whole number", { shape: "number", whole: true }, 1.5],
    ["a minimum", { shape: "number", min: 2 }, 1],
    ["a maximum", { shape: "number", max: 0 }, 1],
    ["one of", { shape: "one", values: ["a"] }, "b"],
    ["a list of data", { shape: "list", item: { shape: "text" } }, ["a", "b"]],
    ["a list with a bad item", { shape: "list", item: { shape: "text" } }, ["a", 1]],
    ["not a list", { shape: "list", of: "lit" }, 1],
    ["a list twice", { shape: "list", of: "lit", distinct: true }, [1, 1]],
    ["a list of terms", { shape: "list", of: "lit" }, [1, 2]],
    ["a map", { shape: "map", of: "lit" }, { a: 1, b: 2 }],
    ["not a record", { shape: "map", of: "lit" }, 1],
    ["a record", { shape: "record", fields: ["a"], of: "lit" }, { a: 1 }],
    ["a missing field", { shape: "record", fields: ["a"], required: ["a"] }, {}],
    ["a closed record", { shape: "record", fields: { a: { shape: "text" } }, closed: true }, { a: "x", b: 1 }],
    ["a rest", { shape: "record", fields: { a: { shape: "text" } }, rest: { shape: "term", of: "lit" } }, { a: "x", b: 1 }],
    ["deep values", { shape: "deep", of: "lit" }, { a: [{ type: "lit", value: 1 }, 2], b: 3 }],
    ["deep data", { shape: "deep", of: "lit" }, { a: [1] }],
    ["permitted kinds", { shape: "term", kinds: [["lit"]] }, { type: "lit", value: 1 }],
    ["other kinds", { shape: "term", kinds: [["k"]] }, { type: "lit", value: 1 }],
    ["a bare part of a kind", { shape: "term", kinds: [["k"]] }, 1],
  ])("%s", (_name, parts, data) => {
    it("[STEPPER.SPLIT] the document gives the parts and the errors of the reference", () => {
      same(shaped(parts), { type: "k", value: data });
    });
  });

  const looked = {
    world: {
      kinds: {
        plain: { verbs: { eval: "show" } },
        link: { type: "ref", value: ["world", "plain"] },
        far: { type: "ref", value: ["world", "space"] },
        bad: { type: "ref", value: ["names", "plain"] },
        loop: { type: "ref", value: ["world", "loop"] },
        space: { kinds: { inner: { verbs: { eval: "show" } } } },
        open: { kinds: {}, fallback: { verbs: { eval: "show" } } },
      },
    },
    evaluators: { show: value },
  } as never as Machine;

  describe.each<[string, Json]>([
    ["an alias", "link"],
    ["an alias with keys after it", ["far", "inner"]],
    ["an alias out of the world", "bad"],
    ["an alias that loops", "loop"],
    ["a namespace", ["space", "inner"]],
    ["a namespace as a kind", "space"],
    ["a kind with a key after it", ["plain", "more"]],
    ["a fallback", ["open", "more"]],
    ["a missing key", ["space", "gone"]],
    ["a computed type", { type: "ref", value: ["world", "plain"] }],
    ["a computed type with a document", { type: "ref", value: ["world", { type: "lit", value: 1 }] }],
  ])("%s", (_name, type) => {
    it("[STEPPER.LOOKUP] the document gives the kind of the reference", () => {
      same(looked, { type, value: 1 });
    });
  });

  const walked = mergeMachines(MACHINE, {
    world: { kinds: { box: { verbs: { deref: "box.get" } }, pick: { verbs: { step: "pick" } } } },
    derefs: {
      "box.get": Object.assign((doc: { readonly value: unknown }, key: unknown) => (doc.value as Record<string, unknown>)[String(key)], { has: (_doc: unknown, key: unknown) => key === "none" }),
    },
    walkers: {
      pick: (input: { readonly data: unknown; readonly here: unknown; readonly deref: (thing: unknown, key: string) => unknown; readonly has: (thing: unknown, key: string) => boolean }) => {
        if (input.data === "fail") return { ok: false, code: "#N/A", reason: "The walker refuses." };
        return input.has(input.here, "a") ? { ok: true, thing: input.deref(input.here, "a") } : { ok: false, reason: "No field a." };
      },
    },
  } as never);
  const names = {
    box: { type: "box", value: { a: 1 } },
    list: [1, 2],
    pointer: { type: "ref", value: ["names", "list"] },
    round: { type: "ref", value: ["names", "round"] },
    bad: { type: "ref", value: ["names", "gone"] },
    record: { a: 2, b: { type: "ref", value: ["names", "list"] } },
  } as never;

  describe.each<[string, readonly Json[]]>([
    ["a field", ["names", "record", "a"]],
    ["a field through a reference", ["names", "record", "b", 1]],
    ["a length", ["names", "list", "length"]],
    ["an index as a text", ["names", "list", "1"]],
    ["an index past the end", ["names", "list", 5]],
    ["a key of a value", ["names", "list", "a"]],
    ["a key of a number", ["names", "list", 0, "a"]],
    ["a deref", ["names", "box", "a"]],
    ["a deref to nothing", ["names", "box", "b"]],
    ["a deref to undefined", ["names", "box", "none"]],
    ["a reference", ["names", "pointer"]],
    ["a cycle", ["names", "round"]],
    ["a bad reference", ["names", "bad"]],
    ["a walker", ["names", "record", { type: "pick", value: 1 }]],
    ["a failed walker", ["names", "record", { type: "pick", value: "fail" }]],
    ["a walker without a field", ["names", "list", { type: "pick", value: 1 }]],
    ["a step without a walker", ["names", "list", { type: "lit", value: 1 }]],
    ["a root that is not one", ["gone"]],
    ["the root self", ["self"]],
  ])("%s", (_name, path) => {
    it("[STEPPER.PATH] the document gives the result of the reference", () => {
      same(walked, { type: "ref", value: path as Json }, context({ names }), DEFINED, PROFILE);
    });
  });

  it("[STEPPER.PATH] a chain of more than 64 references gives #CYCLE!, as in the reference", () => {
    const chain: Record<string, Json> = { n65: 1 };
    for (let index = 0; index < 65; index += 1) chain[`n${index}`] = { type: "ref", value: ["names", `n${index + 1}`] };
    same(MACHINE, name("n0"), context({ names: chain as never }), DEFINED, PROFILE);
  });
});

describe("effects in the stepper", () => {
  const says = { world: { kinds: { say: { verbs: { eval: "say" } } } }, evaluators: { say: (input: EvalInput) => input.effect("log", input.value) } } as never as Machine;
  const doc = { type: "say", value: "a" };

  it("[STEPPER.EFFECT] an effect of a host evaluator keeps the address, the outcome and the capability of the reference", () => {
    const seen: Effect[] = [];
    expect(stepper(says, doc, context({ caps: [["log"]] }), { effects: seen, perform: (effect) => `done ${String(effect.payload)}` })).toEqual(ok("done a"));
    expect(seen.map((effect) => [effect.kind, effect.address])).toEqual([["log", "#0"]]);
    same(says, doc, context({ caps: [] }));
  });

  it("[STEPPER.EFFECT] a mock that throws or waits gives the error of the reference", () => {
    const at = context({ caps: [["log"]] });
    const check = (perform: (effect: Effect) => unknown): void => {
      expect(stepper(says, doc, at, { perform })).toEqual(reference(says, doc, at, { perform }));
    };
    check(() => {
      throw new Error("no");
    });
    check(() => {
      throw new Failure(fail("#MOCK", "no").error);
    });
    check(() => Promise.resolve(1));
  });
});

describe("the stack of the stepper", () => {
  const nest = (depth: number): Json => {
    let doc = lit(1);
    for (let index = 0; index < depth; index += 1) doc = { type: "list", value: [doc] };
    return doc;
  };

  it("[STEPPER.DEEP] a list nested 100000 times evaluates", () => {
    const result = stepper({ ...MACHINE, maxDepth: 200_000 }, nest(100_000), context(), { profile: PROFILE });
    let here = result.ok ? result.value : undefined;
    let depth = 0;
    while (Array.isArray(here)) {
      here = here[0];
      depth += 1;
    }
    expect([depth, here]).toEqual([100_000, 1]);
  });

  it("[STEPPER.DEEP] the limit of the depth is the limit of the reference", () => {
    const machine = { ...MACHINE, maxDepth: 50 };
    for (const depth of [50, 51]) same(machine, nest(depth), context(), DEFINED, PROFILE);
  });
});

describe("a configuration as data", () => {
  const docs: readonly (readonly [string, Json])[] = [
    ["a let with a closure", letIn({ inc: fn(["a"], op("add", name("a"), lit(1))), gone: name("gone") }, call(name("inc"), lit(2)))],
    ["a branch and a record", { type: "record", value: { a: when(lit(true), lit(1)), b: { type: "list", value: [lit(1), op("add", lit(1), lit(2))] } } }],
    ["an and", { type: "and", value: [lit(true), when(lit(true), lit(false))] }],
    ["an error", letIn({ a: name("gone") }, op("add", name("a"), lit(1)))],
  ];
  const options = { profile: PROFILE };

  describe.each(docs)("%s", (_name, doc) => {
    it("[STEPPER.DATA] the document gives one result when each configuration goes through JSON", () => {
      let now = JSON.parse(JSON.stringify(stepperStart(MACHINE, doc, context(), options))) as Configuration;
      let steps = 0;
      while (now.mode !== "done" && steps < 1000) {
        now = JSON.parse(JSON.stringify(stepperNext(MACHINE, now, options))) as Configuration;
        steps += 1;
      }
      expect(steps).toBeGreaterThan(1);
      expect(now).toMatchObject({ mode: "done", result: stepper(MACHINE, doc, context(), options) });
    });
  });

  it("[STEPPER.PURE] one step leaves its configuration as it is, thus a host can step it twice", () => {
    let now = stepperStart(MACHINE, docs[0]?.[1], context(), options);
    while (now.mode !== "done") {
      const before = JSON.stringify(now);
      const next = stepperNext(MACHINE, now, options);
      expect(JSON.stringify(now)).toBe(before);
      expect(JSON.stringify(stepperNext(MACHINE, now, options))).toBe(JSON.stringify(next));
      now = next;
    }
    expect(stepperNext(MACHINE, now, options)).toEqual(now);
  });
});
