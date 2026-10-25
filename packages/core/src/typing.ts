import { type Envelope, type Key, typeName } from "./doc.ts";
import type { Machine } from "./evaluate.ts";
import type { DocVisit, Issue } from "./static.ts";
import { type ValueType, fits, isUnknown, typeIssues, typeText } from "./types.ts";

/*
 * The check of value types (R5 P3, D25). The pass reads the documents that the walk of `check` visited. It goes down
 * to give each part the type that its position needs, and it goes up to synthesize the type of each document from the
 * types of its parts. A type issue is a static finding: it does not change an evaluation.
 */

/** What a type rule gets for one document. */
export interface TypeInput {
  /** The keys of the kind of the document, after each alias. */
  readonly typePath: readonly Key[];
  /** The document. A bare value has the type that its position declares. */
  readonly doc: Envelope;
  /** The type that the position of the document needs. It is `unknown` when the position needs no type. */
  readonly expected: ValueType;
  /** The paths of the parts in the value, in the order of the value. */
  readonly paths: readonly (readonly Key[])[];
  /** `true` when the position declares an address. A reference there gives a thing, not a value. */
  readonly address: boolean;
  readonly machine: Machine;
  /**
   * This function gives the type of a part that the check typed before. It gives `unknown` for a part that the check
   * did not type yet, and for a part with an issue.
   *
   * @param path - The path of the part in the value.
   * @returns The type of the part.
   */
  typeOf(path: readonly Key[]): ValueType;
  /**
   * This function gives the type of a name that a kind around the document binds. A name of the host has no type.
   *
   * @param name - The name.
   * @returns The type, or `undefined` when no kind around the document gives the name a type.
   */
  nameType(name: string): ValueType | undefined;
  /**
   * This function examines a value type of a contract with `typeIssues`, one time in a check. The first problem of a
   * type becomes an issue at the document. A term with a problem reads as `unknown`.
   *
   * @param type - The value type of the contract.
   * @param what - What the type is, for the reason, for example "the result of ops.add".
   * @returns The type.
   */
  contract(type: unknown, what: string): ValueType;
}

/** What a type rule tells for one part: the type that the part must have, and the types of the names of the part. */
export interface PartType {
  /** The type that the part must have. */
  readonly expect?: ValueType;
  /** What the part is, for the reason of an issue, for example "argument 2 of ops.add". */
  readonly what?: string;
  /** The types of the names that the scope rules of the kind bind for the part. Each other name of the rules gets `unknown`. */
  readonly names?: Readonly<Record<string, ValueType>>;
}

/** A problem that a type rule finds. Its place is a part of the document, or the document itself. */
export interface TypeProblem {
  /** The path of the part in the value. Without it, the problem is at the document. */
  readonly path?: readonly Key[];
  readonly reason: string;
  readonly expected?: ValueType;
  readonly found?: ValueType;
}

/**
 * The type rule of an evaluator: what a check of types knows about the values that the evaluator gives. An evaluator
 * object holds its rule in its field `type`. Thus the rule follows the evaluator that the ladder gives a document
 * (TYPE.RULE).
 */
export interface TypeRule {
  /**
   * This function tells the type that a part must have, and the types of the names for the part. The check asks it
   * before it types the part. The parts that give the names of a rule `keysAt` come first.
   *
   * @param input - The document, the type that its position needs, and the types of the parts before.
   * @param path - The path of the part in the value.
   * @returns The type of the part and the types of its names.
   */
  readonly part?: (input: TypeInput, path: readonly Key[]) => PartType;
  /**
   * This function synthesizes the type of the document from the types of its parts. It must be sound: each value that
   * the evaluator gives is a member of the type.
   *
   * @param input - The document, the type that its position needs, and the types of its parts.
   * @param report - The function that gets each problem that the rule finds.
   * @returns The type of the document.
   */
  readonly synth: (input: TypeInput, report: (problem: TypeProblem) => void) => ValueType;
}

/** The type of one document of a check of types. */
export interface Typed {
  /** The keys from the root document to the document. */
  readonly place: readonly Key[];
  /** The keys from the root JSON value to the document. */
  readonly at: readonly Key[];
  /** The type that the check synthesized. A document with an issue has the type `unknown`. */
  readonly type: ValueType;
  /** The type that the position of the document needs, when it needs one. */
  readonly expected?: ValueType;
}

/** One document that the walk of a check visited, with what the pass of types needs. The package does not export it. */
export interface TypeNode {
  readonly visit: DocVisit;
  /** The names that the scope rules of the parent bind for this document. */
  readonly bound: readonly string[];
  /** The type that the shape of the parent declares for this part. */
  readonly expect: ValueType | undefined;
  /** The indices of the parts that the walk visited, in the order of the value. */
  readonly children: number[];
  /** The evaluator name that the ladder gives for the verb of the check. */
  evaluator: string | undefined;
  /** `true` when the check found an issue at this document. Then its type is `unknown`. */
  marked: boolean;
}

/** The result of the pass of types. */
export interface TypePass {
  readonly type: ValueType;
  readonly issues: readonly Issue[];
  readonly places: readonly Typed[];
}

/** A type that a position needs, and what the position is. */
interface Need {
  readonly type: ValueType;
  readonly what: string;
}

/** One document on the stack of the pass. */
interface Frame {
  readonly index: number;
  readonly rule: TypeRule | undefined;
  readonly input: TypeInput;
  readonly order: readonly number[];
  next: number;
  readonly typed: Map<string, ValueType>;
  readonly needs: readonly Need[];
  readonly names: ReadonlyMap<string, ValueType>;
}

const NO_NAMES: ReadonlyMap<string, ValueType> = /* @__PURE__ */ new Map();

function pathKey(path: readonly Key[]): string {
  return JSON.stringify(path.map(String));
}

/** This function gives the type rule of an evaluator name. A runner hides the evaluator of its name, and a runner has no rule yet (K29). */
function ruleOf(machine: Machine, name: string | undefined): TypeRule | undefined {
  if (name === undefined || (machine.runners !== undefined && Object.hasOwn(machine.runners, name))) return undefined;
  const evaluator = Object.hasOwn(machine.evaluators, name) ? machine.evaluators[name] : undefined;
  const rule = typeof evaluator === "object" && evaluator !== null ? (evaluator as { readonly type?: unknown }).type : undefined;
  return typeof rule === "object" && rule !== null && typeof (rule as TypeRule).synth === "function" ? (rule as TypeRule) : undefined;
}

/** This function gives the order of the parts of a document: first the parts that give the names of a rule `keysAt`. */
function orderOf(node: TypeNode, nodes: readonly TypeNode[]): readonly number[] {
  const sources = (node.visit.kind?.scope ?? []).flatMap((rule) => ("keysAt" in rule.names ? [rule.names.keysAt] : []));
  if (sources.length === 0 || node.children.length < 2) return node.children;
  const gives = (index: number): boolean => {
    const slot = (nodes[index] as TypeNode).visit.slot;
    return sources.some((prefix) => prefix.length <= slot.length && prefix.every((key, at) => String(key) === String(slot[at])));
  };
  return [...node.children.filter(gives), ...node.children.filter((index) => !gives(index))];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * This function checks the value types of the documents that the walk of a check visited (TYPE.CHECK). The walk gives
 * the documents in the order of the document. The pass uses its own stack, thus a deep document cannot overflow the
 * stack of the host.
 *
 * @param machine - The machine of the check.
 * @param nodes - The documents, in the order of the document. The root is the first.
 * @param verb - The verb of the check. The value types of a contract describe the verb `eval` only.
 * @param expect - The type that the root must have.
 * @returns The type of the root, the type issues in the order of the document, and the type of each document.
 */
export function typePass(machine: Machine, nodes: readonly TypeNode[], verb: string, expect: ValueType | undefined): TypePass {
  if (nodes.length === 0) return { type: "unknown", issues: [], places: [] };
  const domains = machine.domains;
  const contracts = verb === "eval";
  const found: { readonly index: number; readonly issue: Issue }[] = [];
  const types = new Array<ValueType>(nodes.length);
  const needed = new Array<ValueType | undefined>(nodes.length);
  const seen = new Set<unknown>();

  const issueAt = (index: number, problem: TypeProblem): void => {
    const visit = (nodes[index] as TypeNode).visit;
    const issue: Issue = {
      code: "#TYPE!",
      place: visit.place,
      reason: problem.reason,
      at: visit.at,
      ...(problem.expected === undefined ? {} : { expected: problem.expected }),
      ...(problem.found === undefined ? {} : { found: problem.found }),
    };
    found.push({ index, issue });
  };

  const contract = (index: number, type: unknown, what: string): ValueType => {
    if (!seen.has(type)) {
      seen.add(type);
      const problem = typeIssues(type, domains)[0];
      if (problem !== undefined) issueAt(index, { reason: `The ${what} is not a correct value type. ${problem.reason}` });
    }
    return type as ValueType;
  };

  const enter = (index: number, needs: readonly Need[], names: ReadonlyMap<string, ValueType>): Frame => {
    const node = nodes[index] as TypeNode;
    const visit = node.visit;
    const typed = new Map<string, ValueType>();
    const input: TypeInput = {
      typePath: visit.typePath ?? [],
      doc: visit.doc,
      // The need of the rule of the parent comes last. It is the type that the rule of this document reads.
      expected: needs.length === 0 ? "unknown" : (needs[needs.length - 1] as Need).type,
      paths: node.children.map((child) => (nodes[child] as TypeNode).visit.slot),
      address: visit.address === true,
      machine,
      typeOf: (path) => typed.get(pathKey(path)) ?? "unknown",
      nameType: (name) => names.get(name),
      contract: (type, what) => contract(index, type, what),
    };
    return { index, rule: node.marked ? undefined : ruleOf(machine, node.evaluator), input, order: orderOf(node, nodes), next: 0, typed, needs, names };
  };

  const ruleFailed = (frame: Frame, error: unknown): void => {
    issueAt(frame.index, { reason: `The type rule of ${(nodes[frame.index] as TypeNode).evaluator ?? "the evaluator"} fails: ${message(error)}` });
  };

  const report = (frame: Frame, problem: TypeProblem): void => {
    const node = nodes[frame.index] as TypeNode;
    const key = problem.path === undefined ? undefined : pathKey(problem.path);
    const part = key === undefined ? undefined : node.children.find((child) => pathKey((nodes[child] as TypeNode).visit.slot) === key);
    issueAt(part ?? frame.index, problem);
  };

  const rootNeeds: Need[] = expect === undefined || isUnknown(contract(0, expect, "expected type of the check"), domains) ? [] : [{ type: expect, what: "document" }];
  const stack: Frame[] = [enter(0, rootNeeds, NO_NAMES)];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1] as Frame;
    if (frame.next < frame.order.length) {
      const child = frame.order[frame.next] as number;
      frame.next += 1;
      const node = nodes[child] as TypeNode;
      const slot = node.visit.slot;
      const what = `part ${slot.join(".")} of ${typeName((nodes[frame.index] as TypeNode).visit.doc.type)}`;
      let part: PartType = {};
      if (frame.rule?.part !== undefined) {
        try {
          part = frame.rule.part(frame.input, slot) ?? {};
        } catch (error) {
          ruleFailed(frame, error);
        }
      }
      const needs: Need[] = [];
      // A need of the type `unknown` needs nothing, thus the pass leaves it out.
      const need = (type: ValueType, text: string): void => {
        if (!isUnknown(type, domains)) needs.push({ type, what: text });
      };
      if (contracts && node.expect !== undefined) need(contract(child, node.expect, `expected type of the ${what}`), what);
      if (part.expect !== undefined) need(part.expect, part.what ?? what);
      let names = frame.names;
      if (node.bound.length > 0) {
        // Each name that the scope rules bind hides the name around it. A name without a type from the rule gets `unknown`.
        const copy = new Map(names);
        for (const name of node.bound) copy.set(name, part.names !== undefined && Object.hasOwn(part.names, name) ? (part.names[name] as ValueType) : "unknown");
        names = copy;
      }
      stack.push(enter(child, needs, names));
      continue;
    }
    stack.pop();
    const node = nodes[frame.index] as TypeNode;
    let type: ValueType = "unknown";
    if (!node.marked) {
      let synthesized: ValueType = "unknown";
      if (frame.rule !== undefined) {
        try {
          synthesized = frame.rule.synth(frame.input, (problem) => report(frame, problem));
        } catch (error) {
          ruleFailed(frame, error);
        }
      }
      const result = contracts ? node.visit.kind?.result : undefined;
      type = result === undefined ? synthesized : contract(frame.index, result, `result of the kind ${typeName(node.visit.doc.type)}`);
    }
    for (const need of frame.needs) {
      if (fits(type, need.type, domains)) continue;
      issueAt(frame.index, { reason: `The ${need.what} has the type ${typeText(type)}. It must have the type ${typeText(need.type)}.`, expected: need.type, found: type });
      // A part with an issue gets the type `unknown`, thus one problem does not give a chain of issues.
      type = "unknown";
      break;
    }
    types[frame.index] = type;
    needed[frame.index] = frame.needs.length === 0 ? undefined : (frame.needs[frame.needs.length - 1] as Need).type;
    stack[stack.length - 1]?.typed.set(pathKey(node.visit.slot), type);
  }

  const places = nodes.map((node, index) => {
    const want = needed[index];
    const entry = { type: types[index] ?? "unknown", ...(want === undefined ? {} : { expected: want }) } as Typed;
    // The keys of a place are made only when a reader asks for them, as a visit does.
    Object.defineProperty(entry, "place", { enumerable: true, get: () => node.visit.place });
    Object.defineProperty(entry, "at", { enumerable: true, get: () => node.visit.at });
    return entry;
  });
  const issues = found.sort((a, b) => a.index - b.index).map((item) => item.issue);
  return { type: types[0] ?? "unknown", issues, places };
}
