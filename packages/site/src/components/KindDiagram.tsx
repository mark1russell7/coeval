import { useState } from "react";
import { ask, classify, tag, type Json, type Shape, type World } from "@mark1russell7/coeval";
import { View, WorldContext } from "../glyphs/View.tsx";

const WORLD: World = {
  kinds: {
    image: { verbs: { view: "image.view" } },
    box: { verbs: { view: "box.view" } },
    limit: { verbs: { view: "limit.view" } },
  },
  defaults: { view: "json.view" },
};

const SHAPES: readonly Shape[] = [{ name: "width and height", fields: ["width", "height"], kind: "box" }];

const RECORD: Json = { width: 120, height: 80 };

const LISTS = [
  { name: "photos", kind: "image", meaning: "A picture of 120 by 80" },
  { name: "frames", kind: "box", meaning: "An empty box of 120 by 80" },
  { name: "upload rules", kind: "limit", meaning: "The largest size that an upload can have" },
] as const;

type Mode = "name" | "shape";

function Picture({ evaluator }: { readonly evaluator: string | undefined }) {
  const stroke = "var(--color-ink)";
  if (evaluator === "image.view") {
    return (
      <svg className="ce-svg" viewBox="0 0 140 96" role="img" aria-label="A picture">
        <rect x="10" y="8" width="120" height="80" rx="3" fill="var(--color-surface-sunken)" stroke={stroke} strokeWidth="1.5" />
        <path d="M18 80 L52 44 L74 66 L92 50 L122 80 Z" fill="var(--ce-focus)" opacity="0.55" />
        <circle cx="104" cy="28" r="8" fill="var(--ce-world)" opacity="0.8" />
      </svg>
    );
  }
  if (evaluator === "limit.view") {
    return (
      <svg className="ce-svg" viewBox="0 0 140 96" role="img" aria-label="A size limit">
        <rect x="10" y="8" width="120" height="80" rx="3" fill="none" stroke="var(--ce-stop)" strokeWidth="1.5" strokeDasharray="6 4" />
        <text x="70" y="52" textAnchor="middle" fontSize="12">
          120 × 80 at most
        </text>
      </svg>
    );
  }
  return (
    <svg className="ce-svg" viewBox="0 0 140 96" role="img" aria-label="An empty box">
      <rect x="10" y="8" width="120" height="80" rx="3" fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

/**
 * The kind diagram. One record goes into three lists. Each list names a kind for its items, so each copy of the
 * record gets a different evaluator. A guess from the shape gives all three copies the same evaluator.
 */
export default function KindDiagram() {
  const [mode, setMode] = useState<Mode>("name");

  const rows = LISTS.map((list) => {
    if (mode === "name") {
      const answer = ask(WORLD, {}, "view", { declaredType: list.kind });
      return { list, kind: list.kind, evaluator: answer.evaluator, doc: RECORD, declared: list.kind as string | undefined };
    }
    const guess = classify(SHAPES, RECORD);
    const tagged = guess.kind === undefined ? undefined : tag(RECORD, guess.kind);
    const answer = ask(WORLD, tagged ?? {}, "view");
    return { list, kind: guess.kind ?? "none", evaluator: answer.evaluator, doc: (tagged ?? RECORD) as Json, declared: undefined as string | undefined };
  });
  const wrong = rows.filter((row) => row.kind !== row.list.kind).length;

  return (
    <figure className="ce-figure not-content" aria-label="One shape, three kinds">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="How the kind is found">
          <span className="ce-bar-label">The kind comes from</span>
          <button type="button" className="ce-btn" aria-pressed={mode === "name"} onClick={() => setMode("name")}>
            The name that the list declares
          </button>
          <button type="button" className="ce-btn" aria-pressed={mode === "shape"} onClick={() => setMode("shape")}>
            A guess from the shape
          </button>
        </div>
      </div>
      <div className="ce-stage">
        <div className="ce-two">
          <div>
            <p className="ce-panel-title">The same record, in three lists</p>
            <WorldContext.Provider value={WORLD}>
              <div className="cv-gallery">
                {rows.map((row) => (
                  <View key={row.list.name} doc={row.doc} {...(row.declared === undefined ? {} : { declaredType: row.declared })} />
                ))}
              </div>
            </WorldContext.Provider>
            <p className="ce-bar-label">
              {mode === "name"
                ? "Each dashed tab is a type that its list declares. The record itself does not change."
                : "The classifier put each copy in an envelope with the type box."}
            </p>
          </div>
          <div className="ce-scroll">
            <table className="ce-table">
              <thead>
                <tr>
                  <th>List</th>
                  <th>Kind</th>
                  <th>Evaluator</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.list.name}>
                    <td>
                      {row.list.name}
                      <br />
                      <span className="ce-bar-label">{row.list.meaning}</span>
                    </td>
                    <td className="ce-mono">
                      {row.kind}
                      {row.kind !== row.list.kind && (
                        <>
                          <br />
                          <span className="ce-verdict" data-ok="false">
                            wrong
                          </span>
                        </>
                      )}
                    </td>
                    <td className="ce-mono">{row.evaluator ?? "none"}</td>
                    <td style={{ minWidth: "7rem" }}>
                      <Picture evaluator={row.evaluator} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <figcaption className="ce-caption" aria-live="polite">
        {mode === "name" ? (
          <>
            <strong>By name:</strong> each list declares the kind of its items. The same record gets three different
            meanings, and each one is correct.
          </>
        ) : (
          <>
            <strong>By shape:</strong> the guess sees only a width and a height. It gives all three copies the kind box,
            thus {wrong} of the 3 results are wrong.
          </>
        )}
      </figcaption>
    </figure>
  );
}
