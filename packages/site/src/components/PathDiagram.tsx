import { useEffect, useState } from "react";
import TreeSvg, { type TreeArrow } from "./TreeSvg.tsx";
import { TREE } from "../lib/tree.ts";
import { useReducedMotion } from "../lib/motion.ts";

/** One move of a path. */
type Move =
  | { readonly up: true }
  | { readonly down: string }
  | { readonly back: string }
  | { readonly field: string };

interface Example {
  readonly id: string;
  readonly label: string;
  readonly syntax: string;
  readonly from: string;
  readonly moves: readonly Move[];
  readonly where: "tree" | "steps" | "value";
}

const EXAMPLES: readonly Example[] = [
  { id: "parent", label: "A parent reference", syntax: "$parent.width", from: "b", moves: [{ up: true }, { field: "width" }], where: "tree" },
  { id: "part", label: "A part path", syntax: "header.menu", from: "page", moves: [{ down: "header" }, { down: "menu" }], where: "tree" },
  { id: "branch", label: "Another branch", syntax: "../../list", from: "menu", moves: [{ up: true }, { up: true }, { down: "list" }], where: "tree" },
  { id: "step", label: "A step reference", syntax: "$ref cards.count", from: "done", moves: [{ back: "cards" }, { field: "count" }], where: "steps" },
  { id: "json", label: "A path in a value", syntax: "children.0.title", from: "page", moves: [{ field: "children" }, { field: "0" }, { field: "title" }], where: "value" },
];

const STEPS = ["cards", "count", "label", "done"] as const;

const VALUE = { children: [{ title: "Notes", done: false }, { title: "Ideas", done: true }] };

function moveText(move: Move): { readonly symbol: string; readonly text: string } {
  if ("up" in move) return { symbol: "↑", text: "up" };
  if ("down" in move) return { symbol: "↓", text: `down ${move.down}` };
  if ("back" in move) return { symbol: "←", text: `back to ${move.back}` };
  return { symbol: "•", text: `field ${move.field}` };
}

function walkTree(from: string, moves: readonly Move[]): readonly string[] {
  const visited = [from];
  let at = from;
  for (const move of moves) {
    if ("up" in move) {
      const parent = TREE.find((node) => node.id === at)?.parent;
      if (parent === undefined) break;
      at = parent;
      visited.push(at);
    } else if ("down" in move) {
      const child = TREE.find((node) => node.parent === at && node.id === move.down);
      if (child === undefined) break;
      at = child.id;
      visited.push(at);
    }
  }
  return visited;
}

/**
 * The path diagram. It writes five syntaxes of common use as lists of moves from the place of the reference.
 * The moves are up, down, back to a binding, and into a field. A reader walks each path one move at a time.
 */
export default function PathDiagram() {
  const reduced = useReducedMotion();
  const [id, setId] = useState("parent");
  const [shown, setShown] = useState(99);
  const [replay, setReplay] = useState(0);
  const example = EXAMPLES.find((item) => item.id === id) ?? EXAMPLES[0];

  useEffect(() => {
    if (reduced || example === undefined) {
      setShown(99);
      return undefined;
    }
    setShown(0);
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      setShown(count);
      if (count >= example.moves.length) window.clearInterval(timer);
    }, 650);
    return () => window.clearInterval(timer);
  }, [id, reduced, example, replay]);

  if (example === undefined) return null;
  const moves = example.moves.slice(0, shown);
  const visited = example.where === "tree" ? walkTree(example.from, moves) : [];
  const arrows: TreeArrow[] = visited.slice(1).map((node, index) => ({
    from: visited[index] ?? example.from,
    to: node,
    color: "var(--ce-focus)",
    bend: 12,
  }));
  const fields = moves.filter((move): move is { readonly field: string } => "field" in move).map((move) => move.field);

  return (
    <figure className="ce-figure not-content" aria-label="One path grammar">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="Syntax">
          <span className="ce-bar-label">Syntax</span>
          {EXAMPLES.map((item) => (
            <button key={item.id} type="button" className="ce-btn" aria-pressed={item.id === id} onClick={() => setId(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ce-stage">
        <div className="ce-two">
          <div>
            <p className="ce-panel-title">The syntax</p>
            <code className="cv-code cv-big">{example.syntax}</code>
            <p className="ce-panel-title" style={{ marginTop: "var(--space-4)" }}>
              The same path, as moves from <span className="ce-mono">{example.from}</span>
            </p>
            <ol className="cv-moves">
              {example.moves.map((move, index) => {
                const text = moveText(move);
                return (
                  <li key={index} className="cv-move" data-lit={index < shown}>
                    <span className="cv-move-symbol" aria-hidden="true">
                      {text.symbol}
                    </span>
                    {text.text}
                  </li>
                );
              })}
            </ol>
            <button type="button" className="ce-btn" onClick={() => setReplay((count) => count + 1)}>
              Walk again
            </button>
          </div>
          <div>
            {example.where === "tree" && (
              <TreeSvg
                label="The walk of the path in a tree"
                arrows={arrows}
                stateOf={(node) => (node === example.from ? "focus" : visited.includes(node) ? "target" : "normal")}
              />
            )}
            {example.where === "steps" && (
              <ol className="ce-steps" aria-label="The steps of a sequence">
                {STEPS.map((step, index) => {
                  const here = step === example.from;
                  const reached = moves.some((move) => "back" in move && move.back === step);
                  return (
                    <li key={step} className="ce-step" style={{ cursor: "default" }} aria-current={here} data-state={reached ? "read" : "normal"}>
                      <span className="ce-step-index">{index + 1}</span>
                      <span className="ce-mono">{step}</span>
                      <span className="ce-bar-label">{here ? "here" : reached ? "← back to here" : ""}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            {(example.where === "value" || fields.length > 0) && (
              <div className="cv-field-walk">
                <span className="ce-bar-label">
                  {example.where === "value" ? "Into the value of page:" : "Then into the value:"}
                </span>
                <span className="cv-field-trail">
                  {fields.length === 0 ? <span className="cv-muted">no field yet</span> : fields.map((name, index) => (
                    <span key={index} className="cv-field-step">
                      {name}
                    </span>
                  ))}
                </span>
                {example.where === "value" && <code className="cv-code">{JSON.stringify(VALUE)}</code>}
              </div>
            )}
          </div>
        </div>
      </div>
      <figcaption className="ce-caption">
        Each syntax is a list of moves from the place of the reference. Up and down go through a structure. Back goes to
        an earlier binding. A field goes into a value. One grammar of four moves can write all five.
      </figcaption>
    </figure>
  );
}
