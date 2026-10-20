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
| C5 | The decisions Q2 and Q4 of `DECISIONS.md` (Q1 and Q3 are decided: D5 and D6) | waiting | |
| C6 | The visual grammar: one glyph for each concept, the views by the ladder, the glyph key, and the explorer of an evaluation | done (2026-10-20) | C1 |
| C7 | The guide: one page for each glyph, from documents to effects | done (2026-10-20) | C6 |
| C8 | The playground: build a document from the kinds, and open each picture of the guide in it | done (2026-10-20) | C6 |
| C9 | Reference arrows on each picture (done), and arrows for each move of a path on each picture | in progress | C6 |

## The kernel

| ID | Item | Status | Depends on |
| --- | --- | --- | --- |
| K1 | The specification of the model, with one requirement ID for each rule and one test for each ID | next | C5 |
| K2 | The contract of a kind: the roles of its fields (code or data), its types, its context and its effects | later | K1 |
| K3 | A check of a whole document before it runs, from the contracts | later | K2 |
| K4 | The path grammar: a list of moves from the place of the reference | later | K1, C4 |
| K5 | The result model: a value, or an error value with a code, a reason and a place | in progress (codes and reasons done, the place is next) | K1 |
| K6 | The explain trace of a question and of an evaluation | in progress (the trace exists, the explorer draws it) | K5 |
| K7 | Sealed parts: the kernel gives an evaluator handles without the value of a part | done (2026-10-20) | |

## The kits

| ID | Item | Status | Depends on |
| --- | --- | --- | --- |
| L1 | The sequence kit: steps with names for the results of earlier steps, capabilities, and the order of effects | later | K2 |
| L2 | The tree kit: data down, sizes up and references sideways, by attribute equations | later | K2, K4 |
| L3 | The reaction kit: an event starts a run, and a change of data does not repeat a run | later | L1 |
| L4 | The formula adapter: a formula language as the evaluator of the pure kinds | later | K2 |
| L5 | The storage adapter: one query language for the world, with an adapter for each store | later | K2 |

## The schedule layer

| ID | Item | Status | Depends on |
| --- | --- | --- | --- |
| S1 | The interface of a schedule: the graph of the data and the side of each kind | later | K2 |
| S2 | The static analysis: cycles, an order for a push schedule, and the independent groups | later | S1 |
| S3 | Adapters to the reactive engines of the hosts | later | S1 |
