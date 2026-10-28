# Roadmap

This file is the one list of the work of coeval. Each item has an ID and a status. The tracker page mirrors this file.

The statuses are: `done`, `in progress`, `next`, `waiting` (on a decision of the owner), and `later`.

The studies in `docs/research/` rank proposals for the kernel and the kits. Each proposal that the plan takes up is a row here. The row gives its study and its number, for example (R3 P5).

## The order of the next work

The plan does the next work in this order (2026-10-24). It takes up the studies R1 to R7.

1. K8: `check` narrows the capabilities of the parts as the kinds do (done, 2026-10-24).
2. K9: a harness for one meaning (R1 P1) (done, 2026-10-24). At its start, it found four bugs of the kernel, and version 0.4.2 corrects them.
3. K20 and K21 together, two correctness fixes, and the helper `partsOf`, a request of a language (done, 2026-10-24, version 0.4.3):
   - K20: `check` knows the names of operations and extensions through the hook `known` of the machine, and `fn` declares the shape of `params` (R5 P1). Before, an unknown `ops.*` or `ext.*` passed `check` and failed with `#NAME?` in a run.
   - K21: `docEquals` compares the values that are not plain JSON by identity (R4). Before, it compared only the own keys, thus two different dates or maps were equal.
4. L2a: the decorated tree (R3 P1) (done, 2026-10-24, version 0.5.0). Each field of a node of `panel` or `box` evaluates on demand, with one memo for each node and attribute. A sibling is a path through the parent, a cycle gives `#CYCLE!` with its chain, and a failed field keeps its error. The nightly agreement run is green again.
5. K32: one merge function for worlds and machines, with conflict rules (R6 P2) (done, 2026-10-24, version 0.6.0, D17). `mergeWorlds` and `mergeMachines` merge equal entries, and namespaces key by key. Each other clash throws one `MergeError` with each conflict, unless the later part names its path in `replaces`. `formulaMachine` uses the merge, thus the `ops` of a language extend the namespace of the kit.
6. K34: the composition checklist as spec tests (R6 P1) (done, 2026-10-24, version 0.6.1, D18, [`COMPOSITION.md`](COMPOSITION.md)). Five modes work. The new helpers `restrictWorld` and `restrictMachine` give the restriction. Two targets wait as skipped tests: an evaluator that is a document (K40), and the merge of two machines from `formulaMachine` (K41).
7. K42: the mark of a pure call on each call at the top of a module, a request of a language (done, 2026-10-24, version 0.6.2, PKG.PURE). Before, esbuild kept the standard evaluators and walkers in each bundle.
8. K22: `sameResult`, a safe equality for an early cutoff (R4 P1) (done, 2026-10-24, released in 0.6.3, D20, RESULT.SAME). Plain JSON compares by structure, and each other object only as itself. Two errors need the same code, reason and place. `docEquals`, `sameValue` and `sameResult` share one walk.
9. K39: a host thing can tell that a field holds `undefined`, a small correction that K20 found (done, 2026-10-24, released in 0.6.3, D21, DEREF.HOST-UNDEFINED). Its optional `has` answers when `deref` gives `undefined`. Before, a host that adopted the names hid each name bound to `undefined`. A node of the standard tree hid such an attribute too.
10. K10 and K11: a synchronous mock `perform` for `evaluate` (R2 P1), and effect outcomes with record and replay (R2 P2) (done, 2026-10-24, released in 0.6.3, D19). An evaluation, a plan, the reference and `agree` take a mock `perform`. Each effect keeps a stable address and its outcome. `recorder` and `replayer` give record and replay, and a request that the log does not have gives `#REPLAY!`.
11. K23: value types and value domains, the base of the type work (R5 P2): done (2026-10-24, D22), released in the next batch. A value type is a JSON term, and `fits` decides each check. A language adds its base types as domains of its machine, and the domains merge name by name. The type work K24 to K31 builds on it.
12. K33: each verb through the kernel (R6 P3) (done, 2026-10-24, D23, released in the next batch). `prepare`, `check`, the reference and `agree` take a verb, and one ladder serves each verb, also `deref` and `step`. A verb `format` in the spec tests is the demonstration.
13. K12: compiled paths (R1 P2) (done, 2026-10-24, D29, released in the next batch). A reference of the formula kit compiles its static path in `prepare`: the root, the open roots and the walker of each step document. Each evaluation only walks the values of the context. `derefStep` and `walkerOf` keep a memo of `lookupKind` for each world. The results, the errors, the places and the reads stay the same. A CI job prints the speed of the base and of the head.
14. S1a: `factsOf`, the static facts of a document (R4 P2): done (2026-10-24, D24), released in the next batch. It gives the reads with marks for lazy parts, the side, the effects and the marks `pure` and `volatile`. A test of generated documents finds each real read in the static reads. S1b and S2 build on it.
15. K24: signatures of operations and a bidirectional `check` (R5 P3) (done, 2026-10-24, D25, released in the next batch). A formula profile gives each operation a signature or overloads, and a contract gives `result` and `expect`. With the option `types`, `check` synthesizes the type of each part and checks it against the type that its position needs. A wrong type gives the static issue `#TYPE!`, and an evaluation does not change. The type rule of a document follows its evaluator.
16. S1b: a list of reads for each evaluation, and `verifyReads` (R4 P3): done (2026-10-24, D26), released in the next batch. An evaluation records each path that it resolves, with what the path reached and the mark `free`. `verifyReads` resolves each free read again with the rules of `sameResult`, and it gives the first changed read. A test of generated documents changes the contexts at random and finds no stale result.
17. K18 and K19: the effects that reach the host, and the check of the waits of a run (R2 P3, P4) (done, 2026-10-24, D27, released in the next batch). `effectsOf` gives the declared effects that no mask or rule `only` removes, thus a host can grant the least authority. A procedure value keeps the capabilities of its maker, and `checkLatent` compares the latent effects of a procedure with its body. `check` asks the hook `permits`, and its option `run` finds a runner under a parent that cannot wait. The rule `grant` moved to L1a.
18. K25: the types of the roots, of the names and of the paths (R5 P4) (done, 2026-10-24, D28, released in the next batch). The host gives the types of its names, `self`, `world` and `event` in the option `rootTypes`. A reference gets the type that its path reaches, and a missing field of a closed record gives `#TYPE!`. `typeFromSchema` and `typeFromSamples` make such types, `Domain.steps` types a step into a domain, and `extendDomain` adds parents to a foreign domain. The work closed a hole of K24: a name bound to a reference document had the type of that document.
19. S1c: two levels of durability (R4 P7) (done, 2026-10-24, D30, released in the next batch). `durable` keeps one epoch for the structure and one for the data. A plan and the facts stay for each document object, thus a change of data compiles nothing. After a change of data, a pure document verifies its reads, and another document evaluates again. A test of random edits, new machines and changes of data finds no stale result.
20. K90 to K92 (R7 P1 to P3): the written core calculus, the narrowing of the parts of compiled code and the conformance tests of evaluators. R7 found that a compiled evaluator can give a part more capabilities than its document has.
21. S1: the interface of a schedule (R4) (done, 2026-10-25, D31, released in the next batch). `schedule` keeps named documents as nodes under the root `world`, and it evaluates them on demand through `durable`. It gives the edges from the static reads and the side of each node. An edge goes to a node and keeps its field, thus the early cutoff is by field. Each node of a cycle gives `#CYCLE!` in each order, and a node on the run side is a sink. A harness compares the demand schedule with an evaluation from scratch after random changes.
22. K91: compiled code cannot widen the capabilities of a part (R7 P2) (done, 2026-10-25, D32, released in the next batch). Each context carries the grant of the kernel, and a spread keeps it. Each document keeps only what its grant permits, also under the rules of a contract and for an own effect of compiled code. The probe of R7 is a test, and the agreement harness has a configuration of compiled code that widens.
23. S2 and S2a: the analysis of a graph of nodes, and long chains on demand (R4 P5) (done, 2026-10-25, D33, released in the next batch). `components`, `heights`, `nodeLayers`, `necessary` and `cycles` walk a graph with their own stack, thus a chain of 100000 nodes does not overflow. A cycle of eager edges is certain, and a cycle through a lazy read is possible. A demand of the host first demands the nodes of its eager edges, deepest first. Thus a chain of 100000 nodes gives its value with no `#DEPTH!`. The harness of S1 still agrees with an evaluation from scratch, and the work adds S2b to S2d and K105.
24. K90: the core calculus as a page of the specification (R7 P1) (done, 2026-10-25, D34, [`SEMANTICS.md`](SEMANTICS.md)). It gives the syntax and five judgments, with one inference rule for each case. It also gives the two handlers of the run side and the obligations C1 to C7. Each rule names its SPEC IDs, and the test SEM.RULES checks them. Six facts that SPEC did not state are IDs with tests. Three disagreements of the code and the rules are the rows K110 to K112.
25. K92 and K111: conformance tests for evaluators (R7 P3) (done, 2026-10-25, D36, released in the next batch). `conforms(machine, name)` starts one evaluator or runner with probe parts and a probe runtime. It checks C1 to C8, the state between calls and the agreement with the definition for the reference. Each standard evaluator and runner conforms. C8 is in `SEMANTICS.md`. The rows K120 to K123 hold what the work found.
26. K105: smaller plans for plain references (done, 2026-10-25, D35, released in the next batch). A plan of one reference of the formula kit keeps approximately 400 bytes, not 1.5 KB. The code of a plan and of a compiled path is on a class. The facts and the state of a schedule keep short lists with no free room. SCHED.LONG-CHAIN needs approximately 550 MB, not 730 MB, and each result, error, place and read stays the same. The work adds K115 and K116.
27. K93: law tests of the semantics (R7 P4) (done, 2026-10-25, D37, released in the next batch). Six property tests on generated documents and machines examine EVAL.SEALED, EVAL.DETERMINISTIC, CAP.MONOTONE, COMPOSE.CONSERVATIVE, TREE.ORDER-FREE and SEQ.LAWS. Each law states its conditions, and `SEMANTICS.md` names it beside its rules. Each law holds, and a mutant of the kernel breaks each test.
28. K110: a run drives a runner under an evaluator (done, 2026-10-25, D38, released in the next batch). Both handlers drive such a runner with the same code, and only a real wait gives `#CALC!`. An `if` whose branch that waits is not taken runs under an operation. RUN.SAME loses its condition of the check, and the check with the option `run` reports only a runner that can wait. Next: K130.

On the site, C10 is done (2026-10-24, R4). Each other proposal of the six studies R1 to R6 is a row with the status `later`. R7 gives its rows the status `next` or `later`.

## The design and the site

| ID | Item | Status | Depends on |
| --- | --- | --- | --- |
| C1 | The repository, the model package and the site with a live diagram for each idea | done (2026-10-25) | |
| C2 | The site on GitHub Pages, and CI on each push | done (2026-10-20) | C1 |
| C3 | A diagram of the four schedules: pull, push, demand and once, with the same values | done (2026-10-20) | C1 |
| C4 | A diagram of one path grammar for names, positions and order | done (2026-10-20) | C1 |
| C5 | The decisions of the owner on the questions Q1 to Q4 (D5, D6, D9, D10) | done (2026-10-20) | |
| C6 | The visual grammar: one glyph for each concept, the views by the ladder, the glyph key, and the explorer of an evaluation | done (2026-10-20) | C1 |
| C7 | The guide: one page for each glyph, from documents to effects | done (2026-10-20) | C6 |
| C8 | The playground: build a document from the kinds, and open each picture of the guide in it | done (2026-10-20) | C6 |
| C9 | Reference arrows on each picture, and an arrow for each move of a path on each picture: both kinds are done. The hops of `resolve` give the moves. | done (2026-10-26) | C6 |
| C10 | The schedule diagram (C3) computes its dependencies with the kernel (`refsOf`), as the site rule says (R4) | done (2026-10-24) | C3 |
| C11 | A structured editor in the playground from the kind contracts. An empty position holds a document of a kind `hole`, thus each state of an edit evaluates (R6 P6). | later | C8 |
| C12 | A live diagram of record and replay: a run records its effects, and a replay steps through the journal. A changed answer shows `#REPLAY!` at its address. From K11. | later | C1 |
| C13 | The site shows the work of the research: a page and a live diagram for the merge of languages (D17, D18), a live diagram of the decorated tree (D16), a page for the studies, and the guide as a route on the home page | done (2026-10-24) | C7 |
| C14 | The explorer and the playground show the type of each place from `typeCheck`, and each `#TYPE!` issue at its place (R5 P3). From K24. | later | C8, K24 |
| C15 | The syntax kit: one parser and printer driven by a profile (an operator table, literal rules, reference syntax and call syntax), with documents as output and error spans. It starts from the formula parser of a renderer package. The verb format (K33) is the printer. Each language that has a text syntax becomes a profile, and the site and the playground editor (C11) use it. From K33 and a review of duplicate code. | done (2026-10-25, D41, released in the next batch) | K33 |
| C16 | A page of the site for the syntax kit, with a live diagram: a text box that parses with a profile, the document tree with each issue at its span, and the printed text. From C15. | later | C15 |
| C17 | The playground (C8) and the structured editor (C11) show and accept the text of `STD_SYNTAX` next to the tree of a document. From C15. | later | C11, C15 |
| C18 | Machine checks for the decisions. Tests check D2 (no path to the classifier), D7 (no value field on a part), D22 (the domains are on the machine), D29 (no export of `compilePath`) and D32 (a private grant symbol). The audit fixes: references in the sequence diagram name their root, the loop diagram uses the kernel, and the `github:` dependencies have a pinned commit. | done (2026-10-26) | |
| C19 | The colors of the diagrams keep one meaning: the arrows of the direction diagram and the glyphs of collapse, text and bool get their own tokens in `diagrams.css`. The moves tab finds its targets with the kernel, not with a walk of the site. The kernel has no step for the siblings, the ancestors or the descendants, thus the tab has no such move. From the audit of C18. | done (2026-10-26) | C18 |

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
| K8 | check narrows the capabilities as the kinds do (a bug from the study R2) | done (2026-10-24) | K3 |
| K9 | A harness for one meaning: a reference interpreter that compiles nothing, documents that a generator makes from the kind contracts, and an exported `agree` (R1 P1, D15) | done (2026-10-24, version 0.4.2 with the corrections of four bugs that the harness found) | K2, K3 |
| K10 | A synchronous mock `perform` for `evaluate`. Its answer becomes the result of the effect, and a promise from it gives `#CALC!` (R2 P1). | done (2026-10-24, released in 0.6.3, D19: the option `perform` of `evaluate`, `plan.evaluate`, `reference` and `agree`) | L1 |
| K11 | Effect outcomes with stable addresses, and the helpers `recorder` and `replayer` for record and replay (R2 P2) | done (2026-10-24, released in 0.6.3, D19: `Effect.address`, `Effect.outcome`, `#REPLAY!` and the journal of the waits of `all`) | L1 |
| K12 | Compiled paths: `compilePath` resolves one static path, and `derefStep` keeps a memo of `lookupKind` (R1 P2) | done (2026-10-24, D29, released in the next batch) | K4, K9 |
| K13 | Folds of closed pure subtrees: a static subtree evaluates one time at compile time, from a `pure` mark in the kind contract (R1 P3) | done (2026-10-26, D43) | K9 |
| K14 | Binding times that the host declares: a path from a root that does not change resolves at compile time (R1 P4) | later | K9, S1 |
| K15 | A tier of generated JavaScript for hot pure regions (R1 P5) | later (only behind a CI benchmark) | K9, K13 |
| K16 | Nodes that specialize themselves: a compiled node keeps a small state, and this state gives profile data to K15 (R1 P6) | later | K9 |
| K17 | One plan at many positions with `plan.evaluateEach(contexts)` (R1 P7) | later (only after a language asks for it) | K9 |
| K18 | The rest of R2 P3: `effectsOf` for the effects that reach the host, the latent effects of procedure entries, and a check that uses the hook `permits` of the machine. K8 shipped the rules `same`, `mask` and `only` (`Kind.caps`, D14). The rule `grant` for a handler moved to L1a. | done (2026-10-24, D27, released in the next batch: `effectsOf`, `checkLatent` and the hook `permits` in `check`) | K8 |
| K19 | A static check of the "can wait" bit: `check` reports a runner under a parent without a runner (R2 P4) | done (2026-10-24, D27, released in the next batch: the option `run` of `check`) | K3 |
| K20 | `check` knows the names of operations and extensions through a hook, and `fn` declares the shape of `params` (R5 P1) | done (2026-10-24, version 0.4.3: the hook `known` of the machine, and `partsOf`) | K3 |
| K21 | `docEquals` compares the values that are not plain JSON by identity, thus two different dates or maps are not equal (R4) | done (2026-10-24, version 0.4.3) | K3 |
| K22 | `sameResult`, a safe equality for an early cutoff: host values compare by `Object.is`, and errors by code, reason and place (R4 P1) | done (2026-10-24, released in 0.6.3: `sameResult`, and one walk for `docEquals`, `sameValue` and `sameResult`, D20) | K5, K21 |
| K23 | Value types and value domains: a new `types.ts` with open base types, the relation `fits`, and a membership test for each domain (R5 P2) | done (2026-10-24, D22), released in the next batch: `ValueType`, `Domain`, `fits`, `member`, `typeIssues`, `STD_DOMAINS` and `Machine.domains` | K2, K3 |
| K24 | Signatures of operations in the profile, and a bidirectional `check` that synthesizes or checks the type of each part (R5 P3) | done (2026-10-24, D25, released in the next batch) | K23 |
| K25 | Types of the roots, of the names and of the paths, from the host, from a JSON Schema or from sample values (R5 P4) | done (2026-10-24, D28, released in the next batch) | K24 |
| K26 | The agreement rule for types: in a traced evaluation of a document that checks, each value is in the type of its place (R5 P5) | later | K9, K24 |
| K27 | Narrowing in `if`, `and` and `or`: a test with `proves` narrows the type of a path in its branch (R5 P6) | later | K25 |
| K28 | Casts at the boundaries of `unknown`: with the option `guards`, `prepare` adds a membership test that gives `#VALUE!` at the boundary (R5 P7) | later | K25 |
| K29 | Types of the run side: a procedure gets an input type, an output type and its effects, and `seq` gives each step its type (R5 P8) | later | K25, L1 |
| K30 | Generic signatures with type variables, thus `check` finds the parameter types of a function argument, as for `map` (R5 P9) | later | K24 |
| K31 | Intervals of numbers that widen in a cycle, and type rules as documents that the tree kit evaluates (R5 P10) | later (low value today) | K24, L2a |
| K32 | One merge function for worlds and machines, with conflict rules. Equal entries merge, namespaces merge key by key, and each other conflict is an error without a mark `replaces` (R6 P2). | done (2026-10-24, version 0.6.0, D17: `mergeWorlds`, `mergeMachines` and `MergeError`) | K2 |
| K33 | Each verb through the kernel: `prepare` and `check` take a verb, one ladder serves each verb, and a verb `format` is the demonstration (R6 P3) | done (2026-10-24, D23, released in the next batch) | K32 |
| K34 | The composition checklist as spec tests: one test `COMPOSE.*` for each mode of composition, with small languages (R6 P1) | done (2026-10-24, version 0.6.1: `restrictWorld`, `restrictMachine`, D18 and `docs/COMPOSITION.md`) | K32 |
| K35 | Verb entries for the kinds of another language: a language adds a verb that it owns to a foreign kind, through the merge of K32 (R6 P4) | later | K32, K33 |
| K36 | A check of verb coverage: `checkWorld` lists each kind with no entry and no default for a verb that the language declares (R6 P5) | done (2026-10-27, D45, released in the next batch) | K33 |
| K37 | A language package format: `defineLanguage` gives one value with a name, a version and a hash, and `compose` merges languages through K32 (R6 P7) | later | K32 |
| K38 | A boundary kind `lang` for a part in another language, as the module boundary of Racket (R6 P8) | later (low value today, and a decision of the owner first) | K37 |
| K39 | A host thing can say that a field holds `undefined`. Today `deref` uses `undefined` for a missing field, so a host that adopts the names root hides a name bound to `undefined`. Found by K20. | done (2026-10-24, released in 0.6.3: the optional `has` of a host thing, also on the nodes of the standard tree, D21) | K4 |
| K40 | An evaluator that is a formula document (D1). A language is then data only: its kinds are JSON, and its evaluators are documents. From K34 (COMPOSE.SELF-EXTEND). | later (the open question 6 of R6 first) | K34 |
| K41 | Two languages that each build the formula kit with one profile merge. Before, each `formulaMachine` call made new evaluators, thus each evaluator name of the kit was a conflict. From K34 (COMPOSE.UNIFY). | done (2026-10-27, D46, released in the next batch) | K34 |
| K42 | Each call at the top of a module has the mark `/* @__PURE__ */`, and a test bundles an import with esbuild (PKG.PURE). A request of a language. | done (2026-10-24, version 0.6.2) | none |
| K43 | The `deref` code of a kind and the `deref` of a walker can give a field that holds `undefined`. Today they use `undefined` for a missing field. From K39. | later | K39 |
| K44 | A replay log is JSON, so a test can keep it as a golden file. Today the causes of errors and the host values are not JSON. From K11. | later | K11 |
| K45 | A replayer serves more than one run, and a recorder keeps the order of the waits of an inner replayer. From K11. | later | K11 |
| K46 | The reference interpreter covers runs, so `agree` also checks the order of the waits of a replay. Today only the plan has a test for it. From K11. | later | K11 |
| K47 | The address of an effect stays the same after an edit of the document, as the open question 5 of R2 asks. From K11. | later | K11 |
| K53 | The kind `pure` refuses a list with more than one part (CAP.PURE-ONE). Before, it ignored each part after the first. Found by S1a. | done (2026-10-24, released in the next batch) | none |
| K54 | Declared reads for walkers and extensions: a walker or an extension declares what it reads, so it can count as pure in the facts. From S1a. | later | S1a |
| K55 | Facts for each verb: the side and the effects of a verb other than eval come from its own contract, not from the eval contract. From S1a. | later | S1a, K56 |
| K56 | Effects declared for each verb: a contract declares the effects of each verb, so check also tests the verbs other than eval. From K33. | later | K33 |
| K57 | The document generator also picks step kinds from defaults.step, so the agreement runs test that case. From K33. | later | K33 |
| K58 | plan.run gets its own options type, because a plan keeps the verb and the declared type from prepare. From K33. | later | K33 |
| K60 | A closure records only its own reads. Today a closure counts a read of each whole root, so each change of the context discards its old result. From S1b. | later | S1b |
| K61 | A check that host values do not change in place. verifyReads compares host values by identity, so a change in place stays hidden. From S1b. | later | S1b |
| K140 | A codec for values that are not JSON: an ext.domain extension with encode and decode from the domains of a machine, next to ext.number. Then each language writes NaN, -0 and domain values as the same documents (D12). From a review of duplicate code. | done (2026-10-25, D40, released in the next batch) | none |
| K141 | A kernel check of the laws of a codec: `decode(encode(v))` equals `v` for sample members, and `encode` gives JSON. Today each language tests its own codec. From K140. | later | K140 |
| K142 | `encodeValue` picks the most specific domain: a domain with a codec under another domain with a codec wins. Today the order of the names decides. From K140. | later | K140 |
| K143 | Literal rules for `ext.domain` in a syntax profile, for example a date literal of a spreadsheet. The rule reads the text through the codec of a domain. From C15. | later | C15, K140 |
| K144 | `parse` recovers after an issue and gives each issue of a text, for an editor. Today it stops at the first issue. From C15. | later | C15 |
| K145 | Text forms for the constructs `let`, `fn`, `call` and `record` in `STD_SYNTAX`. Today the standard profile writes only operators, calls, `if` and `list`. From C15. | later | C15 |
| K146 | A check of a syntax profile that finds a call name that a form hides, and a pattern that a name matches. Today `print` refuses such a document at its place. From C15. | later | C15 |
| K147 | The place of a node from a hop: a hop of a resolution gives a thing but no place in the document. An export, for example placeOf(thing), lets a view put each hop on its card. Found by C9. | later | |
| K148 | One hop for each parent step of nearest: the walker gives one hop for the whole walk today. An option records each node on the way. Found by C9. | later | |
| K149 | The tree node reads `self` through `resolve`, and not directly (C4). Then the list of reads and the static facts hold the read, and `verifyReads` finds a changed `self`. A kind declares such reads in `reads` (D44). | done (2026-10-26) | |
| K80 | A planner keeps `-0` and `0` apart (PLAN.CACHE-ZERO). Before, the bare document `-0` got the plan of `0` and evaluated to `0`. Found by S1c. | done (2026-10-25, released in the next batch) | none |
| K48 | `fits` finds more true cases. Today it is sound but misses some, for example `bool` against `{ one: [true, false] }`. From K23. | later | K23 |
| K49 | A kernel base type for `undefined`, because the standard extension `ext.undefined` gives it. From K23. | later | K23 |
| K50 | A profile with its own `truthy` declares the type of a truth, thus `check` tests the test of `if` and the terms of `and` and `or`. Today such a profile accepts each type there. From K24. | later | K24 |
| K51 | Signatures of extensions in the profile. Today each `ext.*` has the type `unknown`, except the standard `ext.number`. From K24. | later | K24 |
| K52 | A check of each value type of a machine before a document exists: each `result`, each `expect` and each signature. Today `check` reports a bad type at its first use. From K24. | later | K24, K36 |
| K64 | The effects of an own entry for another evaluator. Its code can cause effects that no contract declares, thus `effectsOf` and `check` do not see them. A declaration in the hook `facts` can give them. From K18. | later | K18 |
| K65 | A compiled runner can evaluate a part with its code that does not wait. The check of the waits assumes that a runner passes each wait of its parts through. A contract mark for such parts makes the check exact. From K19. Since K110, such a part fails only when it really waits, thus only the check is not exact. | later | K19 |
| K70 | A step into a base type of the kernel, a function, or a list with a key that is not an index or `length`, is a type issue. Today it gives `unknown`, and the run gives `#N/A` there. From K25. | later | K25 |
| K71 | A type provider for `world` that gives the type of a path on demand, for a large store. Today the host gives one type for the whole root. From K25. | later | K25 |
| K72 | A walker declares the type of what it reaches, thus a path with a step document gets a type. Today a step document gives `unknown`. From K25. | later | K25 |
| K73 | `typeFromSchema` reads `$ref` into `$defs` of the same schema, and `allOf` of records. Today a schema with `$ref` reads as `unknown`, and `allOf` tests nothing. From K25. | later | K25 |
| K74 | The tree kit gives its kinds type rules with `PartType.roots`, thus an attribute of a node knows the type of `self`. Today the parts of a node get `unknown` roots. From K25. | later | K25, L2b |
| K75 | A language compiles its own paths: an export of `compilePath`, and a route through `Runtime` that records the reads, for the second tier of a language (D13). Today only the formula kit uses compiled paths. From K12. | later | K12 |
| K76 | The mark "total" for compiled code: `compileNode` does not wrap the code of `lit` in `placedCode`, thus a literal costs one call (R1 P2). From K12. | later | K12 |
| K77 | The standard evaluator `ref.resolve` compiles its path. It is a function evaluator, thus each evaluation resolves its path again. It needs a definition for the reference (REF.DIRECT). From K12. | later | K12 |
| K90 | The core calculus as a page of the specification, `docs/SEMANTICS.md` (R7 P1). It gives the syntax, five judgments, one rule for each rule of evaluation, the two handlers of the run side and the obligations of host code C1 to C7. It also states four facts that SPEC does not state: the bounds of 64 collapses and 32 aliases, the context of the reader for a reference in data, and parts that are call by name. A test checks that each rule names a SPEC ID that exists (SEM.RULES). | done (2026-10-25) | none |
| K91 | A compiled evaluator or runner cannot give a part more capabilities than its document has (R7 P2, D32). Each context carries the grant of the kernel, and a spread keeps it. Each document keeps only what its grant permits, also under the rules of a contract and for an own effect of compiled code. Before, the plan caused an effect where the reference gave `#CAP!`. Test: CAP.NARROW-CODE. | done (2026-10-25, released in the next batch) | none |
| K92 | Conformance tests for evaluators: `conforms(machine, name)` evaluates one evaluator with probe parts and a probe runtime (R7 P3). It checks the obligations C1 to C8, that the code keeps no state, and that compiled code agrees with its definition for the reference. Each evaluator and runner of the standard library and the formula kit conforms. Tests: CONFORM.STD, CONFORM.NARROW, CONFORM.EFFECTS, CONFORM.LAZY, CONFORM.PURE, CONFORM.SEALED, CONFORM.WAIT, CONFORM.SCOPE, CONFORM.LOCAL and CONFORM.PROFILE. | done (2026-10-25, D36, released in the next batch) | K91 |
| K93 | Law tests of the semantics on generated documents (R7 P4): EVAL.SEALED as a property, EVAL.DETERMINISTIC, CAP.MONOTONE, COMPOSE.CONSERVATIVE, TREE.ORDER-FREE and SEQ.LAWS. The equations of effects stay with S4. Each law holds on the code of today (D37). | done (2026-10-25, released in the next batch) | none |
| K94 | A clock for `call`: each application of a closure counts one level of depth, thus an endless recursion gives `#DEPTH!` at one place in each tier (R7 P5, R1 open question 3). Today it ends at the stack of the host, at a different place in each tier. Test: FORMULA.CALL-DEPTH. | later | none |
| K95 | A third tier: a stepper from a CPS transformation and a defunctionalization of the reference, for the kernel and the formula kit (R7 P6). It reads the lookup, the split and the steps of a path from the rules of K90, thus `agree` also tests the definitions that the plan and the reference share. Its configurations are data. Tests: AGREE.STEPPER, STEPPER.DEEP and STEPPER.DATA. | later | K90 |
| K96 | Slices of the calculus in Lean 4 (R7 P7): first the formula kit over JSON with a clock, also as a nightly tier of `agree`. Test: AGREE.LEAN. | later | K90 |
| K97 | The static analyses as abstractions of the stepper, as in AAM (R7 P8). Only when a new analysis needs control flow, for example S2 or L2e. Test: ANALYSIS.AGREES. | later | K95 |
| K100 | A resolution of the root `caps` from compiled code reads the context that the code gives, also a context that it widened. Such a list permits no effect (CAP.NARROW-CODE), but its value differs from the reference. The runtime can read the root `caps` through the grant. From K91. | later | K91 |
| K101 | Remove the bias of the CI bench. Found during K91. In one process, each copy kept one compilation of V8, and identical code showed changes of up to 11 %. The fix starts each copy in new processes, and V8 compiles and collects at fixed points. The job also prints the noise of two copies of the base (A/A). | done (2026-10-25) | K12 |
| K105 | The memory of a plan (D35). A plan of one reference of the formula kit kept approximately 1.5 KB in a bundle, and after K105 it keeps approximately 400 bytes. The code of a plan and of a compiled path is on a class, and the code of a reference keeps only its compiled path. The facts and the state of a schedule keep short lists with no free room. A node of a schedule of 100000 references goes from approximately 3 KB to 1.2 KB. Found by S2a. Test: PLAN.LEAN. | done (2026-10-25, released in the next batch) | none |
| K110 | A run drives a runner under an evaluator until its first wait, as an evaluation does (K90). Today a run gives `#CALC!` before such a runner starts, also when it does not wait (RUN.NEEDS-RUNNER). Thus `add` over `pure` gives a number in an evaluation and `#CALC!` in a run, and RUN.SAME needs the condition of `check`. A decision selects the run rule or keeps the present rule. Test: RUN.DRIVE-NESTED. | done (2026-10-25, released in the next batch) | none |
| K111 | The obligation C8 of a formula profile: its functions `ops`, `lazy` and `ext` give the same answer for the same name at each time (K90). The plan reads them when it compiles a document, and the reference reads them at each evaluation. A profile that changes its answers breaks the agreement of the tiers. The rule goes into `SEMANTICS.md`, and K92 checks it. Test: CONFORM.PROFILE. | done (2026-10-25, D36, released in the next batch) | K92 |
| K112 | A long chain without a cycle gets its own reason (K90). Today a resolution that follows more than 64 references gives `#CYCLE!` with the reason "The references form a cycle.", and a lookup through more than 32 aliases gives the reason `cycle`. The reason names the bound when no cycle exists. Test: DEREF.CHAIN-REASON. | later | none |
| K115 | Each part of a plan makes the steps of its run at the first `run`, as the root does (D35). Today each part keeps `runOf` of its code, approximately 96 bytes, because a compiler can copy `CompiledPart.run` with a spread. From K105. | later | K105 |
| K116 | The peak of SCHED.LONG-CHAIN. The test still needs approximately 550 MB in its worker, and its schedule keeps approximately 120 MB of it. A study measures the garbage of the demands of a long chain: the sessions, the lists of reads and the maps of the cycles. From K105. | later | K105 |
| K120 | A context that compiled code keeps from an earlier evaluation escapes the grant of the kernel (K92). The context carries its own grant, thus a later evaluation with fewer capabilities still causes the effects of the earlier one. `conforms` finds such code (C1), but a plan does not refuse it. A grant for each evaluation can close it. Test: CAP.NARROW-KEPT. | later | K91 |
| K121 | `conforms` for walkers, the `deref` verb and the functions of a profile (K92). Today it examines evaluators and runners only. A walker can also read hidden state or widen a context. Test: CONFORM.WALKERS. | later | K92 |
| K122 | The probe `all` of `conforms` takes its items one after the other (K92). The real `all` of a run interleaves them, thus code that depends on the order of parallel parts is not found. Test: CONFORM.PARALLEL. | later | K92 |
| K123 | A page of the site for conformance, with a live diagram (K92). It runs `conforms` on an evaluator that the reader breaks, and it shows each finding with its probe. | later | K92 |
| K130 | In a run, an effect of an evaluator asks `perform`, and only a promise gives `#CALC!` (K110). Today it gives `#CALC!` before the test of its capability, also when the host answers at once. Then RUN.SAME holds for each document whose host answers at once. | later | K110 |

## The kits

| ID | Item | Status | Depends on |
| --- | --- | --- | --- |
| L1 | The sequence kit: steps with names for the results of earlier steps, capabilities, and the order of effects | done (2026-10-21: parts at the same time, the error of the host, capabilities that only narrow, an abort) | K2 |
| L1a | A handler kind `handle` with clauses that run in place, so that mocks, retries and logs are documents (R2 P5, and R2 drafts its decision). It also adds the rule `grant` of R2 P3 to `Kind.caps`: the parts get operations that the handler answers (D27). | later | K10, K18 |
| L1b | Multi-shot by evaluation again: a kind `choose` evaluates its sealed body again for each branch, with a replay log (R2 P7) | later | K11, L1a |
| L2 | The tree kit: data down, sizes up and references sideways, by attribute equations | later (L2a and L2b are done, and L2c to L2i come from R3) | K2, K4 |
| L2a | The decorated tree: demand evaluation with one memo for each node and attribute, `#CYCLE!` with its chain, and errors that stay errors. It fixes three bugs that R3 found in the standard `tree.node` (R3 P1). | done (2026-10-24, version 0.5.0, D16) | K2, K4 |
| L2b | Equations in kind contracts, with a ladder for attributes: the own field, the kind, the parent, a copy, then a default (R3 P2) | done (2026-10-26, D42) | L2a |
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
| S1 | The interface of a schedule: the graph of the data and the side of each kind | done (2026-10-25, D31, released in the next batch: `schedule`, `edgesOf`, `NodeEdge` and `NodeInfo`) | K2, S1a, S1b, S1c |
| S1a | `factsOf` gives the static facts of a document: its reads with marks for lazy parts, its side, its effects, and the marks `pure` and `volatile` (R4 P2) | done (2026-10-24, D24, released in the next batch) | K2, K3 |
| S1b | A list of reads for each evaluation, and `verifyReads`, which keeps an old result when each read gives the same thing again (R4 P3) | done (2026-10-24, D26, released in the next batch) | K4 |
| S1c | Two levels of durability: a host keeps one epoch for the structure and one for the data, thus a change of data compiles nothing (R4 P7) | done (2026-10-24, D30, released in the next batch: `durable`, `Epochs`) | S1a, S1b |
| S1d | References in the data of a host for a static graph. A reference in the data, or in the value of a node, can lead a read to another node (DEREF.COLLAPSE). The static reads and the edges of D31 do not show it, but the reads of an evaluation do. From S1a. | later | S1a |
| S1e | A measure of the cost of the list of reads: a CI benchmark of the formula of FORMULA.SPEED with the list and without it. From S1b. | done (2026-10-25: the job `bench.yml` of K12 has the case "the same formula, with a list of reads") | S1b, K12 |
| S1f | A context for each node of a schedule: the host gives each node its own `self`, thus one formula at each cell of a grid shares one plan. Today each node gets the context of the host. From S1. | later | S1 |
| S2 | The static analysis: cycles, an order for a push schedule, and the independent groups, with a new `graph.ts` (R4 P5) | done (2026-10-25, D33, released in the next batch: `components`, `heights`, `nodeLayers`, `necessary`, `cycles` and `NodeGraph`. A cycle of eager edges is certain, but the demand of D31 gives the values. An edge without a target reads each node that is not a sink) | S1a, S1 |
| S2a | A demand of a long chain of nodes evaluates the deepest nodes first, in the order of the heights of S2. Before, a demand used the stack of the host for each node of a chain, and a chain of approximately 1000 nodes gave `#DEPTH!`. From S1. | done (2026-10-25, D33, released in the next batch: a demand of the host first demands the nodes of its eager edges, deepest first, and `counts.ahead` counts them. A chain of 100000 nodes gives its value) | S1, S2 |
| S2b | A long chain through lazy reads, or through an edge without a target, on demand. Such a chain still uses the stack of the host for each node, because a demand ahead follows only the eager edges. From S2a. | later | S2a |
| S2c | A certain cycle with more nodes than the stack of the host holds. Its demand still uses the stack for each node of the cycle, and it gives `#DEPTH!`. From S2a. | later | S2a |
| S2d | A host reports the certain cycles of a schedule before a run, for example as issues of `check` with the code `#CYCLE!`. Today a host gives `schedule.graph()` to `cycles`. From S2. | later | S2 |
| S3 | Adapters to the reactive engines of the hosts | later (S3a and S3b first, from R4) | S1 |
| S3a | A harness for one meaning across schedules: a model-based test, and `agreeSchedule(engine)` for the engine of each host (R4 P4) | later (S1 has the core: SCHED.ONE-MEANING compares the demand schedule with an evaluation from scratch. S3a adds push-pull, push by height, verifying traces and the export for the engines of the hosts) | K9, K22, S1b, S1 |
| S3b | A reference adapter for signals in the tests, with `sameResult` as its `equals` (R4 P6) | later | K22 |
| S3c | Derivatives of aggregates: an operation of a profile gives a derivative, thus an aggregate updates in a time that the size of the change sets (R4 P8) | later (only after a language over positions asks for it) | S3, L4 |
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
| M13 | The reactive formula language evaluates through the formula kit, and its analysis uses the static kit | done (2026-10-24: render evaluates through the kernel, its PR #13) | M12 |
| M14 | The program format of procedures runs on `run`, and its checker uses the static kit | in progress, in the repository of the language (a pull request is open) | M12 |
| M15 | The formula language of positions reads documents with the static kit, and the kernel is its reference interpreter | in progress, in the repository of the language (the kernel side is done in 0.4.0) | M12 |
| M16 | The defs of a user interface: bindings through the formula kit, one world for paths and runs, and checks from the static kit | in progress, in the repository of the host | M12 |
| M17 | The formula language of render reads and writes its text through a profile of the syntax kit (D41), not its own parser | later, in the repository of the language | C15 |
| M18 | The spreadsheet formula syntax of Vex and the algebra syntax of another language become profiles of the syntax kit (D41) | later, in the repositories of the languages | C15 |

## The research

Each study answers one research question and ranks its proposals. The folder `docs/research/` keeps the studies, and its [README](research/README.md) lists them.

| ID | Study | Status | Roadmap rows |
| --- | --- | --- | --- |
| R1 | [Staging and partial evaluation](research/r1-staging.md) | done (2026-10-24) | K9, K12 to K17. K12 adds K75 to K77. |
| R2 | [Algebraic effects, handlers and the run side](research/r2-effects.md) | done (2026-10-24) | K10, K11, K18, K19, L1a, L1b, S4. K18 and K19 add K64 and K65. |
| R3 | [Attribute grammars and the tree kit](research/r3-attribute-grammars.md) | done (2026-10-24) | L2a to L2i |
| R4 | [Incremental computation and schedules](research/r4-incremental.md) | done (2026-10-24) | K21, K22, S1, S1a to S1c, S2, S3a to S3c, C10. S1c adds K80. S1 answers the open questions 3, 4 and 5 (D31), and it adds S1f and S2a. S2 adds S2b to S2d and K105 (D33). R4 does not propose P9, a memo for each node of a plan: it breaks PLAN.LEAN, and D3 puts that work in the schedule. |
| R5 | [Types and abstract interpretation for `check`](research/r5-types.md) | done (2026-10-24) | K20, K23 to K31 |
| R6 | [Language workbenches and extensibility](research/r6-workbenches.md) | done (2026-10-24) | K32 to K38, C11. K34 adds K40 and K41. |
| R7 | [A formal semantics of the kernel](research/r7-semantics.md) | done (2026-10-24) | K90 to K97. K91 adds K100. |

