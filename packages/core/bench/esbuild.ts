/*
 * The esbuild of each arm (K233, D172). Speed bundles both arms with the esbuild of the head. A pull request that
 * changes the version of esbuild then gives two arms of one bundler, and Speed does not read what the new version does
 * to the kernel. Thus the workflow reads the version of each lock file first:
 *
 *   node packages/core/bench/esbuild.ts <lock file of the base> <lock file of the head>
 *
 * The script prints the lines `base=<version>`, `head=<version>` and `differ=<true or false>` for `$GITHUB_OUTPUT`.
 * When the two versions differ, the workflow installs the version of the base, and `paths.ts` builds the base arm with it.
 * A lock file with no esbuild of `packages/core` gives an empty version, and `differ` is then false.
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The importer of the bench in the lock file. */
const IMPORTER = "packages/core";

/**
 * This function gives the version of esbuild that the lock file gives to the importer `packages/core`.
 *
 * @param lock - The text of `pnpm-lock.yaml`.
 * @returns The version, or `undefined` when the importer has no esbuild.
 */
export function esbuildOfLock(lock: string): string | undefined {
  const lines = lock.split(/\r?\n/);
  const start = lines.indexOf(`  ${IMPORTER}:`);
  if (start < 0) return undefined;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] as string;
    // The next importer, or the next section, ends the block.
    if (/^ {0,2}\S/.test(line)) return undefined;
    if (line !== "      esbuild:") continue;
    for (let next = index + 1; next < lines.length && (lines[next] as string).startsWith("        "); next += 1) {
      // A version that is not a plain version of SemVer goes to no command of the workflow.
      const found = /^ {8}version: (\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/.exec(lines[next] as string);
      if (found !== null) return found[1];
    }
    return undefined;
  }
  return undefined;
}

/** This function gives the lines for `$GITHUB_OUTPUT` from the two lock files. */
export function esbuildLines(baseLock: string, headLock: string): string[] {
  const [base, head] = [esbuildOfLock(baseLock) ?? "", esbuildOfLock(headLock) ?? ""];
  return [`base=${base}`, `head=${head}`, `differ=${String(base !== "" && head !== "" && base !== head)}`];
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [baseFile, headFile] = process.argv.slice(2);
  if (baseFile === undefined || headFile === undefined) throw new Error("Give the lock file of the base and of the head.");
  console.log(esbuildLines(readFileSync(baseFile, "utf8"), readFileSync(headFile, "utf8")).join("\n"));
}
