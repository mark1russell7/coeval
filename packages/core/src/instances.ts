import { type Json, type Key, field, isKey, isRecord, typeName } from "./doc.ts";
import { type CollectRule, type Kind, collectOf, equationType } from "./world.ts";
import { ask } from "./ladder.ts";
import { isRef, walkerOf } from "./deref.ts";
import type { Machine } from "./evaluate.ts";
import { type Above, codeFactsOf, partLazy } from "./facts.ts";
import { type NodeGraph, type GraphEdge, cycles } from "./graph.ts";
import { STD_WALKERS } from "./stdlib.ts";
import {
  type CheckOptions,
  type DocVisit,
  type Issue,
  type SeenNode,
  REF_CODE,
  TREE_NODE,
  downNames,
  isStructural,
  keepsSelf,
  selvesOf,
  walk,
} from "./static.ts";

/*
 * The graph of attribute instances (R3 P5, D107). Each vertex is one attribute of one node of the decorated tree of a
 * document. Each edge is one read: the attribute that the read reaches, and the attribute whose code reads it. The
 * edges come from the references of the code of each attribute, and from the rungs of its ladder. A read that depends
 * on the value of an attribute gets an edge with an unknown source. `check` reports each certain cycle before a run.
 * The evaluator of the kernel does not use the graph (D3).
 */

/** One vertex of the graph of attribute instances: one attribute of one node of the decorated tree (D107). */
export interface AttributeVertex {
  /** The name of the vertex: the JSON text of the place of the node with the name of the attribute after it. */
  readonly id: string;
  /** The place of the document of the node. */
  readonly place: readonly Key[];
  readonly attribute: string;
  /** The text of the type of the node. */
  readonly type: string;
  /** `true` when the kind of the node declares the attribute `circular` (TREE.CIRCULAR-CHECK). Else the field is absent. */
  readonly circular?: true;
}

/** One read of an attribute by the code of another attribute (D107). */
export interface AttributeEdge {
  /** The vertex that the read reaches. It is `undefined` when only the run knows it: the read depends on a value. */
  readonly from: string | undefined;
  /** The vertex whose code makes the read. */
  readonly to: string;
  /** `true` when only a lazy part reaches the read, or when an earlier rung can answer first (FACTS.LAZY). */
  readonly lazy: boolean;
  /** The place of the reference document. A read of a rung has the place of the node. */
  readonly place: readonly Key[];
}

/** One cycle of the graph of attribute instances (D107). */
export interface AttributeCycle {
  /** The vertices of the cycle, in the order of the graph. */
  readonly vertices: readonly string[];
  /** `true` when the eager reads with a known source close the cycle (GRAPH.CYCLE). */
  readonly certain: boolean;
  /**
   * `true` when each attribute of the cycle is circular: the run gives its fixed point, thus `check` gives no issue
   * (TREE.CIRCULAR-CHECK). Else the field is absent.
   */
  readonly circular?: true;
}

/** The graph of attribute instances of a document (TREE.GRAPH). */
export interface AttributeGraph {
  /** The vertices, by name, in the order of the document. */
  readonly vertices: ReadonlyMap<string, AttributeVertex>;
  /** The edges, in the order of the code of each vertex. */
  readonly edges: readonly AttributeEdge[];
  /** The graph for the analysis of `graph.ts`: each vertex with the vertices that it reads. */
  readonly graph: NodeGraph<string>;
  /** The edges with an unknown source. The check of the cycles is not complete for them: only the run knows them. */
  readonly unknown: readonly AttributeEdge[];
  /** The cycles of the graph, deepest first. */
  readonly cycles: readonly AttributeCycle[];
}

/** The options of `attributeGraph`. */
export interface AttributeGraphOptions {
  /** The type of a bare root value. */
  readonly declaredType?: string;
}

/**
 * This function gives the name of a vertex of the graph of attribute instances. The name is the JSON text of the
 * place of the node, with the name of the attribute after it.
 *
 * @param place - The place of the document of the node.
 * @param attribute - The name of the attribute.
 * @returns The name of the vertex.
 */
export function attributeVertexId(place: readonly Key[], attribute: string): string {
  return JSON.stringify([...place, attribute]);
}

/** One node of the decorated tree of the document. */
interface NodeInfo {
  readonly visit: DocVisit;
  readonly kind: Kind;
  readonly text: string;
  /** The names of the own parts, in the order of the parts. */
  readonly own: readonly string[];
  /** The document of each own part. */
  readonly parts: Map<string, DocInfo>;
  /** The parent node of the same tree. `null`: the node is the root of a tree. `undefined`: the check does not know it. */
  readonly up: NodeInfo | null | undefined;
}

/** One document of the document: its code, its node, and the items of a list. */
interface DocInfo {
  readonly visit: DocVisit;
  readonly evaluator: string | undefined;
  readonly node: NodeInfo | undefined;
  /** The documents of the items of a list, by their index. */
  readonly items: Map<number, DocInfo>;
}

/** The attribute that a document is a part of: the nearest node around it, and the own part of that node. */
interface Owner {
  readonly node: NodeInfo;
  readonly key: string;
}

/** The state of a visit: its document, its attribute and its lazy mark from the start of the attribute. */
interface VisitState {
  readonly info: DocInfo;
  readonly owner: Owner | undefined;
  readonly lazy: boolean;
  readonly above: Above;
}

/** The value that a step reaches before the run. It is a node, a list document, data, a value outside the tree, or unknown. */
type Value = { readonly node: NodeInfo } | { readonly list: DocInfo } | "data" | "outside" | "unknown";

/** One reference of an equation of a kind, for each node of the kind (D107). */
interface TermRef {
  readonly path: readonly Json[];
  readonly lazy: boolean;
  /** `true` when the self of the reference is the node of the equation. */
  readonly self: boolean;
  /** The names that a kind inside the equation binds for the reference. */
  readonly bound: ReadonlySet<string>;
  /** `true` for code that the check does not know: its reads are not known before the run. */
  readonly opaque: boolean;
}

/** The standard code whose value is the plain data of its document. */
const DATA: ReadonlySet<string> = /* @__PURE__ */ new Set(["data.number", "data.text", "data.bool"]);

/** The standard code of a list. Its value holds the value of each item, in the order of the items. */
const LIST = "list.all";

/** The self of the root of a walk: the self of the context, outside each tree of the document. */
const OUTSIDE: SeenNode = { kind: { verbs: {} }, text: "", own: undefined, parent: undefined };

/** The self of an equation, for the references of the equation. */
const EQUATION_SELF: SeenNode = { kind: { verbs: {} }, text: "", own: undefined, parent: undefined };

const NO_BOUND: ReadonlySet<string> = /* @__PURE__ */ new Set();

/** This function gives the name of an own part from the slot of its document. */
function slotKey(slot: readonly Key[]): string {
  return slot.map(String).join(".");
}

/** This function gives the value of a document before the run. */
function valueOf(info: DocInfo | undefined): Value {
  if (info === undefined) return "unknown";
  if (info.node !== undefined) return { node: info.node };
  if (info.evaluator === LIST) return { list: info };
  return info.evaluator !== undefined && DATA.has(info.evaluator) ? "data" : "unknown";
}

/** This function tells if a table of a tree contract has its own entry for a name. */
function hasOwnEntry(table: Readonly<Record<string, unknown>> | undefined, name: string): boolean {
  return table !== undefined && Object.hasOwn(table, name);
}

/** The builder of one graph: the vertices, the edges and the reads of the rungs. */
interface Builder {
  readonly machine: Machine;
  readonly vertices: Map<string, AttributeVertex>;
  readonly nodes: Map<string, NodeInfo>;
  readonly edges: AttributeEdge[];
  /** The JSON path of the document of each edge, for an issue. */
  readonly ats: (readonly Key[])[];
  /** The vertices whose rungs the builder did not read yet. */
  readonly work: string[];
  readonly terms: Map<Kind, Map<string, readonly TermRef[]>>;
}

/** A read in progress: the vertex that reads, the lazy mark, the place and the JSON path of the read. */
interface Reader {
  readonly to: string;
  readonly lazy: boolean;
  readonly place: readonly Key[];
  readonly at: readonly Key[];
}

/** This function tells if the kind of a node declares an attribute `circular` (D113). */
function isCircular(kind: Kind, attribute: string): boolean {
  const declared = hasOwnEntry(kind.tree?.attributes, attribute) ? kind.tree?.attributes?.[attribute] : undefined;
  return declared?.circular !== undefined;
}

/** This function gives the vertex of an attribute of a node. A new vertex goes on the work list for its rungs. */
function vertexOf(b: Builder, node: NodeInfo, attribute: string): string {
  const id = attributeVertexId(node.visit.place, attribute);
  if (!b.vertices.has(id)) {
    const vertex: AttributeVertex = { id, place: node.visit.place, attribute, type: node.text };
    b.vertices.set(id, isCircular(node.kind, attribute) ? { ...vertex, circular: true } : vertex);
    b.nodes.set(id, node);
    if (!node.parts.has(attribute)) b.work.push(id);
  }
  return id;
}

function edge(b: Builder, from: string | undefined, r: Reader, lazy = false): void {
  b.edges.push({ from, to: r.to, lazy: r.lazy || lazy, place: r.place });
  b.ats.push(r.at);
}

/** This function gives the items of a list document, in the order of their indices. */
function itemsOf(list: DocInfo): readonly DocInfo[] {
  return [...list.items].sort(([x], [y]) => x - y).map(([, item]) => item);
}

/**
 * This function gives the attributes that the JSON of a value reads, in their order (TREE.RESULT). A node reads each
 * own part, with the JSON of each node in its value after it. A list gives the JSON of each item.
 */
function jsonOrder(value: Value, out: [NodeInfo, string][], done: Set<NodeInfo>): void {
  if (typeof value !== "object") return;
  if ("list" in value) {
    for (const item of itemsOf(value.list)) jsonOrder(valueOf(item), out, done);
    return;
  }
  const node = value.node;
  if (done.has(node)) return;
  done.add(node);
  for (const key of node.own) {
    out.push([node, key]);
    jsonOrder(valueOf(node.parts.get(key)), out, done);
  }
}

/** This function adds the reads of the JSON of a value. */
function jsonReads(b: Builder, value: Value, r: Reader): void {
  const order: [NodeInfo, string][] = [];
  jsonOrder(value, order, new Set());
  for (const [node, key] of order) edge(b, vertexOf(b, node, key), r);
}

/** This function gives the node that a walker `nearest` with the key `parent` reaches before the run. */
function nearestOf(start: NodeInfo, data: Json | undefined): Value {
  const follow = isRecord(data) && typeof field(data, "follow") === "string" ? String(field(data, "follow")) : "parent";
  if (follow !== "parent") return "unknown";
  const wanted = isRecord(data) ? field(data, "type") : undefined;
  let at: NodeInfo | null | undefined = isRecord(data) && field(data, "self") === true ? start : start.up;
  while (at !== null && at !== undefined) {
    if (at.text === wanted) return { node: at };
    at = at.up;
  }
  return at === null ? "outside" : "unknown";
}

/**
 * This function follows the steps of a path from a value, and it adds each read on the way (TREE.GRAPH). A step
 * `parent` goes to the parent node, and a step `type` gives data. Another key reads an attribute. A walker `nearest`
 * with the key `parent` depends only on the structure. A step after a value that only the run knows gives an edge with
 * an unknown source. A path that ends at a node reads the JSON of the node.
 */
function follow(b: Builder, start: Value, path: readonly Json[], from: number, r: Reader): void {
  let here = start;
  for (let index = from; index < path.length; index += 1) {
    const step = path[index];
    if (here === "unknown") {
      edge(b, undefined, r);
      return;
    }
    if (here === "data" || here === "outside") return;
    if ("list" in here) {
      if (!isKey(step)) {
        edge(b, undefined, r);
        return;
      }
      if (step === "length") {
        here = "data";
        continue;
      }
      const at = typeof step === "number" ? step : /^\d+$/.test(step) ? Number(step) : -1;
      const item = here.list.items.get(at);
      if (item === undefined) return;
      here = valueOf(item);
      continue;
    }
    const node = here.node;
    if (isKey(step)) {
      const key = String(step);
      if (key === "parent") here = node.up === null ? "outside" : node.up === undefined ? "unknown" : { node: node.up };
      else if (isStructural(key)) here = "data";
      else {
        edge(b, vertexOf(b, node, key), r);
        here = valueOf(node.parts.get(key));
      }
      continue;
    }
    // The standard walker nearest depends only on the structure (R3 P5). Each other walker can read each attribute.
    if (walkerOf(b.machine, step) !== STD_WALKERS["walk.nearest"]) {
      edge(b, undefined, r);
      return;
    }
    here = nearestOf(node, isRecord(step) ? field(step, "value") : undefined);
  }
  // The value of a reference to a node is the JSON of the node. A list keeps its items.
  if (typeof here === "object" && "node" in here) jsonReads(b, here, r);
}

/**
 * This function gives the references of an equation of a kind, with the self and the lazy mark of each (D107). It walks
 * the equation with the rules of `check`, thus a reference keeps the self of the equation only through standard code.
 */
function termRefs(b: Builder, kind: Kind, label: string, term: Json): readonly TermRef[] {
  let byLabel = b.terms.get(kind);
  if (byLabel === undefined) {
    byLabel = new Map();
    b.terms.set(kind, byLabel);
  }
  const known = byLabel.get(label);
  if (known !== undefined) return known;
  const out: TermRef[] = [];
  const of = equationType(kind);
  const selves = selvesOf(b.machine, "eval", EQUATION_SELF);
  const above = new Map<DocVisit, Above>();
  walk(
    b.machine.world,
    term,
    (v) => {
      const answer = ask(b.machine.world, v.declared ? {} : v.doc, "eval", v.declared ? { declaredType: typeName(v.doc.type) } : {});
      if (answer.error === "unknown-kind") return "skip";
      const up = v.parent === undefined ? undefined : above.get(v.parent);
      const lazy = up !== undefined && v.parent !== undefined && (up.lazy || partLazy(up, v.parent, v.slot));
      above.set(v, { lazy, rules: v.kind === undefined ? undefined : codeFactsOf(b.machine, v, v.kind, "eval").rules });
      const { self } = selves.enter(v, answer.evaluator);
      const evaluator = answer.evaluator;
      if (evaluator === REF_CODE && isRef(v.doc)) {
        if (v.address !== true) out.push({ path: v.doc.value, lazy, self: self === EQUATION_SELF, bound: v.names, opaque: false });
      } else if (self === EQUATION_SELF && evaluator !== TREE_NODE && !keepsSelf(evaluator)) {
        out.push({ path: [], lazy, self: true, bound: NO_BOUND, opaque: true });
      }
      return undefined;
    },
    of === undefined ? {} : { declaredType: of },
  );
  byLabel.set(label, out);
  return out;
}

/** The names of the equation of a rung, before the run. */
interface TermNames {
  readonly child?: NodeInfo;
  readonly prev?: Value;
}

/** This function adds the reads of an equation of a rung: self is a node, and the names of the rung have their values. */
function termReads(b: Builder, refs: readonly TermRef[], self: NodeInfo, names: TermNames | undefined, r: Reader): void {
  for (const ref of refs) {
    const read: Reader = ref.lazy ? { ...r, lazy: true } : r;
    if (ref.opaque) {
      edge(b, undefined, read);
      continue;
    }
    const root = ref.path[0];
    if (root === "self") {
      if (ref.self) follow(b, { node: self }, ref.path, 1, read);
      else if (ref.path.length > 1) edge(b, undefined, read);
      continue;
    }
    if (root !== "names" || ref.path.length < 2) continue;
    const name = String(ref.path[1]);
    // A name that a kind inside the equation binds holds a value of the run. The others are the names of the rung.
    let start: Value;
    if (ref.bound.has(name)) start = "unknown";
    else if (names?.child !== undefined && name === "child") start = { node: names.child };
    else if (names?.prev !== undefined && name === "prev") start = names.prev;
    else if (name === "index") start = "data";
    else if (name === "acc" || name === "item") start = "unknown";
    else continue;
    follow(b, start, ref.path, 2, read);
  }
}

/** This function gives the previous sibling of a node in the list `children` of its parent, before the run. */
function prevOf(parent: NodeInfo, child: NodeInfo): Value {
  const list = parent.parts.get("children");
  if (list === undefined || list.evaluator !== LIST) return "unknown";
  for (const [index, item] of list.items) {
    if (item.node !== child) continue;
    return index === 0 ? "data" : valueOf(list.items.get(index - 1));
  }
  return "data";
}

/**
 * This function adds the reads of the rungs of an attribute that is not an own part, in the order of the ladder
 * (TREE.LADDER). After a rung that can fail to answer, the reads of the later rungs are lazy.
 */
function rungReads(b: Builder, id: string): void {
  const node = b.nodes.get(id) as NodeInfo;
  const key = (b.vertices.get(id) as AttributeVertex).attribute;
  const tree = node.kind.tree;
  const r: Reader = { to: id, lazy: false, place: node.visit.place, at: node.visit.at };
  const equation = hasOwnEntry(tree?.equations, key) ? tree?.equations?.[key] : undefined;
  if (equation !== undefined) {
    termReads(b, termRefs(b, node.kind, `tree.equations.${key}`, equation), node, undefined, r);
    return;
  }
  let later = r;
  const up = node.up;
  if (up === undefined) {
    // A parent that the check does not know can answer with each name of down in the world (WORLD.OPEN).
    if (downNames(b.machine.world).has(key)) {
      edge(b, undefined, r);
      later = { ...r, lazy: true };
    }
  } else if (up !== null) {
    const down = hasOwnEntry(up.kind.tree?.down, key) ? up.kind.tree?.down?.[key] : undefined;
    if (down !== undefined) {
      edge(b, vertexOf(b, up, "children"), r);
      termReads(b, termRefs(b, up.kind, `tree.down.${key}`, down), up, { child: node, prev: prevOf(up, node) }, r);
      return;
    }
  }
  const declared = hasOwnEntry(tree?.attributes, key) ? tree?.attributes?.[key] : undefined;
  if (declared?.copy === true && up !== null) {
    edge(b, up === undefined ? undefined : vertexOf(b, up, key), later);
    later = { ...later, lazy: true };
  }
  const fold = declared?.fold;
  if (fold !== undefined) {
    termReads(b, termRefs(b, node.kind, `tree.attributes.${key}.fold.unit`, fold.unit), node, undefined, later);
    edge(b, vertexOf(b, node, "children"), later);
    const children = valueOf(node.parts.get("children"));
    let combined = false;
    if (children === "unknown") edge(b, undefined, later);
    else if (typeof children === "object" && "list" in children) {
      for (const item of itemsOf(children.list)) {
        const child = item.node;
        if (child === undefined) continue;
        edge(b, vertexOf(b, child, key), later);
        combined = true;
      }
    }
    // The combine evaluates once for each child node, thus without a known child node its reads are lazy.
    termReads(b, termRefs(b, node.kind, `tree.attributes.${key}.fold.combine`, fold.combine), node, undefined, combined ? later : { ...later, lazy: true });
    return;
  }
  const collect = declared?.collect === undefined ? undefined : collectOf(declared.collect);
  if (collect?.ok === true) {
    collectReads(b, node, key, collect, later);
    return;
  }
  if (declared?.default !== undefined) termReads(b, termRefs(b, node.kind, `tree.attributes.${key}.default`, declared.default), node, undefined, later);
}

/** This function gives the list children of a node before the run. A node without a rung for it has no children. */
function childrenOf(b: Builder, at: NodeInfo): Value {
  const part = at.parts.get("children");
  if (part !== undefined) return valueOf(part);
  const tree = at.kind.tree;
  if (hasOwnEntry(tree?.equations, "children") || hasOwnEntry(tree?.attributes, "children")) return "unknown";
  if (at.up === undefined) return downNames(b.machine.world).has("children") ? "unknown" : "data";
  return at.up !== null && hasOwnEntry(at.up.kind.tree?.down, "children") ? "unknown" : "data";
}

/**
 * This function adds the reads of a collection (TREE.COLLECT, D122), in the order of the run. Each node of the subtree
 * gives the reads of its contribution and of its list `children`. A list that only the run knows gives an edge with an
 * unknown source. The registry of names reads only the lists `children`.
 */
function collectReads(b: Builder, node: NodeInfo, key: string, rule: CollectRule & { readonly ok: true }, later: Reader): void {
  if (!rule.names) termReads(b, termRefs(b, node.kind, `tree.attributes.${key}.collect.unit`, rule.unit), node, undefined, later);
  let combined = false;
  const done = new Set<NodeInfo>();
  const stack: NodeInfo[] = [node];
  while (stack.length > 0) {
    const at = stack.pop() as NodeInfo;
    if (done.has(at)) continue;
    done.add(at);
    const term = rule.names || !hasOwnEntry(at.kind.tree?.contributes, key) ? undefined : at.kind.tree?.contributes?.[key];
    if (term !== undefined) {
      termReads(b, termRefs(b, at.kind, `tree.contributes.${key}`, term), at, undefined, later);
      combined = true;
    }
    edge(b, vertexOf(b, at, "children"), later);
    const children = childrenOf(b, at);
    if (children === "unknown") edge(b, undefined, later);
    else if (typeof children === "object" && "list" in children) {
      const items = itemsOf(children.list);
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const child = items[index]?.node;
        if (child !== undefined && child.up === at) stack.push(child);
      }
    }
  }
  // The combine evaluates once for each contribution, thus without a known contribution its reads are lazy.
  if (!rule.names) termReads(b, termRefs(b, node.kind, `tree.attributes.${key}.collect.combine`, rule.combine), node, undefined, combined ? later : { ...later, lazy: true });
}

/** The vertices and the edges of a document, and the roots of the demand of the run: the own parts of each tree root. */
interface Built {
  readonly b: Builder;
  readonly roots: readonly NodeInfo[];
}

function build(machine: Machine, doc: unknown, declaredType: string | undefined): Built {
  const b: Builder = { machine, vertices: new Map(), nodes: new Map(), edges: [], ats: [], work: [], terms: new Map() };
  const roots: NodeInfo[] = [];
  const all: NodeInfo[] = [];
  const reads: { readonly owner: Owner; readonly v: DocVisit; readonly lazy: boolean; readonly self: Value; readonly opaque: boolean }[] = [];
  const states = new Map<DocVisit, VisitState>();
  const nodes = new Map<SeenNode, NodeInfo>();
  const selves = selvesOf(machine, "eval", OUTSIDE);
  walk(
    machine.world,
    doc,
    (v) => {
      const answer = ask(machine.world, v.declared ? {} : v.doc, "eval", v.declared ? { declaredType: typeName(v.doc.type) } : {});
      if (answer.error === "unknown-kind") return "skip";
      const evaluator = answer.evaluator;
      const parent = v.parent === undefined ? undefined : states.get(v.parent);
      const { self, node: seen } = selves.enter(v, evaluator);
      let owner: Owner | undefined;
      let lazy = false;
      if (parent?.info.node !== undefined) owner = { node: parent.info.node, key: slotKey(v.slot) };
      else if (parent !== undefined && v.parent !== undefined) {
        owner = parent.owner;
        lazy = parent.lazy || partLazy(parent.above, v.parent, v.slot);
      }
      let node: NodeInfo | undefined;
      if (seen !== undefined && v.kind !== undefined) {
        const up = self === OUTSIDE ? null : self === undefined ? undefined : nodes.get(self);
        node = { visit: v, kind: v.kind, text: seen.text, own: [...(seen.own ?? [])], parts: new Map(), up };
        nodes.set(seen, node);
        all.push(node);
        // The run reads each own part of a tree root that an eager position holds (TREE.RESULT).
        if (up === null && !lazy) roots.push(node);
      }
      const info: DocInfo = { visit: v, evaluator, node, items: new Map() };
      if (parent?.info.node !== undefined) parent.info.node.parts.set(slotKey(v.slot), info);
      else if (parent?.info.evaluator === LIST && v.slot.length === 1 && typeof v.slot[0] === "number") parent.info.items.set(v.slot[0], info);
      states.set(v, { info, owner, lazy, above: { lazy, rules: v.kind === undefined ? undefined : codeFactsOf(machine, v, v.kind, "eval").rules } });
      if (owner === undefined || node !== undefined) return undefined;
      const value: Value = self === OUTSIDE ? "outside" : self === undefined ? "unknown" : { node: nodes.get(self) as NodeInfo };
      if (evaluator === REF_CODE && isRef(v.doc)) {
        if (v.address !== true) reads.push({ owner, v, lazy, self: value, opaque: false });
      } else if (value !== "unknown" && evaluator !== REF_CODE && !keepsSelf(evaluator)) {
        // Code that the check does not know can read each attribute of its self.
        reads.push({ owner, v, lazy, self: value, opaque: true });
      }
      return undefined;
    },
    declaredType === undefined ? {} : { declaredType },
  );
  for (const node of all) for (const key of node.own) vertexOf(b, node, key);
  for (const { owner, v, lazy, self, opaque } of reads) {
    const r: Reader = { to: vertexOf(b, owner.node, owner.key), lazy, place: v.place, at: v.at };
    if (opaque) {
      edge(b, undefined, r);
      continue;
    }
    const path = v.doc.value as readonly Json[];
    const root = path[0];
    if (root === "self") {
      if (self === "unknown") edge(b, undefined, r);
      else follow(b, self, path, 1, r);
    } else if (root === "names" && path.length >= 2 && v.names.has(String(path[1]))) {
      // A name that a kind binds holds a value of the run, and that value can hold a node.
      edge(b, undefined, r);
    }
  }
  for (let next = b.work.shift(); next !== undefined; next = b.work.shift()) rungReads(b, next);
  return { b, roots };
}

/** This function gives the graph for `graph.ts`: each vertex with the vertices that it reads. */
function nodeGraph(b: Builder): NodeGraph<string> {
  const reads = new Map<string, GraphEdge<string>[]>();
  for (const id of b.vertices.keys()) reads.set(id, []);
  for (const e of b.edges) reads.get(e.to)?.push({ to: e.from, lazy: e.lazy });
  return new Map([...reads].map(([id, edges]) => [id, { edges }] as const));
}

/**
 * This function gives the graph of attribute instances of a document (TREE.GRAPH, R3 P5, D107). It has one vertex for
 * each attribute of each node of the decorated tree. It has one edge for each read of the code of an attribute.
 *
 * - A path from `self` reads the attribute of the node. `self.parent` goes to the parent node.
 * - The step `nearest` with the key `parent` depends only on the structure, thus it goes to a node of the document.
 * - The rungs of the ladder read too: `names.prev` of `down` reads the previous sibling, and a fold reads each child.
 * - A read that depends on the value of an attribute gets an edge with an unknown source.
 *
 * The walk is the walk of `check`, with its rules for the self of each document (D106). The evaluator of the kernel
 * does not use the graph (D3).
 *
 * @param machine - The world and the code of the evaluators.
 * @param doc - The document, as JSON.
 * @param options - The type of a bare root value.
 * @returns The vertices, the edges, the graph for the analysis, the reads that only the run knows and the cycles.
 */
export function attributeGraph(machine: Machine, doc: unknown, options: AttributeGraphOptions = {}): AttributeGraph {
  const { b } = build(machine, doc, options.declaredType);
  const graph = nodeGraph(b);
  return {
    vertices: b.vertices,
    edges: b.edges,
    graph,
    unknown: b.edges.filter((e) => e.from === undefined),
    cycles: cycles(graph).map((cycle) => {
      const found: AttributeCycle = { vertices: cycle.nodes, certain: cycle.certain };
      return allCircular(b, cycle.nodes) ? { ...found, circular: true } : found;
    }),
  };
}

/** This function tells if each vertex of a list is a circular attribute (D113). */
function allCircular(b: Builder, ids: readonly string[]): boolean {
  return ids.every((id) => b.vertices.get(id)?.circular === true);
}

function vertexText(vertex: AttributeVertex): string {
  return `${vertex.attribute} of ${vertex.type} at [${vertex.place.join(", ")}]`;
}

/**
 * This function finds each certain cycle of the attributes of a document before a run (TREE.GRAPH-CYCLE, D107). A run
 * that gives a value reads each own part of each tree root, and each eager read of each attribute that it reads. Thus a
 * certain cycle that these reads reach always gives `#CYCLE!`. The issue gets the place of the read that closes the
 * cycle in the order of the run, and the reason of the run. A cycle through a lazy read or an unknown read is not an issue.
 *
 * A cycle whose attributes are each circular gives a fixed point, thus it is not an issue (TREE.CIRCULAR-CHECK). In a
 * cycle with a plain attribute, the run gives `#CYCLE!` at the first read that closes a chain with a plain attribute.
 *
 * @param machine - The world and the code of the evaluators.
 * @param doc - The document, as JSON.
 * @param options - The type of a bare root value.
 * @returns One issue for each certain cycle that the run reaches.
 */
export function cycleIssues(machine: Machine, doc: unknown, options: CheckOptions): readonly Issue[] {
  const { b, roots } = build(machine, doc, options.declaredType);
  const graph = nodeGraph(b);
  const certain = new Map<string, number>();
  cycles(graph).forEach((cycle, index) => {
    if (cycle.certain && !allCircular(b, cycle.nodes)) for (const id of cycle.nodes) certain.set(id, index);
  });
  if (certain.size === 0) return [];
  // The eager reads with a known source of each vertex, in the order of its code, with the index of each edge.
  const eager = new Map<string, number[]>();
  b.edges.forEach((e, index) => {
    if (e.lazy || e.from === undefined) return;
    const list = eager.get(e.to);
    if (list === undefined) eager.set(e.to, [index]);
    else list.push(index);
  });
  // The demand of the run: the own parts of each tree root in the order of the JSON, then the reads of each attribute.
  const demands: [NodeInfo, string][] = [];
  const done = new Set<NodeInfo>();
  for (const root of roots) jsonOrder({ node: root }, demands, done);
  const order = demands.map(([node, key]) => attributeVertexId(node.visit.place, key));
  const state = new Map<string, "busy" | "done">();
  const reported = new Set<number>();
  const out: Issue[] = [];
  for (const start of order) {
    if (state.has(start)) continue;
    const stack: { readonly id: string; next: number }[] = [{ id: start, next: 0 }];
    state.set(start, "busy");
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as { readonly id: string; next: number };
      const list = eager.get(top.id) ?? [];
      if (top.next >= list.length) {
        state.set(top.id, "done");
        stack.pop();
        continue;
      }
      const index = list[top.next] as number;
      top.next += 1;
      const e = b.edges[index] as AttributeEdge;
      const from = e.from as string;
      const seen = state.get(from);
      if (seen === undefined) {
        state.set(from, "busy");
        stack.push({ id: from, next: 0 });
        continue;
      }
      if (seen === "done") continue;
      // The read reaches an attribute in evaluation: the run gives #CYCLE! here, with the chain of the demands.
      const cycle = certain.get(from);
      if (cycle === undefined || reported.has(cycle)) continue;
      const first = stack.findIndex((frame) => frame.id === from);
      const ids = stack.slice(first).map((frame) => frame.id);
      // A chain of circular attributes reads an approximation in the run, thus it does not close the cycle (D113).
      if (allCircular(b, ids)) continue;
      reported.add(cycle);
      const chain = [...ids, from].map((id) => vertexText(b.vertices.get(id) as AttributeVertex));
      out.push({ code: "#CYCLE!", place: e.place, reason: `The attributes form a cycle: ${chain.join(" -> ")}.`, at: b.ats[index] as readonly Key[] });
    }
  }
  return out;
}
