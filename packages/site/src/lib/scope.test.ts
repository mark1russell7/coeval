import { describe, expect, it } from "vitest";
import { links } from "./scope.ts";
import { NAMES } from "./programs.ts";

describe("references and their bindings", () => {
  it("links each reference to the earlier step with its name", () => {
    expect(links(NAMES)).toEqual([
      { from: ["1", "0"], to: ["0"], name: "a" },
      { from: ["2", "0"], to: ["1"], name: "b" },
    ]);
  });

  it("does not link a reference to a later step", () => {
    const doc = { type: "seq", value: [{ type: "ref", value: "x" }, { type: "number", value: 1, name: "x" }] };
    expect(links(doc)).toEqual([]);
  });

  it("finds the binding in an outer sequence", () => {
    const doc = {
      type: "seq",
      value: [
        { type: "number", value: 2, name: "n" },
        { type: "seq", value: [{ type: "ref", value: "n" }] },
      ],
    };
    expect(links(doc)).toEqual([{ from: ["1", "0"], to: ["0"], name: "n" }]);
  });
});
