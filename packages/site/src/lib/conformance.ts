import { STD_MACHINE, conforms, ok, type Context, type EvalFn, type Finding, type Kind, type Machine, type Obligation, type Part, type Result } from "@mark1russell7/coeval";

/*
 * The conformance diagram (K123). The reader breaks one evaluator in chosen ways, and `conforms` of the core examines
 * the code. Each finding of the diagram comes from `conforms`, with its obligation, its reason and its probe.
 */

/** The name of the evaluator and of its kind in the machine of the diagram. */
export const KIND = "tally";

/** A way to break the evaluator. Each break breaks one obligation of `docs/SEMANTICS.md`. */
export type BreakId = "widen" | "effect" | "skip" | "peek" | "leak" | "secret" | "count";

/** One break of the evaluator, as the diagram shows it. */
export interface Break {
  readonly id: BreakId;
  /** The obligation that the break breaks. */
  readonly duty: Obligation;
  /** The text of the check box. */
  readonly label: string;
  /** The short name of the duty in the picture. */
  readonly short: string;
  /** The line of code that the break adds or changes. */
  readonly code: string;
  /** One sentence about the duty. */
  readonly rule: string;
}

/** The breaks, in the order of the obligations. */
export const BREAKS: readonly Break[] = [
  { id: "widen", duty: "C1", label: "Give the parts the capability log", short: "capabilities", code: 'ctx = { ...ctx, caps: [...ctx.caps, "log"] };', rule: "Each context that the code gives a part has only the capabilities of its document." },
  { id: "effect", duty: "C2", label: "Write a log line", short: "effects", code: 'return effect("log", values);', rule: "The code causes only the effects that the contract of the kind declares." },
  { id: "skip", duty: "C3", label: "Evaluate only the first part", short: "parts", code: "const used = parts.slice(0, 1);", rule: "Each eager part evaluates when the result is a value." },
  { id: "peek", duty: "C4", label: "Read a name without resolve", short: "pure reads", code: 'values.push(context.names["x"]);', rule: "The code of a pure kind reads the context only through resolve." },
  { id: "leak", duty: "C5", label: "Read the JSON of the document", short: "sealed parts", code: "values.push(JSON.stringify(doc.value));", rule: "The code reads its parts only through their handles." },
  { id: "secret", duty: "C7", label: "Bind an extra name", short: "names", code: "ctx = { ...ctx, names: { ...ctx.names, secret: 1 } };", rule: "The code binds for a part only the names that the scope rules give." },
  { id: "count", duty: "local", label: "Count the calls", short: "no state", code: "calls += 1; values.push(calls);", rule: "The code keeps no state from one call to the next." },
];

/** The facts of the contract of the kind that the reader can change. */
export interface Contract {
  /** The mark `pure`: the code causes no effect and reads the context only through `resolve`. */
  readonly pure: boolean;
  /** `true` when the contract declares the effect `log`. */
  readonly declaresLog: boolean;
}

/** The contract of the diagram at the start. */
export const START_CONTRACT: Contract = { pure: true, declaresLog: false };

/** This function gives the kind of the evaluator for a contract: a list of parts, with the facts of the contract. */
export function kindOf(contract: Contract): Kind {
  return { verbs: { eval: KIND }, parts: { shape: "list" }, ...(contract.pure ? { pure: true } : {}), ...(contract.declaresLog ? { effects: ["log"] } : {}) };
}

/** This function evaluates each part in order, and gives the list of the values or the first error. */
function each(parts: readonly Part[], context: Context | undefined): Result {
  const values: unknown[] = [];
  for (const part of parts) {
    const result = part.evaluate(context);
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

/**
 * This function gives the evaluator with the breaks. Without a break, it gives the list of the values of its parts,
 * and it conforms. The count of the calls lives in the closure, thus each evaluator has its own count.
 */
export function evaluatorOf(breaks: ReadonlySet<BreakId>): EvalFn {
  let calls = 0;
  return ({ parts, context, effect, doc }) => {
    let ctx: Context | undefined;
    if (breaks.has("widen")) ctx = { ...(ctx ?? context), caps: [...(ctx ?? context).caps, "log"] };
    if (breaks.has("secret")) ctx = { ...(ctx ?? context), names: { ...(ctx ?? context).names, secret: 1 } };
    const used = breaks.has("skip") ? parts.slice(0, 1) : parts;
    const all = each(used, ctx);
    if (!all.ok) return all;
    const values = [...(all.value as unknown[])];
    if (breaks.has("peek")) values.push(context.names["x"] ?? null);
    if (breaks.has("leak")) values.push(JSON.stringify(doc.value));
    if (breaks.has("count")) {
      calls += 1;
      values.push(calls);
    }
    return breaks.has("effect") ? effect("log", values) : ok(values);
  };
}

/** This function gives the standard machine with the kind and the evaluator of the diagram. */
export function machineOf(breaks: ReadonlySet<BreakId>, contract: Contract): Machine {
  return {
    ...STD_MACHINE,
    world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, [KIND]: kindOf(contract) } },
    evaluators: { ...STD_MACHINE.evaluators, [KIND]: evaluatorOf(breaks) },
  };
}

/** This function runs `conforms` of the core on the evaluator with the breaks and the contract. */
export function examine(breaks: ReadonlySet<BreakId>, contract: Contract): readonly Finding[] {
  return conforms(machineOf(breaks, contract), KIND);
}

/**
 * The state of one duty in the diagram.
 *
 * - `found`: `conforms` gives a finding of the duty.
 * - `kept`: no break breaks the duty, and `conforms` gives no finding.
 * - `permitted`: a break is on, but the contract permits what the code does.
 * - `hidden`: a break is on, but another break stops the check of the duty.
 * - `missed`: a break is on, and the diagram knows no reason for the missing finding. The tests keep it empty.
 */
export type DutyState = "found" | "kept" | "permitted" | "hidden" | "missed";

/** The state of one duty, with the reason for each state other than `found` and `kept`. */
export interface DutyRead {
  readonly duty: Obligation;
  readonly state: DutyState;
  readonly finding?: Finding;
  readonly note?: string;
}

/**
 * This function gives the state of each duty of the diagram, from the findings of `conforms`. The reasons of `permitted`
 * and `hidden` follow the rules of `conform.ts`. A pure contract decides C4, and the declared effects decide C2. After
 * a finding of `local`, `conforms` does not compare the evaluations for C4 and C5. C3 applies only to a result that is
 * a value.
 */
export function dutiesOf(breaks: ReadonlySet<BreakId>, contract: Contract, findings: readonly Finding[]): readonly DutyRead[] {
  const found = (duty: Obligation): Finding | undefined => findings.find((item) => item.obligation === duty);
  return BREAKS.map((item): DutyRead => {
    const finding = found(item.duty);
    if (finding !== undefined) return { duty: item.duty, state: "found", finding };
    if (!breaks.has(item.id)) return { duty: item.duty, state: "kept" };
    if (item.id === "peek" && !contract.pure) return { duty: item.duty, state: "permitted", note: "The kind is not pure, thus the code can read the context." };
    if (item.id === "effect" && contract.declaresLog) return { duty: item.duty, state: "permitted", note: "The contract declares the effect log." };
    if ((item.id === "peek" || item.id === "leak") && found("local") !== undefined) {
      return { duty: item.duty, state: "hidden", note: "The code keeps state, thus conforms does not evaluate the probes again for this check." };
    }
    if (item.id === "skip" && breaks.has("effect") && !contract.declaresLog) {
      return { duty: item.duty, state: "hidden", note: "The probe has no capability log, thus the effect gives an error. C3 applies only to a value." };
    }
    return { duty: item.duty, state: "missed", note: "conforms gives no finding of this duty." };
  });
}

/** The four contracts that the reader can choose. */
export const CONTRACTS: readonly Contract[] = [
  { pure: true, declaresLog: false },
  { pure: true, declaresLog: true },
  { pure: false, declaresLog: false },
  { pure: false, declaresLog: true },
];

/** This function gives the lines of the code of the evaluator, with the break of each changed line. */
export function codeLines(breaks: ReadonlySet<BreakId>): readonly { readonly text: string; readonly broken?: Break }[] {
  const line = (id: BreakId, plain?: string): { text: string; broken?: Break }[] => {
    const item = BREAKS.find((entry) => entry.id === id) as Break;
    if (breaks.has(id)) return [{ text: `  ${item.code}`, broken: item }];
    return plain === undefined ? [] : [{ text: plain }];
  };
  return [
    { text: "({ parts, context, effect, doc }) => {" },
    { text: "  let ctx = context;" },
    ...line("widen"),
    ...line("secret"),
    ...line("skip", "  const used = parts;"),
    { text: "  const values = evaluateEach(used, ctx);" },
    ...line("peek"),
    ...line("leak"),
    ...line("count"),
    ...line("effect", "  return ok(values);"),
    { text: "}" },
  ];
}

/** This function gives a short text of a value of a probe. */
export function probeText(value: unknown): string {
  if (value === undefined) return "undefined";
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}
