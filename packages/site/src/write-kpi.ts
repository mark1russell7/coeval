/**
 * This script writes `kpi.json` into the built site with the checked writer of `@mark1russell7/site-pages`. The build
 * starts it after `astro build`. Each count comes from a committed file, so the time of the data is the time of the commit.
 * The time of the build is not the time of the data.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRoadmap, writeKpi } from "@mark1russell7/site-pages";
import { commitTime } from "@mark1russell7/site-pages/vite";
import { coevalMeasures } from "./lib/kpi.ts";

const site = fileURLToPath(new URL("..", import.meta.url));
const repo = join(site, "..", "..");
const text = (...path: string[]): string => readFileSync(join(repo, ...path), "utf8");
const proofs = join(repo, "proofs");
const lean = readdirSync(proofs, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".lean") && !path.startsWith(".lake"))
  .sort()
  .map((path) => readFileSync(join(proofs, path), "utf8"));

const file = writeKpi(join(site, "dist"), {
  project: "coeval",
  at: commitTime({}, repo),
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  measures: coevalMeasures({
    spec: text("docs", "SPEC.md"),
    decisions: text("docs", "DECISIONS.md"),
    rows: parseRoadmap(text("docs", "ROADMAP.md")).map((item) => item.statusClass),
    lean,
  }),
});
console.info(`kpi: wrote ${file}`);
