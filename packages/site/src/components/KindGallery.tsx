import { useState } from "react";
import { kindNamed, type Json } from "@mark1russell7/coeval";
import Evaluated from "../glyphs/Evaluated.tsx";
import { View, SITE_WORLD, kindDoc } from "../glyphs/View.tsx";
import { prettyJson } from "../lib/motion.ts";
import { ADD, CHOICE, EFFECTS, NAMES, PURE, TREE } from "../lib/programs.ts";

const GROUPS: readonly { readonly title: string; readonly kinds: readonly string[] }[] = [
  { title: "Data", kinds: ["number", "text", "bool"] },
  { title: "Operations", kinds: ["add", "multiply", "greater", "list"] },
  { title: "Control and names", kinds: ["if", "seq", "ref", "pure"] },
  { title: "Effects", kinds: ["log", "write"] },
  { title: "Trees and paths", kinds: ["panel", "box", "nearest"] },
  { title: "Kinds", kinds: ["kind"] },
];

const EXAMPLES: Readonly<Record<string, Json>> = {
  number: { type: "number", value: 7 },
  text: { type: "text", value: "Notes" },
  bool: { type: "bool", value: false },
  add: ADD,
  multiply: { type: "multiply", value: [6, 7] },
  greater: { type: "greater", value: [3, 2] },
  list: { type: "list", value: [{ type: "number", value: 1 }, { type: "text", value: "two" }] },
  if: CHOICE,
  seq: NAMES,
  ref: { type: "seq", value: [{ type: "number", value: 5, name: "size" }, { type: "ref", value: ["names", "size"] }] },
  panel: TREE,
  box: TREE,
  pure: PURE,
  log: { type: "log", value: ["hello"] },
  write: EFFECTS,
};

/**
 * The gallery of kinds. Each kind of the world of the site is a document of type kind, and its view draws it. A
 * reader selects a kind to see a document of that kind, evaluated.
 */
export default function KindGallery() {
  const [selected, setSelected] = useState("add");
  const kind = kindNamed(SITE_WORLD, selected);
  const example = EXAMPLES[selected];

  return (
    <figure className="ce-figure not-content" aria-label="The kinds of the world">
      <div className="ce-bar">
        {GROUPS.map((group) => (
          <div key={group.title} className="ce-bar-group" role="group" aria-label={group.title}>
            <span className="ce-bar-label">{group.title}</span>
            {group.kinds.map((name) => (
              <button key={name} type="button" className="ce-btn ce-mono" aria-pressed={name === selected} onClick={() => setSelected(name)}>
                {name}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="ce-stage">
        <div className="ce-two">
          <div>
            <p className="ce-panel-title">The kind, as a document</p>
            {kind !== undefined && <View doc={kindDoc(selected, kind)} />}
          </div>
          <div>
            <p className="ce-panel-title">{example === undefined ? "A kind of kinds" : "A document of this kind, evaluated"}</p>
            {example === undefined ? (
              <p className="cv-small">
                The kind <span className="ce-mono">kind</span> has a view and no evaluator. A kind is data that the ladder
                reads.
              </p>
            ) : (
              <>
                <div className="cv-picture">
                  <Evaluated doc={example} names={selected === "if" ? { size: 12 } : {}} />
                </div>
                <details className="cv-details">
                  <summary>The JSON</summary>
                  <pre className="ce-doc">{prettyJson(example)}</pre>
                </details>
              </>
            )}
          </div>
        </div>
      </div>
      <figcaption className="ce-caption">
        A kind is a document of type kind. It names the evaluator of each verb, the place of the parts of its value, and
        its side. The view of the kind kind draws it, by the same ladder as each other card.
      </figcaption>
    </figure>
  );
}
