import { type Json, type Key, field, isRecord } from "./doc.ts";
import { type Context, type EvalInput, type Evaluator, type Machine, type Part, type Result, type RunPart, type Runner, type Steps, fail, ok } from "./evaluate.ts";
import { Failure } from "./errors.ts";
import { type HostThing, type Thing, type Walker, THING, isHostThing, valueOfThing } from "./deref.ts";
import type { World } from "./ladder.ts";
import { STD_DOMAINS } from "./types.ts";

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
      // An attribute evaluates on demand, thus in an order that is not the order of the document. It causes no effect.
      caps: [{ rule: "mask" }],
      summary: "A node of a tree. Each part is an attribute that evaluates on demand, one time, with the node as self.",
    },
    box: {
      verbs: { eval: "tree.node", view: "view.op" },
      parts: { shape: "record", fields: ["width", "height", "children"], of: "number" },
      caps: [{ rule: "mask" }],
      summary: "A node of a tree, as panel. A formula in a box can read its parent and its siblings.",
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
      scope: [
        { names: { headers: true }, in: [["*"]], sequential: true },
        { names: { fixed: ["last"] }, in: [["*"]], sequential: true },
      ],
      summary: "Its steps, in order. The result of a named step is a name for the later steps.",
    },
    pure: {
      verbs: { eval: "control.pure", view: "view.op" },
      parts: { shape: "list" },
      caps: [{ rule: "mask" }],
      summary: "It evaluates its part without capabilities, thus an effect in it fails.",
    },
    log: {
      verbs: { eval: "effect.log", view: "view.op" },
      parts: { shape: "list", of: "text" },
      side: "run",
      effects: ["log"],
      summary: "It writes the result of its part to the log. This is an effect.",
    },
    write: {
      verbs: { eval: "effect.write", view: "view.op" },
      parts: { shape: "record", fields: ["value"] },
      side: "run",
      effects: ["write"],
      summary: "It writes the result of its part to the store, at its key. This is an effect.",
    },
  },
  defaults: { view: "view.card" },
};

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** This function evaluates each part, collects the errors, and gives the values when no part failed. */
function allValues(results: readonly Result[]): { readonly values: readonly unknown[] } | { readonly error: Result } {
  const errors = results.filter((result) => !result.ok);
  const first = errors[0];
  if (first !== undefined && errors.length === 1) return { error: first };
  if (errors.length > 1) return { error: fail("#ARGS", `${errors.length} parts failed.`) };
  return { values: results.map((result) => (result.ok ? result.value : null)) };
}

function numbers(values: readonly unknown[], kind: string): readonly number[] | Result {
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
  "data.number": /* @__PURE__ */ dataOf("number"),
  "data.text": /* @__PURE__ */ dataOf("string"),
  "data.bool": /* @__PURE__ */ dataOf("boolean"),
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
  "ref.resolve": ({ data, resolve }) => {
    if (!Array.isArray(data) || data.length === 0) {
      return fail("#VALUE!", "The value of ref is a path: a list that starts with a root, for example [\"names\", \"a\"].");
    }
    const found = resolve(data as readonly Json[]);
    return found.ok ? ok(valueOfThing(found.thing)) : fail(found.code, found.reason);
  },
  "tree.node": (input) => treeNode(input),
};

/*
 * The decorated tree (TREE.*, R3 P1). Each node is a host thing, and each part of a node is an attribute. An attribute
 * evaluates on demand, with the node as self. One memo cell for each node and attribute keeps its result for one
 * evaluation. The structure comes first: a node inside an attribute of an open tree gives its thing and evaluates
 * nothing. The root gives the JSON of the tree. Thus a reference to a sibling reads the finished list of children.
 */

/** The brand of a node of the decorated tree. Its value is the state that the kit reads. */
const TREE_NODE: unique symbol = /* @__PURE__ */ Symbol.for("coeval.tree.node") as never;

/** One tree in one evaluation. It is open until its root gives the JSON of the tree. */
interface TreeBuild {
  open: boolean;
}

/** The state of a node behind its brand. */
interface NodeState {
  readonly build: TreeBuild;
  readonly type: string;
  readonly place: readonly Key[];
  /**
   * This function gives the JSON of the node: each attribute in the order of the parts, with the JSON of each node in
   * its value.
   *
   * @param path - The nodes and the containers whose JSON is in progress. A node on it gives `#CYCLE!`.
   * @returns The JSON, or the first error.
   */
  json(path: Set<object>): Result;
}

/** The memo cell of one attribute: in evaluation, or done with its result. */
type Cell = { readonly busy: true } | { readonly busy: false; readonly result: Result };

const BUSY: Cell = /* @__PURE__ */ Object.freeze({ busy: true });

/** One attribute in evaluation. The text names it in the reason of a cycle. */
interface Demand {
  readonly cells: Map<string, Cell>;
  readonly key: string;
  readonly text: string;
}

/** The attributes in evaluation, in the order of their demands. An evaluation does not wait, thus one list serves. */
const demands: Demand[] = [];

function attributeText(key: string, type: string, place: readonly Key[]): string {
  return `${key} of ${type} at [${place.join(", ")}]`;
}

/** This function gives the `#CYCLE!` of a demand that reached an attribute in evaluation, with the chain of demands. */
function cycleAt(cells: Map<string, Cell>, key: string, text: string): Result {
  const first = demands.findIndex((demand) => demand.cells === cells && demand.key === key);
  const chain = first === -1 ? [text] : demands.slice(first).map((demand) => demand.text);
  chain.push(text);
  return fail("#CYCLE!", `The attributes form a cycle: ${chain.join(" -> ")}.`);
}

function stateOf(thing: unknown): NodeState | undefined {
  return typeof thing === "object" && thing !== null ? (thing as { readonly [TREE_NODE]?: NodeState })[TREE_NODE] : undefined;
}

/** This function sets an own field, also the field `__proto__` (SHAPE.PROTO). */
function putField(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * This function gives a value with the JSON of each node of a tree in it. A list or a plain record is new only when
 * it holds a node. A container that holds itself stays as it is.
 */
function plainOf(value: unknown, path: Set<object>): Result {
  const state = stateOf(value);
  if (state !== undefined) {
    if (path.has(value as object)) return fail("#CYCLE!", `The JSON of the node ${state.type} at [${state.place.join(", ")}] holds the node itself.`);
    return state.json(path);
  }
  if (typeof value !== "object" || value === null || path.has(value) || isHostThing(value)) return ok(value);
  if (!Array.isArray(value) && !isRecord(value)) return ok(value);
  path.add(value);
  try {
    if (Array.isArray(value)) {
      let list: unknown[] | undefined;
      for (let index = 0; index < value.length; index += 1) {
        const item = plainOf(value[index], path);
        if (!item.ok) return item;
        if (item.value !== value[index]) (list ??= [...(value as readonly unknown[])])[index] = item.value;
      }
      return ok(list ?? value);
    }
    const record = value as Readonly<Record<string, unknown>>;
    let out: Record<string, unknown> | undefined;
    for (const key of Object.keys(record)) {
      const item = plainOf(record[key], path);
      if (!item.ok) return item;
      if (item.value === record[key]) continue;
      if (out === undefined) {
        out = {};
        for (const other of Object.keys(record)) putField(out, other, record[other]);
      }
      putField(out, key, item.value);
    }
    return ok(out ?? value);
  } finally {
    path.delete(value);
  }
}

/**
 * This function makes a node of the decorated tree. A step `parent` gives the self of the context of the node, and a
 * step `type` gives its type. A step with the key of a part reads that attribute. A failed attribute throws `Failure`
 * with its own error, thus a reference to it gives that error.
 */
function treeThing(parts: readonly Part[], context: Context, type: string, place: readonly Key[], build: TreeBuild): HostThing {
  const cells = new Map<string, Cell>();
  const read = (key: string): Result | undefined => {
    const cell = cells.get(key);
    if (cell !== undefined) return cell.busy ? cycleAt(cells, key, attributeText(key, type, place)) : cell.result;
    const part = parts.find((item) => item.key === key);
    if (part === undefined) return undefined;
    cells.set(key, BUSY);
    demands.push({ cells, key, text: attributeText(key, type, place) });
    let result: Result;
    try {
      result = part.evaluate({ ...context, self: node });
    } catch (error) {
      // An exception of the host, for example an overflow of the stack, leaves the attribute without a result.
      cells.delete(key);
      throw error;
    } finally {
      demands.pop();
    }
    cells.set(key, { busy: false, result });
    return result;
  };
  const state: NodeState = {
    build,
    type,
    place,
    json(path) {
      path.add(node);
      try {
        const out: Record<string, unknown> = {};
        for (const part of parts) {
          const result = read(part.key) as Result;
          if (!result.ok) return result;
          const value = plainOf(result.value, path);
          if (!value.ok) return value;
          putField(out, part.key, value.value);
        }
        return ok(out);
      } finally {
        path.delete(node);
      }
    },
  };
  const node: HostThing & { readonly type: string; readonly [TREE_NODE]: NodeState } = {
    [THING]: true,
    [TREE_NODE]: state,
    type,
    label: `node ${type}`,
    deref(key: Key): Thing | undefined {
      if (key === "parent") return context.self;
      if (key === "type") return type;
      const result = read(String(key));
      if (result === undefined) return undefined;
      if (!result.ok) throw new Failure(result.error);
      return result.value;
    },
    has(key: Key): boolean {
      // DEREF.HOST-UNDEFINED: an attribute with the value undefined is a field, not a missing step.
      return key === "parent" || key === "type" || parts.some((part) => part.key === String(key));
    },
    toJson(): unknown {
      const result = state.json(new Set());
      if (!result.ok) throw new Failure(result.error);
      return result.value;
    },
  };
  return node;
}

/**
 * This function evaluates a node of the decorated tree. Inside an attribute of an open tree, the node gives its host
 * thing, and no attribute evaluates. Else the node is the root of a new tree, and it gives the JSON of the tree.
 */
function treeNode({ parts, context, kind, place }: EvalInput): Result {
  const above = stateOf(context.self);
  if (above !== undefined && above.build.open) return ok(treeThing(parts, context, kind, place, above.build));
  const build: TreeBuild = { open: true };
  const root = treeThing(parts, context, kind, place, build);
  try {
    return (stateOf(root) as NodeState).json(new Set());
  } finally {
    build.open = false;
  }
}

/** The options of a walker `nearest`. */
export interface NearestOptions {
  /**
   * This function tells if a node has the wanted type. The default compares the field `type` of a host thing.
   *
   * @param node - The node that the walk reached.
   * @param wanted - The type that the step document asks for.
   * @returns `true` when the node has the type.
   */
  readonly matches?: (node: Thing, wanted: Json | undefined) => boolean;
  /** The most hops of one walk. The default is 256. */
  readonly maxHops?: number;
}

function hostType(node: Thing, wanted: Json | undefined): boolean {
  return isHostThing(node) && (node as { readonly type?: unknown }).type === wanted;
}

/**
 * This function makes a walker `nearest`. The walker follows a key (the default is `parent`) until the node that it
 * reaches has the wanted type. With `self: true`, the node where the walk starts is the first candidate. A node
 * without that key ends the walk with an error.
 *
 * @param options - The test of a type and the most hops.
 * @returns The walker.
 */
export function nearestWalker(options: NearestOptions = {}): Walker {
  const matches = options.matches ?? hostType;
  const maxHops = options.maxHops ?? 256;
  return ({ data, here, deref }) => {
    const follow = isRecord(data) && typeof field(data, "follow") === "string" ? String(field(data, "follow")) : "parent";
    const wanted = isRecord(data) ? field(data, "type") : undefined;
    const fromSelf = isRecord(data) && field(data, "self") === true;
    let at: Thing | undefined = here;
    for (let hops = 0; hops < maxHops; hops += 1) {
      if (hops > 0 || !fromSelf) at = at === undefined || at === null ? undefined : deref(at, follow);
      if (at === undefined || at === null) return { ok: false, reason: `No node of the type ${String(wanted)} is on the way.` };
      if (matches(at, wanted)) return { ok: true, thing: at };
    }
    return { ok: false, reason: "The walk is too long." };
  };
}

const nearest: Walker = /* @__PURE__ */ nearestWalker();

/** The walkers of the standard world, by name. */
export const STD_WALKERS: Readonly<Record<string, Walker>> = { "walk.nearest": nearest };

/** This function evaluates parts one after the other, and stops at the first error. */
function* inOrder(parts: readonly RunPart[]): Generator<Promise<unknown>, { readonly values: readonly unknown[] } | { readonly error: Result }, unknown> {
  const values: unknown[] = [];
  for (const part of parts) {
    const result = yield* part.evaluate();
    if (!result.ok) return { error: result };
    values.push(result.value);
  }
  return { values };
}

/**
 * The runners of the standard world, by name: the kinds that can hold effects. Each one evaluates its parts in
 * order. In a run, an effect ends before the next step starts.
 */
export const STD_RUNNERS: Readonly<Record<string, Runner>> = {
  "control.seq": function* ({ parts, context }): Steps {
    let names: Record<string, unknown> = { ...context.names };
    let last: unknown = null;
    for (const part of parts) {
      const result = yield* part.evaluate({ ...context, names });
      if (!result.ok) return result;
      names = { ...names, last: result.value };
      if (part.name !== undefined) names = { ...names, [part.name]: result.value };
      last = result.value;
    }
    return ok(last);
  },
  // The contract of pure masks the capabilities of its part, and the kernel applies it. Thus the runner does not.
  "control.pure": function* ({ parts }) {
    const only = parts[0];
    if (only === undefined) return fail("#VALUE!", "pure needs one part.");
    return yield* only.evaluate();
  },
  "control.if": function* ({ parts }) {
    const test = parts.find((part) => part.key === "test");
    if (test === undefined) return fail("#VALUE!", "if needs a test.");
    const chosen = yield* test.evaluate();
    if (!chosen.ok) return chosen;
    if (typeof chosen.value !== "boolean") return fail("#VALUE!", "The test of if must give a truth value.");
    const branch = parts.find((part) => part.key === (chosen.value === true ? "then" : "else"));
    return branch === undefined ? ok(null) : yield* branch.evaluate();
  },
  "list.all": function* ({ parts }) {
    const all = yield* inOrder(parts);
    return "error" in all ? all.error : ok(all.values);
  },
  "effect.log": function* ({ parts, effect }) {
    const all = yield* inOrder(parts);
    if ("error" in all) return all.error;
    return yield* effect("log", all.values.length === 1 ? (all.values[0] ?? null) : all.values);
  },
  "effect.write": function* ({ parts, data, effect }) {
    const key = isRecord(data) ? field(data, "key") : undefined;
    if (typeof key !== "string") return fail("#VALUE!", "write needs a text key.");
    const value = parts.find((part) => part.key === "value");
    if (value === undefined) return fail("#VALUE!", "write needs a value.");
    const result = yield* value.evaluate();
    if (!result.ok) return result;
    return yield* effect("write", { key, value: result.value });
  },
};

/** The machine of the examples: the standard world, its evaluators, its runners, its walkers and the domains of the kernel. */
export const STD_MACHINE: Machine = { world: STD_WORLD, evaluators: STD_EVALUATORS, runners: STD_RUNNERS, walkers: STD_WALKERS, domains: STD_DOMAINS };

/** The capabilities of the examples at the root: the two effects of the standard world. */
export const STD_CAPS: readonly string[] = ["log", "write"];
