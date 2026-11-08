import { useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { Obligation } from "@mark1russell7/coeval";
import { resultText } from "../lib/effects.ts";
import { BREAKS, KIND, START_CONTRACT, codeLines, dutiesOf, examine, probeText, type BreakId, type Contract, type DutyRead, type DutyState } from "../lib/conformance.ts";

const WIDTH = 372;
const HEIGHT = 300;
const CX = 186;
const CY = 150;
const RING = 100;
const LAMP = 21;

/** The text of each state of a duty, for the picture and for the panel. */
const STATE_TEXT: Readonly<Record<DutyState, string>> = {
  found: "broken: conforms found it",
  kept: "kept",
  permitted: "permitted by the contract",
  hidden: "broken, but another break hides it",
  missed: "broken, and no finding",
};

/** The look of a lamp: the color, the fill and the line of its ring. Each state has its own line, not only a color. */
function lampStyle(state: DutyState): { stroke: string; fill: string; dash?: string; width: number } {
  if (state === "found" || state === "missed") return { stroke: "var(--ce-stop)", fill: "var(--ce-stop-wash)", width: 3 };
  if (state === "hidden") return { stroke: "var(--ce-move)", fill: "var(--color-surface)", dash: "2 4", width: 2.5 };
  if (state === "permitted") return { stroke: "var(--ce-answer)", fill: "var(--color-surface)", dash: "6 4", width: 2 };
  return { stroke: "var(--ce-answer)", fill: "var(--ce-answer-wash)", width: 2 };
}

/** The place of the lamp of a duty on the ring, from the top in the order of the duties. */
function placeOf(index: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / BREAKS.length;
  return { x: CX + RING * Math.cos(angle), y: CY + RING * Math.sin(angle) };
}

/** The ring of the duties around the evaluator. A spoke of a break that is on is dashed. */
function Ring({ reads, breaks, selected, onSelect }: { readonly reads: readonly DutyRead[]; readonly breaks: ReadonlySet<BreakId>; readonly selected: Obligation; readonly onSelect: (duty: Obligation) => void }) {
  const found = reads.filter((read) => read.state === "found").map((read) => read.duty);
  const label = `conforms examined the evaluator ${KIND}. ${found.length === 0 ? "It found no broken duty." : `It found the broken duties ${found.join(", ")}.`}`;
  return (
    <svg className="ce-svg" viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`} role="group" aria-label={label}>
      {BREAKS.map((item, index) => {
        const at = placeOf(index);
        const on = breaks.has(item.id);
        return <line key={item.id} x1={CX} y1={CY} x2={at.x} y2={at.y} style={{ stroke: on ? "var(--ce-stop)" : "var(--color-rule-strong)" }} strokeWidth={on ? 2.5 : 1.5} strokeDasharray={on ? "6 4" : undefined} />;
      })}
      <circle cx={CX} cy={CY} r="40" style={{ fill: "var(--color-surface-sunken)", stroke: "var(--color-ink)" }} strokeWidth="1.5" />
      <text x={CX} y={CY - 2} textAnchor="middle" fontSize="14" fontWeight="700" style={{ fontFamily: "var(--font-mono)" }}>
        {KIND}
      </text>
      <text x={CX} y={CY + 16} textAnchor="middle" fontSize="12" style={{ fill: "var(--color-ink-muted)" }}>
        {breaks.size === 0 ? "no break" : `${String(breaks.size)} ${breaks.size === 1 ? "break" : "breaks"}`}
      </text>
      {reads.map((read, index) => {
        const item = BREAKS[index];
        if (item === undefined) return null;
        const at = placeOf(index);
        const look = lampStyle(read.state);
        const choose = (): void => onSelect(read.duty);
        const onKey = (event: KeyboardEvent): void => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            choose();
          }
        };
        return (
          <g
            key={read.duty}
            className="ce-node"
            role="button"
            tabIndex={0}
            aria-pressed={selected === read.duty}
            aria-label={`${read.duty}, ${item.short}: ${STATE_TEXT[read.state]}`}
            onClick={choose}
            onKeyDown={onKey}
          >
            {selected === read.duty && <circle cx={at.x} cy={at.y} r={LAMP + 6} style={{ fill: "none", stroke: "var(--color-ink)" }} strokeWidth="1.5" />}
            <circle cx={at.x} cy={at.y} r={LAMP} style={{ fill: look.fill, stroke: look.stroke }} strokeWidth={look.width} strokeDasharray={look.dash} />
            <text x={at.x} y={at.y + 5} textAnchor="middle" fontSize="13" fontWeight="700" style={{ fontFamily: "var(--font-mono)", fill: read.state === "found" ? "var(--ce-stop)" : undefined }}>
              {read.duty === "local" ? "loc" : read.duty}
            </text>
            <text x={at.x} y={at.y + LAMP + 15} textAnchor="middle" fontSize="12" style={{ fill: "var(--color-ink-secondary)" }}>
              {item.short}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** The look of the code. A line that is too long scrolls, and the class `scroll-cue` shows that more code is at the edge. */
const CODE_STYLE = { margin: 0, padding: "var(--space-3)", overflowX: "auto", fontSize: "0.78rem", lineHeight: 1.6, background: "var(--color-surface-sunken)", borderRadius: "var(--radius)", "--scroll-cue-bg": "var(--color-surface-sunken)" } as CSSProperties;

/** The code of the evaluator. Each line that a break changes has a mark and the name of its duty. */
function Code({ breaks }: { readonly breaks: ReadonlySet<BreakId> }) {
  return (
    <pre className="ce-mono scroll-cue" aria-label="The code of the evaluator" tabIndex={0} style={CODE_STYLE}>
      {codeLines(breaks).map((line, index) => (
        <div key={index} style={line.broken === undefined ? undefined : { borderLeft: "3px solid var(--ce-stop)", marginLeft: "-0.75rem", paddingLeft: "calc(0.75rem - 3px)", background: "var(--ce-stop-wash)" }}>
          {line.text}
          {line.broken !== undefined && <span style={{ color: "var(--ce-stop)", fontWeight: 700 }}>{`  // ${line.broken.duty}`}</span>}
        </div>
      ))}
    </pre>
  );
}

/** The panel of the selected duty: its rule, its state, and the finding of conforms with its probe. */
function Detail({ read }: { readonly read: DutyRead }) {
  const item = BREAKS.find((entry) => entry.duty === read.duty);
  const finding = read.finding;
  return (
    <div className="ce-result" data-state={read.state === "found" || read.state === "missed" ? "stop" : "go"} aria-live="polite" style={{ display: "grid", gap: "var(--space-2)" }}>
      <span>
        <strong className="ce-mono">{read.duty}</strong> {item?.rule}
      </span>
      <span>
        State: <strong>{STATE_TEXT[read.state]}</strong>. {read.note}
      </span>
      {finding !== undefined && (
        <>
          <span>
            <strong>conforms:</strong> {finding.reason}
          </span>
          <div className="ce-scroll scroll-cue">
            <table className="ce-matrix">
              <caption style={{ textAlign: "left", paddingBottom: "var(--space-1)" }}>The probe of the finding</caption>
              <tbody>
                <tr>
                  <th scope="row">Document</th>
                  <td className="ce-mono" style={{ overflowWrap: "anywhere" }}>{probeText(finding.probe.doc)}</td>
                </tr>
                {Object.entries(finding.probe.results).map(([key, result]) => (
                  <tr key={key}>
                    <th scope="row">Part {key}</th>
                    <td className="ce-mono">{resultText(result)}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Capabilities</th>
                  <td className="ce-mono">{finding.probe.caps.length === 0 ? "none" : finding.probe.caps.join(", ")}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** This component lets the reader break an evaluator, and it shows each duty that `conforms` of the core finds broken. */
export default function ConformanceDiagram() {
  const [breaks, setBreaks] = useState<ReadonlySet<BreakId>>(() => new Set<BreakId>(["widen"]));
  const [contract, setContract] = useState<Contract>(START_CONTRACT);
  const [chosen, setChosen] = useState<Obligation | undefined>(undefined);
  const findings = useMemo(() => examine(breaks, contract), [breaks, contract]);
  const reads = useMemo(() => dutiesOf(breaks, contract, findings), [breaks, contract, findings]);
  const selected = chosen ?? reads.find((read) => read.state === "found")?.duty ?? "C1";
  const read = reads.find((entry) => entry.duty === selected) ?? reads[0];

  const toggle = (id: BreakId): void => {
    const next = new Set(breaks);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setBreaks(next);
    setChosen(BREAKS.find((item) => item.id === id)?.duty);
  };
  const found = reads.filter((entry) => entry.state === "found");

  return (
    <figure className="ce-figure not-content" aria-label="Break an evaluator, and conforms shows each broken duty">
      <div className="ce-bar">
        <fieldset className="ce-bar-group" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="ce-bar-label" style={{ paddingBottom: "var(--space-1)" }}>Break the code</legend>
          {BREAKS.map((item) => (
            <label key={item.id} className="ce-check">
              <input type="checkbox" checked={breaks.has(item.id)} onChange={() => toggle(item.id)} />
              {item.label}
            </label>
          ))}
        </fieldset>
        <fieldset className="ce-bar-group" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="ce-bar-label" style={{ paddingBottom: "var(--space-1)" }}>The contract of {KIND}</legend>
          <label className="ce-check">
            <input type="checkbox" checked={contract.pure} onChange={() => setContract({ ...contract, pure: !contract.pure })} />
            pure
          </label>
          <label className="ce-check">
            <input type="checkbox" checked={contract.declaresLog} onChange={() => setContract({ ...contract, declaresLog: !contract.declaresLog })} />
            declares the effect log
          </label>
          <button
            type="button"
            className="ce-btn"
            onClick={() => {
              setBreaks(new Set());
              setContract(START_CONTRACT);
              setChosen(undefined);
            }}
          >
            Fix all
          </button>
        </fieldset>
      </div>

      <div className="ce-stage">
        <div className="ce-ladder-stage">
          <Code breaks={breaks} />
          <div style={{ maxWidth: "26rem", justifySelf: "center", width: "100%" }}>
            <Ring reads={reads} breaks={breaks} selected={selected} onSelect={setChosen} />
          </div>
        </div>
        <p className="ce-bar-label" aria-live="polite" style={{ margin: "var(--space-3) 0 0" }}>
          {found.length === 0 ? `conforms gives no finding: ${breaks.size === 0 ? "the code conforms." : "the contract permits each break, or a break hides another."}` : `conforms gives ${String(found.length)} ${found.length === 1 ? "finding" : "findings"}: ${found.map((entry) => entry.duty).join(", ")}.`}
        </p>
        {read !== undefined && <Detail read={read} />}
      </div>

      <figcaption className="ce-caption">
        <span style={{ display: "block", marginBottom: "var(--space-2)" }}>Each check box changes one line of the code. A dashed spoke is a break that is on.</span>
        Select a ring to show its finding and its probe. A <strong>thick red ring</strong> is a duty that <code>conforms</code> found broken. A <strong>solid blue ring</strong> is a kept duty. A <strong>dashed blue ring</strong> is a break that the contract permits. A <strong>dotted gray ring</strong> is a break that another break hides.
      </figcaption>
    </figure>
  );
}
