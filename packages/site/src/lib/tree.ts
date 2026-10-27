import type { Json } from "@mark1russell7/coeval";
import { refTraces } from "./moves.ts";

/** A node of the example tree, with its kind and its position in the drawing. */
export interface TreeNode {
  readonly id: string;
  readonly label: string;
  /** The kind of the node document. Both kinds are nodes of a decorated tree. */
  readonly type: "panel" | "box";
  readonly parent?: string;
  readonly x: number;
  readonly y: number;
}

/** The example tree: a page with a header and a list of three cards. */
export const TREE: readonly TreeNode[] = [
  { id: "page", label: "page", type: "panel", x: 280, y: 32 },
  { id: "header", label: "header", type: "panel", parent: "page", x: 140, y: 118 },
  { id: "list", label: "list", type: "panel", parent: "page", x: 420, y: 118 },
  { id: "title", label: "title", type: "box", parent: "header", x: 80, y: 204 },
  { id: "menu", label: "menu", type: "box", parent: "header", x: 200, y: 204 },
  { id: "a", label: "card a", type: "box", parent: "list", x: 340, y: 204 },
  { id: "b", label: "card b", type: "box", parent: "list", x: 420, y: 204 },
  { id: "c", label: "card c", type: "box", parent: "list", x: 500, y: 204 },
];

/** One move from a focus: a path from the root `self`, that the model resolves. */
export interface TreeMove {
  /** The text of the path after `self`. */
  readonly id: string;
  /** The steps of the path after `self`. */
  readonly path: readonly Json[];
}

/**
 * The moves of the example. Each move is a path that the kernel resolves. The kernel has no step for the siblings,
 * the ancestors, the descendants or the other nodes, thus the list has no such move.
 */
export const MOVES: readonly TreeMove[] = [
  { id: "parent", path: ["parent"] },
  { id: "parent.parent", path: ["parent", "parent"] },
  { id: "children", path: ["children"] },
  { id: "parent.children", path: ["parent", "children"] },
  { id: "nearest panel", path: [{ type: "nearest", value: { type: "panel" } }] },
];

/**
 * The key of the attribute of the focus that holds the reference of a move. A tree kind evaluates only its fields,
 * thus the reference uses the field `height`. No node of the example reads it.
 */
const GOAL = "height";

/** The example tree as a document, and the ID of the node at each place of the document. */
export interface TreeDoc {
  readonly doc: Json;
  /** The ID of each node, by its place. A place is its keys, joined with `/`. */
  readonly places: ReadonlyMap<string, string>;
  /** The place of the reference of the move. */
  readonly goal: readonly string[];
}

/**
 * This function builds the example tree as documents of the kinds `panel` and `box`. The attribute `height` of the
 * focus is a reference with the path of the move from `self`.
 *
 * @param focus - The ID of the focus node.
 * @param path - The steps of the path after `self`.
 * @returns The document, the place of each node, and the place of the reference.
 */
export function treeDoc(focus: string, path: readonly Json[]): TreeDoc {
  const places = new Map<string, string>();
  let goal: readonly string[] = [];
  const build = (item: TreeNode, place: readonly string[]): Json => {
    places.set(place.join("/"), item.id);
    const value: Record<string, Json> = {};
    const children = TREE.filter((child) => child.parent === item.id);
    if (children.length > 0) {
      value["children"] = { type: "list", value: children.map((child, index) => build(child, [...place, "children", String(index)])) };
    }
    if (item.id === focus) {
      value[GOAL] = { type: "ref", value: ["self", ...path] };
      goal = [...place, GOAL];
    }
    return { type: item.type, value };
  };
  const root = TREE.find((item) => item.parent === undefined);
  const doc = root === undefined ? null : build(root, []);
  return { doc, places, goal };
}

/** One arrow of a move: from one node to another node, with the text of its step. */
export interface TreeHop {
  readonly from: string;
  readonly to: string;
  readonly step: string;
}

/** The outcome of a move: the hops of the kernel, and the nodes that the path reaches. */
export interface MoveOutcome {
  /** `true` when the path reaches its end. */
  readonly ok: boolean;
  /** The arrows of the hops between nodes. A hop to the list `children` gives one arrow to each item. */
  readonly hops: readonly TreeHop[];
  /** The IDs of the nodes that the path reaches. A failed path reaches no node. */
  readonly targets: readonly string[];
  /** The code and the reason of the kernel, when the path fails. */
  readonly error?: { readonly code: string; readonly reason: string };
}

/**
 * This function resolves a move from a focus with the kernel. The kernel evaluates the tree, and its resolution of
 * the reference gives the hops (`resolve` with `hops: true`). The site does not walk the tree.
 *
 * @param focus - The ID of the focus node.
 * @param move - The move.
 * @returns The hops and the targets. A path that the kernel cannot resolve gives no targets.
 */
export function resolveMove(focus: string, move: TreeMove): MoveOutcome {
  const { doc, places, goal } = treeDoc(focus, move.path);
  const trace = refTraces(doc).find((item) => item.ref.join("/") === goal.join("/"));
  if (trace === undefined) return { ok: false, hops: [], targets: [] };
  // A place of a node gives that node. A place of a list `children` gives each item of the list.
  const nodesAt = (place: readonly string[]): readonly string[] => {
    const key = place.join("/");
    const id = places.get(key);
    if (id !== undefined) return [id];
    if (place[place.length - 1] !== "children") return [];
    const items: string[] = [];
    for (let index = 0; places.has(`${key}/${String(index)}`); index += 1) items.push(places.get(`${key}/${String(index)}`) as string);
    return items;
  };
  // A move from a list `children` starts at the node that holds the list.
  const ownerAt = (place: readonly string[]): string | undefined =>
    places.get(place.join("/")) ?? (place[place.length - 1] === "children" ? places.get(place.slice(0, -1).join("/")) : undefined);
  const hops: TreeHop[] = [];
  for (const step of trace.moves) {
    const from = ownerAt(step.from);
    // The first move goes from the reference to the focus. It is not an arrow between nodes.
    if (from === undefined) continue;
    for (const to of nodesAt(step.to)) hops.push({ from, to, step: step.step });
  }
  const ok = trace.ok && trace.placed;
  const last = trace.moves[trace.moves.length - 1];
  const outcome: MoveOutcome = { ok, hops, targets: ok && last !== undefined ? nodesAt(last.to) : [] };
  return trace.error === undefined ? outcome : { ...outcome, error: trace.error };
}
