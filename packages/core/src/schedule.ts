import type { Key } from "./doc.ts";
import { type Context, type HostThing, type Thing, THING, context as contextOf } from "./deref.ts";
import { type Failed, type Result, Failure, fail, overflowCount } from "./errors.ts";
import { type Machine, type Perform, type StopSignal, rootContext } from "./evaluate.ts";
import { type DurableCounts, type DurableOptions, type Epochs, durable } from "./durable.ts";
import type { DocFacts, StaticRead } from "./facts.ts";
import { type NodeGraph, cycles, deepestFirst } from "./graph.ts";
import type { Issue } from "./static.ts";
import type { Side } from "./world.ts";

/*
 * The interface of a schedule (S1, D31). A host gives named documents. Each document is a node, and the root `world`
 * of each node reaches the other nodes. The static reads give the edges of the graph, and the contracts give the side
 * of each node. A demand evaluates a node and each node that it reads, through `durable`. Thus after a change, a node
 * evaluates again only when one of its reads changed. A demand of the host first demands the nodes that the eager
 * edges reach, deepest first (S2a, D33). Thus a long chain does not use the stack of the host for each node.
 */

/** One edge of a graph of nodes: a static read of a node from the document of another node (SCHED.EDGES). */
export interface NodeEdge {
  /**
   * The node that the read reaches: the first key after the root `world`. It is `undefined` when the read can reach
   * each node, for example the path `["world"]`, or a step document right after the root.
   */
  readonly to: string | undefined;
  /** The keys after the node, up to the first step document: the field of the node that the read reaches (SCHED.GRAIN). */
  readonly field: readonly Key[];
  /** `true` when only a lazy part reaches the read. An evaluation can then give a value without it (FACTS.LAZY). */
  readonly lazy: boolean;
  /** The static read of `factsOf`, with its path, its place and its mark `exact`. */
  readonly read: StaticRead;
}

/** One node of a schedule, with what the static facts tell about it (SCHED.GRAPH). */
export interface NodeInfo {
  /** The name of the node: its key under the root `world`. */
  readonly id: string;
  /** The document of the node. */
  readonly doc: unknown;
  /** The static facts of the document. */
  readonly facts: DocFacts;
  /** The side of the node, from the facts. A node on the run side is a sink: no node reads it (SCHED.SIDE). */
  readonly side: Side;
  /** The edges to the nodes that the document can read, in the order of its reads. */
  readonly edges: readonly NodeEdge[];
}

/** The options of `schedule`: the options of `durable`, and the context of the host. */
export interface ScheduleOptions extends DurableOptions {
  /** The context of the host: the names, `self`, `event` and the capabilities. The schedule sets the root `world` to the nodes. */
  readonly context?: Context;
}

/** The work of a schedule since its start: the work of its `durable` cache, and the demands ahead of a node. */
export interface ScheduleCounts extends DurableCounts {
  /**
   * The demands that a demand of the host made before its own node (SCHED.LONG-CHAIN). Each node that the eager edges
   * reach, and that has no value in the data epoch, adds one.
   */
  readonly ahead: number;
}

/** The options of a run of a node. */
export interface NodeRunOptions {
  /** The event that starts the run, at the root `event`. The default is the event of the context of the host. */
  readonly event?: Thing;
  /** The host code that does each effect, as in `run`. */
  readonly perform?: Perform;
  /** A signal that stops the run. */
  readonly signal?: StopSignal;
}

/**
 * The demand schedule of a graph of named nodes (D31). The host tells it each change of a node, of the machine and of
 * its data. The schedule evaluates a node only when a host or another node reads it.
 */
export interface Schedule {
  /** The epochs of the schedule (DURABLE.EPOCHS). A schedule builds again what depends on the structure when `structure` changes. */
  readonly epochs: Epochs;
  /** The work of the schedule since its start: the compilations, the evaluations, the verifications, the reuses and the demands ahead. */
  readonly counts: ScheduleCounts;
  /** The context of each node in the current data epoch: the context of the host, with the nodes at the root `world`. */
  readonly context: Context;
  /**
   * This function gives each node with its facts, its side and its edges (SCHED.GRAPH). The map stays the same object
   * in one structure epoch, thus a schedule can keep what it computes from it, for example an order.
   *
   * @returns The nodes, by name.
   */
  graph(): ReadonlyMap<string, NodeInfo>;
  /**
   * This function gives the value of a node on demand (SCHED.DEMAND). A read of `world` in the document demands that
   * node first. Each node evaluates at most one time in a data epoch.
   *
   * - First, the schedule demands each node that the eager edges reach, deepest first (SCHED.LONG-CHAIN).
   * - After a change, a pure node verifies its reads, and it keeps its result when each read is the same (SCHED.STALE).
   * - Each node of a cycle gives `#CYCLE!`, in each order of demands (SCHED.CYCLE), at each length (SCHED.DEEP-CYCLE).
   * - A node on the run side gives `#REF!`, because the schedule does not evaluate it (SCHED.SIDE).
   *
   * @param id - The name of the node.
   * @returns The result, or `#N/A` for a node that the schedule does not have.
   */
  read(id: string): Result;
  /**
   * This function adds a node, or gives a node a new document. It is a change of the structure. Only a new document
   * object compiles (DURABLE.STRUCTURE).
   *
   * @param id - The name of the node.
   * @param doc - The document of the node. It must not change in place after this call.
   */
  set(id: string, doc: unknown): void;
  /**
   * This function removes a node. It is a change of the structure, and a read of the node then gives `#N/A`.
   *
   * @param id - The name of the node.
   * @returns `true` when the schedule had the node.
   */
  remove(id: string): boolean;
  /**
   * This function tells the schedule that the data of the host changed (DURABLE.EPOCHS). The values of a context do
   * not change in place, thus new data comes in a new context, or through a host thing.
   *
   * @param context - The new context of the host, or `undefined` to keep the context.
   */
  changeData(context?: Context): void;
  /**
   * This function gives the schedule a new machine. It drops each plan, each fact and each result.
   *
   * @param machine - The new machine.
   */
  changeMachine(machine: Machine): void;
  /**
   * This function starts a run of the document of a node, and the host does each effect (SCHED.RUN). Only the host
   * starts a run, for example at an event. A change of data does not start or repeat a run (L3).
   *
   * @param id - The name of the node.
   * @param options - The event, the host code that does the effects, and a signal to stop the run.
   * @returns The result, when the run ends.
   */
  run(id: string, options?: NodeRunOptions): Promise<Result>;
}

/**
 * This function gives the edges of a node from the static facts of its document (SCHED.EDGES). Each read of the root
 * `world` is an edge to the node of its first key. The keys after that key are the field of the edge (SCHED.GRAIN).
 * A read of another root reads the data of the host, thus it is not an edge.
 *
 * A reference in the value of a node can lead a read to a third node (DEREF.COLLAPSE). The edges do not show such a
 * read, but the reads of an evaluation do (S1d).
 *
 * @param facts - The static facts of the document of the node.
 * @returns The edges, in the order of the reads.
 */
export function edgesOf(facts: DocFacts): readonly NodeEdge[] {
  const edges: NodeEdge[] = [];
  for (const read of facts.reads) {
    if (read.root !== "world") continue;
    const first = read.keys[0];
    edges.push({ to: first === undefined ? undefined : String(first), field: read.keys.length > 1 ? read.keys.slice(1) : NO_KEYS, lazy: read.lazy, read });
  }
  // A list that grows by push keeps room for more edges. A copy of a short list is smaller (PLAN.LEAN).
  return edges.length === 0 ? NO_EDGES : edges.slice();
}

/** No keys, and no edges. One frozen list of each serves each node, thus a schedule of many nodes keeps less. */
const NO_KEYS: readonly Key[] = /* @__PURE__ */ Object.freeze([]);
const NO_EDGES: readonly NodeEdge[] = /* @__PURE__ */ Object.freeze([]);

/** This function gives the error of a node on a cycle. It names only the node, thus each order of demands gives the same error. */
export function cycleOf(id: string): Failed {
  return fail("#CYCLE!", `The node ${id} is on a cycle of reads.`);
}

/** This function gives the error of a read of a node on the run side. */
export function runSide(id: string): Failed {
  return fail("#REF!", `The node ${id} is on the run side, thus it has no value for a reader.`);
}

/** This function gives the error of a node that the schedule does not have. */
function missing(id: string): Failed {
  return fail("#N/A", `The schedule has no node ${id}.`);
}

/** The walk of a data epoch (D139): the result of each node that the walk finished, and the root `world` of the walk. */
interface Walk {
  readonly results: Map<string, Result>;
  readonly context: Context;
}

/** The state of one data epoch: the context of the nodes, the value of each reached node, and the walk after an overflow. */
interface Epoch {
  readonly context: Context;
  readonly values: Map<string, Result>;
  walk?: Walk;
}

/**
 * One certain cycle of a schedule, in the form of an issue of `check` (SCHED.CYCLE-ISSUES). The first node of `nodes`
 * gives the place and the reason. The place is the key of that node under the root `world`, and the reason has the
 * text of `#CYCLE!` for that node.
 */
export interface CycleIssue extends Issue {
  readonly code: "#CYCLE!";
  /** The nodes of the cycle, sorted by name as the record of the root `world` sorts them. */
  readonly nodes: readonly string[];
}

/**
 * This function gives the certain cycles of a schedule before a run (SCHED.CYCLE-ISSUES, D131). It reads only `graph()`,
 * thus it evaluates no node. A host calls it when it needs the answer. A run does not call it.
 *
 * - Each certain cycle of `cycles` gives one issue. The issue has the place `[id]` of its first node.
 * - A possible cycle gives no issue, because a run can skip its lazy read (SCHED.CYCLE-CERTAIN).
 * - The order of the `set` calls does not change the answer (SCHED.CYCLE-ORDER).
 * - No node of an issue gives a value. A read can fail before it reaches the cycle, and the node then gives that
 *   error (SCHED.CYCLE-AGREES). Thus the demand of D33 still gives the result of each node.
 *
 * @param target - The schedule, or another object that gives a graph of nodes.
 * @returns One issue for each certain cycle, sorted by the first node of each issue.
 */
export function checkCycles(target: { graph(): NodeGraph<string> }): readonly CycleIssue[] {
  const out: CycleIssue[] = [];
  for (const cycle of cycles(target.graph())) {
    if (!cycle.certain) continue;
    const nodes = [...cycle.nodes].sort();
    const first = nodes[0] as string;
    out.push({ code: "#CYCLE!", place: [first], reason: cycleOf(first).error.reason, nodes });
  }
  return out.sort((a, b) => ((a.nodes[0] as string) < (b.nodes[0] as string) ? -1 : 1));
}

/**
 * This function makes the demand schedule of a graph of named nodes (S1, R4, D31). A host gives each node a name and
 * a document. The root `world` of each node reaches the other nodes by name. The context of the host gives the other
 * roots.
 *
 * - `graph()` gives the facts, the side and the edges of each node, from `factsOf` and `edgesOf`.
 * - `read(id)` evaluates a node on demand, through `durable`. A pure node verifies its reads after a change, and a
 *   read of a node demands that node again. Thus only a node with a changed read evaluates again: the red-green
 *   algorithm of rustc.
 * - A node is on a cycle when its demand reaches itself through the reads of the evaluations. Each node of such a
 *   strongly connected component gives `#CYCLE!`, whatever its document does with the error. The schedule finds the
 *   components with the algorithm of Tarjan over the demands. Thus each order of demands gives the same values.
 * - A demand of the host, or of a run, first demands each node that the eager edges reach, deepest first. Thus each
 *   read of such a node finds a value, and a chain of 100000 nodes does not overflow the stack (SCHED.LONG-CHAIN).
 *   Each such demand starts with no node in evaluation, thus the order of demands keeps the values of D31.
 * - After an overflow of the stack, a walk with its own stack follows the same reads. It gives each node of a cycle
 *   `#CYCLE!` at each length (SCHED.DEEP-CYCLE, D139). A demand without an overflow does no such work.
 * - A node on the run side is a sink. Only `run` evaluates it, and only the host uses `run`.
 *
 * The host keeps the promises of `durable`. The documents and the values of a context do not change in place.
 *
 * @param machine - The machine of the first structure epoch.
 * @param options - The options of `durable`, and the context of the host.
 * @returns The schedule.
 */
export function schedule(machine: Machine, options: ScheduleOptions = {}): Schedule {
  const { context: given, ...cacheOptions } = options;
  const cache = durable(machine, cacheOptions);
  const docs = new Map<string, unknown>();
  const edges = new WeakMap<DocFacts, readonly NodeEdge[]>();
  let base: Context = given ?? contextOf();
  let now: Epoch | undefined;
  let nodes: { readonly structure: number; readonly map: ReadonlyMap<string, NodeInfo> } | undefined;

  // The nodes in evaluation, in the order of their demands. The top of the stack is the node whose read demands.
  const stack: string[] = [];
  const busy = new Set<string>();
  // The algorithm of Tarjan over the demands: the order of each demand, the lowest order that the node reaches, and
  // the nodes of the components that are still open.
  const order = new Map<string, number>();
  const low = new Map<string, number>();
  const open: string[] = [];
  const onOpen = new Set<string>();
  // The nodes in evaluation that read themselves.
  const looped = new Set<string>();
  // The length of the stack at the kept read that resolves at this time, or -1 without such a read (SCHED.OWN-NODE).
  let keptAt = -1;
  let count = 0;
  let ahead = 0;
  // The node that stopped the evaluation of a walk, because the walk has no result for it.
  let wanted: string | undefined;

  const lower = (id: string, to: number): void => {
    if (to < (low.get(id) as number)) low.set(id, to);
  };

  /** This function closes the open components down to an index of the list `open`. */
  const close = (from: number): number => {
    let size = 0;
    while (open.length > from) {
      const id = open.pop() as string;
      onOpen.delete(id);
      order.delete(id);
      low.delete(id);
      size += 1;
    }
    return size;
  };

  /** This function gives the edges of the facts of a document. They stay for each facts object, as the facts stay for each document. */
  const edgesFrom = (facts: DocFacts): readonly NodeEdge[] => {
    let found = edges.get(facts);
    if (found === undefined) {
      found = edgesOf(facts);
      edges.set(facts, found);
    }
    return found;
  };

  /** This function gives the edges of a node, for the walk of a demand. A known node, a missing node and a node on the run side need no walk. */
  const edgesFor = (id: string): readonly NodeEdge[] | undefined => {
    if (current().values.has(id) || !docs.has(id)) return undefined;
    const facts = cache.facts(docs.get(id));
    return facts.side === "run" ? undefined : edgesFrom(facts);
  };

  /**
   * This function gives the value of a node. A demand of the host or of a run has no node in evaluation. It first
   * demands each node that the eager edges reach, deepest first. Each of these demands also starts with no node in
   * evaluation, thus it is a demand of the host too. D31 gives each order of such demands the same values.
   */
  const demand = (id: string): Result => {
    if (stack.length > 0) return visit(id);
    for (const first of deepestFirst(id, edgesFor)) {
      ahead += 1;
      hostDemand(first);
    }
    return hostDemand(id);
  };

  /**
   * This function demands one node with no node in evaluation. An overflow of the stack, in this demand or earlier in
   * the data epoch, makes a walk from the node. A `#DEPTH!` of an earlier demand can stop a read of this demand.
   */
  const hostDemand = (id: string): Result => {
    const before = overflowCount();
    const result = visit(id);
    return overflowCount() === before && current().walk === undefined ? result : settle(id, result);
  };

  /** This function demands one node, with the algorithm of Tarjan over the demands for the cycles of D31. */
  const visit = (id: string): Result => {
    const epoch = current();
    const reader = stack[stack.length - 1];
    const known = epoch.values.get(id);
    if (known !== undefined) {
      // A finished node of an open component is on a cycle with its reader too.
      if (reader !== undefined && onOpen.has(id)) lower(reader, order.get(id) as number);
      return known;
    }
    if (busy.has(id)) {
      // The evaluation of a node did not ask for its kept read of the node itself, thus that read closes no cycle (SCHED.OWN-NODE).
      if (reader === id && keptAt === stack.length) return cycleOf(id);
      // A read of a node in evaluation closes a cycle. It gives the same error as the final result of that node.
      if (reader !== undefined) lower(reader, order.get(id) as number);
      if (reader === id) looped.add(id);
      return cycleOf(id);
    }
    const doc = docs.get(id);
    if (cache.facts(doc).side === "run") {
      const refused = runSide(id);
      epoch.values.set(id, refused);
      return refused;
    }
    const mine = count++;
    order.set(id, mine);
    low.set(id, mine);
    const from = open.length;
    open.push(id);
    onOpen.add(id);
    busy.add(id);
    stack.push(id);
    let result: Result | undefined;
    try {
      result = cache.evaluate(id, doc, epoch.context);
    } finally {
      stack.pop();
      busy.delete(id);
      // An exception of the host leaves the node without a result. A later demand evaluates it again.
      if (result === undefined) {
        looped.delete(id);
        // This loop calls no function of the module. Near the limit of the stack such a call can fail. Then this node
        // stays open, and its reader finds two nodes in its component, as on a cycle (SCHED.DEEP-CYCLE-CHAIN).
        while (open.length > from) {
          const left = open.pop() as string;
          onOpen.delete(left);
          order.delete(left);
          low.delete(left);
        }
      }
    }
    const reached = low.get(id) as number;
    const self = looped.delete(id);
    let value = result;
    if (reached < mine) {
      // The node reaches an earlier node that is still open, thus it is in that component.
      value = cycleOf(id);
    } else if (close(from) > 1 || self) {
      value = cycleOf(id);
    } else if (!result.ok && result.error.code === "#DEPTH!") {
      // An overflow of the stack depends on the depth of the demand, not on the node (D15).
      cache.forget(id);
    }
    epoch.values.set(id, value);
    if (reader !== undefined) lower(reader, reached);
    return value;
  };

  /** This function gives the walk of a data epoch. Its root `world` answers from the walk, and each other read stops the evaluation. */
  const startWalk = (): Walk => {
    const results = new Map<string, Result>();
    const stop = new Failure(fail("#CALC!", "A walk stopped this evaluation at a read.").error);
    const read = (id: string): Result => {
      // After the first stop, a document that catches the error reads nothing more: such a read does not happen.
      if (wanted !== undefined) throw stop;
      const reader = stack[stack.length - 1] as string;
      const known = results.get(id);
      if (known !== undefined) {
        if (onOpen.has(id)) lower(reader, order.get(id) as number);
        return known;
      }
      if (busy.has(id)) {
        lower(reader, order.get(id) as number);
        if (reader === id) looped.add(id);
        return cycleOf(id);
      }
      if (cache.facts(docs.get(id)).side === "run") {
        const refused = runSide(id);
        results.set(id, refused);
        return refused;
      }
      wanted = id;
      throw stop;
    };
    return { results, context: rooted(worldOf(results, read)) };
  };

  /** This function gives the node that stopped the last evaluation of a walk, and it clears the mark. */
  const takeWanted = (): string | undefined => {
    const id = wanted;
    wanted = undefined;
    return id;
  };

  /**
   * This function follows the reads of the evaluations from a node after an overflow of the stack (SCHED.DEEP-CYCLE,
   * D139). `visit` uses the stack of the host for each node. This walk uses the lists of `visit` as its own stack.
   *
   * An evaluation has no nested demand. A read of a node without a result stops the evaluation, and the walk finishes
   * that node. Then the reader evaluates again. Thus the algorithm of Tarjan of `visit` finds each cycle of real reads.
   *
   * Each evaluation enters a new node or finishes a node. Thus the walks of a data epoch do at most `2V` evaluations
   * for `V` entered nodes. They keep one result and one entry in each list for each such node.
   *
   * A walk that reaches no cycle changes nothing, thus a chain keeps its `#DEPTH!`. After a cycle, each entered node
   * keeps only its error. A node with a value evaluates again at its next demand, because a value can hold the root of
   * the walk.
   *
   * @param id - The node of the demand.
   * @param given - The result of the demand.
   * @returns The final result of the demand.
   */
  const settle = (id: string, given: Result): Result => {
    const epoch = current();
    const walk = (epoch.walk ??= startWalk());
    const { results } = walk;
    if (results.has(id) || cache.facts(docs.get(id)).side === "run") return given;
    const entered: string[] = [];
    const starts: number[] = [];
    const enter = (node: string): void => {
      const mine = count++;
      order.set(node, mine);
      low.set(node, mine);
      starts.push(open.length);
      open.push(node);
      onOpen.add(node);
      busy.add(node);
      stack.push(node);
      entered.push(node);
    };
    let found = false;
    // An overflow can stop `visit` between two steps of its lists. The walk starts with empty lists.
    close(0);
    looped.clear();
    enter(id);
    try {
      while (stack.length > 0) {
        const node = stack[stack.length - 1] as string;
        const result = cache.plan(docs.get(node)).evaluate(walk.context);
        const next = takeWanted();
        if (next !== undefined) {
          enter(next);
          continue;
        }
        stack.pop();
        busy.delete(node);
        const from = starts.pop() as number;
        const reached = low.get(node) as number;
        const self = looped.delete(node);
        const onCycle = reached < (order.get(node) as number) || close(from) > 1 || self;
        results.set(node, onCycle ? cycleOf(node) : result);
        // A node behind a cycle of an earlier walk finds that cycle too.
        found ||= onCycle || (!result.ok && result.error.code === "#CYCLE!");
        const reader = stack[stack.length - 1];
        if (reader !== undefined) lower(reader, reached);
      }
    } finally {
      takeWanted();
      stack.length = 0;
      busy.clear();
      looped.clear();
      close(0);
    }
    if (!found) return given;
    for (const node of entered) {
      const result = results.get(node) as Result;
      cache.forget(node);
      if (result.ok) epoch.values.delete(node);
      else epoch.values.set(node, result);
    }
    return visit(id);
  };

  /** This function gives the record of the derive nodes, for a path that ends at the root `world`. */
  const record = (get: (id: string) => Result): unknown => {
    const out: Record<string, unknown> = {};
    for (const id of [...docs.keys()].sort()) {
      if (cache.facts(docs.get(id)).side === "run") continue;
      const result = get(id);
      if (!result.ok) throw new Failure(result.error);
      Object.defineProperty(out, id, { value: result.value, enumerable: true, writable: true, configurable: true });
    }
    return out;
  };

  /** This function gives the host thing at the root `world`: `get` gives the result of a node, and `values` holds each final result. */
  const worldOf = (values: ReadonlyMap<string, Result>, get: (id: string) => Result): HostThing => ({
    [THING]: true,
    label: "nodes",
    deref(key) {
      const id = String(key);
      if (!docs.has(id)) return undefined;
      const result = get(id);
      // A failed node gives its own error to each reader, as a failed attribute of a tree does (D16).
      if (!result.ok) throw new Failure(result.error);
      return result.value;
    },
    has: (key) => docs.has(String(key)),
    toJson: () => record(get),
    // A demand from a kept read can reach the node in evaluation, and that cycle is false (SCHED.ONE-MEANING).
    // Thus only a node with its result in this epoch gives a value. Each such value is final (D31).
    known(key) {
      const result = values.get(String(key));
      if (result === undefined) return undefined;
      if (!result.ok) throw new Failure(result.error);
      return { thing: result.value };
    },
    // A kept read that a reference leads to a node still demands that node, and only its own node gives no cycle.
    // A nested demand has a longer stack, thus each read of its evaluation counts (SCHED.OWN-NODE).
    keeping(read) {
      const outer = keptAt;
      keptAt = stack.length;
      try {
        return read();
      } finally {
        keptAt = outer;
      }
    },
  });

  // The context has a world, thus `rootContext` only gives it its grant (CAP.NARROW-CODE). Each evaluation of the
  // epoch then uses this object with no copy.
  const rooted = (world: HostThing): Context => rootContext(machine, { ...base, world });

  /**
   * This function gives the state of the current data epoch. Each data epoch has a new host thing at the root
   * `world`. Thus a read that reaches the whole root changes at each change of data (READS.KEPT). A kept read of a
   * closure reads a node through `known`, without a demand (SCHED.CLOSURE).
   */
  const current = (): Epoch => {
    if (now !== undefined) return now;
    const values = new Map<string, Result>();
    now = { context: rooted(worldOf(values, demand)), values };
    return now;
  };

  const changed = (structure: boolean): void => {
    if (structure) cache.changeStructure();
    else cache.changeData();
    now = undefined;
  };

  return {
    get epochs() {
      return cache.epochs;
    },
    get counts() {
      return { ...cache.counts, ahead };
    },
    get context() {
      return current().context;
    },
    graph() {
      const structure = cache.epochs.structure;
      if (nodes?.structure === structure) return nodes.map;
      const map = new Map<string, NodeInfo>();
      for (const [id, doc] of docs) {
        const facts = cache.facts(doc);
        map.set(id, { id, doc, facts, side: facts.side, edges: edgesFrom(facts) });
      }
      nodes = { structure, map };
      return map;
    },
    read: (id) => (docs.has(id) ? demand(id) : missing(id)),
    set(id, doc) {
      docs.set(id, doc);
      changed(true);
    },
    remove(id) {
      if (!docs.delete(id)) return false;
      cache.forget(id);
      changed(true);
      return true;
    },
    changeData(next) {
      if (next !== undefined) base = next;
      changed(false);
    },
    changeMachine(next) {
      cache.changeStructure(next);
      now = undefined;
    },
    run(id, runOptions = {}) {
      if (!docs.has(id)) return Promise.resolve(missing(id));
      const ctx = current().context;
      return cache.plan(docs.get(id)).run(runOptions.event === undefined ? ctx : { ...ctx, event: runOptions.event }, {
        ...(runOptions.perform === undefined ? {} : { perform: runOptions.perform }),
        ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
      });
    },
  };
}
