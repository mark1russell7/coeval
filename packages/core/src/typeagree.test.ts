import { describe, expect, it } from "vitest";
import { type Domain, type FormulaProfile, type Json, type Machine, type OpFn, type Signature, Failure, agreeTypes, context, fail, formulaMachine, mergeMachines, random, typeCheck } from "./index.ts";

const LIT = { declaredType: "lit" } as const;
const op = (name: string, ...value: Json[]): Json => ({ type: ["ops", name], value });
const ref = (...value: Json[]): Json => ({ type: "ref", value });
const PLACE = ["0"];

const OPS: Readonly<Record<string, OpFn>> = {
  add: (a, b) => (a as number) + (b as number),
  text: (a) => String(a),
  wrong: (a) => String(a),
  gone: () => {
    throw new Failure(fail("#VALUE!", "The operation fails.").error);
  },
};
const SIGS: Readonly<Record<string, Signature>> = {
  add: { params: ["number", "number"], to: "number" },
  text: { params: ["number"], to: "text" },
  wrong: { params: ["number"], to: "number" },
  gone: { params: [], to: "number" },
};
const machine = formulaMachine({ ops: OPS, sigs: SIGS } as FormulaProfile);

describe("the agreement rule for types", () => {
  it("[STATIC.TYPES-AGREE] accepts a document that checks, and counts each value of its trace", () => {
    expect(agreeTypes(machine, op("text", op("add", 1, 2)), context(), LIT)).toEqual({ ok: true, checked: true, values: 4 });
  });

  it("[STATIC.TYPES-AGREE] tells nothing about a document with an issue", () => {
    expect(agreeTypes(machine, op("add", "a", 1), context(), LIT)).toEqual({ ok: true, checked: false, values: 0 });
  });

  it("[STATIC.TYPES-AGREE] finds a signature with a wrong result, at its place", () => {
    const found = agreeTypes(machine, op("add", op("wrong", 1), 2), context(), LIT);
    expect(found).toMatchObject({ ok: false, clause: "value", place: PLACE });
  });

  it("[STATIC.TYPES-AGREE] finds a root that is not a member of its root type", () => {
    const rootTypes = { self: { record: { x: "number" } } };
    expect(agreeTypes(machine, ref("self", "x"), context({ self: { x: "a" } }), { rootTypes })).toMatchObject({ ok: false, clause: "value" });
    expect(agreeTypes(machine, ref("self", "x"), context({ self: { x: 1 } }), { rootTypes })).toMatchObject({ ok: true, checked: true });
  });

  it("[STATIC.TYPES-AGREE] finds a false cover at the position that needs the covered type", () => {
    const domains: Readonly<Record<string, Domain>> = {
      whole: { is: (value) => typeof value === "number", covers: [["small", "big"]] },
      small: { is: (value) => typeof value === "number" && value < 1, under: ["whole"] },
      big: { is: (value) => typeof value === "number" && value > 9, under: ["whole"] },
    };
    const sigs: Readonly<Record<string, Signature>> = {
      make: { params: [], to: "whole" },
      use: { params: [{ union: ["small", "big"] }], to: "number" },
    };
    const covered: Machine = mergeMachines(formulaMachine({ ops: { make: () => 5, use: () => 1 }, sigs }), { domains });
    expect(agreeTypes(covered, op("use", op("make")), context(), LIT)).toMatchObject({ ok: false, clause: "argument", place: PLACE });
  });

  it("[STATIC.TYPES-AGREE] finds a test without a truth in a language that promises one, at the place of the error", () => {
    const lying = formulaMachine({ ops: { maybe: () => 1 }, sigs: { maybe: { params: [], to: "bool" } } });
    const doc: Json = { type: "if", value: { test: op("maybe"), then: 1, else: 2 } };
    expect(agreeTypes(lying, doc, context(), LIT)).toMatchObject({ ok: false, clause: "value" });
    const loose = formulaMachine({ ops: { maybe: () => 1 } });
    expect(agreeTypes(loose, doc, context(), LIT)).toMatchObject({ ok: true });
  });

  it("[STATIC.TYPES-AGREE] tells nothing after a value breaks a position of the type unknown", () => {
    const doc = op("text", op("add", ref("self", "x"), 1));
    expect(agreeTypes(machine, doc, context({ self: { x: 2 } }))).toMatchObject({ ok: true, checked: true });
    expect(agreeTypes(machine, doc, context({ self: { x: "a" } }))).toEqual({ ok: true, checked: false, values: 0 });
  });

  it("[STATIC.TYPES-AGREE] gives no finding for a failure of an operation", () => {
    expect(agreeTypes(machine, op("gone"), context(), LIT)).toMatchObject({ ok: true, checked: true });
  });

  it("[STATIC.TYPES-AGREE] finds an operation that the check sees and the evaluation does not see", () => {
    let reads = 0;
    const ops = (name: string): OpFn | undefined => {
      reads += 1;
      return name === "lost" && reads === 1 ? () => 1 : undefined;
    };
    const fleeting = formulaMachine({ ops, sigs: { lost: { params: [], to: "number" } } });
    expect(agreeTypes(fleeting, op("lost"), context(), LIT)).toMatchObject({ ok: false, clause: "error", place: [] });
  });

  it("[STATIC.TYPES-AGREE] finds a member of the truth type that has no truth", () => {
    const truthy = (value: unknown): boolean | undefined => (value === 0 ? false : value === 1 ? true : undefined);
    const doc: Json = { type: "if", value: { test: op("make"), then: 1, else: 2 } };
    const profile = { truthy, ops: { make: () => 2 }, sigs: { make: { params: [], to: "number" } } };
    expect(agreeTypes(formulaMachine({ ...profile, truthType: "number" }), doc, context(), LIT)).toMatchObject({ ok: false, clause: "error", place: [] });
    expect(agreeTypes(formulaMachine(profile), doc, context(), LIT)).toMatchObject({ ok: true, checked: true });
  });

  it("[STATIC.TYPES-AGREE] does not throw for random values, and the check does not throw", () => {
    const rng = random(17);
    const leaf = (): Json => [null, true, 1, "a", "type", "value", [], {}][rng.int(8)] as Json;
    const value = (depth: number): Json => {
      if (depth === 0 || rng.next() < 0.3) return leaf();
      const parts = Array.from({ length: rng.int(3) }, () => value(depth - 1));
      const roll = rng.next();
      if (roll < 0.4) return parts;
      if (roll < 0.7) return { type: ["if", "and", "ref", "lit", "let", "fn"][rng.int(6)] as string, value: parts };
      return { type: ["ops", "add"], value: parts };
    };
    for (let index = 0; index < 300; index += 1) {
      const doc = value(4);
      expect(() => typeCheck(machine, doc, LIT), JSON.stringify(doc)).not.toThrow();
      expect(agreeTypes(machine, doc, context(), LIT).ok, JSON.stringify(doc)).toBe(true);
    }
  });
});
