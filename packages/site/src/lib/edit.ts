import { fromJson, isRecord, kindNamed, typed, type Json, type World } from "@mark1russell7/coeval";

/**
 * This function gives the value inside a document: the value of an envelope, or the bare value itself.
 *
 * @param node - The document.
 * @returns The value.
 */
export function valueOf(node: Json): Json {
  const envelope = fromJson(node);
  return envelope === undefined ? node : envelope.value;
}

/**
 * This function finds the document at a path. Each key goes into the value of the document before it.
 *
 * @param root - The root document.
 * @param path - The keys from the root.
 * @returns The document, or `undefined`.
 */
export function getAt(root: Json, path: readonly string[]): Json | undefined {
  let at: Json | undefined = root;
  for (const key of path) {
    if (at === undefined) return undefined;
    const value: Json = valueOf(at);
    if (Array.isArray(value)) at = (value as readonly Json[])[Number(key)];
    else if (isRecord(value)) at = Object.hasOwn(value, key) ? value[key] : undefined;
    else return undefined;
  }
  return at;
}

function withValue(node: Json, value: Json): Json {
  const envelope = fromJson(node);
  return envelope === undefined ? value : { ...envelope, value };
}

/**
 * This function gives a copy of the root with a new document at a path. The original does not change.
 *
 * @param root - The root document.
 * @param path - The keys from the root.
 * @param item - The new document.
 * @returns The new root.
 */
export function setAt(root: Json, path: readonly string[], item: Json): Json {
  const [key, ...rest] = path;
  if (key === undefined) return item;
  const value = valueOf(root);
  if (Array.isArray(value)) {
    const copy = [...(value as readonly Json[])];
    const index = Number(key);
    copy[index] = setAt(copy[index] ?? null, rest, item);
    return withValue(root, copy);
  }
  if (isRecord(value)) return withValue(root, { ...value, [key]: setAt(value[key] ?? null, rest, item) });
  return root;
}

/**
 * This function removes the document at a path from the list that holds it.
 *
 * @param root - The root document.
 * @param path - The keys from the root. The last key must be an index of a list.
 * @returns The new root. A path outside a list gives the root without a change.
 */
export function removeAt(root: Json, path: readonly string[]): Json {
  const parentPath = path.slice(0, -1);
  const key = path.at(-1);
  const parent = getAt(root, parentPath);
  if (parent === undefined || key === undefined) return root;
  const value = valueOf(parent);
  if (!Array.isArray(value)) return root;
  const copy = (value as readonly Json[]).filter((_item, index) => index !== Number(key));
  return setAt(root, parentPath, withValue(parent, copy));
}

/**
 * This function adds a part at the end of the list of the document at a path.
 *
 * @param root - The root document.
 * @param path - The path of the document with a list value.
 * @param item - The new part.
 * @returns The new root.
 */
export function appendAt(root: Json, path: readonly string[], item: Json): Json {
  const node = getAt(root, path);
  if (node === undefined) return root;
  const value = valueOf(node);
  if (!Array.isArray(value)) return root;
  return setAt(root, path, withValue(node, [...(value as readonly Json[]), item]));
}

/**
 * This function gives the type that the position of a path declares: the `of` of the kind of its parent.
 *
 * @param world - The world.
 * @param root - The root document.
 * @param path - The path.
 * @returns The declared type, or `undefined`.
 */
export function declaredAt(world: World, root: Json, path: readonly string[]): string | undefined {
  if (path.length === 0) return undefined;
  const parent = fromJson(getAt(root, path.slice(0, -1)));
  if (parent === undefined) return undefined;
  const parts = kindNamed(world, parent.type)?.parts;
  return parts === undefined || parts.shape === "none" ? undefined : parts.of;
}

/**
 * This function gives a new document of a kind, with a small value that obeys the contract of the kind.
 *
 * @param kind - The name of the kind.
 * @returns The new document.
 */
export function newDoc(kind: string): Json {
  switch (kind) {
    case "number":
      return typed("number", 1);
    case "text":
      return typed("text", "hello");
    case "bool":
      return typed("bool", true);
    case "add":
    case "multiply":
      return typed(kind, [1, 2]);
    case "greater":
      return typed("greater", [3, 2]);
    case "list":
      return typed("list", [typed("number", 1), typed("text", "two")]);
    case "if":
      return typed("if", { test: typed("bool", true), then: typed("text", "yes"), else: typed("text", "no") });
    case "ref":
      return typed("ref", ["names", "a"]);
    case "seq":
      return typed("seq", [typed("number", 1, { name: "a" }), typed("ref", ["names", "a"])]);
    case "pure":
      return typed("pure", [typed("number", 1)]);
    case "log":
      return typed("log", ["hello"]);
    case "write":
      return typed("write", { key: "x", value: typed("number", 1) });
    default:
      return typed(kind, null);
  }
}

/**
 * This function gives a new part for a document with a list value. The part is a bare value of the declared
 * type, or else a number in an envelope.
 *
 * @param world - The world.
 * @param kind - The kind of the document that gets the part.
 * @returns The new part.
 */
export function newPart(world: World, kind: string): Json {
  const parts = kindNamed(world, kind)?.parts;
  const of = parts !== undefined && parts.shape === "list" ? parts.of : undefined;
  if (of === "number") return 1;
  if (of === "text") return "more";
  return typed("number", 1);
}
