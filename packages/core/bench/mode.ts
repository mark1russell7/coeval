/*
 * The mode run of the bench: each case alone against the same case after other cases (K210, D98).
 *
 *   pnpm exec tsx packages/core/bench/mode.ts <head src/index.ts>
 *   node packages/core/bench/mode.ts merge <part 1 JSON> <part 2 JSON> ...
 *
 * Before K210, the bench of `paths.ts` ran all cases of `cases.ts` in one process, in a fixed order. Thus a later case
 * ran on the heap and the type feedback of the earlier cases. The A/A arm of the bench does not show the change that
 * this order makes, because both copies of the base have the same order.
 *
 * This script measures four arms with the head kernel only. Each process uses the flags of `paths.ts`, and a first
 * process calibrates the calls of each sample, as in the bench.
 *
 * - ALONE: a new process runs only one case. Each round has two ALONE processes for each case, A1 and A2.
 * - IN ORDER: a new process runs all cases in the order of `cases.ts`.
 * - GROUP: a new process runs only the cases that the bench keeps together, in their order. This arm runs only when
 *   `TOGETHER` of `paths.ts` has 2 or more cases.
 *
 * The job of part P of N measures each case whose index modulo N is P - 1. In each round, the A1 processes run in one
 * half and the A2 processes in the other half, in the opposite order. The halves change places in each second round.
 * The case order and the places of the IN ORDER and the GROUP processes turn in each round.
 *
 * The verdict of the split is the verdict of the bench (`merge.ts`, D114): `timeVerdict` of `@mark1russell7/rigor-bench`
 * with the rule `difference`. The pair of a case is (A1, IN ORDER) in each round, and its A/A pair is (A1, A2). The
 * verdict compares the median ratio IN ORDER / A1 with the median ratio A2 / A1. It is "same" when the bootstrap
 * interval of the difference is inside the margin of 1.5 %. A case stays in order only with "same". The interval of the
 * median is the distribution-free interval of `caseIntervals`: the 6th to the 15th of 20 sorted ratios (95.9 %). The
 * GROUP arm gets the same verdict with its pair (A1, GROUP).
 *
 * The first rule of D98 stays in the table as information, because a prediction pinned it. A process is slow when its
 * IN ORDER time is over the maximum of the A1 times of the case. A case has a mode when 5 or more of 20 are slow.
 *
 * The script prints the tables and one line `MEASURE {json}`. With `MODE_JSON`, it writes each process to that file.
 * `MODE_PART` and `MODE_PARTS` select the part, and `MODE_PROCESSES` gives the rounds. The mode `merge` reads the
 * files of all parts and prints the tables for all cases. Node removes the types of this script. The verdict job
 * installs the packages, because the script imports the bench core.
 */
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { caseIntervals, caseRatios, type PairedTime, type TimeOutcome } from "@mark1russell7/rigor-bench";
import { median } from "@mark1russell7/rigor-statistics";
import type { Measured } from "./cases.ts";
import { caseVerdict, VERDICT } from "./merge.ts";

/** A case has a mode when this number or more of its IN ORDER processes are slow (the first rule of D98). */
const MODE_LIMIT = 5;

type Arm = "alone 1" | "alone 2" | "in order" | "group";

/** The verdict of the bench core (D114). Only "same" keeps a case in order. */
type Decision = TimeOutcome;

/** The verdict of one arm against A1. */
interface Effect {
  /** The interval of the median of the ratios: the 6th to the 15th sorted value of 20. */
  readonly median: Band;
  /** The interval of the verdict: the median ratio of the arm over the median ratio A2 / A1 (D114). */
  readonly effect: Band;
  readonly decision: Decision;
}

/** One process of the mode run. */
interface ModeProcess {
  /** The place of the process in the job, from 0. */
  readonly at: number;
  readonly round: number;
  readonly arm: Arm;
  /** The measurements of the process: one case alone, each case in order, or the cases of the group. */
  readonly measured: readonly Measured[];
}

/** The times of one case in one part, in nanoseconds for one call. Item `r` of each list comes from round `r`. */
interface ModeCase {
  readonly index: number;
  readonly name: string;
  readonly calls: number;
  readonly alone: readonly number[];
  readonly alone2: readonly number[];
  readonly inOrder: readonly number[];
  /** The times in the GROUP processes, when the bench keeps the case together. */
  readonly group?: readonly number[];
  /** The results of the processes, when they do not agree. */
  readonly different?: string;
}

/** The record of one job. */
interface ModeRun {
  readonly part: number;
  readonly parts: number;
  /** The id and the attempt of the CI run, when a CI run made it. */
  readonly ci?: string | undefined;
  readonly cpu: string;
  readonly node: string;
  readonly flags: readonly string[];
  /** The cases of `TOGETHER` in `paths.ts`: the bench runs them in one process. Each other case has its own processes. */
  readonly together?: readonly string[];
  /** The cases of `SPLIT`, the list before `TOGETHER`: records of 41426813620 and 41430307699 have it. */
  readonly split?: readonly string[];
  /** The number of all cases of `cases.ts`. */
  readonly total: number;
  readonly processes: number;
  readonly seconds: number;
  readonly cases: readonly ModeCase[];
  /** Each process, in the order of the job: the raw records. */
  readonly records: readonly ModeProcess[];
}

/** The low end and the high end of an interval of ratios. */
interface Band {
  readonly low: number;
  readonly high: number;
}

/** The verdict of one case. */
interface Verdict {
  readonly index: number;
  readonly name: string;
  readonly part: number;
  readonly aloneNs: number;
  readonly aloneMaxNs: number;
  readonly inOrderNs: number;
  readonly ratio: number;
  /** The interval of the median of the ratios A2 / A1. */
  readonly aa: Band;
  /** The median of the ratios A2 / A1 minus 1. */
  readonly noise: number;
  readonly inOrder: Effect;
  /** True when the verdict is "same": the case can stay in order. */
  readonly stays: boolean;
  readonly slow: number;
  readonly of: number;
  readonly mode: boolean;
  /** True when the bench runs the case in its own processes. */
  readonly split: boolean;
  /** The GROUP arm, when the bench keeps the case together. */
  readonly group?: Effect & { readonly ns: number; readonly clean: boolean };
  readonly different?: string;
}

/** The margin of the verdict as a fraction (D114): the margin of the bench, 1.5 %. */
const MARGIN = Math.exp(VERDICT.margin ?? 0) - 1;

/**
 * This function gives the pair of one case for the bench core: arm `a` in each round, against arm `b` of the same
 * round. The times are in milliseconds. `first` names the arm in the first half of the round. In an even round, A1
 * and IN ORDER both run in the first half, thus A1 does not always start first.
 */
function pairOf(name: string, a: readonly number[], b: readonly number[]): PairedTime[] {
  return a.map((ns, round) => ({ case: name, round, first: round % 2 === 0 ? "a" : "b", a: ns / 1e6, b: (b[round] as number) / 1e6 }));
}

/** This function gives the interval of the median of one pair: `caseIntervals` of the bench core. */
function bandOf(pair: readonly PairedTime[]): Band {
  const [interval] = caseIntervals(pair);
  return { low: interval?.low ?? Number.NaN, high: interval?.high ?? Number.NaN };
}

/** This function gives the verdict of the bench core for one arm against A1, with the A/A pair (A1, A2). */
function decide(pair: readonly PairedTime[], aa: readonly PairedTime[]): Effect {
  const verdict = caseVerdict(pair, aa);
  const effect = { low: verdict.interval?.low ?? Number.NaN, high: verdict.interval?.high ?? Number.NaN };
  return { median: bandOf(pair), effect, decision: verdict.outcome };
}

function fixed(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function writeSummary(lines: readonly string[]): void {
  const text = `${lines.join("\n")}\n`;
  process.stdout.write(text);
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (file !== undefined && file !== "") appendFileSync(file, `${text}\n`);
}

/** This function applies the rules of D98 to one case. */
function judge(item: ModeCase, part: number, split: readonly string[]): Verdict {
  const aloneMaxNs = Math.max(...item.alone);
  const slow = item.inOrder.filter((ns) => ns > aloneMaxNs).length;
  const [aloneNs, inOrderNs] = [median(item.alone), median(item.inOrder)];
  const aaPair = pairOf(item.name, item.alone, item.alone2);
  const aa = bandOf(aaPair);
  const noise = (caseRatios(aaPair)[0]?.ratio ?? Number.NaN) - 1;
  const inOrder = decide(pairOf(item.name, item.alone, item.inOrder), aaPair);
  const verdict: Verdict = {
    index: item.index,
    name: item.name,
    part,
    aloneNs,
    aloneMaxNs,
    inOrderNs,
    ratio: inOrderNs / aloneNs,
    aa,
    noise,
    inOrder,
    stays: inOrder.decision === "same",
    slow,
    of: item.inOrder.length,
    mode: slow >= MODE_LIMIT,
    split: split.includes(item.name),
  };
  const group = item.group === undefined ? undefined : decide(pairOf(item.name, item.alone, item.group), aaPair);
  return {
    ...verdict,
    ...(item.group === undefined || group === undefined ? {} : { group: { ...group, ns: median(item.group), clean: group.decision === "same" } }),
    ...(item.different === undefined ? {} : { different: item.different }),
  };
}

function range(value: Band): string {
  return `${value.low.toFixed(3)} to ${value.high.toFixed(3)}`;
}

function header(): string[] {
  return [
    "The ratios of each round are against A1. The verdict is the `timeVerdict` of `@mark1russell7/rigor-bench` with the rule `difference` (D114).",
    "The interval is the bootstrap interval of the median of IN ORDER / A1 over the median of A2 / A1. The A/A column is the interval of the median of A2 / A1 (95.9 % for 20 rounds).",
    `A case stays in order only when the interval is inside the margin of ${(MARGIN * 100).toFixed(1)} %: the verdict "same".`,
    `The columns Slow and Mode give the first rule of D98 as information: ${MODE_LIMIT} or more IN ORDER times over the A1 maximum.`,
    "",
    "| Case | Part | Alone median (ns) | In order median (ns) | In order / alone | Interval | A/A | Verdict | Slow | Mode | Bench |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- |",
  ];
}

function row(verdict: Verdict): string {
  if (verdict.different !== undefined) return `| ${verdict.name} | ${verdict.part} | different results: ${verdict.different} | | | | | | | | | |`;
  const cells = [
    verdict.name,
    String(verdict.part),
    verdict.aloneNs.toFixed(1),
    verdict.inOrderNs.toFixed(1),
    verdict.ratio.toFixed(3),
    range(verdict.inOrder.effect),
    range(verdict.aa),
    verdict.inOrder.decision,
    `${verdict.slow} of ${verdict.of}`,
    verdict.mode ? "yes" : "no",
    verdict.split ? "own processes" : "in order",
  ];
  return `| ${cells.join(" | ")} |`;
}

/** This function gives the table of the GROUP arm: the cases that the bench keeps together. */
function groupTable(verdicts: readonly Verdict[]): string[] {
  const rows = verdicts.filter((verdict) => verdict.group !== undefined);
  if (rows.length === 0) return ["", "The GROUP arm did not run: `TOGETHER` has fewer than 2 cases."];
  return [
    "",
    "The GROUP arm runs only the cases that the bench keeps together, in their order. The group is clean when each case of it gets \"same\" with GROUP / A1.",
    "",
    "| Case | Part | Alone median (ns) | Group median (ns) | Interval | Verdict |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((verdict) => {
      const group = verdict.group as NonNullable<Verdict["group"]>;
      return `| ${verdict.name} | ${verdict.part} | ${verdict.aloneNs.toFixed(1)} | ${group.ns.toFixed(1)} | ${range(group.effect)} | ${group.decision} |`;
    }),
  ];
}

/** This function gives a line for each case where the verdict and `TOGETHER` of `paths.ts` do not agree. */
function disagree(verdicts: readonly Verdict[]): string[] {
  const join = verdicts.filter((verdict) => verdict.split && verdict.stays).map((verdict) => verdict.name);
  const leave = verdicts.filter((verdict) => !verdict.split && !verdict.stays).map((verdict) => verdict.name);
  const lines: string[] = [];
  if (leave.length > 0) lines.push("", `The bench runs these cases in order, but the verdict splits them: ${leave.join(", ")}. Remove them from \`TOGETHER\`.`);
  if (join.length > 0) lines.push("", `The verdict keeps these cases in order: ${join.join(", ")}. The bench can add them to \`TOGETHER\`.`);
  return lines;
}

function short(verdict: Verdict): Record<string, unknown> {
  const two = (value: Band): number[] => [fixed(value.low, 3), fixed(value.high, 3)];
  return {
    index: verdict.index,
    name: verdict.name,
    aloneNs: fixed(verdict.aloneNs),
    inOrderNs: fixed(verdict.inOrderNs),
    ratio: fixed(verdict.ratio, 3),
    median: two(verdict.inOrder.median),
    effect: two(verdict.inOrder.effect),
    aa: two(verdict.aa),
    margin: fixed(MARGIN, 4),
    decision: verdict.inOrder.decision,
    stays: verdict.stays,
    slow: verdict.slow,
    mode: verdict.mode,
    split: verdict.split,
    ...(verdict.group === undefined ? {} : { group: { ns: fixed(verdict.group.ns), effect: two(verdict.group.effect), decision: verdict.group.decision, clean: verdict.group.clean } }),
  };
}

/** This function gives the cases of a run that the bench runs in their own processes, also from a record with `SPLIT`. */
function splitOf(run: ModeRun): readonly string[] {
  if (run.together !== undefined) return run.cases.map((item) => item.name).filter((name) => !(run.together as readonly string[]).includes(name));
  return run.split ?? [];
}

function whole(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a whole number of 1 or more.`);
  return value;
}

/** A slot of a round: one ALONE process of a case, or one process of the arm IN ORDER or GROUP. */
type Slot = { readonly arm: "alone 1"; readonly index: number } | { readonly arm: "alone 2"; readonly index: number } | { readonly arm: "in order" } | { readonly arm: "group" };

async function measure(): Promise<void> {
  const [headFile] = process.argv.slice(2);
  if (headFile === undefined) throw new Error("Give the index.ts of the head.");
  // The bundler is a package. Only this mode imports it, thus the mode merge needs only the modules of Node.
  const { FLAGS, TOGETHER, bundle, groups, measureCopy } = await import("./paths.ts");
  const started = performance.now();
  const part = whole("MODE_PART", 1);
  const parts = whole("MODE_PARTS", 1);
  const processes = whole("MODE_PROCESSES", 20);
  if (part > parts) throw new Error("MODE_PART must not be more than MODE_PARTS.");
  const file = await bundle(headFile, "head", mkdtempSync(join(tmpdir(), "coeval-mode-")));
  // A first process calibrates the calls of each sample, thus each process does the same work. Its times do not count.
  const first = measureCopy(file);
  const counts = first.map((item) => item.calls);
  const names = first.map((item) => item.name);
  // The cases that the bench keeps together: the first group of `groups`, when it has the cases of TOGETHER. A group
  // needs 2 or more cases, because a group of 1 case is the arm ALONE.
  const kept = groups(names)[0]?.filter((index) => TOGETHER.includes(names[index] as string)) ?? [];
  const together = kept.length >= 2 ? kept : [];
  const mine = names.map((_, index) => index).filter((index) => index % parts === part - 1);
  const times = new Map<string, Measured[]>();
  const add = (arm: Arm, index: number, measured: Measured): void => {
    const key = `${arm} ${index}`;
    times.set(key, [...(times.get(key) ?? []), measured]);
  };
  const records: ModeProcess[] = [];
  for (let round = 0; round < processes; round += 1) {
    const order = mine.map((_, place) => mine[(place + round) % mine.length] as number);
    const [one, two] = round % 2 === 0 ? (["alone 1", "alone 2"] as const) : (["alone 2", "alone 1"] as const);
    const firstHalf: Slot[] = order.map((index) => ({ arm: one, index }));
    const secondHalf: Slot[] = [...order].reverse().map((index) => ({ arm: two, index }));
    firstHalf.splice(round % (firstHalf.length + 1), 0, { arm: "in order" });
    if (together.length > 0) secondHalf.splice(round % (secondHalf.length + 1), 0, { arm: "group" });
    for (const slot of [...firstHalf, ...secondHalf]) {
      let measured: Measured[];
      if (slot.arm === "in order") {
        measured = measureCopy(file, counts);
        mine.forEach((index) => add(slot.arm, index, measured[index] as Measured));
      } else if (slot.arm === "group") {
        measured = measureCopy(file, counts, together);
        together.forEach((index, place) => add(slot.arm, index, measured[place] as Measured));
      } else {
        measured = measureCopy(file, counts, [slot.index]);
        add(slot.arm, slot.index, measured[0] as Measured);
      }
      records.push({ at: records.length, round, arm: slot.arm, measured });
    }
  }
  const cases: ModeCase[] = mine.map((index) => {
    const of = (arm: Arm): Measured[] => times.get(`${arm} ${index}`) ?? [];
    const all = [...of("alone 1"), ...of("alone 2"), ...of("in order"), ...of("group")];
    const results = new Set([(first[index] as Measured).result, ...all.map((item) => item.result)]);
    const ns = (arm: Arm): number[] => of(arm).map((measured) => measured.ns);
    const item: ModeCase = {
      index,
      name: names[index] as string,
      calls: counts[index] as number,
      alone: ns("alone 1"),
      alone2: ns("alone 2"),
      inOrder: ns("in order"),
      ...(together.includes(index) ? { group: ns("group") } : {}),
    };
    return results.size === 1 ? item : { ...item, different: [...results].join(" and ") };
  });
  const run: ModeRun = {
    part,
    parts,
    ci: process.env["GITHUB_RUN_ID"] === undefined ? undefined : `${process.env["GITHUB_RUN_ID"]}/${process.env["GITHUB_RUN_ATTEMPT"] ?? "1"}`,
    // On Linux, Node reads the model of the CPU from /proc/cpuinfo.
    cpu: cpus()[0]?.model.trim() ?? "an unknown CPU",
    node: process.version,
    flags: FLAGS,
    together: TOGETHER,
    total: first.length,
    processes,
    seconds: fixed((performance.now() - started) / 1000),
    cases,
    records,
  };
  const verdicts = cases.map((item) => judge(item, part, splitOf(run)));
  writeSummary([
    `### Mode run, part ${part} of ${parts}`,
    "",
    `${run.cpu}, Node ${run.node} with \`${FLAGS.join(" ")}\`. ${processes} rounds, ${records.length} processes. The part took ${run.seconds} s.`,
    "",
    ...header(),
    ...verdicts.map(row),
    ...groupTable(verdicts),
    ...disagree(verdicts),
  ]);
  process.stdout.write(`MEASURE ${JSON.stringify({ id: "BENCH.MODE", part, parts, ci: run.ci, cpu: run.cpu, processes, seconds: run.seconds, cases: verdicts.map(short) })}\n`);
  const out = process.env["MODE_JSON"];
  if (out !== undefined && out !== "") writeFileSync(out, `${JSON.stringify(run)}\n`);
  if (verdicts.some((verdict) => verdict.different !== undefined)) process.exitCode = 1;
}

/** This function reads the records of all parts and prints the tables for all cases. */
function merge(files: readonly string[]): void {
  if (files.length === 0) throw new Error("Give the JSON files of the parts.");
  const runs = files.map((file) => JSON.parse(readFileSync(file, "utf8")) as ModeRun);
  const total = runs[0]?.total ?? 0;
  const verdicts = runs.flatMap((run) => run.cases.map((item) => judge(item, run.part, splitOf(run)))).sort((a, b) => a.index - b.index);
  const missing: number[] = [];
  for (let index = 0; index < total; index += 1) {
    const found = verdicts.filter((verdict) => verdict.index === index).length;
    if (found !== 1) missing.push(index);
  }
  const splits = verdicts.filter((verdict) => !verdict.stays);
  const lines = [
    `### Mode verdict of ${runs.length} parts`,
    "",
    "| Part | CI run | CPU | Cases | Processes | Time (s) |",
    "| ---: | --- | --- | ---: | ---: | ---: |",
    ...[...runs].sort((a, b) => a.part - b.part).map((run) => `| ${run.part} of ${run.parts} | ${run.ci ?? "local"} | ${run.cpu} | ${run.cases.length} | ${run.records.length} | ${run.seconds} |`),
    "",
    ...header(),
    ...verdicts.map(row),
    ...groupTable(verdicts),
    "",
    `The verdict splits ${splits.length} of ${verdicts.length} cases: ${splits.map((verdict) => verdict.name).join(", ")}.`,
    ...disagree(verdicts),
  ];
  if (missing.length > 0) lines.push("", `The parts do not give each case one time. The cases ${missing.join(", ")} have no row or more than one row.`);
  writeSummary(lines);
  const stays = verdicts.filter((verdict) => verdict.stays).map((verdict) => verdict.name);
  process.stdout.write(`MEASURE ${JSON.stringify({ id: "BENCH.MODE", parts: runs.map((run) => run.part), ci: runs[0]?.ci, stays, cases: verdicts.map(short) })}\n`);
  if (missing.length > 0 || total === 0 || verdicts.some((verdict) => verdict.different !== undefined)) process.exitCode = 1;
}

if (process.argv[2] === "merge") merge(process.argv.slice(3));
else await measure();
