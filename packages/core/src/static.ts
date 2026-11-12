import { type Envelope, type Json, type Key, field, isEnvelope, isKey, isRecord, typeName } from "./doc.ts";
import { type CapsRule, type Kind, type LazyRule, type World, type WorldEntry, atArgsOf, atRuleOf, circularOf, collectOf, eachKind, effectsOfVerb, equationType, isKind, isNamespace } from "./world.ts";
import { answerOf, ask } from "./ladder.ts";
import { type PartSlot, partsOf, rulesCover, scopesOf } from "./parts.ts";
import { type Cap, type Context, type Root, ROOTS, context, isRef, walkerOf, worldThing } from "./deref.ts";
import type { ErrorCode } from "./errors.ts";
import { type Machine, partCaps, partGrants, permits, waitedReason } from "./evaluate.ts";
import type { ValueType } from "./types.ts";
import { type RootTypes, type TypeNode, type Typed, machineTypeIssues, typePass } from "./typing.ts";
import { cycleIssues } from "./instances.ts";
import { STD_WALKERS } from "./stdlib.ts";

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
  /**
   * The kinds of effects that a handler around the document answers (CAP.GRANT, D146), narrowed by the capability rules
   * of the kinds around it (D198). Such an effect does not reach the host. They are not in `caps`.
   */
  readonly handled?: readonly Cap[] | undefined;
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
  readonly doc: Envelope;
  readonly declared: boolean;
  readonly depth: number;
  readonly names: ReadonlySet<string>;
  readonly later: ReadonlySet<string>;
  readonly slot: readonly Key[];
  readonly parent: DocVisit | undefined;
  readonly kind: Kind | undefined;
  readonly typePath: readonly Key[] | undefined;
  readonly address: true | undefined;
  readonly caps: readonly Cap[] | undefined;
  readonly handled: readonly Cap[] | undefined;
  readonly #place: Trail | undefined;
  readonly #at: Trail | undefined;
  readonly #bound: readonly string[];
  readonly #expect: ValueType | undefined;

  constructor(
    place: Trail | undefined,
    at: Trail | undefined,
    doc: Envelope,
    declared: boolean,
    depth: number,
    names: ReadonlySet<string>,
    later: ReadonlySet<string>,
    slot: readonly Key[],
    parent: DocVisit | undefined,
    kind: Kind | undefined,
    typePath: readonly Key[] | undefined,
    address: true | undefined,
    caps: readonly Cap[] | undefined,
    bound: readonly string[],
    expect: ValueType | undefined,
    handled: readonly Cap[] | undefined,
  ) {
    this.doc = doc;
    this.declared = declared;
    this.depth = depth;
    this.names = names;
    this.later = later;
    this.slot = slot;
    this.parent = parent;
    this.kind = kind;
    this.typePath = typePath;
    this.address = address;
    this.caps = caps;
    this.handled = handled;
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
    readonly handled: readonly Cap[] | undefined;
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
      handled: undefined,
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
      item.handled,
    );
    const answer = visit(here);
    if (answer === "skip" || kind === undefined) continue;
    const base: Trail | undefined = read.declared ? item.at : { up: item.at, keys: ["value"] };
    if (!split.ok) {
      options.problem?.({ place: keysOf(item.place), at: keysOf({ up: base, keys: split.at }), code: "#VALUE!", reason: split.reason });
      continue;
    }
    const { sees, later } = scopesOf(kind.scope, doc.value, split.parts);
    // The rules of a grant are read one time for each kind, not for each part. A kind without such a rule gives no list (K238).
    const grantRules = kind.caps !== undefined && kind.caps.some((rule) => rule.rule === "grant") ? kind.caps : undefined;
    for (let index = split.parts.length - 1; index >= 0; index -= 1) {
      const slot = split.parts[index] as PartSlot;
      const extra = sees[index] ?? [];
      const hidden = later[index] ?? [];
      const grants = grantRules === undefined ? undefined : partGrants(grantRules, slot.path, doc.value);
      const granted = grants !== undefined && grants.length > 0 ? grants : undefined;
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
        // A grant gives clause kinds and not capabilities (D198), thus the list of partCaps stays, with no copy (K238).
        caps: item.caps === undefined || kind.caps === undefined ? item.caps : partCaps(kind.caps, slot.path, item.caps),
        handled: handledOf(kind.caps, slot.path, item.handled, granted),
        bound: extra,
        expect: slot.expect,
      });
    }
  }
}

/**
 * This function gives the clause kinds of a part, as a run gives them. They are the kinds of the document and the
 * kinds of a grant. Then the rules of the kind narrow them (HANDLE.NARROW, D198).
 */
function handledOf(rules: readonly CapsRule[] | undefined, path: readonly Key[], handled: readonly Cap[] | undefined, granted: readonly Cap[] | undefined): readonly Cap[] | undefined {
  const kinds = granted === undefined ? handled : [...(handled ?? []), ...granted];
  return kinds === undefined || rules === undefined ? kinds : partCaps(rules, path, kinds);
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

/**
 * The answer of the function of `mapDocs` for one document.
 *
 * - `undefined`: keep the document and go into its parts.
 * - `"skip"`: keep the document and stop there.
 * - `{ to }`: put `to` in the place of the document and stop there.
 * - `{ to, into: true }`: put `to` in the place of the document, then go into the parts of the old document. Thus
 *   `to` must keep the path of each such part.
 */
export type DocChange = undefined | "skip" | { readonly to: unknown; readonly into?: boolean };

/**
 * This function changes the documents of a document, from the root to the parts (STATIC.MAPDOCS). The function
 * `change` reads only the original documents. It decides at each node, and it can stop at a node. The kinds of a
 * position come from the world, thus this function names no kind. The document is not changed: the function gives a
 * new document that shares each part without a change.
 *
 * @param world - The world of the kinds.
 * @param doc - The document, as JSON.
 * @param change - The function that gives the answer for each visit. See `DocChange`.
 * @param options - The type of a bare root value, and the names that the host binds at the root.
 * @returns The new document, or `doc` itself when no document changes.
 */
export function mapDocs(world: World, doc: unknown, change: (visit: DocVisit) => DocChange, options: WalkOptions = {}): unknown {
  let out = doc;
  walk(
    world,
    doc,
    (visit) => {
      const next = change(visit);
      if (next === undefined || next === "skip") return next;
      out = setAt(out, visit.at, next.to);
      return next.into === true ? undefined : "skip";
    },
    options,
  );
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
   * `known` follow this verb. The type rule of an evaluator serves each verb.
   *
   * The check tests the effects that the contract declares for this verb (VERB.EFFECTS). A kind without a declaration
   * for the verb gives no effect issue. The contract declares the value types of `eval` only, thus only `eval` checks
   * them (VERB.CHECK).
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

/**
 * This function gives the parts that the code of a runner evaluates itself, without a wait (RUN.DRIVES, D119). The
 * answer of the hook `facts` for the code wins over the contract. The contract describes only the code of its kind for
 * `eval`. Without a declaration, the runner passes each wait of its parts through.
 */
function driveRules(machine: Machine, v: DocVisit, kind: Kind, name: string, rung: string | undefined, verb: string): readonly LazyRule[] | undefined {
  if (verb !== "eval") return undefined;
  const hook = machine.facts?.(v.typePath ?? [], name)?.drives;
  if (hook !== undefined) return hook;
  const described = v.declared || rung !== "own" || name === answerOf(machine.world, undefined, kind, verb)?.name;
  return described ? kind.drives : undefined;
}

/** The least authority: the capability `[]` permits each effect (CAP.KEYS). */
const EACH: readonly Cap[] = /* @__PURE__ */ Object.freeze([[]]);

/** No declared effect. One list serves each visit without effects. */
const NO_EFFECTS: readonly (readonly Key[])[] = /* @__PURE__ */ Object.freeze([]);

/**
 * This function gives the effects that the code of a visit declares for a verb, as keys (FACTS.EFFECTS, VERB.EFFECTS).
 * The text `"type"` gives the type of the document after each alias. A visit without a kind declares no effect.
 * `check`, `factsOf`, `effectsOf` and `checkLatent` read the declarations with this one function (D27).
 *
 * For `eval`, the answer of the hook `facts` of the machine for the code of the visit wins over the contract of the
 * kind (CAP.OWN-EFFECTS, D118). Thus a language gives the effects of an own entry for another evaluator. Without a
 * machine, or without the field `effects` in the answer, the contract gives the effects.
 *
 * @param v - The visit.
 * @param verb - The verb. The default is `eval`. A kind without a declaration for the verb gives no effect.
 * @param machine - The machine with the hook `facts`, when the caller has it.
 * @param name - The name of the evaluator of the visit, when the caller knows it. Else the ladder gives it.
 * @returns The keys of each declared effect, in the order of the declaration.
 */
export function declaredEffects(v: DocVisit, verb = "eval", machine?: Machine, name?: string): readonly (readonly Key[])[] {
  return hookEffects(v, verb, machine, name) ?? verbDeclared(v, verb) ?? NO_EFFECTS;
}

/**
 * This function gives the effects that the hook `facts` gives for the code of a visit, as keys (D118). The result is
 * `undefined` for another verb than `eval`, without the hook, or when the answer has no field `effects`.
 */
function hookEffects(v: DocVisit, verb: string, machine: Machine | undefined, name: string | undefined): readonly (readonly Key[])[] | undefined {
  if (verb !== "eval" || machine?.facts === undefined || v.kind === undefined) return undefined;
  const code = name ?? answerOf(machine.world, v.declared ? undefined : v.doc.own, v.kind, "eval")?.name;
  const effects = code === undefined ? undefined : machine.facts(v.typePath ?? [], code)?.effects;
  return effects === undefined ? undefined : effectKeys(v, effects);
}

/**
 * This function gives the keys of a declaration of effects at a visit (D27). The text `"type"` gives the type of the
 * document after each alias.
 */
export function effectKeys(v: DocVisit, effects: "type" | readonly string[]): readonly (readonly Key[])[] {
  if (effects.length === 0) return NO_EFFECTS;
  return effects === "type" ? [v.typePath ?? []] : effects.map((kind) => kind.split("."));
}

/**
 * This function gives the effects that the contract of the kind of a visit declares for a verb, as keys. The result
 * is `undefined` when the contract has no declaration for the verb (D49). A visit without a kind declares no effect
 * for `eval` and no declaration for another verb.
 */
function verbDeclared(v: DocVisit, verb: string): readonly (readonly Key[])[] | undefined {
  if (v.kind === undefined) return verb === "eval" ? NO_EFFECTS : undefined;
  const effects = effectsOfVerb(v.kind, verb);
  if (effects === undefined) return undefined;
  return effectKeys(v, effects);
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
 * names follow the contracts, thus they are the same for each verb. The check tests the effects that each contract
 * declares for the verb: `effects` for `eval`, and the entry of `verbEffects` for another verb (VERB.EFFECTS). A kind
 * without a declaration for the verb gives no `#CAP!` and no `#CALC!` for an effect.
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
  const verb = options.verb ?? "eval";
  const pass = typePass(machine, nodes, verb, options.expect, options.rootTypes, (node) => declaredEffects(node.visit, verb, machine, node.evaluator).length > 0);
  return { type: pass.type, issues: pass.issues.length === 0 ? issues : [...issues, ...pass.issues], places: pass.places };
}

/**
 * A problem of a world that `checkWorld` finds before a document exists (STATIC.COVERAGE). Each document of the
 * kind gives this problem for the verb, thus `check` with the verb finds it too.
 *
 * With the option `types`, a problem can also be a bad value type of the machine (TYPE.WORLD, D110). Such a problem has
 * the code `#TYPE!` and the keys of the bad term in `at`.
 */
export interface WorldIssue {
  /**
   * The code of the problem. `#NOEVAL`: no rung of the ladder gives an evaluator for the verb. `#TYPE!`: a value type
   * of the machine is not correct, or a declaration of types cannot be true.
   */
  readonly code: "#NOEVAL" | "#TYPE!";
  /**
   * The keys of the kind from the root of the world. For a fallback kind, the keys of its namespace. For a type of a
   * domain or of a type rule, the list is empty.
   */
  readonly kind: readonly Key[];
  /** `true` for the fallback kind of a namespace or of the world. */
  readonly fallback?: true;
  /** The verb without an evaluator. A type issue has the verb `eval`, because the value types describe `eval` (D25). */
  readonly verb: string;
  /** For a type issue of a domain: the name of the domain in `Machine.domains`. */
  readonly domain?: string;
  /** For a type issue of a type rule: the name of its evaluator in `Machine.evaluators`. */
  readonly evaluator?: string;
  /**
   * For a type issue: the keys of the bad term in the kind, the domain or the declarations of the rule. An example is
   * `["parts", "item", "expect"]`, or `["sigs", "add", 1, "params", 0]`.
   */
  readonly at?: readonly Key[];
  readonly reason: string;
}

/** The options of `checkWorld`. */
export interface WorldOptions {
  /**
   * With `true`, the check also examines each value type of the machine (TYPE.WORLD, D110). It reads the contracts of
   * the kinds, the domains and the declarations of the type rules. The default is `false`.
   */
  readonly types?: boolean;
}

/** This function tells if a table of verbs has an entry for a verb. */
function hasVerb(table: Readonly<Record<string, string>> | undefined, verb: string): boolean {
  return table !== undefined && Object.hasOwn(table, verb);
}

/**
 * This function checks the world of a machine before a document exists. It finds each kind that has no entry for a
 * verb of the list, when the world has no default for that verb (STATIC.COVERAGE). A document of such a kind gets no
 * evaluator for the verb, thus the check gives the same proof of coverage as a type system.
 *
 * The check visits each kind of each namespace, at each depth, and the fallback kind of each namespace and of the
 * world. It does not follow an alias, because the kind of an alias has its own place. Without the option `types`, the
 * check reads only the world.
 *
 * With the option `types`, the check also examines each value type of the machine (TYPE.WORLD, D110). These issues
 * have the code `#TYPE!`, and they come after the issues of the verbs.
 *
 * @param machine - The machine, for its world.
 * @param verbs - The verbs that each kind of the language must answer, for example `eval`, `view` and `type`.
 * @param options - The option `types`.
 * @returns One issue for each kind and verb without an evaluator. The order is the order of the world, then the
 *   order of the verbs. The fallback kind of a namespace comes after the entries of that namespace.
 */
export function checkWorld(machine: Machine, verbs: readonly string[], options: WorldOptions = {}): readonly WorldIssue[] {
  const world = machine.world;
  const open = verbs.filter((verb) => !hasVerb(world.defaults, verb));
  const out: WorldIssue[] = [];
  if (open.length > 0) {
    eachKind(world, (kind, path, fallback) => {
      const text = path.join(".");
      const name = fallback ? (path.length === 0 ? "the fallback kind of the world" : `the fallback kind of ${text}`) : `the kind ${text}`;
      for (const verb of open) {
        if (hasVerb(kind.verbs, verb)) continue;
        const reason = `${name.charAt(0).toUpperCase()}${name.slice(1)} has no entry for the verb ${verb}, and the world has no default for it.`;
        out.push(fallback ? { code: "#NOEVAL", kind: path, fallback: true, verb, reason } : { code: "#NOEVAL", kind: path, verb, reason });
      }
    });
  }
  if (options.types === true) out.push(...machineTypeIssues(machine));
  return out;
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

/** The names that an equation of `down` sees (TREE.DOWN). */
const DOWN_NAMES: readonly string[] = /* @__PURE__ */ Object.freeze(["child", "index", "prev"]);

/** The names that the term `combine` of a fold sees (TREE.FOLD). */
const FOLD_NAMES: readonly string[] = /* @__PURE__ */ Object.freeze(["acc", "item"]);

/**
 * This function gives each equation of the tree contract of a kind, with the names that it sees (D42). An equation of
 * `equations`, a `unit`, a `default` and a contribution see no names. `check` and `factsOf` read the equations with
 * this one function.
 */
export function equationsOf(kind: Kind): readonly Equation[] {
  const tree = kind.tree;
  if (tree === undefined) return [];
  const out: Equation[] = [];
  for (const [name, term] of Object.entries(tree.equations ?? {})) out.push({ label: `tree.equations.${name}`, term, names: [], attribute: name, down: false });
  for (const [name, term] of Object.entries(tree.down ?? {})) out.push({ label: `tree.down.${name}`, term, names: DOWN_NAMES, attribute: name, down: true });
  for (const [name, declared] of Object.entries(tree.attributes ?? {})) {
    if (declared.fold !== undefined) {
      out.push({ label: `tree.attributes.${name}.fold.unit`, term: declared.fold.unit, names: [], attribute: name, down: false });
      out.push({ label: `tree.attributes.${name}.fold.combine`, term: declared.fold.combine, names: FOLD_NAMES, attribute: name, down: false });
    }
    if (declared.default !== undefined) out.push({ label: `tree.attributes.${name}.default`, term: declared.default, names: [], attribute: name, down: false });
    // Only the equation is known before the run. The document that it gives is not known (TREE.HIGHER-CHECK, D126).
    if (declared.higher !== undefined) out.push({ label: `tree.attributes.${name}.higher`, term: declared.higher, names: [], attribute: name, down: false });
    const collect = declared.collect === undefined ? undefined : collectOf(declared.collect);
    if (collect?.ok === true && !collect.names) {
      out.push({ label: `tree.attributes.${name}.collect.unit`, term: collect.unit, names: [], attribute: name, down: false });
      out.push({ label: `tree.attributes.${name}.collect.combine`, term: collect.combine, names: FOLD_NAMES, attribute: name, down: false });
    }
  }
  // A contribution is not the attribute of its node, thus an own part of its name does not hide it (D122).
  for (const [name, term] of Object.entries(tree.contributes ?? {})) out.push({ label: `tree.contributes.${name}`, term, names: [], attribute: name, down: false, contributes: true });
  // An equation of an attribute with parameters sees each parameter as a name (TREE.AT, D124).
  for (const [name, declared] of Object.entries(tree.at ?? {})) {
    const rule = atRuleOf(declared);
    if (rule.ok) out.push({ label: `tree.at.${name}`, term: rule.equation, names: rule.params, attribute: name, down: false, at: true });
  }
  return out;
}

/** One equation of the tree contract of a kind, with the names that it sees (D42). */
export interface Equation {
  /** The path of the equation in the contract, for the reason of an issue. */
  readonly label: string;
  readonly term: Json;
  readonly names: readonly string[];
  /** The name of the attribute that the equation gives. */
  readonly attribute: string;
  /** `true` for an equation of `down`: it gives the attribute of a child. */
  readonly down: boolean;
  /** `true` for an equation of `contributes`: it gives a contribution to a collection (TREE.COLLECT). */
  readonly contributes?: true;
  /** `true` for an equation of `at`: it gives an attribute with parameters (TREE.AT). */
  readonly at?: true;
}

/**
 * The steps that a node of the decorated tree answers before its ladder: `parent` and `type` (D106). An attribute with
 * one of these names gets no read.
 */
const STRUCTURAL: Readonly<Record<string, string>> = /* @__PURE__ */ Object.freeze({
  parent: "the step parent gives the parent of the node",
  type: "the step type gives the type of the node",
});

/**
 * The standard code that gives its parts the self of its own context (D106). `check` knows the self of a document only
 * through this code and the nodes of the decorated tree.
 */
const KEEPS_SELF: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "data.number",
  "data.text",
  "data.bool",
  "math.add",
  "math.multiply",
  "math.greater",
  "control.seq",
  "control.pure",
  "control.if",
  "control.handle",
  "list.all",
  "effect.log",
  "effect.write",
]);

/** This function tells if standard code gives its parts the self of its own context (D106). */
export function keepsSelf(evaluator: string | undefined): boolean {
  return evaluator !== undefined && KEEPS_SELF.has(evaluator);
}

/** The name of the standard code of a node of the decorated tree. */
export const TREE_NODE = "tree.node";

/** The name of the standard code of a reference. */
export const REF_CODE = "ref.resolve";

/** A node of the decorated tree that `check` knows (D106): the self of the code of its parts. */
export interface SeenNode {
  readonly kind: Kind;
  /** The name of the kind, for the reason of an issue. */
  readonly text: string;
  /** The names of the own parts of the node. The node of an equation has `undefined`: it stands for each node of its kind. */
  readonly own: ReadonlySet<string> | undefined;
  /** The parent node. It is `undefined` when `check` does not know the parent. */
  readonly parent: SeenNode | undefined;
}

/** The self of the code of each document of one walk, for the checks of attributes and the graph of attribute instances (D106, D107). */
export interface Selves {
  /**
   * This function tells if a document is a node of the decorated tree whose attributes the walk knows.
   *
   * @param v - The visit of the document.
   * @param evaluator - The evaluator that the ladder gives for the document.
   */
  isNode(v: DocVisit, evaluator: string | undefined): boolean;
  /**
   * This function gives the self of the code of a document, and its node when the document is a node. It records the
   * self that the parts of the document get. The walk visits a document before its parts.
   *
   * @param v - The visit of the document.
   * @param evaluator - The evaluator that the ladder gives for the document.
   */
  enter(v: DocVisit, evaluator: string | undefined): { readonly self: SeenNode | undefined; readonly node: SeenNode | undefined };
}

/**
 * This function makes the selves of one walk (D106). Only `eval` reads attributes, and only when the root `self` is
 * open. A node gets the self of its code as its parent. The standard code that keeps self gives its parts its own self.
 * Other code gives its parts a self that the walk does not know.
 *
 * @param machine - The machine.
 * @param verb - The verb of the walk.
 * @param root - The self of the root document: the node of an equation, or `undefined`.
 * @returns The selves.
 */
export function selvesOf(machine: Machine, verb: string, root: SeenNode | undefined): Selves {
  const roots: readonly string[] = machine.roots ?? ROOTS;
  const on = verb === "eval" && roots.includes("self") && hasEntry(machine.evaluators, TREE_NODE) && !hasEntry(machine.runners, TREE_NODE);
  const selves = new Map<DocVisit, SeenNode | undefined>();
  const isNode = (v: DocVisit, evaluator: string | undefined): boolean => on && evaluator === TREE_NODE && v.kind !== undefined;
  return {
    isNode,
    enter(v, evaluator) {
      const self = v.parent === undefined ? root : selves.get(v.parent);
      if (!isNode(v, evaluator) || v.kind === undefined) {
        selves.set(v, keepsSelf(evaluator) ? self : undefined);
        return { self, node: undefined };
      }
      // The own parts are the parts of the split, as in a run. A field without a part is data, and no step reads it.
      const read = partsOf(machine.world, v.declared ? v.doc.value : v.doc, v.declared ? typeName(v.doc.type) : undefined);
      const own = read.ok && read.split.ok ? new Set(read.split.parts.map((part) => part.key)) : undefined;
      const node: SeenNode = { kind: v.kind, text: typeName(v.doc.type), own, parent: self };
      selves.set(v, node);
      return { self, node };
    },
  };
}

/**
 * This function tells if a name is a structural step of a node of the decorated tree: `parent` or `type` (D106). An
 * attribute with such a name gets no read.
 */
export function isStructural(name: string): boolean {
  return Object.hasOwn(STRUCTURAL, name);
}

/** One attribute that a kind needs at each of its nodes: a declaration, or a read in an equation (TREE.CHECK-COMPLETE). */
interface Need {
  readonly name: string;
  /** The words of the reason that tell why the kind needs the attribute. */
  readonly why: string;
  /** The attribute of the equation with the read. An own part with this name hides the equation. */
  readonly hidden: string | undefined;
}

/** The state of the checks of attributes in one check: the kinds that the check walked, and the needs of each kind. */
interface TreeState {
  readonly seen: Set<Kind>;
  readonly needs: Map<Kind, Need[]>;
}

/** The names of `down` in the world of each machine, for a parent that `check` does not know (D106). */
const DOWNS = /* @__PURE__ */ new WeakMap<World, ReadonlySet<string>>();

/**
 * This function gives each name that an equation of `down` of a kind of the world gives. The kinds include the kinds
 * of the namespaces and each fallback kind (WORLD.OPEN). A parent that `check` does not know has one of these kinds.
 */
export function downNames(world: World): ReadonlySet<string> {
  const known = DOWNS.get(world);
  if (known !== undefined) return known;
  const out = new Set<string>();
  const done = new Set<object>();
  const add = (kind: Kind | undefined): void => {
    for (const name of Object.keys(kind?.tree?.down ?? {})) out.add(name);
  };
  const visit = (entries: Readonly<Record<string, WorldEntry>>, fallback: Kind | undefined): void => {
    if (done.has(entries)) return;
    done.add(entries);
    add(fallback);
    for (const entry of Object.values(entries)) {
      if (isKind(entry)) add(entry);
      else if (isNamespace(entry)) visit(entry.kinds, entry.fallback);
    }
  };
  visit(world.kinds, world.fallback);
  DOWNS.set(world, out);
  return out;
}

/** This function tells if a table of a tree contract has its own entry for a name. */
function hasEntry(table: Readonly<Record<string, unknown>> | undefined, name: string): boolean {
  return table !== undefined && Object.hasOwn(table, name);
}

/**
 * This function tells if a rung of the ladder can answer an attribute of a node (TREE.LADDER). An unknown parent can
 * be a node of each kind of the world, thus each name of `down` in the world can answer. A copy can always answer,
 * because `check` does not know a node without a parent. A kind with `forwards` can answer each other name, because the
 * forwarded node is not known before the run (TREE.FORWARD-CHECK).
 */
export function answered(world: World, node: SeenNode, name: string): boolean {
  if (node.own?.has(name) === true) return true;
  const tree = node.kind.tree;
  if (hasEntry(tree?.equations, name) || (tree?.forwards !== undefined && tree.forwards !== name)) return true;
  if (node.parent === undefined ? downNames(world).has(name) : hasEntry(node.parent.kind.tree?.down, name)) return true;
  const declared = tree?.attributes !== undefined && Object.hasOwn(tree.attributes, name) ? tree.attributes[name] : undefined;
  return declared !== undefined && (declared.copy === true || declared.fold !== undefined || declared.collect !== undefined || declared.default !== undefined || declared.higher !== undefined);
}

/**
 * This function checks the equations of the tree contract of a kind, each with the names of its rung (TREE.DOWN-NAMES).
 * An equation evaluates without capabilities, thus a check with capabilities gives it none. Each issue gets the place
 * of the document of the kind, and its reason names the equation. The function also records the needs of the kind:
 * each declared attribute, and each attribute of the node that an equation reads (TREE.CHECK-COMPLETE).
 */
function equationIssues(machine: Machine, kind: Kind, kindText: string, options: CheckOptions, state: TreeState): readonly Issue[] {
  const of = equationType(kind);
  const out: Issue[] = [];
  const needs: Need[] = [];
  state.needs.set(kind, needs);
  for (const name of Object.keys(kind.tree?.attributes ?? {})) needs.push({ name, why: "the kind declares it", hidden: undefined });
  if (typeof kind.tree?.forwards === "string" && !Object.hasOwn(STRUCTURAL, kind.tree.forwards)) needs.push({ name: kind.tree.forwards, why: "the kind forwards to it", hidden: undefined });
  const self: SeenNode = { kind, text: kindText, own: undefined, parent: undefined };
  for (const { label, term, names, attribute, down, contributes, at } of equationsOf(kind)) {
    const inner: CheckOptions = { names, ...(of === undefined ? {} : { declaredType: of }), ...(options.caps === undefined ? {} : { caps: [] }) };
    const read = (name: string): void => {
      needs.push({ name, why: `the equation ${label} reads it`, hidden: down || contributes === true || at === true ? undefined : attribute });
    };
    for (const issue of checkAll(machine, term, inner, undefined, state, { node: self, read })) {
      out.push({ code: issue.code, place: [], reason: `In the equation ${label} of the kind ${kindText}: ${issue.reason}` });
    }
  }
  return out;
}

/**
 * This function finds the issues of the contract of a tree kind (TREE.CHECK-RESERVED). An attribute with the name of a
 * structural step gets no read. A tree kind of the run side contradicts the evaluation on demand of its attributes. A
 * declaration `circular` without a start value or with a bad limit gives `#VALUE!` (TREE.CIRCULAR-CHECK). A declaration
 * `collect` without its form gives `#VALUE!` too (TREE.COLLECT). So does an entry of `at` without its form (TREE.AT-CHECK).
 * A field `forwards` that is not a text gives `#VALUE!`, and a structural name gives `#NAME?` (TREE.FORWARD-CHECK).
 */
function contractIssues(kind: Kind, kindText: string): readonly Issue[] {
  const out: Issue[] = [];
  const tree = kind.tree;
  for (const table of ["equations", "down", "attributes", "contributes", "at"] as const) {
    for (const name of Object.keys(tree?.[table] ?? {})) {
      const why = Object.hasOwn(STRUCTURAL, name) ? STRUCTURAL[name] : undefined;
      if (why !== undefined) out.push({ code: "#NAME?", place: [], reason: `The kind ${kindText} gives the reserved attribute tree.${table}.${name}: ${why}.` });
    }
  }
  // A declaration circular needs a start value and a correct limit (TREE.CIRCULAR-CHECK, D113).
  for (const [name, declared] of Object.entries(tree?.attributes ?? {})) {
    const rule = declared.circular === undefined ? undefined : circularOf(declared.circular);
    if (rule !== undefined && !rule.ok) out.push({ code: "#VALUE!", place: [], reason: `The kind ${kindText} has a bad declaration tree.attributes.${name}.circular. ${rule.reason}` });
    const collect = declared.collect === undefined ? undefined : collectOf(declared.collect);
    if (collect !== undefined && !collect.ok) out.push({ code: "#VALUE!", place: [], reason: `The kind ${kindText} has a bad declaration tree.attributes.${name}.collect. ${collect.reason}` });
  }
  for (const [name, declared] of Object.entries(tree?.at ?? {})) {
    const rule = atRuleOf(declared);
    if (!rule.ok) out.push({ code: "#VALUE!", place: [], reason: `The kind ${kindText} has a bad entry tree.at.${name}. ${rule.reason}` });
  }
  const forwards: unknown = tree?.forwards;
  if (forwards !== undefined && typeof forwards !== "string") out.push({ code: "#VALUE!", place: [], reason: `The kind ${kindText} has a bad field tree.forwards. It must be a text.` });
  if (typeof forwards === "string" && Object.hasOwn(STRUCTURAL, forwards)) {
    out.push({ code: "#NAME?", place: [], reason: `The kind ${kindText} gives the reserved attribute tree.forwards: ${String(STRUCTURAL[forwards])}.` });
  }
  if (kind.side === "run") {
    out.push({ code: "#CALC!", place: [], reason: `The tree kind ${kindText} is on the run side: a node evaluates its attributes on demand, thus in no fixed order.` });
  }
  return out;
}

/**
 * This function finds the issues of a node of a document (D106). An own part with the name of a structural step is
 * not read at any time (TREE.CHECK-RESERVED). Each need of the kind gets an answer from a rung (TREE.CHECK-COMPLETE).
 */
function nodeIssues(machine: Machine, node: SeenNode, state: TreeState, v: DocVisit): readonly Issue[] {
  const out: Issue[] = [];
  const at = (key: string): readonly Key[] => [...v.at, ...(v.declared ? [] : ["value"]), key];
  for (const name of node.own ?? []) {
    const why = Object.hasOwn(STRUCTURAL, name) ? STRUCTURAL[name] : undefined;
    if (why !== undefined) out.push({ code: "#NAME?", place: v.place, reason: `The part ${name} of the kind ${node.text} has a reserved name: ${why}.`, at: at(name) });
  }
  const done = new Set<string>();
  for (const need of state.needs.get(node.kind) ?? []) {
    if (done.has(need.name) || (need.hidden !== undefined && node.own?.has(need.hidden) === true)) continue;
    done.add(need.name);
    if (answered(machine.world, node, need.name)) continue;
    out.push({ code: "#N/A", place: v.place, reason: `No rung gives the attribute ${need.name} of the kind ${node.text}, and ${need.why}.`, at: v.at });
  }
  return out;
}

/**
 * This function examines a reference from the root `self` (TREE.CHECK-UNKNOWN). The steps `parent` go up the known
 * nodes. The first other key names an attribute of the node that they reach. When no rung answers the attribute, the
 * function gives the index of the step and the reason. In an equation, a read of the node of the equation goes to the
 * needs of its kind. A step `tree.at` with literal arguments gets the checks of TREE.AT-CHECK.
 */
function readIssue(
  machine: Machine,
  self: SeenNode | undefined,
  path: readonly Json[],
  rootSelf: RootSelf | undefined,
): { readonly index: number; readonly reason: string; readonly code?: ErrorCode } | undefined {
  let node = self;
  let index = 1;
  while (node !== undefined && index < path.length && path[index] === "parent") {
    node = node.parent;
    index += 1;
  }
  const step = path[index];
  if (node !== undefined && isAtStep(machine, step)) {
    const at = atStepOf(node.kind, node.text, step.value);
    return at.kind === "issue" ? { index, reason: at.reason, code: at.code } : undefined;
  }
  if (node === undefined || !isKey(step) || Object.hasOwn(STRUCTURAL, String(step))) return undefined;
  const name = String(step);
  if (node.own === undefined) {
    if (node === rootSelf?.node) rootSelf.read(name);
    return undefined;
  }
  return answered(machine.world, node, name) ? undefined : { index, reason: `No rung gives the attribute ${name} of the kind ${node.text}.` };
}

/** This function tells if a step of a path is a step `tree.at` of the standard walker (TREE.AT, D124). */
export function isAtStep(machine: Machine, step: unknown): step is Envelope {
  return isEnvelope(step) && walkerOf(machine, step) === STD_WALKERS["walk.tree.at"];
}

/**
 * A step `tree.at` of a known kind before the run (TREE.AT-CHECK, D124). An exact step names an instance. The run of a
 * step with an issue fails at the step. Only the run knows a step with a document in its data, or a bad entry.
 */
export type AtStep =
  | { readonly kind: "exact"; readonly attr: string; readonly key: string; readonly equation: Json; readonly params: readonly string[]; readonly names: Readonly<Record<string, Json>> }
  | { readonly kind: "issue"; readonly code: ErrorCode; readonly reason: string }
  | { readonly kind: "unknown" };

/**
 * This function examines the data of a step `tree.at` on a node of a known kind (TREE.AT-CHECK, D124). `check` and the
 * graph of attribute instances read the step with this one function.
 */
export function atStepOf(kind: Kind, kindText: string, data: unknown): AtStep {
  if (holdsDocument(data)) return { kind: "unknown" };
  const attr = isRecord(data) ? field(data, "attr") : undefined;
  if (typeof attr !== "string") return { kind: "issue", code: "#VALUE!", reason: "The step tree.at needs a text attr." };
  const table = kind.tree?.at;
  const declared = table !== undefined && Object.hasOwn(table, attr) ? table[attr] : undefined;
  if (declared === undefined) return { kind: "issue", code: "#N/A", reason: `No rung gives the attribute ${attr} with parameters of the kind ${kindText}.` };
  const rule = atRuleOf(declared);
  // The issue of a bad entry is an issue of the kind (contractIssues).
  if (!rule.ok) return { kind: "unknown" };
  const given = atArgsOf(rule.params, isRecord(data) && Object.hasOwn(data, "args") ? field(data, "args") : {});
  if (!given.ok) return { kind: "issue", code: "#VALUE!", reason: `The step tree.at of ${attr} of the kind ${kindText} has bad arguments. ${given.reason}` };
  return { kind: "exact", attr, key: given.key, equation: rule.equation, params: rule.params, names: given.names };
}

/** This function tells if a value holds a document. A document in the data of a step can be a part, thus only the run knows its value. */
function holdsDocument(value: unknown): boolean {
  if (isEnvelope(value)) return true;
  if (Array.isArray(value)) return value.some(holdsDocument);
  return isRecord(value) && Object.values(value).some(holdsDocument);
}

/** The self of the root of a walk for the checks of attributes: the node of an equation, and the function for its reads. */
interface RootSelf {
  readonly node: SeenNode;
  /** This function gets each attribute of the node of the equation that the equation reads. */
  readonly read: (name: string) => void;
}

/**
 * This function finds the issues of `check`. With a list of nodes, it also records each document that it visits for
 * the pass of types. It marks each document with an issue. The state holds the kinds whose equations the check
 * walked, thus it walks the equations of each kind one time. In an equation, `rootSelf` is the node of the equation.
 */
function checkAll(
  machine: Machine,
  doc: unknown,
  options: CheckOptions,
  nodes: TypeNode[] | undefined,
  state: TreeState = { seen: new Set(), needs: new Map() },
  rootSelf?: RootSelf,
): readonly Issue[] {
  const seen = state.seen;
  const issues: Issue[] = [];
  const verb = options.verb ?? "eval";
  const indices = nodes === undefined ? undefined : new Map<DocVisit, number>();
  let current: TypeNode | undefined;
  const push = (issue: Issue): void => {
    issues.push(issue);
    if (current !== undefined) current.marked = true;
  };
  // The field effects declares eval, and verbEffects declares the other verbs (VERB.EFFECTS). An effect of a verb
  // without a declaration meets its test when it happens (RUN.CAP).
  const allowed = options.caps === undefined ? undefined : permitsOf(machine);
  // In a run, a part that can wait needs a parent that can wait (RUN.CAN-WAIT). The map tells for each document with
  // code if its code passes a wait on: false for an evaluator, true for a runner whose waits reach the driver of the
  // run, and a drive for a runner under an evaluator. A document without code fails before its parts, thus it is not
  // in the map.
  const waits = options.run === true ? new Map<DocVisit, Waits>() : undefined;
  // The parts that the code of a runner evaluates itself, without a wait (RUN.DRIVES). They get no wait, as under an
  // evaluator. Only a runner that declares `drives` is in the map.
  const driven = new Map<DocVisit, readonly LazyRule[]>();
  const drives: Drive[] = [];
  const maxDepth = machine.maxDepth ?? 1000;
  const anyName = options.names === "any";
  const roots: readonly string[] = machine.roots ?? ROOTS;
  const has = (table: Readonly<Record<string, unknown>> | undefined, name: string): boolean => table !== undefined && Object.hasOwn(table, name);
  // The checks of attributes know the self of the code of each document (D106). Only eval reads attributes.
  const attributes = verb === "eval" && roots.includes("self");
  const selves = selvesOf(machine, verb, rootSelf?.node);
  // A document with a node of the decorated tree gets the check of the cycles of its attributes (D107).
  let trees = false;
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
      // The equations of a kind are code of the kind. The check walks them at the first document of the kind (D42).
      const node = selves.isNode(v, answer.evaluator);
      if (v.kind !== undefined && (v.kind.tree !== undefined || node) && !seen.has(v.kind)) {
        seen.add(v.kind);
        const kindText = typeName(v.doc.type);
        for (const issue of [...contractIssues(v.kind, kindText), ...equationIssues(machine, v.kind, kindText, options, state)]) push({ ...issue, place: v.place, at: v.at });
      }
      // The self of the code of this document, and the self that its parts get (D106).
      const { self, node: here } = selves.enter(v, answer.evaluator);
      if (here !== undefined) trees = true;
      if (here?.own !== undefined) for (const issue of nodeIssues(machine, here, state, v)) push(issue);
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
      const stated = hookEffects(v, verb, machine, name) ?? verbDeclared(v, verb);
      const declared = stated ?? NO_EFFECTS;
      // A clause answers an effect of its clause kinds before the host sees it, by the rule of the kernel (D198).
      const handled = v.handled;
      if (allowed !== undefined && caps !== undefined) {
        for (const kind of declared) {
          if (handled !== undefined && permits(handled, kind)) continue;
          if (!allowed(caps, kind)) push({ code: "#CAP!", place: v.place, reason: capReason(v, kind, allowed), at: v.at });
        }
      }
      if (waits !== undefined && coded) {
        // The parent of the root is the driver of the run, and it can wait. An evaluator gives its parts no wait.
        let up = v.parent === undefined ? true : waits.get(v.parent);
        const rules = v.parent === undefined ? undefined : driven.get(v.parent);
        if (up !== false && rules !== undefined && v.parent !== undefined && rulesCover(rules, v.parent.kind?.parts, v.parent.doc.value as Json, v.slot)) up = false;
        let chain: Waits = false;
        if (runner && up === false) {
          // The run drives a runner under an evaluator, and only a real wait fails (RUN.DRIVE-NESTED). Its issue goes in
          // here, in the order of the document, when an effect of its runners can wait.
          const issue: Issue = { code: "#CALC!", place: v.place, reason: waitedReason(typeName(v.doc.type)), at: v.at };
          chain = { issue, index: issues.length, node: current, wait: false };
          drives.push(chain);
        } else if (runner) {
          chain = up ?? true;
        }
        waits.set(v, chain);
        if (runner && v.kind !== undefined) {
          const own = driveRules(machine, v, v.kind, name, answer.rung, verb);
          if (own !== undefined && own.length > 0) driven.set(v, own);
        }
        // A runner waits only for an effect that reaches the host (C6). A refused effect gives #CAP! without a wait. A
        // runner without a declaration for the verb can cause each effect, thus it can wait. A clause can wait for an
        // effect of its own, thus a handled effect can wait too.
        if (typeof chain === "object" && !chain.wait) {
          const rule = allowed ?? permits;
          chain.wait = stated === undefined || declared.some((kind) => caps === undefined || rule(caps, kind) || (handled !== undefined && permits(handled, kind)));
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
      // Only the standard code of a reference reads the attribute, thus a header that changes the code hides the read.
      if (attributes && root === "self" && v.address !== true && name === REF_CODE) {
        const issue = readIssue(machine, self, path, rootSelf);
        if (issue !== undefined) push({ code: issue.code ?? "#N/A", place: v.place, reason: issue.reason, at: stepAt(issue.index) });
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
  // The cycles of the attributes come after the issues of the walk (TREE.GRAPH-CYCLE). An equation gets none here.
  if (trees && rootSelf === undefined) for (const issue of cycleIssues(machine, doc, options)) issues.push(issue);
  return issues;
}
