import { STD_MACHINE, conforms, ok, type Context, type EvalFn, type Finding, type Kind, type Machine, type Obligation, type Result } from "@mark1russell7/coeval";

/** One rule that `conforms` tests, with its text for a reader. */
export interface ObligationRow {
  readonly id: Obligation;
  readonly label: string;
  readonly rule: string;
}

/** The rules of the diagram. Each one holds for each evaluator of a kind. */
export const OBLIGATION_ROWS: readonly ObligationRow[] = [
  { id: "C1", label: "Capabilities", rule: "A part gets no more capabilities than its document has." },
  { id: "C2", label: "Effects", rule: "The code causes only the effects of its contract." },
  { id: "C3", label: "Eager parts", rule: "The code evaluates each part that its contract does not call lazy." },
  { id: "C4", label: "Pure", rule: "The code of a pure kind reads the context only through resolve." },
  { id: "C5", label: "Sealed", rule: "The result depends on the results of the parts, not on their JSON." },
  { id: "local", label: "Local", rule: "The same probe gives the same record in each call." },
];

/** The list of the values of the parts, or the first error. */
function each(parts: readonly { evaluate(context?: Context): Result }[], given?: Context): Result {
  const values: unknown[] = [];
  for (const part of parts) {
    const result = part.evaluate(given);
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

/** A version of the code of one kind: good code, or code with one break. */
export interface CodeBreak {
  readonly id: string;
  /** The text of the button. */
  readonly label: string;
  /** The code, as a reader sees it. */
  readonly code: string;
  /** This function makes the code. Each check gets new code, thus the state of an earlier check stays out of it. */
  readonly make: () => EvalFn;
  /** The fields of a contract that permit this code. */
  readonly permit?: Partial<Kind>;
  /** The contract of the kind, when it is not a plain kind. */
  readonly contract?: Partial<Kind>;
}

/** The versions of the diagram. Only the first one conforms with the plain contract. */
export const CODE_BREAKS: readonly CodeBreak[] = [
  {
    id: "good",
    label: "Good code",
    code: "({ parts }) => each(parts)",
    make: () => ({ parts }) => each(parts),
  },
  {
    id: "wide",
    label: "Gives more capabilities",
    code: '({ parts, context }) => each(parts, { ...context, caps: ["log", "write"] })',
    make: () => ({ parts, context }) => each(parts, { ...context, caps: ["log", "write"] }),
  },
  {
    id: "noisy",
    label: "Causes an effect",
    code: '({ parts, effect }) => {\n  const all = each(parts);\n  return all.ok ? effect("log", all.value) : all;\n}',
    make: () => ({ parts, effect }) => {
      const all = each(parts);
      return all.ok ? effect("log", all.value) : all;
    },
    permit: { effects: ["log"] },
  },
  {
    id: "first",
    label: "Skips a part",
    code: "({ parts }) => parts[0]?.evaluate() ?? ok(null)",
    make: () => ({ parts }) => parts[0]?.evaluate() ?? ok(null),
    permit: { lazy: [{ after: 1 }] },
  },
  {
    id: "peek",
    label: "Reads a name directly",
    code: '({ parts, context }) => {\n  const all = each(parts);\n  return all.ok ? ok([all.value, context.names["x"]]) : all;\n}',
    make: () => ({ parts, context }) => {
      const all = each(parts);
      return all.ok ? ok([all.value, context.names["x"]]) : all;
    },
    contract: { pure: true },
  },
  {
    id: "leak",
    label: "Reads the JSON of its parts",
    code: "({ parts, doc }) => {\n  const all = each(parts);\n  return all.ok ? ok([all.value, JSON.stringify(doc.value)]) : all;\n}",
    make: () => ({ parts, doc }) => {
      const all = each(parts);
      return all.ok ? ok([all.value, JSON.stringify(doc.value)]) : all;
    },
  },
  {
    id: "counter",
    label: "Keeps a count",
    code: "let count = 0;\n({ parts }) => {\n  const all = each(parts);\n  count += 1;\n  return all.ok ? ok(count) : all;\n}",
    make: () => {
      let count = 0;
      return ({ parts }) => {
        const all = each(parts);
        count += 1;
        return all.ok ? ok(count) : all;
      };
    },
  },
];

/** This function gives the standard machine with the kind `checked` and the code of a version. */
function machineOf(item: CodeBreak, permitted: boolean): Machine {
  const kind: Kind = { verbs: { eval: "checked" }, parts: { shape: "list" }, ...item.contract, ...(permitted ? item.permit : {}) };
  return {
    ...STD_MACHINE,
    world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, checked: kind } },
    evaluators: { ...STD_MACHINE.evaluators, checked: item.make() },
  };
}

/**
 * This function runs `conforms` on a version of the code.
 *
 * @param item - The version of the code.
 * @param permitted - `true` when the contract declares what the code does.
 * @returns The findings of `conforms`.
 */
export function checkCode(item: CodeBreak, permitted: boolean): readonly Finding[] {
  return conforms(machineOf(item, permitted), "checked");
}
