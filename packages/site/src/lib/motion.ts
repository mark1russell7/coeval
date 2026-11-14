import { useEffect, useState } from "react";
import type { Json, JsonRecord } from "@mark1russell7/coeval";

/**
 * This hook tells if the reader asks for less motion. It is `false` on the server.
 *
 * @returns `true` when the reader prefers reduced motion.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const listen = (event: MediaQueryListEvent): void => setReduced(event.matches);
    query.addEventListener("change", listen);
    return () => query.removeEventListener("change", listen);
  }, []);
  return reduced;
}

/**
 * This hook shows the steps of a sequence one at a time. A new key starts the sequence again.
 * With reduced motion, the hook shows all of the steps at once.
 *
 * @param total - The number of steps.
 * @param key - A value that changes when the sequence must start again.
 * @param interval - The time between two steps, in milliseconds.
 * @returns The number of steps to show.
 */
export function useStepper(total: number, key: string, interval = 520): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(total);
  useEffect(() => {
    if (reduced) {
      setShown(total);
      return undefined;
    }
    setShown(1);
    let count = 1;
    const timer = window.setInterval(() => {
      count += 1;
      setShown(count);
      if (count >= total) window.clearInterval(timer);
    }, interval);
    return () => window.clearInterval(timer);
  }, [key, total, interval, reduced]);
  return Math.min(shown, total);
}

/** The longest text between the braces of a record that goes on one line. The printer counts the indented text, as before K274. */
const RECORD_LINE = 40;

/** A value with no parts: a number, a text, a boolean or `null`. */
function isLeaf(value: Json): boolean {
  return value === null || typeof value !== "object";
}

function printJson(value: Json, pad: string): string {
  if (isLeaf(value)) return JSON.stringify(value);
  const inner = `${pad}  `;
  if (Array.isArray(value)) {
    const items = value as readonly Json[];
    if (items.length === 0) return "[]";
    const texts = items.map((item) => printJson(item, inner));
    return items.every(isLeaf) ? `[${texts.join(", ")}]` : `[\n${inner}${texts.join(`,\n${inner}`)}\n${pad}]`;
  }
  const entries = Object.entries(value as JsonRecord);
  if (entries.length === 0) return "{}";
  const texts = entries.map(([key, item]) => `${JSON.stringify(key)}: ${printJson(item, inner)}`);
  const lines = texts.join(`,\n${inner}`);
  return entries.every(([, item]) => isLeaf(item)) && lines.length <= RECORD_LINE ? `{ ${texts.join(", ")} }` : `{\n${inner}${lines}\n${pad}}`;
}

/**
 * This function writes a JSON value with two spaces of indent. An array of values with no parts goes on one line. A
 * record of such values goes on one line when it is short. The function walks the structure, thus it does not change
 * the text of a string (K274).
 *
 * @param value - The value to write. The function reads it through `JSON.stringify`, thus it drops what JSON drops.
 * @returns The text, or an empty text for a value that has no JSON text.
 */
export function prettyJson(value: unknown): string {
  const text = JSON.stringify(value);
  return text === undefined ? "" : printJson(JSON.parse(text) as Json, "");
}
