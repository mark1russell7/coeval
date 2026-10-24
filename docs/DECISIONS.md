# Decisions

This file records each decision of the design of coeval, and each open question. The newest entry is last.

## D1 (2026-10-20): an evaluator is a document, in the language that fits its side

**Context.** One proposal was to write each evaluator as a program of one formula language.

**Decision.** An evaluator is a document. A pure evaluator can be a formula. An evaluator of effects is a sequence of calls. An evaluator that builds a tree is a tree template. Code evaluators stay as the base cases.

**Why.** A formula language is pure and total. It cannot express effects, and it cannot express the dispatch itself without losing totality.

## D2 (2026-10-20): dispatch uses names only

**Context.** A ladder can find a kind by its name (a tag) or by the shape of the data (the fields that it has).

**Decision.** The ladder uses names only. The kind comes from the type of the document (the envelope of D6), or else from the kind that its container declares for its items. A classifier can propose a kind from the shape when data comes in, and then it writes the tag. The ladder does not call a classifier at any time.

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

## D11 (2026-10-20): a run waits for its effects, with the same code as an evaluation

**Context.** A step of a run can read the result of the step before (D9). The host does an effect, and it can take time, for example a request to a server. An evaluation does not wait.

**Decision.**

- `run` evaluates a document and gives each effect to the host (`perform`). It waits when the host waits. `evaluate` records each effect and does none.
- A kind whose parts or effects can wait has a runner: a generator function. It takes the result of a part or of an effect with `yield*`. The same runner serves `evaluate` and `run`.
- A run goes on at once until an effect waits. Thus an effect that must happen during the event, for example to stop the event, happens in time.
- In a run, a part that can wait must have a parent that can wait. Otherwise the part fails with `#CALC!` before it starts.
- A capability permits the kind of its name and each kind in its namespace: `store` permits `store.update`.

**Why.** One evaluator for a dry run and for a real run keeps one meaning. With an asynchronous function, each wait defers the rest of the run, also when nothing waits. A generator waits only when the host waits.

## D12 (2026-10-21): each language reads and writes coeval documents, and keeps its evaluator

**Context.** Several languages use coeval. They include a formula language over the positions of a space and a reactive formula language over a store of named nodes. A program format for procedures and the defs of a user interface use it too. Each language has its own evaluator, for example a compiler with typed domains. Each one also had its own form for its terms: a tag field, or a key that starts with `$`.

**Decision.**

- The interchange form of each language is coeval documents. A language gives two functions: `fromDocument` reads a document into its own form, and `toDocument` writes its own form as a document. `fromDocument(toDocument(x))` gives `x` again.
- Each language keeps its own evaluator. The documents are what the languages share, not the code that evaluates them.
- A formula language follows these rules, so the same idea has the same document in each language:
  - In a position that holds terms, an envelope is a term, and another JSON value is a literal. A literal that has the shape of an envelope is `{ "type": "lit", "value": x }`.
  - An application of an operation is `{ "type": ["ops", ...keys], "value": [arguments] }`. The keys are the name of the operation, split at its dots.
  - A reference is a path document (D10). `names` holds the names that an enclosing term binds, for example a parameter of a lambda or a name of a `let`. `self` is the position or the node where the formula evaluates. `world` holds the other things that the host finds by name, for example a node of a store.
  - A field of a record is a key step. A move to another position is a step document `{ "type": ["moves", kind], "value": ... }`, because a record can have a field with the name of a move.
  - A construct is `{ "type": name, "value": { fields } }`. The shared constructs are `record` (its value holds the fields), `let` (`bind`, `body`), `fn` (`params`, `body`) and `call` (`fn`, `args`).
  - An axis of a formula language is `{ "type": ["axes", name], "value": { parameters } }`. An extension is `{ "type": ["ext", ...keys], "value": data }`.

**Why.** One document model lets a tool read, check, show and change the terms of each language with one set of code. Each evaluator stays fast and specific to its domain. The rules make a record, a lambda and a reference look the same in each language.

## D13 (2026-10-21): the languages evaluate through the kernel

**Context.** D12 shared only the documents. Each language kept its own reader, evaluator, scope walker, reference walker, checker and error values. The same machinery thus had four copies and four sets of tests. The owner wants one copy, with one set of tests.

**Decision.**

- The kernel holds the machinery that each language needs. A language keeps only what is its own: its text syntax, its operations, its value domains, its spaces and its schedule.
- `prepare` compiles a document into a plan one time. The ladder, the kinds and the parts are known after that. A plan evaluates many times, with no trace. A trace is an optional pass over the same plan.
- A value can be any value of the host. A document is JSON, and a result is not always JSON.
- The contract of a kind tells the shape of its parts and the names that it binds (K2). A part can be at any depth of the value.
- The static kit reads the contracts: it walks a document, finds its free references, changes them, and checks a document before it runs (K3). Each issue has a place (K5).
- The formula kit (L4) evaluates the shared constructs: `lit`, `ref`, `record`, `list`, `let`, `fn`, `call`, `if`, `and` and `or`. It applies the operations of the namespace `ops` from a table that the language gives. A small profile gives the rules that differ between languages, for example the truthiness of a value.
- The run side drives parts at the same time and keeps the error of the host. It narrows the capabilities of a part, and it stops when the host aborts.
- A language can keep a second tier, for example a compiler to loops. That tier reads documents, and the plan of the kernel is its reference.
- The document form of D12 stays. This decision replaces only its clause "each language keeps its own evaluator".

**Why.** One copy of each rule gives one meaning, and one set of tests proves it. A correction in the kernel corrects each language.

## D14 (2026-10-24): the contract of a kind narrows the capabilities of its parts, and the kernel applies it

**Context.** The study R2 (`docs/research/r2-effects.md`) found a bug. The runner of `pure` gave its part no capabilities, but `check` used the capabilities of the root at each document. Thus a call inside `pure` passed `check` and failed with `#CAP!` in a run. This broke STATIC.AGREES.

**Decision.**

- The contract of a kind has capability rules (`Kind.caps`), as it has scope rules for names. A rule is `same` (the default), `mask` (no capabilities) or `only` (a list).
- A rule covers the parts that its patterns `in` match, or each part. A part that several rules cover gets only what each rule permits.
- The kernel narrows the context of each part by the rules, before the evaluator of the part starts. Thus the contract is the one source, and an evaluator does not narrow the capabilities itself.
- `walk` and `check` narrow the capabilities with the same function (`partCaps`). Thus a run and a check agree.
- The rules only narrow (CAP.NARROW). The rule `grant` of the proposal P3, for a handler, comes later with P5.

**Why.** Two places that narrow the capabilities can disagree. One declaration in the contract, which the kernel and the static kit both read, keeps one meaning. A kind that narrows the capabilities outside its contract can break STATIC.AGREES again, thus the kernel does it for each kind.
