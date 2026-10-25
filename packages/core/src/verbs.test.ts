import { describe, expect, it } from "vitest";
import {
  type CompiledEvaluator,
  type DerefCode,
  type Effect,
  type EvalFn,
  type Failed,
  type FormulaProfile,
  type Kind,
  type Machine,
  type MachinePart,
  type Namespace,
  type Navigator,
  type Part,
  type Walker,
  type WorldEntry,
  STD_MACHINE,
  agree,
  check,
  context,
  evaluate,
  formulaDefinitions,
  formulaMachine,
  generate,
  isKey,
  isRecord,
  mergeMachines,
  nodeAt,
  ok,
  planner,
  prepare,
  reference,
  resolve,
  run,
  typesOf,
} from "./index.ts";

/*
 * The verb format: the text form of a document (VERB.FORMAT). A language adds it as it adds kinds, with a merge. The
 * kernel does not know the verb. The default reads the contract and writes kind(part, part). Three kinds of the formula
 * kit get their own entries: a literal writes its JSON, a reference writes its path, and an operation writes an infix
 * form.
 */

/** The text of a part in the value of a document. The printer writes it as it is. */
class Text {
  constructor(readonly text: string) {}
}

/** This function writes a value with texts of parts in it. A list and a record keep their form. */
function print(value: unknown): string {
  if (value instanceof Text) return value.text;
  if (Array.isArray(value)) return `[${value.map(print).join(", ")}]`;
  if (isRecord(value)) return `{${fields(value)}}`;
  return JSON.stringify(value) ?? "null";
}

function fields(record: Readonly<Record<string, unknown>>): string {
  return Object.keys(record)
    .map((key) => `${key}: ${print(record[key])}`)
    .join(", ");
}

/** This function gives the texts of the parts in their order, or the first error. */
function texts(parts: readonly Part[]): { readonly texts: readonly string[] } | Failed {
  const out: string[] = [];
  for (const part of parts) {
    const result = part.evaluate();
    if (!result.ok) return result;
    out.push(String(result.value));
  }
  return { texts: out };
}

const INFIX: Readonly<Record<string, string>> = { add: "+", sub: "-", mul: "*", div: "/" };

/** The code of the verb format. Each evaluator gives the text of its document, and a part gives its own text. */
const FORMAT_CODE: Readonly<Record<string, EvalFn>> = {
  "format.default": ({ kind, parts, fill }) => {
    const all = texts(parts);
    if (!("texts" in all)) return all;
    const value = fill(all.texts.map((text) => new Text(text)));
    const inner = Array.isArray(value) ? value.map(print).join(", ") : isRecord(value) ? fields(value) : value === null ? "" : print(value);
    return ok(`${kind}(${inner})`);
  },
  "format.lit": ({ doc }) => ok(print(doc.value)),
  "format.ref": ({ data }) => ok(Array.isArray(data) ? data.map((step) => (isKey(step) ? String(step) : print(step))).join(".") : `ref(${print(data)})`),
  "format.op": ({ typePath, parts }) => {
    const all = texts(parts);
    if (!("texts" in all)) return all;
    const name = typePath.slice(1).join(".");
    const symbol = Object.hasOwn(INFIX, name) ? INFIX[name] : undefined;
    return ok(symbol !== undefined && all.texts.length > 1 ? `(${all.texts.join(` ${symbol} `)})` : `${name}(${all.texts.join(", ")})`);
  },
};

/** This function gives a kind with one more verb. */
function withVerb(entry: WorldEntry | undefined, verb: string, name: string): Kind {
  const kind = entry as Kind;
  return { ...kind, verbs: { ...kind.verbs, [verb]: name } };
}

/**
 * This function gives the part of a merge that adds the verb format to a formula machine. Today a language replaces a
 * kind of the kit to give it a verb (WORLD.REPLACE). The default needs no replacement.
 */
function formatPart(withDefault: boolean): (prev: Machine) => MachinePart {
  return (prev) => {
    const kinds = prev.world.kinds;
    const ops = kinds["ops"] as Namespace;
    return {
      world: {
        kinds: {
          lit: withVerb(kinds["lit"], "format", "format.lit"),
          ref: withVerb(kinds["ref"], "format", "format.ref"),
          ops: { kinds: {}, fallback: withVerb(ops.fallback, "format", "format.op") },
        },
        ...(withDefault ? { defaults: { format: "format.default" } } : {}),
        replaces: [["kinds", "lit"], ["kinds", "ref"], ["kinds", "ops", "fallback"]],
      },
      evaluators: FORMAT_CODE,
    };
  };
}

const PROFILE: FormulaProfile = {
  ops: { add: (a: number, b: number) => a + b, mul: (a: number, b: number) => a * b },
};

const machine = mergeMachines(formulaMachine(PROFILE), formatPart(true));
const noDefault = mergeMachines(formulaMachine(PROFILE), formatPart(false));

const program = {
  type: "let",
  value: {
    bind: { x: { type: ["ops", "add"], value: [1, 2] } },
    body: { type: "if", value: { test: true, then: { type: ["ops", "mul"], value: [{ type: "ref", value: ["names", "x"] }, 10] }, else: "no" } },
  },
};

const TEXT = 'let(bind: {x: (1 + 2)}, body: if(test: true, then: (names.x * 10), else: "no"))';
const lit = { declaredType: "lit" } as const;

describe("verbs", () => {
  it("[VERB.FORMAT] a language adds the verb format with a merge, and the kernel does not change", () => {
    expect(prepare(machine, program, { ...lit, verb: "format" }).evaluate()).toEqual(ok(TEXT));
    // The merge keeps the verb eval of each kind.
    expect(prepare(machine, program, lit).evaluate()).toEqual(ok(30));
    const fn = { type: "call", value: { fn: { type: "fn", value: { params: ["y"], body: { type: "ref", value: ["names", "y"] } } }, args: [7] } };
    expect(prepare(machine, fn, { ...lit, verb: "format" }).evaluate()).toEqual(ok('call(fn: fn(params: ["y"], body: names.y), args: [7])'));
    expect(prepare(machine, { type: ["ext", "date"], value: "2026-10-24" }, { verb: "format" }).evaluate()).toEqual(ok('ext.date("2026-10-24")'));
    // An operation that the language does not have still has a text form.
    expect(prepare(machine, { type: ["ops", "nope"], value: [1] }, { ...lit, verb: "format" }).evaluate()).toEqual(ok("nope(1)"));
  });

  it("[VERB.PREPARE] a plan of another verb evaluates, runs and traces as a plan of eval does", async () => {
    const plan = prepare(machine, program, { ...lit, verb: "format" });
    expect(plan.evaluate()).toEqual(ok(TEXT));
    expect(plan.evaluate()).toEqual(ok(TEXT));
    expect(await plan.run()).toEqual(ok(TEXT));
    expect(prepare(machine, program, { ...lit, verb: "format", trace: true }).evaluate()).toEqual(ok(TEXT));
    expect((await run(machine, program, context(), { ...lit, verb: "format" })).result).toEqual(ok(TEXT));
    const traced = evaluate(machine, program, context(), { ...lit, verb: "format" });
    expect(traced.result).toEqual(ok(TEXT));
    expect(traced.trace.answer).toMatchObject({ verb: "format", evaluator: "format.default", rung: "default" });
    // A document that the ladder does not see keeps the verb of the plan in its trace.
    expect(evaluate(machine, 5, context(), { verb: "format" }).trace.answer).toMatchObject({ verb: "format", error: "no-answer" });
    const plans = planner(machine, { ...lit, verb: "format" });
    expect(plans(program)).toBe(plans(program));
    expect(plans(program).evaluate()).toEqual(ok(TEXT));
  });

  it("[VERB.DEFAULT] without a verb, each function asks for eval and gives the result that it gave before", () => {
    expect(prepare(machine, program, lit).evaluate()).toEqual(prepare(machine, program, { ...lit, verb: "eval" }).evaluate());
    expect(evaluate(machine, program, context(), lit).trace.answer.verb).toBe("eval");
    // The formula kit compiles its evaluators, thus the reference reads their definitions (REF.FORMULA).
    const definitions = formulaDefinitions(PROFILE);
    expect(reference(machine, program, context(), { ...lit, definitions })).toEqual(ok(30));
    expect(reference(machine, program, context(), { ...lit, definitions, verb: "eval" })).toEqual(ok(30));
    const unknown = { type: ["ops", "nope"], value: [1] };
    expect(check(machine, unknown)).toEqual(check(machine, unknown, { verb: "eval" }));
    expect(check(machine, unknown).map((issue) => issue.code)).toEqual(["#NAME?"]);
    expect(agree(machine, program, context(), { ...lit, definitions })).toMatchObject({ ok: true, result: ok(30) });
  });

  it("[VERB.LADDER] each verb visits the own entry, then the kind, then the default", () => {
    const doc = { type: "list", value: [{ type: ["ops", "add"], value: [1, 2] }, { type: ["ops", "add"], value: [1, 2], own: { format: "format.default" } }] };
    expect(prepare(machine, doc, { ...lit, verb: "format" }).evaluate()).toEqual(ok("list((1 + 2), ops.add(1, 2))"));
    // The own entry of one verb does not answer another verb.
    expect(prepare(machine, doc, lit).evaluate()).toEqual(ok([3, 3]));
    const trace = evaluate(machine, doc, context(), { ...lit, verb: "format" }).trace;
    expect([trace, nodeAt(trace, [0]), nodeAt(trace, [1])].map((node) => node?.answer.rung)).toEqual(["default", "kind", "own"]);
    // A kind that the world does not have stops the question before the default, as for eval.
    expect(prepare(machine, { type: "nope", value: 1 }, { verb: "format" }).evaluate()).toMatchObject({ ok: false, error: { code: "#KIND?" } });
  });

  it("[VERB.LADDER] deref visits the own entry, the kind and the default of the world, then a step into the value", () => {
    const derefs: Readonly<Record<string, DerefCode>> = {
      "deref.upper": (_doc, key) => String(key).toUpperCase(),
      "deref.kind": () => "kind",
      "deref.own": () => "own",
    };
    const nav: Navigator = {
      world: { kinds: { box: { verbs: {} }, card: { verbs: { deref: "deref.kind" } } }, defaults: { deref: "deref.upper" } },
      derefs,
    };
    const ctx = context({
      names: {
        box: { type: "box", value: { x: 1 } },
        card: { type: "card", value: { x: 1 } },
        own: { type: "card", value: { x: 1 }, own: { deref: "deref.own" } },
        lost: { type: "lost", value: { x: 1 } },
        data: { x: 1 },
      },
    });
    const reached = (path: readonly unknown[], at = nav): unknown => {
      const found = resolve(at, ctx, path);
      return found.ok ? [found.thing, found.hops.at(-1)?.by] : found.code;
    };
    expect(reached(["names", "box", "x"])).toEqual(["X", "default"]);
    expect(reached(["names", "card", "x"])).toEqual(["kind", "kind"]);
    expect(reached(["names", "own", "x"])).toEqual(["own", "own"]);
    // An unknown kind stops the question, and a value without a type is data: the step goes into the value.
    expect(reached(["names", "lost", "x"])).toEqual([1, "default"]);
    expect(reached(["names", "data", "x"])).toEqual([1, "default"]);
    // Without a default, or with a default that has no code, the step goes into the value, as before.
    expect(reached(["names", "box", "x"], { ...nav, world: { ...nav.world, defaults: {} } })).toEqual([1, "default"]);
    expect(reached(["names", "box", "x"], { ...nav, world: { ...nav.world, defaults: { deref: "deref.none" } } })).toEqual([1, "default"]);
  });

  it("[VERB.LADDER] step visits the own entry, the kind and the default, and check agrees with a run", () => {
    const first: Walker = ({ here, deref }) => {
      const reached = deref(here, 0);
      return reached === undefined ? { ok: false, reason: "The list is empty." } : { ok: true, thing: reached };
    };
    const last: Walker = ({ here, deref }) => {
      const length = deref(here, "length");
      const reached = typeof length === "number" ? deref(here, length - 1) : undefined;
      return reached === undefined ? { ok: false, reason: "The list is empty." } : { ok: true, thing: reached };
    };
    const kinds = { pick: { verbs: {} }, end: { verbs: { step: "walk.last" } } };
    const stepping = mergeMachines(STD_MACHINE, { world: { kinds, defaults: { step: "walk.first" } }, walkers: { "walk.first": first, "walk.last": last } });
    const plain = mergeMachines(STD_MACHINE, { world: { kinds }, walkers: { "walk.last": last } });
    const ctx = context({ names: { list: [10, 20, 30] } });
    const at = (step: unknown): unknown => ({ type: "ref", value: ["names", "list", step] });
    const pick = { type: "pick", value: null };
    for (const [doc, value] of [
      [at(pick), 10],
      [at({ type: "end", value: null }), 30],
      [at({ type: "pick", value: null, own: { step: "walk.last" } }), 30],
    ] as const) {
      expect(evaluate(stepping, doc, ctx).result).toEqual(ok(value));
      expect(check(stepping, doc, { names: ["list"] })).toEqual([]);
    }
    expect(evaluate(plain, at(pick), ctx).result).toMatchObject({ ok: false, error: { code: "#STEP?" } });
    expect(check(plain, at(pick), { names: ["list"] }).map((issue) => issue.code)).toEqual(["#STEP?"]);
  });

  it("[VERB.CHECK] check asks the ladder of its verb, and only eval checks the declared effects", () => {
    expect(check(machine, program, { ...lit, verb: "format" })).toEqual([]);
    // Without a default, the kind if has no evaluator for format. The check and the plan give the same code and place.
    const issues = check(noDefault, program, { ...lit, verb: "format" });
    expect(issues.map((issue) => [issue.code, issue.place])).toEqual([
      ["#NOEVAL", []],
      ["#NOEVAL", ["body"]],
    ]);
    const failed = prepare(noDefault, program, { ...lit, verb: "format" }).evaluate();
    expect(failed).toMatchObject({ ok: false, error: { code: "#NOEVAL", place: [] } });
    // The hook known follows the evaluator of the verb: format writes an unknown operation, and eval fails on it.
    const unknown = { type: ["ops", "nope"], value: [1] };
    expect(check(machine, unknown, lit).map((issue) => issue.code)).toEqual(["#NAME?"]);
    expect(check(machine, unknown, { ...lit, verb: "format" })).toEqual([]);
    // The effects of a contract are the effects of eval. A text form of an effect causes no effect.
    const logging = mergeMachines(STD_MACHINE, { world: { defaults: { format: "format.default" } }, evaluators: { "format.default": FORMAT_CODE["format.default"] as EvalFn } });
    const log = { type: "log", value: ["hi"] };
    expect(check(logging, log, { caps: [] }).map((issue) => issue.code)).toEqual(["#CAP!"]);
    expect(check(logging, log, { caps: [], verb: "format" })).toEqual([]);
    const effects: Effect[] = [];
    expect(prepare(logging, log, { verb: "format" }).evaluate(context({ caps: [] }), { effects })).toEqual(ok('log(text("hi"))'));
    expect(effects).toEqual([]);
    // The shapes and the names follow the contracts, thus they are the same for each verb.
    const unbound = { type: "ref", value: ["names", "y"] };
    expect(check(machine, unbound, { verb: "format" }).map((issue) => issue.code)).toEqual(check(machine, unbound).map((issue) => issue.code));
  });

  it("[VERB.CONTRACT] the kernel narrows the capabilities of each part by the contract, for each verb", () => {
    // A verb say that causes one effect at each document, with the text of its kind.
    const say: EvalFn = ({ kind, parts, effect }) => {
      for (const part of parts) {
        const result = part.evaluate();
        if (!result.ok) return result;
      }
      return effect("log", kind);
    };
    const saying = mergeMachines(STD_MACHINE, { world: { defaults: { say: "say.log" } }, evaluators: { "say.log": say } });
    const doc = { type: "list", value: [{ type: "number", value: 1 }, { type: "pure", value: [{ type: "number", value: 2 }] }] };
    const effects: Effect[] = [];
    const result = prepare(saying, doc, { verb: "say" }).evaluate(context({ caps: ["log"] }), { effects });
    // pure masks the capabilities of its part, also for the verb say.
    expect(result).toMatchObject({ ok: false, error: { code: "#CAP!", place: [1, 0] } });
    expect(effects.map((effect) => effect.payload)).toEqual(["number"]);
    expect(reference(saying, doc, context({ caps: ["log"] }), { verb: "say" })).toMatchObject({ ok: false, error: { code: "#CAP!", place: [1, 0] } });
    // Without pure, each document causes its effect, in the order of the ends.
    const open = { type: "list", value: [{ type: "number", value: 1 }] };
    const all: Effect[] = [];
    expect(prepare(saying, open, { verb: "say" }).evaluate(context({ caps: ["log"] }), { effects: all })).toMatchObject({ ok: true });
    expect(all.map((effect) => effect.payload)).toEqual(["number", "list"]);
  });

  it("[VERB.AGREE] the reference reads each verb by the same rules, and generated documents agree for format", () => {
    const options = { declaredType: "lit", types: [...typesOf(machine.world), ["ops", "add"], ["ops", "mul"], ["ops", "nope"], ["ext", "date"]], names: ["a", "b"] };
    const ctx = context({ names: { a: 1, b: [1, 2] } });
    let values = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const doc = generate(machine.world, { ...options, seed });
      const outcome = agree(machine, doc, ctx, { strict: true, declaredType: "lit", verb: "format" });
      expect(outcome, JSON.stringify(doc)).toMatchObject({ ok: true });
      if (outcome.ok && outcome.result.ok) values += 1;
    }
    expect(values).toBeGreaterThan(100);
    // A compiled evaluator of a verb needs a definition in the reference, as for eval (REF.DIRECT).
    const compiled: CompiledEvaluator = { compile: () => () => ok("compiled") };
    const sealed = mergeMachines(machine, { evaluators: { "format.compiled": compiled } });
    const doc = { type: "lit", value: 1, own: { format: "format.compiled" } };
    expect(agree(sealed, doc, ctx, { verb: "format" })).toMatchObject({ ok: false, tier: "reference" });
    expect(agree(sealed, doc, ctx, { verb: "format", definitions: { evaluators: { "format.compiled": () => ok("compiled") } } })).toMatchObject({ ok: true, result: ok("compiled") });
    // The second tier of a language gets the verb in its input.
    const verbs: unknown[] = [];
    const outcome = agree(machine, program, ctx, {
      ...lit,
      verb: "format",
      other: (given, context, input) => {
        verbs.push(input.verb);
        return prepare(machine, given, { ...lit, ...(input.verb === undefined ? {} : { verb: input.verb }) }).evaluate(context);
      },
    });
    expect(outcome).toMatchObject({ ok: true, result: ok(TEXT) });
    expect(verbs).toEqual(["format"]);
  });
});
