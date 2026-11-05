import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PairedTime } from "@mark1russell7/rigor-bench";
import { afterAll, describe, expect, it } from "vitest";
import { speedState, type BenchCase, type BenchRun } from "./merge.ts";

const SCRIPT = fileURLToPath(new URL("./speed-read.ts", import.meta.url));
const MERGE = fileURLToPath(new URL("./merge.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "coeval-speed-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** This function gives the rounds of one case: the base takes 1 ms, and the other arm takes `ratio` times that. */
function pair(name: string, ratio: number, offset: number): PairedTime[] {
  return Array.from({ length: 12 }, (_, index) => ({ case: name, round: offset + index, first: index % 2 === 0 ? "a" : "b", a: 1, b: ratio * (1 + 0.002 * ((index % 5) - 2)) }));
}

/** This function gives one case of a run. */
function benchCase(name: string, ratio: number, offset: number): BenchCase {
  return { name, baseNs: 1e6, headNs: ratio * 1e6, change: (ratio - 1) * 100, noise: 0, head: pair(name, ratio, offset), aa: pair(name, 1, offset) };
}

/** This function writes a run file, and gives its path. */
function runFile(name: string, cases: readonly BenchCase[]): string {
  const file = join(dir, `${name}.json`);
  const run: BenchRun = { run: name, cpu: "a CPU", node: "v26", rounds: 12, arms: { base: "a", head: "a" }, cases };
  writeFileSync(file, JSON.stringify(run));
  return file;
}

/** This function starts the real script of the verdict, and gives its exit status and the outputs that it writes. */
function verdict(name: string, first: string, second: string): { status: number | null; output: string; state: string; reason: string } {
  const output = join(dir, `${name}.output`);
  writeFileSync(output, "");
  const child = spawnSync(process.execPath, [MERGE, first, second], { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: "" } });
  const text = readFileSync(output, "utf8");
  const field = (key: string): string => new RegExp(`^${key}=(.*)$`, "m").exec(text)?.[1] ?? "";
  return { status: child.status, output: text, state: field("state"), reason: field("reason") };
}

/** This function starts the script of the check with a state and a reason. */
function check(state: string, reason: string): { status: number | null; text: string } {
  const child = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env: { ...process.env, STATE: state, REASON: reason } });
  return { status: child.status, text: child.stdout };
}

describe("the check reads the state of the verdict (K235, D167)", () => {
  it.each([
    ["same", 0, "Speed OK: same. the reason"],
    ["slower", 0, "Speed OK: slower, report only. the reason"],
    ["no read", 1, "::error::Speed OK: no read. the reason"],
    ["different results", 1, "::error::Speed OK: different results, a fault of determinism. the reason"],
    ["", 1, "::error::Speed OK: the job verdict wrote no state, so it crashed or it did not run."],
    ["other", 1, "::error::Speed OK: the job verdict wrote the unknown state other."],
  ])("gives for the state %j the exit status %i and the reason", (state, status, text) => {
    const read = check(state, "the reason");
    expect(read.status).toBe(status);
    expect(read.text.trim()).toBe(text);
  });
});

describe("the verdict writes its state and a reason (K235, D167)", () => {
  const whole = [benchCase("x", 1, 0), benchCase("y", 1, 0)];
  const second = [benchCase("x", 1, 12), benchCase("y", 1, 12)];

  it("writes same on two whole runs, and it exits 0", () => {
    const read = verdict("same", runFile("same-1", whole), runFile("same-2", second));
    expect(read).toMatchObject({ status: 0, state: "same" });
    expect(read.reason).toContain("0 slower");
  });

  it("writes slower on a slower case, and it exits 0, because this stays report only", () => {
    const read = verdict("slow", runFile("slow-1", [benchCase("x", 1.1, 0)]), runFile("slow-2", [benchCase("x", 1.1, 12)]));
    expect(read).toMatchObject({ status: 0, state: "slower" });
    expect(read.reason).toContain("1 slower");
    expect(read.reason).toContain("no hold");
  });

  it("writes no read on a missing run", () => {
    const missing = join(dir, "no-such-run.json");
    const read = verdict("missing", runFile("missing-1", whole), missing);
    expect(read).toMatchObject({ status: 1, state: "no read" });
    expect(read.reason).toContain(`The run file ${missing} is missing.`);
  });

  it("writes no read when both runs are missing, and names the absence of cases", () => {
    const read = verdict("both", join(dir, "none-1.json"), join(dir, "none-2.json"));
    expect(read).toMatchObject({ status: 1, state: "no read" });
    expect(read.reason).toContain("The two run files have no cases.");
  });

  it("writes no read on a short run", () => {
    const read = verdict("short", runFile("short-1", whole), runFile("short-2", [benchCase("x", 1, 12)]));
    expect(read).toMatchObject({ status: 1, state: "no read" });
    expect(read.reason).toContain("has 1 of 2 cases.");
  });

  it("writes its own state on different results, and not no read", () => {
    const read = verdict("different", runFile("different-1", [{ ...benchCase("x", 1, 0), different: "1 and 2" }]), runFile("different-2", [benchCase("x", 1, 12)]));
    expect(read).toMatchObject({ status: 1, state: "different results" });
    expect(read.reason).toContain("1 cases read different results.");
  });

  it("writes no state at all on a run file that is not JSON, so the check is red", () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "not JSON");
    const read = verdict("bad", runFile("bad-1", whole), bad);
    expect(read.status).not.toBe(0);
    expect(read.output).toBe("");
    expect(check(read.state, read.reason).status).toBe(1);
  });

  it("gives a fault before a slower case, and a reason on one line", () => {
    expect(speedState(3, 0, "a hold", ["The first\nfault.", "The second."])).toEqual({ state: "no read", reason: "The first fault. The second." });
    expect(speedState(1, 2, "a hold", []).reason).toBe("1 slower, 2 cannot decide. a hold");
    expect(speedState(3, 0, "a hold", ["A short run."], 2)).toEqual({ state: "different results", reason: "2 cases read different results. A short run." });
  });
});
