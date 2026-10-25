import { useMemo, useState } from "react";
import type { Json, MachinePart, MergeConflict } from "@mark1russell7/coeval";
import { Port } from "../glyphs/Card.tsx";
import {
  BASE,
  LANGUAGES,
  PROBES,
  conflictAt,
  entryAt,
  entryText,
  evaluateWith,
  mergeLanguages,
  mergeRows,
  restrictLanguages,
  type Language,
  type MergeRow,
} from "../lib/languages.ts";

/** One part of the merge, in the order of `mergeMachines`. The base has the index 0. */
interface Column {
  readonly id: string;
  readonly label: string;
  readonly index: number;
  readonly part: MachinePart;
}

type RowState = "new" | "same" | "replaced" | "conflict" | "namespace" | "removed";

interface RowView {
  readonly row: MergeRow;
  readonly state: RowState;
  readonly givers: readonly Column[];
  readonly conflict?: MergeConflict;
  readonly winner?: Column;
}

const STATE_TEXT: Readonly<Record<RowState, string>> = {
  new: "New entry",
  same: "Same entry",
  replaced: "Replaced",
  conflict: "Conflict",
  namespace: "Key by key",
  removed: "Removed",
};

const STATE_GLYPH: Readonly<Record<RowState, string>> = {
  new: "+",
  same: "=",
  replaced: "↻",
  conflict: "✕",
  namespace: "⋯",
  removed: "−",
};

function pathJson(path: readonly unknown[]): string {
  return JSON.stringify(path);
}

/** This function writes the call of the merge that the diagram makes, as TypeScript. */
function callText(columns: readonly Column[], marks: Readonly<Record<string, readonly string[]>>, removed: readonly string[], ok: boolean): string {
  const parts = columns.slice(1).map((column) => {
    const name = column.id.toUpperCase();
    const keys = marks[column.id] ?? [];
    return keys.length === 0 ? name : `{ ...${name}, replaces: [${keys.join(", ")}] }`;
  });
  const merge = `const machine = mergeMachines(${["base", ...parts].join(", ")});`;
  if (!ok || removed.length === 0) return merge;
  return `${merge}\nconst smaller = restrictMachine(machine, [${removed.join(", ")}]);`;
}

/**
 * The merge diagram. A reader picks the languages that join a base. The diagram merges them with `mergeMachines`, and
 * shows each path: the part that gives it, and what the merge does there. A conflict shows the `MergeError` with its
 * paths, and a mark in `replaces` resolves it. A reader can also remove entries with `restrictMachine`.
 */
export default function MergeDiagram() {
  const [on, setOn] = useState<Readonly<Record<string, boolean>>>({ stats: true, text: true, rival: true });
  const [marks, setMarks] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [removed, setRemoved] = useState<readonly string[]>([]);

  const languages: readonly Language[] = useMemo(() => LANGUAGES.filter((language) => on[language.id] === true), [on]);
  const columns: readonly Column[] = useMemo(
    () => [
      { id: "base", label: "Base", index: 0, part: BASE },
      ...languages.map((language, index) => ({ id: language.id, label: language.label, index: index + 1, part: language.part })),
    ],
    [languages],
  );
  const rows = useMemo(() => mergeRows(languages), [languages]);
  const outcome = useMemo(() => mergeLanguages(languages, marks), [languages, marks]);
  const rowKeys = new Set(rows.map((row) => row.key));
  const cut = removed.filter((key) => rowKeys.has(key));
  const machine = outcome.ok ? restrictLanguages(outcome.machine, cut) : undefined;
  const conflicts = outcome.ok ? [] : outcome.error.conflicts;

  const views: readonly RowView[] = rows.map((row) => {
    const givers = columns.filter((column) => entryAt(column.part, row.path) !== undefined);
    const conflict = conflictAt(conflicts, row.key);
    if (conflict !== undefined) return { row, state: "conflict", givers, conflict };
    if (row.namespace) return { row, state: "namespace", givers };
    if (outcome.ok && cut.includes(row.key)) return { row, state: "removed", givers };
    if (givers.length <= 1) return { row, state: "new", givers };
    const winner = [...givers.slice(1)].reverse().find((column) => (marks[column.id] ?? []).includes(row.key));
    return winner === undefined ? { row, state: "same", givers } : { row, state: "replaced", givers, winner };
  });

  const columnAt = (index: number): Column | undefined => columns.find((column) => column.index === index);

  const toggleLanguage = (id: string): void => setOn((current) => ({ ...current, [id]: current[id] !== true }));
  const mark = (column: Column, key: string): void =>
    setMarks((current) => ({ ...current, [column.id]: [...(current[column.id] ?? []).filter((item) => item !== key), key] }));
  const unmark = (column: Column, key: string): void =>
    setMarks((current) => ({ ...current, [column.id]: (current[column.id] ?? []).filter((item) => item !== key) }));
  const markAll = (): void => {
    for (const conflict of conflicts) {
      const later = columnAt(conflict.parts[1]);
      if (later !== undefined) mark(later, JSON.stringify(conflict.path.map(String)));
    }
  };
  const toggleRemoved = (key: string): void =>
    setRemoved((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  const reset = (): void => {
    setMarks({});
    setRemoved([]);
  };

  const baseKinds = Object.keys(BASE.world.kinds).length;
  const baseCode = Object.keys(BASE.evaluators).length;
  const groups: readonly { readonly id: MergeRow["group"]; readonly title: string }[] = [
    { id: "world", title: "The world: kinds, aliases and namespaces" },
    { id: "evaluators", title: "The code: evaluators" },
  ];

  return (
    <figure className="ce-figure not-content" aria-label="The merge of languages: each path, the parts that give it, and the result">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="Languages after the base">
          <span className="ce-bar-label">After the base</span>
          {LANGUAGES.map((language) => (
            <button key={language.id} type="button" className="ce-btn" aria-pressed={on[language.id] === true} onClick={() => toggleLanguage(language.id)}>
              {language.label}
            </button>
          ))}
        </div>
        <button type="button" className="ce-btn" onClick={reset} disabled={Object.values(marks).every((keys) => keys.length === 0) && removed.length === 0}>
          Clear the marks
        </button>
      </div>

      <div className="ce-stage">
        <ol className="ce-merge-parts" aria-label="The parts of the merge, in order">
          {columns.map((column) => (
            <li key={column.id}>
              <span className="ce-merge-index">{column.index}</span>
              <strong>{column.label}</strong>
              <span className="ce-merge-summary">
                {column.index === 0 ? `The formula kit: ${baseKinds} kinds and ${baseCode} evaluators.` : LANGUAGES.find((item) => item.id === column.id)?.summary}
              </span>
            </li>
          ))}
        </ol>

        <p className="ce-panel-title">The call</p>
        <pre className="ce-doc ce-merge-call">{callText(columns, marks, cut, outcome.ok)}</pre>

        <p className="ce-panel-title">The merge, path by path</p>
        <div className="ce-merge-wrap">
          <table className="ce-merge" data-columns={columns.length}>
            <colgroup>
              <col className="ce-merge-col-path" />
              {columns.map((column) => (
                <col key={column.id} />
              ))}
              <col className="ce-merge-col-result" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Path</th>
                {columns.map((column) => (
                  <th key={column.id} scope="col">
                    <span className="ce-merge-index">{column.index}</span> {column.label}
                  </th>
                ))}
                <th scope="col">The merge</th>
              </tr>
            </thead>
            {groups.map((group) => {
              const items = views.filter((view) => view.row.group === group.id);
              if (items.length === 0) return null;
              return (
                <tbody key={group.id}>
                  <tr className="ce-merge-group">
                    <th scope="rowgroup" colSpan={columns.length + 2}>
                      {group.title}
                    </th>
                  </tr>
                  {items.map((view) => {
                    const { row, state } = view;
                    const held = machine === undefined ? undefined : entryAt(machine, row.path);
                    const heldText = held === undefined ? undefined : entryText(held);
                    const later = view.conflict === undefined ? undefined : columnAt(view.conflict.parts[1]);
                    return (
                      <tr key={row.key} data-state={state}>
                        <th scope="row" className="ce-merge-path" style={{ paddingLeft: `calc(var(--space-3) + ${row.depth * 1.1}rem)` }}>
                          {row.label.join(" › ")}
                        </th>
                        {columns.map((column) => {
                          const entry = entryAt(column.part, row.path);
                          if (entry === undefined) {
                            return (
                              <td key={column.id} className="ce-merge-cell" data-empty="true" data-label={`${column.index} ${column.label}`}>
                                <span aria-label="No entry">·</span>
                              </td>
                            );
                          }
                          const text = entryText(entry);
                          const clash = view.conflict !== undefined && view.conflict.parts.includes(column.index);
                          const cell =
                            state === "conflict" ? (clash ? "clash" : "plain")
                            : state === "replaced" ? (view.winner === column ? "wins" : "lost")
                            : state === "removed" ? "lost"
                            : "plain";
                          return (
                            <td key={column.id} className="ce-merge-cell" data-label={`${column.index} ${column.label}`}>
                              <span className="ce-merge-entry" data-cell={cell}>
                                <span className="ce-merge-what">{text.what}</span>
                                <span className="ce-merge-value">{text.text}</span>
                                {text.note !== undefined && <small>{text.note}</small>}
                                {cell === "wins" && <span className="ce-merge-stamp">replaces</span>}
                              </span>
                            </td>
                          );
                        })}
                        <td className="ce-merge-result" data-label="The merge">
                          <span className="ce-merge-state" data-state={state}>
                            <span aria-hidden="true">{STATE_GLYPH[state]}</span> {STATE_TEXT[state]}
                          </span>
                          {state === "conflict" && view.conflict !== undefined && <span className="ce-merge-reason">{view.conflict.reason}</span>}
                          {heldText !== undefined && state !== "conflict" && (
                            <span className="ce-merge-held">
                              {heldText.what} <code>{heldText.text}</code>
                            </span>
                          )}
                          {state === "replaced" && view.winner !== undefined && <span className="ce-merge-reason">Part {view.winner.index} wins at this path.</span>}
                          <span className="ce-merge-actions">
                            {state === "conflict" && later !== undefined && (
                              <button type="button" className="ce-btn ce-btn-small" onClick={() => mark(later, row.key)}>
                                Mark it in replaces of {later.label}
                              </button>
                            )}
                            {state === "replaced" && view.winner !== undefined && (
                              <button type="button" className="ce-btn ce-btn-small" onClick={() => unmark(view.winner as Column, row.key)}>
                                Remove the mark
                              </button>
                            )}
                            {outcome.ok && !row.namespace && (
                              <button type="button" className="ce-btn ce-btn-small" aria-pressed={state === "removed"} onClick={() => toggleRemoved(row.key)}>
                                {state === "removed" ? "Put it back" : "Restrict it"}
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
            <tbody>
              <tr className="ce-merge-rest">
                <td colSpan={columns.length + 2}>
                  The base also gives the other kinds and evaluators of the formula kit. No language gives an entry at their paths, thus the merge keeps them.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {!outcome.ok ? (
          <div className="ce-merge-error" role="status" aria-live="polite">
            <p className="ce-merge-error-head">
              <strong>MergeError</strong> {conflicts.length === 1 ? "The merge has 1 conflict." : `The merge has ${conflicts.length} conflicts.`} The host gets
              it when it builds the machine, before a document evaluates.
            </p>
            <ul>
              {conflicts.map((conflict) => (
                <li key={pathJson(conflict.path)}>
                  <code>{pathJson(conflict.path)}</code>
                  <span>
                    Parts {conflict.parts[0]} and {conflict.parts[1]}: {conflict.reason}
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" className="ce-btn" data-variant="primary" onClick={markAll}>
              Mark each path in replaces
            </button>
          </div>
        ) : (
          <div className="ce-result" role="status" aria-live="polite">
            <span>
              The merge gives one machine. {cut.length > 0 ? `restrictMachine removes ${cut.length === 1 ? "1 entry" : `${cut.length} entries`}.` : ""}
            </span>
          </div>
        )}

        <p className="ce-panel-title" style={{ marginTop: "var(--space-5)" }}>
          Three documents, evaluated with this machine
        </p>
        <ul className="ce-merge-probes">
          {PROBES.map((item) => (
            <li key={item.id}>
              <code className="ce-merge-probe-doc">{JSON.stringify(item.doc as Json)}</code>
              {machine === undefined ? <span className="ce-merge-none">No machine</span> : <Port result={evaluateWith(machine, item.doc)} />}
            </li>
          ))}
        </ul>
      </div>

      <figcaption className="ce-caption">
        Each row is one path. A dot means that the part has no entry there. Equal entries give one entry, and namespaces merge key by key. Each other
        clash is a conflict, until the later part names the path in <code>replaces</code>.
      </figcaption>
    </figure>
  );
}
