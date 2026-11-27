import { describe, expect, it } from "vitest";
import { coevalMeasures, decisionCount, leanCode, leanGaps, leanTheorems, roadmapCounts, specRules } from "./kpi.ts";

describe("specRules", () => {
  it("counts each rule ID of a table one time", () => {
    const spec = ["## Documents", "", "| ID | Rule |", "| --- | --- |", "| DOC.STORED | A rule. |", "| DOC.HOST-EQUALS | A rule. |", "| EVAL.SEALED | A rule. |", "| DOC.STORED | The same ID again. |"].join("\n");
    expect(specRules(spec)).toBe(3);
  });

  it("does not count a header, an ID in the text or a word with no point", () => {
    expect(specRules(["| ID | Rule |", "| --- | --- |", "| NOTE | A word. |", "The rule DOC.STORED is in the text."].join("\n"))).toBe(0);
  });
});

describe("decisionCount", () => {
  it("counts each decision heading one time", () => {
    const text = ["# Decisions", "", "## D1 (2026-10-20): one", "text D9", "## D2 (2026-10-20): two", "### D3 is a sub-heading", "## D2 (again)", "## D10: ten"].join("\n");
    expect(decisionCount(text)).toBe(3);
  });
});

describe("the Lean counts", () => {
  it("removes line comments and nested block comments, and keeps the lines", () => {
    const text = ["theorem a : True := trivial -- sorry here", "/- a block /- nested sorry -/ still sorry -/", "/-- theorem in a doc -/", "lemma b : True := by sorry"].join("\n");
    expect(leanCode(text).split("\n")).toEqual(["theorem a : True := trivial ", "", "", "lemma b : True := by sorry"]);
  });

  it("counts the theorems and lemmas outside the comments, with their modifiers", () => {
    const files = ["theorem a : True := trivial\n  private theorem b : True := trivial\n-- theorem c", "protected lemma d : True := trivial\ntheorem_like e"];
    expect(leanTheorems(files)).toBe(3);
  });

  it("counts each sorry and admit outside the comments", () => {
    expect(leanGaps(["theorem a : True := by sorry -- sorry", "/- admit -/ example : True := by admit", "def sorryCount := 0"])).toBe(2);
    expect(leanGaps([])).toBe(0);
  });
});

describe("roadmapCounts", () => {
  it("puts waiting, blocked, progress and open rows into the open group", () => {
    expect(roadmapCounts(["done", "done", "later", "waiting", "blocked", "progress", "open"])).toEqual({ done: 2, open: 4, later: 1 });
    expect(roadmapCounts([])).toEqual({ done: 0, open: 0, later: 0 });
  });
});

describe("coevalMeasures", () => {
  it("gives the seven measures in a fixed order, each with a unit", () => {
    const measures = coevalMeasures({
      spec: "| DOC.STORED | A rule. |",
      decisions: "## D1 (2026-10-20): one",
      rows: ["done", "later", "blocked"],
      lean: ["theorem a : True := by sorry"],
    });
    expect(measures.map((m) => [m.id, m.value])).toEqual([
      ["roadmap-open", 1],
      ["roadmap-done", 1],
      ["roadmap-later", 1],
      ["spec-rules", 1],
      ["decisions", 1],
      ["lean-theorems", 1],
      ["lean-gaps", 1],
    ]);
    expect(measures.every((m) => m.unit !== "")).toBe(true);
  });
});
