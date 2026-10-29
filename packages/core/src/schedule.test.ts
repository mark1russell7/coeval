import { describe, expect, it } from "vitest";
import {
  type AgreeScheduleOptions,
  type Effect,
  type FormulaProfile,
  type Json,
  type Key,
  type Random,
  type Result,
  type Schedule,
  type ScheduleAgreement,
  type ScheduleEngineFactory,
  type ScheduleOptions,
  Held,
  STD_MACHINE,
  agreeSchedule,
  context,
  cycles,
  edgesOf,
  factsOf,
  fail,
  formulaMachine,
  isClosure,
  isHostThing,
  jsTruthy,
  ok,
  sameResult,
  schedule,
  typesOf,
  valueOfThing,
} from "./index.ts";

/** The number of runs for each configuration of the harness. CI can raise it with COEVAL_SCHEDULE_COUNT. */
const COUNT = Number(process.env["COEVAL_SCHEDULE_COUNT"] ?? 100);

/** The number of commands in one run: reads, changes of data, edits, removed nodes and new machines. */
const STEPS = 30;

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });
const op = (name: string, ...args: Json[]): Json => ({ type: ["ops", name], value: args });

class Box {
  constructor(readonly v: unknown) {}
}

/** The rule of the tests for two results: a box compares its value, and two closures compare their parameters. */
function equal(a: unknown, b: unknown): boolean | undefined {
  if (a instanceof Box || b instanceof Box) return a instanceof Box && b instanceof Box && sameResult(ok(a.v), ok(b.v), equal);
  if (isClosure(a) || isClosure(b)) {
    const params = (value: unknown): unknown => (value as Readonly<Record<symbol, { readonly params: readonly string[] }>>)[Symbol.for("coeval.closure")]?.params;
    return isClosure(a) && isClosure(b) && JSON.stringify(params(a)) === JSON.stringify(params(b));
  }
  return undefined;
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item: unknown) => (typeof item === "function" ? "<fn>" : item === undefined ? "<undefined>" : item instanceof Held ? `<held ${item.error.code}>` : item));
  } catch {
    return String(value);
  }
}

const LAZY: FormulaProfile["lazy"] = {
  ifError: (args) => {
    const first = args[0]?.() ?? fail("#ARGS", "ifError needs an argument.");
    return first.ok ? first : (args[1]?.() ?? first);
  },
  second: (args) => args[1]?.() ?? fail("#ARGS", "second needs two arguments."),
};

const OPS: Readonly<Record<string, (...args: never[]) => unknown>> = {
  add: (a: unknown, b: unknown) => {
    if (typeof a === "number" && typeof b === "number") return a + b;
    if (typeof a === "string" && typeof b === "string") return a + b;
    throw new TypeError("add needs two numbers or two texts.");
  },
  neg: (a: number) => -a,
  pair: (a: unknown, b: unknown) => [a, b],
  apply: (fn: (value: unknown) => unknown, value: unknown) => fn(value),
  map: (fn: (value: unknown) => unknown, items: readonly unknown[]) => items.map((item) => fn(item)),
  keys: (value: object) => Object.keys(value),
  box: (value: unknown) => new Box(value),
};

const EXT: NonNullable<FormulaProfile["ext"]> = {
  here: (_data, ctx) => ok(ctx.self === null ? "none" : "self"),
  count: (_data, ctx) => ok(Object.keys(ctx.names).length),
};

const STRICT: FormulaProfile = { ops: OPS, lazy: LAZY, ext: EXT, pure: true };
const LOOSE: FormulaProfile = {
  ops: OPS,
  lazy: LAZY,
  ext: EXT,
  truthy: jsTruthy,
  logic: "value",
  otherwise: undefined,
  omit: (error) => error.code === "#N/A",
  missing: (value) => value === undefined,
  combine: (errors) => ({ code: "#MANY", reason: `${errors.length} parts failed.` }),
  pure: ["add", "neg", "pair", "apply", "map", "keys", "box", "ifError", "second"],
};

const strictMachine = formulaMachine(STRICT);
const looseMachine = formulaMachine(LOOSE);
const LIT = { declaredType: "lit" } as const;

/** The error of a node on a cycle, as D31 gives it. */
const cycle = (id: string): Result => fail("#CYCLE!", `The node ${id} is on a cycle of reads.`);
/** The error of a read of a node on the run side, as D31 gives it. */
const refused = (id: string): Result => fail("#REF!", `The node ${id} is on the run side, thus it has no value for a reader.`);

/** The standard machine with the tree kind `watch`: each field is an attribute, and the kind gives the equations. */
function treeMachine(equations: Readonly<Record<string, Json>>): typeof STD_MACHINE {
  const watch = {
    verbs: { eval: "tree.node" },
    parts: { shape: "record", fields: {}, rest: { shape: "term" } },
    caps: [{ rule: "mask" }],
    pure: true,
    lazy: [{}],
    reads: ["self"],
    tree: { equations },
  } as const;
  return { ...STD_MACHINE, world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, watch } } };
}

describe("the interface of a schedule", () => {
  it("[SCHED.GRAPH] a schedule keeps named documents as nodes under the root world, and the graph stays one object in a structure epoch", () => {
    const b: Json = op("add", ref("world", "a"), ref("names", "x"));
    const s = schedule(strictMachine, { ...LIT, context: context({ names: { x: 1 } }) });
    s.set("a", 2);
    s.set("b", b);
    const graph = s.graph();
    expect([...graph.keys()]).toEqual(["a", "b"]);
    expect(graph.get("b")).toMatchObject({ id: "b", doc: b, side: "derive", facts: factsOf(strictMachine, b, LIT) });
    expect(graph.get("b")?.edges.map((edge) => edge.to)).toEqual(["a"]);
    expect(graph.get("a")?.edges).toEqual([]);
    // The root world reaches the nodes, and the context of the host gives the other roots.
    expect(s.read("b")).toEqual(ok(3));
    expect(isHostThing(s.context.world)).toBe(true);
    expect(s.context.names).toEqual({ x: 1 });
    // A change of data keeps the graph, and a change of the structure makes a new one.
    expect(s.graph()).toBe(graph);
    s.changeData(context({ names: { x: 2 } }));
    expect(s.graph()).toBe(graph);
    expect(s.read("b")).toEqual(ok(4));
    s.set("c", ref("world", "b"));
    const next = s.graph();
    expect(next).not.toBe(graph);
    // The facts stay for each document object, as DURABLE.STRUCTURE says.
    expect(next.get("b")?.facts).toBe(graph.get("b")?.facts);
    expect(next.get("b")?.edges).toBe(graph.get("b")?.edges);
    expect(s.read("c")).toEqual(ok(4));
    // A host world in the context does not hide the nodes.
    const hosted = schedule(strictMachine, { ...LIT, context: context({ world: { a: 9 } }) });
    hosted.set("a", 1);
    hosted.set("b", ref("world", "a"));
    expect(hosted.read("b")).toEqual(ok(1));
  });

  it("[SCHED.EDGES] each static read of world is an edge to the node of its first key, a read without a key reaches each node, and another root is no edge", () => {
    const doc: Json = {
      type: "list",
      value: [ref("world", "a", "x"), ref("world"), ref("names", "y"), { type: "if", value: { test: ref("names", "t"), then: ref("world", "b"), else: 0 } }, ref("world", 0)],
    };
    const facts = factsOf(strictMachine, doc);
    const edges = edgesOf(facts);
    expect(edges.map((edge) => [edge.to, edge.field, edge.lazy])).toEqual([
      ["a", ["x"], false],
      [undefined, [], false],
      ["b", [], true],
      ["0", [], false],
    ]);
    expect(edges[0]?.read).toBe(facts.reads[0]);
    // A step document right after the root can reach each node. A step document after a node keeps the node.
    const steps = edgesOf(factsOf(STD_MACHINE, { type: "list", value: [ref("world", { type: "nearest", value: "panel" }), ref("world", "a", { type: "nearest", value: "panel" }, "x")] }));
    expect(steps.map((edge) => [edge.to, edge.field, edge.read.exact])).toEqual([
      [undefined, [], false],
      ["a", [], false],
    ]);
    // A name that a kind binds is no read, thus no edge.
    expect(edgesOf(factsOf(strictMachine, { type: "let", value: { bind: { world: 1 }, body: ref("names", "world") } }))).toEqual([]);
  });

  it("[SCHED.GRAIN] an edge goes to the node and keeps the field, and a reader of a field keeps its result after a change of another field", () => {
    const s = schedule(strictMachine, { ...LIT, context: context({ names: { x: 1, y: 1 } }) });
    s.set("a", { type: "record", value: { x: ref("names", "x"), y: ref("names", "y") } });
    s.set("b", ref("world", "a", "x"));
    expect(s.graph().get("b")?.edges).toMatchObject([{ to: "a", field: ["x"], lazy: false }]);
    expect(s.read("b")).toEqual(ok(1));
    const before = s.counts;
    s.changeData(context({ names: { x: 1, y: 2 } }));
    expect(s.read("b")).toEqual(ok(1));
    const after = s.counts;
    // The node a evaluates again. The node b verifies its read of a.x, and it keeps its result.
    expect(after.evaluations - before.evaluations).toBe(1);
    expect(after.verifications - before.verifications).toBe(2);
    expect(after.reuses - before.reuses).toBe(1);
    expect(s.read("a")).toEqual(ok({ x: 1, y: 2 }));
    // A change of the field that b reads evaluates b again.
    s.changeData(context({ names: { x: 5, y: 2 } }));
    expect(s.read("b")).toEqual(ok(5));
    expect(s.counts.evaluations - after.evaluations).toBe(2);
  });

  it("[SCHED.SIDE] a node on the run side is a sink: a read of it gives #REF!, and the record of the root world has only the derive nodes", () => {
    const s = schedule(STD_MACHINE, { context: context({ caps: ["log"] }) });
    s.set("t", { type: "text", value: "hi" });
    s.set("n", { type: "number", value: 2 });
    s.set("r", { type: "log", value: [ref("world", "t")] });
    s.set("a", { type: "list", value: [ref("world", "n"), ref("world", "r")] });
    const graph = s.graph();
    expect(graph.get("r")?.side).toBe("run");
    expect(graph.get("r")?.edges.map((edge) => edge.to)).toEqual(["t"]);
    expect(graph.get("a")?.side).toBe("derive");
    expect(s.read("r")).toEqual(refused("r"));
    expect(s.read("a")).toEqual(fail("#REF!", "The node r is on the run side, thus it has no value for a reader.", { place: [1] }));
    // A failed node fails the record too.
    expect(() => valueOfThing(s.context.world)).toThrow(/run side/);
    s.remove("a");
    expect(valueOfThing(s.context.world)).toEqual({ n: 2, t: "hi" });
    // A node that reads the whole root reads itself too: a cycle, as a sum of a column inside the column.
    s.set("w", ref("world"));
    expect(s.read("w")).toEqual(cycle("w"));
  });

  it("[SCHED.RUN] the schedule does not start a run, and run gives the document of a node the context of the schedule and the event of the host", async () => {
    const payloads: unknown[] = [];
    const perform = (effect: Effect): unknown => {
      payloads.push(effect.payload);
      return "done";
    };
    const s = schedule(STD_MACHINE, { context: context({ caps: ["log"], event: { x: "first" } }) });
    s.set("t", { type: "text", value: "hi" });
    s.set("r", { type: "log", value: [ref("world", "t")] });
    s.set("e", { type: "log", value: [ref("event", "x")] });
    s.set("all", { type: "log", value: [ref("world")] });
    // Demands and changes of data do not run a node.
    expect(s.read("r")).toEqual(refused("r"));
    s.changeData();
    s.set("t", { type: "text", value: "bye" });
    expect(s.read("t")).toEqual(ok("bye"));
    expect(payloads).toEqual([]);
    // Only the host starts a run. It reads the current values of the derive nodes.
    expect(await s.run("r", { perform })).toEqual(ok("done"));
    expect(payloads).toEqual(["bye"]);
    expect(await s.run("e", { perform })).toEqual(ok("done"));
    expect(await s.run("e", { perform, event: { x: "second" } })).toEqual(ok("done"));
    expect(payloads).toEqual(["bye", "first", "second"]);
    // A run reads the record of the derive nodes. It is not a node of that record, thus it is no cycle.
    expect(await s.run("all", { perform })).toEqual(ok("done"));
    expect(payloads[3]).toEqual({ t: "bye" });
    // Without a perform, a run gives each payload. A node that the schedule does not have gives #N/A.
    expect(await s.run("r")).toEqual(ok("bye"));
    expect(await s.run("nope")).toEqual(fail("#N/A", "The schedule has no node nope."));
    s.changeData();
    expect(s.read("t")).toEqual(ok("bye"));
    expect(payloads).toHaveLength(4);
  });

  it("[SCHED.DEMAND] a read evaluates a node and each node that it reads, each node one time in a data epoch, and a node that no demand reaches does not evaluate", () => {
    const s = schedule(strictMachine, { ...LIT, context: context({ names: { x: 1, z: 0 } }) });
    s.set("a", ref("names", "x"));
    s.set("b", op("add", ref("world", "a"), 1));
    s.set("c", op("add", ref("world", "b"), ref("world", "a")));
    s.set("d", ref("names", "z"));
    expect(s.read("c")).toEqual(ok(3));
    expect(s.counts).toMatchObject({ evaluations: 3, compiles: 3 });
    // Each node evaluates one time in a data epoch, also with two readers.
    expect(s.read("b")).toEqual(ok(2));
    expect(s.read("c")).toEqual(ok(3));
    expect(s.counts).toMatchObject({ evaluations: 3, verifications: 0 });
    expect(s.read("nope")).toEqual(fail("#N/A", "The schedule has no node nope."));
    // A removed node is missing for its readers.
    expect(s.remove("a")).toBe(true);
    expect(s.remove("a")).toBe(false);
    expect(s.read("b")).toEqual(fail("#N/A", "The step a reaches nothing.", { place: [0] }));
    // A chain of 100 nodes evaluates on demand. SCHED.LONG-CHAIN has a chain of 100000 nodes.
    const chain = schedule(strictMachine, LIT);
    for (let index = 0; index < 100; index += 1) chain.set(`n${index}`, index === 99 ? 0 : op("add", ref("world", `n${index + 1}`), 1));
    expect(chain.read("n0")).toEqual(ok(99));
    expect(chain.counts.evaluations).toBe(100);
  });

  it("[SCHED.STALE] after a change a pure node verifies its reads, a read of a node demands that node again, and only a node with a changed read evaluates again", () => {
    const COUNT_EXT: Json = { type: ["ext", "count"], value: null };
    const s = schedule(strictMachine, { ...LIT, context: context({ names: { x: 1, y: 1 } }) });
    s.set("a", ref("names", "x"));
    s.set("b", op("add", ref("world", "a"), 1));
    s.set("c", op("add", ref("world", "b"), 1));
    s.set("e", ref("names", "y"));
    s.set("k", COUNT_EXT);
    for (const id of ["c", "e", "k"]) s.read(id);
    expect(s.counts).toMatchObject({ evaluations: 5 });
    // An edit of a: a compiles and evaluates, and each reader of a changed read evaluates again.
    s.set("a", 5);
    let counts = s.counts;
    expect(s.read("c")).toEqual(ok(7));
    expect(s.counts.evaluations - counts.evaluations).toBe(3);
    expect(s.counts.compiles - counts.compiles).toBe(1);
    // The node e does not read a: it verifies and keeps its result. The extension reads the context outside resolve,
    // thus the node k is not pure, and it evaluates again.
    counts = s.counts;
    expect(s.read("e")).toEqual(ok(1));
    expect(s.read("k")).toEqual(ok(2));
    expect(s.counts.evaluations - counts.evaluations).toBe(1);
    expect(s.counts.reuses - counts.reuses).toBe(1);
    // A change of data that no read of the chain sees: each node of the chain verifies and keeps its result.
    counts = s.counts;
    s.changeData(context({ names: { x: 2, y: 1 } }));
    expect(s.read("c")).toEqual(ok(7));
    expect(s.counts.evaluations - counts.evaluations).toBe(0);
    expect(s.counts.verifications - counts.verifications).toBe(3);
    // The same document object again is a change of the structure without an edit: each node verifies.
    counts = s.counts;
    s.set("b", s.graph().get("b")?.doc);
    expect(s.read("c")).toEqual(ok(7));
    expect(s.counts).toMatchObject({ evaluations: counts.evaluations, compiles: counts.compiles });
    // A new machine evaluates each node again.
    counts = s.counts;
    s.changeMachine(looseMachine);
    expect(s.read("c")).toEqual(ok(7));
    expect(s.counts.evaluations - counts.evaluations).toBe(3);
  });

  it("[SCHED.CLOSURE] a closure keeps a read of the node that it reads, thus a change of another node keeps its result, with no demand and no #CYCLE!", () => {
    const s = schedule(strictMachine, { ...LIT, context: context({ names: { x: 1, y: 1 } }) });
    s.set("a", ref("names", "x"));
    s.set("b", ref("names", "y"));
    s.set("f", { type: "fn", value: { params: ["v"], body: op("add", ref("names", "v"), ref("world", "a")) } });
    s.set("g", op("apply", ref("world", "f"), 10));
    // The node a has its result before the closure of f, thus the kept read of f names the node a.
    expect(s.read("a")).toEqual(ok(1));
    const first = s.read("f");
    expect(first.ok && isClosure(first.value)).toBe(true);
    expect(s.read("g")).toEqual(ok(11));
    // A change of another node keeps the old closure. The node f verifies its kept read of a, and it does not evaluate.
    let counts = s.counts;
    s.changeData(context({ names: { x: 1, y: 2 } }));
    expect(s.read("b")).toEqual(ok(2));
    expect(s.read("a")).toEqual(ok(1));
    expect(s.read("f")).toBe(first);
    expect(s.read("g")).toEqual(ok(11));
    expect(s.counts.evaluations - counts.evaluations).toBe(1);
    // An edit of another node keeps the old closure too.
    s.set("b", 3);
    expect(s.read("a")).toEqual(ok(1));
    expect(s.read("f")).toBe(first);
    // A change of the node that the closure reads discards the old closure, and its reader gets the new value.
    s.changeData(context({ names: { x: 2, y: 2 } }));
    expect(s.read("a")).toEqual(ok(2));
    const second = s.read("f");
    expect(second).not.toBe(first);
    expect(s.read("g")).toEqual(ok(12));
    // A node without its result in the epoch gives no value to a kept read: the read has no demand. Thus the closure
    // evaluates again, and its new kept read reads the whole root world.
    counts = s.counts;
    s.changeData();
    expect(s.read("f")).not.toBe(second);
    expect(s.counts.evaluations - counts.evaluations).toBe(1);
    expect(s.counts.verifications - counts.verifications).toBe(1);
    // A closure that reads its own node gives no #CYCLE!, because the kept read does not demand the node.
    s.set("h", { type: "fn", value: { params: ["v"], body: ref("world", "h") } });
    s.set("k", op("apply", ref("world", "h"), 0));
    const own = s.read("h");
    expect(own.ok && isClosure(own.value)).toBe(true);
    const called = s.read("k");
    expect(called.ok && isClosure(called.value)).toBe(true);
  });

  it("[SCHED.EQUATION] a node with a tree keeps the reads of its equations, thus a change of a node or of the event that an equation reads evaluates it again", () => {
    // The kind watch has an equation that reads the node a and the event. Its document reads the attribute through self.
    const machine = treeMachine({ seen: { type: "add", value: [ref("world", "a"), ref("event", "n")] } });
    const s = schedule(machine, { context: context({ names: { x: 1, y: 1 }, event: { n: 10, m: 0 } }) });
    s.set("a", ref("names", "x"));
    s.set("b", ref("names", "y"));
    s.set("t", { type: "watch", value: { got: ref("self", "seen") } });
    const first = s.read("t");
    expect(first).toEqual(ok({ got: 11 }));
    // A change of the node b and of another field of the event keeps the old result: t and a verify and do not evaluate.
    let counts = s.counts;
    s.changeData(context({ names: { x: 1, y: 2 }, event: { n: 10, m: 1 } }));
    expect(s.read("t")).toBe(first);
    expect(s.counts.evaluations - counts.evaluations).toBe(0);
    expect(s.counts.reuses - counts.reuses).toBe(2);
    // A change of the node a that the equation reads discards the old result.
    counts = s.counts;
    s.changeData(context({ names: { x: 2, y: 2 }, event: { n: 10, m: 1 } }));
    expect(s.read("t")).toEqual(ok({ got: 12 }));
    expect(s.counts.evaluations - counts.evaluations).toBe(2);
    // A change of the event that the equation reads discards it too.
    counts = s.counts;
    s.changeData(context({ names: { x: 2, y: 2 }, event: { n: 20, m: 1 } }));
    expect(s.read("t")).toEqual(ok({ got: 22 }));
    expect(s.counts.evaluations - counts.evaluations).toBe(1);
    // An edit of the node a gives the new value to the equation.
    s.set("a", { type: "number", value: 5 });
    expect(s.read("t")).toEqual(ok({ got: 25 }));
  });

  it("[SCHED.EQUATION] agreeSchedule finds no stale answer for nodes with trees whose equations read other nodes", () => {
    const machine = treeMachine({ seen: ref("world", "p"), twice: { type: "add", value: [ref("world", "q"), ref("self", "seen")] } });
    const wire = (rng: Random, node: () => Json): unknown =>
      rng.chance(0.5) ? { type: "watch", value: { got: ref("self", "seen"), more: ref("self", "twice") } } : { type: "watch", value: { got: ref("self", "twice"), at: node() } };
    const outcome = agreeSchedule(schedule, { machines: [machine, { ...machine }], wire, wired: 0.5, count: COUNT / 2, steps: STEPS, equal });
    expect(told(outcome)).toEqual([]);
    expect(outcome.counts.compared).toBeGreaterThan(COUNT * 2);
  });

  it("[SCHED.CYCLE] each node of a cycle gives #CYCLE! with its name and no place, in each order of demands, and a reader gets the error at its reference", () => {
    const docs: Readonly<Record<string, Json>> = {
      a: op("add", ref("world", "b"), 1),
      // A lazy operation that catches the error cannot give a value that depends on the first demand.
      b: op("ifError", ref("world", "a"), 5),
      c: op("add", ref("world", "a"), 1),
      self: ref("world", "self"),
      // Three nodes in one component: m reads n and then x, n reads m, and x reads n. When m is the first demand, x
      // reads the finished node n of an open component. A rule for the nodes in evaluation only then misses x.
      m: op("pair", op("ifError", ref("world", "n"), 0), ref("world", "x")),
      n: op("ifError", ref("world", "m"), 1),
      x: op("ifError", ref("world", "n"), 7),
    };
    const want: Readonly<Record<string, Result>> = {
      a: cycle("a"),
      b: cycle("b"),
      c: fail("#CYCLE!", "The node a is on a cycle of reads.", { place: [0] }),
      self: cycle("self"),
      m: cycle("m"),
      n: cycle("n"),
      x: cycle("x"),
    };
    const orders = [["a", "b", "c", "self", "m", "n", "x"], ["c", "b", "a", "x", "n", "m", "self"], ["b", "c", "self", "n", "x", "m", "a"], ["x", "m", "n", "b", "a", "c", "self"]];
    for (const order of orders) {
      const s = schedule(strictMachine, LIT);
      for (const id of Object.keys(docs)) s.set(id, docs[id]);
      for (const id of order) expect(s.read(id), `${id} in the order ${order.join(" ")}`).toEqual(want[id]);
      // A change of data that no node reads keeps each error: the verification finds each cycle again.
      s.changeData(context({ names: { unused: 1 } }));
      for (const id of [...order].reverse()) expect(s.read(id), `${id} after a change of data`).toEqual(want[id]);
    }

    // A static cycle through a read that the evaluation skips is no cycle.
    const s = schedule(strictMachine, { ...LIT, context: context({ names: { flag: false } }) });
    s.set("p", { type: "if", value: { test: ref("names", "flag"), then: ref("world", "q"), else: 1 } });
    s.set("q", op("add", ref("world", "p"), 1));
    expect(s.graph().get("p")?.edges).toMatchObject([{ to: "q", lazy: true }]);
    expect(s.read("q")).toEqual(ok(2));
    expect(s.read("p")).toEqual(ok(1));
    s.changeData(context({ names: { flag: true } }));
    expect(s.read("p")).toEqual(cycle("p"));
    expect(s.read("q")).toEqual(cycle("q"));
    s.changeData(context({ names: { flag: false } }));
    expect(s.read("p")).toEqual(ok(1));
    expect(s.read("q")).toEqual(ok(2));
  });

  it("[SCHED.LONG-CHAIN] a demand of the host first demands the nodes that the eager edges reach, deepest first, thus a chain of 100000 nodes gives its value with no #DEPTH!", async () => {
    const LENGTH = 100_000;
    const chain = schedule(strictMachine, { ...LIT, context: context({ names: { x: 7 } }) });
    for (let index = 0; index < LENGTH; index += 1) chain.set(`n${index}`, index === LENGTH - 1 ? ref("names", "x") : ref("world", `n${index + 1}`));
    expect(chain.read("n0")).toEqual(ok(7));
    // Each node evaluates one time. Each node after the first is a demand ahead of the first node.
    expect(chain.counts).toMatchObject({ evaluations: LENGTH, ahead: LENGTH - 1 });
    expect(chain.read(`n${LENGTH / 2}`)).toEqual(ok(7));
    expect(chain.counts).toMatchObject({ evaluations: LENGTH, ahead: LENGTH - 1 });
    // After a change of data, each node verifies its read, deepest first, also with no #DEPTH!.
    chain.changeData();
    expect(chain.read("n0")).toEqual(ok(7));
    expect(chain.counts).toMatchObject({ evaluations: LENGTH, verifications: LENGTH, reuses: LENGTH, ahead: 2 * (LENGTH - 1) });
    // A new value at the end of a chain of 5000 nodes reaches the first node.
    const short = schedule(strictMachine, { ...LIT, context: context({ names: { x: 7 } }) });
    for (let index = 0; index < 5000; index += 1) short.set(`n${index}`, index === 4999 ? ref("names", "x") : op("add", ref("world", `n${index + 1}`), 1));
    expect(short.read("n0")).toEqual(ok(5006));
    short.changeData(context({ names: { x: 8 } }));
    expect(short.read("n0")).toEqual(ok(5007));
    expect(short.counts).toMatchObject({ evaluations: 10_000, verifications: 5000 });

    // A node behind a lazy edge is not a demand ahead: a test that skips the read does not evaluate it.
    const s = schedule(strictMachine, { ...LIT, context: context({ names: { flag: false } }) });
    s.set("top", op("add", ref("world", "near"), { type: "if", value: { test: ref("names", "flag"), then: ref("world", "far"), else: 0 } }));
    s.set("near", 1);
    s.set("far", 2);
    expect(s.read("top")).toEqual(ok(1));
    expect(s.counts).toMatchObject({ evaluations: 2, ahead: 1 });

    // A long chain that ends at a cycle: each node of the cycle gives #CYCLE!, and each node of the chain gets the
    // error at its reference, as D31 says.
    const ends = schedule(strictMachine, LIT);
    for (let index = 0; index < 5000; index += 1) ends.set(`n${index}`, op("add", ref("world", index === 4999 ? "c1" : `n${index + 1}`), 1));
    ends.set("c1", op("add", ref("world", "c2"), 1));
    ends.set("c2", op("ifError", ref("world", "c1"), 0));
    expect(ends.read("n0")).toEqual(fail("#CYCLE!", "The node c1 is on a cycle of reads.", { place: [0] }));
    expect(ends.read("c1")).toEqual(cycle("c1"));
    expect(ends.read("c2")).toEqual(cycle("c2"));

    // A run reads a node with no node in evaluation, thus its read is a demand of the host too.
    const runs = schedule(STD_MACHINE, { context: context({ caps: ["log"] }) });
    for (let index = 0; index < 5000; index += 1) runs.set(`n${index}`, index === 4999 ? { type: "number", value: 3 } : ref("world", `n${index + 1}`));
    runs.set("r", { type: "log", value: [ref("world", "n0")] });
    expect(await runs.run("r")).toEqual(ok(3));
    expect(runs.counts.ahead).toBe(4999);
  });
});

/* The harness for one meaning across schedules (R4 P4): `agreeSchedule` compares an engine with an evaluation from scratch. */

const NODES: readonly string[] = ["p", "q", "r", "s", "t"];
const MORE_REFS: readonly (readonly Key[])[] = Array.from({ length: 8 }, () => ["ref"]);
const OP_TYPES: readonly (readonly Key[])[] = [...Object.keys(OPS).map((name) => ["ops", name]), ["ops", "ifError"], ["ops", "ifError"], ["ops", "second"]];

interface Config {
  readonly name: string;
  /** The options of `agreeSchedule`. The configuration `standard` uses the defaults. */
  readonly options: AgreeScheduleOptions;
  /** `true`: some nodes are on the run side. */
  readonly runs: boolean;
  /** `true`: a literal can hold a reference to a node (S1d). Then the static edges do not show each read of a node. */
  readonly inData: boolean;
}

/** This function gives a formula that reads one or two nodes. Some formulas read a node after a failed read. */
function wireFormula(rng: Random, node: () => Json): Json {
  const roll = rng.int(6);
  if (roll === 0) return op("pair", op("ifError", node(), 0), op("ifError", node(), 1));
  if (roll === 1) return op("ifError", node(), node());
  if (roll === 2) return op("ifError", node(), rng.int(9));
  if (roll === 3) return op("pair", node(), node());
  return roll === 4 ? op("add", node(), 1) : node();
}

const CONFIGS: readonly Config[] = [
  {
    name: "formula",
    options: {
      machines: [strictMachine, looseMachine],
      declaredType: "lit",
      generate: {
        declaredType: "lit",
        maxSize: 16,
        types: [...typesOf(strictMachine.world), ...OP_TYPES, ["ext", "count"], ["ext", "here"], ...MORE_REFS, ["if"], ["and"], ["fn"], ["let"]],
        hints: (type, path) => (type[0] === "call" && path[0] === "fn" ? [["fn"], ["ref"]] : type[0] === "ops" && (type[1] === "map" || type[1] === "apply") ? [["fn"]] : undefined),
        // A literal that holds a reference to a node: a read of the literal follows it (DEREF.COLLAPSE, S1d).
        data: (type, rng) => (type.join(".") === "lit" && rng.chance(0.1) ? ref("names", rng.pick(NODES)) : undefined),
      },
      runs: false,
      value: (rng) => rng.pick<unknown>([0, 1, "two", [1, 2], { a: 1 }, null]),
      wire: wireFormula,
      wired: 0.2,
    },
    runs: false,
    inData: true,
  },
  // The defaults of `agreeSchedule` fit the standard machine: a copy of the machine, and some nodes on the run side.
  { name: "standard", options: {}, runs: true, inData: false },
  {
    // A dense graph: most nodes read two nodes and catch a failed read. It makes many cycles that share nodes.
    name: "wired",
    options: {
      machines: [strictMachine, looseMachine],
      declaredType: "lit",
      generate: { declaredType: "lit", maxSize: 8, types: [...OP_TYPES, ["ref"], ["lit"]] },
      runs: false,
      value: (rng) => rng.pick<unknown>([0, 1, 2]),
      wire: wireFormula,
      wired: 0.85,
    },
    runs: false,
    inData: false,
  },
];

/** What a watched schedule saw: the nodes with `#CYCLE!` and no static cycle, the certain cycles, and the work. */
interface Watch {
  readonly missed: string[];
  readonly schedules: Schedule[];
  certain: number;
}

/**
 * This function makes demand schedules for `agreeSchedule`, and it watches each answer. Each node that gives `#CYCLE!`
 * is on a static cycle of `cycles`, unless a literal holds a reference to a node (S1d). The schedule agrees with the
 * evaluation from scratch, thus its answer is also the answer from scratch.
 */
function watched(config: Config, watch: Watch, order: ScheduleOptions = {}): ScheduleEngineFactory {
  return (machine, start) => {
    const s = schedule(machine, { ...start, ...order });
    watch.schedules.push(s);
    return {
      set: (id, doc) => s.set(id, doc),
      remove: (id) => s.remove(id),
      changeData: (next) => s.changeData(next),
      changeMachine: (next) => s.changeMachine(next),
      read(id) {
        const got = s.read(id);
        if (sameResult(got, cycle(id))) {
          const found = cycles(s.graph());
          if (found.some((each) => each.certain && each.nodes.includes(id))) watch.certain += 1;
          if (!config.inData && !found.some((each) => each.nodes.includes(id))) {
            watch.missed.push(`${config.name} node ${id}: no static cycle\n  docs ${show([...s.graph()].map(([key, info]) => [key, info.doc]))}`);
          }
        }
        return got;
      },
    };
  };
}

/** This function gives a short text of a disagreement for the message of a failed test. */
function told(outcome: ScheduleAgreement): readonly string[] {
  if (outcome.ok) return [];
  return [`seed ${outcome.seed} step ${outcome.step} node ${outcome.node}: ${show(outcome.engine)} and from scratch ${show(outcome.scratch)}\n  docs ${show([...outcome.docs])}`];
}

/** This function gives the sum of the work of the watched schedules. */
function work(watch: Watch): Readonly<Record<string, number>> {
  const sum = { evaluations: 0, verifications: 0, reuses: 0, ahead: 0, certain: watch.certain };
  for (const s of watch.schedules) {
    const counts = s.counts;
    sum.evaluations += counts.evaluations;
    sum.verifications += counts.verifications;
    sum.reuses += counts.reuses;
    sum.ahead += counts.ahead;
  }
  return sum;
}

const newWatch = (): Watch => ({ missed: [], schedules: [], certain: 0 });

/**
 * This function makes a mutant host for `agreeSchedule`. The host breaks the promise of DURABLE.REUSE: it changes the
 * names of its first context in place, and it does not tell the schedule.
 */
const inPlace: ScheduleEngineFactory = (machine, start) => {
  const s = schedule(machine, start);
  const names = start.context.names as Record<string, unknown>;
  return {
    set: (id, doc) => s.set(id, doc),
    remove: (id) => s.remove(id),
    changeData(next) {
      for (const key of Object.keys(names)) delete names[key];
      Object.assign(names, next.names);
    },
    changeMachine: (next) => s.changeMachine(next),
    read: (id) => s.read(id),
  };
};

describe("one meaning across schedules", () => {
  it("[SCHED.ONE-MEANING] after random changes the demand schedule gives each node the result of an evaluation from scratch, also for each cycle and in each order", () => {
    for (const config of CONFIGS) {
      const watch = newWatch();
      const outcome = agreeSchedule(watched(config, watch), { ...config.options, count: COUNT, steps: STEPS, equal });
      expect(told(outcome), config.name).toEqual([]);
      expect(watch.missed.slice(0, 3), config.name).toEqual([]);
      const counts: Readonly<Record<string, number>> = { ...(outcome.counts as unknown as Record<string, number>), ...work(watch) };
      // The harness reaches each command and each answer of the schedule, and the demands ahead of a node (S2a).
      for (const name of ["data", "empty", "edits", "removes", "additions", "same", "machines", "verifications", "reuses", "cycles", "ahead"]) {
        expect(counts[name] ?? 0, `${config.name}: ${name} in ${show(counts)}`).toBeGreaterThan(COUNT / 4);
      }
      expect(counts["compared"] ?? 0, config.name).toBeGreaterThan(COUNT * 10);
      expect(counts["values"] ?? 0, config.name).toBeGreaterThan(COUNT * 3);
      if (config.runs) expect(counts["runs"] ?? 0, config.name).toBeGreaterThan(COUNT / 2);
    }
    // A host that changes its data in place gets stale values, and the harness finds them.
    const first = CONFIGS[0] as Config;
    expect(agreeSchedule(inPlace, { ...first.options, count: COUNT / 2, equal }).ok).toBe(false);
  }, 120_000);

  it("[SCHED.AGREES] agreeSchedule examines each schedule order of the kernel against an evaluation from scratch, and it finds a wrong engine", () => {
    // The demand schedule with verifying traces: the function schedule itself is a factory of engines.
    // The demand schedule with a memo only: each read is volatile, thus a node with a read does not verify (DURABLE.DATA).
    const orders: readonly (readonly [string, ScheduleOptions])[] = [
      ["verifying traces", {}],
      ["a memo only", { volatile: () => true }],
    ];
    for (const config of CONFIGS) {
      const reuses: number[] = [];
      for (const [name, order] of orders) {
        const watch = newWatch();
        const outcome = agreeSchedule(watched(config, watch, order), { ...config.options, count: COUNT / 4, equal });
        expect(told(outcome), `${name}, ${config.name}`).toEqual([]);
        expect(outcome.counts.compared, `${name}, ${config.name}`).toBeGreaterThan(COUNT * 2);
        reuses.push(work(watch)["reuses"] ?? 0);
      }
      // The same seed gives each order the same commands. The order with verifying traces keeps more old results.
      expect(reuses[0] ?? 0, config.name).toBeGreaterThan(reuses[1] ?? 0);
    }
    expect(agreeSchedule(schedule, { count: 10 })).toMatchObject({ ok: true });

    // A wrong engine that keeps the first answer of each node gets a stale answer, and the harness names it.
    const keeps: ScheduleEngineFactory = (machine, start) => {
      const s = schedule(machine, start);
      const answers = new Map<string, Result>();
      return {
        set: (id, doc) => s.set(id, doc),
        remove: (id) => s.remove(id),
        changeData: (next) => s.changeData(next),
        read(id) {
          const known = answers.get(id) ?? s.read(id);
          answers.set(id, known);
          return known;
        },
      };
    };
    const stale = agreeSchedule(keeps, { count: 20 });
    if (stale.ok) throw new Error("The harness did not find the stale engine.");
    expect(sameResult(stale.engine, stale.scratch)).toBe(false);
    expect(stale.docs.has(stale.node)).toBe(true);
    expect(stale.step).toBeLessThan(STEPS);
    expect(stale.reason).toContain(`the node ${stale.node}`);
    // The same seed gives the same commands, thus the disagreement occurs again.
    expect(agreeSchedule(keeps, { count: 20 })).toMatchObject({ ok: false, seed: stale.seed, step: stale.step, node: stale.node });

    // A wrong engine that keeps the first document of each node misses an edit.
    const noEdits: ScheduleEngineFactory = (machine, start) => {
      const s = schedule(machine, start);
      return {
        set: (id, doc) => (s.graph().has(id) ? undefined : s.set(id, doc)),
        remove: (id) => s.remove(id),
        changeData: (next) => s.changeData(next),
        read: (id) => s.read(id),
      };
    };
    expect(agreeSchedule(noEdits, { count: 20 }).ok).toBe(false);

    // An engine without changeMachine gets no new machine, and it still agrees.
    const one: ScheduleEngineFactory = (machine, start) => {
      const s = schedule(machine, start);
      return { set: (id, doc) => s.set(id, doc), remove: (id) => s.remove(id), changeData: (next) => s.changeData(next), read: (id) => s.read(id) };
    };
    const outcome = agreeSchedule(one, { count: 10 });
    expect(outcome).toMatchObject({ ok: true, counts: { machines: 0 } });
  }, 120_000);
});
