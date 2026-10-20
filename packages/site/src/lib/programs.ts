import type { Json } from "@mark1russell7/coeval";

/** A document of the examples, with a label for a picker. */
export interface Program {
  readonly id: string;
  readonly label: string;
  readonly doc: Json;
  readonly names?: Readonly<Record<string, Json>>;
  readonly caps?: readonly string[];
}

/** Two plus three times four. The bare numbers get their type from the lists of add and multiply. */
export const ADD: Json = { type: "add", value: [2, { type: "multiply", value: [3, 4] }] };

/** Three steps with names. The second step reads the first step, and the third step logs the second. */
export const NAMES: Json = {
  type: "seq",
  value: [
    { type: "add", value: [1, 2], name: "a" },
    { type: "multiply", value: [{ type: "ref", value: ["names", "a"] }, 10], name: "b" },
    { type: "log", value: [{ type: "ref", value: ["names", "b"] }] },
  ],
};

/** A condition. Only the selected branch is evaluated, thus the log of the other branch does not happen. */
export const CHOICE: Json = {
  type: "if",
  value: {
    test: { type: "greater", value: [{ type: "ref", value: ["names", "size"] }, 10] },
    then: { type: "text", value: "big" },
    else: { type: "log", value: ["small"] },
  },
};

/** Three effects in a sequence. They happen in the written order. */
export const EFFECTS: Json = {
  type: "seq",
  value: [
    { type: "log", value: ["start"] },
    { type: "write", value: { key: "total", value: { type: "add", value: [2, 3] } }, name: "total" },
    { type: "log", value: [{ type: "ref", value: ["names", "total"] }] },
  ],
};

/** An effect inside pure. pure gives its part no capability, thus the log fails with #CAP!. */
export const PURE: Json = { type: "pure", value: [{ type: "log", value: ["hello"] }] };

/** A reference to a name that the context does not have. */
export const MISSING: Json = { type: "add", value: [{ type: "ref", value: ["names", "price"] }, 2] };

/** A document with values of each kind of data, each in its own envelope. */
export const VALUES: readonly Json[] = [
  { type: "number", value: 42 },
  { type: "text", value: "Notes" },
  { type: "bool", value: true },
  { type: "list", value: [1, 2, 3] },
];

/** A tree of nodes. A box reads the width of its parent, and the inner box reads the nearest panel. */
export const TREE: Json = {
  type: "panel",
  value: {
    width: 300,
    children: {
      type: "list",
      value: [
        {
          type: "box",
          value: {
            width: { type: "add", value: [{ type: "ref", value: ["self", "parent", "width"] }, -20] },
            children: {
              type: "list",
              value: [
                {
                  type: "box",
                  value: {
                    width: { type: "ref", value: ["self", "parent", { type: "nearest", value: { type: "panel" } }, "width"] },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  },
};

/** A type that is a path: the alias math.product of the kind multiply. */
export const ALIAS: Json = { type: ["math", "product"], value: [6, 7] };

/** The programs of the playground, in the order of its menu. */
export const PROGRAMS: readonly Program[] = [
  { id: "add", label: "Arithmetic", doc: ADD },
  { id: "names", label: "Names", doc: NAMES },
  { id: "choice", label: "A choice", doc: CHOICE, names: { size: 12 } },
  { id: "effects", label: "Effects", doc: EFFECTS },
  { id: "pure", label: "No capability", doc: PURE },
  { id: "missing", label: "A missing name", doc: MISSING },
  { id: "tree", label: "A tree", doc: TREE },
  { id: "alias", label: "A type as a path", doc: ALIAS },
];
