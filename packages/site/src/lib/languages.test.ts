import { describe, expect, it } from "vitest";
import { LANGUAGES, PROBES, entryAt, evaluateWith, mergeLanguages, mergeRows, pathKey, restrictLanguages } from "./languages.ts";

const byId = (...ids: string[]) => ids.map((id) => LANGUAGES.find((language) => language.id === id)!);
const probe = (id: string) => PROBES.find((item) => item.id === id)!.doc;

describe("the languages of the composition page", () => {
  it("merges two extensions that do not know each other, and their shared kind gives one entry", () => {
    const outcome = mergeLanguages(byId("stats", "text"), {});
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(evaluateWith(outcome.machine, probe("avg"))).toEqual({ ok: true, value: 4 });
    expect(evaluateWith(outcome.machine, probe("twice"))).toEqual({ ok: true, value: 4 });
    expect(evaluateWith(outcome.machine, probe("join"))).toEqual({ ok: true, value: "AB=3" });
  });

  it("lists each conflict of the rival, and its paths in replaces resolve them", () => {
    const failed = mergeLanguages(byId("stats", "rival"), {});
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    const keys = failed.error.conflicts.map((item) => pathKey(item.path));
    expect(keys).toEqual([pathKey(["world", "kinds", "mean"]), pathKey(["world", "kinds", "ops", "kinds", "twice"]), pathKey(["evaluators", "stats.twice"])]);
    const resolved = mergeLanguages(byId("stats", "rival"), { rival: keys });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(evaluateWith(resolved.machine, probe("avg"))).toEqual({ ok: true, value: 5 });
    expect(evaluateWith(resolved.machine, probe("twice"))).toEqual({ ok: true, value: 6 });
  });

  it("removes a kind with restrictMachine, also for its alias", () => {
    const outcome = mergeLanguages(byId("stats"), {});
    if (!outcome.ok) throw outcome.error;
    const smaller = restrictLanguages(outcome.machine, [pathKey(["world", "kinds", "mean"])]);
    expect(entryAt(smaller, ["world", "kinds", "mean"])).toBeUndefined();
    expect(evaluateWith(smaller, probe("avg"))).toMatchObject({ ok: false, error: { code: "#KIND?" } });
  });

  it("gives the rows of a namespace after the namespace, also for a key of a later language", () => {
    const labels = mergeRows(byId("stats", "text")).map((row) => row.label.join("/"));
    expect(labels.indexOf("ops/kinds/join")).toBe(labels.indexOf("ops/kinds/twice") + 1);
    expect(labels.indexOf("ops")).toBe(labels.indexOf("ops/kinds/twice") - 1);
  });
});
