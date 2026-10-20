import { useState } from "react";
import type { Doc } from "@coeval/core";
import { prettyJson } from "../lib/motion.ts";

const PARTS: readonly { readonly id: "a" | "b"; readonly doc: Doc }[] = [
  { id: "a", doc: { $kind: "add", args: [2, 3] } },
  { id: "b", doc: { $kind: "lit", value: 5 } },
];

type Mode = "evaluate" | "inspect";

function value(doc: Doc): number {
  if (doc["$kind"] === "lit") return typeof doc["value"] === "number" ? doc["value"] : Number.NaN;
  const args = doc["args"];
  return Array.isArray(args) ? args.reduce<number>((sum, item) => sum + (typeof item === "number" ? item : 0), 0) : Number.NaN;
}

function parent(mode: Mode, part: Doc): string {
  return mode === "evaluate" ? String(value(part) * 10) : `"${String(part["$kind"])}"`;
}

/**
 * The swap diagram. Two parts give the same value. A parent that evaluates its part cannot tell them apart. A parent
 * that inspects its part can, and then a part cannot be replaced by an equal part.
 */
export default function SwapDiagram() {
  const [mode, setMode] = useState<Mode>("evaluate");
  const [current, setCurrent] = useState<"a" | "b">("a");
  const results = PARTS.map((part) => parent(mode, part.doc));
  const same = results[0] === results[1];

  return (
    <figure className="ce-figure not-content" aria-label="Evaluate a part, or inspect it">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="The evaluator of the parent">
          <span className="ce-bar-label">The parent</span>
          <button type="button" className="ce-btn" aria-pressed={mode === "evaluate"} onClick={() => setMode("evaluate")}>
            Evaluates its part, then multiplies by 10
          </button>
          <button type="button" className="ce-btn" aria-pressed={mode === "inspect"} onClick={() => setMode("inspect")}>
            Inspects its part, and gives its kind
          </button>
        </div>
        <div className="ce-bar-group" role="group" aria-label="The part">
          <span className="ce-bar-label">The part</span>
          {PARTS.map((part) => (
            <button key={part.id} type="button" className="ce-btn" aria-pressed={current === part.id} onClick={() => setCurrent(part.id)}>
              Part {part.id.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="ce-stage">
        <div className="ce-two">
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {PARTS.map((part) => (
              <div key={part.id} style={{ opacity: part.id === current ? 1 : 0.5 }}>
                <span className="ce-doc-label">
                  Part {part.id.toUpperCase()}. Its value is {value(part.doc)}.
                </span>
                <pre className="ce-doc">{prettyJson(part.doc)}</pre>
              </div>
            ))}
          </div>
          <div>
            <table className="ce-table">
              <thead>
                <tr>
                  <th>The parent gets</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {PARTS.map((part, index) => (
                  <tr key={part.id}>
                    <td>Part {part.id.toUpperCase()}</td>
                    <td className="ce-mono" data-lit={part.id === current}>
                      {results[index]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ marginTop: "var(--space-4)" }} aria-live="polite">
              <span className="ce-verdict" data-ok={same}>
                {same ? "A swap changes nothing." : "A swap changes the result."}
              </span>{" "}
              {same
                ? "The parent sees only the value of its part. Thus each part with the value 5 is correct in this place."
                : "The parent can tell the two parts apart. Thus no part can replace another part, also when both give 5."}
            </p>
          </div>
        </div>
      </div>
      <figcaption className="ce-caption">
        An evaluator gets its parts as documents. It can evaluate them, or give them to another evaluator. It must not
        look inside them. This rule keeps equal parts interchangeable.
      </figcaption>
    </figure>
  );
}
