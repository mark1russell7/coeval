import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { armHash, armLine, holdRead, type BenchRun } from "./merge.ts";
import { bundle } from "./paths.ts";

const SOURCE = fileURLToPath(new URL("../src", import.meta.url));
const LITERAL = "A folded part causes no effect.";
const dir = mkdtempSync(join(tmpdir(), "coeval-arms-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * This function copies the kernel with no tests into a new folder, and gives the path of its index.
 * The last folder is `src`, as in the two real arms, because esbuild names a namespace object after that folder.
 */
function copyOfKernel(name: string): string {
  const target = join(dir, name, "src");
  cpSync(SOURCE, target, { recursive: true, filter: (file) => !/\.test\.tsx?$|test-support/.test(file) });
  return join(target, "index.ts");
}

/** This function gives the hash of the bundle of a copy of the kernel. */
async function hashOf(index: string, name: string): Promise<string> {
  return armHash(readFileSync(await bundle(index, name, dir), "utf8"));
}

/** This function gives a complete run with the hashes of its arms. */
function run(base: string, head: string): BenchRun {
  return { run: "1", cpu: "a CPU", node: "v26", rounds: 12, arms: { base, head }, cases: [] };
}

describe("the hold of a slower reading comes from the hashes of the arms (K232, D166)", () => {
  it("holds on a kernel with one changed byte, and does not hold on an equal copy in another folder", async () => {
    const [first, second, changed] = [copyOfKernel("first"), copyOfKernel("second"), copyOfKernel("changed")];
    const file = join(changed, "..", "evaluate.ts");
    const text = readFileSync(file, "utf8");
    const edited = text.replace(LITERAL, "B folded part causes no effect.");
    expect(edited).toHaveLength(text.length);
    expect(edited).not.toBe(text);
    writeFileSync(file, edited);
    const [a, b, c] = [await hashOf(first, "first"), await hashOf(second, "second"), await hashOf(changed, "changed")];
    expect(readFileSync(join(dir, "first.mjs"), "utf8")).toContain(LITERAL);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(holdRead(1, [run(a, b), run(a, b)], true).hold).toBe(false);
    expect(holdRead(1, [run(a, c), run(a, c)], true).hold).toBe(true);
  }, 30000);

  it("reads one tsconfig for both arms, and stops on a tsconfig that does not resolve (K234)", async () => {
    const [plain, own] = [copyOfKernel("plain"), copyOfKernel("own")];
    const setting = join(dir, "own", "tsconfig.json");
    writeFileSync(setting, JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }));
    const missing = join(dir, "missing.json");
    writeFileSync(missing, JSON.stringify({ extends: "./no-such-file.json" }));
    const plainHash = await hashOf(plain, "plain");
    expect(await hashOf(own, "own")).toBe(plainHash);
    expect(armHash(readFileSync(await bundle(plain, "set", dir, setting), "utf8"))).not.toBe(plainHash);
    await expect(bundle(plain, "missing", dir, missing)).rejects.toThrow("does not resolve");
  }, 30000);

  it("takes out only the lines that name a source file", () => {
    expect(armHash("// ../a/b.ts\nlet x;\n")).toBe(armHash("// c/d/e.ts\nlet x;\n"));
    expect(armHash("// a note\nlet x;\n")).not.toBe(armHash("// b note\nlet x;\n"));
    expect(armHash("let x = 1;\n")).not.toBe(armHash("let x = 2;\n"));
  });

  it("holds when a run is short or absent, also on equal arms", () => {
    expect(holdRead(1, [run("a", "a"), undefined], false).hold).toBe(true);
    expect(holdRead(0, [run("a", "a"), run("a", "a")], false).hold).toBe(true);
  });

  it("holds when a run has no hashes, and when the two jobs read different hashes", () => {
    const old: BenchRun = { run: "1", cpu: "a CPU", node: "v26", rounds: 12, cases: [] };
    expect(holdRead(1, [old, old], true).hold).toBe(true);
    expect(holdRead(1, [run("a", "a"), run("b", "b")], true).hold).toBe(true);
    expect(holdRead(1, [], true).hold).toBe(true);
  });

  it("does not hold with 0 slower, and marks a slower reading on equal arms", () => {
    expect(holdRead(0, [run("a", "b"), run("a", "b")], true).hold).toBe(false);
    expect(holdRead(2, [run("a", "a"), run("a", "a")], true).line).toContain("equal by construction");
  });

  it("prints the short hash of each arm", () => {
    expect(armLine([run("a".repeat(64), "b".repeat(64)), undefined])).toBe(`Arms (K232): base ${"a".repeat(12)} head ${"b".repeat(12)}, no hashes.`);
  });
});
