import { type Key, isRecord } from "./doc.ts";
import { type InputWithRuntime, type Machine, type Plan, RUNTIME, evaluateWithin, makeContext, planner } from "./evaluate.ts";
import { fail } from "./errors.ts";
import { type MachinePart, type MergeConflict, type WorldPart, MergeError, mergeMachines } from "./merge.ts";

/** The code half of a language: each field of a machine part, without the world. */
export type LanguageCode = Omit<MachinePart, "world">;

/** The input of `defineLanguage`. */
export interface LanguageDefinition {
  /** The name of the language. A composition holds one language of a name. */
  readonly name: string;
  /** The version, as `MAJOR.MINOR.PATCH`. */
  readonly version: string;
  /** The world of the language, with the verbs that it owns. It is JSON. */
  readonly world?: WorldPart;
  /** The lowest compatible version of each language that this language needs, by name (LANG.REQUIRES). */
  readonly requires?: Readonly<Record<string, string>>;
  /** The evaluators, the hooks and the other code. A function reads the merge of the languages before it. */
  readonly code?: LanguageCode | ((prev: Machine) => LanguageCode);
}

/** One language as one frozen value, for `compose`. */
export interface Language {
  readonly name: string;
  readonly version: string;
  readonly world: WorldPart;
  readonly requires: Readonly<Record<string, string>>;
  readonly code?: LanguageCode | ((prev: Machine) => LanguageCode);
  /**
   * The canonical JSON of the data half: `requires` and `world`, with the keys in order. Two equal data halves give
   * one text, in each order of their keys (LANG.IDENTITY). The name, the version and this text identify a language.
   */
  readonly data: string;
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function numbers(version: string): readonly [number, number, number] {
  const found = VERSION.exec(version);
  if (found === null) throw new TypeError(`A language version has the form MAJOR.MINOR.PATCH. The text ${JSON.stringify(version)} does not.`);
  return [Number(found[1]), Number(found[2]), Number(found[3])];
}

/**
 * This function tells if a version satisfies a lowest version, by the rules of a caret range of SemVer. The first
 * number that is not zero stays the same, and the version is not lower.
 */
function compatible(version: string, lowest: string): boolean {
  const have = numbers(version);
  const want = numbers(lowest);
  const stable = want.findIndex((part) => part !== 0);
  const fixed = stable < 0 ? 3 : stable + 1;
  for (let index = 0; index < 3; index += 1) {
    const [a, b] = [have[index] as number, want[index] as number];
    if (a !== b) return index >= fixed && a > b;
  }
  return true;
}

/** This function gives the JSON text of a value with its keys in order. A value that is not JSON is an error. */
function canonical(value: unknown, path: readonly Key[]): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item, index) => canonical(item, [...path, index])).join(",")}]`;
  if (!isRecord(value)) throw new TypeError(`The data half of a language is JSON. The value at ${JSON.stringify(path)} is not.`);
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key], [...path, key])}`).join(",")}}`;
}

function frozen<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const item of Object.values(value)) frozen(item);
  return Object.freeze(value);
}

/**
 * This function makes one value of a language. The data half is JSON, thus a host can store it and compare it. The
 * code half binds the evaluator names of the world.
 *
 * The language keeps a frozen copy of its data half, thus a later change to the input changes nothing.
 *
 * @param definition - The name, the version, the world, the needed languages and the code.
 * @returns The language.
 * @throws {TypeError} A version in the definition is not `MAJOR.MINOR.PATCH`, the name is empty, or the
 *   data half is not JSON.
 */
export function defineLanguage(definition: LanguageDefinition): Language {
  if (definition.name === "") throw new TypeError("A language has a name.");
  numbers(definition.version);
  const requires = definition.requires ?? {};
  for (const name of Object.keys(requires)) numbers(requires[name] as string);
  const data = canonical({ requires, world: definition.world ?? {} }, []);
  const copy = frozen(JSON.parse(data) as { readonly requires: Readonly<Record<string, string>>; readonly world: WorldPart });
  const language = { name: definition.name, version: definition.version, world: copy.world, requires: copy.requires, data };
  return Object.freeze(definition.code === undefined ? language : { ...language, code: definition.code });
}

function partOf(language: Language): MachinePart | ((prev: Machine) => MachinePart) {
  const { code, world } = language;
  return typeof code === "function" ? (prev) => ({ ...code(prev), world }) : { ...code, world };
}

/**
 * This function merges languages into one machine, in the order of the arguments, with `mergeMachines`.
 *
 * - A language comes after each language that it names in `requires`, at a compatible version (LANG.REQUIRES).
 * - One language that comes twice counts once. Thus two languages can share a base.
 * - Two versions of one name, or two data halves under one name and one version, are conflicts (LANG.COMPOSE).
 *
 * @param languages - The languages.
 * @returns The machine.
 * @throws {MergeError} The languages do not fit, or their merge has a conflict. The error lists each conflict.
 */
export function compose(...languages: readonly Language[]): Machine {
  const conflicts: MergeConflict[] = [];
  const parts: (MachinePart | ((prev: Machine) => MachinePart))[] = [];
  const seen = new Map<string, { readonly language: Language; readonly index: number }>();
  languages.forEach((language, index) => {
    const earlier = seen.get(language.name);
    const conflict = (name: string, other: number, reason: string): void => {
      conflicts.push({ path: ["languages", name], parts: [Math.min(other, index), Math.max(other, index)], reason });
    };
    if (earlier !== undefined) {
      if (earlier.language.version !== language.version) conflict(language.name, earlier.index, "Two versions of one language.");
      else if (earlier.language.data !== language.data) conflict(language.name, earlier.index, "Two languages with one name and one version differ.");
      else if (earlier.language.code !== language.code) parts.push(partOf(language));
      return;
    }
    for (const name of Object.keys(language.requires)) {
      const needed = language.requires[name] as string;
      const found = seen.get(name);
      if (found === undefined) {
        const later = languages.findIndex((other) => other.name === name);
        if (later < 0) conflict(name, index, `A language requires ${name}, and the composition does not have it.`);
        else conflict(name, later, `A language requires ${name}, and ${name} comes after it.`);
      } else if (!compatible(found.language.version, needed)) {
        conflict(name, found.index, `A language requires ${name} ${needed}, and the composition has ${found.language.version}.`);
      }
    }
    seen.set(language.name, { language, index });
    parts.push(partOf(language));
  });
  if (conflicts.length > 0) throw new MergeError(conflicts);
  return mergeMachines(...parts);
}

/**
 * This function makes the language of the boundary kind `lang` (K38, D193). A document of the kind holds the name of a
 * language and a document in that language: `{ type: "lang", value: { language, doc } }`. The machine of the named
 * language prepares and evaluates the inner document, as a module of another language (COMPOSE.BOUNDARY).
 *
 * The boundary is closed. The inner document gets no names, no capabilities and no node as `self`. Only its result
 * crosses the boundary. Thus an effect in the inner document fails with `#CAP!`, and the inner machine cannot read the
 * names of the outer document.
 *
 * @param machines - The machine of each language, by the name that a document gives.
 * @returns The language, for `compose`.
 */
export function boundary(machines: Readonly<Record<string, Machine>>): Language {
  const plans = new Map<string, (doc: unknown) => Plan>();
  const planOf = (name: string): ((doc: unknown) => Plan) | undefined => {
    let found = plans.get(name);
    if (found === undefined && Object.hasOwn(machines, name)) {
      found = planner(machines[name] as Machine);
      plans.set(name, found);
    }
    return found;
  };
  return defineLanguage({
    name: "boundary",
    version: "1.0.0",
    world: {
      kinds: {
        lang: {
          verbs: { eval: "boundary.lang" },
          summary: "A document in another language. The machine of that language evaluates it, with no names and no capabilities.",
        },
      },
    },
    code: {
      evaluators: {
        "boundary.lang": (input) => {
          const { data, place } = input;
          if (!isRecord(data) || typeof data["language"] !== "string" || !("doc" in data)) {
            return fail("#VALUE!", "A document of the kind lang has the value { language, doc }.", { place });
          }
          const plans = planOf(data["language"]);
          if (plans === undefined) return fail("#NAME?", `The boundary knows no language ${JSON.stringify(data["language"])}.`, { place });
          return evaluateWithin(plans(data["doc"]), makeContext(), (input as InputWithRuntime)[RUNTIME]);
        },
      },
    },
  });
}
