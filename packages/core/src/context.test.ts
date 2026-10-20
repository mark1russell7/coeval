import { describe, expect, it } from "vitest";
import { CONSTRUCTS, PARTS, PART_INFO } from "./index.ts";

describe("context data", () => {
  it("describes each part one time, in order", () => {
    expect(PART_INFO.map((info) => info.part)).toEqual([...PARTS]);
  });

  it("gives no capability to the parts of a derive construct", () => {
    for (const construct of CONSTRUCTS.filter((item) => item.side === "derive")) {
      expect(construct.uses.caps.gives, construct.id).toBe("none");
    }
  });

  it("gives the parts of a run construct the same capabilities or fewer", () => {
    for (const construct of CONSTRUCTS.filter((item) => item.side === "run")) {
      expect(["same", "narrows"], construct.id).toContain(construct.uses.caps.gives);
    }
  });

  it("names a kind in each example", () => {
    for (const construct of CONSTRUCTS) expect(typeof construct.example["$kind"], construct.id).toBe("string");
  });
});
