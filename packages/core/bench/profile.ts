/*
 * The CPU profile of one case in each arm (K216).
 *
 *   pnpm exec tsx packages/core/bench/profile.ts <base index.ts> <head index.ts> <case name> <out dir>
 *
 * The script bundles the two arms as `paths.ts` does, and runs the case in new processes of each arm, in turn. Each
 * process writes a CPU profile of V8. The script prints the time of each process and the self time of each function
 * for each arm. A slowdown that only some computers show can thus be read on those computers.
 *
 * `PROFILE_ROUNDS` sets the rounds (6), `PROFILE_SCALE` multiplies the calls of the bench (10), and `PROFILE_INTERVAL` sets
 * the interval of the samples in microseconds (50).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { median } from "@mark1russell7/rigor-statistics";
import { bundle, FLAGS, measureCopy } from "./paths.ts";

interface ProfileNode {
  readonly id: number;
  readonly callFrame: { readonly functionName: string; readonly lineNumber: number; readonly url: string };
  readonly children?: readonly number[];
}

interface Profile {
  readonly nodes: readonly ProfileNode[];
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
}

const ROUNDS = Number(process.env["PROFILE_ROUNDS"] ?? 6);
/** The calls of each sample are this many times the calls of the bench, thus the timed window fills most of the process. */
const SCALE = Number(process.env["PROFILE_SCALE"] ?? 10);
/** The interval of the samples of V8, in microseconds. The default of V8 is 1000. */
const INTERVAL = Number(process.env["PROFILE_INTERVAL"] ?? 50);

/**
 * This function adds the self time of each function in a profile, in microseconds, by the name of the function. An anonymous
 * function gets the name of its caller, because many functions have no name. The lines of a function differ between the
 * bundles of the arms, thus each line goes in a set of its own.
 */
function selfSamples(profile: Profile, into: Map<string, number>, lines: Map<string, Set<number>>): number {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map<number, number>();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const nameOf = (id: number): string => {
    const frame = byId.get(id)?.callFrame;
    if (frame === undefined) return "(unknown)";
    if (frame.functionName !== "") return frame.functionName;
    const up = parent.get(id);
    const caller = up === undefined ? undefined : byId.get(up)?.callFrame.functionName;
    return `(anonymous in ${caller === undefined || caller === "" ? "?" : caller})`;
  };
  let total = 0;
  profile.samples.forEach((id, at) => {
    const micros = profile.timeDeltas[at] ?? 0;
    const key = nameOf(id);
    total += micros;
    into.set(key, (into.get(key) ?? 0) + micros);
    const frame = byId.get(id)?.callFrame;
    if (frame !== undefined) lines.set(key, (lines.get(key) ?? new Set<number>()).add(frame.lineNumber + 1));
  });
  return total;
}

async function main(): Promise<void> {
  const [baseFile, headFile, caseName, out] = process.argv.slice(2);
  if (baseFile === undefined || headFile === undefined || caseName === undefined || out === undefined) throw new Error("Give the index.ts of the base and of the head, the name of a case and a folder.");
  const dir = mkdtempSync(join(tmpdir(), "coeval-profile-"));
  const copies = { base: await bundle(baseFile, "base", dir), head: await bundle(headFile, "head", dir) };
  const first = measureCopy(copies.base);
  const index = first.findIndex((item) => item.name === caseName);
  if (index < 0) throw new Error(`The bench has no case "${caseName}".`);
  const calls = String(SCALE * (first[index] as { calls: number }).calls);
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
      const child = spawnSync(process.execPath, [...FLAGS, "--cpu-prof", `--cpu-prof-interval=${String(INTERVAL)}`, `--cpu-prof-dir=${target}`, copies[name], "child", String(index), calls], { encoding: "utf8" });
      if (child.status !== 0) throw new Error(`The process of ${name} stopped with the status ${String(child.status)}: ${child.stderr}`);
      (times[name] as number[]).push((JSON.parse(child.stdout) as { ms: number }).ms * 1e6);
      for (const file of readdirSync(target).filter((item) => item.endsWith(".cpuprofile"))) {
        totals[name] = (totals[name] ?? 0) + selfSamples(JSON.parse(readFileSync(join(target, file), "utf8")) as Profile, self[name] as Map<string, number>, lines[name] as Map<string, Set<number>>);
      }
    }
  }
  console.log(`Case "${caseName}" (index ${String(index)}), ${calls} calls in each sample, ${String(ROUNDS)} rounds, an interval of ${String(INTERVAL)} µs, Node ${process.version}, ${cpus()[0]?.model ?? "an unknown CPU"}.`);
  for (const name of ["base", "head"]) {
    const list = times[name] as number[];
    console.log(`${name}: median ${median(list).toFixed(1)} ns, each process ${list.map((value) => value.toFixed(0)).join(" ")} ns`);
  }
  const keys = new Set([...(self["base"] as Map<string, number>).keys(), ...(self["head"] as Map<string, number>).keys()]);
  // The self time of a function in one process of an arm, in milliseconds.
  const ms = (name: string, key: string): number => ((self[name] as Map<string, number>).get(key) ?? 0) / 1000 / ROUNDS;
  const gap = ((totals["head"] ?? 0) - (totals["base"] ?? 0)) / 1000 / ROUNDS;
  console.log(`Profiled time of one process: base ${((totals["base"] ?? 0) / 1000 / ROUNDS).toFixed(2)} ms, head ${((totals["head"] ?? 0) / 1000 / ROUNDS).toFixed(2)} ms, gap ${gap.toFixed(2)} ms.`);
  const rows = [...keys].map((key) => ({ key, base: ms("base", key), head: ms("head", key) })).sort((a, b) => b.head - b.base - (a.head - a.base));
  const lineText = (name: string, key: string): string => [...((lines[name] as Map<string, Set<number>>).get(key) ?? [])].sort((a, b) => a - b).slice(0, 4).join(" ");
  console.log("| Function | Base (ms) | Head (ms) | Head minus base (% of the gap) | Lines (base) | Lines (head) |");
  console.log("| --- | ---: | ---: | ---: | --- | --- |");
  const line = (row: { key: string; base: number; head: number }): string =>
    `| ${row.key} | ${row.base.toFixed(2)} | ${row.head.toFixed(2)} | ${(gap === 0 ? 0 : (100 * (row.head - row.base)) / gap).toFixed(0)} | ${lineText("base", row.key)} | ${lineText("head", row.key)} |`;
  for (const row of rows.slice(0, 20)) console.log(line(row));
  console.log("| ... | | | | | |");
  for (const row of rows.slice(-5)) console.log(line(row));
}

await main();
