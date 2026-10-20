import { useMemo } from "react";
import { STD_CAPS, evaluate, flatten, makeContext, type Json, type TraceNode } from "@coeval/core";
import { SITE_MACHINE } from "./Explorer.tsx";
import { View, SITE_WORLD, WorldContext } from "./View.tsx";
import { OverlayContext, pathKey, type Overlay } from "./overlay.ts";

const NO_NAMES: Readonly<Record<string, Json>> = {};

/** The props of an evaluated picture. */
export interface EvaluatedProps {
  readonly doc: Json;
  readonly names?: Readonly<Record<string, Json>>;
  readonly caps?: readonly string[];
}

/** The picture of a document after its evaluation: each card shows its result in its port. */
export default function Evaluated({ doc, names = NO_NAMES, caps = STD_CAPS }: EvaluatedProps) {
  const overlay = useMemo<Overlay>(() => {
    const run = evaluate(SITE_MACHINE, doc, makeContext(names, caps));
    const nodes = new Map<string, TraceNode>();
    for (const node of flatten(run.trace)) if (!nodes.has(pathKey(node.path))) nodes.set(pathKey(node.path), node);
    return { run, nodes, tick: run.time, showRungs: false };
  }, [doc, names, caps]);
  return (
    <WorldContext.Provider value={SITE_WORLD}>
      <OverlayContext.Provider value={overlay}>
        <View doc={doc} />
      </OverlayContext.Provider>
    </WorldContext.Provider>
  );
}
