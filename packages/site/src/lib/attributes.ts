import { STD_MACHINE, evaluate, flatten, isRecord, makeContext, type Json, type Result } from "@mark1russell7/coeval";

/*
 * The trees of the attribute diagram: a panel with one box. The model evaluates each tree as a decorated tree, and
 * the trace gives the order and the result of each attribute.
 */

const ref = (...steps: Json[]): Json => ({ type: "ref", value: steps });
const add = (a: Json, b: Json): Json => ({ type: "add", value: [a, b] });
const tree = (panel: { width: Json; height: Json }, box: { width: Json; height: Json }): Json => ({
  type: "panel",
  value: { ...panel, children: { type: "list", value: [{ type: "box", value: box }] } },
});

/** One tree of the diagram, with a note for the caption. */
export interface Scenario {
  readonly id: string;
  readonly label: string;
  readonly doc: Json;
  readonly note: string;
}

/** The trees that a reader can pick. */
export const SCENARIOS: readonly Scenario[] = [
  {
    id: "flow",
    label: "Down and up",
    doc: tree({ width: 300, height: add(ref("self", "children", 0, "height"), 20) }, { width: add(ref("self", "parent", "width"), -20), height: 40 }),
    note: "The width goes down: the box reads the width of its parent. The height goes up: the panel reads the height of its child. The height of the box evaluates before its width, because the panel asks for it first.",
  },
  {
    id: "cycle",
    label: "A cycle",
    doc: tree({ width: ref("self", "children", 0, "width"), height: 100 }, { width: ref("self", "parent", "width"), height: 40 }),
    note: "The width of the panel reads the width of the box, and the width of the box reads the width of the panel. The second read finds an attribute in evaluation, thus it gives #CYCLE! with the chain.",
  },
  {
    id: "error",
    label: "A failed attribute",
    doc: tree({ width: 300, height: add(ref("self", "children", 0, "height"), 20) }, { width: add(ref("self", "parent", "width"), -20), height: add(1, true) }),
    note: "The height of the box fails. The height of the panel reads it, and it gets the same error with the same place. Nothing reads the width of the box, thus it does not evaluate.",
  },
];

/** One attribute of the picture: a field of the panel or of the box. */
export interface Slot {
  readonly id: string;
  readonly node: "panel" | "box";
  readonly key: "width" | "height";
  /** The path of the attribute in the document, as the trace writes it. */
  readonly path: string;
  /** The text of the attribute in the reason of a cycle. */
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly right: number;
}

/** The four attributes of the picture, with their places in the drawing. */
export const SLOTS: readonly Slot[] = [
  { id: "panel.width", node: "panel", key: "width", path: "width", text: "width of panel at []", x: 62, y: 48, right: 306 },
  { id: "panel.height", node: "panel", key: "height", path: "height", text: "height of panel at []", x: 62, y: 88, right: 306 },
  { id: "box.width", node: "box", key: "width", path: "children/0/width", text: "width of box at [children, 0]", x: 66, y: 168, right: 296 },
  { id: "box.height", node: "box", key: "height", path: "children/0/height", text: "height of box at [children, 0]", x: 66, y: 208, right: 296 },
];

/** This function writes a formula for a reader: a path after `self`, a sum or a value. */
export function formulaText(doc: Json): string {
  if (isRecord(doc)) {
    const value = doc["value"];
    if (doc["type"] === "ref" && Array.isArray(value)) {
      return value.slice(1).reduce<string>((text, step) => (typeof step === "number" ? `${text}[${step}]` : text === "" ? String(step) : `${text}.${String(step)}`), "");
    }
    if (doc["type"] === "add" && Array.isArray(value) && value.length === 2) {
      const [a, b] = value as [Json, Json];
      return typeof b === "number" && b < 0 ? `${formulaText(a)} − ${-b}` : `${formulaText(a)} + ${formulaText(b)}`;
    }
  }
  return JSON.stringify(doc);
}

/** This function gives the attribute that a path from a node reaches, in the tree of one panel and one box. */
function target(from: Slot, path: readonly Json[]): Slot | undefined {
  let node: "panel" | "box" | undefined = from.node;
  const steps = path.slice(1);
  for (let index = 0; index < steps.length - 1; index += 1) {
    const step = steps[index];
    if (step === "parent") node = node === "box" ? "panel" : undefined;
    else if (step === "children" && steps[index + 1] === 0) {
      node = node === "panel" ? "box" : undefined;
      index += 1;
    }
  }
  const key = steps.at(-1);
  return SLOTS.find((slot) => slot.node === node && slot.key === key);
}

/** This function gives the paths of the references in a formula. */
function refsIn(doc: Json): readonly (readonly Json[])[] {
  if (Array.isArray(doc)) return (doc as readonly Json[]).flatMap(refsIn);
  if (!isRecord(doc)) return [];
  const value = doc["value"] ?? null;
  if (doc["type"] === "ref" && Array.isArray(value)) return [value as readonly Json[]];
  return refsIn(value);
}

/** This function gives the formula of an attribute in a tree of the diagram. */
export function formulaOf(doc: Json, slot: Slot): Json {
  const panel = (doc as { value: Record<string, Json> }).value;
  if (slot.node === "panel") return panel[slot.key] ?? null;
  const box = ((panel["children"] as { value: Json[] }).value[0] as { value: Record<string, Json> }).value;
  return box[slot.key] ?? null;
}

/** One read: the attribute `to` reads the attribute `from`. */
export interface Read {
  readonly from: Slot;
  readonly to: Slot;
}

/** What the model gives for one tree: the result of the root, and the order, the result and the reads of each attribute. */
export interface AttributeModel {
  readonly root: Result;
  readonly results: ReadonlyMap<string, Result>;
  readonly order: ReadonlyMap<string, number>;
  readonly reads: readonly Read[];
  /** The texts of the attributes in the chain of a cycle, from the reason of `#CYCLE!`. */
  readonly chain: readonly string[];
  /** The number of attributes that evaluated. */
  readonly total: number;
}

/**
 * This function evaluates a tree with the standard machine, and reads the trace. Each attribute that evaluated has one
 * node in the trace, thus the time of its start gives its order.
 *
 * @param doc - The tree.
 * @returns The model of the tree.
 */
export function attributeModel(doc: Json): AttributeModel {
  const out = evaluate(STD_MACHINE, doc, makeContext());
  const nodes = flatten(out.trace);
  const results = new Map<string, Result>();
  const order = new Map<string, number>();
  const evaluated = SLOTS.map((slot) => ({ slot, node: nodes.find((node) => node.path.join("/") === slot.path) }))
    .filter((item) => item.node !== undefined)
    .sort((a, b) => (a.node?.enter ?? 0) - (b.node?.enter ?? 0));
  evaluated.forEach((item, index) => {
    order.set(item.slot.id, index + 1);
    if (item.node !== undefined) results.set(item.slot.id, item.node.result);
  });
  const reads: Read[] = [];
  for (const slot of SLOTS) {
    for (const path of refsIn(formulaOf(doc, slot))) {
      const from = target(slot, path);
      if (from !== undefined) reads.push({ from, to: slot });
    }
  }
  const root = out.result;
  const chainText = !root.ok && root.error.code === "#CYCLE!" ? (/cycle: (.*)\.$/.exec(root.error.reason)?.[1] ?? "") : "";
  const chain = chainText === "" ? [] : chainText.split(" -> ");
  return { root, results, order, reads, chain, total: evaluated.length };
}
