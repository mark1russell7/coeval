import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type Effect,
  type EvalFn,
  type Json,
  type Machine,
  type WorldEntry,
  STD_CAPS,
  STD_MACHINE,
  context,
  evaluate,
  fail,
  formulaDefinitions,
  formulaMachine,
  lookupKind,
  makeContext,
  ok,
  prepare,
  ref,
  reference,
  resolve,
  run,
  typed,
} from "./index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const docs = join(here, "..", "..", "..", "docs");
const ID = /\[([A-Z]+\.[A-Z0-9-]+)\]/g;

/** The requirement IDs of SPEC.md: the first cell of each row of a table. */
function specIds(): Set<string> {
  const text = readFileSync(join(docs, "SPEC.md"), "utf8");
  return new Set([...text.matchAll(/^\| ([A-Z]+\.[A-Z0-9-]+) \|/gm)].map((match) => match[1] as string));
}

/** The requirement IDs in the titles of the tests. */
function testIds(): Set<string> {
  const out = new Set<string>();
  for (const file of readdirSync(here).filter((name) => name.endsWith(".test.ts") && name !== "spec.test.ts")) {
    const text = readFileSync(join(here, file), "utf8");
    for (const match of text.matchAll(/it\("((?:[^"\\]|\\.)*)"/g)) for (const id of (match[1] ?? "").matchAll(ID)) out.add(id[1] as string);
  }
  return out;
}

interface Rule {
  readonly name: string;
  readonly ids: readonly string[];
  readonly line: number;
}

/**
 * This function reads the rules of the page. In a fenced block, a line that starts with a rule name, for example
 * `E-KIND`, starts a rule. The line must end with the list of its IDs in brackets. Each other line of a rule starts
 * with a space.
 */
function rulesOf(text: string): { readonly rules: readonly Rule[]; readonly bad: readonly string[] } {
  const rules: Rule[] = [];
  const bad: string[] = [];
  let fenced = false;
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.startsWith("```")) {
      fenced = !fenced;
      return;
    }
    if (!fenced || !/^[A-Z][A-Z0-9]*-[A-Z0-9]/.test(line)) return;
    const match = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+) +\[([^\]]*)\]$/.exec(line.trimEnd());
    if (match === null) {
      bad.push(`${index + 1}: ${line}`);
      return;
    }
    const ids = (match[2] as string).split(",").map((id) => id.trim());
    rules.push({ name: match[1] as string, ids, line: index + 1 });
  });
  return { rules, bad };
}

describe("the core calculus", () => {
  const page = readFileSync(join(docs, "SEMANTICS.md"), "utf8");
  const { rules, bad } = rulesOf(page);

  it("[SEM.RULES] each rule of SEMANTICS.md names SPEC IDs that exist and have tests", () => {
    const spec = specIds();
    const tests = testIds();
    expect(bad, "rule lines without a list of IDs").toEqual([]);
    expect(rules.length).toBeGreaterThan(60);
    const names = rules.map((rule) => rule.name);
    expect(
      names.filter((name, index) => names.indexOf(name) !== index),
      "rule names that repeat",
    ).toEqual([]);
    const malformed = rules.filter((rule) => rule.ids.length === 0 || rule.ids.some((id) => !/^[A-Z]+\.[A-Z0-9-]+$/.test(id)));
    expect(
      malformed.map((rule) => rule.name),
      "rules with a bad list of IDs",
    ).toEqual([]);
    const claims = rules.flatMap((rule) => rule.ids.map((id) => `${rule.name}: ${id}`));
    expect(
      claims.filter((claim) => !spec.has(claim.split(": ")[1] as string)),
      "IDs that SPEC.md does not have",
    ).toEqual([]);
    expect(
      claims.filter((claim) => !tests.has(claim.split(": ")[1] as string)),
      "IDs without a test",
    ).toEqual([]);
  });

  it("[SEM.RULES] each requirement ID on the page is in SPEC.md, and SPEC.md links the page", () => {
    const spec = specIds();
    const named = new Set([...page.matchAll(/\b([A-Z]{2,}\.[A-Z][A-Z0-9-]*)\b/g)].map((match) => match[1] as string));
    expect([...named].filter((id) => !spec.has(id))).toEqual([]);
    expect(named.size).toBeGreaterThan(100);
    expect(readFileSync(join(docs, "SPEC.md"), "utf8")).toContain("(SEMANTICS.md)");
  });

  it("[SEM.RULES] the reader of the rules finds a rule line without its IDs", () => {
    const text = ["```text", "E-ONE  [EVAL.OWN, VALUE.ANY]", "    a premise", "E-TWO", "```", "E-THREE in prose is not a rule"].join("\n");
    expect(rulesOf(text)).toEqual({ rules: [{ name: "E-ONE", ids: ["EVAL.OWN", "VALUE.ANY"], line: 2 }], bad: ["4: E-TWO"] });
  });
});

/** The names of a chain of references: `prefix0` to `prefix(count-1)`. The last reference reaches the target. */
function chain(prefix: string, count: number, target: string): Record<string, unknown> {
  const names: Record<string, unknown> = {};
  for (let index = 0; index < count; index += 1) names[`${prefix}${index}`] = ref("names", index + 1 === count ? target : `${prefix}${index + 1}`);
  return names;
}

/** The standard machine with more kinds and evaluators. */
function withKinds(kinds: Readonly<Record<string, WorldEntry>>, evaluators: Readonly<Record<string, EvalFn>> = {}): Machine {
  return {
    ...STD_MACHINE,
    world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, ...kinds } },
    evaluators: { ...STD_MACHINE.evaluators, ...evaluators },
  };
}

describe("the facts that the calculus states", () => {
  it("[DEREF.COLLAPSE-LIMIT] one resolution follows 64 references, and the next one gives #CYCLE!, also in a chain without a cycle", () => {
    const end = { end: "end" };
    for (const hops of [true, false]) {
      expect(resolve(STD_MACHINE, context({ names: { ...chain("r", 64, "end"), ...end } }), ["names", "r0"], { hops })).toMatchObject({ ok: true, thing: "end" });
      expect(resolve(STD_MACHINE, context({ names: { ...chain("r", 65, "end"), ...end } }), ["names", "r0"], { hops })).toMatchObject({ ok: false, code: "#CYCLE!" });
    }
    // The count is for the whole resolution: two hops that follow 32 and 33 references give #CYCLE!.
    const names = (second: number) => ({ ...chain("a", 32, "box"), box: { x: ref("names", "b0") }, ...chain("b", second, "end"), ...end });
    expect(resolve(STD_MACHINE, context({ names: names(31) }), ["names", "a0", "x"])).toMatchObject({ ok: true, thing: "end" });
    expect(resolve(STD_MACHINE, context({ names: names(32) }), ["names", "a0", "x"])).toMatchObject({ ok: false, code: "#CYCLE!" });
    expect(resolve(STD_MACHINE, context({ names: names(32) }), ["names", "box", "x"])).toMatchObject({ ok: true, thing: "end" });
    // The plan and the reference give the same error.
    const doc = ref("names", "r0");
    const ctx = makeContext({ ...chain("r", 65, "end"), ...end });
    for (const result of [prepare(STD_MACHINE, doc).evaluate(ctx), reference(STD_MACHINE, doc, ctx)]) expect(result).toMatchObject({ ok: false, error: { code: "#CYCLE!", place: [] } });
  });

  it("[WORLD.ALIAS-LIMIT] a lookup follows 32 aliases, and a longer chain gives no kind, thus a document gives #KIND?", () => {
    const aliases = (count: number): Machine => {
      const kinds: Record<string, WorldEntry> = {};
      for (let index = 0; index < count; index += 1) kinds[`a${index}`] = { type: "ref", value: ["world", index + 1 === count ? "number" : `a${index + 1}`] };
      return withKinds(kinds);
    };
    expect(lookupKind(aliases(32).world, "a0")).toMatchObject({ ok: true, path: ["number"], aliases: 32 });
    expect(lookupKind(aliases(33).world, "a0")).toMatchObject({ ok: false, reason: "cycle" });
    const doc = typed("a0", 5);
    expect(prepare(aliases(32), doc).evaluate()).toEqual(ok(5));
    expect(reference(aliases(32), doc)).toEqual(ok(5));
    for (const result of [prepare(aliases(33), doc).evaluate(), reference(aliases(33), doc)]) expect(result).toMatchObject({ ok: false, error: { code: "#KIND?", place: [] } });
  });

  it("[DEREF.READER] a reference in the data resolves in the context of its reader, not of its writer", () => {
    // The let of the reader binds x to 2. The stored reference reads that x, not the x beside the reference.
    const names = { r: ref("names", "x"), x: 1 };
    const doc: Json = { type: "let", value: { bind: { x: 2 }, body: { type: "ref", value: ["names", "r"] } } };
    const machine = formulaMachine();
    expect(prepare(machine, doc).evaluate(makeContext(names))).toEqual(ok(2));
    expect(reference(machine, doc, makeContext(names), { definitions: formulaDefinitions() })).toEqual(ok(2));
    expect(resolve(machine, context({ names: { ...names, x: 3 } }), ["names", "r"])).toMatchObject({ ok: true, thing: 3 });
  });

  it("[EVAL.BY-NAME] each evaluation of a part is a new evaluation, and its effects happen again", () => {
    const twice: EvalFn = ({ parts }) => {
      const part = parts[0];
      if (part === undefined) return fail("#VALUE!", "twice needs a part.");
      const first = part.evaluate();
      const second = part.evaluate();
      return first.ok && second.ok ? ok([first.value, second.value]) : first;
    };
    const machine = withKinds({ twice: { verbs: { eval: "twice" }, parts: { shape: "term" } } }, { twice });
    const doc: Json = { type: "twice", value: { type: "log", value: ["hi"] } };
    const ctx = makeContext({}, STD_CAPS);
    const planned: Effect[] = [];
    const read: Effect[] = [];
    expect(prepare(machine, doc).evaluate(ctx, { effects: planned })).toEqual(ok(["hi", "hi"]));
    expect(reference(machine, doc, ctx, { effects: read })).toEqual(ok(["hi", "hi"]));
    for (const effects of [planned, read]) expect(effects.map((effect) => [effect.kind, effect.address])).toEqual([["log", "#0"], ["log", "#1"]]);
  });

  it("[DEREF.NO-WALKER] a step that is not a key, and not a document of a kind with the verb step, gives #STEP?", () => {
    const ctx = context({ names: { b: [1, 2] } });
    for (const step of [true, { x: 1 }, { type: "number", value: 1 }] as const) {
      expect(resolve(STD_MACHINE, ctx, ["names", "b", step])).toMatchObject({ ok: false, code: "#STEP?" });
    }
    const doc = ref("names", "b", true);
    const names = makeContext({ b: [1, 2] });
    for (const result of [prepare(STD_MACHINE, doc).evaluate(names), reference(STD_MACHINE, doc, names)]) expect(result).toMatchObject({ ok: false, error: { code: "#STEP?", place: [] } });
  });

  it("[RUN.NEEDS-RUNNER] in a run, an effect of an evaluator gives #CALC! at once, and a runner under an evaluator starts", async () => {
    // pure is a runner that does not wait. An evaluation and a run both drive it under add (K110).
    const doc: Json = { type: "add", value: [1, { type: "pure", value: [{ type: "number", value: 2 }] }] };
    expect(evaluate(STD_MACHINE, doc, makeContext({}, STD_CAPS)).result).toEqual(ok(3));
    expect((await run(STD_MACHINE, doc, makeContext({}, STD_CAPS))).result).toEqual(ok(3));
    // An effect of an evaluator gives #CALC! in a run, before the test of the capabilities.
    const say: EvalFn = ({ effect }) => effect("log", "hi");
    const machine = withKinds({ say: { verbs: { eval: "say" } } }, { say });
    const sayDoc: Json = { type: "say", value: null };
    expect(evaluate(machine, sayDoc, makeContext({}, STD_CAPS)).result).toEqual(ok("hi"));
    expect(evaluate(machine, sayDoc, makeContext()).result).toMatchObject({ ok: false, error: { code: "#CAP!" } });
    const performed: Effect[] = [];
    const perform = (effect: Effect): null => {
      performed.push(effect);
      return null;
    };
    for (const caps of [STD_CAPS, []]) {
      const out = await run(machine, sayDoc, makeContext({}, caps), { perform });
      expect(out.result).toMatchObject({ ok: false, error: { code: "#CALC!", place: [] } });
    }
    expect(performed).toEqual([]);
  });
});
