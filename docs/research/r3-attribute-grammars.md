# R3: attribute grammars and the tree kit

This file is a research study for the roadmap item L2 of `docs/ROADMAP.md`. It does not change a decision. The coeval session decides which proposals go into the roadmap.

## The question

L2 is "the tree kit: data down, sizes up and references sideways, by attribute equations". Attribute grammars are the standard theory of equations over the nodes of a tree. This study asks two questions:

1. What does each main idea of attribute grammars mean for the tree kit of coeval?
2. What does coeval build first, and how does it test it?

Three uses guide the answers. A user interface host lays out cards by rules. The box of a parent goes down, the sizes of the children come up, and a node reads the size of another node. A reactive formula language evaluates formulas over a store of named nodes. A formula language evaluates formulas over the positions of a space: records, grids and trees.

## The answer in short

- An attribute is a name. A node answers it through a ladder: its own field, its kind, its parent, then a default.
- Demand evaluation with one memo cell for each node and attribute is the reference meaning. It needs no schedule (Johnsson, JastAdd), and this agrees with D3.
- `prepare` always has the concrete document. Thus the graph of its attribute instances is linear in size, and a cycle check on it is exact for static edges.
- The toy `tree.node` has three gaps. A reference to a sibling recurses without end. A cycle ends at the limit of the stack, not at `#CYCLE!`. A failed field reads as `#N/A`.
- The first proposal (P1) builds the structure of the tree first and evaluates attributes on demand. The second proposal (P2) puts equations into kind contracts, with copy and fold defaults.

## Background

### Synthesized and inherited attributes

[Knuth (1968)](https://doi.org/10.1007/BF01692511) attaches attributes to the nodes of a parse tree. Each production of the grammar gives one equation for each attribute that it defines. A synthesized attribute of a node comes from the attributes of its children. An inherited attribute of a node comes from its parent and its siblings. The production of the parent defines the inherited attributes of its children.

The equations define the values, not an order. A grammar is well defined when the dependency graph of each possible tree has no cycle. Knuth gave a test for this, with a [correction in 1971](https://doi.org/10.1007/BF01702865). [Jazayeri, Ogden and Rounds (1975)](https://doi.org/10.1145/361227.361231) showed that the test is exponential in the worst case.

For coeval, an equation is a pure term (D1), and its value does not depend on a schedule (D3). The toy has both directions. A path `["self", "parent", "width"]` reads down, and the part `children` gives the results of the children up.

### Static evaluation orders

[Kastens (1980)](https://doi.org/10.1007/BF00288644) defined ordered attribute grammars (OAG). A polynomial test finds one total order of the attributes of each symbol. From the orders, a generator makes a visit sequence: a fixed plan of tree walks for each production. [Kennedy and Warren (1976)](https://doi.org/10.1145/800168.811538) covered the larger class of absolutely non-circular grammars. [Bransen, Middelkoop, Dijkstra and Swierstra (2012)](https://doi.org/10.1007/978-3-642-27694-1_14) use their algorithm in UUAG. [Jourdan (1984)](https://doi.org/10.1145/502874.502882) evaluated the same class recursively: each attribute asks for the attributes that it reads.

For coeval, a visit sequence is a schedule, and D3 puts schedules in a separate layer (S1, S2). The kernel gives the graph, and a schedule derives its order from it.

### Demand evaluation and attribute grammars as functional programs

[Johnsson (1987)](https://doi.org/10.1007/3-540-18317-5_10) showed that a lazy functional language evaluates an attribute grammar directly. Each node becomes a function from its inherited attributes to its synthesized attributes. Lazy evaluation finds the order at run time. [Bird (1984)](https://doi.org/10.1007/BF00264249) gave the classic example, `repmin`. It replaces each leaf of a tree by the minimum of the tree, in one walk. The root sends down a value that it computes from the values that come up.

[Uustalu and Vene (2005)](https://ws.lib.ttu.ee/digibase/et/Publ/Item/937eb25e-592a-4946-ab4c-c035687f0424) describe attribute evaluation with a comonad. They extend the idea in ["Comonadic notions of computation"](https://doi.org/10.1016/j.entcs.2008.05.029) (2008). An attribute is a function of a node in its context. The context is a zipper ([Huet 1997](https://doi.org/10.1017/S0956796897002864)): a focus, and the path from the focus back to the root. [Martins, Fernandes and Saraiva (2013)](https://doi.org/10.1007/978-3-642-40922-6_10) embed attribute grammars in Haskell with zippers. A move up reaches the inherited attributes, and a move down reaches the synthesized attributes.

For coeval, a host thing with `parent` and `children` is the focus of a zipper. The root `self` of D10 is that focus. The attributes of the focus are its own steps (DEREF.HOST). Thus demand evaluation through `deref` is the reference meaning, and a static order is only an optimization.

### Reference attributes

[Hedin (2000)](https://lup.lub.lu.se/record/107069) lets the value of an attribute be a reference to another node of the tree. An equation reads the attributes of the distant node through the reference. The standard example is name analysis: the attribute `decl` of a use of a name refers to the node of its declaration. The dependencies then depend on the values of reference attributes. Thus a static order is not possible in general, and JastAdd evaluates on demand with a cache.

For coeval, a reference document (D10) in an address position (FORMULA.ADDRESS) is a reference attribute. It gives the thing, not its value. `nearest` is a computed reference attribute. JastAdd writes the same idea as an inherited attribute `card()` with the equation `eq Card.getChild().card() = this`. A reference sideways is a path to another node, then a step with the name of an attribute.

### Circular attributes and fixed points

[Farrow (1986)](https://doi.org/10.1145/12276.13320) permits cycles in the dependency graph when the equations are monotone over a lattice of finite height. The evaluator starts each attribute of a cycle at the bottom value. It repeats the equations until no value changes, and the result is the least fixed point.

[Magnusson and Hedin (2007)](https://doi.org/10.1016/j.scico.2005.06.005) combined circular attributes with reference attributes, and they gave a demand algorithm. A demand that reaches an attribute of its own cycle gets the current approximation. The first attribute of the cycle repeats the evaluation until the values are stable. JastAdd declares such an attribute as `syn T A.x() circular [bv]`, and `bv` is the start value.

Typical uses are sets that grow: nullable symbols, reachable nodes and the facts of a data flow analysis. In layout, a scrollbar appears when the content is too high for its box, and the narrower content is higher.

For coeval, `#CYCLE!` means a cycle of references at this time (DEREF.CYCLE). For attributes, `#CYCLE!` can also mean "this value depends on itself". An attribute that declares a start value and a limit gets the least fixed point instead.

### Higher-order attributes and forwarding

[Vogt, Swierstra and Kuiper (1989)](https://doi.org/10.1145/73141.74830) let an attribute hold a tree. That tree then gets attributes of its own, and JastAdd names it a nonterminal attribute. Examples are a desugared form and the expansion of a template.

[Van Wyk, de Moor, Backhouse and Kwiatkowski (2002)](https://doi.org/10.1007/3-540-45937-5_11) added forwarding. A production names a tree, and each attribute without an equation comes from that tree. Silver uses forwarding for modular extensions of a language. [Kaminski and Van Wyk (2012)](https://doi.org/10.1007/978-3-642-36089-3_20) check each extension for missing equations on its own.

For coeval, forwarding is one more rung of a ladder: own, kind, then the forwarded tree. A higher-order attribute is a document that an equation computes. The kit compiles it with `prepare` and puts it under the node.

### Collection attributes and default equations

[Boyland (2005)](https://doi.org/10.1145/1082036.1082042) defines remote attribute grammars: an equation can contribute to an attribute of a distant node. [Magnusson, Ekman and Hedin (2007)](https://lup.lub.lu.se/record/634097) added collection attributes to JastAdd. A declaration `coll` gives the unit and the combine operation, and `contributes ... to` adds values from any node of the tree.

UUAG ([Swierstra, Azero Alcocer and Saraiva 1999](https://doi.org/10.1007/10704973_4)) has two local defaults. A copy rule gives an inherited attribute without an equation the value of the parent attribute with the same name. A `USE` rule gives a synthesized attribute without an equation the combination of the values of the children, with an operation and a unit. In JastAdd, the nearest ancestor with an equation answers an inherited attribute (broadcast).

For coeval, a copy default and a fold default make most equations of a layout unnecessary. A collection attribute gives a registry of the named nodes of a subtree, for references sideways by name.

### Four systems

| System | Form | What it has | The lesson for coeval |
| --- | --- | --- | --- |
| JastAdd ([Ekman and Hedin 2007](https://doi.org/10.1016/j.scico.2007.02.003), [manual](https://jastadd.cs.lth.se/web/documentation/reference-manual.php)) | Java, with aspects | `syn`, `inh` with broadcast, reference, circular, collection and nonterminal attributes, demand evaluation with a cache | An attribute ladder with a parent rung, and demand evaluation with a memo |
| Silver ([Van Wyk, Bodin, Gao and Krishnan 2010](https://doi.org/10.1016/j.scico.2009.07.004), [site](https://melt.cs.umn.edu/silver/)) | Its own language | Forwarding, higher-order, reference and collection attributes, modular analysis | Forwarding as a rung, and a check of each extension on its own |
| Kiama ([Sloane, Kats and Visser 2013](https://doi.org/10.1016/j.scico.2011.11.005), [code](https://github.com/inkytonik/kiama)) | Scala library | Attributes as cached functions, tree relations (`parent`, `prev`, `next`, `index`), `circular`, `paramAttr` | The structure of the tree comes first, then attributes on demand |
| UUAG ([uuagc](https://hackage.haskell.org/package/uuagc)) | Haskell preprocessor | `DATA`, `ATTR`, `SEM`, copy rules, `USE` rules, a static order | Defaults remove equations, and a static order is optional |

### Layout as an attribute grammar

[Meyerovich and Bodík (2010)](https://doi.org/10.1145/1772690.1772763) wrote a subset of CSS layout as an attribute grammar ([PDF](https://archives.iw3c2.org/www2010/_lmeyerov/projects/pbrowser/pubfiles/playout.pdf)). Their analysis showed that a fixed sequence of parallel tree walks, top-down and bottom-up, evaluates it. [Meyerovich, Torok, Atkinson and Bodík (2013)](https://doi.org/10.1145/2442516.2442535) synthesize such schedules from an attribute grammar in their language FTL. A person can give a sketch of the schedule, and the synthesizer completes it and checks it.

The [layout protocol of Flutter](https://docs.flutter.dev/ui/layout/constraints) states the same pattern: "Constraints go down. Sizes go up. Parent sets position." A widget does not decide its own position. Its parent decides it.

For coeval, the equations and the schedule are two separate artifacts, as D3 says. The tree kit gives the equations and their graph. A host or a schedule adapter synthesizes the passes.

### Incremental evaluation

[Reps, Teitelbaum and Demers (1983)](https://doi.org/10.1145/2166.357218) update the attributes of a tree after a change to a subtree. The work is proportional to the attribute instances that change. For reference attributes, [Söderberg and Hedin (2012)](https://www.lunduniversity.lu.se/lup/publication/c2b6f02c-e473-4777-b6b7-dac621560fee) record the dependencies at run time. Study R4 covers this subject. For the tree kit, a host gives the memo cells, and a host with signals gets incremental updates (P3).

## How coeval relates today

| Idea | coeval today | Gap |
| --- | --- | --- |
| Attribute of a node | A field of a `panel` or `box` value, evaluated on demand with the node as `self` (`treeNode` in `packages/core/src/stdlib.ts`, TREE.ONCE) | Equations live only in the document. A kind has no equations of its own. |
| Synthesized attribute (up) | A parent reads `self.children` and gets the results of its children | The results are plain records, not nodes (item 1 below). |
| Inherited attribute (down) | A child reads `["self", "parent", "width"]` (TREE.PARENT) | The child knows the names of its parent. A parent cannot give an attribute to its children. |
| Reference attribute | A reference in an address position gives a host thing (FORMULA.ADDRESS, `HostThing` in `deref.ts`) | A reference to a sibling recurses (item 2 below). |
| Computed reference | The walker `nearest` (`nearestWalker`, TREE.NEAREST-SELF, TREE.NEAREST-MATCH) | No walker finds a node by its binding name. |
| Cycle | `#CYCLE!` for a cycle of references, after 64 collapses (`MAX_COLLAPSE` in `deref.ts`, DEREF.CYCLE) | No mark for an attribute in progress (item 3 below). |
| Scope of equations | Scope rules of kinds (`ScopeRule` in `world.ts`), read by `walk` and `refsOf` in `static.ts` (STATIC.REFS) | No rule for the names that a parent gives to the equations of its children. |
| Dependency graph | `dataEdges` and `layers` in `order.ts`, for the steps of a sequence (ORDER.EDGES, ORDER.LAYERS) | No graph of attribute instances. |
| Memo across evaluations | `adopt` lets a host read values through signals (DEREF.ADOPT) | No hook for the memo cell of an attribute. |
| Purity | `pure` evaluates a part without capabilities (CAP.PURE) | `treeNode` gives its fields the capabilities of its context. |

This study did not start the code. The rules of the machine permit only the linter. The findings below come from a reading of `treeNode` and `deref.ts`.

1. **A node gives a record, not a node.** `treeNode` evaluates each part and gives a plain record of the results. The host thing exists only while the parts evaluate. Thus `self.children` gives finished records, and a later reference cannot reach a child as a node.
2. **A reference to a sibling recurses.** Suppose that the second child reads `["self", "parent", "children", 0, "width"]`. The parent evaluates its part `children` at that time, and its memo has no mark for a part in progress. Thus the parent evaluates `children` again and makes new children, which read the sibling again. The recursion stops only at the limit of the stack of the host.
3. **A cycle ends at the limit of the stack, not at `#CYCLE!`.** A field that reads itself recurses in the same way. The frame that catches the overflow gives `#DEPTH!` (`thrown` in `errors.ts`, VALUE.DEPTH). Item 4 then hides it as `#N/A` in the frames above. No reason names the attributes of the cycle.
4. **A failed field reads as `#N/A`.** `deref` gives `undefined` for a field whose result is an error, thus a reference to it gives "reaches nothing". The kernel already has two carriers for the real error. `thrown` keeps the error of the exception `Failure`, and the formula kit gives the error of a `Held` value at the end of a path.
5. **The structural names hide fields.** `deref` answers `parent` and `type` before the fields, thus no path reaches a field with one of these names. D12 chose step documents for moves for this reason, but D10 chose field steps for trees.
6. **Documents between nodes are transparent.** `parent` comes from `context.self`, and a `list` or an `if` between two nodes passes `self` through. Thus the parent of a node is the nearest node around it. This behavior is correct, and Kiama has the same rule.

## Proposals ranked by value for effort

The first proposal gives the most value for the least effort. Effort S is one pull request of a day or less. Effort M is a few days, and effort L is a week or more.

### P1. A decorated tree with lazy attributes (effort S to M, value high)

- **What.** A new evaluator `tree.attr` comes beside the toy `tree.node`. Its result is the node thing, not a record. The part `children` gives the child things, and no attribute evaluates until a reference asks for it.
- **Memo and cycles.** Each node keeps one memo cell for each attribute, with a mark for "in progress". A demand that reaches a cell in progress gives `#CYCLE!`. Its reason gives the chain of places and attributes.
- **Errors and structure.** A failed attribute gives its own error through a reference, because the kit throws `Failure` from `deref`. Each node answers the structural steps `parent`, `children`, `index`, `prev` and `next`. A walker `tree.named` picks the node with a binding name from a list of nodes.
- **Output and purity.** A host gets the JSON of the tree with `valueOfThing`. The kit evaluates each equation without capabilities, as `pure` does.
- **Kernel parts.** `stdlib.ts` or a new `tree.ts`, the world of the examples and `SPEC.md`. The ladder, `deref.ts` and `evaluate.ts` do not change.
- **Risk.** A host that reads the result of a tree as a record gets a host thing. Thus the new evaluator has a new name, and `tree.node` stays until the hosts move. A memo for each node costs memory, as [Söderberg and Hedin (2011)](https://doi.org/10.1007/978-3-642-19440-5_2) measured for JastAdd.
- **Test.** New IDs: TREE.LAZY (an attribute that no reference reads does not evaluate), TREE.SIBLING (a node reads the width of its previous sibling), TREE.CYCLE (a demand cycle gives `#CYCLE!` with its chain), TREE.ERROR (a reference to a failed attribute gives its code) and TREE.REPMIN (the example of Bird in one evaluation).

### P2. Equations in kind contracts, with a ladder for attributes (effort M, value high)

- **What.** A kind gets an optional contract `tree` with two records of equations. `equations` gives the attributes of the node itself. `down` gives attributes of each child, and the names `child`, `index` and `prev` are in its scope.
- **The ladder.** A step with the name of an attribute visits five rungs, in this order:
  1. Own: a field of the value of the node, as in the toy.
  2. Kind: the equation in `tree.equations` of the kind of the node.
  3. Parent: the equation in `tree.down` of the kind of the parent.
  4. Copy: for an attribute with `copy`, the same attribute of the parent (the broadcast of JastAdd, the copy rule of UUAG).
  5. Default: the `fold` of the declaration over the children (the `USE` rule of UUAG), or its `default` term.
- **Plans.** The kit compiles each equation one time for each kind, through a `planner` (PLAN.CACHE). The plans of equations stay out of the plan of the document (PLAN.LEAN).
- **Kernel parts.** `Kind` in `world.ts` gets one optional field. `check` in `static.ts` walks the equations of each kind one time, with the scope of `down`. The trace of an attribute records its rungs, and the explorer (K6) draws them.
- **Risk.** The parent rung makes the value of a child depend on the kind of its parent. A reader of the child kind alone does not see the value. The trace and the explorer show the rung that answered.
- **Test.** TREE.LADDER (each rung, in order), TREE.DOWN (a `column` and a `row` place the same child kind in different positions), TREE.COPY, TREE.FOLD and TREE.DOWN-NAMES (`check` finds `names.index` outside `down`).

### P3. Memo cells from the host (effort S, value medium to high)

- **What.** The kit takes an optional function `cell(place, attribute, compute)` that makes the memo cell of an attribute. The default is a plain memo with the mark of P1. A host with signals gives a computed signal, and a change of the store then invalidates only the attributes that read it.
- **Stable keys.** The `place` of `CompileInput` stays the same across the evaluations of one plan. Thus a host can keep its cells between evaluations.
- **Kernel parts.** The kit only. `adopt` (DEREF.ADOPT) already covers values that read through signals.
- **Risk.** A signal library has its own cycle detection, and the kit changes its error into `#CYCLE!`. A kept cell holds a stale value after a change of the document, thus the key of a cell includes the plan.
- **Test.** TREE.CELL: a cell that counts shows one computation for each node and attribute. A second evaluation with kept cells computes nothing.

### P4. Static checks of attributes (effort S, value medium)

- **What.** `check` reports an unknown attribute name and a reference to `child`, `index` or `prev` outside `down`. It also reports an attribute with a reserved structural name and a tree kind of the run side.
- **Completeness.** `check` reports a kind that a document uses when no rung answers one of its attributes. Each kind gets this check on its own, as in the modular analysis of Silver, thus an open world stays open.
- **Kernel parts.** `static.ts` and new reasons for issues. No new error code.
- **Risk.** Low. A world with a fallback kind (WORLD.OPEN) makes the checks of unknown names weaker, and `check` reports only what it knows.
- **Test.** TREE.CHECK, and STATIC.AGREES for trees: a document that checks evaluates without these errors.

### P5. The graph of attribute instances (effort M, value medium to high)

- **What.** `attributeGraph(machine, doc)` gives one vertex for each node and attribute, and one edge for each read. The kit gets the edges from `refsOf` on each equation.
- **Edges.** A path from `self` gives an edge on the node. `self.parent` gives an edge from the parent, and `names.prev` an edge from the previous sibling. A fold gives an edge from each child.
- **Structural steps.** A step `nearest` with a type depends only on the structure, thus the kit resolves it on the concrete document. A step that depends on the value of an attribute gives an edge with an unknown source.
- **Use.** `check` uses the graph to report each cycle with its places before a run. The schedule layer (S1, S2) uses the same graph for an order, for independent groups (`layers`) or for parallel passes in the style of FTL. The kernel evaluator does not use the graph (D3).
- **Why it is cheap here.** A compiler knows its grammar before its trees, thus it needs the exponential test of Knuth or the approximation of OAG. `prepare` always has the concrete document. The instance graph is linear in nodes times attributes, and its cycle check is exact for static edges.
- **Kernel parts.** A new module beside `order.ts`. S1 gets its first concrete graph.
- **Risk.** Unknown edges make the check incomplete for reference attributes and for computed children. The check reports them as "not known before the run".
- **Test.** TREE.GRAPH (the edges of the example below) and TREE.GRAPH-CYCLE (`check` and an evaluation give the same `#CYCLE!`).

### P6. Circular attributes (effort M, value medium)

- **What.** An attribute declares `circular: { start, limit }`. Its cycle evaluates by the algorithm of Magnusson and Hedin. A demand inside the cycle gets the current approximation, and the first attribute of the cycle repeats until no value changes.
- **The limit.** A cycle that does not become stable within the limit gives `#CYCLE!`. Two values are equal by the rule of DOC.EQUALS.
- **Kernel parts.** The kit. The meaning of `#CYCLE!` in `SPEC.md` gets one more sentence.
- **Risk.** Equations that are not monotone can oscillate, or give a result that depends on the order. That result breaks the promise of D3. The kit cannot prove monotony, thus the limit and the code `#CYCLE!` are the guard.
- **Test.** TREE.CIRCULAR: the scrollbar example becomes stable in two rounds. The reachable nodes of a graph with a loop give the least fixed point. An equation that oscillates gives `#CYCLE!` at the limit.

### P7. Collection attributes and a registry of names (effort M, value medium)

- **What.** A declaration `collect: { root, op, unit }`, and a contract field `contributes`. Each node of a subtree contributes values, and the nearest node of the kind `root` combines them. The first use is a registry of binding names (`name` in the header, D6). With it, `tree.named` reaches each node of a subtree by name, not only a sibling.
- **Risk and test.** A collection walks the whole subtree before its first read. Two nodes with one name in one registry give `#VALUE!` at the read. The tests are TREE.COLLECT and TREE.NAMED.

### P8. Attributes with parameters (effort M, value medium)

- **What.** An attribute can have parameters, as `paramAttr` in Kiama or `syn T A.x(int a)` in JastAdd. A step `{ "type": ["tree", "at"], "value": { "attr": "height", "args": { "width": 200 } } }` asks for it. Intrinsic sizes need it: a parent asks "your height at this width" for more than one width.
- **Risk and test.** The memo grows with each new argument, and DOC.EQUALS on the JSON arguments gives the key. The test is TREE.AT.

### P9. Higher-order attributes and forwarding (effort L, value later)

- **What.** An equation gives a document. The kit prepares it and puts its root under the node, thus the new subtree has a parent and attributes. Forwarding adds one rung: an attribute without an equation comes from the forwarded subtree. Templates and the expansion of a component use this.
- **Risk and test.** `planner` caches by object (PLAN.CACHE), but each evaluation can give a new document object. Thus a structural key for the cache comes first. The tests are TREE.HIGHER and TREE.FORWARD.

## The minimal L2 API

### The declarations

```ts
/** The declaration of one attribute. */
interface Attribute {
  /** "up": the node computes it (synthesized). "down": the parent gives it (inherited). */
  readonly dir: "up" | "down";
  /** down: a node without an equation gets the value of its parent (copy rule, broadcast). */
  readonly copy?: boolean;
  /** up: a node without an equation combines the values of its children (USE rule). */
  readonly fold?: { readonly op: string; readonly unit: Json };
  /** The value when no rung answers. */
  readonly default?: Json;
  /** A cycle gives its least fixed point from the start value (P6). */
  readonly circular?: { readonly start: Json; readonly limit?: number };
}

/** The tree contract of a kind: the new optional field `tree` of `Kind`. */
interface TreeContract {
  /** The equations of the attributes of the node itself. `self` is the node. */
  readonly equations?: Readonly<Record<string, Json>>;
  /** The equations of the attributes of each child. `self` is this node. `names` has child, index and prev. */
  readonly down?: Readonly<Record<string, Json>>;
}

/** The kit: the evaluator tree.attr, the kinds tree.fold and tree.named, and their walkers. */
declare function treeKit(spec: {
  readonly attributes: Readonly<Record<string, Attribute>>;
  readonly cell?: (place: readonly Key[], attribute: string, compute: () => Result) => { get(): Result };
}): Partial<Machine>;

/** The graph of the attribute instances of one document (P5). */
declare function attributeGraph(machine: Machine, doc: unknown): AttributeGraph;
```

### An example: the box goes down, the size comes up, and a reference goes sideways

The attributes:

```json
{
  "width": { "dir": "down", "copy": true },
  "y": { "dir": "down", "default": 0 },
  "height": { "dir": "up", "fold": { "op": "add", "unit": 0 } },
  "natural": { "dir": "up", "default": 0 }
}
```

The kinds. The operations `sub`, `add`, `eq`, `measure` and `wrap` come from the profile of the language (D13).

```json
{
  "column": {
    "verbs": { "eval": "tree.attr" },
    "parts": { "shape": "record", "fields": { "children": { "shape": "list" } }, "rest": { "shape": "term", "of": "lit" } },
    "tree": {
      "down": {
        "width": { "type": ["ops", "sub"], "value": [{ "type": "ref", "value": ["self", "width"] }, 16] },
        "y": {
          "type": "if",
          "value": {
            "test": { "type": ["ops", "eq"], "value": [{ "type": "ref", "value": ["names", "index"] }, 0] },
            "then": { "type": ["ops", "add"], "value": [{ "type": "ref", "value": ["self", "y"] }, 8] },
            "else": {
              "type": ["ops", "add"],
              "value": [{ "type": "ref", "value": ["names", "prev", "y"] }, { "type": "ref", "value": ["names", "prev", "height"] }]
            }
          }
        }
      }
    }
  },
  "text": {
    "verbs": { "eval": "tree.attr" },
    "parts": { "shape": "record", "fields": {}, "rest": { "shape": "term", "of": "lit" } },
    "tree": {
      "equations": {
        "natural": { "type": ["ops", "measure"], "value": [{ "type": "ref", "value": ["self", "content"] }] },
        "height": {
          "type": ["ops", "wrap"],
          "value": [{ "type": "ref", "value": ["self", "natural"] }, { "type": "ref", "value": ["self", "width"] }]
        }
      }
    }
  },
  "badge": {
    "verbs": { "eval": "tree.attr" },
    "parts": { "shape": "record", "fields": {}, "rest": { "shape": "term", "of": "lit" } },
    "tree": { "equations": { "height": 20 } }
  }
}
```

The document. The badge reads the natural width of the title, which is a sibling.

```json
{
  "type": "column",
  "value": {
    "width": 320,
    "children": [
      { "type": "text", "name": "title", "value": { "content": "Revenue by region" } },
      { "type": "text", "value": { "content": "A long note that wraps at the width of the card." } },
      {
        "type": "badge",
        "value": {
          "x": { "type": "ref", "value": ["self", "parent", "children", { "type": ["tree", "named"], "value": "title" }, "natural"] }
        }
      }
    ]
  }
}
```

A host asks the root for its `height`. The demand goes as follows:

1. The column has no field and no equation for `height`, and the root has no parent. The `fold` default adds the heights of the three children.
2. The first text has an equation for `height` in its kind. The equation reads `self.natural` and `self.width`.
3. The text has no field and no equation for `width`. The `down` equation of its parent answers: 320 minus 16 gives 304.
4. The operation `wrap` gives the height of the text at the width 304. The memo keeps each value, thus a second read costs nothing.
5. The badge reads `natural` of the node with the name `title`. The title computes `natural` one time, also when its own `height` reads it.

The instance graph of P5 for this document:

| Edge | The read that gives it |
| --- | --- |
| root `width` to each child `width` | `down.width` reads `self.width` |
| child `natural` and child `width` to child `height` | the equation of `text` |
| each child `height` to root `height` | the `fold` default |
| root `y` to the first child `y` | `down.y` reads `self.y` at the index 0 |
| child `y` and child `height` to the `y` of the next child | `down.y` reads `names.prev` |
| title `natural` to badge `x` | the step `tree.named`, which depends only on the structure |

The graph has no cycle. Its layers give three passes, as Meyerovich and Bodík found for CSS. Widths go down, heights come up, then positions go down. The kernel does not use the passes, but a schedule can (D3).

Suppose that the equation of `text` for `height` reads `["self", "parent", "height"]` instead. Then root `height` reads child `height`, which reads root `height`. P5 lets `check` report `#CYCLE!` with this chain before a run, and P1 gives the same code during the evaluation.

### How the kit composes with the kernel

- **Sealed parts (D7).** `tree.attr` evaluates its parts through their handles, with the node as `self`. Equations are code of the kind, not parts of the document. Two children with the same results can replace each other (EVAL.SEALED).
- **Plans.** `prepare` compiles the document one time, and the kit compiles each equation one time for each kind. Each evaluation of the plan makes new node things and new memo cells. Thus TREE.ONCE holds for each evaluation, and only P3 keeps cells across evaluations.
- **References.** An attribute step is a `deref` step on a host thing (DEREF.HOST, D10). Thus one path can mix structural steps, attribute steps, `nearest` and `tree.named`.
- **Sides.** A tree kind is on the derive side. The kit evaluates each equation without capabilities, thus an effect in an equation fails as in `pure` (CAP.PURE).

## Open questions

1. **Structural steps.** D10 makes `parent` and `children` field steps of a node. D12 uses step documents for moves, because a record can have a field with the name of a move. Does the kit reserve `parent`, `children`, `index`, `prev` and `next`, or does it give them as step documents?
2. **Inherited reads.** Is `["self", "width"]` through the parent rung the one form? Or does `["self", "parent", "width"]` stay as a second form? The two forms agree only when the parent has no `down` equation for `width`.
3. **Rungs.** Does the ladder of the kernel (`RUNGS` in `ladder.ts`) get the rungs `parent` and `copy`? Or does the kit keep its own trace type? The explorer draws the ladder of `ask` at this time.
4. **Declarations.** Do attribute declarations live in the spec of the kit, as the profile of the formula kit does? Or do they live in the world, so that a world document carries them?
5. **Circularity.** Does coeval permit circular attributes, or does `#CYCLE!` stay the only meaning of a cycle? A fixed point needs monotone equations, and the kit cannot prove monotony.
6. **A store of named nodes.** The reactive formula language has a graph of named nodes, not a tree. Does it use the instance graph and the cycle check of P5 without the tree rungs?
7. **A tree space.** The formula language over positions moves through records, grids and trees. Does the tree kit give it a tree space whose moves are the structural steps, with one implementation of the zipper for both?

## Sources

- Bird, R. S. (1984). ["Using circular programs to eliminate multiple traversals of data"](https://doi.org/10.1007/BF00264249). Acta Informatica 21(3), 239–250.
- Boyland, J. T. (2005). ["Remote attribute grammars"](https://doi.org/10.1145/1082036.1082042). Journal of the ACM 52(4), 627–687.
- Bransen, J., Middelkoop, A., Dijkstra, A. and Swierstra, S. D. (2012). ["The Kennedy-Warren algorithm revisited: ordering attribute grammars"](https://doi.org/10.1007/978-3-642-27694-1_14). PADL 2012.
- Ekman, T. and Hedin, G. (2007). ["The JastAdd system: modular extensible compiler construction"](https://doi.org/10.1016/j.scico.2007.02.003). "Science of Computer Programming" 69(1–3), 14–26. The [reference manual](https://jastadd.cs.lth.se/web/documentation/reference-manual.php) gives the syntax of `inh`, `coll`, `circular` and nonterminal attributes.
- Farrow, R. (1986). ["Automatic generation of fixed-point-finding evaluators for circular, but well-defined, attribute grammars"](https://doi.org/10.1145/12276.13320). SIGPLAN Symposium on Compiler Construction, 85–98.
- Flutter documentation. ["Understanding constraints"](https://docs.flutter.dev/ui/layout/constraints).
- Hedin, G. (2000). ["Reference attributed grammars"](https://lup.lub.lu.se/record/107069). Informatica 24(3), 301–317.
- Huet, G. (1997). ["The zipper"](https://doi.org/10.1017/S0956796897002864). "Journal of Functional Programming" 7(5), 549–554.
- Jazayeri, M., Ogden, W. F. and Rounds, W. C. (1975). ["The intrinsically exponential complexity of the circularity problem for attribute grammars"](https://doi.org/10.1145/361227.361231). Communications of the ACM 18(12), 697–706.
- Johnsson, T. (1987). ["Attribute grammars as a functional programming paradigm"](https://doi.org/10.1007/3-540-18317-5_10). FPCA 1987, LNCS 274, 154–173.
- Jourdan, M. (1984). ["Strongly non-circular attribute grammars and their recursive evaluation"](https://doi.org/10.1145/502874.502882). SIGPLAN Symposium on Compiler Construction.
- Kaminski, T. and Van Wyk, E. (2012). ["Modular well-definedness analysis for attribute grammars"](https://doi.org/10.1007/978-3-642-36089-3_20). SLE 2012.
- Kastens, U. (1980). ["Ordered attributed grammars"](https://doi.org/10.1007/BF00288644). Acta Informatica 13(3), 229–256.
- Kennedy, K. and Warren, S. K. (1976). ["Automatic generation of efficient evaluators for attribute grammars"](https://doi.org/10.1145/800168.811538). POPL 1976.
- Knuth, D. E. (1968). ["Semantics of context-free languages"](https://doi.org/10.1007/BF01692511). Mathematical Systems Theory 2(2), 127–145. [Correction](https://doi.org/10.1007/BF01702865), 1971.
- Magnusson, E., Ekman, T. and Hedin, G. (2007). ["Extending attribute grammars with collection attributes: evaluation and applications"](https://lup.lub.lu.se/record/634097). SCAM 2007, 69–78.
- Magnusson, E. and Hedin, G. (2007). ["Circular reference attributed grammars: their evaluation and applications"](https://doi.org/10.1016/j.scico.2005.06.005). "Science of Computer Programming" 68(1), 21–37.
- Martins, P., Fernandes, J. P. and Saraiva, J. (2013). ["Zipper-based attribute grammars and their extensions"](https://doi.org/10.1007/978-3-642-40922-6_10). SBLP 2013, LNCS 8129, 135–149.
- Meyerovich, L. A. and Bodík, R. (2010). ["Fast and parallel webpage layout"](https://doi.org/10.1145/1772690.1772763). WWW 2010, 711–720.
- Meyerovich, L. A., Torok, M. E., Atkinson, E. and Bodík, R. (2013). ["Parallel schedule synthesis for attribute grammars"](https://doi.org/10.1145/2442516.2442535). PPoPP 2013, 187–196.
- Reps, T., Teitelbaum, T. and Demers, A. (1983). ["Incremental context-dependent analysis for language-based editors"](https://doi.org/10.1145/2166.357218). TOPLAS 5(3), 449–477.
- Sloane, A. M. (2011). ["Lightweight language processing in Kiama"](https://doi.org/10.1007/978-3-642-18023-1_12). GTTSE III, LNCS 6491.
- Sloane, A. M., Kats, L. C. L. and Visser, E. (2013). ["A pure embedding of attribute grammars"](https://doi.org/10.1016/j.scico.2011.11.005). "Science of Computer Programming" 78(10), 1752–1769.
- Söderberg, E. and Hedin, G. (2011). ["Automated selective caching for reference attribute grammars"](https://doi.org/10.1007/978-3-642-19440-5_2). SLE 2010, LNCS 6563.
- Söderberg, E. and Hedin, G. (2012). ["Incremental evaluation of reference attribute grammars using dynamic dependency tracking"](https://www.lunduniversity.lu.se/lup/publication/c2b6f02c-e473-4777-b6b7-dac621560fee). Technical report LU-CS-TR:2012-249, Lund University.
- Swierstra, S. D., Azero Alcocer, P. R. and Saraiva, J. (1999). ["Designing and implementing combinator languages"](https://doi.org/10.1007/10704973_4). AFP 1998, LNCS 1608, 150–206. The [uuagc package](https://hackage.haskell.org/package/uuagc) is the UUAG system.
- Uustalu, T. and Vene, V. (2005). ["Comonadic functional attribute evaluation"](https://ws.lib.ttu.ee/digibase/et/Publ/Item/937eb25e-592a-4946-ab4c-c035687f0424). "Trends in Functional Programming 6".
- Uustalu, T. and Vene, V. (2008). ["Comonadic notions of computation"](https://doi.org/10.1016/j.entcs.2008.05.029). ENTCS 203(5).
- Van Wyk, E., Bodin, D., Gao, J. and Krishnan, L. (2010). ["Silver: an extensible attribute grammar system"](https://doi.org/10.1016/j.scico.2009.07.004). "Science of Computer Programming" 75(1–2), 39–54.
- Van Wyk, E., de Moor, O., Backhouse, K. and Kwiatkowski, P. (2002). ["Forwarding in attribute grammars for modular language design"](https://doi.org/10.1007/3-540-45937-5_11). CC 2002, LNCS 2304, 128–142.
- Vogt, H. H., Swierstra, S. D. and Kuiper, M. F. (1989). ["Higher order attribute grammars"](https://doi.org/10.1145/73141.74830). PLDI 1989, 131–145.
