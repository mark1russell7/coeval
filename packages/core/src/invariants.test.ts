import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as api from "./index.ts";
import { ok } from "./errors.ts";
import { type CompiledPart, type EvalFn, type Part, type RunFn, type RunPart, evaluate, makeContext } from "./evaluate.ts";
import { STD_EVALUATORS, STD_MACHINE, STD_RUNNERS } from "./stdlib.ts";
import type { World } from "./world.ts";

/*
 * Machine checks for the decisions of docs/DECISIONS.md that a later change can break in silence. Each test names its
 * decision. The type checks fail in the type check of the tests, and the other checks fail in the run.
 */

const here = dirname(fileURLToPath(import.meta.url));

const source = (file: string): string => readFileSync(join(here, file), "utf8");

/** This function gives the local modules that a module imports, from its import and export statements. */
function localImports(file: string): readonly string[] {
  const out: string[] = [];
  for (const match of source(file).matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+"\.\/([\w.-]+\.ts)"/gms)) {
    if (match[1] !== undefined) out.push(match[1]);
  }
  return out;
}

/** This function gives each local module that a module reaches through its imports, the module too. */
function reachable(file: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const next = [file];
  for (let item = next.pop(); item !== undefined; item = next.pop()) {
    if (seen.has(item)) continue;
    seen.add(item);
    next.push(...localImports(item));
  }
  return seen;
}

/** The keys of a type that give the value of a part. D7 forbids each one. */
type ValueKeys<T> = Extract<keyof T, "value" | "item" | "doc">;

describe("the decisions", () => {
  it("[D2] the ladder, the evaluation, the resolution, the reference and the static kit do not reach the classifier", () => {
    expect(localImports("index.ts")).toContain("classify.ts");
    for (const file of ["ladder.ts", "evaluate.ts", "deref.ts", "reference.ts", "static.ts"]) {
      expect([...reachable(file)], file).not.toContain("classify.ts");
    }
  });

  it("[D7] a part is a handle: no type of a part and no part of a run has a field with its value", () => {
    const none: [ValueKeys<Part>, ValueKeys<RunPart>, ValueKeys<CompiledPart>] extends [never, never, never] ? true : false = true;
    expect(none).toBe(true);
    const keys = new Set<string>();
    const add: EvalFn = (input) => {
      for (const part of input.parts) for (const key of Object.keys(part)) keys.add(key);
      return ok(0);
    };
    const seq: RunFn = function* (input) {
      for (const part of input.parts) for (const key of Object.keys(part)) keys.add(key);
      return ok(0);
    };
    const machine = { ...STD_MACHINE, evaluators: { ...STD_EVALUATORS, "math.add": add }, runners: { ...STD_RUNNERS, "control.seq": seq } };
    const out = evaluate(machine, { type: "seq", value: [{ type: "add", value: [1, 2] }] }, makeContext({}, []));
    expect(out.result).toEqual({ ok: true, value: 0 });
    expect(keys.size).toBeGreaterThan(0);
    for (const key of ["value", "item", "doc"]) expect([...keys]).not.toContain(key);
  });

  it("[D22] the domains are a table of the machine, not of the world", () => {
    const absent: Extract<keyof World, "domains"> extends never ? true : false = true;
    expect(absent).toBe(true);
    expect("domains" in STD_MACHINE.world).toBe(false);
  });

  it("[D29] compilePath is not an export of the package", () => {
    expect("compilePath" in api).toBe(false);
  });

  it("[D32] the grant of a context is a private symbol: not shared through Symbol.for, and not an export", () => {
    const code = source("evaluate.ts");
    expect(code).toMatch(/^const GRANT = (?:\/\* @__PURE__ \*\/ )?Symbol\(/m);
    expect(code).not.toMatch(/^export\b[^\n]*\bGRANT\b/m);
    expect(code).not.toContain('Symbol.for("coeval.grant")');
    expect("GRANT" in api).toBe(false);
    const symbols: symbol[] = [];
    const look: EvalFn = (input) => {
      symbols.push(...Object.getOwnPropertySymbols(input.context));
      return ok(0);
    };
    evaluate({ ...STD_MACHINE, evaluators: { ...STD_EVALUATORS, "math.add": look } }, { type: "add", value: [1, 2] }, makeContext({}, ["log"]));
    expect(symbols.length).toBeGreaterThan(0);
    for (const symbol of symbols) expect(Symbol.keyFor(symbol)).toBeUndefined();
  });
});
