/*
 * The speed of plans and paths: the base and the head, each copy in its own processes (K12, D29, K101).
 *
 *   pnpm exec tsx packages/core/bench/paths.ts <base src/index.ts> <head src/index.ts>
 *
 * The script bundles `cases.ts` three times: with the base, with the base again and with the head. Each round runs
 * each bundle in a new process, thus no copy shares its compiled code, its type feedback or its heap with another copy.
 * The order of the three copies changes in each round, and each order comes equally often.
 *
 * The script prints the median time of one call for each case and each copy. The change is the median ratio of the
 * head to the base in the same round. The noise (A/A) is the same ratio for the second copy of the base: the change
 * between two copies of the same code. A change that is not clearly larger than the noise is noise. The script asserts
 * only that the copies give the same results. The workflow `bench.yml` runs it in CI, because a shared machine gives
 * unreliable numbers.
 *
 * Why new processes and flags (K101). V8 compiles hot code on background threads, and its garbage collector sizes the
 * heap from measured times. Thus two compilations of the same code can differ in speed by 10 % or more. Before K101,
 * the two copies ran in one process: each copy kept one compilation for all its rounds, and the two copies shared one
 * heap. Identical code then showed changes of up to 11 %, in random cases and in both directions, and more rounds did
 * not remove them. Now each round compiles each copy again, and `FLAGS` make the compiler and the collector run at
 * fixed points. In CI, two copies of the same code then differ by less than 1 % in each case.
 *
 * Each copy is an esbuild bundle without `keepNames`, as the bundler of a host makes it. The loader of tsx keeps the
 * name of each function, and that adds a call at each closure that the kernel makes.
 */
import { build, type Plugin } from "esbuild";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolveFile } from "node:path";
import { fileURLToPath } from "node:url";
import type { Measured } from "./cases.ts";

/** The rounds. A local smoke test can make them small, for example `BENCH_ROUNDS=1 BENCH_SAMPLES=1`. */
const ROUNDS = Number(process.env["BENCH_ROUNDS"] ?? 12);

/**
 * The flags of V8 for each process. `--predictable` compiles and collects on the main thread only, and
 * `--predictable-gc-schedule` grows the heap by fixed steps. Without them, one case of identical code took from 270 ns
 * to 760 ns in different processes.
 */
const FLAGS = ["--predictable", "--predictable-gc-schedule"] as const;

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
async function bundle(kernelFile: string, name: string, dir: string): Promise<string> {
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

/** This function runs one bundle in a new process, and gives its measurements. */
function measureCopy(file: string, counts?: readonly number[]): Measured[] {
  const args = [...FLAGS, file, "measure", ...(counts === undefined ? [] : [JSON.stringify(counts)])];
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
  // runs[copy][round][case]
  const runs: Measured[][][] = [[], [], []];
  for (let round = 0; round < ROUNDS; round += 1) {
    for (const which of ORDERS[round % ORDERS.length] as readonly number[]) {
      (runs[which] as Measured[][]).push(measureCopy(copies[which] as string, counts));
    }
  }
  const lines: string[] = [
    `Node ${process.version} with \`${FLAGS.join(" ")}\`, ${ROUNDS} rounds. In each round, the base, a second copy of the base and the head each run in a new process.`,
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
      lines.push(`| ${item.name} | different results: ${[...results].join(" and ")} | | | |`);
      return;
    }
    const ratio = (copy: readonly Measured[]): number => median(copy.map((measured, round) => measured.ns / (base[round] as Measured).ns));
    const ns = (copy: readonly Measured[]): string => median(copy.map((measured) => measured.ns)).toFixed(1);
    lines.push(`| ${item.name} | ${ns(base)} | ${ns(head)} | ${percent(ratio(head))} | ${percent(ratio(again))} |`);
  });
  const text = lines.join("\n");
  console.log(text);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary !== undefined && summary !== "") appendFileSync(summary, `## The speed of plans and paths\n\n${text}\n`);
  if (mismatch) process.exitCode = 1;
}

await main();
