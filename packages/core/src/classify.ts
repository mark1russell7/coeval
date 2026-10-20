import { KIND_KEY, field, type Doc } from "./doc.ts";

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
 * This function proposes a kind for a document that names no kind, from the fields that the document has.
 * A shape applies when the document has each field of the shape. The most specific shapes are the ones that
 * no other applicable shape contains. A host uses a classifier when data comes in, and then tags the data.
 * The ladder does not call a classifier.
 *
 * @param shapes - The shapes to examine.
 * @param doc - The document without a kind.
 * @returns The proposed kind, or an error with the candidates.
 */
export function classify(shapes: readonly Shape[], doc: Doc): Classification {
  const applicable = shapes.filter((shape) => shape.fields.every((name) => field(doc, name) !== undefined));
  const best = applicable.filter((shape) => !applicable.some((other) => isStrictSuperset(other.fields, shape.fields)));
  const candidates = best.map((shape) => shape.name);
  const only = best.length === 1 ? best[0] : undefined;
  if (only !== undefined) return { kind: only.kind, candidates };
  return { candidates, error: best.length === 0 ? "no-match" : "ambiguous" };
}

/**
 * This function gives a copy of a document with a kind. The original document does not change.
 *
 * @param doc - The document.
 * @param kind - The name of the kind.
 * @returns The tagged copy.
 */
export function tag(doc: Doc, kind: string): Doc {
  return { ...doc, [KIND_KEY]: kind };
}
