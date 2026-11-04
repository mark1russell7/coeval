/*
 * The levels of one case: the time of each process, on the base and on the head, as a histogram.
 *
 *   pnpm exec tsx packages/core/bench/levels.ts <base src/index.ts> <head src/index.ts>
 *
 * The bench of `paths.ts` gives one median for each round. A case with two levels in different processes gives a median
 * that depends on the level that the most processes reach. This script keeps each process, thus a histogram shows if
 * the base, the head or both arms have two levels. It gives no verdict, and no gate reads it.
 *
 * Each round starts one new process of each arm: the base, the head and a second copy of the base (A/A). The order of
 * the arms turns in each round. Each process uses the flags of the bench and the same calls for each sample.
 *
 * `LEVELS_CASE` names the case, `LEVELS_ROUNDS` gives the rounds and `LEVELS_JSON` is the file for the records of each
 * process. `BENCH_WARMUP`, `BENCH_SAMPLES` and `BENCH_MS` work as in the bench.
 */
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { median } from "@mark1russell7/rigor-statistics";
import { bundle, measureCopy } from "./paths.ts";
import { SAMPLES, TARGET_MS, WARMUP } from "./settings.ts";

const CASE = process.env["LEVELS_CASE"] ?? "the same tree, with a list of reads";
const ROUNDS = Number(process.env["LEVELS_ROUNDS"] ?? 40);
/** The width of one bar of the histogram, in percent of the median of the base. */
const STEP = 2.5;

/** The record of one process. */
interface Process {
  readonly arm: string;
  readonly round: number;
  /** The median of the counted samples, in nanoseconds for one call. */
  readonly ns: number;
  /** Each sample of the process in order, with the warmup, in nanoseconds for one call. */
  readonly samples: readonly number[];
}

/** This function gives the arms of a round. The order turns in each round. */
function armsOf(round: number): readonly string[] {
  const arms = ["base", "head", "aa"];
  const start = round % arms.length;
  return [...arms.slice(start), ...arms.slice(0, start)];
}

/** This function gives the lines of the histogram: one row for each bar that has a process. */
function histogram(processes: readonly Process[], center: number, step: number = STEP): string[] {
  const barOf = (ns: number): number => Math.floor(((ns / center - 1) * 100) / step);
  const bars = [...new Set(processes.map((item) => barOf(item.ns)))].sort((a, b) => a - b);
  const count = (arm: string, bar: number): number => processes.filter((item) => item.arm === arm && barOf(item.ns) === bar).length;
  const row = (bar: number): string => {
    const label = `${bar * step >= 0 ? "+" : ""}${(bar * step).toFixed(1)} %`;
    return `| ${label} | ${count("base", bar)} | ${count("aa", bar)} | ${count("head", bar)} |`;
  };
  return ["| Start of the bar | Base | A/A | Head |", "| ---: | ---: | ---: | ---: |", ...bars.map(row)];
}

async function main(): Promise<void> {
  const [baseFile, headFile] = process.argv.slice(2);
  if (baseFile === undefined || headFile === undefined) throw new Error("Give the index.ts of the base and of the head.");
  const dir = mkdtempSync(join(tmpdir(), "coeval-levels-"));
  const copies: Readonly<Record<string, string>> = {
    base: await bundle(baseFile, "base", dir),
    head: await bundle(headFile, "head", dir),
    aa: await bundle(baseFile, "aa", dir),
  };
  // A first process calibrates the calls of each sample, as in the bench. Its times do not count.
  const first = measureCopy(copies["base"] as string);
  const index = first.findIndex((item) => item.name === CASE);
  if (index < 0) throw new Error(`The bench has no case with the name ${CASE}.`);
  const counts = first.map((item) => item.calls);
  const processes: Process[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    for (const arm of armsOf(round)) {
      const [measured] = measureCopy(copies[arm] as string, counts, [index]);
      if (measured === undefined) throw new Error("The process gave no measurement.");
      processes.push({ arm, round, ns: measured.ns, samples: measured.samples });
    }
  }
  const timesOf = (arm: string): number[] => processes.filter((item) => item.arm === arm).map((item) => item.ns);
  const center = median(timesOf("base"));
  const text = [
    `Case: ${CASE}.`,
    `Node ${process.version}, ${ROUNDS} rounds, ${WARMUP} warmup and ${SAMPLES} counted samples of ${TARGET_MS} ms.`,
    `The medians are ${center.toFixed(1)} ns for the base, ${median(timesOf("aa")).toFixed(1)} ns for the A/A copy and ${median(timesOf("head")).toFixed(1)} ns for the head.`,
    "",
    ...histogram(processes, center),
  ].join("\n");
  console.log(text);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary !== undefined && summary !== "") appendFileSync(summary, `## The levels of one case\n\n${text}\n`);
  const json = process.env["LEVELS_JSON"];
  if (json !== undefined && json !== "") writeFileSync(json, `${JSON.stringify({ case: CASE, node: process.version, calls: counts[index], processes }, null, 2)}\n`);
}

await main();
