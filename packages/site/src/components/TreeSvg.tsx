import { useId, type KeyboardEvent } from "react";
import { TREE, type TreeNode } from "../lib/tree.ts";

const HALF_WIDTH = 38;
const HALF_HEIGHT = 15;

/** An arrow between two nodes of the tree. */
export interface TreeArrow {
  readonly from: string;
  readonly to: string;
  /** A CSS color, for example `var(--ce-names)`. */
  readonly color: string;
  readonly dashed?: boolean;
  /** A sideways shift of the arrow in pixels, so that two arrows between the same nodes do not overlap. */
  readonly shift?: number;
  /** A bend of the arrow in pixels. 0 gives a straight line. */
  readonly bend?: number;
}

/** The props of the tree drawing. */
export interface TreeSvgProps {
  readonly label: string;
  readonly stateOf: (id: string) => "focus" | "target" | "dim" | "normal";
  readonly arrows: readonly TreeArrow[];
  readonly onSelect?: (id: string) => void;
}

function find(id: string): TreeNode | undefined {
  return TREE.find((item) => item.id === id);
}

/** This function gives the point where the line from a node center toward another point leaves the box of the node. */
function edgePoint(from: TreeNode, toX: number, toY: number): readonly [number, number] {
  const dx = toX - from.x;
  const dy = toY - from.y;
  const scale = Math.min(dx === 0 ? Infinity : HALF_WIDTH / Math.abs(dx), dy === 0 ? Infinity : HALF_HEIGHT / Math.abs(dy));
  return [from.x + dx * scale, from.y + dy * scale];
}

function arrowPath(arrow: TreeArrow): string {
  const a = find(arrow.from);
  const b = find(arrow.to);
  if (a === undefined || b === undefined) return "";
  const shift = arrow.shift ?? 0;
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / length;
  const ny = (b.x - a.x) / length;
  const from = { ...a, x: a.x + nx * shift, y: a.y + ny * shift };
  const to = { ...b, x: b.x + nx * shift, y: b.y + ny * shift };
  const [x1, y1] = edgePoint(from, to.x, to.y);
  const [x2, y2] = edgePoint(to, from.x, from.y);
  const bend = arrow.bend ?? 0;
  const cx = (x1 + x2) / 2 + nx * bend;
  const cy = (y1 + y2) / 2 + ny * bend;
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/** The drawing of the example tree, with nodes that a reader can select and arrows between them. */
export default function TreeSvg({ label, stateOf, arrows, onSelect }: TreeSvgProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const colors = [...new Set(arrows.map((arrow) => arrow.color))];
  const markerId = (color: string): string => `${id}-m${colors.indexOf(color)}`;

  const keyDown = (event: KeyboardEvent<SVGGElement>, node: string): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect?.(node);
    }
  };

  return (
    <svg className="ce-svg" viewBox="0 0 560 236" role="group" aria-label={label}>
      <defs>
        {colors.map((color) => (
          <marker
            key={color}
            id={markerId(color)}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 Z" style={{ fill: color }} />
          </marker>
        ))}
      </defs>
      {TREE.filter((item) => item.parent !== undefined).map((item) => {
        const parent = find(item.parent ?? "");
        if (parent === undefined) return null;
        return (
          <line
            key={`edge-${item.id}`}
            className="ce-edge"
            x1={parent.x}
            y1={parent.y + HALF_HEIGHT}
            x2={item.x}
            y2={item.y - HALF_HEIGHT}
          />
        );
      })}
      {arrows.map((arrow, index) => (
        <path
          key={`${arrow.from}-${arrow.to}-${String(index)}`}
          className="ce-arrow"
          d={arrowPath(arrow)}
          style={{ stroke: arrow.color }}
          strokeDasharray={arrow.dashed === true ? "6 5" : undefined}
          markerEnd={`url(#${markerId(arrow.color)})`}
        />
      ))}
      {TREE.map((item) => (
        <g
          key={item.id}
          className="ce-node"
          data-state={stateOf(item.id)}
          role={onSelect === undefined ? undefined : "button"}
          tabIndex={onSelect === undefined ? undefined : 0}
          aria-label={onSelect === undefined ? undefined : `Focus on ${item.label}`}
          onClick={() => onSelect?.(item.id)}
          onKeyDown={(event) => keyDown(event, item.id)}
        >
          <rect x={item.x - HALF_WIDTH} y={item.y - HALF_HEIGHT} width={HALF_WIDTH * 2} height={HALF_HEIGHT * 2} rx="4" />
          <text x={item.x} y={item.y + 4.5} textAnchor="middle" fontSize="13">
            {item.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
