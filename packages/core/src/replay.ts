import { decodeValue, encodeValue } from "./codec.ts";
import { type Json, type Key, equalWith, isKey, isRecord } from "./doc.ts";
import { type ErrorCode, type EvalError, type Result, Failure, describe, fail, ok } from "./errors.ts";
import { type Effect, type Journal, type Machine, type Perform, JOURNAL } from "./evaluate.ts";
import { formulaMachine } from "./formula.ts";

/*
 * Record and replay (R2 P2, D19). A recorder wraps the function `perform` of a host and keeps a log. The log has each
 * effect with its address, its request and its outcome, and the order in which the waits of each `all` settled. A
 * replayer answers each effect from the log by its address, thus a replay does no host effect. The kernel gives the
 * address and the outcome of each effect. The journal on the function `perform` carries the order of the waits.
 *
 * A log has a JSON form (RUN.REPLAY-JSON, D75). `encodeLog` writes each value through `encodeValue` (D40), and `decodeLog`
 * reads it again. Thus a test can keep a log as a golden file (RUN.REPLAY-GOLDEN).
 */

/** One effect of a log: its address, its request and its outcome. */
export interface ReplayEntry {
  /** The address of the effect (RUN.ADDRESS), for example `1#0` or `all0.1/1#0`. */
  readonly address: string;
  /** The kind of the effect, as a text with dots. */
  readonly kind: string;
  readonly payload: unknown;
  /** The outcome of the effect (RUN.OUTCOME). It is absent when the recorded run stopped before the answer came. */
  readonly outcome?: Result;
  /** `true` when the host made the run wait for the outcome. */
  readonly waited: boolean;
}

/** An item of an `all` whose wait settled in the recorded run. */
export interface ReplaySettle {
  /** The address of the `all`, for example `all0` or `all0.1/all0`. */
  readonly all: string;
  /** The index of the item. */
  readonly item: number;
}

/** The log of a run: each effect in the order of the requests, and the order in which the waits of each `all` settled. */
export interface ReplayLog {
  readonly effects: readonly ReplayEntry[];
  readonly settles: readonly ReplaySettle[];
}

/** A recorder: the function `perform` for a run, and the log of that run (RUN.RECORD). */
export interface Recorder {
  /** The function to give the run. It gives each effect to the function `perform` of the host, and it records the effect. */
  readonly perform: Perform;
  /**
   * This function gives the log of the run until this time. An effect gets its outcome when the answer comes.
   *
   * @returns The log.
   */
  log(): ReplayLog;
}

/** The options of a replayer. */
export interface ReplayOptions {
  /**
   * `false`: each answer comes at once, also for an effect that waited in the recorded run. An evaluation needs this
   * value, because it does not wait. The default is `true`: an effect waits when it waited in the recorded run.
   */
  readonly wait?: boolean;
  /**
   * The rule of the host for two payloads that are not the same by `Object.is`: one of the run and one of the log.
   * It works as the rule of `sameResult`. Its `undefined` gives the rules of `docEquals`. A log from `decodeLog` holds new copies
   * of the members of a domain, for example of a time. The rule tells that two such copies are the same.
   */
  readonly equal?: (a: unknown, b: unknown) => boolean | undefined;
}

/**
 * This function makes a recorder (RUN.RECORD). The recorder gives each effect to the function `perform` of the host.
 * Its log keeps each effect with its address, its kind, its payload and the outcome that the kernel gives it. The log
 * also keeps the order in which the waits of each `all` settle.
 *
 * The recorder gives each call of its journal to the journal of the inner function, for example of a replayer. Thus a
 * recording of a replay settles the waits in the order of the replayer, and it gives the same log (RUN.REPLAY-ORDER).
 *
 * @param perform - The function of the host. Without it, each effect gives its payload, as in a run without a host.
 * @returns The function `perform` for the run, and the log.
 */
export function recorder(perform?: Perform): Recorder {
  const seen: { readonly effect: Effect; waited: boolean }[] = [];
  const settles: ReplaySettle[] = [];
  // The journal of an inner replayer keeps the order of the waits, thus a recording of a replay keeps it (RUN.REPLAY-ORDER).
  const journal = relay(perform, (all, item) => {
    settles.push({ all, item });
  });
  const host = (effect: Effect): unknown => {
    const entry = { effect, waited: false };
    seen.push(entry);
    const answer = perform === undefined ? effect.payload : perform(effect);
    if (answer instanceof Promise) entry.waited = true;
    return answer;
  };
  return {
    perform: Object.assign(host, { [JOURNAL]: journal }),
    log: () => ({
      effects: seen.map(({ effect, waited }) => ({
        address: effect.address ?? "",
        kind: effect.kind,
        payload: effect.payload,
        waited,
        ...(effect.outcome === undefined ? {} : { outcome: effect.outcome }),
      })),
      settles: [...settles],
    }),
  };
}

/**
 * This function makes a replayer: a function `perform` that answers each effect from a log, by its address (RUN.REPLAY). A
 * recorded error comes again with its code, its reason, its place and its cause. The waits of each `all` settle in the
 * recorded order. An effect that the log does not have at its address gives `#REPLAY!` (RUN.REPLAY-MISMATCH).
 *
 * One replayer serves more than one run, also two runs at the same time (RUN.REPLAY-RUNS). The kernel tells the journal
 * the number of the waits of each `all` that settled before, thus the replayer keeps no state of a run. When the
 * recorded item of a wait does not wait in the run, that wait follows the order of the host.
 *
 * @param log - The log of a recorder, or of `decodeLog`.
 * @param options - `wait: false` for an evaluation, and the rule of the host for payloads.
 * @returns The function `perform` for the replay.
 */
export function replayer(log: ReplayLog, options: ReplayOptions = {}): Perform {
  const wait = options.wait !== false;
  const equal = options.equal;
  const entries = new Map<string, ReplayEntry>();
  for (const entry of log.effects) entries.set(entry.address, entry);
  const order = new Map<string, number[]>();
  for (const settle of log.settles) {
    const items = order.get(settle.all);
    if (items === undefined) order.set(settle.all, [settle.item]);
    else items.push(settle.item);
  }
  // The places in the order for a copy of an older kernel, which gives no count of the waits that settled.
  let places: Map<string, number> | undefined;
  const journal: Journal = {
    next: (all, waiting, before) => {
      const items = order.get(all);
      if (items === undefined) return undefined;
      const at = before ?? (places ??= new Map()).get(all) ?? 0;
      const item = items[at];
      if (item === undefined || !waiting.includes(item)) return undefined;
      if (before === undefined) places?.set(all, at + 1);
      return item;
    },
  };
  const perform = (effect: Effect): unknown => {
    const entry = effect.address === undefined ? undefined : entries.get(effect.address);
    const wrong = mismatch(effect, entry, equal);
    if (wrong !== undefined || entry === undefined) throw wrong;
    const outcome = entry.outcome;
    const failure =
      outcome === undefined
        ? replayError(effect, `The log has no outcome for the effect ${effect.kind} at ${effect.address ?? ""}: the recorded run stopped before the answer.`)
        : outcome.ok
          ? undefined
          : new Failure(outcome.error);
    const value = outcome?.ok === true ? outcome.value : undefined;
    if (wait && entry.waited) return failure === undefined ? Promise.resolve(value) : Promise.reject(failure);
    if (failure !== undefined) throw failure;
    return value;
  };
  return Object.assign(perform, { [JOURNAL]: journal });
}

/** This function gives the error of an effect that the log does not have at its address, or `undefined`. */
function mismatch(effect: Effect, entry: ReplayEntry | undefined, equal: ReplayOptions["equal"]): Failure | undefined {
  const at = effect.address ?? "";
  if (entry === undefined) return replayError(effect, `The log has no effect at the address ${at}, and the run asks for the effect ${effect.kind}.`);
  if (entry.kind !== effect.kind) return replayError(effect, `The log has the effect ${entry.kind} at the address ${at}, and the run asks for the effect ${effect.kind}.`);
  if (!equalWith(entry.payload, effect.payload, equal)) return replayError(effect, `The effect ${effect.kind} at the address ${at} has another payload than the log.`);
  return undefined;
}

/** This function gives the exception that carries `#REPLAY!` to the kernel, with the place of the effect. */
function replayError(effect: Effect, reason: string): Failure {
  return new Failure(fail("#REPLAY!", reason, { place: effect.place }).error);
}

/**
 * This function gives a journal that tells a function of its own each wait that settles. It gives each call to the
 * journal of the inner function `perform`, when that function has one.
 *
 * @param perform - The inner function.
 * @param settled - The function of its own.
 * @returns The journal.
 */
export function relay(perform: Perform | undefined, settled: (all: string, item: number) => void): Journal {
  const inner = perform === undefined ? undefined : (perform as { readonly [JOURNAL]?: Journal })[JOURNAL];
  const tell = (all: string, item: number): void => {
    settled(all, item);
    inner?.settled?.(all, item);
  };
  if (inner?.next === undefined) return { settled: tell };
  return { settled: tell, next: (all, waiting, before) => inner.next?.(all, waiting, before) };
}

/** The JSON form of a log (RUN.REPLAY-JSON). `encodeLog` writes it, and `decodeLog` reads it. */
export interface ReplayLogJson {
  /** The version of the form. Only the version 1 exists. */
  readonly version: 1;
  readonly effects: readonly ReplayEntryJson[];
  readonly settles: readonly ReplaySettle[];
}

/** The JSON form of one effect of a log. A value is a term document of `encodeValue` (D40). */
export interface ReplayEntryJson {
  readonly address: string;
  readonly kind: string;
  /** The term document of the payload. The value `undefined` is `ext.undefined`. */
  readonly payload: Json;
  /** The JSON form of the outcome. It is absent when the recorded run stopped before the answer came. */
  readonly outcome?: ReplayResultJson;
  readonly waited: boolean;
}

/** The JSON form of an outcome: the term document of the value, or the JSON form of the error. */
export type ReplayResultJson = { readonly ok: true; readonly value: Json } | { readonly ok: false; readonly error: ReplayErrorJson };

/** The JSON form of an error value. It has `cause` or `exception` only when the error has a cause. */
export interface ReplayErrorJson {
  readonly code: ErrorCode;
  readonly reason: string;
  readonly place?: readonly Key[];
  /** The term document of the cause, when `encodeValue` writes the cause. */
  readonly cause?: Json;
  /** The JSON form of a cause that is an exception, when no domain with a codec holds it. */
  readonly exception?: ReplayExceptionJson;
}

/**
 * The JSON form of an exception (RUN.REPLAY-CAUSES, D76). The exceptions of an error and of their causes are a chain.
 * The index 0 of the chain is the exception of the error. Each field after `message` is optional, thus a log of the
 * version 1 without them stays correct.
 */
export interface ReplayExceptionJson {
  readonly name: string;
  readonly message: string;
  /** The term documents of the own fields of the exception that `encodeValue` writes, for example `code` or `errno`. */
  readonly fields?: Readonly<Record<string, Json>>;
  /**
   * The own enumerable fields without a term document that are an exception, a list or a plain record (RUN.REPLAY-FIELDS,
   * D78, D82). An example is a list `errors` on an `Error`. A list is a list of parts, and a record is the part `record`.
   * Each exception in them has the rule of a cause. A container without a form in it is a name in `dropped`.
   */
  readonly parts?: Readonly<Record<string, ReplayPartsJson>>;
  /**
   * The names of the own fields without a form, and `cause` for a cause without a form. An item of a container has the
   * name of the container, a dot and its key or index, for example `errors.1`. This list is only a note: `decodeLog`
   * does not give these fields back.
   */
  readonly dropped?: readonly string[];
  /**
   * The own fields of the standard classes that are not enumerable (RUN.REPLAY-HIDDEN, D77): `errors` of an
   * `AggregateError`, `error` and `suppressed` of a `SuppressedError`. A list is a list of parts.
   */
  readonly hidden?: Readonly<Record<string, ReplayPartsJson>>;
  /** The term document of the cause, when `encodeValue` writes the cause. */
  readonly cause?: Json;
  /** The JSON form of a cause that is an exception, when no domain with a codec holds it. */
  readonly exception?: ReplayExceptionJson;
  /** The index in the chain of an earlier exception that is the cause. Thus a cycle of causes stays exact. */
  readonly loop?: number;
}

/**
 * The JSON form of one value of a field in `parts` or `hidden` (D77, D78, D82). It is a term document, an exception, the
 * index of an earlier exception, or a record of parts. The walk is depth first: the fields in `parts` in their order, the
 * hidden fields, then the cause. The mark `dropped` keeps the place of an item of a list without a form, and `decodeLog`
 * gives a hole there.
 */
export type ReplayPartJson =
  | { readonly value: Json }
  | { readonly exception: ReplayExceptionJson }
  | { readonly loop: number }
  | { readonly record: Readonly<Record<string, ReplayPartsJson>> }
  | { readonly dropped: true };

/**
 * The JSON form of a value in `parts`, in `hidden` or in a record of parts (D82). It is one part, or a list of them. A
 * list in a list is a JSON list in a JSON list, thus the rule is the same at each depth.
 */
export type ReplayPartsJson = ReplayPartJson | readonly ReplayPartsJson[];

/** This function tells if a key is a field of an error value that the JSON form keeps. */
function errorField(key: string): boolean {
  return key === "code" || key === "reason" || key === "place" || key === "cause";
}

/** This function tells if a key is a field of an exception that the JSON form keeps in a field of its own, or drops. */
function ownField(key: string): boolean {
  return key === "name" || key === "message" || key === "stack" || key === "cause";
}

/** This function tells if a key is a field of the JSON form of an exception. */
function exceptionField(key: string): boolean {
  return (
    key === "name" ||
    key === "message" ||
    key === "fields" ||
    key === "parts" ||
    key === "dropped" ||
    key === "hidden" ||
    key === "cause" ||
    key === "exception" ||
    key === "loop"
  );
}

/**
 * The own fields that are not enumerable and that the JSON form keeps in `hidden` (D77). The standard classes define
 * them: `errors` of `AggregateError`, `error` and `suppressed` of `SuppressedError`.
 */
const HIDDEN: readonly string[] = /* @__PURE__ */ Object.freeze(["errors", "error", "suppressed"]);

/** The result of `readField` for a field that the walk of `exceptionJson` cannot read. */
const MISSING: unique symbol = /* @__PURE__ */ Symbol("missing");

/**
 * The form of one value in the walk of `exceptionJson`. It is a term document, a loop, a later exception or a later
 * container. A value without a form keeps its name for `dropped`.
 */
type Part = { readonly value: Json } | { readonly loop: number } | { readonly node: number } | { readonly holder: number } | { readonly none: string };

/** One exception of the walk of `exceptionJson`, before its JSON form. */
interface ExceptionNode {
  readonly head: { readonly name: string; readonly message: string; readonly fields?: Readonly<Record<string, Json>> };
  /** The keys of the own enumerable fields without a term document, in the order of the keys. */
  readonly keys: readonly string[];
  readonly parts: Part[];
  /** The keys of the hidden fields, in the order of `HIDDEN`. */
  readonly hiddenKeys: string[];
  readonly hidden: Part[];
  cause?: Part;
}

/** One list or plain record of the walk of `exceptionJson` without a term document, before its JSON form (D82). */
interface Holder {
  /** The name for `dropped` when no item of the container has a form. */
  readonly name: string;
  readonly list: boolean;
  /** The value `true` marks a hidden list of a standard class. It keeps its marks also without a form (D78). */
  readonly keep: boolean;
  /** The keys of a record in the order of the keys. A list has no keys. */
  readonly keys: readonly string[];
  readonly slots: Part[];
}

/** The containers on the way from a field of an exception to a value. A container on the way again is a cycle. */
interface Way {
  readonly value: object;
  readonly up: Way | undefined;
}

/** One value of an exception that the walk of `exceptionJson` writes next, and the place for its form. */
interface ExceptionTask {
  readonly value: unknown;
  /** The name for `dropped`. An item has the name of its container, a dot and its key or index, for example `errors.1`. */
  readonly name: string;
  /** The value `true` marks a value that `encodeValue` cannot write, thus the walk does not try again. */
  readonly tried: boolean;
  /** The value `false` marks a cause. A cause is a term document, an exception or a loop, not a container. */
  readonly nest: boolean;
  readonly way: Way | undefined;
  readonly put: (part: Part) => void;
}

/** The form of one part of `exceptionJson` after the walk, and its names for `dropped` in the order of the walk. */
interface Built {
  readonly form?: ReplayPartsJson;
  readonly names: readonly string[];
}

/**
 * This function tells if a value holds a hole of a list at some depth. `encodeValue` writes a hole as `undefined`. Thus
 * the walk of `exceptionJson` keeps such a value in parts, and the hole keeps its mark (D82).
 */
function holdsHole(value: unknown): boolean {
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const at = stack.pop();
    if (typeof at !== "object" || at === null || seen.has(at) || !(Array.isArray(at) || isRecord(at))) continue;
    seen.add(at);
    if (Array.isArray(at)) {
      for (let item = 0; item < at.length; item += 1) {
        if (!Object.hasOwn(at, item)) return true;
        stack.push(at[item]);
      }
    } else {
      for (const key of Object.keys(at)) stack.push(at[key]);
    }
  }
  return false;
}

/** This function gives the term document of a value of an exception, or `undefined` when the value has none. */
function termOrNothing(machine: Pick<Machine, "domains">, value: unknown): Json | undefined {
  if (holdsHole(value)) return undefined;
  try {
    return encodeValue(machine, value);
  } catch {
    return undefined;
  }
}

/** This function reads a field of a value, or gives `MISSING` when the read throws. */
function readField(value: object, key: string | number): unknown {
  try {
    return (value as Record<string | number, unknown>)[key];
  } catch {
    return MISSING;
  }
}

/** This function tells if a container is on a way. */
function onWay(way: Way | undefined, value: object): boolean {
  for (let at = way; at !== undefined; at = at.up) if (at.value === value) return true;
  return false;
}

/** This function gives the forms of the parts with a form, with their keys, in the order of the keys. */
function keptOf(keys: readonly string[], built: readonly Built[]): [string, ReplayPartsJson][] {
  const kept: [string, ReplayPartsJson][] = [];
  for (let place = 0; place < keys.length; place += 1) {
    const form = built[place]?.form;
    if (form !== undefined) kept.push([keys[place] as string, form]);
  }
  return kept;
}

/**
 * This function writes an exception, its hidden fields and the chain of its causes as JSON (RUN.REPLAY-CAUSES,
 * RUN.REPLAY-HIDDEN, RUN.REPLAY-FIELDS). A host makes the exception, thus a part without a term document is a note in
 * `dropped`, not a refusal (D75, D76). The walk gives each exception an index in the order of a depth-first walk. It
 * takes the fields in `parts` in the order of their keys, the hidden fields in the order of `HIDDEN`, then the cause (D78).
 *
 * A list or a plain record without a term document is a container of parts, with its items in their order (D82). A
 * value that is an earlier exception of the walk is its index in `loop` (D77). The walk is a loop, thus a long chain
 * does not overflow the stack.
 */
function exceptionJson(machine: Pick<Machine, "domains">, first: Error): ReplayExceptionJson {
  // The nodes and the containers in the order of the walk. Each item of a node or of a container comes later.
  const items: (ExceptionNode | Holder)[] = [];
  const index = new Map<unknown, number>();
  const tasks: ExceptionTask[] = [];
  const later = (children: readonly ExceptionTask[]): void => {
    for (let place = children.length - 1; place >= 0; place -= 1) tasks.push(children[place] as ExceptionTask);
  };
  const hold = (name: string, value: object, keep: boolean, way: Way | undefined, children: ExceptionTask[]): number => {
    const at = items.length;
    const list = Array.isArray(value);
    const keys = list ? [] : Object.keys(value);
    const slots: Part[] = [];
    items.push({ name, list, keep, keys, slots });
    const inner: Way = { value, up: way };
    const size = list ? (value as readonly unknown[]).length : keys.length;
    for (let place = 0; place < size; place += 1) {
      const key = list ? place : (keys[place] as string);
      const item = list && !Object.hasOwn(value, place) ? MISSING : readField(value, key);
      const put = (part: Part): void => {
        slots[place] = part;
      };
      children.push({ value: item, name: `${name}.${key}`, tried: false, nest: true, way: inner, put });
    }
    return at;
  };
  const open = (current: Error): number => {
    const at = items.length;
    index.set(current, index.size);
    const fields: [string, Json][] = [];
    const linked: [string, unknown][] = [];
    for (const key of Object.keys(current)) {
      if (ownField(key)) continue;
      const value = readField(current, key);
      const term = value === MISSING ? undefined : termOrNothing(machine, value);
      if (term === undefined) linked.push([key, value]);
      else fields.push([key, term]);
    }
    const head = { name: String(current.name), message: String(current.message), ...(fields.length === 0 ? {} : { fields: Object.fromEntries(fields) }) };
    const node: ExceptionNode = { head, keys: linked.map(([key]) => key), parts: [], hiddenKeys: [], hidden: [] };
    items.push(node);
    const children: ExceptionTask[] = [];
    for (let place = 0; place < linked.length; place += 1) {
      const [key, value] = linked[place] as [string, unknown];
      const put = (part: Part): void => {
        node.parts[place] = part;
      };
      children.push({ value, name: key, tried: true, nest: true, way: undefined, put });
    }
    for (const key of HIDDEN) {
      if (Object.getOwnPropertyDescriptor(current, key)?.enumerable !== false) continue;
      const place = node.hiddenKeys.length;
      node.hiddenKeys.push(key);
      const value = readField(current, key);
      // A hidden list is always a list of parts, as in D77, also when `encodeValue` writes it.
      if (Array.isArray(value)) {
        node.hidden[place] = { holder: hold(key, value, true, undefined, children) };
        continue;
      }
      const put = (part: Part): void => {
        node.hidden[place] = part;
      };
      children.push({ value, name: key, tried: false, nest: true, way: undefined, put });
    }
    if (Object.hasOwn(current, "cause")) {
      const put = (part: Part): void => {
        node.cause = part;
      };
      children.push({ value: current.cause, name: "cause", tried: false, nest: false, way: undefined, put });
    }
    later(children);
    return at;
  };
  open(first);
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    const value = task.value;
    if (value === MISSING) {
      task.put({ none: task.name });
      continue;
    }
    const loop = index.get(value);
    if (loop !== undefined) {
      task.put({ loop });
      continue;
    }
    const term = task.tried ? undefined : termOrNothing(machine, value);
    if (term !== undefined) task.put({ value: term });
    else if (value instanceof Error) task.put({ node: open(value) });
    else if (task.nest && (Array.isArray(value) || isRecord(value)) && !onWay(task.way, value)) {
      const children: ExceptionTask[] = [];
      task.put({ holder: hold(task.name, value, false, task.way, children) });
      later(children);
    } else task.put({ none: task.name });
  }
  // Each item of a node or of a container comes later than its owner, thus the forms grow from the last to the first.
  const forms: (ReplayExceptionJson | Built)[] = [];
  const builtOf = (part: Part): Built => {
    if ("none" in part) return { names: [part.none] };
    if ("node" in part) return { form: { exception: forms[part.node] as ReplayExceptionJson }, names: [] };
    if ("holder" in part) return forms[part.holder] as Built;
    return { form: part, names: [] };
  };
  for (let at = items.length - 1; at >= 0; at -= 1) {
    const item = items[at] as ExceptionNode | Holder;
    if ("slots" in item) {
      const built = Array.from(item.slots, builtOf);
      // A container without a form in it has no form, thus its name stands for each of its items (D82).
      if (!item.keep && built.every((part) => part.form === undefined)) forms[at] = { names: [item.name] };
      else {
        const form = item.list ? built.map((part) => part.form ?? { dropped: true as const }) : { record: Object.fromEntries(keptOf(item.keys, built)) };
        forms[at] = { form, names: built.flatMap((part) => part.names) };
      }
      continue;
    }
    const { head, keys, parts, hiddenKeys, hidden, cause } = item;
    const linked = Array.from(parts, builtOf);
    const kept = Array.from(hidden, builtOf);
    const dropped = [...linked, ...kept].flatMap((part) => part.names);
    // A cause is never an item of a container, thus it never has the mark.
    let link: { readonly cause: Json } | { readonly loop: number } | { readonly exception: ReplayExceptionJson } | undefined;
    if (cause !== undefined && "none" in cause) dropped.push("cause");
    else if (cause !== undefined && "value" in cause) link = { cause: cause.value };
    else if (cause !== undefined && "loop" in cause) link = cause;
    else if (cause !== undefined && "node" in cause) link = { exception: forms[cause.node] as ReplayExceptionJson };
    const partsOf = keptOf(keys, linked);
    const hiddenOf = keptOf(hiddenKeys, kept);
    forms[at] = {
      ...head,
      ...(partsOf.length === 0 ? {} : { parts: Object.fromEntries(partsOf) }),
      ...(dropped.length === 0 ? {} : { dropped }),
      ...(hiddenOf.length === 0 ? {} : { hidden: Object.fromEntries(hiddenOf) }),
      ...link,
    };
  }
  return forms[0] as ReplayExceptionJson;
}

/** This function gives the message of an exception, or a short text for another value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : describe(error);
}

/** This function writes a value of a log as a term document, or throws a `TypeError` that names the value. */
function termOf(machine: Pick<Machine, "domains">, value: unknown, what: () => string): Json {
  try {
    return encodeValue(machine, value);
  } catch (error) {
    throw new TypeError(`encodeLog cannot write ${what()}: ${messageOf(error)}`);
  }
}

/** This function writes an error value of a log as JSON, or throws a `TypeError` that names the error. */
function errorJson(machine: Pick<Machine, "domains">, error: EvalError, what: () => string): ReplayErrorJson {
  for (const key of Object.keys(error)) {
    if (!errorField(key)) throw new TypeError(`encodeLog cannot write ${what()}: the error has the field ${key}, and the JSON form has no field for it.`);
  }
  const base = { code: error.code, reason: error.reason, ...(error.place === undefined ? {} : { place: error.place }) };
  if (!Object.hasOwn(error, "cause")) return base;
  const cause: unknown = error.cause;
  try {
    return { ...base, cause: encodeValue(machine, cause) };
  } catch (failure) {
    if (cause instanceof Error) return { ...base, exception: exceptionJson(machine, cause) };
    throw new TypeError(`encodeLog cannot write the cause of ${what()}: ${messageOf(failure)}`);
  }
}

/**
 * This function writes a log as JSON (RUN.REPLAY-JSON, D75). Then `JSON.stringify` gives the text of a golden file.
 *
 * - Each payload and each value of an outcome is a term document of `encodeValue`. Thus `NaN`, `-0` and `undefined`
 *   stay exact, and a member of a domain with a codec is `ext.domain`.
 * - An error keeps its code, its reason, its place and its cause. A cause that `encodeValue` cannot write and that is
 *   an exception keeps its name and its message in the field `exception`.
 * - An exception also keeps its own fields that `encodeValue` writes, and the chain of its causes (RUN.REPLAY-CAUSES).
 *   The list `dropped` names each other own field. A cause that is an earlier exception of the chain is its index in `loop`.
 * - An exception keeps the hidden fields of the standard classes in `hidden`, for example `errors` of an
 *   `AggregateError` (RUN.REPLAY-HIDDEN, D77). Each exception in them has the rule of a cause.
 * - An enumerable field without a term document that is an exception, a list or a plain record is in `parts`
 *   (RUN.REPLAY-FIELDS, D78, D82). An item of a list without a form is the mark `dropped` at its place.
 * - An outcome that the log does not have stays absent.
 *
 * @param machine - The machine of the run, or only its domains.
 * @param log - The log of a recorder.
 * @returns The JSON form. `decodeLog` gives the log again.
 * @throws {TypeError} A value has no term document, for example a closure, a host thing, a symbol, or a value that no
 *   domain with a codec holds. The message names the effect and its address. A part of an exception is not a refusal.
 */
export function encodeLog(machine: Pick<Machine, "domains">, log: ReplayLog): ReplayLogJson {
  const effects = log.effects.map((entry): ReplayEntryJson => {
    const at = (field: string) => (): string => `the ${field} of the effect ${entry.kind} at the address ${entry.address}`;
    const head = { address: entry.address, kind: entry.kind, payload: termOf(machine, entry.payload, at("payload")) };
    const outcome = entry.outcome;
    if (outcome === undefined) return { ...head, waited: entry.waited };
    const json: ReplayResultJson = outcome.ok
      ? { ok: true, value: termOf(machine, outcome.value, at("outcome")) }
      : { ok: false, error: errorJson(machine, outcome.error, at("outcome")) };
    return { ...head, outcome: json, waited: entry.waited };
  });
  return { version: 1, effects, settles: log.settles.map((settle) => ({ all: settle.all, item: settle.item })) };
}

/** This function gives an exception with a name and a message. A standard name gives an instance of its class. */
function exception(name: string, message: string): Error {
  const made = standard(name, message);
  if (made.name !== name) made.name = name;
  return made;
}

/**
 * This function gives an instance of the standard class with a name, or an `Error`. An `AggregateError` gets an empty
 * list `errors`, and a `SuppressedError` gets `undefined` for `error` and `suppressed`, as their constructors do.
 */
function standard(name: string, message: string): Error {
  switch (name) {
    case "TypeError":
      return new TypeError(message);
    case "RangeError":
      return new RangeError(message);
    case "SyntaxError":
      return new SyntaxError(message);
    case "ReferenceError":
      return new ReferenceError(message);
    case "AggregateError":
      return new AggregateError([], message);
    case "SuppressedError":
      return typeof SuppressedError === "function" ? new SuppressedError(undefined, undefined, message) : new Error(message);
    default:
      return new Error(message);
  }
}

/** This function gives an exception a field that is not enumerable, as the constructor of `Error` does for `cause`. */
function hide(error: Error, key: string, value: unknown): void {
  Object.defineProperty(error, key, { value, writable: true, enumerable: false, configurable: true });
}

/** This function gives the failed result of a JSON form that `decodeLog` cannot read. */
function bad(place: readonly Key[], reason: string): { readonly ok: false; readonly error: EvalError } {
  return fail("#VALUE!", `decodeLog cannot read the log: ${reason}`, { place });
}

/** This function reads a term document of a log again, with the formula kit and the domains of the machine. */
function readTerm(kit: Machine, doc: unknown, place: readonly Key[]): Result {
  const value = decodeValue(kit, doc);
  return value.ok ? value : bad(place, `the term document gives ${value.error.code}: ${value.error.reason}`);
}

/** This function reads the JSON form of an error value again. */
function readError(kit: Machine, data: unknown, place: readonly Key[]): Result<EvalError> {
  if (!isRecord(data) || typeof data["code"] !== "string" || !data["code"].startsWith("#") || typeof data["reason"] !== "string") {
    return bad(place, "an error is a record with a code that starts with # and a reason.");
  }
  for (const key of Object.keys(data)) {
    if (!errorField(key) && key !== "exception") return bad(place, `an error has no field ${key}.`);
  }
  const keys = data["place"];
  if (keys !== undefined && !(Array.isArray(keys) && keys.every((key) => isKey(key)))) return bad([...place, "place"], "a place is a list of texts and numbers.");
  const error: { code: ErrorCode; reason: string; place?: readonly Key[]; cause?: unknown } = { code: data["code"] as ErrorCode, reason: data["reason"] };
  if (keys !== undefined) error.place = keys as readonly Key[];
  const thrown = data["exception"];
  if (thrown !== undefined) {
    if (Object.hasOwn(data, "cause")) return bad(place, "an error has a cause or an exception, not both.");
    const read = readException(kit, thrown, [...place, "exception"]);
    if (!read.ok) return read;
    error.cause = read.value;
  } else if (Object.hasOwn(data, "cause")) {
    const cause = readTerm(kit, data["cause"], [...place, "cause"]);
    if (!cause.ok) return cause;
    error.cause = cause.value;
  }
  return ok(error);
}

/** One part of the JSON form of an exception that the walk of `readException` reads next, and the place for its value. */
interface ReadTask {
  /**
   * The field of the part: `value` or `cause` for a term document, `exception`, `loop`, `record` or `dropped`. The
   * kind `list` is a list of parts.
   */
  readonly kind: string;
  readonly data: unknown;
  readonly where: readonly Key[];
  readonly put: (value: unknown) => void;
}

/**
 * This function reads the JSON form of an exception, its hidden fields and the chain of its causes again
 * (RUN.REPLAY-CAUSES, RUN.REPLAY-HIDDEN, RUN.REPLAY-FIELDS). The walk has the order of `exceptionJson`, thus a loop gives
 * the same exception. A list or a record of parts gives a new list or plain record (D82). The walk is a loop, thus a long
 * chain does not overflow the stack.
 */
function readException(kit: Machine, data: unknown, place: readonly Key[]): Result<Error> {
  const chain: Error[] = [];
  const tasks: ReadTask[] = [];
  const open = (at: unknown, where: readonly Key[]): Result<Error> => {
    if (!isRecord(at) || typeof at["name"] !== "string" || typeof at["message"] !== "string" || !Object.keys(at).every(exceptionField)) {
      return bad(where, "an exception is a record with the texts name and message, and only the fields fields, parts, dropped, hidden, cause, exception and loop.");
    }
    const made = exception(at["name"], at["message"]);
    const fields = at["fields"];
    if (fields !== undefined) {
      if (!isRecord(fields)) return bad([...where, "fields"], "the fields of an exception are a record.");
      for (const key of Object.keys(fields)) {
        if (ownField(key)) return bad([...where, "fields", key], `the field ${key} of an exception is not in its fields.`);
        const value = readTerm(kit, fields[key], [...where, "fields", key]);
        if (!value.ok) return value;
        Object.defineProperty(made, key, { value: value.value, writable: true, enumerable: true, configurable: true });
      }
    }
    const dropped = at["dropped"];
    if (dropped !== undefined && !(Array.isArray(dropped) && dropped.every((name) => typeof name === "string"))) return bad([...where, "dropped"], "the list dropped holds texts.");
    chain.push(made);
    const children: ReadTask[] = [];
    const taken = (key: string): boolean => isRecord(fields) && Object.hasOwn(fields, key);
    const parts = at["parts"];
    if (parts !== undefined) {
      if (!isRecord(parts)) return bad([...where, "parts"], "the parts of an exception are a record.");
      for (const key of Object.keys(parts)) {
        if (ownField(key) || taken(key)) return bad([...where, "parts", key], `the field ${key} of an exception is not in its parts.`);
        const show = (value: unknown): void => {
          Object.defineProperty(made, key, { value, writable: true, enumerable: true, configurable: true });
        };
        const read = slotTask(parts[key], [...where, "parts", key], false, show);
        if (!read.ok) return read;
        // The field gets its place in the order of the keys at once, and the walk gives its value later.
        show(undefined);
        children.push(read.value);
      }
    }
    const hidden = at["hidden"];
    if (hidden !== undefined) {
      if (!isRecord(hidden)) return bad([...where, "hidden"], "the hidden fields of an exception are a record.");
      for (const key of Object.keys(hidden)) {
        if (!HIDDEN.includes(key) || taken(key) || (isRecord(parts) && Object.hasOwn(parts, key))) return bad([...where, "hidden", key], `an exception has no hidden field ${key}.`);
      }
      for (const key of HIDDEN) {
        if (!Object.hasOwn(hidden, key)) continue;
        const read = slotTask(hidden[key], [...where, "hidden", key], false, (value) => hide(made, key, value));
        if (!read.ok) return read;
        children.push(read.value);
      }
    }
    const record = at;
    const links = LINKS.filter((key) => Object.hasOwn(record, key));
    if (links.length > 1) return bad(where, "an exception has a cause, an exception or a loop, not more than one.");
    const link = links[0];
    if (link !== undefined) children.push({ kind: link, data: record[link], where: [...where, link], put: (value) => hide(made, "cause", value) });
    for (let index = children.length - 1; index >= 0; index -= 1) tasks.push(children[index] as ReadTask);
    return ok(made);
  };
  const first = open(data, place);
  if (!first.ok) return first;
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    const { kind, data: part, where } = task;
    // The mark keeps the place of an item without a form: the list keeps a hole there (D78).
    if (kind === "dropped") continue;
    if (kind === "loop") {
      if (typeof part !== "number" || !Number.isInteger(part) || part < 0 || part >= chain.length) return bad(where, "a loop is the index of an exception of the chain until this one.");
      task.put(chain[part]);
      continue;
    }
    if (kind === "list" || kind === "record") {
      const items = kind === "list" ? listTasks(part, where, task.put) : recordTasks(part, where, task.put);
      if (!items.ok) return items;
      for (let index = items.value.length - 1; index >= 0; index -= 1) tasks.push(items.value[index] as ReadTask);
      continue;
    }
    const value = kind === "exception" ? open(part, where) : readTerm(kit, part, where);
    if (!value.ok) return value;
    task.put(value.value);
  }
  return first;
}

/**
 * This function reads one value of a field in `parts`, in `hidden` or in a record of parts. A list is a list of parts,
 * and another value is one part.
 */
function slotTask(data: unknown, where: readonly Key[], item: boolean, put: (value: unknown) => void): Result<ReadTask> {
  return Array.isArray(data) ? ok({ kind: "list", data, where, put }) : partTask(data, where, item, put);
}

/**
 * This function gives a list of parts its length at once, and it gives the tasks of its items. Thus the mark `dropped`
 * leaves a hole at its place, and each later item keeps its index (D78).
 */
function listTasks(data: unknown, where: readonly Key[], put: (value: unknown) => void): Result<ReadTask[]> {
  const items = data as readonly unknown[];
  const list: unknown[] = [];
  list.length = items.length;
  put(list);
  const tasks: ReadTask[] = [];
  for (let item = 0; item < items.length; item += 1) {
    const task = slotTask(items[item], [...where, item], true, (value) => {
      list[item] = value;
    });
    if (!task.ok) return task;
    tasks.push(task.value);
  }
  return ok(tasks);
}

/**
 * This function gives a record of parts a new plain record (D82). It gives the tasks of its fields in the order of
 * the keys. Each key gets its place at once, thus the record keeps the order of the keys.
 */
function recordTasks(data: unknown, where: readonly Key[], put: (value: unknown) => void): Result<ReadTask[]> {
  if (!isRecord(data)) return bad(where, "a record of parts is a record.");
  const record: Record<string, unknown> = {};
  put(record);
  const tasks: ReadTask[] = [];
  for (const key of Object.keys(data)) {
    const show = (value: unknown): void => {
      Object.defineProperty(record, key, { value, writable: true, enumerable: true, configurable: true });
    };
    const task = slotTask(data[key], [...where, key], false, show);
    if (!task.ok) return task;
    show(undefined);
    tasks.push(task.value);
  }
  return ok(tasks);
}

/**
 * This function reads one part: a record with only one of the fields `value`, `exception`, `loop` and `record`. An item
 * of a list can also be the mark `{ "dropped": true }`.
 */
function partTask(data: unknown, where: readonly Key[], item: boolean, put: (value: unknown) => void): Result<ReadTask> {
  const keys = isRecord(data) ? Object.keys(data) : [];
  const kind = keys[0];
  const mark = kind === "dropped" && item && isRecord(data) && data[kind] === true;
  if (!isRecord(data) || keys.length !== 1 || kind === undefined || !(PARTS.includes(kind) || mark)) {
    return bad(where, "a field of parts is a part or a list of parts. A part has only one of the fields value, exception, loop and record, or an item is the mark dropped.");
  }
  return ok({ kind, data: data[kind], where: [...where, kind], put });
}

/** The fields of the JSON form of an exception that give its cause. */
const LINKS: readonly string[] = /* @__PURE__ */ Object.freeze(["cause", "exception", "loop"]);

/** The fields of the JSON form of a part of a field in `parts` or `hidden`. */
const PARTS: readonly string[] = /* @__PURE__ */ Object.freeze(["value", "exception", "loop", "record"]);

/** This function reads the JSON form of one effect again. */
function readEntry(kit: Machine, data: unknown, place: readonly Key[]): Result<ReplayEntry> {
  if (!isRecord(data) || typeof data["address"] !== "string" || typeof data["kind"] !== "string" || typeof data["waited"] !== "boolean" || !Object.hasOwn(data, "payload")) {
    return bad(place, "an effect is a record with the texts address and kind, a payload, and the truth value waited.");
  }
  for (const key of Object.keys(data)) {
    if (key !== "address" && key !== "kind" && key !== "payload" && key !== "outcome" && key !== "waited") return bad(place, `an effect has no field ${key}.`);
  }
  const payload = readTerm(kit, data["payload"], [...place, "payload"]);
  if (!payload.ok) return payload;
  const head = { address: data["address"], kind: data["kind"], payload: payload.value, waited: data["waited"] };
  if (!Object.hasOwn(data, "outcome")) return ok(head);
  const raw = data["outcome"];
  const at = [...place, "outcome"];
  if (isRecord(raw) && raw["ok"] === true && Object.hasOwn(raw, "value") && Object.keys(raw).length === 2) {
    const value = readTerm(kit, raw["value"], [...at, "value"]);
    return value.ok ? ok({ ...head, outcome: ok(value.value) }) : value;
  }
  if (isRecord(raw) && raw["ok"] === false && Object.keys(raw).length === 2) {
    const error = readError(kit, raw["error"], [...at, "error"]);
    return error.ok ? ok({ ...head, outcome: { ok: false, error: error.value } }) : error;
  }
  return bad(at, "an outcome is a record with ok true and a value, or with ok false and an error.");
}

/**
 * This function reads the JSON form of a log again (RUN.REPLAY-JSON). It reads each term document with the formula kit
 * and the domains of the machine. A cause in the field `exception` becomes an exception with that name and message.
 * The exception gets its fields and the chain of its causes again, also a cycle (RUN.REPLAY-CAUSES). A list gets a
 * hole at the place of the mark `dropped`, thus each later item keeps its index (D78).
 *
 * @param machine - The machine of the run, or only its domains.
 * @param data - The JSON form, for example from `JSON.parse` of a golden file.
 * @returns The log for `replayer`, or `#VALUE!` with the place of the first field that it cannot read.
 */
export function decodeLog(machine: Pick<Machine, "domains">, data: unknown): Result<ReplayLog> {
  if (!isRecord(data) || data["version"] !== 1) return bad([], "the form is a record with the version 1.");
  const list = data["effects"];
  const order = data["settles"];
  if (!Array.isArray(list) || !Array.isArray(order) || Object.keys(data).length !== 3) return bad([], "the form has only the version and the lists effects and settles.");
  const domains = machine.domains;
  const kit: Machine = { ...formulaMachine(), ...(domains === undefined ? {} : { domains }) };
  const effects: ReplayEntry[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = readEntry(kit, list[index], ["effects", index]);
    if (!entry.ok) return entry;
    effects.push(entry.value);
  }
  const settles: ReplaySettle[] = [];
  for (let index = 0; index < order.length; index += 1) {
    const settle: unknown = order[index];
    if (!isRecord(settle) || typeof settle["all"] !== "string" || !Number.isInteger(settle["item"]) || Object.keys(settle).length !== 2) {
      return bad(["settles", index], "a settle is a record with only the text all and the whole number item.");
    }
    settles.push({ all: settle["all"], item: settle["item"] as number });
  }
  return ok({ effects, settles });
}
