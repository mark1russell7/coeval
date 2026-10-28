import {
  STD_MACHINE,
  conforms,
  fail,
  ok,
  type CompiledEvaluator,
  type EvalFn,
  type Evaluator,
  type Finding,
  type Kind,
  type Machine,
  type Obligation,
  type Result,
} from "@mark1russell7/coeval";

/*
 * The evaluators of the conformance diagram. A reader picks a small evaluator and one break. Each break is real code
 * that breaks one obligation of host code (C1 to C8 of SEMANTICS.md). The model builds a machine with the code and
 * asks `conforms` for its findings.
 */

/** One line of the code that the diagram shows. A changed line is a line of the break. */
export interface CodeLine {
  readonly text: string;
  readonly changed: boolean;
}

/**
 * This function reads a block of code text. A line that starts with `»` is a line of the break.
 *
 * @param text - The code, with a mark at the start of each changed line.
 * @returns The lines.
 */
export function codeLines(text: string): readonly CodeLine[] {
  return text.split("\n").map((line) => (line.startsWith("»") ? { text: line.slice(1), changed: true } : { text: line, changed: false }));
}

/** The obligations of host code, in the order of `SEMANTICS.md`, with the words of the diagram. */
export const DUTIES: readonly { readonly id: Obligation; readonly title: string; readonly rule: string }[] = [
  { id: "C1", title: "Capabilities", rule: "Each part gets only the capabilities of its document." },
  { id: "C2", title: "Declared effects", rule: "The code causes only the effects that its contract declares." },
  { id: "C3", title: "Eager and lazy parts", rule: "Each eager part evaluates. A lazy part evaluates only when its result counts." },
  { id: "C4", title: "Pure", rule: "A pure kind causes no effect, and it reads the context only through resolve." },
  { id: "C5", title: "Sealed parts", rule: "The code reads its parts only through their handles, not through their JSON." },
  { id: "C6", title: "Waits", rule: "Only a runner waits, and it passes each wait of its parts through." },
  { id: "C7", title: "Names", rule: "Each part gets the names of the scope rules of its kind, and no other name." },
  { id: "C8", title: "Steady tables", rule: "A table that compiled code reads gives the same answer at each time." },
];

/** The two checks of `conforms` after C8: the state between calls, and the agreement with the definition. */
export const PREMISES: readonly { readonly id: Obligation; readonly title: string; readonly rule: string }[] = [
  { id: "local", title: "No state", rule: "The code keeps no state from one call to the next." },
  { id: "agree", title: "Agree", rule: "Compiled code gives the result of its definition for the reference." },
];

/** One break: the obligation that it aims at, a summary, the code and the contract that it gives. */
export interface Break {
  readonly id: string;
  /** The obligation that the break aims at, or `undefined` for the code without a break. */
  readonly duty?: Obligation;
  readonly label: string;
  readonly summary: string;
  readonly code: string;
  readonly evaluator: () => Evaluator;
}

/** One small evaluator that a reader can break. */
export interface Subject {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  /** The name of the kind and of its evaluator. */
  readonly name: string;
  readonly kind: Kind;
  /** The names of the context of each probe. */
  readonly names: Readonly<Record<string, unknown>>;
  /** The code without a break first, then one break for each obligation. */
  readonly breaks: readonly Break[];
}

/**
 * This function makes a table that gives another answer at each question, as a profile that changes. Each machine gets
 * a new table. The answers do not come back, thus each new compilation sees a new answer.
 *
 * @param answer - The answer for the count of the earlier questions.
 * @returns The function that asks the table.
 */
function changingTable<T>(answer: (asked: number) => T): () => T {
  let asked = 0;
  return () => {
    const next = answer(asked);
    asked += 1;
    return next;
  };
}

/** The code of `total` without a break. */
const TOTAL_CODE = `const total = ({ parts }) => {
  let sum = 0;
  for (const part of parts) {
    const result = part.evaluate();
    if (!result.ok) return result;
    if (typeof result.value !== "number") return fail("#VALUE!", "total needs numbers.");
    sum += result.value;
  }
  return ok(sum);
};`;

/** This function adds the numbers of a list of results, or gives the first error. */
function sumOf(results: readonly Result[]): Result {
  let sum = 0;
  for (const result of results) {
    if (!result.ok) return result;
    if (typeof result.value !== "number") return fail("#VALUE!", "total needs numbers.");
    sum += result.value;
  }
  return ok(sum);
}

const total: EvalFn = ({ parts }) => {
  const results: Result[] = [];
  for (const part of parts) {
    const result = part.evaluate();
    results.push(result);
    if (!result.ok) break;
  }
  return sumOf(results);
};

const TOTAL: Subject = {
  id: "total",
  label: "total, a sum",
  summary: "A pure kind. Its parts are a list, and its result is the sum of their numbers.",
  name: "total",
  kind: { verbs: { eval: "total" }, parts: { shape: "list" }, pure: true, summary: "The sum of its parts." },
  names: { start: 10 },
  breaks: [
    { id: "none", label: "No break", summary: "The code as the contract describes it.", code: TOTAL_CODE, evaluator: () => total },
    {
      id: "c1",
      duty: "C1",
      label: "More capabilities",
      summary: "Each part gets the capabilities log and write, also when the document has none.",
      code: TOTAL_CODE.replace("    const result = part.evaluate();", '»    const result = part.evaluate({ ...context, caps: ["log", "write"] });').replace("({ parts })", "»({ parts, context })"),
      evaluator: () =>
        (({ parts, context }) => {
          const results: Result[] = [];
          for (const part of parts) {
            const result = part.evaluate({ ...context, caps: ["log", "write"] });
            results.push(result);
            if (!result.ok) break;
          }
          return sumOf(results);
        }) satisfies EvalFn,
    },
    {
      id: "c2",
      duty: "C2",
      label: "A log line",
      summary: "The code writes the sum to the log. The contract declares no effect, and the kind is pure.",
      code: TOTAL_CODE.replace("({ parts })", "»({ parts, effect })").replace("  return ok(sum);", '»  return effect("log", sum);'),
      evaluator: () =>
        (({ parts, effect }) => {
          const sum = total({ parts } as Parameters<EvalFn>[0]);
          return sum.ok ? effect("log", sum.value) : sum;
        }) satisfies EvalFn,
    },
    {
      id: "c3",
      duty: "C3",
      label: "Only the first part",
      summary: "The code stops after the first part. The other parts are eager, but they do not evaluate.",
      code: TOTAL_CODE.replace("  for (const part of parts) {", "»  for (const part of parts.slice(0, 1)) {"),
      evaluator: () => (({ parts }) => sumOf(parts.slice(0, 1).map((part) => part.evaluate()))) satisfies EvalFn,
    },
    {
      id: "c4",
      duty: "C4",
      label: "A name, read directly",
      summary: "The sum starts at the name start. The code reads it from the context, not through resolve.",
      code: TOTAL_CODE.replace("({ parts })", "»({ parts, context })").replace("  let sum = 0;", "»  let sum = Number(context.names.start ?? 0);"),
      evaluator: () =>
        (({ parts, context }) => {
          const sum = total({ parts } as Parameters<EvalFn>[0]);
          return sum.ok ? ok(Number(context.names["start"] ?? 0) + (sum.value as number)) : sum;
        }) satisfies EvalFn,
    },
    {
      id: "c5",
      duty: "C5",
      label: "The JSON of the parts",
      summary: "The result keeps the JSON of the parts, for a tooltip. Two documents with the same results then differ.",
      code: TOTAL_CODE.replace("({ parts })", "»({ parts, doc })").replace("  return ok(sum);", "»  return ok({ sum, source: JSON.stringify(doc.value) });"),
      evaluator: () =>
        (({ parts, doc }) => {
          const sum = total({ parts } as Parameters<EvalFn>[0]);
          return sum.ok ? ok({ sum: sum.value, source: JSON.stringify(doc.value) }) : sum;
        }) satisfies EvalFn,
    },
    {
      id: "c6",
      duty: "C6",
      label: "A promise",
      summary: "The code gives a promise of the sum. An evaluator cannot wait. Each call gives a new promise, thus the check local finds a change too.",
      code: TOTAL_CODE.replace("  return ok(sum);", "»  return ok(Promise.resolve(sum));"),
      evaluator: () =>
        (({ parts }) => {
          const sum = total({ parts } as Parameters<EvalFn>[0]);
          return sum.ok ? ok(Promise.resolve(sum.value)) : sum;
        }) satisfies EvalFn,
    },
    {
      id: "c7",
      duty: "C7",
      label: "A name for the parts",
      summary: "Each part gets the name sum, the sum so far. The kind has no scope rule for it.",
      code: TOTAL_CODE.replace("({ parts })", "»({ parts, context })").replace(
        "    const result = part.evaluate();",
        "»    const result = part.evaluate({ ...context, names: { ...context.names, sum } });",
      ),
      evaluator: () =>
        (({ parts, context }) => {
          let sum = 0;
          for (const part of parts) {
            const result = part.evaluate({ ...context, names: { ...context.names, sum } });
            if (!result.ok) return result;
            if (typeof result.value !== "number") return fail("#VALUE!", "total needs numbers.");
            sum += result.value;
          }
          return ok(sum);
        }) satisfies EvalFn,
    },
    {
      id: "c8",
      duty: "C8",
      label: "A table, read one time",
      summary: "Compiled code reads a scale from a table when it compiles. The table gives another scale later.",
      code: `»const total = {
»  compile: ({ parts }) => {
»    const scale = table.scale(); // 1, then 2, then 3 ...
»    return (ctx, rt) => {
      let sum = 0;
      for (const part of parts) {
»        const result = part.code(ctx, rt);
        if (!result.ok) return result;
        if (typeof result.value !== "number") return fail("#VALUE!", "total needs numbers.");
        sum += result.value;
      }
»      return ok(sum * scale);
»    };
»  },
};`,
      evaluator: () => {
        const scale = changingTable((asked) => asked + 1);
        const compiled: CompiledEvaluator = {
          compile: ({ parts }) => {
            const factor = scale();
            return (ctx, rt) => {
              const results: Result[] = [];
              for (const part of parts) {
                const result = part.code(ctx, rt);
                results.push(result);
                if (!result.ok) break;
              }
              const sum = sumOf(results);
              return sum.ok ? ok((sum.value as number) * factor) : sum;
            };
          },
        };
        return compiled;
      },
    },
  ],
};

/** The code of `pick` without a break. */
const PICK_CODE = `const pick = ({ parts }) => {
  const part = (key) => parts.find((each) => each.key === key);
  const test = part("test").evaluate();
  if (!test.ok) return test;
  if (typeof test.value !== "boolean") return fail("#VALUE!", "The test must give true or false.");
  const branch = part(test.value ? "then" : "else");
  return branch === undefined ? ok(null) : branch.evaluate();
};`;

type Parts = Parameters<EvalFn>[0]["parts"];

/** This function gives the part with a key. */
function partAt(parts: Parts, key: string): Parts[number] | undefined {
  return parts.find((each) => each.key === key);
}

/** This function evaluates the test of `pick`, and gives its truth value or an error. */
function testOf(parts: Parts): Result {
  const test = partAt(parts, "test")?.evaluate() ?? fail("#VALUE!", "pick needs a test.");
  if (!test.ok) return test;
  return typeof test.value === "boolean" ? test : fail("#VALUE!", "The test must give true or false.");
}

const pick: EvalFn = ({ parts }) => {
  const test = testOf(parts);
  if (!test.ok) return test;
  return partAt(parts, test.value === true ? "then" : "else")?.evaluate() ?? ok(null);
};

const PICK: Subject = {
  id: "pick",
  label: "pick, a choice",
  summary: "A pure kind with a test and two lazy branches. Only the branch that the test selects evaluates.",
  name: "pick",
  kind: {
    verbs: { eval: "pick" },
    parts: { shape: "record", fields: ["test", "then", "else"], required: ["test"] },
    pure: true,
    lazy: [{ in: [["then"], ["else"]] }],
    summary: "It evaluates the test, then the branch that the test selects.",
  },
  names: { fallback: "none" },
  breaks: [
    { id: "none", label: "No break", summary: "The code as the contract describes it.", code: PICK_CODE, evaluator: () => pick },
    {
      id: "c1",
      duty: "C1",
      label: "More capabilities",
      summary: "The branch gets the capabilities log and write, also when the document has none.",
      code: PICK_CODE.replace("({ parts })", "»({ parts, context })").replace(
        "  return branch === undefined ? ok(null) : branch.evaluate();",
        '»  return branch === undefined ? ok(null) : branch.evaluate({ ...context, caps: ["log", "write"] });',
      ),
      evaluator: () =>
        (({ parts, context }) => {
          const test = testOf(parts);
          if (!test.ok) return test;
          return partAt(parts, test.value === true ? "then" : "else")?.evaluate({ ...context, caps: ["log", "write"] }) ?? ok(null);
        }) satisfies EvalFn,
    },
    {
      id: "c2",
      duty: "C2",
      label: "A log line",
      summary: "The code writes the choice to the log. The contract declares no effect, and the kind is pure.",
      code: PICK_CODE.replace("({ parts })", "»({ parts, effect })").replace(
        '  if (typeof test.value !== "boolean") return fail("#VALUE!", "The test must give true or false.");',
        '  if (typeof test.value !== "boolean") return fail("#VALUE!", "The test must give true or false.");\n»  effect("log", test.value ? "then" : "else");',
      ),
      evaluator: () =>
        (({ parts, effect }) => {
          const test = testOf(parts);
          if (!test.ok) return test;
          effect("log", test.value === true ? "then" : "else");
          return partAt(parts, test.value === true ? "then" : "else")?.evaluate() ?? ok(null);
        }) satisfies EvalFn,
    },
    {
      id: "c3",
      duty: "C3",
      label: "Both branches",
      summary: "The code evaluates both branches first, then gives one. A lazy branch evaluates, and its result does not count.",
      code: PICK_CODE.replace(
        '  const branch = part(test.value ? "then" : "else");\n  return branch === undefined ? ok(null) : branch.evaluate();',
        '»  const yes = part("then")?.evaluate() ?? ok(null);\n»  const no = part("else")?.evaluate() ?? ok(null);\n»  return test.value ? yes : no;',
      ),
      evaluator: () =>
        (({ parts }) => {
          const test = testOf(parts);
          if (!test.ok) return test;
          const yes = partAt(parts, "then")?.evaluate() ?? ok(null);
          const no = partAt(parts, "else")?.evaluate() ?? ok(null);
          return test.value === true ? yes : no;
        }) satisfies EvalFn,
    },
    {
      id: "c4",
      duty: "C4",
      label: "A name, read directly",
      summary: "Without an else, the code gives the name fallback. It reads the name from the context, not through resolve.",
      code: PICK_CODE.replace("({ parts })", "»({ parts, context })").replace(
        "  return branch === undefined ? ok(null) : branch.evaluate();",
        "»  return branch === undefined ? ok(context.names.fallback) : branch.evaluate();",
      ),
      evaluator: () =>
        (({ parts, context }) => {
          const test = testOf(parts);
          if (!test.ok) return test;
          return partAt(parts, test.value === true ? "then" : "else")?.evaluate() ?? ok(context.names["fallback"] ?? null);
        }) satisfies EvalFn,
    },
    {
      id: "c5",
      duty: "C5",
      label: "The JSON of the parts",
      summary: "The result keeps the JSON of the branch, for a tooltip. Two documents with the same results then differ.",
      code: PICK_CODE.replace("({ parts })", "»({ parts, doc })").replace(
        "  return branch === undefined ? ok(null) : branch.evaluate();",
        '»  const value = branch === undefined ? ok(null) : branch.evaluate();\n»  return value.ok ? ok({ value: value.value, source: JSON.stringify(doc.value) }) : value;',
      ),
      evaluator: () =>
        (({ parts, doc }) => {
          const value = pick({ parts } as Parameters<EvalFn>[0]);
          return value.ok ? ok({ value: value.value, source: JSON.stringify(doc.value) }) : value;
        }) satisfies EvalFn,
    },
    {
      id: "c6",
      duty: "C6",
      label: "A promise",
      summary: "The code gives a promise of the branch. An evaluator cannot wait. Each call gives a new promise, thus the check local finds a change too.",
      code: PICK_CODE.replace(
        "  return branch === undefined ? ok(null) : branch.evaluate();",
        "»  const value = branch === undefined ? ok(null) : branch.evaluate();\n»  return value.ok ? ok(Promise.resolve(value.value)) : value;",
      ),
      evaluator: () =>
        (({ parts }) => {
          const value = pick({ parts } as Parameters<EvalFn>[0]);
          return value.ok ? ok(Promise.resolve(value.value)) : value;
        }) satisfies EvalFn,
    },
    {
      id: "c7",
      duty: "C7",
      label: "A name for the branch",
      summary: "The branch gets the name it, the value of the test. The kind has no scope rule for it.",
      code: PICK_CODE.replace("({ parts })", "»({ parts, context })").replace(
        "  return branch === undefined ? ok(null) : branch.evaluate();",
        "»  return branch === undefined ? ok(null) : branch.evaluate({ ...context, names: { ...context.names, it: test.value } });",
      ),
      evaluator: () =>
        (({ parts, context }) => {
          const test = testOf(parts);
          if (!test.ok) return test;
          return partAt(parts, test.value === true ? "then" : "else")?.evaluate({ ...context, names: { ...context.names, it: test.value } }) ?? ok(null);
        }) satisfies EvalFn,
    },
    {
      id: "c8",
      duty: "C8",
      label: "A table, read one time",
      summary: "Compiled code reads the value for a missing else from a table when it compiles. The table changes later.",
      code: `»const pick = {
»  compile: ({ parts }) => {
»    const otherwise = table.otherwise(); // null, then "none 1", then "none 2" ...
»    const part = (key) => parts.find((each) => each.key === key);
»    return (ctx, rt) => {
»      const test = part("test").code(ctx, rt);
      if (!test.ok) return test;
      if (typeof test.value !== "boolean") return fail("#VALUE!", "The test must give true or false.");
      const branch = part(test.value ? "then" : "else");
»      return branch === undefined ? ok(otherwise) : branch.code(ctx, rt);
»    };
»  },
};`,
      evaluator: () => {
        const otherwise = changingTable<string | null>((asked) => (asked === 0 ? null : `none ${String(asked)}`));
        const compiled: CompiledEvaluator = {
          compile: ({ parts }) => {
            const missing = otherwise();
            const at = (key: string) => parts.find((each) => each.key === key);
            return (ctx, rt) => {
              const test = at("test")?.code(ctx, rt) ?? fail("#VALUE!", "pick needs a test.");
              if (!test.ok) return test;
              if (typeof test.value !== "boolean") return fail("#VALUE!", "The test must give true or false.");
              const branch = at(test.value ? "then" : "else");
              return branch === undefined ? ok(missing) : branch.code(ctx, rt);
            };
          },
        };
        return compiled;
      },
    },
  ],
};

/** The evaluators that a reader can break. */
export const SUBJECTS: readonly Subject[] = [TOTAL, PICK];

/** What `conforms` gives for one evaluator and one break. */
export interface ConformModel {
  readonly findings: readonly Finding[];
  /** The obligations of the findings. */
  readonly broken: ReadonlySet<Obligation>;
  /** The machine of the check: the standard machine with the kind and the code. */
  readonly machine: Machine;
}

/**
 * This function builds a machine with the kind and the code of a break, and asks `conforms` for its findings.
 *
 * @param subject - The evaluator.
 * @param item - The break.
 * @returns The findings, and the obligations that they name.
 */
export function conformModel(subject: Subject, item: Break): ConformModel {
  const machine: Machine = {
    ...STD_MACHINE,
    world: { ...STD_MACHINE.world, kinds: { ...STD_MACHINE.world.kinds, [subject.name]: subject.kind } },
    evaluators: { ...STD_MACHINE.evaluators, [subject.name]: item.evaluator() },
  };
  const findings = conforms(machine, subject.name, { names: subject.names });
  return { findings, broken: new Set(findings.map((finding) => finding.obligation)), machine };
}
