import { describe, expect, it } from "vitest";
import { STD_CAPS, STD_MACHINE, evaluate, flatten, makeContext, nodeAt, typed, type Json } from "./index.ts";

const run = (doc: Json, names: Record<string, Json> = {}) => evaluate(STD_MACHINE, doc, makeContext(names, STD_CAPS));

describe("evaluate", () => {
  it("adds bare numbers, which get their type from the list of add", () => {
    const out = run({ type: "add", value: [2, 3, { type: "number", value: 4 }] });
    expect(out.result).toEqual({ ok: true, value: 9 });
    expect(out.trace.children.map((child) => [child.doc.type, child.declared])).toEqual([
      ["number", true],
      ["number", true],
      ["number", false],
    ]);
  });

  it("evaluates only the branch of if that the test selects", () => {
    const out = run({
      type: "if",
      value: {
        test: { type: "greater", value: [3, 2] },
        then: { type: "text", value: "big" },
        else: { type: "log", value: [{ type: "text", value: "small" }] },
      },
    });
    expect(out.result).toEqual({ ok: true, value: "big" });
    expect(nodeAt(out.trace, ["else"])).toBeUndefined();
    expect(out.effects).toEqual([]);
  });

  it("gives the result of a named step to the later steps of a sequence", () => {
    const out = run({
      type: "seq",
      value: [
        { type: "add", value: [1, 2], name: "a" },
        { type: "multiply", value: [{ type: "ref", value: "a" }, 10], name: "b" },
        { type: "log", value: [{ type: "ref", value: "b" }] },
      ],
    });
    expect(out.result).toEqual({ ok: true, value: 30 });
    expect(out.effects.map((effect) => effect.payload)).toEqual([30]);
    expect(nodeAt(out.trace, ["2"])?.names).toEqual(["a", "b"]);
  });

  it("reads a field of a name by a path", () => {
    expect(run({ type: "ref", value: "card.size.width" }, { card: { size: { width: 8 } } }).result).toEqual({
      ok: true,
      value: 8,
    });
  });

  it("gives #NAME? for a name that the context does not have", () => {
    expect(run({ type: "ref", value: "later" }).result).toMatchObject({ ok: false, error: { code: "#NAME?" } });
  });

  it("refuses an effect inside pure, because pure gives its part no capability", () => {
    const out = run({ type: "pure", value: [{ type: "log", value: ["hello"] }] });
    expect(out.result).toMatchObject({ ok: false, error: { code: "#CAP!" } });
    expect(out.effects).toEqual([]);
  });

  it("keeps the order of the effects", () => {
    const out = run({
      type: "seq",
      value: [
        { type: "log", value: [{ type: "text", value: "first" }] },
        { type: "write", value: { key: "x", value: { type: "number", value: 1 } } },
        { type: "log", value: [{ type: "text", value: "last" }] },
      ],
    });
    expect(out.effects.map((effect) => effect.kind)).toEqual(["log", "write", "log"]);
  });

  it("gives #KIND? for an unknown kind, and #PART? for a value without a type", () => {
    expect(run({ type: "ad", value: [1] }).result).toMatchObject({ ok: false, error: { code: "#KIND?" } });
    expect(run({ type: "list", value: [7] }).result).toMatchObject({ ok: false, error: { code: "#PART?" } });
  });

  it("collects two failed parts as #ARGS", () => {
    expect(run({ type: "add", value: [{ type: "ref", value: "x" }, { type: "ref", value: "y" }] }).result).toMatchObject({
      ok: false,
      error: { code: "#ARGS" },
    });
  });

  it("takes the own entry of a document first", () => {
    const machine = { ...STD_MACHINE, evaluators: { ...STD_MACHINE.evaluators, "my.add": () => ({ ok: true as const, value: 42 }) } };
    const out = evaluate(machine, typed("add", [1, 2], { own: { eval: "my.add" } }));
    expect(out.result).toEqual({ ok: true, value: 42 });
    expect(out.trace.answer.rung).toBe("own");
  });

  it("gives the same result for two parts with the same result, because a part is sealed", () => {
    const a = run({ type: "multiply", value: [{ type: "add", value: [2, 3] }, 10] });
    const b = run({ type: "multiply", value: [{ type: "number", value: 5 }, 10] });
    expect(a.result).toEqual(b.result);
  });

  it("orders the trace by start, and each start comes before its end", () => {
    const out = run({ type: "add", value: [1, { type: "add", value: [2, 3] }] });
    const nodes = flatten(out.trace);
    expect(nodes.map((node) => node.path.join("/"))).toEqual(["", "0", "1", "1/0", "1/1"]);
    for (const node of nodes) expect(node.enter).toBeLessThan(node.exit);
  });
});
