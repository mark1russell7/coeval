import { describe, expect, it } from "vitest";
import { sourcesOf, type ProfileNode } from "./chain-memory.ts";
import { allocated, callMemory, exposedGc } from "./memory.ts";

const gc = exposedGc();

describe("the memory of one call (K116)", () => {
  it("counts the bytes of a kept array, and the bytes of garbage that a collection frees", () => {
    let kept: number[] = [];
    const memory = callMemory(gc, () => {
      kept = Array.from({ length: 1_000_000 }, (_, index) => index + 0.5);
    });
    // An array of 1000000 doubles holds at least 8 MB.
    expect(memory.allocated).toBeGreaterThan(8_000_000);
    expect(memory.peak).toBeGreaterThanOrEqual(memory.grown);
    expect(kept.length).toBe(1_000_000);
    const garbage = callMemory(gc, () => {
      for (let index = 0; index < 200; index += 1) void Array.from({ length: 10_000 }, () => ({ index }));
    });
    expect(garbage.collections).toBeGreaterThan(0);
    expect(garbage.freed).toBeGreaterThan(0);
    expect(allocated(gc, () => 0)).toBeLessThan(1_000_000);
  });
});

/** This function gives a node of a profile. */
function node(functionName: string, selfSize: number, children: ProfileNode[] = [], url = "/a/schedule.ts", lineNumber = 9): ProfileNode {
  return { callFrame: { functionName, url, lineNumber }, selfSize, children };
}

describe("the sources of a heap profile (K116)", () => {
  it("adds the self size of each frame of one function, and gives the largest first with its share", () => {
    const head = node("(root)", 0, [node("visit", 30, [node("visit", 10)]), node("read", 50), node("", 10, [], "", 0), node("load", 0, [], "/a/b.ts", 0)]);
    const { total, sources } = sourcesOf(head, 2);
    expect(total).toBe(100);
    expect(sources).toEqual([
      { name: "read schedule.ts:10", bytes: 50, share: 0.5 },
      { name: "visit schedule.ts:10", bytes: 40, share: 0.4 },
    ]);
    expect(sourcesOf(head, 5).sources.at(-1)).toEqual({ name: "(anonymous) (native)", bytes: 10, share: 0.1 });
    // A frame with the line 0 gets no line, as the loader of tsx gives it.
    expect(sourcesOf(node("(root)", 0, [node("load", 4, [], "/a/b.ts", 0)]), 1).sources[0]?.name).toBe("load b.ts");
  });
});
