import { type Envelope, type Json, type Key, type TypeRef, field, isRecord, typePath } from "./doc.ts";

/** The two sides of evaluation. `derive` is pure. `run` causes effects in order. */
export type Side = "derive" | "run";

/**
 * Where the parts of a value are. A part is a typed document that the evaluator gets sealed.
 *
 * - `none`: the value is data. It has no parts.
 * - `list`: the value is a list, and each item is a part.
 * - `record`: the value is a record. The named fields are parts, and the other fields are data.
 *
 * `of` is the type of a bare item. An item without an envelope gets this type from its container.
 */
export type PartsSpec =
  | { readonly shape: "none" }
  | { readonly shape: "list"; readonly of?: string }
  | { readonly shape: "record"; readonly fields: readonly string[]; readonly of?: string };

/** A kind gives the name of an evaluator for each verb, and the contract of its value. */
export interface Kind {
  readonly verbs: Readonly<Record<string, string>>;
  /** Where the parts of the value are. The default is `none`. */
  readonly parts?: PartsSpec;
  /** The side of the kind. A kind of the run side causes effects. The default is `derive`. */
  readonly side?: Side;
  /** One sentence that tells what the kind is. */
  readonly summary?: string;
}

/** A namespace: a group of entries under one key of the world. */
export interface Namespace {
  readonly kinds: Readonly<Record<string, WorldEntry>>;
}

/** An alias: a reference to another entry of the world. The lookup follows it (collapse). */
export type Alias = { readonly type: "ref"; readonly value: readonly Json[] };

/** One entry of the world: a kind, a namespace, or an alias. */
export type WorldEntry = Kind | Namespace | Alias;

/** A world holds the kinds and the defaults that answer the questions. */
export interface World {
  readonly kinds: Readonly<Record<string, WorldEntry>>;
  readonly defaults: Readonly<Record<string, string>>;
}

/** The result of a lookup of a type in the world. */
export type Lookup =
  | { readonly ok: true; readonly kind: Kind; readonly path: readonly Key[]; readonly aliases: number }
  | { readonly ok: false; readonly reason: "unknown" | "cycle" | "not-a-kind" | "computed"; readonly path: readonly Key[] };

/**
 * This function tells if an entry of the world is a kind.
 *
 * @param entry - The entry.
 * @returns `true` for a kind.
 */
export function isKind(entry: WorldEntry | undefined): entry is Kind {
  return entry !== undefined && Object.hasOwn(entry, "verbs");
}

/**
 * This function tells if an entry of the world is an alias.
 *
 * @param entry - The entry.
 * @returns `true` for an alias.
 */
export function isAlias(entry: WorldEntry | undefined): entry is Alias {
  return entry !== undefined && (entry as { type?: unknown }).type === "ref" && Array.isArray((entry as { value?: unknown }).value);
}

function entryAt(entries: Readonly<Record<string, WorldEntry>>, key: Key): WorldEntry | undefined {
  const name = String(key);
  return Object.hasOwn(entries, name) ? entries[name] : undefined;
}

/**
 * This function finds the kind that a type names. It walks the path from the root of the world, one key at a
 * time. An alias on the way is followed until a kind answers (collapse). A cycle of aliases stops the lookup.
 *
 * @param world - The world.
 * @param type - The reference to the type.
 * @returns The kind and the path of the kind after each alias, or the reason of a failure.
 */
export function lookupKind(world: World, type: TypeRef): Lookup {
  const start = typePath(type);
  if (start === undefined) return { ok: false, reason: "computed", path: [] };
  let path: readonly Key[] = start;
  let aliases = 0;
  for (;;) {
    let entries = world.kinds;
    let entry: WorldEntry | undefined;
    let followed = false;
    for (let index = 0; index < path.length; index += 1) {
      const key = path[index] as Key;
      entry = entryAt(entries, key);
      if (entry === undefined) return { ok: false, reason: "unknown", path };
      if (isAlias(entry)) {
        aliases += 1;
        if (aliases > 32) return { ok: false, reason: "cycle", path };
        const target = entry.value.slice(1);
        if (entry.value[0] !== "world" || !target.every((item) => typeof item === "string" || typeof item === "number")) {
          return { ok: false, reason: "not-a-kind", path };
        }
        path = [...(target as readonly Key[]), ...path.slice(index + 1)];
        followed = true;
        break;
      }
      if (index < path.length - 1) {
        if (isKind(entry)) return { ok: false, reason: "not-a-kind", path };
        entries = (entry as Namespace).kinds;
      }
    }
    if (followed) continue;
    if (!isKind(entry)) return { ok: false, reason: "not-a-kind", path };
    return { ok: true, kind: entry, path, aliases };
  }
}

/**
 * This function gives the entries of a world as a JSON record, so that a reference can walk it. A kind is a
 * record with its verbs, an alias is a reference document, and a namespace is a record of its entries.
 *
 * @param entries - The entries.
 * @returns The JSON form.
 */
export function entriesAsJson(entries: Readonly<Record<string, WorldEntry>>): Json {
  const out: Record<string, Json> = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (isAlias(entry)) out[key] = { type: "ref", value: entry.value };
    else if (isKind(entry)) out[key] = JSON.parse(JSON.stringify(entry)) as Json;
    else out[key] = entriesAsJson((entry as Namespace).kinds);
  }
  return out;
}

/**
 * This function makes the document of a kind, so that a view can draw it as each other document.
 *
 * @param name - The name of the kind.
 * @param kind - The kind.
 * @returns The document of type `kind`.
 */
export function kindDocument(name: string, kind: Kind): Envelope {
  const parts: Json =
    kind.parts === undefined || kind.parts.shape === "none"
      ? "none"
      : kind.parts.shape === "list"
        ? `a list${kind.parts.of === undefined ? "" : ` of ${kind.parts.of}`}`
        : `the fields ${kind.parts.fields.join(", ")}`;
  return { type: "kind", value: { name, verbs: { ...kind.verbs }, parts, side: kind.side ?? "derive", summary: kind.summary ?? "" } };
}

/**
 * This function tells if a JSON value is the record of a kind.
 *
 * @param value - The value.
 * @returns `true` when the value has verbs.
 */
export function looksLikeKind(value: Json | undefined): boolean {
  return isRecord(value) && isRecord(field(value, "verbs"));
}
