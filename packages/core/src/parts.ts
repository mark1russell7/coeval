import { type Json, type Key, isEnvelope, isRecord } from "./doc.ts";
import type { Shape } from "./world.ts";

/** One part of a value: its place in the value, the JSON of the part, and the type that its position declares. */
export interface PartSlot {
  /** The keys from the value of the document to the part. */
  readonly path: readonly Key[];
  /** The path as one text, with a dot between the keys, for example `bind.x`. A part of a list has its index. */
  readonly key: string;
  readonly item: Json;
  readonly of?: string;
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

const NO_SLOTS: readonly PartSlot[] = Object.freeze([]);

function hasSlots(template: Template): boolean {
  return template.t !== "data";
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
  const slot = (item: Json, path: readonly Key[], of: string | undefined): Template => {
    parts.push({ path, key: path.join("."), item, ...(of === undefined ? {} : { of }) });
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
    if (spec.shape === "term") return slot(item, path, spec.of);
    if (spec.shape === "deep") return deep(item, path, spec.of);
    if (spec.shape === "list") {
      if (!Array.isArray(item)) throw new Bad("The value must be a list.", path);
      const each: Shape = spec.item ?? { shape: "term", ...(spec.of === undefined ? {} : { of: spec.of }) };
      return { t: "list", items: (item as readonly Json[]).map((child, index) => walk(each, child, [...path, index])) };
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
