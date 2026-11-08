import { typeCheck, typeText, type Json, type Machine } from "@mark1russell7/coeval";
import { pathKey } from "../glyphs/overlay.ts";

/** One `#TYPE!` issue of a document, at the path of its card. */
export interface TypeMark {
  readonly path: readonly string[];
  readonly reason: string;
}

/** What a check of types tells about the cards of a picture. */
export interface PlaceTypes {
  /** The text of the type of each card, by the key of its path. */
  readonly types: ReadonlyMap<string, string>;
  /** Each `#TYPE!` issue, in the order of the document. */
  readonly issues: readonly TypeMark[];
  /** The keys of the paths of the cards with an issue. */
  readonly marked: ReadonlySet<string>;
}

/**
 * This function checks the types of a document for the cards of a picture.
 *
 * @param machine - The world and the code of the evaluators, with their type rules.
 * @param doc - The document.
 * @param names - The names of the context.
 * @returns The type of each card, and each `#TYPE!` issue.
 */
export function placeTypes(machine: Machine, doc: Json, names: Readonly<Record<string, unknown>>): PlaceTypes {
  const typing = typeCheck(machine, doc, { names: Object.keys(names) });
  const types = new Map(typing.places.map((item) => [pathKey(item.place.map(String)), typeText(item.type)]));
  const issues = typing.issues.filter((item) => item.code === "#TYPE!").map((item) => ({ path: item.place.map(String), reason: item.reason }));
  return { types, issues, marked: new Set(issues.map((item) => pathKey(item.path))) };
}
