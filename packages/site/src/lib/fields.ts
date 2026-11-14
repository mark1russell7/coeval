import { docEquals, type Json } from "@mark1russell7/coeval";
import type { DataEditor } from "./contract.ts";

/*
 * The text of the fields of the structured editor (K274, D214). A field keeps the text that the reader types, and it
 * reads a value only from a complete text. The path field reads its text on blur or Enter. A number field reads a text
 * that is a number of the contract. No function here names a kind.
 */

/**
 * This function reads the keys of a path from a text. A comma separates two keys, and a key of digits is an index.
 *
 * @param text - The text.
 * @returns The keys. An empty key is not a key.
 */
export function keysOfText(text: string): readonly Json[] {
  return text
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key !== "")
    .map((key) => (/^\d+$/.test(key) ? Number(key) : key));
}

/** A text holds a step when `keysOfText` gives the same step back from the text of the step. */
function textHolds(step: Json): boolean {
  return (typeof step === "string" || typeof step === "number") && docEquals(keysOfText(String(step)), [step]);
}

/**
 * The state of the path field. A text holds each run of keys. A step that no text holds stands between two texts, for
 * example a step document. Thus `texts` has one item more than `steps`.
 */
export interface PathField {
  /** The path that the field holds. A text changes it only when the field reads the text. */
  readonly path: readonly Json[];
  /** The text of each run of keys, as the reader types it. */
  readonly texts: readonly string[];
  /** The steps that no text holds. The step with the index `i` stands after the text with the index `i`. */
  readonly steps: readonly Json[];
}

/**
 * This function gives the field of a path.
 *
 * @param path - The path.
 * @returns The field. Each text has a comma and a space between two keys.
 */
export function pathField(path: readonly Json[]): PathField {
  const texts: string[] = [];
  const steps: Json[] = [];
  let run: string[] = [];
  for (const step of path) {
    if (textHolds(step)) {
      run.push(String(step));
    } else {
      texts.push(run.join(", "));
      steps.push(step);
      run = [];
    }
  }
  texts.push(run.join(", "));
  return { path, texts, steps };
}

/**
 * This function keeps the text that the reader types into one text of the field. The path does not change.
 *
 * @param field - The field.
 * @param index - The index of the text.
 * @param text - The new text.
 * @returns The field with the new text.
 */
export function typePath(field: PathField, index: number, text: string): PathField {
  return { ...field, texts: field.texts.map((each, at) => (at === index ? text : each)) };
}

/**
 * This function reads the path from the texts and the steps of the field. The field calls it on blur or Enter.
 *
 * @param field - The field.
 * @returns The field of the path that it reads. Each step that no text holds stays at its place.
 */
export function readPath(field: PathField): PathField {
  return pathField(field.texts.flatMap((text, index) => (index < field.steps.length ? [...keysOfText(text), field.steps[index] as Json] : keysOfText(text))));
}

/**
 * This function removes one step that no text holds, and joins the two texts around it.
 *
 * @param field - The field.
 * @param index - The index of the step in `steps`.
 * @returns The field of the path without the step.
 */
export function dropStep(field: PathField, index: number): PathField {
  const joined = `${field.texts[index] ?? ""}, ${field.texts[index + 1] ?? ""}`;
  const texts = [...field.texts.slice(0, index), joined, ...field.texts.slice(index + 2)];
  return readPath({ path: field.path, texts, steps: field.steps.filter((_step, at) => at !== index) });
}

/**
 * This function follows a path from outside, for example after a click on a name. The same path keeps the text that
 * the reader types.
 *
 * @param field - The field.
 * @param path - The path that the document holds.
 * @returns The same field for the same path, or the field of the new path.
 */
export function followPath(field: PathField, path: readonly Json[]): PathField {
  return docEquals(field.path, path) ? field : pathField(path);
}

/** The editor of a number field. */
export type NumberEditor = Extract<DataEditor, { readonly form: "number" }>;

/** The state of a field of data: the value that the document holds, and the text that the reader types. */
export interface DataField {
  /** The value that the document holds. */
  readonly value: Json | undefined;
  /** The text of the input. */
  readonly text: string;
}

/**
 * This function gives the text of a value of data.
 *
 * @param value - The value.
 * @returns The text of a number or a text. Each other value gives an empty text.
 */
export function dataText(value: Json | undefined): string {
  return typeof value === "number" || typeof value === "string" ? String(value) : "";
}

/**
 * This function gives the field of a value of data.
 *
 * @param value - The value.
 * @returns The field with the text of the value.
 */
export function dataField(value: Json | undefined): DataField {
  return { value, text: dataText(value) };
}

/** A decimal number, as the number input of a browser gives it. */
const NUMBER_TEXT = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * This function reads a number from a text. The number must agree with the contract of the field.
 *
 * @param text - The text.
 * @param editor - The editor from the contract: a whole number, a least value and a largest value.
 * @returns The number, or `undefined` for an empty text, a text that is not a number, or a number that the contract
 *   refuses.
 */
export function numberOfText(text: string, editor: NumberEditor): number | undefined {
  const trimmed = text.trim();
  if (!NUMBER_TEXT.test(trimmed)) return undefined;
  const number = Number(trimmed);
  if (!Number.isFinite(number)) return undefined;
  if (editor.whole && !Number.isInteger(number)) return undefined;
  if (editor.min !== undefined && number < editor.min) return undefined;
  if (editor.max !== undefined && number > editor.max) return undefined;
  return number;
}

/**
 * This function keeps the text that the reader types into a number field. The value changes only when the text is a
 * number that the contract accepts. Thus an empty field stays empty, and the document keeps its last number.
 *
 * @param field - The field.
 * @param text - The new text.
 * @param editor - The editor from the contract.
 * @returns The field with the new text, and the new number when the text gives one.
 */
export function typeNumber(field: DataField, text: string, editor: NumberEditor): DataField {
  return { value: numberOfText(text, editor) ?? field.value, text };
}

/**
 * This function follows a value from outside. The same value keeps the text that the reader types.
 *
 * @param field - The field.
 * @param value - The value that the document holds.
 * @returns The same field for the same value, or the field of the new value.
 */
export function followData(field: DataField, value: Json | undefined): DataField {
  return docEquals(field.value, value) ? field : dataField(value);
}
