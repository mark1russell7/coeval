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
- In a run, a part that can wait must have a parent that can wait. Otherwise the part fails with `#CALC!` before it starts. D38 replaces this rule: the run drives the part, and only a real wait fails.
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
- The reference covers evaluations, not runs. A run with a host that waits comes later. D55 adds it.

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

## D23 (2026-10-24): each verb goes through the kernel with one ladder, and the contract serves each verb

**Context.** The study R6 found that only the verb `eval` got plans and checks (fact 2). `prepare`, `check` and the reference named `eval` in their code. A language with another verb, for example `format`, wrote its own walk, with no plan, no trace and no check.

The ladders also differed by verb (fact 3). `deref` visited the own entry, the kind and a fixed step into the value, but not the default of the world. `step` had only the kind rung. The open question 2 of R6 asked if this was a decision or a gap.

**Decision.**

- `prepare`, `evaluate`, `run`, `check`, `reference` and `agree` take the option `verb`. The default is `eval`, thus each existing call gives the same result (VERB.DEFAULT).
- At each document, the ladder answers for the verb, and each part evaluates with the same verb. A verb is one reading of the whole document. The sealed parts of D7 keep each reading compositional.
- One function gives the rungs of each verb: the own entry, then the kind, then the default of the world. `ask` gives the same answer with the record of the rungs. Thus the different ladders were a gap, and this decision closes it (VERB.LADDER).
- `deref` gets the default rung. When no rung answers, a step goes into the value of the document, as before. A value without a type is data, thus a step goes into it at once. This clause changes the clause of D10 about the default of `deref`.
- `step` gets the own rung and the default rung. A rung of `deref` or `step` answers only with code that the machine has, as the kind rung did before. A rung reads only the own names of a table of code (LADDER.OWN-ONLY).
- The resolution and `check` find the walker of a step with one function, thus they agree on `#STEP?`.
- The evaluators of each verb share the tables `evaluators` and `runners`, by name. Thus the merge of D17 and the restriction of D18 serve each verb with no new rule.
- The contract of a kind serves each verb. For each verb, the kernel splits the parts and narrows their capabilities by the rules of D14. `check` reads the shapes, the paths and the scope rules for each verb.
- `side` and `effects` describe the verb `eval`. Thus `check` tests the declared effects only for `eval` (VERB.CHECK). An effect of another verb uses the same `effect` and the same runners (D9, D11). The capabilities test it when it happens (VERB.CONTRACT).
- The reference interpreter reads each verb by the same rules: the ladder of the verb, the contract and the sealed parts. A compiled evaluator of a verb needs a definition, as for `eval` (D15).
- `agree` gives its verb to each tier, also to the second tier of a language (VERB.AGREE).
- The kernel ships no verb `format`. A spec test adds it to the formula kit with a merge, as a language does (VERB.FORMAT). Today the language replaces three kinds of the kit to give them their own entries.

**Rejected.**

- A table of code for each verb, for example `formatters`. Each verb of evaluation has the form of `eval`, thus one table serves. The merge and the restriction then need no new rules.
- The step into the value as a named default of `deref` in the standard world, as R6 P3 proposed. Each world without that entry then loses its field steps, and each host breaks.
- The default of `deref` for a value without a type. A `deref` reads a document, and the quick path of a resolution reads plain values without the ladder (DEREF.QUICK).
- A check of the declared effects for each verb. A verb `format` causes no effect, thus such a check gives a false `#CAP!` for the text of an effect. A contract that declares the effects of each verb comes later.
- A field `verb` in the type `Plan`. The code and the trace of a plan keep its verb. A new field that each plan must have breaks a host that makes its own plans.

**Why.** A new verb costs as little as a new kind. A language gives one default and the entries of its own kinds, and it gets plans, traces, `check` and `agree` for the verb. One function for the rungs keeps the plan, `check` and the resolution in agreement.

The new options are optional. The new rungs read entries that the kernel did not read before: a default of `deref` or `step`, and an own entry of `step`. Thus the change is backward compatible.

**Next.** K35 lets a language add a verb that it owns to the kinds of another language, through the merge (R6 P4). The merge writes the entry into the kind, and the kind rung reads it. K36 lists each kind that answers no verb of a list (R6 P5). It asks the same function for each kind and each verb, before a document exists. Neither changes the ladder.

## D24 (2026-10-24): the static facts of a document come from one walk, the kind contracts and a hook of the machine, and a read of `event` is not volatile

**Context.** The study R4 proposes `factsOf` as the base of a schedule (P2, S1a). A plan, a cache and a graph of changes need some facts of a document before an evaluation. These facts are the reads, the side, the effects and the marks `pure` and `volatile`.

R4 leaves some choices open. Which reads does a reference give when its resolution follows a reference in the data? How does a kind tell which parts an evaluation can skip? What does volatile mean? How does a fallback kind, for example the operations of the formula kit, declare facts for each name?

**Decision.**

- `factsOf(machine, doc, options?)` gives the facts from one `walk`. The facts depend only on the document and the machine.
- A read is a free reference whose root is one of the five roots of D10. A read has its root, its keys up to the first step document, its place and its JSON path.
- A read after a step document is not exact, because the plan resolves a longer path. A bound name of a kind around the reference is not a read. A path from another root is not a read.
- A read is one resolution of its path. A reference that the resolution follows in the data is a part of that read (DEREF.COLLAPSE), not a separate read.
- The contract field `lazy` lists lazy rules. A rule has the patterns `in` and a count `after`. It marks the parts that an evaluation of the kind can skip and still give a value.
- `after: 1` skips each part that the rule covers, after the first one, as in `and`. A read is lazy when a document on its way is a lazy part.
- An own entry that names another evaluator than the kind has no contract. Each of its parts is lazy, and the document is not pure, unless the hook answers for that evaluator.
- The contract field `pure` tells that the code of a kind causes no effect. Its result depends only on its data, its parts and its reads. A document is pure when each kind in it declares `pure`.
- A pure document also has no effect, the side `derive` and no volatile mark. An unknown kind is not pure. A step document is pure when its kind is pure.
- The contract field `volatile` tells that the result of a kind changes without a change of its reads, as a clock does. A host marks a volatile read with the option `volatile`.
- A read of `event` is not volatile. It is a read, and a host marks it when it wants to. An effect is not volatile either. The side and the effects show it.
- The hook `Machine.facts(path, code)` gives the facts of a name that a fallback kind covers. Each field of its answer wins over the contract.
- The option `verb` names the verb whose code the facts describe, as in `prepare` (D23). The ladder finds that code. The facts of a contract describe the code of `eval`, and of `step` for a step document.
- For another verb, only the hook describes the code. The side and the effects come from the contracts for each verb, an over-approximation, because a contract declares them for `eval` (D23).
- `mergeMachines` composes the hooks in the order of the parts, and the first answer wins. A hook does not answer for a name whose code a later part replaces.
- `formulaMachine` gives the hook `formulaFacts(profile)`. A lazy operation has a lazy rule for each argument. The profile fields `pure` and `volatile` name the pure and the volatile operations.
- A standard extension of the formula kit is pure. An extension of the profile gets the context, thus it is not pure. The kinds of the formula kit and of `STD_WORLD` declare their facts.
- The test FACTS.SOUND evaluates generated documents of six machines. It finds no resolution that a static read does not cover.

**Rejected.**

- A read of `event` as volatile. The host already knows when an event comes, and a mark on each read of `event` hides the documents that do not change.
- An effect as volatile. A schedule does not repeat an effect (L3), thus the mark gives no new fact. The side and the effects already tell it.
- A separate mark `closed`, as in R4. A kind that reads the context outside `resolve` is not pure, thus `pure` holds the same fact.
- Lazy parts as a mark on a part shape. One shape serves kinds with different evaluation orders, for example `list` and `and`.
- A hook only in the options of `factsOf`. Then each caller copies the facts of each operation. The machine already holds the profile, and `mergeMachines` composes the hook.
- Kinds of the formula kit without facts, with the facts only in a separate table. Then a copy of a kind and its facts can disagree.

**Why.** One walk keeps the facts cheap, thus a host can compute them again for each changed document. The contracts already describe the parts, thus a lazy rule is one more field of the same kind of data.

The test FACTS.SOUND makes the reads a sound over-approximation of each evaluation, and FACTS.LAZY makes each eager read a real read. A copied older kind without the new fields is not equal to the new kind. Thus a merge of the two gives a conflict, and `replaces` resolves it.

## D25 (2026-10-24): a type rule follows its evaluator, a check of types goes in two directions when a host opts in, and a type issue has the static code `#TYPE!`

**Context.** The study R5 proposes signatures of operations and a bidirectional `check` (P3, K24). D22 gave the value types and `fits`. It left two parts for K24: a join of types, and a text of a type for the reasons of issues.

R5 also asks three open questions. Does a type rule live in the contract or in the code (question 4)? Does a type issue keep the code of a run (question 2)? Is a possible failure an issue (question 1)? D23 makes `check` take a verb.

**Decision.**

- A type rule is code with two functions. `part` gives the type that a part must have, and the types of the names of the part. `synth` gives the type of the document from the types of its parts.
- An evaluator object holds its rule in its field `type`. The rule of a document is the rule of the evaluator that the ladder gives for the verb of the check (TYPE.RULE). Thus an own entry gets the rule of its own evaluator.
- A runner has no rule yet. The types of the run side wait for K29.
- The contract holds value types as data. `Kind.result` gives the type of each document of a kind. The `expect` of a shape gives the type that a part must have. They describe the verb `eval`, as `side` and `effects` do.
- A formula profile gives a signature, or a list of overloads, for each operation (`sigs`). One signature gives the types of the arguments before their check, thus an issue goes to the wrong argument.
- Overloads select after the check of the arguments, and the first overload that fits gives the result. When an argument has `unknown` in it and two results differ, the result is `unknown`.
- An operation without a signature, a kind without `result` and an evaluator without a rule give `unknown`. Thus a language without types gets no type issue from them (TYPE.GRADUAL).
- The pass goes down to give each part its type and the types of its names. Then it goes up to synthesize the type of each document.
- The pass reads the documents that the walk of `check` visited, and it has its own stack. The parts that give the names of a rule `keysAt` come first. Thus `let` knows the types of its bindings for its body.
- A part whose type does not fit gets a type issue at its place, and the type `unknown`, as a marked hole of Hazel. A document with another issue also gets `unknown`. Thus one problem does not give a chain of issues.
- A type issue has the new code `#TYPE!`, with `expected`, `found` and a reason. The reason gives each type with `typeText`.
- A type issue is a static finding. No evaluation reads a type, thus a run gives the same result with types and without them.
- A host opts in with the option `types` of `check`, or with `typeCheck`. `typeCheck` also gives the type of the root and of each place. Without the option, `check` gives the same issues as before.
- `join` gives one type for the branches of an `if`, the items of a list and the terms of the logic "value". It uses a strict form of `fits`, in which `unknown` is only the top. Thus the join is sound.
- `check` examines each value type of a contract and of a signature with `typeIssues`. It reports a problem one time in a check, at the first use of the type.
- The claim of soundness is a property test (TYPE.SOUND). A generated document checks with no issue. Then each value of its evaluation is a member of the type of its place.
- The language keeps its signatures: each operation gives a member of the result of each signature that its arguments match.

**Rejected.**

- A verb `type` with a table `typers`, as R5 P3 sketched. A rule from its own ladder can describe another evaluator than the one that runs, for example under an own entry.
- A new table of code. It needs new rules in the merge and in the restriction (D17, D18). A field of the evaluator object merges and goes away with its evaluator.
- The code of a run, for example `#VALUE!`, for a type issue. An operation can accept more than its signature, and `fits` is not complete. Thus a type issue is not always an error of a run.
- Type issues for each check by default. A host that does not read types then gets new issues and a second pass that it does not use.
- The first overload that fits, also for an argument with `unknown` in it. Such an argument fits each overload. Then a less precise argument can change the result and add an issue.
- A join with the gradual `fits`. By the gradual rule, a list of `unknown` items fits a list of numbers, and such a join is not sound.
- The types of the roots, of the paths and of the names of the host in this item. K25 gives them. Until then, a reference has a type only for a name that a kind around it binds.

**Why.** The code that gives a value is the one source that knows its type. A rule in that code cannot describe another evaluator, and the merge of D17 keeps the two together.

A new code keeps the type issues apart from the issues of `check` that a run confirms. Thus STATIC.AGREES keeps its exact meaning, and a host can filter the type issues. The opt-in keeps each existing check and each existing host unchanged. The new fields are optional, thus the change is backward compatible.

**Next.**

- K25 gives the types of the roots, of the names of the host and of the paths. The rule of `ref` reads them, and the options of `check` get the types of the roots.
- K26 makes TYPE.SOUND a rule of agreement. It adds a typed generator from the contracts and the signatures, and a local test of each rule.
- K27 adds `proves` to a signature. The pass then narrows the types of the names in the branches of `if`, `and` and `or`.
- K28 adds a guard at each boundary where a part of the type `unknown` meets a type that its position needs. The pass already knows each such place.

## D26 (2026-10-24): an evaluation records its reads on request, and `verifyReads` resolves each free read again with the rules of `sameResult`

**Context.** The study R4 proposes a list of the reads of an evaluation, and its verification (P3, S1b). This is the verifying trace of build systems, and the green mark of the red-green algorithm of rustc. A pure document is a function of its reads. Thus a schedule keeps an old result when each read reaches the same thing again.

R4 leaves some choices open. Which equality decides that a read is the same? Which reads does a verification resolve again, when a kind binds a name or sets `self`? What does a value that keeps the context, for example a closure, read later?

**Decision.**

- `evaluate`, `plan.evaluate`, `run` and `plan.run` take the option `reads`, a list, as `effects` is a list. Each resolution through the runtime adds one `Read`. Without the list, a resolution costs one more test.
- A read has the path that code resolved, what it reached as a `Result`, and the mark `free`. A host thing stays a thing. An exception of the host gives the error value of the read, and the exception goes on to the code.
- A read is free when it reads the context at the root of the evaluation. A read of `names` is free when its first name has the binding of the root. A read of `self` is free when it reads the root `self`. A path without a root is not free. Each other read is free.
- A read that is not free reads a binding that a kind made from earlier reads. Examples are a name of `let` and a parameter of `fn`. `verifyReads` does not resolve it again.
- A node of a tree is the `self` of its attributes, and its parent is the `self` of its context. Thus the first read of a `self` that a kind set adds a read of the root `self`, with the mark `kept`.
- A closure of `fn` keeps the context for later uses. The formula kit tells the runtime through the optional function `Runtime.keepsContext`. The list then gets a read of each whole root, one time in an evaluation.
- A reference of the formula kit tests the binding of its first name for a held error. When the binding holds one, the reference resolves the name for the list. `verifyReads` gives a changed read for a longer path through a held name in the new context.
- `verifyReads(machine or plan, reads, context, options?)` resolves each free read again in the new context, in order. It compares the two answers with `sameResult`, and the rule `equal` of the host answers first. It gives `{ same: true }`, or the first changed read with its index and its new answer.
- A read keeps its hops only when its code asked for them. Then `verifyReads` compares each hop too.
- `verifyReads` is sound for a pure document (D24). The schedule asks `factsOf` for the mark `pure`. The values of the context do not change in place, as PLAN.CACHE says for the documents.

**Rejected.**

- `sameValue` as the equality. It finds two closures with the same parameters the same, and it does not compare the reasons of two errors. A resolution gives its thing and its reason to the result, thus a wrong `true` keeps a stale value (D20).
- A copy of each value at its read. A copy costs time and memory, and `toJson` of a node evaluates each attribute of its tree.
- A new resolution of each read, also of the reads that are not free. A name of `let` is then not the same at any time, thus no result with a `let` stays valid.
- A read of a set `self` as a free read. Its path then starts at the root `self`, not at the node. Another path can reach the same value there, while the parent of the node changed. Thus a stale result stays.
- A kept read only for a closure in the result. A closure can leave the evaluation inside a host object, for example a box, and a walk of the result does not see it.
- A list of only the free reads, as R4 proposes. The full list with the mark costs nothing more, and a trace and the tests read it.
- A boolean answer, as in the sketch of R4. The first changed read tells a schedule what changed.
- A place for each read. `Runtime.resolve` has no place, and a new parameter changes the interface of each compiled evaluator.
- `factsOf` inside `verifyReads`. The facts depend only on the document and the machine (D24), thus a schedule computes them one time.

**Why.** The list is the dynamic half of the interface of a schedule (S1). It is exact where `factsOf` over-approximates: a branch that the test did not select has no read. A read of `names.x.a` reaches one field, thus a change of another field of `x` keeps the old result.

The kept reads over-approximate. A closure makes a document depend on each root, and a tree depends on the whole root `self`. A wrong `false` only costs work (D20). A later item can give a closure only the reads of its body.

The test READS.SOUND changes the contexts of generated documents at random. It found the test of a held binding, which the first draft of this work did not record. A list without the kept reads gives stale results of trees, and the test finds them too.

## D27 (2026-10-24): the effects that reach the host are one fold over the contracts, a procedure value keeps the capabilities of its maker, `check` asks the hook `permits` and finds the waits of a run, and `grant` waits for the handler kind

**Context.** The study R2 proposes an inference of effects and latent effects (P3), and a static check of the "can wait" bit (P4). D14 shipped the rules `same`, `mask` and `only`. It left the rule `grant` of P3 for the handler kind of P5 (L1a).

`check` did not ask the hook `permits` of the machine, thus the harness skipped each machine with that hook (STATIC.AGREES). In a run, a runner under an evaluator failed with `#CALC!`, and `check` did not find it (RUN.NESTED-WAIT).

**Decision.**

- `effectsOf(machine, doc, options?)` gives the kinds of the effects that can reach the host (CAP.EFFECTS-OF). These are the declared effects of each document, without the effects that a rule `mask` or `only` around them removes.
- The fold is first-order, thus it needs no effect variables. One walk narrows the capabilities with `partCaps`, as a run does.
- Without capabilities, the root has the capability `[]`, which permits each effect (CAP.KEYS). The result is then the least authority of the document. A host that grants it gets each effect of a run.
- With capabilities, the rule of the machine decides at each document: the hook `permits`, or else the function `permits`.
- `check`, `factsOf` and `effectsOf` read the declared effects with one function, `declaredEffects`. `factsOf` keeps each declared effect, and `effectsOf` removes each effect that cannot reach the host. Thus the kernel has one inference.
- `check` asks the hook `permits` of the machine (CAP.PERMITS). A check has no values, thus the hook gets the capabilities of the document and the world. Its names, its self and its event are empty.
- A procedure value keeps the capabilities of the document that made it, as the closure of `fn` does (CAP.LATENT). Its latent effects are the effects of its body, and the walk visits the body under those capabilities. Thus `effectsOf` and `check` count them at the body, and a mask around a call does not change them.
- A procedure entry is a kind whose code evaluates the document of a procedure. Its field `effects` declares the latent effects, and `check` tests each call against them.
- `checkLatent(machine, declared, body)` compares the declaration with the body. It gives a `#CAP!` for each effect of the body that can reach the host and that the declaration does not permit.
- With the option `run`, `check` finds the waits of a run (RUN.CAN-WAIT). A runner under a parent without a runner gives `#CALC!`, because an evaluator gives its parts no wait. A kind that declares effects and has no runner gives `#CALC!` too. The issue has the place and the reason of the run.
- The rule `grant` waits for the handler kind. The row L1a names it.

**Rejected.**

- The rule `grant` in this item. A part that gets an operation needs a handler that answers it. Without the handler frame of P5, the effect goes to the root `perform`, and that breaks CAP.NARROW.
- A `grant` that only the static kit reads. Then `check` passes an effect that a run refuses, and that breaks STATIC.AGREES. No document without a handler needs the rule.
- A second inference of effects beside `factsOf`. Two folds can disagree, as `check` and the runner of `pure` did before D14.
- The hook `permits` for the least authority. The hook expects real capabilities. A hook that reads a capability by its name can then remove an effect that a real grant permits. Without capabilities, only the rules of the kinds narrow, and the result stays sound.
- A procedure value that takes the capabilities of the caller. Then a call site needs an effect variable, and the static kit needs effect polymorphism (R2, open question 3).
- A field for the body of a procedure in the kind. The kernel cannot evaluate such a body yet (K40). The host keeps the body, and `checkLatent` reads it.
- A new code for a wait that a parent cannot pass through. The run already gives `#CALC!`, thus `check` and a run agree on one code.
- The check of the waits by default. An evaluation drives a runner under an evaluator, thus a host that only evaluates gets no new issues.

**Why.** The contracts already declare the effects and the narrowing, thus the residual effects are one fold over the same data. A host can grant exactly these capabilities. The property test CAP.EFFECTS-SOUND compares the fold with the effects that a recorder sees in evaluations and in runs.

A procedure value that keeps the authority of the document that wrote it acts as an object capability. The check of a call needs only the declaration, and `checkLatent` keeps the declaration true.

The check of the waits reads only the names of the evaluators and of the runners. It finds RUN.NESTED-WAIT before the host does an effect. A property test gives generated documents to `run` and finds no refused wait that the check did not report.

**Room for handlers.** The handler kind of L1a adds the rule `grant` to `Kind.caps`. The walk then records the operations that a handler answers for each part. `effectsOf` removes a handled effect, and `check` gives no `#CAP!` for it. A clause gets the context of the `handle` document, thus its effects count at the clause. CAP.NARROW then reads "a part cannot cause a host effect that its parent cannot cause" (R2, open question 2).

**Limits.**

- K64: the code of an own entry for another evaluator can cause effects that no contract declares. `effectsOf` and `check` do not see them.
- K65: a compiled runner can evaluate a part with its code that does not wait. The check assumes that a runner passes each wait of its parts through.

## D28 (2026-10-24): the host gives the types of the roots, a path steps through the types, and only a type rule keeps the roots of its parts

**Context.** The study R5 proposes the types of the roots, of the names and of the paths (P4, K25). D25 typed only a name that a kind binds. A reference to another root, or with more steps, had the type `unknown`.

K23 left two needs: the types of the steps into a domain, and a way to add parents to the domain of another language. R5 also asks if a record of a store schema is closed by default (question 6).

**Decision.**

- A host gives the types in the option `rootTypes` of `check` and `typeCheck`: the names of the host, `self`, `world` and `event`. The root `caps` has the fixed type `CAPS_TYPE`, because the kernel narrows it.
- The types of the names of the host go into the names at the root. A kind that binds a name hides the name of the host, as in a run.
- The check examines each type of the host one time, at the root document.
- `TypeInput.rootType` gives the type of a root at a document. With `PartType.roots`, a rule gives its parts other types of `self`, `world` and `event`.
- The parts of an evaluator without a rule get `unknown` for these three roots. No contract tells how an evaluator changes them, and a node of a tree changes `self`.
- The rule of `ref` steps through the types. A record gives its field, and a list gives its items, or `number` for `length`. A base type reads `Domain.steps`.
- A union joins the steps of its types, and `one` steps into its values.
- A field that a closed record does not have is a `#TYPE!` issue. An open record and `unknown` give `unknown`. A union and `one` give the issue only when no type or value of them has the field.
- An optional field gives its type with no issue. When the field is absent, the path fails and gives no value. Thus the type stays sound (R5, question 1).
- A type whose member can be an envelope gives `unknown`. A path asks the ladder for a step into an envelope, and it follows a reference document (DEREF.COLLAPSE). A plain machine reads each value as data.
- The path `["names"]` gives `unknown`, because the record of the names holds the error of a failed binding. A name that is a key of a header gives `unknown`, because such a record of names can be an envelope.
- `Domain.steps` gives the type of a step with a key into a member. The steps of the domain come first, then the steps of each parent.
- A merge compares the steps of two domains too. This clause changes the clause of D22 about equal domains.
- A domain refuses each reference document, because a path does not follow a member of a domain.
- `extendDomain(name, { under, steps })` makes a part of a merge, as a function of the merge before it. It copies the domain with the new parents and steps, and it names `["domains", name]` in `replaces` (D17).
- `typeFromSchema` reads a subset of JSON Schema: `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, `anyOf` and `oneOf`. Each other keyword tests nothing, and an issue names it.
- A schema with `$ref` or `nullable` reads as `unknown`, because these keywords can permit more values. `patternProperties` keeps a record open, and a tuple gives a list of `unknown` items.
- A schema with more than one of `type`, `anyOf` and `oneOf` keeps the first, with an issue for each other. `enum` and `const` keep each value that each other keyword holds.
- `typeFromSamples` gives base types, not values. All records of the samples join into one record. A key that a record does not have is optional.
- A record of samples is open, unless the option `closed` is `true`.
- The claim of soundness is a property test (TYPE.ROOTS-SOUND). Its contexts hold envelopes, reference documents and kinds that change the roots, with a rule and without a rule.

**Rejected.**

- The names of `rootTypes` as names that the check also reads as bound. A check without types then gives other issues, and the option `names` already tells which names exist.
- A function of a path as the type of `world`, as R5 sketches. A host makes the type one time, for example with `typeFromSchema`. A provider function is a later item (K71).
- The roots of the document for the parts of an evaluator without a rule. A kind of a tree changes `self`, thus such a check is not sound.
- A new field of a contract that tells which roots a kind changes. An own entry names another evaluator, thus only the rule of the evaluator describes its code (D25).
- Path types without the test for an envelope. Without the test, the property test finds a value that a path follows as a reference.
- Parents that merge as a union of two lists. A new parent changes the members of the domain of another language, thus D17 needs `replaces` for it.
- A new rule of the merge for a foreign domain. A part of `prev` with `replaces` already gives it, thus `extendDomain` is only a helper.
- Each record of samples closed by default. Samples do not show that a field cannot exist, and a closed record gives a false issue for a new field. The option `closed` gives the strict reading.
- `one` of the sample values. Then each new value of a root gives a type issue, and the type does not generalize.
- The keyword `integer` as a new base type. The kernel has no such domain, thus it reads as `number` with an issue.
- Each keyword that the reading does not read as an `unknown` schema. Most keywords only test more, thus the rest of the schema stays a sound type.

**Why.** A host already knows the shape of its data: a store schema, the JSON Schema of a procedure or some events. A type of a root brings that knowledge to each reference, thus `check` finds a wrong field before a run.

Each rule gives `unknown` where the kernel cannot know what a path reaches. Thus each claim stays sound, and a type that is less precise gives no new issue. The new options and fields are optional, thus the change is backward compatible.

The work found a hole of D25. A name bound to a reference document had the type of that document, but a path follows the reference. The test for an envelope closes the hole.

**Next.**

- K70: a step into a base type of the kernel or a function is a type issue. A step into a list with a key that is not an index is one too.
- K71: a type provider for `world` that gives the type of a path on demand, for a large store.
- K72: a walker declares the type of what it reaches, thus a path with a step document gets a type.
- K73: `typeFromSchema` reads `$ref` into `$defs` of the same schema, and `allOf` of records.
- K74: the tree kit gives its kinds type rules with `PartType.roots`, thus an attribute of a node knows the type of `self`.

## D29 (2026-10-24): a reference compiles its static path in `prepare`, and the kind of a type has a memo for each world

**Context.** The study R1 found that `prepare` is a first Futamura projection, written by hand (P2, K12). A plan still resolved each reference with the generic algorithm. At each evaluation, the short path examined the root, the open roots, `adopt` and each step, but the path and the navigator are static. A step document asked the ladder of `step` again, and a step on an envelope looked up the kind of its type again. References are the most frequent node.

**Decision.**

- `compilePath(nav, path)` in `deref.ts` compiles one static path for one navigator. It is `resolve` without hops, partially evaluated by hand. It is not an export of the package.
- The reference of the formula kit compiles its path in `prepare` when the path has no parts (PLAN.PATH). A path with parts, for example step documents under a deep shape, changes at each evaluation. It resolves as before.
- The compilation reads these items one time: the root, the open roots, `adopt` and `plain`. It also tests one time that each step is a key, and it finds the walker of each step document. The ladder of `step` answers from the navigator and the step document only.
- A plan keeps its machine (COMPOSE.INCREMENTAL). Thus the navigator and the world of a compiled path do not change during the life of the plan.
- Each evaluation examines only the values of the context. A compiled path keeps no value of a context, and no thing that a path reached.
- The compiled path and `resolveQuick` share one step function, `walkQuick`. A value that the short path cannot answer goes to the full algorithm, as before. Thus the two cannot disagree at an edge of DEREF.CODES (PLAN.PATH-SAME).
- The runtime of the kernel uses a compiled path only for a resolution without hops, and only for the navigator of the compilation. A trace records the hops, thus it resolves the steps again.
- A runtime that wraps the runtime of the kernel gets the steps through `Runtime.resolve`, as before.
- The list of reads records the steps of the document for a compiled path: the same list object as before. An exception of the host gives the error value of the read (D26).
- `kindFor` keeps a memo of `lookupKind` for each world, by the keys of the type (PLAN.KIND-MEMO). `derefStep` and `walkerOf` use it, thus the ladders of `deref` and `step` keep each rung and each default (D23).
- The memo of a world holds 1000 kinds at most, and then it starts again. Thus the types in the data of a host cannot fill the memory.
- The short path, `isRef` and `derefStep` read the field `type` of a value first. A value without that field is not an envelope, thus they do not examine its keys. A text type other than `ref` is not a reference.
- A CI job `bench.yml` compares the base and the head of a pull request in one process, with the rounds in turn. It prints the numbers and blocks nothing. The speed tests of the suite stay as they are.
- K101 changed the method of the job. One process kept one compilation of each copy, and identical code showed changes of up to 11 %. Since K101, each copy starts in new processes, and a second copy of the base gives the noise of each case.

**Rejected.**

- `Runtime.resolve` with a compiled path as its argument. A runtime that wraps another runtime and reads the paths then gets an object in place of a list, as a test of FACTS.SOUND shows.
- An export of `compilePath` in this item. A language that resolves a compiled path itself skips the list of reads. A route through the runtime for the second tier of a language is the row K75.
- A memo for each plan. The kind of a type depends only on the world and its keys, and one world serves many plans. `worldThing` already keeps one thing for each world.
- A memo by the identity of the type. Each value of a store has its own list for its type, thus such a memo finds almost nothing.
- A cache of the values that a path reaches. The context changes between evaluations, thus such a cache gives stale values. A root that does not change needs a declaration of the host (R1 P4, K14).
- One shared list of keys for each call of `resolve` on a host thing. A host that changes its list then changes the next evaluation. The kernel makes a new list at each call, as before.
- The mark "total" for the code of `lit` (R1 P2). It changes `compileNode`, not the paths, thus it is the row K76.

**Why.** A reference does the static work of its path one time, as `prepare` does for the ladder of each document. The values stay dynamic, thus each result, error, place and read stays the same. One step function for the dynamic path and the compiled path keeps their edges equal. Two property tests compare them on random paths and on generated documents, and `agree` compares the plan with the reference interpreter.

The CI job of this change measured the medians on Node 26, with the base and the head as bundles. An evaluation of the formula of FORMULA.SPEED went from 118 ns to 98 ns. A reference of five steps went from 163 ns to 120 ns. A reference through an envelope went from 387 ns to 253 ns, and a reference with a step document from 387 ns to 134 ns. A compilation of PLAN.COMPILE-SPEED stays at 2.9 µs. FORMULA.SPEED runs first. The times of the other cases were measured after the other cases in one process (before K210).

**Next.**

- K75: a language compiles its own paths, through a route of the runtime that records the reads.
- K76: the mark "total" for the code of `lit`, thus `compileNode` does not wrap it.
- K77: the standard evaluator `ref.resolve` compiles its path, with a definition for the reference.

## D30 (2026-10-24): a host keeps two epochs, the plans and the facts stay for each document object, and a result stays for its key in its data epoch

**Context.** The study R4 proposes two levels of durability (P7, S1c). The plans and the facts depend on the world and the documents, and the values depend on the data. A person edits a document rarely, and data changes at each event. Salsa keeps one revision counter for each level of durability.

The kernel had the parts, but nothing joined them. `planner` keeps a plan for each document object (PLAN.CACHE). `factsOf` gives the facts, and `verifyReads` tells if a result stays valid (D24, D26). A schedule had no place for a result, and no signal for a change of data.

**Decision.**

- `durable(machine, options?)` makes a cache for a host or a schedule. It keeps two epochs (`Epochs`): one for the structure and one for the data.
- The structure is the machine and the documents. The data is each value that a context gives: the names, `self`, `event`, the capabilities and a world of the host.
- `changeData()` adds one to the data epoch. `changeStructure(machine?)` adds one to each epoch. A change of the structure is also a change of the data, as in Salsa. The value of an edited node is data for its readers.
- A plan and the facts stay in a cache by document object, for the machine of the cache. They do not read the epochs. Thus a change of data compiles nothing and computes no facts (DURABLE.DATA).
- An edit gives a new document object, thus only that document compiles. A new machine drops each plan, each fact and each result (DURABLE.STRUCTURE).
- `evaluate(key, doc, context)` keeps one result for each key. The key names a node of the host, as each memo entry of Nominal Adapton has a name.
- A result stays in its data epoch while its plan stays. The host promises that the context of a key gives the same data in one data epoch (DURABLE.REUSE).
- After a change of data, a pure document verifies its reads with `verifyReads`, and it keeps its result when each read is the same. Each other document evaluates again.
- Only a pure document records its reads. A verification compares with the reads of the evaluation that gave the result, thus a kept result stays a function of those reads.
- `epochs.structure` is the signal for each product of the whole structure, for example the graph of S2. `counts` gives the work as a measure (R4).
- A value document has its own key in the cache, also `-0`. The cache of `planner` finds the plan of `0` for `-0` (K80).

**Rejected.**

- Marks on the reads, with a read of `world` as a structural read. A host often gives its own world with data, and a resolution can follow a reference into another root (DEREF.COLLAPSE). `verifyReads` costs one resolution for each read, thus the gain is small.
- A result that stays only with the same context object. The values of a context do not change in place (D26), thus a context object always gives the same data. The data epoch then adds nothing, and a host that makes a context for each call verifies at each call.
- A new plan and new facts at each change of the structure. Then an edit compiles each document again, but R4 says that an edit computes the facts of one document again.
- An epoch for each document or each key, as Salsa gives each input its own revision. The identity of a document object already tells an edit, and two levels give most of the gain (R4).
- An epoch in the plan, or a new option of `prepare`. A plan keeps only its compiled code (PLAN.LEAN), and it has no data.
- A cache of results in `planner`. One document at many cells shares one plan, but each cell has its own result. Thus a result needs the key of its node.
- A record of the reads of each document. The list costs one push for each resolution, and only a pure document can use it.

**Why.** A change of data is the common change, thus it costs only a verification or an evaluation. Two counters and two caches give that, with no new rule in the kernel. The plans and the facts keep the rules of PLAN.CACHE and D24, and the results keep the rules of D26.

The test DURABLE.SOUND makes random edits, new machines and changes of data, and it compares each result with a new evaluation. A mutant host that forgets each change of data gets stale results, and the test finds them. Thus the test shows that the data epoch carries the soundness.

**Next.** S1 joins `factsOf`, the reads and `durable` into one interface. S2 keeps its graph and its order for one structure epoch.

## D31 (2026-10-25): a schedule keeps named nodes under the root `world`, an edge goes to a node and keeps its field, each node of a cycle gives `#CYCLE!`, and a node on the run side is a sink

**Context.** The study R4 asks for one interface that joins `factsOf`, the reads and `durable` (S1). D3 promises each schedule the graph of the data and the side of each kind. D30 keeps a result for each key, but nothing gave the keys a graph.

R4 leaves three open questions for this item. Does each node of a cycle give `#CYCLE!`, so that each schedule gives the same error (question 3)? Does a read of `["world", "a", "x"]` depend on the node `a` or on its field `x` (question 4)? Is a run document a sink of the graph, and what starts it (question 5)?

**Decision.**

- A host gives named documents to `schedule(machine, options)`. Each document is a node. The root `world` of each node reaches the other nodes by name, and the context of the host gives the other roots.
- `edgesOf(facts)` changes each static read of `world` into an edge to the node of its first key. A read of another root reads the data of the host, thus it is not an edge.
- A read without a key after `world` has no target node. Examples are `["world"]` and a step document right after the root. Such a read can reach each node.
- `graph()` gives each node with its facts, its side and its edges. The map stays one object in one structure epoch, thus S2 can keep an order for it.
- `read(id)` evaluates a node on demand, through `durable`. A read of `world` in its document demands that node first. Each node evaluates at most one time in a data epoch.
- After a change, a pure node verifies its reads with `verifyReads`. A read of a node demands that node again, thus the verification goes down the reads in their order. This is the red-green algorithm of rustc.
- An edit, a new node, a removed node and a new machine are changes of the structure. New data of the host is a change of the data (D30).
- Each data epoch has a new host thing at the root `world`. Thus a read of the whole root changes at each change of data, and a closure that keeps the context evaluates again (READS.KEPT).
- **Granularity (question 4).** An edge goes to the node `a`, and it keeps the keys after the node as its field `["x"]`. A node evaluates as a whole, thus the graph and an order of a schedule are by node.
- The early cutoff is by field. `verifyReads` compares what the path reaches, thus a change of `a.y` evaluates `a` again, and a reader of `a.x` keeps its result.
- **Cycles (question 3).** A node is on a cycle when its demand reaches itself through the reads of the evaluations. Each node of a strongly connected component of these reads, and each node that reads itself, gives `#CYCLE!`.
- The reason of the error names only the node, and the error has no place. The document of such a node does not decide its value. Thus a lazy operation that catches the error cannot give a value that depends on the first demand.
- A read of a node in evaluation gives the same error as the final result of that node. A reader of a node on a cycle gets the error at its reference. Thus each order of demands gives the same values.
- The schedule finds the components with the algorithm of Tarjan over the demands. A finished node of an open component links its reader to that component too.
- The reads of the evaluations decide a cycle, not the static edges. A static cycle through a lazy read that the evaluation skips is not a cycle. A read after a failed part does not happen either.
- **The run side (question 5).** A node whose document is on the run side is a sink (FACTS.SIDE). A read of it gives `#REF!`, and the schedule does not evaluate it. The record of the root `world` has only the derive nodes.
- Only the host starts a run, for example at an event, with `run(id, options)`. A demand and a change of data do not start or repeat a run (L3).
- A run reads the current values of the derive nodes through the same root `world`. The edges of a node on the run side tell the host which nodes the run reads.

**Rejected.**

- The root `names` for the nodes. A kind binds names for its parts, and the host keeps its own data in the names.
- An edge for each field. The graph then grows with the data, and a node still evaluates as a whole. A step document after a field also makes the field unknown.
- An edge by node without a cutoff by field. Then each change of a node evaluates each reader of the node again.
- The chain of D16 in the reason, or the place of the reference that closed the cycle. Both depend on the first demand. D16 keeps the chain for the attributes of one tree, because one document orders their demands.
- `#CYCLE!` only for the nodes in evaluation when a read closes the cycle. A node that reads a finished node of an open component then escapes, and its value depends on the first demand. The test SCHED.CYCLE has such a component of three nodes.
- A cycle from the static edges. A read can fail or be skipped before it happens. S2 can report a static cycle, but the demand gives the value.
- A node on the run side as an effect of a signal library. Such an effect starts again after each change of its reads, thus it repeats the effects, and L3 forbids that.
- A dry evaluation of a run document as the value of its node. An evaluation does not do the effects (RUN.EVAL), thus a reader gets payloads, not outcomes. A host puts an outcome into its data.
- A push of dirty marks along the edges in this item. A reference in the value of a node can lead a read to a third node (DEREF.COLLAPSE), and no edge shows it. The verification of the reads finds it.

**Why.** The demand needs no order and no analysis of the graph, thus it is the reference schedule for S2 and S3. Each node keeps the rules of D30 and D26, and the only new rule is the rule of the cycles.

The test SCHED.ONE-MEANING has three configurations of generated graphs with five nodes. It makes random edits, new nodes, removed nodes, new machines and changes of data, and it reads the nodes in random orders. Each read gives the result of an evaluation of the whole graph from scratch.

A run of the harness compares approximately 8500 reads, and approximately 1800 of them give `#CYCLE!`. A dense configuration wires most nodes into cycles that catch errors. A rule for the nodes in evaluation only fails there, and a host that changes its data in place gets stale values.

**Limits.**

- S1d: a reference in the data of a node can lead a read to another node. The static edges do not show that read, but the reads of an evaluation do.
- S2a: a demand of a chain of nodes uses the stack of the host for each node. A chain of a few hundred nodes overflows, and the node gives `#DEPTH!` (D15).
- S1f: each node gets the same context. One formula at each cell of a grid needs its own `self` for each node.

**Next.** S2 reads `graph()`: the components, the heights for a push schedule and the nodes that an observer needs. S3a takes the harness to more schedules, and S3b gives each node a signal.

## D32 (2026-10-25): a context carries the grant of the kernel, and compiled code cannot widen it

**Context.** The study R7 found a gap in CAP.NARROW (fact 4, P2). The kernel narrows each context that a function evaluator gives a part (`narrow`). A compiled evaluator or a compiled runner gives the code of a part a context that it makes itself. Thus it can give a part more capabilities than its document has.

A probe of R7 gave a part the capabilities `log` and `write`, under a root without capabilities. The plan caused the effect `log` and gave `"hi"`, and the reference gave `#CAP!`. The code of a part is made one time, in `prepare`. Thus it does not know the context of each evaluation of its parent.

**Decision.**

- Each context that the kernel gives the code of a document carries a grant: the capabilities that the kernel gave the document. The grant is a field with a private symbol as its key (CAP.NARROW-CODE).
- A spread of a context keeps its grant. Thus compiled code passes the grant of its document on, in each context that it makes with a spread. A closure of `fn` keeps the grant of its maker (CAP.LATENT).
- At the start of each document, the kernel compares the capabilities of the context with its grant. When the two are the same list, nothing changes. Otherwise the context keeps only the capabilities that its grant permits, and it gets the grant of that list.
- The rules of a contract (D14) narrow the context after this step. Thus compiled code cannot widen what a rule `only` or `mask` gives a part.
- An effect of compiled code (`Runtime.effect` and `Runtime.runEffect`) gets the same step. Thus the code cannot widen the context of its own effect.
- A context that compiled code makes without a spread has no grant, thus it gives no capabilities. The kernel cannot know the document of such a context.
- The root gets the grant of the capabilities that the host gives. A part of a function evaluator gets the grant of the context that `narrow` gives it.
- A widening is silent. The part keeps the capabilities of its document, and an effect beyond them gives `#CAP!` at its place. The reference narrows the parts of each definition, thus it gives the same result. A trace records the narrowed capabilities.

**Rejected.**

- A view of the runtime for each evaluation of a compiled document (R7 P2, option 1). It costs one object for each evaluation of a document with parts. A runtime that wraps the runtime of the kernel (D29) also loses the view.
- A promise of the obligation C1, with a strict option of `prepare` (R7 P2, option 2). Then only a test supports the claim, and only for code that keeps the promise.
- A check in `prepare`. The capabilities come with each evaluation, thus a compilation does not know them.
- A record of the current document in the runtime. A closure evaluates its body after its maker ends. Such a record then gives the closure the capabilities of its caller, and that breaks CAP.LATENT.
- A context without a grant that keeps its capabilities. Then compiled code widens with `makeContext`, and the gap stays open.
- A grant from `makeContext` and `context`. Then each new context has a grant, and the gap stays open the same way.
- A shared key from `Symbol.for`. Only the kernel writes a grant, thus no other code needs the key.

**Why.** The grant follows each path of a context: a part, a lazy operation, a closure, an own effect and a runtime that another runtime wraps. Thus CAP.NARROW holds by construction for each form of an evaluator. The static kit and the reference stay as they are.

The cost is one comparison at the start of each document, without a new object. A new object comes only when code changes the capabilities of a context. The root also makes one when the host gives a world and no grant. A schedule gives the context of each epoch its grant one time, thus a demand makes no copy.

The change is a correction. A language whose compiled code makes each context with a spread gets the same results. Compiled code that makes the context of a part without a spread gives that part no capabilities after this change. `agree` then finds a difference from the definition of the code.

**Next.** K92 tests the obligation C1 for each evaluator of a kit. K100: a resolution of the root `caps` from compiled code reads the context that the code gives. The rule `grant` of L1a writes the grant of a part, through the rules of the contract.

## D33 (2026-10-25): the analysis of a graph of nodes has its own stack, a cycle of eager edges is certain but the demand gives the values, and a demand of the host first demands its eager edges, deepest first

**Context.** The study R4 proposes an analysis of the graph of the nodes (P5, S2). It asks for the components, the heights of a push schedule, the independent layers, the nodes that an observer needs and the static cycles. D31 gave S2 two notes. A static cycle is not certain, because a read can fail or be skipped before it occurs. An edge without a target node can reach each node.

D31 also found a limit (S2a). A demand used the stack of the host for each node of a chain. A chain of approximately 1000 nodes of the formula kit gave `#DEPTH!`.

**Decision.**

- `graph.ts` holds the analysis. A graph is a map from a name to a node with its edges and its side (`NodeGraph`). The map of `graph()` of a schedule is such a graph, thus a host gives it to the analysis with no change.
- Each function walks an indexed form of the graph with its own stack in typed arrays. Thus a chain or a ring of 100000 nodes does not overflow (GRAPH.SCC).
- `components` uses the algorithm of Tarjan. Each component comes after each component that it reads, thus the deepest component comes first.
- `heights` gives the order of a push schedule, and the nodes of one component share one height (GRAPH.ORDER). `nodeLayers` puts the nodes of each height in one layer, in linear time (GRAPH.LAYERS).
- `necessary` gives the observed nodes and each node with a path from them (GRAPH.NECESSARY).
- A node on the run side is a sink. An edge to a sink, or to a name that is not a node, is no edge of the analysis.
- An edge without a target reads each node that is not a sink (GRAPH.UNKNOWN). The index gives such an edge one extra node with an edge to each such node. Thus the cost stays linear, and the extra node adds no height.
- `cycles` gives each component with a cycle (GRAPH.CYCLE). A cycle of the eager edges with a target is certain. Such a read occurs in each evaluation in which each document around it gives a value (FACTS.LAZY).
- Each other component with a cycle is possible: it needs a lazy edge or an edge without a target. The certain cycles inside it come after it.
- A static cycle gives no value. A read can still fail before it occurs, thus the demand of D31 decides the value of each node. The test GRAPH.CYCLE has such a node.
- The option `eager` keeps only the eager edges with a target, in each function.
- **Long chains (S2a).** A demand with no node in evaluation comes from the host: from `read`, from a run or from the record of `world`. It first demands each node that the eager edges reach, deepest first (SCHED.LONG-CHAIN).
- Then each read of such a node finds its value, and the stack of the host holds one node of the chain at a time.
- The order is the post-order of a walk of the eager edges from the node, with its own stack. Each node comes after each node that it reads, as in an order by heights. The walk enters only the nodes without a value in the data epoch.
- Each demand ahead also starts with no node in evaluation. D31 gives each order of such demands the same values, thus the rule of the cycles stays exact.
- `counts.ahead` gives the count of the demands ahead, as a measure.

**Rejected.**

- Demands ahead from a node in evaluation, for example at a fixed depth. A demand ahead can then read a node in evaluation that its own demand does not reach. It gets `#CYCLE!`, while an evaluation from scratch gives a value.
- Demands ahead along the lazy edges too. The demand then evaluates a branch that the test of an `if` skips, and the demand schedule is not lazy. A chain through lazy reads stays a limit (S2b).
- The order of `heights` over the whole graph for each demand. It costs the whole graph after each change of the structure, but a demand needs only the nodes that it reaches. A post-order gives those nodes the same guarantee.
- A restart of a demand at a fixed depth, as Excel moves a cell down its chain. An evaluation then repeats, but SCHED.DEMAND says that each node evaluates at most one time in a data epoch.
- A certain cycle as the value `#CYCLE!` before a run. A read can fail before it occurs, and then the evaluation from scratch gives another value.
- An edge without a target as one edge to each node. Its cost then grows with the count of the nodes, for each such edge.
- A certain cycle through an edge without a target. The record of `world` stops at the first failed node, thus the read reaches a node only when each earlier node gives a value.
- The name `layers`. The module `order.ts` already exports `layers` for the steps of one sequence.

**Why.** The analysis needs no evaluation, thus `check`, a push schedule or a host can use it before a run. Its own stack makes each function linear and safe for a long chain, as DOC.EQUALS is safe for a deep document.

The demands ahead keep each value of D31 and each count of SCHED.STALE. The harness SCHED.ONE-MEANING agrees with an evaluation from scratch, and it counts the demands ahead. It also finds each node of `#CYCLE!` on a static cycle, unless a literal holds a reference to a node (S1d). Without the demands ahead, SCHED.LONG-CHAIN gives `#DEPTH!`.

**Limits.**

- S2b: a chain through lazy reads, or through an edge without a target, still uses the stack of the host for each node.
- S2c: a certain cycle with more nodes than the stack of the host holds gives `#DEPTH!`.
- K105: a plan of one reference keeps approximately 2.5 KB. A schedule of 100000 nodes keeps approximately 430 MB, and most of it is plans.

**Next.** S3a compares a push schedule by `heights` with the demand. S2d lets a host report the certain cycles of a schedule before a run.

## D34 (2026-10-25): the core calculus is a part of the specification, and the code decides the facts that SPEC did not state

**Context.** The study R7 sketched a calculus of the kernel, and K90 writes it as a page. R7 leaves three open questions for this item. Where does the calculus live (question 5)? Is a reference in data read in the context of its reader or of its writer (question 3)? Is the bound of the collapses for one hop or for the whole resolution (question 4)?

**Decision.**

- `docs/SEMANTICS.md` is a part of the specification, beside `docs/SPEC.md`. A change of a rule changes `SPEC.md`, the page and the reference interpreter together.
- Each inference rule names the SPEC IDs that it covers. The test SEM.RULES makes sure that each named ID is in `SPEC.md` and has a test. A rule without an ID is not possible.
- The rules are text in code blocks, not math. The linter of the prose reads math as text, and a code block keeps the alignment of the premises.
- The page writes the rules of the code as they are. The facts that SPEC did not state become IDs with tests: DEREF.COLLAPSE-LIMIT, WORLD.ALIAS-LIMIT, DEREF.READER, EVAL.BY-NAME, RUN.NEEDS-RUNNER and DEREF.NO-WALKER.
- A reference in data resolves in the context of its reader. The bound of 64 collapses is for one whole resolution, also through the paths of the references that it follows.
- EVAL.SEALED holds for code that keeps the obligation C5. RUN.SAME holds for a document that passes `check` with the option `run`.

**Rejected.**

- The calculus only in the study R7. A study records a design, and it does not change with the code. The rules then drift from the reference.
- Math with `$` in Markdown. GitHub shows it, but the linter fails, and a math block cannot carry the line of IDs that the test reads.
- New rules for the four facts, for example the context of the writer for a reference in data. The present rules have tests and users, and the calculus records the kernel. A change is a separate item with its own decision.
- A bound of collapses for each hop. Then a path with many hops can follow many more references than one hop, and the cost of a resolution has no bound.

**Why.** The reference interpreter is executable, but it is long, and it mixes the rules with the records of hops, reads and traces. A page of rules is short enough to read in one sitting, and the test keeps its IDs in step with `SPEC.md`. The page also states the obligations C1 to C7 of host code, thus each claim of the kernel names the promise that it needs.

**Limits.** The page leaves out the reasons, the hops, the trace and the reads. It covers the static kit, the types and the schedules only through their IDs. The rows K110 to K112 hold the disagreements that the work found.

## D35 (2026-10-25): a plan keeps only its data and the closures of its own code, and the code of a plan and of a compiled path is on a class

**Context.** S2a found that a plan of one reference keeps approximately 2.5 KB (K105). A schedule of 100000 nodes then keeps approximately 430 MB, and SCHED.LONG-CHAIN needs approximately 730 MB. The tests run on a shared machine with little memory, and in CI.

The loader `tsx` keeps the name of each function. That adds a list of properties to each named closure. A bundle without `keepNames` and the transform of the tests give approximately 1.5 KB.

A heap snapshot of 1000 plans of `{ "type": "ref", "value": ["world", "n1"] }` shows what one plan keeps:

- Eleven closures and nine scopes. The plan has `evaluate` and `run`. The code has `placedCode`, `runOf`, and the code of the reference with `give` and `held`. The compiled path has a resolver and `full`, and the input has two functions `fill`.
- The code of a static path and the code of a path with parts shared one scope. Thus the code of each reference kept `fill`, and through it the split and the document. The test of PLAN.LEAN examined only a literal.
- The plan, the compiled root, the compiled path, the split, and three empty lists.

**Decision.**

- A plan is an object of a class. `evaluate` and `run` are methods of the class, thus a plan keeps only its machine, its mark `traced` and the code of its root.
- A host uses `evaluate` and `run` as methods of the plan. A copy of the function without the plan has no `this`. The interface `Plan` declares both as methods, and no code of the repository makes such a copy.
- A plan makes its compiled root `root` and the steps of a run at their first use. An evaluation needs neither.
- The steps of a run of an evaluator are `runOf(code)`. The root makes them at the first `run`. A part makes them at compile time, as before.
- A compiled path is an object of a class with five fields. Its method `resolve` starts the short path at its root, thus a compiled path makes no closure.
- Both classes declare their fields with `declare`, and the constructor writes each field one time. A field that TypeScript defines as `undefined` and then writes again is not constant for V8.
- The formula kit makes `give` and `held` one time for each language. The code of a reference with a static path keeps only its compiled path, its first name and its mark `address`.
- The code of a function evaluator keeps the fill of its input, not the whole input.
- A list that grows by `push` keeps room for more items. Thus `factsOf`, `edgesOf` and the results of `durable` keep a copy of each short list, and one frozen list for each empty list.
- The test of PLAN.LEAN measures the heap over 10000 plans of bare references, after a full collection. Each plan keeps less than 600 bytes.

**Rejected.**

- A plan as closures of one scope, as before. The two methods cost two closures and a scope for each plan, approximately 170 bytes.
- The steps of a run of each part at their first use, through a getter of a class. A compiler can copy a part with a spread, and a spread does not copy a getter. The row K115 keeps the idea.
- No wrapper `placedCode` for the code of a reference. The wrapper gives the place of each error and of each exception, and it narrows the context to its grant (D32). The mark "total" of K76 removes it.
- A cache of plans by the JSON of a path. The path is the only data of such a plan. Two nodes of a schedule rarely read the same path, and the cache needs its own memory and a rule to drop entries.
- A closure for each root of a compiled path, as before. A test of the root costs a few comparisons, and one class keeps the call to `resolve` monomorphic. The bench gave mixed numbers for the closures, also 18 % slower with a list of reads.
- Fields that the class defines and the constructor writes again, as the first draft had them. The bench of CI showed a reference 4 to 12 % slower, because V8 loads such a field at each call.
- One frozen empty place for the root of each plan. `concat` takes a slow path for a frozen list, and `prepare` was approximately 10 % slower.
- A heap snapshot in the test. It writes the whole heap of the worker, and it costs much memory and time in CI. The measure of `heapUsed` gives the same number to one byte in two runs.

**Why.** The shared code is on a class or in the scope of a language. Thus each plan keeps only its own data. A host with many nodes pays for its documents, not for copies of the kernel.

The work measured a bundle without `keepNames` on Node 24, over 10000 plans:

| What | Before (bytes) | After (bytes) |
| --- | ---: | ---: |
| A plan of one reference of the formula kit | 1496 | 407 |
| A plan of one reference of the standard machine | 1312 | 849 |
| A plan of one literal of the formula kit | 717 | 358 |
| The facts of one reference | 646 | 294 |
| A node of a schedule of 100000 references, after a read | 2958 | 1230 |

The test of PLAN.LEAN measures 1521 bytes before and 401 bytes after. The peak of the worker of SCHED.LONG-CHAIN goes from 731 MB to 551 MB.

The bench of CI compares the change with `main`. The cases of a reference change by -4 % to +2.5 %, and the noise of the bench is up to 1.5 %. `prepare` is 3.5 % faster.

Each evaluation does the same work with the same values. Thus each result, error, place and read stays the same, and `agree` compares the plan with the reference.

**Next.**

- K115: each part keeps the steps of its run, approximately 96 bytes, because a compiler can copy `CompiledPart.run` with a spread.
- K116: SCHED.LONG-CHAIN still needs approximately 550 MB, and its schedule keeps approximately 120 MB of it. A study measures the garbage of the demands of a long chain.
- K76 also removes `placedCode` from the code of a reference, approximately 110 bytes for each plan.

## D36 (2026-10-25): `conforms` starts the code directly with probe parts, it compares variants for the obligations that a ban cannot state, and C8 is an obligation of the author

**Context.** The soundness claims of the kernel hold for host code that keeps the obligations C1 to C7 of `SEMANTICS.md`. Only C1 has a guard in the kernel. K92 builds the conformance tests that R7 P3 proposes, and K111 adds the obligation C8 of a profile.

**Decision.**

- `conforms(machine, name, options)` gives a list of findings. Each finding has the obligation, a reason and a probe. One finding for each obligation is enough to find the cause.
- `conforms` starts the code directly, with probe parts and a probe runtime. It does not evaluate real documents. The contract of each kind that names the code gives the probe documents.
- Each probe part gives a result from a palette of eleven values and errors, or it waits in a run. The probe runtime answers each wait and each effect at once, thus `conforms` is synchronous.
- C1 reads the context that the code gives, before the kernel narrows it. Thus it also finds a function evaluator that widens, and a context that compiled code keeps from an earlier call.
- C3 for a lazy part means: some other result of the part changes the result. C4 evaluates again with other values in each root that no resolution read, and with the same answers of `resolve`. C5 evaluates two documents whose parts have other JSON and the same results.
- C2, C3 and C4 apply only to the verb `eval`, because the facts of a contract describe only `eval` (D23).
- The check `local` evaluates each probe again in another order. The check `agree` compares compiled code with its definition, the code of `STD_DEFINITIONS` or of the option `definitions`.
- C8: a formula profile, and each table that compiled code reads, gives the same answer at each time. The author keeps it. `conforms` compares code of an earlier compilation with new code, and it reports C8 only when `local` holds.
- `conforms` throws for a name without code, and for code that no kind names without the option `types`.

**Rejected.**

- Probes through real documents and `evaluate`. The kernel narrows each context before the probe sees it. A wait needs an async run. The restriction `kinds` of a position refuses a probe kind.
- A proxy on the context for C4. The constructs `let`, `fn`, `seq` and `tree` read the names and `self` only to give them to their parts. A proxy then flags each of them.
- A ban on each read of `doc.value` for C5. The kinds `ref`, `lit`, `ext` and the steps read their data from it. Only a result that changes with the JSON of a part breaks C5.
- An asynchronous `conforms`. A probe runtime that answers each wait itself gives the same checks, and a test then needs no `await`.
- A guard in the kernel for C8. Each compilation then reads the profile again, and a plan loses the work that it did one time.

**Why.** A ban states what code must not touch, but the obligations C3 to C5 and C8 are about what the code gives. A comparison of two evaluations states exactly that. Direct calls let one probe record each call, context, resolution, effect and wait of the code.

**Limits.**

- The palette and the eight values of each shape find many faults, not all. A fault that shows only for one value of the host can stay hidden.
- K120: a context that compiled code keeps escapes the grant of the kernel. `conforms` finds it, but a plan does not refuse it.
- K121: walkers, the verb `deref` and the functions of a profile get no check. K122: the probe `all` takes its items one after the other.
- No evaluator or runner of the standard library or the formula kit broke an obligation. The results of programs do not change.

**Next.** K120 gives each evaluation its own grant. K121 extends `conforms` to walkers. K123 shows `conforms` on the site.

## D37 (2026-10-25): each law of the semantics has a property test, with its conditions in the law

**Context.** The study R7 names laws that follow from the rules (part 4). K93 tests them on generated documents and machines. A law that holds only under conditions needs those conditions in its statement. Otherwise a test finds false failures, or it tests nothing.

**Decision.**

- Each law has one ID and one property test in `laws.test.ts`: EVAL.SEALED, EVAL.DETERMINISTIC, CAP.MONOTONE, COMPOSE.CONSERVATIVE, TREE.ORDER-FREE and SEQ.LAWS. `SEMANTICS.md` names each law beside its rules.
- EVAL.SEALED changes a part that evaluates one time to a JSON value into a literal of that value. The test also has a kind whose code reads `doc.value`, and it must find that this kind breaks the law (C5).
- EVAL.DETERMINISTIC evaluates two documents in turn, with the same plan and with a new plan. Thus a state that stays from one evaluation to the next shows. An overflow of the stack of the host is the one exception (K94).
- CAP.MONOTONE compares the questions to the hook `permits`. The first question with another answer must be about the same effect, permitted by more capabilities and refused by fewer. Before it, the effects are the same. A document that reads the root `caps` is out of the law.
- COMPOSE.CONSERVATIVE uses the reads of an evaluation. A document that reads a changed entry of the world, for example the root `world`, is out of the law.
- TREE.ORDER-FREE changes the order of the fields of each node. Each document in a node gives the same result. A root and each document around it give a value in both orders, or an error in both orders. The root gives the first error in the order of its parts.
- SEQ.LAWS: the steps at the start go into a nested sequence only when only the last of them has a name. The nested sequence gets that name. A new rule `ST-SEQ` in `SEMANTICS.md` gives the meaning of `seq`.
- Each test reads `COEVAL_AGREE_COUNT` and `COEVAL_AGREE_SEED`, as the agreement harness does. CI raises the count to 2000.

**Rejected.**

- A law without its conditions, for example "fewer capabilities never change a result". A document that reads the root `caps` breaks it, and so does a document that gives the error of a refused effect.
- A flat law for each grouping of a sequence. A name of an inner step does not reach the steps after the inner sequence, thus `seq[a:x, b, c]` and `seq[seq[a:x, b], c]` differ when `c` reads `x`.
- A strict law for the root of a tree. The first error of a root depends on the order of its parts, and TREE.RESULT states this order.
- The laws inside `agree.test.ts`. The agreement harness compares tiers, and a law compares two documents or two machines. One file for each purpose keeps each failure clear.

**Why.** A law is a claim about all documents. A property test on generated documents examines many cases that no person writes. Each test counts the cases that its conditions skip, and it fails when it skips too many. A mutant of the kernel for each law shows that its test can fail.

**Limits.** The equations of effects stay with S4. The tests use the standard world, the formula language and the probe language, not each world.

## D38 (2026-10-25): a run drives a runner under an evaluator, and only a real wait fails

**Context.** K110. An evaluation drives a runner under an evaluator without a wait. A run refused that runner before it started, also when the runner did not wait. Thus `add[1, pure[2]]` gave 3 in an evaluation and `#CALC!` in a run. RUN.SAME held only for a document that passed the check of the run.

An `if` under an operation failed in a run, also when its branch that waits did not run. The test of another `if` is such a place.

**Decision.**

- Both handlers drive a runner under an evaluator with the same code (RUN.DRIVE-NESTED). In a run, its effects go to `perform`.
- When `perform` gives a promise, the wait reaches the drive. The drive gives `#CALC!` at the place of the runner, with the reason of the check. The effect gets no outcome.
- A branch that does not run does not wait. Thus an `if` whose branch with an effect is not taken gives the result of the evaluation.
- An effect of an evaluator in a run still gives `#CALC!` before the test of its capability (RUN.NEEDS-RUNNER).
- RUN.SAME holds when no evaluator causes an effect and the host answers each effect at once. A property test compares a run and an evaluation of generated documents without effects.
- With the option `run`, the check gives `#CALC!` for a runner under an evaluator only when its runners have an effect that can wait (RUN.CAN-WAIT). Such an effect reaches the host. Without capabilities, it narrows the least authority, as `effectsOf` does. Thus `pure` and a mask of a kind remove effects that cannot wait.

**Rejected.**

- Option B: keep the refusal as the rule. It keeps a second meaning for documents that do not wait, and RUN.SAME keeps a condition of the check.
- The handler of an evaluation inside the drive. Then an effect under the drive gets a mock answer in a run, and the host does not see it.
- A `#CALC!` for each effect that cannot reach a waiting parent. It refuses a host that answers at once, and that host is the usual case of a test.
- An effect of an evaluator that asks `perform` in a run, with `#CALC!` only for a promise. It is a larger change of X-NEEDS-RUNNER. K130 keeps it as a later item.

**Why.** One clause of X-NEEDS-RUNNER goes, and one drive serves both handlers. The run of a runner that really waits keeps its code, its place and its reason. RUN.SAME loses its condition of the check.

**Limits.** The check assumes C6: only a runner waits, and only for an effect. A compiled runner that calls the code of a part without a wait (K65) fails only when that part really waits.

## D40 (2026-10-25): a domain can have a codec, `ext.domain` holds its members, and `encodeValue` writes each host value as one document

**Context.** K140. A review of duplicate code found two encodings for literals that JSON cannot write. One language wrote a tagged record with the key `$vex`. The formula kit writes `ext.number` and `ext.undefined` (`STD_EXT`). Thus the same `NaN` or `-0` had two documents, and D12 broke.

A member of a domain, for example a time, had no shared document at all.

**Decision.**

- A domain can have a codec (`Domain.codec`): `encode` writes a member as JSON, and `decode` reads it again. Both are pure. `decode(encode(v))` equals `v` by `sameValue`.
- The standard extension `ext.domain` holds a member: `{ "type": ["ext", "domain"], "value": { "domain": name, "data": json } }`. The value has only these two keys.
- The evaluation reads the data through the codec of the named domain of the machine (EXT.DOMAIN). A domain without a codec gives `#NAME?`. Data that the codec cannot read gives `#VALUE!`.
- The result of `decode` must be a member of the domain, or else the evaluation gives `#VALUE!`. Thus the check of types gives `ext.domain` the type of its domain (EXT.TYPE).
- An extension gets the domains of the machine as a third argument (`ExtFn`). The input of an evaluator and of a runner holds the machine (`EvalInput.machine`). Thus the reference reads the same domains as the plan, and they agree.
- `encodeValue(machine, value)` writes a host value as a term document (EXT.ENCODE). JSON stays as it is. A literal with the shape of an envelope goes into `lit`. `NaN`, an infinity and `-0` use `ext.number`, and `undefined` uses `ext.undefined`. A member of a domain with a codec uses `ext.domain`. A list or a plain record with such a value becomes the construct `list` or `record`.
- JSON wins over each codec, thus a value that JSON writes has one document. The domains with a codec go in the order of their names. A value without a document throws a `TypeError`.
- `decodeValue(machine, doc)` evaluates the document in an empty context, with `lit` as the type of a bare root value. A property test examines the round trip (EXT.ROUNDTRIP).
- `ext.number` and `ext.undefined` do not change.

**Rejected.**

- A tagged record, for example `{ "$vex": "number" }`. It is a second form for an extension, and a literal record with that key needs an escape.
- A codec in the formula profile. The domains of the machine already name the base types, and a merge of machines merges them (D22).
- A codec for each domain of the kernel. JSON writes those members, and `ext.number` covers the numbers that JSON cannot write.
- A second parameter of `formulaDefinitions` for the domains. A host can forget it, and then the reference disagrees with the plan.
- The domain of a value by the order of the table. Two merges in another order give the same machine (WORLD.LAWS), thus the order of the names decides.

**Why.** Each language writes the same value as the same document, also a member of a domain (D12). Documents of several languages can then mix. The codec lives next to the test `is` of the domain, thus one table describes a base type.

**Limits.** Two domains with codecs that both hold a value give the document of the first name. D109 changes this rule: the lower domain comes first. A language keeps one codec for each value. `codecLaws` examines the codec laws at this time (K141, D130).

## D41 (2026-10-25): one syntax kit reads and writes the text of each language with a profile, and its printer is the default of the verb `format`

**Context.** C15. A review of duplicate code found four parsers of expressions. Each had its own tokenizer, its own table of precedence and its own type for an error. The languages were a formula language of a renderer, the formulas of a spreadsheet and a small algebra of named knobs. D13 keeps the text syntax in the language, but the machinery of a parser is the same in each.

**Decision.**

- The module `syntax.ts` holds one parser and one printer. A `SyntaxProfile` drives both: an operator table, literal rules, reference syntax and call syntax.
- An operator has a symbol, a precedence, a place (`prefix`, `infix` or `postfix`), a grouping (`left`, `right`, `none` or `flat`) and the kind of its document. A larger precedence binds more tightly.
- `parse(profile, text)` gives a document of the formula kit (D12), or issues. An issue has an offset, a length and a message (SYNTAX.SPAN). `parse` does not throw for a bad text.
- A literal that JSON cannot write uses `ext.number` and `ext.undefined` through `encodeValue` (D40). A minus sign right before a digit, where a term starts, belongs to the number.
- A bare name is a path from one root, `names` by default. A root of the profile starts a path, for example `self.price`. A pattern gives other references, for example `A1`.
- A call `name(args)` applies `ops.name`. A call form makes a construct, for example `if(test, then, else)`. A profile can limit the names of the calls.
- `print(profile, doc)` writes the fewest parentheses that keep the tree. A document without a text form gives `#VALUE!` at its place. `parse(print(doc))` gives `doc` again (SYNTAX.ROUNDTRIP). A property test examines generated documents of three profiles.
- `syntaxFormat(profile)` is a part of a merge. It adds the verb `format` as the default of the world, with the printer as its code (D23). Each part gives its text through the ladder, thus an own entry or a kind entry of `format` still wins.
- `STD_SYNTAX` is the standard profile of the formula kit, for the site and the playground. The tests hold a profile like a spreadsheet and a profile like the algebra (SYNTAX.PROFILE).
- The syntax profile is a separate value, next to the `FormulaProfile` and not inside it.

**Rejected.**

- A key `syntax` in `FormulaProfile`. The formula profile holds the code of the evaluation, and the syntax profile is data for a reader. One language can have two syntaxes, for example with another separator, and one evaluation. A site can read a syntax without the code of the operations.
- An operator that names a function. The parser makes documents, and the evaluation stays in the formula kit (D13).
- A printer that keeps the parentheses of the source. The printer gives one canonical text for each document, thus two texts of the same tree give the same output.
- The verb `format` in the kernel. The kernel stays without a verb of its own, and a language adds it with a merge, as VERB.FORMAT shows.
- One symbol as an infix and a postfix operator, and two groupings at one precedence. The parser then has two readings, thus the profile throws a `TypeError`.

**Why.** One parser gives one set of tests for the tokenizer, the precedence and the spans. A language writes only its table. The printer and the parser read the same table, thus the round trip holds for each profile.

**Limits.** `parse` stops at the first issue (K144). `STD_SYNTAX` has no text form for `let`, `fn`, `call` and `record` (K145). A literal of a domain has no rule yet (K143).

## D42 (2026-10-26): a kind gives equations in its contract `tree`, and a ladder of five rungs finds each attribute

**Context.** In the decorated tree of D16, each attribute of a node is a part of the node. Thus each document of a layout repeats the same rules in each node. A column and a row cannot place the same child kind in different positions. An inherited value, for example a theme, needs a reference in each level.

Attribute grammars give equations on the kinds and a ladder of defaults. L2b takes them up, from R3 P2.

**Decision.**

- A kind has an optional contract field `tree`, with three tables. `equations` gives the attributes of a node of the kind. `down` gives the attributes of each child. `attributes` declares an attribute with `copy`, a `fold` or a `default`.
- A step to an attribute visits five rungs in this order: the own part, the kind (`tree.equations`), the parent (`tree.down` of the kind of the parent), the copy, and the default. The first rung that answers gives the attribute (TREE.LADDER).
- Each equation is a document, also a `unit`, a `combine` and a `default`. A bare value gets the type `of` of the parts of the kind, through `equationType`.
- An equation evaluates with the node as `self`, without capabilities and without the names of the document. An equation of `down` evaluates with the parent as `self`, and it sees the names `child`, `index` and `prev` (TREE.DOWN).
- `index` is the position of the child in the list `children` of the parent, by identity. A child outside that list has the index `null`.
- An attribute declared `copy` gives the full ladder of the same attribute of the parent. A root has no parent, thus its default answers (TREE.COPY).
- A `fold` starts from its `unit`. Its term `combine` adds the attribute of each node of the tree in `children`, with the names `acc` and `item`. A value that is not a node does not count (TREE.FOLD).
- When no rung answers, the step gives `#N/A`. The JSON of a node still holds only its parts.
- The equations of a kind compile one time for each machine and each type, through a cached `planner`. The plan of a document holds none of them, thus PLAN.LEAN (D35) and PLAN.CACHE hold (TREE.PLAN).
- `check` examines the equations of each kind one time, each with the names of its rung. Each issue gets the place of the first document of the kind, and its reason names the equation (TREE.DOWN-NAMES).
- `attributeTrace(node, attribute)` gives the rungs that a demand visited and the rung that answered (TREE.RUNGS). The reference interpreter has its own ladder, and `agree` compares both (D15).

**Rejected.**

- A new evaluator `tree.attr`, as R3 P2 proposed. The evaluator `tree.node` of D16 already holds the memo, the cycle chain and the errors. The ladder extends it, and the standard kinds keep their behavior.
- The declarations in the spec of a tree kit, as R3 P2 proposed. D14 keeps each rule of a kind in the kind, thus the declarations go into the contract of the kind. This answers the open question 4 of R3.
- A name of an operation in `fold`, as in R3 (`fold.op`). The kernel has no table of operations (D13), thus `combine` is a term.
- A field `dir` for each attribute. No code reads it before L2d, thus it waits for L2d.
- `index` and `prev` as structural steps of a node. D16 keeps only `parent` and `type` as steps, thus they are names of `down`.
- A kernel table `RUNGS` in each result, as the open question 3 of R3 asked. The record of the rungs is a function of the tree kit, and the trace of the kernel stays the same.

**Why.** A kind gives its rules one time, and each document gives only its own values. A column and a row give positions to children of any kind. The ladder has a fixed order, thus a reader knows which rung wins. An equation without capabilities keeps each attribute pure (TREE.PURE), and `check` finds an effect before a run.

**Limits.** An equation evaluates in its own session, thus the record of a traced plan does not show the reads of an equation. The parts of a node still get `unknown` roots for the type pass (K74). Memo cells between evaluations wait for L2c.

## D43 (2026-10-26): a plan can share result values, and a closed pure part folds into one frozen value

**Context.** A plan evaluates a document many times. A closed pure part, for example a record of literals, gives the same result at each evaluation, but the plan builds it again each time. The study R1 (P3) proposes to evaluate such a part one time, when the plan compiles. Then each evaluation gets the same object. A host that changes that object in place changes the result of each later evaluation. Thus the kernel must decide if a plan can share a result between evaluations.

**Decision.**

- A plan can give one result object to many evaluations (PLAN.SHARED). A host must not change a result in place.
- A part of a plan without a trace folds when it is closed and pure (PLAN.FOLD). A closed part reads no name that it does not bind (STATIC.REFS). A reference is the only document that reads a name.
- A pure part has only code that the facts of D24 mark pure and not volatile. Its kind declares no effect and no run side, and its code is not a runner. The plan reads the facts as `factsOf` reads them, also through the hook `facts`.
- In the formula kit, `lit`, `record`, `list`, `let`, `if`, `and`, `or`, `call`, `ref` and `fn` are pure, as D24 marks them. A standard `ext` is pure. An operation is pure only when the profile names it, and the default is none.
- A folded part evaluates one time in `prepare`, with an empty context and a probe runtime. The probe resolves only the names that the part binds. Traps for `self`, `event` and `names` refuse a direct read of these roots.
- These cancel the fold: a read of another root or of reference data, an effect, a kept context and an exception. `#DEPTH!` and a result that is not plain data also cancel it. Thus `ref` alone, a closure of `fn` and a profile `ext` do not fold.
- The fold copies the result, and it freezes each object of the copy with `Object.freeze`. The copy keeps the field `__proto__` as data, and it uses each object of an earlier fold again. The document of the host does not change.
- A folded part that reads its own names evaluates again when its evaluation records reads, thus the list of reads stays the same (READS.RECORD).
- The option `fold: false` of `prepare` stops the folds. The reference interpreter does not fold. `agree` has the tier `folds`: the plan with the other choice of folds. With the option `observe`, the plan of `agree` does not fold, because a fold moves the calls of the host to the compilation.

**Rejected.**

- A freeze of the result in place, without a copy. A literal gives the value of its document, thus the freeze changes the document of the host.
- A new copy of the folded value at each evaluation. The copy costs as much as the evaluation, thus the fold gains nothing.
- A new field of the contract for the fold. D24 already has the fact `pure`, and `factsOf` reads it. A second mark can disagree with the first.
- A fold of only the parts that each evaluation reaches. A part in a lazy branch, for example a branch of `if`, then does not fold.
- A static test of purity only, without the probe. A kind can read its context outside `resolve`, as the tree node read `self` before K149. The probe finds this, and the fold does not happen.

**Why.** A closed pure part has one result in each context, thus one evaluation is sufficient. In strict code, a change in place of a frozen value is an error, and not a silent change of later results. The probe is a safety net for code that does not keep C4.

**Limits.** A part in a branch that no evaluation takes still evaluates one time, when the plan compiles. A slow or endless pure operation there makes the compilation slow or endless. A pure operation can give a host function, and a call of it can then read the context. The plan then does not fold the call, because the function is not plain data. A result that is not plain data, for example a host thing or an instance of a class, does not fold.

## D44 (2026-10-26): the tree node resolves `self`, and a kind declares the roots that its code resolves as a whole

**Context.** The kinds `panel` and `box` have the mark `pure`, but their code `tree.node` read `context.self` directly. This breaks C4. The list of reads did not hold the read, thus `verifyReads` found no change of `self`. A nested evaluation inside an open tree then got a stale result: a node in place of the JSON of a new tree. The static facts of D24 hold only the reads of references. Thus a resolution of `self` by the code of a kind has no covering static read, and FACTS.SOUND fails.

**Decision.**

- The tree node resolves the path `["self"]` through `resolve`, without hops, in the plan and in the reference (TREE.SELF). It reads no root of the context directly.
- The contract of a kind gets the optional field `reads`: the roots that its code resolves as a whole. The hook `facts` can give the roots too, and its answer wins.
- `factsOf` gives an exact read of each declared root at the place of each document of the kind (FACTS.KIND-READS). The path of the read is the root alone. The lazy mark of the way applies.
- `panel` and `box` declare `reads: ["self"]`. They stay pure.
- A free read of the whole root `self` takes the place of a kept read of `self` in the list of reads (READS.KEPT).
- A machine that closes the root `self` makes each node the root of a new tree. The JSON of each tree stays the same.
- A tree still does not fold. The probe of D43 refuses the resolution of `self`, as its trap refused the direct read before.

**Rejected.**

- Removal of the mark `pure` from `panel` and `box`. Each document with a tree is then not pure, and a durable host does not use its result again. The checks of C4 and READS.SOUND then do not examine trees.
- A separate channel for the open tree, in place of `self`. The parent step of a node gives `self`, thus the node reads `self` in each case.
- A hook `facts` on `STD_MACHINE` for `tree.node`. Each machine that uses the standard kinds without that hook then gives facts without the read. The contract goes with the kind.
- A kept read of `self` next to the free read of `self`. The two reads hold the same path, thus the second read adds nothing.

**Why.** A read through `resolve` goes into the list of reads, into the static facts and into the checks of the probe. Thus the existing proofs of reads and facts cover the tree with no special rule.

**Limits.** Each evaluation of a tree records a read of the whole root `self`. A durable host then verifies or evaluates a tree again after each change of `self`, also of a field that the tree does not read.

## D45 (2026-10-27): `checkWorld` takes the machine and the verbs, and it gives one `#NOEVAL` for each kind and verb

**Context.** R6 P5 asks for a check of verb coverage before a document exists. A language declares the verbs that each of its kinds must answer. The world has no field for these verbs, and a language is not a type of the kernel. Thus the design calls are the name, the place of the list of verbs and the shape of the result.

**Decision.**

- The function is `checkWorld(machine, verbs)` in `static.ts`, next to `check` and `typeCheck` (STATIC.COVERAGE). The name says that it checks the world, not a document.
- It takes a machine, as `check` does, and it reads only `machine.world` today. K52 checks the value types of a machine before a document exists, and it can use the same function.
- The list of verbs is an argument. The language that calls the check owns its verbs, thus the world does not get a new field.
- The result is a list of `WorldIssue`: one issue for each kind and verb. An issue has the code `#NOEVAL`, the keys of the kind, the verb and a reason. A document of such a kind gives the same code in `check` with that verb.
- A fallback kind of a namespace or of the world has the keys of its namespace and the mark `fallback: true`. The check does not follow an alias, because the kind of the alias has its own place.
- An entry or a default covers a verb. The check does not ask if the machine has code for the name of the entry.

**Rejected.**

- A field `verbs` of the world. Two languages with different verbs then cannot share one world, and the merge of K32 then needs a rule for the field.
- One record for each kind with a list of its missing verbs. One issue for each verb is the shape of `check`, and a host filters it by verb.
- The type `Issue` of `check`. Its `place` is a path through the parts of a document, not a path of the world.
- A test of the code of each entry. The code of `eval` is in `evaluators`, and the code of `step` and `deref` is in other tables. A host can draw a verb, for example `view`, with no code of the machine.

**Why.** The static answers to the expression problem prove coverage with types. This check gives one world the same proof, with only the data of the world.

**Limits.** An entry that names an evaluator without code passes `checkWorld`, and `check` finds it at a document. A kind that an alias names is checked only at its own place.

## D46 (2026-10-27): equal profiles give the same evaluators and hooks of the formula kit, through a cache of the canonical form

**Context.** K41 comes from K34 (COMPOSE.UNIFY). Two languages that each call `formulaMachine` with one profile did not merge. Each call made new evaluator functions, and the merge compares code by identity (D17). Thus each of the 13 evaluator names of the kit was a conflict. The design calls are where the merge finds the equality, what makes two profiles equal, and how much memory the answer keeps.

**Decision.**

- The kit shares its code. The merge does not change: a function is still equal only to itself. `formulaEvaluators`, `formulaKnown`, `formulaFacts` and `formulaMachine` give the same evaluator objects and the same hooks for equal profiles.
- The canonical form of a profile is a frozen record of the 13 fields that the kit reads. A field with the value `undefined` is absent. The field `otherwise` is present when the profile has it as an own key, because the kit reads it so. A list is a frozen copy. Each other value stays the same object.
- Two canonical forms are equal when they have the same keys and each value is the same by `Object.is`. Two lists are equal by their items. A function, a record of operations and a host value are equal only to themselves. Thus two profiles that differ in their behavior do not share a kit.
- The kit makes its code from the canonical form, not from the profile object. A later change of a field of the profile object gives a new kit at the next call. A machine made before keeps its kit.
- A `WeakMap` keeps the kit of each profile object. A kit goes when its profile object goes. A list of the 16 most recent kits serves a profile in a new object with equal fields.
- Each evaluator object of the kit is frozen, because many machines share it. `formulaEvaluators` gives a new record on each call.

**Rejected.**

- A merge that compares two evaluators by their source text or by a mark of the kit. Two closures with the same text can hold different profiles, and the merge then joins code that differs.
- A deep comparison of the records of a profile, for example `ops`. A record can change in place after the call, and the code reads it at each call. The identity of the record is the safe key.
- A key that is a JSON text of the profile. A function and a host value have no JSON form, and two different functions then give one key.
- A cache without a bound. A long session that makes a new profile for each document then keeps each kit.
- A language format that composes profiles. It needs the format of K37, and the same identity question stays for its result.

**Why.** The equality stays at one place, the merge, with one rule (D17). The kit only stops making new code for a profile that it already served. The bound keeps the memory small, and the identity keys keep the merge sound.

**Limits.** Two profiles in two objects with equal fields share a kit only while the first kit is one of the 16 most recent kits. Else their machines conflict, as before. A host that keeps one profile object, or one machine of the kit, always gets one kit. Two records of operations with the same functions are two different profiles. A caller that compared the evaluators of two calls by identity sees a change: they are the same objects after this decision.

## D47 (2026-10-28): a profile names its pure extensions in the new field `pureExt`

**Context.** K13 (D43) folds a closed pure part. A standard extension, for example `ext.number`, folds. An extension of a formula profile does not fold at any time, because the facts of the kit mark it not pure. The profile names its pure operations in `pure`, but it cannot name a pure extension. The design calls are the place of the mark, its shape, and the trust in it.

**Decision.**

- A formula profile gets the optional field `pureExt`: a list of names of its extensions. The default is an empty list.
- The hook `facts` of the kit marks an extension of the profile pure when `pureExt` names it (FACTS.PROFILE). Else the extension stays not pure, as before.
- A standard extension stays pure without a name. A name in `pureExt` that the profile does not have in `ext` has no effect.
- Thus a closed part with a marked extension folds (PLAN.FOLD). The rules of D43 do not change. A plan with a trace, the option `fold: false` and the reference do not fold. The probe still refuses a direct read of `self`, `event` and `names`.
- `pureExt` is one of the fields of the canonical form of D46, thus 14 fields. Two profiles that differ only in `pureExt` get two kits.
- This changes the bullet of D43 that says that a profile `ext` does not fold. A profile `ext` without the mark still does not fold.

**Rejected.**

- Names of extensions in the existing field `pure`. An operation and an extension can have the same name, for example `ops.date` and `ext.date`. One name then marks both.
- Qualified names, for example `ext.date`, in `pure`. The name of an operation can have dots, thus `ops.ext.date` has the name `ext.date` too.
- The mark `pure: true` for the extensions too. Then the facts of a profile with `pure: true` change. A part with an extension of it that reads the context folds to a wrong value. This is a break of the existing profiles.
- The value `true` for `pureExt`. An extension gets the context, unlike an operation. Thus each pure extension must be a separate promise of the author. A blanket mark makes a later extension pure without a review.
- No mark at all. Then an extension of a language does not fold at any time, also when it only decodes its data, as `ext.number` does.

**Why.** An operation gets only the values of its arguments, but an extension gets the context. The mark is a promise of the author that the extension keeps C4, as the mark `pure` of a kind is. A separate field keeps the two namespaces apart, and the default keeps each existing profile as it was.

**Limits.** The kit trusts the mark. The probe of the fold catches a direct read of a field of `self`, `event` or `names`. But a copy of the names reads no field of the trap. Thus a marked extension that counts the names folds to a wrong value. Such an extension breaks C4, and the facts of D24 are then not sound for it too.

## D48 (2026-10-28): the kernel gets the base type `undefined`, and `ext.undefined` gives it

**Context.** K49, from K23 (D22). The standard extension `ext.undefined` gives the value `undefined`, but the kernel had no base type for it. Thus `typeCheck` gave `ext.undefined` the type `unknown`, and a check let it go to each position. An `otherwise` of `undefined` also gave `unknown`. A contract with the text `undefined` got the issue that the machine has no domain `undefined`. The design calls are the name of the type, its place among the types, and its relation to JSON.

**Decision.**

- `STD_DOMAINS` gets the domain `undefined`. Its test accepts only `undefined`. It has no parents, no steps and no codec. Thus the kernel has seven base types, and five of them are domains (TYPE.BASE).
- The type rule of `ext.undefined` gives `undefined`. An extension `undefined` in the own `ext` of a profile still gives `unknown`, as each own extension does.
- A value `undefined` of a profile gives `undefined`. Thus an `if` without `else` and with an `otherwise` of `undefined` gives the join of its branch and `undefined`.
- `typeFromSamples` gives `undefined` for a sample `undefined`, also for a field and for a hole of a list (TYPE.SAMPLES).
- A parameter at the end of a signature is optional when `undefined` is a member of its type. This rule holds the old rule for `unknown`, and it adds `undefined` and each union with it (TYPE.SIGNATURE).
- `fits`, `join`, `member` and `typeText` need no new rule. `undefined` fits itself, each parent and each union with it. No other base type fits it, and it fits no other base type. A language can put a domain under `undefined`.
- The type only names the value. The value stays outside JSON. The codec writes `undefined` as `ext.undefined` before it tries a domain codec, as before (D40). The envelope, the durable records and the fold of D43 keep their treatment of `undefined`, because the type changes no evaluation.

**Rejected.**

- The name `void`. In TypeScript, `void` is a result that the caller ignores, and a function type with `void` accepts other results. The kernel type holds exactly one value, as `null` does.
- The names `missing` and `absent`. The kernel keeps a field that holds `undefined` apart from a missing field (D21). The optional fields of a record tell the absence, and the type names the value.
- `undefined` as a value of `one`. A value type is a JSON term, and `one` compares JSON values. JSON cannot write `undefined`.
- One type `nullish` for `null` and `undefined`. The two values have different documents, and `{ "union": ["null", "undefined"] }` already holds both.
- An optional field that also holds `undefined`, as TypeScript reads it without `exactOptionalPropertyTypes`. Then `{ "a": undefined }` and `{}` are members of the same field types, against D21. A record type can give the field the type `undefined` or a union with it.

**Why.** The name of the type is the name of its one value, as for `null`, and the name of the extension `ext.undefined`. `typeText` then gives `number | undefined`, as TypeScript writes it. A domain in `STD_DOMAINS` is the existing way to add a base type. Thus the merge, the restriction and `fits` serve it with no new rule.

**Limits.** After this change, a language with its own domain `undefined` and another test gets a merge conflict with the kit. It must name `["domains", "undefined"]` in `replaces`. A check with types gives a new `#TYPE!` where a document gives `ext.undefined` to a position of another type. Before, `unknown` hid it. A step into a member of `undefined` gives `unknown`, as a step into `null` does, although the run fails there.

## D49 (2026-10-28): a contract declares the effects of the other verbs in the new field `verbEffects`, and `check` tests them

**Context.** K56, from K33 (D23). The field `effects` of a contract tells what the verb `eval` causes. Thus `check` tested the declared effects only for `eval` (VERB.CHECK). For another verb, `check` gave no `#CAP!` and no `#CALC!` for an effect. Such an effect met its test only in a run (RUN.CAP).

D23 put off a contract that declares the effects of each verb. The design calls are the place of the declaration, the treatment of a verb without a declaration, and the rule of a run.

**Decision.**

- A kind gets the optional field `verbEffects`: the effects of each verb other than `eval`, by verb. Each entry has the form of `effects`: a list of the kinds of the effects, or the text `"type"`. For example, `verbEffects: { view: [], say: ["log"] }` declares no effect for `view` and the effect `log` for `say` (VERB.EFFECTS).
- The field `effects` stays the one declaration of `eval`. The type `VerbEffects` has no entry `eval`, thus TypeScript refuses a second declaration of `eval`.
- The function `effectsOfVerb(kind, verb)` gives the declaration of a verb. It gives `undefined` for a verb other than `eval` without an entry. `check` and `conforms` read the declarations with it.
- `check` with a verb tests each effect that the contract declares for that verb, with the same rules and the same issues as for `eval`. An effect that the capabilities of its document do not permit gives `#CAP!`. A kind around the document narrows the capabilities, and the reason names that kind. With the option `run`, an evaluator that declares an effect for the verb gives `#CALC!`. A runner waits only for an effect that can reach the host (RUN.CAN-WAIT).
- A verb without an entry has no declaration. `check` then gives no effect issue for it, as before this decision. With the option `run`, a runner of such a verb can still wait, as before.
- `conforms` checks C2 for each verb that the contract declares effects for. For a verb other than `eval`, the entry of the verb is the declaration. C3 and C4 still apply only to `eval`, because `pure` and `lazy` describe `eval`.
- A run does not read the declarations, for `eval` or for another verb. A run refuses an effect only when the capabilities of its context do not permit it (RUN.CAP). The reference interpreter follows the same rule from the spec, thus `agree` does not change.
- `checkWorld` (D45) does not read the declarations. `factsOf` and `effectsOf` still read only `effects`. Facts for each verb are K55.

**Rejected.**

- A record form of the field `effects`, for example `effects: { eval: ["write"], view: [] }`. The type of a public field then changes, and each reader of `effects` breaks. `factsOf`, `effectsOf`, `checkLatent` and a host read the field as a list.
- An entry `eval` in `verbEffects`. Two declarations of one verb can differ, and one of them then has no reader.
- No effect for a verb without an entry. A verb `say` of the tests causes an effect at each document. With that default, `check` passes a document whose run fails with `#CAP!`. The absence of a declaration says nothing, as it does in a run.
- A refusal in a run of an effect that the contract does not declare. The kernel does not do this for `eval`, and a run of each verb keeps one rule. `conforms` finds code that breaks its declaration (C2).

**Why.** A new optional field keeps each existing contract, each reader of `effects` and each result of `check`. One function gives the declaration of each verb, thus `check` and `conforms` agree. The same issues for each verb let a host read the result of `check` with one rule.

**Limits.** A verb without an entry still meets the test of its effects only in a run. `effectsOf` gives the effects of `eval` only, thus a host cannot yet ask for the least authority of another verb. A merge of two worlds replaces a whole kind, thus a language cannot add an entry of `verbEffects` to a foreign kind before K35.

## D50 (2026-10-28): the kits of the kernel mark compiled code that cannot fail, and a plan does not wrap that code

**Context.** K76, from K12 (R1 P2). `compileNode` wraps the code of each evaluator in `placedCode`. The wrapper narrows the context to its grant (CAP.NARROW-CODE), catches an exception and gives an error its place. The code of a literal gives one fixed value, thus the wrapper does no work for it, and a literal costs two calls. The design calls are the form of the mark, who can set it and which code gets it.

**Decision.**

- The kernel keeps a private set of the compiled code that cannot fail. The internal function `totalCode` adds code to the set and gives the same code (PLAN.TOTAL).
- Marked code gives a value and throws nothing. It does not read its context or its runtime.
- `compileNode` does not wrap marked code in `placedCode`. A trace still wraps the code, and a fold still replaces it.
- The formula kit marks the code of `lit` and of a step document without parts (`formula.step`). Each one gives a value that it made in `prepare`.
- The package does not export `totalCode`, and a contract or a compiled evaluator has no field for the mark.

**Rejected.**

- A field `total` on `CompiledEvaluator`. A host could then mark code that reads its context, and that code gets a context without the grant of the kernel. Thus compiled code could widen the capabilities of a part again (D32). A mark of an evaluator also covers all of its code. A compiler can give code that fails for one document, and code that cannot fail for another.
- A mark on more code of the kit, for example a reference or a record of literals. A reference can fail. A record of parts calls code that can fail, and a fold already gives one value for a closed pure record (PLAN.FOLD).

**Why.** A private set keeps the public API and each guarantee of the grant. The plan reads the set one time in `prepare`, thus an evaluation pays nothing for the test. A test gives a failing sibling of a literal and finds the same error and place.

**Limits.** A host compiler that gives a constant still gets the wrapper. A plan with folds already gives one value for a closed literal. Thus the gain shows in a plan without folds, in a trace and in a fold at compile time.

**Measured (K151).** The bench case of a record of 20 literals without folds is 9% to 13% faster. The same record with folds is approximately 6% slower (15.7 to 16.9 ns, A/A noise below 1%, measured after the other cases in one process (before K210)). Four comparisons in the bench of CI found the cause in the mark of the literal code in `formula.ts`.

The folded code of each evaluation is the same `() => value`, thus the cost comes from the feedback of the JIT in the process. A plan with folds pays approximately 1.5 ns for each evaluation. A plan that evaluates a literal saves approximately 6 ns for each literal. These times were measured after the other cases in one process (before K210). The kernel keeps the mark.

## D51 (2026-10-28): `#CYCLE!` keeps its code, and its reason tells a cycle from a chain that is longer than the bound

**Context.** K112, from K90 (D34). One resolution follows at most 64 references (DEREF.COLLAPSE-LIMIT), and one lookup follows at most 32 aliases (WORLD.ALIAS-LIMIT). At the bound, a resolution gave `#CYCLE!` with the reason "The references form a cycle.", and a lookup gave the reason `cycle`. A long chain without a cycle got the same reason. The design calls are the code of the error, the test for a real cycle and the reason of the lookup.

**Decision.**

- The code stays `#CYCLE!` for each case. A long chain and a cycle both stop the resolution, and a host that tests the code does not change.
- A resolution keeps the references whose paths are in evaluation. A reference that comes again in that list closes a cycle, and the reason stays "The references form a cycle." (DEREF.CHAIN-REASON).
- A resolution that reaches the bound without such a cycle gives the reason "The path follows more than 64 references. One resolution follows at most 64.".
- A lookup keeps each path before an alias. The same path again gives the reason `cycle`. More than 32 aliases without such a path gives the new reason `too-long`.
- The plan and the reference interpreter resolve each path with the same function `resolve`, thus the two give the same reason.

**Rejected.**

- A new code for a long chain, for example `#DEPTH!`. Each host that tests `#CYCLE!` then breaks, and the code tells nothing more than the reason.
- A test of a cycle by the value of a reference, not by its identity. A walker or a host thing can give a new reference with an equal value. A real cycle of such references then reaches the bound, and the reason of the bound is true for it.
- No test of a cycle, with a reason that says "a cycle or a long chain". The test costs one list, only for a path that reaches a reference, and the reason is then exact.

**Why.** A reason that names the bound tells the writer of a document to make the chain shorter, not to look for a cycle. The evaluation of a path is a function of the path and the context, thus a reference in its own evaluation is always a cycle. The code and the bounds do not change.

**Limits.** A cycle of more than 64 references, or of references that a walker makes again at each step, gets the reason of the bound. An alias that adds a key to its own path makes a new path at each step, thus it gets `too-long`. The type `Lookup` has one more reason, and a host that tests each reason sees it.

## D52 (2026-10-28): compiled code reads the root `caps` through the grant, with the meet of the context and its grant

**Context.** K100, from K91 (D32). Compiled code can resolve a path in a context that it makes, through `Runtime.resolve`. A resolution of the root `caps` read the capabilities of that context, also of a context that the code widened. Such a list permits no effect, because each part and each effect keeps only its grant (CAP.NARROW-CODE). But its value differed from the reference, whose definitions resolve each path in the context of the document.

The design calls are the list that a read gives and the paths that get the step.

**Decision.**

- A resolution of the root `caps` through the runtime reads the capabilities that both the context and its grant permit. This list is the meet `intersectCaps` of the two lists (CAP.CAPS-GRANT).
- A context whose grant is its own list stays the same object, thus each context of the kernel pays one comparison. A context without a grant reads no capabilities, as D32 gives such a context no capabilities.
- A context that the code widened reads the list of its grant, with the same items in the same order. Thus the plan and the reference give the same value. A context that the code narrowed reads its own list.
- `Runtime.resolve` and the resolution of a compiled path both take the step. A path from another root does not change.

**Rejected.**

- The grant itself as the value of the read. A context that the code narrowed then reads more capabilities than it has, and a read then disagrees with each effect of that context.
- The step of a part, the list of the context that its grant permits (H-GRANT). For a grant `[["log"]]` under a wider list `["log", "write"]`, that list is `["log"]`. Its items come from the wider list, thus the value differs from the reference.
- The step for each root. Only the root `caps` reads the capabilities, and a resolution of another root then pays for nothing.

**Why.** The meet is the most that the context and its grant both permit. It keeps a narrowed list, and it gives back the list of the document for a widened one. The step costs one test of the root, and a new object only for a context that the code changed.

**Limits.** A walker of a step document still gets the context that the code gives, and it can read its capabilities directly. A part of a widened context gets the items of the wider list that its grant permits (H-GRANT). Thus its read of the root `caps` can have another form than a direct read, with the same permissions. D53 closes both limits with the meet for each part, effect and resolution.

## D53 (2026-10-28): the meet narrows each part, each effect and each resolution, for function code and for compiled code

**Context.** K152, from K100 (D52). The kernel narrowed the context of a part with a filter (H-CONTEXT, H-GRANT). The part kept only the items of its list that the parent permits. An effect of compiled code got the same filter against its grant.

A filter is coarser than the meet of D52. Under the document `["log.a"]`, code that gives the list `["log"]` kept no capability, thus an effect `log.a` gave `#CAP!`.

The reference causes the own effects of a definition in the context of the document, thus it permitted that effect. A walker of a step document also got the context that compiled code widened, and it read the wider list.

The design calls are the rule that narrows, the code that gets it and the cost for each part.

**Decision.**

- A context that code gives a part, an effect or a resolution keeps the meet `intersectCaps` with its document (CAP.MEET). This meet replaces the filter in `narrow`, in the grant step of compiled code, in the probe runtime of `conforms` and in the reference.
- A list that the document permits stays the same object. Thus a context that the code narrowed keeps its own list, and the function `narrow` gives the same object as before for it.
- A resolution of compiled code, of each root, starts in the context that the grant permits. Thus a walker of a step document and a read of the root `caps` get the capabilities of the document from a widened context.
- The rules of a contract apply after this step, as before. They already used the meet (CAP.ONLY).

**Rejected.**

- The meet only for an effect of compiled code. A part and an effect then narrow by two rules. A part of compiled code then disagrees with an own effect of the same document.
- The meet for compiled code, with the filter for function code. The reference narrows a part of a definition with the rule of function code. Thus a part of compiled code then disagrees with the reference.
- The grant itself as the context of a walker. A context that the code narrowed then gives a walker more capabilities than it has.
- A test of each step of a path for a step document before the step of the grant. A context whose grant is its own list already costs one comparison, thus the test saves nothing for the contexts of the kernel.

**Why.** The meet is the most that both lists permit, and a rule `only` already uses it. Thus one rule narrows each context, and code cannot widen what a part can do (CAP.NARROW-CODE). The filter gave a subset of the meet, thus the change only permits effects that both the code and the document permit.

The cost stays one comparison for a context whose grant is its own list, without a new object. A context that the code changed costs one meet, and a new object only when the meet differs from its list. The change is a correction, but a result changes for code that widens to a coarser capability. An effect that gave `#CAP!` starts after the change, and a part or a walker reads another list.

**Limits.** A context that compiled code keeps from an earlier evaluation still escapes the grant (K120).

## D54 (2026-10-28): a grant has the epoch of its evaluation, and a context of another epoch has no grant

**Context.** K120, from K92 (D36). A context carries the grant of the kernel (D32). Compiled code can keep a context from one evaluation and give it to a part or an effect in a later evaluation. The kept context carried its own grant, thus the later evaluation caused the effects of the earlier one, also with fewer capabilities.

The reference has no such context, because its definitions cause each effect in the context of the document. `conforms` found such code (C1), but a plan did not refuse it.

The design calls are the mark of an evaluation, the rule for a context of another evaluation and the cost for each part.

**Decision.**

- Each grant has an epoch: the list of capabilities that the host gave the root of its evaluation (CAP.NARROW-KEPT). The epoch is a field with a private symbol as its key, next to the grant. A spread of a context keeps it.
- `rootContext` gives the root the epoch of the list of the host. A root of that list stays the same object. Thus a schedule makes no copy for a demand.
- An effect and a resolution through the runtime compare the epoch of the context with the epoch of the evaluation. A context of another epoch reads as a context without a grant: it has no capabilities (D32). Thus its effect gives `#CAP!`, and its read of the root `caps` gives `[]`.
- A part of a function evaluator gets the epoch of its document, because `narrow` keeps only what the document permits. Thus function code narrows a kept context to its document, as the reference does.
- The reference does not change. A closure keeps the runtime of its maker, thus it keeps its grant (CAP.LATENT).
- `conforms` keeps C1 as a report. The kernel refuses a context of another epoch. But a context that the code keeps inside one epoch still escapes the meet with its document.

**Rejected.**

- The meet of a kept context with the list of the current root. A kept context can come from another document, for example from outside a rule `mask`. The meet with the root then gives a part more capabilities than its document has.
- The session as the epoch. Each evaluation then needs a new root object, also for a schedule that gives one context to each demand.
- A check at the start of each document. Only the session knows its epoch, and a runtime that wraps the session (D29) does not give it. A part with a kept context reaches the session at each effect and each resolution.
- An epoch from a counter for each evaluation. The tiers of `agree` then lose the grant of a kept context, and so does a host that gives one list to each evaluation. This gives nothing, because the list of the host permits each capability of the grant.

**Why.** The grant of a kept context is a part of the list of its root. In an evaluation with the same list, the grant permits nothing that the root does not permit. In an evaluation with another list, the kernel cannot know the document of the context. Thus the context gets no capabilities, as a context without a spread (D32).

A context of the current epoch costs one comparison at each effect and each resolution, without a new object. The start of a document pays nothing. A context of another epoch costs one new object.

The change is a correction. Code that keeps a context from an evaluation with another list gets `#CAP!` for an effect that started before the change. Thus a result changes, also when the later list permits the effect. `agree` then finds a difference from the definition of the code, as for a context without a spread.

**Limits.** A context that compiled code keeps inside one epoch keeps its grant. It can come from another document of the same epoch, thus it can still give a part more capabilities than its document has. `conforms` finds such code (C1). A direct read of the field `caps` of a kept context gives its old list.

## D55 (2026-10-28): the reference reads the rules of a run, and `agreeRun` replays the log of the plan in each tier

**Context.** K46, from K11 (D19). The reference covered only evaluations (D15). Thus only the plan had a test for the journal of the waits of `all`. A tier that settled the waits of a replay in another order gave no finding.

The design calls are the reading of a run in the reference, the host of each tier and what a comparison of runs examines.

**Decision.**

- `referenceRun` reads the rules of a run directly (REF.RUN). It takes the options `perform` and `signal` of `plan.run`, and it reuses the evaluation of `reference`.
- In a run, the host does each effect of a runner, and a step waits for the host. An effect of an evaluator gives `#CALC!` (RUN.NEEDS-RUNNER), and a signal that aborts gives `#ABORT` (RUN.ABORT).
- One function, `together`, reads `all` for evaluations and for runs. In a run, it asks the journal of the host for the next wait and tells the journal each settled wait (RUN.REPLAY).
- `agreeRun` records a run of the plan with `recorder` (RUN.AGREES). Then four tiers each replay that log with a new `replayer`. These are the reference run, the traced run, a second run and the plan with the other choice of folds. Thus the host does each effect one time.
- Each tier must give the same result and the same effects, and it must settle the waits of each `all` in the recorded order. An overflow of the stack of the host is permitted, as in `agree`.
- The harness of `agree` compares the runs of each configuration, and of a world with the kind `par` and a host that waits. The comparison found no disagreement, and the plan did not change.

**Rejected.**

- Reads in the reference run. The reference has no hook that keeps the reads of a closure of `fn`, and a tree equation evaluates in a nested reference. Also the order of the reads under `all` depends on the host. K155 keeps the work.
- A signal in `agreeRun`. A signal that aborts the plan also aborts each later tier at its start, and that gives a false disagreement.
- One replayer for all tiers. A replayer serves one run (K45), thus each tier gets its own.
- The real host in each tier. The host then does each effect again, and a host that waits can settle the waits in another order in each tier.
- An option of `agree` that gives a promise. A synchronous evaluation then has two return types, and each caller needs a test.

**Why.** The replay fixes the order of the waits from the plan. A tier that settles a wait in another order gets `#REPLAY!` or a different list of settled waits. `agreeRun` names the first such wait. A mutant definition of `all` that waits one more time gives that finding, also when its result and its effects agree.

**Limits.** `agreeRun` does not compare the reads of a run. D67 adds it. A payload with a closure gives a false `#REPLAY!`, because the replayer compares payloads by identity. The second tier of a language (`other`) is not in the runs.

## D56 (2026-10-28): a closure keeps a read of each path that its body can read, and a closure without static reads keeps each whole root

**Context.** K60, from S1b (D26). A closure of `fn` keeps its context for later calls. The list of reads got a read of each whole root, one time in an evaluation. Thus each change of the context changed a kept read, and a schedule evaluated the document again.

The calls of a closure in its evaluation already record the reads of its body, for example in `map`. But a closure can leave the evaluation, also inside a host object. A later call then reads the old context, and no list records that read.

The design calls are the paths that a closure keeps, the cases without known paths and the work that a kept read itself causes.

**Decision.**

- A closure of `fn` with a pure document keeps the static reads of `fn` (READS.CLOSURE). `factsOf` gives them at the first closure of an evaluation with a list of reads. A parameter of `fn` and a name of a `let` in the body are not static reads.
- `Runtime.keepsContext` takes two optional arguments: the context of the closure, and a function that gives the static reads. Without them, the runtime keeps each whole root, as before.
- Each static read gives one kept read with its root and its keys, one time in an evaluation. The read resolves from the context at the root of the evaluation.
- A name that a kind binds around the closure gives no kept read, because the list already has the reads of its binding. A `self` that a kind sets keeps the root `self`, as for a direct read (READS.KEPT).
- A read after a step document keeps its whole root, because a walker can step outside the keys of the path.
- The path of a kept read ends at the first host thing. The evaluation did not ask for the read, thus the read does not step into a host thing.
- A reference in the data on the path reads the context of its reader. Then the closure keeps each whole root.
- A closure whose document is not pure keeps each whole root, as before (READS.KEPT). An extension or an effect can read the context outside the runtime.
- The reference does not change, because it records no reads. The probe runtime of `conforms` and the runtime of a fold do not change.

**Rejected.**

- The reads of the calls alone. A closure in the result or in a box can get a call after the evaluation. Its reads then go to no new list, and a stale result stays.
- A kept read only for a closure that leaves the evaluation. A walk of the result does not find a closure inside a host object (D26).
- A prefix of the path that stops before a reference in the data. The reference reads another path, thus the prefix stays the same while the target changes.
- The full path through a host thing. A step into the root `world` of a schedule demands a node, also the node that evaluates at this time. SCHED.ONE-MEANING found such a cycle in the first draft of this work.
- `factsOf` at the compilation of each `fn`. A plan without a list of reads then pays for facts that it does not use.
- The static reads of the body alone. A parameter of `fn` then gives a kept read of a name of the context.

**Why.** A pure document reads its context only through the runtime (FACTS.PURE), and each such resolution has a static read (FACTS.SOUND). Thus the static reads of `fn` cover each read of a later call of its closure. A host thing is the same only as itself, and the host gives a new thing for a new state (READS.VERIFY).

The change keeps more old results. A change of a name that no closure reads keeps the result, and a change of a name that a closure reads still discards it. The test of generated documents finds fewer changed reads than before, and no stale result.

The change is visible: an evaluation with a pure closure gives another list of reads. A host that examines the paths of the list sees the new kept reads.

**Limits.**

- A closure in a schedule that reads a node keeps the whole root `world`, because that root is a host thing. Thus each change of data still discards its result. D57 changes this for a node with its result in the data epoch.
- A reference in the data on a path of a closure keeps each whole root, as before K60.
- A closure that gets a call after the end of its evaluation adds the reads of its body to the old list. A new closure from that call adds its kept reads there too. A schedule keeps a copy of the list (PLAN.LEAN), thus it does not see them.
- The harness of READS.SOUND compares two closures by their parameters. Thus it does not find a stale closure in a result. The test READS.CLOSURE compares the values of an old closure and a new one.

## D57 (2026-10-28): a kept read of a closure reads a node of a schedule through `known`, without a demand

**Context.** K156, from the limits of D56. A kept read of a closure ends at the first host thing. In a schedule, the root `world` is a host thing. Thus a closure that reads a node kept the whole root, and each change of data discarded its result.

The full path through `world` demands the node. That demand starts from inside the evaluation of the reader, also when the closure does not get a call. SCHED.ONE-MEANING found a false `#CYCLE!` with it (D56, Rejected).

The design calls are the step into a host thing, the record and the verification of the read, and the case without a value.

**Decision.**

- `HostThing` gets the optional function `known(key)`. It gives what a step reaches only when the host has the value without new work. A throw gives the error of the step.
- The root `world` of a schedule gives `known` for each node with its result in the data epoch. Each such result is final (D31). A node in evaluation and a node without a demand give `undefined`.
- `keptPath` steps into a host thing only through `known`. After such a step, the walk gives what the path reached, and no resolution follows. A host thing without `known` ends the path, as in D56.
- A step that `known` does not answer ends the path at the host thing. Thus the read keeps the whole thing, as in D56.
- `verifyReads` walks a kept read with `keptAgain`, in the same way. A step that `known` does not answer is a changed read. A path without a step of `known` resolves with `readAgain`, as before.
- The schedule does not demand a node for a kept read, also not ahead of a demand. SCHED.DEMAND and SCHED.LONG-CHAIN stay as they are (SCHED.CLOSURE).
- The reference does not change, because it records no reads. `Runtime` does not change.

**Rejected.**

- A demand of the node at the record of the kept read. The demand starts from inside the evaluation of the reader, and it gives a false `#CYCLE!` (D56).
- A demand at the verification. `durable` verifies the reads of a node while the node is in evaluation. Thus such a demand gives the same false cycle.
- A demand of the read nodes ahead of the demand of the host. A node behind a lazy edge then evaluates, against SCHED.DEMAND and SCHED.LONG-CHAIN. Also a cycle through the closure still has no known value.
- A stamp of each node that changes with its value. The new stamp of a node needs the new value, thus a demand too.

**Why.** The schedule knows each node that has a final result in the data epoch. A kept read of such a node compares its value, as a direct read does, and it needs no demand. Thus no kept read adds a demand, and no false cycle can occur.

An old closure that keeps its result reads the nodes live, because its root `world` demands each node in the current epoch. Its kept reads of the other roots compare the paths of its body (D56). Thus the old closure and a new one give the same values.

The change is visible: a closure in a schedule gives another list of reads, and it keeps more old results. The answer depends on the order of the demands, but each value stays the same.

**Limits.**

- A kept read keeps its result only when the read node has its result in the epoch before the verification. A host that reads the closure first gets a new closure.
- A closure on a cycle of reads with its node, for example a closure that reads its own node, keeps the whole root `world`.
- A closure in a chain of closures keeps its result only when each closure of the chain has its result first.
- A missing node has no known value. Thus a closure that reads a missing node keeps the whole root `world`.

## D58 (2026-10-28): `agreeSchedule` examines the engine of a host against an evaluation from scratch

**Context.** S3a, from R4 P4. SCHED.ONE-MEANING compared the demand schedule with an evaluation from scratch (D31). The generator, the commands and the model were in a test file. Thus the engine of a host could not use them.

R4 names four orders of a schedule: demand with a memo, push-pull with dirty marks, push by height with a cutoff, and verifying traces. The design calls are the interface of an engine, the outcome of a comparison and the orders that the kernel has.

**Decision.**

- The kernel exports `agreeSchedule(engine, options)` from `meaning.ts` (SCHED.AGREES). The generator, the commands and the evaluation from scratch move there from the test.
- The test of SCHED.ONE-MEANING uses `agreeSchedule`, thus the rules have one copy. The same seeds give the same commands as before.
- An engine has four functions: `set`, `remove`, `changeData` and `read`. The function `changeMachine` is optional, and an engine without it gets no new machine.
- The argument `engine` makes a new engine for each run from a machine and a context. The function `schedule` has this form, thus `agreeSchedule(schedule)` operates.
- The outcome is the first read with a different answer. It gives the seed, the step, the node, the two answers, the documents, the context, the machine and one reason.
- Without a disagreement, the outcome gives the counts of what the harness reached. A weak generator gives false confidence, thus a test examines the counts (R4).
- Two answers agree by `sameResult`. Two closures of `fn` agree when they have the same parameters, and the option `equal` answers first.
- The defaults fit `STD_MACHINE`. A host with another machine gives the generator, a small value document and a document that reads nodes.
- The kernel has two orders, and the test covers both. `schedule` is the demand schedule with verifying traces. `schedule` with each read volatile is the demand schedule with a memo only (DURABLE.DATA).
- The kernel has no push-pull schedule and no push by height. This item does not build them. S3d and S3e are their rows.
- The harness found no disagreement in the two orders. The kernel did not change its results.

**Rejected.**

- A second copy of the generator and the model in the source. Two copies drift, and a correction of one copy leaves the other wrong.
- An engine that gives its graph or its counts. The engine of a host can have no graph, and the counts are a measure, not a rule (R4). The test of SCHED.ONE-MEANING examines the graph of the schedule through its own engine.
- Each disagreement in the outcome. The first disagreement with its seed occurs again, and the later ones often have the same cause.
- The package fast-check, as R4 proposes. The kernel has no package dependencies, and the seed of `random` repeats a run.
- One engine for all runs, with a reset. A new engine for each run keeps no state of an earlier run.
- A comparison of errors by code only. Then a `#CYCLE!` that names another node agrees.

**Why.** One generator and one model give each order of the kernel and each engine of a host the same test. A host examines its own engine in its own repository (R4 P4). Two wrong engines of the test show what the harness finds: an engine that keeps a stale answer, and an engine that misses an edit.

**Limits.**

- The kernel has no push-pull schedule (S3d) and no push by height (S3e). S3b gives a push-pull engine in the tests.
- The harness does not examine glitches or the count of runs (SCHED.GLITCH and SCHED.RUN-ONCE of R4). It reads the answers after each command, not during a change.
- An engine gives the reasons of D31 for `#CYCLE!` and `#REF!`, because two errors agree only with the same reason.
- No step makes a disagreement smaller. The outcome gives the whole graph of the read.
- The harness starts no run of a node on the run side (SCHED.RUN).

## D59 (2026-10-28): `placeOf` reads the place that a node keeps, and `nearest` can record a hop for each step

**Context.** K147 and K148, from C9. The picture of C9 draws an arrow for each hop of a resolution. A hop gives a thing, but no place in the document. Thus the site wrapped the evaluator `tree.node` to find the place of each node.

The walker `nearest` gave one hop for the whole walk. Thus a picture drew one arrow from the start to the node that the walk reached, also across several parents.

The design calls are the record of the place, the cost without hops, the option of the walk and the steps of the new hops.

**Decision.**

- The kernel exports `placeOf(thing)` (HOP.PLACE). It gives the place of a node of the decorated tree: the keys from the root document to the document of the node.
- `placeOf` reads the place that the state of each node keeps already. It adds no record, thus it costs nothing when no hops are recorded.
- A value, a plain record of the document and another host thing give `undefined`.
- `nearestWalker` gets the option `eachStep` (HOP.EACH-STEP). With it, a resolution with hops gets one hop for each node on the way before the node that the walk reaches.
- Each such hop has the followed key as its step, for example `parent`, and `by: "step"`. The hop of the whole walk comes after them, as before. A failed walk keeps them.
- `WalkInput` gets the optional function `visit`. The resolution gives it only when it records hops, thus a resolution without hops does no new work.
- The default of `eachStep` is `false`. The standard walker records one hop for the whole walk, thus each result and each list of hops without the option stays the same.
- The site reads the place of each node with `placeOf`, and it does not wrap `tree.node`. It keeps the standard walker, because each walk of its examples has one parent step.

**Rejected.**

- A new record of the place of each thing that a hop reaches, for example a map in the resolution. The node already keeps its place, and a map costs work in each resolution with hops.
- A place for each plain record of the document. A plain record has no record of its place, and a key of a hop from a known place already gives it.
- An option of `ResolveOptions`. The runtime gives each resolution one fixed object of options, and `verifyReads` resolves a read again without them. Then a read with each step differs from its new resolution.
- An option in the step document. A view changes the document then, and the facts and the reads of the document change with it.
- A hop for each step that repeats the step document. Then a picture gives the same text to each arrow, and a reader cannot see the followed key.

**Why.** A node of the decorated tree keeps its place for the reasons of its errors and of its cycles. Thus `placeOf` gives a view the place of a hop without new state. An option of the walker belongs to the machine, thus each resolution of one machine gives the same hops, also a resolution again in `verifyReads`.

**Limits.**

- `placeOf` knows only the nodes of the decorated tree. A host thing of a host needs its own record of its place.
- The place of a node that an equation of a kind makes is a place in that equation, not in the document.
- Only the walker `nearest` has the option. Another walker records each step only when it uses `visit`.

## D60 (2026-10-28): the host declares fixed names, and a pure part that reads only fixed names folds

**Context.** K14, from R1 P4. A host often evaluates one plan with the same configuration or registry each time. A path from such a name resolves again at each evaluation, but the value does not change. R1 proposes an option of `prepare` that names these roots. Then the path resolves at compile time.

The risk of R1 is a stale plan: an old value without an error. The design calls are the form of the option, what compiles, and what happens when an evaluation gets another value.

**Decision.**

- `PrepareOptions` gets the option `fixed: { names }` (PLAN.FIXED). The record `names` gives the value of each fixed name at compile time.
- A name fixes only when its value is deeply frozen plain data. Plain data is the data that a fold copies (PLAN.SHARED). Each other value does not fix its name, and the plan reads it at each evaluation.
- The fold of D43 does the work. A pure part folds when it reads only fixed names and the names that it binds. The probe resolves each fixed name to its declared value.
- A path from a fixed name is such a part, thus it resolves one time, in `prepare`. A parent that reads only fixed names folds too, thus a formula over a configuration becomes one value.
- The code of a folded part compares the value of each of its names in the context, with one own-key test and `Object.is`. The same values give the folded value.
- Another value, a missing name, a list of reads and another runtime get the code without the fold. This code is the code of the plan without the declaration. Thus the result is not stale at any time.
- A `let` that binds a fixed name again gives a different value to its scope. The comparison finds it, thus the scope rules need no new analysis.
- A plan with a trace and a plan with `fold: false` ignore the option. The default, without the option, keeps the plan as it was.
- `agree` gets the tier `fixed`, also in its default tiers (PLAN.AGREES). It declares each name of plain data fixed, with a frozen copy. It evaluates with the copies and then with the context of `agree`. `agreeRun` does not have the tier.
- The reference does not change. No expected value of an earlier test changed.

**Rejected.**

- An error when an evaluation gets another value. A `let` can bind a fixed name again, and a host can give a new configuration to an old plan. The code without the fold gives the right result for a cost of one comparison.
- One comparison at the root of the plan. A part in the scope of a `let` sees another value of the name, thus the comparison belongs to the part.
- A deep comparison of the value at each evaluation. It costs as much as the walk of the path, thus the fold gains nothing.
- A freeze of the value of the host in place. The kernel does not change an object of the host (D43). A host freezes its own value, and a value that is not frozen does not fix.
- A list of fixed names without values, with the values of the first evaluation. Then `prepare` cannot fold, and the first evaluation compiles again.
- Fixed roots other than `names`. The fold of D43 knows only names. The roots `self`, `event` and `world` stay open.

**Why.** The comparison by identity is sound only for a value that cannot change in place, thus the option needs a deeply frozen value. Then the same object gives the same result, and one comparison replaces the walk of the path and the code of each part. The fold already has the probe, the frozen copy and the rules of the reads, thus the declaration adds no second compiler.

**Limits.**

- Only the root `names` can be fixed. A registry in the root `world` resolves at each evaluation.
- A value with a host thing, a function or an instance of a class does not fix. A path into such a value resolves at each evaluation.
- The fold evaluates each part with fixed names in `prepare`, also a branch that no evaluation takes. This is the limit of D43.
- `agreeRun` has no tier with fixed names.
- A part that reads a fixed name and a free name does not fold. Only its parts that read only fixed names fold.

## D61 (2026-10-28): the playground reads and writes its text with a profile of the site world, and C17 splits

**Context.** C17 asks for the text of `STD_SYNTAX` next to the tree of the playground and of the structured editor (C11). C11 is not built. `STD_SYNTAX` writes the kinds of the formula kit, for example `ops.add`. The playground evaluates the kinds of the standard world, for example `add`. No program of the playground prints with `STD_SYNTAX`. Its documents of operators give `#KIND?` in the playground.

**Decision.**

- C17 splits. C17 is the text pane of the playground, and it is done. The new row C17b is the text of the structured editor. It waits on C11.
- The site gets the profile `SITE_SYNTAX`, data for the syntax kit (C15, D41). The operators `+`, `*` and `>` make `add`, `multiply` and `greater`. The forms `if`, `list`, `seq`, `pure`, `log` and `write` make those kinds.
- The pane shows the text that `print` gives for the current document.
- At each edit, after a wait of 300 ms, the pane reads the text with `parse`. A good text replaces the document. The cards, the result and the JSON change with it.
- A bad text keeps the last good document. The pane shows the message and marks the span of the issue in a copy of the text. A button selects the span in the text box. A live region announces the problem.
- A document that does not print keeps the cards. The pane tells that the text form is not available, and it gives the reason and the place from `print`.
- A change of the cards, of the JSON or of the program writes the text again. Thus the tree and the text show the same document at each time.
- A test reads each printed program back to the same document. A pinned list gives each program that does not print, with its reason, thus a fix of the kernel changes a test.

**Rejected.**

- The text of `STD_SYNTAX` in the playground. No program prints, and a text of an operator does not evaluate.
- A change of `STD_SYNTAX` or `STD_WORLD` in the kernel. It has release effects, and a kernel profile has the same gaps of the printer.
- A machine of the playground that adds the formula kit. The kinds `list`, `ref` and `if` of the two worlds clash, and the cards have no view for `ops.*`.
- Short forms `sum` and `product` for the alias `math.product`. A form name is a plain name, and a short name hides the path of the type.

**Why.** A site profile is the smallest change, and it has no release effect. The five programs without a text fail on gaps of the syntax kit of the kernel. A kernel profile has the same gaps.

**Limits.** Three programs of eight round-trip: Arithmetic, No capability and A missing name. Each gap is a row of the roadmap.

- K157: `print` has no text for the header `name`, thus Names and Effects have no text.
- K158: `print` and `parse` have no text for a data envelope, for example `{ type: "text" }`, thus A choice has no text.
- K159: a bare literal in a part without a declared type gives `#PART?`, for example `list(1, 2)` and the branches of `if`.
- K160: the syntax kit has no form for a record kind, for example `panel` and `box`, thus A tree has no text.
- K161: a call form has a plain name, thus a kind under a path, for example `math.product`, has no form. A type as a path has no text.
- K162: the kernel has no syntax profile for `STD_WORLD`, thus each host writes one, and it repeats the names of the kinds.

## D62 (2026-10-28): a profile names a bind symbol for the header name, and a call form can have a name with dots

**Context.** K157 and K161, from C17. `print` refused each document with a header `name`. Thus the programs Names and Effects of the playground had no text. A call form had a plain name, thus the alias `math.product` of A type as a path had no form. A spreadsheet profile reads `=` as equality, thus one fixed text for a name does not fit each profile.

**Decision.**

- A profile gives the text of a header in the new field `header`. Its field `bind` is the symbol between a name and its document. With `bind: "="`, the text `total = 2 + 3` gives the sum the header name `total` (SYNTAX.HEADER).
- A binding starts an expression: the whole text, an argument of a call, or a group in parentheses. Thus `seq(a = 1 + 2, b = a * 10, log(b))` names two steps.
- A name is a plain name or a name in backticks. A reserved word is a good name, for example `if = 1`, because the binding comes before the term.
- A bare literal gets the kind `lit`, because only an envelope has a header. Thus `b = 1` gives `{ type: "lit", value: 1, name: "b" }`.
- `print` writes the name before the document. A named term of an operator gets parentheses, for example `(a = x + 1) * 2`.
- A document has one name. The text `a = (b = 1)` gives an issue.
- The bind symbol is a group of symbols. An infix or a postfix operator that is the symbol, or the start of it, throws a `TypeError`. A longer operator that starts with the symbol wins, thus `x == 1` reads as before.
- `STD_SYNTAX` and `SITE_SYNTAX` take `=`. Each text that parsed before gives the same document. A text with `=` after a name gave an issue before.
- A call form can have plain names with dots between them, for example `math.product`. The parser already read the name of a call as a path, and the lookup of a form matches the full name (SYNTAX.FORM-PATH).
- A name with dots and no `(` stays a reference. A form name with dots needs the field steps, and its first key is not a word operator. If not, the profile throws a `TypeError`.
- `SITE_SYNTAX` gets the form `math.product`. Six programs of eight round-trip, and a test pins the text of each.

**Rejected.**

- A fixed `=` in the kernel. A spreadsheet profile reads `=` as equality.
- A word as the bind symbol, for example `let a be 1`. A word operator and a plain name then have two readings.
- A binding only in the steps of `seq`. The kernel lets each envelope have a name, and the printer does not know the kinds of a world.
- A text for the own entries `own`. An own entry names an evaluator of the host, and no program of the site uses it. The printer refuses it with its own reason.
- A form `product` without the path. D61 rejects a short name that hides the path of the type.

**Why.** A profile field keeps the text of each language its own choice. A symbol that no operator reads gives a binding that no earlier text had. The parser read a dotted call name already, thus K161 is the check of the form name and the lookup.

**Limits.**

- The own entries have no text in each profile.
- The reason for a name without a bind symbol is new: "This syntax has no text for the name of a document." Before, a name and an own entry gave the same reason.
- A pattern of references can read the first key of a form name, for example `A1.x`. K146 holds that check (D140).
- A choice has no text, because K158 has no text for a data envelope. A tree has no text, because K160 has no form for a record kind.

## D63 (2026-10-28): a call form names the way its arguments make the value, and a step of a path in parentheses is a document

**Context.** K158 and K160, from C17. The program A choice of the playground has the branch `{ type: "text", value: "big" }`. A profile had no text for a data envelope: its value is one literal, not a list of parts. The program A tree has the record kinds `panel` and `box`. A positional form needs the first fields in order, but a node of the tree has `width` and `children` without `height`.

The inner box also reads `self.parent` with the step document `{ type: "nearest", value: { type: "panel" } }`. A path had no text for a step that is a document.

**Decision.**

- A call form gets the new field `args`. Its values are `list`, `fields`, `named` and `literal`. The default keeps the old forms: `fields` with fields, or `list`.
- A form with `args: "literal"` takes one literal that JSON writes, and the literal is the value. Thus `text("big")` is `{ type: "text", value: "big" }` (SYNTAX.DATA).
- The literal is a text, a finite number, a truth value or `null`. A document, `NaN`, `-0`, no argument or a second argument gives an issue.
- A form with `args: "named"` reads each argument as a key, a `:` and a document. The value is a record, thus `panel(width: 300)` is `{ type: "panel", value: { width: 300 } }` (SYNTAX.RECORD).
- A key is a plain name or a name in backticks. A reserved word is a good key, because the key comes before the document. A key with the same name two times gives an issue.
- The field `fields` of a named form limits the keys. Without it, a named form permits each key, for example the construct `record`.
- `print` writes the keys in the order of the record. A record with another key, or a value that is not a record, has no text by the form.
- A step of a path in parentheses after a dot is a document, for example `self.parent.(nearest(type: "panel")).width` (SYNTAX.STEP). `print` writes a step that is an envelope in parentheses.
- `SITE_SYNTAX` gets the literal forms `number`, `text` and `bool`, and the named forms `panel`, `box` and `nearest`. Each of the eight programs round-trips, and a test pins the text of each.
- Each text that parsed before gives the same document. A new form reads only the calls of its own name, and the text `.(` after a name gave an issue before.

**Rejected.**

- A profile that reads each string literal as `{ type: "text" }`. Then `log("start")` gives another document, and the bare literal has no text.
- A form `kind{field: value}` with braces. K145 can use the braces for a record literal of data. A call form already has the parentheses, the separator and the issues.
- A form for the children of a tree, for example `panel(width: 300)(box())`. It fits only a tree, and `children: list(...)` already writes it.
- Named arguments for each call. In the spreadsheet profile, `SUM(a:b)` is a range, thus that text then gives another document.
- A check of the type of the literal, for example a number in `text(1)`. The parser makes documents, and the evaluator of the kind checks its data.

**Why.** A field of the form keeps the text of each kind a choice of the profile, as D62 did for the header. One literal and one record of keys cover the data envelopes and the record kinds of the standard world. The step in parentheses uses the group of the parser, thus a step can be each document.

**Fit with K145.** The construct `record` takes the named form without fields: `record(a: 1, b: x)`. The constructs `let`, `fn` and `call` take named or positional forms with their fields. Their fields `bind`, `params` and `args` hold a record or a list of data. K145 gives those a literal, for example `[a, b]` and `{x: 1}`, and the named form keeps those brackets free.

**Limits.**

- `print` writes the keys in the order of the record. Two records with the same fields in another order give two texts, but `docEquals` tells that they are equal.
- A literal form does not check the type of the literal. Thus `text(1)` reads, and its evaluation gives `#VALUE!`.
- A step document after a bare name needs a first name, for example `x.(y)`. A path from the root `names` with a document as its first step has no text.

## D64 (2026-10-29): the kernel gives the profile `WORLD_SYNTAX` of the standard world

**Context.** K162, from C17. `STD_SYNTAX` writes the kinds of the formula kit, for example `ops.add`. A host of `STD_WORLD` wrote its own profile, and that profile repeated the names of the kinds.

The site profile `SITE_SYNTAX` of D61 to D63 was such a profile. Each of its forms names a kind of `STD_WORLD`. The site world adds only the kind `kind`, and that kind has only a view.

**Decision.**

- The kernel exports `WORLD_SYNTAX`, the profile of `STD_WORLD` (SYNTAX.WORLD). It is in `stdlib.ts` next to the world, with a type import of `syntax.ts`.
- The type import adds no import cycle. A bundle that does not use the profile drops it (PKG.PURE).
- The operators `>`, `+` and `*` make `greater`, `add` and `multiply`. The forms are the forms of `SITE_SYNTAX`, and the profile takes `=` for a header name.
- The new form `math.sum` writes the alias of `add`, as `math.product` writes the alias of `multiply`.
- `SITE_SYNTAX` is `WORLD_SYNTAX`. The site adds no form, because the playground does not read the kind `kind` as text. The eight pinned texts of the playground stay the same.
- A host with more kinds spreads the profile and adds its forms to `calls.forms`. The kernel adds no function for this.
- A test lists each kind and each alias of `STD_WORLD`. Each one has a text by an operator, a form or the reference syntax, or a pinned reason.
- The list of pinned reasons is empty. The kind `ref` has its text by the reference syntax, for example `self.parent.width`.
- The round trip test generates documents of `WORLD_SYNTAX` too, thus it examines six profiles (SYNTAX.ROUNDTRIP).

**Rejected.**

- A change of `STD_SYNTAX`. It is the profile of the formula kit, and its `+` makes `ops.add`.
- A function in the kernel that extends a profile. A spread of the fields already gives a new profile, and it adds no API.
- The profile in `syntax.ts`. Then the names of the kinds are not next to the world that has them, and a change of a kind is two changes.
- A form `add` next to the operator `+`. Then a document of `add` has two texts. K163 decides the text of an operator document with fewer than two parts.

**Why.** The profile is data next to the world, thus a kind and its text change together. A host of the standard world reads and writes text without its own profile. The coverage test finds a new kind without a text.

**Limits.**

- An operator kind with fewer than two parts has no text, for example `{ type: "add", value: [5] }`. The alias `math.sum(5)` has a text. K163 holds the gap.
- A bare literal in a part without a declared type still gives `#PART?`, for example in `list(1, 2)` (K159).

## D65 (2026-10-29): a literal in a place that takes a document gets its data envelope, and the form of an operator kind writes its other documents

**Context.** K159, from C17, and K163, from K162. `parse` gave a bare JSON literal, for example `1` in `list(1, 2)`. The kinds `list`, `if`, `seq`, `pure` and `write` declare no type for their parts. Thus `partsOf` found no envelope and no declared type, and the evaluation gave `#PART?`.

The whole text `42` gave `#PART?` too. A named literal `a = 1` got the kind `lit` of the formula kit, and `STD_WORLD` has no kind `lit`. An infix operator writes two terms or more. Thus `{ type: "add", value: [5] }` had no text in `WORLD_SYNTAX`.

**Decision.**

- The fix is on the side of the parser. No rule of evaluation changes, thus each document evaluates as before.
- The new literal rule `literals.envelopes` names the kinds of the data envelopes of a text, a number and a truth value (SYNTAX.ENVELOPE). The rule is opt-in for each profile.
- The new form field `wrap` names the arguments that take a document: `true` for each argument, or the names of some fields.
- With the rule, a literal in such a place gets its envelope. Thus `list(1, 2)` is `list(number(1), number(2))`. The whole text and the document after a header name take a document too.
- `print` writes such an envelope there as the bare literal. A bare literal there has no text, because `parse` gives it the envelope. Thus the round trip stays exact.
- A literal without a kind stays bare, for example `null`. A literal form, for example `number(1)`, still reads the same document.
- `WORLD_SYNTAX` turns the rule on with the kinds `number`, `text` and `bool`. The forms `if`, `list`, `seq` and `pure` wrap each argument, and `write` wraps only its `value`.
- `log`, `panel` and `box` declare the type of their parts, thus their bare literals stay. The key of `write` is data.
- `WORLD_SYNTAX` gets the forms `add`, `multiply` and `greater` (SYNTAX.FEW-TERMS). The operator wins when it fits, thus `1 + 2` keeps its text.
- The form writes the other documents of the kind, for example `add(5)`, `add()` and `greater(1, 2, 3)`. The type reads back as the kind, not the alias `math.sum`.
- The evaluator decides a document without parts: `add()` is `0`, `multiply()` is `1`, and `greater()` gives `#VALUE!`.
- `STD_SYNTAX` and the test profiles have no envelopes. Their documents stay the same.

**Texts of `WORLD_SYNTAX` that read another document since D65.**

- `list(1, x)` of the pinned kind texts gave `[1, x]`. It gives `[number(1), x]` since D65. Its text stays the same.
- The site value `list(1, 2, 3)` held three bare numbers. The value holds three envelopes since D65, thus its text stays the same and it evaluates.
- Each text with a bare literal in a part of `if`, `list`, `seq`, `pure` or the value of `write` changes the same way. The whole text `42` and `a = 1` change too.
- Each new document evaluates where the old document gave `#PART?` or `#KIND?`. No pinned text of the playground reads another document.

**Texts that `print` writes in another way since D65.** The documents stay the same.

- The kinds `number`, `text` and `bool` print as `42`, `"big"` and `true`, not `number(42)`, `text("big")` and `bool(true)`.
- The program A choice prints as `if(size > 10, "big", log("small"))`, not `if(size > 10, text("big"), log("small"))`. The old text reads the same document.

**Rejected.**

- A rule of evaluation that gives a bare literal a type by its JSON value. It changes the results of documents, and a world decides its own kinds.
- An envelope for each literal in each place. Then `1 + 2` and `log("start")` give other documents, and D63 rejected that.
- The places from the kinds of the world. The syntax kit does not read a world, thus the profile names the places as data.
- A text for a bare literal in a place that takes a document. Such a document gives `#PART?`, and the text needs a new syntax.
- A field `max` of a form, so that only the operator writes two terms. Two texts already read to one document, for example `number(1)` and `1`.
- A text of the operator symbol as a call, for example `+(5)`. It is a new syntax, and a call form already has a name.

**Why.** The profile is data, thus a world names its own envelopes and places. The parser makes documents that the world evaluates, and the printer keeps the round trip exact. A form of the kind name uses the call syntax of D63.

**Limits.**

- `list(null)` still gives `#PART?`, because `STD_WORLD` has no kind for `null`.
- `syntaxFormat` writes a data envelope as the whole text with its form, for example `number(1)`. `parse` reads the same document.
- The generator `world` of the round trip test uses `WORLD_SYNTAX` as D64 gave it, thus it keeps its documents. The new generator `envelopes` examines the full profile.

## D66 (2026-10-29): an equal list of the host is the same epoch, and the root of an evaluation has no field of the epoch

**Context.** K153 and K154, from K120 (D54). The epoch of a grant was the object of the list of the host. A host that gives a new but equal list for each evaluation got `#CAP!` for a context that code kept from an earlier evaluation. The reference permits that effect.

The epoch also cost time in each evaluation. The bench of PR #111 gave FORMULA.SPEED +3.1% and PLAN.FOLD +4.4%. The design calls are the rule for an equal list, the part of K120 that costs most and the form of the root.

**Decision.**

- Two epochs are the same when they are one list, or when the two lists are equal (CAP.EPOCH-EQUAL). Equal lists have the same length, and at each index the same text or the same keys in the same order.
- The runtime compares the entries only when the two lists are not the same object. Thus the hot path stays one comparison of identity.
- A wider list, a narrower list and the same entries in another order are other epochs. Thus CAP.NARROW-KEPT holds, and a list in another order stays a safe refusal.
- The root of an evaluation keeps only its grant, without the field of the epoch. A context without the field has the epoch of its grant (`epochOf`). Each other context of the kernel writes its epoch, thus only a root has no field.
- `rootContext` writes the field only for a context of the kernel with an epoch. An example is a kept context that a host gives as its root.
- `readable` first tests for a context of the epoch whose grant is its own list, with two comparisons. Each other context goes to a second function, thus the hot part stays small.

**Rejected.**

- Equal lists as sets, or by `permits` in each direction. The hook `permits` of a machine reads the entries of the list, and it can give another answer for another order or form. Only equal entries in the same order give the same answers for each hook.
- One interned object for each equal list of the host. It needs a table of the lists, and a lookup at each evaluation.
- A first test of the grant only, without the epoch. It keeps the grant of some contexts of another epoch. The bench also gave FORMULA.SPEED +6.8% for it.
- A session without the field of the epoch, or `readable` without its test. Neither part has a cost that the bench can see (below).

**Why.** Equal entries in the same order give the same answer for each rule of the host. Thus the grant of a kept context permits nothing that the root does not permit. A copy of the list is the usual case of a host that makes a new list.

The root is the one context that each evaluation makes. Its second field with a symbol key made the spread slower. The root has the shape of a root before K120 again.

**Measured (K154).** The bench of CI compared each variant with `main` at 22d94f4. A cell gives the change and the noise (A/A) in parentheses.

| Variant | FORMULA.SPEED | PLAN.FOLD | Run |
| --- | ---: | ---: | --- |
| The root has no field of the epoch | -2.4% (0.0%) | -9.8% (-0.1%) | 40795209555 |
| `readable` has no test of the epoch | +0.7% (+0.5%) | -0.1% (-0.1%) | 40795212111 |
| The session and `readable` have no epoch | -1.3% (+0.2%) | +0.2% (-0.2%) | 40795214730 |
| No epoch, as before K120 | -1.1% (-0.5%) | -8.2% (+1.1%) | 40795217917 |
| A move of `readable`, with the same code | +0.5% (+0.4%) | 0.0% (0.0%) | 40796640399 |
| D66, first try | -2.4% (0.0%) | -8.6% (-0.3%) | 40796414735 |
| D66, second try | -2.2% (-0.6%) | -8.9% (+0.3%) | 40796414735 |

The field of the root costs most. Without it, PLAN.FOLD and PLAN.FIXED are 8% to 10% faster than `main`, and FORMULA.SPEED is 2% faster. The session, the test in `readable` and the test of an effect cost nothing that the bench can see.

**Limits.** A host list with the same entries in another order is another epoch. A kept context gets `#CAP!` there, but the reference permits the effect. Some cases of a reference are 3% to 5% slower than `main`. The bench of PR #126 gives a reference of five steps +3.4%, the formula with a list of reads +2.7% and PLAN.PATH +4.7%.

The variant without an epoch gave such changes too, for example +4.6% for five steps. Two other variants of `readable` and `rootContext` gave 5% to 47% in some of these cases. Thus such a case reacts strongly to the form of this code, and K164 examines it.

## D67 (2026-10-29): the reference records the reads of a run, and `agreeRun` compares the free reads with the plan

**Context.** K155, from K46 (D55). `agreeRun` compared the results, the effects and the order of the waits. It did not compare the reads of a run. The reference had no record of reads.

A closure of `fn` evaluated without a hook for its reads, and an equation of a tree evaluated in a nested reference. The design calls are what a read is in the comparison, and how closures and equations reach the record.

**Decision.**

- `reference` and `referenceRun` take a list `reads` (REF.READS). Each resolution of a document gives one read: the path, what it reached and the mark `free`. The reference finds `free` from the rule READS.FREE.
- Each part of a closure keeps the state of its evaluation. Thus a call of a closure records the reads of its body in the same list.
- An equation of a tree evaluates in the state of the record of its tree. Thus its reads go in the list of the outer evaluation.
- A reference through a name whose binding failed reads that name, in the reference too (READS.RECORD).
- `agreeRun` compares the free reads of the plan and of the reference run, in their order (RUN.AGREES-READS). It compares the path, and what the read reached by the rules of the results. A difference has its own reason, for example `The free read 0 is ["names","a"] in the plan, and ["names","b"] in the tier.`
- A kept read does not compare. It is the bound of the plan for the later reads of a closure, and the reference has no such bound.
- When the plan keeps each root (READS.KEPT), it does not know its reads, and no read compares.
- Another replay of the plan records the reads of the plan. Thus the recording of the plan keeps its folds (PLAN.FOLD).
- The result of an agreement gives the reads that compared, as `reads`. The harness of runs asserts that each configuration compares some reads.

**Rejected.**

- A comparison of the reads in `agree`. The harness of runs covers each configuration of the evaluations, thus a second comparison finds nothing new.
- A comparison of the reads that are not free. A read in a closure or in a kind depends on the order of the evaluation in each tier. Only a free read decides if a kept result stays valid.
- Kept reads in the reference. The reference has no static reads of a closure, and a copy of `factsOf` makes the reference depend on the plan.
- The reads of the recording of the plan. A list of reads stops the folds, thus the recording does not test them.

**Why.** A plan keeps a result for the free reads of its list (`verifyReads`). A read that the plan does not record keeps a stale result. The reference reads the rules from SPEC, thus a missing read shows as a difference of the lists.

**Limits.** An equation of a tree evaluates in a nested plan without the list of reads (READS.EQUATION). Thus the plan records no read of an equation. A free read in an equation gives a difference in `agreeRun`, and `verifyReads` keeps a stale result. A test pins the case, and K165 keeps the work. The generated documents of the harness have no equations, and D68 removes both limits.

## D68 (2026-10-29): an equation of a tree records its reads in the list of the evaluation that made the node

**Context.** K165, from D67. An equation of a tree evaluated in a nested plan without the list of reads. Thus the list of the plan had no read of an equation. `agreeRun` reported a missing free read, and `verifyReads` gave `same: true` after a change of the event. A host with a cache kept a stale result.

The design calls are how the reads reach the outer list, and which reads of an equation are free.

**Decision.**

- The evaluator of a tree node gets the runtime of its evaluation, through a key of the kernel on its input. A copy of the input with a spread keeps the key, thus a wrapper of the evaluator keeps it too.
- `evaluateWithin` evaluates an equation in its own runtime, as before. It has no capabilities, its own epoch and no `perform`. Its reads go in the record of the outer evaluation, in the order of the demands (READS.EQUATION).
- The rules READS.FREE and READS.KEPT compare with the root of the outer evaluation. Thus the plan gives the same reads as the reference, which shares the record of the outer evaluation since D67.
- The rule for reads relative to the node:
  - A read from `self` reads the node, thus it is not free.
  - A read of a name of the equation (`child`, `index`, `prev`, `acc`, `item`) is not free when its binding is not the binding of the root.
  - A step out of the tree reads the outer `self` through `parent`. The free read of the whole root `self` that the tree node makes covers it (TREE.SELF).
  - A read of `caps` from an equation is free. The equation has no capabilities, thus `verifyReads` compares with the capabilities of the root. When the root has capabilities, the read changes and the node evaluates again.
- Without a list of reads, an equation evaluates as before, with `plan.evaluate`.

**Rejected.**

- A field of the runtime on the public `EvalInput`. A field changes the public type of each evaluator, and only the tree node needs it.
- An equation in the runtime of the outer evaluation. That runtime has the capabilities and the epoch of the document, and an equation has none.
- A new list for each equation, appended after its evaluation. The free rules then compare with the root of the equation. Thus each read from `self` becomes free, and the order of the reads differs from the reference.
- A kept read of each root that an equation reads. It discards each result after any change of a root, also a change that no equation reads.

**Why.** A plan keeps a result for the free reads of its list (`verifyReads`). The reads of an equation decide the result as much as the reads of a part. The reference already records them, thus the two tiers agree on one shape.

**Limits.**

- `factsOf` gave no static read of an equation. Thus the free read of an equation was an exception of READS.SUBSET, and the edges of a schedule missed the reads of equations (K166). D69 removes the exception.
- A read of `caps` in an equation always changes when the root has capabilities. That is safe, but the node then evaluates again after each change of the context.
- Each evaluator that the kernel interprets gets one more key on its input. The bench of the PR measures the cost.

## D69 (2026-10-29): `factsOf` gives the static reads of the equations of a tree kind

**Context.** K166, from D68. `factsOf` walked the document only, and the equations of a tree kind are in its contract. Thus the free read of an equation had no static read (READS.SUBSET). A read of `world` in an equation gave no edge of a schedule.

A closure with a tree node in its body kept the reads of `factsOf` only (READS.CLOSURE). Thus a change of the event that an equation reads kept the old closure. The design questions are where the reads of an equation go, and which of them are reads.

**Decision.**

- The first document of a tree kind gets the static reads of the equations of its kind (FACTS.EQUATIONS). `check` walks the equations at the same place (TREE.DOWN-NAMES), with the same function `equationsOf`.
- Each such read has the place of that document, and it is lazy. An equation evaluates only when a demand reaches its attribute (TREE.LAZY).
- The free rules of D68 decide the reads:
  - A read from `self` reads the node, thus it is not a read. A step out of the tree is in the read of the whole root `self` that the tree node makes (TREE.SELF).
  - A read of a name that the rung binds is not a read, as for a name that a kind binds in the document. A name that the rung does not bind is a read.
  - A read of `caps`, `event`, `world` or another root is a read.
- A read after a step document keeps the keys before that step, with `exact: false`, as in the document. A static read does not stop at a host thing, thus no read of an equation is lost.
- A tree kind in an equation adds the reads of its own equations, one time for each kind. A kind that holds itself in an equation thus stops.
- An effect, a kind on the run side or a kind that is not pure in an equation makes the document not pure. The effects and the side of the document do not change, because an equation has no capabilities.
- The verb of an equation is `eval`, for each option `verb`, because the tree node plans each equation for `eval`.

**Rejected.**

- The reads of the equations at each document of the kind. The roots and the keys are the same at each document, thus the list only gets longer.
- A cache of the reads of each kind for each machine. The walk of an equation is small, and a cache needs a rule for a kind that holds itself.
- The reads from `self` as static reads. They are not free, and they add nothing to a schedule.
- Eager reads of an equation. A read that the evaluation skips then makes a certain cycle of a schedule, and a demand ahead evaluates a node that nothing reads.

**Why.** A host trusts the static reads for the edges of a schedule and for the kept reads of a closure. A free read without a static read breaks both. The rules of D68 tell which reads are free, thus the static reads follow the same rules.

**Measured.** The bench of CI compared the head 10720b6 with `main` at 94cfeeb in the workflow 40807013893. A cell gives the change and the noise (A/A) in parentheses. The table shows each case outside the bound of 1.5% or two times its noise.

| Case | Base (ns) | Head (ns) | Change |
| --- | ---: | ---: | ---: |
| `factsOf` of a tree with an equation | 6515.8 | 9132.7 | +39.2% (+0.5%) |
| PLAN.COMPILE-SPEED prepare | 13505.0 | 12860.1 | -7.0% (+1.8%) |

The walk of the equation costs the time of `factsOf`. A host computes the facts one time for each document, and `durable` keeps them. Each other case of the plans and the formulas stays in its bound.

The change of PLAN.COMPILE-SPEED is noise of the runner, not a gain of K166. `prepare` does not use `factsOf`, and K166 changed no code that `prepare` uses. The first bench, in the workflow 40806760672, gave -8.4%. The bench of the last head e9d1b6a, in the workflow 40807342694, gave +2.4% (+1.6%), in its bound. The heads 10720b6 and e9d1b6a have the same code, and only the runners were different (D70).

**Limits.**

- The reads of an equation have the place of the first document of the kind, not the place of each document of the kind.
- A kind with a tree contract and another evaluator also gets the reads of its equations. That is safe, but its schedule can get an edge that its evaluation does not use.

## D70 (2026-10-29): the kernel keeps the code of D66, because no part of K154 gives the time of two reference cases back

**Context.** K164, from the Limits of D66. The bench of PR #126 gave five cases of a reference 2.7% to 4.7% slower than `main` at 22d94f4. A variant without an epoch gave such a change too. The design questions are which cases stay slower, and which part of the change costs the time.

**Decision.**

- The kernel keeps the code of D66, and no code changes.
- Two of the five cases are slower in two runs: the formula with a list of reads and the reference of five steps. The other three cases do not repeat.
- No variant of a part gives the time back without a cost of 6% to 24% in another case (below).

**Rejected.**

- The field of the epoch on each root again (V1). The list of reads and the step document get 3% back. FORMULA.SPEED, PLAN.FOLD, PLAN.FIXED and PLAN.PATH become 6% to 9% slower.
- `readable` as one function, without its first test (V2). Six cases become 2% to 9% slower.
- A session that gives its own root to the resolution without `readable` (V3). The two slower cases do not change, and a formula with a fixed name and a free name becomes 23.5% slower.
- A change of the key `RUNTIME` of K165 on the input of an evaluator. The formula kit compiles each evaluator, thus these cases do not make that input. The bench of PR #128 gave each of the five cases in its bound.

**Why.** No single part holds the cost. A session that does not use `readable` for its root gives the same time, thus the first test of `readable` costs nothing. The variant without an epoch of D66 also gave a reference of five steps +4.6%. Thus the cost comes from the form of the code that the engine compiles, as in D50. The gains of D66 in PLAN.FOLD, PLAN.FIXED and FORMULA.SPEED are larger than the cost.

**Measured (K164).** Two benches of CI compared `main` at 8ae6491 with 22d94f4, the parent of K154. A cell gives the change and the noise (A/A) in parentheses. A case is slower only when its change is over the bound in both runs. The bound is 1.5% or two times the noise, whichever is larger.

| Case | Workflow 40807793509 | Workflow 40807795964 | Slower in both runs |
| --- | ---: | ---: | --- |
| The formula with a list of reads | +5.5% (-0.1%) | +4.8% (+0.5%) | yes |
| A reference of five steps | +2.9% (+0.1%) | +3.5% (+0.1%) | yes |
| A reference into a host thing with `resolve` | +11.1% (-0.3%) | -2.7% (0.0%) | no |
| A reference through an envelope | +1.4% (-0.2%) | -2.2% (+0.6%) | no |
| PLAN.PATH, the same path without the declaration | -1.6% (0.0%) | -2.2% (-0.1%) | no |
| A reference with a step document | +8.2% (-0.7%) | +4.9% (+0.3%) | yes |

Each variant then went in one bench against `main` at 8ae6491. A negative change is a gain of the variant.

| Variant | List of reads | Five steps | Step document | Largest other change | Run |
| --- | ---: | ---: | ---: | --- | --- |
| V1: the root has the field of the epoch | -3.2% (0.0%) | -0.1% (-0.5%) | -2.6% (+0.3%) | PLAN.FIXED path +9.4%, PLAN.FOLD +9.1% | 40808521422 |
| V2: `readable` without its first test | +0.2% (-0.5%) | +5.5% (+0.1%) | +8.7% (+0.3%) | host thing +7.9% | 40808523956 |
| V3: the session gives its root at once | -0.7% (-0.1%) | +1.0% (0.0%) | +0.4% (+0.6%) | PLAN.FIXED formula +23.5% | 40808526055 |

**Limits.**

- The reference with a step document is a sixth case that is slower in both runs. The two benches of PR #126 gave -1.2% for it. The benches of PR #127, #128 and #129 each gave it in its bound. Thus small changes of the code add up in such a case.
- The runners of CI are not all the same machine. The same case took 107 ns on one runner and 206 ns on another (measured after the other cases in one process (before K210)), and the change of a case can have another sign on each.
- PLAN.COMPILE-SPEED is faster than 22d94f4 in both runs, -4.6% and -7.2%. D69 shows that this case also changes with the runner.

## D71 (2026-10-29): the bench of a pull request repeats each comparison on two runners

**Context.** K167, from K164 (D70). The same case took 107 ns on one runner and 206 ns on another (measured after the other cases in one process (before K210)). Single benches went over the bound in both directions without a repeat (K151, K164, K166). The design questions are how a bench repeats, and when a case is slower.

**Decision.**

- The workflow `bench.yml` has a matrix of two jobs. Each job compares the base and the head on its own runner, with the script `paths.ts` of D29.
- Each job prints its table as before, with the model of its CPU. The header `| Case | Base (ns) | Head (ns) | Change | Noise (A/A) |` does not change.
- Each job also writes its table as JSON. The job `verdict` merges the two tables with the script `merge.ts`.
- The bound of a run is 1.5% or two times the noise of the case, whichever is larger (D50, D70).
- A case is slower or faster only when both runs are over the bound in the same direction. A case that no run puts over the bound is in bound. Each other case is mixed.
- The jobs do not block a merge. A run with different results fails its job and the verdict, as before.

**Rejected.**

- More rounds in one job. The noise of one runner stays low, but the change of a case can have another sign on another runner (D70). More rounds do not show that.
- One job that measures two times. The two measurements then share one machine, thus they repeat the error of that machine.
- A mean of the two changes. A large change on one runner then hides a change with the other sign on the other runner.

**Why.** The noise (A/A) is the noise of one process on one machine. It does not include the difference between two machines. Two runners give two independent results, and a change that both runners show does not come from one machine. A dispatch with a base keeps this repeat, thus a comparison with an old commit also repeats.

**Measured (K167).** A cell gives the change and the noise (A/A) in parentheses.

The A/A check compared the head of PR #131 with itself (base `HEAD`) in the workflow 40809759741. The first runner had an AMD EPYC 9V45, and the second runner had an AMD EPYC 7763. No case is over the bound in a run, thus each of the 16 cases is in bound. The bench of the pull request (workflow 40809762247) compared the same kernel with `main` at d10ef9f. It also gave 16 cases in bound.

| Case | Runner 1 | Runner 2 | Verdict |
| --- | ---: | ---: | --- |
| FORMULA.SPEED formula | -0.1% (-1.1%) | +0.2% (+0.3%) | in bound |
| The formula with a list of reads | +0.1% (-0.4%) | 0.0% (+0.6%) | in bound |
| A reference of five steps | +0.2% (-0.1%) | 0.0% (+0.3%) | in bound |
| A reference with a step document | -0.6% (+0.3%) | +0.2% (+0.6%) | in bound |
| PLAN.TOTAL, 20 literals without folds | +1.3% (+0.3%) | +0.1% (+0.1%) | in bound |
| `factsOf` of a tree with an equation | +1.2% (-0.2%) | -0.1% (-0.4%) | in bound |

The second check compared `main` at d10ef9f with 22d94f4, the parent of K154, as K164 did. The workflow is 40809762099. The first runner had an Intel Xeon Platinum 8573C, and the second runner had an AMD EPYC 7763.

| Case | Runner 1 | Runner 2 | Verdict |
| --- | ---: | ---: | --- |
| A reference with a step document | +7.7% (+0.6%) | -0.7% (+0.8%) | mixed |
| The formula with a list of reads | +3.6% (+0.6%) | +0.8% (0.0%) | mixed |
| A reference of five steps | +8.2% (0.0%) | +3.4% (0.0%) | slower |
| A reference into a host thing with `resolve` | +4.5% (+0.4%) | +5.1% (+0.1%) | slower |
| The same tree, with a list of reads | +2.1% (-0.2%) | +1.8% (-0.1%) | slower |
| `factsOf` of a tree with an equation | +43.4% (+1.4%) | +40.1% (-0.2%) | slower |
| PLAN.FOLD a record of 20 literals | -6.6% (0.0%) | -7.8% (-0.1%) | faster |
| PLAN.FIXED a path of four steps | -7.8% (0.0%) | -8.1% (-0.4%) | faster |

The merged table had 4 cases slower, 5 faster, 5 mixed and 2 in bound. The reference with a step document does not repeat as slower: the Xeon gives +7.7% and the EPYC gives -0.7%. Thus the plan gets no new item for it. The cost of `factsOf` is the walk of the equations of K166 (D69). The tree with a list of reads gets the reads of the equations of K165 (D68).

**Wall time.** The bench of PR #129 took 83 s in the workflow 40807342694, with one job. The bench of PR #131 took 113 s in the workflow 40809762247. The two jobs start at the same time, and the job `verdict` adds 12 s.

**Limits.**

- Two jobs do not always get two CPU models. Both runs of the bench of PR #131 had an AMD EPYC 7763.
- A mixed case is not a result. Another dispatch can give a third run for it.
- The reference into a host thing with `resolve` is slower in both runs against 22d94f4. D70 gave +11.1% and -2.7% for it, thus K154 can cost this case too.

## D72 (2026-10-29): `pnpm typecheck` checks the bench

**Context.** K168, from K167 (D71). No tsconfig included `packages/core/bench`, thus CI did not typecheck the bench. The file `cases.ts` had a type error that no check found.

**Decision.**

- The file `packages/core/tsconfig.test.json` includes `bench/**/*.ts`. The script `typecheck` of the core already checks this file.
- Its `rootDir` is the root of the package. The base config gives `src`, and `tsc` refuses a file of `bench` outside that root (TS6059).
- The helper `ref` of `cases.ts` takes and gives `Json`. Before, it gave `unknown`, and the equation of a tree kind must be `Json` (TS2322).
- No case computes another value, thus the base and the head give the same results.

**Rejected.**

- A new tsconfig for the bench. The test config already has the types of Node and `allowImportingTsExtensions`, thus a second file only repeats them.
- The option `erasableSyntaxOnly` in the test config. The source of the kernel has parameter properties, thus the option gives errors in `src`.
- A cast at the equation. A cast hides the type of each other use of `ref`.

**Why.** CI starts the bench, and a type error in it can hide a wrong case. The file `tsconfig.test.json` checks the tests, and it already has the types of Node.

**Measured (K168).** Before the fix, `tsc` reported one error: TS2322 at `bench/cases.ts` line 70, column 26. After the fix, `pnpm typecheck` of the core reports no error. The package files do not include `bench`.

**Limits.**

- Node removes the types of `merge.ts` and `paths.ts`, but no check refuses syntax that Node cannot remove. Only a review keeps enums, namespaces and parameter properties out of `bench`.

## D73 (2026-10-29): `rootContext` reads the epoch one time, and the reference cases get the time of K154 back

**Context.** K169, from K167 (D71). Against 22d94f4, the repeated bench gave a reference into a host thing with `resolve` +4.5% and +5.1%. It gave a reference of five steps +8.2% and +3.4%. Four merges since 22d94f4 changed the kernel: #126, #127, #128 and #129. The design questions are which merge holds the cost, and which form of its code gives the time back.

**Decision.**

- PR #126 (K153, K154, D66) holds the whole cost of the host thing case. The three later merges keep each of the two cases in bound.
- `rootContext` reads the field of the epoch one time. One test keeps a context that is already a root, as before K154. Then the function makes the root with or without the field of the epoch.
- The function gives the same root for each context as before. Thus CAP.NARROW-KEPT, CAP.EPOCH-EQUAL, READS.EQUATION, RUN.AGREES-EQUATIONS and FACTS.EQUATIONS do not change.

**Rejected.**

- `readable` that reads the field of the epoch before the grant (variant C). The host thing case is mixed, and a reference through an envelope is slower in both runs.
- The field of the epoch on each root again (V1 of D70). It costs PLAN.FOLD and PLAN.FIXED 9%.

**Why.** D66 added a first test of the field of the epoch to `rootContext`, before the test of the base. Each evaluation of a host context goes through that function. The engine compiles the form of D66 slower for these cases, as in D50 and D70. The form of the base with one read of the field gives the time back, and the root keeps the shape of D66.

**Measured (K169).** Each merge went in one repeated bench against its parent. A cell gives the change of the two runs, with the noise (A/A) in parentheses. The bench at each old kernel used the cases of `main` at e7e0d38.

| Merge | Base | Host thing with `resolve` | Five steps | Verdicts | Run |
| --- | --- | ---: | ---: | --- | --- |
| #126 (K153, K154) | 22d94f4 | +5.3% (-0.8%), +5.3% (-0.5%) | +2.3% (-1.4%), +3.7% (-0.2%) | slower, mixed | 40811484841 |
| #127 (K155) | a3b5a04 | +0.9% (0.0%), +0.1% (-0.2%) | -1.1% (+0.3%), +0.3% (0.0%) | in bound, in bound | 40811487089 |
| #128 (K165) | 48c4be6 | 0.0% (0.0%), +0.1% (+0.1%) | +0.2% (-0.3%), +0.5% (+0.6%) | in bound, in bound | 40811489238 |
| #129 (K166) | 94cfeeb | 0.0% (+0.7%), +0.2% (-0.1%) | +0.3% (+0.1%), +0.5% (+0.3%) | in bound, in bound | 40811491500 |

PR #126 also gave FORMULA.SPEED, PLAN.FOLD, PLAN.FIXED and PLAN.PATH faster in both runs. The formula with a list of reads was slower in both runs, +3.2% and +2.8%.

Two variants of the code of D66 then went in one repeated bench each, against `main` at e7e0d38. A negative change is a gain of the variant.

| Variant | Host thing with `resolve` | Five steps | List of reads | Step document | Slower | Run |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| A: `rootContext` reads the epoch one time | -9.6%, -3.4% (faster) | -3.5%, -5.2% (faster) | -8.5%, -4.6% (faster) | -7.6%, -8.1% (faster) | none | 40812040853 |
| C: `readable` reads the epoch first | -2.6%, -1.1% (mixed) | +1.8%, +0.1% (mixed) | -2.6%, +0.3% (mixed) | +0.2%, +0.4% (in bound) | an envelope, +5.7% and +5.1% | 40812043111 |

Variant A gave 4 cases faster, 6 mixed, 6 in bound and none slower. The kernel keeps variant A.

The bench of PR #133 repeated the comparison of variant A with `main` in the workflow 40812604288. It gave 5 cases faster, 7 mixed, 4 in bound and none slower.

| Case | Runner 1 | Runner 2 | Verdict |
| --- | ---: | ---: | --- |
| A reference into a host thing with `resolve` | -9.8% (+0.1%) | -7.7% (0.0%) | faster |
| A reference of five steps | -3.3% (+0.2%) | -3.7% (-0.2%) | faster |
| The formula with a list of reads | -8.4% (+0.1%) | -4.4% (-0.1%) | faster |
| A reference with a step document | -9.3% (+0.6%) | -5.3% (+0.2%) | faster |
| PLAN.FIXED a formula with a fixed name and a free name | -9.6% (+0.3%) | -1.7% (-0.1%) | faster |
| A reference through an envelope | +4.3% (+0.5%) | -0.6% (-0.1%) | mixed |

**Limits.**

- The gain comes from the form of the code that the engine compiles, not from less work. Another change of `rootContext` or `readable` can lose it again.
- Variant A gave six mixed cases in its first bench. The tree with a list of reads gave -1.0% and +14.4% there, and +0.6% and -4.4% in the bench of PR #133.
- A reference through an envelope gave +4.1% and +4.3% on an AMD EPYC 7763. These are the two benches of variant A. The other runners gave +1.2% and -0.6%, thus the case does not repeat as slower.

## D74 (2026-10-29): the code of a `deref` evaluator and the input of a walker get the optional `has` of D21

**Context.** K43, from K39 (D21). D21 gave a host thing the optional `has`.

Two other sites still read `undefined` as a missing field. The first is the code of a `deref` evaluator of a kind (`DerefCode`). The second is the function `deref` that a walker gets in its input (`WalkInput`). Thus a kind could not give a field that holds `undefined`, and a walker could not see one.

**Decision.**

- `DerefCode` is an interface with a call signature and the optional field `has(doc, key)`. The kernel asks it only when the code gives `undefined`, as for a host thing (DEREF.KIND-UNDEFINED).
- A host gives the code its `has` with `Object.assign(code, { has })`. A plain function stays a valid `DerefCode`.
- `WalkInput` has the optional function `has(thing, key)`. It gives `true` when the step through the ladder of `deref` reaches a field (DEREF.WALKER-UNDEFINED).
- Each resolution of the kernel gives `has`, with and without a record of hops. The field is optional in the type, thus an input that a host makes stays valid.
- A code without `has` and a host thing without `has` keep the old reading. No expected value of the core changes.

**The sites of `deref`.** Each step on a key goes through `derefStep`. The reference, a plan, a compiled path, `keptPath` and `keptAgain` use it. Thus the change of `derefStep` gives one answer to each of them.

| Site | Change |
| --- | --- |
| `HostThing.deref` (D21) | none: it has `has` |
| The things of the kernel: the nodes of the standard tree, the nodes of the reference, the nodes of `schedule` and of `meaning` | none: each has `has` |
| `DerefCode`, which `derefStep` uses | the optional `has` |
| `WalkInput.deref`, given by `resolveFully` | the optional `has` next to it |
| The short path `walkQuick` | none: it gives an envelope to `derefStep`, and a plain field that holds `undefined` already reaches it |
| `HostThing.resolve` and `HostThing.known` | none: they give `{ thing }` |
| The walker `nearest` | none: a key that holds `undefined` ends the walk, as a missing key does |
| `FormulaProfile.missing` | none: a profile reads a value as missing after the resolution, by its own rule |

**Rejected.**

- A separate table of `has` functions in the machine, by the name of the code. Then `mergeMachines` and `restrictMachine` need a new table, and the two halves can disagree.
- A table entry that is a record `{ deref, has }`. Each reader of the table then needs two forms.
- A new function of the walker input that gives `{ thing }`, as `resolve` of a host thing. A walker author then learns a second rule. `has` next to `deref` is the rule of D21, as `Map` has `get` and `has`.
- A `has` of the walker input that asks only the `has` of the thing. It gives a wrong answer when a walker asks it before `deref`, and it does not see a kind or a plain field.

**Why.** One rule serves each site: `deref` gives `undefined`, and `has` tells a field from a missing one. The walker input asks the ladder again, thus its answer is correct also without a call of `deref` before it. The second step costs only when a walker asks `has`.

**Limits.**

- The `has` of a walker input asks the ladder again. A host thing or a code of a kind thus answers the step two times.
- A navigator with `adopt` gives a walker `adopt(undefined)` for a field that holds `undefined`. An adopted value that is not `undefined` hides the case from `deref`, and `has` still tells it.
- The kernel keeps the functions of the walker input for the last navigator (K170). That memo holds one navigator until a walk with another navigator.

**Measured (K170).** The bench of PR #134 gave the reference with a step document +3.4% and +5.1%, slower in both runs (workflow 40814361607). Each walk made the new function `has` next to `deref`. Since K170, `walkSteps` keeps `deref` and `has` of the last navigator, thus a walk with the same navigator makes no new function.

A cell gives the change of the reference with a step document in the two runs, with the CPU of each run.

| Head | Base | Step document | Verdicts | Run |
| --- | --- | ---: | --- | --- |
| K43 | b8348c8 (before K43) | +1.1% (9V45), +4.4% (7763) | 7 mixed, 9 in bound | 40815013060 |
| K43 and K170 | K43 | -12.4% (7763), +1.4% (9V45) | 5 mixed, 9 in bound, 1 slower, 1 faster | 40814779647 |
| K43 and K170 | b8348c8 (before K43) | -6.7% (7763), +2.4% (9V45) | 4 mixed, 12 in bound | 40815011341 |

The kernel keeps K170. Against the kernel before K43, no case is slower. The one slower case against K43 is a reference through an envelope, +2.0% and +4.3%. K170 does not change the code of that case. Against the kernel before K43, that case gives -1.9% and +4.8%, thus it is mixed.

## D75 (2026-10-29): a log has a JSON form for golden files, and one replayer serves more than one run

**Context.** K44 and K45, from K11 (D19). A test could not keep a log as a file. The payloads and the values of the outcomes are host values, and the cause of an error is often an exception. `JSON.stringify` writes `NaN` as `null` and drops `undefined`, thus a written log changed without a message.

A replayer kept its place in the order of the waits of each `all`. Thus each run needed a new replayer, and two runs at the same time shared one place. A recorder that wrapped a replayer put its own journal on its function. The journal of the replayer then did not reach the kernel. Thus a recording of a replay settled the waits in the order of the host.

**Decision.**

- `encodeLog(machine, log)` gives the JSON form of a log (RUN.REPLAY-JSON). It has the version 1, the effects and the settles. Each payload and each value of an outcome is a term document of `encodeValue` (D40).
- Thus `NaN`, an infinity, `-0` and `undefined` stay exact. A member of a domain with a codec is `ext.domain`. A missing outcome stays absent, and an outcome of `undefined` is `ext.undefined`.
- An error keeps its code, its reason, its place and its cause. A cause goes through `encodeValue` first. A cause that `encodeValue` cannot write and that is an exception keeps its name and its message in the field `exception`.
- Each other value without a term document is a refusal: `encodeLog` throws a `TypeError`. The message names the field, the kind and the address of the effect. Examples are a closure, a host thing, a symbol and a `bigint` without a domain. An error with a field that the form does not have is also a refusal.
- `decodeLog(machine, data)` reads the form again with the formula kit and the domains of the machine. It gives `#VALUE!` with the place of the first field that it cannot read. A field `exception` becomes an exception of the standard class with that name, or an `Error` with that name.
- `ReplayOptions.equal` is the rule of the host for two payloads, as in `sameResult`. A log from `decodeLog` holds new copies of the members of a domain. The rule then tells that two copies are the same.
- The kernel tells the journal the count of the waits of each `all` that settled before (`Journal.next`, the third parameter `before`). The plan and the reference give it. Thus a replayer keeps no state of a run, and one replayer serves more than one run, also at the same time (RUN.REPLAY-RUNS).
- A recorded item that does not wait in the run gives no choice: that wait follows the order of the host. An effect that differs from the log gives `#REPLAY!` in its own run, and the next run replays again.
- A call of `next` without the count comes from an older copy of the kernel. The replayer then keeps a place for each `all`, as before.
- A recorder gives each call of its journal to the journal of the inner function, with the same helper as `agreeRun` (RUN.REPLAY-ORDER). Thus a recording of a replay gives the same log.
- The golden file `packages/core/golden/replay.json` keeps the log of one run (RUN.REPLAY-GOLDEN). The test compares the log of the run with the file, and it replays the file. `COEVAL_GOLDEN=write` writes the file again.

**The values of a log.**

| Value | JSON form |
| --- | --- |
| JSON that `JSON.stringify` writes exactly | the value, or `lit` for a value with the shape of an envelope |
| `NaN`, an infinity, `-0` | `ext.number` |
| `undefined` as a value | `ext.undefined`. A missing outcome stays absent. |
| A member of a domain with a codec, also an exception | `ext.domain` through the codec |
| An exception without a codec, as a cause | `exception` with its name and its message |
| A closure, a host thing, a symbol, a `Map`, a cycle, each other value | a `TypeError` that names the address |

**Rejected.**

- A codec hook of its own on `encodeLog`. The domains of the machine already give a codec for each host value (D40), and each language then writes a value as one document (D12).
- A refusal of each exception. Most failed effects of a host have an exception as the cause, thus almost no log could become a file. The reason of the error already has the text of the exception.
- The stack of an exception in the form. It changes with each build and each machine, thus a golden file does not stay the same.
- A raw `JSON.stringify` of a log. It writes `NaN` as `null`, it drops `undefined`, and it reads a payload with the shape of an envelope as a document.
- A key for each run, which a host gives to the replayer. The count of the kernel needs no key, and a host cannot give two runs the same key by mistake.
- A function that starts a new run on the journal. Two runs at the same time still share one place.
- A `#REPLAY!` for a wait that the log cannot settle. A journal gives an item, not an error. The effect that differs already gives `#REPLAY!`, and `agreeRun` compares the order of the waits (D55).

**Why.** A golden file needs one exact text for one log. `encodeValue` already gives one document for each value, thus the log adds only the fields of an effect and of an error. A refusal with the address tells the author which value needs a domain with a codec. A replayer without the state of a run is a plain function of its log, thus a test or a tool can share it.

**Public types.** `encodeLog`, `decodeLog`, `ReplayLogJson`, `ReplayEntryJson`, `ReplayResultJson` and `ReplayErrorJson` are new. `ReplayOptions.equal` and the third parameter of `Journal.next` are optional. An old log and an old call keep working, thus the change is a new feature: MINOR, in 0.17.0. No expected value of the core changes.

**Limits.**

- The form of an exception has no stack, no own fields and no cause of its own. A host that needs more gives a domain with a codec for its exceptions. The row K172 keeps the idea of a chain of causes.
- A wait whose recorded item does not wait follows the order of the host, without a finding of its own.
- `agreeRun` still makes one replayer for each tier. The row K171 keeps the simpler form.

## D76 (2026-10-29): `agreeRun` uses one replayer for its tiers, and the JSON form of an exception keeps its fields and its chain of causes

**Context.** K171 and K172, from K45 and K44 (D75). `agreeRun` made a new replayer for each tier and one more for the replay of the reads. Since D75, a replayer keeps no state of a run, thus one replayer is sufficient.

The JSON form of a log kept only the name and the message of an exception. A host error often has a field `code` or `errno`, and a chain of causes. A test with a golden file then lost the facts that tell two host errors apart.

**Decision.**

- `agreeRun` makes one replayer of the log (RUN.AGREES-ONE-REPLAYER). Each tier and the replay for the reads use it. Each tier keeps its own wrapper for its effects and its waits.
- Sharing is correct for each tier of `agreeRun`. The plan, the reference, the traced run and the plan with the other folds give `Journal.next` the count of the waits that settled. Thus no tier uses the place of the replayer for an older kernel.
- `ReplayExceptionJson` is the new JSON form of an exception (RUN.REPLAY-CAUSES). It has the name and the message, and the optional fields `fields`, `dropped`, `cause`, `exception` and `loop`.
- `fields` holds the term document of each own enumerable field that `encodeValue` writes, for example `code` and `errno`. The fields `name`, `message`, `stack` and `cause` are not in it.
- The cause of an exception has the same rule as the cause of an error. A cause that `encodeValue` writes is `cause`. A cause that is an exception is `exception`, thus the chain nests.
- A cause that is an earlier exception of the chain is `loop`: the index of that exception. The index 0 is the exception of the error. Thus a cycle of causes stays exact, and `decodeLog` gives the same cycle.
- A field or a cause without a term document is a name in the list `dropped`. It is not a refusal. `decodeLog` does not give these fields back.
- The form stays at the version 1. Each new field is optional, and a log without them decodes as before. An exception without own fields and without a cause has the same form as in D75.
- `decodeLog` gives each exception of the chain its fields as own enumerable fields. It gives the cause as a field that is not enumerable, as the constructor of `Error` does. A bad field gives `#VALUE!` with its place.

**The parts of an exception.**

| Part | JSON form |
| --- | --- |
| The name and the message | `name` and `message`, as in D75 |
| An own field that `encodeValue` writes | its term document in `fields` |
| An own field without a term document | its name in `dropped` |
| A cause that `encodeValue` writes | `cause` |
| A cause that is an exception without a codec | `exception`, the next exception of the chain |
| A cause that is an earlier exception of the chain | `loop`, the index of that exception |
| A cause without a form | the name `cause` in `dropped` |
| The stack | not in the form, as in D75 |

**Rejected.**

- A depth limit for the chain. A cycle is the one cause of a chain without an end, and `loop` keeps it exact. The walks of `encodeLog` and `decodeLog` are loops, thus a long chain does not overflow the stack.
- A cut of the chain at a cycle. It loses the cycle, and `loop` costs one number.
- A refusal of a field or a cause without a term document. A host makes the exception, and D75 keeps an exception as a best effort for this reason. An exception of a host library can have a field with a function or a host thing. A refusal then stops each log with that exception.
- A silent drop. The list `dropped` tells the reader of a golden file which facts the form does not have.
- The version 2 of the form. The new fields are optional, and each log of the version 1 stays correct.
- One term document for all the fields of an exception. Then one field without a form drops each field.
- A new replayer for each tier of `agreeRun` that a later tier adds. Each tier of the kernel gives the count, and a tier without the count is not a tier of `agreeRun`.

**Why.** A replayer is a plain function of its log since D75, thus `agreeRun` makes it one time. The cause of an exception gets the same two forms as the cause of an error, thus the chain needs no new rule. An index for a cycle keeps the form exact, and the list `dropped` keeps it honest.

**Public types.** `ReplayExceptionJson` is new, and `ReplayErrorJson.exception` has this type. Each new field is optional. `encodeLog` and `decodeLog` are not in a release before 0.17.0, thus no released form changes. The change is a new feature: MINOR, in 0.17.0. No expected value of the core changes.

**The golden file.** `packages/core/golden/replay.json` does not change. Its exception has no own fields and no cause, thus it has the form of D75.

**Limits.**

- A log with `dropped` does not give the dropped fields back. A recording of a replay of that log thus has no list `dropped`. A host that needs these fields gives a domain with a codec for its exceptions.
- An own field that is not enumerable is not in the form, for example the field `errors` of an `AggregateError`. The row K173 keeps this idea.
- A cause from another realm is not an instance of `Error` there, thus it has the rule of each other value.

## D77 (2026-10-29): the JSON form of an exception keeps the hidden fields of the standard classes

**Context.** K173, from K172 (D76). The JSON form of an exception kept only its own enumerable fields. An `AggregateError` keeps its list `errors` in a field that is not enumerable. Thus a log lost each error of the list.

**Decision.**

- `ReplayExceptionJson.hidden` keeps the own fields that are not enumerable and that the standard classes define (RUN.REPLAY-HIDDEN). These are `errors` of `AggregateError`, `error` and `suppressed` of `SuppressedError`.
- Each value of a hidden field is a part, `ReplayPartJson`. A part is a term document in `value`, an exception in `exception`, or the index of an earlier exception in `loop`.
- A hidden field that is a list is a list of parts. A hidden field with another value is one part.
- An exception in a hidden field has the rule of a cause. Thus an entry of `errors` that is the outer exception, or an earlier entry, is a `loop`.
- The walk gives each exception its index in the order of a depth-first walk. It takes the hidden fields in the order of the list above, then the cause. `decodeLog` walks in the same order.
- A hidden value without a form is a name in `dropped`, as in D76. An item of a list has the name of the field, a dot and its index, for example `errors.1`.
- `decodeLog` gives an `AggregateError` or a `SuppressedError` for that name. It gives each hidden field as a field that is not enumerable, as the standard class does.
- The form stays at the version 1. The field `hidden` is optional, and an old log decodes as before.

**Rejected.**

- Each own field that is not enumerable. An engine adds hidden fields of its own to each exception, for example `fileName` and `lineNumber`. These change with each build, as the stack does, thus a golden file does not stay the same.
- A hidden field in `fields`. Then `decodeLog` cannot give the field back as a field that is not enumerable.
- A term document for the full list `errors`. Then one entry without a form drops each entry.

**Why.** The standard classes define a short, fixed list of hidden fields, and each holds the facts of the failure. An exception in them can loop back, thus the rule of a cause keeps the form exact.

**Public types.** `ReplayPartJson` is new, and `ReplayExceptionJson.hidden` is optional. `encodeLog` and `decodeLog` are not in a release before 0.17.0, thus no released form changes. The change is a new feature: MINOR, in 0.17.0. No expected value of the core changes.

**The golden file.** `packages/core/golden/replay.json` does not change. Its exception is a `TypeError` without hidden fields.

**Limits.**

- An `AggregateError` always has the list `errors`. Thus a new recording of an old log of an `AggregateError` writes the empty list.
- An item of a list without a form leaves the list. Thus the later items get a lower index. The row K175 keeps the idea of a place for it.
- An enumerable field that holds an exception has no part rule, for example `errors` on an `Error`. It is a name in `dropped`. The row K174 keeps this idea.
- A host without `SuppressedError` gets an `Error` with that name and the hidden fields.

## D78 (2026-10-29): an enumerable field of an exception that holds an exception gets parts, and a dropped item keeps its place

**Context.** K174 and K175, from K173 (D77 Limits). An `Error` with an enumerable list `errors` of exceptions lost the list, because `encodeValue` cannot write an exception without a codec. An item of a hidden list without a form left the list. Thus each later item got a lower index.

**Decision.**

- `ReplayExceptionJson.parts` keeps each own enumerable field that `encodeValue` cannot write and that holds an exception (RUN.REPLAY-FIELDS). The value is an exception, or a list with one exception or more.
- Each value in `parts` is a part, `ReplayPartJson`, as in `hidden`. A list is a list of parts, thus a list can mix term documents and exceptions.
- An exception in `parts` has the rule of a cause. Thus a field that is the outer exception, or an earlier exception of the walk, is a `loop`.
- The walk takes the fields in `parts` in the order of their keys, then the hidden fields in the order of D77, then the cause. `decodeLog` walks in the same order.
- A field that `encodeValue` writes stays in `fields`, also an exception that a domain with a codec holds. A field without an exception and without a term document stays a name in `dropped`, as in D76.
- An item of a list in `parts` or `hidden` without a form is the mark `{ "dropped": true }` at its place (RUN.REPLAY-HIDDEN). Its name stays in `dropped`, for example `errors.1`.
- `decodeLog` gives a hole at the place of a mark. The list keeps its length, and each later item keeps its index. A hole of a list has no form, thus a new recording writes the mark again.
- `decodeLog` gives each field of `parts` as an own enumerable field. The mark is only an item of a list. Another use of the mark gives `#VALUE!` with its place.
- The form stays at the version 1. The field `parts` and the mark are optional, and a log without them decodes as before.

**Rejected.**

- An exception in `fields`. A term document and a part do not have one shape, thus a reader cannot tell them apart.
- An enumerable field in `hidden`. Then `decodeLog` cannot give the field back as an enumerable field.
- The hidden fields before `parts` in the walk. The order of the form is then not the order of the walk, and `parts` comes before `hidden` in the form.
- `undefined` at the place of a dropped item. A host that maps the list then reads a field of `undefined` and fails. A hole is also `undefined` when a host reads it, and `map` skips it.
- The removal of the item, as in D77. Then a `loop` to a later item stays correct, but a reader of the list gets each later item at another index.
- Parts for each list without an exception. A list of plain values keeps the rule of D76, thus the form of each log before D78 stays the same.

**Why.** An enumerable field with an exception holds the same facts as a hidden field of a standard class, thus it gets the same part rule. One fixed order of the walk keeps each `loop` exact. A mark costs one small record, and each later index stays exact.

**Public types.** `ReplayExceptionJson.parts` is optional, and `ReplayPartJson` gets the new member `{ dropped: true }`. `encodeLog` and `decodeLog` are not in a release before 0.17.0, thus no released form changes. The change is a new feature: MINOR, in 0.17.0.

**Changed expected values.** One test of RUN.REPLAY-HIDDEN changes. Before, a list `errors` with two items without a form gave one part, and `decodeLog` gave a list of one item. Since D78, the list has two marks, and `decodeLog` gives two holes at the indices 1 and 2.

**The golden file.** `packages/core/golden/replay.json` does not change. Its exception is a `TypeError` without fields.

**Limits.**

- A list without an exception and with one item without a form drops the full field, as in D76. The row K176 keeps the idea of a mark for that item.
- `parts` holds an exception or a list of them. A record that holds an exception, for example `{ inner: error }`, is a name in `dropped`. The row K177 keeps this idea.
- `decodeLog` gives a field of `parts` after the fields of term documents. Thus the order of the keys of a decoded exception can differ from the order of the host.

## D79 (2026-10-29): `fits` tests each member of a type with few members, and a domain declares its members in `values`

**Context.** K48, from K23 (D22). `fits` was sound but missed true cases. A search over the kernel types found these misses:

- A base type with few members against a `one` or a union that holds each member, for example `bool` against `{ "one": [true, false] }`, and `null` against `{ "one": [null] }`.
- A union of such types against a `one`, for example `null | bool` against `{ "one": [null, true, false] }`.
- A closed record of such fields against a `one` or against a union that splits a field. An example is `{a: bool}` against a record for `true` and a record for `false`.
- A list of `never` against `{ "one": [[]] }`. Its one member is the empty list.
- A record with a needed field without members, for example `{a: never}`, against each type. The record has no members.
- An open record with a finite field against a union that splits the field.
- A base type that a union of other domains covers, for example two domains of a language that split `number`.

**Decision.**

- The new rule comes after the rules of the shapes (TYPE.FITS-FINITE). When they refuse a type with at most 64 members, `fits` tests each member with `member` against `expected`.
- `Domain` gets the optional field `values`: the full list of the members of the domain. `STD_DOMAINS` gives `[null]`, `[undefined]` and `[true, false]`.
- A base type reads the list of the first domain of its line with at most 64 values. A value of the list that fails a test of the type does not count. Thus the list of `bool` serves a domain under `bool`.
- A union and a `one` have the members of their parts. A closed record of such fields has the product of its fields. A list of `never` has the empty list.
- A record with a needed field without members has no members, also an open record.
- A member of a union in `expected` gets no finite rule. The call for the full union tests the members once.
- The rule of `unknown` and the order of the other rules do not change. The strict join reads the rule too.
- `mergeMachines` compares `values` as it compares the steps. `extendDomain` keeps `values`, because a new parent only adds a test.

**Rejected.**

- A table of the kernel for `bool`, `null` and `undefined` only. A language then cannot declare a small domain, for example an alignment with three values.
- The finite rule before the rules of the shapes. Then each check of `bool` against `bool` starts the test of the domain for each value. The fallback keeps the common path as before.
- A finite rule without a bound. A closed record with ten `bool` fields has 1024 members, and the product grows fast.
- A split of an open record over a union. The rule must build a record type for each value of the field, and the number of checks grows with each field. The row K178 keeps it.

**Why.** For a type with few members, the members decide the relation exactly. Thus the rule is complete for such types, and `member` keeps it sound. The bound of 64 keeps the cost small, and the rule only starts when the old rules refuse.

**Soundness.** A generated test of 320 types and 102400 pairs over the kernel types samples members of `found` (TYPE.FITS-SOUND). More than 10000 pairs fit, and more than 350 of them fit only by the finite rule. The test finds 0 counterexamples. A test without the absent case of an optional field finds a counterexample at once.

**Public types.** `Domain.values` is a new optional field. A check accepts some programs that it refused before, and a join of two equal types can give the other type. The change is a new feature: MINOR, in 0.17.0.

**Changed expected values.** One test of TYPE.FITS changes. Before, `bool` did not fit `{ "one": [true, false] }`. Since D79, it fits, thus the test shows the open record of K178 as the case that `fits` still misses.

**Limits.**

- The language keeps `values` complete. A list without a member makes `fits` unsound for that domain, as a wrong `steps` makes a path wrong.
- An open record does not split a field over a union (K178). A type with more than 64 members gets no finite rule.
- Two domains that cover a base type together do not fit it (K179). A domain cannot declare such a cover.

## D80 (2026-10-29): `extendDomain` keeps the codec of a domain, and a merge compares the codecs

**Context.** K180, found by K48 (D79). `extendDomain` copied a domain field by field and dropped `codec`. A member of the extended domain then had no `ext.domain` document. Thus `encodeValue` and `encodeLog` threw a `TypeError` for it (D40, D75).

`mergeMachines` also did not compare `codec`. Two domains that differ only in their codec gave one domain. The merge kept the earlier codec without a conflict.

**Audit.** The fields of `Domain` against both functions:

| Field | `extendDomain` before | `mergeMachines` before | Since D80 |
|---|---|---|---|
| `is` | kept | compared | no change |
| `under` | kept, with the new parents | compared | no change |
| `summary` | kept | compared | no change |
| `steps` | kept, with the new steps | compared | no change |
| `codec` | dropped | not compared | kept and compared |
| `values` | kept (D79) | compared (D79) | no change |

**Decision.**

- `extendDomain` keeps the codec of the domain. `DomainExtension` gets no field for a codec. Thus an extension does not change the codec.
- `mergeMachines` compares the codecs of two domains with one name. Two codecs are the same when they are one object, or plain records with the same functions `encode` and `decode`.
- Another codec, or a codec on one side only, is a conflict. The later part resolves it with `["domains", name]` in `replaces` (D17).
- In both functions, a mapped type names each field of `Domain`. Thus a new field of `Domain` fails the check of types until both functions read it.

**Rejected.**

- A codec in `DomainExtension`. Another codec gives another document for the same member, thus two languages write two documents for one value (D12). A language that needs another codec replaces the domain.
- A merge that keeps the one codec when only one side has a codec. Then one part gives the members no document, and the other part gives them a document. D17 makes such a pair a conflict.
- A comparison of codecs by their output. A codec is a pair of host functions, and a merge cannot test them on each member. The test `is` has the same rule.

**Why.** The document of a member must not change when a language adds a parent to its domain. Thus the copy keeps the codec, and the merge refuses two codecs for one name.

**Public types.** No type changes. `extendDomain` gives a domain with its codec. A merge of two different codecs for one name is a conflict since D80. The fix changes observable values: MINOR before 1.0, in 0.17.0.

**Changed expected values.** No expected value of an earlier test changes. A new test of TYPE.PARENTS and a new test of TYPE.MERGE show the bug.

**Limits.** Two codecs with separate functions that write the same JSON are a conflict, as two separate but equal tests are. Two languages share one codec object, or the later language replaces the domain.

## D81 (2026-10-29): a profile with its own `truthy` declares the type of a truth in `truthType`

**Context.** K50, from K24 (D25). The default truth accepts only `true` and `false`. Thus the check needs `bool` at a test of `if` and at a term of `and` and `or`. A profile with its own `truthy` accepts other values, and the check did not know which. Thus it accepted each type there, also a text that the run refuses with `#VALUE!`.

**Decision.**

- `FormulaProfile` gets the optional field `truthType`, a value type next to `truthy` (TYPE.TRUTH). A test of `if` and each term of `and` and `or` must fit it.
- A part that does not fit gets `#TYPE!` with `expected` and `found`, as each other type issue. The reason names the place, for example "The term 2 of and has the type text. It must have the type number."
- The check examines `truthType` as a contract, one time in a check. A bad type gives one issue at its first use, and the parts then need nothing. Thus one problem gives one issue.
- `and` and `or` keep their result types. The logic `boolean` gives `bool`, and the logic `value` gives the join of the terms. Each term fits `truthType`, thus the join fits it too.
- An own `truthy` without `truthType` accepts each type, as before. A profile without `truthy` needs `bool` and ignores `truthType`, because the default truth refuses each other value.
- `truthType` is a field of the canonical form of a profile (D46). Two profiles with different truth types give two kits, and their machines conflict.
- The language keeps its declaration: its `truthy` gives a truth for each member of `truthType`. The check trusts it, as it trusts the signatures.

**Rejected.**

- The declared type as the result of `and` and `or` with the logic `value`. It loses precision, for example `and(1, 2)` gives `number` and not `{ "one": [1, 2] }`. The join is a subtype of the declared type, thus it is sound and more exact.
- A type that the check infers from the function `truthy`. A function is code of the host, and the check cannot test it on each member of a type.
- `truthType` also for the default truth. A type wider than `bool` makes the check unsound, and a narrower type is a subtype of `bool` that a language does not need.
- A `truthType` that each own `truthy` must have. Then each existing profile with `truthy` changes, and the change breaks the API.

**Why.** The type of a truth is a rule of the language, as a signature is a rule of an operation. A field next to `truthy` keeps the two rules together, and the check reads it with no new mechanism.

**Soundness.** A property test generates 300 documents of tests and terms over literals, operations and names of `let` (TYPE.TRUTH-SOUND). It examines the logic `boolean` and the logic `value`. Under `bool | number`, the check accepts 76 documents and refuses 224. No accepted document gives the error of a value without a truth. Without `truthType`, the check accepts 6 documents that give that error.

**Public types.** `FormulaProfile.truthType` is a new optional field. A profile without it gets the same issues as before. The change is a new feature: MINOR before 1.0, in 0.17.0.

**Changed expected values.** No expected value of an earlier test changes. The new tests are in `truth.test.ts`.

**Limits.**

- The language keeps `truthType` true to its `truthy`. A member without a truth makes the check unsound at that place. K181 adds this obligation to `conforms`.
- A part of the type `unknown` fits `truthType`, by the gradual rule. The guards of K28 cover such a place.

## D82 (2026-10-29): a list field and a record field of an exception keep their parts

**Context.** K176 and K177, from K175 and K174 (D78 Limits). A list field without an exception lost each item when one item had no form. A record field with an exception, for example `{ inner: error }`, was a name in `dropped`.

**Decision.**

- An own enumerable field without a term document is in `parts` when it is an exception, a list or a plain record (RUN.REPLAY-FIELDS). A list or a record is a container of parts.
- A list of parts is a JSON list, as in D78. An item that is a list without a term document is a JSON list in that list.
- A record of parts is the new part `{ "record": { ... } }`. Each field of it is a part or a list of parts. A field without a form leaves the record, and its name goes in `dropped`.
- An item of a container has the name of the container, a dot and its key or index in `dropped`, for example `wrap.send` or `grid.0.1`.
- A container without a form in it, for example a list of functions, is one name in `dropped`, as in D76. A hidden list of a standard class keeps its marks, as in D78.
- The walk takes the items of a container in the order of their keys. An exception in a container has the rule of a cause, also a `loop` to the outer exception.
- A container that is again on the way from its field is a cycle. It has no form, thus it is a name in `dropped`. A container that two fields share gets a form at each place.
- A value with a hole of a list at some depth is a container, not a term document. `encodeValue` writes a hole as `undefined`, thus the hole then keeps its mark.
- `decodeLog` gives a new plain record for a record of parts, with its keys in their order. Each field is enumerable.
- The form stays at the version 1. The part `record` and a list in a list are optional, and an old log decodes as before.

**Rejected.**

- A list of marks for a list without a form in it. It keeps only the length, and `decodeLog` then gives a list of holes as a fact of the host. One name tells the same truth with less text.
- An empty list for such a list. `decodeLog` then tells that the host had no items.
- A container only for a record with an exception. A record and a list then have two rules, and a record without an exception loses each field for one function.
- A JSON record as a record of parts, without the field `record`. A reader then cannot tell a record of parts from a part.
- The part `{ "list": [...] }` for a list in a list. A list of parts is a JSON list at the top, thus a JSON list at each depth keeps one rule.
- A depth limit. The walks of D76 have none, and the check of the way ends each cycle of containers.
- A loop to a container. A loop is the index of an exception. A record of the host has no class and no identity that a golden file needs.

**Why.** A list and a record are the two containers of `encodeValue`, thus one rule covers both, at each depth. A container without a form adds no fact, thus it keeps the short form of D76.

**Public types.** `ReplayPartJson` gets the member `{ record }`, and the new type `ReplayPartsJson` is a part or a list of them. `encodeLog` and `decodeLog` are not in a release before 0.17.0, thus no released form changes. The change is a new feature: MINOR before 1.0, in 0.17.0.

**Changed expected values.** One test of RUN.REPLAY-FIELDS changes. Before, the list `tries: [1, () => 1]` was the name `tries` in `dropped`. Since D82, it is a list of parts with a mark, and `dropped` has `tries.1`.

**The golden file.** `packages/core/golden/replay.json` does not change. Its exception is a `TypeError` without fields.

**Limits.**

- A cause that is a list or a record with an exception has no part rule, for example `{ cause: { inner: error } }`. It is the name `cause` in `dropped`. The row K182 keeps this idea.
- `decodeLog` gives two records for a record that two fields share. The exceptions in them stay the same by `loop`. The row K183 keeps this idea.
- A sparse list of plain values was a term document with `undefined` at a hole. Since D82, it is a list of parts with a mark at the hole.
- A key with a dot gives a name in `dropped` that is not exact. The name `a.b` is the key `a.b` or the field `b` of `a`.

## D83 (2026-10-29): the kernel keeps the code of D82, because the cost in PLAN.FOLD comes from the module, not from the fold

**Context.** K184. The bench of PR #147 (K176, K177) gave PLAN.FOLD, a record of 20 literals, slower in both runs: +2.8% and +2.4%. The fold does not use `replay.ts`, and PR #147 changed only `replay.ts` at run time. The design questions are if the cost is real, and where it comes from.

**Decision.**

- The kernel keeps the code of D82, and no code changes.
- The cost repeats, but it is smaller than the PR bench gave: +1.7% in both runs, over the bound of 1.5%.

**Why.** The bench imports the whole kernel from `src/index.ts`. Thus a larger `replay.ts` changes the code that the engine loads and compiles, though the fold does not use it. This is the effect of the form of the code that D50 and D70 found. A change to the fold for a cost that a module outside the fold makes is not a fix.

**Measured (K184).** Bench workflow 40959703241 compared `main` at b8e5466 with a9b5243, the parent of PR #147. A cell gives the change and the noise (A/A) in parentheses.

| Case | First bench | Second bench | Verdict |
| --- | ---: | ---: | --- |
| PLAN.FOLD a record of 20 literals | +1.7% (-0.3%) | +1.7% (+0.7%) | slower |
| PLAN.FIXED a path of four steps from a fixed name | -1.6% (0.0%) | -2.5% (-0.7%) | faster |

The other 14 cases gave 11 in bound and 3 mixed.

**Limits.** A later item that moves `replay.ts` to its own entry point can take the cost away from a host that does not replay. No row exists for it, because the cost is under 2%.

## D84 (2026-10-29): `fits` splits a record by a field with few members over a union

**Context.** K178, found by K48 (D79 Limits). An open record has no list of members, because its other fields hold each value. Thus `{a: bool}` did not fit a union of a record for `true` and a record for `false`. A closed record with more than 64 members got no finite rule either.

**Decision.**

- The split rule comes after the finite rule of D79 (TYPE.FITS-FINITE). It starts only for a record against a union, or for a closed record against a `one`.
- The rule takes the first field, in the order of the keys, with a finite list of two or more cases. The members of the field type are its cases. An optional field also has the absent case.
- Each case gives a record with the field narrowed to `{ "one": [value] }`. The absent case of a closed record removes the field. The absent case of an open record gives an optional field of type `never`.
- Each record of the split must fit `expected`. A record tries the rules of the shapes first, then the finite rule if it is closed, then the split of the next such field.
- One call of the rule builds at most 64 records. A larger split gives `false`.
- The rule of `unknown` does not change. A field of type `unknown` has no list, thus it does not split.

**Rejected.**

- The product of all finite fields at once. The product grows with each field, though a split of one field often gives a fit. One field at a time stops at the first record that fits by the shapes.
- A choice of the field that the union tells apart. The first field with cases is simpler, and the next field still splits when the first field does not help.
- A split over a `one` for an open record. Its other fields hold each value, thus no open record with members fits a `one`.
- A larger cap for a closed record with more than 64 members. The split serves such a record with its own bound, and the list of 64 members stays for each other type.

**Why.** Each member of the record has one of the cases at the field. Thus it is a member of one record of the split, and each such record fits `expected`. The rule is sound when `values` is complete, as in D79. One field at a time keeps the work small for the common unions that a field tells apart. The bound of 64 records keeps the worst case at the bound of D79.

**Soundness.** A second generated corpus of TYPE.FITS-SOUND has 120 records and 159 unions of records: 19080 pairs. More than 2000 pairs fit, and more than 50 open records fit only by the split. The test finds 0 counterexamples. A split without the absent case of an optional field finds a counterexample at once.

**Public types.** No type changes. A check accepts some programs that it refused before. The change is a new feature: MINOR before 1.0, in 0.17.0.

**Changed expected values.** One test of TYPE.FITS changes. Before, `{a: bool}` did not fit the union of a record for `true` and a record for `false`. Since D84, it fits. The test also shows `{a: number}` against the same union as a refusal.

**Limits.**

- A split narrows only the fields of the record itself. An open record in a field does not split, for example `{a: {x: bool}}` against a union of `{a: {x: true}}` and `{a: {x: false}}` (K185).
- A split of seven fields of `bool` against a union of its 128 members needs 254 records, thus the rule refuses it.
- A type with more than 64 members that is not a record gets no finite rule.

## D85 (2026-10-29): a domain declares its covers in `covers`, and `fits` trusts them

**Context.** K179, found by K48 (D79 Limits). A language can split a base type into domains, for example `neg` and `nonneg` under `number`. Their union holds each number, but `number` did not fit `neg | nonneg`. A domain had no form to declare such a split.

**Decision.**

- `Domain` gets the optional field `covers`: a list of covers (TYPE.FITS-COVER). A cover is a list of names of domains, and its domains together hold each member of the domain.
- The line rule: each name of a cover is a domain under the covered domain, through each level. A cover that is empty, or that names the domain or a name that is not under it, does not count. `fits` ignores it and does not throw.
- The cover rule comes after the finite rule of D79. It starts only for a base type against a union or a `one`. The base type fits when a domain of its line has a cover, and each domain of the cover fits `expected`.
- A domain of a cover gets the rules of the shapes, then the finite rule, then its own covers. Thus covers nest: `number` fits `neg | zero | plus` when `zero` and `plus` cover `nonneg`.
- Each domain of a cover costs one step. One call of the rule takes at most 64 steps, and a larger test gives `false`. A domain on the way gives `false`, thus a cycle of covers ends.
- The rule of `unknown` does not change. A name without a domain reads as `unknown`, and the line rule refuses it in a cover.
- `extendDomain` keeps the covers, and `DomainExtension.covers` adds covers. A cover that the domain has already does not change. `mergeMachines` compares the covers as it compares the parents.

**Rejected.**

- A cover in the domains of the split, for example a field `part` in `neg` and in `nonneg`. Then no one domain holds the full claim, and a merge cannot compare it.
- A cover with a name outside the line. A name without a domain then reads as `unknown` and fits each type. The line rule also makes each cover a split of the domain, thus samples of the domain alone test it.
- A cover rule for a base type against a record, a list or a base type. A common refusal, for example `number` against `text`, then does more work, and no known language needs it.
- A cover rule in the split of a record. The split then builds records for each domain of each cover. The row K186 keeps this idea.
- `covers` without a change of `DomainExtension`. A language that splits a kernel domain then must replace the domain, and two such languages conflict.

**Why.** A language knows how its domains split a base type, as it knows its `values`. A declaration on the covered domain keeps the claim in one place. The line rule keeps each domain of a cover inside the covered domain. Thus a member of a found type is in one domain of the cover, and that domain fits `expected`.

**Soundness.** `fits` trusts each cover, as it trusts `values` (D79) and `truthType` (D81). The TSDoc of `Domain.covers` and of `fits` tells it.

A third corpus of TYPE.FITS-SOUND has 160 types and 25600 pairs over a language with true covers. More than 3000 pairs fit, and more than 200 of them fit only by a cover. The test finds 0 counterexamples. The same corpus with a false cover of `number` finds counterexamples at once. The test helper `falseCovers` finds the false cover from samples of the domain. The row K187 adds this test to `conforms`.

**Public types.** `Domain.covers` and `DomainExtension.covers` are new optional fields. A check accepts some programs that it refused before. The change is a new feature: MINOR before 1.0, in 0.17.0.

**Changed expected values.** No expected value of an earlier test changes. No domain of an earlier test declares a cover.

**Limits.**

- The language keeps each cover true. A false cover makes `fits` unsound for that domain.
- A new parent of a domain in a cover can make the cover false, because the domain then holds fewer members. A new parent of the covered domain keeps the cover true. K187 tests such a cover from samples.
- A split of a record does not use a cover, thus `{a: number}` does not fit `{a: neg} | {a: nonneg}` (K186).
- The rule takes at most 64 steps. It tests each full domain of a cover, not only the members that the domain shares with the found type.

## D86 (2026-10-29): `conforms` tests the declared truth of a profile on the members of `truthType`

**Context.** K181, found by K50 (D81 Limits). The check of types trusts `truthType`: the own `truthy` of a profile gives a truth for each member of the type. A member without a truth makes the check unsound at that place. No test examined this promise.

**Decision.**

- `conforms` gets the check `truth` (CONFORM.TRUTH). It examines `formula.if`, `formula.and` and `formula.or` of the formula kit, because only these evaluators read `truthy`.
- The check starts only for a profile with an own `truthy` and a `truthType`. A profile without them gets no check, as the check of types needs `bool` or nothing there (D81).
- A truth is `true` or `false`. `truthy` breaks the check when it throws for a member, or when it gives another value. `undefined` counts as no truth, because the run then gives `#VALUE!`.
- A type with at most 64 members gives each member, from the lists `values` of its domains (D79). A union tests each of its types alone. Each other type gets the values of the palette of results that are its members.
- A value outside `truthType` gets no test. The check of types refuses such a test or term, thus its truth does not count.
- A `truthType` with a type issue gets no test. The check of types gives its issue (D81).
- The kit records the declared truth of each of the three evaluators. `conforms` reads that record, thus a machine that holds the evaluators of the kit gets the check.

**Rejected.**

- A new function next to `conforms` for a profile. `conforms` already examines each evaluator of the kit, and a test of a language already uses it.
- A new option with the samples of a type. The option `results` already gives the values of the palette, and they are the samples.
- A check of `truthy` through the code of `if` with each member. An error of the code then has two possible causes, and the finding cannot name the member.
- A test of each value of the palette. A value outside `truthType` has no promise, thus a finding there is false.

**Why.** The declaration is a promise of the language, as C8 is. A test of each member that the kernel knows finds a false promise before a document evaluates. The same helper gives members for the test of covers of K187.

**Public types.** `Obligation` gets the value `truth`. A switch over the obligations sees a new case. The change is a new feature: MINOR before 1.0, in 0.17.0.

**Changed expected values.** No result of `conforms` for an existing machine or test changes. No such profile has a `truthType`. The new tests are in `conform.test.ts`.

**Limits.**

- The palette has few values. A `truthType` without `values`, for example `number`, gets only the samples `1` and `2`. K188 adds samples of a domain.
- An evaluator of a language that replaces `formula.if` gets no check, because the kit did not make it.

## D87 (2026-10-29): a cause that is a list or a record with an exception gets the part rule in `causeParts`

**Context.** K182, found by K177 (D82 Limits). Since D82, a list field and a record field of an exception keep their parts. A cause had no such rule. Thus the cause `{ inner: error }` of an exception was the name `cause` in `dropped`. The same cause of an error value was a refusal of `encodeLog`.

**Decision.**

- A cause can be a list or a plain record with an exception at some depth and without a term document. It is then the new field `causeParts` (RUN.REPLAY-CAUSE-PARTS).
- The value of `causeParts` is a list of parts or the part `record`, as a field in `parts` (D82). The new type `ReplayCausePartsJson` is this value.
- The rule is the same for the cause of an exception and of an error value. `ReplayExceptionJson.causeParts` and `ReplayErrorJson.causeParts` are optional.
- An item without a form has the name `cause`, a dot and its key or index, for example `cause.send`. An exception keeps the name in its `dropped`. An error value gets the optional list `dropped` for it.
- Each exception in the cause has the rule of a cause, also a `loop`. The walk takes the cause after `parts` and `hidden`, as in D78. A cause of an error value has no outer exception, thus its first exception has the index 0.
- A record in the cause that holds the exception itself is a `loop`. A record that is again on its way is a cycle and a name in `dropped`, as in D82. Thus each walk ends.
- A cause without an exception keeps its rule. A cause of an exception without a form is the name `cause` in `dropped`. Such a cause of an error value is a refusal (D75).
- `decodeLog` gives a new list or plain record as the cause. The cause of an exception stays a field that is not enumerable.
- One walk writes each cause without a term document, and one walk reads it. Thus the error value and the exception share the code.
- The form stays at the version 1. The new fields are optional, and an old log decodes as before.

**Rejected.**

- A part in the field `cause`. `cause` holds a term document, and a JSON list or the record `{ "record": ... }` is also a term document. A reader then cannot tell the two forms apart.
- A part in the field `exception`. It holds the form of an exception, and a list there gives two shapes to one field.
- The cause in `parts` with the key `cause`. A field of `parts` is enumerable, and the cause is not. `decodeLog` then needs a rule for one key.
- The rule of D82 for each container cause, also without an exception. Then a cause of an error value without a term document is not a refusal, and D75 keeps that refusal. The row K189 keeps the idea for the cause of an exception.

**Why.** The cause holds the same facts as a field of D82, thus it gets the same part rule. A field of its own keeps the term document in `cause` exact and each old log readable. One walk for both causes keeps one order and one rule for `loop`.

**Public types.** `ReplayExceptionJson.causeParts`, `ReplayErrorJson.causeParts` and `ReplayErrorJson.dropped` are new optional fields, and `ReplayCausePartsJson` is a new type. A refusal of `encodeLog` becomes a value. `encodeLog` and `decodeLog` are not in a release before 0.17.0. The change is a new feature: MINOR before 1.0, in 0.17.0.

**Changed expected values.** One test of RUN.REPLAY-FIELDS changes. Before, the cause `{ inner }` of an exception was the name `cause` in `dropped`. Since D87, it is `causeParts` with the part `record`.

**The golden file.** `packages/core/golden/replay.json` does not change. Its exception is a `TypeError` without a cause.

**Limits.**

- A container cause without an exception keeps the short rule. Thus the cause `{ code: 7, send: () => 1 }` of an exception loses `code`. The row K189 keeps this idea.
- `decodeLog` gives two records for a record that a field and the cause share, as in D82. The row K183 keeps this idea. Since D87, one read walk serves each cause, thus K183 changes one place.

## D88 (2026-10-29): a list or a record that two places of an error share is the part `share`

**Context.** K183, found by K177 (D82 Limits). Since D82, a list and a record of an exception keep their parts. A container that two fields share got a form at each place. Thus `decodeLog` gave two records, and only the exceptions in them stayed the same by `loop`. A container that holds itself was a cycle and a name in `dropped`, for example `ring.self` or `cause.self`.

**Decision.**

- A list or a record of parts that an earlier place of the walk holds is the new part `{ "share": n }` (RUN.REPLAY-SHARED). The walk is the one walk of an error value: its parts, its hidden fields, its causes and its chain.
- The index `n` counts the lists and the records of parts in the order of the walk. The count starts at 0 for each error value, as the count of `loop` does. `decodeLog` meets the containers in the same order, thus each share gives the same object.
- A container that holds itself is a share too. The walk gives a container its index before its items, thus a share to an outer container is exact. The walk does not need the test of D82 for a container on the way.
- `causeParts` also takes the part `share`, for a cause that a field holds. The walk takes the cause last, thus the field has the record, and the cause has the share.
- A hidden list keeps its marks also without a form (D78). When a field and a hidden list share a list, the field gets the marks, and the hidden list is the share.
- A container without a form in it stays one name in `dropped` (D82). A share of it is the name of its own place. A cycle without another form also has no form.
- A share replaces a container only where the walk makes a container. A term document stays a term document, and a cause without an exception keeps its rule (D87).
- The form stays at the version 1. The part `share` is optional, and an old log decodes as before: each record of parts gives a new record.

**Rejected.**

- An index in `loop` for a container too. A `loop` is the index of an exception, and an old log reads each `loop` as that index. One count for both kinds changes each `loop` of a log with containers.
- A path to the first place, for example `["parts", "a"]`. A path is longer, and it changes when a key of an earlier field changes. An index has the rule of `loop`.
- A field `id` on each record of parts. It adds a field to each container, also to a container at one place. Most containers have one place.
- A share for a term document. `encodeValue` has no identity for a value (D40), and a reader of `fields` then needs a second rule. The row K190 keeps this idea.
- A share only for a cycle, and a copy for a container that two places share. Both are the same fact of the host: one object at two places.
- A cycle as a name in `dropped`, as in D82. The share keeps the cycle exact with one number, as `loop` does for a cycle of causes.

**Why.** `loop` already keeps one exception at more than one place. A share gives the containers the same rule, thus `decodeLog` gives the same graph of objects as the host. The walks of D87 serve each cause, thus one change of `causeJson` and `readCause` covers each place.

**Public types.** `ReplayPartJson` and `ReplayCausePartsJson` get the member `{ share }`. A switch over the parts sees a new case. The form of a shared or a cyclic container changes. `encodeLog` and `decodeLog` are not in a release before 0.17.0. The change is a new feature: MINOR before 1.0, in 0.17.0.

**Changed expected values.** Three tests change.

- RUN.REPLAY-FIELDS, a nested record: before, `ring.self` was a name in `dropped`, and `b` was a second record with a `loop`. Since D88, `ring.self` is `{ share: 3 }`, and `b` is `{ share: 4 }`. `decodeLog` gives `b` as the record of `a`.
- RUN.REPLAY-CAUSE-PARTS, a cycle of records: before, `cause.self` was a name in `dropped`. Since D88, it is `{ share: 0 }`.
- RUN.REPLAY-CAUSE-PARTS, a list cause of an error value that holds itself: before, its last item was a mark, and `cause.3` was in `dropped`. Since D88, the item is `{ share: 0 }`.

**The golden file.** `packages/core/golden/replay.json` does not change. Its exception is a `TypeError` without fields.

**Limits.**

- `encodeValue` writes a list or a record without an exception and without a function as a term document. Two places that share it give two copies. The row K190 keeps this idea.
- A cause without an exception keeps its rule, also when a field shares it. K189 gives such a cause a form, and the share then follows.
- A share counts in one error value. Two effects of a log that share a container give two objects.

## D89 (2026-10-29): a split of `fits` narrows a field of a record in a field by its path, with one budget at each depth

**Context.** K185, found by K178 (D84 Limits). The split of D84 narrows only the fields of the record itself. Thus `{a: {x: bool}}` did not fit a union of `{a: {x: true}}` and `{a: {x: false}}`. Also, each split had its own bound of 64 records. A split in a field of a record of a split got a new bound, thus nested splits multiplied the work, as nested unions do.

**Decision.**

- A split takes a path of keys to a field (TYPE.FITS-PATH). A path goes into a field when the field is a record without a finite list. Such a record is open, or it is closed with more than 64 members.
- The field at the end of the path has a finite list of two or more cases, as in D84. Each case gives a copy of the record with the field at the path narrowed. The other fields at each depth do not change.
- The absent case at a depth follows D84. A closed inner record loses the field, and an open inner record gets an optional field of type `never`.
- The order: the fields of the record first, in the order of the keys, as in D84. Then the paths of the next depth follow, in the order of the outer key and then the inner key, and so on.
- A path does not go into a union in a field. A field of a union without a finite list does not split.
- One budget of 64 records serves the outer split and each split inside its work, at each depth. A split in a field that the rules of the shapes start in a record of the split takes from the same budget. A larger split gives `false`.
- The rule of `unknown` does not change. A field of type `unknown` has no list and is not a record, thus no path goes into it.

**Rejected.**

- A path through a union in a field. The members of such a union are types, not values. A split by types is the same idea as a split by a cover (K186), thus both get one design. The row K191 keeps it.
- Paths first, then the fields of the record. The order of D84 then changes for each record, and a shallow split decides most fits with fewer records.
- A depth-first order, for example `a`, `a.x`, then `b`. Each record of a split then splits the whole subtree of one field before the next field. A field of the record itself narrows more members with one split.
- A budget for each call of `fits`. The check then makes a budget for each call, also for the many calls without a split. The budget of the outer split costs nothing on the common path, and splits beside each other add their work, they do not multiply it.
- A larger budget. The tests need at most 62 records, and the bound of 64 keeps the worst case at the bound of D79 and D85.

**Why.** Each member of the record has a value at the path, or it lacks the field. Thus it is a member of one record of the split, and each such record fits `expected`. A member that lacks a record on the path is in each record of the split. The rule is sound when `values` is complete, as in D79. The order of D84 stays a prefix of the order, thus each fit of D84 builds the same records.

**The bound of D84.** Before, one call of the split rule built at most 64 records, and a split in the work of each record had its own 64. Since D89, the 64 records serve the whole outer split, at each depth. Thus a pair that needs more than 64 records in nested splits gets `false`.

An example is a record with `b: bool` and five `bool` fields in `a`. Against two records for `b`, each with a union of 32 inner records in `a`, the split needs 126 records. The rule refuses it.

**Soundness.** A fourth corpus of TYPE.FITS-SOUND has 120 nested records and 274 unions: 32880 pairs. The records are open and closed at each depth, with optional fields, and with inner records at two depths. More than 450 pairs fit, and more than 100 of them fit only by a path. The test finds 0 counterexamples. A split without the absent case at a depth finds a counterexample at once.

**Public types.** No type changes. A check accepts some programs that it refused before. The change is a new feature: MINOR before 1.0, in 0.17.0.

**Changed expected values.** No expected value of an earlier test changes. The earlier tests of the split need at most 30 records in one outer split.

**Limits.**

- A path does not go into a union in a field, for example `{a: {x: bool} | {y: null}}` against a union of three records (K191).
- A split does not use a cover, also at a depth (K186).
- Two outer splits beside each other, for example in two fields that the rules of the shapes test, each get a budget of 64 records.

## D90 (2026-10-29): a split of `fits` narrows a field to each domain of a cover or each member of a union

**Context.** K186, found by K179 (D85 Limits), and K191, found by K185 (D89 Limits). The split of D84 takes its cases only from the members of a field. Thus `{a: number}` did not fit `{a: neg} | {a: nonneg}`, though `neg` and `nonneg` cover `number`. Also a path of D89 stopped at a union in a field, because the members of a union are types, not values.

**Decision.**

- A split has value splits and type splits (TYPE.FITS-SPLIT-TYPE). A value split has the members of a field, as in D84. A type split has case types.
- A field of a base type without a finite list gets a type split when its line has a valid cover. The cases are the domains of that cover. The line rule of D85 decides if a cover is valid.
- A field of a union without a finite list gets a type split. The cases are the members of the union (K191).
- The order: each value split comes first, in the order of D89. Then the type splits follow, in the same order of depths and keys.
- A record of a type split that does not fit splits its case again, at the same path, before the next split. A case with a finite list splits by its members. A base type splits by a cover of its own domain. A union splits by its members, and a record splits by the paths into its fields.
- The cover of a field is the first valid cover of the first domain of its line that has one. The line starts at the domain of the field, then its parents follow.
- An optional field also gives the absent case, as in D84 and D89. Each case costs one record of the shared budget of D89.
- `fits` trusts each cover, as in D85. The rule of `unknown` does not change.

**Rejected.**

- Type splits in the order of the keys among the value splits. Then a fit of D89 can build other records and use more of the budget. With the type splits last, the order of D89 is a prefix, and each fit of D89 builds the same records.
- A test of each cover of a field. The split then searches over the covers, and each failed cover uses the budget of the others. The cover rule of D85 still tests each cover for a base type alone. The row K192 keeps the idea.
- A cover of a parent for a case that splits again. The covers of the parents hold the case already, thus they give the same cases again. A cycle of such splits only uses the budget.
- A second budget for the type splits. Then nested splits multiply the work again, and D89 removed that.
- A separate design for K191. A member of a union is a case type, as a domain of a cover is. Thus one form of split serves both, with a small change.

**Why.** A cover holds each member of its domain, and a union holds each member of its members. Thus each member of the record is a member of one record of a type split. A domain of a cover of a parent holds more members than the field, thus the split stays sound. The rule is sound when `values` and `covers` are true, as in D79 and D85.

**Soundness.** A fifth corpus of TYPE.FITS-SOUND holds 120 records with covered fields, union fields and inner records. Its unions hold the type splits of each record by the covers of the language, at one or two paths. The corpus has more than 20000 pairs, and more than 100 of them fit. More than 40 pairs fit only by a split, and more than 20 fit only by a cover. Since K193, the test pins the exact counts: 29280 pairs, 1176 fits, 374 split fits, 144 cover fits and 11760 checked members.

The test finds 0 counterexamples. The same corpus with a false cover of `number` finds counterexamples at once.

**Public types.** No type changes. A check accepts some programs that it refused before. The change is a new feature: MINOR before 1.0, in 0.17.0.

**Changed expected values.** Two tests change.

- TYPE.FITS-COVER: before, `{a: number}` did not fit `{a: neg} | {a: nonneg}`. Since D90, it fits (K186).
- TYPE.FITS-PATH: before, `{a: {x: bool} | {y: null}}` did not fit a union of three records. Since D90, it fits (K191).

**Limits.**

- A split uses one cover of a field. Thus `{a: number}` does not fit `{a: lo} | {a: hi}` when `neg` and `nonneg` are the first cover of `number` (K192).
- A cover of a parent gives cases with more members than the field. Such a case fits less often than a cover of the domain of the field.
- Two outer splits beside each other each get a budget of 64 records, as in D89.

## D91 (2026-11-01): a run gives the host no effect that its parent cannot wait for

**Context.** K202, from the change audit of 2026-11-01. D38 drives a runner under an evaluator in a run, and its effects go to `perform`. A host that waits does the effect at once. Then the drive drops the promise and gives `#CALC!`. Thus the effect happened, and the run lost its answer. A retry after the `#CALC!` did the effect again.

**Decision.**

- In a run, an effect under a drive without a wait does not go to `perform` (RUN.HELD). The effect keeps the outcome `#CALC!`.
- The effect stops the drive. Thus the runner gives the `#CALC!` of the check with the option `run`, at its place and with its reason.
- The plan and the reference count the active drives without a wait. The count is not in the public types.
- A runner under an evaluator without effects still runs (D38). A branch with an effect that does not run does not stop the drive.
- RUN.SAME gets a condition: no runner under an evaluator causes an effect.

**Rejected.**

- Option A: keep D38. A host answers at once or with a promise, and only the call tells which. Thus each effect that waits is lost after the host did it.
- Option B: keep the answer of the promise for the effect when it settles. The run still gives `#CALC!`, and a retry still does the effect again.

**Public types.** No type changes. A run of `add[1, log[x]]` with a host that answers at once gives `#CALC!`, not the answer of the host. The change is a fix: PATCH before 1.0.

**Changed expected values.** RUN.NESTED-WAIT: the effect has the outcome `#CALC!`, not `undefined`. RUN.DRIVE-NESTED: a host that answers at once gives the `#CALC!` of a host that waits.

## D92 (2026-11-01): the release age exclude names packages, not scopes

**Context.** K203, from the change audit of 2026-11-01. `pnpm-workspace.yaml` removed the release age check of pnpm for all of `@mark1russell7/*` and `@procedures/*`. A stolen token of one of these scopes can publish a bad version, and an update installs it at once.

**Decision.**

- The exclude names the four own packages that this repository uses: `conventions`, `cue`, `ste-lint` and `template-cli`.
- Each other package keeps the release age check. This repository uses no package of `@procedures`.
- A new own dependency gets a line in the exclude only when its updates cannot wait for the check.

**Rejected.** (A) No exclude. Then a fix of `conventions` waits a full day before a repository can use it. (B) The two scopes, as before. They expose each package of the scopes, also the packages that this repository does not use.

**Public types.** No change.

## D93 (2026-11-01): the release age exclude keeps the two own scopes

**Context.** K205. D92 named four own packages in the release age exclude. The release train writes the two scope patterns into each repository, and it removes narrower entries. Thus D92 gets a settings PR that undoes it.

**Decision.**

- The exclude keeps `@mark1russell7/*` and `@procedures/*`. This decision reverts D92.
- OIDC trusted publishing with provenance covers a stolen-token publish of an own package.
- The template adds the pnpm setting `trustPolicy: no-downgrade`. It refuses a version with less trust evidence than an earlier version.
- The audit finding about the exclude is a policy decision, not a defect.

**Rejected.** (A) Keep D92. The release train undoes it. (B) No exclude. Then a fix of an own package waits a full day before a repository can use it.

**Public types.** No change.

## D94 (2026-11-01): `conforms` tests the covers of a machine from samples

**Context.** K187, found by K179 (D85 Limits). `fits` trusts each cover of a domain. A new parent of a domain in a cover can make the cover false, and no check found it. A test helper of `types.test.ts` found a false cover from samples, but `conforms` did not use it.

**Decision.**

- `conforms` gets the check `cover` (CONFORM.COVER). Each sample of a covered domain must be in one domain of each cover of the domain.
- The new obligation `cover` holds the finding. A false cover is a false promise of the language, not a fault of `truthy`, thus it does not reuse `truth`.
- The samples of a domain come from its list `values` (D79). A domain without such a list gets the values of the palette that are its members, as in D86.
- A cover that does not count by the line rule of D85 gets no test, because `fits` ignores it. A sample outside the covered domain gets no test either.
- Each evaluator and each runner gets the check, because the check of types trusts a cover for each program.
- The finding names the sample, the covered domain and the cover. Its probe gives the sample to each part of the first probe document, as for `truth`.
- The function `falseCovers` of `types.ts` does the test. `conforms` and the tests of `fits` use it. The kernel does not export it, as `membersOf`.

**Rejected.**

- The obligation `truth` for a false cover. A finding of `truth` then has two causes, and a reader cannot tell them apart.
- A new function next to `conforms` for the covers. A language already tests its code with `conforms`, and D86 rejected such a function too.
- A check of the covers in `mergeMachines` or in `extendDomain`. These functions have no samples, and a merge then gets slower for each language.
- A second sampler in `conform.ts`. The helper of `types.test.ts` already holds the test, thus the kernel moves it and keeps one copy.

**Why.** A cover is a promise of the language, as `truthType` is. `conforms` already tests such promises from samples. Thus a new parent that makes a cover false gives a finding before a check of types trusts it.

**Public types.** `Obligation` gets the value `cover`. A switch over the obligations sees a new case. The change is a new feature: MINOR before 1.0.

**Changed expected values.** No result of `conforms` for an existing machine or test changes. No such machine declares a cover. The new tests are in `conform.test.ts`. `types.test.ts` uses the kernel function, and its findings are records, not texts.

**Limits.**

- The palette has few values. A domain without `values`, for example `number`, gets only the samples `1` and `2`. K188 adds samples of a domain.
- The check reports the first false cover only, as each check of `conforms` reports its first finding.

## D95 (2026-11-02): each numeric limit of a unit test is derived, or goes

**Context.** K200. The gate rule of 2026-10-30 says that a limit comes from 5 or more CI runs. The limit is the worst value plus the spread of the values. Six limits of the unit tests were guesses.

**Decision.**

- A unit test does not measure wall-clock time. The limits of STATIC.LINEAR (5000 ms), PLAN.COMPILE-SPEED (2000 ms) and FORMULA.SPEED (2000 ms) go. The tests keep their results.
- The bench measures FORMULA.SPEED and PLAN.COMPILE-SPEED. Both were bench cases already.
- The claim of STATIC.LINEAR is linear time. One walk gives no ratio, thus K208 compares the times of N and 2N levels in one process.
- The abort test of RUN.FAIL-FAST checks that the results come before the slow effect finishes. The 150 ms limit goes.
- The workflow `measure` runs PLAN.LEAN and WORLD.LAWS on 5 runners and prints the values. The limit of PLAN.LEAN is the worst value plus the spread of the values.
- The seeds of WORLD.LAWS are fixed, thus its counts are the same in each run. The test pins them exactly.

**Measures (2026-11-02).** PLAN.LEAN measures the retained bytes of each plan. The test starts `gc()` before both readings of the heap, and the plans stay alive.

- The inputs are fixed, and `prepare` reads no clock and no random number. But the first 4 measure runs gave 20 values from 384.2 to 404.0 bytes.
- An A/A in one process measured the same plans 6 times. Two processes each gave 403.7, 392.7, 392.2, 392.3, 392.2 and 392.2 bytes.
- Thus the plans keep 392.2 bytes. The first measure also counted code and feedback of V8, because the warm-up had only 100 documents.
- The warm-up is a full round of the 10000 documents. The measure run 41381230112 then gave 392.4, 393.5, 393.3, 392.3 and 393.3 bytes.
- The limit is 393.5 + 1.2 = 394.7, thus 395 bytes. WORLD.LAWS gave 313 merges of worlds and 180 merges of machines in each run.

**Rejected.**

- A time limit from 5 runs in the unit tests. The tests share one process with other files, and the A/A noise of such a measure is not well inside a limit.
- A gate on the bench. The bench verdict reports and does not block a merge (D50, D70).
- The worst value times 1.1. The factor 1.1 is a guess too. The first limit of K200 used it and gave 444 bytes.
- A limit from the values of the warm-up of 100 documents. Their spread of 19.8 bytes came from V8, not from the plans.
- A bench case of a deep walk. A sample has at least 1000 calls, and a walk of 1000 levels took 3.7 ms. Thus each bench job went past its 10 minutes.

**Why.** A guessed limit fails at random, or it does not fail at any time. A derived limit fails when the value really changes.

**Changed expected values.** No result of the kernel changes. The tests lose their time limits. The limit of PLAN.LEAN goes from 600 to 395 bytes, and WORLD.LAWS gets exact counts.

**Correction (2026-11-05).** D161 replaces this limit. It is 401.1 bytes, from 99 jobs.

**Since D104.** The limit of PLAN.LEAN applies only in the job `measure`, the job that measured it. The job `checks` applies no limit of PLAN.LEAN.

## D96 (2026-11-02): a seeded property test splits its corpus into parts of a fixed size, and CI checks the share of the timeout

**Context.** K206 and K207. CI runs the property tests of `packages/core` with `COEVAL_AGREE_COUNT` 2000 and the fixed seed 1. Thus each test does fixed work. On a slow runner, TYPE.SOUND took 5.4 s, over the timeout of 5 s. On main, ten tests took 2.0 s to 3.7 s. A slow runner doubles such a time.

**Decision.**

- The function `corpus` of `src/corpus.test-support.ts` splits the indexes of a corpus into parts of a fixed size. Each part is one test with the default timeout.
- The parts give the same indexes in the same order as one loop. Thus the seeds and the documents do not change.
- Each part checks its own documents. A last test checks the totals of all parts. It first checks that each part finished.
- Some tests advance one source of random numbers from document to document. These tests use `inOrder`. It makes each document one time, in the order of the indexes.
- Thus a later part gets the same documents as one loop, also when a filter skips the earlier parts.
- The corpora of TYPE.FITS-SOUND first sample the members of each record, in the order of the loop. The checks read no random number, thus the members do not change.
- The name of each part stays a literal `it("[ID] ...")` at the call site. Thus the gate of `spec.test.ts` finds the ID, and the gate does not change.
- The size of a part comes from the time on main at the count 2000. The sizes aim at approximately 0.6 s or less for each part on main.
- The sizes are 1000 documents for TYPE.SOUND, TYPE.TRUTH-SOUND, EVAL.SEALED, EVAL.DETERMINISTIC and CAP.MONOTONE. SEQ.LAWS has parts of 400, and RUN.AGREES-EQUATIONS has parts of 300.
- The two corpora of type splits (D90) have parts of 40 records. The corpus of nested records (D89) has parts of 30 records.
- A part has no own timeout. The split tests lose their timeouts of 120 s and 300 s.
- SCHED.LONG-CHAIN has no seeded corpus, and its claim is the absence of `#DEPTH!`. A one-off measurement on Node.js 24 found the depth of the overflow.
- A demand through lazy edges overflowed at 600 to 800 nodes. S2a found approximately 1000 nodes. The chain has 2000 nodes, twice that depth.
- The test first shows that the same chain through lazy edges gives an error on the host. Thus a host with a deeper stack makes the test fail, not pass with no proof.
- The reporter `ShareReporter` of `vitest.share.ts` divides the duration of each test by its timeout. Only in CI, it writes the 5 slowest tests to the step summary.
- It prints a warning when the slowest share is above 0.4. It fails the run when the slowest share is above 0.6.
- The timeout stays a detector of a hang. The claims of speed stay in the bench.

**Rejected.**

- A higher timeout. Then a hang shows later, and the timeout becomes a gate of speed.
- A smaller count in CI. Then CI examines fewer documents.
- A helper that calls `it` with a computed name, or `it.for` of vitest. Then the gate of `spec.test.ts` does not find the ID.
- A wider pattern in the gate. A name from a template literal can then hide a typing error in an ID.
- A part size that grows with the count. The parts have a fixed size, thus a nightly run with more documents gets more parts, not longer parts.
- A ratio gate of 2000 and 4000 nodes for SCHED.LONG-CHAIN. Its claim is the absence of `#DEPTH!`, not linear time.
- A chain of 100000 nodes. The work beyond twice the depth of the overflow proves nothing more, and it took 2.7 s and approximately 730 MB.

**Why.** A test of fixed work far below its timeout passes on a slow runner. The share check finds a test that grows toward its timeout before a slow runner fails it.

**Public types.** No change. The index does not export the helper, and the `files` of the npm package exclude it.

**Changed expected values.** No expected value changes. The split tests have new names: one name for each part and one for the totals. The row SCHED.LONG-CHAIN of SPEC.md says 2000 nodes.

**Limits.**

- The share check reads the timeout of each test. Some tests keep a timeout of 120 s or 300 s, thus their shares stay small.
- These tests include DURABLE.SOUND, FACTS.SOUND, SCHED.ONE-MEANING and READS.SOUND, with 1.5 s to 1.9 s on main.
- A part with a shared random stream keeps each earlier document of its stream. A corpus of 4000 small documents keeps a few MB.
- A chain of lazy edges that overflows the stack can give `#CYCLE!`, not `#DEPTH!`. Its nodes are on no cycle. The test of SCHED.LONG-CHAIN accepts each error there.

## D97 (2026-11-02): a log-log ladder measures the slope of the walks of STATIC.LINEAR

**Context.** K208. STATIC.LINEAR says that a walk takes time and memory linear in the size of the document. A one-off local measure of `refsOf` gave 3.7 ms at 1000 levels and 11.7 ms at 2000 levels. That ratio of 3.1 is not the ratio 2 of a linear walk. One ratio cannot tell a constant factor from a power.

**Decision.**

- The script `packages/core/bench/ladder.ts` measures two walks: `refsOf`, and `walk` with a visit that only counts.
- Each walk goes over documents of 250, 500, 1000 and 2000 levels of `op("add", doc, 1)` around one reference.
- All rungs run in one process, in turns. Each round has 5 passes. The order turns by one place in each pass, and it goes back to front in each second round.
- The time of a rung in a round is the median of its passes. Each sample walks 2000 levels: 8 calls at 250 levels and 1 call at 2000 levels.
- Two rounds warm up the compiler first. Then 30 rounds count.
- Each round fits the slope of log t against log n by least squares. A linear walk gives 1, and a walk of the square of the size gives 2.
- The A/A arm is a second document of 1000 levels, made in the same way. Its ratio to the first document shows the noise of one rung.
- The interval is the median of the rounds and their 5th to 95th percentile. The mode `merge` pools the rounds of the runs.
- A run counts only when the A/A band of each walk contains 1.0. Else the run measured the runner, and a new run replaces it.
- The claim is linear when the pooled interval contains 1.0 and its upper end is less than 1.2.
- The workflow `measure.yml` starts the ladder on 5 runners, at most 3 at one time. The job `ladder-verdict` pools them.

**Measures (2026-11-02).** The measure run 41420165848 gave 5 counted runs and no excluded run. The CPUs were 4 AMD EPYC 7763 and 1 AMD EPYC 9V74.

| Run | Slope of `refsOf` | Slope of `walk` | A/A band of `refsOf` | A/A band of `walk` | Ladder (s) | Job (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0.999 (0.964 to 1.049) | 1.001 (0.924 to 1.071) | 0.870 to 1.131 | 0.932 to 1.026 | 13.2 | 39 |
| 2 | 1.003 (0.957 to 1.065) | 0.994 (0.921 to 1.075) | 0.843 to 1.072 | 0.871 to 1.203 | 14.5 | 40 |
| 3 | 0.996 (0.933 to 1.068) | 1.000 (0.919 to 1.055) | 0.870 to 1.022 | 0.967 to 1.107 | 15.4 | 46 |
| 4 | 0.996 (0.905 to 1.049) | 1.004 (0.957 to 1.046) | 0.873 to 1.116 | 0.856 to 1.111 | 13.4 | 51 |
| 5 | 0.999 (0.947 to 1.051) | 0.996 (0.932 to 1.043) | 0.892 to 1.190 | 0.981 to 1.165 | 13.5 | 41 |

- The pooled slope of `refsOf` is 0.998, with the pooled 90 % interval 0.929 to 1.062. The medians of the runs give 0.999 plus or minus 0.003.
- The pooled slope of `walk` is 1.000, with the pooled 90 % interval 0.922 to 1.062. The medians of the runs give 0.999 plus or minus 0.004.
- The second interval is the mean of the 5 medians plus or minus t times the standard error, with t = 2.132 for 4 degrees of freedom.
- The pooled A/A ratio is 0.999 (0.848 to 1.150) for `refsOf` and 1.002 (0.879 to 1.156) for `walk`.
- On a runner, `refsOf` took 0.96 ms to 1.13 ms at 250 levels and 7.7 ms to 9.0 ms at 2000 levels. The ratio of 1000 to 2000 levels is 2.0.
- The verdict is linear for both walks. The local ratio of 3.1 came from one measure on a shared machine, not from the walk.

**Rejected.**

- A ratio of N and 2N levels. One ratio cannot tell a constant factor from a power, and its noise is the noise of two single times.
- Each rung in its own process. Then the rungs get different compilations and different heaps, and the noise of a process goes into the slope.
- The bench of `paths.ts`. A bench sample has at least 1000 calls, and a call at 2000 levels takes approximately 8 ms (D95).
- A gate on the slope in a unit test. A unit test shares its process with other files, and its rounds differ from the 30 rounds of the ladder. Thus a limit from the ladder does not apply there.
- A drop of a run by eye. A run counts by its A/A band only.

**Why.** A slope of log t against log n separates a constant factor from a power. The A/A arm shows the noise in the same passes, thus a run that measured the runner is visible.

**Public types.** No change. The script is in `bench`, and the `files` of the npm package do not include it.

**Changed expected values.** No expected value changes. The row STATIC.LINEAR of SPEC.md states the measured slopes.

**Limits.**

- The ladder measures time only. Memory has no measure.
- The documents are chains of one kind. A wide document or a document with scopes has no rung.
- The ladder starts on a change of `ladder.ts` or `measure.yml`, and by `workflow_dispatch`. A change of the kernel does not start it.
- No test fails when the slope grows. A new measure needs a dispatch of `measure.yml`.

## D98 (2026-11-02): the bench runs each case in its own processes

**Context.** K210. The bench of `paths.ts` starts new processes for the base, the base again and the head. Before K210, each process ran all 16 cases of `cases.ts` in a fixed order.

Thus a later case ran on the heap and the type feedback of the earlier cases. Another project found that V8 can tenure an allocation site in a later case. That case was then slow in 9 of 40 processes. The A/A arm of the bench cannot see such a change, because both copies of the base have the same order.

**Decision.**

- The bench follows the default of the fleet strategy: each case of a gate runs alone in its own fresh processes.
- A mode run is optional. It only saves processes, and it can keep a case in order only when it has enough processes for the budget.
- The bench thus runs each of the 16 cases in its own processes. The list `TOGETHER` of `paths.ts` names the cases that run in one process. It is empty.
- In each round, each group of cases runs for the three copies in the order of the round. Then the next group starts.
- The mode run of K210 is a record of the effect of the order. It is not a gate. Its verdicts are information.

**The mode run.** The script `packages/core/bench/mode.ts` measures the cases with the head kernel only, in four arms.

- ALONE: a new process runs only one case. Each round has two such processes for each case, A1 and A2.
- IN ORDER: a new process runs all 16 cases in the order of `cases.ts`. This arm stays, thus a later mode run can show if a group is clean.
- GROUP: a new process runs only the cases of `TOGETHER`, in their order. This arm runs only when `TOGETHER` has 2 or more cases.
- Each process uses the flags of `paths.ts`, and a first process calibrates the calls of each sample.
- Each part has 20 rounds. In a round, the A1 processes run in one half and the A2 processes in the other half, in the opposite order.
- The halves change places in each second round. The case order and the places of IN ORDER and GROUP turn in each round.
- The workflow `measure.yml` runs the script in 2 parts of 8 cases, each part on its own runner. The job `mode-verdict` pools the parts with Node only.

**The verdict.** The mode run gives each case the equivalence verdict of the fleet strategy (O83 amendment, with the amendment of the A/A term).

- The ratios of a case are its 20 ratios IN ORDER / A1, one for each round.
- The interval of the median is the 6th to the 15th of the 20 sorted ratios. It is free of a distribution.
- Its coverage is P(6 ≤ Bin(20, 1/2) ≤ 14) = 1005176 / 1048576 = 0.95861.
- The A/A interval is the same interval of the 20 ratios A2 / A1.
- The effect interval E is the interval of the median, wider on each side by half the width of the A/A interval.
- The noise is the median of A2 / A1 minus 1. The budget is the bound of the bench (`merge.ts`, D50, D70).
- Budget = max(1.5 %, 2 × the absolute noise).
- "No change" when E is inside 1 ± budget. "Slower" when the low end of E is over 1 + budget.
- "Faster" when the high end of E is under 1 − budget. Else "cannot decide".
- Only "no change" keeps a case in order. Each other verdict splits the case, because a false split costs only processes.
- The GROUP arm gets the same verdict with its ratios GROUP / A1.

**The first rule.** The prediction of K210 pinned a first rule, and the tables keep it as information.

- A process is slow for a case when its IN ORDER time is over the maximum of the 20 ALONE times of that case.
- A case has a mode when 5 or more of its 20 IN ORDER processes are slow.
- With no mode, each IN ORDER process is over the ALONE maximum with the probability 1/21. Then 5 or more of 20 have a probability under 0.5 %.
- That rule sees only a slower case. The first measure also found two cases that are faster in order.

**First measure (2026-11-02).** The measure run 41426813620 had the arms ALONE and IN ORDER only, with one ALONE process for each case in a round. Part 1 had an AMD EPYC 9V45, and part 2 had an Intel Xeon Platinum 8370C. The ratio is the IN ORDER median divided by the ALONE median.

| Case | Part | Alone median (ns) | Alone max (ns) | In order median (ns) | In order / alone | Slow | Mode |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| FORMULA.SPEED formula | 1 | 107.4 | 137.1 | 107.7 | 1.003 | 0 of 20 | no |
| the same formula, with a list of reads | 2 | 264.2 | 281.7 | 268.0 | 1.014 | 1 of 20 | no |
| a reference of five steps | 1 | 74.6 | 77.8 | 109.8 | 1.472 | 20 of 20 | yes |
| a reference into a host thing with resolve | 2 | 170.1 | 174.2 | 226.0 | 1.329 | 20 of 20 | yes |
| a reference through an envelope | 1 | 200.3 | 456.0 | 218.9 | 1.093 | 0 of 20 | no |
| a reference with a step document | 2 | 201.8 | 211.3 | 258.0 | 1.278 | 20 of 20 | yes |
| resolve without hops, five steps | 1 | 37.6 | 39.5 | 73.9 | 1.968 | 20 of 20 | yes |
| PLAN.FOLD a record of 20 literals | 2 | 24.9 | 25.6 | 29.0 | 1.162 | 20 of 20 | yes |
| PLAN.TOTAL a record of 20 literals, without folds | 1 | 597.5 | 621.0 | 661.4 | 1.107 | 20 of 20 | yes |
| PLAN.FIXED a path of four steps from a fixed name | 2 | 39.0 | 39.4 | 41.6 | 1.066 | 20 of 20 | yes |
| PLAN.PATH the same path, without the declaration | 1 | 77.2 | 80.5 | 115.0 | 1.490 | 20 of 20 | yes |
| PLAN.FIXED a formula with a fixed name and a free name | 2 | 108.7 | 112.2 | 161.3 | 1.485 | 20 of 20 | yes |
| a tree with an equation | 1 | 5643.8 | 6207.9 | 5691.0 | 1.008 | 0 of 20 | no |
| the same tree, with a list of reads | 2 | 12030.6 | 12452.8 | 7268.3 | 0.604 | 0 of 20 | no |
| factsOf a tree with an equation | 1 | 5089.9 | 5417.8 | 5332.1 | 1.048 | 5 of 20 | yes |
| PLAN.COMPILE-SPEED prepare | 2 | 15269.3 | 16777.4 | 12554.3 | 0.822 | 0 of 20 | no |

- 10 cases have a mode by the first rule. Nine of them are slow in each of the 20 IN ORDER processes. Thus the order gives a constant shift, not a mode of some processes.
- `factsOf` of a tree with an equation is slow in 5 of 20 processes. That is the limit of a mode.
- Two cases are faster in order: the tree with a list of reads (0.604) and PLAN.COMPILE-SPEED (0.822).
- FORMULA.SPEED is the first case, thus no case runs before it. Its ratio of 1.003 is the check of the method.
- The parts took 58.8 s and 62.1 s in the script. The jobs took 79 s and 95 s, and the job `mode-verdict` took 13 s.
- The bench of the same head (run 41426813579) ran before the split and gave 16 cases in bound. Its jobs took 87 s and 93 s.

**Second measure (2026-11-02).** The measure run 41430307699 had all four arms, with 12 cases split and 4 cases in GROUP. Part 1 had an AMD EPYC 9V45, and part 2 had an AMD EPYC 9V74. The table gives the verdict above, from the raw records of the run.

| Case | Part | Alone median (ns) | In order median (ns) | In order / alone | E | Budget | Verdict | Slow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| FORMULA.SPEED formula | 1 | 108.3 | 106.0 | 0.978 | 0.942 to 1.030 | 1.5 % | cannot decide | 0 of 20 |
| the same formula, with a list of reads | 2 | 251.4 | 258.4 | 1.028 | 1.017 to 1.040 | 1.5 % | slower | 19 of 20 |
| a reference of five steps | 1 | 73.7 | 108.3 | 1.468 | 1.443 to 1.510 | 1.5 % | slower | 20 of 20 |
| a reference into a host thing with resolve | 2 | 158.6 | 205.4 | 1.295 | 1.288 to 1.303 | 1.5 % | slower | 20 of 20 |
| a reference through an envelope | 1 | 199.2 | 212.5 | 1.066 | 1.017 to 1.106 | 1.6 % | slower | 8 of 20 |
| a reference with a step document | 2 | 184.4 | 215.4 | 1.168 | 1.156 to 1.180 | 1.5 % | slower | 20 of 20 |
| resolve without hops, five steps | 1 | 37.7 | 73.2 | 1.943 | 1.920 to 1.986 | 1.5 % | slower | 20 of 20 |
| PLAN.FOLD a record of 20 literals | 2 | 28.2 | 32.6 | 1.156 | 1.126 to 1.181 | 1.5 % | slower | 20 of 20 |
| PLAN.TOTAL a record of 20 literals, without folds | 1 | 596.5 | 665.3 | 1.115 | 1.085 to 1.145 | 1.5 % | slower | 0 of 20 |
| PLAN.FIXED a path of four steps from a fixed name | 2 | 43.2 | 46.9 | 1.086 | 1.081 to 1.092 | 1.5 % | slower | 20 of 20 |
| PLAN.PATH the same path, without the declaration | 1 | 76.4 | 115.2 | 1.506 | 1.478 to 1.533 | 1.5 % | slower | 20 of 20 |
| PLAN.FIXED a formula with a fixed name and a free name | 2 | 115.1 | 146.8 | 1.275 | 1.253 to 1.285 | 1.5 % | slower | 20 of 20 |
| a tree with an equation | 1 | 5069.2 | 6230.7 | 1.229 | 1.160 to 1.278 | 1.5 % | slower | 20 of 20 |
| the same tree, with a list of reads | 2 | 9165.4 | 7337.4 | 0.801 | 0.778 to 0.823 | 1.5 % | faster | 0 of 20 |
| factsOf a tree with an equation | 1 | 4698.7 | 4650.2 | 0.990 | 0.931 to 1.015 | 1.5 % | cannot decide | 0 of 20 |
| PLAN.COMPILE-SPEED prepare | 2 | 15492.5 | 12635.2 | 0.816 | 0.793 to 0.830 | 1.5 % | faster | 0 of 20 |

- 12 cases are slower in order, 2 cases are faster, and 2 cases get "cannot decide". No case gets "no change". Thus all 16 cases split.
- The GROUP arm had the 4 cases that stayed. Each of them got "cannot decide" with GROUP / A1.
- The parts took 89.3 s and 97.4 s in the script. The jobs took 112 s and 118 s, and the job `mode-verdict` took 14 s.
- The bench of the same head (run 41430307725) ran with 12 cases split and gave 16 cases in bound. Its jobs took 112 s and 103 s.

**Why 20 processes are too few.** The verdict cannot give "no change" with 20 processes for most cases. A simulation shows it.

- The simulation draws A1, A2 and IN ORDER from the ALONE times of each case, with 10000 tries of 20 rounds.
- With no effect, E is inside 1 ± budget in 0.246 of the tries on average with the noise of run 2. With the noise of run 1, the mean is 0.168.
- The pass rate with no effect is 0.01 to 0.02 for 8 cases. Only the quiet cases pass often: PLAN.FIXED a path (1.000), the formula with a list of reads (0.971).
- With a true shift of 1.015, E is not inside 1 ± budget in 0.994 of the tries with the noise of run 2. With run 1, it is 0.995.
- That power comes mostly from "cannot decide". E is wider than the budget before any effect.
- The strategy states this clause: a gate that needs "no change" verdicts must bring its A/A spread under the budget.
- A test sized for the budget b needs approximately ((1.64 + 0.84) × σ / b)² processes in each arm. σ is the spread of single processes.
- σ is the relative standard deviation of the 40 ALONE processes of a case in run 2. The budget b is 1.5 %.

| Case | σ | Processes in each arm |
| --- | ---: | ---: |
| FORMULA.SPEED formula | 14.7 % | 589 |
| a tree with an equation | 11.1 % | 338 |
| PLAN.TOTAL a record of 20 literals, without folds | 5.9 % | 97 |

**Time of a job.** The run 41426813620 and its bench give approximately 0.054 s to start a process and 0.101 s for one case in a process.

- A part of the mode run has 341 processes since this change, because the GROUP arm does not run. The record of the run on the head gives its time.
- A round of the bench starts 48 processes, not 3. A bench job has 577 processes and 592 measures of a case.
- That gives approximately 91 s in the script. The Speed run of the head gives the time of the job after the split.

**Times from the bench before K210.** These places give times that a case had after the other cases in one process. Each place gets the mark "measured after the other cases in one process (before K210)".

- D29: the reference of five steps, the envelope, the step document and PLAN.COMPILE-SPEED. FORMULA.SPEED runs first, thus its times of 118 ns and 98 ns stay without a mark.
- D50: PLAN.FOLD from 15.7 to 16.9 ns, and the costs of 1.5 ns and 6 ns.
- D70 and D71: the same case at 107 ns and 206 ns on two runners.
- The roadmap rows K151 (PLAN.FOLD, 15.7 to 16.9 ns), K154 (PLAN.FOLD, 26.2 to 27.3 ns) and K167 (107 ns and 206 ns).
- The row K154 also gives FORMULA.SPEED from 160.4 to 165.7 ns. That case runs first, thus that time stays without a mark.
- R1 gives approximately 22 ns for each node of a small formula. R1 names no bench run for it, thus it stays without a mark.
- The README files and the site give no time of a bench case.

**Rejected.**

- The spread rule: the 5th to 95th percentile of IN ORDER / A1 inside the same band of A2 / A1. It compares two spreads.
- With no effect, that rule kept a case in 0.245 of the tries of a simulation. Thus it split 3 of 4 cases by noise.
- The interval of the median inside the A/A band. It kept a case with no effect in 0.96 of the tries.
- It caught a shift of 1.07 with the noise of PLAN.FIXED a path in each try. The strategist chose the verdict of the strategy, not a new rule.
- The verdict with E wider by half the 5th to 95th percentile band of A2 / A1. That term is a spread of single processes, not of a median.
- With no effect, it gave "no change" in 0.075 of the tries with the noise of run 2, and 0.063 with run 1.
- The amended verdict above uses the A/A interval of the median, at the level of E. With no effect, it gives 0.246. It does not change the split.
- More processes for each arm. The table above needs up to 589 processes in each arm, and a job of the mode run stops after 10 minutes.
- A budget from the spread of single processes. That is a new budget, not the bound of the bench.
- A new order of the cases in one process. Another order changes which case gets the state of the others. It moves the change, and it does not remove it.
- One pool of both runners for a case. A comparison across two CPUs measures the machines (D70).
- The base and the head in the mode run. The change comes from the cases and their order, thus the head is sufficient.

**Why.** A case in its own process measures its own code, not the state that the earlier cases leave. Thus a change in an earlier case does not move the time of a case.

**Public types.** No change. The scripts are in `bench`, and the `files` of the npm package do not include them.

**Changed expected values.** No result of the kernel changes. The bench times of all 16 cases become their times alone. On the EPYC 9V45, a reference of five steps goes from approximately 110 ns to 75 ns.

The bench runs the `cases.ts` and the `paths.ts` of the head with both kernels. Thus a change and a noise in one run compare the same groups, also against an old base. The times of a table from before K210 differ in each case except FORMULA.SPEED.

**Limits.**

- Each case ran on one runner only. Another CPU can give another result.
- The verdict of the mode run is information. A case joins `TOGETHER` only after a mode run sized for its budget.
- A change of `cases.ts` or `paths.ts` alone does not start the mode run. A change of `mode.ts` or `measure.yml` starts it, and a dispatch of `measure.yml` starts it.
- The mode run does not measure the cause. Shared code of the kernel with the type feedback of the earlier cases is one possible cause.
- σ includes the slow processes of a case. Thus a case with a few slow processes needs a large size.

## D99 (2026-11-02): a domain gives samples of its members to `conforms`

**Context.** K188, found by K181 (D86 Limits) and K187 (D94 Limits). The checks `truth` and `cover` test a type without a list `values` only with the palette. The palette holds the numbers `1` and `2`. Thus `0` and `-1` got no test for `number`, and a `truthy` without a truth for `0` conformed.

**Decision.**

- `Domain` gets the optional field `samples`: some members of the domain for the tests of `conforms` (CONFORM.SAMPLES). The list is not complete.
- `STD_DOMAINS` gives `number` the samples `0` and `-1`. The other standard domains keep their fields.
- The kernel helper `membersOf` adds the samples of each domain of the table to the palette. Thus the check `truth` reads them.
- `falseCovers` adds the same samples to the samples of each covered domain. Thus the check `cover` reads them.
- The table is the domains of the machine and each standard domain that the machine does not replace.
- The samples come after the results of the palette. Thus a finding of an existing test keeps its first member.
- A sample that is not a member of the type does not count, as a value of the palette.
- `fits` does not read `samples`. A list that is not complete gives no proof.
- `mergeMachines` compares `samples` as it compares `values`. `extendDomain` keeps `samples`, because a sample outside the new line does not count.

**Rejected.**

- More values in the default palette. The palette also gives the results of the probe parts. Thus each check C1 to C8 then starts more probes, and each result of `conforms` can change.
- A new option of `conforms` with the samples of a type. The option `results` already adds samples, and a language then gives its samples at each call (D86).
- Samples only from the domain of the type itself. A domain under `number` then does not give its samples to `number`, and a cover of `number` needs them.
- Samples in `values`. `fits` trusts `values` as a full list, thus a partial list makes `fits` unsound (D79).

**Why.** A language knows the edge members of its domains: `0`, a negative number, an empty text. The domain is the one place that holds such knowledge, and each check of `conforms` then reads it.

**Public types.** `Domain.samples` is a new optional field. No export goes, and no other type changes. A merge of two domains that differ only in `samples` is a conflict. The change is a new feature: MINOR before 1.0, as D94.

**Changed expected values.** One test of CONFORM.TRUTH changes its input. Before, it used `0` as a member outside the palette. Since D99, the samples of `number` hold `0`, thus the test uses `5`. No other result of `conforms` for an existing machine or test changes. The new tests are in `conform.test.ts`.

**Limits.**

- Only `number` gets samples. The domain `text` has no sample `""`, thus the empty text gets no test.
- The checks C1 to C8 do not read `samples`. A probe part gives only the results of the palette.
- The check reads each list of samples in full. A long list makes each check `truth` and `cover` slower.

## D100 (2026-11-02): a cause of an exception that is a list or a record keeps each item with a form

**Context.** K189, found by K182 (D87 Limits). Since D87, a cause that is a list or a record with an exception is `causeParts`. A container cause without an exception kept the short rule of D76. Thus the cause `{ code: 7, send: () => 1 }` of an exception was the name `cause` in `dropped`, and `code` was lost.

**Decision.**

- The cause of an exception gets the rule of a field of D82 (RUN.REPLAY-CAUSE-ITEMS). A list or a plain record without a term document is a container of parts, also without an exception.
- The container goes in `causeParts`, as in D87. An item without a form is a name in `dropped` with its path, for example `cause.send` or `cause.request.send`.
- An item of a list without a form is the mark `{ "dropped": true }` at its place, as in D78. A hole of a sparse list also gets the mark.
- A container without a form in it stays the name `cause` in `dropped`, as in D82. An example is `{ send: () => 1 }`.
- A cause that a field shares is the part `share`, as D88 Limits tell.
- The cause of an error value keeps its rule (D87). A container cause without an exception is a refusal of `encodeLog`, as in D75.
- `decodeLog` does not change. It gives a new list or plain record as the cause, as in D87.
- The form stays at the version 1. No new field comes, and an old log decodes as before.

**Rejected.**

- The same rule for the cause of an error value. D87 keeps the refusal of D75 for it, and a refusal tells the host of a value without a form.
- A field of its own for such a cause, for example `causeItems`. `causeParts` already holds a list of parts and the part `record`, thus one field keeps one rule.
- A term document of the items with a form in `cause`. Then a reader cannot tell a full cause from a part of a cause.

**Why.** A cause holds the same facts as a field, thus it gets the same part rule at each depth. The walk already had the rule. Only the mark of the cause of an exception changes.

**Public types.** None. No type changes and no export goes. The TSDoc of `ReplayExceptionJson.causeParts` tells the new case.

The output changes for a caller. A container cause of an exception with an item with a form is `causeParts`, not the name `cause` in `dropped`. A container cause that a field shares is the part `share`. The release 0.17.0 gives the old form.

**Changed expected values.** Two tests change.

- RUN.REPLAY-CAUSE-PARTS: before, the cause `{ send: () => 1, code: 7 }` of an exception was the name `cause` in `dropped`. This assertion moves to RUN.REPLAY-CAUSE-ITEMS. Since D100, its value is `causeParts` with the record `code`, and `dropped` holds `cause.send`. The test gets the name "a cause of an error value without an exception keeps its refusal".
- RUN.REPLAY-SHARED, a record that a field and the cause share: before, `dropped` held `plain.send` and `cause`. Since D100, the cause is `{ share: 0 }`, and `dropped` holds only `plain.send`.

**The golden file.** `packages/core/golden/replay.json` does not change. Its exception is a `TypeError` without a cause.

**Limits.**

- `decodeLog` gives the cause `{ code: 7 }`, and `encodeValue` writes it. Thus a new recording of the decoded log writes it in `cause`, not in `causeParts`. A field of D82 has the same limit.
- A cause of an error value without an exception stays a refusal (D87).

## D101 (2026-11-02): a list or a record with a term document that two places of an error share is a container of parts

**Context.** K190, found by K183 (D88 Limits). Since D88, a list or a record of parts that two places share is the part `share`. `encodeValue` writes a list or a record without an exception and without a function as a term document. Thus two fields that held the same record `{ a: 1 }` gave two term documents in `fields`, and `decodeLog` gave two copies.

**Decision.**

- Before the walk of an error value, a first walk finds each list and each plain record that the walk reaches at two places (RUN.REPLAY-SHARED-VALUES). It reads the values as the walk does.
- Such a container is a container of parts, also with a term document. A container that holds such a container at some depth is a container of parts too.
- The first place gets the list of parts or the part `record`. Each later place is the part `share` of D88.
- The index of `share` counts these containers with the containers of D88, in the order of the walk. `decodeLog` meets them in the same order, thus `decodeLog` does not change.
- A field of an exception with such a value leaves `fields` and goes in `parts`. A cause of an exception or of an error value with such a value is `causeParts`.
- Such a container always has a form, thus an empty record is the part `{ "record": {} }`, and an empty list is `[]`.
- A member of a domain with a codec stays a term document, also when it is a plain record. Its codec makes it again.
- The form stays at the version 1. No new field comes, and an old log decodes as before: each term document gives a new copy.

**Rejected.**

- A share in a term document, for example a new envelope `ext.share`. `encodeValue` has no identity for a value (D40), and each reader of a term document then needs the rule.
- A share for a whole term document only, without the containers on the way. A record that holds the shared record then stays a term document, and its copy breaks the identity.
- A share only for a container without a term document, as in D88. The host has one object at two places in both cases.
- An index of its own for these containers. One count for each list and record of parts keeps one rule for `share`.
- A container of parts for each list or record of an error. Most containers have one place, and a term document is shorter.

**Why.** The walk of D88 already gives a container its index before its items, and `decodeLog` already gives one object for each share. Only the encoder must know which containers have more than one place. A first walk tells it, because the walk writes the first place before it meets the later places.

**Public types.** None. No type changes and no export goes. The TSDoc of `ReplayExceptionJson.fields`, `ReplayExceptionJson.parts` and `ReplayErrorJson.causeParts` tells the new case.

The output changes for a caller. A shared list or record with a term document is in `parts` or `causeParts`, not in `fields` or `cause`. A container that holds it moves there too. The release 0.17.0 gives the old form.

**Changed expected values.** One test changes.

- RUN.REPLAY-SHARED, an old log: before, the record `{ code: 7 }` in the fields `a` and `b` gave two term documents in `fields`, and `decodeLog` gave two copies. This assertion moves to RUN.REPLAY-SHARED-VALUES. Since D101, `a` is the part `record`, and `b` is `{ share: 0 }`. The old test keeps the old form as a literal log, and it decodes as two copies, as before.

**The golden file.** `packages/core/golden/replay.json` does not change. Its exception is a `TypeError` without fields.

**Limits.**

- A shared field leaves `fields` for `parts`, and `decodeLog` gives the fields before the parts. Thus the order of the keys of the exception can change, as for each field of D82.
- A cause of an error value without an exception that holds itself stays a refusal (D87). `encodeValue` cannot write a cycle, and D87 gives a form only to a cause with an exception.
- The first walk reads each field of an exception, also of an exception that a domain holds. A container in it can then be a container of parts without a share. `decodeLog` gives the same value.
- A share counts in one error value, as in D88. Two effects of a log that share a container give two objects.

## D102 (2026-11-02): a split of `fits` tries each valid cover of a field

**Context.** K192, found by K186 (D90 Limits). Since D90, a type split of a field of a base type uses only the first valid cover of its line. Thus `{a: number}` did not fit a union of `{a: lo}` and `{a: hi}` when `lo` and `hi` are the second cover of `number`. The cover rule of D85 already tests each cover of a base type alone.

**Decision.**

- A cover split holds each valid cover of its field (TYPE.FITS-SPLIT-COVERS). The order is the order of the line of D90, then the order of the covers of each domain.
- The split tries the covers in this order. The first cover whose records all fit gives `true`. When no cover fits, the split gives `false`.
- A case that splits again at its path tries each valid cover of its own domain in the same way. The covers of its parents stay out, as in D90.
- Each record of each try costs one record of the shared budget of D89. A failed try does not give its records back.
- A field with one valid cover splits as in D90. The value splits, the union splits and the order of the splits do not change.

**Rejected.**

- A budget for each try. Then a field with many covers multiplies the work, and nested cover splits multiply it again. D89 removed that.
- A failed try that gives its records back. Then the work grows with the count of covers, and 64 records are no longer its bound.
- Only the covers of the first domain of the line with a valid cover. A cover of a parent can fit when each cover of the domain fails.
- A choice of the best cover before the split. That choice needs a measure of each cover, and the first cover that fits is enough.

**Why.** Each valid cover holds each member of its domain (D85). Thus each cover gives a sound split, and one cover whose records fit is enough. The first cover comes first, thus each fit of D90 builds the same records in the same order. A failed try only uses the budget.

**Soundness.** The corpus of type splits of D90 keeps its exact counts: 29280 pairs, 1176 fits, 374 split fits, 144 cover fits and 11760 checked members. Since D102, a field of `nonneg` in the corpus has two covers in its line. No pair of the corpus needs the second cover. The tests of TYPE.FITS-SPLIT-COVERS examine a second cover, a case with two covers of its own domain and pairs that no cover fits.

**Public types.** None. No type changes and no export goes. The TSDoc of `fits` tells the new rule.

The behavior changes for a caller. `fits` gives `true` for some pairs that gave `false` before. In such a pair, a field of the record has more than one valid cover in its line. Only a later cover fits the union. Thus a check accepts some programs that it refused before.

**Changed expected values.** One test changes.

- TYPE.FITS-SPLIT-TYPE, "a split uses the valid covers of the line, and ignores an invalid cover": before, `{a: number}` did not fit `{a: lo} | {a: hi}` when `lo` and `hi` are the second cover of `number`. Since D102, it fits (K192). The title of the test lost the word "first".

**CI.** The concurrency group of `agree.yml` names the event since K192: `agree-${{ github.event_name }}-${{ github.ref }}`. A dispatch takes its own count of documents, thus it does not cancel a run of the schedule. The row K196 tells this too.

**Limits.**

- The cost bound: each try of a cover costs at least one record, because a valid cover is not empty. Thus a split tries at most 64 covers, and all tries together build at most 64 records.
- A failed try of a large cover uses the budget of the next covers. A first cover of 40 domains that fails at its last domain leaves 24 records for the second cover.
- The split lists each valid cover of the line before the first try. A language with many covers pays for this list at each covered field, also when the first cover fits.
- Two outer splits beside each other each get a budget of 64 records, as in D89.

## D103 (2026-11-02): a formula profile gives the value type of each own extension in `extTypes`

**Context.** K51, from K24 (D25). A standard extension has a base type, for example `ext.number` gives `number` (D48). An own extension of a profile gave `unknown` at each time. Thus a check let its value go to each position, also where the run fails. The design calls are the shape of the declaration, its place, and the rule for a bad type.

**Decision.**

- `FormulaProfile` gets the optional field `extTypes`: the value type of each own extension, by its name (TYPE.EXT).
- The type rule of `formula.ext` gives that type for an own extension. A position that needs another type gives `#TYPE!` with `expected` and `found`, as each other type issue.
- An own extension without an entry gives `unknown`, as before (TYPE.GRADUAL). A profile without `extTypes` gets the same issues as before.
- An entry for a standard extension has no effect, as a name in `pureExt` without an own extension (D47). An own extension with a standard name takes its entry, because the own code runs.
- The check examines each entry as a contract, one time in a check. A bad type gives one issue at its first use, and the extension then gives `unknown`. Thus one problem gives one issue.
- `extTypes` is a field of the canonical form of a profile (D46), thus 16 fields. The record is equal only to itself, as `ext` and `sigs` are. Two profiles with different records give two kits, and their machines conflict.
- The language keeps its declaration: each own extension gives a member of its type. The check trusts it, as it trusts the signatures and `truthType`.

**Rejected.**

- A full signature with parameter types for the data of the extension. The data is JSON that the document holds, not a value of a term. Thus no part of the data has a type that the check synthesizes. The shape of the data is a rule of the contract, not of a type.
- A result type in `ext` itself, for example a record with the code and its type. Then `ext` changes its type, and each existing profile with `ext` breaks. The code and the type also get one identity, thus a new type needs new code.
- A type from the function of the extension. A function is code of the host, and the check cannot test it on each data.
- A type that each own extension must have. Then each existing profile with `ext` gets new issues, and the change breaks the API.

**Why.** The type of an extension is a rule of the language, as a signature is a rule of an operation. A record next to `ext` keeps each existing profile unchanged, and its keys are the names of `ext`, as in `pureExt`. The check reads it with the existing contract rule, thus no new mechanism comes in.

**Soundness.** The tests of TYPE.EXT examine seven documents with own extensions that keep their entries. Each document checks with no issue and evaluates to a member of its synthesized type. The documents use `ops`, `let`, `if`, `fn`, `call`, `list` and `record`. The property test TYPE.SOUND does not generate own extensions, and its profiles do not change.

**Public types.** `FormulaProfile.extTypes` is a new optional field, with the type `Readonly<Record<string, ValueType>>`. No other type changes and no export goes. The TSDoc of `FormulaProfile` tells the field and the promise of the language.

The behavior changes for a caller only with the new field. A check with types then gives the declared type to each document of an own extension. A use that does not fit it gets a new `#TYPE!`. A profile without `extTypes` gets the same types and the same issues as before.

**Changed expected values.** No expected value of an earlier test changes. The new tests are in `typing.test.ts`.

**Limits.**

- The language keeps `extTypes` true to its extensions. An extension that gives a value outside its type makes the check unsound at that place. `conforms` does not test this promise yet, as K181 tests `truthType`.
- An entry gives one type for each data of the extension. An extension whose type depends on its data, as `ext.domain` does, needs a union of its types, or no entry.
- A key of `extTypes` that names no own extension has no effect and gets no issue.

## D104 (2026-11-02): the limit of PLAN.LEAN applies in the job that measured it

**Context.** K211. D95 derived the limit of 395 bytes from the job `measure` of `measure.yml`. Its run 41381230112 gave 392.3 to 393.5 bytes.

- That job tests only `plan.test.ts` and `merge.test.ts`, with a filter for PLAN.LEAN and WORLD.LAWS.
- The job `checks` of `ci.yml` also applied the limit. That job starts all test files of the package in one run of the suite.
- There, the value went over 395 bytes with no change of the code. `main` at `ecf5310` failed with 396.0 bytes in run 41442630692.
- Pull request #209 failed with 418.5 bytes in run 41488821854. The push run of the same head passed.
- The job `measure` started only for a change of `measure.yml`, `bench/ladder.ts` or `bench/mode.ts`. Thus on a usual pull request, only `checks` applied the limit.

**Decision.**

- The gate rule: the runs that set a limit run in the job, on the runner class and with the test set that apply it.
- The byte assertion of PLAN.LEAN applies only when `COEVAL_MEASURE` is set. Without it, the test still builds and evaluates the plans.
- The job `checks` thus applies no limit of PLAN.LEAN. It does not get a second limit that is less strict.
- A second job of the action `changes`, the job `core-changes`, starts the job `measure`.
- Its paths are `packages/core/src/**`, `packages/core/package.json`, `pnpm-lock.yaml` and `.github/workflows/measure.yml`.
- The jobs `ladder`, `ladder-verdict`, `mode` and `mode-verdict` keep the filter of the job `changes`. A pull request of the core only skips them.
- The check `Measure OK` has two steps of the action `gate-summary`. Each step gets one filter and its jobs.
- A failed job fails the check. A job that its filter skipped passes. A skip for another reason fails the check.
- The limit stays at 395 bytes. WORLD.LAWS does not change: its counts come from fixed seeds, thus they are exact in each job.

**Rejected.**

- A limit from runs of the job `checks`. The full suite shares the state of the heap with the other test files, thus it gives no stable value.
- A new run of a failed job. It hides a real change of the value, and it does not make the value stable.
- One filter for all jobs of `measure.yml`. Then each pull request of the core also starts the 5 jobs of the ladder and the 2 jobs of the mode run.
- A trigger with `on.pull_request.paths`. Then the check `Measure OK` does not start on each pull request, and the ruleset blocks the pull request.

**Why.** A limit is true only for the job that measured it. The job `measure` has the same tests in each run, thus its values have the small spread of D95.

**Public types.** None.

**Changed expected values.** None. The limit stays at 395 bytes, and the counts of WORLD.LAWS stay the same.

**Correction (2026-11-05).** This decision made the job `measure` the only gate of the limit, and a pipe in that job hid each failed test. So the limit of 395 bytes was not enforced from 2026-11-02 to 2026-11-05. See D161.

**Limits.**

- A pull request that changes no file of the core gets no gate of PLAN.LEAN.
- A push to `main` does not start `measure.yml`. Thus `main` gets the gate only from the pull request of each change.

## D105 (2026-11-02): the ladder of STATIC.LINEAR also measures the memory of each walk

**Context.** K209. STATIC.LINEAR says that a walk takes time and memory linear in the size of the document. The ladder of D97 measures the time only.

- A measure of the bytes of a call must not lose bytes. A scavenge in the call frees the garbage of the call, and then the change of `heapUsed` is too small.
- V8 flags on the command line apply to the whole process. For example, `--expose-gc` or a large semi-space also changes the conditions of the timed passes.

**Decision.**

- The ladder keeps its timed rounds as D97 sets them. The process starts with no new flags, and `measure.yml` does not change.
- After all timed rounds, a memory phase measures the bytes that one call allocates. The phase measures its own uses of each walk, not the timed uses.
- The memory phase sets `--expose-gc` with `setFlagsFromString` and gets `gc` from a new context, as the test of PLAN.LEAN does.
- Each measured call starts after a full collection by `gc()`. Then a new `GCProfiler` starts.
- The bytes are `heapUsed` after the call minus `heapUsed` before it, plus the bytes that each collection in the call frees.
- The freed bytes of a collection are its `usedHeapSize` before the collection minus its `usedHeapSize` after the collection. The `GCProfiler` gives both.
- Thus a scavenge in the call loses no bytes, and the semi-space needs no flag.
- Each pass also measures an empty function. The ladder subtracts the median bytes of the empty functions of a round from each value of that round.
- The memory phase uses the rungs, the order of the arms, the A/A arm and the rounds of the timed phase.
- The bytes of a rung in a round are the median of its 5 passes. Each sample is one call, at each rung.
- Each round fits the slope of log bytes against log n by least squares, with the function `slope` of D97.
- The mode `merge` pools the memory slopes of the counted jobs, as it pools the time slopes.
- A run counts by the A/A band of its time, as D97 sets it. The A/A ratio of the bytes is information only.
- The memory verdict is "at most linear" when the upper end of the pooled 90 % interval is at most 1.2. Else it is "over the bound".
- The memory verdict is only an upper bound. A slope well under 1 shows a large fixed part of the bytes of a call. It also passes.
- The time slopes, their verdict and the counts of the work of one call do not change.

**Rejected.**

- `--max-semi-space-size` or `--min-semi-space-size` on the command line. Those flags change the scavenges of the timed passes, thus the time slopes change.
- A second process for the memory with its own flags. It needs a second start of tsx, and the profiler gives the same bytes without flags.
- The change of `heapUsed` alone. A scavenge in the call at 2000 levels loses the garbage of the call, thus the slope is too low.
- The retained bytes after a second `gc()`. The claim is about the work of a walk. A walk that keeps nothing has no retained bytes.
- A memory verdict that needs the interval to contain 1. A walk with a large fixed part has a slope under 1, and that is not a fault.
- A new statistics helper. The ladder keeps its local `median`, `quantile`, `slope` and `meanInterval`.

**Why.** The memory phase after the timed rounds keeps the time measure of D97 the same. The bytes that the profiler adds back make the measure exact also with a scavenge.

**Public types.** No change. The script is in `bench`, and the `files` of the npm package do not include it.

**Changed expected values.** No expected value changes. The record of each run gets the new fields `bytes`, `byteSlopes`, `byteAa`, `memorySeconds` and `baseBytes`.

**Limits.**

- The bytes include the code and the feedback that V8 makes during a measured call. The warm rounds and the median of 5 passes keep that part small.
- The measure counts the bytes of the heap of V8 only. It does not count memory outside the heap.
- The first CI run of the memory phase is the Measure run 41526166950. The memory slope of `refsOf` and of `walk` was 0.991, with 90 % intervals inside 0.98 to 1.00. One call at 250 levels allocated approximately 1.65 MB. The row STATIC.LINEAR of SPEC.md has the slopes.
- No test fails when the memory slope grows. The verdict is in the summary of the job `ladder-verdict` only.

## D106 (2026-11-02): `check` finds unknown attributes, reserved names and incomplete nodes of a tree

**Context.** L2d, from R3 P4. D42 gave `check` the equations of each kind with the names of their rung (TREE.DOWN-NAMES). A read of an attribute that no rung answers still gives its `#N/A` only in a run. R3 P4 also asks for reserved names, for tree kinds of the run side and for a check of completeness by kind, as in Silver.

**Decision.**

- `check` knows the self of a document through the nodes of the decorated tree and the standard code that keeps self. Code of a host can change self, thus a document under such code has no known self.
- A node is a document whose code is the standard `tree.node`. Its known parent is the nearest node around it. The parent of the root of a document is not known.
- A reference from `self` goes up the known nodes through its steps `parent`. Its first other key names an attribute of the node that it reaches.
- When no rung of TREE.LADDER can answer that attribute, `check` gives `#N/A` at the place of the reference (TREE.CHECK-UNKNOWN). The run gives the same code and place.
- The own parts of a node are the parts of its split, as in a run. A field that holds no part is data, and no step reads it.
- A rung can answer when the node has the part or its kind has the equation. A declaration with a `copy`, a `fold` or a `default` can answer too.
- The parent rung can answer when the known parent has the equation in `down`. A parent that `check` does not know can answer each name of `down` in the world.
- Those names include the kinds of the namespaces and each fallback kind. Thus an open world (WORLD.OPEN) makes the check weaker, and `check` reports only what it knows.
- The reserved names are `parent` and `type`. A node answers these two steps before its ladder (D16), thus no step reads an attribute with such a name.
- `check` gives `#NAME?` for such a name in `tree.equations`, `tree.down` or `tree.attributes`, and for such a part of a node (TREE.CHECK-RESERVED).
- `check` gives `#CALC!` for a tree kind of the run side. Its attributes evaluate on demand, thus in no fixed order.
- The needs of a kind are its declared attributes, and each attribute of the node that an equation of the kind reads. `check` collects them when it walks the equations (TREE.CHECK-COMPLETE).
- At each node, `check` gives `#N/A` for a need that no rung answers. Its reason names the kind, the attribute and the cause of the need.
- An own part hides the equation of its name, thus the reads of that equation are no needs of that node. An equation of `down` serves each child, thus its reads are needs of each node.
- Each kind gets its needs from its own contract only, as in the modular analysis of Silver. Thus a kind that `check` does not know adds no need.
- The issues have no new error code. A `#N/A` of the run and of `check` have the same code and place, thus STATIC.AGREES examines the generated trees too.
- Only the standard code of a reference reads an attribute. A header that gives a document other code hides its read.

**Rejected.**

- `#NAME?` for an unknown attribute. The run gives `#N/A`, and STATIC.AGREES compares the code.
- The names of `down` (`child`, `index` and `prev`) as reserved attribute names. They are names of the root `names`, and a step on a node does not see them (D42).
- `children` as a reserved name. The ladder answers it as each other attribute, and an equation can compute the list of children.
- The parent of the root as "no parent". A host can evaluate a document inside an open tree (TREE.SELF), thus the root can have a parent.
- A check of each read after the first attribute of a path. The value of an attribute is not known before a run.
- A check of each code of a host by its contract. The contract does not tell if the code changes self.

**Why.** Before D106, a wrong name of an attribute gave its `#N/A` only in a run. At this time, `check` finds it before a run, at the place where the run fails. The rule "only what `check` knows" keeps the false positives at zero in an open world.

**Public types.** No change. `equationsOf` is internal, and its items get the fields `attribute` and `down`.

**Changed expected values.** None. The existing tests and the standard kinds `panel` and `box` give no new issue.

**Limits.**

- A read through `names.child` or `names.prev` in an equation of `down` reads a child of an unknown kind, thus `check` does not examine it.
- The `fold` of an attribute reads that attribute of each child. `check` does not examine those reads.
- A read of the parent of the node of an equation goes to an unknown node, thus `check` does not examine it.
- The cycles of attributes wait for the graph of attribute instances (L2e).

## D107 (2026-11-02): the graph of attribute instances, and `check` finds the certain cycles of a tree

**Context.** L2e, from R3 P5. D106 gave `check` the unknown attributes of a tree, and it left the cycles to the graph of attribute instances. A cycle of attributes gave its `#CYCLE!` only in a run.

**Decision.**

- The module `instances.ts` lives beside `order.ts`. It uses the walk and the rules of `static.ts` (D106) and the analysis of `graph.ts`. It has no walk and no cycle finder of its own.
- A vertex is one attribute of one node. Its id is the JSON text of the place of the node with the attribute after it, for example `["children",0,"width"]`.
- `attributeGraph(machine, doc)` gives the vertices, the edges, the `NodeGraph` of the edges, the edges with an unknown source and the cycles.
- An edge comes from each read of a reference in the code of an attribute. A path from `self` reads the node, and the step `parent` goes to the known parent.
- A list index goes to the item, and the step `nearest` of the standard walker goes up the known nodes by their type.
- The rungs give edges too. An equation of `down` reads the list `children` of the parent, and `names.prev` reads the previous sibling. A `fold` reads the list `children` and the attribute of each child.
- A copy reads the same attribute of the parent. A rung after a rung that can answer first is lazy (FACTS.LAZY).
- The value of a reference to a node is its JSON (TREE.RESULT), thus the read gets an edge from each attribute of the node.
- A step after a value that only the run knows gives an edge with an unknown source. Other walkers, and names that a kind binds, give such edges too. `AttributeGraph.unknown` lists them as not known before the run.
- `check` gives `#CYCLE!` only for a certain cycle (GRAPH.CYCLE) that eager reads reach from the own parts of a tree root. A run reads each of these, thus each such cycle fails the run.
- The issue has the place and the reason of the run: the first read that closes the cycle, in the order of the JSON. Thus STATIC.AGREES stays true, and the harness compares the issue with the run.
- A possible cycle is not an issue. It goes through a lazy branch or an edge with an unknown source, and the run can give a value.
- The exports `attributeGraph`, `attributeVertexId` and the types of the graph are public. Thus the next release is MINOR. The evaluator of the kernel does not use the graph (D3).

**Rejected.**

- A second walk of the document for the graph. It copies the rules of D106, and the two walks can disagree.
- An issue for each possible cycle. The run of such a document can give a value, thus the issue is a false positive.
- A new error code for a static cycle. The run gives `#CYCLE!`, and STATIC.AGREES compares the code and the place.
- An issue for each edge with an unknown source. A generated document that checks has many of them, and none is a problem.

**Why.** Before D107, a cycle of attributes gave its `#CYCLE!` only in a run. At this time, `check` finds each certain cycle before a run, at the place where the run fails. The graph is also the first concrete graph for the schedule layer.

**Public types.** New: `AttributeVertex`, `AttributeEdge`, `AttributeCycle`, `AttributeGraph` and `AttributeGraphOptions`, with the functions `attributeGraph` and `attributeVertexId`.

**Changed expected values.** None. A document with a certain cycle gave `#CYCLE!` in its run before D107. At this time, `check` gives the same issue.

**Limits.**

- `check` finds the cycles only when the root starts a new tree. A context whose `self` is an open node gives no static cycle.
- A node document inside an equation is not a vertex. Its reads are not in the graph.
- The JSON of a node that an unknown value holds is not in the graph.
- A run stops at its first error. Thus the harness asks only that a run with a value gets no static cycle.

## D108 (2026-11-02): a host gives the tree kit its own memo cells, keyed by the place of a plan

**Context.** L2c, from R3 P3. The decorated tree of D16 keeps one memo for each node and attribute, for one evaluation (TREE.MEMO). Each evaluation makes new nodes, thus a host computes each attribute again in each evaluation. A host with signals wants to keep the cell of each attribute. A change of its store then computes only the attributes that read the store.

**Decision.**

- The new function `treeNodeEvaluator(options)` gives the code of `tree.node` with the options of the host. A host puts it at the name `tree.node` of its machine, as `nearestWalker` gives a walker.
- The one option is `cell`, of the type `AttributeCell`. Without it, the function gives the standard code, thus the default path does not change.
- `cell(place, attribute, compute)` gives an `AttributeAnswer`: the result, or `undefined` when no rung answers, and the rung that answered. Thus a kept answer keeps its error and its record of TREE.RUNGS.
- `place` is the array `place` of the compiled document of the node. It is one object for each document of a plan, and it stays the same across the evaluations of that plan.
- The plan enters the key through the identity of that array. A new plan gives new arrays, thus a changed document does not find an old cell (TREE.CELL-PLAN).
- With a cell, the cell is the memo of the attribute. The kit uses the cell at each demand, and the node keeps the last answer only for `has` and `trace`.
- A kept value can hold a node of an earlier evaluation, for example the list `children`. That node uses the same places, thus it reads the same cells (TREE.CELL-STORE).
- Thus the kit keeps the tree of a root for each place of a root. It also keeps the marks of the attributes in evaluation for each place.
- The kit marks an attribute in evaluation before it uses the cell. A demand that reaches a marked attribute gives `#CYCLE!` with its chain, as TREE.CYCLE. Thus the cycle detection of a signal library does not see a cycle of attributes at any time (TREE.CELL-CYCLE).
- An exception of the cell that `compute` did not throw gives `#CYCLE!`. The reason gives the chain of the demands, and the exception is its cause.
- An exception that `compute` threw goes on, as without a host, for example an overflow of the stack.
- Each demand gives a new `compute`. A cell that computes again uses the last one.

**Rejected.**

- A key with the keys of the place as text. A changed document keeps the same keys, thus such a key gives a stale value.
- A token of the plan as a fourth argument. The identity of `place` already gives the plan, and the signature of R3 P3 stays the same.
- A memo of the node in front of the cell. A node of an earlier evaluation then keeps its old answers after a change of the store.
- A compiled evaluator that makes a key at compile time. The place of the compile input is that key already, and an evaluator function keeps the code small.
- A new field of `Machine` for the cells. The cells are an option of the tree kit only, and the kernel does not change.

**Why.** A host with signals keeps its cells between evaluations, and a change of its store computes only the attributes that read it. The default path keeps the plain memo of each node, with no new allocation for each attribute.

**Public types.** New: `treeNodeEvaluator`, `TreeOptions`, `AttributeCell` and `AttributeAnswer`. This is a new feature, thus the next release is MINOR.

**Changed expected values.** None. Without a cell, the evaluator is the standard code, and each test of TREE.* stays the same.

**Limits.**

- A document that gives two nodes in one evaluation, for example in two contexts, gives one key to both nodes. With the cells of a host, the second node gets the answers of the first.
- A node of an earlier evaluation computes again with its own context and in its own evaluation. Thus the reads of a kept attribute are not in the list of reads of a later evaluation.
- A tree node inside an equation has the place of the cached plan of the equation (TREE.PLAN). That place is the same in each plan of the machine.
- The kit cannot tell the cycle error of a signal library from another exception of the cell. Each such exception gives `#CYCLE!`.

## D109 (2026-11-02): `encodeValue` uses the codec of the most specific domain

**Context.** K142, from K140. Since D40, the domains with a codec go in the order of their names, and the first domain that holds a value encodes it. A domain under a parent with a codec holds only members of the parent. Thus the parent wins when its name is first, and the codec of the subdomain does not get its own members.

**Decision.**

- The line of a domain is the domain and each parent, through each level (`lineOf` of the check of types). The membership test `member` reads the same line.
- A cycle of parents ends at a name that the line already has. A parent that is not a domain ends its branch of the line, and it adds no codec.
- The depth of a domain with a codec is the count of the other domains with a codec in its line. A domain without a codec in the chain adds no depth, but the chain through it counts.
- `encodeValue` tries the domains with a codec in the order of their depth, the deepest first. Between domains of the same depth, the order of the names decides (EXT.TIE).
- Thus a domain comes before each domain with a codec above it (EXT.SPECIFIC). The deeper line holds the line of the parent and the parent, thus its count is larger.
- Domains in a cycle of parents have the same line, thus the same members and the same depth. Their names decide.
- `encodeValue` computes the order one time for each call, as before. When no domain with a codec has a parent, the order of the names stays. That test costs one step for each codec.
- `decodeValue` does not change. The document names its domain, and the result of the codec must be a member of that domain.

**Rejected.**

- The order of the names alone. A parent with an early name hides the codec of each subdomain.
- The first topological order by names: at each step, the first name with no remaining domain under it. Its rule is hard to state, and it also changes the order of unrelated domains.
- A choice for each value: the first name of the domains with no other domain that holds the value under them. Each value then tests each codec, and the cost of a large table grows.
- An order by the order of the table. Two merges in another order give the same machine (WORLD.LAWS, D40).
- A cache of the order for each machine. A table is a plain record that a host can change, and the order costs little.

**Why.** The most specific codec gets its own members, whatever the names. A new domain with a codec under a domain of another language does not need a special name. The depth gives one stable order with a short rule.

**Public types.** No change. `lineOf` gets an export inside the package, and the root of the package does not export it.

**Changed expected values.** None of the existing tests. A table with a codec domain under another codec domain can give a new document. Thus this change goes into the next MINOR release.

**Limits.**

- Two unrelated domains of different depth that both hold a value give the document of the deeper domain, not of the first name.
- The cost of the order grows as the square of the count of the domains with a codec, when a table has such a parent.

## D110 (2026-11-03): `checkWorld` with the option `types` examines each value type of a machine before a document exists

**Context.** K52, from K24 and K36. Since D25, `check` examines each value type of a contract and of a signature with `typeIssues`. It reports a problem only at the first document that uses the type. Thus a bad type that no document uses stays hidden, and a fix needs a document for each type.

D45 made `checkWorld` the check of a world before a document exists. The design calls are where the new check goes, what a bad type is, and where an issue points.

**Decision.**

- `checkWorld(machine, verbs, options)` gets the option `types` (TYPE.WORLD). Thus one function checks a machine before a document exists. The default is `false`, and the check then gives the same issues as before.
- With `types: true`, the check examines each value type of the machine with `typeIssues`. These are the `result` and each `expect` of each kind, the parents and the steps of each domain, and the declarations of each type rule.
- A type issue is a `WorldIssue` with the code `#TYPE!` and the verb `eval`, because the value types describe `eval` (D25). The type issues come after the issues of the verbs.
- Each problem of `typeIssues` gives one issue. The field `at` holds the keys of the bad term in its owner. The owner is a kind (`kind` and `fallback`), a domain (`domain`) or a type rule (`evaluator`).
- The reason of a bad type is the reason that `check` gives at the first use of the type. Thus a host finds the same text before and after a document exists.
- A type rule lists its declarations with the new optional function `declared`. A declaration is a value type with its keys and what it is, or a problem with its keys. A rule that throws gives one issue at its evaluator.
- The formula kit declares each signature of a record `sigs` and each type of `extTypes` for an own extension. It also declares the `truthType` of a profile with an own `truthy`. Only the rule of `formula.if` declares the truth type, thus one bad truth type gives one issue.
- The check finds only the problems that it can decide exactly. A bad type is a term that `typeIssues` refuses. A signature that is not a record with `params` and `to` is a problem too. So are an entry of `domains` without a test `is` and a parent in `under` that is not a domain.
- An overload with the same parameters and rest parameter as an earlier overload is a problem. The earlier overload fits each time that the later one fits. Thus the later one does not give its own result at any time.
- A term shape with `kinds` and `expect` gets a problem for each kind of its list whose `result` does not fit `expect`. `check` gives `#TYPE!` at each document of that kind there. Only a kind at the path itself counts.
- The standard machines and the profiles of the tests give no issue (TYPE.WORLD-CLEAN). A path of `kinds` that goes to a fallback kind (WORLD.OPEN) or through an alias gives no issue.

**Rejected.**

- A new export, for example `checkTypes(machine)`. `checkWorld` already takes the machine, and D45 kept it for K52. One function and one issue type keep the checks of a machine together.
- Types in `checkWorld` by default. A host that does not read types then gets new issues, as D25 rejected for `check`.
- One issue for each value type, with only its first problem, as `check` does. A machine has no document to show the next problem, thus each bad term gets its own issue and its keys.
- An overload that a set of earlier overloads covers by `fits`. `fits` is not complete, and an argument with `unknown` fits each overload. Thus such a claim is not exact.
- A `result` that only some members of `expect` refuse, or a path of `kinds` through a fallback kind or an alias. A real document there can fit, thus such an issue can be false.
- A table of declarations in the machine. The rule follows its evaluator in a merge and in a restriction (D25), thus its declarations go with it.
- A walk of a function `sigs`. The check cannot list its names, thus a function of signatures declares nothing.

**Why.** A language finds a bad type when it builds its machine, not when a user writes a document. The keys of each issue point at the term to fix. The opt-in keeps each existing call of `checkWorld` unchanged.

**Public types.** `WorldIssue` gets the code `#TYPE!` and the optional fields `domain`, `evaluator` and `at`. `TypeRule` gets the optional function `declared`. The new exports are `WorldOptions` and `Declared`. These are features, thus the change goes into the next MINOR release.

**Limits.**

- A function `sigs` and the signatures of a profile without the kit are not examined before a document exists. `check` still examines them at their first use.
- A restricted machine without `formula.if` does not examine the truth type before a document exists.
- A type of the option `rootTypes` of `check` and the `expect` of a check are not part of a machine. `check` still examines them.
- The check of `kinds` against `expect` reads only the term shapes. A shape with `of` and `expect` does not get it.

## D111 (2026-11-03): `factsOf` reads the side and the effects of a verb from the entry of the verb in `verbEffects`

**Context.** K55, from S1a (D24) and K56 (D49). `factsOf` takes the option `verb` since D24. For a verb other than `eval`, the facts gave the side and the effects of `eval`. D24 called this an over-approximation, because a contract declared effects only for `eval`.

D49 gave the field `verbEffects`, and `check` tests the effects of each verb by it. The facts still read only `effects`. Thus a fact and a check of the same verb did not agree. The verb `format` of a kind `log` gave the effect `log` in the facts, and `check` gave no effect issue. The run of `format` causes no effect. The design calls are the effects of a verb, its side, and the facts of a kind without an entry for the verb.

**Decision.**

- For `eval`, the facts do not change. The field `effects` gives the effects, and the field `side` gives the side.
- For another verb, the effects of a document come from `declaredEffects(v, verb)`. This is the one function that `check` reads (D27). Thus the effects are the effects of the entry of the verb in `verbEffects` (FACTS.VERB-EFFECTS). The entry `"type"` gives the type of the document, as for `eval`.
- For another verb, a kind is on the run side when its entry declares at least one effect (FACTS.VERB-SIDE). With the option `run`, `check` already asks a runner for such a kind, and code with a runner is code of the run side.
- A kind without an entry for the verb has no declaration (D49). It adds no effect, and it does not put the document on the run side (FACTS.VERB-UNDECLARED). `check` also tests no effect of that kind for the verb.
- The marks `pure`, `volatile` and `lazy` of a contract still describe only `eval` (D24, D49). For another verb, only the hook `facts` describes the code. Thus a document is pure for another verb only when the hook answers `pure` for its code. A kind without an entry for the verb is then also not pure.
- The equations of a tree kind evaluate with `eval`. Their facts do not change.
- The test FACTS.VERB-CHECK compares the facts and `check` for the verbs `eval` and `format`. `check` without capabilities refuses each effect of the facts and no other effect. With the option `run`, the evaluator of `format` needs a runner exactly when the facts give the run side.

**Rejected.**

- The side and the effects of `eval` for a kind without an entry, as before. Then a fact and a check of the same verb do not agree. The effects of `eval` also say nothing about the code of another verb.
- The run side for a kind without an entry, as an unknown. Then each verb of each existing world is on the run side, for example `format` of the formula kit. The mark `pure` already keeps a host from a cache of such code.
- A new contract field `verbSides`, by verb. It is a second declaration beside `verbEffects`, and the two can disagree. The run side of `eval` without an effect, as for `seq`, orders the effects of its parts. The parts of such a document give the run side of the document for another verb too.
- A change of `effectsOf` and `checkLatent` in this item. They read the latent effects of `eval`, and the least authority of another verb is a separate question (D49 Limits).

**Why.** A fact and a check of the same verb read the same declaration with the same function. Thus a host that schedules a verb `format` gets the effects that `check` tests. A document whose run causes no effect gets no effect in its facts.

**Public types.** No change. The option `verb` and the fields of `DocFacts` keep their types.

**Changed expected values.** One assertion of FACTS.VERB. The verb `format` of a sequence with a `log` gave the run side and the effect `log`. It gives the derive side and no effect, because the standard kinds declare no effect for `format`.

A call of `factsOf` without `verb`, or with `verb: "eval"`, gives the same facts. A call with another verb can give other facts. This is a change of behavior, thus it goes into the next MINOR release.

**Limits.**

- A hook answer gives no side and no effects. Thus code of another verb that the hook describes gets its side and effects only from the contract.
- A fold of a plan for another verb still reads the field `side` and the field `effects` of `eval`. That is an over-approximation: it folds less code, not more.
- `effectsOf` and `checkLatent` still read only the effects of `eval`.

## D112 (2026-11-03): `printReads` keeps a print of each value that an evaluation read, and `verifyReads` compares it on request

**Context.** K61, from S1b. `verifyReads` compares what a read reaches with `sameResult` (D26). The walk of `sameResult` compares two values with `Object.is` first. Each object that is not a list or a plain record compares only by identity (RESULT.SAME). Thus a value that a host changes in place is the same object, and the verification keeps a stale result.

The rule `equal` of the host does not help: `Object.is` answers before it. D26 and D30 only state the promise that the values of a context do not change in place.

**Decision.**

- A new function `printReads(reads, options?)` gives the prints of a list of reads (READS.IN-PLACE). A host starts it after the evaluation, before it changes a value.
- A print is a flat list of the parts of a value, in the order of a walk. Two prints are the same when each entry is the same by `Object.is`. Thus `-0` is not `0`, as in `sameResult`.
- The walk visits lists, plain records and the own enumerable fields of each other object. An object adds its prototype. A list adds its length, a date its time, and a map or a set its size and its entries.
- A function is one entry, by its identity. A field with a getter gives the getter function. The walk does not start the getter, thus it starts no host code of a field.
- The walk visits each object one time. A second visit gives a mark and the number of the object. Thus a cycle ends, and a shared object costs one walk (READS.PRINT-LIMIT).
- The option `limit` caps the entries of one print. The default is 10000. A larger value gets no print. An exception of the host in the walk, for example from a proxy, also gives no print.
- A read without a print of its old value is changed. Thus a value over the limit evaluates again after each change of data. A wrong `false` only costs work (D20).
- The option `stamp` of the host gives a value for an object, for example a version. The stamp takes the place of the fields of that object, and it compares with `Object.is`.
- `verifyReads` takes the prints with the new option `prints`. A read that is the same by `sameResult` then also compares a new print of its value. A changed print gives the changed read in the old form, with the new mark `inPlace: true`.
- Only a free read with a value that holds an object gets a print. A primitive value and an error cannot change in place. A kept read gets a print too.
- `durable` and `schedule` take the option `inPlace`: `true`, or the options of `printReads`. The cache then keeps the prints of each pure document in a `WeakMap` beside its entry, and each verification compares them (DURABLE.IN-PLACE).
- Without the option, `verifyReads` tests one `undefined` for each read, and `durable` makes no prints. An entry of the cache keeps its shape (PLAN.LEAN).

**Rejected.**

- A print at each read, in the kernel. It adds work to each resolution of each evaluation with a list of reads, also for a host that does not ask. A print after the evaluation gives the same prints for a pure document.
- A print by default. It walks each value at each verification, and a large world then costs more than an evaluation. The bench gate needs no new work on the default path.
- A version stamp only, as a new optional `version()` of a host thing, in the style of D21. A plain record or a list has no version, and each host must change. The option `stamp` gives the same power without a change of `HostThing`.
- A deep copy of each value, compared with `sameResult`. D26 rejects a copy for its cost. A copy of a host object also loses its prototype, and `toJson` of a node evaluates each attribute of its tree.
- A text form of the value, for example `JSON.stringify`. It loses `-0`, `NaN`, `undefined` and each function, and it throws at a cycle.
- A print that ends at the limit and keeps its first part. A change after the limit then stays hidden, and a wrong `true` keeps a stale value.
- A start of each getter. A getter is host code, and it can have an effect or throw.

**Why.** A host that changes values in place needs a signal, but most hosts give a new object for a new state. An opt-in walk keeps the cost of the default path at zero. It finds a change in a record, a list, a host object, a date, a map and a set. The stamp covers the state that a walk cannot see. The answer keeps the form of READS.CHANGED, thus a schedule needs no new branch.

**Public types.** New exports: `printReads`, `PrintOptions` and `ReadPrints`. New optional fields: `VerifyOptions.prints`, `DurableOptions.inPlace` and the mark `inPlace` of a changed `ReadsCheck`. This is a feature for the next MINOR release.

**Changed expected values.** None. Without the new options, each answer stays the same.

**Limits.**

- The walk does not see the state in a closure or a private field. It does not see a field with a symbol name, a field that is not enumerable or the value of a getter. A host gives a stamp for such an object.
- The walk does not see the bytes of an `ArrayBuffer`, or the entries of a `WeakMap` or a `WeakSet`. A map or a set of another realm shows only its fields. A typed array shows its items as fields.
- The prints compare only the value that a read reached. The things of the hops of a read compare by identity, as before.
- A host that changes a value during the evaluation, before `printReads`, gets a print of the new value. The prints are sound only for a pure document, as `verifyReads` is.
- A new order of the fields of a record gives another print. Thus the read is changed, and the document evaluates again.
- A value with many shared parts costs one walk for each verification. The limit bounds that cost.

## D113 (2026-11-03): a circular attribute evaluates to a fixed point by the demand algorithm of Magnusson and Hedin

**Context.** L2f, from R3 P6. Before L2f, each cycle of attributes gave `#CYCLE!` (TREE.CYCLE). Some layouts need a cycle. A scrollbar makes the content narrower, and narrow content can need the scrollbar. The reachable nodes of a graph with a loop are a second example.

Magnusson and Hedin (2007) evaluate such a cycle on demand. A demand in the cycle gets the current approximation. The first attribute evaluates again until no value changes.

**Decision.**

- A kind declares an attribute circular in `tree.attributes.<name>.circular = { start, limit? }`. The value `start` is JSON data, and it does not evaluate. The value `limit` is a whole number of 1 or more. Its default is `CIRCULAR_LIMIT`, 100 rounds.
- The first circular attribute that a demand reaches leads a fixed point. Each round evaluates the leader again. Each circular attribute that a round reaches joins the fixed point, and it evaluates one time in each round.
- A demand that reaches a circular attribute in evaluation gets its approximation: the value of the last round, or `start`. Two approximations are the same by DOC.EQUALS. Two errors are the same when they have one code and one reason.
- The rounds end when a round gives no new value. Each attribute of the last round keeps its value in the memo. Each other attribute that read an approximation evaluates again at its next demand.
- An error of the leader ends the rounds, and the error is the result. After the last round of the limit, the leader gives `#CYCLE!` at the place of its node. The reason names the leader and the limit.
- A mixed cycle gives `#CYCLE!`. A chain gets an approximation only when each attribute from the closed attribute to the demand is circular.
- A host cell keeps only final values (D108). In a fixed point the kit does not use the cells of the host. Only the cell of the leader gets a value, from a `compute` that contains each round.
- `check` and `attributeGraph` see the declarations. A certain cycle of circular attributes is not an issue, and each other cycle stays an issue. The graph keeps each edge, and it marks the cycle and its vertices `circular`.
- A declaration without a start value or with a bad limit gives `#VALUE!` in `check`. The run gives the same code at its demand.
- The reference evaluator has its own copy of the algorithm, thus `agree` compares the two.

**Rejected options.**

- A declaration `circular` beside the equation, in `tree.equations`. An equation of a node part then has no declaration. The table `tree.attributes` already holds the other rules of an attribute: `copy`, `fold` and `default`.
- A start value that evaluates as a term. A start then can read another attribute, and the first round is not a known value.
- An approximation for each chain in an open fixed point, also through a plain attribute. A mixed cycle then gives a value in one demand order and `#CYCLE!` in another order. The rule "each attribute of the chain is circular" gives `#CYCLE!` in each order.
- A leader that is the attribute with the first name, or the first in the document. The demand algorithm needs no order of the attributes, and a monotone equation gives the same least fixed point from each leader (TREE.CIRCULAR-ORDER).
- A write of each member to its host cell with the last value. A host that tracks reads sees the reads of the whole cycle only in the `compute` of the leader. A member cell then keeps a stale value after a change of the store.
- A limit that gives the last approximation. A value that is not stable is not a fixed point, and a host cannot see the problem.
- A nested fixed point for a second circular attribute in the rounds of the first. Two open fixed points of one cycle can disagree, and the cost grows with each level. All attributes of the rounds join one fixed point.

**Why.** The demand algorithm needs no static analysis of the cycle, thus a cycle through a lazy read also becomes stable. The equal test of DOC.EQUALS is the same test that the other layers use. The rule for mixed cycles keeps each old document correct: a document without `circular` evaluates as before.

**Cost.** A tree without `circular` keeps the code of its demands as before. The function `read` of a node and the function of its host cells each get one test. The test reads a flag of the contract and the open fixed point. The code of a fixed point is in module functions. They get the node from its state, thus a node makes no new closure.

The first form of L2f made the bytecode of `read` too large for the inlining limit of V8 (460 bytes). The trace gave 10 refusals with reason 5, the size limit. Thus `read` stopped being inlined into `deref`, `derefStep` and `json`, and the Speed bench gave a slower tree. At this time `read` has 435 bytes, 426 on main, and V8 inlines it at the same places as on main.

**Public types.** New exports: `CircularDeclaration`, `CircularRule`, `CIRCULAR_LIMIT` and `circularOf`. New optional fields: `AttributeDeclaration.circular`, `AttributeVertex.circular` and `AttributeCycle.circular`. This is a feature for the next MINOR release.

**Changed expected values.** None. A document without `circular` gives the same result and the same issues.

**Limits.**

- A fixed point is sound only for monotone equations on a finite lattice. Other equations can oscillate, and the limit then gives `#CYCLE!`.
- A round evaluates the whole cycle again. The algorithm does not use the order of the strongly connected parts.
- One fixed point is open at a time. A circular attribute that an attribute of a round reaches through other circular attributes joins it, also when it is in another cycle.

## D114 (2026-11-03): The bench uses the shared bench core

**Context.** K212. The scripts `paths.ts`, `merge.ts`, `mode.ts` and `ladder.ts` of `packages/core/bench` had their own copies of the bench logic. They had a runner of processes, six turned orders, medians and quantiles. They also had an A/A noise, a bound of 1.5 % or two times the noise, and a verdict. The two runs of the speed job agreed by the rule of D71.

At this time, the shared bench core `@mark1russell7/rigor-bench` 0.2.1 and `@mark1russell7/rigor-statistics` 0.1.5 have these parts, with tests.

**Decision.**

- `paths.ts` starts each arm with `freshRun` of `@mark1russell7/rigor-bench/fresh`. Each case gets the pair (base, head) and the A/A pair (base, base) in each round. Each arm of each pair starts in a new process, and `pairOrder` turns the order. The six local `ORDERS` and the three copies of each round go.
- `cases.ts` has a new mode `child`. It measures one case and prints one JSON line with its time and its result.
- A first process of the head gives its results. The bench compares them with the results of the base, because `freshRun` compares the results only in one arm.
- Run N of the speed job starts at the round (N - 1) times the rounds. The two runs then have different rounds, and their records can pool.
- The verdict of a case is `timeVerdict` with the rule `difference`. The margin is ln(1.015): the floor of the old bound. The outcome is "same", "faster", "slower" or "cannot decide".
- `merge.ts` pools the two runs with `pooledVerdict`. Each run is one job. The verdict "mixed" goes. A run with the opposite direction makes the verdict "cannot decide".
- The record of a run keeps the pairs of each case in the new fields `head` and `aa`. A record from before K212 has no pairs, and its cases cannot decide.
- `mode.ts` gives each arm the same verdict, with the pair (A1, IN ORDER) and the A/A pair (A1, A2). "no change" becomes "same", and the column Budget goes. The interval of a median comes from `caseIntervals`.
- `ladder.ts` takes `median`, `quantile`, `leastSquares`, `mean` and `sd` from rigor-statistics.
- The verdict jobs of `bench.yml` and `measure.yml` install the packages, because the scripts import the shared packages.

The functions of the shared packages replace the local code as follows:

| Local code | Replacement |
| --- | --- |
| the runner of `paths.ts` and its `ORDERS` | `freshRun` and `pairOrder` |
| the medians of change and noise | `caseRatios` |
| the bound and the verdict of `merge.ts` | `timeVerdict`, rule `difference` |
| the agreement of two runs (D71) | `pooledVerdict` |
| `decide`, `budget` and `FLOOR` of `mode.ts` | `timeVerdict` through `caseVerdict` |
| `medianInterval` of `mode.ts` | `caseIntervals` |
| `median` and `quantile` of the scripts | `median` and `quantile` of rigor-statistics |
| the slope of `ladder.ts` | `leastSquares` |
| the mean and the deviation of `ladder.ts` | `mean` and `sd` |

**Gaps.** A comment names the issue of each piece that stays.

- mark1russell7/rigor#34: `timeVerdict` gives one verdict over all cases. The adapter `roundsAsCases` gives each round the name of a case. Thus the verdict compares the rounds of one case.
- mark1russell7/rigor#35: the core has no verdict of a slope claim and no A/A check of a ladder run. `verdict`, `memoryVerdict` and `counts` of `ladder.ts` stay.
- mark1russell7/rigor#36: rigor-statistics has no t quantile and no interval of a mean. The table `T95` and `meanInterval` stay.
- mark1russell7/rigor#37: the core has no timed samples of one arm in a child. `calibrate`, `measure` and the sample loop of `cases.ts` stay.

**Rejected.**

- Local copies of the new rules. The rule of the repository is one home for each area, and the bench core is the home of the bench.
- A verdict of each run, then the agreement of D71. It needs two outcomes in the same direction, thus it loses power. `pooledVerdict` uses all rounds, and it still refuses an opposite direction.
- A cap of the A/A noise (`noiseCap`). A cap needs a limit from five or more CI starts of the job with the new records. The job has no such records yet. See D117.
- The fresh runner for `mode.ts`. Its arm IN ORDER measures all cases in one process, and `freshRun` starts one case in each process. Thus `mode.ts` keeps its own runner.

**Why.** One home gives one tested rule for each bench. A fix of the core then reaches each repository. The new rule can also give "same", and the old bound could not prove that a case did not change.

**Public types.** None. The bench is not a part of the package.

**Changed expected values.** The verdict words change. "in bound" becomes "same" or "cannot decide", and "mixed" goes. The gate does not read the verdict: the speed job fails only on a missing run, a short run, no cases or different results. Thus "slower" still does not fail the gate.

**Limits.**

- With 12 rounds, a case with a noise near the margin often gives "cannot decide". More rounds give more power.
- `TOGETHER` must stay empty. The bench refuses a group of cases in one process.
- The speed job starts approximately four processes for each case and round. It takes more time than before.

## D115 (2026-11-03): with the cells of a host, each node gets a key in its scope, and the marks and the tree of a root use that key

**Context.** K213, a limit of L2c (D108). A host keeps its cells by the identity of the array `place`. The machine caches the plan of each equation (TREE.PLAN). Thus a tree node in an equation has the place of that cached plan.

That place is the same for each node of the kind, in each document. A host then gave the cell of one document to another document, with no error. Two nodes of the kind in one document also shared one cell.

The marks of the attributes in evaluation (D108) and the tree of a root were kept by place too. A cell can evaluate a second document during a demand. The nodes of the cached plan then shared the marks of the outer nodes, and a demand gave a false `#CYCLE!`. A nested evaluation of the same plan also shared the tree of the root, and its end closed the tree of the outer evaluation.

**Decision.**

- With the cells of a host, the kit gives each node a key (TREE.CELL-DOCUMENT). The key is the array `place` that the cell gets. Its items are the keys of the place, as before.
- The scope of a node is the key of the node around it, the self of its context. A root without such a node has the scope of the open demand: the marks of its node and the name of its attribute. A root outside each demand has no scope.
- Without a scope, the key is the place of the plan, as before. With a scope, the key is one frozen array for each scope and place.
- The kit keeps the marks and the tree of a root by the key. Thus a nested evaluation gets its own marks and its own tree (TREE.CELL-NESTED).
- Each evaluation of a plan gives the same keys. The root has the same place, and each scope is the same object. Thus the kept cells stay valid (TREE.CELL-KEPT, TREE.CELL-STORE).
- `placeOf` and the place of an error of such a node give the key. The items are the same as before.
- Without the cells of a host, the kit uses the place of the plan. The functions `read` and `through` of a node do not change.
- `AttributeCell` keeps its type. A host that keeps its cells by the identity of `place`, as D108 tells, gets the fix with no change.

**Rejected options.**

- Option A: a new argument of the cell with the document, or a stable key of it. An old host ignores an optional argument, and it keeps the fault with no error. An argument without a default breaks each host, and the key in `place` gives the same power.
- Option B: only a rule in the docs, for a key of each cell by the root document too. Each host must then find the root document. A host that does not read the rule keeps the fault, and nothing tells it.
- A key by the root document only, as the argument of option A or as the rule of option B, gives too little. The badges of two nodes of one kind in one document then share one key.
- A key with the chain of the places as text. A text key gives the cell of an old document after a change of the document (D108).
- A plan of each equation for each document. The cost of the compilation then grows with each document. TREE.PLAN compiles each equation one time for each machine.

**Why.** The fault becomes impossible for each host that follows the contract of D108, also for an old host. The key costs one lookup in a weak map for each new node with the cells of a host. A tree without the cells of a host does no new work, and the code of its demands does not change.

**Breaking for a host.** A host that keeps its cells by the identity of `place` does not break. Before, the nodes of a cached plan in two documents got one array, thus one cell and the value of the first document. After, each node gets its own array and its own value. Before, a cell that evaluated a second document could give a false `#CYCLE!`. After, the second document gets its own marks.

A host that keeps its cells by the keys of `place` as text was already wrong (D108). Such a host also mixes the nodes of two scopes after this change. This is a change of behavior, thus it goes into the next MINOR release.

**Public types.** No change. The doc comment of `AttributeCell` gives the new rule of `place`.

**Changed expected values.** None. The old tests of TREE.CELL and TREE.CIRCULAR-CELL give the same results.

**Limits.**

- Limit 1 of D108 stays. Two nodes of one document in one scope, for example two items of a map in one attribute, share one key.
- A root whose scope is a demand of a node without the cells of a host gets a new scope in each evaluation. The marks of such a node are new in each evaluation. Thus the cells of that tree are not kept.
- A host that gives two evaluations of one plan different names keeps the cells of the first one. The host drops the cells that read the changed names, as in TREE.CELL-STORE.

## D116 (2026-11-03): a ladder of steps for each language, with the step of each construct as data

**Context.** K215. A language that grows can lose a guarantee. A formula language with loops of a fixed count ends for each program. A loop with a limit from the data, a fixed point or a function that calls itself can cost more, or not end. A host must know which guarantee a program keeps before it accepts the program. The first language with this need has three steps: A (each loop has a fixed count), B (limits from the data and monotone fixed points) and C (functions that call themselves, with a budget).

**Decision.**

- A ladder is data: the names of the steps from the lowest to the highest, and the step that each construct needs. `stepLadder` checks the declaration and freezes it. A construct without an entry needs the lowest step.
- The language gives a walk: the construct of a node and its child nodes, each with a key. The kernel does not know the documents of the language, thus a language with its own tree uses the module too.
- `stepOf` gives the lowest step that a document needs. It is the highest step of the constructs of the document. The reason is the first node in document order with that step: its construct, its step, its path and the node.
- `checkStep` compares the step with the highest step that the host accepts, `maxStep`. It gives a refusal that names the needed step, the limit and the reason.
- The host gives `maxStep`. A document cannot raise its own step, because the declaration comes from the language and the limit from the host.
- A limit changes only which documents a host accepts. The module only reads the document, thus a language evaluates an accepted document as before.

**Rejected options.**

- A function for the step of each node in place of a table. A table is data that a test, a catalog and an explanation can read. A language that needs the step of a variant gives the variant its own construct name, for example `iterate.data`.
- A walk of the documents of the kernel only. The first language checks its own expression tree before it makes a document of the kernel.
- A construct without an entry that is an error. A language adds constructs often, and its own test can check that the table has each construct.
- A reason with each node of the highest step. The first node is enough for a refusal, and the walk can stop at the first node of the highest step of the ladder.
- The name `ladder` for the module. The ladder of `ask` finds the evaluator of a verb, which is a different thing.

**Why.** A language keeps the step of each construct in one table, and the kernel keeps the walk, the reason and the refusal in one place. A second language gets the same rules and the same messages.

**Cost.** One walk of the document with its own stack, linear in the number of its nodes. A shared node is visited one time.

**Public types.** New exports: `StepKey`, `StepLadder`, `StepNeed`, `StepReason`, `StepRefusal`, `StepWalk`, `checkStep`, `isStep`, `stepLadder`, `stepOf` and `stepRank`. This is a feature for the next PATCH release, because the version is before `1.0.0`.

**Changed expected values.** None.

**Limits.**

- The step of a construct is a fact of its name. A step that depends on the data of a node needs a construct name for each variant.
- The reason gives one node. A host that shows each node of a step walks the document itself.


## D117 (2026-11-03): the margin and the noise cap of each case family come from the A/A records of CI

**Context.** K214, a limit of D114. The pooled verdict of the Speed run 41579105529 gave "slower" for "a tree with an equation". PR #226 changed no product code, thus the verdict was false. Job 2 gave +0.8 % for the head and -1.0 % for the A/A pair. The margin of D114 was a fixed 1.5 %, and the verdict had no noise cap.

**Decision.**

- Each case of `bench/cases.ts` is in one family: formula, reference, plan or tree (`bench/limits.ts`). A test makes sure that each case has a family.
- The limits come from the A/A records of 6 CI jobs: the Speed runs 41574523074, 41579105529 and 41580821217, two jobs each. The newer runs have no bench records, because their PRs changed no bench or product file.
- For each job and family, the script takes the largest absolute A/A median and the largest A/A spread (`aaSpread`) of its cases. Both are on a log scale.
- The margin of a family is the largest median plus the difference of the largest and the smallest median, with a floor of ln(1.015). The noise cap is the largest spread plus the difference of the largest and the smallest spread. Each limit goes up to the next 0.0001. There is no other factor.
- The limits are: formula 1.50 % and 4.86 %, reference 1.50 % and 11.51 %, plan 1.50 % and 31.68 %, tree 2.20 % and 30.42 %.
- A case without a family uses the fallback limits, 2.19 % and 30.50 %, from the same formula over all cases. Its verdict says "(fallback limits)". A family with fewer than 5 jobs also uses the fallback.
- `bench/limits.json` keeps the statistics of each case in each job and the limits. A test computes the limits again from the statistics and compares them.
- The bench workflows keep their records 90 days, not 14. Thus a refresh and the shared bench core can use them.

**The replay.** `bench/refresh.ts` gives the verdicts of the three runs again with the new limits.

- Pooled, with the margin of D114: run 41574523074 gave 1 slower and 1 faster, and run 41579105529 gave 1 slower. Both runs have the product code of the base, thus these three verdicts are false.
- Pooled, with the new limits: no slower and no faster in the three runs. The test `bench/limits.test.ts` replays the case of run 41579105529 from the fixture `bench/replay.json` in CI.
- Each job alone, in the two runs of the same code: 3 false verdicts stay. A verdict of one job is not the gate. The gate of `bench.yml` uses the pooled verdict (D114).
- The A/A pair of each job against the A/A pair of each other job: 16 slower or faster of 480 verdicts. Twelve are "factsOf a tree with an equation". These pairs come from two runners, thus they are not a gate.

**Limits of this decision.**

- A wider margin does not remove a false verdict of one job. The rule `difference` gives "slower" for an interval wholly above 1 and out of the margin. The interval of job 2 went past 2.2 %.
- The noise caps of the plan and tree families are near 30 %, because one job of each had an A/A spread near 15 %. At that size, a cap does not stop a verdict. A cap from more jobs, or the default cap of each family in the shared bench core, can replace it.
- The limits come from 6 jobs only. Refresh them when 5 or more new jobs have records.

**How to refresh.** Download each Speed run with `gh run download <id> -R mark1russell7/coeval -D <dir>/<id>`, then start `node packages/core/bench/refresh.ts <dir>`. The script writes `limits.json`, and the fixture when the run 41579105529 is in `<dir>`. It fails for a false pooled verdict of a run of the same code, and for a job whose A/A band does not hold 1.

**Why.** The rule of the gate limits is the worst of 5 or more CI jobs plus their spread, with the runs beside it. A fixed margin had no source. The limits of each family keep a quiet family strict, and they give a noisy family a wider margin.

**End of the interim rule.** Until this decision, a "slower" of a case under 10 µs with an A/A over 0.5 % did not block a merge. With the limits of D117, each pooled "slower" blocks again. Since 2026-11-05 (K232, D166), a pooled "slower" does not block when all arm hashes of the complete runs are equal. Such a reading is noise of the method.

**A suspect case (rigor #48).** 12 of the 16 deciding A/A verdicts between jobs come from one case: `factsOf` of a tree with an equation. That is a bias of one case between jobs, and the run-level test of rigor #30 does not find it. Thus the verdicts of that case are suspect until rigor #48 lands. The caps of plan and tree are near 30 % because one noisy job gives each of them. rigor #48 replays the records of the 90 days.

## D118 (2026-11-03): the hook `facts` gives the effects of a code, also for an own entry

**Context.** K64, from K18. An own entry of a document can name another evaluator than the kind. The contract of the kind does not describe that code. Thus `effectsOf` and `check` did not see its effects, and a host granted capabilities without the full list.

**Decision.** `KindFacts` gets the optional field `effects`, in the form of the field `effects` of a kind. For the verb `eval`, the answer of the hook `facts` for the code of a document wins over the contract (CAP.OWN-EFFECTS). `declaredEffects` reads it, thus `effectsOf`, `checkLatent`, `check` and `factsOf` use one declaration (D27). The probes of `conform` and the purity of a compiled document read the same answer.

**Alternatives.** A field in the envelope document can declare the effects of its own entry. But a document cannot vouch for code of the host. The language that has the code knows its effects. A second hook can give the effects. But the hook `facts` already describes the code of a name, with its reads and its purity.

**Why.** An answer without the field changes nothing, thus each old hook keeps its results. An empty list in an answer removes the effects of the contract, because the hook describes the code of its name. Another verb than `eval` keeps the table `verbEffects` of the kind (D49).

## D119 (2026-11-03): a kind declares in `drives` the parts that its runner evaluates without a wait

**Context.** K65, from K19. A compiled runner can evaluate a part with its code, and that code does not wait. The check of the waits assumed that a runner passes each wait of its parts through. Since K110, such a part fails in a run only when it really waits. But `check` did not find that failure, and `conform` refused each such runner (C6).

**Decision.** `KindFacts` gets the optional field `drives`, in the form of the lazy rules (RUN.DRIVES). It names the parts that the runner evaluates with its code. The answer of the hook `facts` for the code wins over the contract. The contract describes only the code of its kind for `eval`. In a check of a run, such a part gets no wait, as under an evaluator. Thus a runner under it gives the `#CALC!` of the run (RUN.DRIVE-NESTED). `conform` accepts the code of a part that `drives` covers.

**Alternatives.** A mark on the runner can name the parts. But the parts are a fact of the kind, as the lazy parts are. The check can find the calls by a probe. But a probe sees only its samples, and the check is static.

**Why.** Without `drives`, nothing changes: the check keeps its assumption, and `conform` keeps its C6 finding. The evaluation path does not change, because the run already fails only on a real wait (D38).

## D120 (2026-11-03): a step that reaches nothing in each run is a type issue

**Context.** K70, from K25. Some steps gave the type `unknown`, but each run gives `#N/A` at them. They go into a number, a text or a function, or into a list with a key that is not an index or `length`. Thus the check knew the failure and did not tell it.

**Decision.** `stepType` gives no step for these types (TYPE.NO-STEP). The reference gets the issue that a closed record without the field gives (TYPE.CLOSED), and the type `unknown`. The base types of the kernel are `null`, `undefined`, `bool`, `number` and `text`. A step of a domain of such a type still gives its type (TYPE.STEPS). A union keeps only its members with the step.

**Alternatives.** Each base type without a step can give the issue. But a domain outside the kernel can hold host things, and a host thing answers each step with its own code. A new error code can tell this issue from a missing field. But both issues say the same thing: the value has no such field.

**Why.** The values of a kernel base type are not objects, and a function is not data. A step into them reaches nothing, thus the issue holds for each member of the type. The evaluation path does not change.

## D121 (2026-11-03): a walker holds the type rule of its step

**Context.** K72, from K25. A path with a step document had the type `unknown` after the step. Thus a later step and the parent of the reference got no type, and the check found no issue there.

**Decision.** A walker can hold a type rule in its field `type` (TYPE.WALKER). The rule gets the data of the step document and the type before the step. It gives the type of each thing that the walker reaches. The check examines that type, and the path goes on from it. A plain function stays a walker, and a walker without a rule gives `unknown`. A step document with parts gives `unknown`, because it gets its data in the run. The reason of a missing field names a step document by its kind in parentheses.

**Alternatives.** The kind of the step document can declare the type. But the type depends on the type before the step, and the kind holds data, not code. A table of step rules in the machine can hold the rules. But then a merge must keep the rule and the walker together. The field `has` of a deref code (DEREF.KIND-UNDEFINED) is the same pattern.

**Why.** The rule follows its walker through the ladder, as the rule of an evaluator follows the evaluator (TYPE.RULE). The evaluation path does not change, and each old walker keeps its results.

## D122 (2026-11-03): a collection attribute combines the contributions of its subtree, and `tree.named` reads a registry of names

**Context.** L2g, from R3 P7. A node read another node only through a path of structural steps, for example a sibling through its parent. No attribute gave a value from each node of a subtree. Thus a node far away in another branch had no name that a path could use.

**Decision.** A declaration `collect` in `tree.attributes` gives a collection. The form `{ unit, combine }` starts with `unit`, and `combine` adds each contribution with the names `acc` and `item` (TREE.COLLECT). A node contributes through the equation of its kind in the new table `tree.contributes`, with itself as `self`. The node of the attribute visits itself, then each node of its tree in each list `children`, in the order of the lists. Each node counts one time. The collection is in the last rung, after a fold and before a default. The form `"names"` is the registry of binding names: a record from the header name of each node to its node (TREE.NAMED). Two nodes with one name give `#VALUE!` at the read of the registry. The new standard step `tree.named` goes up through `parent` to the first thing that answers the registry, and it gives the node with its name. `collectOf` reads a declaration for the kit, the reference, `check` and the graph. `check` examines the unit, the combine and each contribution, and it gives `#VALUE!` for a bad declaration. The graph gives a collection an edge from each list `children` of the subtree and from the reads of each contribution.

**Alternatives.** The field `root` of R3 names the kind of the node that collects. Here the node whose kind declares `collect` is that node, and `copy` or `tree.named` brings the value to the nodes below it. A name of an operation in `collect`, as in R3, contradicts D13 and D42, thus `combine` is a term. A structural step `name` on each node breaks each part with that name, thus the header name goes only into the registry. A graph rule for `tree.named` that finds the node by its name before the run waits for the first need. The step gets an edge with an unknown source, as each walker other than `nearest`. Another registry can give `#VALUE!` only for the read of a duplicated name. That registry needs a mark inside the record, and the mark can go into the JSON of a node.

**Why.** One declaration serves each roll-up of a subtree, and the registry is its first use. A collection uses the same parts as a fold. These parts are the memo of D16, the cycle chain, the evaluation of an equation without capabilities and the rules of `check` (D106, D107). Thus a cycle through a contribution gives the same `#CYCLE!` in `check` and in the run. A collection walks the whole subtree before its first read, and only a demand starts it (TREE.LAZY). The standard kinds `panel` and `box` get no contract, thus the default path of the tree does not change.

## D123 (2026-11-03): `typeFromSchema` reads local references and gives the meet of the keywords of a schema

**Context.** K73, from K25. A schema with `$ref` read as `unknown`, and `allOf` tested nothing. Many store schemas put their records in `$defs` and extend a base record with `allOf`. Thus their types told nothing about the paths of a document. A schema with more than one of `type`, `anyOf` and `oneOf` also kept only the first, with an issue for each other.

**Decision.** A `$ref` to `#/$defs/<name>` or `#/definitions/<name>` reads that definition of the root schema (TYPE.SCHEMA-REF). The name is a step of a JSON Pointer in a URI fragment. Each definition reads one time, and each later reference gets the same type. Each keyword beside `$ref` tests nothing, with an issue, because older drafts ignore it. Another reference reads as `unknown`. A missing definition does too, and so does a reference inside a schema with its own `$id`. A reference to a definition that the reading has not finished is a cycle, and it reads as `unknown`. Thus a tree of nodes gets one level of fields.

The parts of `allOf` and the other keywords of a schema give the meet of their types (TYPE.SCHEMA-ALLOF). The meet is exact for the forms of a reading. Two records merge their fields, and a common field gets the meet of its types. A field is optional only when each record permits its absence. A closed part keeps the merge closed, because a closed part has no other field. A field that only the other part has is absent, or no value fits when that part needs it. A part with the keywords of an object or of an array and without `type` narrows only the records or the lists. Two types without a common value give `never`. This decision replaces the clause of D28 that kept the first of `type`, `anyOf` and `oneOf`.

**Alternatives.** A merge that is closed only when each part is closed. But a part with `additionalProperties: false` refuses each field of the other part, as JSON Schema tells. Thus the closed merge is exact. A meet that keeps the first type, as D28 did. The meet of the forms of a reading is small, and it removes an issue that told less than the schema. A recursive type for a tree of definitions. The value types have no recursion, thus the cycle reads as `unknown`. References into `$id` and `$anchor` need a resolution of URIs, and no host has asked for it.

**Why.** Each rule keeps the reading sound: the type holds each value that the schema accepts. Each part of a conjunction holds its values, thus a part that reads as `unknown` takes nothing away. A reading only gets more precise. A schema without `$ref` and without `allOf` reads as before, except a mix of `type`, `anyOf` and `oneOf`. Such a mix gives the meet at this time, which holds fewer values that the schema refuses. The generated schemas of the property test also hold definitions, references and `allOf`, and a test of acceptance checks each value.

## D124 (2026-11-03): an attribute with parameters has its equation in `tree.at`, and the step `tree.at` gives the arguments

**Context.** L2h, from R3 P8. An attribute had one value for each node. A layout needs a value that depends on an argument, for example the height of a node at a given width. A plain attribute cannot keep a value for each width.

**Decision.** The new table `tree.at` of a tree contract gives each attribute with parameters an entry `{ params, equation }`. The new standard step `tree.at` with the fields `attr` and `args` reads an instance of the node before it (TREE.AT). The equation evaluates with the node as `self` and without capabilities. It sees each parameter as a name, for example `names.width`. The step gives an argument for each parameter, and no other argument. A missing or an extra argument gives `#VALUE!`. Each argument is JSON data. The key of an instance is the JSON text of the name and the arguments. The fields of each record are in the order of their names. Two arguments get one key only when they are equal by DOC.EQUALS. The memo keeps one result for each key, outside the state of the node. The reference keeps its instances in a list, and it finds an instance with DOC.EQUALS. The cell of a host gets the key of the instance as `attribute` (TREE.AT-CELL). Its `place` is a second array with the keys of the node. An entry has one rung, the equation of the kind. Thus it cannot be `circular`, `collect`, `copy` or `down`. A cycle through an instance gives `#CYCLE!`, also in a fixed point, because the instance is a plain demand.

`check` examines each entry, each equation with its parameters as names, and each step with literal arguments (TREE.AT-CHECK). The graph of attribute instances gives such a step one exact vertex for its instance. Its id is the id of the plain vertex with the key of the arguments after the name. A document in the arguments can be a part of a path, thus the graph gives it an edge with an unknown source. `atRuleOf`, `atArgsOf` and `argsKey` read the entries and the arguments for the kit, the reference, `check` and the graph.

**Alternatives.** An attribute in `tree.equations` with a declaration of parameters puts a new test into the read of each plain attribute. The read of an attribute without parameters gets no new work. Thus a separate table and a separate step answer. A key from `JSON.stringify` of the arguments gives two keys for two orders of the fields, and one key for `-0` and `0`. A circular attribute with parameters and a collection with parameters wait for a first need. Each needs one fixed point or one walk of the subtree for each key. The text syntax gives the form `tree.at(attr: "height")`, but it has no form for the record `args`. Such a step is written as a document.

**Why.** The new step is outside the ladder of a plain attribute, thus a document without `tree.at` evaluates as before. An instance uses the parts of an attribute. These parts are the memo of D16, the chain of a cycle and the evaluation of an equation without capabilities. They are also the cells of D108 and the rules of `check` (D106, D107). Thus a cycle through an instance gives the same `#CYCLE!` in `check` and in the run.

## D125 (2026-11-03): a clock for `call` gives one `#DEPTH!` for an endless recursion in each tier

**Context.** K94, from R7 P5 and the open question 3 of R1. PLAN.DEPTH limits the nesting of documents, but an application of a closure enters its body again. Thus an endless recursion through `call` stopped only at the stack of the host (VALUE.DEPTH). Each tier uses a different number of frames. Thus the place and the reason of `#DEPTH!` were different in the plan, the traced plan and the reference. On Node.js 24, a recursion through `call` overflowed the reference after 937 applications, and the plan after 1595. This measure ran on Node.js 24.21.0 on Windows. The test FORMULA.CALL-DEPTH runs the reference at twice the default limit, with no RangeError. Thus a Node.js version with a smaller stack fails in CI before a user reaches the limit. Through an operation of the host that applies a closure, the reference overflowed after 498 levels of two applications.

**Decision.** Each application of a closure of `fn` counts one level of a clock (FORMULA.CALL-DEPTH). An application by `call` and an application by an operation of the host both count. The count is a field of the evaluation that made the closure. In the plan it is a field of the runtime, and in the reference a field of the state of the evaluation. The first application adds the field to the runtime, thus an evaluation without a closure does no work for the clock. The count goes down in a `finally` after each application. Thus a nested evaluation, a failure and a host loop of many applications keep a correct count. The clock permits `ceil(maxDepth / 4)` levels: 250 for the default `maxDepth` of 1000. The application after the limit throws `#DEPTH!` with the reason "The applications of functions nest deeper than 250 levels." The document that applies the closure gets the place, as for each other failure of a closure (FORMULA.FN). Thus each tier gives the same code, place and reason. `check` does not find this error, because it comes from the values (STATIC.AGREES).

**Alternatives.** A limit of `maxDepth` applications, as R7 P5 proposed. The reference overflows before 1000 applications, thus the tiers still disagree with the default machine. A new option of the machine for the clock. A second limit needs its own rule in `mergeMachines`, and the quarter of `maxDepth` follows each host that changes the limit. A count of the nested documents of each application. Then each document of the plan changes a counter, and that is on the path of each evaluation. One count in a module variable for all evaluations. Then a nested evaluation starts with the count of another evaluation. One count for each `fn` document. Then a mutual recursion of two functions nests to two times the limit. The exception for an overflow in `agree` stays. A body with many nested documents, a tree and an evaluator of the host can still overflow the stack of the host.

**Why.** In the reference, an application of a short body uses the stack of approximately three nested documents. A quarter of `maxDepth` keeps a body of up to approximately nine nested documents for each application under the stack, in each tier. A recursion that stops under the limit gives its value as before. An endless recursion gives the same error in each tier, thus `agree` compares it without the exception for an overflow. The cost is an increment, a compare and a `finally` for each application. No case of the bench applies a closure.

## D133 (2026-11-03): the standard evaluator `ref.resolve` compiles its path, and the reference gets a definition

**Context.** K77, from K12 and D29. The formula kit compiles each static path in `prepare`, but the standard evaluator `ref.resolve` was a function. Thus each evaluation made the input of a function and resolved its path again. A step document asked the ladder of `step` again too. The reference reads a function evaluator directly, but it cannot read compiled code (REF.DIRECT). The design calls are when a path is static and what another navigator does. The other calls are how the planner interacts and how a test shows that each tier stays the same.

**Decision.** `ref.resolve` in `STD_EVALUATORS` is a compiled evaluator (PLAN.PATH-STD). Its `compile` reads the field `data` of its input, and it calls `compilePath` with the field `machine`. The code reads the path with `resolveCompiled`, thus the list of reads, a trace and each other runtime work as for the formula kit. A value that is not a path gives one `#VALUE!` at each evaluation, with the reason of the function form.

- Each path of the evaluator is static. The function form read only `data`, and it did not evaluate a part. The split fixes `data` before the first evaluation, also for a kind `ref` of a language that declares parts. Thus the compiled form takes the same `data`, and no document needs the function form. A path that a program computes at evaluation is the form of a function evaluator or of the formula kit (`stepsRef`). That code stays as it is.
- The navigator is the machine of the plan (PLAN.PATH-STD-NAV). `Session` already compares the navigator of a compiled path with its machine. A path of another navigator resolves the steps again, and a runtime of a host gets the steps through `resolve`.
- The planner keeps one plan for each document object and one machine (PLAN.PATH-STD-CACHE). Thus a cached path does not meet another navigator, and an equal document compiles again. An equation of a tree compiles one time for each machine, as before (TREE.PLAN). A new machine of `durable` gets a new planner.
- `STD_DEFINITIONS` gets the definition of `ref.resolve` (REF.RESOLVE), written as the function form was. The reference uses it for the standard evaluator, as for `tree.node`.
- The agreement has three parts (PLAN.PATH-STD-SAME, PLAN.PATH-STD-AGREES). Strict `agree` runs over 28 documents, 3 contexts and 4 navigators. The compiled form is compared with the definition under the same name, for each result, error, place and read. 300 generated documents take the same two tests. The configurations of `agree.test.ts` also reach the new code, because they read the standard machine.

One value changes for a host. `STD_EVALUATORS["ref.resolve"]` is an object, not a function. Its type stays `Evaluator`. A host that calls the entry as a function must call `STD_DEFINITIONS.evaluators["ref.resolve"]` (PLAN.PATH-STD-WRAP). Two wrappers on the site did this, and they read the definition.

**Alternatives.** A function with a field `compile`. It keeps each wrapper, but `isCompiledEvaluator` then reads a new form, and the two forms of `Evaluator` stop being separate. A side table from the function to its compiled form. Then each function evaluator costs a lookup in `prepare`, and the reference still has no definition of its own. The kernel can test the name `ref.resolve` in `compileNode`, but the kernel has no standard kinds. A compiled form only for paths without step documents leaves the costliest paths in the function form. A compiled form that also tests `Held` and `address`, as the formula kit does, changes behaviour. These rules are not rules of the standard kit.

**Why.** The path, the machine and the ladder of `step` are static, thus the work belongs in `prepare`, as D29 tells. `resolveCompiled` already gives the same reads and the same host calls, thus the compiled form adds no new route. No read or step function changes, thus each other case of the bench keeps its code. The compilation of a reference adds `keysFrom`, `startOf` and one object, and it removes the closures of `interpret` from the plan. No bench case times a `prepare` of a standard reference. The case `PLAN.COMPILE-SPEED prepare` uses the formula kit, and the two tree cases call `prepare` in their setup. These tree cases evaluate standard references, thus they get the gain.

## D126 (2026-11-03): a higher-order attribute gives a document as data, and the last rung `forward` reads a node that an attribute gives

**Context.** L2i, from R3 P9. An equation gave a value, or a nested node of its own text. It could not compute a document and put it under the node. A kind also could not take its attributes from a node that it builds. Thus a sugar form copied each equation of its expansion.

**Decision.** The new field `higher` of `tree.attributes` holds an equation that gives a document as data (TREE.HIGHER). It sits in the rung `default`, after `fold`, `collect` and `default`. The document evaluates as an equation, with the node as `self`, without names and without capabilities. Its root finds the open tree. Thus its parent is the node, and the rungs `parent` and `copy` work in it. Places in the subtree are relative to the document, as for each nested node of an equation. The subtree is not in `children`, thus a fold and a collection do not visit it unless an equation lists it. The new standard kind `tree.quote` holds a literal document, because the standard world has no literal for a record.

The kit does not change its planner. `documentKey` gives a structural key, and a table gives the first object of each key (TREE.HIGHER-PLAN). `equationPlan` caches by object, thus a new object with a known key compiles nothing. The key keeps the order of the fields, because that order decides the order of the JSON and the first error. A sorted key makes a result depend on the history of the cache, and D3 refuses that. One key means one document, equal by DOC.EQUALS. Two equal documents with two orders get two plans, and that costs only a compile. A weak map gives each object its key one time, thus the cost of a key is linear in the document, for each new object. The table holds at most 1000 documents and 16,000,000 characters of keys, as the table of plans does. A full table starts again.

The host cells of a subtree use `cellPlace` (TREE.HIGHER-CELL). The root of a generated document gets the key of its parent as its scope, thus two generators of one document have two keys. Two attributes of one node with equal documents share their keys, and their values are equal. A changed document has a new plan with new key arrays. The compiler tries a literal document one time, as for each literal nested node. Thus a host sees one demand of each attribute of the document in a scope without a parent.

A generated root keeps its depth in a weak map: the count of generated documents from the root of the tree to it (TREE.HIGHER-DEPTH). A generation walks up the steps `parent` to the nearest depth. Over `GENERATION_LIMIT`, which is 64, the attribute gives `#DEPTH!`. The tiers give the same reason. Thus an equation that generates its own kind forever ends with an error, before the stack ends. The limit bounds a chain, not a width. A kind that generates two subtrees at each level doubles its nodes at each level, up to the limit. That is a known limit of this first form.

A cycle through a generated subtree reaches a cell in evaluation, thus it gives `#CYCLE!` with its chain (TREE.HIGHER-CYCLE). A circular attribute that reads through a subtree works when each attribute on the cycle is circular. A circular attribute that gives a node does not become stable, because two nodes are not equal. It gives `#CYCLE!` at its limit.

The new field `forwards` of a contract names an attribute that gives a node (TREE.FORWARD). The new rung `forward` is the last rung, after `default`. It runs only when each other rung misses, thus the read of an attribute with an answer gets no new work. The rung reads the attribute `forwards` through the plain read, thus it uses the memo, the cells and the chain of a cycle. Then the node answers through its own ladder. A rung before it wins, thus an own part replaces a forwarded attribute. The rung counts each node that it reaches, because an equation can give a node without `higher`. The record of the rungs names `forward` only for a kind with `forwards`, thus each other record keeps its five rungs.

The forward has limits. A path that ends at a node gives its JSON, thus only an equation that gives a node has a target. A node of the document is not a target. The step `tree.at` does not forward. A collection does not walk into the forwarded node. But the attribute `children` does forward, thus a fold folds the forwarded children. An attribute with `copy` in the forwarded node reads its parent, and that parent forwards the read back. Thus such a name without an answer gives `#CYCLE!`, not `#N/A`.

`check` examines the equation of `higher` and the field `forwards` (TREE.HIGHER-CHECK, TREE.FORWARD-CHECK). It does not examine the document, because only the run knows it. A step after a generated subtree has an unknown source, as each read of a value has. A kind with `forwards` accepts each other name, because only the run knows the node. The run gives `#N/A` for a name that the node does not answer. The graph gives `higher` the reads of its equation and one unknown edge. It gives the rung `forward` one edge from the attribute and one unknown edge.

The reference interpreter has the same rules, with its own rungs. It compiles each document again, thus a structural key is not a part of the meaning. `agree` in strict mode compares the tiers with their reasons.

**Alternatives.** A new evaluator kind that puts a subtree in a part. But the place of a subtree belongs to an attribute, and an attribute has a memo, a cell and a chain of a cycle. A key with sorted fields, as `argsKey` has. It finds more equal documents, but the plan of the first document then gives the JSON order of the second. A key in the planner for each term. That adds work to each equation of each read. A budget of generated nodes for each evaluation bounds the width too. But the scope of an evaluation differs between the kit and the reference, and a build of a host stays across evaluations. A limit from the depth of the stack alone. That gives a different limit in each host and each tier. An inheritance for a forwarded root, where it reads each name of its parent. But the rungs `parent` and `copy` read the parent, and a second way gives one read two meanings. A rung `forward` before the rung `default`. But a default of the forwarding kind then has no effect.

**Why.** Both features use the parts of an attribute. The document is an equation, the root is a nested node, and `forwards` is the name of an attribute. Thus the new code sits at the end of the ladder, and a document without the two fields evaluates as before. The one object of a key limits the cost of a repeated document to one key, without a new branch in `equation`. The depth sits in a weak map, thus a node and a read get no new field. A depth limit gives each host the same error, thus an endless generation has one result in each tier.

## D127 (2026-11-03): the field `constructs` gives `STD_SYNTAX` text forms for `record`, `let`, `fn` and `call`, and no name becomes reserved

**Context.** K145, from C15. `STD_SYNTAX` wrote only operators, calls of operations, `if` and `list`. A document of `record`, `let`, `fn` or `call` gave `#VALUE!` from `print`. A call form wins over an operation with the same name (D41), and `STD_SYNTAX` permits each name of an operation. Thus a call form `let(...)` changes the document of each text `let(1)`, and `print` loses the text of `ops.let`.

**Decision.** The new optional field `constructs` of a profile gives the kind of each of four forms, and `STD_SYNTAX` sets all four (SYNTAX.CONSTRUCTS). Each text of a form was an issue before. Thus each text that parsed before gives the same document, and no name becomes reserved.

- ``{a: 1, `b c`: x}`` is a `record` (SYNTAX.RECORD-TEXT). A key is a plain name or a name in backticks, as in a form `named` (D63). Thus a reserved word, `__proto__` and a key with a space are good keys. A key that is not a plain name goes in backticks, for example `` `0` ``.
- `let {a: 1} in a + 1` is a `let` (SYNTAX.LET-TEXT). The field `bind` is a record of documents, thus the bindings use the text of a record. The word `let` starts the form only before a brace, and the word `in` has its meaning only after the closing brace.
- `(x, y) => x + y` is a `fn` (SYNTAX.FN-TEXT). A parameter is a plain name or a name in backticks, and each word is a good parameter. Only the symbol `=>` after the closing parenthesis tells a function from a group.
- `(f)(1, 2)` is a `call` (SYNTAX.CALL-TEXT). A group before the arguments calls a value, and a name before the arguments applies an operation. Thus `f(1)` stays `ops.f`. The text `(f)(1)(2)` calls the result of a call, and `f(1)(2)` stays an issue.
- Precedence: a record and a call of a value are one term. The body of a `let` or a `fn` goes as far as it can, and it can have a header name. Thus `1 + let {a: 2} in a * 3` has the body `a * 3`. As a term of an operator, `print` writes these two forms in parentheses, as it does for a document with a header name.
- Round trip: `print` writes a form only for a value of its exact shape, and each other value gives `#VALUE!` as before. The text `(f)()` reads `args: []`, thus a `call` without `args` has no text. A `fn` with two equal parameters has a text, because the contract of `fn` refuses it, not the syntax. A call form of the kind wins in `print`, and a host keeps its text `record(a: 1)`.
- A profile with `constructs` throws a `TypeError` when an operator reads the text of a form: `{`, `}`, `=>` or the word `let`. A generated round trip examines each form with the keys `in`, `let`, `or`, `0` and `__proto__`.

**Alternatives.** Call forms `let(a: 1, body)`, `fn(x, body)`, `call(f, 1)` and `record(a: 1)` fit the kit. But each one hides an operation of `STD_SYNTAX`, and that changes old texts. A form that falls back to the operation has two readings of `let(1)`. The text `let a = 1 in a` needs quotes for the keys `in`, `and` and `or`, and `=` already gives a header name. The text `x => x` already reads as the header name `x`, thus a parameter stays in parentheses. A call of a value with the text `f(1)` cannot tell a name from an operation. Forms in the parser without a profile field break each profile that gives `{` or `=>` another reading.

**Why.** Each form takes only a text that was an issue, thus the change adds readings and takes none away. The operations `let`, `fn`, `call` and `record` keep their texts, and the reference `let` stays a name. A profile field keeps the rule of D41: data drives the parser and the printer, and each other profile reads as before. The new forms use the entries of a form `named` and the arguments of a call, thus the tokenizer gets no new rule for keys.

**Limits.** `WORLD_SYNTAX` has no forms, because `STD_WORLD` has no such kinds. A host that spreads `STD_SYNTAX` gets the forms, and an operator of that host that reads `{`, `}`, `=>` or `let` throws a `TypeError`.

## D128 (2026-11-03): the probe `all` keeps the rule ALL, and the check `parallel` compares up to six orders of the waits

**Context.** K122, from K92 (D36). The probe `all` of `conforms` took its items one after the other. A real `all` starts each item up to its first wait, and the host then settles the waits in its own order. Thus code passed each check when it read a value before a wait and wrote the value after the wait. Code that kept its results in the order that they came passed too. One item after the other is also not an order of a run, except with the limit 1.

**Decision.** The probe `all` keeps the rule ALL of the kernel (CONFORM.PARALLEL). The items start in their order, up to the limit `concurrency`. Each item goes on to its first wait. One wait then settles, its item goes on, and more items start. A failure with `failFast` stops `all` as in the kernel. Each item that stops gives `#ABORT` and gives up its wait.

A scenario of a run first evaluates in the forward order: the oldest wait settles first. When `all` selected one wait from two or more in that shot, the shot has a choice. Then the scenario evaluates in five more orders. The backward order settles the newest wait first, and four orders come from a seed. Thus each scenario has at most six shots. A shot without a choice runs one time, thus a runner without `all` gets no new shot.

The seed is the FNV-1a hash of the JSON text of the probe document, with the option `seed` in its start value. No clock goes into an order, thus the same document and the same seed give the same orders. The draws of the orders come from their own source, thus the probes of each other check do not change.

Each other order gets the checks of one shot. The new check `parallel` also compares each other order with the forward order. The comparison reads the result, the results of a later call, the list of the parts that evaluate, and the effects with their payloads. The order of the parts and of the effects does not count, because the order of the host gives it (X-RECORD). The resolutions do not count, as in `agree`. A shot that `failFast` stopped gets no comparison, because ALL gives the first failure to the order of the host.

A finding has the form of each other finding. The obligation is `parallel`, and the probe gives the document, the results of the parts and the waits. The reason names the kind, the two orders and the two results. For example: `The code of par depends on the order of its parallel parts. The waits of all settle in the order [the part 0, the part 1] and the order [the part 1, the part 0]. The first order gives the value [1,2], and the second gives the value [2,1].` The check runs after `local`, thus it examines only code without state.

**Alternatives.** Each order of the waits. The count grows with the factorial of the waits, and a bound needs a sample anyway. Only the forward and the backward order. Then the wait that settles second is the same in the two orders for three items, and a test shows such code. The source `random` of the scenarios for the orders. Each draw then changes the probes of the later checks. Fields for the two orders in `Finding`. The reason of each other check holds its facts, and the form stays one form. An option that permits a race. A kind that races on purpose reads its finding of `parallel` as a fact, and a host filters by `obligation`. A comparison through real runs. D36 refuses it for the same reasons.

**Why.** The probe gets the orders of a run, and only these orders. Thus a host can see the behaviour of each finding. A test holds a real run that gives the two results of a finding. Six orders keep a probe cheap, because the count of shots stays linear in the scenarios. The forward and the backward order find most faults, and the seeded orders find a fault that these two hide.

**Limits.** The seeded orders are a sample. With four or more waits at one time, a fault of one rare order can stay hidden. A shot that `failFast` stopped gets only the checks of one shot. A difference in the resolutions alone gets no finding.

**Changed expected values.** `conforms` reports code that passed before: each runner whose result, parts or effects change with the order of the waits of `all`. A runner under `all` also gets another record in a run, because each item starts before the first wait settles. Thus a part after a failed part can start with `failFast`, as in the kernel. No evaluator or runner of the standard library or the formula kit uses `all`, thus no result of `conforms` for them changes. No existing test of `conforms` changes. The new tests are in `conform.test.ts`.

## D129 (2026-11-03): a language compiles its own paths with `compilePath`, and reads them with `resolveCompiled`

**Context.** K75, from K12 (R1 P2). D29 kept `compilePath` inside the package, because a language that resolves a compiled path itself skips the list of reads. Thus only the formula kit compiled its paths, and each other language resolved its static paths at each evaluation. D13 lets a language keep a second tier, and that tier needs the same read at a lower cost. The kernel already has the route. `resolveCompiled` gives a compiled path to the runtime of the kernel, and the steps to each other runtime. The design calls are the exports, the form of the route and the agreement that the tests pin.

**Decision.** The package exports the functions `compilePath(nav, path)` and `resolveCompiled(rt, ctx, compiled)` and the type `CompiledPath`, with the signatures that the kernel uses (PLAN.PATH-EXPORT). `Runtime` gets no new member. An evaluator calls `compilePath` in its `compile`, with the field `machine` of its input. Its code calls `resolveCompiled` with the context and the runtime that it gets. A compiled runner does the same in `compileRun`. No code of the kernel changes, thus `Session.read`, `resolveCompiled` and the formula kit stay as they are. Only doc comments change. A read through this route records what `Runtime.resolve` records with the same steps (PLAN.PATH-READS). A small language in `paths.test.ts` pins this without the formula kit. Its kind `read` has an interpreter and a second tier. Over 26 documents in 2 contexts, the two give the same value, error, reason, place, list of reads and host calls. The tests compare the plan, the traced evaluation, the run and the reference, also through `agree` and `agreeRun`. A runtime of a host that does not know compiled paths gets the steps through `resolve` (PLAN.PATH-ROUTE). The runtime of a fold refuses a read of a free name. The compiled path keeps the list that `compilePath` gets, thus the host must not change that list. The member `resolve` of a compiled path stays in the type, and its doc comment tells that it records no read.

**Alternatives.** A new optional member of `Runtime`. A runtime that wraps another runtime then must forward the member, and `resolveCompiled` must test for it. The function already chooses the route without help from the host. A compiled path as an argument of `Runtime.resolve`: D29 rejected it. A type `CompiledPath` without the member `resolve`. The export `resolve` already gives a language a read without the list, thus a smaller type closes no gap. A tier outside an evaluation has no runtime, and it needs the member. A copy of the list in `compilePath`. The list of reads then does not hold the list of the document (PLAN.PATH), and the code of the formula kit changes. A new function that gives a `Result` from a read. A language has its own rules for a value that a path reaches, as the formula kit has for a held error. Thus `valueOfThing` and `fail` stay the parts of that step.

**Why.** D29 refused the export only because no route recorded the reads for a language. `resolveCompiled` gives that route, and it ends in the same `Session.read` as `Runtime.resolve`. Thus the two can differ only in the step function, and PLAN.PATH-SAME already compares that. A mutant of the test language calls the member `resolve` of the compiled path, and three tests fail. Thus the tests find a tier that skips the route. The change adds exports and no code on a path of the bench, thus the code of each bench case stays the same.

## D130 (2026-11-03): `codecLaws` examines the laws of the codec of one domain

**Context.** K141, from K140. D40 states that `decode(encode(v))` equals `v` and that `encode` gives JSON, and D12 needs one document for each value. No code of the kernel examined these laws. The limits of D40 left them to a property test of each language. A codec that breaks a law fails only when a document reaches another language or a golden file. No domain of `STD_DOMAINS` has a codec. Thus the codecs of the repository are the domains of the tests, and `encodeValue` with `decodeValue`.

**Decision.** `codecLaws(machine, name, options)` examines the codec of one domain and gives a list of `CodecFinding` (CODEC.LAWS). The function has the shape of `conforms`: a machine, a name and options. A correct codec gives an empty list, and a name without a codec throws. A finding has the form of `Finding`: `obligation`, `reason` and `probe`. Only the first member that breaks a law gives its finding. The probe holds `domain`, `value` and `data`. The machine can be only its domains, thus a language can test one codec with `{ domains: { own } }`. The new module `codec-laws.ts` holds the function. `conforms` does not start it, thus `conform.ts` does not change.

The laws are `samples`, `encode`, `json`, `stable`, `decode` and `roundtrip`, in this order. The law `samples` gives a finding when the check has no member, because an empty check proves nothing (CODEC.SAMPLES). The law `encode` gives a finding when `encode` throws for a member. The law `json` asks that `JSON.parse(JSON.stringify(data))` gives equal data by DOC.EQUALS (CODEC.JSON). The law `stable` asks for equal data from a second `encode` of the member, and from an `encode` of the decoded member (CODEC.STABLE). The law `decode` sends the JSON copy of the data through `decodeDomain`, the path of an evaluation of `ext.domain` (CODEC.DECODE). The law `roundtrip` compares the decoded member with the member by `sameValue` and the option `equal` (CODEC.ROUNDTRIP).

The members come from `membersOf`. A domain with a list `values` gives that list. Each other domain gets the option `samples`, a fixed list of edge values and the lists `samples` of the domains. A value outside the domain gets no test. The edge values are `NaN`, `-0`, the infinities, the limits of the numbers, empty and odd texts, and large integers of the host. They also hold empty containers, containers with such numbers or `undefined`, two dates, a `Map` and a `Set`. The list is fixed, thus the check needs no seed.

No codec of the repository breaks a law (CODEC.STD), thus no behaviour changes. The check does not compare pairs of members, and it does not start `encodeValue`. A member that JSON writes gets the laws here, but its document in a term comes from JSON (D40). D130 replaces the sentence of D40 that keeps the laws out of the kernel.

**Alternatives.** A new check in `conforms`. Its probe holds a document, part results and capabilities, and a codec has none of these. A codec-only signature `codecLaws(codec, samples)`. It cannot test a decoded value against the domain and its parents, and it cannot filter the edge values. A check of each domain of a machine in one call. A host then gives one rule of equality to all domains, and a mistake in a name stays silent. A new field `Domain.equal`. It needs a new rule in `mergeMachines`, and the rule `equal` of `agree` and `conforms` already does this work. Seeded random members. The kernel has no generator of host values, and the fixed list finds the same edges in each run. A check of `JSON.stringify` only. A value that JSON changes in silence, for example `NaN` or `-0`, then passes.

**Why.** One function gives each language the same laws and the same edge values. A language keeps only its samples and its rule of equality. The law `decode` uses the JSON copy, because a document reaches a reader only as JSON. The law `stable` tests the decoded member too, because a coarse rule `equal` can hide a member with two documents. The check runs only in a test of a language, thus no path of an evaluation changes.

## D131 (2026-11-03): `checkCycles` gives the certain cycles of a schedule as issues before a run

**Context.** S2d, from S2. D33 finds the certain cycles of a graph, but a host gave `schedule.graph()` to `cycles`, filtered the answer and made its own message. The function `check` takes one document, thus it does not know a schedule. D107 gave `check` the certain cycles of a tree. A schedule had no such answer.

**Decision.** The new export `checkCycles(target)` takes a schedule, or another object with a function `graph`, and it gives a list of `CycleIssue` (SCHED.CYCLE-ISSUES). It reads only `graph()`, thus it evaluates no node. A `CycleIssue` is an `Issue` with the code `#CYCLE!` and a new field `nodes`. Each certain cycle of `cycles` gives one issue. The list `nodes` is sorted by name, as the record of the root `world` sorts the nodes. The issues are sorted by their first nodes (SCHED.CYCLE-ORDER). The first node gives the place `[id]`, its key under the root `world`, and the reason of `cycleOf`. A node that reads itself gives an issue with one node. An empty schedule gives an empty list.

"Certain" has the meaning of D33: the eager edges with a target close the cycle. A possible cycle gives no issue, as in D107, because a run can skip its lazy read (SCHED.CYCLE-CERTAIN). A certain cycle inside a possible cycle gives an issue with only its own nodes. A host that needs the possible cycles calls `cycles`.

The guarantee is one direction. No node of an issue gives a value (SCHED.CYCLE-AGREES). An eager read occurs in each evaluation in which each document around it gives a value (FACTS.LAZY). Thus a value at a node of the cycle needs a value at the next node, and the cycle closes. The result can be another error, because a read can fail before it reaches the cycle (D33). A node can also get the `#CYCLE!` of another node at a place, because the first failed read stops its document. The issues are not complete: a run that takes a lazy read gives `#CYCLE!` with no issue.

**Alternatives.** A method of `Schedule`. Each user of `schedule` then bundles the analysis of `graph.ts`, and an object that a host types as `Schedule` fails to compile. An option of `check` that takes a schedule. Then `check` gets a second form of input, and `static.ts` depends on the schedule. An issue for each node of a cycle. A ring of 100000 nodes then gives 100000 issues for one fault. The order of the graph for `nodes`. The order then depends on the order of the `set` calls, and a host that compares two answers finds a false change. An issue for a possible cycle with a second severity. `Issue` has no severity, and D107 refuses such a false positive. A cache of the answer for each structure epoch. The map of `graph()` already stays for an epoch, and a host calls `checkCycles` only when it needs the answer.

**Why.** A host gets the answer in one call and in the form of `check`. It can show the issues of a schedule and of its documents in one list. The function is a separate export, thus a run does no new work and a bundle without it does not grow. `check`, `Schedule` and `cycles` do not change. The harness of `agreeSchedule` adds more kinds of documents, and it finds no value at a node of an issue. S2c stays open. A certain cycle with more nodes than the stack of the host holds gives `#DEPTH!` in a read. The issue still names its nodes.

## D136 (2026-11-03): a kept read of the node in evaluation closes no cycle

**Context.** K217, from D56 and D57. A closure keeps a read of each whole root when its path meets a reference (READS.KEPT). That read resolves the root, and a root that holds a reference follows the reference. In a schedule, the reference can reach the root `world`, and the step demands a node.

When that node is the reader, the demand meets the node in evaluation, and the schedule closes a cycle. Thus a closure at a node whose `self` refers to that node gave `#CYCLE!`. The evaluation did not ask for the read, and a run has no such cycle. The evaluation from scratch of `agreeSchedule` gives the closure, because it records no reads. The contexts of SCHED.ONE-MEANING hold no reference, thus the test did not find it.

The same read occurs at the root `event`, in the verification of a kept read, and for a kind that sets another `self`.

**Decision.**

- `HostThing` gets the optional function `keeping(read)`. The kernel calls this function of the root `world` around each kept read that resolves its path, at the record and in `verifyReads`.
- `keeping` of a schedule notes the length of its stack. A demand of the node on top of the stack, at that length, is the kept read of the node in evaluation. It gives the same error as before, and it adds no mark for the cycle check (SCHED.OWN-NODE).
- Each other demand stays as it is. A kept read still demands another node, and a nested demand has a longer stack. Thus each read of that evaluation counts, and a true cycle there gives `#CYCLE!`.
- A read of the evaluation goes outside `keeping`, thus it closes the cycle with the same error.
- No list of reads changes, also for this node. Its kept read of the root reaches the error of the node (SCHED.OWN-NODE-READS).
- The reference and a plan without a list of reads do not change, because they keep no reads. A host thing without `keeping` does not change.

**Alternatives.**

- A kept read that does not demand, with a walk through the reference by `known`, as D57 does for a path. This removes each false cycle of this class. But a kept read of another node then reaches another thing, and that node stops its evaluation. Thus the reads of other documents change.
- A kept read that stops at the reference. The reference stays the same while its target changes, thus a change gives a stale value (D56, Rejected).
- No kept read of the node itself. This also gives the value, but the list of reads changes, and the rule of the list gets a second case.
- A new option of `resolve` for a kept read. Each step of a resolution then carries the option, for one host. The function `keeping` adds no work to a resolution.
- An undo of the marks after the kept read. The kernel does not know the marks of a schedule, and the schedule does not know which read of a list is kept.
- A kept demand that drops each node that it evaluated, when one of them reads a node in evaluation below it. This removes the false cycle of the Limits. D143 does it.

**Limits.**

- D143 removes the false cycle of a kept read that reaches its node through another node.
- Only the root `world` gets `keeping`. A host thing at another root that follows reads gets no call.
- A closure at such a node keeps each whole root. Thus each change of data evaluates it again (READS.KEPT).

**Why.** The kept read of the node itself adds nothing to the invalidation of the node. That read reaches the value of the node, and a pure document gives that value from its other reads (FACTS.PURE). When each other read stays the same, the evaluation gives the same value. A document that really reads the value makes a read of the evaluation, and that read closes the true cycle. Thus the error in the list hides no change, and each other read verifies as before.

The list of reads stays exact, thus each other document keeps its reads, its demands and its order of evaluations. The test SCHED.OWN-NODE-AGREES compares generated documents with the evaluation from scratch, over changes of data, edits and new machines. Four changes of the code each fail these tests. These are no rule, a rule at each depth, a rule for each node in evaluation, and a verification outside `keeping`.

Each kept read that resolves its path costs one call and one `finally`. A read of a node in evaluation costs one compare. A document without a kept read does no new work.

## D160 (2026-11-05): a parameter property becomes a plain field first in its class

The update of the shared config turns on the TypeScript option `erasableSyntaxOnly` (K224). The option refuses a parameter property, thus each one becomes a field and an assignment. The option stays on.

**The form.**

- Each field goes first in its class, in the order of the parameters, with the modifiers and the doc comment of the parameter.
- The first lines of the constructor assign the fields, in the same order.

**Why this form.** The config sets the target `esnext`, thus class fields use define semantics. The tool esbuild emits a parameter property as a field ahead of the other fields of the class, and the field starts as `undefined`. A plain field in the first place gives the same emitted code.

A `declare` field is not the same. It emits no field, so the object gets its properties in another order. An object with another order can have another hidden class, and a speed run can see that.

**How we examined it.** For each changed file, esbuild emitted the code of the old and the new source. The comparison moved each constructor to the top of its class and removed the doc comments. All 20 files gave the same text. A copy of the source with no installed config also gets define semantics from esbuild. Thus the two arms of a speed run use the same setting.

**SemVer.** No export, signature or enum changes, and the declarations of `Held` keep their members. This work needs no version of its own.

## D161 (2026-11-05): a failed test of the measure step turns it red, and the limit of PLAN.LEAN comes from 99 jobs

**Context.** K228. The step of PLAN.LEAN in `measure.yml` pipes its test run into `tee`, and it has no key `shell`. GitHub then starts the step with `bash -e` and no pipefail, thus the exit code of the test run is lost. D104 made this job the only gate of the limit. So the limit of 395 bytes was not enforced from K211 (2026-11-02) to this decision. Each statement that the limit held in that time is wrong.

**The read.** The read uses the logs of each job `measure` of 20 runs, from 41832320878 to 41977634472 (2026-11-04 and 2026-11-05). It starts no new job.

- There are 99 jobs, and each one concluded `success`.
- 8 jobs have a failed test, and 6 of the 20 runs have such a job. The failed test of each job is PLAN.LEAN, with 395.6 to 396.1 bytes.
- The other 91 jobs read 391.1 to 394.6 bytes.
- One head gives 392.4, 393.3 and 395.8 bytes in run 41971426548, thus a change of code does not explain the two levels.

**Decision.**

- The step has `shell: bash`, which has pipefail. A failed test turns the step red.
- The limit is the worst value plus the spread: 396.1 + 5.0 = 401.1 bytes. The owner of the gate accepted this one limit with this formula, up to 405 bytes.
- The step prints the CPU model of the runner, ahead of the pipe.

**What this limit gives up.** The limit goes up by 6.1 bytes, and most jobs read approximately 393 bytes. So a change that adds up to approximately 8 bytes to a plan does not turn most jobs red. The measure has two levels, and the top level hides this cost. K229 examines the cause, and it ends with a limit for each cause or a measure with one level.

**What we did not find.** The logs do not name the CPU model, thus this read cannot test the CPU model as the cause. All jobs have Node 26.13.0. The region and the runner image do not separate the levels: the 8 jobs are in 6 regions and 3 images.

**Limit of the claim.** No flip test shows yet that this step turns red. K227 adds it, by 2026-11-12.

**Changed expected values.** The limit of PLAN.LEAN goes from 395 to 401.1 bytes. No result of the kernel changes.

**SemVer.** No export changes. This work needs no version of its own.

**Correction (2026-11-06).** The cause of the two levels is code of the JIT in the window of the measure. The CPU model, the region and the image are not the cause. See D170.

## D170 (2026-11-06): the second level of PLAN.LEAN is code of the JIT, and the measure also reads the data spaces of the heap

**Context.** K229, from D161. 91 of 99 jobs read 391.1 to 394.6 bytes, and 8 jobs read 395.6 to 396.1 bytes. A measure with two levels hides a small cost. Since K227, each job prints its CPU model, runner image, kernel, Node version and setting of transparent huge pages.

**The read.**

- The logs of the 58 jobs `measure` of 12 runs, from 2026-11-05 11:14Z to 2026-11-06 03:00Z, give two levels again. 50 jobs read 391.2 to 394.6 bytes, and 8 jobs read 395.8 to 395.9 bytes.
- No column explains the levels. The kernel, the Node version and the setting of huge pages have one value in all jobs. The top level occurs on 4 CPU models and on both runner images.
- 6 of the 12 runs give both levels with one head. The matrix index of the 8 jobs has no pattern.
- A local read splits the heap by space with `getHeapSpaceStatistics`. In 48 new processes, `heapUsed` gave 373.6 to 376.1 bytes for each plan.
- Each high value of `heapUsed` came with 12 KB more in the code space and 7 to 10 KB more in the trusted space. These spaces hold the code of the JIT and its metadata, not plans.
- The other spaces, the data spaces, gave 374.9 to 375.3 bytes in all 48 processes.

So the top level is code that the JIT makes in the window of the measure, in some processes only.

**Decision.**

- The test also reads the data spaces: each space of the heap except the code space and the trusted space. The line `MEASURE` gives `bytes` and `data`.
- The limit stays on `bytes` (401.1) until the jobs `measure` give 20 or more values of `data`. Then the limit moves to `data`, as the worst value plus the spread, with the run ids and the CPU models. K229 ends with that change.
- A flip fixture of that change keeps one more array of 1 KB for each document. The data limit fails with it.
- The line keeps `bytes` after the change, so a growth of the code stays visible. It gates nothing.
- If the range of `data` in CI is more than 1.0 byte, the limit does not move until a new read.

**What this gives.** A measure with one level can have a limit near its values. Then a small cost of a plan turns the gate red.

**Limit of the claim.** The local read used Node 24, and CI uses Node 26. The values of `data` in CI decide the limit.

**SemVer.** Only a test changes. This work needs no version of its own.

**Since D171 (2026-11-07).** The limit reads `data`. 50 jobs gave a range of 0.7 byte, and the limit is 393.4 bytes.

## D171 (2026-11-07): the limit of PLAN.LEAN reads the data spaces, and it is 393.4 bytes

**Context.** K229, from D170. D170 kept the limit on `bytes` until the jobs `measure` gave 20 or more values of `data`.

**The read.**

- 50 jobs `measure` of 10 runs gave `data`, from 2026-11-06 03:45Z to 2026-11-07 14:22Z. The runs are 42158439505, 42174310419, 42180483956, 42185610540, 42185980459, 42186004072, 42205973145, 42210082061, 42218426879 and 42381192156. The flip rows are not in the count.
- `data` gave 392.0 to 392.7 bytes, a range of 0.7 byte. Thus the condition of D170, a range of at most 1.0 byte, holds.
- `bytes` of the same jobs gave 391.5 to 396.2 bytes, a range of 4.7 bytes.
- The 5 jobs with `bytes` over 395 gave `data` 392.5 to 392.7 bytes, and the other 45 jobs gave at most 392.4 bytes. So the code of the JIT also leaves approximately 0.3 byte in the data spaces. This is the top of the range, and the limit includes it.
- The jobs ran on 5 CPU models: AMD EPYC 7763 (18 jobs), 9V45 (12), 9V74 (12), Intel Xeon Platinum 8370C (6) and 8573C (2).

**Decision.**

- The limit reads `data`. It is the worst value plus the spread: 392.7 + 0.7 = 393.4 bytes. The old limit of `bytes` was 401.1 bytes, so the gate is 7.7 bytes nearer to the values.
- The line `MEASURE` keeps `bytes` beside `data`. It gates nothing.
- The flip row `flip` adds 20 bytes to `data`. The lowest value is 392.0 bytes, so each job passes the limit with it.
- A second flip row `retain` makes each plan keep an array of 1 KB. This is a true retained cost, and the data spaces see it, thus the step turns red. Both rows have `fault: true`, and the next step passes only if the step is red with the text of the PLAN.LEAN assertion.

**Limit of the claim.** The limit holds for these 5 CPU models and Node v26.13.0. A new CPU model or Node version can give other values. Then a red job without a change of the core is a new read, and the limit moves only with its run ids.

**SemVer.** Only a test and a workflow change. This work needs no version of its own.

## D162 (2026-11-05): the flip test of PLAN.LEAN is a matrix row of the same job

**Context.** K227, first part. D161 gave the step of PLAN.LEAN a working exit code, and no run had shown that the step turns red.

**Decision.**

- The matrix of the job `measure` has one more row, `flip`, with `inject: "20"`. It runs the same step, so a change of the step, its shell or its limit also changes the flip.
- The test adds `COEVAL_MEASURE_INJECT` to the value that the limit reads. The line `MEASURE` keeps the true value, so the row is also a sixth true value for K229.
- Only the flip row has `continue-on-error` on that step. Its next step passes only if the outcome of the step is `failure` and the log has the text of the PLAN.LEAN assertion. So a failure of another kind is no flip, and the job goes red.
- The 5 plain jobs of the same run are the copy with no fault.

**Why 20 bytes.** The lowest value of D161 is 391.1 bytes, and the limit is 401.1. So approximately 10 bytes is the smallest injection that passes the limit in each of the 99 jobs. 20 bytes leaves the same margin again if the values go lower.

**Limit of the claim.** The flip shows that the step turns red for a value over the limit. It does not show that a real cost of 8 bytes on a plan goes red. D161 tells why that cost stays under the limit in most jobs.

**Changed expected values.** The job `measure` has 6 rows. No result of the kernel changes.

**SemVer.** No export changes. This work needs no version of its own.

## D163 (2026-11-05): the gate `notSlowerVerdict` runs as report only beside the pooled verdict

**Context.** K225. The pooled verdict gives `same`, `faster`, `slower` or `cannot decide`, and the merge rule of this repository blocks only on `slower`. So a case with `cannot decide` counts as a pass. K121 read 13 of 16 cases so. `@mark1russell7/rigor-bench` 0.2.15 adds `notSlowerVerdict`, a gate that gives `pass`, `block` or `no read`.

**Decision.**

- The script `merge.ts` prints the gate of the two runs under the pooled verdict. Nothing reads its result, so it blocks nothing.
- The margin of each case is the margin of its family (D117). The gate uses the 3 looks of the bench core, so its level is the level of a gate that takes more rounds.
- `bench.yml` gets the inputs `rounds` and `jobs`, for the control run of this item.
- The check `Speed OK` and `continue-on-error` do not change.

**Limit of the claim.** This work shows the gate in each log. It does not show that the gate is fit to block. Three results are still open: the control run, the count of false blocks, and the flip test in CI. The unit test pins only that an injected 10 % gives a block on records.

**What this version does not see.** The names of the cases come from the records of the candidate. So a case that is absent from the candidate does not appear in the gate. `rigor-bench` 0.2.16 adds the option `expected` for this.

**SemVer.** No export of the package changes. The dependencies are for the bench, and they are development dependencies.

## D164 (2026-11-05): the ladder starts on a change of the kernel, and a flip job shows that its gate can block

**Context.** K227. The ladder prints a verdict for STATIC.LINEAR, and nothing reads it. The jobs started only when the workflow, `ladder.ts` or `mode.ts` changed. So a pull request that made a walk quadratic did not start the ladder. Of the last 100 Measure runs, 9 pooled a verdict, and no run in that set changed the kernel.

**Decision.**

- A third filter starts the jobs of the ladder: the kernel, `ladder.ts`, the lock file and the workflow. The jobs of `mode` keep their filter. One job takes approximately 1 minute.
- The mode `merge` prints one line of the gate. A time verdict other than `linear`, a memory verdict other than `at most linear` or no counted run is a block. With `LADDER_BLOCK=1`, a block gives the exit code 3.
- The job `ladder-verdict` accepts the exit code 3, so the gate is report only. Another failure of that step turns the job red. To make the gate block, a later pull request removes `|| test $? -eq 3`.
- `LADDER_INJECT=s` makes a walk with a true slope of `s`. Each call walks more levels, so the levels of one call grow as `n^s`, on the time and on the memory. The count of calls does not change. No document is deeper than its rung.
- **The job `ladder-flip` holds the code of the verdict and its exit code.** It runs on each change of the kernel, on one runner, at 10 rounds. It reads the slopes 2, 1.3 and 1, and the gate must read block, block and pass. Each block names each walk and each verdict. This job does not hold the size, because one runner at 10 rounds is not the setting of the plain gate.
- **The workflow `ladder-plain` holds the printed size.** It runs each week on its own minute, and on each change of the code of the gate. It has the setting of the plain gate: 5 runners, 30 rounds, the plain repeats. It reads a slope of 1.25 and a linear walk. A slope of 1.25 is over the sizes stated below. If that slope does not give a block, the printed size is wrong, and the owner of the gate reads that result.
- The check `Measure OK` reads this workflow, and it skips the workflow when the code of the gate does not change. A change of the gate that breaks this flip does not merge, because a weekly read comes after the merge. The weekly run covers a change of the lock file.
- A dispatch of this workflow can name another slope in the input `fault`. The weekly run and the call from `measure` use 1.25.
- The job checks the reasons of a block. A slope over the memory limit of 1.2 must give the reasons of time and of memory. At a smaller slope, the job must find the reasons of time and no reason of memory. So a block on the wrong reason turns it red.
- The filter of this flip is a second step of the job `ladder-changes`, because each further job waits in the queue again. Each pull request gets no further job.
- The line of the gate gives the smallest slope that gives a block, from the spread of its own runs. The time verdict blocks at the lower of `1 + half` and `1.2 - half`, where `half` is half of the 90 % interval. The memory verdict blocks at `1.2 - half`. Under that size, the gate has no read.
- **The size, stated before the first read.** The past 9 runs read `half` from 0.075 to 0.116 on time, so the plain gate sees a time slope of at most 1.12. The memory interval is narrow, so the plain gate sees a memory slope of at most 1.20. A slope of 1.05 is under this size, and a pass does not exclude it.
- The five plain runs are also a copy with no fault. Their line of the gate reads `pass`.

**First read.** In the CI run 42003078738, the linear walk read `pass`. The gate printed 1.07 on time and 1.19 on memory, and these sizes are in the stated sizes. The slope of 1.25 read a block on each walk and each verdict. Its time slope read 1.277 and its memory slope read 1.238, so the fault is near its stated slope, and not equal to it. The read of the fault printed 1.06 on time for `walk`, so the printed size moves between reads.

**Limit of the claim.** The flips test the slopes 2, 1.3, 1.25 and 1. They do not test a slope between the printed size and 1.25. So the result is a block at a slope of 1.25 at the plain setting, and the printed size stays a figure of the formula. One dispatch reads a slope of 1.12, and that read tests only the time, because the memory limit is 1.2. If that read does not give a block, the stated size moves up to the size that a read showed. The size shown on memory is 1.25, and the stated 1.20 is not shown. Before this gate can block, a read near a memory slope of 1.20 must show that size. The limit of the upper end stays 1.2 (D97). Past runs read 0 blocks of 9, on pull requests with no change of the kernel. With so few rows, the rule of three gives a rate of up to 33 % false blocks. This count is too small for a ruling. The new filter gives more rows with each change of the kernel.

**Since D166 (2026-11-07).** The kernel filter of the ladder also reads `packages/core/package.json`, `packages/core/tsconfig.json` and `pnpm-workspace.yaml`. The two filters of the ladder use the same pin of the action as the other filters.

**SemVer.** No export of the package changes.

## D166 (2026-11-05): the filters of the gates read the lock file, and a slower reading holds a merge only when the arm hashes differ

**Context.** K225 read a gap in the filter of Speed. The list had no lock file, so a dependency update skipped the gate and `Speed OK` passed. A run with both arms from one install does not read a slowdown from a dependency. The two arms differ only by the file of the kernel. K225 also read slower on 2 of 17 rows with equal code, on 2 of 7 branches (range 8 % to 64 %).

**Decision.**

- The filter of Speed adds `pnpm-lock.yaml`, `packages/core/package.json`, `packages/core/tsconfig.json` and `pnpm-workspace.yaml`.
- The two filters of Measure add the same files. The filter of the jobs at the head also adds each bench file that `mode.ts` reaches.
- A step in each filter job gives the rules of the pinned action a list of files. The lock file reads true, a docs file reads false, and the lock file reads false for a list with no lock line.
- Each Speed job records the hash of the bundle of each arm, with `cases.ts`. The script `merge.ts` prints the hashes and the line `Hold (D117)`.
- A slower reading does not hold a merge only when each run is complete and all hashes of the two jobs are equal. A list of files has no part in this reading.
- Changed by D173 (K239): under a hold, `Speed OK` is red, unless a record in `bench/accepted` accepts each slower case on that head.
- Each such row goes in the A/A table with the mark "equal by construction". A count keeps those rows apart from the rows with equal code on other pull requests.

**Rejected.**

- A skip of the bench on equal code. Equal-code runs are the only cheap read of the false-block rate, and K225 has its control run to come.
- A rule that a change only to the pins of two actions does not count. A pin of an action can change what a gate does.

**Limits.**

- Until D173, the hold was a reading, and no code line blocked the merge. A merge of L1a (#297) went in under a hold, and K238 followed. D173 ends this limit.
- Under `continue-on-error`, `needs.<job>.result` reads `success` for a failed job (run 42034457935). So a short or absent run left `Speed OK` green. D167 ends this.
- The base arm has no install. Its `tsconfig.json` names a base file that it cannot find, and esbuild continues. So the two arms do not build under the same settings. The hashes were equal in a read of this layout, but a real kernel change can show a difference from this cause. K234 gives both arms one resolved tsconfig.
- A new version of Node 26 changes the runs with no change of a file, so no filter sees it. K229 reads the Node version.
- The hash reads the name of the folder that holds `index.ts`, because esbuild names a namespace object after it. Both real arms use the name `src`. A different name reads as different arms, so it holds a merge and lifts no hold.
- K233 holds the read of a dependency slowdown.

## D167 (2026-11-05): a crash, a short run or a missing arm turns Speed OK red

**Context.** The jobs `bench` and `verdict` had `continue-on-error` at the level of the job. Run 42034457935 reads `needs.<job>.result` as `success` for a failed job under this setting, and `gate-summary` ends `success` over it. So a crashed bench gave a green check on each merge.

**Decision.**

- A fault says nothing about noise, so it needs no limit study. A crash, a short run, a missing arm, no cases or different results turns `Speed OK` red at once, with the reason in its log.
- The jobs `bench` and `verdict` lose the setting.
- The job `verdict` writes the outputs `state` and `reason`. The state is `same`, `slower`, `no read` or `different results`. The script `speed-read.ts` gives the answer of the check, and an empty or unknown state is red.
- A slower case and a `cannot decide` case stay report only until the flip of `Speed OK`.

**Count of false blocks.** The count covers the 317 runs that started a bench in the 11.4 days of the list. Of these, 30 stopped because a new push cancelled them. Of the other 287, 5 had a fault, and this is 1.7 %.

- Three are the time limit of the job, on 3 heads of one branch.
- Two are different results, on 2 heads of one branch. The branch changed the result of the case on purpose, and its next head changed the case (K236). So these two are true reds, and no fault of determinism.
- None is a fault of a runner, so this decision adds no retry.

One run of the 379 gave a server error, and the count does not read it.

**Different results.** The ruling names a crash, a short run and a missing arm. This decision adds different results, because such a case has no time reading. It has its own state and its own count, because it is a finding and not an absent read. On equal arms it is a fault of determinism. On different arms, a changed result can explain it, and the reason says which. 

**A result that changes on purpose.** Such a pull request goes red. Until K237 lands, the only path is a change of the case, as D69 did. That change removes a result from what the case compares, and no gate reads this. So the pull request text names each such case, with its old and new result. K237 adds a stated acceptance that the verdict prints. D169 is this acceptance.

**History.** Each green `Speed OK` before this merge says nothing about a crash, because a crash also gave green.

## D168 (2026-11-05): both arms of Speed build under one resolved tsconfig

**Context.** The base arm has no install, so its `tsconfig.json` cannot find the file that it extends. The tool esbuild only warns, and the head arm finds that file. So on a real kernel change the arms can differ because of the settings, and the reading blames the kernel.

**Decision.** The function `bundle` gives esbuild the `tsconfig.json` of the head for both arms. A warning that a base file is missing stops the bundle. A test reads three things. A `tsconfig.json` beside a copy of the kernel has no effect. A changed setting changes the hash. A file that does not resolve stops the bundle.

**Limits.** A pull request that changes `tsconfig.json` builds both arms under the new file. So Speed does not read the cost of that change. This is the same limit as a dependency in D166.

## D165 (2026-11-05): the share gate reads the parts of a split test as one group, first as a report

**Context.** K231. K230 split a test under the rule of D96. The largest share went from 0.602 to 0.078, and the split saved no time. Any slow test can pass the gate in the same way. A real cost can then hide behind a split.

**Decision.**

- The function `groupsOf` of `vitest.share.ts` reads the parts of each split test as one group. A part has a name that ends in the name that `corpus` gives.
- Each group has its total time, its number of parts and its share of the timeout of one part. It also has its fraction of the time of all tests of the run.
- In CI, the reporter prints each group in the log. This step is a report, and it does not fail a run.
- The limit of a group and its flip test come in a second step, by 2026-11-12. That limit comes from 5 or more CI runs, with the run ids and the formula beside it.
- D174 gives that step. The group report is a gate since D174.
- That step also states the meaning of the limit. A larger corpus is a fair reason for a larger share, so one limit in timeouts for all groups does not fit.

**Rejected.**

- A limit in this step. The log of a past run has no time for a part under 300 ms. It also has no time for all tests. So no past run gives the numbers.
- A limit of the share of one part, multiplied by the number of parts. Each part already passes that limit, so it adds no check.

**Why.** The share of a test finds a test that grows toward its timeout. It does not tell the cost of a corpus. The group gives that cost, and the fraction removes most of the speed of the runner.

## D169 (2026-11-06): a row of `changed-results.json` accepts a result that changes on purpose, and the fresh runner times the case

**Context.** K237, from D167. Two copies with different results in a case do not do the same work, so `Speed OK` goes red. A pull request that changes a result on purpose then had one path: a change of the case, as D69 did. That change removes a result from what the case compares, and no gate reads it. Each bench has this question, so the rule went to `@mark1russell7/rigor-bench` 0.2.23 first (`resultRows`, `resultVerdict`).

**Decision.**

- A row of `packages/core/bench/changed-results.json` names the case, the result hash of the base, the result hash of the head, and a reason. The function `resultHash` of `merge.ts` gives each hash: the first 16 hexadecimal digits of the SHA-256 of the result text. The run and the rows use this one function.
- `paths.ts` reads the rows of the base and of the head, each from its own tree, and gives them to `resultVerdict`. A base without the file has no rows.
- A new row of the exact hashes accepts the change. The fresh runner then times the case as each other case, with head and A/A pairs and its time verdict. The table marks the case "accepted change", and the log prints the line of the row.
- A change with no row, a spent row or a row of other hashes is refused. The case gets no time, and the run fails with the line of `resultVerdict`. A refused line with no row gives the row to add.
- A row of the base is spent and accepts nothing. A new row is a fault of the run when it accepts no change, or when the run has no such case. `merge.ts` adds it to the faults, so `Speed OK` goes red.
- The run record keeps the verdict of the rows (`results`). `merge.ts` prints its lines one time under "Changed results (K237)".

**The flip.** `bench/changed.test.ts` makes a head kernel whose `context` reads the name `x` one higher. So `FORMULA.SPEED formula` gives 5 and not 4. A real run with a new row of the two hashes passes, and the fresh runner times the case with different arm hashes. With no row, a spent row or a row of another head, the run fails and times nothing. A new row on equal results is a fault.

**What does not change.** The rule reads results only, so an accepted change buys no time reading. The mode run `mode.ts` keeps its own read of different results, because it compares two modes of one copy.

## D135 (2026-11-03): the option `selfOf` gives each node of a schedule its own `self`, nodes with one document share one plan, and a new `self` is a change of data

**Context.** S1f, from S1 (D31). A schedule gave each node the one context of the host. One formula at each cell of a grid then needed the data of the cell in its document. Thus each cell had its own document, and each document compiled its own plan. `durable` keeps a plan for each document object and a result for each key, and its `evaluate` takes a context for each key (D30). Only the schedule gave a host no way to use this.

**Decision.** The new option `selfOf(id, host)` of `schedule` gives the `self` of a node (SCHED.NODE-CONTEXT). The schedule starts the function for each evaluation or verification of a node, and for each run of a node. Thus it starts at most one time for a demanded node in a data epoch. It gets the name of the node and the context of the host, without the nodes at the root `world`. The value `undefined` keeps the `self` of the host. A node gets a copy of the context of the epoch with its `self`. The copy keeps the grant and each other root.

- **One plan.** A plan, a facts object and a list of edges stay for each document object (SCHED.NODE-PLAN). Thus nodes with one document share them, and `durable` needs no change. The value, the reads and the place on a cycle stay for each node.
- **A change.** A new `self` is a change of data (SCHED.NODE-STALE). The host tells it with `changeData`, and it has no epoch of its own. Each demanded node then verifies its reads with its new `self`. A node that reads no changed field keeps its result, and a new `self` object with equal data changes no read.
- **Static facts.** `factsOf`, `edgesOf` and `graph()` read only the document. A read of `self` is a read of the data of the host, thus it is not an edge, and `NodeInfo` does not change.
- **Cycles.** A cycle is a cycle of nodes, not of documents (SCHED.NODE-CYCLE). A reference in a `self` can lead a read to another node, and the reads of the evaluation show it. The demand then gives `#CYCLE!` by D31, in each order of demands.
- **Runs.** A run gets the `self` of its node, and the `event` of the run as before.
- **Closures.** A closure keeps the `self` of the node that made it, also in the evaluation of a reader. A reference in the value of a node resolves in the context of its reader (DEREF.COLLAPSE). Thus a root `self` there is the `self` of the reader.
- **The harness.** `agreeSchedule` gets the option `selves`, and the model gives each node its `self` (SCHED.NODE-AGREES).

A host without the option keeps each behaviour. Each node then uses the one context of the epoch, with no copy, and each evaluation of a node pays one test for `undefined`.

**Alternatives.** An option of `set`. A `set` is a change of the structure, thus a new `self` then rebuilds the graph, or it needs a second method. The schedule then also keeps a table that the host already has.

A new method for the `self` of one node, with a mark for that node. A reader of the node has its value in the epoch, thus such a change needs a new data epoch too. D31 has no push of dirty marks, and only S3 can use them.

A function that gives a whole context. Capabilities for each node can widen a grant, and `event` belongs to a run. A host puts each field of a cell into `self`, thus the names of each node have no first need. Another option can add them.

Edges for each node from the references in its `self`. The facts then need a walk of the data of each `self` in each epoch, and that is the open item S1d.

A closure of `fn` with the cell as an argument. Such a host gets one plan, but the reads of a node then do not show the fields of its cell.

**Limits.**

- One plan needs one document object. Equal documents in new objects compile one time each (PLAN.CACHE).
- No edge shows a read through a reference in a `self`. Thus a demand of the deep end of a long column uses the stack of the host for each cell. Such a demand fails at 2000 cells. A host that demands the cells in the order of the rows gets each value.
- A new `self` of one cell verifies each demanded node, as each change of data does.
- `selfOf` gives the same data for a node in one data epoch. This is the promise of DURABLE.REUSE. `context` of a schedule keeps the `self` of the host.
- A closure with a kept read that meets a reference keeps each whole root (READS.KEPT). A `self` that is itself a reference to its own node closes no cycle since D136 (K217). The `self` of a host context gives the same answer. The limit of D136 stays: a `self` that reaches its node through another node still closes a false `#CYCLE!` (K218).

**Why.** The function adds no state to the schedule. The host keeps its cells, and a change of many cells is one change of data. The verification of D26 already compares what a read reaches in a new context, thus a node gets its own invalidation with no new rule. The test SCHED.NODE-PLAN counts 1000 cells of one formula with one compilation and one facts object. The test SCHED.NODE-AGREES compares each answer with a model from scratch, and it finds an engine that keeps an old `self`.

## D137 (2026-11-03): `conforms` examines walkers, the code of a `deref` and the functions of a formula profile

**Context.** K121, from K92 (D36). `conforms` threw for the name of a walker and for the name of the code of a `deref`. It examined `formula.op` and `formula.ext` only for the types in the option `types`. Thus the laws of this code stayed text. Each check below tests a law that the docs state. Four laws need a reading, and this entry records them.

**Decision.** The name selects the code. An evaluator and a runner keep their place. Without the option `verb`, each other name selects its walker, and then its `deref`. The option `verb` with the value `step` or `deref` selects that code by force. A finding has the form of each other finding. Its probe also holds the new field `here` for a walker, or the new field `key` for a `deref`.

A walker gets its input from the probes, as R-WALKER gives it. The things are three linked host things, a document, `undefined` and the values of the palette. The option `things` adds more. The steps of the probe use the ladder and `adopt`. The checks of a walker are these:

- `result` (CONFORM.WALKER-RESULT): the answer has the form of `WalkResult`, and a failure code starts with `#` (the type `ErrorCode`).
- `local` (CONFORM.WALKER-LOCAL): the same input gives the same outcome and the same steps in a later call (EVAL.DETERMINISTIC). A volatile kind gets no such test (FACTS.VOLATILE).
- `ladder` (CONFORM.WALKER-LADDER): a step on a host thing goes through `deref` and `has` of the input (R-WALKER).
- `hops` (CONFORM.WALKER-HOPS): each `visit` tells a key that the walk followed and the thing that the key reached (the type `WalkInput`). The walk stays the same without `visit` (DEREF.HOPS).
- `C4` (CONFORM.WALKER-PURE): the walker of a pure kind gives the same walk with other values in the roots (FACTS.VERB).
- `typed` (CONFORM.WALKER-TYPE): each thing that the walker reaches is a member of the type of its rule (TYPE.WALKER). The probes ask the rule for the type `unknown` and for the plain type of the thing before the step.

The code of a `deref` gets each probe document with each probe key. Its checks are `result` (CONFORM.DEREF-RESULT), `local` (CONFORM.DEREF-LOCAL) and `has` (CONFORM.DEREF-HAS). This code gets no context, thus C1 and the roots do not apply to it.

The default types of `formula.op` and `formula.ext` hold each operation and each extension that the tables of the profile list, except a volatile name (CONFORM.PROFILE-NAMES). Thus C3, C4, C8, `local` and `agree` see the code of each named function. Two checks call the functions directly:

- `typed` (CONFORM.PROFILE-SIGNATURE, CONFORM.PROFILE-EXT): an operation gives a member of the result of each signature that its arguments match, after the hook `check`. An extension gives a member of its entry in `extTypes`. This is the text of `FormulaProfile`.
- `result` (CONFORM.PROFILE-FORM): `ext`, `lazy`, `check`, `omit`, `missing` and `combine` give the form of their types.

The first reading is the law of a throw. An evaluator has E-THROW, and R-WALKER has no premise for a throw. A plain throw of a walker or a `deref` leaves `resolve` and drops its hops, thus it is a finding of `result`. A `Failure` is the error channel that the walker of `tree.at` uses, thus it gets no finding.

The second reading is the law of the ladder. R-WALKER gives the walker the step `adopt∘step`. A direct read of a host thing skips `adopt`. A probe node records each read outside the input, and that read is a finding. The field `type` of a host thing is not a step, thus `nearest` stays correct.

The third reading is the law of `has`. The type `DerefCode` tells that `has` gives `true` when the document has the field. The kernel asks it only after an `undefined`. The check reads the text: a key that the code answers needs `true`.

The fourth reading is the widening of a context, which K121 names. `WalkInput` has no call that takes a context, and it has no effect and no wait. Thus a write to the context is the only channel. The probe context is frozen, and that write throws. The throw is a finding of `result`.

**Alternatives.** A function next to `conforms` for each form of code. D86 and D94 rejected that form, because a host then has two lists of findings. A walk through `resolve` with a step document. That walk hides a stray `visit` and a direct read, and a plain throw ends the whole probe. A law against a throw of an operation, a lazy operation, an extension or `check`. The kit catches each of these and gives an error (E-THROW), and an existing test throws from an operation on purpose. A proxy that records each read of the context. C4 sees a read through other values in the roots, and a proxy changes what a walker gets. A generator of random arguments for a signature. Each list of arguments here comes from the fixed palette, thus each finding repeats.

**Limits.** Each check is a sample of the probes, thus a fault outside the probes stays hidden.

- The probe of a signature takes at most 64 lists of arguments. A longer product keeps the first 64.
- Only the probe nodes record a direct read. A host thing of the option `things` gets no such test.
- A `sigs` or `ops` that is a function lists no names. Give the types in the option `types`.
- The default step of a world and each kind under `defaults` need the option `types`.
- Code in sloppy mode writes to a frozen context without a throw, and that write gets no finding.
- A write to the data of a step or to a document gets no finding when the result stays the same.
- Hidden state that changes outside a call gets no finding. An extension that counts the names stays as D47 tells.

**Why.** Each law has a line in the docs or a reading in this entry, and a host can see the source of a finding. The check keeps the standard machine as its main guard: each walker of `STD_MACHINE` and each evaluator of the kit give no finding. Each law has a planted fault in a test. `conforms` runs in no hot path, thus the evaluation of a program stays the same.

**Changed expected values.** `conforms` gives a list for a name that threw before. A host that uses the default types also gets probes of each named function. Each of these can give a finding for code that passed before. `Obligation` has five new members, and `ConformProbe` and `ConformOptions` have new optional fields. An evaluation gives the same results.

## D139 (2026-11-03): after an overflow of the stack, a walk with its own stack finds each cycle of real reads, and a chain with no cycle keeps its `#DEPTH!`

**Context.** S2c, from S2a and the limits of D33. A demand uses the stack of the host for each node that it enters. The demands ahead do not help on a ring, because each of them enters the ring again. On Node.js 24, a ring of 2000 nodes gave `#DEPTH!` with the reason of the evaluator `formula.ref`. D31 gives each node of a cycle `#CYCLE!`. A ring of nodes that catch the error was worse: each node gave the value of its catch, from the depth of the overflow.

The same overflow showed two more faults. A compilation near the limit of the stack gave a plan that fails, and `durable` kept that plan for the document. Then a later evaluation at a shallow depth failed too. The cleanup in `visit` called a function near the limit, and that call failed at times. Then a node stayed open, and its reader found two nodes in its component. A lazy chain with no cycle gave a false `#CYCLE!` in 1 of 400 runs, in a local measure. The test SCHED.LONG-CHAIN had a comment about this result.

**Decision.**

- **The trigger.** `thrown` counts each stack overflow that it changes into `#DEPTH!`, and the internal function `overflowCount` gives the count. A demand of the host compares the count before and after `visit`. A document that catches the error cannot hide the overflow from this count.
- A demand of the host with an overflow makes a walk, and each later demand of the host in that data epoch walks too. An earlier `#DEPTH!` can stop a read before the cycle (SCHED.DEEP-CYCLE-REAL).
- A nested demand does no new work. A demand of the host reads one number two times and one field of the epoch. Thus a document with no overflow pays only that.
- **The walk.** The walk starts at the node of the demand, and it uses the lists of `visit` as its own stack. It evaluates one node at a time, through the plan of the node and a root `world` of its own.
- A read of a node with a result of the walk gives that result. A read of a node on the stack of the walk gives `#CYCLE!`, as in `visit`. A read of a node on the run side gives `#REF!`.
- A read of each other node stops the evaluation. The walk enters that node and finishes it. Then the reader evaluates again, and its read finds the result.
- The links of the algorithm of Tarjan stay the links of `visit`. Thus a walk gives each order of demands the components of D31, also when a document catches the error.
- After the first stop, each read of the evaluation stops too. Such a read does not happen in a real evaluation.
- **Certain means real.** Each link of a walk is a read that an evaluation really made. A static edge makes no cycle, thus the rule of D33 stays: a read can fail or be skipped before it occurs.
- **The results.** A walk that reaches no cycle changes nothing, thus a chain keeps its `#DEPTH!`. A walk that reaches a cycle gives each node that it entered its error, and it drops the durable result of each such node.
- A node of that walk with a value evaluates again at its next demand. Its value can hold the root `world` of the walk, and that root does not answer a host.
- **The bound.** Each evaluation of a walk enters a new node or finishes a node. Thus the walks of one data epoch do at most `2V` evaluations for `V` entered nodes. The count of the reads of a node does not change this bound (SCHED.DEEP-CYCLE-BOUND).
- One evaluation of a walk costs one evaluation of a node. It keeps no trace and no list of reads. A node evaluates again at most one time after a walk, thus an epoch adds at most `3V` evaluations.
- The memory is one result and one entry in each list for each entered node, thus `O(V)`. The results stay until the data epoch changes. `V` is at most the count of the nodes that the real reads reach.
- **The coverage.** The check is in `demand`, thus `read`, `run`, the host thing at the root `world` and the record of the root all reach it. A plan, a traced plan, a run and the reference reach it through the root `world`. The walk itself evaluates in the plain plan tier (SCHED.DEEP-CYCLE-ENTRY).
- **The two faults.** `durable` does not keep a plan when the count of the overflows changed during its compilation. The cleanup in `visit` is a loop with no call of a function of the module.

**Alternatives.**

- `cycles` over the static edges after an overflow. It costs less, but SCHED.DEEP-CYCLE-REAL has a certain ring of edges with a node that fails before its read, and D33 refuses this answer.
- A test of the result of `visit` for `#DEPTH!`. A document that catches the error then hides the overflow, and a ring of `ifError` nodes keeps its wrong value.
- A limit of depth in `visit` that starts the walk before an overflow. That adds a compare to each demand, and a lazy chain that fits the stack also pays for a walk.
- A demand with its own stack in place of the stack of the host. A plan evaluates a read inside its code, thus such a demand needs a stop at each read of each document. That is the walk, on the path of each document.
- Values of the walk for the host. That solves S2b too, but such a value can hold the root of the walk, and S2b has its own decision about evaluations that repeat.
- Each result of the walk in place of each memo after a cycle. A closure from the walk then reaches a host, and SCHED.DEEP-CYCLE-REAL finds it.

**Why.** The work runs only after the limit fires, thus the Speed gate has no new work on the path of a demand. D33 rejected a restart because each node evaluates at most one time in a data epoch (SCHED.DEMAND). A walk gives no node a value, thus that rule stays for each value that a host gets.

The harness SCHED.DEEP-CYCLE-AGREES throws one overflow at each demand of a generated graph. Each node with `#CYCLE!` in the plain demand gives the same error after a walk, and no other node gives `#CYCLE!`. Thirteen mutants of the walk, the trigger, the results and the cache all fail the tests. After the change of the cleanup, 900 runs of a lazy chain gave no false `#CYCLE!`.

**Limits.**

- A walk evaluates a node again, and `counts` does not count this evaluation. A document that is not pure can read other nodes in the walk.
- A chain with no cycle keeps the result of the first pass. A node that catches an overflow in such a chain keeps the value of its catch (S2b).
- The evaluation from scratch of `agreeSchedule` uses the stack of the host for each node. It gives `#DEPTH!` for a ring longer than the stack, thus such a graph is out of its range. Its generated graphs have five nodes.
- The count of the overflows is one number for the process. An overflow in an unrelated evaluation inside a demand starts a walk, and the bound stays the same.

## D138 (2026-11-03): `parse` gives each issue of a text in its field `issues`, and recovery reads only a text whose brackets and quotes close

**Context.** K144, from C15. `parse` stopped at the first issue, thus an editor saw one fault at each read. The field `issues` of a failed answer is a list, and it held one item. Recovery has two risks. One fault can make a cascade of false issues, and recovery code can slow the read of a valid text.

**Decision.** The field `issues` of a failed answer holds each issue, in the order of the offsets (SYNTAX.ISSUES-ALL). The type `ParseResult` does not change. The new export `MAX_SYNTAX_ISSUES` is the bound, and its value is `20` (SYNTAX.ISSUES-BOUND).

- Two reads. The first read is the parser of before. Only its first issue starts the class `Recovery`, which reads the text again from the start. Thus a valid text runs no recovery code.
- The first read gives the first item of `issues`, and recovery only adds items after it. Thus a host that reads `issues[0]` gets the same offset, length and message (SYNTAX.ISSUES-FIRST).
- A gate. Recovery starts only when each quote closes and each bracket closes in its order. Each other bad text keeps its one issue, because its synchronising tokens are not sure.
- Synchronising tokens come from the profile (SYNTAX.ISSUES-SYNC). They are `calls.separator`, the closer `)`, and the closer `}` when the profile has `constructs.record` or `constructs.let`. The scan skips each quoted text and each inner bracket.
- A fault in a list moves to the next separator or to the closer of the list. A fault in a group moves to the closer of the group. A bad escape stays in its text, and the read continues after the escape.
- A fault outside each bracket has no synchronising token, thus the read ends there.
- Four rules stop a cascade (SYNTAX.ISSUES-CASCADE). The offsets rise, thus `if(1 2)` gets no issue for its count of arguments. The first token after a synchronising token gets no issue, thus `list(,)` gives one issue.
- The third rule is for a colon in a list. A colon tells that the name of a form has a fault, thus recovery skips the other items of that list.
- The fourth rule is for a separator in a group. It tells that a function has a fault, thus the fault also ends the item around the group.
- The end. The scan only moves forward, and the list consumes each synchronising token. The depth stays under `maxDepth`, thus each input ends. An error of a host in a later text ends the read, and the answer keeps the issues so far.

**Alternatives.** A new export `parseAll`. It gives two entries for one job, and a host must change its code to see more. The field `issues` is already a list, and a reader of `issues[0]` sees no change. A new field `more` next to `issues` has the same fault.

Recovery inside the first read. A stack of open brackets or a `try` around each item is on the hot path, and the Speed gate permits no slower case. A read of each item of a list alone, as a small text. Such a read loses the keys and the forms around the item. A resume at the next operator. A scan cannot find an operator safely, because `-` is also inside `2e-3`. A closer that recovery adds for a missing bracket. The text `f(1, (2, 3)` does not tell which bracket is missing.

**Why.** The gate, the rising offsets and the silent first token keep each later issue away from the reach of a fault. A generated test damages printed documents of eight profiles. It reads 38842 bad texts, and the largest count of issues is 5. Of 10501 texts with one fault, each cascade comes from a fault in a quote mark. A digest of each first issue equals the digest from the parser before this decision.

**Limits.** A bad text costs two reads. A text with an open bracket or an open quote gives one issue. A missing closer thus hides each later issue until the host corrects it.

Recovery prefers a missed issue to a false issue. The first token after a synchronising token gets no issue, thus `{a 1, b 2, c 3}` gives one issue. A fault outside brackets ends the read, thus `1 2 + (3 4)` gives one issue.

A fault in a quote mark can pair with a mark inside another text. Then the gate passes, and later issues can be false. This occurred in 9 of the 10501 texts, and each of the 9 holds a text with all three marks. A pattern of a profile that holds a closer can give a false issue at the end of the text.

## D140 (2026-11-03): `checkSyntax` reports the faults of a syntax profile, and each finding is a small document that breaks the law

**Context.** K146, from C15. `compileProfile` refuses many clashes with a `TypeError`, and it stops at the first one. Other faults pass it. With `+` at the precedence `1` and `*` at `1.5`, the document `add(a, mul(b, c))` prints `a + b * c`, and that text reads `mul(add(a, b), c)`. A host finds such a fault only when a document fails. The law of the kit is that `parse(print(doc))` gives `doc` (SYNTAX.ROUNDTRIP).

**Decision.** The new export `checkSyntax(profile)` gives a list of `SyntaxFinding` with `code`, `place` and `reason` (SYNTAX.PROFILE-CHECK). The list has at most one finding for each code and place. The function uses the law as its oracle.

- The function writes and reads small documents. It has one for each operator and one for each ordered pair of operators. It also has one for each root, form, name of `calls.ops` and construct. A `flat` operator also has documents with three terms.
- A finding is a document that does not come back, thus it is not a style opinion. Each test plants a fault and shows the failure of the law without `checkSyntax`.
- A literal word is the one exception. The function compares the text of the word with the literal, because `print` writes that text.
- The separator has a control. The function writes a document with the separator of the profile and with a neutral separator. A document that only the neutral separator keeps blames the separator. These documents use `ops: true`, thus the probe does not depend on the operations of the profile.
- A pattern that reads the start of a failing text takes the finding, with the code `pattern`, because `parse` tries patterns first.
- A small `maxDepth` is a limit of the host, thus each probe uses the default limit.
- A `TypeError` of `compileProfile` becomes one finding `invalid` with an empty place.

The codes are `invalid`, `operator`, `grouping`, `longest-match`, `word`, `root`, `pattern`, `form`, `call`, `separator` and `construct`.

The parser settles these candidates, and each one has no finding (SYNTAX.PROFILE-CHECK-SETTLED):

- `-` as prefix and infix, and `!` as prefix and postfix, because the place of the token settles them.
- `<` with `<=` and `<-`, because longest match reads them and the printer writes spaces around an infix operator.
- An infix word `in` with `let`, because `in` has its meaning only after the closing brace.
- A form name that a pattern matches, for example `LOG10(x)`, because a pattern does not read a name before `(`.
- An infix `:` in a record, and a bind `=` with `==`, because a key reads first and a longer symbol wins.
- Two spellings of one kind, a separator `, ` with a trailing space, and a prefix `;` with the separator `;;`.
- A word literal `let`, because `let` starts a form only before a brace.

**Alternatives.** A part of `check` has the wrong input. `check` takes a machine and a document, and a profile is a separate value that a site reads without code (D41). `checkWorld` is the model: a separate function with its own finding form. A static list of rules is a second copy of the grammar, and it drifts from the parser. An early separator rule was static, and a generated run showed gaps at the backtick, the quote and the closing brace. The control replaced that rule. A check in `compileProfile` adds a cost to the first `parse`, and it changes which profiles throw.

**Why.** The oracle is the law, thus the check and the grammar agree on each document that the check writes. The standard profiles give no finding, and that test guards against a false report (SYNTAX.PROFILE-CHECK-CLEAN). A generated test guards the other direction: a generated profile with no finding keeps the law over generated documents (SYNTAX.PROFILE-CHECK-LAW). A local run of 60000 profiles gave 11083 profiles with no finding. These profiles gave no miss in 60 documents for each one. `parse` and `print` do not change, and only a host calls the check, thus the Speed gate stays 0 slower by design.

**Limits.**

- An empty list tells that the small documents come back. It does not prove the law for each document.
- The function examines pairs of operators. Three postfix operators and one longer symbol, for example `!`, `!!` and `!!!`, can pass.
- A profile with `ops: true` permits each name, thus the function probes only one dotted name, and only when the profile has field steps. Without field steps, `print` writes no dotted call (D142).
- The probes use the names `probe__` and `m.p`, and the keys `x` and `y`. A word operator with one of these names gives a finding, and the host does not use that text.
- A separator counts as used when the profile has any call or construct, also when each form takes one argument.
- A `read` or a `write` function of a pattern is code of the host. An error of such a function leaves `checkSyntax` with no change.

## D141 (2026-11-04): a call form with the field `domain` is the text of a domain value

**Context.** K143, from C15. D40 gives a value that JSON cannot write the document `ext.domain`, with the name of its domain and its data. The syntax kit of D41 has no text for such a document, thus `print` refuses each date of a language.

**Decision.** `SyntaxForm` gets the optional field `domain`.

- A form with `args: "literal"` and `kind: "ext.domain"` needs the field. The form `{ name: "date", kind: "ext.domain", args: "literal", domain: "date" }` reads `date("2026-01-02")` (SYNTAX.FORM-DOMAIN).
- The value of the document is `{ domain: "date", data: "2026-01-02" }`, the form of D40.
- `print` tries each form of the kind, thus a profile has one form for each domain. A domain without a form has no text (SYNTAX.FORM-DOMAIN-NONE).
- Each other form with the field throws when the profile compiles (SYNTAX.FORM-DOMAIN-CHECK).
- The syntax does not read the data. The codec of the machine reads it at evaluation, and it gives each error (SYNTAX.FORM-DOMAIN-VALUE).

**Alternatives.**

- Codecs in the profile. `parse` then runs code of a host and gives values, not documents. A profile is data (D41), thus this breaks that rule.
- A new literal mark, for example `#date "2026-01-02"`. Each language then needs a new token, and the form of D63 already has the text.
- A table `literals.domains`. It holds the same four facts as a form, and it needs its own rules for names and clashes.

**Limits.**

- Only data that a literal writes has a text. Data that is a record or a list has no text at this time (SYNTAX.FORM-DOMAIN-NONE).
- `parse` accepts data that the codec refuses. `check` does not read the data either, thus the error comes at evaluation.
- A form of a domain and an operation with one name follow the rule of forms: the form wins.

**Why.** A form already has a name, one literal, its text and its place in `print`. One optional field adds the two facts that differ, and `parse` stays free of code of a host. `parse` of `print` holds for each literal data, and the codec keeps one definition of each domain.

## D142 (2026-11-04): `print` gives no dotted call without field steps

**Context.** K219, from the Limits of D140. With `ops: true` and `fields: false`, `print` wrote `m.p(1)`. `parse` reads a dot as a field step, thus it refused that text.

**Decision.** `print` gives an error for such a document (SYNTAX.CALL-DOTTED). A plain call name does not change.

**Alternatives.**

- A finding of `checkSyntax` on the profile. The profile is good: `ops: true` with no field steps has a clear meaning. The document has no text, and that is what `print` tells for each other document.
- A dotted call in `parse` without field steps. A name then needs a new token rule, for a form that no language asks for.

**Limits.** A name with dots in a list `ops` gets the finding `call` of `checkSyntax`, because that entry has no text.

**Why.** `parse` of `print` holds for each text that `print` writes. The change removes one text that no `parse` read, thus it is a fix.

## D143 (2026-11-04): a kept read that meets a node in evaluation below it closes no cycle

**Context.** K218, from the Limits of D136. A closure at `f` has a `self` that refers to `g`, and a document of `g` reads `f`. The kept read of `f` demands `g`, and `g` meets `f` in evaluation. Thus both nodes gave `#CYCLE!`. The evaluation of `f` did not ask for that read, and a run has no such cycle.

**Decision.**

- In a kept read, a demand of a node in evaluation below that read gives the same error as before. It adds no mark for the cycle check (SCHED.KEPT-BELOW).
- At the end of such a kept read, the schedule drops the nodes that finished in it. It removes their values of the epoch and their entries of the store. A real demand then evaluates them again.
- A read of an evaluation goes outside `keeping`, thus a true cycle gives `#CYCLE!`. A cycle between nodes that a kept read evaluates also stays, because these nodes are above the read.

**Alternatives.**

- A store that keeps no entry of the reader. D136 expected this need. A test of each part found no case for it. `verifyReads` asks `known` for a kept read, and `known` has no value for a node that is not finished. Thus the list fails, and the node evaluates again.
- A kept read that does not demand. D136 has the reason against it.

**Limits.**

- The nodes of such a kept read evaluate two times in an epoch.
- D145 removes the false cycle of a kept read that reaches a true cycle.
- The false cycle of a kept read at a root other than `world` stays, because only `world` gets `keeping` (D136).

**Why.** D31 gives each value of an epoch one meaning. The dropped values do not break that rule, because only the nodes of the kept read saw them, and the schedule drops these nodes too. A node goes from `#CYCLE!` to the value of the run, thus no working result changes.

## D144 (2026-11-04): the demands of a long chain get no change for memory

**Context.** K116, from K105. SCHED.LONG-CHAIN needed approximately 550 MB in its worker, and its schedule kept approximately 120 MB of it. Since K207, that test has 2000 nodes, thus that peak is gone. The study still measures the demands of a chain of 100000 nodes.

**Measure.** The script `bench/chain-memory.ts` measures a chain of 100000 nodes. The workflow `chain-memory.yml` started it on 3 runners of CI with Node.js 26.13.0, on three models of CPU (run 42409463169). The three runs give the same allocation, garbage and kept memory to 0.1 %. Only the peak of the heap differs between the runs.

| Step | Allocated | Garbage | Peak of the heap | Heap after a full collection |
| --- | ---: | ---: | ---: | ---: |
| `set` of each node | 43 MB | 23 MB | 36 to 43 MB | 20 MB |
| The first `read` | 895 MB | 779 MB | 209 to 224 MB | 135 MB |
| `changeData` and a `read` | 223 MB | 223 MB | 230 MB | 135 MB |

The schedule keeps 1418 bytes for each node. The steps make 10757 bytes of garbage for each node, 7.6 times the kept memory. The peak of the heap is 230 MB.

The sampling heap profiler counts 1143 to 1150 MB, with the objects that a collection frees. The largest sources are these, as a share of the samples in the three runs:

- 12.7 to 12.8 %: a function without a name in `durable.ts`.
- 10.6 to 10.8 %: `resolveFully` in `deref.ts`.
- 9.5 to 9.7 %: `resolve` in `deref.ts`.
- 9.4 to 9.6 %: `partsOf` in `parts.ts`.
- 9.0 to 9.2 %: `Map.prototype.delete`.

The loader of tsx gives no line numbers, thus the study names a function and its file only.

The first study of 2026-11-04 was one local run with Node.js 24.21.0 on Windows. It gave a peak of 283 MB and approximately 829 MB allocated. The CI runs use another version of V8 and a later kernel, thus this record does not compare the two sets of numbers.

**Decision.** No code changes. No source is more than 13 % of the samples. A schedule keeps approximately 1.4 KB for each node after a collection.

**Alternatives.**

- Arrays in place of the small maps of `visit`. `Map.prototype.delete` is 9 % of the samples, thus this change removes at most that share. The study does not show that the peak goes down with it. The code of Tarjan then gets a second form of each mark.
- A smaller plan of a reference. K105 did that work, and the live size stays near its result.

**Limits.**

- The study is not a gate. A later change of the kernel can change each number. `chain-memory.yml` starts the study again on a change of its script, or by a dispatch.
- The profiler gives the self size of each function, not its callers. Thus the study does not tell which function calls `Map.prototype.delete`.
- The numbers are of one version of Node.js. Another version of V8 gives other sizes.

**Why.** The claim of K116 was about the peak of a test, and that peak is gone. A change to `visit` adds risk to the code of the cycle check for each host. It needs a need that a host measures.

## D145 (2026-11-04): a kept read that reaches a true cycle joins no component

**Context.** K220, from the Limits of D143. The nodes `a` and `b` read each other. The fallback of `a` reads `c`, a closure with a `self` that refers to `x`. The node `x` reads `b`. The kept read of `c` demands `x`, and `b` is a finished node of an open component. Thus the marks of the cycle check reached `x` and `c`, and both gave a false `#CYCLE!`.

**Decision.**

- In a kept read, a read of a finished node of an open component adds no mark when that node started below the read (SCHED.KEPT-OPEN).
- Such a read counts as a meeting of D143. The schedule drops the nodes of the kept read, and a real demand evaluates them again.
- Thus a node with a real read from the cycle stays on the cycle in each order. A node without one stays outside it.
- The drop no longer tests for an open component. No node of a kept read can stay in an open component, because no mark goes below the read.

**Alternatives.**

- No mark and no drop. A test shows that the value of a node then depends on the order of demands, and that breaks D31.
- A mark only at the reader of the kept read. The node `x` then still gives a false `#CYCLE!`.

**Limits.** The nodes of such a kept read evaluate two times in an epoch. The restore of the start of an outer kept read has no test. Without it, a nested read gives the same values, with one more evaluation.

**Why.** A path of a real cycle has only reads that an evaluation asks for. A kept read is not such a read, thus no mark goes through it. The drop keeps D31, because no value of a kept read reaches a node outside it.

## D146 (2026-11-04): a handler is a frame in the context, and a clause is a capability that the kernel gives

**Context.** R2 P5 proposes a kind `handle` with clauses that run in place, and L1a takes it up. D27 left room for a rule `grant`. R2 names two risks: D10 lists five roots, and CAP.NARROW changes its wording.

**Decision.**

- The standard kind `handle` has the fields `with`, `body` and an optional `return`. Each item of `with` has `op` and one of `do` and `abort`.
- A frame is a field of a context under a private symbol, as the grant is. It is not a root, thus D10 stays true.
- A clause is a capability. The new rule `grant` of `Kind.caps` gives the body each kind of the clauses, and the kernel writes that grant (`RunPart.handled`).
- The kernel asks the capabilities first and the frames second. Thus `mask`, `only` and the narrowing of an evaluator stop a handled effect with no new code (HANDLE.NARROW).
- A frame ends with its body. An effect from a context that left the body gives `#CAP!`, and a frame of another evaluation counts as ended (HANDLE.ENDED).
- A handled effect is not an effect of the host. It is not in the list of effects, in a log or in a replay. The effects of a clause are, at the place of the clause.
- An abort sets the result in the frame, and the effect gives a failure that stops the body. `handle` then gives that result.

**Alternatives.**

- Frames before capabilities. A handled effect then needs no grant. But an effect in `pure` under `handle` gets a clause, and each narrowing needs a second filter for the frames.
- A frame in `caps`. That changes the type `Cap`, and R2 rejects it.
- A clause that keeps working after the capability check of its frame ends, as a deep handler in a language with closures does. The capability of that clause then reaches the host through a closure that left the body. The refusal is the safe side.
- An abort as an error value with a token. A runner that treats an error as data then changes the result of `handle`. A field of the frame does not.

**Why.** A frame that is also a capability needs one rule for the run and one for the check. `check` reads `grant` from the contract, thus it accepts a handled effect with no knowledge of `handle`. `effectsOf` keeps the list of handled kinds on each visit, and CAP.EFFECTS-SOUND stays true, because a handled effect does not reach the host.

The second tier has its own frames, as D15 asks. `agreeRun` compares the results and the addresses.

**Limits.**

- Clauses run in place. A clause cannot resume and then work on the rest of the body. R2 P5 calls that general resumption, and it changes `Steps`.
- A clause sees the payload but not the kind. A clause for a namespace cannot forward the exact effect.
- After an abort, a runner that treats an error as data can go on with its next step. Each effect of that step happens, and `handle` still gives the result of the abort. Under `all`, the other items go on unless the host sets `failFast`.
- `check` does not report a clause with both `do` and `abort`. A run gives `#VALUE!` (HANDLE.VALUE).
- `factsOf` still lists a handled effect, because its facts read each declaration. That list is an upper bound.
- A kind that declares `grant` and gives no clauses passes `check`, and its run gives `#CAP!`.
- A `handle` in a context of an earlier evaluation has no capability, thus its clauses answer nothing, and an effect gives `#CAP!`.
- `WORLD_SYNTAX` has no text for `handle`. Each clause is a record of data, and the profile has no text for a list of records. SYNTAX.WORLD pins this reason, and L1c gives the text.

## D172 (2026-11-07): each arm of Speed builds with the esbuild of its own lock file

**Context.** Speed bundles each arm with esbuild (K101). Before this decision, both arms built with the esbuild of the head. A pull request with a new version of esbuild then gave two arms of one bundler. Speed did not read what that version does to the kernel (K232, D166). The first read of K233 found that the patch releases of esbuild 0.28 give equal bytes for the kernel, and that 0.27.7 gives other bytes.

**Decision.**

- The bench job reads the version of esbuild that each lock file gives to `packages/core` (`bench/esbuild.ts`). Only a plain version of SemVer goes to a command.
- When the two versions differ, the job installs the version of the base in a temporary folder. `paths.ts` builds the base arm with it, and the head arm with the esbuild of the head.
- In that case, `paths.ts` also builds the base with the esbuild of the head, and prints the two hashes of the base. Equal hashes show that the new version gives the same code. Different hashes make the table a time read of the new version, with the old bundle as the base arm.
- When the versions are equal, `paths.ts` prints one line with the version, and builds as before.

**Alternatives.**

- A job that builds the kernel with the last 3 versions of esbuild. That job reads versions that no pull request changes, and it gives no paired time read of the change.
- A time read of each version of each dependency. Only the bundler changes the code that an arm runs. The other dependencies of the bench measure, and the A/A pair reads their noise.

**Limits.**

- The A/A pair has two processes of the old bundle. It gives no noise of the new bundle.
- An arm hash of the base that differs between the two versions holds a slower reading (D166). The hold is correct, because the arms then run different code.

**Why.** A gate holds each gain only when it reads each change that the arms run. A new version of esbuild changes the code of the arms, and Speed reads it as a change from this decision on.

## D173 (2026-11-07): a hold turns `Speed OK` red, unless a record of the pull request accepts each slower case

**Context.** K239, from K238. D166 made a hold a reading: `Speed OK` stayed green, and only a person who read the line `Hold (D117)` kept a merge back. L1a (#297) merged under a hold. Its verdict read `factsOf a tree with an equation` slower in both runs, by 16.4 % and 14.6 %, on different arms. The release of that version followed, and K238 found the cost after the release. A person who reads a line is not a gate.

**Decision.**

- A slower case under a hold gives the state `held`, and `Speed OK` is red.
- A record in the folder `packages/core/bench/accepted` accepts one slower case. A file is a list of records, and its name is the number of the pull request, for example `301.json`.
- A record has five fields of text: `case`, `head`, `cost`, `reason` and `owner`. The field `head` holds 12 to 64 characters of the hash of the head arm, as the line `Arms (K232)` prints it.
- A record accepts a case only when it has the name of the case, and the head arm of each run starts with its hash. When each slower case has such a record, the state is `accepted`. `Speed OK` is green, and its line names each record with its cost, its owner and its reason.
- A file that is not a list of correct records is a fault, and the state is `no read`. Thus a record with an empty field stops the run.
- A slower case on equal arms stays report only, as D166 says. Such a reading is noise of the method, and it needs no record.

**Why a hash of the head.** A record on `main` must not accept a later change. The next change of the kernel gives another hash of the head arm, thus the record accepts nothing more. The file stays on `main` as the trail of the cost, and a score can read it. A merge of `main` with a change of the kernel also changes the hash, thus the record names the code that the run measured.

**Alternatives.**

- A label on the pull request. A label leaves no trail in the tree, and a label of an earlier head stays on a later head.
- A record with the number of the pull request and no hash. A dispatch has no pull request, and a record stays valid after a change of the code.

**Limits.**

- The record reads the hash of the head arm only. A change of the base with the same head gives the same hash, and the record still accepts the case. The cost on the new base is then not read.
- The folder of the records is in the tree of the head. A pull request can thus accept its own cost. The owner, the cost and the reason are in the diff, and the review of the pull request reads them.
- The tests start the real script of the verdict with a folder of records from `BENCH_ACCEPTED`. They cover no hold, a hold with a record, and a hold with no record. A CI run of a real hold with a record is still to come.

**Why.** A gate holds each gain only when it is code. A record is the cheap path for a hold from noise on different arms, and it leaves a trail for a score.

## D174 (2026-11-07): a group of parts above 0.0359 of the test time fails a run of all tests

**Context.** K231, the second step of D165. The reporter printed each group of split parts, as a report only. A split lowers the share of each part and saves no time, thus a slow test passed the gate of D96 after a split.

**The measure.** The fraction of a group is its total time, divided by the time of all tests of the same run. Five CI runs of all tests on 2026-11-07 printed 29 groups each: 42396929367, 42397725803, 42397768621, 42399231485 and 42399576673. The share in timeouts of the top group went from 0.304 to 0.568. Its fraction went only from 0.0219 to 0.0289. Thus the fraction removes most of the speed of the runner, and the share in timeouts does not.

**Decision.**

- `GROUP_LIMIT` is 0.0359. It is the worst fraction of the five runs plus the largest spread of one group between the runs: 0.0289 + 0.0070. The run ids and the formula are beside the constant.
- In CI, a group above the limit fails the run with a line `::error::` that names the group. This line tells the two fixes: a smaller corpus, or a new limit from 5 CI runs.
- The limit applies only to a run of all tests. A run with a filter of files or of names has another total, thus it only prints its groups. Two CI jobs run such a filter: the nightly job of `agree.yml` and the step of `measure.yml`.
- The flip test runs the real reporter with a fake run of Vitest. Two parts of 400 ms in 10 000 ms of tests fail the run. The same times with a filter pass.

**The meaning of the limit.** No group of parts costs more of the run than the worst group of today, plus its spread. The limit holds the cost of each corpus at the level of today. A larger corpus on purpose is a fair reason for a larger share, as D165 says. Such a change measures a new limit from 5 CI runs in its pull request, and the diff shows the cost.

**Alternatives.**

- A limit in timeouts for each group, for example `FAIL` of D96. The top group already reads 0.568 on a slow runner, so it fails with no change of code.
- A limit for each group by its name. A rename of a test then needs a new limit, and a new group has no limit.

**Limits.**

- The five runs ran on one day, on the runners of that day. A runner with another CPU model can give another fraction. A false fail then gets a new measure, not a larger margin by hand.
- The test of a run of all tests compares the count of test files with the count that Vitest finds. A CI run of all tests shows the line `No group used more than` in its log. The first CI run of this change is the first such read.
- The limit does not find the test of K230 as it is today, because that group is the top group of the five runs. It finds each growth above that level.

**Why.** A gate holds each gain only when it is code. The fraction is a share of a time in its own run, thus a slow runner does not move it much.

## D175 (2026-11-07): the tree kit is complete, and each open question of R3 has an answer

**Context.** L2, from R3. L2a to L2i gave the nine proposals of R3 (D16, D42, D106, D107, D108, D113, D122, D124, D126). The seven open questions of R3 had no record of their answers, thus L2 stayed open.

**Decision.** L2 is done. This record gives the answer to each open question of R3.

1. **Structural steps.** A node reserves only the steps `parent` and `type` (D16). `index` and `prev` are names of an equation of `down`, not steps (D42). `next` follows the same rule. Thus a record keeps each other field name.
2. **Inherited reads.** The two forms stay, and they read two attributes. `["self", "width"]` reads the attribute of the node through the ladder of D42. `["self", "parent", "width"]` reads the attribute of the parent. A declaration `copy` makes the first form fall back to the second when no nearer rung answers (TREE.COPY).
3. **Rungs.** The kernel keeps its trace. `attributeTrace` of the tree kit gives the rungs (TREE.RUNGS, D42).
4. **Declarations.** Each declaration is in the contract `tree` of its kind, not in the spec of a kit (D42, D14).
5. **Circularity.** A declared circular attribute evaluates to a fixed point, and each other cycle gives `#CYCLE!` (D113).
6. **A store of named nodes.** The schedule of D31 keeps named nodes without the rungs of a tree. It uses the same analysis `graph.ts` as the graph of attribute instances (D107). Thus the two layers share one cycle finder.
7. **A tree space.** Coeval gives no space. A space is a host: its things and its walkers (DEREF.HOST, D10). The test `positions.test.ts` gives a space of rows in this form. A tree space with a zipper is the work of the language that uses it, on the same interface.

**Alternatives.** Keep L2 open until a language asks for a tree space. That gives no work to coeval, thus the item only blocks the view of the roadmap.

**Limits.** The answers 6 and 7 tell what coeval gives. A language that uses coeval can still find a gap. Then that gap gets its own item.

**Why.** Each item finishes with a record of its result. A reader of R3 finds the answer to each question in one place.

## D147 (2026-11-04): a narrowing changes the type of a name or a root in a branch

**Context.** R5 P6 asks for occurrence typing in `if`, `and` and `or`. It names two risks: a host thing can give two values for one path, and an effect can change the world between two reads.

**Decision.**

- A `Signature` gets `proves`, the type that a true result proves of the first argument, and `present`, the proof of a value at that argument.
- A `TypeRule` gets `reads`, `proves`, `first` and `usesProofs`. A `PartType` gets `narrow` and `keep`.
- The pass applies a proof to the types of the names and of the roots of a part. A binding of the same name, a change of a root and an evaluator without a rule thus end a narrowing with no new code.
- The rule of `if` types `test` first, for each order of the fields.
- A proof comes up the stack of the pass. Only a part of a rule with `usesProofs` gets a proof. Thus a deep test uses no recursion. A document without `if`, `and` or `or` pays for one array only.
- `then` of a value type gives the narrower of the two types. `else` removes only a precise type that fits the proved type.
- A document with a declared effect narrows only its names.

**Alternatives.**

- A list of narrowed paths beside the types. Each reader of a path then needs a second lookup, and each binder needs a rule that removes a path.
- An end of the narrowing at the step with the effect. A closure from a branch can run after a later effect of the document, thus a local rule is not sound. The rule for the whole document is one sentence.
- A meet of two types. The proved type alone is sound, because a value of the branch is a member of it. A meet needs a test for disjoint types, and no language asks for it yet.
- A rule that follows each overload. The check selects an overload after the arguments, thus the proof can depend on the types that it changes.

**Why.** A narrowing is a change of a type in a scope, and the pass already has scopes. The compiled plan and the second tier read no types, thus each evaluation stays the same (TYPE.ROOTS-SOUND).

**Limits.**

- A host thing that gives two values for one path breaks a narrowing of a root. TYPE.ROOTS-SOUND already asks for plain data.
- The check does not examine the promise of `proves`. An operation that gives `true` for a value outside the type gives a wrong narrowing.
- A path into a type `unknown` or a union of records does not narrow. Only a whole name or root of the type `unknown` takes the proved type.
- The operation `not` proves nothing, because a signature has no key for it.
- One test keeps 32 proofs or fewer. A proof only adds knowledge, thus the limit is safe.

## D148 (2026-11-04): `agreeTypes` is the agreement rule for types, as a helper that a language imports

**Context.** R5 P5 states three clauses for a document that checks. TYPE.SOUND and TYPE.ROOTS-SOUND test the first clause in the tests of the kernel, thus a language has no helper for its own signatures and rules.

**Decision.**

- `agreeTypes(machine, doc, context, options)` sits beside `agree`. It gives the first place that breaks a clause, or the number of values that it examined.
- The clause `value` is the first clause of R5.
- The clause `argument` is the second clause. It reads the need of each position, so that it holds for each kind with a rule.
- The clause `error` is the third clause. It holds only for parts with precise types and declared needs, and only at the place that made the error.
- A document with an issue gives `checked: false`. The rule tells nothing about it.
- A run gives `checked: false` when a value breaks a position of an imprecise type. A signature promises a result only for its parameters, and a name can carry the wrong result to each later place.

**Alternatives.**

- A new obligation of `conforms` with a local test of each rule. A probe needs samples for each domain, and a finding changes what a host sees. The helper changes no result.
- A `#N/A` in the third clause. An optional field can give it after a check with no issue, and the trace does not tell that case from a closed record.

**Why.** A type error at a position with the type `unknown` is the promise of K28, not a defect. The clauses thus examine precise types only, and a language gets no false finding from a part with no types.

**Limits.**

- The local test of R5 P5 stays open. The property tests of a language give the same evidence, with a generator that reaches each kind.
- The error clause knows only the evaluators of the formula kit.
- A `#VALUE!` of `call` is not in the table. The body of a closure can give the same code, and a value that is not a function already breaks the clause `value`.
- A `#N/A` of a closed record stays with TYPE.NO-STEP.

## D149 (2026-11-04): a guard is data from a check, and `prepare` reads it

**Context.** R5 P7 asks for a test at each boundary of `unknown`, and at each read from a typed root. A store with a wrong schema then gives an error at the read, not a wrong value far away. A plan without the option keeps its speed.

**Decision.**

- `boundariesOf(typing, domains)` gives a list of places with types. The list is plain data, thus a host can examine it, keep it and filter it.
- The option `guards` of `prepare`, `evaluate` and `run` takes that list. The default is no list.
- A rule with `read` tells that a value comes from outside the document. The formula kit sets it on `ref`.
- The test sits inside the code of the part, and inside the record of a trace. The trace thus shows the error at the boundary.
- A part with a test is not a total part, thus it gets a place and a catch.
- `agreeTypes` with `guards: true` evaluates with the boundaries of its own check.

**Alternatives.**

- An option `guards` that holds the root types, with a check inside `prepare`. `evaluate.ts` then imports the check, and each plan pays for a second walk. A host with a list pays once.
- A new evaluator around each boundary. The trace then gets one more document, and each place moves.

**Why.** A check already knows each position where its promise needs a test. A list of places keeps the check and the plan apart, and the compiled code changes only for a plan with a list.

**Limits.**

- A read of a name that `let` binds is a boundary too, because a rule does not see the scope of its root. The test is true there, and it takes time.
- A test of a deep record walks the whole value at each read.
- A list from a check with a different `declaredType` can name places that the plan does not have. Such an entry has no effect.
- The extensions and the operations stay trusted. Only a value from a read or from an imprecise part gets a test.

## D150 (2026-11-04): an evaluator that is a function can hold a type rule

**Context.** C14 shows the types of the cards on the site. The standard evaluators are functions and have no rules, thus each card of the site has the type `unknown`.

**Decision.**

- `ruleOf` reads the field `type` of a function too, as it reads the field of an object.
- The site gives rules to the standard kinds of its pictures, on a new function that calls the standard evaluator.
- The standard kit stays without rules at this time.

**Alternatives.**

- Rules on `STD_EVALUATORS`. A rule needs an object or a new function. Each standard evaluation then goes through other code, and the speed gates change for a site feature.
- A `typeRules` field on the machine. It is a second place for one fact, and each reader of a rule must know both.

**Why.** The rule follows the evaluator, as TYPE.RULE tells. One test in `ruleOf` keeps this true for each form of an evaluator.

**Limits.**

- A rule on a run side kind has no effect, thus the cards of `seq`, `log` and the run form of `if` show `unknown`.
- A later roadmap item can move the rules from the site to the standard kit.

## D151 (2026-11-04): the playground reads its editors from the contracts, and an empty position holds a site kind `hole`

**Context.** C11, from R6 P6. The panel of the playground named its kinds in code. It had an input for `number`, a menu of each world entry and a table of new documents. A new document needed a value, thus a reader could not leave a position empty.

**Decision.** The function `editorOf` gives the editor of a kind from `Kind.parts` alone. A data shape gives an input. A record shape gives one row for each field, with a mark for each necessary field. A position lists only the kinds of its `term` shape (SHAPE.KINDS). The function `emptyDoc` gives a new document from the contract, and each necessary position holds a hole. The evaluator of `hole` gives the error value `#HOLE`, and the kernel adds its place. The function `namesAt` reads the names of a reference editor from `walk`.

**Alternatives.** A kind `hole` in `STD_WORLD`. A hole is a state of an editor, and a host without an editor has no use for it. Thus the kernel does not change.

**Why.** Each fact of the editor was already in a contract, except the shapes of the data kinds. The standard world gives `number`, `text` and `bool` no `parts`, so `SITE_WORLD` adds them. It also adds the fields of `write` and the necessary fields of `if`. A check reads these shapes in the same way as other contracts. An error value keeps each state of an edit evaluable, as in Hazelnut.

**Limits.** A kind with no contract has no input, and "Edit the JSON" stays its editor. A reference keeps a small rule of its own, because its value is a path and no shape tells that. An edit does not check the type of a position against the kind that it lists. The field `of` declares the type of a bare value, and only `kinds` limits a term.

## D154 (2026-11-04): a walker and an extension declare the roots that they read

**Context.** K54, from S1a. A kind declares `reads`, and the hook `facts` answers with `reads` for an evaluator (FACTS.KIND-READS). The facts dropped this answer for the walker of a step document. An extension gets its context, and a profile had no place for the roots that it reads. Thus `factsOf` gave a document as pure with fewer reads than its evaluation. A closure and a schedule read these facts, so they missed a dependency.

**Decision.** The facts add a read of each declared root of a walker, at the place of the reference (FACTS.STEP-READS). The answer of the hook wins over `reads` of the kind, as for an evaluator. The new field `extReads` of a formula profile gives the roots of an extension (FACTS.EXT-READS). The hook of the kit gives them in its answer.

**Why.** One rule of `reads` covers an evaluator, a walker and an extension. A root is the unit of the existing declaration, and it stays an upper bound of what the code reads. A fold needs no new test: the context of a fold traps each root, so an extension that reads a root refuses the fold.

**Alternatives.** A declaration of full paths. It is tighter, but a walker chooses its keys from the data, thus a path is often not known. A second field for walkers. The hook already has the field `reads`.

**Limits.** A reference from `self` inside an equation stops before its steps, thus the facts do not see the walkers of such a reference, as before. A declaration is a claim of the host: the facts do not test it.

## D155 (2026-11-04): a reference adapter for signals lives in the tests

**Context.** S3b, R4 P6. The kernel keeps no reactive engine, and a host brings its own. R4 gives four rules for such a host, and no code examined them.

**Decision.** The file `signals.test.ts` holds a small push-pull signal library and an engine on it. Each node is a computed that evaluates its plan. The root `world` is a host thing that reads each other node through its computed. The function `sameResult` is the cutoff. No source file of the kernel changes.

**Why.** The engine passes `agreeSchedule`, thus a host has a working model of the adapter. The tests also fix the four rules. A plan keeps no value, so the library sees each read. A memo that lives longer than one evaluation is a signal. A fold reads nothing outside, and a host thing does not fix a name. With `adopt` each key is a signal read, and a thing with `resolve` answers a path with one read.

**Cycles.** The meaning of D31 gives each node of a cycle `#CYCLE!`, and a plain computed cannot find a cycle. The adapter keeps the algorithm of Tarjan over the demands. A node of a cycle is computed again at each mark, because a cycle has no order to verify. A mutation of this rule fails the harness, and so does a mutation of the cutoff.

**Alternatives.** A signal library from npm. The tests of the kernel then depend on a third party, and the marks stay hidden. A public export. No host asked for it, and an engine of a host has its own graph.

**Limits.** A change of data gives a new context signal, thus each node evaluates again and stops at its cutoff. A host that wants a change of one field holds that field in a host thing, as the tests show. The adapter is a first push-pull engine for S3d, not a schedule of the kernel.

## D152 (2026-11-04): `mapDocs` changes the documents of a document from the root to the parts

**Context.** K222. The static kit has `walk`, which only reads, and `mapRefs`, which changes only free references. A host that changes each step of a document kept its own recursion. That recursion named its step kinds and kept its own limit of depth.

**Decision.** The function `mapDocs(world, doc, change, options)` runs on `walk` (STATIC.MAPDOCS). The function `change` reads each visit from the root to the parts and gives one of four answers. The answer `undefined` keeps the document and goes into its parts. The answer `"skip"` keeps the document and stops. The answer `{ to }` replaces the document and stops. The answer `{ to, into: true }` replaces it and goes into the parts of the old document.

**Why.** A visit already has the kind, the parent, the slot and the declared type of a position. Thus the host decides which kinds are steps, and the kernel names none. The order and the stop come from `walk`, thus a deep document needs no second stack and no second limit. A document deeper than `maxDepth` gets its change, and the kernel gives `#DEPTH!` at its evaluation.

**Alternatives.** A map from the parts to the root. The function then reads a part that it changed, but it cannot stop at a node before it goes in. The request needs the stop.

**Limits.** The function reads only the original documents. A new document is not walked. With `into: true`, the new document must keep the path of each part. Each change copies the path from the root, thus `c` changes at depth `d` take `O(c d)` time.

## D153 (2026-11-04): `ifRunner` gives an `if` with the truth of a host

**Context.** K221. The runner `control.if` can wait for the host, but it accepts only a boolean test. The `if` of the formula kit reads the function `truthy` of a profile, but it is an evaluator, and an evaluator cannot wait. A host with its own truth and steps that wait kept a copy of the runner.

**Decision.** The function `ifRunner(truth)` gives the runner, and `control.if` is `ifRunner` of the boolean truth (RUN.IF-TRUTH). A host passes `profile.truthy` and names the runner in `machine.runners`. A document selects it with `own`.

**Why.** One body holds the three failures and the order of the parts, thus a host has no copy of them. The parameter has the type of `FormulaProfile.truthy`.

**Alternatives.** A runner for `formula.if` in each formula machine. A runner wins over an evaluator of the same name. Thus each formula `if` then pays for a generator, and the bench refuses a slower read. A formula `if` holds no effect, so it has no need to wait.

**Limits.** A bare value in a part stays a literal of the kit. A missing `then` stays an error of `check`. A host that reads older documents keeps these two rewrites, and `mapDocs` (D152) is the place for them.

## D176 (2026-11-07): the Speed verdict prints the family read of its cases, as a report

**Context.** K225. On equal arms, 4 of 352 case reads were slower (1.1 %), and this fits the level of 2.5 % for each case. But a run reads 16 cases with no correction, thus up to a third of the runs can read one false slower case. Also, one slower job beside a flat job can make a pooled case slower. The function `familyRead` of rigor-bench 0.2.26 (rigor #101) gives two reads. The Holm read corrects over the cases. The read of each job keeps a case only when each job reads it alone.

**Decision.**

- `merge.ts` takes rigor-bench 0.2.26 and rigor-statistics 0.1.16. The function `familyLines` gives the pooled verdict of each case again, with the option `pValues`. It gives the lines of `familyRead` at the level 0.025 for each side.
- The verdict prints these lines after the line of the gate. The first line counts the slower and faster cases with no correction, with Holm, with each job, and with both.
- The read is a report. It changes no verdict, no hold and no state of `Speed OK`.
- A case with different results, or without each run, has no pooled verdict, thus the read leaves it out.

**Why.** The p values come from the draws of the interval of the verdict, thus the outcome of each case stays the same. The records of 77 runs give the logged outcome in each of 1232 cases with this code. The counts of each read on real runs are the data for the ruling on the gate.

**Alternatives.** Turn the Holm read into the gate at once. The owner of the gate rules on a count of false blocks first, thus the read starts as a report, as D163 did for `notSlowerVerdict`.

**Limits.** The read covers the cases of one verdict. The rows of different runs are not independent, thus a rate over runs needs the count of branches too.

## D156 (2026-11-04): a part owns verbs, and it adds their entries to the kinds of other parts

**Context.** K35, R6 P4. A language adds a verb, for example `format`, to the kinds of another language. Before, it copied each kind and named it in `replaces`, or it used a function of `prev`. Two such languages then depended on their order. R6 asks for entries that the merge adds, with a rule against piracy. The owner of a verb had no declaration.

**Decision.** `WorldPart` gets two fields. `verbs` lists the verbs that the part owns. `extends` lists the entries, each with the path of a kind and its evaluators by verb. The path has the form of `replaces`, thus it reaches the fallback kind of the namespace `ops`. The merge holds the entries, and it adds them after each part. The conflicts are piracy, a verb of the kernel, two owners, two evaluators for one verb of a kind, and a path without a kind. Each conflict has a path, and the mark `replaces` of that path resolves it. For a path without a kind, the mark drops the entry.

**Why.** The entries join after each part, thus a language can come before the language of its kinds, and two languages commute. The result is the data of a kind, so the ladder, `check` and `checkWorld` read it with no change. The verbs `eval`, `deref` and `step` belong to the kernel. An equal part that owns the same verb is one owner, thus a merge of a part with itself stays idempotent.

**Alternatives.** A function in the style of `extendDomain`. It reads `prev`, thus it needs its kind first, and it cannot report a conflict. An external table of methods. The ladder then gets a new rung, and D2 keeps the ladder small. An object as in R6 with a path as its key. A key is one text, and a world has a path of keys.

**Limits.** A world keeps no owner and no entries, thus a part of a later merge does not see them. The merge of an extension with no base is a conflict, thus associativity (WORLD.LAWS) holds only when the first group holds the kind. Merge the parts flat, as K37 `compose` will do. An entry gives only an evaluator: a verb with effects does not declare them in `verbEffects` of a foreign kind (VERB.EFFECTS). An alias is not a kind, thus an entry names the kind itself.
## D157 (2026-11-04): a language is one value, and its identity is the canonical text of its data half

**Context.** K37, R6 P7. A language was a set of exports, and a host merged the parts by hand. R6 asks for `defineLanguage` and `compose`, with an identity from a hash of the data half. Its question 7 asks for the home of the format.

**Decision.** The module `language.ts` of the kernel holds the format. `defineLanguage` takes a name, a version, `world`, `requires` and `code`, and it gives one frozen value with a frozen copy of the data half. The text `data` is the canonical JSON of `requires` and `world`. `compose` checks the languages, and it calls `mergeMachines`. A language that another language needs comes first, at a version in the caret range of SemVer. Its conflicts are entries of one `MergeError`, with the path `["languages", name]`.

**Why.** The module needs only the merge, it has no dependency, and an unused export goes from a bundle. The canonical text gives each property of a hash with no collision, and it needs no hash function. The kernel has no such function, and a synchronous SHA-256 does not exist in each host. A host that wants a short pin hashes the text. This order keeps the meaning of `replaces` and of a function part, because both read the merge before them.

**Alternatives.** A hash of 32 or 64 bits. A pin then has collisions, and the function needs a home. A separate package. The owner then makes a new package, and the kernel format cannot use it. A topological sort in `compose`. It hides the order that `replaces` reads, and the home of a sort is outside the kernel. The fields `owns` and `profile` of R6. The world already gives the kinds and `verbs` gives the verbs. A profile gives a machine, and its fields are in the code half.

**Limits.** The data half is JSON, thus a domain and a hook go in the code half and they are not in the identity. A version has only three numbers, with no pre-release. Two languages with one data half and two objects of code merge by the rules of a merge. The text grows with the world.

## D177 (2026-11-07): a field of data gives `handle` a text in `WORLD_SYNTAX`

**Context.** L1c. The kind `handle` (D146) keeps its clauses in `with`, a list of records of data. Each record has the data `op` and the document `do` or `abort`. A profile had text only for documents, thus SYNTAX.WORLD pinned a reason for `handle`.

**Decision.**

- The new field `data` of `SyntaxForm` names the fields that take data with documents in it (SYNTAX.DATA-FIELD).
- In such a field, brackets read a list and braces read a record. A literal stays its data, and each other text is a document.
- A record of data has no key `type`, because that key makes a document. `print` writes a record that is an envelope as a document.
- `WORLD_SYNTAX` has the form `handle` with the arguments `named`, the field of data `with`, and `wrap` on `return` and `body`.
- The text `handle(with: [{op: "log", do: payload}], body: log("a"))` reads to the document of D146, and `print` writes the same text.
- A form with data needs fields. A name of `data` is a field, and it is not in `wrap`. No operator of such a profile starts with a bracket or a brace.
- The new generator `handlers` of SYNTAX.ISSUES-GENERATED writes lists and records in `with`. SYNTAX.ROUNDTRIP and the damage check read its texts.
- The damage check ignores the quote marks in an escape. A fault between a backslash and its quote mark is thus a quote cascade (D138, Limits).

**Alternatives.**

- A form for each clause, for example `do(log, payload)`. A clause is not a document, thus such a form needs a kind that the world does not have.
- Brackets and braces in each place of each profile. That takes symbols from each profile and changes the meaning of each text with braces under `constructs.record`.
- A literal in a field of data with its envelope. Then `op: "log"` becomes a document, and `handle` refuses it.

**Why.** The rule is general: each kind with a list or a record of data gets a text from one field of its form. The parser, the printer and recovery read the same rule, thus SYNTAX.ROUNDTRIP holds for each such kind.

**Limits.**

- A literal in a clause body needs its form, for example `do: number(7)`. A bare literal in `do` is data, and the kernel refuses it with `#PART?`.
- Brackets and braces are fixed. A profile cannot pick other symbols for a field of data.

## D178 (2026-11-08): each new document of the structured editor has a text

**Context.** C17b. The structured editor (C11, D151) and the text pane (C17, D61) show one document. A test of each kind of the menu found seven new documents with no text in `SITE_SYNTAX`. Thus a reader saw an empty text pane after such an edit.

**Decision.**

- A field with a list or a map shape gets an empty list or map, and not a hole. Thus `handle` starts as `handle(with: [], body: hole())`.
- The function `emptyDoc` takes a profile. A list gets one hole for each argument that the call form needs, thus `log` starts as `log(hole())`.
- A new path starts at the root `self`, because the root `names` alone has no text.
- The menu of a position leaves out a step of a path: a kind with the verb `step` and no verb `eval`, for example `nearest`.
- A test prints each new document of the menu and reads it back. The site probe reads the text pane after an edit of the tree.

**Alternatives.**

- A least count on the list shape of a contract. The kernel has none, and the call form already holds the count.
- A text for a bare `names`. The text `names` reads as the name `names`, so such a text needs new syntax.

**Why.** The editor and the text pane agree on each new document, thus each state of an edit has a text (SYNTAX.ROUNDTRIP).

**Limits.** A field with a record shape still starts as a hole. A step of a path stays inside the path of a reference, and the path input edits it.

## D179 (2026-11-08): a dispatch of Speed reads one gate unit for each pair of jobs

**Context.** K225. The owner of the gate gives four bars before `continue-on-error` goes. The first bar is a false-block rate over at least 73 A/A units. Its Wilson 95 % upper end must be at most 5 %.

The verdict job merges only the runs 1 and 2. Thus the jobs 3 and 4 of the control run 42438379740 gave records and no read.

**Decision.**

- The unit of the A/A series is one gate read of two jobs, as a pull request gets it.
- A dispatch with the jobs 1 to 2k gives k units. The step "The further pairs of jobs" reads each pair after the jobs 1 and 2 with `merge.ts`.
- The step writes no output of the job and no summary. Thus `Speed OK` reads only the jobs 1 and 2.
- The line "Run N" of each job names its CPU model. Thus each unit records its pair of CPU models, and the series gives a rate for each pair too.

**Why.** Each job has its own runner, its own install and its own build. Thus two pairs of one dispatch share only the commit and the time of the dispatch. The script `merge.ts` of the control commit reads the jobs 1 and 2 again with the same lines as CI.

**Alternatives.** Each case as the unit. The 16 cases of a job share one runner, and the shift of a job (RMS 0.0094) moves all of them. Also the merge rule blocks on any case. Thus a rate for each case is a different claim.

**Limits.** The jobs 3 and 4 of the control used two CPU models, and the gate read only 9 of its 16 cases. The rounds that give a read on each pair of CPU models are not known yet.

## D180 (2026-11-08): the flip test of Speed seeds a real slowdown in the head arm

**Context.** K225. The second bar of the owner of the gate is power. The gate must find a real slowdown of a stated size in at least 90 % of the seeded runs. The bench had no way to make the head arm slower by a known factor.

**Decision.**

- The dispatch input `slow` gives a multiple `k` of the margin of each family. `paths.ts` reads it as `BENCH_SLOW`.
- The function `slowFactors` gives `exp(k * margin)` for each case. The margin is on a log scale, thus `k = 1` gives exactly the printed margin.
- The script builds the head arm again with the esbuild define `BENCH_SLOW`. The base arm and each pull request get no define.
- A sample with a factor above 1 waits in its timed part. Its time then is that factor times the time of its calls.
- The concurrency group of Speed includes `slow`. Thus a flip dispatch and an A/A dispatch on one base do not cancel each other.

**Why.** The wait is in the timed part, thus the timer reads the slowdown as real time. The noise of the calls stays, and the factor scales it. Only the head arm changes, thus the arms differ and a slower reading holds the merge.

**Alternatives.** A slower copy of the kernel. Its slowdown is not known before a measurement, thus it gives no stated size.

**Limits.** The wait does not change the code of the calls. Thus the flip reads the power of the gate for a slower time, not for a change of the compiled code. The flip uses the multiples 1, 1.5 and 2.

## D181 (2026-11-08): Speed OK shows the line of the report-only gate on each pull request

**Context.** K225. The gate of the claim "not slower" (D163) is report only. Its line was only in the log of the job `verdict`. A CPU pair of two models read 9 of 16 cases, and `Speed OK` stayed green with no word of the 7 unread cases. A green check with a hidden "no read" is a silent pass.

**Decision.**

- The function `gateNote` of `merge.ts` gives one line. It has the outcome, the counts of all cases, the CPU pair and the names of the slower and unread cases.
- The job `verdict` writes the line to the output `gate`, and the outcome to the output `gate_outcome`.
- The script `speed-read.ts` prints the line in the log and the summary of `Speed OK`.
- An outcome other than "pass", or a missing line, gives a warning annotation on the pull request.
- `Speed OK` stays green on a gate "no read" while the gate is report only. The state of the check does not change.

**Why.** A check does not show a "no read" as a pass at any time. The warning tells the reader of the pull request which cases have no read, and on which CPU pair.

**Alternatives.** A red check on a gate "no read". The gate is report only until the four bars of K225 pass. Thus a red check at this time blocks merges on a gate that is not ready.

**Limits.** The further pairs of a dispatch (D179) stay in the log of the job `verdict`. They are for the A/A series, not for a pull request.

## D182 (2026-11-08): a block of the report-only ladder gate gives a warning on the pull request

**Context.** K225 and D181. The ladder gate of `Measure` (D164) is report only. A block exits with the code 3, and the step keeps the job green. The line of the block was only in the log and the summary of the job. A green check with a hidden block is a silent pass.

**Decision.**

- With `LADDER_ANNOTATE=1`, the mode `merge` of `ladder.ts` prints a warning annotation with the gate line on a block.
- Only the step "Pool the five runs" sets `LADDER_ANNOTATE`. The flip rows block on purpose, thus they give no annotation.
- The flip step checks the warning text of each block row, and no warning on the pass row.
- The flip step reads the warnings inside a `stop-commands` window. Thus the runner makes no annotation from them.

**Why.** The warning tells the reader of the pull request that the ladder gate found a slope over its bound. The check stays green while the gate is report only.

**Limits.** The line "Under that size: no read" gives the smallest slope that the gate can find. It is a size, not a case with no read, thus it gives no warning.

## D183 (2026-11-08): on a mixed CPU pair, the hold of Speed takes a verdict only when the two jobs agree

**Context.** K225. The first head of #312 got a hold on one case on a mixed CPU pair, an AMD EPYC 7763 and an Intel Xeon Platinum 8370C. Each job alone said "cannot decide", at +0.5 % and +0.8 %. The pool of the 24 rounds said "slower". The change of the head has no path into the timed code, and the later heads read "same" on one CPU model. Thus the hold was false.

**Decision.**

- The script `merge.ts` reads the CPU models of the two runs. When they differ, each case gets the verdict of each job alone.
- A case is "same", "slower" or "faster" only when the two jobs give that verdict. Else the case has "no read".
- The reason of `Speed OK` names the CPU pair and the cases with no read. A case with no read gives a warning on the pull request.
- A case with no read is not slower, thus it does not hold a merge. The check stays green.
- A pair of one CPU model keeps the pooled verdict of the rounds of both runs.

**Why.** Each job runs both arms on one runner, thus the ratio of a job compares code, not computers. But the ratio of a change can differ between two CPU models. The pool then puts two populations in one bootstrap, and its interval does not hold the difference between the two models. The verdict of each job keeps the information of each model.

**Alternatives.** A stratified bootstrap draws the rounds inside each job and then joins the estimates of the jobs, with a test that they agree. It is the general form, and it goes to the shared bench core. A second alternative gives no read for each case on each mixed pair. It removes the verdicts that both jobs agree on.

**Limits.** A slowdown that only one CPU model reads gives no read, not a hold. The warning shows it on the pull request.

## D184 (2026-11-08): the conformance page shows a hidden duty, not a pass

**Context.** K123. The page `learn/conformance` lets the reader turn on seven breaks of one evaluator. Each break breaks one duty. In a mix of breaks, `conforms` does not give a finding of each broken duty. A finding of `local` stops the checks C4 and C5. An effect without its capability gives an error, and C3 applies only to a value.

**Decision.**

- Each duty of the page has one of four states: found, kept, permitted by the contract, or hidden by another break.
- The function `dutiesOf` gives the state from the findings of `conforms`, the breaks and the contract. A hidden or permitted state has its reason.
- A fifth state, missed, is a broken duty without a finding and without a known reason. A test runs `conforms` on each of the 128 sets of breaks under each of the four contracts, and it finds no missed duty.
- A test also shows each hidden finding again without the break that hides it.

**Why.** A ring without a finding on a broken duty reads as a pass. The page shows the cause instead, thus the reader sees why one fix can show a new finding.

**Alternatives.** Run each break alone. Then the page cannot show how the contract and the other breaks change the findings.

**Limits.** The rules of `dutiesOf` copy two rules of `conform.ts`. The test of all sets finds a change of those rules as a missed duty.

## D185 (2026-11-08): the site shows the `#VALUE!` issues of the check beside the `#TYPE!` issues


**Context.** K243. In the playground, the text `1 + "a"` gave no issue, but a card of the kind `text` at the same place gave a `#TYPE!` issue.

**Cause.** The core was correct. A part of `add` has the shape `{ shape: "list", of: "lit" }`, and the site machine declares the kind `number` at that place. A bare value at a place of a declared kind is a value of that kind. Thus the check examines `"a"` as a value of `number`, and gives `#VALUE!`. A card of the kind `text` is a document with its own type. Thus the check gives `#TYPE!` for it. The function `placeTypes` of the site kept only `#TYPE!`, thus the playground did not show the issue of the bare value.

**Decision.**

- `placeTypes` keeps the `#TYPE!` and the `#VALUE!` issues of the check, each with its code.
- The mark of a card and each line of the list of the check show the code of the issue.
- The core does not change.

**Why.** The check found the problem before a run. A page that hides it tells the reader that the document has no problem.

**Alternatives.** A `#TYPE!` issue for the bare value. The bare value is not a document with a type. It is a value of the declared kind, and a wrong value of a kind is `#VALUE!` in each other place of the core.

## D186 (2026-11-08): the syntax page reads one text with three profiles

**Context.** C16. The syntax kit (C15, D41) reads a profile as data. The site had no page that shows a profile as data.

**Decision.**

- The page `learn/syntax` reads one text with three profiles. They are `STD_SYNTAX`, a profile like the formulas of a spreadsheet, and the profile of the world of the site.
- The spreadsheet profile is in the site, in `syntax-kit.ts`. It is like the profile `SHEET` of the tests of the core, with cells under the root `cells`.
- Each example reads differently under at least two profiles. A test pins the tree of each example under each profile.
- The page prints each document again and reads the printed text. A test examines the round trip of each document of the examples.
- A bad text shows each issue at its span with its number. An issue with no length shows a bar at its place.
- The table of the operators marks each operator that the text uses.

**Why.** A reader sees that the profile, not the parser, decides the tree. The text `-x ^ 2` gives `-(x ^ 2)` in one profile and `(-x) ^ 2` in another.

**Alternatives.** A form to edit a profile. A profile has functions for its references, thus a form cannot show each field. The three profiles show the fields that change the tree.

## D187 (2026-11-08): K115 is dropped

**Context.** K115 (D132). Each part of a plan keeps `runOf` of its code, approximately 96 bytes. The change made the steps of a part at its first run. D132 left the decision to the Speed verdict of CI.

**Decision.** K115 is dropped, and #258 is closed without a merge. The branch `k115` stays as the record.

- Two heads read two reference cases slower by 3.4 to 4.6 %, and `prepare` slower by 1.5 to 2.5 % (Speed runs 42485335912 and 42489026596).
- A placebo in `compileNode` (#344) changed code that does not run. In 4 jobs of 2 runs, no reference case moved by more than 1.5 %.

**Why.** `prepare` runs the changed lines, and its cost is in each run. A gain of 112 bytes for each part does not pay for a cost in `prepare` and in two cases of evaluation.

**Alternatives.** A record in `bench/accepted` (K239). The cost has one sign on two heads, and the placebo did not give it. Thus the cost is not a move of the code of `compileNode` alone, and a record accepts a cost that the change gives.

## D188 (2026-11-08): the bench imports only the parts of the kernel that its cases use

**Context.** K246. The cases imported the namespace of the kernel and gave it to each case. Thus the bundle of each arm kept each export, also code that no timed call runs. K37 (#343) adds only `defineLanguage` and `compose`, and no case calls them. Three Speed runs of #343 read 5, 5 and 2 cases slower, by 0.6 to 11.7 %, with a different set in each run. The case "a reference of five steps" was slower in each of its 6 jobs.

**Decision.**

- `bench/cases.ts` imports the 7 parts that the cases use by name, and gives each case an object of those parts.
- esbuild removes each export that the cases do not reach, as the bundler of a host does. The core sets `sideEffects` to false.
- A case that reaches changed code still measures it, because the bundle keeps each part that a case reaches.
- A change outside each timed path gives the same bundle on the two arms. With main and the head of #343, the two bundles have the hash `08a86c17bca3`. The hold of D117 starts only when the arms differ.

**Why.** The timed code of the two arms of #343 is the same. A host does not see a difference of the bundle outside the timed code. The bundle of a host keeps only what the host imports. The cause of the slower reads of #343 is unread. With equal bundles, the code of such a change cannot give a hold.

**Alternatives.** A record in `bench/accepted` for each slower case. Each run of #343 gave a different set, thus each push needed new records, and a record tells nothing about the cause. A placebo of the same size outside the timed paths. It costs a run, and it does not stop the next hold of this kind.

## D189 (2026-11-08): a row of the ladder flip replaces a run that does not count

**Context.** K247. The job `ladder-flip` measures one run for each row (D164). A run counts only when the A/A band of each walk contains 1. A row whose run does not count has no read. The gate then gives a block with the text "No run counts", and the check of the reasons failed the job. This occurred in run 42489026541, with the band 0.942 to 0.997 of `refsOf` on an EPYC 9V74, and in run 42482539243.

**Decision.**

- A row whose runs do not count measures a new run, up to 3 runs. The row pools all of its runs, as the gate pools its five runs.
- The line of each replaced run tells the row and the number of the run.
- After 3 runs with no counted run, the row has no read. The job fails with the line "no read. No run of 3 counts.", and the row gets no check of its reasons.

**Why.** The table of the gate says "no: replace it" for a run that does not count. The flip did not do that. A no read is not a pass, thus the job still fails when no run counts.

**Alternatives.** A pass for a row with no read. A no read then shows as a pass. A wider A/A band for the flip. The flip then examines a gate that is not the gate of the job `ladder`.

## D159 (2026-11-04): the formula kit has a Lean model, and CI compares it with the plan

**Context.** K96, R7 P7. Three readings of the semantics are in TypeScript. A model in a language of proofs is a reading that shares no host with them. The main risk of such a model is drift from the code.

**Decision.** The folder `proofs/` holds a Lean 4 package. The file `Coeval/Formula.lean` defines the formula kit over JSON as a total function with a clock. The executable `coeval-model` reads one document on each line and prints one result. The test AGREE.LEAN gives the same generated documents to the model and to the plan. It compares the value, or the code of the error. The workflow `lean.yml` runs each night, by hand, and on a pull request that changes the model. It downloads one release of Lean with a pinned hash.

**Why.** A comparison in CI controls the drift, as JSRef does for JSCert. The clock makes `eval` total, thus later proofs need no assumption about termination. A nested list keeps the keys of a record in order. This is necessary because `Lean.Json` sorts its keys, and the order of the fields selects the first error. The comparison uses the code of an error and not its reason. A reason is text for a reader, not a part of the semantics.

**Alternatives.** A tier of `agree`. A tier runs in the process of the test, and the model is another process. One process for each batch keeps the run fast. Elan to install Lean. The workflow then runs a script from the network, and a pinned hash is simpler. Theorems in this slice. Determinism and the monotonicity of the clock need the model first, and K223 holds them.

**Limits.** This slice proves one small theorem only: a clock of zero stops an evaluation. The model has no `ext`, no field `own` and no `maxDepth` for documents. A generated document stays far under that limit. The test skips a document with `ext` or `own`. A number that is not a safe integer becomes 7 before the comparison, because `V` holds integers. The model has one operation, `add`. A walk into a held error gives another result, because the model does not hold the fields of that error. The clock counts the nesting of an evaluation, not its steps.

## D158 (2026-11-04): the stepper is a third tier, and its stack is data

**Context.** K95, R7 P6. The plan and the reference share the code of the lookup, the split and the steps of a path (D15). Thus `agree` cannot find a bug in that code. A document that nests deeply overflows the stack of the host in both tiers. An evaluation cannot stop and go on from data.

**Decision.** The module `stepper.ts` is a CPS transformation and a defunctionalization of the reference, for the kernel and the formula kit. The stack is a flat list of frames, and each frame is data. `stepperStart` gives the first configuration, `stepperNext` does one pure step, and `stepper` runs to the end. The module reads the lookup, the ladder, the split and the path itself. The tier `stepper` of `agree` compares it with the plan. It is not a default tier, because it needs the profile of the formula kit. A closure is a record with the key `coeval.closure`, and a held error is a record with the key `coeval.held`. Host code gets a function and a `Held`.

**Why.** A third reading has no shared code to hide a bug. A flat list does not break `JSON.stringify` at depth. The place is not in each frame, because a copy at each level costs O(n²) at depth 100000. The stepper joins the steps of the stack only for an error, a host evaluator and a function. Data closures keep a configuration as JSON. The answer to question 7 of R7 is no. The stepper does not replace K46 for runs, because a run needs promises and a stepper has no runner.

**Alternatives.** Generators over the reference. These keep the stack in the host, and a generator is not data. A cons list as the stack. `JSON.stringify` then overflows at depth. Host closures in a configuration. These are not JSON, thus a host cannot store a configuration. The tier in the defaults. Each caller of `agree` then needs a profile.

**Limits.** A host evaluator is opaque: one step starts it, and each of its handles starts a nested stepper on the stack of the host. A runner gives `#NOEVAL`, and the stepper records no reads. An effect of `stepperNext` goes in a list that lives for that one step, thus a configuration of a document with effects is not data. A compiled evaluator outside the formula kit needs its definition, with `tree.node` too. A value that JSON does not hold, for example `undefined`, changes in a round trip. A record with the key `coeval.closure` or `coeval.held` reads as a closure or a held error. A deep value still overflows a host walk over it, for example `expect` or `JSON.stringify`.


## D191 (2026-11-08): the random numbers of the core come from `rigor-generators`

**Context.** K248. The function `random` of the core had its own copy of `mulberry32`. The home of seeded random numbers is `@mark1russell7/rigor-generators`, and its `mulberry32` gives the same numbers. The core had no runtime dependency, and the spec row GEN.SEED said "Its random numbers need no package".

**Decision.**

- `random` takes `next` from `mulberry32` of `@mark1russell7/rigor-generators`. The core gets its first runtime dependency, `^0.1.8`.
- The draws `int`, `chance` and `pick` keep the rules of the core. Thus `pick([])` gives `undefined`, and the `pick` of the home throws.
- GEN.SEED pins the draws of five seeds from the old copy, and the new code gives the same draws.
- The test PKG.PURE marks only the modules of the core as modules with side effects. A module of a dependency keeps the field `sideEffects` of its own package.

**Why.** Each area has one home, and a copy is debt. The home has no runtime dependency, and its field `sideEffects` is `false`. Thus an import that uses nothing still leaves nothing in a bundle. PKG.PURE marked each module before, so the data modules of the home stayed in its bundle. Each bundler reads the field of the dependency, thus the new mark tests the claim of the core only. A seeded fault in a module of the core still fails the test.

**Alternatives.** Keep the copy as an accepted copy. The two copies then can differ after a fix in the home. Use the `random` of the home. Its `int` takes a minimum and a maximum, and its `pick([])` throws, thus the draws and the API of the core change. A subpath export in the home for its random module. The home then has two entries for one module, and the core still reads the field of the home.
