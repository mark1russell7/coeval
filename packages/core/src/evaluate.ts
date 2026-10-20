import { type Envelope, type Json, fromJson, typed, typeName } from "./doc.ts";
import { splitParts } from "./parts.ts";
import { ask, kindOf, type Answer } from "./ladder.ts";
import type { Side } from "./world.ts";
import {
  type Context,
  type Navigator,
  type Resolution,
  type Thing,
  context as makeRootContext,
  isHostThing,
  resolve,
  worldThing,
} from "./deref.ts";

export type { Context } from "./deref.ts";

/** The code of an error value. */
export type ErrorCode =
  | "#KIND?"
  | "#NOEVAL"
  | "#PART?"
  | "#NAME?"
  | "#REF!"
  | "#CYCLE!"
  | "#STEP?"
  | "#VALUE!"
  | "#ARGS"
  | "#CAP!"
  | "#CALC!"
  | "#DEPTH!";

/** An error value: a code and a reason. An evaluation gives an error value, and it does not throw. */
export interface EvalError {
  readonly code: ErrorCode;
  readonly reason: string;
}

/** The result of an evaluation: a value, or an error value. */
export type Result = { readonly ok: true; readonly value: Json } | { readonly ok: false; readonly error: EvalError };

/**
 * This function makes a result with a value.
 *
 * @param value - The value.
 * @returns The result.
 */
export function ok(value: Json): Result {
  return { ok: true, value };
}

/**
 * This function makes a result with an error value.
 *
 * @param code - The code of the error.
 * @param reason - One sentence that tells the cause.
 * @returns The result.
 */
export function fail(code: ErrorCode, reason: string): Result {
  return { ok: false, error: { code, reason } };
}

/**
 * This function makes a context with names and capabilities. The other roots are empty, and an evaluation sets
 * the world.
 *
 * @param names - The names and their values.
 * @param caps - The effects that the term can cause.
 * @param self - The node of the term, if it has one.
 * @returns The context.
 */
export function makeContext(names: Readonly<Record<string, Json>> = {}, caps: readonly string[] = [], self: Thing = null): Context {
  return makeRootContext({ names, caps, self });
}

/**
 * A sealed part. An evaluator can read the binding name of a part and evaluate it. It cannot read the value of the
 * part, thus two parts that give the same results can replace each other.
 */
export interface Part {
  /** The position of the part in its parent: an index of a list, or a field of a record. */
  readonly key: string;
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
  /** The value of the document without its parts. */
  readonly data: Json;
  /** The parts, in the order of the value. */
  readonly parts: readonly Part[];
  /** The context of the document. */
  readonly context: Context;
  /**
   * This function resolves a path from the context of the document.
   *
   * @param path - The steps. The first step is a root.
   * @returns What the path reached, with each hop.
   */
  resolve(path: readonly Json[]): Resolution;
  /**
   * This function causes an effect. The context must have the capability for the kind of the effect. In a run, an
   * evaluator cannot cause an effect: the host does each effect, thus only a runner can wait for it.
   *
   * @param kind - The kind of the effect, for example `log`.
   * @param payload - The data of the effect.
   * @returns The payload, or the error `#CAP!`.
   */
  effect(kind: string, payload: Json): Result;
}

/** An evaluator: a function from the input of a document to a result. */
export type Evaluator = (input: EvalInput) => Result;

/**
 * The steps of an evaluation that can wait. It yields a promise only when the host makes it wait. A runner takes the
 * result of a part with `yield*`, thus a run goes on at once until an effect waits.
 */
export type Steps = Generator<Promise<Result>, Result, Result>;

/** A part for a runner. Its evaluation can wait for the effects in it. */
export interface RunPart {
  /** The position of the part in its parent: an index of a list, or a field of a record. */
  readonly key: string;
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
  /** The text of the type of the document. */
  readonly kind: string;
  /** The value of the document without its parts. */
  readonly data: Json;
  /** The parts, in the order of the value. */
  readonly parts: readonly RunPart[];
  /** The context of the document. */
  readonly context: Context;
  /**
   * This function resolves a path from the context of the document.
   *
   * @param path - The steps. The first step is a root.
   * @returns What the path reached, with each hop.
   */
  resolve(path: readonly Json[]): Resolution;
  /**
   * This function causes an effect. The context must have the capability. In a run, the host does the effect,
   * and the steps wait when the host waits. In an evaluation, the effect gives its payload. Take its result with
   * `yield*`.
   *
   * @param kind - The kind of the effect, for example `log`.
   * @param payload - The data of the effect.
   * @returns The steps that give the result of the host, or an error value.
   */
  effect(kind: string, payload: Json): Steps;
}

/**
 * A runner: the code of a kind whose parts or effects can wait, as a generator function. The same runner serves an
 * evaluation, which does not wait at any time, and a run, in which the host does each effect.
 */
export type Runner = (input: RunInput) => Steps;

/** A machine: a world of kinds, and the code of each evaluator name, of each `deref` and of each walker. */
export interface Machine extends Navigator {
  readonly evaluators: Readonly<Record<string, Evaluator>>;
  /** The runners, by evaluator name. A runner wins over an evaluator of the same name. */
  readonly runners?: Readonly<Record<string, Runner>>;
  /** The deepest nesting of evaluations. The default is 200. */
  readonly maxDepth?: number;
}

/** An effect that an evaluation caused, in the order of the effects. */
export interface Effect {
  readonly index: number;
  readonly kind: string;
  readonly payload: Json;
  /** The ID of the trace node that caused the effect. */
  readonly node: number;
  /** The number of events before the effect. The effect comes before the end of its node. */
  readonly at: number;
}

/** The host side of a run: it does one effect, and gives its result. A throw or a rejection is an error value. */
export type Perform = (effect: Effect) => Json | Promise<Json>;

/** The options of a run. */
export interface RunOptions {
  /** The host code that does each effect. Without it, an effect gives its payload, as in an evaluation. */
  readonly perform?: Perform;
  /** The type of a bare root value. */
  readonly declaredType?: string;
}

/**
 * This function tells if the capabilities permit an effect. A capability permits the kind of its name, and each kind
 * in its namespace: `store` permits `store.update`.
 *
 * @param caps - The capabilities of the context.
 * @param kind - The kind of the effect.
 * @returns `true` when one capability permits it.
 */
export function permits(caps: readonly string[], kind: string): boolean {
  return caps.some((cap) => cap === kind || kind.startsWith(`${cap}.`));
}

/** One evaluation in a trace. The children are the evaluations of its parts, in the order that they started. */
export interface TraceNode {
  readonly id: number;
  /** The keys from the root document to this document. */
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
  readonly scope: Readonly<Record<string, Json>>;
  /** The capabilities that the document had when its evaluation started. */
  readonly caps: readonly string[];
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
  scope: Readonly<Record<string, Json>>;
  caps: readonly string[];
  self: string;
  enter: number;
  exit: number;
  result: Result;
  children: Building[];
  effects: number[];
}

function selfLabel(self: Thing): string {
  if (isHostThing(self)) return self.label;
  return self === null ? "none" : JSON.stringify(self).slice(0, 40);
}

const NO_ANSWER: Answer = { verb: "eval", error: "no-answer", steps: [] };

/** The state of one evaluation or run: the machine, the effects and the clock. */
interface Session {
  readonly machine: Machine;
  /** `true` in a run: the runners take part, and the host does each effect. */
  readonly running: boolean;
  readonly perform: Perform | undefined;
  readonly effects: Effect[];
  tick: number;
  nextId: number;
}

/** This function drives steps that cannot wait. */
function drive(steps: Steps): Result {
  const step = steps.next();
  if (step.done === true) return step.value;
  void step.value.catch(() => undefined);
  return fail("#CALC!", "A part waited, and its parent cannot wait.");
}

/** This function drives steps that can wait. The steps before the first wait happen at once, in the call. */
async function driveWaiting(steps: Steps): Promise<Result> {
  let step = steps.next();
  while (step.done !== true) {
    let value: Result;
    try {
      value = await step.value;
    } catch (error) {
      step = steps.throw(error);
      continue;
    }
    step = steps.next(value);
  }
  return step.value;
}

function* visit(
  s: Session,
  value: Json,
  path: readonly string[],
  declared: string | undefined,
  ctx: Context,
  parent: Building,
  canWait: boolean,
): Steps {
  const envelope = fromJson(value);
  const doc: Envelope = envelope ?? typed(declared ?? "?", value);
  const node: Building = {
    id: s.nextId,
    path,
    doc,
    declared: envelope === undefined,
    answer: NO_ANSWER,
    side: "derive",
    names: Object.keys(ctx.names),
    scope: ctx.names,
    caps: ctx.caps,
    self: selfLabel(ctx.self),
    enter: s.tick,
    exit: s.tick,
    result: fail("#NOEVAL", "The evaluation did not end."),
    children: [],
    effects: [],
  };
  s.nextId += 1;
  s.tick += 1;
  parent.children.push(node);
  const finish = (result: Result): Result => {
    node.result = result;
    node.exit = s.tick;
    s.tick += 1;
    return result;
  };

  if (envelope === undefined && declared === undefined) {
    return finish(fail("#PART?", "The value has no envelope, and its position declares no type."));
  }
  const maxDepth = s.machine.maxDepth ?? 200;
  if (path.length > maxDepth) return finish(fail("#DEPTH!", `The nesting is deeper than ${maxDepth} documents.`));

  const answer = ask(s.machine.world, envelope ?? {}, "eval", declared === undefined ? {} : { declaredType: declared });
  node.answer = answer;
  const kind = kindOf(s.machine.world, doc.type);
  node.side = kind?.side ?? "derive";
  if (answer.error === "unknown-kind") return finish(fail("#KIND?", `The world has no kind ${typeName(doc.type)}.`));
  const name = answer.evaluator;
  const runners = s.machine.runners ?? {};
  const hasRunner = name !== undefined && Object.hasOwn(runners, name);
  const runner = hasRunner ? runners[name] : undefined;
  const code = name !== undefined && Object.hasOwn(s.machine.evaluators, name) ? s.machine.evaluators[name] : undefined;
  if (name === undefined || (runner === undefined && code === undefined)) {
    return finish(fail("#NOEVAL", `No rung gives an evaluator for ${typeName(doc.type)}.`));
  }
  if (runner !== undefined && s.running && !canWait) {
    return finish(fail("#CALC!", `${typeName(doc.type)} waits for effects, and its parent cannot wait. Give the parent a runner.`));
  }

  const split = splitParts(kind?.parts, doc.value);
  if (!split.ok) return finish(fail("#VALUE!", `${split.reason} The kind is ${typeName(doc.type)}.`));
  const slots = split.parts.map((slot) => ({ slot, header: fromJson(slot.item) }));
  const record = (effectKind: string, payload: Json): Result | Effect => {
    if (!permits(ctx.caps, effectKind)) return fail("#CAP!", `The context has no capability for the effect ${effectKind}.`);
    const effect: Effect = { index: s.effects.length, kind: effectKind, payload, node: node.id, at: s.tick };
    s.effects.push(effect);
    node.effects.push(effect.index);
    return effect;
  };
  const kindText = typeName(doc.type);
  const resolveHere = (steps: readonly Json[]): Resolution => resolve(s.machine, ctx, steps);

  if (runner !== undefined) {
    const parts: RunPart[] = slots.map(({ slot, header }) => ({
      key: slot.key,
      ...(header?.name === undefined ? {} : { name: header.name }),
      evaluate: (override?: Context) => visit(s, slot.item, [...path, slot.key], slot.of, override ?? ctx, node, true),
    }));
    const input: RunInput = {
      kind: kindText,
      data: split.data,
      parts,
      context: ctx,
      resolve: resolveHere,
      effect: function* (effectKind: string, payload: Json): Steps {
        const made = record(effectKind, payload);
        if ("ok" in made) return made;
        if (!s.running || s.perform === undefined) return ok(payload);
        const failed = (error: unknown): Result => fail("#CALC!", `The host failed the effect ${effectKind}: ${String(error)}`);
        let done: Json | Promise<Json>;
        try {
          done = s.perform(made);
        } catch (error) {
          return failed(error);
        }
        if (!(done instanceof Promise)) return ok(done ?? null);
        return yield done.then((result) => ok(result ?? null), failed);
      },
    };
    try {
      return finish(yield* runner(input));
    } catch (error) {
      return finish(fail("#CALC!", `The runner ${name} threw: ${String(error)}`));
    }
  }

  const parts: Part[] = slots.map(({ slot, header }) => ({
    key: slot.key,
    ...(header?.name === undefined ? {} : { name: header.name }),
    evaluate: (override?: Context) => drive(visit(s, slot.item, [...path, slot.key], slot.of, override ?? ctx, node, false)),
  }));
  const input: EvalInput = {
    kind: kindText,
    data: split.data,
    parts,
    context: ctx,
    resolve: resolveHere,
    effect: (effectKind: string, payload: Json) => {
      if (s.running) return fail("#CALC!", `The effect ${effectKind} needs a runner: in a run, the host does each effect.`);
      const made = record(effectKind, payload);
      return "ok" in made ? made : ok(payload);
    },
  };
  try {
    return finish((code as Evaluator)(input));
  } catch (error) {
    return finish(fail("#CALC!", `The evaluator ${name} threw: ${String(error)}`));
  }
}

function holderNode(): Building {
  return {
    id: -1,
    path: [],
    doc: typed("?", null),
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

function rootContext(machine: Machine, context: Context): Context {
  return context.world === null ? { ...context, world: worldThing(machine.world) } : context;
}

function record(s: Session, holder: Building, result: Result): Run {
  const root = holder.children[0];
  if (root === undefined) throw new Error("The evaluation made no trace.");
  return { result, trace: root, effects: s.effects, time: s.tick };
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
export function evaluate(machine: Machine, doc: Json, context: Context = makeContext(), declaredType?: string): Run {
  const s: Session = { machine, running: false, perform: undefined, effects: [], tick: 0, nextId: 0 };
  const holder = holderNode();
  const result = drive(visit(s, doc, [], declaredType, rootContext(machine, context), holder, false));
  return record(s, holder, result);
}

/**
 * This function runs a document: an evaluation in which the host does each effect. A runner waits for its
 * parts and for its effects, thus a step can read the result of the step before. The part of the run before the
 * first wait happens at once, in the call.
 *
 * @param machine - The world, the evaluators and the runners.
 * @param doc - The document, as JSON.
 * @param context - The names and the capabilities at the root.
 * @param options - The host code that does the effects, and the type of a bare root value.
 * @returns The result, the trace and the effects in their order, when the run ends.
 */
export async function run(machine: Machine, doc: Json, context: Context = makeContext(), options: RunOptions = {}): Promise<Run> {
  const s: Session = { machine, running: true, perform: options.perform, effects: [], tick: 0, nextId: 0 };
  const holder = holderNode();
  const result = await driveWaiting(visit(s, doc, [], options.declaredType, rootContext(machine, context), holder, true));
  return record(s, holder, result);
}

/**
 * This function finds a node of a trace by its path.
 *
 * @param trace - The root of the trace.
 * @param path - The keys from the root.
 * @returns The first evaluation at that path, or `undefined` when the document did not evaluate.
 */
export function nodeAt(trace: TraceNode, path: readonly string[]): TraceNode | undefined {
  let node: TraceNode | undefined = trace;
  for (const key of path) {
    node = node?.children.find((child) => child.path[child.path.length - 1] === key);
    if (node === undefined) return undefined;
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
  const walk = (node: TraceNode): void => {
    out.push(node);
    node.children.forEach(walk);
  };
  walk(trace);
  return out.sort((a, b) => a.enter - b.enter);
}
