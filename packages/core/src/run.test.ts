import { describe, expect, it } from "vitest";
import {
  type Effect,
  type Json,
  type Machine,
  type Runner,
  type Steps,
  Failure,
  STD_CAPS,
  STD_MACHINE,
  evaluate,
  makeContext,
  ok,
  permits,
  prepare,
  reference,
  run,
} from "./index.ts";

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

  it("[RUN.NESTED-WAIT] refuses a step that waits inside a part that cannot wait", async () => {
    const out = await run(STD_MACHINE, { type: "add", value: [1, { type: "log", value: ["x"] }] }, makeContext({}, STD_CAPS));
    expect(out.result).toMatchObject({ ok: false, error: { code: "#CALC!" } });
    expect(out.effects).toEqual([]);
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
