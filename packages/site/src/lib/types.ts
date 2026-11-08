import { typeCheck, typeText, type Json, type Machine } from "@mark1russell7/coeval";
import { pathKey } from "../glyphs/overlay.ts";

/** The codes of the issues of the check that the cards show: a wrong type, and a wrong value of a declared kind (D185). */
export const CHECK_CODES: readonly string[] = ["#TYPE!", "#VALUE!"];

/** One issue of the check of a document, at the path of its card. */
export interface TypeMark {
  readonly path: readonly string[];
  /** The code of the issue: `#TYPE!` or `#VALUE!`. */
  readonly code: string;
  readonly reason: string;
}

/** What a check of types tells about the cards of a picture. */
export interface PlaceTypes {
  /** The text of the type of each card, by the key of its path. */
  readonly types: ReadonlyMap<string, string>;
  /** Each `#TYPE!` and `#VALUE!` issue of the check, in the order of the document. */
  readonly issues: readonly TypeMark[];
  /** The code of the first issue of each card with an issue, by the key of its path. */
  readonly marked: ReadonlyMap<string, string>;
}

/**
 * This function checks the types of a document for the cards of a picture. A bare value at a place of a declared kind
 * is a value of that kind. A wrong bare value thus gives `#VALUE!`, not `#TYPE!` (K243, D185).
 *
 * @param machine - The world and the code of the evaluators, with their type rules.
 * @param doc - The document.
 * @param names - The names of the context.
 * @returns The type of each card, and each `#TYPE!` and `#VALUE!` issue.
 */
export function placeTypes(machine: Machine, doc: Json, names: Readonly<Record<string, unknown>>): PlaceTypes {
  const typing = typeCheck(machine, doc, { names: Object.keys(names) });
  const types = new Map(typing.places.map((item) => [pathKey(item.place.map(String)), typeText(item.type)]));
  const issues = typing.issues.filter((item) => CHECK_CODES.includes(item.code)).map((item) => ({ path: item.place.map(String), code: item.code, reason: item.reason }));
  const marked = new Map<string, string>();
  for (const item of issues) if (!marked.has(pathKey(item.path))) marked.set(pathKey(item.path), item.code);
  return { types, issues, marked };
}
