import { closureParams } from "./agree.ts";
import { type Json, type Key, docEquals } from "./doc.ts";
import { type Context, type HostThing, THING, context as contextOf } from "./deref.ts";
import { type Result, Failure } from "./errors.ts";
import { type Machine, prepare } from "./evaluate.ts";
import { factsOf } from "./facts.ts";
import { Held, isClosure } from "./formula.ts";
import { type GenerateOptions, type Random, generate, random, typesOf } from "./generate.ts";
import { sameResult } from "./same.ts";
import { cycleOf, runSide } from "./schedule.ts";
import { STD_MACHINE } from "./stdlib.ts";

/*
 * One meaning across schedules (S3a, R4 P4, D58). The model is an evaluation of the whole graph from scratch with the
 * meaning of D31. The harness gives an engine random edits, new nodes, removed nodes, new machines and changes of
 * data. After each change, it compares the answers of the engine with the model. Each schedule of the kernel and each
 * engine of a host uses the same generator and the same model.
 */

/**
 * The smallest interface of the engine of a host that `agreeSchedule` examines (SCHED.AGREES). The demand schedule of
 * `schedule` has this interface.
 */
export interface ScheduleEngine {
  /**
   * This function adds a node, or gives a node a new document. The harness also gives the same document object again:
   * a change of the structure without an edit.
   *
   * @param id - The name of the node.
   * @param doc - The document of the node. It does not change in place.
   */
  set(id: string, doc: unknown): void;
  /**
   * This function removes a node. A later read of the node by another node gives the error of a missing step.
   *
   * @param id - The name of the node.
   */
  remove(id: string): unknown;
  /**
   * This function gives the engine the new context of the host. The values of a context do not change in place. The
   * same context object again is a change of data that changes no value.
   *
   * @param context - The context of the host, without the root `world`.
   */
  changeData(context: Context): void;
  /**
   * This function gives the engine a new machine. The harness gives no new machine to an engine without this function.
   *
   * @param machine - The new machine.
   */
  changeMachine?(machine: Machine): void;
  /**
   * This function demands a node and gives its answer.
   *
   * @param id - The name of the node. The engine has the node.
   * @returns The result of the node.
   */
  read(id: string): Result;
}

/** What a new engine gets beside its machine: the context of the host, and the type of a bare root value. */
export interface ScheduleEngineStart {
  /** The first context of the host, without the root `world`. */
  readonly context: Context;
  /** The type of a bare root value, when the options of the harness name one. */
  readonly declaredType?: string;
}

/**
 * This function makes a new engine with no nodes. The harness makes one engine for each run. The function `schedule`
 * has this form.
 */
export type ScheduleEngineFactory = (machine: Machine, start: ScheduleEngineStart) => ScheduleEngine;

/**
 * The options of `agreeSchedule`. The defaults fit `STD_MACHINE`. A host with another machine also gives `generate`,
 * `value` and `wire`, and it sets `runs` to `false` when its world has no kind `log`.
 */
export interface AgreeScheduleOptions {
  /** The machines. The first machine starts each run, and the command of a new machine takes the next one. The default is `STD_MACHINE` and a copy. */
  readonly machines?: readonly Machine[];
  /** The type of a bare root value, for each engine, each plan and each fact. */
  readonly declaredType?: string;
  /** The options of the document generator. Each generated path from `names` to a node changes into a path from `world`. */
  readonly generate?: Omit<GenerateOptions, "seed" | "names">;
  /**
   * This function gives a small value document.
   *
   * @param rng - The source of random numbers.
   * @returns The document.
   */
  readonly value?: (rng: Random) => unknown;
  /**
   * This function gives a document that reads one or two nodes, for dense graphs with many cycles.
   *
   * @param rng - The source of random numbers.
   * @param node - This function gives a reference to a random node.
   * @returns The document.
   */
  readonly wire?: (rng: Random, node: () => Json) => unknown;
  /** The share of the nodes that `wire` gives. The default is 0.2. */
  readonly wired?: number;
  /** `true`: one generated document in ten goes into the kind `log`, thus the node is on the run side. The default is `true`. */
  readonly runs?: boolean;
  /** The names of the nodes. The default is five names. */
  readonly nodes?: readonly string[];
  /** The names that the context of the host binds at the root `names`. The default is `a`, `b`, `x` and `n`. */
  readonly names?: readonly string[];
  /** The values that a change of data gives a name of the host. The default has equal values, host values and a `Held` error. */
  readonly values?: readonly unknown[];
  /** The contexts of the host at the start of the runs, one after the other. */
  readonly contexts?: readonly Context[];
  /** The number of runs. The default is 100. */
  readonly count?: number;
  /** The number of commands in one run. The default is 30. */
  readonly steps?: number;
  /** The seed of the first run, and one more for each later run. The default is 9000011. */
  readonly seed?: number;
  /**
   * This function compares two values that the rules of `sameResult` do not know. It answers first. Without an answer,
   * two closures of `fn` are the same when they have the same parameters.
   *
   * @param a - The value of the engine, or of the first evaluation from scratch.
   * @param b - The value from scratch.
   * @returns `true` or `false`, or `undefined` for the other rules.
   */
  readonly equal?: (a: unknown, b: unknown) => boolean | undefined;
}

/** What the harness reached: the commands, the reads, and the kinds of answers that it compared. */
export interface ScheduleAgreementCounts {
  /** The reads of a node. */
  readonly reads: number;
  /** The reads with one answer from scratch, which the harness compared. */
  readonly compared: number;
  /** The reads whose answer from scratch is new at each evaluation. The harness does not compare them. */
  readonly unrepeatable: number;
  /** The compared answers that are a value. */
  readonly values: number;
  /** The compared answers that are the `#CYCLE!` of the node. */
  readonly cycles: number;
  /** The compared answers that are the `#REF!` of a node on the run side. */
  readonly runs: number;
  /** The changes of data with new names of the host. */
  readonly data: number;
  /** The changes of data that change no value. */
  readonly empty: number;
  /** The new documents of a node. */
  readonly edits: number;
  /** The new nodes. */
  readonly additions: number;
  /** The removed nodes. */
  readonly removes: number;
  /** The changes of the structure with the same document object. */
  readonly same: number;
  /** The new machines. */
  readonly machines: number;
}

/** The outcome of `agreeSchedule`: what the harness reached, or the first disagreement. */
export type ScheduleAgreement =
  | { readonly ok: true; readonly counts: ScheduleAgreementCounts }
  | {
      readonly ok: false;
      /** The seed of the run. */
      readonly seed: number;
      /** The index of the command in the run. */
      readonly step: number;
      /** The node of the read. */
      readonly node: string;
      /** The answer of the engine. */
      readonly engine: Result;
      /** The answer of the evaluation from scratch. */
      readonly scratch: Result;
      /** The documents of the nodes at the read. */
      readonly docs: ReadonlyMap<string, unknown>;
      /** The context of the host at the read. */
      readonly context: Context;
      /** The machine at the read. */
      readonly machine: Machine;
      /** One sentence that tells the difference. */
      readonly reason: string;
      /** What the harness reached up to the read. */
      readonly counts: ScheduleAgreementCounts;
    };

/** A list of eight reference types. The generator then gives more references, thus more reads of nodes. */
function moreRefs(): readonly (readonly Key[])[] {
  return Array.from({ length: 8 }, () => ["ref"]);
}

/** The default options of the document generator, for `STD_MACHINE`. The kinds `log` and `write` need a capability. */
function standardGenerate(): Omit<GenerateOptions, "seed" | "names"> {
  return {
    maxSize: 16,
    types: [...typesOf(STD_MACHINE.world).filter((type) => type[0] !== "log" && type[0] !== "write"), ...moreRefs(), ["if"], ["add"]],
    data: (type, rng) => {
      const name = type.join(".");
      if (name === "number") return rng.chance(0.9) ? rng.pick([0, 1, 2, 3.5, -1]) : "1";
      if (name === "text") return rng.chance(0.9) ? rng.pick(["", "a", "b"]) : 1;
      if (name === "bool") return rng.chance(0.9) ? rng.chance(0.5) : 0;
      if (name === "nearest") return rng.pick<Json>([{ type: "panel" }, "panel"]);
      return undefined;
    },
  };
}

/** The default `wire`, for `STD_MACHINE`. A list evaluates each part, also after a failed part. */
function standardWire(rng: Random, node: () => Json): unknown {
  if (rng.chance(0.5)) return { type: "list", value: [node(), node()] };
  return rng.chance(0.5) ? { type: "add", value: [node(), 1] } : node();
}

/** The default values of the names of the host. Some are equal by structure, and some are host values. */
function standardValues(): readonly unknown[] {
  return [0, 1, 2, -0, Number.NaN, "two", null, undefined, [1, 2], { a: 1 }, { a: 2 }, { type: "ref", value: ["names", "a"] }, new Held({ code: "#HELD", reason: "The binding failed." })];
}

/** The default contexts of the host at the start of a run. */
function standardContexts(): readonly Context[] {
  return [
    contextOf({ names: { a: 1, b: [1, "two"], x: { a: 1 }, n: 2 }, caps: ["log"] }),
    contextOf({ names: { a: "two", b: 0, x: null }, self: { a: 1 }, event: { a: 2 } }),
  ];
}

/** This function puts a field on a record, also the field `__proto__`. */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** This function changes each path from `names` to a node into a path from `world`. Some paths read the whole root. */
function linked(value: unknown, rng: Random, nodes: readonly string[]): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => linked(item, rng, nodes));
    if (items[0] === "names" && typeof items[1] === "string" && nodes.includes(items[1])) return rng.chance(0.03) ? ["world"] : ["world", ...items.slice(1)];
    return items;
  }
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) put(out, key, linked((value as Record<string, unknown>)[key], rng, nodes));
  return out;
}

/** This function gives new names of the host, with one or two changes. */
function change(base: Context, rng: Random, names: readonly string[], values: readonly unknown[]): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...base.names };
  for (let step = 1 + rng.int(2); step > 0; step -= 1) {
    const name = rng.pick(names);
    if (rng.chance(0.15)) delete out[name];
    else out[name] = rng.pick(values);
  }
  return out;
}

function shuffle<T>(items: readonly T[], rng: Random): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = rng.int(index + 1);
    [out[index], out[other]] = [out[other] as T, out[index] as T];
  }
  return out;
}

/**
 * This function evaluates each node of a graph from scratch, with the meaning of D31. Each node gets a new plan and
 * one value. The algorithm of Tarjan over the demands finds the cycles. The function keeps nothing between calls.
 */
function fromScratch(machine: Machine, docs: ReadonlyMap<string, unknown>, base: Context, declaredType: string | undefined): ReadonlyMap<string, Result> {
  const declared = declaredType === undefined ? {} : { declaredType };
  const values = new Map<string, Result>();
  const index = new Map<string, number>();
  const lowest = new Map<string, number>();
  const component: string[] = [];
  const evaluating: string[] = [];
  const selfReads = new Set<string>();
  const visit = (id: string): Result => {
    const reader = evaluating[evaluating.length - 1];
    const link = (to: number): void => {
      if (reader !== undefined) lowest.set(reader, Math.min(lowest.get(reader) as number, to));
    };
    const done = values.get(id);
    if (done !== undefined) {
      if (component.includes(id)) link(index.get(id) as number);
      return done;
    }
    if (evaluating.includes(id)) {
      link(index.get(id) as number);
      if (reader === id) selfReads.add(id);
      return cycleOf(id);
    }
    if (factsOf(machine, docs.get(id), declared).side === "run") {
      const refused = runSide(id);
      values.set(id, refused);
      return refused;
    }
    index.set(id, index.size);
    lowest.set(id, index.get(id) as number);
    component.push(id);
    evaluating.push(id);
    let result = prepare(machine, docs.get(id), declared).evaluate(ctx);
    evaluating.pop();
    if ((lowest.get(id) as number) < (index.get(id) as number)) result = cycleOf(id);
    else if (component.splice(component.indexOf(id)).length > 1 || selfReads.has(id)) result = cycleOf(id);
    values.set(id, result);
    link(lowest.get(id) as number);
    return result;
  };
  const world: HostThing = {
    [THING]: true,
    label: "nodes",
    deref: (key) => {
      if (!docs.has(String(key))) return undefined;
      const result = visit(String(key));
      if (!result.ok) throw new Failure(result.error);
      return result.value;
    },
    has: (key) => docs.has(String(key)),
    toJson: () => {
      const out: Record<string, unknown> = {};
      for (const id of [...docs.keys()].sort()) {
        if (factsOf(machine, docs.get(id), declared).side === "run") continue;
        const result = visit(id);
        if (!result.ok) throw new Failure(result.error);
        put(out, id, result.value);
      }
      return out;
    },
  };
  const ctx: Context = { ...base, world };
  for (const id of [...docs.keys()].sort()) visit(id);
  return values;
}

/** This function names a result for the reason of a disagreement: its error code, or "a value". */
function named(result: Result): string {
  return result.ok ? "a value" : result.error.code;
}

/**
 * This function examines an engine of a host against an evaluation from scratch (SCHED.AGREES, R4 P4, D58). Each run
 * makes a new engine and a random graph of named nodes from the document generator. Then it gives random commands:
 * edits, new nodes, removed nodes, the same document again, new machines and changes of data.
 *
 * - Each read command evaluates the whole graph from scratch two times, with the meaning of D31.
 * - It then demands each node in a random order, or one node, and compares each answer with `sameResult`.
 * - A read whose answer from scratch differs between the two evaluations is not compared.
 * - Two errors agree when they have the same code, reason and place. Thus an engine gives the `#CYCLE!` and the
 *   `#REF!` of D31.
 *
 * The same seed and the same options give the same commands, thus a disagreement occurs again.
 *
 * @param engine - This function makes a new engine for each run, for example `schedule`.
 * @param options - The machines, the generator, the contexts, the number of runs and the rule for host values.
 * @returns What the harness reached, or the first read whose answer differs from the answer from scratch.
 */
export function agreeSchedule(engine: ScheduleEngineFactory, options: AgreeScheduleOptions = {}): ScheduleAgreement {
  const machines = options.machines ?? [STD_MACHINE, { ...STD_MACHINE }];
  const declaredType = options.declaredType;
  const generateOptions = options.generate ?? standardGenerate();
  const value = options.value ?? ((rng: Random) => ({ type: "number", value: rng.pick([0, 1, 2]) }));
  const wire = options.wire ?? standardWire;
  const wired = options.wired ?? 0.2;
  const runs = options.runs ?? true;
  const nodes = options.nodes ?? ["p", "q", "r", "s", "t"];
  const hostNames = options.names ?? ["a", "b", "x", "n"];
  const hostValues = options.values ?? standardValues();
  const contexts = options.contexts ?? standardContexts();
  const total = options.count ?? 100;
  const steps = options.steps ?? 30;
  const first = options.seed ?? 9_000_011;
  const given = options.equal;
  const equal = (a: unknown, b: unknown): boolean | undefined => {
    const answer = given?.(a, b);
    if (answer !== undefined) return answer;
    if (isClosure(a) || isClosure(b)) return isClosure(a) && isClosure(b) && docEquals(closureParams(a), closureParams(b));
    return undefined;
  };
  const counts = { reads: 0, compared: 0, unrepeatable: 0, values: 0, cycles: 0, runs: 0, data: 0, empty: 0, edits: 0, additions: 0, removes: 0, same: 0, machines: 0 };
  const declared = declaredType === undefined ? {} : { declaredType };
  for (let run = 0; run < total; run += 1) {
    const seed = first + run;
    const rng = random(seed);
    const node = (): Json => ({ type: "ref", value: ["world", rng.pick(nodes)] });
    let at = 0;
    let machine = machines[0] as Machine;
    let made = 0;
    const make = (): unknown => {
      if (rng.chance(wired)) return wire(rng, node);
      const roll = rng.int(10);
      if (roll === 0) return value(rng);
      // Some nodes read only the data of the host, thus the graph is not always one component.
      const names = roll < 5 ? hostNames : [...hostNames, ...nodes, ...nodes, ...nodes];
      const doc = linked(generate(machine.world, { ...generateOptions, names, seed: seed * 31 + made++ }), rng, nodes);
      return runs && roll === 9 ? { type: "log", value: [doc] } : doc;
    };
    const docs = new Map<string, unknown>(nodes.map((id) => [id, make()]));
    const start = contexts[run % contexts.length] as Context;
    let base: Context = { ...start, names: { ...start.names } };
    const host = engine(machine, { ...declared, context: base });
    for (const [id, doc] of docs) host.set(id, doc);
    for (let step = 0; step < steps; step += 1) {
      const what = rng.int(12);
      if (what < 4) {
        const fresh = fromScratch(machine, docs, base, declaredType);
        const again = fromScratch(machine, docs, base, declaredType);
        const ids = shuffle([...docs.keys()], rng);
        // Half of the reads demand each node in a random order, and the other half demand one node.
        for (const id of rng.chance(0.5) ? ids : ids.slice(0, 1)) {
          const got = host.read(id);
          const want = fresh.get(id) as Result;
          counts.reads += 1;
          // A result that is new at each evaluation has no one result to compare.
          if (!sameResult(want, again.get(id) as Result, equal)) {
            counts.unrepeatable += 1;
            continue;
          }
          counts.compared += 1;
          if (sameResult(want, cycleOf(id))) counts.cycles += 1;
          else if (sameResult(want, runSide(id))) counts.runs += 1;
          else if (want.ok) counts.values += 1;
          if (!sameResult(got, want, equal)) {
            const reason =
              got.ok === want.ok && !got.ok
                ? `The engine and the evaluation from scratch give two different errors ${named(got)} and ${named(want)} for the node ${id}.`
                : `The engine gives ${named(got)} for the node ${id}, and the evaluation from scratch gives ${named(want)}.`;
            return { ok: false, seed, step, node: id, engine: got, scratch: want, docs: new Map(docs), context: base, machine, reason, counts: { ...counts } };
          }
        }
      } else if (what < 6) {
        base = { ...base, names: change(base, rng, hostNames, hostValues) };
        host.changeData(base);
        counts.data += 1;
      } else if (what === 6) {
        // A change of data that changes no value: the same context object again.
        host.changeData(base);
        counts.empty += 1;
      } else if (what < 9) {
        const id = rng.pick(nodes);
        const doc = make();
        docs.set(id, doc);
        host.set(id, doc);
        counts.edits += 1;
      } else if (what === 9) {
        const absent = nodes.filter((id) => !docs.has(id));
        if (absent.length > 0 && (docs.size <= 2 || rng.chance(0.65))) {
          const id = rng.pick(absent);
          const doc = make();
          docs.set(id, doc);
          host.set(id, doc);
          counts.additions += 1;
        } else {
          const id = rng.pick([...docs.keys()]);
          docs.delete(id);
          host.remove(id);
          counts.removes += 1;
        }
      } else if (what === 10) {
        // The same document object again: a change of the structure without an edit.
        const id = rng.pick([...docs.keys()]);
        host.set(id, docs.get(id));
        counts.same += 1;
      } else if (host.changeMachine !== undefined) {
        at = (at + 1) % machines.length;
        machine = machines[at] as Machine;
        host.changeMachine(machine);
        counts.machines += 1;
      }
    }
  }
  return { ok: true, counts };
}
