import { useLayoutEffect, useRef, useState } from "react";
import TreeSvg, { type TreeArrow } from "./TreeSvg.tsx";
import { MOVES, TREE, targets, type Move } from "../lib/tree.ts";

type Tab = "sequence" | "moves" | "tree";

const STEPS = [
  { id: "cards", text: "Find the cards of the board", reads: [] as string[] },
  { id: "count", text: "Count", reads: ["cards"] },
  { id: "label", text: "Write the label from", reads: ["count"] },
  { id: "done", text: "Mark each card done in", reads: ["cards"] },
] as const;

function SequenceTab() {
  const [selected, setSelected] = useState<string>("done");
  const at = STEPS.findIndex((step) => step.id === selected);
  const current = STEPS[at];
  const reads: readonly string[] = current?.reads ?? [];
  const later = STEPS.slice(at + 1).map((step) => step.id);

  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const [centers, setCenters] = useState<readonly number[]>([]);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const measure = (): void => {
      setCenters(rows.current.map((row) => (row === null ? 0 : row.offsetTop + row.offsetHeight / 2)));
      const last = rows.current.at(-1);
      setHeight(last === null || last === undefined ? 0 : last.offsetTop + last.offsetHeight);
    };
    measure();
    const list = rows.current[0]?.parentElement;
    if (list === null || list === undefined) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  const arcs = reads.map((name) => {
    const from = STEPS.findIndex((step) => step.id === name);
    const y1 = centers[at] ?? 0;
    const y2 = centers[from] ?? 0;
    const reach = 10 + Math.abs(at - from) * 9;
    return `M38 ${y1} C${38 - reach} ${y1} ${38 - reach} ${y2} 38 ${y2}`;
  });

  return (
    <div className="ce-two">
      <div style={{ position: "relative", paddingLeft: "44px" }}>
        <svg
          width="44"
          height={height}
          style={{ position: "absolute", left: 0, top: 0 }}
          aria-hidden="true"
        >
          <defs>
            <marker id="ce-seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L10 5 L0 10 Z" style={{ fill: "var(--ce-names)" }} />
            </marker>
          </defs>
          {arcs.map((d) => (
            <path key={d} d={d} className="ce-arrow" style={{ stroke: "var(--ce-names)" }} markerEnd="url(#ce-seq-arrow)" />
          ))}
        </svg>
        <ol className="ce-steps" aria-label="The steps of a sequence">
          {STEPS.map((step, index) => (
            <li
              key={step.id}
              ref={(element) => {
                rows.current[index] = element;
              }}
              className="ce-step"
              aria-current={step.id === selected}
              data-state={reads.includes(step.id) ? "read" : later.includes(step.id) ? "later" : "normal"}
              tabIndex={0}
              onClick={() => setSelected(step.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelected(step.id);
                }
              }}
            >
              <span className="ce-step-index">{index + 1}</span>
              <span>
                {step.text}{" "}
                {step.reads.map((name) => (
                  <span key={name} className="ce-ref">
                    {name}
                  </span>
                ))}
              </span>
              <span className="ce-mono ce-bar-label">gives {step.id}</span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <p className="ce-panel-title">What step {at + 1} can name</p>
        <p style={{ margin: 0 }}>
          It reads{" "}
          {reads.length === 0 ? (
            "no earlier step"
          ) : (
            <span className="ce-ref">{reads.join(", ")}</span>
          )}
          . It can name each step before it: {STEPS.slice(0, at).map((step) => step.id).join(", ") || "none"}.{" "}
          {later.length > 0 ? `It cannot name ${later.join(", ")}, because those steps come later.` : "No step comes after it."}
        </p>
        <p className="ce-bar-label" style={{ marginTop: "var(--space-3)" }}>
          Select a step to see its references. The arrows go back, to the place where each name gets its value.
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
