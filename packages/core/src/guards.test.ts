import { describe, expect, it } from "vitest";
import { type Json, type ValueType, agreeTypes, boundariesOf, context, evaluate, formulaMachine, member, prepare, random, run, typeCheck } from "./index.ts";

const LIT = { declaredType: "lit" } as const;
const op = (name: string, ...value: Json[]): Json => ({ type: ["ops", name], value });
const ref = (...value: Json[]): Json => ({ type: "ref", value });

const machine = formulaMachine({
  ops: { add: (a: number, b: number) => a + b, text: (a: unknown) => String(a) },
  sigs: { add: { params: ["number", "number"], to: "number" }, text: { params: ["unknown"], to: "text" } },
});
const SCHEMA = { self: { record: { x: "number" }, closed: true } } as const;

describe("the guards at the boundaries of types", () => {
  it("[PLAN.GUARD] gives #VALUE! at the reference for a store value that does not obey its schema", () => {
    const doc = op("add", ref("self", "x"), 1);
    const guards = boundariesOf(typeCheck(machine, doc, { rootTypes: SCHEMA }), machine.domains);
    const plan = prepare(machine, doc, { guards });
    expect(plan.evaluate(context({ self: { x: 2 } }))).toEqual({ ok: true, value: 3 });
    const bad = plan.evaluate(context({ self: { x: "a" } }));
    expect(bad).toMatchObject({ ok: false, error: { code: "#VALUE!", place: [0] } });
  });

  it("[PLAN.GUARD] gives the failure of the part, not a failure of its boundary", () => {
    const doc = op("add", ref("self", "y"), 1);
    const rootTypes = { self: { record: { y: "number" }, optional: ["y"], closed: true } };
    const typing = typeCheck(machine, doc, { rootTypes });
    const found = evaluate(machine, doc, context({ self: {} }), { guards: boundariesOf(typing, machine.domains) }).result;
    expect(found).toMatchObject({ ok: false, error: { code: "#N/A" } });
  });

  it("[PLAN.GUARD] shows the failure at the boundary in a trace", () => {
    const doc = op("text", ref("self", "x"));
    const guards = boundariesOf(typeCheck(machine, doc, { rootTypes: SCHEMA }), machine.domains);
    const traced = evaluate(machine, doc, context({ self: { x: "a" } }), { guards }).trace;
    expect(traced.children[0]?.result).toMatchObject({ ok: false, error: { code: "#VALUE!" } });
  });

  it("[PLAN.GUARD] tests a part that folds", () => {
    const doc = op("add", op("text", 1), 2);
    const typing = typeCheck(machine, doc, LIT);
    expect(typing.issues).toHaveLength(1);
    const guards = [{ place: [0], type: "number" as ValueType }];
    expect(prepare(machine, doc, { ...LIT, guards }).evaluate(context())).toMatchObject({ ok: false, error: { code: "#VALUE!", place: [0] } });
  });

  it("[PLAN.GUARD] holds on the run side", async () => {
    const doc = ref("self", "x");
    const guards = boundariesOf(typeCheck(machine, doc, { rootTypes: SCHEMA }), machine.domains);
    expect((await run(machine, doc, context({ self: { x: "a" } }), { guards })).result).toMatchObject({ ok: false, error: { code: "#VALUE!" } });
  });

  it("[PLAN.GUARD-NONE] adds no test without the option", () => {
    const doc = op("add", ref("self", "x"), 1);
    expect(prepare(machine, doc).evaluate(context({ self: { x: "a" } }))).toEqual({ ok: true, value: "a1" });
    expect(prepare(machine, doc, { guards: [] }).evaluate(context({ self: { x: "a" } }))).toEqual({ ok: true, value: "a1" });
  });

  it("[PLAN.GUARD-BOUNDARY] names a part of the type unknown at a position with a type, with the needed type", () => {
    const doc = op("add", ref("self", "x"), 1);
    expect(boundariesOf(typeCheck(machine, doc), machine.domains)).toEqual([{ place: [0], type: "number" }]);
  });

  it("[PLAN.GUARD-BOUNDARY] names a read of a known type, and no part with a proof", () => {
    const doc = op("text", op("add", ref("self", "x"), 1));
    expect(boundariesOf(typeCheck(machine, doc, { rootTypes: SCHEMA }), machine.domains)).toEqual([{ place: [0, 0], type: "number" }]);
    expect(boundariesOf(typeCheck(machine, op("add", 1, 2), LIT), machine.domains)).toEqual([]);
  });

  it("[PLAN.GUARD-BOUNDARY] does not name a read of the type unknown at a position with no type", () => {
    expect(boundariesOf(typeCheck(machine, op("text", ref("self", "x"))), machine.domains)).toEqual([]);
  });

  it("[PLAN.GUARD] makes the rule of agreement hold for a context that does not obey its root types", () => {
    const rng = random(23);
    const leaf = (): Json => [null, true, 1, "a", [], [1], { x: 1 }, { x: "a" }][rng.int(8)] as Json;
    const count = (depth: number): Json => {
      if (depth === 0) return rng.next() < 0.7 ? ref("self", "x") : 1;
      return op("add", count(depth - 1), count(depth - 1));
    };
    const part = (depth: number): Json => (rng.next() < 0.3 ? op("text", ref("self", "y")) : rng.next() < 0.5 ? op("text", count(depth)) : count(depth));
    const rootTypes = { self: { record: { x: "number", y: "text" }, closed: true } } as const;
    let checked = 0;
    let failed = 0;
    for (let index = 0; index < 400; index += 1) {
      const doc = part(3);
      const ctx = context({ self: { x: leaf(), y: leaf() } });
      const agreed = agreeTypes(machine, doc, ctx, { rootTypes, guards: true });
      expect(agreed.ok, JSON.stringify([doc, ctx])).toBe(true);
      if (!agreed.ok || !agreed.checked) continue;
      checked += 1;
      const typing = typeCheck(machine, doc, { rootTypes });
      const result = evaluate(machine, doc, ctx, { guards: boundariesOf(typing, machine.domains) }).result;
      if (result.ok) expect(member(result.value, typing.type, machine.domains)).toBe(true);
      else failed += 1;
    }
    expect(checked).toBeGreaterThan(40);
    expect(failed).toBeGreaterThan(10);
  });
});
