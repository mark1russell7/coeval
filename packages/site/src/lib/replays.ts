import { STD_CAPS, STD_MACHINE, makeContext, recorder, replayer, run, type Json, type Perform, type ReplayEntry, type ReplayLog, type Result } from "@mark1russell7/coeval";
import { EFFECTS } from "./programs.ts";

/*
 * The record and the replay of the replay diagram. A run of the effects program records each effect with a host. A
 * replay of a program answers each effect from the log, by its address. The reader can change the program and the
 * recorded answers, and the replay shows `#REPLAY!` at the address of the first request that the log does not have.
 */

const log = (...items: Json[]): Json => ({ type: "log", value: items });
const write = (key: string): Json => ({ type: "write", value: { key, value: { type: "add", value: [2, 3] } }, name: "total" });
const lastLog = log({ type: "ref", value: ["names", "total"] });

/** One program for the replay, with the place of the step that differs from the recorded program. */
export interface Variant {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly doc: Json;
  /** The place of the changed step, if the program has one. */
  readonly changed?: number;
}

/** The programs that a reader can replay. The first is the recorded program: the program of the first picture of the page. */
export const VARIANTS: readonly Variant[] = [
  { id: "same", label: "As recorded", note: "The replay asks for the same effects at the same addresses.", doc: EFFECTS },
  {
    id: "key",
    label: "Another key",
    note: "The write uses the key sum. The address 1#0 is the same, and the payload is not.",
    doc: { type: "seq", value: [log("start"), write("sum"), lastLog] },
    changed: 1,
  },
  {
    id: "more",
    label: "One more step",
    note: "A fourth step logs a line. The log has no effect at its address 3#0.",
    doc: { type: "seq", value: [log("start"), write("total"), lastLog, log("end")] },
    changed: 3,
  },
  {
    id: "fewer",
    label: "No first log",
    note: "Each step moves up one place. At the address 0#0, the log has a log, and the replay asks for a write.",
    doc: { type: "seq", value: [write("total"), lastLog] },
    changed: 0,
  },
];

/** What the reader does to a recorded answer. */
export type AnswerEdit = "recorded" | "other" | "error";

/** The error that the reader can put in the place of a recorded answer. */
export const HOST_ERROR: Result = { ok: false, error: { code: "#HOST!", reason: "The host refused the effect." } };

/**
 * This function gives the host of the record. Each log gets the next line number at once. Each write waits, and gets
 * the next version of the store.
 *
 * @param calls - A list that gets the kind of each effect that the host does.
 * @returns The function `perform` of the host.
 */
export function host(calls: string[]): Perform {
  let lines = 0;
  let version = 6;
  return (effect) => {
    calls.push(effect.kind);
    if (effect.kind === "write") {
      version += 1;
      return Promise.resolve(`v${String(version)}`);
    }
    lines += 1;
    return `line ${String(lines)}`;
  };
}

/**
 * This function gives another answer for an effect, for an edit of the log.
 *
 * @param entry - The effect of the log.
 * @returns The other answer.
 */
export function otherAnswer(entry: ReplayEntry): Result {
  return { ok: true, value: entry.kind === "write" ? "v42" : "line 42" };
}

/** The record of a run: its result, its log, and the count of the effects that the host did. */
export interface Recording {
  readonly result: Result;
  readonly log: ReplayLog;
  readonly hostCalls: number;
}

/**
 * This function runs the recorded program with the host and a recorder.
 *
 * @returns The result of the run, the log and the count of the host effects.
 */
export async function record(): Promise<Recording> {
  const calls: string[] = [];
  const recording = recorder(host(calls));
  const done = await run(STD_MACHINE, EFFECTS, makeContext({}, STD_CAPS), { perform: recording.perform });
  return { result: done.result, log: recording.log(), hostCalls: calls.length };
}

/**
 * This function gives the log with the edits of the reader. An edit replaces the outcome of an effect.
 *
 * @param log - The recorded log.
 * @param edits - The edit of each address. An address without an edit keeps its outcome.
 * @returns The log for the replay.
 */
export function editLog(log: ReplayLog, edits: Readonly<Record<string, AnswerEdit>>): ReplayLog {
  return {
    settles: log.settles,
    effects: log.effects.map((entry) => {
      const edit = edits[entry.address] ?? "recorded";
      if (edit === "recorded") return entry;
      return { ...entry, outcome: edit === "other" ? otherAnswer(entry) : HOST_ERROR };
    }),
  };
}

/** One request of the replay: the effect that the program asks for, and the answer of the replayer. */
export interface Request {
  readonly address: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly outcome?: Result;
}

/** The replay of a program: its result and each request. The replayer answers each request, thus the host does nothing. */
export interface Replay {
  readonly result: Result;
  readonly requests: readonly Request[];
}

/**
 * This function replays a program from a log. The replayer answers each effect by its address. A request that the log
 * does not have gives `#REPLAY!`, and the run stops there.
 *
 * @param doc - The program.
 * @param log - The log, with the edits of the reader.
 * @returns The result of the replay and each request.
 */
export async function replay(doc: Json, log: ReplayLog): Promise<Replay> {
  const done = await run(STD_MACHINE, doc, makeContext({}, STD_CAPS), { perform: replayer(log) });
  const requests = done.effects.map((effect) => ({
    address: effect.address ?? "",
    kind: effect.kind,
    payload: effect.payload,
    ...(effect.outcome === undefined ? {} : { outcome: effect.outcome }),
  }));
  return { result: done.result, requests };
}

/** The verdict of one address: the request matches the log, it gives `#REPLAY!`, or the replay did not ask for it. */
export type Verdict = "match" | "mismatch" | "unasked";

/** One row of the diagram: one address, with its effect in the log and its request in the replay. */
export interface Row {
  readonly address: string;
  readonly entry?: ReplayEntry;
  readonly request?: Request;
  /** The number of the request in the replay, from 1. */
  readonly step?: number;
  readonly verdict: Verdict;
}

/**
 * This function puts the effects of the log and the requests of the replay side by side, by their address. The
 * addresses of the log come first, in their order. A request at a new address comes after them.
 *
 * @param log - The log of the replay.
 * @param requests - The requests of the replay.
 * @returns One row for each address.
 */
export function rowsOf(log: ReplayLog, requests: readonly Request[]): readonly Row[] {
  const verdictOf = (request: Request | undefined): Verdict => {
    if (request === undefined) return "unasked";
    return request.outcome !== undefined && !request.outcome.ok && request.outcome.error.code === "#REPLAY!" ? "mismatch" : "match";
  };
  const rows: Row[] = log.effects.map((entry) => {
    const index = requests.findIndex((request) => request.address === entry.address);
    const request = index === -1 ? undefined : requests[index];
    return { address: entry.address, entry, ...(request === undefined ? {} : { request, step: index + 1 }), verdict: verdictOf(request) };
  });
  requests.forEach((request, index) => {
    if (!log.effects.some((entry) => entry.address === request.address)) rows.push({ address: request.address, request, step: index + 1, verdict: verdictOf(request) });
  });
  return rows;
}

/**
 * This function writes one step of a program for a reader.
 *
 * @param step - The document of the step.
 * @returns The text, for example `write total = add(2, 3)`.
 */
export function stepText(step: Json): string {
  const doc = step as { readonly type?: unknown; readonly value?: unknown };
  if (doc.type === "log") {
    const items = (doc.value as readonly Json[]).map((item) => {
      const ref = item as { readonly type?: unknown; readonly value?: unknown };
      return ref.type === "ref" && Array.isArray(ref.value) ? (ref.value as readonly Json[]).join(".") : JSON.stringify(item);
    });
    return `log ${items.join(", ")}`;
  }
  if (doc.type === "write") {
    const data = doc.value as { readonly key?: unknown };
    return `write ${String(data.key)} = add(2, 3)`;
  }
  return JSON.stringify(step);
}
