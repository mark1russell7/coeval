/**
 * The steps of a language (STEPS.*). A step is a level of the power of a language. A low step accepts only programs
 * that end for a known reason, for example loops with a fixed count. A high step accepts more programs. The language
 * declares the step of each construct as data. `stepOf` gives the lowest step that a document needs, with the reason,
 * and `checkStep` compares that step with the highest step that the host accepts. A document cannot raise its own
 * step, because the declaration and the limit come from the language and the host. The ladder of `ask` (`ladder.ts`)
 * is a different thing: it finds the evaluator of a verb.
 */

/** A key of a path from the root to a node: a field name or a position. */
export type StepKey = string | number;

/** The steps of a language, from the lowest to the highest, and the step that each construct needs. It is data. */
export interface StepLadder<S extends string = string> {
  /** The names of the steps, from the lowest to the highest. */
  readonly steps: readonly S[];
  /** The step that each construct needs. A construct without an entry needs the lowest step. */
  readonly constructs: Readonly<Record<string, S>>;
}

/** The walk of the documents of a language. The language gives these two functions. */
export interface StepWalk<N> {
  /** This function gives the name of the construct of a node, or `undefined` for a node without a construct. */
  readonly construct: (node: N) => string | undefined;
  /** This function gives the child nodes of a node in document order, each with the key of its path. */
  readonly children: (node: N) => Iterable<readonly [StepKey, N]>;
}

/** The reason for a step: the first node in document order whose construct needs that step. */
export interface StepReason<N, S extends string = string> {
  /** The name of the construct. */
  readonly construct: string;
  /** The step that the construct needs. */
  readonly step: S;
  /** The keys from the root to the node. The root has the empty path. */
  readonly path: readonly StepKey[];
  readonly node: N;
}

/** The lowest step that a document needs. */
export interface StepNeed<N, S extends string = string> {
  readonly step: S;
  /** The reason. It is `undefined` when no construct needs more than the lowest step. */
  readonly reason?: StepReason<N, S>;
}

/** The refusal of a document whose step is higher than the limit of the host. */
export interface StepRefusal<N, S extends string = string> {
  /** The step that the document needs. */
  readonly needed: S;
  /** The highest step that the host accepts. */
  readonly maxStep: S;
  /** The reason of the step. A need that a host makes without `stepOf` can have no reason. */
  readonly reason?: StepReason<N, S>;
  /** The text of the refusal. It names the needed step and the limit, and the construct and its path of the reason. */
  readonly message: string;
}

/**
 * This function makes a ladder of steps, and it checks the declaration (STEPS.LADDER). The list of steps must have one
 * step or more, with no name two times. The step of each construct must be a step of the list.
 *
 * @param steps - The names of the steps, from the lowest to the highest.
 * @param constructs - The step that each construct needs.
 * @returns The ladder, frozen.
 * @throws TypeError for a declaration that is not valid, because it is a defect of the language.
 */
export function stepLadder<const S extends string>(steps: readonly S[], constructs: Readonly<Record<string, NoInfer<S>>>): StepLadder<S> {
  if (steps.length === 0) throw new TypeError("a ladder of steps needs one step or more");
  const seen = new Set<string>();
  for (const step of steps) {
    if (typeof step !== "string") throw new TypeError(`the step ${String(step)} is not a name`);
    if (seen.has(step)) throw new TypeError(`the step "${step}" is in the ladder two times`);
    seen.add(step);
  }
  for (const [construct, step] of Object.entries(constructs)) {
    if (!seen.has(step)) throw new TypeError(`the construct "${construct}" needs the step "${String(step)}", which is not a step of the ladder`);
  }
  return Object.freeze({ steps: Object.freeze([...steps]), constructs: Object.freeze({ ...constructs }) });
}

/**
 * This function tells if a value is a step of a ladder. A host uses it to check its option for the highest step.
 *
 * @param ladder - The ladder.
 * @param value - The value.
 * @returns `true` when the value is the name of a step of the ladder.
 */
export function isStep<S extends string>(ladder: StepLadder<S>, value: unknown): value is S {
  return typeof value === "string" && ladder.steps.includes(value as S);
}

/**
 * This function gives the position of a step in its ladder. The lowest step has the position 0.
 *
 * @param ladder - The ladder.
 * @param step - The step.
 * @returns The position.
 * @throws TypeError for a name that is not a step of the ladder.
 */
export function stepRank<S extends string>(ladder: StepLadder<S>, step: S): number {
  const rank = ladder.steps.indexOf(step);
  if (rank < 0) throw new TypeError(`"${String(step)}" is not a step of the ladder. The steps are ${ladder.steps.join(", ")}`);
  return rank;
}

/** An item of the walk: a node, the key of its path and the item of its parent. Thus a path costs nothing until a reason needs it. */
interface Visit<N> {
  readonly node: N;
  readonly key: StepKey | undefined;
  readonly parent: Visit<N> | undefined;
}

function pathOf<N>(visit: Visit<N>): StepKey[] {
  const path: StepKey[] = [];
  for (let v: Visit<N> | undefined = visit; v?.key !== undefined; v = v.parent) path.push(v.key);
  return path.reverse();
}

/**
 * This function gives the lowest step that a document needs, with the reason (STEPS.LOWEST, STEPS.REASON). The step is
 * the highest step of the constructs of its nodes. The reason is the first node in document order with that step. The
 * walk uses its own stack, thus a deep document does not overflow (STEPS.LINEAR). It visits a shared node one time,
 * and it stops at the first node with the highest step of the ladder.
 *
 * @param ladder - The ladder of the language.
 * @param walk - The construct and the child nodes of a node.
 * @param root - The root node of the document.
 * @returns The step, and the reason when the step is not the lowest step.
 */
export function stepOf<N, S extends string>(ladder: StepLadder<S>, walk: StepWalk<N>, root: N): StepNeed<N, S> {
  const top = ladder.steps.length - 1;
  let best = 0;
  let reason: StepReason<N, S> | undefined;
  const seen = new Set<unknown>();
  const todo: Visit<N>[] = [{ node: root, key: undefined, parent: undefined }];
  for (let visit = todo.pop(); visit !== undefined; visit = todo.pop()) {
    const { node } = visit;
    if (typeof node === "object" && node !== null) {
      if (seen.has(node)) continue;
      seen.add(node);
    }
    const construct = walk.construct(node);
    const step = construct === undefined || !Object.hasOwn(ladder.constructs, construct) ? undefined : ladder.constructs[construct];
    const rank = step === undefined ? 0 : ladder.steps.indexOf(step);
    if (rank > best) {
      best = rank;
      reason = { construct: construct as string, step: step as S, path: pathOf(visit), node };
      if (best === top) break;
    }
    const kids = [...walk.children(node)];
    for (let i = kids.length - 1; i >= 0; i--) {
      const [key, child] = kids[i] as readonly [StepKey, N];
      todo.push({ node: child, key, parent: visit });
    }
  }
  const step = ladder.steps[best] as S;
  return reason === undefined ? { step } : { step, reason };
}

/**
 * This function compares the step of a document with the highest step that the host accepts (STEPS.MAX). The limit
 * changes only which documents the host accepts. The language evaluates an accepted document as before, thus a limit
 * does not change a value.
 *
 * @param ladder - The ladder of the language.
 * @param need - The step of the document, from `stepOf`.
 * @param maxStep - The highest step that the host accepts.
 * @returns `undefined` when the host accepts the document, or the refusal that names the needed step.
 * @throws TypeError when `maxStep` or the step of `need` is not a step of the ladder.
 */
export function checkStep<N, S extends string>(ladder: StepLadder<S>, need: StepNeed<N, S>, maxStep: S): StepRefusal<N, S> | undefined {
  const limit = stepRank(ladder, maxStep);
  const needed = stepRank(ladder, need.step);
  if (needed <= limit) return undefined;
  const head = `the document needs the step ${need.step}, and the host accepts the steps up to ${maxStep}`;
  const reason = need.reason;
  if (reason === undefined) return { needed: need.step, maxStep, message: head };
  const where = reason.path.length === 0 ? "at the root" : `at the path ${JSON.stringify(reason.path)}`;
  return { needed: need.step, maxStep, reason, message: `${head}. The construct "${reason.construct}" ${where} needs the step ${reason.step}` };
}
