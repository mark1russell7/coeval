/*
 * The cases of the speed of plans and paths, for one copy of the kernel (K12, K101).
 *
 * The script `paths.ts` bundles this file with each copy of the kernel. Each bundle runs in its own process:
 *
 *   node <bundle> measure [<calls of each case as JSON>]
 *
 * The process prints one line of JSON: for each case, the result, the calls in one sample and the median time of one
 * call. Without the calls, the process calibrates them. The process measures only its own copy, thus no other copy
 * changes its type feedback, its inline caches or its heap.
 */
import * as kernel from "../src/index.ts";

type Kernel = typeof kernel;

interface Case {
  readonly name: string;
  /** This function gives the operation to measure. */
  readonly make: (k: Kernel) => () => unknown;
}

/** The result of one case in one process. */
export interface Measured {
  readonly name: string;
  /** The result of one call, as JSON. The copies must give the same results. */
  readonly result: string;
  /** The calls in one sample. */
  readonly calls: number;
  /** The median time of one call in nanoseconds. */
  readonly ns: number;
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

/** A deeply frozen configuration, as a host declares it fixed (PLAN.FIXED). */
const CONFIG = Object.freeze({ scale: 2, rows: Object.freeze([Object.freeze({ value: 10 }), Object.freeze({ value: 20 })]) });

/** This function gives the standard machine with a tree kind whose equation `seen` reads the event. */
function treeMachine(k: Kernel): kernel.Machine {
  const watch: kernel.Kind = {
    verbs: { eval: "tree.node" },
    parts: { shape: "record", fields: {}, rest: { shape: "term", of: "number" } },
    caps: [{ rule: "mask" }],
    pure: true,
    lazy: [{}],
    reads: ["self"],
    tree: { equations: { seen: { type: "add", value: [ref("event", "a"), 1] } } },
  };
  return { ...k.STD_MACHINE, world: { ...k.STD_MACHINE.world, kinds: { ...k.STD_MACHINE.world.kinds, watch } } };
}

/** A node with two parts that read the attribute of the equation. */
const TREE = { type: "watch", value: { got: ref("self", "seen"), twice: { type: "add", value: [ref("self", "seen"), ref("self", "seen")] } } };

export const CASES: readonly Case[] = [
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
    // A closed record of twenty literals. Since K13 the plan folds it, and each evaluation gives one frozen value (PLAN.FOLD).
    name: "PLAN.FOLD a record of 20 literals",
    make: (k) => {
      const fields: Record<string, unknown> = {};
      for (let index = 0; index < 20; index += 1) fields[`f${index}`] = index % 2 === 0 ? index : `text ${index}`;
      const plan = k.prepare(k.formulaMachine({ ops: OPS }), { type: "record", value: fields });
      const ctx = k.context();
      return () => plan.evaluate(ctx);
    },
  },
  {
    // The same record without folds: each literal evaluates. Since K76 the code of a literal has no wrapper (PLAN.TOTAL).
    name: "PLAN.TOTAL a record of 20 literals, without folds",
    make: (k) => {
      const fields: Record<string, unknown> = {};
      for (let index = 0; index < 20; index += 1) fields[`f${index}`] = index % 2 === 0 ? index : `text ${index}`;
      const plan = k.prepare(k.formulaMachine({ ops: OPS }), { type: "record", value: fields }, { fold: false });
      const ctx = k.context();
      return () => plan.evaluate(ctx);
    },
  },
  {
    // A path of four steps from a name that the host declares fixed (K14). The plan folds it, and each evaluation
    // compares the value of the name one time (PLAN.FIXED). A kernel without the option ignores it.
    name: "PLAN.FIXED a path of four steps from a fixed name",
    make: (k) => {
      const plan = k.prepare(k.formulaMachine({ ops: OPS }), ref("names", "config", "rows", 1, "value"), { fixed: { names: { config: CONFIG } } });
      const ctx = k.context({ names: { config: CONFIG, x: 1 } });
      return () => plan.evaluate(ctx);
    },
  },
  {
    // The same path without the declaration: the compiled path walks the four steps at each evaluation (PLAN.PATH).
    name: "PLAN.PATH the same path, without the declaration",
    make: (k) => {
      const plan = k.prepare(k.formulaMachine({ ops: OPS }), ref("names", "config", "rows", 1, "value"));
      const ctx = k.context({ names: { config: CONFIG, x: 1 } });
      return () => plan.evaluate(ctx);
    },
  },
  {
    // A formula that reads a fixed name and a name that changes. Only the part with the fixed name folds.
    name: "PLAN.FIXED a formula with a fixed name and a free name",
    make: (k) => {
      const doc = op("add", ref("names", "config", "scale"), ref("names", "x"));
      const plan = k.prepare(k.formulaMachine({ ops: OPS, pure: ["add"] }), doc, { fixed: { names: { config: CONFIG } } });
      const ctx = k.context({ names: { config: CONFIG, x: 1 } });
      return () => plan.evaluate(ctx);
    },
  },
  {
    // A node of a tree with an equation that reads the event (READS.EQUATION).
    name: "a tree with an equation",
    make: (k) => {
      const plan = k.prepare(treeMachine(k), TREE);
      const ctx = k.context({ event: { a: 1 } });
      return () => plan.evaluate(ctx);
    },
  },
  {
    // The same node with a list of reads: the reads of the equation go in the list too (D68).
    name: "the same tree, with a list of reads",
    make: (k) => {
      const plan = k.prepare(treeMachine(k), TREE);
      const ctx = k.context({ event: { a: 1 } });
      return () => plan.evaluate(ctx, { reads: [] });
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

/** The time of one sample, and the samples of each case in one process. The first samples only warm up the code. */
const TARGET_MS = Number(process.env["BENCH_MS"] ?? 25);
const WARMUP = Number(process.env["BENCH_WARMUP"] ?? 3);
const SAMPLES = Number(process.env["BENCH_SAMPLES"] ?? 5);

/** This function gives the number of calls that take approximately the target time. */
export function calibrate(fn: () => unknown): number {
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
export function measure(fn: () => unknown, n: number): number {
  const start = performance.now();
  for (let index = 0; index < n; index += 1) fn();
  return ((performance.now() - start) * 1e6) / n;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export function show(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === "function" ? "<fn>" : item));
}

/** This function measures each case in turn. Without the calls of each case, it calibrates them. */
export function run(counts?: readonly number[]): Measured[] {
  return CASES.map((item, index) => {
    const fn = item.make(kernel);
    const result = show(fn());
    const calls = counts?.[index] ?? calibrate(fn);
    const samples: number[] = [];
    for (let round = 0; round < WARMUP + SAMPLES; round += 1) {
      const ns = measure(fn, calls);
      if (round >= WARMUP) samples.push(ns);
    }
    return { name: item.name, result, calls, ns: median(samples) };
  });
}

if (process.argv[2] === "measure") {
  const counts = process.argv[3] === undefined ? undefined : (JSON.parse(process.argv[3]) as number[]);
  process.stdout.write(`${JSON.stringify(run(counts))}\n`);
}
