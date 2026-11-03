/*
 * The limits of the time verdict of each case: the margin and the noise cap of its family (K214, D116).
 *
 * The file `limits.json` keeps the A/A statistics of each case in each CI bench job, and the limits that come from
 * them. `refresh.ts` writes it from the downloaded records of the Speed workflow. This file reads it, and it gives the
 * options of `timeVerdict` for each case. The verdict logic stays in `@mark1russell7/rigor-bench`.
 *
 * The formula of each family F, on a log scale. Each job j gives two values over the cases of F:
 *
 *   median(j) = the largest |median of the log ratios of the A/A rounds| of a case of F in the job j
 *   spread(j) = the largest A/A spread `aaSpread` (level 0.9, over the rounds) of a case of F in the job j
 *
 *   margin(F)   = max(ln(1.015), M + (M - m)), with M and m the largest and the smallest median(j) of the jobs
 *   noiseCap(F) = S + (S - s), with S and s the largest and the smallest spread(j) of the jobs
 *
 * This is the rule of the gate limits: the worst of 5 or more CI jobs plus their spread (max - min), with no factor.
 * Each limit goes up to the next 0.0001. The fallback limits use the same formula over all cases of all families.
 */
import { readFileSync } from "node:fs";
import type { VerdictOptions } from "@mark1russell7/rigor-bench";

/** The families of the cases of `cases.ts`. Each family holds similar cases with a similar A/A noise. */
export const FAMILIES = {
  formula: ["FORMULA.SPEED formula", "the same formula, with a list of reads"],
  reference: [
    "a reference of five steps",
    "a reference into a host thing with resolve",
    "a reference through an envelope",
    "a reference with a step document",
    "resolve without hops, five steps",
  ],
  plan: [
    "PLAN.FOLD a record of 20 literals",
    "PLAN.TOTAL a record of 20 literals, without folds",
    "PLAN.FIXED a path of four steps from a fixed name",
    "PLAN.PATH the same path, without the declaration",
    "PLAN.FIXED a formula with a fixed name and a free name",
    "PLAN.COMPILE-SPEED prepare",
  ],
  tree: ["a tree with an equation", "the same tree, with a list of reads", "factsOf a tree with an equation"],
} as const satisfies Record<string, readonly string[]>;

export type Family = keyof typeof FAMILIES;

/** The floor of the margin: the old bound of 1.5 % (D50, D70, D114), on a log scale. */
export const MARGIN_FLOOR = Math.log(1.015);

/** The fewest CI jobs that give the limits of a family. With fewer jobs, the family uses the fallback limits. */
export const MINIMUM_JOBS = 5;

/** The A/A statistics of one case in one job, on a log scale: the median of the rounds and the spread `aaSpread`. */
export type JobStat = readonly [median: number, spread: number];

/** The limits of one family, on a log scale. */
export interface Limits {
  readonly margin: number;
  readonly noiseCap: number;
  /** The most jobs with the A/A records of one case. */
  readonly jobs: number;
  /** The source of the limits: the records of the family, or the fallback of all families. */
  readonly source: "family" | "fallback";
}

/** The record of `limits.json`. */
export interface LimitsRecord {
  /** The ids of the Speed workflow runs, and the jobs (`matrix.run`) of each run, in the order of `stats`. */
  readonly runs: readonly { readonly id: number; readonly jobs: readonly string[] }[];
  /** The A/A statistics of each case, one item for each job, in the order of `runs`. */
  readonly stats: Readonly<Record<string, readonly JobStat[]>>;
  readonly limits: Readonly<Record<Family, Limits>>;
  readonly fallback: Limits;
}

/** The limits of one case, with their source. */
export interface CaseLimits {
  /** The family of the case, or undefined when the case has no family. */
  readonly family: Family | undefined;
  /** This value is `true` when the case uses the fallback limits. */
  readonly fallback: boolean;
  readonly options: VerdictOptions;
}

/** This function gives the family of a case, or undefined for a case that no family names. */
export function familyOf(name: string): Family | undefined {
  return (Object.keys(FAMILIES) as Family[]).find((family) => (FAMILIES[family] as readonly string[]).includes(name));
}

/** This function rounds a limit up to the next 0.0001, thus the jobs of the limit stay inside it. */
function up(value: number): number {
  return Math.ceil(value * 10_000 - 1e-9) / 10_000;
}

/** This function gives the worst value of each job: the largest value of a case in the job. */
export function worstOfJobs(cases: readonly (readonly JobStat[])[], value: (stat: JobStat) => number): number[] {
  const jobs = Math.max(0, ...cases.map((list) => list.length));
  return Array.from({ length: jobs }, (_, job) => Math.max(...cases.flatMap((list) => (list[job] === undefined ? [] : [value(list[job])]))));
}

/**
 * This function gives the limits of the cases of a family: the formula at the start of this file. Each list of
 * `cases` holds the statistics of one case, one item for each job.
 */
export function limitsOfStats(cases: readonly (readonly JobStat[])[], source: Limits["source"]): Limits {
  const medians = worstOfJobs(cases, ([median]) => Math.abs(median));
  const spreads = worstOfJobs(cases, ([, spread]) => spread);
  if (medians.length === 0) throw new RangeError("The limits need the A/A statistics of one job or more.");
  const [bigMedian, smallMedian] = [Math.max(...medians), Math.min(...medians)];
  const [bigSpread, smallSpread] = [Math.max(...spreads), Math.min(...spreads)];
  const margin = up(Math.max(MARGIN_FLOOR, bigMedian + (bigMedian - smallMedian)));
  return { margin, noiseCap: up(bigSpread + (bigSpread - smallSpread)), jobs: medians.length, source };
}

/**
 * This function gives the limits of each family and the fallback limits from the A/A statistics of each case. A family
 * whose cases have fewer than `MINIMUM_JOBS` jobs gets the fallback limits. The function refuses fewer jobs in all.
 */
export function deriveLimits(record: Pick<LimitsRecord, "runs" | "stats">): Pick<LimitsRecord, "limits" | "fallback"> {
  const jobsOf = (names: readonly string[]): number => Math.max(0, ...names.map((name) => record.stats[name]?.length ?? 0));
  const jobs = jobsOf(Object.keys(record.stats));
  if (jobs < MINIMUM_JOBS) throw new RangeError(`The limits need the A/A records of ${String(MINIMUM_JOBS)} or more CI jobs, not ${String(jobs)}.`);
  const fallback = limitsOfStats(Object.values(record.stats), "fallback");
  const limits = Object.fromEntries(
    (Object.keys(FAMILIES) as Family[]).map((family) => {
      const names = FAMILIES[family] as readonly string[];
      const count = jobsOf(names);
      return [family, count < MINIMUM_JOBS ? fallback : limitsOfStats(names.map((name) => record.stats[name] ?? []), "family")];
    }),
  ) as Record<Family, Limits>;
  return { limits, fallback };
}

/** The file of the record. `refresh.ts` writes it. */
export const LIMITS_FILE = new URL("./limits.json", import.meta.url);

let kept: LimitsRecord | undefined;

/** This function gives the record of the limits in `limits.json`. It reads the file at the first use. */
export function limitsRecord(): LimitsRecord {
  kept ??= JSON.parse(readFileSync(LIMITS_FILE, "utf8")) as LimitsRecord;
  return kept;
}

/** This function gives the options of `timeVerdict` for one case: the limits of its family, or the fallback limits. */
export function limitsOf(name: string, record: LimitsRecord = limitsRecord()): CaseLimits {
  const family = familyOf(name);
  const limits = family === undefined ? record.fallback : record.limits[family];
  return { family, fallback: limits.source === "fallback", options: { margin: limits.margin, noiseCap: limits.noiseCap } };
}

/** This function gives a limit on a log scale as a percent with two decimals, for example `2.57 %`. */
export function percentOf(limit: number): string {
  return `${((Math.exp(limit) - 1) * 100).toFixed(2)} %`;
}
