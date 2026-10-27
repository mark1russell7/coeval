import {
  STD_CAPS,
  STD_MACHINE,
  evaluate,
  fromJson,
  isHostThing,
  isKey,
  makeContext,
  typeName,
  type EvalFn,
  type Evaluator,
  type Hop,
  type Json,
  type Key,
  type Machine,
  type Resolution,
  type Thing,
} from "@mark1russell7/coeval";
import { getAt } from "./edit.ts";

/** One move of the path of a reference: a hop from one place of the document to the next place. */
export interface Move {
  /** The path of the reference document that holds the path. */
  readonly ref: readonly string[];
  /** The position of the move in the path of the reference, from 0. */
  readonly index: number;
  /** The text of the step: a root, a key, or the kind of a step document and its argument. */
  readonly step: string;
  /** The place where the move starts. The first move starts at the reference itself. */
  readonly from: readonly string[];
  /** The place that the move reaches. */
  readonly to: readonly string[];
}

/** One resolution of a reference during the evaluation, with the place of the reference and its node. */
interface Seen {
  readonly place: readonly string[];
  readonly path: readonly Json[];
  readonly resolution: Resolution;
}

const NO_NAMES: Readonly<Record<string, Json>> = {};

function text(place: readonly Key[]): readonly string[] {
  return place.map(String);
}

function startsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((key, index) => path[index] === key);
}

/**
 * This function gives the text of one step of a path. A key gives itself. A step document gives its kind, and the
 * type that it asks for when it has one.
 */
export function stepText(step: Json): string {
  if (isKey(step)) return String(step);
  if (Array.isArray(step)) return step.map(String).join(".");
  const envelope = fromJson(step);
  if (envelope === undefined) return JSON.stringify(step);
  const value = envelope.value;
  const wanted = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, Json>>)["type"] : undefined;
  return typeof wanted === "string" ? `${typeName(envelope.type)} ${wanted}` : typeName(envelope.type);
}

/** The facts that one evaluation records: each resolution of a reference, and the place of each node of a tree. */
interface Recorded {
  readonly seen: readonly Seen[];
  readonly nodes: ReadonlyMap<Thing, readonly string[]>;
}

/** This function wraps one evaluator of a machine. A compiled evaluator is not a function, thus it stays as it is. */
function wrap(machine: Machine, name: string, around: (base: EvalFn) => EvalFn): Readonly<Record<string, Evaluator>> {
  const base = machine.evaluators[name];
  if (typeof base !== "function") return machine.evaluators;
  return { ...machine.evaluators, [name]: around(base) };
}

/**
 * This function evaluates a document, and records two facts of the model. The first is each node of a tree with its
 * place. The second is each resolution of a reference, with its hops.
 */
function record(machine: Machine, doc: Json, names: Readonly<Record<string, Json>>): Recorded {
  const seen: Seen[] = [];
  const nodes = new Map<Thing, readonly string[]>();
  const treePlaces: (readonly string[])[] = [];
  const holders: { readonly thing: Thing; readonly place: readonly string[] }[] = [];
  let evaluators = wrap(machine, "tree.node", (base) => (input) => {
    treePlaces.push(text(input.place));
    // The self of the context of a node is its parent node, or the node that holds the tree.
    if (isHostThing(input.context.self)) holders.push({ thing: input.context.self, place: text(input.place) });
    const result = base(input);
    // A node inside an open tree gives its host thing. The root gives the JSON of the tree, and its children find its thing.
    if (result.ok && isHostThing(result.value)) nodes.set(result.value, text(input.place));
    return result;
  });
  evaluators = wrap({ ...machine, evaluators }, "ref.resolve", (base) => (input) => {
    if (Array.isArray(input.data)) {
      const path: readonly Json[] = input.data;
      if (isHostThing(input.context.self)) holders.push({ thing: input.context.self, place: text(input.place) });
      seen.push({ place: text(input.place), path, resolution: input.resolve(path, { hops: true }) });
    }
    return base(input);
  });
  evaluate({ ...machine, evaluators }, doc, makeContext(names, STD_CAPS));
  // A node that no evaluator gave as a value is the root of a tree. The places that it holds find its place.
  for (const holder of holders) {
    if (nodes.has(holder.thing)) continue;
    const place = enclosingNode(treePlaces, holder.place);
    if (place !== undefined) nodes.set(holder.thing, place);
  }
  return { seen, nodes };
}

/** This function gives the longest place of a node evaluation that holds a place, but is not the place itself. */
function enclosingNode(treePlaces: readonly (readonly string[])[], place: readonly string[]): readonly string[] | undefined {
  let best: readonly string[] | undefined;
  for (const candidate of treePlaces) {
    if (candidate.length < place.length && startsWith(place, candidate) && (best === undefined || candidate.length > best.length)) best = candidate;
  }
  return best;
}

/**
 * This function finds the place of the document that one hop reached. A node of a tree has its own place. A key from
 * a known place goes to the part with that key, when the document has it. Else the place is unknown.
 */
function placeOfHop(doc: Json, hop: Hop, before: readonly string[] | undefined, nodes: ReadonlyMap<Thing, readonly string[]>): readonly string[] | undefined {
  const node = nodes.get(hop.thing);
  if (node !== undefined) return node;
  if (before === undefined || hop.by === "root" || hop.by === "collapse" || hop.by === "step") return undefined;
  const keys = Array.isArray(hop.step) ? hop.step : [hop.step];
  if (!keys.every(isKey)) return undefined;
  const place = [...before, ...keys.map(String)];
  return getAt(doc, place) === undefined ? undefined : place;
}

/** One reference of a document: the moves of its path, and the outcome of its resolution by the model. */
export interface RefTrace {
  /** The path of the reference document. */
  readonly ref: readonly string[];
  /** The path of the reference. */
  readonly path: readonly Json[];
  /** `true` when the resolution reached the end of the path. */
  readonly ok: boolean;
  /** The code and the reason of a failed resolution. */
  readonly error?: { readonly code: string; readonly reason: string };
  /** `true` when each hop reached a place of the document. Else the moves stop at the first hop without a place. */
  readonly placed: boolean;
  /** The moves of the path, in the order of its steps. */
  readonly moves: readonly Move[];
}

/**
 * This function traces each reference of a document. The model evaluates the document, and its resolution of each
 * reference gives the hops. Each hop that reaches a place of the document gives a move. A path that starts at a root
 * without a place, for example `names`, has no moves.
 *
 * @param doc - The document.
 * @param names - The names of the context.
 * @param machine - The machine that evaluates the document. The default is the standard machine.
 * @returns One trace for each reference, in the order of the evaluation.
 */
export function refTraces(doc: Json, names: Readonly<Record<string, Json>> = NO_NAMES, machine: Machine = STD_MACHINE): readonly RefTrace[] {
  const { seen, nodes: nodePlaces } = record(machine, doc, names);
  const out: RefTrace[] = [];
  const done = new Set<string>();
  for (const item of seen) {
    const key = item.place.join("/");
    if (done.has(key)) continue;
    // An equation of a kind also holds references, but its places are not places of this document.
    const at = fromJson(getAt(doc, item.place));
    if (at === undefined || typeName(at.type) !== "ref" || JSON.stringify(at.value) !== JSON.stringify(item.path)) continue;
    done.add(key);
    const moves: Move[] = [];
    let from: readonly string[] = item.place;
    let before: readonly string[] | undefined;
    let placed = true;
    for (const hop of item.resolution.hops) {
      const to = hop.by === "root" ? nodePlaces.get(hop.thing) : placeOfHop(doc, hop, before, nodePlaces);
      if (to === undefined) {
        placed = false;
        break;
      }
      before = to;
      if (to.join("/") === from.join("/")) continue;
      moves.push({ ref: item.place, index: moves.length, step: stepText(hop.step), from, to });
      from = to;
    }
    const { resolution } = item;
    const trace: RefTrace = { ref: item.place, path: item.path, ok: resolution.ok, placed, moves };
    out.push(resolution.ok ? trace : { ...trace, error: { code: resolution.code, reason: resolution.reason } });
  }
  return out;
}

/**
 * This function lists each move of each path that goes through the places of a document. The model evaluates the
 * document, and its resolution of each reference gives the hops. A path that starts at a root without a place, for
 * example `names`, has no moves. The list stops at the first hop that reaches no place of the document.
 *
 * @param doc - The document.
 * @param names - The names of the context.
 * @param machine - The machine that evaluates the document. The default is the standard machine.
 * @returns The moves, in the order of the references and of their steps.
 */
export function moveLinks(doc: Json, names: Readonly<Record<string, Json>> = NO_NAMES, machine: Machine = STD_MACHINE): readonly Move[] {
  return refTraces(doc, names, machine).flatMap((trace) => trace.moves);
}
