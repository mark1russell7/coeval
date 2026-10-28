import { describe, expect, it } from "vitest";
import { VARIANTS, editLog, record, replay, rowsOf } from "./replays.ts";

describe("probe replay", () => {
  it("prints", async () => {
    const rec = await record();
    console.log(JSON.stringify(rec, null, 1));
    for (const variant of VARIANTS) {
      const r = await replay(variant.doc, rec.log);
      console.log(variant.id, JSON.stringify(r.result), JSON.stringify(rowsOf(rec.log, r.requests).map((row) => [row.address, row.verdict, row.step])));
    }
    for (const edit of ["other", "error"] as const) {
      for (const address of rec.log.effects.map((e) => e.address)) {
        const log = editLog(rec.log, { [address]: edit });
        const r = await replay(VARIANTS[0]!.doc, log);
        console.log(edit, address, JSON.stringify(r.result), JSON.stringify(rowsOf(log, r.requests).map((row) => [row.address, row.verdict, row.step])));
      }
    }
    expect(true).toBe(true);
  });
});
