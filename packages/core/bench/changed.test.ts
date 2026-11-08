import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResultRow } from "@mark1russell7/rigor-bench";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCEPTED, resultHash } from "./merge.ts";
import { rowsOf, speedRun } from "./paths.ts";

const KERNEL = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const CHANGED = "FORMULA.SPEED formula";
const OTHER = "a reference of five steps";
const [BEFORE, AFTER] = ['{"ok":true,"value":4}', '{"ok":true,"value":5}'];
const ROW: ResultRow = { case: CHANGED, base: resultHash(BEFORE), head: resultHash(AFTER), reason: "the head reads x one higher" };
const dir = mkdtempSync(join(tmpdir(), "coeval-changed-"));
const saved = { ms: process.env["BENCH_MS"], warmup: process.env["BENCH_WARMUP"], samples: process.env["BENCH_SAMPLES"] };

/**
 * This function writes a head kernel that changes the result of one case on purpose: its `context` reads the name `x`
 * one higher. The folder is `src`, as in the real arms. Each other export is the export of the kernel.
 */
function changedKernel(): string {
  const target = join(dir, "changed", "src");
  mkdirSync(target, { recursive: true });
  const kernel = JSON.stringify(KERNEL.replaceAll("\\", "/"));
  writeFileSync(
    join(target, "index.ts"),
    [
      `export * from ${kernel};`,
      `import { context as kernelContext } from ${kernel};`,
      "export function context(parts = {}) {",
      "  const names = parts.names;",
      '  return kernelContext(names !== undefined && typeof names.x === "number" ? { ...parts, names: { ...names, x: names.x + 1 } } : parts);',
      "}",
      "",
    ].join("\n"),
  );
  return join(target, "index.ts");
}

beforeAll(() => {
  // The child processes read these settings. One short sample is enough for a read of the rows.
  Object.assign(process.env, { BENCH_MS: "1", BENCH_WARMUP: "0", BENCH_SAMPLES: "1" });
});

afterAll(() => {
  for (const [key, value] of [["BENCH_MS", saved.ms], ["BENCH_WARMUP", saved.warmup], ["BENCH_SAMPLES", saved.samples]] as const) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("a result that changes on purpose (K237, D169)", () => {
  it("times a case whose changed result a new row accepts, with different arms", async () => {
    const head = changedKernel();
    const { record, lines, results } = await speedRun({ baseFile: KERNEL, headFile: head, rounds: 1, run: "1", cases: [CHANGED, OTHER], rows: { base: [], head: [ROW] } });
    expect(results.outcome).toBe("pass");
    expect(record.arms?.base).not.toBe(record.arms?.head);
    const [changed, other] = [record.cases.find((item) => item.name === CHANGED), record.cases.find((item) => item.name === OTHER)];
    expect(changed?.different).toBeUndefined();
    expect(changed?.accepted).toContain("the head reads x one higher");
    expect(changed?.head?.length).toBe(1);
    expect(changed?.aa?.length).toBe(1);
    expect(changed?.head?.every((pair) => pair.a > 0 && pair.b > 0)).toBe(true);
    expect(other?.accepted).toBeUndefined();
    expect(other?.head?.length).toBe(1);
    expect(record.results).toEqual({ outcome: "pass", lines: results.lines, faults: [] });
    expect(lines.some((line) => line.startsWith(`| ${CHANGED} |`) && line.endsWith(`${ACCEPTED} |`))).toBe(true);
  }, 120000);

  it("refuses the change with no row, with a spent row, and with a row of another head, and times nothing", async () => {
    const head = changedKernel();
    const read = async (base: readonly ResultRow[], heads: readonly ResultRow[]) =>
      speedRun({ baseFile: KERNEL, headFile: head, rounds: 1, run: "1", cases: [CHANGED], rows: { base, head: heads } });
    const none = await read([], []);
    expect(none.results.outcome).toBe("fail");
    expect(none.record.cases[0]?.different).toBe(`${BEFORE} and ${AFTER}`);
    expect(none.record.cases[0]?.head).toBeUndefined();
    expect(none.lines.join("\n")).toContain(`add the row ${JSON.stringify({ case: CHANGED, base: ROW.base, head: ROW.head, reason: "the reason for the change" })}`);
    const spent = await read([ROW], [ROW]);
    expect(spent.results.outcome).toBe("fail");
    expect(spent.results.cases[0]?.line).toContain("is spent");
    const other = await read([], [{ ...ROW, head: resultHash('{"ok":true,"value":6}') }]);
    expect(other.results.outcome).toBe("fail");
    expect(other.results.cases[0]?.line).toContain("the head moved");
  }, 120000);

  it("fails a new row on equal results, as a fault that the record keeps", async () => {
    const { record, results } = await speedRun({ baseFile: KERNEL, headFile: KERNEL, rounds: 1, run: "2", cases: [CHANGED], rows: { base: [], head: [ROW] } });
    expect(results.outcome).toBe("fail");
    expect(record.cases[0]?.different).toBeUndefined();
    expect(record.results?.faults).toEqual([`The new row of the case ${JSON.stringify(CHANGED)} accepts no change of this run. Delete or correct the row.`]);
  }, 120000);

  it("reads the rows of an arm next to its index.ts, and no rows when the file is absent", () => {
    expect(rowsOf(KERNEL)).toEqual([]);
    expect(rowsOf(join(dir, "nowhere", "src", "index.ts"))).toEqual([]);
    const target = join(dir, "rows");
    mkdirSync(join(target, "bench"), { recursive: true });
    writeFileSync(join(target, "bench", "changed-results.json"), JSON.stringify([ROW]));
    expect(rowsOf(join(target, "src", "index.ts"))).toEqual([ROW]);
    writeFileSync(join(target, "bench", "changed-results.json"), JSON.stringify([{ ...ROW, reason: "" }]));
    expect(() => rowsOf(join(target, "src", "index.ts"))).toThrow("has no reason");
  });

  it("gives one hash for one result, of 16 hexadecimal digits", () => {
    expect(resultHash(BEFORE)).toMatch(/^[0-9a-f]{16}$/);
    expect(resultHash(BEFORE)).toBe(resultHash(BEFORE));
    expect(resultHash(BEFORE)).not.toBe(resultHash(AFTER));
  });
});
