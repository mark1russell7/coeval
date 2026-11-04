import { describe, expect, it } from "vitest";
import { KIT_EXAMPLES, PROFILE_ROWS, issuePieces, outline, printEach, readWith, started, switched, typed } from "./profiles.ts";

const docOf = (text: string): unknown => {
  const result = readWith("symbols", text);
  if (!result.ok) throw new Error(text);
  return result.doc;
};

describe("the profiles of the syntax diagram", () => {
  it("reads one document from the text of each profile", () => {
    const doc = docOf("price * 2 + tax");
    const rows = printEach(doc as never);
    expect(rows.map((row) => (row.ok ? row.text : row.reason))).toEqual(["price * 2 + tax", "price times 2 plus tax", "price * 2 + tax"]);
    for (const row of rows) {
      if (!row.ok) continue;
      const again = readWith(row.id, row.text);
      expect(again).toEqual({ ok: true, doc });
    }
  });

  it("gives the reason of a profile that has no text for a document", () => {
    const result = readWith("cells", "$A1 + 2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc).toMatchObject({ value: [{ value: ["cells", "A1"] }, 2] });
    const rows = printEach(result.doc);
    expect(rows.filter((row) => row.ok).map((row) => row.id)).toEqual(["cells"]);
  });

  it("gives each issue of a bad text a span inside the text", () => {
    for (const row of PROFILE_ROWS) {
      for (const text of ["price * (2 + ", "1 2", "$", ")"]) {
        const result = readWith(row.id, text);
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        expect(result.issues.length).toBeGreaterThan(0);
        for (const issue of result.issues) {
          expect(issue.offset).toBeGreaterThanOrEqual(0);
          expect(issue.offset + issue.length).toBeLessThanOrEqual(text.length);
          expect(issue.message.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("starts each example with the state that its label tells", () => {
    for (const example of KIT_EXAMPLES) {
      const state = started(example.profile, example.text);
      expect(state.issues.length > 0).toBe(example.id === "bad");
    }
  });
});

describe("the state of the syntax diagram", () => {
  it("keeps the document and changes the text when the new profile has a text", () => {
    const state = started("symbols", "price * 2 + tax");
    const next = switched(state, "words");
    expect(next).toEqual({ ...state, profile: "words", text: "price times 2 plus tax" });
  });

  it("reads the old text when the new profile has no text for the document", () => {
    const state = started("cells", "$A1 * 2");
    const next = switched(state, "symbols");
    expect(next.text).toBe("$A1 * 2");
    expect(next.doc).toEqual(state.doc);
    expect(next.issues[0]?.offset).toBe(0);
  });

  it("reads the same text with the new profile after an issue", () => {
    const state = typed(started("symbols", "1"), "1 plus 2");
    expect(state.issues).toHaveLength(1);
    const next = switched(state, "words");
    expect(next.issues).toEqual([]);
    expect(next.text).toBe("1 plus 2");
    expect(outline(next.doc).label).toBe("ops.add");
  });

  it("keeps the last document under a bad text", () => {
    const state = started("symbols", "1 + 2");
    const next = typed(state, "1 +");
    expect(next.doc).toEqual(state.doc);
    expect(next.issues).toHaveLength(1);
  });
});

describe("the views of the syntax diagram", () => {
  it("gives the tree of a document", () => {
    expect(outline(docOf("total = if(a > 1, 2, 3)") as never)).toEqual({
      label: "if named total",
      children: [
        { key: "test", label: "ops.gt", children: [{ label: "ref names.a", children: [] }, { label: "1", children: [] }] },
        { key: "then", label: "2", children: [] },
        { key: "else", label: "3", children: [] },
      ],
    });
  });

  it("gives the tree of plain data", () => {
    expect(outline(["a", { b: null }] as never)).toEqual({
      label: "a list",
      children: [
        { label: '"a"', children: [] },
        { label: "a record", children: [{ key: "b", label: "null", children: [] }] },
      ],
    });
  });

  it("cuts a text at each issue, and the pieces join to the text", () => {
    const text = "1 + ) + (";
    const issues = [
      { offset: 8, length: 1, message: "second" },
      { offset: 4, length: 1, message: "first" },
      { offset: 4, length: 3, message: "inside" },
      { offset: 9, length: 0, message: "end" },
    ];
    const pieces = issuePieces(text, issues);
    expect(pieces.map((piece) => piece.text).join("")).toBe(text);
    expect(pieces.filter((piece) => piece.issue !== undefined).map((piece) => piece.issue)).toEqual([1, 0, 3]);
  });

  it("keeps a span inside the text", () => {
    expect(issuePieces("ab", [{ offset: 9, length: 9, message: "past" }])).toEqual([{ text: "ab" }, { text: "", issue: 0 }]);
    expect(issuePieces("", [])).toEqual([]);
  });
});
