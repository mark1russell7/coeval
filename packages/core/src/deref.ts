import { type Envelope, type Json, type JsonRecord, type Key, type TypeRef, field, isEnvelope, isKey, isRecord, typePath } from "./doc.ts";
import { type Kind, type World, entriesAsJson, lookupKind } from "./world.ts";
import { answerOf } from "./ladder.ts";
import type { ErrorCode } from "./errors.ts";

/**
 * The brand of a host thing: an object of the host that answers the steps of a path itself. The brand is a
 * global symbol, thus two copies of the kernel in one program know the things of each other.
 */
export const THING: unique symbol = /* @__PURE__ */ Symbol.for("coeval.thing") as never;

/**
 * A host thing: an object that answers the steps of a path itself, for example a node of a live tree. It is the
 * own entry of the ladder for the verb `deref`.
 */
export interface HostThing {
  readonly [THING]: true;
  /** A short text for a reader, for example `node card`. */
  readonly label: string;
  /**
   * This function answers one step. A field that holds `undefined` also gives `undefined`. The function `has` tells
   * the two cases apart (DEREF.HOST-UNDEFINED).
   *
   * @param key - The key of the step.
   * @returns What the step reaches, or `undefined` when it reaches nothing.
   */
  deref(key: Key): Thing | undefined;
  /**
   * This optional function tells if the thing has a field for a key. The kernel asks it only when `deref` gives
   * `undefined`. Then `true` tells that the field holds `undefined`. A thing without `has` reads `undefined` as a
   * missing field.
   *
   * @param key - The key of the step.
   * @returns `true` when the thing has the field.
   */
  has?(key: Key): boolean;
  /**
   * This function gives the thing as a value, when a reference ends on it.
   *
   * @returns The value.
   */
  toJson(): unknown;
  /**
   * This optional function answers all the steps of a path that are keys, in one call. A store uses it to read a
   * path without one call for each step.
   *
   * @param keys - The keys.
   * @returns What the keys reach, or `undefined` when they reach nothing. `{ thing: undefined }` tells that the keys reach a field that holds `undefined`.
   */
  resolve?(keys: readonly Key[]): { readonly thing: Thing } | undefined;
  /**
   * This optional function answers one step only when the host has its value without new work (SCHED.CLOSURE). A
   * kept read of a closure uses it, because the evaluation did not ask for that read. A schedule gives the value of
   * a node that has its result in the data epoch. A throw gives the error of the step.
   *
   * @param key - The key of the step.
   * @returns What the step reaches, or `undefined` when the host does not know it yet. Then the kept read ends at the thing.
   */
  known?(key: Key): { readonly thing: Thing } | undefined;
}

/** Something that a path can reach: any value of the host, or a host thing. */
export type Thing = unknown;

/**
 * This function tells if a thing is a host thing.
 *
 * @param thing - The thing.
 * @returns `true` for a host thing.
 */
export function isHostThing(thing: unknown): thing is HostThing {
  return typeof thing === "object" && thing !== null && (thing as Partial<HostThing>)[THING] === true;
}

/** The roots of a context. Each path starts with one of them. */
export const ROOTS = ["self", "names", "world", "event", "caps"] as const;

/** One root of a context. */
export type Root = (typeof ROOTS)[number];

/**
 * A capability: the name of a kind of effect, or its keys. A capability permits its kind and each kind under it.
 * Keys are necessary when a key has a dot in it.
 */
export type Cap = string | readonly Key[];

/**
 * The context of a term: a record with five roots. A reference reaches outside its term only through them.
 *
 * - `self`: the node that the term is part of.
 * - `names`: the values that the evaluators around the term bound.
 * - `world`: the registry of kinds.
 * - `event`: the event that started a run.
 * - `caps`: the effects that the term can cause.
 */
export interface Context {
  readonly self: Thing;
  readonly names: Readonly<Record<string, unknown>>;
  readonly world: Thing;
  readonly event: Thing;
  readonly caps: readonly Cap[];
}

/**
 * The code of a `deref` evaluator: it answers one step of a path on a document of its kind. A field that holds
 * `undefined` also gives `undefined`. The optional function `has` of the code tells the two cases apart
 * (DEREF.KIND-UNDEFINED). A host gives the code a `has` with `Object.assign(code, { has })`.
 */
export interface DerefCode {
  /**
   * This function answers one step on a document.
   *
   * @param doc - The document.
   * @param key - The key of the step.
   * @returns What the step reaches, or `undefined` when it reaches nothing.
   */
  (doc: Envelope, key: Key): Thing | undefined;
  /**
   * This optional function tells if a document has a field for a key. The kernel asks it only when the code gives
   * `undefined`. Then `true` tells that the field holds `undefined`. A code without `has` reads `undefined` as a
   * missing field, as a host thing does (DEREF.HOST-UNDEFINED).
   *
   * @param doc - The document.
   * @param key - The key of the step.
   * @returns `true` when the document has the field.
   */
  readonly has?: (doc: Envelope, key: Key) => boolean;
}

/**
 * The result of a step document: what it reached, or the reason of a failure. A failure can give its code, for
 * example `#REF!` for a position outside a space. The default code is `#N/A`.
 */
export type WalkResult = { readonly ok: true; readonly thing: Thing } | { readonly ok: false; readonly reason: string; readonly code?: ErrorCode };

/** The input of a walker: the code of a step document, for example `nearest`. */
export interface WalkInput {
  /** The value of the step document. */
  readonly data: Json;
  /** The thing that the path reached before this step. */
  readonly here: Thing;
  readonly context: Context;
  /**
   * This function answers one step on a thing, through the ladder. A field that holds `undefined` also gives
   * `undefined`. The function `has` tells the two cases apart (DEREF.WALKER-UNDEFINED).
   *
   * @param thing - The thing.
   * @param key - The key.
   * @returns What the step reaches, or `undefined`.
   */
  deref(thing: Thing, key: Key): Thing | undefined;
  /**
   * This optional function tells if a step on a thing reaches a field, through the ladder. A walker needs it only
   * when `deref` gives `undefined`. Then `true` tells that the field holds `undefined` (DEREF.WALKER-UNDEFINED).
   * Each resolution of the kernel gives it. The function asks the ladder again, thus a host thing answers the step again.
   *
   * @param thing - The thing.
   * @param key - The key.
   * @returns `true` when the step reaches a field, also a field that holds `undefined`.
   */
  has?(thing: Thing, key: Key): boolean;
  /**
   * This optional function records one hop inside the walk (HOP.EACH-STEP). The resolution gives it only when it
   * records hops. The hop of the whole walk comes after these hops, as before.
   *
   * @param key - The key that the walk followed.
   * @param thing - The thing that the key reached.
   */
  readonly visit?: (key: Key, thing: Thing) => void;
}

/** A walker: the code of the verb `step` of a kind of step documents. */
export type Walker = (input: WalkInput) => WalkResult;

/**
 * What a resolution needs: the world, and the code of the `deref` evaluators and of the walkers.
 *
 * - `plain`: `true` when the values are data. Then a step does not ask the kind of an envelope, and a reference
 *   that a step reaches stays a value (no collapse).
 * - `roots`: the roots that a path can start at. The default is each root.
 * - `adopt`: the thing of each value that a path reaches. A host gives its own values a host thing with this
 *   function, for example a value whose fields read through signals. A host thing is not followed as a reference.
 */
export interface Navigator {
  readonly world: World;
  readonly derefs?: Readonly<Record<string, DerefCode>>;
  readonly walkers?: Readonly<Record<string, Walker>>;
  readonly plain?: boolean;
  readonly roots?: readonly Root[];
  readonly adopt?: (value: unknown) => Thing;
}

/** The way that one hop of a path was answered. */
export type HopBy = "root" | "own" | "kind" | "default" | "step" | "collapse";

/** One hop of a path: the step, what it reached, and who answered it. */
export interface Hop {
  readonly step: Json;
  readonly thing: Thing;
  readonly by: HopBy;
}

/** The codes that a resolution gives itself. A walker can give another code for its failure. */
export type ResolveCode = "#REF!" | "#NAME?" | "#N/A" | "#CYCLE!" | "#STEP?";

/** The result of a resolution: what the path reached, with each hop, or an error with the hops before it. */
export type Resolution =
  | { readonly ok: true; readonly thing: Thing; readonly hops: readonly Hop[] }
  | { readonly ok: false; readonly code: ResolveCode | ErrorCode; readonly reason: string; readonly hops: readonly Hop[] };

/** The options of a resolution. */
export interface ResolveOptions {
  /** `false`: do not record the hops. The default is `true`. */
  readonly hops?: boolean;
}

/** This function gives the own entries of an envelope, when it has a record of them. */
function ownEntries(envelope: Envelope): Readonly<Record<string, string>> | undefined {
  const own = field(envelope as JsonRecord, "own");
  return isRecord(own) ? (own as Readonly<Record<string, string>>) : undefined;
}

/** One node of the memo of the kinds of a world: the kind of the keys up to this node, and the longer keys. */
interface KindNode {
  /** The kind of the keys, `null` for a type without a kind, or `undefined` before the first lookup. */
  kind?: Kind | null;
  next?: Map<Key, KindNode>;
}

/** The memo of the kinds of one world, by the keys of a type. */
interface KindMemo {
  first: Map<Key, KindNode>;
  /** The number of kinds in the memo. */
  size: number;
}

/** The most kinds in the memo of one world. A larger memo starts again, thus the types of the data cannot fill the memory. */
const MAX_KINDS = 1000;

const kindMemos = /* @__PURE__ */ new WeakMap<World, KindMemo>();

/**
 * This function gives the kind of a type for the ladder: `null` when the world does not have the kind. The result
 * depends only on the world and on the keys of the type, thus a memo for each world keeps it (PLAN.KIND-MEMO). A
 * world does not change after a plan or a resolution uses it, as for `worldThing`.
 */
function kindFor(world: World, type: TypeRef): Kind | null {
  const keys = typeof type === "string" ? undefined : typePath(type);
  // A computed type has no keys, and `lookupKind` gives it no kind.
  if (typeof type !== "string" && (keys === undefined || keys.length === 0)) {
    const found = lookupKind(world, type);
    return found.ok ? found.kind : null;
  }
  let memo = kindMemos.get(world);
  if (memo === undefined || memo.size >= MAX_KINDS) {
    memo = { first: new Map(), size: 0 };
    kindMemos.set(world, memo);
  }
  const node = keys === undefined ? nodeAt(memo.first, type as string) : nodeOf(memo.first, keys);
  if (node.kind === undefined) {
    const found = lookupKind(world, type);
    node.kind = found.ok ? found.kind : null;
    memo.size += 1;
  }
  return node.kind;
}

/** This function gives the node of one key in a level of the memo, and makes it when the level does not have it. */
function nodeAt(level: Map<Key, KindNode>, key: Key): KindNode {
  let node = level.get(key);
  if (node === undefined) {
    node = {};
    level.set(key, node);
  }
  return node;
}

/** This function gives the node of the keys of a type in the memo. */
function nodeOf(first: Map<Key, KindNode>, keys: readonly Key[]): KindNode {
  let node = nodeAt(first, keys[0] as Key);
  for (let index = 1; index < keys.length; index += 1) node = nodeAt((node.next ??= new Map()), keys[index] as Key);
  return node;
}

/** This function tells if a table of code has the name. An entry of a document can hold another value than a text. */
function codeIn(table: Readonly<Record<string, unknown>>, name: unknown): boolean {
  return typeof name === "string" && Object.hasOwn(table, name);
}

/**
 * This function finds the walker of a step document through the ladder of the verb `step` (VERB.LADDER). The rungs
 * are the own entry, then the kind, then the default of the world. A rung answers only with a walker that the
 * navigator has. A resolution and `check` use this function, thus they agree on `#STEP?`.
 *
 * @param nav - The world and the walkers.
 * @param step - A step of a path that is not a key.
 * @returns The walker, or `undefined` when no rung answers.
 */
export function walkerOf(nav: Navigator, step: unknown): Walker | undefined {
  const walkers = nav.walkers;
  if (walkers === undefined || !isEnvelope(step)) return undefined;
  const answer = answerOf(nav.world, ownEntries(step), kindFor(nav.world, step.type), "step", (name) => codeIn(walkers, name));
  return answer === undefined ? undefined : walkers[answer.name];
}

/** The answer of `plainStep` for a field that the value does not have. A field can hold `undefined`. */
const NOTHING: unique symbol = /* @__PURE__ */ Symbol("nothing") as never;

/** The own fields of a value: the items and the length of a list, and the own properties of an object. */
function plainStep(thing: unknown, key: Key): unknown {
  if (Array.isArray(thing)) {
    if (key === "length") return thing.length;
    const index = typeof key === "number" ? key : /^\d+$/.test(key) ? Number(key) : -1;
    return index >= 0 && index < thing.length ? (thing as readonly unknown[])[index] : NOTHING;
  }
  if (typeof thing === "object" && thing !== null) {
    const name = String(key);
    return Object.hasOwn(thing, name) ? (thing as Readonly<Record<string, unknown>>)[name] : NOTHING;
  }
  return NOTHING;
}

/**
 * This function tells if a value can be an envelope by its field `type`. An envelope has its own field `type`, thus
 * a value without that field is not an envelope, and the full test is not necessary.
 */
function mayBeEnvelope(thing: unknown): boolean {
  return typeof thing === "object" && thing !== null && (thing as { readonly type?: unknown }).type !== undefined;
}

/**
 * This function answers one step of a path on a thing, through the ladder of the verb `deref`. A host thing
 * answers for itself (own). A document asks its own entry, then its kind, then the default of the world
 * (VERB.LADDER). A rung answers only with a `deref` that the navigator has. When no rung answers, the step goes into
 * the value: an own field of an object, or an item of a list. A value without a type is data, thus the step goes
 * into it at once.
 *
 * @param nav - The world and the code of the evaluators.
 * @param thing - The thing that the path reached.
 * @param key - The key of the step.
 * @returns What the step reaches and the rung that answered, or `undefined` when it reaches nothing.
 */
export function derefStep(nav: Navigator, thing: Thing, key: Key): { readonly thing: Thing; readonly by: HopBy } | undefined {
  if (isHostThing(thing)) {
    const reached = thing.deref(key);
    // DEREF.HOST-UNDEFINED: `has` tells a field that holds undefined from a missing field.
    return reached !== undefined || thing.has?.(key) === true ? { thing: reached, by: "own" } : undefined;
  }
  if (nav.plain !== true && mayBeEnvelope(thing) && isEnvelope(thing)) {
    const envelope = thing as JsonRecord & Envelope;
    const derefs = nav.derefs;
    // A navigator without the code of a deref needs no lookup of the kind: no rung can answer.
    const answer = derefs === undefined ? undefined : answerOf(nav.world, ownEntries(envelope), kindFor(nav.world, envelope.type), "deref", (name) => codeIn(derefs, name));
    if (answer !== undefined) {
      const code = (derefs as Readonly<Record<string, DerefCode>>)[answer.name];
      const reached = code?.(envelope, key);
      // DEREF.KIND-UNDEFINED: the `has` of the code tells a field that holds undefined from a missing field.
      return reached !== undefined || code?.has?.(envelope, key) === true ? { thing: reached, by: answer.rung } : undefined;
    }
    const reached = plainStep(envelope.value, key);
    return reached === NOTHING ? undefined : { thing: reached, by: "default" };
  }
  const reached = plainStep(thing, key);
  return reached === NOTHING ? undefined : { thing: reached, by: "default" };
}

/**
 * This function tells if a thing is a reference document: an envelope of the type `ref` with a list for its path.
 *
 * @param thing - The thing.
 * @returns `true` for a reference document.
 */
export function isRef(thing: unknown): thing is Envelope & { readonly value: readonly Json[] } {
  if (typeof thing !== "object" || thing === null) return false;
  // A text type other than `ref` names another kind, thus the full test of the envelope is not necessary.
  const type = (thing as { readonly type?: unknown }).type;
  if (type === undefined || (typeof type === "string" && type !== "ref")) return false;
  if (!isEnvelope(thing) || !Array.isArray(thing.value)) return false;
  const path = typePath(thing.type as TypeRef);
  return path !== undefined && path.length === 1 && path[0] === "ref";
}

const worlds = /* @__PURE__ */ new WeakMap<World, Json>();

/**
 * This function makes the thing of the root `world`: the entries of the world as JSON. An alias is a reference
 * document in it, thus a walk through the world follows each alias (collapse). The thing of a world is made one
 * time.
 *
 * @param world - The world.
 * @returns The thing.
 */
export function worldThing(world: World): Json {
  let thing = worlds.get(world);
  if (thing === undefined) {
    thing = entriesAsJson(world.kinds);
    worlds.set(world, thing);
  }
  return thing;
}

/**
 * This function makes a context. The world comes from the navigator when the call gives none.
 *
 * @param parts - The roots to set.
 * @returns The context.
 */
export function context(parts: Partial<Context> = {}): Context {
  return {
    self: parts.self ?? null,
    names: parts.names ?? {},
    world: parts.world ?? null,
    event: parts.event ?? null,
    caps: parts.caps ?? [],
  };
}

const MAX_COLLAPSE = 64;
/** The reason of a resolution that reaches the bound of collapses without a cycle that it found (DEREF.CHAIN-REASON). It is a plain string, thus a bundle drops it (PKG.PURE). */
const CHAIN_REASON = "The path follows more than 64 references. One resolution follows at most 64.";
const NO_HOPS: readonly Hop[] = /* @__PURE__ */ Object.freeze([]);

/** A value that can be a reference document: a record with the type `ref`. The full check comes after. */
function mayBeRef(thing: unknown): boolean {
  return typeof thing === "object" && thing !== null && (thing as { readonly type?: unknown }).type === "ref";
}

/** This function tells if each step of a path from an index is a key. */
function keysFrom(path: readonly unknown[], start: number): boolean {
  for (let index = start; index < path.length; index += 1) if (!isKey(path[index])) return false;
  return true;
}

/** This function tells if a root has a value of its own for the short path: each root except `caps`. */
function quickRoot(root: unknown): root is "names" | "self" | "event" | "world" {
  return root === "names" || root === "self" || root === "event" || root === "world";
}

/**
 * This function resolves the common path without a record of hops: a root, then keys. Plain values answer the
 * keys, or a host thing answers all of them in one call. It gives `undefined` when the path needs the full
 * algorithm. Examples are a host thing without `resolve`, an envelope, a reference to follow, a step document and a
 * failure of a step (for its exact reason).
 */
function resolveQuick(nav: Navigator, ctx: Context, path: readonly unknown[]): Resolution | undefined {
  const root = path[0];
  if (!quickRoot(root)) return undefined;
  if (nav.roots !== undefined && !(nav.roots as readonly string[]).includes(root)) return undefined;
  if (nav.adopt !== undefined) return undefined;
  return walkQuick(ctx[root], path, nav.plain === true, false);
}

/**
 * This function walks the steps of the short path from the value of the root (DEREF.QUICK). `resolveQuick` and each
 * compiled path use it, thus the two cannot disagree. It gives `undefined` when the path needs the full algorithm.
 *
 * @param start - The value of the root.
 * @param path - The steps. The walk starts at the index 1.
 * @param plain - `true` for a plain navigation.
 * @param keyed - `true` when each step after the root is a key. The walk then does not test the steps again.
 */
function walkQuick(start: unknown, path: readonly unknown[], plain: boolean, keyed: boolean): Resolution | undefined {
  let here = start;
  for (let index = 1; index < path.length; index += 1) {
    if (typeof here !== "object" || here === null) return undefined;
    // One read of the field `type` finds a reference document. Without the field, the value is not an envelope.
    const type = plain ? undefined : (here as { readonly type?: unknown }).type;
    if (type === "ref") return undefined;
    if ((here as Partial<HostThing>)[THING] === true) {
      const thing = here as HostThing;
      if (thing.resolve === undefined || !(keyed || keysFrom(path, index))) return undefined;
      const keys = path.slice(index) as readonly Key[];
      const reached = thing.resolve(keys);
      if (reached === undefined) return { ok: false, code: "#N/A", reason: `The path ${keys.join(".")} reaches nothing.`, hops: NO_HOPS };
      if (!plain && mayBeRef(reached.thing)) return undefined;
      return { ok: true, thing: reached.thing, hops: NO_HOPS };
    }
    const step = path[index];
    if (Array.isArray(here)) {
      if (typeof step !== "number" || !Number.isInteger(step) || step < 0 || step >= here.length) return undefined;
      here = (here as readonly unknown[])[step];
      continue;
    }
    if (typeof step !== "string" || !Object.hasOwn(here, step)) return undefined;
    if (type !== undefined && isEnvelope(here)) return undefined;
    here = (here as Readonly<Record<string, unknown>>)[step];
  }
  if (!plain && mayBeRef(here)) return undefined;
  return { ok: true, thing: here, hops: NO_HOPS };
}

/**
 * A compiled path: one static path for one navigator (PLAN.PATH). `compilePath` reads the root, the open roots and
 * the steps one time. It asks the ladder of the verb `step` for each step document one time. Each resolution then
 * examines only the values of the context.
 */
export interface CompiledPath {
  /** The steps of the path, as the document gives them. The list of reads records these steps. */
  readonly path: readonly unknown[];
  /** The navigator of the compilation. A runtime with another navigator resolves the steps again. */
  readonly nav: Navigator;
  /**
   * This function resolves the path from a context, without a record of hops.
   *
   * @param ctx - The context.
   * @returns The same resolution as `resolve(nav, ctx, path, { hops: false })`.
   */
  resolve(ctx: Context): Resolution;
}

/** The walker of each step document of a path, by its index: `null` when no rung answers, `undefined` for a key. */
type KnownWalkers = readonly (Walker | null | undefined)[];

/** The root whose value starts the short path of a compiled path. `FULL` takes the full algorithm at once. */
const FULL = 0;
const FROM_NAMES = 1;
const FROM_SELF = 2;
const FROM_EVENT = 3;
const FROM_WORLD = 4;
type From = typeof FULL | typeof FROM_NAMES | typeof FROM_SELF | typeof FROM_EVENT | typeof FROM_WORLD;

/**
 * A compiled path as an object with fields (PLAN.LEAN). The code of `resolve` is on the class, thus each compiled path
 * keeps only its fields and makes no closure.
 */
class StaticPath implements CompiledPath {
  // The constructor writes each field one time, thus each field stays constant for V8, as the variable of a closure.
  declare readonly path: readonly unknown[];
  declare readonly nav: Navigator;
  /** The walker of each step document, from the ladder of `step`, or `undefined` for a path of keys. */
  declare private readonly known: KnownWalkers | undefined;
  /** The root that starts the short path, or `FULL`. */
  declare private readonly from: From;
  declare private readonly plain: boolean;

  constructor(path: readonly unknown[], nav: Navigator, known: KnownWalkers | undefined, from: From, plain: boolean) {
    this.path = path;
    this.nav = nav;
    this.known = known;
    this.from = from;
    this.plain = plain;
  }

  resolve(ctx: Context): Resolution {
    const from = this.from;
    if (from !== FULL) {
      const start = from === FROM_NAMES ? ctx.names : from === FROM_WORLD ? ctx.world : from === FROM_SELF ? ctx.self : ctx.event;
      const quick = walkQuick(start, this.path, this.plain, true);
      if (quick !== undefined) return quick;
    }
    return resolveFully(this.nav, ctx, this.path, undefined, this.known);
  }
}

/**
 * This function compiles one static path for one navigator. The resolver gives the same thing, error and reason as
 * `resolve` without hops (PLAN.PATH-SAME). It keeps no value of a context.
 *
 * - Some paths take the full algorithm at once, because the short path cannot answer them. A path from `caps` or from
 *   a closed root is one. A path with a step document and each path of a navigator with `adopt` are others.
 * - Each other path walks the short path from its root, and it takes the full algorithm when the values need it.
 * - The walker of each step document comes from the ladder one time, here. The navigator and the step document do
 *   not change, thus the answer does not change either.
 *
 * @param nav - The navigator. A plan compiles its paths for its machine.
 * @param path - The steps. The first step is a root.
 * @returns The compiled path.
 */
export function compilePath(nav: Navigator, path: readonly unknown[]): CompiledPath {
  const keyed = keysFrom(path, 1);
  const known = keyed ? undefined : walkersOf(nav, path);
  return new StaticPath(path, nav, known, startOf(nav, path, keyed), nav.plain === true);
}

/** This function gives the root that starts the short path of a compiled path, or `FULL`. */
function startOf(nav: Navigator, path: readonly unknown[], keyed: boolean): From {
  const root = path[0];
  // The short path of `resolveQuick` refuses each of these paths before it reads a value, thus it is not necessary.
  if (!keyed || !quickRoot(root) || nav.adopt !== undefined) return FULL;
  if (nav.roots !== undefined && !(nav.roots as readonly string[]).includes(root)) return FULL;
  return root === "names" ? FROM_NAMES : root === "self" ? FROM_SELF : root === "event" ? FROM_EVENT : FROM_WORLD;
}

/**
 * This function asks the ladder of the verb `step` for each step document of a path. A step whose lookup throws
 * stays unknown, thus the full algorithm asks the ladder again for it.
 */
function walkersOf(nav: Navigator, path: readonly unknown[]): KnownWalkers | undefined {
  // Without walkers, `walkerOf` gives `undefined` at once.
  if (nav.walkers === undefined) return undefined;
  const out = new Array<Walker | null | undefined>(path.length);
  for (let index = 1; index < path.length; index += 1) {
    const step = path[index];
    if (isKey(step)) continue;
    try {
      out[index] = walkerOf(nav, step) ?? null;
    } catch {
      // The full algorithm asks the ladder again, and it gives the exception there.
    }
  }
  return out;
}

/**
 * This function resolves a path from a context, and records each hop.
 *
 * The first step is a root of the context. Each later step is a key or a step document. A key goes up the ladder
 * of the verb `deref` on the thing that the path reached. A step document is evaluated by the walker that the
 * ladder of the verb `step` gives, with the thing that the path reached. After each hop, a reference document is
 * followed until the path reaches something else (collapse), except in a plain navigation.
 *
 * The codes of a failure:
 *
 * - `#REF!`: the path has no root, or a root that is not open here.
 * - `#NAME?`: the root `names` has no such name.
 * - `#N/A`: a step reaches nothing.
 * - `#STEP?`: a step is not a key and not a step document.
 * - `#CYCLE!`: the references form a cycle, or the resolution follows more than 64 references. The reason tells
 *   which (DEREF.CHAIN-REASON).
 *
 * @param nav - The world and the code of the evaluators.
 * @param ctx - The context.
 * @param path - The steps.
 * @param options - `hops: false` does not record the hops.
 * @returns What the path reached and each hop, or an error.
 */
export function resolve(nav: Navigator, ctx: Context, path: readonly unknown[], options: ResolveOptions = {}): Resolution {
  if (options.hops === false) {
    const quick = resolveQuick(nav, ctx, path);
    if (quick !== undefined) return quick;
  }
  return resolveFully(nav, ctx, path, options.hops === false ? undefined : [], undefined);
}

/** The functions `deref` and `has` of the input of a walker, for one navigator. */
interface WalkSteps {
  readonly nav: Navigator;
  readonly deref: (thing: Thing, key: Key) => Thing | undefined;
  readonly has: (thing: Thing, key: Key) => boolean;
}

/** The functions of the last navigator that gave a walker its input. A walk with the same navigator makes no new functions. */
let lastSteps: WalkSteps | undefined;

/**
 * This function gives the functions `deref` and `has` of the input of a walker. They depend only on the navigator,
 * thus the function keeps the functions of the last navigator (K170).
 */
function walkSteps(nav: Navigator): WalkSteps {
  if (lastSteps !== undefined && lastSteps.nav === nav) return lastSteps;
  const adopt = nav.adopt;
  lastSteps = {
    nav,
    deref:
      adopt === undefined
        ? (thing, key) => derefStep(nav, thing, key)?.thing
        : (thing, key) => {
            const reached = derefStep(nav, thing, key);
            return reached === undefined ? undefined : adopt(reached.thing);
          },
    // DEREF.WALKER-UNDEFINED: the same ladder tells a field that holds undefined from a missing field.
    has: (thing, key) => derefStep(nav, thing, key) !== undefined,
  };
  return lastSteps;
}

/**
 * This function resolves a path with the full algorithm of `resolve`.
 *
 * @param nav - The world and the code of the evaluators.
 * @param ctx - The context.
 * @param path - The steps.
 * @param hops - The list that gets each hop, or `undefined` for no record.
 * @param known - The walker of each step document of the path, from `compilePath`. A reference that a step reaches has its own steps, and the ladder answers them.
 * @returns What the path reached and each hop, or an error.
 */
function resolveFully(nav: Navigator, ctx: Context, path: readonly unknown[], hops: Hop[] | undefined, known: KnownWalkers | undefined): Resolution {
  const done = hops ?? NO_HOPS;
  const failed = (code: ResolveCode | ErrorCode, reason: string): Resolution => ({ ok: false, code, reason, hops: done });
  let collapses = 0;
  // The references whose paths are in evaluation. A reference that is in this list again closes a cycle.
  let open: object[] | undefined;
  const adopt = nav.adopt ?? ((value: unknown): Thing => value);

  const collapse = (thing: Thing): Resolution => {
    let here = thing;
    if (nav.plain === true) return { ok: true, thing: here, hops: done };
    while (isRef(here)) {
      if (open?.includes(here) === true) return failed("#CYCLE!", "The references form a cycle.");
      collapses += 1;
      if (collapses > MAX_COLLAPSE) return failed("#CYCLE!", CHAIN_REASON);
      open ??= [];
      open.push(here);
      const inner = walk(here.value, undefined);
      open.pop();
      if (!inner.ok) return inner;
      here = adopt(inner.thing);
      hops?.push({ step: "collapse", thing: here, by: "collapse" });
    }
    return { ok: true, thing: here, hops: done };
  };

  const walk = (steps: readonly unknown[], walkers: KnownWalkers | undefined): Resolution => {
    const root = steps[0];
    if (typeof root !== "string" || !(ROOTS as readonly string[]).includes(root)) {
      return failed("#REF!", `A path starts with a root: ${ROOTS.join(", ")}.`);
    }
    if (nav.roots !== undefined && !(nav.roots as readonly string[]).includes(root)) {
      return failed("#REF!", `The root ${root} is not open here. The open roots are ${nav.roots.join(", ")}.`);
    }
    let here: Thing = adopt(ctx[root as Root]);
    hops?.push({ step: root, thing: here, by: "root" });
    const first = collapse(here);
    if (!first.ok) return first;
    here = first.thing;
    for (let index = 1; index < steps.length; index += 1) {
      const step = steps[index];
      if (isHostThing(here) && here.resolve !== undefined && keysFrom(steps, index)) {
        const keys = steps.slice(index) as readonly Key[];
        const reached = here.resolve(keys);
        if (reached === undefined) return failed("#N/A", `The path ${keys.join(".")} reaches nothing.`);
        const thing = adopt(reached.thing);
        hops?.push({ step: keys as readonly Json[], thing, by: "own" });
        return collapse(thing);
      }
      if (isKey(step)) {
        const reached = derefStep(nav, here, step);
        if (reached === undefined) {
          if (root === "names" && index === 1) return failed("#NAME?", `The context has no name ${String(step)}.`);
          return failed("#N/A", `The step ${String(step)} reaches nothing.`);
        }
        here = adopt(reached.thing);
        hops?.push({ step, thing: here, by: reached.by });
      } else {
        const given = walkers?.[index];
        const walker = given === undefined ? walkerOf(nav, step) : (given ?? undefined);
        if (walker === undefined) return failed("#STEP?", "A step is a key, or a document of a kind with the verb step.");
        const envelope = step as Envelope;
        const { deref, has } = walkSteps(nav);
        // A resolution without a record of hops gives no `visit`, thus a walker records nothing (HOP.EACH-STEP).
        const result = walker(
          hops === undefined
            ? { data: envelope.value, here, context: ctx, deref, has }
            : { data: envelope.value, here, context: ctx, deref, has, visit: (key, thing) => hops.push({ step: key, thing, by: "step" }) },
        );
        if (!result.ok) return failed(result.code ?? "#N/A", result.reason);
        here = adopt(result.thing);
        hops?.push({ step: envelope as Json, thing: here, by: "step" });
      }
      const next = collapse(here);
      if (!next.ok) return next;
      here = next.thing;
    }
    return { ok: true, thing: here, hops: done };
  };

  if (path.length === 0) return failed("#REF!", "A path has at least one step: its root.");
  return walk(path, known);
}

/**
 * This function gives the value of a thing: the value that a host thing gives, or else the thing itself.
 *
 * @param thing - The thing.
 * @returns The value.
 */
export function valueOfThing(thing: Thing): unknown {
  return isHostThing(thing) ? thing.toJson() : thing;
}
