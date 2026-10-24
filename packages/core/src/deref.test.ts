import { describe, expect, it } from "vitest";
import {
  STD_CAPS,
  STD_MACHINE,
  THING,
  agree,
  check,
  context,
  evaluate,
  fail,
  flatten,
  isHostThing,
  lookupKind,
  makeContext,
  nodeAt,
  ok,
  prepare,
  ref,
  resolve,
  typed,
  worldThing,
  type HostThing,
  type Json,
  type Key,
  type Machine,
  type Result,
  type Thing,
} from "./index.ts";

const run = (doc: Json, names: Record<string, Json> = {}) => evaluate(STD_MACHINE, doc, makeContext(names, STD_CAPS));

describe("resolve", () => {
  const ctx = context({ names: { cards: { ids: [7, 8] } }, world: worldThing(STD_MACHINE.world) });

  it("[DEREF.ROOT] starts at a root of the context, and goes into fields and items", () => {
    const found = resolve(STD_MACHINE, ctx, ["names", "cards", "ids", 1]);
    expect(found).toMatchObject({ ok: true, thing: 8 });
    if (found.ok) expect(found.hops.map((hop) => hop.by)).toEqual(["root", "default", "default", "default"]);
  });

  it("[DEREF.NO-ROOT] refuses a path without a root", () => {
    expect(resolve(STD_MACHINE, ctx, ["cards", "ids"])).toMatchObject({ ok: false, code: "#REF!" });
  });

  it("[DEREF.MISS] gives #N/A for a step that reaches nothing, with the hops before it", () => {
    const found = resolve(STD_MACHINE, ctx, ["names", "cards", "count"]);
    expect(found).toMatchObject({ ok: false, code: "#N/A" });
    expect(found.hops).toHaveLength(2);
  });

  it("[DEREF.COLLAPSE] follows a reference that a step reaches (collapse)", () => {
    const aliasCtx = context({ names: { alias: ref("names", "real"), real: 42 } });
    const found = resolve(STD_MACHINE, aliasCtx, ["names", "alias"]);
    expect(found).toMatchObject({ ok: true, thing: 42 });
    if (found.ok) expect(found.hops.some((hop) => hop.by === "collapse")).toBe(true);
  });

  it("[DEREF.CYCLE] stops a cycle of references with #CYCLE!", () => {
    const loop = context({ names: { a: ref("names", "b"), b: ref("names", "a") } });
    expect(resolve(STD_MACHINE, loop, ["names", "a"])).toMatchObject({ ok: false, code: "#CYCLE!" });
  });

  it("[DEREF.HOST] lets a host thing answer its own steps", () => {
    const thing: HostThing = {
      [THING]: true,
      label: "counter",
      deref: (key: Key): Thing | undefined => (key === "double" ? 84 : undefined),
      toJson: () => 42,
    };
    expect(resolve(STD_MACHINE, context({ self: thing }), ["self", "double"])).toMatchObject({ ok: true, thing: 84 });
  });

  it("[WORLD.WALK] walks the world, and follows an alias of a namespace", () => {
    expect(resolve(STD_MACHINE, ctx, ["world", "math", "sum", "verbs", "eval"])).toMatchObject({ ok: true, thing: "math.add" });
  });
});

describe("types are references into the world", () => {
  it("[WORLD.ALIAS] finds a kind by a path, and follows an alias", () => {
    const found = lookupKind(STD_MACHINE.world, ["math", "sum"]);
    expect(found).toMatchObject({ ok: true, path: ["add"], aliases: 1 });
  });

  it("[WORLD.ALIAS-EVAL] evaluates a document whose type is a path to an alias", () => {
    expect(run(typed(["math", "product"], [6, 7])).result).toEqual({ ok: true, value: 42 });
  });

  it("[WORLD.EXPANDED] accepts the expanded form of a type", () => {
    expect(run(typed({ type: "ref", value: ["world", "add"] }, [1, 2])).result).toEqual({ ok: true, value: 3 });
  });

  it("[WORLD.NO-KIND] gives #KIND? for a path that reaches no kind", () => {
    expect(run(typed(["math", "nope"], [1])).result).toMatchObject({ ok: false, error: { code: "#KIND?" } });
  });
});

describe("trees: self, parent and nearest", () => {
  const tree: Json = {
    type: "panel",
    value: {
      width: 300,
      children: {
        type: "list",
        value: [
          {
            type: "box",
            value: {
              width: { type: "add", value: [{ type: "ref", value: ["self", "parent", "width"] }, -20] },
              children: {
                type: "list",
                value: [
                  {
                    type: "box",
                    value: {
                      width: {
                        type: "ref",
                        value: ["self", "parent", { type: "nearest", value: { type: "panel" } }, "width"],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    },
  };

  it("[TREE.PARENT] reads the parent through the field parent, as any other field", () => {
    const out = run(tree);
    expect(out.result.ok).toBe(true);
    if (out.result.ok) {
      const panel = out.result.value as { children: { width: number; children: { width: number }[] }[] };
      expect(panel.children[0]?.width).toBe(280);
      expect(panel.children[0]?.children[0]?.width).toBe(300);
    }
  });

  it("[TREE.NEAREST-SELF] starts a nearest walk at the node itself with self: true", () => {
    const inner = (step: Json): Json => ({
      type: "panel",
      value: {
        width: 300,
        children: {
          type: "list",
          value: [{ type: "panel", value: { width: { type: "ref", value: ["self", "parent", step, "width"] } } }],
        },
      },
    });
    const widthOf = (step: Json): Json | undefined => {
      const out = run(inner(step));
      return out.result.ok ? (out.result.value as { children: { width: Json }[] }).children[0]?.width : undefined;
    };
    expect(widthOf({ type: "nearest", value: { type: "panel", self: true } })).toBe(300);
    expect(run(inner({ type: "nearest", value: { type: "panel" } })).result).toMatchObject({ ok: false, error: { code: "#N/A" } });
  });

  it("[TREE.ONCE] evaluates a field of a node only one time, also when two readers ask", () => {
    const out = run(tree);
    // The JSON of the panel reads its width, and the first box reads it again.
    const widthEvaluations = flatten(out.trace).filter((node) => node.path.join("/") === "width");
    expect(widthEvaluations).toHaveLength(1);
  });
});

describe("the decorated tree", () => {
  /** A machine with a kind `count`: its evaluator counts its evaluations and gives the count. */
  const counted = (): { readonly machine: Machine; readonly count: () => number } => {
    let count = 0;
    const machine: Machine = {
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, count: { verbs: { eval: "test.count" } } } },
      evaluators: {
        ...STD_MACHINE.evaluators,
        "test.count": () => {
          count += 1;
          return ok(count);
        },
      },
    };
    return { machine, count: () => count };
  };
  const box = (value: Record<string, Json>): Json => ({ type: "box", value });
  const panel = (value: Record<string, Json>): Json => ({ type: "panel", value });
  const children = (...items: Json[]): Json => ({ type: "list", value: items });
  const path = (...steps: Json[]): Json => ({ type: "ref", value: steps });
  /** The plan, the traced plan, a second evaluation and the reference give the same result, also the same reason. */
  const agreed = (machine: Machine, doc: Json, caps: readonly string[] = STD_CAPS): Result => {
    const outcome = agree(machine, doc, makeContext({}, caps), { strict: true });
    expect(outcome, outcome.ok ? "" : outcome.reason).toMatchObject({ ok: true });
    return outcome.ok ? outcome.result : fail("#N/A", "The tiers disagree.");
  };

  it("[TREE.LAZY] a node in an open tree gives its host thing, and an attribute that nothing reads does not evaluate", () => {
    const { machine, count } = counted();
    // add gets the thing of the box, not a number. Thus the width of the box does not evaluate.
    const unread = panel({ width: { type: "add", value: [box({ width: { type: "count", value: null } }), 1] } });
    expect(agreed(machine, unread)).toMatchObject({ ok: false, error: { code: "#VALUE!", place: ["width"], reason: "Part 0 of add is not a number." } });
    expect(count()).toBe(0);
    const out = evaluate(machine, panel({ children: children(box({ width: 1 })) }), makeContext());
    const thing = nodeAt(out.trace, ["children", 0])?.result;
    expect(thing?.ok === true && isHostThing(thing.value)).toBe(true);
    expect(out.result).toEqual(ok({ children: [{ width: 1 }] }));
  });

  it("[TREE.SIBLING] a node reads an attribute of a sibling through its parent, before or after the sibling", () => {
    const doc = panel({
      children: children(
        box({ width: path("self", "parent", "children", 1, "width") }),
        box({ width: 120 }),
        box({ width: { type: "add", value: [path("self", "parent", "children", 0, "width"), 10] } }),
      ),
    });
    expect(agreed(STD_MACHINE, doc)).toEqual(ok({ children: [{ width: 120 }, { width: 120 }, { width: 130 }] }));
  });

  it("[TREE.CYCLE] a demand that reaches an attribute in evaluation gives #CYCLE!, with the chain of attributes", () => {
    expect(agreed(STD_MACHINE, panel({ width: path("self", "width") }))).toEqual(
      fail("#CYCLE!", "The attributes form a cycle: width of panel at [] -> width of panel at [].", { place: ["width"] }),
    );
    const chain = panel({ width: path("self", "children", 0, "width"), children: children(box({ width: path("self", "parent", "width") })) });
    expect(agreed(STD_MACHINE, chain)).toEqual(
      fail("#CYCLE!", "The attributes form a cycle: width of panel at [] -> width of box at [children, 0] -> width of panel at [].", {
        place: ["children", 0, "width"],
      }),
    );
    // The value of a node is its JSON, thus a reference to the node itself reads each of its attributes.
    expect(agreed(STD_MACHINE, panel({ width: 1, height: path("self") }))).toEqual(
      fail("#CYCLE!", "The attributes form a cycle: height of panel at [] -> height of panel at [].", { place: ["height"] }),
    );
  });

  it("[TREE.ERROR] a reference to a failed attribute gives the error of the attribute: its code, reason, place and cause", () => {
    const failed = agreed(STD_MACHINE, panel({ height: path("self", "width"), width: { type: "add", value: [1, true] } }));
    expect(failed).toEqual(fail("#VALUE!", "The value must be a number.", { place: ["width", 1] }));
    const boom = new Error("boom");
    const machine: Machine = {
      ...STD_MACHINE,
      world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, boom: { verbs: { eval: "test.boom" } } } },
      evaluators: {
        ...STD_MACHINE.evaluators,
        "test.boom": () => {
          throw boom;
        },
      },
    };
    const doc = panel({ children: children(box({ width: path("self", "parent", "children", 1, "width") }), box({ width: { type: "boom", value: null } })) });
    const result = agreed(machine, doc);
    expect(result).toMatchObject({ ok: false, error: { code: "#CALC!", place: ["children", 1, "width"], reason: "The evaluator test.boom threw: Error: boom" } });
    expect(result.ok ? undefined : result.error.cause).toBe(boom);
  });

  it("[TREE.MEMO] each node keeps one memo for each attribute, for one evaluation", () => {
    const { machine, count } = counted();
    const doc = panel({
      width: { type: "count", value: null },
      children: children(box({ width: path("self", "parent", "width"), height: { type: "count", value: null } }), box({ width: path("self", "parent", "width") })),
    });
    const plan = prepare(machine, doc);
    expect(plan.evaluate()).toEqual(ok({ width: 1, children: [{ width: 1, height: 2 }, { width: 1 }] }));
    expect(count()).toBe(2);
    // A second evaluation makes new nodes with new memos. Nothing stays between two evaluations.
    expect(plan.evaluate()).toEqual(ok({ width: 3, children: [{ width: 3, height: 4 }, { width: 3 }] }));
    expect(count()).toBe(4);
  });

  it("[TREE.PURE] an attribute causes no effect: an effect in it gives #CAP!, and check finds it", () => {
    const doc = panel({ width: { type: "log", value: ["x"] } });
    expect(agreed(STD_MACHINE, doc)).toMatchObject({ ok: false, error: { code: "#CAP!", place: ["width"] } });
    expect(check(STD_MACHINE, doc, { caps: STD_CAPS })).toMatchObject([{ code: "#CAP!", place: ["width"] }]);
  });

  it("[TREE.RESULT] the root gives the JSON of the tree, and a node in a value gives its JSON there", () => {
    const doc = panel({
      width: 10,
      height: { type: "list", value: [box({ width: 2 }), { type: "if", value: { test: { type: "bool", value: true }, then: box({ height: path("self", "parent", "width") }) } }] },
    });
    expect(agreed(STD_MACHINE, doc)).toEqual(ok({ width: 10, height: [{ width: 2 }, { height: 10 }] }));
    // A node of a closed tree is the root of a new tree. Its reads see the finished attributes.
    const first = prepare(STD_MACHINE, box({ children: children(box({ width: 3 })) }));
    expect(first.evaluate()).toEqual(ok({ children: [{ width: 3 }] }));
  });
});

describe("sequences bind last", () => {
  it("[SEQ.LAST] gives the result of the step before under the name last", () => {
    const out = run({
      type: "seq",
      value: [{ type: "number", value: 4 }, { type: "multiply", value: [{ type: "ref", value: ["names", "last"] }, 10] }],
    });
    expect(out.result).toEqual({ ok: true, value: 40 });
  });
});
