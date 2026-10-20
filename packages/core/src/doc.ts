/** A JSON value. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** A JSON record. */
export type JsonRecord = { readonly [key: string]: Json };

/**
 * A typed document: an envelope with a header and a value. The header names the type of the value. The value is
 * not changed by the envelope at any time. Thus any JSON value can have a type: a number, a list, a text or a record.
 */
export type Envelope = {
  /** The name of the kind of the value. */
  readonly type: string;
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
 * This function tells if a value has the form of an envelope. That form is a record with a text `type` and a
 * `value`. It has no other keys than the keys of an envelope. A contract decides where an envelope is expected. This function only checks
 * the form.
 *
 * @param value - The value to examine.
 * @returns `true` when the value has the form of an envelope.
 */
export function isEnvelope(value: Json | undefined): value is JsonRecord & Envelope {
  if (!isRecord(value)) return false;
  if (typeof field(value, "type") !== "string" || !Object.hasOwn(value, "value")) return false;
  const name = field(value, "name");
  if (name !== undefined && typeof name !== "string") return false;
  const own = field(value, "own");
  if (own !== undefined && !isRecord(own)) return false;
  return Object.keys(value).every((key) => (ENVELOPE_KEYS as readonly string[]).includes(key));
}

/**
 * This function makes an envelope.
 *
 * @param type - The name of the kind.
 * @param value - The value.
 * @param header - The optional name and own entries.
 * @returns The envelope.
 */
export function typed(type: string, value: Json, header: { readonly name?: string; readonly own?: Record<string, string> } = {}): Envelope {
  return { type, value, ...(header.name === undefined ? {} : { name: header.name }), ...(header.own === undefined ? {} : { own: header.own }) };
}

/**
 * This function gives an envelope as a JSON record, for a store or for a view.
 *
 * @param doc - The envelope.
 * @returns The same envelope as JSON.
 */
export function toJson(doc: Envelope): JsonRecord {
  return {
    type: doc.type,
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
  return typed(String(field(value, "type")), field(value, "value") ?? null, {
    ...(typeof name === "string" ? { name } : {}),
    ...(isRecord(own) ? { own: ownEntries } : {}),
  });
}
