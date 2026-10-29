import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type Domain,
  type Effect,
  type Journal,
  type Json,
  type Machine,
  type Perform,
  type ReplayLog,
  type ReplayLogJson,
  type Result,
  type Runner,
  type Steps,
  Failure,
  JOURNAL,
  STD_CAPS,
  STD_MACHINE,
  decodeLog,
  encodeLog,
  generate,
  makeContext,
  ok,
  prepare,
  recorder,
  referenceRun,
  replayer,
  run,
  sameResult,
} from "./index.ts";

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });
const log = (text: string): Json => ({ type: "log", value: [text] });
const write = (key: string): Json => ({ type: "write", value: { key, value: { type: "number", value: 2 } } });

/** A sequence that writes, then logs the result of the write. */
const WRITE_THEN_LOG: Json = { type: "seq", value: [write("a"), { type: "log", value: [ref("names", "last")] }] };

/** A host that waits for a write and answers a log at once. */
const host: Perform = (effect) => (effect.kind === "write" ? Promise.resolve("stored") : [effect.payload]);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The runner of `par`: its parts run at the same time. */
const par: Runner = function* ({ parts, all }): Steps {
  const results = yield* all(parts);
  return ok(results.map((result) => (result.ok ? result.value : result.error.code)));
};

/** The runner of `fast`: two parts run at the same time, and the first failure stops the others. */
const fast: Runner = function* ({ parts, all }): Steps {
  const results = yield* all(parts, { concurrency: 2, failFast: true });
  return ok(results.map((result) => (result.ok ? result.value : result.error.code)));
};

const machine: Machine = {
  ...STD_MACHINE,
  world: {
    ...STD_MACHINE.world,
    kinds: {
      ...STD_MACHINE.world.kinds,
      par: { verbs: { eval: "par" }, parts: { shape: "list" } },
      fast: { verbs: { eval: "fast" }, parts: { shape: "list" } },
    },
  },
  runners: { ...STD_MACHINE.runners, par, fast },
};

describe("record and replay", () => {
  it("[RUN.RECORD] a recorder logs each effect with its address, its request and its outcome, and the order of the waits of each all", async () => {
    const ctx = makeContext({}, STD_CAPS);
    const recording = recorder(host);
    const done = await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: recording.perform });
    expect(done.result).toEqual(ok(["stored"]));
    expect(recording.log()).toEqual({
      effects: [
        { address: "0#0", kind: "write", payload: { key: "a", value: 2 }, outcome: ok("stored"), waited: true },
        { address: "1#0", kind: "log", payload: "stored", outcome: ok(["stored"]), waited: false },
      ],
      settles: [],
    });
    // The waits of an all settle in the order of the host, and the log keeps that order.
    const both = recorder(async (effect) => {
      await wait(effect.payload === "slow" ? 20 : 1);
      return effect.payload;
    });
    await run(machine, { type: "par", value: [log("slow"), log("fast")] }, ctx, { perform: both.perform });
    expect(both.log().settles).toEqual([
      { all: "all0", item: 1 },
      { all: "all0", item: 0 },
    ]);
    // Without the perform of a host, an effect gives its payload, as in a run without a host.
    const plain = recorder();
    await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: plain.perform });
    expect(plain.log().effects.map((entry) => entry.outcome)).toEqual([ok({ key: "a", value: 2 }), ok({ key: "a", value: 2 })]);
  });

  it("[RUN.REPLAY] a replayer answers each effect from the log: the replay does no host effect, and gives the recorded result, also with failFast", async () => {
    const ctx = makeContext({}, STD_CAPS);
    const seen: string[] = [];
    const recording = recorder(async (effect) => {
      const text = String(effect.payload);
      seen.push(text);
      await wait(text === "slow" ? 40 : 1);
      if (text === "boom") throw new Error("boom");
      return text.toUpperCase();
    });
    const doc: Json = { type: "fast", value: [{ type: "seq", value: [log("slow"), log("after slow")] }, log("boom"), log("later")] };
    const recorded = await run(machine, doc, ctx, { perform: recording.perform });
    expect(recorded.result).toEqual(ok(["#ABORT", "#CALC!", "#ABORT"]));
    const kept = recording.log();
    expect(kept.settles).toEqual([{ all: "all0", item: 1 }]);
    // The run stopped the first part at its wait, thus its effect has no outcome.
    expect(kept.effects.map((entry) => [entry.address, entry.outcome?.ok])).toEqual([
      ["all0.0/0/0#0", undefined],
      ["all0.1/1#0", false],
    ]);
    const before = seen.length;
    const replayed = await run(machine, doc, ctx, { perform: replayer(kept) });
    expect(replayed.result).toEqual(recorded.result);
    expect(seen).toHaveLength(before);
    // The recorded error comes again with its code, its reason, its place and its cause.
    expect(replayed.effects[1]?.outcome).toEqual(recorded.effects[1]?.outcome);
    // A sequence replays in a run, and in an evaluation with wait: false.
    const sequence = recorder(host);
    const first = await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: sequence.perform });
    expect((await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: replayer(sequence.log()) })).result).toEqual(first.result);
    expect(prepare(STD_MACHINE, WRITE_THEN_LOG).evaluate(ctx, { perform: replayer(sequence.log(), { wait: false }) })).toEqual(first.result);
    // Without wait: false, an effect that waited gives a promise, and an evaluation does not wait (RUN.MOCK).
    expect(prepare(STD_MACHINE, WRITE_THEN_LOG).evaluate(ctx, { perform: replayer(sequence.log()) })).toMatchObject({ ok: false, error: { code: "#CALC!", place: [0] } });
  });

  it("[RUN.REPLAY-MISMATCH] an effect that the log does not have at its address gives #REPLAY!, and the run stops there", async () => {
    const ctx = makeContext({}, STD_CAPS);
    const recording = recorder(host);
    await run(STD_MACHINE, WRITE_THEN_LOG, ctx, { perform: recording.perform });
    const kept = recording.log();
    const replay = async (doc: Json) => run(STD_MACHINE, doc, ctx, { perform: replayer(kept) });
    // Another payload at an address.
    const payload = await replay({ type: "seq", value: [write("b"), { type: "log", value: [ref("names", "last")] }] });
    expect(payload.result).toEqual({ ok: false, error: { code: "#REPLAY!", reason: "The effect write at the address 0#0 has another payload than the log.", place: [0] } });
    expect(payload.effects).toHaveLength(1);
    // Another kind at an address.
    const kind = await replay({ type: "seq", value: [log("x"), log("y")] });
    expect(kind.result).toEqual({ ok: false, error: { code: "#REPLAY!", reason: "The log has the effect write at the address 0#0, and the run asks for the effect log.", place: [0] } });
    // An effect that the log does not have.
    const longer: Json = { type: "seq", value: [write("a"), { type: "log", value: [ref("names", "last")] }, log("more")] };
    const more = await replay(longer);
    expect(more.result).toEqual({ ok: false, error: { code: "#REPLAY!", reason: "The log has no effect at the address 2#0, and the run asks for the effect log.", place: [2] } });
    expect(prepare(STD_MACHINE, longer).evaluate(ctx, { perform: replayer(kept, { wait: false }) })).toMatchObject({ ok: false, error: { code: "#REPLAY!", place: [2] } });
  });
});

/** This function gives the journal of a function `perform`. */
function journalOf(perform: Perform): Journal {
  return (perform as unknown as { readonly [JOURNAL]: Journal })[JOURNAL];
}

/** A host that answers after a number of turns of promises, thus each run gets the same order of the waits. */
function after(turns: number, answer: () => unknown): Promise<unknown> {
  let chain: Promise<unknown> = Promise.resolve();
  for (let turn = 0; turn < turns; turn += 1) chain = chain.then(() => undefined);
  return chain.then(answer);
}

/** A host whose slow effect settles after its fast effect. */
const turns: Perform = (effect) => after(effect.payload === "slow" ? 6 : 1, () => String(effect.payload).toUpperCase());

describe("a replayer for more than one run", () => {
  it("[RUN.REPLAY-RUNS] one replayer serves runs after each other and at the same time, and a run with a mismatch does not change the next run", async () => {
    const ctx = makeContext({}, STD_CAPS);
    const doc: Json = { type: "par", value: [log("slow"), log("fast")] };
    const recording = recorder(turns);
    const first = await run(machine, doc, ctx, { perform: recording.perform });
    const kept = recording.log();
    expect(kept.settles).toEqual([
      { all: "all0", item: 1 },
      { all: "all0", item: 0 },
    ]);
    const replay = replayer(kept);
    // Each run settles the waits in the recorded order, also when two runs share the replayer at the same time.
    const replays = async (): Promise<readonly unknown[]> => {
      const again = recorder(replay);
      const done = await run(machine, doc, ctx, { perform: again.perform });
      return [done.result, again.log().settles];
    };
    const expected = [first.result, kept.settles];
    expect(await replays()).toEqual(expected);
    expect(await replays()).toEqual(expected);
    expect(await Promise.all([replays(), replays(), replays()])).toEqual([expected, expected, expected]);
    // The reference gives the count too, thus it shares the replayer with the plan.
    const watched = recorder(replay);
    expect(await referenceRun(machine, doc, ctx, { perform: watched.perform })).toEqual(first.result);
    expect(watched.log().settles).toEqual(kept.settles);
    // A mismatch gives #REPLAY! in its run, and the next run replays again.
    const other = await run(machine, { type: "par", value: [log("other"), log("fast")] }, ctx, { perform: replay });
    expect(other.result).toEqual(ok(["#REPLAY!", "FAST"]));
    expect(await replays()).toEqual(expected);
  });

  it("[RUN.REPLAY-RUNS] the journal of a replayer reads the count of the kernel, a call without the count keeps a place, and a recorded item that does not wait gives the order of the host", async () => {
    const ctx = makeContext({}, STD_CAPS);
    const doc: Json = { type: "par", value: [log("slow"), log("fast")] };
    const recording = recorder(turns);
    await run(machine, doc, ctx, { perform: recording.perform });
    const kept = recording.log();
    const journal = journalOf(replayer(kept));
    // The kernel gives the count: each call with the same count gives the same item.
    expect([journal.next?.("all0", [0, 1], 0), journal.next?.("all0", [0, 1], 0), journal.next?.("all0", [0], 1)]).toEqual([1, 1, 0]);
    expect([journal.next?.("all0", [0], 2), journal.next?.("all1", [0, 1], 0)]).toEqual([undefined, undefined]);
    // An older copy of the kernel gives no count, thus the replayer keeps its place for each all.
    const old = journalOf(replayer(kept));
    expect([old.next?.("all0", [0]), old.next?.("all0", [0, 1]), old.next?.("all0", [0]), old.next?.("all0", [0])]).toEqual([undefined, 1, 0, undefined]);
    // In this log the fast effect does not wait. Its recorded wait thus does not come, and the wait of the slow effect follows the order of the host.
    const changed: ReplayLog = { ...kept, effects: kept.effects.map((entry) => (entry.payload === "fast" ? { ...entry, waited: false } : entry)) };
    const again = recorder(replayer(changed));
    expect((await run(machine, doc, ctx, { perform: again.perform })).result).toEqual(ok(["SLOW", "FAST"]));
    expect(again.log().settles).toEqual([{ all: "all0", item: 0 }]);
  });

  it("[RUN.REPLAY-ORDER] a recorder over a replayer keeps the recorded order of the waits, also in nested all and with failFast", async () => {
    const ctx = makeContext({}, STD_CAPS);
    const docs: readonly Json[] = [
      { type: "par", value: [log("slow"), log("fast")] },
      { type: "par", value: [{ type: "par", value: [log("slow"), log("fast")] }, log("fast"), { type: "seq", value: [log("slow"), log("fast")] }] },
      { type: "fast", value: [{ type: "seq", value: [log("slow"), log("after slow")] }, log("boom"), log("later")] },
    ];
    const host: Perform = (effect) =>
      after(effect.payload === "slow" ? 6 : 1, () => {
        if (effect.payload === "boom") throw new Error("boom");
        return String(effect.payload).toUpperCase();
      });
    for (const doc of docs) {
      const recording = recorder(host);
      const first = await run(machine, doc, ctx, { perform: recording.perform });
      const kept = recording.log();
      // The waits of a replay settle in the order of their start without the journal, thus the recorded order comes from the replayer.
      const again = recorder(replayer(kept));
      const second = await run(machine, doc, ctx, { perform: again.perform });
      expect(second.result).toEqual(first.result);
      expect(again.log()).toEqual(kept);
    }
  });
});

/** The domain of a time, with a codec (D40). */
const DATE: Domain = {
  is: (value) => value instanceof Date && !Number.isNaN(value.getTime()),
  codec: { encode: (value) => (value as Date).toISOString(), decode: (data) => new Date(data as string) },
};

/** The machine of the replays, with the domain of a time. */
const dated: Machine = { ...machine, domains: { date: DATE } };

/** Two times are the same when they hold the same time. */
const sameDate = (a: unknown, b: unknown): boolean | undefined => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : undefined);

/** A value of a class without a codec. */
class Box {
  constructor(readonly v: unknown) {}
}

/** The names of the generated runs: values that JSON cannot write, a time, and a value without a codec. */
const NAMES: Readonly<Record<string, unknown>> = {
  a: 1,
  nan: Number.NaN,
  neg: -0,
  nothing: undefined,
  when: new Date(Date.UTC(2026, 9, 29)),
  list: [1, Number.NaN, undefined],
  box: new Box(1),
};

/**
 * A host that answers at once or after a number of turns that depends on the address. It refuses some payloads with an
 * exception or with a `Failure`, and it gives `-0`, `NaN` and `undefined` back.
 */
function generatedHost(effect: Effect): unknown {
  let count = 0;
  for (const char of effect.address ?? "") count = (count + char.charCodeAt(0)) % 4;
  const answer = (): unknown => {
    if (effect.payload === "") throw new Error("The host refuses an empty text.");
    if (effect.payload === "b") throw new Failure({ code: "#MOCK", reason: "The host refuses b." });
    if (effect.payload === "a" && count > 1) throw Object.assign(new TypeError("The host refuses a late a.", { cause: new Error("The queue is full.") }), { code: "ELATE" });
    if (effect.payload === "c" && count > 1) throw new AggregateError([new Error("The first try failed."), new RangeError("The second try failed.")], "Each try of c failed.");
    // An enumerable list of exceptions with an item without a form in the middle, and a record with an exception (RUN.REPLAY-FIELDS).
    if (effect.payload === "c" && count === 1) {
      const errors = [new Error("The first try failed."), () => 1, new RangeError("The third try failed.")];
      throw Object.assign(new Error("Each try of c failed."), { errors, detail: { inner: new Error("The queue is full."), tries: [1, () => 1] } });
    }
    if (typeof effect.payload === "number") return -effect.payload;
    return effect.kind === "write" ? { stored: effect.address } : [effect.address, effect.payload];
  };
  return count === 0 ? answer() : after(count * 2, answer);
}

/** This function gives the names, the messages and the own fields of a chain of causes, until a cause that is not an exception. */
function chainOf(value: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let at = value; at instanceof Error && chain.length < 10; at = at.cause) {
    const step: unknown[] = [at.name, at.message, { ...at }];
    if (at instanceof AggregateError) step.push((at.errors as unknown[]).map((error) => (error instanceof Error ? [error.name, error.message] : error)));
    chain.push(step);
  }
  return chain;
}

/** This function tells if two results are the same, with the chain of the causes that are exceptions. */
function sameRun(a: Result, b: Result): boolean {
  if (!sameResult(a, b, sameDate)) return false;
  if (a.ok || b.ok) return true;
  const x: unknown = a.error.cause;
  const y: unknown = b.error.cause;
  if (x instanceof Error || y instanceof Error) return JSON.stringify(chainOf(x)) === JSON.stringify(chainOf(y));
  return Object.hasOwn(a.error, "cause") === Object.hasOwn(b.error, "cause");
}

describe("the JSON form of a log", () => {
  it("[RUN.REPLAY-JSON] encodeLog writes values that JSON cannot write, errors and their causes, and decodeLog reads them again", () => {
    const log: ReplayLog = {
      effects: [
        { address: "0#0", kind: "log", payload: Number.NaN, outcome: ok(-0), waited: true },
        { address: "1#0", kind: "log", payload: undefined, outcome: ok(undefined), waited: false },
        { address: "2#0", kind: "log", payload: { type: "ref", value: ["x"] }, outcome: ok([new Date(Date.UTC(2026, 0, 1)), Number.POSITIVE_INFINITY]), waited: false },
        { address: "3#0", kind: "write", payload: { key: "a" }, outcome: { ok: false, error: { code: "#CALC!", reason: "The host failed.", place: [3], cause: new TypeError("no") } }, waited: true },
        { address: "4#0", kind: "log", payload: "b", outcome: { ok: false, error: { code: "#MOCK", reason: "Refused.", cause: { why: "b" } } }, waited: false },
        { address: "5#0", kind: "log", payload: "c", outcome: { ok: false, error: { code: "#MOCK", reason: "Refused.", cause: undefined } }, waited: false },
        { address: "all0.0/0#0", kind: "log", payload: "d", waited: true },
      ],
      settles: [{ all: "all0", item: 1 }],
    };
    const json = encodeLog(dated, log);
    expect(json).toEqual({
      version: 1,
      effects: [
        { address: "0#0", kind: "log", payload: { type: ["ext", "number"], value: "NaN" }, outcome: { ok: true, value: { type: ["ext", "number"], value: "-0" } }, waited: true },
        { address: "1#0", kind: "log", payload: { type: ["ext", "undefined"], value: null }, outcome: { ok: true, value: { type: ["ext", "undefined"], value: null } }, waited: false },
        {
          address: "2#0",
          kind: "log",
          payload: { type: "lit", value: { type: "ref", value: ["x"] } },
          outcome: {
            ok: true,
            value: {
              type: "list",
              value: [
                { type: ["ext", "domain"], value: { domain: "date", data: "2026-01-01T00:00:00.000Z" } },
                { type: ["ext", "number"], value: "Infinity" },
              ],
            },
          },
          waited: false,
        },
        { address: "3#0", kind: "write", payload: { key: "a" }, outcome: { ok: false, error: { code: "#CALC!", reason: "The host failed.", place: [3], exception: { name: "TypeError", message: "no" } } }, waited: true },
        { address: "4#0", kind: "log", payload: "b", outcome: { ok: false, error: { code: "#MOCK", reason: "Refused.", cause: { why: "b" } } }, waited: false },
        { address: "5#0", kind: "log", payload: "c", outcome: { ok: false, error: { code: "#MOCK", reason: "Refused.", cause: { type: ["ext", "undefined"], value: null } } }, waited: false },
        { address: "all0.0/0#0", kind: "log", payload: "d", waited: true },
      ],
      settles: [{ all: "all0", item: 1 }],
    });
    const back = decodeLog(dated, JSON.parse(JSON.stringify(json)));
    if (!back.ok) throw new Error(back.error.reason);
    const effects = back.value.effects;
    expect(Number.isNaN(effects[0]?.payload)).toBe(true);
    expect(Object.is(effects[0]?.outcome?.ok === true && effects[0].outcome.value, -0)).toBe(true);
    // undefined stays a value, and a missing outcome stays missing.
    expect(Object.hasOwn(effects[1] ?? {}, "payload") && effects[1]?.payload === undefined).toBe(true);
    expect(effects[1]?.outcome).toEqual(ok(undefined));
    expect(Object.hasOwn(effects[6] ?? {}, "outcome")).toBe(false);
    expect(effects[2]?.payload).toEqual({ type: "ref", value: ["x"] });
    const value = effects[2]?.outcome?.ok === true ? (effects[2].outcome.value as readonly unknown[]) : [];
    expect(value[0] instanceof Date && value[0].getTime()).toBe(Date.UTC(2026, 0, 1));
    // An exception keeps its class, its name and its message. Its stack is not in the form.
    const cause: unknown = effects[3]?.outcome?.ok === false ? effects[3].outcome.error.cause : undefined;
    expect(cause instanceof TypeError && cause.message).toBe("no");
    expect(effects[4]?.outcome).toEqual({ ok: false, error: { code: "#MOCK", reason: "Refused.", cause: { why: "b" } } });
    expect(Object.hasOwn(effects[5]?.outcome?.ok === false ? effects[5].outcome.error : {}, "cause")).toBe(true);
    expect(encodeLog(dated, back.value)).toEqual(json);
  });

  it("[RUN.REPLAY-JSON] encodeLog refuses a value without a term document with the address of its effect, and decodeLog gives #VALUE! at the first bad field", () => {
    const entry = (more: object): ReplayLog => ({ effects: [{ address: "0#0", kind: "log", payload: "x", waited: false, ...more }], settles: [] });
    const refusal = (log: ReplayLog): string => {
      try {
        encodeLog(dated, log);
      } catch (error) {
        return error instanceof TypeError ? error.message : "another exception";
      }
      return "no refusal";
    };
    expect(refusal(entry({ payload: () => 1 }))).toMatch(/^encodeLog cannot write the payload of the effect log at the address 0#0: encodeValue cannot write the value/);
    expect(refusal(entry({ payload: Symbol("s") }))).toMatch(/the payload of the effect log at the address 0#0/);
    expect(refusal(entry({ payload: 1n }))).toMatch(/no domain of the machine with a codec holds it/);
    expect(refusal(entry({ outcome: ok(new Box(1)) }))).toMatch(/^encodeLog cannot write the outcome of the effect log at the address 0#0/);
    expect(refusal(entry({ outcome: { ok: false, error: { code: "#X", reason: "r", extra: 1 } } }))).toBe(
      "encodeLog cannot write the outcome of the effect log at the address 0#0: the error has the field extra, and the JSON form has no field for it.",
    );
    expect(refusal(entry({ outcome: { ok: false, error: { code: "#X", reason: "r", cause: new Map() } } }))).toMatch(/^encodeLog cannot write the cause of the outcome of the effect log at the address 0#0/);
    // An exception that a domain with a codec holds uses the codec.
    const ranges: Domain = { is: (value) => value instanceof RangeError, codec: { encode: (value) => (value as Error).message, decode: (data) => new RangeError(String(data)) } };
    const errors = { domains: { error: ranges } };
    const coded = encodeLog(errors, entry({ outcome: { ok: false, error: { code: "#X", reason: "r", cause: new RangeError("far") } } }));
    expect(coded.effects[0]?.outcome).toEqual({ ok: false, error: { code: "#X", reason: "r", cause: { type: ["ext", "domain"], value: { domain: "error", data: "far" } } } });
    const reasonOf = (data: unknown): unknown => {
      const read = decodeLog(dated, data);
      return read.ok ? "read" : [read.error.code, read.error.place, read.error.reason];
    };
    const placeOf = (data: unknown): unknown => {
      const read = decodeLog(dated, data);
      return read.ok ? "read" : [read.error.code, read.error.place];
    };
    const good = encodeLog(dated, entry({ outcome: ok(1) }));
    expect(reasonOf(good)).toBe("read");
    expect(reasonOf({ ...good, version: 2 })).toEqual(["#VALUE!", [], "decodeLog cannot read the log: the form is a record with the version 1."]);
    expect(placeOf({ effects: [], settles: [] })).toEqual(["#VALUE!", []]);
    expect(placeOf({ ...good, effects: [{ address: "0#0", kind: "log", waited: false }] })).toEqual(["#VALUE!", ["effects", 0]]);
    expect(placeOf({ ...good, effects: [{ address: "0#0", kind: "log", payload: { type: ["ext", "domain"], value: { domain: "nothing", data: 1 } }, waited: false }] })).toEqual([
      "#VALUE!",
      ["effects", 0, "payload"],
    ]);
    expect(placeOf({ ...good, effects: [{ ...good.effects[0], outcome: { ok: true } }] })).toEqual(["#VALUE!", ["effects", 0, "outcome"]]);
    expect(placeOf({ ...good, effects: [{ ...good.effects[0], outcome: { ok: false, error: { code: "X", reason: "r" } } }] })).toEqual(["#VALUE!", ["effects", 0, "outcome", "error"]]);
    expect(placeOf({ ...good, effects: [{ ...good.effects[0], outcome: { ok: false, error: { code: "#X", reason: "r", exception: { name: "E" } } } }] })).toEqual([
      "#VALUE!",
      ["effects", 0, "outcome", "error", "exception"],
    ]);
    expect(placeOf({ ...good, settles: [{ all: "all0", item: 0.5 }] })).toEqual(["#VALUE!", ["settles", 0]]);
  });

  it("[RUN.REPLAY-JSON] generated runs: each log that encodeLog writes replays from its JSON text with the same result and the same log", async () => {
    const total = 300;
    const ctx = makeContext(NAMES, STD_CAPS);
    const bad: string[] = [];
    let written = 0;
    let refused = 0;
    let reordered = 0;
    let exceptions = 0;
    let chains = 0;
    let hidden = 0;
    let parts = 0;
    let marks = 0;
    let records = 0;
    let special = 0;
    for (let seed = 1; seed <= total; seed += 1) {
      const doc = generate(dated.world, {
        seed,
        names: Object.keys(NAMES),
        malformed: 0.01,
        types: ["par", "par", "fast", "seq", "log", "log", "write", "ref", "text", "number"].map((kind) => [kind]),
        hints: (type) => {
          const kind = String(type[0]);
          if (kind === "par" || kind === "fast" || kind === "seq") return [["log"], ["log"], ["write"], ["par"], ["fast"], ["seq"]];
          return kind === "log" || kind === "write" ? [["text"], ["number"], ["ref"]] : undefined;
        },
        data: (type, rng) => {
          const name = type.join(".");
          if (name === "number") return rng.pick([0, 1, 2.5, -1]);
          if (name === "text") return rng.pick(["", "a", "b", "c"]);
          return undefined;
        },
      });
      const recording = recorder(generatedHost);
      const first = await run(dated, doc, ctx, { perform: recording.perform });
      const kept = recording.log();
      let text: string;
      try {
        text = JSON.stringify(encodeLog(dated, kept));
      } catch (error) {
        // A refusal names the effect and its address.
        if (!(error instanceof TypeError) || !/^encodeLog cannot write .* at the address /.test(error.message)) bad.push(`seed ${seed}: ${String(error)}`);
        refused += 1;
        continue;
      }
      written += 1;
      if (kept.settles.some((settle, index) => kept.settles.slice(index + 1).some((later) => later.all === settle.all && later.item < settle.item))) reordered += 1;
      if (text.includes('"exception"')) exceptions += 1;
      if (text.includes('"fields"')) chains += 1;
      if (text.includes('"hidden"')) hidden += 1;
      if (text.includes('"parts"')) parts += 1;
      if (text.includes('"dropped":true')) marks += 1;
      if (text.includes('"record":{')) records += 1;
      if (text.includes('"ext"')) special += 1;
      const back = decodeLog(dated, JSON.parse(text));
      if (!back.ok) {
        bad.push(`seed ${seed}: ${back.error.reason}`);
        continue;
      }
      const again = recorder(replayer(back.value, { equal: sameDate }));
      const second = await run(dated, doc, ctx, { perform: again.perform });
      if (!sameRun(first.result, second.result)) bad.push(`seed ${seed}: the result differs: ${JSON.stringify(doc)}`);
      if (JSON.stringify(encodeLog(dated, again.log())) !== text) bad.push(`seed ${seed}: the log of the replay differs: ${JSON.stringify(doc)}`);
    }
    expect(bad.slice(0, 3)).toEqual([]);
    expect(written + refused).toBe(total);
    // The corpus reaches each part of the form.
    for (const [name, count] of Object.entries({ written, refused, reordered, exceptions, chains, hidden, parts, marks, records, special })) expect(count, name).toBeGreaterThan(0);
  });
});

/** This function gives a log with one effect whose outcome is an error with a cause. */
function failedWith(cause: unknown): ReplayLog {
  return { effects: [{ address: "0#0", kind: "log", payload: "x", outcome: { ok: false, error: { code: "#CALC!", reason: "The host failed.", cause } }, waited: false }], settles: [] };
}

/** This function gives the JSON form of the exception of the first effect of a log. */
function exceptionOf(json: ReplayLogJson): unknown {
  const outcome = json.effects[0]?.outcome;
  return outcome?.ok === false ? outcome.error.exception : undefined;
}

/** This function gives the cause of the outcome of the first effect of a log that `decodeLog` reads from a JSON text. */
function decodedCause(json: ReplayLogJson): unknown {
  const back = decodeLog(dated, JSON.parse(JSON.stringify(json)));
  if (!back.ok) throw new Error(back.error.reason);
  const outcome = back.value.effects[0]?.outcome;
  return outcome?.ok === false ? outcome.error.cause : undefined;
}

describe("the causes of an exception in the JSON form", () => {
  it("[RUN.REPLAY-CAUSES] a chain of three exceptions keeps each name, message, class and own field with a term document, and decodeLog gives the chain again", () => {
    const port = new RangeError("The port is out of range.");
    const socket = Object.assign(new TypeError("The socket closed.", { cause: port }), { errno: -111, at: new Date(Date.UTC(2026, 9, 29)) });
    const connect = Object.assign(new Error("The connection failed.", { cause: socket }), { code: "ECONNREFUSED", retry: undefined });
    const json = encodeLog(dated, failedWith(connect));
    expect(exceptionOf(json)).toEqual({
      name: "Error",
      message: "The connection failed.",
      fields: { code: "ECONNREFUSED", retry: { type: ["ext", "undefined"], value: null } },
      exception: {
        name: "TypeError",
        message: "The socket closed.",
        fields: { errno: -111, at: { type: ["ext", "domain"], value: { domain: "date", data: "2026-10-29T00:00:00.000Z" } } },
        exception: { name: "RangeError", message: "The port is out of range." },
      },
    });
    const cause = decodedCause(json);
    expect(cause instanceof Error && cause.message).toBe("The connection failed.");
    expect(chainOf(cause).map((step) => (step as unknown[]).slice(0, 2))).toEqual([
      ["Error", "The connection failed."],
      ["TypeError", "The socket closed."],
      ["RangeError", "The port is out of range."],
    ]);
    const second = (cause as Error).cause as Error & { readonly errno?: unknown; readonly at?: unknown };
    expect(second instanceof TypeError && second.errno).toBe(-111);
    expect(second.at instanceof Date && second.at.getTime()).toBe(Date.UTC(2026, 9, 29));
    expect(Object.hasOwn(cause as Error, "retry") && (cause as { readonly retry?: unknown }).retry === undefined).toBe(true);
    // The last exception has no cause, and the field cause is not enumerable, as with the constructor of Error.
    expect(Object.hasOwn(second.cause as Error, "cause")).toBe(false);
    expect(Object.keys(cause as Error)).toEqual(["code", "retry"]);
    // A cause that encodeValue writes ends the chain as a term document.
    const coded = encodeLog(dated, failedWith(new Error("outer", { cause: { why: [1, Number.NaN] } })));
    expect(exceptionOf(coded)).toEqual({ name: "Error", message: "outer", cause: { type: "record", value: { why: { type: "list", value: [1, { type: ["ext", "number"], value: "NaN" }] } } } });
    const outer = decodedCause(coded) as Error;
    expect(Number.isNaN(((outer.cause as { readonly why: unknown[] }).why)[1])).toBe(true);
    // A recording of a replay of the decoded log gives the same form.
    const back = decodeLog(dated, JSON.parse(JSON.stringify(json)));
    expect(back.ok && encodeLog(dated, back.value)).toEqual(json);
  });

  it("[RUN.REPLAY-CAUSES] a cycle of causes is the index of the earlier exception in loop, and decodeLog gives the same cycle", () => {
    const self = new Error("self");
    self.cause = self;
    expect(exceptionOf(encodeLog(dated, failedWith(self)))).toEqual({ name: "Error", message: "self", loop: 0 });
    const a = new Error("a");
    const b = new TypeError("b", { cause: a });
    const c = new Error("c", { cause: b });
    a.cause = c;
    const json = encodeLog(dated, failedWith(a));
    expect(exceptionOf(json)).toEqual({
      name: "Error",
      message: "a",
      exception: { name: "Error", message: "c", exception: { name: "TypeError", message: "b", loop: 0 } },
    });
    const cause = decodedCause(json) as Error;
    const third = (cause.cause as Error).cause as Error;
    expect(third instanceof TypeError && third.message).toBe("b");
    expect(third.cause).toBe(cause);
    const again = decodedCause(encodeLog(dated, failedWith(self))) as Error;
    expect(again.cause).toBe(again);
    // A long chain does not overflow the stack.
    let long = new Error("0");
    for (let index = 1; index < 5000; index += 1) long = new Error(String(index), { cause: long });
    let depth = 0;
    for (let at: unknown = decodedCauseOf(encodeLog(dated, failedWith(long))); at instanceof Error; at = at.cause) depth += 1;
    expect(depth).toBe(5000);
  });

  it("[RUN.REPLAY-CAUSES] an own field or a cause without a term document is a name in dropped, not a refusal, and decodeLog does not give it back", () => {
    const host = Object.assign(new Error("The request failed.", { cause: () => 1 }), { code: "EREQUEST", config: { send: () => 1 }, big: 1n });
    const json = encodeLog(dated, failedWith(host));
    expect(exceptionOf(json)).toEqual({ name: "Error", message: "The request failed.", fields: { code: "EREQUEST" }, dropped: ["config", "big", "cause"] });
    const cause = decodedCause(json) as Error;
    expect(Object.keys(cause)).toEqual(["code"]);
    expect(Object.hasOwn(cause, "cause")).toBe(false);
    // The stack is not a field, and a name or a message that the host sets is not a field either.
    const named = Object.assign(new Error("m"), { name: "HostError" });
    named.stack = "a stack";
    expect(exceptionOf(encodeLog(dated, failedWith(named)))).toEqual({ name: "HostError", message: "m" });
    // A part of the error value itself without a term document stays a refusal (D75).
    expect(() => encodeLog(dated, failedWith(new Map()))).toThrow(TypeError);
  });

  it("[RUN.REPLAY-CAUSES] a log of the version 1 without the new fields decodes as before, and decodeLog gives #VALUE! at a bad field of a chain", () => {
    const old = {
      version: 1,
      effects: [{ address: "0#0", kind: "log", payload: "x", outcome: { ok: false, error: { code: "#CALC!", reason: "r", exception: { name: "TypeError", message: "no" } } }, waited: false }],
      settles: [],
    };
    const back = decodeLog(dated, old);
    if (!back.ok) throw new Error(back.error.reason);
    const cause = back.value.effects[0]?.outcome?.ok === false ? back.value.effects[0].outcome.error.cause : undefined;
    expect(cause instanceof TypeError && cause.message).toBe("no");
    expect(Object.keys(cause as Error)).toEqual([]);
    expect(Object.hasOwn(cause as Error, "cause")).toBe(false);
    expect(encodeLog(dated, back.value)).toEqual(old);
    const placeOf = (exception: unknown): unknown => {
      const read = decodeLog(dated, { ...old, effects: [{ ...old.effects[0], outcome: { ok: false, error: { code: "#X", reason: "r", exception } } }] });
      return read.ok ? "read" : read.error.place;
    };
    const at = ["effects", 0, "outcome", "error", "exception"];
    expect(placeOf({ name: "E", message: "m", loop: 1 })).toEqual([...at, "loop"]);
    expect(placeOf({ name: "E", message: "m", exception: { name: "F", message: "n", loop: 2 } })).toEqual([...at, "exception", "loop"]);
    expect(placeOf({ name: "E", message: "m", exception: { name: "F", message: "n", loop: 1 } })).toBe("read");
    expect(placeOf({ name: "E", message: "m", loop: 0, cause: 1 })).toEqual(at);
    expect(placeOf({ name: "E", message: "m", exception: { name: "F" } })).toEqual([...at, "exception"]);
    expect(placeOf({ name: "E", message: "m", fields: { message: "x" } })).toEqual([...at, "fields", "message"]);
    expect(placeOf({ name: "E", message: "m", fields: { code: { type: ["ext", "domain"], value: { domain: "nothing", data: 1 } } } })).toEqual([...at, "fields", "code"]);
    expect(placeOf({ name: "E", message: "m", dropped: [1] })).toEqual([...at, "dropped"]);
    expect(placeOf({ name: "E", message: "m", stack: "s" })).toEqual(at);
  });
});

describe("the hidden fields of an exception in the JSON form", () => {
  it("[RUN.REPLAY-HIDDEN] an AggregateError of two errors keeps its list errors, and decodeLog gives an AggregateError with a hidden list errors", () => {
    const first = Object.assign(new TypeError("The first host failed."), { code: "EONE" });
    const both = new AggregateError([first, new RangeError("The second host failed.", { cause: 7 })], "Each host failed.");
    const json = encodeLog(dated, failedWith(both));
    expect(exceptionOf(json)).toEqual({
      name: "AggregateError",
      message: "Each host failed.",
      hidden: {
        errors: [
          { exception: { name: "TypeError", message: "The first host failed.", fields: { code: "EONE" } } },
          { exception: { name: "RangeError", message: "The second host failed.", cause: 7 } },
        ],
      },
    });
    const cause = decodedCause(json) as AggregateError;
    expect(cause instanceof AggregateError && cause.message).toBe("Each host failed.");
    // The field errors is not enumerable, as with the standard class.
    expect(Object.keys(cause)).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(cause, "errors")).toMatchObject({ writable: true, enumerable: false, configurable: true });
    const [one, two] = cause.errors as [Error & { readonly code?: unknown }, Error];
    expect(one instanceof TypeError && one.code).toBe("EONE");
    expect(two instanceof RangeError && two.cause).toBe(7);
    // A recording of a replay of the decoded log gives the same form.
    const back = decodeLog(dated, JSON.parse(JSON.stringify(json)));
    expect(back.ok && encodeLog(dated, back.value)).toEqual(json);
    // A SuppressedError keeps its fields error and suppressed.
    const suppressed = new SuppressedError(new Error("The close failed."), "the first error", "The block failed.");
    const kept = encodeLog(dated, failedWith(suppressed));
    expect(exceptionOf(kept)).toEqual({
      name: "SuppressedError",
      message: "The block failed.",
      hidden: { error: { exception: { name: "Error", message: "The close failed." } }, suppressed: { value: "the first error" } },
    });
    const read = decodedCause(kept) as SuppressedError;
    expect(read instanceof SuppressedError && read.suppressed).toBe("the first error");
    expect((read.error as Error).message).toBe("The close failed.");
    expect(Object.keys(read)).toEqual([]);
  });

  it("[RUN.REPLAY-HIDDEN] an entry of errors that is an earlier exception of the walk is its index in loop, and decodeLog gives the same exceptions", () => {
    const outer = new AggregateError([], "outer");
    const child = new Error("child", { cause: outer });
    (outer.errors as unknown[]).push(child, outer, child);
    expect(exceptionOf(encodeLog(dated, failedWith(outer)))).toEqual({
      name: "AggregateError",
      message: "outer",
      hidden: { errors: [{ exception: { name: "Error", message: "child", loop: 0 } }, { loop: 0 }, { loop: 1 }] },
    });
    const back = decodedCause(encodeLog(dated, failedWith(outer))) as AggregateError;
    const [first, second, third] = back.errors as [Error, unknown, unknown];
    expect(first.cause).toBe(back);
    expect(second).toBe(back);
    expect(third).toBe(first);
    // The walk takes the hidden fields before the cause, thus a cause can loop to an entry of errors.
    const entry = new Error("entry");
    const both = new AggregateError([entry], "both", { cause: entry });
    const json = encodeLog(dated, failedWith(both));
    expect(exceptionOf(json)).toEqual({ name: "AggregateError", message: "both", hidden: { errors: [{ exception: { name: "Error", message: "entry" } }] }, loop: 1 });
    const again = decodedCause(json) as AggregateError;
    expect(again.cause).toBe(again.errors[0]);
  });

  it("[RUN.REPLAY-HIDDEN] a hidden value without a term document is a name in dropped, and only the fields of the standard classes are hidden fields", () => {
    const list = new AggregateError([new Error("a"), () => 1, Symbol("s")], "m");
    const json = encodeLog(dated, failedWith(list));
    // Since D78, an item without a form keeps its place with the mark dropped, and decodeLog gives a hole there.
    expect(exceptionOf(json)).toEqual({
      name: "AggregateError",
      message: "m",
      dropped: ["errors.1", "errors.2"],
      hidden: { errors: [{ exception: { name: "Error", message: "a" } }, { dropped: true }, { dropped: true }] },
    });
    const holes = (decodedCause(json) as AggregateError).errors as unknown[];
    expect(holes.length).toBe(3);
    expect((holes[0] as Error).message).toBe("a");
    expect([1 in holes, 2 in holes]).toEqual([false, false]);
    const broken = new Error("broken");
    Object.defineProperty(broken, "error", {
      enumerable: false,
      get: () => {
        throw new Error("no read");
      },
    });
    Object.defineProperty(broken, "suppressed", { value: new Map(), enumerable: false });
    expect(exceptionOf(encodeLog(dated, failedWith(broken)))).toEqual({ name: "Error", message: "broken", dropped: ["error", "suppressed"] });
    // Another field that is not enumerable is not in the form, and an enumerable field errors stays in fields.
    const other = Object.defineProperty(new Error("other"), "secret", { value: 1, enumerable: false });
    expect(exceptionOf(encodeLog(dated, failedWith(other)))).toEqual({ name: "Error", message: "other" });
    const plain = Object.assign(new Error("plain"), { errors: [1, 2] });
    expect(exceptionOf(encodeLog(dated, failedWith(plain)))).toEqual({ name: "Error", message: "plain", fields: { errors: [1, 2] } });
  });

  it("[RUN.REPLAY-HIDDEN] an item without a form in the middle of a list keeps its place, the later items keep their index, and a hole stays a hole", () => {
    const later = new Error("later");
    const list = new AggregateError([new Error("first"), () => 1, later], "m", { cause: later });
    const json = encodeLog(dated, failedWith(list));
    // The index of later is 2 in the walk, thus the cause loops to 2 and the item keeps the place 2.
    expect(exceptionOf(json)).toEqual({
      name: "AggregateError",
      message: "m",
      dropped: ["errors.1"],
      hidden: { errors: [{ exception: { name: "Error", message: "first" } }, { dropped: true }, { exception: { name: "Error", message: "later" } }] },
      loop: 2,
    });
    const back = decodedCause(json) as AggregateError;
    const errors = back.errors as unknown[];
    expect(errors.length).toBe(3);
    expect(1 in errors).toBe(false);
    expect((errors[2] as Error).message).toBe("later");
    expect(back.cause).toBe(errors[2]);
    // A hole of a list has no form either, thus a recording of a replay of the decoded log gives the same form.
    const read = decodeLog(dated, JSON.parse(JSON.stringify(json)));
    expect(read.ok && encodeLog(dated, read.value)).toEqual(json);
    // The mark is only an item of a list, and its value is true.
    const at = ["effects", 0, "outcome", "error", "exception", "hidden"];
    const placeOf = (hidden: unknown): unknown => {
      const decoded = decodeLog(dated, { ...json, effects: [{ ...json.effects[0], outcome: { ok: false, error: { code: "#X", reason: "r", exception: { name: "E", message: "m", hidden } } } }] });
      return decoded.ok ? "read" : decoded.error.place;
    };
    expect(placeOf({ errors: [{ dropped: true }] })).toBe("read");
    expect(placeOf({ error: { dropped: true } })).toEqual([...at, "error"]);
    expect(placeOf({ errors: [{ dropped: false }] })).toEqual([...at, "errors", 0]);
    expect(placeOf({ errors: [{ dropped: true, value: 1 }] })).toEqual([...at, "errors", 0]);
  });
  it("[RUN.REPLAY-HIDDEN] an old log decodes as before, an AggregateError without hidden gets an empty list, and decodeLog gives #VALUE! at a bad hidden field", () => {
    const old = {
      version: 1,
      effects: [{ address: "0#0", kind: "log", payload: "x", outcome: { ok: false, error: { code: "#CALC!", reason: "r", exception: { name: "AggregateError", message: "no" } } }, waited: false }],
      settles: [],
    };
    const back = decodeLog(dated, old);
    if (!back.ok) throw new Error(back.error.reason);
    const cause = back.value.effects[0]?.outcome?.ok === false ? back.value.effects[0].outcome.error.cause : undefined;
    expect(cause instanceof AggregateError && cause.errors).toEqual([]);
    expect(Object.keys(cause as Error)).toEqual([]);
    // The class always has the list errors, thus a new recording writes the empty list.
    expect(exceptionOf(encodeLog(dated, back.value))).toEqual({ name: "AggregateError", message: "no", hidden: { errors: [] } });
    const placeOf = (exception: unknown): unknown => {
      const read = decodeLog(dated, { ...old, effects: [{ ...old.effects[0], outcome: { ok: false, error: { code: "#X", reason: "r", exception } } }] });
      return read.ok ? "read" : read.error.place;
    };
    const at = ["effects", 0, "outcome", "error", "exception"];
    const errors = [...at, "hidden", "errors"];
    expect(placeOf({ name: "E", message: "m", hidden: { errors: [{ loop: 0 }] } })).toBe("read");
    expect(placeOf({ name: "E", message: "m", hidden: [] })).toEqual([...at, "hidden"]);
    expect(placeOf({ name: "E", message: "m", hidden: { stack: { value: 1 } } })).toEqual([...at, "hidden", "stack"]);
    expect(placeOf({ name: "E", message: "m", fields: { errors: 1 }, hidden: { errors: [] } })).toEqual(errors);
    expect(placeOf({ name: "E", message: "m", hidden: { errors: [{ value: 1, loop: 0 }] } })).toEqual([...errors, 0]);
    expect(placeOf({ name: "E", message: "m", hidden: { errors: [{ loop: 1 }] } })).toEqual([...errors, 0, "loop"]);
    expect(placeOf({ name: "E", message: "m", hidden: { errors: [{ value: { type: ["ext", "domain"], value: { domain: "nothing", data: 1 } } }] } })).toEqual([...errors, 0, "value"]);
    expect(placeOf({ name: "E", message: "m", hidden: { errors: [{ exception: { name: "F" } }] } })).toEqual([...errors, 0, "exception"]);
    expect(placeOf({ name: "E", message: "m", hidden: { error: { exception: { name: "F", message: "n", loop: 2 } } } })).toEqual([...at, "hidden", "error", "exception", "loop"]);
  });
});

describe("the enumerable fields of an exception that hold exceptions in the JSON form", () => {
  it("[RUN.REPLAY-FIELDS] an Error with an enumerable list errors of two exceptions keeps the list in parts, and decodeLog gives an enumerable list again", () => {
    const both = Object.assign(new Error("Each host failed.", { cause: "late" }), {
      code: "EALL",
      errors: [Object.assign(new TypeError("The first host failed."), { code: "EONE" }), new RangeError("The second host failed.", { cause: 7 })],
    });
    const json = encodeLog(dated, failedWith(both));
    expect(exceptionOf(json)).toEqual({
      name: "Error",
      message: "Each host failed.",
      fields: { code: "EALL" },
      parts: {
        errors: [
          { exception: { name: "TypeError", message: "The first host failed.", fields: { code: "EONE" } } },
          { exception: { name: "RangeError", message: "The second host failed.", cause: 7 } },
        ],
      },
      cause: "late",
    });
    const cause = decodedCause(json) as Error & { readonly errors?: unknown };
    // The field errors stays enumerable, after the fields of term documents.
    expect(Object.keys(cause)).toEqual(["code", "errors"]);
    const [one, two] = cause.errors as [Error & { readonly code?: unknown }, Error];
    expect(one instanceof TypeError && one.code).toBe("EONE");
    expect(two instanceof RangeError && two.cause).toBe(7);
    expect(cause.cause).toBe("late");
    const back = decodeLog(dated, JSON.parse(JSON.stringify(json)));
    expect(back.ok && encodeLog(dated, back.value)).toEqual(json);
    // A field with one exception is one part.
    const single = Object.assign(new Error("outer"), { inner: new Error("inner") });
    expect(exceptionOf(encodeLog(dated, failedWith(single)))).toEqual({ name: "Error", message: "outer", parts: { inner: { exception: { name: "Error", message: "inner" } } } });
    expect(((decodedCause(encodeLog(dated, failedWith(single))) as { readonly inner: Error }).inner).message).toBe("inner");
  });

  it("[RUN.REPLAY-FIELDS] a field exception that loops to the outer exception is a loop, and the walk takes the parts before the hidden fields and the cause", () => {
    const outer = new Error("outer");
    Object.assign(outer, { self: outer, errors: [outer] });
    expect(exceptionOf(encodeLog(dated, failedWith(outer)))).toEqual({ name: "Error", message: "outer", parts: { self: { loop: 0 }, errors: [{ loop: 0 }] } });
    const back = decodedCause(encodeLog(dated, failedWith(outer))) as Error & { readonly self: unknown; readonly errors: unknown[] };
    expect(back.self).toBe(back);
    expect(back.errors[0]).toBe(back);
    // The order of the walk: the parts in the order of their keys, the hidden fields, then the cause.
    const first = new Error("first");
    const second = new Error("second");
    const third = new Error("third");
    const all = Object.assign(new AggregateError([second, first], "all", { cause: third }), { b: first, a: [third, second] });
    const json = encodeLog(dated, failedWith(all));
    expect(exceptionOf(json)).toEqual({
      name: "AggregateError",
      message: "all",
      parts: { b: { exception: { name: "Error", message: "first" } }, a: [{ exception: { name: "Error", message: "third" } }, { exception: { name: "Error", message: "second" } }] },
      hidden: { errors: [{ loop: 3 }, { loop: 1 }] },
      loop: 2,
    });
    // The keys of parts keep the order of the walk, also when a single part comes before a list.
    expect(Object.keys((exceptionOf(json) as { readonly parts: object }).parts)).toEqual(["b", "a"]);
    const read = decodedCause(json) as AggregateError & { readonly a: Error[]; readonly b: Error };
    expect(read.errors[0]).toBe(read.a[1]);
    expect(read.errors[1]).toBe(read.b);
    expect(read.cause).toBe(read.a[0]);
    const again = decodeLog(dated, JSON.parse(JSON.stringify(json)));
    expect(again.ok && encodeLog(dated, again.value)).toEqual(json);
  });

  it("[RUN.REPLAY-FIELDS] a list that mixes values and exceptions keeps each item at its place, and an item without a form is the mark dropped", () => {
    const mixed = Object.assign(new Error("mixed"), { tries: [1, new Error("try"), () => 1, Number.NaN, undefined] });
    const json = encodeLog(dated, failedWith(mixed));
    expect(exceptionOf(json)).toEqual({
      name: "Error",
      message: "mixed",
      parts: {
        tries: [
          { value: 1 },
          { exception: { name: "Error", message: "try" } },
          { dropped: true },
          { value: { type: ["ext", "number"], value: "NaN" } },
          { value: { type: ["ext", "undefined"], value: null } },
        ],
      },
      dropped: ["tries.2"],
    });
    const tries = (decodedCause(json) as { readonly tries: unknown[] }).tries;
    expect(tries.length).toBe(5);
    expect(tries[0]).toBe(1);
    expect((tries[1] as Error).message).toBe("try");
    expect([2 in tries, 4 in tries]).toEqual([false, true]);
    expect(Number.isNaN(tries[3])).toBe(true);
    const back = decodeLog(dated, JSON.parse(JSON.stringify(json)));
    expect(back.ok && encodeLog(dated, back.value)).toEqual(json);
    // Since D82, a list without an exception keeps each item with a form in parts, and a list that encodeValue writes stays in fields.
    const values = Object.assign(new Error("values"), { tries: [1, () => 1], codes: [1, 2] });
    expect(exceptionOf(encodeLog(dated, failedWith(values)))).toEqual({
      name: "Error",
      message: "values",
      fields: { codes: [1, 2] },
      parts: { tries: [{ value: 1 }, { dropped: true }] },
      dropped: ["tries.1"],
    });
    // An exception that a domain with a codec holds stays a term document in fields.
    const ranges: Domain = { is: (value) => value instanceof RangeError, codec: { encode: (value) => (value as Error).message, decode: (data) => new RangeError(String(data)) } };
    const coded = exceptionOf(encodeLog({ domains: { error: ranges } }, failedWith(Object.assign(new Error("coded"), { range: new RangeError("far") }))));
    expect(coded).toEqual({ name: "Error", message: "coded", fields: { range: { type: ["ext", "domain"], value: { domain: "error", data: "far" } } } });
  });

  it("[RUN.REPLAY-FIELDS] a list without an exception keeps each item with a form, and a list without a form in it stays one name in dropped", () => {
    const sparse: unknown[] = [1];
    sparse[2] = 3;
    const host = Object.assign(new Error("host"), { tries: [1, () => 1, "x"], handlers: [() => 1, Symbol("s")], grid: [[1, () => 1], [2]], sparse });
    const json = encodeLog(dated, failedWith(host));
    expect(exceptionOf(json)).toEqual({
      name: "Error",
      message: "host",
      parts: {
        tries: [{ value: 1 }, { dropped: true }, { value: "x" }],
        grid: [[{ value: 1 }, { dropped: true }], { value: [2] }],
        sparse: [{ value: 1 }, { dropped: true }, { value: 3 }],
      },
      dropped: ["tries.1", "handlers", "grid.0.1", "sparse.1"],
    });
    const back = decodedCause(json) as Error & { readonly tries: unknown[]; readonly grid: unknown[][]; readonly sparse: unknown[] };
    // The field handlers holds no fact, thus decodeLog does not give it back, as in D76.
    expect(Object.keys(back)).toEqual(["tries", "grid", "sparse"]);
    expect(back.tries.length).toBe(3);
    expect([back.tries[0], 1 in back.tries, back.tries[2]]).toEqual([1, false, "x"]);
    expect(back.grid[0]?.length).toBe(2);
    expect([back.grid[0]?.[0], 1 in (back.grid[0] as unknown[]), back.grid[1]]).toEqual([1, false, [2]]);
    expect([1 in back.sparse, back.sparse.length]).toEqual([false, 3]);
    // A hole has no term document, thus a recording of a replay of the decoded log gives the same form.
    const read = decodeLog(dated, JSON.parse(JSON.stringify(json)));
    expect(read.ok && encodeLog(dated, read.value)).toEqual({ ...json, effects: [{ ...json.effects[0], outcome: { ok: false, error: { code: "#CALC!", reason: "The host failed.", exception: { ...(exceptionOf(json) as object), dropped: ["tries.1", "grid.0.1", "sparse.1"] } } } }] });
  });

  it("[RUN.REPLAY-FIELDS] a record field that holds an exception is the part record, and a record in a list and a list in a record have the same rule", () => {
    const inner = Object.assign(new TypeError("The socket closed."), { errno: -111 });
    const wrapped = Object.assign(new Error("wrapped"), { wrap: { inner, code: 7, send: () => 1 }, config: { send: () => 1 } });
    const json = encodeLog(dated, failedWith(wrapped));
    expect(exceptionOf(json)).toEqual({
      name: "Error",
      message: "wrapped",
      parts: { wrap: { record: { inner: { exception: { name: "TypeError", message: "The socket closed.", fields: { errno: -111 } } }, code: { value: 7 } } } },
      dropped: ["wrap.send", "config"],
    });
    const back = decodedCause(json) as Error & { readonly wrap: { readonly inner: Error & { readonly errno?: unknown }; readonly code: unknown } };
    expect(Object.keys(back)).toEqual(["wrap"]);
    expect(Object.keys(back.wrap)).toEqual(["inner", "code"]);
    expect(back.wrap.inner instanceof TypeError && back.wrap.inner.errno).toBe(-111);
    expect(back.wrap.code).toBe(7);
    // The walk takes the items of a container in the order of their keys, thus a later item can loop to an earlier exception.
    const first = new Error("first");
    const second = new RangeError("second");
    const nested = Object.assign(new Error("nested"), { steps: [{ error: first, at: 1 }, 2], detail: { tries: [second, () => 1], again: first } });
    const form = encodeLog(dated, failedWith(nested));
    expect(exceptionOf(form)).toEqual({
      name: "Error",
      message: "nested",
      parts: {
        steps: [{ record: { error: { exception: { name: "Error", message: "first" } }, at: { value: 1 } } }, { value: 2 }],
        detail: { record: { tries: [{ exception: { name: "RangeError", message: "second" } }, { dropped: true }], again: { loop: 1 } } },
      },
      dropped: ["detail.tries.1"],
    });
    const read = decodedCause(form) as Error & { readonly steps: [{ readonly error: Error }, number]; readonly detail: { readonly tries: unknown[]; readonly again: Error } };
    expect(read.steps[0].error.message).toBe("first");
    expect(read.detail.again).toBe(read.steps[0].error);
    expect((read.detail.tries[0] as Error) instanceof RangeError && read.detail.tries.length).toBe(2);
    const again = decodeLog(dated, JSON.parse(JSON.stringify(form)));
    expect(again.ok && encodeLog(dated, again.value)).toEqual(form);
    // A hidden field has the same rule: a SuppressedError with a record in error.
    const suppressed = new SuppressedError({ inner }, "first", "The block failed.");
    expect(exceptionOf(encodeLog(dated, failedWith(suppressed)))).toEqual({
      name: "SuppressedError",
      message: "The block failed.",
      hidden: { error: { record: { inner: { exception: { name: "TypeError", message: "The socket closed.", fields: { errno: -111 } } } } }, suppressed: { value: "first" } },
    });
    // A cause is a term document, an exception or a loop. A record cause with an exception stays a name in dropped.
    expect(exceptionOf(encodeLog(dated, failedWith(new Error("cause", { cause: { inner } }))))).toEqual({ name: "Error", message: "cause", dropped: ["cause"] });
  });

  it("[RUN.REPLAY-FIELDS] an exception in a nested record that is the outer exception is a loop, a cycle of records is a name in dropped, and a shared record keeps its loops", () => {
    const outer = new Error("outer");
    const ring: Record<string, unknown> = { error: new Error("in the ring") };
    ring["self"] = ring;
    const shared = { error: new TypeError("shared") };
    Object.assign(outer, { context: { owner: outer, deep: { list: [outer] } }, ring, a: shared, b: shared });
    const json = encodeLog(dated, failedWith(outer));
    expect(exceptionOf(json)).toEqual({
      name: "Error",
      message: "outer",
      parts: {
        context: { record: { owner: { loop: 0 }, deep: { record: { list: [{ loop: 0 }] } } } },
        ring: { record: { error: { exception: { name: "Error", message: "in the ring" } } } },
        a: { record: { error: { exception: { name: "TypeError", message: "shared" } } } },
        b: { record: { error: { loop: 2 } } },
      },
      dropped: ["ring.self"],
    });
    const back = decodedCause(json) as Error & {
      readonly context: { readonly owner: unknown; readonly deep: { readonly list: unknown[] } };
      readonly a: { readonly error: Error };
      readonly b: { readonly error: Error };
    };
    expect(back.context.owner).toBe(back);
    expect(back.context.deep.list[0]).toBe(back);
    expect(back.b.error).toBe(back.a.error);
    // A record of the decoded log is a new record, thus a shared record becomes two records with the same exception.
    expect(back.b).not.toBe(back.a);
    // A long chain of causes in records does not overflow the stack.
    let long = new Error("0");
    for (let index = 1; index < 2000; index += 1) long = Object.assign(new Error(String(index)), { wrap: { inner: long } });
    let depth = 0;
    for (let at: unknown = decodedCauseOf(encodeLog(dated, failedWith(long))); at instanceof Error; at = (at as { readonly wrap?: { readonly inner: unknown } }).wrap?.inner) depth += 1;
    expect(depth).toBe(2000);
  });

  it("[RUN.REPLAY-FIELDS] an old log decodes as before, and decodeLog gives #VALUE! at a bad field of parts", () => {
    const old = {
      version: 1,
      effects: [
        {
          address: "0#0",
          kind: "log",
          payload: "x",
          outcome: { ok: false, error: { code: "#CALC!", reason: "r", exception: { name: "Error", message: "old", fields: { errors: [1] }, dropped: ["more"], exception: { name: "TypeError", message: "inner" } } } },
          waited: false,
        },
      ],
      settles: [],
    };
    const back = decodeLog(dated, old);
    if (!back.ok) throw new Error(back.error.reason);
    expect(encodeLog(dated, back.value)).toEqual({ ...old, effects: [{ ...old.effects[0], outcome: { ok: false, error: { code: "#CALC!", reason: "r", exception: { name: "Error", message: "old", fields: { errors: [1] }, exception: { name: "TypeError", message: "inner" } } } } }] });
    const placeOf = (exception: unknown): unknown => {
      const read = decodeLog(dated, { ...old, effects: [{ ...old.effects[0], outcome: { ok: false, error: { code: "#X", reason: "r", exception } } }] });
      return read.ok ? "read" : read.error.place;
    };
    const at = ["effects", 0, "outcome", "error", "exception"];
    expect(placeOf({ name: "E", message: "m", parts: { a: { loop: 0 }, b: [{ dropped: true }] } })).toBe("read");
    expect(placeOf({ name: "E", message: "m", parts: [] })).toEqual([...at, "parts"]);
    expect(placeOf({ name: "E", message: "m", parts: { stack: { value: 1 } } })).toEqual([...at, "parts", "stack"]);
    expect(placeOf({ name: "E", message: "m", fields: { a: 1 }, parts: { a: { value: 1 } } })).toEqual([...at, "parts", "a"]);
    expect(placeOf({ name: "E", message: "m", parts: { errors: [] }, hidden: { errors: [] } })).toEqual([...at, "hidden", "errors"]);
    expect(placeOf({ name: "E", message: "m", parts: { a: { dropped: true } } })).toEqual([...at, "parts", "a"]);
    expect(placeOf({ name: "E", message: "m", parts: { a: [{ loop: 1 }] } })).toEqual([...at, "parts", "a", 0, "loop"]);
    expect(placeOf({ name: "E", message: "m", parts: { a: { exception: { name: "F", message: "n", loop: 2 } } } })).toEqual([...at, "parts", "a", "exception", "loop"]);
    // A record of parts and a list in a list (D82).
    expect(placeOf({ name: "E", message: "m", parts: { a: { record: { b: [{ loop: 0 }, [{ dropped: true }]] } } } })).toBe("read");
    expect(placeOf({ name: "E", message: "m", parts: { a: { record: [] } } })).toEqual([...at, "parts", "a", "record"]);
    expect(placeOf({ name: "E", message: "m", parts: { a: { record: { b: { dropped: true } } } } })).toEqual([...at, "parts", "a", "record", "b"]);
    expect(placeOf({ name: "E", message: "m", parts: { a: [[{ loop: 1 }]] } })).toEqual([...at, "parts", "a", 0, 0, "loop"]);
    expect(placeOf({ name: "E", message: "m", hidden: { error: { record: { b: { value: { type: ["ext", "domain"], value: { domain: "nothing", data: 1 } } } } } } })).toEqual([...at, "hidden", "error", "record", "b", "value"]);
    // A key __proto__ of a record of parts stays an own field.
    const proto = decodeLog(dated, { ...old, effects: [{ ...old.effects[0], outcome: { ok: false, error: { code: "#X", reason: "r", exception: JSON.parse('{"name":"E","message":"m","parts":{"a":{"record":{"__proto__":{"value":1}}}}}') } } }] });
    const decoded = proto.ok && proto.value.effects[0]?.outcome?.ok === false ? (proto.value.effects[0].outcome.error.cause as { readonly a: object }).a : undefined;
    expect(decoded !== undefined && Object.hasOwn(decoded, "__proto__") && Object.getPrototypeOf(decoded)).toBe(Object.prototype);
  });

});

/** This function gives the cause of the outcome of the first effect of a JSON form, without a JSON text. */
function decodedCauseOf(json: ReplayLogJson): unknown {
  const back = decodeLog(dated, json);
  if (!back.ok) throw new Error(back.error.reason);
  const outcome = back.value.effects[0]?.outcome;
  return outcome?.ok === false ? outcome.error.cause : undefined;
}

/** The golden file of a log, its document and its host. `COEVAL_GOLDEN=write` writes the file again. */
const GOLDEN = new URL("../golden/replay.json", import.meta.url);

/** The document of the golden log: an all with three items, a sequence, and an all with failFast. */
const GOLDEN_DOC: Json = {
  type: "seq",
  value: [
    { type: "par", value: [log("slow"), write("a"), { type: "log", value: [ref("names", "when")] }, log("nan")] },
    { type: "fast", value: [{ type: "seq", value: [log("slow"), log("after slow")] }, log("boom"), log("later")] },
  ],
};

/** The host of the golden log. */
const goldenHost: Perform = (effect) => {
  if (effect.payload === "nan") return Number.NaN;
  if (effect.payload instanceof Date) return effect.payload;
  return after(effect.payload === "slow" ? 6 : 1, () => {
    if (effect.payload === "boom") throw new TypeError("boom");
    return effect.kind === "write" ? -0 : String(effect.payload).toUpperCase();
  });
};

describe("a golden log", () => {
  it("[RUN.REPLAY-GOLDEN] the log of a run equals the golden file, and the golden file replays with the result of the run", async () => {
    const ctx = makeContext({ when: new Date(Date.UTC(2026, 9, 29)) }, STD_CAPS);
    const recording = recorder(goldenHost);
    const first = await run(dated, GOLDEN_DOC, ctx, { perform: recording.perform });
    const json = encodeLog(dated, recording.log());
    if (process.env["COEVAL_GOLDEN"] === "write") writeFileSync(GOLDEN, `${JSON.stringify(json, null, 2)}\n`);
    const golden: unknown = JSON.parse(readFileSync(GOLDEN, "utf8"));
    expect(json).toEqual(golden);
    const back = decodeLog(dated, golden);
    if (!back.ok) throw new Error(back.error.reason);
    const replayed = await run(dated, GOLDEN_DOC, ctx, { perform: replayer(back.value, { equal: sameDate }) });
    expect(sameRun(replayed.result, first.result)).toBe(true);
    expect(replayed.result).toEqual(ok(["#ABORT", "#CALC!", "#ABORT"]));
  });
});
