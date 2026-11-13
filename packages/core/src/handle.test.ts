import { describe, expect, it } from "vitest";
import {
  type Cap,
  type Context,
  type Effect,
  type Json,
  type Kind,
  type Machine,
  type RunPart,
  type Runner,
  STD_MACHINE,
  agree,
  agreeRun,
  check,
  effectsOf,
  evaluate,
  intersectCaps,
  makeContext,
  narrow,
  permits,
  reference,
  referenceRun,
  run,
} from "./index.ts";

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });
const num = (value: number): Json => ({ type: "number", value });
const log = (...value: Json[]): Json => ({ type: "log", value });
const seq = (...value: Json[]): Json => ({ type: "seq", value });
const handle = (clauses: Json[], body: Json, more: Record<string, Json> = {}): Json => ({ type: "handle", value: { with: clauses, body, ...more } });
const answers = (op: string, doc: Json): Json => ({ op: [op], do: doc });

/** The run of a document in the plan and in the reference, which agree. */
async function both(doc: Json, caps: readonly Cap[] = [], machine: Machine = STD_MACHINE): Promise<{ readonly value: unknown; readonly host: readonly unknown[] }> {
  const host: unknown[] = [];
  const perform = (effect: Effect): unknown => {
    host.push([effect.kind, effect.payload]);
    return effect.payload;
  };
  const agreed = await agreeRun(machine, doc, makeContext({}, caps), { perform });
  if (!agreed.ok) throw new Error(`The tier ${agreed.tier} disagrees: ${agreed.reason}`);
  return { value: agreed.result.ok ? agreed.result.value : agreed.result.error.code, host };
}

describe("the kind handle", () => {
  it("[HANDLE.DO] answers an effect with its clause, and the host does not get the effect", async () => {
    const out = await both(handle([answers("log", { type: "add", value: [ref("names", "payload"), num(1)] })], log(num(2))));
    expect(out).toEqual({ value: 3, host: [] });
  });

  it("[HANDLE.DO] needs no capability for the kind of its clause, and an evaluation also answers it", () => {
    const doc = handle([answers("log", num(7))], log(num(2)));
    expect(evaluate(STD_MACHINE, doc).result).toEqual({ ok: true, value: 7 });
    expect(reference(STD_MACHINE, doc)).toEqual({ ok: true, value: 7 });
    expect(agree(STD_MACHINE, doc).ok).toBe(true);
  });

  it("[HANDLE.DO] gives the effect the failure of its clause, and the body stops", async () => {
    const out = await both(handle([answers("log", { type: "ref", value: ["names", "missing"] })], seq(log(num(1)), num(2))));
    expect(out).toEqual({ value: "#NAME?", host: [] });
  });

  it("[HANDLE.DO] waits in place for an effect of its clause", async () => {
    const doc = handle([answers("log", { type: "write", value: { key: "a", value: ref("names", "payload") } })], seq(log(num(2)), ref("names", "last")));
    const out = await run(STD_MACHINE, doc, makeContext({}, ["write"]), { perform: async () => "stored" });
    expect(out.result).toEqual({ ok: true, value: "stored" });
    expect(out.effects.map((effect) => effect.kind)).toEqual(["write"]);
  });

  it("[HANDLE.DO] binds the names of its clauses for the check", () => {
    const doc = handle([answers("log", ref("names", "payload"))], num(1), { return: ref("names", "result") });
    expect(check(STD_MACHINE, doc)).toEqual([]);
    expect(check(STD_MACHINE, handle([], ref("names", "payload"))).map((issue) => issue.code)).toEqual(["#NAME?"]);
  });

  it("[HANDLE.ABORT] stops the body, and the result of the clause is the result of handle", async () => {
    const doc = handle([{ op: ["log"], abort: ref("names", "payload") }], seq(log(num(5)), { type: "write", value: { key: "a", value: num(1) } }), {
      return: num(100),
    });
    expect(await both(doc, ["write"])).toEqual({ value: 5, host: [] });
  });

  it("[HANDLE.RETURN] changes the result of the body, and reads it as a name", async () => {
    expect(await both(handle([], num(4), { return: { type: "add", value: [ref("names", "result"), num(1)] } }))).toEqual({ value: 5, host: [] });
  });

  it("[HANDLE.RETURN] does not run after a failed body", async () => {
    expect(await both(handle([], ref("names", "missing"), { return: num(1) }))).toEqual({ value: "#NAME?", host: [] });
  });

  it("[HANDLE.FORWARD] sends an effect of a clause to the next frame out, and then to the host, one time", async () => {
    const inner = handle([answers("log", log({ type: "add", value: [ref("names", "payload"), num(1)] }))], log(num(1)));
    expect(await both(handle([answers("log", { type: "add", value: [ref("names", "payload"), num(10)] })], inner))).toEqual({ value: 12, host: [] });
    expect(await both(inner, ["log"])).toEqual({ value: 2, host: [["log", 2]] });
  });

  it("[HANDLE.DEEP] answers each effect under the body, at any depth", async () => {
    const out = await both(handle([answers("log", num(1))], seq({ type: "if", value: { test: { type: "bool", value: true }, then: log(num(9)) } }, log(num(9)))));
    expect(out).toEqual({ value: 1, host: [] });
  });

  it("[HANDLE.DEEP] answers a kind under the kind of its clause, by the keys (CAP.KEYS)", () => {
    const machine: Machine = { ...STD_MACHINE };
    expect(check(machine, handle([{ op: "log", do: num(1) }], log(num(9)))).filter((issue) => issue.code === "#CAP!")).toEqual([]);
  });

  it("[HANDLE.NARROW] keeps the rules around an effect: pure stops a handled effect", async () => {
    const out = await both(handle([answers("log", num(1))], { type: "pure", value: [log(num(9))] }));
    expect(out).toEqual({ value: "#CAP!", host: [] });
  });

  it("[HANDLE.CLAUSE] gives a clause the capabilities of handle, not more", async () => {
    const doc = handle([answers("log", { type: "write", value: { key: "a", value: num(1) } })], log(num(9)));
    expect(await both(doc)).toEqual({ value: "#CAP!", host: [] });
    expect(await both(doc, ["write"])).toEqual({ value: { key: "a", value: 1 }, host: [["write", { key: "a", value: 1 }]] });
  });

  it("[HANDLE.CLAUSE] gives a clause no frame of its own handle", async () => {
    expect(await both(handle([answers("log", log(num(1)))], log(num(9))))).toEqual({ value: "#CAP!", host: [] });
  });

  it("[HANDLE.ENDED] refuses a context that leaves the body, and the host does not get its effect", async () => {
    let kept: Context | undefined;
    const keep: Runner = function* ({ context }) {
      kept = context;
      return { ok: true, value: null };
    };
    const reuse: Runner = function* ({ parts }) {
      return yield* (parts[0] as RunPart).evaluate(kept);
    };
    const world = STD_MACHINE.world;
    const machine: Machine = {
      ...STD_MACHINE,
      world: { ...world, kinds: { ...world.kinds, keep: { verbs: { eval: "test.keep" } }, reuse: { verbs: { eval: "test.reuse" }, parts: { shape: "list" } } } },
      runners: { ...STD_MACHINE.runners, "test.keep": keep, "test.reuse": reuse },
    };
    const doc = seq(handle([answers("log", num(1))], { type: "keep", value: null }), { type: "reuse", value: [log(num(9))] });
    expect(await both(doc, ["log"], machine)).toEqual({ value: "#CAP!", host: [] });
  });

  it("[HANDLE.SEALED] keeps the place and the context of an effect from the clause", async () => {
    // The step before the effect binds the name last for the effect, and the clause does not see that name.
    const doc = handle([answers("log", ref("names", "last"))], seq(num(1), log(num(9))));
    expect(await both(doc)).toEqual({ value: "#NAME?", host: [] });
  });

  it("[HANDLE.VALUE] needs exactly one of do and abort in each clause", async () => {
    const both_ = { op: ["log"], do: num(1), abort: num(2) };
    expect(await both(handle([both_], num(0)))).toEqual({ value: "#VALUE!", host: [] });
    expect(await both(handle([{ op: ["log"] }], num(0)))).toEqual({ value: "#VALUE!", host: [] });
    expect(await both(handle([{ op: 3, do: num(1) }], num(0)))).toEqual({ value: "#VALUE!", host: [] });
  });

  it("[CAP.GRANT] makes check accept a handled effect, and the clause counts at the capabilities of handle", () => {
    const caps = (doc: Json, list: readonly string[]): readonly string[] => check(STD_MACHINE, doc, { caps: list }).filter((issue) => issue.code === "#CAP!").map((issue) => issue.place.join("."));
    expect(caps(handle([answers("log", num(1))], log(num(1))), [])).toEqual([]);
    expect(caps(log(num(1)), [])).toHaveLength(1);
    expect(caps(handle([answers("log", log(num(1)))], log(num(1))), [])).toHaveLength(1);
  });

  it("[CAP.GRANT] removes a handled effect from effectsOf, and keeps the effects of a clause", () => {
    expect(effectsOf(STD_MACHINE, handle([answers("log", num(1))], log(num(1))))).toEqual([]);
    expect(effectsOf(STD_MACHINE, handle([answers("log", { type: "write", value: { key: "a", value: num(1) } })], log(num(1))))).toEqual(["write"]);
    expect(effectsOf(STD_MACHINE, handle([answers("log", log(num(1)))], log(num(1))))).toEqual(["log"]);
  });

  /** The standard machine with more kinds of the test, each with the eval runner of its name. */
  function withKinds(kinds: Record<string, Kind>, runners: Record<string, Runner>, more: Partial<Machine> = {}): Machine {
    const world = STD_MACHINE.world;
    return { ...STD_MACHINE, world: { ...world, kinds: { ...world.kinds, ...kinds } }, runners: { ...STD_MACHINE.runners, ...runners }, ...more };
  }

  /** A kind with one part, whose runner evaluates the part in the context that `make` gives. */
  function wrapper(make: (context: Context) => Context): Machine {
    const wrap: Runner = function* ({ parts, context }) {
      return yield* (parts[0] as RunPart).evaluate(make(context));
    };
    return withKinds({ wrap: { verbs: { eval: "test.wrap" }, parts: { shape: "list" } } }, { "test.wrap": wrap });
  }

  it("[HANDLE.KINDS] gives no clause to a context that the code makes without a spread, and the host gets no effect", async () => {
    const machine = wrapper((context) => makeContext(context.names, context.caps));
    const doc = handle([answers("log", num(1))], { type: "wrap", value: [log(num(9))] });
    expect(await both(doc, [], machine)).toEqual({ value: "#CAP!", host: [] });
    // The capability of the host still holds in that context.
    expect(await both(doc, ["log"], machine)).toEqual({ value: 9, host: [["log", 9]] });
  });

  it("[HANDLE.KINDS] keeps the frame in a spread of the context", async () => {
    const machine = wrapper((context) => ({ ...context, names: { ...context.names, x: 1 } }));
    expect(await both(handle([answers("log", num(1))], { type: "wrap", value: [log(num(9))] }), [], machine)).toEqual({ value: 1, host: [] });
  });

  it("[HANDLE.KINDS] keeps the kinds of the clauses out of the root caps", async () => {
    const doc = handle([answers("log", num(1))], ref("caps"));
    expect(await both(doc)).toEqual({ value: [], host: [] });
    expect(await both(doc, ["log"])).toEqual({ value: ["log"], host: [] });
  });

  it("[HANDLE.KINDS] gives the rule permits of the host only the capabilities of the host", async () => {
    // A rule of the host that permits each effect to a context with the capability admin.
    const machine: Machine = { ...STD_MACHINE, permits: (caps, kind) => caps.includes("admin") || permits(caps, kind) };
    const doc = handle([{ op: "admin", do: num(0) }], log(num(9)));
    expect(await both(doc, [], machine)).toEqual({ value: "#CAP!", host: [] });
    expect(await both(doc, ["admin"], machine)).toEqual({ value: 9, host: [["log", 9]] });
  });

  it("[HANDLE.NARROW] narrows the kinds of the clauses to a list that the code writes", async () => {
    const doc = handle([answers("log", num(1))], { type: "wrap", value: [log(num(9))] });
    expect(await both(doc, [], wrapper((context) => ({ ...context, caps: [] })))).toEqual({ value: "#CAP!", host: [] });
    expect(await both(doc, ["write"], wrapper((context) => ({ ...context, caps: ["write"] })))).toEqual({ value: "#CAP!", host: [] });
  });

  it("[HANDLE.NARROW] applies a rule of the kind after its grant, in both tiers", async () => {
    const kind = STD_MACHINE.world.kinds["handle"] as Kind;
    const machine = withKinds({ sealed: { ...kind, caps: [...(kind.caps ?? []), { rule: "mask", in: [["body"]] }] } }, {});
    const doc: Json = { type: "sealed", value: { with: [answers("log", num(1))], body: log(num(9)) } };
    expect(await both(doc, [], machine)).toEqual({ value: "#CAP!", host: [] });
  });

  it("[HANDLE.DEEP] answers a kind under the op of a clause in a run, and not a kind above it", async () => {
    const emit: Runner = function* ({ value, effect }) {
      const { kind, payload } = value as { readonly kind: string; readonly payload: Json };
      return yield* effect(kind, payload);
    };
    const machine = withKinds({ emit: { verbs: { eval: "test.emit" } } }, { "test.emit": emit });
    const plus = { type: "add", value: [ref("names", "payload"), num(1)] };
    expect(await both(handle([{ op: "log", do: plus }], { type: "emit", value: { kind: "log.debug", payload: 4 } }), [], machine)).toEqual({ value: 5, host: [] });
    expect(await both(handle([{ op: "log.debug", do: plus }], { type: "emit", value: { kind: "log", payload: 4 } }), ["log"], machine)).toEqual({ value: 4, host: [["log", 4]] });
  });

  it("[HANDLE.DO] gives an effect to the first clause of the innermost frame", async () => {
    expect(await both(handle([answers("log", num(1)), answers("log", num(2))], log(num(9))))).toEqual({ value: 1, host: [] });
    expect(await both(handle([answers("log", num(1))], handle([answers("log", num(2))], log(num(9)))))).toEqual({ value: 2, host: [] });
  });

  it("[HANDLE.AGREES] gives one result and one log of the host in a run of the plan and of the reference", async () => {
    const doc = handle(
      [answers("log", { type: "write", value: { key: "b", value: ref("names", "payload") } })],
      seq(log(num(1)), { type: "write", value: { key: "a", value: num(2) } }, log(num(3))),
    );
    const context = makeContext({}, ["write"]);
    const plan = await run(STD_MACHINE, doc, context);
    const effects: Effect[] = [];
    const model = await referenceRun(STD_MACHINE, doc, context, { effects });
    expect(plan.result).toEqual(model);
    expect(plan.effects.map((effect) => effect.address)).toEqual(effects.map((effect) => effect.address));
  });
});

describe("the capability with no keys", () => {
  const write = (key: string, value: Json): Json => ({ type: "write", value: { key, value } });
  const EACH: readonly Cap[] = [[]];
  const doc = seq(log(num(1)), write("a", num(2)), num(3));

  it("[CAP.EACH] permits each kind, and an empty text is one key, not the capability with no keys", () => {
    expect(permits(EACH, "log")).toBe(true);
    expect(permits(EACH, ["fs", "read.json"])).toBe(true);
    expect(permits(EACH, [])).toBe(true);
    expect(permits([""], "log")).toBe(false);
    expect(permits(["log"], [])).toBe(false);
  });

  it("[CAP.EACH] [CAP.MEET] the meet with the capability with no keys is the other list", () => {
    const list: readonly Cap[] = ["log", ["fs", "read.json"]];
    expect(intersectCaps(list, EACH)).toBe(list);
    expect(intersectCaps(EACH, list)).toEqual(list);
    expect(intersectCaps(EACH, EACH)).toEqual(EACH);
    const parent = makeContext({}, EACH);
    expect(narrow(parent, { ...parent, caps: ["log"] }).caps).toEqual(["log"]);
    expect(narrow(makeContext({}, ["log"]), { ...parent, caps: EACH }).caps).toEqual(["log"]);
  });

  it("[CAP.EACH] a run gives the host each effect, and the plan, the traced plan and the reference agree", async () => {
    expect(await both(doc, EACH)).toEqual({ value: 3, host: [["log", 1], ["write", { key: "a", value: 2 }]] });
    expect(await both(doc)).toEqual({ value: "#CAP!", host: [] });
    expect(await both(doc, ["log"])).toEqual({ value: "#CAP!", host: [["log", 1]] });
  });

  it("[CAP.EACH] check and effectsOf permit each declared effect", () => {
    expect(check(STD_MACHINE, doc, { caps: EACH }).filter((issue) => issue.code === "#CAP!")).toEqual([]);
    expect(check(STD_MACHINE, doc, { caps: ["log"] }).filter((issue) => issue.code === "#CAP!").length).toBe(1);
    expect(effectsOf(STD_MACHINE, doc, { caps: EACH })).toEqual(["log", "write"]);
    expect(effectsOf(STD_MACHINE, doc, { caps: ["log"] })).toEqual(["log"]);
  });

  it("[CAP.EACH] [HANDLE.DEEP] a clause with the op of no keys answers each effect, as the capability permits each kind", async () => {
    const all = handle([{ op: [], do: num(7) }], doc);
    expect(await both(all)).toEqual({ value: 3, host: [] });
    expect(check(STD_MACHINE, all).filter((issue) => issue.code === "#CAP!")).toEqual([]);
    expect(agree(STD_MACHINE, all).ok).toBe(true);
    expect(evaluate(STD_MACHINE, all).result).toEqual(reference(STD_MACHINE, all));
  });
});
