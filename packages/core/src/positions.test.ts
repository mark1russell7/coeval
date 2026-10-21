import { describe, expect, it } from "vitest";
import { type HostThing, type Key, type Machine, type Walker, THING, check, context, fail, formulaMachine, ok, prepare, refsOf, resolve } from "./index.ts";

// A formula language over the positions of a space: a list of rows. The root self is a position. A move goes to
// another row, and a computed move reads its row number from a term.
const rows: readonly Readonly<Record<string, unknown>>[] = [
  { v: 10, next: 1 },
  { v: 20, next: 0 },
];

class Row implements HostThing {
  readonly [THING] = true as const;
  readonly label: string;

  constructor(readonly index: number) {
    this.label = `row ${index}`;
  }

  deref(key: Key): unknown {
    const row = rows[this.index] ?? {};
    return Object.hasOwn(row, String(key)) ? row[String(key)] : undefined;
  }

  toJson(): unknown {
    return rows[this.index];
  }
}

const at: Walker = ({ data, here }) => {
  if (!(here instanceof Row)) return { ok: false, reason: "A move starts at a row." };
  if (typeof data !== "number") return { ok: false, reason: "The row of a move is a number.", code: "#VALUE!" };
  return data >= 0 && data < rows.length ? { ok: true, thing: new Row(data) } : { ok: false, reason: `The space has no row ${data}.`, code: "#REF!" };
};

const machine: Machine = formulaMachine(
  { ops: { add: (a: number, b: number) => a + b } },
  {
    world: {
      kinds: {
        ref: { verbs: { eval: "formula.ref" }, parts: { shape: "deep" } },
        moves: {
          kinds: {
            at: { verbs: { eval: "formula.step", step: "at" }, parts: { shape: "term", of: "lit" } },
            first: { verbs: { eval: "formula.step", step: "first" } },
            plain: { verbs: { step: "first" } },
          },
        },
        label: { verbs: { eval: "test.label" }, parts: { shape: "record", fields: { of: { shape: "term", address: true } } } },
      },
      defaults: {},
    },
    evaluators: {
      "test.label": ({ parts }) => {
        const where = parts[0]?.evaluate() ?? fail("#VALUE!", "The label needs a part.");
        return where.ok && where.value instanceof Row ? ok(where.value.label) : where;
      },
    },
    walkers: { at, first: () => ({ ok: true, thing: new Row(0) }) },
    plain: true,
  },
);

const ref = (...path: unknown[]): unknown => ({ type: "ref", value: path });
const move = (row: unknown): unknown => ({ type: ["moves", "at"], value: row });
const run = (doc: unknown, row = 0, names: Record<string, unknown> = {}): unknown => prepare(machine, doc).evaluate(context({ self: new Row(row), names }));

describe("a formula language over the positions of a space", () => {
  it("[FORMULA.STEPS] a step document of a path is a part: it evaluates first, and the walker gets its value", () => {
    expect(run(ref("self", move(1), "v"))).toEqual(ok(20));
    // The row of the move is a reference to a field of the row: a computed move.
    expect(run(ref("self", move(ref("self", "next")), "v"))).toEqual(ok(20));
    expect(run(ref("self", move(ref("self", "next")), "v"), 1)).toEqual(ok(10));
    expect(run(ref("self", { type: ["moves", "first"], value: null }, "v"), 1)).toEqual(ok(10));
    // The steps evaluate in order before the path resolves, and the first error is the result.
    const failed = run(ref("self", move(ref("names", "a")), move(ref("names", "b")), "v"));
    expect(failed).toMatchObject({ ok: false, error: { code: "#NAME?", reason: "The context has no name a." } });
    expect(run(ref("self", move(ref("names", "n")), "v"), 0, { n: 1 })).toEqual(ok(20));
  });

  it("[DEREF.WALK-CODE] a walker can give the code of its failure, and the default code is #N/A", () => {
    expect(run(ref("self", move(5), "v"))).toMatchObject({ ok: false, error: { code: "#REF!", reason: "The space has no row 5." } });
    expect(run(ref("self", move("x"), "v"))).toMatchObject({ ok: false, error: { code: "#VALUE!" } });
    const plain = resolve(machine, context({ self: { not: "a row" } }), ["self", { type: ["moves", "at"], value: 0 }]);
    expect(plain).toMatchObject({ ok: false, code: "#N/A", reason: "A move starts at a row." });
  });

  it("[FORMULA.ADDRESS] a reference in an address position gives what its path reaches, not its value", () => {
    expect(run({ type: "label", value: { of: ref("self", move(1)) } })).toEqual(ok("row 1"));
    expect(run({ type: "label", value: { of: ref("self") } }, 1)).toEqual(ok("row 1"));
    // Outside an address, the same reference gives the value of the row.
    expect(run(ref("self", move(1)))).toEqual(ok({ v: 20, next: 0 }));
    expect(run({ type: "label", value: { of: ref("self", move(9)) } })).toMatchObject({ ok: false, error: { code: "#REF!" } });
  });

  it("[FORMULA.EXT-CONTEXT] an extension gets the context of its document", () => {
    const withExt = formulaMachine({ ext: { me: (data, ctx) => ok([data, ctx.names["me"]]) } });
    expect(prepare(withExt, { type: ["ext", "me"], value: "x" }).evaluate(context({ names: { me: 1 } }))).toEqual(ok(["x", 1]));
  });

  it("[STATIC.STEPS] the static kit visits the step documents of a path, and it marks an address", () => {
    const doc = { type: "label", value: { of: ref("self", move(ref("self", "next")), move(ref("names", "k"))) } };
    const refs = refsOf(machine.world, doc);
    expect(refs.map((use) => [use.path[0], use.address])).toEqual([
      ["self", true],
      ["self", false],
      ["names", false],
    ]);
    expect(refs[1]?.place).toEqual(["of", 1]);
    expect(refs[1]?.at).toEqual(["value", "of", "value", 1, "value"]);
    expect(check(machine, doc, { names: ["k"] })).toEqual([]);
    expect(check(machine, doc)).toEqual([{ code: "#NAME?", place: ["of", 2], reason: "Nothing binds the name k.", at: ["value", "of", "value", 2, "value", "value", 1] }]);
    // A step document is a part, so its kind needs an evaluator.
    const plain = ref("self", { type: ["moves", "plain"], value: null });
    expect(check(machine, plain).map((issue) => [issue.code, issue.place])).toEqual([["#NOEVAL", [1]]]);
  });
});
