import { type Key, docEquals, equalWith } from "./doc.ts";
import type { EvalError, Result } from "./errors.ts";
import { Held } from "./formula.ts";

/**
 * This function tells if two results are the same for an early cutoff (RESULT.SAME). A schedule uses it to stop the
 * work when a part that evaluates again gives the same result. A wrong `true` keeps a stale value, but a wrong `false`
 * only costs work. Thus each rule gives `false` when it is not sure.
 *
 * - Two values compare by the rules of `docEquals`. Lists and plain records compare by their items and fields. Each
 *   other value compares with `Object.is`.
 * - Thus `-0` is not `0`, and `NaN` is `NaN`. A date, a map and a closure of `fn` are the same only as themselves.
 * - Two errors are the same when they have the same code, reason and place (RESULT.SAME-ERROR). The cause is not
 *   compared. A `Held` value compares its error by the same rule.
 * - A value and an error are not the same.
 *
 * `sameValue` of `agree` uses the same walk, with rules for two tiers (D20). It compares two closures by their
 * parameters, and two errors by their code and place.
 *
 * @param a - The earlier result.
 * @param b - The new result.
 * @param equal - The rule of the host for two values, for example two dates. It answers first, and `undefined` gives the rules above.
 * @returns `true` when the results are the same.
 */
export function sameResult(a: Result<unknown>, b: Result<unknown>, equal?: (a: unknown, b: unknown) => boolean | undefined): boolean {
  if (a.ok && b.ok) return equalWith(a.value, b.value, equal === undefined ? sameHeld : (x, y) => equal(x, y) ?? sameHeld(x, y));
  if (!a.ok && !b.ok) return sameError(a.error, b.error);
  return false;
}

/** The rule of `sameResult` for held errors. Two `Held` values are the same when their errors are the same. */
function sameHeld(x: unknown, y: unknown): boolean | undefined {
  if (x instanceof Held || y instanceof Held) return x instanceof Held && y instanceof Held && sameError(x.error, y.error);
  return undefined;
}

/** Two errors are the same when they have the same code, reason and place. An error without a place has no place in both. */
function sameError(a: EvalError, b: EvalError): boolean {
  if (a.code !== b.code || a.reason !== b.reason) return false;
  if (a.place === undefined || b.place === undefined) return a.place === b.place;
  return docEquals(a.place as readonly Key[], b.place as readonly Key[]);
}
