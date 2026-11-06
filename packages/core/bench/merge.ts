/*
 * The verdict of two runs of the bench (K167, D71, K212, D114).
 *
 *   node packages/core/bench/merge.ts <run 1 JSON> <run 2 JSON>
 *
 * The workflow `bench.yml` starts `paths.ts` in two jobs, thus on two runners. Each job writes its table as JSON
 * (`BENCH_JSON`). This script reads the two files and prints one table with the change, the noise and the verdict of
 * each run.
 *
 * The shared bench core `@mark1russell7/rigor-bench` gives the verdict of each case (D114). The margin and the noise cap
 * of each case come from the A/A records of its family (`limits.ts`, D117). Its rule `difference`
 * compares the head with the A/A pair: two processes of the base. The outcome is "same", "faster", "slower" or "cannot
 * decide". The verdict of a case is the `pooledVerdict` of the rounds of the two runs. A run that gives the opposite
 * direction makes the verdict "cannot decide". The same case can take 107 ns on one runner and 206 ns on another
 * (D70), thus one run is not sufficient.
 *
 * Node removes the types of this script. The job installs the packages, because the script imports the bench core.
 * The script fails when a run is absent or when a run found different results. A "slower" case does not fail it.
 * The script writes the state of the runs and its reason as outputs of the job, and `Speed OK` reads them (K235, D167).
 *
 * The script also prints the gate of the claim "not slower by more than the margin" (K225, D163). This gate is report only.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { notSlowerVerdict, pooledVerdict, timeVerdict, type NotSlowerVerdict, type PairedTime, type PooledVerdict, type TimeOutcome, type TimeVerdict, type VerdictOptions } from "@mark1russell7/rigor-bench";
import { FAMILIES, limitsOf, limitsRecord, percentOf, type Family } from "./limits.ts";

/** The measurement of one case in one run. The change and the noise are percents. */
export interface BenchCase {
  readonly name: string;
  readonly baseNs: number;
  readonly headNs: number;
  readonly change: number;
  readonly noise: number;
  /** The different results of the copies, when the copies do not agree and no row accepts the change. */
  readonly different?: string;
  /** The line of a row that accepts a changed result (K237, D169). The case has its times as each other case. */
  readonly accepted?: string;
  /** The pair of the base (arm `a`) and the head (arm `b`) in each round (D114). A record from before K212 has no pairs. */
  readonly head?: readonly PairedTime[];
  /** The A/A pair of the base (arm `a`) and the second copy of the base (arm `b`) in each round (D114). */
  readonly aa?: readonly PairedTime[];
}

/** The mode of one run: the flags of V8, the samples of each process and the cases that share a process (K199). */
export interface BenchMode {
  readonly flags: readonly string[];
  readonly warmup: number;
  readonly samples: number;
  /** The time of one sample in milliseconds. */
  readonly sampleMs: number;
  /** The cases that run together in one process, in order. Each other case runs alone in its own processes (D98). */
  readonly together: readonly string[];
}

/** The table of one run of `paths.ts`. */
export interface BenchRun {
  readonly run: string;
  readonly cpu: string;
  readonly node: string;
  readonly rounds: number;
  /** The mode of the run. A record from before K199 has no mode. */
  readonly mode?: BenchMode;
  /** The hash of the bundle of each arm. A record from before K232 has no hashes. */
  readonly arms?: ArmHashes;
  readonly cases: readonly BenchCase[];
  /** The verdict of the rows of changed results (K237, D169). A record from before K237 has none. */
  readonly results?: ResultsRead;
}

/** The verdict of `resultVerdict` over the results of one run, as the record keeps it. */
export interface ResultsRead {
  readonly outcome: "pass" | "fail";
  readonly lines: readonly string[];
  /** The lines of the new rows that accept nothing: a row of a case with one result, or of a case that the run does not have. */
  readonly faults: readonly string[];
}

/** The mark of a case whose changed result a row accepts. */
export const ACCEPTED = " (accepted change)";

/**
 * This function gives the hash of the result of one case: the first 16 hexadecimal digits of its SHA-256.
 * A row of `changed-results.json` names the hash of each arm. The run and the rows use this one function.
 */
export function resultHash(result: string): string {
  return createHash("sha256").update(result).digest("hex").slice(0, 16);
}

/** The hash of the bundle of each arm in one job, each with `cases.ts` (K232, D166). */
export interface ArmHashes {
  readonly base: string;
  readonly head: string;
}

/** The lines where esbuild names a source file. The folder of an arm changes these lines and no code. */
const PATH_COMMENT = /^\/\/ .*\.(?:[cm]?[jt]sx?|json)$/gm;

/**
 * This function gives the hash of the code of a bundle, without the lines that name a source file.
 * The hash also reads the name of the folder that holds `index.ts`, because esbuild names a namespace object after it.
 * A different name reads as different arms, and this holds a merge.
 */
export function armHash(code: string): string {
  return createHash("sha256").update(code.replace(PATH_COMMENT, "")).digest("hex");
}

/** The answer to the question "does a slower reading hold this merge under D117?". */
export interface Hold {
  readonly hold: boolean;
  readonly line: string;
}

/** This function tells if each run has the hashes of its arms, and all these hashes are one hash. */
export function equalArms(runs: readonly (BenchRun | undefined)[]): boolean {
  const arms = runs.map((run) => run?.arms);
  if (arms.length === 0 || arms.includes(undefined)) return false;
  return new Set(arms.flatMap((item) => (item === undefined ? [] : [item.base, item.head]))).size === 1;
}

/**
 * This function tells if a slower reading holds a merge (K232, D166). It reads the hashes of the bundles that the jobs
 * ran, and no list of files. A slower reading does not hold a merge only when each run is complete and the two arms of
 * each job have one hash. A run that is short or absent gives no such reading, and `Speed OK` goes red on it (K235, D167).
 */
export function holdRead(slower: number, runs: readonly (BenchRun | undefined)[], complete: boolean): Hold {
  if (!complete) return { hold: true, line: "Hold (D117): hold. A run is short or absent, so the arms give no reading." };
  if (slower === 0) return { hold: false, line: "Hold (D117): no hold. 0 slower." };
  const arms = runs.map((run) => run?.arms);
  if (arms.length === 0 || arms.includes(undefined)) return { hold: true, line: `Hold (D117): hold. ${String(slower)} slower, and a run has no hashes of its arms.` };
  if (!equalArms(runs)) return { hold: true, line: `Hold (D117): hold. ${String(slower)} slower, and the arms differ.` };
  return { hold: false, line: `Hold (D117): no hold. ${String(slower)} slower on equal arms, a row of the A/A table: equal by construction.` };
}

/**
 * The states of a Speed run that `Speed OK` reads (K235, D167). The state "no read" comes from a fault, and it says nothing about noise.
 * The state "different results" is a finding: the copies gave different results. On equal arms this is a fault of determinism.
 * On different arms, a changed result can explain it, as K236 read.
 */
export type SpeedState = "same" | "slower" | "no read" | "different results";

/** This function gives the state of a Speed run and its reason, on one line. Different results come first, then a fault, because each leaves no reading. */
export function speedState(slower: number, undecided: number, hold: string, faults: readonly string[], different = 0, equal = false): { readonly state: SpeedState; readonly reason: string } {
  const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
  const cause = equal ? "The arms are equal, so this is a fault of determinism." : "The arms differ or have no hashes, so a changed result can explain this.";
  if (different > 0) return { state: "different results", reason: oneLine(`${String(different)} cases read different results. ${cause} ${faults.join(" ")}`) };
  if (faults.length > 0) return { state: "no read", reason: oneLine(faults.join(" ")) };
  if (slower > 0) return { state: "slower", reason: oneLine(`${String(slower)} slower, ${String(undecided)} cannot decide. ${hold}`) };
  return { state: "same", reason: oneLine(`0 slower, ${String(undecided)} cannot decide.`) };
}

/** This function gives the line with the hashes of the arms of each run. */
export function armLine(runs: readonly (BenchRun | undefined)[]): string {
  const parts = runs.map((run) => (run?.arms === undefined ? "no hashes" : `base ${run.arms.base.slice(0, 12)} head ${run.arms.head.slice(0, 12)}`));
  return `Arms (K232): ${parts.join(", ")}.`;
}

/**
 * The options of a time verdict without the limits of a family (D114). The margin of the rule `difference` is the floor
 * of the old bound (D50, D70): 1.5 %, on a log scale. The mode run `mode.ts` uses these options. The bench gives each
 * case the limits of its family (`limitsOf`, D117).
 */
export const VERDICT: VerdictOptions = { margin: Math.log(1.015) };

/**
 * This function gives each round of one case the name of a case of its own.
 *
 * GAP (mark1russell7/rigor#34): `timeVerdict` gives one verdict over all cases of a bench, and the bench needs a
 * verdict for each case. With one case for each round, `timeVerdict` compares the rounds of one case.
 */
export function roundsAsCases<T extends PairedTime>(records: readonly T[]): T[] {
  return records.map((record) => ({ ...record, case: `${record.case} (round ${String(record.round)})` }));
}

/**
 * This function gives the time verdict of one case in one run: the rounds of the head against the rounds of the A/A
 * pair. Without options, the verdict uses `VERDICT`.
 */
export function caseVerdict(head: readonly PairedTime[], aa: readonly PairedTime[], options: VerdictOptions = VERDICT): TimeVerdict {
  return timeVerdict(roundsAsCases(head), roundsAsCases(aa), options);
}

/** The verdict of one case over the two runs. */
export type Verdict = TimeOutcome | "different results" | "one run only";

/** This function tells if a run has the paired times of a case. A record from before K212 has none. */
function hasPairs(item: BenchCase | undefined): item is BenchCase & { readonly head: readonly PairedTime[]; readonly aa: readonly PairedTime[] } {
  return item?.head !== undefined && item.aa !== undefined && item.head.length > 0;
}

/** This function gives the outcome of one case in one run. A case without paired times cannot decide. */
export function outcomeOf(item: BenchCase): TimeOutcome {
  return hasPairs(item) ? caseVerdict(item.head, item.aa, limitsOf(item.name).options).outcome : "cannot decide";
}

/**
 * This function gives the pooled verdict of one case over the runs: the rounds of all runs, one job for each run.
 * The label of a job is the name of its run. A record of the fresh runner keeps the same label in its field `job`.
 * Without options, the verdict uses the limits of the family of the case (D117).
 */
export function pooledCase(runs: readonly { readonly run: string; readonly item: BenchCase }[], options?: VerdictOptions): PooledVerdict | undefined {
  const jobs = runs.flatMap(({ run, item }) => (hasPairs(item) ? [{ job: run, candidate: roundsAsCases(item.head), aa: roundsAsCases(item.aa) }] : []));
  const name = runs[0]?.item.name;
  return jobs.length === 0 || name === undefined ? undefined : pooledVerdict(jobs, options ?? limitsOf(name).options);
}

/** This function gives the verdict of one case over two runs: the outcome of `pooledCase`. */
export function verdictOf(first: BenchCase | undefined, second: BenchCase | undefined, names: readonly [string, string] = ["1", "2"]): Verdict {
  if (first?.different !== undefined || second?.different !== undefined) return "different results";
  if (first === undefined || second === undefined) return "one run only";
  return pooledCase([{ run: names[0], item: first }, { run: names[1], item: second }])?.outcome ?? "cannot decide";
}

function percent(change: number): string {
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)} %`;
}

/** This function gives the mark of a verdict with the fallback limits, or an empty text. */
export function fallbackMark(name: string): string {
  return limitsOf(name).fallback ? " (fallback limits)" : "";
}

function cells(item: BenchCase | undefined): string {
  if (item === undefined) return " | | ";
  if (item.different !== undefined) return `different results | ${item.different} | `;
  return `${percent(item.change)} | ${percent(item.noise)} | ${outcomeOf(item)}${fallbackMark(item.name)}${item.accepted === undefined ? "" : ACCEPTED}`;
}

function read(file: string | undefined): BenchRun | undefined {
  if (file === undefined || !existsSync(file)) {
    console.error(`::error::The run file ${file ?? "(none)"} is missing.`);
    return undefined;
  }
  return JSON.parse(readFileSync(file, "utf8")) as BenchRun;
}

/** This function gives the line of one run in the verdict: its runner, its Node, its rounds and its mode (K199). */
export function describeRun(run: BenchRun | undefined, index: number): string {
  if (run === undefined) return `Run ${String(index + 1)} gave no table.`;
  const head = `Run ${run.run}: ${run.cpu}, Node ${run.node}, ${String(run.rounds)} rounds.`;
  const mode = run.mode;
  if (mode === undefined) return `${head} The record names no mode.`;
  const flags = mode.flags.length > 0 ? `\`${mode.flags.join(" ")}\`` : "no flags";
  const samples = `${String(mode.warmup)} warmup and ${String(mode.samples)} counted samples of ${String(mode.sampleMs)} ms`;
  const together = mode.together.length > 0 ? `the ${String(mode.together.length)} cases ${mode.together.join(", ")} share one process` : "each case runs in its own processes";
  return `${head} Mode: ${flags}, ${samples} in each process, ${together}.`;
}

/** The lines that tell how the bench gives a verdict. `paths.ts` and this script print them. */
export function verdictRule(): string[] {
  const record = limitsRecord();
  const families = (Object.keys(FAMILIES) as Family[]).map((family) => {
    const limits = record.limits[family];
    return `${family} ${percentOf(limits.margin)} and ${percentOf(limits.noiseCap)}${limits.source === "fallback" ? " (fallback)" : ""}`;
  });
  const runs = record.runs.map((run) => String(run.id)).join(", ");
  return [
    "The verdict of a case in a run is the `timeVerdict` of `@mark1russell7/rigor-bench`, with the rule `difference` (D114).",
    "It compares the median ratio of the head to the base with the median ratio of the A/A pair, over the rounds of the case.",
    'The case is "same" when the bootstrap interval of the difference is inside the margin. Else it is "faster" or "slower" when the interval is wholly on one side of 1.',
    'Else the case is "cannot decide". An A/A spread or an A/A median above the noise cap also gives "cannot decide".',
    `The margin and the noise cap of each family come from the A/A records of the Speed runs ${runs} (D117): ${families.join(", ")}.`,
    `A case without a family uses the fallback limits ${percentOf(record.fallback.margin)} and ${percentOf(record.fallback.noiseCap)}, and its verdict says "(fallback limits)".`,
  ];
}

/**
 * This function gives the gate of the claim "not slower by more than the margin" over the runs (K225, D163).
 * The margin of each case comes from its family. The gate uses the looks of the bench core, so its level stays the level
 * of a gate that takes more rounds, also when a run stops at the first look.
 */
export function gateRead(runs: readonly (BenchRun | undefined)[]): NotSlowerVerdict {
  const jobs = runs.flatMap((run) =>
    run === undefined ? [] : [{ job: run.run, candidate: run.cases.flatMap((item) => item.head ?? []), aa: run.cases.flatMap((item) => item.aa ?? []) }],
  );
  return notSlowerVerdict(jobs, { margin: (name) => limitsOf(name).options.margin ?? 0 });
}

/** This function gives the lines of the gate in the verdict: one line of counts, then the reason of each slower case. */
export function gateLines(gate: NotSlowerVerdict): string[] {
  const count = (read: NotSlowerVerdict["cases"][number]["read"]): string => String(gate.cases.filter((item) => item.read === read).length);
  return [
    `Gate (report only, D163): ${gate.outcome}. ${count("not slower")} not slower, ${count("slower")} slower, ${count("no read")} no read.`,
    ...gate.cases.filter((item) => item.read === "slower").map((item) => `- ${item.reason}`),
  ];
}

function main(): void {
  const files = process.argv.slice(2);
  const runs = [read(files[0]), read(files[1])];
  const names: string[] = [];
  for (const run of runs) for (const item of run?.cases ?? []) if (!names.includes(item.name)) names.push(item.name);
  const lines: string[] = [
    ...runs.map(describeRun),
    "",
    ...verdictRule(),
    "The verdict of a case uses the rounds of both runs. A run with the opposite direction makes it \"cannot decide\".",
    "",
    "| Case | Change 1 | Noise 1 | Verdict 1 | Change 2 | Noise 2 | Verdict 2 | Verdict |",
    "| --- | ---: | ---: | --- | ---: | ---: | --- | --- |",
  ];
  const counts = new Map<Verdict, number>();
  for (const name of names) {
    const [first, second] = runs.map((run) => run?.cases.find((item) => item.name === name));
    const verdict = verdictOf(first, second, [runs[0]?.run ?? "1", runs[1]?.run ?? "2"]);
    counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
    lines.push(`| ${name} | ${cells(first)} | ${cells(second)} | ${verdict}${fallbackMark(name)} |`);
  }
  lines.push("", `Verdicts: ${[...counts].map(([verdict, count]) => `${String(count)} ${verdict}`).join(", ")}.`);
  const short = runs.flatMap((run, index) =>
    run !== undefined && (run.cases.length === 0 || run.cases.length < names.length)
      ? [`${files[index] ?? `run ${String(index + 1)}`} has ${String(run.cases.length)} of ${String(names.length)} cases.`]
      : [],
  );
  const faults = [
    ...runs.flatMap((run, index) => (run === undefined ? [`The run file ${files[index] ?? "(none)"} is missing.`] : [])),
    ...short,
    ...(names.length === 0 ? ["The two run files have no cases."] : []),
    ...runs.flatMap((run) => (run?.results?.faults ?? []).map((line) => `Run ${run?.run ?? "?"}: ${line}`)),
  ];
  const changed = [...new Set(runs.flatMap((run) => run?.results?.lines ?? []))];
  if (changed.length > 0) lines.push("", "Changed results (K237):", ...changed);
  const different = counts.get("different results") ?? 0;
  const slower = counts.get("slower") ?? 0;
  const hold = holdRead(slower, runs, faults.length === 0 && different === 0).line;
  lines.push("", ...gateLines(gateRead(runs)));
  lines.push("", armLine(runs), hold);
  const { state, reason } = speedState(slower, counts.get("cannot decide") ?? 0, hold, faults, different, equalArms(runs));
  const output = process.env["GITHUB_OUTPUT"];
  if (output !== undefined && output !== "") appendFileSync(output, `state=${state}\nreason=${reason}\n`);
  const text = lines.join("\n");
  console.log(text);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary !== undefined && summary !== "") appendFileSync(summary, `## The speed of plans and paths: the verdict of two runs\n\n${text}\n`);
  for (const line of short) console.error(`::error::${line}`);
  if (names.length === 0) console.error("::error::The two run files have no cases.");
  if (faults.length > 0 || different > 0) process.exitCode = 1;
}

// A test imports `describeRun`, and only a start of this file gives the verdict.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
