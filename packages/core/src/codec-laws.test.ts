import { describe, expect, it } from "vitest";
import { type CodecLaw, type Domain, type DomainCodec, type Json, codecLaws, decodeValue, encodeValue, formulaMachine } from "./index.ts";

/** Two dates are the same when they hold the same time. Each other pair gets the rules of `sameValue`. */
const sameDate = (a: unknown, b: unknown): boolean | undefined => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : undefined);

/** Two errors of a range are the same when they have the same message. */
const sameRange = (a: unknown, b: unknown): boolean | undefined => (a instanceof RangeError && b instanceof RangeError ? a.message === b.message : undefined);

/** A shape of a kind and a size. JSON does not write an instance of a class. */
class Shape {
  constructor(
    readonly kind: string,
    readonly size: number,
  ) {}
}

const sameShape = (a: unknown, b: unknown): boolean | undefined => (a instanceof Shape && b instanceof Shape ? a.kind === b.kind && a.size === b.size : undefined);

const isNumber = (value: unknown): boolean => typeof value === "number";
const isText = (value: unknown): boolean => typeof value === "string";

/* The codecs of the tests of the kernel. No domain of `STD_DOMAINS` has a codec. */

const big: Domain = {
  is: (value) => typeof value === "bigint",
  codec: {
    encode: (value) => String(value),
    decode: (data) => {
      if (typeof data !== "string") throw new TypeError("The data is not a text.");
      return BigInt(data);
    },
  },
};
const date: Domain = {
  is: (value) => value instanceof Date && !Number.isNaN(value.getTime()),
  codec: { encode: (value) => (value as Date).toISOString(), decode: (data) => new Date(data as string) },
};
const range: Domain = {
  is: (value) => value instanceof RangeError,
  codec: { encode: (value) => (value as Error).message, decode: (data) => new RangeError(String(data)) },
};
const shape: Domain = {
  is: (value) => value instanceof Shape,
  codec: { encode: (value) => [(value as Shape).kind, (value as Shape).size], decode: (data) => new Shape(...(data as [string, number])) },
};

/** This function gives the laws that a codec breaks for a domain of numbers, with the given samples. */
function broken(codec: DomainCodec, samples: readonly unknown[] = [], is: Domain["is"] = isNumber): readonly CodecLaw[] {
  return codecLaws({ domains: { own: { is, codec } } }, "own", { samples }).map((finding) => finding.obligation);
}

/** A codec that keeps each number that JSON writes, and writes each other number as a text. */
const NUMBERS: DomainCodec = {
  encode: (value) => (Number.isFinite(value) && !Object.is(value, -0) ? (value as number) : Object.is(value, -0) ? "-0" : String(value)),
  decode: (data) => Number(data),
};

describe("the laws of a codec", () => {
  it("[CODEC.STD] each codec of the kernel tests and the codec of values keep each law", () => {
    const domains = { big, date, range, shape };
    expect(codecLaws({ domains }, "big")).toEqual([]);
    expect(codecLaws({ domains }, "big", { samples: [2n ** 200n, -(2n ** 200n)] })).toEqual([]);
    expect(codecLaws({ domains }, "date", { equal: sameDate, samples: [new Date(Date.UTC(2020, 1, 29, 12)), new Date(8.64e15), new Date(-8.64e15)] })).toEqual([]);
    expect(codecLaws({ domains }, "range", { equal: sameRange, samples: [new RangeError("a"), new RangeError("")] })).toEqual([]);
    expect(codecLaws({ domains }, "shape", { equal: sameShape, samples: [new Shape("square", 1), new Shape("", 0.5)] })).toEqual([]);
    // The functions `encodeValue` and `decodeValue` are a codec too. Their members are the values with a document.
    const inner = formulaMachine({}, { domains: { big, date } });
    const hasDocument = (value: unknown): boolean => {
      encodeValue(inner, value);
      return true;
    };
    const decode = (data: Json): unknown => {
      const back = decodeValue(inner, data);
      if (!back.ok) throw new TypeError(back.error.reason);
      return back.value;
    };
    const values: Domain = { is: hasDocument, codec: { encode: (value) => encodeValue(inner, value), decode } };
    const samples = [{ type: "ref", value: ["x"] }, [1n, new Date(0), undefined], { a: [{ b: -0 }] }, [[], {}]];
    expect(codecLaws({ domains: { values } }, "values", { equal: sameDate, samples })).toEqual([]);
  });

  it("[CODEC.LAWS] codecLaws gives the first finding of each law, in the order of the laws, with its probe", () => {
    // Each member breaks three laws. Only the first member of each law gives a finding.
    const findings = codecLaws({ domains: { own: { is: isText, codec: { encode: () => Number.NaN, decode: () => 1 } } } }, "own", { samples: ["first", "second"] });
    expect(findings.map((finding) => finding.obligation)).toEqual(["json", "decode"]);
    expect(findings[0]).toEqual({ obligation: "json", reason: expect.stringContaining("not JSON"), probe: { domain: "own", value: "first", data: Number.NaN } });
    expect(findings[1]?.reason).toMatch(/not a member/);
    // A throw of encode gives no data, and each law after it has no finding for that member.
    const thrower: DomainCodec = {
      encode: () => {
        throw new TypeError("no");
      },
      decode: (data) => data,
    };
    expect(codecLaws({ domains: { own: { is: isNumber, codec: thrower } } }, "own")[0]).toEqual({ obligation: "encode", reason: "encode throws for a member: TypeError: no", probe: { domain: "own", value: 0 } });
    expect(broken(thrower)).toEqual(["encode"]);
    // A name without a domain, and a domain without a codec, are errors of the test and not of the codec.
    expect(() => codecLaws({}, "nothing")).toThrow(/no domain nothing/);
    expect(() => codecLaws({}, "number")).toThrow(/no domain number with a codec/);
    expect(() => codecLaws({ domains: { own: { is: isText } } }, "own")).toThrow(/with a codec/);
    // A correct codec has no finding, and the edge values give its members.
    expect(broken(NUMBERS)).toEqual([]);
  });

  it("[CODEC.JSON] data that JSON does not write exactly breaks the law json", () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    const cases: readonly unknown[] = [
      Number.NaN,
      -0,
      Number.POSITIVE_INFINITY,
      undefined,
      () => 1,
      Symbol.iterator,
      1n,
      cycle,
      new Date(0),
      new Shape("a", 1),
      new Map(),
      [Number.NaN],
      { a: undefined },
      { a: [{ b: -0 }] },
      // A hole of a list, and a record with a function that replaces it in JSON.
      new Array(1),
      { toJSON: () => 1 },
    ];
    for (const data of cases) {
      const codec = { encode: () => data as Json, decode: () => "member" };
      expect(broken(codec, ["member"], (value) => value === "member"), String(typeof data)).toEqual(["json"]);
    }
    for (const data of [0, 1.5, 2 ** 53, "", "\ud800", null, true, [], {}, [[], {}], { a: { b: [null] } }, JSON.parse('{ "__proto__": 1 }') as Json]) {
      const codec = { encode: () => data, decode: () => "member" };
      expect(broken(codec, ["member"], (value) => value === "member")).toEqual([]);
    }
  });

  it("[CODEC.STABLE] a member with two documents breaks the law stable", () => {
    // A counter in `encode`: the second encode gives other data.
    let count = 0;
    expect(
      broken({
        encode: (value) => {
          count += 1;
          return [count, value as number];
        },
        decode: (data) => (data as [number, number])[1],
      }, [1], (value) => value === 1),
    ).toEqual(["stable"]);
    // Two forms of one member: the decoded member has another document, thus the same value has two documents.
    const lower: DomainCodec = { encode: (value) => value as string, decode: (data) => (data as string).toLowerCase() };
    const same = (a: unknown, b: unknown): boolean | undefined => (a as string).toLowerCase() === (b as string).toLowerCase();
    const findings = codecLaws({ domains: { own: { is: isText, codec: lower } } }, "own", { samples: ["Aa"], equal: same });
    expect(findings).toEqual([{ obligation: "stable", reason: expect.stringContaining("decoded member"), probe: { domain: "own", value: "Aa", data: "Aa" } }]);
    // The order of the fields does not matter (DOC.EQUALS).
    let turn = false;
    const fields: DomainCodec = {
      encode: (value) => {
        turn = !turn;
        return turn ? { a: value as number, b: 1 } : { b: 1, a: value as number };
      },
      decode: (data) => (data as { readonly a: number }).a,
    };
    expect(broken(fields, [], (value) => value === 1)).toEqual([]);
  });

  it("[CODEC.DECODE] a throw of decode and a result outside the domain break the law decode", () => {
    const throws: DomainCodec = {
      encode: (value) => value as number,
      decode: () => {
        throw new TypeError("no");
      },
    };
    expect(broken(throws, [1], (value) => value === 1)).toEqual(["decode"]);
    expect(codecLaws({ domains: { own: { is: (value) => value === 1, codec: throws } } }, "own")[0]?.reason).toMatch(/cannot read the data: TypeError: no/);
    // The domain under a parent: a decoded value outside the parent is not a member.
    const parent: Domain = { is: (value) => typeof value === "number" && value > 0 };
    const child: Domain = { is: (value) => value === 1, under: ["parent"], codec: { encode: (value) => value as number, decode: (data) => -(data as number) } };
    const findings = codecLaws({ domains: { parent, child } }, "child");
    expect(findings.map((finding) => finding.obligation)).toEqual(["decode"]);
    expect(findings[0]?.probe).toEqual({ domain: "child", value: 1, data: 1 });
    // The decode reads a JSON copy of the data, thus a table of the data objects does not help.
    const table = new WeakMap<object, unknown>();
    const identity: DomainCodec = {
      encode: (value) => {
        const data = { id: 1 };
        table.set(data, value);
        return data;
      },
      decode: (data) => table.get(data as object),
    };
    expect(broken(identity, [1], (value) => value === 1)).toEqual(["decode"]);
  });

  it("[CODEC.ROUNDTRIP] a decoded member that does not equal the member breaks the law roundtrip", () => {
    // The text of -0 is 0, thus the edge values find the lost sign.
    const lost = codecLaws({ domains: { own: { is: isNumber, codec: { encode: (value) => String(value), decode: (data) => Number(data) } } } }, "own");
    expect(lost).toEqual([{ obligation: "roundtrip", reason: expect.stringContaining("sameValue"), probe: { domain: "own", value: -0, data: "0" } }]);
    // JSON writes NaN and each infinity as null, thus a codec that keeps null loses the infinities. The data of -0 is not JSON.
    expect(broken({ encode: (value) => (Number.isFinite(value) ? (value as number) : null), decode: (data) => data ?? Number.NaN })).toEqual(["json", "roundtrip"]);
    // Two members with one document.
    expect(broken({ encode: () => 1, decode: () => 1 }, [1, 2], (value) => value === 1 || value === 2)).toEqual(["roundtrip"]);
    // A date without the rule equal is the same only as itself, and the rule ends the finding.
    expect(codecLaws({ domains: { date } }, "date").map((finding) => finding.obligation)).toEqual(["roundtrip"]);
    expect(codecLaws({ domains: { date } }, "date", { equal: sameDate })).toEqual([]);
    // A precision that the document loses: a time in a whole second.
    const seconds: Domain = { ...date, codec: { encode: (value) => Math.floor((value as Date).getTime() / 1000), decode: (data) => new Date((data as number) * 1000) } };
    const late = new Date(1500);
    const findings = codecLaws({ domains: { seconds } }, "seconds", { equal: sameDate, samples: [late] });
    expect(findings).toEqual([{ obligation: "roundtrip", reason: expect.any(String), probe: { domain: "seconds", value: late, data: 1 } }]);
  });

  it("[CODEC.SAMPLES] the members come from the samples, the edge values and the lists of the domain", () => {
    const seen = (domain: Domain, samples?: readonly unknown[]): readonly unknown[] => {
      const out: unknown[] = [];
      const codec: DomainCodec = {
        encode: (value) => {
          if (!out.some((item) => Object.is(item, value))) out.push(value);
          return "x";
        },
        decode: () => out[0],
      };
      codecLaws({ domains: { own: { ...domain, codec } } }, "own", samples === undefined ? {} : { samples });
      return out;
    };
    // The given samples come first, and a value outside the domain gets no test.
    const numbers = seen({ is: isNumber }, [7, "text"]);
    expect(numbers[0]).toBe(7);
    expect(numbers).not.toContain("text");
    for (const edge of [0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 53, Number.MAX_VALUE]) expect(numbers.some((item) => Object.is(item, edge))).toBe(true);
    expect(seen({ is: isText })).toEqual(expect.arrayContaining(["", "\u0000", "\ud800", "__proto__"]));
    expect(seen({ is: (value) => typeof value === "bigint" })).toEqual(expect.arrayContaining([-1n, 2n ** 70n]));
    expect(seen({ is: Array.isArray })).toEqual(expect.arrayContaining([[], [[]]]));
    expect(seen({ is: (value) => value instanceof Map })).toHaveLength(1);
    // The list samples of the domain counts. The list values of the domain replaces each other member.
    expect(seen({ is: (value) => value === "only", samples: ["only"] })).toEqual(["only"]);
    expect(seen({ is: isNumber, values: [1, 2] }, [3])).toEqual([1, 2]);
    // Without a member, the check proves nothing, thus the law samples gives a finding.
    const shapes: Domain = { is: shape.is, codec: shape.codec as DomainCodec };
    expect(codecLaws({ domains: { shapes } }, "shapes")).toEqual([{ obligation: "samples", reason: expect.stringContaining("no member of the domain shapes"), probe: { domain: "shapes", value: undefined } }]);
    expect(codecLaws({ domains: { shapes } }, "shapes", { samples: ["no"] }).map((finding) => finding.obligation)).toEqual(["samples"]);
  });
});
