import { describe, expect, it } from "vitest";
import {
  type AgreeScheduleOptions,
  type Context,
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
  checkCycles,
  context,
  cycles,
  edgesOf,
  factsOf,
  fail,
  formulaMachine,
  isClosure,
  isHostThing,
  jsTruthy,
  necessary,
  ok,
  random,
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

  it("[SCHED.EDGES] a node whose equation reads another node has a lazy edge to it, and a change of that node evaluates only the two nodes again", () => {
    // Before K166, factsOf gave no read of an equation, thus the node t had no edge.
    const machine = treeMachine({ seen: { type: "add", value: [ref("world", "a"), 1] } });
    const s = schedule(machine, { context: context({ names: { x: 1, y: 1 } }) });
    s.set("a", ref("names", "x"));
    s.set("b", ref("names", "y"));
    s.set("t", { type: "watch", value: { got: ref("self", "seen") } });
    s.set("u", { type: "add", value: [ref("world", "b"), 1] });
    expect(s.graph().get("t")?.edges.map((edge) => [edge.to, edge.field, edge.lazy])).toEqual([["a", [], true]]);
    expect(cycles(s.graph())).toEqual([]);
    expect([s.read("t"), s.read("u")]).toEqual([ok({ got: 2 }), ok(2)]);
    // A change of the node a evaluates a and t again. The nodes b and u verify their reads, and they keep their results.
    let counts = s.counts;
    s.changeData(context({ names: { x: 5, y: 1 } }));
    expect([s.read("t"), s.read("u")]).toEqual([ok({ got: 6 }), ok(2)]);
    expect(s.counts.evaluations - counts.evaluations).toBe(2);
    expect(s.counts.reuses - counts.reuses).toBe(2);
    // A change of the node b evaluates b and u again, and t keeps its result.
    counts = s.counts;
    s.changeData(context({ names: { x: 5, y: 3 } }));
    expect([s.read("t"), s.read("u")]).toEqual([ok({ got: 6 }), ok(4)]);
    expect(s.counts.evaluations - counts.evaluations).toBe(2);
    expect(s.counts.reuses - counts.reuses).toBe(2);
    // An equation that reads its own node makes a static cycle. The lazy edge makes it a cycle that is not certain.
    s.set("v", { type: "watch", value: { got: ref("self", "seen") } });
    s.set("a", ref("world", "v"));
    expect(cycles(s.graph())).toEqual([{ nodes: ["a", "v"], certain: false }]);
    expect(s.read("v")).toEqual(cycle("v"));
  });

  it("[SCHED.EQUATION] agreeSchedule finds no stale answer for nodes of tree kinds whose generated equations read other nodes", () => {
    const nodes = ["p", "q", "r", "s", "t"];
    const term = (rng: Random, depth: number): Json => {
      const roll = rng.int(depth > 0 ? 9 : 6);
      if (roll === 0) return rng.pick([0, 1, 2]);
      if (roll < 3) return ref("world", rng.pick(nodes));
      if (roll === 3) return ref("names", rng.pick(["a", "n"]));
      if (roll === 4) return ref("self", "width");
      if (roll === 5) return ref("world", rng.pick(nodes), "got");
      if (roll < 8) return { type: "add", value: [term(rng, depth - 1), term(rng, depth - 1)] };
      return { type: "if", value: { test: term(rng, depth - 1), then: term(rng, depth - 1), else: term(rng, depth - 1) } };
    };
    // Each machine has other equations. The command of a new machine takes the next one.
    const machines = [11, 12, 13].map((seed) => {
      const rng = random(seed);
      return treeMachine({ seen: term(rng, 2), twice: { type: "add", value: [term(rng, 1), ref("self", "seen")] } });
    });
    const wire = (rng: Random, node: () => Json): unknown => ({ type: "watch", value: { width: rng.chance(0.5) ? node() : 1, got: ref("self", rng.pick(["seen", "twice"])) } });
    const outcome = agreeSchedule(schedule, { machines, wire, wired: 0.6, count: COUNT / 2, steps: STEPS, equal });
    expect(told(outcome)).toEqual([]);
    expect(outcome.counts.compared).toBeGreaterThan(COUNT * 2);
    expect(outcome.counts.values).toBeGreaterThan(COUNT / 2);
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

  it("[SCHED.LONG-CHAIN] a demand of the host first demands the nodes that the eager edges reach, deepest first, thus a chain of 2000 nodes gives its value with no #DEPTH!, and the same chain through lazy edges overflows", async () => {
    // A demand through lazy edges uses the stack of the host for each node. In a one-off measurement on Node.js 24, such
    // a chain gave #DEPTH! from 600 to 800 nodes, and S2a found approximately 1000 nodes. The chain has 2000 nodes:
    // twice the depth of the overflow, with no work beyond it (K207, D96). Before, it had 100000 nodes and took 2.7 s.
    const LENGTH = 2000;
    // The lazy chain shows the overflow on this host. If it gives its value, the chain is too short for the claim.
    // The error is #DEPTH!, or #CYCLE! when the overflow comes between two steps of the walk of the demand.
    const lazy = schedule(strictMachine, { ...LIT, context: context({ names: { x: 7, flag: true } }) });
    for (let index = 0; index < LENGTH; index += 1) lazy.set(`n${index}`, index === LENGTH - 1 ? ref("names", "x") : { type: "if", value: { test: ref("names", "flag"), then: ref("world", `n${index + 1}`), else: 0 } });
    expect(lazy.read("n0").ok, "a chain of lazy edges of this length overflows the stack of the host").toBe(false);
    expect(lazy.counts.ahead).toBe(0);
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

/** This function gives the reason of the `#CYCLE!` of a node. */
const reasonOf = (id: string): string => `The node ${id} is on a cycle of reads.`;

/** This function makes a schedule with the documents, in the order of the record. */
function nodes(docs: Readonly<Record<string, Json>>, options: ScheduleOptions = LIT): Schedule {
  const s = schedule(strictMachine, options);
  for (const id of Object.keys(docs)) s.set(id, docs[id]);
  return s;
}

/**
 * This function gives a generated graph. Only a read of a cycle can fail, thus each failed node shows a cycle. With
 * `lazy`, some nodes read under an `if`, and the graph can have possible cycles.
 */
function cycleFamily(rng: Random, lazy: boolean): Readonly<Record<string, Json>> {
  const names = NODES.slice(0, 2 + rng.int(NODES.length - 1));
  const node = (): Json => ref("world", rng.pick(names));
  const docs: Record<string, Json> = {};
  for (const id of names) {
    const roll = rng.int(lazy ? 5 : 4);
    if (roll === 0) docs[id] = rng.int(9);
    else if (roll === 1) docs[id] = node();
    else if (roll === 4) docs[id] = { type: "if", value: { test: ref("names", "flag"), then: node(), else: 1 } };
    else docs[id] = op("pair", node(), node());
  }
  return docs;
}

/**
 * This function makes schedules for `agreeSchedule`, and it examines each answer against `checkCycles`. A node of a
 * certain cycle gives no value, for each kind of document that the harness generates.
 */
function issueChecked(found: string[], counts: { certain: number }): ScheduleEngineFactory {
  return (machine, start) => {
    const s = schedule(machine, start);
    return {
      set: (id, doc) => s.set(id, doc),
      remove: (id) => s.remove(id),
      changeData: (next) => s.changeData(next),
      changeMachine: (next) => s.changeMachine(next),
      read(id) {
        const got = s.read(id);
        if (checkCycles(s).some((issue) => issue.nodes.includes(id))) {
          counts.certain += 1;
          if (got.ok) found.push(`node ${id} gives ${show(got)}\n  docs ${show([...s.graph()].map(([key, info]) => [key, info.doc]))}`);
        }
        return got;
      },
    };
  };
}

describe("the certain cycles of a schedule", () => {
  it("[SCHED.CYCLE-ISSUES] checkCycles gives one issue for each certain cycle before a run, with no evaluation, and a read gives the same #CYCLE!", async () => {
    expect(checkCycles(schedule(strictMachine, LIT))).toEqual([]);
    expect(checkCycles(nodes({ p: ref("world", "q"), q: 1 }))).toEqual([]);

    const s = nodes({
      a: op("add", ref("world", "b"), 1),
      b: op("add", ref("world", "a"), 1),
      self: op("add", ref("world", "self"), 1),
      free: op("add", ref("world", "a"), 1),
      plain: 1,
    });
    const issues = checkCycles(s);
    expect(issues).toEqual([
      { code: "#CYCLE!", place: ["a"], reason: reasonOf("a"), nodes: ["a", "b"] },
      { code: "#CYCLE!", place: ["self"], reason: reasonOf("self"), nodes: ["self"] },
    ]);
    // The answer needs no evaluation, thus the host has it before a run.
    expect(s.counts).toMatchObject({ evaluations: 0, ahead: 0 });
    expect(checkCycles(s)).toEqual(issues);

    // Each node of a ring gives its #CYCLE! in a read. The first node gives the reason of the issue.
    for (const issue of issues) {
      expect(s.read(issue.nodes[0] as string)).toEqual(fail(issue.code, issue.reason));
      for (const id of issue.nodes) expect(s.read(id), id).toEqual(cycle(id));
    }
    expect(await s.run("a")).toMatchObject({ ok: false, error: { code: "#CYCLE!" } });
    // A reader of a cycle is not on the cycle: it gets the error at its reference, and it has no issue.
    expect(s.read("free")).toEqual(fail("#CYCLE!", reasonOf("a"), { place: [0] }));
    expect(s.read("plain")).toEqual(ok(1));

    // A change of the structure changes the answer.
    s.set("b", 2);
    expect(checkCycles(s).map((issue) => issue.place)).toEqual([["self"]]);
    s.remove("self");
    expect(checkCycles(s)).toEqual([]);
    expect(s.read("a")).toEqual(ok(3));

    // The argument is a graph, thus a ring of 100000 nodes needs no schedule, and it does not overflow.
    const size = 100_000;
    const ring = new Map(Array.from({ length: size }, (_, index) => [`n${index}`, { edges: [{ to: `n${(index + 1) % size}`, lazy: false }] }]));
    const large = checkCycles({ graph: () => ring });
    expect(large.map((issue) => [issue.place, issue.nodes.length])).toEqual([[["n0"], size]]);
    // A sink has no cycle: an edge to a node on the run side is no edge of the analysis.
    const sink = new Map([["act", { side: "run" as const, edges: [{ to: "act", lazy: false }] }]]);
    expect(checkCycles({ graph: () => sink })).toEqual([]);
  });

  it("[SCHED.CYCLE-CERTAIN] a possible cycle gives no issue, a certain cycle inside it gives one, and a failure before the read still gives no value", () => {
    // A cycle under an if is possible. The run can skip the read.
    const flagged = nodes(
      { p: { type: "if", value: { test: ref("names", "flag"), then: ref("world", "q"), else: 1 } }, q: op("add", ref("world", "p"), 1) },
      { ...LIT, context: context({ names: { flag: false } }) },
    );
    expect(cycles(flagged.graph())).toEqual([{ nodes: ["p", "q"], certain: false }]);
    expect(checkCycles(flagged)).toEqual([]);
    expect(flagged.read("q")).toEqual(ok(2));
    // The issues are not complete: the run can take the lazy read, and it then gives #CYCLE! without an issue.
    flagged.changeData(context({ names: { flag: true } }));
    expect(checkCycles(flagged)).toEqual([]);
    expect(flagged.read("q")).toEqual(cycle("q"));

    // A lazy edge that the certain cycle does not need: only the nodes of the eager edges are in the issue.
    const inside = nodes({
      x: op("add", ref("world", "y"), 1),
      y: op("add", ref("world", "x"), op("ifError", ref("world", "z"), 0)),
      z: op("add", ref("world", "x"), 1),
    });
    expect(cycles(inside.graph()).map((found) => [found.nodes, found.certain])).toEqual([
      [["x", "y", "z"], false],
      [["x", "y"], true],
    ]);
    expect(checkCycles(inside)).toEqual([{ code: "#CYCLE!", place: ["x"], reason: reasonOf("x"), nodes: ["x", "y"] }]);

    // A lazy read of the own node, an edge without a target and the closure of a function give no issue.
    expect(checkCycles(nodes({ lazy: op("ifError", ref("world", "lazy"), 0) }))).toEqual([]);
    expect(checkCycles(nodes({ all: ref("world") }))).toEqual([]);
    const closure = nodes({ f: { type: "fn", value: { params: ["v"], body: op("add", ref("names", "v"), ref("world", "f")) } } });
    expect(checkCycles(closure)).toEqual([]);
    expect(closure.read("f").ok).toBe(true);

    // A read can fail before it reaches the cycle (D33). The issue stays, and the node gives no value.
    const early = nodes({ a: ref("world", "b"), b: op("pair", ref("world", "gone"), ref("world", "a")) });
    expect(checkCycles(early).map((issue) => issue.nodes)).toEqual([["a", "b"]]);
    for (const id of ["a", "b"]) expect(early.read(id), id).toMatchObject({ ok: false, error: { code: "#N/A" } });
  });

  it("[SCHED.CYCLE-ORDER] the order of the set calls does not change the issues: each node list is sorted, and the issues are sorted by their first nodes", () => {
    const docs: Readonly<Record<string, Json>> = {
      z: op("add", ref("world", "y"), 1),
      y: op("add", ref("world", "z"), 1),
      m: op("add", ref("world", "c"), 1),
      c: op("add", ref("world", "k"), 1),
      k: op("add", ref("world", "m"), 1),
      // The cycle of b reads the cycle of y and z, thus `cycles` gives the deep cycle first. The sort gives the name first.
      b: op("pair", ref("world", "b"), ref("world", "z")),
    };
    const want = [
      { code: "#CYCLE!", place: ["b"], reason: reasonOf("b"), nodes: ["b"] },
      { code: "#CYCLE!", place: ["c"], reason: reasonOf("c"), nodes: ["c", "k", "m"] },
      { code: "#CYCLE!", place: ["y"], reason: reasonOf("y"), nodes: ["y", "z"] },
    ];
    const ids = Object.keys(docs);
    for (const order of [ids, [...ids].reverse(), [...ids].sort(), ["k", "b", "y", "m", "z", "c"]]) {
      const s = schedule(strictMachine, LIT);
      for (const id of order) s.set(id, docs[id]);
      expect(checkCycles(s), order.join(" ")).toEqual(want);
    }
    // A node that a host removes and sets again goes to the end of the graph, and the answer stays.
    const s = nodes(docs);
    s.remove("c");
    s.set("c", docs["c"]);
    expect(checkCycles(s)).toEqual(want);
    // The answer of `cycles` keeps the order of the graph: the sort is the work of `checkCycles`.
    expect(cycles(s.graph()).map((found) => found.nodes[0])).not.toEqual(want.map((issue) => issue.nodes[0]));
  });

  it("[SCHED.CYCLE-AGREES] for generated graphs the issues agree with the demand: each node of an issue gives no value, and a #CYCLE! with no lazy read has an issue", () => {
    const counts = { issues: 0, exact: 0, alone: 0, possible: 0 };
    for (let seed = 1; seed <= COUNT * 2; seed += 1) {
      const rng = random(seed);
      const lazy = seed % 2 === 0;
      const docs = cycleFamily(rng, lazy);
      const s = nodes(docs, { ...LIT, context: context({ names: { flag: rng.chance(0.5) } }) });
      const issues = checkCycles(s);
      const listed = new Set(issues.flatMap((issue) => issue.nodes));
      const reasons = new Set([...listed].map(reasonOf));
      const label = `seed ${seed} ${show(docs)}`;
      expect(s.counts.evaluations, label).toBe(0);
      counts.issues += issues.length;
      if (cycles(s.graph()).some((found) => !found.certain)) counts.possible += 1;
      for (const id of Object.keys(docs)) {
        const got = s.read(id);
        if (listed.has(id)) expect(got, `${label} node ${id}`).toMatchObject({ ok: false, error: { code: "#CYCLE!" } });
        if (sameResult(got, cycle(id))) counts.exact += 1;
        if (lazy) continue;
        // With only eager reads, each read of a demand is an edge of `checkCycles`.
        if (!got.ok) expect(reasons.has(got.error.reason), `${label} node ${id}`).toBe(true);
        if (sameResult(got, cycle(id))) expect(listed.has(id), `${label} node ${id}`).toBe(true);
      }
      if (lazy) continue;
      // An issue that reaches no other issue has only its own failures: each reason names a node of that issue.
      for (const issue of issues) {
        const reached = necessary(s.graph(), issue.nodes, { eager: true });
        if (issues.some((other) => other !== issue && other.nodes.some((id) => reached.has(id)))) continue;
        counts.alone += 1;
        const own = new Set(issue.nodes.map(reasonOf));
        for (const id of issue.nodes) {
          const got = s.read(id);
          expect(!got.ok && own.has(got.error.reason), `${label} node ${id}`).toBe(true);
        }
      }
    }
    for (const [name, value] of Object.entries(counts)) expect(value, `${name} in ${show(counts)}`).toBeGreaterThan(COUNT / 4);

    // Each configuration of the harness: other kinds of documents, edits, removed nodes, new machines and failed reads.
    for (const config of CONFIGS) {
      const found: string[] = [];
      const seen = { certain: 0 };
      const outcome = agreeSchedule(issueChecked(found, seen), { ...config.options, count: COUNT, steps: STEPS, equal });
      expect(told(outcome), config.name).toEqual([]);
      expect(found.slice(0, 3), config.name).toEqual([]);
      expect(seen.certain, config.name).toBeGreaterThan(COUNT / 4);
    }
/* A context for each node (S1f, D135): `selfOf` gives a node its own `self`, and nodes with one document share one plan. */

/** The cells of a column: each cell reads the cell above it through a reference in its `self`. */
const column = (length: number): ReadonlyMap<string, Json> => new Map(Array.from({ length }, (_, index): [string, Json] => [`r${index}`, { above: index === 0 ? 0 : ref("world", `r${index - 1}`) }]));

/** This function gives the option `selfOf` of a host with a table of cells. */
const cellsOf = (cells: Readonly<Record<string, Json>>): ((id: string) => Json | undefined) => (id) => cells[id];

describe("a context for each node", () => {
  it("[SCHED.NODE-CONTEXT] selfOf gives each node its own self for its evaluation and its run, another root stays the root of the host, and undefined keeps the self of the host", async () => {
    const cells: Readonly<Record<string, Json>> = { a: { x: 1 }, b: { x: 2 } };
    const formula: Json = op("add", ref("self", "x"), ref("names", "k"));
    const asked: unknown[] = [];
    const s = schedule(strictMachine, {
      ...LIT,
      context: context({ names: { k: 10 }, self: { x: 100 } }),
      selfOf(id, host) {
        asked.push(host.names["k"]);
        return cells[id];
      },
    });
    for (const id of ["a", "b", "c"]) s.set(id, formula);
    s.set("sum", op("add", ref("world", "a"), ref("world", "b")));
    expect(["a", "b", "c", "sum"].map((id) => s.read(id))).toEqual([ok(11), ok(12), ok(110), ok(23)]);
    // The function gets the context of the host, one time for each node in a data epoch, and the context of the epoch keeps the self of the host.
    expect(asked).toEqual([10, 10, 10, 10]);
    expect(s.context.self).toEqual({ x: 100 });
    // A closure keeps the self of its node, also in the evaluation of a reader. A reader with another self gets the value of the closure.
    const closures = schedule(strictMachine, { ...LIT, selfOf: cellsOf({ f: { x: 1 }, g: { x: 2 } }) });
    closures.set("f", { type: "fn", value: { params: ["v"], body: ref("self", "x") } });
    closures.set("g", op("apply", ref("world", "f"), 0));
    expect(closures.read("g")).toEqual(ok(1));
    // A reference in the value of a node resolves in the context of its reader (DEREF.COLLAPSE).
    const held = schedule(strictMachine, { ...LIT, selfOf: cellsOf({ data: { x: "mine" }, reader: { x: "yours" } }) });
    held.set("data", { type: "lit", value: { v: ref("self", "x") } });
    held.set("reader", ref("world", "data", "v"));
    expect(held.read("reader")).toEqual(ok("yours"));
    // A run gets the self of its node and the event of the host. A demand of a node on the run side still gives #REF!.
    const payloads: unknown[] = [];
    const log: Json = { type: "log", value: [ref("self", "x"), ref("event", "e")] };
    const runs = schedule(STD_MACHINE, { context: context({ caps: ["log"], event: { e: 0 } }), selfOf: cellsOf(cells) });
    runs.set("a", log);
    runs.set("b", log);
    const perform = (effect: Effect): unknown => payloads.push(effect.payload);
    await runs.run("a", { perform });
    await runs.run("b", { perform, event: { e: 1 } });
    expect(payloads).toEqual([[1, 0], [2, 1]]);
    expect(runs.read("a")).toEqual(refused("a"));
    // A node of a tree reaches the self of its node through its parent, and one tree document gives each node its own answer.
    const tree = schedule(treeMachine({ seen: ref("self", "parent", "x") }), { selfOf: cellsOf(cells) });
    const watch: Json = { type: "watch", value: { got: ref("self", "seen") } };
    tree.set("a", watch);
    tree.set("b", watch);
    expect([tree.read("a"), tree.read("b")]).toEqual([ok({ got: 1 }), ok({ got: 2 })]);
    expect(tree.counts).toMatchObject({ compiles: 1, evaluations: 2 });
    // An exception of the function reaches the host, and it leaves the node without a result.
    let broken = true;
    const throws = schedule(strictMachine, {
      ...LIT,
      selfOf() {
        if (broken) throw new Error("no cell");
        return { x: 1 };
      },
    });
    throws.set("a", ref("self", "x"));
    expect(() => throws.read("a")).toThrow("no cell");
    broken = false;
    expect(throws.read("a")).toEqual(ok(1));
  });

  it("[SCHED.NODE-PLAN] nodes with one document object share one plan, one facts object and one list of edges, and each node keeps its own result", () => {
    const LENGTH = 1000;
    const formula: Json = op("add", ref("self", "x"), ref("world", "base"));
    const s = schedule(strictMachine, { ...LIT, selfOf: (id) => ({ x: Number(id.slice(1)) }) });
    s.set("base", 1);
    for (let index = 0; index < LENGTH; index += 1) s.set(`c${index}`, formula);
    for (let index = 0; index < LENGTH; index += 1) expect(s.read(`c${index}`)).toEqual(ok(index + 1));
    // The base and one formula compile, with one facts object each, and each cell evaluates.
    expect(s.counts).toMatchObject({ compiles: 2, facts: 2, evaluations: LENGTH + 1 });
    const graph = s.graph();
    expect(graph.get("c7")?.facts).toBe(graph.get("c8")?.facts);
    expect(graph.get("c7")?.edges).toBe(graph.get("c8")?.edges);
    expect(graph.get("c7")?.edges.map((edge) => edge.to)).toEqual(["base"]);
    // A change of data compiles nothing, and an edit of one cell compiles only that document.
    s.changeData();
    expect(s.read("c7")).toEqual(ok(8));
    expect(s.counts.compiles).toBe(2);
    s.set("c7", ref("self", "x"));
    expect(s.read("c7")).toEqual(ok(7));
    expect(s.read("c8")).toEqual(ok(9));
    expect(s.counts).toMatchObject({ compiles: 3, facts: 3 });
    // The measure: equal documents in new objects compile one time for each node (PLAN.CACHE).
    const copies = schedule(strictMachine, { ...LIT, selfOf: (id) => ({ x: Number(id.slice(1)) }) });
    copies.set("base", 1);
    for (let index = 0; index < 100; index += 1) copies.set(`c${index}`, op("add", ref("self", "x"), ref("world", "base")));
    for (let index = 0; index < 100; index += 1) copies.read(`c${index}`);
    expect(copies.counts).toMatchObject({ compiles: 101, facts: 101 });
    // A new machine compiles the shared document one time.
    const next = s.counts;
    s.changeMachine(looseMachine);
    expect(s.read("c8")).toEqual(ok(9));
    expect(s.read("c9")).toEqual(ok(10));
    expect(s.counts.compiles - next.compiles).toBe(2);
  });

  it("[SCHED.NODE-STALE] a new self is a change of data: each node verifies its reads with its new self, and only a node with a changed read evaluates again", () => {
    let cells: Readonly<Record<string, Json>> = { a: { x: 1, y: 1 }, b: { x: 2, y: 1 } };
    const formula: Json = ref("self", "x");
    const whole: Json = ref("self");
    const s = schedule(strictMachine, { ...LIT, context: context({ names: { n: 1 } }), selfOf: (id) => cells[id.slice(0, 1)] });
    for (const id of ["a", "b"]) s.set(id, formula);
    s.set("a2", whole);
    s.set("free", ref("names", "n"));
    s.set("sum", op("add", ref("world", "a"), ref("world", "b")));
    const ids = ["a", "b", "a2", "free", "sum"];
    const read = (): readonly Result[] => ids.map((id) => s.read(id));
    expect(read()).toEqual([ok(1), ok(2), ok({ x: 1, y: 1 }), ok(1), ok(3)]);
    expect(s.counts).toMatchObject({ evaluations: 5, compiles: 4 });
    // Without a change of data the schedule keeps each value: a host tells each change.
    cells = { a: { x: 5, y: 1 }, b: { x: 2, y: 1 } };
    expect(s.read("a")).toEqual(ok(1));
    // A new x of one cell evaluates that cell, the reader of its whole self and the sum. The other cell and the free node verify.
    let counts = s.counts;
    s.changeData();
    expect(read()).toEqual([ok(5), ok(2), ok({ x: 5, y: 1 }), ok(1), ok(7)]);
    expect(s.counts.evaluations - counts.evaluations).toBe(3);
    expect(s.counts.compiles - counts.compiles).toBe(0);
    expect(s.counts.reuses - counts.reuses).toBe(2);
    // A new self object with the same data changes no read: each node verifies and keeps its result.
    counts = s.counts;
    cells = { a: { x: 5, y: 1 }, b: { x: 2, y: 1 } };
    s.changeData();
    expect(read()).toEqual([ok(5), ok(2), ok({ x: 5, y: 1 }), ok(1), ok(7)]);
    expect(s.counts.evaluations - counts.evaluations).toBe(0);
    // A new field that a formula does not read keeps its node, and the reader of the whole self evaluates again.
    counts = s.counts;
    cells = { a: { x: 5, y: 2 }, b: { x: 2, y: 1 } };
    s.changeData();
    expect(read()).toEqual([ok(5), ok(2), ok({ x: 5, y: 2 }), ok(1), ok(7)]);
    expect(s.counts.evaluations - counts.evaluations).toBe(1);
    // The new context of the host reaches the function, and the same function reads it.
    const hosted = schedule(strictMachine, { ...LIT, context: context({ names: { rows: { a: { x: 1 } } } }), selfOf: (id, host) => (host.names["rows"] as Readonly<Record<string, unknown>>)[id] });
    hosted.set("a", formula);
    expect(hosted.read("a")).toEqual(ok(1));
    hosted.changeData(context({ names: { rows: { a: { x: 2 } } } }));
    expect(hosted.read("a")).toEqual(ok(2));
    // An extension reads the context outside resolve, thus its node evaluates again, with its own self.
    const here: Json = { type: ["ext", "here"], value: null };
    const ext = schedule(strictMachine, { ...LIT, selfOf: (id) => (id === "a" ? { x: 1 } : undefined) });
    ext.set("a", here);
    ext.set("b", here);
    expect([ext.read("a"), ext.read("b")]).toEqual([ok("self"), ok("none")]);
  });

  it("[SCHED.NODE-CYCLE] a reference in a self gives one formula a read of another cell, the demand gives #CYCLE! for each node of a cycle, and the static graph does not show such a read", () => {
    const up: Json = op("add", ref("self", "above"), 1);
    const selves: Readonly<Record<string, Json>> = { a: { above: ref("world", "b") }, b: { above: ref("world", "a") }, c: { above: ref("world", "d") }, d: { above: 0 } };
    for (const order of [["a", "b", "c", "d"], ["d", "c", "b", "a"], ["b", "d", "a", "c"]]) {
      const s = schedule(strictMachine, { ...LIT, selfOf: cellsOf(selves) });
      for (const id of Object.keys(selves)) s.set(id, up);
      const want: Readonly<Record<string, Result>> = { a: cycle("a"), b: cycle("b"), c: ok(2), d: ok(1) };
      for (const id of order) expect(s.read(id), `${id} in the order ${order.join(" ")}`).toEqual(want[id]);
      // The facts and the edges belong to the document, thus the static graph has no edge and no cycle here.
      expect(cycles(s.graph())).toEqual([]);
      expect(s.graph().get("a")?.edges).toEqual([]);
      expect(s.counts).toMatchObject({ compiles: 1, ahead: 0 });
      s.changeData();
      for (const id of [...order].reverse()) expect(s.read(id), `${id} after a change of data`).toEqual(want[id]);
      expect(s.counts.compiles).toBe(1);
    }
    // No edge shows the read of the cell above, thus a demand of the deep end of a long column uses the stack of the host for each cell.
    const LENGTH = 2000;
    const cells = column(LENGTH);
    const long = schedule(strictMachine, { ...LIT, selfOf: (id) => cells.get(id) });
    for (const id of cells.keys()) long.set(id, up);
    expect(long.read(`r${LENGTH - 1}`).ok, "a column of this length overflows the stack of the host").toBe(false);
    expect(long.counts.ahead).toBe(0);
    // A host demands the cells in the order of the rows, thus each read finds a value, also after a change of data.
    long.changeData();
    for (const id of cells.keys()) long.read(id);
    expect(long.read(`r${LENGTH - 1}`)).toEqual(ok(LENGTH));
    long.changeData();
    for (const id of cells.keys()) long.read(id);
    expect(long.read(`r${LENGTH - 1}`)).toEqual(ok(LENGTH));
    expect(long.counts.compiles).toBe(1);
    // A limit of D135: a closure keeps each whole root, thus a self that is a reference to its own node closes a cycle. The self of the host gives the same answer.
    const closure: Json = { type: "fn", value: { params: [], body: ref("self", "x") } };
    for (const options of [{ selfOf: () => ref("world", "f") }, { context: context({ self: ref("world", "f") }) }]) {
      const own = schedule(strictMachine, { ...LIT, ...options });
      own.set("f", closure);
      expect(own.read("f")).toEqual(cycle("f"));
    }
  });

  it("[SCHED.NODE-AGREES] agreeSchedule finds no stale answer for nodes with their own self and shared documents, and it finds an engine that keeps an old self", () => {
    const wire = (rng: Random, node: () => Json): Json => {
      const own = ref("self", rng.pick(["a", "b"]));
      const roll = rng.int(6);
      if (roll === 0) return ref("self");
      if (roll === 1) return op("pair", own, op("ifError", node(), 0));
      if (roll === 2) return op("ifError", own, node());
      if (roll === 3) return { type: "fn", value: { params: ["v"], body: own } };
      if (roll === 4) return op("pair", own, ref("names", "a"));
      return op("add", own, 1);
    };
    const selves: readonly unknown[] = [undefined, undefined, null, 1, { a: 1 }, { a: 1 }, { a: 2, b: 3 }, { a: ref("world", "p") }, { a: ref("world", "q"), b: ref("self", "a") }, ref("names", "a"), new Box(1)];
    const options: AgreeScheduleOptions = {
      machines: [strictMachine, looseMachine],
      declaredType: "lit",
      generate: { declaredType: "lit", maxSize: 8, types: [...OP_TYPES, ["ref"], ["lit"]] },
      runs: false,
      value: (rng) => rng.pick<unknown>([0, 1, 2]),
      wire,
      wired: 0.7,
      selves,
      steps: STEPS,
      equal,
    };
    const outcome = agreeSchedule(schedule, { ...options, count: COUNT });
    expect(told(outcome)).toEqual([]);
    for (const name of ["selves", "shared", "cycles"] as const) expect(outcome.counts[name], name).toBeGreaterThan(COUNT / 2);
    expect(outcome.counts.compared).toBeGreaterThan(COUNT * 10);
    expect(outcome.counts.values).toBeGreaterThan(COUNT * 3);
    // The schedule keeps old results for a change of a self that no node of a demand reads.
    const engines: Schedule[] = [];
    const counted: ScheduleEngineFactory = (machine, start) => {
      const s = schedule(machine, start);
      engines.push(s);
      return s;
    };
    agreeSchedule(counted, { ...options, count: COUNT / 4 });
    expect(engines.reduce((sum, s) => sum + s.counts.reuses, 0)).toBeGreaterThan(COUNT / 4);
    // An engine that ignores selfOf gives the self of the host to each node, and the harness finds it.
    const ignores: ScheduleEngineFactory = (machine, start) => schedule(machine, { ...LIT, context: start.context });
    expect(agreeSchedule(ignores, { ...options, count: 20 }).ok).toBe(false);
    // An engine that keeps the first self of each node misses a change, and the harness finds it.
    const keeps: ScheduleEngineFactory = (machine, start) => {
      const seen = new Map<string, unknown>();
      const first = (id: string, host: Context): unknown => {
        if (!seen.has(id)) seen.set(id, start.selfOf?.(id, host));
        return seen.get(id);
      };
      return schedule(machine, { ...start, selfOf: first });
    };
    expect(agreeSchedule(keeps, { ...options, count: 40 }).ok).toBe(false);
    // A harness without the option gives no node its own self.
    expect(agreeSchedule(schedule, { count: 5 }).counts).toMatchObject({ selves: 0, shared: 0 });
  }, 120_000);
});
