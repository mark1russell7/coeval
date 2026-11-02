import { describe, expect, it } from "vitest";
import { describeRun, type BenchRun } from "../bench/merge.ts";

const old: BenchRun = { run: "1", cpu: "a CPU", node: "v26.0.0", rounds: 12, cases: [] };

describe("the line of a bench run (K199)", () => {
  it("names the flags, the samples and the processes of a run with a mode", () => {
    const run: BenchRun = { ...old, mode: { flags: ["--predictable", "--predictable-gc-schedule"], warmup: 3, samples: 5, sampleMs: 25, together: [] } };
    expect(describeRun(run, 0)).toBe(
      "Run 1: a CPU, Node v26.0.0, 12 rounds. Mode: `--predictable --predictable-gc-schedule`, 3 warmup and 5 counted samples of 25 ms in each process, each case runs in its own processes.",
    );
  });

  it("names the cases that share one process", () => {
    const run: BenchRun = { ...old, mode: { flags: [], warmup: 1, samples: 1, sampleMs: 5, together: ["a", "b"] } };
    expect(describeRun(run, 0)).toBe("Run 1: a CPU, Node v26.0.0, 12 rounds. Mode: no flags, 1 warmup and 1 counted samples of 5 ms in each process, the 2 cases a, b share one process.");
  });

  it("keeps a record from before K199, which has no mode", () => {
    expect(describeRun(old, 0)).toBe("Run 1: a CPU, Node v26.0.0, 12 rounds. The record names no mode.");
    expect(describeRun(undefined, 1)).toBe("Run 2 gave no table.");
  });
});
