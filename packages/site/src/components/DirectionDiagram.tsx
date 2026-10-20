import { useState } from "react";
import type { Json } from "@coeval/core";
import Picture from "../glyphs/Picture.tsx";
import TreeSvg, { type TreeArrow } from "./TreeSvg.tsx";
import { MOVES, TREE, targets, type Move } from "../lib/tree.ts";

type Tab = "sequence" | "moves" | "tree";

const SEQUENCE: Json = {
  type: "seq",
  value: [
    { type: "add", value: [1, 2], name: "a" },
    { type: "multiply", value: [{ type: "ref", value: "a" }, 10], name: "b" },
    { type: "log", value: [{ type: "ref", value: "b" }] },
    { type: "add", value: [{ type: "ref", value: "a" }, { type: "ref", value: "b" }], name: "c" },
  ],
};

const STEP_NAMES: readonly (string | undefined)[] = ["a", "b", undefined, "c"];

function SequenceTab() {
  const [selected, setSelected] = useState<readonly string[]>(["3"]);
  const step = Number(selected[0] ?? "3");
  const before = STEP_NAMES.slice(0, step).filter((name): name is string => name !== undefined);
  const after = STEP_NAMES.slice(step + 1).filter((name): name is string => name !== undefined);
  return (
    <div className="ce-two">
      <Picture doc={SEQUENCE} selected={selected.slice(0, 1).join("/")} onSelect={(path) => setSelected(path.slice(0, 1))} />
      <div>
        <p className="ce-panel-title">What step {step + 1} can name</p>
        <p style={{ margin: 0 }}>
          It can name {before.length === 0 ? "no step" : <span className="ce-ref">{before.join(", ")}</span>}.{" "}
          {after.length > 0 ? `It cannot name ${after.join(", ")}, because that step comes later.` : "No named step comes after it."}
        </p>
        <p className="ce-bar-label" style={{ marginTop: "var(--space-3)" }}>
          Select a step. Each dashed arrow goes back from a reference to the step that gives its name.
        </p>
      </div>
    </div>
  );
}

function MovesTab() {
  const [focus, setFocus] = useState("b");
  const [move, setMove] = useState<Move>("siblings");
  const found = targets(focus, move);
  const arrows: TreeArrow[] = found.map((target) => ({ from: focus, to: target, color: "var(--ce-focus)", bend: 18 }));
  const label = (id: string): string => TREE.find((item) => item.id === id)?.label ?? id;

  return (
    <>
      <div className="ce-bar-group" role="group" aria-label="Move" style={{ marginBottom: "var(--space-3)" }}>
        <span className="ce-bar-label">Move</span>
        {MOVES.map((item) => (
          <button key={item} type="button" className="ce-btn ce-mono" aria-pressed={item === move} onClick={() => setMove(item)}>
            {item}
          </button>
        ))}
      </div>
      <TreeSvg
        label="A tree. Select a node to make it the focus."
        arrows={arrows}
        onSelect={setFocus}
        stateOf={(id) => (id === focus ? "focus" : found.includes(id) ? "target" : "normal")}
      />
      <p style={{ margin: "var(--space-3) 0 0" }} aria-live="polite">
        From <strong>{label(focus)}</strong>, the move <span className="ce-mono">{move}</span>{" "}
        {found.length === 0 ? "reaches no node." : `reaches ${found.map(label).join(", ")}.`}
      </p>
    </>
  );
}

function TreeTab() {
  const [down, setDown] = useState(true);
  const [up, setUp] = useState(true);
  const [side, setSide] = useState(true);
  const arrows: TreeArrow[] = [];
  for (const item of TREE) {
    if (item.parent === undefined) continue;
    if (down) arrows.push({ from: item.parent, to: item.id, color: "var(--ce-names)", shift: -6 });
    if (up) arrows.push({ from: item.id, to: item.parent, color: "var(--ce-focus)", shift: -6 });
  }
  if (side) arrows.push({ from: "menu", to: "list", color: "var(--ce-caps)", dashed: true, bend: -40 });

  return (
    <>
      <div className="ce-bar-group" style={{ marginBottom: "var(--space-3)" }}>
        <label className="ce-check" data-part="names">
          <input type="checkbox" checked={down} onChange={(event) => setDown(event.target.checked)} />
          <span className="ce-swatch" aria-hidden="true" />
          Down: data and the box
        </label>
        <label className="ce-check" data-part="focus">
          <input type="checkbox" checked={up} onChange={(event) => setUp(event.target.checked)} />
          <span className="ce-swatch" aria-hidden="true" />
          Up: sizes and events
        </label>
        <label className="ce-check" data-part="caps">
          <input type="checkbox" checked={side} onChange={(event) => setSide(event.target.checked)} />
          <span className="ce-swatch" aria-hidden="true" />
          Sideways: a reference
        </label>
      </div>
      <TreeSvg label="A tree with the three directions of data" arrows={arrows} stateOf={() => "normal"} />
      <ul className="ce-legend">
        <li>Down: a parent gives its children data and a box. The children inherit them.</li>
        <li>Up: a child gives its parent its size, and its events go to the parent.</li>
        <li>Sideways: the menu shows the count of the list. It reads another branch by a reference.</li>
      </ul>
    </>
  );
}

/**
 * The direction diagram. It shows three shapes of scope. A step reads back to earlier steps. A move goes from a
 * focus in a tree. Data goes down, up and sideways in a tree.
 */
export default function DirectionDiagram() {
  const [tab, setTab] = useState<Tab>("sequence");
  return (
    <figure className="ce-figure not-content" aria-label="The directions of data">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="View">
          <button type="button" className="ce-btn" aria-pressed={tab === "sequence"} onClick={() => setTab("sequence")}>
            Back, in a sequence
          </button>
          <button type="button" className="ce-btn" aria-pressed={tab === "moves"} onClick={() => setTab("moves")}>
            Moves, from a focus
          </button>
          <button type="button" className="ce-btn" aria-pressed={tab === "tree"} onClick={() => setTab("tree")}>
            Down, up and sideways
          </button>
        </div>
      </div>
      <div className="ce-stage">
        {tab === "sequence" && <SequenceTab />}
        {tab === "moves" && <MovesTab />}
        {tab === "tree" && <TreeTab />}
      </div>
      <figcaption className="ce-caption">
        {tab === "sequence" &&
          "In a sequence, a step reads back. It can name each earlier step, and it cannot name a later step."}
        {tab === "moves" &&
          "In a structure, a term reads by position. A move goes from the focus to other nodes: up, down or to the side."}
        {tab === "tree" &&
          "In a tree, data goes down, sizes and events go up, and a reference goes sideways. One path grammar can name all three."}
      </figcaption>
    </figure>
  );
}
