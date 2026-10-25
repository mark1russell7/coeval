import type { Key } from "./doc.ts";
import { type Context, type HostThing, type Thing, THING, context as contextOf } from "./deref.ts";
import { type Failed, type Result, Failure, fail } from "./errors.ts";
import { type Machine, type Perform, type StopSignal, rootContext } from "./evaluate.ts";
import { type DurableCounts, type DurableOptions, type Epochs, durable } from "./durable.ts";
import type { DocFacts, StaticRead } from "./facts.ts";
import { deepestFirst } from "./graph.ts";
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
   * - Each node of a cycle gives `#CYCLE!`, in each order of demands (SCHED.CYCLE).
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
    edges.push({ to: first === undefined ? undefined : String(first), field: read.keys.slice(1), lazy: read.lazy, read });
  }
  return edges;
}

/** This function gives the error of a node on a cycle. It names only the node, thus each order of demands gives the same error. */
function cycleOf(id: string): Failed {
  return fail("#CYCLE!", `The node ${id} is on a cycle of reads.`);
}

/** This function gives the error of a read of a node on the run side. */
function runSide(id: string): Failed {
  return fail("#REF!", `The node ${id} is on the run side, thus it has no value for a reader.`);
}

/** This function gives the error of a node that the schedule does not have. */
function missing(id: string): Failed {
  return fail("#N/A", `The schedule has no node ${id}.`);
}

/** The state of one data epoch: the context of the nodes, and the value of each node that a demand reached. */
interface Epoch {
  readonly context: Context;
  readonly values: Map<string, Result>;
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
  let count = 0;
  let ahead = 0;

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
    if (stack.length === 0) {
      for (const first of deepestFirst(id, edgesFor)) {
        ahead += 1;
        visit(first);
      }
    }
    return visit(id);
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
        close(from);
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

  /** This function gives the record of the derive nodes, for a path that ends at the root `world`. */
  const record = (): unknown => {
    const out: Record<string, unknown> = {};
    for (const id of [...docs.keys()].sort()) {
      if (cache.facts(docs.get(id)).side === "run") continue;
      const result = demand(id);
      if (!result.ok) throw new Failure(result.error);
      Object.defineProperty(out, id, { value: result.value, enumerable: true, writable: true, configurable: true });
    }
    return out;
  };

  /**
   * This function gives the state of the current data epoch. Each data epoch has a new host thing at the root
   * `world`. Thus a read that reaches the whole root changes at each change of data (READS.KEPT).
   */
  const current = (): Epoch => {
    if (now !== undefined) return now;
    const nodesThing: HostThing = {
      [THING]: true,
      label: "nodes",
      deref(key) {
        const id = String(key);
        if (!docs.has(id)) return undefined;
        const result = demand(id);
        // A failed node gives its own error to each reader, as a failed attribute of a tree does (D16).
        if (!result.ok) throw new Failure(result.error);
        return result.value;
      },
      has: (key) => docs.has(String(key)),
      toJson: record,
    };
    // The context has a world, thus `rootContext` only gives it its grant (CAP.NARROW-CODE). Each evaluation of the
    // epoch then uses this object with no copy.
    now = { context: rootContext(machine, { ...base, world: nodesThing }), values: new Map() };
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
