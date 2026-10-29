import { describe, expect, it, vi } from "vitest";
import { agreeRun } from "./agree.ts";
import { type Json, type Machine, type Perform, type Runner, type Steps, STD_CAPS, STD_MACHINE, makeContext, ok, recorder } from "./index.ts";
import { replayer } from "./replay.ts";

// The mock keeps the replayer of the kernel, and it counts the replayers that agreeRun makes.
vi.mock("./replay.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("./replay.ts")>();
  return { ...real, replayer: vi.fn(real.replayer) };
});

/** The runner of `par`: its parts run at the same time. */
const par: Runner = function* ({ parts, all }): Steps {
  const results = yield* all(parts);
  return ok(results.map((result) => (result.ok ? result.value : result.error.code)));
};

const machine: Machine = {
  ...STD_MACHINE,
  world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, par: { verbs: { eval: "par" }, parts: { shape: "list" } } } },
  runners: { ...STD_MACHINE.runners, par },
};

const log = (text: string): Json => ({ type: "log", value: [text] });

/** A host that answers `slow` after more turns than each other effect. Thus the waits of an all settle out of their order. */
const host: Perform = (effect) => {
  let answer: Promise<unknown> = Promise.resolve(String(effect.payload).toUpperCase());
  if (effect.payload === "slow") for (let turn = 0; turn < 4; turn += 1) answer = answer.then((value) => value);
  return answer;
};

describe("one replayer in agreeRun", () => {
  it("[RUN.AGREES-ONE-REPLAYER] agreeRun makes one replayer for its tiers and the replay of the reads, and the tiers agree on waits out of their order", async () => {
    const made = vi.mocked(replayer);
    const ctx = makeContext({ a: "slow" }, STD_CAPS);
    const doc: Json = { type: "par", value: [{ type: "log", value: [{ type: "ref", value: ["names", "a"] }] }, log("fast"), { type: "par", value: [log("slow"), log("b")] }] };
    const recording = recorder(host);
    await agreeRun(machine, doc, ctx, { perform: recording.perform });
    // The waits of the first all settle out of their order, thus the order of the replay is a real check.
    const first = recording.log().settles.filter((settle) => settle.all === "all0");
    expect(first.map((settle) => settle.item)).not.toEqual([...first.map((settle) => settle.item)].sort());
    made.mockClear();
    const outcome = await agreeRun(machine, doc, ctx, { perform: host, strict: true });
    expect(outcome).toMatchObject({ ok: true, result: ok(["SLOW", "FAST", ["SLOW", "B"]]) });
    expect(outcome.ok && outcome.reads !== undefined && outcome.reads.length > 0).toBe(true);
    // Four tiers and the replay of the reads use the one replayer.
    expect(made).toHaveBeenCalledTimes(1);
    made.mockClear();
    expect(await agreeRun(machine, doc, ctx, { perform: host, tiers: ["traced", "again"] })).toMatchObject({ ok: true });
    expect(made).toHaveBeenCalledTimes(1);
  });
});
