import { RUNGS, kindNamed, typeName, type Answer, type Effect, type Envelope, type Json, type Rung, type World } from "@mark1russell7/coeval";
import { RUNG_LETTER } from "./Card.tsx";
import ValueGlyph from "./Value.tsx";

const RUNG_TITLE: Readonly<Record<Rung, string>> = { own: "Own entry", kind: "Kind", default: "Default" };

function entries(verbs: Readonly<Record<string, string>> | undefined, verb: string): string {
  if (verbs === undefined) return "no entries";
  const name = Object.hasOwn(verbs, verb) ? verbs[verb] : undefined;
  return name === undefined ? `no entry for ${verb}` : `${verb} → ${name}`;
}

/** The props of the ladder glyph. */
export interface LadderGlyphProps {
  readonly world: World;
  readonly doc: Envelope;
  readonly declared: boolean;
  readonly answer: Answer;
}

/**
 * The glyph of the ladder for one question: three shelves, the default at the top and the own entry at the
 * bottom. A question starts at the bottom. The shelf that answers is marked.
 */
export function LadderGlyph({ world, doc, declared, answer }: LadderGlyphProps) {
  const kind = kindNamed(world, doc.type);
  const holds: Readonly<Record<Rung, string>> = {
    own: entries(doc.own, answer.verb),
    kind: kind === undefined ? `${typeName(doc.type)}: not a kind of this world` : `${typeName(doc.type)}${declared ? " (declared)" : ""}: ${entries(kind.verbs, answer.verb)}`,
    default: entries(world.defaults, answer.verb),
  };
  return (
    <ol className="cv-ladder" aria-label={`The ladder for the verb ${answer.verb}`}>
      {[...RUNGS].reverse().map((rung) => {
        const step = answer.steps.find((item) => item.rung === rung);
        const state =
          step === undefined ? "unvisited" : step.outcome === "answers" ? "answers" : step.outcome === "unknown-kind" ? "stops" : "passed";
        return (
          <li key={rung} className="cv-shelf" data-state={state}>
            <span className="cv-shelf-head">
              <span className="cv-shelf-letter">{RUNG_LETTER[rung]}</span>
              {RUNG_TITLE[rung]}
            </span>
            <span className="cv-shelf-holds">{holds[rung]}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The props of the context strip. */
export interface ContextStripProps {
  readonly scope: Readonly<Record<string, Json>>;
  readonly caps: readonly string[];
}

/** The glyph of a context: the names with their values, and the capabilities. */
export function ContextStrip({ scope, caps }: ContextStripProps) {
  const names = Object.entries(scope);
  return (
    <div className="cv-context">
      <div className="cv-context-row" data-part="names">
        <span className="cv-context-label">
          <span className="ce-swatch" aria-hidden="true" />
          Names
        </span>
        {names.length === 0 ? (
          <span className="cv-muted">none</span>
        ) : (
          names.map(([name, value]) => (
            <span key={name} className="cv-name-chip">
              {name} <ValueGlyph value={value} />
            </span>
          ))
        )}
      </div>
      <div className="cv-context-row" data-part="caps">
        <span className="cv-context-label">
          <span className="ce-swatch" aria-hidden="true" />
          Capabilities
        </span>
        {caps.length === 0 ? (
          <span className="cv-muted">none</span>
        ) : (
          caps.map((cap) => (
            <span key={cap} className="cv-cap-chip">
              {cap}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

/** The props of the effects log. */
export interface EffectsLogProps {
  readonly effects: readonly Effect[];
  /** The number of events that happened. An effect shows when its event happened. */
  readonly tick: number;
}

/** The glyph of the effects: one numbered ticket for each effect, in the order of the effects. */
export function EffectsLog({ effects, tick }: EffectsLogProps) {
  const shown = effects.filter((effect) => effect.at < tick);
  return (
    <div className="cv-effects" aria-live="polite">
      <span className="cv-effects-title">The world: the effects, in order</span>
      {shown.length === 0 ? (
        <span className="cv-muted">No effect yet.</span>
      ) : (
        <ol className="cv-tickets">
          {shown.map((effect) => (
            <li key={effect.index} className="cv-ticket">
              <span className="cv-ticket-number">{effect.index + 1}</span>
              <span className="cv-ticket-kind">{effect.kind}</span>
              <ValueGlyph value={effect.payload as Json} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The glyph of a sealed part: the evaluator sees its key and its name, and not its value. */
export function SealedPart({ partKey, name }: { readonly partKey: string; readonly name?: string }) {
  return (
    <span className="cv-sealed" title="A sealed part. The evaluator can evaluate it, and cannot read it.">
      <span className="cv-sealed-key">{partKey}</span>
      {name !== undefined && <span className="cv-name-chip">{name}</span>}
    </span>
  );
}
