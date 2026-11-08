import { type Json, type JsonRecord, type Key, docEquals, isEnvelope, isRecord, typePath } from "./doc.ts";
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
  /**
   * The kinds of the data envelopes of a text, a number and a truth value, with dots between the keys (K159, D65). A
   * literal in a place that takes a document gets its envelope. Such a place is the whole text, the document after a
   * header name, or an argument that its form names in `wrap`. Thus `list(1)` gives `list(number(1))`, and `print`
   * writes the envelope as the bare literal there. Without this field, a literal stays bare in each place.
   */
  readonly envelopes?: SyntaxEnvelopes;
}

/** The kinds of the data envelopes of the literals (K159, D65). A literal without a kind stays bare, for example `null`. */
export interface SyntaxEnvelopes {
  /** The kind of a finite number, for example `number`. */
  readonly number?: string;
  /** The kind of a text, for example `text`. */
  readonly text?: string;
  /** The kind of a truth value, for example `bool`. */
  readonly bool?: string;
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
  /**
   * The name in the text: a plain name, or plain names with dots between them, for example `math.product` (K161). A
   * name with dots needs the field steps of `refs.fields`, and its first key is not a word operator.
   */
  readonly name: string;
  /** The type of the document, with dots between the keys. */
  readonly kind: string;
  /**
   * The fields of the value, in the order of the arguments. Without them, the value is the list of the arguments. A
   * form `named` permits only these keys, and without them it permits each key.
   */
  readonly fields?: readonly string[];
  /** The smallest number of arguments. The default is the number of the fields, or `0`. Only `list` and `fields` read it. */
  readonly min?: number;
  /**
   * The way that the arguments make the value (D63). The default is `fields` with fields, or `list`.
   *
   * - `list`: the value is the list of the arguments, for example `list(1, 2)`.
   * - `fields`: the arguments go into the fields, in order, for example `if(test, then, else)`.
   * - `named`: each argument is a key and a document, and the value is a record, for example `panel(width: 300)`.
   * - `literal`: the one argument is a literal, and the value is its data, for example `text("big")`.
   */
  readonly args?: SyntaxFormArgs;
  /**
   * The arguments that take a document (K159, D65): `true` for each argument, or the names of some fields. A literal
   * in such an argument gets its data envelope of `literals.envelopes`. Without that field, `wrap` changes nothing. A
   * form `literal` takes no `wrap`, and a form `list` takes only `true`.
   */
  readonly wrap?: boolean | readonly string[];
  /**
   * The fields that take data with documents in it (L1c, D177), for example the clauses of `handle`. Such an
   * argument is a list between brackets, a record between braces, or a document. A literal in it stays its data. A
   * record of data has no key `type`. A name of `data` is a field of the form, and it is not in `wrap`.
   */
  readonly data?: readonly string[];
  /**
   * The name of a domain with a codec (K143, D141). A form `literal` of the kind `ext.domain` needs it. The text
   * `date("2026-01-02")` then gives the value `{ domain: "date", data: "2026-01-02" }`. The syntax does not read the
   * data: the codec of the machine reads it at evaluation. Each other form takes no `domain`.
   */
  readonly domain?: string;
}

/** The way that the arguments of a call form make the value of its document (D63). */
export type SyntaxFormArgs = "list" | "fields" | "named" | "literal";

/** The call syntax of a syntax profile. */
export interface SyntaxCalls {
  /** The operations that a call `name(args)` can name. `true` permits each name. The default is `true`. */
  readonly ops?: boolean | readonly string[];
  /** The call forms of constructs. A form wins over an operation with the same name. */
  readonly forms?: readonly SyntaxForm[];
  /** The text between two arguments. The default is `,`. */
  readonly separator?: string;
}

/** The text of the header of a document (K157, D62). */
export interface SyntaxHeader {
  /**
   * The symbol between a name and its document, for example `=` in `total = 2 + 3`. The text gives the document the
   * header `name`. Without the symbol, a document with a name has no text. The symbol is a group of symbols, and no
   * infix or postfix operator is the symbol or the start of it.
   */
  readonly bind?: string;
}

/**
 * The text forms of the constructs of the formula kit (K145, D127). Each field is the kind of one form, with dots
 * between the keys. A construct without a field has no text. Each text of a form was an issue before, and no form
 * reserves a name.
 */
export interface SyntaxConstructs {
  /** The kind of the form `{a: 1, b: x}`. Its value is a record of documents. */
  readonly record?: string;
  /** The kind of the form `let {a: 1} in a + 1`. Its value has the fields `bind` and `body`. */
  readonly let?: string;
  /** The kind of the form `(x, y) => x + y`. Its value has the fields `params` and `body`. */
  readonly fn?: string;
  /** The kind of the form `(f)(1, 2)`: a call of a value. Its value has the fields `fn` and `args`. */
  readonly call?: string;
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
  /** The text of the header of a document. */
  readonly header?: SyntaxHeader;
  /** The text forms of the constructs. Without a field, the construct has no text. */
  readonly constructs?: SyntaxConstructs;
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

/**
 * The most issues that `parse` gives for one text (D138). A person reads a list of this size, and a text with more
 * issues needs another kind of help.
 */
export const MAX_SYNTAX_ISSUES = 20;

/** The result of `parse`: a document, or the problems of the text in the order of their offsets (D138). */
export type ParseResult = { readonly ok: true; readonly doc: Json } | { readonly ok: false; readonly issues: readonly SyntaxIssue[] };

/**
 * The standard syntax of the formula kit. It gives the site and the playground a text form. The operators are
 * `or`, `and`, `not`, the comparisons, `+ - * / %`, a minus sign and `^`, from the loosest to the tightest. A call
 * `name(args)` applies the operation `ops.name`. `if(test, then, else)` and `list(items)` make the constructs. The
 * text `total = 2 + 3` gives the document the header name `total` (D62). The forms `{a: 1}`, `let {a: 1} in a`,
 * `(x) => x` and `(f)(1)` make `record`, `let`, `fn` and `call` (D127).
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
  header: { bind: "=" },
  constructs: { record: "record", let: "let", fn: "fn", call: "call" },
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
  readonly args: SyntaxFormArgs;
  readonly fields: readonly string[] | undefined;
  readonly min: number;
  /** The arguments that take a document: `true` for each, or the names of the fields. */
  readonly wrap: boolean | ReadonlySet<string>;
  /** The domain of a form literal of `ext.domain` (D141). */
  readonly domain: string | undefined;
  /** The fields that take data with documents in it (D177). */
  readonly data: ReadonlySet<string>;
}

/** The type of a data envelope, and its key for a comparison with the path of a type. */
interface EnvelopeKind {
  readonly type: Json;
  readonly key: string;
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
  readonly envelopes: { readonly number?: EnvelopeKind; readonly text?: EnvelopeKind; readonly bool?: EnvelopeKind } | undefined;
  readonly bare: string;
  readonly roots: ReadonlySet<string>;
  readonly fields: boolean;
  readonly patterns: readonly Pattern[];
  readonly ops: true | ReadonlySet<string>;
  readonly forms: ReadonlyMap<string, Form>;
  readonly formsByKind: ReadonlyMap<string, readonly Form[]>;
  readonly separator: string;
  readonly bind: string | undefined;
  /** The type of the document of each construct that has a text form. */
  readonly constructs: { readonly [Name in keyof SyntaxConstructs]?: Json };
  /** The construct of each kind, by the path of the kind as a JSON text. */
  readonly constructKinds: ReadonlyMap<string, keyof SyntaxConstructs>;
  readonly reserved: ReadonlySet<string>;
  readonly opWords: ReadonlySet<string>;
  readonly maxDepth: number;
  /** `true` when a form has a field of data (D177). Such a field reads brackets and braces. */
  readonly brackets: boolean;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NAME_AT = /[A-Za-z_][A-Za-z0-9_]*/y;
const DIGITS_AT = /[0-9]+/y;
const NUMBER_AT = /(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const SYMBOL = /^[^\sA-Za-z0-9_"'`()$.]+$/;
const DEFAULT_WORDS: Readonly<Record<string, unknown>> = { true: true, false: false, null: null };
const DEFAULT_ROOTS: readonly string[] = ["self", "world", "event", "caps"];
const FORM_ARGS: readonly SyntaxFormArgs[] = ["list", "fields", "named", "literal"];
const CONSTRUCTS: readonly (keyof SyntaxConstructs)[] = ["record", "let", "fn", "call"];

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

/** This function examines the bind symbol of a header. A text with the symbol after a name was not valid before. */
function compileBind(bind: string | undefined, separator: string, binary: ReadonlyMap<string, Op>): string | undefined {
  if (bind === undefined) return undefined;
  if (!SYMBOL.test(bind) || bind.includes(separator)) throw new TypeError(`The bind symbol "${bind}" is not a group of symbols.`);
  for (const symbol of binary.keys()) {
    if (bind.startsWith(symbol)) throw new TypeError(`The bind symbol "${bind}" starts with the operator "${symbol}".`);
  }
  return bind;
}

/** This function gives the types of the construct forms (K145). An operator that reads the same text throws. */
function compileConstructs(given: SyntaxConstructs | undefined, ops: Pick<Compiled, "prefixSymbols" | "binarySymbols" | "opWords">): Pick<Compiled, "constructs" | "constructKinds"> {
  const constructs: { -readonly [Name in keyof SyntaxConstructs]?: Json } = {};
  const constructKinds = new Map<string, keyof SyntaxConstructs>();
  for (const name of CONSTRUCTS) {
    const kind = given?.[name];
    if (kind === undefined) continue;
    const { type, key } = typeOfKind(kind);
    constructs[name] = type;
    constructKinds.set(key, name);
  }
  const braces = constructs.record !== undefined || constructs.let !== undefined;
  for (const symbol of [...ops.prefixSymbols, ...ops.binarySymbols]) {
    if ((braces && /^[{}]/.test(symbol)) || (constructs.fn !== undefined && symbol.startsWith("=>"))) throw new TypeError(`The operator "${symbol}" reads the text of a construct form.`);
  }
  if (constructs.let !== undefined && ops.opWords.has("let")) throw new TypeError('The operator "let" reads the text of a construct form.');
  return { constructs, constructKinds };
}

/** This function examines the field `domain` of a call form (D141). A form `literal` of `ext.domain` needs a name, and each other form refuses it. */
function compileDomain(given: SyntaxForm, args: SyntaxFormArgs): string | undefined {
  const writes = args === "literal" && given.kind === "ext.domain";
  if (writes && (typeof given.domain !== "string" || given.domain === "")) throw new TypeError(`The call form "${given.name}" of ext.domain needs the name of its domain.`);
  if (!writes && given.domain !== undefined) throw new TypeError(`The call form "${given.name}" takes no domain: only a form literal of ext.domain has one.`);
  return given.domain;
}

/** This function examines the field `wrap` of a call form (K159). A name that is not a field of the form throws. */
function compileWrap(given: SyntaxForm, args: SyntaxFormArgs): boolean | ReadonlySet<string> {
  const wrap = given.wrap;
  if (wrap === undefined || wrap === false) return false;
  if (args === "literal") throw new TypeError(`The call form "${given.name}" with the arguments literal takes no wrap.`);
  if (wrap === true) return true;
  if (args === "list") throw new TypeError(`The call form "${given.name}" with the arguments list takes only the wrap true.`);
  for (const name of wrap) {
    if (given.fields !== undefined && !given.fields.includes(name)) throw new TypeError(`The call form "${given.name}" has no field ${name} for its wrap.`);
  }
  return new Set(wrap);
}

/** This function gives the types of the data envelopes of a profile (K159), or `undefined` without them. */
/** This function examines the field `data` of a call form (D177). Each name is a field of the form, and no name is in `wrap`. */
function compileData(given: SyntaxForm, wrap: boolean | ReadonlySet<string>): ReadonlySet<string> {
  const data = given.data ?? [];
  if (data.length > 0 && given.fields === undefined) throw new TypeError(`The call form "${given.name}" takes data only with fields.`);
  for (const name of data) {
    if (given.fields?.includes(name) !== true) throw new TypeError(`The call form "${given.name}" has no field ${name} for its data.`);
    if (wrap === true || (wrap !== false && wrap.has(name))) throw new TypeError(`The call form "${given.name}" has the field ${name} in wrap and in data.`);
  }
  return new Set(data);
}

function compileEnvelopes(given: SyntaxEnvelopes | undefined): Compiled["envelopes"] {
  if (given === undefined) return undefined;
  const out: { number?: EnvelopeKind; text?: EnvelopeKind; bool?: EnvelopeKind } = {};
  for (const key of ["number", "text", "bool"] as const) {
    const kind = given[key];
    if (kind !== undefined) out[key] = typeOfKind(kind);
  }
  return out;
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
    const keys = given.name.split(".");
    if (!keys.every((key) => NAME.test(key))) throw new TypeError(`The call form "${given.name}" is not a plain name or a path of plain names.`);
    if (keys.length > 1 && refs.fields === false) throw new TypeError(`The call form "${given.name}" has dots, but the syntax has no field steps.`);
    if (keys.length > 1 && ops.opWords.has(keys[0] as string)) throw new TypeError(`The call form "${given.name}" starts with the word operator "${keys[0] as string}".`);
    const { type, key } = typeOfKind(given.kind);
    const args = given.args ?? (given.fields === undefined ? "list" : "fields");
    if (!FORM_ARGS.includes(args)) throw new TypeError(`The call form "${given.name}" has the unknown arguments ${String(args)}.`);
    if ((args === "fields") !== (given.fields !== undefined) && args !== "named") throw new TypeError(`The call form "${given.name}" with the arguments ${args} ${args === "fields" ? "needs" : "takes no"} fields.`);
    if (given.min !== undefined && (args === "named" || args === "literal")) throw new TypeError(`The call form "${given.name}" with the arguments ${args} takes no min.`);
    const wrap = compileWrap(given, args);
    const form: Form = { name: given.name, type, args, fields: given.fields, min: given.min ?? given.fields?.length ?? 0, wrap, domain: compileDomain(given, args), data: compileData(given, wrap) };
    forms.set(form.name, form);
    addTo(formsByKind, key, form);
  }
  // A field of data reads brackets and braces, thus no operator starts with one of them (D177).
  const brackets = [...forms.values()].some((form) => form.data.size > 0);
  for (const symbol of brackets ? [...ops.prefixSymbols, ...ops.binarySymbols] : []) {
    if (/^[[\]{}]/.test(symbol)) throw new TypeError(`The operator "${symbol}" reads the text of a field of data.`);
  }
  const compiled: Compiled = {
    ...ops,
    numbers: literals.numbers ?? true,
    signed: literals.signed ?? true,
    quote: strings === undefined ? undefined : (strings.quote ?? '"'),
    doubled: strings !== undefined && strings.escape === "double",
    words,
    envelopes: compileEnvelopes(literals.envelopes),
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
    bind: compileBind(profile.header?.bind, separator, ops.binary),
    ...compileConstructs(profile.constructs, ops),
    reserved: new Set([...words.keys(), ...ops.opWords, ...roots]),
    maxDepth: profile.maxDepth ?? 256,
    brackets,
  };
  compiledProfiles.set(profile, compiled);
  return compiled;
}

// === Parse ===

/** The stop of a parse. The parser throws it, and `parse` gives its issue. */
class Stop {
  readonly issue: SyntaxIssue;

  constructor(issue: SyntaxIssue) {
    this.issue = issue;
  }
}

function literalDoc(value: unknown): Json {
  return encodeValue({}, value);
}

function opDoc(op: Op | Form, value: Json): Json {
  return { type: op.type, value };
}

/** This function gives the kind of the data envelope of a literal (K159), or `undefined` when the literal has none. */
function envelopeOf(syn: Compiled, value: unknown): EnvelopeKind | undefined {
  const kinds = syn.envelopes;
  if (kinds === undefined || !isScalar(value)) return undefined;
  return typeof value === "string" ? kinds.text : typeof value === "number" ? kinds.number : typeof value === "boolean" ? kinds.bool : undefined;
}

/** This function gives a literal in a place that takes a document its data envelope (K159). Each other document stays. */
function envelop(syn: Compiled, doc: Json): Json {
  const kind = isEnvelope(doc) ? undefined : envelopeOf(syn, doc);
  return kind === undefined ? doc : { type: kind.type, value: doc };
}

/** This function tells if an argument of a form takes a document (K159). */
function wraps(form: Form, key: Key): boolean {
  return form.wrap === true || (form.wrap !== false && form.wrap.has(String(key)));
}

/** This function tells if a value is a literal that JSON writes exactly: a text, a finite number, a truth value or `null`. */
function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0));
}

function setOwn(target: Record<string, Json>, key: string, value: Json): void {
  if (key === "__proto__") Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

const ESCAPES: Readonly<Record<string, string>> = { '"': '"', "'": "'", "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

class Parser {
  protected readonly syn: Compiled;
  protected readonly text: string;
  protected pos = 0;
  protected depth = 0;

  constructor(syn: Compiled, text: string) {
    this.syn = syn;
    this.text = text;
  }

  parse(): Json {
    this.skip();
    if (this.pos >= this.text.length) this.stop("The text is empty.", 0, 0);
    const doc = this.bound();
    this.skip();
    if (this.pos < this.text.length) this.stop("The text continues after the expression.", this.pos, this.tokenLength());
    // The whole text is a document, thus a literal gets its data envelope (K159).
    return envelop(this.syn, doc);
  }

  position(): number {
    return this.pos;
  }

  protected stop(message: string, offset: number, length: number): never {
    throw new Stop({ offset, length, message });
  }

  protected skip(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos] as string)) this.pos += 1;
  }

  private at(pattern: RegExp, pos: number = this.pos): string | undefined {
    pattern.lastIndex = pos;
    return pattern.exec(this.text)?.[0];
  }

  protected tokenLength(): number {
    return (this.at(NAME_AT) ?? this.at(DIGITS_AT) ?? "x").length;
  }

  /**
   * This method reads an expression that can have a header name: `name = expr` (D62). The bind symbol of the profile
   * follows the name. A longer operator that starts with the symbol wins, for example `==` over `=`.
   */
  protected bound(): Json {
    const name = this.bindingName();
    if (name === undefined) return this.expr(0);
    this.skip();
    const start = this.pos;
    const doc = this.expr(0);
    if (isEnvelope(doc)) {
      if (doc.name !== undefined) this.stop(`The document already has the name ${doc.name}.`, start, this.pos - start);
      return { ...doc, name };
    }
    const kind = envelopeOf(this.syn, doc);
    return kind === undefined ? { type: "lit", value: doc, name } : { type: kind.type, value: doc, name };
  }

  /** This method reads a name and the bind symbol after it. Without them, it gives `undefined` and keeps the position. */
  private bindingName(): string | undefined {
    const bind = this.syn.bind;
    if (bind === undefined) return undefined;
    this.skip();
    const back = this.pos;
    let name: string | undefined;
    if (this.text[this.pos] === "`") {
      try {
        name = this.quoted();
      } catch (error) {
        if (!(error instanceof Stop)) throw error;
      }
    } else {
      name = this.at(NAME_AT);
      if (name !== undefined) this.pos += name.length;
    }
    if (name !== undefined) {
      this.skip();
      const longer = this.syn.binarySymbols.some((symbol) => symbol.length > bind.length && symbol.startsWith(bind) && this.text.startsWith(symbol, this.pos));
      if (this.text.startsWith(bind, this.pos) && !longer) {
        this.pos += bind.length;
        return name;
      }
    }
    this.pos = back;
    return undefined;
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
    if (c === "(") return this.parenthesized();
    if (c === "{" && this.syn.constructs.record !== undefined) return { type: this.syn.constructs.record, value: this.entries(undefined) };
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

  protected escape(): string {
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

  /** This method reads a function `(x) => x`, or a group with the calls of a value after it (K145). */
  private parenthesized(): Json {
    const { fn, call } = this.syn.constructs;
    const params = fn === undefined ? undefined : this.arrowParams();
    if (fn !== undefined && params !== undefined) {
      this.skip();
      return { type: fn, value: { params, body: this.bound() } };
    }
    let out = this.group();
    if (call === undefined) return out;
    for (;;) {
      const back = this.pos;
      this.skip();
      if (this.text[this.pos] !== "(") {
        this.pos = back;
        return out;
      }
      out = { type: call, value: { fn: out, args: this.argumentsOf(() => this.bound()) } };
    }
  }

  /** This method reads `(a, b) =>` and gives the names. Without that text, it gives `undefined` and keeps the position. */
  private arrowParams(): string[] | undefined {
    const back = this.pos;
    const params: string[] = [];
    this.pos += 1;
    for (let first = true; ; first = false) {
      this.skip();
      if (first && this.text[this.pos] === ")") break;
      const name = this.key();
      this.skip();
      if (name !== undefined) params.push(name);
      if (name !== undefined && this.text[this.pos] === ")") break;
      if (name === undefined || !this.text.startsWith(this.syn.separator, this.pos)) {
        this.pos = back;
        return undefined;
      }
      this.pos += this.syn.separator.length;
    }
    this.pos += 1;
    this.skip();
    if (!this.text.startsWith("=>", this.pos)) {
      this.pos = back;
      return undefined;
    }
    this.pos += 2;
    return params;
  }

  /** This method reads the bindings between braces, the word `in` and the body of a `let` (K145). */
  private letTerm(type: Json): Json {
    const bind = this.entries(undefined);
    this.skip();
    if (this.at(NAME_AT) !== "in") this.stop('The word "in" is missing after the bindings of let.', this.pos, Math.min(this.tokenLength(), this.text.length - this.pos));
    this.pos += 2;
    return { type, value: { bind, body: this.bound() } };
  }

  protected group(): Json {
    const open = this.pos;
    this.pos += 1;
    const inner = this.bound();
    this.skip();
    if (this.text[this.pos] !== ")") {
      if (this.pos >= this.text.length) this.stop("A closing parenthesis is missing.", open, 1);
      this.noEnd(")", false);
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

  /** This method reads a plain name or a name in backticks. Without a name, it gives `undefined`. */
  private key(): string | undefined {
    if (this.text[this.pos] === "`") return this.quoted();
    const name = this.at(NAME_AT);
    if (name !== undefined) this.pos += name.length;
    return name;
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
      // The word `let` starts a form only before a brace, thus `let` stays a good name (D127).
      const construct = first === "let" ? this.syn.constructs.let : undefined;
      if (construct !== undefined) {
        const back = this.pos;
        this.skip();
        if (this.text[this.pos] === "{") return this.letTerm(construct);
        this.pos = back;
      }
    }
    const path: Json[] = [first];
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
      // A step in parentheses is a document, for example `self.parent.(nearest(type: "panel"))` (SYNTAX.STEP).
      if (this.text[this.pos] === "(") {
        path.push(this.group());
        allPlain = false;
        continue;
      }
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
      if (!allPlain) this.stop("Each key of the name of a call is a plain name.", start, back - start);
      return this.call(path.join("."), start, back - start);
    }
    this.pos = back;
    if (plain && path.length === 1 && this.syn.words.has(first)) return literalDoc(this.syn.words.get(first));
    const full = plain && this.syn.roots.has(first) ? path : [this.syn.bare, ...path];
    return { type: "ref", value: full };
  }

  /** This method stops at a token where a group or a list must end. A list can also continue with its separator. */
  protected noEnd(close: string, list: boolean): never {
    const closer = closerName(close);
    const before = list ? `"${this.syn.separator}" or a ` : "";
    return this.stop(`A ${before}closing ${closer} is missing.`, this.pos, this.tokenLength());
  }

  /** This method reads the arguments of a call in parentheses. `item` reads one argument. `close` ends the arguments. */
  protected argumentsOf<T>(item: () => T, close = ")"): T[] {
    const open = this.pos;
    const args: T[] = [];
    this.pos += 1;
    this.skip();
    if (this.text[this.pos] === close) {
      this.pos += 1;
      return args;
    }
    for (;;) {
      args.push(item());
      this.skip();
      if (this.text.startsWith(this.syn.separator, this.pos)) {
        this.pos += this.syn.separator.length;
        continue;
      }
      if (this.text[this.pos] === close) {
        this.pos += 1;
        return args;
      }
      if (this.pos >= this.text.length) this.stop(`A closing ${closerName(close)} is missing.`, open, 1);
      this.noEnd(close, true);
    }
  }

  /**
   * This method reads the argument of a field of data (D177): a list between brackets, a record between braces, or a
   * document. A literal in it stays its data.
   */
  private data(): Json {
    this.skip();
    const start = this.pos;
    const c = this.text[start];
    if (c !== "[" && c !== "{") return this.bound();
    this.depth += 1;
    if (this.depth > this.syn.maxDepth) this.stop(`The text is deeper than ${String(this.syn.maxDepth)} levels.`, start, 0);
    const value = c === "[" ? this.argumentsOf(() => this.data(), "]") : this.entries(undefined, true);
    this.depth -= 1;
    return value;
  }

  /**
   * This method reads the entries `key: expr` into a record: the arguments of a form `named` (SYNTAX.RECORD), the
   * entries between braces without a form (SYNTAX.RECORD-TEXT), or a record of data (D177).
   */
  private entries(form: Form | undefined, data = false): Record<string, Json> {
    const owner = data ? "record of data" : form === undefined ? "record" : `form ${form.name}`;
    const value: Record<string, Json> = {};
    const entry = (): void => {
      this.skip();
      const at = this.pos;
      const key = this.key();
      const end = this.pos;
      this.skip();
      if (key === undefined || this.text[this.pos] !== ":") {
        this.stop(`Each ${form === undefined ? "entry" : "argument"} of the ${owner} is a key, a ":" and a document.`, at, Math.max(end - at, this.tokenLength()));
      }
      if (form?.fields !== undefined && !form.fields.includes(key)) this.stop(`The form ${form.name} has no field ${key}.`, at, end - at);
      if (data && key === "type") this.stop("A record of data has no key type, because the key type makes a document.", at, end - at);
      if (Object.hasOwn(value, key)) this.stop(`The ${owner} has the field ${key} two times.`, at, end - at);
      this.pos += 1;
      const arg = data || form?.data.has(key) === true ? this.data() : this.bound();
      setOwn(value, key, form !== undefined && wraps(form, key) ? envelop(this.syn, arg) : arg);
    };
    this.argumentsOf(entry, form === undefined ? "}" : ")");
    return value;
  }

  private call(name: string, start: number, nameLength: number): Json {
    const form = this.syn.forms.get(name);
    if (form?.args === "named") return opDoc(form, this.entries(form));
    let index = 0;
    const args = this.argumentsOf(() => {
      const key = form?.fields?.[index];
      index += 1;
      return key !== undefined && form?.data.has(key) === true ? this.data() : this.bound();
    });
    if (form?.args === "literal") {
      const [only] = args;
      if (args.length !== 1 || !isScalar(only)) this.stop(`The form ${name} takes one literal that JSON writes.`, start, this.pos - start);
      return opDoc(form, form.domain === undefined ? only : { domain: form.domain, data: only });
    }
    if (form !== undefined) {
      const most = form.fields?.length ?? Number.POSITIVE_INFINITY;
      if (args.length < form.min || args.length > most) {
        const range = most === form.min ? String(most) : most === Number.POSITIVE_INFINITY ? `${String(form.min)} or more` : `${String(form.min)} to ${String(most)}`;
        this.stop(`The form ${name} takes ${range} arguments.`, start, this.pos - start);
      }
      if (form.fields === undefined) return opDoc(form, form.wrap === true ? args.map((arg) => envelop(this.syn, arg)) : args);
      const value: Record<string, Json> = {};
      args.forEach((arg, index) => {
        const key = form.fields?.[index] as string;
        value[key] = wraps(form, key) ? envelop(this.syn, arg) : arg;
      });
      return opDoc(form, value);
    }
    if (this.syn.ops !== true && !this.syn.ops.has(name)) this.stop(`This syntax has no function ${name}.`, start, nameLength);
    return { type: ["ops", ...name.split(".")], value: args };
  }
}

// === Recovery after the first issue (D138) ===

/** The end of a recovery. The class `Recovery` throws it, and its method `run` catches it. */
class End {}

function hasBraces(syn: Compiled): boolean {
  return syn.constructs.record !== undefined || syn.constructs.let !== undefined || syn.brackets;
}

/** This function gives the name of a closer in a message. */
function closerName(close: string): string {
  return close === ")" ? "parenthesis" : close === "]" ? "bracket" : "brace";
}

/** This function gives the closer of an opening bracket of a profile, or `undefined` for each other character. */
function closerOf(syn: Compiled, c: string | undefined): string | undefined {
  if (c === "(") return ")";
  if (c === "[" && syn.brackets) return "]";
  return c === "{" && hasBraces(syn) ? "}" : undefined;
}

function isCloser(syn: Compiled, c: string | undefined): boolean {
  return c === ")" || (c === "]" && syn.brackets) || (c === "}" && hasBraces(syn));
}

/** This function gives the position after a quoted text at `at`, or after one other character. An open quote gives `Infinity`. */
function pastToken(syn: Compiled, text: string, at: number): number {
  const c = text[at];
  if (c !== syn.quote && c !== "`") return at + 1;
  for (let end = at + 1; end < text.length; end += 1) {
    if (text[end] === "\\" && c === syn.quote && !syn.doubled) end += 1;
    else if (text[end] === c) return end + 1;
  }
  return Number.POSITIVE_INFINITY;
}

/** This function tells if each quote of a text closes, and each bracket closes in the order of the brackets. */
function balanced(syn: Compiled, text: string): boolean {
  const open: (string | undefined)[] = [];
  let at = 0;
  while (at < text.length) {
    const c = text[at];
    const closer = closerOf(syn, c);
    if (closer !== undefined) open.push(closer);
    else if (isCloser(syn, c) && open.pop() !== c) return false;
    at = pastToken(syn, text, at);
  }
  return at === text.length && open.length === 0;
}

/**
 * This parser reads a text again after its first issue and collects the later issues (SYNTAX.ISSUES-SYNC). A fault in
 * a group or in a list moves the position to a synchronising token of that bracket. The first read has no part of
 * this class, thus a valid text does not pay for it.
 */
class Recovery extends Parser {
  private readonly issues: SyntaxIssue[];
  /** The offset of the token after the last synchronising token. An issue at this token can be a result of the fault. */
  private quiet = -1;

  constructor(syn: Compiled, text: string, issues: SyntaxIssue[]) {
    super(syn, text);
    this.issues = issues;
  }

  /** This method reads the text and gives the issues. An error of a host in the later text ends the read. */
  run(): readonly SyntaxIssue[] {
    try {
      this.parse();
    } catch (error) {
      if (error instanceof Stop) this.note(error.issue);
    }
    return this.issues;
  }

  /** An item at the offset of the item before tells that no step moved forward, thus the read ends (SYNTAX.ISSUES-BOUND). */
  protected override argumentsOf<T>(item: () => T, close = ")"): T[] {
    let last = -1;
    return super.argumentsOf(() => {
      if (this.pos === last) throw new End();
      last = this.pos;
      return this.attempt(item, close, true);
    }, close);
  }

  protected override group(): Json {
    this.pos += 1;
    const inner = this.attempt(() => this.bound(), ")", false);
    this.pos += 1;
    return inner;
  }

  /** A bad escape stays inside its text, thus the read continues after the escape. */
  protected override escape(): string {
    try {
      return super.escape();
    } catch (error) {
      this.note((error as Stop).issue);
      this.pos += 2;
      return "";
    }
  }

  /**
   * This method reads one item of a bracket. A fault moves to the next synchronising token, and the item is then `null`.
   * A colon in a list tells that the name of a form has a fault, thus the method skips the other items of the list. A
   * separator in a group tells that a function has a fault, thus the fault also ends the item around the group.
   */
  private attempt<T>(item: () => T, close: string, list: boolean): T {
    const depth = this.depth;
    try {
      const made = item();
      this.skip();
      if (this.text[this.pos] !== close && !(list && this.atSeparator())) this.noEnd(close, list);
      return made;
    } catch (error) {
      if (!(error instanceof Stop)) throw error;
      this.depth = depth;
      this.note(error.issue);
      const tuple = !list && this.atSeparator();
      this.sync(close, list && this.text[this.pos] !== ":");
      if (tuple) {
        this.pos += 1;
        throw error;
      }
      return null as T;
    }
  }

  private atSeparator(): boolean {
    return this.text.startsWith(this.syn.separator, this.pos);
  }

  /**
   * This method keeps a later issue (SYNTAX.ISSUES-CASCADE). The offsets rise, because an issue that starts at or before
   * the last issue can come from the removed text. The count of the arguments of a form is an example. An issue at the
   * first token after a synchronising token can come from the same fault, for example a comma inside a number.
   */
  private note(issue: SyntaxIssue): void {
    const last = this.issues[this.issues.length - 1] as SyntaxIssue;
    if (issue.offset > last.offset && issue.offset !== this.quiet && this.issues.length < MAX_SYNTAX_ISSUES) this.issues.push(issue);
  }

  /** This method moves to the closer `close` of the bracket, or to a separator of a list, and skips each inner bracket. */
  private sync(close: string, list: boolean): void {
    if (this.issues.length >= MAX_SYNTAX_ISSUES) throw new End();
    let depth = 0;
    while (this.pos < this.text.length) {
      const at = this.pos;
      const c = this.text[at];
      if (depth === 0 && (c === close || (list && this.atSeparator()))) {
        this.pos += c === close ? 1 : this.syn.separator.length;
        this.skip();
        this.quiet = this.pos;
        this.pos = at;
        return;
      }
      if (closerOf(this.syn, c) !== undefined) depth += 1;
      else if (isCloser(this.syn, c)) depth -= 1;
      this.pos = pastToken(this.syn, this.text, at);
    }
    throw new End();
  }
}

/**
 * This function gives each issue of a bad text, with the issue of the first read as the first issue (SYNTAX.ISSUES-FIRST).
 * Open quotes or brackets make each synchronising token unsure, thus such a text keeps only the first issue.
 */
function issuesOf(syn: Compiled, text: string, first: SyntaxIssue): readonly SyntaxIssue[] {
  return balanced(syn, text) ? new Recovery(syn, text, [first]).run() : [first];
}

/**
 * This function reads a text into a document with the rules of a profile (SYNTAX.PARSE). It does not throw for a
 * bad text. Each issue gives the offset, the length and a message (SYNTAX.SPAN). The field `issues` gives at most
 * `MAX_SYNTAX_ISSUES` issues (SYNTAX.ISSUES-ALL). A host that reads the first issue reads the first fault of the text.
 *
 * @param profile - The syntax profile.
 * @param text - The text.
 * @returns The document, or the issues of the text.
 * @throws {TypeError} The profile is not valid, for example an operator has two entries of the same place.
 */
export function parse(profile: SyntaxProfile, text: string): ParseResult {
  const syn = compileProfile(profile);
  const parser = new Parser(syn, text);
  try {
    return { ok: true, doc: parser.parse() };
  } catch (error) {
    if (error instanceof Stop) return { ok: false, issues: issuesOf(syn, text, error.issue) };
    if (isStackOverflow(error)) return { ok: false, issues: [{ offset: parser.position(), length: 0, message: "The text is too deep for the stack of the host." }] };
    throw error;
  }
}

// === Print ===

/**
 * The text of a part, from its document and its path in the value of the parent. `wrapped` is `true` when the place
 * of the part takes a document (K159).
 */
type SubText = (child: unknown, path: readonly Key[], wrapped?: boolean) => Result<string>;

type Shape =
  | { readonly tag: "text"; readonly text: string }
  | { readonly tag: "op"; readonly op: Op; readonly terms: readonly unknown[] }
  | { readonly tag: "call"; readonly name: string; readonly args: readonly (readonly [Key, unknown, boolean?, boolean?])[]; readonly named?: boolean }
  | { readonly tag: "path"; readonly segments: readonly (string | readonly [Key, unknown])[] }
  | { readonly tag: "bind"; readonly name: string; readonly doc: unknown }
  | ConstructShape
  | { readonly tag: "none"; readonly reason: string };

/** The shape of a construct form (K145). The tag `apply` is a call of a value. */
type ConstructShape =
  | { readonly tag: "record"; readonly entries: JsonRecord }
  | { readonly tag: "let"; readonly bind: JsonRecord; readonly body: unknown }
  | { readonly tag: "fn"; readonly params: readonly string[]; readonly body: unknown }
  | { readonly tag: "apply"; readonly target: unknown; readonly args: readonly unknown[] };

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

/** This function gives the text of a later step of a path, or the step and its index when the step is a document. */
function laterSegment(step: unknown, index: number): string | readonly [Key, unknown] | undefined {
  if (typeof step === "string") return NAME.test(step) ? step : quoteName(step);
  if (isEnvelope(step)) return [index, step];
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
  let first: string | undefined;
  let tail: (string | readonly [Key, unknown] | undefined)[] = [];
  if (root === syn.bare && typeof rest[0] === "string") {
    first = plainSegment(syn, rest[0]) ? rest[0] : quoteName(rest[0]);
    tail = rest.slice(1).map((step, index) => laterSegment(step, index + 2));
  } else if (typeof root === "string" && syn.roots.has(root) && !syn.patterns.some((p) => p.whole.test(root))) {
    first = root;
    tail = rest.map((step, index) => laterSegment(step, index + 1));
  }
  if (first === undefined || tail.includes(undefined)) return none("This syntax has no text for the path of the reference.");
  const segments = [first, ...(tail as (string | readonly [Key, unknown])[])];
  return segments.every((segment) => typeof segment === "string") ? { tag: "text", text: segments.join(".") } : { tag: "path", segments };
}

function callName(syn: Compiled, keys: readonly Key[]): string | undefined {
  if (keys.length === 0 || !keys.every((key) => typeof key === "string" && NAME.test(key))) return undefined;
  // `parse` reads the dots of a call name as field steps, thus a profile without them has no such text (D142).
  if (keys.length > 1 && !syn.fields) return undefined;
  const name = keys.join(".");
  if (syn.forms.has(name) || syn.opWords.has(keys[0] as string)) return undefined;
  return syn.ops === true || syn.ops.has(name) ? name : undefined;
}

const WRAPPED = "This syntax reads a literal in this place as its data envelope, thus a bare literal has no text here.";

/**
 * This function gives the text of a document in a place that takes a document (K159). A data envelope of a literal
 * is the bare literal. A literal without its envelope has no text, because `parse` gives it the envelope. The
 * function gives `undefined` for each other document.
 */
function wrappedShape(syn: Compiled, doc: unknown): Shape | undefined {
  if (syn.envelopes === undefined) return undefined;
  if (!isEnvelope(doc)) return envelopeOf(syn, doc) === undefined ? undefined : none(WRAPPED);
  if (doc.name !== undefined || doc.own !== undefined || !Object.hasOwn(doc, "value")) return undefined;
  const path = typePath(doc.type);
  if (path === undefined) return undefined;
  const key = JSON.stringify(path);
  if (key === JSON.stringify(["lit"])) return envelopeOf(syn, doc.value) === undefined ? undefined : none(WRAPPED);
  if (envelopeOf(syn, doc.value)?.key !== key) return undefined;
  const literal = literalShape(syn, doc.value);
  return literal.tag === "text" ? literal : undefined;
}

/** This function tells if a value of `ext.domain` is a record with this domain and its data, and no other key. */
function holdsDomain(value: unknown, domain: string): boolean {
  return isRecord(value) && value["domain"] === domain && Object.hasOwn(value, "data") && Object.keys(value).length === 2;
}

function formShape(syn: Compiled, form: Form, value: unknown): Shape | undefined {
  if (form.args === "literal") {
    if (form.domain !== undefined && !holdsDomain(value, form.domain)) return undefined;
    const data = form.domain === undefined ? value : (value as Readonly<Record<string, unknown>>)["data"];
    if (!isScalar(data)) return undefined;
    const literal = literalShape(syn, data);
    return literal.tag === "text" ? { tag: "text", text: `${form.name}(${literal.text})` } : undefined;
  }
  if (form.args === "named") {
    if (!isRecord(value)) return undefined;
    const keys = Object.keys(value);
    if (form.fields !== undefined && !keys.every((key) => form.fields?.includes(key) === true)) return undefined;
    return { tag: "call", name: form.name, args: keys.map((key) => [key, value[key], wraps(form, key), form.data.has(key)] as const), named: true };
  }
  if (form.fields === undefined) {
    if (!Array.isArray(value) || value.length < form.min) return undefined;
    return { tag: "call", name: form.name, args: value.map((item, index) => [index, item, wraps(form, index)] as const) };
  }
  if (!isRecord(value)) return undefined;
  // The fields that the value holds must be the first fields of the form, because the arguments go in order.
  const count = Object.keys(value).length;
  const present = form.fields.slice(0, count);
  if (count < form.min || present.length < count || !present.every((key) => Object.hasOwn(value, key))) return undefined;
  return { tag: "call", name: form.name, args: present.map((key) => [key, value[key], wraps(form, key), form.data.has(key)] as const) };
}

/** This function tells if a record has exactly these two keys. */
function hasKeys(value: JsonRecord, first: string, second: string): boolean {
  return Object.keys(value).length === 2 && Object.hasOwn(value, first) && Object.hasOwn(value, second);
}

/** This function gives the shape of a construct, or `undefined` when its form does not write the value. */
function constructShape(construct: keyof SyntaxConstructs, value: unknown): ConstructShape | undefined {
  if (!isRecord(value)) return undefined;
  if (construct === "record") return { tag: "record", entries: value };
  const { bind, params, args } = value;
  if (construct === "let") return hasKeys(value, "bind", "body") && isRecord(bind) ? { tag: "let", bind, body: value["body"] } : undefined;
  if (construct === "fn") {
    const names = Array.isArray(params) && params.every((param) => typeof param === "string") ? (params as readonly string[]) : undefined;
    return hasKeys(value, "params", "body") && names !== undefined ? { tag: "fn", params: names, body: value["body"] } : undefined;
  }
  return hasKeys(value, "fn", "args") && Array.isArray(args) ? { tag: "apply", target: value["fn"], args } : undefined;
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
  if (doc.own !== undefined) return none("This syntax has no text for the own entries of a document.");
  if (doc.name !== undefined) {
    if (syn.bind === undefined) return none("This syntax has no text for the name of a document.");
    const { name, ...rest } = doc;
    return { tag: "bind", name, doc: rest };
  }
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
    const shape = formShape(syn, form, value);
    if (shape !== undefined) return shape;
  }
  const construct = syn.constructKinds.get(key);
  const written = construct === undefined ? undefined : constructShape(construct, value);
  if (written !== undefined) return written;
  const called = path[0] === "ops" && Array.isArray(value) ? callName(syn, path.slice(1)) : undefined;
  if (called !== undefined) return { tag: "call", name: called, args: (value as readonly unknown[]).map((item, index) => [index, item] as const) };
  return none(`This syntax has no text for the kind ${name}.`);
}

function levelOf(syn: Compiled, doc: unknown): number {
  const shape = shapeOf(syn, doc);
  // A document with a name binds more loosely than each operator, thus it needs parentheses as a term. The body of a
  // let or a function goes as far as it can, thus these forms need parentheses too (D127).
  if (shape.tag === "bind" || shape.tag === "let" || shape.tag === "fn") return Number.NEGATIVE_INFINITY;
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

function keyText(key: string): string {
  return NAME.test(key) ? key : quoteName(key);
}

/** This function gives the text of each part. `path` is the place of the parts in the value of their document. */
function partTexts(parts: readonly (readonly [Key, unknown])[], path: readonly Key[], sub: SubText): Result<readonly string[]> {
  const texts: string[] = [];
  for (const [key, part] of parts) {
    const result = sub(part, [...path, key]);
    if (!result.ok) return result;
    texts.push(result.value);
  }
  return ok(texts);
}

/** This function writes a record between braces. `path` is the place of the record in the value of its document. */
function bracesText(syn: Compiled, record: JsonRecord, path: readonly Key[], sub: SubText): Result<string> {
  const keys = Object.keys(record);
  const texts = partTexts(keys.map((key) => [key, record[key]] as const), path, sub);
  if (!texts.ok) return texts;
  return ok(`{${texts.value.map((text, index) => `${keyText(keys[index] as string)}: ${text}`).join(`${syn.separator} `)}}`);
}

/**
 * This function writes the argument of a field of data (D177): a list between brackets, a record between braces, or
 * a literal or a document by `sub`. A record that is an envelope is a document.
 */
function dataText(syn: Compiled, value: unknown, path: readonly Key[], sub: SubText): Result<string> {
  const each: SubText = (child, at) => dataText(syn, child, at, sub);
  if (Array.isArray(value)) {
    const texts = partTexts(value.map((item, index) => [index, item] as const), path, each);
    return texts.ok ? ok(`[${texts.value.join(`${syn.separator} `)}]`) : texts;
  }
  return isRecord(value) && !isEnvelope(value) ? bracesText(syn, value, path, each) : sub(value, path);
}

/** This function writes a construct form (K145). */
function constructText(syn: Compiled, shape: ConstructShape, sub: SubText): Result<string> {
  if (shape.tag === "record") return bracesText(syn, shape.entries, [], sub);
  if (shape.tag === "apply") {
    const target = sub(shape.target, ["fn"]);
    if (!target.ok) return target;
    const args = partTexts(shape.args.map((arg, index) => [index, arg] as const), ["args"], sub);
    if (!args.ok) return args;
    // A call of a value follows a group, or another call of a value.
    const head = shapeOf(syn, shape.target).tag === "apply" ? target.value : `(${target.value})`;
    return ok(`${head}(${args.value.join(`${syn.separator} `)})`);
  }
  const head = shape.tag === "fn" ? ok(`(${shape.params.map(keyText).join(`${syn.separator} `)}) =>`) : bracesText(syn, shape.bind, ["bind"], sub);
  if (!head.ok) return head;
  const body = sub(shape.body, ["body"]);
  if (!body.ok) return body;
  return ok(shape.tag === "fn" ? `${head.value} ${body.value}` : `let ${head.value} in ${body.value}`);
}

/** This function writes one document. `sub` gives the text of each part. */
function printNode(syn: Compiled, doc: unknown, sub: SubText): Result<string> {
  const shape = shapeOf(syn, doc);
  if (shape.tag === "text") return ok(shape.text);
  if (shape.tag === "none") return fail("#VALUE!", shape.reason);
  if (shape.tag === "op") return opText(syn, shape.op, shape.terms, sub);
  if (shape.tag === "record" || shape.tag === "let" || shape.tag === "fn" || shape.tag === "apply") return constructText(syn, shape, sub);
  if (shape.tag === "bind") {
    // The document after a header name takes a document, thus a data envelope of a literal is the bare literal (K159).
    const head = wrappedShape(syn, shape.doc);
    const inner = head === undefined ? printNode(syn, shape.doc, sub) : head.tag === "text" ? ok(head.text) : fail("#VALUE!", WRAPPED);
    return inner.ok ? ok(`${keyText(shape.name)} ${syn.bind as string} ${inner.value}`) : inner;
  }
  if (shape.tag === "path") {
    const texts: string[] = [];
    for (const segment of shape.segments) {
      if (typeof segment === "string") {
        texts.push(segment);
        continue;
      }
      const result = sub(segment[1], [segment[0]]);
      if (!result.ok) return result;
      texts.push(`(${result.value})`);
    }
    return ok(texts.join("."));
  }
  const texts: string[] = [];
  for (const [key, arg, wrapped, data] of shape.args) {
    const result = data === true ? dataText(syn, arg, [key], sub) : sub(arg, [key], wrapped);
    if (!result.ok) return result;
    texts.push(shape.named === true ? `${keyText(String(key))}: ${result.value}` : result.value);
  }
  return ok(`${shape.name}(${texts.join(`${syn.separator} `)})`);
}

function printTree(syn: Compiled, doc: unknown, place: readonly Key[]): Result<string> {
  const result = printNode(syn, doc, (child, path, wrapped) => (wrapped === true ? printPlace : printTree)(syn, child, [...place, ...path]));
  return result.ok || result.error.place !== undefined ? result : fail(result.error.code, result.error.reason, { place });
}

/** This function writes a document in a place that takes a document, for example the whole text (K159). */
function printPlace(syn: Compiled, doc: unknown, place: readonly Key[]): Result<string> {
  const shape = wrappedShape(syn, doc);
  if (shape === undefined) return printTree(syn, doc, place);
  return shape.tag === "text" ? ok(shape.text) : fail("#VALUE!", WRAPPED, { place });
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
    return printPlace(syn, doc, []);
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
    return printNode(syn, doc, (child, path, wrapped) => {
      const own = wrapped === true ? wrappedShape(syn, child) : undefined;
      if (own !== undefined) return own.tag === "text" ? ok(own.text) : fail("#VALUE!", WRAPPED, { place: [...place, ...path] });
      const part = byPath.get(JSON.stringify(path));
      if (part === undefined) return printTree(syn, child, [...place, ...path]);
      const result = part.evaluate();
      if (!result.ok) return result;
      return typeof result.value === "string" ? ok(result.value) : fail("#VALUE!", `The verb format of a part gave ${describe(result.value)}, not a text.`, { place: [...place, ...path] });
    });
  };
  return { world: { defaults: { format: "syntax.format" } }, evaluators: { "syntax.format": code } };
}

// === The check of a profile ===

/**
 * The name of a finding of `checkSyntax` (D140). Each name holds a rule of the parser or the printer.
 *
 * - `invalid`: `parse` throws a `TypeError` for the profile. The reason is its message.
 * - `operator`: the document of one operator does not come back. A negative precedence stops an infix operator,
 *   because an expression starts at the precedence `0`. The kinds `ref`, `lit` and `ext.number` have their own text.
 * - `grouping`: an operator with a second operator in a term does not come back. The parser reads a term from the
 *   precedence plus `1`, and the printer compares precedences, thus a gap under `1` loses the tree. A postfix operator
 *   at the precedence of a `right` infix operator loses it too.
 * - `longest-match`: the printer writes two postfix operators without a space, and a longer symbol reads their text.
 * - `word`: a word of `literals.words` does not read as its value. A word operator reads first, and a word that is
 *   not a plain name has no token.
 * - `root`: a root does not come back. A word operator reads first, and a literal word reads a root without steps.
 * - `pattern`: a pattern of references reads a text that has another meaning, because the parser tries patterns first.
 * - `form`: the document of a call form does not come back. A word operator reads first, the last form of a name
 *   hides the others, and a `min` above the fields permits no text.
 * - `call`: a name of `calls.ops` does not come back. A form of the name wins, a word operator reads first, and a name
 *   with dots needs the field steps.
 * - `separator`: the separator does not end an argument, and a neutral separator keeps the same document. An operator
 *   reads first, the parser skips a space before it, or a name or a bracket at its start changes the term.
 * - `construct`: the document of a construct form does not come back, for example two forms have one kind.
 */
export type SyntaxFindingCode = "invalid" | "operator" | "grouping" | "longest-match" | "word" | "root" | "pattern" | "form" | "call" | "separator" | "construct";

/** One fault of a syntax profile: its name, its place in the profile and the reason (D140). */
export interface SyntaxFinding {
  /** The name of the fault. */
  readonly code: SyntaxFindingCode;
  /** The keys from the root of the profile to the entry, for example `["operators", 3]`. A default list has keys too. */
  readonly place: readonly Key[];
  /** The rule that the entry breaks, and the text that shows it. */
  readonly reason: string;
}

/** The state of one check: the profile, its compiled form, a leaf document and the two functions that record a fault. */
interface ProfileCheck {
  readonly profile: SyntaxProfile;
  readonly syn: Compiled;
  readonly leaf: Json;
  /** This function adds a finding. A pattern that reads the start of `text` takes the code and the place. */
  readonly report: (code: SyntaxFindingCode, place: readonly Key[], text: string, reason: string) => void;
  /** This function reports a document that breaks the law, and it tells if the law holds. `start` stands for a refused text. */
  readonly keeps: (code: SyntaxFindingCode, place: readonly Key[], rule: string, doc: Json, start?: string) => boolean;
}

/** This function tells how a document breaks `parse(print(doc))`. It gives `undefined` when the document comes back. */
function lawBreak(profile: SyntaxProfile, doc: Json): { readonly text: string | undefined; readonly why: string } | undefined {
  const printed = print(profile, doc);
  if (!printed.ok) return { text: undefined, why: printed.error.reason };
  const text = printed.value;
  const back = parse(profile, text);
  if (back.ok) return docEquals(back.doc, doc) ? undefined : { text, why: `The text ${text} reads as ${JSON.stringify(back.doc)}.` };
  return { text, why: `The text ${text} gives the issue: ${back.issues[0]?.message ?? ""}` };
}

/** This function gives the index of the first pattern that `parse` uses at the start of a text, or `-1`. */
function patternAt(syn: Compiled, text: string): number {
  return syn.patterns.findIndex(({ sticky }) => {
    sticky.lastIndex = 0;
    const match = sticky.exec(text)?.[0];
    return match !== undefined && match !== "" && !/[A-Za-z0-9_$(]/.test(text[match.length] ?? "");
  });
}

/** This function gives each small document of an operator with `term` in one term. A `flat` operator also has three terms. */
function operatorDocs(op: Op, term: Json, leaf: Json): readonly Json[] {
  if (op.fixity !== "infix") return [opDoc(op, [term])];
  const pairs = [[term, leaf], [leaf, term]];
  return (op.assoc === "flat" ? [...pairs, [term, leaf, leaf], [leaf, term, leaf]] : pairs).map((terms) => opDoc(op, terms));
}

/** This function gives the longer symbol that reads two postfix operators without a space, or `undefined`. */
function gluedSymbol(syn: Compiled, outer: Op, inner: Op): string | undefined {
  if (outer.word || inner.word || outer.fixity !== "postfix" || inner.fixity !== "postfix") return undefined;
  const glued = inner.symbol + outer.symbol;
  const read = syn.binarySymbols.find((symbol) => glued.startsWith(symbol));
  return read === inner.symbol ? undefined : read;
}

function checkOperators({ profile, syn, leaf, keeps }: ProfileCheck): void {
  const ops = (profile.operators ?? []).map((given) => (given.fixity === "prefix" ? syn.prefix : syn.binary).get(given.symbol) as Op);
  const sound = ops.filter((op, index) => operatorDocs(op, leaf, leaf).every((doc) => keeps("operator", ["operators", index], `The operator ${op.symbol} does not come back.`, doc)));
  for (const outer of sound) {
    const place = ["operators", ops.indexOf(outer)];
    for (const inner of sound) {
      const glued = gluedSymbol(syn, outer, inner);
      const code = glued === undefined ? "grouping" : "longest-match";
      const rule = glued === undefined ? `The operator ${outer.symbol} with ${inner.symbol} in a term loses the tree.` : `The symbol ${glued} reads the postfix operators ${inner.symbol} and ${outer.symbol}.`;
      for (const term of operatorDocs(inner, leaf, leaf)) for (const doc of operatorDocs(outer, term, leaf)) keeps(code, place, rule, doc);
    }
  }
}

function checkLiterals({ profile, syn, report }: ProfileCheck): void {
  for (const [word, value] of syn.words) {
    const back = parse(profile, word);
    if (!back.ok || !docEquals(back.doc, envelop(syn, literalDoc(value)))) report("word", ["literals", "words", word], word, `The word ${word} does not read as its value.`);
  }
  for (const value of [0, -1, "a"]) {
    const shape = literalShape(syn, value);
    if (shape.tag === "text" && patternAt(syn, shape.text) >= 0) report("pattern", [], shape.text, `The literal ${shape.text} reads as a reference.`);
  }
}

function checkRoots({ profile, syn, keeps }: ProfileCheck): void {
  (profile.refs?.roots ?? DEFAULT_ROOTS).forEach((root, index) => {
    for (const path of syn.fields ? [[root], [root, "x"]] : [[root]]) {
      keeps("root", ["refs", "roots", index], `The root ${root} does not come back.`, { type: "ref", value: path }, path.join("."));
    }
  });
}

/** This function gives a value that a call form writes: the fewest arguments, and at least one. */
function formValue(given: SyntaxForm, leaf: Json): Json {
  const args = given.args ?? (given.fields === undefined ? "list" : "fields");
  const least = Math.max(given.min ?? given.fields?.length ?? 0, 1);
  if (args === "literal") return 1;
  if (args === "list") return Array.from({ length: least }, () => leaf);
  const keys = (given.fields ?? ["x"]).slice(0, args === "named" ? 1 : least);
  return Object.fromEntries(keys.map((key) => [key, leaf]));
}

function checkCalls({ profile, syn, leaf, keeps }: ProfileCheck): void {
  const calls = profile.calls ?? {};
  (calls.forms ?? []).forEach((form, index) => {
    keeps("form", ["calls", "forms", index], `The form ${form.name} does not come back.`, { type: typeOfKind(form.kind).type, value: formValue(form, leaf) });
  });
  // The dotted text of a call name needs the field steps. A profile with `ops: true` and no field steps has no dotted call.
  if (syn.ops === true && syn.fields) keeps("call", ["calls", "ops"], "A call name with a dot does not come back.", { type: ["ops", "m", "p"], value: [leaf] });
  if (typeof calls.ops === "boolean" || calls.ops === undefined) return;
  calls.ops.forEach((name, index) => {
    keeps("call", ["calls", "ops", index], `The call ${name} does not come back.`, { type: ["ops", ...name.split(".")], value: [leaf] });
  });
}

/** This function writes two terms with the separator. It blames the separator only when a neutral separator keeps the document. */
function checkSeparator({ profile, syn, leaf, report }: ProfileCheck): void {
  if (syn.ops !== true && syn.ops.size === 0 && syn.forms.size === 0 && syn.constructKinds.size === 0) return;
  const open: SyntaxProfile = { ...profile, calls: { ...profile.calls, ops: true } };
  const neutral: SyntaxProfile = { ...profile, calls: { ...open.calls, separator: "\u0001" } };
  const postfix = [...syn.binary.values()].filter((op) => op.fixity === "postfix").map((op) => opDoc(op, [leaf]));
  const terms: Json[] = [leaf, { type: "ref", value: [syn.bare, "b c"] }, "a", 1, ...postfix];
  const docs = terms.map((term): Json => ({ type: ["ops", "probe__"], value: [term, leaf] }));
  const entries = { x: leaf, y: leaf };
  const { record, let: bind } = syn.constructs;
  if (record !== undefined) docs.push({ type: record, value: entries });
  if (bind !== undefined) docs.push({ type: bind, value: { bind: entries, body: leaf } });
  for (const doc of docs) {
    const broken = lawBreak(neutral, doc) === undefined ? lawBreak(open, doc) : undefined;
    if (broken !== undefined) report("separator", ["calls", "separator"], "", `The separator "${syn.separator}" does not end an argument. ${broken.why}`);
  }
}

function checkConstructs({ syn, leaf, keeps }: ProfileCheck): void {
  const entries = { x: leaf };
  const values: Readonly<Record<keyof SyntaxConstructs, Json>> = { record: entries, let: { bind: entries, body: leaf }, fn: { params: ["x"], body: leaf }, call: { fn: leaf, args: [leaf] } };
  for (const name of CONSTRUCTS) {
    const type = syn.constructs[name];
    if (type !== undefined) keeps("construct", ["constructs", name], `The form ${name} does not come back.`, { type, value: values[name] });
  }
}

/**
 * This function finds the faults of a syntax profile before a host uses it (SYNTAX.PROFILE-CHECK, D140). A fault is a
 * document of an entry that breaks `parse(print(doc))`, or a text of an entry that reads another way. The function
 * writes and reads one small document for each entry, for each pair of operators and for each root. Thus an empty list
 * tells that these small documents come back. It does not prove the law for each document. `parse` and `print` do not
 * call this function, thus it adds no cost to them.
 *
 * @param profile - The syntax profile.
 * @returns At most one finding for each code and place, in the order of the operators, the literals, the references, the calls and the constructs.
 * @throws An error of a `read` or a `write` function of a pattern.
 */
export function checkSyntax(profile: SyntaxProfile): readonly SyntaxFinding[] {
  // A small `maxDepth` is a limit that the host chose, not a fault, thus each probe has the default limit.
  const open: SyntaxProfile = { ...profile, maxDepth: 256 };
  let syn: Compiled;
  try {
    syn = compileProfile(open);
  } catch (error) {
    if (error instanceof TypeError) return [{ code: "invalid", place: [], reason: error.message }];
    throw error;
  }
  const found = new Map<string, SyntaxFinding>();
  const report: ProfileCheck["report"] = (code, place, text, reason) => {
    const index = patternAt(syn, text);
    const finding: SyntaxFinding = index < 0 ? { code, place, reason } : { code: "pattern", place: ["refs", "patterns", index], reason: `The pattern reads the start of the text ${text}. ${reason}` };
    const key = JSON.stringify([finding.code, finding.place]);
    if (!found.has(key)) found.set(key, finding);
  };
  const keeps: ProfileCheck["keeps"] = (code, place, rule, doc, start = "") => {
    const broken = lawBreak(open, doc);
    if (broken !== undefined) report(code, place, broken.text ?? start, `${rule} ${broken.why}`);
    return broken === undefined;
  };
  const check: ProfileCheck = { profile: open, syn, leaf: { type: "ref", value: [syn.bare, "a"] }, report, keeps };
  checkOperators(check);
  checkLiterals(check);
  checkRoots(check);
  checkCalls(check);
  checkSeparator(check);
  checkConstructs(check);
  return [...found.values()];
}
