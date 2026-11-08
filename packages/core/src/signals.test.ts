import { describe, expect, it } from "vitest";
import {
  type Context,
  type DocFacts,
  type HostThing,
  type Json,
  type Key,
  type Machine,
  type Plan,
  type Result,
  type ScheduleEngine,
  type ScheduleEngineStart,
  Failure,
  STD_MACHINE,
  THING,
  agreeSchedule,
  context,
  factsOf,
  ok,
  prepare,
  sameResult,
} from "./index.ts";
import { cycleOf, runSide } from "./schedule.ts";

/**
 * A reference adapter for signals (S3b, R4 P6, D155). It lives only in the tests: the kernel has no signals. A change
 * pushes marks to the readers, and a demand pulls only what the marks name.
 */
const CLEAN = 0;
const MAYBE = 1;
const DIRTY = 2;

let active: Computed<unknown> | undefined;

/** What a computed can read. */
interface Source {
  version: number;
  readonly observers: Set<Computed<unknown>>;
  readonly running: boolean;
  refresh(): void;
}

function track(source: Source): void {
  if (active === undefined) return;
  active.sources.set(source, source.version);
  source.observers.add(active);
}

class Signal<T> implements Source {
  private value: T;
  version = 0;
  reads = 0;
  readonly running = false;
  readonly observers = new Set<Computed<unknown>>();

  constructor(value: T) {
    this.value = value;
  }

  get(): T {
    this.reads += 1;
    track(this);
    return this.value;
  }

  set(value: T): void {
    if (Object.is(value, this.value)) return;
    this.value = value;
    this.version += 1;
    for (const observer of this.observers) observer.mark(DIRTY);
  }

  refresh(): void {}
}

class Computed<T> implements Source {
  private readonly code: () => T;
  private readonly equals: (a: T, b: T) => boolean;
  version = 0;
  running = false;
  /** `true` for a node of a cycle. Each mark then computes it again: a cycle has no order to verify (SCHED.CYCLE). */
  cyclic = false;
  sources = new Map<Source, number>();
  readonly observers = new Set<Computed<unknown>>();
  private state = DIRTY;
  private value: T | undefined;

  constructor(code: () => T, equals: (a: T, b: T) => boolean = Object.is) {
    this.code = code;
    this.equals = equals;
  }

  get(): T {
    this.refresh();
    track(this);
    return this.value as T;
  }

  /** This function records a read of a computed that runs, thus a change of it marks the reader. */
  track(): void {
    track(this);
  }

  mark(level: number): void {
    const before = this.state;
    const next = this.cyclic ? DIRTY : level;
    if (next <= before) return;
    this.state = next;
    if (before === CLEAN) for (const observer of this.observers) observer.mark(MAYBE);
  }

  refresh(): void {
    if (this.state === MAYBE) {
      for (const [source, seen] of this.sources) {
        if (source.running) {
          this.state = DIRTY;
          break;
        }
        source.refresh();
        // A cycle through this node can compute it during the refresh of a source.
        if ((this.state as number) === CLEAN) return;
        if (source.version !== seen) {
          this.state = DIRTY;
          break;
        }
      }
      if (this.state === MAYBE) this.state = CLEAN;
    }
    if (this.state === DIRTY) this.compute();
  }

  private compute(): void {
    for (const source of this.sources.keys()) source.observers.delete(this as Computed<unknown>);
    this.sources = new Map();
    const outer = active;
    active = this as Computed<unknown>;
    this.running = true;
    const first = this.version === 0;
    const value = this.code();
    this.running = false;
    active = outer;
    this.state = CLEAN;
    if (first || !this.equals(this.value as T, value)) {
      this.value = value;
      this.version += 1;
    }
  }
}

/** A node of the engine: its document, its plan and its result. */
interface SignalNode {
  readonly doc: Signal<unknown>;
  /** A reader of the node reads only this signal and the value, thus a new document stops at the cutoff. */
  readonly present: Signal<boolean>;
  readonly plan: Computed<{ readonly side: DocFacts["side"]; readonly plan: Plan }>;
  readonly value: Computed<Result>;
}

/** The engine, and the work that it did. */
interface SignalEngine extends ScheduleEngine {
  readonly evaluated: string[];
  readonly compiled: string[];
}

/**
 * This function gives an engine of the meaning of D31 on signals. Each node is a computed that evaluates its plan, and
 * the root `world` is a host thing that reads each other node through its computed. The function `sameResult` is the
 * cutoff. The algorithm of Tarjan over the demands gives each node of a cycle `#CYCLE!`, as `agreeSchedule` asks.
 *
 * @param first - The first machine.
 * @param start - The context of the host, and the type of a bare root value.
 * @returns The engine.
 */
function signalEngine(first: Machine, start: ScheduleEngineStart): SignalEngine {
  const declared = start.declaredType === undefined ? {} : { declaredType: start.declaredType };
  const machine = new Signal(first);
  const ids = new Signal<readonly string[]>([]);
  const nodes = new Map<string, SignalNode>();
  const evaluated: string[] = [];
  const compiled: string[] = [];
  const index = new Map<string, number>();
  const lowest = new Map<string, number>();
  const component: string[] = [];
  const evaluating: string[] = [];
  const selfReads = new Set<string>();

  const compute = (id: string, node: SignalNode): Result => {
    const { side, plan } = node.plan.get();
    node.value.cyclic = false;
    if (side === "run") return runSide(id);
    const at = index.size;
    index.set(id, at);
    lowest.set(id, at);
    component.push(id);
    evaluating.push(id);
    evaluated.push(id);
    let result = plan.evaluate(data.get());
    evaluating.pop();
    const cycle = (lowest.get(id) as number) < at || component.splice(component.indexOf(id)).length > 1 || selfReads.has(id);
    if (cycle) {
      node.value.cyclic = true;
      result = cycleOf(id);
    }
    return result;
  };

  const nodeOf = (id: string): SignalNode => {
    const found = nodes.get(id);
    if (found !== undefined) return found;
    const doc = new Signal<unknown>(undefined);
    const plan = new Computed(() => {
      compiled.push(id);
      const held = doc.get();
      return { side: factsOf(machine.get(), held, declared).side, plan: prepare(machine.get(), held, declared) };
    });
    const node: SignalNode = { doc, present: new Signal(false), plan, value: new Computed(() => compute(id, node), (a, b) => sameResult(a, b)) };
    nodes.set(id, node);
    return node;
  };

  const demand = (id: string, node: SignalNode): Result => {
    const reader = evaluating[evaluating.length - 1];
    const link = (to: number): void => {
      if (reader !== undefined) lowest.set(reader, Math.min(lowest.get(reader) as number, to));
    };
    if (evaluating.includes(id)) {
      node.value.track();
      link(index.get(id) as number);
      if (reader === id) selfReads.add(id);
      return cycleOf(id);
    }
    const visited = index.has(id);
    const result = node.value.get();
    if (!visited && index.has(id)) link(lowest.get(id) as number);
    else if (component.includes(id)) link(index.get(id) as number);
    return result;
  };

  const world: HostThing = {
    [THING]: true,
    label: "nodes",
    deref(key) {
      const id = String(key);
      const node = nodeOf(id);
      if (!node.present.get()) return undefined;
      const result = demand(id, node);
      if (!result.ok) throw new Failure(result.error);
      return result.value;
    },
    has: (key) => nodeOf(String(key)).present.get(),
    toJson() {
      const out: Record<string, unknown> = {};
      for (const id of [...ids.get()].sort()) {
        const node = nodeOf(id);
        if (node.plan.get().side === "run") continue;
        const result = demand(id, node);
        if (!result.ok) throw new Failure(result.error);
        out[id] = result.value;
      }
      return out;
    },
  };

  let base = start.context;
  const data = new Signal<Context>({ ...base, world });

  return {
    evaluated,
    compiled,
    set(id, doc) {
      const node = nodeOf(id);
      node.doc.set(doc);
      node.present.set(true);
      if (!ids.get().includes(id)) ids.set([...ids.get(), id]);
    },
    remove(id) {
      nodeOf(id).present.set(false);
      ids.set(ids.get().filter((each) => each !== id));
    },
    changeData(given) {
      if (given === base) return;
      base = given;
      data.set({ ...given, world });
    },
    changeMachine: (next) => machine.set(next),
    read(id) {
      const result = demand(id, nodeOf(id));
      index.clear();
      lowest.clear();
      selfReads.clear();
      component.length = 0;
      return result;
    },
  };
}

const ref = (...path: readonly Json[]): Json => ({ type: "ref", value: [...path] });
const add = (...value: readonly Json[]): Json => ({ type: "add", value: [...value] });
const num = (value: number): Json => ({ type: "number", value });
const ifDoc = (test: Json, then: Json, otherwise: Json): Json => ({ type: "if", value: { test, then, else: otherwise } });

/** A host value whose fields read through signals. */
function store(fields: Readonly<Record<string, Signal<unknown>>>): HostThing {
  return {
    [THING]: true,
    label: "store",
    deref: (key: Key) => fields[String(key)]?.get(),
    toJson: () => Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.get()])),
  };
}

describe("a reference adapter for signals", () => {
  // The 1000 runs used 0.930 of the timeout in CI, thus each test examines one part of 250 runs (D96). Each part starts
  // at its own seed, thus the parts examine the same runs as one test. The last test checks the totals.
  const signalParts = 4;
  const signalTotals = { compared: 0, cycles: 0, runs: 0, parts: 0 };
  for (let part = 0; part < signalParts; part += 1) {
    it(`[SCHED.SIGNALS] agreeSchedule finds no stale answer in a push-pull engine of signals: part ${part + 1} of ${signalParts}`, () => {
      const outcome = agreeSchedule(signalEngine, { count: 250, steps: 30, seed: 9_000_011 + part * 250 });
      expect(outcome).toMatchObject({ ok: true });
      if (!outcome.ok) return;
      signalTotals.compared += outcome.counts.compared;
      signalTotals.cycles += outcome.counts.cycles;
      signalTotals.runs += outcome.counts.runs;
      signalTotals.parts += 1;
    });
  }

  it("[SCHED.SIGNALS] the parts of the agreement compare more than 1000 answers, with more than 50 cycles and 50 runs", () => {
    expect(signalTotals.parts).toBe(signalParts);
    expect(signalTotals.compared).toBeGreaterThan(1000);
    expect(signalTotals.cycles).toBeGreaterThan(50);
    expect(signalTotals.runs).toBeGreaterThan(50);
  });

  it("[SCHED.SIGNALS] a change evaluates only its readers, and an equal result stops at the cutoff", () => {
    const engine = signalEngine(STD_MACHINE, { context: context({ names: { x: 1 } }) });
    engine.set("p", num(1));
    engine.set("q", add(ref("world", "p"), 1));
    engine.set("r", add(ref("world", "q"), 1));
    engine.set("s", ref("names", "x"));
    for (const id of ["p", "q", "r", "s"]) engine.read(id);
    expect(engine.evaluated.sort()).toEqual(["p", "q", "r", "s"]);
    // A memo that lives longer than one evaluation is a signal: a second read evaluates nothing.
    engine.evaluated.length = 0;
    expect(engine.read("r")).toEqual(ok(3));
    expect(engine.evaluated).toEqual([]);
    // Each reader of a new value evaluates, and the node s does not read it.
    engine.set("p", num(2));
    expect(engine.read("s")).toEqual(ok(1));
    expect(engine.evaluated).toEqual([]);
    expect(engine.read("r")).toEqual(ok(4));
    expect(engine.evaluated.sort()).toEqual(["p", "q", "r"]);
    // A new document with an equal result stops at its node.
    engine.evaluated.length = 0;
    engine.set("p", add(1, 1));
    expect(engine.read("r")).toEqual(ok(4));
    expect(engine.evaluated).toEqual(["p"]);
    // A change of data compiles nothing.
    engine.compiled.length = 0;
    engine.changeData(context({ names: { x: 2 } }));
    expect(engine.read("s")).toEqual(ok(2));
    expect(engine.compiled).toEqual([]);
  });

  it("[SCHED.SIGNALS] a plan keeps no value, thus the library sees each read of each evaluation (PLAN.LEAN)", () => {
    const test = new Signal<unknown>(true);
    const left = new Signal<unknown>(1);
    const right = new Signal<unknown>(2);
    const ctx = context({ names: { data: store({ test, left, right }) } });
    const plan = prepare(STD_MACHINE, ifDoc(ref("names", "data", "test"), ref("names", "data", "left"), ref("names", "data", "right")));
    let evaluations = 0;
    const node = new Computed(() => {
      evaluations += 1;
      return plan.evaluate(ctx);
    });
    expect(node.get()).toEqual(ok(1));
    // The computed reads only the branch that the test selects.
    right.set(20);
    expect(node.get()).toEqual(ok(1));
    expect(evaluations).toBe(1);
    test.set(false);
    expect(node.get()).toEqual(ok(20));
    expect(evaluations).toBe(2);
    left.set(10);
    expect(node.get()).toEqual(ok(20));
    expect(evaluations).toBe(2);
  });

  it("[SCHED.SIGNALS] a fold reads nothing outside, and a host thing does not fix a name (PLAN.FOLD, PLAN.FIXED)", () => {
    const field = new Signal<unknown>(1);
    const data = store({ field });
    const fold = prepare(STD_MACHINE, add(1, 2));
    expect(fold.evaluate(context({ names: { data } }))).toEqual(ok(3));
    expect(field.reads).toBe(0);
    // A signal of a fixed name would give the first value for each evaluation. A name with a host thing stays free.
    const plan = prepare(STD_MACHINE, ref("names", "data", "field"), { fixed: { names: { data } } });
    expect(plan.evaluate(context({ names: { data } }))).toEqual(ok(1));
    field.set(2);
    expect(plan.evaluate(context({ names: { data } }))).toEqual(ok(2));
  });

  it("[SCHED.SIGNALS] with adopt each key is a signal read, and a thing with resolve answers a path with one (DEREF.ADOPT, DEREF.PATH)", () => {
    const leaf = new Signal<unknown>(7);
    const inner = new Signal<unknown>(undefined);
    const outer = new Signal<unknown>(undefined);
    const innerThing = store({ leaf });
    inner.set(innerThing);
    const middle = store({ inner });
    outer.set(middle);
    const root = store({ outer });
    const doc = ref("names", "root", "outer", "inner", "leaf");
    const adopted = { ...STD_MACHINE, adopt: (value: unknown) => value };
    expect(prepare(adopted, doc).evaluate(context({ names: { root } }))).toEqual(ok(7));
    expect([outer.reads, inner.reads, leaf.reads]).toEqual([1, 1, 1]);
    const signal = new Signal<unknown>(7);
    const quick: HostThing = { ...store({}), resolve: () => ({ thing: signal.get() }) };
    expect(prepare(STD_MACHINE, doc).evaluate(context({ names: { root: quick } }))).toEqual(ok(7));
    expect(signal.reads).toBe(1);
  });
});
