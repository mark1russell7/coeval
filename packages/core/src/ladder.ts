/** The rungs of the ladder, in the order that a question visits them. */
export const RUNGS = ["own", "kind", "default"] as const;

/** One rung of the ladder. */
export type Rung = (typeof RUNGS)[number];

/** The two sides of evaluation. `derive` is pure. `run` causes effects in order. */
export type Side = "derive" | "run";

/**
 * Where the parts of a value are. A part is a typed document that the evaluator gets sealed.
 *
 * - `none`: the value is data. It has no parts.
 * - `list`: the value is a list, and each item is a part.
 * - `record`: the value is a record. The named fields are parts, and the other fields are data.
 *
 * `of` is the type of a bare item. An item without an envelope gets this type from its container.
 */
export type PartsSpec =
  | { readonly shape: "none" }
  | { readonly shape: "list"; readonly of?: string }
  | { readonly shape: "record"; readonly fields: readonly string[]; readonly of?: string };

/** A kind gives the name of an evaluator for each verb, and the contract of its value. */
export interface Kind {
  readonly verbs: Readonly<Record<string, string>>;
  /** Where the parts of the value are. The default is `none`. */
  readonly parts?: PartsSpec;
  /** The side of the kind. A kind of the run side causes effects. The default is `derive`. */
  readonly side?: Side;
  /** One sentence that tells what the kind is. */
  readonly summary?: string;
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

/**
 * The header that the ladder reads: the type and the own entries. An envelope is a header. A bare value has an
 * empty header, and its position can declare its type.
 */
export interface Header {
  readonly type?: string;
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
 * This function finds a kind of a world by its name. It reads only the own entries of the world.
 *
 * @param world - The world.
 * @param name - The name of the kind.
 * @returns The kind, or `undefined`.
 */
export function kindNamed(world: World, name: string): Kind | undefined {
  return Object.hasOwn(world.kinds, name) ? world.kinds[name] : undefined;
}

/**
 * This function asks a document a question, and gives the evaluator that answers it.
 *
 * The question visits the rungs in order: the own entry of the envelope, then its kind, then the default of the
 * world. The type comes from the envelope, or else from the type that the position declares. The ladder does not
 * guess a type from the shape of a value.
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

  const name = doc.type ?? options.declaredType;
  if (name === undefined) {
    steps.push({ rung: "kind", outcome: "skipped" });
  } else {
    const source: KindSource = doc.type === undefined ? "container" : "document";
    const kind = kindNamed(world, name);
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
