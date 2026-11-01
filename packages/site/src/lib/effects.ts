import { STD_CAPS, STD_MACHINE, check, kindOf, makeContext, run, type Effect, type Issue, type Json, type Result } from "@mark1russell7/coeval";

/** A program of the effects diagram: a document with effects, and its short text for a reader. */
export interface EffectProgram {
  readonly id: string;
  /** The short text of the document on its button. */
  readonly label: string;
  /** One or two sentences about the place of the runner. */
  readonly note: string;
  readonly doc: Json;
}

const log = (text: string): Json => ({ type: "log", value: [text] });

/** The programs of the diagram. Each one puts the runner `log` at a different place. */
export const EFFECT_PROGRAMS: readonly EffectProgram[] = [
  {
    id: "root",
    label: "log[x]",
    note: "The runner log is the root. The root can wait, thus the host gets the effect.",
    doc: log("x"),
  },
  {
    id: "under-add",
    label: "add[1, log[x]]",
    note: "The runner log is a part of add. The evaluator add cannot wait, thus the host does not get the effect.",
    doc: { type: "add", value: [1, log("x")] },
  },
  {
    id: "seq",
    label: "seq[log[x], add[1, last]]",
    note: "The runner seq is the parent of log, and seq can wait. The step add reads the answer of the host as last.",
    doc: { type: "seq", value: [log("x"), { type: "add", value: [1, { type: "ref", value: ["names", "last"] }] }] },
  },
];

/** The kind of a host: it gives its answer with a promise, or it gives its answer at once. */
export type HostKind = "waits" | "at-once";

/** A host of the diagram: its kind and its text for a reader. */
export interface EffectHost {
  readonly id: HostKind;
  readonly label: string;
  readonly note: string;
}

/** The answer of each host to each effect. */
export const HOST_ANSWER = 2;

/** The two hosts of the diagram. */
export const EFFECT_HOSTS: readonly EffectHost[] = [
  { id: "waits", label: "Host that waits", note: `The function perform gives a promise of ${String(HOST_ANSWER)}.` },
  { id: "at-once", label: "Host that answers at once", note: `The function perform gives ${String(HOST_ANSWER)} at once.` },
];

/** One effect of a run, as the diagram shows it. */
export interface EffectRow {
  /** The stable address of the effect from the kernel. */
  readonly address: string;
  readonly kind: string;
  readonly payload: unknown;
  /** The keys from the root document to the runner of the effect. */
  readonly place: readonly (string | number)[];
  /** `true` when the kernel called `perform` with this effect. */
  readonly reached: boolean;
  /** The outcome of the effect from the kernel. It is `undefined` when the run stopped first. */
  readonly outcome: Result | undefined;
}

/** The facts of one run of a program against one host. The kernel gives each value. */
export interface HostRun {
  readonly program: string;
  readonly host: HostKind;
  /** The addresses of the effects that the kernel gave to `perform`, in the order of the calls. */
  readonly calls: readonly string[];
  readonly effects: readonly EffectRow[];
  readonly result: Result;
  /** The issues that `check` with the option `run` finds before the run. */
  readonly issues: readonly Issue[];
}

/**
 * This function makes the function `perform` of a host. The function records the address of each effect that it gets.
 *
 * @param host - The kind of the host.
 * @param calls - The list that gets the address of each effect.
 * @returns The function `perform`.
 */
export function hostPerform(host: HostKind, calls: string[]): (effect: Effect) => unknown {
  return (effect) => {
    calls.push(effect.address ?? String(effect.index));
    return host === "waits" ? Promise.resolve(HOST_ANSWER) : HOST_ANSWER;
  };
}

/**
 * This function does a run of a program against a host with the kernel. It records the calls of `perform`, the outcome of each
 * effect, the result and the issues of the check.
 *
 * @param program - The program.
 * @param host - The kind of the host.
 * @returns The facts of the run.
 */
export async function runWithHost(program: EffectProgram, host: HostKind): Promise<HostRun> {
  const calls: string[] = [];
  const out = await run(STD_MACHINE, program.doc, makeContext({}, STD_CAPS), { perform: hostPerform(host, calls) });
  const effects = out.effects.map((effect): EffectRow => {
    const address = effect.address ?? String(effect.index);
    return {
      address,
      kind: effect.kind,
      payload: effect.payload,
      place: effect.place.map((key) => (typeof key === "number" ? key : String(key))),
      reached: calls.includes(address),
      outcome: effect.outcome,
    };
  });
  return { program: program.id, host, calls, effects, result: out.result, issues: check(STD_MACHINE, program.doc, { run: true }) };
}

/**
 * This function tells if the kind of a type has a runner in the machine of the diagram. A runner can wait for the host.
 * The world gives the evaluator of the kind, and the machine keys its runners by that evaluator.
 *
 * @param kind - The type of the document.
 * @returns `true` when the kind has a runner.
 */
export function isRunner(kind: string): boolean {
  const evaluator = kindOf(STD_MACHINE.world, kind)?.verbs["eval"];
  return evaluator !== undefined && Object.hasOwn(STD_MACHINE.runners ?? {}, evaluator);
}

/**
 * This function gives the short text of a result: the JSON of its value, or the code of its error.
 *
 * @param result - The result, or `undefined` when the kernel gave no outcome.
 * @returns The text.
 */
export function resultText(result: Result | undefined): string {
  if (result === undefined) return "no outcome";
  return result.ok ? JSON.stringify(result.value) : result.error.code;
}
