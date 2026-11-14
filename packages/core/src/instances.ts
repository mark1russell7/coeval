import { type Json, type Key, field, isKey, isRecord } from "./doc.ts";
import { type CollectRule, type Kind, argsKey, collectOf, equationType } from "./world.ts";
import { isRef, walkerOf } from "./deref.ts";
import type { Machine } from "./evaluate.ts";
import { type Above, codeFactsOf, partLazy } from "./facts.ts";
import { type NodeGraph, type GraphCycle, type GraphEdge, cycles } from "./graph.ts";
import { STD_WALKERS } from "./stdlib.ts";
import {
  type AtStep,
  type CheckOptions,
  type DocVisit,
  type Issue,
  type SeenNode,
  REF_CODE,
  TREE_NODE,
  atStepOf,
  depthLimit,
  downNames,
  isAtStep,
  isStructural,
  keepsSelf,
  selvesOf,
  visitAnswer,
  walk,
} from "./static.ts";

/*
 * The graph of attribute instances (R3 P5, D107). Each vertex is one attribute of one node of the decorated tree of a
 * document. Each edge is one read: the attribute that the read reaches, and the attribute whose code reads it. The
 * edges come from the references of the code of each attribute, and from the rungs of its ladder. A read that depends
 * on the value of an attribute gets an edge with an unknown source. `check` reports each certain cycle before a run.
 * The evaluator of the kernel does not use the graph (D3).
 *
 * A read of a node reads the JSON of the node. The graph has one vertex for the JSON of each node that a read reaches.
 * It reads each own attribute of the node and the JSON vertex of each node in their values (TREE.GRAPH-JSON). Thus a
 * read of a node is one edge, and many reads of a large node cost no more than their count.
 */

/** One vertex of the graph of attribute instances: one attribute of one node of the decorated tree (D107). */
export interface AttributeVertex {
  /** The name of the vertex: the JSON text of the place of the node with the name of the attribute after it. */
  readonly id: string;
  /** The place of the document of the node. */
  readonly place: readonly Key[];
  /** The name of the attribute. It is the empty text for the vertex of the JSON of a node. */
  readonly attribute: string;
  /** The text of the type of the node. */
  readonly type: string;
  /**
   * `true` for the vertex of the JSON of a node (TREE.GRAPH-JSON). It reads each own attribute of the node, and the JSON
   * vertex of each node in their values. Its name is the JSON text of the place with `null` after it. Else the field is
   * absent.
   */
  readonly json?: true;
  /** `true` when the kind of the node declares the attribute `circular` (TREE.CIRCULAR-CHECK). Else the field is absent. */
  readonly circular?: true;
  /** The arguments of an instance of an attribute with parameters (TREE.AT-CHECK). Else the field is absent. */
  readonly args?: Readonly<Record<string, Json>>;
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
  /** The attribute vertices of the cycle, in the order of the graph. The list has no vertex of the JSON of a node. */
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

/**
 * The vertices of one place of the document, by the name of the attribute. Two nodes at one place share them, as the
 * text of a vertex name is the same for both (TREE.GRAPH-DEPTH).
 */
interface PlaceIds {
  readonly plain: Map<string, number>;
  /**
   * The instances of attributes with parameters, by the JSON text of the name and the key of the arguments. Most places
   * have no such instance, thus the map starts at the first instance (K297).
   */
  at?: Map<string, number>;
  /** The count of the nodes at the place. Each node has its own JSON vertex, thus its name has its index. */
  nodes: number;
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
  /** The vertices of the place of the node. */
  readonly ids: PlaceIds;
  /** The count of the nodes before this node at its place. A node in a part with an empty slot shares a place, thus it can get 1 or more. */
  readonly index: number;
  /** The vertex of the JSON of the node, after the first read of the node (TREE.GRAPH-JSON). */
  json?: number;
}

/** One document of the document: its code, its node, and the items of a list. */
interface DocInfo {
  readonly visit: DocVisit;
  readonly evaluator: string | undefined;
  readonly node: NodeInfo | undefined;
  /** The documents of the items of a list, by their index. Only a list document has the map (K297). */
  readonly items: Map<number, DocInfo> | undefined;
  /** The items in the order of their indices, after the first read of the list. */
  sorted?: readonly DocInfo[];
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
  /** The visit that starts the place of this document. A part with an empty slot has the place of its parent. */
  readonly place: DocVisit;
}

/** The value that a step reaches before the run. It is a node, a list document, data, a value outside the tree, or unknown. */
type Value = { readonly node: NodeInfo } | { readonly list: DocInfo } | "data" | "outside" | "unknown";

/** One reference of an equation of a kind, for each node of the kind (D107). */
interface TermRef {
  readonly path: readonly Json[];
  readonly lazy: boolean;
  /** `true` when the self of the reference is the node of the equation. */
  readonly self: boolean;
  /**
   * `true` when a kind inside the equation binds the first name of the path. The walk reads it at the visit, when the
   * test of the names is fast (STATIC.LINEAR).
   */
  readonly bound: boolean;
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

/** This function tells if a kind around a reference binds the first name of its path. The walk asks at the visit, when the test is fast (STATIC.LINEAR). */
function namedRef(v: DocVisit): boolean {
  const path = v.doc.value as readonly Json[];
  return path[0] === "names" && path.length >= 2 && v.names.has(String(path[1]));
}

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

/**
 * One vertex of the builder: the node, the name of the attribute and the arguments of an instance. The builder makes
 * the text of its name and of its place only for the result of `attributeGraph` or for an issue (TREE.GRAPH-DEPTH).
 */
interface VertexInfo {
  /** The first node at the place of the vertex. */
  readonly node: NodeInfo;
  readonly attribute: string;
  /** `true` when the kind of the node declares the attribute `circular`. An instance with arguments is not circular. */
  readonly circular: boolean;
  /** The arguments of an instance of an attribute with parameters, and their key (TREE.AT-CHECK). */
  readonly at?: { readonly names: Readonly<Record<string, Json>>; readonly key: string };
  /** `true` for the vertex of the JSON of the node (TREE.GRAPH-JSON). Its attribute is the empty text. */
  readonly json?: true;
}

/** One edge of the builder. Its visit gives the place and the JSON path of the read, only for the result or an issue. */
interface EdgeInfo {
  readonly from: number | undefined;
  readonly to: number;
  readonly lazy: boolean;
  readonly visit: DocVisit;
}

/** The builder of one graph: the vertices, the edges and the reads of the rungs. A vertex is its index in `vertices`. */
interface Builder {
  readonly machine: Machine;
  readonly vertices: VertexInfo[];
  readonly edges: EdgeInfo[];
  /** The vertices whose reads the builder adds: the rungs of an attribute or the parts of a JSON, in the order of their start. */
  readonly work: number[];
  readonly terms: Map<Kind, Map<string, readonly TermRef[]>>;
}

/** A read in progress: the vertex that reads, the lazy mark, and the visit with the place and the JSON path of the read. */
interface Reader {
  readonly to: number;
  readonly lazy: boolean;
  readonly visit: DocVisit;
}

/** This function tells if the kind of a node declares an attribute `circular` (D113). */
function isCircular(kind: Kind, attribute: string): boolean {
  const declared = hasOwnEntry(kind.tree?.attributes, attribute) ? kind.tree?.attributes?.[attribute] : undefined;
  return declared?.circular !== undefined;
}

/** This function gives the vertex of an attribute of a node. A new vertex goes on the work list for its rungs. */
function vertexOf(b: Builder, node: NodeInfo, attribute: string): number {
  const known = node.ids.plain.get(attribute);
  if (known !== undefined) return known;
  const id = b.vertices.length;
  b.vertices.push({ node, attribute, circular: isCircular(node.kind, attribute) });
  node.ids.plain.set(attribute, id);
  if (!node.parts.has(attribute)) b.work.push(id);
  return id;
}

/**
 * This function gives the vertex of an instance of an attribute with parameters (TREE.AT-CHECK, D124). Its name is the
 * name of a plain vertex with the key of the arguments after the name of the attribute.
 */
function atVertexOf(b: Builder, node: NodeInfo, at: AtStep & { readonly kind: "exact" }): number {
  const key = JSON.stringify([at.attr, at.key]);
  const known = node.ids.at?.get(key);
  if (known !== undefined) return known;
  const id = b.vertices.length;
  b.vertices.push({ node, attribute: at.attr, circular: false, at: { names: at.names, key: at.key } });
  (node.ids.at ??= new Map()).set(key, id);
  b.work.push(id);
  return id;
}

/** This function gives the vertex of the JSON of a node (TREE.GRAPH-JSON). A new vertex goes on the work list for its reads. */
function jsonVertexOf(b: Builder, node: NodeInfo): number {
  if (node.json !== undefined) return node.json;
  const id = b.vertices.length;
  b.vertices.push({ node, attribute: "", circular: false, json: true });
  node.json = id;
  b.work.push(id);
  return id;
}

function edge(b: Builder, from: number | undefined, r: Reader, lazy = false): void {
  b.edges.push({ from, to: r.to, lazy: r.lazy || lazy, visit: r.visit });
}

/**
 * This function gives the name of a vertex: the text of `attributeVertexId`, with the key of the arguments of an
 * instance. The name of a JSON vertex is the place with `null` after it, and the index of a second node at the place.
 */
function vertexName(vertex: VertexInfo): string {
  const place = vertex.node.visit.place;
  if (vertex.json === true) return JSON.stringify(vertex.node.index === 0 ? [...place, null] : [...place, null, vertex.node.index]);
  const plain = attributeVertexId(place, vertex.attribute);
  return vertex.at === undefined ? plain : `${plain.slice(0, -1)},${vertex.at.key}]`;
}

/** This function gives the items of a list document, in the order of their indices. The list sorts them one time. */
function itemsOf(list: DocInfo): readonly DocInfo[] {
  list.sorted ??= [...(list.items ?? [])].sort(([x], [y]) => x - y).map(([, item]) => item);
  return list.sorted;
}

/**
 * This function gives the attributes that the JSON of a value reads, in their order (TREE.RESULT). A node reads each
 * own part, with the JSON of each node in its value after it. A list gives the JSON of each item. The function uses
 * its own stack, thus a deep tree cannot overflow the stack of the host (TREE.GRAPH-DEPTH).
 */
function jsonOrder(value: Value, out: [NodeInfo, string][], done: Set<NodeInfo>): void {
  // The work in reverse order: a value to read, or an attribute to give. A node puts its attributes on the stack with
  // the value of each after it, from the last to the first. Thus the order is the order of a recursive walk.
  const stack: (Value | readonly [NodeInfo, string])[] = [value];
  while (stack.length > 0) {
    const top = stack.pop() as Value | readonly [NodeInfo, string];
    if (Array.isArray(top)) {
      out.push([top[0], top[1]]);
      continue;
    }
    const here = top as Value;
    if (typeof here !== "object") continue;
    if ("list" in here) {
      const items = itemsOf(here.list);
      for (let index = items.length - 1; index >= 0; index -= 1) stack.push(valueOf(items[index]));
      continue;
    }
    const node = here.node;
    if (done.has(node)) continue;
    done.add(node);
    for (let index = node.own.length - 1; index >= 0; index -= 1) {
      const key = node.own[index] as string;
      stack.push(valueOf(node.parts.get(key)));
      stack.push([node, key]);
    }
  }
}

/**
 * This function adds the reads of the JSON vertex of a node, in the order of the run (TREE.RESULT, TREE.GRAPH-JSON). It
 * reads each own part of the node, with the JSON vertex of each node in the value of the part after it. A list gives
 * the nodes of its items. Thus each JSON vertex has an edge for each own part and for each node in their values only.
 */
function jsonEdges(b: Builder, id: number): void {
  const node = (b.vertices[id] as VertexInfo).node;
  const r: Reader = { to: id, lazy: false, visit: node.visit };
  for (const key of node.own) {
    edge(b, vertexOf(b, node, key), r);
    const stack: Value[] = [valueOf(node.parts.get(key))];
    while (stack.length > 0) {
      const here = stack.pop() as Value;
      if (typeof here !== "object") continue;
      if ("node" in here) {
        edge(b, jsonVertexOf(b, here.node), r);
        continue;
      }
      const items = itemsOf(here.list);
      for (let index = items.length - 1; index >= 0; index -= 1) stack.push(valueOf(items[index]));
    }
  }
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
      const item = here.list.items?.get(at);
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
    // A step tree.at with literal arguments reads one instance (TREE.AT-CHECK). A step that fails gives no read.
    if (isAtStep(b.machine, step)) {
      const at = atStepOf(node.kind, node.text, step.value);
      if (at.kind === "unknown") edge(b, undefined, r);
      if (at.kind !== "exact") return;
      edge(b, atVertexOf(b, node, at), r);
      here = "unknown";
      continue;
    }
    // The standard walker nearest depends only on the structure (R3 P5). Each other walker can read each attribute.
    if (walkerOf(b.machine, step) !== STD_WALKERS["walk.nearest"]) {
      edge(b, undefined, r);
      return;
    }
    here = nearestOf(node, isRecord(step) ? field(step, "value") : undefined);
  }
  // The value of a reference to a node is the JSON of the node: one edge to its JSON vertex (TREE.GRAPH-JSON).
  if (typeof here === "object" && "node" in here) edge(b, jsonVertexOf(b, here.node), r);
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
      const answer = visitAnswer(b.machine.world, v, "eval");
      if (answer === undefined && v.kind === undefined) return "skip";
      const up = v.parent === undefined ? undefined : above.get(v.parent);
      const lazy = up !== undefined && v.parent !== undefined && (up.lazy || partLazy(up, v.parent, v.slot));
      above.set(v, { lazy, rules: v.kind === undefined ? undefined : codeFactsOf(b.machine, v, v.kind, "eval").rules });
      const evaluator = answer?.name;
      const { self } = selves.enter(v, evaluator);
      if (evaluator === REF_CODE && isRef(v.doc)) {
        if (v.address !== true) out.push({ path: v.doc.value, lazy, self: self === EQUATION_SELF, bound: namedRef(v), opaque: false });
      } else if (self === EQUATION_SELF && evaluator !== TREE_NODE && !keepsSelf(evaluator)) {
        out.push({ path: [], lazy, self: true, bound: false, opaque: true });
      }
      return undefined;
    },
    of === undefined ? {} : { declaredType: of },
  );
  byLabel.set(label, out);
  return out;
}

/** The names of the equation of a rung, before the run. The parameters of an attribute hold JSON data (TREE.AT). */
interface TermNames {
  readonly child?: NodeInfo;
  readonly prev?: Value;
  readonly params?: readonly string[];
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
    if (ref.bound) start = "unknown";
    else if (names?.params !== undefined) {
      if (!names.params.includes(name)) continue;
      start = "data";
    } else if (names?.child !== undefined && name === "child") start = { node: names.child };
    else if (names?.prev !== undefined && name === "prev") start = names.prev;
    else if (name === "index") start = "data";
    else if (name === "acc" || name === "item") start = "unknown";
    else continue;
    follow(b, start, ref.path, 2, read);
  }
}

/**
 * This function gives the previous sibling of a node in the list `children` of its parent, before the run. The visit
 * of an item of the list has the list as its parent and the index as its slot. Thus the function reads no other item.
 */
function prevOf(parent: NodeInfo, child: NodeInfo): Value {
  const list = parent.parts.get("children");
  if (list === undefined || list.evaluator !== LIST) return "unknown";
  const slot = child.visit.slot;
  const index = child.visit.parent === list.visit && slot.length === 1 && typeof slot[0] === "number" ? slot[0] : -1;
  if (list.items?.get(index)?.node !== child) return "data";
  return index === 0 ? "data" : valueOf(list.items?.get(index - 1));
}

/**
 * This function adds the reads of the rungs of an attribute that is not an own part, in the order of the ladder
 * (TREE.LADDER). After a rung that can fail to answer, the reads of the later rungs are lazy.
 */
function rungReads(b: Builder, id: number): void {
  const vertex = b.vertices[id] as VertexInfo;
  const node = vertex.node;
  const key = vertex.attribute;
  const tree = node.kind.tree;
  const r: Reader = { to: id, lazy: false, visit: node.visit };
  // An instance of an attribute with parameters has one rung: its equation in tree.at (TREE.AT).
  if (vertex.at !== undefined) {
    const at = atStepOf(node.kind, node.text, { attr: key, args: vertex.at.names });
    if (at.kind === "exact") termReads(b, termRefs(b, node.kind, `tree.at.${key}`, at.equation), node, { params: at.params }, r);
    return;
  }
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
  if (declared?.default !== undefined) {
    termReads(b, termRefs(b, node.kind, `tree.attributes.${key}.default`, declared.default), node, undefined, later);
    return;
  }
  // The document of a higher-order attribute is known only in the run, thus its reads are not known (TREE.HIGHER-CHECK).
  if (declared?.higher !== undefined) {
    termReads(b, termRefs(b, node.kind, `tree.attributes.${key}.higher`, declared.higher), node, undefined, later);
    edge(b, undefined, later);
    return;
  }
  // The last rung reads the attribute `forwards` and an attribute of a node that only the run knows (TREE.FORWARD-CHECK).
  const forwards = tree?.forwards;
  if (typeof forwards === "string" && forwards !== key) {
    edge(b, vertexOf(b, node, forwards), later);
    edge(b, undefined, later);
  }
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
  const b: Builder = { machine, vertices: [], edges: [], work: [], terms: new Map() };
  const roots: NodeInfo[] = [];
  const all: NodeInfo[] = [];
  const reads: { readonly owner: Owner; readonly v: DocVisit; readonly lazy: boolean; readonly self: Value; readonly opaque: boolean; readonly bound: boolean }[] = [];
  const states = new Map<DocVisit, VisitState>();
  const nodes = new Map<SeenNode, NodeInfo>();
  // The vertices of each place, by the visit that starts the place. Only a place with a node gets an entry.
  const places = new Map<DocVisit, PlaceIds>();
  const selves = selvesOf(machine, "eval", OUTSIDE);
  const maxDepth = depthLimit(machine);
  // This function puts the document of a visit in its parent: an own part of a node, or an item of a list.
  const attach = (parent: VisitState | undefined, v: DocVisit, info: DocInfo): void => {
    if (parent?.info.node !== undefined) parent.info.node.parts.set(slotKey(v.slot), info);
    else if (parent?.info.items !== undefined && v.slot.length === 1 && typeof v.slot[0] === "number") parent.info.items.set(v.slot[0], info);
  };
  walk(
    machine.world,
    doc,
    (v) => {
      const parent = v.parent === undefined ? undefined : states.get(v.parent);
      let owner: Owner | undefined;
      let lazy = false;
      if (parent?.info.node !== undefined) owner = { node: parent.info.node, key: slotKey(v.slot) };
      else if (parent !== undefined && v.parent !== undefined) {
        owner = parent.owner;
        lazy = parent.lazy || partLazy(parent.above, v.parent, v.slot);
      }
      // The graph keeps the depth limit of check (TREE.GRAPH-DEPTH). A document deeper than the limit has no vertex
      // and no part. Its reads are not known, as the reads of code that the check does not know.
      if (v.depth > maxDepth) {
        attach(parent, v, { visit: v, evaluator: undefined, node: undefined, items: undefined });
        if (owner !== undefined) reads.push({ owner, v, lazy, self: "unknown", opaque: true, bound: false });
        return "skip";
      }
      const answer = visitAnswer(machine.world, v, "eval");
      if (answer === undefined && v.kind === undefined) return "skip";
      const evaluator = answer?.name;
      const { self, node: seen } = selves.enter(v, evaluator);
      const place = v.slot.length === 0 && parent !== undefined ? parent.place : v;
      let node: NodeInfo | undefined;
      if (seen !== undefined && v.kind !== undefined) {
        const up = self === OUTSIDE ? null : self === undefined ? undefined : nodes.get(self);
        let ids = places.get(place);
        if (ids === undefined) {
          ids = { plain: new Map(), nodes: 0 };
          places.set(place, ids);
        }
        node = { visit: v, kind: v.kind, text: seen.text, own: [...(seen.own ?? [])], parts: new Map(), up, ids, index: ids.nodes };
        ids.nodes += 1;
        nodes.set(seen, node);
        all.push(node);
        // The run reads each own part of a tree root that an eager position holds (TREE.RESULT).
        if (up === null && !lazy) roots.push(node);
      }
      const info: DocInfo = { visit: v, evaluator, node, items: evaluator === LIST ? new Map() : undefined };
      attach(parent, v, info);
      states.set(v, { info, owner, lazy, above: { lazy, rules: v.kind === undefined ? undefined : codeFactsOf(machine, v, v.kind, "eval").rules }, place });
      if (owner === undefined || node !== undefined) return undefined;
      const value: Value = self === OUTSIDE ? "outside" : self === undefined ? "unknown" : { node: nodes.get(self) as NodeInfo };
      if (evaluator === REF_CODE && isRef(v.doc)) {
        if (v.address !== true) reads.push({ owner, v, lazy, self: value, opaque: false, bound: namedRef(v) });
      } else if (value !== "unknown" && evaluator !== REF_CODE && !keepsSelf(evaluator)) {
        // Code that the check does not know can read each attribute of its self.
        reads.push({ owner, v, lazy, self: value, opaque: true, bound: false });
      }
      return undefined;
    },
    declaredType === undefined ? {} : { declaredType },
  );
  for (const node of all) for (const key of node.own) vertexOf(b, node, key);
  for (const { owner, v, lazy, self, opaque, bound } of reads) {
    const r: Reader = { to: vertexOf(b, owner.node, owner.key), lazy, visit: v };
    if (opaque) {
      edge(b, undefined, r);
      continue;
    }
    const path = v.doc.value as readonly Json[];
    const root = path[0];
    if (root === "self") {
      if (self === "unknown") edge(b, undefined, r);
      else follow(b, self, path, 1, r);
    } else if (bound) {
      // A name that a kind binds holds a value of the run, and that value can hold a node.
      edge(b, undefined, r);
    }
  }
  // A rung or a JSON can add vertices to the end of the list. The loop reads them too.
  for (let next = 0; next < b.work.length; next += 1) {
    const id = b.work[next] as number;
    if (b.vertices[id]?.json === true) jsonEdges(b, id);
    else rungReads(b, id);
  }
  return { b, roots };
}

/** This function gives the graph for `graph.ts`: each vertex with the vertices that it reads. */
function nodeGraph(b: Builder): NodeGraph<number> {
  const reads: GraphEdge<number>[][] = b.vertices.map(() => []);
  for (const e of b.edges) reads[e.to]?.push({ to: e.from, lazy: e.lazy });
  return new Map(reads.map((edges, id) => [id, { edges }] as const));
}

/**
 * This function gives the graph of attribute instances of a document (TREE.GRAPH, R3 P5, D107). It has one vertex for
 * each attribute of each node of the decorated tree. It has one edge for each read of the code of an attribute.
 *
 * - A path from `self` reads the attribute of the node. `self.parent` goes to the parent node.
 * - The step `nearest` with the key `parent` depends only on the structure, thus it goes to a node of the document.
 * - The rungs of the ladder read too: `names.prev` of `down` reads the previous sibling, and a fold reads each child.
 * - A read that depends on the value of an attribute gets an edge with an unknown source.
 * - A read of a node is one edge to the JSON vertex of the node. That vertex reads each own attribute of the node, and
 *   the JSON vertex of each node in their values (TREE.GRAPH-JSON).
 * - The graph keeps the depth limit of `check`. A document deeper than the limit has no vertex, and its reads have an
 *   unknown source (TREE.GRAPH-DEPTH).
 *
 * The walk is the walk of `check`, with its rules for the self of each document (D106). The evaluator of the kernel
 * does not use the graph (D3). The time and the memory of the graph are linear in the count of its vertices and its
 * edges. The texts of the names and of the places are a cost of the result only.
 *
 * @param machine - The world and the code of the evaluators.
 * @param doc - The document, as JSON.
 * @param options - The type of a bare root value.
 * @returns The vertices, the edges, the graph for the analysis, the reads that only the run knows and the cycles.
 */
export function attributeGraph(machine: Machine, doc: unknown, options: AttributeGraphOptions = {}): AttributeGraph {
  const { b } = build(machine, doc, options.declaredType);
  const graph = nodeGraph(b);
  const names = b.vertices.map(vertexName);
  const name = (id: number): string => names[id] as string;
  const vertices = new Map<string, AttributeVertex>();
  b.vertices.forEach((vertex, id) => {
    const plain = { id: name(id), place: vertex.node.visit.place, attribute: vertex.attribute, type: vertex.node.text };
    if (vertex.json === true) vertices.set(name(id), { ...plain, json: true });
    else vertices.set(name(id), vertex.at !== undefined ? { ...plain, args: vertex.at.names } : vertex.circular ? { ...plain, circular: true } : plain);
  });
  const edges: AttributeEdge[] = b.edges.map((e) => ({ from: e.from === undefined ? undefined : name(e.from), to: name(e.to), lazy: e.lazy, place: e.visit.place }));
  return {
    vertices,
    edges,
    graph: new Map([...graph].map(([id, entry]) => [name(id), { edges: entry.edges.map((e) => ({ to: e.to === undefined ? undefined : name(e.to), lazy: e.lazy })) }] as const)),
    unknown: edges.filter((e) => e.from === undefined),
    cycles: attributeCycles(b, graph).map((cycle) => {
      const found: AttributeCycle = { vertices: cycle.nodes.map(name), certain: cycle.certain };
      return allCircular(b, cycle.nodes) ? { ...found, circular: true } : found;
    }),
  };
}

/** This function tells if each attribute of a list of vertices is circular (D113). A JSON vertex is not an attribute. */
function allCircular(b: Builder, ids: readonly number[]): boolean {
  return ids.every((id) => b.vertices[id]?.circular === true || b.vertices[id]?.json === true);
}

/**
 * This function gives the cycles of the attributes: the cycles of the graph, without their JSON vertices
 * (TREE.GRAPH-JSON). A JSON vertex that only a lazy read reaches can split a certain cycle of attributes. The parts are
 * a possible cycle and one certain part with the same attributes. The function gives that cycle as one certain cycle.
 */
function attributeCycles(b: Builder, graph: NodeGraph<number>): readonly GraphCycle<number>[] {
  const all = cycles(graph);
  const attributes = (nodes: readonly number[]): readonly number[] => nodes.filter((id) => b.vertices[id]?.json !== true);
  const out: GraphCycle<number>[] = [];
  for (let index = 0; index < all.length; index += 1) {
    const cycle = all[index] as GraphCycle<number>;
    const nodes = attributes(cycle.nodes);
    if (cycle.certain) {
      out.push({ nodes, certain: true });
      continue;
    }
    // The certain parts of a possible cycle come after it, and each part is inside the component of the cycle.
    const members = new Set(cycle.nodes);
    let end = index + 1;
    while (end < all.length && all[end]?.certain === true && members.has(all[end]?.nodes[0] as number)) end += 1;
    const parts = all.slice(index + 1, end).map((part) => attributes(part.nodes));
    if (parts.length === 1 && parts[0]?.length === nodes.length) out.push({ nodes, certain: true });
    else {
      out.push({ nodes, certain: false });
      for (const part of parts) out.push({ nodes: part, certain: true });
    }
    index = end - 1;
  }
  return out;
}

/** This function gives the text of a vertex for the reason of an issue. Only an issue makes the text of the place. */
function vertexText(vertex: VertexInfo): string {
  const name = vertex.at === undefined ? vertex.attribute : `${vertex.attribute} with ${String(argsKey(vertex.at.names))}`;
  return `${name} of ${vertex.node.text} at [${vertex.node.visit.place.join(", ")}]`;
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
  const certain = new Map<number, number>();
  attributeCycles(b, graph).forEach((cycle, index) => {
    if (cycle.certain && !allCircular(b, cycle.nodes)) for (const id of cycle.nodes) certain.set(id, index);
  });
  if (certain.size === 0) return [];
  // The eager reads with a known source of each vertex, in the order of its code, with the index of each edge.
  const eager = new Map<number, number[]>();
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
  // Each own part of each node has a vertex: build makes them before the reads.
  const order = demands.map(([node, key]) => node.ids.plain.get(key) as number);
  // The state of each vertex: absent, in evaluation (BUSY) or done (DONE).
  const BUSY = 1;
  const DONE = 2;
  const state = new Uint8Array(b.vertices.length);
  // The JSON frames next to each other on the stack share one cell: the attribute that the top of the run of frames
  // evaluates, and the visit of the read of the node. A second read of the JSON of a node in evaluation reaches that
  // attribute first, as the run does. A cycle that a JSON frame closes has the place of the read of the node.
  const cells: ({ attr: number; readonly visit: DocVisit } | undefined)[] = [];
  const isJson = (id: number): boolean => b.vertices[id]?.json === true;
  const reported = new Set<number>();
  const out: Issue[] = [];
  for (const start of order) {
    if (state[start] !== 0) continue;
    const stack: { readonly id: number; next: number }[] = [{ id: start, next: 0 }];
    state[start] = BUSY;
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as { readonly id: number; next: number };
      const list = eager.get(top.id) ?? [];
      if (top.next >= list.length) {
        state[top.id] = DONE;
        stack.pop();
        continue;
      }
      const index = list[top.next] as number;
      top.next += 1;
      const e = b.edges[index] as EdgeInfo;
      let from = e.from as number;
      const seen = state[from];
      if (seen === 0) {
        state[from] = BUSY;
        if (isJson(from)) cells[from] = isJson(top.id) ? cells[top.id] : { attr: -1, visit: e.visit };
        else if (isJson(top.id)) (cells[top.id] as { attr: number }).attr = from;
        stack.push({ id: from, next: 0 });
        continue;
      }
      if (seen === DONE) continue;
      // The JSON of a node in evaluation reads its attributes again. Those before the one in evaluation are done.
      if (isJson(from)) from = cells[from]?.attr ?? -1;
      if (from < 0) continue;
      // The read reaches an attribute in evaluation: the run gives #CYCLE! here, with the chain of the demands.
      const cycle = certain.get(from);
      if (cycle === undefined || reported.has(cycle)) continue;
      const first = stack.findIndex((frame) => frame.id === from);
      const ids = stack.slice(first).map((frame) => frame.id);
      // A chain of circular attributes reads an approximation in the run, thus it does not close the cycle (D113).
      if (allCircular(b, ids)) continue;
      reported.add(cycle);
      const chain = [...ids, from].filter((id) => !isJson(id)).map((id) => vertexText(b.vertices[id] as VertexInfo));
      const via = (isJson(top.id) ? cells[top.id]?.visit : undefined) ?? e.visit;
      out.push({ code: "#CYCLE!", place: via.place, reason: `The attributes form a cycle: ${chain.join(" -> ")}.`, at: via.at });
    }
  }
  return out;
}
