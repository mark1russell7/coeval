import { useState } from "react";
import { CONSTRUCTS, PART_INFO, type ContextPart as Part, type Give, type Use } from "@coeval/core";
import { prettyJson } from "../lib/motion.ts";

const GIVE_WORDS: Readonly<Record<Give, string>> = {
  same: "same",
  extends: "more names",
  moves: "new position",
  narrows: "smaller",
  sets: "new value",
  none: "nothing",
};

/** The glyph of what a part reads: a line into the term, or a short dotted stub. */
function ReadGlyph({ use }: { readonly use: Use }) {
  return (
    <div className="ce-context-glyph" data-off={!use.reads}>
      <svg width="64" height="20" viewBox="0 0 64 20" aria-hidden="true">
        {use.reads ? (
          <>
            <line x1="2" y1="10" x2="54" y2="10" stroke="currentColor" strokeWidth="2.5" />
            <path d="M52 4 L62 10 L52 16 Z" fill="currentColor" />
          </>
        ) : (
          <line x1="2" y1="10" x2="30" y2="10" stroke="currentColor" strokeWidth="2" strokeDasharray="3 4" />
        )}
      </svg>
      <span>{use.reads ? "reads" : "not read"}</span>
    </div>
  );
}

/** The glyph of what the parts of the term get. Each value of `Give` has its own form. */
function GiveGlyph({ use }: { readonly use: Use }) {
  const off = use.gives === "none";
  return (
    <div className="ce-context-glyph" data-off={off}>
      <svg width="64" height="20" viewBox="0 0 64 20" aria-hidden="true">
        {use.gives === "same" && (
          <>
            <line x1="2" y1="10" x2="54" y2="10" stroke="currentColor" strokeWidth="2.5" />
            <path d="M52 4 L62 10 L52 16 Z" fill="currentColor" />
          </>
        )}
        {use.gives === "extends" && (
          <>
            <line x1="2" y1="10" x2="54" y2="10" stroke="currentColor" strokeWidth="5" />
            <path d="M51 2 L63 10 L51 18 Z" fill="currentColor" />
            <path d="M20 4 V16 M14 10 H26" stroke="var(--color-surface)" strokeWidth="2" />
          </>
        )}
        {use.gives === "moves" && (
          <>
            <path d="M2 10 H26 L40 3 H54" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <path d="M52 -3 L62 3 L52 9 Z" fill="currentColor" />
          </>
        )}
        {use.gives === "narrows" && (
          <>
            <path d="M2 3 L54 8 L54 12 L2 17 Z" fill="currentColor" opacity="0.85" />
            <path d="M52 5 L62 10 L52 15 Z" fill="currentColor" />
          </>
        )}
        {use.gives === "sets" && (
          <>
            <circle cx="8" cy="10" r="5" fill="currentColor" />
            <line x1="13" y1="10" x2="54" y2="10" stroke="currentColor" strokeWidth="2.5" />
            <path d="M52 4 L62 10 L52 16 Z" fill="currentColor" />
          </>
        )}
        {off && (
          <>
            <line x1="2" y1="10" x2="22" y2="10" stroke="currentColor" strokeWidth="2" />
            <line x1="23" y1="3" x2="23" y2="17" stroke="currentColor" strokeWidth="2.5" />
          </>
        )}
      </svg>
      <span>{GIVE_WORDS[use.gives]}</span>
    </div>
  );
}

/**
 * The context diagram. A reader picks a construct. Five channels show how it uses each part of the context:
 * what it reads, and what the parts of its body get.
 */
export default function ContextDiagram() {
  const [id, setId] = useState("sequence");
  const construct = CONSTRUCTS.find((item) => item.id === id) ?? CONSTRUCTS[0];
  if (construct === undefined) throw new Error("The context diagram has no constructs.");

  return (
    <figure className="ce-figure not-content" aria-label="The five parts of a context">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="Construct">
          <span className="ce-bar-label">Construct</span>
          {CONSTRUCTS.map((item) => (
            <button key={item.id} type="button" className="ce-btn" aria-pressed={item.id === id} onClick={() => setId(item.id)}>
              {item.title}
            </button>
          ))}
        </div>
      </div>

      <div className="ce-stage">
        <p style={{ margin: "0 0 var(--space-4)" }}>
          <span className="ce-badge" data-side={construct.side}>
            {construct.side === "derive" ? "derive: pure" : "run: effects in order"}
          </span>{" "}
          {construct.summary}
        </p>
        <div className="ce-context">
          <div className="ce-context-term">
            <span className="ce-doc-label">The term</span>
            <pre className="ce-doc">{prettyJson(construct.example)}</pre>
          </div>
          {PART_INFO.map((info) => {
            const use = construct.uses[info.part as Part];
            return (
              <div key={info.part} data-part={info.part} style={{ display: "contents" }}>
                <div className="ce-context-part" title={info.reaches}>
                  <span className="ce-swatch" aria-hidden="true" />
                  {info.title}
                </div>
                <ReadGlyph use={use} />
                <GiveGlyph use={use} />
                <div className="ce-context-note">{use.note}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ce-stage" style={{ borderTop: "1px solid var(--color-rule)" }}>
        <p className="ce-panel-title">All six constructs. Select a row to see it above.</p>
        <div className="ce-scroll">
          <table className="ce-matrix">
            <thead>
              <tr>
                <th>Construct</th>
                <th>Side</th>
                {PART_INFO.map((info) => (
                  <th key={info.part} data-part={info.part}>
                    <span className="ce-matrix-cell">
                      <span className="ce-swatch" aria-hidden="true" />
                      {info.title}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CONSTRUCTS.map((item) => (
                <tr
                  key={item.id}
                  aria-selected={item.id === id}
                  tabIndex={0}
                  onClick={() => setId(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setId(item.id);
                    }
                  }}
                >
                  <th scope="row">{item.title}</th>
                  <td>
                    <span className="ce-badge" data-side={item.side}>
                      {item.side}
                    </span>
                  </td>
                  {PART_INFO.map((info) => {
                    const use = item.uses[info.part as Part];
                    const off = !use.reads && use.gives === "none";
                    return (
                      <td key={info.part} data-part={info.part}>
                        <span className="ce-matrix-cell" data-off={off}>
                          {off ? "not used" : `${use.reads ? "reads" : "passes"}, gives ${GIVE_WORDS[use.gives]}`}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <figcaption className="ce-caption">
        A term reaches outside itself only through these five parts. The constructs differ in which parts they read, and
        in what they give the parts of their body. A pure construct gives its parts no capability.
      </figcaption>
    </figure>
  );
}
