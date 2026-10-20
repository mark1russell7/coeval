import { useMemo, useState } from "react";
import {
  STD_CAPS,
  ROOTS,
  context,
  evaluate,
  isHostThing,
  makeContext,
  ref,
  resolve,
  worldThing,
  type Hop,
  type Json,
  type Machine,
  type Resolution,
  type Thing,
} from "@mark1russell7/coeval";
import { SITE_MACHINE } from "../glyphs/Explorer.tsx";
import { View, SITE_WORLD, WorldContext } from "../glyphs/View.tsx";
import ValueGlyph from "../glyphs/Value.tsx";
import { useStepper } from "../lib/motion.ts";
import { TREE } from "../lib/programs.ts";

interface Walk {
  readonly id: string;
  readonly label: string;
  readonly path: readonly Json[];
  readonly resolution: Resolution;
  readonly note: string;
}

/** This function evaluates the tree, and keeps the resolution of each reference in the order of the evaluation. */
function treeWalks(): readonly { readonly path: readonly Json[]; readonly resolution: Resolution }[] {
  const seen: { path: readonly Json[]; resolution: Resolution }[] = [];
  const base = SITE_MACHINE.evaluators["ref.resolve"];
  const machine: Machine = {
    ...SITE_MACHINE,
    evaluators: {
      ...SITE_MACHINE.evaluators,
      "ref.resolve": (input) => {
        if (Array.isArray(input.data)) {
          const path: readonly Json[] = input.data;
          seen.push({ path, resolution: input.resolve(path) });
        }
        return base === undefined ? { ok: false, error: { code: "#NOEVAL", reason: "No evaluator." } } : base(input);
      },
    },
  };
  evaluate(machine, TREE, makeContext({}, STD_CAPS));
  return seen;
}

function walks(): readonly Walk[] {
  const names = context({
    names: { cards: { ids: [7, 8], count: 2 }, alias: ref("names", "real"), real: 42 },
    world: worldThing(SITE_WORLD),
  });
  const tree = treeWalks();
  const up = tree.find((item) => item.path.length === 3);
  const near = tree.find((item) => item.path.some((step) => typeof step === "object" && step !== null));
  const list: Walk[] = [
    {
      id: "names",
      label: "A name",
      path: ["names", "cards", "ids", 1],
      resolution: resolve(SITE_MACHINE, names, ["names", "cards", "ids", 1]),
      note: "The root names holds the values that the evaluators around the reference bound. The default answers each later step: a field, then an item.",
    },
  ];
  if (up !== undefined) {
    list.push({
      id: "up",
      label: "Up a tree",
      path: up.path,
      resolution: up.resolution,
      note: "The root self is the node that holds the formula. A node answers parent itself (own), as any other field.",
    });
  }
  if (near !== undefined) {
    list.push({
      id: "nearest",
      label: "The nearest panel",
      path: near.path,
      resolution: near.resolution,
      note: "A computed step is a document of the kind nearest. Its walker follows parent until it reaches a panel.",
    });
  }
  list.push(
    {
      id: "type",
      label: "A type is a path",
      path: ["world", "math", "product"],
      resolution: resolve(SITE_MACHINE, names, ["world", "math", "product"]),
      note: "The root world is the registry. The entry product is an alias, thus the walk follows it to the kind multiply (collapse).",
    },
    {
      id: "collapse",
      label: "A reference to a reference",
      path: ["names", "alias"],
      resolution: resolve(SITE_MACHINE, names, ["names", "alias"]),
      note: "The name alias holds a reference. The walk follows it until it reaches something that is not a reference.",
    },
    {
      id: "missing",
      label: "A step that reaches nothing",
      path: ["names", "cards", "price"],
      resolution: resolve(SITE_MACHINE, names, ["names", "cards", "price"]),
      note: "The record has no field price. The walk stops with #REF!, and it keeps the hops before the failure.",
    },
  );
  return list;
}

/** The glyph of a thing that a hop reached: a node of a tree, a value, or a summary of a large record. */
function ThingGlyph({ thing }: { readonly thing: Thing }) {
  if (isHostThing(thing)) {
    return (
      <span className="cv-thing" data-part="focus">
        {thing.label}
      </span>
    );
  }
  if (thing !== null && typeof thing === "object" && !Array.isArray(thing)) {
    const keys = Object.keys(thing);
    if (keys.length > 4 || JSON.stringify(thing).length > 60) {
      return (
        <span className="cv-thing">
          {"{ "}
          {keys.slice(0, 4).join(", ")}
          {keys.length > 4 ? ", …" : ""}
          {" }"}
        </span>
      );
    }
  }
  return <ValueGlyph value={thing as Json} />;
}

const BY_TEXT: Readonly<Record<Hop["by"], string>> = {
  root: "root",
  own: "own",
  kind: "kind",
  default: "default",
  step: "step",
  collapse: "collapse",
};

/**
 * The walk diagram. A reader picks a reference. The diagram resolves it with the model and draws each hop: the
 * step, the rung that answered it, and what it reached.
 */
export default function WalkDiagram() {
  const all = useMemo(walks, []);
  const [id, setId] = useState("names");
  const walk = all.find((item) => item.id === id) ?? all[0];
  const hops = walk?.resolution.hops ?? [];
  const total = hops.length + 1;
  const shown = useStepper(total, id, 600);
  if (walk === undefined) return null;
  const root = typeof walk.path[0] === "string" ? walk.path[0] : "";
  const done = shown >= total;

  return (
    <figure className="ce-figure not-content" aria-label="The walk of a path">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="Reference">
          <span className="ce-bar-label">Reference</span>
          {all.map((item) => (
            <button key={item.id} type="button" className="ce-btn" aria-pressed={item.id === id} onClick={() => setId(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ce-stage">
        <WorldContext.Provider value={SITE_WORLD}>
          <p className="ce-panel-title">The reference</p>
          <View doc={{ type: "ref", value: walk.path }} />
          <p className="ce-panel-title" style={{ marginTop: "var(--space-4)" }}>
            The context: the walk starts at one of its five roots
          </p>
          <div className="cv-roots">
            {ROOTS.map((name) => (
              <span key={name} className="cv-root" data-part={name === "self" ? "focus" : name} data-lit={name === root}>
                {name}
              </span>
            ))}
          </div>
          <p className="ce-panel-title" style={{ marginTop: "var(--space-4)" }}>
            The hops
          </p>
          <ol className="cv-hops">
            {hops.slice(0, shown).map((hop, index) => (
              <li key={index} className="cv-hop" data-by={hop.by}>
                <span className="cv-hop-step">
                  {hop.by === "collapse" ? (
                    <span className="cv-muted">follow the reference</span>
                  ) : typeof hop.step === "object" && hop.step !== null ? (
                    <View doc={hop.step} />
                  ) : index === 0 ? (
                    <span className="cv-path-root" data-part={hop.step === "self" ? "focus" : String(hop.step)}>
                      {String(hop.step)}
                    </span>
                  ) : (
                    <span className="cv-path-step cv-path-step-alone">{String(hop.step)}</span>
                  )}
                </span>
                <span className="cv-hop-by" title="The rung that answered this hop">
                  {BY_TEXT[hop.by]}
                </span>
                <span className="cv-hop-arrow" aria-hidden="true">
                  →
                </span>
                <ThingGlyph thing={hop.thing} />
              </li>
            ))}
          </ol>
          {done && (
            <div className="ce-result" data-state={walk.resolution.ok ? "go" : "stop"} aria-live="polite">
              {walk.resolution.ok ? (
                <span>
                  The path reaches <ThingGlyph thing={walk.resolution.thing} />.
                </span>
              ) : (
                <span>
                  <strong>{walk.resolution.code}</strong> {walk.resolution.reason}
                </span>
              )}
            </div>
          )}
        </WorldContext.Provider>
      </div>
      <figcaption className="ce-caption">{walk.note}</figcaption>
    </figure>
  );
}
