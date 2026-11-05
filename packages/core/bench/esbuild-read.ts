/*
 * One sizing read of K233 on a branch that does not merge: does a bump of esbuild change the kernel bundle, and its time?
 * The script builds `cases.ts` with each version, in the form of `bundle` in `paths.ts`, and prints the hash and the size.
 * It then runs each bundle in new processes, with the order turned each round, and a second arm of the last version as A/A.
 * All cases of an arm share one process, so this is a first read and not a verdict of the bench.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSIONS = ["0.27.7", "0.28.0", "0.28.1", "0.28.2"];
const ROUNDS = Number(process.env["READ_ROUNDS"] ?? 5);
const FLAGS = ["--predictable", "--predictable-gc-schedule"];
const CASES_FILE = fileURLToPath(new URL("./cases.ts", import.meta.url));
const HOME = join(process.env["RUNNER_TEMP"] ?? ".", "esbuild-read");

interface Measured {
  readonly name: string;
  readonly result: string;
  readonly calls: number;
  readonly ns: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

async function buildWith(version: string): Promise<string> {
  const dir = join(HOME, version);
  mkdirSync(dir, { recursive: true });
  const install = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--prefix", dir, `esbuild@${version}`], { encoding: "utf8" });
  if (install.status !== 0) throw new Error(`npm install of esbuild ${version} stopped: ${install.stderr}`);
  const url = pathToFileURL(join(dir, "node_modules", "esbuild", "lib", "main.js")).href;
  const loaded = (await import(url)) as { default: { build: (options: object) => Promise<{ warnings: readonly { text: string }[] }> } };
  const outfile = join(dir, "cases.mjs");
  const started = performance.now();
  const { warnings } = await loaded.default.build({ entryPoints: [CASES_FILE], bundle: true, format: "esm", platform: "node", target: "node22", outfile, logLevel: "error" });
  const ms = performance.now() - started;
  const bytes = readFileSync(outfile);
  console.log(`Bundle ${version}: sha256 ${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}, ${String(bytes.length)} bytes, built in ${ms.toFixed(0)} ms, ${String(warnings.length)} warnings.`);
  return outfile;
}

function measure(file: string, counts?: readonly number[]): readonly Measured[] {
  const args = [...FLAGS, file, "measure", ...(counts === undefined ? [] : [JSON.stringify(counts)])];
  const child = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "inherit"] });
  if (child.status !== 0) throw new Error(`The process of ${file} stopped with the status ${String(child.status)}.`);
  return JSON.parse(child.stdout) as readonly Measured[];
}

const files = new Map<string, string>();
for (const version of VERSIONS) files.set(version, await buildWith(version));
const last = VERSIONS[VERSIONS.length - 1] as string;
const arms = [...VERSIONS.map((version) => ({ id: version, file: files.get(version) as string })), { id: `${last} A/A`, file: files.get(last) as string }];

const first = measure(files.get(last) as string);
const counts = first.map((item) => item.calls);
const times = new Map(arms.map((item) => [item.id, first.map((): number[] => [])]));
const results = new Map<string, Set<string>>(first.map((item) => [item.name, new Set([item.result])]));
const started = performance.now();
for (let round = 0; round < ROUNDS; round++) {
  for (let step = 0; step < arms.length; step++) {
    const item = arms[(round + step) % arms.length] as (typeof arms)[number];
    measure(item.file, counts).forEach((row, index) => {
      (times.get(item.id) as number[][])[index]?.push(row.ns);
      results.get(row.name)?.add(row.result);
    });
  }
  console.log(`Round ${String(round + 1)} of ${String(ROUNDS)}: ${((performance.now() - started) / 60000).toFixed(1)} min.`);
}

console.log(`\nThe median time of each arm against ${last}, ${String(ROUNDS)} rounds.`);
console.log(`case | ${arms.map((item) => item.id).join(" | ")} | results`);
first.forEach((item, index) => {
  const base = median((times.get(last) as number[][])[index] as number[]);
  const cells = arms.map((arm) => (median((times.get(arm.id) as number[][])[index] as number[]) / base).toFixed(3));
  console.log(`${item.name} | ${cells.join(" | ")} | ${results.get(item.name)?.size === 1 ? "same" : "DIFFERENT"}`);
});
