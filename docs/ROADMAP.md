# Roadmap

This file is the one list of the work of coeval. Each item has an ID and a status. The tracker page mirrors this file.

The statuses are: `done`, `in progress`, `next`, `waiting` (on a decision of the owner), and `later`.

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

## The kits

| ID | Item | Status | Depends on |
| --- | --- | --- | --- |
| L1 | The sequence kit: steps with names for the results of earlier steps, capabilities, and the order of effects | done (2026-10-21: parts at the same time, the error of the host, capabilities that only narrow, an abort) | K2 |
| L2 | The tree kit: data down, sizes up and references sideways, by attribute equations | later | K2, K4 |
| L3 | The reaction kit: an event starts a run, and a change of data does not repeat a run | later | L1 |
| L4 | The formula kit: the shared constructs and the operations of a language, through a profile (D13) | done (2026-10-21) | K2 |
| L5 | The storage adapter: one query language for the world, with an adapter for each store | later | K2 |

## The schedule layer

| ID | Item | Status | Depends on |
| --- | --- | --- | --- |
| S1 | The interface of a schedule: the graph of the data and the side of each kind | later | K2 |
| S2 | The static analysis: cycles, an order for a push schedule, and the independent groups | later | S1 |
| S3 | Adapters to the reactive engines of the hosts | later | S1 |

## The migration of the languages

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
| M12 | Version 0.2.0 on npm: the kernel that the languages evaluate through (D13) | in progress | K2, K3, L1, L4 |
| M13 | The reactive formula language evaluates through the formula kit, and its analysis uses the static kit | next | M12 |
| M14 | The program format of procedures runs on `run`, and its checker uses the static kit | next | M12 |
| M15 | The formula language of positions reads documents with the static kit, and the kernel is its reference interpreter | next | M12 |
| M16 | The defs of a user interface: bindings through the formula kit, one world for paths and runs, and checks from the static kit | next | M12 |

