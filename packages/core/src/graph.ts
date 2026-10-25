import type { Side } from "./world.ts";

/*
 * The analysis of a graph of nodes (S2, R4 P5, D33). A host gives each node with its edges: the nodes that it reads.
 * The analysis gives the strongly connected components, the heights of a push schedule, the layers of independent
 * nodes, the nodes that an observer needs and the static cycles. Each function walks the graph with its own stack,
 * not with the stack of the host. Thus a chain of 100000 nodes does not overflow (GRAPH.SCC).
 */

/** One edge of a graph of nodes: a read of a node by another node. `NodeEdge` of a schedule is such an edge. */
export interface GraphEdge<Id> {
  /** The node that the read reaches. It is `undefined` when the read can reach each node (GRAPH.UNKNOWN). */
  readonly to: Id | undefined;
  /** `true` when only a lazy part reaches the read. An evaluation can then give a value without it (FACTS.LAZY). */
  readonly lazy: boolean;
}

/** One node of a graph, with its edges. `NodeInfo` of a schedule is such a node. */
export interface GraphNode<Id> {
  /** The edges to the nodes that the node reads. */
  readonly edges: readonly GraphEdge<Id>[];
  /** The side of the node. A node on the run side is a sink: no edge reaches it (SCHED.SIDE). The default is `derive`. */
  readonly side?: Side;
}

/**
 * A graph of nodes, by name. The order of the map is the order of the nodes in each answer. The function `graph` of
 * a schedule gives such a graph. An edge to a name that is not in the map, or to a sink, is not an edge of the
 * analysis.
 */
export type NodeGraph<Id> = ReadonlyMap<Id, GraphNode<Id>>;

/** The options of an analysis. */
export interface GraphOptions {
  /**
   * `true`: the analysis keeps only the eager edges with a target node. Such a read occurs in each evaluation in
   * which each document around it gives a value (FACTS.LAZY). The default keeps each edge.
   */
  readonly eager?: boolean;
}

/** One static cycle of a graph (GRAPH.CYCLE). */
export interface GraphCycle<Id> {
  /** The nodes of the cycle, in the order of the graph. */
  readonly nodes: readonly Id[];
  /**
   * `true` when the eager edges with a target close the cycle. `false` when the cycle needs a lazy edge or an edge
   * without a target. The value of each node still comes from the demand (D31).
   */
  readonly certain: boolean;
}

/**
 * A graph with a number for each node, and its edges in arrays. The edges of the node `v` are the items of `targets`
 * from `start[v]` up to `start[v + 1]`. An edge without a target goes to the extra node `all`, and `all` reaches each
 * node that is not a sink. Thus such an edge costs one edge, not one edge for each node.
 */
interface Indexed<Id> {
  readonly ids: readonly Id[];
  /** The count of the nodes, with the node `all` when the graph has it. */
  readonly size: number;
  readonly start: Int32Array;
  readonly targets: Int32Array;
  /** The number of the node `all`, or `-1` when no edge goes to it. */
  readonly all: number;
}

/** This function gives the indexed form of a graph, with the edges that the options keep. */
function indexed<Id>(graph: NodeGraph<Id>, options: GraphOptions): Indexed<Id> {
  const eager = options.eager === true;
  const ids = [...graph.keys()];
  const count = ids.length;
  const numbers = new Map<Id, number>();
  const sink = new Uint8Array(count);
  ids.forEach((id, index) => {
    numbers.set(id, index);
    if (graph.get(id)?.side === "run") sink[index] = 1;
  });
  const start = new Int32Array(count + 2);
  const targets: number[] = [];
  let unknown = false;
  let from = 0;
  for (const node of graph.values()) {
    start[from] = targets.length;
    for (const edge of node.edges) {
      if (eager && edge.lazy) continue;
      if (edge.to === undefined) {
        if (eager) continue;
        unknown = true;
        targets.push(count);
        continue;
      }
      const to = numbers.get(edge.to);
      if (to !== undefined && sink[to] === 0) targets.push(to);
    }
    from += 1;
  }
  start[count] = targets.length;
  if (unknown) for (let to = 0; to < count; to += 1) if (sink[to] === 0) targets.push(to);
  start[count + 1] = targets.length;
  return { ids, size: unknown ? count + 1 : count, start, targets: Int32Array.from(targets), all: unknown ? count : -1 };
}

/** The strongly connected components of an indexed graph. */
interface Strong {
  /** The number of the component of each node. */
  readonly of: Int32Array;
  /** The nodes of each component. Each component comes after each component that it reaches. */
  readonly list: readonly (readonly number[])[];
}

/**
 * This function finds the strongly connected components with the algorithm of Tarjan. It keeps its own stack of
 * calls in two arrays, thus a long chain does not overflow the stack of the host. Each component comes after each
 * component that its nodes reach: the deepest component comes first.
 */
function strong(graph: Indexed<unknown>): Strong {
  const { size, start, targets } = graph;
  const order = new Int32Array(size).fill(-1);
  const low = new Int32Array(size);
  const of = new Int32Array(size).fill(-1);
  // The nodes of the components that are still open.
  const open = new Int32Array(size);
  const onOpen = new Uint8Array(size);
  // The stack of calls: a node, and the position of its next edge.
  const calls = new Int32Array(size);
  const next = new Int32Array(size);
  const list: number[][] = [];
  let top = 0;
  let count = 0;
  const enter = (node: number, depth: number): void => {
    order[node] = count;
    low[node] = count;
    count += 1;
    open[top] = node;
    top += 1;
    onOpen[node] = 1;
    calls[depth] = node;
    next[depth] = start[node] as number;
  };
  for (let root = 0; root < size; root += 1) {
    if (order[root] !== -1) continue;
    enter(root, 0);
    let depth = 1;
    while (depth > 0) {
      const node = calls[depth - 1] as number;
      const edge = next[depth - 1] as number;
      if (edge < (start[node + 1] as number)) {
        next[depth - 1] = edge + 1;
        const to = targets[edge] as number;
        if (order[to] === -1) {
          enter(to, depth);
          depth += 1;
        } else if (onOpen[to] === 1 && (order[to] as number) < (low[node] as number)) {
          low[node] = order[to] as number;
        }
        continue;
      }
      depth -= 1;
      if (low[node] === order[node]) {
        const members: number[] = [];
        let member: number;
        do {
          top -= 1;
          member = open[top] as number;
          onOpen[member] = 0;
          of[member] = list.length;
          members.push(member);
        } while (member !== node);
        list.push(members.sort((a, b) => a - b));
      }
      if (depth > 0) {
        const reader = calls[depth - 1] as number;
        if ((low[node] as number) < (low[reader] as number)) low[reader] = low[node] as number;
      }
    }
  }
  return { of, list };
}

/** This function tells if a component has a cycle: two or more nodes, or one node with an edge to itself. */
function cyclic(graph: Indexed<unknown>, members: readonly number[]): boolean {
  if (members.length > 1) return true;
  const node = members[0] as number;
  for (let edge = graph.start[node] as number; edge < (graph.start[node + 1] as number); edge += 1) if (graph.targets[edge] === node) return true;
  return false;
}

/** This function gives the names of the nodes of a component, without the node `all`. */
function named<Id>(graph: Indexed<Id>, members: readonly number[]): Id[] {
  const out: Id[] = [];
  for (const member of members) if (member !== graph.all) out.push(graph.ids[member] as Id);
  return out;
}

/** This function gives the height of each component, in the order of `strong`. The node `all` adds no height. */
function heightsOf(graph: Indexed<unknown>, found: Strong): Int32Array {
  const { start, targets } = graph;
  const heights = new Int32Array(found.list.length);
  found.list.forEach((members, component) => {
    let highest = -1;
    let real = false;
    for (const node of members) {
      if (node !== graph.all) real = true;
      for (let edge = start[node] as number; edge < (start[node + 1] as number); edge += 1) {
        const other = found.of[targets[edge] as number] as number;
        if (other !== component && (heights[other] as number) > highest) highest = heights[other] as number;
      }
    }
    heights[component] = real ? highest + 1 : highest;
  });
  return heights;
}

/**
 * This function gives the strongly connected components of a graph of nodes (GRAPH.SCC), with the algorithm of
 * Tarjan. It keeps its own stack, thus a chain of 100000 nodes does not overflow the stack of the host.
 *
 * - Each component comes after each component that it reads: the deepest component comes first.
 * - A node that is on no cycle is a component of one node.
 * - The nodes of a component are in the order of the graph.
 *
 * @param graph - The nodes, each with its edges.
 * @param options - The option `eager` keeps only the eager edges with a target node.
 * @returns The components, deepest first.
 */
export function components<Id>(graph: NodeGraph<Id>, options: GraphOptions = {}): readonly (readonly Id[])[] {
  const index = indexed(graph, options);
  const out: (readonly Id[])[] = [];
  for (const members of strong(index).list) {
    const names = named(index, members);
    if (names.length > 0) out.push(names);
  }
  return out;
}

/**
 * This function gives the height of each node: the order of a push schedule (GRAPH.ORDER). A schedule that evaluates
 * the nodes from the lowest height up evaluates each node after each node that it reads, except on a cycle.
 *
 * - A node that reads no node outside its component has the height 0.
 * - Each other node is one higher than the highest node that it reads outside its component.
 * - The nodes of one component have one height.
 * - An edge without a target reads each node that is not a sink (GRAPH.UNKNOWN).
 *
 * @param graph - The nodes, each with its edges.
 * @param options - The option `eager` keeps only the eager edges with a target node.
 * @returns The height of each node, in the order of the graph.
 */
export function heights<Id>(graph: NodeGraph<Id>, options: GraphOptions = {}): ReadonlyMap<Id, number> {
  const index = indexed(graph, options);
  const found = strong(index);
  const levels = heightsOf(index, found);
  const out = new Map<Id, number>();
  index.ids.forEach((id, node) => out.set(id, levels[found.of[node] as number] as number));
  return out;
}

/**
 * This function puts the nodes in layers by their heights, in linear time (GRAPH.LAYERS). The first layer has the
 * height 0. Two nodes of one layer read each other only inside one component. Thus a push schedule can evaluate the
 * components of one layer at the same time.
 *
 * @param graph - The nodes, each with its edges.
 * @param options - The option `eager` keeps only the eager edges with a target node.
 * @returns The layers, from the height 0 up. Each layer keeps the order of the graph.
 */
export function nodeLayers<Id>(graph: NodeGraph<Id>, options: GraphOptions = {}): readonly (readonly Id[])[] {
  const out: Id[][] = [];
  for (const [id, height] of heights(graph, options)) {
    while (out.length <= height) out.push([]);
    out[height]?.push(id);
  }
  return out;
}

/**
 * This function gives the nodes that a set of observed nodes needs (GRAPH.NECESSARY). These are the observed nodes,
 * and each node with a path of edges from them. A push schedule evaluates only these nodes. An observed name that is
 * not a node of the graph adds nothing.
 *
 * @param graph - The nodes, each with its edges.
 * @param observed - The nodes that the host shows or reads.
 * @param options - The option `eager` keeps only the eager edges with a target node.
 * @returns The necessary nodes, in the order of the graph.
 */
export function necessary<Id>(graph: NodeGraph<Id>, observed: Iterable<Id>, options: GraphOptions = {}): ReadonlySet<Id> {
  const index = indexed(graph, options);
  const numbers = new Map<Id, number>();
  index.ids.forEach((id, node) => numbers.set(id, node));
  const seen = new Uint8Array(index.size);
  const work: number[] = [];
  for (const id of observed) {
    const node = numbers.get(id);
    if (node === undefined || seen[node] === 1) continue;
    seen[node] = 1;
    work.push(node);
  }
  while (work.length > 0) {
    const node = work.pop() as number;
    for (let edge = index.start[node] as number; edge < (index.start[node + 1] as number); edge += 1) {
      const to = index.targets[edge] as number;
      if (seen[to] === 1) continue;
      seen[to] = 1;
      work.push(to);
    }
  }
  const out = new Set<Id>();
  index.ids.forEach((id, node) => {
    if (seen[node] === 1) out.add(id);
  });
  return out;
}

/**
 * This function gives the static cycles of a graph (GRAPH.CYCLE): each component with two or more nodes, and each
 * node with an edge to itself. A cycle of the eager edges with a target is certain, and `check` or a host can report
 * it before a run. Another cycle is possible: an evaluation can skip a lazy read.
 *
 * - A component of all the edges that is also a component of the eager edges is one certain cycle.
 * - Each other component of all the edges is one possible cycle, and each certain cycle in it comes after it.
 * - A read can still fail before it occurs. Thus the demand of D31, not a static cycle, gives the value of each node.
 *
 * @param graph - The nodes, each with its edges.
 * @returns The cycles, deepest first.
 */
export function cycles<Id>(graph: NodeGraph<Id>): readonly GraphCycle<Id>[] {
  const every = indexed(graph, {});
  const found = strong(every);
  const eager = indexed(graph, { eager: true });
  // The certain cycles, by the component of all the edges that holds them.
  const inside = new Map<number, (readonly number[])[]>();
  for (const members of strong(eager).list) {
    if (!cyclic(eager, members)) continue;
    const component = found.of[members[0] as number] as number;
    const list = inside.get(component);
    if (list === undefined) inside.set(component, [members]);
    else list.push(members);
  }
  const out: GraphCycle<Id>[] = [];
  found.list.forEach((members, component) => {
    if (!cyclic(every, members)) return;
    const nodes = named(every, members);
    const certain = inside.get(component) ?? [];
    if (certain.length === 1 && certain[0]?.length === nodes.length) {
      out.push({ nodes, certain: true });
      return;
    }
    out.push({ nodes, certain: false });
    for (const part of certain) out.push({ nodes: named(eager, part), certain: true });
  });
  return out;
}

/**
 * This function gives the nodes that a demand of a node needs first, deepest first (SCHED.LONG-CHAIN). It follows the
 * eager edges with a target from the node, with its own stack. Each node comes after each node that it reads, except
 * on a cycle, as in an order by heights. The walk costs only the nodes that it enters.
 *
 * @param from - The node of the demand. It is not in the answer.
 * @param edgesOf - This function gives the edges of a node, or `undefined` for a node that the walk does not enter.
 * @returns The nodes, deepest first.
 */
export function deepestFirst<Id>(from: Id, edgesOf: (id: Id) => readonly GraphEdge<Id>[] | undefined): readonly Id[] {
  const out: Id[] = [];
  const first = edgesOf(from);
  if (first === undefined) return out;
  const seen = new Set<Id>([from]);
  const nodes: Id[] = [from];
  const lists: (readonly GraphEdge<Id>[])[] = [first];
  const positions: number[] = [0];
  while (nodes.length > 0) {
    const top = nodes.length - 1;
    const edges = lists[top] as readonly GraphEdge<Id>[];
    let position = positions[top] as number;
    let entered = false;
    while (position < edges.length) {
      const edge = edges[position] as GraphEdge<Id>;
      position += 1;
      const to = edge.to;
      if (edge.lazy || to === undefined || seen.has(to)) continue;
      seen.add(to);
      const more = edgesOf(to);
      if (more === undefined) continue;
      positions[top] = position;
      nodes.push(to);
      lists.push(more);
      positions.push(0);
      entered = true;
      break;
    }
    if (entered) continue;
    const done = nodes.pop() as Id;
    lists.pop();
    positions.pop();
    if (nodes.length > 0) out.push(done);
  }
  return out;
}
