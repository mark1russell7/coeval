import { type Envelope, type Json, type Key, type TypeRef, isEnvelope, isKey, typeName } from "./doc.ts";
import { type PartSlot, type Split, partsOf, pathMatches, scopesOf } from "./parts.ts";
import { answerOf, ask, type Answer } from "./ladder.ts";
import type { CapsRule, Kind, KindFacts, Side } from "./world.ts";
import type { Domain } from "./types.ts";
import type { TypeRule } from "./typing.ts";
import { type ErrorCode, type EvalError, type Result, Failure, fail, ok, placed, thrown, describe } from "./errors.ts";
import {
  type Cap,
  type CompiledPath,
  type Context,
  type Hop,
  type Navigator,
  type Resolution,
  type ResolveOptions,
  type Root,
  type Thing,
  ROOTS,
  context as makeRootContext,
  isHostThing,
  isRef,
  resolve,
  worldThing,
} from "./deref.ts";

export type { Context } from "./deref.ts";
export type { ErrorCode, EvalError, Result } from "./errors.ts";
export { fail, ok } from "./errors.ts";

/**
 * This function makes a context with names and capabilities. The other roots are empty, and an evaluation sets
 * the world.
 *
 * @param names - The names and their values.
 * @param caps - The effects that the term can cause.
 * @param self - The node of the term, if it has one.
 * @returns The context.
 */
export function makeContext(names: Readonly<Record<string, unknown>> = {}, caps: readonly Cap[] = [], self: Thing = null): Context {
  return makeRootContext({ names, caps, self });
}

/**
 * This function gives the keys of a capability or of a kind of effect: a text is split at its dots.
 *
 * @param kind - The text or the keys.
 * @returns The keys, as texts.
 */
export function capKeys(kind: Cap): readonly string[] {
  return typeof kind === "string" ? kind.split(".") : kind.map(String);
}

/**
 * This function tells if the capabilities permit an effect. A capability permits the kind of its name, and each kind
 * under it: `store` permits `store.update`. The comparison is key by key, thus `fs.read` does not permit the
 * kind with the keys `fs` and `read.json`.
 *
 * @param caps - The capabilities of the context.
 * @param kind - The kind of the effect: a text with dots, or its keys.
 * @returns `true` when one capability permits it.
 */
export function permits(caps: readonly Cap[], kind: Cap): boolean {
  const want = capKeys(kind);
  return caps.some((cap) => {
    const have = capKeys(cap);
    return have.length <= want.length && have.every((key, index) => key === want[index]);
  });
}

/**
 * This function narrows a context for a part. The part keeps the meet `intersectCaps` of its list and the list of its
 * parent (CAP.MEET). Thus an evaluator cannot give a part more effects than it has. A context whose list the parent
 * permits stays the same object.
 *
 * @param parent - The context of the parent.
 * @param next - The context that the evaluator gives the part.
 * @returns The context of the part.
 */
export function narrow(parent: Context, next: Context): Context {
  if (next === parent || next.caps === parent.caps) return next;
  const caps = intersectCaps(next.caps, parent.caps);
  return caps === next.caps ? next : { ...next, caps };
}

/** No capabilities. One list serves each masked part. */
const NO_CAPS: readonly Cap[] = /* @__PURE__ */ Object.freeze([]);

/** No capability rules. One list serves each part that no rule narrows. */
const NO_RULES: readonly CapsRule[] = /* @__PURE__ */ Object.freeze([]);

/**
 * This function gives the capabilities that two lists both permit. An effect is permitted by the result when each
 * list permits it. When the list `b` permits each capability of `a`, the result is the list `a` itself.
 *
 * @param a - The first list, for example the capabilities of a document.
 * @param b - The second list, for example the list of a rule `only`.
 * @returns The capabilities that both lists permit.
 */
export function intersectCaps(a: readonly Cap[], b: readonly Cap[]): readonly Cap[] {
  if (a.every((cap) => permits(b, cap))) return a;
  const out: Cap[] = [];
  for (const cap of b) if (permits(a, cap)) out.push(cap);
  for (const cap of a) if (permits(b, cap) && !permits(out, cap)) out.push(cap);
  return out;
}

/** This function gives the capability rules of a kind that cover a part and change its capabilities. */
function rulesFor(rules: readonly CapsRule[] | undefined, path: readonly Key[]): readonly CapsRule[] {
  if (rules === undefined || rules.length === 0) return NO_RULES;
  const out = rules.filter((rule) => rule.rule !== "same" && (rule.in === undefined || rule.in.some((pattern) => pathMatches(path, pattern))));
  return out.length === 0 ? NO_RULES : out;
}

/** This function applies the rules that cover a part to the capabilities of its document. */
function capsUnder(rules: readonly CapsRule[], caps: readonly Cap[]): readonly Cap[] {
  let out = caps;
  for (const rule of rules) {
    if (rule.rule === "mask") return NO_CAPS;
    if (rule.rule === "only") out = intersectCaps(out, rule.caps);
  }
  return out;
}

/**
 * This function gives the capabilities that a kind gives one of its parts, by the capability rules of its contract.
 * The kernel and the static kit both use it, thus a run and a check narrow the same way.
 *
 * @param rules - The capability rules of the kind (`Kind.caps`).
 * @param path - The path of the part in the value of the document.
 * @param caps - The capabilities of the document.
 * @returns The capabilities of the part: the same list or a smaller one.
 */
export function partCaps(rules: readonly CapsRule[] | undefined, path: readonly Key[], caps: readonly Cap[]): readonly Cap[] {
  return capsUnder(rulesFor(rules, path), caps);
}

/**
 * The key of the grant of a context (CAP.NARROW-CODE): the capabilities that the kernel gave the document of the
 * context. A spread of a context keeps its grant. Thus compiled code passes the grant on in each context that it makes
 * from the context of its document. Only the kernel writes a grant.
 */
const GRANT = /* @__PURE__ */ Symbol("coeval.grant");

/**
 * The key of the epoch of a grant (CAP.NARROW-KEPT): the list of capabilities that the host gave the root of the
 * evaluation in which the kernel wrote the grant. A spread of a context keeps its epoch, as it keeps its grant. An
 * effect and a resolution read a context of another epoch as a context without a grant.
 */
const EPOCH = /* @__PURE__ */ Symbol("coeval.epoch");

/** A context with the grant of the kernel and the epoch of that grant. */
type Granted = Context & { readonly [GRANT]?: readonly Cap[]; readonly [EPOCH]?: readonly Cap[] };

/**
 * This function gives the capabilities that a context and its grant both permit, the meet `intersectCaps` (CAP.MEET).
 * A context whose grant is its own list gives that list after one comparison. A context without a grant gives none.
 */
function grantedCaps(ctx: Context): readonly Cap[] {
  const grant = (ctx as Granted)[GRANT];
  if (grant === ctx.caps) return grant;
  return grant === undefined ? NO_CAPS : intersectCaps(ctx.caps, grant);
}

/**
 * This function gives a context whose capabilities its grant permits (CAP.NARROW-CODE, CAP.MEET). A context whose grant
 * is its own list of capabilities stays the same object. Each other context keeps the meet of its list and its grant,
 * and a context without a grant keeps none. The result has the grant of its capabilities.
 */
function granted(ctx: Context): Context {
  if ((ctx as Granted)[GRANT] === ctx.caps) return ctx;
  const caps = grantedCaps(ctx);
  const out: Granted = { ...ctx, caps, [GRANT]: caps };
  return out;
}

/**
 * This function gives a context of another epoch the epoch of the evaluation, without capabilities (CAP.NARROW-KEPT).
 * Thus the context reads as a context without a grant. The kernel cannot know the document of the context in this
 * evaluation.
 */
function ungranted(ctx: Context, epoch: readonly Cap[]): Context {
  const out: Granted = { ...ctx, caps: NO_CAPS, [GRANT]: NO_CAPS, [EPOCH]: epoch };
  return out;
}

/**
 * This function gives the context in which the runtime resolves a path of compiled code (CAP.CAPS-GRANT, CAP.MEET).
 * The context has the meet of its list and its grant, and a context without a grant has none. Thus a read of the root
 * `caps` and a walker of a step document get the capabilities of the document from a widened context.
 * A context that the code narrowed keeps its own list. A context whose list does not change stays the same object.
 * A context of another epoch has no capabilities (CAP.NARROW-KEPT).
 */
function readable(ctx: Context, epoch: readonly Cap[]): Context {
  if ((ctx as Granted)[EPOCH] !== epoch) return ctx.caps.length === 0 ? ctx : ungranted(ctx, epoch);
  const caps = grantedCaps(ctx);
  if (caps === ctx.caps || (caps.length === 0 && ctx.caps.length === 0)) return ctx;
  const out: Granted = { ...ctx, caps, [GRANT]: caps };
  return out;
}

/**
 * This function gives the context of a part of a function evaluator. It is the context that the evaluator gives,
 * narrowed by the context of the document (CAP.NARROW), with the grant of its capabilities. The grant has the epoch
 * of the document, because the document permits each of its capabilities (CAP.NARROW-KEPT).
 */
function handed(parent: Context, next: Context): Context {
  const ctx = narrow(parent, next);
  const epoch = (parent as Granted)[EPOCH];
  if ((ctx as Granted)[GRANT] === ctx.caps && (ctx as Granted)[EPOCH] === epoch) return ctx;
  const out: Granted = { ...ctx, [GRANT]: ctx.caps, [EPOCH]: epoch };
  return out;
}

/**
 * The steps of an evaluation that can wait. It yields a promise only when the host makes it wait. A runner takes the
 * result of a part with `yield*`, thus a run goes on at once until an effect waits. A runner does not yield a
 * promise itself: it uses `yield*` on the steps that the kernel gives.
 */
export type Steps = Generator<Promise<unknown>, Result, unknown>;

/** An effect that an evaluation caused, in the order of the effects. */
export interface Effect {
  /** The number of effects before this effect. Under `all`, this number follows the order of the host. */
  readonly index: number;
  /** The kind of the effect, as a text with dots. */
  readonly kind: string;
  /** The keys of the kind of the effect. */
  readonly path: readonly Key[];
  readonly payload: unknown;
  /** The ID of the trace node that caused the effect, or -1 without a trace. */
  readonly node: number;
  /** The number of events before the effect. The effect comes before the end of its node. */
  readonly at: number;
  /** The keys from the root document to the document that caused the effect. */
  readonly place: readonly Key[];
  /** The context of the document that caused the effect: its names, its node and its capabilities. */
  readonly context: Context;
  /**
   * The stable address of the effect (RUN.ADDRESS). The order of the host does not change it. The address has the
   * keys of the place, a `#` and the count of the earlier effects at that place in its scope. An example is
   * `1/bind/x#0`. Each item of `all` is a scope, and its prefix comes first: `all0.1/` is the item 1 of the first `all`
   * of the scope. The kernel gives each effect its address.
   */
  readonly address?: string;
  /**
   * The outcome of the effect: the result that it gave its document (RUN.OUTCOME). The kernel sets it when the answer
   * comes. It stays `undefined` when the run stops first, for example at an abort.
   */
  readonly outcome?: Result;
}

/**
 * One read of an evaluation: a path that code resolved, and what the path reached (READS.RECORD, D26). A schedule
 * keeps the list of the reads of an evaluation. `verifyReads` resolves each free read again in a new context, and it
 * tells if the old result stays valid.
 */
export interface Read {
  /** The path that the code resolved: its root, and its steps with the value of each step document. */
  readonly path: readonly unknown[];
  /**
   * What the path reached: the thing, or the error of the resolution. A host thing stays a thing. An exception of the
   * host gives its error value.
   */
  readonly reached: Result;
  /**
   * `true` when the read reads the context of the evaluation (READS.FREE). A read of a name that a kind binds, for
   * example a name of `let`, is not free. A read of a `self` that a kind sets is not free either, for example a node
   * of a tree. A path without a root is not free. `verifyReads` resolves only the free reads again.
   */
  readonly free: boolean;
  /**
   * `true` when the kernel adds the read, because a value keeps a root of the context for later (READS.KEPT). Such a
   * read has the whole root as its path.
   */
  readonly kept?: true;
  /** The hops of the resolution, only when the code asked for them. `verifyReads` then compares each hop too. */
  readonly hops?: readonly Hop[];
}

/** The text that names a resolution in the error of an exception of the host. */
const READ_FAILED = "the resolution of a path";

/**
 * This function gives what a resolution reached as a result: the thing, or the error with its code and its reason.
 * The record of a read and `verifyReads` share it.
 *
 * @param found - The resolution.
 * @returns The result.
 */
export function reachedOf(found: Resolution): Result {
  return found.ok ? ok(found.thing) : fail(found.code, found.reason);
}

/**
 * This function resolves the path of a read, and it gives an exception of the host as an error value. The record of
 * a kept read and `verifyReads` use it.
 *
 * @param nav - The world and the code of the evaluators.
 * @param ctx - The context.
 * @param path - The path.
 * @param hops - `true` records each hop.
 * @returns What the path reached, and the hops when the resolution gave them.
 */
export function readAgain(nav: Navigator, ctx: Context, path: readonly unknown[], hops: boolean): { readonly reached: Result; readonly hops?: readonly Hop[] } {
  try {
    const found = resolve(nav, ctx, path, hops ? WITH_HOPS : WITHOUT_HOPS);
    return hops ? { reached: reachedOf(found), hops: found.hops } : { reached: reachedOf(found) };
  } catch (error) {
    return { reached: thrown(error, READ_FAILED) };
  }
}

/**
 * This function tells if a read reads the context at the root of the evaluation (READS.FREE). A kind can bind a name
 * or set `self` for its parts, and a read of that binding is not free. A path without a root reads no context. A read
 * of each other root is free. When a kind changes such a root, the read resolves again to another value, thus
 * `verifyReads` only does more work.
 */
function isFree(root: Context, ctx: Context, path: readonly unknown[]): boolean {
  const head = path[0];
  if (head === "self") return ctx === root || Object.is(ctx.self, root.self);
  if (head !== "names") return typeof head === "string" && (ROOTS as readonly string[]).includes(head);
  if (ctx === root || ctx.names === root.names) return true;
  const name = path[1];
  // A read of the whole record of the names reads each free name too.
  if (!isKey(name)) return true;
  const key = String(name);
  const has = Object.hasOwn(ctx.names, key);
  return has === Object.hasOwn(root.names, key) && (!has || Object.is(ctx.names[key], root.names[key]));
}

/**
 * The host side of a run: it does one effect, and gives its result. A throw or a rejection is an error value, and a
 * `Failure` gives its own error value. In an evaluation, this function is a mock: it answers at once, and a promise
 * from it gives `#CALC!` (RUN.MOCK).
 */
export type Perform = (effect: Effect) => unknown;

/** The key of the journal of a recorder or of a replayer, on its function. Two copies of the kernel share it. */
export const JOURNAL: unique symbol = /* @__PURE__ */ Symbol.for("coeval.journal") as never;

/**
 * The journal of a recorder or of a replayer, on its function `perform`. The kernel tells it the order in which the
 * waits of each `all` settle. In a replay, the kernel asks the journal for that order (RUN.RECORD, RUN.REPLAY).
 */
export interface Journal {
  /**
   * This function gets the item whose wait settled.
   *
   * @param all - The address of the `all`, for example `all0` or `all0.1/all0`.
   * @param item - The index of the item.
   */
  readonly settled?: (all: string, item: number) => void;
  /**
   * This function gives the item whose wait settles next.
   *
   * @param all - The address of the `all`.
   * @param waiting - The indices of the items that wait.
   * @returns The index of an item that waits, or `undefined` for the order of the host.
   */
  readonly next?: (all: string, waiting: readonly number[]) => number | undefined;
}

/** This function gives the journal of a function `perform`, when it has one. */
function journalOf(perform: Perform | undefined): Journal | undefined {
  return perform === undefined ? undefined : (perform as { readonly [JOURNAL]?: Journal })[JOURNAL];
}

/**
 * This function gives the outcome of an effect that the host failed. A `Failure` gives its own error value, for
 * example the recorded error of a replay or `#REPLAY!`. Each other exception gives `#CALC!`, with the exception as the
 * cause (RUN.CAUSE).
 */
function hostFailed(kind: string, place: readonly Key[], error: unknown): Result {
  if (error instanceof Failure) return placed({ ok: false, error: error.error }, place);
  return fail("#CALC!", `The host failed the effect ${kind}: ${describe(error)}`, { place, cause: error });
}

/**
 * The scope of the addresses of effects (RUN.ADDRESS). The root of an evaluation is one scope, and each item of `all`
 * is a scope. The code of one scope does not interleave with itself, thus its counts do not depend on the host.
 */
interface Scope {
  /** The text before each address of the scope, for example `all0.1/`. */
  readonly prefix: string;
  /** The number of earlier effects at each place, by the text of the place. It is made at the first effect. */
  counts: Map<string, number> | undefined;
  /** The number of earlier uses of `all` in the scope. */
  alls: number;
}

/**
 * This function gives the text of a place in an address: each key, with a slash between two keys. A text key with
 * other characters than letters, digits, `_`, `$` and `-` gets quotes.
 *
 * @param place - The keys from the root document to a document.
 * @returns The text of the place.
 */
export function placeText(place: readonly Key[]): string {
  let text = "";
  for (let index = 0; index < place.length; index += 1) {
    const key = place[index] as Key;
    if (index > 0) text += "/";
    text += typeof key === "number" || /^[\w$-]+$/.test(key) ? String(key) : JSON.stringify(key);
  }
  return text;
}

/** An effect while the kernel waits for its outcome. */
type Recorded = { -readonly [K in keyof Effect]: Effect[K] };

/**
 * The runtime of one evaluation or run. Compiled code gets it with the context, and asks it to resolve paths and
 * to cause effects.
 */
export interface Runtime {
  readonly machine: Machine;
  /** `true` in a run: the host does each effect, and a part that waits needs a parent that can wait. */
  readonly running: boolean;
  /**
   * This function resolves a path from a context.
   *
   * @param ctx - The context.
   * @param path - The steps. The first step is a root.
   * @param options - `hops: true` records each hop. The default records them only in a traced evaluation.
   * @returns What the path reached, or an error.
   */
  resolve(ctx: Context, path: readonly unknown[], options?: ResolveOptions): Resolution;
  /**
   * This function causes an effect from an evaluator. In a run, an evaluator cannot cause an effect: the host does
   * each effect, thus only a runner can wait for it.
   *
   * @param ctx - The context of the document. It gives only the capabilities that the document has (CAP.NARROW-CODE).
   * @param kind - The kind of the effect.
   * @param payload - The data of the effect.
   * @param place - The place of the document.
   * @returns The answer of the mock, the payload without a mock, or an error value.
   */
  effect(ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Result;
  /**
   * This function causes an effect from a runner. In a run, the host does it, and the steps wait when the host
   * waits.
   *
   * @param ctx - The context of the document. It gives only the capabilities that the document has (CAP.NARROW-CODE).
   * @param kind - The kind of the effect.
   * @param payload - The data of the effect.
   * @param place - The place of the document.
   * @returns The steps that give the result of the host, or an error value.
   */
  runEffect(ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Steps;
  /**
   * This function drives several steps at the same time. When one waits, the others go on.
   *
   * @param list - One function for each item. Each function starts the steps of its item.
   * @param options - The most items that run at the same time, and the stop at the first failure.
   * @returns The steps that give each result, in the order of the list.
   */
  all(list: readonly (() => Steps)[], options?: AllOptions): Generator<Promise<unknown>, readonly Result[], unknown>;
  /**
   * This optional function tells the runtime that a value keeps the context for later, for example a closure of
   * `fn`. A later use of the value reads that context, and no evaluation records these reads. Thus the list of reads
   * gets a read of each root of the context (READS.KEPT).
   */
  keepsContext?(): void;
}

/**
 * The options of a drive of parts at the same time.
 *
 * - `concurrency`: the most parts that run at the same time. The default is each part.
 * - `failFast`: `true` stops at the first part that fails. The parts that did not start do not start, the parts that
 *   run stop at their wait, and the results come at once. Each part without a result gives `#ABORT`.
 */
export interface AllOptions {
  readonly concurrency?: number;
  readonly failFast?: boolean;
}

/**
 * Compiled code: the evaluation of a document in a context. The code gives each part a context that it makes from
 * its own context with a spread. The part then keeps only the capabilities of the document (CAP.NARROW-CODE). A
 * context that the code makes without a spread gives the part no capabilities.
 */
export type Code = (ctx: Context, rt: Runtime) => Result;

/**
 * Compiled code that can wait: the run of a document in a context. Its parts keep only the capabilities of the
 * document, as for `Code`.
 */
export type RunCode = (ctx: Context, rt: Runtime) => Steps;

/** A compiled part: its place in its parent, its binding name, and its code. It has no field with its value. */
export interface CompiledPart {
  /** The path in the value of the parent as one text, for example `0` or `bind.x`. */
  readonly key: string;
  /** The keys from the value of the parent to the part. */
  readonly path: readonly Key[];
  /** The binding name from the header of the part. */
  readonly name?: string;
  /** The code that evaluates the part. */
  readonly code: Code;
  /** The code that runs the part. Its steps can wait. */
  readonly run: RunCode;
}

/** The input of a compiler: the document, its kind, and its parts, compiled. */
export interface CompileInput {
  /** The text of the type of the document, for example `add` or `math.sum` after its alias. */
  readonly kind: string;
  /** The keys of the kind after each alias. */
  readonly typePath: readonly Key[];
  readonly doc: Envelope;
  /** The value of the document with a compiled part in the place of each part. */
  readonly value: unknown;
  /** The value of the document without its parts. */
  readonly data: Json;
  /** The compiled parts, in the order of the value. */
  readonly parts: readonly CompiledPart[];
  /** The keys from the root document to this document. */
  readonly place: readonly Key[];
  readonly machine: Machine;
  /**
   * This function gives the value of the document with an item in the place of each part. The containers on the way
   * to a part are new. The data around the parts stays the same objects.
   *
   * @param items - One item for each part, in the order of `parts`, for example the results of the parts.
   * @returns The value with the items.
   */
  fill(items: readonly unknown[]): unknown;
  /** `true` when the position of the document declares an address. A reference there gives the thing, not its value. */
  readonly address?: boolean;
}

/**
 * A sealed part. An evaluator can read the binding name of a part and evaluate it. It cannot read the value of the
 * part, thus two parts that give the same results can replace each other.
 */
export interface Part {
  /** The path in the value of the parent as one text, for example `0` or `bind.x`. */
  readonly key: string;
  /** The keys from the value of the parent to the part. */
  readonly path: readonly Key[];
  /** The binding name from the header of the part. */
  readonly name?: string;
  /**
   * This function evaluates the part. Each call is a new evaluation.
   *
   * @param context - The context for the part. The default is the context of the parent.
   * @returns The result of the part.
   */
  evaluate(context?: Context): Result;
}

/** The input of an evaluator. */
export interface EvalInput {
  /** The text of the type of the document, for example `add` or `math.sum` after its alias. */
  readonly kind: string;
  /** The keys of the kind after each alias. */
  readonly typePath: readonly Key[];
  readonly doc: Envelope;
  /** The value of the document with a sealed part in the place of each part. */
  readonly value: unknown;
  /** The value of the document without its parts. */
  readonly data: Json;
  /** The parts, in the order of the value. */
  readonly parts: readonly Part[];
  /** The context of the document. */
  readonly context: Context;
  /** The keys from the root document to this document. */
  readonly place: readonly Key[];
  /** The machine of the evaluation, for example for its domains (D40). The kernel sets it. */
  readonly machine?: Machine;
  /** `true` when the position of the document declares an address. */
  readonly address?: boolean;
  /**
   * This function resolves a path from the context of the document.
   *
   * @param path - The steps. The first step is a root.
   * @param options - `hops: true` records each hop.
   * @returns What the path reached, or an error.
   */
  resolve(path: readonly unknown[], options?: ResolveOptions): Resolution;
  /**
   * This function causes an effect. The context must have the capability for the kind of the effect. In a run, an
   * evaluator cannot cause an effect: the host does each effect, thus only a runner can wait for it.
   *
   * @param kind - The kind of the effect, for example `log`.
   * @param payload - The data of the effect.
   * @returns The answer of the mock, the payload without a mock, or an error value, for example `#CAP!`.
   */
  effect(kind: Cap, payload: unknown): Result;
  /**
   * This function gives the value of the document with an item in the place of each part, for example the result of
   * each part. The containers on the way to a part are new. The data around the parts stays the same objects.
   *
   * @param items - One item for each part, in the order of `parts`.
   * @returns The value with the items.
   */
  fill(items: readonly unknown[]): unknown;
}

/** A part for a runner. Its evaluation can wait for the effects in it. */
export interface RunPart {
  /** The path in the value of the parent as one text. */
  readonly key: string;
  /** The keys from the value of the parent to the part. */
  readonly path: readonly Key[];
  /** The binding name from the header of the part. */
  readonly name?: string;
  /**
   * This function evaluates the part. Each call is a new evaluation. Take its result with `yield*`.
   *
   * @param context - The context for the part. The default is the context of the parent.
   * @returns The steps of the evaluation of the part.
   */
  evaluate(context?: Context): Steps;
}

/** The input of a runner: the input of an evaluator, with parts and effects that can wait. */
export interface RunInput {
  readonly kind: string;
  readonly typePath: readonly Key[];
  readonly doc: Envelope;
  /** The value of the document with a part for a runner in the place of each part. */
  readonly value: unknown;
  readonly data: Json;
  readonly parts: readonly RunPart[];
  readonly context: Context;
  readonly place: readonly Key[];
  /** The machine of the evaluation, for example for its domains (D40). The kernel sets it. */
  readonly machine?: Machine;
  resolve(path: readonly unknown[], options?: ResolveOptions): Resolution;
  /**
   * This function causes an effect. In a run, the host does the effect, and the steps wait when the host waits. In
   * an evaluation, a mock answers the effect at once, or the effect gives its payload. Take its result with `yield*`.
   *
   * @param kind - The kind of the effect, for example `log`.
   * @param payload - The data of the effect.
   * @returns The steps that give the result of the host, or an error value.
   */
  effect(kind: Cap, payload: unknown): Steps;
  /**
   * This function evaluates parts at the same time. Take the results with `yield*`. A runner can give its own parts,
   * for example a part with a different context: each part needs only the function `evaluate`.
   *
   * @param parts - The parts.
   * @param options - The most parts that run at the same time, and the stop at the first failure.
   * @returns The steps that give each result, in the order of the parts.
   */
  all(parts: readonly RunPart[], options?: AllOptions): Generator<Promise<unknown>, readonly Result[], unknown>;
  /**
   * This function gives the value of the document with an item in the place of each part, for example the result of
   * each part. The containers on the way to a part are new. The data around the parts stays the same objects.
   *
   * @param items - One item for each part, in the order of `parts`.
   * @returns The value with the items.
   */
  fill(items: readonly unknown[]): unknown;
}

/** An evaluator that is a function of its input. The kernel calls it for each evaluation. */
export type EvalFn = (input: EvalInput) => Result;

/** An evaluator that compiles a document one time into code. The code then evaluates it many times. */
export interface CompiledEvaluator {
  /**
   * This function compiles a document.
   *
   * @param input - The document, its kind and its compiled parts.
   * @returns The code that evaluates the document.
   */
  readonly compile: (input: CompileInput) => Code;
  /**
   * The type rule of the evaluator: the value types that a check of types gives its documents and their parts
   * (TYPE.RULE). Only a check reads it. An evaluator without a rule gives `unknown`.
   */
  readonly type?: TypeRule;
}

/** An evaluator: a function of its input, or a compiler. */
export type Evaluator = EvalFn | CompiledEvaluator;

/** A runner that is a generator function of its input. */
export type RunFn = (input: RunInput) => Steps;

/** A runner that compiles a document one time into code that can wait. */
export interface CompiledRunner {
  /**
   * This function compiles a document.
   *
   * @param input - The document, its kind and its compiled parts.
   * @returns The code that runs the document.
   */
  readonly compileRun: (input: CompileInput) => RunCode;
}

/**
 * A runner: the code of a kind whose parts or effects can wait. The same runner serves an evaluation, which does
 * not wait at any time, and a run, in which the host does each effect.
 */
export type Runner = RunFn | CompiledRunner;

/**
 * A machine: a world of kinds, and the code of each evaluator name, of each `deref` and of each walker.
 *
 * - `maxDepth`: the deepest nesting of documents. The default is 1000.
 * - `permits`: the rule of the host for an effect. The default is the function `permits` on the capabilities. A run,
 *   `check` and `effectsOf` ask it (CAP.PERMITS). In a check, its context has only the capabilities and the world.
 * - `known`: the names that the evaluators know, for `check`. Without it, `check` does not check such names.
 * - `domains`: the value domains of the language, by the name of their base type (D22).
 * - `facts`: the static facts of the names that a fallback kind covers, for `factsOf` (D24).
 */
export interface Machine extends Navigator {
  readonly evaluators: Readonly<Record<string, Evaluator>>;
  /** The runners, by evaluator name. A runner wins over an evaluator of the same name. */
  readonly runners?: Readonly<Record<string, Runner>>;
  readonly maxDepth?: number;
  readonly permits?: (caps: readonly Cap[], kind: readonly Key[], context: Context) => boolean;
  /**
   * This function tells if an evaluator knows the name in the path of a kind. An example is the operation
   * `["ops", "add"]` of a formula language: a fallback kind names it, and the evaluator finds it in a table.
   * `check` asks it for each document with an evaluator. The function must be pure.
   *
   * @param path - The keys of the kind of the document, after each alias.
   * @param evaluator - The name of the evaluator that the ladder of the verb of the check gives the document.
   * @returns `true` when the evaluator knows the name, or else the reason of the `#NAME?` that a run gives.
   */
  readonly known?: (path: readonly Key[], evaluator: string) => true | string;
  /**
   * The value domains of the language, by the name of their base type, for example a color or a unit of length. A
   * check reads them through `fits` and `member`. A domain of the kernel that the table does not name comes from
   * `STD_DOMAINS`.
   */
  readonly domains?: Readonly<Record<string, Domain>>;
  /**
   * This function gives the static facts of the code of a name, for `factsOf` (D24). An example is the operation
   * `["ops", "now"]` of a formula language: a fallback kind names it, and only the language knows that it is volatile.
   * Each field of the answer wins over the same field of the contract of the kind. The function must be pure.
   *
   * @param path - The keys of the kind of the document, after each alias.
   * @param code - The name of the evaluator of the document, or of the walker of a step document.
   * @returns The facts, or `undefined` for the facts of the contract.
   */
  readonly facts?: (path: readonly Key[], code: string) => KindFacts | undefined;
}

/** One evaluation in a trace. The children are the evaluations of its parts, in the order that they started. */
export interface TraceNode {
  readonly id: number;
  /** The keys from the root document to this document, as texts. */
  readonly path: readonly string[];
  /** The document. A bare value has the type that its position declares. */
  readonly doc: Envelope;
  /** `true` when the type came from the container and not from an envelope. */
  readonly declared: boolean;
  /** The answer of the ladder to the verb of the plan, `eval` by default. */
  readonly answer: Answer;
  readonly side: Side;
  /** The names that the document could read when its evaluation started. */
  readonly names: readonly string[];
  /** The names and their values when the evaluation started. */
  readonly scope: Readonly<Record<string, unknown>>;
  /** The capabilities that the document had when its evaluation started. */
  readonly caps: readonly Cap[];
  /** A short text for the root `self` when the evaluation started. */
  readonly self: string;
  /** The time of the start. Each start and each end takes one tick. */
  readonly enter: number;
  /** The time of the end. */
  readonly exit: number;
  readonly result: Result;
  readonly children: readonly TraceNode[];
  /** The indices of the effects that this document caused itself. */
  readonly effects: readonly number[];
}

/** The record of one evaluation of a document. */
export interface Run {
  readonly result: Result;
  readonly trace: TraceNode;
  readonly effects: readonly Effect[];
  /** The number of ticks. */
  readonly time: number;
}

interface Building {
  id: number;
  path: readonly string[];
  doc: Envelope;
  declared: boolean;
  answer: Answer;
  side: Side;
  names: readonly string[];
  scope: Readonly<Record<string, unknown>>;
  caps: readonly Cap[];
  self: string;
  enter: number;
  exit: number;
  result: Result;
  children: Building[];
  effects: number[];
}

/** What a trace node knows from the compilation. */
interface Meta {
  readonly path: readonly string[];
  readonly doc: Envelope;
  readonly declared: boolean;
  readonly answer: Answer;
  readonly side: Side;
}

function selfLabel(self: Thing): string {
  try {
    if (isHostThing(self)) return self.label;
    if (self === null || self === undefined) return "none";
    return (JSON.stringify(self) ?? describe(self)).slice(0, 40);
  } catch {
    return describe(self).slice(0, 40);
  }
}

const NO_ANSWER: Answer = { verb: "eval", error: "no-answer", steps: [] };

/** A signal of the host that stops a run: the shape of the standard `AbortSignal`. */
export interface StopSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: "abort", listener: () => void, options?: { readonly once?: boolean }): void;
}

/**
 * The options of `plan.run`. A plan keeps the verb and the declared type of its `prepare`, thus these options do not
 * have them (PLAN.RUN-OPTIONS).
 */
export interface PlanRunOptions {
  /** The host code that does each effect. Without it, an effect gives its payload, as in an evaluation. */
  readonly perform?: Perform;
  /** A signal of the host. When it aborts, the run stops with `#ABORT`. */
  readonly signal?: StopSignal;
  /**
   * A list that gets each read, in the order of the resolutions (READS.RECORD). Under `all`, the order of the host
   * decides the order of the reads of the items.
   */
  readonly reads?: Read[];
}

/** The options of `run`: the options of `plan.run`, and the type of a bare root value and the verb for `prepare`. */
export interface RunOptions extends PlanRunOptions {
  /** The type of a bare root value. */
  readonly declaredType?: string;
  /** The verb of `run`, for example `format`. The default is `eval` (VERB.PREPARE). */
  readonly verb?: string;
}

/** The options of an evaluation of a plan. */
export interface EvalOptions {
  /** A list that gets each effect, in its order. */
  readonly effects?: Effect[];
  /**
   * The mock of the host (RUN.MOCK). It answers each effect at once, and its answer is the result of the effect.
   * Without it, an effect gives its payload (RUN.EVAL).
   */
  readonly perform?: Perform;
  /**
   * A list that gets each read, in the order of the resolutions (READS.RECORD). Without it, the plan records no read,
   * and each resolution costs one more test.
   */
  readonly reads?: Read[];
}

/** The options of `evaluate`. */
export interface EvaluateOptions {
  /** The type of a bare root value. */
  readonly declaredType?: string;
  /** The verb that goes up the ladder at each document, for example `format`. The default is `eval` (VERB.PREPARE). */
  readonly verb?: string;
  /** The mock of the host (RUN.MOCK). Without it, an effect gives its payload (RUN.EVAL). */
  readonly perform?: Perform;
  /** A list that gets each read, in the order of the resolutions (READS.RECORD). */
  readonly reads?: Read[];
}

/** The options of a resolution without a record of hops, and with one. One object of each serves each call. */
const WITHOUT_HOPS: ResolveOptions = /* @__PURE__ */ Object.freeze({ hops: false });
const WITH_HOPS: ResolveOptions = /* @__PURE__ */ Object.freeze({ hops: true });

/** The record of the reads of one evaluation (READS.RECORD). */
interface Reading {
  readonly list: Read[];
  /** The context at the root of the evaluation. A free read has the binding of this context. */
  readonly root: Context;
  /** `true` after the kernel added a read of each root (READS.KEPT). */
  kept: boolean;
  /** `true` after the kernel added the read of the root `self`. */
  self: boolean;
}

/** This function makes the record of the reads of an evaluation, when the host gives a list. */
function readingOf(list: Read[] | undefined, root: Context): Reading | undefined {
  return list === undefined ? undefined : { list, root, kept: false, self: false };
}

/** This class holds the state of one evaluation or run: the machine, the effects, the clock and the trace. */
class Session implements Runtime {
  /** The list of the effects. It is made at the first effect, thus an evaluation without effects makes no list. */
  private list: Effect[] | undefined;
  tick = 0;
  nextId = 0;
  current: Building | undefined;
  readonly holder: Building | undefined;
  /**
   * The scope of the addresses of the code that runs at this time (RUN.ADDRESS). `all` changes it for each item. The
   * root scope is made at the first effect or `all`, thus an evaluation without effects makes no scope.
   */
  private scope: Scope | undefined;

  constructor(
    readonly machine: Machine,
    /**
     * The epoch of the evaluation: the list of capabilities that the host gave the root (CAP.NARROW-KEPT). A context
     * keeps its grant only in an evaluation of the same epoch.
     */
    readonly epoch: readonly Cap[],
    readonly running: boolean,
    readonly traced: boolean,
    readonly perform: Perform | undefined,
    readonly signal: StopSignal | undefined,
    effects: Effect[] | undefined,
    /** The record of the reads. Without it, a resolution records nothing. */
    private readonly reading: Reading | undefined = undefined,
  ) {
    this.list = effects;
    this.holder = traced ? holderNode() : undefined;
    this.current = this.holder;
  }

  /** The effects of the evaluation, in their order. */
  get effects(): Effect[] {
    return (this.list ??= []);
  }

  /** `true` when the evaluation records its reads. Then folded code evaluates again, thus each read goes in the list (PLAN.FOLD). */
  get recording(): boolean {
    return this.reading !== undefined;
  }

  /**
   * This function resolves a path in the context that the grant permits (CAP.CAPS-GRANT, CAP.MEET). Thus the root
   * `caps` and a walker of a step document get the capabilities of the document.
   */
  resolve(ctx: Context, path: readonly unknown[], options?: ResolveOptions): Resolution {
    return this.read(readable(ctx, this.epoch), path, undefined, options);
  }

  /**
   * This function resolves a compiled path (PLAN.PATH). Without a list of reads and without a trace, the compiled
   * path answers at once. Each other resolution records its read, as `resolve` does. The path resolves in the context
   * that the grant permits (CAP.CAPS-GRANT, CAP.MEET).
   */
  resolvePath(given: Context, compiled: CompiledPath): Resolution {
    const ctx = readable(given, this.epoch);
    if (this.reading === undefined && !this.traced && compiled.nav === this.machine) return compiled.resolve(ctx);
    return this.read(ctx, compiled.path, compiled, undefined);
  }

  /** This function resolves a path, and records its read when the evaluation has a list of reads (READS.RECORD). */
  private read(ctx: Context, path: readonly unknown[], compiled: CompiledPath | undefined, options: ResolveOptions | undefined): Resolution {
    const hops = options?.hops ?? this.traced;
    const reading = this.reading;
    if (reading === undefined) return this.find(ctx, path, compiled, hops);
    const free = isFree(reading.root, ctx, path);
    // A kind that sets another self can give the old self on, as the parent of a node of a tree does (READS.KEPT).
    if (!free && path[0] === "self" && !reading.self) this.keep(reading, ["self"]);
    // A free read of the whole root self already holds what a kept read of self holds, as the root of a tree reads it.
    else if (free && path.length === 1 && path[0] === "self") reading.self = true;
    let found: Resolution;
    try {
      found = this.find(ctx, path, compiled, hops);
    } catch (error) {
      reading.list.push({ path, reached: thrown(error, READ_FAILED), free });
      throw error;
    }
    const asked = options?.hops === true;
    reading.list.push(asked ? { path, reached: reachedOf(found), free, hops: found.hops } : { path, reached: reachedOf(found), free });
    return found;
  }

  /**
   * This function resolves the steps of a path. A compiled path of this machine answers a resolution without hops. A
   * resolution with hops, and a path that compiled for another navigator, resolve the steps again.
   */
  private find(ctx: Context, path: readonly unknown[], compiled: CompiledPath | undefined, hops: boolean): Resolution {
    if (compiled !== undefined && !hops && compiled.nav === this.machine) return compiled.resolve(ctx);
    return resolve(this.machine, ctx, path, hops ? WITH_HOPS : WITHOUT_HOPS);
  }

  keepsContext(): void {
    const reading = this.reading;
    if (reading === undefined || reading.kept) return;
    reading.kept = true;
    this.keep(reading, reading.self ? ROOTS.filter((root) => root !== "self") : ROOTS);
  }

  /**
   * This function adds a read of each whole root to the list, from the context at the root (READS.KEPT). An exception
   * of the host gives the error value of the read, because the evaluation did not ask for the read.
   */
  private keep(reading: Reading, roots: readonly Root[]): void {
    for (const root of roots) {
      if (root === "self") reading.self = true;
      const path = [root];
      reading.list.push({ path, reached: readAgain(this.machine, reading.root, path, false).reached, free: true, kept: true });
    }
  }

  private permitted(ctx: Context, keys: readonly Key[]): boolean {
    return this.machine.permits === undefined ? permits(ctx.caps, keys) : this.machine.permits(ctx.caps, keys, ctx);
  }

  /**
   * This function checks the capability of an effect, and records the effect with its address (RUN.ADDRESS). The
   * context keeps only the capabilities of its grant, thus compiled code cannot widen the context of its own effect
   * (CAP.NARROW-CODE). A context of another epoch has no capabilities, thus code cannot keep a context for a later
   * evaluation with fewer capabilities (CAP.NARROW-KEPT).
   */
  private record(given: Context, kind: Cap, payload: unknown, place: readonly Key[]): Result | Recorded {
    const ctx = (given as Granted)[EPOCH] === this.epoch ? granted(given) : ungranted(given, this.epoch);
    const keys = typeof kind === "string" ? kind.split(".") : kind;
    const text = keys.join(".");
    if (!this.permitted(ctx, keys)) return fail("#CAP!", `The context has no capability for the effect ${text}.`, { place });
    const node = this.current;
    const list = this.effects;
    const scope = (this.scope ??= { prefix: "", counts: undefined, alls: 0 });
    const at = placeText(place);
    const counts = (scope.counts ??= new Map<string, number>());
    const count = counts.get(at) ?? 0;
    counts.set(at, count + 1);
    const effect: Recorded = {
      index: list.length,
      kind: text,
      path: keys,
      payload,
      node: node?.id ?? -1,
      at: this.tick,
      place,
      context: ctx,
      address: `${scope.prefix}${at}#${count}`,
    };
    list.push(effect);
    if (node !== undefined) node.effects.push(effect.index);
    return effect;
  }

  /**
   * This function answers an effect at once, without a wait: the mock gives the result, or the effect gives its
   * payload without a mock (RUN.MOCK, RUN.EVAL). A promise from the mock gives `#CALC!`.
   */
  private answer(effect: Recorded, place: readonly Key[]): Result {
    const perform = this.perform;
    if (perform === undefined) return (effect.outcome = ok(effect.payload));
    let done: unknown;
    try {
      done = perform(effect);
    } catch (error) {
      return (effect.outcome = hostFailed(effect.kind, place, error));
    }
    if (!(done instanceof Promise)) return (effect.outcome = ok(done));
    // The evaluation does not read the promise, thus its rejection must not be unhandled.
    void done.catch(() => undefined);
    return (effect.outcome = fail("#CALC!", `The mock gave a promise for the effect ${effect.kind}, and an evaluation does not wait.`, { place }));
  }

  effect(ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Result {
    const text = typeof kind === "string" ? kind : kind.join(".");
    if (this.running) return fail("#CALC!", `The effect ${text} needs a runner: in a run, the host does each effect.`, { place });
    const made = this.record(ctx, kind, payload, place);
    return "ok" in made ? made : this.answer(made, place);
  }

  *runEffect(ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Steps {
    const made = this.record(ctx, kind, payload, place);
    if ("ok" in made) return made;
    const perform = this.perform;
    if (!this.running || perform === undefined) return this.answer(made, place);
    let done: unknown;
    try {
      done = perform(made);
    } catch (error) {
      return (made.outcome = hostFailed(made.kind, place, error));
    }
    if (!(done instanceof Promise)) return (made.outcome = ok(done));
    const result = (yield done.then(
      (value: unknown) => ok(value),
      (error: unknown) => hostFailed(made.kind, place, error),
    )) as Result;
    // A run that stops at this wait does not reach this line, thus the effect keeps no outcome (RUN.OUTCOME).
    return (made.outcome = result);
  }

  *all(list: readonly (() => Steps)[], options: AllOptions = {}): Generator<Promise<unknown>, readonly Result[], unknown> {
    const results: Result[] = new Array<Result>(list.length);
    const limit = Math.max(1, options.concurrency ?? list.length);
    const failFast = options.failFast === true;
    // The address of this call, and a scope for each item (RUN.ADDRESS). The journal of a replay reads the address.
    const outer = (this.scope ??= { prefix: "", counts: undefined, alls: 0 });
    const address = `${outer.prefix}all${outer.alls}`;
    outer.alls += 1;
    const scopes: Scope[] = new Array<Scope>(list.length);
    const journal = journalOf(this.perform);
    let failed = false;
    interface Active {
      readonly index: number;
      readonly steps: Steps;
      pending: Promise<unknown>;
    }
    const active: Active[] = [];
    let next = 0;
    const settle = (index: number, result: Result): void => {
      results[index] = result;
      if (failFast && !result.ok) failed = true;
    };
    const advance = (index: number, steps: Steps, input: { readonly value?: unknown; readonly error?: unknown; readonly threw: boolean }): void => {
      let step: IteratorResult<Promise<unknown>, Result>;
      const before = this.scope;
      this.scope = scopes[index] as Scope;
      try {
        step = input.threw ? steps.throw(input.error) : steps.next(input.value);
      } catch (error) {
        settle(index, thrown(error, "a part"));
        return;
      } finally {
        this.scope = before;
      }
      if (step.done === true) {
        settle(index, step.value);
        return;
      }
      const item: Active = { index, steps, pending: Promise.resolve() };
      item.pending = step.value.then(
        (value) => ({ item, value, threw: false }),
        (error: unknown) => ({ item, error, threw: true }),
      );
      active.push(item);
    };
    const start = (): void => {
      while (!failed && active.length < limit && next < list.length) {
        const index = next;
        next += 1;
        const scope: Scope = { prefix: `${address}.${index}/`, counts: undefined, alls: 0 };
        scopes[index] = scope;
        const begin = list[index] as () => Steps;
        let steps: Steps;
        const before = this.scope;
        this.scope = scope;
        try {
          steps = begin();
        } catch (error) {
          settle(index, thrown(error, "a part"));
          continue;
        } finally {
          this.scope = before;
        }
        advance(index, steps, { threw: false });
      }
    };
    start();
    while (active.length > 0 && !failed) {
      // A replay settles the waits in the recorded order. Each other run takes the first wait that settles.
      const chosen = journal?.next?.(address, active.map((item) => item.index));
      const pick = chosen === undefined ? undefined : active.find((item) => item.index === chosen);
      const settled = (yield pick === undefined ? Promise.race(active.map((item) => item.pending)) : pick.pending) as {
        readonly item: Active;
        readonly value?: unknown;
        readonly error?: unknown;
        readonly threw: boolean;
      };
      journal?.settled?.(address, settled.item.index);
      active.splice(active.indexOf(settled.item), 1);
      advance(settled.item.index, settled.item.steps, settled);
      start();
    }
    if (!failed) return results;
    const stopped = fail("#ABORT", "The part stopped: a part before it failed, and the parts run with failFast.");
    for (const item of active) {
      try {
        item.steps.return(stopped);
      } catch {
        // The finally code of a part threw. The part stops with the abort.
      }
    }
    for (let index = 0; index < list.length; index += 1) if (results[index] === undefined) results[index] = stopped;
    return results;
  }

  enter(meta: Meta, ctx: Context): Building {
    const node: Building = {
      id: this.nextId,
      path: meta.path,
      doc: meta.doc,
      declared: meta.declared,
      answer: meta.answer,
      side: meta.side,
      names: Object.keys(ctx.names),
      scope: ctx.names,
      caps: ctx.caps,
      self: selfLabel(ctx.self),
      enter: this.tick,
      exit: this.tick,
      result: fail("#NOEVAL", "The evaluation did not end."),
      children: [],
      effects: [],
    };
    this.nextId += 1;
    this.tick += 1;
    (this.current ?? (this.holder as Building)).children.push(node);
    return node;
  }

  exit(node: Building, result: Result): void {
    node.result = result;
    node.exit = this.tick;
    this.tick += 1;
  }
}

/**
 * This function resolves a compiled path through a runtime (PLAN.PATH). The runtime of the kernel uses the compiled
 * path. Each other runtime gets the steps through `resolve`, thus a runtime that wraps another runtime sees each path.
 *
 * @param rt - The runtime.
 * @param ctx - The context.
 * @param compiled - The compiled path, from `compilePath`.
 * @returns What the path reached, or an error.
 */
export function resolveCompiled(rt: Runtime, ctx: Context, compiled: CompiledPath): Resolution {
  return rt instanceof Session ? rt.resolvePath(ctx, compiled) : rt.resolve(ctx, compiled.path);
}

function holderNode(): Building {
  return {
    id: -1,
    path: [],
    doc: { type: "?", value: null },
    declared: false,
    answer: NO_ANSWER,
    side: "derive",
    names: [],
    scope: {},
    caps: [],
    self: "none",
    enter: 0,
    exit: 0,
    result: ok(null),
    children: [],
    effects: [],
  };
}

/**
 * This function gives the reason of a runner that waits where its parent cannot wait (RUN.WAIT). The plan, the
 * reference and `check` with the option `run` give the same reason.
 *
 * @param kindText - The text of the type of the runner document.
 * @returns The reason.
 */
export function waitedReason(kindText: string): string {
  return `${kindText} waits for effects, and its parent cannot wait. Give the parent a runner.`;
}

/** This function drives steps that cannot wait. A step that waits stops the steps, and gives `#CALC!`. */
function drive(steps: Steps, kindText: string): Result {
  const step = steps.next();
  if (step.done === true) return step.value;
  void step.value.catch(() => undefined);
  const waited = fail("#CALC!", waitedReason(kindText));
  void steps.return(waited);
  return waited;
}

const ABORTED = /* @__PURE__ */ Symbol("aborted");

/** This function drives steps that can wait. The steps before the first wait happen at once, in the call. */
async function driveWaiting(steps: Steps, signal: StopSignal | undefined): Promise<Result> {
  const abort = (): Result => {
    const reason = fail("#ABORT", `The host stopped the run: ${describe(signal?.reason ?? "no reason")}`, { cause: signal?.reason });
    try {
      steps.return(reason);
    } catch {
      // The finally code of a runner threw. The run stops with the abort.
    }
    return reason;
  };
  const aborted =
    signal === undefined
      ? undefined
      : new Promise<typeof ABORTED>((resolve) => {
          if (signal.aborted) resolve(ABORTED);
          else signal.addEventListener("abort", () => resolve(ABORTED), { once: true });
        });
  if (signal?.aborted === true) return abort();
  let step = steps.next();
  while (step.done !== true) {
    let value: unknown;
    try {
      value = aborted === undefined ? await step.value : await Promise.race([step.value, aborted]);
    } catch (error) {
      step = steps.throw(error);
      continue;
    }
    if (value === ABORTED) return abort();
    step = steps.next(value);
  }
  return step.value;
}

function isCompiledEvaluator(evaluator: Evaluator): evaluator is CompiledEvaluator {
  return typeof evaluator === "object" && evaluator !== null && typeof (evaluator as CompiledEvaluator).compile === "function";
}

function isCompiledRunner(runner: Runner): runner is CompiledRunner {
  return typeof runner === "object" && runner !== null && typeof (runner as CompiledRunner).compileRun === "function";
}

/** The options of a compilation. */
export interface PrepareOptions {
  /** The type of a bare root value. */
  readonly declaredType?: string;
  /** `true`: each evaluation records a trace. The default is `false`. */
  readonly trace?: boolean;
  /**
   * The verb that goes up the ladder at each document, for example `format`. Each part evaluates with the same verb.
   * The default is `eval` (VERB.PREPARE).
   */
  readonly verb?: string;
  /**
   * `false`: no part of the plan folds. The default is `true`. Then a closed pure part of a plan without a trace
   * evaluates one time, when the plan compiles. Its result is one frozen value for each evaluation (PLAN.FOLD).
   */
  readonly fold?: boolean;
}

/** A compiled document. It evaluates many times, and it does the work of the ladder one time. */
export interface Plan {
  readonly machine: Machine;
  /** `true` when each evaluation records a trace. */
  readonly traced: boolean;
  /** The compiled root document. */
  readonly root: CompiledPart;
  /**
   * This function evaluates the document. It does not wait, and the host does no effect. A mock can answer each
   * effect at once (RUN.MOCK).
   *
   * @param context - The names and the capabilities at the root.
   * @param options - A list that gets the effects, the mock of the host and a list that gets the reads.
   * @returns The result.
   */
  evaluate(context?: Context, options?: EvalOptions): Result;
  /**
   * This function runs the document: the host does each effect, and the run waits when the host waits.
   *
   * @param context - The names and the capabilities at the root.
   * @param options - The host code that does the effects, a signal to stop the run and a list that gets the reads.
   * @returns The result, when the run ends.
   */
  run(context?: Context, options?: PlanRunOptions): Promise<Result>;
}

interface Compiler {
  readonly machine: Machine;
  readonly traced: boolean;
  readonly maxDepth: number;
  /** The verb that goes up the ladder at each document. */
  readonly verb: string;
  /** The answer of a document that the ladder did not see, in a trace. */
  readonly noAnswer: Answer;
  /** `true` when closed pure parts fold (PLAN.FOLD). A plan with a trace does not fold. */
  readonly fold: boolean;
  /** The runtime of the folds of this compilation. The first fold makes it. */
  probe?: Probe;
}

function failing(c: Compiler, meta: Meta, place: readonly Key[], code: ErrorCode, reason: string): Compiled {
  return failingWith(c, meta, fail(code, reason, { place }));
}

/** This function gives the code of a document that fails with one result at each evaluation. */
function failingWith(c: Compiler, meta: Meta, result: Result): Compiled {
  const plain: Code = () => result;
  return finish(c, meta, plain, undefined);
}

/**
 * This function gives the code of a document in a trace. Each node records the context that its grant permits
 * (CAP.NARROW-CODE), as the code of the document gets it.
 */
function finish(c: Compiler, meta: Meta, code: Code, steps: RunCode | undefined): Compiled {
  if (!c.traced) return { code, run: steps };
  const run = steps ?? runOf(code);
  const tracedCode: Code = (given, rt) => {
    const ctx = granted(given);
    const s = rt as Session;
    const node = s.enter(meta, ctx);
    const before = s.current;
    s.current = node;
    let result: Result;
    try {
      result = code(ctx, rt);
    } finally {
      s.current = before;
    }
    s.exit(node, result);
    return result;
  };
  const tracedRun: RunCode = function* (given, rt) {
    const ctx = granted(given);
    const s = rt as Session;
    const node = s.enter(meta, ctx);
    const steps = run(ctx, rt);
    let input: unknown;
    let threw = false;
    for (;;) {
      const before = s.current;
      s.current = node;
      let step: IteratorResult<Promise<unknown>, Result>;
      try {
        step = threw ? steps.throw(input) : steps.next(input);
      } finally {
        s.current = before;
      }
      if (step.done === true) {
        s.exit(node, step.value);
        return step.value;
      }
      try {
        input = yield step.value;
        threw = false;
      } catch (error) {
        input = error;
        threw = true;
      }
    }
  };
  return { code: tracedCode, run: tracedRun };
}

/** The meta of a node of a compilation without a trace. Only a trace reads the meta of a node. */
const NO_META: Meta = /* @__PURE__ */ Object.freeze({ path: [], doc: { type: "?", value: null }, declared: false, answer: NO_ANSWER, side: "derive" });

function compileNode(c: Compiler, value: unknown, place: readonly Key[], declared: string | undefined, depth: number, address = false): Compiled {
  const world = c.machine.world;
  const read = partsOf(world, value, declared);
  if (!read.ok) {
    const meta: Meta = c.traced ? { path: place.map(String), doc: { type: "?", value: value as Json }, declared: true, answer: c.noAnswer, side: "derive" } : NO_META;
    return failing(c, meta, place, read.code, read.reason);
  }
  const { doc, kind, split } = read;
  const envelope = read.declared ? undefined : doc;
  const meta0: Meta = c.traced ? { path: place.map(String), doc, declared: read.declared, answer: c.noAnswer, side: "derive" } : NO_META;
  if (depth > c.maxDepth) return failing(c, meta0, place, "#DEPTH!", `The nesting is deeper than ${c.maxDepth} documents.`);

  let meta = meta0;
  let name: string | undefined;
  let unknown: boolean;
  let quick: ReturnType<typeof answerOf>;
  if (c.traced) {
    const answer = ask(world, envelope ?? {}, c.verb, declared === undefined ? {} : { declaredType: declared });
    meta = { ...meta0, answer, side: kind?.side ?? "derive" };
    name = answer.evaluator;
    unknown = answer.error === "unknown-kind";
  } else {
    // A document has a type here, thus a kind that the read did not find is a kind that the world does not have.
    quick = answerOf(world, envelope?.own, kind ?? null, c.verb);
    name = quick?.name;
    unknown = quick === undefined && kind === undefined;
  }
  const kindText = typeName(doc.type);
  if (unknown) return failing(c, meta, place, "#KIND?", `The world has no kind ${kindText}.`);
  const runners = c.machine.runners ?? {};
  const runner = name !== undefined && Object.hasOwn(runners, name) ? runners[name] : undefined;
  const evaluator = name !== undefined && Object.hasOwn(c.machine.evaluators, name) ? c.machine.evaluators[name] : undefined;
  if (name === undefined || (runner === undefined && evaluator === undefined)) {
    return failing(c, meta, place, "#NOEVAL", `No rung gives an evaluator for ${kindText}.`);
  }

  if (!split.ok) return failing(c, meta, place, "#VALUE!", split.reason);
  // The free names of each part, for the fold of this document (PLAN.FOLD). A plan without folds does not collect them.
  const frees: (readonly string[] | undefined)[] | undefined = c.fold ? [] : undefined;
  const parts: CompiledPart[] = split.parts.map((slot) => {
    const item = slot.item;
    // The capability rules of the contract narrow the context of the part, thus no evaluator can forget them.
    const own = compileNode(c, item, place.concat(slot.path), slot.of, depth + 1, slot.address === true);
    frees?.push(own.free);
    const rules = rulesFor(kind?.caps, slot.path);
    const compiled = rules.length === 0 ? own : gated(rules, own);
    // The binding name is in the header of an envelope. Most parts have no name, thus the cheap test comes first.
    const header = typeof (item as { readonly name?: unknown } | null)?.name === "string" && isEnvelope(item) ? (item as { readonly name: string }).name : undefined;
    const run = compiled.run ?? runOf(compiled.code);
    return header === undefined
      ? { key: slot.key, path: slot.path, code: compiled.code, run }
      : { key: slot.key, path: slot.path, name: header, code: compiled.code, run };
  });
  const typePath = read.typePath ?? [];
  const input: CompileInput = {
    kind: kindText,
    typePath,
    doc,
    value: split.parts.length === 0 ? doc.value : split.fill(parts),
    data: split.data,
    parts,
    place,
    machine: c.machine,
    fill: fillOf(split, doc),
    ...(address ? { address: true } : {}),
  };
  // A compiler that throws fails its own document when that document evaluates, with its place (PLAN.FAIL-LATE).
  if (runner !== undefined) {
    let inner: RunCode;
    try {
      inner = isCompiledRunner(runner) ? runner.compileRun(input) : interpretRun(runner, input, split.fill);
    } catch (error) {
      return failingWith(c, meta, placed(thrown(error, `the runner ${name}`), place));
    }
    const run = placedRun(inner, place, name);
    return finish(c, meta, runnerCode(run, place, kindText), run);
  }

  let inner: Code;
  try {
    inner = isCompiledEvaluator(evaluator as Evaluator) ? (evaluator as CompiledEvaluator).compile(input) : interpret(evaluator as EvalFn, input, split.fill);
  } catch (error) {
    return failingWith(c, meta, placed(thrown(error, `the evaluator ${name}`), place));
  }
  // Code that cannot fail needs no place and no catch, and it does not read the context of its grant (PLAN.TOTAL).
  const done = finish(c, meta, TOTAL.has(inner) ? inner : placedCode(inner, place, name), undefined);
  if (frees === undefined || kind === undefined || !pureCode(c, envelope, kind, typePath, name, quick)) return done;
  const free = freeOf(doc, kind, split.parts, frees);
  if (free === undefined) return done;
  return free.length === 0 ? folded(c, done) : { code: done.code, run: done.run, free };
}

/*
 * The fold of a closed pure part (PLAN.FOLD, D43). A part folds when it evaluates one time at compile time, and its
 * code then gives that one result. These conditions make the result the same as at each evaluation:
 *
 * - The code of the part and of each part in it is pure, and the kind declares no effect and no run side.
 * - The part reads no name that it does not bind (STATIC.REFS). A reference is the only document that reads a name.
 * - The evaluation at compile time gets an empty context and a probe runtime. The probe resolves only the names that
 *   the part binds. It refuses each other read, each effect and each closure that keeps its context.
 *
 * A refusal, an exception, the error #DEPTH! and a result that is not plain data cancel the fold.
 */

/** The free names of a closed part. */
const CLOSED: readonly string[] = /* @__PURE__ */ Object.freeze([]);

/**
 * This function tells if the code of a document is pure, by the facts of D24 (FACTS.PURE). It reads the facts as
 * `factsOf` reads them. A kind with a run side, with declared effects or with volatile code is not pure here.
 */
function pureCode(c: Compiler, envelope: Envelope | undefined, kind: Kind, typePath: readonly Key[], name: string, quick: ReturnType<typeof answerOf>): boolean {
  if (kind.side === "run" || (kind.effects !== undefined && kind.effects.length > 0)) return false;
  let answer: KindFacts | undefined;
  try {
    answer = c.machine.facts?.(typePath, name);
  } catch {
    return false;
  }
  // The contract of the kind describes the code of its own name, or an own entry that names the same code (D24).
  const described = c.verb === "eval" && (envelope === undefined || quick?.rung !== "own" || name === answerOf(c.machine.world, undefined, kind, c.verb)?.name);
  const pure = described ? (answer?.pure ?? kind.pure) : answer?.pure;
  const volatile = described ? (answer?.volatile ?? kind.volatile) : answer?.volatile;
  return pure === true && volatile !== true;
}

/**
 * This function gives the names that a document reads and does not bind, or `undefined` when the document can read
 * other roots. A reference reads the name of its path. Each other document reads the free names of its parts, less
 * the names that its scope rules give each part (STATIC.REFS).
 */
function freeOf(doc: Envelope, kind: Kind, slots: readonly PartSlot[], frees: readonly (readonly string[] | undefined)[]): readonly string[] | undefined {
  if (isRef(doc)) {
    const path = doc.value;
    if (path.length < 2 || path[0] !== "names" || !path.every((step, index) => index === 0 || isKey(step))) return undefined;
    return [String(path[1])];
  }
  let sees: readonly (readonly string[])[] | undefined;
  let out: string[] | undefined;
  for (let index = 0; index < frees.length; index += 1) {
    const free = frees[index];
    if (free === undefined) return undefined;
    if (free.length === 0) continue;
    if (sees === undefined) sees = kind.scope === undefined || kind.scope.length === 0 ? [] : scopesOf(kind.scope, doc.value, slots).sees;
    const bound = sees[index] ?? CLOSED;
    for (const name of free) {
      if (bound.includes(name)) continue;
      out ??= [];
      if (!out.includes(name)) out.push(name);
    }
  }
  return out ?? CLOSED;
}

/** This class is the runtime of a fold. It reads only the names that the folded part binds, and it causes no effect. */
class Probe implements Runtime {
  readonly running = false;
  /** `true` after the part asked for something that a fold cannot give. */
  refused = false;
  /** The count of the names that the part read. */
  reads = 0;
  /**
   * The context of the folded part. Its roots `self`, `event` and `names` are traps: a direct read of a field
   * refuses the fold, as a resolution of these roots does. A copy of the record of the names reads no field.
   */
  readonly root: Context;

  constructor(readonly machine: Machine) {
    const refuse = (): void => {
      this.refused = true;
    };
    const root: Granted = {
      self: trap(refuse, false),
      event: trap(refuse, false),
      names: trap(refuse, true) as Readonly<Record<string, unknown>>,
      world: worldThing(machine.world),
      caps: NO_CAPS,
      [GRANT]: NO_CAPS,
    };
    this.root = root;
  }

  resolve(ctx: Context, path: readonly unknown[]): Resolution {
    const name = path[1];
    if (path[0] === "names" && isKey(name) && Object.hasOwn(ctx.names, String(name))) {
      this.reads += 1;
      const found = resolve(this.machine, ctx, path, WITH_HOPS);
      // A reference in the data resolves in the context of its reader, thus it can read a free name (DEREF.READER).
      if (found.hops.some((hop) => hop.by === "collapse" || isRef(hop.thing))) this.refused = true;
      return found;
    }
    this.refused = true;
    return { ok: false, code: "#REF!", reason: "A folded part reads only the names that it binds.", hops: [] };
  }

  effect(): Result {
    this.refused = true;
    return fail("#CAP!", "A folded part causes no effect.");
  }

  *runEffect(): Steps {
    return this.effect();
  }

  *all(): Generator<Promise<unknown>, readonly Result[], unknown> {
    this.refused = true;
    return [];
  }

  keepsContext(): void {
    this.refused = true;
  }
}

/**
 * This function makes a trap for a root of the context of a fold. Each read of a field calls `refuse`. A trap of the
 * names gives no keys, thus a copy of the names reads no field.
 */
function trap(refuse: () => void, copies: boolean): object {
  const no = (): undefined => {
    refuse();
    return undefined;
  };
  return new Proxy(
    {},
    {
      get: no,
      getOwnPropertyDescriptor: no,
      has: () => (refuse(), false),
      ownKeys: () => {
        if (!copies) refuse();
        return [];
      },
      getPrototypeOf: () => (refuse(), null),
      set: () => (refuse(), false),
      defineProperty: () => (refuse(), false),
      deleteProperty: () => (refuse(), false),
    },
  );
}

/**
 * This function folds the code of a closed pure part. The part evaluates one time with the probe. Its result becomes
 * one deeply frozen copy, and the code gives that copy at each evaluation (PLAN.SHARED). A fold that the probe cancels
 * gives the code without free names, thus no parent tries the fold again.
 */
function folded(c: Compiler, done: Compiled): Compiled {
  const probe = (c.probe ??= new Probe(c.machine));
  probe.refused = false;
  probe.reads = 0;
  let constant: Result | undefined;
  try {
    const result = done.code(probe.root, probe);
    if (!probe.refused && (result.ok || result.error.code !== "#DEPTH!")) constant = sharedCopy(result) as Result | undefined;
  } catch {
    constant = undefined;
  }
  if (constant === undefined) return { code: done.code, run: done.run };
  const value = constant;
  if (probe.reads === 0) return { code: () => value, run: undefined, free: CLOSED };
  // The part reads its own names. A list of reads gets each read, thus the code evaluates again (READS.RECORD).
  const original = done.code;
  return { code: (ctx, rt) => (rt instanceof Session && !rt.traced && !rt.recording ? value : original(ctx, rt)), run: undefined, free: CLOSED };
}

/** The objects that a fold made. Each one is deeply frozen, thus a later fold uses it again and does not copy it. */
const SHARED: WeakSet<object> = /* @__PURE__ */ new WeakSet();

/** The mark of a value that is not plain data. */
const NOT_PLAIN: unique symbol = /* @__PURE__ */ Symbol("not plain");

/**
 * This function gives a deeply frozen copy of plain data, or `undefined` for other values. Plain data is a primitive or
 * an array without holes and extra keys. It is also a record of enumerable data fields with the prototype of an object
 * or no prototype. The copy keeps cycles and shared objects. The objects of the host do not change.
 */
function sharedCopy(value: unknown): unknown {
  try {
    const out = copyPlain(value, new Map());
    return out === NOT_PLAIN ? undefined : out;
  } catch {
    // A very deep value overflows the stack of the host.
    return undefined;
  }
}

/** This function copies one value for `sharedCopy`. The map holds the copy of each object that the copy saw. */
function copyPlain(value: unknown, memo: Map<object, unknown>): unknown {
  if (typeof value === "function") return NOT_PLAIN;
  if (typeof value !== "object" || value === null) return value;
  if (SHARED.has(value)) return value;
  const seen = memo.get(value);
  if (seen !== undefined) return seen;
  const proto: unknown = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  let out: Record<string, unknown> | unknown[];
  if (Array.isArray(value)) {
    if (proto !== Array.prototype || keys.length !== value.length + 1) return NOT_PLAIN;
    const list: unknown[] = [];
    memo.set(value, list);
    for (let index = 0; index < value.length; index += 1) {
      const field = Object.getOwnPropertyDescriptor(value, index);
      if (field === undefined || !("value" in field) || field.enumerable !== true) return NOT_PLAIN;
      const item = copyPlain(field.value, memo);
      if (item === NOT_PLAIN) return NOT_PLAIN;
      list.push(item);
    }
    out = list;
  } else {
    if (proto !== Object.prototype && proto !== null) return NOT_PLAIN;
    const record: Record<string, unknown> = proto === null ? (Object.create(null) as Record<string, unknown>) : {};
    memo.set(value, record);
    for (const key of keys) {
      if (typeof key !== "string") return NOT_PLAIN;
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (field === undefined || !("value" in field) || field.enumerable !== true) return NOT_PLAIN;
      const item = copyPlain(field.value, memo);
      if (item === NOT_PLAIN) return NOT_PLAIN;
      // The key __proto__ is a field of the data, thus it does not set the prototype of the copy.
      if (key === "__proto__") Object.defineProperty(record, key, { value: item, enumerable: true, writable: true, configurable: true });
      else record[key] = item;
    }
    out = record;
  }
  Object.freeze(out);
  SHARED.add(out);
  return out;
}

/*
 * The helpers below make the closures that a plan keeps. Each one has its own small scope. A closure that a
 * compilation made in its own scope keeps each variable of that scope that any closure there reads, for example
 * the split of the value. Thus a plan with these helpers keeps only its code.
 */

/**
 * The compiled code that cannot fail (PLAN.TOTAL). Such code gives a value and throws nothing. It does not read its
 * context or its runtime. Only the kits of the kernel mark code, thus the code of a host always gets its grant.
 */
const TOTAL: WeakSet<Code> = /* @__PURE__ */ new WeakSet();

/**
 * This function marks compiled code that cannot fail (PLAN.TOTAL). Then `compileNode` does not wrap the code in
 * `placedCode`, thus a literal costs one call. The kits of the kernel use it. The package does not export it.
 *
 * @param code - The code. It gives a value and throws nothing. It does not read its context or its runtime.
 * @returns The same code.
 */
export function totalCode(code: Code): Code {
  TOTAL.add(code);
  return code;
}

/**
 * This function gives the code of a document: the code of its evaluator, with the place of each error and of each
 * exception. The code gets the context that its grant permits, thus a compiled parent cannot widen it (CAP.NARROW-CODE).
 */
function placedCode(inner: Code, place: readonly Key[], name: string): Code {
  return (ctx, rt) => {
    try {
      return placed(inner(granted(ctx), rt), place);
    } catch (error) {
      return placed(thrown(error, `the evaluator ${name}`), place);
    }
  };
}

/**
 * This function gives the code of a part that capability rules cover. The code narrows the context of the part by
 * the rules before the part starts. First the context keeps only the capabilities of its grant, thus a compiled
 * parent cannot widen the capabilities that the rules narrow (CAP.NARROW-CODE).
 */
function gated(rules: readonly CapsRule[], part: Compiled): Compiled {
  const inner = part.code;
  const steps = part.run;
  const under = (given: Context): Context => {
    const ctx = granted(given);
    const caps = capsUnder(rules, ctx.caps);
    if (caps === ctx.caps || (caps.length === 0 && ctx.caps.length === 0)) return ctx;
    const out: Granted = { ...ctx, caps, [GRANT]: caps };
    return out;
  };
  // The steps of an evaluator are `runOf` of its code, thus `runOf` of this code narrows the context the same way.
  return { code: (ctx, rt) => inner(under(ctx), rt), run: steps === undefined ? undefined : (ctx, rt) => steps(under(ctx), rt) };
}

/**
 * This function gives the steps of a runner, with the place of each error and of each exception. The steps get the
 * context that its grant permits (CAP.NARROW-CODE).
 */
function placedRun(inner: RunCode, place: readonly Key[], name: string): RunCode {
  return function* (ctx, rt) {
    try {
      return placed(yield* inner(granted(ctx), rt), place);
    } catch (error) {
      return placed(thrown(error, `the runner ${name}`), place);
    }
  };
}

/**
 * This function gives the code of a runner under a parent that cannot wait: its steps, driven without a wait. An
 * evaluation and a run both drive them (RUN.DRIVE-NESTED). Only a step that really waits gives `#CALC!`, at the place
 * of the runner, where the error started (RUN.WAIT).
 */
function runnerCode(run: RunCode, place: readonly Key[], kindText: string): Code {
  return (ctx, rt) => placed(drive(run(ctx, rt), kindText), place);
}

/**
 * The code of a compiled document. The steps of a run are `undefined` for an evaluator: they are `runOf(code)`, and a
 * plan makes them only for a run (PLAN.LEAN).
 */
interface Compiled {
  readonly code: Code;
  readonly run: RunCode | undefined;
  /**
   * The names that the document reads and does not bind, when it is pure. An empty list marks a folded document.
   * `undefined` marks a document that cannot fold, or a plan without folds (PLAN.FOLD).
   */
  readonly free?: readonly string[];
}

/** This function gives the steps of a run of an evaluator. The code runs at the first step, and it does not wait. */
function runOf(code: Code): RunCode {
  return function* (ctx, rt) {
    return code(ctx, rt);
  };
}

/** This function gives the fill of a compile input: the value with an item in the place of each part. */
function fillOf(split: Extract<Split, { readonly ok: true }>, doc: Envelope): <P>(items: readonly P[]) => unknown {
  return (items) => (split.parts.length === 0 ? doc.value : split.fill(items));
}


function interpret(fn: EvalFn, input: CompileInput, fill: <P>(handles: readonly P[]) => unknown): Code {
  const { kind, typePath, doc, data, place, machine } = input;
  const address = input.address === true ? { address: true } : {};
  // The code keeps the fill and not the whole input, thus it does not keep the compiled value of the document (PLAN.LEAN).
  const refill = input.fill;
  const compiled = input.parts;
  const hasParts = compiled.length > 0;
  return (ctx, rt) => {
    const parts: Part[] = compiled.map((part) => ({
      key: part.key,
      path: part.path,
      ...(part.name === undefined ? {} : { name: part.name }),
      evaluate: (override?: Context) => part.code(override === undefined ? ctx : handed(ctx, override), rt),
    }));
    return fn({
      kind,
      typePath,
      doc,
      value: hasParts ? fill(parts) : doc.value,
      data,
      parts,
      context: ctx,
      place,
      machine,
      ...address,
      resolve: (path, options) => rt.resolve(ctx, path, options),
      effect: (effectKind, payload) => rt.effect(ctx, effectKind, payload, place),
      fill: refill,
    });
  };
}

function interpretRun(fn: RunFn, input: CompileInput, fill: <P>(handles: readonly P[]) => unknown): RunCode {
  const { kind, typePath, doc, data, place, machine } = input;
  const refill = input.fill;
  const compiled = input.parts;
  const hasParts = compiled.length > 0;
  return (ctx, rt) => {
    const parts: RunPart[] = compiled.map((part) => ({
      key: part.key,
      path: part.path,
      ...(part.name === undefined ? {} : { name: part.name }),
      evaluate: (override?: Context) => part.run(override === undefined ? ctx : handed(ctx, override), rt),
    }));
    return fn({
      kind,
      typePath,
      doc,
      value: hasParts ? fill(parts) : doc.value,
      data,
      parts,
      context: ctx,
      place,
      machine,
      resolve: (path, options) => rt.resolve(ctx, path, options),
      effect: (effectKind, payload) => rt.runEffect(ctx, effectKind, payload, place),
      all: (list, options) => rt.all(list.map((part) => () => part.evaluate()), options),
      fill: refill,
    });
  };
}

/**
 * This function gives the context at the root of an evaluation. It is the context of the host, with the world of
 * the machine when the context has none. The host gives the capabilities, thus the root has the grant of each one
 * (CAP.NARROW-CODE). The list of the host is also the epoch of the grant (CAP.NARROW-KEPT). An evaluation and
 * `verifyReads` share it.
 *
 * @param machine - The machine.
 * @param ctx - The context of the host.
 * @returns The context at the root.
 */
export function rootContext(machine: Machine, ctx: Context): Context {
  if (ctx.world !== null && (ctx as Granted)[GRANT] === ctx.caps && (ctx as Granted)[EPOCH] === ctx.caps) return ctx;
  const root: Granted = { ...ctx, world: ctx.world === null ? worldThing(machine.world) : ctx.world, [GRANT]: ctx.caps, [EPOCH]: ctx.caps };
  return root;
}

/**
 * This function compiles a document into a plan. The ladder, the kinds and the parts are known after it. A plan
 * evaluates many times. A document that does not compile gives a plan that fails with the reason, when it evaluates.
 *
 * The verb of the options goes up the ladder at each document, and each part evaluates with the same verb. The
 * default verb is `eval`. A plan of another verb, for example `format`, evaluates, runs and traces as a plan of
 * `eval` does (VERB.PREPARE).
 *
 * @param machine - The world and the code of the evaluators.
 * @param doc - The document, as JSON.
 * @param options - The type of a bare root value, a trace and the verb.
 * @returns The plan.
 */
export function prepare(machine: Machine, doc: unknown, options: PrepareOptions = {}): Plan {
  const verb = options.verb ?? "eval";
  const noAnswer: Answer = verb === "eval" ? NO_ANSWER : { verb, error: "no-answer", steps: [] };
  const traced = options.trace === true;
  const c: Compiler = { machine, traced, maxDepth: machine.maxDepth ?? 1000, verb, noAnswer, fold: !traced && options.fold !== false };
  let root: Compiled;
  try {
    root = compileNode(c, doc, [], options.declaredType, 0);
  } catch (error) {
    const result = placed(thrown(error, "the compilation"), []);
    root = { code: () => result, run: undefined };
  }
  return new CompiledPlan(machine, c.traced, root.code, root.run);
}

/**
 * The object of a plan (PLAN.LEAN). The code of `evaluate` and `run` is on the class, thus a plan keeps only its
 * machine and its compiled code. A plan makes its compiled root and the steps of a run at their first use.
 */
class CompiledPlan implements Plan {
  /*
   * The constructor writes each field one time, and the class declares the fields with `declare`. A field that a class
   * defines first as `undefined` and then writes again is not constant for V8, and the code of an evaluation then
   * loads it at each call.
   */
  declare readonly machine: Machine;
  declare readonly traced: boolean;
  /** The code of the root document. */
  declare readonly code: Code;
  /** The steps of a run of the root document. `undefined` gives `runOf(code)` at the first `run`. */
  declare private steps: RunCode | undefined;
  /** The compiled root, after the first read of `root`. */
  declare private part: CompiledPart | undefined;

  constructor(machine: Machine, traced: boolean, code: Code, steps: RunCode | undefined) {
    this.machine = machine;
    this.traced = traced;
    this.code = code;
    this.steps = steps;
    this.part = undefined;
  }

  get root(): CompiledPart {
    return (this.part ??= { key: "", path: [], code: this.code, run: this.runCode() });
  }

  /** This function gives the steps of a run of the root document. */
  runCode(): RunCode {
    return (this.steps ??= runOf(this.code));
  }

  evaluate(context: Context = makeContext(), evalOptions?: EvalOptions): Result {
    const machine = this.machine;
    const ctx = rootContext(machine, context);
    const s = new Session(machine, ctx.caps, false, this.traced, evalOptions?.perform, undefined, evalOptions?.effects, readingOf(evalOptions?.reads, ctx));
    return this.code(ctx, s);
  }

  run(context: Context = makeContext(), runOptions: PlanRunOptions = {}): Promise<Result> {
    const machine = this.machine;
    const ctx = rootContext(machine, context);
    const s = new Session(machine, ctx.caps, true, this.traced, runOptions.perform, runOptions.signal, undefined, readingOf(runOptions.reads, ctx));
    return driveWaiting(this.runCode()(ctx, s), runOptions.signal);
  }
}

/**
 * This function makes a cache of plans for one machine. A document object compiles one time. Use it only for
 * documents that do not change after they are made.
 *
 * @param machine - The machine.
 * @param options - The options of each compilation.
 * @returns A function that gives the plan of a document.
 */
export function planner(machine: Machine, options: PrepareOptions = {}): (doc: unknown) => Plan {
  const objects = new WeakMap<object, Plan>();
  const values = new Map<unknown, Plan>();
  return (doc) => {
    if (typeof doc === "object" && doc !== null) {
      let plan = objects.get(doc);
      if (plan === undefined) {
        plan = prepare(machine, doc, options);
        objects.set(doc, plan);
      }
      return plan;
    }
    // A map treats -0 and 0 as one key, so -0 gets its own plan each time.
    if (Object.is(doc, -0)) return prepare(machine, doc, options);
    let plan = values.get(doc);
    if (plan === undefined) {
      plan = prepare(machine, doc, options);
      if (values.size > 1000) values.clear();
      values.set(doc, plan);
    }
    return plan;
  };
}

function record(s: Session, result: Result): Run {
  const root = s.holder?.children[0];
  if (root === undefined) throw new Error("The evaluation made no trace.");
  return { result, trace: root as TraceNode, effects: s.effects, time: s.tick };
}

/**
 * This function evaluates a document, and records each evaluation in a trace.
 *
 * The verb of the options goes up the ladder for each document. The default verb is `eval`. The kind of the document
 * tells where its parts are. The evaluator gets each part sealed: it can evaluate the part, and it cannot read its
 * value.
 *
 * A failure gives an error value, and the function does not throw. The function records each effect in its order,
 * and the host does not do it. A mock can answer each effect at once (RUN.MOCK).
 *
 * @param machine - The world and the code of the evaluators.
 * @param doc - The document, as JSON.
 * @param context - The names and the capabilities at the root.
 * @param options - The type of a bare root value, or the options: that type, the mock of the host, the verb and a list for the reads.
 * @returns The result, the trace and the effects in their order.
 */
export function evaluate(machine: Machine, doc: unknown, context: Context = makeContext(), options?: string | EvaluateOptions): Run {
  const given: EvaluateOptions = typeof options === "string" ? { declaredType: options } : (options ?? {});
  const declaredType = given.declaredType;
  const plan = prepare(machine, doc, {
    trace: true,
    ...(declaredType === undefined ? {} : { declaredType }),
    ...(given.verb === undefined ? {} : { verb: given.verb }),
  });
  const ctx = rootContext(machine, context);
  const s = new Session(machine, ctx.caps, false, true, given.perform, undefined, undefined, readingOf(given.reads, ctx));
  const result = (plan as CompiledPlan).code(ctx, s);
  return record(s, result);
}

/**
 * This function runs a document: an evaluation in which the host does each effect. A runner waits for its
 * parts and for its effects, thus a step can read the result of the step before. The part of the run before the
 * first wait happens at once, in the call. The run records a trace.
 *
 * @param machine - The world, the evaluators and the runners.
 * @param doc - The document, as JSON.
 * @param context - The names and the capabilities at the root.
 * @param options - The host code that does the effects, the type of a bare root value, a signal, the verb and a list for the reads.
 * @returns The result, the trace and the effects in their order, when the run ends.
 */
export async function run(machine: Machine, doc: unknown, context: Context = makeContext(), options: RunOptions = {}): Promise<Run> {
  const plan = prepare(machine, doc, {
    trace: true,
    ...(options.declaredType === undefined ? {} : { declaredType: options.declaredType }),
    ...(options.verb === undefined ? {} : { verb: options.verb }),
  });
  const ctx = rootContext(machine, context);
  const s = new Session(machine, ctx.caps, true, true, options.perform, options.signal, undefined, readingOf(options.reads, ctx));
  const result = await driveWaiting((plan as CompiledPlan).runCode()(ctx, s), options.signal);
  return record(s, result);
}

/**
 * This function finds a node of a trace by its path.
 *
 * @param trace - The root of the trace.
 * @param path - The keys from the root.
 * @returns The first evaluation at that path, or `undefined` when the document did not evaluate.
 */
export function nodeAt(trace: TraceNode, path: readonly Key[]): TraceNode | undefined {
  const want = path.map(String);
  let node: TraceNode | undefined = trace;
  let at = 0;
  while (node !== undefined && at < want.length) {
    const here: TraceNode = node;
    node = here.children.find((child) => {
      const tail = child.path.slice(here.path.length);
      return tail.length > 0 && tail.every((key, index) => key === want[at + index]);
    });
    if (node !== undefined) at += node.path.length - here.path.length;
  }
  return node;
}

/**
 * This function lists the nodes of a trace in the order of their start.
 *
 * @param trace - The root of the trace.
 * @returns Each node, the root first.
 */
export function flatten(trace: TraceNode): readonly TraceNode[] {
  const out: TraceNode[] = [];
  const stack: TraceNode[] = [trace];
  while (stack.length > 0) {
    const node = stack.pop() as TraceNode;
    out.push(node);
    for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push(node.children[index] as TraceNode);
  }
  return out.sort((a, b) => a.enter - b.enter);
}

/**
 * This function lists the errors of a trace: each node whose result is an error and whose parts did not fail
 * the same way. These nodes are where each error started.
 *
 * @param trace - The root of the trace.
 * @returns The errors, in the order of their start.
 */
export function failures(trace: TraceNode): readonly EvalError[] {
  return flatten(trace)
    .filter((node) => !node.result.ok && !node.children.some((child) => !child.result.ok && child.result.error === (node.result as { error: EvalError }).error))
    .map((node) => (node.result as { readonly error: EvalError }).error);
}

/** The type of a document as a reference: re-exported for the compilers. */
export type { TypeRef };
