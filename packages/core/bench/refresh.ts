/*
 * The refresh of the limits of the bench verdict (K214, D116).
 *
 *   gh run download <run id> -R mark1russell7/coeval -D <dir>/<run id>     (for each Speed run, 5 or more jobs in all)
 *   node packages/core/bench/refresh.ts <dir>
 *
 * The script reads the record `bench-<n>.json` of each job of each run in `<dir>`. It gives the A/A statistics of each
 * case in each job: the median of the log ratios of the A/A rounds, and the A/A spread `aaSpread` of the bench core. It
 * writes them and the limits of each family to `limits.json` (the formula is in `limits.ts`).
 *
 * A job counts only when its A/A band holds 1: the 10 % and the 90 % quantiles of the log ratios of all its A/A rounds
 * are on the two sides of 0. Else the job measured its runner, and the script stops. Start a new run to replace it.
 *
 * Then the script replays the verdicts with the new limits over the downloaded records. It prints the pooled verdict
 * of each case of each run, with the margin of D114 and with the new limits. In a run of `SAME_CODE_RUNS`, the head has
 * the product code of the base. Its head pair is thus a second A/A pair. There, the script also gives the verdict of
 * the A/A pair against the head pair in each job. A verdict "slower" or "faster" of such a run is false, and the
 * script fails.
 *
 * The script also prints a harder count: the verdict of each A/A pair against the A/A pair of each other job. This
 * comparison mixes two runners, thus it does not fail the script. D116 gives the result.
 *
 * With the run 41579105529 in `<dir>`, the script also writes the fixture `replay.json` of the case "a tree with an
 * equation". The test `limits.test.ts` replays it in CI.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { aaSpread, type PairedTime, type TimeOutcome } from "@mark1russell7/rigor-bench";
import { median, quantile } from "@mark1russell7/rigor-statistics";
import { deriveLimits, FAMILIES, LIMITS_FILE, limitsOf, percentOf, worstOfJobs, type Family, type JobStat, type LimitsRecord } from "./limits.ts";
import { caseVerdict, pooledCase, roundsAsCases, VERDICT, type BenchCase, type BenchRun } from "./merge.ts";

/** The run of the false verdict "slower" of K214: PR #226 changed no product code. */
export const REPLAY_RUN = 41579105529;

/** The runs whose head has the product code of the base: two runs of PR #226 (K212). */
export const SAME_CODE_RUNS: readonly number[] = [41574523074, 41579105529];

/** The case of the false verdict. */
export const REPLAY_CASE = "a tree with an equation";

/** One round of a pair in the fixture: the round, the arm that started first and the ratio `b / a`. */
export type FixtureRound = readonly [round: number, first: "a" | "b", ratio: number];

/** The fixture `replay.json`: the head pair and the A/A pair of one case in each job of one run. */
export interface ReplayFixture {
  readonly run: number;
  readonly case: string;
  readonly jobs: readonly { readonly job: string; readonly head: readonly FixtureRound[]; readonly aa: readonly FixtureRound[] }[];
}

/** The fixture file. */
export const REPLAY_FILE = new URL("./replay.json", import.meta.url);

/** One downloaded job: the id of its run and its record. */
interface Job {
  readonly id: number;
  readonly record: BenchRun;
}

/** This function gives the A/A statistics of one case in one job, on a log scale. */
export function jobStat(aa: readonly PairedTime[]): JobStat {
  const logs = aa.map((record) => Math.log(record.b / record.a));
  return [median(logs), aaSpread(roundsAsCases(aa))];
}

/** This function tells if the A/A band of a job holds 1: its 10 % and 90 % quantiles of the A/A log ratios. */
export function bandHoldsOne(cases: readonly BenchCase[]): boolean {
  const logs = cases.flatMap((item) => (item.aa ?? []).map((record) => Math.log(record.b / record.a)));
  return logs.length > 0 && quantile(logs, 0.1) <= 0 && quantile(logs, 0.9) >= 0;
}

/** This function gives the rounds of a pair for the fixture, with seven significant digits. */
function rounds(records: readonly PairedTime[]): FixtureRound[] {
  return records.map((record) => [record.round, record.first, Number((record.b / record.a).toPrecision(7))]);
}

/** This function gives the pairs of the fixture as paired times: the base takes 1, and the other arm the ratio. */
export function fromFixture(name: string, job: string, list: readonly FixtureRound[]): (PairedTime & { readonly job: string })[] {
  return list.map(([round, first, ratio]) => ({ case: name, round, first, a: 1, b: ratio, job }));
}

function readJobs(dir: string): Job[] {
  const ids = readdirSync(dir).filter((name) => /^\d+$/.test(name)).map(Number).sort((x, y) => x - y);
  return ids.flatMap((id) =>
    readdirSync(join(dir, String(id)))
      .filter((name) => /^bench-run-\d+$/.test(name))
      .sort()
      .flatMap((folder) => {
        const file = join(dir, String(id), folder, `bench-${folder.slice("bench-run-".length)}.json`);
        return existsSync(file) ? [{ id, record: JSON.parse(readFileSync(file, "utf8")) as BenchRun }] : [];
      }),
  );
}

function count(outcomes: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const outcome of outcomes) counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  return [...counts].map(([outcome, n]) => `${String(n)} ${outcome}`).join(", ");
}

/** This function tells if an outcome finds a change. */
function decided(outcome: TimeOutcome): boolean {
  return outcome === "slower" || outcome === "faster";
}

function main(): void {
  const dir = process.argv[2];
  if (dir === undefined) throw new Error("Give the folder of the downloaded Speed runs.");
  const jobs = readJobs(dir).filter((job) => job.record.cases.some((item) => item.aa !== undefined && item.aa.length > 0));
  const noisy = jobs.filter((job) => !bandHoldsOne(job.record.cases));
  if (noisy.length > 0) throw new Error(`The A/A band of these jobs does not hold 1: ${noisy.map((job) => `${String(job.id)} run ${job.record.run}`).join(", ")}. Start a new run to replace each.`);
  const runs = [...new Set(jobs.map((job) => job.id))].map((id) => ({ id, jobs: jobs.filter((job) => job.id === id).map((job) => job.record.run) }));
  const stats: Record<string, JobStat[]> = {};
  for (const job of jobs) for (const item of job.record.cases) if (item.aa !== undefined && item.aa.length > 0) (stats[item.name] ??= []).push(jobStat(item.aa));
  const round6 = (value: number): number => Number(value.toFixed(6));
  const kept = Object.fromEntries(Object.entries(stats).map(([name, list]) => [name, list.map(([m, s]) => [round6(m), round6(s)] as const)]));
  const record: LimitsRecord = { runs, stats: kept, ...deriveLimits({ runs, stats: kept }) };
  // Each pair of numbers and each list of jobs stays on one line, thus the file stays small.
  const text = JSON.stringify(record, null, 1).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, items: string) => `[${items.replace(/\s+/g, " ")}]`);
  writeFileSync(LIMITS_FILE, `${text}\n`);
  console.log(`The A/A records of ${String(jobs.length)} jobs in the runs ${runs.map((run) => String(run.id)).join(", ")}.`);
  const shown = (values: readonly number[]): string => values.map((value) => (value * 100).toFixed(2)).join(" ");
  for (const [family, limits] of Object.entries(record.limits)) {
    const cases = (FAMILIES[family as Family] as readonly string[]).map((name) => record.stats[name] ?? []);
    const medians = worstOfJobs(cases, ([median]) => Math.abs(median));
    const spreads = worstOfJobs(cases, ([, spread]) => spread);
    console.log(`${family}: margin ${percentOf(limits.margin)}, noise cap ${percentOf(limits.noiseCap)} (${limits.source}). Median of each job ${shown(medians)}, spread ${shown(spreads)}, in percents of log.`);
  }
  console.log(`fallback: margin ${percentOf(record.fallback.margin)}, noise cap ${percentOf(record.fallback.noiseCap)}.`);

  // The pooled verdict of each case of each run, with the old options and with the new limits.
  const wrong: string[] = [];
  for (const run of runs) {
    const own = jobs.filter((job) => job.id === run.id);
    const names = [...new Set(own.flatMap((job) => job.record.cases.map((item) => item.name)))];
    const before: string[] = [];
    const after: string[] = [];
    for (const name of names) {
      const items = own.flatMap((job) => job.record.cases.filter((item) => item.name === name).map((item) => ({ run: job.record.run, item })));
      const pooled = pooledCase(items, limitsOf(name, record).options);
      after.push(pooled?.outcome ?? "cannot decide");
      before.push(pooledCase(items, VERDICT)?.outcome ?? "cannot decide");
      if (pooled !== undefined && pooled.outcome !== "same") console.log(`  ${String(run.id)} ${name}: ${pooled.outcome}. ${pooled.reason}`);
      if (!SAME_CODE_RUNS.includes(run.id) || pooled === undefined) continue;
      const options = limitsOf(name, record).options;
      const outcomes = [
        ["pooled", pooled.outcome],
        ...pooled.jobs.map((job) => [`head of job ${job.job}`, job.verdict.outcome] as const),
        ...items.map(({ run: job, item }) => [`A/A of job ${job}`, caseVerdict(item.aa ?? [], item.head ?? [], options).outcome] as const),
      ] as const;
      for (const [arm, outcome] of outcomes) if (decided(outcome)) wrong.push(`${String(run.id)} ${name}, ${arm}: ${outcome}`);
    }
    console.log(`Run ${String(run.id)}: with the margin of D114 ${count(before)}. With the limits of D116 ${count(after)}.`);
  }
  console.log(`The runs of the same code ${SAME_CODE_RUNS.join(", ")}: ${String(wrong.length)} false verdicts.`);
  for (const line of wrong) console.log(`  ${line}`);

  // Each A/A arm against the A/A arm of each other job: the same code in both pairs.
  const nulls: TimeOutcome[] = [];
  const cross: string[] = [];
  for (const first of jobs) {
    for (const second of jobs) {
      if (first === second) continue;
      for (const item of first.record.cases) {
        const other = second.record.cases.find((candidate) => candidate.name === item.name);
        if (item.aa === undefined || other?.aa === undefined) continue;
        const outcome = caseVerdict(item.aa, other.aa, limitsOf(item.name, record).options).outcome;
        nulls.push(outcome);
        if (decided(outcome)) cross.push(`${item.name}: ${String(first.id)} run ${first.record.run} against ${String(second.id)} run ${second.record.run} gives ${outcome}`);
      }
    }
  }
  console.log(`A/A against the A/A of another job, ${String(nulls.length)} verdicts: ${count(nulls)}.`);
  for (const line of cross) console.log(`  ${line}`);

  const replay = jobs.filter((job) => job.id === REPLAY_RUN);
  if (replay.length > 0) {
    const fixture: ReplayFixture = {
      run: REPLAY_RUN,
      case: REPLAY_CASE,
      jobs: replay.flatMap((job) => {
        const item = job.record.cases.find((candidate) => candidate.name === REPLAY_CASE);
        return item?.aa === undefined || item.head === undefined ? [] : [{ job: job.record.run, head: rounds(item.head), aa: rounds(item.aa) }];
      }),
    };
    writeFileSync(REPLAY_FILE, `${JSON.stringify(fixture)}\n`);
  }
  if (wrong.length > 0) process.exitCode = 1;
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
