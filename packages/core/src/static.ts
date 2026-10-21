import { type Envelope, type Json, type Key, isEnvelope, isKey, isRecord, typeName } from "./doc.ts";
import { type Kind, type NamesSource, type ScopeRule, type World, lookupKind } from "./world.ts";
import { ask } from "./ladder.ts";
import { type PartSlot, pathMatches, splitParts } from "./parts.ts";
import { type Cap, type Root, ROOTS, isRef } from "./deref.ts";
import type { ErrorCode } from "./errors.ts";
import { type Machine, permits } from "./evaluate.ts";

/** One document that a walk visits. */
export interface DocVisit {
  /** The keys from the root document to this document, through the parts. It is the place of an error. */
  readonly place: readonly Key[];
  /** The keys from the root JSON value to this document. A change at this path changes this document. */
  readonly at: readonly Key[];
  /** The document. A bare value has the type that its position declares. */
  readonly doc: Envelope;
  /** `true` when the type came from the position and not from an envelope. */
  readonly declared: boolean;
  /** The kind of the document, when the world has it. */
  readonly kind?: Kind;
  /** The keys of the kind after each alias. */
  readonly typePath?: readonly Key[];
  /** The number of documents around this document. The root has 0. */
  readonly depth: number;
  /** The names that the kinds around this document bind for it. */
  readonly names: ReadonlySet<string>;
  /** The names that a sequence around this document binds only for the parts after it. */
  readonly later: ReadonlySet<string>;
}

/** A position that a walk cannot read as a document. */
export interface WalkProblem {
  readonly place: readonly Key[];
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

/** The names that the scope rules of a kind give each part, and the names that only later parts see. */
function scopesOf(rules: readonly ScopeRule[] | undefined, value: unknown, slots: readonly PartSlot[]): { readonly sees: readonly (readonly string[])[]; readonly later: readonly (readonly string[])[] } {
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

/**
 * This function visits each document of a document: the root and each part at each depth, by the contracts of the
 * kinds. A part of a kind that the world does not have is not visited. The walk uses no stack of the host for the
 * depth, thus a deep document cannot overflow it.
 *
 * @param world - The world of the kinds.
 * @param doc - The document, as JSON.
 * @param visit - The function that gets each document. It gives `"skip"` to not visit the parts of a document.
 * @param options - The type of a bare root value, the names of the host, and a function for the problems.
 */
export function walk(world: World, doc: unknown, visit: (visit: DocVisit) => void | "skip", options: WalkOptions = {}): void {
  interface Item {
    readonly value: unknown;
    readonly place: readonly Key[];
    readonly at: readonly Key[];
    readonly declared: string | undefined;
    readonly depth: number;
    readonly names: ReadonlySet<string>;
    readonly later: ReadonlySet<string>;
  }
  const stack: Item[] = [
    { value: doc, place: [], at: [], declared: options.declaredType, depth: 0, names: new Set(options.names ?? []), later: new Set() },
  ];
  while (stack.length > 0) {
    const item = stack.pop() as Item;
    const envelope = isEnvelope(item.value) ? (item.value as Envelope) : undefined;
    if (envelope === undefined && item.declared === undefined) {
      options.problem?.({ place: item.place, at: item.at, code: "#PART?", reason: "The value has no envelope, and its position declares no type." });
      continue;
    }
    const doc: Envelope = envelope ?? { type: item.declared ?? "?", value: item.value as Json };
    const found = lookupKind(world, doc.type);
    const kind = found.ok ? found.kind : undefined;
    const answer = visit({
      place: item.place,
      at: item.at,
      doc,
      declared: envelope === undefined,
      ...(kind === undefined ? {} : { kind, typePath: found.ok ? found.path : [] }),
      depth: item.depth,
      names: item.names,
      later: item.later,
    });
    if (answer === "skip" || kind === undefined) continue;
    const split = splitParts(kind.parts, doc.value);
    if (!split.ok) {
      const at = split.at.length === 0 ? "" : ` (at ${split.at.join(".")})`;
      options.problem?.({ place: item.place, at: item.at, code: "#VALUE!", reason: `${split.reason}${at} The kind is ${typeName(doc.type)}.` });
      continue;
    }
    const { sees, later } = scopesOf(kind.scope, doc.value, split.parts);
    const base = envelope === undefined ? item.at : [...item.at, "value"];
    for (let index = split.parts.length - 1; index >= 0; index -= 1) {
      const slot = split.parts[index] as PartSlot;
      const extra = sees[index] ?? [];
      const hidden = later[index] ?? [];
      stack.push({
        value: slot.item,
        place: [...item.place, ...slot.path],
        at: [...base, ...slot.path],
        declared: slot.of,
        depth: item.depth + 1,
        names: extra.length === 0 ? item.names : new Set([...item.names, ...extra]),
        later: hidden.length === 0 ? item.later : new Set([...item.later, ...hidden]),
      });
    }
  }
}

/** One reference of a document. */
export interface RefUse {
  /** The place of the reference document, through the parts. */
  readonly place: readonly Key[];
  /** The keys from the root JSON value to the reference document. */
  readonly at: readonly Key[];
  /** The path of the reference: its root and its steps. */
  readonly path: readonly Json[];
  readonly root: string;
  /** `false` when a kind around the reference binds its first name. A reference to another root is free. */
  readonly free: boolean;
}

/**
 * This function finds each reference of a document: each document of the type `ref` that a walk reaches. A
 * reference to a name that a kind around it binds is not free. The others are what the document reads from
 * outside: its dependencies.
 *
 * @param world - The world of the kinds.
 * @param doc - The document, as JSON.
 * @param options - The type of a bare root value. The names of the host do not change the result.
 * @returns The references, in the order of the document.
 */
export function refsOf(world: World, doc: unknown, options: WalkOptions = {}): readonly RefUse[] {
  const out: RefUse[] = [];
  // The walk gets no names of the host: a name that the host binds is a dependency, thus its reference is free.
  const { names: _host, ...rest } = options;
  walk(
    world,
    doc,
    (v) => {
      if (!isRef(v.doc)) return undefined;
      const path = v.doc.value as readonly Json[];
      const root = typeof path[0] === "string" ? path[0] : "";
      const first = path[1];
      const bound = root === "names" && isKey(first) && v.names.has(String(first));
      out.push({ place: v.place, at: v.at, path, root, free: !bound });
      return "skip";
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
}

/** The options of a check. */
export interface CheckOptions {
  /** The type of a bare root value. */
  readonly declaredType?: string;
  /** The names that the host binds at the root. `"any"` does not check the names. The default is no names. */
  readonly names?: readonly string[] | "any";
  /** The capabilities at the root. Without them, the check does not check the effects. */
  readonly caps?: readonly Cap[];
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
 * - `#NAME?`: a name that nothing binds.
 * - `#CAP!`: an effect that the capabilities do not permit.
 *
 * @param machine - The world and the code of the evaluators.
 * @param doc - The document, as JSON.
 * @param options - The type of a bare root value, the names of the host and the capabilities.
 * @returns The problems, in the order of the document.
 */
export function check(machine: Machine, doc: unknown, options: CheckOptions = {}): readonly Issue[] {
  const issues: Issue[] = [];
  const maxDepth = machine.maxDepth ?? 1000;
  const anyName = options.names === "any";
  const roots: readonly string[] = machine.roots ?? ROOTS;
  const has = (table: Readonly<Record<string, unknown>> | undefined, name: string): boolean => table !== undefined && Object.hasOwn(table, name);
  walk(
    machine.world,
    doc,
    (v) => {
      if (v.depth > maxDepth) {
        issues.push({ code: "#DEPTH!", place: v.place, reason: `The nesting is deeper than ${maxDepth} documents.` });
        return "skip";
      }
      const header = v.declared ? {} : v.doc;
      const answer = ask(machine.world, header, "eval", v.declared ? { declaredType: typeName(v.doc.type) } : {});
      if (answer.error === "unknown-kind") {
        issues.push({ code: "#KIND?", place: v.place, reason: `The world has no kind ${typeName(v.doc.type)}.` });
        return "skip";
      }
      const name = answer.evaluator;
      if (name === undefined || (!has(machine.evaluators, name) && !has(machine.runners, name))) {
        issues.push({ code: "#NOEVAL", place: v.place, reason: `No rung gives an evaluator for ${typeName(v.doc.type)}.` });
      }
      if (options.caps !== undefined && v.kind?.effects !== undefined) {
        const kinds: readonly (readonly Key[])[] = v.kind.effects === "type" ? [v.typePath ?? []] : v.kind.effects.map((kind) => kind.split("."));
        for (const kind of kinds) {
          if (!permits(options.caps, kind)) issues.push({ code: "#CAP!", place: v.place, reason: `The capabilities do not permit the effect ${kind.join(".")}.` });
        }
      }
      if (!isRef(v.doc)) return undefined;
      const path = v.doc.value as readonly Json[];
      const root = path[0];
      if (typeof root !== "string" || !(ROOTS as readonly string[]).includes(root)) {
        issues.push({ code: "#REF!", place: v.place, reason: `A path starts with a root: ${ROOTS.join(", ")}.` });
        return "skip";
      }
      if (!roots.includes(root)) {
        issues.push({ code: "#REF!", place: v.place, reason: `The root ${root} is not open here. The open roots are ${roots.join(", ")}.` });
      }
      const first = path[1];
      if (root === ("names" as Root) && !anyName && isKey(first) && !v.names.has(String(first))) {
        const later = v.later.has(String(first));
        issues.push({
          code: "#NAME?",
          place: v.place,
          reason: later ? `The name ${String(first)} is bound by a later step.` : `Nothing binds the name ${String(first)}.`,
        });
      }
      path.slice(1).forEach((step) => {
        if (isKey(step)) return;
        const found = isEnvelope(step) ? lookupKind(machine.world, step.type) : undefined;
        const walker = found?.ok === true && Object.hasOwn(found.kind.verbs, "step") ? found.kind.verbs["step"] : undefined;
        if (walker === undefined || !has(machine.walkers, walker)) {
          issues.push({ code: "#STEP?", place: v.place, reason: "A step is a key, or a document of a kind with the verb step." });
        }
      });
      return "skip";
    },
    {
      ...(options.declaredType === undefined ? {} : { declaredType: options.declaredType }),
      ...(Array.isArray(options.names) ? { names: options.names } : {}),
      problem: (problem) => issues.push({ code: problem.code, place: problem.place, reason: problem.reason }),
    },
  );
  return issues;
}
