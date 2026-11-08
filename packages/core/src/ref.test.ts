import { describe, expect, it } from "vitest";
import {
  type CompiledEvaluator,
  type Context,
  type EvalFn,
  type HostThing,
  type Json,
  type Machine,
  type Read,
  type Resolution,
  type Runtime,
  type Thing,
  STD_DEFINITIONS,
  STD_MACHINE,
  THING,
  agree,
  conforms,
  context,
  evaluate,
  generate,
  isHostThing,
  planner,
  prepare,
  reference,
  resolve,
} from "./index.ts";

/*
 * The standard evaluator `ref.resolve` (D133). The plan compiles its path. The function `TODAY` is the form before
 * the compilation, and the reference reads it too. Thus these tests compare the compiled code with the function.
 */

const COMPILED = STD_MACHINE.evaluators["ref.resolve"] as CompiledEvaluator;
const TODAY = STD_DEFINITIONS.evaluators?.["ref.resolve"] as EvalFn;

/** The standard machine with a function in the place of the compiled evaluator. */
const INTERPRETED: Machine = { ...STD_MACHINE, evaluators: { ...STD_MACHINE.evaluators, "ref.resolve": TODAY } };

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });
const NEAREST: Json = { type: "nearest", value: { type: "panel" } };

const NAMES = {
  a: 1,
  o: { b: [10, 20] },
  alias: ref("names", "a"),
  deep: ref("names", "alias"),
  loop: ref("names", "pool"),
  pool: ref("names", "loop"),
};

/** This function gives a host thing with a field `type`: the walker `nearest` reads the type of a host thing only. */
function panel(fields: Readonly<Record<string, Thing>>): HostThing {
  return { [THING]: true, label: "panel", type: "panel", deref: (key) => (typeof key === "string" ? fields[key] : undefined), toJson: () => ({ type: "panel" }) } as HostThing;
}

const SELF = panel({ a: 1, parent: panel({ width: 3 }) });

const CONTEXTS: readonly Context[] = [
  context({ names: NAMES, caps: ["log"], self: SELF, event: { a: 2 } }),
  context({ names: NAMES, caps: [] }),
  context({ names: {}, caps: [["log"]], self: { a: 5 } }),
];

/** The documents of each kind of answer of a reference: a value, each error, and a reference inside other documents. */
const REFS: readonly Json[] = [
  ref("names", "a"),
  ref("names", "o", "b", 1),
  ref("names", "o", "b", 9),
  ref("names", "alias"),
  ref("names", "deep"),
  ref("names", "loop"),
  ref("names", "nope"),
  ref("names"),
  ref("self", "a"),
  ref("self"),
  ref("self", "parent", "width"),
  ref("self", NEAREST, "width"),
  ref("event", "a"),
  ref("event", "nope"),
  ref("caps"),
  ref("world", "kinds", "ref", "pure"),
  ref("nope", "a"),
  ref(7),
  ref("names", "a", { type: "nothing", value: 1 }),
  ref("names", true),
  { type: "ref", value: [] },
  { type: "ref", value: "names" },
  { type: "ref", value: null },
  { type: "ref", value: { path: ["names", "a"] } },
  { type: "add", value: [ref("names", "a"), { type: "ref", value: [] }] },
  { type: "list", value: [ref("names", "a"), ref("names", "nope")] },
  { type: "if", value: { test: ref("names", "a"), then: ref("self", "a"), else: ref("names", "nope") } },
  { type: "panel", value: { width: ref("names", "a"), height: { type: "add", value: [ref("self", "width"), 1] } } },
];

/** The navigators of the agreement: the standard one, and one for each field that changes a resolution. */
const NAVIGATORS: readonly Machine[] = [STD_MACHINE, { ...STD_MACHINE, plain: true }, { ...STD_MACHINE, roots: ["names", "world"] }, { ...STD_MACHINE, adopt: (value) => value as never }];

/** This function gives a value with a text for each host thing and function: each plan makes its own tree nodes. */
function comparable(value: unknown): unknown {
  const text = JSON.stringify(value, (_key, item: unknown) => (isHostThing(item) ? `thing ${item.label}` : typeof item === "function" ? "function" : item));
  return text === undefined ? undefined : JSON.parse(text);
}

/** This function gives the result and the reads of a document in a plan. */
function planned(machine: Machine, doc: Json, ctx: Context): { readonly result: unknown; readonly reads: readonly Read[] } {
  const reads: Read[] = [];
  return { result: prepare(machine, doc).evaluate(ctx, { reads }), reads };
}

/** A machine that counts each question to the table of walkers, thus each question of the ladder of `step`. */
function counting(): { readonly machine: Machine; readonly asked: () => number } {
  let asked = 0;
  const walkers = new Proxy(STD_MACHINE.walkers ?? {}, {
    getOwnPropertyDescriptor: (target, key) => {
      asked += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  return { machine: { ...STD_MACHINE, walkers }, asked: () => asked };
}

describe("the compiled form of ref.resolve", () => {
  it("[PLAN.PATH-STD] a plan compiles the path of a standard reference in prepare, and each evaluation asks the ladder nothing", () => {
    expect(typeof COMPILED.compile).toBe("function");
    const { machine, asked } = counting();
    const ctx = CONTEXTS[0] as Context;
    const plan = prepare(machine, ref("self", NEAREST, "width"));
    const once = asked();
    expect(once).toBeGreaterThan(0);
    for (let index = 0; index < 3; index += 1) expect(plan.evaluate(ctx)).toEqual({ ok: true, value: 3 });
    expect(asked()).toBe(once);
    // A function evaluator asks the ladder at each evaluation.
    const before = asked();
    prepare({ ...machine, evaluators: INTERPRETED.evaluators }, ref("self", NEAREST, "width")).evaluate(ctx);
    expect(asked()).toBeGreaterThan(before);
  });

  it("[PLAN.PATH-STD] a value that is not a path compiles to one #VALUE! with the place of the document, at each evaluation", () => {
    const reason = 'The value of ref is a path: a list that starts with a root, for example ["names", "a"].';
    const doc = { type: "list", value: [{ type: "number", value: 1 }, { type: "ref", value: [] }] };
    const plan = prepare(STD_MACHINE, doc);
    for (let index = 0; index < 2; index += 1) expect(plan.evaluate(CONTEXTS[0])).toEqual({ ok: false, error: { code: "#VALUE!", reason, place: [1] } });
    expect(plan.evaluate(CONTEXTS[1])).toEqual(reference(STD_MACHINE, doc, CONTEXTS[1]));
  });

  it("[PLAN.PATH-STD-SAME] the compiled form gives the value, the error, the place and the reads of the function form", () => {
    for (const doc of REFS) {
      for (const ctx of CONTEXTS) {
        const label = JSON.stringify(doc);
        const plan = planned(STD_MACHINE, doc, ctx);
        expect(plan, label).toEqual(planned(INTERPRETED, doc, ctx));
        expect(evaluate(STD_MACHINE, doc, ctx).result, label).toEqual(evaluate(INTERPRETED, doc, ctx).result);
        const reads: Read[] = [];
        expect(reference(STD_MACHINE, doc, ctx, { reads }), label).toEqual(plan.result);
        expect(reads.filter((read) => read.free), label).toEqual(plan.reads.filter((read) => read.free && read.kept !== true));
      }
    }
  });

  it("[PLAN.PATH-STD-SAME] the host sees the same calls of deref, in the same order, for a path through a host thing", () => {
    const log: unknown[] = [];
    const host = (): Context =>
      context({
        names: {
          h: {
            [THING]: true,
            label: "host",
            deref: (key: unknown) => {
              log.push(key);
              return key === "x" ? 1 : undefined;
            },
            toJson: () => null,
          },
        },
      });
    const calls = (machine: Machine, doc: Json): unknown => {
      log.length = 0;
      const result = prepare(machine, doc).evaluate(host());
      return { result, log: [...log] };
    };
    for (const doc of [ref("names", "h", "x"), ref("names", "h", "y")]) expect(calls(STD_MACHINE, doc)).toEqual(calls(INTERPRETED, doc));
  });

  it("[PLAN.PATH-STD-AGREES] strict agree passes for each reference document in each context and with each navigator", () => {
    for (const machine of NAVIGATORS) {
      for (const doc of REFS) {
        for (const ctx of CONTEXTS) {
          const outcome = agree(machine, doc, ctx, { strict: true });
          expect(outcome.ok, JSON.stringify(doc)).toBe(true);
        }
      }
    }
  });

  it("[PLAN.PATH-STD-AGREES] generated documents give the same result, the same reads and the agreement of each tier", () => {
    let references = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const doc = generate(STD_MACHINE.world, { seed, names: Object.keys(NAMES), maxSize: 12 }) as Json;
      const ctx = CONTEXTS[seed % CONTEXTS.length] as Context;
      if (JSON.stringify(doc).includes('"ref"')) references += 1;
      expect(comparable(planned(STD_MACHINE, doc, ctx)), `seed ${seed}`).toEqual(comparable(planned(INTERPRETED, doc, ctx)));
      expect(agree(STD_MACHINE, doc, ctx, { strict: true }).ok, `seed ${seed}`).toBe(true);
    }
    expect(references).toBeGreaterThan(30);
  });

  it("[PLAN.PATH-STD-NAV] a runtime with another navigator resolves the steps again, thus its navigator decides", () => {
    // This evaluator compiles each path for a plain navigator. The plan runs on the standard machine, which collapses.
    const forPlain: CompiledEvaluator = { compile: (input) => COMPILED.compile({ ...input, machine: { ...input.machine, plain: true } }) };
    const machine: Machine = { ...STD_MACHINE, evaluators: { ...STD_MACHINE.evaluators, "ref.resolve": forPlain } };
    const doc = ref("names", "alias");
    const ctx = CONTEXTS[0] as Context;
    expect(prepare({ ...STD_MACHINE, plain: true }, doc).evaluate(ctx)).toEqual({ ok: true, value: NAMES.alias });
    expect(prepare(machine, doc).evaluate(ctx)).toEqual({ ok: true, value: 1 });
  });

  it("[PLAN.PATH-STD-NAV] a runtime that wraps the kernel gets the steps of the document, as the function form gave them", () => {
    const seen: unknown[] = [];
    const doc = { type: "ref", value: ["names", "a"] };
    const ctx = CONTEXTS[0] as Context;
    const rt: Runtime = {
      machine: STD_MACHINE,
      running: false,
      resolve: (c: Context, path: readonly unknown[]): Resolution => {
        seen.push(path);
        return resolve(STD_MACHINE, c, path, { hops: false });
      },
      effect: () => ({ ok: true, value: null }),
      runEffect: function* () {
        return { ok: true, value: null };
      },
      all: function* () {
        return [];
      },
    };
    const input = { kind: "ref", typePath: ["ref"], doc, value: doc.value, data: doc.value, parts: [], place: [], machine: STD_MACHINE, fill: () => doc.value };
    expect(COMPILED.compile(input)(ctx, rt)).toEqual({ ok: true, value: 1 });
    expect(seen).toEqual([doc.value]);
  });

  it("[PLAN.PATH-STD-CACHE] a planner compiles a path one time for each document object, and each planner has its own machine", () => {
    const { machine, asked } = counting();
    const doc = ref("self", NEAREST, "width");
    const ctx = CONTEXTS[0] as Context;
    const plans = planner(machine);
    expect(plans(doc).evaluate(ctx)).toEqual({ ok: true, value: 3 });
    const once = asked();
    expect(plans(doc)).toBe(plans(doc));
    expect(plans(doc).evaluate(ctx)).toEqual({ ok: true, value: 3 });
    expect(asked()).toBe(once);
    // An equal document is another object, thus the planner compiles it too.
    plans(structuredClone(doc));
    expect(asked()).toBeGreaterThan(once);
    // Two planners of one document compile for their own machines.
    const alias = ref("names", "alias");
    expect(planner(STD_MACHINE)(alias).evaluate(ctx)).toEqual({ ok: true, value: 1 });
    expect(planner({ ...STD_MACHINE, plain: true })(alias).evaluate(ctx)).toEqual({ ok: true, value: NAMES.alias });
  });

  it("[PLAN.PATH-STD-WRAP] a function under the name ref.resolve stays a function evaluator: it sees each evaluation and each hop", () => {
    const seen: number[] = [];
    const wrapped: EvalFn = (input) => {
      const found = input.resolve(input.data as readonly Json[], { hops: true });
      seen.push(found.hops.length);
      return TODAY(input);
    };
    const machine: Machine = { ...STD_MACHINE, evaluators: { ...STD_MACHINE.evaluators, "ref.resolve": wrapped } };
    const doc = ref("names", "alias");
    const ctx = CONTEXTS[0] as Context;
    const plan = prepare(machine, doc);
    expect(plan.evaluate(ctx)).toEqual({ ok: true, value: 1 });
    expect(plan.evaluate(ctx)).toEqual({ ok: true, value: 1 });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeGreaterThan(1);
    // A function evaluator needs no definition, thus the reference calls it too.
    expect(reference(machine, doc, ctx)).toEqual({ ok: true, value: 1 });
    expect(seen).toHaveLength(3);
  });
});

describe("the definition of ref.resolve", () => {
  it("[REF.RESOLVE] the reference reads a standard reference with its own definition, also without the option definitions", () => {
    expect(typeof TODAY).toBe("function");
    expect(TODAY).not.toBe(COMPILED);
    let compiles = 0;
    const counted: CompiledEvaluator = {
      compile: (input) => {
        compiles += 1;
        return COMPILED.compile(input);
      },
    };
    const doc = ref("names", "a");
    const ctx = CONTEXTS[0] as Context;
    expect(reference(STD_MACHINE, doc, ctx)).toEqual({ ok: true, value: 1 });
    // A compiled wrapper is not the standard evaluator, thus it needs its own definition (REF.DIRECT).
    const machine: Machine = { ...STD_MACHINE, evaluators: { ...STD_MACHINE.evaluators, "ref.resolve": counted } };
    expect(reference(machine, doc, ctx)).toMatchObject({ ok: false, error: { code: "#NOEVAL", place: [] } });
    expect(reference(machine, doc, ctx, { definitions: { evaluators: { "ref.resolve": TODAY } } })).toEqual({ ok: true, value: 1 });
    expect(compiles).toBe(0);
    expect(agree(machine, doc, ctx, { strict: true, definitions: { evaluators: { "ref.resolve": TODAY } } }).ok).toBe(true);
  });

  it("[REF.RESOLVE] the compiled form and the definition keep the obligations of host code", () => {
    expect(conforms(STD_MACHINE, "ref.resolve")).toEqual([]);
  });
});
