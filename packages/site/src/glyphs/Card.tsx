import { createContext, useContext, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { isHostThing, typeName, type Envelope, type Json, type Result, type Rung, type Side } from "@mark1russell7/coeval";
import ValueGlyph, { valueText } from "./Value.tsx";
import { pathKey, stateAt, useOverlay } from "./overlay.ts";

/** The letter of each rung, for the tab of a card when the picture shows the rungs. */
export const RUNG_LETTER: Readonly<Record<Rung, string>> = { own: "O", kind: "K", default: "D" };

const RUNG_TITLE: Readonly<Record<Rung, string>> = {
  own: "The own entry of the document chose this view.",
  kind: "The kind of the document chose this view.",
  default: "The default of the world chose this view.",
};

/** The tools that an editor puts on a card. A picture without an editor has none. */
export interface Editor {
  /**
   * This function gives the tools of the card at a path.
   *
   * @param path - The path of the card.
   * @param doc - The document of the card.
   * @param declared - `true` when the type came from the container.
   * @returns The tools, or `null`.
   */
  readonly toolsFor: (path: readonly string[], doc: Envelope, declared: boolean) => ReactNode;
}

/** The editor of the picture, if it has one. */
export const EditorContext = createContext<Editor | undefined>(undefined);

/** The props of a card. */
export interface CardProps {
  readonly doc: Envelope;
  /** `true` when the type came from the container, and not from an envelope. */
  readonly declared: boolean;
  readonly path: readonly string[];
  /** The rung that chose the view of the card. */
  readonly rung?: Rung;
  readonly side?: Side;
  /** `true` when the world does not know the type. */
  readonly unknown?: boolean;
  /** `value` draws a small card for one value. `block` draws a card that holds parts. */
  readonly variant?: "value" | "block";
  readonly children: ReactNode;
}

/**
 * This function gives a short form of a result for a port. A scalar stays as it is. A list gives its length, and
 * a record gives its keys. The full value is in the title of the port.
 *
 * @param value - The result.
 * @returns The short form.
 */
function compact(value: Json): { readonly scalar: boolean; readonly text: string } {
  if (value === null || typeof value !== "object" || isHostThing(value)) return { scalar: true, text: "" };
  if (Array.isArray(value)) {
    const count = (value as readonly Json[]).length;
    return { scalar: false, text: `[ ${count} ${count === 1 ? "item" : "items"} ]` };
  }
  const keys = Object.keys(value);
  return { scalar: false, text: `{ ${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""} }` };
}

/** The port of a card: the result of its evaluation, at the lower right edge. */
export function Port({ result }: { readonly result: Result }) {
  if (!result.ok) {
    return (
      <span className="cv-port" data-ok="false" title={result.error.reason}>
        {result.error.code}
      </span>
    );
  }
  const value = result.value as Json;
  const short = compact(value);
  return (
    <span className="cv-port" data-ok="true" title={`The result of this document: ${valueText(value)}`}>
      <span className="cv-port-arrow" aria-hidden="true">
        =
      </span>
      {short.scalar ? <ValueGlyph value={value} /> : <span className="cv-value">{short.text}</span>}
    </span>
  );
}

/**
 * The glyph of a typed document: a card with a tab. The tab holds the type. A dashed tab is a type that the
 * container declares. A name tag holds a binding name. The body holds the value, and the port holds the result.
 */
export default function Card({ doc, declared, path, rung, side = "derive", unknown = false, variant = "block", children }: CardProps) {
  const overlay = useOverlay();
  const editor = useContext(EditorContext);
  const { state, result } = stateAt(overlay, path);
  const key = pathKey(path);
  const selectable = overlay.onSelect !== undefined;

  const select = (event: MouseEvent | KeyboardEvent): void => {
    event.stopPropagation();
    overlay.onSelect?.(path);
  };

  return (
    <div
      className="cv-card"
      data-variant={variant}
      data-side={side}
      data-state={state}
      data-depth={path.length % 2}
      data-selected={overlay.selected === key}
      data-unknown={unknown}
      data-path={key}
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-label={`${typeName(doc.type)}${doc.name === undefined ? "" : `, name ${doc.name}`}`}
      onClick={selectable ? select : undefined}
      onKeyDown={
        selectable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                select(event);
              }
            }
          : undefined
      }
    >
      <span
        className="cv-tab"
        data-declared={declared}
        title={
          unknown
            ? `The world has no kind ${typeName(doc.type)}.`
            : declared
              ? `The container declares the type ${typeName(doc.type)}. The value has no envelope.`
              : `The envelope names the type ${typeName(doc.type)}.`
        }
      >
        {side === "run" && (
          <span className="cv-run-mark" aria-label="run side">
            ▸
          </span>
        )}
        {typeName(doc.type)}
        {overlay.showRungs && rung !== undefined && (
          <span className="cv-rung" title={RUNG_TITLE[rung]}>
            {RUNG_LETTER[rung]}
          </span>
        )}
      </span>
      {(doc.name !== undefined || doc.own !== undefined) && (
        <span className="cv-flags">
          {doc.own !== undefined && (
            <span className="cv-own" title={`Own entries: ${Object.entries(doc.own).map(([verb, name]) => `${verb} → ${name}`).join(", ")}`}>
              own
            </span>
          )}
          {doc.name !== undefined && (
            <span className="cv-name" title={`The binding name ${doc.name}. A sequence gives the result to the later steps under this name.`}>
              {doc.name}
            </span>
          )}
        </span>
      )}
      {editor !== undefined && <span className="cv-tools">{editor.toolsFor(path, doc, declared)}</span>}
      <div className="cv-body">{children}</div>
      {state === "done" && result !== undefined && <Port result={result} />}
      {state === "skipped" && <span className="cv-skip">not evaluated</span>}
    </div>
  );
}
