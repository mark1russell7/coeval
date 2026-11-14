import { type Envelope, type Json, type Key, docEquals, isEnvelope, isKey, isRecord, typeName } from "./doc.ts";
import { ask } from "./ladder.ts";
import {
  type AttributeDeclaration,
  type CapsRule,
  type CircularRule,
  type Kind,
  type TreeContract,
  GENERATION_LIMIT,
  atArgsOf,
  atRuleOf,
  circularOf,
  collectOf,
  documentKey,
  equationType,
  lookupKind,
} from "./world.ts";
import { type PartSlot, type Split, partsOf, pathMatches } from "./parts.ts";
import {
  type Cap,
  type Context,
  type Followed,
  type HostThing,
  type Resolution,
  type ResolveOptions,
  type Thing,
  ROOTS,
  THING,
  isHostThing,
  resolve,
  resolveFollowing,
  valueOfThing,
  worldThing,
} from "./deref.ts";
import { type AttributeRung, AT_READERS, STD_EVALUATORS } from "./stdlib.ts";
import { type EvalError, type Failed, type Result, Failure, describe, fail, ok, placed, thrown } from "./errors.ts";
import {
  type AllOptions,
  type Clause,
  type Effect,
  type EvalFn,
  type EvalInput,
  type Journal,
  type Machine,
  type Part,
  type Perform,
  type Read,
  type RunFn,
  type RunInput,
  type RunPart,
  type Steps,
  type StopSignal,
  JOURNAL,
  NODE_WORK,
  WORK_LIMIT,
  heldReason,
  makeContext,
  permits,
  placeText,
  reachedOf,
  waitedReason,
  workFailure,
} from "./evaluate.ts";
import { type FormulaProfile, type OpFn, Held, STD_EXT } from "./formula.ts";

/*
 * The reference interpreter: a direct reading of the rules of docs/SPEC.md. It compiles nothing and caches nothing.
 * At each evaluation of a document, it asks the ladder, finds the kind, splits the value and calls the evaluator. A
 * part evaluates only when its evaluator asks. Thus it shares no compiler with a plan, and a test can compare them.
 */

/**
 * The definitional code of the reference, by evaluator name. The reference cannot read compiled code, thus each
 * compiled evaluator or runner of a machine needs a definition here. A function evaluator needs none.
 */
export interface Definitions {
  readonly evaluators?: Readonly<Record<string, EvalFn>>;
  readonly runners?: Readonly<Record<string, RunFn>>;
}

/** The options of the reference interpreter. */
export interface ReferenceOptions {
  /** The type of a bare root value. */
  readonly declaredType?: string;
  /** The definitional code of the compiled evaluators and runners of the machine. */
  readonly definitions?: Definitions;
  /** A list that gets each effect, in its order. */
  readonly effects?: Effect[];
  /** The mock of the host (RUN.MOCK). It answers each effect at once. Without it, an effect gives its payload. */
  readonly perform?: Perform;
  /**
   * The verb that goes up the ladder at each document, as in `prepare`. The default is `eval`. The reference reads
   * each verb by the same rules (VERB.AGREE).
   */
  readonly verb?: string;
  /**
   * A list that gets each read of a resolution, in its order (REF.READS). A read has the shape of a read of a plan:
   * the path, what it reached and the mark `free`. The reads of a closure and of an equation of a tree go in the
   * same list. The reference adds no kept reads, because it has no static reads of a closure.
   */
  readonly reads?: Read[];
}

/** The options of a run of the reference: the options of an evaluation, with the host and a signal (REF.RUN). */
export interface ReferenceRunOptions extends ReferenceOptions {
  /**
   * The host code that does each effect of a runner. A promise from it makes the run wait. Without it, an effect gives
   * its payload. A journal on the function sets the order of the waits of each `all` (RUN.REPLAY).
   */
  readonly perform?: Perform;
  /** A signal of the host. When it aborts, the run stops with `#ABORT` (RUN.ABORT). */
  readonly signal?: StopSignal;
}

/** The scope of the addresses of effects (RUN.ADDRESS): the root of the evaluation, or one item of `all`. */
interface Scope {
  /** The text before each address of the scope. */
  readonly prefix: string;
  /** The number of earlier effects at each place of the scope, by the text of the place. */
  readonly counts: Map<string, number>;
  /** The number of earlier uses of `all` in the scope. */
  alls: number;
}

/** The record of the reads of one evaluation of the reference (REF.READS). */
interface Reading {
  readonly list: Read[];
  /** The context at the root of the evaluation. A free read reads this context. */
  readonly root: Context;
}

/** The count of the work of one evaluation of the reference (WORK.LIMIT). */
interface Meter {
  spent: number;
  /** `true` after the end of the evaluation. Then each entry from the host starts a new count (WORK.AFTER). */
  ended: boolean;
  /** The count of the applications of closures that run at this time, in each state of the evaluation (WORK.AFTER). */
  active: number;
}

/** The state of one evaluation of the reference. */
interface Env {
  readonly machine: Machine;
  readonly definitions: Definitions;
  readonly effects: Effect[];
  readonly maxDepth: number;
  readonly perform: Perform | undefined;
  /** The journal on the function `perform`, when it has one. It gets and gives the order of the waits of `all`. */
  readonly journal: Journal | undefined;
  /** `true` in a run: the host does each effect of a runner, and an effect of an evaluator gives `#CALC!`. */
  readonly running: boolean;
  /** The verb that goes up the ladder at each document. Each part evaluates with the same verb. */
  readonly verb: string;
  /** The scope of the code that evaluates at this time. `all` changes it for each item. */
  scope: Scope;
  /** The count of the drives without a wait that are active. In a run, an effect under one does not reach the host (RUN.HELD). */
  held: number;
  /** The count of the applications of closures that run at this time: the clock of `call` (FORMULA.CALL-DEPTH, D125). */
  applying: number;
  /** The most work of one evaluation (WORK.LIMIT, D134). */
  readonly maxWork: number;
  /** The count of the work. An equation of a tree shares the count around it (WORK.EQUATION). */
  readonly meter: Meter;
  /** `true` for an equation of a tree (WORK.NODE). */
  readonly nested: boolean;
  /** The record of the reads. A nested evaluation for an equation of a tree keeps the record of its tree. */
  readonly reading: Reading | undefined;
}

/** The code that answers a document: a function evaluator, a runner, or a gap of the reference. */
type Chosen = { readonly evaluator: EvalFn } | { readonly runner: RunFn } | { readonly gap: string };

/** The answers of the ladder and of the contract of the kind for one document. */
interface Seen {
  readonly doc: Envelope;
  readonly kindText: string;
  readonly typePath: readonly Key[];
  readonly kind: Kind | undefined;
  readonly name: string;
  readonly chosen: Chosen;
  readonly split: Extract<Split, { readonly ok: true }>;
}

/** One position of a document: its value, its place, the type that it declares, its depth and its context. */
interface At {
  readonly value: unknown;
  readonly place: readonly Key[];
  readonly declared: string | undefined;
  readonly depth: number;
  readonly address: boolean;
  readonly ctx: Context;
}

function own<T>(table: Readonly<Record<string, T>> | undefined, name: string): T | undefined {
  return table !== undefined && Object.hasOwn(table, name) ? table[name] : undefined;
}

/**
 * This function finds the code of an evaluator name. A runner wins over an evaluator of the same name. A standard
 * evaluator gets the definition of the reference, unless the options give another definition (REF.TREE).
 */
function choose(env: Env, name: string): Chosen | undefined {
  const runner = own(env.machine.runners, name);
  if (runner !== undefined) {
    const defined = own(env.definitions.runners, name);
    if (defined !== undefined) return { runner: defined };
    return typeof runner === "function" ? { runner } : { gap: `The reference has no definition of the compiled runner ${name}.` };
  }
  const evaluator = own(env.machine.evaluators, name);
  if (evaluator === undefined) return undefined;
  const standard = evaluator === own(STD_EVALUATORS, name) ? own(STD_DEFINITIONS.evaluators, name) : undefined;
  const defined = own(env.definitions.evaluators, name) ?? standard;
  if (defined !== undefined) return { evaluator: defined };
  return typeof evaluator === "function" ? { evaluator } : { gap: `The reference has no definition of the compiled evaluator ${name}.` };
}

/**
 * This function reads one document by the rules, in their order. First come an envelope or a declared type
 * (EVAL.ERRORS) and the limit of the depth (PLAN.DEPTH). Then come the ladder of the verb (LADDER.*, VERB.LADDER), an
 * evaluator and the shape of the parts (SHAPE.*).
 */
function examine(env: Env, at: At): Seen | Failed {
  const { place, declared } = at;
  const world = env.machine.world;
  // The lookup of the kind and the split of the value are definitions of the model (D15): partsOf gives both.
  const read = partsOf(world, at.value, declared);
  if (!read.ok) return fail(read.code, read.reason, { place });
  if (at.depth > env.maxDepth) return fail("#DEPTH!", `The nesting is deeper than ${env.maxDepth} documents.`, { place });
  const { doc, kind, split } = read;
  const kindText = typeName(doc.type);
  const answer = ask(world, read.declared ? {} : doc, env.verb, declared === undefined ? {} : { declaredType: declared });
  if (answer.error === "unknown-kind") return fail("#KIND?", `The world has no kind ${kindText}.`, { place });
  const name = answer.evaluator;
  const chosen = name === undefined ? undefined : choose(env, name);
  if (name === undefined || chosen === undefined) return fail("#NOEVAL", `No rung gives an evaluator for ${kindText}.`, { place });
  if (!split.ok) return fail("#VALUE!", split.reason, { place });
  return { doc, kindText, typePath: read.typePath ?? [], kind, name, chosen, split };
}

/**
 * This function gives the effects that two lists of capabilities both permit (CAP.ONLY). The reference reads the rule
 * from SPEC directly, and not from the intersection of the plan. Thus `agree` finds a bug in either one (D15).
 */
function bothPermit(a: readonly Cap[], b: readonly Cap[]): readonly Cap[] {
  const out: Cap[] = [];
  for (const cap of [...a, ...b]) if (permits(a, cap) && permits(b, cap) && !permits(out, cap)) out.push(cap);
  return out;
}

/** This function gives the capabilities that the rules of a kind give one part (D14, CAP.CONTRACT, CAP.ONLY). */
function capsOfPart(rules: readonly CapsRule[] | undefined, path: readonly Key[], caps: readonly Cap[]): readonly Cap[] {
  let out = caps;
  for (const rule of rules ?? []) {
    if (rule.in !== undefined && !rule.in.some((pattern) => pathMatches(path, pattern))) continue;
    if (rule.rule === "mask") return [];
    if (rule.rule === "only") out = bothPermit(out, rule.caps);
  }
  return out;
}

/**
 * This function gives the context of a part. A context that the evaluator gives keeps the effects that both it and
 * the parent permit (CAP.NARROW, CAP.MEET). A list that the parent permits stays as it is. Then the rules of the kind
 * narrow it (CAP.CONTRACT).
 */
function contextOfPart(seen: Seen, slot: PartSlot, parent: Context, given: Context | undefined): Context {
  const own = given === undefined || given === parent;
  const base = own ? parent : given.caps.every((cap) => permits(parent.caps, cap)) ? given : { ...given, caps: bothPermit(parent.caps, given.caps) };
  const handles = own ? refHandles(parent) : givenHandles(parent, given);
  const caps = capsOfPart(seen.kind?.caps, slot.path, base.caps);
  // The rules of the kind narrow the clause kinds as they narrow the capabilities (HANDLE.NARROW).
  const kinds = handles === undefined ? undefined : capsOfPart(seen.kind?.caps, slot.path, handles);
  if (caps === base.caps && kinds === refHandles(base)) return base;
  if (kinds === undefined) return { ...base, caps };
  const out: RefHandling = { ...base, caps, [REF_HANDLES]: kinds };
  return out;
}

/**
 * The key of the clause kinds of a context, as SPEC tells (CAP.GRANT, HANDLE.KINDS): the kinds that the frames of the
 * context answer. They are not capabilities.
 */
const REF_HANDLES = /* @__PURE__ */ Symbol("coeval.reference.handles");

/** A context that can have clause kinds. */
type RefHandling = Context & { readonly [REF_HANDLES]?: readonly Cap[] };

/** This function gives the clause kinds of a context. */
function refHandles(ctx: Context): readonly Cap[] | undefined {
  return (ctx as RefHandling)[REF_HANDLES];
}

/**
 * This function gives the clause kinds of a context that an evaluator gives a part (HANDLE.KINDS, HANDLE.NARROW). A
 * context without them gets none. A list of capabilities that is not the list of the parent narrows them. The part
 * keeps only the kinds that the parent can cause, by the host or by a clause (CAP.MEET).
 */
function givenHandles(parent: Context, given: Context): readonly Cap[] | undefined {
  const own = refHandles(given);
  if (own === undefined) return undefined;
  const kept = given.caps === parent.caps ? own : bothPermit(own, given.caps);
  return bothPermit(kept, [...parent.caps, ...(refHandles(parent) ?? [])]);
}

function headerOf(item: Json): string | undefined {
  return isEnvelope(item) && typeof (item as { readonly name?: unknown }).name === "string" ? (item as { readonly name: string }).name : undefined;
}

function partAt(seen: Seen, at: At, slot: PartSlot, given: Context | undefined): At {
  return {
    value: slot.item,
    place: at.place.concat(slot.path),
    declared: slot.of,
    depth: at.depth + 1,
    address: slot.address === true,
    ctx: contextOfPart(seen, slot, at.ctx, given),
  };
}

/** This function resolves a path with the full algorithm of `resolve`, not with its short path (DEREF.QUICK). */
function resolveFully(machine: Machine, ctx: Context, path: readonly unknown[], options?: ResolveOptions): Resolution {
  const found = resolve(machine, ctx, path, { hops: true });
  return options?.hops === true ? found : { ...found, hops: [] };
}

/** The text that names a resolution in the error of an exception of the host (READS.RECORD). */
const READ_FAILED = "the resolution of a path";

/**
 * This function resolves a path for a document, and records the read when the evaluation has a list (REF.READS,
 * READS.RECORD). An exception of the host gives the error value of the read, and the exception goes on.
 *
 * A reference in the data resolves in the context of the reader (READS.BOUND-REF). In a context with the names and
 * the `self` of the root, the read gets the mark `followed`. In each other context, the read is not free, and the path
 * of each reference is its own read. A path whose resolution followed more references is not free either.
 */
function readAt(env: Env, ctx: Context, path: readonly unknown[], options?: ResolveOptions): Resolution {
  const reading = env.reading;
  if (reading === undefined) return resolveFully(env.machine, ctx, path, options);
  const free = freeIn(reading.root, ctx, path);
  const followed: Followed[] = [];
  let found: Resolution;
  try {
    found = resolveFollowing(env.machine, ctx, path, followed, true);
  } catch (error) {
    reading.list.push({ path, reached: thrown(error, READ_FAILED), free });
    throw error;
  }
  if (options?.hops !== true) found = { ...found, hops: [] };
  const hops = options?.hops === true ? { hops: found.hops } : {};
  const root = reading.root;
  if (followed.length === 0) {
    reading.list.push({ path, reached: reachedOf(found), free, ...hops });
  } else if (ctx === root || (ctx.names === root.names && Object.is(ctx.self, root.self))) {
    reading.list.push({ path, reached: reachedOf(found), free, ...hops, ...(free ? { followed: true as const } : {}) });
  } else {
    reading.list.push({ path, reached: reachedOf(found), free: false, ...hops });
    followed.forEach((entry, index) => {
      const inner = (followed[index + 1]?.depth ?? -1) > entry.depth;
      reading.list.push({ path: entry.path, reached: reachedOf(entry.reached as Resolution), free: !inner && freeIn(root, ctx, entry.path) });
    });
  }
  return found;
}

/**
 * This function tells if a read reads the context at the root of the evaluation (READS.FREE). The reference reads
 * the rule from SPEC. A name that a kind binds, a `self` that a kind sets and a path without a root are not free. A
 * name that a kind does not bind keeps its value from the root.
 */
function freeIn(root: Context, ctx: Context, path: readonly unknown[]): boolean {
  const head = path[0];
  if (head === "self") return Object.is(ctx.self, root.self);
  if (head !== "names") return typeof head === "string" && (ROOTS as readonly string[]).includes(head);
  const name = path[1];
  if (ctx.names === root.names || !isKey(name)) return true;
  const key = String(name);
  const bound = Object.hasOwn(ctx.names, key);
  return bound === Object.hasOwn(root.names, key) && (!bound || Object.is(ctx.names[key], root.names[key]));
}

/** The clauses of one active `handle`, as SPEC tells: the frame around it, and if its body has ended. */
interface RefFrame {
  readonly clauses: readonly Clause[];
  readonly outer: RefFrame | undefined;
  /** The list of the effects of the evaluation: a frame of another evaluation has ended. */
  readonly owner: unknown;
  ended: boolean;
}

/** The key of the frame of a context. */
const REF_FRAME = /* @__PURE__ */ Symbol("coeval.reference.frame");

/** This function gives the frame of a context. */
function refFrame(ctx: Context): RefFrame | undefined {
  return (ctx as Context & { readonly [REF_FRAME]?: RefFrame })[REF_FRAME];
}

/**
 * This function finds the clause for an effect (HANDLE.DO, HANDLE.FORWARD). The clause kinds of the context decide, by
 * the rule of SPEC and not by the rule `permits` of the host (HANDLE.KINDS). An effect that they do not permit gets no
 * clause (HANDLE.NARROW). A clause of a frame that has ended gives `#CAP!` (HANDLE.ENDED).
 */
function clauseAt(env: Env, ctx: Context, kind: Cap, place: readonly Key[]): Clause | Failed | undefined {
  let frame = refFrame(ctx);
  if (frame === undefined) return undefined;
  const keys = typeof kind === "string" ? kind.split(".") : kind;
  const handles = refHandles(ctx);
  if (handles === undefined || !permits(handles, keys)) return undefined;
  for (; frame !== undefined; frame = frame.outer) {
    for (const clause of frame.clauses) {
      if (!permits([clause.op], keys)) continue;
      if (frame.ended || frame.owner !== env.effects) return fail("#CAP!", `The handler of the effect ${keys.join(".")} has ended.`, { place });
      return clause;
    }
  }
  return undefined;
}

/**
 * This function causes an effect when the capabilities permit it (RUN.CAP, CAP.HOOK). It records the effect with its
 * address (RUN.ADDRESS) and its outcome (RUN.OUTCOME). The mock answers the effect at once (RUN.MOCK). Without a
 * mock, the effect gives its payload (RUN.EVAL).
 */
function cause(env: Env, ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Result {
  const effect = recordEffect(env, ctx, kind, payload, place);
  if ("ok" in effect) return effect;
  effect.outcome = answer(env.perform, effect, place);
  return effect.outcome;
}

/**
 * This function causes the effect of an evaluator. In a run, the host does each effect, thus only a runner can cause
 * one. The effect then gives `#CALC!` before the test of its capability (RUN.NEEDS-RUNNER).
 */
function causeFromEvaluator(env: Env, ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Result {
  const text = typeof kind === "string" ? kind : kind.join(".");
  if (env.running) return fail("#CALC!", `The effect ${text} needs a runner: in a run, the host does each effect.`, { place });
  const clause = clauseAt(env, ctx, kind, place);
  if (clause !== undefined) return "ok" in clause ? clause : drive(clause.answer(payload), place, text);
  return cause(env, ctx, kind, payload, place);
}

/**
 * This function causes the effect of a runner. In an evaluation, the mock answers it at once. In a run, the host does
 * it, and a promise from the host makes the steps wait (RUN.SEQ). An effect whose wait a stop ends keeps no outcome
 * (RUN.OUTCOME).
 */
function* causeAndWait(env: Env, ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Steps {
  const clause = clauseAt(env, ctx, kind, place);
  if (clause !== undefined) return "ok" in clause ? clause : yield* clause.answer(payload);
  if (!env.running) return cause(env, ctx, kind, payload, place);
  const effect = recordEffect(env, ctx, kind, payload, place);
  if ("ok" in effect) return effect;
  const perform = env.perform;
  if (perform === undefined) return (effect.outcome = ok(payload));
  if (env.held > 0) {
    // The parent cannot wait for the answer of the host, thus the host does not get the effect (RUN.HELD).
    effect.outcome = fail("#CALC!", heldReason(kind), { place });
    yield Promise.resolve(undefined);
    return effect.outcome;
  }
  let given: unknown;
  try {
    given = perform(effect);
  } catch (error) {
    return (effect.outcome = hostError(effect, place, error));
  }
  if (!(given instanceof Promise)) return (effect.outcome = ok(given));
  const outcome = (yield given.then(
    (value: unknown) => ok(value),
    (error: unknown) => hostError(effect, place, error),
  )) as Result;
  return (effect.outcome = outcome);
}

/** This function checks the capability of an effect, and records the effect with its address (RUN.CAP, RUN.ADDRESS). */
function recordEffect(env: Env, ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Failed | { -readonly [K in keyof Effect]: Effect[K] } {
  const keys = typeof kind === "string" ? kind.split(".") : kind;
  const text = keys.join(".");
  const machine = env.machine;
  const allowed = machine.permits === undefined ? permits(ctx.caps, keys) : machine.permits(ctx.caps, keys, ctx);
  if (!allowed) return fail("#CAP!", `The context has no capability for the effect ${text}.`, { place });
  const at = placeText(place);
  const count = env.scope.counts.get(at) ?? 0;
  env.scope.counts.set(at, count + 1);
  const effect: { -readonly [K in keyof Effect]: Effect[K] } = {
    index: env.effects.length,
    kind: text,
    path: keys,
    payload,
    node: -1,
    at: 0,
    place,
    context: ctx,
    address: `${env.scope.prefix}${at}#${count}`,
  };
  env.effects.push(effect);
  return effect;
}

/** This function gives the outcome of an effect that the host failed. A `Failure` gives its own error value (RUN.CAUSE). */
function hostError(effect: Effect, place: readonly Key[], error: unknown): Result {
  if (error instanceof Failure) return placed({ ok: false, error: error.error }, place);
  return fail("#CALC!", `The host failed the effect ${effect.kind}: ${describe(error)}`, { place, cause: error });
}

/**
 * This function gives the answer of the mock to an effect. A throw gives `#CALC!` with the cause, and a `Failure`
 * gives its own error value. A promise gives `#CALC!`, because an evaluation does not wait.
 */
function answer(perform: Perform | undefined, effect: Effect, place: readonly Key[]): Result {
  if (perform === undefined) return ok(effect.payload);
  let given: unknown;
  try {
    given = perform(effect);
  } catch (error) {
    return hostError(effect, place, error);
  }
  if (!(given instanceof Promise)) return ok(given);
  void given.catch(() => undefined);
  return fail("#CALC!", `The mock gave a promise for the effect ${effect.kind}, and an evaluation does not wait.`, { place });
}

/** This function evaluates a document. Each error gets the place of the document where it started (K5). */
function evaluateAt(env: Env, at: At): Result {
  const seen = examine(env, at);
  if (!("doc" in seen)) return seen;
  return evaluateSeen(env, seen, at);
}

function evaluateSeen(env: Env, seen: Seen, at: At): Result {
  const { chosen } = seen;
  const { place } = at;
  if ("gap" in chosen) return fail("#NOEVAL", chosen.gap, { place });
  if ("runner" in chosen) {
    if (!env.running) return drive(runSeen(env, seen, at, chosen.runner), place, seen.kindText);
    // In a run, an effect under this drive does not reach the host (RUN.HELD).
    env.held += 1;
    try {
      return drive(runSeen(env, seen, at, chosen.runner), place, seen.kindText);
    } finally {
      env.held -= 1;
    }
  }
  const input = evalInput(env, seen, at);
  try {
    return placed(chosen.evaluator(input), place);
  } catch (error) {
    return placed(thrown(error, `the evaluator ${seen.name}`), place);
  }
}

/** This function gives the steps of a document for a runner. Nothing happens before the first step. */
function* stepsAt(env: Env, at: At): Steps {
  const seen = examine(env, at);
  if (!("doc" in seen)) return seen;
  if ("runner" in seen.chosen) return yield* runSeen(env, seen, at, seen.chosen.runner);
  return evaluateSeen(env, seen, at);
}

function* runSeen(env: Env, seen: Seen, at: At, runner: RunFn): Steps {
  try {
    return placed(yield* runner(runInput(env, seen, at)), at.place);
  } catch (error) {
    return placed(thrown(error, `the runner ${seen.name}`), at.place);
  }
}

/** This function drives steps that cannot wait. A step that waits gives `#CALC!` at the document (RUN.WAIT). */
function drive(steps: Steps, place: readonly Key[], kindText: string): Result {
  const step = steps.next();
  if (step.done === true) return step.value;
  void step.value.catch(() => undefined);
  const waited = fail("#CALC!", waitedReason(kindText), { place });
  steps.return(waited);
  return waited;
}

function evalInput(env: Env, seen: Seen, at: At): EvalInput {
  const { split, doc } = seen;
  const parts: Part[] = split.parts.map((slot) => {
    const name = headerOf(slot.item);
    return {
      key: slot.key,
      path: slot.path,
      ...(name === undefined ? {} : { name }),
      evaluate: (given?: Context) => evaluateAt(env, partAt(seen, at, slot, given)),
    };
  });
  const fill = (items: readonly unknown[]): unknown => (split.parts.length === 0 ? doc.value : split.fill(items));
  return {
    kind: seen.kindText,
    typePath: seen.typePath,
    doc,
    value: fill(parts),
    data: split.data,
    parts,
    context: at.ctx,
    place: at.place,
    machine: env.machine,
    ...(at.address ? { address: true } : {}),
    resolve: (path, options) => readAt(env, at.ctx, path, options),
    effect: (kind, payload) => causeFromEvaluator(env, at.ctx, kind, payload, at.place),
    fill,
  };
}

/**
 * This function evaluates a part under a frame. The part gets the kinds of the clauses as clause kinds, and its
 * capabilities stay (CAP.GRANT). The rules of the kind narrow the clause kinds after the grant (HANDLE.NARROW).
 */
function* handledAt(env: Env, part: At, clauses: readonly Clause[], rules: readonly CapsRule[] | undefined, path: readonly Key[]): Steps {
  const frame: RefFrame = { clauses, outer: refFrame(part.ctx), owner: env.effects, ended: false };
  const kinds = capsOfPart(rules, path, [...(refHandles(part.ctx) ?? []), ...clauses.map((clause) => clause.op)]);
  const ctx = { ...part.ctx, [REF_FRAME]: frame, [REF_HANDLES]: kinds };
  try {
    return yield* stepsAt(env, { ...part, ctx });
  } finally {
    frame.ended = true;
  }
}

function runInput(env: Env, seen: Seen, at: At): RunInput {
  const { split, doc } = seen;
  const parts: RunPart[] = split.parts.map((slot) => {
    const name = headerOf(slot.item);
    return {
      key: slot.key,
      path: slot.path,
      ...(name === undefined ? {} : { name }),
      evaluate: (given?: Context) => stepsAt(env, partAt(seen, at, slot, given)),
      handled: (clauses: readonly Clause[]) => handledAt(env, partAt(seen, at, slot, undefined), clauses, seen.kind?.caps, slot.path),
    };
  });
  const fill = (items: readonly unknown[]): unknown => (split.parts.length === 0 ? doc.value : split.fill(items));
  return {
    kind: seen.kindText,
    typePath: seen.typePath,
    doc,
    value: fill(parts),
    data: split.data,
    parts,
    context: at.ctx,
    place: at.place,
    machine: env.machine,
    resolve: (path, options) => readAt(env, at.ctx, path, options),
    effect: (kind, payload) => causeAndWait(env, at.ctx, kind, payload, at.place),
    all: (list, options) => together(env, list, options),
    fill,
  };
}

/** A part of `all` that waits, and the promise that gives its next input. */
interface Waiter {
  readonly index: number;
  readonly steps: Steps;
  next: Promise<Resumed>;
}

/** The input of a part after its wait: the value of the promise, or its rejection. */
interface Resumed {
  readonly waiter: Waiter;
  readonly value?: unknown;
  readonly error?: unknown;
  readonly threw: boolean;
}

/**
 * This function evaluates parts for `all` (RUN.ALL). The parts start in their order, up to the limit, and each part
 * goes on until it ends or waits. A part that waits keeps its place in the limit. With `failFast`, the first failure
 * stops the parts that wait, and the later parts do not start (RUN.FAIL-FAST).
 *
 * When a part waits, the steps wait for the next part that settles. The journal of the host can choose that part
 * (RUN.REPLAY), and it gets each part that settled (RUN.RECORD). In an evaluation, the drive stops at the first wait
 * and gives `#CALC!`. In a run, the host settles the wait, and the part goes on in its own scope.
 *
 * Each part has its own scope of addresses. Its prefix names the use of `all` in the scope around it, and the part
 * (RUN.ADDRESS).
 */
function* together(env: Env, list: readonly RunPart[], options: AllOptions = {}): Generator<Promise<unknown>, readonly Result[], unknown> {
  const limit = Math.max(1, options.concurrency ?? list.length);
  const failFast = options.failFast === true;
  const results: (Result | undefined)[] = list.map(() => undefined);
  const scopes: Scope[] = [];
  const waiting: Waiter[] = [];
  const outer = env.scope;
  const address = `${outer.prefix}all${outer.alls}`;
  outer.alls += 1;
  let failed = false;
  let started = 0;
  let before = 0;
  const end = (index: number, result: Result): void => {
    results[index] = result;
    if (failFast && !result.ok) failed = true;
  };
  /** This function gives a part its input in its own scope, and keeps it in the list when it waits again. */
  const goOn = (index: number, steps: Steps, input: Omit<Resumed, "waiter">): void => {
    const around = env.scope;
    env.scope = scopes[index] as Scope;
    let step: IteratorResult<Promise<unknown>, Result>;
    try {
      step = input.threw ? steps.throw(input.error) : steps.next(input.value);
    } catch (error) {
      end(index, thrown(error, "a part"));
      return;
    } finally {
      env.scope = around;
    }
    if (step.done === true) {
      end(index, step.value);
      return;
    }
    const waiter: Waiter = { index, steps, next: Promise.resolve() as unknown as Promise<Resumed> };
    waiter.next = step.value.then(
      (value: unknown): Resumed => ({ waiter, value, threw: false }),
      (error: unknown): Resumed => ({ waiter, error, threw: true }),
    );
    waiting.push(waiter);
  };
  /** This function starts the next parts in their order, while the limit permits it and no part failed. */
  const startMore = (): void => {
    while (!failed && waiting.length < limit && started < list.length) {
      const index = started;
      started += 1;
      scopes[index] = { prefix: `${address}.${index}/`, counts: new Map(), alls: 0 };
      const around = env.scope;
      env.scope = scopes[index];
      let steps: Steps;
      try {
        steps = (list[index] as RunPart).evaluate();
      } catch (error) {
        end(index, thrown(error, "a part"));
        continue;
      } finally {
        env.scope = around;
      }
      goOn(index, steps, { threw: false });
    }
  };
  startMore();
  while (waiting.length > 0 && !failed) {
    const chosen = env.journal?.next?.(address, waiting.map((waiter) => waiter.index), before);
    const pick = chosen === undefined ? undefined : waiting.find((waiter) => waiter.index === chosen);
    const resumed = (yield pick === undefined ? Promise.race(waiting.map((waiter) => waiter.next)) : pick.next) as Resumed;
    env.journal?.settled?.(address, resumed.waiter.index);
    before += 1;
    waiting.splice(waiting.indexOf(resumed.waiter), 1);
    goOn(resumed.waiter.index, resumed.waiter.steps, resumed);
    startMore();
  }
  if (!failed) return results as readonly Result[];
  const stopped = fail("#ABORT", "The part stopped: a part before it failed, and the parts run with failFast.");
  for (const waiter of waiting) {
    try {
      waiter.steps.return(stopped);
    } catch {
      // The finally code of a part threw. The part stops with the abort.
    }
  }
  return results.map((result) => result ?? stopped);
}

/**
 * This function evaluates a document by the rules, without a compilation. It is the reference of the plans: a plan,
 * a traced plan and the second tier of a language must give its results. In an evaluation, an effect gives the answer
 * of the mock or its payload, and a part that waits gives `#CALC!`. `referenceRun` reads the rules of a run.
 *
 * The verb of the options goes up the ladder at each document, as in `prepare`. Each verb has the same rules: the
 * ladder, the contract of the kind and the sealed parts (VERB.AGREE).
 *
 * @param machine - The world and the code of the evaluators.
 * @param doc - The document.
 * @param context - The names and the capabilities at the root.
 * @param options - The type of a bare root value, the definitions of compiled code, a list for the effects, a mock and the verb.
 * @returns The result.
 */
export function reference(machine: Machine, doc: unknown, context: Context = makeContext(), options: ReferenceOptions = {}): Result {
  return evaluateRoot(machine, doc, context, options, undefined, undefined);
}

/**
 * This function evaluates a document from its root. An equation of a tree gives the record of its tree and the count
 * of its work. Thus its reads go in the list of the outer evaluation (REF.READS), and its work in the outer count
 * (WORK.EQUATION).
 */
function evaluateRoot(machine: Machine, doc: unknown, context: Context, options: ReferenceOptions, outer: Reading | undefined, meter: Meter | undefined): Result {
  const at = rootAt(machine, doc, context, options);
  const env = envOf(machine, options, false, at.ctx, outer, meter);
  try {
    return within(env, () => evaluateAt(env, at));
  } catch (error) {
    return placed(thrown(error, "the reference"), []);
  } finally {
    if (!env.nested) env.meter.ended = true;
  }
}

/**
 * WORK.LIMIT: this function adds work to the count of an evaluation. After the end of the evaluation, each entry from
 * the host starts a new count (WORK.AFTER). A count over the limit throws `#WORK!`.
 */
function spend(env: Pick<Env, "maxWork" | "meter" | "applying">, points: number): void {
  const meter = env.meter;
  if (meter.ended && meter.active === 0) meter.spent = 0;
  meter.spent += points;
  if (meter.spent > env.maxWork) throw new Failure(workFailure(env.maxWork));
}

/**
 * This function starts a run of a document by the rules, without a compilation (REF.RUN). The host does each effect of a runner,
 * and a step waits when the host waits (RUN.SEQ). `all` settles the waits in the order of the host, or in the order
 * of the journal of a replay (RUN.REPLAY). An effect of an evaluator gives `#CALC!` (RUN.NEEDS-RUNNER). A signal that
 * aborts stops the run with `#ABORT` (RUN.ABORT).
 *
 * The part of the run before the first wait happens at once, in the call (RUN.EAGER). `agreeRun` compares the run of
 * a plan with this run.
 *
 * @param machine - The world, the evaluators and the runners.
 * @param doc - The document.
 * @param context - The names and the capabilities at the root.
 * @param options - The options of `reference`, the host and a signal.
 * @returns The result, when the run ends.
 */
export function referenceRun(machine: Machine, doc: unknown, context: Context = makeContext(), options: ReferenceRunOptions = {}): Promise<Result> {
  const at = rootAt(machine, doc, context, options);
  const env = envOf(machine, options, true, at.ctx, undefined, undefined);
  const steps = stepsAt(env, at);
  return driveRun(env, steps, options.signal)
    .catch((error: unknown) => placed(thrown(error, "the reference"), []))
    .finally(() => {
      env.meter.ended = true;
    });
}

/**
 * This function makes the state of the reference for one evaluation or one run. The record of the reads comes from
 * the evaluation around it, or from the list of the options.
 */
function envOf(machine: Machine, options: ReferenceOptions, running: boolean, root: Context, outer: Reading | undefined, meter: Meter | undefined): Env {
  const perform = options.perform;
  return {
    machine,
    definitions: options.definitions ?? {},
    effects: options.effects ?? [],
    maxDepth: machine.maxDepth ?? 1000,
    perform,
    journal: perform === undefined ? undefined : (perform as { readonly [JOURNAL]?: Journal })[JOURNAL],
    running,
    verb: options.verb ?? "eval",
    scope: { prefix: "", counts: new Map(), alls: 0 },
    held: 0,
    applying: 0,
    maxWork: machine.maxWork ?? WORK_LIMIT,
    meter: meter ?? { spent: 0, ended: false, active: 0 },
    nested: meter !== undefined,
    reading: outer ?? (options.reads === undefined ? undefined : { list: options.reads, root }),
  };
}

/** This function gives the root position of a document. A context without a world gets the world of the machine. */
function rootAt(machine: Machine, doc: unknown, context: Context, options: ReferenceOptions): At {
  const ctx = context.world === null ? { ...context, world: worldThing(machine.world) } : context;
  return { value: doc, place: [], declared: options.declaredType, depth: 0, address: false, ctx };
}

/**
 * This function does one synchronous step of an evaluation or a run. A node of a tree reads the definitions of the
 * evaluation for its equations (TREE.LADDER). Thus the state of the evaluation is the innermost one in the step.
 */
function within<T>(env: Env, step: () => T): T {
  activeEnvs.push(env);
  try {
    return step();
  } finally {
    activeEnvs.pop();
  }
}

/** The mark of a signal that aborted. */
const STOPPED: unique symbol = /* @__PURE__ */ Symbol("stopped");

/**
 * This function drives the steps of a run. Each step waits for its promise. A rejection goes into the steps as an
 * exception. A signal that aborts stops the steps with `#ABORT`, also before the first step (RUN.ABORT).
 */
async function driveRun(env: Env, steps: Steps, signal: StopSignal | undefined): Promise<Result> {
  const stop = (): Result => {
    const why = signal?.reason ?? "no reason";
    const aborted = fail("#ABORT", `The host stopped the run: ${describe(why)}`, { cause: signal?.reason });
    try {
      within(env, () => steps.return(aborted));
    } catch {
      // The finally code of a runner threw. The run stops with the abort.
    }
    return aborted;
  };
  if (signal?.aborted === true) return stop();
  const stopping =
    signal === undefined
      ? undefined
      : new Promise<typeof STOPPED>((resolve) => {
          signal.addEventListener("abort", () => resolve(STOPPED), { once: true });
        });
  let step = within(env, () => steps.next());
  while (step.done !== true) {
    let input: unknown;
    try {
      input = await (stopping === undefined ? step.value : Promise.race([step.value, stopping]));
    } catch (error) {
      step = within(env, () => steps.throw(error));
      continue;
    }
    if (input === STOPPED) return stop();
    step = within(env, () => steps.next(input));
  }
  return step.value;
}

/** The evaluations of the reference that run at this time, the innermost last. */
const activeEnvs: Env[] = [];

/*
 * The definition of the decorated tree (TREE.*), written from docs/SPEC.md. It shares no code with `tree.node` of
 * stdlib.ts: its nodes, its memo, its marks for attributes in evaluation and its JSON are its own.
 */

/** One tree of the reference in one evaluation. */
interface RefTree {
  open: boolean;
}

/** A node of the reference. Its host thing is the key of the table `refNodes`. */
interface RefNode {
  readonly tree: RefTree;
  readonly kind: string;
  /** The binding name from the header of the document of the node (TREE.NAMED). */
  readonly name: string | undefined;
  readonly place: readonly Key[];
  readonly parts: readonly Part[];
  readonly ctx: Context;
  /** The tree contract of the kind of the node (D42). */
  readonly contract: TreeContract | undefined;
  /** The type of a bare equation: the type `of` of the parts of the kind. */
  readonly of: string | undefined;
  /** The parent node in the same tree, for the rungs `parent` and `copy`. */
  readonly up: RefNode | undefined;
  /** The evaluation of the reference that made the node. Its equations evaluate with its definitions. */
  readonly env: Env | undefined;
  /** The host thing of the node. */
  thing: HostThing;
  /** The results of the attributes that ended. */
  readonly values: Map<string, Result>;
  /** The attributes in evaluation. */
  readonly pending: Set<string>;
}

const refNodes = /* @__PURE__ */ new WeakMap<object, RefNode>();

/** The attributes in evaluation in the reference, in the order of their demands (TREE.CYCLE). */
const inEvaluation: { readonly node: RefNode; readonly name: string; readonly circular: boolean; tentative: boolean }[] = [];

function nameOfAttribute(node: RefNode, name: string): string {
  return `${name} of ${node.kind} at [${node.place.join(", ")}]`;
}

function refNodeOf(thing: unknown): RefNode | undefined {
  return typeof thing === "object" && thing !== null ? refNodes.get(thing) : undefined;
}

/**
 * TREE.LADDER: an equation of the kind of a node evaluates in the reference. It gets the node as `self`, the names of
 * its rung and no capabilities. A bare equation gets the type `of` of the parts of the kind. The reads of the
 * equation go in the record of the evaluation that made the node (REF.READS).
 */
function equationOf(node: RefNode, term: Json, names: Readonly<Record<string, unknown>>): Result {
  const env = node.env;
  if (env === undefined) return fail("#NOEVAL", "The evaluation of an equation needs the machine.");
  const ctx: Context = { ...node.ctx, names, caps: [], self: node.thing };
  return evaluateRoot(env.machine, term, ctx, { definitions: env.definitions, ...(node.of === undefined ? {} : { declaredType: node.of }) }, env.reading, env.meter);
}

function termIn<T>(table: Readonly<Record<string, T>> | undefined, name: string): T | undefined {
  return table === undefined || !Object.hasOwn(table, name) ? undefined : table[name];
}

/** TREE.DOWN: the names of a child for an equation of `down` of its parent: `child`, `index` and `prev`. */
function namesOfChild(up: RefNode, child: RefNode): Result {
  const children = attributeOf(up, "children");
  if (children !== undefined && !children.ok) return children;
  const list: readonly unknown[] = children !== undefined && Array.isArray(children.value) ? children.value : [];
  const index = list.indexOf(child.thing);
  return ok({ child: child.thing, index: index < 0 ? null : index, prev: index > 0 ? list[index - 1] : null });
}

/** TREE.FOLD: the unit, then `combine` with the attribute of each node of this tree in the list `children`. */
function foldOf(node: RefNode, name: string, fold: NonNullable<AttributeDeclaration["fold"]>): Result {
  let acc = equationOf(node, fold.unit, {});
  if (!acc.ok) return acc;
  const children = attributeOf(node, "children");
  if (children === undefined) return acc;
  if (!children.ok) return children;
  if (!Array.isArray(children.value)) return fail("#VALUE!", `The fold of ${name} needs a list in children.`);
  for (const item of children.value) {
    const child = refNodeOf(item);
    if (child === undefined || child.tree !== node.tree) continue;
    const value = attributeOf(child, name);
    if (value === undefined) return fail("#N/A", `No rung gives ${nameOfAttribute(child, name)}.`);
    if (!value.ok) return value;
    acc = equationOf(node, fold.combine, { acc: acc.value, item: value.value });
    if (!acc.ok) return acc;
  }
  return acc;
}

/**
 * TREE.COLLECT and TREE.NAMED: the node, then each node of this tree in each list `children`, in the order of the
 * lists. Each node counts one time. The registry `names` maps each binding name to its node.
 */
function collectIn(node: RefNode, name: string, declared: unknown): Result {
  const rule = collectOf(declared);
  if (!rule.ok) return fail("#VALUE!", `The attribute ${nameOfAttribute(node, name)} has a bad declaration collect. ${rule.reason}`);
  const registry: Record<string, unknown> = {};
  const first = new Map<string, RefNode>();
  let acc: Result = rule.names ? ok(registry) : equationOf(node, rule.unit, {});
  if (!acc.ok) return acc;
  const done: RefNode[] = [];
  // The contribution of a node comes before the nodes of its list children. A failure ends the collection.
  const visit = (at: RefNode): Result | undefined => {
    if (done.includes(at)) return undefined;
    done.push(at);
    if (rule.names && at.name !== undefined) {
      const earlier = first.get(at.name);
      if (earlier !== undefined) {
        return fail("#VALUE!", `Two nodes have the name ${at.name} in the registry ${nameOfAttribute(node, name)}: ${earlier.kind} at [${earlier.place.join(", ")}] and ${at.kind} at [${at.place.join(", ")}].`);
      }
      first.set(at.name, at);
      Object.defineProperty(registry, at.name, { value: at.thing, enumerable: true, writable: true, configurable: true });
    }
    const term = rule.names ? undefined : termIn(at.contract?.contributes, name);
    if (!rule.names && term !== undefined) {
      const item = equationOf(at, term, {});
      if (!item.ok) return item;
      acc = equationOf(node, rule.combine, { acc: acc.ok ? acc.value : null, item: item.value });
      if (!acc.ok) return acc;
    }
    const children = attributeOf(at, "children");
    if (children === undefined) return undefined;
    if (!children.ok) return children;
    if (!Array.isArray(children.value)) return fail("#VALUE!", `The collection of ${name} needs a list in children of ${at.kind} at [${at.place.join(", ")}].`);
    for (const item of children.value) {
      const child = refNodeOf(item);
      if (child === undefined || child.tree !== node.tree) continue;
      const failed = visit(child);
      if (failed !== undefined) return failed;
    }
    return undefined;
  };
  return visit(node) ?? acc;
}

/** TREE.HIGHER-DEPTH: the depth of each root of a generated document in the reference. */
const refGenerations = /* @__PURE__ */ new WeakMap<RefNode, number>();

/** TREE.HIGHER-DEPTH: the depth of the nearest root of a generated document at or above a node of the reference, or 0. */
function generationIn(node: RefNode): number {
  for (let at: RefNode | undefined = node; at !== undefined; at = at.up) {
    const depth = refGenerations.get(at);
    if (depth !== undefined) return depth;
  }
  return 0;
}

/**
 * TREE.HIGHER: a higher-order attribute. The equation gives a document as data, and the document evaluates with the
 * node as `self`. The reference compiles each document again, thus a structural key is not a part of the meaning.
 */
function higherOf(node: RefNode, name: string, term: Json): Result {
  const value = equationOf(node, term, {});
  if (!value.ok) return value;
  const text = nameOfAttribute(node, name);
  if (documentKey(value.value) === undefined) return fail("#VALUE!", `The equation of the higher-order attribute ${text} gives a value that is not JSON data.`);
  const depth = generationIn(node) + 1;
  if (depth > GENERATION_LIMIT) return fail("#DEPTH!", `The higher-order attribute ${text} is under more than ${GENERATION_LIMIT} generated documents.`);
  const root = equationOf(node, value.value as Json, {});
  if (!root.ok) return root;
  const made = refNodeOf(root.value);
  if (made === undefined) return fail("#VALUE!", `The document of the higher-order attribute ${text} gives no node of the tree.`);
  refGenerations.set(made, depth);
  return root;
}

/** TREE.FORWARD: the last rung. The attribute `forwards` gives a node, and that node answers through its own ladder. */
function forwardOf(node: RefNode, name: string): Result | undefined {
  const target: unknown = node.contract?.forwards;
  if (target === undefined || target === name) return undefined;
  const text = nameOfAttribute(node, name);
  if (typeof target !== "string") return fail("#VALUE!", `The attribute ${text} has a contract with a bad field forwards. It must be a text.`);
  const value = attributeOf(node, target);
  if (value === undefined || !value.ok) return value;
  const to = refNodeOf(value.value);
  if (to === undefined) return fail("#VALUE!", `The attribute ${target} that ${text} forwards to gives no node of a tree.`);
  if (!refGenerations.has(to)) {
    const depth = generationIn(node) + 1;
    if (depth > GENERATION_LIMIT) return fail("#DEPTH!", `The attribute ${text} forwards through more than ${GENERATION_LIMIT} generated documents.`);
    refGenerations.set(to, depth);
  }
  return attributeOf(to, name);
}

/**
 * TREE.LADDER: the rungs of the ladder of an attribute, in their order. A rung gives `undefined` when it does not
 * answer, and the next rung then tries.
 */
const REF_RUNGS: readonly (readonly [AttributeRung, (node: RefNode, name: string) => Result | undefined])[] = [
  ["own", (node, name) => node.parts.find((item) => item.key === name)?.evaluate({ ...node.ctx, self: node.thing })],
  [
    "kind",
    (node, name) => {
      const term = termIn(node.contract?.equations, name);
      return term === undefined ? undefined : equationOf(node, term, {});
    },
  ],
  [
    "parent",
    (node, name) => {
      const up = node.up;
      const term = up === undefined ? undefined : termIn(up.contract?.down, name);
      if (up === undefined || term === undefined) return undefined;
      const names = namesOfChild(up, node);
      return names.ok ? equationOf(up, term, names.value as Readonly<Record<string, unknown>>) : names;
    },
  ],
  ["copy", (node, name) => (node.up !== undefined && termIn(node.contract?.attributes, name)?.copy === true ? attributeOf(node.up, name) : undefined)],
  [
    "default",
    (node, name) => {
      const declared = termIn(node.contract?.attributes, name);
      if (declared?.fold !== undefined) return foldOf(node, name, declared.fold);
      if (declared?.collect !== undefined) return collectIn(node, name, declared.collect);
      if (declared?.default !== undefined) return equationOf(node, declared.default, {});
      return declared?.higher === undefined ? undefined : higherOf(node, name, declared.higher);
    },
  ],
  ["forward", forwardOf],
];

/** TREE.LADDER: the answer of the first rung that answers, or `undefined`. */
function ladderOf(node: RefNode, name: string): Result | undefined {
  for (const [, rung] of REF_RUNGS) {
    const result = rung(node, name);
    if (result !== undefined) return result;
  }
  return undefined;
}

/** One approximation of a circular attribute in the reference, with its round (TREE.CIRCULAR). */
interface RefApproximation {
  readonly result: Result | undefined;
  readonly round: number;
}

/**
 * TREE.CIRCULAR: a fixed point in evaluation in the reference. The first circular attribute of a demand leads it, and
 * each circular attribute that a demand reaches during its rounds joins it.
 */
interface RefPoint {
  /** The index of the leader in `inEvaluation`. */
  readonly depth: number;
  round: number;
  changed: boolean;
  readonly values: Map<RefNode, Map<string, RefApproximation>>;
}

/** The open fixed point of the reference, or `undefined`. */
let refPoint: RefPoint | undefined;

/** TREE.CIRCULAR-CHECK: the declaration `circular` of an attribute of a node, or `undefined`. */
function circularRuleOf(node: RefNode, name: string): CircularRule | undefined {
  const declared = termIn(node.contract?.attributes, name)?.circular;
  return declared === undefined ? undefined : circularOf(declared);
}

/** TREE.CIRCULAR: two approximations are the same when two values are equal (DOC.EQUALS) or two errors have one code and reason. */
function sameApproximation(a: Result | undefined, b: Result | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.ok && b.ok) return docEquals(a.value, b.value);
  if (!a.ok && !b.ok) return a.error.code === b.error.code && a.error.reason === b.error.reason;
  return false;
}

/** TREE.CIRCULAR: the attributes above the leader read an approximation, thus their results are not final. */
function readApproximation(point: RefPoint): void {
  for (const entry of inEvaluation.slice(point.depth + 1)) entry.tentative = true;
}

function approximationsOf(point: RefPoint, node: RefNode): Map<string, RefApproximation> {
  const known = point.values.get(node);
  if (known !== undefined) return known;
  const made = new Map<string, RefApproximation>();
  point.values.set(node, made);
  return made;
}

/**
 * TREE.CIRCULAR and TREE.CIRCULAR-LIMIT: the rounds of the leader of a fixed point. A round without a new value ends
 * the rounds, and each circular attribute of that round keeps its value. An error ends the rounds at once. The last
 * round of the limit gives `#CYCLE!` at the place of the node of the leader.
 */
function fixedPointOf(node: RefNode, name: string, rule: CircularRule & { readonly ok: true }): Result | undefined {
  const point: RefPoint = { depth: inEvaluation.length - 1, round: 0, changed: false, values: new Map() };
  refPoint = point;
  try {
    let before: Result | undefined = ok(rule.start);
    for (;;) {
      point.round += 1;
      point.changed = false;
      const result = ladderOf(node, name);
      if (result !== undefined && !result.ok) return result;
      if (!sameApproximation(before, result)) point.changed = true;
      before = result;
      approximationsOf(point, node).set(name, { result, round: point.round });
      if (!point.changed) {
        for (const [member, values] of point.values) {
          for (const [key, value] of values) if (value.round === point.round && value.result !== undefined) member.values.set(key, value.result);
        }
        return result;
      }
      if (point.round >= rule.limit) {
        return fail("#CYCLE!", `The cycle of the circular attribute ${nameOfAttribute(node, name)} does not become stable within its limit of ${rule.limit} ${rule.limit === 1 ? "round" : "rounds"}.`, {
          place: node.place,
        });
      }
    }
  } finally {
    refPoint = undefined;
  }
}

/** TREE.CIRCULAR: a circular attribute in the open fixed point of another leader evaluates one time in each round. */
function roundOf(point: RefPoint, node: RefNode, name: string, rule: CircularRule & { readonly ok: true }): Result | undefined {
  let value = point.values.get(node)?.get(name);
  if (value === undefined || value.round !== point.round) {
    node.pending.add(name);
    inEvaluation.push({ node, name, circular: true, tentative: false });
    let result: Result | undefined;
    try {
      result = ladderOf(node, name);
    } finally {
      node.pending.delete(name);
      inEvaluation.pop();
    }
    if (!sameApproximation(value === undefined ? ok(rule.start) : value.result, result)) point.changed = true;
    value = { result, round: point.round };
    approximationsOf(point, node).set(name, value);
  }
  readApproximation(point);
  return value.result;
}

/**
 * TREE.ONCE, TREE.MEMO, TREE.CYCLE and TREE.CIRCULAR: the result of one attribute, or `undefined` when no rung of its
 * ladder answers. A result that read an approximation of an open fixed point is not kept.
 */
function attributeOf(node: RefNode, name: string): Result | undefined {
  const done = node.values.get(name);
  if (done !== undefined) return done;
  if (node.pending.has(name)) {
    const from = inEvaluation.findIndex((entry) => entry.node === node && entry.name === name);
    const point = refPoint;
    if (point !== undefined && from >= point.depth && inEvaluation.slice(from).every((entry) => entry.circular)) {
      readApproximation(point);
      const kept = point.values.get(node)?.get(name);
      if (kept !== undefined) return kept.result;
      const rule = circularRuleOf(node, name);
      return ok(rule?.ok === true ? rule.start : null);
    }
    const steps = from < 0 ? [nameOfAttribute(node, name)] : inEvaluation.slice(from).map((entry) => nameOfAttribute(entry.node, entry.name));
    return fail("#CYCLE!", `The attributes form a cycle: ${[...steps, nameOfAttribute(node, name)].join(" -> ")}.`);
  }
  const rule = circularRuleOf(node, name);
  if (rule !== undefined && !rule.ok) {
    const bad = fail("#VALUE!", `The attribute ${nameOfAttribute(node, name)} has a bad declaration circular. ${rule.reason}`);
    node.values.set(name, bad);
    return bad;
  }
  const point = refPoint;
  if (point !== undefined && rule !== undefined) return roundOf(point, node, name, rule);
  const entry = { node, name, circular: rule !== undefined, tentative: false };
  node.pending.add(name);
  inEvaluation.push(entry);
  let result: Result | undefined;
  try {
    result = rule === undefined ? ladderOf(node, name) : fixedPointOf(node, name, rule);
  } finally {
    node.pending.delete(name);
    inEvaluation.pop();
  }
  if (!entry.tentative && result !== undefined) node.values.set(name, result);
  return result;
}

/** TREE.AT: one instance of an attribute with parameters of a node. Its result is `undefined` while it evaluates. */
interface RefInstance {
  readonly attr: string;
  readonly names: unknown;
  result: Result | undefined;
}

/** TREE.AT: the instances of each node of the reference. Two arguments are the same instance by DOC.EQUALS. */
const refInstances = /* @__PURE__ */ new WeakMap<RefNode, RefInstance[]>();

/**
 * TREE.AT: the instance of an attribute with parameters, or `undefined` when the kind has no entry in `tree.at`. The
 * equation sees the arguments as names. A demand of an instance in evaluation gives `#CYCLE!`, also in a fixed point.
 */
function instanceOf(node: RefNode, attr: string, args: unknown): Result | undefined {
  const declared = termIn(node.contract?.at, attr);
  if (declared === undefined) return undefined;
  const rule = atRuleOf(declared);
  if (!rule.ok) return fail("#VALUE!", `The attribute ${nameOfAttribute(node, attr)} has a bad entry tree.at. ${rule.reason}`);
  const given = atArgsOf(rule.params, args);
  if (!given.ok) return fail("#VALUE!", `The step tree.at of ${nameOfAttribute(node, attr)} has bad arguments. ${given.reason}`);
  const name = `${attr} with ${given.key}`;
  const list = refInstances.get(node) ?? [];
  refInstances.set(node, list);
  const found = list.find((item) => item.attr === attr && docEquals(item.names, given.names));
  if (found?.result !== undefined) return found.result;
  if (found !== undefined) {
    const from = inEvaluation.findIndex((entry) => entry.node === node && entry.name === name);
    const steps = inEvaluation.slice(from).map((entry) => nameOfAttribute(entry.node, entry.name));
    return fail("#CYCLE!", `The attributes form a cycle: ${[...steps, nameOfAttribute(node, name)].join(" -> ")}.`);
  }
  const item: RefInstance = { attr, names: given.names, result: undefined };
  list.push(item);
  const entry = { node, name, circular: false, tentative: false };
  inEvaluation.push(entry);
  let result: Result | undefined;
  try {
    result = equationOf(node, rule.equation, given.names);
  } finally {
    inEvaluation.pop();
    // A result that read an approximation is not kept (TREE.CIRCULAR).
    if (result === undefined || entry.tentative) list.splice(list.indexOf(item), 1);
    else item.result = result;
  }
  return result;
}

/** TREE.RESULT: the JSON of a node. `open` holds the nodes and the containers whose JSON is in progress. */
function jsonOfNode(node: RefNode, self: HostThing, open: readonly object[], seen: Set<object>): Result {
  try {
    const record: Record<string, unknown> = {};
    for (const part of node.parts) {
      const result = attributeOf(node, part.key) as Result;
      if (!result.ok) return result;
      const value = plainValue(node, result.value, [...open, self], seen);
      if (!value.ok) return value;
      setField(record, part.key, value.value);
    }
    return ok(record);
  } finally {
    seen.add(self);
  }
}

/**
 * This function gives a copy of a value with the JSON of each node in it. The set `seen` holds each node, list and
 * record that the walk left. A second visit of one of them counts one point on the evaluation of `owner` (WORK.SHARED).
 */
function plainValue(owner: RefNode, value: unknown, open: readonly object[], seen: Set<object>): Result {
  const node = refNodeOf(value);
  if (node !== undefined) {
    if (open.includes(value as object)) return fail("#CYCLE!", `The JSON of the node ${node.kind} at [${node.place.join(", ")}] holds the node itself.`);
    if (seen.has(value as object) && owner.env !== undefined) spend(owner.env, 1);
    return jsonOfNode(node, value as HostThing, open, seen);
  }
  if (typeof value !== "object" || value === null || isHostThing(value) || open.includes(value)) return ok(value);
  if (!Array.isArray(value) && !isRecord(value)) return ok(value);
  if (seen.has(value) && owner.env !== undefined) spend(owner.env, 1);
  try {
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      for (const item of value) {
        const plain = plainValue(owner, item, [...open, value], seen);
        if (!plain.ok) return plain;
        items.push(plain.value);
      }
      return ok(items);
    }
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const plain = plainValue(owner, value[key], [...open, value], seen);
      if (!plain.ok) return plain;
      setField(copy, key, plain.value);
    }
    return ok(copy);
  } finally {
    seen.add(value);
  }
}

/**
 * TREE.LAZY, TREE.PARENT, TREE.SIBLING and TREE.ERROR: a node of an open tree gives its thing, and the root of a new
 * tree gives its JSON. A step on the thing reads an attribute, and a failed attribute throws its own error. The node
 * reads `self` only through `resolve` (C4, TREE.SELF).
 */
const treeDefinition: EvalFn = ({ parts, context, kind, place, machine, typePath, resolve: walk, doc }) => {
  // WORK.NODE: a node that an equation makes counts. A node of the text of the document does not.
  const maker = activeEnvs[activeEnvs.length - 1];
  if (maker?.nested === true) spend(maker, NODE_WORK);
  const reached = walk(["self"]);
  const parent: Thing | undefined = reached.ok ? reached.thing : undefined;
  const outer = refNodeOf(parent);
  const nested = outer !== undefined && outer.tree.open;
  const found = machine === undefined || typePath.length === 0 ? undefined : lookupKind(machine.world, typePath);
  const contract = found?.ok === true ? found.kind.tree : undefined;
  const of = contract === undefined || found?.ok !== true ? undefined : equationType(found.kind);
  const node: RefNode = {
    tree: nested ? outer.tree : { open: true },
    kind,
    name: doc.name,
    place,
    parts,
    ctx: context,
    contract,
    of,
    up: nested ? outer : undefined,
    env: activeEnvs[activeEnvs.length - 1],
    thing: null as unknown as HostThing,
    values: new Map(),
    pending: new Set(),
  };
  const self: HostThing & { readonly type: string } = {
    [THING]: true,
    type: kind,
    label: `node ${kind}`,
    deref: (key): Thing | undefined => {
      if (key === "parent") return parent;
      if (key === "type") return kind;
      const result = attributeOf(node, String(key));
      if (result === undefined || result.ok) return result?.ok === true ? result.value : undefined;
      throw new Failure(result.error);
    },
    has: (key) => key === "parent" || key === "type" || parts.some((part) => part.key === String(key)) || node.values.has(String(key)),
    toJson: () => {
      const result = jsonOfNode(node, self, [], new Set());
      if (result.ok) return result.value;
      throw new Failure(result.error);
    },
  };
  node.thing = self;
  refNodes.set(self, node);
  AT_READERS.set(self, (attr, args) => instanceOf(node, attr, args));
  if (nested) return ok(self);
  try {
    return jsonOfNode(node, self, [], new Set());
  } finally {
    node.tree.open = false;
  }
};

/**
 * The definition of the standard evaluator `ref.resolve` (REF.RESOLVE, D133). It resolves the steps of the path at each
 * evaluation. The plan compiles the same path one time.
 */
const refDefinition: EvalFn = ({ data, resolve: walk }) => {
  if (!Array.isArray(data) || data.length === 0) return fail("#VALUE!", 'The value of ref is a path: a list that starts with a root, for example ["names", "a"].');
  const found = walk(data as readonly Json[]);
  return found.ok ? ok(valueOfThing(found.thing)) : fail(found.code, found.reason);
};

/**
 * The definitions of the reference for the evaluators of the standard machine that need their own reading. The
 * reference uses them for the standard evaluators, also without the option `definitions`. It holds `tree.node` and
 * `ref.resolve`. A host that wraps `ref.resolve` wraps this function, because the standard evaluator is compiled.
 */
export const STD_DEFINITIONS: Definitions = { evaluators: { "tree.node": treeDefinition, "ref.resolve": refDefinition } };

/* The definitions of the formula kit: one function evaluator for each construct, written from docs/SPEC.md. */

const CLOSURE: unique symbol = /* @__PURE__ */ Symbol.for("coeval.closure") as never;

/** This function sets an own field, also the field `__proto__` (SHAPE.PROTO). */
function setField(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function partNamed(parts: readonly Part[], key: string): Part | undefined {
  return parts.find((part) => part.path.length === 1 && part.path[0] === key);
}

function partsUnder(parts: readonly Part[], key: string): readonly Part[] {
  return parts.filter((part) => part.path.length === 2 && part.path[0] === key);
}

/**
 * This function gives the definitions of the formula kit for one profile. Each construct is a function evaluator in
 * the most direct style. It shares no code with the compilers of `formulaEvaluators`, thus the two readings of the
 * rules can disagree, and a test finds it.
 *
 * @param profile - The operations and the rules of the language.
 * @returns The definitions, by evaluator name.
 */
export function formulaDefinitions(profile: FormulaProfile = {}): Definitions {
  const truthy = profile.truthy ?? ((value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined));
  const opOf = (name: string): OpFn | undefined => (typeof profile.ops === "function" ? profile.ops(name) : own(profile.ops, name));
  const noTruth = (what: string): Failed => fail("#VALUE!", `The ${what} must give a truth value.`);

  /** FORMULA.LIST, FORMULA.OPS and FORMULA.COMBINE: the values of parts in order, or the error. */
  const valuesOf = (parts: readonly Part[], skip?: (error: EvalError) => boolean): { readonly values: readonly (unknown | typeof SKIP)[] } | Failed => {
    const values: unknown[] = [];
    const errors: EvalError[] = [];
    for (const part of parts) {
      const result = part.evaluate();
      if (result.ok) values.push(result.value);
      else if (skip?.(result.error) === true) values.push(SKIP);
      else if (profile.combine === undefined) return result;
      else errors.push(result.error);
    }
    if (errors.length === 0 || profile.combine === undefined) return { values };
    return { ok: false, error: errors.length === 1 ? (errors[0] as EvalError) : profile.combine(errors) };
  };

  const lit: EvalFn = ({ doc }) => ok(doc.value);

  const ref: EvalFn = ({ doc, parts, fill, address, context, resolve: walk }) => {
    const path = doc.value;
    if (!Array.isArray(path) || path.length === 0) return fail("#VALUE!", 'The value of ref is a path: a list that starts with a root, for example ["names", "a"].');
    // FORMULA.STEPS: the step documents of the path are parts. They evaluate first, in order.
    let steps: readonly unknown[] = path;
    if (parts.length > 0) {
      const all = valuesOfStrict(parts);
      if (!("values" in all)) return all;
      steps = fill(all.values) as readonly unknown[];
    }
    // FORMULA.LET: a path through a name whose binding failed gives the error of the binding.
    const head = path[0] === "names" && typeof path[1] === "string" ? path[1] : undefined;
    const bound = head === undefined ? undefined : own(context.names, head);
    if (bound instanceof Held) {
      // The result comes from the binding of the name, thus the name is a read (READS.RECORD).
      walk(["names", head]);
      return { ok: false, error: bound.error };
    }
    const found = walk(steps);
    if (!found.ok) return fail(found.code, found.reason);
    // FORMULA.ADDRESS: an address gives what the path reaches.
    if (address === true) return ok(found.thing);
    const reached = valueOfThing(found.thing);
    if (reached instanceof Held) return { ok: false, error: reached.error };
    if (profile.missing?.(reached) === true) return fail("#N/A", "The path reaches no value.");
    return ok(reached);
  };

  const step: EvalFn = ({ doc, parts, fill }) => {
    if (parts.length === 0) return ok(doc);
    const all = valuesOfStrict(parts);
    return "values" in all ? ok({ ...doc, value: fill(all.values) as Json }) : all;
  };

  const record: EvalFn = ({ parts }) => {
    const all = valuesOf(parts, profile.omit);
    if (!("values" in all)) return all;
    const out: Record<string, unknown> = {};
    parts.forEach((part, index) => {
      const value = all.values[index];
      if (value !== SKIP) setField(out, String(part.path[0]), value);
    });
    return ok(out);
  };

  const list: EvalFn = ({ parts }) => {
    const all = valuesOf(parts);
    return "values" in all ? ok([...all.values]) : all;
  };

  const letIn: EvalFn = ({ parts, context }) => {
    const names: Record<string, unknown> = {};
    for (const key of Object.keys(context.names)) setField(names, key, context.names[key]);
    for (const binding of partsUnder(parts, "bind")) {
      const result = binding.evaluate();
      setField(names, String(binding.path[1]), result.ok ? result.value : new Held(result.error));
    }
    return (partNamed(parts, "body") as Part).evaluate({ ...context, names });
  };

  const fn: EvalFn = ({ data, parts, context }) => {
    const params = isRecord(data) ? data["params"] : undefined;
    if (!Array.isArray(params) || !params.every((param) => typeof param === "string") || new Set(params).size !== params.length) {
      return fail("#VALUE!", "The params of fn are a list of different texts.");
    }
    const names = params as readonly string[];
    const body = partNamed(parts, "body") as Part;
    // FORMULA.CALL-DEPTH: the evaluation that makes the closure counts its applications. A quarter of maxDepth is the limit.
    const maker = activeEnvs[activeEnvs.length - 1];
    const clock = maker ?? { applying: 0, maxDepth: 1000, maxWork: WORK_LIMIT, meter: { spent: 0, ended: false, active: 0 } };
    const limit = Math.ceil(clock.maxDepth / 4);
    const closure = (...args: readonly unknown[]): unknown => {
      if (clock.applying >= limit) throw new Failure(fail("#DEPTH!", `The applications of functions nest deeper than ${limit} levels.`).error);
      // WORK.LIMIT: each application counts one point, after the clock of its depth.
      spend(clock, 1);
      clock.applying += 1;
      clock.meter.active += 1;
      try {
        const scope: Record<string, unknown> = {};
        for (const key of Object.keys(context.names)) setField(scope, key, context.names[key]);
        names.forEach((name, index) => setField(scope, name, args[index]));
        // The body evaluates in the state of the evaluation that made the closure, also for a host after the end. Thus a
        // node of a tree in the body has the machine for its equations (WORK.AFTER).
        const scoped: Context = { ...context, names: scope };
        const result = maker === undefined ? body.evaluate(scoped) : within(maker, () => body.evaluate(scoped));
        if (!result.ok) throw new Failure(result.error);
        return result.value;
      } finally {
        clock.applying -= 1;
        clock.meter.active -= 1;
      }
    };
    Object.defineProperty(closure, CLOSURE, { value: { params: names } });
    return ok(closure);
  };

  const call: EvalFn = ({ parts }) => {
    const target = (partNamed(parts, "fn") as Part).evaluate();
    if (!target.ok) return target;
    if (typeof target.value !== "function") return fail("#VALUE!", "The fn of call must give a function.");
    const all = valuesOfStrict(partsUnder(parts, "args"));
    if (!("values" in all)) return all;
    try {
      return ok((target.value as (...items: unknown[]) => unknown)(...all.values));
    } catch (error) {
      return thrown(error, "the function of call");
    }
  };

  const choice: EvalFn = ({ parts }) => {
    const test = (partNamed(parts, "test") as Part).evaluate();
    if (!test.ok) return test;
    const truth = truthy(test.value);
    if (truth === undefined) return noTruth("test of if");
    if (truth) return (partNamed(parts, "then") as Part).evaluate();
    const other = partNamed(parts, "else");
    if (other !== undefined) return other.evaluate();
    return ok(Object.hasOwn(profile, "otherwise") ? profile.otherwise : null);
  };

  /** FORMULA.LOGIC: `and` stops at the first false term, and `or` at the first true term. */
  const logic =
    (stopAt: boolean, what: string): EvalFn =>
    ({ parts }) => {
      let last: Result = ok(!stopAt);
      for (const part of parts) {
        last = part.evaluate();
        if (!last.ok) return last;
        const truth = truthy(last.value);
        if (truth === undefined) return noTruth(what);
        if (truth === stopAt) return profile.logic === "value" ? last : ok(stopAt);
      }
      return profile.logic === "value" ? last : ok(!stopAt);
    };

  const op: EvalFn = ({ typePath, parts }) => {
    const name = typePath.slice(1).join(".");
    const lazy = own(profile.lazy, name);
    if (lazy !== undefined) {
      try {
        return lazy(parts.map((part) => () => part.evaluate()));
      } catch (error) {
        return thrown(error, `the operation ${name}`);
      }
    }
    const apply = opOf(name) as ((...args: unknown[]) => unknown) | undefined;
    if (apply === undefined) return fail("#NAME?", `The language has no operation ${name}.`);
    const all = valuesOf(parts);
    if (!("values" in all)) return all;
    try {
      const out = apply(...all.values);
      return profile.check?.(out, name) ?? ok(out);
    } catch (error) {
      return thrown(error, `the operation ${name}`);
    }
  };

  const ext: EvalFn = ({ typePath, doc, context, machine }) => {
    const name = typePath.slice(1).join(".");
    const handler = own(profile.ext, name) ?? own(STD_EXT, name);
    if (handler === undefined) return fail("#NAME?", `The language has no extension ${name}.`);
    try {
      return handler(doc.value, context, machine?.domains);
    } catch (error) {
      return thrown(error, `the extension ${name}`);
    }
  };

  return {
    evaluators: {
      "formula.lit": lit,
      "formula.ref": ref,
      "formula.step": step,
      "formula.record": record,
      "formula.list": list,
      "formula.let": letIn,
      "formula.fn": fn,
      "formula.call": call,
      "formula.if": choice,
      "formula.and": logic(false, "term of and"),
      "formula.or": logic(true, "term of or"),
      "formula.op": op,
      "formula.ext": ext,
    },
  };
}

/** The mark of a field that the profile leaves out of a record (FORMULA.RECORD). */
const SKIP: unique symbol = /* @__PURE__ */ Symbol("skip");

/** The values of parts in order. The first error stops them, also with `combine` (FORMULA.STEPS, FORMULA.FN). */
function valuesOfStrict(parts: readonly Part[]): { readonly values: readonly unknown[] } | Failed {
  const values: unknown[] = [];
  for (const part of parts) {
    const result = part.evaluate();
    if (!result.ok) return result;
    values.push(result.value);
  }
  return { values };
}
