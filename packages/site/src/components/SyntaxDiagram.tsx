import { useMemo, useRef, useState } from "react";
import type { SyntaxIssue } from "@mark1russell7/coeval";
import { KIT_EXAMPLES, PROFILE_ROWS, issuePieces, outline, printEach, started, switched, typed, type KitExample, type KitState, type OutlineNode, type PrintedRow, type ProfileId } from "../lib/profiles.ts";

const FIRST: KitExample = KIT_EXAMPLES[0] ?? { id: "empty", label: "", profile: "symbols", text: "1" };
/** The document that a good example gives. A bad example keeps it in the tree. */
const FIRST_STATE: KitState = started(FIRST.profile, FIRST.text);

/** The tree of a document: one line for each node, in a nested list. */
function OutlineList({ nodes }: { readonly nodes: readonly OutlineNode[] }) {
  return (
    <ul className="ce-outline">
      {nodes.map((node, index) => (
        <li key={`${node.key ?? ""}${index}`}>
          {node.key !== undefined && <span className="ce-outline-key">{node.key}</span>}
          <span className="ce-mono">{node.label}</span>
          {node.children.length > 0 && <OutlineList nodes={node.children} />}
        </li>
      ))}
    </ul>
  );
}

/** One profile as a button, with the text of the document in that profile. */
function ProfileButton({ row, pressed, onSelect }: { readonly row: PrintedRow; readonly pressed: boolean; readonly onSelect: (id: ProfileId) => void }) {
  const profile = PROFILE_ROWS.find((each) => each.id === row.id);
  return (
    <button type="button" className="ce-profile" aria-pressed={pressed} onClick={() => onSelect(row.id)}>
      <span className="ce-profile-name">{profile?.label}</span>
      <span className="ce-profile-note">{profile?.note}</span>
      {row.ok ? <code className="ce-mono ce-profile-text">{row.text}</code> : <span className="ce-profile-none">✕ No text. {row.reason}</span>}
    </button>
  );
}

/** The issues of a text, each with a button that selects its span in the text box. */
function IssueList({ text, issues, onSelect }: { readonly text: string; readonly issues: readonly SyntaxIssue[]; readonly onSelect: (issue: SyntaxIssue) => void }) {
  return (
    <div className="ce-result" data-state="stop" style={{ display: "block", marginTop: 0 }}>
      <pre className="cv-syntax-echo" aria-hidden="true" style={{ margin: "0 0 var(--space-2)" }}>
        {issuePieces(text, issues).map((piece, index) =>
          piece.issue === undefined ? (
            piece.text
          ) : (
            <mark key={index} className="cv-syntax-mark" data-empty={piece.text === "" ? "true" : undefined}>
              {piece.text}
            </mark>
          ),
        )}
      </pre>
      <ul className="ce-issues">
        {issues.map((issue, index) => (
          <li key={index}>
            <span className="cv-syntax-label">Problem</span> at character {issue.offset + 1}: {issue.message}{" "}
            <button type="button" className="ce-btn" onClick={() => onSelect(issue)}>
              Select it in the text
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** This component reads a text with a profile that the reader selects. Each answer comes from `parse` and `print`. */
export default function SyntaxDiagram() {
  const [state, setState] = useState<KitState>(FIRST_STATE);
  const box = useRef<HTMLTextAreaElement>(null);
  const rows = useMemo(() => printEach(state.doc), [state.doc]);
  const tree = useMemo(() => outline(state.doc), [state.doc]);
  const bad = state.issues.length > 0;

  const choose = (example: KitExample): void => {
    setState(typed({ ...state, profile: example.profile }, example.text));
  };

  const selectIssue = (issue: SyntaxIssue): void => {
    box.current?.focus();
    box.current?.setSelectionRange(issue.offset, issue.offset + issue.length);
  };

  return (
    <figure className="ce-figure not-content" aria-label="One parser reads a text with a profile that the reader selects">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="The texts to try">
          <span className="ce-bar-label">Try</span>
          {KIT_EXAMPLES.map((example) => (
            <button key={example.id} type="button" className="ce-btn" aria-pressed={example.text === state.text} onClick={() => choose(example)}>
              {example.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ce-stage">
        <label className="ce-bar-label" htmlFor="ce-syntax-text">
          The text
        </label>
        <textarea
          id="ce-syntax-text"
          ref={box}
          className="cv-syntax-text"
          value={state.text}
          spellCheck={false}
          rows={2}
          aria-describedby="ce-syntax-status"
          aria-invalid={bad}
          onChange={(event) => setState(typed(state, event.target.value))}
        />

        <div id="ce-syntax-status" aria-live="polite" style={{ margin: "var(--space-2) 0 var(--space-3)" }}>
          {bad ? (
            <IssueList text={state.text} issues={state.issues} onSelect={selectIssue} />
          ) : (
            <div className="ce-result" data-state="go" style={{ marginTop: 0 }}>
              <span>
                <code>parse</code> gives the document below.
              </span>
            </div>
          )}
        </div>

        <div className="ce-kit">
          <section aria-label="The profiles">
            <h3 className="ce-bar-label ce-kit-head">{bad ? "The last good document, in each profile" : "This document, in each profile"}</h3>
            <div className="ce-profiles">
              {rows.map((row) => (
                <ProfileButton key={row.id} row={row} pressed={row.id === state.profile} onSelect={(id) => setState(switched(state, id))} />
              ))}
            </div>
          </section>
          <section aria-label="The document">
            <h3 className="ce-bar-label ce-kit-head">{bad ? "The last good document" : "The document"}</h3>
            <div data-stale={bad ? "true" : undefined} className="ce-outline-frame">
              <OutlineList nodes={[tree]} />
            </div>
          </section>
        </div>
      </div>

      <figcaption className="ce-caption">
        The site runs <code>parse</code> and <code>print</code> in this page for each change. Select a profile to write the same document in that profile. A profile with no text for the document reads the old text.
      </figcaption>
    </figure>
  );
}
