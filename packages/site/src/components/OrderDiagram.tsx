import { useState } from "react";
import { dataEdges, effectEdges, isAllowedOrder, layers, type Edge, type StepSpec } from "@mark1russell7/coeval";

const BASE = [
  { id: "a", text: "Load the prices", reads: [] },
  { id: "b", text: "Load the rates", reads: [] },
  { id: "c", text: "Convert a with b", reads: ["a", "b"] },
  { id: "d", text: "Write a log line", reads: [] },
  { id: "e", text: "Save c", reads: ["c"] },
] as const;

function permutations(items: readonly string[]): string[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  );
}

function randomOrder(items: readonly string[]): string[] {
  const all = permutations(items);
  return all[Math.floor(Math.random() * all.length)] ?? [...items];
}

const NODE_W = 116;
const NODE_H = 36;

/**
 * The order diagram. Five steps, as written and as a graph. A reader marks the steps that have an effect. The diagram
 * counts the orders that give the same result, and tests a random order.
 */
export default function OrderDiagram() {
  const [effects, setEffects] = useState<Readonly<Record<string, boolean>>>({ d: true, e: true });
  const [trial, setTrial] = useState<readonly string[] | undefined>(undefined);

  const steps: StepSpec[] = BASE.map((step) => ({ id: step.id, reads: step.reads, effect: effects[step.id] === true }));
  const ids = steps.map((step) => step.id);
  const data = dataEdges(steps);
  const ordered = effectEdges(steps);
  const columns = layers(steps);
  const allowed = permutations(ids).filter((order) => isAllowedOrder(steps, order)).length;

  const position = new Map<string, { x: number; y: number }>();
  columns.forEach((column, layer) => {
    column.forEach((id, row) => position.set(id, { x: 70 + layer * 170, y: 40 + row * 64 }));
  });
  const height = Math.max(...columns.map((column) => column.length)) * 64 + 16;

  const broken: Edge | undefined =
    trial === undefined
      ? undefined
      : [...data, ...ordered].find(([before, after]) => trial.indexOf(before) > trial.indexOf(after));

  const edgePath = ([from, to]: Edge, bend: number): string => {
    const a = position.get(from);
    const b = position.get(to);
    if (a === undefined || b === undefined) return "";
    const x1 = a.x + NODE_W / 2;
    const x2 = b.x - NODE_W / 2;
    return `M${x1} ${a.y} C${x1 + 50} ${a.y + bend} ${x2 - 50} ${b.y + bend} ${x2} ${b.y}`;
  };

  return (
    <figure className="ce-figure not-content" aria-label="Order: a list of steps is a graph">
      <div className="ce-bar">
        <button
          type="button"
          className="ce-btn"
          data-variant="primary"
          onClick={() => setTrial(randomOrder(ids))}
        >
          Try a random order
        </button>
        <span aria-live="polite">
          <strong>{allowed}</strong> of 120 orders give the same result.
        </span>
      </div>
      <div className="ce-stage">
        <div className="ce-two">
          <div>
            <p className="ce-panel-title">As written</p>
            <ol className="ce-steps">
              {BASE.map((step, index) => (
                <li key={step.id} className="ce-step" style={{ cursor: "default" }}>
                  <span className="ce-step-index">{index + 1}</span>
                  <span>
                    <span className="ce-mono">{step.id}</span>: {step.text}
                  </span>
                  <label className="ce-check">
                    <input
                      type="checkbox"
                      checked={effects[step.id] === true}
                      onChange={(event) => {
                        setEffects({ ...effects, [step.id]: event.target.checked });
                        setTrial(undefined);
                      }}
                    />
                    effect
                  </label>
                </li>
              ))}
            </ol>
          </div>
          <div className="ce-scroll">
            <p className="ce-panel-title">As a graph</p>
            <svg
              className="ce-svg"
              viewBox={`0 0 ${70 + (columns.length - 1) * 170 + 70} ${height}`}
              style={{ minWidth: "20rem" }}
              role="img"
              aria-label="The steps as a graph: an arrow goes from each step to each step that must come after it"
            >
              <defs>
                <marker id="ce-order-data" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 0 L10 5 L0 10 Z" style={{ fill: "var(--color-ink-secondary)" }} />
                </marker>
                <marker id="ce-order-effect" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 0 L10 5 L0 10 Z" style={{ fill: "var(--ce-run)" }} />
                </marker>
                <marker id="ce-order-broken" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 0 L10 5 L0 10 Z" style={{ fill: "var(--ce-stop)" }} />
                </marker>
              </defs>
              {data.map((edge) => {
                const isBroken = broken !== undefined && broken[0] === edge[0] && broken[1] === edge[1];
                return (
                  <path
                    key={`d-${edge.join("-")}`}
                    d={edgePath(edge, 0)}
                    className="ce-arrow"
                    style={{ stroke: isBroken ? "var(--ce-stop)" : "var(--color-ink-secondary)" }}
                    strokeWidth={isBroken ? 3 : 2}
                    markerEnd={`url(#${isBroken ? "ce-order-broken" : "ce-order-data"})`}
                  />
                );
              })}
              {ordered.map((edge) => {
                const isBroken = broken !== undefined && broken[0] === edge[0] && broken[1] === edge[1];
                return (
                  <path
                    key={`e-${edge.join("-")}`}
                    d={edgePath(edge, 28)}
                    className="ce-arrow"
                    style={{ stroke: isBroken ? "var(--ce-stop)" : "var(--ce-run)" }}
                    strokeDasharray="6 5"
                    strokeWidth={isBroken ? 3 : 2}
                    markerEnd={`url(#${isBroken ? "ce-order-broken" : "ce-order-effect"})`}
                  />
                );
              })}
              {steps.map((step) => {
                const at = position.get(step.id);
                if (at === undefined) return null;
                return (
                  <g key={step.id}>
                    <rect
                      x={at.x - NODE_W / 2}
                      y={at.y - NODE_H / 2}
                      width={NODE_W}
                      height={NODE_H}
                      rx="4"
                      style={{
                        fill: step.effect ? "var(--ce-run-wash)" : "var(--ce-derive-wash)",
                        stroke: step.effect ? "var(--ce-run)" : "var(--ce-derive)",
                      }}
                      strokeWidth="1.5"
                    />
                    <text x={at.x} y={at.y + 4.5} textAnchor="middle" fontSize="13">
                      {step.id}: {step.effect ? "effect" : "pure"}
                    </text>
                  </g>
                );
              })}
            </svg>
            <ul className="ce-legend">
              <li>
                <svg width="28" height="10" aria-hidden="true">
                  <line x1="0" y1="5" x2="28" y2="5" style={{ stroke: "var(--color-ink-secondary)" }} strokeWidth="2" />
                </svg>
                a step reads a result
              </li>
              <li>
                <svg width="28" height="10" aria-hidden="true">
                  <line x1="0" y1="5" x2="28" y2="5" style={{ stroke: "var(--ce-run)" }} strokeWidth="2" strokeDasharray="6 5" />
                </svg>
                effects keep their order
              </li>
            </ul>
          </div>
        </div>
        {trial !== undefined && (
          <div className="ce-result" data-state={broken === undefined ? "go" : "stop"} aria-live="polite">
            <ul className="ce-chips" aria-label="The random order">
              {trial.map((id) => (
                <li key={id} className="ce-chip">
                  {id}
                </li>
              ))}
            </ul>
            <span className="ce-verdict" data-ok={broken === undefined}>
              {broken === undefined
                ? "This order gives the same result."
                : `This order breaks the result: ${broken[0]} must come before ${broken[1]}.`}
            </span>
          </div>
        )}
      </div>
      <figcaption className="ce-caption">
        A list of pure steps is a graph that someone wrote down in one order. Each order that obeys the arrows gives the
        same result. A step with an effect also keeps its place among the other effects. Mark more effects, and fewer
        orders stay correct.
      </figcaption>
    </figure>
  );
}
