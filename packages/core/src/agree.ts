import { type Key, docEquals, isRecord } from "./doc.ts";
import type { Context } from "./deref.ts";
import { type EvalError, type Result, isStackOverflow, thrown } from "./errors.ts";
import { type Effect, type Machine, evaluate, makeContext, prepare } from "./evaluate.ts";
import { Held, isClosure } from "./formula.ts";
import { type Definitions, reference } from "./reference.ts";

/**
 * A tier that `agree` compares with the plan.
 *
 * - `reference`: the reference interpreter, which compiles nothing.
 * - `traced`: the traced evaluation, `evaluate`.
 * - `again`: a second evaluation of the same plan.
 * - `other`: the second tier of a language, from the option `other`.
 */
export type Tier = "reference" | "traced" | "again" | "other";

/** What a second tier gives: its result, and its effects when it records them. */
export interface TierResult {
  readonly result: Result;
  readonly effects?: readonly Effect[];
}

/** The options of `agree`. */
export interface AgreeOptions {
  /** The type of a bare root value. */
  readonly declaredType?: string;
  /** The definitional code of the compiled evaluators of the machine, for the reference. */
  readonly definitions?: Definitions;
  /** The tiers to compare with the plan. The default is the reference, the traced evaluation and a second evaluation. */
  readonly tiers?: readonly Exclude<Tier, "other">[];
  /**
   * This function gives the result of the second tier of a language, for example a compiler to loops.
   *
   * @param doc - The document.
   * @param context - The context.
   * @returns The result, or the result with the effects.
   */
  readonly other?: (doc: unknown, context: Context) => Result | TierResult;
  /**
   * This function compares two values that the rules of `sameValue` do not know, for example two dates.
   *
   * @param a - The value of the plan.
   * @param b - The value of the other tier.
   * @returns `true` or `false`, or `undefined` to use the rules of `sameValue`.
   */
  readonly equal?: (a: unknown, b: unknown) => boolean | undefined;
  /** `true`: two errors must also have the same reason, and each error must have a place. */
  readonly strict?: boolean;
  /**
   * This function gives what the host saw since its last call, for example the calls of an operation. `agree` uses
   * it before the plan and after each tier, and compares the results. Thus a tier that evaluates a part that the plan
   * does not evaluate fails.
   *
   * @returns What the host saw.
   */
  readonly observe?: () => unknown;
}

/** The outcome of `agree`: the result of the plan, or the first tier that disagrees with it. */
export type Agreement =
  | { readonly ok: true; readonly result: Result; readonly effects: readonly Effect[] }
  | {
      readonly ok: false;
      readonly tier: Tier;
      /** The result of the plan. */
      readonly plan: Result;
      /** The result of the tier that disagrees. */
      readonly other: Result;
      /** One sentence that tells the difference. */
      readonly reason: string;
    };

/**
 * This function tells if two values are the same for `agree`. Lists and plain records compare item by item and field
 * by field, and the order of the fields does not matter. Each other leaf compares with `Object.is`, thus `-0` is not
 * `0`, and `NaN` is `NaN`. Two closures of `fn` are the same when they have the same parameters. Two `Held` values
 * are the same when their errors have the same code and place. Identity is not compared.
 *
 * @param a - The first value.
 * @param b - The second value.
 * @param equal - The rule of the caller for other values. It answers first, and `undefined` gives the rules above.
 * @returns `true` when the values are the same.
 */
export function sameValue(a: unknown, b: unknown, equal?: (a: unknown, b: unknown) => boolean | undefined): boolean {
  const stack: (readonly [unknown, unknown])[] = [[a, b]];
  const seen = new Map<object, Set<object>>();
  while (stack.length > 0) {
    const [x, y] = stack.pop() as readonly [unknown, unknown];
    if (Object.is(x, y)) continue;
    const told = equal?.(x, y);
    if (told !== undefined) {
      if (told) continue;
      return false;
    }
    if (typeof x !== "object" && typeof x !== "function") return false;
    if (typeof y !== "object" && typeof y !== "function") return false;
    if (x === null || y === null) return false;
    // A pair that the comparison already visits is the same, unless another pair shows a difference.
    const pairs = seen.get(x) ?? new Set<object>();
    if (pairs.has(y)) continue;
    pairs.add(y);
    seen.set(x, pairs);
    if (isClosure(x) || isClosure(y)) {
      if (!(isClosure(x) && isClosure(y))) return false;
      stack.push([closureParams(x), closureParams(y)]);
      continue;
    }
    if (x instanceof Held || y instanceof Held) {
      if (!(x instanceof Held && y instanceof Held) || errorDiffers(x.error, y.error, false) !== undefined) return false;
      continue;
    }
    if (Array.isArray(x) || Array.isArray(y)) {
      if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
      for (let index = 0; index < x.length; index += 1) stack.push([x[index], y[index]]);
      continue;
    }
    if (!isRecord(x) || !isRecord(y)) return false;
    const keys = Object.keys(x);
    if (keys.length !== Object.keys(y).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(y, key)) return false;
      stack.push([x[key], y[key]]);
    }
  }
  return true;
}

const CLOSURE = Symbol.for("coeval.closure");

function closureParams(fn: object): unknown {
  return (fn as { readonly [CLOSURE]?: { readonly params: readonly string[] } })[CLOSURE]?.params;
}

function codeAndPlace(error: EvalError): string {
  return error.place === undefined ? error.code : `${error.code} at [${error.place.join(", ")}]`;
}

/** This function gives the difference of two errors, or `undefined` when they agree. */
function errorDiffers(a: EvalError, b: EvalError, strict: boolean): string | undefined {
  if (a.code !== b.code) return `The plan gives ${codeAndPlace(a)}, and the tier gives ${codeAndPlace(b)}.`;
  if (strict && (a.place === undefined || b.place === undefined)) return `An error ${a.code} has no place.`;
  if (a.place !== undefined && b.place !== undefined && !docEquals(a.place as readonly Key[], b.place as readonly Key[])) {
    return `The error ${a.code} has the place [${a.place.join(", ")}] in the plan, and [${b.place.join(", ")}] in the tier.`;
  }
  if (strict && a.reason !== b.reason) return `The error ${a.code} has another reason in the tier: "${b.reason}" for "${a.reason}".`;
  return undefined;
}

/** A host stack overflow is the one permitted difference (VALUE.DEPTH): the tiers use different numbers of frames. */
function overflowed(result: Result): boolean {
  return !result.ok && result.error.code === "#DEPTH!" && isStackOverflow(result.error.cause);
}

/** This function gives the difference of two results, or `undefined` when they agree. */
function resultDiffers(a: Result, b: Result, options: AgreeOptions): string | undefined {
  if (a.ok && b.ok) return sameValue(a.value, b.value, options.equal) ? undefined : "The plan and the tier give different values.";
  if (!a.ok && !b.ok) return errorDiffers(a.error, b.error, options.strict === true);
  return a.ok ? `The plan gives a value, and the tier gives ${codeAndPlace((b as { readonly error: EvalError }).error)}.` : `The plan gives ${codeAndPlace(a.error)}, and the tier gives a value.`;
}

/** This function gives the difference of two lists of effects, or `undefined` when they agree (EFFECT.ORDER). */
function effectsDiffer(a: readonly Effect[], b: readonly Effect[], options: AgreeOptions): string | undefined {
  if (a.length !== b.length) return `The plan causes ${a.length} effects, and the tier causes ${b.length}.`;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] as Effect;
    const y = b[index] as Effect;
    if (x.kind !== y.kind || !docEquals(x.place as readonly Key[], y.place as readonly Key[]) || !sameValue(x.payload, y.payload, options.equal)) {
      return `The effect ${index} differs: ${x.kind} at [${x.place.join(", ")}] in the plan, and ${y.kind} at [${y.place.join(", ")}] in the tier.`;
    }
  }
  return undefined;
}

/**
 * This function evaluates a document with a plan and with other tiers, and compares the results (PLAN.AGREES). Two
 * results agree when they have the same value by `sameValue`, or errors with the same code, and the same place when
 * both have one. The effects must have the same kinds, places and payloads, in the same order. A language gives its
 * own tier with the option `other`.
 *
 * @param machine - The world and the code of the evaluators.
 * @param doc - The document.
 * @param context - The names and the capabilities at the root.
 * @param options - The tiers, the definitions for the reference, the rules of the comparison and the second tier.
 * @returns The result of the plan, or the first tier that disagrees and the reason.
 */
export function agree(machine: Machine, doc: unknown, context: Context = makeContext(), options: AgreeOptions = {}): Agreement {
  const declared = options.declaredType === undefined ? {} : { declaredType: options.declaredType };
  const observe = options.observe;
  observe?.();
  const plan = prepare(machine, doc, declared);
  const effects: Effect[] = [];
  const result = plan.evaluate(context, { effects });
  const saw = observe?.();

  const differs = (other: Result, otherEffects: readonly Effect[] | undefined): string | undefined => {
    if (overflowed(result) || overflowed(other)) return undefined;
    const why = resultDiffers(result, other, options) ?? (otherEffects === undefined ? undefined : effectsDiffer(effects, otherEffects, options));
    if (why !== undefined || observe === undefined) return why;
    return sameValue(saw, observe(), options.equal) ? undefined : "The host saw other calls in the tier.";
  };

  for (const tier of options.tiers ?? ["reference", "traced", "again"]) {
    let other: Result;
    let otherEffects: Effect[] = [];
    if (tier === "reference") {
      other = reference(machine, doc, context, { ...declared, effects: otherEffects, ...(options.definitions === undefined ? {} : { definitions: options.definitions }) });
    } else if (tier === "traced") {
      const traced = evaluate(machine, doc, context, options.declaredType);
      other = traced.result;
      otherEffects = [...traced.effects];
    } else {
      other = plan.evaluate(context, { effects: otherEffects });
    }
    const why = differs(other, otherEffects);
    if (why !== undefined) return { ok: false, tier, plan: result, other, reason: why };
  }

  if (options.other !== undefined) {
    let given: Result | TierResult;
    try {
      given = options.other(doc, context);
    } catch (error) {
      given = thrown(error, "the tier");
    }
    const other = "result" in given ? given.result : given;
    const why = differs(other, "result" in given ? given.effects : undefined);
    if (why !== undefined) return { ok: false, tier: "other", plan: result, other, reason: why };
  }
  return { ok: true, result, effects };
}
