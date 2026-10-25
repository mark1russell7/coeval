import { describe, expect, it } from "vitest";
import {
  type CompiledEvaluator,
  type CompiledRunner,
  type Context,
  type EvalFn,
  type Finding,
  type FormulaProfile,
  type Kind,
  type Machine,
  type Result,
  type RunFn,
  type Walker,
  Held,
  STD_MACHINE,
  conforms,
  fail,
  formulaDefinitions,
  formulaMachine,
  jsTruthy,
  ok,
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
    expect(k65[0]?.reason).toContain("K65");
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
