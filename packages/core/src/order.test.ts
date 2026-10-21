import { describe, expect, it } from "vitest";
import { checkSteps, dataEdges, effectEdges, isAllowedOrder, layers, type StepSpec } from "./index.ts";

const steps: readonly StepSpec[] = [
  { id: "a", reads: [], effect: false },
  { id: "b", reads: [], effect: false },
  { id: "c", reads: ["a", "b"], effect: false },
  { id: "d", reads: [], effect: true },
  { id: "e", reads: ["c"], effect: true },
];

describe("order of a sequence", () => {
  it("[ORDER.EDGES] gives the data edges and the effect edges", () => {
    expect(dataEdges(steps)).toEqual([
      ["a", "c"],
      ["b", "c"],
      ["c", "e"],
    ]);
    expect(effectEdges(steps)).toEqual([["d", "e"]]);
  });

  it("[ORDER.ALLOWED] allows each order that obeys the edges", () => {
    expect(isAllowedOrder(steps, ["a", "b", "c", "d", "e"])).toBe(true);
    expect(isAllowedOrder(steps, ["d", "b", "a", "c", "e"])).toBe(true);
    expect(isAllowedOrder(steps, ["c", "a", "b", "d", "e"])).toBe(false);
    expect(isAllowedOrder(steps, ["a", "b", "c", "e", "d"])).toBe(false);
    expect(isAllowedOrder(steps, ["a", "b", "c", "d"])).toBe(false);
    expect(isAllowedOrder(steps, ["a", "a", "c", "d", "e"])).toBe(false);
  });

  it("[ORDER.LAYERS] puts independent steps in one layer", () => {
    expect(layers(steps)).toEqual([["a", "b", "d"], ["c"], ["e"]]);
  });

  it("[ORDER.CHECK] finds a read of a later step and a read of an unknown name", () => {
    expect(
      checkSteps([
        { id: "x", reads: ["y"], effect: false },
        { id: "y", reads: ["z"], effect: false },
      ]),
    ).toEqual([
      { step: "x", reads: "y", problem: "read-before-defined" },
      { step: "y", reads: "z", problem: "unknown-name" },
    ]);
  });
});
