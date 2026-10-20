import { useEffect, useMemo, useRef, useState } from "react";
import RefArrows from "../glyphs/RefArrows.tsx";
import { links } from "../lib/scope.ts";
import { STD_CAPS, evaluate, flatten, fromJson, kindNamed, makeContext, typed, type Json, type TraceNode } from "@coeval/core";
import Explorer, { SITE_MACHINE, pathText } from "../glyphs/Explorer.tsx";
import { Port } from "../glyphs/Card.tsx";
import { EffectsLog } from "../glyphs/Panels.tsx";
import { View, SITE_WORLD, WorldContext } from "../glyphs/View.tsx";
import { OverlayContext, pathKey, type Overlay } from "../glyphs/overlay.ts";
import { appendAt, declaredAt, getAt, newDoc, newPart, removeAt, setAt } from "../lib/edit.ts";
import { prettyJson } from "../lib/motion.ts";
import { PROGRAMS } from "../lib/programs.ts";

const KINDS = Object.keys(SITE_WORLD.kinds).filter((name) => name !== "kind");

/** This function reads a document from the hash of the address, so that a link can open the playground with it. */
function fromHash(): Json | undefined {
  try {
    const match = /#doc=([^&]+)/.exec(window.location.hash);
    if (match?.[1] === undefined) return undefined;
    return JSON.parse(decodeURIComponent(match[1])) as Json;
  } catch {
    return undefined;
  }
}

/**
 * The playground. A reader builds a document from the kinds of the world: select a card, then change its kind, its
 * value, its name or its parts. The picture evaluates at each change. Each card is the same glyph as on the other
 * pages, thus each larger document is drawn from the same parts.
 */
export default function Playground() {
  const [programId, setProgramId] = useState("names");
  const program = PROGRAMS.find((item) => item.id === programId) ?? PROGRAMS[0];
  const [doc, setDoc] = useState<Json>(program?.doc ?? newDoc("add"));
  const [names, setNames] = useState<Readonly<Record<string, Json>>>(program?.names ?? {});
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [jsonText, setJsonText] = useState(prettyJson(doc));
  const [jsonError, setJsonError] = useState<string | undefined>(undefined);
  const [stepping, setStepping] = useState(false);
  const picture = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const linked = fromHash();
    if (linked !== undefined) {
      setDoc(linked);
      setNames({});
      setJsonText(prettyJson(linked));
    }
  }, []);

  const load = (id: string): void => {
    const next = PROGRAMS.find((item) => item.id === id);
    if (next === undefined) return;
    setProgramId(id);
    setDoc(next.doc);
    setNames(next.names ?? {});
    setSelected([]);
    setJsonText(prettyJson(next.doc));
    setJsonError(undefined);
  };

  const change = (next: Json): void => {
    setDoc(next);
    setJsonText(prettyJson(next));
    setJsonError(undefined);
  };

  const run = useMemo(() => evaluate(SITE_MACHINE, doc, makeContext(names, STD_CAPS)), [doc, names]);
  const nodes = useMemo(() => {
    const map = new Map<string, TraceNode>();
    for (const node of flatten(run.trace)) if (!map.has(pathKey(node.path))) map.set(pathKey(node.path), node);
    return map;
  }, [run]);
  const overlay: Overlay = {
    run,
    nodes,
    tick: run.time,
    showRungs: false,
    selected: pathKey(selected),
    onSelect: (path) => setSelected(path),
  };

  const refLinks = useMemo(() => links(doc), [doc]);
  const node = getAt(doc, selected);
  const envelope = node === undefined ? undefined : fromJson(node);
  const declared = declaredAt(SITE_WORLD, doc, selected);
  const type = envelope?.type ?? declared ?? "?";
  const value = envelope === undefined ? node : envelope.value;
  const kind = kindNamed(SITE_WORLD, type);
  const parentValue = selected.length === 0 ? undefined : getAt(doc, selected.slice(0, -1));
  const inList = parentValue !== undefined && Array.isArray(fromJson(parentValue)?.value ?? parentValue);

  const setValue = (next: Json): void => {
    change(setAt(doc, selected, envelope === undefined ? next : { ...envelope, value: next }));
  };

  return (
    <figure className="ce-figure cv-playground not-content" aria-label="The playground">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="Start from">
          <span className="ce-bar-label">Start from</span>
          {PROGRAMS.map((item) => (
            <button key={item.id} type="button" className="ce-btn" aria-pressed={item.id === programId} onClick={() => load(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cv-stage" data-panel="true">
        <div className="cv-picture" ref={picture}>
          <p className="cv-small cv-muted">Select a card to edit it. The picture evaluates after each change.</p>
          <WorldContext.Provider value={SITE_WORLD}>
            <OverlayContext.Provider value={overlay}>
              <View doc={doc} />
            </OverlayContext.Provider>
          </WorldContext.Provider>
          <RefArrows container={picture} links={refLinks} version={`${JSON.stringify(doc).length}:${pathKey(selected)}`} />
        </div>

        <aside className="cv-panel" aria-label="Edit the selected card">
          <p className="cv-panel-title">
            The selected card: <span className="ce-mono">{type}</span>
            {selected.length > 0 && <span className="cv-muted"> at {pathText(selected)}</span>}
          </p>
          {envelope === undefined && declared !== undefined && (
            <p className="cv-small cv-muted">This value is bare. Its list declares the type {declared}.</p>
          )}

          <label className="cv-field-edit">
            <span>Kind</span>
            <select
              value={kind === undefined ? "" : type}
              onChange={(event) => {
                const next = newDoc(event.target.value);
                const keep = envelope?.name;
                const withName = keep === undefined ? next : { ...(fromJson(next) ?? typed(event.target.value, null)), name: keep };
                change(setAt(doc, selected, withName));
              }}
            >
              {kind === undefined && <option value="">{type}</option>}
              {KINDS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          {(type === "number" || type === "text" || type === "ref") && (
            <label className="cv-field-edit">
              <span>{type === "ref" ? "Path" : "Value"}</span>
              <input
                type={type === "number" ? "number" : "text"}
                value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
                onChange={(event) => setValue(type === "number" ? Number(event.target.value) : event.target.value)}
              />
            </label>
          )}
          {type === "bool" && (
            <label className="ce-check">
              <input type="checkbox" checked={value === true} onChange={(event) => setValue(event.target.checked)} />
              The value is true
            </label>
          )}

          <label className="cv-field-edit">
            <span>Name</span>
            <input
              type="text"
              placeholder={envelope === undefined ? "needs an envelope" : "no name"}
              value={envelope?.name ?? ""}
              onChange={(event) => {
                const base = envelope ?? typed(type, value ?? null);
                const { name: _old, ...rest } = base;
                const next = event.target.value === "" ? rest : { ...rest, name: event.target.value };
                change(setAt(doc, selected, next as Json));
              }}
            />
          </label>

          <div className="ce-bar-group">
            {kind?.parts?.shape === "list" && (
              <button type="button" className="ce-btn" onClick={() => change(appendAt(doc, selected, newPart(SITE_WORLD, type)))}>
                Add a part
              </button>
            )}
            {inList && (
              <button
                type="button"
                className="ce-btn"
                onClick={() => {
                  change(removeAt(doc, selected));
                  setSelected(selected.slice(0, -1));
                }}
              >
                Remove this card
              </button>
            )}
            {selected.length > 0 && (
              <button type="button" className="ce-btn" onClick={() => setSelected(selected.slice(0, -1))}>
                Select the parent
              </button>
            )}
            <button type="button" className="ce-btn" onClick={() => change(setAt(doc, selected, typed("list", [node ?? null])))}>
              Put in a list
            </button>
          </div>

          <div className="cv-small">
            <span className="cv-panel-head">Its result</span>{" "}
            {nodes.get(pathKey(selected)) === undefined ? (
              <span className="cv-muted">not evaluated</span>
            ) : (
              <Port result={(nodes.get(pathKey(selected)) as TraceNode).result} />
            )}
          </div>
          {kind?.summary !== undefined && <p className="cv-small cv-muted">{kind.summary}</p>}
        </aside>
      </div>

      {run.effects.length > 0 && <EffectsLog effects={run.effects} tick={run.time} />}

      <div className="cv-final">
        <span>The result:</span> <Port result={run.result} />
        <button type="button" className="ce-btn" aria-pressed={stepping} onClick={() => setStepping((value_) => !value_)}>
          {stepping ? "Hide the steps" : "Step through it"}
        </button>
      </div>

      {stepping && (
        <div className="cv-stepping">
          <Explorer doc={doc} names={names} label="The steps of the document of the playground" initial="start" />
        </div>
      )}

      <details className="cv-details cv-json-edit">
        <summary>Edit the JSON</summary>
        <textarea
          value={jsonText}
          spellCheck={false}
          onChange={(event) => setJsonText(event.target.value)}
          aria-label="The JSON of the document"
        />
        <div className="ce-bar-group">
          <button
            type="button"
            className="ce-btn"
            onClick={() => {
              try {
                const parsed = JSON.parse(jsonText) as Json;
                setDoc(parsed);
                setSelected([]);
                setJsonError(undefined);
              } catch (error) {
                setJsonError(String(error));
              }
            }}
          >
            Use this JSON
          </button>
          {jsonError !== undefined && <span className="cv-problem">{jsonError}</span>}
        </div>
      </details>
    </figure>
  );
}
