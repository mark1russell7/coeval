/**
 * The probe of K216 (not for main). It bundles the cases with the kernel of the base and of the head, as `paths.ts`
 * does. Then it times two tree cases in new processes, in turns, and profiles each arm with `--cpu-prof` and
 * `--trace-deopt`.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CASES } from "./cases.ts";
import { FLAGS, bundle } from "./paths.ts";

const [baseIndex, headIndex, out] = process.argv.slice(2);
const names = CASES.map((item) => item.name);
const reads = names.indexOf("the same tree, with a list of reads");
const plain = names.indexOf("a tree with an equation");
const CALLS = 200000;
const dir = mkdtempSync(join(tmpdir(), "k216-"));
const arms = { base: await bundle(resolve(baseIndex), "base", dir), head: await bundle(resolve(headIndex), "head", dir) };
console.log(`CPU: ${cpus()[0]?.model}, Node ${process.version}`);

function time(file: string, index: number, extra: readonly string[] = []): number {
  const start = process.hrtime.bigint();
  const child = spawnSync(process.execPath, [...FLAGS, ...extra, file, "child", String(index), String(CALLS)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (child.status !== 0) throw new Error(`${file}: status ${String(child.status)} ${child.stderr}`);
  return Number(process.hrtime.bigint() - start) / 1e6;
}

for (const [label, index] of [["list of reads", reads], ["no reads", plain]] as const) {
  const ms: Record<string, number[]> = { base: [], head: [] };
  for (let round = 0; round < 8; round++) {
    const order = round % 2 === 0 ? (["base", "head"] as const) : (["head", "base"] as const);
    for (const arm of order) ms[arm].push(time(arms[arm], index));
  }
  const median = (list: number[]): number => [...list].sort((a, b) => a - b)[list.length >> 1];
  console.log(`Time ${label}: base ${ms.base.map((v) => v.toFixed(0)).join(" ")} | head ${ms.head.map((v) => v.toFixed(0)).join(" ")} | head/base ${(median(ms.head) / median(ms.base)).toFixed(3)}`);
}

interface ProfNode {
  id: number;
  callFrame: { functionName: string; lineNumber: number };
}
for (const arm of ["base", "head"] as const) {
  const profDir = join(out, `prof-${arm}`);
  time(arms[arm], reads, ["--cpu-prof", `--cpu-prof-dir=${profDir}`]);
  const prof = JSON.parse(readFileSync(join(profDir, readdirSync(profDir)[0]), "utf8")) as { nodes: ProfNode[]; samples: number[] };
  const byId = new Map(prof.nodes.map((node) => [node.id, node]));
  const self = new Map<string, number>();
  for (const id of prof.samples) {
    const frame = byId.get(id)!.callFrame;
    const key = `${frame.functionName || "(anon)"}:${frame.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + 1);
  }
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log(`Profile ${arm} (list of reads): ${prof.samples.length} samples`);
  for (const [key, count] of top) console.log(`  ${((100 * count) / prof.samples.length).toFixed(1).padStart(5)} % ${key}`);
  const trace = spawnSync(process.execPath, [...FLAGS, "--trace-deopt", arms[arm], "child", String(reads), String(CALLS)], { encoding: "utf8", maxBuffer: 1 << 28 });
  const deopts = new Map<string, number>();
  for (const match of trace.stdout.matchAll(/deoptimizing [^<]*<JSFunction ([^ >]*)[^\n]*\n[^\n]*reason: ([^)]*)\)/g)) {
    const key = `${match[1]} (${match[2]})`;
    deopts.set(key, (deopts.get(key) ?? 0) + 1);
  }
  console.log(`Deopts ${arm} (list of reads): ${[...deopts.values()].reduce((a, b) => a + b, 0)}`);
  for (const [key, count] of [...deopts].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${count} ${key}`);
  writeFileSync(join(out, `deopt-${arm}.txt`), trace.stdout);
}
