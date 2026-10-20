import { type Envelope, type Json, type Key, field, fromJson, isKey, isRecord, typePath } from "./doc.ts";
import { type World, entriesAsJson, lookupKind } from "./world.ts";

/** The brand of a host thing: an object of the host that answers the steps of a path itself. */
export const THING: unique symbol = Symbol("coeval.thing");

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
   * @returns What the step reaches, or `undefined`.
   */
  deref(key: Key): Thing | undefined;
  /**
   * This function gives the thing as a value, when a reference ends on it.
   *
   * @returns The value.
   */
  toJson(): Json;
}

/** Something that a path can reach: a JSON value, or a host thing. */
export type Thing = Json | HostThing;

/**
 * This function tells if a thing is a host thing.
 *
 * @param thing - The thing.
 * @returns `true` for a host thing.
 */
export function isHostThing(thing: Thing | undefined): thing is HostThing {
  return typeof thing === "object" && thing !== null && !Array.isArray(thing) && (thing as Partial<HostThing>)[THING] === true;
}

/** The roots of a context. Each path starts with one of them. */
export const ROOTS = ["self", "names", "world", "event", "caps"] as const;

/** One root of a context. */
export type Root = (typeof ROOTS)[number];

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
  readonly names: Readonly<Record<string, Json>>;
  readonly world: Thing;
  readonly event: Thing;
  readonly caps: readonly string[];
}

/** The code of a `deref` evaluator: it answers one step of a path on a document of its kind. */
export type DerefCode = (doc: Envelope, key: Key) => Thing | undefined;

/** The result of a step document: what it reached, or the reason of a failure. */
export type WalkResult = { readonly ok: true; readonly thing: Thing } | { readonly ok: false; readonly reason: string };

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

/** What a resolution needs: the world, and the code of the `deref` evaluators and of the walkers. */
export interface Navigator {
  readonly world: World;
  readonly derefs?: Readonly<Record<string, DerefCode>>;
  readonly walkers?: Readonly<Record<string, Walker>>;
}

/** The way that one hop of a path was answered. */
export type HopBy = "root" | "own" | "kind" | "default" | "step" | "collapse";

/** One hop of a path: the step, what it reached, and who answered it. */
export interface Hop {
  readonly step: Json;
  readonly thing: Thing;
  readonly by: HopBy;
}

/** The result of a resolution: what the path reached, with each hop, or an error with the hops before it. */
export type Resolution =
  | { readonly ok: true; readonly thing: Thing; readonly hops: readonly Hop[] }
  | { readonly ok: false; readonly code: "#REF!" | "#CYCLE!" | "#STEP?"; readonly reason: string; readonly hops: readonly Hop[] };

function entryOf(verbs: Readonly<Record<string, string>> | undefined, verb: string): string | undefined {
  return verbs !== undefined && Object.hasOwn(verbs, verb) ? verbs[verb] : undefined;
}

function plainStep(thing: Json, key: Key): Json | undefined {
  if (Array.isArray(thing)) {
    const index = typeof key === "number" ? key : /^\d+$/.test(key) ? Number(key) : -1;
    return index >= 0 ? (thing as readonly Json[])[index] : undefined;
  }
  if (isRecord(thing) && typeof key === "string") return field(thing, key);
  return undefined;
}

/**
 * This function answers one step of a path on a thing, through the ladder of the verb `deref`. A host thing
 * answers for itself (own). A document asks its own entry, then its kind. The default goes into the value: a field
 * of a record, or an item of a list.
 *
 * @param nav - The world and the code of the evaluators.
 * @param thing - The thing that the path reached.
 * @param key - The key of the step.
 * @returns What the step reaches and the rung that answered, or `undefined`.
 */
export function derefStep(nav: Navigator, thing: Thing, key: Key): { readonly thing: Thing; readonly by: HopBy } | undefined {
  if (isHostThing(thing)) {
    const reached = thing.deref(key);
    return reached === undefined ? undefined : { thing: reached, by: "own" };
  }
  const envelope = fromJson(thing);
  if (envelope !== undefined) {
    const own = entryOf(envelope.own, "deref");
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
    return reached === undefined ? undefined : { thing: reached, by: "default" };
  }
  const reached = plainStep(thing, key);
  return reached === undefined ? undefined : { thing: reached, by: "default" };
}

/**
 * This function tells if a thing is a reference document: an envelope of the type `ref`.
 *
 * @param thing - The thing.
 * @returns `true` for a reference document.
 */
export function isRef(thing: Thing | undefined): thing is Envelope & { readonly value: readonly Json[] } {
  if (thing === undefined || isHostThing(thing)) return false;
  const envelope = fromJson(thing);
  if (envelope === undefined || !Array.isArray(envelope.value)) return false;
  const path = typePath(envelope.type);
  return path !== undefined && path.length === 1 && path[0] === "ref";
}

/**
 * This function makes the thing of the root `world`: the entries of the world as JSON. An alias is a reference
 * document in it, thus a walk through the world follows each alias (collapse).
 *
 * @param world - The world.
 * @returns The thing.
 */
export function worldThing(world: World): Json {
  return entriesAsJson(world.kinds);
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

/**
 * This function resolves a path from a context, and records each hop.
 *
 * The first step is a root of the context. Each later step is a key or a step document. A key goes up the ladder
 * of the verb `deref` on the thing that the path reached. A step document is evaluated by the walker of its kind,
 * with the thing that the path reached. After each hop, a reference document is followed until the path reaches
 * something else (collapse).
 *
 * @param nav - The world and the code of the evaluators.
 * @param ctx - The context.
 * @param path - The steps.
 * @returns What the path reached and each hop, or an error.
 */
export function resolve(nav: Navigator, ctx: Context, path: readonly Json[]): Resolution {
  const hops: Hop[] = [];
  let collapses = 0;

  const collapse = (thing: Thing): Resolution => {
    let here = thing;
    while (isRef(here)) {
      collapses += 1;
      if (collapses > MAX_COLLAPSE) return { ok: false, code: "#CYCLE!", reason: "The references form a cycle.", hops };
      const inner = walk(here.value);
      if (!inner.ok) return inner;
      here = inner.thing;
      hops.push({ step: here === null ? null : "collapse", thing: here, by: "collapse" });
    }
    return { ok: true, thing: here, hops };
  };

  const walk = (steps: readonly Json[]): Resolution => {
    const [root, ...rest] = steps;
    if (typeof root !== "string" || !(ROOTS as readonly string[]).includes(root)) {
      return { ok: false, code: "#REF!", reason: `A path starts with a root: ${ROOTS.join(", ")}.`, hops };
    }
    let here: Thing = ctx[root as Root] as Thing;
    hops.push({ step: root, thing: here, by: "root" });
    const first = collapse(here);
    if (!first.ok) return first;
    here = first.thing;
    for (const step of rest) {
      if (isKey(step)) {
        const reached = derefStep(nav, here, step);
        if (reached === undefined) return { ok: false, code: "#REF!", reason: `The step ${String(step)} reaches nothing.`, hops };
        hops.push({ step, thing: reached.thing, by: reached.by });
        here = reached.thing;
      } else {
        const envelope = fromJson(step);
        const found = envelope === undefined ? undefined : lookupKind(nav.world, envelope.type);
        const name = found?.ok === true ? entryOf(found.kind.verbs, "step") : undefined;
        const walker = name === undefined ? undefined : nav.walkers?.[name];
        if (envelope === undefined || walker === undefined) {
          return { ok: false, code: "#STEP?", reason: "A step is a key, or a document of a kind with the verb step.", hops };
        }
        const result = walker({
          data: envelope.value,
          here,
          context: ctx,
          deref: (thing, key) => derefStep(nav, thing, key)?.thing,
        });
        if (!result.ok) return { ok: false, code: "#REF!", reason: result.reason, hops };
        hops.push({ step, thing: result.thing, by: "step" });
        here = result.thing;
      }
      const next = collapse(here);
      if (!next.ok) return next;
      here = next.thing;
    }
    return { ok: true, thing: here, hops };
  };

  if (path.length === 0) return { ok: false, code: "#REF!", reason: "A path has at least one step: its root.", hops };
  return walk(path);
}

/**
 * This function gives the value of a thing: the thing itself for JSON, or the value that a host thing gives.
 *
 * @param thing - The thing.
 * @returns The value.
 */
export function valueOfThing(thing: Thing): Json {
  return isHostThing(thing) ? thing.toJson() : thing;
}
