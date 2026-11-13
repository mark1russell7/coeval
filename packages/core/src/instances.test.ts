import { describe, expect, it } from "vitest";
import {
  STD_CAPS,
  STD_MACHINE,
  agree,
  attributeGraph,
  attributeVertexId,
  check,
  fail,
  makeContext,
  type AttributeGraph,
  type Json,
  type Kind,
  type Machine,
  type Result,
  type TreeContract,
} from "./index.ts";

/** A kind of the decorated tree: each field is an attribute, and a bare field is a number. */
const treeKind = (tree?: TreeContract): Kind => ({
  verbs: { eval: "tree.node" },
  parts: { shape: "record", fields: {}, rest: { shape: "term", of: "number" } },
  caps: [{ rule: "mask" }],
  pure: true,
  lazy: [{}],
  reads: ["self"],
  ...(tree === undefined ? {} : { tree }),
});

const withKinds = (kinds: Record<string, Kind>): Machine => ({ ...STD_MACHINE, world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, ...kinds } } });

const node = (type: string, value: Record<string, Json> = {}): Json => ({ type, value });
const list = (...items: Json[]): Json => ({ type: "list", value: items });
const path = (...steps: Json[]): Json => ({ type: "ref", value: steps });
const add = (...items: Json[]): Json => ({ type: "add", value: items });
const id = attributeVertexId;

/** The plan, the traced plan, a second evaluation and the reference give the same result. */
const agreed = (machine: Machine, doc: Json): Result => {
  const outcome = agree(machine, doc, makeContext({}, STD_CAPS), { strict: true });
  expect(outcome, outcome.ok ? "" : outcome.reason).toMatchObject({ ok: true });
  return outcome.ok ? outcome.result : fail("#N/A", "The tiers disagree.");
};

/** The edges of a graph as rows: the source, the reader, the lazy mark and the place of the read. */
const rows = (graph: AttributeGraph): readonly (readonly unknown[])[] => graph.edges.map((e) => [e.from ?? "?", e.to, e.lazy, e.place]);

/**
 * A frame gives each child its `x` with an equation of `down`: the first child gets 0, and each other child gets the
 * `x` and the `w` of its previous sibling. The attribute `total` of a frame is the sum of the `total` of its children.
 */
const frame = treeKind({
  down: {
    x: {
      type: "if",
      value: { test: { type: "greater", value: [path("names", "index"), 0] }, then: add(path("names", "prev", "x"), path("names", "prev", "w")), else: { type: "number", value: 0 } },
    },
  },
  attributes: { total: { fold: { unit: 0, combine: add(path("names", "acc"), path("names", "item")) } } },
});
const machine = withKinds({ frame, cell: treeKind() });

describe("the graph of attribute instances (L2e, D107)", () => {
  it("[TREE.GRAPH] a read of self, of the parent, of the previous sibling and of a fold gives an edge, and a read of a value gives an unknown edge", () => {
    const cells = [node("cell", { w: 5, total: 1 }), node("cell", { w: path("self", "parent", "w"), y: path("self", "x"), total: 2 })];
    const doc = node("frame", {
      w: 10,
      sum: path("self", "total"),
      children: list(...cells, node("cell", { z: path("self", "x", "a"), n: path("self", { type: "nearest", value: { type: "frame" } }, "w"), total: 3 })),
    });
    const c = (index: number, key: string): string => id(["children", index], key);
    const graph = attributeGraph(machine, doc);
    expect(rows(graph)).toEqual([
      // A path from self reads an attribute of the node, and a step parent goes to the parent node.
      [id([], "total"), id([], "sum"), false, ["sum"]],
      [id([], "w"), c(1, "w"), false, ["children", 1, "w"]],
      [c(1, "x"), c(1, "y"), false, ["children", 1, "y"]],
      // A step after a value that only the run knows gives an edge with an unknown source.
      [c(2, "x"), c(2, "z"), false, ["children", 2, "z"]],
      ["?", c(2, "z"), false, ["children", 2, "z"]],
      // The step nearest depends only on the structure.
      [id([], "w"), c(2, "n"), false, ["children", 2, "n"]],
      // A fold reads the list children and the attribute of each child.
      [id([], "children"), id([], "total"), false, []],
      [c(0, "total"), id([], "total"), false, []],
      [c(1, "total"), id([], "total"), false, []],
      [c(2, "total"), id([], "total"), false, []],
      // The equation of down reads the list children, and the previous sibling in the branch that the test selects.
      [id([], "children"), c(1, "x"), false, ["children", 1]],
      [c(0, "x"), c(1, "x"), true, ["children", 1]],
      [c(0, "w"), c(1, "x"), true, ["children", 1]],
      [id([], "children"), c(2, "x"), false, ["children", 2]],
      [c(1, "x"), c(2, "x"), true, ["children", 2]],
      [c(1, "w"), c(2, "x"), true, ["children", 2]],
      // The first child has no previous sibling.
      [id([], "children"), c(0, "x"), false, ["children", 0]],
    ]);
    expect(graph.vertices.get(c(1, "x"))).toEqual({ id: c(1, "x"), place: ["children", 1], attribute: "x", type: "cell" });
    expect(graph.unknown).toEqual([{ from: undefined, to: c(2, "z"), lazy: false, place: ["children", 2, "z"] }]);
    // An edge with an unknown source can reach each vertex, thus its reader is on a possible cycle.
    expect(graph.cycles).toEqual([{ vertices: [c(2, "z")], certain: false }]);
    expect(check(machine, doc)).toEqual([]);
    // The run follows the same reads: the sum of the totals, the width of the parent, and the x of the previous sibling.
    expect(agreed(machine, node("frame", { w: 10, sum: path("self", "total"), children: list(...cells) }))).toEqual({
      ok: true,
      value: { w: 10, sum: 3, children: [{ w: 5, total: 1 }, { w: 10, y: 5, total: 2 }] },
    });
  });

  it("[TREE.GRAPH-CYCLE] check reports each certain cycle before a run, at the place and with the reason of the run", () => {
    const panel = (value: Record<string, Json>): Json => node("panel", value);
    const box = (value: Record<string, Json>): Json => node("box", value);
    const docs: readonly Json[] = [
      panel({ width: path("self", "width") }),
      panel({ width: path("self", "children", 0, "width"), children: list(box({ width: path("self", "parent", "width") })) }),
      // The value of a node is its JSON, thus a reference to the node itself reads each of its attributes.
      panel({ width: 1, height: path("self") }),
    ];
    for (const doc of docs) {
      const run = agreed(STD_MACHINE, doc);
      if (run.ok) throw new Error("The run gives no #CYCLE!.");
      expect(check(STD_MACHINE, doc)).toEqual([{ code: "#CYCLE!", place: run.error.place, reason: run.error.reason, at: expect.any(Array) }]);
    }
    expect(check(STD_MACHINE, docs[1])).toEqual([
      {
        code: "#CYCLE!",
        place: ["children", 0, "width"],
        reason: "The attributes form a cycle: width of panel at [] -> width of box at [children, 0] -> width of panel at [].",
        at: ["value", "children", "value", 0, "value", "width"],
      },
    ]);
    const graph = attributeGraph(STD_MACHINE, docs[1]);
    expect(graph.cycles).toEqual([{ vertices: [id([], "width"), id(["children", 0], "width")], certain: true }]);
    // A cycle through a branch that the test can skip is possible, not certain. Thus it is not an issue.
    const branch = panel({ width: { type: "if", value: { test: { type: "bool", value: false }, then: path("self", "width"), else: { type: "number", value: 3 } } } });
    expect(attributeGraph(STD_MACHINE, branch).cycles).toEqual([{ vertices: [id([], "width")], certain: false }]);
    expect(check(STD_MACHINE, branch)).toEqual([]);
    expect(agreed(STD_MACHINE, branch)).toEqual({ ok: true, value: { width: 3 } });
    // A read through a value that only the run knows is not known before the run. Only the run finds such a cycle.
    const hidden = panel({ width: path("self", "height", 0, "width"), height: path("self", "children"), children: list(box({ width: path("self", "parent", "width") })) });
    const unknown = attributeGraph(STD_MACHINE, hidden);
    expect(unknown.unknown.map((e) => e.place)).toEqual([["width"]]);
    expect(check(STD_MACHINE, hidden)).toEqual([]);
    expect(agreed(STD_MACHINE, hidden)).toMatchObject({ ok: false, error: { code: "#CYCLE!" } });
    // A cycle that only a lazy branch reaches is not an issue, also when its own reads are eager.
    const later = { type: "if", value: { test: { type: "bool", value: false }, then: panel({ width: path("self", "width") }), else: { type: "number", value: 1 } } };
    expect(attributeGraph(STD_MACHINE, later).cycles).toEqual([{ vertices: [id(["then"], "width")], certain: true }]);
    expect(check(STD_MACHINE, later)).toEqual([]);
    expect(agreed(STD_MACHINE, later)).toEqual({ ok: true, value: 1 });
  });
});

/**
 * A chain of panels: each panel holds the next panel in its list `children`. The root gets the fields `root`, and the
 * last panel gets the fields `last`. The panel at level k has the place `["children", 0]` k times, and the depth 2k.
 */
const panelChain = (levels: number, root: Record<string, Json>, last: Record<string, Json>): Json => {
  let value: Record<string, Json> = last;
  for (let level = 1; level < levels; level += 1) value = { children: list(node("panel", value)) };
  return node("panel", { ...root, ...value });
};

/** The place of the panel at a level of a chain. */
const chainPlace = (level: number): readonly (string | number)[] => Array.from({ length: level }, () => ["children", 0] as const).flat();

describe("the graph of attribute instances keeps the depth limit of check (K255)", () => {
  it("[TREE.GRAPH-DEPTH] a document deeper than the limit has no vertex, and a cycle inside the limit stays an issue", () => {
    const shallow: Machine = { ...STD_MACHINE, maxDepth: 20 };
    // The cycle is at depth 58. The first walk stops at depth 21, thus the graph does not reach the cycle either.
    const deepCycle = panelChain(30, {}, { width: path("self", "width") });
    expect(check(shallow, deepCycle).map((issue) => issue.code)).toEqual(["#DEPTH!"]);
    // A cycle at the root stays an issue after the #DEPTH! of the walk.
    const rootCycle = panelChain(30, { width: path("self", "width") }, {});
    expect(check(shallow, rootCycle)).toEqual([
      expect.objectContaining({ code: "#DEPTH!", reason: "The nesting is deeper than 20 documents." }),
      { code: "#CYCLE!", place: ["width"], reason: "The attributes form a cycle: width of panel at [] -> width of panel at [].", at: ["value", "width"] },
    ]);
    // A read of a node deeper than the limit has an unknown source: the graph does not know its reads.
    const graph = attributeGraph(shallow, panelChain(30, { width: path("self", "children", 0) }, {}));
    expect(graph.unknown.length).toBeGreaterThan(0);
    expect([...graph.vertices.values()].every((vertex) => vertex.place.length <= 20)).toBe(true);
  });

  it("[TREE.GRAPH-DEPTH] check of a very deep chain with a reference to a node gives #DEPTH! and ends", () => {
    // 12000 levels of panels: the root reads the JSON of its first child, thus each panel under it.
    const doc = panelChain(12000, { width: path("self", "children", 0) }, { width: 1 });
    expect(check(STD_MACHINE, doc).map((issue) => issue.code)).toEqual(["#DEPTH!"]);
  });

  it("[TREE.GRAPH-DEPTH] inside a high limit, a chain of 6000 panels gets the cycle of its last panel, with no overflow", () => {
    const deep: Machine = { ...STD_MACHINE, maxDepth: 100_000 };
    // The root reads the JSON of the chain. Its order reaches the last panel, whose width reads itself.
    const doc = panelChain(6000, { width: path("self", "children", 0) }, { width: path("self", "width") });
    const last = chainPlace(5999);
    const text = `width of panel at [${last.join(", ")}]`;
    expect(check(deep, doc)).toEqual([{ code: "#CYCLE!", place: [...last, "width"], reason: `The attributes form a cycle: ${text} -> ${text}.`, at: expect.any(Array) }]);
  });
});
