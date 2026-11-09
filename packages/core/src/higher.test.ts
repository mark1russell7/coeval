import { describe, expect, it } from "vitest";
import {
  GENERATION_LIMIT,
  STD_CAPS,
  STD_MACHINE,
  agree,
  attributeGraph,
  attributeTrace,
  check,
  documentKey,
  evaluate,
  fail,
  makeContext,
  ok,
  prepare,
  treeNodeEvaluator,
  type AttributeAnswer,
  type AttributeCell,
  type Evaluator,
  type Json,
  type Key,
  type Kind,
  type Machine,
  type Result,
  type Thing,
  type TreeContract,
} from "./index.ts";

/** A kind of the decorated tree: each field is an attribute, a bare field is a number, and its parts have no capabilities. */
const treeKind = (tree?: TreeContract): Kind => ({
  verbs: { eval: "tree.node" },
  parts: { shape: "record", fields: {}, rest: { shape: "term", of: "number" } },
  caps: [{ rule: "mask" }],
  pure: true,
  lazy: [{}],
  reads: ["self"],
  ...(tree === undefined ? {} : { tree }),
});

const node = (type: string, value: Record<string, Json> = {}): Json => ({ type, value });
const path = (...steps: Json[]): Json => ({ type: "ref", value: steps });
const add = (...items: Json[]): Json => ({ type: "add", value: items });
const self = (...steps: Json[]): Json => path("self", ...steps);
const quote = (doc: Json): Json => ({ type: ["tree", "quote"], value: doc });
const higher = (term: Json): { readonly higher: Json } => ({ higher: term });

/** The documents that the kind `make` made: each evaluation gives a new object. */
let made = 0;
const makeCode: Evaluator = ({ parts }) => {
  made += 1;
  const size = parts[0]?.evaluate();
  if (size === undefined) return fail("#VALUE!", "make needs a part.");
  return size.ok ? ok({ type: "leaf", value: { n: size.value as Json } }) : size;
};

/** The last thing of the kind `grab`: a test reads the record of the rungs on it. */
let grabbed: Thing;
const grabCode: Evaluator = ({ context }) => {
  grabbed = context.self;
  return ok(1);
};

const kinds: Record<string, Kind> = {
  make: { verbs: { eval: "test.make" }, parts: { shape: "list" }, pure: true },
  grab: { verbs: { eval: "test.grab" }, pure: true, reads: ["self"] },
  host: { verbs: { eval: "test.host" }, pure: true },
  // The attribute n reads the attribute c of the parent, in the same cycle.
  ringLeaf: treeKind({ equations: { n: self("parent", "c") }, attributes: { n: { circular: { start: 0 } } } }),
  leaf: treeKind({ equations: { doubled: add(self("n"), self("n")) }, attributes: { theme: { copy: true } } }),
  // A body is a generated leaf. It reads the base of its parent, and the kind gives it the attribute lent from above.
  card: treeKind({
    attributes: { body: higher(quote(node("leaf", { n: self("parent", "base") }))), theme: { default: 7 } },
    down: { lent: add(self("base"), 1) },
  }),
  computed: treeKind({ attributes: { body: higher({ type: "make", value: [self("size")] }) } }),
  // The values of equations that give no usable document.
  notJson: treeKind({ attributes: { b: higher({ type: "host", value: null }) } }),
  notNode: treeKind({ attributes: { b: higher(quote(3)) } }),
  effect: treeKind({ attributes: { b: higher(quote({ type: "log", value: ["x"] })) } }),
  noKind: treeKind({ attributes: { b: higher(quote({ type: "nothing", value: null })) } }),
  failing: treeKind({ attributes: { b: higher(add({ type: "text", value: "a" })) } }),
  // The attribute y reads x of the generated leaf, and x reads y of the parent.
  ring: treeKind({ attributes: { body: higher(quote(node("leaf", { x: self("parent", "y") }))) }, equations: { y: self("body", "x") } }),
  own: treeKind({ attributes: { b: higher(self("b")) } }),
  rec: treeKind({ attributes: { next: higher(quote(node("rec"))) }, equations: { x: self("next", "x") } }),
  // A circular attribute that reads through a generated subtree, and a circular attribute that gives a node.
  round: treeKind({
    attributes: { c: { circular: { start: 0 } }, body: higher(quote(node("ringLeaf"))) },
    equations: { c: { type: "if", value: { test: { type: "greater", value: [self("body", "n"), 2] }, then: { type: "number", value: 3 }, else: add(self("body", "n"), 1) } } },
  }),
  spin: treeKind({ attributes: { b: { ...higher(quote(node("leaf"))), circular: { start: 0, limit: 3 } } } }),
  badName: treeKind({ attributes: { b: higher(path("names", "depth")) } }),
  // The node forwards to a generated leaf.
  wrap: treeKind({ forwards: "body", attributes: { body: higher(quote(node("leaf", { n: 3 }))) }, equations: { mine: 1 } }),
  // The list children of the forwarded node gives the fold of the node.
  sum: treeKind({
    forwards: "body",
    attributes: { body: higher(quote(node("sum2", { children: { type: "list", value: [node("sum2", { total: 2 }), node("sum2", { total: 3 })] } }))), total: { fold: { unit: 0, combine: add(path("names", "acc"), path("names", "item")) } } },
  }),
  sum2: treeKind(),
  // A kind of the standard world in a generated document.
  standard: treeKind({ attributes: { body: higher(quote({ type: "box", value: { width: 4 } })) } }),
  // A path that ends at a node gives its JSON, thus the attribute first is no node.
  link: treeKind({ forwards: "first", equations: { first: self("children", 0) } }),
  // An equation can give a node without a declaration higher.
  direct: treeKind({ forwards: "made", equations: { made: node("leaf", { n: 4 }) } }),
  twist: treeKind({ forwards: "next", equations: { next: node("twist") } }),
  toNumber: treeKind({ forwards: "v", equations: { v: 3 } }),
  toError: treeKind({ forwards: "v", equations: { v: path("self", "parent", "nothing", "x") } }),
  toNothing: treeKind({ forwards: "v" }),
  badForward: treeKind({ forwards: 3 as never }),
  badStep: treeKind({ forwards: "type" }),
  spiral: treeKind({ forwards: "next", attributes: { next: higher(quote(node("spiral"))) } }),
  // The equation of the generated attribute reads q. No rung gives q but the forward, and the forward reads the attribute.
  knot: treeKind({ forwards: "next", attributes: { next: higher(self("q")) } }),
};

const withKinds = (evaluators: Record<string, Evaluator> = {}): Machine => ({
  ...STD_MACHINE,
  world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, ...kinds } },
  evaluators: { ...STD_MACHINE.evaluators, "test.make": makeCode, "test.grab": grabCode, "test.host": () => ok(new Date(0)), ...evaluators },
});
const machine = withKinds();

/** The plan, the traced plan, a second evaluation and the reference give the same result, also the same reason. */
const agreed = (doc: Json): Result => {
  const outcome = agree(machine, doc, makeContext({}, STD_CAPS), { strict: true });
  expect(outcome, outcome.ok ? "" : outcome.reason).toMatchObject({ ok: true });
  return outcome.ok ? outcome.result : fail("#N/A", "The tiers disagree.");
};

const id = (place: readonly Key[], key: string): string => JSON.stringify([...place, key]);

describe("higher-order attributes (L2i, D126)", () => {
  it("[TREE.HIGHER] the document of an equation is a subtree under the node, with a parent and attributes", () => {
    const doc = node("card", {
      base: 5,
      a: self("body", "n"),
      b: self("body", "doubled"),
      c: self("body"),
      // The rungs parent and copy of the generated root read the node.
      d: self("body", "lent"),
      e: self("body", "theme"),
      f: self("body", "parent", "base"),
    });
    expect(agreed(doc)).toEqual(ok({ base: 5, a: 5, b: 10, c: { n: 5 }, d: 6, e: 7, f: 5 }));
    // An own part of the name comes first: the ladder does not change.
    expect(agreed(node("card", { body: 9, x: self("body") }))).toEqual(ok({ body: 9, x: 9 }));
    // The JSON of a node holds only its parts: no read means no generated document.
    made = 0;
    expect(agreed(node("computed", { size: 4 }))).toEqual(ok({ size: 4 }));
    expect(made).toBe(0);
    expect(agreed(node("standard", { a: self("body", "width") }))).toEqual(ok({ a: 4 }));
  });

  it("[TREE.HIGHER] an equation computes its document from the attributes of the node", () => {
    const doc = node("computed", { size: 4, a: self("body", "doubled"), b: self("body", "n") });
    expect(agreed(doc)).toEqual(ok({ size: 4, a: 8, b: 4 }));
    // The memo of the attribute keeps one subtree: two reads evaluate the equation one time.
    made = 0;
    evaluate(machine, doc, makeContext({}, STD_CAPS));
    expect(made).toBe(1);
    const list = { type: "list", value: [node("computed", { size: 1, a: self("body", "n") }), node("computed", { size: 2, a: self("body", "n") })] };
    expect(agreed(node("card", { children: list }))).toEqual(ok({ children: [{ size: 1, a: 1 }, { size: 2, a: 2 }] }));
  });

  it("[TREE.HIGHER] a value that gives no node of the tree gives its error", () => {
    const value = (kind: string): Result => agreed(node(kind, { x: self("b") }));
    expect(value("notJson")).toMatchObject({ ok: false, error: { code: "#VALUE!", reason: "The equation of the higher-order attribute b of notJson at [] gives a value that is not JSON data." } });
    expect(value("notNode")).toMatchObject({ ok: false, error: { code: "#VALUE!", reason: "The document of the higher-order attribute b of notNode at [] gives no node of the tree." } });
    // The document evaluates as an equation: without capabilities and with the rules of a document.
    expect(value("effect")).toMatchObject({ ok: false, error: { code: "#CAP!" } });
    expect(value("noKind")).toMatchObject({ ok: false, error: { code: "#KIND?" } });
    expect(value("failing")).toMatchObject({ ok: false, error: { code: "#VALUE!" } });
    expect(agreed(quote({ type: "nothing", list: [1, { a: null }] }))).toEqual(ok({ type: "nothing", list: [1, { a: null }] }));
  });

  it("[TREE.HIGHER] a generated subtree works in a fixed point", () => {
    expect(agreed(node("round", { x: self("c") }))).toEqual(ok({ x: 3 }));
    // Each round of a circular attribute generates a new node, and two nodes are not equal.
    expect(agreed(node("spin", { x: self("b") }))).toMatchObject({ ok: false, error: { code: "#CYCLE!", reason: "The cycle of the circular attribute b of spin at [] does not become stable within its limit of 3 rounds." } });
  });

  it("[TREE.HIGHER-PLAN] the key of a document keeps the order of its fields, and one text gets one plan", () => {
    expect(documentKey({ b: [1, -0], a: null })).toBe('{"b":[1,-0],"a":null}');
    expect(documentKey({ a: 1, b: 2 })).not.toBe(documentKey({ b: 2, a: 1 }));
    expect([documentKey(Number.NaN), documentKey(new Date(0)), documentKey(undefined)]).toEqual([undefined, undefined, undefined]);
    // A second document with the same fields in another order gets its own plan, thus its own order of the JSON.
    const fields = (first: string, second: string): Json => ({ type: "leaf", value: { [first]: 1, [second]: 2 } });
    const generator = (kind: string): Kind => ({ ...(kinds["card"] as Kind), tree: { attributes: { body: higher(quote(kind === "ab" ? fields("a", "b") : fields("b", "a"))) } } });
    const orders: Machine = { ...machine, world: { ...machine.world, kinds: { ...machine.world.kinds, ab: generator("ab"), ba: generator("ba") } } };
    const keysOf = (kind: string): readonly string[] => {
      const run = evaluate(orders, node(kind, { x: self("body") }), makeContext({}, STD_CAPS)).result as { readonly value: { readonly x: object } };
      return Object.keys(run.value.x);
    };
    expect([keysOf("ab"), keysOf("ba")]).toEqual([
      ["a", "b"],
      ["b", "a"],
    ]);
  });

  it("[TREE.HIGHER-CYCLE] a cycle through a generated subtree gives #CYCLE! with its chain", () => {
    const run = agreed(node("ring", { v: self("y") }));
    expect(run).toMatchObject({ ok: false, error: { code: "#CYCLE!", reason: "The attributes form a cycle: y of ring at [] -> x of leaf at [] -> y of ring at []." } });
    // The generated part is not known to check, thus it finds no issue, and the run finds the cycle.
    expect(check(machine, node("ring", { v: self("y") }))).toEqual([]);
    // An equation that reads its own attribute is a cycle before the document exists, and check finds it.
    const own = node("own", { x: self("b") });
    const direct = agreed(own);
    expect(direct).toMatchObject({ ok: false, error: { code: "#CYCLE!" } });
    if (!direct.ok) expect(check(machine, own)).toEqual([{ code: "#CYCLE!", place: direct.error.place, reason: direct.error.reason, at: expect.any(Array) }]);
  });

  it("[TREE.HIGHER-DEPTH] an equation that generates its own kind ends with #DEPTH!, not with an overflow of the stack", () => {
    const reason = `The higher-order attribute next of rec at [] is under more than ${GENERATION_LIMIT} generated documents.`;
    expect(agreed(node("rec", { y: self("x") }))).toMatchObject({ ok: false, error: { code: "#DEPTH!", reason } });
    // The limit counts the generated documents on the way to the root. A finite path under the limit gives its value.
    const steps = (count: number): Json[] => Array.from({ length: count }, () => "next");
    expect(agreed(node("rec", { y: self(...steps(GENERATION_LIMIT), "type") }))).toEqual(ok({ y: "rec" }));
    expect(agreed(node("rec", { y: self(...steps(GENERATION_LIMIT + 1), "type") }))).toMatchObject({ ok: false, error: { code: "#DEPTH!", reason } });
  });

  it("[TREE.HIGHER-CELL] the cells of a host keep a generated subtree by the plan of its document and the key of its parent", () => {
    const kept = new Map<readonly Key[], Map<string, AttributeAnswer>>();
    const computed: string[] = [];
    const cell: AttributeCell = (place, attribute, compute) => {
      let byName = kept.get(place);
      if (byName === undefined) {
        byName = new Map();
        kept.set(place, byName);
      }
      let answer = byName.get(attribute);
      if (answer === undefined) {
        computed.push(attribute);
        answer = compute();
        byName.set(attribute, answer);
      }
      return answer;
    };
    const list = { type: "list", value: [node("computed", { size: 1, a: self("body", "n") }), node("computed", { size: 1, a: self("body", "n") })] };
    const doc = node("card", { children: list });
    const plan = prepare(withKinds({ "tree.node": treeNodeEvaluator({ cell }) }), doc);
    const first = plan.evaluate();
    expect(first).toEqual(ok({ children: [{ size: 1, a: 1 }, { size: 1, a: 1 }] }));
    // Two generators get one plan, but each generated root has its own key: the key of its parent is its scope.
    // The probe of the plan makes no demand: a node stops the fold before an equation (WORK.PREPARE).
    expect(computed.filter((name) => name === "n")).toHaveLength(2);
    computed.length = 0;
    made = 0;
    expect(plan.evaluate()).toEqual(first);
    expect([computed, made]).toEqual([[], 0]);
    // The host drops the cells that read the document. The new object has the same text, thus the same plan and keys.
    for (const byName of kept.values()) {
      byName.delete("a");
      byName.delete("body");
    }
    expect(plan.evaluate()).toEqual(first);
    expect(made).toBe(2);
    expect(computed).toEqual(["a", "body", "a", "body"]);
  });

  it("[TREE.HIGHER-CHECK] check examines the equation, and the graph gives the generated subtree unknown edges", () => {
    expect(check(machine, node("card", { base: 5, a: self("body", "n"), b: self("body", "nothing") }))).toEqual([]);
    expect(check(machine, node("badName")).map((issue) => [issue.code, issue.reason])).toEqual([["#NAME?", "In the equation tree.attributes.b.higher of the kind badName: Nothing binds the name depth."]]);
    const graph = attributeGraph(machine, node("computed", { size: 2, a: self("body", "n") }));
    expect(graph.vertices.has(id([], "body"))).toBe(true);
    // The equation reads size. The document of the equation and the step after body are known only in the run.
    expect(graph.edges.filter((e) => e.to === id([], "body")).map((e) => e.from)).toEqual(expect.arrayContaining([undefined]));
    expect(graph.unknown.map((e) => e.to)).toEqual(expect.arrayContaining([id([], "body"), id([], "a")]));
  });
});

describe("forwarding (L2i, D126)", () => {
  it("[TREE.FORWARD] an attribute that no other rung answers comes from the forwarded subtree", () => {
    expect(agreed(node("wrap", { a: self("n"), b: self("doubled"), c: self("mine"), d: self("body", "parent", "mine") }))).toEqual(ok({ a: 3, b: 6, c: 1, d: 1 }));
    // A rung before the forward answers first, and the JSON of the node holds only its parts.
    expect(agreed(node("wrap", { n: 9, a: self("n") }))).toEqual(ok({ n: 9, a: 9 }));
    // Without an answer of the forwarded node, the step reaches nothing.
    expect(agreed(node("wrap", { a: self("nothing") }))).toMatchObject({ ok: false, error: { code: "#N/A" } });
    // A forward needs no declaration higher: an equation can give a node.
    expect(agreed(node("direct", { a: self("doubled") }))).toEqual(ok({ a: 8 }));
    // A path that ends at a node gives its JSON, thus a node of the document is no target.
    expect(agreed(node("link", { children: { type: "list", value: [node("leaf", { n: 2 })] }, a: self("doubled") }))).toMatchObject({
      ok: false,
      error: { code: "#VALUE!", reason: "The attribute first that doubled of link at [] forwards to gives no node of a tree." },
    });
    // An attribute with a declaration copy reads the parent, and the parent forwards the read back.
    expect(agreed(node("wrap", { a: self("theme") }))).toMatchObject({ ok: false, error: { code: "#CYCLE!" } });
    // The list children comes from the forwarded node too, thus a fold of the node sees it.
    expect(agreed(node("sum", { a: self("total") }))).toEqual(ok({ a: 5 }));
  });

  it("[TREE.FORWARD] the record of the rungs names the rung forward", () => {
    const grab = { type: "grab", value: null };
    expect(evaluate(machine, node("wrap", { g: grab, a: self("n") }), makeContext({}, STD_CAPS)).result).toMatchObject({ ok: true });
    expect(attributeTrace(grabbed, "n")).toEqual({ attribute: "n", rungs: ["own", "kind", "parent", "copy", "default", "forward"], by: "forward" });
    expect(attributeTrace(grabbed, "mine")).toBeUndefined();
  });

  it("[TREE.FORWARD] a forward to a value that is not a node, or that failed, gives its error", () => {
    expect(agreed(node("toNumber", { a: self("n") }))).toMatchObject({ ok: false, error: { code: "#VALUE!", reason: "The attribute v that n of toNumber at [] forwards to gives no node of a tree." } });
    expect(agreed(node("toError", { a: self("n") }))).toMatchObject({ ok: false, error: { code: "#N/A" } });
    expect(agreed(node("toNothing", { a: self("n") }))).toMatchObject({ ok: false, error: { code: "#N/A" } });
    expect(agreed(node("badForward", { a: self("n") }))).toMatchObject({ ok: false, error: { code: "#VALUE!", reason: "The attribute n of badForward at [] has a contract with a bad field forwards. It must be a text." } });
  });

  it("[TREE.FORWARD] an endless forward ends with #DEPTH!, and a cycle through the forward gives #CYCLE!", () => {
    expect(agreed(node("spiral", { a: self("x") }))).toMatchObject({ ok: false, error: { code: "#DEPTH!", reason: `The higher-order attribute next of spiral at [] is under more than ${GENERATION_LIMIT} generated documents.` } });
    expect(agreed(node("twist", { a: self("x") }))).toMatchObject({ ok: false, error: { code: "#DEPTH!", reason: `The attribute x of twist at [] forwards through more than ${GENERATION_LIMIT} generated documents.` } });
    const knot = node("knot", { a: self("next") });
    const run = agreed(knot);
    expect(run).toMatchObject({ ok: false, error: { code: "#CYCLE!", reason: "The attributes form a cycle: next of knot at [] -> q of knot at [] -> next of knot at []." } });
    if (!run.ok) expect(check(machine, knot)).toEqual([{ code: "#CYCLE!", place: run.error.place, reason: run.error.reason, at: expect.any(Array) }]);
  });

  it("[TREE.FORWARD-CHECK] check knows that each name can come from the forward, and it examines the field forwards", () => {
    const issues = (doc: Json): [string, string][] => check(machine, doc).map((issue) => [issue.code, issue.reason]);
    expect(issues(node("wrap", { a: self("anything") }))).toEqual([]);
    expect(issues(node("toNothing"))).toEqual([["#N/A", "No rung gives the attribute v of the kind toNothing, and the kind forwards to it."]]);
    expect(issues(node("badForward"))).toEqual([["#VALUE!", "The kind badForward has a bad field tree.forwards. It must be a text."]]);
    expect(issues(node("badStep"))).toMatchObject([["#NAME?", expect.stringContaining("The kind badStep gives the reserved attribute tree.forwards:")]]);
    // The last rung reads the attribute of the forward, and the attribute of a node that only the run knows.
    const graph = attributeGraph(machine, node("wrap", { a: self("n") }));
    expect(graph.edges.filter((e) => e.to === id([], "n")).map((e) => e.from)).toEqual(expect.arrayContaining([id([], "body")]));
    expect(graph.unknown.map((e) => e.to)).toContain(id([], "n"));
  });
});
