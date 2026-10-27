import { useMemo, useState } from "react";
import type { Json } from "@mark1russell7/coeval";
import Picture from "../glyphs/Picture.tsx";
import TreeSvg, { FLOW_COLOR, FLOW_DASH, FlowKey, type TreeArrow } from "./TreeSvg.tsx";
import { MOVES, TREE, resolveMove } from "../lib/tree.ts";

type Tab = "sequence" | "moves" | "tree";

const nameRef = (key: string): Json => ({ type: "ref", value: ["names", key] });

const SEQUENCE = {
  type: "seq",
  value: [
    { type: "add", value: [1, 2], name: "a" },
    { type: "multiply", value: [nameRef("a"), 10], name: "b" },
    { type: "log", value: [nameRef("b")] },
    { type: "add", value: [nameRef("a"), nameRef("b")], name: "c" },
  ],
} satisfies Json;

const STEP_NAMES: readonly (string | undefined)[] = SEQUENCE.value.map((step) => ("name" in step ? step.name : undefined));

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
  const [moveId, setMoveId] = useState<string>("parent");
  const move = MOVES.find((item) => item.id === moveId) ?? MOVES[0];
  const outcome = useMemo(() => (move === undefined ? undefined : resolveMove(focus, move)), [focus, move]);
  if (move === undefined || outcome === undefined) return null;
  const labelled = new Set<string>();
  const arrows: TreeArrow[] = outcome.hops.map((hop) => {
    // A hop to the list children gives one arrow to each child. Only the first arrow carries the text of the step.
    const key = `${hop.from}|${hop.step}`;
    const first = !labelled.has(key);
    labelled.add(key);
    return { from: hop.from, to: hop.to, color: "var(--ce-move)", bend: 18, ...(first ? { label: hop.step } : {}) };
  });
  const label = (id: string): string => TREE.find((item) => item.id === id)?.label ?? id;

  return (
    <>
      <div className="ce-bar-group" role="group" aria-label="Path from self" style={{ marginBottom: "var(--space-3)" }}>
        <span className="ce-bar-label">Path from self</span>
        {MOVES.map((item) => (
          <button key={item.id} type="button" className="ce-btn ce-mono" aria-pressed={item.id === move.id} onClick={() => setMoveId(item.id)}>
            {item.id}
          </button>
        ))}
      </div>
      <TreeSvg
        label="A tree. Select a node to make it the focus."
        arrows={arrows}
        onSelect={setFocus}
        stateOf={(id) => (id === focus ? "focus" : outcome.targets.includes(id) ? "target" : "normal")}
      />
      <p style={{ margin: "var(--space-3) 0 0" }} aria-live="polite">
        From <strong>{label(focus)}</strong>, the kernel resolves the path <span className="ce-mono">self.{move.id}</span>.{" "}
        {outcome.ok ? (
          <>
            It reaches {outcome.targets.map(label).join(", ")}.
            {outcome.targets.includes(focus) && " The focus is one of them."}
          </>
        ) : outcome.error === undefined ? (
          "It reaches no node."
        ) : (
          <>
            It reaches no node: <strong>{outcome.error.code}</strong> {outcome.error.reason}
          </>
        )}
      </p>
      <ul className="ce-legend">
        <li>A green node with a thick border: the focus. It is self, where the path starts.</li>
        <li>A blue node with a dashed border: a node that the path reaches.</li>
        <li>A solid slate arrow: one hop of the kernel, with the text of its step.</li>
      </ul>
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
    if (down) arrows.push({ from: item.parent, to: item.id, color: FLOW_COLOR.down, shift: -6 });
    if (up) arrows.push({ from: item.id, to: item.parent, color: FLOW_COLOR.up, dash: FLOW_DASH.up, shift: -6 });
  }
  if (side) arrows.push({ from: "menu", to: "list", color: FLOW_COLOR.side, dash: FLOW_DASH.side, bend: -40 });

  return (
    <>
      <div className="ce-bar-group" style={{ marginBottom: "var(--space-3)" }}>
        <label className="ce-check">
          <input type="checkbox" checked={down} onChange={(event) => setDown(event.target.checked)} />
          <FlowKey flow="down" />
          Down: data and the box
        </label>
        <label className="ce-check">
          <input type="checkbox" checked={up} onChange={(event) => setUp(event.target.checked)} />
          <FlowKey flow="up" />
          Up: sizes and events
        </label>
        <label className="ce-check">
          <input type="checkbox" checked={side} onChange={(event) => setSide(event.target.checked)} />
          <FlowKey flow="side" />
          Sideways: a reference
        </label>
      </div>
      <TreeSvg label="A tree with the three directions of data" arrows={arrows} stateOf={() => "normal"} />
      <ul className="ce-legend">
        <li>Down, an orange solid line: a parent gives its children data and a box. The children inherit them.</li>
        <li>Up, a teal dotted line: a child gives its parent its size, and its events go to the parent.</li>
        <li>Sideways, a fuchsia dashed line: the menu shows the count of the list. It reads another branch by a reference.</li>
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
          "In a structure, a term reads by position. A path goes from the focus to other nodes, and the kernel gives each hop."}
        {tab === "tree" &&
          "In a tree, data goes down, sizes and events go up, and a reference goes sideways. One path grammar can name all three."}
      </figcaption>
    </figure>
  );
}
