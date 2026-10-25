/*
 * The speed of plans and paths: two copies of the kernel in one process (K12, D29).
 *
 *   pnpm exec tsx packages/core/bench/paths.ts <base src/index.ts> <head src/index.ts>
 *
 * The rounds alternate between the two copies, thus a change of the load of the machine touches both. The script
 * prints the median time of one operation for each case and each copy. It asserts only that the two copies give the
 * same results. The workflow `bench.yml` runs it in CI, because a shared machine gives unreliable numbers.
 *
 * Each copy is an esbuild bundle without `keepNames`, as the bundler of a host makes it. The loader of tsx keeps the
 * name of each function, and that adds a call at each closure that the kernel makes.
 */
import { build } from "esbuild";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolveFile } from "node:path";
import { pathToFileURL } from "node:url";

type Kernel = typeof import("../src/index.ts");

interface Case {
  readonly name: string;
  /** This function gives the operation to measure. Each copy of the kernel gets its own operation. */
  readonly make: (k: Kernel) => () => unknown;
}

const ref = (...path: unknown[]): unknown => ({ type: "ref", value: path });
const op = (name: string, ...args: unknown[]): unknown => ({ type: ["ops", name], value: args });
const OPS = { add: (a: number, b: number) => a + b };

/** A host thing that answers a whole path in one call. */
function store(k: Kernel): unknown {
  const fields: Record<string, unknown> = { a: { b: 5 } };
  return {
    [k.THING]: true,
    label: "store",
    deref: (key: string | number) => fields[String(key)],
    toJson: () => fields,
    resolve: (keys: readonly (string | number)[]) => {
      let here: unknown = fields;
      for (const key of keys) {
        if (typeof here !== "object" || here === null || !Object.hasOwn(here, String(key))) return undefined;
        here = (here as Record<string, unknown>)[String(key)];
      }
      return { thing: here };
    },
  };
}

const ROW = { cells: [{ value: 0 }, { value: 1 }, { value: 2 }] };

const CASES: readonly Case[] = [
  {
    // The formula of FORMULA.SPEED: two references, two operations and a literal.
    name: "FORMULA.SPEED formula",
    make: (k) => {
      const plan = k.prepare(k.formulaMachine({ ops: OPS }), op("add", ref("names", "x"), op("add", ref("names", "y"), 1)));
      const ctx = k.context({ names: { x: 1, y: 2 } });
      return () => plan.evaluate(ctx);
    },
  },
  {
    name: "the same formula, with a list of reads",
    make: (k) => {
      const plan = k.prepare(k.formulaMachine({ ops: OPS }), op("add", ref("names", "x"), op("add", ref("names", "y"), 1)));
      const ctx = k.context({ names: { x: 1, y: 2 } });
      return () => plan.evaluate(ctx, { reads: [] });
    },
  },
  {
    name: "a reference of five steps",
    make: (k) => {
      const plan = k.prepare(k.formulaMachine({ ops: OPS }), ref("names", "row", "cells", 2, "value"));
      const ctx = k.context({ names: { row: ROW } });
      return () => plan.evaluate(ctx);
    },
  },
  {
    name: "a reference into a host thing with resolve",
    make: (k) => {
      const plan = k.prepare(k.formulaMachine({ ops: OPS }), ref("names", "h", "a", "b"));
      const ctx = k.context({ names: { h: store(k) } });
      return () => plan.evaluate(ctx);
    },
  },
  {
    // A step on an envelope asks the ladder of the verb deref, thus the kind of its type.
    name: "a reference through an envelope",
    make: (k) => {
      const machine = k.formulaMachine({ ops: OPS }, { world: { kinds: { point: { verbs: {} } }, defaults: {} }, derefs: { "test.none": () => undefined } });
      const plan = k.prepare(machine, ref("names", "p", "x"));
      const ctx = k.context({ names: { p: { type: "point", value: { x: 3 } } } });
      return () => plan.evaluate(ctx);
    },
  },
  {
    // A step document asks the ladder of the verb step for its walker.
    name: "a reference with a step document",
    make: (k) => {
      const machine = k.formulaMachine(
        { ops: OPS },
        {
          world: { kinds: { moves: { kinds: {}, fallback: { verbs: { step: "walk.at" }, parts: { shape: "deep" } } } }, defaults: {} },
          walkers: {
            "walk.at": ({ data, here, deref }) => {
              const reached = deref(here, data as number);
              return reached === undefined ? { ok: false, reason: "No item." } : { ok: true, thing: reached };
            },
          },
        },
      );
      const plan = k.prepare(machine, ref("names", "b", { type: ["moves", "at"], value: 1 }));
      const ctx = k.context({ names: { b: [10, 20, 30] } });
      return () => plan.evaluate(ctx);
    },
  },
  {
    // The exported resolve: the dynamic path, without a plan.
    name: "resolve without hops, five steps",
    make: (k) => {
      const machine = k.formulaMachine({ ops: OPS });
      const ctx = k.context({ names: { row: ROW } });
      const path = ["names", "row", "cells", 2, "value"];
      return () => k.resolve(machine, ctx, path, { hops: false });
    },
  },
  {
    // The cost of a compilation, as PLAN.COMPILE-SPEED measures it.
    name: "PLAN.COMPILE-SPEED prepare",
    make: (k) => {
      const machine = k.formulaMachine({ ops: OPS });
      let n = 0;
      return () => {
        n += 1;
        return k.prepare(machine, { type: "record", value: { a: ref("names", "x"), b: op("add", n, 1), ["__proto__"]: n } }).traced;
      };
    },
  },
];

/** The rounds and the time of one round. A local smoke test can make them small, for example `BENCH_ROUNDS=1`. */
const ROUNDS = Number(process.env["BENCH_ROUNDS"] ?? 15);
const WARMUP = Math.min(3, ROUNDS);
const TARGET_MS = Number(process.env["BENCH_MS"] ?? 25);

/** This function gives the number of calls that take approximately the target time. */
function calibrate(fn: () => unknown): number {
  let n = 1000;
  for (;;) {
    const start = performance.now();
    for (let index = 0; index < n; index += 1) fn();
    const ms = performance.now() - start;
    if (ms >= TARGET_MS / 4) return Math.max(1000, Math.round((n * TARGET_MS) / ms));
    n *= 4;
  }
}

/** This function gives the time of one call in nanoseconds. */
function measure(fn: () => unknown, n: number): number {
  const start = performance.now();
  for (let index = 0; index < n; index += 1) fn();
  return ((performance.now() - start) * 1e6) / n;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function show(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === "function" ? "<fn>" : item));
}

/** This function bundles one copy of the kernel, and imports the bundle. */
async function load(file: string, name: string): Promise<Kernel> {
  const outfile = join(mkdtempSync(join(tmpdir(), "coeval-bench-")), `${name}.mjs`);
  await build({ entryPoints: [resolveFile(file)], bundle: true, format: "esm", platform: "node", target: "node22", outfile, logLevel: "error" });
  return (await import(pathToFileURL(outfile).href)) as Kernel;
}

async function main(): Promise<void> {
  const [baseFile, headFile] = process.argv.slice(2);
  if (baseFile === undefined || headFile === undefined) throw new Error("Give the index.ts of the base and of the head.");
  const base = await load(baseFile, "base");
  const head = await load(headFile, "head");
  const lines: string[] = [`Node ${process.version}, ${ROUNDS} rounds of about ${TARGET_MS} ms for each copy, the median of each.`, "", "| Case | Base (ns) | Head (ns) | Change |", "| --- | ---: | ---: | ---: |"];
  let mismatch = false;
  for (const item of CASES) {
    const fns = [item.make(base), item.make(head)] as const;
    const [a, b] = [show(fns[0]()), show(fns[1]())];
    if (a !== b) {
      mismatch = true;
      lines.push(`| ${item.name} | different results: ${a} and ${b} | | |`);
      continue;
    }
    const n = Math.min(calibrate(fns[0]), calibrate(fns[1]));
    const times: [number[], number[]] = [[], []];
    for (let round = 0; round < WARMUP + ROUNDS; round += 1) {
      // The order alternates, thus neither copy always runs first.
      const order = round % 2 === 0 ? [0, 1] : [1, 0];
      for (const which of order) {
        const ns = measure(fns[which as 0 | 1], n);
        if (round >= WARMUP) times[which as 0 | 1].push(ns);
      }
    }
    const [before, after] = [median(times[0]), median(times[1])];
    const change = ((after - before) / before) * 100;
    lines.push(`| ${item.name} | ${before.toFixed(1)} | ${after.toFixed(1)} | ${change >= 0 ? "+" : ""}${change.toFixed(1)} % |`);
  }
  const text = lines.join("\n");
  console.log(text);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary !== undefined && summary !== "") appendFileSync(summary, `## The speed of plans and paths\n\n${text}\n`);
  if (mismatch) process.exitCode = 1;
}

await main();
