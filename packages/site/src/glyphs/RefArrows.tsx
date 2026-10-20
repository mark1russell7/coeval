import { useLayoutEffect, useState, type RefObject } from "react";
import type { Link } from "../lib/scope.ts";
import { pathKey } from "./overlay.ts";

interface Drawn {
  readonly key: string;
  readonly d: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

/** The props of the arrows of the references. */
export interface RefArrowsProps {
  /** The element that holds the picture. The arrows are drawn in its box. */
  readonly container: RefObject<HTMLElement | null>;
  readonly links: readonly Link[];
  /** A value that changes when the picture changes, so that the arrows move with the cards. */
  readonly version: string;
}

/**
 * The arrows of the references: from each reference card back to the card that binds its name. The arrow is the
 * move back, drawn on the picture. Its color is the color of the names.
 */
export default function RefArrows({ container, links, version }: RefArrowsProps) {
  const [drawn, setDrawn] = useState<readonly Drawn[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const box = container.current;
    if (box === null) return undefined;
    const measure = (): void => {
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
      setSize({ width: box.scrollWidth, height: box.scrollHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [container, links, version]);

  if (drawn.length === 0) return null;
  return (
    <svg className="cv-arrows" width={size.width} height={size.height} aria-hidden="true">
      <defs>
        <marker id="cv-ref-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 Z" style={{ fill: "var(--ce-names)" }} />
        </marker>
      </defs>
      {drawn.map((arrow) => (
        <g key={arrow.key}>
          <path d={arrow.d} className="cv-arrow-ref" markerEnd="url(#cv-ref-head)" />
        </g>
      ))}
    </svg>
  );
}
