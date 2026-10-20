import { kindOf, ownEntry, type Doc } from "./doc.ts";

/** The rungs of the ladder, in the order that a question visits them. */
export const RUNGS = ["own", "kind", "default"] as const;

/** One rung of the ladder. */
export type Rung = (typeof RUNGS)[number];

/** A kind gives the name of an evaluator for each verb. */
export interface Kind {
  readonly verbs: Readonly<Record<string, string>>;
}

/** A world holds the kinds and the defaults that answer the questions. */
export interface World {
  readonly kinds: Readonly<Record<string, Kind>>;
  readonly defaults: Readonly<Record<string, string>>;
}

/** The place where the ladder found the name of the kind. */
export type KindSource = "document" | "container";

/**
 * The outcome of one rung.
 *
 * - `answers`: the rung gives an evaluator.
 * - `no-entry`: the rung has nothing for this verb, thus the question goes to the next rung.
 * - `skipped`: the rung does not apply, because neither the document nor its container names a kind.
 * - `unknown-kind`: the name of the kind is not in the world. The question stops.
 */
export type Outcome = "answers" | "no-entry" | "skipped" | "unknown-kind";

/** The record of one rung that a question visited. */
export interface Step {
  readonly rung: Rung;
  readonly outcome: Outcome;
  /** The evaluator, when the outcome is `answers`. */
  readonly evaluator?: string;
  /** The name of the kind, at the kind rung. */
  readonly kind?: string;
  /** The place of the name of the kind, at the kind rung. */
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

/** The options of a question. */
export interface AskOptions {
  /** The kind that the container of the document declares for its items. The own kind of the document wins. */
  readonly containerKind?: string;
}

function entryOf(verbs: Readonly<Record<string, string>>, verb: string): string | undefined {
  return Object.hasOwn(verbs, verb) ? verbs[verb] : undefined;
}

/**
 * This function asks a document a question, and gives the evaluator that answers it.
 *
 * The question visits the rungs in order: the own entry of the document, then its kind, then the default
 * of the world. The name of the kind comes from the document (`$kind`), or else from its container.
 * The ladder does not guess a kind from the shape of a document. A classifier can tag a document before
 * the question (refer to `classify`).
 *
 * @param world - The kinds and the defaults.
 * @param doc - The document to ask.
 * @param verb - The verb of the question, for example `eval` or `view`.
 * @param options - The kind that the container declares.
 * @returns The answer, with the record of each rung that the question visited.
 */
export function ask(world: World, doc: Doc, verb: string, options: AskOptions = {}): Answer {
  const steps: Step[] = [];

  const own = ownEntry(doc, verb);
  if (own !== undefined) {
    steps.push({ rung: "own", outcome: "answers", evaluator: own });
    return { verb, evaluator: own, rung: "own", steps };
  }
  steps.push({ rung: "own", outcome: "no-entry" });

  const named = kindOf(doc);
  const name = named ?? options.containerKind;
  if (name === undefined) {
    steps.push({ rung: "kind", outcome: "skipped" });
  } else {
    const source: KindSource = named === undefined ? "container" : "document";
    const kind = Object.hasOwn(world.kinds, name) ? world.kinds[name] : undefined;
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
