/**
 * The probe of K216 (not for main), version 3. It times the case "the same tree, with a list of reads" in new
 * processes, as the speed bench does: one base process calibrates the calls, and each timed child runs the warmup and
 * the samples of that count. The arms are the base, the head, and five copies of the head that each undo one change of K216.
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

const NODE_SPEND = "  if (runtime?.nested === true) runtime.spend?.(NODE_WORK);\n";
const FN_SPEND = "          rt.spend?.(1);\n";
const ENDING = ["evaluate.ts", "c.keeps === true ? endingCode(root.code) : root.code", "root.code"] as const;
const JSON_SPEND = [
  ["stdlib.ts", "    if (open === false) runtime?.spend?.(1);\n    return state.json(path);", "    return state.json(path);"],
  ["stdlib.ts", "  if (open === false) runtime?.spend?.(1);\n  path.set(value, true);", "  path.set(value, true);"],
] as const;
const ALL_VALUES = [
  "stdlib.ts",
  "  if (first === undefined) return { values: results.map((result) => (result.ok ? result.value : null)) };\n  if (errors.length === 1) return { error: first };\n  // WORK.LIMIT: after the limit each counted part fails, and the code of the limit stays the code of the result.\n  const stopped = errors.find((result) => !result.ok && result.error.code === \"#WORK!\");\n  return { error: stopped ?? fail(\"#ARGS\", `${errors.length} parts failed.`) };\n",
  "  if (first !== undefined && errors.length === 1) return { error: first };\n  if (errors.length > 1) return { error: fail(\"#ARGS\", `${errors.length} parts failed.`) };\n  return { values: results.map((result) => (result.ok ? result.value : null)) };\n",
] as const;
const VARIANTS: Record<string, readonly (readonly [string, string, string])[]> = {
  nonodespend: [["stdlib.ts", NODE_SPEND, ""]],
  nofnspend: [["formula.ts", FN_SPEND, ""]],
  noending: [ENDING],
  nojsonspend: JSON_SPEND,
  oldallvalues: [ALL_VALUES],
  allfive: [["stdlib.ts", NODE_SPEND, ""], ["formula.ts", FN_SPEND, ""], ENDING, ...JSON_SPEND, ALL_VALUES],
};

const files: Record<string, string> = {
  base: await bundle(resolve(baseIndex), "base", dir),
  head: await bundle(resolve(headIndex), "head", dir),
};
for (const [name, edits] of Object.entries(VARIANTS)) files[name] = await bundle(variant(name, edits), name, dir);
const arms: Record<string, { file: string; flags: readonly string[] }> = Object.fromEntries(Object.entries(files).map(([id, file]) => [id, { file, flags: [] }]));
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
  const ref = median(ns.base as number[]);
  return `${id.padEnd(14)} median ${median(list).toFixed(0).padStart(6)} ns, ratio ${(median(list) / ref).toFixed(3)} | ${list.map((v) => v.toFixed(0)).join(" ")}`;
});
console.log(lines.join("\n"));
writeFileSync(join(out, "probe2.json"), JSON.stringify({ cpu: cpus()[0]?.model, node: process.version, calls, ns }, null, 1));

for (const id of ["base", "head"]) {
  const trace = spawnSync(process.execPath, [...FLAGS, "--trace-deopt", "--trace-opt", files[id] as string, "child", String(reads), String(calls)], { encoding: "utf8", maxBuffer: 1 << 28 });
  writeFileSync(join(out, `trace-${id}.txt`), trace.stdout);
  const deopts = new Map<string, number>();
  for (const match of trace.stdout.matchAll(/bailout \(kind: ([^,]*), reason: ([^)]*)\): begin\. deoptimizing [^<]*<JSFunction ([^ >]*)[^<]*<Code ([A-Z_]+)>/g)) {
    const key = `${match[3]} ${match[4]} ${match[1]} (${match[2]})`;
    deopts.set(key, (deopts.get(key) ?? 0) + 1);
  }
  const tiers = new Map<string, number>();
  for (const match of trace.stdout.matchAll(/completed compiling [^<]*<JSFunction ([^ >]*)[^(]*\(target ([A-Z_]+)\)/g)) tiers.set(match[2] as string, (tiers.get(match[2] as string) ?? 0) + 1);
  console.log(`Deopts ${id}: ${[...deopts.values()].reduce((a, b) => a + b, 0)}, compiles ${JSON.stringify(Object.fromEntries(tiers))}`);
  for (const [key, count] of [...deopts].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${count} ${key}`);
}
