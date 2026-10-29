import { describe, expect, it } from "vitest";
import {
  type Json,
  type Random,
  type SyntaxProfile,
  STD_CAPS,
  STD_MACHINE,
  STD_SYNTAX,
  STD_WORLD,
  WORLD_SYNTAX,
  type WorldEntry,
  docEquals,
  context,
  evaluate,
  formulaMachine,
  isAlias,
  isKind,
  isNamespace,
  makeContext,
  mergeMachines,
  ok,
  parse,
  prepare,
  print,
  random,
  syntaxFormat,
} from "./index.ts";

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });
const op = (name: string, ...args: Json[]): Json => ({ type: ["ops", ...name.split(".")], value: args });
const x = ref("names", "x");
const y = ref("names", "y");
const z = ref("names", "z");

function doc(profile: SyntaxProfile, text: string): Json {
  const result = parse(profile, text);
  if (!result.ok) throw new Error(`${text}: ${JSON.stringify(result.issues)}`);
  return result.doc;
}

function text(profile: SyntaxProfile, value: unknown): string {
  const result = print(profile, value);
  if (!result.ok) throw new Error(`${JSON.stringify(value)}: ${result.error.reason}`);
  return result.value;
}

function issue(profile: SyntaxProfile, source: string): unknown {
  const result = parse(profile, source);
  return result.ok ? result.doc : result.issues[0];
}

/** A spreadsheet-like profile: A1 references, `&`, `^`, `<>`, a postfix `%` and `IF`. */
const SHEET: SyntaxProfile = {
  operators: [
    { symbol: "=", fixity: "infix", prec: 1, kind: "ops.eq" },
    { symbol: "<>", fixity: "infix", prec: 1, kind: "ops.ne" },
    { symbol: "<", fixity: "infix", prec: 1, kind: "ops.lt" },
    { symbol: "<=", fixity: "infix", prec: 1, kind: "ops.le" },
    { symbol: ">", fixity: "infix", prec: 1, kind: "ops.gt" },
    { symbol: ">=", fixity: "infix", prec: 1, kind: "ops.ge" },
    { symbol: "&", fixity: "infix", prec: 2, kind: "ops.concat" },
    { symbol: "+", fixity: "infix", prec: 3, kind: "ops.add" },
    { symbol: "-", fixity: "infix", prec: 3, kind: "ops.sub" },
    { symbol: "*", fixity: "infix", prec: 4, kind: "ops.mul" },
    { symbol: "/", fixity: "infix", prec: 4, kind: "ops.div" },
    { symbol: "^", fixity: "infix", prec: 5, kind: "ops.pow" },
    { symbol: "%", fixity: "postfix", prec: 6, kind: "ops.percent" },
    { symbol: "-", fixity: "prefix", prec: 7, kind: "ops.neg" },
    { symbol: ":", fixity: "infix", prec: 8, kind: "ops.range" },
  ],
  literals: { strings: { escape: "double" }, words: { TRUE: true, FALSE: false } },
  refs: {
    roots: [],
    fields: false,
    patterns: [
      {
        pattern: /\$?[A-Z]{1,3}\$?[0-9]+/,
        read: (cell) => ["world", cell],
        write: (path) => (path.length === 2 && path[0] === "world" && typeof path[1] === "string" && /^\$?[A-Z]{1,3}\$?[0-9]+$/.test(path[1]) ? path[1] : undefined),
      },
    ],
  },
  calls: { forms: [{ name: "IF", kind: "if", fields: ["test", "then", "else"], min: 2 }] },
};

/** An algebra-like profile: numbers, named knobs in `world`, four operators and only `min`, `max` and `floor`. */
const ALGEBRA: SyntaxProfile = {
  operators: [
    { symbol: "+", fixity: "infix", prec: 1, kind: "ops.add" },
    { symbol: "-", fixity: "infix", prec: 1, kind: "ops.sub" },
    { symbol: "*", fixity: "infix", prec: 2, kind: "ops.mul" },
    { symbol: "/", fixity: "infix", prec: 2, kind: "ops.div" },
    { symbol: "-", fixity: "prefix", prec: 3, kind: "ops.neg" },
  ],
  literals: { strings: false, words: {} },
  refs: { bare: "world", roots: [], fields: false },
  calls: { ops: ["min", "max", "floor"] },
};

/** The standard profile with two call forms under a path (K161): `math.product` with a list and `geo.point` with fields. */
const PATHS: SyntaxProfile = {
  ...STD_SYNTAX,
  calls: {
    forms: [
      ...(STD_SYNTAX.calls?.forms ?? []),
      { name: "math.product", kind: "math.product" },
      { name: "geo.point", kind: "geo.point", fields: ["x", "y"], min: 1 },
    ],
  },
};

/**
 * The standard profile with the forms of D63: the data envelopes `text`, `number` and `bool` with one literal, the
 * record kind `panel` with its fields, the construct `record` with each key, and the step `nearest`.
 */
const RECORDS: SyntaxProfile = {
  ...STD_SYNTAX,
  calls: {
    forms: [
      ...(STD_SYNTAX.calls?.forms ?? []),
      { name: "text", kind: "text", args: "literal" },
      { name: "number", kind: "number", args: "literal" },
      { name: "bool", kind: "bool", args: "literal" },
      { name: "panel", kind: "panel", args: "named", fields: ["width", "height", "children"] },
      { name: "record", kind: "record", args: "named" },
      { name: "nearest", kind: "nearest", args: "named", fields: ["type", "follow", "self"] },
    ],
  },
};

const NUMBERS: Readonly<Record<string, Json>> = {
  nan: { type: ["ext", "number"], value: "NaN" },
  inf: { type: ["ext", "number"], value: "Infinity" },
  ninf: { type: ["ext", "number"], value: "-Infinity" },
  nzero: { type: ["ext", "number"], value: "-0" },
};

describe("the syntax kit", () => {
  it("[SYNTAX.PARSE] parse reads a text of the standard profile into the documents of the formula kit", () => {
    expect(doc(STD_SYNTAX, "1 + 2 * 3")).toEqual(op("add", 1, op("mul", 2, 3)));
    expect(doc(STD_SYNTAX, "x - y - z")).toEqual(op("sub", op("sub", x, y), z));
    expect(doc(STD_SYNTAX, "x ^ y ^ z")).toEqual(op("pow", x, op("pow", y, z)));
    expect(doc(STD_SYNTAX, "x and y and z or not x")).toEqual({ type: "or", value: [{ type: "and", value: [x, y, z] }, op("not", x)] });
    expect(doc(STD_SYNTAX, "-x ^ 2")).toEqual(op("neg", op("pow", x, 2)));
    expect(doc(STD_SYNTAX, "x - -1")).toEqual(op("sub", x, -1));
    expect(doc(STD_SYNTAX, "(x + y) * z")).toEqual(op("mul", op("add", x, y), z));
    expect(doc(STD_SYNTAX, "self.price.0 + world.rate + `self` + `a b`")).toEqual(
      op("add", op("add", op("add", ref("self", "price", 0), ref("world", "rate")), ref("names", "self")), ref("names", "a b")),
    );
    expect(doc(STD_SYNTAX, 'if(x > 1, "big\\n", list(true, null))')).toEqual({ type: "if", value: { test: op("gt", x, 1), then: "big\n", else: { type: "list", value: [true, null] } } });
    expect(doc(STD_SYNTAX, "math.max(x, 2.5e3)")).toEqual(op("math.max", x, 2500));
    // A literal that is not JSON uses the standard extensions (D40).
    expect(doc(STD_SYNTAX, "list(NaN, -0, 1e999, undefined)")).toEqual({ type: "list", value: [NUMBERS["nan"] as Json, NUMBERS["nzero"] as Json, NUMBERS["inf"] as Json, { type: ["ext", "undefined"], value: null }] });
    const machine = formulaMachine({ ops: { add: (a: number, b: number) => a + b, mul: (a: number, b: number) => a * b, gt: (a: number, b: number) => a > b } });
    const value = (source: string, names: Record<string, unknown> = {}): unknown => prepare(machine, doc(STD_SYNTAX, source), { declaredType: "lit" }).evaluate(context({ names }));
    expect(value("1 + 2 * 3")).toEqual(ok(7));
    expect(value('if(x > 1, "big", "small")', { x: 3 })).toEqual(ok("big"));
  });

  it("[SYNTAX.SPAN] a bad text gives an issue with its offset, its length and a message, and parse does not throw", () => {
    expect(issue(STD_SYNTAX, "1 +")).toEqual({ offset: 3, length: 0, message: "A term is missing at the end of the text." });
    expect(issue(STD_SYNTAX, "")).toMatchObject({ offset: 0, length: 0 });
    expect(issue(STD_SYNTAX, "1 + #")).toEqual({ offset: 4, length: 1, message: 'The text "#" cannot start a term.' });
    expect(issue(STD_SYNTAX, "(1 + 2")).toMatchObject({ offset: 0, length: 1, message: "A closing parenthesis is missing." });
    expect(issue(STD_SYNTAX, 'x + "abc')).toMatchObject({ offset: 4, length: 4, message: "A closing quote is missing." });
    expect(issue(STD_SYNTAX, "x < y < z")).toMatchObject({ offset: 6, length: 1 });
    expect(issue(STD_SYNTAX, "x y")).toMatchObject({ offset: 2, length: 1, message: "The text continues after the expression." });
    expect(issue(STD_SYNTAX, "f(1,)")).toMatchObject({ offset: 4, length: 0, message: "A term is missing." });
    expect(issue(STD_SYNTAX, "if(x)")).toMatchObject({ offset: 0, length: 5, message: "The form if takes 2 to 3 arguments." });
    expect(issue(STD_SYNTAX, "x and and")).toMatchObject({ offset: 6, length: 3 });
    expect(issue(STD_SYNTAX, '"\\q"')).toMatchObject({ offset: 1, length: 2 });
    expect(issue(ALGEBRA, "gap + round(pad)")).toEqual({ offset: 6, length: 5, message: "This syntax has no function round." });
    expect(issue(ALGEBRA, '"a"')).toMatchObject({ offset: 0, length: 1 });
    expect(issue({ ...STD_SYNTAX, maxDepth: 3 }, "((((1))))")).toMatchObject({ message: "The text is deeper than 3 levels." });
  });

  it("[SYNTAX.PRINT] print writes the fewest parentheses that keep the tree, and the verb format uses it by default", () => {
    expect(text(STD_SYNTAX, op("mul", op("add", x, 1), op("add", y, 2)))).toBe("(x + 1) * (y + 2)");
    expect(text(STD_SYNTAX, op("sub", x, op("sub", y, z)))).toBe("x - (y - z)");
    expect(text(STD_SYNTAX, op("pow", op("pow", x, y), z))).toBe("(x ^ y) ^ z");
    expect(text(STD_SYNTAX, { type: "and", value: [{ type: "and", value: [x, y] }, z] })).toBe("(x and y) and z");
    expect(text(STD_SYNTAX, op("neg", 1))).toBe("-(1)");
    expect(text(STD_SYNTAX, op("neg", -1))).toBe("- -1");
    expect(text(STD_SYNTAX, op("add", 1, 2, 3))).toBe("add(1, 2, 3)");
    expect(text(STD_SYNTAX, ref("names", "true", "a b"))).toBe("`true`.`a b`");
    expect(text(STD_SYNTAX, { type: "if", value: { test: true, then: "a\"b" } })).toBe('if(true, "a\\"b")');
    // A document without a text form gives #VALUE! at its place.
    expect(print(STD_SYNTAX, op("add", 1, { type: "let", value: { bind: {}, body: 1 } }))).toMatchObject({ ok: false, error: { code: "#VALUE!", place: [1] } });
    expect(print(STD_SYNTAX, [1, 2])).toMatchObject({ ok: false, error: { code: "#VALUE!" } });
    expect(print(ALGEBRA, true)).toMatchObject({ ok: false, error: { code: "#VALUE!" } });
    // The verb format (D23): a merge adds it, and a part with its own entry gives its own text.
    const machine = mergeMachines(formulaMachine({}), syntaxFormat(STD_SYNTAX), { evaluators: { "mine.format": () => ok("MINE") } });
    const format = (value: unknown): unknown => prepare(machine, value, { declaredType: "lit", verb: "format" }).evaluate();
    const program = op("mul", op("add", x, 1), { type: "if", value: { test: op("not", y), then: NUMBERS["nan"] as Json, else: "z" } });
    expect(format(program)).toEqual(print(STD_SYNTAX, program));
    expect(format(program)).toEqual(ok('(x + 1) * if(not y, NaN, "z")'));
    expect(format(op("add", 1, { type: ["ops", "mul"], value: [2, 3], own: { format: "mine.format" } }))).toEqual(ok("1 + MINE"));
    expect(prepare(machine, op("mul", op("add", 1, 2), 3), { declaredType: "lit" }).evaluate()).toMatchObject({ ok: false, error: { code: "#NAME?" } });
  });

  it("[SYNTAX.PROFILE] a profile describes other languages: a spreadsheet-like syntax and an algebra-like syntax", () => {
    expect(doc(SHEET, 'SUM(A1:B2) & "x""y" <> $C$3^2%')).toEqual(
      op("ne", op("concat", op("SUM", op("range", ref("world", "A1"), ref("world", "B2"))), 'x"y'), op("pow", ref("world", "$C$3"), op("percent", 2))),
    );
    expect(doc(SHEET, "IF(rate > 1, TRUE, -A1)")).toEqual({ type: "if", value: { test: op("gt", ref("names", "rate"), 1), then: true, else: op("neg", ref("world", "A1")) } });
    expect(text(SHEET, op("add", ref("names", "A1"), ref("world", "B7")))).toBe("`A1` + B7");
    expect(text(SHEET, op("percent", op("neg", 2)))).toBe("-(2)%");
    expect(doc(ALGEBRA, "max(gap, floor(width / 3)) - -pad")).toEqual(
      op("sub", op("max", ref("world", "gap"), op("floor", op("div", ref("world", "width"), 3))), op("neg", ref("world", "pad"))),
    );
    expect(text(ALGEBRA, op("mul", op("add", ref("world", "a"), 1), op("min", 2, ref("world", "min"))))).toBe("(a + 1) * min(2, min)");
    expect(print(ALGEBRA, ref("world", "a", "b"))).toMatchObject({ ok: false });
    // A profile that two readings can confuse throws when a function first uses it.
    expect(() => parse({ operators: [{ symbol: "!", fixity: "infix", prec: 1, kind: "a" }, { symbol: "!", fixity: "postfix", prec: 2, kind: "b" }] }, "1")).toThrow(TypeError);
    expect(() => parse({ operators: [{ symbol: "+", fixity: "infix", prec: 1, kind: "a" }, { symbol: "-", fixity: "infix", prec: 1, assoc: "right", kind: "b" }] }, "1")).toThrow(TypeError);
    expect(() => parse({ operators: [{ symbol: "a+", fixity: "infix", prec: 1, kind: "a" }] }, "1")).toThrow(TypeError);
  });

  it("[SYNTAX.HEADER] a profile with a bind symbol writes and reads the header name of a document", () => {
    const named = (value: Json, name: string): Json => ({ ...(value as Record<string, Json>), name });
    expect(doc(STD_SYNTAX, "total = 2 + 3")).toEqual(named(op("add", 2, 3), "total"));
    expect(doc(STD_SYNTAX, "list(a = x, b = 1, `a b` = -0)")).toEqual({
      type: "list",
      value: [named(x, "a"), { type: "lit", value: 1, name: "b" }, named(NUMBERS["nzero"] as Json, "a b")],
    });
    expect(doc(STD_SYNTAX, "(a = x) * 2")).toEqual(op("mul", named(x, "a"), 2));
    // A longer operator wins over the bind symbol, thus the texts of before read as before.
    expect(doc(STD_SYNTAX, "x == 1")).toEqual(op("eq", x, 1));
    expect(doc(SHEET, "rate = 1")).toEqual(op("eq", ref("names", "rate"), 1));
    // The printer writes the name before the document, with parentheses in the term of an operator.
    expect(text(STD_SYNTAX, named(op("add", 2, 3), "total"))).toBe("total = 2 + 3");
    expect(text(STD_SYNTAX, op("mul", named(op("add", x, 1), "a"), 2))).toBe("(a = x + 1) * 2");
    expect(text(STD_SYNTAX, op("neg", named(x, "if")))).toBe("-(if = x)");
    expect(text(STD_SYNTAX, { type: "list", value: [{ type: "lit", value: "s", name: "a b" }] })).toBe('list(`a b` = "s")');
    for (const source of ["total = 2 + 3", "(a = x + 1) * 2", "-(if = x)", 'list(`a b` = "s", not = not y)', "if(c = x > 1, a = 1)"]) {
      expect(text(STD_SYNTAX, doc(STD_SYNTAX, source))).toBe(source);
    }
    // A document has one name.
    expect(issue(STD_SYNTAX, "a = (b = 1)")).toEqual({ offset: 4, length: 7, message: "The document already has the name b." });
    expect(issue(STD_SYNTAX, "a = b = 1")).toMatchObject({ offset: 6, message: "The text continues after the expression." });
    // Without a bind symbol, a name has no text. The own entries have no text in each profile.
    expect(print(SHEET, named(op("add", 1, 2), "a"))).toMatchObject({ ok: false, error: { code: "#VALUE!", reason: "This syntax has no text for the name of a document." } });
    expect(print(STD_SYNTAX, op("add", 1, { type: "lit", value: 2, own: { format: "mine" } }))).toMatchObject({
      ok: false,
      error: { code: "#VALUE!", reason: "This syntax has no text for the own entries of a document.", place: [1] },
    });
    expect(issue({ ...STD_SYNTAX, header: {} }, "a = 1")).toMatchObject({ offset: 2, message: "The text continues after the expression." });
    // A bind symbol that an operator can read throws.
    expect(() => parse({ ...SHEET, header: { bind: "=" } }, "1")).toThrow(TypeError);
    expect(() => parse({ ...SHEET, header: { bind: ":=" } }, "1")).toThrow(TypeError);
    expect(() => parse({ ...SHEET, header: { bind: "<-" } }, "1")).toThrow(TypeError);
    expect(() => parse({ ...STD_SYNTAX, header: { bind: "as" } }, "1")).toThrow(TypeError);
    expect(doc({ ...SHEET, header: { bind: "~" } }, "rate ~ A1 <= 2")).toEqual(named(op("le", ref("world", "A1"), 2), "rate"));
    // The verb format writes the name, and a step with a name evaluates.
    const machine = mergeMachines(formulaMachine({ ops: { add: (a: number, b: number) => a + b } }), syntaxFormat(STD_SYNTAX));
    expect(prepare(machine, named(op("add", 1, x), "y"), { declaredType: "lit", verb: "format" }).evaluate()).toEqual(ok("y = 1 + x"));
    expect(prepare(machine, doc(STD_SYNTAX, "y = 1 + 2"), { declaredType: "lit" }).evaluate()).toEqual(ok(3));
  });

  it("[SYNTAX.FORM-PATH] a call form under a path reads and writes its full name, and a reference with dots stays a reference", () => {
    expect(doc(PATHS, "math.product(6, 7)")).toEqual({ type: ["math", "product"], value: [6, 7] });
    expect(doc(PATHS, "geo . point(1, x)")).toEqual({ type: ["geo", "point"], value: { x: 1, y: x } });
    expect(doc(PATHS, "math.max(1)")).toEqual(op("math.max", 1));
    expect(doc(PATHS, "math.product + geo")).toEqual(op("add", ref("names", "math", "product"), ref("names", "geo")));
    expect(text(PATHS, { type: ["math", "product"], value: [6, op("add", 1, 2)] })).toBe("math.product(6, 1 + 2)");
    expect(text(PATHS, { type: ["geo", "point"], value: { x: 1 } })).toBe("geo.point(1)");
    // The form hides the operation of the same name, thus that operation has no text.
    expect(print(PATHS, op("math.product", 1))).toMatchObject({ ok: false, error: { code: "#VALUE!" } });
    expect(issue(PATHS, "math.`p q`(1)")).toEqual({ offset: 0, length: 10, message: "Each key of the name of a call is a plain name." });
    expect(issue(PATHS, "geo.point(1, 2, 3)")).toMatchObject({ offset: 0, message: "The form geo.point takes 1 to 2 arguments." });
    // A name that the parser cannot read as a path throws.
    const withForm = (profile: SyntaxProfile, name: string): SyntaxProfile => ({ ...profile, calls: { forms: [{ name, kind: "k" }] } });
    for (const name of ["math.0", "a..b", "a.", "not.x", "a b"]) expect(() => parse(withForm(STD_SYNTAX, name), "1"), name).toThrow(TypeError);
    expect(() => parse(withForm(ALGEBRA, "math.product"), "1")).toThrow(TypeError);
  });

  it("[SYNTAX.DATA] a form with the arguments literal writes and reads a data envelope with one literal", () => {
    expect(doc(RECORDS, 'if(x > 10, text("big"), list(number(-2.5), bool(false), text("")))')).toEqual({
      type: "if",
      value: { test: op("gt", x, 10), then: { type: "text", value: "big" }, else: { type: "list", value: [{ type: "number", value: -2.5 }, { type: "bool", value: false }, { type: "text", value: "" }] } },
    });
    expect(doc(RECORDS, "number((7))")).toEqual({ type: "number", value: 7 });
    expect(doc(RECORDS, "text(null)")).toEqual({ type: "text", value: null });
    expect(text(RECORDS, { type: "text", value: 'a"b' })).toBe('text("a\\"b")');
    expect(text(RECORDS, { type: "number", value: 1e21 })).toBe("number(1e+21)");
    expect(text(RECORDS, op("add", { type: "number", value: -3 }, 1))).toBe("number(-3) + 1");
    // The bare literal keeps its text, thus each text of before reads as before.
    expect(doc(RECORDS, '"big"')).toBe("big");
    // The argument is one literal that JSON writes: not a document, not two literals, not NaN or -0.
    for (const source of ["text(x)", "text()", 'text("a", "b")', "number(NaN)", "number(-0)", "text(a = 1)", "number(1 + 2)"]) {
      expect(issue(RECORDS, source), source).toMatchObject({ offset: 0, length: source.length, message: `The form ${source.slice(0, source.indexOf("("))} takes one literal that JSON writes.` });
    }
    // A value that is not such a literal has no text, and a profile without texts has no text for a text.
    for (const value of [{ a: 1 }, [1], Number.NaN, -0, op("add", 1, 2), undefined]) {
      expect(print(RECORDS, { type: "number", value }), String(value)).toMatchObject({ ok: false, error: { code: "#VALUE!", reason: "This syntax has no text for the kind number." } });
    }
    const noStrings: SyntaxProfile = { ...ALGEBRA, calls: { forms: [{ name: "text", kind: "text", args: "literal" }] } };
    expect(print(noStrings, { type: "text", value: "a" })).toMatchObject({ ok: false });
    expect(text(noStrings, { type: "text", value: 4 })).toBe("text(4)");
    // A literal form takes no fields and no min.
    expect(() => parse({ calls: { forms: [{ name: "t", kind: "t", args: "literal", fields: ["a"] }] } }, "1")).toThrow(TypeError);
    expect(() => parse({ calls: { forms: [{ name: "t", kind: "t", args: "literal", min: 1 }] } }, "1")).toThrow(TypeError);
    expect(() => parse({ calls: { forms: [{ name: "t", kind: "t", args: "fields" }] } }, "1")).toThrow(TypeError);
    expect(() => parse({ calls: { forms: [{ name: "t", kind: "t", args: "list", fields: ["a"] }] } }, "1")).toThrow(TypeError);
    expect(() => parse({ calls: { forms: [{ name: "t", kind: "t", args: "other" as "list" }] } }, "1")).toThrow(TypeError);
  });

  it("[SYNTAX.RECORD] a form with the arguments named writes and reads a record of parts with a key for each argument", () => {
    const tree: Json = {
      type: "panel",
      value: { width: 300, children: { type: "list", value: [{ type: "panel", value: { children: { type: "list", value: [] }, width: op("add", ref("self", "parent", "width"), -20) } }] } },
    };
    const source = "panel(width: 300, children: list(panel(children: list(), width: self.parent.width + -20)))";
    expect(doc(RECORDS, source)).toEqual(tree);
    expect(text(RECORDS, tree)).toBe(source);
    // The construct record permits each key. A key in backticks, a reserved word and __proto__ are keys.
    const fields: Record<string, Json> = { if: 1, "a b": x, "": { type: "text", value: "t" }, not: op("not", y) };
    Object.defineProperty(fields, "__proto__", { value: 2, enumerable: true, writable: true, configurable: true });
    const record: Json = { type: "record", value: fields };
    const written = 'record(if: 1, `a b`: x, ``: text("t"), not: not y, __proto__: 2)';
    expect(text(RECORDS, record)).toBe(written);
    const back = doc(RECORDS, written);
    expect(docEquals(back, record)).toBe(true);
    expect(Object.hasOwn((back as { value: object }).value, "__proto__")).toBe(true);
    expect(doc(RECORDS, "record()")).toEqual({ type: "record", value: {} });
    expect(doc(RECORDS, "record(a: b = 1, c : x + 1)")).toEqual({ type: "record", value: { a: { type: "lit", value: 1, name: "b" }, c: op("add", x, 1) } });
    // A key is a name and a ":". A form with fields permits only those keys, each one time.
    expect(issue(RECORDS, "panel(300)")).toEqual({ offset: 6, length: 3, message: 'Each argument of the form panel is a key, a ":" and a document.' });
    expect(issue(RECORDS, "panel(width 300)")).toEqual({ offset: 6, length: 5, message: 'Each argument of the form panel is a key, a ":" and a document.' });
    expect(issue(RECORDS, "panel(depth: 1)")).toEqual({ offset: 6, length: 5, message: "The form panel has no field depth." });
    expect(issue(RECORDS, "panel(width: 1, width: 2)")).toEqual({ offset: 16, length: 5, message: "The form panel has the field width two times." });
    expect(issue(RECORDS, "panel(width: 1")).toMatchObject({ offset: 5, length: 1, message: "A closing parenthesis is missing." });
    // A value that is not a record, or a record with another key, has no text.
    expect(print(RECORDS, { type: "panel", value: [1] })).toMatchObject({ ok: false, error: { reason: "This syntax has no text for the kind panel." } });
    expect(print(RECORDS, { type: "panel", value: { depth: 1 } })).toMatchObject({ ok: false, error: { reason: "This syntax has no text for the kind panel." } });
    expect(print(RECORDS, { type: "panel" })).toMatchObject({ ok: false });
    expect(print(RECORDS, { type: "panel", value: { width: [1] } })).toMatchObject({ ok: false, error: { place: ["width"] } });
    // A named form takes no min. A profile with the operator ":" reads a named form, because each argument has a key.
    expect(() => parse({ calls: { forms: [{ name: "p", kind: "p", args: "named", min: 1 }] } }, "1")).toThrow(TypeError);
    const sheet: SyntaxProfile = { ...SHEET, calls: { forms: [{ name: "BOX", kind: "box", args: "named" }] } };
    expect(doc(sheet, "BOX(area: A1:B2)")).toEqual({ type: "box", value: { area: op("range", ref("world", "A1"), ref("world", "B2")) } });
    expect(doc(sheet, "SUM(a:b)")).toEqual(op("SUM", op("range", ref("names", "a"), ref("names", "b"))));
    // The verb format writes a named form, and each field gives its text through the ladder.
    const machine = mergeMachines(formulaMachine({}), syntaxFormat(RECORDS));
    expect(prepare(machine, { type: "record", value: { a: op("add", 1, x) } }, { declaredType: "lit", verb: "format" }).evaluate()).toEqual(ok("record(a: 1 + x)"));
  });

  it("[SYNTAX.STEP] a step of a path in parentheses is a document, and print writes a step document in parentheses", () => {
    const nearest: Json = { type: "nearest", value: { type: "panel" } };
    expect(doc(RECORDS, 'self.parent.(nearest(type: "panel")).width')).toEqual(ref("self", "parent", nearest, "width"));
    expect(text(RECORDS, ref("self", "parent", nearest, "width"))).toBe('self.parent.(nearest(type: "panel")).width');
    expect(doc(STD_SYNTAX, "x . (y + 1) . 0")).toEqual(ref("names", "x", op("add", y, 1), 0));
    expect(text(STD_SYNTAX, ref("names", "x", op("add", y, 1), 0))).toBe("x.(y + 1).0");
    expect(text(STD_SYNTAX, ref("world", { type: "lit", value: 1, name: "a" }))).toBe("world.(a = 1)");
    expect(doc(STD_SYNTAX, "world.(a = 1)")).toEqual(ref("world", { type: "lit", value: 1, name: "a" }));
    // A literal in parentheses is the plain step, thus print writes the plain step.
    expect(doc(STD_SYNTAX, 'x.(1).("a b")')).toEqual(ref("names", "x", 1, "a b"));
    // A path with a step document is not the name of a call, and the first key after a bare root is a name.
    expect(issue(STD_SYNTAX, "x.(y)(1)")).toEqual({ offset: 0, length: 5, message: "Each key of the name of a call is a plain name." });
    expect(print(STD_SYNTAX, ref("names", op("add", 1, 2)))).toMatchObject({ ok: false, error: { reason: "This syntax has no text for the path of the reference." } });
    expect(print(STD_SYNTAX, ref("self", { type: "let", value: {} }))).toMatchObject({ ok: false, error: { place: [1] } });
    expect(issue(STD_SYNTAX, "x.(y")).toMatchObject({ message: "A closing parenthesis is missing." });
  });

  it("[SYNTAX.WORLD] WORLD_SYNTAX gives a text for each kind of STD_WORLD, or the kind has a pinned reason", () => {
    const kinds = worldKinds(STD_WORLD.kinds, []);
    const written = new Set([...(WORLD_SYNTAX.operators ?? []).map((operator) => operator.kind), ...(WORLD_SYNTAX.calls?.forms ?? []).map((form) => form.kind)]);
    // Each operator and each form of the profile names a kind of the world.
    expect([...written].filter((kind) => !kinds.includes(kind))).toEqual([]);
    // Each kind has a text by an operator, a form or the reference syntax, or a reason in the pinned lists.
    expect(kinds.filter((kind) => !written.has(kind) && !Object.hasOwn(OTHER_TEXT, kind) && !Object.hasOwn(NO_TEXT, kind))).toEqual([]);
    for (const kind of [...Object.keys(OTHER_TEXT), ...Object.keys(NO_TEXT)]) {
      expect(kinds, kind).toContain(kind);
      expect(written.has(kind), kind).toBe(false);
    }
    expect(Object.keys(NO_TEXT)).toEqual([]);
    // The text of each kind reads to a document of that kind, and print writes the same text.
    expect(Object.keys(WORLD_TEXTS).sort()).toEqual([...kinds].sort());
    for (const [kind, source] of Object.entries(WORLD_TEXTS)) {
      const read = doc(WORLD_SYNTAX, source);
      const type = (read as { type?: unknown }).type;
      expect(Array.isArray(type) ? type.join(".") : type, source).toBe(kind);
      expect(text(WORLD_SYNTAX, read), kind).toBe(source);
    }
    expect(Object.isFrozen(WORLD_SYNTAX)).toBe(true);
  });

  it("[SYNTAX.WORLD] STD_MACHINE evaluates a text of WORLD_SYNTAX, and a host profile extends it with its forms", () => {
    const run = (source: string, names: Readonly<Record<string, Json>> = {}): unknown => evaluate(STD_MACHINE, doc(WORLD_SYNTAX, source), makeContext(names, STD_CAPS)).result;
    expect(run("seq(a = 1 + 2, b = a * 10, b)")).toEqual(ok(30));
    expect(run('if(size > 10, text("big"), log("small"))', { size: 12 })).toEqual(ok("big"));
    expect(run("math.sum(2, 3) * math.product(6, 7)")).toEqual(ok(210));
    // The profile of the formula kit is another language: it reads + as ops.add.
    expect(doc(STD_SYNTAX, "1 + 2")).toEqual(op("add", 1, 2));
    expect(doc(WORLD_SYNTAX, "1 + 2")).toEqual({ type: "add", value: [1, 2] });
    // The profile has no call of an operation, thus a name that no form has gives an issue.
    expect(issue(WORLD_SYNTAX, "max(1, 2)")).toMatchObject({ offset: 0 });
    // A host with one more kind spreads the profile and adds its form.
    const host: SyntaxProfile = {
      ...WORLD_SYNTAX,
      calls: { ...WORLD_SYNTAX.calls, forms: [...(WORLD_SYNTAX.calls?.forms ?? []), { name: "card", kind: "card", args: "named", fields: ["title"] }] },
    };
    expect(doc(host, 'card(title: text("a"))')).toEqual({ type: "card", value: { title: { type: "text", value: "a" } } });
    expect(doc(host, "2 + 3")).toEqual({ type: "add", value: [2, 3] });
    expect(parse(WORLD_SYNTAX, 'card(title: text("a"))').ok).toBe(false);
    expect(issue(host, "max(1, 2)")).toMatchObject({ offset: 0 });
  });

  it("[SYNTAX.ROUNDTRIP] parse(print(doc)) gives each generated document of a profile again", () => {
    const bad: string[] = [];
    for (const [name, gen] of Object.entries(GENERATORS)) {
      for (let seed = 1; seed <= 300; seed += 1) {
        const original = generateDoc(gen, random(seed), 0);
        const printed = print(gen.profile, original);
        if (!printed.ok) {
          bad.push(`${name} ${String(seed)}: ${printed.error.reason} ${JSON.stringify(original)}`);
          continue;
        }
        const back = parse(gen.profile, printed.value);
        if (!back.ok || !docEquals(back.doc, original)) bad.push(`${name} ${String(seed)}: ${printed.value} ${JSON.stringify(original)}`);
      }
    }
    expect(bad.slice(0, 3)).toEqual([]);
  });
});

/**
 * The kinds of `STD_WORLD` that have a text by another rule of the profile than an operator or a form, with the rule.
 */
const OTHER_TEXT: Readonly<Record<string, string>> = {
  ref: "The reference syntax of the kit writes a path, for example self.parent.width.",
};

/** The kinds of `STD_WORLD` without a text in `WORLD_SYNTAX`, each with its reason. The list is empty. */
const NO_TEXT: Readonly<Record<string, string>> = {};

/** One text for each kind of `STD_WORLD`, in the profile `WORLD_SYNTAX`. */
const WORLD_TEXTS: Readonly<Record<string, string>> = {
  number: "number(42)",
  text: 'text("big")',
  bool: "bool(true)",
  add: "1 + 2 + 3",
  multiply: "6 * 7",
  greater: "size > 10",
  list: "list(1, x)",
  if: 'if(size > 10, text("big"), log("small"))',
  ref: "self.parent.width",
  nearest: 'nearest(type: "panel")',
  panel: "panel(width: 300, children: list(box(width: self.parent.width + -20)))",
  box: "box(height: 20)",
  "math.sum": "math.sum(1, 2)",
  "math.product": "math.product(6, 7)",
  seq: "seq(a = 1 + 2, b = a * 10, log(b))",
  pure: 'pure(log("hello"))',
  log: 'log("start")',
  write: 'write("total", 2 + 3)',
};

/** This function lists the kinds and the aliases of a world, with dots between the keys of a namespace. */
function worldKinds(entries: Readonly<Record<string, WorldEntry>>, path: readonly string[]): string[] {
  const out: string[] = [];
  for (const [key, entry] of Object.entries(entries)) {
    const name = [...path, key];
    if (isKind(entry) || isAlias(entry)) out.push(name.join("."));
    else if (isNamespace(entry)) out.push(...worldKinds(entry.kinds, name));
  }
  return out;
}

/** The parts of a generator of documents for one profile. */
interface Generator {
  readonly profile: SyntaxProfile;
  readonly leaves: readonly Json[];
  readonly calls: readonly string[];
  /** The header names that the generator gives some documents. Without them, no document has a name. */
  readonly names?: readonly string[];
  /** The literals of the forms with the arguments `literal` (D63). */
  readonly data?: readonly Json[];
  /** The keys of a form `named` without fields (D63). */
  readonly keys?: readonly string[];
  /** `true` gives some references a step document (SYNTAX.STEP). */
  readonly steps?: boolean;
}

const GENERATORS: Readonly<Record<string, Generator>> = {
  standard: {
    profile: STD_SYNTAX,
    leaves: [0, 2.5, 7, -3, 1e21, 5e-7, true, false, null, "", "a\"b'`\n ", ...Object.values(NUMBERS), { type: ["ext", "undefined"], value: null }, x, ref("names", "self"), ref("names", "if"), ref("names", "a b"), ref("names", "true"), ref("self", "price"), ref("names", "items", 0), ref("world", "A1"), ref("self")],
    calls: ["f", "math.max", "add", "sub", "neg"],
  },
  sheet: {
    profile: SHEET,
    leaves: [1, 0.5, -2, 'a"b', "", true, false, ref("world", "A1"), ref("world", "$B$12"), ref("names", "rate"), ref("names", "A1")],
    calls: ["SUM", "AVERAGE", "concat"],
  },
  paths: {
    profile: PATHS,
    leaves: [0, -3, 1e21, true, null, "a\"b", NUMBERS["nan"] as Json, NUMBERS["nzero"] as Json, x, ref("names", "math", "product"), ref("self", "price")],
    calls: ["f", "math.max", "geo"],
    names: ["a", "total", "if", "not", "a b", "", "`"],
  },
  algebra: {
    profile: ALGEBRA,
    leaves: [0, 4, 1.5, -2, NUMBERS["nzero"] as Json, ref("world", "gap"), ref("world", "pad_x"), ref("world", "min")],
    calls: ["min", "max", "floor"],
  },
  records: {
    profile: RECORDS,
    leaves: [0, -3, 1e21, true, null, "a\"b", NUMBERS["nzero"] as Json, x, ref("self", "parent", "width"), ref("names", "panel")],
    calls: ["f", "math.max"],
    names: ["a", "if", "a b", ""],
    data: ["", "big", 'a"b`', 0, -3, 2.5, 1e21, true, false, null],
    keys: ["a", "if", "not", "self", "type", "a b", "", "`", "0", "__proto__"],
    steps: true,
  },
  world: {
    profile: WORLD_SYNTAX,
    leaves: [0, -3, 2.5, 1e21, true, false, null, "", 'a"b', x, ref("self", "parent", "width"), ref("names", "math", "sum"), ref("world", "add")],
    calls: [],
    names: ["a", "total", "if", "a b"],
    data: ["", "big", 'a"b', 0, -3, 2.5, true, false, null],
    steps: true,
  },
};

function kindType(kind: string): Json {
  const keys = kind.split(".");
  return keys.length === 1 ? (keys[0] as string) : keys;
}

function pick<T>(rng: Random, items: readonly T[]): T {
  return items[rng.int(items.length)] as T;
}

/** This function builds a random document that the profile writes. Some documents get a header name. */
function generateDoc(gen: Generator, rng: Random, depth: number): Json {
  const made = generateBare(gen, rng, depth);
  if (gen.names === undefined || rng.int(4) !== 0) return made;
  const name = pick(rng, gen.names);
  return typeof made === "object" && made !== null && !Array.isArray(made) ? { ...made, name } : { type: "lit", value: made, name };
}

/** This function builds a random document without a name: operators, call forms, calls and leaves. */
function generateBare(gen: Generator, rng: Random, depth: number): Json {
  const choice = depth > 3 ? 0 : rng.int(5);
  const terms = (count: number): Json[] => Array.from({ length: count }, () => generateDoc(gen, rng, depth + 1));
  if (choice <= 1) return gen.steps === true && rng.int(3) === 0 ? stepRef(gen, rng, depth) : pick(rng, gen.leaves);
  if (choice <= 3) {
    const op = pick(rng, gen.profile.operators ?? []);
    const count = op.fixity !== "infix" ? 1 : op.assoc === "flat" ? 2 + rng.int(2) : 2;
    return { type: kindType(op.kind), value: terms(count) };
  }
  const forms = gen.profile.calls?.forms ?? [];
  if (forms.length > 0 && (gen.calls.length === 0 || rng.int(2) === 0)) {
    const form = pick(rng, forms);
    if (form.args === "literal") return { type: kindType(form.kind), value: pick(rng, gen.data ?? [0]) };
    if (form.args === "named") return { type: kindType(form.kind), value: namedValue(gen, rng, depth, form.fields ?? gen.keys ?? []) };
    const fields = form.fields;
    const least = form.min ?? 0;
    if (fields === undefined) return { type: kindType(form.kind), value: terms(least + rng.int(4 - least)) };
    const min = form.min ?? fields.length;
    const value: Record<string, Json> = {};
    for (const key of fields.slice(0, min + rng.int(fields.length - min + 1))) value[key] = generateDoc(gen, rng, depth + 1);
    return { type: kindType(form.kind), value };
  }
  const name = pick(rng, gen.calls);
  return { type: ["ops", ...name.split(".")], value: terms(name === "floor" || name === "neg" ? 1 : 1 + rng.int(3)) };
}

/** This function builds the record of a form `named`: some of the keys, in a random order, each with a document. */
function namedValue(gen: Generator, rng: Random, depth: number, keys: readonly string[]): Json {
  const value: Record<string, Json> = {};
  const left = [...keys];
  for (let count = rng.int(left.length + 1); count > 0; count -= 1) {
    const [key] = left.splice(rng.int(left.length), 1) as [string];
    Object.defineProperty(value, key, { value: generateDoc(gen, rng, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return value;
}

/** This function builds a reference from `self` with a step document, for example the step `nearest` of a tree. */
function stepRef(gen: Generator, rng: Random, depth: number): Json {
  const made = generateDoc(gen, rng, depth + 1);
  const step = typeof made === "object" && made !== null && !Array.isArray(made) ? made : { type: "nearest", value: { type: "panel" } };
  return ref("self", "parent", step, ...(rng.int(2) === 0 ? ["width"] : []));
}
