import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const ID = /\[([A-Z]+\.[A-Z0-9-]+)\]/g;

function specIds(): Set<string> {
  const text = readFileSync(join(here, "..", "..", "..", "docs", "SPEC.md"), "utf8");
  return new Set([...text.matchAll(/^\| ([A-Z]+\.[A-Z0-9-]+) \|/gm)].map((match) => match[1] as string));
}

function testIds(): Set<string> {
  const out = new Set<string>();
  for (const file of readdirSync(here).filter((name) => name.endsWith(".test.ts") && name !== "spec.test.ts")) {
    const text = readFileSync(join(here, file), "utf8");
    for (const match of text.matchAll(/it\("((?:[^"\\]|\\.)*)"/g)) for (const id of (match[1] ?? "").matchAll(ID)) out.add(id[1] as string);
  }
  return out;
}

describe("the specification", () => {
  it("has a test for each requirement ID, and each ID of a test is in the specification", () => {
    const spec = specIds();
    const tests = testIds();
    expect([...spec].filter((id) => !tests.has(id)), "IDs without a test").toEqual([]);
    expect([...tests].filter((id) => !spec.has(id)), "IDs of tests that are not in SPEC.md").toEqual([]);
    expect(spec.size).toBeGreaterThan(90);
  });
});
