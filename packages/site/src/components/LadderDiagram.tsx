import { useLayoutEffect, useRef, useState } from "react";
import { ask, kindOf, OWN_KEY, RUNGS, type Answer, type Doc, type Rung, type Step } from "@coeval/core";
import { LADDER_EXAMPLES, LADDER_WORLD, VERBS, ladderExample } from "../lib/examples.ts";
import { prettyJson, useStepper } from "../lib/motion.ts";

const TITLES: Readonly<Record<Rung, string>> = { own: "Own entry", kind: "Kind", default: "Default" };

function verbsText(verbs: Readonly<Record<string, string>>): string {
  const entries = Object.entries(verbs);
  return entries.length === 0 ? "No entries." : entries.map(([verb, name]) => `${verb} → ${name}`).join(", ");
}

function holds(rung: Rung, doc: Doc, containerKind: string | undefined): string {
  if (rung === "default") return verbsText(LADDER_WORLD.defaults);
  if (rung === "own") {
    const own = doc[OWN_KEY];
    return typeof own === "object" && own !== null && !Array.isArray(own)
      ? verbsText(own as Record<string, string>)
      : "No own entries.";
  }
  const name = kindOf(doc) ?? containerKind;
  if (name === undefined) return "No kind is named.";
  const kind = Object.hasOwn(LADDER_WORLD.kinds, name) ? LADDER_WORLD.kinds[name] : undefined;
  return kind === undefined ? `${name}: not a kind of this world.` : `${name}: ${verbsText(kind.verbs)}`;
}

function outcomeText(step: Step, verb: string): string {
  switch (step.outcome) {
    case "answers":
      return step.rung === "kind" && step.source === "container"
        ? `Answers with ${step.evaluator ?? ""}. The container names the kind.`
        : `Answers with ${step.evaluator ?? ""}.`;
    case "no-entry":
      return step.rung === "kind" ? `${step.kind ?? ""} has no entry for ${verb}.` : `No entry for ${verb}.`;
    case "skipped":
      return "Skipped: no kind is named.";
    case "unknown-kind":
      return `Stops: the world has no kind ${step.kind ?? ""}.`;
  }
}

function resultText(answer: Answer): string {
  if (answer.evaluator !== undefined) {
    const from = answer.rung === "own" ? "the own entry" : answer.rung === "kind" ? "the kind" : "the default";
    return `The evaluator is ${answer.evaluator}, from ${from}.`;
  }
  const last = answer.steps.at(-1);
  if (answer.error === "unknown-kind") return `No evaluator. The kind ${last?.kind ?? ""} does not exist, and the ladder does not guess a name.`;
  return `No evaluator. No rung has an entry for ${answer.verb}.`;
}

/** The props of the ladder diagram. */
export interface LadderDiagramProps {
  /** The document to show first. */
  readonly initial?: string;
}

/**
 * The ladder diagram. A reader picks a document and a verb. The question goes up the ladder one rung at a time,
 * and the first rung with an entry answers.
 */
export default function LadderDiagram({ initial = "rule" }: LadderDiagramProps) {
  const [exampleId, setExampleId] = useState(initial);
  const [verb, setVerb] = useState<string>("view");
  const [ownOn, setOwnOn] = useState(false);
  const [replay, setReplay] = useState(0);

  const example = ladderExample(exampleId);
  const containerKind = example.container?.kind;
  const doc: Doc = ownOn ? { ...example.doc, [OWN_KEY]: { [verb]: `custom.${verb}` } } : example.doc;
  const answer = ask(LADDER_WORLD, doc, verb, containerKind === undefined ? {} : { containerKind });
  const shown = useStepper(answer.steps.length, `${exampleId}:${verb}:${String(ownOn)}:${String(replay)}`);
  const done = shown >= answer.steps.length;
  const current = answer.steps[shown - 1];

  const rungRefs = useRef(new Map<Rung, HTMLLIElement>());
  const climbRef = useRef<HTMLDivElement>(null);
  const [pulseTop, setPulseTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const rung = current?.rung ?? "own";
    const element = rungRefs.current.get(rung);
    const climb = climbRef.current;
    if (element === undefined || climb === null) return;
    setPulseTop(element.offsetTop + element.offsetHeight / 2);
  }, [current?.rung, exampleId, verb, ownOn]);

  const stopped = done && answer.evaluator === undefined;

  return (
    <figure className="ce-figure not-content" aria-label="The ladder: a question goes up until a rung answers">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="Document">
          <span className="ce-bar-label">Document</span>
          {LADDER_EXAMPLES.map((item) => (
            <button
              key={item.id}
              type="button"
              className="ce-btn"
              aria-pressed={item.id === exampleId}
              onClick={() => setExampleId(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="ce-bar-group" role="group" aria-label="Verb">
          <span className="ce-bar-label">Verb</span>
          {VERBS.map((item) => (
            <button key={item} type="button" className="ce-btn ce-mono" aria-pressed={item === verb} onClick={() => setVerb(item)}>
              {item}
            </button>
          ))}
        </div>
        <label className="ce-check">
          <input type="checkbox" checked={ownOn} onChange={(event) => setOwnOn(event.target.checked)} />
          Give the document its own entry
        </label>
      </div>

      <div className="ce-stage">
        <div className="ce-ladder-stage">
          <div className="ce-ladder-doc">
            <div className="ce-answer" data-state={!done ? "wait" : stopped ? "stop" : "go"} aria-live="polite">
              <span className="ce-doc-label">The answer</span>
              <span className="ce-answer-value">{!done ? "…" : (answer.evaluator ?? "no evaluator")}</span>
              <span>{done ? resultText(answer) : "The question goes up the ladder."}</span>
              <button type="button" className="ce-btn" onClick={() => setReplay((count) => count + 1)}>
                Ask again
              </button>
            </div>
            <div className="ce-ladder-doc-bottom">
              <span className="ce-doc-label">
                {example.container === undefined
                  ? "The document"
                  : `The document, in the list ${example.container.name}. The list declares the kind ${example.container.kind} for its items.`}
              </span>
              <pre className="ce-doc">{prettyJson(doc)}</pre>
              <span className="ce-doc-label">
                The question: <span className="ce-mono">{verb}</span>. It starts at rung 1.
              </span>
            </div>
          </div>

          <div className="ce-climb" ref={climbRef}>
            <div className="ce-rail" aria-hidden="true" />
            {pulseTop !== undefined && (
              <div
                className="ce-pulse"
                aria-hidden="true"
                data-state={stopped ? "stop" : "go"}
                style={{ top: `${pulseTop}px` }}
              />
            )}
            <ol className="ce-rungs">
              {[...RUNGS].reverse().map((rung) => {
                const index = answer.steps.findIndex((step) => step.rung === rung);
                const step = index === -1 ? undefined : answer.steps[index];
                const visible = step !== undefined && index < shown;
                const state = !visible
                  ? "waiting"
                  : step.outcome === "answers"
                    ? "answers"
                    : step.outcome === "unknown-kind"
                      ? "stops"
                      : "passed";
                return (
                  <li
                    key={rung}
                    className="ce-rung"
                    data-state={state}
                    ref={(element) => {
                      if (element === null) rungRefs.current.delete(rung);
                      else rungRefs.current.set(rung, element);
                    }}
                  >
                    <div className="ce-rung-head">
                      <span className="ce-rung-title">
                        <span className="ce-rung-number">{RUNGS.indexOf(rung) + 1}</span>
                        {TITLES[rung]}
                      </span>
                      <span className="ce-rung-outcome">
                        {visible ? outcomeText(step, verb) : step === undefined && done ? "Not visited." : ""}
                      </span>
                    </div>
                    <div className="ce-rung-holds">{holds(rung, doc, containerKind)}</div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>

      <figcaption className="ce-caption">
        A question visits the rungs in order. The first rung with an entry for the verb answers. The kind comes from
        the document or from its container. It does not come from the shape of the data.
      </figcaption>
    </figure>
  );
}
