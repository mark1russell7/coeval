import { type Json, type Key, docEquals, isEnvelope, isRecord } from "./doc.ts";
import { type EvalError, Failure, WORK_LIMIT, workFailure } from "./errors.ts";

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
  /**
   * The full list of the members of the domain, when the domain holds few values, for example `true` and `false` of
   * `bool` (TYPE.FITS-FINITE). `fits` reads it: a base type with a list fits a type that holds each member of the list.
   * The language keeps the list complete: each member of the domain is in the list. A value that fails a test of the
   * domain does not count. The check reads a list of at most 64 values.
   */
  readonly values?: readonly unknown[];
  /**
   * Some members of the domain for the tests of `conforms`, for example `0` and `-1` of `number` (D99). The checks
   * `truth` and `cover` add the samples of each domain to the palette. A sample that fails a test of a type does not
   * count. The list is not a full list of the members, thus `fits` does not read it.
   */
  readonly samples?: readonly unknown[];
  /**
   * The covers of the domain (TYPE.FITS-COVER, D85). A cover is a list of domains under this domain, and its domains
   * together hold each member of this domain. An example is a domain of negative numbers and a domain of the other
   * numbers as a cover of `number`. `fits` reads it: a base type fits a union when each domain of a cover fits it.
   *
   * A split of a record also narrows a field of the domain to each domain of a cover (D90).
   * The language keeps each cover true, and `fits` trusts it, as it trusts `values`. A cover that is empty, or that
   * names this domain or a name that is not under it, does not count. `conforms` tests each cover from samples (D94).
   */
  readonly covers?: readonly (readonly string[])[];
}

/**
 * The codec of a domain: it writes a member of the domain as JSON, and it reads the JSON again (D40). Both functions
 * must be pure. `decode(encode(v))` must equal `v` by `sameValue` (EXT.ROUNDTRIP). The codec must give one JSON
 * value for each member, thus the same value has the same document in each language (D12). `codecLaws` examines
 * these laws for the members of the domain (D130).
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
  null: { is: (value) => value === null, values: [null], summary: "The value null." },
  // JSON has no undefined, thus a document holds it as ext.undefined (D48). The domain has no codec: the codec of values writes undefined first.
  undefined: { is: (value) => value === undefined, values: [undefined], summary: "The value undefined. A document holds it as the extension ext.undefined." },
  bool: { is: (value) => typeof value === "boolean", values: [true, false], summary: "A truth value: true or false." },
  number: { is: (value) => typeof value === "number", samples: [0, -1], summary: "A number of the host, also NaN, an infinity and -0." },
  text: { is: (value) => typeof value === "string", summary: "A text." },
};

/** The deepest term that a value type can have. A deeper term reads as `unknown`, thus a check stays total. */
const MAX_TYPE_DEPTH = 256;

/** The most values that the finite rule of `fits` reads for one type (TYPE.FITS-FINITE). A type with more values is not finite for the rule. */
const MAX_FINITE_VALUES = 64;

/** The most domains of covers that the cover rule of `fits` tests for one type (TYPE.FITS-COVER). A larger test gives `false`. */
const MAX_COVER_STEPS = 64;

/** The most records that one split of `fits` builds, with each split inside its work (TYPE.FITS-PATH, D89). A larger split gives `false`. */
const MAX_SPLIT_RECORDS = 64;

/**
 * The most paths of one depth that the split rule follows into the fields of a record (TYPE.FITS-PATH, D200). A record
 * that shares its parts has a path for each way through it. A level with more paths ends the search for splits.
 */
const MAX_SPLIT_PATHS = 4096;

/*
 * A type that a check builds can share its parts. For example, a `let` gives the same type to each reference of a
 * name. A walk that reads such a type as a tree reads a shared part one time for each way to it. That count can double
 * at each level. Thus the walks of `fits`, `join` and the members keep the answer of each part in a memo of one call
 * (D200). Each memo gives the answer that the walk without the memo gives.
 */

/** A memo of a pair of terms: the first term, then the second term, then a number for the other arguments. */
export type PairMemo<T> = Map<unknown, Map<unknown, Map<number, T>>>;

/** This function gives the answer of a pair from a memo, or `undefined` when the memo has no answer. */
export function recall<T>(memo: PairMemo<T>, a: unknown, b: unknown, code: number): T | undefined {
  return memo.get(a)?.get(b)?.get(code);
}

/** This function puts the answer of a pair into a memo. */
export function keep<T>(memo: PairMemo<T>, a: unknown, b: unknown, code: number, answer: T): void {
  let byA = memo.get(a);
  if (byA === undefined) memo.set(a, (byA = new Map()));
  let byB = byA.get(b);
  if (byB === undefined) byA.set(b, (byB = new Map()));
  byB.set(code, answer);
}

/** A memo of one term at a depth. */
type DepthMemo<T> = Map<unknown, Map<number, T>>;

/** This function gives the answer of a term at a depth from a memo, or `undefined` when the memo has no answer. */
function recallAt<T>(memo: DepthMemo<T>, type: unknown, depth: number): T | undefined {
  return memo.get(type)?.get(depth);
}

/** This function puts the answer of a term at a depth into a memo. */
function keepAt<T>(memo: DepthMemo<T>, type: unknown, depth: number, answer: T): void {
  let byDepth = memo.get(type);
  if (byDepth === undefined) memo.set(type, (byDepth = new Map()));
  byDepth.set(depth, answer);
}

/**
 * The memos of one walk of `fits`, `join` or `membersOf`. The answer of `fits` can depend on the budget of a split
 * (D89). Thus it has three memos:
 *
 * - `pure` holds the answers of calls that took no record from a budget. Such an answer holds under each budget.
 * - `free` holds the answers of calls without a budget. Such a call makes its own budget.
 * - `spent` holds the answers of calls whose budget was spent at the start. Each record that such a call tries fails.
 */
interface Walk {
  readonly pure: PairMemo<boolean>;
  readonly free: PairMemo<boolean>;
  readonly spent: PairMemo<boolean>;
  /** The number of records that the splits of the walk took from a budget. */
  cases: number;
  /** The answers of `memberAt`, by the value, the type and the depth. */
  readonly members: PairMemo<boolean>;
  /** The answers of `valuesOf`, by the type and the depth. `null` is the answer `undefined`. */
  readonly values: DepthMemo<readonly unknown[] | null>;
  /** The answers of `joinAt`, by the two types and the depth. */
  readonly joins: PairMemo<ValueType>;
}

/** This function makes the memos of a new walk. */
function newWalk(): Walk {
  return { pure: new Map(), free: new Map(), spent: new Map(), cases: 0, members: new Map(), values: new Map(), joins: new Map() };
}

/*
 * A pass of types has a count of work (TYPE.WORK, D207). Each step of a walk of types costs one point: each term that a
 * rule reads when no memo has its answer. The memos keep most walks linear (D200), and the count ends each other walk,
 * for example a walk of the members of a union that shares its parts. A pass past its limit stops with `#WORK!`.
 */

/** The count of the current pass of types: the points that it can still spend, and its limit. */
interface TypeWork {
  left: number;
  readonly limit: number;
}

/** The count of the current pass of types, or `undefined` outside a pass. */
let typeWork: TypeWork | undefined;

/** The work that the error of the limit names for a pass of types. */
const TYPE_PASS = "one pass of types";

/**
 * This function takes one point from the count of the current pass of types. Past the limit, it throws the error
 * `#WORK!`, and the pass stops. Outside a pass, it does nothing. The package does not export it.
 */
export function spendTypeWork(): void {
  if (typeWork !== undefined && (typeWork.left -= 1) < 0) throw new Failure(workFailure(typeWork.limit, TYPE_PASS));
}

/** This function tells if the current pass of types is past its limit. A catch inside the pass then throws the error again. */
export function typeWorkSpent(): boolean {
  return typeWork !== undefined && typeWork.left < 0;
}

/**
 * This function starts a pass of types with a count of work (TYPE.WORK, D207). A pass inside another pass takes its
 * points from the count of the outer pass, thus only the outer pass stops. The package does not export the function.
 *
 * @param limit - The most points of the pass.
 * @param run - The pass.
 * @param stopped - The answer of a pass past its limit. It gets the error `#WORK!`.
 * @returns The answer of the pass, or the answer of `stopped`.
 */
export function withTypeWork<T>(limit: number, run: () => T, stopped: (error: EvalError) => T): T {
  if (typeWork !== undefined) return run();
  const own: TypeWork = { left: limit, limit };
  typeWork = own;
  let answer: { readonly value: T } | undefined;
  try {
    answer = { value: run() };
  } catch (error) {
    if (own.left >= 0) throw error;
  } finally {
    typeWork = undefined;
  }
  // A function of the host can catch the error, thus the count decides.
  return answer === undefined || own.left < 0 ? stopped(workFailure(limit, TYPE_PASS)) : answer.value;
}

/** The key of the value -0 in a memo. A `Map` reads -0 as 0, but a domain can tell them apart. */
const NEG_ZERO: object = {};

/** This function tells if a term is an object. Only an object can be a shared part of a type. */
function isObject(term: unknown): term is object {
  return typeof term === "object" && term !== null;
}

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

/**
 * This function gives each base type that holds the members of a base type: the type itself and each parent, through
 * each level. A cycle of parents ends at a name that the line has, and a parent that is not a domain ends its branch.
 * The function is internal: `encodeValue` uses it too (D109).
 */
export function lineOf(name: string, domains: Readonly<Record<string, Domain>> | undefined): ReadonlySet<string> {
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

/** The most steps of a test of `member` without a walk. Then the test starts again with a walk (D200). */
const MAX_MEMBER_STEPS = 4096;

/** The steps of the test of `member` that runs without a walk. */
let memberSteps = 0;

/**
 * This function is the membership test at one depth of a type. Below the deepest term, each value is a member. A walk
 * keeps the answer of each value and term of a type (D200). The test of `member` starts without a walk, and it counts
 * its steps. After the most steps, each step gives `false`, and `member` starts the test again with a walk.
 */
function memberAt(value: unknown, type: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth: number, w: Walk | undefined): boolean {
  if (depth > MAX_TYPE_DEPTH) return true;
  if (w === undefined) return (memberSteps += 1) > MAX_MEMBER_STEPS ? false : memberRules(value, type, domains, depth, w);
  if (!isObject(type)) return memberRules(value, type, domains, depth, w);
  const key = Object.is(value, -0) ? NEG_ZERO : value;
  const known = recall(w.members, key, type, depth);
  if (known !== undefined) return known;
  const answer = memberRules(value, type, domains, depth, w);
  keep(w.members, key, type, depth, answer);
  return answer;
}

/** This function holds the rules of the membership test at one depth of a type. */
function memberRules(value: unknown, type: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth: number, w: Walk | undefined): boolean {
  spendTypeWork();
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
      for (let index = 0; index < value.length; index += 1) if (!memberAt(value[index], form.item, domains, next, w)) return false;
      return true;
    }
    case "record": {
      if (!isRecord(value)) return false;
      for (const key of Object.keys(form.fields)) {
        if (Object.hasOwn(value, key)) {
          if (!memberAt(value[key], form.fields[key], domains, next, w)) return false;
        } else if (!form.optional.has(key)) {
          return false;
        }
      }
      return !form.closed || Object.keys(value).every((key) => Object.hasOwn(form.fields, key));
    }
    case "fn":
      return typeof value === "function";
    case "union":
      return form.members.some((item) => memberAt(value, item, domains, next, w));
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
  // A test of a domain can call member. Thus the count of the outer test stays, and it continues after the inner test.
  const outer = memberSteps;
  memberSteps = 0;
  const answer = memberAt(value, type, domains, 0, undefined);
  const spent = memberSteps > MAX_MEMBER_STEPS;
  memberSteps = outer;
  // A value that shares its parts can have a test for each way through it. The walk tests each part one time.
  return spent ? memberAt(value, type, domains, 0, newWalk()) : answer;
}

/** This function tells if the record type `a` fits the record type `b`: width, closed records and optional fields. */
function recordFits(
  a: Extract<Form, { readonly t: "record" }>,
  b: Extract<Form, { readonly t: "record" }>,
  domains: Readonly<Record<string, Domain>> | undefined,
  depth: number,
  gradual: boolean,
  budget: SplitBudget | undefined,
  w: Walk,
): boolean {
  if (b.closed && (!a.closed || Object.keys(a.fields).some((key) => !Object.hasOwn(b.fields, key)))) return false;
  for (const key of Object.keys(b.fields)) {
    const want = b.fields[key];
    const needed = !b.optional.has(key);
    if (Object.hasOwn(a.fields, key)) {
      if (needed && a.optional.has(key)) return false;
      if (!fitsAt(a.fields[key], want, domains, depth, gradual, true, budget, w)) return false;
    } else if (needed) {
      return false;
    } else if (!a.closed && formOf(want, domains).t !== "top") {
      // The other fields of an open record can hold each value, thus only `unknown` accepts such a field.
      return false;
    }
  }
  return true;
}

/** This function adds a value to a list of distinct values, by `docEquals`. */
function addValue(out: unknown[], value: unknown): void {
  if (!out.some((item) => docEquals(item, value))) out.push(value);
}

/**
 * This function gives the values of a base type with a finite list. It reads the list of the first domain of the line
 * with at most 64 values, and it keeps only the members of the type. Thus the list of a parent serves each domain under it.
 */
function baseValues(name: string, domains: Readonly<Record<string, Domain>> | undefined): readonly unknown[] | undefined {
  const domain = domainOf(name, domains);
  if (domain === undefined) return undefined;
  const line = Array.isArray(domain.values) || !Array.isArray(domain.under) ? [name] : lineOf(name, domains);
  for (const each of line) {
    const values: unknown = domainOf(each, domains)?.values;
    if (!Array.isArray(values) || values.length > MAX_FINITE_VALUES) continue;
    const out: unknown[] = [];
    // A hole of the list holds undefined, thus a loop by index reads it too.
    for (let index = 0; index < values.length; index += 1) if (inDomain(values[index], name, domains)) addValue(out, values[index]);
    return out;
  }
  return undefined;
}

/** This function gives a copy of a record with one more field. */
function withField(record: Readonly<Record<string, unknown>>, key: string, value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(record)) setOwn(out, name, record[name]);
  setOwn(out, key, value);
  return out;
}

/**
 * This function gives the members of a record type, when they are few. A record with a needed field without members
 * has no members. Only a closed record with a finite list for each field has a finite list.
 */
function recordValues(form: Extract<Form, { readonly t: "record" }>, domains: Readonly<Record<string, Domain>> | undefined, depth: number, w: Walk): readonly unknown[] | undefined {
  let out: readonly Record<string, unknown>[] = [{}];
  let finite = form.closed;
  for (const key of Object.keys(form.fields)) {
    const values = valuesOf(form.fields[key], domains, depth, w);
    const optional = form.optional.has(key);
    if (values === undefined) {
      finite = false;
      continue;
    }
    if (values.length === 0 && !optional) return [];
    if (!finite) continue;
    if (out.length * (values.length + (optional ? 1 : 0)) > MAX_FINITE_VALUES) {
      // The list is too long, but a later needed field without members can still empty the record.
      finite = false;
      continue;
    }
    out = out.flatMap((record) => [...(optional ? [record] : []), ...values.map((value) => withField(record, key, value))]);
  }
  return finite ? out : undefined;
}

/**
 * This function gives a list of the members of a type, when the type has at most 64 members (TYPE.FITS-FINITE). Each
 * other type gives `undefined`. Such a type is `unknown`, a base type without a finite list, or a function type. A
 * list that can hold an item and an open record with members are also such types.
 *
 * The walk keeps the list of each term at each depth (D200). Thus the callers share the lists, and they do not change them.
 */
function valuesOf(type: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth: number, w: Walk): readonly unknown[] | undefined {
  if (depth > MAX_TYPE_DEPTH) return undefined;
  const known = recallAt(w.values, type, depth);
  if (known !== undefined) return known ?? undefined;
  const answer = valuesRules(type, domains, depth, w);
  keepAt(w.values, type, depth, answer ?? null);
  return answer;
}

/** This function holds the rules of `valuesOf` at one depth of a type. */
function valuesRules(type: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth: number, w: Walk): readonly unknown[] | undefined {
  spendTypeWork();
  const form = formOf(type, domains);
  const next = depth + 1;
  switch (form.t) {
    case "bottom":
      return [];
    case "base":
      return baseValues(form.name, domains);
    case "list":
      return valuesOf(form.item, domains, next, w)?.length === 0 ? [[]] : undefined;
    case "record":
      return recordValues(form, domains, next, w);
    case "one":
    case "union": {
      const out: unknown[] = [];
      const items: readonly unknown[] = form.t === "one" ? form.values : form.members;
      for (const item of items) {
        const values = form.t === "one" ? [item] : valuesOf(item, domains, next, w);
        if (values === undefined) return undefined;
        for (const value of values) addValue(out, value);
        if (out.length > MAX_FINITE_VALUES) return undefined;
      }
      return out;
    }
    default:
      return undefined;
  }
}

/** This function gives the members of a type at one depth, for `membersOf`. The memo keeps the members of each union at each depth (D200). */
function membersAt(
  type: unknown,
  domains: Readonly<Record<string, Domain>> | undefined,
  samples: readonly unknown[],
  depth: number,
  w: Walk,
  memo: DepthMemo<readonly unknown[]>,
): readonly unknown[] {
  const finite = valuesOf(type, domains, depth, w);
  if (finite !== undefined) return finite;
  const form = formOf(type, domains);
  if (form.t !== "union" || depth > MAX_TYPE_DEPTH) return samples.filter((sample) => memberAt(sample, type, domains, 0, w));
  const known = recallAt(memo, type, depth);
  if (known !== undefined) return known;
  const out: unknown[] = [];
  for (const item of form.members) for (const value of membersAt(item, domains, samples, depth + 1, w, memo)) addValue(out, value);
  keepAt(memo, type, depth, out);
  return out;
}

/**
 * This function gives members of a type for a test of a declaration (D86). A type with at most 64 members gives each
 * member, from the lists `values` of its domains (TYPE.FITS-FINITE). A union gives the members of each of its types.
 * Each other type gives the samples that are its members. The samples of the domains come after the given samples (D99).
 * The kernel does not export the function.
 *
 * @param type - The type.
 * @param domains - The domains of the machine.
 * @param samples - The values to test when the type has no full list of members.
 * @returns Distinct members of the type.
 */
export function membersOf(type: ValueType, domains: Readonly<Record<string, Domain>> | undefined, samples: readonly unknown[]): readonly unknown[] {
  return membersAt(type, domains, withDomainSamples(samples, domains), 0, newWalk(), new Map());
}

/**
 * This function adds the samples of the domains to a palette (D99). It reads the list `samples` of each domain of the
 * table and of each standard domain that the table does not replace. The result holds each value one time.
 */
function withDomainSamples(palette: readonly unknown[], domains: Readonly<Record<string, Domain>> | undefined): readonly unknown[] {
  const out: unknown[] = [];
  for (const value of palette) addValue(out, value);
  const names = new Set([...Object.keys(STD_DOMAINS), ...(domains === undefined ? [] : Object.keys(domains))]);
  for (const name of names) {
    const samples: unknown = domainOf(name, domains)?.samples;
    if (Array.isArray(samples)) for (const value of samples as readonly unknown[]) addValue(out, value);
  }
  return out;
}

/** A false cover that a sample shows (D94): a member of a covered domain that no domain of the cover holds. */
export interface FalseCover {
  /** The name of the covered domain. */
  readonly domain: string;
  /** The cover: the names of its domains. */
  readonly cover: readonly string[];
  /** The sample. It is a member of the covered domain. */
  readonly value: unknown;
}

/**
 * This function finds the false covers of a language from samples (D94). A cover is false when a sample of the covered
 * domain is in no domain of the cover. The function tests each valid cover of each domain of the table. It ignores a
 * cover that does not count by the line rule of D85, because `fits` ignores it too. It also ignores a sample outside
 * the covered domain.
 *
 * The samples of the domains come after the given samples (D99). `conforms` and a test of `fits` use the function. The
 * kernel does not export it.
 *
 * @param domains - The domains of the language, by their names.
 * @param samples - The samples of each covered domain, by the name of the domain.
 * @returns Each sample that breaks a cover, in the order of the domains, the covers and the samples.
 */
export function falseCovers(domains: Readonly<Record<string, Domain>>, samples: Readonly<Record<string, readonly unknown[]>>): readonly FalseCover[] {
  const out: FalseCover[] = [];
  for (const [name, domain] of Object.entries(domains)) {
    const covers: unknown = domain.covers;
    if (!Array.isArray(covers)) continue;
    const values = withDomainSamples((Object.hasOwn(samples, name) ? samples[name] : undefined) ?? [], domains);
    for (const cover of covers as readonly unknown[]) {
      if (!validCover(name, cover, domains)) continue;
      for (const value of values) {
        if (member(value, name, domains) && !cover.some((part) => member(value, part, domains))) out.push({ domain: name, cover, value });
      }
    }
  }
  return out;
}

/** This function holds the rules of the shapes of `fits`: base types, lists, records and functions. */
function shapeFits(a: Form, b: Form, domains: Readonly<Record<string, Domain>> | undefined, next: number, gradual: boolean, budget: SplitBudget | undefined, w: Walk): boolean {
  if (a.t === "base") return b.t === "base" && lineOf(a.name, domains).has(b.name);
  if (a.t === "list") return b.t === "list" && fitsAt(a.item, b.item, domains, next, gradual, true, budget, w);
  if (a.t === "record") return b.t === "record" && recordFits(a, b, domains, next, gradual, budget, w);
  if (a.t !== "fn" || b.t !== "fn" || a.params.length > b.params.length) return false;
  // A function fits when it accepts each argument of the expected type, and when its result fits.
  return a.params.every((param, index) => fitsAt(b.params[index], param, domains, next, gradual, true, budget, w)) && fitsAt(a.to, b.to, domains, next, gradual, true, budget, w);
}

/**
 * This function is the relation `fits` at one depth of two types. The order of its tests is the order of the rules of
 * `fits`. Without `gradual`, `unknown` is only the top: it fits only `unknown`. The join uses this strict form.
 *
 * When the rules of the shapes refuse a type with few members, the finite rule tests each member (TYPE.FITS-FINITE).
 * The cover rule and the split rule come after it. Without `finite`, the call skips these three rules. The members of
 * a union in `expected` get such calls, because the call for the union tests `found` against the full union.
 *
 * The budget is the budget of the outer split, when the call is part of the work of a split (TYPE.FITS-PATH, D89).
 *
 * The walk keeps the answer of each pair of terms (D200). A call that took a record from a budget changed the budget,
 * thus the memo `pure` does not keep its answer. Its answer goes to the memo `free` when the call had no budget. It goes
 * to the memo `spent` when the budget was spent at the start. Each other answer stays out of the memos.
 */
function fitsAt(
  found: unknown,
  expected: unknown,
  domains: Readonly<Record<string, Domain>> | undefined,
  depth: number,
  gradual: boolean,
  finite: boolean,
  budget: SplitBudget | undefined,
  w: Walk,
): boolean {
  if (depth > MAX_TYPE_DEPTH) return true;
  // Two texts are no shared parts, and their rules are short.
  if (!isObject(found) && !isObject(expected)) return fitsRules(found, expected, domains, depth, gradual, finite, budget, w);
  const code = depth * 4 + (gradual ? 2 : 0) + (finite ? 1 : 0);
  const pure = recall(w.pure, found, expected, code);
  if (pure !== undefined) return pure;
  const memo = budget === undefined ? w.free : budget.left <= 0 ? w.spent : undefined;
  const known = memo === undefined ? undefined : recall(memo, found, expected, code);
  if (known !== undefined) return known;
  const cases = w.cases;
  const answer = fitsRules(found, expected, domains, depth, gradual, finite, budget, w);
  if (w.cases === cases) keep(w.pure, found, expected, code, answer);
  else if (memo !== undefined) keep(memo, found, expected, code, answer);
  return answer;
}

/** This function holds the rules of `fits` at one depth of two types, in their order. */
function fitsRules(
  found: unknown,
  expected: unknown,
  domains: Readonly<Record<string, Domain>> | undefined,
  depth: number,
  gradual: boolean,
  finite: boolean,
  budget: SplitBudget | undefined,
  w: Walk,
): boolean {
  spendTypeWork();
  const a = formOf(found, domains);
  const b = formOf(expected, domains);
  const next = depth + 1;
  if (b.t === "top" || a.t === "bottom") return true;
  if (a.t === "top") return gradual;
  if (a.t === "union") return a.members.every((item) => fitsAt(item, expected, domains, next, gradual, true, budget, w));
  if (a.t === "one") return a.values.every((item) => memberAt(item, expected, domains, next, w));
  if (b.t === "union" ? b.members.some((item) => fitsAt(found, item, domains, next, gradual, false, budget, w)) : b.t !== "bottom" && shapeFits(a, b, domains, next, gradual, budget, w)) return true;
  if (!finite || a.t === "fn") return false;
  // The finite rule: a type with few members fits when each member is a member of `expected`.
  const values = valuesOf(found, domains, next, w);
  if (values !== undefined) return values.every((value) => memberAt(value, expected, domains, next, w));
  // The cover rule: a base type fits when each domain of a cover of its line fits (D85).
  if (a.t === "base") return (b.t === "union" || b.t === "one") && lineCovered(a.name, expected, domains, depth, gradual, undefined, w);
  // The split rule: an open record, or a closed record with too many members, splits over a union or a `one` (D84, D89).
  return a.t === "record" && (b.t === "union" || (b.t === "one" && a.closed)) && splitFits(found, a, expected, domains, depth, gradual, budget, w);
}

/** The state of the cover rule for one type: the result for each domain whose covers it tested, and the steps that are left. */
interface CoverState {
  readonly held: Map<string, boolean>;
  left: number;
}

/**
 * This function is the cover rule of `fits` (TYPE.FITS-COVER, D85). A base type fits when a domain of its line has a
 * cover, and each domain of the cover fits `expected`. The function makes the state at the first domain with covers.
 */
function lineCovered(name: string, expected: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth: number, gradual: boolean, state: CoverState | undefined, w: Walk): boolean {
  let now = state;
  for (const each of lineOf(name, domains)) {
    if (!Array.isArray(domainOf(each, domains)?.covers)) continue;
    now ??= { held: new Map(), left: MAX_COVER_STEPS };
    if (covered(each, expected, domains, depth, gradual, now, w)) return true;
  }
  return false;
}

/**
 * This function tells if a cover of one domain holds the domain in `expected`. A cover that is empty, or that names
 * the domain or a name that is not under it, does not count. Each domain of a cover costs one step, and the rule
 * stops after 64 steps.
 */
function covered(name: string, expected: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth: number, gradual: boolean, state: CoverState, w: Walk): boolean {
  const known = state.held.get(name);
  if (known !== undefined) return known;
  // A domain on the way gives false until its cover holds, thus a cycle of covers ends.
  state.held.set(name, false);
  const covers: unknown = domainOf(name, domains)?.covers;
  if (!Array.isArray(covers)) return false;
  for (const cover of covers as readonly unknown[]) {
    if (!Array.isArray(cover) || cover.length === 0) continue;
    let held = true;
    for (const part of cover as readonly unknown[]) {
      state.left -= 1;
      if (state.left < 0) return false;
      if (typeof part !== "string" || part === name || !lineOf(part, domains).has(name) || !partFits(part, expected, domains, depth, gradual, state, w)) {
        held = false;
        break;
      }
    }
    if (held) {
      state.held.set(name, true);
      return true;
    }
  }
  return false;
}

/** This function tells if a domain of a cover fits `expected`. It tries the rules of the shapes, the finite rule and its own covers. */
function partFits(part: string, expected: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth: number, gradual: boolean, state: CoverState, w: Walk): boolean {
  if (fitsAt(part, expected, domains, depth, gradual, false, undefined, w)) return true;
  const values = valuesOf(part, domains, depth + 1, w);
  if (values !== undefined) return values.every((value) => memberAt(value, expected, domains, depth + 1, w));
  return lineCovered(part, expected, domains, depth, gradual, state, w);
}

/**
 * A field that the split rule can split: the path of keys to it, its cases, and if the field is optional. A value
 * split has the members of the field type. A type split has case types: the domains of a cover, or the members of a
 * union (TYPE.FITS-SPLIT-TYPE, D90). A cover split has each valid cover of the field, in the order of the line (D102).
 */
interface Split {
  readonly path: readonly string[];
  readonly values?: readonly unknown[];
  readonly types?: readonly ValueType[];
  readonly covers?: readonly (readonly string[])[];
  readonly optional: boolean;
}

/** The records that a split can still build. The outer split makes it, and each split inside its work takes from it (D89). */
interface SplitBudget {
  left: number;
}

/**
 * This function gives the fields that the split rule can split, in the order of the split (TYPE.FITS-PATH, D89). The
 * fields of the record come first, in the order of the keys. Then the paths of the next depth follow, and so on. A path
 * goes into a field only when the field is a record without a finite list. A field with a finite list of two or more
 * cases is a split. An optional field also has the absent case.
 *
 * The type splits follow each value split, in the same order (D90). A base type with a valid cover in its line splits
 * into the domains of a cover, and it tries each valid cover (D102). A union without a finite list splits into its
 * members. The prefix is the path of `a`.
 *
 * Each record of a split takes one record from a budget of 64 (D89). Thus a split reads at most the first 65 entries of
 * the list, and the list keeps only them. The search follows at most 4096 paths into records (MAX_SPLIT_PATHS, D200).
 * When a type has more paths, the search ends after the level that reaches the limit.
 */
function splitsOf(
  a: Extract<Form, { readonly t: "record" }>,
  domains: Readonly<Record<string, Domain>> | undefined,
  depth: number,
  w: Walk,
  prefix: readonly string[] = [],
): readonly Split[] {
  const out: Split[] = [];
  const later: Split[] = [];
  const most = MAX_SPLIT_RECORDS + 1;
  let paths = 0;
  let level: { readonly step: PathStep | undefined; readonly form: Extract<Form, { readonly t: "record" }> }[] = [{ step: undefined, form: a }];
  for (let at = depth + 1; level.length > 0 && at <= MAX_TYPE_DEPTH && out.length < most; at += 1) {
    const deeper: typeof level = [];
    for (const { step, form } of level) {
      for (const key of Object.keys(form.fields)) {
        const values = valuesOf(form.fields[key], domains, at, w);
        const optional = form.optional.has(key);
        if (values !== undefined) {
          if (values.length + (optional ? 1 : 0) > 1 && out.length < most) out.push({ path: pathOf(prefix, step, key), values, optional });
          continue;
        }
        const inner = formOf(form.fields[key], domains);
        if (inner.t === "record") {
          paths += 1;
          if (paths <= MAX_SPLIT_PATHS) deeper.push({ step: { up: step, key }, form: inner });
        } else if (later.length >= most) {
          continue;
        } else if (inner.t === "union") {
          later.push({ path: pathOf(prefix, step, key), types: inner.members, optional });
        } else if (inner.t === "base") {
          const covers = coversOf(inner.name, domains, false);
          if (covers.length > 0) later.push({ path: pathOf(prefix, step, key), covers, optional });
        }
      }
    }
    level = paths > MAX_SPLIT_PATHS ? [] : deeper;
  }
  const all = later.length === 0 ? out : [...out, ...later];
  return all.length > most ? all.slice(0, most) : all;
}

/** A path of `splitsOf` from the record of the split: its last key, and the path before that key. */
interface PathStep {
  readonly up: PathStep | undefined;
  readonly key: string;
}

/** This function gives the keys of a path of `splitsOf`, after the prefix, with one more key at the end. */
function pathOf(prefix: readonly string[], step: PathStep | undefined, key: string): readonly string[] {
  const keys = [key];
  for (let at = step; at !== undefined; at = at.up) keys.push(at.key);
  return [...prefix, ...keys.reverse()];
}

/** This function tells if a cover of a domain is valid by the line rule of D85. Such a cover is not empty, and each name in it is a domain under the domain. */
function validCover(name: string, cover: unknown, domains: Readonly<Record<string, Domain>> | undefined): cover is readonly string[] {
  return Array.isArray(cover) && cover.length > 0 && (cover as readonly unknown[]).every((part) => typeof part === "string" && part !== name && lineOf(part, domains).has(name));
}

/**
 * This function gives the valid covers of a base type for a type split (D90, D102). The order is the order of the line,
 * then the order of the covers of each domain. With `own`, only the domain of the type itself counts.
 */
function coversOf(name: string, domains: Readonly<Record<string, Domain>> | undefined, own: boolean): readonly (readonly string[])[] {
  const out: (readonly string[])[] = [];
  for (const each of own ? [name] : lineOf(name, domains)) {
    const covers: unknown = domainOf(each, domains)?.covers;
    if (!Array.isArray(covers)) continue;
    for (const cover of covers as readonly unknown[]) if (validCover(each, cover, domains)) out.push(cover);
  }
  return out;
}

/**
 * This function gives the splits of a case of a type split, at the path of the case (D90). A case with a finite list
 * splits by its members. A base type splits by a cover of its own domain, because the covers of its parents hold it
 * already. A union splits by its members, and a record splits by the paths into its fields.
 */
function againOf(type: ValueType, path: readonly string[], domains: Readonly<Record<string, Domain>> | undefined, depth: number, w: Walk): readonly Split[] {
  const at = depth + path.length;
  const values = valuesOf(type, domains, at, w);
  if (values !== undefined) return values.length > 1 ? [{ path, values, optional: false }] : [];
  const form = formOf(type, domains);
  if (form.t === "record") return splitsOf(form, domains, at, w, path);
  if (form.t === "union") return [{ path, types: form.members, optional: false }];
  const covers = form.t === "base" ? coversOf(form.name, domains, true) : [];
  return covers.length === 0 ? [] : [{ path, covers, optional: false }];
}

/**
 * This function gives a copy of a record type with one field narrowed at a path. A case type replaces the field. The
 * absent case removes the field of a closed record, and it gives an optional field of type `never` in an open record.
 */
function narrowAt(type: unknown, path: readonly string[], at: number, narrowed: ValueType | undefined, domains: Readonly<Record<string, Domain>> | undefined): ValueType {
  const form = formOf(type, domains);
  const key = path[at];
  if (form.t !== "record" || key === undefined) return type as ValueType;
  const last = at + 1 === path.length;
  const fields: Record<string, ValueType> = {};
  for (const name of Object.keys(form.fields)) {
    if (name !== key) setOwn(fields, name, form.fields[name] as ValueType);
    else if (!last) setOwn(fields, name, narrowAt(form.fields[name], path, at + 1, narrowed, domains));
    else if (narrowed !== undefined) setOwn(fields, name, narrowed);
    else if (!form.closed) setOwn(fields, name, "never");
  }
  // A case at the field makes it needed. The absent case of an open record keeps it optional.
  const optional = [...form.optional].filter((name) => !last || name !== key || (narrowed === undefined && !form.closed));
  return { record: fields, ...(optional.length === 0 ? {} : { optional }), ...(form.closed ? { closed: true } : {}) };
}

/**
 * What the result of a test proves of the value at one path (STATIC.OCCURRENCE, D147). The path starts at a root, or at
 * `names` and a name, and each later key is a field of a record. The fact `is` tells that the value is a member of the
 * type, and `not` tells that it is not. The facts `present` and `absent` tell if the path reaches a value.
 */
export type Proof =
  | { readonly path: readonly string[]; readonly fact: "is" | "not"; readonly type: ValueType }
  | { readonly path: readonly string[]; readonly fact: "present" | "absent" };

/** This function gives the type of a value that is a member of both types. The result is the narrower known type. */
function meetOf(type: ValueType, proved: ValueType, domains: Readonly<Record<string, Domain>> | undefined): ValueType {
  if (isUnknown(proved, domains)) return type;
  const form = formOf(type, domains);
  if (form.t === "one") return { one: form.values.filter((value) => member(value, proved, domains)) };
  return !isUnknown(type, domains) && isPrecise(type, domains) && fits(type, proved, domains) ? type : proved;
}

/** This function gives the type of a value of the first type that is not a member of the second type. */
function withoutOf(type: ValueType, removed: ValueType, domains: Readonly<Record<string, Domain>> | undefined): ValueType {
  spendTypeWork();
  if (isUnknown(removed, domains)) return type;
  const form = formOf(type, domains);
  if (form.t === "one") return { one: form.values.filter((value) => !member(value, removed, domains)) };
  if (form.t === "union") {
    const members = form.members.map((each) => withoutOf(each, removed, domains)).filter((each) => each !== "never");
    return members.length === 0 ? "never" : members.length === 1 ? (members[0] as ValueType) : { union: members };
  }
  // Only a precise type can leave: a gradual type fits each type, but its values do not.
  return isPrecise(type, domains) && fits(type, removed, domains) ? "never" : type;
}

/**
 * This function gives a type with one proof at a path (STATIC.OCCURRENCE). A path that leaves the records of the type
 * gives the type back. A fact about a field also tells if the field exists. A value of a type without `undefined`
 * exists. An optional field without a remaining type does not.
 *
 * @param type - The type of the value at the first `at` keys of the path.
 * @param proof - The proof.
 * @param at - The number of keys of the path that the type already holds.
 * @param domains - The domains of the machine.
 * @returns The narrowed type.
 */
export function narrowType(type: ValueType, proof: Proof, at: number, domains: Readonly<Record<string, Domain>> | undefined): ValueType {
  if (at === proof.path.length) {
    if (proof.fact === "is") return meetOf(type, proof.type, domains);
    return proof.fact === "not" ? withoutOf(type, proof.type, domains) : type;
  }
  const form = formOf(type, domains);
  const key = proof.path[at] as string;
  if (form.t !== "record" || !Object.hasOwn(form.fields, key)) return type;
  const before = form.fields[key] as ValueType;
  const optional = new Set(form.optional);
  let after: ValueType | undefined = narrowType(before, proof, at + 1, domains);
  if (at + 1 === proof.path.length && optional.has(key)) {
    if (proof.fact === "present" || (proof.fact === "is" && !member(undefined, proof.type, domains))) optional.delete(key);
    else if (proof.fact === "absent" || after === "never") after = undefined;
  }
  const fields: Record<string, ValueType> = {};
  for (const name of Object.keys(form.fields)) if (name !== key) setOwn(fields, name, form.fields[name] as ValueType);
  // The absent case removes the field of a closed record. An open record keeps it as an optional field of the type `never`.
  if (after !== undefined) setOwn(fields, key, after);
  else if (form.closed) optional.delete(key);
  else setOwn(fields, key, "never");
  return { record: fields, ...(optional.size === 0 ? {} : { optional: [...optional] }), ...(form.closed ? { closed: true } : {}) };
}

/**
 * This function is the split rule of `fits` (TYPE.FITS-FINITE, D84, TYPE.FITS-PATH, D89). A record type fits when each
 * record of its split fits. A split takes the first field in the order of `splitsOf`. Each member of the field gives a
 * record with the field narrowed to that member. An optional field also gives a record without the field. A type split
 * narrows the field to each case type instead (TYPE.FITS-SPLIT-TYPE, D90).
 *
 * A record of the split that does not fit splits the next such field. A record of a type split first splits its case
 * again, at the same path. One budget of 64 records serves the outer split and each split inside its work, at each
 * depth. Thus nested splits do not multiply the work.
 *
 * A cover split tries each valid cover of its field until one fits (D102). Each try takes from the same budget.
 */
function splitFits(
  found: unknown,
  a: Extract<Form, { readonly t: "record" }>,
  expected: unknown,
  domains: Readonly<Record<string, Domain>> | undefined,
  depth: number,
  gradual: boolean,
  budget: SplitBudget | undefined,
  w: Walk,
): boolean {
  const splits = splitsOf(a, domains, depth, w);
  if (splits.length === 0) return false;
  return casesFit(found as ValueType, a.closed, splits, 0, expected, domains, depth, gradual, budget ?? { left: MAX_SPLIT_RECORDS }, w);
}

/** This function tells if each record of the split of one field fits `expected`. It splits the next field for a record that does not fit. */
function casesFit(
  type: ValueType,
  closed: boolean,
  splits: readonly Split[],
  index: number,
  expected: unknown,
  domains: Readonly<Record<string, Domain>> | undefined,
  depth: number,
  gradual: boolean,
  budget: SplitBudget,
  w: Walk,
): boolean {
  const split = splits[index];
  if (split === undefined) return false;
  // A cover split tries each valid cover in its order. A failed try keeps the records that it took from the budget (D102).
  if (split.covers !== undefined) {
    for (const cover of split.covers) {
      const tried = [...splits];
      tried[index] = { path: split.path, types: cover, optional: split.optional };
      if (casesFit(type, closed, tried, index, expected, domains, depth, gradual, budget, w)) return true;
    }
    return false;
  }
  const types: readonly ValueType[] = split.values?.map((value) => ({ one: [value as Json] })) ?? split.types ?? [];
  const cases: ValueType[] = types.map((each) => narrowAt(type, split.path, 0, each, domains));
  if (split.optional) cases.push(narrowAt(type, split.path, 0, undefined, domains));
  for (const [at, record] of cases.entries()) {
    budget.left -= 1;
    // The count tells the memo of `fitsAt` that the answer of a call depends on the budget (D200).
    w.cases += 1;
    if (budget.left < 0) return false;
    // The rules of the shapes first, then the finite rule for a closed record, then the split of the next field.
    if (fitsAt(record, expected, domains, depth, gradual, false, budget, w)) continue;
    const values = closed ? valuesOf(record, domains, depth + 1, w) : undefined;
    if (values !== undefined) {
      if (values.every((value) => memberAt(value, expected, domains, depth + 1, w))) continue;
      return false;
    }
    // A case of a type split splits again at its path, before the next split (D90).
    const again = split.types !== undefined && at < split.types.length ? againOf(split.types[at] as ValueType, split.path, domains, depth, w) : [];
    const rest = again.length === 0 ? splits : [...again, ...splits.slice(index + 1)];
    if (!casesFit(record, closed, rest, again.length === 0 ? index + 1 : 0, expected, domains, depth, gradual, budget, w)) return false;
  }
  return true;
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
 * - The finite rule comes after these rules (TYPE.FITS-FINITE). A type with at most 64 members fits when each member
 *   is a member of `expected`. Thus `bool` fits `{ "one": [true, false] }`.
 * - A base type has few members when its domain or a parent declares `values`, as `null`, `undefined` and `bool` do.
 *   A union, a `one`, a closed record of such types and a list of `never` also have few members.
 * - The cover rule comes next (TYPE.FITS-COVER, D85). A base type fits a union or a `one` when each domain of a cover
 *   fits. The cover is in `covers` of a domain of its line. Each domain of a cover is under the covered
 *   domain. Thus a cover of `number` by `neg` and `nonneg` gives `number` a fit against `neg | nonneg`.
 * - The split rule comes last (D84). An open record, or a closed record with more than 64 members, splits a field with
 *   few members over a union. A closed record also splits over a `one`. Each record of the split narrows the field to
 *   one member, and each record must fit.
 *   Thus `{ "record": { "a": "bool" } }` fits a union of a record for each value of `a`.
 * - A split also narrows a field of a record in a field, by its path (TYPE.FITS-PATH, D89). The fields of the record
 *   split first, then the paths of each next depth, in the order of the keys. A path goes into a record without a
 *   finite list. Thus `{a: {x: bool}}` fits the union of `{a: {x: true}}` and `{a: {x: false}}`.
 * - A type split comes after each value split (TYPE.FITS-SPLIT-TYPE, D90). A field of a base type with a valid cover in
 *   its line splits into the domains of a cover. A field of a union without a finite list splits into its
 *   members. A case that does not fit splits again at its path, by the same rules. A base type there uses only the
 *   covers of its own domain. Thus `{a: number}` fits `{a: neg} | {a: nonneg}` when `neg` and `nonneg` cover `number`.
 * - A field with more than one valid cover tries each cover until one fits (TYPE.FITS-SPLIT-COVERS, D102). The order
 *   is the order of the line, then the order of the covers of each domain.
 *
 * The relation is sound: a member of `found` is a member of `expected` when no `unknown` is in the types
 * (TYPE.FITS-SOUND). The finite rule trusts `values`, and the cover rule trusts `covers`. Thus a list without a member
 * or a false cover makes the relation unsound for that domain.
 *
 * The relation is not complete. A split builds at most 64 records, with each split inside its work at each depth. The
 * failed tries of covers take from these 64 records too. A domain without `values` gets no finite rule, and
 * neither does a type with more than 64 members that is not a record. The cover rule tests at most 64 domains of
 * covers. The function does not throw.
 *
 * A call outside a pass of types is a pass of its own, with the limit `WORK_LIMIT` (TYPE.WORK, D207). Past the limit,
 * the function reads the types as `unknown`, thus it gives `true`. Inside a pass, the pass stops with `#WORK!`.
 *
 * @param found - The type that a part has.
 * @param expected - The type that the position needs.
 * @param domains - The domains of the machine. A domain of the kernel that the table does not name comes from `STD_DOMAINS`.
 * @returns `true` when `found` fits `expected`.
 */
export function fits(found: ValueType, expected: ValueType, domains?: Readonly<Record<string, Domain>>): boolean {
  return withTypeWork(
    WORK_LIMIT,
    () => fitsAt(found, expected, domains, 0, true, true, undefined, newWalk()),
    () => true,
  );
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
  w: Walk,
): ValueType {
  const closed = a.closed && b.closed;
  const fields: Record<string, ValueType> = {};
  const optional: string[] = [];
  const keys = [...Object.keys(a.fields), ...Object.keys(b.fields).filter((key) => !Object.hasOwn(a.fields, key))];
  for (const key of keys) {
    const inA = Object.hasOwn(a.fields, key);
    const inB = Object.hasOwn(b.fields, key);
    if (inA && inB) {
      setOwn(fields, key, joinAt(a.fields[key], b.fields[key], domains, depth, w));
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
function unionOf(types: readonly unknown[], domains: Readonly<Record<string, Domain>> | undefined, depth: number, w: Walk): ValueType {
  const members: unknown[] = [];
  const values: Json[] = [];
  let valuesAt = -1;
  const add = (type: unknown, level: number): void => {
    spendTypeWork();
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
    if (kept.some((item) => fitsAt(member, item, domains, depth, false, true, undefined, w))) continue;
    for (let index = kept.length - 1; index >= 0; index -= 1) if (fitsAt(kept[index], member, domains, depth, false, true, undefined, w)) kept.splice(index, 1);
    kept.push(member);
  }
  if (kept.length === 0) return "never";
  return kept.length === 1 ? (kept[0] as ValueType) : { union: kept as ValueType[] };
}

/**
 * This function is the join at one depth of two types. The walk keeps the join of each pair of terms (D200). Thus the
 * join of two types that share their parts shares its parts too.
 */
function joinAt(a: unknown, b: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth: number, w: Walk): ValueType {
  if (depth > MAX_TYPE_DEPTH) return "unknown";
  if (!isObject(a) && !isObject(b)) return joinRules(a, b, domains, depth, w);
  const known = recall(w.joins, a, b, depth);
  if (known !== undefined) return known;
  const answer = joinRules(a, b, domains, depth, w);
  keep(w.joins, a, b, depth, answer);
  return answer;
}

/** This function holds the rules of the join at one depth of two types, in their order. */
function joinRules(a: unknown, b: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth: number, w: Walk): ValueType {
  spendTypeWork();
  const fa = formOf(a, domains);
  const fb = formOf(b, domains);
  if (fa.t === "top" || fb.t === "top") return "unknown";
  if (fa.t === "bottom") return b as ValueType;
  if (fb.t === "bottom") return a as ValueType;
  // The strict form keeps the join sound: a type with `unknown` inside is not under a type without it.
  if (fitsAt(a, b, domains, depth, false, true, undefined, w)) return b as ValueType;
  if (fitsAt(b, a, domains, depth, false, true, undefined, w)) return a as ValueType;
  const next = depth + 1;
  if (fa.t === "list" && fb.t === "list") return { list: joinAt(fa.item, fb.item, domains, next, w) };
  if (fa.t === "record" && fb.t === "record") return joinRecords(fa, fb, domains, next, w);
  return unionOf([a, b], domains, next, w);
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
 * A call outside a pass of types is a pass of its own, with the limit `WORK_LIMIT` (TYPE.WORK, D207). Past the limit,
 * the join is `unknown`. Inside a pass, the pass stops with `#WORK!`.
 *
 * @param a - The first type.
 * @param b - The second type.
 * @param domains - The domains of the machine. A domain of the kernel that the table does not name comes from `STD_DOMAINS`.
 * @returns The join.
 */
export function join(a: ValueType, b: ValueType, domains?: Readonly<Record<string, Domain>>): ValueType {
  return withTypeWork(
    WORK_LIMIT,
    () => joinAt(a, b, domains, 0, newWalk()),
    () => "unknown",
  );
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

/** The most characters of the text of a type (TYPE.TEXT, D200). A longer text ends with "…". */
const MAX_TEXT_LENGTH = 4096;

/** The characters that the text of a type can still take. */
interface Room {
  left: number;
}

/** This function takes the characters of a text from the room, and it gives the text. */
function take(room: Room, text: string): string {
  room.left -= text.length;
  return text;
}

/**
 * This function gives the text of a type at one depth. `wrap` puts a union or a function type in brackets.
 *
 * Each term takes its own characters from the room before its parts, and a term does not take more than it writes. Thus
 * a text of at most 4096 characters does not change. When the room is spent, each next term gives "…". A type that
 * shares its parts can have a text for each way through it, and the room ends such a walk (D200).
 */
function textAt(type: unknown, depth: number, wrap: boolean, room: Room): string {
  if (room.left < 0) return "…";
  if (depth > MAX_TYPE_DEPTH) return take(room, "unknown");
  if (typeof type === "string") return take(room, type);
  const term = isRecord(type) ? termOf(type) : undefined;
  if (!isRecord(type) || term === undefined) return take(room, "unknown");
  const next = depth + 1;
  const group = (items: readonly string[]): string => (items.length === 0 ? "never" : items.length > 1 && wrap ? `(${items.join(" | ")})` : items.join(" | "));
  if (term === "list") {
    room.left -= "list<>".length;
    return `list<${textAt(type["list"], next, false, room)}>`;
  }
  if (term === "union") {
    if (!Array.isArray(type["union"])) return take(room, "unknown");
    const members = type["union"] as readonly unknown[];
    room.left -= members.length === 0 ? "never".length : members.length === 1 ? 0 : " | ".length * (members.length - 1) + (wrap ? 2 : 0);
    return group(members.map((item) => textAt(item, next, true, room)));
  }
  if (term === "one") {
    if (!Array.isArray(type["one"])) return take(room, "unknown");
    const values = type["one"] as readonly unknown[];
    const shown = values.slice(0, MAX_TEXT_VALUES).map(valueText);
    return take(room, group(values.length > MAX_TEXT_VALUES ? [...shown, `… ${values.length - MAX_TEXT_VALUES} more`] : shown));
  }
  if (term === "fn") {
    if (!Array.isArray(type["fn"])) return take(room, "unknown");
    const params = type["fn"] as readonly unknown[];
    room.left -= "() => ".length + ", ".length * Math.max(params.length - 1, 0) + (wrap ? 2 : 0);
    const text = `(${params.map((item) => textAt(item, next, false, room)).join(", ")}) => ${textAt(type["to"], next, true, room)}`;
    return wrap ? `(${text})` : text;
  }
  const fields = type["record"];
  if (!isRecord(fields)) return take(room, "unknown");
  const optional = Array.isArray(type["optional"]) ? (type["optional"] as readonly unknown[]) : [];
  const keys = Object.keys(fields);
  const names = keys.map((key) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)));
  // The brackets, and each name with its ": ".
  room.left -= names.reduce((sum, name) => sum + name.length + ": ".length, "{}".length);
  const items = keys.map((key, index) => `${names[index] as string}${optional.includes(key) ? "?" : ""}: ${textAt(fields[key], next, false, room)}`);
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
 * The text shows at most 8 values of `one`, and it cuts a long value. The text has at most 4096 characters. A longer
 * text has 4096 characters, and it ends with "…". It can show "…" in place of other parts too (D200).
 *
 * @param type - The value type.
 * @returns The text.
 */
export function typeText(type: ValueType): string {
  const text = textAt(type, 0, false, { left: MAX_TEXT_LENGTH });
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH - 1)}…` : text;
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
  spendTypeWork();
  const form = formOf(type, domains);
  if (form.t === "top" || form.t === "bottom" || form.t === "fn") return true;
  if (form.t === "union") return form.members.every((item) => callable(item, domains, depth + 1));
  return form.t === "one" && form.values.length === 0;
}

/**
 * This function tells if a type has no `unknown` at any depth. Then `fits` decides it without the gradual rule. The
 * memo keeps the answer of each term at each depth, for a type that shares its parts (D200).
 */
export function isPrecise(type: unknown, domains: Readonly<Record<string, Domain>> | undefined, depth = 0, memo: DepthMemo<boolean> = new Map()): boolean {
  if (depth > MAX_TYPE_DEPTH) return false;
  if (!isObject(type)) return formOf(type, domains).t !== "top";
  const known = recallAt(memo, type, depth);
  if (known !== undefined) return known;
  spendTypeWork();
  const form = formOf(type, domains);
  const next = depth + 1;
  let answer: boolean;
  switch (form.t) {
    case "top":
      answer = false;
      break;
    case "list":
      answer = isPrecise(form.item, domains, next, memo);
      break;
    case "record":
      answer = Object.keys(form.fields).every((key) => isPrecise(form.fields[key], domains, next, memo));
      break;
    case "fn":
      answer = form.params.every((item) => isPrecise(item, domains, next, memo)) && isPrecise(form.to, domains, next, memo);
      break;
    case "union":
      answer = form.members.every((item) => isPrecise(item, domains, next, memo));
      break;
    default:
      answer = true;
  }
  keepAt(memo, type, depth, answer);
  return answer;
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
  spendTypeWork();
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
 * - A list gives the type of its items for an index, and `number` for `length`. Another key has no such step.
 * - A base type reads the steps of its domain, then of each parent (`Domain.steps`). A base type of the kernel
 *   without such a step has no step, because its values are not objects (TYPE.NO-STEP, D120).
 * - A function type has no step, because a step into a function reaches nothing.
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
  spendTypeWork();
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
      // A value of a base type of the kernel is not an object, thus a step into it reaches nothing (TYPE.NO-STEP).
      return Object.hasOwn(STD_DOMAINS, form.name) ? NO_STEP : { type: "unknown" };
    case "fn":
      return NO_STEP;
    case "list":
      if (key === "length") return { type: "number" };
      return indexOf(key) >= 0 ? { type: form.item } : NO_STEP;
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

/** The answer of `stepType` for a type whose members have no step with the key, and no fields to name. */
const NO_STEP: StepType = { missing: [] };

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
 * A type that a host builds can share a term between two places. Such a term gives its problems one time, at its first
 * place in the order of the term, for each depth where it is (D200).
 *
 * @param type - The value type, as JSON.
 * @param domains - The domains of the machine. A domain of the kernel that the table does not name comes from `STD_DOMAINS`.
 * @returns The problems. A term comes before its parts, and the parts keep their order.
 */
export function typeIssues(type: unknown, domains?: Readonly<Record<string, Domain>>): readonly TypeIssue[] {
  const issues: TypeIssue[] = [];
  const stack: Pending[] = [{ type, at: [], depth: 0 }];
  const seen = new Map<object, Set<number>>();
  while (stack.length > 0) {
    const { type: here, at, depth } = stack.pop() as Pending;
    const issue = (reason: string, where: readonly Key[] = at): void => {
      issues.push({ at: where, reason });
    };
    if (isObject(here)) {
      const depths = seen.get(here) ?? new Set<number>();
      if (depths.has(depth)) continue;
      seen.set(here, depths.add(depth));
    }
    spendTypeWork();
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
