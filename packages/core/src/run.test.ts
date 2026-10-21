import { describe, expect, it } from "vitest";
import { STD_CAPS, STD_MACHINE, evaluate, makeContext, permits, run, type Effect, type Json } from "./index.ts";

const ref = (...path: Json[]): Json => ({ type: "ref", value: path });

describe("a run", () => {
  it("[RUN.SEQ] waits for each effect, and gives its result to the next step as last", async () => {
    const order: string[] = [];
    const out = await run(
      STD_MACHINE,
      {
        type: "seq",
        value: [
          { type: "write", value: { key: "a", value: { type: "number", value: 2 } } },
          { type: "log", value: [ref("names", "last")] },
        ],
      },
      makeContext({}, STD_CAPS),
      {
        perform: async (effect: Effect) => {
          order.push(`start ${effect.kind}`);
          await new Promise((done) => setTimeout(done, 5));
          order.push(`end ${effect.kind}`);
          return effect.kind === "write" ? "stored" : effect.payload;
        },
      },
    );
    expect(out.result).toEqual({ ok: true, value: "stored" });
    expect(order).toEqual(["start write", "end write", "start log", "end log"]);
    expect(out.effects.map((effect) => [effect.kind, effect.payload])).toEqual([
      ["write", { key: "a", value: 2 }],
      ["log", "stored"],
    ]);
  });

  it("[RUN.EAGER] does the part before the first wait at once, in the call", () => {
    const seen: string[] = [];
    void run(STD_MACHINE, { type: "log", value: ["now"] }, makeContext({}, STD_CAPS), {
      perform: (effect) => {
        seen.push(String(effect.payload));
        return null;
      },
    });
    expect(seen).toEqual(["now"]);
  });

  it("[RUN.STOP] stops at a failed step, and the later effects do not happen", async () => {
    const performed: string[] = [];
    const out = await run(
      STD_MACHINE,
      { type: "seq", value: [{ type: "log", value: ["one"] }, { type: "log", value: ["two"] }] },
      makeContext({}, STD_CAPS),
      {
        perform: (effect) => {
          performed.push(String(effect.payload));
          if (effect.payload === "one") throw new Error("the disk is full");
          return null;
        },
      },
    );
    expect(out.result).toMatchObject({ ok: false, error: { code: "#CALC!" } });
    expect(performed).toEqual(["one"]);
  });

  it("[RUN.CAP] refuses an effect without its capability, and the host does not see it", async () => {
    let calls = 0;
    const out = await run(STD_MACHINE, { type: "log", value: ["x"] }, makeContext({}, ["write"]), {
      perform: () => {
        calls += 1;
        return null;
      },
    });
    expect(out.result).toMatchObject({ ok: false, error: { code: "#CAP!" } });
    expect(calls).toBe(0);
  });

  it("[RUN.PURE] refuses an effect inside pure, also in a run", async () => {
    const out = await run(STD_MACHINE, { type: "pure", value: [{ type: "log", value: ["x"] }] }, makeContext({}, STD_CAPS));
    expect(out.result).toMatchObject({ ok: false, error: { code: "#CAP!" } });
  });

  it("[RUN.SAME] gives the same derived values as an evaluation", async () => {
    const doc: Json = { type: "if", value: { test: { type: "greater", value: [3, 2] }, then: { type: "add", value: [1, 2] } } };
    const out = await run(STD_MACHINE, doc, makeContext({}, STD_CAPS));
    expect(out.result).toEqual(evaluate(STD_MACHINE, doc, makeContext({}, STD_CAPS)).result);
    expect(out.result).toEqual({ ok: true, value: 3 });
  });

  it("[RUN.NESTED-WAIT] refuses a step that waits inside a part that cannot wait", async () => {
    const out = await run(STD_MACHINE, { type: "add", value: [1, { type: "log", value: ["x"] }] }, makeContext({}, STD_CAPS));
    expect(out.result).toMatchObject({ ok: false, error: { code: "#CALC!" } });
    expect(out.effects).toEqual([]);
  });
});

describe("capabilities", () => {
  it("[CAP.NAMESPACE] permit a kind by its name, or by its namespace", () => {
    expect(permits(["store"], "store.update")).toBe(true);
    expect(permits(["store.update"], "store.update")).toBe(true);
    expect(permits(["store.update"], "store.remove")).toBe(false);
    expect(permits(["store"], "storefront")).toBe(false);
  });
});
