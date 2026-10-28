import { describe, expect, it } from "vitest";
import {
  type Json,
  type Random,
  type SyntaxProfile,
  STD_SYNTAX,
  docEquals,
  context,
  formulaMachine,
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

/** The parts of a generator of documents for one profile. */
interface Generator {
  readonly profile: SyntaxProfile;
  readonly leaves: readonly Json[];
  readonly calls: readonly string[];
  /** The header names that the generator gives some documents. Without them, no document has a name. */
  readonly names?: readonly string[];
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
  if (choice <= 1) return pick(rng, gen.leaves);
  if (choice <= 3) {
    const op = pick(rng, gen.profile.operators ?? []);
    const count = op.fixity !== "infix" ? 1 : op.assoc === "flat" ? 2 + rng.int(2) : 2;
    return { type: kindType(op.kind), value: terms(count) };
  }
  const forms = gen.profile.calls?.forms ?? [];
  if (forms.length > 0 && rng.int(2) === 0) {
    const form = pick(rng, forms);
    const fields = form.fields;
    if (fields === undefined) return { type: kindType(form.kind), value: terms(rng.int(4)) };
    const min = form.min ?? fields.length;
    const value: Record<string, Json> = {};
    for (const key of fields.slice(0, min + rng.int(fields.length - min + 1))) value[key] = generateDoc(gen, rng, depth + 1);
    return { type: kindType(form.kind), value };
  }
  const name = pick(rng, gen.calls);
  return { type: ["ops", ...name.split(".")], value: terms(name === "floor" || name === "neg" ? 1 : 1 + rng.int(3)) };
}
