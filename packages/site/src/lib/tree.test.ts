import { describe, expect, it } from "vitest";
import { MOVES, resolveMove, treeDoc, type TreeMove } from "./tree.ts";

const move = (id: string): TreeMove => {
  const found = MOVES.find((item) => item.id === id);
  if (found === undefined) throw new Error(`No move ${id}.`);
  return found;
};

describe("the example tree as documents", () => {
  it("gives each node a place, and puts the reference on the focus", () => {
    const { places, goal } = treeDoc("b", ["parent"]);
    expect(places.get("")).toBe("page");
    expect(places.get("children/1")).toBe("list");
    expect(places.get("children/1/children/1")).toBe("b");
    expect(goal).toEqual(["children", "1", "children", "1", "height"]);
  });
});

describe("the moves of the kernel", () => {
  it("finds the parent and the parent of the parent, one hop for each step", () => {
    expect(resolveMove("b", move("parent"))).toEqual({ ok: true, hops: [{ from: "b", to: "list", step: "parent" }], targets: ["list"] });
    const outcome = resolveMove("b", move("parent.parent"));
    expect(outcome.hops).toEqual([
      { from: "b", to: "list", step: "parent" },
      { from: "list", to: "page", step: "parent" },
    ]);
    expect(outcome.targets).toEqual(["page"]);
  });

  it("finds the children, and the children of the parent with the focus among them", () => {
    expect(resolveMove("list", move("children")).targets).toEqual(["a", "b", "c"]);
    const outcome = resolveMove("b", move("parent.children"));
    expect(outcome.targets).toEqual(["a", "b", "c"]);
    expect(outcome.hops.map((hop) => `${hop.from}>${hop.to}:${hop.step}`)).toEqual(["b>list:parent", "list>a:children", "list>b:children", "list>c:children"]);
  });

  it("finds the nearest panel with one hop", () => {
    expect(resolveMove("title", move("nearest panel"))).toEqual({
      ok: true,
      hops: [{ from: "title", to: "header", step: "nearest panel" }],
      targets: ["header"],
    });
    expect(resolveMove("header", move("nearest panel")).targets).toEqual(["page"]);
  });

  it("gives no target when a step reaches no node", () => {
    const root = resolveMove("page", move("parent"));
    expect(root.ok).toBe(false);
    expect(root.targets).toEqual([]);
    expect(root.hops).toEqual([]);
    const leaf = resolveMove("a", move("children"));
    expect(leaf.ok).toBe(false);
    expect(leaf.targets).toEqual([]);
  });
});
