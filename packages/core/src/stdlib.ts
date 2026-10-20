import { type Json, type Key, field, isRecord } from "./doc.ts";
import { type Context, type Evaluator, type Machine, type Part, type Result, fail, ok } from "./evaluate.ts";
import { type HostThing, type Thing, type Walker, THING, isHostThing, valueOfThing } from "./deref.ts";
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
    ref: {
      verbs: { eval: "ref.resolve", view: "view.ref" },
      summary: "A path from a root of the context. Each step goes up the ladder of the verb deref.",
    },
    nearest: {
      verbs: { step: "walk.nearest", view: "view.card" },
      summary: "A step of a path: it follows a key again and again, until it reaches a node of a type.",
    },
    panel: {
      verbs: { eval: "tree.node", view: "view.op" },
      parts: { shape: "record", fields: ["width", "height", "children"], of: "number" },
      summary: "A node of a tree. Its parts see it as self, and each node links to its parent.",
    },
    box: {
      verbs: { eval: "tree.node", view: "view.op" },
      parts: { shape: "record", fields: ["width", "height", "children"], of: "number" },
      summary: "A node of a tree, as panel. A formula in a box can read the parent of the box.",
    },
    math: {
      kinds: {
        sum: { type: "ref", value: ["world", "add"] },
        product: { type: "ref", value: ["world", "multiply"] },
      },
    },
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
  "ref.resolve": ({ data, resolve }) => {
    if (!Array.isArray(data) || data.length === 0) {
      return fail("#VALUE!", "The value of ref is a path: a list that starts with a root, for example [\"names\", \"a\"].");
    }
    const path: readonly Json[] = data;
    const found = resolve(path);
    if (found.ok) return ok(valueOfThing(found.thing));
    if (path[0] === "names" && found.hops.length === 1) return fail("#NAME?", `The context has no name ${String(path[1])}.`);
    return fail(found.code, found.reason);
  },
  "control.seq": ({ parts, context }) => {
    let names: Record<string, Json> = { ...context.names };
    let last: Json = null;
    for (const part of parts) {
      const result = part.evaluate({ ...context, names });
      if (!result.ok) return result;
      names = { ...names, last: result.value };
      if (part.name !== undefined) names = { ...names, [part.name]: result.value };
      last = result.value;
    }
    return ok(last);
  },
  "control.pure": ({ parts, context }) => {
    const only = parts[0];
    if (only === undefined) return fail("#VALUE!", "pure needs one part.");
    const pureContext: Context = { ...context, caps: [] };
    return only.evaluate(pureContext);
  },
  "tree.node": (input) => treeNode(input.parts, input.context, input.kind),
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

/**
 * This function evaluates a node of a tree. The node is a host thing. A step `parent` reaches the node that holds
 * it. A step with the name of a part evaluates that part on demand, one time. Each part sees the node as self.
 */
function treeNode(parts: readonly Part[], context: Context, type: string): Result {
  const memo = new Map<string, Result>();
  const read = (key: string): Result | undefined => {
    const known = memo.get(key);
    if (known !== undefined) return known;
    const part = parts.find((item) => item.key === key);
    if (part === undefined) return undefined;
    const result = part.evaluate({ ...context, self: me });
    memo.set(key, result);
    return result;
  };
  const me: HostThing & { readonly type: string } = {
    [THING]: true,
    type,
    label: `node ${type}`,
    deref(key: Key): Thing | undefined {
      if (key === "parent") return context.self;
      if (key === "type") return type;
      const result = read(String(key));
      return result?.ok === true ? result.value : undefined;
    },
    toJson(): Json {
      const out: Record<string, Json> = {};
      for (const part of parts) {
        const result = read(part.key);
        out[part.key] = result?.ok === true ? result.value : null;
      }
      return out;
    },
  };
  const out: Record<string, Json> = {};
  for (const part of parts) {
    const result = read(part.key);
    if (result === undefined) continue;
    if (!result.ok) return result;
    out[part.key] = result.value;
  }
  return ok(out);
}

/**
 * The walker of `nearest`: it follows a key (the default is `parent`) until the node that it reaches has the
 * wanted type. With `self: true`, the node where the walk starts is the first candidate. A node without that key
 * ends the walk with an error.
 */
const nearest: Walker = ({ data, here, deref }) => {
  const follow = isRecord(data) && typeof field(data, "follow") === "string" ? String(field(data, "follow")) : "parent";
  const wanted = isRecord(data) ? field(data, "type") : undefined;
  const fromSelf = isRecord(data) && field(data, "self") === true;
  let at: Thing | undefined = here;
  for (let hops = 0; hops < 256; hops += 1) {
    if (hops > 0 || !fromSelf) at = at === undefined || at === null ? undefined : deref(at, follow);
    if (at === undefined || at === null) return { ok: false, reason: `No node of the type ${String(wanted)} is on the way.` };
    const type = isHostThing(at) ? (at as { readonly type?: unknown }).type : undefined;
    if (type === wanted) return { ok: true, thing: at };
  }
  return { ok: false, reason: "The walk is too long." };
};

/** The walkers of the standard world, by name. */
export const STD_WALKERS: Readonly<Record<string, Walker>> = { "walk.nearest": nearest };

/** The machine of the examples: the standard world, its evaluators and its walkers. */
export const STD_MACHINE: Machine = { world: STD_WORLD, evaluators: STD_EVALUATORS, walkers: STD_WALKERS };

/** The capabilities of the examples at the root: the two effects of the standard world. */
export const STD_CAPS: readonly string[] = ["log", "write"];
