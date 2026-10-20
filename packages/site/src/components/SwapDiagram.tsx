import { useState } from "react";
import { STD_CAPS, evaluate, makeContext, typeName, typed, type Envelope, type Json } from "@mark1russell7/coeval";
import Evaluated from "../glyphs/Evaluated.tsx";
import { SITE_MACHINE } from "../glyphs/Explorer.tsx";
import { View } from "../glyphs/View.tsx";
import { SealedPart } from "../glyphs/Panels.tsx";

const PARTS: readonly { readonly id: "A" | "B"; readonly doc: Envelope }[] = [
  { id: "A", doc: typed("add", [2, 3]) },
  { id: "B", doc: typed("number", 5) },
];

type Mode = "evaluate" | "inspect";

function valueOf(doc: Envelope): Json {
  const run = evaluate(SITE_MACHINE, doc, makeContext({}, STD_CAPS));
  return run.result.ok ? run.result.value : null;
}

/**
 * The swap diagram. Two parts give the same value. A parent that evaluates its part cannot tell them apart. A
 * parent that inspects its part can, and then a part cannot be replaced by an equal part. The kernel gives each
 * evaluator sealed parts, thus the second parent cannot exist.
 */
export default function SwapDiagram() {
  const [mode, setMode] = useState<Mode>("evaluate");
  const [current, setCurrent] = useState<"A" | "B">("A");
  const part = PARTS.find((item) => item.id === current)?.doc ?? typed("number", 5);
  const results = PARTS.map((item) => (mode === "evaluate" ? JSON.stringify(Number(valueOf(item.doc)) * 10) : `"${typeName(item.doc.type)}"`));
  const same = results[0] === results[1];
  const parent: Json = typed("multiply", [part, 10]);

  return (
    <figure className="ce-figure not-content" aria-label="Evaluate a part, or inspect it">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="The evaluator of the parent">
          <span className="ce-bar-label">The parent</span>
          <button type="button" className="ce-btn" aria-pressed={mode === "evaluate"} onClick={() => setMode("evaluate")}>
            Evaluates its part
          </button>
          <button type="button" className="ce-btn" aria-pressed={mode === "inspect"} onClick={() => setMode("inspect")}>
            Breaks the seal, and reads the type
          </button>
        </div>
        <div className="ce-bar-group" role="group" aria-label="The part">
          <span className="ce-bar-label">The part</span>
          {PARTS.map((item) => (
            <button key={item.id} type="button" className="ce-btn" aria-pressed={current === item.id} onClick={() => setCurrent(item.id)}>
              Part {item.id}
            </button>
          ))}
        </div>
      </div>
      <div className="ce-stage">
        <div className="ce-two">
          <div>
            <p className="ce-panel-title">Two parts with the value 5</p>
            <div className="cv-gallery">
              {PARTS.map((item) => (
                <div key={item.id} style={{ opacity: item.id === current ? 1 : 0.45 }}>
                  <span className="ce-doc-label">Part {item.id}</span>
                  <Evaluated doc={item.doc} />
                </div>
              ))}
            </div>
            <p className="ce-panel-title" style={{ marginTop: "var(--space-4)" }}>
              What the parent gets
            </p>
            <div className="cv-sealed-row">
              <SealedPart partKey="0" />
              {mode === "inspect" && <span className="ce-verdict" data-ok="false">The seal is broken.</span>}
            </div>
          </div>
          <div>
            <p className="ce-panel-title">The parent, with part {current}</p>
            {mode === "evaluate" ? (
              <Evaluated doc={parent} />
            ) : (
              <div className="cv-gallery">
                <View doc={parent} />
                <span className="cv-port" data-ok="true" style={{ position: "static" }}>
                  = “{typeName(part.type)}”
                </span>
              </div>
            )}
            <table className="ce-table" style={{ marginTop: "var(--space-4)" }}>
              <thead>
                <tr>
                  <th>The parent gets</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {PARTS.map((item, index) => (
                  <tr key={item.id}>
                    <td>Part {item.id}</td>
                    <td className="ce-mono" data-lit={item.id === current}>
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
        An evaluator gets its parts sealed. It can evaluate them, or give them to another evaluator. It cannot look
        inside them. This rule keeps equal parts interchangeable. The kernel enforces it: a part has no field with its
        value.
      </figcaption>
    </figure>
  );
}
