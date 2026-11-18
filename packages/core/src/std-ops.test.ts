import { describe, expect, it } from "vitest";
import {
  type FormulaProfile,
  type Json,
  type Result,
  STD_OPS,
  STD_SYNTAX,
  conforms,
  context,
  factsOf,
  formulaDefinitions,
  formulaMachine,
  parse,
  prepare,
  typeCheck,
} from "./index.ts";

const op = (name: string, ...args: Json[]): Json => ({ type: ["ops", name], value: args });
const name = (...path: string[]): Json => ({ type: "ref", value: ["names", ...path] });
const machine = formulaMachine(STD_OPS);

/** This function evaluates a document with the standard table and the names. */
function evalStd(doc: Json, names: Record<string, unknown> = {}, profile: FormulaProfile = STD_OPS): Result {
  return prepare(formulaMachine(profile), doc).evaluate(context({ names }));
}

/** This function evaluates a text of the standard syntax with the standard table. */
function evalText(text: string, names: Record<string, unknown> = {}): Result {
  const parsed = parse(STD_SYNTAX, text);
  if (!parsed.ok) throw new Error(`The text does not parse: ${JSON.stringify(parsed.issues)}`);
  return evalStd(parsed.doc, names);
}

const value = (result: Result): unknown => (result.ok ? result.value : `error ${result.error.code}`);
const code = (result: Result): string | undefined => (result.ok ? undefined : result.error.code);

describe("the standard table of operations", () => {
  it("[STDOPS.SYNTAX] the table has an operation for each operator of STD_SYNTAX", () => {
    const kinds = (STD_SYNTAX.operators ?? []).map((operator) => String(operator.kind)).filter((kind) => kind.startsWith("ops."));
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) expect(Object.keys(STD_OPS.ops), kind).toContain(kind.slice("ops.".length));
  });

  it("[STDOPS.SYNTAX] a text of the standard syntax evaluates with the table", () => {
    expect(value(evalText("2 + 3 * 4 ^ 2 - 1"))).toBe(49);
    expect(value(evalText("floor(7500 / 1000)"))).toBe(7);
    expect(value(evalText("not (1 < 2) or 3 >= 3"))).toBe(true);
    expect(value(evalText("1 == 1 and 1 != 2 and 2 <= 2 and 3 > 2"))).toBe(true);
    expect(value(evalText("-(2 - 5)"))).toBe(3);
    expect(value(evalText('concat("a", "b", "c")'))).toBe("abc");
    expect(value(evalText("floor(x / 1000)", { x: 61_999 }))).toBe(61);
  });

  it("[STDOPS.NUMBERS] the operations on numbers give the result of the host", () => {
    expect(value(evalStd(op("add", 0.1, 0.2)))).toBe(0.1 + 0.2);
    expect(value(evalStd(op("sub", 5, 7)))).toBe(-2);
    expect(value(evalStd(op("mul", 6, 7)))).toBe(42);
    expect(value(evalStd(op("div", 7, 2)))).toBe(3.5);
    expect(value(evalStd(op("pow", 2, 10)))).toBe(1024);
    expect(value(evalStd(op("neg", 4)))).toBe(-4);
    expect(value(evalStd(op("floor", -1.5)))).toBe(-2);
  });

  it("[STDOPS.MOD] mod gives the remainder of a truncated division, with the sign of the first argument", () => {
    expect(value(evalStd(op("mod", 7, 3)))).toBe(1);
    expect(value(evalStd(op("mod", -7, 3)))).toBe(-1);
    expect(value(evalStd(op("mod", 7, -3)))).toBe(1);
  });

  it("[STDOPS.NUM] a result NaN, or an infinite result of finite numbers, gives #NUM!", () => {
    expect(code(evalStd(op("div", 1, 0)))).toBe("#NUM!");
    expect(code(evalStd(op("mod", 1, 0)))).toBe("#NUM!");
    expect(code(evalStd(op("pow", 10, 400)))).toBe("#NUM!");
    expect(code(evalStd(op("pow", -8, 1 / 3)))).toBe("#NUM!");
    expect(code(evalText("Infinity - Infinity"))).toBe("#NUM!");
    expect(code(evalText("NaN + 1"))).toBe("#NUM!");
    // An infinite argument can give an infinite result.
    expect(value(evalText("Infinity + 1"))).toBe(Number.POSITIVE_INFINITY);
    expect(value(evalText("-Infinity"))).toBe(Number.NEGATIVE_INFINITY);
  });

  it("[STDOPS.VALUE] an argument of the wrong shape gives #VALUE!, and the host does not convert it", () => {
    expect(evalStd(op("add", "1", 2))).toMatchObject({ ok: false, error: { code: "#VALUE!", reason: "The operation add takes numbers, and it got a text and a number." } });
    expect(code(evalStd(op("floor", true)))).toBe("#VALUE!");
    expect(code(evalStd(op("not", 0)))).toBe("#VALUE!");
    expect(code(evalStd(op("concat", "a", 1)))).toBe("#VALUE!");
    expect(evalStd(op("lt", 1, "2"))).toMatchObject({ ok: false, error: { code: "#VALUE!", reason: "The operation lt takes two numbers or two texts, and it got a number and a text." } });
    expect(code(evalStd(op("ge", null, null)))).toBe("#VALUE!");
  });

  it("[STDOPS.ARGS] a different count of arguments gives #ARGS", () => {
    expect(evalStd(op("add", 1, 2, 3))).toMatchObject({ ok: false, error: { code: "#ARGS", reason: "The operation add takes 2 arguments, and it got 3." } });
    expect(code(evalStd(op("floor")))).toBe("#ARGS");
    expect(code(evalStd(op("eq", 1)))).toBe("#ARGS");
    expect(code(evalStd(op("not", true, false)))).toBe("#ARGS");
  });

  it("[STDOPS.EQUAL] eq and ne compare with docEquals", () => {
    const list = (...items: Json[]): Json => ({ type: "list", value: items });
    expect(value(evalStd(op("eq", list(1, "a"), list(1, "a"))))).toBe(true);
    expect(value(evalStd(op("eq", list(1), list(1, 2))))).toBe(false);
    expect(value(evalStd(op("eq", 1, "1")))).toBe(false);
    expect(value(evalText("0 == -0"))).toBe(false);
    expect(value(evalText("NaN == NaN"))).toBe(true);
    expect(value(evalText("1 != 1"))).toBe(false);
  });

  it("[STDOPS.ORDER] a comparison takes two numbers or two texts, and texts compare by code units", () => {
    expect(value(evalStd(op("lt", "B", "a")))).toBe(true);
    expect(value(evalStd(op("le", "ab", "ab")))).toBe(true);
    expect(value(evalStd(op("gt", "b", "ab")))).toBe(true);
    expect(value(evalStd(op("ge", 2, 3)))).toBe(false);
    expect(value(evalText("1 < NaN or 1 >= NaN"))).toBe(false);
  });

  it("[STDOPS.CONCAT] concat joins zero or more texts", () => {
    expect(value(evalStd(op("concat")))).toBe("");
    expect(value(evalStd(op("concat", "/v1/", name("id"), ".json"), { id: "AC1" }))).toBe("/v1/AC1.json");
  });

  it("[STDOPS.TEXT] text gives the text of a number, a text or a truth value", () => {
    expect(value(evalStd(op("text", 429)))).toBe("429");
    expect(value(evalStd(op("text", 0.1)))).toBe("0.1");
    expect(value(evalStd(op("text", 1e21)))).toBe("1e+21");
    expect(value(evalText("text(-0)"))).toBe("0");
    expect(value(evalStd(op("text", "a")))).toBe("a");
    expect(value(evalStd(op("text", false)))).toBe("false");
    expect(value(evalStd(op("concat", "HTTP ", op("text", name("status"))), { status: 503 }))).toBe("HTTP 503");
    expect(evalStd(op("text", null))).toMatchObject({ ok: false, error: { code: "#VALUE!", reason: "The operation text takes a number, a text or a truth value, and it got null." } });
    expect(code(evalStd(op("text")))).toBe("#ARGS");
  });

  it("[STDOPS.COALESCE] coalesce gives the first argument with a value, and #N/A counts as no value", () => {
    // A reference to an absent field gives #N/A. Thus coalesce reads the next argument.
    expect(value(evalStd(op("coalesce", name("credential", "keySid"), name("credential", "accountSid")), { credential: { accountSid: "AC1" } }))).toBe("AC1");
    expect(value(evalStd(op("coalesce", name("credential", "keySid"), name("credential", "accountSid")), { credential: { keySid: "SK1", accountSid: "AC1" } }))).toBe("SK1");
    expect(value(evalStd(op("coalesce", null, { type: ["ext", "undefined"], value: null }, 0)))).toBe(0);
    expect(value(evalStd(op("coalesce", false, 1)))).toBe(false);
    expect(evalStd(op("coalesce", name("input", "absent")), { input: {} })).toMatchObject({ ok: false, error: { code: "#N/A", reason: "No argument of the operation coalesce has a value." } });
    expect(code(evalStd(op("coalesce")))).toBe("#N/A");
  });

  it("[STDOPS.COALESCE] an unbound name is an error of the program, and coalesce does not hide it", () => {
    expect(code(evalStd(op("coalesce", name("absent"), 1)))).toBe("#NAME?");
  });

  it("[STDOPS.COALESCE] coalesce stops at an error that is not #N/A, and it does not evaluate the later arguments", () => {
    expect(code(evalStd(op("coalesce", op("add", "a", 1), 1)))).toBe("#VALUE!");
    expect(value(evalStd(op("coalesce", 1, op("add", "a", 1))))).toBe(1);
  });

  it("[STDOPS.COALESCE] a record that omits #N/A leaves out a field of coalesce with no value", () => {
    const profile: FormulaProfile = { ...STD_OPS, omit: (error) => error.code === "#N/A" };
    const doc: Json = { type: "record", value: { user: op("coalesce", name("input", "keySid"), name("input", "accountSid")), page: op("coalesce", name("input", "page")) } };
    expect(value(evalStd(doc, { input: { accountSid: "AC1" } }, profile))).toEqual({ user: "AC1" });
  });

  it("[STDOPS.TYPES] each operation conforms to its signature, and the check of types reads the signatures", () => {
    expect(conforms(machine, "formula.op", { definitions: formulaDefinitions(STD_OPS) })).toEqual([]);
    const lit = { declaredType: "lit" } as const;
    expect(typeCheck(machine, op("floor", op("div", 7500, 1000)), lit)).toMatchObject({ type: "number", issues: [] });
    expect(typeCheck(machine, op("lt", "a", "b"), lit)).toMatchObject({ type: "bool", issues: [] });
    expect(typeCheck(machine, op("concat", "a", "b"), lit)).toMatchObject({ type: "text", issues: [] });
    expect(typeCheck(machine, op("text", 1), lit)).toMatchObject({ type: "text", issues: [] });
    expect(typeCheck(machine, op("add", 1, "a"), lit).issues.length).toBeGreaterThan(0);
    expect(typeCheck(machine, op("lt", 1, "a"), lit).issues.length).toBeGreaterThan(0);
  });

  it("[STDOPS.PURE] each operation of the table is pure", () => {
    expect([...STD_OPS.pure].sort()).toEqual([...Object.keys(STD_OPS.ops), ...Object.keys(STD_OPS.lazy)].sort());
    expect(Object.keys(STD_OPS.sigs).sort()).toEqual([...STD_OPS.pure].sort());
    expect(factsOf(machine, op("floor", op("div", name("ms"), 1000))).pure).toBe(true);
    expect(factsOf(machine, op("coalesce", name("a"), 1)).pure).toBe(true);
  });

  it("[STDOPS.SPREAD] a language spreads the tables into its own profile, and the tables do not change", () => {
    const profile: FormulaProfile = {
      ops: { ...STD_OPS.ops, twice: (a: number) => a * 2 },
      lazy: STD_OPS.lazy,
      sigs: { ...STD_OPS.sigs, twice: { params: ["number"], to: "number" } },
      pure: [...STD_OPS.pure, "twice"],
    };
    expect(value(evalStd(op("twice", op("add", 1, 2)), {}, profile))).toBe(6);
    expect(Object.isFrozen(STD_OPS)).toBe(true);
    expect(Object.isFrozen(STD_OPS.ops)).toBe(true);
    expect(Object.isFrozen(STD_OPS.lazy)).toBe(true);
    expect(Object.isFrozen(STD_OPS.sigs)).toBe(true);
    expect(Object.isFrozen(STD_OPS.pure)).toBe(true);
    expect(Object.keys(STD_OPS.ops)).not.toContain("twice");
  });
});
