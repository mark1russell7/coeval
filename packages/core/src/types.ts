import { type Json, type Key, docEquals, isRecord } from "./doc.ts";

/*
 * Value types and value domains (R5 P2, D22). A value type is a set of values that a result can have. It is a JSON
 * term that only a check reads. It is not a kind, and it does not go into an envelope (D2, D6). A text names a base
 * type. The set of base types is open: a language adds its own domains, each with a membership test.
 */

/**
 * A value type: a set of values that a result can have, as a JSON term.
 *
 * - A text names a base type: `unknown`, `never`, a domain of the kernel (`null`, `bool`, `number`, `text`), or a
 *   domain of a language.
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
function domainOf(name: string, domains: Readonly<Record<string, Domain>> | undefined): Domain | undefined {
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
): boolean {
  if (b.closed && (!a.closed || Object.keys(a.fields).some((key) => !Object.hasOwn(b.fields, key)))) return false;
  for (const key of Object.keys(b.fields)) {
    const want = b.fields[key];
    const needed = !b.optional.has(key);
    if (Object.hasOwn(a.fields, key)) {
      if (needed && a.optional.has(key)) return false;
      if (!fitsAt(a.fields[key], want, domains, depth)) return false;
    } else if (needed) {
      return false;
    } else if (!a.closed && formOf(want, domains).t !== "top") {
      // The other fields of an open record can hold each value, thus only `unknown` accepts such a field.
      return false;
    }
  }
  return true;
}

/** This function is the relation `fits` at one depth of two types. The order of its tests is the order of the rules of `fits`. */
function fitsAt(found: unknown, expected: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth: number): boolean {
  if (depth > MAX_TYPE_DEPTH) return true;
  const a = formOf(found, domains);
  const b = formOf(expected, domains);
  const next = depth + 1;
  if (a.t === "top" || b.t === "top" || a.t === "bottom") return true;
  if (a.t === "union") return a.members.every((item) => fitsAt(item, expected, domains, next));
  if (a.t === "one") return a.values.every((item) => memberAt(item, expected, domains, next));
  if (b.t === "bottom") return false;
  if (b.t === "union") return b.members.some((item) => fitsAt(found, item, domains, next));
  if (a.t === "base") return b.t === "base" && lineOf(a.name, domains).has(b.name);
  if (a.t === "list") return b.t === "list" && fitsAt(a.item, b.item, domains, next);
  if (a.t === "record") return b.t === "record" && recordFits(a, b, domains, next);
  if (b.t !== "fn" || a.params.length > b.params.length) return false;
  // A function fits when it accepts each argument of the expected type, and when its result fits.
  return a.params.every((param, index) => fitsAt(b.params[index], param, domains, next)) && fitsAt(a.to, b.to, domains, next);
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
