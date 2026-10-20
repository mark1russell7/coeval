import { describe, expect, it } from "vitest";
import { STD_WORLD, typed, type Json } from "@mark1russell7/coeval";
import { appendAt, declaredAt, getAt, removeAt, setAt } from "./edit.ts";

const doc: Json = typed("add", [2, typed("multiply", [3, 4])]);

describe("editing by path", () => {
  it("finds a document through the values of envelopes", () => {
    expect(getAt(doc, ["1", "0"])).toBe(3);
    expect(getAt(doc, ["1"])).toEqual(typed("multiply", [3, 4]));
    expect(getAt(doc, ["5"])).toBeUndefined();
  });

  it("sets a document at a path, and keeps the original", () => {
    const changed = setAt(doc, ["1", "1"], 10);
    expect(getAt(changed, ["1", "1"])).toBe(10);
    expect(getAt(doc, ["1", "1"])).toBe(4);
  });

  it("removes and appends parts of a list", () => {
    expect(getAt(removeAt(doc, ["0"]), ["0"])).toEqual(typed("multiply", [3, 4]));
    expect(getAt(appendAt(doc, [], 9), ["2"])).toBe(9);
  });

  it("gives the type that a position declares", () => {
    expect(declaredAt(STD_WORLD, doc, ["0"])).toBe("number");
    expect(declaredAt(STD_WORLD, doc, [])).toBeUndefined();
  });
});
