import { useId, useMemo, useState, type ReactNode } from "react";
import { EXAMPLES, PROFILES, fixityText, kitRead, profileOf, textPieces, treeRows, usedKinds, type ProfileId, type TreeRow } from "../lib/syntax-kit.ts";

/** This function writes a text with code spans in backticks as code elements. */
function withCode(text: string): ReactNode[] {
  return text.split("`").map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part));
}

/** The text with a mark at the span of each issue, and the number of the issue after the mark. */
function MarkedText({ text, issues }: { readonly text: string; readonly issues: Parameters<typeof textPieces>[1] }) {
  const pieces = textPieces(text, issues);
  return (
    <pre className="ce-mono" aria-hidden="true" style={{ margin: 0, padding: "var(--space-2) var(--space-3)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "var(--color-surface-sunken)", borderRadius: "var(--radius)" }}>
      {pieces.map((piece, index) =>
        piece.issues.length === 0 ? (
          <span key={index}>{piece.text}</span>
        ) : (
          <span key={index}>
            <mark className="cv-syntax-mark" data-empty={piece.gap ? "true" : undefined}>
              {piece.text}
            </mark>
            <sup style={{ color: "var(--ce-stop)", fontWeight: 700 }}>{piece.issues.join(",")}</sup>
          </span>
        ),
      )}
    </pre>
  );
}

/** One row of the outline of the document: the key in its parent, the kind, the value and the header name. */
function Row({ row }: { readonly row: TreeRow }) {
  return (
    <li style={{ paddingLeft: `calc(${String(row.depth)} * 1.25rem)`, backgroundImage: row.depth === 0 ? undefined : "linear-gradient(var(--color-rule-strong), var(--color-rule-strong))", backgroundSize: "1px 100%", backgroundPosition: `calc(${String(row.depth)} * 1.25rem - 0.7rem) 0`, backgroundRepeat: "no-repeat" }}>
      {row.key !== undefined && <span style={{ color: "var(--color-ink-muted)" }}>{row.key}: </span>}
      {row.kind !== undefined && <strong>{row.kind}</strong>}
      {row.kind !== undefined && row.value !== undefined && " "}
      {row.value !== undefined && <span style={{ color: row.kind === "ref" ? "var(--ce-names)" : undefined }}>{row.value}</span>}
      {row.name !== undefined && (
        <span className="ce-chip" style={{ marginLeft: "0.5em" }}>
          name {row.name}
        </span>
      )}
    </li>
  );
}

/** The table of the operators of the profile. A row of an operator that the text uses is marked. */
function Operators({ id, used }: { readonly id: ProfileId; readonly used: ReadonlySet<string> }) {
  const operators = profileOf(id).profile.operators ?? [];
  return (
    <div className="ce-scroll scroll-cue" tabIndex={0} aria-label="The operators of the profile">
      <table className="ce-matrix">
        <caption style={{ textAlign: "left", paddingBottom: "var(--space-1)" }}>The operators of the profile, from the loosest to the tightest</caption>
        <thead>
          <tr>
            <th scope="col">Text</th>
            <th scope="col">Binds</th>
            <th scope="col">Place</th>
            <th scope="col">Document</th>
          </tr>
        </thead>
        <tbody>
          {operators.map((op) => {
            const on = used.has(op.kind);
            return (
              <tr key={`${op.symbol} ${op.fixity}`} data-used={on ? "true" : undefined} style={on ? { background: "var(--ce-answer-wash)", fontWeight: 700 } : undefined}>
                <td className="ce-mono">
                  {on && <span aria-label="used by the text">▸ </span>}
                  {op.symbol}
                </td>
                <td>{op.prec}</td>
                <td>{fixityText(op)}</td>
                <td className="ce-mono">{op.kind}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * This component reads a text with a profile of the syntax kit. It shows each issue at its span, the document, the
 * printed text with its round trip, and the operators of the profile.
 */
export default function SyntaxKitDiagram() {
  const [id, setId] = useState<ProfileId>("standard");
  const [text, setText] = useState<string>(EXAMPLES[0]?.text ?? "");
  const inputId = useId();
  const read = useMemo(() => kitRead(id, text), [id, text]);
  const rows = useMemo(() => (read.ok ? treeRows(read.doc) : []), [read]);
  const used = useMemo(() => usedKinds(rows), [rows]);
  const profile = profileOf(id);

  return (
    <figure className="ce-figure not-content" aria-label="Read a text with a profile of the syntax kit">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="The profile">
          <span className="ce-bar-label">Profile</span>
          {PROFILES.map((item) => (
            <button key={item.id} type="button" className="ce-btn" aria-pressed={item.id === id} onClick={() => setId(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="ce-bar-group" role="group" aria-label="The examples">
          <span className="ce-bar-label">Examples</span>
          {EXAMPLES.map((example) => (
            <button key={example.text} type="button" className="ce-btn ce-btn-small ce-mono" aria-pressed={example.text === text} title={example.note} onClick={() => setText(example.text)}>
              {example.text}
            </button>
          ))}
        </div>
      </div>

      <div className="ce-stage" style={{ display: "grid", gap: "var(--space-3)" }}>
        <p style={{ margin: 0 }}>{withCode(profile.note)}</p>
        <label htmlFor={inputId} className="ce-bar-label">
          The text
        </label>
        <input
          id={inputId}
          className="ce-mono"
          type="text"
          value={text}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!read.ok}
          aria-describedby={`${inputId}-status`}
          onChange={(event) => setText(event.target.value)}
          style={{ width: "100%", padding: "var(--space-2) var(--space-3)", font: "inherit", fontFamily: "var(--font-mono)", border: "1px solid var(--color-rule-strong)", borderRadius: "var(--radius)", background: "var(--color-surface)", color: "var(--color-ink)" }}
        />
        <div id={`${inputId}-status`} aria-live="polite">
          {read.ok ? (
            <p className="ce-result" data-state="go" style={{ margin: 0 }}>
              The profile <strong>{profile.label}</strong> reads the text as one document. The tree has {rows.length} {rows.length === 1 ? "node" : "nodes"}.
            </p>
          ) : (
            <div className="ce-result" data-state="stop" style={{ display: "grid", gap: "var(--space-2)" }}>
              <span>
                The profile <strong>{profile.label}</strong> gives {read.issues.length} {read.issues.length === 1 ? "issue" : "issues"} and no document.
              </span>
              <MarkedText text={text} issues={read.issues} />
              <ol style={{ margin: 0, paddingLeft: "1.4rem" }}>
                {read.issues.map((issue, index) => (
                  <li key={index}>
                    At character {issue.offset + 1}
                    {issue.length === 0 ? " (between two characters)" : issue.length === 1 ? "" : ` (${String(issue.length)} characters)`}: {issue.message}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <div className="ce-two">
          <section aria-label="The document">
            <h4 className="ce-bar-label" style={{ margin: "0 0 var(--space-2)" }}>
              The document
            </h4>
            {read.ok ? (
              <ul className="ce-mono" style={{ listStyle: "none", margin: 0, padding: "var(--space-2) var(--space-3)", lineHeight: 1.7, fontSize: "0.85rem", background: "var(--color-surface-sunken)", borderRadius: "var(--radius)", overflowWrap: "anywhere" }}>
                {rows.map((row, index) => (
                  <Row key={index} row={row} />
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, color: "var(--color-ink-muted)" }}>No document. Correct each issue, or select another profile.</p>
            )}
            {read.ok && (
              <div style={{ marginTop: "var(--space-3)", display: "grid", gap: "var(--space-1)" }}>
                <span className="ce-bar-label">The printed text</span>
                <code className="ce-mono" style={{ overflowWrap: "anywhere" }}>{read.printed ?? `no text: ${read.printIssue ?? ""}`}</code>
                <span className="ce-verdict" data-ok={read.roundTrip ? "true" : "false"}>
                  {read.roundTrip ? "✓ The printed text reads back to the same document." : "✗ The printed text does not read back to the same document."}
                </span>
              </div>
            )}
          </section>
          <Operators id={id} used={used} />
        </div>
      </div>

      <figcaption className="ce-caption">
        One parser and one printer read each profile as data. Select a profile, and the same text gives another tree or an issue. A <strong>wavy red mark</strong> with a number is the span of an issue, and a <strong>red bar</strong> is an issue between two characters. A row of the table with <strong>▸</strong> is an operator that the text uses.
      </figcaption>
    </figure>
  );
}
