import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
function runFile(name: string, cases: readonly BenchCase[], arms: { readonly base: string; readonly head: string } = { base: "a", head: "a" }): string {
  const file = join(dir, `${name}.json`);
  const run: BenchRun = { run: name, cpu: "a CPU", node: "v26", rounds: 12, arms, cases };
  writeFileSync(file, JSON.stringify(run));
  return file;
}

/** This function writes a folder of records (K239) with one file, and gives its path. */
function acceptedDir(name: string, records: unknown): string {
  const folder = join(dir, `accepted-${name}`);
  mkdirSync(folder, { recursive: true });
  if (records !== undefined) writeFileSync(join(folder, "1.json"), typeof records === "string" ? records : JSON.stringify(records));
  return folder;
}

/** This function starts the real script of the verdict, and gives its exit status and the outputs that it writes. */
function verdict(name: string, first: string, second: string, accepted: string = acceptedDir(name, undefined)): { status: number | null; output: string; state: string; reason: string; gate: string; gateAnnotation: string; gateOutcome: string } {
  const output = join(dir, `${name}.output`);
  writeFileSync(output, "");
  const child = spawnSync(process.execPath, [MERGE, first, second], { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: "", BENCH_ACCEPTED: accepted } });
  const text = readFileSync(output, "utf8");
  const field = (key: string): string => new RegExp(`^${key}=(.*)$`, "m").exec(text)?.[1] ?? "";
  return { status: child.status, output: text, state: field("state"), reason: field("reason"), gate: field("gate"), gateAnnotation: field("gate_annotation"), gateOutcome: field("gate_outcome") };
}

/** This function starts the script of the check with a state, a reason and the gate. `text` is the first line of the output. */
function check(state: string, reason: string, gate = "", gateOutcome = "", annotation = ""): { status: number | null; text: string; lines: string[] } {
  const env = { ...process.env, STATE: state, REASON: reason, GATE: gate, GATE_OUTCOME: gateOutcome, GATE_ANNOTATION: annotation, GITHUB_STEP_SUMMARY: "" };
  const child = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env });
  const lines = child.stdout.trim().split("\n");
  return { status: child.status, text: lines[0] ?? "", lines };
}

describe("the check shows the line of the report-only gate (K225, D181, K242)", () => {
  const LINE = "Speed gate (D163): no read for 1 of 2 cases: x. jobs on 1 CPU model: A (2 jobs). A no read is not a pass.";
  const WARNING = `::warning title=Speed gate (D163)%3A no read (report only)%2C 1 no read::${LINE}`;

  it("prints the line of a pass with no warning", () => {
    const read = check("same", "the reason", "Speed gate (D163): pass for 2 of 2 cases. Jobs on 1 CPU model: A (2 jobs).", "pass");
    expect(read.status).toBe(0);
    expect(read.lines).toEqual(["Speed OK: same. the reason", "Speed gate (D163): pass for 2 of 2 cases. Jobs on 1 CPU model: A (2 jobs)."]);
  });

  it("prints the warning of the job verdict on a gate no read, and the check stays green while the gate is report only", () => {
    const read = check("same", "the reason", LINE, "no read", WARNING);
    expect(read.status).toBe(0);
    expect(read.lines).toEqual(["Speed OK: same. the reason", LINE, WARNING]);
  });

  it("gives the fixed warning on a missing line, and on a block or a no read with no warning", () => {
    const missing = ["Speed gate (D163): no read. The job verdict wrote no line of the gate.", "::warning title=Speed gate (D163)%3A no read (report only)::The job verdict wrote no line of the gate. A no read is not a pass."];
    expect(check("same", "r").lines.slice(1)).toEqual(missing);
    expect(check("same", "r", "", "pass").lines.slice(1)).toEqual(missing);
    expect(check("same", "r", LINE, "block").lines.slice(1)).toEqual(missing);
  });
});

describe("the check reads the state of the verdict (K235, D167)", () => {
  it.each([
    ["same", 0, "Speed OK: same. the reason"],
    ["slower", 0, "Speed OK: slower, report only. the reason"],
    ["accepted", 0, "Speed OK: slower, accepted by a record. the reason"],
    ["held", 1, "::error::Speed OK: held. A slower case on different arms has no record in bench/accepted. the reason"],
    ["no read", 1, "::error::Speed OK: no read. the reason"],
    ["different results", 1, "::error::Speed OK: different results. the reason"],
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

  // Each test starts the script one time, because a start takes approximately 1.5 s and the test time has a budget (CI 42460573497).
  it("writes the line of a gate pass with the CPU models (K225, D181, K242)", () => {
    const pass = verdict("gate-pass", runFile("gate-pass-1", whole), runFile("gate-pass-2", second));
    expect(pass).toMatchObject({ gateOutcome: "pass", gateAnnotation: "" });
    expect(pass.gate).toBe("Speed gate (D163): pass for 2 of 2 cases. Jobs on 1 CPU model: a CPU (2 jobs).");
  });

  it("writes the line and the warning of gateLine of rigor-bench for a gate no read (K225, D181, K242)", () => {
    const split = verdict("gate-split", runFile("gate-split-1", [benchCase("x", 1.1, 0), benchCase("y", 1, 0)]), runFile("gate-split-2", second));
    const line = "Speed gate (D163): no read for 1 of 2 cases: x. jobs on 1 CPU model: a CPU (2 jobs). A no read is not a pass.";
    expect(split).toMatchObject({ gateOutcome: "no read", gate: line, gateAnnotation: `::warning title=Speed gate (D163)%3A no read (report only)%2C 1 no read::${line}` });
    expect(split.state).not.toBe("no read");
    // The check prints the line and the warning that the verdict wrote.
    expect(check("same", "r", split.gate, split.gateOutcome, split.gateAnnotation).lines.slice(1)).toEqual([line, split.gateAnnotation]);
  });

  it("writes slower on a slower case, and it exits 0, because this stays report only", () => {
    const read = verdict("slow", runFile("slow-1", [benchCase("x", 1.1, 0)]), runFile("slow-2", [benchCase("x", 1.1, 12)]));
    expect(read).toMatchObject({ status: 0, state: "slower" });
    expect(read.reason).toContain("1 slower");
    expect(read.reason).toContain("no hold");
  });

  // The three cases of a hold (K239, D173): no hold, a hold with a record, and a hold with no record.
  const HEAD = "abcdef0123456789abcdef0123456789";
  const differ = { base: "0123456789abcdef0123456789abcdef", head: HEAD };
  const slowRuns = (name: string): [string, string] => [runFile(`${name}-1`, [benchCase("x", 1.1, 0)], differ), runFile(`${name}-2`, [benchCase("x", 1.1, 12)], differ)];
  const record = { case: "x", head: HEAD.slice(0, 12), cost: "+10 %", reason: "a test of K239", owner: "coeval" };

  it("writes held on a slower case on different arms with no record, and the check is red", () => {
    const read = verdict("held", ...slowRuns("held"));
    expect(read).toMatchObject({ status: 0, state: "held" });
    expect(read.reason).toContain("Hold (D117): hold. 1 slower, and the arms differ.");
    expect(read.reason).toContain("Not accepted (K239): x has no record in bench/accepted for the head abcdef012345.");
    expect(check(read.state, read.reason).status).toBe(1);
  });

  it("writes accepted on a hold when a record names the case and the head, and the check names the record", () => {
    const read = verdict("accepted", ...slowRuns("accepted"), acceptedDir("accepted", [record]));
    expect(read).toMatchObject({ status: 0, state: "accepted" });
    expect(read.reason).toContain("Accepted (K239): x, +10 %, by coeval: a test of K239 (accepted/1.json).");
    const answer = check(read.state, read.reason);
    expect(answer.status).toBe(0);
    expect(answer.text).toContain("accepted/1.json");
  });

  it("writes held when the record has the hash of another head, so a record on main accepts no later change", () => {
    const read = verdict("other-head", ...slowRuns("other-head"), acceptedDir("other-head", [{ ...record, head: "ffffffffffff" }]));
    expect(read.state).toBe("held");
  });

  it("writes held when the record names another case", () => {
    const read = verdict("other-case", ...slowRuns("other-case"), acceptedDir("other-case", [{ ...record, case: "y" }]));
    expect(read.state).toBe("held");
  });

  it("writes no read when a record has an empty field", () => {
    const read = verdict("empty", ...slowRuns("empty"), acceptedDir("empty", [{ ...record, owner: " " }]));
    expect(read).toMatchObject({ status: 1, state: "no read" });
    expect(read.reason).toContain("The record 1 of accepted/1.json has no owner (K239).");
  });

  it("keeps a slower case on equal arms report only, with no record (D166)", () => {
    const same = { base: HEAD, head: HEAD };
    const read = verdict("equal", runFile("equal-1", [benchCase("x", 1.1, 0)], same), runFile("equal-2", [benchCase("x", 1.1, 12)], same));
    expect(read.state).toBe("slower");
    expect(check(read.state, read.reason).status).toBe(0);
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
    expect(read.reason).toBe("1 cases read different results. The arms are equal, so this is a fault of determinism.");
  });

  it("names a changed result as a cause on different arms, as K236 read", () => {
    const arms = { base: "a", head: "b" };
    const read = verdict("changed", runFile("changed-1", [{ ...benchCase("x", 1, 0), different: "1 and 2" }], arms), runFile("changed-2", [benchCase("x", 1, 12)], arms));
    expect(read).toMatchObject({ status: 1, state: "different results" });
    expect(read.reason).toBe("1 cases read different results. The arms differ or have no hashes, so a changed result can explain this.");
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
    expect(speedState(0, 1, "a hold", [], 0, false, undefined, "Mixed CPU pair (D183): a + b. 1 no read: x.")).toEqual({ state: "same", reason: "0 slower, 1 cannot decide. Mixed CPU pair (D183): a + b. 1 no read: x." });
    expect(speedState(3, 0, "a hold", ["A short run."], 2)).toEqual({ state: "different results", reason: "2 cases read different results. The arms differ or have no hashes, so a changed result can explain this. A short run." });
  });
});
