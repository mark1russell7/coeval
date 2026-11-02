/*
 * The mode run of the bench: each case alone against the same case in the order of `cases.ts` (K210, D98).
 *
 *   pnpm exec tsx packages/core/bench/mode.ts <head src/index.ts>
 *   node packages/core/bench/mode.ts merge <part 1 JSON> <part 2 JSON> ...
 *
 * The bench of `paths.ts` runs all cases of `cases.ts` in one process, in a fixed order. Thus a later case runs on the
 * heap and the type feedback of the earlier cases. V8 can tenure an allocation site in a later case, and that case is
 * then slow in some processes only. The A/A arm of the bench does not show such a mode, because both copies of the
 * base have the same order.
 *
 * This script compares two arms for each case, with the head kernel only. In the arm ALONE, a new process runs only
 * that case. In the arm IN ORDER, a new process runs all cases in the order of `cases.ts`, and the time of the case
 * comes from that process. Each process uses the flags of `paths.ts`, and a first process calibrates the calls of
 * each sample, as in the bench.
 *
 * The job of part P of N measures each case whose index modulo N is P - 1. The job has rounds. Each round runs one
 * IN ORDER process and one ALONE process for each case of the part. The place of the IN ORDER process and the order of
 * the cases turn by one place in each round. Thus the two arms alternate, and no arm gets the start of a round more
 * often.
 *
 * The definitions are fixed (D98). A process is slow for a case when its IN ORDER time is over the maximum of the
 * ALONE times of that case. A case has a mode when 5 or more of its 20 IN ORDER processes are slow. With no mode, each
 * IN ORDER process is over the maximum of 20 ALONE times with the probability 1/21. Then 5 or more slow processes of
 * 20 have a probability under 0.5 %.
 *
 * The script prints one table and one line `MEASURE {json}`. With `MODE_JSON`, it writes each process to that file.
 * `MODE_PART` and `MODE_PARTS` select the part, and `MODE_PROCESSES` gives the processes of each arm. The mode `merge`
 * reads the files of all parts and prints one table for all cases. That mode uses only the modules of Node, and Node
 * removes its types. Thus the verdict job does not install the packages.
 */
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import type { Measured } from "./cases.ts";

/** A case has a mode when this number or more of its IN ORDER processes are slow. */
const MODE_LIMIT = 5;

/** One process of the mode run. */
interface ModeProcess {
  /** The place of the process in the job, from 0. */
  readonly at: number;
  readonly arm: "alone" | "in order";
  /** The measurements of the process: one case alone, or each case in order. */
  readonly measured: readonly Measured[];
}

/** The summary of one case in one part. */
interface ModeCase {
  readonly index: number;
  readonly name: string;
  readonly calls: number;
  /** The time of one call in each ALONE process, in nanoseconds. */
  readonly alone: readonly number[];
  /** The time of one call of the case in each IN ORDER process, in nanoseconds. */
  readonly inOrder: readonly number[];
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
  /** The number of all cases of `cases.ts`. */
  readonly total: number;
  readonly processes: number;
  readonly seconds: number;
  readonly cases: readonly ModeCase[];
  /** Each process, in the order of the job: the raw records. */
  readonly records: readonly ModeProcess[];
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
  readonly slow: number;
  readonly of: number;
  readonly mode: boolean;
  readonly different?: string;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
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

/** This function applies the fixed definitions of D98 to one case. */
function judge(item: ModeCase, part: number): Verdict {
  const aloneMaxNs = Math.max(...item.alone);
  const slow = item.inOrder.filter((ns) => ns > aloneMaxNs).length;
  const [aloneNs, inOrderNs] = [median(item.alone), median(item.inOrder)];
  const verdict = { index: item.index, name: item.name, part, aloneNs, aloneMaxNs, inOrderNs, ratio: inOrderNs / aloneNs, slow, of: item.inOrder.length };
  return { ...verdict, mode: slow >= MODE_LIMIT, ...(item.different === undefined ? {} : { different: item.different }) };
}

function header(): string[] {
  return [
    `A process is slow when its IN ORDER time is over the ALONE maximum. A case has a mode when ${MODE_LIMIT} or more IN ORDER processes are slow.`,
    "",
    "| Case | Part | Alone median (ns) | Alone max (ns) | In order median (ns) | In order / alone | Slow | Mode |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
}

function row(verdict: Verdict): string {
  if (verdict.different !== undefined) return `| ${verdict.name} | ${verdict.part} | different results: ${verdict.different} | | | | | |`;
  const ratio = `${verdict.ratio.toFixed(3)}`;
  return `| ${verdict.name} | ${verdict.part} | ${verdict.aloneNs.toFixed(1)} | ${verdict.aloneMaxNs.toFixed(1)} | ${verdict.inOrderNs.toFixed(1)} | ${ratio} | ${verdict.slow} of ${verdict.of} | ${verdict.mode ? "yes" : "no"} |`;
}

function short(verdict: Verdict): Record<string, unknown> {
  return {
    index: verdict.index,
    name: verdict.name,
    aloneNs: fixed(verdict.aloneNs),
    aloneMaxNs: fixed(verdict.aloneMaxNs),
    inOrderNs: fixed(verdict.inOrderNs),
    ratio: fixed(verdict.ratio, 3),
    slow: verdict.slow,
    of: verdict.of,
    mode: verdict.mode,
  };
}

function whole(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a whole number of 1 or more.`);
  return value;
}

async function measure(): Promise<void> {
  const [headFile] = process.argv.slice(2);
  if (headFile === undefined) throw new Error("Give the index.ts of the head.");
  // The bundler is a package. Only this mode imports it, thus the mode merge needs only the modules of Node.
  const { FLAGS, bundle, measureCopy } = await import("./paths.ts");
  const started = performance.now();
  const part = whole("MODE_PART", 1);
  const parts = whole("MODE_PARTS", 1);
  const processes = whole("MODE_PROCESSES", 20);
  if (part > parts) throw new Error("MODE_PART must not be more than MODE_PARTS.");
  const file = await bundle(headFile, "head", mkdtempSync(join(tmpdir(), "coeval-mode-")));
  // A first process calibrates the calls of each sample, thus each process does the same work. Its times do not count.
  const first = measureCopy(file);
  const counts = first.map((item) => item.calls);
  const mine = first.map((_, index) => index).filter((index) => index % parts === part - 1);
  const alone = new Map<number, Measured[]>(mine.map((index) => [index, []]));
  const inOrder: Measured[][] = [];
  const records: ModeProcess[] = [];
  for (let round = 0; round < processes; round += 1) {
    const order = mine.map((_, place) => mine[(place + round) % mine.length] as number);
    // The slots of the round: -1 is the IN ORDER process, and each other slot is the index of a case alone.
    const slots: number[] = [...order];
    slots.splice(round % (mine.length + 1), 0, -1);
    for (const slot of slots) {
      const measured = slot === -1 ? measureCopy(file, counts) : measureCopy(file, counts, slot);
      if (slot === -1) inOrder.push(measured);
      else (alone.get(slot) as Measured[]).push(measured[0] as Measured);
      records.push({ at: records.length, arm: slot === -1 ? "in order" : "alone", measured });
    }
  }
  const cases: ModeCase[] = mine.map((index) => {
    const ownAlone = alone.get(index) as Measured[];
    const ownInOrder = inOrder.map((measured) => measured[index] as Measured);
    const results = new Set([(first[index] as Measured).result, ...[...ownAlone, ...ownInOrder].map((item) => item.result)]);
    const item = {
      index,
      name: (first[index] as Measured).name,
      calls: counts[index] as number,
      alone: ownAlone.map((measured) => measured.ns),
      inOrder: ownInOrder.map((measured) => measured.ns),
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
    total: first.length,
    processes,
    seconds: fixed((performance.now() - started) / 1000),
    cases,
    records,
  };
  const verdicts = cases.map((item) => judge(item, part));
  writeSummary([
    `### Mode run, part ${part} of ${parts}`,
    "",
    `${run.cpu}, Node ${run.node} with \`${FLAGS.join(" ")}\`. ${processes} ALONE processes for each case and ${processes} IN ORDER processes. The part took ${run.seconds} s.`,
    "",
    ...header(),
    ...verdicts.map(row),
  ]);
  process.stdout.write(`MEASURE ${JSON.stringify({ id: "BENCH.MODE", part, parts, ci: run.ci, cpu: run.cpu, processes, seconds: run.seconds, cases: verdicts.map(short) })}\n`);
  const out = process.env["MODE_JSON"];
  if (out !== undefined && out !== "") writeFileSync(out, `${JSON.stringify(run)}\n`);
  if (verdicts.some((verdict) => verdict.different !== undefined)) process.exitCode = 1;
}

/** This function reads the records of all parts and prints one table for all cases. */
function merge(files: readonly string[]): void {
  if (files.length === 0) throw new Error("Give the JSON files of the parts.");
  const runs = files.map((file) => JSON.parse(readFileSync(file, "utf8")) as ModeRun);
  const total = runs[0]?.total ?? 0;
  const verdicts = runs.flatMap((run) => run.cases.map((item) => judge(item, run.part))).sort((a, b) => a.index - b.index);
  const missing: number[] = [];
  for (let index = 0; index < total; index += 1) {
    const found = verdicts.filter((verdict) => verdict.index === index).length;
    if (found !== 1) missing.push(index);
  }
  const modes = verdicts.filter((verdict) => verdict.mode);
  const lines = [
    `### Mode verdict of ${runs.length} parts`,
    "",
    "| Part | CI run | CPU | Cases | Time (s) |",
    "| ---: | --- | --- | ---: | ---: |",
    ...[...runs].sort((a, b) => a.part - b.part).map((run) => `| ${run.part} of ${run.parts} | ${run.ci ?? "local"} | ${run.cpu} | ${run.cases.length} | ${run.seconds} |`),
    "",
    ...header(),
    ...verdicts.map(row),
    "",
    modes.length === 0 ? "No case has a mode." : `The cases with a mode: ${modes.map((verdict) => verdict.name).join(", ")}.`,
  ];
  if (missing.length > 0) lines.push(`The parts do not give each case one time. The cases ${missing.join(", ")} have no row or more than one row.`);
  writeSummary(lines);
  process.stdout.write(`MEASURE ${JSON.stringify({ id: "BENCH.MODE", parts: runs.map((run) => run.part), ci: runs[0]?.ci, modes: modes.map((verdict) => verdict.name), cases: verdicts.map(short) })}\n`);
  if (missing.length > 0 || total === 0 || verdicts.some((verdict) => verdict.different !== undefined)) process.exitCode = 1;
}

if (process.argv[2] === "merge") merge(process.argv.slice(3));
else await measure();
