import { useId, useLayoutEffect, useState, type RefObject } from "react";
import type { Link } from "../lib/scope.ts";
import type { Move } from "../lib/moves.ts";
import { pathKey } from "./overlay.ts";

interface Drawn {
  readonly key: string;
  readonly d: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

interface DrawnMove {
  readonly key: string;
  readonly d: string;
  readonly step: string;
  readonly x: number;
  readonly y: number;
}

const NO_MOVES: readonly Move[] = [];

/** This function gives the text of a place for a reader. The root document has the text `the root`. */
function placeText(path: readonly string[]): string {
  return path.length === 0 ? "the root" : path.join(" / ");
}

/** The props of the arrows of the references. */
export interface RefArrowsProps {
  /** The element that holds the picture. The arrows are drawn in its box. */
  readonly container: RefObject<HTMLElement | null>;
  readonly links: readonly Link[];
  /** The moves of the paths: one solid arrow for each hop, with the text of its step. */
  readonly moves?: readonly Move[];
  /** A value that changes when the picture changes, so that the arrows move with the cards. */
  readonly version: string;
}

/**
 * The arrows of the references. A dashed arrow goes from each reference card back to the card that binds its name.
 * Its color is the color of the names. A solid arrow goes along each move of a path, from the reference through each
 * card that the path visits. Its color is the color of a move, and the text of its step goes on it.
 */
export default function RefArrows({ container, links, moves = NO_MOVES, version }: RefArrowsProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const marker = `cv-ref-head-${id}`;
  const moveMarker = `cv-move-head-${id}`;
  const [drawn, setDrawn] = useState<readonly Drawn[]>([]);
  const [drawnMoves, setDrawnMoves] = useState<readonly DrawnMove[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    // The ref of the container attaches after the effects of its children, thus the first measure waits one frame.
    let observer: ResizeObserver | undefined;
    const measure = (box: HTMLElement): void => {
      const origin = box.getBoundingClientRect();
      const find = (path: readonly string[]): DOMRect | undefined =>
        box.querySelector<HTMLElement>(`[data-path="${CSS.escape(pathKey(path))}"]`)?.getBoundingClientRect();
      const out: Drawn[] = [];
      for (const link of links) {
        const from = find(link.from);
        const to = find(link.to);
        if (from === undefined || to === undefined) continue;
        const x1 = from.left - origin.left + box.scrollLeft;
        const y1 = from.top - origin.top + from.height / 2;
        const x2 = to.left - origin.left + box.scrollLeft;
        const y2 = to.top - origin.top + Math.min(18, to.height / 2);
        const reach = 26 + Math.abs(y1 - y2) * 0.12;
        const bend = Math.min(x1, x2) - reach;
        out.push({
          key: `${pathKey(link.from)}>${pathKey(link.to)}`,
          d: `M${x1 - 2} ${y1} C${bend} ${y1} ${bend} ${y2} ${x2 - 2} ${y2}`,
          name: link.name,
          x: bend + 4,
          y: (y1 + y2) / 2,
        });
      }
      setDrawn(out);
      // A move goes to a point in the head of the card that it reaches: across, then up or down.
      const head = (rect: DOMRect): { readonly x: number; readonly y: number } => ({
        x: rect.left - origin.left + box.scrollLeft + 10,
        y: rect.top - origin.top + Math.min(12, rect.height / 2),
      });
      const steps: DrawnMove[] = [];
      for (const move of moves) {
        const from = find(move.from);
        const to = find(move.to);
        if (from === undefined || to === undefined) continue;
        const start = move.index === 0 ? { x: from.left - origin.left + box.scrollLeft, y: from.top - origin.top + from.height / 2 } : head(from);
        const end = head(to);
        const across = Math.abs(start.x - end.x) < 4 ? end.x - 14 : end.x;
        steps.push({
          key: `${pathKey(move.ref)}#${move.index}`,
          d: `M${start.x} ${start.y} Q${across} ${start.y} ${end.x} ${end.y}`,
          step: move.step,
          x: (start.x + across) / 2,
          y: start.y - 4,
        });
      }
      setDrawnMoves(steps);
      setSize({ width: box.scrollWidth, height: box.scrollHeight });
    };
    const frame = window.requestAnimationFrame(() => {
      const box = container.current;
      if (box === null) return;
      measure(box);
      observer = new ResizeObserver(() => measure(box));
      observer.observe(box);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [container, links, moves, version]);

  return (
    <>
      {(drawn.length > 0 || drawnMoves.length > 0) && (
        <svg className="cv-arrows" width={size.width} height={size.height} aria-hidden="true">
          <defs>
            <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L10 5 L0 10 Z" style={{ fill: "var(--ce-names)" }} />
            </marker>
            <marker id={moveMarker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 L10 5 L0 10 Z" style={{ fill: "var(--ce-move)" }} />
            </marker>
          </defs>
          {drawn.map((arrow) => (
            <g key={arrow.key}>
              <path d={arrow.d} className="cv-arrow-ref" markerEnd={`url(#${marker})`} />
            </g>
          ))}
          {drawnMoves.map((arrow) => (
            <g key={arrow.key}>
              <path d={arrow.d} className="cv-arrow-move" markerEnd={`url(#${moveMarker})`} />
              <text x={arrow.x} y={arrow.y} className="cv-arrow-step">
                {arrow.step}
              </text>
            </g>
          ))}
        </svg>
      )}
      {moves.length > 0 && (
        <ul className="cv-sr-only" aria-label="The moves of the paths">
          {moves.map((move) => (
            <li key={`${pathKey(move.ref)}#${move.index}`}>
              The path of the reference at {placeText(move.ref)}, move {move.index + 1}: the step {move.step} goes from {placeText(move.from)} to{" "}
              {placeText(move.to)}.
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
