import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestCase, TestSpecification, Vitest } from "vitest/node";
import { GROUP_LIMIT, groupsOf, groupVerdict, ShareReporter, type Group, type Share } from "../vitest.share.ts";
import { corpus } from "./corpus.test-support.ts";

/** This function gives the share of a test with the default timeout. */
function share(name: string, ms: number): Share {
  return { name, ms, timeout: 5000, share: ms / 5000 };
}

describe("the groups of parts of the share reporter", () => {
  it("reads the parts of one split test as one test, with the total time", () => {
    const groups = groupsOf([share("a.test.ts > one test, part 1 of 2", 300), share("a.test.ts > one test, part 2 of 2", 700)]);
    expect(groups).toEqual([{ name: "a.test.ts > one test", parts: 2, ms: 1000, share: 0.2, fraction: 1 }]);
  });

  it("reads the name that the function corpus gives to a part", () => {
    const names = corpus(10, 5).parts.map((part) => "a.test.ts > one test, " + part.name);
    expect(groupsOf(names.map((name) => share(name, 100))).map((group) => [group.name, group.parts])).toEqual([["a.test.ts > one test", 2]]);
  });

  it("puts a test with no part name in no group, and counts its time in the fraction", () => {
    const groups = groupsOf([share("a.test.ts > the last test", 750), share("a.test.ts > one test, part 1 of 1", 250)]);
    expect(groups.map((group) => [group.name, group.fraction])).toEqual([["a.test.ts > one test", 0.25]]);
  });

  it("keeps the same test name in two files apart, and gives the largest share first", () => {
    const groups = groupsOf([share("a.test.ts > one test, part 1 of 1", 100), share("b.test.ts > one test, part 1 of 1", 900)]);
    expect(groups.map((group) => group.name)).toEqual(["b.test.ts > one test", "a.test.ts > one test"]);
  });

  it("gives no group for a run with no parts", () => {
    expect(groupsOf([share("a.test.ts > the last test", 100)])).toEqual([]);
  });
});

/** This function gives a group with a fraction of the test time. */
function group(fraction: number): Group {
  return { name: "a.test.ts > one test", parts: 4, ms: 1000, share: 0.2, fraction };
}

describe("the limit of a group of parts (K231, D174)", () => {
  it("passes the worst group of the 5 CI runs, and fails a group above the limit", () => {
    expect(groupVerdict([group(0.0289)], true).over).toEqual([]);
    const verdict = groupVerdict([group(0.0289), group(GROUP_LIMIT + 0.0001)], true);
    expect(verdict.over).toEqual([group(GROUP_LIMIT + 0.0001)]);
    expect(verdict.lines).toEqual([expect.stringMatching(/^::error::The parts of a\.test\.ts > one test used 0\.0360 of the test time, above 0\.0359\./)]);
  });

  it("gives no verdict for a run with a filter, because its total is not the time of all tests", () => {
    expect(groupVerdict([group(1)], false)).toEqual({ over: [], lines: [expect.stringContaining("The run has a filter")] });
  });

  // The flip test: the real reporter, with a fake run of Vitest, fails the run on a group above the limit.
  describe("the reporter", () => {
    const saved = { ci: process.env["CI"], summary: process.env["GITHUB_STEP_SUMMARY"], exitCode: process.exitCode };
    let output = "";
    beforeEach(() => {
      output = "";
      process.env["CI"] = "true";
      process.env["GITHUB_STEP_SUMMARY"] = "";
      process.exitCode = undefined;
      vi.spyOn(process.stdout, "write").mockImplementation((text) => ((output += String(text)), true));
    });
    afterEach(() => {
      vi.restoreAllMocks();
      process.exitCode = saved.exitCode;
      for (const [key, value] of [["CI", saved.ci], ["GITHUB_STEP_SUMMARY", saved.summary]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    /** This function runs the reporter over tests with these times, and gives the exit code that it sets. */
    async function run(times: readonly [string, number][], filter: { files?: boolean; names?: boolean } = {}): Promise<number | string | null | undefined> {
      const reporter = new ShareReporter();
      const specifications = [{}, {}] as unknown as TestSpecification[];
      const vitest = {
        config: { testTimeout: 5000, testNamePattern: filter.names === true ? /x/ : undefined },
        globTestSpecifications: () => Promise.resolve(filter.files === true ? [...specifications, {}] : specifications),
      };
      reporter.onInit(vitest as unknown as Vitest);
      await reporter.onTestRunStart(specifications);
      for (const [name, ms] of times) {
        reporter.onTestCaseResult({ diagnostic: () => ({ duration: ms }), options: { timeout: 100_000 }, module: { relativeModuleId: "a.test.ts" }, fullName: name } as unknown as TestCase);
      }
      reporter.onTestRunEnd();
      return process.exitCode;
    }

    // 10 000 ms of all tests: the two parts take 400 ms, a fraction of 0.04, above the limit. The timeout of 100 000 ms keeps each share far under FAIL.
    const over: [string, number][] = [["one test, part 1 of 2", 200], ["one test, part 2 of 2", 200], ["the rest", 9600]];

    it("fails a run of all tests with a group above the limit", async () => {
      expect(await run(over)).toBe(1);
      expect(output).toContain("::error::The parts of a.test.ts > one test used 0.0400 of the test time");
    });

    it("passes a run of all tests with each group under the limit", async () => {
      expect(await run([["one test, part 1 of 2", 100], ["one test, part 2 of 2", 100], ["the rest", 9800]])).toBeUndefined();
      expect(output).toContain("No group used more than 0.0359 of the test time");
    });

    it("passes a run with a filter of files or of names, with the same times", async () => {
      expect(await run(over, { files: true })).toBeUndefined();
      expect(await run(over, { names: true })).toBeUndefined();
      expect(output).toContain("The run has a filter");
    });
  });
});
