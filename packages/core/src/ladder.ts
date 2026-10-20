import { type TypeRef, typeName } from "./doc.ts";
import { type Kind, type World, lookupKind } from "./world.ts";

export type { Kind, Namespace, PartsSpec, Side, World, WorldEntry } from "./world.ts";

/** The rungs of the ladder, in the order that a question visits them. */
export const RUNGS = ["own", "kind", "default"] as const;

/** One rung of the ladder. */
export type Rung = (typeof RUNGS)[number];

/** The place where the ladder found the type. */
export type KindSource = "document" | "container";

/**
 * The outcome of one rung.
 *
 * - `answers`: the rung gives an evaluator.
 * - `no-entry`: the rung has nothing for this verb, thus the question goes to the next rung.
 * - `skipped`: the rung does not apply, because no type is known.
 * - `unknown-kind`: the type is not a kind of the world. The question stops.
 */
export type Outcome = "answers" | "no-entry" | "skipped" | "unknown-kind";

/** The record of one rung that a question visited. */
export interface Step {
  readonly rung: Rung;
  readonly outcome: Outcome;
  /** The evaluator, when the outcome is `answers`. */
  readonly evaluator?: string;
  /** The text of the type, at the kind rung. */
  readonly kind?: string;
  /** The place of the type, at the kind rung. */
  readonly source?: KindSource;
}

/** The answer to a question. It keeps the record of each rung that the question visited. */
export interface Answer {
  readonly verb: string;
  /** The evaluator that answers. A question that stops with an error has no evaluator. */
  readonly evaluator?: string;
  /** The rung that answered. */
  readonly rung?: Rung;
  /** The reason when no rung answers. */
  readonly error?: "unknown-kind" | "no-answer";
  readonly steps: readonly Step[];
}

/**
 * The header that the ladder reads: the type and the own entries. An envelope is a header. A bare value has an
 * empty header, and its position can declare its type.
 */
export interface Header {
  readonly type?: TypeRef;
  readonly own?: Readonly<Record<string, string>>;
}

/** The options of a question. */
export interface AskOptions {
  /** The type that the position of a bare value declares. The type of an envelope wins. */
  readonly declaredType?: string;
}

function entryOf(verbs: Readonly<Record<string, string>> | undefined, verb: string): string | undefined {
  return verbs !== undefined && Object.hasOwn(verbs, verb) ? verbs[verb] : undefined;
}

/**
 * This function finds the kind that a type names, and follows each alias. It gives `undefined` for an unknown
 * type.
 *
 * @param world - The world.
 * @param type - The reference to the type.
 * @returns The kind, or `undefined`.
 */
export function kindOf(world: World, type: TypeRef): Kind | undefined {
  const found = lookupKind(world, type);
  return found.ok ? found.kind : undefined;
}

/**
 * This function finds a kind by a text type. It is the same as `kindOf` for a one-key reference.
 *
 * @param world - The world.
 * @param name - The text of the type.
 * @returns The kind, or `undefined`.
 */
export function kindNamed(world: World, name: TypeRef): Kind | undefined {
  return kindOf(world, name);
}

/**
 * This function asks a document a question, and gives the evaluator that answers it.
 *
 * The question visits the rungs in order: the own entry of the envelope, then its kind, then the default of the
 * world. The type comes from the envelope, or else from the type that the position declares. The type is a
 * reference into the world. The ladder does not guess a type from the shape of a value.
 *
 * @param world - The kinds and the defaults.
 * @param doc - The header of the document: an envelope, or `{}` for a bare value.
 * @param verb - The verb of the question, for example `eval` or `view`.
 * @param options - The type that the position declares.
 * @returns The answer, with the record of each rung that the question visited.
 */
export function ask(world: World, doc: Header, verb: string, options: AskOptions = {}): Answer {
  const steps: Step[] = [];

  const own = entryOf(doc.own, verb);
  if (own !== undefined) {
    steps.push({ rung: "own", outcome: "answers", evaluator: own });
    return { verb, evaluator: own, rung: "own", steps };
  }
  steps.push({ rung: "own", outcome: "no-entry" });

  const type: TypeRef | undefined = doc.type ?? options.declaredType;
  if (type === undefined) {
    steps.push({ rung: "kind", outcome: "skipped" });
  } else {
    const source: KindSource = doc.type === undefined ? "container" : "document";
    const name = typeName(type);
    const kind = kindOf(world, type);
    if (kind === undefined) {
      steps.push({ rung: "kind", outcome: "unknown-kind", kind: name, source });
      return { verb, error: "unknown-kind", steps };
    }
    const entry = entryOf(kind.verbs, verb);
    if (entry !== undefined) {
      steps.push({ rung: "kind", outcome: "answers", evaluator: entry, kind: name, source });
      return { verb, evaluator: entry, rung: "kind", steps };
    }
    steps.push({ rung: "kind", outcome: "no-entry", kind: name, source });
  }

  const fallback = entryOf(world.defaults, verb);
  if (fallback !== undefined) {
    steps.push({ rung: "default", outcome: "answers", evaluator: fallback });
    return { verb, evaluator: fallback, rung: "default", steps };
  }
  steps.push({ rung: "default", outcome: "no-entry" });
  return { verb, error: "no-answer", steps };
}
