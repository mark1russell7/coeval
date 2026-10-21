import type { Envelope } from "./doc.ts";
import type { Side } from "./ladder.ts";

/** The parts of a context. A term can reach outside itself only through these parts. */
export const PARTS = ["self", "names", "world", "event", "caps"] as const;

/** One part of a context. */
export type Part = (typeof PARTS)[number];

/** The description of one part of a context. */
export interface PartInfo {
  readonly part: Part;
  readonly title: string;
  /** What a reference through this part reaches. */
  readonly reaches: string;
  /** The direction in which a reference through this part goes. */
  readonly direction: string;
}

/** The descriptions of the parts, in the order of `PARTS`. */
export const PART_INFO: readonly PartInfo[] = [
  {
    part: "self",
    title: "Self",
    reaches: "A position in a structure: the node itself, its parent, its children or its siblings.",
    direction: "Any direction that a move permits: up, down or to the side.",
  },
  {
    part: "names",
    title: "Names",
    reaches: "The values that a binding gives: a let, a parameter, or the result of an earlier step.",
    direction: "Back, to the place where the program binds the name.",
  },

  {
    part: "world",
    title: "World",
    reaches: "The stored documents and collections, by an absolute ID or by a query.",
    direction: "Out, to the store.",
  },
  {
    part: "event",
    title: "Event",
    reaches: "The trigger of a run: the event and its values.",
    direction: "From the past, to the run that the event starts.",
  },
  {
    part: "caps",
    title: "Capabilities",
    reaches: "The effects that a term can cause. A part of the term gets the same set or a smaller set.",
    direction: "Down, and only smaller.",
  },
];

/**
 * What a construct gives the parts of its body, for one part of the context.
 *
 * - `same`: the parts get the same value.
 * - `extends`: the parts get the value with more names.
 * - `moves`: the parts get a new position.
 * - `narrows`: the parts get a smaller set.
 * - `sets`: the parts get a new value.
 * - `none`: the parts get nothing.
 */
export type Give = "same" | "extends" | "moves" | "narrows" | "sets" | "none";

/** How a construct uses one part of the context. */
export interface Use {
  readonly reads: boolean;
  readonly gives: Give;
  readonly note: string;
}

/** A construct of a language, and how it uses each part of the context. */
export interface Construct {
  readonly id: string;
  readonly title: string;
  readonly side: Side;
  readonly summary: string;
  readonly example: Envelope;
  readonly uses: Readonly<Record<Part, Use>>;
}

const NONE: Use = { reads: false, gives: "none", note: "It does not use this part." };

/** Six constructs that show the range of the context. */
export const CONSTRUCTS: readonly Construct[] = [
  {
    id: "formula",
    title: "Formula",
    side: "derive",
    summary: "A pure formula that gives a value at one position of a structure.",
    example: {
      type: "let",
      value: {
        bind: { gap: 8 },
        body: { type: ["ops", "add"], value: [{ type: "ref", value: ["self", "parent", "width"] }, { type: "ref", value: ["names", "gap"] }] },
      },
    },
    uses: {
      names: { reads: true, gives: "extends", note: "A let binds names for its body." },
      self: { reads: true, gives: "moves", note: "A move reads the parent. An axis moves self to each target." },
      world: NONE,
      event: NONE,
      caps: { reads: false, gives: "none", note: "A formula causes no effect, thus its parts get no capability." },
    },
  },
  {
    id: "sequence",
    title: "Sequence",
    side: "run",
    summary: "A list of steps. A step can read the result of each earlier step by its name.",
    example: {
      type: "seq",
      value: [
        { type: ["store", "find"], value: { match: { board: "b1" } }, name: "cards" },
        { type: ["store", "patch"], value: { ids: { type: "ref", value: ["names", "cards", "ids"] }, set: { done: true } } },
      ],
    },
    uses: {
      names: { reads: true, gives: "extends", note: "The result of each step is a name for the later steps." },
      self: NONE,
      world: { reads: true, gives: "same", note: "A step reads and writes the store through a procedure." },
      event: { reads: false, gives: "same", note: "The steps get the event of the run without a change." },
      caps: { reads: true, gives: "narrows", note: "A nested call gets the same capabilities or fewer." },
    },
  },
  {
    id: "node",
    title: "Tree node",
    side: "derive",
    summary: "A node of a document tree. Its data and its box go down to its children.",
    example: {
      type: "node",
      value: { data: { title: "Notes" }, children: [{ type: "text", value: { type: "ref", value: ["names", "title"] } }] },
    },
    uses: {
      names: { reads: true, gives: "extends", note: "The data of the node becomes a name for its children." },
      self: { reads: true, gives: "moves", note: "Each child becomes self for its own part." },
      world: { reads: true, gives: "same", note: "A node can show stored documents." },
      event: NONE,
      caps: NONE,
    },
  },
  {
    id: "rule",
    title: "Layout rule",
    side: "derive",
    summary: "A rule that gives the box of a child from the box of its parent.",
    example: { type: ["layouts", "stack"], value: { gap: 8 } },
    uses: {
      names: { reads: true, gives: "none", note: "The rule reads its parameters." },
      self: { reads: true, gives: "none", note: "The rule reads the box of the parent and the key of the child." },
      world: NONE,
      event: NONE,
      caps: NONE,
    },
  },
  {
    id: "handler",
    title: "Event handler",
    side: "run",
    summary: "A run that an event starts. It holds a sequence as data until the event comes.",
    example: {
      type: "on",
      value: {
        event: "click",
        run: { type: "seq", value: [{ type: ["card", "toggle"], value: { id: { type: "ref", value: ["event", "target"] } } }] },
      },
    },
    uses: {
      names: { reads: true, gives: "same", note: "The handler reads the names of its place." },
      self: { reads: true, gives: "same", note: "The handler knows the node that got the event." },
      world: { reads: true, gives: "same", note: "The run reads and writes the store." },
      event: { reads: true, gives: "sets", note: "The handler gives the event to its run." },
      caps: { reads: true, gives: "narrows", note: "The run gets only the capabilities of the handler." },
    },
  },
  {
    id: "query",
    title: "Query",
    side: "derive",
    summary: "A selection of stored documents. A storage adapter decides where it runs.",
    example: { type: "query", value: { collection: "cards", match: { board: { type: "ref", value: ["names", "board"] } } } },
    uses: {
      names: { reads: true, gives: "none", note: "The query reads its parameters." },
      self: NONE,
      world: { reads: true, gives: "none", note: "The query reads one collection." },
      event: NONE,
      caps: NONE,
    },
  },
];
