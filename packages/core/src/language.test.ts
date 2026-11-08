import { describe, expect, it } from "vitest";
import {
  type Language,
  type LanguageCode,
  type Machine,
  type MergeConflict,
  type WorldPart,
  MergeError,
  compose,
  defineLanguage,
  docEquals,
  formulaMachine,
  ok,
  prepare,
} from "./index.ts";

const BASE: Machine = formulaMachine({ ops: { add: (a: number, b: number) => a + b } });
const { world: baseWorld, ...baseCode } = BASE;
const formula = defineLanguage({ name: "formula", version: "1.4.2", world: baseWorld as WorldPart, code: baseCode as LanguageCode });

const FORMAT_WORLD: WorldPart = {
  verbs: ["format"],
  extends: [{ kind: ["kinds", "lit"], verbs: { format: "format.lit" } }],
};
const formatCode: LanguageCode = { evaluators: { "format.lit": ({ doc }) => ok(JSON.stringify(doc.value)) } };
const format = defineLanguage({ name: "format", version: "0.2.1", world: FORMAT_WORLD, requires: { formula: "1.2.0" }, code: formatCode });

function conflictsOf(run: () => unknown): readonly MergeConflict[] {
  try {
    run();
  } catch (error) {
    if (error instanceof MergeError) return error.conflicts;
    throw error;
  }
  return [];
}

describe("the language format", () => {
  it("[LANG.IDENTITY] two equal data halves give one text, in each order of their keys", () => {
    const one = defineLanguage({ name: "a", version: "1.0.0", world: { defaults: { view: "x", say: "y" } }, requires: { b: "1.0.0", c: "2.0.0" } });
    const two = defineLanguage({ name: "other", version: "2.0.0", requires: { c: "2.0.0", b: "1.0.0" }, world: { defaults: { say: "y", view: "x" } }, code: {} });
    expect(two.data).toBe(one.data);
    expect(one.data).toBe('{"requires":{"b":"1.0.0","c":"2.0.0"},"world":{"defaults":{"say":"y","view":"x"}}}');
    expect(defineLanguage({ name: "a", version: "1.0.0", world: { defaults: { view: "z" } } }).data).not.toBe(one.data);
    // A field without a value does not count, as JSON writes it.
    expect(defineLanguage({ name: "a", version: "1.0.0" }).data).toBe(defineLanguage({ name: "a", version: "1.0.0", world: {}, requires: {} }).data);
    expect(defineLanguage({ name: "a", version: "1.0.0", world: { defaults: {}, fallback: undefined } as never }).data).toBe(defineLanguage({ name: "a", version: "1.0.0", world: { defaults: {} } }).data);
  });

  it("[LANG.IDENTITY] a language is frozen, and it keeps its data half", () => {
    const defaults: Record<string, string> = { view: "x" };
    const language = defineLanguage({ name: "a", version: "1.0.0", world: { defaults } });
    const data = language.data;
    defaults["view"] = "changed";
    expect(language.world.defaults).toEqual({ view: "x" });
    expect(language.data).toBe(data);
    expect(Object.isFrozen(language)).toBe(true);
    expect(Object.isFrozen(language.world.defaults)).toBe(true);
    expect("code" in language).toBe(false);
  });

  it("[LANG.IDENTITY] a name, a version and a data half have a checked form", () => {
    expect(() => defineLanguage({ name: "", version: "1.0.0" })).toThrow(/has a name/);
    for (const version of ["1.0", "1.0.0-rc.1", "01.0.0", "v1.0.0", ""]) {
      expect(() => defineLanguage({ name: "a", version })).toThrow(/MAJOR\.MINOR\.PATCH/);
      expect(() => defineLanguage({ name: "a", version: "1.0.0", requires: { b: version } })).toThrow(/MAJOR\.MINOR\.PATCH/);
    }
    const code = (): null => null;
    expect(() => defineLanguage({ name: "a", version: "1.0.0", world: { kinds: { k: { verbs: code } as never } } })).toThrow('["world","kinds","k","verbs"]');
    expect(() => defineLanguage({ name: "a", version: "1.0.0", world: { defaults: { view: Number.NaN } as never } })).toThrow(/is not\./);
    expect(() => defineLanguage({ name: "a", version: "1.0.0", world: { replaces: [new Date(0)] as never } })).toThrow('["world","replaces",0]');
  });

  it("[LANG.COMPOSE] compose gives the machine of the merge of the languages", () => {
    const machine = compose(formula, format);
    const doc = { type: "lit", value: 5 };
    expect(prepare(machine, doc, { verb: "format" }).evaluate()).toEqual(ok("5"));
    expect(prepare(machine, { type: ["ops", "add"], value: [1, 2] }).evaluate()).toEqual(ok(3));
    expect(docEquals(machine.world, BASE.world)).toBe(false);
    expect(docEquals(compose(formula).world, BASE.world)).toBe(true);
    expect(compose().evaluators).toEqual({});
  });

  it("[LANG.COMPOSE] two languages can share a base, and a function reads the languages before it", () => {
    const size = defineLanguage({ name: "size", version: "3.0.0", requires: { formula: "1.0.0" }, world: { verbs: ["size"], extends: [{ kind: ["kinds", "lit"], verbs: { size: "size.lit" } }] }, code: { evaluators: { "size.lit": () => ok(1) } } });
    const machine = compose(formula, format, formula, size);
    expect(prepare(machine, { type: "lit", value: 5 }, { verb: "size" }).evaluate()).toEqual(ok(1));
    let seen = 0;
    const late = defineLanguage({
      name: "late",
      version: "1.0.0",
      code: (prev) => {
        seen = Object.keys(prev.evaluators).length;
        return {};
      },
    });
    compose(formula, late, late);
    expect(seen).toBe(Object.keys(BASE.evaluators).length);
    // Two values of one language with two objects of code merge by the rules of a merge.
    const again = defineLanguage({ name: "format", version: "0.2.1", world: FORMAT_WORLD, requires: { formula: "1.2.0" }, code: formatCode });
    expect(docEquals(compose(formula, format, again).world, compose(formula, format).world)).toBe(true);
    const rival = defineLanguage({ name: "format", version: "0.2.1", world: FORMAT_WORLD, requires: { formula: "1.2.0" }, code: { evaluators: { "format.lit": () => ok(0) } } });
    expect(conflictsOf(() => compose(formula, format, rival)).map((item) => item.path)).toEqual([["evaluators", "format.lit"]]);
  });

  it("[LANG.COMPOSE] two versions of one name, or two data halves under one version, are conflicts", () => {
    const newer = defineLanguage({ name: "formula", version: "1.5.0", world: baseWorld as WorldPart, code: baseCode as LanguageCode });
    expect(conflictsOf(() => compose(formula, newer))).toEqual([{ path: ["languages", "formula"], parts: [0, 1], reason: "Two versions of one language." }]);
    const other = defineLanguage({ name: "formula", version: "1.4.2", code: baseCode as LanguageCode });
    expect(conflictsOf(() => compose(formula, format, other))).toEqual([{ path: ["languages", "formula"], parts: [0, 2], reason: "Two languages with one name and one version differ." }]);
    // A conflict of the merge comes through compose.
    const clash = defineLanguage({ name: "clash", version: "1.0.0", world: { kinds: { lit: { verbs: { eval: "other" } } } } });
    expect(conflictsOf(() => compose(formula, clash)).map((item) => item.path)).toEqual([["world", "kinds", "lit"]]);
  });

  it("[LANG.REQUIRES] a language needs each required language before it, at a compatible version", () => {
    const needs = (name: string, version: string): Language => defineLanguage({ name: "user", version: "1.0.0", requires: { [name]: version } });
    const at = (version: string): Language => defineLanguage({ name: "dep", version });
    const fits = (have: string, want: string): boolean => conflictsOf(() => compose(at(have), needs("dep", want))).length === 0;
    expect(conflictsOf(() => compose(format))).toEqual([{ path: ["languages", "formula"], parts: [0, 0], reason: "A language requires formula, and the composition does not have it." }]);
    expect(conflictsOf(() => compose(format, formula))).toEqual([{ path: ["languages", "formula"], parts: [0, 1], reason: "A language requires formula, and formula comes after it." }]);
    expect(conflictsOf(() => compose(at("1.1.9"), needs("dep", "1.2.0")))).toEqual([{ path: ["languages", "dep"], parts: [0, 1], reason: "A language requires dep 1.2.0, and the composition has 1.1.9." }]);
    // The caret range of SemVer: the first number that is not zero stays, and the version is not lower.
    const cases: readonly (readonly [string, string, boolean])[] = [
      ["1.2.0", "1.2.0", true],
      ["1.2.1", "1.2.0", true],
      ["1.3.0", "1.2.9", true],
      ["1.9.0", "1.2.0", true],
      ["2.0.0", "1.2.0", false],
      ["1.1.9", "1.2.0", false],
      ["1.2.0", "1.2.1", false],
      ["0.2.1", "0.2.0", true],
      ["0.3.0", "0.2.0", false],
      ["0.2.0", "0.2.1", false],
      ["0.0.3", "0.0.3", true],
      ["0.0.4", "0.0.3", false],
      ["0.0.0", "0.0.0", true],
      ["0.0.1", "0.0.0", false],
      ["10.0.0", "9.0.0", false],
      ["9.10.0", "9.9.0", true],
    ];
    for (const [have, want, answer] of cases) expect(fits(have, want), `${have} for ${want}`).toBe(answer);
    // Each conflict comes in one error.
    const both = defineLanguage({ name: "user", version: "1.0.0", requires: { x: "1.0.0", y: "1.0.0" } });
    expect(() => compose(both)).toThrow(/^The merge has 2 conflicts\./);
  });
});
