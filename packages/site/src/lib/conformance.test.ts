import { describe, expect, it } from "vitest";
import { conforms, STD_MACHINE, ok, type EvalFn, type Machine } from "@mark1russell7/coeval";
import { SUBJECTS, conformModel } from "./conformance.ts";

function with1(code: unknown): Machine {
  return {
    ...STD_MACHINE,
    world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, total: SUBJECTS[0]!.kind } },
    evaluators: { ...STD_MACHINE.evaluators, total: code as EvalFn },
  };
}

describe("probe", () => {
  it("prints", () => {
    const asyncTotal = async ({ parts }: Parameters<EvalFn>[0]) => {
      let sum = 0;
      for (const part of parts) {
        const r = part.evaluate();
        if (!r.ok) return r;
        sum += Number(r.value);
      }
      return ok(sum);
    };
    try {
      console.log("async", conforms(with1(asyncTotal), "total").map((f) => `${f.obligation}: ${f.reason}`));
    } catch (e) {
      console.log("async threw", String(e));
    }
    const thenable: EvalFn = ({ parts }) => {
      let sum = 0;
      for (const part of parts) {
        const r = part.evaluate();
        if (!r.ok) return r;
        sum += Number(r.value);
      }
      return ok({ then: (resolve: (v: number) => void) => resolve(sum) });
    };
    console.log("thenable", conforms(with1(thenable), "total").map((f) => `${f.obligation}: ${f.reason}`));
    expect(SUBJECTS.length).toBe(2);
    for (const subject of SUBJECTS) for (const item of subject.breaks) console.log(subject.id, item.id, [...conformModel(subject, item).broken]);
  });
});
