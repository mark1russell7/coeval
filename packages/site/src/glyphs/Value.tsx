import { isHostThing, type Json } from "@mark1russell7/coeval";

/**
 * This function gives a short text for a result. A host thing, for example a node of a tree, gives its label. Each
 * other value gives its JSON.
 *
 * @param value - The value.
 * @returns The text.
 */
export function valueText(value: unknown): string {
  if (isHostThing(value)) return value.label;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** The props of a value glyph. */
export interface ValueGlyphProps {
  readonly value: Json;
  /** `large` draws the value of a value card. */
  readonly size?: "small" | "large";
}

/**
 * The glyph of data: a value without a type. A number, a text and a truth value are one word. A list and a
 * record show their items. Data has no tab, because data has no type of its own.
 */
export default function ValueGlyph({ value, size = "small" }: ValueGlyphProps) {
  // A node of an open tree is a host thing. The glyph shows its label, because its attributes evaluate on demand.
  if (isHostThing(value)) {
    return (
      <span className="cv-value cv-thing" data-size={size} data-of="thing" title="A node of a tree">
        {value.label}
      </span>
    );
  }
  if (value === null) {
    return (
      <span className="cv-value" data-size={size} data-of="null" title="no value">
        ∅
      </span>
    );
  }
  if (typeof value === "number") {
    return (
      <span className="cv-value" data-size={size} data-of="number">
        {Number.isInteger(value) ? String(value) : value.toFixed(2)}
      </span>
    );
  }
  if (typeof value === "string") {
    return (
      <span className="cv-value" data-size={size} data-of="text">
        “{value}”
      </span>
    );
  }
  if (typeof value === "boolean") {
    return (
      <span className="cv-value" data-size={size} data-of="bool">
        {value ? "true" : "false"}
      </span>
    );
  }
  if (Array.isArray(value)) {
    const items: readonly Json[] = value;
    return (
      <span className="cv-value cv-list" data-size={size} data-of="list">
        [
        {items.map((item, index) => (
          <span key={index} className="cv-list-item">
            <ValueGlyph value={item} />
          </span>
        ))}
        ]
      </span>
    );
  }
  const entries = Object.entries(value);
  return (
    <span className="cv-value cv-record" data-size={size} data-of="record">
      {entries.length === 0 ? (
        "{ }"
      ) : (
        entries.map(([key, item]) => (
          <span key={key} className="cv-field">
            <span className="cv-field-key">{key}</span>
            <ValueGlyph value={item} />
          </span>
        ))
      )}
    </span>
  );
}
