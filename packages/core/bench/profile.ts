/*
 * The CPU profile of one case in each arm (K216).
 *
 *   pnpm exec tsx packages/core/bench/profile.ts <base index.ts> <head index.ts> <case name> <out dir>
 *
 * The script bundles the two arms as `paths.ts` does, and runs the case in new processes of each arm, in turn. Each
 * process writes a CPU profile of V8. The script prints the time of each process and the self time of each function
 * for each arm. A slowdown that only some computers show can thus be read on those computers.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { median } from "@mark1russell7/rigor-statistics";
import { bundle, FLAGS, measureCopy } from "./paths.ts";

interface ProfileNode {
  readonly id: number;
  readonly callFrame: { readonly functionName: string; readonly lineNumber: number; readonly url: string };
}

interface Profile {
  readonly nodes: readonly ProfileNode[];
  readonly samples: readonly number[];
}

const ROUNDS = Number(process.env["PROFILE_ROUNDS"] ?? 6);

/**
 * This function adds the samples of each function in a profile, by the name of the function. The lines of a function differ
 * between the bundles of the arms, thus each line goes in a set of its own.
 */
function selfSamples(profile: Profile, into: Map<string, number>, lines: Map<string, Set<number>>): number {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  for (const id of profile.samples) {
    const frame = byId.get(id)?.callFrame;
    const key = frame === undefined || frame.functionName === "" ? "(anonymous)" : frame.functionName;
    into.set(key, (into.get(key) ?? 0) + 1);
    if (frame !== undefined) lines.set(key, (lines.get(key) ?? new Set<number>()).add(frame.lineNumber + 1));
  }
  return profile.samples.length;
}

async function main(): Promise<void> {
  const [baseFile, headFile, caseName, out] = process.argv.slice(2);
  if (baseFile === undefined || headFile === undefined || caseName === undefined || out === undefined) throw new Error("Give the index.ts of the base and of the head, the name of a case and a folder.");
  const dir = mkdtempSync(join(tmpdir(), "coeval-profile-"));
  const copies = { base: await bundle(baseFile, "base", dir), head: await bundle(headFile, "head", dir) };
  const first = measureCopy(copies.base);
  const index = first.findIndex((item) => item.name === caseName);
  if (index < 0) throw new Error(`The bench has no case "${caseName}".`);
  const calls = String((first[index] as { calls: number }).calls);
  const times: Record<string, number[]> = { base: [], head: [] };
  const self: Record<string, Map<string, number>> = { base: new Map(), head: new Map() };
  const totals: Record<string, number> = { base: 0, head: 0 };
  const lines: Record<string, Map<string, Set<number>>> = { base: new Map(), head: new Map() };
  for (let round = 0; round < ROUNDS; round += 1) {
    // The first arm changes in each round, as in the fresh runner.
    const order = round % 2 === 0 ? (["base", "head"] as const) : (["head", "base"] as const);
    for (const name of order) {
      const target = join(out, `${name}-${String(round)}`);
      mkdirSync(target, { recursive: true });
      const child = spawnSync(process.execPath, [...FLAGS, "--cpu-prof", `--cpu-prof-dir=${target}`, copies[name], "child", String(index), calls], { encoding: "utf8" });
      if (child.status !== 0) throw new Error(`The process of ${name} stopped with the status ${String(child.status)}: ${child.stderr}`);
      (times[name] as number[]).push((JSON.parse(child.stdout) as { ms: number }).ms * 1e6);
      for (const file of readdirSync(target).filter((item) => item.endsWith(".cpuprofile"))) {
        totals[name] = (totals[name] ?? 0) + selfSamples(JSON.parse(readFileSync(join(target, file), "utf8")) as Profile, self[name] as Map<string, number>, lines[name] as Map<string, Set<number>>);
      }
    }
  }
  console.log(`Case "${caseName}" (index ${String(index)}), ${calls} calls in each sample, ${String(ROUNDS)} rounds, Node ${process.version}.`);
  for (const name of ["base", "head"]) {
    const list = times[name] as number[];
    console.log(`${name}: median ${median(list).toFixed(1)} ns, each process ${list.map((value) => value.toFixed(0)).join(" ")} ns`);
  }
  const keys = new Set([...(self["base"] as Map<string, number>).keys(), ...(self["head"] as Map<string, number>).keys()]);
  const share = (name: string, key: string): number => (100 * ((self[name] as Map<string, number>).get(key) ?? 0)) / (totals[name] || 1);
  const rows = [...keys].map((key) => ({ key, base: share("base", key), head: share("head", key) })).sort((a, b) => Math.max(b.base, b.head) - Math.max(a.base, a.head));
  const lineText = (name: string, key: string): string => [...((lines[name] as Map<string, Set<number>>).get(key) ?? [])].sort((a, b) => a - b).slice(0, 4).join(" ");
  console.log("| Function | Base (% of samples) | Head (% of samples) | Lines (base) | Lines (head) |");
  console.log("| --- | ---: | ---: | --- | --- |");
  for (const row of rows.slice(0, 30)) console.log(`| ${row.key} | ${row.base.toFixed(1)} | ${row.head.toFixed(1)} | ${lineText("base", row.key)} | ${lineText("head", row.key)} |`);
}

await main();
