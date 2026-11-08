import { describe, expect, it } from "vitest";
import { STD_MACHINE, decodeLog } from "@mark1russell7/coeval";
import { DOCUMENT_CHANGES, RECORDED_TEXT, countingHost, logJson, recordRun, replayRun, shownReplay } from "./replay.ts";

const change = (id: string): string => DOCUMENT_CHANGES.find((item) => item.id === id)?.text ?? "";

describe("the runs of the replay diagram", () => {
  it("[RUN.RECORD] a recording gives one row for each effect, and the host gets each call", async () => {
    const out = await recordRun(RECORDED_TEXT, countingHost());
    expect(out.rows.map((row) => [row.kind, row.state])).toEqual([
      ["log", "host"],
      ["log", "host"],
      ["write", "host"],
    ]);
    expect(out.calls).toBe(3);
    expect(out.result).toEqual({ ok: true, value: 30 });
  });

  it("[RUN.RECORD] a second recording against the same host gives other answers", async () => {
    const host = countingHost();
    const first = await recordRun(RECORDED_TEXT, host);
    const second = await recordRun(RECORDED_TEXT, host);
    expect(second.result).not.toEqual(first.result);
  });

  it("[RUN.REPLAY] a replay gives the recorded result with no host", async () => {
    const recorded = await recordRun(RECORDED_TEXT, countingHost());
    const again = await replayRun(RECORDED_TEXT, recorded.log);
    expect(again.result).toEqual(recorded.result);
    expect(again.rows.map((row) => row.state)).toEqual(["log", "log", "log"]);
    expect(again.rows.map((row) => row.outcome)).toEqual(recorded.rows.map((row) => row.outcome));
    expect(again.calls).toBe(0);
  });

  it.each(["payload", "kind", "step"])("[RUN.REPLAY-MISMATCH] the change %s gives #REPLAY! at the address of its step", async (id) => {
    const recorded = await recordRun(RECORDED_TEXT, countingHost());
    const again = await replayRun(change(id), recorded.log);
    expect(again.result).toMatchObject({ ok: false, error: { code: "#REPLAY!" } });
    const refused = again.rows.filter((row) => row.state === "refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]?.address).toBe(recorded.rows[1]?.address);
    expect(again.rows.map((row) => row.state)).toEqual(["log", "refused", "not reached"]);
  });

  it("[RUN.REPLAY-JSON] the JSON of a log gives the same replay", async () => {
    const recorded = await recordRun(RECORDED_TEXT, countingHost());
    const read = decodeLog(STD_MACHINE, JSON.parse(JSON.stringify(logJson(recorded.log))));
    expect(read.ok).toBe(true);
    if (read.ok) expect((await replayRun(RECORDED_TEXT, read.value)).result).toEqual(recorded.result);
  });

  it("[RUN.REPLAY] the diagram shows a replay only for its change and its recording", async () => {
    const host = countingHost();
    const first = await recordRun(RECORDED_TEXT, host);
    const second = await recordRun(RECORDED_TEXT, host);
    const run = await replayRun(change("payload"), first.log);
    const kept = { change: "payload", recorded: first, run };
    expect(shownReplay(kept, "payload", first)).toBe(run);
    // A click on another change, or a new recording, makes the last replay old until the new one comes.
    expect(shownReplay(kept, "kind", first)).toBeUndefined();
    expect(shownReplay(kept, "payload", second)).toBeUndefined();
    expect(shownReplay(undefined, "payload", first)).toBeUndefined();
  });
});
