import { describe, expect, it } from "vitest";
import { type Json, type Random, type SyntaxFindingCode, type SyntaxForm, type SyntaxOperator, type SyntaxProfile, STD_SYNTAX, checkSyntax, docEquals, parse, print, random } from "./index.ts";

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });
const a = ref("names", "a");
const call = (kind: string, ...terms: Json[]): Json => ({ type: kind.split("."), value: terms });
const infix = (symbol: string, prec: number, kind: string, assoc?: SyntaxOperator["assoc"]): SyntaxOperator => ({ symbol, fixity: "infix", prec, kind, ...(assoc === undefined ? {} : { assoc }) });
const prefix = (symbol: string, prec: number, kind: string): SyntaxOperator => ({ symbol, fixity: "prefix", prec, kind });
const postfix = (symbol: string, prec: number, kind: string): SyntaxOperator => ({ symbol, fixity: "postfix", prec, kind });
const pattern = (shape: RegExp): NonNullable<NonNullable<SyntaxProfile["refs"]>["patterns"]>[number] => ({
  pattern: shape,
  read: (cell) => ["world", cell],
  write: (path) => (path.length === 2 && path[0] === "world" && typeof path[1] === "string" ? path[1] : undefined),
});

/**
 * This function plants a fault. It shows the real failure of `parse(print(doc))` without `checkSyntax`, then it asks
 * for the finding. `text` is the printed text, and `undefined` stands for a document that `print` refuses.
 */
function planted(profile: SyntaxProfile, made: Json, text: string | undefined, code: SyntaxFindingCode, place: readonly (string | number)[]): void {
  const printed = print(profile, made);
  if (text === undefined) expect(printed.ok).toBe(false);
  else {
    expect(printed).toEqual({ ok: true, value: text });
    const back = parse(profile, text);
    expect(back.ok && docEquals(back.doc, made)).toBe(false);
  }
  expect(checkSyntax(profile).filter((finding) => finding.code === code).map((finding) => finding.place)).toContainEqual(place);
}

/** This function shows that the parser settles a candidate: no finding, and each document comes back. */
function settled(profile: SyntaxProfile, ...docs: readonly Json[]): void {
  expect(checkSyntax(profile)).toEqual([]);
  for (const made of docs) {
    const printed = print(profile, made);
    if (!printed.ok) throw new Error(printed.error.reason);
    const back = parse(profile, printed.value);
    expect(back.ok && docEquals(back.doc, made), printed.value).toBe(true);
  }
}

describe("the check of a syntax profile", () => {
  it("[SYNTAX.PROFILE-CHECK] gives the name, the place and the reason of each fault, and one finding for each name and place", () => {
    const profile: SyntaxProfile = { operators: [infix("+", 1, "k.add"), infix("*", 1.5, "k.mul"), infix("/", 1.5, "k.div")] };
    const findings = checkSyntax(profile);
    expect(findings.map((finding) => [finding.code, finding.place])).toEqual([["grouping", ["operators", 0]]]);
    expect(findings[0]?.reason).toContain("reads as");
    expect(checkSyntax({ operators: [{ symbol: "+", fixity: "infix", prec: 1, kind: "" }] })).toEqual([{ code: "invalid", place: [], reason: expect.any(String) }]);
    expect(checkSyntax({ ...STD_SYNTAX, maxDepth: 1 })).toEqual([]);
    expect(checkSyntax({ calls: { ops: false, separator: " " } })).toEqual([]);
    const broken = {
      calls: {
        get forms(): readonly SyntaxForm[] {
          throw new RangeError("own error");
        },
      },
    };
    expect(() => checkSyntax(broken)).toThrow(RangeError);
  });

  it("[SYNTAX.PROFILE-CHECK-SETTLED] gives no finding for a clash that the parser settles", () => {
    const minus: SyntaxProfile = { operators: [prefix("-", 3, "k.neg"), infix("-", 1, "k.sub")] };
    settled(minus, call("k.sub", a, call("k.neg", a)));
    settled({ operators: [prefix("!", 3, "k.not"), postfix("!", 4, "k.done")] }, call("k.not", call("k.done", a)), call("k.done", call("k.not", a)));
    const longest: SyntaxProfile = { operators: [infix("<", 1, "k.lt"), infix("<=", 1, "k.le"), infix("<-", 1, "k.in"), prefix("-", 3, "k.neg")] };
    settled(longest, call("k.lt", a, call("k.neg", a)), call("k.le", a, a));
    const words: SyntaxProfile = { ...STD_SYNTAX, operators: [...(STD_SYNTAX.operators ?? []), infix("in", 20, "k.in")] };
    settled(words, { type: "let", value: { bind: { x: a }, body: call("k.in", a, a) } });
    const sheet: SyntaxProfile = { refs: { roots: [], fields: false, patterns: [pattern(/[A-Z]+[0-9]+/)] }, calls: { forms: [{ name: "LOG10", kind: "log" }] } };
    settled(sheet, { type: "log", value: [ref("world", "A1")] });
    const colon: SyntaxProfile = { ...STD_SYNTAX, operators: [infix(":", 1, "k.range")] };
    settled(colon, { type: "record", value: { x: call("k.range", a, a) } });
    const bind: SyntaxProfile = { ...STD_SYNTAX, operators: [infix("==", 1, "k.eq")], header: { bind: "=" } };
    settled(bind, { type: "let", value: { bind: { x: call("k.eq", a, a) }, body: a } });
    settled({ operators: [infix("+", 1, "k.add"), infix("plus", 1, "k.add")] }, call("k.add", a, a));
    settled({ operators: [prefix(";", 3, "k.semi")], calls: { separator: ";;" } }, call("ops.g", call("k.semi", a), a));
    settled({ calls: { separator: ":" } }, call("ops.g", a, a));
    settled({ calls: { separator: ", " } }, call("ops.g", a, a));
    settled({ ...STD_SYNTAX, literals: { words: { let: 1 } } }, 1, { type: "let", value: { bind: { x: a }, body: a } });
  });

  it("[SYNTAX.PROFILE-CHECK-OPERATOR] finds an operator with its own document lost", () => {
    planted({ operators: [infix("+", -1, "k.add")] }, call("k.add", a, a), "a + a", "operator", ["operators", 0]);
    planted({ operators: [prefix("~", 1, "ref")] }, { type: "ref", value: [a] }, undefined, "operator", ["operators", 0]);
    const flat: SyntaxProfile = { operators: [infix("+", 1, "k.add"), infix("%", -1, "k.add", "flat")] };
    planted(flat, call("k.add", a, a, a), "a % a % a", "operator", ["operators", 1]);
  });

  it("[SYNTAX.PROFILE-CHECK-GROUPING] finds two precedences that give two parses", () => {
    const fraction: SyntaxProfile = { operators: [infix("+", 1, "k.add"), infix("*", 1.5, "k.mul")] };
    planted(fraction, call("k.add", a, call("k.mul", a, a)), "a + a * a", "grouping", ["operators", 0]);
    expect(parse(fraction, "a + a * a")).toEqual({ ok: true, doc: call("k.mul", call("k.add", a, a), a) });
    planted({ operators: [prefix("-", 1, "k.neg"), infix("*", 1.5, "k.mul")] }, call("k.neg", call("k.mul", a, a)), "-a * a", "grouping", ["operators", 0]);
    const right: SyntaxProfile = { operators: [infix("^", 8, "k.pow", "right"), postfix("!", 8, "k.done")] };
    planted(right, call("k.done", call("k.pow", a, a)), "a ^ a!", "grouping", ["operators", 1]);
    expect(parse(right, "a ^ a!")).toEqual({ ok: true, doc: call("k.pow", a, call("k.done", a)) });
    planted({ operators: [infix("+", 2 ** 53, "k.add")] }, call("k.add", call("k.add", a, a), a), "a + a + a", "grouping", ["operators", 0]);
  });

  it("[SYNTAX.PROFILE-CHECK-LONGEST] finds two postfix operators that a longer symbol reads", () => {
    const doubled: SyntaxProfile = { operators: [postfix("!", 4, "k.one"), postfix("!!", 4, "k.two")] };
    planted(doubled, call("k.one", call("k.one", a)), "a!!", "longest-match", ["operators", 0]);
    expect(parse(doubled, "a!!")).toEqual({ ok: true, doc: call("k.two", a) });
    const clash: SyntaxProfile = { operators: [postfix("!", 4, "k.one"), postfix("=", 4, "k.eq"), infix("!=", 1, "k.ne")] };
    planted(clash, call("k.eq", call("k.one", a)), "a!=", "longest-match", ["operators", 1]);
  });

  it("[SYNTAX.PROFILE-CHECK-WORD] finds a literal word that does not read as its value", () => {
    planted({ operators: [prefix("not", 3, "k.not")], literals: { words: { not: true } } }, true, "not", "word", ["literals", "words", "not"]);
    planted({ literals: { words: { "yes!": true } } }, true, "yes!", "word", ["literals", "words", "yes!"]);
  });

  it("[SYNTAX.PROFILE-CHECK-ROOT] finds a root that does not come back", () => {
    planted({ operators: [prefix("not", 3, "k.not")], refs: { roots: ["not"] } }, ref("not", "x"), "not.x", "root", ["refs", "roots", 0]);
    const literal: SyntaxProfile = { refs: { roots: ["true"] }, literals: { words: { true: true } } };
    planted(literal, ref("true"), "true", "root", ["refs", "roots", 0]);
    expect(parse(literal, "true")).toEqual({ ok: true, doc: true });
    planted({ refs: { roots: ["a b"] } }, ref("a b"), "a b", "root", ["refs", "roots", 0]);
    planted({ operators: [prefix("event", 3, "k.event")] }, ref("event"), "event", "root", ["refs", "roots", 2]);
    planted({ refs: { roots: ["not"], fields: false }, operators: [prefix("not", 3, "k.not")] }, ref("not"), "not", "root", ["refs", "roots", 0]);
  });

  it("[SYNTAX.PROFILE-CHECK-PATTERN] finds a pattern that reads a text with another meaning", () => {
    const place = ["refs", "patterns", 0];
    planted({ operators: [prefix("not", 3, "k.not")], refs: { patterns: [pattern(/[a-z]+/)] } }, call("k.not", ref("world", "b")), "not b", "pattern", place);
    planted({ literals: { words: { TRUE: true } }, refs: { patterns: [pattern(/[A-Z]+/)] } }, true, "TRUE", "pattern", place);
    planted({ refs: { patterns: [pattern(/[0-9]+/)] } }, 1, "1", "pattern", place);
    planted({ refs: { patterns: [pattern(/[A-Z][0-9]/)] }, calls: { forms: [{ name: "A1.x", kind: "cell" }] } }, { type: "cell", value: [a] }, "A1.x(a)", "pattern", place);
    planted({ refs: { roots: ["abc"], patterns: [pattern(/[a-z]+/)] } }, ref("abc"), undefined, "pattern", place);
    planted({ refs: { patterns: [pattern(/[a-z]+/)] } }, call("ops.m.p", a), "m.p(`a`)", "pattern", place);
  });

  it("[SYNTAX.PROFILE-CHECK-FORM] finds a call form that does not come back", () => {
    planted({ operators: [prefix("not", 3, "k.not")], calls: { forms: [{ name: "not", kind: "k" }] } }, { type: "k", value: [a] }, "not(a)", "form", ["calls", "forms", 0]);
    planted({ operators: [infix("and", 1, "k.and")], calls: { forms: [{ name: "and", kind: "k" }] } }, { type: "k", value: [a] }, "and(a)", "form", ["calls", "forms", 0]);
    const twice: SyntaxProfile = { calls: { forms: [{ name: "f", kind: "one" }, { name: "f", kind: "two" }] } };
    planted(twice, { type: "one", value: [a] }, "f(a)", "form", ["calls", "forms", 0]);
    expect(parse(twice, "f(a)")).toEqual({ ok: true, doc: { type: "two", value: [a] } });
    planted({ calls: { forms: [{ name: "f", kind: "k", fields: ["p"], min: 2 }] } }, { type: "k", value: { p: a } }, undefined, "form", ["calls", "forms", 0]);
  });

  it("[SYNTAX.PROFILE-CHECK-CALL] finds a name of the calls that does not come back", () => {
    planted({ calls: { ops: ["if"], forms: [{ name: "if", kind: "k" }] } }, call("ops.if", a), undefined, "call", ["calls", "ops", 0]);
    planted({ operators: [infix("and", 1, "k.and")], calls: { ops: ["and"] } }, call("ops.and", a), undefined, "call", ["calls", "ops", 0]);
    planted({ refs: { fields: false }, calls: { ops: ["m.p"] } }, call("ops.m.p", a), undefined, "call", ["calls", "ops", 0]);
  });

  it("[SYNTAX.PROFILE-CHECK-SEPARATOR] finds a separator that does not end an argument", () => {
    const place = ["calls", "separator"];
    const two = call("ops.g", a, a);
    planted({ operators: [infix(";", 1, "k.semi")], calls: { separator: ";;" } }, two, "g(a;; a)", "separator", place);
    planted({ operators: [postfix("!", 4, "k.done"), infix("!,", 1, "k.bang")], calls: { separator: ",," } }, call("ops.g", call("k.done", a), a), "g(a!,, a)", "separator", place);
    for (const separator of ["and", " ", ".", ")", "(", "0"]) {
      planted({ calls: { separator } }, two, `g(a${separator} a)`, "separator", place);
    }
    planted({ calls: { separator: "`" } }, call("ops.g", ref("names", "b c"), a), "g(`b c`` a)", "separator", place);
    planted({ calls: { separator: '"' }, literals: { strings: { escape: "double" } } }, call("ops.g", "s", a), 'g("s"" a)', "separator", place);
    const record = { constructs: { record: "record" }, calls: { separator: "}", ops: false } } satisfies SyntaxProfile;
    planted(record, { type: "record", value: { x: a, y: a } }, "{x: a} y: a}", "separator", place);
  });

  it("[SYNTAX.PROFILE-CHECK-CONSTRUCT] finds a construct form that does not come back", () => {
    const twice: SyntaxProfile = { constructs: { record: "k", let: "k" } };
    planted(twice, { type: "k", value: { x: a } }, undefined, "construct", ["constructs", "record"]);
    planted({ constructs: { fn: "ref" } }, { type: "ref", value: { params: ["x"], body: a } }, undefined, "construct", ["constructs", "fn"]);
  });

  it("[SYNTAX.PROFILE-CHECK-LAW] keeps the law over generated profiles with no finding", () => {
    const misses: string[] = [];
    let clean = 0;
    for (let seed = 1; seed <= 1500; seed += 1) {
      const rng = random(seed);
      const profile = profileOf(rng);
      if (checkSyntax(profile).length > 0) continue;
      clean += 1;
      for (let index = 0; index < 40; index += 1) {
        const made = docOf(rng, profile, 0);
        const printed = print(profile, made);
        if (!printed.ok) continue;
        const back = parse(profile, printed.value);
        if (!back.ok || !docEquals(back.doc, made)) misses.push(`${seed}: ${printed.value}`);
      }
    }
    expect(misses).toEqual([]);
    expect(clean).toBeGreaterThan(100);
  });
});

const pick = <T>(rng: Random, items: readonly T[]): T => items[rng.int(items.length)] as T;
const SYMBOLS = ["+", "-", "*", "/", "!", "!!", "=", "==", "!=", "<", "<=", "<-", "%", "%%", "&", "&&", "^", ":", ";", ";;", "|", "||", "?", "~", "or", "and", "not", "in", "let", "self", "true", "if", "f", "=>", "{", "}", ",,"];
const FIXITIES = ["prefix", "infix", "postfix", "infix", "infix"] as const;
const ASSOCS = ["left", "right", "none", "flat", undefined] as const;
const PRECS = [0, 1, 2, 3, 4, 5, 1.5, 2.5, -1];
const SEPARATORS = [",", ";", ";;", "|", ",,", ":", " ", "", "and", ".", "=,", "!,", ", ", "$", '"', "`", "'", "}", "{", ")", "(", "=>", "0"];
const FORM_NAMES = ["if", "g", "h", "not", "true", "A1", "A1.x", "m.p", "let"];
const LIST_OF_WORDS = [{ true: true, false: false, null: null }, { yes: true, no: false }, { not: true }, { in: 1 }, {}];

/** This function gives a form of a random shape, as a host can write it. */
function formOf(rng: Random): SyntaxForm {
  const name = pick(rng, FORM_NAMES);
  const kind = pick(rng, ["fa", "fb", "x.y", "record"]);
  const shape = rng.int(4);
  if (shape === 0) return { name, kind };
  if (shape === 1) return { name, kind, fields: ["p", "q"], min: 1 + rng.int(2) };
  return shape === 2 ? { name, kind, args: "named", fields: ["p", "q"] } : { name, kind, args: "literal" };
}

/** This function gives a random profile. Most of them have a fault, and the others test the law. */
function profileOf(rng: Random): SyntaxProfile {
  const operators = Array.from({ length: 1 + rng.int(6) }, (): SyntaxOperator => {
    const assoc = pick(rng, ASSOCS);
    return { symbol: pick(rng, SYMBOLS), fixity: pick(rng, FIXITIES), prec: pick(rng, PRECS), ...(assoc === undefined ? {} : { assoc }), kind: `k.${pick(rng, ["a", "b", "c", "d", "e", "f"])}` };
  });
  return {
    operators,
    ...(rng.int(2) === 0 ? {} : { constructs: { record: "record", let: "let", fn: "fn", call: "call" } }),
    ...(rng.int(2) === 0 ? {} : { header: { bind: pick(rng, ["=", ":=", "::", "->"]) } }),
    literals: { words: pick(rng, LIST_OF_WORDS), ...(rng.int(4) === 0 ? { signed: false } : {}), ...(rng.int(6) === 0 ? { strings: { quote: "'", escape: "double" } as const } : {}) },
    refs: {
      ...(rng.int(3) === 0 ? { roots: pick(rng, [[], ["self"], ["self", "true"], ["not"], ["a b"]]) } : {}),
      ...(rng.int(4) === 0 ? { fields: false } : {}),
      ...(rng.int(4) === 0 ? { patterns: [pattern(pick(rng, [/[A-Z][0-9]+/, /[a-z]+/, /[0-9]+/, /[A-Z]+/]))] } : {}),
    },
    calls: {
      forms: Array.from({ length: rng.int(3) }, () => formOf(rng)),
      ...(rng.int(3) === 0 ? { ops: pick(rng, [[], ["g"], ["if"], ["m.p"], ["and"]]) } : {}),
      ...(rng.int(3) === 0 ? { separator: pick(rng, SEPARATORS) } : {}),
    },
  };
}

/** This function gives a random leaf of a document. */
function leafOf(rng: Random, profile: SyntaxProfile): Json {
  const roots = profile.refs?.roots ?? ["self", "world", "event", "caps"];
  const fields = profile.refs?.fields !== false;
  const words = Object.values((profile.literals?.words ?? {}) as Record<string, Json>);
  const options: Json[] = [a, ref("names", "b c"), ref("names", "not"), ref("names", "self"), 0, 7, -3, 2.5, "s", 'a"b', "", ...words];
  if (roots.length > 0) options.push(ref(pick(rng, roots)));
  if (roots.length > 0 && fields) options.push(ref(pick(rng, roots), "x"));
  if (fields) options.push(ref("names", "a", "b"));
  return pick(rng, options);
}

/** This function gives the value of a random call form. */
function formValueOf(rng: Random, form: SyntaxForm, part: () => Json): Json {
  const args = form.args ?? (form.fields === undefined ? "list" : "fields");
  if (args === "literal") return pick(rng, [1, "a", true]);
  if (args === "list") return Array.from({ length: rng.int(3) }, part);
  return args === "named" || rng.int(2) === 0 ? { p: part(), q: part() } : { p: part() };
}

/** This function gives a random document of a profile. `print` refuses some of them. */
function docOf(rng: Random, profile: SyntaxProfile, depth: number): Json {
  const part = (): Json => docOf(rng, profile, depth + 1);
  const choice = depth > 3 ? 0 : rng.int(8);
  const ops = profile.operators ?? [];
  const forms = profile.calls?.forms ?? [];
  if (choice <= 1) return leafOf(rng, profile);
  if (choice <= 4 && ops.length > 0) {
    const op = pick(rng, ops);
    const terms = op.fixity === "infix" ? (op.assoc === "flat" && rng.int(2) === 0 ? [part(), part(), part()] : [part(), part()]) : [part()];
    return { type: op.kind.split("."), value: terms };
  }
  if (choice === 5 && forms.length > 0) {
    const form = pick(rng, forms);
    return { type: form.kind.includes(".") ? form.kind.split(".") : form.kind, value: formValueOf(rng, form, part) };
  }
  if (choice === 6) return call(`ops.${pick(rng, profile.refs?.fields === false ? ["g"] : ["g", "m.p"])}`, ...Array.from({ length: rng.int(3) }, part));
  if (profile.constructs === undefined) return leafOf(rng, profile);
  const shape = rng.int(4);
  if (shape === 0) return { type: "record", value: { x: part(), "y z": part() } };
  if (shape === 1) return { type: "let", value: { bind: { x: part() }, body: part() } };
  if (shape === 2) return { type: "fn", value: { params: ["x", "y"], body: part() } };
  return { type: "call", value: { fn: part(), args: [part(), part()] } };
}
