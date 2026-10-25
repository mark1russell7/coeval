import type { Context } from "./deref.ts";
import type { Result } from "./errors.ts";
import { type Machine, type Plan, type PrepareOptions, type Read, prepare } from "./evaluate.ts";
import { type DocFacts, type FactsOptions, factsOf } from "./facts.ts";
import { type VerifyOptions, verifyReads } from "./reads.ts";

/*
 * Two levels of durability (R4 P7, D30). The plan and the facts of a document depend only on the structure: the
 * machine and the documents. A result also depends on the data: the values that a context gives. A host keeps one
 * epoch for each level. Thus a change of data keeps each plan and each fact, and it only verifies or evaluates.
 */

/** The two epochs of a host (DURABLE.EPOCHS). Each epoch counts the changes of its level. */
export interface Epochs {
  /** The count of the changes of the structure: a new machine, or an edit of a document. */
  readonly structure: number;
  /** The count of the changes of the data. A change of the structure is also a change of the data. */
  readonly data: number;
}

/** The work of a durable cache since its start. A schedule reads it as a measure, not as a rule (R4). */
export interface DurableCounts {
  /** The compilations: the calls of `prepare`. */
  readonly compiles: number;
  /** The calls of `factsOf`. */
  readonly facts: number;
  /** The evaluations of a plan. */
  readonly evaluations: number;
  /** The calls of `verifyReads`. */
  readonly verifications: number;
  /** The results that stayed without an evaluation. */
  readonly reuses: number;
}

/** The options of `durable`. */
export interface DurableOptions {
  /** The type of a bare root value, for each plan and each fact. */
  readonly declaredType?: string;
  /** The verb of each plan and each fact. The default is `eval` (VERB.PREPARE). */
  readonly verb?: string;
  /** The volatile reads of the host, as in `factsOf`. A document with such a read is not pure, thus it evaluates again after each change of data. */
  readonly volatile?: FactsOptions["volatile"];
  /** The rule of the host for two things, as in `verifyReads`. */
  readonly equal?: VerifyOptions["equal"];
}

/**
 * A cache of plans, facts and results with two levels of durability (D30). A host or a schedule tells the cache each
 * change of the structure and each change of the data.
 */
export interface Durable {
  /** The machine of the current structure epoch. */
  readonly machine: Machine;
  /** The current epochs. A schedule builds again what depends on the whole structure when `structure` changes, for example a graph of the nodes. */
  readonly epochs: Epochs;
  /** The work since the start. */
  readonly counts: DurableCounts;
  /**
   * This function gives the plan of a document. A document object compiles one time for a machine (DURABLE.STRUCTURE).
   * A change of data compiles nothing (DURABLE.DATA).
   *
   * @param doc - The document, as JSON.
   * @returns The plan.
   */
  plan(doc: unknown): Plan;
  /**
   * This function gives the static facts of a document. A document object computes its facts one time for a machine.
   *
   * @param doc - The document, as JSON.
   * @returns The facts.
   */
  facts(doc: unknown): DocFacts;
  /**
   * This function gives the result of the document of a node (DURABLE.REUSE). The key names the node, and in one data
   * epoch the context of a key gives the same data.
   *
   * - In the data epoch of its result, a key with the same plan gives that result again.
   * - After a change of data, a pure document verifies its reads, and it keeps its result when each read is the same.
   * - Each other document evaluates again.
   *
   * @param key - The name of the node in the host, for example the name of a cell.
   * @param doc - The document of the node.
   * @param context - The context of the node.
   * @returns The result.
   */
  evaluate(key: unknown, doc: unknown, context: Context): Result;
  /** This function tells the cache that the data changed: a context gives a new value (DURABLE.EPOCHS). */
  changeData(): void;
  /**
   * This function tells the cache that the structure changed (DURABLE.EPOCHS). An edit of a document gives a new
   * document object, and only that object compiles. A new machine drops each plan, each fact and each result.
   *
   * @param machine - The new machine, or `undefined` for an edit of a document.
   */
  changeStructure(machine?: Machine): void;
  /**
   * This function drops the result of a node, for example a node that the host removed.
   *
   * @param key - The name of the node.
   */
  forget(key: unknown): void;
}

/** The result of one node, with what it depends on. */
interface Entry {
  /** The plan of the evaluation. A new document or a new machine gives another plan. */
  readonly plan: Plan;
  readonly result: Result;
  /** The reads of the evaluation, only for a pure document. */
  readonly reads: readonly Read[] | undefined;
  /** The data epoch in which the result was last valid. */
  data: number;
}

/** The most values that a cache of value documents keeps, as in `planner`. */
const MAX_VALUES = 1000;

/** No reads. One frozen list serves each result of a pure document without reads. */
const NO_READS: readonly Read[] = /* @__PURE__ */ Object.freeze([]);

/** The key of the document `-0` in a cache of value documents. A `Map` finds the entry of `0` for `-0`. */
const NEGATIVE_ZERO = /* @__PURE__ */ Symbol("coeval.negative-zero");

/** This function makes a cache by document. A document object gives its value one time, as PLAN.CACHE says. */
function byDocument<T>(make: (doc: unknown) => T): (doc: unknown) => T {
  const objects = new WeakMap<object, T>();
  const values = new Map<unknown, T>();
  return (doc) => {
    if (typeof doc === "object" && doc !== null) {
      if (objects.has(doc)) return objects.get(doc) as T;
      const made = make(doc);
      objects.set(doc, made);
      return made;
    }
    const key = Object.is(doc, -0) ? NEGATIVE_ZERO : doc;
    if (values.has(key)) return values.get(key) as T;
    const made = make(doc);
    if (values.size >= MAX_VALUES) values.clear();
    values.set(key, made);
    return made;
  };
}

/**
 * This function makes a cache with two levels of durability for a host or a schedule (R4 P7, D30). The structure is
 * the machine and the documents. The data is each value that a context gives: the names, `self`, `event`, the
 * capabilities and the world of the host.
 *
 * - A plan and the facts depend only on the structure. A document object compiles one time for a machine, thus a
 *   change of data compiles nothing (DURABLE.DATA).
 * - A result depends on the data too. It stays in its data epoch. After a change of data, a pure document verifies
 *   its reads with `verifyReads`, and each other document evaluates again.
 * - An edit gives a new document object, thus only that document compiles. A new machine drops each plan, each fact
 *   and each result (DURABLE.STRUCTURE).
 *
 * The host keeps two promises. In one data epoch, the context of a key gives the same data. The values of a
 * context and the documents do not change in place, as PLAN.CACHE and `verifyReads` say.
 *
 * @param machine - The machine of the first structure epoch.
 * @param options - The type of a bare root value, the verb, the volatile reads and the rule of the host for two things.
 * @returns The cache.
 */
export function durable(machine: Machine, options: DurableOptions = {}): Durable {
  const prepareOptions: PrepareOptions = {
    ...(options.declaredType === undefined ? {} : { declaredType: options.declaredType }),
    ...(options.verb === undefined ? {} : { verb: options.verb }),
  };
  const factsOptions: FactsOptions = { ...prepareOptions, ...(options.volatile === undefined ? {} : { volatile: options.volatile }) };
  const verifyOptions: VerifyOptions = options.equal === undefined ? {} : { equal: options.equal };
  const counts = { compiles: 0, facts: 0, evaluations: 0, verifications: 0, reuses: 0 };
  const results = new Map<unknown, Entry>();
  let current = machine;
  let epochs: Epochs = { structure: 0, data: 0 };
  const plansOf = (m: Machine): ((doc: unknown) => Plan) =>
    byDocument((doc) => {
      counts.compiles += 1;
      return prepare(m, doc, prepareOptions);
    });
  const factsFor = (m: Machine): ((doc: unknown) => DocFacts) =>
    byDocument((doc) => {
      counts.facts += 1;
      return factsOf(m, doc, factsOptions);
    });
  let plans = plansOf(machine);
  let facts = factsFor(machine);
  return {
    get machine() {
      return current;
    },
    get epochs() {
      return epochs;
    },
    get counts() {
      return { ...counts };
    },
    plan: (doc) => plans(doc),
    facts: (doc) => facts(doc),
    evaluate(key, doc, context) {
      const plan = plans(doc);
      const entry = results.get(key);
      if (entry !== undefined && entry.plan === plan) {
        if (entry.data === epochs.data) {
          counts.reuses += 1;
          return entry.result;
        }
        if (entry.reads !== undefined) {
          counts.verifications += 1;
          if (verifyReads(plan, entry.reads, context, verifyOptions).same) {
            entry.data = epochs.data;
            counts.reuses += 1;
            return entry.result;
          }
        }
      }
      // Only a pure document is a function of its reads (FACTS.PURE), thus only its reads can keep its result.
      const reads: Read[] | undefined = facts(doc).pure ? [] : undefined;
      counts.evaluations += 1;
      const result = plan.evaluate(context, reads === undefined ? undefined : { reads });
      // A list that grows by push keeps room for more reads. A copy of a short list is smaller (PLAN.LEAN).
      results.set(key, { plan, result, reads: reads === undefined ? undefined : reads.length === 0 ? NO_READS : reads.slice(), data: epochs.data });
      return result;
    },
    changeData() {
      epochs = { structure: epochs.structure, data: epochs.data + 1 };
    },
    changeStructure(next) {
      epochs = { structure: epochs.structure + 1, data: epochs.data + 1 };
      if (next === undefined || next === current) return;
      current = next;
      plans = plansOf(next);
      facts = factsFor(next);
      results.clear();
    },
    forget(key) {
      results.delete(key);
    },
  };
}
