import { describe, expect, it } from "vitest";
import { STD_CAPS, STD_EVALUATORS, STD_RUNNERS, STD_WALKERS, STD_WORLD, evaluate, makeContext, type Json, type Machine } from "@mark1russell7/coeval";
import { PROGRAMS, VALUES } from "./programs.ts";
import { docText, markIssue, readText } from "./syntax.ts";

const MACHINE: Machine = { world: STD_WORLD, evaluators: STD_EVALUATORS, runners: STD_RUNNERS, walkers: STD_WALKERS };

/**
 * The programs that the profile of the site cannot write, with the reason and the place. Each one is a gap of the
 * printer of the kernel (D61, D62). A fix of the kernel changes this list. Since D63, each program prints, thus the
 * list is empty.
 */
const NO_TEXT: Readonly<Record<string, { readonly reason: string; readonly place: readonly string[] }>> = {};

/** The text of each program that prints (D62, D63). The test reads each text back to the same document. */
const TEXT: Readonly<Record<string, string>> = {
  add: "2 + 3 * 4",
  choice: 'if(size > 10, text("big"), log("small"))',
  tree: 'panel(width: 300, children: list(box(width: self.parent.width + -20, children: list(box(width: self.parent.(nearest(type: "panel")).width)))))',
  names: "seq(a = 1 + 2, b = a * 10, log(b))",
  effects: 'seq(log("start"), total = write("total", 2 + 3), log(total))',
  pure: 'pure(log("hello"))',
  missing: "price + 2",
  alias: "math.product(6, 7)",
};

describe("the text of the playground (C17)", () => {
  for (const program of PROGRAMS) {
    const gap = NO_TEXT[program.id];
    if (gap === undefined) {
      it(`reads the text of ${program.id} back to the same document`, () => {
        const text = docText(program.doc);
        if (!text.ok) throw new Error(`The program ${program.id} has no text: ${text.reason}`);
        expect(text.text).toBe(TEXT[program.id]);
        const back = readText(text.text);
        expect(back).toEqual({ ok: true, doc: program.doc });
      });
    } else {
      it(`gives the reason that ${program.id} has no text`, () => {
        expect(docText(program.doc)).toEqual({ ok: false, ...gap });
      });
    }
  }

  it("names each program of the gap list and of the text list", () => {
    const ids = PROGRAMS.map((program) => program.id);
    for (const id of Object.keys(NO_TEXT)) expect(ids).toContain(id);
    expect([...Object.keys(NO_TEXT), ...Object.keys(TEXT)].sort()).toEqual([...ids].sort());
  });

  it("evaluates the steps with names of a text, and the alias of a type as a path (D62)", () => {
    const names = readText("seq(a = 1 + 2, b = a * 10, b)");
    if (!names.ok) throw new Error(names.issues[0]?.message);
    expect(evaluate(MACHINE, names.doc as Json, makeContext({}, STD_CAPS)).result).toEqual({ ok: true, value: 30 });
    const alias = readText("math.product(6, 7)");
    if (!alias.ok) throw new Error(alias.issues[0]?.message);
    expect(evaluate(MACHINE, alias.doc as Json, makeContext({}, STD_CAPS)).result).toEqual({ ok: true, value: 42 });
  });

  it("writes each data envelope as a form with one literal, and evaluates the text of a choice (D63)", () => {
    expect(VALUES.map((value) => docText(value))).toEqual([
      { ok: true, text: "number(42)" },
      { ok: true, text: 'text("Notes")' },
      { ok: true, text: "bool(true)" },
      { ok: true, text: "list(1, 2, 3)" },
    ]);
    for (const value of VALUES) {
      const text = docText(value);
      if (text.ok) expect(readText(text.text)).toEqual({ ok: true, doc: value });
    }
    const choice = readText('if(size > 10, text("big"), log("small"))');
    if (!choice.ok) throw new Error(choice.issues[0]?.message);
    expect(evaluate(MACHINE, choice.doc as Json, makeContext({ size: 12 }, STD_CAPS)).result).toEqual({ ok: true, value: "big" });
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
