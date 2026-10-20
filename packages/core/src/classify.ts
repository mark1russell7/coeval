import { type Envelope, type Json, field, isRecord, typed } from "./doc.ts";

/** A shape proposes a kind for each document that has all of its fields. */
export interface Shape {
  readonly name: string;
  readonly fields: readonly string[];
  readonly kind: string;
}

/** The result of a classification. */
export interface Classification {
  /** The kind of the one most specific shape. */
  readonly kind?: string;
  /** The names of the most specific shapes. */
  readonly candidates: readonly string[];
  /** `no-match`: no shape applies. `ambiguous`: two or more shapes match equally well. */
  readonly error?: "no-match" | "ambiguous";
}

function isStrictSuperset(larger: readonly string[], smaller: readonly string[]): boolean {
  return larger.length > smaller.length && smaller.every((name) => larger.includes(name));
}

/**
 * This function proposes a kind for a value without a type, from the fields that the value has.
 * A shape applies when the value has each field of the shape. The most specific shapes are the ones that
 * no other applicable shape contains. A host uses a classifier when data comes in, and then tags the data.
 * The ladder does not call a classifier.
 *
 * @param shapes - The shapes to examine.
 * @param value - The value without a type.
 * @returns The proposed kind, or an error with the candidates.
 */
export function classify(shapes: readonly Shape[], value: Json): Classification {
  const applicable = isRecord(value)
    ? shapes.filter((shape) => shape.fields.every((name) => field(value, name) !== undefined))
    : [];
  const best = applicable.filter((shape) => !applicable.some((other) => isStrictSuperset(other.fields, shape.fields)));
  const candidates = best.map((shape) => shape.name);
  const only = best.length === 1 ? best[0] : undefined;
  if (only !== undefined) return { kind: only.kind, candidates };
  return { candidates, error: best.length === 0 ? "no-match" : "ambiguous" };
}

/**
 * This function puts a value in an envelope with a type. The value does not change.
 *
 * @param value - The value.
 * @param kind - The name of the kind.
 * @returns The envelope.
 */
export function tag(value: Json, kind: string): Envelope {
  return typed(kind, value);
}
