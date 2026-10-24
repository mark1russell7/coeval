import { type Envelope, type Json, type Key, type TypeRef, isEnvelope, typeName } from "./doc.ts";
import { type Split, pathMatches, splitParts } from "./parts.ts";
import { ask, type Answer } from "./ladder.ts";
import { type CapsRule, type Lookup, type Side, type World, lookupKind } from "./world.ts";
import { type ErrorCode, type EvalError, type Result, fail, ok, placed, thrown, describe } from "./errors.ts";
import {
  type Cap,
  type Context,
  type Navigator,
  type Resolution,
  type ResolveOptions,
  type Thing,
  context as makeRootContext,
  isHostThing,
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
 * This function narrows a context for a part: the part keeps only the capabilities that the context of its parent
 * permits. Thus an evaluator cannot give a part more effects than it has.
 *
 * @param parent - The context of the parent.
 * @param next - The context that the evaluator gives the part.
 * @returns The context of the part.
 */
export function narrow(parent: Context, next: Context): Context {
  if (next === parent || next.caps === parent.caps) return next;
  const caps = next.caps.filter((cap) => permits(parent.caps, cap));
  return caps.length === next.caps.length ? next : { ...next, caps };
}

/** No capabilities. One list serves each masked part. */
const NO_CAPS: readonly Cap[] = Object.freeze([]);

/** No capability rules. One list serves each part that no rule narrows. */
const NO_RULES: readonly CapsRule[] = Object.freeze([]);

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
 * The steps of an evaluation that can wait. It yields a promise only when the host makes it wait. A runner takes the
 * result of a part with `yield*`, thus a run goes on at once until an effect waits. A runner does not yield a
 * promise itself: it uses `yield*` on the steps that the kernel gives.
 */
export type Steps = Generator<Promise<unknown>, Result, unknown>;

/** An effect that an evaluation caused, in the order of the effects. */
export interface Effect {
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
}

/** The host side of a run: it does one effect, and gives its result. A throw or a rejection is an error value. */
export type Perform = (effect: Effect) => unknown;

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
   * @param ctx - The context of the document.
   * @param kind - The kind of the effect.
   * @param payload - The data of the effect.
   * @param place - The place of the document.
   * @returns The payload, or an error value.
   */
  effect(ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Result;
  /**
   * This function causes an effect from a runner. In a run, the host does it, and the steps wait when the host
   * waits.
   *
   * @param ctx - The context of the document.
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

/** Compiled code: the evaluation of a document in a context. */
export type Code = (ctx: Context, rt: Runtime) => Result;

/** Compiled code that can wait: the run of a document in a context. */
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
   * @returns The payload, or the error `#CAP!`.
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
  resolve(path: readonly unknown[], options?: ResolveOptions): Resolution;
  /**
   * This function causes an effect. In a run, the host does the effect, and the steps wait when the host waits. In
   * an evaluation, the effect gives its payload. Take its result with `yield*`.
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
 * - `permits`: the rule of the host for an effect. The default is the function `permits` on the capabilities.
 */
export interface Machine extends Navigator {
  readonly evaluators: Readonly<Record<string, Evaluator>>;
  /** The runners, by evaluator name. A runner wins over an evaluator of the same name. */
  readonly runners?: Readonly<Record<string, Runner>>;
  readonly maxDepth?: number;
  readonly permits?: (caps: readonly Cap[], kind: readonly Key[], context: Context) => boolean;
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
  /** The answer of the ladder to the verb `eval`. */
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

/** The options of a run. */
export interface RunOptions {
  /** The host code that does each effect. Without it, an effect gives its payload, as in an evaluation. */
  readonly perform?: Perform;
  /** The type of a bare root value. */
  readonly declaredType?: string;
  /** A signal of the host. When it aborts, the run stops with `#ABORT`. */
  readonly signal?: StopSignal;
}

/** The options of an evaluation of a plan. */
export interface EvalOptions {
  /** A list that gets each effect, in its order. */
  readonly effects?: Effect[];
}

/** The options of a resolution without a record of hops, and with one. One object of each serves each call. */
const WITHOUT_HOPS: ResolveOptions = Object.freeze({ hops: false });
const WITH_HOPS: ResolveOptions = Object.freeze({ hops: true });

/** This class holds the state of one evaluation or run: the machine, the effects, the clock and the trace. */
class Session implements Runtime {
  /** The list of the effects. It is made at the first effect, thus an evaluation without effects makes no list. */
  private list: Effect[] | undefined;
  tick = 0;
  nextId = 0;
  current: Building | undefined;
  readonly holder: Building | undefined;

  constructor(
    readonly machine: Machine,
    readonly running: boolean,
    readonly traced: boolean,
    readonly perform: Perform | undefined,
    readonly signal: StopSignal | undefined,
    effects: Effect[] | undefined,
  ) {
    this.list = effects;
    this.holder = traced ? holderNode() : undefined;
    this.current = this.holder;
  }

  /** The effects of the evaluation, in their order. */
  get effects(): Effect[] {
    return (this.list ??= []);
  }

  resolve(ctx: Context, path: readonly unknown[], options?: ResolveOptions): Resolution {
    const hops = options?.hops ?? this.traced;
    return resolve(this.machine, ctx, path, hops ? WITH_HOPS : WITHOUT_HOPS);
  }

  private permitted(ctx: Context, keys: readonly Key[]): boolean {
    return this.machine.permits === undefined ? permits(ctx.caps, keys) : this.machine.permits(ctx.caps, keys, ctx);
  }

  private record(ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Result | Effect {
    const keys = typeof kind === "string" ? kind.split(".") : kind;
    const text = keys.join(".");
    if (!this.permitted(ctx, keys)) return fail("#CAP!", `The context has no capability for the effect ${text}.`, { place });
    const node = this.current;
    const list = this.effects;
    const effect: Effect = { index: list.length, kind: text, path: keys, payload, node: node?.id ?? -1, at: this.tick, place, context: ctx };
    list.push(effect);
    if (node !== undefined) node.effects.push(effect.index);
    return effect;
  }

  effect(ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Result {
    const text = typeof kind === "string" ? kind : kind.join(".");
    if (this.running) return fail("#CALC!", `The effect ${text} needs a runner: in a run, the host does each effect.`, { place });
    const made = this.record(ctx, kind, payload, place);
    return "ok" in made ? made : ok(payload);
  }

  *runEffect(ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Steps {
    const made = this.record(ctx, kind, payload, place);
    if ("ok" in made) return made;
    const perform = this.perform;
    if (!this.running || perform === undefined) return ok(payload);
    const failed = (error: unknown): Result => fail("#CALC!", `The host failed the effect ${made.kind}: ${describe(error)}`, { place, cause: error });
    let done: unknown;
    try {
      done = perform(made);
    } catch (error) {
      return failed(error);
    }
    if (!(done instanceof Promise)) return ok(done);
    return (yield done.then((value: unknown) => ok(value), failed)) as Result;
  }

  *all(list: readonly (() => Steps)[], options: AllOptions = {}): Generator<Promise<unknown>, readonly Result[], unknown> {
    const results: Result[] = new Array<Result>(list.length);
    const limit = Math.max(1, options.concurrency ?? list.length);
    const failFast = options.failFast === true;
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
      try {
        step = input.threw ? steps.throw(input.error) : steps.next(input.value);
      } catch (error) {
        settle(index, thrown(error, "a part"));
        return;
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
        const begin = list[index] as () => Steps;
        let steps: Steps;
        try {
          steps = begin();
        } catch (error) {
          settle(index, thrown(error, "a part"));
          continue;
        }
        advance(index, steps, { threw: false });
      }
    };
    start();
    while (active.length > 0 && !failed) {
      const settled = (yield Promise.race(active.map((item) => item.pending))) as {
        readonly item: Active;
        readonly value?: unknown;
        readonly error?: unknown;
        readonly threw: boolean;
      };
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

/** This function drives steps that cannot wait. */
function drive(steps: Steps): Result {
  const step = steps.next();
  if (step.done === true) return step.value;
  void step.value.catch(() => undefined);
  void steps.return(fail("#CALC!", "A part waited, and its parent cannot wait."));
  return fail("#CALC!", "A part waited, and its parent cannot wait.");
}

const ABORTED = Symbol("aborted");

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
}

/** A compiled document. It evaluates many times, and it does the work of the ladder one time. */
export interface Plan {
  readonly machine: Machine;
  /** `true` when each evaluation records a trace. */
  readonly traced: boolean;
  /** The compiled root document. */
  readonly root: CompiledPart;
  /**
   * This function evaluates the document. It does not wait, and the host does no effect.
   *
   * @param context - The names and the capabilities at the root.
   * @param options - A list that gets the effects.
   * @returns The result.
   */
  evaluate(context?: Context, options?: EvalOptions): Result;
  /**
   * This function runs the document: the host does each effect, and the run waits when the host waits.
   *
   * @param context - The names and the capabilities at the root.
   * @param options - The host code that does the effects, and a signal to stop the run.
   * @returns The result, when the run ends.
   */
  run(context?: Context, options?: RunOptions): Promise<Result>;
}

interface Compiler {
  readonly machine: Machine;
  readonly traced: boolean;
  readonly maxDepth: number;
}

function failing(c: Compiler, meta: Meta, place: readonly Key[], code: ErrorCode, reason: string): { readonly code: Code; readonly run: RunCode } {
  return failingWith(c, meta, fail(code, reason, { place }));
}

/** This function gives the code of a document that fails with one result at each evaluation. */
function failingWith(c: Compiler, meta: Meta, result: Result): { readonly code: Code; readonly run: RunCode } {
  const plain: Code = () => result;
  return finish(c, meta, plain, function* () {
    return result;
  });
}

function finish(c: Compiler, meta: Meta, code: Code, run: RunCode): { readonly code: Code; readonly run: RunCode } {
  if (!c.traced) return { code, run };
  const tracedCode: Code = (ctx, rt) => {
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
  const tracedRun: RunCode = function* (ctx, rt) {
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

/**
 * This function finds the evaluator of the verb `eval` without the record of the rungs, for a compilation without a
 * trace. It gives the same evaluator as `ask`: the own entry, then the kind, then the default of the world.
 */
function evaluatorOf(world: World, envelope: Envelope | undefined, found: Lookup): { readonly name?: string; readonly unknown: boolean } {
  const own = envelope?.own;
  const ownName = own !== undefined && Object.hasOwn(own, "eval") ? own["eval"] : undefined;
  if (ownName !== undefined) return { name: ownName, unknown: false };
  if (!found.ok) return { unknown: true };
  const verbs = found.kind.verbs;
  const name = Object.hasOwn(verbs, "eval") ? verbs["eval"] : Object.hasOwn(world.defaults, "eval") ? world.defaults["eval"] : undefined;
  return name === undefined ? { unknown: false } : { name, unknown: false };
}

/** The meta of a node of a compilation without a trace. Only a trace reads the meta of a node. */
const NO_META: Meta = Object.freeze({ path: [], doc: { type: "?", value: null }, declared: false, answer: NO_ANSWER, side: "derive" });

function compileNode(c: Compiler, value: unknown, place: readonly Key[], declared: string | undefined, depth: number, address = false): { readonly code: Code; readonly run: RunCode } {
  const envelope = isEnvelope(value) ? (value as Envelope) : undefined;
  const doc: Envelope = envelope ?? { type: declared ?? "?", value: value as Json };
  const meta0: Meta = c.traced ? { path: place.map(String), doc, declared: envelope === undefined, answer: NO_ANSWER, side: "derive" } : NO_META;
  if (envelope === undefined && declared === undefined) {
    return failing(c, meta0, place, "#PART?", "The value has no envelope, and its position declares no type.");
  }
  if (depth > c.maxDepth) return failing(c, meta0, place, "#DEPTH!", `The nesting is deeper than ${c.maxDepth} documents.`);

  const world = c.machine.world;
  const found = lookupKind(world, doc.type);
  const kind = found.ok ? found.kind : undefined;
  let meta = meta0;
  let name: string | undefined;
  let unknown: boolean;
  if (c.traced) {
    const answer = ask(world, envelope ?? {}, "eval", declared === undefined ? {} : { declaredType: declared });
    meta = { ...meta0, answer, side: kind?.side ?? "derive" };
    name = answer.evaluator;
    unknown = answer.error === "unknown-kind";
  } else {
    const quick = evaluatorOf(world, envelope, found);
    name = quick.name;
    unknown = quick.unknown;
  }
  const kindText = typeName(doc.type);
  if (unknown) return failing(c, meta, place, "#KIND?", `The world has no kind ${kindText}.`);
  const runners = c.machine.runners ?? {};
  const runner = name !== undefined && Object.hasOwn(runners, name) ? runners[name] : undefined;
  const evaluator = name !== undefined && Object.hasOwn(c.machine.evaluators, name) ? c.machine.evaluators[name] : undefined;
  if (name === undefined || (runner === undefined && evaluator === undefined)) {
    return failing(c, meta, place, "#NOEVAL", `No rung gives an evaluator for ${kindText}.`);
  }

  const split = splitParts(kind?.parts, doc.value);
  if (!split.ok) {
    const at = split.at.length === 0 ? "" : ` (at ${split.at.join(".")})`;
    return failing(c, meta, place, "#VALUE!", `${split.reason}${at} The kind is ${kindText}.`);
  }
  const parts: CompiledPart[] = split.parts.map((slot) => {
    const item = slot.item;
    // The capability rules of the contract narrow the context of the part, thus no evaluator can forget them.
    const own = compileNode(c, item, place.concat(slot.path), slot.of, depth + 1, slot.address === true);
    const rules = rulesFor(kind?.caps, slot.path);
    const compiled = rules.length === 0 ? own : gated(rules, own);
    // The binding name is in the header of an envelope. Most parts have no name, thus the cheap test comes first.
    const header = typeof (item as { readonly name?: unknown } | null)?.name === "string" && isEnvelope(item) ? (item as { readonly name: string }).name : undefined;
    return header === undefined
      ? { key: slot.key, path: slot.path, code: compiled.code, run: compiled.run }
      : { key: slot.key, path: slot.path, name: header, code: compiled.code, run: compiled.run };
  });
  const typePath = found.ok ? found.path : [];
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
  const code = placedCode(inner, place, name);
  return finish(c, meta, code, runOf(code));
}

/*
 * The helpers below make the closures that a plan keeps. Each one has its own small scope. A closure that a
 * compilation made in its own scope keeps each variable of that scope that any closure there reads, for example
 * the split of the value. Thus a plan with these helpers keeps only its code.
 */

/** This function gives the code of a document: the code of its evaluator, with the place of each error and of each exception. */
function placedCode(inner: Code, place: readonly Key[], name: string): Code {
  return (ctx, rt) => {
    try {
      return placed(inner(ctx, rt), place);
    } catch (error) {
      return placed(thrown(error, `the evaluator ${name}`), place);
    }
  };
}

/**
 * This function gives the code of a part that capability rules cover. The code narrows the context of the part by
 * the rules before the part starts.
 */
function gated(rules: readonly CapsRule[], part: { readonly code: Code; readonly run: RunCode }): { readonly code: Code; readonly run: RunCode } {
  const inner = part.code;
  const steps = part.run;
  const under = (ctx: Context): Context => {
    const caps = capsUnder(rules, ctx.caps);
    return caps === ctx.caps || (caps.length === 0 && ctx.caps.length === 0) ? ctx : { ...ctx, caps };
  };
  return { code: (ctx, rt) => inner(under(ctx), rt), run: (ctx, rt) => steps(under(ctx), rt) };
}

/** This function gives the steps of a runner, with the place of each error and of each exception. */
function placedRun(inner: RunCode, place: readonly Key[], name: string): RunCode {
  return function* (ctx, rt) {
    try {
      return placed(yield* inner(ctx, rt), place);
    } catch (error) {
      return placed(thrown(error, `the runner ${name}`), place);
    }
  };
}

/**
 * This function gives the code of a runner in an evaluation: its steps, which cannot wait. A step that waits gives
 * `#CALC!` at the place of the runner, where the error started (RUN.WAIT).
 */
function runnerCode(run: RunCode, place: readonly Key[], kindText: string): Code {
  return (ctx, rt) =>
    rt.running
      ? fail("#CALC!", `${kindText} waits for effects, and its parent cannot wait. Give the parent a runner.`, { place })
      : placed(drive(run(ctx, rt)), place);
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
  const { kind, typePath, doc, data, place } = input;
  const address = input.address === true ? { address: true } : {};
  const compiled = input.parts;
  const hasParts = compiled.length > 0;
  return (ctx, rt) => {
    const parts: Part[] = compiled.map((part) => ({
      key: part.key,
      path: part.path,
      ...(part.name === undefined ? {} : { name: part.name }),
      evaluate: (override?: Context) => part.code(override === undefined ? ctx : narrow(ctx, override), rt),
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
      ...address,
      resolve: (path, options) => rt.resolve(ctx, path, options),
      effect: (effectKind, payload) => rt.effect(ctx, effectKind, payload, place),
      fill: input.fill,
    });
  };
}

function interpretRun(fn: RunFn, input: CompileInput, fill: <P>(handles: readonly P[]) => unknown): RunCode {
  const { kind, typePath, doc, data, place } = input;
  const compiled = input.parts;
  const hasParts = compiled.length > 0;
  return (ctx, rt) => {
    const parts: RunPart[] = compiled.map((part) => ({
      key: part.key,
      path: part.path,
      ...(part.name === undefined ? {} : { name: part.name }),
      evaluate: (override?: Context) => part.run(override === undefined ? ctx : narrow(ctx, override), rt),
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
      resolve: (path, options) => rt.resolve(ctx, path, options),
      effect: (effectKind, payload) => rt.runEffect(ctx, effectKind, payload, place),
      all: (list, options) => rt.all(list.map((part) => () => part.evaluate()), options),
      fill: input.fill,
    });
  };
}

function rootContext(machine: Machine, ctx: Context): Context {
  return ctx.world === null ? { ...ctx, world: worldThing(machine.world) } : ctx;
}

/**
 * This function compiles a document into a plan. The ladder, the kinds and the parts are known after it. A plan
 * evaluates many times. A document that does not compile gives a plan that fails with the reason, when it evaluates.
 *
 * @param machine - The world and the code of the evaluators.
 * @param doc - The document, as JSON.
 * @param options - The type of a bare root value, and a trace.
 * @returns The plan.
 */
export function prepare(machine: Machine, doc: unknown, options: PrepareOptions = {}): Plan {
  const c: Compiler = { machine, traced: options.trace === true, maxDepth: machine.maxDepth ?? 1000 };
  let root: { readonly code: Code; readonly run: RunCode };
  try {
    root = compileNode(c, doc, [], options.declaredType, 0);
  } catch (error) {
    const result = placed(thrown(error, "the compilation"), []);
    root = {
      code: () => result,
      run: function* () {
        return result;
      },
    };
  }
  const compiled: CompiledPart = { key: "", path: [], code: root.code, run: root.run };
  return planOf(machine, c.traced, compiled);
}

/** This function makes the object of a plan. Its closures keep only the machine and the compiled root. */
function planOf(machine: Machine, traced: boolean, root: CompiledPart): Plan {
  return {
    machine,
    traced,
    root,
    evaluate(context: Context = makeContext(), evalOptions?: EvalOptions): Result {
      const s = new Session(machine, false, traced, undefined, undefined, evalOptions?.effects);
      return root.code(rootContext(machine, context), s);
    },
    run(context: Context = makeContext(), runOptions: RunOptions = {}): Promise<Result> {
      const s = new Session(machine, true, traced, runOptions.perform, runOptions.signal, undefined);
      return driveWaiting(root.run(rootContext(machine, context), s), runOptions.signal);
    },
  };
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
 * The verb `eval` goes up the ladder for each document. The kind of the document tells where its parts are. The
 * evaluator gets each part sealed: it can evaluate the part, and it cannot read its value. A failure gives an error
 * value, and the function does not throw. An effect is recorded in its order, and nothing does it.
 *
 * @param machine - The world and the code of the evaluators.
 * @param doc - The document, as JSON.
 * @param context - The names and the capabilities at the root.
 * @param declaredType - The type of a bare root value.
 * @returns The result, the trace and the effects in their order.
 */
export function evaluate(machine: Machine, doc: unknown, context: Context = makeContext(), declaredType?: string): Run {
  const plan = prepare(machine, doc, { trace: true, ...(declaredType === undefined ? {} : { declaredType }) });
  const s = new Session(machine, false, true, undefined, undefined, undefined);
  const result = plan.root.code(rootContext(machine, context), s);
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
 * @param options - The host code that does the effects, the type of a bare root value, and a signal.
 * @returns The result, the trace and the effects in their order, when the run ends.
 */
export async function run(machine: Machine, doc: unknown, context: Context = makeContext(), options: RunOptions = {}): Promise<Run> {
  const plan = prepare(machine, doc, { trace: true, ...(options.declaredType === undefined ? {} : { declaredType: options.declaredType }) });
  const s = new Session(machine, true, true, options.perform, options.signal, undefined);
  const result = await driveWaiting(plan.root.run(rootContext(machine, context), s), options.signal);
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
