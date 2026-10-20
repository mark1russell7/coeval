import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../lib/motion.ts";

type Phase = "idle" | "event" | "run1" | "run2" | "run3" | "store" | "derive" | "view";

const RUN_STEPS = ["find the card", "toggle it", "save it"] as const;
const DERIVE_NODES = ["count", "share", "label"] as const;

function bezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

const DERIVE_POINTS = [0.22, 0.5, 0.78].map((t) => ({ x: bezier(t, 200, 300, 420, 520), y: bezier(t, 140, 20, 20, 140) }));
const RUN_POINTS = [0.22, 0.5, 0.78].map((t) => ({ x: bezier(t, 520, 420, 300, 200), y: bezier(t, 180, 300, 300, 180) }));

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    const a = copy[index];
    const b = copy[other];
    if (a !== undefined && b !== undefined) {
      copy[index] = b;
      copy[other] = a;
    }
  }
  return copy;
}

/**
 * The loop diagram. An event starts a run: its steps go in order and write the store. The store change makes the
 * derive side compute again, in any order, and the view shows the new values. A write from another tab skips the run.
 */
export default function LoopDiagram() {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState(1);
  const [total, setTotal] = useState(3);
  const [shown, setShown] = useState({ done: 1, total: 3 });
  const [runs, setRuns] = useState(0);
  const [derives, setDerives] = useState(0);
  const [order, setOrder] = useState<readonly string[]>(DERIVE_NODES);
  const [source, setSource] = useState<"click" | "tab" | undefined>(undefined);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const play = (steps: readonly (readonly [Phase, () => void])[]): void => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
    if (reduced) {
      for (const [, effect] of steps) effect();
      setPhase("idle");
      return;
    }
    steps.forEach(([next, effect], index) => {
      timers.current.push(
        window.setTimeout(() => {
          setPhase(next);
          effect();
        }, index * 650),
      );
    });
    timers.current.push(window.setTimeout(() => setPhase("idle"), steps.length * 650 + 400));
  };

  const nothing = (): void => undefined;

  const click = (): void => {
    const next = (done + 1) % (total + 1);
    setSource("click");
    play([
      ["event", nothing],
      ["run1", nothing],
      ["run2", nothing],
      ["run3", () => setRuns((count) => count + 1)],
      ["store", () => setDone(next)],
      [
        "derive",
        () => {
          setOrder(shuffled(DERIVE_NODES));
          setDerives((count) => count + 1);
        },
      ],
      ["view", () => setShown({ done: next, total })],
    ]);
  };

  const otherTab = (): void => {
    const nextTotal = total >= 6 ? 3 : total + 1;
    const nextDone = Math.min(done, nextTotal);
    setSource("tab");
    play([
      ["store", () => {
        setTotal(nextTotal);
        setDone(nextDone);
      }],
      [
        "derive",
        () => {
          setOrder(shuffled(DERIVE_NODES));
          setDerives((count) => count + 1);
        },
      ],
      ["view", () => setShown({ done: nextDone, total: nextTotal })],
    ]);
  };

  const runLit = (index: number): boolean =>
    (phase === "run1" && index === 0) || (phase === "run2" && index <= 1) || (phase === "run3" && index <= 2);
  const deriveLit = phase === "derive";
  const share = shown.total === 0 ? 0 : shown.done / shown.total;

  return (
    <figure className="ce-figure not-content" aria-label="The loop of derive and run">
      <div className="ce-bar">
        <div className="ce-bar-group">
          <button type="button" className="ce-btn" data-variant="primary" onClick={click}>
            Click a card
          </button>
          <button type="button" className="ce-btn" onClick={otherTab}>
            Write from another tab
          </button>
        </div>
        <span className="ce-bar-label" aria-live="polite">
          The run side ran {runs} {runs === 1 ? "time" : "times"}. The derive side ran {derives}{" "}
          {derives === 1 ? "time" : "times"}.
        </span>
      </div>
      <div className="ce-stage ce-scroll">
        <svg className="ce-svg" viewBox="0 0 720 330" style={{ minWidth: "34rem" }} role="img" aria-label="Store, derive, view, event and run in a loop">
          <defs>
            <marker id="ce-loop-derive" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0 0 L10 5 L0 10 Z" style={{ fill: "var(--ce-derive)" }} />
            </marker>
            <marker id="ce-loop-run" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0 0 L10 5 L0 10 Z" style={{ fill: "var(--ce-run)" }} />
            </marker>
          </defs>

          <path d="M200 140 C300 20 420 20 520 140" fill="none" style={{ stroke: "var(--ce-derive)" }} strokeWidth={deriveLit ? 4 : 2} markerEnd="url(#ce-loop-derive)" />
          <path d="M520 180 C420 300 300 300 200 180" fill="none" style={{ stroke: "var(--ce-run)" }} strokeWidth={phase.startsWith("run") ? 4 : 2} strokeDasharray={source === "tab" && phase !== "idle" ? "4 6" : undefined} markerEnd="url(#ce-loop-run)" />

          <text x="360" y="16" textAnchor="middle" fontSize="14" fontWeight="700" style={{ fill: "var(--ce-derive)" }}>
            derive: pure, in any order
          </text>
          <text x="360" y="326" textAnchor="middle" fontSize="14" fontWeight="700" style={{ fill: "var(--ce-run)" }}>
            run: effects, in written order
          </text>

          {DERIVE_POINTS.map((point, index) => {
            const name = DERIVE_NODES[index] ?? "";
            return (
              <g key={name}>
                <circle cx={point.x} cy={point.y} r="21" style={{ fill: deriveLit ? "var(--ce-derive-wash)" : "var(--color-surface)", stroke: "var(--ce-derive)" }} strokeWidth={deriveLit ? 2.5 : 1.5} />
                <text x={point.x} y={point.y + 4} textAnchor="middle" fontSize="12">
                  {name}
                </text>
              </g>
            );
          })}
          {deriveLit && (
            <text x="360" y="104" textAnchor="middle" fontSize="12" style={{ fill: "var(--color-ink-secondary)" }}>
              this time: {order.join(", ")}
            </text>
          )}

          {RUN_POINTS.map((point, index) => {
            const name = RUN_STEPS[index] ?? "";
            const lit = runLit(index);
            return (
              <g key={name}>
                <rect x={point.x - 50} y={point.y - 15} width="100" height="30" rx="4" style={{ fill: lit ? "var(--ce-run-wash)" : "var(--color-surface)", stroke: "var(--ce-run)" }} strokeWidth={lit ? 2.5 : 1.5} />
                <text x={point.x} y={point.y + 4} textAnchor="middle" fontSize="12">
                  {index + 1}. {name}
                </text>
              </g>
            );
          })}

          <g>
            <rect x="40" y="118" width="160" height="84" rx="6" style={{ fill: phase === "store" ? "var(--color-accent-wash)" : "var(--color-surface)", stroke: "var(--color-ink)" }} strokeWidth={phase === "store" ? 2.5 : 1.5} />
            <text x="120" y="146" textAnchor="middle" fontSize="15" fontWeight="700">
              Store
            </text>
            <text x="120" y="172" textAnchor="middle" fontSize="13" style={{ fontFamily: "var(--font-mono)" }}>
              done: {done}
            </text>
            <text x="120" y="190" textAnchor="middle" fontSize="13" style={{ fontFamily: "var(--font-mono)" }}>
              total: {total}
            </text>
          </g>

          <g>
            <rect x="520" y="118" width="160" height="84" rx="6" style={{ fill: phase === "view" ? "var(--color-accent-wash)" : "var(--color-surface)", stroke: "var(--color-ink)" }} strokeWidth={phase === "view" ? 2.5 : 1.5} />
            <text x="600" y="146" textAnchor="middle" fontSize="15" fontWeight="700">
              View
            </text>
            <rect x="540" y="160" width="120" height="10" rx="5" style={{ fill: "var(--color-surface-sunken)", stroke: "var(--color-rule-strong)" }} />
            <rect x="540" y="160" width={120 * share} height="10" rx="5" style={{ fill: "var(--ce-derive)" }} />
            <text x="600" y="192" textAnchor="middle" fontSize="13">
              {shown.done} of {shown.total} done
            </text>
          </g>

          <g>
            <path d="M600 212 L612 224 L600 236 L588 224 Z" style={{ fill: phase === "event" ? "var(--ce-event)" : "var(--color-surface)", stroke: "var(--ce-event)" }} strokeWidth="1.5" />
            <text x="622" y="229" fontSize="12">
              event
            </text>
          </g>
        </svg>
      </div>
      <figcaption className="ce-caption">
        <strong>Click a card</strong> starts the full loop. The event starts a run, the run writes the store, and the derive
        side computes again. <strong>Write from another tab</strong> changes the store directly. The derive side computes
        again, and the run does not start, because a change of data does not repeat an effect.
      </figcaption>
    </figure>
  );
}
