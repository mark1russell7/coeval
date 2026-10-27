import type { ReactNode } from "react";
import { STD_CAPS, typed, type Json } from "@mark1russell7/coeval";
import Evaluated from "../glyphs/Evaluated.tsx";
import ValueGlyph from "../glyphs/Value.tsx";
import { View } from "../glyphs/View.tsx";
import { SealedPart } from "../glyphs/Panels.tsx";
import { Port } from "../glyphs/Card.tsx";
import { FlowKey } from "./TreeSvg.tsx";

interface Entry {
  readonly id: string;
  readonly page: number;
  readonly title: string;
  readonly glyph: () => ReactNode;
}

/** The glyph of an arrow of a picture: a dashed arrow back to a binding, or a solid arrow for a move with its step. */
function ArrowGlyph({ move }: { readonly move: boolean }) {
  const color = move ? "var(--ce-move)" : "var(--ce-names)";
  return (
    <svg className="cv-key-arrow" width="64" height="22" viewBox="0 0 64 22" aria-hidden="true">
      <path d="M4 15 L56 15" className={move ? "cv-arrow-move" : "cv-arrow-ref"} />
      <path d="M54 11 L62 15 L54 19 Z" style={{ fill: color }} />
      {move && (
        <text x="30" y="10" className="cv-arrow-step">
          parent
        </text>
      )}
    </svg>
  );
}

const ENTRIES: readonly Entry[] = [
  { id: "value", page: 1, title: "Data: a value without a type", glyph: () => <ValueGlyph value={42} size="large" /> },
  { id: "card", page: 1, title: "A document: the tab is its type", glyph: () => <View doc={typed("number", 42)} /> },
  {
    id: "declared",
    page: 1,
    title: "A dashed tab: the container declares the type",
    glyph: () => <View doc={42} declaredType="number" />,
  },
  {
    id: "nested",
    page: 1,
    title: "Parts: a card inside a card",
    glyph: () => <View doc={typed("add", [1, 2])} />,
  },
  { id: "kind", page: 2, title: "A kind: a document of type kind", glyph: () => <span className="cv-key-mini">kind</span> },
  { id: "rung", page: 3, title: "A rung: own, kind or default", glyph: () => <span className="cv-key-rungs"><span>O</span><span>K</span><span>D</span></span> },
  { id: "port", page: 4, title: "A port: the result of a document", glyph: () => <Port result={{ ok: true, value: 3 }} /> },
  { id: "sealed", page: 4, title: "A sealed part: an evaluator cannot read it", glyph: () => <SealedPart partKey="0" /> },
  {
    id: "error",
    page: 4,
    title: "An error value, in a red port",
    glyph: () => <Port result={{ ok: false, error: { code: "#NAME?", reason: "The context has no name price." } }} />,
  },
  { id: "name", page: 5, title: "A name tag: a binding for later steps", glyph: () => <View doc={typed("number", 3, { name: "a" })} /> },
  { id: "ref", page: 5, title: "A reference: a path from a root of the context", glyph: () => <View doc={typed("ref", ["names", "a"])} /> },
  { id: "ref-arrow", page: 5, title: "A dashed blue arrow: from a reference back to the step with its name", glyph: () => <ArrowGlyph move={false} /> },
  {
    id: "skipped",
    page: 6,
    title: "Not evaluated: a part that its parent did not need",
    glyph: () => (
      <Evaluated doc={typed("if", { test: typed("bool", true), then: typed("text", "yes"), else: typed("text", "no") })} />
    ),
  },
  {
    id: "run",
    page: 7,
    title: "The run side: a magenta edge, and an effect",
    glyph: () => <Evaluated doc={typed("log", ["hi"]) as Json} caps={STD_CAPS} />,
  },
  {
    id: "ticket",
    page: 7,
    title: "An effect: a numbered ticket in the world",
    glyph: () => (
      <span className="cv-ticket">
        <span className="cv-ticket-number">1</span>
        <span className="cv-ticket-kind">log</span>
        <ValueGlyph value="hi" />
      </span>
    ),
  },
  { id: "cap", page: 7, title: "A capability: an effect that a term can cause", glyph: () => <span className="cv-cap-chip">log</span> },
  {
    id: "roots",
    page: 9,
    title: "The five roots of a context: each path starts at one",
    glyph: () => (
      <span className="cv-roots">
        <span className="cv-root" data-part="focus" data-lit="true">
          self
        </span>
        <span className="cv-root" data-part="names" data-lit="true">
          names
        </span>
      </span>
    ),
  },
  {
    id: "step",
    page: 9,
    title: "A computed step: a document with its own kind",
    glyph: () => <View doc={typed("ref", ["self", typed("nearest", { type: "panel" }), "width"])} />,
  },
  { id: "move-arrow", page: 9, title: "A solid slate arrow: one move of a path, with the text of its step", glyph: () => <ArrowGlyph move /> },
  {
    id: "collapse",
    page: 9,
    title: "A dashed rung: the walk follows a reference to its target (collapse)",
    glyph: () => (
      <span className="cv-hop-by" data-by="collapse">
        collapse
      </span>
    ),
  },
  { id: "flow-down", page: 10, title: "An orange solid arrow: data and the box go down a tree", glyph: () => <FlowKey flow="down" /> },
  { id: "flow-up", page: 10, title: "A teal dotted arrow: a size or an event goes up a tree", glyph: () => <FlowKey flow="up" /> },
  { id: "flow-side", page: 10, title: "A fuchsia dashed arrow: a reference goes sideways, to another branch", glyph: () => <FlowKey flow="side" /> },
];

/** The props of the glyph key. */
export interface GlyphKeyProps {
  /** The number of the page in the order of the guide. The key shows each glyph up to this page. */
  readonly page: number;
}

/**
 * The key of the visual grammar. Each page of the guide adds glyphs. The key shows each glyph that the guide has
 * introduced, and it marks the glyphs that are new on this page. Each glyph is drawn by the same code as the
 * pictures.
 */
export default function GlyphKey({ page }: GlyphKeyProps) {
  const shown = ENTRIES.filter((entry) => entry.page <= page);
  const fresh = shown.filter((entry) => entry.page === page).length;
  return (
    <details className="cv-key not-content" open={page <= 2}>
      <summary>
        The glyphs so far: {shown.length}
        {fresh > 0 && <span className="cv-key-new-count">, {fresh} new on this page</span>}
      </summary>
      <ul className="cv-key-list">
        {shown.map((entry) => (
          <li key={entry.id} className="cv-key-item" data-new={entry.page === page}>
            <span className="cv-key-glyph">{entry.glyph()}</span>
            <span className="cv-key-title">
              {entry.title}
              {entry.page === page && <span className="cv-key-badge">new</span>}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
