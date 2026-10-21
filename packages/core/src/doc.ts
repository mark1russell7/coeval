/** A JSON value. A document is JSON. */
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
 * This function tells if a value is a plain record: an object with the prototype of a plain object, or with no
 * prototype. A list, `null`, a date, a map and an instance of a class are not plain records.
 *
 * @param value - The value to examine.
 * @returns `true` for a plain record.
 */
export function isRecord(value: unknown): value is JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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
export function isKey(value: unknown): value is Key {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

/**
 * This function tells if a value is a reference to a type. The reference is a text, a list of keys, or a document
 * of type `ref` whose path starts at the root `world`.
 *
 * @param value - The value to examine.
 * @returns `true` for a reference to a type.
 */
export function isTypeRef(value: unknown): value is TypeRef {
  if (typeof value === "string") return value !== "";
  if (Array.isArray(value)) return value.length > 0 && (value as readonly unknown[]).every(isKey);
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
  if (typeof type === "string") return type;
  return typePath(type)?.join(".") ?? "(computed)";
}

function headerFits(value: JsonRecord): boolean {
  if (!isTypeRef(field(value, "type")) || !Object.hasOwn(value, "value")) return false;
  const name = field(value, "name");
  if (name !== undefined && typeof name !== "string") return false;
  const own = field(value, "own");
  return own === undefined || isRecord(own);
}

/**
 * This function tells if a value has the form of an envelope. That form is a record with a reference to a type
 * and a `value`. It has no other keys than the keys of an envelope. A contract decides where an envelope is
 * expected. This function only checks the form.
 *
 * @param value - The value to examine.
 * @returns `true` when the value has the form of an envelope.
 */
export function isEnvelope(value: unknown): value is JsonRecord & Envelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  // The keys come first: most values that are not envelopes have another key, thus the check stops early.
  for (const key in value) {
    if (key !== "type" && key !== "value" && key !== "name" && key !== "own" && Object.hasOwn(value, key)) return false;
  }
  return isRecord(value) && headerFits(value);
}

/** A stored document: an envelope, and the keys of its store beside it, for example `_id`. */
export interface Stored {
  readonly envelope: Envelope;
  /** The keys of the store, with their values. */
  readonly header: Readonly<Record<string, Json>>;
}

/**
 * This function reads a stored document: an envelope that also has the keys of a store, for example `{ _id, type,
 * value }`. Only the keys in the list can be beside the keys of the envelope.
 *
 * @param value - The value to examine.
 * @param header - The keys of the store that the document can have.
 * @returns The envelope and the keys of the store, or `undefined` when the value has another form.
 */
export function stored(value: unknown, header: readonly string[]): Stored | undefined {
  if (!isRecord(value) || !headerFits(value)) return undefined;
  const keys: Record<string, Json> = {};
  const own: Record<string, Json> = {};
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if ((ENVELOPE_KEYS as readonly string[]).includes(key)) own[key] = value[key] as Json;
    else if (header.includes(key)) keys[key] = value[key] as Json;
    else return undefined;
  }
  return { envelope: fromJson(own) as Envelope, header: keys };
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
export function fromJson(value: unknown): Envelope | undefined {
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

/**
 * This function tells if two JSON values are equal. Equal values have the same texts, numbers and truth values,
 * the same items in the same order, and the same fields. The order of the fields does not matter. It does not use the stack for the
 * depth, thus a deep document cannot overflow it.
 *
 * @param a - The first value.
 * @param b - The second value.
 * @returns `true` when the values are equal.
 */
export function docEquals(a: unknown, b: unknown): boolean {
  const stack: [unknown, unknown][] = [[a, b]];
  while (stack.length > 0) {
    const [x, y] = stack.pop() as [unknown, unknown];
    if (Object.is(x, y)) continue;
    if (typeof x !== "object" || typeof y !== "object" || x === null || y === null) return false;
    if (Array.isArray(x) !== Array.isArray(y)) return false;
    if (Array.isArray(x)) {
      const ys = y as readonly unknown[];
      if (x.length !== ys.length) return false;
      for (let index = 0; index < x.length; index += 1) stack.push([x[index], ys[index]]);
      continue;
    }
    const xr = x as Readonly<Record<string, unknown>>;
    const yr = y as Readonly<Record<string, unknown>>;
    const keys = Object.keys(xr);
    if (keys.length !== Object.keys(yr).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(yr, key)) return false;
      stack.push([xr[key], yr[key]]);
    }
  }
  return true;
}
