import { useEffect, useRef, useState } from "react";
import { resultText } from "../lib/effects.ts";
import { DOCUMENT_CHANGES, RECORDED_TEXT, countingHost, logJson, recordRun, replayRun, shownReplay, type JournalRow, type JournalRun, type KeptReplay } from "../lib/replay.ts";

const WIDTH = 372;
const ROW_H = 74;
const TOP = 58;
const RUN_X = 40;
const LOG_X = 186;
const HOST_X = 332;

/** The mode of the diagram: the first recording of the log, or a replay of that log. */
type Mode = "record" | "replay";

/** This function gives a short text of a payload for the picture. The table has the full text. */
function shortText(row: JournalRow): string {
  const text = typeof row.payload === "object" && row.payload !== null ? String((row.payload as { key?: unknown }).key) : JSON.stringify(row.payload);
  return `${row.kind} ${text.length > 13 ? `${text.slice(0, 12)}…` : text}`;
}

/** The arrows of one effect, by the way that the effect got its answer. */
function RowArrows({ row, index }: { readonly row: JournalRow; readonly index: number }) {
  const y = TOP + index * ROW_H + 24;
  const back = y + 22;
  const asked = <text x={(RUN_X + LOG_X) / 2} y={y - 8} textAnchor="middle" fontSize="13" style={{ fontFamily: "var(--font-mono)" }}>{shortText(row)}</text>;
  if (row.state === "not reached") {
    return (
      <g opacity="0.75">
        <circle cx={LOG_X} cy={y + 11} r="4" style={{ fill: "none", stroke: "var(--ce-move)" }} strokeWidth="1.5" />
        <text x={LOG_X + 12} y={y + 15} fontSize="13" style={{ fill: "var(--ce-move)" }}>not reached</text>
      </g>
    );
  }
  if (row.state === "refused") {
    return (
      <g>
        {asked}
        <line x1={RUN_X} y1={y} x2={LOG_X - 8} y2={y} style={{ stroke: "var(--ce-stop)" }} strokeWidth="2.5" strokeDasharray="6 4" />
        <line x1={LOG_X - 6} y1={y - 14} x2={LOG_X - 6} y2={y + 14} style={{ stroke: "var(--ce-stop)" }} strokeWidth="4" strokeLinecap="round" />
        <text x={LOG_X + 8} y={y + 5} fontSize="13" fontWeight="700" style={{ fill: "var(--ce-stop)", fontFamily: "var(--font-mono)" }}>#REPLAY!</text>
      </g>
    );
  }
  const from = row.state === "host" ? HOST_X : LOG_X;
  return (
    <g>
      {asked}
      <line x1={RUN_X} y1={y} x2={from - 4} y2={y} style={{ stroke: "var(--ce-run)" }} strokeWidth="2.5" markerEnd="url(#ce-replay-ask)" />
      <line x1={from} y1={back} x2={RUN_X + 6} y2={back} style={{ stroke: "var(--ce-answer)" }} strokeWidth="2" strokeDasharray="2 4" strokeLinecap="round" markerEnd="url(#ce-replay-answer)" />
      <text x={(RUN_X + LOG_X) / 2} y={back + 16} textAnchor="middle" fontSize="13" fontWeight="700" style={{ fill: "var(--ce-answer)", fontFamily: "var(--font-mono)" }}>{resultText(row.outcome)}</text>
    </g>
  );
}

/** The three lanes of a run, with the arrows of the rows up to the step. */
function Picture({ out, step, mode }: { readonly out: JournalRun; readonly step: number; readonly mode: Mode }) {
  const height = TOP + Math.max(out.rows.length, 3) * ROW_H + 8;
  const lanes = [
    { x: RUN_X, label: "The run" },
    { x: LOG_X, label: "The log" },
    { x: HOST_X, label: "The host" },
  ];
  const told = out.rows.slice(0, step).map((row) => `${row.kind} at ${row.address}: ${row.state === "not reached" ? "not reached" : resultText(row.outcome)}`).join(". ");
  return (
    <svg className="ce-svg" viewBox={`0 0 ${String(WIDTH)} ${String(height)}`} role="img" aria-label={`A ${mode === "record" ? "recording" : "replay"} with ${String(out.rows.length)} effects. ${told}`}>
      <defs>
        <marker id="ce-replay-ask" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 Z" style={{ fill: "var(--ce-run)" }} />
        </marker>
        <marker id="ce-replay-answer" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 Z" style={{ fill: "var(--ce-answer)" }} />
        </marker>
      </defs>
      {lanes.map((lane) => {
        const silent = lane.x === HOST_X && mode === "replay";
        return (
          <g key={lane.label} opacity={silent ? 0.55 : 1}>
            <text x={lane.x} y="20" textAnchor="middle" fontSize="14" fontWeight="700">{lane.label}</text>
            <line x1={lane.x} y1="32" x2={lane.x} y2={height - 6} className="ce-edge" strokeDasharray={silent ? "3 6" : undefined} />
          </g>
        );
      })}
      {mode === "replay" && (
        <text x={HOST_X} y="46" textAnchor="middle" fontSize="13" style={{ fill: "var(--ce-move)" }}>no call</text>
      )}
      {out.rows.slice(0, step).map((row, index) => (
        <RowArrows key={row.address} row={row} index={index} />
      ))}
    </svg>
  );
}

/** This function gives the text of the state of a row in the table. */
function stateText(row: JournalRow): string {
  if (row.state === "host") return "the host";
  if (row.state === "log") return "the log";
  return row.state === "refused" ? "refused" : "not reached";
}

/** This component records a run, replays its log against a document, and steps through each effect. */
export default function ReplayDiagram() {
  const host = useRef(countingHost());
  const [recorded, setRecorded] = useState<JournalRun | undefined>(undefined);
  const [kept, setKept] = useState<KeptReplay | undefined>(undefined);
  const [mode, setMode] = useState<Mode>("record");
  const [changeId, setChangeId] = useState("same");
  const [step, setStep] = useState(3);
  const change = DOCUMENT_CHANGES.find((item) => item.id === changeId) ?? DOCUMENT_CHANGES[0];

  const record = (): void => {
    void recordRun(RECORDED_TEXT, host.current).then((next) => {
      setRecorded(next);
      setMode("record");
      setStep(next.rows.length);
    });
  };

  useEffect(record, []);

  useEffect(() => {
    if (recorded === undefined || change === undefined) return undefined;
    let live = true;
    void replayRun(change.text, recorded.log).then((next) => {
      if (live) setKept({ change: change.id, recorded, run: next });
    });
    return () => {
      live = false;
    };
  }, [recorded, change]);

  const startReplay = (id: string): void => {
    setChangeId(id);
    setMode("replay");
    setStep(0);
  };

  // A replay of the last change or of the last recording does not show until the new replay comes.
  const replayed = shownReplay(kept, changeId, recorded);
  const out = mode === "record" ? recorded : replayed;
  const total = out?.rows.length ?? 0;
  const failed = out !== undefined && !out.result.ok;
  const finished = step >= total;
  const same = recorded !== undefined && replayed !== undefined && JSON.stringify(recorded.result) === JSON.stringify(replayed.result);

  return (
    <figure className="ce-figure not-content" aria-label="How a replay answers each effect from the log of a recording">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="The run">
          <span className="ce-bar-label">Run</span>
          <button type="button" className="ce-btn" aria-pressed={mode === "record"} onClick={record}>
            Record a run
          </button>
        </div>
        <div className="ce-bar-group" role="group" aria-label="Replay the log against a document">
          <span className="ce-bar-label">Replay against</span>
          {DOCUMENT_CHANGES.map((item) => (
            <button key={item.id} type="button" className="ce-btn" aria-pressed={mode === "replay" && item.id === changeId} onClick={() => startReplay(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ce-stage">
        <p className="ce-mono" style={{ margin: "0 0 var(--space-2)", overflowWrap: "anywhere" }}>
          {mode === "record" ? RECORDED_TEXT : change?.text}
        </p>
        <p className="ce-bar-label" style={{ margin: "0 0 var(--space-3)" }}>
          {mode === "record" ? "The host gives a new number at each call, thus each recording has other answers." : change?.note}
        </p>

        {out !== undefined && (
          <>
            <div style={{ maxWidth: "34rem" }}>
              <Picture out={out} step={step} mode={mode} />
            </div>

            <div className="ce-bar-group" role="group" aria-label="Step through the effects" style={{ marginTop: "var(--space-3)" }}>
              <button type="button" className="ce-btn" disabled={step === 0} onClick={() => setStep(step - 1)}>
                Back
              </button>
              <button type="button" className="ce-btn" disabled={finished} onClick={() => setStep(step + 1)}>
                Next effect
              </button>
              <span className="ce-bar-label" aria-live="polite">
                Effect {step} of {total}
              </span>
            </div>

            <div className="ce-scroll scroll-cue">
              <table className="ce-matrix" style={{ marginTop: "var(--space-4)" }}>
                <thead>
                  <tr>
                    <th scope="col">Address</th>
                    <th scope="col">Effect</th>
                    <th scope="col">Payload</th>
                    <th scope="col">Answer</th>
                    <th scope="col">From</th>
                  </tr>
                </thead>
                <tbody>
                  {out.rows.slice(0, step).map((row) => (
                    <tr key={row.address} style={{ cursor: "default" }}>
                      <td className="ce-mono">{row.address}</td>
                      <td className="ce-mono">{row.kind}</td>
                      <td className="ce-mono">{JSON.stringify(row.payload)}</td>
                      <td>
                        <strong className="ce-mono" style={{ color: row.state === "refused" ? "var(--ce-stop)" : undefined }}>
                          {row.state === "not reached" ? "none" : resultText(row.outcome)}
                        </strong>
                      </td>
                      <td>{stateText(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ce-result" data-state={failed ? "stop" : "go"} aria-live="polite">
              {!finished ? (
                <span>Select Next effect to go on.</span>
              ) : (
                <>
                  <span>
                    Result: <span className="ce-result-value" style={{ color: failed ? "var(--ce-stop)" : undefined }}>{resultText(out.result)}</span>
                  </span>
                  <span>{mode === "record" ? `The host got ${String(out.calls)} calls.` : "The host got no call."}</span>
                  {mode === "replay" && <span>{same ? "The replay gives the recorded result." : `The recording gave ${recorded === undefined ? "" : resultText(recorded.result)}.`}</span>}
                  {!out.result.ok && <span>{out.result.error.reason}</span>}
                </>
              )}
            </div>
          </>
        )}

        {recorded !== undefined && (
          <details style={{ marginTop: "var(--space-3)" }}>
            <summary>The log as JSON</summary>
            <pre className="ce-mono" style={{ overflowX: "auto", fontSize: "0.8rem" }}>{JSON.stringify(logJson(recorded.log), null, 2)}</pre>
          </details>
        )}
      </div>

      <figcaption className="ce-caption">
        A solid arrow asks for an effect. A dotted arrow gives the answer. A dashed arrow that ends at a bar is an effect that the log refuses with <code>#REPLAY!</code>. In a recording the arrow goes to the host. In a replay it stops at the log.
      </figcaption>
    </figure>
  );
}
