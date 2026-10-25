import { describe, expect, it } from "vitest";
import { type Result, Held, context, docEquals, fail, formulaMachine, ok, prepare, sameResult, sameValue } from "./index.ts";

/** A rule of a host that compares two dates by their time, and answers nothing for other values. */
function dates(a: unknown, b: unknown): boolean | undefined {
  return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : undefined;
}

describe("sameResult, a safe equality for an early cutoff", () => {
  it("[RESULT.SAME] plain JSON compares by structure, and the order of the fields does not matter", () => {
    expect(sameResult(ok({ a: [1, { b: "x" }], c: null }), ok({ c: null, a: [1, { b: "x" }] }))).toBe(true);
    expect(sameResult(ok({ a: [1, 2] }), ok({ a: [1, 2, 3] }))).toBe(false);
    expect(sameResult(ok({ a: 1 }), ok({ a: 1, b: undefined }))).toBe(false);
    expect(sameResult(ok(undefined), ok(undefined))).toBe(true);
    expect(sameResult(ok(undefined), ok(null))).toBe(false);
  });

  it("[RESULT.SAME] each other object is the same only as itself: two dates with one time differ, and one date is the same", () => {
    const date = new Date(0);
    expect(sameResult(ok(new Date(0)), ok(new Date(0)))).toBe(false);
    expect(sameResult(ok(date), ok(date))).toBe(true);
    expect(sameResult(ok({ when: [date] }), ok({ when: [date] }))).toBe(true);
    expect(sameResult(ok(new Map([["a", 1]])), ok(new Map([["a", 1]])))).toBe(false);
  });

  it("[RESULT.SAME] NaN is NaN, and -0 is not 0", () => {
    expect(sameResult(ok(Number.NaN), ok(Number.NaN))).toBe(true);
    expect(sameResult(ok([Number.NaN]), ok([Number.NaN]))).toBe(true);
    expect(sameResult(ok(-0), ok(0))).toBe(false);
    expect(sameResult(ok({ x: 0 }), ok({ x: -0 }))).toBe(false);
  });

  it("[RESULT.SAME] a closure of fn is the same only as itself, but sameValue compares two closures by their parameters", () => {
    const plan = prepare(formulaMachine(), { type: "fn", value: { params: ["a"], body: 1 } });
    const first = plan.evaluate();
    const second = plan.evaluate();
    expect(sameResult(first, first)).toBe(true);
    expect(sameResult(first, second)).toBe(false);
    expect(sameValue(first.ok ? first.value : undefined, second.ok ? second.value : undefined)).toBe(true);
  });

  it("[RESULT.SAME] a rule of the host answers first, for example for two dates", () => {
    expect(sameResult(ok({ when: new Date(5) }), ok({ when: new Date(5) }), dates)).toBe(true);
    expect(sameResult(ok({ when: new Date(5) }), ok({ when: new Date(6) }), dates)).toBe(false);
    expect(sameResult(ok({ a: 1 }), ok({ a: 1 }), () => undefined)).toBe(true);
  });

  it("[RESULT.SAME] for plain JSON, sameResult, sameValue and docEquals give the same answer", () => {
    const values: unknown[] = [null, true, 0, -0, 1, Number.NaN, "", "a", [], [1], [1, 2], {}, { a: 1 }, { a: 1, b: [2] }, { b: [2], a: 1 }, { a: { b: { c: [null] } } }];
    for (const a of values) {
      for (const b of values) {
        const same = docEquals(a, b);
        expect(sameResult(ok(a), ok(b)), `${JSON.stringify(a)} and ${JSON.stringify(b)}`).toBe(same);
        expect(sameValue(a, b), `${JSON.stringify(a)} and ${JSON.stringify(b)}`).toBe(same);
      }
    }
  });

  it("[RESULT.SAME] a schedule stops at the cutoff when a part evaluates again to the same value", () => {
    const machine = formulaMachine();
    const plan = prepare(machine, { type: "ref", value: ["names", "card", "width"] });
    const before = plan.evaluate(context({ names: { card: { width: 300, height: 1 } } }));
    const same = plan.evaluate(context({ names: { card: { width: 300, height: 2 } } }));
    const changed = plan.evaluate(context({ names: { card: { width: 301, height: 2 } } }));
    expect(sameResult(before, same)).toBe(true);
    expect(sameResult(before, changed)).toBe(false);
  });

  it("[RESULT.SAME-ERROR] two errors are the same with the same code, reason and place, and the cause is not compared", () => {
    const a = fail("#CALC!", "The operation threw.", { place: ["value", 0], cause: new Error("one") });
    const b = fail("#CALC!", "The operation threw.", { place: ["value", 0], cause: new Error("two") });
    expect(sameResult(a, b)).toBe(true);
    expect(sameResult(a, fail("#CALC!", "Another reason.", { place: ["value", 0] }))).toBe(false);
    expect(sameResult(a, fail("#VALUE!", "The operation threw.", { place: ["value", 0] }))).toBe(false);
    expect(sameResult(a, fail("#CALC!", "The operation threw.", { place: ["value", 1] }))).toBe(false);
    expect(sameResult(a, fail("#CALC!", "The operation threw."))).toBe(false);
    expect(sameResult(fail("#N/A", "No place."), fail("#N/A", "No place."))).toBe(true);
  });

  it("[RESULT.SAME-ERROR] a value and an error are not the same", () => {
    const error: Result = fail("#N/A", "The step reaches nothing.");
    expect(sameResult(ok(null), error)).toBe(false);
    expect(sameResult(error, ok(null))).toBe(false);
    expect(sameResult(ok(undefined), error, () => true)).toBe(false);
  });

  it("[RESULT.SAME-ERROR] a held error in a value compares by the same rule", () => {
    const held = (reason: string, cause?: unknown): Held => new Held({ code: "#N/A", reason, place: [0], ...(cause === undefined ? {} : { cause }) });
    expect(sameResult(ok({ x: held("Gone.", 1) }), ok({ x: held("Gone.", 2) }))).toBe(true);
    expect(sameResult(ok({ x: held("Gone.") }), ok({ x: held("Lost.") }))).toBe(false);
    expect(sameValue({ x: held("Gone.") }, { x: held("Lost.") })).toBe(true);
    expect(sameResult(ok(held("Gone.")), ok({ code: "#N/A", reason: "Gone.", place: [0] }))).toBe(false);
  });
});
