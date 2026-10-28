import { type Json, type Key, docEquals, isEnvelope, isRecord } from "./doc.ts";

/*
 * Value types and value domains (R5 P2, D22). A value type is a set of values that a result can have. It is a JSON
 * term that only a check reads. It is not a kind, and it does not go into an envelope (D2, D6). A text names a base
 * type. The set of base types is open: a language adds its own domains, each with a membership test.
 */

/**
 * A value type: a set of values that a result can have, as a JSON term.
 *
 * - A text names a base type: `unknown`, `never`, a domain of the kernel (`null`, `undefined`, `bool`, `number`,
 *   `text`), or a domain of a language.
 * - `list`: a list whose items have the type.
 * - `record`: a plain record with the named fields. `optional` names the fields that can be absent. A `closed`
 *   record has no other fields. The other fields of an open record can hold each value.
 * - `fn`: a function with the types of its parameters, and the type of its result (`to`).
 * - `union`: a value of one of the types. An empty union holds no value.
 * - `one`: one of the JSON values of the list.
 *
 * A term that is not in this list reads as `unknown` (TYPE.UNKNOWN). Thus a later version can add a term.
 */
export type ValueType =
  | string
  | { readonly list: ValueType }
  | { readonly record: Readonly<Record<string, ValueType>>; readonly optional?: readonly string[]; readonly closed?: boolean }
  | { readonly fn: readonly ValueType[]; readonly to: ValueType }
  | { readonly union: readonly ValueType[] }
  | { readonly one: readonly Json[] };

/**
 * A value domain: a base type of a language, with its membership test. A machine holds its domains by their names
 * (`Machine.domains`). A value is a member of a domain only when the test of the domain and the test of each parent
 * accept it (TYPE.MEMBER).
 *
 * A path does not follow a member of a domain as a reference (DEREF.COLLAPSE). Thus the test `is` must refuse each
 * reference document.
 */
export interface Domain {
  /**
   * This function tells if a value is a member of the domain. It must be pure. A test that throws gives `false`.
   *
   * @param value - The value.
   * @returns `true` for a member.
   */
  readonly is: (value: unknown) => boolean;
  /** The names of the parents: the base types that hold each member of the domain. A base type fits each parent. */
  readonly under?: readonly string[];
  /** One sentence that tells what the domain holds. */
  readonly summary?: string;
  /**
   * The value type of each step into a member, by its key, for example the field `x` of a point (TYPE.STEPS). The
   * check of a path reads the steps of the domain first, then the steps of each parent. The language keeps them true:
   * a step with the key into a member reaches a member of the type. A key without a type gives `unknown`.
   */
  readonly steps?: Readonly<Record<string, ValueType>>;
  /**
   * The codec of the members: it writes a member as JSON and reads it again (D40). A document holds a member as the
   * standard extension `ext.domain`. A domain without a codec has no such document.
   */
  readonly codec?: DomainCodec;
}

/**
 * The codec of a domain: it writes a member of the domain as JSON, and it reads the JSON again (D40). Both functions
 * must be pure. `decode(encode(v))` must equal `v` by `sameValue` (EXT.ROUNDTRIP). The codec must give one JSON
 * value for each member, thus the same value has the same document in each language (D12).
 */
export interface DomainCodec {
  /**
   * This function writes a member of the domain as JSON.
   *
   * @param value - A member of the domain.
   * @returns The JSON of the member.
   */
  readonly encode: (value: unknown) => Json;
  /**
   * This function reads the JSON of a member again. It throws for JSON that does not write a member.
   *
   * @param data - The JSON that `encode` gave.
   * @returns The member.
   */
  readonly decode: (data: Json) => unknown;
}

/** A problem of a value type: the keys from the root of the term to the problem, and the reason. */
export interface TypeIssue {
  readonly at: readonly Key[];
  readonly reason: string;
}

/**
 * The domains of the kernel. `unknown` and `never` are not domains: they are the top and the bottom of the types.
 * A machine that does not name one of these domains gets it from this table.
 */
export const STD_DOMAINS: Readonly<Record<string, Domain>> = {
  null: { is: (value) => value === null, summary: "The value null." },
  // JSON has no undefined, thus a document holds it as ext.undefined (D48). The domain has no codec: the codec of values writes undefined first.
  undefined: { is: (value) => value === undefined, summary: "The value undefined. A document holds it as the extension ext.undefined." },
  bool: { is: (value) => typeof value === "boolean", summary: "A truth value: true or false." },
  number: { is: (value) => typeof value === "number", summary: "A number of the host, also NaN, an infinity and -0." },
  text: { is: (value) => typeof value === "string", summary: "A text." },
};

/** The deepest term that a value type can have. A deeper term reads as `unknown`, thus a check stays total. */
const MAX_TYPE_DEPTH = 256;

/** The keys that each term permits beside its own key. */
const TERM_KEYS: Readonly<Record<string, readonly string[]>> = {
  list: ["list"],
  record: ["record", "optional", "closed"],
  fn: ["fn", "to"],
  union: ["union"],
  one: ["one"],
};

const TERMS = /* @__PURE__ */ Object.keys(TERM_KEYS);

/** The form of a value type that the rules read. `top` is `unknown`, and also each term that is not a value type. */
type Form =
  | { readonly t: "top" }
  | { readonly t: "bottom" }
  | { readonly t: "base"; readonly name: string }
  | { readonly t: "list"; readonly item: ValueType }
  | { readonly t: "record"; readonly fields: Readonly<Record<string, ValueType>>; readonly optional: ReadonlySet<string>; readonly closed: boolean }
  | { readonly t: "fn"; readonly params: readonly ValueType[]; readonly to: ValueType }
  | { readonly t: "union"; readonly members: readonly ValueType[] }
  | { readonly t: "one"; readonly values: readonly Json[] };

const TOP: Form = { t: "top" };
const BOTTOM: Form = { t: "bottom" };

/** This function gives the domain of a base type: the domain of the machine, or else the domain of the kernel. */
export function domainOf(name: string, domains: Readonly<Record<string, Domain>> | undefined): Domain | undefined {
  // The top and the bottom are not domains. A table entry with their names has no effect.
  if (name === "unknown" || name === "never") return undefined;
  const found = domains !== undefined && Object.hasOwn(domains, name) ? domains[name] : Object.hasOwn(STD_DOMAINS, name) ? STD_DOMAINS[name] : undefined;
  // A domain can be an instance of a class, thus the test reads only its function `is`.
  return typeof found === "object" && found !== null && typeof found.is === "function" ? found : undefined;
}

/** This function gives the term key of a record, when the record has exactly one term key and no other key. */
function termOf(term: Readonly<Record<string, unknown>>): string | undefined {
  const keys = Object.keys(term);
  const own = keys.filter((key) => TERMS.includes(key));
  if (own.length !== 1) return undefined;
  const allowed = TERM_KEYS[own[0] as string] as readonly string[];
  return keys.every((key) => allowed.includes(key)) ? own[0] : undefined;
}

/** This function reads one level of a value type. A part of a term reads only when a rule asks for it. */
function formOf(type: unknown, domains: Readonly<Record<string, Domain>> | undefined): Form {
  if (typeof type === "string") {
    if (type === "unknown") return TOP;
    if (type === "never") return BOTTOM;
    return domainOf(type, domains) === undefined ? TOP : { t: "base", name: type };
  }
  if (!isRecord(type)) return TOP;
  const term = termOf(type);
  if (term === "list") return { t: "list", item: type["list"] as ValueType };
  if (term === "fn") {
    const params = type["fn"];
    return Array.isArray(params) && Object.hasOwn(type, "to") ? { t: "fn", params: params as readonly ValueType[], to: type["to"] as ValueType } : TOP;
  }
  if (term === "union") return Array.isArray(type["union"]) ? { t: "union", members: type["union"] as readonly ValueType[] } : TOP;
  if (term === "one") return Array.isArray(type["one"]) ? { t: "one", values: type["one"] as readonly Json[] } : TOP;
  if (term !== "record") return TOP;
  const fields = type["record"];
  const optional = type["optional"] ?? [];
  const closed = type["closed"] ?? false;
  if (!isRecord(fields) || !Array.isArray(optional) || typeof closed !== "boolean") return TOP;
  const names = (optional as readonly unknown[]).filter((name): name is string => typeof name === "string" && Object.hasOwn(fields, name));
  return { t: "record", fields: fields as Readonly<Record<string, ValueType>>, optional: new Set(names), closed };
}

/** This function gives each base type that holds the members of a base type: the type itself and each parent, through each level. */
function lineOf(name: string, domains: Readonly<Record<string, Domain>> | undefined): ReadonlySet<string> {
  const seen = new Set<string>([name]);
  const queue = [name];
  while (queue.length > 0) {
    const under = domainOf(queue.pop() as string, domains)?.under;
    if (!Array.isArray(under)) continue;
    for (const parent of under) {
      if (typeof parent !== "string" || seen.has(parent)) continue;
      seen.add(parent);
      queue.push(parent);
    }
  }
  return seen;
}

/** This function tells if a value is a member of a base type: each test of the type and of its parents accepts it. */
function inDomain(value: unknown, name: string, domains: Readonly<Record<string, Domain>> | undefined): boolean {
  for (const each of lineOf(name, domains)) {
    if (each === "never") return false;
    const domain = domainOf(each, domains);
    if (domain === undefined) continue;
    try {
      if (domain.is(value) !== true) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** This function is the membership test at one depth of a type. Below the deepest term, each value is a member. */
function memberAt(value: unknown, type: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth: number): boolean {
  if (depth > MAX_TYPE_DEPTH) return true;
  const form = formOf(type, domains);
  const next = depth + 1;
  switch (form.t) {
    case "top":
      return true;
    case "bottom":
      return false;
    case "base":
      return inDomain(value, form.name, domains);
    case "list": {
      if (!Array.isArray(value)) return false;
      // A hole of a list holds undefined, thus a loop by index tests it too.
      for (let index = 0; index < value.length; index += 1) if (!memberAt(value[index], form.item, domains, next)) return false;
      return true;
    }
    case "record": {
      if (!isRecord(value)) return false;
      for (const key of Object.keys(form.fields)) {
        if (Object.hasOwn(value, key)) {
          if (!memberAt(value[key], form.fields[key], domains, next)) return false;
        } else if (!form.optional.has(key)) {
          return false;
        }
      }
      return !form.closed || Object.keys(value).every((key) => Object.hasOwn(form.fields, key));
    }
    case "fn":
      return typeof value === "function";
    case "union":
      return form.members.some((item) => memberAt(value, item, domains, next));
    case "one":
      return form.values.some((item) => docEquals(item, value));
  }
}

/**
 * This function tells if a value is a member of a value type (TYPE.MEMBER). It is the membership test that a cast
 * at run time uses.
 *
 * - Each value is a member of `unknown`, and no value is a member of `never`.
 * - A value is a member of a domain when the test `is` of the domain and of each parent accepts it.
 * - A list, a record, a union and `one` test their values at each depth.
 * - A function type tests only that the value is a function. Its parameters need a test at each call.
 *
 * The function does not throw. A term that is not a value type, or a base type without a domain, holds each value.
 *
 * @param value - The value.
 * @param type - The value type.
 * @param domains - The domains of the machine. A domain of the kernel that the table does not name comes from `STD_DOMAINS`.
 * @returns `true` when the value is a member of the type.
 */
export function member(value: unknown, type: ValueType, domains?: Readonly<Record<string, Domain>>): boolean {
  return memberAt(value, type, domains, 0);
}

/** This function tells if the record type `a` fits the record type `b`: width, closed records and optional fields. */
function recordFits(
  a: Extract<Form, { readonly t: "record" }>,
  b: Extract<Form, { readonly t: "record" }>,
  domains: Readonly<Record<string, Domain>> | undefined,
  depth: number,
  gradual: boolean,
): boolean {
  if (b.closed && (!a.closed || Object.keys(a.fields).some((key) => !Object.hasOwn(b.fields, key)))) return false;
  for (const key of Object.keys(b.fields)) {
    const want = b.fields[key];
    const needed = !b.optional.has(key);
    if (Object.hasOwn(a.fields, key)) {
      if (needed && a.optional.has(key)) return false;
      if (!fitsAt(a.fields[key], want, domains, depth, gradual)) return false;
    } else if (needed) {
      return false;
    } else if (!a.closed && formOf(want, domains).t !== "top") {
      // The other fields of an open record can hold each value, thus only `unknown` accepts such a field.
      return false;
    }
  }
  return true;
}

/**
 * This function is the relation `fits` at one depth of two types. The order of its tests is the order of the rules of
 * `fits`. Without `gradual`, `unknown` is only the top: it fits only `unknown`. The join uses this strict form.
 */
function fitsAt(found: unknown, expected: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth: number, gradual = true): boolean {
  if (depth > MAX_TYPE_DEPTH) return true;
  const a = formOf(found, domains);
  const b = formOf(expected, domains);
  const next = depth + 1;
  if (b.t === "top" || a.t === "bottom") return true;
  if (a.t === "top") return gradual;
  if (a.t === "union") return a.members.every((item) => fitsAt(item, expected, domains, next, gradual));
  if (a.t === "one") return a.values.every((item) => memberAt(item, expected, domains, next));
  if (b.t === "bottom") return false;
  if (b.t === "union") return b.members.some((item) => fitsAt(found, item, domains, next, gradual));
  if (a.t === "base") return b.t === "base" && lineOf(a.name, domains).has(b.name);
  if (a.t === "list") return b.t === "list" && fitsAt(a.item, b.item, domains, next, gradual);
  if (a.t === "record") return b.t === "record" && recordFits(a, b, domains, next, gradual);
  if (b.t !== "fn" || a.params.length > b.params.length) return false;
  // A function fits when it accepts each argument of the expected type, and when its result fits.
  return a.params.every((param, index) => fitsAt(b.params[index], param, domains, next, gradual)) && fitsAt(a.to, b.to, domains, next, gradual);
}

/**
 * This function tells if each value of the type `found` can be where the type `expected` must be (TYPE.FITS). Each
 * check of a type uses it.
 *
 * - `unknown` fits each type, and each type fits `unknown` (TYPE.UNKNOWN). This is the gradual top.
 * - `never` fits each type. Only `never`, an empty union and an empty `one` fit `never`.
 * - A union fits when each of its types fits. A type fits a union when it fits one of its types.
 * - `one` fits when each of its values is a member of `expected`.
 * - A base type fits itself and each parent of its domain, through each level (TYPE.DOMAIN).
 * - A list fits a list when its items fit.
 * - A record fits a record with fewer fields. A field that `expected` needs is not optional in `found`, and each field
 *   fits. Only a closed record fits a closed record. An open record without an optional field fits only when that
 *   field is `unknown`.
 * - A function fits when it has the same or fewer parameters, each expected parameter fits its parameter, and its
 *   result fits.
 *
 * The relation is sound: a member of `found` is a member of `expected` when no `unknown` is in the types. It is not
 * complete. For example, `bool` does not fit `{ "one": [true, false] }`. The function does not throw.
 *
 * @param found - The type that a part has.
 * @param expected - The type that the position needs.
 * @param domains - The domains of the machine. A domain of the kernel that the table does not name comes from `STD_DOMAINS`.
 * @returns `true` when `found` fits `expected`.
 */
export function fits(found: ValueType, expected: ValueType, domains?: Readonly<Record<string, Domain>>): boolean {
  return fitsAt(found, expected, domains, 0);
}

/** This function sets an own field of a new record. Only the key `__proto__` needs `defineProperty`. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === "__proto__") Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

/** This function is the join of two record types. A field that only one record has is optional, or absent from an open record. */
function joinRecords(
  a: Extract<Form, { readonly t: "record" }>,
  b: Extract<Form, { readonly t: "record" }>,
  domains: Readonly<Record<string, Domain>> | undefined,
  depth: number,
): ValueType {
  const closed = a.closed && b.closed;
  const fields: Record<string, ValueType> = {};
  const optional: string[] = [];
  const keys = [...Object.keys(a.fields), ...Object.keys(b.fields).filter((key) => !Object.hasOwn(a.fields, key))];
  for (const key of keys) {
    const inA = Object.hasOwn(a.fields, key);
    const inB = Object.hasOwn(b.fields, key);
    if (inA && inB) {
      setOwn(fields, key, joinAt(a.fields[key], b.fields[key], domains, depth));
      if (a.optional.has(key) || b.optional.has(key)) optional.push(key);
    } else if (closed) {
      // The other record is closed, thus the field can be absent.
      setOwn(fields, key, inA ? a.fields[key] : b.fields[key]);
      optional.push(key);
    }
    // In an open record, a field of one side can hold each value on the other side. The open join leaves it out.
  }
  return { record: fields, ...(optional.length === 0 ? {} : { optional }), ...(closed ? { closed: true } : {}) };
}

/**
 * This function makes a union of types. It puts the members of each inner union and each value of `one` together. It
 * leaves out each member that fits another member, by the strict form of `fits`.
 */
function unionOf(types: readonly unknown[], domains: Readonly<Record<string, Domain>> | undefined, depth: number): ValueType {
  const members: unknown[] = [];
  const values: Json[] = [];
  let valuesAt = -1;
  const add = (type: unknown, level: number): void => {
    const form = formOf(type, domains);
    if (form.t === "bottom") return;
    if (form.t === "union" && level <= MAX_TYPE_DEPTH) {
      for (const item of form.members) add(item, level + 1);
      return;
    }
    if (form.t === "one") {
      if (valuesAt === -1) {
        valuesAt = members.length;
        members.push(undefined);
      }
      for (const value of form.values) if (!values.some((item) => docEquals(item, value))) values.push(value);
      return;
    }
    members.push(type);
  };
  for (const type of types) add(type, depth);
  if (valuesAt !== -1) members[valuesAt] = { one: values };
  const kept: unknown[] = [];
  for (const member of members) {
    if (kept.some((item) => fitsAt(member, item, domains, depth, false))) continue;
    for (let index = kept.length - 1; index >= 0; index -= 1) if (fitsAt(kept[index], member, domains, depth, false)) kept.splice(index, 1);
    kept.push(member);
  }
  if (kept.length === 0) return "never";
  return kept.length === 1 ? (kept[0] as ValueType) : { union: kept as ValueType[] };
}

/** This function is the join at one depth of two types. */
function joinAt(a: unknown, b: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth: number): ValueType {
  if (depth > MAX_TYPE_DEPTH) return "unknown";
  const fa = formOf(a, domains);
  const fb = formOf(b, domains);
  if (fa.t === "top" || fb.t === "top") return "unknown";
  if (fa.t === "bottom") return b as ValueType;
  if (fb.t === "bottom") return a as ValueType;
  // The strict form keeps the join sound: a type with `unknown` inside is not under a type without it.
  if (fitsAt(a, b, domains, depth, false)) return b as ValueType;
  if (fitsAt(b, a, domains, depth, false)) return a as ValueType;
  const next = depth + 1;
  if (fa.t === "list" && fb.t === "list") return { list: joinAt(fa.item, fb.item, domains, next) };
  if (fa.t === "record" && fb.t === "record") return joinRecords(fa, fb, domains, next);
  return unionOf([a, b], domains, next);
}

/**
 * This function gives the join of two value types (TYPE.JOIN): a type that holds each member of both types. The check
 * of a type uses it for the branches of an `if` and for the items of a list.
 *
 * - `unknown` with each type gives `unknown`, and `never` with a type gives that type.
 * - When one type fits the other by the strict form of `fits`, the join is the wider type. The strict form reads
 *   `unknown` only as the top.
 * - Two lists give a list of the join of their items.
 * - Two records give a record of the join of their common fields. A field of one closed record is optional in the
 *   join of two closed records. The join of an open record leaves out the fields that only one record has.
 * - Each other pair gives a union. The union puts the values of `one` together and leaves out each member that fits
 *   another member.
 *
 * The join is sound: a member of `a` or of `b` is a member of the join. It is not always the least such type. The
 * function does not throw.
 *
 * @param a - The first type.
 * @param b - The second type.
 * @param domains - The domains of the machine. A domain of the kernel that the table does not name comes from `STD_DOMAINS`.
 * @returns The join.
 */
export function join(a: ValueType, b: ValueType, domains?: Readonly<Record<string, Domain>>): ValueType {
  return joinAt(a, b, domains, 0);
}

/** The most values of `one` that the text of a type shows. */
const MAX_TEXT_VALUES = 8;
/** The most characters of one JSON value in the text of a type. */
const MAX_TEXT_VALUE = 40;

/** This function gives a short text of a JSON value for the text of a type. */
function valueText(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX_TEXT_VALUE ? `${text.slice(0, MAX_TEXT_VALUE - 1)}…` : text;
}

/** This function gives the text of a type at one depth. `wrap` puts a union or a function type in brackets. */
function textAt(type: unknown, depth: number, wrap: boolean): string {
  if (depth > MAX_TYPE_DEPTH) return "unknown";
  if (typeof type === "string") return type;
  const term = isRecord(type) ? termOf(type) : undefined;
  if (!isRecord(type) || term === undefined) return "unknown";
  const next = depth + 1;
  const group = (items: readonly string[]): string => (items.length === 0 ? "never" : items.length > 1 && wrap ? `(${items.join(" | ")})` : items.join(" | "));
  if (term === "list") return `list<${textAt(type["list"], next, false)}>`;
  if (term === "union") return Array.isArray(type["union"]) ? group((type["union"] as readonly unknown[]).map((item) => textAt(item, next, true))) : "unknown";
  if (term === "one") {
    if (!Array.isArray(type["one"])) return "unknown";
    const values = type["one"] as readonly unknown[];
    const shown = values.slice(0, MAX_TEXT_VALUES).map(valueText);
    return group(values.length > MAX_TEXT_VALUES ? [...shown, `… ${values.length - MAX_TEXT_VALUES} more`] : shown);
  }
  if (term === "fn") {
    if (!Array.isArray(type["fn"])) return "unknown";
    const text = `(${(type["fn"] as readonly unknown[]).map((item) => textAt(item, next, false)).join(", ")}) => ${textAt(type["to"], next, true)}`;
    return wrap ? `(${text})` : text;
  }
  const fields = type["record"];
  if (!isRecord(fields)) return "unknown";
  const optional = Array.isArray(type["optional"]) ? (type["optional"] as readonly unknown[]) : [];
  const items = Object.keys(fields).map((key) => {
    const name = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
    return `${name}${optional.includes(key) ? "?" : ""}: ${textAt(fields[key], next, false)}`;
  });
  if (type["closed"] !== true) items.push("...");
  return `{${items.join(", ")}}`;
}

/**
 * This function gives the text of a value type (TYPE.TEXT), for the reason of an issue. The function does not throw.
 *
 * - A base type gives its name.
 * - `list<T>` is a list, `{a: T, b?: U}` is a closed record, and `{a: T, ...}` is an open record.
 * - `(T, U) => V` is a function, and `T | U` is a union.
 * - `one` gives its values as JSON, and an empty union gives `never`.
 * - A term that is not a value type gives `unknown`.
 *
 * The text shows at most 8 values of `one`, and it cuts a long value.
 *
 * @param type - The value type.
 * @returns The text.
 */
export function typeText(type: ValueType): string {
  return textAt(type, 0, false);
}

/*
 * The functions below read one level of a type for the type rules of the kit. The package does not export them.
 */

/** This function tells if a type reads as `unknown`. Such a type is the top, a term that is not a value type, or a base type without a domain. */
export function isUnknown(type: unknown, domains: Readonly<Record<string, Domain>> | undefined): boolean {
  return formOf(type, domains).t === "top";
}

/** This function gives the type of the items of a list type, or `undefined` for each other type. */
export function itemOf(type: unknown, domains: Readonly<Record<string, Domain>> | undefined): ValueType | undefined {
  const form = formOf(type, domains);
  return form.t === "list" ? form.item : undefined;
}

/** This function gives the type of a field of a record type, or `undefined` when the type is not a record with the field. */
export function fieldOf(type: unknown, key: string, domains: Readonly<Record<string, Domain>> | undefined): ValueType | undefined {
  const form = formOf(type, domains);
  return form.t === "record" && Object.hasOwn(form.fields, key) ? form.fields[key] : undefined;
}

/** This function gives the parameters and the result of a function type, or `undefined` for each other type. */
export function fnOf(type: unknown, domains: Readonly<Record<string, Domain>> | undefined): { readonly params: readonly ValueType[]; readonly to: ValueType } | undefined {
  const form = formOf(type, domains);
  return form.t === "fn" ? { params: form.params, to: form.to } : undefined;
}

/** This function tells if each value of a type can be a function. Such a type is the top, the bottom, a function type, or a union of them. */
export function callable(type: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth = 0): boolean {
  if (depth > MAX_TYPE_DEPTH) return true;
  const form = formOf(type, domains);
  if (form.t === "top" || form.t === "bottom" || form.t === "fn") return true;
  if (form.t === "union") return form.members.every((item) => callable(item, domains, depth + 1));
  return form.t === "one" && form.values.length === 0;
}

/** This function tells if a type has no `unknown` at any depth. Then `fits` decides it without the gradual rule. */
export function isPrecise(type: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth = 0): boolean {
  if (depth > MAX_TYPE_DEPTH) return false;
  const form = formOf(type, domains);
  const next = depth + 1;
  switch (form.t) {
    case "top":
      return false;
    case "list":
      return isPrecise(form.item, domains, next);
    case "record":
      return Object.keys(form.fields).every((key) => isPrecise(form.fields[key], domains, next));
    case "fn":
      return form.params.every((item) => isPrecise(item, domains, next)) && isPrecise(form.to, domains, next);
    case "union":
      return form.members.every((item) => isPrecise(item, domains, next));
    default:
      return true;
  }
}

/** The keys of the header of an envelope. A record with only these keys can have the form of an envelope. */
export const HEADER_KEYS: ReadonlySet<string> = /* @__PURE__ */ new Set(["type", "value", "name", "own"]);

/**
 * This function tells if a member of a type can have the form of an envelope. A path asks the ladder for each step
 * into an envelope, and it follows a reference document (DEREF.COLLAPSE). Thus the type of such a member does not
 * tell what a path reaches.
 *
 * The test is conservative. A record that needs a key outside the header is not an
 * envelope. A closed record without the fields `type` and `value` is not an envelope either. A domain refuses each
 * reference document (`Domain`), and its steps tell what a step reaches.
 */
export function holdsEnvelope(type: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth = 0): boolean {
  if (depth > MAX_TYPE_DEPTH) return true;
  const form = formOf(type, domains);
  switch (form.t) {
    case "top":
      return true;
    case "union":
      return form.members.some((item) => holdsEnvelope(item, domains, depth + 1));
    case "one":
      return form.values.some((value) => isEnvelope(value));
    case "record":
      if (Object.keys(form.fields).some((key) => !form.optional.has(key) && !HEADER_KEYS.has(key))) return false;
      return !form.closed || (Object.hasOwn(form.fields, "type") && Object.hasOwn(form.fields, "value"));
    default:
      return false;
  }
}

/**
 * What one step reaches from a member of a type: its type, or the fields of the type when no member has the step.
 * The field list is empty when the type is not a record.
 */
export type StepType = { readonly type: ValueType } | { readonly missing: readonly string[] };

/** This function gives the index of a key into a list, as a step into the value finds it, or -1. */
function indexOf(key: Key): number {
  if (typeof key === "number") return Number.isInteger(key) && key >= 0 ? key : -1;
  return /^\d+$/.test(key) ? Number(key) : -1;
}

/** This function adds the keys of a list to another list, without the keys that it has. */
function addKeys(into: string[], keys: readonly string[]): void {
  for (const key of keys) if (!into.includes(key)) into.push(key);
}

/** This function gives the step of a key into one JSON value of `one`: the value that it reaches, or the fields of the value. */
function valueStep(value: unknown, key: Key): { readonly found: unknown } | { readonly fields: readonly string[] } {
  if (Array.isArray(value)) {
    if (key === "length") return { found: value.length };
    const index = indexOf(key);
    return index >= 0 && index < value.length ? { found: value[index] } : { fields: [] };
  }
  if (isRecord(value)) return Object.hasOwn(value, String(key)) ? { found: value[String(key)] } : { fields: Object.keys(value) };
  return { fields: [] };
}

/**
 * This function gives the type that a step with a key reaches from a member of a type (TYPE.PATH). The caller tests
 * first that no member can be an envelope (`holdsEnvelope`).
 *
 * - A record gives the type of its field. A closed record without the field has no such step. An open record gives
 *   `unknown`.
 * - A list gives the type of its items for an index, and `number` for `length`.
 * - A base type reads the steps of its domain, then of each parent (`Domain.steps`).
 * - A union joins the steps of its types. `one` gives the values that the step reaches.
 * - Each other step gives `unknown`, and `never` gives `never`.
 *
 * @param examine - The function that examines a type of the steps of a domain, one time in a check.
 */
export function stepType(
  type: unknown,
  key: Key,
  domains: Readonly<Record<string, Domain>> | undefined,
  examine?: (type: ValueType, what: string) => ValueType,
  depth = 0,
): StepType {
  if (depth > MAX_TYPE_DEPTH) return { type: "unknown" };
  const form = formOf(type, domains);
  const name = String(key);
  switch (form.t) {
    case "bottom":
      return { type: "never" };
    case "base":
      for (const each of lineOf(form.name, domains)) {
        const steps = domainOf(each, domains)?.steps;
        if (typeof steps !== "object" || steps === null || !Object.hasOwn(steps, name)) continue;
        const found = steps[name] as ValueType;
        return { type: examine === undefined ? found : examine(found, `type of the step ${name} of the domain ${each}`) };
      }
      return { type: "unknown" };
    case "list":
      if (key === "length") return { type: "number" };
      return { type: indexOf(key) >= 0 ? form.item : "unknown" };
    case "record":
      if (Object.hasOwn(form.fields, name)) return { type: form.fields[name] as ValueType };
      return form.closed ? { missing: Object.keys(form.fields) } : { type: "unknown" };
    case "union": {
      let joined: ValueType | undefined;
      const fields: string[] = [];
      for (const item of form.members) {
        const step = stepType(item, key, domains, examine, depth + 1);
        if ("missing" in step) addKeys(fields, step.missing);
        else joined = joined === undefined ? step.type : join(joined, step.type, domains);
      }
      // A member without the step makes the path fail, thus only the other members give a type.
      return joined === undefined ? { missing: fields } : { type: joined };
    }
    case "one": {
      const found: Json[] = [];
      const fields: string[] = [];
      for (const value of form.values) {
        const step = valueStep(value, key);
        if ("fields" in step) addKeys(fields, step.fields);
        else if (!found.some((item) => docEquals(item, step.found))) found.push(step.found as Json);
      }
      return found.length === 0 ? { missing: fields } : { type: { one: found } };
    }
    default:
      return { type: "unknown" };
  }
}

/** A term that `typeIssues` reads later: the term, its keys from the root and its depth. */
interface Pending {
  readonly type: unknown;
  readonly at: readonly Key[];
  readonly depth: number;
}

/**
 * This function lists the problems of a value type (TYPE.ISSUES). A problem is a term that is not a value type, a
 * base type without a domain, or a term that is too deep. `fits` and `member` read each such term as `unknown`.
 * Thus a check that reads a type from a contract can report it first.
 *
 * @param type - The value type, as JSON.
 * @param domains - The domains of the machine. A domain of the kernel that the table does not name comes from `STD_DOMAINS`.
 * @returns The problems. A term comes before its parts, and the parts keep their order.
 */
export function typeIssues(type: unknown, domains?: Readonly<Record<string, Domain>>): readonly TypeIssue[] {
  const issues: TypeIssue[] = [];
  const stack: Pending[] = [{ type, at: [], depth: 0 }];
  while (stack.length > 0) {
    const { type: here, at, depth } = stack.pop() as Pending;
    const issue = (reason: string, where: readonly Key[] = at): void => {
      issues.push({ at: where, reason });
    };
    if (depth > MAX_TYPE_DEPTH) {
      issue(`The value type is deeper than ${MAX_TYPE_DEPTH} terms.`);
      continue;
    }
    if (typeof here === "string") {
      if (here !== "unknown" && here !== "never" && domainOf(here, domains) === undefined) issue(`The machine has no domain ${here}.`);
      continue;
    }
    const term = isRecord(here) ? termOf(here) : undefined;
    if (!isRecord(here) || term === undefined) {
      issue(`A value type is a text, or a record with one of the keys ${TERMS.join(", ")} and the keys that go with it.`);
      continue;
    }
    // The parts go on the stack in the reverse order, thus the issues come in the order of the term.
    const parts: Pending[] = [];
    const part = (each: unknown, where: readonly Key[]): void => {
      parts.push({ type: each, at: where, depth: depth + 1 });
    };
    const list = (key: string, what: string): readonly unknown[] => {
      const items = here[key];
      if (Array.isArray(items)) return items;
      issue(`The value of ${key} is a list of ${what}.`, [...at, key]);
      return [];
    };
    if (term === "list") part(here["list"], [...at, "list"]);
    if (term === "union") list("union", "value types").forEach((each, index) => part(each, [...at, "union", index]));
    if (term === "one") list("one", "JSON values");
    if (term === "fn") {
      list("fn", "value types").forEach((each, index) => part(each, [...at, "fn", index]));
      if (Object.hasOwn(here, "to")) part(here["to"], [...at, "to"]);
      else issue("A function type has the key to: the type of its result.");
    }
    if (term === "record") {
      const fields = here["record"];
      if (isRecord(fields)) for (const key of Object.keys(fields)) part(fields[key], [...at, "record", key]);
      else issue("The value of record is a record of value types.", [...at, "record"]);
      if (Object.hasOwn(here, "optional")) {
        list("optional", "field names").forEach((name, index) => {
          if (typeof name !== "string" || !isRecord(fields) || !Object.hasOwn(fields, name)) issue(`The optional field ${String(name)} is not a field of the record.`, [...at, "optional", index]);
        });
      }
      if (Object.hasOwn(here, "closed") && typeof here["closed"] !== "boolean") issue("The value of closed is true or false.", [...at, "closed"]);
    }
    for (let index = parts.length - 1; index >= 0; index -= 1) stack.push(parts[index] as Pending);
  }
  return issues;
}
