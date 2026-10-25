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

## D15 (2026-10-24): a reference interpreter is the oracle of one meaning, and `agree` ships for the languages

**Context.** The traced plan and the plan share each compiler, thus a comparison of the two cannot find a bug in a compiler (R1). D13 lets a language keep a second tier, with the plan as its reference.

**Decision.**

- The kernel has a reference interpreter, `reference`. It reads the rules of `docs/SPEC.md` directly and compiles nothing.
- The reference shares only the definitions of the model with the plan. These are the ladder, the lookup of a kind, the split of the parts and the resolution of a path.
- The formula kit has a second reading of its constructs, `formulaDefinitions`: one function evaluator for each construct.
- `agree` compares a plan with the reference, the traced plan, a second evaluation and the second tier of a language. It gives the first tier that disagrees.
- Two results agree when their values are the same by `sameValue`, or when their errors have the same code and place. The effects must be the same, in the same order.
- Identity is not part of the meaning. An overflow of the stack of the host is the one permitted difference, because the tiers use different numbers of frames.
- `generate` builds random documents from the kind contracts. A property test examines a few thousand documents at each push, and more each night.
- The reference covers evaluations, not runs. A run with a host that waits comes later.

**Why.** Two independent readings of the rules find a bug in either one. At its start, the harness found four bugs of the kernel and one bug of the reference itself (K9).

## D16 (2026-10-24): the standard tree is a decorated tree with lazy attributes

**Context.** The study R3 (`docs/research/r3-attribute-grammars.md`) found three bugs in the standard `tree.node`. A reference to a sibling recursed until the stack of the host overflowed. A cycle ended at the limit of the stack, not at `#CYCLE!`. A failed field read as `#N/A`. The harness K9 found the same bugs.

**Decision.**

- `tree.node` becomes the decorated tree of R3 P1. It keeps its name, thus the kinds `panel` and `box` and the site do not change.
- Each node is a host thing, and each part of a node is an attribute. An attribute evaluates on demand, with one memo cell for each node and attribute.
- The memo cells last one evaluation. A host with signals keeps its cells only through P3 (L2c).
- The structure comes first. A node in an attribute of an open tree gives its thing. The root gives the JSON of the tree.
- A demand that reaches an attribute in evaluation gives `#CYCLE!`. The reason gives the chain of attributes. The place is the reference that closed the cycle.
- A failed attribute throws `Failure` from `deref`, thus a reference to it gives the error of the attribute.
- The kinds `panel` and `box` mask the capabilities of their parts. The order of the demands is not the order of the document, thus an effect there breaks D3.
- A node reserves only the structural steps `parent` and `type`. Steps for `index`, `prev` and `next` wait for the first open question of R3.
- The reference has its own definition of the tree (`STD_DEFINITIONS`), as D15 asks.

**Why.** Demand evaluation with a memo is the reference meaning of attribute grammars (R3). It needs no schedule, as D3 asks. The old name keeps each document of the site and of the hosts. A nested node gives a host thing, and an effect in a tree gives `#CAP!`. Before 1.0, these two changes can break a caller, thus the version is 0.5.0.

## D17 (2026-10-24): one merge of worlds and machines, and a conflict throws one error with each conflict

**Context.** The study R6 (`docs/research/r6-workbenches.md`) found that `formulaMachine` merged with shallow spreads. A later kind replaced an earlier kind without a message. The namespace `ops` of a language replaced the namespace of the kit and its fallback. The fallback of the world of a language did not reach the machine. All evaluator names shared one flat table, and a later name won.

The study asked two open questions. Does a merge find each collision of evaluator names (question 3)? Is a conflict a thrown error or a list of issues (question 5)?

**Decision.**

- `mergeWorlds` and `mergeMachines` are the one merge. `formulaMachine` uses `mergeMachines`, and each other composition of languages uses them too.
- Two entries that are equal by `docEquals` give one entry. Two namespaces merge key by key, at each depth. Their fallbacks merge as each other entry.
- The tables of the code merge name by name: evaluators, runners, derefs and walkers. A function is equal only to itself. Thus the merge finds each collision of evaluator names, and a language does not qualify its names.
- A runner hides the evaluator of its name. Thus a name with both needs one part that gives both.
- The hooks `known` compose in the order of the parts. Each other field of a machine is one value.
- Each other pair at one path is a conflict, unless the later part names the path in `replaces`. Then the later entry wins, with no merge below it. The path of a conflict is the path that `replaces` names.
- A part can be a function of the merge before it (`prev`, as an overlay of Nix). Thus a part can read or wrap the entry that it replaces.
- A conflict throws. The merge examines each part first, then it throws one `MergeError`. The error lists each conflict with its path, its two parts and a reason.

**Why.** A conflict is an error of the host that builds the machine, not of a document. A machine with a conflict has two meanings for one name, thus no part of the result is safe to use. `check` gives a list of issues because a document with problems still evaluates to error values. A merge has no such result.

One error with the full list shows each conflict at one time, as `check` does. A tool that wants the list catches the error and reads `conflicts`. The mark `replaces` is a list of paths, not a field of an entry. Thus it can name an evaluator, a default or a field of the machine, and the entries stay unchanged. Before 1.0, a merge that throws where a spread replaced can break a caller, thus the version is 0.6.0.

## D18 (2026-10-24): a restriction removes entries by path, and it removes their code too

**Context.** The composition checklist (K34, R6 P1) has the mode "restriction": a language that removes constructs of its base. The merge of D17 only adds or replaces entries. It cannot remove an entry.

**Decision.**

- `restrictWorld` and `restrictMachine` remove entries. A path names an entry as `replaces` names it.
- A path that names no entry changes nothing, as an unused mark `replaces` does.
- A path to the evaluator or to the runner of a name removes both, because they are the code of the name (MACHINE.RUNNER).
- A restriction is a separate step, not a mark of a part of a merge.

**Why.** An own entry names an evaluator directly (LADDER.OWN). Thus a world without the kind `call` still evaluates a document whose own entry names `formula.call`. A safe restriction removes the code too. A removal depends on the order of the parts, thus a mark in a merge breaks the laws of the merge (WORLD.LAWS). A separate function keeps them.

## D19 (2026-10-24): an evaluation takes a mock `perform`, each effect keeps its address and its outcome, and a log replays a run

**Context.** The study R2 found that `evaluate` is a fixed handler: each effect gives its payload (fact 3). A test thus cannot give an evaluation other results.

A run records the payload of each effect, but not its outcome (fact 4). The global index of an effect follows the order of the host under `all` (fact 6). Thus a run log cannot drive a replay. The proposals P1 and P2 of R2 address these facts.

**Decision.**

- `evaluate`, `plan.evaluate`, `reference` and `agree` take a `perform`, as `run` does. In an evaluation, it is a mock: its answer is the result of the effect (RUN.MOCK). A promise from the mock gives `#CALC!`, because an evaluation does not wait. Without a mock, RUN.EVAL stays.
- The kernel gives each effect its outcome, the result that it gave its document (RUN.OUTCOME). It sets the outcome when the answer comes. An effect that a stop ended first keeps no outcome.
- A `Failure` that the host throws gives its own error value, as `thrown` does for an evaluator. A replay uses it for a recorded error and for `#REPLAY!`.
- Each effect has an address (RUN.ADDRESS). It is the text of its place, a `#`, and the count of the earlier effects at that place in its scope. The root is one scope. Each item of `all` is a scope with the prefix `all<n>.<item>/`. The code of one scope does not interleave with itself, thus its counts do not depend on the host.
- The text of an address is a definition of the model (`placeText`). The plan and the reference share it, and each one keeps its own scopes (D15).
- `recorder(perform)` gives a `perform` and a log (RUN.RECORD). The log keeps each effect with its address, its kind, its payload, its outcome and a mark for a wait. It reads the outcome that the kernel gives. It also keeps the order in which the waits of each `all` settle.
- `replayer(log)` answers each effect by its address (RUN.REPLAY). An effect that waited in the recorded run waits again, unless the option `wait` is `false`. An effect that the log does not have at its address gives `#REPLAY!` (RUN.REPLAY-MISMATCH).
- A journal on the function `perform` (the key `JOURNAL`) carries the order of the waits. `all` tells the journal of a recorder each item that settles. In a replay, `all` asks the journal for the next item, thus `failFast` gives the recorded result.
- `agree` gives its mock to each tier, also to the second tier of a language. When two tiers record the address or the outcome of an effect, these must agree (AGREE.MOCK).

**Rejected.**

- The global index as the key of a replay. Under `all`, it follows the order of the host (fact 6).
- A mock that can wait in `evaluate`. An evaluation does not wait, and a promise there changes its type.
- A brand symbol for the error of a mismatch, which the first draft of this work had. A `Failure` already carries an error value through the code of a host. One rule then serves a recorded error and `#REPLAY!`.
- A recorder that changes each answer of the host into a result itself. It reads the outcome of the kernel, thus one function makes each outcome.
- A journal as a separate option of a run. The key on the function keeps one value for a host to give, and two copies of the kernel share the key.
- Addresses from the binding names of the steps. They survive more edits of a document, but a part without a name needs the place anyway. This waits for the open question 5 of R2.

**Why.** A mock gives tests of the run side without promises, and a dry run with realistic values. The same `perform` gives the same result in an evaluation and in a run, thus one meaning stays.

An address that does not depend on the host is the key of a log. Durable workflow engines and the replay handlers of probabilistic languages use the same key. A log with outcomes gives golden tests of runs, and a base for the multi-shot kind of R2 P7 (L1b).

The new options are optional. A host that throws a `Failure` from its `perform` is rare. Thus the change is backward compatible.

## D20 (2026-10-24): one walk for each equality, and `sameResult` is stricter than `sameValue`

**Context.** A schedule with an early cutoff needs an equality of two results (R4 P1). A wrong `true` keeps a stale value, but a wrong `false` only costs work. The kernel had two equalities, `docEquals` for documents and `sameValue` of `agree` for two tiers. Each had its own walk.

**Decision.**

- `docEquals`, `sameValue` and `sameResult` share one walk. Lists and plain records compare by their items and fields, in each order of the fields. Each other value compares with `Object.is`.
- Only the rules for the other values differ. Such a rule answers first for each pair that is not the same by `Object.is`.
- `sameResult(a, b, equal?)` is the equality for an early cutoff. A closure of `fn` is the same only as itself. Two errors need the same code, reason and place. The cause is not compared.
- A held error in a value compares by the same rule as an error.
- `sameValue` keeps its rules for two tiers. Two closures with the same parameters are the same. Two errors need the same code, and the same place when both have one.
- In all three, `-0` is not `0`, and `NaN` is `NaN`.
- A host gives `sameResult` its own rule for its values, for example for dates. The rule answers first, as the option `equal` of `agree` does.

**Why.** `sameValue` cannot be the value part of `sameResult`. Two tiers always make different closures, thus `agree` compares their parameters. There, a wrong `true` only makes one test weaker. In a cutoff, two closures with the same parameters can hold different values of their evaluations, thus a wrong `true` keeps a stale closure.

A reader sees the reason of an error, thus a cutoff compares it. Two tiers can give different texts for one reason, thus `agree` compares the reason only with `strict`. The cause is often a new exception at each evaluation. A cutoff that compares it does not stop.

`1 / x` gives a different value for `-0` and for `0`, thus a cutoff between them is not safe. No reader can tell two `NaN` values apart. One walk keeps the rules of the structure in one place, and each difference is a small rule.

## D21 (2026-10-24): a host thing tells a field that holds `undefined` with an optional `has`

**Context.** `HostThing.deref` gives `undefined` for a step that reaches nothing. Thus a field that holds `undefined` read as a missing field: `#N/A`, or `#NAME?` at the root `names`. A host that adopted the names hid each name bound to `undefined`, and `check` did not agree with the run (K20). A node of the standard tree hid an attribute with the value `undefined` in the same way. `resolve` already gives `{ thing }`, thus it can give `{ thing: undefined }`.

**Decision.**

- A host thing can have the optional function `has(key)`. The kernel asks it only when `deref` gives `undefined`. Then `true` tells that the field holds `undefined`.
- A thing without `has` keeps the old reading. Each existing host works without a change.
- `resolve` keeps its form. `{ thing: undefined }` is a field that holds `undefined`, and `undefined` is a missing path.
- Each node of the standard tree has `has`, in the plan and in the reference.

**Why.** We examined three forms. A sentinel value from `deref` is a new value that must not get out of the kernel, and each host must change `undefined` into it. A `{ found }` form from `deref` changes its type, thus it breaks each host, and a host value can have the same form. A separate `has` keeps `deref` unchanged, as `Map` has `get` and `has`. It costs a second call only for `undefined`.

## D22 (2026-10-24): value types are JSON terms apart from kinds, the base types are open through the domains of a machine, and `unknown` is the gradual top

**Context.** The study R5 proposes value types and value domains as the base of the type work (P2, K23). R5 also asks if value types are documents in envelopes (open question 3).

P2 leaves some choices open. Where do the domains live, and how do two languages merge them? What does a base type without a domain mean? Which rule do records with optional fields obey?

**Decision.**

- A value type is a compact JSON term (`ValueType`), not a document in an envelope. A text names a base type. The terms are `list`, `record`, `fn`, `union` and `one`. The ladder does not read a value type (D2).
- The kernel has six base types. `unknown` is the top, and `never` is the bottom. They are not domains. `null`, `bool`, `number` and `text` are the domains of the kernel, in `STD_DOMAINS`.
- A language adds a domain to the table `Machine.domains`: a test `is`, the parents `under` and a `summary`. A kernel domain that the table does not name comes from `STD_DOMAINS`.
- A value is a member of a domain only when the test of the domain and the test of each parent accept it. A test that throws gives `false`.
- `fits(found, expected)` decides each check of a type. `unknown` fits each type, and each type fits `unknown`. Lists are covariant, records have width subtyping, and functions are contravariant in their parameters.
- An open record without an optional field of the expected record fits only when that field is `unknown`. The other fields of an open record can hold each value.
- A function type tests only that a value is a function. A test of its parameters needs a wrapper at each call, and the casts of K28 decide it.
- A term that the kernel does not know, a base type without a domain and a term deeper than 256 terms read as `unknown`. `typeIssues` lists each one.
- `domains` is a table of `mergeMachines`, merged name by name. Two domains are equal when they are one object, or when they have the same test, parents and summary.
- Each other pair of domains with one name is a conflict, unless the later part names `["domains", name]` in `replaces`. `formulaMachine` and `STD_MACHINE` give `STD_DOMAINS`, thus a different `number` is a conflict. `restrictMachine` removes a domain.
- `fits` is sound for types without `unknown`, but it is not complete. For example, `bool` does not fit `{ "one": [true, false] }`.

**Rejected.**

- Value types as documents in envelopes. A type then looks like a kind, and a check of a type needs a world. A view can draw the JSON term later (D8).
- Domains in the world. The world is data, and a domain holds code, as an evaluator does.
- Kernel base types that a language cannot replace. That needs a special rule in the merge, and `replaces` already gives an explicit replacement.
- A base type without a domain as a closed type that fits only itself. A spelling mistake then gives a chain of issues, and a cast refuses each value.
- The rule of TypeScript that an open record fits a record with an optional field that it does not have. A member of the found type is then not a member of the expected type.
- A domain test that does not include the tests of the parents. Then `under` is a claim that nothing tests, and `fits` is not sound when a test forgets a parent.
- A `join` of types and a text for each type in this item. K24 needs them for `if` and for the reasons of its issues, and it adds them with its check.

**Why.** A JSON term keeps a value type apart from a kind, and a contract can hold it, as it holds a shape. The domains are code, thus they merge as the other tables of code do (D17). Two languages that share the kernel domains get one table, and two meanings for one name stop the merge.

The tests of the parents make each `under` true by construction. Thus a domain under `number` gets the test of `number`, and the rule for base types is sound. A term that the kernel does not know reads as `unknown`, as a marked hole does. Thus one bad type gives no chain of issues. A later term, for example a type variable of K30, does not break an older check.
