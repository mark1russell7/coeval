import { type Json, type JsonRecord, field, isRecord } from "./doc.ts";
import type { PartsSpec } from "./ladder.ts";

/** One part of a value: its key, the JSON of the part, and the type that its position declares. */
export interface PartSlot {
  readonly key: string;
  readonly item: Json;
  readonly of?: string;
}

/** The value of a document, split into its data and its parts. */
export type Split =
  | { readonly ok: true; readonly data: Json; readonly parts: readonly PartSlot[] }
  | { readonly ok: false; readonly reason: string };

/**
 * This function splits a value into its data and its parts, by the contract of its kind. The evaluator and the
 * view use the same split, thus a picture shows the parts that the evaluation gets.
 *
 * @param spec - The contract of the parts.
 * @param value - The value of the document.
 * @returns The data and the parts, or the reason why the value does not obey the contract.
 */
export function splitParts(spec: PartsSpec | undefined, value: Json): Split {
  const of = (slot: { key: string; item: Json }, declared: string | undefined): PartSlot =>
    declared === undefined ? slot : { ...slot, of: declared };
  if (spec === undefined || spec.shape === "none") return { ok: true, data: value, parts: [] };
  if (spec.shape === "list") {
    if (!Array.isArray(value)) return { ok: false, reason: "The value must be a list." };
    const items: readonly Json[] = value;
    return { ok: true, data: null, parts: items.map((item, index) => of({ key: String(index), item }, spec.of)) };
  }
  if (!isRecord(value)) return { ok: false, reason: "The value must be a record." };
  const record: JsonRecord = value;
  const rest: Record<string, Json> = {};
  for (const [key, item] of Object.entries(record)) if (!spec.fields.includes(key)) rest[key] = item;
  const parts: PartSlot[] = [];
  for (const key of spec.fields) {
    const item = field(record, key);
    if (item !== undefined) parts.push(of({ key, item }, spec.of));
  }
  return { ok: true, data: rest, parts };
}
