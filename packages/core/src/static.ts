import { type Envelope, type Json, type Key, isEnvelope, isKey, isRecord, typeName } from "./doc.ts";
import type { Kind, NamesSource, ScopeRule, World } from "./world.ts";
import { ask } from "./ladder.ts";
import { type PartSlot, partsOf, pathMatches } from "./parts.ts";
import { type Cap, type Context, type Root, ROOTS, context, isRef, walkerOf, worldThing } from "./deref.ts";
import type { ErrorCode } from "./errors.ts";
import { type Machine, partCaps, permits, waitedReason } from "./evaluate.ts";
import type { ValueType } from "./types.ts";
import { type RootTypes, type TypeNode, type Typed, typePass } from "./typing.ts";

/** One document that a walk visits. */
export interface DocVisit {
  /** The keys from the root document to this document, through the parts. It is the place of an error. */
  readonly place: readonly Key[];
  /** The keys from the root JSON value to this document. A change at this path changes this document. */
  readonly at: readonly Key[];
  /** The visit of the document that holds this document as a part. The root has none. */
  readonly parent?: DocVisit | undefined;
  /** The keys from the value of the parent to this document: the path of the part. The root has none. */
  readonly slot: readonly Key[];
  /** The document. A bare value has the type that its position declares. */
  readonly doc: Envelope;
  /** `true` when the type came from the position and not from an envelope. */
  readonly declared: boolean;
  /** The kind of the document, when the world has it. */
  readonly kind?: Kind | undefined;
  /** The keys of the kind after each alias. */
  readonly typePath?: readonly Key[] | undefined;
  /** The number of documents around this document. The root has 0. */
  readonly depth: number;
  /** The names that the kinds around this document bind for it. */
  readonly names: ReadonlySet<string>;
  /** The names that a sequence around this document binds only for the parts after it. */
  readonly later: ReadonlySet<string>;
  /** `true` when the position of the document declares an address: a reference there is not a read of a value. */
  readonly address?: true | undefined;
  /**
   * The capabilities of the document: the capabilities of the walk, narrowed by the capability rules of the kinds
   * around it (`Kind.caps`). A walk without capabilities gives none here.
   */
  readonly caps?: readonly Cap[] | undefined;
}

/** A position that a walk cannot read as a document. */
export interface WalkProblem {
  /** The keys from the root document to the document with the problem. */
  readonly place: readonly Key[];
  /** The keys from the root JSON value to the value with the problem. */
  readonly at: readonly Key[];
  readonly code: "#PART?" | "#VALUE!";
  readonly reason: string;
}

/** The options of a walk. */
export interface WalkOptions {
  /** The type of a bare root value. */
  readonly declaredType?: string;
  /** The names that the host binds at the root. */
  readonly names?: readonly string[];
  /** The capabilities at the root. With them, each visit gets the capabilities of its document. */
  readonly caps?: readonly Cap[];
  /**
   * This function gets each position that is not a document.
   *
   * @param problem - The position and the reason.
   */
  readonly problem?: (problem: WalkProblem) => void;
}

function valueAt(value: unknown, path: readonly Key[]): unknown {
  let here: unknown = value;
  for (const key of path) {
    if (Array.isArray(here)) here = here[Number(key)];
    else if (isRecord(here) && Object.hasOwn(here, String(key))) here = here[String(key)];
    else return undefined;
  }
  return here;
}

function headerName(item: Json): string | undefined {
  return isEnvelope(item) && typeof (item as { readonly name?: unknown }).name === "string" ? (item as { readonly name: string }).name : undefined;
}

function namesOf(source: NamesSource, value: unknown, covered: readonly PartSlot[]): readonly string[] {
  if ("fixed" in source) return source.fixed;
  if ("keysAt" in source) {
    const at = valueAt(value, source.keysAt);
    return isRecord(at) ? Object.keys(at) : [];
  }
  if ("listAt" in source) {
    const at = valueAt(value, source.listAt);
    return Array.isArray(at) ? (at as readonly unknown[]).filter((item): item is string => typeof item === "string") : [];
  }
  if ("textAt" in source) {
    const at = valueAt(value, source.textAt);
    if (typeof at === "string") return [at];
    return source.otherwise === undefined ? [] : [source.otherwise];
  }
  return covered.map((slot) => headerName(slot.item)).filter((name): name is string => name !== undefined);
}

/**
 * This function gives the names that the scope rules of a kind give each part, and the names that only later parts
 * see. `check` and `conforms` read the scope rules with it.
 *
 * @param rules - The scope rules of the kind.
 * @param value - The value of the document.
 * @param slots - The parts of the value, in order.
 * @returns The names that each part sees, and the names that only the later parts see, by the index of the part.
 */
export function scopesOf(rules: readonly ScopeRule[] | undefined, value: unknown, slots: readonly PartSlot[]): { readonly sees: readonly (readonly string[])[]; readonly later: readonly (readonly string[])[] } {
  const sees: string[][] = slots.map(() => []);
  const later: string[][] = slots.map(() => []);
  for (const rule of rules ?? []) {
    const covered = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => rule.in.some((pattern) => pathMatches(slot.path, pattern)));
    if (rule.sequential !== true) {
      const names = namesOf(rule.names, value, covered.map(({ slot }) => slot));
      for (const { index } of covered) sees[index]?.push(...names);
      continue;
    }
    if ("headers" in rule.names) {
      covered.forEach(({ index }, position) => {
        const before = covered.slice(0, position).map(({ slot }) => headerName(slot.item)).filter((name): name is string => name !== undefined);
        const after = covered.slice(position).map(({ slot }) => headerName(slot.item)).filter((name): name is string => name !== undefined);
        sees[index]?.push(...before);
        later[index]?.push(...after);
      });
      continue;
    }
    const names = namesOf(rule.names, value, covered.map(({ slot }) => slot));
    covered.forEach(({ index }, position) => {
      if (position > 0) sees[index]?.push(...names);
      else later[index]?.push(...names);
    });
  }
  return { sees, later };
}

/** The names of a walk without names. A walk does not change a set at any time: it makes a new set to add names. */
const NO_NAMES: ReadonlySet<string> = /* @__PURE__ */ new Set();

/** This function gives the options of a walk without the names of the host. */
function withoutNames(options: WalkOptions): WalkOptions {
  const { names: _host, ...rest } = options;
  return rest;
}

/** A path that shares its start with other paths: the keys of one step, and the path before them. */
interface Trail {
  readonly up: Trail | undefined;
  readonly keys: readonly Key[];
  full?: readonly Key[];
}

/** This function gives the keys of a trail, from its start. It keeps the result in the trail. */
function keysOf(trail: Trail | undefined): readonly Key[] {
  if (trail === undefined) return [];
  if (trail.full !== undefined) return trail.full;
  const steps: Trail[] = [];
  let here: Trail | undefined = trail;
  while (here !== undefined && here.full === undefined) {
    steps.push(here);
    here = here.up;
  }
  const keys: Key[] = here?.full === undefined ? [] : [...here.full];
  for (let index = steps.length - 1; index >= 0; index -= 1) for (const key of (steps[index] as Trail).keys) keys.push(key);
  trail.full = keys;
  return keys;
}

/** A visit with its paths as trails. It makes the keys of a path only when a reader asks for them. */
class Visit implements DocVisit {
  readonly #place: Trail | undefined;
  readonly #at: Trail | undefined;
  readonly #bound: readonly string[];
  readonly #expect: ValueType | undefined;

  constructor(
    place: Trail | undefined,
    at: Trail | undefined,
    readonly doc: Envelope,
    readonly declared: boolean,
    readonly depth: number,
    readonly names: ReadonlySet<string>,
    readonly later: ReadonlySet<string>,
    readonly slot: readonly Key[],
    readonly parent: DocVisit | undefined,
    readonly kind: Kind | undefined,
    readonly typePath: readonly Key[] | undefined,
    readonly address: true | undefined,
    readonly caps: readonly Cap[] | undefined,
    bound: readonly string[],
    expect: ValueType | undefined,
  ) {
    this.#place = place;
    this.#at = at;
    this.#bound = bound;
    this.#expect = expect;
  }

  /** The names that the scope rules of the parent bind for this document. The check of types reads them. */
  get bound(): readonly string[] {
    return this.#bound;
  }

  /** The type that the shape of the parent declares for this part. The check of types reads it. */
  get expect(): ValueType | undefined {
    return this.#expect;
  }

  get place(): readonly Key[] {
    return keysOf(this.#place);
  }

  get at(): readonly Key[] {
    return keysOf(this.#at);
  }
}

/**
 * This function visits each document of a document: the root and each part at each depth, by the contracts of the
 * kinds. A part of a kind that the world does not have is not visited. With capabilities in the options, the walk
 * narrows them for each part by the rules of its kind, as a run does. The walk uses no stack of the host for the
 * depth, thus a deep document cannot overflow it. The time and the memory of a walk are linear in the size of the
 * document. A visit makes the keys of its place and of its path only when a reader asks for them.
 *
 * @param world - The world of the kinds.
 * @param doc - The document, as JSON.
 * @param visit - The function that gets each document. It gives `"skip"` to not visit the parts of a document.
 * @param options - The type of a bare root value, the names, the capabilities and a function for the problems.
 */
export function walk(world: World, doc: unknown, visit: (visit: DocVisit) => void | "skip", options: WalkOptions = {}): void {
  interface Item {
    readonly value: unknown;
    readonly place: Trail | undefined;
    readonly at: Trail | undefined;
    readonly declared: string | undefined;
    readonly depth: number;
    readonly names: ReadonlySet<string>;
    readonly later: ReadonlySet<string>;
    readonly address: boolean;
    readonly slot: readonly Key[];
    readonly parent: DocVisit | undefined;
    readonly caps: readonly Cap[] | undefined;
    readonly bound: readonly string[];
    readonly expect: ValueType | undefined;
  }
  const stack: Item[] = [
    {
      value: doc,
      place: undefined,
      at: undefined,
      declared: options.declaredType,
      depth: 0,
      names: options.names === undefined || options.names.length === 0 ? NO_NAMES : new Set(options.names),
      later: NO_NAMES,
      address: false,
      slot: [],
      parent: undefined,
      caps: options.caps,
      bound: [],
      expect: undefined,
    },
  ];
  while (stack.length > 0) {
    const item = stack.pop() as Item;
    const read = partsOf(world, item.value, item.declared);
    if (!read.ok) {
      options.problem?.({ place: keysOf(item.place), at: keysOf(item.at), code: read.code, reason: read.reason });
      continue;
    }
    const { doc, kind, split } = read;
    const here = new Visit(
      item.place,
      item.at,
      doc,
      read.declared,
      item.depth,
      item.names,
      item.later,
      item.slot,
      item.parent,
      kind,
      read.typePath,
      item.address ? true : undefined,
      item.caps,
      item.bound,
      item.expect,
    );
    const answer = visit(here);
    if (answer === "skip" || kind === undefined) continue;
    const base: Trail | undefined = read.declared ? item.at : { up: item.at, keys: ["value"] };
    if (!split.ok) {
      options.problem?.({ place: keysOf(item.place), at: keysOf({ up: base, keys: split.at }), code: "#VALUE!", reason: split.reason });
      continue;
    }
    const { sees, later } = scopesOf(kind.scope, doc.value, split.parts);
    for (let index = split.parts.length - 1; index >= 0; index -= 1) {
      const slot = split.parts[index] as PartSlot;
      const extra = sees[index] ?? [];
      const hidden = later[index] ?? [];
      stack.push({
        value: slot.item,
        place: slot.path.length === 0 ? item.place : { up: item.place, keys: slot.path },
        at: slot.path.length === 0 ? base : { up: base, keys: slot.path },
        declared: slot.of,
        depth: item.depth + 1,
        names: extra.length === 0 ? item.names : new Set([...item.names, ...extra]),
        later: hidden.length === 0 ? item.later : new Set([...item.later, ...hidden]),
        address: slot.address === true,
        slot: slot.path,
        parent: here,
        caps: item.caps === undefined || kind.caps === undefined ? item.caps : partCaps(kind.caps, slot.path, item.caps),
        bound: extra,
        expect: slot.expect,
      });
    }
  }
}

/** One reference of a document. */
export interface RefUse {
  /** The visit of the reference document: its parent, its depth and the names that it sees. */
  readonly visit: DocVisit;
  /** The place of the reference document, through the parts. */
  readonly place: readonly Key[];
  /** The keys from the root JSON value to the reference document. */
  readonly at: readonly Key[];
  /** The path of the reference: its root and its steps. */
  readonly path: readonly Json[];
  readonly root: string;
  /** `false` when a kind around the reference binds its first name. A reference to another root is free. */
  readonly free: boolean;
  /** `true` when the reference is an address: its position declares it. An address does not read a value. */
  readonly address: boolean;
}

/**
 * This function finds each reference of a document: each document of the type `ref` that a walk reaches. A
 * reference to a name that a kind around it binds is not free. The others are what the document reads from
 * outside: its dependencies. When the kind `ref` has parts, the walk also finds the references in its step documents.
 *
 * @param world - The world of the kinds.
 * @param doc - The document, as JSON.
 * @param options - The type of a bare root value. The names of the host do not change the result.
 * @returns The references, in the order of the document.
 */
export function refsOf(world: World, doc: unknown, options: WalkOptions = {}): readonly RefUse[] {
  const out: RefUse[] = [];
  // The walk gets no names of the host: a name that the host binds is a dependency, thus its reference is free.
  const rest: WalkOptions = options.names === undefined ? options : withoutNames(options);
  walk(
    world,
    doc,
    (v) => {
      if (!isRef(v.doc)) return undefined;
      const path = v.doc.value as readonly Json[];
      const root = typeof path[0] === "string" ? path[0] : "";
      const first = path[1];
      const bound = root === "names" && isKey(first) && v.names.has(String(first));
      // The place and the path of a reference are made only when a reader asks for them.
      const use = { path, root, free: !bound, address: v.address === true } as RefUse;
      Object.defineProperty(use, "place", { enumerable: true, get: () => v.place });
      Object.defineProperty(use, "at", { enumerable: true, get: () => v.at });
      Object.defineProperty(use, "visit", { enumerable: false, value: v });
      out.push(use);
      return undefined;
    },
    rest,
  );
  return out;
}

function setAt(value: unknown, path: readonly Key[], next: unknown): unknown {
  if (path.length === 0) return next;
  const [key, ...rest] = path as [Key, ...Key[]];
  if (Array.isArray(value)) {
    const copy = [...value];
    copy[Number(key)] = setAt(value[Number(key)], rest, next);
    return copy;
  }
  const record = (isRecord(value) ? value : {}) as Readonly<Record<string, unknown>>;
  const copy: Record<string, unknown> = {};
  for (const name of Object.keys(record)) Object.defineProperty(copy, name, { value: record[name], enumerable: true, writable: true, configurable: true });
  Object.defineProperty(copy, String(key), { value: setAt(record[String(key)], rest, next), enumerable: true, writable: true, configurable: true });
  return copy;
}

/**
 * This function changes the free references of a document. The document is not changed: the function gives a new
 * document that shares each part without a change.
 *
 * @param world - The world of the kinds.
 * @param doc - The document, as JSON.
 * @param change - The function that gives the new document of a reference, or `undefined` to keep it.
 * @param options - The type of a bare root value, and the names that the host binds at the root.
 * @returns The new document.
 */
export function mapRefs(world: World, doc: unknown, change: (use: RefUse) => unknown, options: WalkOptions = {}): unknown {
  let out = doc;
  for (const use of refsOf(world, doc, options)) {
    if (!use.free) continue;
    const next = change(use);
    if (next !== undefined) out = setAt(out, use.at, next);
  }
  return out;
}

/** A problem that a check finds before a document runs. */
export interface Issue {
  readonly code: ErrorCode;
  /** The keys from the root document to the document with the problem. */
  readonly place: readonly Key[];
  readonly reason: string;
  /** The keys from the root JSON value to the value with the problem. */
  readonly at?: readonly Key[];
  /** The type that the position needs, for a type issue (`#TYPE!`). */
  readonly expected?: ValueType;
  /** The type that the check found, for a type issue (`#TYPE!`). */
  readonly found?: ValueType;
}

/** The options of a check. */
export interface CheckOptions {
  /** The type of a bare root value. */
  readonly declaredType?: string;
  /** The names that the host binds at the root. `"any"` does not check the names. The default is no names. */
  readonly names?: readonly string[] | "any";
  /**
   * The capabilities at the root. Without them, the check does not check the effects. The check narrows them for
   * each part by the capability rules of the kinds, as a run does.
   */
  readonly caps?: readonly Cap[];
  /**
   * The verb that goes up the ladder at each document, as in `prepare`. The default is `eval`. `#NOEVAL` and the hook
   * `known` follow this verb. The contract declares the effects and the value types of `eval` only, thus only `eval`
   * checks them (VERB.CHECK). The type rule of an evaluator serves each verb.
   */
  readonly verb?: string;
  /**
   * With `true`, the check also checks the value types (TYPE.CHECK). It reads the type rules of the evaluators, the
   * signatures of the operations and the value types of the contracts. A type issue has the code `#TYPE!`. The
   * default is `false`, thus a host opts in.
   */
  readonly types?: boolean;
  /** The type that the root document must have, for the check of the value types. */
  readonly expect?: ValueType;
  /**
   * With `true`, the check also finds the problems of a run (RUN.CAN-WAIT). A runner under a parent without a runner
   * gives `#CALC!` when an effect of its runners can reach the host. The parent cannot pass that wait through.
   * A runner without such an effect does not wait, and the run drives it (RUN.DRIVE-NESTED). A kind that declares
   * effects and has no runner gives `#CALC!` too, because in a run only a runner can wait for the host. The default is
   * `false`.
   */
  readonly run?: boolean;
  /**
   * The value types of the roots and of the names of the host, for the check of the value types (TYPE.ROOTS). A
   * reference then gets the type that its path reaches. Only a check with `types: true` reads them.
   */
  readonly rootTypes?: RootTypes;
}

/** The result of `typeCheck`. */
export interface Typing {
  /** The type of the root document. It is `unknown` when the root has an issue. */
  readonly type: ValueType;
  /** Each issue of the check. The type issues come after the other issues. */
  readonly issues: readonly Issue[];
  /** The type of each document, in the order of the document. */
  readonly places: readonly Typed[];
}

/** The least authority: the capability `[]` permits each effect (CAP.KEYS). */
const EACH: readonly Cap[] = /* @__PURE__ */ Object.freeze([[]]);

/** No declared effect. One list serves each visit without effects. */
const NO_EFFECTS: readonly (readonly Key[])[] = /* @__PURE__ */ Object.freeze([]);

/**
 * This function gives the effects that the contract of the kind of a visit declares, as keys (FACTS.EFFECTS). The
 * text `"type"` gives the type of the document after each alias. A visit without a kind declares no effect. `check`,
 * `factsOf` and `effectsOf` read the declarations with this one function (D27).
 *
 * @param v - The visit.
 * @returns The keys of each declared effect, in the order of the contract.
 */
export function declaredEffects(v: DocVisit): readonly (readonly Key[])[] {
  const effects = v.kind?.effects;
  if (effects === undefined || effects.length === 0) return NO_EFFECTS;
  return effects === "type" ? [v.typePath ?? []] : effects.map((kind) => kind.split("."));
}

/**
 * This function gives the rule of a machine for an effect, for the static kit (CAP.PERMITS). The rule is the hook
 * `permits` of the machine, as in a run, or else the function `permits`. A check has no values, thus the hook gets a
 * context with the capabilities of the document and the world of the machine. Its names, its self and its event are
 * empty.
 *
 * @param machine - The machine.
 * @returns The rule. It gets the capabilities of a document and the keys of an effect.
 */
export function permitsOf(machine: Machine): (caps: readonly Cap[], kind: readonly Key[]) => boolean {
  const hook = machine.permits;
  if (hook === undefined) return permits;
  let base: Context | undefined;
  return (caps, kind) => hook(caps, kind, { ...(base ??= context({ world: worldThing(machine.world) })), caps });
}

/**
 * This function gives the reason of a `#CAP!`. When a kind around the document narrowed the capabilities, the
 * reason names the nearest such kind.
 */
function capReason(v: DocVisit, kind: readonly Key[], allowed: (caps: readonly Cap[], kind: readonly Key[]) => boolean): string {
  const text = kind.join(".");
  for (let up = v.parent; up !== undefined; up = up.parent) {
    if (up.caps !== undefined && allowed(up.caps, kind)) {
      return `The capabilities do not permit the effect ${text} here. The kind ${typeName(up.doc.type)} around it narrows them for its parts.`;
    }
  }
  return `The capabilities do not permit the effect ${text}.`;
}

/**
 * This function checks a document before an evaluation, by the contracts of its kinds. It finds the problems
 * that an evaluation finds when it reaches them:
 *
 * - `#KIND?`: a kind that the world does not have.
 * - `#NOEVAL`: no evaluator.
 * - `#VALUE!`: a value without the shape of its kind.
 * - `#PART?`: a value without a type.
 * - `#DEPTH!`: too much nesting.
 * - `#REF!` and `#STEP?`: a bad path.
 * - `#NAME?`: a name that nothing binds. With the hook `known` of the machine, also a name that the language does not
 *   have, for example an operation.
 * - `#CAP!`: an effect that the capabilities of its document do not permit. A kind around the document can narrow them.
 *   The hook `permits` of the machine decides, as in a run (CAP.PERMITS).
 * - `#CALC!`: with the option `run`, a runner under a parent without a runner, when an effect of its runners can reach
 *   the host. Also a kind that declares effects and has no runner (RUN.CAN-WAIT). The issue has the place and the
 *   reason of the run.
 * - `#TYPE!`: with the option `types`, a part whose type does not fit the type that its position needs (TYPE.CHECK).
 *   A run does not always fail there, thus a type issue is a static finding, not an error of a run.
 *
 * The check asks the ladder for the verb of the options, `eval` by default (VERB.CHECK). The shapes, the paths and the
 * names follow the contracts, thus they are the same for each verb. Only `eval` checks the declared effects.
 *
 * @param machine - The world and the code of the evaluators.
 * @param doc - The document, as JSON.
 * @param options - The type of a bare root value, the names of the host, the capabilities, the verb, the types and the run.
 * @returns The problems, in the order of the document. The type issues come after the other issues.
 */
export function check(machine: Machine, doc: unknown, options: CheckOptions = {}): readonly Issue[] {
  return options.types === true ? typeCheck(machine, doc, options).issues : checkAll(machine, doc, options, undefined);
}

/**
 * This function checks a document, and it also checks the value types (TYPE.CHECK, D25). It finds each issue of
 * `check`. Then it synthesizes the type of each document from the types of its parts. It also checks each part
 * against the type that its position needs. The type rule of the parent, the signature of an operation or the shape
 * of the contract gives that type. A part with an issue gets the type `unknown`, thus one
 * problem does not give a chain of issues.
 *
 * A type issue has the code `#TYPE!`, the type that the position needs (`expected`) and the type that the check found
 * (`found`). It is a static finding: the evaluation of the document does not change.
 *
 * The option `rootTypes` gives the types of the roots and of the names of the host (TYPE.ROOTS). A reference then gets
 * the type that its path reaches, and a field that a closed record does not have is a type issue (TYPE.CLOSED).
 *
 * @param machine - The world and the code of the evaluators, with their type rules.
 * @param doc - The document, as JSON.
 * @param options - The options of `check`, the type that the root must have and the types of the roots.
 * @returns The type of the root, each issue, and the type of each document.
 */
export function typeCheck(machine: Machine, doc: unknown, options: CheckOptions = {}): Typing {
  const nodes: TypeNode[] = [];
  const issues = checkAll(machine, doc, options, nodes);
  const pass = typePass(machine, nodes, options.verb ?? "eval", options.expect, options.rootTypes);
  return { type: pass.type, issues: pass.issues.length === 0 ? issues : [...issues, ...pass.issues], places: pass.places };
}

/**
 * A runner under an evaluator in a check of a run. The run drives its steps without a wait, thus only a wait for an
 * effect of its runners fails (RUN.DRIVE-NESTED).
 */
interface Drive {
  /** The issue of the run when a step waits. */
  readonly issue: Issue;
  /** The index of the issue in the order of the document. */
  readonly index: number;
  /** The node of the runner for the pass of types. */
  readonly node: TypeNode | undefined;
  /** `true` when an effect of its runners can reach the host, and thus wait. */
  wait: boolean;
}

/** What the code of a document does with a wait: an evaluator stops it, and a runner passes it on. */
type Waits = boolean | Drive;

/**
 * This function finds the issues of `check`. With a list of nodes, it also records each document that it visits for
 * the pass of types. It marks each document with an issue.
 */
function checkAll(machine: Machine, doc: unknown, options: CheckOptions, nodes: TypeNode[] | undefined): readonly Issue[] {
  const issues: Issue[] = [];
  const verb = options.verb ?? "eval";
  const indices = nodes === undefined ? undefined : new Map<DocVisit, number>();
  let current: TypeNode | undefined;
  const push = (issue: Issue): void => {
    issues.push(issue);
    if (current !== undefined) current.marked = true;
  };
  // The effects of a contract are the effects of eval (VERB.CONTRACT). An effect of another verb meets its test when
  // it happens (RUN.CAP).
  const effects = verb === "eval";
  const allowed = options.caps === undefined ? undefined : permitsOf(machine);
  // In a run, a part that can wait needs a parent that can wait (RUN.CAN-WAIT). The map tells for each document with
  // code if its code passes a wait on: false for an evaluator, true for a runner whose waits reach the driver of the
  // run, and a drive for a runner under an evaluator. A document without code fails before its parts, thus it is not
  // in the map.
  const waits = options.run === true ? new Map<DocVisit, Waits>() : undefined;
  const drives: Drive[] = [];
  const maxDepth = machine.maxDepth ?? 1000;
  const anyName = options.names === "any";
  const roots: readonly string[] = machine.roots ?? ROOTS;
  const has = (table: Readonly<Record<string, unknown>> | undefined, name: string): boolean => table !== undefined && Object.hasOwn(table, name);
  walk(
    machine.world,
    doc,
    (v) => {
      if (nodes !== undefined && indices !== undefined) {
        current = { visit: v, bound: v instanceof Visit ? v.bound : [], expect: v instanceof Visit ? v.expect : undefined, children: [], evaluator: undefined, marked: false };
        const parent = v.parent === undefined ? undefined : indices.get(v.parent);
        if (parent !== undefined) nodes[parent]?.children.push(nodes.length);
        indices.set(v, nodes.length);
        nodes.push(current);
      }
      if (v.depth > maxDepth) {
        push({ code: "#DEPTH!", place: v.place, reason: `The nesting is deeper than ${maxDepth} documents.`, at: v.at });
        return "skip";
      }
      const header = v.declared ? {} : v.doc;
      const answer = ask(machine.world, header, verb, v.declared ? { declaredType: typeName(v.doc.type) } : {});
      if (answer.error === "unknown-kind") {
        push({ code: "#KIND?", place: v.place, reason: `The world has no kind ${typeName(v.doc.type)}.`, at: v.at });
        return "skip";
      }
      const name = answer.evaluator;
      if (current !== undefined) current.evaluator = name;
      // A runner hides the evaluator of its name (MACHINE.RUNNER), as in the compilation of a plan.
      const runner = name !== undefined && has(machine.runners, name);
      const coded = name !== undefined && (runner || has(machine.evaluators, name));
      if (name === undefined || !coded) {
        push({ code: "#NOEVAL", place: v.place, reason: `No rung gives an evaluator for ${typeName(v.doc.type)}.`, at: v.at });
      } else if (machine.known !== undefined) {
        // The evaluator gives #NAME? in a run for a name that the language does not have, for example an operation.
        const known = machine.known(v.typePath ?? [], name);
        if (known !== true) push({ code: "#NAME?", place: v.place, reason: known, at: v.at });
      }
      const caps = v.caps;
      const declared = effects ? declaredEffects(v) : NO_EFFECTS;
      if (allowed !== undefined && caps !== undefined) {
        for (const kind of declared) {
          if (!allowed(caps, kind)) push({ code: "#CAP!", place: v.place, reason: capReason(v, kind, allowed), at: v.at });
        }
      }
      if (waits !== undefined && coded) {
        // The parent of the root is the driver of the run, and it can wait. An evaluator gives its parts no wait.
        const up = v.parent === undefined ? true : waits.get(v.parent);
        let chain: Waits = false;
        if (runner && up === false) {
          // The run drives a runner under an evaluator, and only a real wait fails (RUN.DRIVE-NESTED). Its issue goes in
          // here, in the order of the document, when an effect of its runners can wait.
          const issue: Issue = { code: "#CALC!", place: v.place, reason: waitedReason(typeName(v.doc.type)), at: v.at };
          chain = { issue, index: issues.length, node: current, wait: !effects };
          drives.push(chain);
        } else if (runner) {
          chain = up ?? true;
        }
        waits.set(v, chain);
        // A runner waits only for an effect that reaches the host (C6). A refused effect gives #CAP! without a wait.
        if (typeof chain === "object" && !chain.wait) {
          const rule = allowed ?? permits;
          chain.wait = declared.some((kind) => caps === undefined || rule(caps, kind));
        }
        // In a run, the host does each effect, thus an evaluator cannot cause one.
        const first = declared[0];
        if (!runner && first !== undefined) {
          push({ code: "#CALC!", place: v.place, reason: `The effect ${first.join(".")} needs a runner: in a run, the host does each effect.`, at: v.at });
        }
      }
      const isPath = isRef(v.doc);
      if (!isPath && v.typePath?.length === 1 && v.typePath[0] === "ref") {
        push({ code: "#VALUE!", place: v.place, reason: "The value of ref is a path: a list that starts with a root.", at: [...v.at, ...(v.declared ? [] : ["value"])] });
      }
      if (!isPath) return undefined;
      const path = v.doc.value as readonly Json[];
      const root = path[0];
      // The JSON path of a problem of a path goes to its step.
      const stepAt = (index: number): readonly Key[] => [...v.at, "value", ...(index < path.length ? [index] : [])];
      if (typeof root !== "string" || !(ROOTS as readonly string[]).includes(root)) {
        push({ code: "#REF!", place: v.place, reason: `A path starts with a root: ${ROOTS.join(", ")}.`, at: stepAt(0) });
        // The step documents of the path are parts, and they evaluate before the path, thus the walk visits them.
        return undefined;
      }
      if (!roots.includes(root)) {
        push({ code: "#REF!", place: v.place, reason: `The root ${root} is not open here. The open roots are ${roots.join(", ")}.`, at: stepAt(0) });
      }
      const first = path[1];
      if (root === ("names" as Root) && !anyName && isKey(first) && !v.names.has(String(first))) {
        const later = v.later.has(String(first));
        push({
          code: "#NAME?",
          place: v.place,
          reason: later ? `The name ${String(first)} is bound by a later step.` : `Nothing binds the name ${String(first)}.`,
          at: stepAt(1),
        });
      }
      path.forEach((step, index) => {
        if (index === 0 || isKey(step)) return;
        // The resolution finds the walker with the same function, thus the check and a run agree (VERB.LADDER).
        if (walkerOf(machine, step) === undefined) {
          push({ code: "#STEP?", place: v.place, reason: "A step is a key, or a document of a kind with the verb step.", at: stepAt(index) });
        }
      });
      // The step documents of the path are parts when the kind ref has a deep shape. The walk checks them too.
      return undefined;
    },
    {
      ...(options.declaredType === undefined ? {} : { declaredType: options.declaredType }),
      ...(Array.isArray(options.names) ? { names: options.names } : {}),
      // Without capabilities, a check of the run narrows the least authority, as effectsOf does. Thus a mask of a kind
      // removes the effects that cannot wait. The check of the capabilities stays off.
      ...(options.caps === undefined ? (waits === undefined ? {} : { caps: EACH }) : { caps: options.caps }),
      problem: (problem) => {
        issues.push({ code: problem.code, place: problem.place, reason: problem.reason, at: problem.at });
        // A value without the shape of its kind is a problem of the document that the walk visited last. A part that is
        // not a document has no visit, thus it marks nothing.
        if (problem.code === "#VALUE!" && current !== undefined) current.marked = true;
      },
    },
  );
  // The issue of each drive that can wait goes in at its place. The last drive goes in first, thus each index stays.
  for (let index = drives.length - 1; index >= 0; index -= 1) {
    const drive = drives[index] as Drive;
    if (!drive.wait) continue;
    issues.splice(drive.index, 0, drive.issue);
    if (drive.node !== undefined) drive.node.marked = true;
  }
  return issues;
}
