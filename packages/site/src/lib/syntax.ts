import { parse, print, type Json, type ParseResult, type SyntaxIssue, type SyntaxProfile } from "@mark1russell7/coeval";

/**
 * The text syntax of the world of the site (C17, D61). The syntax kit (C15, D41) reads it. `STD_SYNTAX` writes the
 * kinds of the formula kit, but the playground evaluates the kinds of the standard world. Thus this profile names
 * those kinds: `+` is `add`, `*` is `multiply` and `>` is `greater`. The call forms make the other constructs. The
 * form `math.product` writes the alias of `multiply`, and `a = 1 + 2` gives a step the name `a` (D62).
 *
 * The text `text("big")` is a data envelope, and `panel(width: 300)` is a node of a tree with its fields (D63).
 */
export const SITE_SYNTAX: SyntaxProfile = Object.freeze({
  operators: [
    { symbol: ">", fixity: "infix", prec: 4, assoc: "none", kind: "greater" },
    { symbol: "+", fixity: "infix", prec: 5, assoc: "flat", kind: "add" },
    { symbol: "*", fixity: "infix", prec: 6, assoc: "flat", kind: "multiply" },
  ],
  calls: {
    ops: [],
    forms: [
      { name: "if", kind: "if", fields: ["test", "then", "else"], min: 2 },
      { name: "list", kind: "list" },
      { name: "seq", kind: "seq" },
      { name: "pure", kind: "pure", min: 1 },
      { name: "log", kind: "log", min: 1 },
      { name: "write", kind: "write", fields: ["key", "value"] },
      { name: "math.product", kind: "math.product" },
      { name: "number", kind: "number", args: "literal" },
      { name: "text", kind: "text", args: "literal" },
      { name: "bool", kind: "bool", args: "literal" },
      { name: "panel", kind: "panel", args: "named", fields: ["width", "height", "children"] },
      { name: "box", kind: "box", args: "named", fields: ["width", "height", "children"] },
      { name: "nearest", kind: "nearest", args: "named", fields: ["type", "follow", "self"] },
    ],
  },
  header: { bind: "=" },
} satisfies SyntaxProfile);

/** The text of a document, or the reason that the profile has no text for it. */
export type DocText =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string; readonly place: readonly string[] };

/**
 * This function writes a document as text with the profile of the site.
 *
 * @param doc - The document.
 * @returns The text, or the reason and the place of the part that has no text.
 */
export function docText(doc: Json): DocText {
  const result = print(SITE_SYNTAX, doc);
  if (result.ok) return { ok: true, text: result.value };
  return { ok: false, reason: result.error.reason, place: (result.error.place ?? []).map(String) };
}

/**
 * This function reads a text into a document with the profile of the site. A bad text gives its issue and no document.
 *
 * @param text - The text.
 * @returns The document, or the issue of the text.
 */
export function readText(text: string): ParseResult {
  return parse(SITE_SYNTAX, text);
}

/** The three parts of a text around an issue: before the issue, the issue, and after it. */
export interface MarkedText {
  readonly before: string;
  readonly marked: string;
  readonly after: string;
}

/**
 * This function cuts a text at the span of an issue, so that a view can mark the span.
 *
 * @param text - The text.
 * @param issue - The issue, with its offset and its length.
 * @returns The text before the span, the span, and the text after it.
 */
export function markIssue(text: string, issue: SyntaxIssue): MarkedText {
  const start = Math.min(Math.max(issue.offset, 0), text.length);
  const end = Math.min(start + Math.max(issue.length, 0), text.length);
  return { before: text.slice(0, start), marked: text.slice(start, end), after: text.slice(end) };
}
