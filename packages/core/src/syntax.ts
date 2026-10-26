import { type Json, type Key, isEnvelope, isRecord, typePath } from "./doc.ts";
import { type Result, describe, fail, isStackOverflow, ok } from "./errors.ts";
import type { EvalFn, Part } from "./evaluate.ts";
import type { MachinePart } from "./merge.ts";
import { encodeValue } from "./codec.ts";

/** The place of an operator: before its term, between two terms, or after its term. */
export type SyntaxFixity = "prefix" | "infix" | "postfix";

/**
 * The grouping of a chain of one infix operator. `left` reads `a - b - c` as `(a - b) - c`, and `right` reads
 * `a ^ b ^ c` as `a ^ (b ^ c)`. `none` refuses a chain. `flat` reads a chain as one document with each term.
 */
export type SyntaxAssoc = "left" | "right" | "none" | "flat";

/** One operator of a syntax profile. */
export interface SyntaxOperator {
  /** The text of the operator, for example `+`, `<>` or `and`. A word operator is a plain name. */
  readonly symbol: string;
  /** The place of the operator. */
  readonly fixity: SyntaxFixity;
  /** The precedence. A larger number binds more tightly. */
  readonly prec: number;
  /** The grouping of a chain of an infix operator. The default is `left`. */
  readonly assoc?: SyntaxAssoc;
  /** The type of the document that the operator makes, with dots between the keys, for example `ops.add` or `and`. */
  readonly kind: string;
}

/** The literal rules of a syntax profile. */
export interface SyntaxLiterals {
  /** `false` removes the decimal numbers. The default is `true`. */
  readonly numbers?: boolean;
  /** `true` puts a minus sign right before a digit into the number, where a term starts. The default is `true`. */
  readonly signed?: boolean;
  /** The texts: the quote and the escape of a quote. `false` removes the texts. The default is `"` with backslashes. */
  readonly strings?: false | { readonly quote?: '"' | "'"; readonly escape?: "backslash" | "double" };
  /** The words that are literals, with their values. The default is `true`, `false` and `null`. */
  readonly words?: Readonly<Record<string, unknown>>;
}

/** A reference syntax that a pattern gives, for example the address `A1` of a cell. */
export interface SyntaxRefPattern {
  /** The pattern of the text of a reference. The parser tries it before a name. */
  readonly pattern: RegExp;
  /** This function gives the path of the reference from its text. */
  readonly read: (text: string) => readonly Key[];
  /** This function gives the text of a path, or `undefined` when the pattern does not write the path. */
  readonly write: (path: readonly unknown[]) => string | undefined;
}

/** The reference syntax of a syntax profile. */
export interface SyntaxRefs {
  /** The root of a bare name. The default is `names`. Thus `x` is the path `["names", "x"]`. */
  readonly bare?: string;
  /** The roots that the text names first, for example `self.price`. The default is `self`, `world`, `event` and `caps`. */
  readonly roots?: readonly string[];
  /** `false` removes the field steps `a.b`. The default is `true`. */
  readonly fields?: boolean;
  /** The patterns of other references. */
  readonly patterns?: readonly SyntaxRefPattern[];
}

/** A call form: a name with arguments in parentheses that makes a construct, for example `if(test, then, else)`. */
export interface SyntaxForm {
  /** The name in the text. */
  readonly name: string;
  /** The type of the document, with dots between the keys. */
  readonly kind: string;
  /** The fields of the value, in the order of the arguments. Without them, the value is the list of the arguments. */
  readonly fields?: readonly string[];
  /** The smallest number of arguments. The default is the number of the fields, or `0`. */
  readonly min?: number;
}

/** The call syntax of a syntax profile. */
export interface SyntaxCalls {
  /** The operations that a call `name(args)` can name. `true` permits each name. The default is `true`. */
  readonly ops?: boolean | readonly string[];
  /** The call forms of constructs. A form wins over an operation with the same name. */
  readonly forms?: readonly SyntaxForm[];
  /** The text between two arguments. The default is `,`. */
  readonly separator?: string;
}

/**
 * The text syntax of a language (D41): an operator table, literal rules, reference syntax and call syntax. `parse`
 * reads a text into a document, and `print` writes a document as text. The profile is data, thus a site, an editor
 * and a language read the same rules.
 */
export interface SyntaxProfile {
  /** The operators. */
  readonly operators?: readonly SyntaxOperator[];
  /** The literal rules. */
  readonly literals?: SyntaxLiterals;
  /** The reference syntax. */
  readonly refs?: SyntaxRefs;
  /** The call syntax. */
  readonly calls?: SyntaxCalls;
  /** The deepest nesting that `parse` accepts. The default is `256`. */
  readonly maxDepth?: number;
}

/** A problem of a text: its character offset, its length and a message. */
export interface SyntaxIssue {
  /** The 0-based character offset of the problem. */
  readonly offset: number;
  /** The number of characters of the problem. `0` marks a place between two characters. */
  readonly length: number;
  /** The message. */
  readonly message: string;
}

/** The result of `parse`: a document, or the problems of the text. */
export type ParseResult = { readonly ok: true; readonly doc: Json } | { readonly ok: false; readonly issues: readonly SyntaxIssue[] };

/**
 * The standard syntax of the formula kit. It gives the site and the playground a text form. The operators are
 * `or`, `and`, `not`, the comparisons, `+ - * / %`, a minus sign and `^`, from the loosest to the tightest. A call
 * `name(args)` applies the operation `ops.name`. `if(test, then, else)` and `list(items)` make the constructs.
 */
export const STD_SYNTAX: SyntaxProfile = /* @__PURE__ */ Object.freeze({
  operators: [
    { symbol: "or", fixity: "infix", prec: 1, assoc: "flat", kind: "or" },
    { symbol: "and", fixity: "infix", prec: 2, assoc: "flat", kind: "and" },
    { symbol: "not", fixity: "prefix", prec: 3, kind: "ops.not" },
    { symbol: "==", fixity: "infix", prec: 4, assoc: "none", kind: "ops.eq" },
    { symbol: "!=", fixity: "infix", prec: 4, assoc: "none", kind: "ops.ne" },
    { symbol: "<", fixity: "infix", prec: 4, assoc: "none", kind: "ops.lt" },
    { symbol: "<=", fixity: "infix", prec: 4, assoc: "none", kind: "ops.le" },
    { symbol: ">", fixity: "infix", prec: 4, assoc: "none", kind: "ops.gt" },
    { symbol: ">=", fixity: "infix", prec: 4, assoc: "none", kind: "ops.ge" },
    { symbol: "+", fixity: "infix", prec: 5, kind: "ops.add" },
    { symbol: "-", fixity: "infix", prec: 5, kind: "ops.sub" },
    { symbol: "*", fixity: "infix", prec: 6, kind: "ops.mul" },
    { symbol: "/", fixity: "infix", prec: 6, kind: "ops.div" },
    { symbol: "%", fixity: "infix", prec: 6, kind: "ops.mod" },
    { symbol: "-", fixity: "prefix", prec: 7, kind: "ops.neg" },
    { symbol: "^", fixity: "infix", prec: 8, assoc: "right", kind: "ops.pow" },
  ],
  literals: { words: { true: true, false: false, null: null, undefined: undefined, NaN: NaN, Infinity: Infinity } },
  calls: {
    forms: [
      { name: "if", kind: "if", fields: ["test", "then", "else"], min: 2 },
      { name: "list", kind: "list" },
    ],
  },
} satisfies SyntaxProfile);

// === The compiled profile ===

interface Op {
  readonly symbol: string;
  readonly fixity: SyntaxFixity;
  readonly prec: number;
  readonly assoc: SyntaxAssoc;
  readonly type: Json;
  readonly kindKey: string;
  readonly word: boolean;
}

interface Form {
  readonly name: string;
  readonly type: Json;
  readonly fields: readonly string[] | undefined;
  readonly min: number;
}

interface Pattern {
  readonly sticky: RegExp;
  readonly whole: RegExp;
  readonly read: (text: string) => readonly Key[];
  readonly write: (path: readonly unknown[]) => string | undefined;
}

interface Compiled {
  readonly prefix: ReadonlyMap<string, Op>;
  readonly binary: ReadonlyMap<string, Op>;
  readonly prefixSymbols: readonly string[];
  readonly binarySymbols: readonly string[];
  readonly byKind: ReadonlyMap<string, readonly Op[]>;
  readonly numbers: boolean;
  readonly signed: boolean;
  readonly quote: string | undefined;
  readonly doubled: boolean;
  readonly words: ReadonlyMap<string, unknown>;
  readonly bare: string;
  readonly roots: ReadonlySet<string>;
  readonly fields: boolean;
  readonly patterns: readonly Pattern[];
  readonly ops: true | ReadonlySet<string>;
  readonly forms: ReadonlyMap<string, Form>;
  readonly formsByKind: ReadonlyMap<string, readonly Form[]>;
  readonly separator: string;
  readonly reserved: ReadonlySet<string>;
  readonly opWords: ReadonlySet<string>;
  readonly maxDepth: number;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NAME_AT = /[A-Za-z_][A-Za-z0-9_]*/y;
const DIGITS_AT = /[0-9]+/y;
const NUMBER_AT = /(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const SYMBOL = /^[^\sA-Za-z0-9_"'`()$.]+$/;
const DEFAULT_WORDS: Readonly<Record<string, unknown>> = { true: true, false: false, null: null };
const DEFAULT_ROOTS: readonly string[] = ["self", "world", "event", "caps"];

const compiledProfiles = new WeakMap<SyntaxProfile, Compiled>();

function typeOfKind(kind: string): { readonly type: Json; readonly key: string } {
  const keys = kind.split(".");
  if (kind === "" || keys.some((key) => key === "")) throw new TypeError(`The kind "${kind}" of a syntax profile has an empty key.`);
  return { type: keys.length === 1 ? (keys[0] as string) : keys, key: JSON.stringify(keys) };
}

function addTo<V>(map: Map<string, V[]>, key: string, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function compileOps(profile: SyntaxProfile, separator: string): Pick<Compiled, "prefix" | "binary" | "prefixSymbols" | "binarySymbols" | "byKind" | "opWords"> {
  const prefix = new Map<string, Op>();
  const binary = new Map<string, Op>();
  const byKind = new Map<string, Op[]>();
  const assocAt = new Map<number, SyntaxAssoc>();
  const opWords = new Set<string>();
  for (const given of profile.operators ?? []) {
    const word = NAME.test(given.symbol);
    if (!word && (!SYMBOL.test(given.symbol) || given.symbol.includes(separator))) {
      throw new TypeError(`The operator "${given.symbol}" is not a plain name or a group of symbols.`);
    }
    if (!Number.isFinite(given.prec)) throw new TypeError(`The operator "${given.symbol}" has no finite precedence.`);
    const { type, key } = typeOfKind(given.kind);
    const op: Op = { symbol: given.symbol, fixity: given.fixity, prec: given.prec, assoc: given.assoc ?? "left", type, kindKey: key, word };
    const table = op.fixity === "prefix" ? prefix : binary;
    if (table.has(op.symbol)) throw new TypeError(`The operator "${op.symbol}" has two entries of the same place.`);
    table.set(op.symbol, op);
    if (op.fixity === "infix") {
      const assoc = assocAt.get(op.prec);
      if (assoc !== undefined && assoc !== op.assoc) throw new TypeError(`The infix operators of the precedence ${String(op.prec)} have different groupings.`);
      assocAt.set(op.prec, op.assoc);
    }
    if (word) opWords.add(op.symbol);
    addTo(byKind, key, op);
  }
  const longestFirst = (table: Map<string, Op>): string[] =>
    [...table.keys()].filter((symbol) => !NAME.test(symbol)).sort((a, b) => b.length - a.length);
  return { prefix, binary, prefixSymbols: longestFirst(prefix), binarySymbols: longestFirst(binary), byKind, opWords };
}

function compileProfile(profile: SyntaxProfile): Compiled {
  const cached = compiledProfiles.get(profile);
  if (cached !== undefined) return cached;
  const calls = profile.calls ?? {};
  const separator = calls.separator ?? ",";
  const ops = compileOps(profile, separator);
  const literals = profile.literals ?? {};
  const strings = literals.strings === false ? undefined : (literals.strings ?? {});
  const words = new Map(Object.entries(literals.words ?? DEFAULT_WORDS));
  const refs = profile.refs ?? {};
  const roots = new Set(refs.roots ?? DEFAULT_ROOTS);
  const forms = new Map<string, Form>();
  const formsByKind = new Map<string, Form[]>();
  for (const given of calls.forms ?? []) {
    if (!NAME.test(given.name)) throw new TypeError(`The call form "${given.name}" is not a plain name.`);
    const { type, key } = typeOfKind(given.kind);
    const form: Form = { name: given.name, type, fields: given.fields, min: given.min ?? given.fields?.length ?? 0 };
    forms.set(form.name, form);
    addTo(formsByKind, key, form);
  }
  const compiled: Compiled = {
    ...ops,
    numbers: literals.numbers ?? true,
    signed: literals.signed ?? true,
    quote: strings === undefined ? undefined : (strings.quote ?? '"'),
    doubled: strings !== undefined && strings.escape === "double",
    words,
    bare: refs.bare ?? "names",
    roots,
    fields: refs.fields ?? true,
    patterns: (refs.patterns ?? []).map((p) => {
      const flags = p.pattern.flags.replace(/[gy]/g, "");
      return { sticky: new RegExp(p.pattern.source, `${flags}y`), whole: new RegExp(`^(?:${p.pattern.source})$`, flags), read: p.read, write: p.write };
    }),
    ops: calls.ops === undefined || calls.ops === true ? true : new Set(calls.ops === false ? [] : calls.ops),
    forms,
    formsByKind,
    separator,
    reserved: new Set([...words.keys(), ...ops.opWords, ...roots]),
    maxDepth: profile.maxDepth ?? 256,
  };
  compiledProfiles.set(profile, compiled);
  return compiled;
}

// === Parse ===

/** The stop of a parse. The parser throws it, and `parse` gives its issue. */
class Stop {
  constructor(readonly issue: SyntaxIssue) {}
}

function literalDoc(value: unknown): Json {
  return encodeValue({}, value);
}

function opDoc(op: Op | Form, value: Json): Json {
  return { type: op.type, value };
}

const ESCAPES: Readonly<Record<string, string>> = { '"': '"', "'": "'", "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(
    private readonly syn: Compiled,
    private readonly text: string,
  ) {}

  parse(): Json {
    this.skip();
    if (this.pos >= this.text.length) this.stop("The text is empty.", 0, 0);
    const doc = this.expr(0);
    this.skip();
    if (this.pos < this.text.length) this.stop("The text continues after the expression.", this.pos, this.tokenLength());
    return doc;
  }

  position(): number {
    return this.pos;
  }

  private stop(message: string, offset: number, length: number): never {
    throw new Stop({ offset, length, message });
  }

  private skip(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos] as string)) this.pos += 1;
  }

  private at(pattern: RegExp, pos: number = this.pos): string | undefined {
    pattern.lastIndex = pos;
    return pattern.exec(this.text)?.[0];
  }

  private tokenLength(): number {
    return (this.at(NAME_AT) ?? this.at(DIGITS_AT) ?? "x").length;
  }

  /** This method reads an expression by precedence climbing. It stops at an operator below `min`. */
  private expr(min: number): Json {
    const start = this.pos;
    this.depth += 1;
    if (this.depth > this.syn.maxDepth) this.stop(`The text is deeper than ${String(this.syn.maxDepth)} levels.`, start, 0);
    let left = this.operand();
    for (;;) {
      this.skip();
      const found = this.operatorAt();
      if (found === undefined || found.op.prec < min) break;
      const op = found.op;
      this.pos += found.length;
      if (op.fixity === "postfix") {
        left = opDoc(op, [left]);
        continue;
      }
      if (op.assoc === "flat") {
        const terms = [left, this.expr(op.prec + 1)];
        for (;;) {
          this.skip();
          const next = this.operatorAt();
          if (next === undefined || next.op.fixity !== "infix" || next.op.kindKey !== op.kindKey) break;
          this.pos += next.length;
          terms.push(this.expr(op.prec + 1));
        }
        left = opDoc(op, terms);
        continue;
      }
      left = opDoc(op, [left, this.expr(op.assoc === "right" ? op.prec : op.prec + 1)]);
      if (op.assoc === "none") {
        this.skip();
        const next = this.operatorAt();
        if (next !== undefined && next.op.fixity === "infix" && next.op.prec === op.prec) {
          this.stop(`The operator ${next.op.symbol} does not chain after ${op.symbol}. Add parentheses.`, this.pos, next.length);
        }
      }
    }
    this.depth -= 1;
    return left;
  }

  /** This method finds an infix or a postfix operator at the position. */
  private operatorAt(): { readonly op: Op; readonly length: number } | undefined {
    const name = this.at(NAME_AT);
    if (name !== undefined) {
      const op = this.syn.binary.get(name);
      return op !== undefined && op.word ? { op, length: name.length } : undefined;
    }
    for (const symbol of this.syn.binarySymbols) {
      if (this.text.startsWith(symbol, this.pos)) return { op: this.syn.binary.get(symbol) as Op, length: symbol.length };
    }
    return undefined;
  }

  private operand(): Json {
    this.skip();
    const start = this.pos;
    const c = this.text[start];
    if (c === undefined) return this.stop("A term is missing at the end of the text.", start, 0);
    for (const pattern of this.syn.patterns) {
      const match = this.at(pattern.sticky);
      if (match !== undefined && match !== "" && !/[A-Za-z0-9_$(]/.test(this.text[start + match.length] ?? "")) {
        this.pos += match.length;
        return { type: "ref", value: pattern.read(match) as Json };
      }
    }
    if (/[0-9]/.test(c)) return this.number(false);
    if (c === "-" && this.syn.signed && /[0-9]/.test(this.text[start + 1] ?? "")) return this.number(true);
    if (c === this.syn.quote) return this.string();
    if (c === "(") return this.group();
    if (c === "`" || /[A-Za-z_]/.test(c)) return this.named();
    for (const symbol of this.syn.prefixSymbols) {
      if (this.text.startsWith(symbol, start)) {
        this.pos += symbol.length;
        const op = this.syn.prefix.get(symbol) as Op;
        return opDoc(op, [this.expr(op.prec + 1)]);
      }
    }
    if (c === ")" || this.text.startsWith(this.syn.separator, start)) return this.stop("A term is missing.", start, 0);
    return this.stop(`The text "${c}" cannot start a term.`, start, 1);
  }

  private number(negative: boolean): Json {
    const start = this.pos;
    if (!this.syn.numbers) this.stop("This syntax has no numbers.", start, this.tokenLength());
    if (negative) this.pos += 1;
    const digits = this.at(NUMBER_AT) as string;
    this.pos += digits.length;
    const value = Number(digits);
    return literalDoc(negative ? -value : value);
  }

  private string(): Json {
    const start = this.pos;
    const quote = this.syn.quote as string;
    let out = "";
    this.pos += 1;
    for (;;) {
      const c = this.text[this.pos];
      if (c === undefined) return this.stop("A closing quote is missing.", start, this.text.length - start);
      if (c === quote) {
        if (this.syn.doubled && this.text[this.pos + 1] === quote) {
          out += quote;
          this.pos += 2;
          continue;
        }
        this.pos += 1;
        return literalDoc(out);
      }
      if (c === "\\" && !this.syn.doubled) {
        out += this.escape();
        continue;
      }
      out += c;
      this.pos += 1;
    }
  }

  private escape(): string {
    const start = this.pos;
    const c = this.text[start + 1] ?? "";
    if (c === "u") {
      const hex = this.text.slice(start + 2, start + 6);
      if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return this.stop("The escape \\u needs four hex digits.", start, 2);
      this.pos += 6;
      return String.fromCharCode(Number.parseInt(hex, 16));
    }
    const out = Object.hasOwn(ESCAPES, c) ? ESCAPES[c] : undefined;
    if (out === undefined) return this.stop(`The escape \\${c} is not valid.`, start, 2);
    this.pos += 2;
    return out;
  }

  private group(): Json {
    const open = this.pos;
    this.pos += 1;
    const inner = this.expr(0);
    this.skip();
    if (this.text[this.pos] !== ")") {
      if (this.pos >= this.text.length) this.stop("A closing parenthesis is missing.", open, 1);
      this.stop("A closing parenthesis is missing.", this.pos, this.tokenLength());
    }
    this.pos += 1;
    return inner;
  }

  /** This method reads a name in backticks. Two backticks in the name are one backtick. */
  private quoted(): string {
    const start = this.pos;
    let out = "";
    this.pos += 1;
    for (;;) {
      const c = this.text[this.pos];
      if (c === undefined) return this.stop("A closing backtick is missing.", start, this.text.length - start);
      if (c === "`") {
        if (this.text[this.pos + 1] !== "`") {
          this.pos += 1;
          return out;
        }
        this.pos += 1;
      }
      out += c;
      this.pos += 1;
    }
  }

  /** This method reads a name: a word operator, a call, a literal word or a reference. */
  private named(): Json {
    const start = this.pos;
    const plain = this.text[start] !== "`";
    const first = plain ? (this.at(NAME_AT) as string) : this.quoted();
    if (plain) {
      this.pos += first.length;
      const prefix = this.syn.prefix.get(first);
      if (prefix !== undefined && prefix.word) return opDoc(prefix, [this.expr(prefix.prec + 1)]);
      if (this.syn.binary.get(first)?.word === true) this.stop(`A term is missing before ${first}.`, start, first.length);
    }
    const path: Key[] = [first];
    let allPlain = plain;
    for (;;) {
      const back = this.pos;
      this.skip();
      if (!this.syn.fields || this.text[this.pos] !== ".") {
        this.pos = back;
        break;
      }
      this.pos += 1;
      this.skip();
      if (this.text[this.pos] === "`") {
        path.push(this.quoted());
        allPlain = false;
        continue;
      }
      const name = this.at(NAME_AT);
      const digits = name === undefined ? this.at(DIGITS_AT) : undefined;
      if (name === undefined && digits === undefined) this.stop("A name is missing after the dot.", this.pos, 0);
      this.pos += (name ?? (digits as string)).length;
      path.push(name ?? Number(digits));
      if (name === undefined) allPlain = false;
    }
    const back = this.pos;
    this.skip();
    if (this.text[this.pos] === "(") {
      if (!allPlain) this.stop("The name of a call is a plain name.", start, back - start);
      return this.call(path.join("."), start, back - start);
    }
    this.pos = back;
    if (plain && path.length === 1 && this.syn.words.has(first)) return literalDoc(this.syn.words.get(first));
    const full = plain && this.syn.roots.has(first) ? path : [this.syn.bare, ...path];
    return { type: "ref", value: full };
  }

  private call(name: string, start: number, nameLength: number): Json {
    const open = this.pos;
    const args: Json[] = [];
    this.pos += 1;
    this.skip();
    if (this.text[this.pos] === ")") this.pos += 1;
    else {
      for (;;) {
        args.push(this.expr(0));
        this.skip();
        if (this.text.startsWith(this.syn.separator, this.pos)) {
          this.pos += this.syn.separator.length;
          continue;
        }
        if (this.text[this.pos] === ")") {
          this.pos += 1;
          break;
        }
        if (this.pos >= this.text.length) this.stop("A closing parenthesis is missing.", open, 1);
        this.stop(`A "${this.syn.separator}" or a closing parenthesis is missing.`, this.pos, this.tokenLength());
      }
    }
    const form = this.syn.forms.get(name);
    if (form !== undefined) {
      const most = form.fields?.length ?? Number.POSITIVE_INFINITY;
      if (args.length < form.min || args.length > most) {
        const range = most === form.min ? String(most) : most === Number.POSITIVE_INFINITY ? `${String(form.min)} or more` : `${String(form.min)} to ${String(most)}`;
        this.stop(`The form ${name} takes ${range} arguments.`, start, this.pos - start);
      }
      if (form.fields === undefined) return opDoc(form, args);
      const value: Record<string, Json> = {};
      args.forEach((arg, index) => {
        value[form.fields?.[index] as string] = arg;
      });
      return opDoc(form, value);
    }
    if (this.syn.ops !== true && !this.syn.ops.has(name)) this.stop(`This syntax has no function ${name}.`, start, nameLength);
    return { type: ["ops", ...name.split(".")], value: args };
  }
}

/**
 * This function reads a text into a document with the rules of a profile (SYNTAX.PARSE). It does not throw for a
 * bad text. The issue gives the offset, the length and a message (SYNTAX.SPAN).
 *
 * @param profile - The syntax profile.
 * @param text - The text.
 * @returns The document, or the issues of the text.
 * @throws {TypeError} The profile is not valid, for example an operator has two entries of the same place.
 */
export function parse(profile: SyntaxProfile, text: string): ParseResult {
  const parser = new Parser(compileProfile(profile), text);
  try {
    return { ok: true, doc: parser.parse() };
  } catch (error) {
    if (error instanceof Stop) return { ok: false, issues: [error.issue] };
    if (isStackOverflow(error)) return { ok: false, issues: [{ offset: parser.position(), length: 0, message: "The text is too deep for the stack of the host." }] };
    throw error;
  }
}

// === Print ===

/** The text of a part, from its document and its path in the value of the parent. */
type SubText = (child: unknown, path: readonly Key[]) => Result<string>;

type Shape =
  | { readonly tag: "text"; readonly text: string }
  | { readonly tag: "op"; readonly op: Op; readonly terms: readonly unknown[] }
  | { readonly tag: "call"; readonly name: string; readonly args: readonly (readonly [Key, unknown])[] }
  | { readonly tag: "none"; readonly reason: string };

function none(reason: string): Shape {
  return { tag: "none", reason };
}

function quoteName(name: string): string {
  return `\`${name.replaceAll("`", "``")}\``;
}

function wordFor(syn: Compiled, value: unknown): string | undefined {
  for (const [word, held] of syn.words) if (Object.is(held, value)) return word;
  return undefined;
}

function textOfString(syn: Compiled, value: string): string | undefined {
  const quote = syn.quote;
  if (quote === undefined) return undefined;
  if (syn.doubled) return `${quote}${value.replaceAll(quote, quote + quote)}${quote}`;
  const json = JSON.stringify(value);
  return quote === '"' ? json : `'${json.slice(1, -1).replaceAll('\\"', '"').replaceAll("'", "\\'")}'`;
}

function textOfNumber(syn: Compiled, value: number): string | undefined {
  if (!syn.numbers) return wordFor(syn, value);
  const negative = value < 0 || Object.is(value, -0);
  if (negative && !syn.signed) return wordFor(syn, value);
  if (Number.isFinite(value)) return negative ? `-${String(-value)}` : String(value);
  return wordFor(syn, value) ?? (Number.isNaN(value) ? undefined : negative ? "-1e999" : "1e999");
}

function literalShape(syn: Compiled, value: unknown): Shape {
  const text = typeof value === "string" ? textOfString(syn, value) : typeof value === "number" ? textOfNumber(syn, value) : wordFor(syn, value);
  return text === undefined ? none(`This syntax has no text for the literal ${describe(value)}.`) : { tag: "text", text };
}

function plainSegment(syn: Compiled, name: string): boolean {
  return NAME.test(name) && !syn.reserved.has(name) && !syn.patterns.some((p) => p.whole.test(name));
}

function laterSegment(step: unknown): string | undefined {
  if (typeof step === "string") return NAME.test(step) ? step : quoteName(step);
  return typeof step === "number" && Number.isSafeInteger(step) && step >= 0 ? String(step) : undefined;
}

function refShape(syn: Compiled, value: unknown): Shape {
  if (!Array.isArray(value) || value.length === 0) return none("The path of the reference is empty.");
  for (const pattern of syn.patterns) {
    const text = pattern.write(value);
    if (text !== undefined) return { tag: "text", text };
  }
  const [root, ...rest] = value as readonly unknown[];
  const many = rest.length > 1 || (root !== syn.bare && rest.length > 0);
  if (many && !syn.fields) return none("This syntax has no field steps.");
  const later = rest.slice(1).map(laterSegment);
  let first: string | undefined;
  let tail = later;
  if (root === syn.bare && typeof rest[0] === "string") first = plainSegment(syn, rest[0]) ? rest[0] : quoteName(rest[0]);
  else if (typeof root === "string" && syn.roots.has(root) && !syn.patterns.some((p) => p.whole.test(root))) {
    first = root;
    tail = rest.map(laterSegment);
  }
  if (first === undefined || tail.includes(undefined)) return none("This syntax has no text for the path of the reference.");
  return { tag: "text", text: [first, ...tail].join(".") };
}

function callName(syn: Compiled, keys: readonly Key[]): string | undefined {
  if (keys.length === 0 || !keys.every((key) => typeof key === "string" && NAME.test(key))) return undefined;
  const name = keys.join(".");
  if (syn.forms.has(name) || syn.opWords.has(keys[0] as string)) return undefined;
  return syn.ops === true || syn.ops.has(name) ? name : undefined;
}

function formShape(form: Form, value: unknown): Shape | undefined {
  if (form.fields === undefined) {
    if (!Array.isArray(value) || value.length < form.min) return undefined;
    return { tag: "call", name: form.name, args: value.map((item, index) => [index, item] as const) };
  }
  if (!isRecord(value)) return undefined;
  // The fields that the value holds must be the first fields of the form, because the arguments go in order.
  const count = Object.keys(value).length;
  const present = form.fields.slice(0, count);
  if (count < form.min || present.length < count || !present.every((key) => Object.hasOwn(value, key))) return undefined;
  return { tag: "call", name: form.name, args: present.map((key) => [key, value[key]] as const) };
}

function opShape(syn: Compiled, key: string, terms: readonly unknown[]): Shape | undefined {
  for (const op of syn.byKind.get(key) ?? []) {
    const fits = op.fixity === "infix" ? terms.length === 2 || (op.assoc === "flat" && terms.length > 2) : terms.length === 1;
    if (fits) return { tag: "op", op, terms };
  }
  return undefined;
}

/** This function gives the shape of a document: a literal or a reference, an operator, a call, or no text. */
function shapeOf(syn: Compiled, doc: unknown): Shape {
  if (!isEnvelope(doc)) return Array.isArray(doc) || isRecord(doc) ? none("This syntax has no text for a list or a record literal.") : literalShape(syn, doc);
  if (doc.name !== undefined || doc.own !== undefined) return none("This syntax has no text for the header of a document.");
  const path = typePath(doc.type);
  if (path === undefined) return none("This syntax has no text for a computed type.");
  const value: unknown = doc.value;
  const name = path.join(".");
  if (name === "lit") return isEnvelope(value) || Array.isArray(value) || isRecord(value) ? none("This syntax has no text for a list or a record literal.") : literalShape(syn, value);
  if (name === "ext.undefined") return literalShape(syn, undefined);
  if (name === "ext.number") {
    const numbers: Readonly<Record<string, number>> = { NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, "-Infinity": Number.NEGATIVE_INFINITY, "-0": -0 };
    return typeof value === "string" && Object.hasOwn(numbers, value) ? literalShape(syn, numbers[value]) : none("The value of ext.number is not valid.");
  }
  if (name === "ref") return refShape(syn, value);
  const key = JSON.stringify(path);
  const op = Array.isArray(value) ? opShape(syn, key, value) : undefined;
  if (op !== undefined) return op;
  for (const form of syn.formsByKind.get(key) ?? []) {
    const shape = formShape(form, value);
    if (shape !== undefined) return shape;
  }
  const called = path[0] === "ops" && Array.isArray(value) ? callName(syn, path.slice(1)) : undefined;
  if (called !== undefined) return { tag: "call", name: called, args: (value as readonly unknown[]).map((item, index) => [index, item] as const) };
  return none(`This syntax has no text for the kind ${name}.`);
}

function levelOf(syn: Compiled, doc: unknown): number {
  const shape = shapeOf(syn, doc);
  return shape.tag === "op" ? shape.op.prec : Number.POSITIVE_INFINITY;
}

/** This function tells if a term needs parentheses in its position, so that `parse` reads the same tree. */
function needsGroup(op: Op, index: number, level: number): boolean {
  if (op.fixity === "postfix") return level < op.prec;
  if (op.fixity === "prefix" || op.assoc === "none" || op.assoc === "flat") return level <= op.prec;
  const looser = op.assoc === "left" ? index === 0 : index !== 0;
  return looser ? level < op.prec : level <= op.prec;
}

function opText(syn: Compiled, op: Op, terms: readonly unknown[], sub: SubText): Result<string> {
  const texts: string[] = [];
  for (let index = 0; index < terms.length; index += 1) {
    const term = terms[index];
    const result = sub(term, [index]);
    if (!result.ok) return result;
    let text = result.value;
    const signedDigit = op.fixity === "prefix" && op.symbol === "-" && syn.signed && /^[0-9]/.test(text);
    if (needsGroup(op, index, levelOf(syn, term)) || signedDigit) text = `(${text})`;
    texts.push(text);
  }
  const [only = ""] = texts;
  if (op.fixity === "prefix") return ok(op.word || /^[^A-Za-z0-9_("'`$]/.test(only) ? `${op.symbol} ${only}` : `${op.symbol}${only}`);
  if (op.fixity === "postfix") return ok(op.word ? `${only} ${op.symbol}` : `${only}${op.symbol}`);
  return ok(texts.join(` ${op.symbol} `));
}

/** This function writes one document. `sub` gives the text of each part. */
function printNode(syn: Compiled, doc: unknown, sub: SubText): Result<string> {
  const shape = shapeOf(syn, doc);
  if (shape.tag === "text") return ok(shape.text);
  if (shape.tag === "none") return fail("#VALUE!", shape.reason);
  if (shape.tag === "op") return opText(syn, shape.op, shape.terms, sub);
  const texts: string[] = [];
  for (const [key, arg] of shape.args) {
    const result = sub(arg, [key]);
    if (!result.ok) return result;
    texts.push(result.value);
  }
  return ok(`${shape.name}(${texts.join(`${syn.separator} `)})`);
}

function printTree(syn: Compiled, doc: unknown, place: readonly Key[]): Result<string> {
  const result = printNode(syn, doc, (child, path) => printTree(syn, child, [...place, ...path]));
  return result.ok || result.error.place !== undefined ? result : fail(result.error.code, result.error.reason, { place });
}

/**
 * This function writes a document as text with the rules of a profile (SYNTAX.PRINT). It writes the fewest
 * parentheses that keep the tree. `parse` reads the text back to the same document (SYNTAX.ROUNDTRIP).
 *
 * @param profile - The syntax profile.
 * @param doc - The document.
 * @returns The text, or `#VALUE!` at the place of a document that the profile cannot write.
 * @throws {TypeError} The profile is not valid.
 */
export function print(profile: SyntaxProfile, doc: unknown): Result<string> {
  const syn = compileProfile(profile);
  try {
    return printTree(syn, doc, []);
  } catch (error) {
    if (isStackOverflow(error)) return fail("#DEPTH!", "The document is too deep for the stack of the host.", { cause: error });
    throw error;
  }
}

/**
 * This function makes the part of a merge that adds the verb `format` to a machine (D23, D41). Its default writes
 * each document with the printer of the profile. A part gives its own text through the ladder, thus an own entry or
 * a kind entry of `format` still wins.
 *
 * @param profile - The syntax profile.
 * @returns The part for `mergeMachines`.
 */
export function syntaxFormat(profile: SyntaxProfile): MachinePart {
  const syn = compileProfile(profile);
  const code: EvalFn = ({ doc, parts, place }) => {
    const byPath = new Map<string, Part>(parts.map((part) => [JSON.stringify(part.path), part]));
    return printNode(syn, doc, (child, path) => {
      const part = byPath.get(JSON.stringify(path));
      if (part === undefined) return printTree(syn, child, [...place, ...path]);
      const result = part.evaluate();
      if (!result.ok) return result;
      return typeof result.value === "string" ? ok(result.value) : fail("#VALUE!", `The verb format of a part gave ${describe(result.value)}, not a text.`, { place: [...place, ...path] });
    });
  };
  return { world: { defaults: { format: "syntax.format" } }, evaluators: { "syntax.format": code } };
}
