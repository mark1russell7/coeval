import { STD_SYNTAX, parse, print, type Json, type Key, type ParseResult, type SyntaxIssue, type SyntaxProfile } from "@mark1russell7/coeval";

/** The word of each symbol that the profile Words replaces. */
const WORDS_OF: Readonly<Record<string, string>> = { "+": "plus", "-": "minus", "*": "times", "/": "over" };

/** The standard profile with words in place of four infix symbols, and the form `when` in place of `if`. */
const WORDS: SyntaxProfile = {
  ...STD_SYNTAX,
  operators: (STD_SYNTAX.operators ?? []).map((operator) => {
    const word = operator.fixity === "infix" ? WORDS_OF[operator.symbol] : undefined;
    return word === undefined ? operator : { ...operator, symbol: word };
  }),
  calls: {
    ...STD_SYNTAX.calls,
    forms: [
      { name: "when", kind: "if", fields: ["test", "then", "else"], min: 2 },
      { name: "list", kind: "list" },
    ],
  },
};

/** The standard profile with one more reference syntax: `$A1` is the path `["cells", "A1"]`. */
const CELLS: SyntaxProfile = {
  ...STD_SYNTAX,
  refs: {
    patterns: [
      {
        pattern: /\$[A-Z]+[0-9]+/,
        read: (text): readonly Key[] => ["cells", text.slice(1)],
        write: (path) => (path[0] === "cells" && path.length === 2 ? `$${String(path[1])}` : undefined),
      },
    ],
  },
};

/** The names of the profiles of the diagram. */
export type ProfileId = "symbols" | "words" | "cells";

/** One profile of the diagram, with the text that tells a reader what it changes. */
export interface ProfileRow {
  readonly id: ProfileId;
  readonly label: string;
  readonly note: string;
  readonly profile: SyntaxProfile;
}

/** The profiles of the diagram. Each one is data, and one parser reads all of them. */
export const PROFILE_ROWS: readonly ProfileRow[] = [
  { id: "symbols", label: "Symbols", note: "The profile STD_SYNTAX of the kernel.", profile: STD_SYNTAX },
  { id: "words", label: "Words", note: "Four operators are words, and if is when.", profile: WORDS },
  { id: "cells", label: "Cells", note: "The text $A1 is a reference to a cell.", profile: CELLS },
];

function rowOf(id: ProfileId): ProfileRow {
  return PROFILE_ROWS.find((row) => row.id === id) ?? { id, label: id, note: "", profile: STD_SYNTAX };
}

/**
 * This function reads a text with a profile of the diagram.
 *
 * @param id - The name of the profile.
 * @param text - The text.
 * @returns The document, or the issues of the text.
 */
export function readWith(id: ProfileId, text: string): ParseResult {
  return parse(rowOf(id).profile, text);
}

/** The text of a document in one profile, or the reason that the profile has no text for it. */
export type PrintedRow = { readonly id: ProfileId; readonly ok: true; readonly text: string } | { readonly id: ProfileId; readonly ok: false; readonly reason: string };

/**
 * This function writes one document with each profile of the diagram.
 *
 * @param doc - The document.
 * @returns One row for each profile.
 */
export function printEach(doc: Json): readonly PrintedRow[] {
  return PROFILE_ROWS.map(({ id, profile }) => {
    const result = print(profile, doc);
    return result.ok ? { id, ok: true, text: result.value } : { id, ok: false, reason: result.error.reason };
  });
}

/** The state of the diagram. `doc` is the last document that a text gave, thus an issue keeps the tree in place. */
export interface KitState {
  readonly profile: ProfileId;
  readonly text: string;
  readonly doc: Json;
  readonly issues: readonly SyntaxIssue[];
}

/**
 * This function gives the state after a new text.
 *
 * @param state - The state before the text.
 * @param text - The new text.
 * @returns The new state. A bad text keeps the last document and gives its issues.
 */
export function typed(state: KitState, text: string): KitState {
  const result = readWith(state.profile, text);
  return result.ok ? { ...state, text, doc: result.doc, issues: [] } : { ...state, text, issues: result.issues };
}

/**
 * This function gives the state after a change of the profile. A good document stays, and the text is its text in
 * the new profile. Without that text, the new profile reads the old text.
 *
 * @param state - The state before the change.
 * @param id - The name of the new profile.
 * @returns The new state.
 */
export function switched(state: KitState, id: ProfileId): KitState {
  const printed = state.issues.length === 0 ? printEach(state.doc).find((row) => row.id === id) : undefined;
  if (printed?.ok === true) return { ...state, profile: id, text: printed.text };
  return typed({ ...state, profile: id }, state.text);
}

/**
 * This function gives the first state of an example.
 *
 * @param id - The name of the profile.
 * @param text - The text.
 * @param fallback - The document of the state when the text is bad.
 * @returns The state.
 */
export function started(id: ProfileId, text: string, fallback: Json = null): KitState {
  return typed({ profile: id, text, doc: fallback, issues: [] }, text);
}

/** A text to try in the diagram. */
export interface KitExample {
  readonly id: string;
  readonly label: string;
  readonly profile: ProfileId;
  readonly text: string;
}

/** The examples of the diagram. */
export const KIT_EXAMPLES: readonly KitExample[] = [
  { id: "price", label: "A sum", profile: "symbols", text: "price * 2 + tax" },
  { id: "choice", label: "A choice", profile: "symbols", text: "if(count > 9, price * 2, 0)" },
  { id: "named", label: "A name", profile: "symbols", text: "total = price + tax" },
  { id: "cells", label: "Two cells", profile: "cells", text: "$A1 * 2 + $B2" },
  { id: "bad", label: "A bad text", profile: "symbols", text: "price * (2 + " },
];

/** One line of the tree of a document. */
export interface OutlineNode {
  /** The place of the node in its parent: a field name, or nothing for a list item. */
  readonly key?: string;
  /** The text of the node. */
  readonly label: string;
  readonly children: readonly OutlineNode[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeText(type: unknown): string {
  return Array.isArray(type) ? type.map(String).join(".") : String(type);
}

function childrenOf(value: unknown): readonly OutlineNode[] {
  if (Array.isArray(value)) return value.map((each) => outline(each as Json));
  if (isRecord(value)) return Object.entries(value).map(([key, each]) => ({ ...outline(each as Json), key }));
  return [];
}

/**
 * This function gives the tree of a document for a reader. A reference is one line, because its value is a path.
 *
 * @param doc - The document.
 * @returns The first node of the tree.
 */
export function outline(doc: Json): OutlineNode {
  if (isRecord(doc) && "type" in doc) {
    const name = typeof doc["name"] === "string" ? ` named ${doc["name"]}` : "";
    const type = typeText(doc["type"]);
    if (type === "ref" && Array.isArray(doc["value"])) return { label: `ref ${doc["value"].map(String).join(".")}${name}`, children: [] };
    return { label: `${type}${name}`, children: childrenOf(doc["value"]) };
  }
  if (isRecord(doc) || Array.isArray(doc)) return { label: Array.isArray(doc) ? "a list" : "a record", children: childrenOf(doc) };
  return { label: doc === undefined ? "undefined" : JSON.stringify(doc), children: [] };
}

/** One piece of a text. `issue` is the index of the issue that marks the piece. */
export interface TextPiece {
  readonly text: string;
  readonly issue?: number;
}

/**
 * This function cuts a text at the spans of its issues. The pieces join to the text, and a span of no length gives an
 * empty piece at its place. A span that starts inside an earlier span gets no piece.
 *
 * @param text - The text.
 * @param issues - The issues.
 * @returns The pieces, from the start of the text.
 */
export function issuePieces(text: string, issues: readonly SyntaxIssue[]): readonly TextPiece[] {
  const spans = issues
    .map((each, issue) => {
      const start = Math.min(Math.max(each.offset, 0), text.length);
      return { issue, start, end: Math.min(start + Math.max(each.length, 0), text.length) };
    })
    .sort((a, b) => a.start - b.start || a.issue - b.issue);
  const pieces: TextPiece[] = [];
  let at = 0;
  for (const { issue, start, end } of spans) {
    if (start < at) continue;
    if (start > at) pieces.push({ text: text.slice(at, start) });
    pieces.push({ text: text.slice(start, end), issue });
    at = end;
  }
  if (at < text.length) pieces.push({ text: text.slice(at) });
  return pieces;
}
