/*
 * The verdict of two runs of the bench (K167, D71).
 *
 *   node packages/core/bench/merge.ts <run 1 JSON> <run 2 JSON>
 *
 * The workflow `bench.yml` starts `paths.ts` in two jobs, thus on two runners. Each job writes its table as JSON
 * (`BENCH_JSON`). This script reads the two files and prints one table with the change and the noise of each run.
 *
 * A case is slower or faster only when both runs are over the bound in the same direction. The bound of a run is
 * 1.5 % or two times the noise of the case, whichever is larger (D50, D70). A case that no run puts over the bound is
 * in bound. A case that only one run puts over the bound, or that the two runs put over the bound in opposite
 * directions, is mixed. The same case can take 107 ns on one runner and 206 ns on another (D70), thus one run is not
 * sufficient.
 *
 * The script uses only the modules of Node, and Node removes its types. Thus the job does not install the packages.
 * The script fails when a run is absent or when a run found different results.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

/** The measurement of one case in one run. The change and the noise are percents. */
export interface BenchCase {
  readonly name: string;
  readonly baseNs: number;
  readonly headNs: number;
  readonly change: number;
  readonly noise: number;
  /** The different results of the copies, when the copies do not agree. */
  readonly different?: string;
}

/** The table of one run of `paths.ts`. */
export interface BenchRun {
  readonly run: string;
  readonly cpu: string;
  readonly node: string;
  readonly rounds: number;
  readonly cases: readonly BenchCase[];
}

/** The smallest bound in percent. */
const FLOOR = 1.5;

type Verdict = "slower" | "faster" | "mixed" | "in bound" | "different results" | "one run only";

/** This function gives the direction of a case in one run: +1 over the bound and slower, -1 faster, 0 in bound. */
function direction(item: BenchCase): number {
  const bound = Math.max(2 * Math.abs(item.noise), FLOOR);
  if (Math.abs(item.change) <= bound) return 0;
  return item.change > 0 ? 1 : -1;
}

function verdictOf(first: BenchCase | undefined, second: BenchCase | undefined): Verdict {
  if (first?.different !== undefined || second?.different !== undefined) return "different results";
  if (first === undefined || second === undefined) return "one run only";
  const [a, b] = [direction(first), direction(second)];
  if (a === 0 && b === 0) return "in bound";
  if (a === b) return a > 0 ? "slower" : "faster";
  return "mixed";
}

function percent(change: number): string {
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)} %`;
}

function cells(item: BenchCase | undefined): string {
  if (item === undefined) return " | ";
  if (item.different !== undefined) return `different results | ${item.different}`;
  return `${percent(item.change)} | ${percent(item.noise)}`;
}

function read(file: string | undefined): BenchRun | undefined {
  if (file === undefined || !existsSync(file)) {
    console.error(`::error::The run file ${file ?? "(none)"} is missing.`);
    return undefined;
  }
  return JSON.parse(readFileSync(file, "utf8")) as BenchRun;
}

function main(): void {
  const files = process.argv.slice(2);
  const runs = [read(files[0]), read(files[1])];
  const names: string[] = [];
  for (const run of runs) for (const item of run?.cases ?? []) if (!names.includes(item.name)) names.push(item.name);
  const describe = (run: BenchRun | undefined, index: number): string =>
    run === undefined ? `Run ${String(index + 1)} gave no table.` : `Run ${run.run}: ${run.cpu}, Node ${run.node}, ${String(run.rounds)} rounds.`;
  const lines: string[] = [
    ...runs.map(describe),
    "",
    "A case is slower or faster only when both runs are over the bound in the same direction.",
    `The bound of a run is ${String(FLOOR)} % or two times the noise (A/A) of the case, whichever is larger.`,
    "",
    "| Case | Change 1 | Noise 1 | Change 2 | Noise 2 | Verdict |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
  ];
  const counts = new Map<Verdict, number>();
  for (const name of names) {
    const [first, second] = runs.map((run) => run?.cases.find((item) => item.name === name));
    const verdict = verdictOf(first, second);
    counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
    lines.push(`| ${name} | ${cells(first)} | ${cells(second)} | ${verdict} |`);
  }
  lines.push("", `Verdicts: ${[...counts].map(([verdict, count]) => `${String(count)} ${verdict}`).join(", ")}.`);
  const text = lines.join("\n");
  console.log(text);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary !== undefined && summary !== "") appendFileSync(summary, `## The speed of plans and paths: the verdict of two runs\n\n${text}\n`);
  const short = runs.flatMap((run, index) =>
    run !== undefined && (run.cases.length === 0 || run.cases.length < names.length)
      ? [`${files[index] ?? `run ${String(index + 1)}`} has ${String(run.cases.length)} of ${String(names.length)} cases.`]
      : [],
  );
  for (const line of short) console.error(`::error::${line}`);
  if (names.length === 0) console.error("::error::The two run files have no cases.");
  if (runs.includes(undefined) || short.length > 0 || names.length === 0 || counts.has("different results")) process.exitCode = 1;
}

main();
