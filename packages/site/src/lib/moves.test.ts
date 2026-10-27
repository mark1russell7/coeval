import { describe, expect, it } from "vitest";
import type { Json } from "@mark1russell7/coeval";
import { moveLinks, refTraces, stepText } from "./moves.ts";
import { NAMES, TREE } from "./programs.ts";

const ref = (...steps: Json[]): Json => ({ type: "ref", value: steps });

describe("the moves of the paths", () => {
  it("draws each hop of a path up a tree, and the nearest panel", () => {
    const moves = moveLinks(TREE);
    const outer = ["children", "0"];
    const inner = ["children", "0", "children", "0"];
    expect(moves.map((move) => [move.step, move.from.join("/"), move.to.join("/")])).toEqual([
      ["self", "children/0/width/0", outer.join("/")],
      ["parent", outer.join("/"), ""],
      ["width", "", "width"],
      ["self", "children/0/children/0/width", inner.join("/")],
      ["parent", inner.join("/"), outer.join("/")],
      ["nearest panel", outer.join("/"), ""],
      ["width", "", "width"],
    ]);
    expect(moves.filter((move) => move.ref.join("/") === "children/0/width/0").map((move) => move.index)).toEqual([0, 1, 2]);
  });

  it("follows a named child and an item of a list", () => {
    const doc: Json = {
      type: "panel",
      value: {
        width: ref("self", "children", 0, "width"),
        children: { type: "list", value: [{ type: "box", value: { width: 40 } }] },
      },
    };
    expect(moveLinks(doc).map((move) => [move.step, move.to.join("/")])).toEqual([
      ["self", ""],
      ["children", "children"],
      ["0", "children/0"],
      ["width", "children/0/width"],
    ]);
  });

  it("gives no moves for a path from the root names", () => {
    expect(moveLinks(NAMES)).toEqual([]);
  });

  it("stops at a step that reaches no place of the document", () => {
    const doc: Json = { type: "panel", value: { width: 10, height: ref("self", "type") } };
    expect(moveLinks(doc).map((move) => move.step)).toEqual(["self"]);
  });
});

describe("the traces of the references", () => {
  it("gives the moves and the outcome of each reference", () => {
    const doc: Json = { type: "panel", value: { width: 10, height: ref("self", "width") } };
    const [trace] = refTraces(doc);
    expect(trace?.ref).toEqual(["height"]);
    expect(trace?.path).toEqual(["self", "width"]);
    expect(trace?.ok).toBe(true);
    expect(trace?.placed).toBe(true);
    expect(trace?.error).toBeUndefined();
    expect(trace?.moves.map((move) => move.step)).toEqual(["self", "width"]);
  });

  it("gives the error of a failed resolution", () => {
    const doc: Json = { type: "panel", value: { width: 10, height: ref("self", "depth") } };
    const [trace] = refTraces(doc);
    expect(trace?.ok).toBe(false);
    expect(trace?.error?.code).toMatch(/^#/);
    expect(trace?.moves.map((move) => move.step)).toEqual(["self"]);
  });

  it("marks a trace whose hop reaches no place of the document", () => {
    const doc: Json = { type: "panel", value: { width: 10, height: ref("self", "type") } };
    const [trace] = refTraces(doc);
    expect(trace?.ok).toBe(true);
    expect(trace?.placed).toBe(false);
  });
});

describe("the text of a step", () => {
  it("gives a key, or the kind of a step document and its type", () => {
    expect(stepText("parent")).toBe("parent");
    expect(stepText(0)).toBe("0");
    expect(stepText({ type: "nearest", value: { type: "panel" } })).toBe("nearest panel");
  });
});
