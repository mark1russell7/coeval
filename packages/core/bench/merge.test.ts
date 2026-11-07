import type { PairedTime } from "@mark1russell7/rigor-bench";
import { describe, expect, it } from "vitest";
import { familyLines, gateLines, gateRead, outcomeOf, roundsAsCases, verdictOf, type BenchCase, type BenchRun } from "./merge.ts";

/** A small fixed spread of the ratios of the rounds: from -0.4 % to +0.4 %. */
const jitter = (round: number): number => 1 + 0.002 * ((round % 5) - 2);

/** This function gives the pair of one case: the base takes 1 ms, and the other arm takes `ratio` times that. */
function pair(name: string, ratio: number, rounds = 12, offset = 0): PairedTime[] {
  return Array.from({ length: rounds }, (_, index) => ({ case: name, round: offset + index, first: index % 2 === 0 ? "a" : "b", a: 1, b: ratio * jitter(index + 1) }));
}

function benchCase(ratio: number, offset = 0): BenchCase {
  return { name: "x", baseNs: 1e6, headNs: ratio * 1e6, change: (ratio - 1) * 100, noise: 0, head: pair("x", ratio, 12, offset), aa: pair("x", 1, 12, offset) };
}

describe("the verdict of the bench core for each case (K212, D114)", () => {
  it("gives each round of a case the name of a case of its own", () => {
    expect(roundsAsCases(pair("x", 1, 2)).map((record) => record.case)).toEqual(["x (round 0)", "x (round 1)"]);
  });

  it("calls a case same, slower or faster with the rule difference and the margin of 1.5 %", () => {
    expect(outcomeOf(benchCase(1.003))).toBe("same");
    expect(outcomeOf(benchCase(1.1))).toBe("slower");
    expect(outcomeOf(benchCase(0.9))).toBe("faster");
  });

  it("cannot decide a case without paired times, as a record from before K212", () => {
    expect(outcomeOf({ name: "x", baseNs: 1, headNs: 1, change: 0, noise: 0 })).toBe("cannot decide");
  });

  it("pools the rounds of two runs, and a run with the opposite direction makes the verdict cannot decide", () => {
    expect(verdictOf(benchCase(1.1), benchCase(1.1, 12))).toBe("slower");
    expect(verdictOf(benchCase(1.003), benchCase(1.002, 12))).toBe("same");
    expect(verdictOf(benchCase(1.1), benchCase(0.95, 12))).toBe("cannot decide");
  });

  it("keeps the verdicts of different results and of one run", () => {
    expect(verdictOf({ ...benchCase(1), different: "1 and 2" }, benchCase(1, 12))).toBe("different results");
    expect(verdictOf(benchCase(1), undefined)).toBe("one run only");
  });
});

/** This function gives one run of the bench with one case. */
function benchRun(run: string, item: BenchCase): BenchRun {
  return { run, cpu: "x", node: "26", rounds: 12, cases: [item] };
}

describe("the gate of the claim not slower is report only (K225, D163)", () => {
  it("flips to a block with an injected slowdown of 10 %, and the copy with no fault passes", () => {
    const copy = gateRead([benchRun("1", benchCase(1)), benchRun("2", benchCase(1))]);
    const fault = gateRead([benchRun("1", benchCase(1.1)), benchRun("2", benchCase(1.1))]);
    expect(copy.outcome).toBe("pass");
    expect(fault.outcome).toBe("block");
    expect(fault.blocks).toEqual(["x"]);
  });

  it("does not block on one slow run: the claim needs its bound in each of 2 jobs", () => {
    const gate = gateRead([benchRun("1", benchCase(1.1)), benchRun("2", benchCase(1))]);
    expect(gate.outcome).toBe("no read");
    expect(gate.noRead).toEqual(["x"]);
  });

  it("does not count an absent run as a read", () => {
    const gate = gateRead([benchRun("1", benchCase(1)), undefined]);
    expect(gate.outcome).toBe("no read");
    expect(gateRead([undefined, undefined]).outcome).toBe("no read");
  });

  it("does not count a record without paired times as a read", () => {
    const old: BenchCase = { name: "x", baseNs: 1, headNs: 1, change: 0, noise: 0 };
    expect(gateRead([benchRun("1", old), benchRun("2", old)]).outcome).toBe("no read");
  });

  it("prints one line of counts, then the reason of each slower case", () => {
    const pass = gateLines(gateRead([benchRun("1", benchCase(1)), benchRun("2", benchCase(1))]));
    expect(pass).toEqual(["Gate (report only, D163): pass. 1 not slower, 0 slower, 0 no read."]);
    const block = gateLines(gateRead([benchRun("1", benchCase(1.1)), benchRun("2", benchCase(1.1))]));
    expect(block[0]).toBe("Gate (report only, D163): block. 0 not slower, 1 slower, 0 no read.");
    expect(block).toHaveLength(2);
  });
});

/** This function gives one run of the bench with the cases of `ratios`, by name. */
function runOf(run: string, ratios: Readonly<Record<string, number>>, offset = 0): BenchRun {
  const cases = Object.entries(ratios).map(([name, ratio]): BenchCase => ({ ...benchCase(ratio, offset), name, head: pair(name, ratio, 12, offset), aa: pair(name, 1, 12, offset) }));
  return { run, cpu: "x", node: "26", rounds: 12, cases };
}

describe("the family read of the cases is report only (K225, D176)", () => {
  it("counts the same slower cases as the verdicts with no correction, and names the cases that Holm changes", () => {
    const runs = [runOf("1", { a: 1.1, b: 1, c: 1.003 }), runOf("2", { a: 1.1, b: 1, c: 1.002 }, 12)];
    const lines = familyLines(runs, ["a", "b", "c"]);
    expect(lines[0]).toMatch(/^Family read \(report only\): 3 cases\. Slower: 1, with Holm 1, with each job 1, with each job and Holm 1\. /);
    expect(["a", "b", "c"].map((name) => verdictOf(runs[0]?.cases.find((item) => item.name === name), runs[1]?.cases.find((item) => item.name === name)))).toEqual(["slower", "same", "same"]);
    expect(lines.some((line) => line.startsWith("3 of 3 cases have no p"))).toBe(false);
  });

  it("leaves out a case with different results or with one run", () => {
    const second = runOf("2", { a: 1, b: 1 }, 12);
    const different = { ...second, cases: second.cases.map((item) => (item.name === "a" ? { ...item, different: "1 and 2" } : item)) };
    expect(familyLines([runOf("1", { a: 1, b: 1 }), different], ["a", "b"])[0]).toContain("1 cases.");
    expect(familyLines([runOf("1", { a: 1, b: 1 }), undefined], ["a", "b"])[0]).toContain("0 cases.");
  });

  it("reads each job: a case that only one run reads slower is cannot decide in the read of each job", () => {
    const lines = familyLines([runOf("1", { a: 1.1 }), runOf("2", { a: 1.003 }, 12)], ["a"]);
    expect(lines[0]).toContain("Slower: 1, with Holm 1, with each job 0, with each job and Holm 0.");
    expect(lines).toContain('The case "a" reads slower, and a job alone does not read slower.');
  });
});
