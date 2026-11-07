/*
 * The speed of plans and paths: the base and the head, each copy in its own processes (K12, D29, K101, K212).
 *
 *   pnpm exec tsx packages/core/bench/paths.ts <base src/index.ts> <head src/index.ts>
 *
 * The script bundles `cases.ts` two times: with the base and with the head. The fresh runner `freshRun` of
 * `@mark1russell7/rigor-bench` starts each arm of each pair in a new process (D114). Thus no process shares its
 * compiled code, its type feedback or its heap with another process. The pair (base, head) gives the change, and the
 * A/A pair (base, base) gives the noise: the change between two processes of the same code. In each round and case,
 * `pairOrder` of the runner turns the order of the pairs and of the two arms of each pair.
 *
 * The script prints the median time of one call for each case and each copy. The change is the median ratio of the
 * head to the base in the same round, and the noise is the same ratio of the A/A pair. The verdict of each case is the
 * `timeVerdict` of the bench core (`merge.ts`), with the limits of the family of the case (`limits.ts`, D117). The
 * script asserts only that the copies give the same results. The workflow `bench.yml` runs it in CI, because a shared machine gives unreliable numbers.
 *
 * The workflow starts the script in two jobs, thus on two runners (K167, D71). With `BENCH_JSON`, the script also
 * writes its table and its paired times as JSON to that file, and `merge.ts` gives the verdict of the two runs.
 * `BENCH_RUN` names the run. Run N starts at the global round (N - 1) times the rounds, thus each round of the two runs
 * has its own order.
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
 * there than alone. Thus each case runs alone in its own processes. The fresh runner starts one case in each process,
 * thus `TOGETHER` must be empty (D114).
 *
 * A result that changes on purpose (K237, D169). Two copies with different results in a case do not do the same work. So a
 * difference stops the merge, unless a new row of `changed-results.json` accepts it. A row names the case and the
 * `resultHash` of the result of each arm, and it gives a reason. The verdict `resultVerdict` of
 * `@mark1russell7/rigor-bench` reads the rows of the base and of the head. A row of the base is spent and accepts nothing.
 * A new row that accepts no change of the run is a fault. The fresh runner times an accepted case as each other case.
 *
 * Each copy is an esbuild bundle without `keepNames`, as the bundler of a host makes it. The loader of tsx keeps the
 * name of each function, and that adds a call at each closure that the kernel makes.
 *
 * Each arm builds with the esbuild of its own lock file (K233, D172). `BENCH_BASE_ESBUILD` names a folder with the
 * esbuild of the base, and the workflow sets it only when the two lock files give different versions. The script then
 * also builds the base with the esbuild of the head, and prints the two hashes of the base. Equal hashes show that the
 * new version gives the same code. Different hashes make the table a time read of the new version.
 */
import * as esbuild from "esbuild";
import type { Plugin } from "esbuild";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolveFile } from "node:path";
import { fileURLToPath } from "node:url";
import { caseRatios, resultRows, resultVerdict, type PairedTime, type ResultRow, type ResultRows, type ResultVerdict } from "@mark1russell7/rigor-bench";
import { freshRun, type FreshArm, type FreshRecord } from "@mark1russell7/rigor-bench/fresh";
import { median } from "@mark1russell7/rigor-statistics";
import type { Measured } from "./cases.ts";
import { limitsOf } from "./limits.ts";
import { ACCEPTED, armHash, caseVerdict, fallbackMark, resultHash, verdictRule, type BenchCase, type BenchMode, type BenchRun } from "./merge.ts";
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
 * The cases that run together in one process, in order (D98). The mode run `mode.ts` reads this list for its arm GROUP.
 * A case joins this list only when a mode run gives it the verdict "same". The mode run 41430307699 had 20 processes
 * for each arm, too few for that verdict. Thus the list is empty. The fresh runner of the bench starts one case in each
 * process (D114). Thus the bench refuses a list that is not empty.
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

const CASES_FILE = fileURLToPath(new URL("./cases.ts", import.meta.url));
/** The one tsconfig of both arms. The base arm has no install, so its own file cannot find the file that it extends (K234). */
const TSCONFIG = fileURLToPath(new URL("../tsconfig.json", import.meta.url));

/** The name of the file of rows that accept a changed result (K237, D169). It is in the folder `bench` of each arm. */
export const ROWS_FILE = "changed-results.json";

/**
 * This function gives the rows of an arm: the file `bench/changed-results.json` next to the folder of its `index.ts`.
 * An arm without the file has no rows, as a base from before K237. A row with an empty field stops the read.
 */
export function rowsOf(kernelFile: string): ResultRow[] {
  const file = join(dirname(resolveFile(kernelFile)), "..", "bench", ROWS_FILE);
  return existsSync(file) ? resultRows(JSON.parse(readFileSync(file, "utf8"))) : [];
}

/** The part of esbuild that the bench uses: the build and the version. */
export interface Bundler {
  readonly build: typeof esbuild.build;
  readonly version: string;
}

/** This function gives the esbuild in the folder `prefix`, which `npm install --prefix` made (K233). */
export function bundlerIn(prefix: string): Bundler {
  return createRequire(join(resolveFile(prefix), "package.json"))("esbuild") as Bundler;
}

/** This function bundles the cases with one copy of the kernel, under one tsconfig. A tsconfig that does not resolve stops it. */
export async function bundle(kernelFile: string, name: string, dir: string, tsconfig: string = TSCONFIG, bundler: Bundler = esbuild): Promise<string> {
  const outfile = join(dir, `${name}.mjs`);
  const kernel = resolveFile(kernelFile);
  const copy: Plugin = {
    name: "copy-of-the-kernel",
    setup(builder) {
      builder.onResolve({ filter: /^\.\.\/src\/index\.ts$/ }, (args) => (resolveFile(args.importer) === CASES_FILE ? { path: kernel } : undefined));
    },
  };
  const { warnings } = await bundler.build({ entryPoints: [CASES_FILE], bundle: true, format: "esm", platform: "node", target: "node22", outfile, logLevel: "error", tsconfig, plugins: [copy] });
  const unresolved = warnings.filter((warning) => warning.text.includes("Cannot find base config file"));
  if (unresolved.length > 0) throw new Error(`The tsconfig of the arms does not resolve: ${unresolved.map((warning) => warning.text).join(" ")}`);
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

function percent(ratio: number): string {
  const change = (ratio - 1) * 100;
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)} %`;
}

/** This function gives the arm of one copy for the fresh runner: a new process of the bundle in the mode `child`. */
function arm(id: string, file: string): FreshArm {
  return { id, command: [process.execPath, ...FLAGS, file, "child"] };
}

/** This function keeps the paired time of a record of the fresh runner, and its job. The run keeps the computer. */
function paired(record: FreshRecord): PairedTime & { readonly job: string } {
  return { case: record.case, round: record.round, first: record.first, a: record.a, b: record.b, job: record.job };
}

/** The input of one run of the bench. */
export interface SpeedOptions {
  readonly baseFile: string;
  readonly headFile: string;
  readonly rounds: number;
  /** The name of the run, as `BENCH_RUN` gives it. */
  readonly run: string;
  /** Only these cases, in the order of `cases.ts`. A test uses a few cases. Without it, each case runs. */
  readonly cases?: readonly string[];
  /** The rows of the base and of the head. Without them, the run reads `changed-results.json` of each arm. */
  readonly rows?: ResultRows;
}

/** The output of one run: the record that `merge.ts` reads, the lines of its table and the verdict of its results. */
export interface SpeedOutput {
  readonly record: BenchRun;
  readonly lines: readonly string[];
  readonly results: ResultVerdict;
}

/**
 * This function runs the bench of the base and the head. A case with different results gets a time only when a new row
 * accepts the change (K237, D169). A refused case gets no time, and the verdict `results` fails.
 */
export async function speedRun(options: SpeedOptions): Promise<SpeedOutput> {
  const { baseFile, headFile, rounds, run } = options;
  if (TOGETHER.length > 0) throw new Error("The fresh runner starts one case in each process (D114). Thus TOGETHER must be empty.");
  const dir = mkdtempSync(join(tmpdir(), "coeval-bench-"));
  const prefix = process.env["BENCH_BASE_ESBUILD"];
  const baseBundler = prefix === undefined || prefix === "" ? esbuild : bundlerIn(prefix);
  const [baseCopy, headCopy] = [await bundle(baseFile, "base", dir, TSCONFIG, baseBundler), await bundle(headFile, "head", dir)];
  const arms = { base: armHash(readFileSync(baseCopy, "utf8")), head: armHash(readFileSync(headCopy, "utf8")) };
  const esbuildLine =
    baseBundler === esbuild
      ? `Esbuild (K233): both arms build with esbuild ${esbuild.version}.`
      : await (async () => {
          const other = armHash(readFileSync(await bundle(baseFile, "base-new", dir), "utf8"));
          const read = other === arms.base ? "equal: the new version gives the same code" : "different: the table reads the time of the new version";
          return `Esbuild (K233): the base arm builds with esbuild ${baseBundler.version}, the head arm with ${esbuild.version}. The hash of the base is ${arms.base.slice(0, 12)} with ${baseBundler.version} and ${other.slice(0, 12)} with ${esbuild.version}, ${read}.`;
        })();
  console.log(esbuildLine);
  // A first process calibrates the calls of each sample, thus each copy does the same work. Its times do not count.
  const all = measureCopy(baseCopy);
  const counts = all.map((item) => item.calls);
  const absent = (options.cases ?? []).filter((name) => !all.some((item) => item.name === name));
  if (absent.length > 0) throw new Error(`cases.ts does not have the cases ${absent.join(", ")}.`);
  const first = options.cases === undefined ? all : all.filter((item) => options.cases?.includes(item.name) === true);
  const names = first.map((item) => item.name);
  const indexes = names.map((name) => all.findIndex((item) => item.name === name));
  // A first process of the head gives its results. The fresh runner times only the arms, and the verdict of the rows reads the results.
  const heads = measureCopy(headCopy, counts, indexes);
  const results = resultVerdict(
    names.map((name, index) => ({ case: name, base: resultHash((first[index] as Measured).result), head: resultHash((heads[index] as Measured).result) })),
    options.rows ?? { base: rowsOf(baseFile), head: rowsOf(headFile) },
  );
  const refused = new Set(results.cases.filter((item) => item.outcome === "refused").map((item) => item.case));
  const accepted = new Map(results.cases.filter((item) => item.outcome === "accepted").map((item) => [item.case, item.line]));
  const different = names.map((name, index) => (refused.has(name) ? `${(first[index] as Measured).result} and ${(heads[index] as Measured).result}` : undefined));
  const job = Number(run);
  const timed = names.filter((name) => !refused.has(name));
  const fresh =
    timed.length === 0
      ? undefined
      : await freshRun({
          base: arm("base", baseCopy),
          candidates: [arm("head", headCopy)],
          cases: timed,
          rounds,
          roundOffset: Number.isInteger(job) && job >= 1 ? (job - 1) * rounds : 0,
          job: run,
          args: (name) => [String(all.findIndex((item) => item.name === name)), String(counts[all.findIndex((item) => item.name === name)])],
        });
  const pairs = { head: (fresh?.pairs["head"] ?? []).map(paired), aa: (fresh?.pairs["base~aa"] ?? []).map(paired) };
  // On Linux, Node reads the model of the CPU from /proc/cpuinfo.
  const cpu = fresh?.env.cpu ?? "an unknown CPU";
  const mode: BenchMode = { flags: FLAGS, warmup: WARMUP, samples: SAMPLES, sampleMs: TARGET_MS, together: TOGETHER };
  const cases: BenchCase[] = [];
  const lines: string[] = [
    `Run ${run} on ${cpu}.`,
    esbuildLine,
    `Node ${process.version} with \`${FLAGS.join(" ")}\`, ${String(rounds)} rounds. In each round, the fresh runner starts each arm of the pairs (base, head) and (base, base) in a new process.`,
    `Each process gives ${String(WARMUP)} warmup and ${String(SAMPLES)} counted samples of ${String(TARGET_MS)} ms for one case.`,
    "The change compares the head with the base of the same round. The noise (A/A) compares two processes of the base.",
    ...verdictRule(),
    "",
    "| Case | Base (ns) | Head (ns) | Change | Noise (A/A) | Verdict |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
  ];
  names.forEach((name, index) => {
    const results = different[index];
    if (results !== undefined) {
      cases.push({ name, baseNs: 0, headNs: 0, change: 0, noise: 0, different: results });
      lines.push(`| ${name} | different results: ${results} | | | | |`);
      return;
    }
    const [head, aa] = [pairs.head.filter((record) => record.case === name), pairs.aa.filter((record) => record.case === name)];
    const [change, noise] = [caseRatios(head)[0]?.ratio ?? Number.NaN, caseRatios(aa)[0]?.ratio ?? Number.NaN];
    // The records keep the time of one call in milliseconds, and the table gives nanoseconds.
    const [baseNs, headNs] = [median(head.map((record) => record.a)) * 1e6, median(head.map((record) => record.b)) * 1e6];
    const line = accepted.get(name);
    cases.push({ name, baseNs, headNs, change: (change - 1) * 100, noise: (noise - 1) * 100, head, aa, ...(line === undefined ? {} : { accepted: line }) });
    lines.push(
      `| ${name} | ${baseNs.toFixed(1)} | ${headNs.toFixed(1)} | ${percent(change)} | ${percent(noise)} | ${caseVerdict(head, aa, limitsOf(name).options).outcome}${fallbackMark(name)}${line === undefined ? "" : ACCEPTED} |`,
    );
  });
  if (results.lines.length > 0) lines.push("", ...results.lines);
  const faults = [...results.unused, ...results.absent].map((item) => item.line);
  const record: BenchRun = { run, cpu, node: process.version, rounds, mode, arms, cases, results: { outcome: results.outcome, lines: results.lines, faults } };
  return { record, lines, results };
}

async function main(): Promise<void> {
  const [baseFile, headFile] = process.argv.slice(2);
  if (baseFile === undefined || headFile === undefined) throw new Error("Give the index.ts of the base and of the head.");
  const run = process.env["BENCH_RUN"] ?? "1";
  const { record, lines, results } = await speedRun({ baseFile, headFile, rounds: ROUNDS, run });
  const text = lines.join("\n");
  console.log(text);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary !== undefined && summary !== "") appendFileSync(summary, `## The speed of plans and paths (run ${run})\n\n${text}\n`);
  const json = process.env["BENCH_JSON"];
  if (json !== undefined && json !== "") writeFileSync(json, `${JSON.stringify(record, null, 2)}\n`);
  if (results.outcome === "fail") process.exitCode = 1;
}

// The mode run `mode.ts` imports the functions of this file, and only a start of this file runs the bench.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) await main();
