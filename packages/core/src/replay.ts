import { docEquals } from "./doc.ts";
import { type Result, Failure, fail } from "./errors.ts";
import { type Effect, type Journal, type Perform, JOURNAL } from "./evaluate.ts";

/*
 * Record and replay (R2 P2, D19). A recorder wraps the function `perform` of a host and keeps a log. The log has each
 * effect with its address, its request and its outcome, and the order in which the waits of each `all` settled. A
 * replayer answers each effect from the log by its address, thus a replay does no host effect. The kernel gives the
 * address and the outcome of each effect. The journal on the function `perform` carries the order of the waits.
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
}

/**
 * This function makes a recorder (RUN.RECORD). The recorder gives each effect to the function `perform` of the host.
 * Its log keeps each effect with its address, its kind, its payload and the outcome that the kernel gives it. The log
 * also keeps the order in which the waits of each `all` settle.
 *
 * @param perform - The function of the host. Without it, each effect gives its payload, as in a run without a host.
 * @returns The function `perform` for the run, and the log.
 */
export function recorder(perform?: Perform): Recorder {
  const seen: { readonly effect: Effect; waited: boolean }[] = [];
  const settles: ReplaySettle[] = [];
  const journal: Journal = {
    settled: (all, item) => {
      settles.push({ all, item });
    },
  };
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
 * A replayer keeps its place in the order of the waits, thus each run needs a new replayer.
 *
 * @param log - The log of a recorder.
 * @param options - `wait: false` for an evaluation.
 * @returns The function `perform` for the replay.
 */
export function replayer(log: ReplayLog, options: ReplayOptions = {}): Perform {
  const wait = options.wait !== false;
  const entries = new Map<string, ReplayEntry>();
  for (const entry of log.effects) entries.set(entry.address, entry);
  const order = new Map<string, number[]>();
  for (const settle of log.settles) {
    const items = order.get(settle.all);
    if (items === undefined) order.set(settle.all, [settle.item]);
    else items.push(settle.item);
  }
  const journal: Journal = {
    next: (all, waiting) => {
      const items = order.get(all);
      const item = items?.[0];
      if (items === undefined || item === undefined || !waiting.includes(item)) return undefined;
      items.shift();
      return item;
    },
  };
  const perform = (effect: Effect): unknown => {
    const entry = effect.address === undefined ? undefined : entries.get(effect.address);
    const wrong = mismatch(effect, entry);
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
function mismatch(effect: Effect, entry: ReplayEntry | undefined): Failure | undefined {
  const at = effect.address ?? "";
  if (entry === undefined) return replayError(effect, `The log has no effect at the address ${at}, and the run asks for the effect ${effect.kind}.`);
  if (entry.kind !== effect.kind) return replayError(effect, `The log has the effect ${entry.kind} at the address ${at}, and the run asks for the effect ${effect.kind}.`);
  if (!docEquals(entry.payload, effect.payload)) return replayError(effect, `The effect ${effect.kind} at the address ${at} has another payload than the log.`);
  return undefined;
}

/** This function gives the exception that carries `#REPLAY!` to the kernel, with the place of the effect. */
function replayError(effect: Effect, reason: string): Failure {
  return new Failure(fail("#REPLAY!", reason, { place: effect.place }).error);
}
