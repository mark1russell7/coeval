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

The CI job of this change measured the medians on Node 26, with the base and the head as bundles. An evaluation of the formula of FORMULA.SPEED went from 118 ns to 98 ns. A reference of five steps went from 163 ns to 120 ns. A reference through an envelope went from 387 ns to 253 ns, and a reference with a step document from 387 ns to 134 ns. A compilation of PLAN.COMPILE-SPEED stays at 2.9 µs.

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

**Limits.** Two domains with codecs that both hold a value give the document of the first name. A language keeps one codec for each value. The check of the codec laws is a property test of the language, not of the kernel.

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

**Measured (K151).** The bench case of a record of 20 literals without folds is 9% to 13% faster. The same record with folds is approximately 6% slower (15.7 to 16.9 ns, A/A noise below 1%). Four comparisons in the bench of CI found the cause in the mark of the literal code in `formula.ts`.

The folded code of each evaluation is the same `() => value`, thus the cost comes from the feedback of the JIT in the process. A plan with folds pays approximately 1.5 ns for each evaluation. A plan that evaluates a literal saves approximately 6 ns for each literal. The kernel keeps the mark.

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
- A pattern of references can read the first key of a form name, for example `A1.x`. K146 holds that check.
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
- The runners of CI are not all the same machine. The same case took 107 ns on one runner and 206 ns on another, and the change of a case can have another sign on each.
- PLAN.COMPILE-SPEED is faster than 22d94f4 in both runs, -4.6% and -7.2%. D69 shows that this case also changes with the runner.

## D71 (2026-10-29): the bench of a pull request repeats each comparison on two runners

**Context.** K167, from K164 (D70). The same case took 107 ns on one runner and 206 ns on another. Single benches went over the bound in both directions without a repeat (K151, K164, K166). The design questions are how a bench repeats, and when a case is slower.

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
