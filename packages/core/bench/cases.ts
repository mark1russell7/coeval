/*
 * The cases of the speed of plans and paths, for one copy of the kernel (K12, K101).
 *
 * The script `paths.ts` bundles this file with each copy of the kernel. Each bundle runs in its own process:
 *
 *   node <bundle> measure [<calls of each case as JSON> [<indexes of some cases as JSON>]]
 *   node <bundle> child <index of one case> <calls of that case>
 *
 * The mode `measure` prints one line of JSON: for each case, the result, the calls in one sample and the median time
 * of one call. Without the calls, the process calibrates them. With the indexes, the process runs only those cases, in
 * that order (K210, D98). The mode `child` measures one case for the fresh runner of `@mark1russell7/rigor-bench`
 * (D114). It prints the line `{"ms": <time of one call>, "hash": <result>}`. The process measures only its own copy,
 * thus no other copy changes its type feedback, its inline caches or its heap.
 */
import { median } from "@mark1russell7/rigor-statistics";
import type * as kernel from "../src/index.ts";
import { STD_MACHINE, THING, context, factsOf, formulaMachine, prepare, resolve } from "../src/index.ts";
import { SAMPLES, TARGET_MS, WARMUP } from "./settings.ts";

/**
 * The parts of the kernel that the cases use (K246, D188). The bundle keeps only these parts and the code that they
 * reach, as the bundle of a host keeps it. Thus a change outside each timed path gives the same bundle on the two arms.
 */
const KERNEL = { STD_MACHINE, THING, context, factsOf, formulaMachine, prepare, resolve };

type Kernel = typeof KERNEL;

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
  /** The time of one call in each sample of the process, with the warmup, in nanoseconds (`levels.ts`). */
  readonly samples: readonly number[];
}

const ref = (...path: kernel.Json[]): kernel.Json => ({ type: "ref", value: path });
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
    // The static facts of the same node: factsOf walks the equations of its kind too (FACTS.EQUATIONS, D69). The base
    // gives fewer reads, thus the case gives only the size, which is the same in each copy.
    name: "factsOf a tree with an equation",
    make: (k) => {
      const machine = treeMachine(k);
      return () => k.factsOf(machine, TREE).size;
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

/*
 * GAP (mark1russell7/rigor#37): rigor-bench has no timed samples of one arm in a child process. Thus `calibrate`,
 * `measure` and the sample loop of `run` stay here.
 */

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

/*
 * The seeded slowdown of the flip test (K225, D180). The script `paths.ts` builds the head arm with the define
 * `BENCH_SLOW`: one factor for each case of `CASES`. Without the define, each factor is 1.
 */
declare const BENCH_SLOW: readonly number[] | undefined;
const SLOW: readonly number[] = typeof BENCH_SLOW === "undefined" ? [] : BENCH_SLOW;

/**
 * This function gives the time of one call in nanoseconds. With a factor `slow` above 1, the sample waits in the timed
 * part until its time is `slow` times the time of its calls. Thus the timer reads a real slowdown of that factor.
 */
export function measure(fn: () => unknown, n: number, slow = 1): number {
  const start = performance.now();
  for (let index = 0; index < n; index += 1) fn();
  if (slow > 1) {
    const until = start + (performance.now() - start) * slow;
    for (;;) if (performance.now() >= until) break;
  }
  return ((performance.now() - start) * 1e6) / n;
}

export function show(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === "function" ? "<fn>" : item));
}

/**
 * This function measures each case in turn. Without the calls of each case, it calibrates them. With `only`, it
 * measures only the cases at those indexes, and no other case makes its operation.
 */
export function run(counts?: readonly number[], only?: readonly number[]): Measured[] {
  const chosen = (only ?? CASES.map((_, index) => index)).map((index) => ({ item: CASES[index] as Case, index }));
  return chosen.map(({ item, index }) => {
    const fn = item.make(KERNEL);
    const result = show(fn());
    const calls = counts?.[index] ?? calibrate(fn);
    const samples: number[] = [];
    for (let round = 0; round < WARMUP + SAMPLES; round += 1) samples.push(measure(fn, calls, SLOW[index] ?? 1));
    return { name: item.name, result, calls, ns: median(samples.slice(WARMUP)), samples };
  });
}

if (process.argv[2] === "measure") {
  const counts = process.argv[3] === undefined ? undefined : (JSON.parse(process.argv[3]) as number[]);
  const only = process.argv[4] === undefined ? undefined : (JSON.parse(process.argv[4]) as number[]);
  if (only?.some((index) => CASES[index] === undefined)) throw new Error(`A case is absent: ${String(process.argv[4])}.`);
  process.stdout.write(`${JSON.stringify(run(counts, only))}\n`);
}

if (process.argv[2] === "child") {
  const [index, calls] = [Number(process.argv[3]), Number(process.argv[4])];
  if (CASES[index] === undefined || !Number.isInteger(calls) || calls < 1) throw new Error(`Give the index of a case and its calls: ${String(process.argv[3])} ${String(process.argv[4])}.`);
  const [measured] = run(CASES.map(() => calls), [index]) as [Measured];
  process.stdout.write(`${JSON.stringify({ ms: measured.ns / 1e6, hash: measured.result })}\n`);
}
