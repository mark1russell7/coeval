import { type Envelope, type Json, type Key, docEquals, isEnvelope, isRecord, typeName, typePath } from "./doc.ts";
import { type Kind, type LazyRule, type NamesSource, type ScopeRule, type Shape, type World, lookupKind } from "./world.ts";
import type { ValueType } from "./types.ts";

/** One part of a value: its place in the value, the JSON of the part, and the type that its position declares. */
export interface PartSlot {
  /** The keys from the value of the document to the part. */
  readonly path: readonly Key[];
  /** The path as one text, with a dot between the keys, for example `bind.x`. A part of a list has its index. */
  readonly key: string;
  readonly item: Json;
  readonly of?: string;
  /** `true` when the position of the part declares an address: a reference there gives what its path reaches. */
  readonly address?: true;
  /** The value type that the shape declares for the part (`expect`). Only a check of types reads it. */
  readonly expect?: ValueType;
}

type Template =
  | { readonly t: "data"; readonly value: unknown }
  | { readonly t: "slot"; readonly index: number }
  | { readonly t: "list"; readonly items: readonly Template[] }
  | { readonly t: "record"; readonly fields: readonly (readonly [string, Template])[] };

/** The value of a document, split into its parts, by the shape that its kind declares. */
export type Split =
  | {
      readonly ok: true;
      /** The parts, in the order of the value. */
      readonly parts: readonly PartSlot[];
      /** The value without the parts: a field that holds a part is not in it, and a list of parts gives `null`. */
      readonly data: Json;
      /**
       * This function gives the value with a handle in the place of each part.
       *
       * @param handles - One handle for each part, in the order of `parts`.
       * @returns The value with the handles.
       */
      fill<P>(handles: readonly P[]): unknown;
    }
  | { readonly ok: false; readonly reason: string; readonly at: readonly Key[] };

class Bad {
  readonly reason: string;
  readonly at: readonly Key[];

  constructor(reason: string, at: readonly Key[]) {
    this.reason = reason;
    this.at = at;
  }
}

/** This function sets an own data property. Only the key `__proto__` needs `defineProperty`. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === "__proto__") Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

const NO_SLOTS: readonly PartSlot[] = /* @__PURE__ */ Object.freeze([]);

function hasSlots(template: Template): boolean {
  return template.t !== "data";
}

/** This function gives the shape of a part with the default type `of` and the value type `expect` of its container. */
function termOf(of: string | undefined, expect: ValueType | undefined): Shape {
  return { shape: "term", ...(of === undefined ? {} : { of }), ...(expect === undefined ? {} : { expect }) };
}

/** This function tells if a shape holds only data: no value of the shape can hold a part. */
function isData(shape: Shape): boolean {
  return shape.shape === "none" || shape.shape === "text" || shape.shape === "number" || shape.shape === "one";
}

/** This function gives the reason why a value is not data of a shape, or `undefined` when it is. */
function dataFault(spec: Extract<Shape, { readonly shape: "text" | "number" | "one" }>, item: Json): string | undefined {
  if (spec.shape === "text") return typeof item === "string" ? undefined : "The value must be a text.";
  if (spec.shape === "one") return spec.values.some((value) => docEquals(value, item)) ? undefined : `The value must be one of ${JSON.stringify(spec.values)}.`;
  if (typeof item !== "number") return "The value must be a number.";
  if (spec.whole === true && !Number.isInteger(item)) return "The value must be a whole number.";
  if (spec.min !== undefined && !(item >= spec.min)) return `The value must be ${String(spec.min)} or more.`;
  if (spec.max !== undefined && !(item <= spec.max)) return `The value must be ${String(spec.max)} or less.`;
  return undefined;
}

/** This function stops a split when a part has a type that its position does not permit. */
function kindFault(kinds: readonly (readonly Key[])[], item: Json, of: string | undefined, path: readonly Key[]): void {
  const type = isEnvelope(item) ? typePath(item.type) : of === undefined ? undefined : [of];
  const fits = type !== undefined && kinds.some((kind) => kind.length <= type.length && kind.every((key, index) => String(key) === String(type[index])));
  if (fits) return;
  const names = kinds.map((kind) => kind.join(".")).join(", ");
  const what = isEnvelope(item) ? `The kind ${typeName(item.type)} is not permitted here.` : "A value without an envelope is not permitted here.";
  throw new Bad(`${what} The permitted kinds are ${names}.`, path);
}

/**
 * The shape of each field of a record shape whose `fields` is a list of names, by the record shape (K297). Each name
 * gets a part with the type `of` and the value type `expect` of the record. A split reads the table of its shape, thus
 * it does not make the table again for each value. The shapes of a world do not change, thus a table stays correct.
 */
const NAMED_FIELDS = /* @__PURE__ */ new WeakMap<Shape, Readonly<Record<string, Shape>>>();

/** This function gives the shape of each field of a record shape, by the name of the field. */
function namedFields(spec: Extract<Shape, { readonly shape: "record" }>): Readonly<Record<string, Shape>> {
  if (!Array.isArray(spec.fields)) return spec.fields as Readonly<Record<string, Shape>>;
  let named = NAMED_FIELDS.get(spec);
  if (named === undefined) {
    named = Object.fromEntries((spec.fields as readonly string[]).map((name) => [name, termOf(spec.of, spec.expect)]));
    NAMED_FIELDS.set(spec, named);
  }
  return named;
}

/**
 * This function adds a part to the parts of a split, and gives the template of its place in the value. The functions
 * of a split are module functions, thus a split makes no function for each value (K297). A part gets the fields `of`,
 * `address` and `expect` only with a value, in that order, with no spread copy.
 */
function slotOf(parts: PartSlot[], item: Json, path: readonly Key[], of: string | undefined, address: boolean, expect: ValueType | undefined): Template {
  const part: { -readonly [K in keyof PartSlot]: PartSlot[K] } = { path, key: path.join("."), item };
  if (of !== undefined) part.of = of;
  if (address) part.address = true;
  if (expect !== undefined) part.expect = expect;
  parts.push(part);
  return { t: "slot", index: parts.length - 1 };
}

/** This function gives the template of a value of the shape `deep`: each envelope in the value is a part. */
function deepOf(parts: PartSlot[], item: Json, path: readonly Key[], of: string | undefined, expect: ValueType | undefined): Template {
  if (isEnvelope(item)) return slotOf(parts, item, path, of, false, expect);
  if (Array.isArray(item)) {
    const items = (item as readonly Json[]).map((child, index) => deepOf(parts, child, [...path, index], of, expect));
    return items.some(hasSlots) ? { t: "list", items } : { t: "data", value: item };
  }
  if (isRecord(item)) {
    const fields = Object.keys(item).map((key) => [key, deepOf(parts, item[key] as Json, [...path, key], of, expect)] as const);
    return fields.some(([, child]) => hasSlots(child)) ? { t: "record", fields } : { t: "data", value: item };
  }
  return { t: "data", value: item };
}

/**
 * This function gives the template of a value by its shape. It adds each part to `parts`, in the order of the value.
 * It throws `Bad` for a value without the shape.
 */
function templateOf(parts: PartSlot[], spec: Shape | undefined, item: Json, path: readonly Key[]): Template {
  if (spec === undefined || spec.shape === "none") return { t: "data", value: item };
  if (spec.shape === "text" || spec.shape === "number" || spec.shape === "one") {
    const reason = dataFault(spec, item);
    if (reason !== undefined) throw new Bad(reason, path);
    return { t: "data", value: item };
  }
  if (spec.shape === "term") {
    if (spec.kinds !== undefined) kindFault(spec.kinds, item, spec.of, path);
    return slotOf(parts, item, path, spec.of, spec.address === true, spec.expect);
  }
  if (spec.shape === "deep") return deepOf(parts, item, path, spec.of, spec.expect);
  if (spec.shape === "list") {
    if (!Array.isArray(item)) throw new Bad("The value must be a list.", path);
    const list = item as readonly Json[];
    if (spec.distinct === true) {
      const twice = list.findIndex((child, index) => list.slice(0, index).some((before) => docEquals(before, child)));
      if (twice !== -1) throw new Bad("The items of the list must be different.", [...path, twice]);
    }
    const each: Shape = spec.item ?? termOf(spec.of, spec.expect);
    const items = list.map((child, index) => templateOf(parts, each, child, [...path, index]));
    // A list of data is data, also when it is empty. Only a list that can hold parts gives null in the data.
    return isData(each) ? { t: "data", value: item } : { t: "list", items };
  }
  if (!isRecord(item)) throw new Bad("The value must be a record.", path);
  if (spec.shape === "map") {
    const each: Shape = spec.item ?? termOf(spec.of, spec.expect);
    return { t: "record", fields: Object.keys(item).map((key) => [key, templateOf(parts, each, item[key] as Json, [...path, key])] as const) };
  }
  for (const name of spec.required ?? []) {
    if (!Object.hasOwn(item, name)) throw new Bad(`The field ${name} is missing.`, path);
  }
  const named = namedFields(spec);
  const fields: (readonly [string, Template])[] = [];
  for (const key of Object.keys(item)) {
    if (spec.closed === true && !Object.hasOwn(named, key)) throw new Bad(`The field ${key} is not a field of this kind.`, [...path, key]);
    const fieldShape = Object.hasOwn(named, key) ? named[key] : spec.rest;
    fields.push([key, templateOf(parts, fieldShape, item[key] as Json, [...path, key])]);
  }
  return { t: "record", fields };
}

/** This function gives the value of a template without the parts. A list that holds only parts gives `null`. */
function dataOf(node: Template): Json | undefined {
  if (node.t === "data") return node.value as Json;
  if (node.t === "slot") return undefined;
  if (node.t === "list") return node.items.every((child) => child.t === "slot") ? null : (node.items.map((child) => dataOf(child) ?? null) as Json);
  const out: Record<string, Json> = {};
  for (const [key, child] of node.fields) {
    const kept = dataOf(child);
    if (kept !== undefined) setOwn(out, key, kept);
  }
  return out;
}

/** This function gives the value of a template with a handle in the place of each part. */
function fillOf<P>(node: Template, handles: readonly P[]): unknown {
  if (node.t === "data") return node.value;
  if (node.t === "slot") return handles[node.index];
  if (node.t === "list") return node.items.map((child) => fillOf(child, handles));
  const out: Record<string, unknown> = {};
  for (const [key, child] of node.fields) setOwn(out, key, fillOf(child, handles));
  return out;
}

/**
 * This function splits a value into its parts, by the shape that its kind declares. The evaluator, the view and
 * the static kit use the same split, thus each one sees the same parts.
 *
 * @param shape - The shape of the value. The default is data.
 * @param value - The value of the document.
 * @returns The parts and a way to fill their places, or the reason why the value does not have the shape.
 */
export function splitParts(shape: Shape | undefined, value: Json): Split {
  // A value without parts is data: the split needs no template.
  if (shape === undefined || shape.shape === "none") return { ok: true, parts: NO_SLOTS, data: value, fill: () => value };
  const parts: PartSlot[] = [];
  let template: Template;
  try {
    template = templateOf(parts, shape, value, []);
  } catch (error) {
    if (error instanceof Bad) return { ok: false, reason: error.reason, at: error.at };
    throw error;
  }
  return { ok: true, parts, data: dataOf(template) ?? null, fill: (handles) => fillOf(template, handles) };
}

/**
 * The kind and the parts of one document: what `partsOf` gives. `ok` is `false` only when the value is not a
 * document: it has no envelope, and its position declares no type. A value without the shape of its kind gives a
 * failed `split`.
 */
export type DocParts =
  | {
      readonly ok: true;
      /** The document. A bare value gets the type that its position declares. */
      readonly doc: Envelope;
      /** `true` when the type came from the position and not from an envelope. */
      readonly declared: boolean;
      /** The kind, or `undefined` when the world has no kind for the type. Then the value is data. */
      readonly kind: Kind | undefined;
      /** The keys of the kind after each alias, or `undefined` without a kind. */
      readonly typePath: readonly Key[] | undefined;
      /**
       * The split of the value by the shape of the kind. The reason of a failed split is the reason of the `#VALUE!`
       * of an evaluation: it names the kind. Its `at` gives the keys from the value to the problem.
       */
      readonly split: Split;
    }
  | { readonly ok: false; readonly code: "#PART?"; readonly reason: string };

/**
 * This function reads one document by the contracts of the world. It finds the kind of the type. A bare value gets
 * the type that its position declares. Then the function splits the value by the shape of the kind. The plan, the
 * reference interpreter and the static kit read each document with this function. Thus they see the same parts.
 *
 * @param world - The world of the kinds.
 * @param value - The document, or a bare value.
 * @param declaredType - The type that the position of a bare value declares.
 * @returns The document, its kind and its parts, or the reason why the value is not a document.
 */
export function partsOf(world: World, value: unknown, declaredType?: string): DocParts {
  const envelope = isEnvelope(value) ? (value as Envelope) : undefined;
  if (envelope === undefined && declaredType === undefined) return { ok: false, code: "#PART?", reason: "The value has no envelope, and its position declares no type." };
  const doc: Envelope = envelope ?? { type: declaredType as string, value: value as Json };
  const found = lookupKind(world, doc.type);
  const kind = found.ok ? found.kind : undefined;
  const split = splitParts(kind?.parts, doc.value);
  const typePath = found.ok ? found.path : undefined;
  if (split.ok) return { ok: true, doc, declared: envelope === undefined, kind, typePath, split };
  // The reason names the place in the value and the kind, as each reader of the document gives it.
  const where = split.at.length === 0 ? "" : ` (at ${split.at.join(".")})`;
  const reason = `${split.reason}${where} The kind is ${typeName(doc.type)}.`;
  return { ok: true, doc, declared: envelope === undefined, kind, typePath, split: { ok: false, reason, at: split.at } };
}

/**
 * This function tells if the path of a part matches a pattern of a scope rule. The key `"*"` of a pattern matches
 * each key.
 *
 * @param path - The path of the part.
 * @param pattern - The pattern.
 * @returns `true` when the path matches.
 */
export function pathMatches(path: readonly Key[], pattern: readonly Key[]): boolean {
  if (path.length !== pattern.length) return false;
  for (let index = 0; index < path.length; index += 1) {
    const want = pattern[index];
    if (want !== "*" && String(want) !== String(path[index])) return false;
  }
  return true;
}

/**
 * This function tells if a list of rules in the form of the lazy rules covers a part (D24, D119). A rule without
 * `in` covers each part. With `after: n`, a rule covers only the parts after the first `n` parts that it matches.
 *
 * @param rules - The rules.
 * @param shape - The shape of the parts of the parent.
 * @param value - The value of the parent.
 * @param slot - The path of the part in the value.
 * @returns `true` when a rule covers the part.
 */
export function rulesCover(rules: readonly LazyRule[], shape: Shape | undefined, value: Json, slot: readonly Key[]): boolean {
  for (const rule of rules) {
    if (rule.in !== undefined && !rule.in.some((pattern) => pathMatches(slot, pattern))) continue;
    const after = rule.after ?? 0;
    if (after <= 0) return true;
    const split = splitParts(shape, value);
    let count = 0;
    for (const part of split.ok ? split.parts : []) {
      if (rule.in !== undefined && !rule.in.some((pattern) => pathMatches(part.path, pattern))) continue;
      if (part.path.length === slot.length && pathMatches(part.path, slot)) {
        if (count >= after) return true;
        break;
      }
      count += 1;
    }
  }
  return false;
}

function valueAt(value: unknown, path: readonly Key[]): unknown {
  let here: unknown = value;
  for (const key of path) {
    if (Array.isArray(here)) here = here[Number(key)];
    else if (isRecord(here) && Object.hasOwn(here, String(key))) here = here[String(key)];
    else return undefined;
  }
  return here;
}

function headerName(item: Json): string | undefined {
  return isEnvelope(item) && typeof (item as { readonly name?: unknown }).name === "string" ? (item as { readonly name: string }).name : undefined;
}

function namesOf(source: NamesSource, value: unknown, covered: readonly PartSlot[]): readonly string[] {
  if ("fixed" in source) return source.fixed;
  if ("keysAt" in source) {
    const at = valueAt(value, source.keysAt);
    return isRecord(at) ? Object.keys(at) : [];
  }
  if ("listAt" in source) {
    const at = valueAt(value, source.listAt);
    return Array.isArray(at) ? (at as readonly unknown[]).filter((item): item is string => typeof item === "string") : [];
  }
  if ("textAt" in source) {
    const at = valueAt(value, source.textAt);
    if (typeof at === "string") return [at];
    return source.otherwise === undefined ? [] : [source.otherwise];
  }
  return covered.map((slot) => headerName(slot.item)).filter((name): name is string => name !== undefined);
}

/**
 * How a scope rule gives its names. The mode `all` gives the names to each part that the rule covers. The mode `after`
 * gives them to each covered part after the first. The mode `headers` gives each step the names in the headers of the
 * steps before it.
 */
type Mode = "all" | "after" | "headers";

/** One scope rule of a layer, read one time for all the parts of the document. */
interface LayerRule {
  readonly mode: Mode;
  /** The position of each part among the parts that the rule covers, or -1 for a part that the rule does not cover. */
  readonly at: Int32Array;
  /** The names of the modes `all` and `after`, in their order. */
  readonly names: readonly string[];
  readonly set: ReadonlySet<string>;
  /** The mode `headers`: the name in the header of each covered part, or `undefined`. */
  readonly headers: readonly (string | undefined)[];
  /** The mode `headers`: the count of the names before each position. It has one more item than the covered parts. */
  readonly before: Int32Array;
  /** The mode `headers`: the first position and the last position of each name. */
  readonly first: ReadonlyMap<string, number>;
  readonly last: ReadonlyMap<string, number>;
}

/** A function that adds 1 to the count of a name, or that subtracts 1 from it. */
export type NameCount = (name: string, change: 1 | -1) => void;

const NO_STRINGS: ReadonlySet<string> = /* @__PURE__ */ new Set();
const NO_POSITIONS: ReadonlyMap<string, number> = /* @__PURE__ */ new Map();
const NO_COUNTS: Int32Array = /* @__PURE__ */ new Int32Array(1);

/** This function gives the position of a part among the parts that a rule covers, or -1. */
function positionOf(rule: LayerRule, index: number): number {
  return index < 0 || index >= rule.at.length ? -1 : (rule.at[index] as number);
}

/**
 * The names that the scope rules of a kind give the parts of one document (STATIC.LINEAR). `check`, `conforms` and
 * the plan read the scope rules with it. A layer reads each rule one time. Then it answers for each part without a
 * list of names for each part. In a sequence, each step sees the names of the steps before it. Lists for each step
 * thus hold a count of names that is the square of the count of the steps.
 */
export class ScopeLayer {
  readonly #rules: readonly LayerRule[];

  private constructor(rules: readonly LayerRule[]) {
    this.#rules = rules;
  }

  /**
   * This function reads the scope rules of a kind for one document. The time is linear in the count of the parts and
   * in the count of the names of the rules.
   *
   * @param rules - The scope rules of the kind.
   * @param value - The value of the document.
   * @param slots - The parts of the value, in order.
   * @returns The layer, or `undefined` for a kind without scope rules.
   */
  static of(rules: readonly ScopeRule[] | undefined, value: unknown, slots: readonly PartSlot[]): ScopeLayer | undefined {
    if (rules === undefined || rules.length === 0) return undefined;
    const out: LayerRule[] = [];
    for (const rule of rules) {
      const at = new Int32Array(slots.length).fill(-1);
      const covered: PartSlot[] = [];
      slots.forEach((slot, index) => {
        if (!rule.in.some((pattern) => pathMatches(slot.path, pattern))) return;
        at[index] = covered.length;
        covered.push(slot);
      });
      if (rule.sequential === true && "headers" in rule.names) {
        const headers = covered.map((slot) => headerName(slot.item));
        const before = new Int32Array(headers.length + 1);
        const first = new Map<string, number>();
        const last = new Map<string, number>();
        headers.forEach((name, position) => {
          before[position + 1] = (before[position] as number) + (name === undefined ? 0 : 1);
          if (name === undefined) return;
          if (!first.has(name)) first.set(name, position);
          last.set(name, position);
        });
        out.push({ mode: "headers", at, names: [], set: NO_STRINGS, headers, before, first, last });
        continue;
      }
      const names = namesOf(rule.names, value, covered);
      out.push({ mode: rule.sequential === true ? "after" : "all", at, names, set: new Set(names), headers: [], before: NO_COUNTS, first: NO_POSITIONS, last: NO_POSITIONS });
    }
    return new ScopeLayer(out);
  }

  /**
   * This function tells if the rules give a part one name or more.
   *
   * @param index - The index of the part.
   * @returns `true` when the part sees a name from the rules.
   */
  seesAny(index: number): boolean {
    for (const rule of this.#rules) {
      const position = positionOf(rule, index);
      if (position < 0) continue;
      if (rule.mode === "headers" ? (rule.before[position] as number) > 0 : rule.names.length > 0 && (rule.mode === "all" || position > 0)) return true;
    }
    return false;
  }

  /**
   * This function tells if the sequential rules keep one name or more from a part for the parts after it.
   *
   * @param index - The index of the part.
   * @returns `true` when only the later parts see a name of a sequential rule.
   */
  laterAny(index: number): boolean {
    for (const rule of this.#rules) {
      const position = positionOf(rule, index);
      if (position < 0 || rule.mode === "all") continue;
      if (rule.mode === "headers" ? (rule.before[rule.headers.length] as number) > (rule.before[position] as number) : position === 0 && rule.names.length > 0) return true;
    }
    return false;
  }

  /**
   * This function tells if the rules give a name to a part. The time is linear in the count of the rules.
   *
   * @param index - The index of the part.
   * @param name - The name.
   * @returns `true` when the part sees the name.
   */
  sees(index: number, name: string): boolean {
    for (const rule of this.#rules) {
      const position = positionOf(rule, index);
      if (position < 0) continue;
      if (rule.mode === "headers" ? (rule.first.get(name) ?? position) < position : rule.set.has(name) && (rule.mode === "all" || position > 0)) return true;
    }
    return false;
  }

  /**
   * This function tells if a sequential rule keeps a name from a part for the parts after it.
   *
   * @param index - The index of the part.
   * @param name - The name.
   * @returns `true` when only the later parts see the name from a sequential rule.
   */
  hides(index: number, name: string): boolean {
    for (const rule of this.#rules) {
      const position = positionOf(rule, index);
      if (position < 0 || rule.mode === "all") continue;
      if (rule.mode === "headers" ? (rule.last.get(name) ?? -1) >= position : position === 0 && rule.set.has(name)) return true;
    }
    return false;
  }

  /**
   * This function gives the names that the rules give a part, rule by rule, in the order of each rule. A name can
   * occur two times. The time is linear in the count of these names.
   *
   * @param index - The index of the part.
   * @returns The names.
   */
  seesOf(index: number): string[] {
    const out: string[] = [];
    for (const rule of this.#rules) {
      const position = positionOf(rule, index);
      if (position < 0) continue;
      if (rule.mode === "headers") {
        for (let at = 0; at < position; at += 1) {
          const name = rule.headers[at];
          if (name !== undefined) out.push(name);
        }
      } else if (rule.mode === "all" || position > 0) for (const name of rule.names) out.push(name);
    }
    return out;
  }

  /**
   * This function gives the names that only the parts after a part see, rule by rule, in the order of each rule.
   *
   * @param index - The index of the part.
   * @returns The names.
   */
  laterOf(index: number): string[] {
    const out: string[] = [];
    for (const rule of this.#rules) {
      const position = positionOf(rule, index);
      if (position < 0 || rule.mode === "all") continue;
      if (rule.mode === "headers") {
        for (let at = position; at < rule.headers.length; at += 1) {
          const name = rule.headers[at];
          if (name !== undefined) out.push(name);
        }
      } else if (position === 0) for (const name of rule.names) out.push(name);
    }
    return out;
  }

  /**
   * This function changes the counts of the names when a walk goes from one part to another part. The index -1 is no
   * part. The time is linear in the count of the names that change. Thus a walk of the parts in their order is linear.
   *
   * @param from - The index of the part before the change.
   * @param to - The index of the part after the change.
   * @param sees - The count of the names that the part sees.
   * @param later - The count of the names that only the later parts see.
   */
  move(from: number, to: number, sees: NameCount, later?: NameCount): void {
    for (const rule of this.#rules) {
      const before = positionOf(rule, from);
      const after = positionOf(rule, to);
      if (before === after) continue;
      if (rule.mode === "all") {
        if (before >= 0 && after >= 0) continue;
        const change = after >= 0 ? 1 : -1;
        for (const name of rule.names) sees(name, change);
        continue;
      }
      if (rule.mode === "after") {
        const old = before < 0 ? undefined : before === 0 ? later : sees;
        const next = after < 0 ? undefined : after === 0 ? later : sees;
        if (old === next) continue;
        for (const name of rule.names) {
          old?.(name, -1);
          next?.(name, 1);
        }
        continue;
      }
      if (before >= 0 && after >= 0) {
        // The names between the two positions go from the later parts to the part, or back.
        const forward = after > before;
        const low = forward ? before : after;
        const high = forward ? after : before;
        for (let at = low; at < high; at += 1) {
          const name = rule.headers[at];
          if (name === undefined) continue;
          sees(name, forward ? 1 : -1);
          later?.(name, forward ? -1 : 1);
        }
        continue;
      }
      const change = after >= 0 ? 1 : -1;
      const position = after >= 0 ? after : before;
      for (let at = 0; at < rule.headers.length; at += 1) {
        const name = rule.headers[at];
        if (name === undefined) continue;
        if (at < position) sees(name, change);
        else later?.(name, change);
      }
    }
  }
}
