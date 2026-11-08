import { STD_EVALUATORS, type EvalFn, type EvalInput, type Evaluator, type TypeRule, type ValueType } from "@mark1russell7/coeval";

/** This function gives the rule of a kind that gives one type, with parts of one type. */
function ruleOf(to: ValueType, parts?: ValueType): TypeRule {
  return parts === undefined ? { synth: () => to } : { part: () => ({ expect: parts, what: "part of the operation" }), synth: () => to };
}

/** The type rules of the standard kinds on the pictures of the site. The standard evaluators have no rules. */
const RULES: Readonly<Record<string, TypeRule>> = {
  "data.number": ruleOf("number"),
  "data.text": ruleOf("text"),
  "data.bool": ruleOf("bool"),
  "math.add": ruleOf("number", "number"),
  "math.multiply": ruleOf("number", "number"),
  "math.greater": ruleOf("bool", "number"),
};

/** This function gives the evaluators of the standard kit, and a rule on each evaluator of `RULES`. */
function typedEvaluators(): Readonly<Record<string, Evaluator>> {
  const all: Record<string, Evaluator> = { ...STD_EVALUATORS };
  for (const name of Object.keys(RULES)) {
    const code = STD_EVALUATORS[name] as EvalFn;
    all[name] = Object.assign((input: EvalInput) => code(input), { type: RULES[name] });
  }
  return all;
}

/** The evaluators of the site. Each evaluation is the same as with `STD_EVALUATORS`. */
export const TYPED_EVALUATORS: Readonly<Record<string, Evaluator>> = typedEvaluators();
