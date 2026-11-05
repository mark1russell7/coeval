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

/** A shape of a kind and a size, for the domains of EXT.SPECIFIC. JSON does not write an instance of a class. */
class Shape {
  readonly kind: string;
  readonly size: number;

  constructor(kind: string, size: number) {
    this.kind = kind;
    this.size = size;
  }
}

/**
 * This function gives a domain of shapes with a codec. With kinds, the domain holds only the shapes of those kinds. A
 * domain of one kind writes only the size, and the other domains write the kind and the size.
 */
function shapes(...kinds: readonly string[]): Domain {
  const is = (value: unknown): boolean => value instanceof Shape && (kinds.length === 0 || kinds.includes(value.kind));
  if (kinds.length === 1) {
    const kind = kinds[0] as string;
    return { is, codec: { encode: (value) => (value as Shape).size, decode: (data) => new Shape(kind, data as number) } };
  }
  return { is, codec: { encode: (value) => [(value as Shape).kind, (value as Shape).size], decode: (data) => new Shape(...(data as [string, number])) } };
}

/** Two shapes are the same when they have the same kind and size. Each other pair gets the rules of `sameValue`. */
const sameShape = (a: unknown, b: unknown): boolean | undefined => (a instanceof Shape && b instanceof Shape ? a.kind === b.kind && a.size === b.size : undefined);

/** This function tells that `decodeValue` gives each value again, and that the reference agrees with the plan. */
function roundTrip(own: ReturnType<typeof formulaMachine>, values: readonly unknown[]): void {
  for (const value of values) {
    const doc = encodeValue(own, value);
    const back = decodeValue(own, doc);
    expect(back.ok && sameValue(back.value, value, sameShape)).toBe(true);
    expect(agree(own, doc, context(), { ...LIT, definitions, equal: sameShape }).ok).toBe(true);
  }
}

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

  it("[EXT.SPECIFIC] the codec of a domain under another domain encodes its members, whatever the names", () => {
    // Each pair of names puts the child first and last in the order of the names.
    for (const [parent, child] of [
      ["a-shape", "z-square"],
      ["z-shape", "a-square"],
    ] as const) {
      const domains = { [parent]: shapes(), [child]: { ...shapes("square"), under: [parent] } };
      const own = formulaMachine(PROFILE, { domains });
      expect(encodeValue(own, new Shape("square", 2))).toEqual(domainDoc(child, 2));
      expect(encodeValue(own, new Shape("circle", 3))).toEqual(domainDoc(parent, ["circle", 3]));
      expect(encodeValue(own, [new Shape("square", 1), new Shape("circle", 1)])).toEqual({ type: "list", value: [domainDoc(child, 1), domainDoc(parent, ["circle", 1])] });
      roundTrip(own, [new Shape("square", 2), new Shape("circle", 3)]);
    }
    // A chain of three domains: the deepest domain that holds the value wins, in each order of the names.
    for (const [top, middle, bottom] of [
      ["a-shape", "b-quad", "c-square"],
      ["c-shape", "b-quad", "a-square"],
      ["b-shape", "c-quad", "a-square"],
    ] as const) {
      const domains = { [top]: shapes(), [middle]: { ...shapes("square", "rect"), under: [top] }, [bottom]: { ...shapes("square"), under: [middle] } };
      const own = formulaMachine(PROFILE, { domains });
      expect(encodeValue(own, new Shape("square", 1))).toEqual(domainDoc(bottom, 1));
      expect(encodeValue(own, new Shape("rect", 1))).toEqual(domainDoc(middle, ["rect", 1]));
      expect(encodeValue(own, new Shape("circle", 1))).toEqual(domainDoc(top, ["circle", 1]));
      roundTrip(own, [new Shape("square", 1), new Shape("rect", 1), new Shape("circle", 1)]);
    }
    // A chain through a domain without a codec counts too. A parent that is not a domain ends the chain.
    const through = formulaMachine(PROFILE, {
      domains: { "a-shape": shapes(), "b-quad": { is: shapes("square", "rect").is, under: ["a-shape", "nothing"] }, "z-square": { ...shapes("square"), under: ["b-quad"] } },
    });
    expect(encodeValue(through, new Shape("square", 1))).toEqual(domainDoc("z-square", 1));
    expect(encodeValue(through, new Shape("rect", 1))).toEqual(domainDoc("a-shape", ["rect", 1]));
    // Two domains in a cycle of parents hold the same members, thus the first name wins. The cycle ends.
    const cycle = formulaMachine(PROFILE, { domains: { "z-one": { ...shapes(), under: ["a-two"] }, "a-two": { ...shapes(), under: ["z-one"] }, "m-square": { ...shapes("square"), under: ["z-one"] } } });
    expect(encodeValue(cycle, new Shape("circle", 1))).toEqual(domainDoc("a-two", ["circle", 1]));
    expect(encodeValue(cycle, new Shape("square", 1))).toEqual(domainDoc("m-square", 1));
    roundTrip(cycle, [new Shape("circle", 1), new Shape("square", 1)]);
  });

  it("[EXT.TIE] between unrelated domains with codecs, the deeper domain wins, and then the first name", () => {
    // Two unrelated domains of the same depth: the first name wins in each order of the table.
    for (const domains of [
      { "b-small": shapes("square"), "a-any": shapes() },
      { "a-any": shapes(), "b-small": shapes("square") },
    ]) {
      const own = formulaMachine(PROFILE, { domains });
      expect(encodeValue(own, new Shape("square", 1))).toEqual(domainDoc("a-any", ["square", 1]));
      roundTrip(own, [new Shape("square", 1)]);
    }
    // A domain with a parent with a codec is deeper than an unrelated domain without one, thus it wins over the first name.
    const deeper = formulaMachine(PROFILE, { domains: { "a-any": shapes(), "m-shape": shapes(), "z-square": { ...shapes("square"), under: ["m-shape"] } } });
    expect(encodeValue(deeper, new Shape("square", 1))).toEqual(domainDoc("z-square", 1));
    expect(encodeValue(deeper, new Shape("circle", 1))).toEqual(domainDoc("a-any", ["circle", 1]));
    // A parent without a codec adds no depth.
    const plain = formulaMachine(PROFILE, { domains: { "a-any": shapes(), "m-shape": { is: shapes().is }, "z-square": { ...shapes("square"), under: ["m-shape"] } } });
    expect(encodeValue(plain, new Shape("square", 1))).toEqual(domainDoc("a-any", ["square", 1]));
    roundTrip(deeper, [new Shape("square", 1), new Shape("circle", 1)]);
  });

  it("[EXT.TYPE] the check of types gives ext.domain the type of its domain", () => {
    expect(typeCheck(machine, domainDoc("big", "1"), LIT).type).toBe("big");
    expect(typeCheck(machine, domainDoc("color", "#fff"), LIT).type).toBe("unknown");
    expect(typeCheck(machine, domainDoc("nothing", "1"), LIT).type).toBe("unknown");
    expect(typeCheck(machine, { type: ["ext", "number"], value: "NaN" }, LIT).type).toBe("number");
  });
});
