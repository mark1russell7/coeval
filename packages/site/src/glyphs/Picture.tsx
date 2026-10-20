import { useMemo, useRef } from "react";
import { STD_CAPS, evaluate, flatten, makeContext, type Json, type TraceNode } from "@mark1russell7/coeval";
import { SITE_MACHINE } from "./Explorer.tsx";
import RefArrows from "./RefArrows.tsx";
import { View, SITE_WORLD, WorldContext } from "./View.tsx";
import { OverlayContext, pathKey, type Overlay } from "./overlay.ts";
import { links } from "../lib/scope.ts";

const NO_NAMES: Readonly<Record<string, Json>> = {};

/** The props of a picture. */
export interface PictureProps {
  readonly doc: Json;
  readonly names?: Readonly<Record<string, Json>>;
  /** `true` evaluates the document and shows the ports. */
  readonly evaluated?: boolean;
  /** `true` draws an arrow from each reference back to its binding. */
  readonly arrows?: boolean;
  /** The key of the selected path, if a card is selected. */
  readonly selected?: string;
  /** This function selects a card. */
  readonly onSelect?: (path: readonly string[]) => void;
}

/**
 * A picture of a document: its cards, its results when it is evaluated, and the arrows of its references. Each
 * diagram that shows a document uses this component, so that each document has one picture on each page.
 */
export default function Picture({ doc, names = NO_NAMES, evaluated = true, arrows = true, selected, onSelect }: PictureProps) {
  const box = useRef<HTMLDivElement>(null);
  const refLinks = useMemo(() => links(doc), [doc]);
  const overlay = useMemo<Overlay>(() => {
    if (!evaluated) return { tick: 0, showRungs: false };
    const run = evaluate(SITE_MACHINE, doc, makeContext(names, STD_CAPS));
    const nodes = new Map<string, TraceNode>();
    for (const node of flatten(run.trace)) if (!nodes.has(pathKey(node.path))) nodes.set(pathKey(node.path), node);
    return { run, nodes, tick: run.time, showRungs: false };
  }, [doc, names, evaluated]);
  const withSelection: Overlay = {
    ...overlay,
    ...(selected === undefined ? {} : { selected }),
    ...(onSelect === undefined ? {} : { onSelect }),
  };
  return (
    <div className="cv-picture" ref={box}>
      <WorldContext.Provider value={SITE_WORLD}>
        <OverlayContext.Provider value={withSelection}>
          <View doc={doc} />
        </OverlayContext.Provider>
      </WorldContext.Provider>
      {arrows && <RefArrows container={box} links={refLinks} version={selected ?? ""} />}
    </div>
  );
}
