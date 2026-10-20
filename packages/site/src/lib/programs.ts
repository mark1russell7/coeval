import type { Json } from "@coeval/core";

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
    { type: "multiply", value: [{ type: "ref", value: "a" }, 10], name: "b" },
    { type: "log", value: [{ type: "ref", value: "b" }] },
  ],
};

/** A condition. Only the selected branch is evaluated, thus the log of the other branch does not happen. */
export const CHOICE: Json = {
  type: "if",
  value: {
    test: { type: "greater", value: [{ type: "ref", value: "size" }, 10] },
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
    { type: "log", value: [{ type: "ref", value: "total" }] },
  ],
};

/** An effect inside pure. pure gives its part no capability, thus the log fails with #CAP!. */
export const PURE: Json = { type: "pure", value: [{ type: "log", value: ["hello"] }] };

/** A reference to a name that the context does not have. */
export const MISSING: Json = { type: "add", value: [{ type: "ref", value: "price" }, 2] };

/** A document with values of each kind of data, each in its own envelope. */
export const VALUES: readonly Json[] = [
  { type: "number", value: 42 },
  { type: "text", value: "Notes" },
  { type: "bool", value: true },
  { type: "list", value: [1, 2, 3] },
];

/** The programs of the playground, in the order of its menu. */
export const PROGRAMS: readonly Program[] = [
  { id: "add", label: "Arithmetic", doc: ADD },
  { id: "names", label: "Names", doc: NAMES },
  { id: "choice", label: "A choice", doc: CHOICE, names: { size: 12 } },
  { id: "effects", label: "Effects", doc: EFFECTS },
  { id: "pure", label: "No capability", doc: PURE },
  { id: "missing", label: "A missing name", doc: MISSING },
];
