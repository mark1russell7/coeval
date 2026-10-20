import type { Json } from "@coeval/core";

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
