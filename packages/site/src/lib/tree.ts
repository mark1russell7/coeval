/** A node of the example tree, with its position in the drawing. */
export interface TreeNode {
  readonly id: string;
  readonly label: string;
  readonly parent?: string;
  readonly x: number;
  readonly y: number;
}

/** The example tree: a page with a header and a list of three cards. */
export const TREE: readonly TreeNode[] = [
  { id: "page", label: "page", x: 280, y: 32 },
  { id: "header", label: "header", parent: "page", x: 140, y: 118 },
  { id: "list", label: "list", parent: "page", x: 420, y: 118 },
  { id: "title", label: "title", parent: "header", x: 80, y: 204 },
  { id: "menu", label: "menu", parent: "header", x: 200, y: 204 },
  { id: "a", label: "card a", parent: "list", x: 340, y: 204 },
  { id: "b", label: "card b", parent: "list", x: 420, y: 204 },
  { id: "c", label: "card c", parent: "list", x: 500, y: 204 },
];

/** The moves from a focus to other nodes of a tree. */
export const MOVES = ["parent", "children", "siblings", "ancestors", "descendants", "others"] as const;

/** One move. */
export type Move = (typeof MOVES)[number];

function node(id: string): TreeNode | undefined {
  return TREE.find((item) => item.id === id);
}

function childrenOf(id: string): readonly TreeNode[] {
  return TREE.filter((item) => item.parent === id);
}

/**
 * This function gives the targets of a move from a focus, in the order of the tree.
 *
 * @param focus - The ID of the focus node.
 * @param move - The move.
 * @returns The IDs of the targets. A root has no parent, thus the move `parent` gives no target there.
 */
export function targets(focus: string, move: Move): readonly string[] {
  const self = node(focus);
  if (self === undefined) return [];
  switch (move) {
    case "parent":
      return self.parent === undefined ? [] : [self.parent];
    case "children":
      return childrenOf(focus).map((item) => item.id);
    case "siblings":
      return self.parent === undefined
        ? []
        : childrenOf(self.parent)
            .map((item) => item.id)
            .filter((id) => id !== focus);
    case "ancestors": {
      const result: string[] = [];
      let at = self.parent;
      while (at !== undefined) {
        result.push(at);
        at = node(at)?.parent;
      }
      return result;
    }
    case "descendants": {
      const result: string[] = [];
      const visit = (id: string): void => {
        for (const child of childrenOf(id)) {
          result.push(child.id);
          visit(child.id);
        }
      };
      visit(focus);
      return result;
    }
    case "others":
      return TREE.map((item) => item.id).filter((id) => id !== focus);
  }
}
