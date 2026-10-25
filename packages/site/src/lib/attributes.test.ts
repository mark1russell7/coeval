import { describe, expect, it } from "vitest";
import { SCENARIOS, attributeModel, formulaOf, formulaText, SLOTS } from "./attributes.ts";

const model = (id: string) => attributeModel(SCENARIOS.find((item) => item.id === id)!.doc);

describe("the trees of the attribute diagram", () => {
  it("evaluates on demand: the height of the box comes before its width", () => {
    const flow = model("flow");
    expect(flow.root).toEqual({ ok: true, value: { width: 300, height: 60, children: [{ width: 280, height: 40 }] } });
    expect(Object.fromEntries(flow.order)).toEqual({ "panel.width": 1, "panel.height": 2, "box.height": 3, "box.width": 4 });
    expect(flow.reads.map((read) => `${read.from.id} > ${read.to.id}`)).toEqual(["box.height > panel.height", "panel.width > box.width"]);
  });

  it("gives the chain of a cycle, and an attribute that nothing reads does not evaluate", () => {
    const cycle = model("cycle");
    expect(cycle.chain).toEqual(["width of panel at []", "width of box at [children, 0]", "width of panel at []"]);
    expect(cycle.order.has("panel.height")).toBe(false);
    expect(cycle.results.get("box.width")).toMatchObject({ ok: false, error: { code: "#CYCLE!" } });
  });

  it("keeps the error of a failed attribute, and a reader gets the same error", () => {
    const failed = model("error");
    const own = failed.results.get("box.height");
    expect(own).toMatchObject({ ok: false, error: { code: "#VALUE!" } });
    expect(failed.results.get("panel.height")).toEqual(own);
    expect(failed.order.has("box.width")).toBe(false);
  });

  it("writes each formula for a reader", () => {
    const doc = SCENARIOS[0]!.doc;
    expect(SLOTS.map((slot) => formulaText(formulaOf(doc, slot)))).toEqual(["300", "children[0].height + 20", "parent.width − 20", "40"]);
  });
});
