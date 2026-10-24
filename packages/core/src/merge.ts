import { type Key, docEquals, isRecord } from "./doc.ts";
import type { DerefCode, Walker } from "./deref.ts";
import type { Evaluator, Machine, Runner } from "./evaluate.ts";
import { type Kind, type World, type WorldEntry, isAlias, isKind, isNamespace } from "./world.ts";

/** The keys from a part of a merge to one of its entries, for example `["kinds", "ref"]`. */
export type MergePath = readonly Key[];

/**
 * A world as a part of a merge. Each field is optional. `replaces` names the paths of the entries that this part
 * replaces, for example `["kinds", "ref"]` or `["defaults", "view"]`. The result of a merge has no `replaces`.
 */
export interface WorldPart {
  readonly kinds?: Readonly<Record<string, WorldEntry>>;
  readonly defaults?: Readonly<Record<string, string>>;
  readonly fallback?: Kind;
  readonly replaces?: readonly MergePath[];
}

/**
 * A machine as a part of a merge. Each field is optional. `replaces` names paths in the machine, for example
 * `["evaluators", "formula.op"]` or `["world", "kinds", "ref"]`. The paths in `world.replaces` start at the world.
 */
export interface MachinePart extends Omit<Partial<Machine>, "world"> {
  readonly world?: WorldPart;
  readonly replaces?: readonly MergePath[];
}

/**
 * One conflict of a merge. `path` is the path of the entry, as `replaces` names it. Thus the same path in the
 * `replaces` of the later part resolves the conflict. `parts` gives the indices of the two parts, the earlier first.
 */
export interface MergeConflict {
  readonly path: MergePath;
  readonly parts: readonly [number, number];
  readonly reason: string;
}

/** The exception of a merge with conflicts. It lists each conflict of the merge, not only the first. */
export class MergeError extends Error {
  readonly conflicts: readonly MergeConflict[];

  /**
   * This constructor makes the exception.
   *
   * @param conflicts - The conflicts, in the order that the merge found them.
   */
  constructor(conflicts: readonly MergeConflict[]) {
    const lines = conflicts.map((item) => `At ${JSON.stringify(item.path)}, the parts ${item.parts[0]} and ${item.parts[1]}: ${item.reason}`);
    super(`The merge has ${conflicts.length === 1 ? "1 conflict" : `${conflicts.length} conflicts`}. ${lines.join(" ")}`);
    this.name = "MergeError";
    this.conflicts = conflicts;
  }
}

type Known = NonNullable<Machine["known"]>;

const NONE: ReadonlySet<string> = /* @__PURE__ */ new Set();

function keyOf(path: MergePath): string {
  return JSON.stringify(path.map(String));
}

/** This function sets an own data property. An assignment to the key `__proto__` changes the prototype. */
function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  if (key === "__proto__") Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

function own<T>(table: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return table !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

/** This function gives a copy of a JSON value without the fields whose value is `undefined`, as JSON writes it. */
function defined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(defined);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) if (value[key] !== undefined) setOwn(out, key, defined(value[key]));
  return out;
}

/** Two values are the same when they are equal by `docEquals`. A function and a host value are equal only to themselves. */
function same(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || docEquals(defined(a), defined(b));
}

/** Two lists of roots are the same when they hold the same roots, in any order. */
function sameRoots(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return same(a, b);
  return same([...new Set(a.map(String))].sort(), [...new Set(b.map(String))].sort());
}

/** The record of a merge: the conflicts, and the part that gave each entry. */
class Merger {
  readonly conflicts: MergeConflict[] = [];
  private readonly sources = new Map<string, number>();

  /** This method gives the part that gave the entry at a path, or the entry nearest above it. */
  sourceOf(path: MergePath): number {
    for (let length = path.length; length >= 0; length -= 1) {
      const found = this.sources.get(keyOf(path.slice(0, length)));
      if (found !== undefined) return found;
    }
    return 0;
  }

  /** This method records the part that gives a new entry. */
  give(path: MergePath, part: number): void {
    this.sources.set(keyOf(path), part);
  }

  /** This method records the part that replaces an entry, and forgets the parts of each entry below it. */
  replace(path: MergePath, part: number): void {
    const below = `${keyOf(path).slice(0, -1)},`;
    for (const key of [...this.sources.keys()]) if (key.startsWith(below)) this.sources.delete(key);
    this.give(path, part);
  }

  clash(path: MergePath, part: number, reason: string): void {
    this.conflicts.push({ path, parts: [this.sourceOf(path), part], reason });
  }
}

/**
 * This function merges one entry of a table into the table. A new entry joins the table. A path in `replaces` gives
 * the later entry. Two entries that are the same give one entry. Each other pair is a conflict.
 */
function mergeLeaf<T>(
  m: Merger,
  table: Record<string, T>,
  key: string,
  later: T | undefined,
  path: MergePath,
  part: number,
  replaces: ReadonlySet<string>,
  equal: (a: T, b: T) => boolean,
  reason: string,
): void {
  if (later === undefined) return;
  const earlier = own(table, key);
  if (earlier === undefined) {
    setOwn(table, key, later);
    m.give(path, part);
  } else if (replaces.has(keyOf(path))) {
    setOwn(table, key, later);
    m.replace(path, part);
  } else if (!equal(earlier, later)) {
    m.clash(path, part, reason);
  }
}

function what(entry: WorldEntry): string {
  if (isKind(entry)) return "a kind";
  if (isAlias(entry)) return "an alias";
  return isNamespace(entry) ? "a namespace" : "an entry";
}

function mergeFallback(m: Merger, earlier: Kind | undefined, later: Kind | undefined, path: MergePath, part: number, replaces: ReadonlySet<string>): Kind | undefined {
  const table: Record<string, Kind> = earlier === undefined ? {} : { fallback: earlier };
  mergeLeaf(m, table, "fallback", later, path, part, replaces, same, "Two parts give two different fallback kinds.");
  return table["fallback"];
}

function mergeEntries(m: Merger, into: Record<string, WorldEntry>, from: Readonly<Record<string, WorldEntry>>, path: MergePath, part: number, replaces: ReadonlySet<string>): void {
  for (const key of Object.keys(from)) {
    const later = from[key];
    if (later === undefined) continue;
    const at = [...path, key];
    const earlier = own(into, key);
    if (earlier === undefined) {
      setOwn(into, key, later);
      m.give(at, part);
    } else {
      setOwn(into, key, mergeEntry(m, earlier, later, at, part, replaces));
    }
  }
}

/** This function merges two entries at one path. Two namespaces merge key by key, and their fallbacks merge too. */
function mergeEntry(m: Merger, earlier: WorldEntry, later: WorldEntry, path: MergePath, part: number, replaces: ReadonlySet<string>): WorldEntry {
  if (replaces.has(keyOf(path))) {
    m.replace(path, part);
    return later;
  }
  if (same(earlier, later)) return earlier;
  if (isNamespace(earlier) && isNamespace(later)) {
    const kinds: Record<string, WorldEntry> = { ...earlier.kinds };
    mergeEntries(m, kinds, later.kinds, [...path, "kinds"], part, replaces);
    const fallback = mergeFallback(m, earlier.fallback, later.fallback, [...path, "fallback"], part, replaces);
    return fallback === undefined ? { kinds } : { kinds, fallback };
  }
  const a = what(earlier);
  const b = what(later);
  m.clash(path, part, a === b ? `Two parts give two different ${a === "an alias" ? "aliases" : "kinds"}.` : `One part gives ${a}, and the other part gives ${b}.`);
  return earlier;
}

interface WorldDraft {
  readonly kinds: Record<string, WorldEntry>;
  readonly defaults: Record<string, string>;
  fallback?: Kind;
}

function worldOf(draft: WorldDraft): World {
  const world = { kinds: { ...draft.kinds }, defaults: { ...draft.defaults } };
  return draft.fallback === undefined ? world : { ...world, fallback: draft.fallback };
}

function mergeWorldInto(m: Merger, draft: WorldDraft, part: WorldPart | undefined, index: number, replaces: ReadonlySet<string>, base: MergePath): void {
  if (part === undefined) return;
  if (part.kinds !== undefined) mergeEntries(m, draft.kinds, part.kinds, [...base, "kinds"], index, replaces);
  const defaults = part.defaults ?? {};
  for (const verb of Object.keys(defaults)) {
    mergeLeaf(m, draft.defaults, verb, defaults[verb], [...base, "defaults", verb], index, replaces, Object.is, "Two parts give two different defaults for this verb.");
  }
  const fallback = mergeFallback(m, draft.fallback, part.fallback, [...base, "fallback"], index, replaces);
  if (fallback !== undefined) draft.fallback = fallback;
}

/**
 * This function merges worlds into one world, in the order of the parts. It does not change a part.
 *
 * - Two entries that are equal by `docEquals` give one entry.
 * - Two namespaces merge key by key, at each depth. Their fallbacks merge as each other entry.
 * - The defaults merge verb by verb, and the world keeps one fallback.
 * - Each other pair of entries at one path is a conflict, unless the later part names the path in `replaces`.
 *   Then the later entry wins, with no merge below it.
 *
 * A part can be a function of the merge of the parts before it (`prev`, as an overlay of Nix). Thus a part can read
 * the entry that it replaces.
 *
 * @param parts - The worlds, or functions that give a world from the merge before them.
 * @returns The world. It has no `replaces`.
 * @throws {MergeError} The merge has a conflict. The error lists each conflict.
 */
export function mergeWorlds(...parts: readonly (WorldPart | ((prev: World) => WorldPart))[]): World {
  const m = new Merger();
  const draft: WorldDraft = { kinds: {}, defaults: {} };
  parts.forEach((input, index) => {
    const part = typeof input === "function" ? input(worldOf(draft)) : input;
    mergeWorldInto(m, draft, part, index, new Set((part.replaces ?? []).map(keyOf)), []);
  });
  if (m.conflicts.length > 0) throw new MergeError(m.conflicts);
  return worldOf(draft);
}

/** The fields of a machine that merge by their own rules. Each other field is one value, or a conflict. */
const TABLES = /* @__PURE__ */ new Set(["world", "evaluators", "runners", "derefs", "walkers", "known", "replaces"]);

interface MachineDraft {
  readonly world: WorldDraft;
  readonly evaluators: Record<string, Evaluator>;
  runners?: Record<string, Runner>;
  derefs?: Record<string, DerefCode>;
  walkers?: Record<string, Walker>;
  readonly hooks: { readonly part: number; readonly known: Known }[];
  /** The last part that replaced the code of each evaluator name. */
  readonly replaced: Map<string, number>;
  readonly rest: Record<string, unknown>;
  readonly parts: MachinePart[];
}

/**
 * This function composes the hooks `known` in the order of their parts. The first answer that is not `true` wins. A
 * hook does not answer for an evaluator name whose code a later part replaces.
 */
function composeKnown(hooks: readonly { readonly part: number; readonly known: Known }[], replaced: ReadonlyMap<string, number>): Known | undefined {
  const first = hooks[0];
  if (first === undefined) return undefined;
  if (hooks.length === 1 && replaced.size === 0) return first.known;
  const list = [...hooks];
  const last = new Map(replaced);
  return (path, evaluator) => {
    const after = last.get(evaluator);
    for (const hook of list) {
      if (after !== undefined && hook.part < after) continue;
      const answer = hook.known(path, evaluator);
      if (answer !== true) return answer;
    }
    return true;
  };
}

function machineOf(draft: MachineDraft): Machine {
  const known = composeKnown(draft.hooks, draft.replaced);
  return {
    ...draft.rest,
    world: worldOf(draft.world),
    evaluators: { ...draft.evaluators },
    ...(draft.runners === undefined ? {} : { runners: { ...draft.runners } }),
    ...(draft.derefs === undefined ? {} : { derefs: { ...draft.derefs } }),
    ...(draft.walkers === undefined ? {} : { walkers: { ...draft.walkers } }),
    ...(known === undefined ? {} : { known }),
  };
}

/** This function merges the evaluators and the runners of a part. The evaluator and the runner of a name are its code. */
function mergeCode(m: Merger, draft: MachineDraft, part: MachinePart, index: number, replaces: ReadonlySet<string>): void {
  if (part.runners !== undefined) draft.runners ??= {};
  const names = new Set([...Object.keys(part.evaluators ?? {}), ...Object.keys(part.runners ?? {})]);
  for (const name of names) {
    const evaluator = own(part.evaluators, name);
    const runner = own(part.runners, name);
    if (evaluator === undefined && runner === undefined) continue;
    const evaluatorPath = ["evaluators", name];
    const runnerPath = ["runners", name];
    if (replaces.has(keyOf(evaluatorPath)) || replaces.has(keyOf(runnerPath))) {
      // The part replaces the code of the name: the evaluator and the runner of the earlier parts go.
      if (evaluator === undefined) delete draft.evaluators[name];
      else setOwn(draft.evaluators, name, evaluator);
      if (runner !== undefined) setOwn((draft.runners ??= {}), name, runner);
      else if (draft.runners !== undefined) delete draft.runners[name];
      m.replace(evaluatorPath, index);
      m.replace(runnerPath, index);
      draft.replaced.set(name, index);
      continue;
    }
    mergeLeaf(m, draft.evaluators, name, evaluator, evaluatorPath, index, NONE, Object.is, "Two parts give two different evaluators for this name.");
    if (runner !== undefined) mergeLeaf(m, (draft.runners ??= {}), name, runner, runnerPath, index, NONE, Object.is, "Two parts give two different runners for this name.");
  }
}

/** A runner hides the evaluator of its name. Thus a name with a runner and an evaluator needs one part that gives both. */
function checkHidden(m: Merger, draft: MachineDraft): void {
  const runners = draft.runners ?? {};
  for (const name of Object.keys(runners)) {
    const runner = runners[name];
    const evaluator = own(draft.evaluators, name);
    if (runner === undefined || evaluator === undefined) continue;
    if (draft.parts.some((part) => own(part.evaluators, name) === evaluator && own(part.runners, name) === runner)) continue;
    const a = m.sourceOf(["evaluators", name]);
    const b = m.sourceOf(["runners", name]);
    m.conflicts.push({
      path: ["runners", name],
      parts: [Math.min(a, b), Math.max(a, b)],
      reason: "The runner of one part hides the evaluator of the other part, because a runner wins over an evaluator of its name.",
    });
  }
}

/**
 * This function merges machines into one machine, in the order of the parts. It does not change a part.
 *
 * - The worlds merge with the rules of `mergeWorlds`. The paths of their conflicts start with `"world"`.
 * - The tables `evaluators`, `runners`, `derefs` and `walkers` merge name by name. A function is equal only to itself.
 * - The evaluator and the runner of a name are its code. A replacement of the name replaces both.
 * - A runner hides the evaluator of its name. Thus one part must give both, or the merge gives a conflict.
 * - The hooks `known` compose in the order of the parts. A hook does not answer for a name that a later part replaces.
 * - Each other field, for example `permits`, `adopt`, `roots`, `plain` or `maxDepth`, is one value. Two different
 *   values are a conflict. An absent field has no value.
 *
 * A conflict stops the merge, unless the later part names its path in `replaces`. A part can be a function of the
 * merge of the parts before it (`prev`, as an overlay of Nix). Thus a part can wrap the code that it replaces.
 *
 * @param parts - The machines, or functions that give a machine from the merge before them.
 * @returns The machine.
 * @throws {MergeError} The merge has a conflict. The error lists each conflict.
 */
export function mergeMachines(...parts: readonly (MachinePart | ((prev: Machine) => MachinePart))[]): Machine {
  const m = new Merger();
  const draft: MachineDraft = { world: { kinds: {}, defaults: {} }, evaluators: {}, hooks: [], replaced: new Map(), rest: {}, parts: [] };
  parts.forEach((input, index) => {
    const part = typeof input === "function" ? input(machineOf(draft)) : input;
    draft.parts.push(part);
    const replaces = new Set([...(part.replaces ?? []), ...(part.world?.replaces ?? []).map((path) => ["world", ...path])].map(keyOf));
    mergeWorldInto(m, draft.world, part.world, index, replaces, ["world"]);
    mergeCode(m, draft, part, index, replaces);
    if (part.derefs !== undefined) {
      const derefs = (draft.derefs ??= {});
      for (const name of Object.keys(part.derefs)) mergeLeaf(m, derefs, name, part.derefs[name], ["derefs", name], index, replaces, Object.is, "Two parts give two different deref codes for this name.");
    }
    if (part.walkers !== undefined) {
      const walkers = (draft.walkers ??= {});
      for (const name of Object.keys(part.walkers)) mergeLeaf(m, walkers, name, part.walkers[name], ["walkers", name], index, replaces, Object.is, "Two parts give two different walkers for this name.");
    }
    if (part.known !== undefined && !draft.hooks.some((hook) => hook.known === part.known)) draft.hooks.push({ part: index, known: part.known });
    const fields = part as Readonly<Record<string, unknown>>;
    for (const key of Object.keys(fields)) {
      if (TABLES.has(key)) continue;
      mergeLeaf(m, draft.rest, key, fields[key], [key], index, replaces, key === "roots" ? sameRoots : same, `Two parts give two different values for ${key}.`);
    }
  });
  checkHidden(m, draft);
  if (m.conflicts.length > 0) throw new MergeError(m.conflicts);
  return machineOf(draft);
}

/** This function removes the entry at a path from a table of entries. It gives the same table when no entry is there. */
function removeEntry(entries: Readonly<Record<string, WorldEntry>>, path: readonly Key[]): Readonly<Record<string, WorldEntry>> {
  const [first, ...rest] = path;
  if (first === undefined) return entries;
  const key = String(first);
  const entry = own(entries, key);
  if (entry === undefined) return entries;
  let next: WorldEntry | undefined;
  if (rest.length > 0) {
    if (!isNamespace(entry)) return entries;
    if (rest.length === 1 && String(rest[0]) === "fallback") {
      if (entry.fallback === undefined) return entries;
      next = { kinds: entry.kinds };
    } else {
      if (String(rest[0]) !== "kinds") return entries;
      const kinds = removeEntry(entry.kinds, rest.slice(1));
      if (kinds === entry.kinds) return entries;
      next = entry.fallback === undefined ? { kinds } : { kinds, fallback: entry.fallback };
    }
  }
  const out: Record<string, WorldEntry> = { ...entries };
  if (next === undefined) delete out[key];
  else setOwn(out, key, next);
  return out;
}

/**
 * This function removes entries from a world, for a language that restricts another language. A path names an entry
 * as `replaces` names it, for example `["kinds", "fn"]`, `["kinds", "ops", "kinds", "mul"]`,
 * `["kinds", "ops", "fallback"]`, `["defaults", "view"]` or `["fallback"]`. A path that names no entry changes
 * nothing. The function does not change the world.
 *
 * A removed kind gives `#KIND?`, also through an alias to it. A namespace without its fallback knows only its own keys.
 * A world without its fallback is closed.
 *
 * @param world - The world.
 * @param paths - The paths of the entries to remove.
 * @returns The world without the entries.
 */
export function restrictWorld(world: World, paths: readonly MergePath[]): World {
  let kinds = world.kinds;
  const defaults: Record<string, string> = { ...world.defaults };
  let fallback = world.fallback;
  for (const path of paths) {
    const [first, ...rest] = path.map(String);
    if (first === "kinds") kinds = removeEntry(kinds, rest);
    else if (first === "defaults" && rest.length === 1) delete defaults[rest[0] as string];
    else if (first === "fallback" && rest.length === 0) fallback = undefined;
  }
  const out = { kinds: { ...kinds }, defaults };
  return fallback === undefined ? out : { ...out, fallback };
}

/** The tables of the code of a machine, as the paths of a restriction name them. */
const CODE_TABLES = ["evaluators", "runners", "derefs", "walkers"] as const;

/**
 * This function removes entries from a machine, for a language that restricts another language. A path names an
 * entry as `replaces` names it:
 *
 * - A path that starts with `"world"` removes an entry of the world, with the rules of `restrictWorld`.
 * - `["evaluators", name]` or `["runners", name]` removes the code of the name: its evaluator and its runner.
 * - `["derefs", name]` and `["walkers", name]` remove one entry of their tables.
 *
 * A path that names no entry changes nothing. The function does not change the machine. An own entry names an
 * evaluator directly, thus only a machine without the code of a name refuses each document that names it.
 *
 * @param machine - The machine.
 * @param paths - The paths of the entries to remove.
 * @returns The machine without the entries.
 */
export function restrictMachine(machine: Machine, paths: readonly MergePath[]): Machine {
  const world = paths.filter((path) => String(path[0]) === "world").map((path) => path.slice(1));
  const tables: Record<(typeof CODE_TABLES)[number], Record<string, unknown> | undefined> = {
    evaluators: { ...machine.evaluators },
    runners: machine.runners === undefined ? undefined : { ...machine.runners },
    derefs: machine.derefs === undefined ? undefined : { ...machine.derefs },
    walkers: machine.walkers === undefined ? undefined : { ...machine.walkers },
  };
  for (const path of paths) {
    const [table, name, ...rest] = path.map(String);
    if (name === undefined || rest.length > 0 || !(CODE_TABLES as readonly (string | undefined)[]).includes(table)) continue;
    // The evaluator and the runner of a name are its code, as for a replacement (MACHINE.RUNNER).
    const from = table === "evaluators" || table === "runners" ? ["evaluators", "runners"] : [table as string];
    for (const key of from) {
      const entries = tables[key as (typeof CODE_TABLES)[number]];
      if (entries !== undefined) delete entries[name];
    }
  }
  return {
    ...machine,
    world: world.length === 0 ? machine.world : restrictWorld(machine.world, world),
    evaluators: tables.evaluators as Machine["evaluators"],
    ...(tables.runners === undefined ? {} : { runners: tables.runners as NonNullable<Machine["runners"]> }),
    ...(tables.derefs === undefined ? {} : { derefs: tables.derefs as NonNullable<Machine["derefs"]> }),
    ...(tables.walkers === undefined ? {} : { walkers: tables.walkers as NonNullable<Machine["walkers"]> }),
  };
}
