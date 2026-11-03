import { describe, expect, it } from "vitest";
import { type StepKey, type StepWalk, checkStep, isStep, random, stepLadder, stepOf, stepRank } from "./index.ts";

/** A small language for the tests: a node has a kind and child nodes in a list or in fields. */
interface Node {
  readonly kind?: string;
  readonly kids?: readonly Node[];
  readonly fields?: Readonly<Record<string, Node>>;
}

const walk: StepWalk<Node> = {
  construct: (n) => n.kind,
  children: (n) => [...(n.kids ?? []).map((k, i): readonly [StepKey, Node] => [i, k]), ...Object.entries(n.fields ?? {})],
};

const ladder = stepLadder(["A", "B", "C"], { lit: "A", loop: "A", until: "B", fix: "B", rec: "C" });
const node = (kind: string | undefined, ...kids: Node[]): Node => (kind === undefined ? { kids } : { kind, kids });

describe("the steps of a language", () => {
  it("[STEPS.LADDER] a ladder keeps its steps in order and checks its declaration", () => {
    expect(ladder.steps).toEqual(["A", "B", "C"]);
    expect(ladder.constructs).toEqual({ lit: "A", loop: "A", until: "B", fix: "B", rec: "C" });
    expect(Object.isFrozen(ladder) && Object.isFrozen(ladder.steps) && Object.isFrozen(ladder.constructs)).toBe(true);
    expect(stepRank(ladder, "A")).toBe(0);
    expect(stepRank(ladder, "C")).toBe(2);
    expect(isStep(ladder, "B")).toBe(true);
    expect(isStep(ladder, "D")).toBe(false);
    expect(isStep(ladder, 1)).toBe(false);
    expect(isStep(ladder, undefined)).toBe(false);
    expect(() => stepLadder([], {})).toThrow(new TypeError("a ladder of steps needs one step or more"));
    expect(() => stepLadder(["A", "B", "A"], {})).toThrow(new TypeError('the step "A" is in the ladder two times'));
    expect(() => stepLadder(["A", 2 as unknown as string], {})).toThrow(new TypeError("the step 2 is not a name"));
    expect(() => stepLadder(["A", "B"], { loop: "Z" as "A" })).toThrow(new TypeError('the construct "loop" needs the step "Z", which is not a step of the ladder'));
    expect(() => stepRank(ladder, "Z" as "A")).toThrow(new TypeError('"Z" is not a step of the ladder. The steps are A, B, C'));
    // The ladder copies its declaration, thus a later change of the arrays of the language does not change it.
    const steps = ["A", "B"];
    const copy = stepLadder(steps, {});
    steps.push("C");
    expect(copy.steps).toEqual(["A", "B"]);
  });

  it("[STEPS.LOWEST] the step of a document is the highest step of its constructs", () => {
    expect(stepOf(ladder, walk, node("lit"))).toEqual({ step: "A" });
    expect(stepOf(ladder, walk, node(undefined))).toEqual({ step: "A" });
    expect(stepOf(ladder, walk, node("loop", node("lit"), node("loop", node("lit"))))).toEqual({ step: "A" });
    expect(stepOf(ladder, walk, node("loop", node("lit"), node("until"))).step).toBe("B");
    expect(stepOf(ladder, walk, node("loop", node("until"), node("loop", node("rec")))).step).toBe("C");
    // A construct without an entry needs the lowest step, also a name of the prototype of an object.
    expect(stepOf(ladder, walk, node("other", node("toString"), node("constructor")))).toEqual({ step: "A" });
    // A ladder with one step gives that step to each document.
    expect(stepOf(stepLadder(["only"], {}), walk, node("rec"))).toEqual({ step: "only" });
  });

  it("[STEPS.REASON] the reason is the first node in document order with the step, with its construct and its path", () => {
    const fix = node("fix");
    const doc: Node = { kind: "loop", kids: [node("lit"), node("loop", node("lit"), fix)], fields: { tail: node("until") } };
    expect(stepOf(ladder, walk, doc)).toEqual({ step: "B", reason: { construct: "fix", step: "B", path: [1, 1], node: fix } });
    // A field is a key of the path. The root has the empty path.
    const rec = node("rec");
    expect(stepOf(ladder, walk, { kind: "lit", fields: { body: { fields: { inner: rec } } } }).reason).toEqual({ construct: "rec", step: "C", path: ["body", "inner"], node: rec });
    const root = node("until", node("rec"));
    expect(stepOf(ladder, walk, node("fix")).reason?.path).toEqual([]);
    // The walk stops at the first node of the highest step, thus a later node of that step is not the reason.
    expect(stepOf(ladder, walk, node("lit", root, node("rec"))).reason?.path).toEqual([0, 0]);
    // A higher step replaces the reason of a lower step.
    expect(stepOf(ladder, walk, node("lit", node("until"), node("rec"))).reason?.path).toEqual([1]);
  });

  it("[STEPS.MAX] a host refuses a document above its highest step, and the refusal names the needed step", () => {
    const fix = node("fix");
    const need = stepOf(ladder, walk, node("loop", node("lit"), fix));
    expect(checkStep(ladder, need, "B")).toBeUndefined();
    expect(checkStep(ladder, need, "C")).toBeUndefined();
    expect(checkStep(ladder, need, "A")).toEqual({
      needed: "B",
      maxStep: "A",
      reason: { construct: "fix", step: "B", path: [1], node: fix },
      message: 'the document needs the step B, and the host accepts the steps up to A. The construct "fix" at the path [1] needs the step B',
    });
    expect(checkStep(ladder, stepOf(ladder, walk, node("rec")), "B")?.message).toBe('the document needs the step C, and the host accepts the steps up to B. The construct "rec" at the root needs the step C');
    expect(checkStep(ladder, stepOf(ladder, walk, node("lit")), "A")).toBeUndefined();
    // A need that a host makes itself can have no reason.
    expect(checkStep(ladder, { step: "C" }, "A")).toEqual({ needed: "C", maxStep: "A", message: "the document needs the step C, and the host accepts the steps up to A" });
    expect(() => checkStep(ladder, need, "D" as "A")).toThrow(TypeError);
    expect(() => checkStep(ladder, { step: "D" as "A" }, "A")).toThrow(TypeError);
  });

  it("[STEPS.MAX] on random documents, the step and the reason are those of a recursive reference, and a limit accepts each step up to it", () => {
    const kinds = ["lit", "loop", "until", "fix", "rec", "other", undefined];
    const rng = random(20261103);
    const gen = (depth: number): Node => {
      const kind = rng.pick(kinds);
      const n = depth === 0 ? 0 : rng.int(4);
      const kids = Array.from({ length: n }, () => gen(depth - 1));
      return kind === undefined ? { kids } : { kind, kids };
    };
    /** The reference: the rank of each node in pre-order, by recursion. */
    const ranks = (n: Node, path: readonly StepKey[], out: { rank: number; path: readonly StepKey[] }[]): void => {
      const step = n.kind === undefined ? undefined : (ladder.constructs as Record<string, "A" | "B" | "C" | undefined>)[n.kind];
      out.push({ rank: step === undefined || !Object.hasOwn(ladder.constructs, n.kind as string) ? 0 : stepRank(ladder, step), path });
      (n.kids ?? []).forEach((k, i) => ranks(k, [...path, i], out));
    };
    for (let i = 0; i < 300; i++) {
      const doc = gen(5);
      const all: { rank: number; path: readonly StepKey[] }[] = [];
      ranks(doc, [], all);
      const best = Math.max(...all.map((r) => r.rank));
      const need = stepOf(ladder, walk, doc);
      expect(need.step).toBe(ladder.steps[best]);
      expect(need.reason?.path).toEqual(best === 0 ? undefined : all.find((r) => r.rank === best)?.path);
      for (const max of ladder.steps) expect(checkStep(ladder, need, max) === undefined).toBe(stepRank(ladder, max) >= best);
    }
  });

  it("[STEPS.LINEAR] the walk has its own stack and visits a shared node one time", () => {
    // A chain of 100000 nodes does not overflow the stack of the engine.
    let chain: Node = node("rec");
    for (let i = 0; i < 100_000; i++) chain = node("lit", chain);
    const deep = stepOf(ladder, walk, chain);
    expect(deep.step).toBe("C");
    expect(deep.reason?.path).toHaveLength(100_000);
    // A shared node: 40 levels of two references to one node is 2^40 paths, but only 41 nodes.
    let calls = 0;
    const counted: StepWalk<Node> = { construct: (n) => (calls++, n.kind), children: walk.children };
    let dag: Node = node("lit");
    for (let i = 0; i < 40; i++) dag = node("loop", dag, dag);
    expect(stepOf(ladder, counted, dag)).toEqual({ step: "A" });
    expect(calls).toBe(41);
    // A node that is not an object has no identity, so each of its places is a visit.
    const leaves: StepWalk<string> = { construct: (s) => s, children: (s) => (s === "loop" ? [[0, "lit"], [1, "until"]] : []) };
    expect(stepOf(ladder, leaves, "loop")).toEqual({ step: "B", reason: { construct: "until", step: "B", path: [1], node: "until" } });
  });
});
