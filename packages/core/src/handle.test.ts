import { describe, expect, it } from "vitest";
import { type Context, type Effect, type Json, type Machine, type RunPart, type Runner, STD_MACHINE, agree, agreeRun, check, effectsOf, evaluate, makeContext, reference, referenceRun, run } from "./index.ts";

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });
const num = (value: number): Json => ({ type: "number", value });
const log = (...value: Json[]): Json => ({ type: "log", value });
const seq = (...value: Json[]): Json => ({ type: "seq", value });
const handle = (clauses: Json[], body: Json, more: Record<string, Json> = {}): Json => ({ type: "handle", value: { with: clauses, body, ...more } });
const answers = (op: string, doc: Json): Json => ({ op: [op], do: doc });

/** The run of a document in the plan and in the reference, which agree. */
async function both(doc: Json, caps: readonly string[] = [], machine: Machine = STD_MACHINE): Promise<{ readonly value: unknown; readonly host: readonly unknown[] }> {
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
