import type { Key } from "./doc.ts";

/** The codes that the kernel gives. */
export type KernelCode =
  | "#KIND?"
  | "#NOEVAL"
  | "#PART?"
  | "#NAME?"
  | "#REF!"
  | "#N/A"
  | "#CYCLE!"
  | "#STEP?"
  | "#VALUE!"
  | "#NUM!"
  | "#ARGS"
  | "#CAP!"
  | "#CALC!"
  | "#DEPTH!"
  | "#ABORT"
  | "#REPLAY!"
  | "#TYPE!";

/** The code of an error value. A language can add its own codes. Each code starts with `#`. */
export type ErrorCode = KernelCode | `#${string}`;

/**
 * An error value: a code and a reason. An evaluation gives an error value, and it does not throw.
 *
 * - `place`: the keys from the root document to the document that failed.
 * - `cause`: the error of the host that caused this error, for example the exception of an effect.
 */
export interface EvalError {
  readonly code: ErrorCode;
  readonly reason: string;
  readonly place?: readonly Key[];
  readonly cause?: unknown;
}

/** The result of an evaluation: a value, or an error value. A value can be any value of the host. */
export type Result<V = unknown> = { readonly ok: true; readonly value: V } | { readonly ok: false; readonly error: EvalError };

/** A result with an error value. */
export type Failed = { readonly ok: false; readonly error: EvalError };

/**
 * This function makes a result with a value.
 *
 * @param value - The value.
 * @returns The result.
 */
export function ok<V>(value: V): Result<V> {
  return { ok: true, value };
}

/**
 * This function makes a result with an error value.
 *
 * @param code - The code of the error.
 * @param reason - One sentence that tells the cause.
 * @param more - The place and the cause of the error, when they are known.
 * @returns The result.
 */
export function fail(code: ErrorCode, reason: string, more: { readonly place?: readonly Key[]; readonly cause?: unknown } = {}): Failed {
  return {
    ok: false,
    error: { code, reason, ...(more.place === undefined ? {} : { place: more.place }), ...(more.cause === undefined ? {} : { cause: more.cause }) },
  };
}

/**
 * This function gives a failed result its place, when it has none. A result with a value, or an error with a
 * place, stays the same object.
 *
 * @param result - The result.
 * @param place - The keys from the root document to the document that failed.
 * @returns The result with a place.
 */
export function placed<V>(result: Result<V>, place: readonly Key[]): Result<V> {
  if (result.ok || result.error.place !== undefined) return result;
  return { ok: false, error: { ...result.error, place } };
}

/**
 * An exception that carries an error value through code of the host. A closure of a formula throws it when the
 * host calls the closure and the closure fails. The kernel catches it and gives its error value again.
 */
export class Failure extends Error {
  readonly error: EvalError;

  /**
   * This constructor makes the exception.
   *
   * @param error - The error value that the exception carries.
   */
  constructor(error: EvalError) {
    super(`${error.code} ${error.reason}`);
    this.name = "Failure";
    this.error = error;
  }
}

/**
 * This function tells if an exception is the overflow of the stack of the host.
 *
 * @param error - The exception.
 * @returns `true` for a stack overflow.
 */
export function isStackOverflow(error: unknown): boolean {
  try {
    // A regular expression that compiles near the limit of the stack throws a SyntaxError with the same message.
    // Thus the test reads the message with includes, and it accepts a SyntaxError.
    return (error instanceof RangeError || error instanceof SyntaxError) && error.message.includes("call stack");
  } catch {
    // Near the limit of the stack, the test itself can overflow.
    return true;
  }
}

/**
 * This function changes an exception into an error value. A `Failure` gives its error value. A stack overflow
 * gives `#DEPTH!`. Each other exception gives `#CALC!`, with the exception as the cause.
 *
 * @param error - The exception.
 * @param who - A short text that names the code that threw, for example `the evaluator math.add`.
 * @returns The failed result.
 */
export function thrown(error: unknown, who: string): Failed {
  if (error instanceof Failure) return { ok: false, error: error.error };
  if (isStackOverflow(error)) return fail("#DEPTH!", `The nesting of ${who} is too deep for the stack of the host.`, { cause: error });
  return fail("#CALC!", `${upper(who)} threw: ${describe(error)}`, { cause: error });
}

function upper(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}

/**
 * This function gives a short text for an exception or any value. It does not throw.
 *
 * @param value - The value.
 * @returns The text.
 */
export function describe(value: unknown): string {
  try {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    return String(value);
  } catch {
    return "(a value without a text)";
  }
}
