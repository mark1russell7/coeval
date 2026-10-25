import { useMemo, useState, type KeyboardEvent } from "react";
import { Port } from "../glyphs/Card.tsx";
import { SCENARIOS, SLOTS, attributeModel, formulaOf, formulaText, type Scenario, type Slot } from "../lib/attributes.ts";
import { prettyJson, useStepper } from "../lib/motion.ts";

const LANES = [14, 26, 38] as const;

/**
 * The attribute diagram. A reader picks a tree of a panel and a box. The model evaluates the decorated tree. The
 * diagram numbers each attribute in the order of its evaluation, draws each read, and shows a cycle with its chain.
 */
export default function AttributeDiagram() {
  const [id, setId] = useState("flow");
  const [replay, setReplay] = useState(0);
  const scenario = SCENARIOS.find((item) => item.id === id) ?? (SCENARIOS[0] as Scenario);

  const model = useMemo(() => attributeModel(scenario.doc), [scenario]);

  const shown = useStepper(model.total, `${id}:${String(replay)}`, 750);
  const done = shown >= model.total;
  const firstFailed = SLOTS.find((slot) => model.results.get(slot.id)?.ok === false);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const selectedId = picked ?? firstFailed?.id ?? "box.width";
  const selected = SLOTS.find((slot) => slot.id === selectedId) ?? (SLOTS[0] as Slot);
  const inChain = (slot: Slot): boolean => model.chain.includes(slot.text);
  const visible = (slot: Slot): boolean => (model.order.get(slot.id) ?? Number.POSITIVE_INFINITY) <= shown;

  const choose = (next: string): void => {
    setId(next);
    setPicked(undefined);
  };
  const onKey = (event: KeyboardEvent<SVGGElement>, slot: Slot): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setPicked(slot.id);
    }
  };

  const selectedResult = model.results.get(selected.id);
  const selectedOrder = model.order.get(selected.id);

  return (
    <figure className="ce-figure not-content" aria-label="A decorated tree: each attribute evaluates on demand, one time">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="Tree">
          <span className="ce-bar-label">Tree</span>
          {SCENARIOS.map((item) => (
            <button key={item.id} type="button" className="ce-btn" aria-pressed={item.id === id} onClick={() => choose(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <button type="button" className="ce-btn" onClick={() => setReplay((count) => count + 1)}>
          Evaluate again
        </button>
      </div>

      <div className="ce-stage">
        <div className="ce-two ce-attr-stage">
          <svg className="ce-svg ce-attr" viewBox="0 0 320 248" role="group" aria-label={`The tree ${scenario.label}. ${scenario.note}`}>
            <defs>
              <marker id="ce-attr-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" className="ce-attr-head" />
              </marker>
              <marker id="ce-attr-arrow-stop" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" className="ce-attr-head" data-stop="true" />
              </marker>
            </defs>

            <rect className="ce-attr-node" x="4" y="4" width="312" height="240" rx="6" />
            <text className="ce-attr-type" x="14" y="22">
              panel
            </text>
            <rect className="ce-attr-node" x="54" y="124" width="250" height="110" rx="6" />
            <text className="ce-attr-type" x="64" y="142">
              box, the child 0
            </text>

            {model.reads.map((read, index) => {
              const lane = LANES[index % LANES.length] as number;
              const stop = inChain(read.from) && inChain(read.to);
              const show = visible(read.to) && visible(read.from);
              const d = `M${read.from.x} ${read.from.y + 5} H${lane} V${read.to.y - 5} H${read.to.x - 3}`;
              return (
                <path
                  key={`${read.from.id}-${read.to.id}`}
                  className="ce-attr-read"
                  data-stop={stop}
                  data-show={show}
                  d={d}
                  markerEnd={stop ? "url(#ce-attr-arrow-stop)" : "url(#ce-attr-arrow)"}
                />
              );
            })}

            {SLOTS.map((slot) => {
              const order = model.order.get(slot.id);
              const result = model.results.get(slot.id);
              const lit = order !== undefined && order <= shown;
              const failed = lit && result !== undefined && !result.ok;
              const unread = done && order === undefined;
              const resultText = !lit ? (unread ? "not read" : "") : result === undefined ? "" : result.ok ? JSON.stringify(result.value) : result.error.code;
              return (
                <g
                  key={slot.id}
                  className="ce-attr-row"
                  data-selected={slot.id === selected.id}
                  data-failed={failed}
                  data-chain={inChain(slot)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${slot.text}: ${formulaText(formulaOf(scenario.doc, slot))}. ${lit ? `Evaluation ${String(order)}, ${resultText}` : unread ? "Not read" : "Not yet evaluated"}.`}
                  onClick={() => setPicked(slot.id)}
                  onKeyDown={(event) => onKey(event, slot)}
                >
                  <rect className="ce-attr-band" x={slot.x} y={slot.y - 17} width={slot.right - slot.x} height={34} rx="3" />
                  <circle className="ce-attr-order" data-lit={lit} cx={slot.x + 14} cy={slot.y} r="9" />
                  <text className="ce-attr-order-text" x={slot.x + 14} y={slot.y + 4} textAnchor="middle">
                    {lit ? order : ""}
                  </text>
                  <text className="ce-attr-key" x={slot.x + 30} y={slot.y - 2}>
                    {slot.key}
                  </text>
                  <text className="ce-attr-formula" x={slot.x + 30} y={slot.y + 12}>
                    {formulaText(formulaOf(scenario.doc, slot))}
                  </text>
                  <text className="ce-attr-result" data-failed={failed} data-unread={unread} x={slot.right - 8} y={slot.y - 2} textAnchor="end">
                    {resultText}
                  </text>
                </g>
              );
            })}
          </svg>

          <div className="ce-attr-side">
            <p className="ce-panel-title">The attribute {selected.text}</p>
            <pre className="ce-doc">{prettyJson(formulaOf(scenario.doc, selected))}</pre>
            <p className="ce-attr-line" aria-live="polite">
              {selectedOrder === undefined
                ? done
                  ? "Nothing read this attribute, thus it did not evaluate."
                  : "This attribute did not evaluate yet."
                : selectedOrder > shown
                  ? "This attribute did not evaluate yet."
                  : `It evaluated as number ${String(selectedOrder)}, one time.`}
            </p>
            {selectedResult !== undefined && selectedOrder !== undefined && selectedOrder <= shown && (
              <div className="ce-attr-line">
                <Port result={selectedResult} />
                {!selectedResult.ok && (
                  <span className="ce-attr-reason">
                    {selectedResult.error.reason}
                    {selectedResult.error.place !== undefined && ` The place: [${selectedResult.error.place.join(", ")}].`}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {done && (
          <div className="ce-result" data-state={model.root.ok ? "go" : "stop"} aria-live="polite">
            {model.root.ok ? (
              <span>
                The root gives the JSON of the tree: <code className="ce-mono">{JSON.stringify(model.root.value)}</code>
              </span>
            ) : model.chain.length > 0 ? (
              <span className="ce-attr-chain">
                <strong>#CYCLE!</strong>
                {model.chain.map((text, index) => (
                  <span key={`${text}-${String(index)}`} className="ce-attr-chain-item">
                    {index > 0 && (
                      <span aria-hidden="true" className="ce-attr-chain-arrow">
                        →
                      </span>
                    )}
                    <span className="ce-chip">{text}</span>
                  </span>
                ))}
              </span>
            ) : (
              <span>
                <strong>{model.root.error.code}</strong> The root gets the error of the attribute: {model.root.error.reason}
              </span>
            )}
          </div>
        )}
      </div>

      <figcaption className="ce-caption">
        A number is the order of evaluation. An arrow goes from an attribute to the attribute that reads it. Red marks an error value and the
        chain of a cycle. {scenario.note}
      </figcaption>
    </figure>
  );
}
