import { type Json, type Key, docEquals, isKey, isRecord } from "./doc.ts";
import type { Kind, KindFacts, LazyRule, WorldEntry } from "./world.ts";
import { type Context, type Resolution, valueOfThing } from "./deref.ts";
import { type EvalError, type Failed, type Result, Failure, fail, ok, thrown } from "./errors.ts";
import type { Code, CompileInput, CompiledEvaluator, CompiledPart, Evaluator, Machine } from "./evaluate.ts";
import { type MachinePart, mergeMachines } from "./merge.ts";
import { type ValueType, STD_DOMAINS, callable, fieldOf, fits, fnOf, isPrecise, isUnknown, itemOf, join, typeText } from "./types.ts";
import type { TypeInput, TypeRule } from "./typing.ts";

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
 * - `pure`: the pure operations, for `factsOf` (D24). `true` names each operation that is not volatile. The default
 *   names no operation.
 * - `volatile`: the operations whose results can change while their arguments stay the same, for example a clock.
 * - `sigs`: the signatures of the operations, by their name, for a check of types (TYPE.SIGNATURE). A list gives
 *   overloads. An operation without a signature takes and gives `unknown` (TYPE.GRADUAL).
 *
 * A check of types trusts the signatures. Each operation must give a member of the result of each signature that
 * its arguments match. The hook `check` must keep each result in that type.
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
  readonly pure?: true | readonly string[];
  readonly volatile?: readonly string[];
  readonly sigs?: Readonly<Record<string, Signature | readonly Signature[]>> | ((name: string) => Signature | readonly Signature[] | undefined);
}

/**
 * The signature of an operation: the value types of its parameters and of its result (TYPE.SIGNATURE). A parameter of
 * the type `unknown` at the end of `params` is optional. A later version can add a key, for example the type that a
 * true result proves.
 */
export interface Signature {
  /** The types of the parameters, in order. */
  readonly params: readonly ValueType[];
  /** The type of each argument after the parameters. Without it, the operation takes no more arguments. */
  readonly rest?: ValueType;
  /** The type of the result. */
  readonly to: ValueType;
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
    lit: { verbs: { eval: "formula.lit" }, pure: true, summary: LIT_SUMMARY },
    ref: { verbs: { eval: "formula.ref" }, pure: true, summary: "A path from a root of the context. Its result is what the path reaches." },
    record: { verbs: { eval: "formula.record" }, parts: { shape: "map", of: "lit" }, pure: true, summary: "A record: each field is a term." },
    list: { verbs: { eval: "formula.list" }, parts: terms, pure: true, summary: "A list: each item is a term." },
    let: {
      verbs: { eval: "formula.let" },
      parts: { shape: "record", fields: { bind: { shape: "map", of: "lit" }, body: term }, required: ["bind", "body"] },
      scope: [{ names: { keysAt: ["bind"] }, in: [["body"]] }],
      pure: true,
      summary: "Names for the body. Each binding sees the names around the let, not the other bindings.",
    },
    fn: {
      verbs: { eval: "formula.fn" },
      parts: { shape: "record", fields: { params: { shape: "list", item: { shape: "text" }, distinct: true }, body: term }, required: ["params", "body"] },
      scope: [{ names: { listAt: ["params"] }, in: [["body"]] }],
      // The body evaluates only when something calls the function.
      pure: true,
      lazy: [{ in: [["body"]] }],
      summary: "A function: its parameters are names for its body.",
    },
    call: {
      verbs: { eval: "formula.call" },
      parts: { shape: "record", fields: { fn: term, args: terms }, required: ["fn"] },
      // A host function in a name is a value. When it is volatile, the host marks its read (FACTS.VOLATILE).
      pure: true,
      summary: "It calls a function with the values of its arguments.",
    },
    if: {
      verbs: { eval: "formula.if" },
      parts: { shape: "record", fields: { test: term, then: term, else: term }, required: ["test", "then"] },
      pure: true,
      lazy: [{ in: [["then"], ["else"]] }],
      summary: "It evaluates the test, then only the branch that the test selects.",
    },
    and: { verbs: { eval: "formula.and" }, parts: terms, pure: true, lazy: [{ after: 1 }], summary: "True when each term is true. It stops at the first false term." },
    or: { verbs: { eval: "formula.or" }, parts: terms, pure: true, lazy: [{ after: 1 }], summary: "True when one term is true. It stops at the first true term." },
    ops: { kinds: {}, fallback: { verbs: { eval: "formula.op" }, parts: terms, summary: "An operation of the language, applied to the values of its terms." } },
    ext: { kinds: {}, fallback: { verbs: { eval: "formula.ext" }, summary: "An extension of the language. Its value is data." } },
  };
  return kinds as Readonly<Record<string, WorldEntry>>;
}

/** This function gives the type of a value of a profile: the value itself as `one`. `undefined` and a function give `unknown`. */
function valueType(value: unknown): ValueType {
  return value === undefined || typeof value === "function" ? "unknown" : { one: [value as Json] };
}

/** This function tells if a value has the form of a signature: a record with `params` as a list, and `to`. */
function isSignature(value: unknown): value is Signature {
  return typeof value === "object" && value !== null && Array.isArray((value as { readonly params?: unknown }).params) && Object.hasOwn(value, "to");
}

/** This function gives the text of a signature, for the reason of an issue. */
function signatureText(sig: Signature): string {
  const params = sig.params.map(typeText);
  if (sig.rest !== undefined) params.push(`...${typeText(sig.rest)}`);
  return `(${params.join(", ")}) => ${typeText(sig.to)}`;
}

function argumentsText(count: number): string {
  return `${count} argument${count === 1 ? "" : "s"}`;
}

/**
 * This function tells if a signature takes a count of arguments. A parameter of the type `unknown` at the end is
 * optional, because a missing argument is `undefined`.
 *
 * @returns `undefined` when the number is correct, or else the text of the numbers that the signature takes.
 */
function arityOf(sig: Signature, count: number, domains: Machine["domains"]): string | undefined {
  let least = sig.params.length;
  while (least > 0 && isUnknown(sig.params[least - 1], domains)) least -= 1;
  const most = sig.rest === undefined ? sig.params.length : Number.POSITIVE_INFINITY;
  if (count >= least && count <= most) return undefined;
  if (most === Number.POSITIVE_INFINITY) return `at least ${argumentsText(least)}`;
  return least === most ? argumentsText(most) : `${least} to ${argumentsText(most)}`;
}

/** This function gives the parameters of a document of `fn`: the texts of its list `params`. */
function paramsOf(value: unknown): readonly string[] {
  const params = isRecord(value) ? value["params"] : undefined;
  return Array.isArray(params) ? params.filter((param): param is string => typeof param === "string") : [];
}

/**
 * This function makes the type rules of the formula kit for one profile (TYPE.SYNTH, D25). Each evaluator of the kit
 * holds its rule. The rules read the rules of the profile that change a type: `truthy`, `logic`, `otherwise`, `omit`
 * and `sigs`.
 */
function formulaTypes(profile: FormulaProfile): Readonly<Record<string, TypeRule>> {
  // Only the default truth accepts nothing but a truth value. A truth of the profile accepts each value.
  const truth: ValueType | undefined = profile.truthy === undefined ? "bool" : undefined;
  const logicValue = profile.logic === "value";
  const otherwise = Object.hasOwn(profile, "otherwise") ? valueType(profile.otherwise) : "null";
  const lookup = (name: string): readonly unknown[] | undefined => {
    const sigs = profile.sigs;
    if (sigs === undefined) return undefined;
    let found: unknown;
    if (typeof sigs === "function") {
      try {
        found = sigs(name);
      } catch {
        return undefined;
      }
    } else {
      found = Object.hasOwn(sigs, name) ? sigs[name] : undefined;
    }
    if (found === undefined) return undefined;
    return Array.isArray(found) ? found : [found];
  };
  const nameOf = (input: TypeInput): string => input.typePath.slice(1).join(".");
  /** The signatures of an operation. Each type of a signature is a contract, thus the check examines it one time. */
  const signatures = (input: TypeInput): { readonly sigs: readonly Signature[]; readonly bad: boolean } | undefined => {
    const name = nameOf(input);
    const raw = lookup(name);
    if (raw === undefined) return undefined;
    const sigs: Signature[] = [];
    for (const sig of raw) {
      if (!isSignature(sig)) continue;
      sig.params.forEach((param, index) => input.contract(param, `parameter ${index + 1} of a signature of ops.${name}`));
      if (sig.rest !== undefined) input.contract(sig.rest, `rest parameter of a signature of ops.${name}`);
      input.contract(sig.to, `result of a signature of ops.${name}`);
      sigs.push(sig);
    }
    return { sigs, bad: sigs.length !== raw.length };
  };
  const logic = (word: "and" | "or"): TypeRule => ({
    part: (_input, path) => (truth === undefined ? {} : { expect: truth, what: `term ${Number(path[0]) + 1} of ${word}` }),
    synth: (input) => {
      if (!logicValue) return "bool";
      // With the logic "value", the result is the term that decided, or the last term.
      if (input.paths.length === 0) return { one: [word === "and"] };
      return input.paths.reduce<ValueType>((type, path) => join(type, input.typeOf(path), input.machine.domains), "never");
    },
  });

  return {
    "formula.lit": { synth: (input) => valueType(input.doc.value) },

    "formula.ref": {
      synth: (input) => {
        const path = input.doc.value;
        // A name that a kind around the reference binds has a type. Roots, paths and addresses wait for K25.
        if (input.address || input.paths.length > 0 || !Array.isArray(path) || path.length !== 2 || path[0] !== "names" || !isKey(path[1])) return "unknown";
        return input.nameType(String(path[1])) ?? "unknown";
      },
    },

    "formula.record": {
      part: (input, path) => {
        const want = fieldOf(input.expected, String(path[0]), input.machine.domains);
        return want === undefined ? {} : { expect: want, what: `field ${String(path[0])} of the record` };
      },
      synth: (input) => {
        const fields: Record<string, ValueType> = {};
        for (const path of input.paths) setOwn(fields, String(path[0]), input.typeOf(path));
        const keys = Object.keys(fields);
        // A profile with omit can leave out each field, thus each field is optional.
        return { record: fields, ...(profile.omit !== undefined && keys.length > 0 ? { optional: keys } : {}), closed: true };
      },
    },

    "formula.list": {
      part: (input, path) => {
        const want = itemOf(input.expected, input.machine.domains);
        return want === undefined ? {} : { expect: want, what: `item ${Number(path[0]) + 1} of the list` };
      },
      synth: (input) => ({ list: input.paths.reduce<ValueType>((type, path) => join(type, input.typeOf(path), input.machine.domains), "never") }),
    },

    "formula.let": {
      part: (input, path) => {
        if (path[0] !== "body") return {};
        // The scope rule keysAt puts the bindings first, thus their types are known here.
        const names: Record<string, ValueType> = {};
        for (const each of input.paths) if (each[0] === "bind" && each.length === 2) setOwn(names, String(each[1]), input.typeOf(each));
        return { names, ...(isUnknown(input.expected, input.machine.domains) ? {} : { expect: input.expected, what: "body of let" }) };
      },
      synth: (input) => input.typeOf(["body"]),
    },

    "formula.fn": {
      part: (input, path) => {
        if (path[0] !== "body") return {};
        // An expected function type gives the types of the parameters. Without it, each parameter is unknown.
        const want = fnOf(input.expected, input.machine.domains);
        const names: Record<string, ValueType> = {};
        paramsOf(input.doc.value).forEach((name, index) => setOwn(names, name, want?.params[index] ?? "unknown"));
        return { names, ...(want === undefined || isUnknown(want.to, input.machine.domains) ? {} : { expect: want.to, what: "body of fn" }) };
      },
      synth: (input) => {
        const want = fnOf(input.expected, input.machine.domains);
        return { fn: paramsOf(input.doc.value).map((_name, index) => want?.params[index] ?? "unknown"), to: input.typeOf(["body"]) };
      },
    },

    "formula.call": {
      synth: (input, report) => {
        const domains = input.machine.domains;
        const target = input.typeOf(["fn"]);
        if (isUnknown(target, domains)) return "unknown";
        const want = fnOf(target, domains);
        if (want === undefined) {
          if (callable(target, domains)) return "unknown";
          report({ path: ["fn"], reason: `The fn of call has the type ${typeText(target)}. It must give a function.`, found: target });
          return "unknown";
        }
        const args = input.paths.filter((path) => path[0] === "args");
        for (const path of args) {
          const index = Number(path[1]);
          const param = want.params[index];
          // The function does not read an argument after its parameters.
          if (param === undefined) continue;
          const found = input.typeOf(path);
          if (!fits(found, param, domains)) {
            report({ path, reason: `The argument ${index + 1} of the call has the type ${typeText(found)}. The function expects the type ${typeText(param)}.`, expected: param, found });
          }
        }
        const missing = want.params.findIndex((param, index) => index >= args.length && !isUnknown(param, domains));
        if (missing !== -1) {
          const param = want.params[missing] as ValueType;
          report({ reason: `The call gives ${argumentsText(args.length)}. The function expects the type ${typeText(param)} for the argument ${missing + 1}.`, expected: param });
        }
        return want.to;
      },
    },

    "formula.if": {
      part: (input, path) => {
        if (path[0] === "test") return truth === undefined ? {} : { expect: truth, what: "test of if" };
        return isUnknown(input.expected, input.machine.domains) ? {} : { expect: input.expected, what: `${String(path[0])} branch of if` };
      },
      synth: (input) => {
        const value = input.doc.value;
        const other = isRecord(value) && Object.hasOwn(value, "else") ? input.typeOf(["else"]) : otherwise;
        return join(input.typeOf(["then"]), other, input.machine.domains);
      },
    },

    "formula.and": logic("and"),
    "formula.or": logic("or"),

    "formula.op": {
      part: (input, path) => {
        const read = signatures(input);
        // Only one signature gives the types of the arguments before their check. Overloads select after it.
        if (read === undefined || read.sigs.length !== 1) return {};
        const sig = read.sigs[0] as Signature;
        const index = Number(path[0]);
        const want = index < sig.params.length ? sig.params[index] : sig.rest;
        return want === undefined ? {} : { expect: want, what: `argument ${index + 1} of ops.${nameOf(input)}` };
      },
      synth: (input, report) => {
        const read = signatures(input);
        if (read === undefined) return "unknown";
        const name = nameOf(input);
        const domains = input.machine.domains;
        if (read.bad) report({ reason: `A signature of ops.${name} is not a record with params and to. The check does not read it.` });
        const { sigs } = read;
        if (sigs.length === 0) return "unknown";
        const args = input.paths.map((path) => input.typeOf(path));
        if (sigs.length === 1) {
          const sig = sigs[0] as Signature;
          const takes = arityOf(sig, args.length, domains);
          if (takes !== undefined) report({ reason: `The operation ops.${name} takes ${takes}. It gets ${args.length}.` });
          return sig.to;
        }
        const paramAt = (sig: Signature, index: number): ValueType => sig.params[index] ?? sig.rest ?? "unknown";
        const fitting = sigs.filter((sig) => arityOf(sig, args.length, domains) === undefined && args.every((arg, index) => fits(arg, paramAt(sig, index), domains)));
        if (fitting.length === 0) {
          const given = args.map(typeText).join(", ");
          report({ reason: `No signature of ops.${name} fits the arguments (${given}). The signatures are ${sigs.map(signatureText).join(" and ")}.` });
          return "unknown";
        }
        const first = fitting[0] as Signature;
        // Precise arguments are members of the first signature that fits. An argument with unknown can match a later one.
        if (fitting.length === 1 || args.every((arg) => isPrecise(arg, domains))) return first.to;
        return fitting.every((sig) => docEquals(sig.to, first.to)) ? first.to : "unknown";
      },
    },

    "formula.ext": {
      synth: (input) => {
        const name = nameOf(input);
        const own = profile.ext !== undefined && Object.hasOwn(profile.ext, name);
        return name === "number" && !own ? "number" : "unknown";
      },
    },
  };
}

/**
 * This function makes the evaluators of the formula kit for one language. Each evaluator compiles its document
 * one time into code. Each evaluator also holds its type rule, for a check of types (TYPE.SYNTH).
 *
 * @param profile - The operations and the rules of the language.
 * @returns The evaluators, by their name.
 */
export function formulaEvaluators(profile: FormulaProfile = {}): Readonly<Record<string, Evaluator>> {
  const evaluators = formulaCode(profile);
  const types = formulaTypes(profile);
  const out: Record<string, Evaluator> = {};
  for (const name of Object.keys(evaluators)) {
    const evaluator = evaluators[name] as CompiledEvaluator;
    const type = Object.hasOwn(types, name) ? types[name] : undefined;
    out[name] = type === undefined ? evaluator : { compile: evaluator.compile, type };
  }
  return out;
}

/** This function makes the code of the evaluators of the formula kit, without their type rules. */
function formulaCode(profile: FormulaProfile): Readonly<Record<string, CompiledEvaluator>> {
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

/** The facts of an extension of the profile. It gets the context, thus it can read outside `resolve`. */
const NOT_PURE: KindFacts = /* @__PURE__ */ Object.freeze({ pure: false });

/** The facts of a standard extension. */
const PURE: KindFacts = /* @__PURE__ */ Object.freeze({ pure: true });

/** The lazy rule of a lazy operation: it covers each argument. */
const EACH_PART: readonly LazyRule[] = /* @__PURE__ */ Object.freeze([/* @__PURE__ */ Object.freeze({})]);

/**
 * This function makes the hook `facts` of the formula kit for one profile (FACTS.PROFILE, D24). It answers for the
 * operations and the extensions, because one fallback kind covers each of them.
 *
 * - An operation of `lazy` has a lazy rule for each argument.
 * - An operation is pure when the profile names it in `pure`, or when `pure` is `true`. A volatile operation is not pure.
 * - A standard extension is pure. An extension of the profile gets the context, thus it is not pure.
 *
 * @param profile - The operations, the extensions and their facts.
 * @returns The hook: the facts of a name, or `undefined` for the facts of the contract.
 */
export function formulaFacts(profile: FormulaProfile = {}): (path: readonly Key[], code: string) => KindFacts | undefined {
  const volatile = new Set(profile.volatile ?? []);
  const pure = profile.pure === true ? undefined : new Set(profile.pure ?? []);
  const known = formulaKnown(profile);
  return (path, code) => {
    if (code !== "formula.op" && code !== "formula.ext") return undefined;
    const name = path.slice(1).join(".");
    if (code === "formula.ext") return profile.ext !== undefined && Object.hasOwn(profile.ext, name) ? NOT_PURE : Object.hasOwn(STD_EXT, name) ? PURE : undefined;
    // An operation that the language does not have gives #NAME?. The kit gives it no facts.
    if (known(path, code) !== true) return undefined;
    const isVolatile = volatile.has(name);
    const lazy = profile.lazy !== undefined && Object.hasOwn(profile.lazy, name);
    return { pure: !isVolatile && (pure === undefined || pure.has(name)), volatile: isVolatile, ...(lazy ? { lazy: EACH_PART } : {}) };
  };
}

/**
 * This function makes a machine for a formula language. It merges the kit and the parts that the language adds with
 * `mergeMachines`. Thus a kind `ops.*` or a namespace `ops` of the language extends the namespace of the kit, and
 * the fallback of the kit stays. The hook `known` of the kit comes from the profile (`formulaKnown`). A hook `known`
 * of the language answers after it. The hook `facts` of the kit comes from the profile too (`formulaFacts`).
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
  return mergeMachines(
    { world: { kinds: formulaKinds() }, evaluators: formulaEvaluators(profile), domains: STD_DOMAINS, known: formulaKnown(profile), facts: formulaFacts(profile) },
    more,
  );
}
