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
 * The verdict of the split (D98) is an equivalence verdict. The ratios of a case are IN ORDER / A1 of each round.
 * The interval of the median is the 6th to the 15th of the 20 sorted ratios: P(6 <= Bin(20, 1/2) <= 14) =
 * 1005176 / 1048576 = 0.9586. The A/A interval is the same interval of the ratios A2 / A1. The effect interval E is
 * the interval of the median, made wider on each side by half the width of the A/A interval. The budget is the bound
 * of the bench (`merge.ts`, D50, D70): 1.5 % or two times the noise, whichever is larger. The noise is the median of
 * A2 / A1 minus 1. The verdict is "no change" when E is inside 1 +- budget. It is "slower" when the low end of E is
 * over 1 + budget, and "faster" when the high end of E is under 1 - budget. Else it is "cannot decide". A case stays
 * in order only with "no change". The GROUP arm gets the same verdict with its ratios GROUP / A1.
 *
 * The first rule of D98 stays in the table as information, because a prediction pinned it. A process is slow when its
 * IN ORDER time is over the maximum of the A1 times of the case. A case has a mode when 5 or more of 20 are slow.
 *
 * The script prints the tables and one line `MEASURE {json}`. With `MODE_JSON`, it writes each process to that file.
 * `MODE_PART` and `MODE_PARTS` select the part, and `MODE_PROCESSES` gives the rounds. The mode `merge` reads the
 * files of all parts and prints the tables for all cases. That mode uses only the modules of Node, and Node removes
 * its types. Thus the verdict job does not install the packages.
 */
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import type { Measured } from "./cases.ts";

/** A case has a mode when this number or more of its IN ORDER processes are slow (the first rule of D98). */
const MODE_LIMIT = 5;

type Arm = "alone 1" | "alone 2" | "in order" | "group";

/** The equivalence verdict of D98. Only "no change" keeps a case in order. */
type Decision = "no change" | "slower" | "faster" | "cannot decide";

/** The verdict of one arm against A1. */
interface Effect {
  /** The interval of the median of the ratios: the 6th to the 15th sorted value of 20. */
  readonly median: Band;
  /** The effect interval E: the interval of the median, wider on each side by half the A/A interval. */
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
  /** The bound of the bench: 1.5 % or two times the noise, whichever is larger. A fraction, not a percent. */
  readonly budget: number;
  readonly inOrder: Effect;
  /** True when the verdict is "no change": the case can stay in order. */
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

/** This function gives a quantile with linear steps between the sorted values (the type 7 of Hyndman and Fan). */
function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return (sorted[low] as number) + ((sorted[high] as number) - (sorted[low] as number)) * (at - low);
}

function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

/** The bound of the bench (`merge.ts`, D50, D70) as a fraction: the floor of 1.5 %. */
const FLOOR = 0.015;

/** This function gives the ratios `top[r] / bottom[r]` of each round. */
function ratios(top: readonly number[], bottom: readonly number[]): number[] {
  return top.map((value, round) => value / (bottom[round] as number));
}

/**
 * This function gives the distribution-free interval of the median of n values: the k-th to the (n + 1 - k)-th sorted
 * value. k is the largest number with P(Bin(n, 1/2) < k) <= 0.025. For 20 values, k is 6 and the coverage is 0.9586.
 */
function medianInterval(values: readonly number[]): Band {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  let [k, below, term] = [0, 0, 0.5 ** n];
  while (k < n && below + term <= 0.025) {
    below += term;
    term = (term * (n - k)) / (k + 1);
    k += 1;
  }
  const low = Math.max(k - 1, 0);
  return { low: sorted[low] as number, high: sorted[Math.min(n - 1 - low, n - 1)] as number };
}

/** This function gives the equivalence verdict of D98 for the ratios of one arm against A1. */
function decide(values: readonly number[], aa: Band, budget: number): Effect {
  const median = medianInterval(values);
  const half = (aa.high - aa.low) / 2;
  const effect = { low: median.low - half, high: median.high + half };
  let decision: Decision = "cannot decide";
  if (effect.low >= 1 - budget && effect.high <= 1 + budget) decision = "no change";
  else if (effect.low > 1 + budget) decision = "slower";
  else if (effect.high < 1 - budget) decision = "faster";
  return { median, effect, decision };
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
  const aaRatios = ratios(item.alone2, item.alone);
  const aa = medianInterval(aaRatios);
  const noise = median(aaRatios) - 1;
  const budget = Math.max(FLOOR, 2 * Math.abs(noise));
  const inOrder = decide(ratios(item.inOrder, item.alone), aa, budget);
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
    budget,
    inOrder,
    stays: inOrder.decision === "no change",
    slow,
    of: item.inOrder.length,
    mode: slow >= MODE_LIMIT,
    split: split.includes(item.name),
  };
  const group = item.group === undefined ? undefined : decide(ratios(item.group, item.alone), aa, budget);
  return {
    ...verdict,
    ...(item.group === undefined || group === undefined ? {} : { group: { ...group, ns: median(item.group), clean: group.decision === "no change" } }),
    ...(item.different === undefined ? {} : { different: item.different }),
  };
}

function range(value: Band): string {
  return `${value.low.toFixed(3)} to ${value.high.toFixed(3)}`;
}

function header(): string[] {
  return [
    "The ratios of each round are against A1. E is the interval of the median of IN ORDER / A1 (the 6th to the 15th of 20 sorted ratios, 95.9 %), wider on each side by half the same interval of A2 / A1 (the A/A column).",
    "The budget is 1.5 % or two times the noise (the median of A2 / A1 minus 1), whichever is larger. A case stays in order only when E is inside 1 +- budget: the verdict \"no change\".",
    `The columns Slow and Mode give the first rule of D98 as information: ${MODE_LIMIT} or more IN ORDER times over the A1 maximum.`,
    "",
    "| Case | Part | Alone median (ns) | In order median (ns) | In order / alone | E | A/A | Budget | Verdict | Slow | Mode | Bench |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- |",
  ];
}

function row(verdict: Verdict): string {
  if (verdict.different !== undefined) return `| ${verdict.name} | ${verdict.part} | different results: ${verdict.different} | | | | | | | | | | |`;
  const cells = [
    verdict.name,
    String(verdict.part),
    verdict.aloneNs.toFixed(1),
    verdict.inOrderNs.toFixed(1),
    verdict.ratio.toFixed(3),
    range(verdict.inOrder.effect),
    range(verdict.aa),
    `${(verdict.budget * 100).toFixed(1)} %`,
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
    "The GROUP arm runs only the cases that the bench keeps together, in their order. The group is clean when each case of it gets \"no change\" with GROUP / A1.",
    "",
    "| Case | Part | Alone median (ns) | Group median (ns) | E | Budget | Verdict |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((verdict) => {
      const group = verdict.group as NonNullable<Verdict["group"]>;
      return `| ${verdict.name} | ${verdict.part} | ${verdict.aloneNs.toFixed(1)} | ${group.ns.toFixed(1)} | ${range(group.effect)} | ${(verdict.budget * 100).toFixed(1)} % | ${group.decision} |`;
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
    budget: fixed(verdict.budget, 4),
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
