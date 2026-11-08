import { STD_SYNTAX, docEquals, parse, print, type Json, type SyntaxIssue, type SyntaxOperator, type SyntaxProfile } from "@mark1russell7/coeval";
import { SITE_SYNTAX } from "./syntax.ts";

/** The text of a cell address, for example `A1` or `$B$2`. */
const CELL = /^\$?[A-Z]{1,3}\$?[0-9]+$/;

/**
 * A profile like the formulas of a spreadsheet (C16). In this profile, the comparisons bind loosest and `&` joins texts.
 * `^` groups to the left, and a minus sign binds more tightly than `^`. `%` comes after its term, and `A1` is a cell.
 */
export const SHEET_SYNTAX: SyntaxProfile = {
  operators: [
    { symbol: "=", fixity: "infix", prec: 1, kind: "ops.eq" },
    { symbol: "<>", fixity: "infix", prec: 1, kind: "ops.ne" },
    { symbol: "<", fixity: "infix", prec: 1, kind: "ops.lt" },
    { symbol: "<=", fixity: "infix", prec: 1, kind: "ops.le" },
    { symbol: ">", fixity: "infix", prec: 1, kind: "ops.gt" },
    { symbol: ">=", fixity: "infix", prec: 1, kind: "ops.ge" },
    { symbol: "&", fixity: "infix", prec: 2, kind: "ops.concat" },
    { symbol: "+", fixity: "infix", prec: 3, kind: "ops.add" },
    { symbol: "-", fixity: "infix", prec: 3, kind: "ops.sub" },
    { symbol: "*", fixity: "infix", prec: 4, kind: "ops.mul" },
    { symbol: "/", fixity: "infix", prec: 4, kind: "ops.div" },
    { symbol: "^", fixity: "infix", prec: 5, kind: "ops.pow" },
    { symbol: "%", fixity: "postfix", prec: 6, kind: "ops.percent" },
    { symbol: "-", fixity: "prefix", prec: 7, kind: "ops.neg" },
  ],
  literals: { strings: { escape: "double" }, words: { TRUE: true, FALSE: false } },
  refs: {
    roots: [],
    fields: false,
    patterns: [
      {
        pattern: /\$?[A-Z]{1,3}\$?[0-9]+/,
        read: (cell) => ["cells", cell],
        write: (path) => (path.length === 2 && path[0] === "cells" && typeof path[1] === "string" && CELL.test(path[1]) ? path[1] : undefined),
      },
    ],
  },
  calls: { forms: [{ name: "IF", kind: "if", fields: ["test", "then", "else"], min: 2 }] },
};

/** The id of a profile of the page. */
export type ProfileId = "standard" | "sheet" | "world";

/** A profile of the page, with its name and what makes it different. */
export interface KitProfile {
  readonly id: ProfileId;
  readonly label: string;
  readonly note: string;
  readonly profile: SyntaxProfile;
}

/** The three profiles of the page. Each one is data for the one parser and printer of the kit. */
export const PROFILES: readonly KitProfile[] = [
  { id: "standard", label: "Standard", note: "STD_SYNTAX of the core. `^` groups to the right and binds more tightly than a minus sign. `%` is the remainder.", profile: STD_SYNTAX },
  { id: "sheet", label: "Spreadsheet", note: "A profile like the formulas of a spreadsheet. `^` groups to the left, a minus sign binds more tightly than `^`, `%` comes after its term, and `A1` is a cell.", profile: SHEET_SYNTAX },
  { id: "world", label: "World", note: "WORLD_SYNTAX, the profile of the standard world, as the playground reads it. It has no `^` and no minus sign before a term. A literal in a place of a document gets its data envelope.", profile: SITE_SYNTAX },
];

/** An example text of the page, and what it shows. */
export interface KitExample {
  readonly text: string;
  readonly note: string;
}

/** The examples. Each one reads differently under at least two profiles. */
export const EXAMPLES: readonly KitExample[] = [
  { text: "-x ^ 2", note: "The precedence of the minus sign decides the tree." },
  { text: "2 ^ 3 ^ 2", note: "The grouping of `^` decides the tree. The world has no `^`." },
  { text: "A1 * 10%", note: "Only the spreadsheet has cells and a `%` after its term." },
  { text: 'if(x > 1, "big", list(1, 2))', note: "A call form makes a construct. The world puts each literal in its envelope." },
  { text: "list(1 +, 2 *)", note: "A bad text gives each issue at its place, and no document." },
];

/** The profile of an id. */
export function profileOf(id: ProfileId): KitProfile {
  const found = PROFILES.find((item) => item.id === id);
  if (found === undefined) throw new Error(`no profile ${id}`);
  return found;
}

/** The result of a text under a profile: the document, its printed text and its round trip, or the issues. */
export type KitRead =
  | { readonly ok: true; readonly doc: Json; readonly printed: string | undefined; readonly printIssue: string | undefined; readonly roundTrip: boolean }
  | { readonly ok: false; readonly issues: readonly SyntaxIssue[] };

/**
 * This function reads a text with a profile, prints the document again, and reads the printed text, to check the
 * round trip.
 *
 * @param id - The profile.
 * @param text - The text.
 * @returns The document with its printed text, or the issues of the text.
 */
export function kitRead(id: ProfileId, text: string): KitRead {
  const { profile } = profileOf(id);
  const read = parse(profile, text);
  if (!read.ok) return { ok: false, issues: read.issues };
  const printed = print(profile, read.doc);
  if (!printed.ok) return { ok: true, doc: read.doc, printed: undefined, printIssue: printed.error.reason, roundTrip: false };
  const again = parse(profile, printed.value);
  return { ok: true, doc: read.doc, printed: printed.value, printIssue: undefined, roundTrip: again.ok && docEquals(again.doc, read.doc) };
}

/** A piece of a text: plain text, or the span of one or more issues. */
export interface TextPiece {
  readonly text: string;
  /** The numbers of the issues of this span, from 1. Empty for plain text. */
  readonly issues: readonly number[];
  /** `true` for a place between two characters, where an issue has no length. */
  readonly gap: boolean;
}

/**
 * This function cuts a text at the spans of its issues, so that a view can mark each span with the number of its
 * issue. An issue with no length gives a gap at its place. The pieces together give the text again.
 *
 * @param text - The text.
 * @param issues - The issues, with their offsets and their lengths.
 * @returns The pieces of the text, in order.
 */
export function textPieces(text: string, issues: readonly SyntaxIssue[]): readonly TextPiece[] {
  const spans = issues.map((issue, index) => {
    const start = Math.min(Math.max(issue.offset, 0), text.length);
    return { start, end: Math.min(start + Math.max(issue.length, 0), text.length), number: index + 1 };
  });
  const cuts = [...new Set([0, text.length, ...spans.flatMap((span) => [span.start, span.end])])].sort((a, b) => a - b);
  const pieces: TextPiece[] = [];
  for (let index = 0; index < cuts.length; index += 1) {
    const at = cuts[index] ?? 0;
    const gaps = spans.filter((span) => span.start === at && span.end === at).map((span) => span.number);
    if (gaps.length > 0) pieces.push({ text: "", issues: gaps, gap: true });
    const next = cuts[index + 1];
    if (next === undefined) break;
    const covers = spans.filter((span) => span.start <= at && span.end >= next && span.end > span.start).map((span) => span.number);
    pieces.push({ text: text.slice(at, next), issues: covers, gap: false });
  }
  return pieces;
}

/** One row of the tree of a document: its depth, the key in its parent, and its text. */
export interface TreeRow {
  readonly depth: number;
  /** The field name or the position in the parent, or `undefined` for the root. */
  readonly key: string | undefined;
  /** The type of a document with dots between the keys, or `undefined` for a literal. */
  readonly kind: string | undefined;
  /** The text of a literal or of the path of a reference. */
  readonly value: string | undefined;
  /** The header name of the document, for example `total`. */
  readonly name: string | undefined;
}

/** The type of a document as a text with dots, or `undefined` when the value is not a document. */
function kindOf(value: Json): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const type = (value as { readonly type?: Json }).type;
  if (typeof type === "string") return type;
  if (Array.isArray(type) && type.every((part) => typeof part === "string")) return type.join(".");
  return undefined;
}

/** The text of a literal. */
function literalText(value: Json): string {
  return typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value) ?? String(value);
}

/**
 * This function gives the rows of the tree of a document, from the root down, for an outline view. A reference gives
 * one row with its path. A list value gives a row for each item, and a record value gives a row for each field.
 *
 * @param doc - The document.
 * @returns The rows, in the order of a walk from the root.
 */
export function treeRows(doc: Json): readonly TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (value: Json, depth: number, key: string | undefined): void => {
    const kind = kindOf(value);
    if (kind === undefined) {
      if (value !== null && typeof value === "object") {
        rows.push({ depth, key, kind: undefined, value: Array.isArray(value) ? "list" : "record", name: undefined });
        for (const [childKey, child] of Object.entries(value)) walk(child, depth + 1, childKey);
        return;
      }
      rows.push({ depth, key, kind: undefined, value: literalText(value), name: undefined });
      return;
    }
    const record = value as { readonly value?: Json; readonly name?: Json };
    const name = typeof record.name === "string" ? record.name : undefined;
    const inner = record.value;
    if (kind === "ref" && Array.isArray(inner)) {
      rows.push({ depth, key, kind, value: inner.map((part) => String(part)).join("."), name });
      return;
    }
    if (inner === undefined || inner === null || typeof inner !== "object") {
      rows.push({ depth, key, kind, value: inner === undefined ? undefined : literalText(inner), name });
      return;
    }
    rows.push({ depth, key, kind, value: undefined, name });
    for (const [childKey, child] of Object.entries(inner)) walk(child, depth + 1, childKey);
  };
  walk(doc, 0, undefined);
  return rows;
}

/** The text of the place of an operator, for the table. */
export function fixityText(op: SyntaxOperator): string {
  if (op.fixity !== "infix") return op.fixity === "prefix" ? "before its term" : "after its term";
  const assoc = op.assoc ?? "left";
  if (assoc === "flat") return "between terms, one flat chain";
  if (assoc === "none") return "between two terms, no chain";
  return `between terms, groups to the ${assoc}`;
}

/** The kinds of the documents in a tree, so that the table can mark each operator that the text uses. */
export function usedKinds(rows: readonly TreeRow[]): ReadonlySet<string> {
  return new Set(rows.flatMap((row) => (row.kind === undefined ? [] : [row.kind])));
}
