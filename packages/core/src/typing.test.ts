import { describe, expect, it } from "vitest";
import {
  type CompiledEvaluator,
  type CompiledPart,
  type Domain,
  type FormulaProfile,
  type GenerateOptions,
  type Issue,
  type Json,
  type Key,
  type Machine,
  type OpFn,
  type Random,
  type RootTypes,
  type Signature,
  type TraceNode,
  type TypeRule,
  type ValueType,
  CAPS_TYPE,
  MergeError,
  STD_DOMAINS,
  check,
  context,
  decodeValue,
  encodeValue,
  evaluate,
  extendDomain,
  fail,
  fits,
  formulaEvaluators,
  formulaMachine,
  generate,
  jsTruthy,
  member,
  mergeMachines,
  ok,
  prepare,
  random,
  typeCheck,
  typeFromSamples,
  typeFromSchema,
  typeText,
  typesOf,
} from "./index.ts";

/** The number of documents for each property. CI and a nightly run can raise it with COEVAL_AGREE_COUNT. */
const COUNT = Number(process.env["COEVAL_AGREE_COUNT"] ?? 300);
const SEED = Number(process.env["COEVAL_AGREE_SEED"] ?? 1);

const LIT = { declaredType: "lit" } as const;
const op = (name: string, ...args: Json[]): Json => ({ type: ["ops", ...name.split(".")], value: args });
const ref = (...path: Json[]): Json => ({ type: "ref", value: path });
const fn = (params: readonly string[], body: Json): Json => ({ type: "fn", value: { params: [...params], body } });
const call = (target: Json, ...args: Json[]): Json => ({ type: "call", value: { fn: target, args } });
const when = (test: Json, then: Json, other?: Json): Json => ({ type: "if", value: other === undefined ? { test, then } : { test, then, else: other } });
const bind = (names: Readonly<Record<string, Json>>, body: Json): Json => ({ type: "let", value: { bind: names, body } });

/** The signatures of a small typed language. `len` and `same` have overloads, and `round` has an optional parameter. */
const SIGS: Readonly<Record<string, Signature | readonly Signature[]>> = {
  add: { params: ["number", "number"], to: "number" },
  gt: { params: ["number", "number"], to: "bool" },
  concat: { params: ["text"], rest: "text", to: "text" },
  not: { params: ["bool"], to: "bool" },
  len: [
    { params: ["text"], to: "number" },
    { params: [{ list: "unknown" }], to: "number" },
  ],
  same: [
    { params: ["text"], to: "text" },
    { params: ["number"], to: "number" },
  ],
  pair: { params: ["unknown", "unknown"], to: { list: "unknown" } },
  round: { params: ["number", "unknown"], to: "number" },
  sum: { params: [{ list: "number" }], to: "number" },
  area: { params: [{ record: { w: "number", h: "number" } }], to: "number" },
  apply: { params: [{ fn: ["number"], to: "number" }, "number"], to: "number" },
};

/** The code of each operation. The functions do not test their arguments. */
const CODE: Readonly<Record<string, (...args: never[]) => unknown>> = {
  add: (a: number, b: number) => a + b,
  gt: (a: number, b: number) => a > b,
  concat: (...items: string[]) => items.join(""),
  not: (value: boolean) => !value,
  len: (value: string | readonly unknown[]) => value.length,
  same: (value: unknown) => value,
  pair: (a: unknown, b: unknown) => [a, b],
  round: (value: number) => Math.round(value),
  sum: (items: readonly number[]) => items.reduce((total, item) => total + item, 0),
  area: (box: { readonly w: number; readonly h: number }) => box.w * box.h,
  apply: (target: (value: number) => unknown, value: number) => target(value),
};

/** The operations without a test of their arguments. A type issue does not change what they give. */
const LOOSE_OPS: Readonly<Record<string, OpFn>> = CODE;

/**
 * This function makes an operation that keeps its signatures: it fails for arguments that no signature takes. Thus
 * each value that it gives is a member of the result of a signature that its arguments match (TYPE.SOUND).
 */
function guarded(name: string): OpFn {
  const sigs = [SIGS[name] as Signature | readonly Signature[]].flat();
  const code = CODE[name] as (...args: unknown[]) => unknown;
  return ((...args: unknown[]) => {
    const takes = sigs.some((sig) => sig.params.every((param, index) => member(args[index], param)) && args.slice(sig.params.length).every((arg) => sig.rest !== undefined && member(arg, sig.rest)));
    if (!takes) throw new Error(`No signature of ${name} takes these arguments.`);
    return code(...args);
  }) as OpFn;
}

const GUARDED: Readonly<Record<string, OpFn>> = Object.fromEntries(Object.keys(CODE).map((name) => [name, guarded(name)]));

const TYPED: FormulaProfile = { ops: LOOSE_OPS, sigs: SIGS };
const typed = formulaMachine(TYPED);

/** This function gives the type issues of a check, without the other issues. */
function typeIssuesOf(machine: Machine, doc: unknown, options: Parameters<typeof check>[2] = LIT): readonly Issue[] {
  return check(machine, doc, { ...options, types: true }).filter((issue) => issue.code === "#TYPE!");
}

describe("signatures and the check of types", () => {
  it("[TYPE.SIGNATURE] a signature gives the types of the arguments of an operation, and a wrong argument is an issue at its place", () => {
    const doc = op("concat", "Bulk order: ", op("add", 1, 2));
    expect(typeIssuesOf(typed, doc)).toEqual([
      {
        code: "#TYPE!",
        place: [1],
        reason: "The argument 2 of ops.concat has the type number. It must have the type text.",
        at: ["value", 1],
        expected: "text",
        found: "number",
      },
    ]);
    expect(typeCheck(typed, op("concat", "a", "b", "c"), LIT)).toMatchObject({ type: "text", issues: [] });
    // The number of arguments: too few, too many, a rest parameter and an optional parameter of the type unknown.
    expect(typeIssuesOf(typed, op("add", 1)).map((issue) => [issue.place, issue.reason])).toEqual([[[], "The operation ops.add takes 2 arguments. It gets 1."]]);
    expect(typeIssuesOf(typed, op("not", true, false)).map((issue) => issue.reason)).toEqual(["The operation ops.not takes 1 argument. It gets 2."]);
    expect(typeIssuesOf(typed, op("concat")).map((issue) => issue.reason)).toEqual(["The operation ops.concat takes at least 1 argument. It gets 0."]);
    expect(typeIssuesOf(typed, op("round", 1.5))).toEqual([]);
    expect(typeIssuesOf(typed, op("round", 1.5, "any"))).toEqual([]);
    // A parameter at the end is optional when its type holds undefined, because a missing argument is undefined (D48).
    const pad = formulaMachine({ ops: { pad: (text: unknown, fill: unknown) => `${String(text)}${fill === undefined ? " " : String(fill)}` }, sigs: { pad: { params: ["text", { union: ["text", "undefined"] }], to: "text" } } });
    expect(typeIssuesOf(pad, op("pad", "a"))).toEqual([]);
    expect(typeIssuesOf(pad, op("pad", "a", { type: ["ext", "undefined"], value: null }))).toEqual([]);
    expect(typeIssuesOf(pad, op("pad", "a", 1)).map((issue) => issue.reason)).toEqual(["The argument 2 of ops.pad has the type 1. It must have the type text | undefined."]);
    expect(typeIssuesOf(pad, op("pad")).map((issue) => issue.reason)).toEqual(["The operation ops.pad takes 1 to 2 arguments. It gets 0."]);
    // A list of signatures gives overloads. The first signature that fits gives the type.
    expect(typeCheck(typed, op("len", "abc"), LIT).type).toBe("number");
    expect(typeCheck(typed, op("len", { type: "list", value: [1] }), LIT).type).toBe("number");
    expect(typeCheck(typed, op("same", "a"), LIT).type).toBe("text");
    expect(typeCheck(typed, op("same", 1), LIT).type).toBe("number");
    expect(typeIssuesOf(typed, op("len", 1))).toEqual([
      {
        code: "#TYPE!",
        place: [],
        reason: "No signature of ops.len fits the arguments (1). The signatures are (text) => number and (list<unknown>) => number.",
        at: [],
      },
    ]);
    // An argument of the type unknown fits each overload. When their results differ, the type is unknown.
    expect(typeCheck(typed, fn(["x"], op("same", ref("names", "x"))), LIT).type).toEqual({ fn: ["unknown"], to: "unknown" });
    expect(typeCheck(typed, fn(["x"], op("len", ref("names", "x"))), LIT).type).toEqual({ fn: ["unknown"], to: "number" });
  });

  it("[TYPE.SIGNATURE] a profile can give its signatures as a function, and a bad signature is an issue one time in a check", () => {
    const lookup = formulaMachine({ ops: LOOSE_OPS, sigs: (name) => (name === "add" ? (SIGS["add"] as Signature) : undefined) });
    expect(typeIssuesOf(lookup, op("add", "a", 1)).map((issue) => issue.place)).toEqual([[0]]);
    expect(typeIssuesOf(lookup, op("concat", 1))).toEqual([]);
    const throws = formulaMachine({ ops: LOOSE_OPS, sigs: () => { throw new Error("No table."); } });
    expect(typeIssuesOf(throws, op("add", "a", 1))).toEqual([]);
    // A type of a signature without a domain reads as unknown. The check reports it one time, at its first use.
    const misspelt = formulaMachine({ ops: LOOSE_OPS, sigs: { add: { params: ["nmber", "number"], to: "number" } } });
    const doc = { type: "list", value: [op("add", "a", 1), op("add", "b", 2)] };
    expect(typeIssuesOf(misspelt, doc).map((issue) => [issue.place, issue.reason])).toEqual([
      [[0], "The parameter 1 of a signature of ops.add is not a correct value type. The machine has no domain nmber."],
    ]);
    // A signature without params or to is not read.
    const broken = formulaMachine({ ops: LOOSE_OPS, sigs: { add: { to: "number" } as unknown as Signature } });
    expect(typeIssuesOf(broken, op("add", 1, 2)).map((issue) => issue.reason)).toEqual(["A signature of ops.add is not a record with params and to. The check does not read it."]);
    expect(typeCheck(broken, op("add", 1, 2), LIT).type).toBe("unknown");
  });

  it("[TYPE.SYNTH] each construct of the kit synthesizes the type of its result from the types of its parts", () => {
    const cases: readonly (readonly [Json, ValueType])[] = [
      [1, { one: [1] }],
      [{ type: "lit", value: { type: "x", value: 1 } }, { one: [{ type: "x", value: 1 }] }],
      [{ type: "record", value: { a: 1, b: op("concat", "x") } }, { record: { a: { one: [1] }, b: "text" }, closed: true }],
      [{ type: "list", value: [1, 2, "a"] }, { list: { one: [1, 2, "a"] } }],
      [{ type: "list", value: [] }, { list: "never" }],
      [bind({ n: op("add", 1, 2) }, ref("names", "n")), "number"],
      [bind({ n: 1 }, bind({ n: "a" }, ref("names", "n"))), { one: ["a"] }],
      [fn(["x"], ref("names", "x")), { fn: ["unknown"], to: "unknown" }],
      [call(fn(["x"], op("add", ref("names", "x"), 1)), 2), "number"],
      [bind({ f: fn(["x"], op("concat", ref("names", "x"))) }, call(ref("names", "f"), "a")), "text"],
      [when(op("gt", 1, 2), "a", 1), { one: ["a", 1] }],
      [when(true, op("add", 1, 2)), { union: ["number", "null"] }],
      [{ type: "and", value: [true, op("gt", 1, 2)] }, "bool"],
      [{ type: "or", value: [] }, "bool"],
      [{ type: ["ext", "number"], value: "NaN" }, "number"],
      [{ type: ["ext", "undefined"], value: null }, "undefined"],
      [when(op("gt", 1, 2), 1, { type: ["ext", "undefined"], value: null }), { union: [{ one: [1] }, "undefined"] }],
    ];
    for (const [doc, type] of cases) {
      const typing = typeCheck(typed, doc, LIT);
      expect(typing.issues, JSON.stringify(doc)).toEqual([]);
      expect(typing.type, JSON.stringify(doc)).toEqual(type);
    }
    // A reference to a name of the host or to another root has no type without the types of the host (TYPE.ROOTS).
    for (const path of [["names", "host"], ["self"], ["world", "a"]] as const) {
      expect(typeCheck(typed, bind({ n: { type: "record", value: { a: 1 } } }, ref(...path)), { ...LIT, names: ["host"] }).type).toBe("unknown");
    }
    expect(typeCheck(typed, bind({ n: { type: "record", value: { a: 1 } } }, ref("names", "n", "a")), LIT).type).toEqual({ one: [1] });
    // The type of each place, in the order of the document.
    const places = typeCheck(typed, bind({ n: op("add", 1, 2) }, ref("names", "n")), LIT).places;
    expect(places.map((item) => [item.place, item.type, item.expected])).toEqual([
      [[], "number", undefined],
      [["bind", "n"], "number", undefined],
      [["bind", "n", 0], { one: [1] }, "number"],
      [["bind", "n", 1], { one: [2] }, "number"],
      [["body"], "number", undefined],
    ]);
  });

  it("[TYPE.SYNTH] the profile changes the types: the truth, the logic, otherwise and omit", () => {
    const loose = formulaMachine({ ...TYPED, truthy: jsTruthy, logic: "value", otherwise: "none", omit: (error) => error.code === "#N/A" });
    expect(typeCheck(loose, { type: "and", value: [1, "a"] }, LIT).type).toEqual({ one: [1, "a"] });
    expect(typeCheck(loose, { type: "and", value: [] }, LIT).type).toEqual({ one: [true] });
    expect(typeCheck(loose, { type: "or", value: [] }, LIT).type).toEqual({ one: [false] });
    expect(typeCheck(loose, when(1, "a"), LIT)).toMatchObject({ type: { one: ["a", "none"] }, issues: [] });
    expect(typeCheck(loose, { type: "record", value: { a: 1 } }, LIT).type).toEqual({ record: { a: { one: [1] } }, optional: ["a"], closed: true });
    // An otherwise of undefined has the base type undefined (D48).
    expect(typeCheck(formulaMachine({ otherwise: undefined }), when(true, 1), LIT).type).toEqual({ union: [{ one: [1] }, "undefined"] });
  });

  it("[TYPE.SYNTH] the result of a kind gives the type of its documents, and the check examines it one time", () => {
    const machine = formulaMachine(TYPED, {
      world: {
        kinds: {
          now: { verbs: { eval: "test.now" }, result: "number" },
          bad: { verbs: { eval: "test.now" }, result: { list: "nmber" } },
        },
        defaults: {},
      },
      evaluators: { "test.now": () => ok(7) },
    });
    expect(typeCheck(machine, op("add", { type: "now", value: null }, 1), LIT)).toMatchObject({ type: "number", issues: [] });
    expect(typeIssuesOf(machine, op("concat", { type: "now", value: null })).map((issue) => issue.place)).toEqual([[0]]);
    const twice = { type: "list", value: [{ type: "bad", value: null }, { type: "bad", value: null }] };
    expect(typeIssuesOf(machine, twice).map((issue) => [issue.place, issue.reason])).toEqual([
      [[0], "The result of the kind bad is not a correct value type. The machine has no domain nmber."],
    ]);
  });

  it("[TYPE.CHECK] the check gives each part the type that its position needs, and checks the type that the part synthesizes", () => {
    // Under the default truth, a test must be a truth value. A truth of the profile accepts each value.
    expect(typeIssuesOf(typed, when(1, "a", "b")).map((issue) => [issue.place, issue.reason])).toEqual([[["test"], "The test of if has the type 1. It must have the type bool."]]);
    expect(typeIssuesOf(formulaMachine({ ...TYPED, truthy: jsTruthy }), when(1, "a", "b"))).toEqual([]);
    expect(typeIssuesOf(typed, { type: "and", value: [true, "x"] }).map((issue) => issue.reason)).toEqual(['The term 2 of and has the type "x". It must have the type bool.']);
    // The expected type goes down into the branches, the body of a let, the fields of a record and the items of a list.
    expect(typeIssuesOf(typed, bind({}, when(true, "a", 1)), { ...LIT, expect: "number" }).map((issue) => [issue.place, issue.reason])).toEqual([
      [["body", "then"], 'The then branch of if has the type "a". It must have the type number.'],
    ]);
    expect(typeIssuesOf(typed, op("area", { type: "record", value: { w: 2, h: "x" } })).map((issue) => [issue.place, issue.expected, issue.found])).toEqual([[[0, "h"], "number", { one: ["x"] }]]);
    expect(typeIssuesOf(typed, op("area", { type: "record", value: { w: 2 } })).map((issue) => issue.place)).toEqual([[0]]);
    expect(typeIssuesOf(typed, op("sum", { type: "list", value: [1, "x", 3] })).map((issue) => [issue.place, issue.reason])).toEqual([
      [[0, 1], 'The item 2 of the list has the type "x". It must have the type number.'],
    ]);
    // An expected function type gives the types of the parameters of fn, and the type of its body.
    expect(typeIssuesOf(typed, op("apply", fn(["x"], op("concat", ref("names", "x"))), 1)).map((issue) => [issue.place, issue.reason])).toEqual([
      [[0, "body"], "The body of fn has the type text. It must have the type number."],
      [[0, "body", 0], "The argument 1 of ops.concat has the type number. It must have the type text."],
    ]);
    expect(typeIssuesOf(typed, op("apply", fn(["x"], op("add", ref("names", "x"), 1)), 1))).toEqual([]);
    // A call checks its function and its arguments.
    expect(typeIssuesOf(typed, call(1)).map((issue) => [issue.place, issue.reason])).toEqual([[["fn"], "The fn of call has the type 1. It must give a function."]]);
    const f = fn(["x"], op("add", ref("names", "x"), 1));
    expect(typeIssuesOf(typed, call(op("pair", 1, 2)))).toHaveLength(1);
    expect(typeIssuesOf(typed, bind({ f: op("apply", f, 1) }, call(ref("names", "f"))))).toHaveLength(1);
    expect(typeIssuesOf(typed, call(f, "a"))).toEqual([]);
  });

  it("[TYPE.CHECK] a part with an issue gets the type unknown, thus one problem gives one issue", () => {
    // The kind nothing is unknown: its reference in the body gets no second issue.
    const doc = bind({ x: { type: "nothing", value: 1 } }, op("add", ref("names", "x"), 1));
    expect(check(typed, doc, { ...LIT, types: true }).map((issue) => issue.code)).toEqual(["#KIND?"]);
    // The signature gives the if its expected type, and the if gives it to its branches. The branch with the issue is
    // unknown, thus the if and the operation around it fit.
    const branch = op("add", when(true, "a", 1), 2);
    expect(typeIssuesOf(typed, branch).map((issue) => issue.place)).toEqual([[0, "then"]]);
    expect(typeIssuesOf(typed, op("add", op("concat", 1), 2)).map((issue) => issue.place)).toEqual([[0], [0, 0]]);
  });

  it("[TYPE.CHECK] the shape of a contract gives the expected type of its parts, and the root can need a type", () => {
    const machine = formulaMachine(TYPED, {
      world: { kinds: { sizes: { verbs: { eval: "formula.list" }, parts: { shape: "list", of: "lit", expect: "number" } } }, defaults: {} },
    });
    const doc = { type: "sizes", value: [1, "x", op("add", 1, 2)] };
    expect(typeIssuesOf(machine, doc).map((issue) => [issue.place, issue.reason])).toEqual([[[1], 'The part 1 of sizes has the type "x". It must have the type number.']]);
    expect(typeCheck(machine, doc, LIT).places[2]?.expected).toBe("number");
    // The type that the root needs.
    expect(typeIssuesOf(typed, op("concat", "a"), { ...LIT, expect: "number" }).map((issue) => [issue.place, issue.reason])).toEqual([[[], "The document has the type text. It must have the type number."]]);
    expect(typeIssuesOf(typed, op("add", 1, 2), { ...LIT, expect: "number" })).toEqual([]);
  });

  it("[TYPE.CHECK] a host opts in, the type issues come last, and a type issue does not change the evaluation", () => {
    const doc = { type: "list", value: [op("concat", "n", op("add", 1, 2)), { type: "nothing", value: 1 }] };
    expect(check(typed, doc, LIT).map((issue) => issue.code)).toEqual(["#KIND?"]);
    expect(check(typed, doc, { ...LIT, types: true }).map((issue) => issue.code)).toEqual(["#KIND?", "#TYPE!"]);
    // The operation does not test its arguments, thus the run gives a value where the check finds a type issue.
    const concat = op("concat", "n", op("add", 1, 2));
    expect(typeIssuesOf(typed, concat)).toHaveLength(1);
    expect(prepare(typed, concat, LIT).evaluate()).toEqual(ok("n3"));
    expect(prepare(formulaMachine({ ops: LOOSE_OPS }), concat, LIT).evaluate()).toEqual(ok("n3"));
  });

  it("[TYPE.RULE] the type rule of a document is the rule of the evaluator that the ladder gives for the verb of the check", () => {
    // An own entry names another evaluator. Its rule gives the type, because its code gives the value.
    const own = { type: "lit", value: [1, 2], own: { eval: "formula.list" } };
    expect(prepare(typed, own, LIT).evaluate()).toEqual(ok([]));
    expect(typeCheck(typed, own, LIT).type).toEqual({ list: "never" });
    // An evaluator without a rule gives unknown. A language gives its evaluator a rule in the field type.
    const rule: TypeRule = { synth: () => "text" };
    const kinds = { kinds: { name: { verbs: { eval: "test.name" } } }, defaults: {} };
    const plain = formulaMachine(TYPED, { world: kinds, evaluators: { "test.name": { compile: () => () => ok("ada") } } });
    const ruled = formulaMachine(TYPED, { world: kinds, evaluators: { "test.name": { compile: () => () => ok("ada"), type: rule } } });
    expect(typeCheck(plain, { type: "name", value: null }, LIT).type).toBe("unknown");
    expect(typeCheck(ruled, { type: "name", value: null }, LIT).type).toBe("text");
    expect(typeIssuesOf(ruled, op("add", { type: "name", value: null }, 1))).toHaveLength(1);
    // A runner hides the evaluator of its name, and a runner has no rule yet.
    const runner: Machine = { ...ruled, runners: { "test.name": function* () { return ok("ada"); } } };
    expect(typeCheck(runner, { type: "name", value: null }, LIT).type).toBe("unknown");
    // A rule that throws gives an issue and the type unknown. The check does not throw.
    const broken: CompiledEvaluator = { compile: () => () => ok(1), type: { synth: () => { throw new Error("The rule has a bug."); } } };
    const machine = formulaMachine(TYPED, { world: kinds, evaluators: { "test.name": broken } });
    expect(typeCheck(machine, { type: "name", value: null }, LIT)).toMatchObject({ type: "unknown", issues: [{ code: "#TYPE!", reason: "The type rule of test.name fails: The rule has a bug." }] });
  });

  it("[TYPE.RULE] another verb reads the rules of its evaluators, and not the value types of the contract", () => {
    const evaluators = formulaEvaluators(TYPED);
    const machine = formulaMachine(TYPED, {
      world: {
        kinds: {
          sizes: { verbs: { eval: "formula.list", format: "test.format" }, parts: { shape: "list", of: "lit", expect: "number" }, result: { list: "number" } },
          lit: { verbs: { eval: "formula.lit", format: "test.format" } },
        },
        defaults: {},
      },
      replaces: [["world", "kinds", "lit"]],
      evaluators: { "test.format": { compile: () => () => ok("text"), type: { synth: () => "text" } } },
    });
    expect(evaluators["formula.list"]).toHaveProperty("type");
    const doc = { type: "sizes", value: [1, "x"] };
    expect(typeIssuesOf(machine, doc)).toHaveLength(1);
    expect(typeCheck(machine, doc, { ...LIT, verb: "format" })).toMatchObject({ type: "text", issues: [] });
  });

  it("[TYPE.GRADUAL] an operation without a signature takes and gives unknown, and a language without types gets no type issue from it", () => {
    const untyped = formulaMachine({ ops: LOOSE_OPS });
    for (const doc of [op("add", "a", 1), op("concat", op("add", 1, 2)), op("len", 1), call(fn(["x"], op("not", ref("names", "x"))), 1)]) {
      expect(typeIssuesOf(untyped, doc), JSON.stringify(doc)).toEqual([]);
      expect(typeCheck(untyped, doc, LIT).type).not.toBe("number");
    }
    // A kind without a result and an evaluator without a rule give unknown.
    expect(typeCheck(untyped, op("add", 1, 2), LIT).type).toBe("unknown");
  });

  it("[TYPE.GRADUAL] a less precise signature does not add a type issue, for generated documents", () => {
    const wide = (type: ValueType): ValueType => (type === "unknown" ? type : "unknown");
    const sigs = Object.fromEntries(
      Object.entries(SIGS).map(([name, value]) => [name, [value].flat().map((sig: Signature) => ({ params: sig.params.map(wide), ...(sig.rest === undefined ? {} : { rest: wide(sig.rest) }), to: wide(sig.to) }))]),
    );
    const machines = [typed, formulaMachine({ ops: LOOSE_OPS, sigs }), formulaMachine({ ops: LOOSE_OPS })];
    let issues = 0;
    for (let index = 0; index < COUNT; index += 1) {
      const doc = generate(typed.world, { ...OPTIONS, seed: SEED * 1_000_003 + index });
      const counts = machines.map((machine) => typeIssuesOf(machine, doc).length);
      issues += counts[0] ?? 0;
      expect(counts[1] ?? 0, JSON.stringify(doc)).toBeLessThanOrEqual(counts[0] ?? 0);
      expect(counts[2] ?? 0, JSON.stringify(doc)).toBeLessThanOrEqual(counts[1] ?? 0);
    }
    expect(issues).toBeGreaterThan(COUNT / 4);
  });

  it("[TYPE.SOUND] a generated document that checks with no issue evaluates to a member of its synthesized type", () => {
    const profiles: readonly (readonly [string, FormulaProfile])[] = [
      ["strict", { ops: GUARDED, sigs: SIGS }],
      [
        "loose",
        {
          ops: GUARDED,
          sigs: SIGS,
          truthy: jsTruthy,
          logic: "value",
          otherwise: "none",
          omit: (error) => error.code === "#CALC!",
          check: (value) => (typeof value === "number" && !Number.isFinite(value) ? fail("#NUM!", "The number is not finite.") : undefined),
        },
      ],
    ];
    for (const [name, profile] of profiles) {
      const machine = formulaMachine(profile);
      const rng = random(SEED);
      let accepted = 0;
      let precise = 0;
      let nodes = 0;
      for (let index = 0; index < 2 * COUNT; index += 1) {
        // The even documents come from the contracts (generate), and the odd documents from the signatures.
        const doc = index % 2 === 0 ? generate(machine.world, { ...OPTIONS, seed: SEED * 1_000_003 + index }) : typedDoc(rng, "any", 4, []);
        const typing = typeCheck(machine, doc);
        if (typing.issues.length > 0) continue;
        const result = prepare(machine, doc).evaluate();
        if (!result.ok) continue;
        accepted += 1;
        if (typing.type !== "unknown") precise += 1;
        expect(member(result.value, typing.type, machine.domains), `${name}: ${JSON.stringify(doc)} gives ${JSON.stringify(result.value)}, not a member of ${typeText(typing.type)}`).toBe(true);
        // Each value of the trace is a member of the type of its place too. A body of fn evaluates at each call.
        const types = new Map(typing.places.map((item) => [JSON.stringify(item.place.map(String)), item.type]));
        const stack: TraceNode[] = [evaluate(machine, doc).trace];
        while (stack.length > 0) {
          const node = stack.pop() as TraceNode;
          stack.push(...node.children);
          const type = types.get(JSON.stringify(node.path));
          if (!node.result.ok || type === undefined) continue;
          nodes += 1;
          expect(member(node.result.value, type, machine.domains), `${name}: at ${node.path.join(".")} of ${JSON.stringify(doc)}, ${JSON.stringify(node.result.value)} is not a member of ${typeText(type)}`).toBe(true);
        }
      }
      expect(accepted, name).toBeGreaterThan(COUNT / 2);
      expect(precise, name).toBeGreaterThan(COUNT / 4);
      expect(nodes, name).toBeGreaterThan(3 * COUNT);
    }
  });
});

/** The value types of the typed documents: the base types of the language, a list, a record, a function, or each value. */
type Want = "number" | "text" | "bool" | "list" | "record" | "fn" | "any";

const WANTS: readonly Exclude<Want, "any">[] = ["number", "text", "bool", "list", "record", "fn"];

/** The literals of each value type, as bare values in the positions of terms. */
const LITERALS: Readonly<Record<Exclude<Want, "any">, readonly Json[]>> = {
  number: [0, 1, 2.5, -1],
  text: ["", "a", "bc"],
  bool: [true, false],
  list: [[1, 2], ["a"], []],
  record: [{ w: 2, h: 3 }, { a: 1 }],
  fn: [fn([], 1)],
};

/**
 * This function builds a random document whose parts mostly have the types that their positions need, from the
 * signatures of the language. Thus the check accepts many larger documents. Some literals have a random type on
 * purpose. A name of a parameter has the type unknown, thus a reference to it fits each position.
 */
function typedDoc(rng: Random, want: Want, depth: number, names: readonly (readonly [string, Want])[]): Json {
  const goal: Exclude<Want, "any"> = want === "any" ? rng.pick(WANTS) : want;
  const usable = names.filter(([, type]) => type === goal || type === "any");
  if (usable.length > 0 && rng.chance(0.3)) return ref("names", rng.pick(usable)[0]);
  if (depth <= 0 || rng.chance(0.15)) return rng.pick(LITERALS[rng.chance(0.05) ? rng.pick(WANTS) : goal]);
  const sub = (type: Want, more: readonly (readonly [string, Want])[] = []): Json => typedDoc(rng, type, depth - 1, [...names, ...more]);
  const name = rng.pick(["a", "b", "n"]);
  const shared: readonly (() => Json)[] = [
    () => when(sub("bool"), sub(goal), sub(goal)),
    () => {
      const type = rng.pick(WANTS);
      return bind({ [name]: sub(type) }, sub(goal, [[name, type]]));
    },
    () => call(fn([name], sub(goal, [[name, "any"]])), sub("any")),
  ];
  const own: Readonly<Record<Exclude<Want, "any">, readonly (() => Json)[]>> = {
    number: [() => op("add", sub("number"), sub("number")), () => op("len", sub(rng.pick(["text", "list"] as const))), () => op("same", sub("number")), () => op("round", sub("number")), () => op("sum", { type: "list", value: [sub("number"), sub("number")] })],
    text: [() => op("concat", sub("text"), sub("text")), () => op("same", sub("text"))],
    bool: [() => op("gt", sub("number"), sub("number")), () => op("not", sub("bool")), () => ({ type: rng.pick(["and", "or"]), value: [sub("bool"), sub("bool")] })],
    list: [() => ({ type: "list", value: [sub("any"), sub("any")] }), () => op("pair", sub("any"), sub("any"))],
    record: [() => ({ type: "record", value: { a: sub("any"), b: sub("any") } })],
    fn: [() => fn([name], sub("any", [[name, "any"]]))],
  };
  return rng.pick([...own[goal], ...own[goal], ...shared])();
}

/** The kinds of the generated documents: the kit, and the operations of the typed language more often. */
const OP_TYPES: readonly (readonly Key[])[] = Object.keys(SIGS)
  .filter((name) => name !== "apply")
  .map((name) => ["ops", name]);

/*
 * The documents of the properties: literals of each base type, names from let and fn only, and operations more often
 * than other kinds. The root is an envelope. The operation apply calls its function, and the code of that function
 * decides its result, thus the documents do not use it.
 */
const OPTIONS: Omit<GenerateOptions, "seed"> = {
  names: [],
  roots: ["names"],
  steps: 0,
  maxDepth: 4,
  maxSize: 20,
  malformed: 0.02,
  types: [...typesOf(typed.world), ...OP_TYPES, ...OP_TYPES, ["ext", "number"]],
  hints: (type, path) => (type[0] === "call" && path[0] === "fn" ? [["fn"], ["ref"]] : undefined),
  data: (type, rng) => {
    const name = type.join(".");
    if (name === "ext.number") return rng.pick(["NaN", "-0", "Infinity"]);
    if (name === "lit") return rng.pick<Json>([0, 1, 2.5, -1, "", "a", "bc", true, false, null, [1, 2], ["a"], [], { w: 2, h: 3 }, { a: 1 }]);
    return undefined;
  },
};

/*
 * K25: the types of the roots, of the names and of the paths (R5 P4, D28).
 */

/** This function tells if a value is a point: a record with the numbers x and y, and no other key. */
function isPoint(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return Object.keys(record).length === 2 && typeof record["x"] === "number" && typeof record["y"] === "number";
}

/** A domain of a language. Its steps give the type of each field of a point. */
const point: Domain = { is: isPoint, steps: { x: "number", y: "number" }, summary: "A point with the numbers x and y." };

/** The type of the store of the example of the study R5. */
const STORE: ValueType = {
  record: {
    order: {
      record: { price: "number", note: "text", items: { list: { record: { sku: "text", qty: "number" } } } },
      optional: ["note"],
      closed: true,
    },
  },
};

/** The roots that the kinds swap and swapRuled give their parts. */
const SWAPPED = { a: "swapped" };
const SWAP_TYPE: ValueType = { record: { a: { one: ["swapped"] } }, closed: true };

/**
 * This function makes a typed machine with the domain point and two kinds that change each root for their body. The
 * evaluator of swap has no rule. The rule of swapRuled gives the new types of the roots.
 */
function swapMachine(profile: FormulaProfile, more: Partial<Machine> = {}): Machine {
  const compile: CompiledEvaluator["compile"] = ({ parts }) => (ctx, rt) => (parts[0] as CompiledPart).code({ ...ctx, self: SWAPPED, world: SWAPPED, event: SWAPPED }, rt);
  const rule: TypeRule = { part: () => ({ roots: { self: SWAP_TYPE, world: SWAP_TYPE, event: SWAP_TYPE } }), synth: (input) => input.typeOf(["body"]) };
  const parts = { shape: "record", fields: { body: { shape: "term", of: "lit" } }, required: ["body"] } as const;
  return formulaMachine(profile, {
    ...more,
    world: { kinds: { swap: { verbs: { eval: "test.swap" }, parts, pure: true }, swapRuled: { verbs: { eval: "test.swapRuled" }, parts, pure: true } }, defaults: {} },
    evaluators: { "test.swap": { compile }, "test.swapRuled": { compile, type: rule } },
    domains: { point },
  });
}

const rooted = swapMachine(TYPED);

describe("the types of the roots, of the names and of the paths", () => {
  it("[TYPE.ROOTS] the host gives the types of its names and of the roots, and a reference gets the type that its path reaches", () => {
    const rootTypes: RootTypes = { names: { user: { record: { name: "text", age: "number" } } }, self: { record: { width: "number" } }, world: STORE, event: { record: { target: "text" } } };
    const options = { ...LIT, names: ["user"], rootTypes };
    expect(typeCheck(rooted, ref("names", "user", "age"), options)).toMatchObject({ type: "number", issues: [] });
    expect(typeCheck(rooted, ref("self", "width"), options).type).toBe("number");
    expect(typeCheck(rooted, ref("world", "order", "price"), options).type).toBe("number");
    expect(typeCheck(rooted, ref("event", "target"), options).type).toBe("text");
    expect(typeCheck(rooted, ref("caps"), options).type).toEqual(CAPS_TYPE);
    // The signatures check what a path reaches.
    expect(typeIssuesOf(rooted, op("concat", "Age: ", ref("names", "user", "age")), options).map((issue) => [issue.place, issue.found])).toEqual([[[1], "number"]]);
    expect(typeIssuesOf(rooted, op("add", ref("names", "user", "age"), ref("self", "width")), options)).toEqual([]);
    // A kind that binds a name hides the name of the host. A name of the host without a type and a root without a type give unknown.
    expect(typeCheck(rooted, bind({ user: 1 }, ref("names", "user")), options).type).toEqual({ one: [1] });
    expect(typeCheck(rooted, ref("names", "guest"), { ...options, names: ["user", "guest"] }).type).toBe("unknown");
    expect(typeCheck(rooted, ref("self", "width"), { ...LIT, rootTypes: { event: "text" } }).type).toBe("unknown");
    // Without the option types, a check reads no type of a root.
    expect(check(rooted, op("concat", ref("names", "user", "age")), options)).toEqual([]);
    // The check examines each type of the host one time, at the root.
    expect(typeIssuesOf(rooted, { type: "list", value: [ref("self"), ref("self")] }, { ...LIT, rootTypes: { self: "nmber" } }).map((issue) => [issue.place, issue.reason])).toEqual([
      [[], "The type of the root self is not a correct value type. The machine has no domain nmber."],
    ]);
  });

  it("[TYPE.ROOTS] the parts of an evaluator without a rule get unknown roots, and a rule can give its parts other roots", () => {
    const options = { ...LIT, rootTypes: { self: { record: { a: "number" } }, event: { record: { a: "number" } } } };
    expect(typeCheck(rooted, ref("self", "a"), options).type).toBe("number");
    // The evaluator of swap changes the roots, and no rule tells it. Thus its body reads unknown roots.
    const swapped = typeCheck(rooted, { type: "swap", value: { body: op("add", ref("self", "a"), ref("event", "a")) } }, options);
    expect(swapped.issues).toEqual([]);
    expect(swapped.places.map((item) => item.type)).toEqual(["unknown", "number", "unknown", "unknown"]);
    // The rule of swapRuled gives the new roots, and the check finds the wrong type.
    const ruled = { type: "swapRuled", value: { body: ref("self", "a") } };
    expect(typeCheck(rooted, ruled, options)).toMatchObject({ type: { one: ["swapped"] }, issues: [] });
    expect(typeIssuesOf(rooted, { type: "swapRuled", value: { body: op("add", ref("self", "a"), 1) } }, options).map((issue) => issue.place)).toEqual([["body", 0]]);
    expect(evaluate(rooted, ruled, context({ self: { a: 1 } })).result).toEqual(ok("swapped"));
  });

  it("[TYPE.PATH] each step of a path asks the type that the path reached: a field, an item, a step of a domain, a union or values", () => {
    const names: Readonly<Record<string, ValueType>> = {
      box: { record: { w: "number", tags: { list: "text" }, note: "text" }, optional: ["note"] },
      either: { union: [{ record: { a: "number" }, closed: true }, { record: { a: "text", b: "bool" }, closed: true }] },
      fixed: { one: [{ a: 1 }, { a: "x" }, [1, 2]] },
      p: "point",
      none: "never",
    };
    const options = { ...LIT, names: Object.keys(names), rootTypes: { names } };
    const cases: readonly (readonly [readonly Json[], ValueType])[] = [
      [["names", "box", "w"], "number"],
      // An optional field has its type. The path fails when the field is absent, thus the type holds each value that it gives.
      [["names", "box", "note"], "text"],
      [["names", "box", "tags", 0], "text"],
      [["names", "box", "tags", "1"], "text"],
      [["names", "box", "tags", "length"], "number"],
      [["names", "box", "tags", "first"], "unknown"],
      [["names", "box", "other"], "unknown"],
      [["names", "either", "a"], { union: ["number", "text"] }],
      [["names", "either", "b"], "bool"],
      [["names", "fixed", "a"], { one: [1, "x"] }],
      [["names", "fixed", 1], { one: [2] }],
      [["names", "fixed", "length"], { one: [2] }],
      [["names", "p", "x"], "number"],
      [["names", "p", "z"], "unknown"],
      [["names", "none", "a"], "never"],
      [["names"], "unknown"],
    ];
    for (const [path, type] of cases) {
      const typing = typeCheck(rooted, ref(...path), options);
      expect(typing.issues, JSON.stringify(path)).toEqual([]);
      expect(typing.type, JSON.stringify(path)).toEqual(type);
    }
    // A path follows a reference document that it reaches. A type of such a value gives unknown, and the run agrees.
    const follows = bind({ m: "far" }, bind({ n: { type: "lit", value: ref("names", "m") } }, ref("names", "n")));
    expect(typeCheck(rooted, follows, LIT)).toMatchObject({ type: "unknown", issues: [] });
    expect(evaluate(rooted, follows).result).toEqual(ok("far"));
    // A step into an envelope asks the ladder: here it goes into the value of the envelope.
    const envelope = bind({ e: { type: "lit", value: { type: "x", value: { a: 1 } } } }, ref("names", "e", "a"));
    expect(typeCheck(rooted, envelope, LIT)).toMatchObject({ type: "unknown", issues: [] });
    expect(evaluate(rooted, envelope).result).toEqual(ok(1));
    // A record of names with only the keys of a header can be an envelope, thus such a name has no type.
    expect(typeCheck(rooted, bind({ value: 1 }, ref("names", "value")), LIT).type).toBe("unknown");
    // A plain machine reads each value as data: the step does not ask the ladder, and the field is missing.
    const data = swapMachine(TYPED, { plain: true });
    expect(typeIssuesOf(data, envelope).map((issue) => issue.reason)).toEqual(["The value at names.e has no field a. Its fields are type and value."]);
    expect(evaluate(data, envelope).result).toMatchObject({ ok: false, error: { code: "#N/A" } });
  });

  it("[TYPE.CLOSED] a field that a closed record does not have is a type issue, and an open record or unknown gives unknown", () => {
    const options = { ...LIT, rootTypes: { world: STORE } };
    // The example of the study R5: the field notes is a mistake for note. The reference gets unknown, thus concat adds no issue.
    expect(typeIssuesOf(rooted, op("concat", ref("world", "order", "notes")), options)).toEqual([
      { code: "#TYPE!", place: [0], at: ["value", 0], reason: "The value at world.order has no field notes. Its fields are price, note and items." },
    ]);
    expect(typeCheck(rooted, ref("world", "order", "note"), options).type).toBe("text");
    expect(evaluate(rooted, ref("world", "order", "notes"), context({ world: { order: { price: 3, items: [] } } })).result).toMatchObject({ ok: false, error: { code: "#N/A" } });
    // An open record and unknown give unknown, with no issue.
    const opens: readonly ValueType[] = [{ record: { order: "unknown" } }, "unknown", { record: { order: { record: { price: "number" } } } }];
    for (const world of opens) {
      expect(typeCheck(rooted, ref("world", "order", "notes"), { ...LIT, rootTypes: { world } }), JSON.stringify(world)).toMatchObject({ type: "unknown", issues: [] });
    }
    // A union gives an issue only when no type of it has the field. The values of one do the same.
    const union: ValueType = { union: [{ record: { a: "number" }, closed: true }, { record: { b: "text" }, closed: true }] };
    expect(typeIssuesOf(rooted, ref("self", "c"), { ...LIT, rootTypes: { self: union } }).map((issue) => issue.reason)).toEqual(["The value at self has no field c. Its fields are a and b."]);
    expect(typeIssuesOf(rooted, ref("self", "c"), { ...LIT, rootTypes: { self: { one: [{ a: 1 }, 2] } } }).map((issue) => issue.reason)).toEqual(["The value at self has no field c. Its fields are a."]);
  });

  it("[TYPE.SCHEMA] typeFromSchema reads a subset of JSON Schema, and each keyword that it does not read is an issue", () => {
    const schema = {
      title: "A store",
      type: "object",
      properties: {
        order: {
          type: "object",
          properties: {
            price: { type: "number", minimum: 0 },
            note: { type: "string" },
            items: { type: "array", items: { type: "object", properties: { sku: { type: "string" }, qty: { type: "integer" } }, required: ["sku", "qty"], additionalProperties: false } },
          },
          required: ["price", "items"],
          additionalProperties: false,
        },
      },
      required: ["order"],
    };
    const reading = typeFromSchema(schema);
    expect(reading.type).toEqual({
      record: { order: { record: { price: "number", note: "text", items: { list: { record: { sku: "text", qty: "number" }, closed: true } } }, optional: ["note"], closed: true } },
    });
    expect(reading.issues.map((issue) => issue.at)).toEqual([
      ["properties", "order", "properties", "price", "minimum"],
      ["properties", "order", "properties", "items", "items", "properties", "qty", "type"],
    ]);
    expect(typeIssuesOf(rooted, ref("world", "order", "notes"), { ...LIT, rootTypes: { world: reading.type } })).toHaveLength(1);
    const cases: readonly (readonly [unknown, ValueType])[] = [
      [true, "unknown"],
      [false, "never"],
      [{}, "unknown"],
      [{ type: ["string", "null"] }, { union: ["text", "null"] }],
      [{ enum: ["a", "b", 1] }, { one: ["a", "b", 1] }],
      [{ type: "string", enum: ["a", 1] }, { one: ["a"] }],
      [{ const: 3, enum: [3, 4] }, { one: [3] }],
      [{ anyOf: [{ type: "number" }, { type: "string" }] }, { union: ["number", "text"] }],
      [{ oneOf: [{ type: "boolean" }, false] }, "bool"],
      [{ type: "array" }, { list: "unknown" }],
      [{ type: "object", required: ["id"] }, { record: { id: "unknown" } }],
    ];
    for (const [input, type] of cases) {
      expect(typeFromSchema(input), JSON.stringify(input)).toEqual({ type, issues: [] });
    }
    // A keyword that can permit more values makes the schema unknown. Each other keyword that the reading does not read tests nothing.
    const partial: readonly (readonly [unknown, ValueType, readonly (readonly Key[])[]])[] = [
      [{ $ref: "#/$defs/a", type: "string" }, "unknown", [["$ref"]]],
      [{ type: "string", nullable: true }, "unknown", [["nullable"]]],
      [{ type: "object", properties: { a: { type: "number" } }, additionalProperties: false, patternProperties: { "^x": {} } }, { record: { a: "number" }, optional: ["a"] }, [["patternProperties"]]],
      [{ type: "object", additionalProperties: { type: "number" } }, { record: {} }, [["additionalProperties"]]],
      [{ type: "array", prefixItems: [{ type: "number" }], items: { type: "string" } }, { list: "unknown" }, [["prefixItems"], ["items"]]],
      [{ type: "array", items: [{ type: "number" }] }, { list: "unknown" }, [["items"]]],
      [{ allOf: [{ type: "number" }], type: "string" }, "text", [["allOf"]]],
      [{ properties: { a: { type: "number" } } }, "unknown", [[]]],
      [{ type: "number", anyOf: [{ type: "string" }] }, "number", [["anyOf"]]],
      [{ type: "date" }, "unknown", [["type"]]],
      [1, "unknown", [[]]],
    ];
    for (const [input, type, at] of partial) {
      const read = typeFromSchema(input);
      expect(read.type, JSON.stringify(input)).toEqual(type);
      expect(read.issues.map((issue) => issue.at), JSON.stringify(input)).toEqual(at);
    }
    // The function does not throw: a cycle stops at the deepest level, and a getter that throws gives unknown.
    const cycle: Record<string, unknown> = { type: "array" };
    cycle["items"] = cycle;
    expect(typeFromSchema(cycle).issues.at(-1)?.reason).toBe("The schema is deeper than 256 levels. The type reads it as unknown.");
    const broken = Object.defineProperty({}, "type", {
      enumerable: true,
      get: () => {
        throw new Error("No type.");
      },
    });
    expect(typeFromSchema(broken)).toEqual({ type: "unknown", issues: [{ at: [], reason: "The schema cannot be read: No type." }] });
  });

  it("[TYPE.SCHEMA] each value that a generated schema accepts is a member of the type of the schema", () => {
    const rng = random(SEED * 11 + 5);
    let values = 0;
    for (let index = 0; index < COUNT; index += 1) {
      const schema = genSchema(rng, 3);
      const { type } = typeFromSchema(schema);
      for (let draw = 0; draw < 4; draw += 1) {
        const value = valueOfSchema(schema, rng);
        if (value === NONE) continue;
        values += 1;
        expect(member(value, type), `${JSON.stringify(value)} fits ${JSON.stringify(schema)}, but not ${typeText(type)}`).toBe(true);
      }
    }
    expect(values).toBeGreaterThan(2 * COUNT);
  });

  it("[TYPE.SAMPLES] typeFromSamples joins the types of sample values, and a key that a record does not have is optional", () => {
    expect(typeFromSamples([1, 2.5])).toBe("number");
    expect(typeFromSamples(["a", null])).toEqual({ union: ["null", "text"] });
    expect(typeFromSamples([[1, 2], ["a"], []])).toEqual({ list: { union: ["number", "text"] } });
    expect(typeFromSamples([{ id: 1, name: "a" }, { id: 2, tags: ["x"] }])).toEqual({ record: { id: "number", name: "text", tags: { list: "text" } }, optional: ["name", "tags"] });
    expect(typeFromSamples([{ id: 1 }, { id: 2, note: "n" }], { closed: true })).toEqual({ record: { id: "number", note: "text" }, optional: ["note"], closed: true });
    expect(typeFromSamples([{ a: 1 }, null, { b: "x" }])).toEqual({ union: ["null", { record: { a: "number", b: "text" }, optional: ["a", "b"] }] });
    expect(typeFromSamples([])).toBe("never");
    expect(typeFromSamples([1, () => 1])).toBe("unknown");
    expect(typeFromSamples([{ a: undefined }])).toEqual({ record: { a: "undefined" } });
    expect(typeFromSamples([1, undefined, null])).toEqual({ union: ["null", "undefined", "number"] });
    // An open record gives unknown for a field that no sample has. A closed record gives an issue.
    const events = [{ target: "a", at: 1 }, { target: "b" }];
    expect(typeIssuesOf(rooted, ref("event", "targt"), { ...LIT, rootTypes: { event: typeFromSamples(events) } })).toEqual([]);
    expect(typeIssuesOf(rooted, ref("event", "targt"), { ...LIT, rootTypes: { event: typeFromSamples(events, { closed: true }) } })).toHaveLength(1);
    expect(typeCheck(rooted, ref("event", "at"), { ...LIT, rootTypes: { event: typeFromSamples(events) } }).type).toBe("number");
    // Each sample is a member of the type, also for generated samples.
    const rng = random(SEED * 13 + 1);
    for (let index = 0; index < COUNT; index += 1) {
      const samples = Array.from({ length: 1 + rng.int(4) }, () => jsonValue(rng, 3));
      for (const closed of [false, true]) {
        const type = typeFromSamples(samples, { closed });
        for (const sample of samples) expect(member(sample, type), `${JSON.stringify(sample)} is not a member of ${typeText(type)}`).toBe(true);
      }
    }
  });

  it("[TYPE.STEPS] a domain gives the types of the steps into its members, and a domain under it reads them too", () => {
    const corner: Domain = { is: (value) => isPoint(value) && (value as { readonly x: unknown }).x === 0, under: ["point"], steps: { x: { one: [0] } }, summary: "A point at x 0." };
    const machine = formulaMachine(TYPED, { domains: { point, corner } });
    const options = { ...LIT, names: ["p", "c"], rootTypes: { names: { p: "point", c: "corner" } } };
    expect(typeCheck(machine, ref("names", "p", "x"), options).type).toBe("number");
    // The steps of the domain come first, then the steps of each parent.
    expect(typeCheck(machine, ref("names", "c", "x"), options).type).toEqual({ one: [0] });
    expect(typeCheck(machine, ref("names", "c", "y"), options).type).toBe("number");
    expect(typeCheck(machine, ref("names", "c", "z"), options).type).toBe("unknown");
    const sum = op("add", ref("names", "c", "x"), ref("names", "c", "y"));
    expect(typeCheck(machine, sum, options)).toMatchObject({ type: "number", issues: [] });
    expect(evaluate(machine, sum, context({ names: { p: { x: 1, y: 2 }, c: { x: 0, y: 5 } } })).result).toEqual(ok(5));
    // A bad type of a step is an issue one time in a check.
    const bad = formulaMachine(TYPED, { domains: { point: { ...point, steps: { x: "nmber" } } } });
    const twice = { type: "list", value: [ref("names", "p", "x"), ref("names", "p", "x")] };
    expect(typeIssuesOf(bad, twice, { ...LIT, names: ["p"], rootTypes: { names: { p: "point" } } }).map((issue) => [issue.place, issue.reason])).toEqual([
      [[0], "The type of the step x of the domain point is not a correct value type. The machine has no domain nmber."],
    ]);
    // Two domains with different steps are a conflict of the merge. The same steps give one domain.
    expect(() => mergeMachines({ domains: { point } }, { domains: { point: { ...point, steps: { x: "text" } } } })).toThrow(MergeError);
    expect(mergeMachines({ domains: { point } }, { domains: { point: { ...point, steps: { x: "number", y: "number" } } } }).domains?.["point"]).toBe(point);
  });

  it("[TYPE.PARENTS] a language adds a parent to a domain of another language through the merge, and the parent adds its test", () => {
    const length: Domain = { is: (value) => typeof value === "number" && value >= 0, under: ["number"], summary: "A length." };
    const quantity: Domain = { is: (value) => typeof value === "number" && Number.isFinite(value), summary: "A finite quantity." };
    const ops: Readonly<Record<string, OpFn>> = { size: () => 3, scale: (value: number) => value * 2 };
    const profile: FormulaProfile = { ops, sigs: { size: { params: [], to: "length" }, scale: { params: ["quantity"], to: "number" } } };
    const base = formulaMachine(profile, { domains: { length, quantity } });
    const doc = op("scale", op("size"));
    expect(typeIssuesOf(base, doc).map((issue) => issue.found)).toEqual(["length"]);
    const joined = mergeMachines(base, extendDomain("length", { under: ["quantity"] }));
    expect(typeIssuesOf(joined, doc)).toEqual([]);
    expect(fits("length", "quantity", base.domains)).toBe(false);
    expect(fits("length", "quantity", joined.domains)).toBe(true);
    expect(joined.domains?.["length"]).toEqual({ is: length.is, under: ["number", "quantity"], summary: "A length." });
    // The new parent adds its test: an infinite length is no longer a member.
    expect(member(Number.POSITIVE_INFINITY, "length", base.domains)).toBe(true);
    expect(member(Number.POSITIVE_INFINITY, "length", joined.domains)).toBe(false);
    // A change of the domain without replaces is a conflict, as each other change of an entry (D17).
    expect(() => mergeMachines(base, { domains: { length: { ...length, under: ["number", "quantity"] } } })).toThrow(MergeError);
    // A domain of the kernel comes from STD_DOMAINS. A name without a domain gives an empty part.
    const empty: Machine = { world: { kinds: {}, defaults: {} }, evaluators: {} };
    expect(extendDomain("number", { under: ["quantity"] })(empty)).toEqual({ domains: { number: { ...STD_DOMAINS["number"], under: ["quantity"] } }, replaces: [["domains", "number"]] });
    expect(extendDomain("lenght", { under: ["quantity"] })(base)).toEqual({});
  });

  it("[TYPE.PARENTS] extendDomain keeps the codec of the domain, thus a member keeps its JSON form (D80)", () => {
    const codec = { encode: (value: unknown) => String(value), decode: (data: Json) => BigInt(data as string) };
    const big: Domain = { is: (value) => typeof value === "bigint", summary: "A whole number of any size.", codec };
    const whole: Domain = { is: (value) => typeof value === "bigint" || Number.isInteger(value), summary: "A whole number." };
    const base = formulaMachine({}, { domains: { big, whole } });
    const joined = mergeMachines(base, extendDomain("big", { under: ["whole"] }));
    expect(joined.domains?.["big"]).toEqual({ is: big.is, under: ["whole"], summary: big.summary, codec });
    // The member has the same document before and after the extension.
    const doc = { type: ["ext", "domain"], value: { domain: "big", data: "12345678901234567890" } };
    expect(encodeValue(base, 12345678901234567890n)).toEqual(doc);
    expect(encodeValue(joined, 12345678901234567890n)).toEqual(doc);
    expect(decodeValue(joined, doc)).toEqual(ok(12345678901234567890n));
    // A domain without a codec gets no codec from the extension.
    expect(extendDomain("whole", { under: ["number"] })(base).domains?.["whole"]).not.toHaveProperty("codec");
  });

  it("[TYPE.ROOTS-SOUND] for generated root types and contexts of their members, a document that checks evaluates to members of its types", () => {
    const machine = swapMachine({ ops: GUARDED, sigs: SIGS });
    const rng = random(SEED * 7 + 3);
    let checked = 0;
    let accepted = 0;
    let precise = 0;
    let paths = 0;
    let nodes = 0;
    for (let index = 0; index < 3 * COUNT; index += 1) {
      const names: Record<string, ValueType> = {};
      const values: Record<string, Json> = {};
      for (const name of HOST) {
        const type = rootTypeOf(rng, 3);
        names[name] = type;
        values[name] = memberOfType(type, rng);
      }
      const [self, world, event] = [rootTypeOf(rng, 3), rootTypeOf(rng, 3), rootTypeOf(rng, 3)];
      const ctx = context({ names: values, self: memberOfType(self, rng), world: memberOfType(world, rng), event: memberOfType(event, rng) });
      // A world of null becomes the world of the machine, thus its type is unknown then.
      const rootTypes: RootTypes = { names, self, world: ctx.world === null ? "unknown" : world, event };
      const doc = rootDoc(rng, 3, [], { ...names, self, world, event });
      const typing = typeCheck(machine, doc, { names: [...HOST], rootTypes });
      if (typing.issues.length > 0) continue;
      checked += 1;
      const run = evaluate(machine, doc, ctx);
      const at = JSON.stringify({ doc, ctx, rootTypes });
      if (run.result.ok) {
        accepted += 1;
        if (typing.type !== "unknown") precise += 1;
        expect(member(run.result.value, typing.type, machine.domains), `${at} gives ${JSON.stringify(run.result.value)}, not a member of ${typeText(typing.type)}`).toBe(true);
      }
      // A path can reach nothing, thus a part can fail. Each part that gives a value gives a member of the type of its place.
      const types = new Map(typing.places.map((item) => [JSON.stringify(item.place.map(String)), item.type]));
      const stack: TraceNode[] = [run.trace];
      while (stack.length > 0) {
        const node = stack.pop() as TraceNode;
        stack.push(...node.children);
        const type = types.get(JSON.stringify(node.path));
        if (!node.result.ok || type === undefined) continue;
        nodes += 1;
        if (node.doc.type === "ref" && type !== "unknown") paths += 1;
        expect(member(node.result.value, type, machine.domains), `at ${node.path.join(".")} of ${at}, ${JSON.stringify(node.result.value)} is not a member of ${typeText(type)}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(COUNT);
    expect(accepted).toBeGreaterThan(COUNT / 3);
    expect(precise).toBeGreaterThan(COUNT / 5);
    expect(paths).toBeGreaterThan((2 * COUNT) / 5);
    expect(nodes).toBeGreaterThan(COUNT);
  });
});

/** The names of the host in the property of the root types. */
const HOST = ["h0", "h1", "h2"] as const;

/** The fields of the generated record types. Two of them are keys of a header, thus a record can be an envelope. */
const FIELD_KEYS = ["a", "b", "type", "value"] as const;

/** The keys of the steps of the generated paths. */
const STEP_KEYS: readonly Key[] = ["a", "b", "type", "value", "x", "y", 0, 1, "length", "zz"];

/** The leaves of the generated types. Two values of one are a reference document and an envelope. */
const LEAF_TYPES: readonly ValueType[] = [
  "number",
  "text",
  "bool",
  "null",
  "point",
  "unknown",
  { one: [1, "a", { a: 2 }] },
  { one: [{ type: "ref", value: ["names", "h0"] }, { type: "x", value: { a: 1 } }] },
];

/** This function makes a random value type for a root: base types, the domain point, lists, records, unions and values. */
function rootTypeOf(rng: Random, depth: number): ValueType {
  if (depth <= 0 || rng.chance(0.3)) return rng.pick(LEAF_TYPES);
  const form = rng.int(4);
  if (form === 0) return { list: rootTypeOf(rng, depth - 1) };
  if (form === 1) return { union: [rootTypeOf(rng, depth - 1), rootTypeOf(rng, depth - 1)] };
  const fields: Record<string, ValueType> = {};
  for (const key of FIELD_KEYS) if (rng.chance(0.5)) fields[key] = rootTypeOf(rng, depth - 1);
  const optional = Object.keys(fields).filter(() => rng.chance(0.3));
  return { record: fields, ...(optional.length === 0 ? {} : { optional }), ...(rng.chance(0.5) ? { closed: true } : {}) };
}

/** The values that a member of unknown can be. A reference document and an envelope are two of them. */
const ANY: readonly Json[] = [1, "a", "names", null, true, [1, "a"], { a: 1 }, { a: { b: 2 } }, { type: "ref", value: ["names", "h0"] }, { type: "x", value: { a: 1 } }, { x: 1, y: 2 }];

/** This function makes a random member of a generated type. An open record can get more fields, which can make it an envelope. */
function memberOfType(type: ValueType, rng: Random): Json {
  if (type === "number") return rng.pick([0, 1, -2.5]);
  if (type === "text") return rng.pick(["", "a", "names"]);
  if (type === "bool") return rng.chance(0.5);
  if (type === "null") return null;
  if (type === "point") return { x: rng.pick([0, 1]), y: 2 };
  if (typeof type === "string") return rng.pick(ANY);
  if ("list" in type) return Array.from({ length: rng.int(3) }, () => memberOfType(type.list, rng));
  if ("union" in type) return memberOfType(rng.pick(type.union), rng);
  if ("one" in type) return rng.pick(type.one);
  if (!("record" in type)) return null;
  const out: Record<string, Json> = {};
  for (const key of Object.keys(type.record)) {
    if (!(type.optional ?? []).includes(key) || rng.chance(0.6)) out[key] = memberOfType(type.record[key] as ValueType, rng);
  }
  if (type.closed !== true && rng.chance(0.4)) {
    // The other fields of an open record can hold each value. These fields can make the record an envelope or a reference.
    if (!Object.hasOwn(type.record, "type")) out["type"] = rng.pick<Json>(["ref", "x", 7]);
    if (!Object.hasOwn(type.record, "value")) out["value"] = rng.pick<Json>([["names", "h0"], ["self"], { a: 1 }, 3]);
  }
  return out;
}

/** This function gives a key of a step into a member of a type, mostly a key that the type has, and the type of the step. */
function stepOf(type: ValueType, rng: Random): readonly [Key, ValueType] {
  const other = (): readonly [Key, ValueType] => [rng.pick(STEP_KEYS), "unknown"];
  if (rng.chance(0.2)) return other();
  if (type === "point") return [rng.pick(["x", "y"]), "number"];
  if (typeof type === "string") return other();
  if ("list" in type) return rng.chance(0.3) ? ["length", "number"] : [0, type.list];
  if ("union" in type) return stepOf(rng.pick(type.union), rng);
  if ("record" in type) {
    const keys = Object.keys(type.record);
    if (keys.length === 0) return other();
    const key = rng.pick(keys);
    return [key, type.record[key] as ValueType];
  }
  return other();
}

/** This function makes a random path from a root. Its steps mostly follow the type of the root. */
function rootPath(rng: Random, bound: readonly string[], types: Readonly<Record<string, ValueType>>): Json[] {
  const root = rng.pick(["names", "names", "self", "world", "event", "caps"] as const);
  const path: Json[] = [root];
  let type: ValueType = root === "caps" ? CAPS_TYPE : (types[root] ?? "unknown");
  if (root === "names") {
    const name = rng.pick([...HOST, ...bound]);
    path.push(name);
    type = bound.includes(name) ? "unknown" : (types[name] ?? "unknown");
  }
  const steps = rng.int(3);
  for (let index = 0; index < steps; index += 1) {
    const [key, next] = stepOf(type, rng);
    path.push(key);
    type = next;
  }
  return path;
}

/** This function makes a random document that reads the roots, with the constructs of the kit, operations and the kinds that change the roots. */
function rootDoc(rng: Random, depth: number, bound: readonly string[], types: Readonly<Record<string, ValueType>>): Json {
  if (depth <= 0 || rng.chance(0.35)) return ref(...rootPath(rng, bound, types));
  const sub = (more: readonly string[] = []): Json => rootDoc(rng, depth - 1, [...bound, ...more], types);
  const name = rng.pick(["n", "m"]);
  const makers: readonly (() => Json)[] = [
    () => ({ type: "list", value: [sub(), sub()] }),
    () => ({ type: "record", value: { a: sub(), b: sub() } }),
    // A record with only the keys of a header gives an envelope, or a reference document when its value is a path.
    () => ({ type: "record", value: { type: rng.pick(["ref", "x"]), value: sub() } }),
    () => bind({ [name]: sub() }, sub([name])),
    () => op("add", sub(), sub()),
    () => op("concat", sub(), sub()),
    () => op("len", sub()),
    () => op("not", sub()),
    () => when(sub(), sub(), sub()),
    () => ({ type: rng.pick(["swap", "swapRuled"]), value: { body: sub() } }),
    () => call(fn([name], sub([name])), sub()),
  ];
  return rng.pick(makers)();
}

/** A mark for a schema that accepts no value. */
const NONE: unique symbol = Symbol("none");

/** This function makes a random schema of the subset that typeFromSchema reads, sometimes with a keyword that only tests more. */
function genSchema(rng: Random, depth: number): unknown {
  const leaf = (): unknown =>
    rng.pick<unknown>([{ type: "null" }, { type: "boolean" }, { type: "number", minimum: 0 }, { type: "integer" }, { type: "string", maxLength: 3 }, { enum: [1, "a", null] }, { const: { a: 1 } }, true]);
  if (depth <= 0 || rng.chance(0.3)) return leaf();
  const form = rng.int(5);
  if (form === 0) return { type: "array", items: genSchema(rng, depth - 1) };
  if (form === 1) return { [rng.pick(["anyOf", "oneOf"])]: [genSchema(rng, depth - 1), genSchema(rng, depth - 1)] };
  if (form === 2) return { type: ["string", "null"] };
  const properties: Record<string, unknown> = {};
  for (const key of ["a", "b", "c"]) if (rng.chance(0.6)) properties[key] = genSchema(rng, depth - 1);
  const required = Object.keys(properties).filter(() => rng.chance(0.5));
  return { type: "object", properties, required, ...(rng.chance(0.5) ? { additionalProperties: false } : {}) };
}

/** This function makes a random value that a generated schema accepts, or `NONE`. */
function valueOfSchema(schema: unknown, rng: Random): Json | typeof NONE {
  if (schema === true) return jsonValue(rng, 2);
  if (typeof schema !== "object" || schema === null) return NONE;
  const s = schema as Readonly<Record<string, unknown>>;
  if (Array.isArray(s["enum"])) return rng.pick(s["enum"] as Json[]);
  if (Object.hasOwn(s, "const")) return s["const"] as Json;
  for (const key of ["anyOf", "oneOf"]) if (Array.isArray(s[key])) return valueOfSchema(rng.pick(s[key] as unknown[]), rng);
  const type = Array.isArray(s["type"]) ? rng.pick(s["type"] as string[]) : (s["type"] as string);
  if (type === "null") return null;
  if (type === "boolean") return rng.chance(0.5);
  if (type === "number") return rng.pick([0, 2.5, 7]);
  if (type === "integer") return rng.pick([0, 3]);
  if (type === "string") return rng.pick(["", "ab"]);
  if (type === "array") {
    const items: Json[] = [];
    for (let index = rng.int(3); index > 0; index -= 1) {
      const item = valueOfSchema(s["items"], rng);
      if (item !== NONE) items.push(item);
    }
    return items;
  }
  const properties = (s["properties"] ?? {}) as Readonly<Record<string, unknown>>;
  const required = (s["required"] ?? []) as readonly string[];
  const out: Record<string, Json> = {};
  for (const key of Object.keys(properties)) {
    if (!required.includes(key) && rng.chance(0.4)) continue;
    const value = valueOfSchema(properties[key], rng);
    if (value === NONE) {
      if (required.includes(key)) return NONE;
      continue;
    }
    out[key] = value;
  }
  if (s["additionalProperties"] !== false && rng.chance(0.4)) out["zz"] = jsonValue(rng, 1);
  return out;
}

/** This function makes a random JSON value: base values, lists and records. */
function jsonValue(rng: Random, depth: number): Json {
  const form = depth <= 0 ? rng.int(4) : rng.int(6);
  if (form === 0) return null;
  if (form === 1) return rng.chance(0.5);
  if (form === 2) return rng.pick([0, -1.5, 3]);
  if (form === 3) return rng.pick(["", "a", "bc"]);
  if (form === 4) return Array.from({ length: rng.int(3) }, () => jsonValue(rng, depth - 1));
  const out: Record<string, Json> = {};
  for (const key of ["a", "b", "c"]) if (rng.chance(0.5)) out[key] = jsonValue(rng, depth - 1);
  return out;
}
