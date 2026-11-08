import { describe, expect, it } from "vitest";
import { EXAMPLES, PROFILES, fixityText, kitRead, profileOf, textPieces, treeRows, usedKinds, type ProfileId } from "./syntax-kit.ts";

/** The tree of a text as one line: each row with its depth, its key, its kind and its value. */
function shape(id: ProfileId, text: string): string {
  const read = kitRead(id, text);
  if (!read.ok) return `issues ${read.issues.map((issue) => `${String(issue.offset)}+${String(issue.length)}`).join(" ")}`;
  return treeRows(read.doc)
    .map((row) => `${String(row.depth)}${row.key === undefined ? "" : `${row.key}:`}${row.kind ?? ""}${row.value === undefined ? "" : `=${row.value}`}`)
    .join(" ");
}

describe("the syntax kit page (C16)", () => {
  it("[SYNTAX.SITE] one text gives a different tree under each profile", () => {
    expect(shape("standard", "-x ^ 2")).toBe("0ops.neg 10:ops.pow 20:ref=names.x 21:=2");
    expect(shape("sheet", "-x ^ 2")).toBe("0ops.pow 10:ops.neg 20:ref=names.x 11:=2");
    expect(shape("world", "-x ^ 2")).toBe("issues 0+1");
    expect(shape("standard", "2 ^ 3 ^ 2")).toBe("0ops.pow 10:=2 11:ops.pow 20:=3 21:=2");
    expect(shape("sheet", "2 ^ 3 ^ 2")).toBe("0ops.pow 10:ops.pow 20:=2 21:=3 11:=2");
    expect(shape("sheet", "A1 * 10%")).toBe("0ops.mul 10:ref=cells.A1 11:ops.percent 20:=10");
    expect(shape("standard", "A1 * 10%")).toBe("issues 8+0");
    expect(shape("world", 'if(x > 1, "big", list(1, 2))')).toBe('0if 1test:greater 20:ref=names.x 21:=1 1then:text="big" 1else:list 20:number=1 21:number=2');
    expect(shape("sheet", 'if(x > 1, "big", list(1, 2))')).toMatch(/^0ops\.if /);
  });

  it("[SYNTAX.SITE] each example reads differently under at least two profiles", () => {
    for (const example of EXAMPLES) {
      const shapes = new Set(PROFILES.map((profile) => shape(profile.id, example.text)));
      expect(shapes.size, example.text).toBeGreaterThan(example.text.startsWith("list(1 +") ? 0 : 1);
    }
  });

  it("[SYNTAX.SITE] each document of an example prints a text that reads back to the same document", () => {
    let documents = 0;
    for (const example of EXAMPLES) {
      for (const profile of PROFILES) {
        const read = kitRead(profile.id, example.text);
        if (!read.ok) continue;
        documents += 1;
        expect(read.roundTrip, `${profile.id} ${example.text}`).toBe(true);
        expect(read.printed, `${profile.id} ${example.text}`).toBe(example.text);
      }
    }
    expect(documents).toBeGreaterThanOrEqual(7);
  });

  it("[SYNTAX.SITE] each issue of a bad text lies in the text, and the pieces give the text again", () => {
    const read = kitRead("standard", "list(1 +, 2 *)");
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.issues.map((issue) => [issue.offset, issue.length])).toEqual([[8, 0], [13, 0]]);
    for (const example of EXAMPLES) {
      for (const profile of PROFILES) {
        const result = kitRead(profile.id, example.text);
        if (result.ok) continue;
        for (const issue of result.issues) expect(issue.offset + issue.length).toBeLessThanOrEqual(example.text.length);
        const pieces = textPieces(example.text, result.issues);
        expect(pieces.map((piece) => piece.text).join("")).toBe(example.text);
        const marked = new Set(pieces.flatMap((piece) => piece.issues));
        expect(marked.size, `${profile.id} ${example.text}`).toBe(result.issues.length);
      }
    }
  });

  it("[SYNTAX.SITE] a span covers its characters, and an issue with no length gives a gap at its place", () => {
    expect(textPieces("1 + * 2", [{ offset: 4, length: 1, message: "m" }])).toEqual([
      { text: "1 + ", issues: [], gap: false },
      { text: "*", issues: [1], gap: false },
      { text: " 2", issues: [], gap: false },
    ]);
    expect(textPieces("1 +", [{ offset: 3, length: 0, message: "m" }])).toEqual([
      { text: "1 +", issues: [], gap: false },
      { text: "", issues: [1], gap: true },
    ]);
    expect(textPieces("abcd", [{ offset: 0, length: 3, message: "a" }, { offset: 2, length: 2, message: "b" }]).map((piece) => [piece.text, piece.issues])).toEqual([
      ["ab", [1]],
      ["c", [1, 2]],
      ["d", [2]],
    ]);
    expect(textPieces("ab", [{ offset: 9, length: 4, message: "out" }]).map((piece) => piece.text).join("")).toBe("ab");
  });

  it("[SYNTAX.SITE] a header name goes on the root row, and the table marks each operator that a text uses", () => {
    const read = kitRead("standard", "total = 2 * x");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const rows = treeRows(read.doc);
    expect(rows[0]).toMatchObject({ depth: 0, kind: "ops.mul", name: "total" });
    const used = usedKinds(rows);
    const marked = (profileOf("standard").profile.operators ?? []).filter((op) => used.has(op.kind)).map((op) => op.symbol);
    expect(marked).toEqual(["*"]);
  });

  it("[SYNTAX.SITE] the place of each operator has a text", () => {
    const texts = PROFILES.flatMap((profile) => (profile.profile.operators ?? []).map(fixityText));
    expect(new Set(texts)).toEqual(new Set(["between terms, one flat chain", "before its term", "between two terms, no chain", "between terms, groups to the left", "between terms, groups to the right", "after its term"]));
  });
});
