import { docEquals } from "./doc.ts";
import { type Result, fail, ok } from "./errors.ts";
import type { Context, Hop } from "./deref.ts";
import { type Machine, type Plan, type Read, keptAgain, readAgain, rootContext } from "./evaluate.ts";
import { Held } from "./formula.ts";
import { sameResult } from "./same.ts";

/*
 * The verifying trace of a schedule (R4 P3, D26). An evaluation with the option `reads` records each path that it
 * resolves, and what the path reached. A pure document is a function of its reads. Thus when each free read reaches
 * the same thing in a new context, the old result stays valid, and the schedule keeps it without an evaluation.
 */

/** The answer of `verifyReads`: the old result stays valid, or the first read that reaches another thing. */
export type ReadsCheck =
  | { readonly same: true }
  | {
      readonly same: false;
      /** The index of the first changed read in the list. */
      readonly index: number;
      /** The first changed read, as the evaluation recorded it. */
      readonly read: Read;
      /** What the path of that read reaches in the new context. */
      readonly now: Result;
      /**
       * `true` when the read reaches the same thing by `sameResult`, but the print of that thing changed
       * (READS.IN-PLACE). Only the option `prints` gives this mark.
       */
      readonly inPlace?: true;
    };

/** The options of `printReads` (READS.IN-PLACE, D112). */
export interface PrintOptions {
  /**
   * The most entries in the print of one value. Each value, each field name and each mark counts as one entry. A
   * larger value gets no print, and `verifyReads` then gives its read as changed. The default is 10000.
   */
  readonly limit?: number;
  /**
   * The stamp of the host for an object, for example the version of a host thing. A stamp other than `undefined`
   * takes the place of the fields of that object in the print. A stamp compares with `Object.is`.
   *
   * @param value - An object of the value of a read.
   * @returns The stamp, or `undefined` for the walk of the fields.
   */
  readonly stamp?: (value: object) => unknown;
}

/**
 * The prints of a list of reads, from `printReads`. `verifyReads` takes them with the option `prints`. The prints
 * keep their options, thus the verification walks each value with the same rules.
 */
export interface ReadPrints {
  /** The print of each read, at the index of the read. A read without an object in its value has no print. */
  readonly prints: readonly (readonly unknown[] | undefined)[];
  /** The options of the prints. */
  readonly options: PrintOptions;
}

/** The options of `verifyReads`. */
export interface VerifyOptions {
  /**
   * The rule of the host for two things, as in `sameResult`. It answers first, and `undefined` gives the rules of
   * `sameResult`. An example is a rule for a host thing that keeps a version.
   *
   * @param a - The thing of the recorded read.
   * @param b - The thing in the new context.
   * @returns `true` when the two things are the same, or `undefined` for the rules of `sameResult`.
   */
  readonly equal?: (a: unknown, b: unknown) => boolean | undefined;
  /**
   * The prints of the reads, from `printReads` after the evaluation (READS.IN-PLACE). When the prints are given, a
   * read that reaches the same thing also compares its print. Thus a change in place of a host value is a changed
   * read. Without the prints, the verification does no work for them.
   */
  readonly prints?: ReadPrints;
}

/** One answer serves each list whose reads are all the same. */
const SAME: ReadsCheck = /* @__PURE__ */ Object.freeze({ same: true });

/** The default limit of the entries in the print of one value. */
const PRINT_LIMIT = 10_000;

/** The marks of a print. Each mark is a private object, thus no value of a host is the same as a mark. */
const OBJECT = /* @__PURE__ */ Object.freeze({ mark: "object" });
const LIST = /* @__PURE__ */ Object.freeze({ mark: "list" });
const DATE = /* @__PURE__ */ Object.freeze({ mark: "date" });
const MAP = /* @__PURE__ */ Object.freeze({ mark: "map" });
const SET = /* @__PURE__ */ Object.freeze({ mark: "set" });
const SEEN = /* @__PURE__ */ Object.freeze({ mark: "seen" });
const STAMP = /* @__PURE__ */ Object.freeze({ mark: "stamp" });

/** The print of a value that the walk cannot finish: it is too large, or the host threw. It is not the same as any print. */
const NO_PRINT: readonly unknown[] = /* @__PURE__ */ Object.freeze([]);

/**
 * This function gives the print of a value: a flat list of its parts, in the order of a walk (D112). Two prints are
 * the same when they have the same length, and each entry is the same by `Object.is`.
 *
 * - An object starts with a mark and its prototype. A list adds its length, a date its time, and a map or a set
 *   its size and its entries. Then come the count of the own enumerable fields, each name and the kind of each field.
 * - A field with a getter gives the getter function. The walk does not start host code of a field.
 * - A primitive value and a function are entries. A function compares by its identity.
 * - An object that the walk already visited gives the mark `SEEN` and its number. Thus a cycle ends.
 * - A value with more than `limit` entries, or an exception of the host, gives `NO_PRINT`.
 *
 * @param value - The value of a read.
 * @param options - The limit and the stamp of the host.
 * @returns The print.
 */
function printOf(value: unknown, options: PrintOptions): readonly unknown[] {
  const limit = options.limit ?? PRINT_LIMIT;
  const stamp = options.stamp;
  const out: unknown[] = [];
  const ids = new Map<object, number>();
  const stack: unknown[] = [value];
  try {
    while (stack.length > 0) {
      if (out.length > limit) return NO_PRINT;
      const x = stack.pop();
      if (typeof x !== "object" || x === null) {
        out.push(x);
        continue;
      }
      const id = ids.get(x);
      if (id !== undefined) {
        out.push(SEEN, id);
        continue;
      }
      ids.set(x, ids.size);
      const stamped = stamp?.(x);
      if (stamped !== undefined) {
        out.push(STAMP, stamped);
        continue;
      }
      const children: unknown[] = [];
      out.push(OBJECT, Object.getPrototypeOf(x));
      if (Array.isArray(x)) out.push(LIST, x.length);
      else if (x instanceof Date) out.push(DATE, Date.prototype.getTime.call(x));
      else if (x instanceof Map) {
        out.push(MAP, x.size);
        if (out.length + 2 * x.size > limit) return NO_PRINT;
        for (const [key, item] of Map.prototype.entries.call(x) as IterableIterator<[unknown, unknown]>) children.push(key, item);
      } else if (x instanceof Set) {
        out.push(SET, x.size);
        if (out.length + x.size > limit) return NO_PRINT;
        for (const item of Set.prototype.values.call(x) as IterableIterator<unknown>) children.push(item);
      }
      const keys = Object.keys(x);
      if (out.length + 3 * keys.length > limit) return NO_PRINT;
      out.push(keys.length);
      for (const key of keys) {
        const field = Object.getOwnPropertyDescriptor(x, key);
        // A field that a proxy hides between `keys` and its descriptor reads as a field without a value.
        const data = field === undefined || "value" in field;
        out.push(key, data);
        children.push(field === undefined ? undefined : "value" in field ? field.value : field.get);
      }
      // The stack gives the last entry first, thus the children go on it in the reverse order.
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
    }
  } catch {
    return NO_PRINT;
  }
  return out.length > limit ? NO_PRINT : out;
}

/** This function tells if two prints are the same. `NO_PRINT` is not the same as any print, also not as itself. */
function samePrint(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a === NO_PRINT || b === NO_PRINT || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (!Object.is(a[index], b[index])) return false;
  return true;
}

/** This function gives the print of the value of a result, or `undefined` when the value holds no object. */
function printOfResult(result: Result, options: PrintOptions, cache: Map<object, readonly unknown[]>): readonly unknown[] | undefined {
  if (!result.ok || typeof result.value !== "object" || result.value === null) return undefined;
  const value = result.value;
  let print = cache.get(value);
  if (print === undefined) {
    print = printOf(value, options);
    cache.set(value, print);
  }
  return print;
}

/**
 * This function gives the prints of the values of a list of reads (READS.IN-PLACE, D112). A host starts it after
 * the evaluation, and it gives the prints to `verifyReads` with the option `prints`.
 *
 * - The print of a value walks its lists, its plain records and the own enumerable fields of each other object. A
 *   date adds its time, and a map or a set adds its entries.
 * - A read that is not free, a read that reached an error and a read with a primitive value get no print.
 * - A cycle ends, because the walk visits each object one time.
 * - A value with more entries than the limit gets no print. `verifyReads` then gives that read as changed.
 *
 * The walk does not see the state in a closure or a private field. It does not see a field with a symbol name, a
 * field that is not enumerable or the value of a getter. A host gives a stamp for such an object, for example its version.
 *
 * @param reads - The reads of the evaluation, from the option `reads`.
 * @param options - The limit and the stamp of the host.
 * @returns The prints, for the option `prints` of `verifyReads`.
 */
export function printReads(reads: readonly Read[], options: PrintOptions = {}): ReadPrints {
  const cache = new Map<object, readonly unknown[]>();
  const prints = reads.map((read) => (read.free ? printOfResult(read.reached, options, cache) : undefined));
  return { prints, options };
}

/** This function tells if the print of a read changed, when the read has a print. */
function changedInPlace(prints: ReadPrints, index: number, now: Result, cache: Map<object, readonly unknown[]>): boolean {
  const old = prints.prints[index];
  if (old === undefined) return false;
  const print = printOfResult(now, prints.options, cache);
  return print === undefined || !samePrint(old, print);
}

/** This function tells if two lists of hops are the same: the same steps, rungs and things, in order. */
function sameHops(a: readonly Hop[], b: readonly Hop[] | undefined, equal: VerifyOptions["equal"]): boolean {
  if (b === undefined || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] as Hop;
    const y = b[index] as Hop;
    if (x.by !== y.by || !docEquals(x.step, y.step) || !sameResult(ok(x.thing), ok(y.thing), equal)) return false;
  }
  return true;
}

/**
 * This function gives the error of a name that holds a held error and stops a longer path, or `undefined`. A
 * reference of the formula kit tests the binding of its first name before it resolves the rest of the path
 * (FORMULA.LET). The resolution of the whole path does not show that test.
 */
function heldStop(root: Context, path: readonly unknown[]): Result | undefined {
  const name = path[1];
  if (path.length <= 2 || path[0] !== "names" || typeof name !== "string" || !Object.hasOwn(root.names, name)) return undefined;
  const bound = root.names[name];
  return bound instanceof Held ? { ok: false, error: bound.error } : undefined;
}

/**
 * This function tells if an old result stays valid in a new context (READS.VERIFY, D26). It resolves the path of
 * each free read again, in the order of the list, and it compares what the path reaches with `sameResult`. It stops at
 * the first read that reaches another thing, and it gives that read (READS.CHANGED).
 *
 * - A read that is not free reads a binding that a kind made from earlier reads, for example a name of `let`. The
 *   function does not resolve it again.
 * - A thing compares as in `sameResult`. Thus a host thing or a date is the same only as itself. A host gives a new
 *   object for a new state, or the option `equal`.
 * - A longer path through a name that holds a `Held` in the new context is a changed read. A reference of the formula
 *   kit gives the error of that binding, and the resolution of the path does not show it.
 * - The answer is sound only for a pure document (FACTS.PURE). A document with an effect, a volatile operation or an
 *   extension of a profile can read outside `resolve`. The schedule asks `factsOf` first.
 *
 * The values of the context must not change in place, as PLAN.CACHE says for the documents. A value that changed in
 * place is the same object, thus `sameResult` cannot see the change. The option `prints` finds such a change
 * (READS.IN-PLACE). The prints come from `printReads` after the evaluation, and the answer then has the mark `inPlace`.
 *
 * @param target - The machine of the evaluation, or its plan.
 * @param reads - The reads of the evaluation, from the option `reads`.
 * @param context - The new context.
 * @param options - The rule of the host for two things, and the prints of the reads.
 * @returns `{ same: true }` when each free read reaches the same thing, or else the first changed read.
 */
export function verifyReads(target: Machine | Plan, reads: readonly Read[], context: Context, options: VerifyOptions = {}): ReadsCheck {
  const machine = "evaluators" in target ? target : target.machine;
  const root = rootContext(machine, context);
  const equal = options.equal;
  const prints = options.prints;
  // The prints of the new values, made only with the option `prints`. Two reads of one object share its print.
  let printed: Map<object, readonly unknown[]> | undefined;
  for (let index = 0; index < reads.length; index += 1) {
    const read = reads[index] as Read;
    if (!read.free) continue;
    const stop = heldStop(root, read.path);
    if (stop !== undefined) return { same: false, index, read, now: stop };
    if (read.kept === true) {
      // A kept read does not step into a host thing with `deref`. A host thing with `known` answers its step (SCHED.CLOSURE).
      const now = keptAgain(machine, root, read.path);
      if (now === undefined) return { same: false, index, read, now: fail("#N/A", "The host does not know the value of the kept read yet.") };
      if (!sameResult(read.reached, now, equal)) return { same: false, index, read, now };
      if (prints !== undefined && changedInPlace(prints, index, now, (printed ??= new Map()))) return { same: false, index, read, now, inPlace: true };
      continue;
    }
    const asked = read.hops !== undefined;
    const now = readAgain(machine, root, read.path, asked);
    if (!sameResult(read.reached, now.reached, equal) || (read.hops !== undefined && !sameHops(read.hops, now.hops, equal))) {
      return { same: false, index, read, now: now.reached };
    }
    if (prints !== undefined && changedInPlace(prints, index, now.reached, (printed ??= new Map()))) {
      return { same: false, index, read, now: now.reached, inPlace: true };
    }
  }
  return SAME;
}
