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
 * - GROUP: a new process runs only the cases that the bench keeps together, in their order.
 *
 * The job of part P of N measures each case whose index modulo N is P - 1. In each round, the A1 processes run in one
 * half and the A2 processes in the other half, in the opposite order. The halves change places in each second round.
 * The case order and the places of the IN ORDER and the GROUP processes turn in each round.
 *
 * The rule of the split (D98). The A/A band of a case is the 5th to the 95th percentile of its ratios A2 / A1 of each
 * round. The interval of a case is the same percentiles of its ratios IN ORDER / A1. A case stays in order only when
 * its interval is inside its A/A band on both sides. Else the bench gives it its own processes. The GROUP arm gets
 * the same check against A1, thus the record shows if the group of the bench is clean.
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
  /** The cases of `SPLIT` in `paths.ts`: the bench runs each in its own processes. */
  readonly split: readonly string[];
  /** The number of all cases of `cases.ts`. */
  readonly total: number;
  readonly processes: number;
  readonly seconds: number;
  readonly cases: readonly ModeCase[];
  /** Each process, in the order of the job: the raw records. */
  readonly records: readonly ModeProcess[];
}

/** The 5th and the 95th percentile of some ratios. */
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
  readonly aa: Band;
  readonly interval: Band;
  /** True when the interval is inside the A/A band on both sides: the case can stay in order. */
  readonly stays: boolean;
  readonly slow: number;
  readonly of: number;
  readonly mode: boolean;
  /** True when the bench runs the case in its own processes. */
  readonly split: boolean;
  /** The GROUP arm, when the bench keeps the case together. */
  readonly group?: { readonly ns: number; readonly interval: Band; readonly clean: boolean };
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

/** This function gives the band of the ratios `top[r] / bottom[r]` of each round. */
function band(top: readonly number[], bottom: readonly number[]): Band {
  const ratios = top.map((value, round) => value / (bottom[round] as number));
  return { low: quantile(ratios, 0.05), high: quantile(ratios, 0.95) };
}

function inside(interval: Band, aa: Band): boolean {
  return interval.low >= aa.low && interval.high <= aa.high;
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
  const aa = band(item.alone2, item.alone);
  const interval = band(item.inOrder, item.alone);
  const verdict: Verdict = {
    index: item.index,
    name: item.name,
    part,
    aloneNs,
    aloneMaxNs,
    inOrderNs,
    ratio: inOrderNs / aloneNs,
    aa,
    interval,
    stays: inside(interval, aa),
    slow,
    of: item.inOrder.length,
    mode: slow >= MODE_LIMIT,
    split: split.includes(item.name),
  };
  const group = item.group === undefined ? undefined : band(item.group, item.alone);
  return {
    ...verdict,
    ...(item.group === undefined || group === undefined ? {} : { group: { ns: median(item.group), interval: group, clean: inside(group, aa) } }),
    ...(item.different === undefined ? {} : { different: item.different }),
  };
}

function range(value: Band): string {
  return `${value.low.toFixed(3)} to ${value.high.toFixed(3)}`;
}

function header(): string[] {
  return [
    "The A/A band and the interval are the 5th to the 95th percentile of the ratios of each round, against A1. A case stays in order only when its interval is inside its A/A band.",
    `The columns Slow and Mode give the first rule of D98 as information: ${MODE_LIMIT} or more IN ORDER times over the A1 maximum.`,
    "",
    "| Case | Part | Alone median (ns) | In order median (ns) | In order / alone | Interval | A/A band | Rule | Slow | Mode | Bench |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- |",
  ];
}

function row(verdict: Verdict): string {
  if (verdict.different !== undefined) return `| ${verdict.name} | ${verdict.part} | different results: ${verdict.different} | | | | | | | | |`;
  const cells = [
    verdict.name,
    String(verdict.part),
    verdict.aloneNs.toFixed(1),
    verdict.inOrderNs.toFixed(1),
    verdict.ratio.toFixed(3),
    range(verdict.interval),
    range(verdict.aa),
    verdict.stays ? "stays" : "splits",
    `${verdict.slow} of ${verdict.of}`,
    verdict.mode ? "yes" : "no",
    verdict.split ? "own processes" : "in order",
  ];
  return `| ${cells.join(" | ")} |`;
}

/** This function gives the table of the GROUP arm: the cases that the bench keeps together. */
function groupTable(verdicts: readonly Verdict[]): string[] {
  const rows = verdicts.filter((verdict) => verdict.group !== undefined);
  if (rows.length === 0) return [];
  return [
    "",
    "The GROUP arm runs only the cases that the bench keeps together, in their order. The group is clean when each interval is inside its A/A band.",
    "",
    "| Case | Part | Alone median (ns) | Group median (ns) | Group interval | A/A band | Clean |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((verdict) => {
      const group = verdict.group as NonNullable<Verdict["group"]>;
      return `| ${verdict.name} | ${verdict.part} | ${verdict.aloneNs.toFixed(1)} | ${group.ns.toFixed(1)} | ${range(group.interval)} | ${range(verdict.aa)} | ${group.clean ? "yes" : "no"} |`;
    }),
  ];
}

/** This function gives a line for each case where the rule and `SPLIT` of `paths.ts` do not agree. */
function disagree(verdicts: readonly Verdict[]): string[] {
  const join = verdicts.filter((verdict) => verdict.split && verdict.stays).map((verdict) => verdict.name);
  const leave = verdicts.filter((verdict) => !verdict.split && !verdict.stays).map((verdict) => verdict.name);
  const lines: string[] = [];
  if (leave.length > 0) lines.push("", `The bench runs these cases in order, but the rule splits them: ${leave.join(", ")}. Add them to \`SPLIT\`.`);
  if (join.length > 0) lines.push("", `The bench splits these cases, but the rule keeps them in order: ${join.join(", ")}. Remove them from \`SPLIT\`.`);
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
    interval: two(verdict.interval),
    aa: two(verdict.aa),
    stays: verdict.stays,
    slow: verdict.slow,
    mode: verdict.mode,
    split: verdict.split,
    ...(verdict.group === undefined ? {} : { group: { ns: fixed(verdict.group.ns), interval: two(verdict.group.interval), clean: verdict.group.clean } }),
  };
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
  const { FLAGS, SPLIT, bundle, groups, measureCopy } = await import("./paths.ts");
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
  // The cases that the bench keeps together: the first group of `groups`, when no case of it is in SPLIT.
  const together = groups(names)[0]?.filter((index) => !SPLIT.includes(names[index] as string)) ?? [];
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
    split: SPLIT,
    total: first.length,
    processes,
    seconds: fixed((performance.now() - started) / 1000),
    cases,
    records,
  };
  const verdicts = cases.map((item) => judge(item, part, SPLIT));
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
  const verdicts = runs.flatMap((run) => run.cases.map((item) => judge(item, run.part, run.split))).sort((a, b) => a.index - b.index);
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
    `The rule splits ${splits.length} of ${verdicts.length} cases: ${splits.map((verdict) => verdict.name).join(", ")}.`,
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
