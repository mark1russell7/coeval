import { type Key, docEquals, equalWith } from "./doc.ts";
import type { Context } from "./deref.ts";
import { type EvalError, type Result, isStackOverflow, thrown } from "./errors.ts";
import { type Effect, type Journal, type Machine, type Perform, JOURNAL, evaluate, makeContext, prepare, run, sharedCopy } from "./evaluate.ts";
import { Held, isClosure } from "./formula.ts";
import { type Definitions, reference, referenceRun } from "./reference.ts";
import { type ReplaySettle, recorder, replayer } from "./replay.ts";

/**
 * A tier that `agree` compares with the plan.
 *
 * - `reference`: the reference interpreter, which compiles nothing.
 * - `traced`: the traced evaluation, `evaluate`.
 * - `again`: a second evaluation of the same plan.
 * - `folds`: a second plan with the other choice of folds (PLAN.FOLD). It has no folds when the plan has them, and
 *   it has folds when the option `observe` stops the folds of the plan.
 * - `fixed`: a plan that declares each name of plain data fixed (PLAN.FIXED). It evaluates with a frozen copy of
 *   each such name, and then with the context of `agree`. `agreeRun` does not have this tier.
 * - `other`: the second tier of a language, from the option `other`.
 */
export type Tier = "reference" | "traced" | "again" | "folds" | "fixed" | "other";

/** What a second tier gives: its result, and its effects when it records them. */
export interface TierResult {
  readonly result: Result;
  readonly effects?: readonly Effect[];
}

/** What `agree` gives the second tier of a language beside the document and the context. */
export interface TierInput {
  /** The mock of the host, when `agree` has one (AGREE.MOCK). The tier answers each effect with it. */
  readonly perform?: Perform;
  /** The verb of `agree`, when its options name one (VERB.AGREE). A tier that does not serve the verb fails. */
  readonly verb?: string;
}

/** The options of `agree`. */
export interface AgreeOptions {
  /** The type of a bare root value. */
  readonly declaredType?: string;
  /**
   * The verb of each tier, as in `prepare`. The default is `eval`. The plan, the reference, the traced evaluation and a
   * second evaluation each ask the ladder for this verb (VERB.AGREE). The second tier of a language gets it in its
   * input.
   */
  readonly verb?: string;
  /** The definitional code of the compiled evaluators of the machine, for the reference. */
  readonly definitions?: Definitions;
  /**
   * The tiers to compare with the plan. The default is the reference, the traced evaluation, a second evaluation, the
   * plan with the other choice of folds and the plan with fixed names.
   */
  readonly tiers?: readonly Exclude<Tier, "other">[];
  /**
   * This function gives the result of the second tier of a language, for example a compiler to loops.
   *
   * @param doc - The document.
   * @param context - The context.
   * @param input - The mock of the host and the verb, when `agree` has them.
   * @returns The result, or the result with the effects.
   */
  readonly other?: (doc: unknown, context: Context, input: TierInput) => Result | TierResult;
  /**
   * The mock of the host (RUN.MOCK, AGREE.MOCK). Each tier gets it, thus the tiers agree on documents with effects. A
   * mock must give the same answer to the same effect, because each tier asks it again.
   */
  readonly perform?: Perform;
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
   * does not evaluate fails. A fold moves the calls of a part to the compilation, thus with this option the plan has
   * no folds. The tier `folds` then has folds, and `agree` does not compare its calls.
   *
   * @returns What the host saw.
   */
  readonly observe?: () => unknown;
}

/** The tiers that `agree` compares when its options name none. */
const DEFAULT_TIERS: readonly Exclude<Tier, "other">[] = /* @__PURE__ */ Object.freeze(["reference", "traced", "again", "folds", "fixed"]);

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
 * `0`, and `NaN` is `NaN`. The identity of a list or of a plain record is not compared.
 *
 * Two closures of `fn` are the same when they have the same parameters. Two `Held` values are the same when their
 * errors have the same code and place. Each other object is the same only as itself, unless the rule of the caller
 * tells otherwise.
 *
 * `docEquals` and `sameResult` use the same walk (D20). `docEquals` has no rules for closures, for `Held` values and
 * for a rule of the caller. `sameResult` is for an early cutoff, thus a closure is the same there only as itself, and
 * two errors also need the same reason.
 *
 * @param a - The first value.
 * @param b - The second value.
 * @param equal - The rule of the caller for other values. It answers first, and `undefined` gives the rules above.
 * @returns `true` when the values are the same.
 */
export function sameValue(a: unknown, b: unknown, equal?: (a: unknown, b: unknown) => boolean | undefined): boolean {
  return equalWith(a, b, equal === undefined ? sameInTiers : (x, y) => equal(x, y) ?? sameInTiers(x, y));
}

/** The rules of `sameValue` for the values that two tiers make again: closures and held errors. */
function sameInTiers(x: unknown, y: unknown): boolean | undefined {
  if (isClosure(x) || isClosure(y)) return isClosure(x) && isClosure(y) && docEquals(closureParams(x), closureParams(y));
  if (x instanceof Held || y instanceof Held) return x instanceof Held && y instanceof Held && errorDiffers(x.error, y.error, false) === undefined;
  return undefined;
}

const CLOSURE = /* @__PURE__ */ Symbol.for("coeval.closure");

/** This function gives the parameters of a closure of `fn`, or `undefined` for another function. */
export function closureParams(fn: object): unknown {
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

/**
 * This function gives the difference of two lists of effects, or `undefined` when they agree (EFFECT.ORDER). When both
 * tiers record the address or the outcome of an effect, these must agree too (AGREE.MOCK).
 */
function effectsDiffer(a: readonly Effect[], b: readonly Effect[], options: AgreeOptions): string | undefined {
  if (a.length !== b.length) return `The plan causes ${a.length} effects, and the tier causes ${b.length}.`;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] as Effect;
    const y = b[index] as Effect;
    if (x.kind !== y.kind || !docEquals(x.place as readonly Key[], y.place as readonly Key[]) || !sameValue(x.payload, y.payload, options.equal)) {
      return `The effect ${index} differs: ${x.kind} at [${x.place.join(", ")}] in the plan, and ${y.kind} at [${y.place.join(", ")}] in the tier.`;
    }
    if (x.address !== undefined && y.address !== undefined && x.address !== y.address) {
      return `The effect ${index} has the address ${x.address} in the plan, and ${y.address} in the tier.`;
    }
    const why = x.outcome !== undefined && y.outcome !== undefined ? resultDiffers(x.outcome, y.outcome, options) : undefined;
    if (why !== undefined) return `The outcome of the effect ${index} differs. ${why}`;
  }
  return undefined;
}

/**
 * This function compares the plan with the tier `fixed` (PLAN.FIXED). The tier declares each name of plain data fixed,
 * with a frozen copy of its value. It evaluates with these copies, thus the folds with fixed names give the result.
 * Then it evaluates with the context of `agree`, thus the code without the fold gives the result. A fold moves the
 * calls of the host to the compilation, thus only the result and the effects compare.
 */
function fixedDiffers(
  machine: Machine,
  doc: unknown,
  context: Context,
  result: Result,
  effects: readonly Effect[],
  given: { readonly declaredType?: string; readonly verb?: string; readonly perform?: Perform },
  options: AgreeOptions,
): { readonly other: Result; readonly reason: string } | undefined {
  const { perform, ...declared } = given;
  const held = fixedContext(context);
  const plan = prepare(machine, doc, { ...declared, fixed: { names: held.fixed } });
  for (const each of [held.context, context]) {
    const tierEffects: Effect[] = [];
    const other = plan.evaluate(each, { effects: tierEffects, ...(perform === undefined ? {} : { perform }) });
    options.observe?.();
    if (overflowed(result) || overflowed(other)) continue;
    const reason = resultDiffers(result, other, options) ?? effectsDiffer(effects, tierEffects, options);
    if (reason !== undefined) return { other, reason };
  }
  return undefined;
}

/**
 * This function gives the context of the tier `fixed`. Each name of plain data gets a deeply frozen copy of its value,
 * and the record of the fixed names holds the same copy. Each other name keeps its value.
 */
function fixedContext(context: Context): { readonly context: Context; readonly fixed: Readonly<Record<string, unknown>> } {
  const given = context.names;
  const names = Object.create(Object.getPrototypeOf(given) as object | null) as Record<string, unknown>;
  const fixed = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(given)) {
    let field = Object.getOwnPropertyDescriptor(given, key) as PropertyDescriptor;
    if (typeof key === "string" && "value" in field) {
      const copy = sharedCopy(field.value);
      if (copy !== undefined || field.value === undefined) {
        Object.defineProperty(fixed, key, { value: copy, enumerable: true });
        field = { ...field, value: copy };
      }
    }
    Object.defineProperty(names, key, field);
  }
  return { context: { ...context, names }, fixed };
}

/**
 * This function evaluates a document with a plan and with other tiers, and compares the results (PLAN.AGREES). Two
 * results agree when they have the same value by `sameValue`, or errors with the same code, and the same place when
 * both have one. The effects must have the same kinds, places and payloads, in the same order. A language gives its
 * own tier with the option `other`. Each tier gets the mock of the option `perform` (AGREE.MOCK).
 *
 * @param machine - The world and the code of the evaluators.
 * @param doc - The document.
 * @param context - The names and the capabilities at the root.
 * @param options - The tiers, the definitions for the reference, the rules of the comparison, the second tier and the mock.
 * @returns The result of the plan, or the first tier that disagrees and the reason.
 */
export function agree(machine: Machine, doc: unknown, context: Context = makeContext(), options: AgreeOptions = {}): Agreement {
  const declared = {
    ...(options.declaredType === undefined ? {} : { declaredType: options.declaredType }),
    ...(options.verb === undefined ? {} : { verb: options.verb }),
  };
  const mock = options.perform === undefined ? {} : { perform: options.perform };
  const tierInput: TierInput = { ...mock, ...(options.verb === undefined ? {} : { verb: options.verb }) };
  const observe = options.observe;
  observe?.();
  // A fold moves host calls to the compilation, thus a plan whose calls the host compares has no folds (PLAN.FOLD).
  const folds = observe === undefined;
  const plan = prepare(machine, doc, { ...declared, fold: folds });
  const effects: Effect[] = [];
  const result = plan.evaluate(context, { effects, ...mock });
  const saw = observe?.();

  const differs = (other: Result, otherEffects: readonly Effect[] | undefined): string | undefined => {
    if (overflowed(result) || overflowed(other)) return undefined;
    const why = resultDiffers(result, other, options) ?? (otherEffects === undefined ? undefined : effectsDiffer(effects, otherEffects, options));
    if (why !== undefined || observe === undefined) return why;
    return sameValue(saw, observe(), options.equal) ? undefined : "The host saw other calls in the tier.";
  };

  for (const tier of options.tiers ?? DEFAULT_TIERS) {
    let other: Result;
    let otherEffects: Effect[] = [];
    if (tier === "reference") {
      other = reference(machine, doc, context, { ...declared, ...mock, effects: otherEffects, ...(options.definitions === undefined ? {} : { definitions: options.definitions }) });
    } else if (tier === "traced") {
      const traced = evaluate(machine, doc, context, { ...declared, ...mock });
      other = traced.result;
      otherEffects = [...traced.effects];
    } else if (tier === "fixed") {
      const why = fixedDiffers(machine, doc, context, result, effects, { ...declared, ...mock }, options);
      if (why !== undefined) return { ok: false, tier, plan: result, other: why.other, reason: why.reason };
      continue;
    } else if (tier === "folds") {
      other = prepare(machine, doc, { ...declared, fold: !folds }).evaluate(context, { effects: otherEffects, ...mock });
      if (observe !== undefined) {
        // The folds of this tier call the host when it compiles. Thus only the result and the effects compare.
        observe();
        if (overflowed(result) || overflowed(other)) continue;
        const why = resultDiffers(result, other, options) ?? effectsDiffer(effects, otherEffects, options);
        if (why !== undefined) return { ok: false, tier, plan: result, other, reason: why };
        continue;
      }
    } else {
      other = plan.evaluate(context, { effects: otherEffects, ...mock });
    }
    const why = differs(other, otherEffects);
    if (why !== undefined) return { ok: false, tier, plan: result, other, reason: why };
  }

  if (options.other !== undefined) {
    let given: Result | TierResult;
    try {
      given = options.other(doc, context, tierInput);
    } catch (error) {
      given = thrown(error, "the tier");
    }
    const other = "result" in given ? given.result : given;
    const why = differs(other, "result" in given ? given.effects : undefined);
    if (why !== undefined) return { ok: false, tier: "other", plan: result, other, reason: why };
  }
  return { ok: true, result, effects };
}

/** The options of `agreeRun`: the options of `agree` without the second tier of a language. */
export interface AgreeRunOptions extends Omit<AgreeOptions, "other" | "perform"> {
  /**
   * The host of the run of the plan (RUN.AGREES). A recorder wraps it, and each other tier replays the log of that run.
   * Thus the host does each effect one time. Without it, an effect gives its payload.
   */
  readonly perform?: Perform;
}

/** The function `perform` of one run, with the effects that it got and the waits of `all` that settled. */
interface Watched {
  readonly perform: Perform;
  readonly effects: Effect[];
  readonly settles: ReplaySettle[];
}

/**
 * This function wraps the function `perform` of a run. The wrapper keeps each effect and each wait of `all` that
 * settles. It gives each effect to the inner function, and each call of its journal to the inner journal.
 */
function watched(perform: Perform): Watched {
  const effects: Effect[] = [];
  const settles: ReplaySettle[] = [];
  const inner = (perform as { readonly [JOURNAL]?: Journal })[JOURNAL];
  const settled = (all: string, item: number): void => {
    settles.push({ all, item });
    inner?.settled?.(all, item);
  };
  const journal: Journal = inner?.next === undefined ? { settled } : { settled, next: (all, waiting) => inner.next?.(all, waiting) };
  const host = (effect: Effect): unknown => {
    effects.push(effect);
    return perform(effect);
  };
  return { perform: Object.assign(host, { [JOURNAL]: journal }), effects, settles };
}

function settleText(settle: ReplaySettle | undefined): string {
  return settle === undefined ? "no item" : `the item ${settle.item} of ${settle.all}`;
}

/** This function gives the first difference of two orders of the waits of `all`, or `undefined` when they agree. */
function settlesDiffer(a: readonly ReplaySettle[], b: readonly ReplaySettle[]): string | undefined {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = a[index];
    const y = b[index];
    if (x?.all !== y?.all || x?.item !== y?.item) return `The wait ${index} settles ${settleText(x)} in the plan, and ${settleText(y)} in the tier.`;
  }
  return undefined;
}

/**
 * This function compares the run of a document in a plan with its run in other tiers (RUN.AGREES). First the plan
 * starts the run with a recorder around the host. Then each tier replays the log of that run. These tiers are the
 * reference run, the traced run, a second run of the plan and the plan with the other choice of folds.
 *
 * The rules of `agree` compare the results and the effects, with their addresses and outcomes. A tier must also
 * settle the waits of each `all` in the order of the plan, thus a replay keeps the order of the waits.
 *
 * @param machine - The world, the evaluators and the runners.
 * @param doc - The document.
 * @param context - The names and the capabilities at the root.
 * @param options - The tiers, the definitions for the reference, the rules of the comparison and the host.
 * @returns The result of the plan, or the first tier that disagrees and the reason.
 */
export async function agreeRun(machine: Machine, doc: unknown, context: Context = makeContext(), options: AgreeRunOptions = {}): Promise<Agreement> {
  const declared = {
    ...(options.declaredType === undefined ? {} : { declaredType: options.declaredType }),
    ...(options.verb === undefined ? {} : { verb: options.verb }),
  };
  const observe = options.observe;
  observe?.();
  // A fold moves host calls to the compilation, thus a plan whose calls the host compares has no folds (PLAN.FOLD).
  const folds = observe === undefined;
  const plan = prepare(machine, doc, { ...declared, fold: folds });
  const recording = recorder(options.perform);
  const first = watched(recording.perform);
  const result = await plan.run(context, { perform: first.perform });
  const saw = observe?.();
  const log = recording.log();

  for (const tier of options.tiers ?? DEFAULT_TIERS) {
    // A run has no tier with fixed names (PLAN.FIXED).
    if (tier === "fixed") continue;
    const replay = watched(replayer(log));
    const host = { perform: replay.perform };
    let other: Result;
    if (tier === "reference") {
      other = await referenceRun(machine, doc, context, { ...declared, ...host, ...(options.definitions === undefined ? {} : { definitions: options.definitions }) });
    } else if (tier === "traced") {
      other = (await run(machine, doc, context, { ...declared, ...host })).result;
    } else if (tier === "folds") {
      other = await prepare(machine, doc, { ...declared, fold: !folds }).run(context, host);
    } else {
      other = await plan.run(context, host);
    }
    // The folds of the tier folds call the host when it compiles. Thus only its result, effects and waits compare.
    const compareCalls = observe !== undefined && tier !== "folds";
    const calls = observe?.();
    if (overflowed(result) || overflowed(other)) continue;
    const why =
      resultDiffers(result, other, options) ??
      effectsDiffer(first.effects, replay.effects, options) ??
      settlesDiffer(first.settles, replay.settles) ??
      (compareCalls && !sameValue(saw, calls, options.equal) ? "The host saw other calls in the tier." : undefined);
    if (why !== undefined) return { ok: false, tier, plan: result, other, reason: why };
  }
  return { ok: true, result, effects: first.effects };
}
