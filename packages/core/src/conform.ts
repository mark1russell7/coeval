import { type Envelope, type Json, type Key, type TypeRef, docEquals, isEnvelope, isKey, typeName } from "./doc.ts";
import { type Cap, type Context, type Resolution, type ResolveOptions, resolve } from "./deref.ts";
import { type Result, describe, fail, ok, placed, thrown } from "./errors.ts";
import {
  type AllOptions,
  type Code,
  type CompileInput,
  type CompiledEvaluator,
  type CompiledPart,
  type CompiledRunner,
  type Effect,
  type EvalFn,
  type EvalInput,
  type Evaluator,
  type Machine,
  type Part,
  type Perform,
  type RunCode,
  type RunFn,
  type RunInput,
  type RunPart,
  type Runner,
  type Runtime,
  type Steps,
  capKeys,
  makeContext,
  permits,
  rootContext,
} from "./evaluate.ts";
import { type PartSlot, type Split, pathMatches, splitParts } from "./parts.ts";
import { type Definitions, STD_DEFINITIONS } from "./reference.ts";
import { STD_EVALUATORS } from "./stdlib.ts";
import { sameValue } from "./agree.ts";
import { type Random, random } from "./generate.ts";
import { scopesOf } from "./static.ts";
import { type Kind, type LazyRule, type Shape, type World, type WorldEntry, isKind, isNamespace, lookupKind } from "./world.ts";

/*
 * The conformance tests of one evaluator (K92, R7 P3, D36). `conforms` calls the code of one evaluator or runner
 * directly, without the kernel. It gives the code probe parts and a probe runtime. A probe part records each call, its
 * context and its order, and it gives a chosen result. The probe runtime records each resolution and each effect. The
 * checks compare these records with the contract of the kind and with the obligations C1 to C8 of SEMANTICS.md.
 */

/**
 * An obligation that `conforms` checks. `C1` to `C8` are the obligations of host code in `docs/SEMANTICS.md`. `local`
 * and `agree` are two premises of the simulation of the plan (SIM-PLAN).
 *
 * - `C1`: each context that the code gives a part, or an effect, has only the capabilities of its document.
 * - `C2`: the code causes only the effects that the contract of the kind declares.
 * - `C3`: each eager part evaluates when the result is a value, and a lazy part evaluates only when its result counts.
 * - `C4`: the code of a pure kind causes no effect, and it reads the context only through `resolve`.
 * - `C5`: the code reads its parts only through their handles, not through the JSON of the document.
 * - `C6`: only a runner waits, and a runner passes each wait of its parts and its effects through.
 * - `C7`: the code binds for a part each name that the scope rules give the part, and no other name.
 * - `C8`: compiled code gives the result of code that compiles again at the time of the evaluation.
 * - `local`: the code keeps no state from one call to the next.
 * - `agree`: compiled code gives the result of its definition for the reference interpreter.
 */
export type Obligation = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8" | "local" | "agree";

/** The probe of a finding: the document, the result of each probe part, the capabilities and the handler. */
export interface ConformProbe {
  /** The text of the type of the document. */
  readonly type: string;
  /** The document. A probe document takes the place of each part. */
  readonly doc: Envelope;
  /** The result of each probe part, by the key of the part. */
  readonly results: Readonly<Record<string, Result>>;
  /** The keys of the probe parts that wait for the host before they give their result. Only a run has them. */
  readonly waits: readonly string[];
  /** The capabilities of the context of the document. */
  readonly caps: readonly Cap[];
  /** `true` in a run, in which the host does each effect and a part can wait. */
  readonly running: boolean;
}

/** One obligation that the code breaks, with the reason and the first probe that shows it. */
export interface Finding {
  readonly obligation: Obligation;
  /** One or two sentences that tell what the code did. */
  readonly reason: string;
  readonly probe: ConformProbe;
}

/** The options of `conforms`. */
export interface ConformOptions {
  /**
   * The verb that the evaluator serves. The default is `eval`. The facts of a contract (`effects`, `pure` and `lazy`)
   * describe only `eval`, thus `conforms` checks C2, C3 and C4 only for `eval` (D23).
   */
  readonly verb?: string;
  /**
   * The types of the probe documents. The default is each kind of the world whose verb names the evaluator. A fallback
   * kind gives the key `probe`, for example `["ops", "probe"]`. The contract of the kind of each type applies.
   */
  readonly types?: readonly TypeRef[];
  /**
   * More values of probe documents, by the text of their type. A probe document takes the place of each part of such a
   * value. Use them for data that the code needs, for example the key of `write`.
   */
  readonly values?: Readonly<Record<string, readonly Json[]>>;
  /**
   * The results that a probe part can give. The default holds numbers, truth values, a text, `null`, a list, a
   * record, a function and two errors.
   */
  readonly results?: readonly Result[];
  /**
   * The definitional code of the compiled evaluators and runners, as for `reference`. A standard evaluator gets its
   * definition from `STD_DEFINITIONS`.
   */
  readonly definitions?: Definitions;
  /** The capabilities of half of the probes. The other half has none. The default is the declared effects and `probe`. */
  readonly caps?: readonly Cap[];
  /** The names of the context of each probe. */
  readonly names?: Readonly<Record<string, unknown>>;
  /** The seed of the random results. The same seed gives the same probes. The default is 1. */
  readonly seed?: number;
  /** The count of probes with random results for each probe document. The default is 12. */
  readonly runs?: number;
  /** The mock of the host (RUN.MOCK). It answers each effect at once. Without it, an effect gives its payload. */
  readonly perform?: Perform;
  /**
   * This function compares two values that the rules of `sameValue` do not know, as in `agree`.
   *
   * @param a - The first value.
   * @param b - The second value.
   * @returns `true` or `false`, or `undefined` for the rules of `sameValue`.
   */
  readonly equal?: (a: unknown, b: unknown) => boolean | undefined;
}

/** The order of the obligations in the list of findings. */
const ORDER: readonly Obligation[] = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "local", "agree"];

/** A function in the results of the probe parts. It gives the count of its arguments. */
const PROBE_FN = (...args: readonly unknown[]): number => args.length;

/** The arguments of a call of a function that a result gives. */
const PROBE_ARGS: readonly unknown[] = [1, 2];

/** The default results of the probe parts. */
const RESULTS: readonly Result[] = [
  { ok: true, value: 1 },
  { ok: true, value: 2 },
  { ok: true, value: true },
  { ok: true, value: false },
  { ok: true, value: "a" },
  { ok: true, value: null },
  { ok: true, value: [1, 2] },
  { ok: true, value: { a: 1 } },
  { ok: true, value: PROBE_FN },
  { ok: false, error: { code: "#VALUE!", reason: "The probe part fails." } },
  { ok: false, error: { code: "#N/A", reason: "The probe part has no value." } },
];

/** The result of a probe part without a chosen result. */
const NO_RESULT: Result = { ok: true, value: null };

/** The result of a runner that the probe driver stops. */
const STOPPED: Result = { ok: false, error: { code: "#CALC!", reason: "The probe driver stopped the runner." } };

/** The result of an item of `all` after a failure with `failFast`. */
const ABORTED: Result = { ok: false, error: { code: "#ABORT", reason: "The part stopped: a part before it failed, and the parts run with failFast." } };

/** The default names of the context of each probe. The generated names of a value (`a`, `b` and `c`) are other names. */
const NAMES: Readonly<Record<string, unknown>> = { x: "outer x", y: 2.5, z: ["outer"] };

/** The values of a document whose kind has no parts. */
const DATA: readonly Json[] = [1, "a", true, null, ["names", "x"], { a: 1 }, ["names", "y", "c"]];

/** The count of generated values of each type. */
const VARIANTS = 8;

/** The lengths of a generated list. */
const LENGTHS: readonly number[] = [2, 0, 1, 3];

/** The texts of generated data. */
const TEXTS: readonly string[] = ["a", "b", "c"];

/** The place of each probe document. */
const PLACE: readonly Key[] = [];

/** No capabilities: the context of half of the probes. */
const NO_CAPS: readonly Cap[] = [];

/** The code under test, in one of its four forms. */
type Under =
  | { readonly form: "eval"; readonly fn: EvalFn }
  | { readonly form: "compile"; readonly compile: (input: CompileInput) => Code }
  | { readonly form: "run"; readonly fn: RunFn }
  | { readonly form: "compileRun"; readonly compile: (input: CompileInput) => RunCode };

/** The split of a value that has the shape of its kind. */
type SplitOk = Extract<Split, { readonly ok: true }>;

/** One probe document, with what its contract tells about each part. */
interface Sample {
  readonly type: string;
  readonly typePath: readonly Key[];
  readonly kind: Kind;
  /** The document, with a probe document at the place of each part. */
  readonly doc: Envelope;
  readonly split: SplitOk;
  /** The same document with other JSON in each probe document (C5). */
  readonly other: Envelope;
  readonly otherSplit: SplitOk;
  /** `true` for each part that a lazy rule covers. */
  readonly lazy: readonly boolean[];
  /** The names that the scope rules give each part. */
  readonly names: readonly (readonly string[])[];
}

/** The results, the waits and the capabilities of one evaluation of a probe document. */
interface Scenario {
  readonly results: readonly Result[];
  readonly waits: readonly boolean[];
  readonly caps: readonly Cap[];
  readonly running: boolean;
}

/** One call of a probe part. */
interface Call {
  readonly part: number;
  /** The function that the code called: `evaluate` of a handle, or `code` or `run` of a compiled part. */
  readonly via: "evaluate" | "code" | "run";
  /** The context that the code gave the part. */
  readonly context: Context;
  /** `true` for a call in a function that the result gives, after the evaluation. */
  readonly later: boolean;
}

/** One effect that the code caused. */
interface Caused {
  readonly kind: string;
  readonly payload: unknown;
  readonly context: Context;
}

/** One resolution that the code asked for. */
interface Asked {
  readonly path: readonly unknown[];
  readonly found: Resolution;
}

/** One wait of a probe part or of an effect in a run. */
interface Wait {
  readonly what: string;
  readonly answer: unknown;
  /** `true` after the runner gave the promise to the driver. */
  seen: boolean;
  /** `true` after the probe got its answer. */
  done: boolean;
}

/** The state of `conforms` for one evaluator. */
interface Env {
  readonly machine: Machine;
  readonly name: string;
  readonly verb: string;
  readonly under: Under;
  readonly definition: Under | undefined;
  readonly runner: boolean;
  readonly results: readonly Result[];
  readonly names: Readonly<Record<string, unknown>>;
  readonly runs: number;
  readonly random: Random;
  readonly perform: Perform | undefined;
  readonly equal: ((a: unknown, b: unknown) => boolean | undefined) | undefined;
  readonly found: Map<Obligation, Finding>;
}

/** The facts of the kind of one type, as the contract and the hook `facts` of the machine give them. */
interface Contract {
  readonly declared: readonly Cap[];
  readonly pure: boolean;
  readonly lazy: readonly LazyRule[] | undefined;
  /** `true` when the facts describe the verb: they describe only `eval`. */
  readonly describes: boolean;
  readonly caps: readonly Cap[];
}

/**
 * The probe runtime of one evaluation, and its record. It records each call of a part, each effect and each
 * resolution. In a run, a probe part and an effect wait with a promise that the probe driver answers at once.
 */
class Shot implements Runtime {
  readonly calls: Call[] = [];
  readonly caused: Caused[] = [];
  readonly asked: Asked[] = [];
  /** The problems of the waits (C6). */
  readonly problems: string[] = [];
  readonly waits = new Map<Promise<unknown>, Wait>();
  /** The results of the calls of a function that the result gives. */
  readonly later: Result[] = [];
  result: Result = NO_RESULT;
  private afterwards = false;
  readonly running: boolean;

  constructor(
    readonly machine: Machine,
    /** `true` when the code under test is a runner. */
    readonly runner: boolean,
    readonly scenario: Scenario,
    /** The context of the document. */
    readonly context: Context,
    /** The key of each part, for the reasons. */
    readonly keys: readonly string[],
    private readonly perform: Perform | undefined,
    /** The resolutions of an earlier evaluation. Each resolution with the same path gets the same answer (C4). */
    private readonly replay: readonly Asked[] | undefined,
  ) {
    this.running = scenario.running;
  }

  resolve(ctx: Context, path: readonly unknown[], options?: ResolveOptions): Resolution {
    const old = this.replay?.[this.asked.length];
    const found = old !== undefined && docEquals(old.path, path) ? old.found : resolve(this.machine, ctx, path, options);
    this.asked.push({ path, found });
    return found;
  }

  /** This function records a call of a part, and gives the result that the probe part gives. */
  call(part: number, via: Call["via"], ctx: Context): Result {
    this.calls.push({ part, via, context: ctx, later: this.afterwards });
    const key = this.keys[part] ?? String(part);
    if (via === "run" && !this.runner) this.problems.push(`The code of an evaluator starts the steps of the part ${key}. Only a runner waits.`);
    if (via === "code" && this.runner && this.running) {
      this.problems.push(`The runner evaluates the part ${key} with its code, and that code cannot wait. A runner evaluates a part with its steps (K65).`);
    }
    return this.scenario.results[part] ?? NO_RESULT;
  }

  /** This function records a call of a part, and gives the steps of the probe part. In a run, the part can wait. */
  *steps(part: number, via: Call["via"], ctx: Context): Steps {
    const result = this.call(part, via, ctx);
    if (this.running && this.scenario.waits[part] === true) yield* this.wait(`the part ${this.keys[part] ?? String(part)}`);
    return result;
  }

  /** This function gives the steps of one wait. The probe driver answers the promise with a new object. */
  private *wait(what: string): Generator<Promise<unknown>, void, unknown> {
    const answer = { answer: what };
    const promise = new Promise<unknown>(() => undefined);
    const wait: Wait = { what, answer, seen: false, done: false };
    this.waits.set(promise, wait);
    const got = yield promise;
    wait.done = true;
    if (got !== answer) this.problems.push(`The runner gives ${what} another answer than the answer of the host.`);
  }

  effect(ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Result {
    const text = capKeys(kind).join(".");
    this.caused.push({ kind: text, payload, context: ctx });
    if (this.running) return fail("#CALC!", `The effect ${text} needs a runner: in a run, the host does each effect.`, { place });
    return this.answer(ctx, kind, payload, place);
  }

  *runEffect(ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Steps {
    const text = capKeys(kind).join(".");
    this.caused.push({ kind: text, payload, context: ctx });
    if (!this.runner) this.problems.push(`The code of an evaluator starts the steps of the effect ${text}. Only a runner waits.`);
    const answered = this.answer(ctx, kind, payload, place);
    if (!answered.ok || !this.running) return answered;
    yield* this.wait(`the effect ${text}`);
    return answered;
  }

  /** This function answers an effect as the kernel does: it checks the capability, and it asks the mock. */
  private answer(ctx: Context, kind: Cap, payload: unknown, place: readonly Key[]): Result {
    const keys = capKeys(kind);
    // The kernel keeps only the capabilities that the document permits (H-GRANT).
    const caps = ctx.caps.filter((cap) => permits(this.context.caps, cap));
    const allowed = this.machine.permits === undefined ? permits(caps, keys) : this.machine.permits(caps, keys, { ...ctx, caps });
    if (!allowed) return fail("#CAP!", `The context has no capability for the effect ${keys.join(".")}.`, { place });
    if (this.perform === undefined) return ok(payload);
    const effect: Effect = { index: this.caused.length - 1, kind: keys.join("."), path: keys, payload, node: -1, at: 0, place, context: { ...ctx, caps } };
    let answer: unknown;
    try {
      answer = this.perform(effect);
    } catch (error) {
      return placed(thrown(error, `the mock of the effect ${effect.kind}`), place);
    }
    if (!(answer instanceof Promise)) return ok(answer);
    void answer.catch(() => undefined);
    return fail("#CALC!", `The mock gave a promise for the effect ${effect.kind}, and an evaluation does not wait.`, { place });
  }

  *all(list: readonly (() => Steps)[], options: AllOptions = {}): Generator<Promise<unknown>, readonly Result[], unknown> {
    if (!this.runner) this.problems.push("The code of an evaluator starts the steps of all. Only a runner waits.");
    // The probe runtime starts the items one after the other. Each wait of an item passes through, as in the kernel.
    const results: Result[] = [];
    let failed = false;
    for (const begin of list) {
      if (failed) {
        results.push(ABORTED);
        continue;
      }
      let result: Result;
      try {
        result = yield* begin();
      } catch (error) {
        result = thrown(error, "a part");
      }
      results.push(result);
      if (options.failFast === true && !result.ok) failed = true;
    }
    return results;
  }

  keepsContext(): void {
    // The probe runtime records no reads, thus a closure needs no read of the roots.
  }

  /** This function starts a function that the result gives, with probe arguments. The calls of the parts are later calls. */
  callLater(): void {
    const result = this.result;
    if (!result.ok || typeof result.value !== "function") return;
    this.afterwards = true;
    try {
      this.later.push(ok((result.value as (...args: readonly unknown[]) => unknown)(...PROBE_ARGS)));
    } catch (error) {
      this.later.push(thrown(error, "the function of the result"));
    } finally {
      this.afterwards = false;
    }
  }
}

/** The code of one probe document, made one time. It evaluates the document in each shot. */
type Instance = (shot: Shot) => Result;

/** This function sets an own field, also the field `__proto__`. */
function setField(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function own<T>(table: Readonly<Record<string, T>> | undefined, name: string): T | undefined {
  return table !== undefined && Object.hasOwn(table, name) ? table[name] : undefined;
}

/** This function gives the form of an evaluator or of a runner. */
function underOf(code: Evaluator | Runner, runner: boolean): Under {
  if (runner) {
    if (typeof code === "function") return { form: "run", fn: code as RunFn };
    return { form: "compileRun", compile: (input) => (code as CompiledRunner).compileRun(input) };
  }
  if (typeof code === "function") return { form: "eval", fn: code as EvalFn };
  return { form: "compile", compile: (input) => (code as CompiledEvaluator).compile(input) };
}

function compiledForm(under: Under): boolean {
  return under.form === "compile" || under.form === "compileRun";
}

/** This function gives the definition of the code for the reference, when it has one that is other code. */
function definitionOf(machine: Machine, name: string, runner: boolean, definitions: Definitions | undefined): Under | undefined {
  if (runner) {
    const defined = own(definitions?.runners, name);
    return defined === undefined || defined === own(machine.runners, name) ? undefined : { form: "run", fn: defined };
  }
  const evaluator = own(machine.evaluators, name);
  const standard = evaluator !== undefined && evaluator === own(STD_EVALUATORS, name) ? own(STD_DEFINITIONS.evaluators, name) : undefined;
  const defined = own(definitions?.evaluators, name) ?? standard;
  return defined === undefined || defined === evaluator ? undefined : { form: "eval", fn: defined };
}

/** This function gives the type of each kind of the world whose verb names the evaluator. */
function typesNaming(world: World, name: string, verb: string): readonly TypeRef[] {
  const out: (readonly Key[])[] = [];
  const names = (kind: Kind | undefined): boolean => kind !== undefined && own(kind.verbs, verb) === name;
  const visit = (entries: Readonly<Record<string, WorldEntry>>, prefix: readonly Key[]): void => {
    for (const key of Object.keys(entries)) {
      const entry = entries[key];
      if (isKind(entry)) {
        if (names(entry)) out.push([...prefix, key]);
      } else if (isNamespace(entry)) {
        visit(entry.kinds, [...prefix, key]);
        if (names(entry.fallback)) out.push([...prefix, key, "probe"]);
      }
    }
  };
  visit(world.kinds, []);
  if (names(world.fallback)) out.push(["probe"]);
  return out;
}

/** This function gives the facts of the kind of a type. The hook `facts` of the machine wins over the contract. */
function contractOf(env: Env, kind: Kind, typePath: readonly Key[], caps: readonly Cap[] | undefined): Contract {
  const facts = env.machine.facts?.(typePath, env.name);
  const effects = kind.effects;
  const declared: readonly Cap[] = effects === undefined ? [] : effects === "type" ? [typePath] : effects;
  return {
    declared,
    pure: (facts?.pure ?? kind.pure) === true,
    lazy: facts?.lazy ?? kind.lazy,
    describes: env.verb === "eval",
    caps: caps ?? [...declared, "probe"],
  };
}

/** This function tells if a lazy rule covers the part with an index, as `factsOf` reads the rule. */
function covers(rule: LazyRule, slots: readonly PartSlot[], index: number): boolean {
  const matches = (slot: PartSlot): boolean => rule.in === undefined || rule.in.some((pattern) => pathMatches(slot.path, pattern));
  const slot = slots[index] as PartSlot;
  if (!matches(slot)) return false;
  const after = rule.after ?? 0;
  if (after <= 0) return true;
  let position = 0;
  for (let at = 0; at < index; at += 1) if (matches(slots[at] as PartSlot)) position += 1;
  return position >= after;
}

/** The counter of the probe documents of one value. */
interface Counter {
  next: number;
}

/** This function gives the JSON of a probe document. A position that permits only some kinds gets the first of them. */
function probeJson(counter: Counter, kinds: readonly (readonly Key[])[] | undefined, named: boolean): Json {
  const id = counter.next;
  counter.next += 1;
  const first = kinds?.[0];
  return { type: first === undefined ? "probe" : (first as readonly Json[]), value: { probe: id }, ...(named ? { name: `p${id}` } : {}) };
}

/** This function gives a number that a number shape permits. */
function numberIn(shape: Extract<Shape, { readonly shape: "number" }>, variant: number): number {
  const start = shape.min ?? (shape.max === undefined ? 1 : shape.max - 2);
  const base = shape.whole === true ? Math.ceil(start) : start;
  const value = base + (variant % 3);
  return shape.max !== undefined && value > shape.max ? shape.max : value;
}

/**
 * This function generates a value of a shape, with a probe document at the place of each part. The variant selects the
 * length of each list, the fields of a record that are absent, and the binding names of the probe documents.
 */
function valueOf(shape: Shape | undefined, variant: number, counter: Counter, named: boolean): Json {
  if (shape === undefined || shape.shape === "none") return DATA[variant % DATA.length] as Json;
  switch (shape.shape) {
    case "text":
      return TEXTS[variant % TEXTS.length] as string;
    case "number":
      return numberIn(shape, variant);
    case "one":
      return shape.values[variant % Math.max(1, shape.values.length)] ?? null;
    case "term":
      return probeJson(counter, shape.kinds, named);
    case "deep": {
      const pick = variant % 4;
      if (pick === 0) return [probeJson(counter, undefined, named)];
      if (pick === 1) return { a: probeJson(counter, undefined, named), b: [probeJson(counter, undefined, named)] };
      if (pick === 2) return ["names", probeJson(counter, undefined, named)];
      return ["names", "a"];
    }
    case "list": {
      const item: Shape = shape.item ?? { shape: "term", ...(shape.of === undefined ? {} : { of: shape.of }) };
      const length = LENGTHS[variant % LENGTHS.length] as number;
      // The index selects the data of each item, thus the items of a list of data are different.
      return Array.from({ length }, (_unused, index) => valueOf(item, item.shape === "term" ? variant : index, counter, named));
    }
    case "map": {
      const item: Shape = shape.item ?? { shape: "term", ...(shape.of === undefined ? {} : { of: shape.of }) };
      const out: Record<string, Json> = {};
      for (const key of TEXTS.slice(0, [2, 0, 1][variant % 3])) setField(out, key, valueOf(item, variant, counter, named));
      return out;
    }
    case "record": {
      const fields: Readonly<Record<string, Shape>> = Array.isArray(shape.fields)
        ? Object.fromEntries((shape.fields as readonly string[]).map((key) => [key, { shape: "term", ...(shape.of === undefined ? {} : { of: shape.of }) } as Shape]))
        : (shape.fields as Readonly<Record<string, Shape>>);
      const keys = Object.keys(fields);
      const required = new Set(shape.required ?? []);
      const optional = keys.filter((key) => !required.has(key));
      // The variant 0 has each field. Each other variant leaves out one optional field.
      const absent = variant === 0 || optional.length === 0 ? undefined : optional[(variant - 1) % optional.length];
      const out: Record<string, Json> = {};
      for (const key of keys) if (key !== absent) setField(out, key, valueOf(fields[key], variant, counter, named));
      return out;
    }
  }
}

/** This function gives the JSON of a probe document with other JSON: another value, and another type where it can. */
function otherJson(item: Json): Json {
  if (!isEnvelope(item)) return item;
  return { ...item, type: item.type === "probe" ? ["probe", "other"] : item.type, value: { other: [true, "json"], was: item.value } };
}

/** This function gives a probe document for a part of a value of the options. It keeps the type and the name of an envelope. */
function probeFor(counter: Counter, item: Json): Json {
  if (!isEnvelope(item)) return probeJson(counter, undefined, false);
  const id = counter.next;
  counter.next += 1;
  return { ...item, value: { probe: id } };
}

/** This function gives the probe documents of a type: generated values and the values of the options. */
function samplesOf(type: TypeRef, typePath: readonly Key[], kind: Kind, contract: Contract, extra: readonly Json[]): readonly Sample[] {
  const values: Json[] = [];
  for (let variant = 0; variant < VARIANTS; variant += 1) values.push(valueOf(kind.parts, variant, { next: 0 }, variant % 2 === 1));
  for (const value of extra) {
    const split = splitParts(kind.parts, value);
    if (!split.ok) continue;
    const counter: Counter = { next: 0 };
    values.push(split.fill(split.parts.map((slot) => probeFor(counter, slot.item))) as Json);
  }
  const out: Sample[] = [];
  const seen: Json[] = [];
  for (const value of values) {
    if (seen.some((other) => docEquals(other, value))) continue;
    seen.push(value);
    const split = splitParts(kind.parts, value);
    if (!split.ok) continue;
    const otherValue = split.parts.length === 0 ? value : (split.fill(split.parts.map((slot) => otherJson(slot.item))) as Json);
    const otherSplit = splitParts(kind.parts, otherValue);
    if (!otherSplit.ok || otherSplit.parts.length !== split.parts.length) continue;
    out.push({
      type: typeName(type),
      typePath,
      kind,
      doc: { type, value },
      split,
      other: { type, value: otherValue },
      otherSplit,
      lazy: split.parts.map((_slot, index) => contract.lazy?.some((rule) => covers(rule, split.parts, index)) === true),
      names: scopesOf(kind.scope, value, split.parts).sees,
    });
  }
  return out;
}

/** This function gives the handle fields of a part: its key, its path and its binding name. */
function handleOf(slot: PartSlot): { readonly key: string; readonly path: readonly Key[]; readonly name?: string } {
  const item = slot.item;
  const name = isEnvelope(item) && typeof (item as { readonly name?: unknown }).name === "string" ? (item as { readonly name: string }).name : undefined;
  return name === undefined ? { key: slot.key, path: slot.path } : { key: slot.key, path: slot.path, name };
}

/**
 * This function drives the steps of a runner. It answers each wait of a probe part or of an effect at once. A promise
 * that no probe gave, or a wait that the runner gives two times, stops the steps (C6).
 */
function drive(shot: Shot, steps: Steps): Result {
  let input: unknown;
  for (;;) {
    let step: IteratorResult<Promise<unknown>, Result>;
    try {
      step = steps.next(input);
    } catch (error) {
      return thrown(error, "the runner");
    }
    if (step.done === true) return step.value;
    const wait = shot.waits.get(step.value);
    if (wait === undefined || wait.seen) {
      shot.problems.push(
        wait === undefined
          ? "The runner yields a promise that no part and no effect gave. A runner passes on only the waits of its parts and its effects."
          : `The runner yields the wait of ${wait.what} two times.`,
      );
      if (step.value instanceof Promise) void step.value.catch(() => undefined);
      try {
        steps.return(STOPPED);
      } catch {
        // The finally code of the runner threw. The probe stops the runner.
      }
      return STOPPED;
    }
    wait.seen = true;
    input = wait.answer;
  }
}

/** This function ends one evaluation: it keeps the result, calls a function that the result gives, and finds the waits that the runner dropped. */
function finish(shot: Shot, start: () => Result, who: string): Result {
  let result: Result;
  try {
    result = placed(start(), PLACE);
  } catch (error) {
    result = placed(thrown(error, who), PLACE);
  }
  for (const wait of shot.waits.values()) if (!wait.done) shot.problems.push(`The runner drops the wait of ${wait.what}.`);
  shot.result = result;
  shot.callLater();
  return result;
}

/**
 * This function makes the code of one probe document. A compiler compiles the document one time, with compiled probe
 * parts. Each call of the code then evaluates the document in one shot.
 */
function instanceOf(env: Env, under: Under, doc: Envelope, split: SplitOk, sample: Sample): Instance {
  const fill = (items: readonly unknown[]): unknown => (split.parts.length === 0 ? doc.value : split.fill(items));
  const base = { kind: sample.type, typePath: sample.typePath, doc, data: split.data, place: PLACE, fill };
  const who = `the ${env.runner ? "runner" : "evaluator"} ${env.name}`;
  if (under.form === "eval" || under.form === "run") {
    if (under.form === "eval") {
      const fn = under.fn;
      return (shot) => {
        const ctx = shot.context;
        const parts: Part[] = split.parts.map((slot, index) => ({ ...handleOf(slot), evaluate: (given?: Context) => shot.call(index, "evaluate", given ?? ctx) }));
        const input: EvalInput = {
          ...base,
          value: fill(parts),
          parts,
          context: ctx,
          resolve: (path, options) => shot.resolve(ctx, path, options),
          effect: (kind, payload) => shot.effect(ctx, kind, payload, PLACE),
        };
        return finish(shot, () => fn(input), who);
      };
    }
    const fn = under.fn;
    return (shot) => {
      const ctx = shot.context;
      const parts: RunPart[] = split.parts.map((slot, index) => ({ ...handleOf(slot), evaluate: (given?: Context) => shot.steps(index, "evaluate", given ?? ctx) }));
      const input: RunInput = {
        ...base,
        value: fill(parts),
        parts,
        context: ctx,
        resolve: (path, options) => shot.resolve(ctx, path, options),
        effect: (kind, payload) => shot.runEffect(ctx, kind, payload, PLACE),
        all: (list, options) => shot.all(list.map((part) => () => part.evaluate()), options),
      };
      return finish(shot, () => drive(shot, fn(input)), who);
    };
  }
  // A compiled part finds the shot of the evaluation through this holder, because the parts exist before each shot.
  const holder: { shot: Shot | undefined } = { shot: undefined };
  const early = fail("#CALC!", "The compiler evaluated a part before an evaluation.");
  const parts: CompiledPart[] = split.parts.map((slot, index) => ({
    ...handleOf(slot),
    code: (ctx) => holder.shot?.call(index, "code", ctx) ?? early,
    *run(ctx) {
      const shot = holder.shot;
      return shot === undefined ? early : yield* shot.steps(index, "run", ctx);
    },
  }));
  const input: CompileInput = { ...base, value: fill(parts), parts, machine: env.machine };
  let made: Code | RunCode | Result;
  try {
    made = under.compile(input);
  } catch (error) {
    made = placed(thrown(error, who), PLACE);
  }
  const compiled = made;
  return (shot) => {
    holder.shot = shot;
    if (typeof compiled !== "function") return finish(shot, () => compiled, who);
    if (under.form === "compile") return finish(shot, () => (compiled as Code)(shot.context, shot), who);
    return finish(shot, () => drive(shot, (compiled as RunCode)(shot.context, shot)), who);
  };
}

/** This function evaluates a probe document one time in a new shot. */
function shoot(env: Env, instance: Instance, sample: Sample, scenario: Scenario, more: { readonly context?: Context; readonly replay?: readonly Asked[] } = {}): Shot {
  const context = more.context ?? rootContext(env.machine, makeContext(env.names, scenario.caps));
  const shot = new Shot(env.machine, env.runner, scenario, context, sample.split.parts.map((slot) => slot.key), env.perform, more.replay);
  instance(shot);
  return shot;
}

/** This function gives the scenarios of a probe document: each result of the palette in each part, then random results. */
function scenariosOf(env: Env, sample: Sample, contract: Contract, running: boolean): readonly Scenario[] {
  const count = sample.split.parts.length;
  const palette = env.results;
  const capsAt = (index: number): readonly Cap[] => (index % 2 === 0 ? contract.caps : NO_CAPS);
  const out: Scenario[] = [];
  const add = (results: readonly Result[], waits: readonly boolean[]): void => {
    out.push({ results, waits, caps: capsAt(out.length), running });
  };
  if (count === 0) {
    add([], []);
    add([], []);
    return out;
  }
  const all = Array.from({ length: count }, () => true);
  for (const result of palette) add(Array.from({ length: count }, () => result), all);
  for (let run = 0; run < env.runs; run += 1) {
    add(
      Array.from({ length: count }, () => env.random.pick(palette)),
      Array.from({ length: count }, () => env.random.chance(0.5)),
    );
  }
  return out;
}

/** This function gives a short text of a value for a reason. */
function valueText(value: unknown): string {
  if (typeof value === "function") return "a function";
  let text: string;
  try {
    text = JSON.stringify(value) ?? describe(value);
  } catch {
    text = describe(value);
  }
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

function resultText(result: Result): string {
  return result.ok ? `the value ${valueText(result.value)}` : `the error ${result.error.code}`;
}

function capsText(caps: readonly Cap[]): string {
  return caps.length === 0 ? "no capabilities" : `the capabilities ${caps.map((cap) => capKeys(cap).join(".")).join(", ")}`;
}

/** This function tells if two results agree, as in `agree`: the same value, or errors with the same code and place. */
function sameOutcome(a: Result, b: Result, equal: Env["equal"]): boolean {
  if (a.ok && b.ok) return sameValue(a.value, b.value, equal);
  if (a.ok || b.ok) return false;
  if (a.error.code !== b.error.code) return false;
  return a.error.place === undefined || b.error.place === undefined || docEquals(a.error.place as readonly Key[], b.error.place as readonly Key[]);
}

/** This function tells if two shots give the same result and the same results of a later call. */
function sameResults(a: Shot, b: Shot, equal: Env["equal"]): boolean {
  return sameOutcome(a.result, b.result, equal) && a.later.length === b.later.length && a.later.every((result, index) => sameOutcome(result, b.later[index] as Result, equal));
}

/**
 * This function gives the difference of two shots of the same probe, or `undefined` when they agree. Two shots agree
 * when they give the same results, use the parts in the same order and cause the same effects. Without `paths`, the
 * resolutions do not count, as in the simulation of the plan.
 */
function differs(a: Shot, b: Shot, equal: Env["equal"], paths = true): string | undefined {
  if (!sameOutcome(a.result, b.result, equal)) return `The first evaluation gives ${resultText(a.result)}, and the second gives ${resultText(b.result)}.`;
  if (!sameResults(a, b, equal)) return "The function that the result gives returns another result.";
  const order = (shot: Shot): string => shot.calls.map((call) => `${call.later ? "later " : ""}${shot.keys[call.part] ?? String(call.part)}`).join(", ");
  if (order(a) !== order(b)) return `The parts evaluate in another order: [${order(a)}] and [${order(b)}].`;
  const effects = (shot: Shot): string => shot.caused.map((effect) => effect.kind).join(", ");
  if (a.caused.length !== b.caused.length || a.caused.some((effect, index) => effect.kind !== b.caused[index]?.kind || !sameValue(effect.payload, b.caused[index]?.payload, equal))) {
    return `The effects differ: [${effects(a)}] and [${effects(b)}].`;
  }
  if (!paths) return undefined;
  const asked = (shot: Shot): string => shot.asked.map((each) => valueText(each.path)).join(", ");
  if (a.asked.length !== b.asked.length || a.asked.some((each, index) => !docEquals(each.path, b.asked[index]?.path))) return `The resolutions differ: [${asked(a)}] and [${asked(b)}].`;
  return undefined;
}

/** This function gives the probe of a finding. */
function probeOf(sample: Sample, scenario: Scenario, doc: Envelope = sample.doc): ConformProbe {
  const results: Record<string, Result> = {};
  sample.split.parts.forEach((slot, index) => setField(results, slot.key, scenario.results[index] ?? NO_RESULT));
  const waits = scenario.running ? sample.split.parts.filter((_slot, index) => scenario.waits[index] === true).map((slot) => slot.key) : [];
  return { type: sample.type, doc, results, waits, caps: scenario.caps, running: scenario.running };
}

/** This function keeps the first finding of each obligation. */
function report(env: Env, obligation: Obligation, reason: string, probe: () => ConformProbe): void {
  if (!env.found.has(obligation)) env.found.set(obligation, { obligation, reason, probe: probe() });
}

function thenable(value: unknown): boolean {
  return (typeof value === "object" || typeof value === "function") && value !== null && typeof (value as { readonly then?: unknown }).then === "function";
}

/** This function checks the record of one shot: the capabilities, the effects, the eager parts, the waits and the names. */
function checkShot(env: Env, sample: Sample, contract: Contract, scenario: Scenario, shot: Shot): void {
  const probe = (): ConformProbe => probeOf(sample, scenario);
  const docCaps = shot.context.caps;
  const keyOf = (part: number): string => shot.keys[part] ?? String(part);
  // C1: each context that the code gives a part or an effect has only the capabilities of its document.
  for (const call of shot.calls) {
    if (!call.context.caps.every((cap) => permits(docCaps, cap))) {
      report(env, "C1", `The code gives the part ${keyOf(call.part)} ${capsText(call.context.caps)}, and its document has ${capsText(docCaps)}.`, probe);
    }
  }
  for (const effect of shot.caused) {
    if (!effect.context.caps.every((cap) => permits(docCaps, cap))) {
      report(env, "C1", `The code gives its effect ${effect.kind} ${capsText(effect.context.caps)}, and its document has ${capsText(docCaps)}.`, probe);
    }
  }
  if (contract.describes) {
    // C2: only the declared effects.
    for (const effect of shot.caused) {
      if (!permits(contract.declared, effect.kind)) {
        report(env, "C2", `The code causes the effect ${effect.kind}, and the contract of ${sample.type} declares ${contract.declared.length === 0 ? "no effects" : capsText(contract.declared)}.`, probe);
      }
    }
    // C4: a pure kind causes no effect.
    const first = shot.caused[0];
    if (contract.pure && first !== undefined) report(env, "C4", `The kind ${sample.type} is pure, and the code causes the effect ${first.kind}.`, probe);
    // C3: each eager part evaluates when the result is a value.
    if (shot.result.ok) {
      sample.split.parts.forEach((_slot, index) => {
        if (sample.lazy[index] === true || shot.calls.some((call) => call.part === index && !call.later)) return;
        report(env, "C3", `The result is a value, and the code does not evaluate the part ${keyOf(index)}. No lazy rule of ${sample.type} covers the part.`, probe);
      });
    }
  }
  // C6: only a runner waits, and it passes each wait through.
  for (const problem of shot.problems) report(env, "C6", problem, probe);
  if (!env.runner && shot.result.ok && thenable(shot.result.value)) {
    report(env, "C6", "The code of an evaluator gives a promise. Only a runner waits, with the steps of its parts and its effects.", probe);
  }
  // C7: the names of each part are the names of the scope rules.
  const outer = shot.context.names;
  for (const call of shot.calls) {
    const given = call.context.names;
    const allowed = new Set(sample.names[call.part] ?? []);
    const bound = Object.keys(given).filter((key) => !Object.hasOwn(outer, key) || !Object.is(given[key], outer[key]));
    const extra = bound.filter((key) => !allowed.has(key));
    const lost = Object.keys(outer).filter((key) => !Object.hasOwn(given, key));
    const missing = [...allowed].filter((key) => !Object.hasOwn(given, key));
    const part = keyOf(call.part);
    if (extra.length > 0) {
      report(env, "C7", `The code binds ${extra.join(", ")} for the part ${part}, and the scope rules of ${sample.type} give it ${allowed.size === 0 ? "no names" : [...allowed].join(", ")}.`, probe);
    } else if (missing.length > 0) {
      report(env, "C7", `The scope rules of ${sample.type} give the part ${part} the names ${missing.join(", ")}, and the code does not bind them.`, probe);
    } else if (lost.length > 0) {
      report(env, "C7", `The part ${part} does not see the names ${lost.join(", ")} of its document.`, probe);
    }
  }
}

/**
 * This function gives a context with other values in each name and root that no resolution read (C4). The world and the
 * capabilities stay. A value that the code resolves keeps its value, because the list of reads holds that read.
 */
function variedContext(ctx: Context, asked: readonly Asked[]): Context {
  const read = new Set<string>();
  for (const { path } of asked) {
    const root = path[0];
    read.add(root === "names" && isKey(path[1]) ? `names.${String(path[1])}` : String(root));
  }
  const names: Record<string, unknown> = {};
  for (const key of Object.keys(ctx.names)) setField(names, key, read.has("names") || read.has(`names.${key}`) ? ctx.names[key] : { other: key });
  return { ...ctx, names, self: read.has("self") ? ctx.self : { other: "self" }, event: read.has("event") ? ctx.event : { other: "event" } };
}

/** This function examines one probe document with each check. */
function examine(env: Env, sample: Sample, contract: Contract): void {
  const { under } = env;
  const fresh = (): Instance => instanceOf(env, under, sample.doc, sample.split, sample);
  const scenarios = scenariosOf(env, sample, contract, false);
  const code = fresh();
  const first = scenarios.map((scenario) => shoot(env, code, sample, scenario));
  scenarios.forEach((scenario, index) => checkShot(env, sample, contract, scenario, first[index] as Shot));

  // local: the same code gives the same record in the other order of the probes.
  const second: Shot[] = new Array<Shot>(scenarios.length);
  for (let index = scenarios.length - 1; index >= 0; index -= 1) second[index] = shoot(env, code, sample, scenarios[index] as Scenario);
  let clean = true;
  scenarios.forEach((scenario, index) => {
    const why = differs(first[index] as Shot, second[index] as Shot, env.equal);
    if (why === undefined) return;
    clean = false;
    report(env, "local", `The code keeps state from one call to the next. The same probe gives another record in a later call. ${why}`, () => probeOf(sample, scenario));
  });
  // C8: code that compiles again at the time of the evaluation gives the same record.
  if (clean && compiledForm(under)) {
    scenarios.forEach((scenario, index) => {
      const why = differs(second[index] as Shot, shoot(env, fresh(), sample, scenario), env.equal);
      if (why === undefined) return;
      clean = false;
      report(env, "C8", `The code reads a table of the machine or of the profile when it compiles, and the answer changes later. The code of an earlier compilation and new code differ. ${why}`, () => probeOf(sample, scenario));
    });
  }
  // The other comparisons need code without state, because each of them evaluates the probes again.
  if (!clean) return;

  // C5: other JSON in each part, and the same results of the parts, give the same record.
  if (sample.split.parts.length > 0) {
    const other = instanceOf(env, under, sample.other, sample.otherSplit, sample);
    const again = compiledForm(under) ? fresh() : code;
    scenarios.forEach((scenario) => {
      const why = differs(shoot(env, again, sample, scenario), shoot(env, other, sample, scenario), env.equal);
      if (why !== undefined) report(env, "C5", `The code reads the JSON of its parts. Two documents whose parts have other JSON and the same results differ. ${why}`, () => probeOf(sample, scenario));
    });
  }

  if (contract.describes) {
    // C4: a pure kind gives the same record in a context with other values, when each resolution gives the same answer.
    if (contract.pure) {
      scenarios.forEach((scenario, index) => {
        const before = first[index] as Shot;
        const varied = shoot(env, code, sample, scenario, { context: variedContext(before.context, before.asked), replay: before.asked });
        const why = differs(before, varied, env.equal);
        if (why !== undefined) {
          report(env, "C4", `The kind ${sample.type} is pure, and the code reads the context outside resolve. Other values in the roots, with the same answers of resolve, change the record. ${why}`, () => probeOf(sample, scenario));
        }
      });
    }
    // C3: a lazy part evaluates only when its result counts.
    scenarios.forEach((scenario, index) => {
      const before = first[index] as Shot;
      const evaluated = new Set(before.calls.filter((call) => !call.later && sample.lazy[call.part] === true).map((call) => call.part));
      for (const part of evaluated) {
        const counts = env.results.some((result) => {
          if (result === scenario.results[part]) return false;
          const results = scenario.results.map((each, at) => (at === part ? result : each));
          return !sameResults(before, shoot(env, code, sample, { ...scenario, results }), env.equal);
        });
        if (!counts) {
          report(env, "C3", `The code evaluates the lazy part ${before.keys[part] ?? String(part)}, and no result of that part changes the result. A lazy part evaluates only when its result counts.`, () => probeOf(sample, scenario));
        }
      }
    });
  }

  // agree: the compiled code and its definition give the same record (the local lemma of SIM-PLAN).
  const definition = env.definition;
  if (definition !== undefined) {
    const defined = instanceOf(env, definition, sample.doc, sample.split, sample);
    scenarios.forEach((scenario, index) => {
      const why = differs(first[index] as Shot, shoot(env, defined, sample, scenario), env.equal, false);
      if (why !== undefined) report(env, "agree", `The code and its definition for the reference differ. ${why}`, () => probeOf(sample, scenario));
    });
  }

  // C6 and the other checks of one shot in a run: each probe part can wait.
  if (env.runner) {
    for (const scenario of scenariosOf(env, sample, contract, true)) checkShot(env, sample, contract, scenario, shoot(env, code, sample, scenario));
  }
}

/**
 * This function examines one evaluator or runner of a machine against the obligations of host code (K92, D36). It
 * starts the code directly, without the kernel, with probe parts and a probe runtime. It generates probe documents from
 * the contract of each kind that names the code, and it gives the probe parts chosen and random results.
 *
 * The checks follow the obligations C1 to C8 of `docs/SEMANTICS.md`. Two more checks follow the premises of the
 * simulation of the plan. The check `local` finds state that stays from one call to the next. The check `agree` compares
 * compiled code with its definition. The
 * finding of an obligation names the first probe that breaks it. An empty list means that each probe conforms.
 *
 * @param machine - The machine with the code and the world of the kinds.
 * @param name - The name of the evaluator or of the runner. A runner wins over an evaluator of the same name.
 * @param options - The verb, the types and the values of the probe documents, and the results of the probe parts. Also
 *   the definitions, the capabilities, the names, the seed, the mock and the rule of equality.
 * @returns The first finding of each obligation that the code breaks, in the order of the obligations.
 * @throws {Error} The machine has no code with the name, or no kind names it and the options give no types.
 */
export function conforms(machine: Machine, name: string, options: ConformOptions = {}): readonly Finding[] {
  const verb = options.verb ?? "eval";
  const runnerCode = own(machine.runners, name);
  const code = runnerCode ?? own(machine.evaluators, name);
  if (code === undefined) throw new Error(`The machine has no evaluator and no runner with the name ${name}.`);
  const runner = runnerCode !== undefined;
  const env: Env = {
    machine,
    name,
    verb,
    under: underOf(code, runner),
    definition: definitionOf(machine, name, runner, options.definitions),
    runner,
    results: options.results ?? RESULTS,
    names: options.names ?? NAMES,
    runs: options.runs ?? 12,
    random: random(options.seed ?? 1),
    perform: options.perform,
    equal: options.equal,
    found: new Map(),
  };
  const types = options.types ?? typesNaming(machine.world, name, verb);
  if (types.length === 0) throw new Error(`No kind of the world names ${name} for the verb ${verb}. Give the types of the probe documents in the option types.`);
  for (const type of types) {
    const found = lookupKind(machine.world, type);
    if (!found.ok) throw new Error(`The world has no kind for the type ${typeName(type)}.`);
    const contract = contractOf(env, found.kind, found.path, options.caps);
    const extra = own(options.values, typeName(type)) ?? own(options.values, found.path.join(".")) ?? [];
    for (const sample of samplesOf(type, found.path, found.kind, contract, extra)) examine(env, sample, contract);
  }
  return ORDER.filter((obligation) => env.found.has(obligation)).map((obligation) => env.found.get(obligation) as Finding);
}
