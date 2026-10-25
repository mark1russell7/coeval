import { describe, expect, it } from "vitest";
import { type Json, type Machine, type Perform, type Runner, type Steps, STD_CAPS, STD_MACHINE, makeContext, ok, prepare, recorder, replayer, run } from "./index.ts";

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });
const log = (text: string): Json => ({ type: "log", value: [text] });
const write = (key: string): Json => ({ type: "write", value: { key, value: { type: "number", value: 2 } } });

/** A sequence that writes, then logs the result of the write. */
const WRITE_THEN_LOG: Json = { type: "seq", value: [write("a"), { type: "log", value: [ref("names", "last")] }] };

/** A host that waits for a write and answers a log at once. */
const host: Perform = (effect) => (effect.kind === "write" ? Promise.resolve("stored") : [effect.payload]);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The runner of `par`: its parts run at the same time. */
const par: Runner = function* ({ parts, all }): Steps {
  const results = yield* all(parts);
  return ok(results.map((result) => (result.ok ? result.value : result.error.code)));
};

/** The runner of `fast`: two parts run at the same time, and the first failure stops the others. */
const fast: Runner = function* ({ parts, all }): Steps {
  const results = yield* all(parts, { concurrency: 2, failFast: true });
  return ok(results.map((result) => (result.ok ? result.value : result.error.code)));
};

const machine: Machine = {
  ...STD_MACHINE,
  world: {
    ...STD_MACHINE.world,
    kinds: {
      ...STD_MACHINE.world.kinds,
      par: { verbs: { eval: "par" }, parts: { shape: "list" } },
      fast: { verbs: { eval: "fast" }, parts: { shape: "list" } },
    },
  },
  runners: { ...STD_MACHINE.runners, par, fast },
};

describe("record and replay", () => {
  it("[RUN.RECORD] a recorder logs each effect with its address, its request and its outcome, and the order of the waits of each all", async () => {
    const ctx = makeContext({}, STD_CAPS);
    const recording = recorder(host);
    const done = await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: recording.perform });
    expect(done.result).toEqual(ok(["stored"]));
    expect(recording.log()).toEqual({
      effects: [
        { address: "0#0", kind: "write", payload: { key: "a", value: 2 }, outcome: ok("stored"), waited: true },
        { address: "1#0", kind: "log", payload: "stored", outcome: ok(["stored"]), waited: false },
      ],
      settles: [],
    });
    // The waits of an all settle in the order of the host, and the log keeps that order.
    const both = recorder(async (effect) => {
      await wait(effect.payload === "slow" ? 20 : 1);
      return effect.payload;
    });
    await run(machine, { type: "par", value: [log("slow"), log("fast")] }, ctx, { perform: both.perform });
    expect(both.log().settles).toEqual([
      { all: "all0", item: 1 },
      { all: "all0", item: 0 },
    ]);
    // Without the perform of a host, an effect gives its payload, as in a run without a host.
    const plain = recorder();
    await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: plain.perform });
    expect(plain.log().effects.map((entry) => entry.outcome)).toEqual([ok({ key: "a", value: 2 }), ok({ key: "a", value: 2 })]);
  });

  it("[RUN.REPLAY] a replayer answers each effect from the log: the replay does no host effect, and gives the recorded result, also with failFast", async () => {
    const ctx = makeContext({}, STD_CAPS);
    const seen: string[] = [];
    const recording = recorder(async (effect) => {
      const text = String(effect.payload);
      seen.push(text);
      await wait(text === "slow" ? 40 : 1);
      if (text === "boom") throw new Error("boom");
      return text.toUpperCase();
    });
    const doc: Json = { type: "fast", value: [{ type: "seq", value: [log("slow"), log("after slow")] }, log("boom"), log("later")] };
    const recorded = await run(machine, doc, ctx, { perform: recording.perform });
    expect(recorded.result).toEqual(ok(["#ABORT", "#CALC!", "#ABORT"]));
    const kept = recording.log();
    expect(kept.settles).toEqual([{ all: "all0", item: 1 }]);
    // The run stopped the first part at its wait, thus its effect has no outcome.
    expect(kept.effects.map((entry) => [entry.address, entry.outcome?.ok])).toEqual([
      ["all0.0/0/0#0", undefined],
      ["all0.1/1#0", false],
    ]);
    const before = seen.length;
    const replayed = await run(machine, doc, ctx, { perform: replayer(kept) });
    expect(replayed.result).toEqual(recorded.result);
    expect(seen).toHaveLength(before);
    // The recorded error comes again with its code, its reason, its place and its cause.
    expect(replayed.effects[1]?.outcome).toEqual(recorded.effects[1]?.outcome);
    // A sequence replays in a run, and in an evaluation with wait: false.
    const sequence = recorder(host);
    const first = await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: sequence.perform });
    expect((await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: replayer(sequence.log()) })).result).toEqual(first.result);
    expect(prepare(STD_MACHINE, WRITE_THEN_LOG).evaluate(ctx, { perform: replayer(sequence.log(), { wait: false }) })).toEqual(first.result);
    // Without wait: false, an effect that waited gives a promise, and an evaluation does not wait (RUN.MOCK).
    expect(prepare(STD_MACHINE, WRITE_THEN_LOG).evaluate(ctx, { perform: replayer(sequence.log()) })).toMatchObject({ ok: false, error: { code: "#CALC!", place: [0] } });
  });

  it("[RUN.REPLAY-MISMATCH] an effect that the log does not have at its address gives #REPLAY!, and the run stops there", async () => {
    const ctx = makeContext({}, STD_CAPS);
    const recording = recorder(host);
    await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: recording.perform });
    const kept = recording.log();
    const replay = async (doc: Json) => run(STD_MACHINE, doc, ctx, { perform: replayer(kept) });
    // Another payload at an address.
    const payload = await replay({ type: "seq", value: [write("b"), { type: "log", value: [ref("names", "last")] }] });
    expect(payload.result).toEqual({ ok: false, error: { code: "#REPLAY!", reason: "The effect write at the address 0#0 has another payload than the log.", place: [0] } });
    expect(payload.effects).toHaveLength(1);
    // Another kind at an address.
    const kind = await replay({ type: "seq", value: [log("x"), log("y")] });
    expect(kind.result).toEqual({ ok: false, error: { code: "#REPLAY!", reason: "The log has the effect write at the address 0#0, and the run asks for the effect log.", place: [0] } });
    // An effect that the log does not have.
    const longer: Json = { type: "seq", value: [write("a"), { type: "log", value: [ref("names", "last")] }, log("more")] };
    const more = await replay(longer);
    expect(more.result).toEqual({ ok: false, error: { code: "#REPLAY!", reason: "The log has no effect at the address 2#0, and the run asks for the effect log.", place: [2] } });
    expect(prepare(STD_MACHINE, longer).evaluate(ctx, { perform: replayer(kept, { wait: false }) })).toMatchObject({ ok: false, error: { code: "#REPLAY!", place: [2] } });
  });
});
