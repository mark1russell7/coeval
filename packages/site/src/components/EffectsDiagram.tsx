import { useEffect, useState } from "react";
import { EFFECT_HOSTS, EFFECT_PROGRAMS, HOST_ANSWER, isRunner, resultText, runWithHost, type EffectProgram, type EffectRow, type HostKind, type HostRun } from "../lib/effects.ts";

/** A node of the picture of a program: a kind with its place, or a plain value. */
interface Spot {
  /** The keys from the root, joined with a slash. */
  readonly place: string;
  readonly text: string;
  /** `true` for a kind, `false` for a plain value. */
  readonly kind: boolean;
  readonly x: number;
  readonly y: number;
  readonly parent?: string;
}

/** The picture of each program. The places are the places that the kernel gives each effect. */
const SPOTS: Readonly<Record<string, readonly Spot[]>> = {
  root: [
    { place: "", text: "log", kind: true, x: 160, y: 110 },
    { place: "0", text: '"x"', kind: false, x: 160, y: 200, parent: "" },
  ],
  "under-add": [
    { place: "", text: "add", kind: true, x: 160, y: 50 },
    { place: "0", text: "1", kind: false, x: 90, y: 140, parent: "" },
    { place: "1", text: "log", kind: true, x: 230, y: 130, parent: "" },
    { place: "1/0", text: '"x"', kind: false, x: 230, y: 215, parent: "1" },
  ],
  seq: [
    { place: "", text: "seq", kind: true, x: 160, y: 45 },
    { place: "0", text: "log", kind: true, x: 80, y: 130, parent: "" },
    { place: "0/0", text: '"x"', kind: false, x: 80, y: 215, parent: "0" },
    { place: "1", text: "add", kind: true, x: 250, y: 130, parent: "" },
    { place: "1/0", text: "1", kind: false, x: 210, y: 215, parent: "1" },
    { place: "1/1", text: "last", kind: false, x: 290, y: 215, parent: "1" },
  ],
};

const BOX_W = 92;
const BOX_H = 42;
const HOST = { x: 470, y: 70, w: 160, h: 120 } as const;
const STOP_X = 420;

const placeKey = (place: readonly (string | number)[]): string => place.join("/");

const times = (count: number): string => (count === 1 ? "1 time" : `${String(count)} times`);

/** This function gives the sentence of the live label for a run. */
function summary(out: HostRun): string {
  const called = out.calls.length === 0 ? "The kernel did not call perform." : `The kernel called perform ${times(out.calls.length)}.`;
  const effects = out.effects.map((row) => `The effect ${row.kind} at ${row.address} has the outcome ${resultText(row.outcome)}.`).join(" ");
  return `${called} ${effects} The result is ${resultText(out.result)}.`;
}

/** The arrow of one effect: to the host when the host got it, or to a stop bar when the run held it. */
function EffectArrow({ row, from, index }: { readonly row: EffectRow; readonly from: Spot; readonly index: number }) {
  const sx = from.x + BOX_W / 2;
  const sy = from.y + index * 8;
  const ey = HOST.y + HOST.h / 2 + index * 18;
  if (row.reached) {
    const ex = HOST.x;
    return (
      <g>
        <path d={`M${sx} ${sy} C${sx + 74} ${sy - 50} ${ex - 90} ${ey - 50} ${ex - 2} ${ey}`} fill="none" style={{ stroke: "var(--ce-run)" }} strokeWidth="2.5" markerEnd="url(#ce-fx-run)" />
        <text x={HOST.x + HOST.w / 2} y={HOST.y - 12 - index * 16} textAnchor="middle" fontSize="12" style={{ fill: "var(--ce-run)", fontFamily: "var(--font-mono)" }}>
          {`perform(${JSON.stringify(row.payload)}) → ${resultText(row.outcome)}`}
        </text>
      </g>
    );
  }
  return (
    <g>
      <path d={`M${sx} ${sy} C${sx + 60} ${sy - 40} ${STOP_X - 70} ${ey - 40} ${STOP_X} ${ey}`} fill="none" style={{ stroke: "var(--ce-stop)" }} strokeWidth="2.5" strokeDasharray="6 4" />
      <line x1={STOP_X} y1={ey - 14} x2={STOP_X} y2={ey + 14} style={{ stroke: "var(--ce-stop)" }} strokeWidth="4" strokeLinecap="round" />
      <text x={STOP_X - 8} y={ey + 32} textAnchor="end" fontSize="12" fontWeight="700" style={{ fill: "var(--ce-stop)" }}>
        held: {resultText(row.outcome)}
      </text>
    </g>
  );
}

/** The picture of the program, the host and one arrow for each effect of the run. */
function Picture({ program, host, out }: { readonly program: EffectProgram; readonly host: HostKind; readonly out: HostRun | undefined }) {
  const spots = SPOTS[program.id] ?? [];
  const at = (place: string): Spot | undefined => spots.find((spot) => spot.place === place);
  const calls = out?.calls.length ?? 0;
  return (
    <svg
      className="ce-svg"
      viewBox="0 0 640 250"
      style={{ minWidth: "30rem" }}
      role="img"
      aria-label={`The document ${program.label} and the host. ${out === undefined ? "The run goes on." : summary(out)}`}
    >
      <defs>
        <marker id="ce-fx-run" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0 0 L10 5 L0 10 Z" style={{ fill: "var(--ce-run)" }} />
        </marker>
      </defs>

      {spots.map((spot) => {
        const parent = spot.parent === undefined ? undefined : at(spot.parent);
        return parent === undefined ? null : (
          <line key={`edge-${spot.place}`} className="ce-edge" x1={parent.x} y1={parent.y + BOX_H / 2} x2={spot.x} y2={spot.kind ? spot.y - BOX_H / 2 : spot.y - 12} />
        );
      })}

      {spots.map((spot) => {
        if (!spot.kind) {
          return (
            <text key={spot.place} x={spot.x} y={spot.y} textAnchor="middle" fontSize="13" style={{ fontFamily: "var(--font-mono)" }}>
              {spot.text}
            </text>
          );
        }
        const runner = isRunner(spot.text);
        const color = runner ? "var(--ce-run)" : "var(--ce-derive)";
        const left = spot.x - BOX_W / 2;
        const top = spot.y - BOX_H / 2;
        return (
          <g key={spot.place}>
            <rect x={left} y={top} width={BOX_W} height={BOX_H} rx="5" style={{ fill: runner ? "var(--ce-run-wash)" : "var(--ce-derive-wash)", stroke: color }} strokeWidth="1.5" />
            {runner ? (
              <path d={`M${left + 9} ${top + 9} L${left + 17} ${top + 14} L${left + 9} ${top + 19} Z`} style={{ fill: color }} />
            ) : (
              <circle cx={left + 13} cy={top + 14} r="4" fill="none" style={{ stroke: color }} strokeWidth="1.5" />
            )}
            <text x={spot.x + 6} y={top + 18} textAnchor="middle" fontSize="14" fontWeight="700" style={{ fontFamily: "var(--font-mono)" }}>
              {spot.text}
            </text>
            <text x={spot.x} y={top + 34} textAnchor="middle" fontSize="11" style={{ fill: color }}>
              {runner ? "runner" : "evaluator"}
            </text>
          </g>
        );
      })}

      <g>
        <rect x={HOST.x} y={HOST.y} width={HOST.w} height={HOST.h} rx="6" style={{ fill: calls > 0 ? "var(--ce-run-wash)" : "var(--color-surface)", stroke: "var(--color-ink)" }} strokeWidth={calls > 0 ? 2.5 : 1.5} />
        <text x={HOST.x + HOST.w / 2} y={HOST.y + 26} textAnchor="middle" fontSize="15" fontWeight="700">
          Host
        </text>
        <text x={HOST.x + HOST.w / 2} y={HOST.y + 50} textAnchor="middle" fontSize="13" style={{ fontFamily: "var(--font-mono)" }}>
          {"perform"}
        </text>
        <text x={HOST.x + HOST.w / 2} y={HOST.y + 74} textAnchor="middle" fontSize="13" fontWeight="700">
          {out === undefined ? "…" : calls === 0 ? "not called" : `called ${times(calls)}`}
        </text>
        <text x={HOST.x + HOST.w / 2} y={HOST.y + 100} textAnchor="middle" fontSize="11" style={{ fill: "var(--color-ink-secondary)" }}>
          {host === "waits" ? `gives a promise of ${String(HOST_ANSWER)}` : `gives ${String(HOST_ANSWER)} at once`}
        </text>
      </g>

      {out?.effects.map((row, index) => {
        const from = at(placeKey(row.place));
        return from === undefined ? null : <EffectArrow key={row.address} row={row} from={from} index={index} />;
      })}
    </svg>
  );
}

/**
 * The effects diagram. A reader picks a program and a host. The kernel does a run of the program, and the host records each call
 * of `perform`. The diagram shows the calls, the outcome of each effect and the result. An effect under a parent that
 * cannot wait does not reach the host (RUN.HELD).
 */
export default function EffectsDiagram() {
  const [programId, setProgramId] = useState("under-add");
  const [host, setHost] = useState<HostKind>("waits");
  const [out, setOut] = useState<HostRun | undefined>(undefined);
  const program = EFFECT_PROGRAMS.find((item) => item.id === programId) ?? (EFFECT_PROGRAMS[0] as EffectProgram);

  useEffect(() => {
    // A run is async. When the reader picks again before the run ends, the old run does not change the picture.
    let live = true;
    void runWithHost(program, host).then((next) => {
      if (live) setOut(next);
    });
    return () => {
      live = false;
    };
  }, [program, host]);

  // The facts of an earlier pair do not show while the run of the new pair goes on.
  const current = out !== undefined && out.program === program.id && out.host === host ? out : undefined;
  const failed = current !== undefined && !current.result.ok;

  return (
    <figure className="ce-figure not-content" aria-label="How the effects of a run reach the host">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="Program">
          <span className="ce-bar-label">Program</span>
          {EFFECT_PROGRAMS.map((item) => (
            <button key={item.id} type="button" className="ce-btn ce-mono" aria-pressed={item.id === program.id} onClick={() => setProgramId(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="ce-bar-group" role="group" aria-label="Host">
          <span className="ce-bar-label">Host</span>
          {EFFECT_HOSTS.map((item) => (
            <button key={item.id} type="button" className="ce-btn" aria-pressed={item.id === host} onClick={() => setHost(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ce-stage">
        <p className="ce-bar-label" style={{ margin: "0 0 var(--space-3)" }}>
          {program.note} {EFFECT_HOSTS.find((item) => item.id === host)?.note}
        </p>
        <div className="ce-scroll scroll-cue">
          <Picture program={program} host={host} out={current} />
        </div>

        <table className="ce-matrix" style={{ marginTop: "var(--space-4)" }}>
          <thead>
            <tr>
              <th scope="col">Effect</th>
              <th scope="col">Payload</th>
              <th scope="col">Host got it</th>
              <th scope="col">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {current?.effects.map((row) => (
              <tr key={row.address} style={{ cursor: "default" }}>
                <td className="ce-mono">
                  {row.kind} {row.address}
                </td>
                <td className="ce-mono">{JSON.stringify(row.payload)}</td>
                <td>{row.reached ? "yes" : "no"}</td>
                <td>
                  <strong className="ce-mono" style={{ color: row.outcome?.ok === false ? "var(--ce-stop)" : undefined }}>
                    {resultText(row.outcome)}
                  </strong>
                  {row.outcome?.ok === false && <span> {row.outcome.error.reason}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ce-result" data-state={failed ? "stop" : "go"} aria-live="polite">
          {current === undefined ? (
            <span>The run goes on.</span>
          ) : (
            <>
              <span>
                Result: <span className="ce-result-value" style={{ color: failed ? "var(--ce-stop)" : undefined }}>{resultText(current.result)}</span>
              </span>
              <span>{current.calls.length === 0 ? "The kernel did not call perform." : `The kernel called perform ${times(current.calls.length)}.`}</span>
              {!current.result.ok && <span>{current.result.error.reason}</span>}
              <span>
                {current.issues.length === 0
                  ? "The check with the option run finds no issue."
                  : `The check with the option run finds ${current.issues.map((issue) => issue.code).join(", ")} before the run.`}
              </span>
            </>
          )}
        </div>
      </div>

      <figcaption className="ce-caption">
        <span className="ce-badge" data-side="run">
          runner
        </span>{" "}
        can wait for the host.{" "}
        <span className="ce-badge" data-side="derive">
          evaluator
        </span>{" "}
        cannot wait. A solid arrow is a call of <code>perform</code>. A dashed arrow that ends at a bar is an effect that
        the run held. The host does not get it, and the effect keeps <code>#CALC!</code>. The two hosts give the same facts.
      </figcaption>
    </figure>
  );
}
