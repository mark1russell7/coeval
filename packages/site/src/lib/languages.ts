import {
  MergeError,
  fail,
  formulaMachine,
  isAlias,
  isKind,
  isNamespace,
  mergeMachines,
  ok,
  prepare,
  restrictMachine,
  type EvalFn,
  type Json,
  type Key,
  type Machine,
  type MachinePart,
  type MergeConflict,
  type MergePath,
  type Part,
  type Result,
  type WorldEntry,
} from "@mark1russell7/coeval";

/*
 * The small languages of the composition page. They follow the languages of `docs/COMPOSITION.md` and of
 * `packages/core/src/compose.test.ts`: a base, two extensions that do not know each other, and a rival extension.
 */

/** The names of the code, for a reader. A minifier changes the names of functions, thus the site keeps its own names. */
const CODE_NAMES = new WeakMap<object, string>();

function code(name: string, fn: EvalFn): EvalFn {
  CODE_NAMES.set(fn, name);
  return fn;
}

/** This function gives the values of the parts in order, or the first error. */
function valuesOf(parts: readonly Part[]): unknown[] | Result {
  const values: unknown[] = [];
  for (const part of parts) {
    const result = part.evaluate();
    if (!result.ok) return result;
    values.push(result.value);
  }
  return values;
}

/** This function makes an evaluator from a function of the values of the parts. */
function ofValues(name: string, fn: (values: readonly unknown[]) => Result): EvalFn {
  return code(name, ({ parts }) => {
    const values = valuesOf(parts);
    return Array.isArray(values) ? fn(values) : (values as Result);
  });
}

const isNumber = (value: unknown): value is number => typeof value === "number";

/** The base: the formula kit of the kernel, with the operations `add` and `mul`. */
export const BASE: Machine = formulaMachine({ ops: { add: (a: number, b: number) => a + b, mul: (a: number, b: number) => a * b } });

/** The code of `show`. Two languages share this one function, thus their two entries are the same entry. */
const show = ofValues("show", ([value]) => ok(String(value)));
const SHOW_KIND: WorldEntry = { verbs: { eval: "fmt.show" }, parts: { shape: "term", of: "lit" }, summary: "Its term as a text." };

const mean = ofValues("mean", (values) =>
  values.length > 0 && values.every(isNumber) ? ok(values.reduce((a, b) => a + b, 0) / values.length) : fail("#VALUE!", "mean needs one number or more."),
);
const twice = ofValues("twice", ([value]) => (isNumber(value) ? ok(value * 2) : fail("#VALUE!", "twice needs a number.")));
const median = ofValues("median", (values) => {
  if (values.length === 0 || !values.every(isNumber)) return fail("#VALUE!", "median needs one number or more.");
  const sorted = [...values].sort((a, b) => a - b);
  return ok(sorted[Math.floor(sorted.length / 2)]);
});
const thrice = ofValues("thrice", ([value]) => (isNumber(value) ? ok(value * 3) : fail("#VALUE!", "thrice needs a number.")));
const upper = ofValues("upper", ([value]) => (typeof value === "string" ? ok(value.toUpperCase()) : fail("#VALUE!", "upper needs a text.")));
const join = ofValues("join", (values) =>
  values.every((value) => typeof value === "string" || isNumber(value)) ? ok(values.join("")) : fail("#VALUE!", "join needs texts and numbers."),
);

/** One language that a reader can add to the merge. */
export interface Language {
  readonly id: string;
  readonly label: string;
  /** One sentence that tells what the language adds. */
  readonly summary: string;
  readonly part: MachinePart;
}

/** The languages that a reader can add after the base, in the order of the merge. */
export const LANGUAGES: readonly Language[] = [
  {
    id: "stats",
    label: "Statistics",
    summary: "The kind mean, the alias avg, the operation ops.twice and the shared kind show.",
    part: {
      world: {
        kinds: {
          mean: { verbs: { eval: "stats.mean" }, parts: { shape: "list", of: "lit" }, summary: "The mean of its terms." },
          avg: { type: "ref", value: ["world", "mean"] },
          ops: { kinds: { twice: { verbs: { eval: "stats.twice" }, parts: { shape: "list", of: "lit" }, summary: "Two times its term." } } },
          show: SHOW_KIND,
        },
      },
      evaluators: { "stats.mean": mean, "stats.twice": twice, "fmt.show": show },
    },
  },
  {
    id: "text",
    label: "Text",
    summary: "The kind upper, the operation ops.join and the shared kind show. It does not know the statistics.",
    part: {
      world: {
        kinds: {
          upper: { verbs: { eval: "text.upper" }, parts: { shape: "term", of: "lit" }, summary: "Its term in upper case." },
          ops: { kinds: { join: { verbs: { eval: "text.join" }, parts: { shape: "list", of: "lit" }, summary: "Its terms as one text." } } },
          show: SHOW_KIND,
        },
      },
      evaluators: { "text.upper": upper, "text.join": join, "fmt.show": show },
    },
  },
  {
    id: "rival",
    label: "Rival statistics",
    summary: "A different mean (the median) and a different ops.twice (three times). Alone, it composes with the base.",
    part: {
      world: {
        kinds: {
          mean: { verbs: { eval: "rival.median" }, parts: { shape: "list", of: "lit" }, summary: "The median of its terms." },
          ops: { kinds: { twice: { verbs: { eval: "stats.twice" }, parts: { shape: "list", of: "lit" }, summary: "Three times its term." } } },
        },
      },
      evaluators: { "rival.median": median, "stats.twice": thrice },
    },
  },
];

/** The documents that the diagram evaluates with the machine of the merge. */
export const PROBES: readonly { readonly id: string; readonly doc: Json }[] = [
  { id: "avg", doc: { type: "avg", value: [1, 5, 6] } },
  { id: "twice", doc: { type: ["ops", "twice"], value: [2] } },
  { id: "join", doc: { type: ["ops", "join"], value: [{ type: "upper", value: "ab" }, "=", { type: "avg", value: [1, 5] }] } },
];

/** This function gives the key of a path, as the merge compares paths. */
export function pathKey(path: MergePath): string {
  return JSON.stringify(path.map(String));
}

function child(table: unknown, key: string): unknown {
  return typeof table === "object" && table !== null && Object.hasOwn(table, key) ? (table as Record<string, unknown>)[key] : undefined;
}

/**
 * This function gives the entry at a path of a part of a merge, as `replaces` names the path. It gives `undefined` when
 * the part has no entry there.
 *
 * @param part - A machine, or a part of a merge.
 * @param path - The path, for example `["world", "kinds", "ops", "kinds", "twice"]`.
 * @returns The entry, or `undefined`.
 */
export function entryAt(part: MachinePart | Machine, path: MergePath): unknown {
  let at: unknown = part;
  for (const key of path) {
    at = child(at, String(key));
    if (at === undefined) return undefined;
  }
  return at;
}

/** The text of an entry for a reader: what it is, its value, and a note that tells it apart from a similar entry. */
export interface EntryText {
  /** What the entry is, for example "kind, eval by" or "alias of". */
  readonly what: string;
  /** The value of the entry, in code font. */
  readonly text: string;
  readonly note?: string;
}

/**
 * This function gives the text of an entry for a reader.
 *
 * @param entry - An entry of a world, or the code of an evaluator.
 * @returns The text.
 */
export function entryText(entry: unknown): EntryText {
  if (typeof entry === "function") return { what: "code", text: CODE_NAMES.get(entry) ?? "of the kit" };
  const world = entry as WorldEntry;
  if (isKind(world)) return { what: "kind, eval by", text: world.verbs["eval"] ?? "none", ...(world.summary === undefined ? {} : { note: world.summary }) };
  if (isAlias(world)) return { what: "alias of", text: world.value.slice(1).map(String).join(".") };
  if (isNamespace(world)) {
    const count = Object.keys(world.kinds).length;
    return { what: "namespace", text: `${count === 1 ? "1 key" : `${count} keys`}${world.fallback === undefined ? "" : ", fallback"}` };
  }
  return { what: "entry", text: "?" };
}

/** One row of the merge diagram: a path that a language gives. A namespace row holds the rows of its keys. */
export interface MergeRow {
  readonly path: MergePath;
  readonly key: string;
  /** The keys after the group, for a reader. */
  readonly label: readonly string[];
  readonly group: "world" | "evaluators";
  readonly namespace: boolean;
  readonly depth: number;
}

function worldRows(kinds: Readonly<Record<string, WorldEntry>>, path: readonly Key[], depth: number, out: MergeRow[], seen: Set<string>): void {
  for (const name of Object.keys(kinds)) {
    const entry = kinds[name];
    const at = [...path, name];
    const key = pathKey(at);
    const namespace = isNamespace(entry);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ path: at, key, label: at.slice(2).map(String), group: "world", namespace, depth });
    }
    if (namespace && entry !== undefined) worldRows(entry.kinds, [...at, "kinds"], depth + 1, out, seen);
  }
}

/**
 * This function gives the rows of the merge diagram: each path that one of the languages gives, the world first.
 *
 * @param languages - The languages after the base, in the order of the merge.
 * @returns The rows. A namespace row comes before the rows of its keys.
 */
export function mergeRows(languages: readonly Language[]): readonly MergeRow[] {
  const world: MergeRow[] = [];
  const evaluators: MergeRow[] = [];
  const seen = new Set<string>();
  for (const language of languages) {
    worldRows(language.part.world?.kinds ?? {}, ["world", "kinds"], 0, world, seen);
    for (const name of Object.keys(language.part.evaluators ?? {})) {
      const path = ["evaluators", name];
      const key = pathKey(path);
      if (seen.has(key)) continue;
      seen.add(key);
      evaluators.push({ path, key, label: [name], group: "evaluators", namespace: false, depth: 0 });
    }
  }
  // The rows of a namespace follow it, also when a later language adds a key to it.
  const ordered: MergeRow[] = [];
  const place = (row: MergeRow): void => {
    ordered.push(row);
    if (!row.namespace) return;
    const prefix = row.key.slice(0, -1);
    for (const item of world) if (item.depth === row.depth + 1 && item.key.startsWith(prefix) && item.path.length === row.path.length + 2) place(item);
  };
  for (const row of world) if (row.depth === 0) place(row);
  return [...ordered, ...evaluators];
}

/** The outcome of a merge: the machine, or the error that lists each conflict. */
export type MergeOutcome = { readonly ok: true; readonly machine: Machine } | { readonly ok: false; readonly error: MergeError };

/**
 * This function merges the base and the languages with `mergeMachines`. The marks give the `replaces` of each language.
 *
 * @param languages - The languages after the base, in the order of the merge.
 * @param marks - The keys of the paths that each language replaces, by the ID of the language.
 * @returns The machine, or the `MergeError`.
 */
export function mergeLanguages(languages: readonly Language[], marks: Readonly<Record<string, readonly string[]>>): MergeOutcome {
  const parts = languages.map((language) => {
    const keys = marks[language.id] ?? [];
    return keys.length === 0 ? language.part : { ...language.part, replaces: keys.map((key) => JSON.parse(key) as MergePath) };
  });
  try {
    return { ok: true, machine: mergeMachines(BASE, ...parts) };
  } catch (error) {
    if (error instanceof MergeError) return { ok: false, error };
    throw error;
  }
}

/**
 * This function removes entries from the machine of a merge with `restrictMachine`.
 *
 * @param machine - The machine of the merge.
 * @param removed - The keys of the paths to remove.
 * @returns The machine without the entries.
 */
export function restrictLanguages(machine: Machine, removed: readonly string[]): Machine {
  return removed.length === 0 ? machine : restrictMachine(machine, removed.map((key) => JSON.parse(key) as MergePath));
}

/**
 * This function evaluates a document with a machine, with `prepare`.
 *
 * @param machine - The machine.
 * @param doc - The document.
 * @returns The result.
 */
export function evaluateWith(machine: Machine, doc: Json): Result {
  return prepare(machine, doc).evaluate();
}

/** This function finds the conflict at a row, when the merge has one. */
export function conflictAt(conflicts: readonly MergeConflict[], key: string): MergeConflict | undefined {
  return conflicts.find((item) => pathKey(item.path) === key);
}
