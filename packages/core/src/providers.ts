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
const READ: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "allOf",
  "$ref",
]);

/**
 * The keywords that can permit more values than the other keywords permit. A dynamic reference can reach a schema
 * outside this schema, and `nullable` of OpenAPI 3.0 permits `null`. Thus a schema with one of them reads as `unknown`.
 */
const WIDENING: ReadonlySet<string> = /* @__PURE__ */ new Set(["$dynamicRef", "$recursiveRef", "nullable"]);

/** The keywords of an object without the keyword `type`. They test only the values that are records. */
const OBJECT_KEYS: readonly string[] = ["properties", "required", "additionalProperties"];

/** The form of a local reference: a definition in `$defs` or `definitions` of the root schema. */
const LOCAL_REF = /^#\/(\$defs|definitions)\/([^/]*)$/;

/** The most pairs of members that the meet of two unions builds. A larger meet keeps the first type, which is sound. */
const MAX_MEET_PAIRS = 64;

/** The keywords of one JSON type without the keyword `type`: they test only the records or only the lists. */
interface Condition {
  readonly on: "record" | "list";
  readonly type: ValueType;
  readonly at: readonly Key[];
}

/** A record type of the reading. */
type RecordType = Extract<ValueType, { readonly record: unknown }>;

/** This function tells if a field of a record type can be absent. */
function isOptional(type: RecordType, key: string): boolean {
  return type.optional?.includes(key) === true;
}

/**
 * This function gives the meet of two types of a reading: a type that holds each value of both types. A schema is
 * the conjunction of its keywords, thus its type is the meet of their types. The meet is exact for the forms that a
 * reading makes: base types, lists, records, unions and `one`. A meet of two different forms is `never`.
 */
function meet(a: ValueType, b: ValueType, depth: number): ValueType {
  if (depth > MAX_SCHEMA_DEPTH) return a;
  if (isUnknown(a, undefined)) return b;
  if (isUnknown(b, undefined)) return a;
  if (a === "never" || b === "never") return "never";
  if (typeof a !== "string" && "one" in a) return { one: a.one.filter((value) => member(value, b)) };
  if (typeof b !== "string" && "one" in b) return { one: b.one.filter((value) => member(value, a)) };
  if (typeof b !== "string" && "union" in b && !(typeof a !== "string" && "union" in a)) return meet(b, a, depth);
  if (typeof a !== "string" && "union" in a) {
    const others = typeof b !== "string" && "union" in b ? b.union : [b];
    if (a.union.length * others.length > MAX_MEET_PAIRS) return a;
    return unionOf(a.union.flatMap((item) => others.map((other) => meet(item, other, depth + 1))));
  }
  if (typeof a === "string" || typeof b === "string") return a === b ? a : "never";
  if ("list" in a && "list" in b) return { list: meet(a.list, b.list, depth + 1) };
  if ("record" in a && "record" in b) return meetRecords(a, b, depth + 1);
  // A list and a record have no common value. Each other pair keeps the first type, which is sound.
  return ("list" in a || "record" in a) && ("list" in b || "record" in b) ? "never" : a;
}

/**
 * This function gives the meet of two record types. A field of both records gets the meet of its types, and it is
 * optional only when both records permit its absence. A closed record has no other field, thus a field of only the
 * other record is absent. When the other record needs that field, no value fits both records.
 */
function meetRecords(a: RecordType, b: RecordType, depth: number): ValueType {
  const fields: Record<string, ValueType> = {};
  const optional: string[] = [];
  const keys = [...Object.keys(a.record), ...Object.keys(b.record).filter((key) => !Object.hasOwn(a.record, key))];
  for (const key of keys) {
    const inA = Object.hasOwn(a.record, key);
    const inB = Object.hasOwn(b.record, key);
    if ((!inA && a.closed === true) || (!inB && b.closed === true)) {
      if ((inA && !isOptional(a, key)) || (inB && !isOptional(b, key))) return "never";
      continue;
    }
    const type = inA && inB ? meet(a.record[key] as ValueType, b.record[key] as ValueType, depth) : ((inA ? a.record[key] : b.record[key]) as ValueType);
    setOwn(fields, key, type);
    if ((!inA || isOptional(a, key)) && (!inB || isOptional(b, key))) optional.push(key);
  }
  const closed = a.closed === true || b.closed === true;
  return { record: fields, ...(optional.length === 0 ? {} : { optional }), ...(closed ? { closed: true } : {}) };
}

/** This function applies a condition to a type: each member of the JSON type of the condition meets its type. */
function narrow(type: ValueType, condition: Condition): ValueType {
  if (typeof type === "string") return type;
  if ("union" in type) return unionOf(type.union.map((item) => narrow(item, condition)));
  if ("one" in type) return { one: type.one.filter((value) => !(condition.on === "list" ? Array.isArray(value) : isRecord(value)) || member(value, condition.type)) };
  return condition.on in type ? meet(type, condition.type, 0) : type;
}

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

/** The state of one reading of a schema: the root, the issues and the definitions that it read. */
class SchemaReader {
  readonly issues: TypeIssue[] = [];
  /** The type of each definition that a reference reached. Each reading of a definition is sound, thus the first stays. */
  readonly defs = new Map<string, ValueType>();
  /** The definitions that the reading has not finished. A reference to one of them is a cycle. */
  readonly open = new Set<string>();
  /** The number of schemas with an own `$id` around the current schema. A reference inside them has another base. */
  inner = 0;

  constructor(readonly root: unknown) {}

  issue(at: readonly Key[], reason: string): void {
    this.issues.push({ at, reason });
  }

  /** This method reads one schema: the meet of the types of its keywords, then its conditions. */
  read(schema: unknown, at: readonly Key[], depth: number): ValueType {
    const types: ValueType[] = [];
    const conditions: Condition[] = [];
    this.parts(schema, at, depth, types, conditions);
    let type = types.reduce<ValueType>((all, item) => meet(all, item, 0), "unknown");
    for (const condition of conditions) {
      if (isUnknown(type, undefined)) {
        this.issue(condition.at, "The schema has no keyword type. Thus a value of each JSON type fits it, and the type reads it as unknown.");
        break;
      }
      type = narrow(type, condition);
    }
    return type;
  }

  /**
   * This method adds the type of each keyword of a schema to `types`, and its conditions to `conditions`. Each type
   * holds each value that the schema accepts. The parts of `allOf` add their keywords too.
   */
  parts(schema: unknown, at: readonly Key[], depth: number, types: ValueType[], conditions: Condition[]): void {
    if (depth > MAX_SCHEMA_DEPTH) {
      this.issue(at, `The schema is deeper than ${MAX_SCHEMA_DEPTH} levels. The type reads it as unknown.`);
      return;
    }
    if (schema === true) return;
    if (schema === false) {
      types.push("never");
      return;
    }
    if (!isRecord(schema)) {
      this.issue(at, "A schema is a record or a truth value. The type reads this value as unknown.");
      return;
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
    if (widens) return;
    const nested = schema !== this.root && Object.hasOwn(schema, "$id");
    if (nested) this.inner += 1;
    try {
      this.keywords(schema, at, depth, types, conditions);
    } finally {
      if (nested) this.inner -= 1;
    }
  }

  /** This method reads the keywords of a schema that does not permit more values (WIDENING). */
  keywords(schema: Readonly<Record<string, unknown>>, at: readonly Key[], depth: number, types: ValueType[], conditions: Condition[]): void {
    if (Object.hasOwn(schema, "$ref")) {
      // Older drafts ignore each keyword beside $ref. The target alone holds each value in each draft.
      for (const key of Object.keys(schema)) if (READ.has(key) && key !== "$ref") this.issue([...at, key], `The type reads only the target of $ref. It does not test the keyword ${key} beside it.`);
      const type = this.target(schema["$ref"], [...at, "$ref"], depth);
      if (type !== undefined) types.push(type);
      return;
    }
    if (Object.hasOwn(schema, "type")) types.push(this.byType(schema, at, depth));
    else {
      if (OBJECT_KEYS.some((key) => Object.hasOwn(schema, key))) conditions.push({ on: "record", type: this.object(schema, at, depth), at });
      if (Object.hasOwn(schema, "items")) conditions.push({ on: "list", type: this.array(schema, at, depth), at });
    }
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      if (!Object.hasOwn(schema, key)) continue;
      const items = schema[key];
      if (!Array.isArray(items)) {
        this.issue([...at, key], `The value of ${key} is a list of schemas.`);
        continue;
      }
      // Each part of allOf holds each value of the schema, thus its keywords join the keywords of the schema.
      if (key === "allOf") for (const [index, item] of items.entries()) this.parts(item, [...at, key, index], depth + 1, types, conditions);
      // A union holds each value of oneOf too. It does not test that only one schema fits.
      else types.push(unionOf(items.map((item, index) => this.read(item, [...at, key, index], depth + 1))));
    }
    const values = this.values(schema, at);
    if (values !== undefined) types.push({ one: values });
  }

  /** This method reads the target of a reference: a definition of the root schema, or `undefined` for each value. */
  target(ref: unknown, at: readonly Key[], depth: number): ValueType | undefined {
    const match = typeof ref === "string" ? LOCAL_REF.exec(ref) : null;
    let name: string | undefined;
    try {
      // The name is a step of a JSON Pointer in a URI fragment.
      name = match === null ? undefined : decodeURIComponent(match[2] ?? "").replace(/~1/g, "/").replace(/~0/g, "~");
    } catch {
      name = undefined;
    }
    if (match === null || name === undefined) {
      this.issue(at, "The type reads only a $ref to #/$defs/<name> or #/definitions/<name> of the same schema. Thus it reads the schema as unknown.");
      return undefined;
    }
    if (this.inner > 0) {
      this.issue(at, "A $ref inside a schema with its own $id has another base. Thus the type reads the schema as unknown.");
      return undefined;
    }
    const group = match[1] as string;
    const defs = isRecord(this.root) ? this.root[group] : undefined;
    if (!isRecord(defs) || !Object.hasOwn(defs, name)) {
      this.issue(at, `The schema has no definition ${String(ref)}. Thus the type reads the reference as unknown.`);
      return undefined;
    }
    const key = `${group}/${name}`;
    const known = this.defs.get(key);
    if (known !== undefined) return known;
    if (this.open.has(key)) {
      this.issue(at, `The reference ${String(ref)} is in a cycle. The type reads this reference as unknown.`);
      return undefined;
    }
    this.open.add(key);
    try {
      const type = this.read(defs[name], [group, name], depth + 1);
      this.defs.set(key, type);
      return type;
    } finally {
      this.open.delete(key);
    }
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
 * - `$ref` reads a definition in `$defs` or `definitions` of the same schema (TYPE.SCHEMA-REF). Another reference, a
 *   missing definition and a reference in a cycle read as `unknown`.
 * - `allOf` and the other keywords of a schema give the meet of their types (TYPE.SCHEMA-ALLOF). Records merge their
 *   fields, and a closed part keeps the merge closed.
 *
 * The type holds each value that the schema accepts. Each keyword that the function does not read tests nothing, as
 * `unknown`, and the issues name it. Examples are `minimum` and `pattern`. A schema with `nullable` or `$dynamicRef`
 * reads as `unknown`, because these keywords can permit more values. The function does not throw.
 *
 * @param schema - The schema, as JSON.
 * @returns The type, and the problems of the reading with their keys in the schema.
 */
export function typeFromSchema(schema: unknown): TypeReading {
  const reader = new SchemaReader(schema);
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
