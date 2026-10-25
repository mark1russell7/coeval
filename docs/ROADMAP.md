# Roadmap

This file is the one list of the work of coeval. Each item has an ID and a status. The tracker page mirrors this file.

The statuses are: `done`, `in progress`, `next`, `waiting` (on a decision of the owner), and `later`.

The studies in `docs/research/` rank proposals for the kernel and the kits. Each proposal that the plan takes up is a row here. The row gives its study and its number, for example (R3 P5).

## The order of the next work

The plan does the next work in this order (2026-10-24). It takes up the studies R1 to R6.

1. K8: `check` narrows the capabilities of the parts as the kinds do (done, 2026-10-24).
2. K9: a harness for one meaning (R1 P1) (done, 2026-10-24). At its start, it found four bugs of the kernel, and version 0.4.2 corrects them.
3. K20 and K21 together, two correctness fixes, and the helper `partsOf`, a request of a language (done, 2026-10-24, version 0.4.3):
   - K20: `check` knows the names of operations and extensions through the hook `known` of the machine, and `fn` declares the shape of `params` (R5 P1). Before, an unknown `ops.*` or `ext.*` passed `check` and failed with `#NAME?` in a run.
   - K21: `docEquals` compares the values that are not plain JSON by identity (R4). Before, it compared only the own keys, thus two different dates or maps were equal.
4. L2a: the decorated tree (R3 P1) (done, 2026-10-24, version 0.5.0). Each field of a node of `panel` or `box` evaluates on demand, with one memo for each node and attribute. A sibling is a path through the parent, a cycle gives `#CYCLE!` with its chain, and a failed field keeps its error. The nightly agreement run is green again.
5. K32: one merge function for worlds and machines, with conflict rules (R6 P2) (done, 2026-10-24, version 0.6.0, D17). `mergeWorlds` and `mergeMachines` merge equal entries, and namespaces key by key. Each other clash throws one `MergeError` with each conflict, unless the later part names its path in `replaces`. `formulaMachine` uses the merge, thus the `ops` of a language extend the namespace of the kit.
6. K34: the composition checklist as spec tests (R6 P1) (done, 2026-10-24, version 0.6.1, D18, [`COMPOSITION.md`](COMPOSITION.md)). Five modes work. The new helpers `restrictWorld` and `restrictMachine` give the restriction. Two targets wait as skipped tests: an evaluator that is a document (K40), and the merge of two machines from `formulaMachine` (K41).
7. K42: the mark of a pure call on each call at the top of a module, a request of a language (done, 2026-10-24, version 0.6.2, PKG.PURE). Before, esbuild kept the standard evaluators and walkers in each bundle.
8. K22: `sameResult`, a safe equality for an early cutoff (R4 P1) (done, 2026-10-24, released in 0.6.3, D20, RESULT.SAME). Plain JSON compares by structure, and each other object only as itself. Two errors need the same code, reason and place. `docEquals`, `sameValue` and `sameResult` share one walk.
9. K39: a host thing can tell that a field holds `undefined`, a small correction that K20 found (done, 2026-10-24, released in 0.6.3, D21, DEREF.HOST-UNDEFINED). Its optional `has` answers when `deref` gives `undefined`. Before, a host that adopted the names hid each name bound to `undefined`. A node of the standard tree hid such an attribute too.
10. K10 and K11: a synchronous mock `perform` for `evaluate` (R2 P1), and effect outcomes with record and replay (R2 P2) (done, 2026-10-24, released in 0.6.3, D19). An evaluation, a plan, the reference and `agree` take a mock `perform`. Each effect keeps a stable address and its outcome. `recorder` and `replayer` give record and replay, and a request that the log does not have gives `#REPLAY!`.
11. K23: value types and value domains, the base of the type work (R5 P2): done (2026-10-24, D22), released in the next batch. A value type is a JSON term, and `fits` decides each check. A language adds its base types as domains of its machine, and the domains merge name by name. The type work K24 to K31 builds on it.
12. K33: each verb through the kernel (R6 P3). `prepare` and `check` take a verb, and one ladder serves each verb. A verb `format` is the demonstration. Today only `eval` gets plans and checks.
13. K12: compiled paths (R1 P2).

On the site, C10 is done (2026-10-24, R4). Each other proposal of the six studies is a row with the status `later`.

## The design and the site

| ID | Item | Status | Depends on |
| --- | --- | --- | --- |
| C1 | The repository, the model package and the site with a live diagram for each idea | in progress | |
| C2 | The site on GitHub Pages, and CI on each push | done (2026-10-20) | C1 |
| C3 | A diagram of the four schedules: pull, push, demand and once, with the same values | done (2026-10-20) | C1 |
| C4 | A diagram of one path grammar for names, positions and order | done (2026-10-20) | C1 |
| C5 | The decisions of the owner on the questions Q1 to Q4 (D5, D6, D9, D10) | done (2026-10-20) | |
| C6 | The visual grammar: one glyph for each concept, the views by the ladder, the glyph key, and the explorer of an evaluation | done (2026-10-20) | C1 |
| C7 | The guide: one page for each glyph, from documents to effects | done (2026-10-20) | C6 |
| C8 | The playground: build a document from the kinds, and open each picture of the guide in it | done (2026-10-20) | C6 |
| C9 | Reference arrows on each picture (done), and arrows for each move of a path on each picture | in progress | C6 |
| C10 | The schedule diagram (C3) computes its dependencies with the kernel (`refsOf`), as the site rule says (R4) | done (2026-10-24) | C3 |
| C11 | A structured editor in the playground from the kind contracts. An empty position holds a document of a kind `hole`, thus each state of an edit evaluates (R6 P6). | later | C8 |
| C12 | A live diagram of record and replay: a run records its effects, and a replay steps through the journal. A changed answer shows `#REPLAY!` at its address. From K11. | later | C1 |
| C13 | The site shows the work of the research: a page and a live diagram for the merge of languages (D17, D18), a live diagram of the decorated tree (D16), a page for the studies, and the guide as a route on the home page | done (2026-10-24) | C7 |

## The kernel

| ID | Item | Status | Depends on |
| --- | --- | --- | --- |
| K1 | The specification of the model, with one requirement ID for each rule and one test for each ID | done (2026-10-21, `docs/SPEC.md`, more than 100 IDs) | C5 |
| K2 | The contract of a kind: the roles of its fields (code or data), its types, its context and its effects | done (2026-10-21: the shape of the parts, the scope rules and the effects) | K1 |
| K3 | A check of a whole document before it runs, from the contracts | done (2026-10-21, `check`) | K2 |
| K4 | References: paths from five roots, the verb `deref`, collapse, computed steps, and types as paths (D10) | done (2026-10-20) | |
| K5 | The result model: a value, or an error value with a code, a reason and a place | done (2026-10-21: the place and the cause) | K1 |
| K6 | The explain trace of a question and of an evaluation | in progress (the trace is an optional pass over a plan, the explorer draws it) | K5 |
| K7 | Sealed parts: the kernel gives an evaluator handles without the value of a part | done (2026-10-20) | |
| K8 | check narrows the capabilities as the kinds do (a bug from the study R2) | done (2026-10-24) | K3 |
| K9 | A harness for one meaning: a reference interpreter that compiles nothing, documents that a generator makes from the kind contracts, and an exported `agree` (R1 P1, D15) | done (2026-10-24, version 0.4.2 with the corrections of four bugs that the harness found) | K2, K3 |
| K10 | A synchronous mock `perform` for `evaluate`. Its answer becomes the result of the effect, and a promise from it gives `#CALC!` (R2 P1). | done (2026-10-24, released in 0.6.3, D19: the option `perform` of `evaluate`, `plan.evaluate`, `reference` and `agree`) | L1 |
| K11 | Effect outcomes with stable addresses, and the helpers `recorder` and `replayer` for record and replay (R2 P2) | done (2026-10-24, released in 0.6.3, D19: `Effect.address`, `Effect.outcome`, `#REPLAY!` and the journal of the waits of `all`) | L1 |
| K12 | Compiled paths: `compilePath` resolves one static path, and `derefStep` keeps a memo of `lookupKind` (R1 P2) | next | K4, K9 |
| K13 | Folds of closed pure subtrees: a static subtree evaluates one time at compile time, from a `pure` mark in the kind contract (R1 P3) | later (R1 first asks if a plan can share its results) | K9 |
| K14 | Binding times that the host declares: a path from a root that does not change resolves at compile time (R1 P4) | later | K9, S1 |
| K15 | A tier of generated JavaScript for hot pure regions (R1 P5) | later (only behind a CI benchmark) | K9, K13 |
| K16 | Nodes that specialize themselves: a compiled node keeps a small state, and this state gives profile data to K15 (R1 P6) | later | K9 |
| K17 | One plan at many positions with `plan.evaluateEach(contexts)` (R1 P7) | later (only after a language asks for it) | K9 |
| K18 | The rest of R2 P3: the rule `grant` for a handler, `effectsOf` for the effects that reach the host, the latent effects of procedure entries, and a check that uses the hook `permits` of the machine. K8 shipped the rules `same`, `mask` and `only` (`Kind.caps`, D14). | later | K8 |
| K19 | A static check of the "can wait" bit: `check` reports a runner under a parent without a runner (R2 P4) | later | K3 |
| K20 | `check` knows the names of operations and extensions through a hook, and `fn` declares the shape of `params` (R5 P1) | done (2026-10-24, version 0.4.3: the hook `known` of the machine, and `partsOf`) | K3 |
| K21 | `docEquals` compares the values that are not plain JSON by identity, thus two different dates or maps are not equal (R4) | done (2026-10-24, version 0.4.3) | K3 |
| K22 | `sameResult`, a safe equality for an early cutoff: host values compare by `Object.is`, and errors by code, reason and place (R4 P1) | done (2026-10-24, released in 0.6.3: `sameResult`, and one walk for `docEquals`, `sameValue` and `sameResult`, D20) | K5, K21 |
| K23 | Value types and value domains: a new `types.ts` with open base types, the relation `fits`, and a membership test for each domain (R5 P2) | done (2026-10-24, D22), released in the next batch: `ValueType`, `Domain`, `fits`, `member`, `typeIssues`, `STD_DOMAINS` and `Machine.domains` | K2, K3 |
| K24 | Signatures of operations in the profile, and a bidirectional `check` that synthesizes or checks the type of each part (R5 P3) | later | K23 |
| K25 | Types of the roots, of the names and of the paths, from the host, from a JSON Schema or from sample values (R5 P4) | later | K24 |
| K26 | The agreement rule for types: in a traced evaluation of a document that checks, each value is in the type of its place (R5 P5) | later | K9, K24 |
| K27 | Narrowing in `if`, `and` and `or`: a test with `proves` narrows the type of a path in its branch (R5 P6) | later | K25 |
| K28 | Casts at the boundaries of `unknown`: with the option `guards`, `prepare` adds a membership test that gives `#VALUE!` at the boundary (R5 P7) | later | K25 |
| K29 | Types of the run side: a procedure gets an input type, an output type and its effects, and `seq` gives each step its type (R5 P8) | later | K25, L1 |
| K30 | Generic signatures with type variables, thus `check` finds the parameter types of a function argument, as for `map` (R5 P9) | later | K24 |
| K31 | Intervals of numbers that widen in a cycle, and type rules as documents that the tree kit evaluates (R5 P10) | later (low value today) | K24, L2a |
| K32 | One merge function for worlds and machines, with conflict rules. Equal entries merge, namespaces merge key by key, and each other conflict is an error without a mark `replaces` (R6 P2). | done (2026-10-24, version 0.6.0, D17: `mergeWorlds`, `mergeMachines` and `MergeError`) | K2 |
| K33 | Each verb through the kernel: `prepare` and `check` take a verb, one ladder serves each verb, and a verb `format` is the demonstration (R6 P3) | next | K32 |
| K34 | The composition checklist as spec tests: one test `COMPOSE.*` for each mode of composition, with small languages (R6 P1) | done (2026-10-24, version 0.6.1: `restrictWorld`, `restrictMachine`, D18 and `docs/COMPOSITION.md`) | K32 |
| K35 | Verb entries for the kinds of another language: a language adds a verb that it owns to a foreign kind, through the merge of K32 (R6 P4) | later | K32, K33 |
| K36 | A check of verb coverage: `checkWorld` lists each kind with no entry and no default for a verb that the language declares (R6 P5) | later | K33 |
| K37 | A language package format: `defineLanguage` gives one value with a name, a version and a hash, and `compose` merges languages through K32 (R6 P7) | later | K32 |
| K38 | A boundary kind `lang` for a part in another language, as the module boundary of Racket (R6 P8) | later (low value today, and a decision of the owner first) | K37 |
| K39 | A host thing can say that a field holds `undefined`. Today `deref` uses `undefined` for a missing field, so a host that adopts the names root hides a name bound to `undefined`. Found by K20. | done (2026-10-24, released in 0.6.3: the optional `has` of a host thing, also on the nodes of the standard tree, D21) | K4 |
| K40 | An evaluator that is a formula document (D1). A language is then data only: its kinds are JSON, and its evaluators are documents. From K34 (COMPOSE.SELF-EXTEND). | later (the open question 6 of R6 first) | K34 |
| K41 | Two languages that each build the formula kit with one profile merge. Today each `formulaMachine` call makes new evaluators, thus each evaluator name of the kit is a conflict. From K34 (COMPOSE.UNIFY). | later | K34 |
| K42 | Each call at the top of a module has the mark `/* @__PURE__ */`, and a test bundles an import with esbuild (PKG.PURE). A request of a language. | done (2026-10-24, version 0.6.2) | none |
| K43 | The `deref` code of a kind and the `deref` of a walker can give a field that holds `undefined`. Today they use `undefined` for a missing field. From K39. | later | K39 |
| K44 | A replay log is JSON, so a test can keep it as a golden file. Today the causes of errors and the host values are not JSON. From K11. | later | K11 |
| K45 | A replayer serves more than one run, and a recorder keeps the order of the waits of an inner replayer. From K11. | later | K11 |
| K46 | The reference interpreter covers runs, so `agree` also checks the order of the waits of a replay. Today only the plan has a test for it. From K11. | later | K11 |
| K47 | The address of an effect stays the same after an edit of the document, as the open question 5 of R2 asks. From K11. | later | K11 |

## The kits

| ID | Item | Status | Depends on |
| --- | --- | --- | --- |
| L1 | The sequence kit: steps with names for the results of earlier steps, capabilities, and the order of effects | done (2026-10-21: parts at the same time, the error of the host, capabilities that only narrow, an abort) | K2 |
| L1a | A handler kind `handle` with clauses that run in place, so that mocks, retries and logs are documents (R2 P5, and R2 drafts its decision) | later | K10, K18 |
| L1b | Multi-shot by evaluation again: a kind `choose` evaluates its sealed body again for each branch, with a replay log (R2 P7) | later | K11, L1a |
| L2 | The tree kit: data down, sizes up and references sideways, by attribute equations | later (L2a is done, and L2b to L2i come from R3) | K2, K4 |
| L2a | The decorated tree: demand evaluation with one memo for each node and attribute, `#CYCLE!` with its chain, and errors that stay errors. It fixes three bugs that R3 found in the standard `tree.node` (R3 P1). | done (2026-10-24, version 0.5.0, D16) | K2, K4 |
| L2b | Equations in kind contracts, with a ladder for attributes: the own field, the kind, the parent, a copy, then a default (R3 P2) | later | L2a |
| L2c | Memo cells from the host: a host with signals keeps the cell of each attribute between evaluations (R3 P3) | later | L2a |
| L2d | Static checks of attributes: unknown names, names outside `down`, reserved names and completeness (R3 P4) | later | L2b |
| L2e | The graph of attribute instances: `check` finds each cycle before a run, and the schedule layer gets its first concrete graph (R3 P5) | later | L2b |
| L2f | Circular attributes: a cycle evaluates again until no value changes, or it gives `#CYCLE!` at a limit (R3 P6) | later | L2a |
| L2g | Collection attributes and a registry of binding names, so that `tree.named` finds each node of a subtree (R3 P7) | later | L2b |
| L2h | Attributes with parameters, for example the height of a node at a given width (R3 P8) | later | L2a |
| L2i | Higher-order attributes and forwarding: an equation gives a document, and the kit puts it under the node (R3 P9) | later | L2b |
| L3 | The reaction kit: an event starts a run, and a change of data does not repeat a run | later | L1 |
| L4 | The formula kit: the shared constructs and the operations of a language, through a profile (D13) | done (2026-10-21) | K2 |
| L5 | The storage adapter: one query language for the world, with an adapter for each store | later | K2 |

## The schedule layer

| ID | Item | Status | Depends on |
| --- | --- | --- | --- |
| S1 | The interface of a schedule: the graph of the data and the side of each kind | later (S1a and S1b first, from R4) | K2 |
| S1a | `factsOf` gives the static facts of a document: its reads with marks for lazy parts, its side, its effects, and the marks `pure` and `volatile` (R4 P2) | later | K2, K3 |
| S1b | A list of reads for each evaluation, and `verifyReads`, which keeps an old result when each read gives the same thing again (R4 P3) | later | K4 |
| S1c | Two levels of durability: a host keeps one epoch for the structure and one for the data, thus a change of data compiles nothing (R4 P7) | later | S1a |
| S2 | The static analysis: cycles, an order for a push schedule, and the independent groups, with a new `graph.ts` (R4 P5) | later | S1a |
| S3 | Adapters to the reactive engines of the hosts | later (S3a and S3b first, from R4) | S1 |
| S3a | A harness for one meaning across schedules: a model-based test, and `agreeSchedule(engine)` for the engine of each host (R4 P4) | later | K9, K22, S1b |
| S3b | A reference adapter for signals in the tests, with `sameResult` as its `equals` (R4 P6) | later | K22 |
| S3c | Derivatives of aggregates: an operation of a profile gives a derivative, thus an aggregate updates in a time that the size of the change sets (R4 P8) | later (only after a language over positions asks for it) | S3, L4 |
| S4 | Equations for effect kinds: a contract declares which operations commute, so that a schedule can change the order of their steps (R2 P6) | later | S1 |

## The migration of the languages

Since 2026-10-24, the work of each language on its integration happens in the repository of that language. This repository adds to the kernel what a language needs, with a requirement ID and a test for each rule.

| ID | Item | Status | Depends on |
| --- | --- | --- | --- |
| M1 | A language that uses coeval gets the package from npm, or from a pinned reference to this repository | done (2026-10-20, a pinned reference, and npm after M9) | K4 |
| M2 | Formulas: each reference of a formula is a path document. The old text forms convert to paths. | done (2026-10-20) | M1 |
| M3 | Events: each handler is a run document of the one run language (D9) | done (2026-10-20) | M1 |
| M4 | Types: the layout rules and the kinds are paths into a world, with namespaces and aliases | in progress (the layout rules are done, the kinds come with M6) | M1 |
| M5 | Overrides: each override names its target with a path, not with a dotted text | done (2026-10-20) | M2 |
| M6 | Trees: each node of a tree of components is an envelope | done (2026-10-20) | M4, M5 |
| M7 | The program format of procedures: a call is an envelope, and a reference is a path (D9, D10) | done (2026-10-21) | K4 |
| M8 | An adapter for the addresses of a formula language: its moves become paths | done (2026-10-21, the rules are D12) | K4 |
| M10 | The reactive formula language reads and writes documents (D12) | done (2026-10-21) | D12 |
| M11 | The formula language of positions reads and writes documents (D12) | done (2026-10-21) | D12 |
| M9 | The first npm release of `@mark1russell7/coeval` | done (2026-10-21, version 0.1.0) | |
| M12 | Version 0.2.0 on npm: the kernel that the languages evaluate through (D13) | done (2026-10-21, and the versions 0.2.1 to 0.4.0 added what the languages needed) | K2, K3, L1, L4 |
| M13 | The reactive formula language evaluates through the formula kit, and its analysis uses the static kit | done (2026-10-24: render evaluates through the kernel, its PR #13) | M12 |
| M14 | The program format of procedures runs on `run`, and its checker uses the static kit | in progress, in the repository of the language (a pull request is open) | M12 |
| M15 | The formula language of positions reads documents with the static kit, and the kernel is its reference interpreter | in progress, in the repository of the language (the kernel side is done in 0.4.0) | M12 |
| M16 | The defs of a user interface: bindings through the formula kit, one world for paths and runs, and checks from the static kit | in progress, in the repository of the host | M12 |

## The research

Each study answers one research question and ranks its proposals. The folder `docs/research/` keeps the studies, and its [README](research/README.md) lists them.

| ID | Study | Status | Roadmap rows |
| --- | --- | --- | --- |
| R1 | [Staging and partial evaluation](research/r1-staging.md) | done (2026-10-24) | K9, K12 to K17 |
| R2 | [Algebraic effects, handlers and the run side](research/r2-effects.md) | done (2026-10-24) | K10, K11, K18, K19, L1a, L1b, S4 |
| R3 | [Attribute grammars and the tree kit](research/r3-attribute-grammars.md) | done (2026-10-24) | L2a to L2i |
| R4 | [Incremental computation and schedules](research/r4-incremental.md) | done (2026-10-24) | K21, K22, S1a to S1c, S2, S3a to S3c, C10. R4 does not propose P9, a memo for each node of a plan: it breaks PLAN.LEAN, and D3 puts that work in the schedule. |
| R5 | [Types and abstract interpretation for `check`](research/r5-types.md) | done (2026-10-24) | K20, K23 to K31 |
| R6 | [Language workbenches and extensibility](research/r6-workbenches.md) | done (2026-10-24) | K32 to K38, C11. K34 adds K40 and K41. |

