import { type Json, type Key, docEquals, isRecord } from "./doc.ts";
import { type TypeIssue, type ValueType, isUnknown, join, member } from "./types.ts";

/*
 * Type providers (R5 P4, D28). A provider makes a value type from data that a host already has: a JSON Schema or
 * sample values. A host gives such a type to a root of a check, for example the schema of a store for `world`.
 */

/** The type that a provider reads, and the problems of the reading. Each problem tells what the type does not test. */
export interface TypeReading {
  readonly type: ValueType;
  readonly issues: readonly TypeIssue[];
}

/** The deepest schema that `typeFromSchema` reads. A deeper schema reads as `unknown`. */
const MAX_SCHEMA_DEPTH = 256;

/** The keywords that describe a schema and do not test a value. The reading ignores them without an issue. */
const NOTES: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "$schema",
  "$id",
  "$anchor",
  "$comment",
  "$defs",
  "definitions",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
]);

/** The keywords that the reading reads. Each other keyword gives an issue and tests nothing. */
const READ: ReadonlySet<string> = /* @__PURE__ */ new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "anyOf", "oneOf"]);

/**
 * The keywords that can permit more values than the other keywords permit. Older drafts ignore each keyword beside
 * `$ref`, and `nullable` of OpenAPI 3.0 permits `null`. Thus a schema with one of them reads as `unknown`.
 */
const WIDENING: ReadonlySet<string> = /* @__PURE__ */ new Set(["$ref", "$dynamicRef", "$recursiveRef", "nullable"]);

/** The base type of each name of the keyword `type`. */
const BASES: Readonly<Record<string, ValueType>> = { null: "null", boolean: "bool", number: "number", integer: "number", string: "text" };

/** This function sets an own field of a new record. Only the key `__proto__` needs `defineProperty`. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === "__proto__") Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

/** The union of types: the join of each type, or `never` for no type. */
function unionOf(types: readonly ValueType[]): ValueType {
  return types.reduce<ValueType>((all, type) => join(all, type), "never");
}

/** The state of one reading of a schema: the issues that it found. */
class SchemaReader {
  readonly issues: TypeIssue[] = [];

  issue(at: readonly Key[], reason: string): void {
    this.issues.push({ at, reason });
  }

  /** This method reads one schema. */
  read(schema: unknown, at: readonly Key[], depth: number): ValueType {
    if (depth > MAX_SCHEMA_DEPTH) {
      this.issue(at, `The schema is deeper than ${MAX_SCHEMA_DEPTH} levels. The type reads it as unknown.`);
      return "unknown";
    }
    if (schema === true) return "unknown";
    if (schema === false) return "never";
    if (!isRecord(schema)) {
      this.issue(at, "A schema is a record or a truth value. The type reads this value as unknown.");
      return "unknown";
    }
    let widens = false;
    for (const key of Object.keys(schema)) {
      if (READ.has(key) || NOTES.has(key)) continue;
      if (WIDENING.has(key)) {
        this.issue([...at, key], `The type does not read the keyword ${key}. Thus it reads the schema as unknown.`);
        widens = true;
      } else {
        this.issue([...at, key], `The type does not read the keyword ${key}. It does not test what the keyword tests.`);
      }
    }
    if (widens) return "unknown";
    // A schema is the conjunction of its keywords. The reading keeps one of them, and each one alone holds each value.
    const sides: { readonly key: string; readonly type: ValueType }[] = [];
    if (Object.hasOwn(schema, "type")) sides.push({ key: "type", type: this.byType(schema, at, depth) });
    else if (["properties", "required", "additionalProperties", "items"].some((key) => Object.hasOwn(schema, key)) && !["enum", "const", "anyOf", "oneOf"].some((key) => Object.hasOwn(schema, key))) {
      this.issue(at, "The schema has no keyword type. Thus a value of each JSON type fits it, and the type reads it as unknown.");
    }
    for (const key of ["anyOf", "oneOf"]) {
      if (!Object.hasOwn(schema, key)) continue;
      const items = schema[key];
      if (!Array.isArray(items)) {
        this.issue([...at, key], `The value of ${key} is a list of schemas.`);
        continue;
      }
      // A union holds each value of oneOf too. It does not test that only one schema fits.
      sides.push({ key, type: unionOf(items.map((item, index) => this.read(item, [...at, key, index], depth + 1))) });
    }
    // A finite set of values meets each other keyword exactly: the type keeps each value that each side holds.
    const values = this.values(schema, at);
    if (values !== undefined) return { one: values.filter((value) => sides.every((side) => member(value, side.type))) };
    const known = sides.filter((side) => !isUnknown(side.type, undefined));
    const kept = known[0];
    if (kept === undefined) return "unknown";
    for (const side of known.slice(1)) this.issue([...at, side.key], `The type reads the keyword ${kept.key}, and not the keyword ${side.key}.`);
    return kept.type;
  }

  /** This method reads `enum` and `const`: the values that the schema permits, or `undefined` without them. */
  values(schema: Readonly<Record<string, unknown>>, at: readonly Key[]): Json[] | undefined {
    let values: Json[] | undefined;
    if (Object.hasOwn(schema, "enum")) {
      if (Array.isArray(schema["enum"])) values = [...(schema["enum"] as Json[])];
      else this.issue([...at, "enum"], "The value of enum is a list of JSON values.");
    }
    if (Object.hasOwn(schema, "const")) {
      const one = schema["const"] as Json;
      values = values === undefined ? [one] : values.filter((value) => docEquals(value, one));
    }
    return values;
  }

  /** This method reads the keyword `type` with the keywords of an object and of an array. */
  byType(schema: Readonly<Record<string, unknown>>, at: readonly Key[], depth: number): ValueType {
    const raw = schema["type"];
    const names = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : undefined;
    if (names === undefined) {
      this.issue([...at, "type"], "The value of type is a text or a list of texts.");
      return "unknown";
    }
    const types: ValueType[] = [];
    for (const [index, name] of names.entries()) {
      const where = typeof raw === "string" ? [...at, "type"] : [...at, "type", index];
      if (name === "object") types.push(this.object(schema, at, depth));
      else if (name === "array") types.push(this.array(schema, at, depth));
      else if (typeof name === "string" && Object.hasOwn(BASES, name)) {
        if (name === "integer") this.issue(where, "The type reads integer as number. It does not test that the number is whole.");
        types.push(BASES[name] as ValueType);
      } else {
        this.issue(where, `The type ${String(name)} is not a type of JSON Schema. The type reads it as unknown.`);
        return "unknown";
      }
    }
    return unionOf(types);
  }

  /** This method reads an object: its properties, the properties that it needs and the other properties. */
  object(schema: Readonly<Record<string, unknown>>, at: readonly Key[], depth: number): ValueType {
    const fields: Record<string, ValueType> = {};
    const properties = schema["properties"] ?? {};
    if (isRecord(properties)) {
      for (const key of Object.keys(properties)) setOwn(fields, key, this.read(properties[key], [...at, "properties", key], depth + 1));
    } else {
      this.issue([...at, "properties"], "The value of properties is a record of schemas.");
    }
    const required = schema["required"] ?? [];
    const needed = Array.isArray(required) ? required.filter((key): key is string => typeof key === "string") : [];
    if (!Array.isArray(required) || needed.length !== required.length) this.issue([...at, "required"], "The value of required is a list of texts.");
    // A property that `required` names without a schema can hold each value.
    for (const key of needed) if (!Object.hasOwn(fields, key)) setOwn(fields, key, "unknown");
    const optional = Object.keys(fields).filter((key) => !needed.includes(key));
    const other = schema["additionalProperties"];
    // Each property that a pattern names is permitted too, thus the record is closed only without patterns.
    let closed = other === false && !Object.hasOwn(schema, "patternProperties");
    if (other !== undefined && other !== true && other !== false) {
      this.issue([...at, "additionalProperties"], "The type reads additionalProperties with a schema as an open record. The other fields can hold each value.");
      closed = false;
    }
    return { record: fields, ...(optional.length === 0 ? {} : { optional }), ...(closed ? { closed: true } : {}) };
  }

  /** This method reads an array: the schema of its items. */
  array(schema: Readonly<Record<string, unknown>>, at: readonly Key[], depth: number): ValueType {
    const items = schema["items"];
    if (items === undefined) return { list: "unknown" };
    // With prefixItems, the keyword items covers only the items after the prefix.
    if (Object.hasOwn(schema, "prefixItems") || Array.isArray(items)) {
      this.issue([...at, "items"], "The type does not read the items of a tuple. It reads a list of unknown items.");
      return { list: "unknown" };
    }
    return { list: this.read(items, [...at, "items"], depth + 1) };
  }
}

/**
 * This function makes a value type from a JSON Schema (TYPE.SCHEMA). A host uses it for the type of a root, for
 * example the schema of a store for `world`. It reads this subset:
 *
 * - `type`: `null`, `boolean`, `number`, `integer` (as `number`), `string`, `object` and `array`, or a list of them.
 * - `properties`, `required` and `additionalProperties` give a record. `false` closes it, and a property that is not
 *   in `required` is optional.
 * - `items` gives a list. `enum` and `const` give `one`. `anyOf` and `oneOf` give a union.
 *
 * The type holds each value that the schema accepts. Each keyword that the function does not read tests nothing, as
 * `unknown`, and the issues name it. Examples are `minimum`, `pattern` and `allOf`. A schema with `$ref` or `nullable`
 * reads as `unknown`, because these keywords can permit more values. A schema with more than one of `type`, `anyOf`
 * and `oneOf` gives the type of the first, and an issue for each other. The function does not throw.
 *
 * @param schema - The schema, as JSON.
 * @returns The type, and the problems of the reading with their keys in the schema.
 */
export function typeFromSchema(schema: unknown): TypeReading {
  const reader = new SchemaReader();
  try {
    return { type: reader.read(schema, [], 0), issues: reader.issues };
  } catch (error) {
    // A getter of a host value can throw. The reading then gives the top.
    reader.issue([], `The schema cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    return { type: "unknown", issues: reader.issues };
  }
}

/** The options of `typeFromSamples`. */
export interface SampleOptions {
  /** `true`: the samples show each field, thus each record type is closed. The default is `false`. */
  readonly closed?: boolean;
}

/** The deepest sample that `typeFromSamples` reads. A deeper value gives `unknown`. */
const MAX_SAMPLE_DEPTH = 256;

/** This function gives the type of a group of sample values at one depth. */
function samplesAt(values: readonly unknown[], closed: boolean, depth: number): ValueType {
  if (depth > MAX_SAMPLE_DEPTH) return values.length === 0 ? "never" : "unknown";
  const types: ValueType[] = [];
  const bases = new Set<string>();
  const items: unknown[] = [];
  const records: Readonly<Record<string, unknown>>[] = [];
  let lists = false;
  for (const value of values) {
    if (value === null) bases.add("null");
    else if (value === undefined) bases.add("undefined");
    else if (typeof value === "boolean") bases.add("bool");
    else if (typeof value === "number") bases.add("number");
    else if (typeof value === "string") bases.add("text");
    else if (Array.isArray(value)) {
      lists = true;
      // A hole of a list holds undefined, thus a loop by index reads it too.
      for (let index = 0; index < value.length; index += 1) items.push(value[index]);
    } else if (isRecord(value)) records.push(value);
    // A value without a type of the kernel, for example a function, has each type.
    else return "unknown";
  }
  for (const base of ["null", "undefined", "bool", "number", "text"]) if (bases.has(base)) types.push(base);
  if (lists) types.push({ list: samplesAt(items, closed, depth + 1) });
  if (records.length > 0) {
    // All records join into one record. A field that a record does not have is optional.
    const keys: string[] = [];
    for (const record of records) for (const key of Object.keys(record)) if (!keys.includes(key)) keys.push(key);
    const fields: Record<string, ValueType> = {};
    const optional: string[] = [];
    for (const key of keys) {
      const found = records.filter((record) => Object.hasOwn(record, key));
      if (found.length < records.length) optional.push(key);
      setOwn(fields, key, samplesAt(found.map((record) => record[key]), closed, depth + 1));
    }
    types.push({ record: fields, ...(optional.length === 0 ? {} : { optional }), ...(closed ? { closed: true } : {}) });
  }
  return types.length === 1 ? (types[0] as ValueType) : unionOf(types);
}

/**
 * This function infers a value type from sample values (TYPE.SAMPLES), as a type provider of F# does. A host uses it
 * for the type of a root, for example from some events.
 *
 * - `null`, `undefined`, a truth value, a number and a text give their base types, not their values.
 * - The items of each list join into one type of items.
 * - All records join into one record with each key of the samples. A key that a record does not have is optional.
 * - Values of different forms give a union, as `join` gives. No samples give `never`.
 * - A value without a type of the kernel, for example a function, gives `unknown`.
 *
 * Each sample is a member of the type. A record is open, because samples do not show that a field cannot exist. With
 * `closed: true`, each record is closed, and a reference to a field that no sample has gives `#TYPE!`.
 *
 * @param values - The sample values.
 * @param options - `closed: true` closes each record type.
 * @returns The type.
 */
export function typeFromSamples(values: readonly unknown[], options: SampleOptions = {}): ValueType {
  return samplesAt(values, options.closed === true, 0);
}
