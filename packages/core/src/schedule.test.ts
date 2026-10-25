import { describe, expect, it } from "vitest";
import {
  type Context,
  type Effect,
  type FormulaProfile,
  type GenerateOptions,
  type HostThing,
  type Json,
  type Key,
  type Machine,
  type Random,
  type Result,
  Failure,
  Held,
  STD_MACHINE,
  THING,
  context,
  cycles,
  edgesOf,
  factsOf,
  fail,
  formulaMachine,
  generate,
  isClosure,
  isHostThing,
  jsTruthy,
  ok,
  prepare,
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

/* The harness for one meaning across schedules (R4 P4): an evaluation of the whole graph from scratch, and the demand schedule. */

const NODES: readonly string[] = ["p", "q", "r", "s", "t"];
const HOST: readonly string[] = ["a", "b", "x", "n"];

/** The values of the names of the host. Some are equal by structure, and some are host values. */
const VALUES: readonly unknown[] = [0, 1, 2, -0, Number.NaN, "two", null, undefined, [1, 2], { a: 1 }, { a: 2 }, ref("names", "a"), new Held({ code: "#HELD", reason: "The binding failed." })];

const BASES: readonly Context[] = [
  context({ names: { a: 1, b: [1, "two"], x: { a: 1 }, n: 2 }, caps: ["log"] }),
  context({ names: { a: "two", b: 0, x: null }, self: { a: 1 }, event: { a: 2 } }),
];

/** This function gives new names of the host, with one or two changes. */
function change(base: Context, rng: Random): Readonly<Record<string, unknown>> {
  const names: Record<string, unknown> = { ...base.names };
  for (let step = 1 + rng.int(2); step > 0; step -= 1) {
    const name = rng.pick(HOST);
    if (rng.chance(0.15)) delete names[name];
    else names[name] = rng.pick(VALUES);
  }
  return names;
}

/** This function puts a field on a record, also the field `__proto__`. */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** This function changes each path from `names` to a node into a path from `world`. Some paths read the whole root. */
function linked(value: unknown, rng: Random): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => linked(item, rng));
    if (items[0] === "names" && typeof items[1] === "string" && NODES.includes(items[1])) return rng.chance(0.03) ? ["world"] : ["world", ...items.slice(1)];
    return items;
  }
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) put(out, key, linked((value as Record<string, unknown>)[key], rng));
  return out;
}

const MORE_REFS: readonly (readonly Key[])[] = Array.from({ length: 8 }, () => ["ref"]);
const OP_TYPES: readonly (readonly Key[])[] = [...Object.keys(OPS).map((name) => ["ops", name]), ["ops", "ifError"], ["ops", "ifError"], ["ops", "second"]];

interface Config {
  readonly name: string;
  readonly machines: readonly Machine[];
  readonly declaredType?: string;
  readonly options: Omit<GenerateOptions, "seed" | "names">;
  /** `true`: some nodes are on the run side. */
  readonly runs: boolean;
  /** This function gives a small value document. */
  readonly value: (rng: Random) => unknown;
  /** This function gives a document that reads other nodes, some after a failed read. Such nodes make dense cycles. */
  readonly wire: (rng: Random) => unknown;
  /** The share of the nodes that `wire` gives. */
  readonly wired: number;
  /** `true`: a literal can hold a reference to a node (S1d). Then the static edges do not show each read of a node. */
  readonly inData: boolean;
}

const node = (rng: Random): Json => ref("world", rng.pick(NODES));

/** This function gives a formula that reads one or two nodes. Some formulas read a node after a failed read. */
function wireFormula(rng: Random): Json {
  const roll = rng.int(6);
  if (roll === 0) return op("pair", op("ifError", node(rng), 0), op("ifError", node(rng), 1));
  if (roll === 1) return op("ifError", node(rng), node(rng));
  if (roll === 2) return op("ifError", node(rng), rng.int(9));
  if (roll === 3) return op("pair", node(rng), node(rng));
  return roll === 4 ? op("add", node(rng), 1) : node(rng);
}

const CONFIGS: readonly Config[] = [
  {
    name: "formula",
    machines: [strictMachine, looseMachine],
    declaredType: "lit",
    options: {
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
    inData: true,
  },
  {
    name: "standard",
    machines: [STD_MACHINE, { ...STD_MACHINE }],
    options: {
      maxSize: 16,
      types: [...typesOf(STD_MACHINE.world).filter((type) => type[0] !== "log" && type[0] !== "write"), ...MORE_REFS, ["if"], ["add"]],
      data: (type, rng) => {
        const name = type.join(".");
        if (name === "number") return rng.chance(0.9) ? rng.pick([0, 1, 2, 3.5, -1]) : "1";
        if (name === "text") return rng.chance(0.9) ? rng.pick(["", "a", "b"]) : 1;
        if (name === "bool") return rng.chance(0.9) ? rng.chance(0.5) : 0;
        if (name === "nearest") return rng.pick<Json>([{ type: "panel" }, "panel"]);
        return undefined;
      },
    },
    runs: true,
    value: (rng) => ({ type: "number", value: rng.pick([0, 1, 2]) }),
    // A list evaluates each part, also after a failed part.
    wire: (rng) => (rng.chance(0.5) ? { type: "list", value: [node(rng), node(rng)] } : rng.chance(0.5) ? { type: "add", value: [node(rng), 1] } : node(rng)),
    wired: 0.2,
    inData: false,
  },
  {
    // A dense graph: most nodes read two nodes and catch a failed read. It makes many cycles that share nodes.
    name: "wired",
    machines: [strictMachine, looseMachine],
    declaredType: "lit",
    options: { declaredType: "lit", maxSize: 8, types: [...OP_TYPES, ["ref"], ["lit"]] },
    runs: false,
    value: (rng) => rng.pick<unknown>([0, 1, 2]),
    wire: wireFormula,
    wired: 0.85,
    inData: false,
  },
];

/**
 * This function evaluates each node of a graph from scratch, with the meaning of D31: a new plan for each node, one
 * value for each node, and the algorithm of Tarjan over the demands for the cycles. It keeps nothing between calls.
 */
function fromScratch(config: Config, machine: Machine, docs: ReadonlyMap<string, unknown>, base: Context): ReadonlyMap<string, Result> {
  const declared = config.declaredType === undefined ? {} : { declaredType: config.declaredType };
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
      return cycle(id);
    }
    if (factsOf(machine, docs.get(id), declared).side === "run") {
      values.set(id, refused(id));
      return refused(id);
    }
    index.set(id, index.size);
    lowest.set(id, index.get(id) as number);
    component.push(id);
    evaluating.push(id);
    let result = prepare(machine, docs.get(id), declared).evaluate(ctx);
    evaluating.pop();
    if ((lowest.get(id) as number) < (index.get(id) as number)) result = cycle(id);
    else if (component.splice(component.indexOf(id)).length > 1 || selfReads.has(id)) result = cycle(id);
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

function shuffle<T>(items: readonly T[], rng: Random): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = rng.int(index + 1);
    [out[index], out[other]] = [out[other] as T, out[index] as T];
  }
  return out;
}

interface Outcome {
  /** The reads whose result is not the same as the result from scratch. */
  readonly stale: readonly string[];
  /** The nodes that give `#CYCLE!` from scratch, and that no static cycle of `cycles` has (GRAPH.CYCLE). */
  readonly missed: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
}

/**
 * This function runs random commands against a demand schedule, and it compares each read with an evaluation of the
 * whole graph from scratch. A demand of the host first demands the nodes that the eager edges reach (S2a). Each node
 * that gives `#CYCLE!` from scratch is on a static cycle, unless a literal holds a reference to a node (S1d). A
 * mutant host changes its names in place, and it does not tell the schedule.
 */
function harness(config: Config, mutant = false, total: number = COUNT): Outcome {
  const stale: string[] = [];
  const missed: string[] = [];
  const counts: Record<string, number> = {};
  const add = (name: string, by = 1): void => {
    counts[name] = (counts[name] ?? 0) + by;
  };
  for (let run = 0; run < total; run += 1) {
    const seed = 9_000_011 + run;
    const rng = random(seed);
    let at = 0;
    let machine = config.machines[0] as Machine;
    let made = 0;
    const make = (): unknown => {
      if (rng.chance(config.wired)) return config.wire(rng);
      const roll = rng.int(10);
      if (roll === 0) return config.value(rng);
      // Some nodes read only the data of the host, thus the graph is not always one component.
      const names = roll < 5 ? HOST : [...HOST, ...NODES, ...NODES, ...NODES];
      const doc = linked(generate(machine.world, { ...config.options, names, seed: seed * 31 + made++ }), rng);
      return config.runs && roll === 9 ? { type: "log", value: [doc] } : doc;
    };
    const docs = new Map<string, unknown>(NODES.map((id) => [id, make()]));
    let base: Context = { ...(BASES[run % BASES.length] as Context) };
    base = { ...base, names: { ...base.names } };
    const s = schedule(machine, { ...(config.declaredType === undefined ? {} : { declaredType: config.declaredType }), context: base });
    for (const [id, doc] of docs) s.set(id, doc);
    for (let step = 0; step < STEPS; step += 1) {
      const what = rng.int(12);
      if (what < 4) {
        const fresh = fromScratch(config, machine, docs, base);
        const again = fromScratch(config, machine, docs, base);
        const ids = shuffle([...docs.keys()], rng);
        // The static cycles of the graph: the possible cycles and the certain cycles.
        const found = cycles(s.graph());
        const onCycle = new Set(found.flatMap((each) => each.nodes));
        const certain = new Set(found.filter((each) => each.certain).flatMap((each) => each.nodes));
        // Half of the reads demand each node in a random order, and the other half demand one node.
        for (const id of rng.chance(0.5) ? ids : ids.slice(0, 1)) {
          const got = s.read(id);
          const want = fresh.get(id) as Result;
          add("reads");
          // A result that is new at each evaluation has no one result to compare.
          if (!sameResult(want, again.get(id) as Result, equal)) {
            add("unrepeatable");
            continue;
          }
          add("compared");
          if (sameResult(want, cycle(id))) {
            add("cycles");
            if (certain.has(id)) add("certain");
            if (!config.inData && !onCycle.has(id)) missed.push(`${config.name} seed ${seed} step ${step} node ${id}: no static cycle\n  docs ${show([...docs])}`);
          } else if (sameResult(want, refused(id))) add("runs");
          else if (want.ok) add("values");
          if (!sameResult(got, want, equal)) stale.push(`${config.name} seed ${seed} step ${step} node ${id}: ${show(got)} and from scratch ${show(want)}\n  docs ${show([...docs])}`);
        }
      } else if (what < 6) {
        const names = change(base, rng);
        if (mutant) {
          // The mutant host breaks the promise of DURABLE.REUSE: a value of its context changes in place.
          for (const key of Object.keys(base.names)) delete (base.names as Record<string, unknown>)[key];
          Object.assign(base.names, names);
        } else {
          base = { ...base, names };
          s.changeData(base);
        }
        add("data");
      } else if (what === 6) {
        // A change of data that changes no value: each node verifies.
        s.changeData();
        add("empty");
      } else if (what < 9) {
        const id = rng.pick(NODES);
        const doc = make();
        docs.set(id, doc);
        s.set(id, doc);
        add("edits");
      } else if (what === 9) {
        const absent = NODES.filter((id) => !docs.has(id));
        if (absent.length > 0 && (docs.size <= 2 || rng.chance(0.65))) {
          const id = rng.pick(absent);
          const doc = make();
          docs.set(id, doc);
          s.set(id, doc);
          add("additions");
        } else {
          const id = rng.pick([...docs.keys()]);
          docs.delete(id);
          s.remove(id);
          add("removes");
        }
      } else if (what === 10) {
        // The same document object again: a change of the structure without an edit.
        const id = rng.pick([...docs.keys()]);
        s.set(id, docs.get(id));
        add("same");
      } else {
        at = (at + 1) % config.machines.length;
        machine = config.machines[at] as Machine;
        s.changeMachine(machine);
        add("machines");
      }
    }
    const work = s.counts;
    add("evaluations", work.evaluations);
    add("verifications", work.verifications);
    add("reuses", work.reuses);
    add("ahead", work.ahead);
  }
  return { stale, missed, counts };
}

describe("one meaning across schedules", () => {
  it("[SCHED.ONE-MEANING] after random changes the demand schedule gives each node the result of an evaluation from scratch, also for each cycle and in each order", () => {
    for (const config of CONFIGS) {
      const outcome = harness(config);
      expect(outcome.stale.slice(0, 3), `${config.name}: ${show(outcome.counts)}`).toEqual([]);
      expect(outcome.missed.slice(0, 3), config.name).toEqual([]);
      // The harness reaches each command and each answer of the schedule, and the demands ahead of a node (S2a).
      for (const name of ["data", "empty", "edits", "removes", "additions", "same", "machines", "verifications", "reuses", "cycles", "ahead"]) {
        expect(outcome.counts[name] ?? 0, `${config.name}: ${name} in ${show(outcome.counts)}`).toBeGreaterThan(COUNT / 4);
      }
      expect(outcome.counts["compared"] ?? 0, config.name).toBeGreaterThan(COUNT * 10);
      expect(outcome.counts["values"] ?? 0, config.name).toBeGreaterThan(COUNT * 3);
      if (config.runs) expect(outcome.counts["runs"] ?? 0, config.name).toBeGreaterThan(COUNT / 2);
    }
    // A host that changes its data in place gets stale values, and the harness finds them.
    expect(harness(CONFIGS[0] as Config, true, COUNT / 2).stale.length).toBeGreaterThan(0);
  }, 120_000);
});
