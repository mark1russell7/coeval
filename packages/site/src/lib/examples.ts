import type { Doc, World } from "@coeval/core";

/** The world of the ladder diagrams: three kinds and two defaults. */
export const LADDER_WORLD: World = {
  kinds: {
    rule: { verbs: { eval: "rule.eval", view: "rule.view" } },
    card: { verbs: { view: "card.view", check: "card.check" } },
    sequence: { verbs: { run: "sequence.run", check: "sequence.check" } },
  },
  defaults: { view: "json.view", check: "schema.check" },
};

/** The verbs that a reader can ask. */
export const VERBS = ["view", "eval", "check", "run"] as const;

/** A document of the ladder diagram, and the container that holds it. */
export interface LadderExample {
  readonly id: string;
  readonly label: string;
  readonly doc: Doc;
  /** The container of the document, and the kind that it declares for its items. */
  readonly container?: { readonly name: string; readonly kind: string };
}

/** The documents of the ladder diagram. */
export const LADDER_EXAMPLES: readonly LadderExample[] = [
  { id: "rule", label: "A rule", doc: { $kind: "rule", use: "stack", with: { gap: 8 } } },
  {
    id: "card",
    label: "A card in a list",
    doc: { title: "Notes", done: false },
    container: { name: "cards", kind: "card" },
  },
  {
    id: "sequence",
    label: "A sequence",
    doc: { $kind: "sequence", steps: [{ call: "store.find" }, { call: "store.patch" }] },
  },
  { id: "plain", label: "Plain data", doc: { width: 120, height: 80 } },
  { id: "typo", label: "A typo", doc: { $kind: "rul", use: "stack" } },
];

/**
 * This function finds a document of the ladder diagram by its ID. An unknown ID gives the first document.
 *
 * @param id - The ID of the document.
 * @returns The document and its container.
 */
export function ladderExample(id: string): LadderExample {
  const found = LADDER_EXAMPLES.find((item) => item.id === id) ?? LADDER_EXAMPLES[0];
  if (found === undefined) throw new Error("The ladder diagram has no documents.");
  return found;
}
