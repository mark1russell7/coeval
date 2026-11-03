import { describe, expect, it } from "vitest";
import {
  STD_CAPS,
  STD_MACHINE,
  agree,
  attributeGraph,
  check,
  collectOf,
  fail,
  makeContext,
  ok,
  type Evaluator,
  type Json,
  type Kind,
  type Machine,
  type Result,
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

/** The code of the kind `append`: the list of its first part, with the value of its second part at the end. */
const append: Evaluator = ({ parts }) => {
  const [head, tail] = parts.map((part) => part.evaluate());
  if (head === undefined || tail === undefined) return fail("#VALUE!", "append needs two parts.");
  if (!head.ok) return head;
  if (!tail.ok) return tail;
  return Array.isArray(head.value) ? ok([...(head.value as readonly unknown[]), tail.value]) : fail("#VALUE!", "The first part of append is a list.");
};

const node = (type: string, value: Record<string, Json> = {}, name?: string): Json => (name === undefined ? { type, value } : { type, name, value });
const list = (...items: Json[]): Json => ({ type: "list", value: items });
const path = (...steps: Json[]): Json => ({ type: "ref", value: steps });
const add = (...items: Json[]): Json => ({ type: "add", value: items });
const self = (...steps: Json[]): Json => path("self", ...steps);
const named = (name: string, registry?: string): Json => ({ type: ["tree", "named"], value: registry === undefined ? { name } : { name, in: registry } });

/** The sum of the weights and the list of the tags of the subtree, in the order of the visits. */
const total = { collect: { unit: 0, combine: add(path("names", "acc"), path("names", "item")) } };
const tags = { collect: { unit: list(), combine: { type: "append", value: [path("names", "acc"), path("names", "item")] } } };

const machine: Machine = {
  ...STD_MACHINE,
  world: {
    ...STD_MACHINE.world,
    kinds: {
      ...STD_MACHINE.world.kinds,
      append: { verbs: { eval: "list.append" }, parts: { shape: "list" }, pure: true },
      // A scope collects the weights and the tags of its subtree, and it keeps the registry of the names of its subtree.
      scope: treeKind({ attributes: { total, tags, names: { collect: "names" } } }),
      // An item contributes its weight and its tag. A group contributes nothing, and it reads the total of its subtree.
      item: treeKind({ contributes: { total: self("weight"), tags: self("tag") } }),
      group: treeKind({ attributes: { total } }),
      // A loop contributes the total of its parent, thus the total of a scope reads itself.
      loop: treeKind({ contributes: { total: self("parent", "total") } }),
      cell: treeKind(),
    },
  },
  evaluators: { ...STD_MACHINE.evaluators, "list.append": append },
};

/** The plan, the traced plan, a second evaluation and the reference give the same result, also the same reason. */
const agreed = (on: Machine, doc: Json): Result => {
  const outcome = agree(on, doc, makeContext({}, STD_CAPS), { strict: true });
  expect(outcome, outcome.ok ? "" : outcome.reason).toMatchObject({ ok: true });
  return outcome.ok ? outcome.result : fail("#N/A", "The tiers disagree.");
};

const item = (weight: number, tag: string, extra: Record<string, Json> = {}, name?: string): Json =>
  node("item", { weight, tag: { type: "text", value: tag }, ...extra }, name);

describe("collection attributes and the registry of names (L2g, D122)", () => {
  it("[TREE.COLLECT] the nearest collecting node combines the contributions of each node of its subtree, in the order of the visits", () => {
    const doc = node("scope", {
      sum: self("total"),
      seen: self("tags"),
      children: list(item(1, "a"), node("group", { inner: self("total"), children: list(item(2, "b"), node("cell", { children: list(item(4, "c")) })) }), item(8, "d")),
    });
    // The group and the cell contribute nothing, but the items under them count. The group collects only its own subtree.
    expect(agreed(machine, doc)).toEqual(
      ok({
        sum: 15,
        seen: ["a", "b", "c", "d"],
        children: [
          { weight: 1, tag: "a" },
          { inner: 6, children: [{ weight: 2, tag: "b" }, { children: [{ weight: 4, tag: "c" }] }] },
          { weight: 8, tag: "d" },
        ],
      }),
    );
    // A node without children gives the unit, and the node itself contributes too.
    expect(agreed(machine, node("scope", { sum: self("total"), seen: self("tags") }))).toEqual(ok({ sum: 0, seen: [] }));
    expect(agreed(machine, node("group", { inner: self("total"), weight: 3 }))).toEqual(ok({ inner: 0, weight: 3 }));
    // A value in the list that is not a node does not count.
    const mixed = node("scope", { sum: self("total"), children: list(item(5, "x"), { type: "number", value: 7 }) });
    expect(agreed(machine, mixed)).toEqual(ok({ sum: 5, children: [{ weight: 5, tag: "x" }, 7] }));
    // A failed contribution and a list children that is not a list give their errors at the read.
    expect(agreed(machine, node("scope", { sum: self("total"), children: list(node("item", { tag: { type: "text", value: "y" } })) }))).toMatchObject({
      ok: false,
      error: { code: "#N/A" },
    });
    expect(agreed(machine, node("scope", { sum: self("total"), children: 3 }))).toEqual(
      fail("#VALUE!", "The collection of total needs a list in children of scope at [].", { place: ["sum"] }),
    );
    // A collection that is not read does not walk the subtree (TREE.LAZY).
    expect(agreed(machine, node("scope", { children: 3 }))).toEqual(ok({ children: 3 }));
  });

  it("[TREE.COLLECT] check and the graph of attribute instances see a collection, its contributions and its cycles", () => {
    const doc = node("scope", { sum: self("total"), children: list(item(1, "a"), node("cell", { children: list(item(2, "b")) })) });
    expect(check(machine, doc)).toEqual([]);
    const id = (place: readonly (string | number)[], key: string): string => JSON.stringify([...place, key]);
    const c = (index: number): readonly (string | number)[] => ["children", index];
    const edges = attributeGraph(machine, doc).edges.filter((e) => e.to === id([], "total"));
    // The collection reads each list children of the subtree, and the contribution of each item, in the order of the run.
    expect(edges.map((e) => [e.from, e.lazy])).toEqual([
      [id([], "children"), false],
      [id(c(0), "weight"), false],
      [id(c(0), "children"), false],
      [id(c(1), "children"), false],
      [id([...c(1), ...c(0)], "weight"), false],
      [id([...c(1), ...c(0)], "children"), false],
    ]);
    // A contribution that reads the collection itself closes a cycle. check finds it at the place and with the reason of the run.
    const loop = node("scope", { sum: self("total"), children: list(node("loop")) });
    const run = agreed(machine, loop);
    expect(run).toMatchObject({ ok: false, error: { code: "#CYCLE!" } });
    if (!run.ok) expect(check(machine, loop)).toEqual([{ code: "#CYCLE!", place: run.error.place, reason: run.error.reason, at: expect.any(Array) }]);
    // A contribution that reads an attribute that no rung answers is an issue at each node of its kind.
    const reading = { ...machine, world: { ...machine.world, kinds: { ...machine.world.kinds, odd: treeKind({ contributes: { total: self("size") } }) } } };
    expect(check(reading, node("scope", { children: list(node("odd", { weight: 1 })) })).map((issue) => [issue.code, issue.reason])).toEqual([
      ["#N/A", "No rung gives the attribute size of the kind odd, and the equation tree.contributes.total reads it."],
    ]);
  });

  it("[TREE.COLLECT] a bad declaration collect is an issue of check, and the run gives #VALUE! at its demand", () => {
    const bad = { ...machine, world: { ...machine.world, kinds: { ...machine.world.kinds, bad: treeKind({ attributes: { a: { collect: 5 as never }, b: { collect: { unit: 0 } as never } } }) } } };
    const why = 'The declaration collect needs the text "names" or a record with the fields unit and combine.';
    expect(check(bad, node("bad")).map((issue) => [issue.code, issue.reason])).toEqual([
      ["#VALUE!", `The kind bad has a bad declaration tree.attributes.a.collect. ${why}`],
      ["#VALUE!", `The kind bad has a bad declaration tree.attributes.b.collect. ${why}`],
    ]);
    expect(agreed(bad, node("bad", { seen: self("b") }))).toMatchObject({ ok: false, error: { code: "#VALUE!", reason: `The attribute b of bad at [] has a bad declaration collect. ${why}` } });
    expect(collectOf("names")).toEqual({ ok: true, names: true });
    expect(collectOf({ unit: 1, combine: 2 })).toEqual({ ok: true, names: false, unit: 1, combine: 2 });
  });

  it("[TREE.NAMED] the step tree.named reaches each node of a subtree by its binding name, not only a sibling", () => {
    const title = item(3, "t", { natural: 40 }, "title");
    // The badge is two levels below the scope, and the title is in another branch.
    const badge = node("cell", { x: path("self", named("title"), "natural"), w: path("self", named("title"), "weight") }, "badge");
    const doc = node("scope", { children: list(title, node("cell", { children: list(badge) })) });
    expect(agreed(machine, doc)).toEqual(
      ok({ children: [{ weight: 3, tag: "t", natural: 40 }, { children: [{ x: 40, w: 3 }] }] }),
    );
    // The registry is a record from each name to its node, and a reference to it gives the JSON of each node.
    expect(agreed(machine, node("scope", { all: self("names", "title", "weight"), children: list(title) }))).toEqual(
      ok({ all: 3, children: [{ weight: 3, tag: "t", natural: 40 }] }),
    );
    // A name that the registry does not have, and a path without a registry, give #N/A.
    expect(agreed(machine, node("scope", { x: path("self", named("none")) }))).toEqual(
      fail("#N/A", "The registry names has no node with the name none.", { place: ["x"] }),
    );
    expect(agreed(machine, node("cell", { x: path("self", named("title")) }))).toEqual(fail("#N/A", "No registry names is on the way.", { place: ["x"] }));
    expect(agreed(machine, node("scope", { x: path("self", { type: ["tree", "named"], value: { in: "names" } }) }))).toMatchObject({
      ok: false,
      error: { code: "#VALUE!", reason: "The step tree.named needs a text name." },
    });
    // The field in names another registry.
    const other = { ...machine, world: { ...machine.world, kinds: { ...machine.world.kinds, book: treeKind({ attributes: { index: { collect: "names" } } }) } } };
    expect(agreed(other, node("book", { children: list(node("cell", { x: path("self", named("me", "index"), "y"), y: 7 }, "me")) }))).toEqual(
      ok({ children: [{ x: 7, y: 7 }] }),
    );
    expect(check(machine, doc)).toEqual([]);
  });

  it("[TREE.NAMED] two nodes with one name in one registry give #VALUE! at the read", () => {
    const doc = (read: Json): Json => node("scope", { read, children: list(node("cell", { y: 1 }, "twin"), node("cell", { children: list(node("cell", { y: 2 }, "twin")) })) });
    const reason = "Two nodes have the name twin in the registry names of scope at []: cell at [children, 0] and cell at [children, 1, children, 0].";
    expect(agreed(machine, doc(path("self", named("twin"), "y")))).toMatchObject({ ok: false, error: { code: "#VALUE!", reason } });
    expect(agreed(machine, doc(self("names")))).toMatchObject({ ok: false, error: { code: "#VALUE!", reason } });
    // Without a read of the registry, the tree has no error.
    expect(agreed(machine, doc(1))).toEqual(ok({ read: 1, children: [{ y: 1 }, { children: [{ y: 2 }] }] }));
  });
});
