# R4: incremental computation and schedules

This file is a research study for the schedule layer: the items S1, S2 and S3 of `docs/ROADMAP.md`. It changes no rule. The coeval session decides which proposals go into `docs/ROADMAP.md` and `docs/DECISIONS.md`.

## The question

D3 puts each schedule in a separate layer: coeval defines what a value is, and a schedule decides when to compute it. This study asks three questions. What data does S1 give a schedule? Which static analysis serves the schedules (S2)? How do the main designs of incremental computation connect to the kernel (S3)?

Three hosts guide the answers. A user interface host evaluates formulas inside the computeds of a signal library. A read inside a computed is tracked, and a memo across calls inside a computed breaks the tracking. A reactive formula language evaluates formulas over a store of named nodes, with a push engine. The engine has epochs, strongly connected components by Tarjan, and change detection by value equality. A third host evaluates one formula at each cell of a grid.

## The findings in short

1. The unit of incremental work is a document: a named node, a cell or an attribute. A schedule records the dependencies between documents, not between the nodes of a plan (PLAN.LEAN).
2. The kernel has most of the static half of S1. `refsOf` gives the free references of a document, and each kind declares its side and its effects. Two marks are missing: a read under a lazy part, and a read after a computed step.
3. The dynamic half is cheap. Each reference goes through `Runtime.resolve`, thus a list of the reads of one evaluation costs one push for each resolution. This list is the trace of Adapton and Salsa.
4. Early cutoff needs an equality that is safe for each host value. `docEquals` is for JSON, and by its code it finds two different dates equal.
5. The proof obligation of D3 is a property test: after each change, each schedule gives the result of an evaluation from scratch.

## Background

### Self-adjusting computation

Acar, Blelloch and Harper record each read of a modifiable cell during an evaluation (["Adaptive functional programming"](https://doi.org/10.1145/503272.503296), POPL 2002, [TOPLAS 2006](https://doi.org/10.1145/1186632.1186634)). The record is a dynamic dependence graph (DDG) with a time stamp for each read. After a change, change propagation evaluates each affected read again, in the order of time. Memoization reuses parts of the old trace ([POPL 2003](https://doi.org/10.1145/604131.604133), [the thesis of Acar](https://www.cs.cmu.edu/~rwh/students/acar.pdf)). [Acar, Blume and Donham](https://doi.org/10.1017/S0956796813000099) prove that change propagation gives the result from scratch.

**For coeval.** A modifiable is a host value that a path reaches, and a read is one resolution. The DDG of a document is the ordered list of its reads. A memo for each node of a plan does not pay. A node costs approximately 22 ns (R1), and a memo hides reads from a signal host.

### Adapton

Hammer and others make incremental computation demand-driven (["Adapton: Composable, Demand-Driven Incremental Computation"](https://doi.org/10.1145/2594291.2594324), PLDI 2014, [PDF](https://people.mpi-sws.org/~hammer/adapton-pldi2014.pdf)). A demanded computation graph (DCG) records which thunk read which cell. A change marks the readers dirty at once (push), and a later demand cleans only the dirty nodes that it reaches (pull). An outer layer changes the cells, and an inner layer computes without effects. The paper proves from-scratch consistency. [Nominal Adapton](https://doi.org/10.1145/2814270.2814305) gives each memo entry a name.

**For coeval.** The outer layer and the inner layer are the run side and the derive side (D3). The name of an entry is the name of a node or the place of a document (D10). "Push dirty, pull clean" is the pull column of the diagram C3.

### Incremental lambda calculus

Cai, Giarrusso, Rendel and Ostermann differentiate a program statically (["A theory of changes for higher-order languages"](https://doi.org/10.1145/2594291.2594304), PLDI 2014). The derivative `f'` of a function obeys `f(a ⊕ da) = f(a) ⊕ f'(a, da)`, and a mechanized proof shows the rule.

**For coeval.** A derivative is a change from one document to another, as `mapRefs` makes. It pays only for aggregates over large collections, thus P8 keeps it for later.

### Build systems à la carte

Mokhov, Mitchell and Peyton Jones split a build system into a scheduler and a rebuilder (["Build systems à la carte"](https://doi.org/10.1145/3236774), ICFP 2018, [JFP 2020](https://doi.org/10.1017/S0956796820000088)). A task reads each dependency through a function `fetch`. An `Applicative` task has static dependencies, and a `Monad` task has dynamic dependencies.

- The schedulers are topological (static dependencies only), restarting (Excel) and suspending ([Shake](https://doi.org/10.1145/2364527.2364538)).
- The rebuilders use a dirty bit, verifying traces or constructive traces. A verifying trace keeps a hash of each value that a task read, and a later build examines the hashes.
- With early cutoff, a task that gives the same value again does not make its readers build.
- A build is correct when each value equals the value from scratch. It is minimal when each task builds at most one time, and only after a change of an input.

[Selective applicative functors](https://doi.org/10.1145/3341694) (ICFP 2019) are between the two kinds. A static analysis gives the dependencies that a task can read, and the dependencies that it always reads.

**For coeval.** `fetch` is `resolve`, and a document is a task. With only key paths outside lazy parts, it is `Applicative`. An `if` makes it selective, and a computed step makes it a `Monad` task. The two sets are the marks `always` and `exact` of the sketch below.

### Salsa and the query system of rustc

The rustc compiler computes each fact as a query with a memo, and it records the queries that each query reads ([the rustc dev guide](https://rustc-dev-guide.rust-lang.org/queries/incremental-compilation-in-detail.html)). The red-green algorithm examines the dependencies of a node in their order. It evaluates the query again only after a red dependency, and a hash of the new result gives early cutoff. [Salsa](https://salsa-rs.github.io/salsa/reference/algorithm.html) "backdates" a new result that equals the old result. Durability keeps one revision counter for each level of change ([Matklad, "Durable Incrementality"](https://rust-analyzer.github.io/blog/2023/07/24/durable-incrementality.html), 2023). A query with only durable inputs skips its examination when the durable counter did not change.

**For coeval.** A named node is a query, and an epoch is a revision. A person edits a document rarely, and data changes at each event. Thus two levels of durability give most of the gain (P7).

### Jane Street Incremental and Skip

[Incremental](https://github.com/janestreet/incremental/blob/master/src/incremental_intf.ml) computes at a call of `stabilize`. A heap visits the changed nodes in the order of their height, thus each node computes at most one time. Each node has a cutoff function, and only the nodes with a path to an observer compute. `bind` changes the graph during a stabilization.

[Skip](https://skiplang.com/) is a language whose type system tracks effects. A function that the types prove pure can have a memo.

**For coeval.** The height is the order of a push schedule (S2), and the observers are the documents that a host shows. The kernel cannot prove the purity of a host operation, thus the contract of a kind declares it (R1 P3).

### Spreadsheet recalculation

Excel builds a dependency tree, a calculation chain and a set of dirty cells ([Excel Recalculation](https://learn.microsoft.com/en-us/office/client-developer/excel/excel-recalculation)). A change marks each direct and indirect dependent dirty, and a recalculation follows the chain. When a cell reads a cell that is not computed yet, Excel moves it down the chain: a restarting scheduler. A volatile function (`NOW`, `OFFSET`, `INDIRECT`) recalculates each time, with all its dependents. [Sestoft](https://doi.org/10.7551/mitpress/8647.001.0001) describes the data structures of a spreadsheet (2014).

**For coeval.** A reference with a computed step is a dynamic range, and Excel treats it as volatile. A list of reads (P3) gives its exact dependencies for the next change. One formula at each cell of a grid shares one plan (PLAN.CACHE), and it can share its static facts too.

### Reactive programming and signals

A glitch is a state in which an observer sees some values after a change and others before it ([Bainomugisha and others](https://doi.org/10.1145/2501654.2501666), 2013). FrTime pushes each change in the order of height to stop glitches ([Cooper and Krishnamurthi](https://doi.org/10.1007/11693024_20), ESOP 2006). Functional reactive programming gives behaviors as functions of time ([Elliott and Hudak](https://doi.org/10.1145/258948.258973), 1997, [push-pull FRP](https://doi.org/10.1145/1596638.1596643), 2009).

The signal libraries of the browser use push-pull. [Angular](https://github.com/angular/angular/blob/main/packages/core/primitives/signals/README.md) pushes dirty marks at a change, and it computes a value again only when a reader pulls it. A computed records the signals that it reads at each evaluation, thus its dependencies are dynamic. An `equals` function stops an equal value, with `Object.is` as the default ([TC39 proposal](https://github.com/tc39/proposal-signals)).

[Preact](https://preactjs.com/blog/signal-boosting/) keeps a version on each signal. [S.js](https://github.com/adamhaile/S) gives each computation an owner, which disposes its inner computations when it updates. Solid keeps this model ([Carniato](https://dev.to/ryansolid/a-hands-on-introduction-to-fine-grained-reactivity-3ndf)).

**For coeval.** A signal host is a schedule that coeval does not see. The plan evaluates inside a computed, and each read through `adopt` or a host thing reads a signal. Thus the plan must not keep a value across evaluations, and `equals` gets a safe equality (P1).

### Differential dataflow

[Differential dataflow](https://www.cidrdb.org/cidr2013/Papers/CIDR13_Paper111.pdf) (McSherry and others, CIDR 2013) keeps a collection as differences, each with a time from a partial order ([Naiad](https://doi.org/10.1145/2517349.2522738)). [DBSP](https://doi.org/10.14778/3587136.3587137) (VLDB 2023) gives an incremental form of each query over streams of weighted sets.

**For coeval.** This model is for collections: the storage adapter (L5) and aggregates over a space. It does not fit one small formula.

### The guarantees side by side

| Design | Dependencies | When it computes | Early cutoff | Glitch free | Result from scratch |
| --- | --- | --- | --- | --- | --- |
| Self-adjusting computation | Dynamic, recorded | Push, in the order of time | Yes | Yes | Proved |
| Adapton | Dynamic, recorded | Dirty push, clean pull | Yes | Yes | Proved |
| Incremental lambda calculus | Static derivative | The derivative | Not applicable | Not applicable | Proved |
| Build systems à la carte | Static or dynamic | Topological, restarting, suspending | With traces | Not applicable | Defined |
| Salsa and rustc | Dynamic, recorded | Pull, red-green | Yes, hash or equality | Yes | Not formal |
| Incremental | Dynamic through `bind` | Push by height | Yes, per node | Yes | Not formal |
| Excel | Static, and volatile functions | Dirty marks, then the chain | No | Yes | Not formal |
| Signal libraries | Dynamic, recorded | Dirty push, lazy pull | Yes, `equals` | Yes | Not formal |
| Differential dataflow, DBSP | Static dataflow | Push of differences | Not applicable | Yes | Proved for DBSP |

## How coeval relates today

| Idea | coeval today | Where |
| --- | --- | --- |
| Static dependencies | `refsOf`: the free references | `static.ts`, STATIC.REFS |
| Lazy parts | `if`, `and`, `or` and lazy operations skip parts, with no mark in a contract | `formula.ts`, EVAL.LAZY-IF, FORMULA.LAZY |
| Dynamic dependencies | Each reference goes through `Runtime.resolve`, and nothing records it | `evaluate.ts` (`Session.resolve`) |
| A record of an evaluation | `EvalOptions.effects`, and a trace of documents | PLAN.TRACE, K6 |
| The side and the effects | `Kind.side`, `Kind.effects` | `world.ts`, STATIC.CAP |
| Purity | Not declared (R1 P3 proposes `pure`) | R1 |
| Equality | `docEquals`, for JSON | `doc.ts`, DOC.EQUALS |
| Order and layers | For the steps of one sequence | `order.ts`, ORDER.LAYERS |
| Reads of the host | `adopt`, host things with `resolve` | `deref.ts`, DEREF.ADOPT, DEREF.PATH |
| Durability of documents | `planner` compiles a document object one time | PLAN.CACHE |
| Four schedules | A diagram with the same values in four columns | `ScheduleDiagram.tsx`, C3 |

The code shows five gaps:

1. **The cutoff.** `docEquals` compares the own keys of each object. Two dates have no own keys, thus they are equal. A result can be any host value (VALUE.ANY), thus a cutoff with `docEquals` can keep a stale value.
2. **Lazy parts and computed steps.** `refsOf` gives the reads of both branches of an `if`, with no mark, thus a static graph can show a false cycle. A read after a step document has a static prefix only.
3. **No record of reads.** Each reference reads outside its document through `Session.resolve`, and `Session.resolve` records nothing.
4. **An order for a store.** `layers` in `order.ts` takes quadratic time, and the kernel has no strongly connected components.
5. **The diagram C3.** `ScheduleDiagram.tsx` writes its dependencies by hand (`DEPS`). The rule of the site says that each answer comes from real code.

## What each schedule must keep true

1. **The result from scratch.** After each change, each node that a host reads gives the result of a new plan, or of the reference interpreter (K9). The comparison uses the rules of one meaning of R1.
2. **No glitch.** Each evaluation on the derive side reads the data of one epoch.
3. **No repeat of a run.** A schedule can evaluate a derive document again at any time. A change of data does not repeat a run (L3).
4. **A safe cutoff.** A cutoff stops a change only when the two results are the same by P1.
5. **The count of work.** The count of computations is a measure, not a rule.

## Proposals ranked by value for effort

Effort S is one pull request of a day or less. Effort M is a few days, and effort L is a week or more.

| Rank | Proposal | Effort | Value |
| --- | --- | --- | --- |
| P1 | `sameResult`: a safe equality for early cutoff | S | High: each cutoff uses it |
| P2 | `factsOf`: the static facts of a document (S1) | S to M | High: each adapter and S2 read it |
| P3 | A list of reads, and `verifyReads` (S1) | S | High for a push host |
| P4 | A harness for one meaning across schedules | M | High: the proof of D3 |
| P5 | The analysis of a graph of nodes (S2) | M | Medium to high |
| P6 | A reference adapter for signals, in the tests (S3) | S to M | Medium |
| P7 | Two levels of durability | S | Medium |
| P8 | Derivatives of aggregates | L | Later |
| P9 | A memo for each node of a plan | L | Not proposed |

### A sketch of the interface of S1

The names are proposals. The static half depends only on the document and the world. The dynamic half comes from one evaluation.

```ts
/** The static facts of one document (P2). */
export interface DocFacts {
  readonly reads: readonly StaticRead[]; // the free references (STATIC.REFS), with two marks
  readonly side: Side;                   // "run" when one kind of the document is on the run side
  readonly effects: readonly string[];   // the kinds of effects, from the contracts
  readonly pure: boolean;                // each kind and each operation declares `pure`
  readonly volatile: boolean;            // an operation can change its value without a read (a clock)
  readonly closed: boolean;              // the reads are complete: no `ext`, no host code that reads outside
  readonly size: number;                 // the count of documents: a hint of the cost
}

export interface StaticRead {
  readonly root: Root;
  readonly keys: readonly Key[];         // the steps up to the first computed step
  readonly exact: boolean;               // false when a computed step comes after the keys
  readonly always: boolean;              // false under a lazy part: a branch of `if`, a later item of `and`
  readonly place: readonly Key[];
}

export function factsOf(machine: Machine, doc: unknown, options?: WalkOptions): DocFacts;

/** One read of one evaluation, in the order of the evaluation (P3). */
export interface Read {
  readonly path: readonly unknown[];     // the concrete path that `resolve` got
  readonly reached: Resolution;          // what it reached, without hops
}
// EvalOptions gets `reads?: Read[]`, as it has `effects?: Effect[]`.

export function sameResult(a: Result, b: Result): boolean;                                  // P1
export function verifyReads(machine: Machine, ctx: Context, reads: readonly Read[]): boolean; // P3

/** S2 (P5): the graph of the nodes of a host. */
export interface NodeGraph<Id> {
  readonly edges: ReadonlyMap<Id, readonly { readonly to: Id; readonly always: boolean }[]>;
}
export function graphOf<Id>(facts: ReadonlyMap<Id, DocFacts>, target: (read: StaticRead) => Id | undefined): NodeGraph<Id>;
export function components<Id>(graph: NodeGraph<Id>): readonly (readonly Id[])[];
export function heights<Id>(graph: NodeGraph<Id>): ReadonlyMap<Id, number>;
export function cycles<Id>(graph: NodeGraph<Id>): readonly { readonly nodes: readonly Id[]; readonly certain: boolean }[];
export function necessary<Id>(graph: NodeGraph<Id>, observed: Iterable<Id>): ReadonlySet<Id>;
```

### P1: a safe equality for early cutoff (effort S, value high)

- **What.** `sameResult(a, b)` compares two results. Plain records and lists compare by their items (DOC.RECORD), and each other object compares by `Object.is`. Two errors are the same when their codes, reasons and places are the same.
- **Why it is safe.** A wrong `false` costs work, but a wrong `true` keeps a stale value. Thus the function gives `false` when it is not sure. A machine can give its own `equals` for host values.
- **Use.** The `equals` of a computed, the change detection of a push engine, and the backdate of a verifying trace.
- **Kernel parts.** `doc.ts` or `errors.ts`, and SPEC (RESULT.SAME).
- **Risk and test.** A map gives no cutoff without a host `equals`. RESULT.SAME: two different dates differ, and two errors with different places differ.

### P2: the static facts of a document (effort S to M, value high)

- **What.** `factsOf` walks a document one time (STATIC.LINEAR) and gives the facts of the sketch. A cache by document object keeps them, as PLAN.CACHE keeps plans.
- **Lazy parts.** A shape can mark a part `lazy: true`. `if` marks `then` and `else`, `and` and `or` mark each item after the first, and a lazy operation marks each argument.
- **Contracts.** A kind declares `pure` (shared with K13) and `volatile`. A profile names its pure operations and its volatile operations.
- **Kernel parts.** `Shape` and `Kind` in `world.ts`, `DocVisit`, `static.ts`, `formula.ts`, and SPEC (SCHED.FACTS).
- **Risk.** A wrong mark `pure` gives stale values.
- **Test.** SCHED.FACTS on the examples. SCHED.COVER links P2 and P3: each recorded read of a closed document starts with the keys of a static read.

### P3: a list of reads, and their verification (effort S, value high)

- **What.** `EvalOptions.reads` is a list, as `EvalOptions.effects` is. `Session.resolve` adds one `Read` for each resolution. A plan without the list pays one test for each resolution.
- **Verification.** `verifyReads` resolves each path again, in order, and stops at the first difference. When each read gives the same thing, the old result stays valid, because a pure document is a function of its reads. This is the verifying trace of Shake and the green mark of rustc.
- **Order.** The step documents of a path evaluate before the path (FORMULA.STEPS), thus a concrete path depends on the reads before it.
- **Cost.** One object and one push for each reference. A CI benchmark compares FORMULA.SPEED with the list and without it. A verification skips the operations, thus it gains only for a heavy document (`size`).
- **Completeness.** `ext` (FORMULA.EXT-CONTEXT), a host operation and a host thing can read outside `resolve`. Thus the list is complete only for a document with `closed: true`. A name that a `let` binds is in the list too, and the host keeps only the free reads.
- **Kernel parts.** `EvalOptions`, `RunOptions` and `Session` in `evaluate.ts`, and SPEC (SCHED.READS, SCHED.VERIFY).
- **Risk and test.** Each read keeps what it reached in memory. SCHED.READS: an `if` records only the reads of its branch. SCHED.VERIFY: a change that the document did not read verifies.

### P4: a harness for one meaning across schedules (effort M, value high)

- **What.** A model-based property test with [fast-check](https://fast-check.dev/). A generator makes a store of named nodes from the document generator of K9 (R1 P1), with references between nodes, `if` and some cycles. The commands change a value, edit a document or read a node.
- **Schedules.** Once, demand with a memo, push-pull with dirty marks, push by height with a cutoff, and verifying traces. Each one obeys the five rules above, and P3 gives the epoch of each read for the glitch check.
- **For the hosts.** The kit exports `agreeSchedule(engine)`, thus each host tests its own engine in its own repository (S3).
- **Kernel parts.** A test kit, SPEC (SCHED.AGREE, SCHED.GLITCH, SCHED.RUN-ONCE), and a CI job with `workflow_dispatch`.
- **Risk and test.** A weak generator gives false confidence, thus the harness counts what it reaches. A mutant schedule that forgets one dirty mark fails.

### P5: the analysis of a graph of nodes (effort M, value medium to high)

- **What.** `graphOf` changes each static read into an edge. The function `target` gives the node that a read reaches, for example the first key under `world`.
- **Analysis.** `components` uses the algorithm of Tarjan without the stack of the host. `heights` gives the order of a push schedule, and a linear `layers` gives the independent groups. `necessary` gives the nodes with a path to an observed node.
- **Cycles.** A cycle of `always` edges is certain, and `check` reports it before a run. Another cycle is possible, and only an evaluation finds it.
- **Unknown edges.** A read with `exact: false` can reach any node. The host evaluates such a node at each epoch, as a volatile cell, or it uses P3.
- **Kernel parts.** A new `graph.ts` beside `order.ts`, and SPEC (GRAPH.SCC, GRAPH.ORDER, GRAPH.CYCLE). The attribute graph of R3 P5 uses it.
- **Test.** A diamond, a cycle under an `if`, and a chain of 100000 nodes without an overflow.

### P6: a reference adapter for signals (effort S to M, value medium)

- **What.** A small push-pull signal library in the tests, and an adapter. Each node is a computed that evaluates its plan, a host thing reads each other node through its signal (DEREF.ADOPT), and `equals` is `sameResult`.
- **The rules that it proves, for the documentation of S3.**
  1. A plan keeps no value across evaluations (PLAN.LEAN), thus the library sees each read.
  2. A memo that lives longer than one evaluation is a signal: the memo cells of R3 P3.
  3. A fold of K13 (R1 P3) reads nothing outside, thus it is safe. A root that K14 (R1 P4) resolves at compile time must not hold signals.
  4. With `adopt`, `resolve` skips its quick path (DEREF.QUICK). A host thing with `resolve` still answers a path of keys with one signal read (DEREF.PATH).
- **Kernel parts.** Tests only. The diagram C3 can then get its graph from `factsOf`.
- **Test.** SCHED.SIGNALS: a change computes only its readers, and an equal result stops at the cutoff.

### P7: two levels of durability (effort S, value medium)

- **What.** The facts and the plans depend on the world and the documents. The values depend on the data. A host keeps one epoch for the structure and one for the data.
- **Use.** A change of data keeps the graph, the order and the plans. An edit computes the facts of one document again, as Excel builds its tree again only after a change of structure.
- **Risk and test.** A document object that changes in place keeps stale facts, as PLAN.CACHE says. SCHED.DURABLE: a change of data compiles nothing.

### P8: derivatives of aggregates (effort L, later)

An operation of a profile gives a derivative, thus an aggregate over a space updates in a time that the change sets. It waits until a language over positions asks for it.

### P9: a memo for each node of a plan (effort L, not proposed)

This is self-adjusting computation inside the plan. It costs time in each evaluation, it hides reads from a signal host, and it breaks PLAN.LEAN. D3 puts this work in the schedule.

## Open questions

1. **Lazy parts.** Is `lazy` a mark of the shape (K2), or does the static kit get it from the formula kit?
2. **Purity.** Do R1 P3 and the schedules share one field `pure`? Does the kind, the profile, or both declare `volatile`?
3. **Cycles across nodes.** In a demand schedule, the node that closes a cycle depends on the first read. Does each node of a cycle give `#CYCLE!`, so that each schedule gives the same error?
4. **Granularity.** Does a read of `["world", "a", "x"]` depend on the node `a`, or on its field `x`?
5. **The run side.** Is a run document a sink of the graph, as an effect of a signal library? What starts it (L3)?
6. **Walkers.** Does a walker, for example `nearest`, declare its reads, so that `factsOf` gives exact reads after a computed step?
7. **Adapters.** Does each adapter live in the repository of its host, or does this repository keep a package of adapters?
