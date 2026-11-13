/*
 * The slope of the walks of STATIC.LINEAR on a log-log ladder (K208, D97).
 *
 *   pnpm exec tsx packages/core/bench/ladder.ts [<levels of the first rung> [<rounds>]]
 *   node packages/core/bench/ladder.ts merge <run 1 JSON> <run 2 JSON> ...
 *
 * STATIC.LINEAR says that a walk takes time linear in the size of the document. One ratio of two sizes cannot tell a
 * constant factor from a power. Thus this script measures each walk at four sizes: N, 2N, 4N and 8N levels of
 * `op("add", doc, 1)`. In each round, it fits the slope of log t against log n by least squares. A linear walk gives
 * a slope of 1, and a walk of the square of the size gives 2.
 *
 * All rungs run in one process, in turns. Each round has some passes, and each pass measures each arm one time. The
 * order of the arms turns by one place in each pass, and it goes back to front in each second round. Thus no rung
 * gets the start or the end of a round more often than another rung. The time of a rung in a round is the median of
 * its passes. Each sample walks 8N levels: 8 calls at N, 4 at 2N, 2 at 4N and 1 at 8N.
 *
 * The A/A arm is a second document of 4N levels, made in the same way, and measured in the same passes. Its ratio to
 * the first document of 4N levels is the noise of one rung. It must be near 1.
 *
 * STATIC.LINEAR also says that a walk takes memory linear in the size of the document (K209, D105). After all timed
 * rounds, a second phase measures the bytes that one call allocates, in calls of their own. Thus the timed passes keep
 * the conditions of D97, and the process starts with no flags of V8. Each measured call starts after a full collection
 * by `gc()`. The bytes are the change of `heapUsed` across the call, plus the bytes that each collection in the call
 * frees. A `GCProfiler` gives those collections. Thus a scavenge in the call loses no bytes. The script subtracts the
 * bytes of an empty measure. The memory phase uses the same rungs, the same turns, the same A/A arm and the same rounds.
 * Each round fits the slope of log bytes against log n. The memory verdict is only an upper bound. A slope well under 1
 * shows a large fixed part of the bytes of a call, and that slope also passes.
 *
 * The script prints two tables and one line `MEASURE {json}`. With `LADDER_JSON`, it also writes the slopes of each
 * round to that file. `LADDER_RUN` names the run. The mode `merge` reads the files of some runs, pools their slopes
 * and gives the verdict. Node removes the types of this script. The verdict job installs the packages, because the
 * script imports `@mark1russell7/rigor-statistics` (D114). The workflow `measure.yml` runs the ladder in CI, because
 * a shared machine gives unreliable numbers.
 *
 * The mode `merge` prints the gate of the verdicts as report only (K227, D164). With `LADDER_BLOCK=1`, a block gives the
 * exit code 3. It also prints the smallest slope that gives a block with the spread of its own runs. Under that size, it
 * has no read. With `LADDER_INJECT=s`, each call walks more levels, so the levels of one call grow as `n^s`. The count of
 * calls does not change, so the fault of a flip keeps the setting of the plain gate.
 *
 * The statistics come from `@mark1russell7/rigor-statistics`: the median, the quantiles, the least squares fit, the
 * mean and the standard deviation (D114). The verdicts and the t quantile stay here, because the shared packages do not
 * have them. A comment names the issue of each gap.
 */
import { leastSquares, mean, median, quantile, sd } from "@mark1russell7/rigor-statistics";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { allocated, exposedGc } from "./memory.ts";

type Kernel = typeof import("../src/index.ts");

/** The measures of one walk in one run. */
interface WalkRun {
  readonly name: string;
  /** The median time of one call at each rung, across the rounds, in nanoseconds. */
  readonly ns: readonly number[];
  /** The slope of each round. */
  readonly slopes: readonly number[];
  /** The A/A ratio of each round: the second document of 4N levels against the first. */
  readonly aa: readonly number[];
  /** The visits or the references of one call at each rung. They show the work of one call. */
  readonly counts: readonly number[];
  /** The median bytes that one call allocates at each rung, across the rounds. */
  readonly bytes: readonly number[];
  /** The slope of log bytes against log n in each round. */
  readonly byteSlopes: readonly number[];
  /** The A/A ratio of the bytes in each round: the second document of 4N levels against the first. */
  readonly byteAa: readonly number[];
}

/** The measures of one run. */
interface LadderRun {
  readonly run: string;
  /** The id and the attempt of the CI run, when a CI run made it. */
  readonly ci?: string | undefined;
  readonly cpu: string;
  readonly node: string;
  readonly levels: readonly number[];
  readonly rounds: number;
  readonly passes: number;
  readonly seconds: number;
  /** The seconds of the memory phase. `seconds` includes them. */
  readonly memorySeconds: number;
  /** The median bytes of an empty measure, across the rounds. The bytes of each walk do not include them. */
  readonly baseBytes: number;
  readonly walks: readonly WalkRun[];
}

/** The steps of the rungs, as multiples of N. */
const STEPS = [1, 2, 4, 8] as const;
/** The rung with a second document: the A/A arm. */
const AA_STEP = 4;
/** The passes of one round. The time of a rung in the round is the median of its passes. */
const PASSES = 5;
/** The rounds before the measures. Their times do not count. They give the compiler the same code for each rung. */
const WARM_ROUNDS = 2;
/** The claim is linear when the interval contains 1 and its upper end is less than this value. */
const UPPER = 1.2;
/**
 * The one-sided quantile of 0.95 of the t distribution for 1 to 10 degrees of freedom: a 90 % interval.
 *
 * GAP (mark1russell7/rigor#36): rigor-statistics has no t quantile. Thus this table stays.
 */
const T95 = [6.314, 2.92, 2.353, 2.132, 2.015, 1.943, 1.895, 1.86, 1.833, 1.812] as const;

/** This function gives the slope of the least squares line of log y against log x: `leastSquares` of rigor-statistics. */
function slope(xs: readonly number[], ys: readonly number[]): number {
  return leastSquares(xs.map((x) => [Math.log(x)]), ys.map(Math.log)).coefficients[1] as number;
}

/**
 * This function gives the mean and the half width of its 90 % interval: t times the standard error.
 *
 * GAP (mark1russell7/rigor#36): rigor-statistics has no interval of a mean with the t distribution.
 */
function meanInterval(values: readonly number[]): { readonly mean: number; readonly half: number } {
  const center = mean(values);
  if (values.length < 2) return { mean: center, half: Number.NaN };
  const t = T95[Math.min(values.length - 1, T95.length) - 1] as number;
  return { mean: center, half: (t * sd(values)) / Math.sqrt(values.length) };
}

function fixed(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

/*
 * GAP (mark1russell7/rigor#35): rigor-bench has no verdict of a slope claim and no A/A check of a ladder run. Thus
 * `verdict`, `memoryVerdict` and `counts` stay here.
 */

/** This function gives the verdict of an interval: linear when it contains 1 and its upper end is under `UPPER`. */
function verdict(low: number, high: number): string {
  return low <= 1 && high >= 1 && high < UPPER ? "linear" : "not linear";
}

/**
 * This function gives the memory verdict of an interval: at most linear when its upper end is at most `UPPER`. It is
 * only an upper bound, thus a low end under 1 also passes (D105).
 */
function memoryVerdict(_low: number, high: number): string {
  return high <= UPPER ? "at most linear" : "over the bound";
}

/** The summary of the slopes of one walk: the median and the 90 % interval (the 5th and the 95th percentile). */
function summarize(walk: { readonly slopes: readonly number[]; readonly aa: readonly number[] }, judge = verdict) {
  const p05 = quantile(walk.slopes, 0.05);
  const p95 = quantile(walk.slopes, 0.95);
  return {
    slope: fixed(median(walk.slopes)),
    p05: fixed(p05),
    p95: fixed(p95),
    aa: fixed(median(walk.aa)),
    aaP05: fixed(quantile(walk.aa, 0.05)),
    aaP95: fixed(quantile(walk.aa, 0.95)),
    verdict: judge(p05, p95),
  };
}

/** The summary of the memory slopes of one walk, with the memory verdict (D105). */
function memorySummary(walk: { readonly byteSlopes: readonly number[]; readonly byteAa: readonly number[] }) {
  return summarize({ slopes: walk.byteSlopes, aa: walk.byteAa }, memoryVerdict);
}

/** This function gives the order of the arms in one pass: it turns by one place in each pass, and back to front in each second round. */
function orderOf(round: number, pass: number, length: number): number[] {
  const turn = (round * PASSES + pass) % length;
  const order = Array.from({ length }, (_, index) => (index + turn) % length);
  if (round % 2 === 1) order.reverse();
  return order;
}

function writeSummary(lines: readonly string[]): void {
  const text = `${lines.join("\n")}\n`;
  process.stdout.write(text);
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (file !== undefined && file !== "") appendFileSync(file, `${text}\n`);
}

/** This function gives a document of `levels` nested additions around one reference. */
function chain(levels: number): unknown {
  let doc: unknown = { type: "ref", value: ["names", "x"] };
  for (let index = 0; index < levels; index += 1) doc = { type: ["ops", "add"], value: [doc, 1] };
  return doc;
}

/**
 * This function gives a deep tree of the standard machine: `levels` panels, each in the list `children` of the panel
 * above it (K255, TREE.GRAPH-DEPTH). With `ref`, the root reads the JSON of its first child, thus each panel under it.
 */
function panels(levels: number, ref: boolean): unknown {
  let value: Record<string, unknown> = { width: 1 };
  for (let index = 1; index < levels; index += 1) value = { children: { type: "list", value: [{ type: "panel", value }] } };
  return { type: "panel", value: ref ? { ...value, width: { type: "ref", value: ["self", "children", 0] } } : value };
}

/**
 * This function gives a panel with one inner panel of `size` boxes, then `size` boxes whose width is a reference to the
 * inner panel. Each reference reads the JSON of one large node (K256, TREE.GRAPH-JSON).
 */
function shared(size: number): unknown {
  const boxes = Array.from({ length: size }, () => ({ type: "box", value: { width: 1 } }));
  const ref = { type: "ref", value: ["self", "parent", "children", 0] };
  const readers = Array.from({ length: size }, () => ({ type: "box", value: { width: ref } }));
  return { type: "panel", value: { children: { type: "list", value: [{ type: "panel", value: { children: { type: "list", value: boxes } } }, ...readers] } } };
}

/**
 * This function gives the fault of a flip test: a call that walks its document `times` more times, then a shorter document.
 * No document is deeper than its rung, so the fault does not reach the limit of the stack (K227, D164).
 */
function faulted(call: (doc: unknown) => number, times: number, rest: unknown): (doc: unknown) => number {
  return (doc) => {
    let total = call(doc);
    for (let time = 0; time < times; time += 1) total += call(doc);
    return rest === undefined ? total : total + call(rest);
  };
}

/** This function gives the smallest true slope that the time verdict tells from 1: the interval leaves 1 or passes `UPPER`. */
function seenTime(low: number, high: number): number {
  const half = (high - low) / 2;
  return fixed(Math.min(1 + half, UPPER - half));
}

/** This function gives the smallest true slope that the memory verdict blocks: the upper end passes `UPPER`. */
function seenMemory(low: number, high: number): number {
  return fixed(UPPER - (high - low) / 2);
}

/** This function gives the true slope of the fault from `LADDER_INJECT`, or nothing with no fault (K227, D164). */
function injectedSlope(): number | undefined {
  const text = process.env["LADDER_INJECT"];
  if (text === undefined || text === "") return undefined;
  const slope = Number(text);
  if (!(slope >= 1)) throw new Error("Give a slope of at least 1 in LADDER_INJECT.");
  return slope;
}

async function measure(): Promise<void> {
  const kernel: Kernel = await import("../src/index.ts");
  const base = Number(process.argv[2] ?? 250);
  const rounds = Number(process.argv[3] ?? 30);
  if (!Number.isInteger(base) || base < 1 || !Number.isInteger(rounds) || rounds < 1) throw new Error("Give whole numbers of levels and rounds.");
  const started = performance.now();
  const world = { kinds: kernel.formulaKinds(), defaults: {} };
  // The machine of the deep trees: the standard machine with a depth limit above the deepest rung. Thus `check` reads
  // the whole tree at each rung (K255).
  const deep = { ...kernel.STD_MACHINE, maxDepth: Number.MAX_SAFE_INTEGER };
  const levels = STEPS.map((step) => step * base);
  // The arms of each walk: the four rungs, then the second document of the rung AA_STEP.
  const calls = [...STEPS.map((step) => 8 / step), 8 / AA_STEP];
  const steps = [...STEPS, AA_STEP];
  const aaIndex = STEPS.indexOf(AA_STEP);
  let visits = 0;
  /** One walk: its name, the document of a rung, the call, and the work of one call for the table. */
  interface Walk {
    readonly name: string;
    readonly make: (levels: number) => unknown;
    readonly call: (doc: unknown) => number;
    readonly work?: (doc: unknown) => number;
  }
  const quarter = (n: number): number => Math.max(1, Math.round(n / 4));
  const walks: readonly Walk[] = [
    // The walk of the claim: the references of a document.
    { name: "refsOf", make: chain, call: (doc) => kernel.refsOf(world, doc).length },
    // The walk under refsOf, with a visit that only counts.
    {
      name: "walk",
      make: chain,
      call: (doc) => {
        visits = 0;
        kernel.walk(world, doc, () => {
          visits += 1;
        });
        return visits;
      },
    },
    // `check` of a deep tree: the first walk and the graph of attribute instances (K255, TREE.GRAPH-DEPTH). A panel costs
    // more than a level of the chain, thus a rung of n levels has n / 4 panels. The work is the count of the edges of the graph.
    { name: "check tree", make: (n) => panels(quarter(n), false), call: (doc) => kernel.check(deep, doc).length, work: (doc) => kernel.attributeGraph(deep, doc).edges.length },
    // The same tree, and the root reads the JSON of its first child.
    { name: "check tree ref", make: (n) => panels(quarter(n), true), call: (doc) => kernel.check(deep, doc).length, work: (doc) => kernel.attributeGraph(deep, doc).edges.length },
    // A wide tree: n / 4 references to one node of n / 4 boxes. Each reference reads one JSON vertex (K256, TREE.GRAPH-JSON).
    { name: "check shared", make: (n) => shared(quarter(n)), call: (doc) => kernel.check(deep, doc).length, work: (doc) => kernel.attributeGraph(deep, doc).edges.length },
  ];
  const docs = walks.map((walk) => steps.map((step) => walk.make(step * base)));
  const results: WalkRun[] = [];
  // arms[walk * docs.length + doc]
  // With a fault, one call walks step^(s-1) times the levels of its rung, so the slope over the rungs is s.
  const fault = injectedSlope();
  const callOf = (walk: Walk, step: number): ((doc: unknown) => number) => {
    if (fault === undefined) return walk.call;
    const more = step ** (fault - 1) - 1;
    const times = Math.floor(more);
    const rest = Math.round(step * base * (more - times));
    return times === 0 && rest === 0 ? walk.call : faulted(walk.call, times, rest === 0 ? undefined : walk.make(rest));
  };
  const arms = walks.flatMap((walk, w) => (docs[w] as unknown[]).map((doc, d) => ({ w, d, call: callOf(walk, steps[d] as number), doc })));
  // times[arm][round] in nanoseconds for one call
  const times: number[][] = arms.map(() => []);
  for (let round = 0; round < WARM_ROUNDS + rounds; round += 1) {
    const passes: number[][] = arms.map(() => []);
    for (let pass = 0; pass < PASSES; pass += 1) {
      for (const index of orderOf(round, pass, arms.length)) {
        const arm = arms[index] as (typeof arms)[number];
        const count = calls[arm.d] as number;
        const start = process.hrtime.bigint();
        for (let call = 0; call < count; call += 1) arm.call(arm.doc);
        const ns = Number(process.hrtime.bigint() - start) / count;
        (passes[index] as number[]).push(ns);
      }
    }
    if (round >= WARM_ROUNDS) passes.forEach((samples, index) => (times[index] as number[]).push(median(samples)));
  }
  // The memory phase (K209, D105). It starts after all timed rounds, thus the timed passes keep the conditions of D97.
  const memoryStarted = performance.now();
  const gc = exposedGc();
  const empty = (): number => 0;
  // bytes[arm][round]: the bytes of one call, less the bytes of an empty measure in the same round
  const bytes: number[][] = arms.map(() => []);
  const bases: number[] = [];
  for (let round = 0; round < WARM_ROUNDS + rounds; round += 1) {
    const passes: number[][] = arms.map(() => []);
    const base: number[] = [];
    for (let pass = 0; pass < PASSES; pass += 1) {
      base.push(allocated(gc, empty));
      for (const index of orderOf(round, pass, arms.length)) {
        const arm = arms[index] as (typeof arms)[number];
        (passes[index] as number[]).push(allocated(gc, () => arm.call(arm.doc)));
      }
    }
    if (round < WARM_ROUNDS) continue;
    const zero = median(base);
    bases.push(zero);
    passes.forEach((samples, index) => (bytes[index] as number[]).push(median(samples) - zero));
  }
  const memorySeconds = fixed((performance.now() - memoryStarted) / 1000, 1);
  walks.forEach((walk, w) => {
    const of = (d: number): number[] => times[w * steps.length + d] as number[];
    const ofBytes = (d: number): number[] => bytes[w * steps.length + d] as number[];
    const slopes: number[] = [];
    const aa: number[] = [];
    const byteSlopes: number[] = [];
    const byteAa: number[] = [];
    for (let round = 0; round < rounds; round += 1) {
      slopes.push(slope(levels, STEPS.map((_, d) => of(d)[round] as number)));
      aa.push((of(steps.length - 1)[round] as number) / (of(aaIndex)[round] as number));
      byteSlopes.push(slope(levels, STEPS.map((_, d) => ofBytes(d)[round] as number)));
      byteAa.push((ofBytes(steps.length - 1)[round] as number) / (ofBytes(aaIndex)[round] as number));
    }
    const counts = STEPS.map((_, d) => (walk.work ?? walk.call)((docs[w] as unknown[])[d]));
    const ns = STEPS.map((_, d) => median(of(d)));
    results.push({ name: walk.name, ns, slopes, aa, counts, bytes: STEPS.map((_, d) => median(ofBytes(d))), byteSlopes, byteAa });
  });
  const run: LadderRun = {
    run: process.env["LADDER_RUN"] ?? "1",
    ci: process.env["GITHUB_RUN_ID"] === undefined ? undefined : `${process.env["GITHUB_RUN_ID"]}/${process.env["GITHUB_RUN_ATTEMPT"] ?? "1"}`,
    cpu: cpus()[0]?.model.trim() ?? "an unknown CPU",
    node: process.version,
    levels,
    rounds,
    passes: PASSES,
    seconds: fixed((performance.now() - started) / 1000, 1),
    memorySeconds,
    baseBytes: median(bases),
    walks: results,
  };
  const lines = [
    `### Ladder run ${run.run}`,
    "",
    `${run.cpu}, Node ${run.node}. ${rounds} rounds of ${PASSES} passes, after ${WARM_ROUNDS} rounds to warm up. The ladder took ${run.seconds} s.`,
    "The slope is the median of the rounds, and the interval is the 5th to the 95th percentile of the rounds.",
    "The A/A ratio compares two documents of the same size in the same passes. It must be near 1.",
    "",
    `| Walk | ${levels.map((n) => `${n} levels (ms)`).join(" | ")} | Work at each rung | Slope | 90 % interval | A/A ratio | Verdict |`,
    `| --- | ${levels.map(() => "---:").join(" | ")} | --- | ---: | ---: | ---: | --- |`,
  ];
  const measures: Record<string, unknown>[] = [];
  for (const walk of results) {
    const s = summarize(walk);
    const m = memorySummary(walk);
    measures.push({ walk: walk.name, ...s, ms: walk.ns.map((ns) => fixed(ns / 1e6)), memory: { ...m, kb: walk.bytes.map((value) => fixed(value / 1024, 1)) } });
    lines.push(
      `| \`${walk.name}\` | ${walk.ns.map((ns) => (ns / 1e6).toFixed(3)).join(" | ")} | ${walk.counts.join(", ")} | ${s.slope.toFixed(3)} | ${s.p05.toFixed(3)} to ${s.p95.toFixed(3)} | ${s.aa.toFixed(3)} (${s.aaP05.toFixed(3)} to ${s.aaP95.toFixed(3)}) | ${s.verdict} |`,
    );
  }
  lines.push(
    "",
    `The memory phase took ${run.memorySeconds} s, after the timed rounds. Each value is the bytes that one call allocates, less the ${run.baseBytes} bytes of an empty measure.`,
    `The memory verdict is an upper bound only: the upper end of the interval is at most ${UPPER}. A slope under 1 also passes.`,
    "",
    `| Walk | ${levels.map((n) => `${n} levels (KB)`).join(" | ")} | Bytes per level at ${levels[levels.length - 1]} | Slope | 90 % interval | A/A ratio | Verdict |`,
    `| --- | ${levels.map(() => "---:").join(" | ")} | ---: | ---: | ---: | ---: | --- |`,
  );
  for (const walk of results) {
    const m = memorySummary(walk);
    const top = walk.bytes[walk.bytes.length - 1] as number;
    lines.push(
      `| \`${walk.name}\` | ${walk.bytes.map((value) => (value / 1024).toFixed(1)).join(" | ")} | ${(top / (levels[levels.length - 1] as number)).toFixed(1)} | ${m.slope.toFixed(3)} | ${m.p05.toFixed(3)} to ${m.p95.toFixed(3)} | ${m.aa.toFixed(3)} (${m.aaP05.toFixed(3)} to ${m.aaP95.toFixed(3)}) | ${m.verdict} |`,
    );
  }
  writeSummary(lines);
  process.stdout.write(`MEASURE ${JSON.stringify({ id: "STATIC.LINEAR", run: run.run, ci: run.ci, levels, rounds, seconds: run.seconds, walks: measures })}\n`);
  const out = process.env["LADDER_JSON"];
  if (out !== undefined && out !== "") writeFileSync(out, `${JSON.stringify(run)}\n`);
}

/** This function tells if a run counts: the A/A band of each walk contains 1. Else the run measured the runner. */
function counts(run: LadderRun): boolean {
  return run.walks.every((walk) => quantile(walk.aa, 0.05) <= 1 && quantile(walk.aa, 0.95) >= 1);
}

/** This function gives the name of a run: its CI run id and attempt, and its place in the matrix. */
function runName(run: LadderRun): string {
  return run.ci === undefined ? run.run : `${run.ci} (${run.run})`;
}

/** This function pools the rounds of the runs that count and gives the verdict of each walk. */
function merge(files: readonly string[]): void {
  if (files.length === 0) throw new Error("Give the JSON files of the runs.");
  const all = files.map((file) => JSON.parse(readFileSync(file, "utf8")) as LadderRun);
  const runs = all.filter(counts);
  const names = all[0]?.walks.map((walk) => walk.name) ?? [];
  const lines = [
    `### Ladder verdict of ${runs.length} counted runs of ${all.length}`,
    "",
    `Levels ${all[0]?.levels.join(", ")}. A run counts only when the A/A band of each walk contains 1.0. The band is the 5th to the 95th percentile of the rounds.`,
    "",
    `| Run | CPU | Time (s) | ${names.map((name) => `A/A band of \`${name}\``).join(" | ")} | Counts |`,
    `| --- | --- | ---: | ${names.map(() => "---:").join(" | ")} | --- |`,
  ];
  for (const run of all) {
    const bands = run.walks.map((walk) => `${quantile(walk.aa, 0.05).toFixed(3)} to ${quantile(walk.aa, 0.95).toFixed(3)}`);
    lines.push(`| ${runName(run)} | ${run.cpu} | ${run.seconds} | ${bands.join(" | ")} | ${counts(run) ? "yes" : "no: replace it"} |`);
  }
  lines.push(
    "",
    "The pooled interval is the 5th to the 95th percentile of the slopes of all rounds of the counted runs. The verdict reads it.",
    "The interval of the runs is the mean of the medians of the counted runs, plus or minus t times the standard error (90 %).",
    `The claim is linear when the pooled interval contains 1.0 and its upper end is less than ${UPPER}.`,
    "",
    "| Walk | Slope of each counted run | Pooled slope | Pooled 90 % interval | Interval of the runs | Pooled A/A (90 %) | Verdict |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |",
  );
  const measures: Record<string, unknown>[] = [];
  const blocks: string[] = runs.length === 0 ? ["No run counts."] : [];
  const sights: string[] = [];
  // The walks of the counted runs for each name. The memory slopes come from the same counted runs (D105).
  const groups = names
    .map((name) => ({
      name,
      of: runs.map((run) => {
        const walk = run.walks.find((item) => item.name === name);
        if (walk === undefined) throw new Error(`The run ${runName(run)} has no walk ${name}.`);
        return walk;
      }),
    }))
    .filter((group) => group.of.length > 0);
  for (const group of groups) {
    const { name, of } = group;
    const pooled = summarize({ slopes: of.flatMap((walk) => walk.slopes), aa: of.flatMap((walk) => walk.aa) });
    const medians = of.map((walk) => median(walk.slopes));
    const { mean, half } = meanInterval(medians);
    if (pooled.verdict !== "linear") blocks.push(`${name} is ${pooled.verdict}: ${pooled.p05.toFixed(3)} to ${pooled.p95.toFixed(3)}.`);
    sights.push(`${name} ${seenTime(pooled.p05, pooled.p95).toFixed(2)} on time`);
    measures.push({ walk: name, seen: seenTime(pooled.p05, pooled.p95), ...pooled, runs: medians.map((value) => fixed(value)), mean: fixed(mean), half: fixed(half) });
    lines.push(
      `| \`${name}\` | ${medians.map((value) => value.toFixed(3)).join(", ")} | ${pooled.slope.toFixed(3)} | ${pooled.p05.toFixed(3)} to ${pooled.p95.toFixed(3)} | ${mean.toFixed(3)} ± ${half.toFixed(3)} | ${pooled.aa.toFixed(3)} (${pooled.aaP05.toFixed(3)} to ${pooled.aaP95.toFixed(3)}) | ${pooled.verdict} |`,
    );
  }
  lines.push(
    "",
    "The memory slopes are the slopes of log bytes against log n. They come from the same counted runs, and they pool in the same way.",
    `The memory verdict is an upper bound only. The claim holds when the upper end of the pooled interval is at most ${UPPER}. A slope under 1 also passes.`,
    "",
    "| Walk | Bytes at each rung (median of the runs) | Memory slope of each counted run | Pooled slope | Pooled 90 % interval | Interval of the runs | Pooled A/A (90 %) | Verdict |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | --- |",
  );
  groups.forEach(({ name, of }, index) => {
    const pooled = memorySummary({ byteSlopes: of.flatMap((walk) => walk.byteSlopes), byteAa: of.flatMap((walk) => walk.byteAa) });
    const medians = of.map((walk) => median(walk.byteSlopes));
    const { mean, half } = meanInterval(medians);
    const rungs = (all[0]?.levels ?? []).map((_, d) => median(of.map((walk) => walk.bytes[d] as number)));
    if (pooled.verdict !== "at most linear") blocks.push(`The memory of ${name} is ${pooled.verdict}: the upper end is ${pooled.p95.toFixed(3)}.`);
    sights.push(`${name} ${seenMemory(pooled.p05, pooled.p95).toFixed(2)} on memory`);
    const record = measures[index] as Record<string, unknown>;
    record["memory"] = { seen: seenMemory(pooled.p05, pooled.p95), ...pooled, runs: medians.map((value) => fixed(value)), mean: fixed(mean), half: fixed(half), bytes: rungs.map((value) => Math.round(value)) };
    lines.push(
      `| \`${name}\` | ${rungs.map((value) => Math.round(value)).join(", ")} | ${medians.map((value) => value.toFixed(3)).join(", ")} | ${pooled.slope.toFixed(3)} | ${pooled.p05.toFixed(3)} to ${pooled.p95.toFixed(3)} | ${mean.toFixed(3)} ± ${half.toFixed(3)} | ${pooled.aa.toFixed(3)} (${pooled.aaP05.toFixed(3)} to ${pooled.aaP95.toFixed(3)}) | ${pooled.verdict} |`,
    );
  });
  const gateLine = `Gate (report only, D164): ${blocks.length === 0 ? "pass." : `block. ${blocks.join(" ")}`}`;
  lines.push("", gateLine, `Smallest slope that gives a block: ${sights.join(", ")}. Under that size: no read.`);
  writeSummary(lines);
  // A block of the report-only gate gives a warning on the pull request, thus a green check does not hide it (K225, D182).
  // Only the real pool sets LADDER_ANNOTATE, because the flip rows block on purpose.
  if (blocks.length > 0 && process.env["LADDER_ANNOTATE"] === "1") {
    process.stdout.write(`::warning title=Ladder gate (report only)::${gateLine.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}\n`);
  }
  if (blocks.length > 0 && process.env["LADDER_BLOCK"] === "1") process.exitCode = 3;
  const excluded = all.filter((run) => !counts(run)).map(runName);
  process.stdout.write(`MEASURE ${JSON.stringify({ id: "STATIC.LINEAR", counted: runs.map(runName), excluded, walks: measures })}\n`);
}

if (process.argv[2] === "merge") merge(process.argv.slice(3));
else await measure();
