import { describe, expect, it } from "vitest";
import { STD_CAPS, STD_EVALUATORS, STD_RUNNERS, STD_WALKERS, STD_WORLD, evaluate, makeContext, type Json, type Machine } from "@mark1russell7/coeval";
import { PROGRAMS } from "./programs.ts";
import { docText, markIssue, readText } from "./syntax.ts";

const MACHINE: Machine = { world: STD_WORLD, evaluators: STD_EVALUATORS, runners: STD_RUNNERS, walkers: STD_WALKERS };

/**
 * The programs that the profile of the site cannot write, with the reason and the place. Each one is a gap of the
 * printer of the kernel (D61). A fix of the kernel changes this list.
 */
const NO_TEXT: Readonly<Record<string, { readonly reason: string; readonly place: readonly string[] }>> = {
  names: { reason: "This syntax has no text for the header of a document.", place: ["0"] },
  choice: { reason: "This syntax has no text for the kind text.", place: ["then"] },
  effects: { reason: "This syntax has no text for the header of a document.", place: ["1"] },
  tree: { reason: "This syntax has no text for the kind panel.", place: [] },
  alias: { reason: "This syntax has no text for the kind math.product.", place: [] },
};

describe("the text of the playground (C17)", () => {
  for (const program of PROGRAMS) {
    const gap = NO_TEXT[program.id];
    if (gap === undefined) {
      it(`reads the text of ${program.id} back to the same document`, () => {
        const text = docText(program.doc);
        if (!text.ok) throw new Error(`The program ${program.id} has no text: ${text.reason}`);
        const back = readText(text.text);
        expect(back).toEqual({ ok: true, doc: program.doc });
      });
    } else {
      it(`gives the reason that ${program.id} has no text`, () => {
        expect(docText(program.doc)).toEqual({ ok: false, ...gap });
      });
    }
  }

  it("names each program of the gap list", () => {
    const ids = PROGRAMS.map((program) => program.id);
    for (const id of Object.keys(NO_TEXT)) expect(ids).toContain(id);
  });

  it("gives an issue with a span for a bad text, and no document", () => {
    const result = readText("2 + * 4");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const [issue] = result.issues;
    expect(issue).toMatchObject({ offset: 4, length: 1 });
    expect(markIssue("2 + * 4", issue ?? { offset: 0, length: 0, message: "" })).toEqual({ before: "2 + ", marked: "*", after: " 4" });
  });

  it("refuses a call name that the profile does not have", () => {
    const result = readText("max(1, 2)");
    expect(result.ok).toBe(false);
  });

  it("evaluates the document of a text with the standard world", () => {
    const result = readText("1 + 2 * 3");
    if (!result.ok) throw new Error(result.issues[0]?.message);
    expect(result.doc).toEqual({ type: "add", value: [1, { type: "multiply", value: [2, 3] }] });
    expect(evaluate(MACHINE, result.doc as Json, makeContext({}, STD_CAPS)).result).toEqual({ ok: true, value: 7 });
  });

  it("keeps an issue span inside the text", () => {
    expect(markIssue("1 +", { offset: 3, length: 0, message: "" })).toEqual({ before: "1 +", marked: "", after: "" });
    expect(markIssue("ab", { offset: 9, length: 4, message: "" })).toEqual({ before: "ab", marked: "", after: "" });
  });
});
