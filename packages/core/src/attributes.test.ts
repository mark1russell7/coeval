import { describe, expect, it } from "vitest";
import {
  STD_CAPS,
  STD_DEFINITIONS,
  STD_MACHINE,
  agree,
  attributeTrace,
  check,
  evaluate,
  fail,
  isHostThing,
  makeContext,
  ok,
  prepare,
  reference,
  treeNodeEvaluator,
  verifyReads,
  type AttributeAnswer,
  type AttributeCell,
  type EvalFn,
  type Evaluator,
  type Json,
  type Key,
  type Kind,
  type Machine,
  type Plan,
  type Read,
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
  // The code of a node resolves self, as the standard kinds declare (D44).
  reads: ["self"],
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

describe("the reads of a node of a tree (K149)", () => {
  /**
   * This function wraps the code of a node. The code gets a context whose self is a trap, and each direct read of the
   * trap counts. A resolution through `resolve` still reaches the real self.
   */
  const trapped =
    (base: EvalFn, direct: string[]): EvalFn =>
    (input) => {
      const count = (what: string): undefined => {
        direct.push(what);
        return undefined;
      };
      const trap = new Proxy(
        {},
        {
          get: (_target, key) => count(String(key)),
          has: (_target, key) => (count(String(key)), false),
          ownKeys: () => (count("keys"), []),
          getPrototypeOf: () => (count("prototype"), null),
        },
      );
      return base({ ...input, context: { ...input.context, self: trap } });
    };
  const doc = node("panel", {
    width: 10,
    children: list(node("box", { width: path("self", "parent", "width") }), node("box", { width: path("self", "parent", "children", 0, "width") })),
  });
  const expected = ok({ width: 10, children: [{ width: 10 }, { width: 10 }] });

  it("[TREE.SELF] a node reads self only through resolve (C4), in the plan and in the reference", () => {
    const direct: string[] = [];
    const machine = withKinds({}, { "tree.node": trapped(STD_MACHINE.evaluators["tree.node"] as EvalFn, direct) });
    expect(prepare(machine, doc).evaluate()).toEqual(expected);
    const definition = STD_DEFINITIONS.evaluators?.["tree.node"] as EvalFn;
    expect(reference(STD_MACHINE, doc, makeContext(), { definitions: { evaluators: { "tree.node": trapped(definition, direct) } } })).toEqual(expected);
    expect(direct).toEqual([]);
    // The list of reads holds the read of the root self, thus a change of self is visible (READS.SOUND).
    const reads: Read[] = [];
    expect(prepare(STD_MACHINE, doc).evaluate(makeContext(), { reads })).toEqual(expected);
    expect(reads[0]).toMatchObject({ path: ["self"], free: true });
  });

  it("[TREE.SELF] a nested evaluation inside an open tree records the read of self, thus verifyReads sees another self", () => {
    const inner: Read[] = [];
    let plan: Plan | undefined;
    let first: Result | undefined;
    const machine = withKinds(
      { top: treeKind(), again: { verbs: { eval: "test.again" } } },
      {
        "test.again": ({ context }) => {
          plan = prepare(STD_MACHINE, node("box", { width: 1 }));
          first = plan.evaluate(context, { reads: inner });
          return ok(0);
        },
      },
    );
    expect(prepare(machine, node("top", { probe: { type: "again", value: null } })).evaluate()).toEqual(ok({ probe: 0 }));
    // The self of the nested evaluation is a node of an open tree, thus the box is a node of that tree.
    expect(first?.ok === true && isHostThing(first.value)).toBe(true);
    // Before K149, the list was empty, and verifyReads kept the old result for another self.
    expect(inner.map((read) => [read.path, read.free])).toEqual([[["self"], true]]);
    expect(verifyReads(plan as Plan, inner, makeContext()).same).toBe(false);
    expect(plan?.evaluate(makeContext())).toEqual(ok({ width: 1 }));
  });

  it("[TREE.SELF] a machine that closes the root self still gives the JSON of each tree, in the plan and in the reference", () => {
    // Each node is then the root of a new tree. No path reaches a node, thus the JSON stays the same.
    const closed: Machine = { ...STD_MACHINE, roots: ["names", "world"] };
    const flat = node("panel", { width: 1, children: list(node("box", { width: 2 })) });
    expect(prepare(closed, flat).evaluate()).toEqual(ok({ width: 1, children: [{ width: 2 }] }));
    expect(agreed(closed, flat)).toEqual(ok({ width: 1, children: [{ width: 2 }] }));
  });
});

describe("the checks of attributes (L2d, D106)", () => {
  const machine = withKinds({
    column: treeKind({ down: { x: path("self", "x"), y: add(path("self", "y"), path("names", "index")) } }),
    cell: treeKind({ equations: { area: add(path("self", "width"), path("self", "height")) }, attributes: { x: {}, theme: { copy: true }, w: {} } }),
    probe: { verbs: { eval: "test.probe" }, parts: { shape: "list" } },
  }, { "test.probe": () => ok(0) });

  it("[TREE.CHECK-UNKNOWN] check finds a read of an attribute that no rung answers, with the code and the place of the run", () => {
    const doc = node("column", { x: 0, y: 0, children: list(node("cell", { width: 1, height: 2, w: 3, seen: list(path("self", "x"), path("self", "q")) })) });
    const issue = { code: "#N/A", place: ["children", 0, "seen", 1], reason: "No rung gives the attribute q of the kind cell.", at: ["value", "children", "value", 0, "value", "seen", "value", 1, "value", 1] };
    expect(check(machine, doc)).toEqual([issue]);
    expect(evaluate(machine, doc).result).toMatchObject({ ok: false, error: { code: "#N/A", place: issue.place } });
    // The steps parent go up the known nodes. The steps parent and type never read an attribute.
    const up = node("column", { x: 0, y: 0, children: list(node("cell", { width: 1, height: 2, w: 3, a: path("self", "parent", "z"), t: path("self", "type") })) });
    expect(check(machine, up)).toMatchObject([{ code: "#N/A", place: ["children", 0, "a"], reason: "No rung gives the attribute z of the kind column." }]);
    // The parent of the root is not known. Code that check does not know can change self. Thus check finds nothing.
    expect(check(machine, node("cell", { width: 1, height: 2, w: 3, a: path("self", "parent", "z") }))).toEqual([]);
    expect(check(machine, node("cell", { width: 1, height: 2, w: 3, a: { type: "probe", value: [path("self", "z")] } }))).toEqual([]);
  });

  it("[TREE.CHECK-UNKNOWN] in an open world, a parent that check does not know can be a node of the fallback kind", () => {
    const leaf = node("cell", { width: 1, height: 2, w: 3, a: path("self", "z") });
    expect(check(machine, leaf)).toMatchObject([{ code: "#N/A", reason: "No rung gives the attribute z of the kind cell." }]);
    const open: Machine = { ...machine, world: { ...machine.world, fallback: treeKind({ down: { z: 1 } }) } };
    expect(check(open, leaf)).toEqual([]);
    // A known parent of another kind gives no z, also in the open world.
    expect(check(open, node("column", { x: 0, y: 0, children: list(leaf) }))).toMatchObject([{ code: "#N/A", place: ["children", 0, "a"] }]);
  });

  it("[TREE.CHECK-RESERVED] check finds an attribute with the name of a structural step, and a tree kind of the run side", () => {
    const reserved = withKinds({ odd: { ...treeKind({ equations: { parent: 1 }, attributes: { type: { default: 0 } } }), side: "run" } });
    expect(check(reserved, node("odd", { type: 2, n: 1 }))).toEqual([
      { code: "#NAME?", place: [], reason: "The kind odd gives the reserved attribute tree.equations.parent: the step parent gives the parent of the node.", at: [] },
      { code: "#NAME?", place: [], reason: "The kind odd gives the reserved attribute tree.attributes.type: the step type gives the type of the node.", at: [] },
      { code: "#CALC!", place: [], reason: "The tree kind odd is on the run side: a node evaluates its attributes on demand, thus in no fixed order.", at: [] },
      { code: "#NAME?", place: [], reason: "The part type of the kind odd has a reserved name: the step type gives the type of the node.", at: ["value", "type"] },
    ]);
    // The step type gives the type, not the part.
    expect(evaluate(reserved, node("odd", { type: 2, t: path("self", "type") })).result).toEqual(ok({ type: 2, t: "odd" }));
  });

  it("[TREE.CHECK-COMPLETE] check finds an attribute that the kind declares or reads when no rung answers it at a node", () => {
    const cell = (value: Record<string, Json>): Json => node("cell", value);
    // The equation area reads height, and no rung gives w. Under the column, the parent gives x.
    const doc = node("column", { x: 0, y: 0, children: list(cell({ width: 1 }), cell({ width: 1, area: 5, w: 2 })) });
    expect(check(machine, doc)).toEqual([
      { code: "#N/A", place: ["children", 0], reason: "No rung gives the attribute w of the kind cell, and the kind declares it.", at: ["value", "children", "value", 0] },
      { code: "#N/A", place: ["children", 0], reason: "No rung gives the attribute height of the kind cell, and the equation tree.equations.area reads it.", at: ["value", "children", "value", 0] },
    ]);
    // The equations down of the column read x and y of the column itself. A parent cell gives no y.
    const inner = cell({ width: 1, height: 2, w: 3, inner: node("column", { x: 0 }) });
    expect(check(machine, inner)).toMatchObject([{ code: "#N/A", place: ["inner"], reason: "No rung gives the attribute y of the kind column, and the equation tree.down.y reads it." }]);
    // The parent of the root is not known, and the column gives y to its children. Thus check finds nothing at the root.
    expect(check(machine, node("column", { x: 0 }))).toEqual([]);
    // The standard kinds have no contract, thus each node of them is complete.
    expect(check(STD_MACHINE, node("panel", { width: 10, children: list(node("box", { width: path("self", "parent", "width") })) }))).toEqual([]);
  });

  it("[STATIC.AGREES] a tree document that checks evaluates without the read of an unknown attribute", () => {
    const cases: readonly Json[] = [
      node("column", { x: 0, y: 0, children: list(node("cell", { width: 1, height: 2, w: 3, seen: list(path("self", "x"), path("self", "y"), path("self", "area")) })) }),
      node("panel", { width: 10, children: list(node("box", { width: path("self", "parent", "width") }), node("box", { width: path("self", "parent", "children", 0, "width") })) }),
      node("panel", { width: 10, height: path("self", "children", 0, "height"), children: list(node("box", { width: 1, height: path("self", "parent", "width") })) }),
    ];
    for (const doc of cases) {
      expect(check(machine, doc), JSON.stringify(doc)).toEqual([]);
      expect(evaluate(machine, doc).result.ok, JSON.stringify(doc)).toBe(true);
    }
    // Each #N/A of an unknown attribute in a run has an issue of check at its place.
    const misses: readonly Json[] = [
      node("panel", { width: path("self", "height") }),
      node("panel", { children: list(node("box", { width: path("self", "parent", "height") })) }),
    ];
    for (const doc of misses) {
      const result = evaluate(machine, doc).result;
      expect(result).toMatchObject({ ok: false, error: { code: "#N/A" } });
      const place = result.ok ? [] : result.error.place;
      expect(check(machine, doc)).toMatchObject([{ code: "#N/A", place }]);
    }
  });
});

describe("the memo cells of a host (L2c, D108)", () => {
  /**
   * This function makes the cells of a host that keeps each answer by the identity of the place and by the name. It
   * records each computation. The function `forget` drops the kept cells of some attributes, as a change of a store.
   */
  const keptCells = () => {
    const kept = new Map<readonly Key[], Map<string, AttributeAnswer>>();
    const computed: string[] = [];
    const text = (place: readonly Key[], attribute: string): string => `${attribute} at [${place.join(", ")}]`;
    const cell: AttributeCell = (place, attribute, compute) => {
      let byName = kept.get(place);
      if (byName === undefined) {
        byName = new Map();
        kept.set(place, byName);
      }
      let answer = byName.get(attribute);
      if (answer === undefined) {
        computed.push(text(place, attribute));
        answer = compute();
        byName.set(attribute, answer);
      }
      return answer;
    };
    const forget = (...names: string[]): void => {
      for (const [place, byName] of kept) for (const attribute of [...byName.keys()]) if (names.includes(text(place, attribute))) byName.delete(attribute);
    };
    return { cell, computed, forget };
  };
  const sum = { unit: 0, combine: add(path("names", "acc"), path("names", "item")) };
  const kinds = { stack: treeKind({ down: { x: add(path("self", "x"), 1) }, attributes: { total: { fold: sum } } }), item: treeKind() };
  const plain = withKinds(kinds);
  const hosted = (cell: AttributeCell): Machine => withKinds(kinds, { "tree.node": treeNodeEvaluator({ cell }) });
  const doc = (width: number): Json =>
    node("stack", {
      x: 0,
      width,
      sum: path("self", "total"),
      children: list(node("item", { total: 2, width: path("self", "parent", "width"), at: path("self", "x") }), node("item", { total: path("self", "parent", "children", 0, "total") })),
    });
  const demanded = [
    "at at [children, 0]",
    "children at []",
    "sum at []",
    "total at [children, 0]",
    "total at [children, 1]",
    "total at []",
    "width at [children, 0]",
    "width at []",
    "x at [children, 0]",
    "x at []",
  ];

  it("[TREE.CELL] a counting cell shows one computation for each node and attribute that the evaluation demands", () => {
    const { cell, computed } = keptCells();
    const result = prepare(hosted(cell), doc(10)).evaluate();
    expect(result).toEqual(prepare(plain, doc(10)).evaluate());
    expect(result).toMatchObject({ ok: true, value: { sum: 4, children: [{ width: 10, at: 1 }, { total: 2 }] } });
    expect([...computed].sort()).toEqual([...demanded].sort());
    // Without a cell, the evaluator is the standard code.
    expect(treeNodeEvaluator()).toBe(STD_MACHINE.evaluators["tree.node"]);
  });

  it("[TREE.CELL-KEPT] a second evaluation of the plan with kept cells computes nothing and gives the same result", () => {
    const { cell, computed } = keptCells();
    const plan = prepare(hosted(cell), doc(10));
    const first = plan.evaluate();
    computed.length = 0;
    expect(plan.evaluate()).toEqual(first);
    expect(computed).toEqual([]);
  });

  it("[TREE.CELL-PLAN] a new plan gives new places, thus a changed document does not reuse a kept cell", () => {
    const { cell, computed } = keptCells();
    const machine = hosted(cell);
    expect(prepare(machine, doc(10)).evaluate()).toMatchObject({ ok: true, value: { width: 10 } });
    computed.length = 0;
    // The same document in a new plan computes each attribute again.
    expect(prepare(machine, doc(10)).evaluate()).toMatchObject({ ok: true, value: { width: 10 } });
    expect([...computed].sort()).toEqual([...demanded].sort());
    // A changed document gives its new values, not the values of the kept cells.
    expect(prepare(machine, doc(20)).evaluate()).toMatchObject({ ok: true, value: { width: 20, children: [{ width: 20 }, {}] } });
  });

  it("[TREE.CELL-STORE] a change of a store computes again only the attributes whose cells the host drops", () => {
    const { cell, computed, forget } = keptCells();
    const store = { w: 10 };
    const shared = node("stack", { width: path("names", "store", "w"), children: list(node("item", { width: path("self", "parent", "width") }), node("item", { width: 3 })) });
    const plan = prepare(hosted(cell), shared);
    expect(plan.evaluate(makeContext({ store }))).toEqual(ok({ width: 10, children: [{ width: 10 }, { width: 3 }] }));
    store.w = 20;
    computed.length = 0;
    // A host with signals drops the cells that read the store. A node of the earlier evaluation reads the new cell.
    forget("width at []", "width at [children, 0]");
    expect(plan.evaluate(makeContext({ store }))).toEqual(ok({ width: 20, children: [{ width: 20 }, { width: 3 }] }));
    expect(computed).toEqual(["width at []", "width at [children, 0]"]);
  });

  it("[TREE.CELL-CYCLE] a cycle through the cells of a host gives #CYCLE! with its chain, as the plain memo does", () => {
    const cycles = [
      node("panel", { width: path("self", "width") }),
      node("panel", { width: path("self", "children", 0, "width"), children: list(node("box", { width: path("self", "parent", "width") })) }),
    ];
    for (const cyclic of cycles) {
      const { cell, computed } = keptCells();
      const plan = prepare({ ...STD_MACHINE, evaluators: { ...STD_MACHINE.evaluators, "tree.node": treeNodeEvaluator({ cell }) } }, cyclic);
      const expected = prepare(STD_MACHINE, cyclic).evaluate();
      expect(expected).toMatchObject({ ok: false, error: { code: "#CYCLE!" } });
      expect(plan.evaluate()).toEqual(expected);
      computed.length = 0;
      expect(plan.evaluate()).toEqual(expected);
      expect(computed).toEqual([]);
    }
  });

  it("[TREE.CELL-CYCLE] an exception of the cell, for example the cycle error of a signal library, gives #CYCLE! with the chain", () => {
    const own = new Error("The signal reads itself.");
    const cell: AttributeCell = (_place, attribute, compute) => {
      if (attribute === "height") throw own;
      return compute();
    };
    const machine: Machine = { ...STD_MACHINE, evaluators: { ...STD_MACHINE.evaluators, "tree.node": treeNodeEvaluator({ cell }) } };
    const result = prepare(machine, node("panel", { width: path("self", "height"), height: 1 })).evaluate();
    expect(result).toMatchObject({
      ok: false,
      error: { code: "#CYCLE!", place: ["width"], reason: "The cells of the host found a cycle in the demands: width of panel at [] -> height of panel at []." },
    });
    expect(result.ok ? undefined : result.error.cause).toBe(own);
  });
});
