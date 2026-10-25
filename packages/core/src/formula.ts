import { type Json, type Key, isRecord } from "./doc.ts";
import type { Kind, WorldEntry } from "./world.ts";
import { type Context, type Resolution, valueOfThing } from "./deref.ts";
import { type EvalError, type Failed, type Result, Failure, fail, ok, thrown } from "./errors.ts";
import type { Code, CompileInput, CompiledEvaluator, CompiledPart, Evaluator, Machine } from "./evaluate.ts";
import { type MachinePart, mergeMachines } from "./merge.ts";
import { STD_DOMAINS } from "./types.ts";

/** An operation of a formula language: a function of the values of its arguments. */
export type OpFn = (...args: never[]) => unknown;

/**
 * A lazy operation: it gets one function for each argument. It evaluates only the arguments that it needs, for
 * example a default for an error.
 */
export type LazyOp = (args: readonly (() => Result)[]) => Result;

/** The code of an extension: it gives the value of the data of an extension document, in the context of the document. */
export type ExtFn = (data: Json, context: Context) => Result;

/**
 * The rules of one formula language: its operations, and the rules that differ between languages.
 *
 * - `ops`: the operations of the namespace `ops`, by their name (the keys after `ops`, with dots between them).
 * - `lazy`: the operations that evaluate their arguments themselves.
 * - `ext`: the extensions of the namespace `ext`, by their name. The kit has `ext.undefined` and `ext.number`.
 * - `truthy`: the truth of a value for `if`, `and` and `or`. `undefined` is an error `#VALUE!`. The default
 *   accepts only `true` and `false`.
 * - `otherwise`: the value of an `if` without `else`. The default is `null`. A profile with this key gives its value,
 *   also `undefined`.
 * - `logic`: what `and` and `or` give: a truth value (the default), or the value that decided.
 * - `omit`: the errors that leave a field out of a `record`, as an absent value.
 * - `missing`: the values that a reference cannot give. Such a value gives `#N/A`.
 * - `check`: a check of the value of an operation, for example "a number must be finite".
 * - `combine`: the error of two or more failed parts of an operation, a `record` or a `list`. With it, each part
 *   evaluates, and one failed part gives its own error. Without it, the first error stops the evaluation.
 */
export interface FormulaProfile {
  readonly ops?: Readonly<Record<string, OpFn>> | ((name: string) => OpFn | undefined);
  readonly lazy?: Readonly<Record<string, LazyOp>>;
  readonly ext?: Readonly<Record<string, ExtFn>>;
  readonly truthy?: (value: unknown) => boolean | undefined;
  readonly otherwise?: unknown;
  readonly logic?: "boolean" | "value";
  readonly omit?: (error: EvalError) => boolean;
  readonly missing?: (value: unknown) => boolean;
  readonly check?: (value: unknown, op: string) => Result | undefined;
  readonly combine?: (errors: readonly EvalError[]) => EvalError;
}

/** The mark of a field that the profile leaves out of a record. */
const SKIPPED: unique symbol = /* @__PURE__ */ Symbol("skipped");

/** The value of a name whose binding failed. A reference to the name gives the error. */
export class Held {
  constructor(readonly error: EvalError) {}
}

const CLOSURE: unique symbol = /* @__PURE__ */ Symbol.for("coeval.closure") as never;

/** A function that the construct `fn` made. It throws a `Failure` when its body fails. */
export type Closure = ((...args: readonly unknown[]) => unknown) & { readonly [CLOSURE]: { readonly params: readonly string[] } };

/**
 * This function tells if a value is a function that the construct `fn` made.
 *
 * @param value - The value.
 * @returns `true` for a closure.
 */
export function isClosure(value: unknown): value is Closure {
  return typeof value === "function" && (value as Partial<Closure>)[CLOSURE] !== undefined;
}

/** The standard extensions: the values that JSON cannot write. */
export const STD_EXT: Readonly<Record<string, ExtFn>> = {
  undefined: () => ok(undefined),
  number: (data) => {
    if (data === "NaN") return ok(Number.NaN);
    if (data === "Infinity") return ok(Number.POSITIVE_INFINITY);
    if (data === "-Infinity") return ok(Number.NEGATIVE_INFINITY);
    if (data === "-0") return ok(-0);
    return fail("#VALUE!", "The value of ext.number is NaN, Infinity, -Infinity or -0.");
  },
};

/** The truth of a value in the rules of JavaScript: `0`, `""`, `null`, `undefined` and `NaN` are false. */
export function jsTruthy(value: unknown): boolean {
  return Boolean(value);
}

function strictTruthy(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * This function sets an own data property. Only the key `__proto__` needs `defineProperty`: an assignment to it
 * changes the prototype. An assignment is faster for each other key of a new plain object.
 */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === "__proto__") Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

function compiled(compile: (input: CompileInput) => Code): CompiledEvaluator {
  return { compile };
}

/** This function evaluates parts in order. It gives the value of each part, or the first error. */
function valuesOf(parts: readonly CompiledPart[], ctx: Context, rt: Parameters<Code>[1]): unknown[] | Failed {
  const values = new Array<unknown>(parts.length);
  for (let index = 0; index < parts.length; index += 1) {
    const result = (parts[index] as CompiledPart).code(ctx, rt);
    if (!result.ok) return result;
    values[index] = result.value;
  }
  return values;
}

function partsOf(value: unknown): Readonly<Record<string, CompiledPart>> {
  return isRecord(value) ? (value as unknown as Readonly<Record<string, CompiledPart>>) : {};
}

const LIT_SUMMARY = "A literal: its value is the result.";

/**
 * This function makes the kinds of the formula kit, for a world. The kinds are the shared constructs of D13 and
 * the namespaces `ops` and `ext`. A bare value in a position of a term is a literal.
 *
 * @returns The entries of the world, by their key.
 */
export function formulaKinds(): Readonly<Record<string, WorldEntry>> {
  const term = { shape: "term", of: "lit" } as const;
  const terms = { shape: "list", of: "lit" } as const;
  const kinds: Record<string, Kind | WorldEntry> = {
    lit: { verbs: { eval: "formula.lit" }, summary: LIT_SUMMARY },
    ref: { verbs: { eval: "formula.ref" }, summary: "A path from a root of the context. Its result is what the path reaches." },
    record: { verbs: { eval: "formula.record" }, parts: { shape: "map", of: "lit" }, summary: "A record: each field is a term." },
    list: { verbs: { eval: "formula.list" }, parts: terms, summary: "A list: each item is a term." },
    let: {
      verbs: { eval: "formula.let" },
      parts: { shape: "record", fields: { bind: { shape: "map", of: "lit" }, body: term }, required: ["bind", "body"] },
      scope: [{ names: { keysAt: ["bind"] }, in: [["body"]] }],
      summary: "Names for the body. Each binding sees the names around the let, not the other bindings.",
    },
    fn: {
      verbs: { eval: "formula.fn" },
      parts: { shape: "record", fields: { params: { shape: "list", item: { shape: "text" }, distinct: true }, body: term }, required: ["params", "body"] },
      scope: [{ names: { listAt: ["params"] }, in: [["body"]] }],
      summary: "A function: its parameters are names for its body.",
    },
    call: {
      verbs: { eval: "formula.call" },
      parts: { shape: "record", fields: { fn: term, args: terms }, required: ["fn"] },
      summary: "It calls a function with the values of its arguments.",
    },
    if: {
      verbs: { eval: "formula.if" },
      parts: { shape: "record", fields: { test: term, then: term, else: term }, required: ["test", "then"] },
      summary: "It evaluates the test, then only the branch that the test selects.",
    },
    and: { verbs: { eval: "formula.and" }, parts: terms, summary: "True when each term is true. It stops at the first false term." },
    or: { verbs: { eval: "formula.or" }, parts: terms, summary: "True when one term is true. It stops at the first true term." },
    ops: { kinds: {}, fallback: { verbs: { eval: "formula.op" }, parts: terms, summary: "An operation of the language, applied to the values of its terms." } },
    ext: { kinds: {}, fallback: { verbs: { eval: "formula.ext" }, summary: "An extension of the language. Its value is data." } },
  };
  return kinds as Readonly<Record<string, WorldEntry>>;
}

/**
 * This function makes the evaluators of the formula kit for one language. Each evaluator compiles its document
 * one time into code.
 *
 * @param profile - The operations and the rules of the language.
 * @returns The evaluators, by their name.
 */
export function formulaEvaluators(profile: FormulaProfile = {}): Readonly<Record<string, Evaluator>> {
  const truthy = profile.truthy ?? strictTruthy;
  const otherwise = ok(Object.hasOwn(profile, "otherwise") ? profile.otherwise : null);
  const logicValue = profile.logic === "value";
  const omit = profile.omit;
  const missing = profile.missing;
  const check = profile.check;
  const lookup = (name: string): OpFn | undefined => {
    const ops = profile.ops;
    if (ops === undefined) return undefined;
    if (typeof ops === "function") return ops(name);
    return Object.hasOwn(ops, name) ? ops[name] : undefined;
  };
  const notTruth = (what: string): Failed => fail("#VALUE!", `The ${what} must give a truth value.`);
  const combine = profile.combine;
  /** This function evaluates each part. Without `combine`, the first error stops it. A field that `omit` skips is absent. */
  const collect = (parts: readonly CompiledPart[], ctx: Context, rt: Parameters<Code>[1], skip?: (error: EvalError) => boolean): (readonly unknown[]) | Failed => {
    const values = new Array<unknown>(parts.length);
    let errors: EvalError[] | undefined;
    for (let index = 0; index < parts.length; index += 1) {
      const result = (parts[index] as CompiledPart).code(ctx, rt);
      if (result.ok) values[index] = result.value;
      else if (skip !== undefined && skip(result.error)) values[index] = SKIPPED;
      else if (combine === undefined) return result;
      else (errors ??= []).push(result.error);
    }
    // The errors exist only with combine, so the second test only narrows the type.
    if (errors === undefined || combine === undefined) return values;
    return { ok: false, error: errors.length === 1 ? (errors[0] as EvalError) : combine(errors) };
  };

  return {
    "formula.lit": compiled(({ doc }) => {
      const result = ok(doc.value);
      return () => result;
    }),

    "formula.ref": compiled(({ doc, parts, fill, address }) => {
      const path = doc.value;
      if (!Array.isArray(path) || path.length === 0) {
        const bad = fail("#VALUE!", 'The value of ref is a path: a list that starts with a root, for example ["names", "a"].');
        return () => bad;
      }
      // A path through a name whose binding failed gives the error of the binding.
      const head = path[0] === "names" && typeof path[1] === "string" ? path[1] : undefined;
      const give = (found: Resolution): Result => {
        if (!found.ok) return fail(found.code, found.reason);
        // An address gives what the path reaches: a host thing stays a thing.
        if (address === true) return ok(found.thing);
        const reached = valueOfThing(found.thing);
        if (reached instanceof Held) return { ok: false, error: reached.error };
        if (missing !== undefined && missing(reached)) return fail("#N/A", "The path reaches no value.");
        return ok(reached);
      };
      const held = (ctx: Context): Failed | undefined => {
        if (head === undefined || !Object.hasOwn(ctx.names, head)) return undefined;
        const bound = ctx.names[head];
        return bound instanceof Held ? { ok: false, error: bound.error } : undefined;
      };
      if (parts.length === 0) return (ctx, rt) => held(ctx) ?? give(rt.resolve(ctx, path));
      // The step documents of a path are its parts when the kind ref has a deep shape. They evaluate first, in order,
      // thus the error of a step comes before the error of a binding that the path reads (FORMULA.STEPS).
      return (ctx, rt) => {
        const steps = valuesOf(parts, ctx, rt);
        if (!Array.isArray(steps)) return steps;
        return held(ctx) ?? give(rt.resolve(ctx, fill(steps) as readonly unknown[]));
      };
    }),

    "formula.step": compiled(({ doc, parts, fill }) => {
      // A step document without parts is its own value. A step document with parts gets the result of each part.
      if (parts.length === 0) {
        const same = ok(doc);
        return () => same;
      }
      return (ctx, rt) => {
        const values = valuesOf(parts, ctx, rt);
        return Array.isArray(values) ? ok({ ...doc, value: fill(values) as Json }) : values;
      };
    }),

    "formula.record": compiled(({ value }) => {
      const fields = partsOf(value);
      const keys = Object.keys(fields);
      const codes = keys.map((key) => (fields[key] as CompiledPart).code);
      if (combine !== undefined) {
        // With combine, each field evaluates, and two failed fields give one error.
        const parts = keys.map((key) => fields[key] as CompiledPart);
        return (ctx, rt) => {
          const values = collect(parts, ctx, rt, omit);
          if (!Array.isArray(values)) return values as Failed;
          const out: Record<string, unknown> = {};
          keys.forEach((key, index) => {
            if (values[index] !== SKIPPED) setOwn(out, key, values[index]);
          });
          return ok(out);
        };
      }
      return (ctx, rt) => {
        const out: Record<string, unknown> = {};
        for (let index = 0; index < keys.length; index += 1) {
          const result = (codes[index] as Code)(ctx, rt);
          if (!result.ok) {
            if (omit !== undefined && omit(result.error)) continue;
            return result;
          }
          setOwn(out, keys[index] as string, result.value);
        }
        return ok(out);
      };
    }),

    "formula.list": compiled(({ parts }) => (ctx, rt) => {
      const values = collect(parts, ctx, rt);
      return Array.isArray(values) ? ok(values) : (values as Failed);
    }),

    "formula.let": compiled(({ value }) => {
      const record = partsOf(value);
      const bindings = Object.entries(partsOf(record["bind"]));
      const body = record["body"] as CompiledPart;
      return (ctx, rt) => {
        const names: Record<string, unknown> = { ...ctx.names };
        for (const [name, part] of bindings) {
          const result = part.code(ctx, rt);
          setOwn(names, name, result.ok ? result.value : new Held(result.error));
        }
        return body.code({ ...ctx, names }, rt);
      };
    }),

    "formula.fn": compiled(({ value, data }) => {
      const params = isRecord(data) ? data["params"] : undefined;
      if (!Array.isArray(params) || !params.every((param) => typeof param === "string") || new Set(params).size !== params.length) {
        const bad = fail("#VALUE!", "The params of fn are a list of different texts.");
        return () => bad;
      }
      const names = params as readonly string[];
      const body = partsOf(value)["body"] as CompiledPart;
      return (ctx, rt) => {
        const closure = (...args: readonly unknown[]): unknown => {
          const scope: Record<string, unknown> = { ...ctx.names };
          names.forEach((name, index) => setOwn(scope, name, args[index]));
          const result = body.code({ ...ctx, names: scope }, rt);
          if (!result.ok) throw new Failure(result.error);
          return result.value;
        };
        Object.defineProperty(closure, CLOSURE, { value: { params: names } });
        return ok(closure);
      };
    }),

    "formula.call": compiled(({ value }) => {
      const record = partsOf(value);
      const fnPart = record["fn"] as CompiledPart;
      const args = Array.isArray(record["args"]) ? (record["args"] as unknown as readonly CompiledPart[]) : [];
      return (ctx, rt) => {
        const fn = fnPart.code(ctx, rt);
        if (!fn.ok) return fn;
        if (typeof fn.value !== "function") return fail("#VALUE!", "The fn of call must give a function.");
        const values = new Array<unknown>(args.length);
        for (let index = 0; index < args.length; index += 1) {
          const result = (args[index] as CompiledPart).code(ctx, rt);
          if (!result.ok) return result;
          values[index] = result.value;
        }
        try {
          return ok((fn.value as (...items: unknown[]) => unknown)(...values));
        } catch (error) {
          return thrown(error, "the function of call");
        }
      };
    }),

    "formula.if": compiled(({ value }) => {
      const record = partsOf(value);
      const test = record["test"] as CompiledPart;
      const then = record["then"] as CompiledPart;
      const other = record["else"];
      return (ctx, rt) => {
        const chosen = test.code(ctx, rt);
        if (!chosen.ok) return chosen;
        const truth = truthy(chosen.value);
        if (truth === undefined) return notTruth("test of if");
        if (truth) return then.code(ctx, rt);
        return other === undefined ? otherwise : other.code(ctx, rt);
      };
    }),

    "formula.and": compiled(({ parts }) => (ctx, rt) => {
      let last: Result = ok(true);
      for (const part of parts) {
        last = part.code(ctx, rt);
        if (!last.ok) return last;
        const truth = truthy(last.value);
        if (truth === undefined) return notTruth("term of and");
        if (!truth) return logicValue ? last : ok(false);
      }
      return logicValue ? last : ok(true);
    }),

    "formula.or": compiled(({ parts }) => (ctx, rt) => {
      let last: Result = ok(false);
      for (const part of parts) {
        last = part.code(ctx, rt);
        if (!last.ok) return last;
        const truth = truthy(last.value);
        if (truth === undefined) return notTruth("term of or");
        if (truth) return logicValue ? last : ok(true);
      }
      return logicValue ? last : ok(false);
    }),

    "formula.op": compiled(({ typePath, parts }) => {
      const name = typePath.slice(1).join(".");
      const lazy = profile.lazy !== undefined && Object.hasOwn(profile.lazy, name) ? profile.lazy[name] : undefined;
      if (lazy !== undefined) {
        return (ctx, rt) => {
          try {
            return lazy(parts.map((part) => () => part.code(ctx, rt)));
          } catch (error) {
            return thrown(error, `the operation ${name}`);
          }
        };
      }
      const fn = lookup(name) as ((...args: unknown[]) => unknown) | undefined;
      if (fn === undefined) {
        const unknown = fail("#NAME?", `The language has no operation ${name}.`);
        return () => unknown;
      }
      const done = (out: unknown): Result => (check === undefined ? ok(out) : (check(out, name) ?? ok(out)));
      const failed = (error: unknown): Result => thrown(error, `the operation ${name}`);
      if (combine !== undefined) {
        return (ctx, rt) => {
          const values = collect(parts, ctx, rt);
          if (!Array.isArray(values)) return values as Failed;
          try {
            return done(fn(...values));
          } catch (error) {
            return failed(error);
          }
        };
      }
      if (parts.length === 1) {
        const [a] = parts as readonly [CompiledPart];
        return (ctx, rt) => {
          const x = a.code(ctx, rt);
          if (!x.ok) return x;
          try {
            return done(fn(x.value));
          } catch (error) {
            return failed(error);
          }
        };
      }
      if (parts.length === 2) {
        const [a, b] = parts as readonly [CompiledPart, CompiledPart];
        return (ctx, rt) => {
          const x = a.code(ctx, rt);
          if (!x.ok) return x;
          const y = b.code(ctx, rt);
          if (!y.ok) return y;
          try {
            return done(fn(x.value, y.value));
          } catch (error) {
            return failed(error);
          }
        };
      }
      return (ctx, rt) => {
        const values = new Array<unknown>(parts.length);
        for (let index = 0; index < parts.length; index += 1) {
          const result = (parts[index] as CompiledPart).code(ctx, rt);
          if (!result.ok) return result;
          values[index] = result.value;
        }
        try {
          return done(fn(...values));
        } catch (error) {
          return failed(error);
        }
      };
    }),

    "formula.ext": compiled(({ typePath, doc }) => {
      const name = typePath.slice(1).join(".");
      const own = profile.ext !== undefined && Object.hasOwn(profile.ext, name) ? profile.ext[name] : undefined;
      const handler = own ?? (Object.hasOwn(STD_EXT, name) ? STD_EXT[name] : undefined);
      if (handler === undefined) {
        const unknown = fail("#NAME?", `The language has no extension ${name}.`);
        return () => unknown;
      }
      return (ctx) => {
        try {
          return handler(doc.value, ctx);
        } catch (error) {
          return thrown(error, `the extension ${name}`);
        }
      };
    }),
  };
}

/**
 * This function makes the hook `known` of the formula kit for one profile (STATIC.KNOWN). The evaluator
 * `formula.op` knows an operation of `lazy` or of `ops`. A profile whose `ops` is a function answers through a call
 * of that function. A function that throws counts as an answer, because the run then gives `#CALC!`. The evaluator
 * `formula.ext` knows an extension of `ext` and each standard extension. The hook knows each name of the other
 * evaluators.
 *
 * @param profile - The operations and the extensions of the language.
 * @returns The hook: `true`, or the reason of the `#NAME?` that the evaluator gives in a run.
 */
export function formulaKnown(profile: FormulaProfile = {}): (path: readonly Key[], evaluator: string) => true | string {
  const hasOp = (name: string): boolean => {
    if (profile.lazy !== undefined && Object.hasOwn(profile.lazy, name)) return true;
    const ops = profile.ops;
    if (ops === undefined) return false;
    if (typeof ops !== "function") return Object.hasOwn(ops, name);
    try {
      return ops(name) !== undefined;
    } catch {
      return true;
    }
  };
  const hasExt = (name: string): boolean => (profile.ext !== undefined && Object.hasOwn(profile.ext, name)) || Object.hasOwn(STD_EXT, name);
  return (path, evaluator) => {
    if (evaluator !== "formula.op" && evaluator !== "formula.ext") return true;
    // The evaluators give the same reasons when they do not find the name.
    const name = path.slice(1).join(".");
    if (evaluator === "formula.op") return hasOp(name) ? true : `The language has no operation ${name}.`;
    return hasExt(name) ? true : `The language has no extension ${name}.`;
  };
}

/**
 * This function makes a machine for a formula language. It merges the kit and the parts that the language adds with
 * `mergeMachines`. Thus a kind `ops.*` or a namespace `ops` of the language extends the namespace of the kit, and
 * the fallback of the kit stays. The hook `known` of the kit comes from the profile (`formulaKnown`). A hook `known`
 * of the language answers after it.
 *
 * A kind or an evaluator of the language that differs from the entry of the kit with its name is a conflict. The
 * language names the path in `replaces` to replace the entry, for example `["world", "kinds", "ref"]` or
 * `["evaluators", "formula.op"]`. Then the hook of the kit does not answer for a replaced evaluator.
 *
 * The kit gives the domains of the kernel (`STD_DOMAINS`). Thus a domain of the language with the name `number` is a
 * conflict. The language names `["domains", "number"]` in `replaces` to replace it.
 *
 * @param profile - The operations and the rules of the language.
 * @param more - The parts of a machine that the language adds, with the paths of the entries that it replaces.
 * @returns The machine.
 * @throws {MergeError} The language and the kit have a conflict.
 */
export function formulaMachine(profile: FormulaProfile = {}, more: MachinePart = {}): Machine {
  return mergeMachines({ world: { kinds: formulaKinds() }, evaluators: formulaEvaluators(profile), domains: STD_DOMAINS, known: formulaKnown(profile) }, more);
}
