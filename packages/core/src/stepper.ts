import { type Envelope, type Json, type Key, type TypeRef, docEquals, field, isEnvelope, isRecord, typeName } from "./doc.ts";
import { type Cap, type Context, type Resolution, type ResolveOptions, type Thing, isHostThing, worldThing } from "./deref.ts";
import { type EvalError, type Result, Failure, effectFailed, fail, ok, placed, thrown } from "./errors.ts";
import { type Effect, type EvalInput, type Machine, type Part, type Perform, WORK_LIMIT, intersectCaps, makeContext, permits, placeText, workFailure } from "./evaluate.ts";
import { type FormulaProfile, type OpFn, Held, STD_EXT } from "./formula.ts";
import type { World } from "./ladder.ts";
import { pathMatches } from "./parts.ts";
import { type Definitions, STD_DEFINITIONS } from "./reference.ts";
import { STD_EVALUATORS } from "./stdlib.ts";
import { type CapsRule, type Kind, type Shape, type WorldEntry, isAlias, isKind, isNamespace } from "./world.ts";

/**
 * The third tier (K95, D158): a stepper from the functional correspondence. It is a CPS transformation and a
 * defunctionalization of the reference for the kernel and the formula kit. The continuation is a stack of frames, and
 * each frame is data. One step is a function from one configuration to the next.
 *
 * The stepper reads the judgments 1 to 3 of `docs/SEMANTICS.md` itself: the lookup, the ladder, the split and the steps
 * of a path. It does not use `partsOf`, `lookupKind`, `answerOf` or `resolve`. Thus `agree` also tests the code that
 * the plan and the reference share.
 */

/** One part of a value: the rule SPLIT-TERM gives it. */
interface Slot {
  readonly path: readonly Key[];
  readonly key: string;
  readonly item: Json;
  readonly of?: string;
  readonly address?: true;
}

/** What the frames of one document share. */
interface Site {
  /** The name of the evaluator. An exception of a rule of the profile names it. */
  readonly name: string;
  readonly depth: number;
  readonly ctx: Context;
  readonly rules?: readonly CapsRule[];
}

/** The part of a frame that runs at this time. The path of each frame on the stack gives the place (H-PLACE). */
interface DocFrame {
  at: readonly Key[];
  readonly site: Site;
}

/** The work after the parts of a document: the name of a construct. */
type After = "list" | "record" | "op" | "ref" | "step" | "args";

interface ValuesFrame extends DocFrame {
  readonly f: "values";
  readonly then: After;
  readonly slots: readonly Slot[];
  readonly strict: boolean;
  next: number;
  values: unknown[];
  errors: EvalError[];
  /** The indexes of the fields that the rule `omit` of the profile leaves out. */
  skipped: number[];
  readonly doc?: Envelope;
  readonly name?: string;
  readonly target?: unknown;
  readonly address?: boolean;
}

interface LetFrame extends DocFrame {
  readonly f: "let";
  readonly slots: readonly Slot[];
  readonly body: Slot;
  next: number;
  names: Record<string, unknown>;
}

interface CallFrame extends DocFrame {
  readonly f: "call";
  readonly args: readonly Slot[];
}

interface IfFrame extends DocFrame {
  readonly f: "if";
  readonly yes: Slot;
  readonly no?: Slot;
}

interface LogicFrame extends DocFrame {
  readonly f: "logic";
  readonly stop: boolean;
  readonly what: string;
  readonly slots: readonly Slot[];
  next: number;
}

/**
 * One frame of the continuation: the rest of one document, for example "the items of a list after the item 2".
 *
 * - `tail`: the last part of a document. Only the place reads it.
 * - `return`: the end of one application of a function.
 * - `base`: the end of a nested stepper of a host handle.
 */
export type Frame =
  | ValuesFrame
  | LetFrame
  | CallFrame
  | IfFrame
  | LogicFrame
  | { readonly f: "tail"; at: readonly Key[] }
  | { readonly f: "return"; readonly place: readonly Key[] }
  | { readonly f: "base"; readonly place: readonly Key[] };

interface Shared {
  readonly stack: readonly Frame[];
  /** The count of the active applications of functions (FORMULA.CALL-DEPTH). */
  readonly applying: number;
  /** `true` after a closure goes in a value. Only then does a value need a change for the host. */
  readonly marked: boolean;
  /** The work of the evaluation after the last call of `stepperNext` (WORK.LIMIT). A configuration without it has done no work. */
  readonly work?: number;
  /** The number of earlier effects at each place, after the last call of `stepperNext` (RUN.ADDRESS). */
  readonly counts?: Readonly<Record<string, number>>;
  /** The number of effects of the evaluation, after the last call of `stepperNext`. */
  readonly effected?: number;
}

/**
 * One configuration of the stepper. A closure and a held error in it are values that only the stepper makes
 * (STEPPER.FORGE). Thus a configuration goes through JSON with `encodeConfiguration` and `decodeConfiguration`
 * (STEPPER.DATA).
 *
 * - `evaluate`: the document `value` starts, with a new evaluation at its depth.
 * - `resume`: a document gave `result`, and the top frame takes it.
 * - `done`: the evaluation ends with `result`.
 */
export type Configuration =
  | (Shared & {
      readonly mode: "evaluate";
      readonly value: unknown;
      readonly declared?: string | undefined;
      readonly depth: number;
      readonly address: boolean;
      readonly ctx: Context;
    })
  | (Shared & { readonly mode: "resume"; readonly result: Result })
  | (Shared & { readonly mode: "done"; readonly result: Result });

type Evaluating = Extract<Configuration, { readonly mode: "evaluate" }>;
type Resuming = Extract<Configuration, { readonly mode: "resume" }>;

/** The options of `stepper`. */
export interface StepperOptions {
  /** The type of a bare root value. */
  readonly declaredType?: string;
  /** The verb that goes up the ladder at each document. The default is `eval`. */
  readonly verb?: string;
  /** The operations and the rules of the formula kit of the machine. */
  readonly profile?: FormulaProfile;
  /** The definitional code of other compiled evaluators, as for `reference`. */
  readonly definitions?: Definitions;
  /** A list that gets each effect of a host evaluator, in its order. */
  readonly effects?: Effect[];
  /** The mock of the host (RUN.MOCK). It answers each effect at once. Without it, an effect gives its payload. */
  readonly perform?: Perform;
}

/** The code that a configuration does not hold: the machine and the profile. */
interface Program {
  readonly machine: Machine;
  readonly profile: FormulaProfile;
  readonly definitions: Definitions;
  readonly verb: string;
  readonly maxDepth: number;
  readonly hosts: WeakMap<object, unknown>;
  readonly effects: Effect[];
  readonly perform: Perform | undefined;
  /** The number of earlier effects at each place, by the text of the place (RUN.ADDRESS). */
  readonly counts: Map<string, number>;
  /** The number of effects of the evaluation before the list `effects`. */
  before: number;
  /** The count of the applications at the last call of host code. */
  applying: number;
  /** The most work of one evaluation (WORK.LIMIT). */
  readonly maxWork: number;
  /** The work of the evaluation: one point for each application of a closure (WORK.LIMIT). */
  work: number;
  /** `true` after the end of the evaluation. Then each application from the host starts a new count (WORK.AFTER). */
  ended: boolean;
}

/** The keys of the JSON form of a configuration: a closure, a held error, and a record of data with one of these keys. */
const CLOSURE_MARK = "coeval.closure";
const HELD_MARK = "coeval.held";
const DATA_MARK = "coeval.data";
const MARKS: readonly string[] = /* @__PURE__ */ Object.freeze([CLOSURE_MARK, HELD_MARK, DATA_MARK]);
const CLOSURE: unique symbol = /* @__PURE__ */ Symbol.for("coeval.closure") as never;
const MAX_ALIASES = 32;
const MAX_COLLAPSE = 64;
const ROOTS: readonly string[] = /* @__PURE__ */ Object.freeze(["self", "names", "world", "event", "caps"]);
const NO_KEYS: readonly Key[] = /* @__PURE__ */ Object.freeze([]);

/** A function of the formula kit as data (F-FN). */
interface Closure {
  readonly params: readonly string[];
  readonly body: Slot;
  readonly site: Site;
  readonly place: readonly Key[];
}

function own<T>(table: Readonly<Record<string, T>> | undefined, name: string): T | undefined {
  return table !== undefined && Object.hasOwn(table, name) ? table[name] : undefined;
}

function setField(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * A closure of the stepper as a value. Only the construct `fn` and `decodeConfiguration` make one. A document gives only
 * data, thus it cannot make a closure with a context of its choice (STEPPER.FORGE, D199).
 */
class StepClosure {
  readonly closure: Closure;

  constructor(closure: Closure) {
    this.closure = closure;
  }
}

function closureOf(value: unknown): Closure | undefined {
  return value instanceof StepClosure ? value.closure : undefined;
}

/** A held error is a `Held`, as in the plan. A record of data with the old key is data (STEPPER.FORGE, D199). */
function heldOf(value: unknown): EvalError | undefined {
  return value instanceof Held ? value.error : undefined;
}

/** The judgment 2: K-START and K-COMPUTED. */
function keysOf(type: TypeRef): readonly Key[] | undefined {
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type as readonly Key[];
  const steps = (type as { readonly value: readonly unknown[] }).value.slice(1);
  return steps.every(isKey) ? (steps as readonly Key[]) : undefined;
}

/** A key is a text, or a whole number from 0. */
function isKey(step: unknown): step is Key {
  return typeof step === "string" || (typeof step === "number" && Number.isInteger(step) && step >= 0);
}

/** The judgment 2: the lookup of a kind, with the rules K-FALLBACK to K-NOT-A-KIND. */
function lookup(world: World, type: TypeRef): { readonly kind: Kind; readonly path: readonly Key[] } | undefined {
  const start = keysOf(type);
  if (start === undefined) return undefined;
  let keys = start;
  let aliases = 0;
  for (;;) {
    let entries: Readonly<Record<string, WorldEntry>> = world.kinds;
    let fallback = world.fallback;
    let followed = false;
    if (keys.length === 0) return undefined;
    for (let index = 0; index < keys.length; index += 1) {
      const key = String(keys[index]);
      const entry = own(entries, key);
      if (entry === undefined) return fallback === undefined ? undefined : { kind: fallback, path: keys };
      if (isAlias(entry)) {
        aliases += 1;
        const target = entry.value.slice(1);
        if (aliases > MAX_ALIASES || entry.value[0] !== "world" || !target.every(isKey)) return undefined;
        keys = [...(target as readonly Key[]), ...keys.slice(index + 1)];
        followed = true;
        break;
      }
      const last = index === keys.length - 1;
      if (last) return isKind(entry) ? { kind: entry, path: keys } : undefined;
      if (!isNamespace(entry)) return undefined;
      entries = entry.kinds;
      fallback = entry.fallback;
    }
    if (!followed) return undefined;
  }
}

/** The result of the ladder for each rung: a name, `null` for L-STOP, or `undefined` for L-NONE. */
function ladder(world: World, entries: unknown, kind: Kind | undefined, known: boolean, verb: string, has: (name: string) => boolean): string | null | undefined {
  const mine = isRecord(entries) ? own(entries as Readonly<Record<string, string>>, verb) : undefined;
  if (mine !== undefined && has(mine)) return mine;
  if (!known) return null;
  const named = own(kind?.verbs, verb);
  if (named !== undefined && has(named)) return named;
  const fallback = own(world.defaults, verb);
  return fallback !== undefined && has(fallback) ? fallback : undefined;
}

class Bad {
  readonly reason: string;
  readonly at: readonly Key[];
  constructor(reason: string, at: readonly Key[]) {
    this.reason = reason;
    this.at = at;
  }
}

/** The result of the walk for a part: the field is absent from the data (SPLIT-FILL). */
const PART: unique symbol = /* @__PURE__ */ Symbol("part") as never;

function isDataShape(shape: Shape): boolean {
  return shape.shape === "none" || shape.shape === "text" || shape.shape === "number" || shape.shape === "one";
}

/** SPLIT-DATA: the reason why a value is not a member of a data shape. */
function notMember(shape: Extract<Shape, { readonly shape: "text" | "number" | "one" }>, value: Json): string | undefined {
  if (shape.shape === "text") return typeof value === "string" ? undefined : "The value must be a text.";
  if (shape.shape === "one") return shape.values.some((item) => docEquals(item, value)) ? undefined : `The value must be one of ${JSON.stringify(shape.values)}.`;
  if (typeof value !== "number") return "The value must be a number.";
  if (shape.whole === true && !Number.isInteger(value)) return "The value must be a whole number.";
  if (shape.min !== undefined && !(value >= shape.min)) return `The value must be ${String(shape.min)} or more.`;
  if (shape.max !== undefined && !(value <= shape.max)) return `The value must be ${String(shape.max)} or less.`;
  return undefined;
}

function checkKinds(kinds: readonly (readonly Key[])[], item: Json, of: string | undefined, path: readonly Key[]): void {
  const type = isEnvelope(item) ? keysOf(item.type) : of === undefined ? undefined : [of];
  const fits = type !== undefined && kinds.some((kind) => kind.length <= type.length && kind.every((key, index) => String(key) === String(type[index])));
  if (fits) return;
  const what = isEnvelope(item) ? `The kind ${typeName(item.type)} is not permitted here.` : "A value without an envelope is not permitted here.";
  throw new Bad(`${what} The permitted kinds are ${kinds.map((kind) => kind.join(".")).join(", ")}.`, path);
}

/** The judgment 1: the rules SPLIT-NONE to SPLIT-DEEP. The result holds the parts and the data of SPLIT-FILL. */
function split(shape: Shape | undefined, value: Json): { readonly slots: readonly Slot[]; readonly data: Json } | Bad {
  const slots: Slot[] = [];
  const slot = (item: Json, path: readonly Key[], of: string | undefined, address: boolean): typeof PART => {
    slots.push({ path, key: path.join("."), item, ...(of === undefined ? {} : { of }), ...(address ? { address: true as const } : {}) });
    return PART;
  };
  const term = (of: string | undefined): Shape => (of === undefined ? { shape: "term" } : { shape: "term", of });
  const listData = (items: readonly (Json | typeof PART)[]): Json => (items.every((item) => item === PART) ? null : items.map((item) => (item === PART ? null : item)));
  const deep = (item: Json, path: readonly Key[], of: string | undefined): Json | typeof PART => {
    if (isEnvelope(item)) return slot(item, path, of, false);
    const before = slots.length;
    if (Array.isArray(item)) {
      const items = (item as readonly Json[]).map((child, index) => deep(child, [...path, index], of));
      return slots.length === before ? item : listData(items);
    }
    if (!isRecord(item)) return item;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(item)) {
      const kept = deep(item[key] as Json, [...path, key], of);
      if (kept !== PART) setField(out, key, kept);
    }
    return slots.length === before ? item : (out as Json);
  };
  const walk = (spec: Shape | undefined, item: Json, path: readonly Key[]): Json | typeof PART => {
    if (spec === undefined || spec.shape === "none") return item;
    if (spec.shape === "text" || spec.shape === "number" || spec.shape === "one") {
      const reason = notMember(spec, item);
      if (reason !== undefined) throw new Bad(reason, path);
      return item;
    }
    if (spec.shape === "term") {
      if (spec.kinds !== undefined) checkKinds(spec.kinds, item, spec.of, path);
      return slot(item, path, spec.of, spec.address === true);
    }
    if (spec.shape === "deep") return deep(item, path, spec.of);
    if (spec.shape === "list") {
      if (!Array.isArray(item)) throw new Bad("The value must be a list.", path);
      const list = item as readonly Json[];
      if (spec.distinct === true) {
        const twice = list.findIndex((child, index) => list.slice(0, index).some((before) => docEquals(before, child)));
        if (twice !== -1) throw new Bad("The items of the list must be different.", [...path, twice]);
      }
      const each = spec.item ?? term(spec.of);
      const items = list.map((child, index) => walk(each, child, [...path, index]));
      return isDataShape(each) ? item : listData(items);
    }
    if (!isRecord(item)) throw new Bad("The value must be a record.", path);
    const out: Record<string, unknown> = {};
    const keep = (key: string, kept: Json | typeof PART): void => {
      if (kept !== PART) setField(out, key, kept);
    };
    if (spec.shape === "map") {
      for (const key of Object.keys(item)) keep(key, walk(spec.item ?? term(spec.of), item[key] as Json, [...path, key]));
      return out as Json;
    }
    for (const name of spec.required ?? []) {
      if (!Object.hasOwn(item, name)) throw new Bad(`The field ${name} is missing.`, path);
    }
    for (const key of Object.keys(item)) {
      const named = Array.isArray(spec.fields) ? (spec.fields as readonly string[]).includes(key) : Object.hasOwn(spec.fields, key);
      if (spec.closed === true && !named) throw new Bad(`The field ${key} is not a field of this kind.`, [...path, key]);
      const fieldShape = !named ? spec.rest : Array.isArray(spec.fields) ? term(spec.of) : (spec.fields as Readonly<Record<string, Shape>>)[key];
      keep(key, walk(fieldShape, item[key] as Json, [...path, key]));
    }
    return out as Json;
  };
  try {
    const data = walk(shape, value, []);
    return { slots, data: data === PART ? null : data };
  } catch (error) {
    if (error instanceof Bad) return error;
    throw error;
  }
}

function copyOf(container: unknown): Record<string | number, unknown> {
  if (Array.isArray(container)) return [...container] as never;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(container as object)) setField(out, key, (container as Record<string, unknown>)[key]);
  return out;
}

/** SPLIT-FILL: the value with the item `i` at the path of the slot `i`. The containers on the way are new. */
function fillIn(value: unknown, slots: readonly Slot[], items: readonly unknown[]): unknown {
  const first = slots[0];
  if (first === undefined) return value;
  if (first.path.length === 0) return items[0];
  const root = copyOf(value);
  const fresh = new Set<unknown>([root]);
  slots.forEach((part, index) => {
    let here = root;
    for (let step = 0; step < part.path.length - 1; step += 1) {
      const key = part.path[step] as Key;
      let next = here[key];
      if (!fresh.has(next)) {
        next = copyOf(next);
        fresh.add(next);
        setField(here, String(key), next);
      }
      here = next as Record<string | number, unknown>;
    }
    setField(here, String(part.path[part.path.length - 1]), items[index]);
  });
  return root;
}

/** H-CONTEXT: the capabilities of a rule list for one part. */
function capsOf(rules: readonly CapsRule[] | undefined, path: readonly Key[], caps: readonly Cap[]): readonly Cap[] {
  let out = caps;
  for (const rule of rules ?? []) {
    if (rule.in !== undefined && !rule.in.some((pattern) => pathMatches(path, pattern))) continue;
    if (rule.rule === "mask") return [];
    if (rule.rule === "only") out = intersectCaps(out, rule.caps);
  }
  return out;
}

/** H-CONTEXT: the context of a part. */
function contextOf(site: Site, slot: Slot, given: Context | undefined): Context {
  const parent = site.ctx;
  const narrow = (context: Context): Context => (context.caps.every((cap) => permits(parent.caps, cap)) ? context : { ...context, caps: intersectCaps(parent.caps, context.caps) });
  const base = given === undefined || given === parent ? parent : narrow(given);
  const caps = capsOf(site.rules, slot.path, base.caps);
  return caps === base.caps ? base : { ...base, caps };
}

/** H-PLACE: the place of the document on top of the stack. */
function placeOf(stack: readonly Frame[]): readonly Key[] {
  const pieces: (readonly Key[])[] = [];
  let base = NO_KEYS;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const frame = stack[index] as Frame;
    if (frame.f === "base" || frame.f === "return") {
      base = frame.place;
      break;
    }
    pieces.push(frame.at);
  }
  const out = [...base];
  for (let index = pieces.length - 1; index >= 0; index -= 1) out.push(...(pieces[index] as readonly Key[]));
  return out;
}

function back(c: Configuration, result: Result): Resuming {
  const placedResult = result.ok || result.error.place !== undefined ? result : placed(result, placeOf(c.stack));
  return { mode: "resume", result: placedResult, stack: c.stack, applying: c.applying, marked: c.marked };
}

function pushed(c: Configuration, frame: Frame): void {
  (c.stack as Frame[]).push(frame);
}

function popped(c: Configuration): void {
  (c.stack as Frame[]).pop();
}

/** H-SEAL: the evaluation of a part, with the frame that waits for it on top of the stack. */
function enter(c: Configuration, frame: { at: readonly Key[] }, site: Site, slot: Slot, given?: Context): Evaluating {
  frame.at = slot.path;
  return {
    mode: "evaluate",
    value: slot.item,
    declared: slot.of,
    depth: site.depth + 1,
    address: slot.address === true,
    ctx: contextOf(site, slot, given),
    stack: c.stack,
    applying: c.applying,
    marked: c.marked,
  };
}

function partNamed(slots: readonly Slot[], key: string): Slot | undefined {
  return slots.find((slot) => slot.path.length === 1 && slot.path[0] === key);
}

function partsUnder(slots: readonly Slot[], key: string): readonly Slot[] {
  return slots.filter((slot) => slot.path.length === 2 && slot.path[0] === key);
}

function truthOf(p: Program, c: Configuration, value: unknown): boolean | undefined {
  const given = forHost(p, c, value);
  return p.profile.truthy === undefined ? (typeof given === "boolean" ? given : undefined) : p.profile.truthy(given);
}

function opOf(p: Program, name: string): OpFn | undefined {
  const { ops } = p.profile;
  return typeof ops === "function" ? ops(name) : own(ops, name);
}

function startValues(p: Program, c: Configuration, site: Site, then: After, slots: readonly Slot[], strict: boolean, more: Partial<ValuesFrame> = {}): Configuration {
  const frame: ValuesFrame = { f: "values", at: NO_KEYS, site, then, slots, strict, next: 1, values: [], errors: [], skipped: [], ...more };
  const first = slots[0];
  if (first === undefined) return finish(p, c, frame);
  pushed(c, frame);
  return enter(c, frame, site, first);
}

/** F-REF, after the values of the steps. */
function finishRef(p: Program, c: Configuration, doc: Envelope, steps: readonly unknown[], site: Site, address: boolean): Configuration {
  const path = doc.value as readonly Json[];
  const head = path[0] === "names" && typeof path[1] === "string" ? path[1] : undefined;
  const bound = head === undefined ? undefined : heldOf(own(site.ctx.names, head));
  if (bound !== undefined) return back(c, { ok: false, error: bound });
  const found = walkPath(p, site.ctx, steps);
  if (!found.ok) return back(c, fail(found.code as never, found.reason));
  if (address) return back(c, ok(found.thing));
  const reached = isHostThing(found.thing) ? found.thing.toJson() : found.thing;
  const held = heldOf(reached);
  if (held !== undefined) return back(c, { ok: false, error: held });
  if (p.profile.missing?.(forHost(p, c, reached)) === true) return back(c, fail("#N/A", "The path reaches no value."));
  return back(c, ok(reached));
}

/** The work of a construct after the values of its parts. */
function finish(p: Program, c: Configuration, frame: ValuesFrame): Configuration {
  const { values, slots } = frame;
  switch (frame.then) {
    case "list":
      return back(c, ok(values));
    case "record": {
      const out: Record<string, unknown> = {};
      slots.forEach((slot, index) => {
        if (!frame.skipped.includes(index)) setField(out, String(slot.path[0]), values[index]);
      });
      return back(c, ok(out));
    }
    case "op": {
      const name = frame.name as string;
      try {
        const out = (opOf(p, name) as (...args: unknown[]) => unknown)(...(forHost(p, c, values) as readonly unknown[]));
        return back(c, p.profile.check?.(out, name) ?? ok(out));
      } catch (error) {
        return back(c, thrown(error, `the operation ${name}`));
      }
    }
    case "step": {
      const doc = frame.doc as Envelope;
      return back(c, ok(slots.length === 0 ? doc : { ...doc, value: fillIn(doc.value, slots, values) as Json }));
    }
    case "ref": {
      const doc = frame.doc as Envelope;
      return finishRef(p, c, doc, fillIn(doc.value, slots, values) as readonly unknown[], frame.site, frame.address === true);
    }
    case "args":
      return apply(p, c, frame.target, values);
  }
}

/** F-CALL and F-FN: an application of a function. */
function apply(p: Program, c: Configuration, target: unknown, args: readonly unknown[]): Configuration {
  const closure = closureOf(target);
  if (closure === undefined) {
    try {
      return back(c, ok((target as (...items: unknown[]) => unknown)(...(forHost(p, c, args) as readonly unknown[]))));
    } catch (error) {
      return back(c, thrown(error, "the function of call"));
    }
  }
  const limit = Math.ceil(p.maxDepth / 4);
  if (c.applying >= limit) return back(c, fail("#DEPTH!", `The applications of functions nest deeper than ${limit} levels.`));
  // WORK.LIMIT: each application counts one point, after the clock of its depth.
  p.work += 1;
  if (p.work > p.maxWork) return back(c, { ok: false, error: workFailure(p.maxWork) });
  const frame: Frame = { f: "return", place: closure.place.concat(closure.body.path) };
  pushed(c, frame);
  const start = enter(c, { at: NO_KEYS }, closure.site, closure.body, scopeOf(closure, args));
  return { ...start, applying: c.applying + 1 };
}

function scopeOf(closure: Closure, args: readonly unknown[]): Context {
  const { ctx } = closure.site;
  const scope: Record<string, unknown> = {};
  for (const key of Object.keys(ctx.names)) setField(scope, key, ctx.names[key]);
  closure.params.forEach((name, index) => setField(scope, name, args[index]));
  return { ...ctx, names: scope };
}

/** This function makes the host function of a closure. A host calls it, thus it runs a nested stepper. */
function hostClosure(p: Program, value: object, closure: Closure): unknown {
  const known = p.hosts.get(value);
  if (known !== undefined) return known;
  const fn = (...args: readonly unknown[]): unknown => {
    const limit = Math.ceil(p.maxDepth / 4);
    if (p.applying >= limit) throw new Failure(fail("#DEPTH!", `The applications of functions nest deeper than ${limit} levels.`).error);
    // WORK.AFTER: after the end of the evaluation, each application from the host starts a new count.
    p.work = (p.ended && p.applying === 0 ? 0 : p.work) + 1;
    if (p.work > p.maxWork) throw new Failure(workFailure(p.maxWork));
    // Host code in the nested stepper writes the count of the applications, thus the call puts back the count of its start.
    const before = p.applying;
    p.applying += 1;
    try {
      const place = closure.place.concat(closure.body.path);
      const c: Configuration = { mode: "resume", result: ok(null), stack: [{ f: "base", place }], applying: p.applying, marked: true };
      const end = drive(p, enter(c, { at: NO_KEYS }, closure.site, closure.body, scopeOf(closure, args)));
      if (!end.result.ok) throw new Failure(end.result.error);
      return forHost(p, end, end.result.value);
    } finally {
      p.applying = before;
    }
  };
  Object.defineProperty(fn, CLOSURE, { value: { params: closure.params } });
  p.hosts.set(value, fn);
  return fn;
}

/** This function gives a value to host code: a closure is a function. A held error is a `Held` in the stepper too. */
function forHost(p: Program, c: Configuration, value: unknown): unknown {
  p.applying = c.applying;
  return c.marked ? hostValue(p, value) : value;
}

function hostValue(p: Program, value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = (value as readonly unknown[]).map((item) => hostValue(p, item));
    return items.some((item, index) => item !== value[index]) ? items : value;
  }
  const closure = closureOf(value);
  if (closure !== undefined) return hostClosure(p, value as StepClosure, closure);
  if (!isRecord(value)) return value;
  let out: Record<string, unknown> | undefined;
  for (const key of Object.keys(value)) {
    const item = hostValue(p, value[key]);
    if (item !== value[key]) {
      out ??= copyOf(value);
      setField(out, key, item);
    }
  }
  return out ?? value;
}

function hostContext(p: Program, c: Configuration, ctx: Context): Context {
  const names = forHost(p, c, ctx.names) as Context["names"];
  return names === ctx.names ? ctx : { ...ctx, names };
}

/** The judgment 3: the steps of a path, with R-NO-ROOT to C-DONE. A failure holds a code and a reason. */
function walkPath(p: Program, ctx: Context, path: readonly unknown[]): Resolution {
  const { machine } = p;
  const adopt = machine.adopt ?? ((value: unknown): Thing => value);
  const failed = (code: string, reason: string): Resolution => ({ ok: false, code, reason, hops: [] }) as never;
  const open: object[] = [];
  let collapses = 0;
  const collapse = (thing: Thing): Resolution => {
    let here = thing;
    if (machine.plain === true) return { ok: true, thing: here, hops: [] };
    while (isReference(here)) {
      if (open.includes(here as object)) return failed("#CYCLE!", "The references form a cycle.");
      collapses += 1;
      if (collapses > MAX_COLLAPSE) return failed("#CYCLE!", "The path follows more than 64 references. One resolution follows at most 64.");
      open.push(here as object);
      const inner = walk((here as Envelope & { readonly value: readonly unknown[] }).value);
      open.pop();
      if (!inner.ok) return inner;
      here = adopt(inner.thing);
    }
    return { ok: true, thing: here, hops: [] };
  };
  const walk = (steps: readonly unknown[]): Resolution => {
    const root = steps[0];
    if (typeof root !== "string" || !ROOTS.includes(root)) return failed("#REF!", `A path starts with a root: ${ROOTS.join(", ")}.`);
    if (machine.roots !== undefined && !(machine.roots as readonly string[]).includes(root)) return failed("#REF!", `The root ${root} is not open here. The open roots are ${machine.roots.join(", ")}.`);
    const first = collapse(adopt(ctx[root as keyof Context]));
    if (!first.ok) return first;
    let here = first.thing;
    for (let index = 1; index < steps.length; index += 1) {
      const step = steps[index];
      const rest = steps.slice(index);
      if (isHostThing(here) && here.resolve !== undefined && rest.every(isKey)) {
        const reached = here.resolve(rest);
        if (reached === undefined) return failed("#N/A", `The path ${rest.join(".")} reaches nothing.`);
        return collapse(adopt(reached.thing));
      }
      const hop = isKey(step) ? keyStep(p, here, step) : undefined;
      if (isKey(step)) {
        if (hop === undefined) {
          if (root === "names" && index === 1) return failed("#NAME?", `The context has no name ${String(step)}.`);
          return failed("#N/A", `The step ${String(step)} reaches nothing.`);
        }
        here = adopt(hop.thing);
      } else {
        const walker = walkerFor(p, step);
        if (walker === undefined) return failed("#STEP?", "A step is a key, or a document of a kind with the verb step.");
        const deref = (thing: Thing, key: Key): Thing | undefined => {
          const reached = keyStep(p, thing, key);
          return reached === undefined ? undefined : adopt(reached.thing);
        };
        const has = (thing: Thing, key: Key): boolean => keyStep(p, thing, key) !== undefined;
        const result = walker({ data: (step as Envelope).value, here, context: ctx, deref, has });
        if (!result.ok) return failed(result.code ?? "#N/A", result.reason);
        here = adopt(result.thing);
      }
      const next = collapse(here);
      if (!next.ok) return next;
      here = next.thing;
    }
    return { ok: true, thing: here, hops: [] };
  };
  return path.length === 0 ? failed("#REF!", "A path has at least one step: its root.") : walk(path);
}

function isReference(thing: unknown): boolean {
  if (!isEnvelope(thing) || !Array.isArray(thing.value)) return false;
  const keys = keysOf(thing.type);
  return keys !== undefined && keys.length === 1 && keys[0] === "ref";
}

/** R-WALKER: the code of a step document. */
function walkerFor(p: Program, step: unknown): NonNullable<Machine["walkers"]>[string] | undefined {
  const { walkers, world } = p.machine;
  if (walkers === undefined || !isEnvelope(step)) return undefined;
  const found = lookup(world, step.type);
  const name = ladder(world, field(step as never, "own"), found?.kind, found !== undefined, "step", (item) => own(walkers, item) !== undefined);
  return typeof name === "string" ? own(walkers, name) : undefined;
}

/** FIELD: the rule of a step in a value. */
function fieldOf(value: unknown, key: Key): { readonly thing: Thing } | undefined {
  if (Array.isArray(value)) {
    if (key === "length") return { thing: value.length };
    const index = typeof key === "number" ? key : /^\d+$/.test(key) ? Number(key) : -1;
    return index >= 0 && index < value.length ? { thing: value[index] as Thing } : undefined;
  }
  if (typeof value !== "object" || value === null || !Object.hasOwn(value, String(key))) return undefined;
  return { thing: (value as Readonly<Record<string, unknown>>)[String(key)] };
}

/** The rules S-HOST to S-FIELD: a step with a key. The result is `undefined` for `miss`. */
function keyStep(p: Program, thing: Thing, key: Key): { readonly thing: Thing } | undefined {
  const { machine } = p;
  if (isHostThing(thing)) {
    const reached = thing.deref(key);
    return reached !== undefined || thing.has?.(key) === true ? { thing: reached } : undefined;
  }
  if (machine.plain === true || !isEnvelope(thing)) return fieldOf(thing, key);
  const { derefs, world } = machine;
  const found = lookup(world, thing.type);
  const name = derefs === undefined ? undefined : ladder(world, field(thing as never, "own"), found?.kind, found !== undefined, "deref", (item) => own(derefs, item) !== undefined);
  const code = typeof name === "string" ? own(derefs, name) : undefined;
  if (code === undefined) return fieldOf(thing.value, key);
  const reached = code(thing as Envelope, key);
  return reached !== undefined || code.has?.(thing as Envelope, key) === true ? { thing: reached } : undefined;
}

/** A construct of the formula kit, with its compiled evaluator in the machine. */
const CONSTRUCTS: Readonly<Record<string, true>> = {
  "formula.lit": true,
  "formula.ref": true,
  "formula.step": true,
  "formula.record": true,
  "formula.list": true,
  "formula.let": true,
  "formula.fn": true,
  "formula.call": true,
  "formula.if": true,
  "formula.and": true,
  "formula.or": true,
  "formula.op": true,
  "formula.ext": true,
};

/** The rules F-LIT to F-EXT: the start of a construct. */
function construct(p: Program, c: Evaluating, name: string, doc: Envelope, keys: readonly Key[], slots: readonly Slot[], site: Site): Configuration {
  const { profile, machine } = p;
  switch (name) {
    case "formula.lit":
      return back(c, ok(doc.value));
    case "formula.ref": {
      const path = doc.value;
      if (!Array.isArray(path) || path.length === 0) return back(c, fail("#VALUE!", 'The value of ref is a path: a list that starts with a root, for example ["names", "a"].'));
      if (slots.length === 0) return finishRef(p, c, doc, path as readonly unknown[], site, c.address);
      return startValues(p, c, site, "ref", slots, true, { doc, address: c.address });
    }
    case "formula.step":
      return startValues(p, c, site, "step", slots, true, { doc });
    case "formula.record":
      return startValues(p, c, site, "record", slots, false);
    case "formula.list":
      return startValues(p, c, site, "list", slots, false);
    case "formula.let": {
      const bindings = partsUnder(slots, "bind");
      const body = partNamed(slots, "body") as Slot;
      const names: Record<string, unknown> = {};
      for (const key of Object.keys(site.ctx.names)) setField(names, key, site.ctx.names[key]);
      const first = bindings[0];
      if (first === undefined) {
        const tail: Frame = { f: "tail", at: NO_KEYS };
        pushed(c, tail);
        return enter(c, tail, site, body, { ...site.ctx, names });
      }
      const frame: LetFrame = { f: "let", at: NO_KEYS, site, slots: bindings, body, next: 1, names };
      pushed(c, frame);
      return enter(c, frame, site, first);
    }
    case "formula.fn": {
      const params = isRecord(doc.value) ? doc.value["params"] : undefined;
      if (!Array.isArray(params) || !params.every((item) => typeof item === "string") || new Set(params).size !== params.length) {
        return back(c, fail("#VALUE!", "The params of fn are a list of different texts."));
      }
      const closure: Closure = { params: params as readonly string[], body: partNamed(slots, "body") as Slot, site, place: placeOf(c.stack) };
      return back({ ...c, marked: true }, ok(new StepClosure(closure)));
    }
    case "formula.call": {
      const frame: CallFrame = { f: "call", at: NO_KEYS, site, args: partsUnder(slots, "args") };
      pushed(c, frame);
      return enter(c, frame, site, partNamed(slots, "fn") as Slot);
    }
    case "formula.if": {
      const no = partNamed(slots, "else");
      const frame: IfFrame = { f: "if", at: NO_KEYS, site, yes: partNamed(slots, "then") as Slot, ...(no === undefined ? {} : { no }) };
      pushed(c, frame);
      return enter(c, frame, site, partNamed(slots, "test") as Slot);
    }
    case "formula.and":
    case "formula.or": {
      const stop = name === "formula.or";
      const first = slots[0];
      if (first === undefined) return back(c, ok(!stop));
      const frame: LogicFrame = { f: "logic", at: NO_KEYS, site, stop, what: stop ? "term of or" : "term of and", slots, next: 1 };
      pushed(c, frame);
      return enter(c, frame, site, first);
    }
    case "formula.op": {
      const op = keys.slice(1).join(".");
      const lazy = own(profile.lazy, op);
      if (lazy !== undefined) {
        p.applying = c.applying;
        try {
          return back(c, lazy(slots.map((slot) => () => nested(p, c, site, slot))));
        } catch (error) {
          return back(c, thrown(error, `the operation ${op}`));
        }
      }
      if (opOf(p, op) === undefined) return back(c, fail("#NAME?", `The language has no operation ${op}.`));
      return startValues(p, c, site, "op", slots, false, { name: op });
    }
    default: {
      const ext = keys.slice(1).join(".");
      const handler = own(profile.ext, ext) ?? own(STD_EXT, ext);
      if (handler === undefined) return back(c, fail("#NAME?", `The language has no extension ${ext}.`));
      try {
        return back(c, handler(doc.value, hostContext(p, c, site.ctx), machine.domains));
      } catch (error) {
        return back(c, thrown(error, `the extension ${ext}`));
      }
    }
  }
}

/** H-SEAL for host code: a handle starts a nested stepper, on the stack of the host. */
function nested(p: Program, c: Configuration, site: Site, slot: Slot, given?: Context): Result {
  const stack: Frame[] = [{ f: "base", place: placeOf(c.stack).concat(slot.path) }];
  const start: Configuration = { mode: "resume", result: ok(null), stack, applying: p.applying, marked: c.marked };
  const end = drive(p, enter(start, { at: NO_KEYS }, site, slot, given));
  return end.result.ok ? ok(forHost(p, end, end.result.value)) : end.result;
}

/** RUN.EVAL: an effect of a host evaluator, with RUN.CAP, RUN.ADDRESS and RUN.MOCK. */
function cause(p: Program, ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Result {
  const keys = typeof kind === "string" ? kind.split(".") : kind;
  const text = keys.join(".");
  const { machine, perform, counts, effects } = p;
  const allowed = machine.permits === undefined ? permits(ctx.caps, keys) : machine.permits(ctx.caps, keys, ctx);
  if (!allowed) return fail("#CAP!", `The context has no capability for the effect ${text}.`, { place });
  const at = placeText(place);
  const count = counts.get(at) ?? 0;
  counts.set(at, count + 1);
  const effect: { -readonly [K in keyof Effect]: Effect[K] } = {
    index: p.before + effects.length,
    kind: text,
    path: keys,
    payload,
    node: -1,
    at: 0,
    place,
    context: ctx,
    address: `${at}#${count}`,
  };
  effects.push(effect);
  effect.outcome = answer(perform, effect, place);
  return effect.outcome;
}

function answer(perform: Perform | undefined, effect: Effect, place: readonly Key[]): Result {
  if (perform === undefined) return ok(effect.payload);
  let given: unknown;
  try {
    given = perform(effect);
  } catch (error) {
    return effectFailed(effect.kind, place, error);
  }
  if (!(given instanceof Promise)) return ok(given);
  void given.catch(() => undefined);
  return fail("#CALC!", `The mock gave a promise for the effect ${effect.kind}, and an evaluation does not wait.`, { place });
}

/** E-APPLY for host code: one step of the stepper starts the evaluator. */
function hostEvaluator(p: Program, c: Evaluating, name: string, evaluator: (input: EvalInput) => Result, doc: Envelope, keys: readonly Key[], data: Json, slots: readonly Slot[], site: Site): Configuration {
  const place = placeOf(c.stack);
  const parts: Part[] = slots.map((slot) => {
    const header = isEnvelope(slot.item) ? field(slot.item as never, "name") : undefined;
    return { key: slot.key, path: slot.path, ...(typeof header === "string" ? { name: header } : {}), evaluate: (given?: Context) => nested(p, c, site, slot, given) };
  });
  const fill = (items: readonly unknown[]): unknown => fillIn(doc.value, slots, items);
  p.applying = c.applying;
  const input: EvalInput = {
    kind: typeName(doc.type),
    typePath: keys,
    doc,
    value: fill(parts),
    data,
    parts,
    context: hostContext(p, c, site.ctx),
    place,
    machine: p.machine,
    ...(c.address ? { address: true } : {}),
    resolve: (path: readonly unknown[], _options?: ResolveOptions) => walkPath(p, site.ctx, path),
    effect: (kind, payload) => cause(p, site.ctx, kind, payload, place),
    fill,
  };
  try {
    return back(c, evaluator(input));
  } catch (error) {
    return back(c, thrown(error, `the evaluator ${name}`));
  }
}

/** The judgment 4: the rules E-PART to E-APPLY for one document, in their order. */
function evaluateDoc(p: Program, c: Evaluating): Configuration {
  const { value, declared, depth } = c;
  const { machine, verb } = p;
  const { world } = machine;
  const envelope = isEnvelope(value) ? (value as Envelope) : undefined;
  if (envelope === undefined && declared === undefined) return back(c, fail("#PART?", "The value has no envelope, and its position declares no type."));
  const doc: Envelope = envelope ?? { type: declared as string, value: value as Json };
  const found = lookup(world, doc.type);
  if (depth > p.maxDepth) return back(c, fail("#DEPTH!", `The nesting is deeper than ${p.maxDepth} documents.`));
  const kindText = typeName(doc.type);
  const name = ladder(world, envelope === undefined ? undefined : field(envelope as never, "own"), found?.kind, found !== undefined, verb, () => true);
  if (name === null) return back(c, fail("#KIND?", `The world has no kind ${kindText}.`));
  const code = typeof name === "string" ? (own(machine.runners, name) ?? own(machine.evaluators, name)) : undefined;
  if (name === undefined || code === undefined) return back(c, fail("#NOEVAL", `No rung gives an evaluator for ${kindText}.`));
  const read = split(found?.kind.parts, doc.value);
  if (read instanceof Bad) {
    const where = read.at.length === 0 ? "" : ` (at ${read.at.join(".")})`;
    return back(c, fail("#VALUE!", `${read.reason}${where} The kind is ${kindText}.`));
  }
  if (own(machine.runners, name) !== undefined) return back(c, fail("#NOEVAL", `The stepper has no runner ${name}.`));
  const rules = found?.kind.caps;
  const site: Site = { name, depth, ctx: c.ctx, ...(rules === undefined ? {} : { rules }) };
  const keys = found?.path ?? [];
  if (typeof code === "function") return hostEvaluator(p, c, name, code as never, doc, keys, read.data, read.slots, site);
  if (own(CONSTRUCTS, name) === true) {
    try {
      return construct(p, c, name, doc, keys, read.slots, site);
    } catch (error) {
      return back(c, thrown(error, `the evaluator ${name}`));
    }
  }
  // A standard evaluator gets the definition of the reference, unless the options give another definition (REF.TREE).
  const standard = code === own(STD_EVALUATORS, name) ? own(STD_DEFINITIONS.evaluators, name) : undefined;
  const defined = own(p.definitions.evaluators, name) ?? standard;
  if (defined !== undefined) return hostEvaluator(p, c, name, defined, doc, keys, read.data, read.slots, site);
  return back(c, fail("#NOEVAL", `The stepper has no definition of the compiled evaluator ${name}.`));
}

/** The next part of a frame with a list of parts. */
function nextOf(frame: { next: number; readonly slots: readonly Slot[] }): Slot | undefined {
  const slot = frame.slots[frame.next];
  if (slot !== undefined) frame.next += 1;
  return slot;
}

function resumeValues(p: Program, c: Resuming, frame: ValuesFrame): Configuration {
  const { result } = c;
  const { combine, omit } = p.profile;
  if (result.ok) frame.values.push(result.value);
  else if (frame.then === "record" && omit?.(result.error) === true) {
    frame.skipped.push(frame.values.length);
    frame.values.push(null);
  } else if (frame.strict || combine === undefined) {
    popped(c);
    return c;
  } else frame.errors.push(result.error);
  const slot = nextOf(frame);
  if (slot !== undefined) return enter(c, frame, frame.site, slot);
  popped(c);
  const first = frame.errors[0];
  if (first === undefined) return finish(p, c, frame);
  return back(c, { ok: false, error: frame.errors.length === 1 ? first : (combine as NonNullable<typeof combine>)(frame.errors) });
}

/** The rule `resume(k, r)`: the top frame takes a result. An exception of a rule of the profile ends its document. */
function resume(p: Program, c: Resuming): Configuration {
  const stack = c.stack as Frame[];
  const frame = stack[stack.length - 1];
  if (frame === undefined) return { mode: "done", result: c.result, stack, applying: c.applying, marked: c.marked };
  try {
    return take(p, c, frame);
  } catch (error) {
    if (stack[stack.length - 1] === frame) popped(c);
    return back(c, thrown(error, `the evaluator ${"site" in frame ? frame.site.name : "of the part"}`));
  }
}

function take(p: Program, c: Resuming, frame: Frame): Configuration {
  const stack = c.stack as Frame[];
  const { result } = c;
  switch (frame.f) {
    case "base":
      popped(c);
      return { mode: "done", result, stack, applying: c.applying, marked: c.marked };
    case "tail":
      popped(c);
      return c;
    case "return":
      popped(c);
      return { ...c, applying: c.applying - 1 };
    case "values":
      return resumeValues(p, c, frame);
    case "let": {
      const key = String((frame.slots[frame.next - 1] as Slot).path[1]);
      setField(frame.names, key, result.ok ? result.value : new Held(result.error));
      const slot = nextOf(frame);
      if (slot !== undefined) return enter(c, frame, frame.site, slot);
      const tail: Frame = { f: "tail", at: NO_KEYS };
      stack[stack.length - 1] = tail;
      return enter(c, tail, frame.site, frame.body, { ...frame.site.ctx, names: frame.names });
    }
    case "call": {
      popped(c);
      if (!result.ok) return c;
      if (closureOf(result.value) === undefined && typeof result.value !== "function") return back(c, fail("#VALUE!", "The fn of call must give a function."));
      return startValues(p, c, frame.site, "args", frame.args, true, { target: result.value });
    }
    case "if": {
      if (!result.ok) {
        popped(c);
        return c;
      }
      const truth = truthOf(p, c, result.value);
      if (truth === undefined) {
        popped(c);
        return back(c, fail("#VALUE!", "The test of if must give a truth value."));
      }
      const branch = truth ? frame.yes : frame.no;
      if (branch === undefined) {
        popped(c);
        return back(c, ok(Object.hasOwn(p.profile, "otherwise") ? p.profile.otherwise : null));
      }
      const tail: Frame = { f: "tail", at: NO_KEYS };
      stack[stack.length - 1] = tail;
      return enter(c, tail, frame.site, branch);
    }
    case "logic": {
      if (!result.ok) {
        popped(c);
        return c;
      }
      const truth = truthOf(p, c, result.value);
      const value = p.profile.logic === "value";
      if (truth === undefined) {
        popped(c);
        return back(c, fail("#VALUE!", `The ${frame.what} must give a truth value.`));
      }
      if (truth === frame.stop) {
        popped(c);
        return back(c, value ? result : ok(frame.stop));
      }
      const slot = nextOf(frame);
      if (slot !== undefined) return enter(c, frame, frame.site, slot);
      popped(c);
      return back(c, value ? result : ok(!frame.stop));
    }
  }
}

function advance(p: Program, c: Configuration): Configuration {
  if (c.mode === "evaluate") return evaluateDoc(p, c);
  return c.mode === "resume" ? resume(p, c) : c;
}

function drive(p: Program, start: Configuration): Extract<Configuration, { readonly mode: "done" }> {
  let now = start;
  while (now.mode !== "done") now = advance(p, now);
  return now;
}

function programOf(machine: Machine, options: StepperOptions): Program {
  return {
    machine,
    profile: options.profile ?? {},
    definitions: options.definitions ?? {},
    verb: options.verb ?? "eval",
    maxDepth: machine.maxDepth ?? 1000,
    hosts: new WeakMap(),
    effects: options.effects ?? [],
    perform: options.perform,
    counts: new Map(),
    before: 0,
    applying: 0,
    maxWork: machine.maxWork ?? WORK_LIMIT,
    work: 0,
    ended: false,
  };
}

/**
 * This function gives the first configuration of a document: `evaluate(d, Γ, [], [])`.
 *
 * @param machine - The world, the evaluators and the other code.
 * @param doc - The document.
 * @param context - The names and the capabilities at the root. A context without a world gets the world of the machine.
 * @param options - The type of a bare root value.
 * @returns The configuration.
 */
export function stepperStart(machine: Machine, doc: unknown, context: Context = makeContext(), options: StepperOptions = {}): Configuration {
  const ctx = context.world === null ? { ...context, world: worldThing(machine.world) } : context;
  return { mode: "evaluate", value: doc, declared: options.declaredType, depth: 0, address: false, ctx, stack: [], applying: 0, marked: false };
}

/**
 * This function does one step. It is pure: the configuration stays as it is, and a host can keep it, store it as JSON and
 * step it again (STEPPER.DATA). The result of `done` holds a closure as data. The function `stepper` gives a host
 * function.
 *
 * @param machine - The machine of the configuration.
 * @param configuration - The configuration.
 * @param options - The profile and the verb of the configuration.
 * @returns The next configuration, or the same configuration at `done`.
 */
export function stepperNext(machine: Machine, configuration: Configuration, options: StepperOptions = {}): Configuration {
  const stack = [...configuration.stack];
  const top = stack[stack.length - 1];
  if (top !== undefined) {
    const { f } = top;
    if (f === "values") stack[stack.length - 1] = { ...top, values: [...top.values], errors: [...top.errors], skipped: [...top.skipped] };
    else if (f === "let") stack[stack.length - 1] = { ...top, names: { ...top.names } };
    else stack[stack.length - 1] = { ...top };
  }
  const p = programOf(machine, options);
  // Each call has a new program. Thus the configuration holds the state of the evaluation that a later step needs.
  p.work = configuration.work ?? 0;
  for (const [at, count] of Object.entries(configuration.counts ?? {})) p.counts.set(at, count);
  // A list of effects from the host holds the earlier effects. Without it, the configuration holds their number.
  p.before = options.effects === undefined ? (configuration.effected ?? 0) : 0;
  const next = advance(p, { ...configuration, stack });
  const effected = p.before + p.effects.length;
  return {
    ...next,
    ...(p.work === 0 ? {} : { work: p.work }),
    ...(p.counts.size === 0 ? {} : { counts: Object.fromEntries(p.counts) }),
    ...(effected === 0 ? {} : { effected }),
  };
}


/**
 * This function gives the JSON form of a configuration (STEPPER.DATA). A closure becomes a record with the key
 * `coeval.closure`, and a held error a record with the key `coeval.held`. A record of data with one of the keys of the
 * form goes in a record with the key `coeval.data`. Thus `decodeConfiguration` tells data from a closure. A value that is
 * not plain JSON stays as it is. A shared object stays shared, and `JSON.stringify` copies it.
 */
export function encodeConfiguration(configuration: Configuration): Json {
  const done = new Map<object, unknown>();
  const encode = (value: unknown): unknown => {
    if (typeof value !== "object" || value === null) return value;
    const known = done.get(value);
    if (known !== undefined) return known;
    let out: unknown = value;
    if (value instanceof StepClosure) out = { [CLOSURE_MARK]: encode(value.closure) };
    else if (value instanceof Held) out = { [HELD_MARK]: encode(value.error) };
    else if (Array.isArray(value)) out = (value as readonly unknown[]).map(encode);
    else if (isRecord(value)) {
      const fields: Record<string, unknown> = {};
      for (const key of Object.keys(value)) setField(fields, key, encode(value[key]));
      out = Object.keys(value).some((key) => MARKS.includes(key)) ? { [DATA_MARK]: fields } : fields;
    }
    done.set(value, out);
    return out;
  };
  return encode(configuration) as Json;
}

/**
 * This function gives the configuration of a JSON form from `encodeConfiguration` (STEPPER.DATA). Only a record with the
 * one key `coeval.closure` or `coeval.held` becomes a closure or a held error. The record in a record with the one key
 * `coeval.data` is data, also with these keys. The host gives the form, thus the stepper trusts it as it trusts a context.
 */
export function decodeConfiguration(data: Json): Configuration {
  const done = new Map<object, unknown>();
  const decode = (value: unknown, data: boolean): unknown => {
    if (typeof value !== "object" || value === null) return value;
    const known = data ? undefined : done.get(value);
    if (known !== undefined) return known;
    let out: unknown = value;
    if (Array.isArray(value)) out = (value as readonly unknown[]).map((item) => decode(item, false));
    else if (isRecord(value)) {
      const keys = Object.keys(value);
      const mark = !data && keys.length === 1 ? keys[0] : undefined;
      if (mark === CLOSURE_MARK) out = new StepClosure(decode(value[mark], false) as Closure);
      else if (mark === HELD_MARK) out = new Held(decode(value[mark], false) as EvalError);
      else if (mark === DATA_MARK && isRecord(value[mark])) out = decode(value[mark], true);
      else {
        const fields: Record<string, unknown> = {};
        for (const key of keys) setField(fields, key, decode(value[key], false));
        out = fields;
      }
    }
    if (!data) done.set(value, out);
    return out;
  };
  return decode(data, false) as Configuration;
}

/**
 * This function evaluates a document with an explicit stack (K95, D158). It gives the result of `reference` for each
 * document of the kernel and the formula kit (AGREE.STEPPER). The nesting of a document does not use the stack of the
 * host (STEPPER.DEEP). A host evaluator is opaque: one step starts it, and each of its handles starts a nested
 * stepper. The stepper does no effects and no runs.
 *
 * @param machine - The world, the evaluators and the other code.
 * @param doc - The document.
 * @param context - The names and the capabilities at the root.
 * @param options - The profile of the formula kit, the verb and the type of a bare root value.
 * @returns The result.
 */
export function stepper(machine: Machine, doc: unknown, context: Context = makeContext(), options: StepperOptions = {}): Result {
  const p = programOf(machine, options);
  try {
    const end = drive(p, stepperStart(machine, doc, context, options));
    p.ended = true;
    return end.result.ok ? ok(forHost(p, end, end.result.value)) : end.result;
  } catch (error) {
    return placed(thrown(error, "the stepper"), []);
  }
}
