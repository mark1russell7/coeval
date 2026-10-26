import { describe, expect, it } from "vitest";
import {
  type Domain,
  type FormulaProfile,
  type Random,
  agree,
  context,
  decodeValue,
  encodeValue,
  formulaDefinitions,
  formulaMachine,
  ok,
  random,
  sameValue,
  typeCheck,
} from "./index.ts";

const DOMAINS: Readonly<Record<string, Domain>> = {
  big: {
    is: (value) => typeof value === "bigint",
    summary: "A whole number of any size.",
    codec: {
      encode: (value) => String(value),
      decode: (data) => {
        if (typeof data !== "string") throw new TypeError("The data is not a text.");
        return BigInt(data);
      },
    },
  },
  date: {
    is: (value) => value instanceof Date && !Number.isNaN(value.getTime()),
    summary: "A time.",
    codec: { encode: (value) => (value as Date).toISOString(), decode: (data) => new Date(data as string) },
  },
  color: { is: (value) => typeof value === "string" && value.startsWith("#"), under: ["text"], summary: "A color without a codec." },
  wrong: { is: (value) => value === "member", codec: { encode: () => "x", decode: () => 5 } },
};

const PROFILE: FormulaProfile = { ops: { add: (a: number, b: number) => a + b } };
const machine = formulaMachine(PROFILE, { domains: DOMAINS });
const definitions = formulaDefinitions(PROFILE);
const LIT = { declaredType: "lit" } as const;
const domainDoc = (domain: string, data: unknown): unknown => ({ type: ["ext", "domain"], value: { domain, data } });

/** Two dates are the same when they hold the same time. Each other pair gets the rules of `sameValue`. */
const sameDate = (a: unknown, b: unknown): boolean | undefined => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : undefined);

describe("the codec of values", () => {
  it("[EXT.DOMAIN] ext.domain reads its data through the codec of the domain", () => {
    expect(decodeValue(machine, domainDoc("big", "12345678901234567890"))).toEqual(ok(12345678901234567890n));
    const date = decodeValue(machine, domainDoc("date", "2026-10-25T00:00:00.000Z"));
    expect(date.ok && date.value instanceof Date && date.value.getTime()).toBe(Date.UTC(2026, 9, 25));
    // An extension inside a term evaluates as a term.
    expect(decodeValue(machine, { type: "list", value: [domainDoc("big", "1"), 2] })).toEqual(ok([1n, 2]));
    const code = (doc: unknown): unknown => {
      const result = decodeValue(machine, doc);
      return result.ok ? "ok" : result.error.code;
    };
    expect(code(domainDoc("nothing", "1"))).toBe("#NAME?");
    expect(code(domainDoc("color", "#fff"))).toBe("#NAME?");
    expect(code(domainDoc("text", "a"))).toBe("#NAME?");
    expect(code(domainDoc("big", 1))).toBe("#VALUE!");
    expect(code(domainDoc("big", "1.5"))).toBe("#VALUE!");
    expect(code(domainDoc("wrong", "x"))).toBe("#VALUE!");
    expect(code({ type: ["ext", "domain"], value: { domain: "big" } })).toBe("#VALUE!");
    expect(code({ type: ["ext", "domain"], value: { domain: "big", data: "1", more: 1 } })).toBe("#VALUE!");
    expect(code({ type: ["ext", "domain"], value: "big" })).toBe("#VALUE!");
    // The reference reads the same domains, thus it agrees with the plan.
    for (const doc of [domainDoc("big", "7"), domainDoc("big", 1), domainDoc("nothing", 1), domainDoc("wrong", "x"), domainDoc("color", "#fff")]) {
      expect(agree(machine, doc, context(), { ...LIT, definitions }).ok).toBe(true);
    }
    // A profile extension with the name domain replaces the standard one.
    const own = formulaMachine({ ext: { domain: () => ok("own") } }, { domains: DOMAINS });
    expect(decodeValue(own, domainDoc("big", "1"))).toEqual(ok("own"));
  });

  it("[EXT.ENCODE] encodeValue writes each host value as a term document", () => {
    expect(encodeValue(machine, 1)).toBe(1);
    expect(encodeValue(machine, { a: [1, "b", null, true] })).toEqual({ a: [1, "b", null, true] });
    expect(encodeValue(machine, { type: "ref", value: ["x"] })).toEqual({ type: "lit", value: { type: "ref", value: ["x"] } });
    expect(encodeValue(machine, Number.NaN)).toEqual({ type: ["ext", "number"], value: "NaN" });
    expect(encodeValue(machine, -0)).toEqual({ type: ["ext", "number"], value: "-0" });
    expect(encodeValue(machine, Number.NEGATIVE_INFINITY)).toEqual({ type: ["ext", "number"], value: "-Infinity" });
    expect(encodeValue(machine, undefined)).toEqual({ type: ["ext", "undefined"], value: null });
    expect(encodeValue(machine, 5n)).toEqual(domainDoc("big", "5"));
    expect(encodeValue(machine, new Date(Date.UTC(2026, 9, 25)))).toEqual(domainDoc("date", "2026-10-25T00:00:00.000Z"));
    // A text of a domain without a codec is JSON, and JSON wins over each codec.
    expect(encodeValue(machine, "#fff")).toBe("#fff");
    expect(encodeValue(machine, "member")).toBe("member");
    expect(encodeValue(machine, [1, Number.NaN])).toEqual({ type: "list", value: [1, { type: ["ext", "number"], value: "NaN" }] });
    expect(encodeValue(machine, { a: 1n, b: { type: "x", value: 1 } })).toEqual({ type: "record", value: { a: domainDoc("big", "1"), b: { type: "lit", value: { type: "x", value: 1 } } } });
    expect(encodeValue({}, -0)).toEqual({ type: ["ext", "number"], value: "-0" });
    expect(() => encodeValue({}, 1n)).toThrow(TypeError);
    expect(() => encodeValue(machine, () => 1)).toThrow(TypeError);
    expect(() => encodeValue(machine, new Map())).toThrow(TypeError);
    const cycle: unknown[] = [Number.NaN];
    cycle.push(cycle);
    expect(() => encodeValue(machine, cycle)).toThrow(/cycle/);
  });

  it("[EXT.ROUNDTRIP] decodeValue gives each generated value again", () => {
    const KEYS = ["a", "b", "type", "value", "name", "__proto__"];
    const SCALARS: readonly (() => unknown)[] = [
      () => null,
      () => true,
      () => "text",
      () => "ref",
      () => 0,
      () => 2.5,
      () => -0,
      () => Number.NaN,
      () => Number.POSITIVE_INFINITY,
      () => Number.NEGATIVE_INFINITY,
      () => undefined,
      () => 2n ** 70n,
      () => new Date(Date.UTC(2020, 1, 29, 12)),
    ];
    const value = (rng: Random, depth: number): unknown => {
      const pick = rng.int(depth > 3 ? 1 : 4);
      if (pick === 0) return (SCALARS[rng.int(SCALARS.length)] as () => unknown)();
      if (pick === 1) return Array.from({ length: rng.int(4) }, () => value(rng, depth + 1));
      const record: Record<string, unknown> = {};
      for (let index = rng.int(4); index > 0; index -= 1) {
        Object.defineProperty(record, KEYS[rng.int(KEYS.length)] as string, { value: value(rng, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return record;
    };
    const bad: string[] = [];
    for (let seed = 1; seed <= 300; seed += 1) {
      const original = value(random(seed), 0);
      const doc = encodeValue(machine, original);
      const back = decodeValue(machine, doc);
      if (!back.ok || !sameValue(back.value, original, sameDate)) bad.push(`seed ${seed}: ${JSON.stringify(doc)}`);
      if (!agree(machine, doc, context(), { ...LIT, definitions, equal: sameDate }).ok) bad.push(`seed ${seed} disagrees: ${JSON.stringify(doc)}`);
    }
    expect(bad.slice(0, 3)).toEqual([]);
  });

  it("[EXT.TYPE] the check of types gives ext.domain the type of its domain", () => {
    expect(typeCheck(machine, domainDoc("big", "1"), LIT).type).toBe("big");
    expect(typeCheck(machine, domainDoc("color", "#fff"), LIT).type).toBe("unknown");
    expect(typeCheck(machine, domainDoc("nothing", "1"), LIT).type).toBe("unknown");
    expect(typeCheck(machine, { type: ["ext", "number"], value: "NaN" }, LIT).type).toBe("number");
  });
});
