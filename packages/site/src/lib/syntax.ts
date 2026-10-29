import { WORLD_SYNTAX, parse, print, type Json, type ParseResult, type SyntaxIssue, type SyntaxProfile } from "@mark1russell7/coeval";

/**
 * The text syntax of the world of the site (C17, D61). The site world is `STD_WORLD` and the kind `kind`. Thus this
 * profile is `WORLD_SYNTAX`, the profile of the standard world that the kernel gives (D64). The kind `kind` has only a
 * view, and the playground does not read it as text, thus the site adds no form.
 *
 * A site kind with a text spreads the kernel profile and adds its form to `calls.forms`.
 */
export const SITE_SYNTAX: SyntaxProfile = WORLD_SYNTAX;

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
