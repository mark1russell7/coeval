/**
 * This script gives the answer of the check `Speed OK` from the state that the job `verdict` writes (K235, D167).
 * An empty state or an unknown state is red, so a crash cannot pass by writing nothing.
 * A slower case under a hold (D117) is red, unless a record of `bench/accepted` accepts it (K239, D173). A slower case on
 * equal arms stays report only (D166), so a green result does not say "not slower".
 * The script also shows the line of the report-only gate (K225, D181). A gate outcome other than "pass" gives a warning
 * on the pull request, and the check stays green. Thus the check does not show a "no read" of the gate as a pass.
 * The script imports no package, because this job installs no packages.
 */

import { appendFileSync } from "node:fs";

/** The answer of the check for one state of the job `verdict`. */
export interface SpeedAnswer {
  readonly status: 0 | 1;
  readonly line: string;
}

/** This function gives the exit status of the check and the line that it prints. */
export function speedAnswer(state: string, reason: string): SpeedAnswer {
  if (state === "same") return { status: 0, line: `Speed OK: same. ${reason}` };
  if (state === "slower") return { status: 0, line: `Speed OK: slower, report only. ${reason}` };
  if (state === "accepted") return { status: 0, line: `Speed OK: slower, accepted by a record. ${reason}` };
  if (state === "held") return { status: 1, line: `::error::Speed OK: held. A slower case on different arms has no record in bench/accepted. ${reason}` };
  if (state === "no read") return { status: 1, line: `::error::Speed OK: no read. ${reason}` };
  if (state === "different results") return { status: 1, line: `::error::Speed OK: different results. ${reason}` };
  if (state === "") return { status: 1, line: "::error::Speed OK: the job verdict wrote no state, so it crashed or it did not run." };
  return { status: 1, line: `::error::Speed OK: the job verdict wrote the unknown state ${state}.` };
}

/**
 * This function gives the lines that show the report-only gate (K225, D181). The lines are the gate line, and a warning
 * annotation of GitHub when the outcome is not "pass". An empty line says that the gate gave no read.
 */
export function gateAnswer(outcome: string, line: string): string[] {
  const text = line === "" ? "Gate (report only, D163): no read. The job verdict wrote no line of the gate." : line;
  if (outcome === "pass" && line !== "") return [text];
  const escaped = text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return [text, `::warning title=Speed gate (report only)::${escaped}`];
}

const answer = speedAnswer(process.env["STATE"] ?? "", process.env["REASON"] ?? "");
const gate = gateAnswer(process.env["GATE_OUTCOME"] ?? "", process.env["GATE"] ?? "");
console.log([answer.line, ...gate].join("\n"));
const summary = process.env["GITHUB_STEP_SUMMARY"];
if (summary !== undefined && summary !== "") {
  appendFileSync(summary, `${answer.line.replace(/^::error::/, "")}\n\n${gate[0] ?? ""}\n`);
}
process.exitCode = answer.status;
