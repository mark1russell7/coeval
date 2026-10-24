# Roadmap

This file is the one list of the work of coeval. Each item has an ID and a status. The tracker page mirrors this file.

The statuses are: `done`, `in progress`, `next`, `waiting` (on a decision of the owner), and `later`.

The studies in `docs/research/` rank proposals for the kernel and the kits. Each proposal that the plan takes up is a row here. The row gives its study and its number, for example (R3 P5).

## The order of the next work

The plan does the next work in this order (2026-10-24). It takes up the studies R1, R2 and R3.

1. K8: `check` narrows the capabilities of the parts as the kinds do.
2. K9: a harness for one meaning (R1 P1).
3. L2a: the decorated tree (R3 P1).
4. K10 and K11: a synchronous mock `perform` for `evaluate` (R2 P1), and effect outcomes with record and replay (R2 P2).
5. K12: compiled paths (R1 P2).

Each other proposal of the three studies is a row with the status `later`.

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
| K8 | `check` narrows the capabilities of the parts as the kinds do in a run | in progress (a pull request lands it) | K3, L1 |
| K9 | A harness for one meaning: a reference definitional interpreter for the tests, documents that a generator makes from the kind contracts, and an exported `agree` (R1 P1) | next | K2, K3 |
| K10 | A synchronous mock `perform` for `evaluate`. Its answer becomes the result of the effect, and a promise from it gives `#CALC!` (R2 P1). | next | L1 |
| K11 | Effect outcomes with stable addresses, and the helpers `recorder` and `replayer` for record and replay (R2 P2) | next | L1 |
| K12 | Compiled paths: `compilePath` resolves one static path, and `derefStep` keeps a memo of `lookupKind` (R1 P2) | next | K4, K9 |
| K13 | Folds of closed pure subtrees: a static subtree evaluates one time at compile time, from a `pure` mark in the kind contract (R1 P3) | later (R1 first asks if a plan can share its results) | K9 |
| K14 | Binding times that the host declares: a path from a root that does not change resolves at compile time (R1 P4) | later | K9, S1 |
| K15 | A tier of generated JavaScript for hot pure regions (R1 P5) | later (only behind a CI benchmark) | K9, K13 |
| K16 | Nodes that specialize themselves: a compiled node keeps a small state, and this state gives profile data to K15 (R1 P6) | later | K9 |
| K17 | One plan at many positions with `plan.evaluateEach(contexts)` (R1 P7) | later (only after a language asks for it) | K9 |
| K18 | Effect rules in kind contracts (`mask`, `grant` and `same`), and `effectsOf` for the effects that reach the host (R2 P3) | later | K8 |
| K19 | A static check of the "can wait" bit: `check` reports a runner under a parent without a runner (R2 P4) | later | K3 |

## The kits

| ID | Item | Status | Depends on |
| --- | --- | --- | --- |
| L1 | The sequence kit: steps with names for the results of earlier steps, capabilities, and the order of effects | done (2026-10-21: parts at the same time, the error of the host, capabilities that only narrow, an abort) | K2 |
| L1a | A handler kind `handle` with clauses that run in place, so that mocks, retries and logs are documents (R2 P5, and R2 drafts its decision) | later | K10, K18 |
| L1b | Multi-shot by evaluation again: a kind `choose` evaluates its sealed body again for each branch, with a replay log (R2 P7) | later | K11, L1a |
| L2 | The tree kit: data down, sizes up and references sideways, by attribute equations | next (L2a first, from R3) | K2, K4 |
| L2a | The decorated tree: demand evaluation with one memo for each node and attribute, `#CYCLE!` with its chain, and errors that stay errors. It fixes three bugs that R3 found in the standard `tree.node` (R3 P1). | next | K2, K4 |
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
| S1 | The interface of a schedule: the graph of the data and the side of each kind | later | K2 |
| S2 | The static analysis: cycles, an order for a push schedule, and the independent groups | later | S1 |
| S3 | Adapters to the reactive engines of the hosts | later | S1 |
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
| M13 | The reactive formula language evaluates through the formula kit, and its analysis uses the static kit | in progress, in the repository of the language | M12 |
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
| R4 | Incremental computation and schedules | in progress | |
| R5 | Types and abstract interpretation for `check` | in progress | |
| R6 | Language workbenches and extensibility | next | |

