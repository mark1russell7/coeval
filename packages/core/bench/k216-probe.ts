/**
 * The probe of K216 (not for main), version 2. It times the case "the same tree, with a list of reads" in new
 * processes, as the speed bench does: one base process calibrates the calls, and each timed child runs the warmup and
 * the samples of that count. The arms are the base, the head, both without Maglev, and two changed copies of the head.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CASES } from "./cases.ts";
import { FLAGS, bundle, measureCopy } from "./paths.ts";

const [baseIndex, headIndex, out] = process.argv.slice(2);
const names = CASES.map((item) => item.name);
const reads = names.indexOf("the same tree, with a list of reads");
const dir = mkdtempSync(join(tmpdir(), "k216-"));
mkdirSync(out, { recursive: true });

/** This function copies the source of the head next to it, and replaces each text once. */
function variant(name: string, edits: readonly (readonly [string, string, string])[]): string {
  const src = dirname(resolve(headIndex));
  const copy = join(dirname(src), `src-${name}`);
  cpSync(src, copy, { recursive: true });
  for (const [file, from, to] of edits) {
    const path = join(copy, file);
    const text = readFileSync(path, "utf8");
    if (text.split(from).length !== 2) throw new Error(`${name}: the text is not in ${file} exactly once: ${from}`);
    writeFileSync(path, text.replace(from, to));
  }
  return join(copy, "index.ts");
}

const work0 = variant("work0", [
  ["evaluate.ts", "  declare work?: number;\n", "  work = 0;\n"],
  ["evaluate.ts", "(entry ? 0 : (root.work ?? 0)) + points", "(entry ? 0 : root.work) + points"],
]);
const notop = variant("notop", [["evaluate.ts", "plan.traced, undefined, outer.top ?? outer, undefined, outer.reading)", "plan.traced, undefined, undefined, undefined, outer.reading)"]]);

const files = {
  base: await bundle(resolve(baseIndex), "base", dir),
  head: await bundle(resolve(headIndex), "head", dir),
  work0: await bundle(work0, "work0", dir),
  notop: await bundle(notop, "notop", dir),
};
const arms: Record<string, { file: string; flags: readonly string[] }> = {
  base: { file: files.base, flags: [] },
  head: { file: files.head, flags: [] },
  "base-nomaglev": { file: files.base, flags: ["--no-maglev"] },
  "head-nomaglev": { file: files.head, flags: ["--no-maglev"] },
  work0: { file: files.work0, flags: [] },
  notop: { file: files.notop, flags: [] },
};
const calls = measureCopy(files.base)[reads]?.calls;
if (calls === undefined) throw new Error("The calibration gave no calls.");
console.log(`CPU: ${cpus()[0]?.model}, Node ${process.version}, case ${reads}, calls ${calls}`);

function time(arm: { file: string; flags: readonly string[] }): number {
  const child = spawnSync(process.execPath, [...FLAGS, ...arm.flags, arm.file, "child", String(reads), String(calls)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (child.status !== 0) throw new Error(`${arm.file}: status ${String(child.status)} ${child.stderr}`);
  return (JSON.parse(child.stdout) as { ms: number }).ms * 1e6;
}

const ids = Object.keys(arms);
const ns: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));
for (let round = 0; round < 16; round++) {
  const order = ids.map((_, index) => ids[(index + round) % ids.length] as string);
  for (const id of round % 2 === 0 ? order : order.reverse()) ns[id]?.push(time(arms[id] as { file: string; flags: readonly string[] }));
}
const median = (list: readonly number[]): number => [...list].sort((a, b) => a - b)[list.length >> 1] as number;
const lines = ids.map((id) => {
  const list = ns[id] as number[];
  const ref = id.includes("nomaglev") ? median(ns["base-nomaglev"] as number[]) : median(ns.base as number[]);
  return `${id.padEnd(14)} median ${median(list).toFixed(0).padStart(6)} ns, ratio ${(median(list) / ref).toFixed(3)} | ${list.map((v) => v.toFixed(0)).join(" ")}`;
});
console.log(lines.join("\n"));
writeFileSync(join(out, "probe2.json"), JSON.stringify({ cpu: cpus()[0]?.model, node: process.version, calls, ns }, null, 1));
