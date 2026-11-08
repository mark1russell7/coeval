import { describe, expect, it } from "vitest";
import { BREAKS, CONTRACTS, START_CONTRACT, codeLines, dutiesOf, examine, labelY, type BreakId, type Contract } from "./conformance.ts";

const obligations = (breaks: readonly BreakId[], contract: Contract = START_CONTRACT): readonly string[] => examine(new Set(breaks), contract).map((item) => item.obligation);

/** Each set of the breaks, as a list of the ids. */
const SETS: readonly (readonly BreakId[])[] = Array.from({ length: 2 ** BREAKS.length }, (_, mask) => BREAKS.filter((_item, index) => ((mask >> index) & 1) === 1).map((item) => item.id));

describe("the conformance diagram (K123)", () => {
  it("[CONFORM.SITE] the evaluator without a break conforms under each contract", () => {
    for (const contract of CONTRACTS) expect(obligations([], contract)).toEqual([]);
  });

  it("[CONFORM.SITE] each break alone gives a finding of its own duty, and an effect of a pure kind also breaks C4", () => {
    for (const item of BREAKS) {
      expect(obligations([item.id]), item.id).toEqual(item.id === "effect" ? ["C2", "C4"] : [item.duty]);
    }
    expect(obligations(["effect"], { pure: false, declaresLog: false })).toEqual(["C2"]);
  });

  it("[CONFORM.SITE] the contract permits an effect that it declares, and a read of the context in a kind that is not pure", () => {
    expect(obligations(["effect"], { pure: false, declaresLog: true })).toEqual([]);
    expect(obligations(["peek"], { pure: false, declaresLog: false })).toEqual([]);
  });

  it("[CONFORM.SITE] each duty of each set of breaks under each contract has a known state, and conforms finds no other duty", () => {
    const shown = new Set<string>(BREAKS.map((item) => item.duty));
    for (const contract of CONTRACTS) {
      for (const breaks of SETS) {
        const findings = examine(new Set(breaks), contract);
        for (const finding of findings) expect(shown.has(finding.obligation), finding.obligation).toBe(true);
        const missed = dutiesOf(new Set(breaks), contract, findings).filter((read) => read.state === "missed");
        expect(missed, `${breaks.join(",")} ${JSON.stringify(contract)}`).toEqual([]);
      }
    }
  });

  it("[CONFORM.SITE] a hidden duty gives its finding without the break that hides it, and a permitted duty under the other contract", () => {
    expect(obligations(["count", "peek", "leak"])).toEqual(["local"]);
    expect(obligations(["peek", "leak"])).toEqual(["C4", "C5"]);
    expect(obligations(["effect", "skip"])).toEqual(["C2", "C4"]);
    expect(obligations(["effect", "skip"], { pure: true, declaresLog: true })).toEqual(["C3", "C4"]);
    const reads = dutiesOf(new Set<BreakId>(["count", "peek", "skip", "effect"]), START_CONTRACT, examine(new Set<BreakId>(["count", "peek", "skip", "effect"]), START_CONTRACT));
    expect(reads.map((read) => [read.duty, read.state])).toEqual([
      ["C1", "kept"],
      ["C2", "found"],
      ["C3", "hidden"],
      ["C4", "found"],
      ["C5", "kept"],
      ["C7", "kept"],
      ["local", "found"],
    ]);
  });

  it("[CONFORM.SITE] each finding has a reason and a probe with the document and the results of its parts", () => {
    const [finding] = examine(new Set<BreakId>(["widen"]), START_CONTRACT);
    expect(finding?.reason).toContain("capabilities");
    expect(finding?.probe.type).toBe("tally");
    expect(Object.keys(finding?.probe.results ?? {}).length).toBeGreaterThan(0);
  });

  it("[CONFORM.SITE] the code shows one changed line for each break", () => {
    expect(codeLines(new Set()).filter((line) => line.broken !== undefined)).toEqual([]);
    const all = codeLines(new Set(BREAKS.map((item) => item.id)));
    expect(all.filter((line) => line.broken !== undefined).map((line) => line.broken?.id).sort()).toEqual(BREAKS.map((item) => item.id).sort());
  });

  it("puts the label of a lamp straight above the centre above the lamp, so its spoke does not cross the label", () => {
    const centre = { x: 186, y: 150 };
    expect(labelY({ x: 186, y: 50 }, centre, 21)).toBe(19);
    expect(labelY({ x: 186, y: 250 }, centre, 21)).toBe(286);
    expect(labelY({ x: 264, y: 88 }, centre, 21)).toBe(124);
  });
});
