import { describe, expect, it } from "vitest";
import { targets } from "./tree.ts";

describe("moves in the example tree", () => {
  it("finds the parent, the children and the siblings", () => {
    expect(targets("b", "parent")).toEqual(["list"]);
    expect(targets("list", "children")).toEqual(["a", "b", "c"]);
    expect(targets("b", "siblings")).toEqual(["a", "c"]);
  });

  it("finds the ancestors from the nearest, and the descendants in tree order", () => {
    expect(targets("a", "ancestors")).toEqual(["list", "page"]);
    expect(targets("page", "descendants")).toEqual(["header", "title", "menu", "list", "a", "b", "c"]);
  });

  it("gives no parent and no siblings for the root", () => {
    expect(targets("page", "parent")).toEqual([]);
    expect(targets("page", "siblings")).toEqual([]);
  });

  it("gives each other node for others", () => {
    expect(targets("menu", "others")).toHaveLength(7);
  });
});
