import { describe, expect, it } from "vitest";
import {
  STD_CAPS,
  STD_MACHINE,
  agree,
  attributeTrace,
  check,
  evaluate,
  fail,
  makeContext,
  ok,
  prepare,
  type Evaluator,
  type Json,
  type Kind,
  type Machine,
  type Result,
  type Thing,
  type TreeContract,
} from "./index.ts";

/** A kind of the decorated tree: each field is an attribute, a bare field is a number, and its parts have no capabilities. */
const treeKind = (tree?: TreeContract): Kind => ({
  verbs: { eval: "tree.node" },
  parts: { shape: "record", fields: {}, rest: { shape: "term", of: "number" } },
  caps: [{ rule: "mask" }],
  pure: true,
  lazy: [{}],
  ...(tree === undefined ? {} : { tree }),
});

const withKinds = (kinds: Record<string, Kind>, evaluators: Record<string, Evaluator> = {}): Machine => ({
  ...STD_MACHINE,
  world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, ...kinds } },
  evaluators: { ...STD_MACHINE.evaluators, ...evaluators },
});

const node = (type: string, value: Record<string, Json> = {}): Json => ({ type, value });
const list = (...items: Json[]): Json => ({ type: "list", value: items });
const path = (...steps: Json[]): Json => ({ type: "ref", value: steps });
const add = (...items: Json[]): Json => ({ type: "add", value: items });
const whenFirst = (first: Json, later: Json): Json => ({
  type: "if",
  value: { test: { type: "greater", value: [path("names", "index"), 0] }, then: later, else: first },
});

/** The plan, the traced plan, a second evaluation and the reference give the same result, also the same reason. */
const agreed = (machine: Machine, doc: Json): Result => {
  const outcome = agree(machine, doc, makeContext({}, STD_CAPS), { strict: true });
  expect(outcome, outcome.ok ? "" : outcome.reason).toMatchObject({ ok: true });
  return outcome.ok ? outcome.result : fail("#N/A", "The tiers disagree.");
};

describe("the ladder of an attribute", () => {
  const ladder = withKinds({
    top: treeKind({ equations: { k: 2, c: 4, p: 300 }, down: { p: 3, k: 99 } }),
    leaf: treeKind({ equations: { k: 20 }, attributes: { c: { copy: true, default: 50 }, d: { default: 5 }, p: { copy: true, default: 7 } } }),
  });
  const seen = list(path("self", "k"), path("self", "p"), path("self", "c"), path("self", "d"));

  it("[TREE.LADDER] a step visits the own part, the kind, the parent, the copy and the default, in this order", () => {
    const doc = node("top", { children: list(node("leaf", { seen }), node("leaf", { k: 1, seen })) });
    // own (k: 1) wins over the kind (k: 20), which wins over the parent (k: 99). The parent (p: 3) wins over the copy
    // (p: 300). The copy (c: 4) wins over the default (c: 50). Only the default answers d.
    expect(agreed(ladder, doc)).toEqual(ok({ children: [{ seen: [20, 3, 4, 5] }, { k: 1, seen: [1, 3, 4, 5] }] }));
    // A root has no parent, thus the copy does not answer, and the default does.
    expect(agreed(ladder, node("leaf", { seen }))).toEqual(ok({ seen: [20, 7, 50, 5] }));
    // When no rung answers, the step reaches nothing.
    expect(agreed(ladder, node("leaf", { y: path("self", "z") }))).toMatchObject({ ok: false, error: { code: "#N/A", place: ["y"] } });
  });

  it("[TREE.LADDER] an equation evaluates without capabilities, and it sees no names of the document", () => {
    const machine = withKinds({ loud: treeKind({ equations: { w: { type: "log", value: ["x"] }, n: path("names", "x") } }) });
    expect(agreed(machine, node("loud", { a: path("self", "w") }))).toMatchObject({ ok: false, error: { code: "#CAP!" } });
    const named = evaluate(machine, node("loud", { a: path("self", "n") }), makeContext({ x: 1 }, STD_CAPS));
    expect(named.result).toMatchObject({ ok: false, error: { code: "#NAME?" } });
  });

  it("[TREE.RUNGS] the record of an attribute gives the rungs that its demand visited and the rung that answered", () => {
    const probes: Thing[] = [];
    const machine = withKinds(
      { ...ladder.world.kinds, probe: { verbs: { eval: "test.probe" } } } as Record<string, Kind>,
      {
        "test.probe": ({ context }) => {
          probes.push(context.self);
          return ok(0);
        },
      },
    );
    const plan = prepare(machine, node("top", { children: list(node("leaf", { probe: { type: "probe", value: null }, k: 1, seen, z: 0 })) }));
    expect(plan.evaluate().ok).toBe(true);
    const leaf = probes[0];
    expect(attributeTrace(leaf, "k")).toEqual({ attribute: "k", rungs: ["own"], by: "own" });
    expect(attributeTrace(leaf, "p")).toEqual({ attribute: "p", rungs: ["own", "kind", "parent"], by: "parent" });
    expect(attributeTrace(leaf, "c")).toEqual({ attribute: "c", rungs: ["own", "kind", "parent", "copy"], by: "copy" });
    expect(attributeTrace(leaf, "d")).toEqual({ attribute: "d", rungs: ["own", "kind", "parent", "copy", "default"], by: "default" });
    // No demand reached the attribute q, and a value that is not a node has no record.
    expect(attributeTrace(leaf, "q")).toBeUndefined();
    expect(attributeTrace({}, "k")).toBeUndefined();
  });

  it("[TREE.DOWN] a column and a row place the same child kind in different positions, through their equations down", () => {
    const prev = (key: string): Json => path("names", "prev", key);
    const machine = withKinds({
      column: treeKind({ down: { x: path("self", "x"), y: whenFirst(path("self", "y"), add(prev("y"), prev("height"))) } }),
      row: treeKind({ down: { x: whenFirst(path("self", "x"), add(prev("x"), prev("width"))), y: path("self", "y") } }),
      cell: treeKind(),
    });
    const cell = node("cell", { width: 50, height: 20, at: list(path("self", "x"), path("self", "y")) });
    const doc = node("column", { x: 0, y: 0, children: list(cell, cell, node("row", { height: 20, children: list(cell, cell) })) });
    const one = { width: 50, height: 20 };
    expect(agreed(machine, doc)).toEqual(
      ok({
        x: 0,
        y: 0,
        children: [
          { ...one, at: [0, 0] },
          { ...one, at: [0, 20] },
          { height: 20, children: [{ ...one, at: [0, 40] }, { ...one, at: [50, 40] }] },
        ],
      }),
    );
    // The name child is the node itself, and a node outside the list children has no index.
    const named = withKinds({ box2: treeKind({ down: { me: path("names", "child", "tag"), at: path("names", "index") } }) });
    const inner = node("box2", { head: node("box2", { tag: 7, seen: list(path("self", "me"), path("self", "at")) }) });
    expect(agreed(named, inner)).toEqual(ok({ head: { tag: 7, seen: [7, null] } }));
  });

  it("[TREE.COPY] an attribute declared copy gives the attribute of the parent, through each level of the tree", () => {
    const machine = withKinds({ frame: treeKind({ attributes: { theme: { copy: true, default: 1 } } }) });
    const leaf = node("frame", { seen: path("self", "theme") });
    const doc = node("frame", {
      theme: 7,
      children: list(node("frame", { children: list(leaf) }), node("frame", { theme: 8, children: list(leaf) })),
    });
    expect(agreed(machine, doc)).toEqual(ok({ theme: 7, children: [{ children: [{ seen: 7 }] }, { theme: 8, children: [{ seen: 8 }] }] }));
    // The root has no parent, thus its default answers.
    expect(agreed(machine, node("frame", { children: list(leaf) }))).toEqual(ok({ children: [{ seen: 1 }] }));
  });

  it("[TREE.FOLD] an attribute with a fold combines the attributes of the nodes in the list children, from its unit", () => {
    const sum = { unit: 0, combine: add(path("names", "acc"), path("names", "item")) };
    const machine = withKinds({ stack: treeKind({ attributes: { total: { fold: sum } } }), item: treeKind() });
    const doc = node("stack", {
      sum: path("self", "total"),
      children: list(node("item", { total: 2 }), node("stack", { children: list(node("item", { total: 3 }), node("item", { total: 4 })) }), { type: "number", value: 9 }),
    });
    // A value in the list that is not a node does not count.
    expect(agreed(machine, doc)).toMatchObject({ ok: true, value: { sum: 9 } });
    // A node without children gives the unit.
    expect(agreed(machine, node("stack", { sum: path("self", "total") }))).toEqual(ok({ sum: 0 }));
    // A child without an answer gives #N/A, and a failed child gives its own error.
    const missing = node("stack", { sum: path("self", "total"), children: list(node("item", {})) });
    expect(agreed(machine, missing)).toEqual(fail("#N/A", "No rung gives total of item at [children, 0].", { place: ["sum"] }));
    const failed = node("stack", { sum: path("self", "total"), children: list(node("item", { total: add(1, { type: "bool", value: true }) })) });
    expect(agreed(machine, failed)).toMatchObject({ ok: false, error: { code: "#VALUE!", place: ["children", 0, "total"] } });
  });

  it("[TREE.DOWN-NAMES] check finds names.index outside down, and it walks the equations of each kind one time", () => {
    const machine = withKinds({
      bad: treeKind({ equations: { w: path("names", "index") }, down: { v: path("names", "index") } }),
      good: treeKind({ down: { v: add(path("names", "index"), 1) }, attributes: { t: { fold: { unit: 0, combine: path("names", "acc") } } } }),
    });
    const doc = node("good", { children: list(node("bad"), node("bad")) });
    expect(check(machine, doc)).toEqual([
      {
        code: "#NAME?",
        place: ["children", 0],
        reason: "In the equation tree.equations.w of the kind bad: Nothing binds the name index.",
        at: ["value", "children", "value", 0],
      },
    ]);
    // An equation evaluates without capabilities, thus check finds an effect in it.
    const loud = withKinds({ loud: treeKind({ equations: { w: { type: "log", value: ["x"] } } }) });
    expect(check(loud, node("loud"), { caps: STD_CAPS })).toMatchObject([{ code: "#CAP!", place: [] }]);
  });

  it("[TREE.PLAN] the equations of a kind compile one time for each machine, and the plan of the document does not keep them", () => {
    let compiles = 0;
    const counted: Evaluator = {
      compile: () => {
        compiles += 1;
        return () => ok(5);
      },
    };
    const machine = withKinds({ counted: { verbs: { eval: "test.counted" } }, top: treeKind(), leaf: treeKind({ equations: { w: { type: "counted", value: null } } }) }, { "test.counted": counted });
    const leaf = node("leaf", { seen: path("self", "w") });
    const plan = prepare(machine, node("top", { children: list(leaf, leaf, leaf) }));
    expect(compiles).toBe(0);
    expect(plan.evaluate()).toEqual(ok({ children: [{ seen: 5 }, { seen: 5 }, { seen: 5 }] }));
    expect(plan.evaluate().ok).toBe(true);
    expect(prepare(machine, node("top", { children: list(leaf) })).evaluate().ok).toBe(true);
    expect(compiles).toBe(1);
  });
});
