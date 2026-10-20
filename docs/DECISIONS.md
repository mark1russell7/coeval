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

## D5 (2026-10-20): public languages can live here for tests

**Decision.** A public language can live in this repository as a test language of the kernel. A full language can also stay in its own repository and use the kernel.

## D6 (2026-10-20): a document is a value in an envelope

**Context.** A value can get a type in four common ways. The tag can be a reserved key, an envelope or the only key. Or the value has no tag. The site compares them on the page `learn/documents`.

**Decision.** A document is an envelope: `{ type, value }`. The header can also have `name` (a binding) and `own` (own entries). A position that declares its type can hold a bare value.

**Why.** Only the envelope does four things. It can tag any value, and it keeps the value. It has room for a header, and it gives the type without a guess. A reserved key collides with data that has the same key, and a header needs more reserved keys.

## D7 (2026-10-20): an evaluator gets its parts sealed

**Decision.** A part is a handle with a key, a name and a function that evaluates it. It has no field with its value. Thus the kernel enforces the rule that an evaluator does not look inside its parts.

## D8 (2026-10-20): the site draws each document with its view

**Decision.** Each picture of the site is a document. The verb `view` goes up the ladder, and the view that answers draws the card. A view draws the parts of its document with the same component. Thus the pictures compose as the documents compose.

## D9 (2026-10-20): one language for the run side

**Decision.** Each effect of each host is a document of the same form. A call is an envelope: its type is the path of a procedure in the world, and its value is the input. A sequence orders the steps, a name keeps a result, and a reference reads it. Capabilities limit the effects.

**Why.** Two forms for the same idea gave two checkers and two permission systems. In one of them, a step could not read the result of the step before.

## D10 (2026-10-20): a reference is a path from a root of the context

**Decision.**

- A reference is a document `{ "type": "ref", "value": [root, step, ...] }`. The root is `self`, `names`, `world`, `event` or `caps`. A stored reference always names its root.
- The context is a record with these five roots. The evaluators differ only in how they change the context for their parts.
- Each step is a question to the thing that the path reached: the verb `deref` goes up the ladder. A host thing answers itself (own), a kind can answer, and the default goes into a field or an item.
- A node of a tree has the fields `parent` and `children`. Thus up and down are field steps.
- A computed step, for example `nearest`, is a document of a kind with the verb `step`. It is not special.
- After each hop, a reference is followed until the path reaches something else (collapse). A cycle gives `#CYCLE!`.
- The type of a document is a reference into the world. A text or a list of keys is a base reference that the kernel resolves itself, thus the chain of types stops. A namespace groups kinds, and an alias is a reference to a kind.

**Why.** Several syntaxes of text pointed at things in different ways. A path of plain keys, with the meaning of each step asked of the thing that the path reached, is one declarative form. The same mechanism names types, parts, fields, earlier results and the registry. The reach of a term is what its context and its world can name.

A language on top of coeval can accept a shorter form and change it into a path. The stored form is always the full path.

No question waits on the owner.
