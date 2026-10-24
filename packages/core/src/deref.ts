import { type Envelope, type Json, type JsonRecord, type Key, type TypeRef, field, isEnvelope, isKey, isRecord, typePath } from "./doc.ts";
import { type World, entriesAsJson, lookupKind } from "./world.ts";
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
   * This function answers one step.
   *
   * @param key - The key of the step.
   * @returns What the step reaches, or `undefined` when it reaches nothing.
   */
  deref(key: Key): Thing | undefined;
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
   * @returns What the keys reach, or `undefined` when they reach nothing.
   */
  resolve?(keys: readonly Key[]): { readonly thing: Thing } | undefined;
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

/** The code of a `deref` evaluator: it answers one step of a path on a document of its kind. */
export type DerefCode = (doc: Envelope, key: Key) => Thing | undefined;

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
   * This function answers one step on a thing, through the ladder.
   *
   * @param thing - The thing.
   * @param key - The key.
   * @returns What the step reaches, or `undefined`.
   */
  deref(thing: Thing, key: Key): Thing | undefined;
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

function entryOf(verbs: Readonly<Record<string, string>> | undefined, verb: string): string | undefined {
  return verbs !== undefined && Object.hasOwn(verbs, verb) ? verbs[verb] : undefined;
}

/** The own fields of a value: the items and the length of a list, and the own properties of an object. */
function plainStep(thing: unknown, key: Key): { readonly found: true; readonly value: unknown } | undefined {
  if (Array.isArray(thing)) {
    if (key === "length") return { found: true, value: thing.length };
    const index = typeof key === "number" ? key : /^\d+$/.test(key) ? Number(key) : -1;
    return index >= 0 && index < thing.length ? { found: true, value: (thing as readonly unknown[])[index] } : undefined;
  }
  if (typeof thing === "object" && thing !== null) {
    const name = String(key);
    return Object.hasOwn(thing, name) ? { found: true, value: (thing as Readonly<Record<string, unknown>>)[name] } : undefined;
  }
  return undefined;
}

/**
 * This function answers one step of a path on a thing, through the ladder of the verb `deref`. A host thing
 * answers for itself (own). A document asks its own entry, then its kind. The default goes into the value: an own
 * field of an object, or an item of a list.
 *
 * @param nav - The world and the code of the evaluators.
 * @param thing - The thing that the path reached.
 * @param key - The key of the step.
 * @returns What the step reaches and the rung that answered, or `undefined` when it reaches nothing.
 */
export function derefStep(nav: Navigator, thing: Thing, key: Key): { readonly thing: Thing; readonly by: HopBy } | undefined {
  if (isHostThing(thing)) {
    const reached = thing.deref(key);
    return reached === undefined ? undefined : { thing: reached, by: "own" };
  }
  if (nav.plain !== true && isEnvelope(thing)) {
    const envelope = thing as JsonRecord & Envelope;
    const ownEntries = field(envelope, "own");
    const own = isRecord(ownEntries) ? entryOf(ownEntries as Readonly<Record<string, string>>, "deref") : undefined;
    const ownCode = own === undefined ? undefined : nav.derefs?.[own];
    if (ownCode !== undefined) {
      const reached = ownCode(envelope, key);
      return reached === undefined ? undefined : { thing: reached, by: "own" };
    }
    const found = lookupKind(nav.world, envelope.type);
    const name = found.ok ? entryOf(found.kind.verbs, "deref") : undefined;
    const code = name === undefined ? undefined : nav.derefs?.[name];
    if (code !== undefined) {
      const reached = code(envelope, key);
      return reached === undefined ? undefined : { thing: reached, by: "kind" };
    }
    const reached = plainStep(envelope.value, key);
    return reached === undefined ? undefined : { thing: reached.value, by: "default" };
  }
  const reached = plainStep(thing, key);
  return reached === undefined ? undefined : { thing: reached.value, by: "default" };
}

/**
 * This function tells if a thing is a reference document: an envelope of the type `ref` with a list for its path.
 *
 * @param thing - The thing.
 * @returns `true` for a reference document.
 */
export function isRef(thing: unknown): thing is Envelope & { readonly value: readonly Json[] } {
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

/**
 * This function resolves the common path without a record of hops: a root, then keys. Plain values answer the
 * keys, or a host thing answers all of them in one call. It gives `undefined` when the path needs the full
 * algorithm. Examples are a host thing without `resolve`, an envelope, a reference to follow, a step document and a
 * failure of a step (for its exact reason).
 */
function resolveQuick(nav: Navigator, ctx: Context, path: readonly unknown[]): Resolution | undefined {
  const root = path[0];
  if (root !== "names" && root !== "self" && root !== "event" && root !== "world") return undefined;
  if (nav.roots !== undefined && !(nav.roots as readonly string[]).includes(root)) return undefined;
  if (nav.adopt !== undefined) return undefined;
  let here: unknown = ctx[root];
  const plain = nav.plain === true;
  for (let index = 1; index < path.length; index += 1) {
    if (typeof here !== "object" || here === null) return undefined;
    if (!plain && mayBeRef(here)) return undefined;
    if ((here as Partial<HostThing>)[THING] === true) {
      const thing = here as HostThing;
      if (thing.resolve === undefined || !keysFrom(path, index)) return undefined;
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
    if (!plain && isEnvelope(here)) return undefined;
    here = (here as Readonly<Record<string, unknown>>)[step];
  }
  if (!plain && mayBeRef(here)) return undefined;
  return { ok: true, thing: here, hops: NO_HOPS };
}

/**
 * This function resolves a path from a context, and records each hop.
 *
 * The first step is a root of the context. Each later step is a key or a step document. A key goes up the ladder
 * of the verb `deref` on the thing that the path reached. A step document is evaluated by the walker of its kind,
 * with the thing that the path reached. After each hop, a reference document is followed until the path reaches
 * something else (collapse), except in a plain navigation.
 *
 * The codes of a failure:
 *
 * - `#REF!`: the path has no root, or a root that is not open here.
 * - `#NAME?`: the root `names` has no such name.
 * - `#N/A`: a step reaches nothing.
 * - `#STEP?`: a step is not a key and not a step document.
 * - `#CYCLE!`: the references form a cycle.
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
  const hops: Hop[] | undefined = options.hops === false ? undefined : [];
  const done = hops ?? NO_HOPS;
  const failed = (code: ResolveCode | ErrorCode, reason: string): Resolution => ({ ok: false, code, reason, hops: done });
  let collapses = 0;
  const adopt = nav.adopt ?? ((value: unknown): Thing => value);

  const collapse = (thing: Thing): Resolution => {
    let here = thing;
    if (nav.plain === true) return { ok: true, thing: here, hops: done };
    while (isRef(here)) {
      collapses += 1;
      if (collapses > MAX_COLLAPSE) return failed("#CYCLE!", "The references form a cycle.");
      const inner = walk(here.value);
      if (!inner.ok) return inner;
      here = adopt(inner.thing);
      hops?.push({ step: "collapse", thing: here, by: "collapse" });
    }
    return { ok: true, thing: here, hops: done };
  };

  const walk = (steps: readonly unknown[]): Resolution => {
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
      if (isHostThing(here) && here.resolve !== undefined && steps.slice(index).every(isKey)) {
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
        const envelope = isEnvelope(step) ? step : undefined;
        const found = envelope === undefined ? undefined : lookupKind(nav.world, envelope.type);
        const name = found?.ok === true ? entryOf(found.kind.verbs, "step") : undefined;
        const walker = name === undefined ? undefined : nav.walkers?.[name];
        if (envelope === undefined || walker === undefined) {
          return failed("#STEP?", "A step is a key, or a document of a kind with the verb step.");
        }
        const result = walker({
          data: envelope.value,
          here,
          context: ctx,
          deref: (thing, key) => {
            const reached = derefStep(nav, thing, key);
            return reached === undefined ? undefined : adopt(reached.thing);
          },
        });
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
  return walk(path);
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
