/** A JSON value. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** A document is a JSON record. Its key `$kind` names its kind. */
export type Doc = { readonly [key: string]: Json };

/** The key that names the kind of a document. */
export const KIND_KEY = "$kind";

/** The key that holds the own entries of a document: one evaluator name for each verb. */
export const OWN_KEY = "$own";

/**
 * This function tells if a value is a JSON record (not an array and not null).
 *
 * @param value - The value to examine.
 * @returns `true` for a record.
 */
export function isRecord(value: Json | undefined): value is { readonly [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * This function reads a field of a record. It reads only the own fields, thus `constructor` is not a field.
 *
 * @param record - The record.
 * @param key - The name of the field.
 * @returns The value of the field, or `undefined` when the record has no such field.
 */
export function field(record: { readonly [key: string]: Json }, key: string): Json | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * This function gives the kind that a document names.
 *
 * @param doc - The document.
 * @returns The name of the kind, or `undefined` when the document names no kind.
 */
export function kindOf(doc: Doc): string | undefined {
  const value = field(doc, KIND_KEY);
  return typeof value === "string" ? value : undefined;
}

/**
 * This function gives the own entry of a document for a verb.
 *
 * @param doc - The document.
 * @param verb - The verb of the question.
 * @returns The name of the evaluator, or `undefined` when the document has no own entry for the verb.
 */
export function ownEntry(doc: Doc, verb: string): string | undefined {
  const own = field(doc, OWN_KEY);
  if (!isRecord(own)) return undefined;
  const entry = field(own, verb);
  return typeof entry === "string" ? entry : undefined;
}
