import { describe, expect, it } from "vitest";
import { STD_WORLD, generate, typed, type GenerateOptions, type Json } from "@mark1russell7/coeval";
import { prettyJson } from "./motion.ts";

/** Texts with brackets and braces. A printer that edits its text, and not the structure, changes them. */
const BRACKETS = ["a [ b ] c", "{ x }", "[ ]", "{  }", "}{", "a, [ 1,\n  2 ]", "{\n  \"a\": 1\n}", "\\[ q ]"] as const;

/** The printer before K274. It ran two regular expressions over the whole text. The test of the layout compares with it. */
function regexPrinter(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  return text
    .replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_match, inner: string) => `[${inner.replace(/\s*\n\s*/g, " ")}]`)
    .replace(/\{\s+([^[\]{}]{0,40}?)\s+\}/g, (_match, inner: string) => `{ ${inner.replace(/\s*\n\s*/g, " ")} }`);
}

/** The data of a document: a text of `BRACKETS` at approximately one draw of two, or else the data of the generator. */
const bracketData: NonNullable<GenerateOptions["data"]> = (_type, random) => (random.chance(0.5) ? random.pick(BRACKETS) : undefined);

/**
 * The documents of the generator of coeval, from 200 seeds. Its random numbers come from `@mark1russell7/rigor-generators`.
 * With `brackets`, the data of the documents comes from `bracketData`.
 */
function documents(brackets: boolean): readonly unknown[] {
  return Array.from({ length: 200 }, (_each, seed) => generate(STD_WORLD, brackets ? { seed, data: bracketData } : { seed }));
}

describe("prettyJson (K274)", () => {
  it("does not change the text of a string", () => {
    const values: readonly Json[] = [
      "a [ b ] c",
      ["a [ b ] c", "{ x }"],
      { text: "{  }" },
      { "[ k ]": ["}{", "[ ]"], "{ l }": { m: "[\n]" } },
      typed("text", "a [ b ] c"),
      typed("add", [typed("text", "[ 1, 2 ]"), [["{ }"]]]),
    ];
    for (const value of values) expect(JSON.parse(prettyJson(value))).toEqual(value);
  });

  it("gives the same JSON for generated documents with brackets and braces in their texts", () => {
    const found = documents(true);
    expect(found.filter((doc) => BRACKETS.some((text) => JSON.stringify(doc).includes(JSON.stringify(text)))).length).toBeGreaterThan(100);
    for (const doc of found) expect(JSON.parse(prettyJson(doc))).toEqual(doc);
  });

  it("keeps the layout of before for documents with no bracket or brace in a text", () => {
    expect(prettyJson(typed("add", [1, 2]))).toBe('{\n  "type": "add",\n  "value": [1, 2]\n}');
    expect(prettyJson(typed("number", 2))).toBe('{ "type": "number", "value": 2 }');
    expect(prettyJson([])).toBe("[]");
    expect(prettyJson({})).toBe("{}");
    for (const doc of documents(false)) expect(prettyJson(doc)).toBe(regexPrinter(doc));
  });

  it("gives an empty text for a value with no JSON text", () => {
    expect(prettyJson(undefined)).toBe("");
  });
});
