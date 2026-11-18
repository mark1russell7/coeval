import { docEquals } from "./doc.ts";
import { Failure, fail } from "./errors.ts";
import type { LazyOp, OpFn, Signature } from "./formula.ts";

/**
 * The standard table of operations of the formula kit (D219). Each table is a plain record, thus a language can
 * spread each table into its own profile and add its own operations.
 *
 * - `ops`: the operations of the namespace `ops`.
 * - `lazy`: the operations that evaluate their arguments themselves.
 * - `sigs`: the signature of each operation, for a check of types.
 * - `pure`: the name of each operation of the table. Each one is pure.
 */
export interface StdOps {
  readonly ops: Readonly<Record<string, OpFn>>;
  readonly lazy: Readonly<Record<string, LazyOp>>;
  readonly sigs: Readonly<Record<string, Signature | readonly Signature[]>>;
  readonly pure: readonly string[];
}

/** This function gives the text of the shape of a value, for the reason of an error. */
function shapeText(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "string") return "a text";
  if (typeof value === "boolean") return "a truth value";
  return `a ${typeof value === "object" ? "record" : typeof value}`;
}

/** This function throws `#ARGS` when an operation gets a different count of arguments. */
function arity(op: string, args: readonly unknown[], count: number): void {
  if (args.length !== count) throw new Failure({ code: "#ARGS", reason: `The operation ${op} takes ${count} argument${count === 1 ? "" : "s"}, and it got ${args.length}.` });
}

/** This function throws `#VALUE!` for an argument of the wrong shape. */
function refuse(op: string, want: string, args: readonly unknown[]): never {
  throw new Failure({ code: "#VALUE!", reason: `The operation ${op} takes ${want}, and it got ${args.map(shapeText).join(" and ")}.` });
}

/**
 * This function applies an operation on numbers. A result `NaN`, or an infinite result of finite arguments, gives
 * `#NUM!` (STDOPS.NUM).
 */
function arithmetic(op: string, args: readonly unknown[], count: number, apply: (...values: number[]) => number): number {
  arity(op, args, count);
  if (!args.every((value) => typeof value === "number")) refuse(op, count === 1 ? "a number" : "numbers", args);
  const values = args as number[];
  const result = apply(...values);
  if (Number.isNaN(result) || (!Number.isFinite(result) && values.every(Number.isFinite))) {
    throw new Failure({ code: "#NUM!", reason: `The result of the operation ${op} is ${String(result)}. A result must not be NaN, or an infinity from finite numbers.` });
  }
  return result;
}

/** This function applies a comparison of two numbers or two texts (STDOPS.ORDER). */
function order(op: string, args: readonly unknown[], test: (a: number | string, b: number | string) => boolean): boolean {
  arity(op, args, 2);
  const [a, b] = args;
  const same = (typeof a === "number" && typeof b === "number") || (typeof a === "string" && typeof b === "string");
  if (!same) refuse(op, "two numbers or two texts", args);
  return test(a as number | string, b as number | string);
}

const NUMBER_2: Signature = { params: ["number", "number"], to: "number" };
const NUMBER_1: Signature = { params: ["number"], to: "number" };
const ORDER: readonly Signature[] = [
  { params: ["number", "number"], to: "bool" },
  { params: ["text", "text"], to: "bool" },
];
const EQUAL: Signature = { params: ["unknown", "unknown"], to: "bool" };

/**
 * The standard table of operations of the formula kit (D219). It has an operation for each operator of `STD_SYNTAX`:
 * `not`, `eq`, `ne`, `lt`, `le`, `gt`, `ge`, `add`, `sub`, `mul`, `div`, `mod`, `neg` and `pow`. It also has `floor`,
 * `concat` and the lazy operation `coalesce`.
 *
 * - The operations on numbers take only numbers, and a comparison takes two numbers or two texts. A different value
 *   gives `#VALUE!`. A different count of arguments gives `#ARGS`.
 * - A result `NaN`, or an infinite result of finite arguments, gives `#NUM!`. Thus `1 / 0` is an error.
 * - `eq` and `ne` compare with `docEquals`. Thus `-0` is not `0`, and `NaN` is `NaN`.
 * - `mod` gives the remainder of a truncated division, with the sign of the first argument.
 * - `concat` joins zero or more texts.
 * - `coalesce` gives the first argument with a value that is not `null` or `undefined`. An argument with the error `#N/A`
 *   has no value, and each other error stops it. With no such argument, it gives `#N/A`.
 *
 * A language uses it as its profile, or it spreads each table into its own profile.
 */
export const STD_OPS: StdOps = /* @__PURE__ */ Object.freeze({
  ops: /* @__PURE__ */ Object.freeze({
    not: (...args: unknown[]) => {
      arity("not", args, 1);
      if (typeof args[0] !== "boolean") refuse("not", "a truth value", args);
      return !args[0];
    },
    eq: (...args: unknown[]) => {
      arity("eq", args, 2);
      return docEquals(args[0], args[1]);
    },
    ne: (...args: unknown[]) => {
      arity("ne", args, 2);
      return !docEquals(args[0], args[1]);
    },
    lt: (...args: unknown[]) => order("lt", args, (a, b) => a < b),
    le: (...args: unknown[]) => order("le", args, (a, b) => a <= b),
    gt: (...args: unknown[]) => order("gt", args, (a, b) => a > b),
    ge: (...args: unknown[]) => order("ge", args, (a, b) => a >= b),
    add: (...args: unknown[]) => arithmetic("add", args, 2, (a, b) => a + b),
    sub: (...args: unknown[]) => arithmetic("sub", args, 2, (a, b) => a - b),
    mul: (...args: unknown[]) => arithmetic("mul", args, 2, (a, b) => a * b),
    div: (...args: unknown[]) => arithmetic("div", args, 2, (a, b) => a / b),
    mod: (...args: unknown[]) => arithmetic("mod", args, 2, (a, b) => a % b),
    pow: (...args: unknown[]) => arithmetic("pow", args, 2, (a, b) => a ** b),
    neg: (...args: unknown[]) => arithmetic("neg", args, 1, (a) => -a),
    floor: (...args: unknown[]) => arithmetic("floor", args, 1, Math.floor),
    concat: (...args: unknown[]) => {
      if (!args.every((value) => typeof value === "string")) refuse("concat", "texts", args);
      return args.join("");
    },
  }),
  lazy: /* @__PURE__ */ Object.freeze({
    coalesce: (args) => {
      for (const arg of args) {
        const result = arg();
        if (!result.ok) {
          if (result.error.code === "#N/A") continue;
          return result;
        }
        if (result.value !== null && result.value !== undefined) return result;
      }
      return fail("#N/A", "No argument of the operation coalesce has a value.");
    },
  } satisfies Record<string, LazyOp>),
  sigs: /* @__PURE__ */ Object.freeze({
    not: { params: ["bool"], to: "bool" },
    eq: EQUAL,
    ne: EQUAL,
    lt: ORDER,
    le: ORDER,
    gt: ORDER,
    ge: ORDER,
    add: NUMBER_2,
    sub: NUMBER_2,
    mul: NUMBER_2,
    div: NUMBER_2,
    mod: NUMBER_2,
    pow: NUMBER_2,
    neg: NUMBER_1,
    floor: NUMBER_1,
    concat: { params: [], rest: "text", to: "text" },
    coalesce: { params: [], rest: "unknown", to: "unknown" },
  } satisfies Record<string, Signature | readonly Signature[]>),
  pure: /* @__PURE__ */ Object.freeze(["not", "eq", "ne", "lt", "le", "gt", "ge", "add", "sub", "mul", "div", "mod", "pow", "neg", "floor", "concat", "coalesce"]),
});
