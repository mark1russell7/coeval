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
    };

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
}

/** One answer serves each list whose reads are all the same. */
const SAME: ReadsCheck = /* @__PURE__ */ Object.freeze({ same: true });

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
 * place is the same object, thus the function cannot see the change.
 *
 * @param target - The machine of the evaluation, or its plan.
 * @param reads - The reads of the evaluation, from the option `reads`.
 * @param context - The new context.
 * @param options - The rule of the host for two things.
 * @returns `{ same: true }` when each free read reaches the same thing, or else the first changed read.
 */
export function verifyReads(target: Machine | Plan, reads: readonly Read[], context: Context, options: VerifyOptions = {}): ReadsCheck {
  const machine = "evaluators" in target ? target : target.machine;
  const root = rootContext(machine, context);
  const equal = options.equal;
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
      continue;
    }
    const asked = read.hops !== undefined;
    const now = readAgain(machine, root, read.path, asked);
    if (!sameResult(read.reached, now.reached, equal) || (read.hops !== undefined && !sameHops(read.hops, now.hops, equal))) {
      return { same: false, index, read, now: now.reached };
    }
  }
  return SAME;
}
