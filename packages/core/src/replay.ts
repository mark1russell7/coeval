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
  /** The name and the message of a cause that is an exception, when no domain with a codec holds it. */
  readonly exception?: { readonly name: string; readonly message: string };
}

/** This function tells if a key is a field of an error value that the JSON form keeps. */
function errorField(key: string): boolean {
  return key === "code" || key === "reason" || key === "place" || key === "cause";
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
    if (cause instanceof Error) return { ...base, exception: { name: String(cause.name), message: String(cause.message) } };
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
 * - An outcome that the log does not have stays absent.
 *
 * @param machine - The machine of the run, or only its domains.
 * @param log - The log of a recorder.
 * @returns The JSON form. `decodeLog` gives the log again.
 * @throws {TypeError} A value has no term document, for example a closure, a host thing, a symbol, or a value that no
 *   domain with a codec holds. The message names the effect and its address.
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
  const made =
    name === "TypeError"
      ? new TypeError(message)
      : name === "RangeError"
        ? new RangeError(message)
        : name === "SyntaxError"
          ? new SyntaxError(message)
          : name === "ReferenceError"
            ? new ReferenceError(message)
            : new Error(message);
  if (made.name !== name) made.name = name;
  return made;
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
    if (!isRecord(thrown) || typeof thrown["name"] !== "string" || typeof thrown["message"] !== "string" || Object.keys(thrown).length !== 2) {
      return bad([...place, "exception"], "an exception is a record with only the texts name and message.");
    }
    error.cause = exception(thrown["name"], thrown["message"]);
  } else if (Object.hasOwn(data, "cause")) {
    const cause = readTerm(kit, data["cause"], [...place, "cause"]);
    if (!cause.ok) return cause;
    error.cause = cause.value;
  }
  return ok(error);
}

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
