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
 * The script prints one table and one line `MEASURE {json}`. With `LADDER_JSON`, it also writes the slopes of each
 * round to that file. `LADDER_RUN` names the run. The mode `merge` reads the files of some runs, pools their slopes
 * and gives the verdict. That mode uses only the modules of Node, and Node removes its types. Thus the verdict job
 * does not install the packages. The workflow `measure.yml` runs the ladder in CI, because a shared machine gives
 * unreliable numbers.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";

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
}

/** The measures of one run. */
interface LadderRun {
  readonly run: string;
  readonly cpu: string;
  readonly node: string;
  readonly levels: readonly number[];
  readonly rounds: number;
  readonly passes: number;
  readonly seconds: number;
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
/** The one-sided quantile of 0.95 of the t distribution for 1 to 10 degrees of freedom: a 90 % interval. */
const T95 = [6.314, 2.92, 2.353, 2.132, 2.015, 1.943, 1.895, 1.86, 1.833, 1.812] as const;

function median(values: readonly number[]): number {
  return quantile(values, 0.5);
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

/** This function gives the slope of the least squares line of log y against log x. */
function slope(xs: readonly number[], ys: readonly number[]): number {
  const lx = xs.map(Math.log);
  const ly = ys.map(Math.log);
  const mx = lx.reduce((a, b) => a + b, 0) / lx.length;
  const my = ly.reduce((a, b) => a + b, 0) / ly.length;
  let top = 0;
  let bottom = 0;
  for (let index = 0; index < lx.length; index += 1) {
    top += ((lx[index] as number) - mx) * ((ly[index] as number) - my);
    bottom += ((lx[index] as number) - mx) ** 2;
  }
  return top / bottom;
}

/** This function gives the mean and the half width of its 90 % interval: t times the standard error. */
function meanInterval(values: readonly number[]): { readonly mean: number; readonly half: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, half: Number.NaN };
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const t = T95[Math.min(values.length - 1, T95.length) - 1] as number;
  return { mean, half: t * Math.sqrt(variance / values.length) };
}

function fixed(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

/** This function gives the verdict of an interval: linear when it contains 1 and its upper end is under `UPPER`. */
function verdict(low: number, high: number): string {
  return low <= 1 && high >= 1 && high < UPPER ? "linear" : "not linear";
}

/** The summary of the slopes of one walk: the median and the 90 % interval (the 5th and the 95th percentile). */
function summarize(walk: { readonly slopes: readonly number[]; readonly aa: readonly number[] }) {
  const p05 = quantile(walk.slopes, 0.05);
  const p95 = quantile(walk.slopes, 0.95);
  return {
    slope: fixed(median(walk.slopes)),
    p05: fixed(p05),
    p95: fixed(p95),
    aa: fixed(median(walk.aa)),
    aaP05: fixed(quantile(walk.aa, 0.05)),
    aaP95: fixed(quantile(walk.aa, 0.95)),
    verdict: verdict(p05, p95),
  };
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

async function measure(): Promise<void> {
  const kernel: Kernel = await import("../src/index.ts");
  const base = Number(process.argv[2] ?? 250);
  const rounds = Number(process.argv[3] ?? 30);
  if (!Number.isInteger(base) || base < 1 || !Number.isInteger(rounds) || rounds < 1) throw new Error("Give whole numbers of levels and rounds.");
  const started = performance.now();
  const world = { kinds: kernel.formulaKinds(), defaults: {} };
  const levels = STEPS.map((step) => step * base);
  // The arms: the four rungs, then the second document of the rung AA_STEP.
  const docs = [...STEPS.map((step) => chain(step * base)), chain(AA_STEP * base)];
  const calls = [...STEPS.map((step) => 8 / step), 8 / AA_STEP];
  const aaIndex = STEPS.indexOf(AA_STEP);
  let visits = 0;
  const walks: readonly { readonly name: string; readonly call: (doc: unknown) => number }[] = [
    // The walk of the claim: the references of a document.
    { name: "refsOf", call: (doc) => kernel.refsOf(world, doc).length },
    // The walk under refsOf, with a visit that only counts.
    {
      name: "walk",
      call: (doc) => {
        visits = 0;
        kernel.walk(world, doc, () => {
          visits += 1;
        });
        return visits;
      },
    },
  ];
  const results: WalkRun[] = [];
  // arms[walk * docs.length + doc]
  const arms = walks.flatMap((walk, w) => docs.map((doc, d) => ({ w, d, call: walk.call, doc })));
  // times[arm][round] in nanoseconds for one call
  const times: number[][] = arms.map(() => []);
  for (let round = 0; round < WARM_ROUNDS + rounds; round += 1) {
    const passes: number[][] = arms.map(() => []);
    for (let pass = 0; pass < PASSES; pass += 1) {
      const turn = (round * PASSES + pass) % arms.length;
      const order = arms.map((_, index) => (index + turn) % arms.length);
      if (round % 2 === 1) order.reverse();
      for (const index of order) {
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
  walks.forEach((walk, w) => {
    const of = (d: number): number[] => times[w * docs.length + d] as number[];
    const slopes: number[] = [];
    const aa: number[] = [];
    for (let round = 0; round < rounds; round += 1) {
      slopes.push(slope(levels, STEPS.map((_, d) => of(d)[round] as number)));
      aa.push((of(docs.length - 1)[round] as number) / (of(aaIndex)[round] as number));
    }
    const counts = STEPS.map((_, d) => walk.call(docs[d]));
    results.push({ name: walk.name, ns: STEPS.map((_, d) => median(of(d))), slopes, aa, counts });
  });
  const run: LadderRun = {
    run: process.env["LADDER_RUN"] ?? "1",
    cpu: cpus()[0]?.model.trim() ?? "an unknown CPU",
    node: process.version,
    levels,
    rounds,
    passes: PASSES,
    seconds: fixed((performance.now() - started) / 1000, 1),
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
    measures.push({ walk: walk.name, ...s, ms: walk.ns.map((ns) => fixed(ns / 1e6)) });
    lines.push(
      `| \`${walk.name}\` | ${walk.ns.map((ns) => (ns / 1e6).toFixed(3)).join(" | ")} | ${walk.counts.join(", ")} | ${s.slope.toFixed(3)} | ${s.p05.toFixed(3)} to ${s.p95.toFixed(3)} | ${s.aa.toFixed(3)} (${s.aaP05.toFixed(3)} to ${s.aaP95.toFixed(3)}) | ${s.verdict} |`,
    );
  }
  writeSummary(lines);
  process.stdout.write(`MEASURE ${JSON.stringify({ id: "STATIC.LINEAR", run: run.run, levels, rounds, seconds: run.seconds, walks: measures })}\n`);
  const out = process.env["LADDER_JSON"];
  if (out !== undefined && out !== "") writeFileSync(out, `${JSON.stringify(run)}\n`);
}

/** This function pools the rounds of some runs and gives the verdict of each walk. */
function merge(files: readonly string[]): void {
  if (files.length === 0) throw new Error("Give the JSON files of the runs.");
  const runs = files.map((file) => JSON.parse(readFileSync(file, "utf8")) as LadderRun);
  const names = runs[0]?.walks.map((walk) => walk.name) ?? [];
  const lines = [
    `### Ladder verdict of ${runs.length} runs`,
    "",
    `Levels ${runs[0]?.levels.join(", ")}. The runs took ${runs.map((run) => `${run.seconds} s`).join(", ")}.`,
    "The pooled interval is the 5th to the 95th percentile of the slopes of all rounds of all runs. The verdict reads it.",
    `The interval of the runs is the mean of the medians of the runs, plus or minus t times the standard error (90 %).`,
    `The claim is linear when the pooled interval contains 1.0 and its upper end is less than ${UPPER}.`,
    "",
    "| Walk | Slope of each run | Pooled slope | Pooled 90 % interval | Interval of the runs | A/A ratio of each run | Pooled A/A (90 %) | Verdict |",
    "| --- | --- | ---: | ---: | ---: | --- | ---: | --- |",
  ];
  const measures: Record<string, unknown>[] = [];
  for (const name of names) {
    const of = runs.map((run) => {
      const walk = run.walks.find((item) => item.name === name);
      if (walk === undefined) throw new Error(`The run ${run.run} has no walk ${name}.`);
      return walk;
    });
    const pooled = summarize({ slopes: of.flatMap((walk) => walk.slopes), aa: of.flatMap((walk) => walk.aa) });
    const medians = of.map((walk) => median(walk.slopes));
    const { mean, half } = meanInterval(medians);
    measures.push({ walk: name, ...pooled, runs: medians.map((value) => fixed(value)), mean: fixed(mean), half: fixed(half) });
    lines.push(
      `| \`${name}\` | ${medians.map((value) => value.toFixed(3)).join(", ")} | ${pooled.slope.toFixed(3)} | ${pooled.p05.toFixed(3)} to ${pooled.p95.toFixed(3)} | ${mean.toFixed(3)} ± ${half.toFixed(3)} | ${of.map((walk) => median(walk.aa).toFixed(3)).join(", ")} | ${pooled.aa.toFixed(3)} (${pooled.aaP05.toFixed(3)} to ${pooled.aaP95.toFixed(3)}) | ${pooled.verdict} |`,
    );
  }
  writeSummary(lines);
  process.stdout.write(`MEASURE ${JSON.stringify({ id: "STATIC.LINEAR", runs: runs.length, walks: measures })}\n`);
}

if (process.argv[2] === "merge") merge(process.argv.slice(3));
else await measure();
