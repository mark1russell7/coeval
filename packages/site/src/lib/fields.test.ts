import { describe, expect, it } from "vitest";
import { typed } from "@mark1russell7/coeval";
import { dataField, dropStep, followData, followPath, numberOfText, pathField, readPath, typeNumber, typePath, type NumberEditor, type PathField } from "./fields.ts";

/** The reader types a text one key at a time at the end of the text with this index. */
function typeKeys(field: PathField, index: number, keys: string): PathField {
  let now = field;
  for (const key of keys) now = typePath(now, index, `${now.texts[index] ?? ""}${key}`);
  return now;
}

const STEP = typed("nearest", { type: "panel" });

describe("the path field (K274)", () => {
  it("keeps a comma at the end while the reader types, and reads the name after it", () => {
    const typedText = typeKeys(pathField([]), 0, "names,a");
    expect(typedText.texts).toEqual(["names,a"]);
    expect(typedText.path).toEqual([]);
    const read = readPath(typedText);
    expect(read.path).toEqual(["names", "a"]);
    expect(read.texts).toEqual(["names, a"]);
  });

  it("keeps a step document when the reader types the keys after it", () => {
    const field = pathField(["self", STEP, "a"]);
    expect(field.texts).toEqual(["self", "a"]);
    expect(field.steps).toEqual([STEP]);
    expect(readPath(typeKeys(field, 1, ", b")).path).toEqual(["self", STEP, "a", "b"]);
  });

  it("keeps a key that no text gives back as a step of its own", () => {
    const path = ["self", "0", "a, b", 1.5, " x"];
    const field = pathField(path);
    expect(field.texts).toEqual(["self", "", "", "", ""]);
    expect(readPath(field).path).toEqual(path);
  });

  it("removes a step and joins the texts around it", () => {
    const field = dropStep(typeKeys(pathField(["self", STEP, "a"]), 0, ", b"), 0);
    expect(field.path).toEqual(["self", "b", "a"]);
    expect(field.texts).toEqual(["self, b, a"]);
    expect(field.steps).toEqual([]);
  });

  it("follows a new path from outside, and keeps the typed text for the same path", () => {
    const field = typeKeys(pathField(["self"]), 0, ", a,");
    expect(followPath(field, ["self"])).toBe(field);
    expect(followPath(field, ["names", "x"]).texts).toEqual(["names, x"]);
  });
});

describe("the number field (K274)", () => {
  const editor: NumberEditor = { form: "number", whole: false };

  it("stays empty while the reader types, and the document keeps its last number", () => {
    const empty = typeNumber(dataField(5), "", editor);
    expect(empty).toEqual({ value: 5, text: "" });
    expect(followData(empty, 5)).toBe(empty);
    expect(dataField(empty.value).text).toBe("5");
    expect(typeNumber(empty, "7", editor)).toEqual({ value: 7, text: "7" });
  });

  it("reads only a number that the contract admits", () => {
    const whole: NumberEditor = { form: "number", whole: true, min: 0, max: 10 };
    for (const text of ["", " ", "-", "2.5", "11", "-1", "1e400", "0x10"]) expect(numberOfText(text, whole)).toBeUndefined();
    expect(numberOfText(" 4 ", whole)).toBe(4);
    expect(numberOfText("2.5", editor)).toBe(2.5);
    expect(numberOfText("-1e3", editor)).toBe(-1000);
    expect(typeNumber(dataField(2), "2.5", whole)).toEqual({ value: 2, text: "2.5" });
  });
});
