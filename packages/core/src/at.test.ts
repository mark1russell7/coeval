import { describe, expect, it } from "vitest";
import {
  STD_CAPS,
  STD_MACHINE,
  agree,
  argsKey,
  atArgsOf,
  atRuleOf,
  attributeGraph,
  check,
  docEquals,
  evaluate,
  fail,
  makeContext,
  ok,
  prepare,
  treeNodeEvaluator,
  type AttributeAnswer,
  type AttributeCell,
  type Evaluator,
  type Json,
  type Key,
  type Kind,
  type Machine,
  type Result,
  type TreeContract,
} from "./index.ts";

/** A kind of the decorated tree: each field is an attribute, a bare field is a number, and its parts have no capabilities. */
const treeKind = (tree?: TreeContract): Kind => ({
  verbs: { eval: "tree.node" },
  parts: { shape: "record", fields: {}, rest: { shape: "term", of: "number" } },
  caps: [{ rule: "mask" }],
  pure: true,
  lazy: [{}],
  reads: ["self"],
  ...(tree === undefined ? {} : { tree }),
});

const node = (type: string, value: Record<string, Json> = {}): Json => ({ type, value });
const path = (...steps: Json[]): Json => ({ type: "ref", value: steps });
const add = (...items: Json[]): Json => ({ type: "add", value: items });
const self = (...steps: Json[]): Json => path("self", ...steps);
const name = (key: string): Json => path("names", key);
const at = (attr: string, args?: Record<string, Json>): Json => ({ type: ["tree", "at"], value: args === undefined ? { attr } : { attr, args } });
const tick = (term: Json): Json => ({ type: "tick", value: [term] });

/** The number of evaluations of the kind `tick`: each equation of `tree.at` that counts is in a tick. */
let ticks = 0;
const tickCode: Evaluator = ({ parts }) => {
  ticks += 1;
  return parts[0]?.evaluate() ?? fail("#VALUE!", "tick needs a part.");
};

const kinds: Record<string, Kind> = {
  tick: { verbs: { eval: "test.tick" }, parts: { shape: "list" }, pure: true },
  // The height of a box at a given width, and an area with two parameters.
  box: treeKind({
    at: {
      height: { params: ["width"], equation: tick(add(name("width"), self("base"))) },
      area: { params: ["width", "pad"], equation: tick(add(name("width"), name("pad"))) },
      lift: { params: ["w"], equation: add(self(at("height", { width: 100 })), name("w")) },
    },
  }),
  // An instance that reads itself with the same arguments.
  loop: treeKind({ at: { h: { params: ["w"], equation: self(at("h", { w: 1 })) } } }),
  // A circular attribute and an instance that read each other: a mixed cycle.
  mixed: treeKind({ attributes: { bar: { circular: { start: 0 } } }, equations: { bar: self(at("h", { w: 1 })) }, at: { h: { params: ["w"], equation: self("bar") } } }),
  bad: treeKind({ at: { h: { params: "w" } as never, k: { params: ["w", "w"], equation: 1 } } }),
  odd: treeKind({ at: { h: { params: ["w"], equation: name("depth") } } }),
};

const withKinds = (evaluators: Record<string, Evaluator> = {}): Machine => ({
  ...STD_MACHINE,
  world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, ...kinds } },
  evaluators: { ...STD_MACHINE.evaluators, "test.tick": tickCode, ...evaluators },
});
const machine = withKinds();

/** The plan, the traced plan, a second evaluation and the reference give the same result, also the same reason. */
const agreed = (on: Machine, doc: Json): Result => {
  const outcome = agree(on, doc, makeContext({}, STD_CAPS), { strict: true });
  expect(outcome, outcome.ok ? "" : outcome.reason).toMatchObject({ ok: true });
  return outcome.ok ? outcome.result : fail("#N/A", "The tiers disagree.");
};

/** A box that reads the height at two widths, one of them two times. */
const box = node("box", { base: 5, a: self(at("height", { width: 200 })), b: self(at("height", { width: 200 })), c: self(at("height", { width: 100 })) });

describe("attributes with parameters (L2h, D124)", () => {
  it("[TREE.AT] the step tree.at evaluates the equation of tree.at with the arguments as names, one time for each instance", () => {
    expect(agreed(machine, box)).toEqual(ok({ base: 5, a: 205, b: 205, c: 105 }));
    ticks = 0;
    expect(evaluate(machine, box, makeContext({}, STD_CAPS)).result).toEqual(ok({ base: 5, a: 205, b: 205, c: 105 }));
    expect(ticks).toBe(2);
    // Two equal arguments are one instance (DOC.EQUALS): the order of the fields does not count, and -0 is not 0.
    const area = node("box", { d: self(at("area", { width: 2, pad: 1 })), e: self(at("area", { pad: 1, width: 2 })), f: self(at("area", { width: -0, pad: 0 })) });
    expect(agreed(machine, area)).toEqual(ok({ d: 3, e: 3, f: 0 }));
    ticks = 0;
    evaluate(machine, area, makeContext({}, STD_CAPS));
    expect(ticks).toBe(2);
    // An equation of tree.at reads another instance.
    expect(agreed(machine, node("box", { base: 1, l: self(at("lift", { w: 3 })) }))).toEqual(ok({ base: 1, l: 104 }));
    expect(argsKey({ b: [1, -0], a: null })).toBe('{"a":null,"b":[1,-0]}');
    expect([argsKey(Number.NaN), argsKey(new Date(0))]).toEqual([undefined, undefined]);
    expect(docEquals({ width: 200 }, { width: 200 })).toBe(true);
  });

  it("[TREE.AT] missing or extra arguments give #VALUE!, and an attribute without an entry gives #N/A", () => {
    const failing: [Json, string, string][] = [
      [self(at("height", {})), "#VALUE!", "The step tree.at of height of box at [] has bad arguments. The step gives no argument width."],
      [self(at("height")), "#VALUE!", "The step tree.at of height of box at [] has bad arguments. The step gives no argument width."],
      [self(at("height", { width: 1, depth: 2 })), "#VALUE!", "The step tree.at of height of box at [] has bad arguments. The attribute has no parameter depth."],
      [self(at("depth", {})), "#N/A", "No rung gives the attribute depth with parameters."],
      [self({ type: ["tree", "at"], value: { attr: 3 } }), "#VALUE!", "The step tree.at needs a text attr."],
      [self("base", at("height", { width: 1 })), "#N/A", "The step tree.at reads height of a thing that is not a node of a tree."],
      // A plain read does not see tree.at: the plain ladder of an attribute does not change.
      [self("height"), "#N/A", ""],
    ];
    for (const [read, code, reason] of failing) {
      const result = agreed(machine, node("box", { base: 5, x: read }));
      expect(result).toMatchObject({ ok: false, error: { code } });
      if (reason !== "" && !result.ok) expect(result.error.reason).toBe(reason);
    }
    expect(agreed(machine, node("bad", { x: self(at("h", { w: 1 })) }))).toMatchObject({
      ok: false,
      error: { code: "#VALUE!", reason: "The attribute h of bad at [] has a bad entry tree.at. An entry of tree.at needs a list params of different texts and the field equation." },
    });
    expect(atRuleOf({ params: ["w"], equation: 1 })).toEqual({ ok: true, params: ["w"], equation: 1 });
    expect(atArgsOf(["w"], 5)).toEqual({ ok: false, reason: "The arguments are a record." });
  });

  it("[TREE.AT] an instance in evaluation gives #CYCLE!, also with a circular attribute in the cycle", () => {
    for (const doc of [node("loop", { x: self(at("h", { w: 1 })) }), node("mixed", { v: self("bar") })]) {
      const run = agreed(machine, doc);
      expect(run).toMatchObject({ ok: false, error: { code: "#CYCLE!" } });
      if (!run.ok) expect(run.error.reason).toContain('h with {"w":1} of');
      // check finds the cycle before the run, at the place and with the reason of the run.
      if (!run.ok) expect(check(machine, doc)).toEqual([{ code: "#CYCLE!", place: run.error.place, reason: run.error.reason, at: expect.any(Array) }]);
    }
  });

  it("[TREE.AT-CHECK] check examines the entries of tree.at, the arguments of each step and the names of each equation", () => {
    expect(check(machine, box)).toEqual([]);
    const issues = (doc: Json): [string, string][] => check(machine, doc).map((issue) => [issue.code, issue.reason]);
    expect(issues(node("box", { base: 5, x: self(at("height", {})), y: self(at("height", { width: 1, depth: 2 })), z: self(at("depth", {})) }))).toEqual([
      ["#VALUE!", "The step tree.at of height of the kind box has bad arguments. The step gives no argument width."],
      ["#VALUE!", "The step tree.at of height of the kind box has bad arguments. The attribute has no parameter depth."],
      ["#N/A", "No rung gives the attribute depth with parameters of the kind box."],
    ]);
    const why = "An entry of tree.at needs a list params of different texts and the field equation.";
    expect(issues(node("bad"))).toEqual([
      ["#VALUE!", `The kind bad has a bad entry tree.at.h. ${why}`],
      ["#VALUE!", `The kind bad has a bad entry tree.at.k. ${why}`],
    ]);
    expect(issues(node("odd"))).toEqual([["#NAME?", "In the equation tree.at.h of the kind odd: Nothing binds the name depth."]]);
  });

  it("[TREE.AT-CHECK] the graph has one vertex for each instance with literal arguments, and an unknown read for a document in the arguments", () => {
    const id = (place: readonly Key[], key: string): string => JSON.stringify([...place, key]);
    const instance = '["lift",{"w":3}]';
    const height = '["height",{"width":100}]';
    const graph = attributeGraph(machine, node("box", { base: 5, a: self(at("lift", { w: 3 })), b: self(at("lift", { w: 3 })) }));
    expect(graph.vertices.get(instance)).toEqual({ id: instance, place: [], attribute: "lift", type: "box", args: { w: 3 } });
    expect(graph.edges.filter((e) => e.from === instance).map((e) => e.to)).toEqual([id([], "a"), id([], "b")]);
    // The equation of lift reads one other instance. The name w holds data, thus it reads no attribute.
    expect(graph.edges.filter((e) => e.to === instance).map((e) => [e.from, e.lazy])).toEqual([[height, false]]);
    // The kind tick is not standard code, thus the reads of self in it are unknown.
    expect(new Set(graph.unknown.map((e) => e.to))).toEqual(new Set([height]));
    // A document in the arguments can be a part, thus only the run knows the instance.
    const computed = attributeGraph(machine, node("box", { base: 5, a: self(at("height", { width: { type: "number", value: 3 } })) }));
    expect(computed.unknown.map((e) => e.to)).toEqual([id([], "a")]);
  });

  it("[TREE.AT-CELL] the cells of a host keep each instance by a second place and the JSON text of the name and the arguments", () => {
    const kept = new Map<readonly Key[], Map<string, AttributeAnswer>>();
    const computed: string[] = [];
    const places = new Map<string, readonly Key[]>();
    const cell: AttributeCell = (place, attribute, compute) => {
      let byName = kept.get(place);
      if (byName === undefined) {
        byName = new Map();
        kept.set(place, byName);
      }
      places.set(attribute, place);
      let answer = byName.get(attribute);
      if (answer === undefined) {
        computed.push(attribute);
        answer = compute();
        byName.set(attribute, answer);
      }
      return answer;
    };
    const plan = prepare(withKinds({ "tree.node": treeNodeEvaluator({ cell }) }), box);
    ticks = 0;
    const first = plan.evaluate();
    expect(ticks).toBe(2);
    expect(first).toEqual(prepare(machine, box).evaluate());
    expect(computed.filter((attribute) => attribute.startsWith("[")).sort()).toEqual(['["height",{"width":100}]', '["height",{"width":200}]']);
    // The place of an instance has the keys of the node, but it is a second array.
    const instancePlace = places.get('["height",{"width":200}]');
    expect(instancePlace).toEqual(places.get("base"));
    expect(instancePlace).not.toBe(places.get("base"));
    // A second evaluation of the plan with kept cells computes nothing.
    computed.length = 0;
    ticks = 0;
    expect(plan.evaluate()).toEqual(first);
    expect([computed, ticks]).toEqual([[], 0]);
  });
});
