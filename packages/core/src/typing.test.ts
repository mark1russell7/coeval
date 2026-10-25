import { describe, expect, it } from "vitest";
import {
  type CompiledEvaluator,
  type FormulaProfile,
  type GenerateOptions,
  type Issue,
  type Json,
  type Key,
  type Machine,
  type OpFn,
  type Random,
  type Signature,
  type TraceNode,
  type TypeRule,
  type ValueType,
  check,
  evaluate,
  fail,
  formulaEvaluators,
  formulaMachine,
  generate,
  jsTruthy,
  member,
  ok,
  prepare,
  random,
  typeCheck,
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
      [{ type: ["ext", "undefined"], value: null }, "unknown"],
    ];
    for (const [doc, type] of cases) {
      const typing = typeCheck(typed, doc, LIT);
      expect(typing.issues, JSON.stringify(doc)).toEqual([]);
      expect(typing.type, JSON.stringify(doc)).toEqual(type);
    }
    // A reference to a name of the host, to another root, or with more steps has no type yet (K25).
    for (const path of [["names", "host"], ["self"], ["world", "a"], ["names", "n", "a"]] as const) {
      expect(typeCheck(typed, bind({ n: { type: "record", value: { a: 1 } } }, ref(...path)), { ...LIT, names: ["host"] }).type).toBe("unknown");
    }
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
    // An otherwise of undefined has no type: the kernel has no base type for it yet (K49).
    expect(typeCheck(formulaMachine({ otherwise: undefined }), when(true, 1), LIT).type).toBe("unknown");
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
