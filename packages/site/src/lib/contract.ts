import { fail, fromJson, isAlias, isKind, isNamespace, kindNamed, typed, typeName, walk, type EvalFn, type Json, type Kind, type PartShape, type World, type WorldEntry } from "@mark1russell7/coeval";
import { getAt } from "./edit.ts";

/*
 * The structured editor of the playground (C11, D151). Each function here reads a contract of a kind. No function
 * names a kind, except the kinds `hole` and `ref`: a hole is the empty position, and the value of a ref is a path.
 */

/** The name of the kind of an empty position. */
export const HOLE_KIND = "hole";

/** The error code of an empty position. */
export const HOLE_CODE = "#HOLE";

/** The evaluator of a hole. It gives an error value, and the kernel adds its place. Thus each state of an edit evaluates. */
export const evalHole: EvalFn = () => fail(HOLE_CODE, "This place is empty. Select a kind for it.");

/**
 * This function gives a new empty position.
 *
 * @returns A document of the kind `hole`.
 */
export function newHole(): Json {
  return typed(HOLE_KIND, []);
}

/**
 * This function tells if a document is an empty position.
 *
 * @param doc - The document.
 * @returns `true` for a document of the kind `hole`.
 */
export function isHole(doc: Json | undefined): boolean {
  const envelope = fromJson(doc);
  return envelope !== undefined && typeName(envelope.type) === HOLE_KIND;
}

/** An input for data. A shape of a contract gives it. */
export type DataEditor =
  | { readonly form: "text" }
  | { readonly form: "number"; readonly whole: boolean; readonly min?: number; readonly max?: number }
  | { readonly form: "one"; readonly values: readonly Json[] };

/** One field of a record, from its contract. A field with `data` is an input. A field without it holds a document. */
export interface FieldEditor {
  readonly key: string;
  readonly required: boolean;
  readonly data?: DataEditor;
}

/** The editor of a value. Each form comes from the contract of the kind. */
export type Editor = DataEditor | { readonly form: "record"; readonly fields: readonly FieldEditor[] } | { readonly form: "list" } | { readonly form: "map" } | { readonly form: "term" } | { readonly form: "path" } | { readonly form: "none" };

function dataEditor(shape: PartShape | undefined): DataEditor | undefined {
  if (shape?.shape === "text") return { form: "text" };
  if (shape?.shape === "one") return { form: "one", values: shape.values };
  if (shape?.shape !== "number") return undefined;
  return { form: "number", whole: shape.whole === true, ...(shape.min === undefined ? {} : { min: shape.min }), ...(shape.max === undefined ? {} : { max: shape.max }) };
}

function fieldsOf(shape: Extract<PartShape, { readonly shape: "record" }>): readonly FieldEditor[] {
  const named: readonly (readonly [string, PartShape | undefined])[] = Array.isArray(shape.fields) ? (shape.fields as readonly string[]).map((key) => [key, undefined]) : Object.entries(shape.fields);
  return named.map(([key, field]) => {
    const data = dataEditor(field);
    return { key, required: shape.required?.includes(key) === true, ...(data === undefined ? {} : { data }) };
  });
}

/**
 * This function gives the editor of the value of a kind from its contract.
 *
 * @param world - The world.
 * @param type - The name of the kind.
 * @returns The editor. A kind without a contract gives the form `none`, and the JSON stays its editor.
 */
export function editorOf(world: World, type: string): Editor {
  const parts = kindNamed(world, type.includes(".") ? type.split(".") : type)?.parts;
  if (parts === undefined) return type === "ref" ? { form: "path" } : { form: "none" };
  const data = dataEditor(parts);
  if (data !== undefined) return data;
  if (parts.shape === "record") return { form: "record", fields: fieldsOf(parts) };
  if (parts.shape === "list" || parts.shape === "map" || parts.shape === "term") return { form: parts.shape };
  return { form: "none" };
}

function emptyData(editor: DataEditor): Json {
  if (editor.form === "text") return "";
  if (editor.form === "one") return editor.values[0] ?? null;
  const low = Math.max(editor.min ?? 0, 0);
  return editor.max === undefined ? low : Math.min(editor.max, low);
}

function emptyValue(editor: Editor): Json {
  switch (editor.form) {
    case "text":
    case "number":
    case "one":
      return emptyData(editor);
    case "record": {
      const fields = editor.fields.filter((field) => field.required).map((field) => [field.key, field.data === undefined ? newHole() : emptyData(field.data)]);
      return Object.fromEntries(fields) as Json;
    }
    case "list":
      return [];
    case "map":
      return {};
    case "term":
      return newHole();
    case "path":
      return ["names"];
    default:
      return null;
  }
}

/**
 * This function gives a new document of a kind from its contract alone. Each necessary position is a hole.
 *
 * @param world - The world.
 * @param kind - The name of the kind, with dots between the keys.
 * @returns The new document.
 */
export function emptyDoc(world: World, kind: string): Json {
  return typed(kind.includes(".") ? kind.split(".") : kind, emptyValue(editorOf(world, kind)));
}

function shapeAt(parts: PartShape | undefined, key: string): PartShape | undefined {
  if (parts === undefined) return undefined;
  if (parts.shape === "term") return parts;
  if (parts.shape === "list" || parts.shape === "map") return parts.item ?? { shape: "term", ...(parts.of === undefined ? {} : { of: parts.of }) };
  if (parts.shape !== "record") return undefined;
  const fields = parts.fields;
  if (!Array.isArray(fields) && Object.hasOwn(fields, key)) return (fields as Readonly<Record<string, PartShape>>)[key];
  return { shape: "term", ...(parts.of === undefined ? {} : { of: parts.of }) };
}

function entriesOf(kinds: Readonly<Record<string, WorldEntry>>, prefix: string): readonly string[] {
  return Object.entries(kinds).flatMap(([key, entry]) => {
    const name = `${prefix}${key}`;
    if (isKind(entry) || isAlias(entry)) return [name];
    return isNamespace(entry) ? entriesOf(entry.kinds, `${name}.`) : [];
  });
}

/** The names of each kind and alias of a world, with dots between the keys. */
function kindNames(world: World): readonly string[] {
  return entriesOf(world.kinds, "");
}

/**
 * This function lists the kinds that a position permits (SHAPE.KINDS). A hole is not on the list, because the button
 * that empties a position makes it. The kind `kind` is not on the list, because it has only a view.
 *
 * @param world - The world.
 * @param root - The root document.
 * @param path - The path of the position.
 * @returns The names of the kinds.
 */
export function kindsAt(world: World, root: Json, path: readonly string[]): readonly string[] {
  const parent = path.length === 0 ? undefined : fromJson(getAt(root, path.slice(0, -1)));
  const parts = parent === undefined ? undefined : (kindNamed(world, parent.type) as Kind | undefined)?.parts;
  const shape = shapeAt(parts, path.at(-1) ?? "");
  const permitted = shape?.shape === "term" ? shape.kinds : undefined;
  const names = kindNames(world).filter((name) => name !== HOLE_KIND && name !== "kind");
  if (permitted === undefined) return names;
  return names.filter((name) => permitted.some((keys) => name === keys.join(".") || name.startsWith(`${keys.join(".")}.`)));
}

/**
 * This function lists the names that the scope rules of a document bind at a position. It reads them from `walk`.
 *
 * @param world - The world.
 * @param root - The root document.
 * @param path - The path of the position.
 * @returns The names.
 */
export function namesAt(world: World, root: Json, path: readonly string[]): readonly string[] {
  const wanted = path.join("/");
  let found: readonly string[] = [];
  walk(world, root, (visit) => {
    if (visit.place.join("/") !== wanted) return undefined;
    found = visit.bound;
    return "skip";
  });
  return [...new Set(found)];
}
