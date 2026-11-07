import { describe, expect, it } from "vitest";
import { esbuildLines, esbuildOfLock } from "./esbuild.ts";

/** This function gives a lock file with the esbuild `version` of `packages/core`, and esbuild 0.1.0 in another importer. */
function lockWith(version: string): string {
  return [
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  packages/core:",
    "    devDependencies:",
    "      '@mark1russell7/rigor-bench':",
    "        specifier: ^0.2.23",
    "        version: 0.2.23(esbuild@0.28.2)",
    "      esbuild:",
    "        specifier: ^0.28.2",
    `        version: ${version}`,
    "",
    "  packages/site:",
    "    devDependencies:",
    "      esbuild:",
    "        specifier: ^0.1.0",
    "        version: 0.1.0",
    "",
    "packages:",
    "",
  ].join("\n");
}

describe("the esbuild of each arm (K233, D172)", () => {
  it("reads the version of packages/core, not of another importer or of a dependency of a package", () => {
    expect(esbuildOfLock(lockWith("0.28.2"))).toBe("0.28.2");
    expect(esbuildOfLock(lockWith("0.28.2").replace(/\n/g, "\r\n"))).toBe("0.28.2");
  });

  it("gives no version when packages/core has no esbuild, or when the version is not a plain version", () => {
    expect(esbuildOfLock(lockWith("0.28.2").replace("  packages/core:", "  packages/other:"))).toBeUndefined();
    expect(esbuildOfLock(lockWith("0.28.2").replace("      esbuild:\n        specifier: ^0.28.2", "      tsx:\n        specifier: ^4.0.0"))).toBeUndefined();
    expect(esbuildOfLock(lockWith("0.28.2$(id)"))).toBeUndefined();
  });

  it("reads differ as true only when both versions are there and differ", () => {
    expect(esbuildLines(lockWith("0.28.1"), lockWith("0.28.2"))).toEqual(["base=0.28.1", "head=0.28.2", "differ=true"]);
    expect(esbuildLines(lockWith("0.28.2"), lockWith("0.28.2"))).toEqual(["base=0.28.2", "head=0.28.2", "differ=false"]);
    expect(esbuildLines("lockfileVersion: '9.0'\n", lockWith("0.28.2"))).toEqual(["base=", "head=0.28.2", "differ=false"]);
  });
});
