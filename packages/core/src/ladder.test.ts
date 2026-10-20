import { describe, expect, it } from "vitest";
import { ask, classify, tag, type Shape, type World } from "./index.ts";

const world: World = {
  kinds: {
    rule: { verbs: { eval: "rule.eval", view: "rule.view" } },
    card: { verbs: { view: "card.view" } },
    sequence: { verbs: { run: "sequence.run" } },
  },
  defaults: { view: "json.view", check: "always.ok" },
};

describe("ask", () => {
  it("takes the own entry first", () => {
    const answer = ask(world, { $kind: "rule", $own: { view: "my.view" } }, "view");
    expect(answer).toMatchObject({ evaluator: "my.view", rung: "own" });
    expect(answer.steps).toHaveLength(1);
  });

  it("takes the kind when the document has no own entry", () => {
    const answer = ask(world, { $kind: "rule" }, "view");
    expect(answer).toMatchObject({ evaluator: "rule.view", rung: "kind" });
    expect(answer.steps.at(-1)).toMatchObject({ kind: "rule", source: "document" });
  });

  it("takes the kind of the container when the document names no kind", () => {
    const answer = ask(world, { title: "Notes" }, "view", { containerKind: "card" });
    expect(answer).toMatchObject({ evaluator: "card.view", rung: "kind" });
    expect(answer.steps.at(-1)).toMatchObject({ kind: "card", source: "container" });
  });

  it("lets the own kind of the document win over the kind of the container", () => {
    expect(ask(world, { $kind: "rule" }, "view", { containerKind: "card" }).evaluator).toBe("rule.view");
  });

  it("goes past the kind to the default", () => {
    const answer = ask(world, { $kind: "sequence" }, "view");
    expect(answer).toMatchObject({ evaluator: "json.view", rung: "default" });
    expect(answer.steps.map((step) => `${step.rung}:${step.outcome}`)).toEqual([
      "own:no-entry",
      "kind:no-entry",
      "default:answers",
    ]);
  });

  it("does not guess a kind from the shape of a document", () => {
    const answer = ask(world, { width: 1, height: 1 }, "view");
    expect(answer.steps.map((step) => step.outcome)).toEqual(["no-entry", "skipped", "answers"]);
    expect(answer.rung).toBe("default");
  });

  it("stops at a kind that the world does not have", () => {
    const answer = ask(world, { $kind: "rul" }, "view");
    expect(answer.error).toBe("unknown-kind");
    expect(answer.evaluator).toBeUndefined();
  });

  it("gives no answer when no rung has the verb", () => {
    expect(ask(world, { $kind: "rule" }, "run").error).toBe("no-answer");
  });

  it("does not read inherited members as entries", () => {
    expect(ask(world, { $kind: "constructor" }, "view").error).toBe("unknown-kind");
    expect(ask(world, { $kind: "rule" }, "toString").error).toBe("no-answer");
  });
});

describe("classify", () => {
  const shapes: readonly Shape[] = [
    { name: "box", fields: ["width", "height"], kind: "box" },
    { name: "placed-box", fields: ["width", "height", "x", "y"], kind: "placed" },
    { name: "labelled", fields: ["label"], kind: "label" },
  ];

  it("proposes the kind of the most specific shape", () => {
    expect(classify(shapes, { width: 1, height: 1, x: 0, y: 0 })).toEqual({ kind: "placed", candidates: ["placed-box"] });
  });

  it("reports two shapes that match equally well", () => {
    expect(classify(shapes, { width: 1, height: 1, label: "a" })).toEqual({
      candidates: ["box", "labelled"],
      error: "ambiguous",
    });
  });

  it("reports a document that no shape matches", () => {
    expect(classify(shapes, { name: "a" }).error).toBe("no-match");
  });

  it("tags a copy, and the ladder then answers by the name", () => {
    const raw = { width: 1, height: 1 };
    const tagged = tag(raw, "card");
    expect(raw).toEqual({ width: 1, height: 1 });
    expect(ask(world, tagged, "view").evaluator).toBe("card.view");
  });
});
