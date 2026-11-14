import { type Envelope, type Json, type Key, type TypeRef, docEquals, isEnvelope, isKey, isRecord, typeName } from "./doc.ts";
import {
  type Cap,
  type Context,
  type DerefCode,
  type HostThing,
  type Resolution,
  type ResolveOptions,
  type Thing,
  type WalkResult,
  type Walker,
  THING,
  derefStep,
  isHostThing,
  isRef,
  resolve,
  valueOfThing,
} from "./deref.ts";
import { type EvalError, type Result, describe, fail, isFailure, ok, placed, thrown } from "./errors.ts";
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
  intersectCaps,
  makeContext,
  permits,
  rootContext,
} from "./evaluate.ts";
import { type PartSlot, type Split, pathMatches, scopesOf, splitParts } from "./parts.ts";
import { type Definitions, STD_DEFINITIONS } from "./reference.ts";
import { STD_EVALUATORS } from "./stdlib.ts";
import { sameValue } from "./agree.ts";
import { type FormulaProfile, type ProfileReader, declaredTruthOf, profileReaderOf, signaturesOf } from "./formula.ts";
import { type ValueType, falseCovers, member, membersOf, typeIssues, typeText } from "./types.ts";
import { type Random, random } from "./generate.ts";
import { type Kind, type LazyRule, type Shape, type World, type WorldEntry, effectsOfVerb, isKind, isNamespace, lookupKind } from "./world.ts";

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
 * - `parallel`: the code gives the same result, the same parts and the same effects in each order of the waits of
 *   `all` (D128). Only a runner gets this check.
 * - `truth`: the own `truthy` of a formula profile gives `true` or `false` for each member of its `truthType` (D86).
 *   Only `formula.if`, `formula.and` and `formula.or` of the formula kit get this check.
 * - `cover`: each sample of a covered domain of the machine is in one domain of each cover of the domain (D94). Each
 *   evaluator and each runner gets this check, because `fits` trusts the covers for each program.
 * - `result`: a walker, the code of a `deref` or a function of a profile gives the form that its type states. A walker
 *   and the code of a `deref` throw nothing, except a `Failure` (D137).
 * - `ladder`: a walker steps on a host thing only through `deref` and `has` of its input (D137).
 * - `hops`: each `visit` of a walker tells a step that the walk followed. Without `visit`, the walk stays the same (D137).
 * - `has`: the function `has` of the code of a `deref` gives a truth, and `true` for each key that the code answers (D137).
 * - `typed`: a walker keeps its type rule, an operation its signatures and an extension its entry in `extTypes` (D137).
 */
export type Obligation = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8" | "local" | "agree" | "parallel" | "truth" | "cover" | "result" | "ladder" | "hops" | "has" | "typed";

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
  /** The thing before the step, in a finding of a walker. */
  readonly here?: unknown;
  /** The key of the step, in a finding of the code of a `deref`. */
  readonly key?: Key;
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
   * The verb that the evaluator serves. The default is `eval`. The facts `pure` and `lazy` of a contract describe only
   * `eval`, thus `conforms` checks C3 and C4 only for `eval` (D23). `conforms` checks C2 for each verb that the
   * contract declares effects for: `eval`, and each verb with an entry in `verbEffects` (D49).
   *
   * The verb `step` selects the walker of the name, and the verb `deref` selects the code of the `deref` of the name
   * (D137). Without the option, a name that no evaluator and no runner has selects its walker, and then its `deref`.
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
  /**
   * More things before the step of a walker (D137). Use them for the things that a walker needs, for example a host
   * thing of the language. The default holds three probe nodes, a document, `undefined` and the values of the results.
   */
  readonly things?: readonly unknown[];
  /** The capabilities of half of the probes. The other half has none. The default is the declared effects and `probe`. */
  readonly caps?: readonly Cap[];
  /** The names of the context of each probe. */
  readonly names?: Readonly<Record<string, unknown>>;
  /** The seed of the random results and of the orders of `all`. The same seed gives the same probes. The default is 1. */
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
const ORDER: readonly Obligation[] = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "local", "agree", "parallel", "truth", "cover", "result", "ladder", "hops", "has", "typed"];

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

/** The order of the waits of one evaluation: this function gives the index of the next wait in the list of the waits of `all`. */
type Pick = (waiting: number) => number;

/** The waits settle in the order that they began. Each shot uses this order first. */
const FORWARD: Pick = () => 0;

/** The waits settle in the other order: the last wait that began settles first. */
const BACKWARD: Pick = (waiting) => waiting - 1;

/** The count of orders from the seed of a probe document, for each scenario with a choice (D128). */
const SEEDED_ORDERS = 4;

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
  /** `true` for each part that a rule `drives` covers: the runner can evaluate it with its code (D119). */
  readonly driven: readonly boolean[];
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

/** The state of `conforms` that each form of code needs. */
interface BaseEnv {
  readonly machine: Machine;
  readonly name: string;
  readonly verb: string;
  readonly results: readonly Result[];
  readonly names: Readonly<Record<string, unknown>>;
  readonly equal: ((a: unknown, b: unknown) => boolean | undefined) | undefined;
  readonly found: Map<Obligation, Finding>;
}

/** The state of `conforms` for one evaluator. */
interface Env extends BaseEnv {
  readonly under: Under;
  readonly definition: Under | undefined;
  readonly runner: boolean;
  readonly runs: number;
  readonly random: Random;
  /** The option `seed`. With the text of a probe document, it gives the orders of the waits of `all` (D128). */
  readonly seed: number;
  readonly perform: Perform | undefined;
}

/** The facts of the kind of one type, as the contract and the hook `facts` of the machine give them. */
interface Contract {
  readonly declared: readonly Cap[];
  readonly pure: boolean;
  /** `true` when the results of the code can change while its input stays the same (FACTS.VOLATILE). */
  readonly volatile: boolean;
  readonly lazy: readonly LazyRule[] | undefined;
  /** The parts that the runner evaluates with its code, without a wait (RUN.DRIVES). */
  readonly drives: readonly LazyRule[] | undefined;
  /** `true` when the facts describe the verb: they describe only `eval`. */
  readonly describes: boolean;
  /** `true` when the contract declares the effects of the verb: for `eval`, and for a verb in `verbEffects`. */
  readonly declares: boolean;
  readonly caps: readonly Cap[];
}

/**
 * The probe runtime of one evaluation, and its record. It records each call of a part, each effect and each
 * resolution. In a run, a probe part and an effect wait with a promise that the probe driver answers at once.
 */
class Shot implements Runtime {
  readonly machine: Machine;
  /** `true` when the code under test is a runner. */
  readonly runner: boolean;
  readonly scenario: Scenario;
  /** The context of the document. */
  readonly context: Context;
  /** The key of each part, for the reasons. */
  readonly keys: readonly string[];
  /** `true` for each part that the runner can evaluate with its code, by the rules `drives` (D119). */
  private readonly driven: readonly boolean[];
  private readonly perform: Perform | undefined;
  /** The resolutions of an earlier evaluation. Each resolution with the same path gets the same answer (C4). */
  private readonly replay: readonly Asked[] | undefined;
  /** The order of the waits of `all`. */
  private readonly pick: Pick;
  readonly calls: Call[] = [];
  readonly caused: Caused[] = [];
  readonly asked: Asked[] = [];
  /** The problems of the waits (C6). */
  readonly problems: string[] = [];
  readonly waits = new Map<Promise<unknown>, Wait>();
  /** The results of the calls of a function that the result gives. */
  readonly later: Result[] = [];
  /** The waits of each `all`, in the order that they settled. */
  readonly settled: string[] = [];
  /** The count of the times that `all` selected one wait from two or more. Without a choice, each order gives this shot. */
  choices = 0;
  /** `true` when a failure with `failFast` stopped an `all`. Which items stop then depends on the order (RUN.ALL). */
  stopped = false;
  result: Result = NO_RESULT;
  private afterwards = false;
  readonly running: boolean;

  constructor(
    machine: Machine,
    runner: boolean,
    scenario: Scenario,
    context: Context,
    keys: readonly string[],
    driven: readonly boolean[],
    perform: Perform | undefined,
    replay: readonly Asked[] | undefined,
    pick: Pick,
  ) {
    this.machine = machine;
    this.runner = runner;
    this.scenario = scenario;
    this.context = context;
    this.keys = keys;
    this.driven = driven;
    this.perform = perform;
    this.replay = replay;
    this.pick = pick;
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
    if (via === "code" && this.runner && this.running && this.driven[part] !== true) {
      this.problems.push(`The runner evaluates the part ${key} with its code, and that code cannot wait. A runner evaluates a part with its steps, or its contract declares the part in drives (D119).`);
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
    // The kernel keeps the capabilities that both the context and the document permit (H-GRANT, CAP.MEET).
    const caps = intersectCaps(ctx.caps, this.context.caps);
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

  /**
   * This function is the rule ALL of the kernel, with the order of `pick` in place of the order of the host. The items
   * start in their order up to the limit. Each item goes on to its first wait, and the chosen wait resumes its item.
   */
  *all(list: readonly (() => Steps)[], options: AllOptions = {}): Generator<Promise<unknown>, readonly Result[], unknown> {
    if (!this.runner) this.problems.push("The code of an evaluator starts the steps of all. Only a runner waits.");
    const results: Result[] = new Array<Result>(list.length);
    const limit = Math.max(1, options.concurrency ?? list.length);
    const failFast = options.failFast === true;
    interface Active {
      readonly index: number;
      readonly steps: Steps;
      readonly pending: Promise<unknown>;
    }
    const active: Active[] = [];
    let next = 0;
    let failed = false;
    const settle = (index: number, result: Result): void => {
      results[index] = result;
      if (failFast && !result.ok) failed = true;
    };
    const advance = (index: number, steps: Steps, input: unknown): void => {
      let step: IteratorResult<Promise<unknown>, Result>;
      try {
        step = steps.next(input);
      } catch (error) {
        settle(index, thrown(error, "a part"));
        return;
      }
      if (step.done === true) settle(index, step.value);
      else active.push({ index, steps, pending: step.value });
    };
    const start = (): void => {
      while (!failed && active.length < limit && next < list.length) {
        const index = next;
        next += 1;
        try {
          advance(index, (list[index] as () => Steps)(), undefined);
        } catch (error) {
          settle(index, thrown(error, "a part"));
        }
      }
    };
    try {
      start();
      while (active.length > 0 && !failed) {
        if (active.length > 1) this.choices += 1;
        const [item] = active.splice(this.pick(active.length), 1) as [Active];
        const wait = this.waits.get(item.pending);
        if (wait !== undefined) this.settled.push(wait.what);
        const input: unknown = yield item.pending;
        advance(item.index, item.steps, input);
        start();
      }
    } finally {
      // An item that stops gives up its wait, as in the kernel. The probe also stops the items of an `all` that stops.
      for (const item of active) {
        const wait = this.waits.get(item.pending);
        if (wait !== undefined) wait.done = true;
        try {
          item.steps.return(ABORTED);
        } catch {
          // The finally code of a part threw. The part stops with the abort.
        }
      }
    }
    if (failed) this.stopped = true;
    for (let index = 0; index < list.length; index += 1) results[index] ??= ABORTED;
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
function contractOf(env: BaseEnv, kind: Kind, typePath: readonly Key[], caps: readonly Cap[] | undefined): Contract {
  const facts = env.machine.facts?.(typePath, env.name);
  // A verb without a declaration keeps the effects of eval for the capabilities of the probes, as before D49.
  // For eval, the effects of the answer of the hook win over the contract, as in check (D118).
  const own = (env.verb === "eval" ? facts?.effects : undefined) ?? effectsOfVerb(kind, env.verb);
  const effects = own ?? kind.effects;
  const declared: readonly Cap[] = effects === undefined ? [] : effects === "type" ? [typePath] : effects;
  return {
    declared,
    pure: (facts?.pure ?? kind.pure) === true,
    volatile: (facts?.volatile ?? kind.volatile) === true,
    lazy: facts?.lazy ?? kind.lazy,
    drives: env.verb === "eval" ? (facts?.drives ?? kind.drives) : undefined,
    describes: env.verb === "eval",
    declares: own !== undefined,
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
      driven: split.parts.map((_slot, index) => contract.drives?.some((rule) => covers(rule, split.parts, index)) === true),
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
  const base = { kind: sample.type, typePath: sample.typePath, doc, data: split.data, place: PLACE, machine: env.machine, fill };
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
      const parts: RunPart[] = split.parts.map((slot, index) => ({ ...handleOf(slot), evaluate: (given?: Context) => shot.steps(index, "evaluate", given ?? ctx), handled: () => shot.steps(index, "evaluate", ctx) }));
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
function shoot(env: Env, instance: Instance, sample: Sample, scenario: Scenario, more: { readonly context?: Context; readonly replay?: readonly Asked[]; readonly pick?: Pick } = {}): Shot {
  const context = more.context ?? rootContext(env.machine, makeContext(env.names, scenario.caps));
  const shot = new Shot(env.machine, env.runner, scenario, context, sample.split.parts.map((slot) => slot.key), sample.driven, env.perform, more.replay, more.pick ?? FORWARD);
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

/** This function tells if two lists of effects hold the same effects. Under `all`, the order follows the host (X-RECORD). */
function sameEffects(a: readonly Caused[], b: readonly Caused[], equal: Env["equal"]): boolean {
  const left = [...b];
  return (
    a.length === b.length &&
    a.every((effect) => {
      const at = left.findIndex((other) => other.kind === effect.kind && sameValue(effect.payload, other.payload, equal));
      if (at >= 0) left.splice(at, 1);
      return at >= 0;
    })
  );
}

/**
 * This function gives the difference of two shots of one probe in two orders of the waits, or `undefined` when they
 * agree (D128). Two orders agree when they give the same results, use the same parts and cause the same effects. The
 * order of the parts and of the effects does not count, because it follows the host. The resolutions do not count, as
 * in the simulation of the plan.
 */
function differsByOrder(a: Shot, b: Shot, equal: Env["equal"]): string | undefined {
  if (!sameOutcome(a.result, b.result, equal)) return `The first order gives ${resultText(a.result)}, and the second gives ${resultText(b.result)}.`;
  if (!sameResults(a, b, equal)) return "The function that the result gives returns another result.";
  const parts = (shot: Shot): string =>
    shot.calls
      .map((call) => `${call.later ? "later " : ""}${shot.keys[call.part] ?? String(call.part)}`)
      .sort()
      .join(", ");
  if (parts(a) !== parts(b)) return `The parts that evaluate differ: [${parts(a)}] and [${parts(b)}].`;
  if (sameEffects(a.caused, b.caused, equal)) return undefined;
  const effects = (shot: Shot): string => shot.caused.map((effect) => `${effect.kind} ${valueText(effect.payload)}`).join(", ");
  return `The effects differ: [${effects(a)}] and [${effects(b)}].`;
}

/**
 * This function gives the seed of the orders of a probe document (FNV-1a of its JSON). No time goes into it (D128).
 * The home of a hash for seeds is `@mark1russell7/rigor-generators`. This copy stays here because core has no dependencies.
 */
function orderSeed(doc: Envelope, seed: number): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (const unit of JSON.stringify(doc)) hash = Math.imul(hash ^ (unit.codePointAt(0) as number), 16777619) >>> 0;
  return hash;
}

/** This function gives the probe of a finding. */
function probeOf(sample: Sample, scenario: Scenario, doc: Envelope = sample.doc): ConformProbe {
  const results: Record<string, Result> = {};
  sample.split.parts.forEach((slot, index) => setField(results, slot.key, scenario.results[index] ?? NO_RESULT));
  const waits = scenario.running ? sample.split.parts.filter((_slot, index) => scenario.waits[index] === true).map((slot) => slot.key) : [];
  return { type: sample.type, doc, results, waits, caps: scenario.caps, running: scenario.running };
}

/** This function keeps the first finding of each obligation. */
function report(env: BaseEnv, obligation: Obligation, reason: string, probe: () => ConformProbe): void {
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
  if (contract.declares) {
    // C2: only the declared effects of the verb (VERB.EFFECTS).
    for (const effect of shot.caused) {
      if (!permits(contract.declared, effect.kind)) {
        report(env, "C2", `The code causes the effect ${effect.kind}, and the contract of ${sample.type} declares ${contract.declared.length === 0 ? "no effects" : capsText(contract.declared)}${env.verb === "eval" ? "" : ` for the verb ${env.verb}`}.`, probe);
      }
    }
  }
  if (contract.describes) {
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
    const seeded = random(orderSeed(sample.doc, env.seed));
    const pickSeeded: Pick = (waiting) => seeded.int(waiting);
    for (const scenario of scenariosOf(env, sample, contract, true)) {
      const forward = shoot(env, code, sample, scenario);
      checkShot(env, sample, contract, scenario, forward);
      // parallel: a shot with a choice runs again in the other orders (D128). Each order also gets the checks of one shot.
      if (forward.choices === 0) continue;
      for (const pick of [BACKWARD, ...Array.from({ length: SEEDED_ORDERS }, () => pickSeeded)]) {
        const other = shoot(env, code, sample, scenario, { pick });
        checkShot(env, sample, contract, scenario, other);
        // The first failure with failFast stops other items in another order. That difference is the rule ALL.
        if (forward.stopped || other.stopped) continue;
        const why = differsByOrder(forward, other, env.equal);
        if (why === undefined) continue;
        const orders = `the order [${forward.settled.join(", ")}] and the order [${other.settled.join(", ")}]`;
        report(env, "parallel", `The code of ${sample.type} depends on the order of its parallel parts. The waits of all settle in ${orders}. ${why}`, () => probeOf(sample, scenario));
      }
    }
  }
}

/**
 * This function checks the declared truth of a profile (D86). The function `truthy` must give `true` or `false` for
 * each member of `truthType`, and it must not throw. The members come from the lists `values` of the domains of the
 * type. A type without such a list gets its members from the results of the palette and from the samples of the
 * domains (D99).
 */
function checkTruth(env: Env, code: unknown, probe: (value: unknown) => ConformProbe): void {
  const truth = declaredTruthOf(code);
  if (truth === undefined) return;
  const domains = env.machine.domains;
  // The check gives an issue for a bad type, and it then needs nothing of a test (D81).
  if (typeIssues(truth.truthType, domains).length > 0) return;
  const samples = env.results.flatMap((result) => (result.ok ? [result.value] : []));
  const of = (value: unknown): string => `the member ${valueText(value)} of the truth type ${typeText(truth.truthType)}`;
  for (const value of membersOf(truth.truthType, domains, samples)) {
    let given: unknown;
    try {
      given = truth.truthy(value);
    } catch (error) {
      report(env, "truth", `The function truthy of the profile throws for ${of(value)}: ${describe(error)}`, () => probe(value));
      return;
    }
    if (typeof given === "boolean") continue;
    const what = given === undefined ? "no truth" : valueText(given);
    report(env, "truth", `The function truthy of the profile gives ${what} for ${of(value)}. A truth is true or false.`, () => probe(value));
    return;
  }
}

/**
 * This function checks the covers of the domains of the machine from samples (D94). Each sample of a covered domain
 * must be in one domain of each valid cover. The samples of a domain come from its list `values`. A domain without
 * that list gets its members from the palette and from the samples of the domains, as for the check `truth`.
 */
function checkCovers(env: Env, probe: (value: unknown) => ConformProbe): void {
  const domains = env.machine.domains;
  if (domains === undefined) return;
  const palette = env.results.flatMap((result) => (result.ok ? [result.value] : []));
  const samples: Record<string, readonly unknown[]> = {};
  for (const [name, domain] of Object.entries(domains)) if (domain.covers !== undefined) samples[name] = membersOf(name, domains, palette);
  const found = falseCovers(domains, samples)[0];
  if (found === undefined) return;
  report(
    env,
    "cover",
    `The member ${valueText(found.value)} of the domain ${found.domain} is in no domain of its cover ${found.cover.join(", ")}. The check of types trusts the cover, thus it is unsound for ${found.domain}.`,
    () => probe(found.value),
  );
}

/** The code of the verb `step` or `deref` that `conforms` examines (D137). */
type StepCode = { readonly verb: "step"; readonly code: Walker } | { readonly verb: "deref"; readonly code: DerefCode };

/** The keys of each probe of the code of a `deref`. The keys of a record value come after them. */
const STEP_KEYS: readonly Key[] = ["a", "x", "length", 0, "missing"];

/** The most lists of arguments that one signature gets. */
const MAX_ARGUMENTS = 64;

/** One step of a walk through the input: the key, and what the input gave. */
interface Stepped {
  readonly key: Key;
  readonly thing: Thing;
}

/** The record of the reads of the probe nodes. A read while `open` is `false` skips the input of the walker. */
interface Gate {
  open: boolean;
  direct: Key[];
}

/** The record of one call of a walker. */
interface Walked {
  /** The result of the walk, as the rule R-WALKER reads it. A throw gives its error. */
  readonly outcome: Result;
  /** The text of a throw or of a wrong form. */
  readonly problem: string | undefined;
  readonly steps: readonly Stepped[];
  /** The key of each `visit` that names no step of the input. */
  readonly stray: readonly Key[];
  readonly direct: readonly Key[];
}

/** One probe of a walker, and its first walk. */
interface Trial {
  readonly input: { readonly data: Json; readonly here: Thing; readonly context: Context };
  readonly probe: () => ConformProbe;
  readonly first: Walked;
}

/** This function makes a host thing whose fields are probe values. The gate gets each read outside the input of a walker. */
function probeNode(gate: Gate, label: string, type: string | undefined, fields: Readonly<Record<string, Thing>>): HostThing {
  const read = (key: Key): boolean => {
    if (!gate.open) gate.direct.push(key);
    return Object.hasOwn(fields, String(key));
  };
  const node: HostThing & { readonly type: string | undefined } = { [THING]: true, label, type, deref: (key) => (read(key) ? fields[String(key)] : undefined), has: read, toJson: () => ({ node: label }) };
  return node;
}

/** This function gives the things before a step: a leaf and its two parents, a document, `undefined` and the values of the results. */
function probeThings(gate: Gate, results: readonly Result[]): readonly Thing[] {
  const root = probeNode(gate, "the root", undefined, { a: 1 });
  const middle = probeNode(gate, "the middle", "panel", { parent: root, names: { a: "named" } });
  const leaf = probeNode(gate, "the leaf", "box", { parent: middle, x: undefined });
  return [leaf, middle, root, { type: "probe", value: { a: 1 } }, undefined, ...results.flatMap((result) => (result.ok ? [result.value] : []))];
}

/** This function gives a context for a walker. A frozen context refuses a write to its capabilities, its names and its roots. */
function stepContext(machine: Machine, ctx: Context): Context {
  return Object.freeze({ ...rootContext(machine, ctx), names: Object.freeze({ ...ctx.names }), caps: Object.freeze([...ctx.caps]) });
}

/** This function calls host code. A `Failure` gives its error (E-THROW). Each other throw also gives the text of the throw. */
function attempt<T>(call: () => T, who: string): { readonly result: Result<T>; readonly threw: string | undefined } {
  try {
    return { result: ok(call()), threw: undefined };
  } catch (error) {
    return { result: thrown(error, who), threw: isFailure(error) ? undefined : describe(error) };
  }
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isErrorCode(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("#");
}

function isEvalError(value: unknown): value is EvalError {
  return isObject(value) && isErrorCode(value["code"]) && typeof value["reason"] === "string";
}

function isResult(value: unknown): value is Result {
  return isObject(value) && (value["ok"] === true ? Object.hasOwn(value, "value") : value["ok"] === false && isEvalError(value["error"]));
}

function isWalkResult(value: unknown): value is WalkResult {
  if (!isObject(value)) return false;
  if (value["ok"] === true) return Object.hasOwn(value, "thing");
  return value["ok"] === false && typeof value["reason"] === "string" && (value["code"] === undefined || isErrorCode(value["code"]));
}

/** This function starts a walker one time, with `visit` when `hops` is `true`. */
function walkOnce(env: BaseEnv, walker: Walker, gate: Gate, input: Trial["input"], hops: boolean): Walked {
  const steps: Stepped[] = [];
  const stray: Key[] = [];
  const direct: Key[] = [];
  gate.direct = direct;
  const adopt = env.machine.adopt ?? ((value: unknown): Thing => value);
  const ladder = (thing: Thing, key: Key): ReturnType<typeof derefStep> => {
    gate.open = true;
    try {
      return derefStep(env.machine, thing, key);
    } finally {
      gate.open = false;
    }
  };
  const visit = (key: Key, thing: Thing): void => {
    if (!steps.some((step) => String(step.key) === String(key) && Object.is(step.thing, thing))) stray.push(key);
  };
  const deref = (thing: Thing, key: Key): Thing => {
    const reached = ladder(thing, key);
    const given = reached === undefined ? undefined : adopt(reached.thing);
    steps.push({ key, thing: given });
    return given;
  };
  const has = (thing: Thing, key: Key): boolean => ladder(thing, key) !== undefined;
  const tried = attempt(() => walker({ ...input, deref, has, ...(hops ? { visit } : {}) }), `the walker ${env.name}`);
  const close = (outcome: Result, problem: string | undefined): Walked => ({ outcome, problem, steps, stray, direct });
  if (!tried.result.ok) return close(tried.result, tried.threw === undefined ? undefined : `throws: ${tried.threw}`);
  const given: unknown = tried.result.value;
  if (!isWalkResult(given)) return close(fail("#CALC!", "The walker gives no result."), `gives ${valueText(given)}, and a walker gives a thing or the reason of a failure,`);
  return close(given.ok ? ok(given.thing) : fail(given.code ?? "#N/A", given.reason), undefined);
}

/** This function gives the difference of two walks with one input, or `undefined` when they agree. */
function walkDiffers(a: Walked, b: Walked, equal: BaseEnv["equal"]): string | undefined {
  if (!sameOutcome(a.outcome, b.outcome, equal)) return `The first walk gives ${resultText(a.outcome)}, and the second gives ${resultText(b.outcome)}.`;
  const keys = (walked: Walked): string => walked.steps.map((step) => String(step.key)).join(", ");
  return keys(a) === keys(b) ? undefined : `The steps differ: [${keys(a)}] and [${keys(b)}].`;
}

function thingText(thing: Thing): string {
  return isHostThing(thing) ? thing.label : valueText(thing);
}

/** This function gives the value type of a thing for the rule of a walker. A JSON value has its plain type, and each other thing has `unknown`. */
function plainType(thing: Thing): ValueType {
  if (isHostThing(thing)) return "unknown";
  if (typeof thing === "number") return "number";
  if (typeof thing === "boolean") return "bool";
  if (typeof thing === "string") return "text";
  if (thing === null || thing === undefined) return String(thing);
  if (Array.isArray(thing)) return { list: "unknown" };
  if (!isRecord(thing)) return "unknown";
  return { record: Object.fromEntries(Object.keys(thing).map((key) => [key, plainType(thing[key])])) };
}

/** This function checks the type rule of a walker on one walk, from the type `unknown` and from the plain type of the thing (TYPE.WALKER). */
function checkWalkType(env: BaseEnv, walker: Walker, sample: Sample, data: Json, trial: Trial): void {
  const rule = walker.type;
  const outcome = trial.first.outcome;
  // A step document with parts has no rule, and a path follows a reference that the walker reaches.
  if (rule === undefined || sample.split.parts.length > 0 || !outcome.ok || isRef(outcome.value)) return;
  const domains = env.machine.domains;
  for (const type of ["unknown", plainType(trial.input.here)]) {
    const reached = attempt(() => rule({ data, here: type }), "the type rule").result;
    // A rule that throws, or a bad type, is a type issue of the check (TYPE.RULE).
    if (!reached.ok || typeIssues(reached.value, domains).length > 0) continue;
    const value = valueOfThing(outcome.value);
    if (member(value, reached.value, domains)) continue;
    report(env, "typed", `The walker ${env.name} reaches ${valueText(value)} from ${thingText(trial.input.here)} of the type ${typeText(type)}, and its type rule gives ${typeText(reached.value)}.`, trial.probe);
    return;
  }
}

/** This function gives the probe of a finding of a walker or of the code of a `deref`. */
function stepProbe(sample: Sample, caps: readonly Cap[], at: { readonly here: unknown } | { readonly key: Key }): ConformProbe {
  return { type: sample.type, doc: sample.doc, results: {}, waits: [], caps, running: false, ...at };
}

/** This function examines one walker on one step document, from each thing. */
function examineWalker(env: BaseEnv, walker: Walker, gate: Gate, things: readonly Thing[], sample: Sample, contract: Contract): void {
  // A step document with parts gets the values of its parts (FORMULA.STEPS).
  const { parts, fill } = sample.split;
  const data = (parts.length === 0 ? sample.doc.value : fill(parts.map(() => 1))) as Json;
  const trials = things.map((here, index): Trial => {
    const input = { data, here, context: stepContext(env.machine, makeContext(env.names, index % 2 === 0 ? contract.caps : NO_CAPS)) };
    return { input, probe: () => stepProbe(sample, input.context.caps, { here }), first: walkOnce(env, walker, gate, input, true) };
  });
  for (const trial of trials) {
    const { first, probe } = trial;
    const here = thingText(trial.input.here);
    if (first.problem !== undefined) report(env, "result", `The walker ${env.name} ${first.problem} on the step ${sample.type} from ${here}.`, probe);
    const key = first.direct[0];
    if (key !== undefined) report(env, "ladder", `The walker ${env.name} reads the key ${String(key)} of ${here} directly. A walker steps through deref and has of its input.`, probe);
    const lost = first.stray[0];
    if (lost !== undefined) report(env, "hops", `The walker ${env.name} gives a visit for the key ${String(lost)} from ${here}, and no step of its deref gave that thing.`, probe);
    checkWalkType(env, walker, sample, data, trial);
  }
  // A volatile kind declares that its results change (FACTS.VOLATILE).
  if (contract.volatile) return;
  const compare = (other: (trial: Trial) => Walked, obligation: Obligation, reason: (why: string) => string): boolean => {
    let clean = true;
    for (const trial of trials) {
      const why = walkDiffers(trial.first, other(trial), env.equal);
      if (why === undefined) continue;
      clean = false;
      report(env, obligation, reason(why), trial.probe);
    }
    return clean;
  };
  // local: the same input gives the same walk in the other order of the probes.
  const later = new Map([...trials].reverse().map((trial) => [trial, walkOnce(env, walker, gate, trial.input, true)] as const));
  const stable = compare((trial) => later.get(trial) as Walked, "local", (why) => `The walker ${env.name} keeps state from one call to the next. The same input gives another walk in a later call. ${why}`);
  // The other comparisons need code without state, because each of them starts the walk again.
  if (!stable) return;
  // hops: a resolution without hops gives no visit (DEREF.HOPS).
  compare((trial) => walkOnce(env, walker, gate, trial.input, false), "hops", (why) => `The walker ${env.name} walks in another way without visit, and a resolution without hops gives no visit. ${why}`);
  // C4: the marks of a contract describe the walker of a step document too (FACTS.VERB).
  if (!contract.pure) return;
  const varied = (trial: Trial): Walked => walkOnce(env, walker, gate, { ...trial.input, context: stepContext(env.machine, variedContext(trial.input.context, [])) }, true);
  compare(varied, "C4", (why) => `The kind ${sample.type} is pure, and the walker ${env.name} reads the context. Other values in the roots change the walk. ${why}`);
}

/** This function examines the code of a `deref` on one document, for each key. */
function examineDeref(env: BaseEnv, code: DerefCode, sample: Sample, contract: Contract): void {
  const doc = sample.doc;
  const keys = [...STEP_KEYS, ...(isRecord(doc.value) ? Object.keys(doc.value) : [])];
  const who = `the deref ${env.name}`;
  const ask = (key: Key): { readonly key: Key; readonly reached: Result; readonly has: Result; readonly threw: string | undefined } => {
    const reached = attempt(() => code(doc, key), who);
    const has = attempt(() => code.has?.(doc, key), `the function has of ${who}`);
    return { key, reached: reached.result, has: has.result, threw: reached.threw ?? has.threw };
  };
  const first = keys.map(ask);
  for (const { key, reached, has, threw } of first) {
    const probe = (): ConformProbe => stepProbe(sample, NO_CAPS, { key });
    if (threw !== undefined) report(env, "result", `The deref ${env.name} throws for the key ${String(key)} of ${sample.type}: ${threw}`, probe);
    if (code.has === undefined || !has.ok) continue;
    if (typeof has.value !== "boolean") report(env, "has", `The function has of the deref ${env.name} gives ${valueText(has.value)} for the key ${String(key)}. It gives true or false.`, probe);
    else if (reached.ok && reached.value !== undefined && !has.value) report(env, "has", `The deref ${env.name} answers the key ${String(key)} of ${sample.type}, and its function has gives false.`, probe);
  }
  if (contract.volatile) return;
  // local: the same document and key give the same answer in the other order of the probes.
  for (const before of [...first].reverse()) {
    const again = ask(before.key);
    if (sameOutcome(before.reached, again.reached, env.equal) && sameOutcome(before.has, again.has, env.equal)) continue;
    report(env, "local", `The deref ${env.name} keeps state from one call to the next. The key ${String(before.key)} gives ${resultText(before.reached)}, and later ${resultText(again.reached)}.`, () => stepProbe(sample, NO_CAPS, { key: before.key }));
  }
}

/** This function gives the argument lists of a signature: the members of each parameter, and one more argument for a rest parameter. */
function argumentsOf(types: readonly ValueType[], domains: Machine["domains"], palette: readonly unknown[]): readonly (readonly unknown[])[] {
  const lists = types.map((type) => membersOf(type, domains, palette));
  const count = Math.min(
    MAX_ARGUMENTS,
    lists.reduce((product, list) => product * list.length, 1),
  );
  return Array.from({ length: count }, (_unused, index) => {
    let rest = index;
    return lists.map((list) => {
      const item = list[rest % list.length];
      rest = Math.floor(rest / list.length);
      return item;
    });
  });
}

/** This function gives the names of the operations of a profile that its tables list. */
function opNames(profile: FormulaProfile): readonly string[] {
  const { ops, lazy, sigs } = profile;
  return [...new Set([ops, lazy, sigs].flatMap((table) => (table === undefined || typeof table === "function" ? [] : Object.keys(table))))];
}

/** This function gives the document of a probe of an operation, with the arguments as the results of its parts. */
function opProbe(name: string, args: readonly unknown[]): ConformProbe {
  const results: Record<string, Result> = {};
  args.forEach((value, index) => setField(results, String(index), ok(value)));
  const value: Json = args.map((_unused, index) => ({ type: "probe", value: { probe: index } }));
  return { type: `ops.${name}`, doc: { type: ["ops", ...name.split(".")], value }, results, waits: [], caps: NO_CAPS, running: false };
}

/** This function tests that each operation keeps its signatures, with the hook `check` of the profile (TYPE.SOUND). */
function checkSignatures(env: Env, profile: FormulaProfile, palette: readonly unknown[]): void {
  const domains = env.machine.domains;
  const { ops, lazy, check } = profile;
  const answer = (name: string, args: readonly unknown[]): Result | undefined => {
    const delayed = own(lazy, name);
    if (delayed !== undefined) return delayed(args.map((value) => () => ok(value)));
    const fn = (typeof ops === "function" ? ops(name) : own(ops, name)) as ((...values: readonly unknown[]) => unknown) | undefined;
    if (fn === undefined) return undefined;
    const out = fn(...args);
    return check?.(out, name) ?? ok(out);
  };
  for (const name of opNames(profile)) {
    for (const sig of signaturesOf(profile, name)) {
      const types = [...sig.params, ...(sig.rest === undefined ? [] : [sig.rest])];
      // A bad type is a type issue of the check.
      if ([...types, sig.to].some((type) => typeIssues(type, domains).length > 0)) continue;
      for (const args of argumentsOf(types, domains, palette)) {
        // A throw and an error are the errors of the language (E-THROW). A signature describes only a value.
        const out = attempt(() => answer(name, args), `the operation ${name}`).result;
        const given = out.ok ? out.value : undefined;
        if (given === undefined || !given.ok || member(given.value, sig.to, domains)) continue;
        report(env, "typed", `The operation ${name} gives ${valueText(given.value)} for the arguments ${valueText(args)}, and its signature gives ${typeText(sig.to)}.`, () => opProbe(name, args));
        return;
      }
    }
  }
}

/** This function tests that each extension gives a result, and a member of its type in `extTypes`. */
function checkExtensions(env: Env, profile: FormulaProfile, options: ConformOptions): void {
  const domains = env.machine.domains;
  const context = rootContext(env.machine, makeContext(env.names));
  for (const name of Object.keys(profile.ext ?? {})) {
    const fn = own(profile.ext, name);
    const declared = own(profile.extTypes, name);
    const type = declared !== undefined && typeIssues(declared, domains).length === 0 ? declared : undefined;
    for (const data of [...DATA, ...(own(options.values, `ext.${name}`) ?? [])]) {
      const probe = (): ConformProbe => ({ type: `ext.${name}`, doc: { type: ["ext", ...name.split(".")], value: data }, results: {}, waits: [], caps: NO_CAPS, running: false });
      const given = attempt(() => fn?.(data, context, domains) as unknown, `the extension ${name}`).result;
      if (!given.ok) continue;
      if (!isResult(given.value)) report(env, "result", `The extension ${name} gives ${valueText(given.value)}. It gives a result.`, probe);
      else if (type !== undefined && given.value.ok && !member(given.value.value, type, domains)) report(env, "typed", `The extension ${name} gives ${valueText(given.value.value)}, and its entry in extTypes gives ${typeText(type)}.`, probe);
    }
  }
}

/**
 * This function tests the functions of a profile that the evaluator reads, by the forms of their types (D137). A throw
 * gets no finding here, because the kit gives it an error (E-THROW). Only `truthy` has a stated law against a throw.
 */
function checkProfile(env: Env, reader: ProfileReader, options: ConformOptions, probe: (value: unknown, result?: Result) => ConformProbe): void {
  const { profile } = reader;
  const { missing, omit, combine, check, lazy } = profile;
  const values = env.results.flatMap((result) => (result.ok ? [result.value] : []));
  const errors = env.results.flatMap((result) => (result.ok ? [] : [result.error]));
  const form = (what: string, call: () => unknown, good: (value: unknown) => boolean, want: string, at: () => ConformProbe): void => {
    const given = attempt(call, what).result;
    if (given.ok && !good(given.value)) report(env, "result", `The function ${what} of the profile gives ${valueText(given.value)}. It gives ${want}.`, at);
  };
  const isBool = (value: unknown): boolean => typeof value === "boolean";
  if (reader.name === "formula.ref" && missing !== undefined) for (const value of values) form("missing", () => missing(value), isBool, "true or false", () => probe(value));
  if (reader.name === "formula.record" && omit !== undefined) for (const error of errors) form("omit", () => omit(error), isBool, "true or false", () => probe(error, { ok: false, error }));
  if (reader.name === "formula.ext") checkExtensions(env, profile, options);
  if (reader.name !== "formula.op") return;
  checkSignatures(env, profile, values);
  if (combine !== undefined && errors.length > 0) form("combine", () => combine([...errors, ...errors]), isEvalError, "an error with a code and a reason", () => probe(errors[0], { ok: false, error: errors[0] as EvalError }));
  for (const name of Object.keys(lazy ?? {})) {
    const fn = own(lazy, name);
    for (const value of values) form(`lazy ${name}`, () => fn?.([() => ok(value), () => ok(value)]), isResult, "a result", () => opProbe(name, [value, value]));
  }
  if (check !== undefined) for (const value of values) form("check", () => check(value, "probe"), (given) => given === undefined || isResult(given), "a result or no value", () => probe(value));
}

/** This function gives the types of the operations or the extensions of a profile that the evaluator serves (D137). */
function profileTypes(machine: Machine, name: string, verb: string, reader: ProfileReader | undefined): readonly TypeRef[] {
  if (reader === undefined || (reader.name !== "formula.op" && reader.name !== "formula.ext")) return [];
  const { profile } = reader;
  const extensions = reader.name === "formula.ext";
  const names = extensions ? Object.keys(profile.ext ?? {}) : opNames(profile);
  const paths = names.filter((item) => profile.volatile?.includes(item) !== true).map((item) => [extensions ? "ext" : "ops", ...item.split(".")]);
  return paths.filter((path) => {
    const found = lookupKind(machine.world, path);
    return found.ok && own(found.kind.verbs, verb) === name;
  });
}

/** This function gives the code that the name and the verb select: a walker or the code of a `deref`. The default is `undefined`. */
function stepCodeOf(machine: Machine, name: string, verb: string | undefined): StepCode | undefined {
  const walker = own(machine.walkers, name);
  const code = own(machine.derefs, name);
  if (verb === "step" && walker !== undefined) return { verb, code: walker };
  if (verb === "deref" && code !== undefined) return { verb, code };
  if (verb !== undefined || own(machine.evaluators, name) !== undefined || own(machine.runners, name) !== undefined) return undefined;
  if (walker !== undefined) return { verb: "step", code: walker };
  return code === undefined ? undefined : { verb: "deref", code };
}

/** This function gives each probe document of each type, with the contract of its kind. */
function eachSample(env: BaseEnv, types: readonly TypeRef[], options: ConformOptions, visit: (sample: Sample, contract: Contract) => void): void {
  if (types.length === 0) throw new Error(`No kind of the world names ${env.name} for the verb ${env.verb}. Give the types of the probe documents in the option types.`);
  for (const type of types) {
    const found = lookupKind(env.machine.world, type);
    if (!found.ok) throw new Error(`The world has no kind for the type ${typeName(type)}.`);
    const contract = contractOf(env, found.kind, found.path, options.caps);
    const extra = own(options.values, typeName(type)) ?? own(options.values, found.path.join(".")) ?? [];
    for (const sample of samplesOf(type, found.path, found.kind, contract, extra)) visit(sample, contract);
  }
}

/** This function gives the findings of the state of `conforms`, in the order of the obligations. */
function findingsOf(env: BaseEnv): readonly Finding[] {
  return ORDER.filter((obligation) => env.found.has(obligation)).map((obligation) => env.found.get(obligation) as Finding);
}

/**
 * This function examines one evaluator or runner of a machine against the obligations of host code (K92, D36). It
 * starts the code directly, without the kernel, with probe parts and a probe runtime. It generates probe documents from
 * the contract of each kind that names the code, and it gives the probe parts chosen and random results.
 *
 * The checks follow the obligations C1 to C8 of `docs/SEMANTICS.md`. Two more checks follow the premises of the
 * simulation of the plan. The check `local` finds state that stays from one call to the next. The check `agree` compares
 * compiled code with its definition. The finding of an obligation names the first probe that breaks it. An empty list
 * means that each probe conforms.
 *
 * The check `parallel` starts a runner with a choice of waits under `all` again, in other orders of the waits (D128).
 * The check `truth` tests the declared truth of a formula profile (D86). The check `cover` tests the covers of the
 * domains of the machine from samples (D94).
 *
 * The name can also select a walker or the code of a `deref` (D137). The checks of a walker are `result`, `local`,
 * `ladder`, `hops`, `typed` and `C4`. The checks of the code of a `deref` are `result`, `local` and `has`. The evaluators
 * `formula.op` and `formula.ext` also examine each operation and each extension that the tables of their profile list.
 * The checks `typed` and `result` test the functions of the profile directly.
 *
 * @param machine - The machine with the code and the world of the kinds.
 * @param name - The name of the code. A runner wins over an evaluator of the same name, and each of them wins over a
 *   walker or a `deref` without the option `verb`.
 * @param options - The verb, the types and the values of the probe documents, and the results of the probe parts. Also
 *   the definitions, the capabilities, the names, the seed, the mock and the rule of equality.
 * @returns The first finding of each obligation that the code breaks, in the order of the obligations.
 * @throws {Error} The machine has no code with the name, or no kind names it and the options give no types.
 */
export function conforms(machine: Machine, name: string, options: ConformOptions = {}): readonly Finding[] {
  const step = stepCodeOf(machine, name, options.verb);
  const verb = step?.verb ?? options.verb ?? "eval";
  const base: BaseEnv = { machine, name, verb, results: options.results ?? RESULTS, names: options.names ?? NAMES, equal: options.equal, found: new Map() };
  if (step !== undefined) {
    const gate: Gate = { open: false, direct: [] };
    const things = [...probeThings(gate, base.results), ...(options.things ?? [])];
    eachSample(base, options.types ?? typesNaming(machine.world, name, verb), options, (sample, contract) => {
      if (step.verb === "step") examineWalker(base, step.code, gate, things, sample, contract);
      else examineDeref(base, step.code, sample, contract);
    });
    return findingsOf(base);
  }
  const runnerCode = own(machine.runners, name);
  const code = runnerCode ?? own(machine.evaluators, name);
  if (code === undefined) throw new Error(`The machine has no evaluator and no runner with the name ${name}, and no walker and no deref.`);
  const runner = runnerCode !== undefined;
  const env: Env = {
    ...base,
    under: underOf(code, runner),
    definition: definitionOf(machine, name, runner, options.definitions),
    runner,
    runs: options.runs ?? 12,
    random: random(options.seed ?? 1),
    seed: options.seed ?? 1,
    perform: options.perform,
  };
  const reader = profileReaderOf(code);
  const types = options.types ?? [...typesNaming(machine.world, name, verb), ...profileTypes(machine, name, verb, reader)];
  let first: Sample | undefined;
  eachSample(env, types, options, (sample, contract) => {
    first ??= sample;
    examine(env, sample, contract);
  });
  // A probe of the truth or of a cover gives the value to each part of the first probe document.
  const probeWith = (value: unknown, result: Result = ok(value)): ConformProbe => {
    const sample = first as Sample | undefined;
    return sample === undefined
      ? { type: typeName(types[0] as TypeRef), doc: { type: types[0] as TypeRef, value: null }, results: {}, waits: [], caps: NO_CAPS, running: runner }
      : probeOf(sample, { results: sample.split.parts.map(() => result), waits: [], caps: NO_CAPS, running: runner });
  };
  checkTruth(env, code, probeWith);
  checkCovers(env, probeWith);
  if (reader !== undefined) checkProfile(env, reader, options, probeWith);
  return findingsOf(env);
}
