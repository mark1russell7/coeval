import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { docEquals, formulaMachine, generate, Held, isClosure, isEnvelope, type Json, makeContext, prepare, typePath, typesOf } from "./index.ts";

/** The path of the executable of the model. Only the workflow `lean.yml` sets it, thus a local run compares nothing. */
const MODEL = process.env["COEVAL_LEAN_MODEL"];
const COUNT = Number(process.env["COEVAL_LEAN_COUNT"] ?? 2000);
const SEED = Number(process.env["COEVAL_LEAN_SEED"] ?? 1);

const NAMES: Record<string, Json> = { a: 1, b: [1, 2], c: { d: true } };
const CLOSURE = Symbol.for("coeval.closure");

/** The one operation of the profile. The model has the same rule in `addAll`. */
function add(...values: readonly unknown[]): number {
  let sum = 0;
  for (const value of values) {
    if (typeof value !== "number") throw new Error("The operation add takes numbers.");
    sum += value;
  }
  return sum;
}

const machine = formulaMachine({ ops: { add } }, { plain: true, roots: ["names"] });
const types = [...typesOf(machine.world).filter((type) => type[0] !== "ext"), ["ops", "add"], ["ops", "gone"]];

/** This function replaces each number that the model does not hold. A generated document has few of them. */
function wholeNumbers(value: Json): Json {
  if (typeof value === "number") return Number.isSafeInteger(value) && !Object.is(value, -0) ? value : 7;
  if (Array.isArray(value)) return value.map(wholeNumbers);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wholeNumbers(item as Json)]));
  return value;
}

/** This function tells if the model covers a document. The model has no `ext` and no field `own`. */
function covered(value: Json): boolean {
  if (Array.isArray(value)) return value.every(covered);
  if (typeof value !== "object" || value === null) return true;
  if (isEnvelope(value) && (value.own !== undefined || typePath(value.type)?.[0] === "ext")) return false;
  return Object.values(value).every((item) => covered(item as Json));
}

/** This function writes a value for the model. The form keeps the order of the keys of each record. */
function encode(value: Json): unknown {
  if (Array.isArray(value)) return { a: value.map(encode) };
  if (typeof value !== "object" || value === null) return value;
  return { o: Object.entries(value).map(([key, item]) => [key, encode(item as Json)]) };
}

/** This function gives the form of a value that the model prints. */
function normal(value: unknown): Json {
  if (value === undefined) return { undefined: true };
  if (isClosure(value)) return { closure: [...(value as unknown as Record<symbol, { readonly params: readonly string[] }>)[CLOSURE]!.params] };
  if (value instanceof Held) return { held: value.error.code };
  if (Array.isArray(value)) return value.map(normal);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normal(item)]));
  return value as Json;
}

/** This function gives the result of the plan, in the form that the model prints. */
function planned(doc: Json): Json {
  const result = prepare(machine, doc, { declaredType: "lit" }).evaluate(makeContext(NAMES));
  return result.ok ? { value: normal(result.value) } : { error: result.error.code };
}

/** This function makes the documents of a run. */
function documents(count: number, seed: number): Json[] {
  const out: Json[] = [];
  for (let index = 0; index < count; index += 1) {
    const doc = wholeNumbers(
      generate(machine.world, {
        seed: seed * 1000003 + index,
        declaredType: "lit",
        names: Object.keys(NAMES),
        types,
        hints: (type, path) => (type[0] === "call" && path[0] === "fn" ? [["fn"], ["ref"]] : undefined),
        data: (type, rng) => (type[0] === "lit" && rng.chance(0.1) ? { type: "ref", value: ["names", "a"] } : undefined),
      }) as Json,
    );
    if (covered(doc)) out.push(doc);
  }
  return out;
}

describe("the Lean model", () => {
  it("[AGREE.LEAN] the model gives the result of the plan for each generated document", () => {
    const docs = documents(COUNT, SEED);
    expect(docs.length).toBeGreaterThan(COUNT * 0.9);
    const expected = docs.map(planned);
    const kinds = new Set(expected.map((result) => Object.keys(result as object)[0]));
    expect(kinds).toEqual(new Set(["value", "error"]));
    if (MODEL === undefined) return;

    const input = docs.map((doc) => JSON.stringify([encode(NAMES), encode(doc)])).join("\n");
    const run = spawnSync(MODEL, [], { input: `${input}\n`, encoding: "utf8", maxBuffer: 2 ** 30 });
    expect(run.status).toBe(0);
    const lines = run.stdout.trimEnd().split("\n");
    expect(lines.length).toBe(docs.length);

    const differences = docs.flatMap((doc, index) => {
      const model = JSON.parse(lines[index] as string) as Json;
      return docEquals(model, expected[index]) ? [] : [{ doc, model, plan: expected[index] }];
    });
    expect(differences.slice(0, 5)).toEqual([]);
  });
});
