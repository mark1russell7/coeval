import { type Envelope, type Json, type Key, isEnvelope, isRecord, typeName } from "./doc.ts";
import { ask } from "./ladder.ts";
import type { CapsRule, Kind } from "./world.ts";
import { type PartSlot, type Split, partsOf, pathMatches } from "./parts.ts";
import { type Cap, type Context, type HostThing, type Resolution, type ResolveOptions, type Thing, THING, isHostThing, resolve, valueOfThing, worldThing } from "./deref.ts";
import { STD_EVALUATORS } from "./stdlib.ts";
import { type EvalError, type Failed, type Result, Failure, describe, fail, ok, placed, thrown } from "./errors.ts";
import {
  type AllOptions,
  type Effect,
  type EvalFn,
  type EvalInput,
  type Machine,
  type Part,
  type Perform,
  type RunFn,
  type RunInput,
  type RunPart,
  type Steps,
  intersectCaps,
  makeContext,
  permits,
  placeText,
  waitedReason,
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

/** The state of one evaluation of the reference. */
interface Env {
  readonly machine: Machine;
  readonly definitions: Definitions;
  readonly effects: Effect[];
  readonly maxDepth: number;
  readonly perform: Perform | undefined;
  /** The verb that goes up the ladder at each document. Each part evaluates with the same verb. */
  readonly verb: string;
  /** The scope of the code that evaluates at this time. `all` changes it for each item. */
  scope: Scope;
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

/**
 * This function causes an effect when the capabilities permit it (RUN.CAP, CAP.HOOK). It records the effect with its
 * address (RUN.ADDRESS) and its outcome (RUN.OUTCOME). The mock answers the effect at once (RUN.MOCK). Without a
 * mock, the effect gives its payload (RUN.EVAL).
 */
function cause(env: Env, ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Result {
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
  effect.outcome = answer(env.perform, effect, place);
  return effect.outcome;
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
    if (error instanceof Failure) return placed({ ok: false, error: error.error }, place);
    return fail("#CALC!", `The host failed the effect ${effect.kind}: ${describe(error)}`, { place, cause: error });
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
  if ("runner" in chosen) return drive(runSeen(env, seen, at, chosen.runner), place, seen.kindText);
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
    resolve: (path, options) => resolveFully(env.machine, at.ctx, path, options),
    effect: (kind, payload) => cause(env, at.ctx, kind, payload, at.place),
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
    machine: env.machine,
    resolve: (path, options) => resolveFully(env.machine, at.ctx, path, options),
    effect: function* (kind, payload) {
      return cause(env, at.ctx, kind, payload, at.place);
    },
    all: (list, options) => together(env, list, options),
    fill,
  };
}

/**
 * This function evaluates parts for `all` (RUN.ALL). The parts start in their order, up to the limit, and each part
 * goes on until it ends or waits. In an evaluation, a part that waits does not end, thus it keeps its place in the
 * limit. With `failFast`, the first failure stops the parts that wait, and the later parts do not start
 * (RUN.FAIL-FAST). When no part failed and a part waits, the steps wait, and the drive gives `#CALC!`.
 *
 * Each part has its own scope of addresses. Its prefix names the use of `all` in the scope around it, and the part
 * (RUN.ADDRESS).
 */
function* together(env: Env, list: readonly RunPart[], options: AllOptions = {}): Generator<Promise<unknown>, readonly Result[], unknown> {
  const limit = Math.max(1, options.concurrency ?? list.length);
  const results: (Result | undefined)[] = list.map(() => undefined);
  const waiting: { readonly steps: Steps; readonly promise: Promise<unknown> }[] = [];
  const outer = env.scope;
  const address = `${outer.prefix}all${outer.alls}`;
  outer.alls += 1;
  let failed = false;
  for (let index = 0; index < list.length && !failed && waiting.length < limit; index += 1) {
    let result: Result | undefined;
    env.scope = { prefix: `${address}.${index}/`, counts: new Map(), alls: 0 };
    try {
      const steps = (list[index] as RunPart).evaluate();
      const step = steps.next();
      if (step.done === true) result = step.value;
      else waiting.push({ steps, promise: step.value });
    } catch (error) {
      result = thrown(error, "a part");
    } finally {
      env.scope = outer;
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
 * gives the answer of the mock or its payload, and a part that waits gives `#CALC!`.
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
  const env: Env = {
    machine,
    definitions: options.definitions ?? {},
    effects: options.effects ?? [],
    maxDepth: machine.maxDepth ?? 1000,
    perform: options.perform,
    verb: options.verb ?? "eval",
    scope: { prefix: "", counts: new Map(), alls: 0 },
  };
  const ctx = context.world === null ? { ...context, world: worldThing(machine.world) } : context;
  try {
    return evaluateAt(env, { value: doc, place: [], declared: options.declaredType, depth: 0, address: false, ctx });
  } catch (error) {
    return placed(thrown(error, "the reference"), []);
  }
}

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
  readonly place: readonly Key[];
  readonly parts: readonly Part[];
  readonly ctx: Context;
  /** The results of the attributes that ended. */
  readonly values: Map<string, Result>;
  /** The attributes in evaluation. */
  readonly pending: Set<string>;
}

const refNodes = /* @__PURE__ */ new WeakMap<object, RefNode>();

/** The attributes in evaluation in the reference, in the order of their demands (TREE.CYCLE). */
const inEvaluation: { readonly node: RefNode; readonly name: string }[] = [];

function nameOfAttribute(node: RefNode, name: string): string {
  return `${name} of ${node.kind} at [${node.place.join(", ")}]`;
}

function refNodeOf(thing: unknown): RefNode | undefined {
  return typeof thing === "object" && thing !== null ? refNodes.get(thing) : undefined;
}

/** TREE.ONCE, TREE.MEMO and TREE.CYCLE: the result of one attribute, or `undefined` when the node has no such part. */
function attributeOf(node: RefNode, self: HostThing, name: string): Result | undefined {
  const done = node.values.get(name);
  if (done !== undefined) return done;
  if (node.pending.has(name)) {
    const from = inEvaluation.findIndex((entry) => entry.node === node && entry.name === name);
    const steps = from < 0 ? [nameOfAttribute(node, name)] : inEvaluation.slice(from).map((entry) => nameOfAttribute(entry.node, entry.name));
    return fail("#CYCLE!", `The attributes form a cycle: ${[...steps, nameOfAttribute(node, name)].join(" -> ")}.`);
  }
  const part = node.parts.find((item) => item.key === name);
  if (part === undefined) return undefined;
  node.pending.add(name);
  inEvaluation.push({ node, name });
  try {
    const result = part.evaluate({ ...node.ctx, self });
    node.values.set(name, result);
    return result;
  } finally {
    node.pending.delete(name);
    inEvaluation.pop();
  }
}

/** TREE.RESULT: the JSON of a node. `open` holds the nodes and the containers whose JSON is in progress. */
function jsonOfNode(node: RefNode, self: HostThing, open: readonly object[]): Result {
  const record: Record<string, unknown> = {};
  for (const part of node.parts) {
    const result = attributeOf(node, self, part.key) as Result;
    if (!result.ok) return result;
    const value = plainValue(result.value, [...open, self]);
    if (!value.ok) return value;
    setField(record, part.key, value.value);
  }
  return ok(record);
}

/** This function gives a copy of a value with the JSON of each node in it. */
function plainValue(value: unknown, open: readonly object[]): Result {
  const node = refNodeOf(value);
  if (node !== undefined) {
    if (open.includes(value as object)) return fail("#CYCLE!", `The JSON of the node ${node.kind} at [${node.place.join(", ")}] holds the node itself.`);
    return jsonOfNode(node, value as HostThing, open);
  }
  if (typeof value !== "object" || value === null || isHostThing(value) || open.includes(value)) return ok(value);
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      const plain = plainValue(item, [...open, value]);
      if (!plain.ok) return plain;
      items.push(plain.value);
    }
    return ok(items);
  }
  if (!isRecord(value)) return ok(value);
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const plain = plainValue(value[key], [...open, value]);
    if (!plain.ok) return plain;
    setField(copy, key, plain.value);
  }
  return ok(copy);
}

/**
 * TREE.LAZY, TREE.PARENT, TREE.SIBLING and TREE.ERROR: a node of an open tree gives its thing, and the root of a new
 * tree gives its JSON. A step on the thing reads an attribute, and a failed attribute throws its own error.
 */
const treeDefinition: EvalFn = ({ parts, context, kind, place }) => {
  const outer = refNodeOf(context.self);
  const nested = outer !== undefined && outer.tree.open;
  const node: RefNode = { tree: nested ? outer.tree : { open: true }, kind, place, parts, ctx: context, values: new Map(), pending: new Set() };
  const self: HostThing & { readonly type: string } = {
    [THING]: true,
    type: kind,
    label: `node ${kind}`,
    deref: (key): Thing | undefined => {
      if (key === "parent") return context.self;
      if (key === "type") return kind;
      const result = attributeOf(node, self, String(key));
      if (result === undefined || result.ok) return result?.ok === true ? result.value : undefined;
      throw new Failure(result.error);
    },
    has: (key) => key === "parent" || key === "type" || parts.some((part) => part.key === String(key)),
    toJson: () => {
      const result = jsonOfNode(node, self, []);
      if (result.ok) return result.value;
      throw new Failure(result.error);
    },
  };
  refNodes.set(self, node);
  if (nested) return ok(self);
  try {
    return jsonOfNode(node, self, []);
  } finally {
    node.tree.open = false;
  }
};

/**
 * The definitions of the reference for the evaluators of the standard machine that need their own reading. The
 * reference uses them for the standard evaluators, also without the option `definitions`. It holds `tree.node`.
 */
export const STD_DEFINITIONS: Definitions = { evaluators: { "tree.node": treeDefinition } };

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
