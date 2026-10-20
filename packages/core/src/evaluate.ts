import { type Envelope, type Json, fromJson, typed } from "./doc.ts";
import { splitParts } from "./parts.ts";
import { ask, kindNamed, type Answer, type Side, type World } from "./ladder.ts";

/** The code of an error value. */
export type ErrorCode = "#KIND?" | "#NOEVAL" | "#PART?" | "#NAME?" | "#VALUE!" | "#ARGS" | "#CAP!" | "#CALC!" | "#DEPTH!";

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

/** The context of a term: the names that it can read, and the effects that it can cause. */
export interface Context {
  readonly names: ReadonlyMap<string, Json>;
  readonly caps: ReadonlySet<string>;
}

/**
 * This function makes a context.
 *
 * @param names - The names and their values.
 * @param caps - The effects that the term can cause.
 * @returns The context.
 */
export function makeContext(names: Readonly<Record<string, Json>> = {}, caps: readonly string[] = []): Context {
  return { names: new Map(Object.entries(names)), caps: new Set(caps) };
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
  /** The value of the document without its parts. */
  readonly data: Json;
  /** The parts, in the order of the value. */
  readonly parts: readonly Part[];
  /** The context of the document. */
  readonly context: Context;
  /**
   * This function causes an effect. The context must have the capability for the kind of the effect.
   *
   * @param kind - The kind of the effect, for example `log`.
   * @param payload - The data of the effect.
   * @returns The payload, or the error `#CAP!`.
   */
  effect(kind: string, payload: Json): Result;
}

/** An evaluator: a function from the input of a document to a result. */
export type Evaluator = (input: EvalInput) => Result;

/** A machine: a world of kinds, and the code of each evaluator name. */
export interface Machine {
  readonly world: World;
  readonly evaluators: Readonly<Record<string, Evaluator>>;
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
  enter: number;
  exit: number;
  result: Result;
  children: Building[];
  effects: number[];
}

const NO_ANSWER: Answer = { verb: "eval", error: "no-answer", steps: [] };

/**
 * This function evaluates a document, and records each evaluation in a trace.
 *
 * The verb `eval` goes up the ladder for each document. The kind of the document tells where its parts are. The
 * evaluator gets each part sealed: it can evaluate the part, and it cannot read its value. A failure gives an error
 * value, and the function does not throw.
 *
 * @param machine - The world and the code of the evaluators.
 * @param doc - The document, as JSON.
 * @param context - The names and the capabilities at the root.
 * @param declaredType - The type of a bare root value.
 * @returns The result, the trace and the effects in their order.
 */
export function evaluate(machine: Machine, doc: Json, context: Context = makeContext(), declaredType?: string): Run {
  const effects: Effect[] = [];
  let tick = 0;
  let nextId = 0;
  const maxDepth = machine.maxDepth ?? 200;

  const visit = (value: Json, path: readonly string[], declared: string | undefined, ctx: Context, parent: Building | undefined): Result => {
    const envelope = fromJson(value);
    const doc: Envelope = envelope ?? typed(declared ?? "?", value);
    const node: Building = {
      id: nextId,
      path,
      doc,
      declared: envelope === undefined,
      answer: NO_ANSWER,
      side: "derive",
      names: [...ctx.names.keys()],
      scope: Object.fromEntries(ctx.names),
      caps: [...ctx.caps],
      enter: tick,
      exit: tick,
      result: fail("#NOEVAL", "The evaluation did not end."),
      children: [],
      effects: [],
    };
    nextId += 1;
    tick += 1;
    parent?.children.push(node);
    const finish = (result: Result): Result => {
      node.result = result;
      node.exit = tick;
      tick += 1;
      return result;
    };

    if (envelope === undefined && declared === undefined) {
      return finish(fail("#PART?", "The value has no envelope, and its position declares no type."));
    }
    if (path.length > maxDepth) return finish(fail("#DEPTH!", `The nesting is deeper than ${maxDepth} documents.`));

    const answer = ask(machine.world, envelope ?? {}, "eval", declared === undefined ? {} : { declaredType: declared });
    node.answer = answer;
    const kind = kindNamed(machine.world, doc.type);
    node.side = kind?.side ?? "derive";
    if (answer.error === "unknown-kind") return finish(fail("#KIND?", `The world has no kind ${doc.type}.`));
    const name = answer.evaluator;
    const code = name !== undefined && Object.hasOwn(machine.evaluators, name) ? machine.evaluators[name] : undefined;
    if (name === undefined || code === undefined) {
      return finish(fail("#NOEVAL", `No rung gives an evaluator for ${doc.type}.`));
    }

    const split = splitParts(kind?.parts, doc.value);
    if (!split.ok) return finish(fail("#VALUE!", `${split.reason} The kind is ${doc.type}.`));
    const parts: Part[] = split.parts.map((slot) => {
      const header = fromJson(slot.item);
      return {
        key: slot.key,
        ...(header?.name === undefined ? {} : { name: header.name }),
        evaluate: (override?: Context) => visit(slot.item, [...path, slot.key], slot.of, override ?? ctx, node),
      };
    });
    const data = split.data;

    const input: EvalInput = {
      data,
      parts,
      context: ctx,
      effect: (effectKind: string, payload: Json) => {
        if (!ctx.caps.has(effectKind)) {
          return fail("#CAP!", `The context has no capability for the effect ${effectKind}.`);
        }
        const index = effects.length;
        effects.push({ index, kind: effectKind, payload, node: node.id, at: tick });
        node.effects.push(index);
        return ok(payload);
      },
    };
    try {
      return finish(code(input));
    } catch (error) {
      return finish(fail("#CALC!", `The evaluator ${name} threw: ${String(error)}`));
    }
  };

  const holder: Building = {
    id: -1,
    path: [],
    doc: typed("?", null),
    declared: false,
    answer: NO_ANSWER,
    side: "derive",
    names: [],
    scope: {},
    caps: [],
    enter: 0,
    exit: 0,
    result: ok(null),
    children: [],
    effects: [],
  };
  const result = visit(doc, [], declaredType, context, holder);
  const root = holder.children[0];
  if (root === undefined) throw new Error("The evaluation made no trace.");
  return { result, trace: root, effects, time: tick };
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
