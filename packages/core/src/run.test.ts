import { describe, expect, it } from "vitest";
import {
  type Effect,
  type EvalError,
  type Json,
  type Machine,
  type CompiledRunner,
  type Runner,
  type Steps,
  type TraceNode,
  Failure,
  STD_CAPS,
  STD_MACHINE,
  check,
  conforms,
  effectsOf,
  evaluate,
  fail,
  formulaMachine,
  generate,
  ifRunner,
  makeContext,
  mergeMachines,
  ok,
  permits,
  prepare,
  reference,
  referenceRun,
  run,
  sameResult,
  stepper,
  typesOf,
} from "./index.ts";
import { overflowCount } from "./errors.ts";
import { heldReason } from "./evaluate.ts";

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });

describe("a run", () => {
  it("[RUN.SEQ] waits for each effect, and gives its result to the next step as last", async () => {
    const order: string[] = [];
    const out = await run(
      STD_MACHINE,
      {
        type: "seq",
        value: [
          { type: "write", value: { key: "a", value: { type: "number", value: 2 } } },
          { type: "log", value: [ref("names", "last")] },
        ],
      },
      makeContext({}, STD_CAPS),
      {
        perform: async (effect: Effect) => {
          order.push(`start ${effect.kind}`);
          await new Promise((done) => setTimeout(done, 5));
          order.push(`end ${effect.kind}`);
          return effect.kind === "write" ? "stored" : effect.payload;
        },
      },
    );
    expect(out.result).toEqual({ ok: true, value: "stored" });
    expect(order).toEqual(["start write", "end write", "start log", "end log"]);
    expect(out.effects.map((effect) => [effect.kind, effect.payload])).toEqual([
      ["write", { key: "a", value: 2 }],
      ["log", "stored"],
    ]);
  });

  it("[RUN.EAGER] does the part before the first wait at once, in the call", () => {
    const seen: string[] = [];
    void run(STD_MACHINE, { type: "log", value: ["now"] }, makeContext({}, STD_CAPS), {
      perform: (effect) => {
        seen.push(String(effect.payload));
        return null;
      },
    });
    expect(seen).toEqual(["now"]);
  });

  it("[RUN.STOP] stops at a failed step, and the later effects do not happen", async () => {
    const performed: string[] = [];
    const out = await run(
      STD_MACHINE,
      { type: "seq", value: [{ type: "log", value: ["one"] }, { type: "log", value: ["two"] }] },
      makeContext({}, STD_CAPS),
      {
        perform: (effect) => {
          performed.push(String(effect.payload));
          if (effect.payload === "one") throw new Error("the disk is full");
          return null;
        },
      },
    );
    expect(out.result).toMatchObject({ ok: false, error: { code: "#CALC!" } });
    expect(performed).toEqual(["one"]);
  });

  it("[RUN.CAP] refuses an effect without its capability, and the host does not see it", async () => {
    let calls = 0;
    const out = await run(STD_MACHINE, { type: "log", value: ["x"] }, makeContext({}, ["write"]), {
      perform: () => {
        calls += 1;
        return null;
      },
    });
    expect(out.result).toMatchObject({ ok: false, error: { code: "#CAP!" } });
    expect(calls).toBe(0);
  });

  it("[RUN.PURE] refuses an effect inside pure, also in a run", async () => {
    const out = await run(STD_MACHINE, { type: "pure", value: [{ type: "log", value: ["x"] }] }, makeContext({}, STD_CAPS));
    expect(out.result).toMatchObject({ ok: false, error: { code: "#CAP!" } });
  });

  it("[RUN.SAME] gives the same derived values as an evaluation", async () => {
    const doc: Json = { type: "if", value: { test: { type: "greater", value: [3, 2] }, then: { type: "add", value: [1, 2] } } };
    const out = await run(STD_MACHINE, doc, makeContext({}, STD_CAPS));
    expect(out.result).toEqual(evaluate(STD_MACHINE, doc, makeContext({}, STD_CAPS)).result);
    expect(out.result).toEqual({ ok: true, value: 3 });
  });

  describe("ifRunner", () => {
    const loose = (value: unknown): boolean | undefined => (typeof value === "string" ? undefined : Boolean(value));
    const machine: Machine = { ...STD_MACHINE, runners: { ...STD_MACHINE.runners, "host.if": ifRunner(loose) } };
    const step = (value: Json): Json => ({ type: "if", value, own: { eval: "host.if" } });
    const log: Json = { type: "log", value: ["x"] };
    const context = () => makeContext({}, STD_CAPS);

    it("[RUN.IF-TRUTH] reads the given truth and waits for the host in a branch", async () => {
      const performed: string[] = [];
      const perform = async (effect: Effect): Promise<unknown> => {
        performed.push(effect.kind);
        await new Promise((done) => setTimeout(done, 1));
        return "done";
      };
      const out = await run(machine, step({ test: { type: "number", value: 1 }, then: log, else: { type: "number", value: 2 } }), context(), { perform });
      expect(out.result).toEqual({ ok: true, value: "done" });
      expect(performed).toEqual(["log"]);
      const other = await run(machine, step({ test: { type: "number", value: 0 }, then: log, else: { type: "number", value: 2 } }), context(), { perform });
      expect(other.result).toEqual({ ok: true, value: 2 });
      expect(performed).toEqual(["log"]);
    });

    it("[RUN.IF-TRUTH] gives one result for each failure, in a run and in an evaluation", async () => {
      const cases: readonly (readonly [Json, unknown])[] = [
        [step({ then: 1 }), { ok: false, error: { code: "#VALUE!", reason: "if needs a test." } }],
        [step({ test: { type: "ref", value: ["names", "nothing"] }, then: 1 }), { ok: false, error: { code: "#NAME?" } }],
        [step({ test: { type: "text", value: "x" }, then: 1 }), { ok: false, error: { code: "#VALUE!", reason: "The test of if must give a truth value." } }],
        [step({ test: { type: "number", value: 0 }, then: 1 }), { ok: true, value: null }],
      ];
      for (const [doc, want] of cases) {
        expect((await run(machine, doc, context())).result).toMatchObject(want as object);
        expect(evaluate(machine, doc, context()).result).toMatchObject(want as object);
      }
    });

    it("[RUN.IF-TRUTH] keeps the truth of control.if: only a boolean", () => {
      const doc: Json = { type: "if", value: { test: { type: "number", value: 1 }, then: 1 } };
      expect(evaluate(STD_MACHINE, doc, context()).result).toMatchObject({ ok: false, error: { code: "#VALUE!", reason: "The test of if must give a truth value." } });
      expect(evaluate(machine, step({ test: { type: "number", value: 1 }, then: { type: "number", value: 7 } }), context()).result).toEqual({ ok: true, value: 7 });
    });
  });

  it("[RUN.NESTED-WAIT] refuses a step that waits inside a part that cannot wait", async () => {
    const doc: Json = { type: "add", value: [1, { type: "log", value: ["x"] }] };
    const out = await run(STD_MACHINE, doc, makeContext({}, STD_CAPS), { perform: () => Promise.resolve(2) });
    expect(out.result).toMatchObject({ ok: false, error: { code: "#CALC!", place: [1] } });
    // The host does not get the effect, thus the effect keeps the #CALC! of the run (RUN.HELD).
    expect(out.effects.map((effect) => [effect.kind, effect.outcome])).toEqual([["log", fail("#CALC!", heldReason("log"), { place: [1] })]]);
  });

  it("[RUN.DRIVE-NESTED] a run drives a runner under an evaluator, and only a real wait gives #CALC!", async () => {
    const ctx = makeContext({}, STD_CAPS);
    // pure is a runner that does not wait. The run drives it under add, as an evaluation does.
    const pure: Json = { type: "add", value: [1, { type: "pure", value: [{ type: "number", value: 2 }] }] };
    expect((await run(STD_MACHINE, pure, ctx)).result).toEqual(ok(3));
    expect(check(STD_MACHINE, pure, { run: true })).toEqual([]);
    // An if under an operation in the test of another if. Its branch that waits is not taken, thus the run has no wait.
    const inner = (test: boolean): Json => ({ type: "if", value: { test: { type: "bool", value: test }, then: { type: "number", value: 3 }, else: { type: "log", value: ["x"] } } });
    const outer = (test: boolean): Json => ({ type: "if", value: { test: { type: "greater", value: [inner(test), 2] }, then: { type: "text", value: "big" }, else: { type: "text", value: "small" } } });
    const waits = (): Promise<unknown> => Promise.resolve("done");
    const taken = await run(STD_MACHINE, outer(true), ctx, { perform: waits });
    expect(taken.result).toEqual(ok("big"));
    expect(taken.result).toEqual(evaluate(STD_MACHINE, outer(true), ctx).result);
    expect(taken.effects).toEqual([]);
    // The same if with the branch that waits taken gives #CALC! at the place of the if under the operation.
    const waited = await run(STD_MACHINE, outer(false), ctx, { perform: waits });
    const issues = check(STD_MACHINE, outer(false), { run: true });
    expect(issues).toEqual([{ code: "#CALC!", place: ["test", 0], reason: "if waits for effects, and its parent cannot wait. Give the parent a runner.", at: ["value", "test", "value", 0] }]);
    expect(waited.result).toEqual({ ok: false, error: expect.objectContaining({ code: "#CALC!", place: ["test", 0], reason: issues[0]?.reason }) });
    // A host that answers at once does not get the effect either, because the parent cannot wait (RUN.HELD).
    const answers = (): string => "done";
    const atOnce = await run(STD_MACHINE, outer(false), ctx, { perform: answers });
    expect(atOnce.result).toEqual(waited.result);
  });

  it("[RUN.DRIVES] a runner that evaluates a part with its code declares it in drives, and the check of the waits is exact", async () => {
    const ctx = makeContext({}, STD_CAPS);
    // The runner evaluates its first part with its code, without a wait, and runs its second part with its steps.
    const mixed: CompiledRunner = {
      compileRun: ({ parts }) =>
        function* (inner, rt) {
          const first = parts[0]?.code(inner, rt);
          if (first === undefined || !first.ok) return first ?? ok(null);
          const second = parts[1] === undefined ? ok(null) : yield* parts[1].run(inner, rt);
          if (!second.ok) return second;
          return ok([first.value, second.value]);
        },
    };
    const kind = (drives?: readonly { readonly in?: readonly (readonly number[])[] }[]): Machine => ({
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, mixed: { verbs: { eval: "test.mixed" }, parts: { shape: "list" }, ...(drives === undefined ? {} : { drives }) } } },
      runners: { ...STD_MACHINE.runners, "test.mixed": mixed },
    });
    const log: Json = { type: "log", value: ["x"] };
    const doc: Json = { type: "mixed", value: [log, log] };
    const waits = (): Promise<unknown> => Promise.resolve("done");
    // Without drives, the check assumes that the runner passes each wait through. Only the run finds the wait.
    expect(check(kind(), doc, { run: true })).toEqual([]);
    const done = await run(kind(), doc, ctx, { perform: waits });
    expect(done.result).toMatchObject({ ok: false, error: { code: "#CALC!", place: [0] } });
    // With drives for the first part, the check gives the #CALC! of the run, at the same place and with the same reason.
    const marked = kind([{ in: [[0]] }]);
    const issues = check(marked, doc, { run: true });
    expect(issues).toEqual([{ code: "#CALC!", place: [0], reason: "log waits for effects, and its parent cannot wait. Give the parent a runner.", at: ["value", 0] }]);
    const again = await run(marked, doc, ctx, { perform: waits });
    expect(again.result).toEqual({ ok: false, error: expect.objectContaining({ code: "#CALC!", place: [0], reason: issues[0]?.reason }) });
    // A part that does not wait under drives gives no issue, and the run gives its value.
    const quiet: Json = { type: "mixed", value: [{ type: "number", value: 1 }, log] };
    expect(check(marked, quiet, { run: true })).toEqual([]);
    expect((await run(marked, quiet, ctx, { perform: waits })).result).toEqual(ok([1, "done"]));
    // The hook facts can declare drives for the code of a name. Its answer wins over the contract.
    const hooked: Machine = { ...kind(), facts: (path, code) => (code === "test.mixed" ? { drives: [{ in: [[0]] }] } : STD_MACHINE.facts?.(path, code)) };
    expect(check(hooked, doc, { run: true })).toEqual(issues);
  });

  it("[RUN.HELD] in a run, an effect under a parent that cannot wait does not reach the host, and keeps #CALC!", async () => {
    const ctx = makeContext({}, STD_CAPS);
    const doc: Json = { type: "add", value: [1, { type: "log", value: ["x"] }] };
    const reason = check(STD_MACHINE, doc, { run: true })[0]?.reason ?? "";
    // Before K202, the host did the effect, and the run lost its answer: a retry did the effect again.
    for (const answer of [(): unknown => Promise.resolve("done"), (): unknown => "done"]) {
      const performed: unknown[] = [];
      const perform = (effect: Effect): unknown => {
        performed.push(effect.payload);
        return answer();
      };
      const done = await run(STD_MACHINE, doc, ctx, { perform });
      expect(performed).toEqual([]);
      expect(done.result).toEqual(fail("#CALC!", reason, { place: [1] }));
      expect(done.effects.map((effect) => effect.outcome)).toEqual([fail("#CALC!", heldReason("log"), { place: [1] })]);
      expect(await referenceRun(STD_MACHINE, doc, ctx, { perform })).toEqual(done.result);
      expect(performed).toEqual([]);
    }
    // The same runner at the root can wait, thus the host gets its effect.
    const performed: unknown[] = [];
    const root = await run(STD_MACHINE, { type: "log", value: ["x"] }, ctx, {
      perform: (effect) => {
        performed.push(effect.payload);
        return Promise.resolve("done");
      },
    });
    expect(root.result.ok).toBe(true);
    expect(performed).toHaveLength(1);
  });
});

/** This function tells if a trace has a runner under an evaluator: a run refused such a runner before K110. */
function nested(node: TraceNode, runners: Readonly<Record<string, unknown>>, parentRuns: boolean): boolean {
  const name = node.answer.evaluator;
  const runs = name !== undefined && Object.hasOwn(runners, name);
  if (runs && !parentRuns) return true;
  return node.children.some((child) => nested(child, runners, runs));
}

describe("one meaning of a run and an evaluation", () => {
  it("[RUN.SAME] a generated document without effects runs to the result of its evaluation", async () => {
    const world = STD_MACHINE.world;
    const types = [...typesOf(world), ["pure"], ["pure"], ["if"], ["seq"], ["add"]];
    const runners = STD_MACHINE.runners ?? {};
    const ctx = makeContext({ a: 1 }, STD_CAPS);
    let compared = 0;
    let drives = 0;
    const differ: string[] = [];
    for (let index = 0; index < 400; index += 1) {
      const doc = generate(world, { seed: 7_100_000 + index, types, names: ["a"], malformed: 0.02 });
      // A document without effects: its runners do not wait (C6).
      if (effectsOf(STD_MACHINE, doc).length > 0) continue;
      const evaluation = evaluate(STD_MACHINE, doc, ctx);
      const done = await run(STD_MACHINE, doc, ctx);
      compared += 1;
      if (nested(evaluation.trace, runners, true)) drives += 1;
      if (!sameResult(done.result, evaluation.result)) differ.push(`seed ${7_100_000 + index}: ${JSON.stringify(done.result)} for ${JSON.stringify(evaluation.result)}
  doc ${JSON.stringify(doc)}`);
    }
    expect(differ.slice(0, 3)).toEqual([]);
    expect(compared).toBeGreaterThan(100);
    // The documents put runners under evaluators, where a run refused them before K110.
    expect(drives).toBeGreaterThan(20);
  });
});

describe("capabilities", () => {
  it("[CAP.NAMESPACE] permit a kind by its name, or by its namespace", () => {
    expect(permits(["store"], "store.update")).toBe(true);
    expect(permits(["store.update"], "store.update")).toBe(true);
    expect(permits(["store.update"], "store.remove")).toBe(false);
    expect(permits(["store"], "storefront")).toBe(false);
  });
});

/** A sequence that writes, then logs the result of the write. */
const WRITE_THEN_LOG: Json = {
  type: "seq",
  value: [
    { type: "write", value: { key: "a", value: { type: "number", value: 2 } } },
    { type: "log", value: [ref("names", "last")] },
  ],
};

/** A mock of the host: a write gives a text, and a log gives its payload in a list. */
const mock = (effect: Effect): unknown => (effect.kind === "write" ? "stored" : [effect.payload]);

const log = (text: string): Json => ({ type: "log", value: [text] });

/** The runner of `par`: it runs its parts at the same time. */
const par: Runner = function* ({ parts, all }): Steps {
  const results = yield* all(parts);
  return ok(results.map((result) => (result.ok ? result.value : result.error.code)));
};

/** The runner of `twice`: it evaluates its part two times, at the same place. */
const twice: Runner = function* ({ parts }): Steps {
  const only = parts[0];
  if (only === undefined) return ok(null);
  const first = yield* only.evaluate();
  const second = yield* only.evaluate();
  return ok([first.ok ? first.value : null, second.ok ? second.value : null]);
};

/** The standard machine with `par`, `twice`, a record `rec` with an unusual key, and `ping`, whose evaluator causes an effect. */
const machine: Machine = {
  ...STD_MACHINE,
  world: {
    ...STD_MACHINE.world,
    kinds: {
      ...STD_MACHINE.world.kinds,
      par: { verbs: { eval: "par" }, parts: { shape: "list" } },
      twice: { verbs: { eval: "twice" }, parts: { shape: "list" } },
      rec: { verbs: { eval: "list.all" }, parts: { shape: "record", fields: ["a.b"] } },
      ping: { verbs: { eval: "ping" }, side: "run", effects: ["log"] },
    },
  },
  evaluators: { ...STD_MACHINE.evaluators, ping: ({ effect }) => effect("log", "ping") },
  runners: { ...STD_MACHINE.runners, par, twice },
};

function byAddress(effects: readonly Effect[]): readonly (readonly unknown[])[] {
  return effects.map((effect) => [effect.address, effect.payload]).sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
}

describe("a mock, the outcomes and the addresses", () => {
  it("[RUN.MOCK] an evaluation takes a mock perform: its answer is the result of the effect, as in a run", async () => {
    const ctx = makeContext({}, STD_CAPS);
    const ran = await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: mock });
    expect(ran.result).toEqual(ok(["stored"]));
    // evaluate, a plan and the reference give the result of the run.
    expect(evaluate(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: mock }).result).toEqual(ran.result);
    expect(prepare(STD_MACHINE, WRITE_THEN_LOG).evaluate(ctx, { perform: mock })).toEqual(ran.result);
    expect(reference(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: mock })).toEqual(ran.result);
    // Without a mock, an effect gives its payload (RUN.EVAL). A text is still the declared type.
    expect(evaluate(STD_MACHINE, WRITE_THEN_LOG, ctx).result).toEqual(ok({ key: "a", value: 2 }));
    expect(evaluate(STD_MACHINE, 2, ctx, "number").result).toEqual(ok(2));
    // The mock answers the effect of an evaluator too.
    expect(prepare(machine, { type: "ping", value: null }).evaluate(ctx, { perform: () => "pong" })).toEqual(ok("pong"));
    expect(reference(machine, { type: "ping", value: null }, ctx, { perform: () => "pong" })).toEqual(ok("pong"));
    // A promise from the mock gives #CALC! at the effect, because an evaluation does not wait.
    const late = { code: "#CALC!", place: [0], reason: "The mock gave a promise for the effect write, and an evaluation does not wait." };
    expect(prepare(STD_MACHINE, WRITE_THEN_LOG).evaluate(ctx, { perform: () => Promise.reject(new Error("late")) })).toMatchObject({ ok: false, error: late });
    expect(reference(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: () => Promise.resolve(1) })).toMatchObject({ ok: false, error: late });
    // A throw gives #CALC! with the cause, as in a run (RUN.CAUSE).
    const boom = new Error("boom");
    const thrower = (): never => {
      throw boom;
    };
    const failed = { ok: false, error: { code: "#CALC!", place: [0], cause: boom } };
    expect(evaluate(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: thrower }).result).toMatchObject(failed);
    expect(reference(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: thrower })).toMatchObject(failed);
    expect((await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: thrower })).result).toMatchObject(failed);
  });

  it("[RUN.OUTCOME] each effect records its outcome, a Failure gives its own error, and a stopped run leaves no outcome", async () => {
    const ctx = makeContext({}, STD_CAPS);
    const ran = await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: async (effect) => mock(effect) });
    expect(ran.effects.map((effect) => effect.outcome)).toEqual([ok("stored"), ok(["stored"])]);
    // An evaluation without a mock gives each effect its payload, and that is the outcome.
    expect(evaluate(STD_MACHINE, WRITE_THEN_LOG, ctx).effects.map((effect) => effect.outcome)).toEqual([ok({ key: "a", value: 2 }), ok({ key: "a", value: 2 })]);
    // An error of the host is the outcome, with its cause.
    const boom = new Error("boom");
    const failed = await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: () => Promise.reject(boom) });
    expect(failed.effects.map((effect) => effect.outcome)).toMatchObject([{ ok: false, error: { code: "#CALC!", place: [0], cause: boom } }]);
    // A Failure carries its own error value through the host.
    const full = (): never => {
      throw new Failure({ code: "#FULL", reason: "The store is full." });
    };
    const mine = await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: full });
    expect(mine.result).toEqual({ ok: false, error: { code: "#FULL", reason: "The store is full.", place: [0] } });
    expect(mine.effects[0]?.outcome).toEqual(mine.result);
    expect(evaluate(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: full }).result).toEqual(mine.result);
    // An abort stops the run at its wait, thus the effect has no outcome.
    const controller = new AbortController();
    const pending = run(STD_MACHINE, WRITE_THEN_LOG, ctx, { signal: controller.signal, perform: () => new Promise(() => undefined) });
    controller.abort("closed");
    const stopped = await pending;
    expect(stopped.result).toMatchObject({ ok: false, error: { code: "#ABORT" } });
    expect(stopped.effects.map((effect) => effect.outcome)).toEqual([undefined]);
  });

  it("[RUN.OUTCOME-OVERFLOW] a stack overflow of the host in an effect gives #DEPTH! in each engine, and the kernel counts it", async () => {
    const ctx = makeContext({}, STD_CAPS);
    // The mock throws the error of a stack overflow, as the host does at the limit of its stack. Thus the test needs no deep code.
    const overflow = (): RangeError => new RangeError("Maximum call stack size exceeded");
    const throws = (): never => {
      throw overflow();
    };
    const rejects = (): Promise<never> => Promise.reject(overflow());
    const deep = { ok: false, error: { code: "#DEPTH!", place: [0] } };
    const before = overflowCount();
    expect(evaluate(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: throws }).result).toMatchObject(deep);
    expect(prepare(STD_MACHINE, WRITE_THEN_LOG).evaluate(ctx, { perform: throws })).toMatchObject(deep);
    expect(reference(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: throws })).toMatchObject(deep);
    // The stepper has no runner of seq, thus it takes the effect of an evaluator at the root.
    const ping: Json = { type: "ping", value: null };
    expect(stepper(machine, ping, ctx, { perform: throws })).toMatchObject({ ok: false, error: { code: "#DEPTH!", place: [] } });
    for (const perform of [throws, rejects]) {
      const ran = await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform });
      expect(ran.result).toMatchObject(deep);
      expect(ran.effects[0]?.outcome).toEqual(ran.result);
      expect(await referenceRun(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform })).toMatchObject(deep);
    }
    // Each engine counts the overflow one time. Thus a cache that compares two counts finds it (DURABLE.OVERFLOW).
    expect(overflowCount() - before).toBe(8);
  });

  it("[FAILURE.SYMBOL] a Failure of another copy of the kernel gives its own error value in each engine and in conforms", async () => {
    // Another copy of the kernel has another class Failure with the same global brand.
    const foreign = (error: EvalError): Error => {
      const made = Object.assign(new Error(`${error.code} ${error.reason}`), { name: "Failure", error });
      Object.defineProperty(made, Symbol.for("coeval.failure"), { value: true });
      return made;
    };
    const full: EvalError = { code: "#FULL", reason: "The store is full." };
    expect(foreign(full)).not.toBeInstanceOf(Failure);
    const ctx = makeContext({}, STD_CAPS);
    const throws = (): never => {
      throw foreign(full);
    };
    const rejects = (): Promise<never> => Promise.reject(foreign(full));
    const mine = { ok: false, error: { ...full, place: [0] } };
    expect(evaluate(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: throws }).result).toEqual(mine);
    expect(prepare(STD_MACHINE, WRITE_THEN_LOG).evaluate(ctx, { perform: throws })).toEqual(mine);
    expect(reference(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: throws })).toEqual(mine);
    // The stepper has no runner of seq, thus it takes the effect of an evaluator at the root.
    expect(stepper(machine, { type: "ping", value: null }, ctx, { perform: throws })).toEqual({ ok: false, error: { ...full, place: [] } });
    for (const perform of [throws, rejects]) {
      expect((await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform })).result).toEqual(mine);
      expect(await referenceRun(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform })).toEqual(mine);
    }
    // An operation of the formula kit that throws it gives its error value too.
    const ops = formulaMachine({ ops: { fill: () => throws() } });
    expect(prepare(ops, { type: ["ops", "fill"], value: [] }).evaluate()).toMatchObject({ ok: false, error: full });
    // For conforms, the Failure is the channel of the errors of a deref, not a throw of the host.
    const held = mergeMachines(STD_MACHINE, { world: { kinds: { held: { verbs: { deref: "test.deref" } } } }, derefs: { "test.deref": throws } });
    expect(conforms(held, "test.deref")).toEqual([]);
  });

  it("[RUN.ADDRESS] each effect has an address from its place and its scope, and the order of the host does not change it", async () => {
    const ctx = makeContext({}, STD_CAPS);
    // The root is one scope. An address is the place and the count of the earlier effects at that place.
    const doc: Json = { type: "seq", value: [log("a"), { type: "twice", value: [log("b")] }, { type: "rec", value: { "a.b": log("c") } }] };
    expect(evaluate(machine, doc, ctx).effects.map((effect) => effect.address)).toEqual(["0#0", "1/0#0", "1/0#1", '2/"a.b"#0']);
    // Each item of all is a scope, also inside another all.
    const nested: Json = {
      type: "par",
      value: [
        { type: "seq", value: [log("a1"), log("a2")] },
        { type: "seq", value: [log("b1"), { type: "par", value: [log("c1"), log("c2")] }] },
      ],
    };
    const expected = [
      ["all0.0/0/0#0", "a1"],
      ["all0.0/0/1#0", "a2"],
      ["all0.1/1/0#0", "b1"],
      ["all0.1/all0.0/1/1/0#0", "c1"],
      ["all0.1/all0.1/1/1/1#0", "c2"],
    ];
    expect(byAddress(evaluate(machine, nested, ctx).effects)).toEqual(expected);
    const referenced: Effect[] = [];
    reference(machine, nested, ctx, { effects: referenced });
    expect(byAddress(referenced)).toEqual(expected);
    // Runs with other delays give the effects in other orders, and with the same addresses.
    let seed = 7;
    const delay = (): number => {
      seed = (seed * 48271) % 2147483647;
      return seed % 5;
    };
    const orders = new Set<string>();
    for (const first of ["a", "b", "", "", ""]) {
      const done = await run(machine, nested, ctx, {
        perform: async (effect) => {
          const text = String(effect.payload);
          const ms = first === "" ? delay() : text.startsWith(first) ? 1 : 15;
          await new Promise((resolve) => setTimeout(resolve, ms));
          return text;
        },
      });
      expect(done.result).toEqual(ok(["a2", ["c1", "c2"]]));
      expect(byAddress(done.effects)).toEqual(expected);
      orders.add(done.effects.map((effect) => String(effect.payload)).join(" "));
    }
    expect(orders.has("a1 b1 a2 c1 c2")).toBe(true);
    expect(orders.has("a1 b1 c1 c2 a2")).toBe(true);
  });
});
