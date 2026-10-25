import { type Json, type Key, isEnvelope, isKey } from "./doc.ts";
import { type Kind, type LazyRule, type Side, type World, lookupKind } from "./world.ts";
import { answerOf } from "./ladder.ts";
import { pathMatches, splitParts } from "./parts.ts";
import { type Root, ROOTS, isRef } from "./deref.ts";
import type { Machine } from "./evaluate.ts";
import { type DocVisit, declaredEffects, walk } from "./static.ts";

/**
 * One read of a document: a free reference, with its marks (FACTS.READS). A plan resolves the path of the reference
 * when it evaluates the reference. The static read covers each path that the plan resolves there (FACTS.SOUND).
 */
export interface StaticRead {
  /** The root of the path. */
  readonly root: Root;
  /** The keys after the root, up to the first step that is not a key. */
  readonly keys: readonly Key[];
  /**
   * `true` when each step after the root is a key. Then the plan resolves this path and no other. A step document,
   * for example `nearest`, makes it `false`: the plan resolves a path that starts with the keys.
   */
  readonly exact: boolean;
  /** `true` when only a lazy part reaches the reference. An evaluation can then give a value without this read (FACTS.LAZY). */
  readonly lazy: boolean;
  /** `true` when the position of the reference declares an address. The read gives what the path reaches, not its value. */
  readonly address: boolean;
  /** The path of the reference: its root and its steps. */
  readonly path: readonly Json[];
  /** The keys from the root document to the reference document, through the parts. */
  readonly place: readonly Key[];
  /** The keys from the root JSON value to the reference document. */
  readonly at: readonly Key[];
}

/** The static facts of one document (D24). They depend only on the document and the machine, not on a context. */
export interface DocFacts {
  /** The free references, in the order of the document (FACTS.READS). A reference to a name that a kind binds is not here. */
  readonly reads: readonly StaticRead[];
  /** `"run"` when one kind of the document is on the run side (FACTS.SIDE). */
  readonly side: Side;
  /** The kinds of the effects that the contracts declare, as texts with dots, each one time (FACTS.EFFECTS). */
  readonly effects: readonly string[];
  /**
   * `true` when each kind of the document declares `pure`, and the document has no effect and is not volatile. Then
   * its result depends only on what its reads give (FACTS.PURE).
   */
  readonly pure: boolean;
  /** `true` when the result can change while each read gives the same thing, for example with a clock (FACTS.VOLATILE). */
  readonly volatile: boolean;
  /** The number of documents in the document: a hint of the cost of an evaluation. */
  readonly size: number;
}

/** The options of `factsOf`. */
export interface FactsOptions {
  /** The type of a bare root value. */
  readonly declaredType?: string;
  /**
   * The verb whose evaluators the facts describe, as in `prepare`. The default is `eval`. The contract of a kind
   * describes the code of `eval` only. For another verb, only the hook `facts` describes the code (FACTS.VERB).
   */
  readonly verb?: string;
  /**
   * This function tells if a read reaches a volatile value of the host, for example a function that reads a clock.
   * A read that it marks makes the document volatile (FACTS.VOLATILE).
   *
   * @param read - The read.
   * @returns `true` when the read reaches a volatile value.
   */
  readonly volatile?: (read: StaticRead) => boolean;
}

/** The lazy rules that cover each part: the rules of a document whose evaluator the contract does not describe. */
const EACH = "each";

/** What a document gives to its parts: its own lazy mark, and the lazy rules of its kind for the parts. */
interface Above {
  readonly lazy: boolean;
  readonly rules: readonly LazyRule[] | typeof EACH | undefined;
  /** The position of each part among the parts that a rule `after` covers. It is made at the first need. */
  positions?: Map<LazyRule, Map<string, number>>;
}

/**
 * This function gives the name of the evaluator that the ladder finds for a verb (VERB.LADDER). It also tells if
 * the contract of the kind describes that code. The contract describes the code of its kind for its verb `contract`.
 * An own entry for another evaluator has code that the contract does not describe.
 */
function codeOf(
  world: World,
  own: Readonly<Record<string, string>> | undefined,
  kind: Kind,
  verb: string,
  contract: string,
): { readonly name: string | undefined; readonly described: boolean } {
  const found = answerOf(world, own, kind, verb);
  if (verb !== contract) return { name: found?.name, described: false };
  if (found?.rung !== "own") return { name: found?.name, described: true };
  return { name: found.name, described: found.name === answerOf(world, undefined, kind, verb)?.name };
}

/** This function gives the position of a part among the parts that a rule covers, by the split of its document. */
function positionOf(above: Above, parent: DocVisit, rule: LazyRule, slot: readonly Key[]): number {
  const positions = (above.positions ??= new Map());
  let table = positions.get(rule);
  if (table === undefined) {
    table = new Map();
    const split = splitParts(parent.kind?.parts, parent.doc.value);
    let count = 0;
    for (const part of split.ok ? split.parts : []) {
      if (rule.in !== undefined && !rule.in.some((pattern) => pathMatches(part.path, pattern))) continue;
      table.set(JSON.stringify(part.path), count);
      count += 1;
    }
    positions.set(rule, table);
  }
  return table.get(JSON.stringify(slot)) ?? 0;
}

/** This function tells if the lazy rules of a document cover one of its parts. */
function partLazy(above: Above, parent: DocVisit, slot: readonly Key[]): boolean {
  const rules = above.rules;
  if (rules === undefined) return false;
  if (rules === EACH) return true;
  for (const rule of rules) {
    if (rule.in !== undefined && !rule.in.some((pattern) => pathMatches(slot, pattern))) continue;
    const after = rule.after ?? 0;
    if (after <= 0 || positionOf(above, parent, rule, slot) >= after) return true;
  }
  return false;
}

/**
 * This function gives the static facts of a document, for a schedule (R4 P2, D24). It walks the document one time,
 * by the contracts of its kinds:
 *
 * - `reads`: each free reference, with the root and the keys of its path. A read under a lazy part has the mark
 *   `lazy`, for example a read in a branch of `if`. A read after a step document has `exact: false`.
 * - `side` and `effects`: from the contract of each kind.
 * - `pure`: each kind declares `pure`, and the document has no effect and is not volatile.
 * - `volatile`: a kind, an operation or a step document declares `volatile`, or the host marks a read.
 *
 * The hook `facts` of the machine answers for a name that a fallback kind covers, for example an operation. Its
 * answer wins over the contract of the kind. The contract of a kind does not describe the evaluator of an own
 * entry. Thus a document with an own entry for another evaluator is not pure, and each of its parts is lazy. The
 * hook can still answer for that evaluator.
 *
 * The option `verb` names the verb whose code the facts describe (FACTS.VERB). A contract describes the code of
 * `eval`, thus the rule of an own entry applies to each document for another verb. The side and the effects come
 * from the contracts for each verb.
 *
 * A read is one resolution of its path. A reference that the resolution reaches and follows is a part of that read
 * (DEREF.COLLAPSE), not a separate read. The facts depend only on the document and the machine. Thus a host computes
 * them again only after an edit of the document or of the machine.
 *
 * @param machine - The world, the code and the hook `facts`.
 * @param doc - The document, as JSON.
 * @param options - The type of a bare root value, the verb and the volatile reads of the host.
 * @returns The facts.
 */
export function factsOf(machine: Machine, doc: unknown, options: FactsOptions = {}): DocFacts {
  const world = machine.world;
  const hook = machine.facts;
  const verb = options.verb ?? "eval";
  const reads: StaticRead[] = [];
  const effects: string[] = [];
  const above = new Map<DocVisit, Above>();
  let side: Side = "derive";
  let pure = true;
  let volatile = false;
  let size = 0;
  const note = (isPure: boolean | undefined, isVolatile: boolean | undefined): void => {
    if (isPure !== true) pure = false;
    if (isVolatile === true) volatile = true;
  };
  walk(
    world,
    doc,
    (v) => {
      size += 1;
      const up = v.parent === undefined ? undefined : above.get(v.parent);
      const lazy = up !== undefined && v.parent !== undefined && (up.lazy || partLazy(up, v.parent, v.slot));
      const kind = v.kind;
      if (kind === undefined) {
        // A kind that the world does not have gives #KIND?, and the walk does not visit its value.
        pure = false;
        above.set(v, { lazy, rules: undefined });
        return undefined;
      }
      const code = codeOf(world, v.declared ? undefined : v.doc.own, kind, verb, "eval");
      const answer = code.name === undefined ? undefined : hook?.(v.typePath ?? [], code.name);
      if (code.described) {
        note(answer?.pure ?? kind.pure, answer?.volatile ?? kind.volatile);
        above.set(v, { lazy, rules: answer?.lazy ?? kind.lazy });
      } else {
        // The contract of the kind does not describe this code. Only the hook can.
        note(answer?.pure, answer?.volatile);
        above.set(v, { lazy, rules: answer?.lazy ?? EACH });
      }
      if (kind.side === "run") side = "run";
      // check and effectsOf read the declared effects with the same function (D27).
      for (const keys of declaredEffects(v)) {
        const text = keys.join(".");
        if (!effects.includes(text)) effects.push(text);
      }
      if (!isRef(v.doc)) return undefined;
      const path = v.doc.value;
      const root = path[0];
      if (typeof root !== "string" || !(ROOTS as readonly string[]).includes(root)) return undefined;
      let exact = true;
      const keys: Key[] = [];
      for (let index = 1; index < path.length; index += 1) {
        const step = path[index];
        if (exact && isKey(step)) {
          keys.push(step);
          continue;
        }
        exact = false;
        // A step document runs the walker that the ladder finds for the verb step.
        const found = isEnvelope(step) ? lookupKind(world, step.type) : undefined;
        if (found?.ok !== true) {
          pure = false;
          continue;
        }
        const walker = codeOf(world, (step as { readonly own?: Readonly<Record<string, string>> }).own, found.kind, "step", "step");
        const stepAnswer = walker.name === undefined ? undefined : hook?.(found.path, walker.name);
        if (walker.described) note(stepAnswer?.pure ?? found.kind.pure, stepAnswer?.volatile ?? found.kind.volatile);
        else note(stepAnswer?.pure, stepAnswer?.volatile);
      }
      const first = path[1];
      // A reference to a name that a kind around it binds reads inside the document: it is not a read.
      if (root === "names" && isKey(first) && v.names.has(String(first))) return undefined;
      const read: StaticRead = { root: root as Root, keys, exact, lazy, address: v.address === true, path, place: v.place, at: v.at };
      reads.push(read);
      if (options.volatile?.(read) === true) volatile = true;
      return undefined;
    },
    options.declaredType === undefined ? {} : { declaredType: options.declaredType },
  );
  return { reads, side, effects, pure: pure && !volatile && effects.length === 0 && side === "derive", volatile, size };
}
