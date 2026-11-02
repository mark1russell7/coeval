/*
 * The speed of plans and paths: the base and the head, each copy in its own processes (K12, D29, K101).
 *
 *   pnpm exec tsx packages/core/bench/paths.ts <base src/index.ts> <head src/index.ts>
 *
 * The script bundles `cases.ts` three times: with the base, with the base again and with the head. Each round runs
 * each bundle in new processes, thus no copy shares its compiled code, its type feedback or its heap with another copy.
 * The order of the three copies changes in each round, and each order comes equally often.
 *
 * The script prints the median time of one call for each case and each copy. The change is the median ratio of the
 * head to the base in the same round. The noise (A/A) is the same ratio for the second copy of the base: the change
 * between two copies of the same code. A change that is not clearly larger than the noise is noise. The script asserts
 * only that the copies give the same results. The workflow `bench.yml` runs it in CI, because a shared machine gives
 * unreliable numbers.
 *
 * The workflow starts the script in two jobs, thus on two runners (K167, D71). With `BENCH_JSON`, the script also
 * writes its table as JSON to that file, and `merge.ts` gives the verdict of the two runs. `BENCH_RUN` names the run.
 *
 * Why new processes and flags (K101). V8 compiles hot code on background threads, and its garbage collector sizes the
 * heap from measured times. Thus two compilations of the same code can differ in speed by 10 % or more. Before K101,
 * the two copies ran in one process: each copy kept one compilation for all its rounds, and the two copies shared one
 * heap. Identical code then showed changes of up to 11 %, in random cases and in both directions, and more rounds did
 * not remove them. Now each round compiles each copy again, and `FLAGS` make the compiler and the collector run at
 * fixed points. In CI, two copies of the same code then differ by less than 1 % in each case.
 *
 * Why each case has its own processes (K210, D98). A case that runs after other cases in one process gets their heap
 * and their type feedback. The mode run `mode.ts` found cases that were up to 1.9 times slower or 0.8 times faster
 * there than alone. Thus each case runs alone in its own processes by default. Only the cases of `TOGETHER` run in
 * one process, in order. Each group of cases runs for the three copies in the order of the round, before the next
 * group starts.
 *
 * Each copy is an esbuild bundle without `keepNames`, as the bundler of a host makes it. The loader of tsx keeps the
 * name of each function, and that adds a call at each closure that the kernel makes.
 */
import { build, type Plugin } from "esbuild";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join, resolve as resolveFile } from "node:path";
import { fileURLToPath } from "node:url";
import type { Measured } from "./cases.ts";
import type { BenchCase, BenchMode, BenchRun } from "./merge.ts";
import { SAMPLES, TARGET_MS, WARMUP } from "./settings.ts";

/** The rounds. A local smoke test can make them small, for example `BENCH_ROUNDS=1 BENCH_SAMPLES=1`. */
const ROUNDS = Number(process.env["BENCH_ROUNDS"] ?? 12);

/**
 * The flags of V8 for each process. `--predictable` compiles and collects on the main thread only, and
 * `--predictable-gc-schedule` grows the heap by fixed steps. Without them, one case of identical code took from 270 ns
 * to 760 ns in different processes.
 */
export const FLAGS = ["--predictable", "--predictable-gc-schedule"] as const;

/**
 * The cases that run together in one process, in order (D98). Each other case runs alone in its own processes. A case
 * joins this list only when a mode run with enough processes for the budget gives it the verdict "no change". The
 * mode run 41430307699 had 20 processes for each arm, too few for that verdict. Thus the list is empty.
 */
export const TOGETHER: readonly string[] = [];

/** This function gives the groups of case indexes: the cases of `TOGETHER` in one group, then each other case. */
export function groups(names: readonly string[]): number[][] {
  const absent = TOGETHER.filter((name) => !names.includes(name));
  if (absent.length > 0) throw new Error(`TOGETHER names cases that cases.ts does not have: ${absent.join(", ")}.`);
  const together = names.flatMap((name, index) => (TOGETHER.includes(name) ? [index] : []));
  const alone = names.flatMap((name, index) => (TOGETHER.includes(name) ? [] : [[index]]));
  return [...(together.length > 0 ? [together] : []), ...alone];
}

/** The six orders of the three copies: the base, the base again and the head. */
const ORDERS = [
  [0, 1, 2],
  [1, 2, 0],
  [2, 0, 1],
  [0, 2, 1],
  [2, 1, 0],
  [1, 0, 2],
] as const;

const CASES_FILE = fileURLToPath(new URL("./cases.ts", import.meta.url));

/** This function bundles the cases with one copy of the kernel. */
export async function bundle(kernelFile: string, name: string, dir: string): Promise<string> {
  const outfile = join(dir, `${name}.mjs`);
  const kernel = resolveFile(kernelFile);
  const copy: Plugin = {
    name: "copy-of-the-kernel",
    setup(builder) {
      builder.onResolve({ filter: /^\.\.\/src\/index\.ts$/ }, (args) => (resolveFile(args.importer) === CASES_FILE ? { path: kernel } : undefined));
    },
  };
  await build({ entryPoints: [CASES_FILE], bundle: true, format: "esm", platform: "node", target: "node22", outfile, logLevel: "error", plugins: [copy] });
  return outfile;
}

/** This function runs one bundle in a new process, and gives its measurements. With `only`, the process runs those cases. */
export function measureCopy(file: string, counts?: readonly number[], only?: readonly number[]): Measured[] {
  if (only !== undefined && counts === undefined) throw new Error("Give the calls of each case with some cases.");
  const args = [...FLAGS, file, "measure", ...(counts === undefined ? [] : [JSON.stringify(counts)]), ...(only === undefined ? [] : [JSON.stringify(only)])];
  const child = spawnSync(process.execPath, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (child.status !== 0) throw new Error(`The process of ${file} stopped with the status ${String(child.status)}.`);
  return JSON.parse(child.stdout) as Measured[];
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function percent(ratio: number): string {
  const change = (ratio - 1) * 100;
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)} %`;
}

async function main(): Promise<void> {
  const [baseFile, headFile] = process.argv.slice(2);
  if (baseFile === undefined || headFile === undefined) throw new Error("Give the index.ts of the base and of the head.");
  const dir = mkdtempSync(join(tmpdir(), "coeval-bench-"));
  const copies = [await bundle(baseFile, "base", dir), await bundle(baseFile, "base-again", dir), await bundle(headFile, "head", dir)];
  // A first process calibrates the calls of each sample, thus each copy does the same work. Its times do not count.
  const first = measureCopy(copies[0] as string);
  const counts = first.map((item) => item.calls);
  const parts = groups(first.map((item) => item.name));
  // runs[copy][round][case]
  const runs: Measured[][][] = [[], [], []];
  for (let round = 0; round < ROUNDS; round += 1) {
    const measured: Measured[][] = [[], [], []];
    for (const part of parts) {
      for (const which of ORDERS[round % ORDERS.length] as readonly number[]) {
        const items = measureCopy(copies[which] as string, counts, part);
        part.forEach((index, place) => ((measured[which] as Measured[])[index] = items[place] as Measured));
      }
    }
    measured.forEach((copy, which) => (runs[which] as Measured[][]).push(copy));
  }
  const run = process.env["BENCH_RUN"] ?? "1";
  // On Linux, Node reads the model of the CPU from /proc/cpuinfo.
  const cpu = cpus()[0]?.model.trim() ?? "an unknown CPU";
  const mode: BenchMode = { flags: FLAGS, warmup: WARMUP, samples: SAMPLES, sampleMs: TARGET_MS, together: TOGETHER };
  const cases: BenchCase[] = [];
  const lines: string[] = [
    `Run ${run} on ${cpu}.`,
    `Node ${process.version} with \`${FLAGS.join(" ")}\`, ${ROUNDS} rounds. In each round, the base, a second copy of the base and the head each run in new processes.`,
    `Each process gives ${WARMUP} warmup and ${SAMPLES} counted samples of ${TARGET_MS} ms for each case.`,
    `Each case runs alone in its own processes (D98), except the ${TOGETHER.length} cases of \`TOGETHER\`, which run in one process, in order.`,
    "The change compares the head with the base of the same round. The noise (A/A) compares the two copies of the base.",
    "A change that is not clearly larger than the noise of its case is noise.",
    "",
    "| Case | Base (ns) | Head (ns) | Change | Noise (A/A) |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  let mismatch = false;
  first.forEach((item, index) => {
    const at = (which: number): Measured[] => (runs[which] as Measured[][]).map((measured) => measured[index] as Measured);
    const [base, again, head] = [at(0), at(1), at(2)];
    const results = new Set([item.result, ...[...base, ...again, ...head].map((measured) => measured.result)]);
    if (results.size !== 1) {
      mismatch = true;
      const different = [...results].join(" and ");
      cases.push({ name: item.name, baseNs: 0, headNs: 0, change: 0, noise: 0, different });
      lines.push(`| ${item.name} | different results: ${different} | | | |`);
      return;
    }
    const ratio = (copy: readonly Measured[]): number => median(copy.map((measured, round) => measured.ns / (base[round] as Measured).ns));
    const ns = (copy: readonly Measured[]): number => median(copy.map((measured) => measured.ns));
    const [baseNs, headNs, change, noise] = [ns(base), ns(head), ratio(head), ratio(again)];
    cases.push({ name: item.name, baseNs, headNs, change: (change - 1) * 100, noise: (noise - 1) * 100 });
    lines.push(`| ${item.name} | ${baseNs.toFixed(1)} | ${headNs.toFixed(1)} | ${percent(change)} | ${percent(noise)} |`);
  });
  const text = lines.join("\n");
  console.log(text);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary !== undefined && summary !== "") appendFileSync(summary, `## The speed of plans and paths (run ${run})\n\n${text}\n`);
  const json = process.env["BENCH_JSON"];
  if (json !== undefined && json !== "") {
    const record: BenchRun = { run, cpu, node: process.version, rounds: ROUNDS, mode, cases };
    writeFileSync(json, `${JSON.stringify(record, null, 2)}\n`);
  }
  if (mismatch) process.exitCode = 1;
}

// The mode run `mode.ts` imports the functions of this file, and only a start of this file runs the bench.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) await main();
