import { appendFileSync } from "node:fs";
import type { Reporter, TestCase, Vitest } from "vitest/node";

/*
 * The share of the timeout (K207, D96). For each test, the share is its duration divided by its timeout: the timeout of
 * the test, else the default of the config. The timeout is a detector of a hang, not a gate of speed. A share near 1
 * tells that a slow runner can fail a correct test. Thus CI warns above `WARN` and fails above `FAIL`. A local run gets
 * no output. The claims of speed belong to the bench.
 *
 * A split lowers the share of each part and saves no time. Thus the reporter also prints each group of parts as one
 * test (K231, D165). The groups are a report and they do not fail a run.
 */

/** The share above which CI prints a warning. */
export const WARN = 0.4;
/** The share above which CI fails the run. */
export const FAIL = 0.6;
/** The number of tests in the table of the step summary. */
const ROWS = 5;

/** The end of the name of a part of a split test. The function `corpus` gives this name. */
const PART = /, part \d+ of \d+$/;

/** The share of one test. */
export interface Share {
  readonly name: string;
  readonly ms: number;
  readonly timeout: number;
  readonly share: number;
}

/** The parts of one split test, read as one test. */
export interface Group {
  /** The name of the test, without the name of the part. */
  readonly name: string;
  /** The number of parts that finished. */
  readonly parts: number;
  /** The total time of the parts, in milliseconds. */
  readonly ms: number;
  /** The total time, divided by the timeout of one part. */
  readonly share: number;
  /** The total time, divided by the time of all tests of the run. The speed of the runner has less effect on this value. */
  readonly fraction: number;
}

/**
 * This function reads the parts of each split test as one test.
 *
 * @param shares - The shares of all tests of a run.
 * @returns The groups, with the largest share first. A test with no part name is in no group.
 */
export function groupsOf(shares: readonly Share[]): readonly Group[] {
  const total = shares.reduce((sum, item) => sum + item.ms, 0);
  const groups = new Map<string, { parts: number; ms: number; timeout: number }>();
  for (const item of shares) {
    if (!PART.test(item.name)) continue;
    const name = item.name.replace(PART, "");
    const group = groups.get(name) ?? { parts: 0, ms: 0, timeout: item.timeout };
    groups.set(name, { parts: group.parts + 1, ms: group.ms + item.ms, timeout: group.timeout });
  }
  return [...groups]
    .map(([name, group]) => ({ name, parts: group.parts, ms: group.ms, share: group.ms / group.timeout, fraction: group.ms / total }))
    .sort((a, b) => b.share - a.share);
}

/** This function makes a name of a test fit in one cell of a Markdown table. */
function cell(text: string): string {
  return text.replaceAll("|", "/").replaceAll("\n", " ");
}

/** This reporter computes the share of the timeout of each test, and examines the slowest share in CI. */
export class ShareReporter implements Reporter {
  private timeout = 5000;
  private readonly shares: Share[] = [];

  /** This function reads the default timeout of the config. */
  onInit(vitest: Vitest): void {
    this.timeout = vitest.config.testTimeout ?? 5000;
  }

  /** This function records the share of a test that finished. */
  onTestCaseResult(test: TestCase): void {
    const ms = test.diagnostic()?.duration;
    if (ms === undefined) return;
    const timeout = test.options.timeout ?? this.timeout;
    this.shares.push({ name: `${test.module.relativeModuleId} > ${test.fullName}`, ms, timeout, share: ms / timeout });
  }

  /** This function prints the slowest shares in CI, and fails the run when the slowest share is above `FAIL`. */
  onTestRunEnd(): void {
    if (process.env["CI"] === undefined || process.env["CI"] === "" || this.shares.length === 0) return;
    const slowest = [...this.shares].sort((a, b) => b.share - a.share).slice(0, ROWS);
    const top = slowest[0] as Share;
    const line = (item: Share): string => `${item.share.toFixed(3)} (${Math.round(item.ms)} ms of ${item.timeout} ms) ${item.name}`;
    process.stdout.write(`\nThe share of the timeout, the ${slowest.length} slowest tests:\n${slowest.map((item) => `  ${line(item)}`).join("\n")}\n`);
    const summary = process.env["GITHUB_STEP_SUMMARY"];
    if (summary !== undefined && summary !== "") {
      const rows = slowest.map((item) => `| ${cell(item.name)} | ${Math.round(item.ms)} | ${item.timeout} | ${item.share.toFixed(3)} |`);
      appendFileSync(summary, `\n### The share of the timeout (core)\n\n| Test | ms | Timeout (ms) | Share |\n|---|---:|---:|---:|\n${rows.join("\n")}\n`);
    }
    const groups = groupsOf(this.shares);
    const group = (item: Group): string => `${item.share.toFixed(3)} (${Math.round(item.ms)} ms in ${item.parts} parts, ${item.fraction.toFixed(4)} of the test time) ${item.name}`;
    process.stdout.write(`\nThe groups of parts, read as one test (report only, K231):\n${groups.map((item) => `  ${group(item)}`).join("\n")}\n\n`);
    if (top.share > FAIL) {
      process.stdout.write(`::error::The test ${top.name} used ${top.share.toFixed(3)} of its timeout, above ${FAIL}. Split it into parts (D96).\n`);
      process.exitCode = 1;
    } else if (top.share > WARN) {
      process.stdout.write(`::warning::The test ${top.name} used ${top.share.toFixed(3)} of its timeout, above ${WARN}.\n`);
    }
  }
}
