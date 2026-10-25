import { describe, expect, it } from "vitest";
import {
  type Context,
  type Effect,
  type FormulaProfile,
  type GenerateOptions,
  type Json,
  type Machine,
  type Result,
  type Runner,
  type Steps,
  STD_CAPS,
  STD_MACHINE,
  check,
  checkLatent,
  context,
  effectsOf,
  evaluate,
  factsOf,
  fail,
  flatten,
  formulaMachine,
  generate,
  makeContext,
  ok,
  permits,
  prepare,
  recorder,
  run,
  typesOf,
} from "./index.ts";

/** The number of documents for each configuration of the property tests. CI can raise it with COEVAL_EFFECTS_COUNT. */
const COUNT = Number(process.env["COEVAL_EFFECTS_COUNT"] ?? 300);

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });
const log = (text: Json = "x"): Json => ({ type: "log", value: [text] });
const write: Json = { type: "write", value: { key: "k", value: { type: "number", value: 1 } } };
const push: Json = { type: ["git", "push"], value: "main" };

/* The standard world, with a kind that narrows one part, parts at the same time, a wait, calls and a procedure entry. */

/** This runner evaluates its parts in order, and it gives the last result. */
const inOrder: Runner = function* ({ parts }): Steps {
  let last: Result = ok(null);
  for (const part of parts) {
    last = yield* part.evaluate();
    if (!last.ok) return last;
  }
  return last;
};

/** The values of the parts, or the first error. */
function valuesOf(results: readonly Result[]): Result {
  return results.find((result) => !result.ok) ?? ok(results.map((result) => (result.ok ? result.value : null)));
}

const effectsMachine: Machine = {
  ...STD_MACHINE,
  world: {
    ...STD_MACHINE.world,
    kinds: {
      ...STD_MACHINE.world.kinds,
      // The part inner gets only the capability log.
      split: { verbs: { eval: "test.in-order" }, parts: { shape: "record", fields: ["inner", "outer"] }, caps: [{ rule: "only", caps: ["log"], in: [["inner"]] }] },
      // The parts get only the effects under git, key by key.
      gate: { verbs: { eval: "test.in-order" }, parts: { shape: "list" }, caps: [{ rule: "only", caps: ["git"] }] },
      // Each runner keeps C6: it waits only for an effect. The claim of RUN.CAN-WAIT needs C6.
      both: { verbs: { eval: "test.all" }, parts: { shape: "list" } },
      // A write without a key: its parts give the payload.
      put: { verbs: { eval: "test.put" }, parts: { shape: "list" }, side: "run", effects: ["write"] },
      // An evaluator that causes an effect: it works in an evaluation, and it cannot wait for the host in a run.
      shout: { verbs: { eval: "test.shout" }, parts: { shape: "list", of: "text" }, effects: ["log"] },
      // Each call under git is an effect of its own type.
      git: { kinds: {}, fallback: { verbs: { eval: "test.call" }, side: "run", effects: "type" } },
      // A procedure entry: a call of the procedure can cause the latent effect git.push.
      deploy: { verbs: { eval: "test.deploy" }, side: "run", effects: ["git.push"] },
    },
  },
  evaluators: {
    ...STD_MACHINE.evaluators,
    "test.shout": ({ parts, effect }) => {
      const values = valuesOf(parts.map((part) => part.evaluate()));
      return values.ok ? effect("log", values.value) : values;
    },
  },
  runners: {
    ...STD_MACHINE.runners,
    "test.in-order": inOrder,
    "test.all": function* ({ parts, all }): Steps {
      return valuesOf(yield* all(parts, { failFast: true, concurrency: 2 }));
    },
    "test.call": function* ({ typePath, data, effect }): Steps {
      return yield* effect(typePath, data);
    },
    "test.put": function* ({ parts, effect }): Steps {
      const values: Result[] = [];
      for (const part of parts) values.push(yield* part.evaluate());
      const all = valuesOf(values);
      return all.ok ? yield* effect("write", all.value) : all;
    },
    "test.deploy": function* ({ data, effect }): Steps {
      return yield* effect("git.push", data);
    },
  },
};

/* A formula language with effects: an effect of an evaluator, a mask, a rule only, and functions with effects in their bodies. */

const PROFILE: FormulaProfile = {
  ops: {
    apply: (fn: (value: unknown) => unknown, value: unknown) => fn(value),
    map: (fn: (value: unknown) => unknown, items: readonly unknown[]) => items.map((item) => fn(item)),
    pair: (a: unknown, b: unknown) => [a, b],
  },
};

const formulaEffects: Machine = formulaMachine(PROFILE, {
  world: {
    kinds: {
      say: { verbs: { eval: "test.say" }, parts: { shape: "list", of: "lit" }, effects: ["log"] },
      store: { verbs: { eval: "test.store" }, parts: { shape: "list", of: "lit" }, effects: ["write"] },
      quiet: { verbs: { eval: "formula.list" }, parts: { shape: "list", of: "lit" }, caps: [{ rule: "mask" }] },
      loud: { verbs: { eval: "formula.list" }, parts: { shape: "list", of: "lit" }, caps: [{ rule: "only", caps: ["log"] }] },
      // A runner that does not wait. In a run, a parent without a runner still cannot evaluate it.
      pause: { verbs: { eval: "test.pause" }, side: "run" },
    },
    defaults: {},
  },
  evaluators: {
    "test.say": ({ parts, effect }) => {
      const values = valuesOf(parts.map((part) => part.evaluate()));
      return values.ok ? effect("log", values.value) : values;
    },
    "test.store": ({ parts, effect }) => {
      const values = valuesOf(parts.map((part) => part.evaluate()));
      return values.ok ? effect("write", values.value) : values;
    },
  },
  runners: {
    "test.pause": function* (): Steps {
      return ok("paused");
    },
  },
});

describe("the effects that reach the host", () => {
  it("[CAP.EFFECTS-OF] effectsOf gives the declared effects that the capability rules around them do not remove", async () => {
    const doc = { type: "seq", value: [log(), { type: "pure", value: [write] }, { type: "split", value: { inner: write, outer: push } }] };
    expect(effectsOf(effectsMachine, doc)).toEqual(["log", "git.push"]);
    // factsOf gives each declared effect. effectsOf removes the effects under the mask of pure and outside the rule of split.
    expect(factsOf(effectsMachine, doc).effects).toEqual(["log", "write", "git.push"]);
    // A rule only keeps an effect under one of its capabilities, key by key (CAP.KEYS).
    expect(effectsOf(effectsMachine, { type: "gate", value: [push, log(), { type: ["git", "pull"], value: 1 }] })).toEqual(["git.push", "git.pull"]);
    // With capabilities at the root, only the effects that they permit at their documents stay.
    expect(effectsOf(effectsMachine, doc, { caps: ["log"] })).toEqual(["log"]);
    expect(effectsOf(effectsMachine, doc, { caps: ["git.push"] })).toEqual(["git.push"]);
    expect(effectsOf(effectsMachine, doc, { caps: [] })).toEqual([]);
    // Each kind comes one time, in the order of the document. A document without effects gives none.
    expect(effectsOf(effectsMachine, { type: "seq", value: [write, log(), write] })).toEqual(["write", "log"]);
    expect(effectsOf(STD_MACHINE, { type: "add", value: [1, 2] })).toEqual([]);
    // A bare root value gets its declared type.
    expect(effectsOf(effectsMachine, ["a"], { declaredType: "log" })).toEqual(["log"]);
    // The least authority: a run with only these capabilities gives the result and the effects of a run with each one.
    const steps = { type: "seq", value: [log(), { type: "split", value: { inner: log("in"), outer: push } }, { type: "pure", value: [{ type: "add", value: [1, 2] }] }] };
    const least = effectsOf(effectsMachine, steps);
    expect(least).toEqual(["log", "git.push"]);
    const narrow = await run(effectsMachine, steps, makeContext({}, least), { perform: (effect) => effect.payload });
    const wide = await run(effectsMachine, steps, makeContext({}, ["log", "write", "git"]), { perform: (effect) => effect.payload });
    expect(narrow.result).toEqual(ok(3));
    expect(narrow.result).toEqual(wide.result);
    expect(narrow.effects.map((effect) => effect.kind)).toEqual(["log", "log", "git.push"]);
    expect(narrow.effects.map((effect) => effect.kind)).toEqual(wide.effects.map((effect) => effect.kind));
  });

  it("[CAP.PERMITS] check and effectsOf ask the hook permits of the machine with the capabilities of each document, as a run does", async () => {
    const seen: Context[] = [];
    const hooked: Machine = {
      ...effectsMachine,
      permits: (caps, kind, ctx) => {
        seen.push(ctx);
        return kind[0] !== "write" && permits(caps, kind);
      },
    };
    const doc = { type: "seq", value: [log(), write] };
    expect(check(hooked, doc, { caps: STD_CAPS })).toEqual([{ code: "#CAP!", place: [1], reason: "The capabilities do not permit the effect write.", at: ["value", 1] }]);
    const done = await run(hooked, doc, makeContext({}, STD_CAPS), { perform: () => null });
    expect(done.result).toMatchObject({ ok: false, error: { code: "#CAP!", place: [1] } });
    expect(done.effects.map((effect) => effect.kind)).toEqual(["log"]);
    expect(effectsOf(hooked, doc, { caps: STD_CAPS })).toEqual(["log"]);
    // Without capabilities, only the rules of the kinds narrow: the least authority does not ask the host.
    expect(effectsOf(hooked, doc)).toEqual(["log", "write"]);
    // In a check, the hook gets the capabilities of the document and the world, and no names, self or event.
    seen.length = 0;
    expect(check(hooked, { type: "pure", value: [log()] }, { caps: STD_CAPS, names: ["a"] })).toMatchObject([{ code: "#CAP!", place: [0] }]);
    expect(seen[0]).toMatchObject({ caps: [], names: {}, self: null, event: null });
    expect(seen[0]?.world).not.toBeNull();
    // A hook that permits an effect without a capability: check and the run agree.
    const open: Machine = { ...STD_MACHINE, permits: (_caps, kind) => kind[0] === "log" };
    expect(check(open, log(), { caps: [] })).toEqual([]);
    expect((await run(open, log(), makeContext({}, []), { perform: () => "done" })).result).toEqual(ok("done"));
    expect(check(open, write, { caps: STD_CAPS })).toMatchObject([{ code: "#CAP!", place: [] }]);
  });

  it("[CAP.LATENT] a procedure value keeps the capabilities of the document that made it, and checkLatent compares a declaration with a body", () => {
    const fn: Json = { type: "fn", value: { params: ["v"], body: { type: "say", value: [ref("names", "v")] } } };
    const callF: Json = { type: "call", value: { fn: ref("names", "f"), args: ["hi"] } };
    // The call is inside quiet, and the function keeps the capabilities of the let that made it.
    const outside = { type: "let", value: { bind: { f: fn }, body: { type: "quiet", value: [callF] } } };
    const out = evaluate(formulaEffects, outside, makeContext({}, ["log"]), "lit");
    expect(out.result).toEqual(ok([["hi"]]));
    expect(out.effects.map((effect) => [effect.kind, effect.place])).toEqual([["log", ["bind", "f", "body"]]]);
    expect(effectsOf(formulaEffects, outside)).toEqual(["log"]);
    expect(check(formulaEffects, outside, { caps: ["log"] })).toEqual([]);
    // A function that a masked part makes has no capabilities, at each call of it.
    const inside = { type: "quiet", value: [{ type: "let", value: { bind: { f: fn }, body: callF } }] };
    const failed = evaluate(formulaEffects, inside, makeContext({}, ["log"]), "lit");
    expect(failed.result).toMatchObject({ ok: false, error: { code: "#CAP!", place: [0, "bind", "f", "body"] } });
    expect(effectsOf(formulaEffects, inside)).toEqual([]);
    expect(check(formulaEffects, inside, { caps: ["log"] })).toMatchObject([{ code: "#CAP!", place: [0, "bind", "f", "body"] }]);
    // A procedure entry declares its latent effects in its contract, and check tests each call against them.
    expect(effectsOf(effectsMachine, { type: "deploy", value: "main" })).toEqual(["git.push"]);
    expect(check(effectsMachine, { type: "deploy", value: "main" }, { caps: ["log"] })).toEqual([
      { code: "#CAP!", place: [], reason: "The capabilities do not permit the effect git.push.", at: [] },
    ]);
    // checkLatent compares the declaration with the body. An effect that the body masks does not reach the host.
    const body = { type: "seq", value: [push, log("pushed"), { type: "pure", value: [write] }] };
    expect(checkLatent(effectsMachine, ["git.push"], body)).toEqual([
      { code: "#CAP!", place: [1], reason: "The procedure declares the latent effects git.push, and its body can cause the effect log here.", at: ["value", 1] },
    ]);
    expect(checkLatent(effectsMachine, ["git", ["log"]], body)).toEqual([]);
    expect(checkLatent(effectsMachine, [], ["a"], { declaredType: "log" })).toEqual([
      { code: "#CAP!", place: [], reason: "The procedure declares no latent effect, and its body can cause the effect log here.", at: [] },
    ]);
  });

  it("[RUN.CAN-WAIT] with the option run, check gives the #CALC! of a runner that can wait, at its place and with its reason", async () => {
    const nested = { type: "add", value: [1, log()] };
    const issues = check(STD_MACHINE, nested, { run: true });
    expect(issues).toEqual([{ code: "#CALC!", place: [1], reason: "log waits for effects, and its parent cannot wait. Give the parent a runner.", at: ["value", 1] }]);
    // An evaluation can drive a runner under an evaluator, thus the check without the option finds no problem.
    expect(check(STD_MACHINE, nested)).toEqual([]);
    // The run drives the runner too (RUN.DRIVE-NESTED). A host that waits gives the #CALC! of the check.
    const done = await run(STD_MACHINE, nested, makeContext({}, STD_CAPS), { perform: () => Promise.resolve(null) });
    expect(done.result).toEqual(fail("#CALC!", issues[0]?.reason ?? "", { place: [1] }));
    // A runner whose effects cannot reach the host does not wait: pure gives its part no capability.
    expect(check(STD_MACHINE, { type: "add", value: [1, { type: "pure", value: [log()] }] }, { run: true })).toEqual([]);
    expect(check(STD_MACHINE, { type: "add", value: [1, log()] }, { run: true, caps: ["write"] }).map((issue) => issue.code)).toEqual(["#CAP!"]);
    // A runner at the root, and a runner under a runner, can wait.
    expect(check(STD_MACHINE, { type: "seq", value: [log(), { type: "if", value: { test: { type: "bool", value: true }, then: write } }] }, { run: true })).toEqual([]);
    // An evaluator that declares an effect cannot cause it in a run.
    const say = { type: "say", value: ["hi"] };
    const reason = "The effect log needs a runner: in a run, the host does each effect.";
    expect(check(formulaEffects, say, { run: true })).toEqual([{ code: "#CALC!", place: [], reason, at: [] }]);
    expect((await run(formulaEffects, say, makeContext({}, ["log"]))).result).toEqual(fail("#CALC!", reason, { place: [] }));
    // The closure of fn evaluates its body without a wait. A runner without effects in the body does not wait.
    const body = { type: "call", value: { fn: { type: "fn", value: { params: [], body: { type: "pause", value: null } } } } };
    expect(check(formulaEffects, body, { run: true })).toEqual([]);
    expect((await run(formulaEffects, body, makeContext())).result).toEqual(ok("paused"));
    expect(prepare(formulaEffects, body).evaluate()).toEqual(ok("paused"));
    // A parent without code fails before its parts, thus the check finds no wait under it.
    expect(check(STD_MACHINE, { type: "add", value: [log()], own: { eval: "nothing" } }, { run: true }).map((issue) => issue.code)).toEqual(["#NOEVAL"]);
  });
});

/* The property tests: each effect that the host sees is in effectsOf, and each wait that a run refuses is in check. */

const NAMES: Readonly<Record<string, unknown>> = { a: 1, b: "two", t: true };

const CONTEXTS: readonly Context[] = [
  context({ names: NAMES, caps: ["log", "write", "git"] }),
  context({ names: NAMES, caps: [] }),
  context({ names: NAMES, caps: [["log"], "git.push"] }),
  context({ names: NAMES, caps: ["write", "git.pull"] }),
];

const EFFECT_TYPES: readonly (readonly string[])[] = [["git", "push"], ["git", "pull"], ["log"], ["put"], ["deploy"]];

const STD_OPTIONS: Omit<GenerateOptions, "seed"> = {
  // The kinds with effects and the kinds that hold them come more often, thus more documents give the host effects.
  types: [...typesOf(effectsMachine.world), ...EFFECT_TYPES, ...EFFECT_TYPES, ["seq"], ["seq"], ["pure"], ["split"], ["gate"], ["both"]],
  malformed: 0.02,
  names: Object.keys(NAMES),
  own: ["math.add", "list.all", "control.seq", "nothing"],
  data: (type, rng) => {
    const name = type.join(".");
    if (name === "number") return rng.chance(0.9) ? rng.pick([0, 1, 2, -1]) : "1";
    if (name === "text") return rng.chance(0.9) ? rng.pick(["", "a", "b"]) : 1;
    if (name === "bool") return rng.chance(0.9) ? rng.chance(0.5) : 0;
    if (name === "nearest") return rng.pick<Json>([{ type: "panel" }, "panel"]);
    if (type[0] === "git" || name === "deploy") return rng.pick(["a", "main", 1]);
    return undefined;
  },
};

const FORMULA_OPTIONS: Omit<GenerateOptions, "seed"> = {
  declaredType: "lit",
  names: Object.keys(NAMES),
  types: [...typesOf(formulaEffects.world), ["ops", "apply"], ["ops", "map"], ["ops", "pair"], ["fn"], ["fn"], ["call"], ["say"], ["say"], ["say"], ["store"], ["quiet"], ["loud"]],
  malformed: 0.02,
  own: ["formula.list", "nothing"],
  hints: (type, path) => (type[0] === "call" && path[0] === "fn" ? [["fn"], ["ref"]] : type[0] === "ops" && (type[1] === "map" || type[1] === "apply") ? [["fn"]] : undefined),
};

interface Config {
  readonly name: string;
  readonly machine: Machine;
  readonly options: Omit<GenerateOptions, "seed">;
}

const CONFIGS: readonly Config[] = [
  { name: "standard", machine: effectsMachine, options: STD_OPTIONS },
  { name: "standard, a rule of the host", machine: { ...effectsMachine, permits: (caps, kind) => kind[0] !== "write" && permits(caps, kind) }, options: STD_OPTIONS },
  { name: "formula", machine: formulaEffects, options: FORMULA_OPTIONS },
];

/** The reasons of the #CALC! of a run that waits where its parent cannot wait. */
const CANNOT_WAIT = /waits for effects, and its parent cannot wait|needs a runner: in a run/;

interface Outcome {
  /** The effects that the host saw, and that effectsOf does not permit (CAP.EFFECTS-SOUND). */
  readonly missing: readonly string[];
  /** The runs that refused a wait, of documents that check passed with the option run (RUN.CAN-WAIT). */
  readonly unwaited: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item: unknown) => (typeof item === "function" ? "<fn>" : item === undefined ? "<undefined>" : item));
  } catch {
    return String(value);
  }
}

/** The mock of an evaluation answers at once. The host of a run makes some effects wait. */
const mock = (effect: Effect): unknown => (effect.kind === "write" ? "stored" : effect.payload);
const host = (effect: Effect): unknown => (effect.payload === "a" ? Promise.resolve(effect.payload) : mock(effect));

async function harness(config: Config): Promise<Outcome> {
  const missing: string[] = [];
  const unwaited: string[] = [];
  const counts: Record<string, number> = { evaluated: 0, ran: 0, flagged: 0, refused: 0 };
  const add = (key: string, by = 1): void => {
    counts[key] = (counts[key] ?? 0) + by;
  };
  const declared = config.options.declaredType === undefined ? {} : { declaredType: config.options.declaredType };
  for (let index = 0; index < COUNT; index += 1) {
    const seed = 9_000_011 + index;
    const doc = generate(config.machine.world, { ...config.options, seed });
    const ctx = CONTEXTS[index % CONTEXTS.length] as Context;
    const least = effectsOf(config.machine, doc, declared);
    const granted = effectsOf(config.machine, doc, { ...declared, caps: ctx.caps });
    const evaluation = recorder(mock);
    prepare(config.machine, doc, declared).evaluate(ctx, { perform: evaluation.perform });
    const real = recorder(host);
    const done = await run(config.machine, doc, ctx, { ...declared, perform: real.perform });
    // CAP.EFFECTS-SOUND: the host sees only effects that the least authority and the granted effects permit.
    for (const [tier, entries] of [["evaluation", evaluation.log()], ["run", real.log()]] as const) {
      add(tier === "run" ? "ran" : "evaluated", entries.effects.length);
      for (const entry of entries.effects) {
        if (permits(least, entry.kind) && permits(granted, entry.kind)) continue;
        missing.push(`seed ${seed}, ${tier}: ${entry.kind} at ${entry.address}, effectsOf ${show(least)} and ${show(granted)}\n  doc ${show(doc)}`);
      }
    }
    // RUN.CAN-WAIT: a document that check passes with the option run refuses no wait in a run.
    const flagged = check(config.machine, doc, { ...declared, names: Object.keys(NAMES), caps: ctx.caps, run: true }).some((issue) => issue.code === "#CALC!");
    const refused = flatten(done.trace).filter((node) => !node.result.ok && node.result.error.code === "#CALC!" && CANNOT_WAIT.test(node.result.error.reason));
    if (flagged) add("flagged");
    if (refused.length > 0) add("refused");
    if (!flagged && refused.length > 0) unwaited.push(`seed ${seed}: ${show(refused[0]?.result)}\n  doc ${show(doc)}`);
  }
  return { missing, unwaited, counts };
}

const outcomes = new Map<string, Promise<Outcome>>();

function outcomeOf(config: Config): Promise<Outcome> {
  let outcome = outcomes.get(config.name);
  if (outcome === undefined) {
    outcome = harness(config);
    outcomes.set(config.name, outcome);
  }
  return outcome;
}

describe("the soundness of the effects", () => {
  for (const config of CONFIGS) {
    it("[CAP.EFFECTS-SOUND] each effect that an evaluation or a run gives the host is in effectsOf: " + config.name, async () => {
      const outcome = await outcomeOf(config);
      expect(outcome.missing.slice(0, 3), show(outcome.counts)).toEqual([]);
      // The documents give the host effects in evaluations and in runs.
      expect(outcome.counts["evaluated"] ?? 0, show(outcome.counts)).toBeGreaterThan(COUNT / 20);
      if (config.machine !== formulaEffects) expect(outcome.counts["ran"] ?? 0, show(outcome.counts)).toBeGreaterThan(COUNT / 20);
    }, 300_000);

    it("[RUN.CAN-WAIT] a generated document that check passes with the option run refuses no wait in a run: " + config.name, async () => {
      const outcome = await outcomeOf(config);
      expect(outcome.unwaited.slice(0, 3), show(outcome.counts)).toEqual([]);
      expect(outcome.counts["refused"] ?? 0, show(outcome.counts)).toBeGreaterThan(0);
    }, 300_000);
  }
});
