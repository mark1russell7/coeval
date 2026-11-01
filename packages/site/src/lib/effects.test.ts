import { describe, expect, it } from "vitest";
import { EFFECT_HOSTS, EFFECT_PROGRAMS, isRunner, resultText, runWithHost, type HostKind } from "./effects.ts";

const program = (id: string) => EFFECT_PROGRAMS.find((item) => item.id === id)!;
const HELD = "The parent of the runner cannot wait, thus the host does not get the effect log.";
const CHECK = "log waits for effects, and its parent cannot wait. Give the parent a runner.";
const hosts: readonly HostKind[] = EFFECT_HOSTS.map((host) => host.id);

describe("the runs of the effects diagram", () => {
  it.each(hosts)("[RUN.HELD] a runner at the root gives its effect to perform (%s)", async (host) => {
    const out = await runWithHost(program("root"), host);
    expect(out.calls).toEqual(["#0"]);
    expect(out.effects).toEqual([{ address: "#0", kind: "log", payload: "x", place: [], reached: true, outcome: { ok: true, value: 2 } }]);
    expect(out.result).toEqual({ ok: true, value: 2 });
    expect(out.issues).toEqual([]);
  });

  it.each(hosts)("[RUN.HELD] an effect under add does not reach the host, and keeps #CALC! (%s)", async (host) => {
    const out = await runWithHost(program("under-add"), host);
    expect(out.calls).toEqual([]);
    expect(out.effects).toEqual([
      { address: "1#0", kind: "log", payload: "x", place: [1], reached: false, outcome: { ok: false, error: { code: "#CALC!", reason: HELD, place: [1] } } },
    ]);
    expect(out.result).toEqual({ ok: false, error: { code: "#CALC!", reason: CHECK, place: [1] } });
    // The check with the option run finds the same #CALC! before the run.
    expect(out.issues.map((issue) => [issue.code, issue.reason, issue.place])).toEqual([["#CALC!", CHECK, [1]]]);
  });

  it.each(hosts)("[RUN.HELD] seq can wait, thus the host gets the effect and add reads its answer (%s)", async (host) => {
    const out = await runWithHost(program("seq"), host);
    expect(out.calls).toEqual(["0#0"]);
    expect(out.effects).toEqual([{ address: "0#0", kind: "log", payload: "x", place: [0], reached: true, outcome: { ok: true, value: 2 } }]);
    expect(out.result).toEqual({ ok: true, value: 3 });
    expect(out.issues).toEqual([]);
  });

  it("gives the same facts for the two hosts", async () => {
    for (const item of EFFECT_PROGRAMS) {
      const [waits, atOnce] = await Promise.all(hosts.map((host) => runWithHost(item, host)));
      expect({ ...waits, host: "x" }).toEqual({ ...atOnce, host: "x" });
    }
  });

  it("finds the runners of the machine: log and seq wait, add does not", () => {
    expect(["log", "seq", "add"].map(isRunner)).toEqual([true, true, false]);
  });

  it("writes a result as its value or its code", () => {
    expect(resultText({ ok: true, value: 3 })).toBe("3");
    expect(resultText(undefined)).toBe("no outcome");
  });
});
