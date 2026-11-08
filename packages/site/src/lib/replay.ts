import { STD_CAPS, STD_MACHINE, encodeLog, makeContext, parse, recorder, replayer, run, type Effect, type Json, type ReplayLog, type ReplayLogJson, type Result } from "@mark1russell7/coeval";
import { SITE_SYNTAX } from "./syntax.ts";

/** The text of the document that the diagram records. */
export const RECORDED_TEXT = 'seq(a = log("the time"), b = log(a + 1), write("total", b))';

/** A change of the document between the recording and the replay. */
export interface DocumentChange {
  readonly id: string;
  /** The text of the button. */
  readonly label: string;
  /** The text of the document after the change. */
  readonly text: string;
  /** One sentence about the change. */
  readonly note: string;
}

/** The documents that a replay can run against the log of `RECORDED_TEXT`. */
export const DOCUMENT_CHANGES: readonly DocumentChange[] = [
  { id: "same", label: "The same document", text: RECORDED_TEXT, note: "The replay asks for each effect of the log, thus each answer comes from the log." },
  { id: "payload", label: "Another payload", text: 'seq(a = log("the time"), b = log(a + 5), write("total", b))', note: "The second step asks with another payload at its address." },
  { id: "kind", label: "Another kind", text: 'seq(a = log("the time"), b = write("b", a + 1), write("total", b))', note: "The second step asks for another effect at its address." },
  { id: "step", label: "One more step", text: 'seq(a = log("the time"), log("here"), b = log(a + 1), write("total", b))', note: "A new step takes the address of the old second step." },
];

/** How one effect of a run got its answer. */
export type RowState = "host" | "log" | "refused" | "not reached";

/** One effect of a run, as the diagram shows it. */
export interface JournalRow {
  /** The stable address of the effect from the kernel. */
  readonly address: string;
  readonly kind: string;
  readonly payload: unknown;
  /** The outcome of the effect. A row that the run did not reach has the outcome of the log. */
  readonly outcome: Result | undefined;
  readonly state: RowState;
}

/** The facts of one recording or one replay. The kernel gives each value. */
export interface JournalRun {
  readonly rows: readonly JournalRow[];
  readonly result: Result;
  /** The number of calls that the host got in this run. */
  readonly calls: number;
  /** The log of the recorder. A replay gives the log that it read. */
  readonly log: ReplayLog;
}

/** The host of the diagram. Each call gives a new number, thus two recordings differ. */
export interface CountingHost {
  readonly perform: (effect: Effect) => unknown;
  /** This function gives the number of calls so far. */
  readonly calls: () => number;
}

/**
 * This function makes a host that gives a new number at each call.
 *
 * @returns The host.
 */
export function countingHost(): CountingHost {
  let count = 0;
  return {
    perform: () => {
      count += 1;
      return count * 10;
    },
    calls: () => count,
  };
}

/** This function gives the document of a text of the diagram. */
function documentOf(text: string): Json {
  const read = parse(SITE_SYNTAX, text);
  if (!read.ok) throw new TypeError(`The text of the diagram does not parse: ${text}`);
  return read.doc;
}

/**
 * This function records a run of a document against a host.
 *
 * @param text - The text of the document.
 * @param host - The host.
 * @returns The facts of the run, with its log.
 */
export async function recordRun(text: string, host: CountingHost): Promise<JournalRun> {
  const before = host.calls();
  const recording = recorder(host.perform);
  const out = await run(STD_MACHINE, documentOf(text), makeContext({}, STD_CAPS), { perform: recording.perform });
  const rows = out.effects.map((effect): JournalRow => ({ address: effect.address ?? String(effect.index), kind: effect.kind, payload: effect.payload, outcome: effect.outcome, state: "host" }));
  return { rows, result: out.result, calls: host.calls() - before, log: recording.log() };
}

/**
 * This function replays a log against a document. The host gets no call, because the replayer takes the place of the host.
 *
 * @param text - The text of the document.
 * @param log - The log of a recording.
 * @returns The facts of the replay. A row of the log that the replay did not reach comes last.
 */
export async function replayRun(text: string, log: ReplayLog): Promise<JournalRun> {
  const out = await run(STD_MACHINE, documentOf(text), makeContext({}, STD_CAPS), { perform: replayer(log) });
  const rows = out.effects.map((effect): JournalRow => {
    const refused = effect.outcome?.ok === false && effect.outcome.error.code === "#REPLAY!";
    return { address: effect.address ?? String(effect.index), kind: effect.kind, payload: effect.payload, outcome: effect.outcome, state: refused ? "refused" : "log" };
  });
  const asked = new Set(rows.map((row) => row.address));
  const rest = log.effects.filter((entry) => !asked.has(entry.address)).map((entry): JournalRow => ({ address: entry.address, kind: entry.kind, payload: entry.payload, outcome: entry.outcome, state: "not reached" }));
  return { rows: [...rows, ...rest], result: out.result, calls: 0, log };
}

/**
 * This function writes a log as JSON, as a host stores it.
 *
 * @param log - The log.
 * @returns The JSON form from `encodeLog`.
 */
export function logJson(log: ReplayLog): ReplayLogJson {
  return encodeLog(STD_MACHINE, log);
}
