import { type Envelope, type Json, type Key, type TypeRef, field, isRecord, typePath } from "./doc.ts";
import type { Cap, Root } from "./deref.ts";
import type { ValueType } from "./types.ts";

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
 *
 * `expect` is the value type that a part must have, as `of` is its type (TYPE.CHECK). A shape with parts gives it to
 * each part that `of` covers. Only a check of types reads it, and it describes the verb `eval`.
 */
export type Shape =
  | { readonly shape: "none" }
  | { readonly shape: "term"; readonly of?: string; readonly address?: boolean; readonly kinds?: readonly (readonly Key[])[]; readonly expect?: ValueType }
  | { readonly shape: "list"; readonly of?: string; readonly item?: Shape; readonly distinct?: boolean; readonly expect?: ValueType }
  | { readonly shape: "map"; readonly of?: string; readonly item?: Shape; readonly expect?: ValueType }
  | {
      readonly shape: "record";
      readonly fields: readonly string[] | Readonly<Record<string, Shape>>;
      readonly of?: string;
      readonly required?: readonly string[];
      readonly rest?: Shape;
      readonly closed?: boolean;
      readonly expect?: ValueType;
    }
  | { readonly shape: "deep"; readonly of?: string; readonly expect?: ValueType }
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

/**
 * A lazy rule of a kind names the parts that an evaluation can skip and still give a value. An example is the
 * branches of `if`. The static facts mark each read under such a part (D24).
 *
 * `in` names the parts, as patterns of their paths in the value. The key `"*"` matches each key. A rule without `in`
 * covers each part. With `after: n`, the rule covers only the parts after the first `n` parts that its patterns
 * match. Thus `{ after: 1 }` makes each part lazy except the first part, as in `and`.
 */
export interface LazyRule {
  readonly in?: readonly (readonly Key[])[];
  readonly after?: number;
}

/**
 * The static facts that a kind declares for its code (D24). The contract of a kind holds them, and the hook `facts`
 * of a machine can give them for a name under a fallback kind. The facts describe the code of `eval`, and of `step`
 * for a step document.
 *
 * - `pure`: `true` when the code of the kind causes no effect. Its result depends only on its data, the results
 *   of its parts and what its paths reach. A kind that reads the context in another way does not declare it,
 *   because the static facts do not see that read.
 * - `volatile`: `true` when its result can change while each read gives the same thing, for example a clock.
 * - `lazy`: the parts that an evaluation can skip and still give a value.
 * - `reads`: the roots that the code of the kind resolves as a whole, with the path of one root. The static facts
 *   give a read of each root at each document of the kind (D44). The tree node reads `self` this way.
 */
export interface KindFacts {
  readonly pure?: boolean;
  readonly volatile?: boolean;
  readonly lazy?: readonly LazyRule[];
  readonly reads?: readonly Root[];
}

/**
 * The declaration of one attribute of the nodes of a kind (D42). The last two rungs of the ladder of an attribute
 * read it (TREE.LADDER). Each term is a document. A bare term gets the type `of` of the parts of the kind.
 *
 * - `copy`: `true` gives a node without an answer of the first three rungs the same attribute of its parent
 *   (TREE.COPY).
 * - `fold`: the value of a node without an answer of the first four rungs. The fold starts with the term `unit`.
 *   Then the term `combine` adds the attribute of each node in the list `children`, one at a time (TREE.FOLD).
 *   `combine` sees the names `acc` and `item`.
 * - `default`: the term that gives the value when no rung before it answers and the declaration has no fold.
 */
export interface AttributeDeclaration {
  readonly copy?: boolean;
  readonly fold?: { readonly unit: Json; readonly combine: Json };
  readonly default?: Json;
}

/**
 * The tree contract of a kind (D42): the equations of the attributes of its nodes. Each equation is a document that
 * evaluates with the node as `self` and without capabilities. A bare equation gets the type `of` of the parts of the
 * kind.
 *
 * - `equations`: the attributes of the node itself. An equation sees no names.
 * - `down`: the attributes of each child of the node. `self` is this node. An equation sees the names `child`,
 *   `index` and `prev` (TREE.DOWN).
 * - `attributes`: the declarations of the attributes of the node, for the rungs `copy` and `default`.
 */
export interface TreeContract {
  readonly equations?: Readonly<Record<string, Json>>;
  readonly down?: Readonly<Record<string, Json>>;
  readonly attributes?: Readonly<Record<string, AttributeDeclaration>>;
}

/**
 * This function gives the type of a bare equation of a kind (D42). It is the type `of` of the shape of its parts, or
 * else the type `of` of the shape `rest` of a record. The plan, the reference and `check` read it with this one function.
 *
 * @param kind - The kind.
 * @returns The type, or `undefined` when the shape declares none.
 */
export function equationType(kind: Kind): string | undefined {
  const parts = kind.parts as { readonly of?: string; readonly rest?: { readonly of?: string } } | undefined;
  return parts?.of ?? parts?.rest?.of;
}

/**
 * A kind gives the name of an evaluator for each verb, and the contract of its value. The contract serves each verb.
 * For each verb, the kernel splits the parts and narrows their capabilities by it, and `check` reads its scope rules.
 * `side` and `effects` tell what the verb `eval` does (VERB.CONTRACT). `verbEffects` tells the effects of the other
 * verbs (VERB.EFFECTS).
 */
export interface Kind extends KindFacts {
  /**
   * The evaluator names, by verb. `eval` evaluates a document, `deref` answers a step on it, and `step` names the
   * walker of a step document. A language adds its own verbs, for example `view` or `format`.
   */
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
  /** The side of the verb `eval` of the kind. A kind of the run side causes effects. The default is `derive`. */
  readonly side?: Side;
  /**
   * The effects that the verb `eval` of a document of this kind can cause. It is a list of the kinds of the effects.
   * The text `"type"` means that the kind of the effect is the type of the document itself, as for a call. For a
   * procedure entry, the list holds the latent effects of the procedure, and `checkLatent` compares them with its body
   * (CAP.LATENT).
   */
  readonly effects?: "type" | readonly string[];
  /**
   * The effects that the other verbs of a document of this kind can cause, by verb, in the form of `effects`
   * (VERB.EFFECTS, D49). An entry `view: []` declares no effect for `view`. A verb without an entry has no
   * declaration, thus `check` does not test its effects. The field `effects` declares `eval`, thus this field has no
   * entry `eval`.
   */
  readonly verbEffects?: VerbEffects;
  /**
   * The value type of the result of the verb `eval`, when it is fixed (TYPE.SYNTH). A check of types gives it to each
   * document of the kind, in the place of the type that the rule of the evaluator synthesizes.
   */
  readonly result?: ValueType;
  /**
   * The equations and the declarations of the attributes of a node of the decorated tree (D42). Only the evaluator
   * `tree.node` reads them, and `check` checks each equation one time (TREE.LADDER).
   */
  readonly tree?: TreeContract;
  /** One sentence that tells what the kind is. */
  readonly summary?: string;
}

/**
 * The effects that a contract declares for the verbs other than `eval`, by verb (D49). Each entry has the form of the
 * field `effects` of a kind. The type has no entry `eval`, because the field `effects` declares `eval`.
 */
export type VerbEffects = Readonly<Record<string, "type" | readonly string[]>> & { readonly eval?: never };

/**
 * This function gives the effects that the contract of a kind declares for a verb (VERB.EFFECTS, D49). For `eval`,
 * the field `effects` declares them, and a kind without the field declares no effect. For another verb, the entry of
 * `verbEffects` declares them. `check` and `conforms` read the declarations with this one function.
 *
 * @param kind - The kind.
 * @param verb - The verb.
 * @returns The declaration in the form of `effects`, or `undefined` when the contract does not declare the effects of
 *   the verb.
 */
export function effectsOfVerb(kind: Kind, verb: string): "type" | readonly string[] | undefined {
  if (verb === "eval") return kind.effects ?? [];
  const table = kind.verbEffects as Readonly<Record<string, "type" | readonly string[]>> | undefined;
  return table !== undefined && Object.hasOwn(table, verb) ? table[verb] : undefined;
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
  /**
   * The default evaluator of each verb: the last rung of the ladder (LADDER.DEFAULT). It serves each verb, also
   * `deref` and `step`. Without a default of `deref`, a step goes into the value of a document (VERB.LADDER).
   */
  readonly defaults: Readonly<Record<string, string>>;
  readonly fallback?: Kind;
}

/**
 * The result of a lookup of a type in the world. The reasons of a failure:
 *
 * - `unknown`: the world has no entry for a key, and no fallback kind.
 * - `cycle`: the aliases form a cycle. The lookup reached a path a second time.
 * - `too-long`: the lookup followed more than 32 aliases without a path a second time (DEREF.CHAIN-REASON).
 * - `not-a-kind`: the path reaches an entry of the wrong sort. An example is an alias whose target is not in the world.
 * - `computed`: the type is a computed type, thus it has no keys.
 */
export type Lookup =
  | { readonly ok: true; readonly kind: Kind; readonly path: readonly Key[]; readonly aliases: number }
  | { readonly ok: false; readonly reason: "unknown" | "cycle" | "too-long" | "not-a-kind" | "computed"; readonly path: readonly Key[] };

/** The most aliases that one lookup follows (WORLD.ALIAS-LIMIT). */
const MAX_ALIASES = 32;

/** This function tells if two paths of a lookup have the same keys. */
function samePath(a: readonly Key[], b: readonly Key[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

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
 * time. An alias on the way is followed until a kind answers (collapse). A cycle of aliases stops the lookup, and so
 * does a chain of more than 32 aliases. In a
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
  // The paths before each alias. The same path again closes a cycle, because the lookup of a path is always the same.
  let seen: (readonly Key[])[] | undefined;
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
        if (aliases > MAX_ALIASES) return { ok: false, reason: "too-long", path };
        const target = entry.value.slice(1);
        if (entry.value[0] !== "world" || !target.every((item) => typeof item === "string" || typeof item === "number")) {
          return { ok: false, reason: "not-a-kind", path };
        }
        seen ??= [];
        seen.push(path);
        path = [...(target as readonly Key[]), ...path.slice(index + 1)];
        const next = path;
        if (seen.some((before) => samePath(before, next))) return { ok: false, reason: "cycle", path };
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
