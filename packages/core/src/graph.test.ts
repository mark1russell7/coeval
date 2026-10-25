import { describe, expect, it } from "vitest";
import { type GraphNode, type Json, type NodeGraph, STD_MACHINE, components, context, cycles, fail, formulaMachine, heights, necessary, nodeLayers, ok, schedule } from "./index.ts";

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });
const op = (name: string, ...args: Json[]): Json => ({ type: ["ops", name], value: args });

const machine = formulaMachine({
  ops: { add: (a: number, b: number) => a + b },
  lazy: {
    ifError: (args) => {
      const first = args[0]?.() ?? fail("#ARGS", "ifError needs an argument.");
      return first.ok ? first : (args[1]?.() ?? first);
    },
  },
  pure: true,
});
const LIT = { declaredType: "lit" } as const;

/** The error of a node on a cycle, as D31 gives it. */
const cycle = (id: string) => fail("#CYCLE!", `The node ${id} is on a cycle of reads.`);

/** This function gives a graph from the eager reads of each node, in the order of the record. */
function graphOf(reads: Readonly<Record<string, readonly string[]>>): NodeGraph<string> {
  return new Map(Object.entries(reads).map(([id, to]) => [id, { edges: to.map((target) => ({ to: target, lazy: false })) }]));
}

/** This function gives a chain of nodes: each node reads the next node. With `ring`, the last node reads the first. */
function chainOf(length: number, ring = false): NodeGraph<string> {
  const graph = new Map<string, GraphNode<string>>();
  for (let index = 0; index < length; index += 1) {
    const next = index + 1 < length ? `n${index + 1}` : ring ? "n0" : undefined;
    graph.set(`n${index}`, { edges: next === undefined ? [] : [{ to: next, lazy: false }] });
  }
  return graph;
}

/** The diamond as documents: `b` and `c` read `a`, and `d` reads `b` and `c`. */
function diamond(): NodeGraph<string> {
  const s = schedule(machine, LIT);
  s.set("d", op("add", ref("world", "b"), ref("world", "c")));
  s.set("b", op("add", ref("world", "a"), 1));
  s.set("c", op("add", ref("world", "a"), 2));
  s.set("a", 1);
  expect(s.read("d")).toEqual(ok(5));
  return s.graph();
}

describe("the analysis of a graph of nodes", () => {
  it("[GRAPH.SCC] components gives the strongly connected components deepest first, with its own stack, also for a chain of 100000 nodes", () => {
    // The graph of a schedule is a graph of the analysis.
    expect(components(diamond())).toEqual([["a"], ["b"], ["c"], ["d"]]);
    // A component keeps the order of the graph, and it comes after each component that it reads.
    const graph = graphOf({ top: ["q"], p: ["q", "low"], q: ["p"], low: [] });
    expect(components(graph)).toEqual([["low"], ["p", "q"], ["top"]]);
    // Neither a chain nor a ring of 100000 nodes overflows the stack of the host.
    const chain = components(chainOf(100_000));
    expect(chain).toHaveLength(100_000);
    expect(chain[0]).toEqual(["n99999"]);
    expect(chain[99_999]).toEqual(["n0"]);
    const ring = components(chainOf(100_000, true));
    expect(ring).toHaveLength(1);
    expect(ring[0]).toHaveLength(100_000);
    expect(ring[0]?.[0]).toBe("n0");
  });

  it("[GRAPH.ORDER] heights gives the order of a push schedule: a node is higher than each node that it reads outside its component", () => {
    expect([...heights(diamond())]).toEqual([
      ["d", 2],
      ["b", 1],
      ["c", 1],
      ["a", 0],
    ]);
    // The nodes of one component share one height.
    const graph = graphOf({ top: ["q"], p: ["q", "low"], q: ["p"], low: [] });
    const found = heights(graph);
    expect(Object.fromEntries(found)).toEqual({ top: 2, p: 1, q: 1, low: 0 });
    // Each edge outside a component goes down.
    for (const [id, node] of graph) {
      for (const edge of node.edges) if (edge.to !== "p" && edge.to !== "q") expect(found.get(id)).toBeGreaterThan(found.get(edge.to as string) as number);
    }
    const chain = heights(chainOf(100_000));
    expect(chain.get("n0")).toBe(99_999);
    expect(chain.get("n99999")).toBe(0);
  });

  it("[GRAPH.LAYERS] nodeLayers puts the nodes of each height in one layer, in the order of the graph and in linear time", () => {
    expect(nodeLayers(diamond())).toEqual([["a"], ["b", "c"], ["d"]]);
    expect(nodeLayers(graphOf({ top: ["q"], p: ["q", "low"], q: ["p"], low: [], other: [] }))).toEqual([["low", "other"], ["p", "q"], ["top"]]);
    const chain = nodeLayers(chainOf(100_000));
    expect(chain).toHaveLength(100_000);
    expect(chain[0]).toEqual(["n99999"]);
  });

  it("[GRAPH.NECESSARY] necessary gives each observed node and each node with a path from an observed node", () => {
    const graph = diamond();
    expect([...necessary(graph, ["b"])]).toEqual(["b", "a"]);
    expect([...necessary(graph, ["d"])]).toEqual(["d", "b", "c", "a"]);
    // A name that is not a node adds nothing.
    expect([...necessary(graph, ["nope"])]).toEqual([]);
    expect(necessary(chainOf(100_000), ["n50000"]).size).toBe(50_000);
    expect(necessary(chainOf(100_000, true), ["n50000"]).size).toBe(100_000);
  });

  it("[GRAPH.CYCLE] cycles gives each static cycle, certain for eager edges and possible under an if, and the demand still gives the values", () => {
    // A cycle under an if is possible. The demand gives values while the test skips the read.
    const s = schedule(machine, { ...LIT, context: context({ names: { flag: false } }) });
    s.set("p", { type: "if", value: { test: ref("names", "flag"), then: ref("world", "q"), else: 1 } });
    s.set("q", op("add", ref("world", "p"), 1));
    expect(cycles(s.graph())).toEqual([{ nodes: ["p", "q"], certain: false }]);
    expect(s.read("q")).toEqual(ok(2));
    s.changeData(context({ names: { flag: true } }));
    expect(s.read("q")).toEqual(cycle("q"));
    expect(s.read("p")).toEqual(cycle("p"));
    // A cycle of eager edges is certain, and so is a node that reads itself.
    s.set("a", op("add", ref("world", "b"), 1));
    s.set("b", op("add", ref("world", "a"), 1));
    s.set("self", op("add", ref("world", "self"), 1));
    // A lazy edge that a certain cycle does not need: the component is possible, and the certain cycle comes after it.
    s.set("x", op("add", ref("world", "y"), 1));
    s.set("y", op("add", ref("world", "x"), op("ifError", ref("world", "z"), 0)));
    s.set("z", op("add", ref("world", "x"), 1));
    s.set("free", op("add", ref("world", "a"), 1));
    expect(cycles(s.graph())).toEqual([
      { nodes: ["p", "q"], certain: false },
      { nodes: ["a", "b"], certain: true },
      { nodes: ["self"], certain: true },
      { nodes: ["x", "y", "z"], certain: false },
      { nodes: ["x", "y"], certain: true },
    ]);
    for (const id of ["a", "b", "self", "x", "y"]) expect(s.read(id), id).toEqual(cycle(id));
    // The read of x fails in y, thus y does not read z, and z is not on the cycle of the demand (D31).
    expect(s.read("z")).toEqual(fail("#CYCLE!", "The node x is on a cycle of reads.", { place: [0] }));
    expect(s.read("free")).toEqual(fail("#CYCLE!", "The node a is on a cycle of reads.", { place: [0] }));
    // A chain of 100000 nodes has no cycle, and a ring of 100000 nodes is one certain cycle.
    expect(cycles(chainOf(100_000))).toEqual([]);
    const ring = cycles(chainOf(100_000, true));
    expect(ring.map((found) => [found.nodes.length, found.certain])).toEqual([[100_000, true]]);
  });

  it("[GRAPH.UNKNOWN] an edge without a target reads each node that is not a sink, and an edge to a sink or to a missing node is no edge", () => {
    const s = schedule(STD_MACHINE, { context: context({ caps: ["log"] }) });
    s.set("a", { type: "number", value: 1 });
    s.set("b", { type: "add", value: [ref("world", "a"), 1] });
    // A read of the whole root reads each derive node, also itself.
    s.set("w", { type: "list", value: [ref("world")] });
    // A node on the run side is a sink. Its read of the whole root reads each derive node.
    s.set("r", { type: "log", value: [ref("world")] });
    // A read of a sink and a read of a missing node are no edges.
    s.set("x", { type: "list", value: [ref("world", "r"), ref("world", "nope")] });
    const graph = s.graph();
    expect(graph.get("w")?.edges.map((edge) => edge.to)).toEqual([undefined]);
    expect(Object.fromEntries(heights(graph))).toEqual({ a: 0, b: 1, w: 2, r: 3, x: 0 });
    expect(components(graph)).toEqual([["a"], ["b"], ["x"], ["w"], ["r"]]);
    expect(cycles(graph)).toEqual([{ nodes: ["w"], certain: false }]);
    expect(s.read("w")).toEqual(cycle("w"));
    expect([...necessary(graph, ["r"])]).toEqual(["a", "b", "w", "r", "x"]);
    expect([...necessary(graph, ["x"])]).toEqual(["x"]);
    // The option eager leaves out the lazy edges and the edges without a target.
    expect(Object.fromEntries(heights(graph, { eager: true }))).toEqual({ a: 0, b: 1, w: 0, r: 0, x: 0 });
    expect(necessary(graph, ["r"], { eager: true }).size).toBe(1);
  });
});
