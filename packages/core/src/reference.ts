import { type Envelope, type Json, type Key, isEnvelope, isRecord, typeName } from "./doc.ts";
import { ask } from "./ladder.ts";
import { type CapsRule, type Kind, lookupKind } from "./world.ts";
import { type PartSlot, type Split, pathMatches, splitParts } from "./parts.ts";
import { type Cap, type Context, type Resolution, type ResolveOptions, resolve, valueOfThing, worldThing } from "./deref.ts";
import { type EvalError, type Failed, type Result, Failure, fail, ok, placed, thrown } from "./errors.ts";
import {
  type AllOptions,
  type Effect,
  type EvalFn,
  type EvalInput,
  type Machine,
  type Part,
  type RunFn,
  type RunInput,
  type RunPart,
  type Steps,
  intersectCaps,
  makeContext,
  permits,
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
}

/** The state of one evaluation of the reference. */
interface Env {
  readonly machine: Machine;
  readonly definitions: Definitions;
  readonly effects: Effect[];
  readonly maxDepth: number;
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

/** This function finds the code of an evaluator name. A runner wins over an evaluator of the same name. */
function choose(env: Env, name: string): Chosen | undefined {
  const runner = own(env.machine.runners, name);
  if (runner !== undefined) {
    const defined = own(env.definitions.runners, name);
    if (defined !== undefined) return { runner: defined };
    return typeof runner === "function" ? { runner } : { gap: `The reference has no definition of the compiled runner ${name}.` };
  }
  const evaluator = own(env.machine.evaluators, name);
  if (evaluator === undefined) return undefined;
  const defined = own(env.definitions.evaluators, name);
  if (defined !== undefined) return { evaluator: defined };
  return typeof evaluator === "function" ? { evaluator } : { gap: `The reference has no definition of the compiled evaluator ${name}.` };
}

/**
 * This function reads one document by the rules, in their order. First come an envelope or a declared type
 * (EVAL.ERRORS) and the limit of the depth (PLAN.DEPTH). Then come the ladder (LADDER.*), an evaluator and the shape
 * of the parts (SHAPE.*).
 */
function examine(env: Env, at: At): Seen | Failed {
  const { place, declared } = at;
  const envelope = isEnvelope(at.value) ? (at.value as Envelope) : undefined;
  if (envelope === undefined && declared === undefined) return fail("#PART?", "The value has no envelope, and its position declares no type.", { place });
  if (at.depth > env.maxDepth) return fail("#DEPTH!", `The nesting is deeper than ${env.maxDepth} documents.`, { place });
  const doc: Envelope = envelope ?? { type: declared as string, value: at.value as Json };
  const kindText = typeName(doc.type);
  const world = env.machine.world;
  const answer = ask(world, envelope ?? {}, "eval", declared === undefined ? {} : { declaredType: declared });
  if (answer.error === "unknown-kind") return fail("#KIND?", `The world has no kind ${kindText}.`, { place });
  const name = answer.evaluator;
  const chosen = name === undefined ? undefined : choose(env, name);
  if (name === undefined || chosen === undefined) return fail("#NOEVAL", `No rung gives an evaluator for ${kindText}.`, { place });
  const found = lookupKind(world, doc.type);
  const kind = found.ok ? found.kind : undefined;
  const split = splitParts(kind?.parts, doc.value);
  if (!split.ok) {
    const where = split.at.length === 0 ? "" : ` (at ${split.at.join(".")})`;
    return fail("#VALUE!", `${split.reason}${where} The kind is ${kindText}.`, { place });
  }
  return { doc, kindText, typePath: found.ok ? found.path : [], kind, name, chosen, split };
}

/** This function gives the capabilities that the rules of a kind give one part (D14, CAP.CONTRACT, CAP.ONLY). */
function capsOfPart(rules: readonly CapsRule[] | undefined, path: readonly Key[], caps: readonly Cap[]): readonly Cap[] {
  let out = caps;
  for (const rule of rules ?? []) {
    if (rule.in !== undefined && !rule.in.some((pattern) => pathMatches(path, pattern))) continue;
    if (rule.rule === "mask") return [];
    if (rule.rule === "only") out = intersectCaps(out, rule.caps);
  }
  return out;
}

/**
 * This function gives the context of a part. A context that the evaluator gives keeps only the capabilities of the
 * parent (CAP.NARROW). Then the rules of the kind narrow it (CAP.CONTRACT).
 */
function contextOfPart(seen: Seen, slot: PartSlot, parent: Context, given: Context | undefined): Context {
  const base = given === undefined || given === parent ? parent : { ...given, caps: given.caps.filter((cap) => permits(parent.caps, cap)) };
  const caps = capsOfPart(seen.kind?.caps, slot.path, base.caps);
  return caps === base.caps ? base : { ...base, caps };
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

/** This function records an effect when the capabilities permit it (RUN.CAP, CAP.HOOK). */
function record(env: Env, ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Failed | undefined {
  const keys = typeof kind === "string" ? kind.split(".") : kind;
  const text = keys.join(".");
  const machine = env.machine;
  const allowed = machine.permits === undefined ? permits(ctx.caps, keys) : machine.permits(ctx.caps, keys, ctx);
  if (!allowed) return fail("#CAP!", `The context has no capability for the effect ${text}.`, { place });
  env.effects.push({ index: env.effects.length, kind: text, path: keys, payload, node: -1, at: 0, place, context: ctx });
  return undefined;
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
  if ("runner" in chosen) return drive(runSeen(env, seen, at, chosen.runner), place);
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
function drive(steps: Steps, place: readonly Key[]): Result {
  const step = steps.next();
  if (step.done === true) return step.value;
  void step.value.catch(() => undefined);
  const waited = fail("#CALC!", "A part waited, and its parent cannot wait.", { place });
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
    ...(at.address ? { address: true } : {}),
    resolve: (path, options) => resolveFully(env.machine, at.ctx, path, options),
    effect: (kind, payload) => record(env, at.ctx, kind, payload, at.place) ?? ok(payload),
    fill,
  };
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
    resolve: (path, options) => resolveFully(env.machine, at.ctx, path, options),
    effect: function* (kind, payload) {
      return record(env, at.ctx, kind, payload, at.place) ?? ok(payload);
    },
    all: (list, options) => together(list, options),
    fill,
  };
}

/**
 * This function evaluates parts for `all` (RUN.ALL). The parts start in their order, up to the limit, and each part
 * goes on until it ends or waits. In an evaluation, a part that waits does not end, thus it keeps its place in the
 * limit. With `failFast`, the first failure stops the parts that wait, and the later parts do not start
 * (RUN.FAIL-FAST). When no part failed and a part waits, the steps wait, and the drive gives `#CALC!`.
 */
function* together(list: readonly RunPart[], options: AllOptions = {}): Generator<Promise<unknown>, readonly Result[], unknown> {
  const limit = Math.max(1, options.concurrency ?? list.length);
  const results: (Result | undefined)[] = list.map(() => undefined);
  const waiting: { readonly steps: Steps; readonly promise: Promise<unknown> }[] = [];
  let failed = false;
  for (let index = 0; index < list.length && !failed && waiting.length < limit; index += 1) {
    let result: Result | undefined;
    try {
      const steps = (list[index] as RunPart).evaluate();
      const step = steps.next();
      if (step.done === true) result = step.value;
      else waiting.push({ steps, promise: step.value });
    } catch (error) {
      result = thrown(error, "a part");
    }
    results[index] = result;
    if (result !== undefined && options.failFast === true && !result.ok) failed = true;
  }
  if (failed) {
    const stopped = fail("#ABORT", "The part stopped: a part before it failed, and the parts run with failFast.");
    for (const item of waiting) {
      try {
        item.steps.return(stopped);
      } catch {
        // The finally code of a part threw. The part stops with the abort.
      }
    }
    return results.map((result) => result ?? stopped);
  }
  if (waiting.length > 0) yield Promise.race(waiting.map((item) => item.promise));
  // An evaluation stops at the first wait, thus only parts that ended reach this line.
  return results as readonly Result[];
}

/**
 * This function evaluates a document by the rules, without a compilation. It is the reference of the plans: a plan,
 * a traced plan and the second tier of a language must give its results. It covers evaluations, not runs: an effect
 * gives its payload, and a part that waits gives `#CALC!`.
 *
 * @param machine - The world and the code of the evaluators.
 * @param doc - The document.
 * @param context - The names and the capabilities at the root.
 * @param options - The type of a bare root value, the definitions of compiled code, and a list for the effects.
 * @returns The result.
 */
export function reference(machine: Machine, doc: unknown, context: Context = makeContext(), options: ReferenceOptions = {}): Result {
  const env: Env = { machine, definitions: options.definitions ?? {}, effects: options.effects ?? [], maxDepth: machine.maxDepth ?? 1000 };
  const ctx = context.world === null ? { ...context, world: worldThing(machine.world) } : context;
  try {
    return evaluateAt(env, { value: doc, place: [], declared: options.declaredType, depth: 0, address: false, ctx });
  } catch (error) {
    return placed(thrown(error, "the reference"), []);
  }
}

/* The definitions of the formula kit: one function evaluator for each construct, written from docs/SPEC.md. */

const CLOSURE: unique symbol = Symbol.for("coeval.closure") as never;

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
    if (bound instanceof Held) return { ok: false, error: bound.error };
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
    const closure = (...args: readonly unknown[]): unknown => {
      const scope: Record<string, unknown> = {};
      for (const key of Object.keys(context.names)) setField(scope, key, context.names[key]);
      names.forEach((name, index) => setField(scope, name, args[index]));
      const result = body.evaluate({ ...context, names: scope });
      if (!result.ok) throw new Failure(result.error);
      return result.value;
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

  const ext: EvalFn = ({ typePath, doc, context }) => {
    const name = typePath.slice(1).join(".");
    const handler = own(profile.ext, name) ?? own(STD_EXT, name);
    if (handler === undefined) return fail("#NAME?", `The language has no extension ${name}.`);
    try {
      return handler(doc.value, context);
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
const SKIP: unique symbol = Symbol("skip");

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
