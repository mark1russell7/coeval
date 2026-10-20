/** A JSON value. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** A JSON record. */
export type JsonRecord = { readonly [key: string]: Json };

/** One step of a path that is a plain key: a name, or an index of a list. */
export type Key = string | number;

/**
 * The type of a document is a reference into the world (the registry of kinds).
 *
 * - A text is a base reference with one key: `"add"`.
 * - A list of keys is a base reference with a path: `["git", "push"]`.
 * - A document of type `ref` is the same reference, expanded. Its path starts at the root `world`.
 *
 * The kernel resolves a base reference itself. The expanded form is necessary only to attach more to the
 * reference. Thus the chain of types stops at a base reference.
 */
export type TypeRef = string | readonly Key[] | { readonly type: "ref"; readonly value: readonly Json[] };

/**
 * A typed document: an envelope with a header and a value. The header names the type of the value. The value is
 * not changed by the envelope at any time. Thus any JSON value can have a type: a number, a list, a text or a record.
 */
export type Envelope = {
  /** The type: a reference to a kind of the world. */
  readonly type: TypeRef;
  /** The value. */
  readonly value: Json;
  /** The name of a binding. A sequence gives the result of this document to the later steps under this name. */
  readonly name?: string;
  /** The own entries: one evaluator name for each verb. An own entry changes only this document. */
  readonly own?: Readonly<Record<string, string>>;
};

/** The keys that an envelope can have. */
export const ENVELOPE_KEYS = ["type", "value", "name", "own"] as const;

/**
 * This function tells if a value is a JSON record (not an array and not null).
 *
 * @param value - The value to examine.
 * @returns `true` for a record.
 */
export function isRecord(value: Json | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * This function reads a field of a record. It reads only the own fields, thus `constructor` is not a field.
 *
 * @param record - The record.
 * @param key - The name of the field.
 * @returns The value of the field, or `undefined` when the record has no such field.
 */
export function field(record: JsonRecord, key: string): Json | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * This function tells if a value is a key of a path: a text, or a whole number from 0.
 *
 * @param value - The value to examine.
 * @returns `true` for a key.
 */
export function isKey(value: Json | undefined): value is Key {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

/**
 * This function tells if a value is a reference to a type. The reference is a text, a list of keys, or a document
 * of type `ref` whose path starts at the root `world`.
 *
 * @param value - The value to examine.
 * @returns `true` for a reference to a type.
 */
export function isTypeRef(value: Json | undefined): boolean {
  if (typeof value === "string") return value !== "";
  if (Array.isArray(value)) return value.length > 0 && (value as readonly Json[]).every(isKey);
  if (!isRecord(value)) return false;
  const path = field(value, "value");
  return field(value, "type") === "ref" && Array.isArray(path) && (path as readonly Json[])[0] === "world";
}

/**
 * This function gives the path of a reference to a type, from the root of the world.
 *
 * @param type - The reference.
 * @returns The keys from the root of the world, or `undefined` for a computed step that has no fixed key.
 */
export function typePath(type: TypeRef): readonly Key[] | undefined {
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type as readonly Key[];
  const steps = (type as { readonly value: readonly Json[] }).value.slice(1);
  return steps.every(isKey) ? (steps as readonly Key[]) : undefined;
}

/**
 * This function gives the text of a type for a reader: its keys, joined with a dot.
 *
 * @param type - The reference to the type.
 * @returns The text, for example `git.push`.
 */
export function typeName(type: TypeRef): string {
  return typePath(type)?.join(".") ?? "(computed)";
}

/**
 * This function tells if a value has the form of an envelope. That form is a record with a reference to a type
 * and a `value`. It has no other keys than the keys of an envelope. A contract decides where an envelope is
 * expected. This function only checks the form.
 *
 * @param value - The value to examine.
 * @returns `true` when the value has the form of an envelope.
 */
export function isEnvelope(value: Json | undefined): value is JsonRecord & Envelope {
  if (!isRecord(value)) return false;
  if (!isTypeRef(field(value, "type")) || !Object.hasOwn(value, "value")) return false;
  const name = field(value, "name");
  if (name !== undefined && typeof name !== "string") return false;
  const own = field(value, "own");
  if (own !== undefined && !isRecord(own)) return false;
  return Object.keys(value).every((key) => (ENVELOPE_KEYS as readonly string[]).includes(key));
}

/**
 * This function makes an envelope.
 *
 * @param type - The reference to the kind.
 * @param value - The value.
 * @param header - The optional name and own entries.
 * @returns The envelope.
 */
export function typed(type: TypeRef, value: Json, header: { readonly name?: string; readonly own?: Record<string, string> } = {}): Envelope {
  return { type, value, ...(header.name === undefined ? {} : { name: header.name }), ...(header.own === undefined ? {} : { own: header.own }) };
}

/**
 * This function makes a reference document: a path from a root of the context.
 *
 * @param path - The steps. The first step is a root: `self`, `names`, `world`, `event` or `caps`.
 * @returns The document of type `ref`.
 */
export function ref(...path: readonly Json[]): Envelope {
  return typed("ref", path);
}

/**
 * This function gives an envelope as a JSON record, for a store or for a view.
 *
 * @param doc - The envelope.
 * @returns The same envelope as JSON.
 */
export function toJson(doc: Envelope): JsonRecord {
  return {
    type: doc.type as Json,
    value: doc.value,
    ...(doc.name === undefined ? {} : { name: doc.name }),
    ...(doc.own === undefined ? {} : { own: doc.own }),
  };
}

/**
 * This function reads an envelope from JSON. A value without the form of an envelope gives `undefined`.
 *
 * @param value - The JSON value.
 * @returns The envelope, or `undefined`.
 */
export function fromJson(value: Json | undefined): Envelope | undefined {
  if (!isEnvelope(value)) return undefined;
  const own = field(value, "own");
  const ownEntries: Record<string, string> = {};
  if (isRecord(own)) {
    for (const [verb, name] of Object.entries(own)) if (typeof name === "string") ownEntries[verb] = name;
  }
  const name = field(value, "name");
  return typed(field(value, "type") as TypeRef, field(value, "value") ?? null, {
    ...(typeof name === "string" ? { name } : {}),
    ...(isRecord(own) ? { own: ownEntries } : {}),
  });
}
