# Decisions

This file records each decision of the design of coeval, and each open question. The newest entry is last.

## D1 (2026-10-20): an evaluator is a document, in the language that fits its side

**Context.** One proposal was to write each evaluator as a program of one formula language.

**Decision.** An evaluator is a document. A pure evaluator can be a formula. An evaluator of effects is a sequence of calls. An evaluator that builds a tree is a tree template. Code evaluators stay as the base cases.

**Why.** A formula language is pure and total. It cannot express effects, and it cannot express the dispatch itself without losing totality.

## D2 (2026-10-20): dispatch uses names only

**Context.** A ladder can find a kind by its name (a tag) or by the shape of the data (the fields that it has).

**Decision.** The ladder uses names only. The kind comes from the key `$kind` of the document, or else from the kind that its container declares for its items. A classifier can propose a kind from the shape when data comes in, and then it writes the tag. The ladder does not call a classifier at any time.

**Why.** Two documents with the same shape can need different evaluators. A width and a height can be a picture, a box or a limit. A name is explicit, and a wrong name is an error that a person can see.

## D3 (2026-10-20): a schedule is a separate layer

**Decision.** coeval defines what a value is. A schedule decides when to compute it. coeval gives each schedule two things. The first is the graph of the data, from the contracts of the kinds. The second is the side of each kind. The reactive engines stay in their own projects and connect through adapters.

**Why.** For pure work, each schedule gives the same values. Thus each host can choose its own schedule.

## D4 (2026-10-20): a public repository

**Decision.** The repository is public. CI and the site run on GitHub Actions and GitHub Pages.

## Open questions

| ID | Question | The current proposal |
| --- | --- | --- |
| Q1 | Does each language live in this repository, or in its own repository? | The kernel and small reference languages live here, one package each. A full language stays in its own repository and uses the kernel. |
| Q2 | Is the run side one language for all hosts? | Yes: sequences of calls, with names for the results of earlier steps. |
| Q3 | Which key holds the kind? | `$kind`. A field `kind` stays ordinary data. |
| Q4 | Does one path grammar cover names, positions and order? | Yes: a path is a list of moves from the place of the reference. |
