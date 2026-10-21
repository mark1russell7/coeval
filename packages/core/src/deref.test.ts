import { describe, expect, it } from "vitest";
import {
  STD_CAPS,
  STD_MACHINE,
  THING,
  context,
  evaluate,
  lookupKind,
  makeContext,
  ref,
  resolve,
  typed,
  worldThing,
  type HostThing,
  type Json,
  type Key,
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
    const widthEvaluations = out.trace.children.filter((child) => child.path.at(-1) === "width");
    expect(widthEvaluations).toHaveLength(1);
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
