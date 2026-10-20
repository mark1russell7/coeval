import { type Json, field, isRecord } from "./doc.ts";
import { type Context, type Evaluator, type Machine, type Result, fail, ok } from "./evaluate.ts";
import type { World } from "./ladder.ts";

/**
 * The world of the examples: small kinds for numbers, lists, conditions, names, sequences and effects.
 * Each kind names an evaluator for `eval` and a view for `view`. The site draws each document with its view.
 */
export const STD_WORLD: World = {
  kinds: {
    number: { verbs: { eval: "data.number", view: "view.value" }, summary: "A number. Its value is the result." },
    text: { verbs: { eval: "data.text", view: "view.value" }, summary: "A text. Its value is the result." },
    bool: { verbs: { eval: "data.bool", view: "view.value" }, summary: "A truth value. Its value is the result." },
    add: {
      verbs: { eval: "math.add", view: "view.op" },
      parts: { shape: "list", of: "number" },
      summary: "The sum of its parts. A bare number in its list gets the type number.",
    },
    multiply: {
      verbs: { eval: "math.multiply", view: "view.op" },
      parts: { shape: "list", of: "number" },
      summary: "The product of its parts.",
    },
    greater: {
      verbs: { eval: "math.greater", view: "view.op" },
      parts: { shape: "list", of: "number" },
      summary: "True when the first part is greater than the second part.",
    },
    list: { verbs: { eval: "list.all", view: "view.op" }, parts: { shape: "list" }, summary: "The results of its parts, as a list." },
    if: {
      verbs: { eval: "control.if", view: "view.op" },
      parts: { shape: "record", fields: ["test", "then", "else"] },
      summary: "It evaluates the test, then only the branch that the test selects.",
    },
    ref: { verbs: { eval: "names.ref", view: "view.ref" }, summary: "The value of a name of the context, by its path." },
    seq: {
      verbs: { eval: "control.seq", view: "view.seq" },
      parts: { shape: "list" },
      summary: "Its steps, in order. The result of a named step is a name for the later steps.",
    },
    pure: {
      verbs: { eval: "control.pure", view: "view.op" },
      parts: { shape: "list" },
      summary: "It evaluates its part without capabilities, thus an effect in it fails.",
    },
    log: {
      verbs: { eval: "effect.log", view: "view.op" },
      parts: { shape: "list", of: "text" },
      side: "run",
      summary: "It writes the result of its part to the log. This is an effect.",
    },
    write: {
      verbs: { eval: "effect.write", view: "view.op" },
      parts: { shape: "record", fields: ["value"] },
      side: "run",
      summary: "It writes the result of its part to the store, at its key. This is an effect.",
    },
  },
  defaults: { view: "view.card" },
};

function isNumber(value: Json): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** This function evaluates each part, collects the errors, and gives the values when no part failed. */
function allValues(results: readonly Result[]): { readonly values: readonly Json[] } | { readonly error: Result } {
  const errors = results.filter((result) => !result.ok);
  const first = errors[0];
  if (first !== undefined && errors.length === 1) return { error: first };
  if (errors.length > 1) return { error: fail("#ARGS", `${errors.length} parts failed.`) };
  return { values: results.map((result) => (result.ok ? result.value : null)) };
}

function numbers(values: readonly Json[], kind: string): readonly number[] | Result {
  const bad = values.findIndex((value) => !isNumber(value));
  if (bad !== -1) return fail("#VALUE!", `Part ${bad} of ${kind} is not a number.`);
  return values.filter(isNumber);
}

function dataOf(type: "number" | "string" | "boolean"): Evaluator {
  return ({ data }) =>
    typeof data === type && (type !== "number" || isNumber(data))
      ? ok(data)
      : fail("#VALUE!", `The value must be a ${type === "string" ? "text" : type}.`);
}

/** The code of the evaluators of the standard world, by name. */
export const STD_EVALUATORS: Readonly<Record<string, Evaluator>> = {
  "data.number": dataOf("number"),
  "data.text": dataOf("string"),
  "data.bool": dataOf("boolean"),
  "math.add": ({ parts }) => {
    const all = allValues(parts.map((part) => part.evaluate()));
    if ("error" in all) return all.error;
    const values = numbers(all.values, "add");
    return Array.isArray(values) ? ok(values.reduce((sum, value) => sum + value, 0)) : (values as Result);
  },
  "math.multiply": ({ parts }) => {
    const all = allValues(parts.map((part) => part.evaluate()));
    if ("error" in all) return all.error;
    const values = numbers(all.values, "multiply");
    return Array.isArray(values) ? ok(values.reduce((product, value) => product * value, 1)) : (values as Result);
  },
  "math.greater": ({ parts }) => {
    if (parts.length !== 2) return fail("#VALUE!", "greater needs exactly two parts.");
    const all = allValues(parts.map((part) => part.evaluate()));
    if ("error" in all) return all.error;
    const values = numbers(all.values, "greater");
    if (!Array.isArray(values)) return values as Result;
    const [a, b] = values as readonly number[];
    return ok((a ?? 0) > (b ?? 0));
  },
  "list.all": ({ parts }) => {
    const all = allValues(parts.map((part) => part.evaluate()));
    return "error" in all ? all.error : ok(all.values);
  },
  "control.if": ({ parts }) => {
    const test = parts.find((part) => part.key === "test");
    if (test === undefined) return fail("#VALUE!", "if needs a test.");
    const chosen = test.evaluate();
    if (!chosen.ok) return chosen;
    if (typeof chosen.value !== "boolean") return fail("#VALUE!", "The test of if must give a truth value.");
    const branch = parts.find((part) => part.key === (chosen.value === true ? "then" : "else"));
    return branch === undefined ? ok(null) : branch.evaluate();
  },
  "names.ref": ({ data, context }) => {
    if (typeof data !== "string" || data === "") return fail("#VALUE!", "The value of ref must be a path, for example cards.count.");
    const [name = "", ...rest] = data.split(".");
    if (!context.names.has(name)) return fail("#NAME?", `The context has no name ${name}.`);
    let at: Json | undefined = context.names.get(name);
    for (const key of rest) {
      at = isRecord(at) ? field(at, key) : Array.isArray(at) ? (at as readonly Json[])[Number(key)] : undefined;
      if (at === undefined) return fail("#VALUE!", `The value of ${name} has no field ${key}.`);
    }
    return ok(at ?? null);
  },
  "control.seq": ({ parts, context }) => {
    const names = new Map(context.names);
    let last: Json = null;
    for (const part of parts) {
      const result = part.evaluate({ names, caps: context.caps });
      if (!result.ok) return result;
      if (part.name !== undefined) names.set(part.name, result.value);
      last = result.value;
    }
    return ok(last);
  },
  "control.pure": ({ parts, context }) => {
    const only = parts[0];
    if (only === undefined) return fail("#VALUE!", "pure needs one part.");
    const pureContext: Context = { names: context.names, caps: new Set() };
    return only.evaluate(pureContext);
  },
  "effect.log": ({ parts, effect }) => {
    const all = allValues(parts.map((part) => part.evaluate()));
    if ("error" in all) return all.error;
    const message = all.values.length === 1 ? (all.values[0] ?? null) : all.values;
    return effect("log", message);
  },
  "effect.write": ({ parts, data, effect }) => {
    const key = isRecord(data) ? field(data, "key") : undefined;
    if (typeof key !== "string") return fail("#VALUE!", "write needs a text key.");
    const value = parts.find((part) => part.key === "value");
    if (value === undefined) return fail("#VALUE!", "write needs a value.");
    const result = value.evaluate();
    if (!result.ok) return result;
    const done = effect("write", { key, value: result.value });
    return done.ok ? result : done;
  },
};

/** The machine of the examples: the standard world and its evaluators. */
export const STD_MACHINE: Machine = { world: STD_WORLD, evaluators: STD_EVALUATORS };

/** The capabilities of the examples at the root: the two effects of the standard world. */
export const STD_CAPS: readonly string[] = ["log", "write"];
