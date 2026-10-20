import { fromJson, typeName, type Json } from "@mark1russell7/coeval";
import { getAt, valueOf } from "./edit.ts";

/** A reference and the binding that it reads: two paths of one document. */
export interface Link {
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly name: string;
}

function walk(node: Json, path: readonly string[], visit: (node: Json, path: readonly string[]) => void): void {
  visit(node, path);
  const value = valueOf(node);
  if (Array.isArray(value)) (value as readonly Json[]).forEach((item, index) => walk(item, [...path, String(index)], visit));
  else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) walk(item, [...path, key], visit);
  }
}

/**
 * This function finds the binding that a reference reads. The move goes back from the reference to the nearest
 * earlier step with the name, in an enclosing sequence. A name of the root context has no binding in the document.
 *
 * @param root - The root document.
 * @param refPath - The path of the reference.
 * @param name - The first segment of the path of the reference.
 * @returns The path of the binding, or `undefined`.
 */
export function bindingOf(root: Json, refPath: readonly string[], name: string): readonly string[] | undefined {
  for (let depth = refPath.length - 1; depth >= 0; depth -= 1) {
    const ancestorPath = refPath.slice(0, depth);
    const ancestor = fromJson(getAt(root, ancestorPath));
    if (ancestor === undefined || typeName(ancestor.type) !== "seq" || !Array.isArray(ancestor.value)) continue;
    const index = Number(refPath[depth]);
    const items: readonly Json[] = ancestor.value;
    for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
      if (fromJson(items[earlier])?.name === name) return [...ancestorPath, String(earlier)];
    }
  }
  return undefined;
}

/**
 * This function lists each reference of a document with the binding that it reads.
 *
 * @param root - The root document.
 * @returns One link for each reference that reads a binding of the document.
 */
export function links(root: Json): readonly Link[] {
  const out: Link[] = [];
  walk(root, [], (node, path) => {
    const envelope = fromJson(node);
    if (envelope === undefined || typeName(envelope.type) !== "ref" || !Array.isArray(envelope.value)) return;
    const steps: readonly Json[] = envelope.value;
    if (steps[0] !== "names" || typeof steps[1] !== "string") return;
    const name = steps[1];
    const to = bindingOf(root, path, name);
    if (to !== undefined) out.push({ from: path, to, name });
  });
  return out;
}
