import { type Envelope, type Json, type Key, docEquals, isEnvelope, isRecord, typeName, typePath } from "./doc.ts";
import { type Kind, type Shape, type World, lookupKind } from "./world.ts";

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
  constructor(
    readonly reason: string,
    readonly at: readonly Key[],
  ) {}
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
  const slot = (item: Json, path: readonly Key[], of: string | undefined, address = false): Template => {
    parts.push({ path, key: path.join("."), item, ...(of === undefined ? {} : { of }), ...(address ? { address: true as const } : {}) });
    return { t: "slot", index: parts.length - 1 };
  };

  const deep = (item: Json, path: readonly Key[], of: string | undefined): Template => {
    if (isEnvelope(item)) return slot(item, path, of);
    if (Array.isArray(item)) {
      const items = (item as readonly Json[]).map((child, index) => deep(child, [...path, index], of));
      return items.some(hasSlots) ? { t: "list", items } : { t: "data", value: item };
    }
    if (isRecord(item)) {
      const fields = Object.keys(item).map((key) => [key, deep(item[key] as Json, [...path, key], of)] as const);
      return fields.some(([, child]) => hasSlots(child)) ? { t: "record", fields } : { t: "data", value: item };
    }
    return { t: "data", value: item };
  };

  const walk = (spec: Shape | undefined, item: Json, path: readonly Key[]): Template => {
    if (spec === undefined || spec.shape === "none") return { t: "data", value: item };
    if (spec.shape === "text" || spec.shape === "number" || spec.shape === "one") {
      const reason = dataFault(spec, item);
      if (reason !== undefined) throw new Bad(reason, path);
      return { t: "data", value: item };
    }
    if (spec.shape === "term") {
      if (spec.kinds !== undefined) kindFault(spec.kinds, item, spec.of, path);
      return slot(item, path, spec.of, spec.address === true);
    }
    if (spec.shape === "deep") return deep(item, path, spec.of);
    if (spec.shape === "list") {
      if (!Array.isArray(item)) throw new Bad("The value must be a list.", path);
      const list = item as readonly Json[];
      if (spec.distinct === true) {
        const twice = list.findIndex((child, index) => list.slice(0, index).some((before) => docEquals(before, child)));
        if (twice !== -1) throw new Bad("The items of the list must be different.", [...path, twice]);
      }
      const each: Shape = spec.item ?? { shape: "term", ...(spec.of === undefined ? {} : { of: spec.of }) };
      const items = list.map((child, index) => walk(each, child, [...path, index]));
      // A list of data is data, also when it is empty. Only a list that can hold parts gives null in the data.
      return isData(each) ? { t: "data", value: item } : { t: "list", items };
    }
    if (!isRecord(item)) throw new Bad("The value must be a record.", path);
    if (spec.shape === "map") {
      const each: Shape = spec.item ?? { shape: "term", ...(spec.of === undefined ? {} : { of: spec.of }) };
      return { t: "record", fields: Object.keys(item).map((key) => [key, walk(each, item[key] as Json, [...path, key])] as const) };
    }
    for (const name of spec.required ?? []) {
      if (!Object.hasOwn(item, name)) throw new Bad(`The field ${name} is missing.`, path);
    }
    const named: Readonly<Record<string, Shape>> = Array.isArray(spec.fields)
      ? Object.fromEntries((spec.fields as readonly string[]).map((name) => [name, { shape: "term", ...(spec.of === undefined ? {} : { of: spec.of }) } as Shape]))
      : (spec.fields as Readonly<Record<string, Shape>>);
    const fields: (readonly [string, Template])[] = [];
    for (const key of Object.keys(item)) {
      if (spec.closed === true && !Object.hasOwn(named, key)) throw new Bad(`The field ${key} is not a field of this kind.`, [...path, key]);
      const fieldShape = Object.hasOwn(named, key) ? named[key] : spec.rest;
      fields.push([key, walk(fieldShape, item[key] as Json, [...path, key])]);
    }
    return { t: "record", fields };
  };

  let template: Template;
  try {
    template = walk(shape, value, []);
  } catch (error) {
    if (error instanceof Bad) return { ok: false, reason: error.reason, at: error.at };
    throw error;
  }

  const strip = (node: Template): Json | undefined => {
    if (node.t === "data") return node.value as Json;
    if (node.t === "slot") return undefined;
    if (node.t === "list") return node.items.every((child) => child.t === "slot") ? null : (node.items.map((child) => strip(child) ?? null) as Json);
    const out: Record<string, Json> = {};
    for (const [key, child] of node.fields) {
      const kept = strip(child);
      if (kept !== undefined) setOwn(out, key, kept);
    }
    return out;
  };

  const fillWith = <P>(node: Template, handles: readonly P[]): unknown => {
    if (node.t === "data") return node.value;
    if (node.t === "slot") return handles[node.index];
    if (node.t === "list") return node.items.map((child) => fillWith(child, handles));
    const out: Record<string, unknown> = {};
    for (const [key, child] of node.fields) setOwn(out, key, fillWith(child, handles));
    return out;
  };

  return { ok: true, parts, data: strip(template) ?? null, fill: (handles) => fillWith(template, handles) };
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
