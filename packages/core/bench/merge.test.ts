import type { PairedTime } from "@mark1russell7/rigor-bench";
import { describe, expect, it } from "vitest";
import { outcomeOf, roundsAsCases, verdictOf, type BenchCase } from "./merge.ts";

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
