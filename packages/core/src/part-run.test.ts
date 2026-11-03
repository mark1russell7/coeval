import { describe, expect, it } from "vitest";
import { codeReader, readsOnlyCode } from "./evaluate.ts";
import {
  type Code,
  type CompiledEvaluator,
  type CompiledPart,
  type CompiledRunner,
  type Context,
  type EvalFn,
  type Evaluator,
  type Machine,
  type Result,
  type RunCode,
  type Runner,
  type Runtime,
  type Steps,
  STD_MACHINE,
  formulaMachine,
  makeContext,
  ok,
  prepare,
} from "./index.ts";

const ONE = { type: "number", value: 1 };
const TWO = { type: "number", value: 2 };
const SUM = { type: "add", value: [1, 2] };

/** The code of these parts reads no runtime. */
const NO_RUNTIME = undefined as unknown as Runtime;

/** This function gives the result of steps that do not wait. */
function done(steps: Steps): Result {
  const step = steps.next();
  if (step.done !== true) throw new Error("The steps wait.");
  return step.value;
}

/** This function gives a machine with a kind `host` of a list of parts, with the given code, and a kind `seen`. */
function hostMachine(code: { readonly evaluator?: Evaluator; readonly runner?: Runner }, rule: "mask" | "same" = "same"): Machine {
  const seen: EvalFn = ({ context }) => ok(context.caps);
  return {
    ...STD_MACHINE,
    world: {
      ...STD_MACHINE.world,
      kinds: {
        ...STD_MACHINE.world.kinds,
        host: { verbs: { eval: "host" }, parts: { shape: "list" }, caps: [{ rule }] },
        seen: { verbs: { eval: "seen" }, parts: { shape: "list" }, caps: [{ rule: "same" }] },
      },
    },
    evaluators: { ...STD_MACHINE.evaluators, seen, ...(code.evaluator === undefined ? {} : { host: code.evaluator }) },
    ...(code.runner === undefined ? {} : { runners: { ...STD_MACHINE.runners, host: code.runner } }),
  };
}

/** This function gives the compiled parts that a compiled evaluator of a host gets. */
function partsOfHost(doc: unknown, trace = false): readonly CompiledPart[] {
  let got: readonly CompiledPart[] = [];
  const evaluator: CompiledEvaluator = {
    compile: ({ parts }) => {
      got = parts;
      return () => ok(parts.length);
    },
  };
  prepare(hostMachine({ evaluator }), doc, { trace });
  return got;
}

function runField(part: CompiledPart | undefined): PropertyDescriptor {
  return Object.getOwnPropertyDescriptor(part, "run") as PropertyDescriptor;
}

describe("the steps of a part (D132)", () => {
  it("[PLAN.PART-RUN] a spread drops a getter of a prototype, and it keeps the steps of a part of a plan", () => {
    // The failure of a getter on a class: the copy has no field `run`, and a call of the field throws a TypeError.
    class OnPrototype {
      readonly code: Code = () => ok(1);
      get run(): RunCode {
        const code = this.code;
        return function* (ctx, rt) {
          return code(ctx, rt);
        };
      }
    }
    const late = new OnPrototype();
    expect(typeof late.run).toBe("function");
    const lost = { ...late } as { readonly run?: RunCode };
    expect(lost.run).toBeUndefined();
    expect(() => (lost.run as RunCode)(makeContext(), NO_RUNTIME)).toThrow(TypeError);

    // A compiler of a host copies each part with a spread and runs the copies.
    const copying: CompiledEvaluator = {
      compile: ({ parts }) => {
        const copies = parts.map((part) => ({ ...part }));
        return (ctx, rt) => ok(copies.map((copy) => (done(copy.run(ctx, rt)) as { readonly value: unknown }).value));
      },
    };
    expect(prepare(hostMachine({ evaluator: copying }), { type: "host", value: [SUM, 5] }).evaluate()).toEqual(ok([3, 5]));
  });

  it("[PLAN.PART-RUN] a copy with other code keeps the steps of the code of the original", () => {
    const part = partsOfHost({ type: "host", value: [ONE] })[0] as CompiledPart;
    const other: Code = () => ok("other");
    const copy = { ...part, code: other };
    expect(done(copy.run(makeContext(), NO_RUNTIME))).toEqual(ok(1));
    expect(copy.code(makeContext(), NO_RUNTIME)).toEqual(ok("other"));
  });

  it("[PLAN.PART-RUN] a part of a compiled evaluator of a host makes its steps at the first read, with the keys of a data field", () => {
    const parts = partsOfHost({ type: "host", value: [ONE, { ...TWO, name: "second" }, SUM] });
    expect(parts.map((part) => Object.keys(part))).toEqual([
      ["key", "path", "code", "run"],
      ["key", "path", "name", "code", "run"],
      ["key", "path", "code", "run"],
    ]);
    // All the parts share one getter, thus no part keeps a closure of its own before the first read.
    const fields = parts.map(runField);
    for (const field of fields) {
      expect(field.value).toBeUndefined();
      expect(field.get).toBe(fields[0]?.get);
      expect(field.enumerable).toBe(true);
    }
    // The first read leaves a data field, thus each later read is a load of the field.
    const part = parts[0] as CompiledPart;
    const steps = part.run;
    expect(runField(part)).toEqual({ value: steps, writable: true, enumerable: true, configurable: true });
    expect(part.run).toBe(steps);
    expect(runField(parts[1]).get).toBe(fields[0]?.get);
  });

  it("[PLAN.PART-RUN] steps that a compiler reads without the part run, as the steps of a data field do", () => {
    const { run: detached } = partsOfHost({ type: "host", value: [ONE] })[0] as CompiledPart;
    expect(done(detached(makeContext(), NO_RUNTIME))).toEqual(ok(1));
    const held: CompiledEvaluator = {
      compile: ({ parts }) => {
        const steps = (parts[0] as CompiledPart).run;
        return (ctx, rt) => done(steps(ctx, rt));
      },
    };
    expect(prepare(hostMachine({ evaluator: held }), { type: "host", value: [SUM] }).evaluate()).toEqual(ok(3));
  });

  it("[PLAN.PART-RUN] a frozen part gives steps at each read, and a copy of it has steps", () => {
    const part = Object.freeze(partsOfHost({ type: "host", value: [ONE] })[0] as CompiledPart);
    expect(done(part.run(makeContext(), NO_RUNTIME))).toEqual(ok(1));
    expect(done(part.run(makeContext(), NO_RUNTIME))).toEqual(ok(1));
    expect(done({ ...part }.run(makeContext(), NO_RUNTIME))).toEqual(ok(1));
  });

  it("[PLAN.PART-RUN] the late steps of a part narrow the context by the rules of the contract, as its code does", () => {
    const running: CompiledEvaluator = { compile: ({ parts }) => (ctx, rt) => done((parts[0] as CompiledPart).run(ctx, rt)) };
    const coding: CompiledEvaluator = { compile: ({ parts }) => (ctx, rt) => (parts[0] as CompiledPart).code(ctx, rt) };
    const doc = { type: "host", value: [{ type: "seen", value: [] }] };
    const ctx: Context = makeContext({}, ["log"]);
    expect(prepare(hostMachine({ evaluator: running }, "mask"), doc).evaluate(ctx)).toEqual(ok([]));
    expect(prepare(hostMachine({ evaluator: coding }, "mask"), doc).evaluate(ctx)).toEqual(ok([]));
    expect(prepare(hostMachine({ evaluator: running }), doc).evaluate(ctx)).toEqual(ok(["log"]));
  });

  it("[PLAN.PART-RUN] the parts of a runner, and a part with steps of its own, keep a data field", async () => {
    let got: readonly CompiledPart[] = [];
    const runner: CompiledRunner = {
      compileRun: ({ parts }) => {
        got = parts;
        return (ctx, rt) => (parts[0] as CompiledPart).run(ctx, rt);
      },
    };
    const machine = hostMachine({ runner });
    const doc = { type: "host", value: [SUM] };
    expect(await prepare(machine, doc).run()).toEqual(ok(3));
    expect(prepare(machine, doc).evaluate()).toEqual(ok(3));
    expect(typeof runField(got[0]).value).toBe("function");
    // A traced plan keeps the steps that record the trace.
    expect(typeof runField(partsOfHost({ type: "host", value: [ONE] }, true)[0]).value).toBe("function");
  });

  it("[PLAN.PART-RUN] a part under a plain evaluator or a compiler of the kernel keeps no steps, and a run gives the result of an evaluation", async () => {
    let got: readonly CompiledPart[] = [];
    const marked: CompiledEvaluator = {
      compile: codeReader(({ parts }) => {
        got = parts;
        return (ctx, rt) => (parts[0] as CompiledPart).code(ctx, rt);
      }),
    };
    expect(await prepare(hostMachine({ evaluator: marked }), { type: "host", value: [SUM] }).run()).toEqual(ok(3));
    expect(got.map((part) => Object.keys(part))).toEqual([["key", "path", "code"]]);
    const machine = formulaMachine();
    for (const name of Object.keys(machine.evaluators)) expect(readsOnlyCode(machine.evaluators[name] as Evaluator), name).toBe(true);
    const plain: EvalFn = () => ok(0);
    expect(readsOnlyCode(plain)).toBe(true);
    expect(readsOnlyCode({ compile: () => () => ok(0) })).toBe(false);
    const doc = { type: "list", value: [{ type: "lit", value: 1 }, { type: "lit", value: 2 }] };
    expect(await prepare(machine, doc).run()).toEqual(prepare(machine, doc).evaluate());
  });

  it("[PLAN.PART-RUN] a wrapper of a compiler of the kernel has no mark, thus its parts have steps", () => {
    const machine = formulaMachine();
    const real = machine.evaluators["formula.list"] as CompiledEvaluator;
    let got: readonly CompiledPart[] = [];
    const wrapper: CompiledEvaluator = {
      compile: (input) => {
        got = input.parts;
        return real.compile(input);
      },
    };
    expect(readsOnlyCode(wrapper)).toBe(false);
    const wrapped: Machine = { ...machine, evaluators: { ...machine.evaluators, "formula.list": wrapper } };
    expect(prepare(wrapped, { type: "list", value: [{ type: "lit", value: 1 }] }).evaluate()).toEqual(ok([1]));
    expect(done((got[0] as CompiledPart).run(makeContext(), NO_RUNTIME))).toEqual(ok(1));
  });
});
