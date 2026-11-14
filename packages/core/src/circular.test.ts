import { describe, expect, it } from "vitest";
import {
  CIRCULAR_LIMIT,
  STD_CAPS,
  STD_MACHINE,
  agree,
  attributeGraph,
  check,
  circularOf,
  fail,
  makeContext,
  ok,
  prepare,
  reference,
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

/** The code of the kind `union`: the sorted texts of the lists of its parts, each text one time. */
const union: Evaluator = ({ parts }) => {
  const out = new Set<string>();
  for (const part of parts) {
    const result = part.evaluate();
    if (!result.ok) return result;
    if (!Array.isArray(result.value)) return fail("#VALUE!", "Each part of union is a list.");
    for (const item of result.value as readonly unknown[]) out.add(String(item));
  }
  return ok([...out].sort());
};

const withKinds = (kinds: Record<string, Kind>, evaluators: Record<string, Evaluator> = {}): Machine => ({
  ...STD_MACHINE,
  world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, union: { verbs: { eval: "set.union" }, parts: { shape: "list" }, pure: true }, ...kinds } },
  evaluators: { ...STD_MACHINE.evaluators, "set.union": union, ...evaluators },
});

const node = (type: string, value: Record<string, Json> = {}): Json => ({ type, value });
const list = (...items: Json[]): Json => ({ type: "list", value: items });
const path = (...steps: Json[]): Json => ({ type: "ref", value: steps });
const add = (...items: Json[]): Json => ({ type: "add", value: items });
const num = (value: number): Json => ({ type: "number", value });
const bool = (value: boolean): Json => ({ type: "bool", value });
const text = (value: string): Json => ({ type: "text", value });
const greater = (a: Json, b: Json): Json => ({ type: "greater", value: [a, b] });
const iff = (test: Json, then: Json, otherwise: Json): Json => ({ type: "if", value: { test, then, else: otherwise } });
const self = (...steps: Json[]): Json => path("self", ...steps);

/** The plan, the traced plan, a second evaluation and the reference give the same result, also the same reason. */
const agreed = (machine: Machine, doc: Json): Result => {
  const outcome = agree(machine, doc, makeContext({}, STD_CAPS), { strict: true });
  expect(outcome, outcome.ok ? "" : outcome.reason).toMatchObject({ ok: true });
  return outcome.ok ? outcome.result : fail("#N/A", "The tiers disagree.");
};

/** The width of the content: the width of the box, less 2 when the scrollbar is there. */
const inner = add(self("width"), iff(self("bar"), num(-2), num(0)));
/** The height of the content: narrow content is higher. */
const contentOf = (width: Json): Json => iff(greater(width, 9), num(11), num(14));

/**
 * The scrollbar example of R3 with one circular attribute. The scrollbar `bar` is there when the content is higher than
 * the box, and the content is higher when the scrollbar makes it narrower.
 */
const scrollOne = (limit?: number): Kind =>
  treeKind({
    equations: { bar: greater(contentOf(inner), self("height")), inner, content: contentOf(self("inner")) },
    attributes: { bar: { circular: limit === undefined ? { start: false } : { start: false, limit } } },
  });

/** The same example with a cycle of three circular attributes: bar, inner and content. */
const scrollThree = treeKind({
  equations: { bar: greater(self("content"), self("height")), inner, content: contentOf(self("inner")) },
  attributes: { bar: { circular: { start: false } }, inner: { circular: { start: 0 } }, content: { circular: { start: 0 } } },
});

/** A vertex of a graph: its own part `reach` is the union of its name and the reach of each successor. */
const vertex = treeKind({ attributes: { reach: { circular: { start: [] } } } });
const reachOf = (name: string, ...next: number[]): Json =>
  node("vertex", { name: text(name), reach: { type: "union", value: [list(text(name)), ...next.map((index) => self("parent", "children", index, "reach"))] } });
/** The graph a -> b -> c -> a, and c -> d. */
const vertices = (): Json => list(reachOf("a", 1), reachOf("b", 2), reachOf("c", 0, 3), reachOf("d"));

const machine = withKinds({
  scroll: scrollOne(),
  scroll2: scrollOne(2),
  scroll1: scrollOne(1),
  scroll3: scrollThree,
  vertex,
  graph: treeKind(),
  flip: treeKind({ equations: { on: iff(self("on"), bool(false), bool(true)) }, attributes: { on: { circular: { start: false, limit: 5 } } } }),
  flipping: treeKind({ equations: { on: iff(self("on"), bool(false), bool(true)) }, attributes: { on: { circular: { start: false } } } }),
  mix: treeKind({ attributes: { a: { circular: { start: 0 } } } }),
  both: treeKind({ attributes: { a: { circular: { start: 0 } }, b: { circular: { start: 0 } } } }),
});

describe("circular attributes (L2f, D113)", () => {
  it("[TREE.CIRCULAR] the scrollbar becomes stable in two rounds, and the reachable nodes of a loop give the least fixed point", () => {
    const box = (type: string): Json => node(type, { width: 10, height: 10, seen: list(self("bar"), self("inner"), self("content")) });
    // Round 1 reads the start false: the content is 10 wide and 11 high, thus the bar is there. Round 2 changes nothing.
    expect(agreed(machine, box("scroll"))).toEqual(ok({ width: 10, height: 10, seen: [true, 8, 14] }));
    expect(agreed(machine, box("scroll2"))).toEqual(ok({ width: 10, height: 10, seen: [true, 8, 14] }));
    // A wide box needs no scrollbar: round 1 gives the start value again.
    expect(agreed(machine, node("scroll1", { width: 30, height: 12, seen: self("bar") }))).toEqual(ok({ width: 30, height: 12, seen: false }));
    // Each node of the loop a, b, c reaches each node. The node d reaches only itself.
    const everything = ["a", "b", "c", "d"];
    expect(agreed(machine, node("graph", { children: vertices() }))).toEqual(
      ok({
        children: [
          { name: "a", reach: everything },
          { name: "b", reach: everything },
          { name: "c", reach: everything },
          { name: "d", reach: ["d"] },
        ],
      }),
    );
    expect(circularOf({ start: [] })).toEqual({ ok: true, start: [], limit: CIRCULAR_LIMIT });
  });

  it("[TREE.CIRCULAR-ORDER] another order of the demands gives the same values for monotone equations", () => {
    const orders: readonly (readonly string[])[] = [
      ["bar", "inner", "content"],
      ["content", "inner", "bar"],
      ["inner", "bar", "content"],
    ];
    const expected: Readonly<Record<string, Json>> = { bar: true, inner: 8, content: 14 };
    for (const order of orders) {
      // The attribute that the demand reaches first leads the fixed point.
      const doc = node("scroll3", { width: 10, height: 10, seen: list(...order.map((name) => self(name))) });
      expect(agreed(machine, doc), order.join(" ")).toEqual(ok({ width: 10, height: 10, seen: order.map((name) => expected[name] as Json) }));
    }
    // The graph gives the same reach when the fixed point starts at c, at d or at b.
    const reach = agreed(machine, node("graph", { children: vertices() }));
    for (const first of [2, 3, 1]) {
      const result = agreed(machine, node("graph", { first: self("children", first, "reach"), children: vertices() }));
      expect(result).toMatchObject({ ok: true, value: { children: reach.ok ? (reach.value as { readonly children: unknown }).children : [] } });
    }
  });

  it("[TREE.CIRCULAR-MIXED] a cycle with a plain attribute gives #CYCLE! in each order, and check finds it", () => {
    const docs: readonly Json[] = [node("mix", { a: self("b"), b: self("a") }), node("mix", { b: self("a"), a: self("b") })];
    const reasons = [
      "The attributes form a cycle: a of mix at [] -> b of mix at [] -> a of mix at [].",
      "The attributes form a cycle: b of mix at [] -> a of mix at [] -> b of mix at [].",
    ];
    docs.forEach((doc, index) => {
      const run = agreed(machine, doc);
      expect(run).toMatchObject({ ok: false, error: { code: "#CYCLE!", reason: reasons[index] } });
      if (run.ok) return;
      expect(check(machine, doc)).toEqual([{ code: "#CYCLE!", place: run.error.place, reason: run.error.reason, at: expect.any(Array) }]);
    });
  });

  it("[TREE.CIRCULAR-LIMIT] an equation that oscillates gives #CYCLE! at the limit, at the place of the leader", () => {
    expect(agreed(machine, node("flip", { seen: self("on") }))).toEqual(
      fail("#CYCLE!", "The cycle of the circular attribute on of flip at [] does not become stable within its limit of 5 rounds.", { place: [] }),
    );
    // Without a limit, the declaration gets the default limit.
    expect(agreed(machine, node("graph", { children: list(node("flipping", { seen: self("on") })) }))).toEqual(
      fail("#CYCLE!", `The cycle of the circular attribute on of flipping at [children, 0] does not become stable within its limit of ${CIRCULAR_LIMIT} rounds.`, {
        place: ["children", 0],
      }),
    );
    // The scrollbar needs two rounds, thus a limit of one round is too low.
    expect(agreed(machine, node("scroll1", { width: 10, height: 10, seen: self("bar") }))).toEqual(
      fail("#CYCLE!", "The cycle of the circular attribute bar of scroll1 at [] does not become stable within its limit of 1 round.", { place: [] }),
    );
  });

  it("[TREE.CIRCULAR-CHECK] check accepts a cycle of circular attributes, keeps the other cycles, and finds a bad declaration", () => {
    const both = node("both", { a: self("b"), b: self("a") });
    expect(agreed(machine, both)).toEqual(ok({ a: 0, b: 0 }));
    expect(check(machine, both)).toEqual([]);
    // The graph keeps the edges and the cycle, and it marks the cycle and its vertices circular.
    const graph = attributeGraph(machine, both);
    expect(graph.edges.map((e) => [e.from, e.to])).toEqual([
      [JSON.stringify(["b"]), JSON.stringify(["a"])],
      [JSON.stringify(["a"]), JSON.stringify(["b"])],
    ]);
    expect(graph.cycles).toEqual([{ vertices: expect.any(Array), certain: true, circular: true }]);
    expect([...graph.vertices.values()].map((v) => v.circular)).toEqual([true, true]);
    // A cycle with a plain attribute is not circular.
    expect(attributeGraph(machine, node("mix", { a: self("b"), b: self("a") })).cycles).toEqual([{ vertices: expect.any(Array), certain: true }]);
    expect(check(machine, node("scroll3", { width: 10, height: 10, seen: self("bar") }))).toEqual([]);
    expect(check(machine, node("graph", { children: vertices() }))).toEqual([]);
    // A declaration without a start value or with a bad limit is an issue of check, and the run gives #VALUE! at its demand.
    const bad = withKinds({
      bad: treeKind({
        equations: { a: 1, b: 1, c: 1, d: 1, e: 1 },
        attributes: {
          a: { circular: 5 as never },
          b: { circular: { limit: 2 } as never },
          c: { circular: { start: 0, limit: 0 } },
          d: { circular: { start: 0, limit: 1.5 } },
          e: { circular: { start: 0, limit: 3 } },
        },
      }),
    });
    const kindReason = (name: string, why: string): string => `The kind bad has a bad declaration tree.attributes.${name}.circular. ${why}`;
    const noStart = "The declaration circular needs a record with the field start.";
    const badLimit = "The limit of the declaration circular must be a whole number of 1 or more.";
    expect(check(bad, node("bad", { e: 2 })).map((issue) => [issue.code, issue.reason])).toEqual([
      ["#VALUE!", kindReason("a", noStart)],
      ["#VALUE!", kindReason("b", noStart)],
      ["#VALUE!", kindReason("c", badLimit)],
      ["#VALUE!", kindReason("d", badLimit)],
    ]);
    expect(agreed(bad, node("bad", { seen: self("c") }))).toMatchObject({
      ok: false,
      error: { code: "#VALUE!", reason: `The attribute c of bad at [] has a bad declaration circular. ${badLimit}` },
    });
    expect(circularOf({ start: () => 1 })).toEqual({ ok: false, reason: "The start value of the declaration circular must be JSON data." });
    expect(circularOf({ start: [Number.NaN] })).toMatchObject({ ok: false });
  });

  it("[TREE.CIRCULAR-CELL] the cells of a host keep only final values, and a second evaluation computes nothing", () => {
    const kept = new Map<readonly Key[], Map<string, AttributeAnswer>>();
    const written: [string, unknown][] = [];
    let computes = 0;
    const cell: AttributeCell = (place, attribute, compute) => {
      let byName = kept.get(place);
      if (byName === undefined) {
        byName = new Map();
        kept.set(place, byName);
      }
      let answer = byName.get(attribute);
      if (answer === undefined) {
        computes += 1;
        answer = compute();
        byName.set(attribute, answer);
        written.push([attribute, answer.result?.ok === true ? answer.result.value : answer.result]);
      }
      return answer;
    };
    const hosted = withKinds({ scroll3: scrollThree, vertex, graph: treeKind() }, { "tree.node": treeNodeEvaluator({ cell }) });
    for (const doc of [node("scroll3", { width: 10, height: 10, seen: list(self("bar"), self("inner"), self("content")) }), node("graph", { children: vertices() })]) {
      const plain = prepare(machine, doc).evaluate();
      const plan = prepare(hosted, doc);
      expect(plan.evaluate()).toEqual(plain);
      computes = 0;
      expect(plan.evaluate()).toEqual(plain);
      expect(computes).toBe(0);
    }
    // No cell holds an approximation: each value that a cell keeps is the final value.
    const finals: Readonly<Record<string, readonly Json[]>> = { bar: [true], inner: [8], content: [14], reach: [["a", "b", "c", "d"], ["d"]] };
    for (const [attribute, value] of written) {
      const allowed = finals[attribute];
      if (allowed !== undefined) expect(allowed, attribute).toContainEqual(value);
    }
    expect(written.filter(([attribute]) => attribute === "reach")).toHaveLength(4);
  });

  it("[TREE.CIRCULAR-CELL] a plain attribute of a node with a circular attribute takes the cell of the host, thus it climbs one time", () => {
    // The kind `tick` counts each evaluation of its part. The plain attribute `wide` reads it, and `double` reads `wide` two times.
    let ticks = 0;
    const tick: Evaluator = ({ parts }) => {
      ticks += 1;
      return parts[0]?.evaluate() ?? fail("#VALUE!", "The kind tick has one part.");
    };
    const kinds = {
      tick: { verbs: { eval: "test.tick" }, parts: { shape: "list" }, pure: true } satisfies Kind,
      mixed: treeKind({
        equations: { bar: greater(contentOf(inner), self("height")), inner, wide: { type: "tick", value: [add(self("width"), num(1))] }, double: add(self("wide"), self("wide")) },
        attributes: { bar: { circular: { start: false } } },
      }),
    };
    const kept = new Map<string, AttributeAnswer>();
    const computed: string[] = [];
    const cell: AttributeCell = (place, attribute, compute) => {
      const at = `${place.join(".")}:${attribute}`;
      let answer = kept.get(at);
      if (answer === undefined) {
        computed.push(attribute);
        answer = compute();
        kept.set(at, answer);
      }
      return answer;
    };
    const doc = node("mixed", { width: 10, height: 10, seen: list(self("bar"), self("double"), self("wide")) });
    const fresh = prepare(withKinds(kinds, { "test.tick": tick }), doc).evaluate();
    expect(fresh).toMatchObject({ ok: true, value: { seen: [true, 22, 11] } });
    expect(ticks).toBe(1);
    const plan = prepare(withKinds(kinds, { "test.tick": tick, "tree.node": treeNodeEvaluator({ cell }) }), doc);
    ticks = 0;
    expect(plan.evaluate()).toEqual(fresh);
    expect(ticks).toBe(1);
    expect(computed.filter((attribute) => attribute === "wide")).toHaveLength(1);
    // A second evaluation with the same cells is the same as a fresh evaluation, and it computes nothing.
    ticks = 0;
    computed.length = 0;
    expect(plan.evaluate()).toEqual(fresh);
    expect(ticks).toBe(0);
    expect(computed).toEqual([]);
  });
});

describe("one evaluation in each round of a fixed point (K265, D213)", () => {
  /** The number of evaluations of the kind `tick`. Its code counts each evaluation of its part. */
  let ticks = 0;
  const tickCode: Evaluator = ({ parts }) => {
    ticks += 1;
    return parts[0]?.evaluate() ?? fail("#VALUE!", "The kind tick has one part.");
  };
  const tick = (term: Json): Json => ({ type: "tick", value: [term] });
  const at = (attr: string, args: Record<string, Json>): Json => ({ type: ["tree", "at"], value: { attr, args } });
  const kinds: Record<string, Kind> = {
    tick: { verbs: { eval: "test.tick" }, parts: { shape: "list" }, pure: true },
    mix: treeKind({ attributes: { a: { circular: { start: 0 } } } }),
    // The instance `h` reads the circular attribute `a` of the child `c`, thus it reads an approximation. The instance `k` reads none.
    mixAt: treeKind({
      attributes: { a: { circular: { start: 0 } } },
      at: { h: { params: ["w"], equation: tick(add(self("c", "a"), path("names", "w"))) }, k: { params: ["w"], equation: tick(path("names", "w")) } },
    }),
  };
  const counted = withKinds(kinds, { "test.tick": tickCode });

  /** A cell of a host that keeps each answer, as in TREE.CELL. */
  const keepingCell = (): AttributeCell => {
    const kept = new Map<string, AttributeAnswer>();
    return (place, attribute, compute) => {
      const id = `${place.join(".")}:${attribute}`;
      let answer = kept.get(id);
      if (answer === undefined) {
        answer = compute();
        kept.set(id, answer);
      }
      return answer;
    };
  };

  /** The result and the ticks of the plan, and the ticks of the reference. The two tiers give the same result. */
  const ticksOf = (doc: Json): { readonly result: Result; readonly plan: number; readonly reference: number } => {
    ticks = 0;
    const result = prepare(counted, doc).evaluate();
    const plan = ticks;
    ticks = 0;
    expect(reference(counted, doc, makeContext({}, STD_CAPS))).toEqual(result);
    return { result, plan, reference: ticks };
  };

  /** The root `a` leads, and `p` and `r` read `q`. The attribute `q` reads the circular `a` of the child `c`, thus it is tentative. */
  const twoReaders = node("mix", { a: add(self("p"), self("r")), p: self("q"), r: self("q"), q: tick(self("c", "a")), c: node("mix", { a: 1 }) });

  it("[TREE.CIRCULAR-ONCE] a plain attribute with two readers evaluates one time in each round, in the plan and in the reference", () => {
    // Two rounds evaluate q one time each. After the fixed point, q evaluates one more time, because it read an approximation (D113).
    expect(ticksOf(twoReaders)).toEqual({ result: ok({ a: 2, p: 1, r: 1, q: 1, c: { a: 1 } }), plan: 3, reference: 3 });
    expect(agreed(counted, twoReaders)).toEqual(ok({ a: 2, p: 1, r: 1, q: 1, c: { a: 1 } }));
    // An instance of tree.at with two readers also evaluates one time in each round.
    const instance = node("mixAt", { a: add(self("p"), self("r")), p: self(at("h", { w: 1 })), r: self(at("h", { w: 1 })), c: node("mixAt", { a: 1 }) });
    expect(ticksOf(instance)).toEqual({ result: ok({ a: 4, p: 2, r: 2, c: { a: 1 } }), plan: 3, reference: 3 });
    expect(agreed(counted, instance)).toEqual(ok({ a: 4, p: 2, r: 2, c: { a: 1 } }));
  });

  it("[TREE.CIRCULAR-ONCE] with the cells of a host, the fixed point keeps a tentative answer for its round and a final instance for each round", () => {
    const hosted = (): Machine => withKinds(kinds, { "test.tick": tickCode, "tree.node": treeNodeEvaluator({ cell: keepingCell() }) });
    const plain = ticksOf(twoReaders);
    ticks = 0;
    expect(prepare(hosted(), twoReaders).evaluate()).toEqual(plain.result);
    expect(ticks).toBe(3);
    // The instance k reads no approximation. The fixed point keeps it until it ends, thus the two rounds evaluate it one time.
    const final = node("mixAt", { a: add(self(at("k", { w: 1 })), self(at("k", { w: 1 })), self("c", "a")), c: node("mixAt", { a: 1 }) });
    expect(ticksOf(final)).toEqual({ result: ok({ a: 3, c: { a: 1 } }), plan: 1, reference: 1 });
    ticks = 0;
    expect(prepare(hosted(), final).evaluate()).toEqual(ok({ a: 3, c: { a: 1 } }));
    expect(ticks).toBe(1);
  });

  /** The root `a` reads `p1`, each level reads the next level two times, and the last level reads the circular `a` of `c`. */
  const chainOf = (levels: number): Json => {
    const value: Record<string, Json> = { a: self("p1") };
    for (let level = 1; level < levels; level += 1) value[`p${level}`] = add(self(`p${level + 1}`), self(`p${level + 1}`));
    value[`p${levels}`] = tick(self("c", "a"));
    value["c"] = node("mix", { a: 1 });
    return node("mix", value);
  };

  it("[TREE.CIRCULAR-ONCE] a chain of tentative attributes with two readers at each level evaluates its last level one time in each round", () => {
    // Without the kept value of the round, p10 evaluates 2^9 times in each round.
    expect(ticksOf(chainOf(10))).toMatchObject({ result: { ok: true, value: { a: 2 ** 9, p1: 2 ** 9, p10: 1 } }, plan: 3, reference: 3 });
  });

  it("[TREE.CIRCULAR-ONCE] a chain of 40 levels ends in each tier, with its correct value", () => {
    const chain = chainOf(40);
    const outcome = ticksOf(chain);
    expect(outcome).toMatchObject({ result: { ok: true, value: { a: 2 ** 39, p1: 2 ** 39, p40: 1 } }, plan: 3, reference: 3 });
    expect(agreed(counted, chain)).toEqual(outcome.result);
  });
});
