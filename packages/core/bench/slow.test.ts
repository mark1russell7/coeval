import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { limitsOf, percentOf } from "./limits.ts";
import { bundle, slowFactors } from "./paths.ts";

const INDEX = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const CASE = "PLAN.FOLD a record of 20 literals";
const dir = mkdtempSync(join(tmpdir(), "coeval-slow-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the seeded slowdown of the flip test (K225, D180)", () => {
  it("gives exp(k * margin) for each case, thus k = 1 is a slowdown of exactly the printed margin", () => {
    const margin = limitsOf(CASE).options.margin ?? 0;
    expect(margin).toBeGreaterThan(0);
    const [one, two] = [slowFactors([CASE], 1)[0] ?? 0, slowFactors([CASE], 2)[0] ?? 0];
    expect(`${((one - 1) * 100).toFixed(2)} %`).toBe(percentOf(margin));
    expect(Math.log(two)).toBeCloseTo(2 * Math.log(one), 12);
  });

  it("refuses a multiple that is not above 0 and at most 4", () => {
    for (const multiple of [0, -1, 4.5, Number.NaN]) expect(() => slowFactors([CASE], multiple)).toThrow(RangeError);
  });

  it("puts the factors only into a bundle that gets them", async () => {
    const plain = readFileSync(await bundle(INDEX, "plain", dir), "utf8");
    const slow = readFileSync(await bundle(INDEX, "slow", dir, undefined, undefined, [1.25]), "utf8");
    expect(plain).toContain('typeof BENCH_SLOW === "undefined"');
    expect(plain).not.toMatch(/BENCH_SLOW\w* = \[/);
    expect(slow).not.toContain("typeof BENCH_SLOW ");
    expect(slow).toMatch(/BENCH_SLOW\w* = \[1\.25\]/);
  }, 30000);
});
