import { type Json, type Key, field, isRecord } from "./doc.ts";
import {
  type EvalInput,
  type Evaluator,
  type Machine,
  type Plan,
  type Result,
  type RunPart,
  type Runner,
  type Steps,
  fail,
  ok,
  planner,
} from "./evaluate.ts";
import { Failure } from "./errors.ts";
import { type Cap, type HostThing, type Thing, type Walker, THING, isHostThing, valueOfThing } from "./deref.ts";
import type { World } from "./ladder.ts";
import { type AttributeDeclaration, type TreeContract, equationType, lookupKind } from "./world.ts";
import { STD_DOMAINS } from "./types.ts";
import type { SyntaxProfile } from "./syntax.ts";

/**
 * The world of the examples: small kinds for numbers, lists, conditions, names, sequences and effects.
 * Each kind names an evaluator for `eval` and a view for `view`. The site draws each document with its view.
 */
export const STD_WORLD: World = {
  kinds: {
    number: { verbs: { eval: "data.number", view: "view.value" }, pure: true, summary: "A number. Its value is the result." },
    text: { verbs: { eval: "data.text", view: "view.value" }, pure: true, summary: "A text. Its value is the result." },
    bool: { verbs: { eval: "data.bool", view: "view.value" }, pure: true, summary: "A truth value. Its value is the result." },
    add: {
      verbs: { eval: "math.add", view: "view.op" },
      parts: { shape: "list", of: "number" },
      pure: true,
      summary: "The sum of its parts. A bare number in its list gets the type number.",
    },
    multiply: {
      verbs: { eval: "math.multiply", view: "view.op" },
      parts: { shape: "list", of: "number" },
      pure: true,
      summary: "The product of its parts.",
    },
    greater: {
      verbs: { eval: "math.greater", view: "view.op" },
      parts: { shape: "list", of: "number" },
      pure: true,
      summary: "True when the first part is greater than the second part.",
    },
    list: { verbs: { eval: "list.all", view: "view.op" }, parts: { shape: "list" }, pure: true, summary: "The results of its parts, as a list." },
    if: {
      verbs: { eval: "control.if", view: "view.op" },
      parts: { shape: "record", fields: ["test", "then", "else"] },
      pure: true,
      lazy: [{ in: [["then"], ["else"]] }],
      summary: "It evaluates the test, then only the branch that the test selects.",
    },
    ref: {
      verbs: { eval: "ref.resolve", view: "view.ref" },
      pure: true,
      summary: "A path from a root of the context. Each step goes up the ladder of the verb deref.",
    },
    nearest: {
      verbs: { step: "walk.nearest", view: "view.card" },
      pure: true,
      summary: "A step of a path: it follows a key again and again, until it reaches a node of a type.",
    },
    panel: {
      verbs: { eval: "tree.node", view: "view.op" },
      parts: { shape: "record", fields: ["width", "height", "children"], of: "number" },
      // An attribute evaluates on demand, thus in an order that is not the order of the document. It causes no effect.
      caps: [{ rule: "mask" }],
      // A node that nothing reads keeps its attributes without an evaluation (TREE.LAZY).
      pure: true,
      lazy: [{}],
      // The code resolves self to find an open tree and the parent (C4, D44).
      reads: ["self"],
      summary: "A node of a tree. Each part is an attribute that evaluates on demand, one time, with the node as self.",
    },
    box: {
      verbs: { eval: "tree.node", view: "view.op" },
      parts: { shape: "record", fields: ["width", "height", "children"], of: "number" },
      caps: [{ rule: "mask" }],
      pure: true,
      lazy: [{}],
      reads: ["self"],
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
      pure: true,
      summary: "Its steps, in order. The result of a named step is a name for the later steps.",
    },
    pure: {
      verbs: { eval: "control.pure", view: "view.op" },
      parts: { shape: "list" },
      caps: [{ rule: "mask" }],
      // The runner evaluates only the first part.
      pure: true,
      lazy: [{ after: 1 }],
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

/**
 * The text syntax of the standard world (K162, D64). The syntax kit (D41) reads it, thus a host of `STD_WORLD` does
 * not write its own profile. The operators `>`, `+` and `*` make `greater`, `add` and `multiply`. A call form makes
 * each other kind, and `ref` uses the reference syntax of the kit.
 *
 * A literal in a place that takes a document gets its data envelope (K159, D65). Such a place is a part of `if`,
 * `list`, `seq` or `pure`, the value of `write`, or the whole text. The document after a header name is such a place
 * too. Thus `list(1, "a")` evaluates to `[1, "a"]`. The forms `add`, `multiply` and `greater` write an operator document that its operator
 * does not write, for example `add(5)` (K163).
 *
 * A host with more kinds spreads this profile and adds its forms to `calls.forms`. `STD_SYNTAX` stays the profile of
 * the formula kit.
 */
export const WORLD_SYNTAX: SyntaxProfile = /* @__PURE__ */ Object.freeze({
  operators: [
    { symbol: ">", fixity: "infix", prec: 4, assoc: "none", kind: "greater" },
    { symbol: "+", fixity: "infix", prec: 5, assoc: "flat", kind: "add" },
    { symbol: "*", fixity: "infix", prec: 6, assoc: "flat", kind: "multiply" },
  ],
  calls: {
    ops: [],
    forms: [
      { name: "if", kind: "if", fields: ["test", "then", "else"], min: 2, wrap: true },
      { name: "list", kind: "list", wrap: true },
      { name: "seq", kind: "seq", wrap: true },
      { name: "pure", kind: "pure", min: 1, wrap: true },
      { name: "log", kind: "log", min: 1 },
      { name: "write", kind: "write", fields: ["key", "value"], wrap: ["value"] },
      { name: "math.sum", kind: "math.sum" },
      { name: "math.product", kind: "math.product" },
      { name: "number", kind: "number", args: "literal" },
      { name: "text", kind: "text", args: "literal" },
      { name: "bool", kind: "bool", args: "literal" },
      { name: "panel", kind: "panel", args: "named", fields: ["width", "height", "children"] },
      { name: "box", kind: "box", args: "named", fields: ["width", "height", "children"] },
      { name: "nearest", kind: "nearest", args: "named", fields: ["type", "follow", "self"] },
      // An operator document with fewer terms than its operator takes, for example add(5) (K163, D65).
      { name: "add", kind: "add" },
      { name: "multiply", kind: "multiply" },
      { name: "greater", kind: "greater" },
    ],
  },
  literals: { envelopes: { number: "number", text: "text", bool: "bool" } },
  header: { bind: "=" },
} satisfies SyntaxProfile);

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

/** The rungs of the ladder of an attribute, in their order (TREE.LADDER, D42). */
export type AttributeRung = "own" | "kind" | "parent" | "copy" | "default";

/** The rungs of the ladder of an attribute, in their order (TREE.LADDER, D42). */
export const ATTRIBUTE_RUNGS: readonly AttributeRung[] = /* @__PURE__ */ Object.freeze(["own", "kind", "parent", "copy", "default"] as const);

/** The record of the demand of one attribute of a node (TREE.RUNGS). */
export interface AttributeTrace {
  readonly attribute: string;
  /** The rungs that the demand visited, in their order. The last one answered, unless no rung answered. */
  readonly rungs: readonly AttributeRung[];
  /** The rung that answered. It is `undefined` when no rung answered. */
  readonly by?: AttributeRung;
}

/** The state of a node behind its brand. */
interface NodeState {
  readonly build: TreeBuild;
  readonly type: string;
  readonly place: readonly Key[];
  /** The tree contract of the kind of the node (D42). */
  readonly tree: TreeContract | undefined;
  /**
   * This function gives an attribute through its ladder (TREE.LADDER).
   *
   * @param key - The name of the attribute.
   * @returns The result, or `undefined` when no rung answers.
   */
  read(key: string): Result | undefined;
  /**
   * This function evaluates an equation of the kind of the node, with the node as `self` and no capabilities.
   *
   * @param term - The equation.
   * @param names - The names that the equation sees.
   * @returns The result.
   */
  equation(term: Json, names: Readonly<Record<string, unknown>>): Result;
  /**
   * This function gives the names of a child for an equation of `down`: `child`, `index` and `prev` (TREE.DOWN).
   *
   * @param child - The thing of the child.
   * @returns The names, or the error of the list `children`.
   */
  childNames(child: HostThing): Result;
  /**
   * This function gives the record of the demand of an attribute that ended (TREE.RUNGS).
   *
   * @param key - The name of the attribute.
   * @returns The record, or `undefined` before the end of the demand.
   */
  trace(key: string): AttributeTrace | undefined;
  /**
   * This function gives the JSON of the node: each attribute in the order of the parts, with the JSON of each node in
   * its value.
   *
   * @param path - The nodes and the containers whose JSON is in progress. A node on it gives `#CYCLE!`.
   * @returns The JSON, or the first error.
   */
  json(path: Set<object>): Result;
}

/**
 * The memo cell of one attribute: in evaluation, or done with its result and the rung that answered. A done cell
 * without a result tells that no rung answered.
 */
type Cell = { readonly busy: true } | { readonly busy: false; readonly result: Result | undefined; readonly by: AttributeRung | undefined };

/** The capabilities of an equation: none (CAP.PURE). */
const NO_CAPS: readonly Cap[] = /* @__PURE__ */ Object.freeze([]);

/** The names of an equation of `equations`, of a `unit` and of a `default`. */
const NO_NAMES: Readonly<Record<string, unknown>> = /* @__PURE__ */ Object.freeze({});

/** The planners of equations, for each machine and each type of a bare equation (TREE.PLAN). */
const equationPlanners = /* @__PURE__ */ new WeakMap<Machine, Map<string, (doc: unknown) => Plan>>();

/**
 * This function gives the plan of an equation. Each equation compiles one time for each machine (PLAN.CACHE). The
 * plan of the document does not keep it (PLAN.LEAN).
 */
function equationPlan(machine: Machine, of: string | undefined, term: Json): Plan {
  let byType = equationPlanners.get(machine);
  if (byType === undefined) {
    byType = new Map();
    equationPlanners.set(machine, byType);
  }
  const key = of ?? "";
  let plans = byType.get(key);
  if (plans === undefined) {
    plans = planner(machine, of === undefined ? {} : { declaredType: of });
    byType.set(key, plans);
  }
  return plans(term);
}

/** This function gives the own entry of a table of a tree contract, or `undefined`. */
function entryOf<T>(table: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return table !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

/** The contract of the kind of a node: its tree contract and the type of a bare equation. */
interface NodeContract {
  readonly tree: TreeContract | undefined;
  readonly of: string | undefined;
}

const NO_CONTRACT: NodeContract = /* @__PURE__ */ Object.freeze({ tree: undefined, of: undefined });

/** This function finds the tree contract of the kind of a node in the world of the machine. */
function contractOf(machine: Machine | undefined, typePath: readonly Key[]): NodeContract {
  if (machine === undefined || typePath.length === 0) return NO_CONTRACT;
  const found = lookupKind(machine.world, typePath);
  if (!found.ok || found.kind.tree === undefined) return NO_CONTRACT;
  return { tree: found.kind.tree, of: equationType(found.kind) };
}

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
 * step `type` gives its type. Another step reads an attribute through its ladder (TREE.LADDER). The rungs are a part of
 * the node, an equation of its kind and an equation `down` of the kind of its parent. A copy from the parent, then a
 * fold or a default, come last. A failed attribute throws `Failure` with its own error, thus a reference to it gives that error.
 * The argument `outer` is the self of the context, that `treeNode` resolved. The node reads no root of the context directly (C4).
 */
function treeThing(input: EvalInput, build: TreeBuild, outer: Thing | undefined): HostThing {
  const { parts, context, kind: type, place, machine } = input;
  const { tree, of } = contractOf(machine, input.typePath);
  const above = stateOf(outer);
  // Only a node of the same tree is a parent for the rungs `parent` and `copy`.
  const up = above !== undefined && above.build === build ? above : undefined;
  const cells = new Map<string, Cell>();
  /** The positions of the items of the list `children`, for the names of the children. */
  let positions: { readonly list: readonly unknown[]; readonly at: Map<unknown, number> } | undefined;

  const fold = (key: string, declared: NonNullable<AttributeDeclaration["fold"]>): Result => {
    let acc = state.equation(declared.unit, NO_NAMES);
    if (!acc.ok) return acc;
    const children = read("children");
    if (children === undefined) return acc;
    if (!children.ok) return children;
    if (!Array.isArray(children.value)) return fail("#VALUE!", `The fold of ${key} needs a list in children.`);
    for (const item of children.value as readonly unknown[]) {
      const child = stateOf(item);
      // An item that is not a node of this tree does not count.
      if (child === undefined || child.build !== build) continue;
      const value = child.read(key);
      if (value === undefined) return fail("#N/A", `No rung gives ${attributeText(key, child.type, child.place)}.`);
      if (!value.ok) return value;
      acc = state.equation(declared.combine, { acc: acc.value, item: value.value });
      if (!acc.ok) return acc;
    }
    return acc;
  };

  /** This function visits the rungs of the ladder of an attribute in their order, until one answers. */
  const climb = (key: string): { readonly result: Result; readonly by: AttributeRung } | undefined => {
    const part = parts.find((item) => item.key === key);
    if (part !== undefined) return { result: part.evaluate({ ...context, self: node }), by: "own" };
    const equation = entryOf(tree?.equations, key);
    if (equation !== undefined) return { result: state.equation(equation, NO_NAMES), by: "kind" };
    const down = up === undefined ? undefined : entryOf(up.tree?.down, key);
    if (up !== undefined && down !== undefined) {
      const names = up.childNames(node);
      return { result: names.ok ? up.equation(down, names.value as Readonly<Record<string, unknown>>) : names, by: "parent" };
    }
    const declared = entryOf(tree?.attributes, key);
    if (declared?.copy === true && up !== undefined) {
      const copied = up.read(key);
      if (copied !== undefined) return { result: copied, by: "copy" };
    }
    if (declared?.fold !== undefined) return { result: fold(key, declared.fold), by: "default" };
    if (declared?.default !== undefined) return { result: state.equation(declared.default, NO_NAMES), by: "default" };
    return undefined;
  };

  const read = (key: string): Result | undefined => {
    const cell = cells.get(key);
    if (cell !== undefined) return cell.busy ? cycleAt(cells, key, attributeText(key, type, place)) : cell.result;
    // A node without a contract has only its parts, as before D42. Thus a missing part needs no cell.
    if (tree === undefined && up?.tree === undefined && !parts.some((item) => item.key === key)) return undefined;
    cells.set(key, BUSY);
    demands.push({ cells, key, text: attributeText(key, type, place) });
    let answer: { readonly result: Result; readonly by: AttributeRung } | undefined;
    try {
      answer = climb(key);
    } catch (error) {
      // An exception of the host, for example an overflow of the stack, leaves the attribute without a result.
      cells.delete(key);
      throw error;
    } finally {
      demands.pop();
    }
    cells.set(key, { busy: false, result: answer?.result, by: answer?.by });
    return answer?.result;
  };

  const state: NodeState = {
    build,
    type,
    place,
    tree,
    read,
    equation(term, names) {
      if (machine === undefined) return fail("#NOEVAL", "The evaluation of an equation needs the machine.");
      return equationPlan(machine, of, term).evaluate({ ...context, names, caps: NO_CAPS, self: node });
    },
    childNames(child) {
      const children = read("children");
      if (children !== undefined && !children.ok) return children;
      const list = children !== undefined && Array.isArray(children.value) ? (children.value as readonly unknown[]) : [];
      if (positions?.list !== list) {
        const at = new Map<unknown, number>();
        list.forEach((item, index) => {
          if (!at.has(item)) at.set(item, index);
        });
        positions = { list, at };
      }
      const index = positions.at.get(child);
      return ok({ child, index: index ?? null, prev: index === undefined || index === 0 ? null : list[index - 1] });
    },
    trace(key) {
      const cell = cells.get(key);
      if (cell === undefined || cell.busy) return undefined;
      const rungs = cell.by === undefined ? ATTRIBUTE_RUNGS : ATTRIBUTE_RUNGS.slice(0, ATTRIBUTE_RUNGS.indexOf(cell.by) + 1);
      return cell.by === undefined ? { attribute: key, rungs } : { attribute: key, rungs, by: cell.by };
    },
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
      if (key === "parent") return outer;
      if (key === "type") return type;
      const result = read(String(key));
      if (result === undefined) return undefined;
      if (!result.ok) throw new Failure(result.error);
      return result.value;
    },
    has(key: Key): boolean {
      // DEREF.HOST-UNDEFINED: an attribute with the value undefined is a field, not a missing step.
      if (key === "parent" || key === "type" || parts.some((part) => part.key === String(key))) return true;
      const cell = cells.get(String(key));
      return cell !== undefined && !cell.busy && cell.result !== undefined;
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
 * This function gives the record of the demand of an attribute of a node of the decorated tree (TREE.RUNGS). The
 * record holds the rungs that the demand visited, and the rung that answered. An explorer draws the ladder with it.
 *
 * @param node - The thing of a node.
 * @param attribute - The name of the attribute.
 * @returns The record, or `undefined` for a thing that is not a node or an attribute that no demand reached.
 */
export function attributeTrace(node: Thing, attribute: string): AttributeTrace | undefined {
  return stateOf(node)?.trace(attribute);
}

/**
 * This function gives the place of a node of the decorated tree: the keys from the root document to the document of
 * the node (HOP.PLACE). A view puts each hop of a resolution on its node with it. The node keeps its place already,
 * thus the function adds no record.
 *
 * @param thing - A thing, for example the thing of a hop.
 * @returns The keys of the place, or `undefined` for a thing that is not a node of the decorated tree.
 */
export function placeOf(thing: Thing): readonly Key[] | undefined {
  return stateOf(thing)?.place;
}

/** The path of the root `self`. A node of the tree resolves it, thus the list of reads holds the read (C4). */
const SELF_PATH: readonly Json[] = /* @__PURE__ */ Object.freeze(["self"]);

/** The options of the resolution of `self`: the node needs no hops. */
const NO_HOPS = /* @__PURE__ */ Object.freeze({ hops: false });

/**
 * This function evaluates a node of the decorated tree. Inside an attribute of an open tree, the node gives its host
 * thing, and no attribute evaluates. Else the node is the root of a new tree, and it gives the JSON of the tree. The
 * node reads `self` through `resolve` (C4, D44). A machine that closes the root `self` thus gives no nested trees.
 */
function treeNode(input: EvalInput): Result {
  const found = input.resolve(SELF_PATH, NO_HOPS);
  const outer = found.ok ? found.thing : undefined;
  const above = stateOf(outer);
  if (above !== undefined && above.build.open) return ok(treeThing(input, above.build, outer));
  const build: TreeBuild = { open: true };
  const root = treeThing(input, build, outer);
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
  /**
   * `true`: the walk records one hop for each node on the way before the node that it reaches (HOP.EACH-STEP). Each
   * such hop has the followed key as its step. The default is `false`: one hop for the whole walk.
   */
  readonly eachStep?: boolean;
}

function hostType(node: Thing, wanted: Json | undefined): boolean {
  return isHostThing(node) && (node as { readonly type?: unknown }).type === wanted;
}

/**
 * This function makes a walker `nearest`. The walker follows a key (the default is `parent`) until the node that it
 * reaches has the wanted type. With `self: true`, the node where the walk starts is the first candidate. A node
 * without that key ends the walk with an error. With `eachStep`, a resolution with hops gets a hop for each node on the way.
 *
 * @param options - The test of a type, the most hops and the record of each step.
 * @returns The walker.
 */
export function nearestWalker(options: NearestOptions = {}): Walker {
  const matches = options.matches ?? hostType;
  const maxHops = options.maxHops ?? 256;
  const eachStep = options.eachStep === true;
  return ({ data, here, deref, visit }) => {
    const follow = isRecord(data) && typeof field(data, "follow") === "string" ? String(field(data, "follow")) : "parent";
    const wanted = isRecord(data) ? field(data, "type") : undefined;
    const fromSelf = isRecord(data) && field(data, "self") === true;
    const record = eachStep ? visit : undefined;
    let at: Thing | undefined = here;
    for (let hops = 0; hops < maxHops; hops += 1) {
      const stepped = hops > 0 || !fromSelf;
      if (stepped) at = at === undefined || at === null ? undefined : deref(at, follow);
      if (at === undefined || at === null) return { ok: false, reason: `No node of the type ${String(wanted)} is on the way.` };
      if (matches(at, wanted)) return { ok: true, thing: at };
      // The hop of the whole walk records the node that the walk reaches. Each node before it gets its own hop.
      if (stepped) record?.(follow, at);
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
    if (only === undefined || parts.length > 1) return fail("#VALUE!", "pure needs exactly one part.");
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
