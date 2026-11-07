import { type Json, type Key, docEquals, field, isRecord } from "./doc.ts";
import {
  type EvalInput,
  type Evaluator,
  type InputWithRuntime,
  type Machine,
  type Plan,
  type Result,
  type RunPart,
  type Runner,
  type Steps,
  RUNTIME,
  evaluateWithin,
  fail,
  ok,
  planner,
} from "./evaluate.ts";
import { Failure } from "./errors.ts";
import { type Cap, type HostThing, type Thing, type Walker, THING, isHostThing, valueOfThing } from "./deref.ts";
import type { World } from "./ladder.ts";
import {
  type AttributeDeclaration,
  type CircularRule,
  type TreeContract,
  GENERATION_LIMIT,
  atArgsOf,
  atRuleOf,
  circularOf,
  collectOf,
  documentKey,
  equationType,
  lookupKind,
} from "./world.ts";
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
    tree: {
      kinds: {
        named: {
          verbs: { step: "walk.named", view: "view.card" },
          pure: true,
          summary: "A step of a path: it goes up to the nearest registry of names, and it gives the node with the name (TREE.NAMED).",
        },
        at: {
          verbs: { step: "walk.tree.at", view: "view.card" },
          pure: true,
          summary: "A step of a path: it reads an attribute with parameters of the node before it, with the arguments of the step (TREE.AT).",
        },
        quote: {
          verbs: { eval: "data.quote", view: "view.value" },
          pure: true,
          summary: "A document as data. Its value is the result, and nothing in it evaluates. A higher-order attribute uses it (TREE.HIGHER).",
        },
      },
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
      { name: "tree.named", kind: "tree.named", args: "named", fields: ["name", "in"] },
      { name: "tree.at", kind: "tree.at", args: "named", fields: ["attr", "args"] },
      { name: "tree.quote", kind: "tree.quote", args: "literal" },
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
  "data.quote": ({ data }) => ok(data ?? null),
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
  "tree.node": (input) => treeNode(input, undefined),
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
export type AttributeRung = "own" | "kind" | "parent" | "copy" | "default" | "forward";

/** The rungs of the ladder of an attribute, in their order (TREE.LADDER, D42). */
export const ATTRIBUTE_RUNGS: readonly AttributeRung[] = /* @__PURE__ */ Object.freeze(["own", "kind", "parent", "copy", "default", "forward"] as const);

/** The record of the demand of one attribute of a node (TREE.RUNGS). */
export interface AttributeTrace {
  readonly attribute: string;
  /** The rungs that the demand visited, in their order. The last one answered, unless no rung answered. */
  readonly rungs: readonly AttributeRung[];
  /** The rung that answered. It is `undefined` when no rung answered. */
  readonly by?: AttributeRung;
}

/** The state of a node behind its brand. */
interface NodeState extends LoopNode {
  readonly build: TreeBuild;
  /** The binding name from the header of the document of the node, for the registry of names (TREE.NAMED). */
  readonly name: string | undefined;
  /**
   * This function gives an attribute through its ladder (TREE.LADDER).
   *
   * @param key - The name of the attribute.
   * @returns The result, or `undefined` when no rung answers.
   */
  read(key: string): Result | undefined;
  /**
   * This function evaluates an equation of the kind of the node, with the node as `self` and no capabilities. Its
   * reads go in the list of the evaluation that made the node (READS.EQUATION).
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

/** The answer of the ladder for one attribute of one node (TREE.CELL, D108). */
export interface AttributeAnswer {
  /** The result of the attribute. It is `undefined` when no rung answered. */
  readonly result: Result | undefined;
  /** The rung that answered. It is `undefined` when no rung answered. */
  readonly by: AttributeRung | undefined;
}

/**
 * This function gives the memo cell of one attribute of one node, for a host that keeps its cells between evaluations
 * (TREE.CELL, D108). The kit uses it at each demand of an attribute in an evaluation.
 *
 * The array `place` is one object for each node of a plan in its scope. It stays the same across the evaluations of
 * that plan. The scope of a node is the node around it, or the demand that made its tree (TREE.CELL-DOCUMENT,
 * D115). Thus a cached plan, for example the plan of an equation, gives a new array for the nodes of each document.
 *
 * A new plan gives new arrays. Thus a host keeps its cells by the identity of `place` and by `attribute`.
 * A host that keeps its cells by the keys of `place` can give the answer of another node or a stale answer.
 *
 * An attribute with parameters gets one cell for each key of its arguments (TREE.AT-CELL, D124). Its `place` is a
 * second array with the same keys, one for each key of a node. Its `attribute` is the JSON text of the name and the
 * arguments, for example `["height",{"width":200}]`.
 *
 * The function gives the answer of `compute`, or a kept answer. A host with signals gives a computed signal: a change
 * of its store then makes only the attributes that read the store compute again. Each demand gives a new `compute`, and
 * a cell that computes again uses the last one.
 *
 * The kit marks an attribute in evaluation before it uses the cell. Thus a cycle gives `#CYCLE!` before it reaches the
 * cell again. An exception of the function that `compute` did not throw gives `#CYCLE!` with the chain of the demands.
 *
 * @param place - The key of the node. Its items are the keys from the root document to the document of the node.
 * @param attribute - The name of the attribute.
 * @param compute - The function that visits the rungs of the ladder.
 * @returns The answer.
 */
export type AttributeCell = (place: readonly Key[], attribute: string, compute: () => AttributeAnswer) => AttributeAnswer;

/** The options of the tree kit (D108). */
export interface TreeOptions {
  /**
   * The memo cells of the host (TREE.CELL). The default is a plain memo for each node and attribute, for one
   * evaluation (TREE.MEMO).
   */
  readonly cell?: AttributeCell;
}

/**
 * This function gives the code of the kind of a node of the decorated tree, with the options of the host. A host puts
 * the code at the name `tree.node` of its machine. Without a cell, the code is the standard code.
 *
 * @param options - The options, for example the memo cells of the host.
 * @returns The code.
 */
export function treeNodeEvaluator(options: TreeOptions = {}): Evaluator {
  const host = options.cell;
  return host === undefined ? (STD_EVALUATORS["tree.node"] as Evaluator) : (input: EvalInput) => treeNode(input, host);
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

/** The answer of the ladder when no rung answers. */
const NO_ANSWER: AttributeAnswer = /* @__PURE__ */ Object.freeze({ result: undefined, by: undefined });

/**
 * The marks of the attributes in evaluation, for each key of a node, with the cells of a host (TREE.CELL). Nodes of
 * two evaluations share their key and their kept cells, thus they share their marks. Nodes of two documents have
 * different keys, thus a nested evaluation gets its own marks (TREE.CELL-NESTED, D115).
 */
const marksByPlace = /* @__PURE__ */ new WeakMap<readonly Key[], Map<string, Cell>>();

/** The trees of the cells of a host, for each key of a root. Nodes of two evaluations stay in one tree. */
const buildsByPlace = /* @__PURE__ */ new WeakMap<readonly Key[], TreeBuild>();

/** The keys of the nodes with the cells of a host, for each scope and each place of a plan (D115). */
const keysByScope = /* @__PURE__ */ new WeakMap<object, WeakMap<readonly Key[], readonly Key[]>>();

/** The scopes of the roots that a demand made, for each marks of a node and each name of an attribute (D115). */
const demandScopes = /* @__PURE__ */ new WeakMap<Map<string, Cell>, Map<string, object>>();

/**
 * This function gives the key of a node with the cells of a host (TREE.CELL-DOCUMENT, D115). The key of the node
 * around the node is its scope. A root without such a node has the scope of the open demand, or no scope.
 * Without a scope, the key is the place of the plan. Thus a cached plan gives a new key for the nodes of each
 * document, and each evaluation of a document gives the same keys.
 *
 * @param place - The place of the document of the node in its plan.
 * @param above - The state of the node around the node, or `undefined`.
 * @returns The key: an array with the keys of `place`.
 */
function cellPlace(place: readonly Key[], above: NodeState | undefined): readonly Key[] {
  let scope: object | undefined = above?.place;
  if (scope === undefined) {
    const demand = demands[demands.length - 1];
    if (demand === undefined) return place;
    let byName = demandScopes.get(demand.cells);
    if (byName === undefined) {
      byName = new Map();
      demandScopes.set(demand.cells, byName);
    }
    scope = byName.get(demand.key);
    if (scope === undefined) {
      scope = {};
      byName.set(demand.key, scope);
    }
  }
  let keys = keysByScope.get(scope);
  if (keys === undefined) {
    keys = new WeakMap();
    keysByScope.set(scope, keys);
  }
  let key = keys.get(place);
  if (key === undefined) {
    key = Object.freeze([...place]);
    keys.set(place, key);
  }
  return key;
}

/** This function gives the value of a weak map, or puts a new value in it. */
function keptAt<T>(map: WeakMap<readonly Key[], T>, place: readonly Key[], make: () => T): T {
  let value = map.get(place);
  if (value === undefined) {
    value = make();
    map.set(place, value);
  }
  return value;
}

/** A value that no exception has. */
const NOT_THROWN: unique symbol = /* @__PURE__ */ Symbol("coeval.tree.not-thrown") as never;

/** One attribute in evaluation. The text names it in the reason of a cycle. */
interface Demand {
  readonly cells: Map<string, Cell>;
  readonly key: string;
  readonly text: string;
}

/** The attributes in evaluation, in the order of their demands. An evaluation does not wait, thus one list serves. */
const demands: Demand[] = [];

/** One value of an attribute in an open fixed point (D113). */
interface LoopValue {
  readonly result: Result | undefined;
  readonly by: AttributeRung | undefined;
  /** The round of an approximation. The round `0` marks a final answer of a node with the cells of a host. */
  readonly round: number;
  /** The plain memo of the node. A stable fixed point writes its final value there. A node with host cells has none. */
  readonly memo: Map<string, Cell> | undefined;
}

/**
 * A fixed point in evaluation (TREE.CIRCULAR, D113). The circular attribute that a demand reaches first leads it. Each
 * circular attribute that a demand reaches during its rounds joins it, thus only one fixed point is open at a time.
 */
interface FixedPoint {
  /** The index of the demand of the leader in `demands`. */
  readonly depth: number;
  round: number;
  /** `true` when a circular attribute got a new value in this round. */
  changed: boolean;
  /** The values of the fixed point, by the marks of a node and by the name of the attribute. */
  readonly values: Map<Map<string, Cell>, Map<string, LoopValue>>;
  /** The demands of circular attributes, from the leader up. */
  readonly circular: Set<Demand>;
  /** The demands above the leader that read an approximation. Their results are not final. */
  readonly tentative: Set<Demand>;
}

/** The open fixed point, or `undefined`. */
let openPoint: FixedPoint | undefined;

/**
 * What the code of a fixed point needs of a node (D113). The state of each node holds it, thus the functions of a
 * fixed point are module functions, and a node makes no closure for them.
 */
interface LoopNode {
  readonly type: string;
  readonly place: readonly Key[];
  /** The tree contract of the kind of the node (D42). */
  readonly tree: TreeContract | undefined;
  /** The marks of the attributes in evaluation. Without the cells of a host, they are the plain memo. */
  readonly marks: Map<string, Cell>;
  /** The plain memo of the node. With the cells of a host, it keeps the last answer only for `has` and `trace`. */
  readonly cells: Map<string, Cell>;
  readonly host: AttributeCell | undefined;
  /** This function visits the rungs of the ladder of an attribute in their order, until one answers (TREE.LADDER). */
  readonly climb: (key: string) => AttributeAnswer | undefined;
}

/** For each table `tree.attributes`, `true` when an attribute of it declares `circular`. */
const circularTables = /* @__PURE__ */ new WeakMap<object, boolean>();

/** For each declaration `circular` that is an object, its rule. */
const circularRules = /* @__PURE__ */ new WeakMap<object, CircularRule>();

/** This function tells if a tree contract declares a circular attribute. The answer for a table is computed one time. */
function hasCircular(tree: TreeContract | undefined): boolean {
  const table = tree?.attributes;
  if (table === undefined) return false;
  let known = circularTables.get(table);
  if (known === undefined) {
    known = Object.keys(table).some((key) => {
      const declared: unknown = entryOf(table, key);
      return typeof declared === "object" && declared !== null && (declared as AttributeDeclaration).circular !== undefined;
    });
    circularTables.set(table, known);
  }
  return known;
}

/** This function gives the declaration `circular` of an attribute of a tree contract (D113), or `undefined`. */
function circularRule(tree: TreeContract | undefined, key: string): CircularRule | undefined {
  const declared: unknown = entryOf(tree?.attributes, key)?.circular;
  if (declared === undefined) return undefined;
  if (typeof declared !== "object" || declared === null) return circularOf(declared);
  let rule = circularRules.get(declared);
  if (rule === undefined) {
    rule = circularOf(declared);
    circularRules.set(declared, rule);
  }
  return rule;
}

/** This function gives the values of a fixed point for the marks of a node. */
function loopValues(loop: FixedPoint, marks: Map<string, Cell>): Map<string, LoopValue> {
  let values = loop.values.get(marks);
  if (values === undefined) {
    values = new Map();
    loop.values.set(marks, values);
  }
  return values;
}

/** This function marks each demand above the leader: each one read an approximation, thus its result is not final. */
function markTentative(loop: FixedPoint): void {
  for (let index = loop.depth + 1; index < demands.length; index += 1) loop.tentative.add(demands[index] as Demand);
}

/** This function tells if two approximations are the same: two values by DOC.EQUALS, two errors by code and reason. */
function sameApproximation(a: Result | undefined, b: Result | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.ok && b.ok) return docEquals(a.value, b.value);
  if (!a.ok && !b.ok) return a.error.code === b.error.code && a.error.reason === b.error.reason;
  return false;
}

/** This function writes the final value of each circular attribute of the last round in the plain memo of its node. */
function settle(loop: FixedPoint): void {
  for (const values of loop.values.values()) {
    for (const [key, value] of values) {
      if (value.memo !== undefined && value.round === loop.round) value.memo.set(key, { busy: false, result: value.result, by: value.by });
    }
  }
}

/** The text of the fixed point of a circular attribute that does not become stable (TREE.CIRCULAR-LIMIT). */
function limitReason(text: string, limit: number): string {
  return `The cycle of the circular attribute ${text} does not become stable within its limit of ${limit} ${limit === 1 ? "round" : "rounds"}.`;
}

/**
 * This function answers a demand that reached an attribute in evaluation in an open fixed point (TREE.CYCLE). A chain
 * of circular attributes gives the current approximation (TREE.CIRCULAR). Each other chain gives `#CYCLE!`.
 */
function reachedIn(loop: FixedPoint, n: LoopNode, key: string): Result | undefined {
  const first = demands.findIndex((demand) => demand.cells === n.marks && demand.key === key);
  let circular = first >= loop.depth;
  for (let index = first; circular && index < demands.length; index += 1) circular = loop.circular.has(demands[index] as Demand);
  if (!circular) return cycleAt(n.marks, key, attributeText(key, n.type, n.place));
  const rule = circularRule(n.tree, key);
  const kept = loop.values.get(n.marks)?.get(key);
  markTentative(loop);
  return kept !== undefined ? kept.result : ok(rule?.ok === true ? rule.start : null);
}

/**
 * This function evaluates the leader of a fixed point (TREE.CIRCULAR, D113). Its demand is the last one. Each round
 * visits the ladder again, and the rounds end when no circular attribute gets a new value. An error ends the rounds
 * at once. After the last round of the limit, the leader gives `#CYCLE!` at the place of its node.
 */
function roundsOf(n: LoopNode, key: string, rule: CircularRule & { readonly ok: true }): AttributeAnswer {
  const leader = demands[demands.length - 1] as Demand;
  const loop: FixedPoint = { depth: demands.length - 1, round: 0, changed: false, values: new Map(), circular: new Set([leader]), tentative: new Set() };
  openPoint = loop;
  try {
    let before: Result | undefined = ok(rule.start);
    for (;;) {
      loop.round += 1;
      loop.changed = false;
      const answer = n.climb(key) ?? NO_ANSWER;
      // An error is not a value of the fixed point. The other attributes of the cycle evaluate again at their next demand.
      if (answer.result !== undefined && !answer.result.ok) return answer;
      if (!sameApproximation(before, answer.result)) loop.changed = true;
      before = answer.result;
      loopValues(loop, n.marks).set(key, { result: answer.result, by: answer.by, round: loop.round, memo: undefined });
      if (!loop.changed) {
        settle(loop);
        return answer;
      }
      if (loop.round >= rule.limit) return { result: fail("#CYCLE!", limitReason(attributeText(key, n.type, n.place), rule.limit), { place: n.place }), by: answer.by };
    }
  } finally {
    openPoint = undefined;
  }
}

/**
 * This function evaluates a circular attribute in the open fixed point of another leader, one time in each round
 * (D113). A later demand in the same round gets the value of the round. Each value is an approximation.
 */
function roundIn(loop: FixedPoint, n: LoopNode, key: string, rule: CircularRule & { readonly ok: true }, kept: LoopValue | undefined): Result | undefined {
  let value = kept;
  if (value === undefined || value.round !== loop.round) {
    const demand: Demand = { cells: n.marks, key, text: attributeText(key, n.type, n.place) };
    n.marks.set(key, BUSY);
    demands.push(demand);
    loop.circular.add(demand);
    let answer: AttributeAnswer;
    try {
      answer = n.climb(key) ?? NO_ANSWER;
    } finally {
      demands.pop();
      n.marks.delete(key);
    }
    if (!sameApproximation(value === undefined ? ok(rule.start) : value.result, answer.result)) loop.changed = true;
    value = { result: answer.result, by: answer.by, round: loop.round, memo: n.host === undefined ? n.cells : undefined };
    loopValues(loop, n.marks).set(key, value);
  }
  markTentative(loop);
  return value.result;
}

/**
 * This function evaluates an attribute without the cell of the host: with the plain memo, or in an open fixed point
 * (D113). A result that read an approximation is not final, thus no memo keeps it.
 */
function localIn(n: LoopNode, key: string, rule: (CircularRule & { readonly ok: true }) | undefined): Result | undefined {
  const demand: Demand = { cells: n.marks, key, text: attributeText(key, n.type, n.place) };
  const loop = openPoint;
  n.marks.set(key, BUSY);
  demands.push(demand);
  let answer: AttributeAnswer;
  try {
    answer = rule === undefined ? (n.climb(key) ?? NO_ANSWER) : roundsOf(n, key, rule);
  } catch (error) {
    // An exception of the host, for example an overflow of the stack, leaves the attribute without a result.
    n.marks.delete(key);
    throw error;
  } finally {
    demands.pop();
  }
  if (loop !== undefined && loop.tentative.has(demand)) {
    n.marks.delete(key);
    return answer.result;
  }
  if (n.host !== undefined) {
    // The fixed point keeps a final answer of a node with host cells until it ends (D113).
    n.marks.delete(key);
    if (loop !== undefined) loopValues(loop, n.marks).set(key, { result: answer.result, by: answer.by, round: 0, memo: undefined });
  }
  n.cells.set(key, { busy: false, result: answer.result, by: answer.by });
  return answer.result;
}

/**
 * This function answers a demand that reached an attribute in evaluation (TREE.CYCLE). Outside a fixed point, it gives
 * `#CYCLE!` with the chain. In an open fixed point, `reachedIn` answers (TREE.CIRCULAR).
 */
function busyAt(n: LoopNode, key: string): Result | undefined {
  const loop = openPoint;
  return loop === undefined ? cycleAt(n.marks, key, attributeText(key, n.type, n.place)) : reachedIn(loop, n, key);
}

/**
 * This function evaluates the leader of a fixed point through the cell of the host (TREE.CELL, D113). The cell of the
 * leader gets the final value of the fixed point, from a computation that contains each round.
 */
function leaderOnHost(n: LoopNode, key: string, rule: CircularRule & { readonly ok: true }, host: AttributeCell): Result | undefined {
  const text = attributeText(key, n.type, n.place);
  n.marks.set(key, BUSY);
  demands.push({ cells: n.marks, key, text });
  let thrown: unknown = NOT_THROWN;
  let answer: AttributeAnswer;
  try {
    answer = host(n.place, key, () => {
      try {
        return roundsOf(n, key, rule);
      } catch (error) {
        thrown = error;
        throw error;
      }
    });
  } catch (error) {
    // An exception of the kit or of the stack goes on, as without a host. Another exception is a cycle of the host.
    if (error === thrown) throw error;
    const chain = demands.map((demand) => demand.text).join(" -> ");
    answer = { result: fail("#CYCLE!", `The cells of the host found a cycle in the demands: ${chain}.`, { cause: error }), by: undefined };
  } finally {
    demands.pop();
    n.marks.delete(key);
  }
  n.cells.set(key, { busy: false, result: answer.result, by: answer.by });
  return answer.result;
}

/**
 * This function gives an attribute of a node with circular attributes, or an attribute in an open fixed point (D113).
 * The memo and the marks of the node do not hold the attribute. An open fixed point does not use the cells of the host.
 */
function circularRead(n: LoopNode, key: string): Result | undefined {
  const rule = circularRule(n.tree, key);
  if (rule !== undefined && !rule.ok) {
    const result = fail("#VALUE!", `The attribute ${attributeText(key, n.type, n.place)} has a bad declaration circular. ${rule.reason}`);
    n.cells.set(key, { busy: false, result, by: undefined });
    return result;
  }
  const loop = openPoint;
  if (loop !== undefined) {
    const kept = loop.values.get(n.marks)?.get(key);
    if (rule !== undefined) return roundIn(loop, n, key, rule, kept);
    if (kept !== undefined) return kept.result;
    return localIn(n, key, undefined);
  }
  if (rule === undefined || n.host === undefined) return localIn(n, key, rule);
  return leaderOnHost(n, key, rule, n.host);
}

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
 * This function gives the collection of an attribute of a node (TREE.COLLECT, D122). It visits the node, then each node
 * of the same tree in each list `children`, in the order of the lists. Each node is visited one time.
 * The registry of names (TREE.NAMED) gives a record from each binding name to its node.
 */
function collected(root: HostThing, key: string, declared: unknown): Result {
  const top = stateOf(root) as NodeState;
  const rule = collectOf(declared);
  if (!rule.ok) return fail("#VALUE!", `The attribute ${attributeText(key, top.type, top.place)} has a bad declaration collect. ${rule.reason}`);
  const registry: Record<string, unknown> = {};
  const owners = new Map<string, NodeState>();
  let acc = rule.names ? ok(registry) : top.equation(rule.unit, NO_NAMES);
  if (!acc.ok) return acc;
  const seen = new Set<NodeState>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const thing = stack.pop();
    const at = stateOf(thing);
    // An item that is not a node of this tree does not count, and a node counts one time.
    if (at === undefined || at.build !== top.build || seen.has(at)) continue;
    seen.add(at);
    if (rule.names) {
      const name = at.name;
      const earlier = name === undefined ? undefined : owners.get(name);
      if (earlier !== undefined) {
        const both = `${earlier.type} at [${earlier.place.join(", ")}] and ${at.type} at [${at.place.join(", ")}]`;
        return fail("#VALUE!", `Two nodes have the name ${name} in the registry ${attributeText(key, top.type, top.place)}: ${both}.`);
      }
      if (name !== undefined) {
        owners.set(name, at);
        putField(registry, name, thing);
      }
    } else {
      const term = entryOf(at.tree?.contributes, key);
      if (term !== undefined) {
        const item = at.equation(term, NO_NAMES);
        if (!item.ok) return item;
        acc = top.equation(rule.combine, { acc: acc.value, item: item.value });
        if (!acc.ok) return acc;
      }
    }
    const children = at.read("children");
    if (children === undefined) continue;
    if (!children.ok) return children;
    if (!Array.isArray(children.value)) return fail("#VALUE!", `The collection of ${key} needs a list in children of ${at.type} at [${at.place.join(", ")}].`);
    const list = children.value as readonly unknown[];
    for (let index = list.length - 1; index >= 0; index -= 1) stack.push(list[index]);
  }
  return acc;
}

/** A function from the name of an attribute and the arguments to the result, or `undefined` when no rung answers (D124). */
export type AtReader = (attr: string, args: unknown) => Result | undefined;

/**
 * The host things that answer the step `tree.at` with their own function (D124). A node of the reference is in it, and
 * its fields do not change. The walker reads the state of a node of the kit.
 */
export const AT_READERS: WeakMap<object, AtReader> = /* @__PURE__ */ new WeakMap();

/** The memo of the instances of the attributes with parameters of each node, without the cells of a host (TREE.AT). */
const atMemos = /* @__PURE__ */ new WeakMap<NodeState, Map<string, Cell>>();

/** The second key of each key of a node, for the cells of the attributes with parameters (TREE.AT-CELL). */
const atPlaces = /* @__PURE__ */ new WeakMap<readonly Key[], readonly Key[]>();

/**
 * This function gives an instance of an attribute with parameters of a node (TREE.AT, D124). The equation in
 * `tree.at` of the kind of the node evaluates with the arguments as names. The memo keeps one result for each key of
 * the arguments, and a demand of an instance in evaluation gives `#CYCLE!`. The function is outside the code of
 * `read`, thus a node without such attributes does no new work.
 */
function atRead(n: NodeState, attr: string, args: unknown): Result | undefined {
  const declared: unknown = entryOf(n.tree?.at, attr);
  if (declared === undefined) return undefined;
  const rule = atRuleOf(declared);
  if (!rule.ok) return fail("#VALUE!", `The attribute ${attributeText(attr, n.type, n.place)} has a bad entry tree.at. ${rule.reason}`);
  const given = atArgsOf(rule.params, args);
  if (!given.ok) return fail("#VALUE!", `The step tree.at of ${attributeText(attr, n.type, n.place)} has bad arguments. ${given.reason}`);
  // An open fixed point does not use the cells of the host (D113).
  const host = openPoint === undefined ? n.host : undefined;
  const place = n.host === undefined ? n.place : keptAt(atPlaces, n.place, () => Object.freeze([...n.place]));
  let marks: Map<string, Cell> | undefined = n.host === undefined ? atMemos.get(n) : keptAt(marksByPlace, place, () => new Map<string, Cell>());
  if (marks === undefined) {
    marks = new Map();
    atMemos.set(n, marks);
  }
  const key = `[${JSON.stringify(attr)},${given.key}]`;
  const text = attributeText(`${attr} with ${given.key}`, n.type, n.place);
  const cell = marks.get(key);
  if (cell !== undefined) return cell.busy ? cycleAt(marks, key, text) : cell.result;
  const demand: Demand = { cells: marks, key, text };
  const loop = openPoint;
  const compute = (): AttributeAnswer => ({ result: n.equation(rule.equation, given.names), by: "kind" });
  marks.set(key, BUSY);
  demands.push(demand);
  let thrown: unknown = NOT_THROWN;
  let answer: AttributeAnswer;
  try {
    answer =
      host === undefined
        ? compute()
        : host(place, key, () => {
            try {
              return compute();
            } catch (error) {
              thrown = error;
              throw error;
            }
          });
  } catch (error) {
    marks.delete(key);
    // An exception of the kit or of the stack goes on. Another exception of the cell is a cycle of the host (D108).
    if (host === undefined || error === thrown) throw error;
    const chain = demands.map((item) => item.text).join(" -> ");
    answer = { result: fail("#CYCLE!", `The cells of the host found a cycle in the demands: ${chain}.`, { cause: error }), by: undefined };
  } finally {
    demands.pop();
  }
  // A result that read an approximation is not final. With the cells of a host, the cell is the memo.
  if (n.host !== undefined || loop?.tentative.has(demand) === true) marks.delete(key);
  else marks.set(key, { busy: false, result: answer.result, by: answer.by });
  return answer.result;
}

/** The most documents and the most characters of the keys in the table of generated documents. */
const INTERNED_DOCUMENTS = 1000;
const INTERNED_CHARACTERS = 16_000_000;

/** The first document of each structural key (TREE.HIGHER-PLAN, D126). */
const internedDocuments = /* @__PURE__ */ new Map<string, Json>();

/** The kept document of each document object. An object gets its key one time, as PLAN.CACHE says. */
const internedObjects = /* @__PURE__ */ new WeakMap<object, Json>();

/** The characters of the keys of `internedDocuments`. */
let internedCharacters = 0;

/**
 * This function gives the one object of a document (TREE.HIGHER-PLAN, D126). `equationPlan` caches by object, thus a
 * new object with a known key compiles nothing. The table has a limit, and a full table starts again. A document that
 * left the table compiles again, and that costs only time.
 *
 * @param doc - The value of an equation.
 * @returns The document, or `undefined` for a value that is not JSON data.
 */
function internedDocument(doc: unknown): Json | undefined {
  const object = typeof doc === "object" && doc !== null;
  const known = object ? internedObjects.get(doc) : undefined;
  if (known !== undefined) return known;
  const key = documentKey(doc);
  if (key === undefined) return undefined;
  if (!object) return doc as Json;
  let kept = internedDocuments.get(key);
  if (kept === undefined) {
    if (internedDocuments.size >= INTERNED_DOCUMENTS || internedCharacters + key.length > INTERNED_CHARACTERS) {
      internedDocuments.clear();
      internedCharacters = 0;
    }
    kept = doc as Json;
    internedDocuments.set(key, kept);
    internedCharacters += key.length;
  }
  internedObjects.set(doc, kept);
  return kept;
}

/** The depth of each root of a generated document: the generated documents from the root of the tree to it (D126). */
const generations = /* @__PURE__ */ new WeakMap<NodeState, number>();

/** This function gives the depth of the nearest root of a generated document at or above a node of a tree, or 0. */
function generationOf(node: HostThing, build: TreeBuild): number {
  let thing: Thing | undefined = node;
  for (let at = stateOf(thing); at?.build === build; at = stateOf(thing)) {
    const depth = generations.get(at);
    if (depth !== undefined) return depth;
    thing = (thing as HostThing).deref("parent");
  }
  return 0;
}

/**
 * This function gives a higher-order attribute of a node (TREE.HIGHER, D126). The equation gives a document as data.
 * The document evaluates as an equation, with the node as `self`. Thus its root is a node under the node: it finds the
 * open tree, and it has the node as its parent. The function is outside the code of `read`, as a fold is.
 */
function generated(n: NodeState, node: HostThing, key: string, term: Json): Result {
  const value = n.equation(term, NO_NAMES);
  if (!value.ok) return value;
  const doc = internedDocument(value.value);
  const text = attributeText(key, n.type, n.place);
  if (doc === undefined) return fail("#VALUE!", `The equation of the higher-order attribute ${text} gives a value that is not JSON data.`);
  const depth = generationOf(node, n.build) + 1;
  if (depth > GENERATION_LIMIT) return fail("#DEPTH!", `The higher-order attribute ${text} is under more than ${GENERATION_LIMIT} generated documents.`);
  const root = n.equation(doc, NO_NAMES);
  if (!root.ok) return root;
  const made = stateOf(root.value);
  if (made === undefined) return fail("#VALUE!", `The document of the higher-order attribute ${text} gives no node of the tree.`);
  generations.set(made, depth);
  return root;
}

/**
 * This function gives the last rung of the ladder (TREE.FORWARD, D126). The attribute `forwards` gives a node, and that
 * node answers the attribute through its own ladder. The attribute `forwards` itself gets no such answer.
 */
function forwarded(n: NodeState, node: HostThing, key: string, name: unknown): { readonly result: Result; readonly by: AttributeRung } | undefined {
  if (key === name) return undefined;
  const text = attributeText(key, n.type, n.place);
  if (typeof name !== "string") return { result: fail("#VALUE!", `The attribute ${text} has a contract with a bad field forwards. It must be a text.`), by: "forward" };
  const target = n.read(name);
  if (target === undefined) return undefined;
  if (!target.ok) return { result: target, by: "forward" };
  const to = stateOf(target.value);
  if (to === undefined) return { result: fail("#VALUE!", `The attribute ${name} that ${text} forwards to gives no node of a tree.`), by: "forward" };
  // An equation can give a node without a declaration higher, thus the rung counts each node that it reaches.
  if (!generations.has(to)) {
    const depth = generationOf(node, n.build) + 1;
    if (depth > GENERATION_LIMIT) return { result: fail("#DEPTH!", `The attribute ${text} forwards through more than ${GENERATION_LIMIT} generated documents.`), by: "forward" };
    generations.set(to, depth);
  }
  const result = to.read(key);
  return result === undefined ? undefined : { result, by: "forward" };
}

/**
 * This function makes a node of the decorated tree. A step `parent` gives the self of the context of the node, and a
 * step `type` gives its type. Another step reads an attribute through its ladder (TREE.LADDER). The rungs are a part of
 * the node, an equation of its kind and an equation `down` of the kind of its parent. A copy from the parent, then a
 * fold or a default, come last. A failed attribute throws `Failure` with its own error, thus a reference to it gives that error.
 * The argument `outer` is the self of the context, that `treeNode` resolved. The node reads no root of the context directly (C4).
 *
 * The argument `place` is the key of the node. With the cells of a host, `cellPlace` gives it. Else it is the place of
 * the plan. The argument `host` gives the memo cells of the host (TREE.CELL), or `undefined` for the plain memo of the node.
 */
function treeThing(input: EvalInput, place: readonly Key[], build: TreeBuild, outer: Thing | undefined, host: AttributeCell | undefined): HostThing {
  const { parts, context, kind: type, machine } = input;
  // The equations evaluate in the evaluation that made the node, thus their reads go in its list (READS.EQUATION).
  const runtime = (input as InputWithRuntime)[RUNTIME];
  const { tree, of } = contractOf(machine, input.typePath);
  const above = stateOf(outer);
  // Only a node of the same tree is a parent for the rungs `parent` and `copy`.
  const up = above !== undefined && above.build === build ? above : undefined;
  const cells = new Map<string, Cell>();
  // With the cells of a host, the marks of a key serve each node of the key (TREE.CELL).
  const marks = host === undefined ? cells : keptAt(marksByPlace, place, () => new Map<string, Cell>());
  // Only a node whose kind declares a circular attribute takes the path of D113 outside a fixed point.
  const circular = hasCircular(tree);
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
    if (declared?.collect !== undefined) return { result: collected(node, key, declared.collect), by: "default" };
    if (declared?.default !== undefined) return { result: state.equation(declared.default, NO_NAMES), by: "default" };
    if (declared?.higher !== undefined) return { result: generated(state, node, key, declared.higher), by: "default" };
    return tree?.forwards === undefined ? undefined : forwarded(state, node, key, tree.forwards);
  };

  /**
   * This function gives an attribute through the cell of the host (TREE.CELL). The cell is the memo. The node keeps
   * the last answer only for `has` and `trace`.
   */
  const through =
    host === undefined
      ? undefined
      : (key: string): Result | undefined => {
          const text = attributeText(key, type, place);
          if (marks.has(key)) return busyAt(state, key);
          if (tree === undefined && up?.tree === undefined && !parts.some((item) => item.key === key)) return undefined;
          if (circular || openPoint !== undefined) return circularRead(state, key);
          marks.set(key, BUSY);
          demands.push({ cells: marks, key, text });
          let thrown: unknown = NOT_THROWN;
          let answer: AttributeAnswer;
          try {
            answer = host(place, key, () => {
              try {
                return climb(key) ?? NO_ANSWER;
              } catch (error) {
                thrown = error;
                throw error;
              }
            });
          } catch (error) {
            // An exception of the kit or of the stack goes on, as without a host. Another exception is a cycle of the host.
            if (error === thrown) throw error;
            const chain = demands.map((demand) => demand.text).join(" -> ");
            answer = { result: fail("#CYCLE!", `The cells of the host found a cycle in the demands: ${chain}.`, { cause: error }), by: undefined };
          } finally {
            demands.pop();
            marks.delete(key);
          }
          cells.set(key, { busy: false, result: answer.result, by: answer.by });
          return answer.result;
        };

  const read = (key: string): Result | undefined => {
    if (through !== undefined) return through(key);
    const cell = cells.get(key);
    if (cell !== undefined) return cell.busy ? busyAt(state, key) : cell.result;
    // A node without a contract has only its parts, as before D42. Thus a missing part needs no cell.
    if (tree === undefined && up?.tree === undefined && !parts.some((item) => item.key === key)) return undefined;
    // A circular attribute and each demand in an open fixed point take the code of D113 (TREE.CIRCULAR).
    if (circular || openPoint !== undefined) return circularRead(state, key);
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
    name: input.doc.name,
    type,
    place,
    tree,
    marks,
    cells,
    host,
    climb,
    read,
    equation(term, names) {
      if (machine === undefined) return fail("#NOEVAL", "The evaluation of an equation needs the machine.");
      return evaluateWithin(equationPlan(machine, of, term), { ...context, names, caps: NO_CAPS, self: node }, runtime);
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
      // The last rung is on the way only for a kind with the field forwards.
      const end = cell.by === undefined ? ATTRIBUTE_RUNGS.length - (tree?.forwards === undefined ? 1 : 0) : ATTRIBUTE_RUNGS.indexOf(cell.by) + 1;
      const rungs = ATTRIBUTE_RUNGS.slice(0, end);
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
 * The argument `host` gives the memo cells of the host (TREE.CELL), or `undefined` for the plain memo of each node.
 */
function treeNode(input: EvalInput, host: AttributeCell | undefined): Result {
  const found = input.resolve(SELF_PATH, NO_HOPS);
  const outer = found.ok ? found.thing : undefined;
  const above = stateOf(outer);
  // With the cells of a host, the key of a node holds its scope (D115). Without them, the place of the plan serves.
  const place = host === undefined ? input.place : cellPlace(input.place, above);
  if (above !== undefined && above.build.open) return ok(treeThing(input, place, above.build, outer, host));
  // With the cells of a host, a kept value can hold a node of an earlier evaluation. Thus that node stays in the tree.
  const build: TreeBuild = host === undefined ? { open: true } : keptAt(buildsByPlace, place, () => ({ open: true }));
  build.open = true;
  const root = treeThing(input, place, build, outer, host);
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

/**
 * The walker of the step `tree.named` (TREE.NAMED, D122). It goes up from the thing before the step through the key
 * `parent`, to the first thing that answers the registry. The field `in` names the registry, and the default is
 * `names`. The walker gives the node with the field `name` in that registry.
 */
const named: Walker = ({ data, here, deref }) => {
  const name = isRecord(data) ? field(data, "name") : undefined;
  if (typeof name !== "string") return { ok: false, code: "#VALUE!", reason: "The step tree.named needs a text name." };
  const registry = isRecord(data) && typeof field(data, "in") === "string" ? String(field(data, "in")) : "names";
  let at: Thing | undefined = here;
  for (let hops = 0; hops < 256 && at !== undefined && at !== null; hops += 1) {
    const found = deref(at, registry);
    if (found !== undefined) {
      if (!isRecord(found) || !Object.hasOwn(found, name)) return { ok: false, reason: `The registry ${registry} has no node with the name ${name}.` };
      return { ok: true, thing: field(found, name) as Thing };
    }
    at = deref(at, "parent");
  }
  return { ok: false, reason: `No registry ${registry} is on the way.` };
};

/**
 * The walker of the step `tree.at` (TREE.AT, D124). The field `attr` names an attribute with parameters, and the
 * field `args` gives the arguments. The thing before the step is a node. A failed instance throws its own error.
 */
const at: Walker = ({ data, here }) => {
  const attr = isRecord(data) ? field(data, "attr") : undefined;
  if (typeof attr !== "string") return { ok: false, code: "#VALUE!", reason: "The step tree.at needs a text attr." };
  const args = isRecord(data) && Object.hasOwn(data, "args") ? field(data, "args") : {};
  const state = stateOf(here);
  const reader = state === undefined && typeof here === "object" && here !== null ? AT_READERS.get(here) : undefined;
  if (state === undefined && reader === undefined) return { ok: false, reason: `The step tree.at reads ${attr} of a thing that is not a node of a tree.` };
  const result = state === undefined ? (reader as AtReader)(attr, args) : atRead(state, attr, args);
  if (result === undefined) return { ok: false, reason: `No rung gives the attribute ${attr} with parameters.` };
  if (!result.ok) throw new Failure(result.error);
  return { ok: true, thing: result.value as Thing };
};

/** The walkers of the standard world, by name. */
export const STD_WALKERS: Readonly<Record<string, Walker>> = { "walk.nearest": nearest, "walk.named": named, "walk.tree.at": at };

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
