import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  type CompiledEvaluator,
  type CompiledRunner,
  type Effect,
  type Machine,
  type Plan,
  type Result,
  type Runner,
  type Steps,
  STD_CAPS,
  STD_MACHINE,
  THING,
  evaluate,
  fail,
  failures,
  formulaMachine,
  intersectCaps,
  makeContext,
  narrow,
  nodeAt,
  ok,
  partCaps,
  permits,
  planner,
  prepare,
  run,
} from "./index.ts";

const sum = { type: "add", value: [1, 2, { type: "multiply", value: [3, 4] }] };

describe("plans", () => {
  it("[PLAN.ONCE] a plan evaluates many times with the same result as evaluate", () => {
    const plan = prepare(STD_MACHINE, sum);
    expect(plan.evaluate()).toEqual({ ok: true, value: 15 });
    expect(plan.evaluate()).toEqual({ ok: true, value: 15 });
    expect(evaluate(STD_MACHINE, sum).result).toEqual(plan.evaluate());
  });

  it("[PLAN.ONCE] the ladder runs at compile time only", () => {
    let compiles = 0;
    let calls = 0;
    const counted: CompiledEvaluator = {
      compile: () => {
        compiles += 1;
        return () => {
          calls += 1;
          return ok(1);
        };
      },
    };
    const machine: Machine = { world: { kinds: { one: { verbs: { eval: "one" } } }, defaults: {} }, evaluators: { one: counted } };
    const plan = prepare(machine, { type: "one", value: null });
    for (let index = 0; index < 5; index += 1) plan.evaluate();
    expect({ compiles, calls }).toEqual({ compiles: 1, calls: 5 });
  });

  it("[PLAN.FAIL-LATE] a document that does not compile fails when it evaluates, with its place", () => {
    const plan = prepare(STD_MACHINE, { type: "add", value: [1, { type: "nothing", value: 2 }] });
    const result = plan.evaluate();
    expect(result).toMatchObject({ ok: false, error: { code: "#KIND?", place: [1] } });
  });

  it("[PLAN.LEAN] a plan keeps its code, and not the document or the split of its value", async () => {
    setFlagsFromString("--expose-gc");
    const gc = runInNewContext("gc") as () => void;
    const make = (): { readonly plan: Plan; readonly doc: WeakRef<object> } => {
      const doc = { type: "lit", value: { big: Array.from({ length: 10 }, (_, index) => index) } };
      return { plan: prepare(formulaMachine(), doc), doc: new WeakRef(doc) };
    };
    const { plan, doc } = make();
    // A weak reference keeps its target until the end of the job that made it
    await new Promise((resolve) => setTimeout(resolve, 0));
    gc();
    expect(doc.deref()).toBeUndefined();
    expect(plan.evaluate()).toEqual({ ok: true, value: { big: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] } });
  });

  it("[PLAN.TRACE] a traced plan gives the trace of evaluate, an untraced one gives none", () => {
    const traced = evaluate(STD_MACHINE, sum);
    expect(traced.trace.children).toHaveLength(3);
    expect(traced.trace.children[2]?.path).toEqual(["2"]);
    expect(traced.time).toBeGreaterThan(0);
  });

  it("[PLAN.CACHE] a planner compiles one document object one time", () => {
    const plans = planner(STD_MACHINE);
    expect(plans(sum)).toBe(plans(sum));
    expect(plans(7)).toBe(plans(7));
  });

  it("[PLAN.CACHE-ZERO] a planner keeps -0 and 0 apart", () => {
    const plans = planner(STD_MACHINE, { declaredType: "number" });
    expect(plans(0).evaluate()).toEqual({ ok: true, value: 0 });
    expect(plans(-0).evaluate()).toEqual({ ok: true, value: -0 });
    expect(plans(0).evaluate()).toEqual({ ok: true, value: 0 });
  });

  it("[VALUE.ANY] a value can be any value of the host", () => {
    const stamp = new Date(0);
    const machine: Machine = {
      world: { kinds: { now: { verbs: { eval: "now" } } }, defaults: {} },
      evaluators: { now: () => ok(stamp) },
    };
    expect(prepare(machine, { type: "now", value: null }).evaluate()).toEqual({ ok: true, value: stamp });
  });

  it("[VALUE.THROW] an evaluator that throws gives #CALC! with the exception as the cause", () => {
    const boom = new Error("boom");
    const machine: Machine = {
      world: { kinds: { bad: { verbs: { eval: "bad" } } }, defaults: {} },
      evaluators: {
        bad: () => {
          throw boom;
        },
      },
    };
    const result = prepare(machine, { type: "bad", value: null }).evaluate();
    expect(result).toMatchObject({ ok: false, error: { code: "#CALC!", cause: boom, place: [] } });
  });

  it("[VALUE.DEPTH] a stack overflow in an evaluator gives #DEPTH!", () => {
    const deep = (n: number): number => deep(n + 1) + 1;
    const machine: Machine = {
      world: { kinds: { deep: { verbs: { eval: "deep" } } }, defaults: {} },
      evaluators: { deep: () => ok(deep(0)) },
    };
    expect(prepare(machine, { type: "deep", value: null }).evaluate()).toMatchObject({ ok: false, error: { code: "#DEPTH!" } });
  });

  it("[PLAN.DEPTH] the nesting of documents has a limit", () => {
    let doc: unknown = 1;
    for (let index = 0; index < 30; index += 1) doc = { type: "add", value: [doc] };
    const machine: Machine = { ...STD_MACHINE, maxDepth: 10 };
    expect(prepare(machine, doc).evaluate()).toMatchObject({ ok: false, error: { code: "#DEPTH!" } });
    expect(prepare(STD_MACHINE, doc).evaluate()).toEqual({ ok: true, value: 1 });
  });

  it("[VALUE.FAILURES] failures lists the errors where they started", () => {
    const trace = evaluate(STD_MACHINE, { type: "add", value: [1, { type: "text", value: 3 }] }).trace;
    expect(failures(trace).map((error) => error.code)).toEqual(["#VALUE!"]);
  });

  it("[DEREF.SYMBOL] the brand of a host thing is a global symbol", () => {
    expect(THING).toBe(Symbol.for("coeval.thing"));
  });
});

describe("capabilities", () => {
  it("[CAP.KEYS] a capability permits the kinds under it, key by key", () => {
    expect(permits(["store"], "store.update")).toBe(true);
    expect(permits(["fs.read"], "fs.read")).toBe(true);
    expect(permits(["fs.read"], ["fs", "read.json"])).toBe(false);
    expect(permits([["fs", "read.json"]], ["fs", "read.json"])).toBe(true);
    expect(permits(["store.update"], "store")).toBe(false);
  });

  it("[CAP.NARROW] a part cannot get more capabilities than its parent", () => {
    const parent = makeContext({}, ["log"]);
    expect(narrow(parent, { ...parent, caps: ["log", "write"] }).caps).toEqual(["log"]);
    expect(narrow(parent, { ...parent, caps: ["log.debug"] }).caps).toEqual(["log.debug"]);
  });

  it("[CAP.CONTRACT] the kernel narrows the context of each part by the capability rules of its kind", async () => {
    const plain: Runner = function* ({ parts }) {
      let last: Result = ok(null);
      for (const part of parts) {
        last = yield* part.evaluate();
        if (!last.ok) return last;
      }
      return last;
    };
    // This runner tries to give its part more capabilities. The contract still masks them.
    const leaky: Runner = function* ({ parts, context }) {
      return yield* (parts[0] as (typeof parts)[number]).evaluate({ ...context, caps: ["log", "write"] });
    };
    const compiled: CompiledRunner = { compileRun: (input) => (ctx, rt) => (input.parts[0] as (typeof input.parts)[number]).run(ctx, rt) };
    const machine: Machine = {
      ...STD_MACHINE,
      world: {
        ...STD_MACHINE.world,
        kinds: {
          ...STD_MACHINE.world.kinds,
          quiet: { verbs: { eval: "plain" }, parts: { shape: "list" }, caps: [{ rule: "mask" }] },
          leaky: { verbs: { eval: "leaky" }, parts: { shape: "list" }, caps: [{ rule: "mask" }] },
          sealed: { verbs: { eval: "compiled" }, parts: { shape: "list" }, caps: [{ rule: "mask" }] },
          split: { verbs: { eval: "plain" }, parts: { shape: "record", fields: ["inner", "outer"] }, caps: [{ rule: "only", caps: ["log"], in: [["inner"]] }] },
          open: { verbs: { eval: "plain" }, parts: { shape: "list" }, caps: [{ rule: "same" }] },
        },
      },
      runners: { ...STD_MACHINE.runners, plain, leaky, compiled },
    };
    const log = { type: "log", value: ["x"] };
    const write = { type: "write", value: { key: "k", value: { type: "number", value: 1 } } };
    const ctx = makeContext({}, STD_CAPS);
    for (const type of ["quiet", "leaky", "sealed"]) {
      const done = await run(machine, { type, value: [log] }, ctx);
      expect(done.result, type).toMatchObject({ ok: false, error: { code: "#CAP!", place: [0] } });
      expect(done.effects, type).toEqual([]);
    }
    expect(nodeAt((await run(machine, { type: "quiet", value: [log] }, ctx)).trace, [0])?.caps).toEqual([]);
    expect((await run(machine, { type: "split", value: { inner: log, outer: write } }, ctx)).result).toMatchObject({ ok: true });
    expect((await run(machine, { type: "split", value: { inner: write, outer: log } }, ctx)).result).toMatchObject({ ok: false, error: { code: "#CAP!", place: ["inner"] } });
    expect((await run(machine, { type: "open", value: [log, write] }, ctx)).result).toMatchObject({ ok: true });
    // An evaluation without a run narrows the same way.
    expect(prepare(machine, { type: "quiet", value: [log] }).evaluate(ctx)).toMatchObject({ ok: false, error: { code: "#CAP!" } });
  });

  it("[CAP.ONLY] a rule only gives a part the effects that the capabilities of its document and the list both permit", () => {
    expect(intersectCaps(["log", "write"], ["log"])).toEqual(["log"]);
    expect(intersectCaps(["log"], ["log.debug", "write"])).toEqual(["log.debug"]);
    expect(intersectCaps(["store"], ["fs"])).toEqual([]);
    const narrowed = ["log.debug"];
    expect(intersectCaps(narrowed, ["log"])).toBe(narrowed);
    // The result permits exactly the effects that both lists permit.
    const lists = [[], ["log"], ["log.debug"], ["log", "write"], ["write.disk", "log.debug"], [["fs", "read.json"]], ["fs"]] as const;
    const kinds = ["log", "log.debug", "log.debug.deep", "write", "write.disk", "fs.read", ["fs", "read.json"], "other"] as const;
    for (const a of lists) {
      for (const b of lists) {
        for (const kind of kinds) expect(permits(intersectCaps(a, b), kind), `${JSON.stringify(a)} ${JSON.stringify(b)} ${String(kind)}`).toBe(permits(a, kind) && permits(b, kind));
      }
    }
    expect(partCaps([{ rule: "only", caps: ["log"] }], [0], STD_CAPS)).toEqual(["log"]);
    expect(partCaps([{ rule: "only", caps: ["log"], in: [["inner"]] }], ["outer"], STD_CAPS)).toBe(STD_CAPS);
    expect(partCaps([{ rule: "only", caps: ["log", "write.disk"] }, { rule: "only", caps: ["write"] }], [0], STD_CAPS)).toEqual(["write.disk"]);
    expect(partCaps([{ rule: "only", caps: ["log"] }, { rule: "mask", in: [["*"]] }], [0], STD_CAPS)).toEqual([]);
    expect(partCaps(undefined, [0], STD_CAPS)).toBe(STD_CAPS);
  });

  it("[CAP.HOOK] a machine can give the rule of the host for an effect", async () => {
    const machine: Machine = { ...STD_MACHINE, permits: (_caps, kind) => kind.join(".") !== "write" };
    const doc = { type: "seq", value: [{ type: "log", value: ["a"] }, { type: "write", value: { key: "k", value: { type: "number", value: 1 } } }] };
    const done = await run(machine, doc, makeContext({}, []));
    expect(done.result).toMatchObject({ ok: false, error: { code: "#CAP!" } });
    expect(done.effects.map((effect) => effect.kind)).toEqual(["log"]);
  });
});

function waiter(ms: number, value: unknown): Promise<unknown> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe("the run side", () => {
  it("[RUN.EFFECT] an effect carries its kind, its place and its context", async () => {
    const seen: Effect[] = [];
    const doc = { type: "seq", value: [{ type: "log", value: ["hello"] }] };
    const done = await prepare(STD_MACHINE, doc).run(makeContext({ who: "me" }, STD_CAPS), {
      perform: (effect) => {
        seen.push(effect);
        return null;
      },
    });
    expect(done.ok).toBe(true);
    expect(seen[0]).toMatchObject({ kind: "log", path: ["log"], payload: "hello", place: [0] });
    expect(seen[0]?.context.names).toEqual({ who: "me" });
  });

  it("[RUN.CAUSE] a host error stays the cause of the error value", async () => {
    const boom = new TypeError("no store");
    const done = await prepare(STD_MACHINE, { type: "log", value: ["x"] }).run(makeContext({}, STD_CAPS), {
      perform: () => Promise.reject(boom),
    });
    expect(done).toMatchObject({ ok: false, error: { code: "#CALC!", cause: boom } });
  });

  it("[RUN.ALL] parts can run at the same time, and the results keep the order of the parts", async () => {
    const order: string[] = [];
    const parallel: Runner = function* ({ parts, all }): Steps {
      const results = yield* all(parts);
      const bad = results.find((result) => !result.ok);
      return bad ?? ok(results.map((result) => (result as { value: unknown }).value));
    };
    const machine: Machine = {
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, par: { verbs: { eval: "par" }, parts: { shape: "list" } } } },
      runners: { ...STD_MACHINE.runners, par: parallel },
    };
    const doc = { type: "par", value: [{ type: "log", value: ["slow"] }, { type: "log", value: ["fast"] }] };
    const done = await prepare(machine, doc).run(makeContext({}, STD_CAPS), {
      perform: async (effect) => {
        const text = String(effect.payload);
        await waiter(text === "slow" ? 30 : 1, null);
        order.push(text);
        return text.toUpperCase();
      },
    });
    expect(done).toEqual({ ok: true, value: ["SLOW", "FAST"] });
    expect(order).toEqual(["fast", "slow"]);
  });

  it("[RUN.ALL] a limit of one runs the parts one after the other", async () => {
    const order: string[] = [];
    const serial: Runner = function* ({ parts, all }): Steps {
      const results = yield* all(parts, { concurrency: 1 });
      return ok(results.length);
    };
    const machine: Machine = {
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, ser: { verbs: { eval: "ser" }, parts: { shape: "list" } } } },
      runners: { ...STD_MACHINE.runners, ser: serial },
    };
    const doc = { type: "ser", value: [{ type: "log", value: ["slow"] }, { type: "log", value: ["fast"] }] };
    await prepare(machine, doc).run(makeContext({}, STD_CAPS), {
      perform: async (effect) => {
        const text = String(effect.payload);
        await waiter(text === "slow" ? 20 : 1, null);
        order.push(text);
        return null;
      },
    });
    expect(order).toEqual(["slow", "fast"]);
  });

  it("[RUN.FAIL-FAST] with failFast, the first failure stops the parts, and the results come at once", async () => {
    const started: string[] = [];
    const finished: string[] = [];
    const fast: Runner = function* ({ parts, all }): Steps {
      const results = yield* all(parts, { concurrency: 2, failFast: true });
      return ok(results.map((result) => (result.ok ? result.value : result.error.code)));
    };
    const machine: Machine = {
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, fast: { verbs: { eval: "fast" }, parts: { shape: "list" } } } },
      runners: { ...STD_MACHINE.runners, fast },
    };
    const doc = {
      type: "fast",
      value: [
        { type: "seq", value: [{ type: "log", value: ["slow"] }, { type: "log", value: ["after slow"] }] },
        { type: "log", value: ["boom"] },
        { type: "log", value: ["later"] },
      ],
    };
    const begin = Date.now();
    const done = await prepare(machine, doc).run(makeContext({}, STD_CAPS), {
      perform: async (effect) => {
        const text = String(effect.payload);
        started.push(text);
        await waiter(text === "slow" ? 200 : 1, null);
        if (text === "boom") throw new Error("boom");
        finished.push(text);
        return text;
      },
    });
    expect(done).toEqual({ ok: true, value: ["#ABORT", "#CALC!", "#ABORT"] });
    expect(Date.now() - begin).toBeLessThan(150);
    expect(started).toEqual(["slow", "boom"]);
    await waiter(250, null);
    // The part that ran stopped at its wait: its next step did not start
    expect(started).toEqual(["slow", "boom"]);
    expect(finished).toEqual(["slow"]);
  });

  it("[RUN.FAIL-FAST] without failFast, a failure does not stop the other parts", async () => {
    const all: Runner = function* ({ parts, all: drive }): Steps {
      const results = yield* drive(parts, { concurrency: 1 });
      return ok(results.map((result) => (result.ok ? result.value : result.error.code)));
    };
    const machine: Machine = {
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, each: { verbs: { eval: "each" }, parts: { shape: "list" } } } },
      runners: { ...STD_MACHINE.runners, each: all },
    };
    const doc = { type: "each", value: [{ type: "log", value: ["boom"] }, { type: "log", value: ["later"] }] };
    const done = await prepare(machine, doc).run(makeContext({}, STD_CAPS), {
      perform: (effect) => {
        if (effect.payload === "boom") throw new Error("boom");
        return effect.payload;
      },
    });
    expect(done).toEqual({ ok: true, value: ["#CALC!", "later"] });
  });

  it("[EVAL.FILL] an evaluator puts the result of each part in its place, and the data stays the same objects", () => {
    const shared = { big: [1, 2, 3] };
    const machine: Machine = {
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, data: { verbs: { eval: "data" }, parts: { shape: "deep" } } } },
      evaluators: {
        ...STD_MACHINE.evaluators,
        data: ({ parts, fill }) => {
          const results = parts.map((part) => part.evaluate());
          const bad = results.find((result) => !result.ok);
          return bad ?? ok(fill(results.map((result) => (result as { value: unknown }).value)));
        },
      },
    };
    const value = JSON.parse('{"__proto__": {"type": "add", "value": [1, 2]}, "list": [0, {"type": "add", "value": [3, 4]}]}') as Record<string, unknown>;
    value["shared"] = shared;
    const result = prepare(machine, { type: "data", value }).evaluate();
    expect(result.ok).toBe(true);
    const out = (result as { value: Record<string, unknown> }).value;
    expect(Object.hasOwn(out, "__proto__")).toBe(true);
    expect(out["__proto__"]).toBe(3);
    expect(out["list"]).toEqual([0, 7]);
    expect(out["shared"]).toBe(shared);
    // A document without parts gives its value itself
    const plain = { a: 1 };
    expect(prepare(machine, { type: "data", value: plain }).evaluate()).toEqual({ ok: true, value: plain });
  });

  it("[EVAL.FILL] a runner fills its value too", async () => {
    const machine: Machine = {
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, data: { verbs: { eval: "data" }, parts: { shape: "deep" } } } },
      runners: {
        ...STD_MACHINE.runners,
        data: function* ({ parts, fill }): Steps {
          const values: unknown[] = [];
          for (const part of parts) {
            const result = yield* part.evaluate();
            if (!result.ok) return result;
            values.push(result.value);
          }
          return ok(fill(values));
        },
      },
    };
    const doc = { type: "data", value: { a: { type: "log", value: ["x"] }, b: "kept" } };
    const done = await prepare(machine, doc).run(makeContext({}, STD_CAPS), { perform: () => "logged" });
    expect(done).toEqual({ ok: true, value: { a: "logged", b: "kept" } });
  });

  it("[RUN.ABORT] a run stops with #ABORT when the host aborts", async () => {
    const controller = new AbortController();
    const doc = { type: "seq", value: [{ type: "log", value: ["a"] }, { type: "log", value: ["b"] }] };
    const seen: unknown[] = [];
    const pending = prepare(STD_MACHINE, doc).run(makeContext({}, STD_CAPS), {
      signal: controller.signal,
      perform: (effect) => {
        seen.push(effect.payload);
        return waiter(50, null);
      },
    });
    controller.abort("closed");
    const done = await pending;
    expect(done).toMatchObject({ ok: false, error: { code: "#ABORT" } });
    expect(seen).toEqual(["a"]);
  });

  it("[RUN.WAIT] a part that waits under an evaluator fails with #CALC!", async () => {
    const doc = { type: "list", value: [{ type: "log", value: ["x"] }] };
    const evaluatorOnly: Machine = { ...STD_MACHINE, evaluators: { ...STD_MACHINE.evaluators, "list.all": ({ parts }) => {
      const results: Result[] = parts.map((part) => part.evaluate());
      return results.find((result) => !result.ok) ?? ok(null);
    } }, runners: { ...STD_MACHINE.runners, "list.all": undefined as never } };
    const machine: Machine = { ...evaluatorOnly, runners: Object.fromEntries(Object.entries(STD_MACHINE.runners ?? {}).filter(([name]) => name !== "list.all")) };
    const done = await run(machine, doc, makeContext({}, STD_CAPS), { perform: () => waiter(1, null) });
    expect(done.result).toMatchObject({ ok: false, error: { code: "#CALC!" } });
  });

  it("[RUN.EVAL] an evaluation of a run document records its effects and does none", () => {
    const effects: Effect[] = [];
    const result = prepare(STD_MACHINE, { type: "log", value: ["x"] }).evaluate(makeContext({}, STD_CAPS), { effects });
    expect(result).toEqual({ ok: true, value: "x" });
    expect(effects.map((effect) => effect.kind)).toEqual(["log"]);
    expect(fail("#CAP!", "x").ok).toBe(false);
  });
});
