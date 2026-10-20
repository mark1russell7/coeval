import { describe, expect, it } from "vitest";
import { ask, classify, tag, typed, type Shape, type World } from "./index.ts";

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
    const answer = ask(world, typed("rule", { use: "stack" }, { own: { view: "my.view" } }), "view");
    expect(answer).toMatchObject({ evaluator: "my.view", rung: "own" });
    expect(answer.steps).toHaveLength(1);
  });

  it("takes the kind when the document has no own entry", () => {
    const answer = ask(world, typed("rule", null), "view");
    expect(answer).toMatchObject({ evaluator: "rule.view", rung: "kind" });
    expect(answer.steps.at(-1)).toMatchObject({ kind: "rule", source: "document" });
  });

  it("takes the type that the position declares for a bare value", () => {
    const answer = ask(world, {}, "view", { declaredType: "card" });
    expect(answer).toMatchObject({ evaluator: "card.view", rung: "kind" });
    expect(answer.steps.at(-1)).toMatchObject({ kind: "card", source: "container" });
  });

  it("lets the type of an envelope win over the declared type", () => {
    expect(ask(world, typed("rule", null), "view", { declaredType: "card" }).evaluator).toBe("rule.view");
  });

  it("goes past the kind to the default", () => {
    const answer = ask(world, typed("sequence", []), "view");
    expect(answer).toMatchObject({ evaluator: "json.view", rung: "default" });
    expect(answer.steps.map((step) => `${step.rung}:${step.outcome}`)).toEqual([
      "own:no-entry",
      "kind:no-entry",
      "default:answers",
    ]);
  });

  it("does not guess a type for a bare value without a declared type", () => {
    const answer = ask(world, {}, "view");
    expect(answer.steps.map((step) => step.outcome)).toEqual(["no-entry", "skipped", "answers"]);
  });

  it("stops at a kind that the world does not have", () => {
    const answer = ask(world, typed("rul", null), "view");
    expect(answer.error).toBe("unknown-kind");
    expect(answer.evaluator).toBeUndefined();
  });

  it("gives no answer when no rung has the verb", () => {
    expect(ask(world, typed("rule", null), "run").error).toBe("no-answer");
  });

  it("does not read inherited members as entries", () => {
    expect(ask(world, typed("constructor", null), "view").error).toBe("unknown-kind");
    expect(ask(world, typed("rule", null), "toString").error).toBe("no-answer");
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

  it("reports a value that no shape matches", () => {
    expect(classify(shapes, { name: "a" }).error).toBe("no-match");
    expect(classify(shapes, 7).error).toBe("no-match");
  });

  it("puts the value in an envelope, and the ladder then answers by the type", () => {
    const raw = { width: 1, height: 1 };
    const tagged = tag(raw, "card");
    expect(tagged).toEqual({ type: "card", value: { width: 1, height: 1 } });
    expect(ask(world, tagged, "view").evaluator).toBe("card.view");
  });
});
