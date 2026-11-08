import { describe, expect, it } from "vitest";
import {
  type AllOptions,
  type Cap,
  type CompiledEvaluator,
  type CompiledRunner,
  type Context,
  type DerefCode,
  type Domain,
  type Effect,
  type EvalFn,
  type Finding,
  type FormulaProfile,
  type Kind,
  type Machine,
  type Result,
  type RunFn,
  type RunPart,
  type Steps,
  type Walker,
  Failure,
  Held,
  STD_CAPS,
  STD_DOMAINS,
  STD_MACHINE,
  conforms,
  fail,
  formulaDefinitions,
  formulaMachine,
  isHostThing,
  jsTruthy,
  makeContext,
  mergeMachines,
  nearestWalker,
  ok,
  run,
} from "./index.ts";

/** The standard machine with more kinds, evaluators and runners. */
function machineWith(kinds: Readonly<Record<string, Kind>>, evaluators: Readonly<Record<string, EvalFn | CompiledEvaluator>> = {}, runners: Readonly<Record<string, RunFn | CompiledRunner>> = {}): Machine {
  return {
    ...STD_MACHINE,
    world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, ...kinds } },
    evaluators: { ...STD_MACHINE.evaluators, ...evaluators },
    runners: { ...STD_MACHINE.runners, ...runners },
  };
}

/** A kind whose parts are a list, with the evaluator `name` for `eval`. */
function listKind(name: string, more: Partial<Kind> = {}): Kind {
  return { verbs: { eval: name }, parts: { shape: "list" }, ...more };
}

/** The obligations of a list of findings. */
function obligations(found: readonly Finding[]): readonly string[] {
  return found.map((finding) => finding.obligation);
}

/** This function evaluates each part with a context, and gives the list of the values or the first error. */
function each(parts: readonly { evaluate(context?: Context): Result }[], given?: Context): Result {
  const values: unknown[] = [];
  for (const part of parts) {
    const result = part.evaluate(given);
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

/** The code of a compiled list: each part with the context that `change` gives. */
function compiledList(change: (ctx: Context) => Context = (ctx) => ctx): CompiledEvaluator {
  return {
    compile:
      ({ parts }) =>
      (ctx, rt) => {
        const values: unknown[] = [];
        for (const part of parts) {
          const result = part.code(change(ctx), rt);
          if (!result.ok) return result;
          values.push(result.value);
        }
        return ok(values);
      },
  };
}

const OPS: Readonly<Record<string, (...args: never[]) => unknown>> = {
  add: (a: unknown, b: unknown) => {
    if (typeof a === "number" && typeof b === "number") return a + b;
    throw new TypeError("add needs two numbers.");
  },
  neg: (a: number) => -a,
  pair: (a: unknown, b: unknown) => [a, b],
  apply: (fn: (value: unknown) => unknown, value: unknown) => fn(value),
};

const LAZY: FormulaProfile["lazy"] = {
  ifError: (args) => {
    const first = args[0]?.() ?? fail("#ARGS", "ifError needs an argument.");
    return first.ok ? first : (args[1]?.() ?? first);
  },
  second: (args) => args[1]?.() ?? fail("#ARGS", "second needs two arguments."),
};

const EXT: FormulaProfile["ext"] = {
  here: (_data, ctx) => ok(ctx.self === null ? "none" : "self"),
  count: (_data, ctx) => ok(Object.keys(ctx.names).length),
};

const PROFILES: Readonly<Record<string, FormulaProfile>> = {
  strict: { ops: OPS, lazy: LAZY, ext: EXT },
  loose: {
    ops: OPS,
    lazy: LAZY,
    ext: EXT,
    truthy: jsTruthy,
    logic: "value",
    otherwise: undefined,
    omit: (error) => error.code === "#N/A",
    missing: (value) => value === undefined,
    check: (value) => (typeof value === "number" && !Number.isFinite(value) ? fail("#NUM!", "The number is not finite.") : undefined),
    combine: (errors) => ({ code: "#MANY", reason: `${errors.length} parts failed.` }),
    pure: true,
  },
  table: {
    ops: (name) => (Object.hasOwn(OPS, name) ? OPS[name] : undefined),
    truthy: (value) => (value === 1 ? true : value === 0 ? false : undefined),
    otherwise: "none",
  },
};

const OP_TYPES = [["ops", "add"], ["ops", "neg"], ["ops", "pair"], ["ops", "apply"], ["ops", "ifError"], ["ops", "second"], ["ops", "nothing"]];
const EXT_TYPES = [["ext", "number"], ["ext", "undefined"], ["ext", "here"], ["ext", "count"], ["ext", "nope"]];

/** The options of `conforms` for an evaluator of the formula kit. */
function formulaOptions(name: string, profile: FormulaProfile) {
  const types = name === "formula.op" ? OP_TYPES : name === "formula.ext" ? EXT_TYPES : undefined;
  return {
    definitions: formulaDefinitions(profile),
    // A name whose binding failed holds the error (FORMULA.LET). A reference to it gives the error.
    names: { x: "outer x", y: 2.5, h: new Held({ code: "#HELD", reason: "The binding failed." }) },
    values: { ref: [["names", "h"], ["names", "h", "x"]], "ext.number": ["NaN", "-0", "bad"] },
    ...(types === undefined ? {} : { types }),
  };
}

describe("the conformance of the standard library", () => {
  it("[CONFORM.STD] each evaluator and each runner of the standard machine conforms", () => {
    const names = [...Object.keys(STD_MACHINE.evaluators), ...Object.keys(STD_MACHINE.runners ?? {})];
    expect(names.length).toBeGreaterThan(12);
    for (const name of names) {
      // write needs a text key in its data, and the contract does not give it.
      expect(conforms(STD_MACHINE, name, { values: { write: [{ key: "k", value: 0 }] } }), name).toEqual([]);
    }
  });

  it("[CONFORM.STD] each evaluator of the formula kit conforms, with three profiles, and the compiled code agrees with its definition", () => {
    for (const [label, profile] of Object.entries(PROFILES)) {
      const machine = formulaMachine(profile);
      for (const name of Object.keys(machine.evaluators)) {
        // No kind of the kit names formula.step. The language below has one.
        if (name === "formula.step") continue;
        expect(conforms(machine, name, formulaOptions(name, profile)), `${label} ${name}`).toEqual([]);
      }
    }
  });

  it("[CONFORM.STD] a language with step documents in its paths conforms (FORMULA.STEPS)", () => {
    const at: Walker = ({ data, here, deref }) => ({ ok: true, thing: deref(here, String((data as { readonly key?: unknown } | null)?.key ?? "x")) });
    const language = formulaMachine(PROFILES["loose"], {
      replaces: [["world", "kinds", "ref"]],
      world: {
        kinds: {
          ref: { verbs: { eval: "formula.ref" }, parts: { shape: "deep" } },
          moves: { kinds: {}, fallback: { verbs: { eval: "formula.step", step: "walk.at" }, parts: { shape: "deep" } } },
          fence: { verbs: { eval: "formula.list" }, parts: { shape: "list", of: "lit" }, caps: [{ rule: "mask", in: [["1"]] }, { rule: "only", caps: ["log"] }] },
        },
        defaults: {},
      },
      walkers: { "walk.at": at },
    });
    const options = { definitions: formulaDefinitions(PROFILES["loose"]), values: { ref: [["names", { type: ["moves", "at"], value: { key: "x" } }]] } };
    for (const name of ["formula.ref", "formula.step", "formula.list"]) expect(conforms(language, name, options), name).toEqual([]);
  });
});

describe("the obligations of host code", () => {
  it("[CONFORM.NARROW] compiled code that gives a part more capabilities than its document has breaks C1", () => {
    const wide = machineWith({ wide: listKind("wide") }, { wide: compiledList((ctx) => ({ ...ctx, caps: ["log", "write"] })) });
    const found = conforms(wide, "wide");
    expect(obligations(found)).toEqual(["C1"]);
    expect(found[0]?.reason).toContain("the capabilities log, write");
    // The probe tells the document and the result of each part.
    expect(found[0]?.probe).toMatchObject({ type: "wide", running: false, waits: [] });
    expect(Object.keys(found[0]?.probe.results ?? {}).length).toBeGreaterThan(0);
    // The same code with a spread that keeps the capabilities conforms.
    expect(conforms(machineWith({ wide: listKind("wide") }, { wide: compiledList() }), "wide")).toEqual([]);
  });

  it("[CONFORM.NARROW] code that keeps a context from an earlier call breaks C1, and a function evaluator that widens breaks it too", () => {
    // The grant of the kernel does not see a context that compiled code keeps from an earlier evaluation (K120).
    const kept: CompiledEvaluator = {
      compile: ({ parts }) => {
        let first: Context | undefined;
        return (ctx, rt) => {
          first ??= ctx;
          const values: unknown[] = [];
          for (const part of parts) {
            const result = part.code(first, rt);
            if (!result.ok) return result;
            values.push(result.value);
          }
          return ok(values);
        };
      },
    };
    expect(obligations(conforms(machineWith({ kept: listKind("kept") }, { kept }), "kept"))).toEqual(["C1"]);
    // The kernel narrows the context that a function evaluator gives, but the evaluator still breaks its contract.
    const widens: EvalFn = ({ parts, context }) => each(parts, { ...context, caps: ["log"] });
    expect(obligations(conforms(machineWith({ widens: listKind("widens") }, { widens }), "widens"))).toEqual(["C1"]);
    // An effect of compiled code with a context that it widens breaks C1.
    const loud: CompiledEvaluator = { compile: () => (ctx, rt) => rt.effect({ ...ctx, caps: ["log"] }, "log", 1, []) };
    expect(obligations(conforms(machineWith({ loud: { verbs: { eval: "loud" }, effects: ["log"] } }, { loud }), "loud"))).toEqual(["C1"]);
  });

  it("[CONFORM.EFFECTS] code that causes an effect that its contract does not declare breaks C2", () => {
    const noisy: EvalFn = ({ parts, effect }) => {
      const all = each(parts);
      return all.ok ? effect("log", all.value) : all;
    };
    const found = conforms(machineWith({ noisy: listKind("noisy") }, { noisy }), "noisy");
    expect(obligations(found)).toEqual(["C2"]);
    expect(found[0]?.reason).toContain("declares no effects");
    // The same code conforms when the contract declares the effect.
    expect(conforms(machineWith({ noisy: listKind("noisy", { effects: ["log"] }) }, { noisy }), "noisy")).toEqual([]);
    // The effects "type" declare the type of the document itself, as for a call.
    const ping: EvalFn = ({ effect }) => effect("ping", 1);
    expect(conforms(machineWith({ ping: { verbs: { eval: "ping" }, effects: "type" } }, { ping }), "ping")).toEqual([]);
    const pong: EvalFn = ({ effect }) => effect("pong", 1);
    expect(obligations(conforms(machineWith({ ping: { verbs: { eval: "pong" }, effects: "type" } }, { pong }), "pong"))).toEqual(["C2"]);
    // For another verb, the entry of the verb in verbEffects is the declaration (VERB.EFFECTS).
    const saying = (says: readonly string[]): Kind => ({ verbs: { say: "noisy" }, parts: { shape: "list" }, verbEffects: { say: says } });
    expect(obligations(conforms(machineWith({ noisy: saying([]) }, { noisy }), "noisy", { verb: "say" }))).toEqual(["C2"]);
    expect(conforms(machineWith({ noisy: saying(["log"]) }, { noisy }), "noisy", { verb: "say" })).toEqual([]);
    // Without an entry for the verb, the contract does not declare its effects, thus C2 does not apply.
    expect(conforms(machineWith({ noisy: { verbs: { say: "noisy" }, parts: { shape: "list" } } }, { noisy }), "noisy", { verb: "say" })).toEqual([]);
  });

  it("[CONFORM.LAZY] code that skips an eager part, or that evaluates a lazy part whose result does not count, breaks C3", () => {
    const firstOnly: EvalFn = ({ parts }) => parts[0]?.evaluate() ?? ok(null);
    expect(obligations(conforms(machineWith({ first: listKind("first") }, { first: firstOnly }), "first"))).toEqual(["C3"]);
    // A lazy rule after the first part makes the same code conform.
    expect(conforms(machineWith({ first: listKind("first", { lazy: [{ after: 1 }] }) }, { first: firstOnly }), "first")).toEqual([]);
    // The facts of a contract describe only eval (D23), thus another verb gets no check of C3.
    expect(conforms(machineWith({ first: { verbs: { format: "first" }, parts: { shape: "list" } } }, { first: firstOnly }), "first", { verb: "format" })).toEqual([]);

    // An if that evaluates both branches, and gives one of them.
    const both: EvalFn = ({ parts }) => {
      const at = (key: string): Result => parts.find((part) => part.key === key)?.evaluate() ?? ok(null);
      const test = at("test");
      const then = at("then");
      const other = at("else");
      if (!test.ok) return test;
      if (typeof test.value !== "boolean") return fail("#VALUE!", "The test must give a truth value.");
      return test.value ? then : other;
    };
    const branches: Kind = { verbs: { eval: "both" }, parts: { shape: "record", fields: ["test", "then", "else"], required: ["test"] }, lazy: [{ in: [["then"], ["else"]] }] };
    const found = conforms(machineWith({ both: branches }, { both }), "both");
    expect(obligations(found)).toEqual(["C3"]);
    expect(found[0]?.reason).toContain("lazy part");
  });

  it("[CONFORM.PURE] the code of a pure kind that reads the context outside resolve, or that causes an effect, breaks C4", () => {
    const peek: EvalFn = ({ parts, context }) => {
      const all = each(parts);
      return all.ok ? ok([all.value, context.names["x"]]) : all;
    };
    const found = conforms(machineWith({ peek: listKind("peek", { pure: true }) }, { peek }), "peek");
    expect(obligations(found)).toEqual(["C4"]);
    expect(found[0]?.reason).toContain("outside resolve");
    // The same code is not wrong for a kind without the mark pure.
    expect(conforms(machineWith({ peek: listKind("peek") }, { peek }), "peek")).toEqual([]);
    // A read through resolve conforms.
    const look: EvalFn = ({ parts, resolve }) => {
      const all = each(parts);
      const found = resolve(["names", "x"]);
      return all.ok ? ok([all.value, found.ok ? found.thing : null]) : all;
    };
    expect(conforms(machineWith({ look: listKind("look", { pure: true }) }, { look }), "look")).toEqual([]);
    // A pure kind causes no effect, also a declared one.
    const shout: EvalFn = ({ parts, effect }) => {
      const all = each(parts);
      return all.ok ? effect("log", all.value) : all;
    };
    expect(obligations(conforms(machineWith({ shout: listKind("shout", { pure: true, effects: ["log"] }) }, { shout }), "shout"))).toEqual(["C4"]);
  });

  it("[CONFORM.SEALED] code that reads the JSON of its parts through doc breaks C5, and the binding names of the parts are permitted", () => {
    const leak: EvalFn = ({ parts, doc }) => {
      const all = each(parts);
      return all.ok ? ok([all.value, JSON.stringify(doc.value)]) : all;
    };
    const found = conforms(machineWith({ leak: listKind("leak") }, { leak }), "leak");
    expect(obligations(found)).toEqual(["C5"]);
    expect(found[0]?.reason).toContain("JSON of its parts");
    const headers: EvalFn = ({ parts }) => {
      const all = each(parts);
      return all.ok ? ok([all.value, parts.map((part) => part.name ?? null)]) : all;
    };
    expect(conforms(machineWith({ headers: listKind("headers") }, { headers }), "headers")).toEqual([]);
  });

  it("[CONFORM.WAIT] a runner that drops or makes a wait, an evaluator that gives a promise, and a compiled runner that cannot wait break C6", () => {
    // The runner drives the steps of its part itself, thus a wait of the part goes nowhere.
    const drops: RunFn = function* ({ parts }) {
      const values: unknown[] = [];
      for (const part of parts) {
        const step = part.evaluate().next();
        if (step.done !== true) return fail("#CALC!", "The part waited.");
        if (!step.value.ok) return step.value;
        values.push(step.value.value);
      }
      return ok(values);
    };
    const dropped = conforms(machineWith({ drops: listKind("drops") }, {}, { drops }), "drops");
    expect(obligations(dropped)).toEqual(["C6"]);
    expect(dropped[0]?.reason).toContain("drops the wait");
    expect(dropped[0]?.probe.running).toBe(true);
    expect(dropped[0]?.probe.waits.length).toBeGreaterThan(0);

    // A runner yields only the waits of its parts and its effects.
    const own: RunFn = function* ({ parts }) {
      yield Promise.resolve();
      return each(parts as never);
    };
    expect(obligations(conforms(machineWith({ own: listKind("own") }, {}, { own }), "own"))).toEqual(["C6"]);

    // An evaluator does not wait: a promise as its value is a wait that no runner passes on.
    const pending = new Promise<never>(() => undefined);
    const later: EvalFn = ({ parts }) => {
      const all = each(parts);
      return all.ok ? ok(pending) : all;
    };
    expect(obligations(conforms(machineWith({ later: listKind("later") }, { later }), "later"))).toEqual(["C6"]);

    // K65: a compiled runner that evaluates a part with its code. In a run, that code cannot wait.
    const quick: CompiledRunner = {
      compileRun: ({ parts }) =>
        function* (ctx, rt) {
          const values: unknown[] = [];
          for (const part of parts) {
            const result = part.code(ctx, rt);
            if (!result.ok) return result;
            values.push(result.value);
          }
          return ok(values);
        },
    };
    const k65 = conforms(machineWith({ quick: listKind("quick") }, {}, { quick }), "quick");
    expect(obligations(k65)).toEqual(["C6"]);
    expect(k65[0]?.reason).toContain("drives (D119)");
    // A contract that declares the parts in drives permits the code of those parts (RUN.DRIVES).
    expect(conforms(machineWith({ quick: listKind("quick", { drives: [{}] }) }, {}, { quick }), "quick")).toEqual([]);
    // A rule for the first part only does not cover the other parts.
    expect(obligations(conforms(machineWith({ quick: listKind("quick", { drives: [{ in: [[0]] }] }) }, {}, { quick }), "quick"))).toEqual(["C6"]);
    // The same runner with the steps of its parts conforms.
    const steps: CompiledRunner = {
      compileRun: ({ parts }) =>
        function* (ctx, rt) {
          const values: unknown[] = [];
          for (const part of parts) {
            const result = yield* part.run(ctx, rt);
            if (!result.ok) return result;
            values.push(result.value);
          }
          return ok(values);
        },
    };
    expect(conforms(machineWith({ steps: listKind("steps") }, {}, { steps }), "steps")).toEqual([]);
  });

  it("[CONFORM.SCOPE] code that binds another name, forgets a name of its scope rules, or hides a name of its document breaks C7", () => {
    const secret: EvalFn = ({ parts, context }) => each(parts, { ...context, names: { ...context.names, secret: 1 } });
    const found = conforms(machineWith({ secret: listKind("secret") }, { secret }), "secret");
    expect(obligations(found)).toEqual(["C7"]);
    expect(found[0]?.reason).toContain("binds secret");

    // A let that evaluates its bindings, and gives its body no names.
    const forgets: EvalFn = ({ parts }) => {
      for (const part of parts) if (part.path[0] === "bind") part.evaluate();
      return parts.find((part) => part.key === "body")?.evaluate() ?? fail("#VALUE!", "let needs a body.");
    };
    const letKind: Kind = {
      verbs: { eval: "forgets" },
      parts: { shape: "record", fields: { bind: { shape: "map" }, body: { shape: "term" } }, required: ["bind", "body"] },
      scope: [{ names: { keysAt: ["bind"] }, in: [["body"]] }],
    };
    const forgot = conforms(machineWith({ forgets: letKind }, { forgets }), "forgets");
    expect(obligations(forgot)).toEqual(["C7"]);
    expect(forgot[0]?.reason).toContain("does not bind");

    const hides: EvalFn = ({ parts, context }) => each(parts, { ...context, names: {} });
    expect(conforms(machineWith({ hides: listKind("hides") }, { hides }), "hides")[0]?.reason).toContain("does not see the names");
  });

  it("[CONFORM.LOCAL] code that keeps state from one call to the next, and compiled code that disagrees with its definition, break the local lemma", () => {
    let count = 0;
    const counter: EvalFn = ({ parts }) => {
      const all = each(parts);
      count += 1;
      return all.ok ? ok(count) : all;
    };
    const found = conforms(machineWith({ counter: listKind("counter") }, { counter }), "counter");
    expect(obligations(found)).toEqual(["local"]);
    expect(found[0]?.reason).toContain("keeps state");
    // State in the closure of compiled code breaks it too.
    const closure: CompiledEvaluator = {
      compile: () => {
        let calls = 0;
        return () => ok((calls += 1));
      },
    };
    expect(obligations(conforms(machineWith({ closure: { verbs: { eval: "closure" } } }, { closure }), "closure"))).toEqual(["local"]);

    // A compiled sum with the definition of a product: the two readings disagree (SIM-PLAN, step 3).
    const sum: CompiledEvaluator = {
      compile:
        ({ parts }) =>
        (ctx, rt) => {
          let total = 0;
          for (const part of parts) {
            const result = part.code(ctx, rt);
            if (!result.ok) return result;
            total += Number(result.value);
          }
          return ok(total);
        },
    };
    const product: EvalFn = ({ parts }) => {
      let total = 1;
      for (const part of parts) {
        const result = part.evaluate();
        if (!result.ok) return result;
        total *= Number(result.value);
      }
      return ok(total);
    };
    const machine = machineWith({ sum: listKind("sum") }, { sum });
    const disagree = conforms(machine, "sum", { definitions: { evaluators: { sum: product } } });
    expect(obligations(disagree)).toEqual(["agree"]);
    expect(disagree[0]?.reason).toContain("definition");
    expect(conforms(machine, "sum")).toEqual([]);
  });
});

describe("the obligation C8", () => {
  it("[CONFORM.PROFILE] a profile whose operations change between the compilation and the evaluation breaks C8", () => {
    let asked = 0;
    const plus = (a: number, b: number): number => a + b;
    const minus = (a: number, b: number): number => a - b;
    // The table gives another operation at each other question.
    const changing = formulaMachine({ ops: (name) => (name === "add" ? ((asked += 1) % 2 === 0 ? plus : minus) : undefined) as never });
    const found = conforms(changing, "formula.op", { types: [["ops", "add"]] });
    expect(obligations(found)).toEqual(["C8"]);
    expect(found[0]?.reason).toContain("when it compiles");
    // With the definitions of the kit, the finding stays C8: the agreement needs code without such reads.
    expect(obligations(conforms(changing, "formula.op", { types: [["ops", "add"]], definitions: formulaDefinitions({ ops: { add: plus } }) }))).toEqual(["C8"]);
    // A table that gives the same answer at each time conforms.
    const steady = formulaMachine({ ops: (name) => (name === "add" ? plus : undefined) as never });
    expect(conforms(steady, "formula.op", { types: [["ops", "add"]] })).toEqual([]);
  });
});

describe("the declared truth of a profile", () => {
  /** The evaluators of the kit that read a truth. */
  const READERS = ["formula.if", "formula.and", "formula.or"];
  /** The truth of a language with numbers as truths: `0` is false, and each other number is true. A text has no truth. */
  const numberTruthy = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : typeof value === "number" ? value !== 0 : undefined);
  /** The findings of the check truth for each reader of a truth. */
  const truthOf = (profile: FormulaProfile, more: Parameters<typeof formulaMachine>[1] = {}, results?: readonly Result[]): readonly (Finding | undefined)[] => {
    const machine = formulaMachine(profile, more);
    return READERS.map((name) => conforms(machine, name, { ...formulaOptions(name, profile), ...(results === undefined ? {} : { results }) }).find((finding) => finding.obligation === "truth"));
  };

  it("[CONFORM.TRUTH] a truthy that gives a truth for each member of its truth type conforms, and a value outside the type gets no test", () => {
    const profile: FormulaProfile = { ops: OPS, truthy: numberTruthy, truthType: { union: ["bool", "number"] } };
    const machine = formulaMachine(profile);
    for (const name of READERS) expect(conforms(machine, name, formulaOptions(name, profile)), name).toEqual([]);
    // The text "a" of the palette has no truth, but it is not a member of the truth type.
    expect(truthOf({ ops: OPS, truthy: numberTruthy, truthType: "bool" })).toEqual([undefined, undefined, undefined]);
  });

  it("[CONFORM.TRUTH] a truthy that throws for a member of its truth type breaks truth", () => {
    const throwing = (value: unknown): boolean | undefined => {
      if (value === 2) throw new Error("two has no truth here.");
      return numberTruthy(value);
    };
    const found = truthOf({ ops: OPS, truthy: throwing, truthType: { union: ["bool", "number"] } });
    for (const finding of found) {
      expect(finding?.reason).toContain("throws for the member 2 of the truth type bool | number");
      expect(finding?.reason).toContain("two has no truth here.");
    }
    // The probe gives the member to each part of the first probe document.
    expect(Object.values(found[0]?.probe.results ?? {})).toContainEqual(ok(2));
  });

  it("[CONFORM.TRUTH] a truthy that gives a value other than true or false for a member breaks truth", () => {
    const numbers = (value: unknown): boolean | undefined => (typeof value === "number" ? (value as unknown as boolean) : numberTruthy(value));
    for (const finding of truthOf({ ops: OPS, truthy: numbers, truthType: "number" })) expect(finding?.reason).toContain("gives 1 for the member 1 of the truth type number. A truth is true or false.");
    // A text is a member of the declared type, but numberTruthy gives it no truth.
    for (const finding of truthOf({ ops: OPS, truthy: numberTruthy, truthType: { union: ["bool", "text"] } })) expect(finding?.reason).toContain('gives no truth for the member "a"');
  });

  it("[CONFORM.TRUTH] a truth type with a list of values tests each value of the list, also a value outside the palette", () => {
    const level = { is: (value: unknown) => value === "low" || value === "high", under: ["text"], values: ["low", "high"] };
    const more = { domains: { level } };
    const both = (value: unknown): boolean | undefined => (value === "high" ? true : value === "low" ? false : undefined);
    expect(truthOf({ ops: OPS, truthy: both, truthType: "level" }, more)).toEqual([undefined, undefined, undefined]);
    const high = (value: unknown): boolean | undefined => (value === "high" ? true : undefined);
    for (const finding of truthOf({ ops: OPS, truthy: high, truthType: "level" }, more)) expect(finding?.reason).toContain('gives no truth for the member "low" of the truth type level');
  });

  it("[CONFORM.TRUTH] a truth type without a list of values tests the members of the results of the palette, and the option results adds samples", () => {
    const noFive = (value: unknown): boolean | undefined => (value === 5 ? undefined : numberTruthy(value));
    // The default palette and the samples of number do not hold 5 (D99).
    expect(truthOf({ ops: OPS, truthy: noFive, truthType: "number" })).toEqual([undefined, undefined, undefined]);
    const found = truthOf({ ops: OPS, truthy: noFive, truthType: "number" }, {}, [ok(5), ok(1), ok(true)]);
    for (const finding of found) expect(finding?.reason).toContain("gives no truth for the member 5 of the truth type number");
  });

  it("[CONFORM.SAMPLES] the check truth of number reads the samples 0 and -1 of the domain, after the results of the palette", () => {
    const read: unknown[] = [];
    const recording = (value: unknown): boolean | undefined => {
      read.push(value);
      return numberTruthy(value);
    };
    expect(truthOf({ ops: OPS, truthy: recording, truthType: "number" })).toEqual([undefined, undefined, undefined]);
    // The palette holds the numbers 1 and 2. The samples of number add 0 and -1.
    expect(read).toEqual(expect.arrayContaining([1, 2, 0, -1]));
    const noZero = (value: unknown): boolean | undefined => (value === 0 ? undefined : numberTruthy(value));
    for (const finding of truthOf({ ops: OPS, truthy: noZero, truthType: "number" })) expect(finding?.reason).toContain("gives no truth for the member 0 of the truth type number");
    const positive = (value: unknown): boolean | undefined => ((value as number) < 0 ? undefined : numberTruthy(value));
    for (const finding of truthOf({ ops: OPS, truthy: positive, truthType: "number" })) expect(finding?.reason).toContain("gives no truth for the member -1 of the truth type number");
    // A domain of the language gives its own samples. A sample outside the truth type does not count.
    const level: Domain = { is: (value) => typeof value === "string" && value.length > 0, under: ["text"], samples: ["low", 7] };
    const onlyA = (value: unknown): boolean | undefined => (value === "a" ? true : undefined);
    for (const finding of truthOf({ ops: OPS, truthy: onlyA, truthType: "level" }, { domains: { level } })) expect(finding?.reason).toContain('gives no truth for the member "low" of the truth type level');
  });

  it("[CONFORM.TRUTH] a standard profile, an own truthy without a truth type, a bad truth type and the other evaluators get no check", () => {
    const never = (): boolean | undefined => undefined;
    // The default truth ignores truthType (D81).
    expect(truthOf({ ops: OPS, truthType: "number" })).toEqual([undefined, undefined, undefined]);
    expect(truthOf({ ops: OPS, truthy: never })).toEqual([undefined, undefined, undefined]);
    // The check of types gives the issue of a bad type.
    expect(truthOf({ ops: OPS, truthy: never, truthType: "missing domain" })).toEqual([undefined, undefined, undefined]);
    const profile: FormulaProfile = { ops: OPS, truthy: never, truthType: "bool" };
    const machine = formulaMachine(profile);
    expect(obligations(conforms(machine, "formula.list", formulaOptions("formula.list", profile)))).not.toContain("truth");
    expect(obligations(conforms(machine, "formula.if", formulaOptions("formula.if", profile)))).toContain("truth");
  });
});

describe("the covers of a machine", () => {
  /** The domains of a language whose domains neg and nonneg cover number (D85). */
  const COVERED: Readonly<Record<string, Domain>> = {
    number: { ...(STD_DOMAINS["number"] as Domain), covers: [["neg", "nonneg"]] },
    neg: { is: (value) => (value as number) < 0, under: ["number"], summary: "A negative number." },
    nonneg: { is: (value) => !((value as number) < 0), under: ["number"], summary: "A number that is not negative." },
  };
  const withDomains = (domains: Readonly<Record<string, Domain>>): Machine => ({ ...STD_MACHINE, domains });

  it("[CONFORM.COVER] a machine whose covers hold each sample conforms, and a cover that does not count gets no test", () => {
    expect(conforms(withDomains(COVERED), "math.add")).toEqual([]);
    // The option results adds samples: 0, -3 and 1.5 are each in neg or in nonneg.
    expect(obligations(conforms(withDomains(COVERED), "math.add", { results: [ok(0), ok(-3), ok(1.5), ok("a")] }))).not.toContain("cover");
    // An empty cover, a cover with the domain itself and a cover with a name outside the line do not count (D85).
    const ignored: Readonly<Record<string, Domain>> = { ...COVERED, number: { ...(STD_DOMAINS["number"] as Domain), covers: [[], ["number"], ["neg", "text"]] } };
    expect(conforms(withDomains(ignored), "math.add")).toEqual([]);
  });

  it("[CONFORM.COVER] a new parent of a domain in a cover breaks the cover, and the finding names the sample", () => {
    // The new parent small of nonneg holds no number from 2 on. Then neither neg nor nonneg holds the sample 2.
    const small: Domain = { is: (value) => (value as number) < 2, under: ["number"], summary: "A number below 2." };
    const machine = withDomains({ ...COVERED, small, nonneg: { ...(COVERED["nonneg"] as Domain), under: ["number", "small"] } });
    const found = conforms(machine, "math.add");
    expect(obligations(found)).toEqual(["cover"]);
    expect(found[0]?.reason).toBe("The member 2 of the domain number is in no domain of its cover neg, nonneg. The check of types trusts the cover, thus it is unsound for number.");
    // The probe gives the sample to each part of the first probe document.
    expect(Object.values(found[0]?.probe.results ?? {})).toContainEqual(ok(2));
    // Each evaluator of the machine gets the check, because the check of types trusts the cover for each program.
    expect(obligations(conforms(machine, "data.number"))).toEqual(["cover"]);
    // A domain with a list values gives each value as a sample, also a value outside the palette.
    const level: Domain = { is: (value) => value === "low" || value === "mid" || value === "high", under: ["text"], values: ["low", "mid", "high"], covers: [["low", "high"]] };
    const low: Domain = { is: (value) => value === "low", under: ["level"] };
    const high: Domain = { is: (value) => value === "high", under: ["level"] };
    expect(conforms(withDomains({ level, low, high }), "math.add")[0]?.reason).toContain('The member "mid" of the domain level is in no domain of its cover low, high.');
  });

  it("[CONFORM.SAMPLES] the check cover reads the samples of the domains, thus a cover without 0 or -1 of number breaks cover", () => {
    // The palette has no 0, but the samples of number hold it. Neither neg nor plus holds 0.
    const plus: Domain = { is: (value) => (value as number) > 0, under: ["number"], summary: "A number over 0." };
    const noZero = withDomains({ ...COVERED, plus, number: { ...(STD_DOMAINS["number"] as Domain), covers: [["neg", "plus"]] } });
    expect(conforms(noZero, "math.add")[0]?.reason).toBe("The member 0 of the domain number is in no domain of its cover neg, plus. The check of types trusts the cover, thus it is unsound for number.");
    const notNeg: Domain = { is: (value) => (value as number) >= 0, under: ["number"], summary: "A number that is 0 or more." };
    const noMinus = withDomains({ ...COVERED, notNeg, number: { ...(STD_DOMAINS["number"] as Domain), covers: [["notNeg"]] } });
    expect(conforms(noMinus, "math.add")[0]?.reason).toContain("The member -1 of the domain number is in no domain of its cover notNeg.");
    // A domain of the language gives samples to the domain over it: -0.5 of half is in no domain of the cover.
    const half: Domain = { is: (value) => value === -0.5, under: ["number"], samples: [-0.5] };
    const below: Domain = { is: (value) => (value as number) <= -1, under: ["number"] };
    const atLeast: Domain = { is: (value) => (value as number) >= 0, under: ["number"] };
    const machine = withDomains({ half, below, atLeast, number: { ...(STD_DOMAINS["number"] as Domain), covers: [["below", "atLeast"]] } });
    expect(conforms(machine, "math.add")[0]?.reason).toContain("The member -0.5 of the domain number is in no domain of its cover below, atLeast.");
  });
});

/** The results of the probe parts of the tests of `all`: other numbers, thus each order gives another list. */
const NUMBERS: readonly Result[] = [ok(1), ok(2), ok(3), ok(5)];

/** This function gives the value of a result, or the code of its error. */
function outcome(result: Result): unknown {
  return result.ok ? result.value : result.error.code;
}

/** This function wraps each part: `after` gets the index and the result of the part when the part gives its result. */
function wrapped(parts: readonly RunPart[], after: (index: number, result: Result) => void): readonly RunPart[] {
  return parts.map((part, index) => ({
    ...part,
    *evaluate(context?: Context): Steps {
      const result = yield* part.evaluate(context);
      after(index, result);
      return result;
    },
  }));
}

/** A runner that gives the results in the order that they came. A sequence of the items hides this fault. */
function arrival(options?: AllOptions): RunFn {
  return function* ({ parts, all }) {
    const arrived: unknown[] = [];
    yield* all(wrapped(parts, (_index, result) => arrived.push(outcome(result))), options);
    return ok(arrived);
  };
}

/** A runner that gives its parts at the same time and each result at the place of its part. */
function together(options?: AllOptions): RunFn {
  return function* ({ parts, all }) {
    return ok((yield* all(parts, options)).map(outcome));
  };
}

/** A runner with `failFast`: it gives the first error of its list of results, or each value. */
function stops(items: (parts: readonly RunPart[]) => readonly RunPart[] = (parts) => parts): RunFn {
  return function* ({ parts, all }) {
    const results = yield* all(items(parts), { failFast: true });
    return results.find((result) => !result.ok) ?? ok(results.map(outcome));
  };
}

/** The findings of a runner for the kind `par`, with the numbers as the results of the parts. */
function ofRunner(code: RunFn | CompiledRunner, more: Partial<Kind> = {}, seed?: number): readonly Finding[] {
  return conforms(machineWith({ par: listKind("par", more) }, {}, { par: code }), "par", { results: NUMBERS, ...(seed === undefined ? {} : { seed }) });
}

describe("the orders of the parts of all", () => {
  it("[CONFORM.PARALLEL] code that gives its results in the order that they came breaks parallel, and the finding has the kind, the two orders and the two results", () => {
    const found = ofRunner(arrival());
    expect(obligations(found)).toEqual(["parallel"]);
    const finding = found[0] as Finding;
    expect(finding.reason).toMatch(/^The code of par depends on the order of its parallel parts\. The waits of all settle in the order \[the part 0, the part 1\] and the order \[the part 1, the part 0\]\. The first order gives the value \[(\d),(\d)\], and the second gives the value \[\2,\1\]\.$/);
    expect(finding.probe.type).toBe("par");
    expect(finding.probe.running).toBe(true);
    expect(finding.probe.waits).toEqual(["0", "1"]);
  });

  it("[CONFORM.PARALLEL] the two results of a finding come from the kernel: a real run gives them in the two orders of the host", async () => {
    const machine = machineWith({ par: listKind("par") }, {}, { par: arrival() });
    const doc = { type: "par", value: [{ type: "log", value: ["a"] }, { type: "log", value: ["b"] }] };
    const inOrder = async (order: readonly string[]): Promise<Result> => {
      const answers = new Map<string, () => void>();
      const perform = (effect: Effect): Promise<unknown> =>
        new Promise((done) => {
          answers.set(effect.payload as string, () => done(effect.payload));
          // The answers come after the kernel took each wait, thus the order of the answers is the order of the host.
          if (answers.size === order.length) setTimeout(() => order.forEach((name) => answers.get(name)?.()));
        });
      return (await run(machine, doc, makeContext({}, STD_CAPS), { perform })).result;
    };
    expect(await inOrder(["a", "b"])).toEqual(ok(["a", "b"]));
    expect(await inOrder(["b", "a"])).toEqual(ok(["b", "a"]));
  });

  it("[CONFORM.PARALLEL] a read before a wait and a write after it lose an update, because each item starts before the first wait settles", () => {
    const lost: RunFn = function* ({ parts, all }) {
      let total = 0;
      const items = parts.map((part) => ({
        ...part,
        *evaluate(context?: Context): Steps {
          const before = total;
          const result = yield* part.evaluate(context);
          total = before + (result.ok ? (result.value as number) : 0);
          return result;
        },
      }));
      yield* all(items);
      return ok(total);
    };
    const found = ofRunner(lost);
    expect(obligations(found)).toEqual(["parallel"]);
    expect(found[0]?.reason).toContain("The first order gives the value");
  });

  it("[CONFORM.PARALLEL] a choice that only a seeded order changes is found: the part that settles second is the same in the forward and the backward order", () => {
    const second: RunFn = function* ({ parts, all }) {
      const arrived: number[] = [];
      yield* all(wrapped(parts, (index) => arrived.push(index)));
      return ok(parts.length === 3 ? arrived[1] : null);
    };
    const found = ofRunner(second);
    expect(obligations(found)).toEqual(["parallel"]);
    expect(found[0]?.reason).toContain("the order [the part 0, the part 1, the part 2]");
  });

  it("[CONFORM.PARALLEL] effects and parts count without their order: another payload or another part is a finding", () => {
    const seen: RunFn = function* ({ parts, all, effect }) {
      const arrived: unknown[] = [];
      const logs = parts.map((part) => ({
        ...part,
        *evaluate(context?: Context): Steps {
          const result = yield* part.evaluate(context);
          arrived.push(outcome(result));
          return yield* effect("log", [...arrived]);
        },
      }));
      yield* all(logs);
      return ok(null);
    };
    const effects = ofRunner(seen, { effects: ["log"] });
    expect(obligations(effects)).toEqual(["parallel"]);
    expect(effects[0]?.reason).toMatch(/The effects differ: \[log .*\] and \[log .*\]\.$/);

    // The third item evaluates its part only when the second item came before the first.
    const skips: RunFn = function* ({ parts, all }) {
      const arrived: number[] = [];
      const items = wrapped(parts, (index) => arrived.push(index)).map((part, index) =>
        index === 2
          ? {
              ...part,
              *evaluate(context?: Context): Steps {
                return arrived[0] === 1 ? ok(null) : yield* part.evaluate(context);
              },
            }
          : part,
      );
      yield* all(items, { concurrency: 2 });
      return ok(null);
    };
    const skipped = ofRunner(skips, { lazy: [{}] });
    expect(obligations(skipped)).toContain("parallel");
    expect(skipped.find((finding) => finding.obligation === "parallel")?.reason).toMatch(/The parts that evaluate differ: \[.*\] and \[.*\]\.$/);

    // A log of each result at its own part gives the same effects in each order.
    const logs: RunFn = function* ({ parts, all, effect }) {
      const items = parts.map((part) => ({
        ...part,
        *evaluate(context?: Context): Steps {
          const result = yield* part.evaluate(context);
          return yield* effect("log", outcome(result));
        },
      }));
      return ok((yield* all(items)).map(outcome));
    };
    expect(ofRunner(logs, { effects: ["log"] })).toEqual([]);
  });

  it("[CONFORM.PARALLEL] a function in the result that reads the order is a finding", () => {
    const later: RunFn = function* ({ parts, all }) {
      const arrived: number[] = [];
      yield* all(wrapped(parts, (index) => arrived.push(index)));
      return ok(() => arrived[0]);
    };
    const equal = (a: unknown, b: unknown): boolean | undefined => (typeof a === "function" && typeof b === "function" ? true : undefined);
    const found = conforms(machineWith({ par: listKind("par") }, {}, { par: later }), "par", { results: NUMBERS, equal });
    expect(obligations(found)).toEqual(["parallel"]);
    expect(found[0]?.reason).toContain("The function that the result gives returns another result.");
  });

  it("[CONFORM.PARALLEL] code that conforms gets no finding: each limit, failFast, an all inside an item, and compiled code", () => {
    expect(ofRunner(together())).toEqual([]);
    expect(ofRunner(together({ concurrency: 2 }))).toEqual([]);
    // One item at a time has one order, also for the code of the first test.
    expect(ofRunner(arrival({ concurrency: 1 }))).toEqual([]);
    // With failFast, the first failure in the order of the host stops the other items. That difference is the rule ALL.
    // The two errors of the palette give another first error in the two orders, and the check does not count that.
    expect(conforms(machineWith({ par: listKind("par") }, {}, { par: stops() }), "par")).toEqual([]);

    const nested: RunFn = function* ({ parts, all }) {
      const inner: RunPart = {
        key: "inner",
        path: [],
        *evaluate(): Steps {
          return ok((yield* all(parts.slice(1))).map(outcome));
        },
      };
      const first = parts[0];
      return ok((yield* all(first === undefined ? [] : [first, inner])).map(outcome));
    };
    expect(ofRunner(nested)).toEqual([]);

    const compiled: CompiledRunner = {
      compileRun: ({ parts }) =>
        function* (ctx, rt) {
          const results = yield* rt.all(parts.map((part) => () => part.run(ctx, rt)));
          return ok(results.map(outcome));
        },
    };
    expect(ofRunner(compiled)).toEqual([]);
  });

  it("[CONFORM.PARALLEL] the rule ALL of the probe: a failed start, a throw, a stopped wait and a wait of the code", () => {
    // An item that throws at its start or in its steps gives an error at its place.
    const throwing: CompiledRunner = {
      compileRun: ({ parts }) =>
        function* (ctx, rt) {
          const fails = (): Steps => {
            throw new Error("The item fails at its start.");
          };
          const results = yield* rt.all([
            ...parts.map((part) => () => part.run(ctx, rt)),
            fails,
            function* (): Steps {
              throw new Error("The item fails in its steps.");
            },
          ]);
          return ok(results.map(outcome));
        },
    };
    expect(ofRunner(throwing)).toEqual([]);

    // The finally code of an item that stops throws. The stop of failFast still holds, and no wait is dropped.
    const stubborn = stops((parts) =>
      parts.map((part) => ({
        ...part,
        *evaluate(context?: Context): Steps {
          let ended = false;
          try {
            const result = yield* part.evaluate(context);
            ended = true;
            return result;
          } finally {
            if (!ended) throw new Error("The part does not stop.");
          }
        },
      })),
    );
    expect(conforms(machineWith({ par: listKind("par") }, {}, { par: stubborn }), "par")).toEqual([]);

    // A wait of the code under all stops the probe (C6), as a wait outside all does.
    const own: RunFn = function* ({ parts, all }) {
      const items = parts.map((part) => ({
        ...part,
        *evaluate(context?: Context): Steps {
          yield Promise.resolve();
          return yield* part.evaluate(context);
        },
      }));
      return ok((yield* all(items)).map(outcome));
    };
    expect(obligations(ofRunner(own))).toEqual(["C6"]);
  });

  it("[CONFORM.PARALLEL] the orders come from the document and the option seed, not from the time", () => {
    const second: RunFn = function* ({ parts, all }) {
      const arrived: number[] = [];
      yield* all(wrapped(parts, (index) => arrived.push(index)));
      return ok(parts.length === 3 ? arrived[1] : null);
    };
    expect(ofRunner(second)).toEqual(ofRunner(second));
    expect(ofRunner(second, {}, 7)).toEqual(ofRunner(second, {}, 7));
    expect(obligations(ofRunner(second, {}, 7))).toEqual(["parallel"]);
  });
});

/** The standard machine with the kind `probed`, whose verb `step` names the walker. */
function walkerMachine(walker: Walker, more: Partial<Kind> = {}): Machine {
  return mergeMachines(STD_MACHINE, { world: { kinds: { probed: { verbs: { step: "test.walk" }, ...more } } }, walkers: { "test.walk": walker } });
}

/** A correct walker: one step, with the key of its data, and one visit. */
const STEPS: Walker = ({ data, here, deref, visit }) => {
  const key = typeof data === "string" ? data : "a";
  const thing = deref(here, key);
  visit?.(key, thing);
  return { ok: true, thing };
};

/** The findings of a walker, by the name of the walker. */
function walkerFindings(walker: Walker, more: Partial<Kind> = {}): readonly string[] {
  return obligations(conforms(walkerMachine(walker, more), "test.walk"));
}

describe("the laws of a walker", () => {
  it("[CONFORM.WALKER-STD] each walker of the standard machine conforms, and a language walker conforms", () => {
    const names = Object.keys(STD_MACHINE.walkers ?? {});
    expect(names.length).toBeGreaterThan(2);
    // The kinds have no shape, thus the option values gives the data of the steps that have an effect.
    const values = { nearest: [{ type: "panel" }, { type: "panel", self: true }, { type: "box", self: true }], "tree.named": [{ name: "a" }, { name: "a", in: "panel" }], "tree.at": [{ attr: "a" }, { attr: "a", args: [1] }] };
    for (const name of names) expect(conforms(STD_MACHINE, name, { values }), name).toEqual([]);
    expect(conforms(walkerMachine(STEPS), "test.walk")).toEqual([]);
    expect(conforms(walkerMachine(STEPS, { pure: true }), "test.walk")).toEqual([]);
    expect(conforms(walkerMachine(nearestWalker({ eachStep: true })), "test.walk", { values: { probed: values.nearest } })).toEqual([]);
  });

  it("[CONFORM.WALKER-STD] the name selects a walker, the option verb selects it by force, and an evaluator keeps its place", () => {
    const machine = mergeMachines(walkerMachine(STEPS), { evaluators: { "test.walk": (() => ok(1)) as EvalFn }, world: { kinds: { both: { verbs: { eval: "test.walk" } } } } });
    const wrong = mergeMachines(machine, { replaces: [["walkers", "test.walk"]], walkers: { "test.walk": (() => undefined) as unknown as Walker } });
    expect(conforms(wrong, "test.walk")).toEqual([]);
    expect(obligations(conforms(wrong, "test.walk", { verb: "step" }))).toEqual(["result"]);
    // A verb without code of that name stays a verb of an evaluator (D49).
    expect(() => conforms(walkerMachine(STEPS), "test.walk", { verb: "deref" })).toThrow("no evaluator and no runner");
    expect(() => conforms(mergeMachines(STD_MACHINE, { walkers: { lonely: STEPS } }), "lonely")).toThrow("option types");
    expect(conforms(mergeMachines(walkerMachine(STEPS), { walkers: { lonely: STEPS } }), "lonely", { types: ["probed"] })).toEqual([]);
  });

  it("[CONFORM.WALKER-RESULT] a walker gives a thing or the reason of a failure, and each other answer is a finding", () => {
    const faults: readonly Walker[] = [
      (() => undefined) as unknown as Walker,
      (() => 7) as unknown as Walker,
      (() => ({ ok: true })) as unknown as Walker,
      (() => ({ ok: false })) as unknown as Walker,
      (() => ({ ok: false, reason: "No field.", code: "NOPE" })) as unknown as Walker,
      (async () => ({ ok: true, thing: 1 })) as unknown as Walker,
      () => {
        throw new TypeError("no field");
      },
    ];
    for (const fault of faults) expect(walkerFindings(fault)).toEqual(["result"]);
  });

  it("[CONFORM.WALKER-RESULT] a Failure and a failure with a code are the error channels of a walker", () => {
    const failing: Walker = () => {
      throw new Failure({ code: "#REF!", reason: "The step has no target." });
    };
    expect(walkerFindings(failing)).toEqual([]);
    expect(walkerFindings(() => ({ ok: false, reason: "No field.", code: "#REF!" }))).toEqual([]);
    expect(walkerFindings(() => ({ ok: false, reason: "No field." }))).toEqual([]);
  });

  it("[CONFORM.WALKER-RESULT] a walker that writes to its context throws, thus it cannot widen the context", () => {
    const widens: Walker = ({ context, here }) => {
      (context.caps as Cap[]).push("write");
      return { ok: true, thing: here };
    };
    const names: Walker = ({ context, here }) => {
      (context.names as Record<string, unknown>)["more"] = 1;
      return { ok: true, thing: here };
    };
    expect(walkerFindings(widens)).toEqual(["result"]);
    expect(walkerFindings(names)).toEqual(["result"]);
  });

  it("[CONFORM.WALKER-LOCAL] a walker that keeps state gets a finding, and a volatile kind needs no same answer", () => {
    let calls = 0;
    const counts: Walker = () => ({ ok: true, thing: (calls += 1) });
    let turn = false;
    const turns: Walker = ({ here, deref }) => {
      turn = !turn;
      deref(here, turn ? "a" : "x");
      return { ok: true, thing: 1 };
    };
    expect(walkerFindings(counts)).toEqual(["local"]);
    expect(walkerFindings(turns)).toEqual(["local"]);
    expect(walkerFindings(counts, { volatile: true })).toEqual([]);
  });

  it("[CONFORM.WALKER-LADDER] a walker that skips its input for a host thing gets a finding with the thing", () => {
    const direct: Walker = ({ here }) => ({ ok: true, thing: isHostThing(here) ? here.deref("a") : here });
    const asks: Walker = ({ here }) => ({ ok: true, thing: isHostThing(here) && here.has?.("a") === true });
    const [finding] = conforms(walkerMachine(direct), "test.walk");
    expect(finding?.obligation).toBe("ladder");
    expect(isHostThing(finding?.probe.here)).toBe(true);
    expect(finding?.reason).toContain("the key a of the leaf directly");
    expect(walkerFindings(asks)).toEqual(["ladder"]);
  });

  it("[CONFORM.WALKER-HOPS] each visit tells a step of the walk, and a walk without visit stays the same", () => {
    const invents: Walker = ({ here, deref, visit }) => {
      visit?.("a", "another thing");
      return { ok: true, thing: deref(here, "a") };
    };
    const needs: Walker = ({ here, deref, visit }) => ({ ok: true, thing: visit === undefined ? "no visit" : deref(here, "a") });
    const skips: Walker = ({ here, deref, visit }) => {
      if (visit !== undefined) deref(here, "a");
      return { ok: true, thing: 1 };
    };
    expect(walkerFindings(invents)).toEqual(["hops"]);
    expect(walkerFindings(needs)).toEqual(["hops"]);
    expect(walkerFindings(skips)).toEqual(["hops"]);
  });

  it("[CONFORM.WALKER-PURE] a pure step kind gets no read of the context, and a kind without the mark can read it", () => {
    const reads: Walker = ({ context }) => ({ ok: true, thing: context.names["x"] });
    expect(walkerFindings(reads, { pure: true })).toEqual(["C4"]);
    expect(walkerFindings(reads)).toEqual([]);
  });

  it("[CONFORM.WALKER-TYPE] a walker keeps its type rule, and a rule that throws stays a type issue of the check", () => {
    const reaches = (rule: NonNullable<Walker["type"]>): Walker => Object.assign((() => ({ ok: true, thing: "text" })) as Walker, { type: rule });
    expect(walkerFindings(reaches(() => "text"))).toEqual([]);
    expect(walkerFindings(reaches(() => ({ union: ["text", "number"] })))).toEqual([]);
    expect(walkerFindings(reaches(() => "number"))).toEqual(["typed"]);
    // The rule is wrong only from a thing of one type.
    expect(walkerFindings(reaches(({ here }) => (here === "number" ? "number" : "text")))).toEqual(["typed"]);
    const throws = reaches(() => {
      throw new Error("No rule.");
    });
    expect(walkerFindings(throws)).toEqual([]);
    expect(walkerFindings(reaches(() => "nmber"))).toEqual([]);
    // A reference that the walker reaches is the next step of the path.
    const refers = Object.assign((() => ({ ok: true, thing: { type: "ref", value: ["names", "x"] } })) as Walker, { type: () => "number" });
    expect(walkerFindings(refers)).toEqual([]);
  });
});

/** The standard machine with the kind `held`, whose verb `deref` names the code. */
function derefMachine(code: DerefCode, more: Partial<Kind> = {}): Machine {
  return mergeMachines(STD_MACHINE, { world: { kinds: { held: { verbs: { deref: "test.deref" }, ...more } } }, derefs: { "test.deref": code } });
}

/** This code gives the field of a record value. A key that the record does not hold gives `undefined`. */
const FIELD: DerefCode = (doc, key) => (typeof doc.value === "object" && doc.value !== null ? (doc.value as Readonly<Record<string, unknown>>)[String(key)] : undefined);

/** This function gives new code with the function `has`. */
function withHas(code: (...args: Parameters<DerefCode>) => unknown, has: unknown): DerefCode {
  return Object.assign(code, { has }) as DerefCode;
}

describe("the laws of the code of a deref", () => {
  it("[CONFORM.DEREF-STD] correct code conforms, with a function has and without one", () => {
    const told = withHas((doc, key) => FIELD(doc, key), (doc: Parameters<DerefCode>[0], key: Parameters<DerefCode>[1]) => FIELD(doc, key) !== undefined || key === "gone");
    expect(conforms(derefMachine(FIELD), "test.deref")).toEqual([]);
    expect(conforms(derefMachine(told), "test.deref")).toEqual([]);
    expect(conforms(derefMachine(told), "test.deref", { verb: "deref" })).toEqual([]);
  });

  it("[CONFORM.DEREF-RESULT] code that throws gets a finding with the key, and a Failure is an error channel", () => {
    const throws: DerefCode = () => {
      throw new TypeError("no field");
    };
    const failing: DerefCode = () => {
      throw new Failure({ code: "#REF!", reason: "The key has no target." });
    };
    const [finding] = conforms(derefMachine(throws), "test.deref");
    expect(finding?.obligation).toBe("result");
    expect(finding?.probe.key).toBe("a");
    expect(obligations(conforms(derefMachine(withHas((doc, key) => FIELD(doc, key), throws)), "test.deref"))).toEqual(["result"]);
    expect(conforms(derefMachine(failing), "test.deref")).toEqual([]);
  });

  it("[CONFORM.DEREF-LOCAL] code that keeps state gets a finding, and a volatile kind needs no same answer", () => {
    let calls = 0;
    const counts: DerefCode = () => (calls += 1);
    let told = false;
    const turns = withHas(() => undefined, () => (told = !told));
    expect(obligations(conforms(derefMachine(counts), "test.deref"))).toEqual(["local"]);
    expect(obligations(conforms(derefMachine(turns), "test.deref"))).toEqual(["local"]);
    expect(conforms(derefMachine(counts, { volatile: true }), "test.deref")).toEqual([]);
  });

  it("[CONFORM.DEREF-HAS] the function has gives a truth, and true for each key that the code answers", () => {
    const [finding] = conforms(derefMachine(withHas(() => 1, () => false)), "test.deref");
    expect(finding?.obligation).toBe("has");
    expect(finding?.probe.key).toBe("a");
    expect(obligations(conforms(derefMachine(withHas(() => 1, () => "yes")), "test.deref"))).toEqual(["has"]);
  });
});

/** The operations of a small typed language. */
const TYPED_OPS: FormulaProfile["ops"] = {
  add: (a: number, b: number) => a + b,
  neg: (a: number) => -a,
  sum: (...values: number[]) => values.reduce((total, value) => total + value, 0),
  label: (a: unknown) => String(a),
};

/** The signatures of the small typed language. */
const TYPED_SIGS: FormulaProfile["sigs"] = {
  add: { params: ["number", "number"], to: "number" },
  neg: [{ params: ["number"], to: "number" }],
  sum: { params: [], rest: "number", to: "number" },
  label: { params: ["unknown"], to: "text" },
};

/** The findings of `formula.op` of a profile, with the default types. */
function opFindings(profile: FormulaProfile): readonly string[] {
  return obligations(conforms(formulaMachine(profile), "formula.op", { definitions: formulaDefinitions(profile) }));
}

/** The findings of `formula.ext` of a profile, with the default types. */
function extFindings(profile: FormulaProfile): readonly string[] {
  return obligations(conforms(formulaMachine(profile), "formula.ext", { definitions: formulaDefinitions(profile) }));
}

describe("the laws of the functions of a formula profile", () => {
  it("[CONFORM.PROFILE-STD] the kit with a typed profile conforms, with the default types of each evaluator", () => {
    const profile: FormulaProfile = {
      ops: TYPED_OPS,
      sigs: TYPED_SIGS,
      lazy: { first: (args) => args[0]?.() ?? fail("#ARGS", "first needs an argument.") },
      ext: { size: (data) => ok(JSON.stringify(data).length) },
      extTypes: { size: "number" },
      omit: (error) => error.code === "#N/A",
      missing: (value) => value === undefined,
      check: (value) => (typeof value === "number" && !Number.isFinite(value) ? fail("#NUM!", "The number is not finite.") : undefined),
      combine: (errors) => ({ code: "#MANY", reason: `${errors.length} parts failed.` }),
    };
    const machine = formulaMachine(profile);
    for (const name of Object.keys(machine.evaluators)) {
      if (name === "formula.step") continue;
      expect(conforms(machine, name, { definitions: formulaDefinitions(profile) }), name).toEqual([]);
    }
  });

  it("[CONFORM.PROFILE-NAMES] the default types hold each named function, thus the older checks see its code", () => {
    let calls = 0;
    expect(opFindings({ ops: { tick: () => (calls += 1) } })).toContain("local");
    expect(opFindings({ ops: { tick: () => (calls += 1) }, volatile: ["tick"] })).toEqual([]);
    expect(extFindings({ ext: { tick: () => ok((calls += 1)) } })).toContain("local");
    expect(extFindings({ ext: { here: (_data, ctx) => ok(ctx.names["x"]) }, pureExt: ["here"] })).toContain("C4");
    expect(extFindings({ ext: { here: (_data, ctx) => ok(ctx.names["x"]) } })).toEqual([]);
    // The option types keeps its place.
    expect(obligations(conforms(formulaMachine({ ops: { tick: () => (calls += 1) } }), "formula.op", { types: [["ops", "probe"]] }))).toEqual([]);
  });

  it("[CONFORM.PROFILE-SIGNATURE] an operation keeps the result type of each signature that its arguments match", () => {
    const number = { neg: { params: ["number"], to: "number" } };
    expect(opFindings({ ops: { neg: (a: number) => String(-a) }, sigs: number })).toEqual(["typed"]);
    expect(opFindings({ ops: { sum: () => "none" }, sigs: { sum: { params: [], rest: "number", to: "number" } } })).toEqual(["typed"]);
    expect(opFindings({ ops: { pick: (a: unknown) => a }, sigs: { pick: [{ params: ["text"], to: "text" }, { params: ["number"], to: "text" }] } })).toEqual(["typed"]);
    // The hook check gives the result of the kit, thus a wrong hook fails a correct operation.
    expect(opFindings({ ops: { neg: (a: number) => -a }, sigs: number, check: (value) => ok(String(value)) })).toEqual(["typed"]);
    expect(opFindings({ lazy: { size: () => ok("big") }, sigs: { size: { params: ["number"], to: "number" } } })).toEqual(["typed"]);
    const finding = conforms(formulaMachine({ ops: { neg: (a: number) => String(-a) }, sigs: number }), "formula.op")[0];
    expect(finding?.probe.type).toBe("ops.neg");
    expect(finding?.reason).toContain("its signature gives number");
  });

  it("[CONFORM.PROFILE-SIGNATURE] a throw and an error stay the errors of the language, and a bad type is a type issue of the check", () => {
    const throws = () => {
      throw new TypeError("no value");
    };
    expect(opFindings({ ops: { neg: throws }, sigs: { neg: { params: ["number"], to: "number" } } })).toEqual([]);
    expect(opFindings({ ops: { neg: (a: number) => String(a) }, sigs: { neg: { params: ["nmber"], to: "number" } } })).toEqual([]);
    expect(opFindings({ ops: { neg: () => "a" }, check: () => fail("#NUM!", "No value."), sigs: { neg: { params: ["number"], to: "number" } } })).toEqual([]);
  });

  it("[CONFORM.PROFILE-EXT] an extension gives a member of its entry in extTypes", () => {
    expect(extFindings({ ext: { size: () => ok("big") }, extTypes: { size: "number" } })).toEqual(["typed"]);
    expect(extFindings({ ext: { size: (data) => ok(data === 1 ? "one" : 2) }, extTypes: { size: "number" } })).toEqual(["typed"]);
    expect(extFindings({ ext: { size: () => ok("big") } })).toEqual([]);
    expect(extFindings({ ext: { size: () => fail("#N/A", "No size.") }, extTypes: { size: "number" } })).toEqual([]);
    const profile: FormulaProfile = { ext: { size: (data) => ok(data === "only here" ? "text" : 1) }, extTypes: { size: "number" } };
    expect(obligations(conforms(formulaMachine(profile), "formula.ext", { definitions: formulaDefinitions(profile), values: { "ext.size": ["only here"] } }))).toEqual(["typed"]);
  });

  it("[CONFORM.PROFILE-FORM] each function of a profile gives the form that its type states", () => {
    const wrong = <T,>(value: unknown): T => value as T;
    const form = (profile: FormulaProfile, name: string): readonly string[] => obligations(conforms(formulaMachine(profile), name, { definitions: formulaDefinitions(profile) }));
    expect(form({ ext: { size: wrong(() => 1) } }, "formula.ext")).toContain("result");
    expect(form({ lazy: { first: wrong(() => 1) } }, "formula.op")).toContain("result");
    expect(form({ check: wrong(() => 1) }, "formula.op")).toContain("result");
    expect(form({ combine: wrong(() => "many") }, "formula.op")).toContain("result");
    expect(form({ omit: wrong(() => 1) }, "formula.record")).toContain("result");
    expect(form({ missing: wrong(() => "yes") }, "formula.ref")).toContain("result");
    // A throw of these functions gives an error of the language (E-THROW).
    const throws = () => {
      throw new TypeError("no value");
    };
    expect(form({ omit: throws }, "formula.record")).not.toContain("result");
    expect(form({ check: throws }, "formula.op")).not.toContain("result");
  });
});

describe("the options of conforms", () => {
  it("[CONFORM.STD] conforms throws for a name without code, and for code that no kind names without the option types", () => {
    expect(() => conforms(STD_MACHINE, "nothing")).toThrow("no evaluator and no runner");
    const lonely = { ...STD_MACHINE, evaluators: { ...STD_MACHINE.evaluators, lonely: (() => ok(1)) as EvalFn } };
    expect(() => conforms(lonely, "lonely")).toThrow("option types");
    // The option types gives the contract of another kind.
    expect(conforms(lonely, "lonely", { types: ["number"] })).toEqual([]);
    expect(() => conforms(lonely, "lonely", { types: ["missing"] })).toThrow("no kind");
  });
});
