import { createContext, useContext } from "react";
import type { Result, Run, TraceNode } from "@mark1russell7/coeval";

/**
 * The state of a card at one moment of an evaluation.
 *
 * - `static`: the picture shows no evaluation.
 * - `pending`: the evaluation of the card did not start yet.
 * - `active`: the evaluation started and did not end. One of its parts is in progress.
 * - `current`: the last event of the moment is on this card.
 * - `done`: the evaluation ended, and the card shows its result.
 * - `skipped`: the evaluation ended, and this card was not evaluated.
 */
export type CardState = "static" | "pending" | "active" | "current" | "done" | "skipped";

/** What the cards of a picture know about the evaluation that the picture shows. */
export interface Overlay {
  /** The evaluation, or `undefined` for a picture without one. */
  readonly run?: Run;
  /** The first evaluation of each path of the document, by the key of the path. */
  readonly nodes?: ReadonlyMap<string, TraceNode>;
  /** The number of events that happened. Each start and each end of an evaluation is one event. */
  readonly tick: number;
  /** The ID of the node of the last event. */
  readonly current?: number;
  /** When `true`, each tab shows the rung of the ladder that chose its view. */
  readonly showRungs: boolean;
  /** The key of the selected path. */
  readonly selected?: string;
  /** This function selects a card. A picture without it has no selection. */
  readonly onSelect?: (path: readonly string[]) => void;
}

/** The overlay of a picture without an evaluation. */
export const STATIC_OVERLAY: Overlay = { tick: 0, showRungs: false };

/** The overlay that the cards of a picture read. */
export const OverlayContext = createContext<Overlay>(STATIC_OVERLAY);

/**
 * This hook gives the overlay of the picture.
 *
 * @returns The overlay.
 */
export function useOverlay(): Overlay {
  return useContext(OverlayContext);
}

/**
 * This function gives the key of a path: its keys joined with a slash. The root has the empty key.
 *
 * @param path - The keys from the root.
 * @returns The key.
 */
export function pathKey(path: readonly string[]): string {
  return path.join("/");
}

/**
 * This function gives the state of the card at a path, and its result when the evaluation of the card ended.
 *
 * @param overlay - The overlay of the picture.
 * @param path - The path of the card.
 * @returns The state, the node and the result.
 */
export function stateAt(
  overlay: Overlay,
  path: readonly string[],
): { readonly state: CardState; readonly node?: TraceNode; readonly result?: Result } {
  const run = overlay.run;
  if (run === undefined) return { state: "static" };
  const node = overlay.nodes?.get(pathKey(path));
  if (node === undefined) return { state: overlay.tick >= run.time ? "skipped" : "pending" };
  if (node.enter >= overlay.tick) return { state: "pending", node };
  if (node.exit < overlay.tick) return { state: "done", node, result: node.result };
  return { state: node.id === overlay.current ? "current" : "active", node };
}
