import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CASES } from "./cases.ts";
import { deriveLimits, familyOf, FAMILIES, limitsOf, limitsRecord, MARGIN_FLOOR, MINIMUM_JOBS, type Family, type LimitsRecord } from "./limits.ts";
import { caseVerdict, pooledCase, VERDICT, type BenchCase } from "./merge.ts";
import { fromFixture, REPLAY_CASE, REPLAY_FILE, REPLAY_RUN, SAME_CODE_RUNS, type ReplayFixture } from "./refresh.ts";

const record = limitsRecord();
const fixture = JSON.parse(readFileSync(REPLAY_FILE, "utf8")) as ReplayFixture;

/** This function gives the case of one job of the fixture, as a record of `paths.ts` keeps it. */
function benchCase(job: ReplayFixture["jobs"][number]): BenchCase {
  return { name: fixture.case, baseNs: 0, headNs: 0, change: 0, noise: 0, head: fromFixture(fixture.case, job.job, job.head), aa: fromFixture(fixture.case, job.job, job.aa) };
}

describe("the limits of each family come from the A/A records of CI (K214, D117)", () => {
  it("gives each case of cases.ts a family", () => {
    expect(CASES.map((item) => [item.name, familyOf(item.name)]).filter(([, family]) => family === undefined)).toEqual([]);
  });

  it("keeps the A/A statistics of each case in 5 or more jobs", () => {
    const jobs = record.runs.reduce((count, run) => count + run.jobs.length, 0);
    expect(jobs).toBeGreaterThanOrEqual(MINIMUM_JOBS);
    for (const list of Object.values(record.stats)) expect(list).toHaveLength(jobs);
  });

  it("keeps the limits that the formula gives from the statistics", () => {
    expect(deriveLimits(record)).toEqual({ limits: record.limits, fallback: record.fallback });
  });

  it("gives each family its own limits, and a margin of 1.5 % or more", () => {
    for (const family of Object.keys(FAMILIES) as Family[]) {
      expect(record.limits[family].source).toBe("family");
      expect(record.limits[family].margin).toBeGreaterThanOrEqual(MARGIN_FLOOR);
    }
  });

  it("gives a case without a family the fallback limits, with a label", () => {
    const limits = limitsOf("a new case");
    expect(limits).toMatchObject({ family: undefined, fallback: true });
    expect(limits.options).toEqual({ margin: record.fallback.margin, noiseCap: record.fallback.noiseCap });
  });

  it("gives a family with too few jobs the fallback limits", () => {
    const short: LimitsRecord = { ...record, stats: { ...record.stats, [FAMILIES.tree[0]]: [[0, 0.01]], [FAMILIES.tree[1]]: [[0, 0.01]], [FAMILIES.tree[2]]: [[0, 0.01]] } };
    expect(deriveLimits(short).limits.tree.source).toBe("fallback");
    expect(() => deriveLimits({ runs: [], stats: { x: [[0, 0.01]] } })).toThrow(RangeError);
  });
});

describe(`the replay of the run ${String(REPLAY_RUN)} (K214, D117)`, () => {
  const own = fixture.jobs;

  it("holds the two jobs of the run, a run of the same code", () => {
    expect([fixture.run, fixture.case]).toEqual([REPLAY_RUN, REPLAY_CASE]);
    expect(SAME_CODE_RUNS).toContain(REPLAY_RUN);
    expect(own.map((job) => job.job)).toEqual(["1", "2"]);
  });

  it(`gives "${REPLAY_CASE}" the false verdict "slower" with the margin of D114`, () => {
    expect(pooledCase(own.map((job) => ({ run: job.job, item: benchCase(job) })), VERDICT)?.outcome).toBe("slower");
  });

  it(`gives "${REPLAY_CASE}" the verdict "same" or "cannot decide" with the limits of its family`, () => {
    expect(["same", "cannot decide"]).toContain(pooledCase(own.map((job) => ({ run: job.job, item: benchCase(job) })))?.outcome);
  });

  it("gives no arm of a job the verdict slower or faster: the head against the A/A pair, and the A/A pair against the head", () => {
    const options = limitsOf(fixture.case).options;
    const outcomes = own.flatMap((job) => {
      const item = benchCase(job);
      return [caseVerdict(item.head ?? [], item.aa ?? [], options).outcome, caseVerdict(item.aa ?? [], item.head ?? [], options).outcome];
    });
    expect(outcomes).toHaveLength(4);
    expect(outcomes.filter((outcome) => outcome === "slower" || outcome === "faster")).toEqual([]);
  });
});
