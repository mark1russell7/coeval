import { useEffect, useState } from "react";

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

/**
 * This function writes a JSON value with two spaces of indent, and keeps short arrays and records on one line.
 *
 * @param value - The value to write.
 * @returns The text.
 */
export function prettyJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  return text.replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_match, inner: string) => `[${inner.replace(/\s*\n\s*/g, " ")}]`)
    .replace(/\{\s+([^[\]{}]{0,40}?)\s+\}/g, (_match, inner: string) => `{ ${inner.replace(/\s*\n\s*/g, " ")} }`);
}
