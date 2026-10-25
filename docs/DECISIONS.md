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
