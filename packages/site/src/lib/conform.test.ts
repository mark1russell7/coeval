import { describe, expect, it } from "vitest";
import { CODE_BREAKS, OBLIGATION_ROWS, checkCode } from "./conform.ts";

const item = (id: string) => CODE_BREAKS.find((each) => each.id === id)!;
const obligations = (id: string, permitted = false): readonly string[] => [...new Set(checkCode(item(id), permitted).map((finding) => finding.obligation))];

describe("the checks of the conformance diagram", () => {
  it("[CONFORM.STD] the good code gives no finding", () => {
    expect(checkCode(item("good"), false)).toEqual([]);
  });

  it.each([
    ["wide", "C1"],
    ["noisy", "C2"],
    ["first", "C3"],
    ["peek", "C4"],
    ["leak", "C5"],
    ["counter", "local"],
  ])("[CONFORM.STD] the code %s breaks %s, and each finding has its probe", (id, obligation) => {
    expect(obligations(id)).toEqual([obligation]);
    for (const finding of checkCode(item(id), false)) {
      expect(finding.reason.length).toBeGreaterThan(0);
      expect(finding.probe.type).toBe("checked");
    }
  });

  it.each(["noisy", "first"])("[CONFORM.EFFECTS] the code %s conforms when its contract declares it", (id) => {
    expect(checkCode(item(id), true)).toEqual([]);
  });

  it("gives each obligation of a break a row with a text", () => {
    const ids = OBLIGATION_ROWS.map((row) => row.id);
    for (const each of CODE_BREAKS) for (const finding of checkCode(each, false)) expect(ids).toContain(finding.obligation);
  });
});
