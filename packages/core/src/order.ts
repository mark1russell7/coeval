/** One step of a sequence: its name, the names of the earlier steps that it reads, and if it has an effect. */
export interface StepSpec {
  readonly id: string;
  readonly reads: readonly string[];
  readonly effect: boolean;
}

/** An edge from a step that must come first to a step that must come after it. */
export type Edge = readonly [before: string, after: string];

/** A reference that a sequence cannot resolve. */
export interface OrderProblem {
  readonly step: string;
  readonly reads: string;
  /** `unknown-name`: no step has this name. `read-before-defined`: the step with this name comes later. */
  readonly problem: "unknown-name" | "read-before-defined";
}

/**
 * This function finds the references that a sequence cannot resolve. A step can read only the steps before it.
 *
 * @param steps - The steps, in the written order.
 * @returns One problem for each bad reference, in the written order.
 */
export function checkSteps(steps: readonly StepSpec[]): readonly OrderProblem[] {
  const problems: OrderProblem[] = [];
  steps.forEach((step, index) => {
    for (const name of step.reads) {
      const at = steps.findIndex((other) => other.id === name);
      if (at === -1) problems.push({ step: step.id, reads: name, problem: "unknown-name" });
      else if (at >= index) problems.push({ step: step.id, reads: name, problem: "read-before-defined" });
    }
  });
  return problems;
}

/**
 * This function gives the data edges: a step comes after each earlier step that it reads.
 *
 * @param steps - The steps, in the written order.
 * @returns The edges. A bad reference gives no edge.
 */
export function dataEdges(steps: readonly StepSpec[]): readonly Edge[] {
  const edges: Edge[] = [];
  steps.forEach((step, index) => {
    for (const name of step.reads) {
      const at = steps.findIndex((other) => other.id === name);
      if (at !== -1 && at < index) edges.push([name, step.id]);
    }
  });
  return edges;
}

/**
 * This function gives the effect edges: each step with an effect comes after the previous step with an effect.
 * Effects keep their written order. Steps without an effect get no effect edge.
 *
 * @param steps - The steps, in the written order.
 * @returns The edges, one for each pair of consecutive effect steps.
 */
export function effectEdges(steps: readonly StepSpec[]): readonly Edge[] {
  const edges: Edge[] = [];
  let previous: string | undefined;
  for (const step of steps) {
    if (!step.effect) continue;
    if (previous !== undefined) edges.push([previous, step.id]);
    previous = step.id;
  }
  return edges;
}

/**
 * This function tells if an order of the steps gives the same meaning as the written order.
 * The order must contain each step one time, and it must obey the data edges and the effect edges.
 *
 * @param steps - The steps, in the written order.
 * @param order - The names of the steps in the order to examine.
 * @returns `true` when the order is permitted.
 */
export function isAllowedOrder(steps: readonly StepSpec[], order: readonly string[]): boolean {
  if (order.length !== steps.length) return false;
  if (new Set(order).size !== order.length) return false;
  if (!steps.every((step) => order.includes(step.id))) return false;
  const position = new Map(order.map((id, index) => [id, index] as const));
  return [...dataEdges(steps), ...effectEdges(steps)].every(
    ([before, after]) => (position.get(before) ?? 0) < (position.get(after) ?? 0),
  );
}

/**
 * This function puts the steps in layers. Each step goes one layer after the last step that it must follow.
 * The steps of one layer do not depend on each other, thus they can run at the same time.
 *
 * @param steps - The steps, in the written order.
 * @returns The layers, first to last. Each layer keeps the written order.
 */
export function layers(steps: readonly StepSpec[]): readonly (readonly string[])[] {
  const edges = [...dataEdges(steps), ...effectEdges(steps)];
  const depth = new Map<string, number>();
  for (const step of steps) {
    const before = edges.filter(([, after]) => after === step.id).map(([first]) => depth.get(first) ?? 0);
    depth.set(step.id, before.length === 0 ? 0 : Math.max(...before) + 1);
  }
  const result: string[][] = [];
  for (const step of steps) {
    const at = depth.get(step.id) ?? 0;
    while (result.length <= at) result.push([]);
    result[at]?.push(step.id);
  }
  return result;
}
