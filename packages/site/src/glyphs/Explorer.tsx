import { useEffect, useMemo, useRef, useState } from "react";
import {
  STD_CAPS,
  STD_EVALUATORS,
  STD_WALKERS,
  evaluate,
  flatten,
  fromJson,
  isRecord,
  kindNamed,
  makeContext,
  splitParts,
  typeName,
  type Json,
  type Machine,
  type TraceNode,
} from "@mark1russell7/coeval";
import { Port } from "./Card.tsx";
import { ContextStrip, EffectsLog, LadderGlyph, SealedPart } from "./Panels.tsx";
import { View, SITE_WORLD, WorldContext } from "./View.tsx";
import { OverlayContext, pathKey, type Overlay } from "./overlay.ts";
import { useReducedMotion, prettyJson } from "../lib/motion.ts";
import { links } from "../lib/scope.ts";
import RefArrows from "./RefArrows.tsx";

/**
 * This function gives the address of the playground with a document in the hash.
 *
 * @param doc - The document.
 * @returns The address.
 */
export function playgroundHref(doc: Json): string {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  return `${base}/playground/#doc=${encodeURIComponent(JSON.stringify(doc))}`;
}

/** No names. One constant, so that a default does not change the props at each render. */
const NO_NAMES: Readonly<Record<string, Json>> = {};

/** The machine of the site: the world of the site, and the standard evaluators. */
export const SITE_MACHINE: Machine = { world: SITE_WORLD, evaluators: STD_EVALUATORS, walkers: STD_WALKERS };

/** The props of the explorer. */
export interface ExplorerProps {
  /** The document to evaluate, as JSON. */
  readonly doc: Json;
  /** The names of the context at the root, with their values. */
  readonly names?: Readonly<Record<string, Json>>;
  /** The capabilities at the root. The default is the effects of the standard world. */
  readonly caps?: readonly string[];
  /** The label of the figure. */
  readonly label: string;
  /** The caption under the figure. */
  readonly caption?: string;
  /** `start` shows the document before the evaluation. `end` shows the results. */
  readonly initial?: "start" | "end";
  /** `true` shows the panel of the current card. */
  readonly panel?: boolean;
}

/**
 * This function writes a path for a reader: the keys with an arrow between them.
 *
 * @param path - The keys from the root.
 * @returns The text, for example `1 › 0`.
 */
export function pathText(path: readonly string[]): string {
  return path.join(" › ");
}

function describe(node: TraceNode | undefined, ended: boolean): string {
  if (node === undefined) return "Nothing started yet. Select Next or Play.";
  const what = `${typeName(node.doc.type)}${node.path.length === 0 ? "" : ` at ${pathText(node.path)}`}`;
  if (!ended) {
    const rung = node.answer.rung;
    return rung === undefined
      ? `The evaluation of ${what} starts. No rung answers the verb eval.`
      : `The evaluation of ${what} starts. The ${rung === "own" ? "own entry" : rung} gives the evaluator ${node.answer.evaluator ?? "?"}.`;
  }
  return node.result.ok
    ? `The evaluation of ${what} ends with ${JSON.stringify(node.result.value)}.`
    : `The evaluation of ${what} ends with the error ${node.result.error.code}: ${node.result.error.reason}`;
}

/**
 * The explorer of an evaluation. It draws a document with its views, and steps through the evaluation one event
 * at a time: each start and each end. A panel shows the card of the current event. It shows the ladder that
 * chose its evaluator, its context, its sealed parts and its result.
 */
export default function Explorer({ doc, names = NO_NAMES, caps = STD_CAPS, label, caption, initial = "end", panel = true }: ExplorerProps) {
  const run = useMemo(() => evaluate(SITE_MACHINE, doc, makeContext(names, caps)), [doc, names, caps]);
  const ordered = useMemo(() => flatten(run.trace), [run]);
  const nodes = useMemo(() => {
    const map = new Map<string, TraceNode>();
    for (const node of ordered) if (!map.has(pathKey(node.path))) map.set(pathKey(node.path), node);
    return map;
  }, [ordered]);
  const events = useMemo(() => {
    const list: { readonly tick: number; readonly node: TraceNode; readonly end: boolean }[] = [];
    for (const node of ordered) {
      list.push({ tick: node.enter, node, end: false });
      list.push({ tick: node.exit, node, end: true });
    }
    return list.sort((a, b) => a.tick - b.tick);
  }, [ordered]);

  const reduced = useReducedMotion();
  const [tick, setTick] = useState(initial === "end" ? run.time : 0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [showRungs, setShowRungs] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [showRefs, setShowRefs] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const picture = useRef<HTMLDivElement>(null);
  const refLinks = useMemo(() => links(doc), [doc]);

  useEffect(() => {
    setTick(initial === "end" ? run.time : 0);
    setSelected(undefined);
  }, [run, initial]);

  useEffect(() => {
    if (!playing) return undefined;
    if (tick >= run.time) {
      setPlaying(false);
      return undefined;
    }
    timer.current = window.setTimeout(() => setTick((value) => value + 1), reduced ? 120 : 650);
    return () => window.clearTimeout(timer.current);
  }, [playing, tick, run.time, reduced]);

  const last = events[tick - 1];
  const current = last?.node;
  const focus = selected === undefined ? current : (nodes.get(selected) ?? current);

  const overlay: Overlay = {
    run,
    nodes,
    tick,
    ...(current === undefined ? {} : { current: current.id }),
    showRungs,
    ...(selected === undefined ? {} : { selected }),
    onSelect: (path) => setSelected(pathKey(path)),
  };

  const focusSplit = focus === undefined ? undefined : splitParts(kindNamed(SITE_WORLD, focus.doc.type)?.parts, focus.doc.value);

  return (
    <figure className="ce-figure cv-explorer not-content" aria-label={label}>
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="Steps of the evaluation">
          <button type="button" className="ce-btn" onClick={() => { setPlaying(false); setTick(0); }} disabled={tick === 0}>
            Start
          </button>
          <button type="button" className="ce-btn" onClick={() => { setPlaying(false); setTick((value) => Math.max(0, value - 1)); }} disabled={tick === 0}>
            Back
          </button>
          <button type="button" className="ce-btn" data-variant="primary" onClick={() => { setPlaying(false); setTick((value) => Math.min(run.time, value + 1)); }} disabled={tick >= run.time}>
            Next
          </button>
          <button
            type="button"
            className="ce-btn"
            aria-pressed={playing}
            onClick={() => {
              if (tick >= run.time) setTick(0);
              setPlaying((value) => !value);
            }}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" className="ce-btn" onClick={() => { setPlaying(false); setTick(run.time); }} disabled={tick >= run.time}>
            End
          </button>
        </div>
        <label className="cv-scrub">
          <span className="ce-bar-label">
            Event {tick} of {run.time}
          </span>
          <input
            type="range"
            min={0}
            max={run.time}
            value={tick}
            onChange={(event) => {
              setPlaying(false);
              setTick(Number(event.target.value));
            }}
          />
        </label>
        <div className="ce-bar-group">
          <label className="ce-check">
            <input type="checkbox" checked={showRungs} onChange={(event) => setShowRungs(event.target.checked)} />
            Show how each card is drawn
          </label>
          <label className="ce-check">
            <input type="checkbox" checked={showJson} onChange={(event) => setShowJson(event.target.checked)} />
            Show the JSON
          </label>
          {refLinks.length > 0 && (
            <label className="ce-check">
              <input type="checkbox" checked={showRefs} onChange={(event) => setShowRefs(event.target.checked)} />
              Show the references
            </label>
          )}
          <a className="cv-link" href={playgroundHref(doc)}>
            Open in the playground
          </a>
        </div>
      </div>

      <p className="cv-now" aria-live="polite">
        {tick === 0 ? "Nothing started yet. Select Next or Play." : describe(last?.node, last?.end === true)}
      </p>

      <div className="cv-stage" data-panel={panel}>
        <div className="cv-picture" ref={picture}>
          <WorldContext.Provider value={SITE_WORLD}>
            <OverlayContext.Provider value={overlay}>
              <View doc={doc} />
            </OverlayContext.Provider>
          </WorldContext.Provider>
          {showRefs && <RefArrows container={picture} links={refLinks} version={`${tick}:${String(showRungs)}:${selected ?? ""}`} />}
          {showJson && <pre className="ce-doc cv-json">{prettyJson(doc)}</pre>}
        </div>

        {panel && (
          <aside className="cv-panel" aria-label="The selected card">
            {focus === undefined ? (
              <p className="cv-muted">Select Next, or select a card, to see how its evaluation works.</p>
            ) : (
              <>
                <p className="cv-panel-title">
                  {selected !== undefined ? "The selected card" : "The current card"}:{" "}
                  <span className="ce-mono">{typeName(focus.doc.type)}</span>
                  {focus.path.length > 0 && <span className="cv-muted"> at {pathText(focus.path)}</span>}
                  {selected !== undefined && (
                    <button type="button" className="cv-link" onClick={() => setSelected(undefined)}>
                      show the current step
                    </button>
                  )}
                </p>
                <section>
                  <h4 className="cv-panel-head">1. The ladder finds its evaluator</h4>
                  <LadderGlyph world={SITE_WORLD} doc={focus.doc} declared={focus.declared} answer={focus.answer} />
                </section>
                <section>
                  <h4 className="cv-panel-head">2. Its context</h4>
                  <ContextStrip scope={focus.scope} caps={focus.caps} />
                </section>
                <section>
                  <h4 className="cv-panel-head">3. What its evaluator gets</h4>
                  {focusSplit === undefined || !focusSplit.ok || focusSplit.parts.length === 0 ? (
                    <p className="cv-muted cv-small">
                      Data only: <span className="ce-mono">{JSON.stringify(focusSplit?.ok === true ? focusSplit.data : focus.doc.value)}</span>
                    </p>
                  ) : (
                    <div className="cv-sealed-row">
                      {focusSplit.parts.map((slot) => {
                        const header = fromJson(slot.item);
                        return <SealedPart key={slot.key} partKey={slot.key} {...(header?.name === undefined ? {} : { name: header.name })} />;
                      })}
                      {focusSplit.data !== null && !(isRecord(focusSplit.data) && Object.keys(focusSplit.data).length === 0) && (
                        <span className="cv-muted cv-small">
                          and the data <span className="ce-mono">{JSON.stringify(focusSplit.data)}</span>
                        </span>
                      )}
                    </div>
                  )}
                </section>
                <section>
                  <h4 className="cv-panel-head">4. Its result</h4>
                  {focus.exit < tick ? <Port result={focus.result} /> : <span className="cv-muted cv-small">Not yet.</span>}
                </section>
              </>
            )}
          </aside>
        )}
      </div>

      {run.effects.length > 0 && <EffectsLog effects={run.effects} tick={tick} />}

      <div className="cv-final" data-ok={run.result.ok}>
        {tick >= run.time ? (
          <>
            <span>The result of the document:</span> <Port result={run.result} />
          </>
        ) : (
          <span className="cv-muted">The result shows at the end of the evaluation.</span>
        )}
      </div>

      {caption !== undefined && <figcaption className="ce-caption">{caption}</figcaption>}
    </figure>
  );
}
