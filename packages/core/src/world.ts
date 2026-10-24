import { type Envelope, type Json, type Key, type TypeRef, field, isRecord, typePath } from "./doc.ts";
import type { Cap } from "./deref.ts";

/** The two sides of evaluation. `derive` is pure. `run` causes effects in order. */
export type Side = "derive" | "run";

/**
 * Where the parts of a value are: the shape of the value. A part is a typed document that the evaluator gets
 * sealed. `of` is the type of a bare part: a part without an envelope gets this type from its position.
 *
 * - `none`: the value is data. It has no parts.
 * - `term`: the value itself is one part.
 * - `list`: the value is a list. Each item has the shape `item` (the default is a part).
 * - `map`: the value is a record. Each field has the shape `item` (the default is a part).
 * - `record`: the value is a record. Each named field has its shape. A list of names makes each named field a
 *   part. The other fields have the shape `rest` (the default is data). `required` names the fields that must be.
 * - `deep`: each envelope at any depth of the value is a part, and the rest is data.
 * - `text`, `number` and `one`: the value is data of that type. `one` names the values that it permits.
 *
 * A `term` with `address: true` is an address: a reference there gives what its path reaches, not the value. A
 * `term` with `kinds` permits only a part whose type starts with one of the paths. A `record` with `closed: true`
 * permits only its named fields. A `list` with `distinct: true` permits no two equal items.
 */
export type Shape =
  | { readonly shape: "none" }
  | { readonly shape: "term"; readonly of?: string; readonly address?: boolean; readonly kinds?: readonly (readonly Key[])[] }
  | { readonly shape: "list"; readonly of?: string; readonly item?: Shape; readonly distinct?: boolean }
  | { readonly shape: "map"; readonly of?: string; readonly item?: Shape }
  | {
      readonly shape: "record";
      readonly fields: readonly string[] | Readonly<Record<string, Shape>>;
      readonly of?: string;
      readonly required?: readonly string[];
      readonly rest?: Shape;
      readonly closed?: boolean;
    }
  | { readonly shape: "deep"; readonly of?: string }
  | { readonly shape: "text" }
  | { readonly shape: "number"; readonly whole?: boolean; readonly min?: number; readonly max?: number }
  | { readonly shape: "one"; readonly values: readonly Json[] };

/** The former name of `Shape`. */
export type PartsSpec = Shape;

/**
 * Where the names of a scope rule come from.
 *
 * - `fixed`: the names in the list.
 * - `keysAt`: the keys of the record at this path of the value, for example the bindings of a `let`.
 * - `listAt`: the texts of the list at this path of the value, for example the parameters of a `fn`.
 * - `textAt`: the text at this path of the value, or `otherwise` when the value has no text there.
 * - `headers`: the binding name (`name`) of each part that the rule covers.
 */
export type NamesSource =
  | { readonly fixed: readonly string[] }
  | { readonly keysAt: readonly Key[] }
  | { readonly listAt: readonly Key[] }
  | { readonly textAt: readonly Key[]; readonly otherwise?: string }
  | { readonly headers: true };

/**
 * A scope rule of a kind: names that the kind binds, and the parts that see them. The static kit reads the rules,
 * and the evaluator of the kind binds the same names when it evaluates the parts.
 */
export interface ScopeRule {
  readonly names: NamesSource;
  /** The parts that see the names, as patterns of their paths in the value. The key `"*"` matches each key. */
  readonly in: readonly (readonly Key[])[];
  /** `true`: a part sees only the names of the parts before it, as in a sequence. */
  readonly sequential?: boolean;
}

/**
 * A capability rule of a kind: what the kind gives some of its parts from the capabilities of its document. A rule
 * only narrows. A part does not get a capability that its document does not have (CAP.NARROW).
 *
 * - `same`: the parts get the capabilities of the document. This is the default.
 * - `mask`: the parts get no capabilities, as the part of `pure`.
 * - `only`: the parts get only the effects that the capabilities of the document and the list `caps` both permit.
 *
 * `in` names the parts that the rule covers, as patterns of their paths in the value. The key `"*"` matches each
 * key. A rule without `in` covers each part.
 */
export type CapsRule =
  | { readonly rule: "same"; readonly in?: readonly (readonly Key[])[] }
  | { readonly rule: "mask"; readonly in?: readonly (readonly Key[])[] }
  | { readonly rule: "only"; readonly caps: readonly Cap[]; readonly in?: readonly (readonly Key[])[] };

/** A kind gives the name of an evaluator for each verb, and the contract of its value. */
export interface Kind {
  readonly verbs: Readonly<Record<string, string>>;
  /** Where the parts of the value are. The default is `none`. */
  readonly parts?: Shape;
  /** The names that the kind binds for its parts. */
  readonly scope?: readonly ScopeRule[];
  /**
   * The capabilities that the kind gives its parts, as rules. A part that no rule covers gets the capabilities of
   * the document. A part that several rules cover gets only what each rule permits. The static kit reads the rules,
   * and the kernel narrows the context of each part by them. Thus an evaluator does not narrow the capabilities
   * itself.
   */
  readonly caps?: readonly CapsRule[];
  /** The side of the kind. A kind of the run side causes effects. The default is `derive`. */
  readonly side?: Side;
  /**
   * The effects that a document of this kind can cause. It is a list of the kinds of the effects. The text
   * `"type"` means that the kind of the effect is the type of the document itself, as for a call.
   */
  readonly effects?: "type" | readonly string[];
  /** One sentence that tells what the kind is. */
  readonly summary?: string;
}

/** A namespace: a group of entries under one key of the world. `fallback` is the kind of each other key in it. */
export interface Namespace {
  readonly kinds: Readonly<Record<string, WorldEntry>>;
  readonly fallback?: Kind;
}

/** An alias: a reference to another entry of the world. The lookup follows it (collapse). */
export type Alias = { readonly type: "ref"; readonly value: readonly Json[] };

/** One entry of the world: a kind, a namespace, or an alias. */
export type WorldEntry = Kind | Namespace | Alias;

/**
 * A world holds the kinds and the defaults that answer the questions. `fallback` is the kind of each first key that
 * the world does not have. A world with a fallback is open: each path that starts with an unknown key names a kind.
 */
export interface World {
  readonly kinds: Readonly<Record<string, WorldEntry>>;
  readonly defaults: Readonly<Record<string, string>>;
  readonly fallback?: Kind;
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

/**
 * This function tells if an entry of the world is a namespace.
 *
 * @param entry - The entry.
 * @returns `true` for a namespace.
 */
export function isNamespace(entry: WorldEntry | undefined): entry is Namespace {
  return entry !== undefined && !isKind(entry) && !isAlias(entry) && Object.hasOwn(entry, "kinds");
}

function entryAt(entries: Readonly<Record<string, WorldEntry>>, key: Key): WorldEntry | undefined {
  const name = String(key);
  return Object.hasOwn(entries, name) ? entries[name] : undefined;
}

/**
 * This function finds the kind that a type names. It walks the path from the root of the world, one key at a
 * time. An alias on the way is followed until a kind answers (collapse). A cycle of aliases stops the lookup. In a
 * namespace with a fallback, a key that the namespace does not have gets the fallback kind. In an open world, a first
 * key that the world does not have gets the fallback kind of the world.
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
    let fallback: Kind | undefined = world.fallback;
    let entry: WorldEntry | undefined;
    let followed = false;
    for (let index = 0; index < path.length; index += 1) {
      const key = path[index] as Key;
      entry = entryAt(entries, key);
      if (entry === undefined) {
        if (fallback !== undefined) return { ok: true, kind: fallback, path, aliases };
        return { ok: false, reason: "unknown", path };
      }
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
        if (!isNamespace(entry)) return { ok: false, reason: "not-a-kind", path };
        entries = entry.kinds;
        fallback = entry.fallback;
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

function describeShape(shape: Shape | undefined): Json {
  if (shape === undefined || shape.shape === "none") return "none";
  if (shape.shape === "text") return "a text";
  if (shape.shape === "number") return "a number";
  if (shape.shape === "one") return `one of ${JSON.stringify(shape.values)}`;
  if (shape.shape === "term") return `a part${shape.of === undefined ? "" : ` of ${shape.of}`}`;
  if (shape.shape === "deep") return "each document in the value";
  if (shape.shape === "list") return `a list${shape.of === undefined ? "" : ` of ${shape.of}`}`;
  if (shape.shape === "map") return `a record of parts${shape.of === undefined ? "" : ` of ${shape.of}`}`;
  const names = Array.isArray(shape.fields) ? shape.fields : Object.keys(shape.fields);
  return `the fields ${names.join(", ")}`;
}

/**
 * This function makes the document of a kind, so that a view can draw it as each other document.
 *
 * @param name - The name of the kind.
 * @param kind - The kind.
 * @returns The document of type `kind`.
 */
export function kindDocument(name: string, kind: Kind): Envelope {
  return {
    type: "kind",
    value: { name, verbs: { ...kind.verbs }, parts: describeShape(kind.parts), side: kind.side ?? "derive", summary: kind.summary ?? "" },
  };
}

/**
 * This function tells if a JSON value is the record of a kind.
 *
 * @param value - The value.
 * @returns `true` when the value has verbs.
 */
export function looksLikeKind(value: unknown): boolean {
  return isRecord(value) && isRecord(field(value, "verbs"));
}
