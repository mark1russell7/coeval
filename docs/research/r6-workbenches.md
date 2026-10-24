# R6: language workbenches and extensibility

This file is a research study for the kernel. It changes no rule. The coeval session decides which proposals go into `docs/ROADMAP.md` and `docs/DECISIONS.md`.

## The question

coeval is a kernel for declarative languages. Four languages evaluate through it. Two are formula languages: a reactive one over a store, and one over the positions of a space with a compiler tier. The other two are a program format for procedures and a user interface host with layout rules. This study asks three questions:

1. Where does coeval sit among language workbenches and designs for extensible languages?
2. What does the ladder (own entry, kind, default, by name only) borrow from that literature, and what does it answer?
3. What does coeval adopt next, and what does it not try to be?

The studies R1 to R5 cover staging, effects, attribute grammars, incremental computation and types. This study refers to them and does not repeat them.

## The answer in short

- coeval is the semantic half of a language workbench, as data. It has no grammar, no editor and no metalanguage of its own. A kind contract (K2) holds what MPS keeps in its structure and constraints aspects. A verb holds what MPS keeps in one aspect.
- The world is a table of kinds and verbs. A new kind is cheap: one entry and one evaluator. A new verb is cheap only when one generic default serves each kind. A verb for the kinds of another language changes their records today.
- Only the verb `eval` gets plans and checks. `prepare` and `check` name `eval` in their code, and `deref` and `step` have ladders of their own. Thus the verb dimension is weaker than the kind dimension.
- Two languages compose today with a shallow spread of records. A later kind wins without a message, a namespace replaces the namespace of the kit, and the fallback of the world is lost.
- The best next steps are cheap. The composition taxonomy of Erdweg, Giarrusso and Rendel becomes spec tests. One merge function gets conflict rules, and each verb goes through `prepare` and `check`. A structured editor from the contracts and a language package format come next.

## Background

### Language workbenches

[Fowler (2005)](https://martinfowler.com/articles/languageWorkbench.html) gave the name "language workbench" to a tool that defines a language and its editor together. The abstract representation is the source, and an editor projects it. [Erdweg and others (2013)](https://doi.org/10.1007/978-3-319-02654-1_11) compared the tools of the Language Workbench Challenge. Their feature model has six groups: notation, semantics, editor services, validation, testing and composability. The [journal version (2015)](https://doi.org/10.1016/j.cl.2015.08.007) adds benchmarks.

For coeval, the feature model is a map of its scope. coeval covers semantics (plans, D13), validation (`check`, K3) and part of composability (the world). Each language and the site keep notation and editor services.

### JetBrains MPS

MPS stores each program as an abstract syntax tree, and the editor changes the tree directly ([MPS, basic notions](https://www.jetbrains.com/help/mps/basic-notions.html)). A concept declares its properties, children and references ([MPS, structure](https://www.jetbrains.com/help/mps/structure.html)). A concept extends one concept and implements several concept interfaces. A language attaches aspects to each concept: editor, constraints, type rules, data flow and generators. No parser exists, thus two languages compose without grammar conflicts.

For coeval, a kind is a concept, and `Kind.parts` gives its children (SHAPE.RECORD, SHAPE.KINDS). The verb `view` is the editor aspect (D8). R5 maps the type rules of MPS to a verb `type`. MPS has concept inheritance, and coeval has no base kind (open question 1).

### Spoofax

The [Spoofax workbench](https://doi.org/10.1145/1869459.1869497) defines a language with declarative metalanguages. SDF3 gives the syntax. Statix gives names and types as constraints over scope graphs ([van Antwerpen and others 2018](https://doi.org/10.1145/3276484)). Stratego gives transformations as rewrite strategies ([Visser 2001](https://doi.org/10.1007/3-540-45127-7_27)). [Visser and others (2014)](https://doi.org/10.1145/2661136.2661149) state the aim: one declarative definition gives the implementation, the editor services and the proofs.

For coeval, this stance is the stance of K2. One contract feeds the evaluator, `walk`, `refsOf` and `check`. The scope rules of a kind are a small scope graph, as R5 says. Stratego shows that a general rewrite needs a strategy language. coeval has only `mapRefs` (STATIC.MAP), and forwarding (R3 P9) is its nearest form of a rewrite.

### Rascal and Xtext

[Rascal](https://doi.org/10.1109/SCAM.2009.28) is a metaprogramming language. It puts syntax definitions, pattern matching, relations and visitors in one language. [Xtext](https://doi.org/10.1145/1869542.1869625) makes a parser, an editor and a linker from one grammar on the Java platform. Both start from a text syntax, and coeval starts from a document. Their lesson for coeval is the index: each tool keeps one global index of the named elements for references across files.

### Racket and language-oriented programming

[Felleisen and others (2018)](https://doi.org/10.1145/3127323) describe Racket as a programmable programming language. Each module names its language on its first line with `#lang`. A language is a library that exports the forms of its programs ([Tobin-Hochstadt and others 2011](https://doi.org/10.1145/1993498.1993514)). Interposition points change the core: `#%app` for an application, `#%datum` for a literal and `#%top` for a free name ([Racket guide](https://docs.racket-lang.org/guide/module-languages.html)). Modules in different languages connect at module boundaries.

For coeval, the interposition points exist already, as names. The fallback of the namespace `ops` is `#%app` for operations (WORLD.FALLBACK). The declared type of a bare value is `#%datum` (LADDER.DECLARED). The fallback of an open world is `#%top` for kinds (WORLD.OPEN). coeval has no module boundary: one world serves each node of a document.

### The expression problem

[Wadler (1998)](https://homepages.inf.ed.ac.uk/wadler/papers/expression/expression.txt) named the problem. A solution adds new cases and new functions to a data type, without a change to old code, with static type safety. Four families of answers apply to coeval.

- **Object algebras** ([Oliveira and Cook 2012](https://doi.org/10.1007/978-3-642-31057-7_2)). An interface has one factory method for each case, generic in its result. Each operation is one implementation of the interface.
- **Finally tagless** ([Carette, Kiselyov and Shan 2009](https://doi.org/10.1017/S0956796809007205)). A term is polymorphic over its interpretations. An evaluator, a printer and a partial evaluator are three instances of one signature.
- **Data types à la carte** ([Swierstra 2008](https://doi.org/10.1017/S0956796808006758)). A syntax is the fixed point of a sum of functors. An operation is a fold with one algebra for each functor.
- **Multimethods and open classes.** In CLOS, a generic function gets methods outside the classes ([HyperSpec, chapter 7](https://www.lispworks.com/documentation/HyperSpec/Body/07_.htm)). [Clojure protocols](https://clojure.org/reference/protocols) extend types that exist already, and [Clojure multimethods](https://clojure.org/reference/multimethods) dispatch on any function of the arguments. [Julia](https://doi.org/10.1137/141000671) adds methods to the functions and types of other packages. [MultiJava](https://doi.org/10.1145/353171.353181) restricts open classes so that a type check stays modular.

Open extension has a known risk. The Julia manual gives the name "type piracy" to a method of a foreign function on a foreign type ([style guide](https://docs.julialang.org/en/v1/manual/style-guide/#avoid-type-piracy)). In Haskell, the same thing is an [orphan instance](https://wiki.haskell.org/Orphan_instance).

For coeval, the world is the open sum of the functors. `Kind.parts` tells where the parts are, and `fill` maps over them (EVAL.FILL). An evaluator gets sealed parts (EVAL.SEALED), thus it is compositional, as an algebra or a tagless instance is. A verb is one interpretation. A multimethod of Clojure can dispatch on the shape of a value, but D2 permits only names.

The main difference is the proof. The four answers prove coverage with static types. coeval finds a missing entry at `prepare` time (PLAN.FAIL-LATE) or with `check` (`#KIND?`, `#NOEVAL`).

### Modular language composition

[Erdweg, Giarrusso and Rendel (2012)](https://doi.org/10.1145/2427048.2427055) separate five modes of composition:

- **Extension.** A new language reuses a base language and adds to it. The base does not know the extension.
- **Restriction.** An extension that removes constructs of the base.
- **Unification.** Two independent languages compose, with glue code between them.
- **Self-extension.** A program extends its own language from inside, as in [SugarJ](https://doi.org/10.1145/2048066.2048099).
- **Extension composition.** Two extensions of one base compose. Incremental extension is an extension of an extension. Extension unification puts two independent extensions together.

The hard case is extension unification without glue. For grammars, [Schwerdfeger and Van Wyk (2009)](https://doi.org/10.1145/1542476.1542499) give a modular test. Each extension passes it alone, and each set of extensions that pass composes without conflict.

### Projectional, structured and parsed syntax

The Cornell Program Synthesizer ([Teitelbaum and Reps 1981](https://doi.org/10.1145/358746.358755)) edited programs as trees, with templates. MPS continues this line. [Voelter and others (2014)](https://doi.org/10.1007/978-3-319-11245-9_3) list the usability costs of projectional editors and remedies for them.

In a controlled experiment ([Berger and others 2016](https://doi.org/10.1145/2950290.2950315)), basic edits were efficient. Complex edits needed experience and knowledge of the tree, and users made fewer typing errors. [Hazelnut](https://doi.org/10.1145/3009837.3009900) is a calculus of a structure editor with typed holes. In it, each state of an edit is a meaningful program.

### Everything is data

Lisp writes programs as lists, the data of the language ([McCarthy 1960](https://doi.org/10.1145/367177.367199)). A list `(f x y)` dispatches on its head symbol, which is a name. [Wand (1998)](https://doi.org/10.1023/A:1007720632734) showed a cost of this freedom. When an operator can read the syntax of its operands, as a fexpr can, no two different programs are equal in each context.

Five languages near JSON make different choices:

| Language | Form | Evaluation | Totality | Types | References |
| --- | --- | --- | --- | --- | --- |
| [JsonLogic](https://jsonlogic.com/) | JSON, one key for each rule | A fixed table of operations, and the host can add more | No loops and no functions, thus each rule stops | None | `var` with a path into the data |
| [Jsonnet](https://jsonnet.org/ref/spec.html) | Text, with JSON as a subset | Lazy, with object inheritance (`self`, `super`) | Functions can recurse | Dynamic | Lexical names, `self`, `super`, imports |
| [CUE](https://cuelang.org/docs/concept/the-logic-of-cue/) | Text, with JSON as a subset | Unification on a lattice, independent of order | A conflict gives bottom, an error | Types are values | Lexical paths |
| [Dhall](https://docs.dhall-lang.org/discussions/Safety-guarantees.html) | Text | Normalization | Each term with a type stops | Static | Imports, pinned by a hash of the normal form |
| [Nix](https://nixos.org/manual/nixpkgs/stable/#chap-overlays) | Text | Lazy and pure | Functions can recurse | Dynamic | Paths, imports, and overlays with `final` and `prev` |

These languages give three ways to merge two values. In Jsonnet, the right side wins, and `super` reaches the left side. In CUE, the two sides agree, or the result is an error. In Nix, overlays apply in order. Each overlay sees the set before it (`prev`) and the final set (`final`).

## How coeval relates today

| Idea | coeval today | Where |
| --- | --- | --- |
| Concept, structure aspect | A kind with its contract: parts, scope, capabilities, side and effects | `world.ts` (`Kind`), K2 |
| Aspect | A verb of a kind: the name of an evaluator | `Kind.verbs`, `ladder.ts` (`ask`) |
| Editor aspect | The verb `view`, with the default `view.card` | D8, `stdlib.ts`, the site |
| Constraints | SHAPE.KINDS, SHAPE.CLOSED, SHAPE.REQUIRED and the capability rules | `world.ts`, D14 |
| Scope graph | Scope rules: `keysAt`, `listAt`, `headers`, `sequential` | `ScopeRule`, STATIC.REFS |
| Interposition points | The fallbacks of a namespace and of the world, and the declared type | WORLD.FALLBACK, WORLD.OPEN, LADDER.DECLARED |
| Generator | The second tier of a language reads documents, and the plan is its reference | D13 |
| Composition | A spread of records | `formulaMachine` in `formula.ts` |
| Notation | None of its own. Each language keeps its text syntax, `fromDocument` and `toDocument`. | D12, D13 |
| Editor | The playground of the site | `Playground.tsx` |

Six facts follow from the code.

1. **The world is a table of kinds and verbs.** A kind maps verbs to evaluator names. An own entry maps a verb for one document, and `World.defaults` maps a verb for each kind. The code lives in tables of the machine, by name.
2. **Only `eval` gets plans and checks.** `evaluatorOf` and `compileNode` in `evaluate.ts` ask for `eval`. `check` in `static.ts` asks for `eval` too. A language with a verb `format` writes its own walk, with no plan, no trace and no `check`.
3. **The ladder differs by verb.** `eval` and `view` visit own, kind and default. `deref` visits own and kind, then a fixed `plainStep`, not `World.defaults` (`derefStep` in `deref.ts`). `step` has only the kind rung. Each verb has its own table: `evaluators`, `runners`, `derefs` and `walkers`.
4. **A merge loses entries without a message.** `formulaMachine(profile, more)` spreads `more.world.kinds` over the kit. A kind of `more` replaces a kit kind with the same key. A namespace `ops` in `more` replaces the kit namespace and its fallback. `more.world.fallback` does not reach the result, thus an open world (WORLD.OPEN) cannot come through `more`. All evaluator names share one flat table.
5. **A document cannot bring code.** An own entry names an evaluator of the machine (EVAL.OWN, LADDER.OWN-ONLY). Thus a document cannot extend its own language. With sealed parts (D7), this keeps the equations that a fexpr destroys.
6. **The playground ignores most of the contract.** It has fixed editors for `number`, `text`, `ref` and `bool`, and "Add a part" only for a list shape. Its kind menu lists each kind of the world at each position, and it does not read SHAPE.KINDS.

### Where coeval sits

coeval is nearest to MPS in its model and to Racket in its aim. As in MPS, the tree is the source, and each concept carries aspects. As in Racket, many languages share one core and change it through named interposition points. Unlike both, a program is JSON, and the core is a library of kinds with no metalanguage.

Among data languages, coeval is near JsonLogic in form and far from Dhall in its guarantees. The totality of coeval is a totality of results: each evaluation gives a value or an error value (VALUE.THROW, VALUE.DEPTH). `fn` and `call` can recurse, and only the stack limit of the host stops them (R1, open question 3).

### What the ladder borrows, and what it answers

Each rung has a known ancestor. The own rung is a method of one object, as in the prototypes of [Self](https://doi.org/10.1145/38765.38828). The kind rung is a method of a class, a protocol for a type, or an algebra for one functor. The default rung is the default method of a generic function, or `#%app` of Racket.

The ladder adds two rules. It reads names only (D2), as Lisp reads a head symbol. An evaluator cannot read the syntax of a part (D7), and this answers the result of Wand. The ladder lacks an external method table: a verb for a foreign kind lives inside the record of that kind (P4).

### The two dimensions of extension

| Dimension | How a language does it | Cost today | What happens without it |
| --- | --- | --- | --- |
| A new kind | One world entry and one evaluator | Low | Each verb without an entry or a default gives `#NOEVAL` or no answer |
| A new verb, generic | One default in `World.defaults` that reads the contract | Low for `view`, high for other verbs (fact 2) | Nothing: the default answers for each kind |
| A new verb, for each kind | One entry in each kind | High: the kinds of another language change | A kind without the entry falls to the default |
| One verb for one document | An own entry | Low | Nothing |

### The composition checklist

| Mode | Meaning in coeval | Today | Test ID |
| --- | --- | --- | --- |
| Extension | A language adds kinds to the formula kit | `formulaMachine(profile, more)` | COMPOSE.EXTEND |
| Restriction | Fewer kinds in a world or at a position, fewer capabilities for a part | SHAPE.KINDS, `mask`, `only` | COMPOSE.RESTRICT |
| Unification | Two worlds in one machine, with aliases and declared types as glue | No merge function | COMPOSE.UNIFY |
| Self-extension | A document adds kinds | Closed (fact 5) | COMPOSE.NO-SELF |
| Incremental extension | A language extends an extension, and reaches the entry that it replaces | No `prev` | COMPOSE.INCREMENTAL |
| Extension unification | Two extensions of one kit merge without glue | Silent loss (fact 4) | COMPOSE.CONFLICT |

## Proposals ranked by value for effort

Effort S is one pull request of a day or less. Effort M is a few days. Effort L is a week or more.

| Rank | Proposal | Effort | Value |
| --- | --- | --- | --- |
| P1 | The composition checklist as spec tests | S | High: it shows facts 4 and 5 |
| P2 | One merge function with conflict rules | S to M | High: it removes silent loss |
| P3 | Each verb through the kernel | M | High: a new verb becomes as cheap as a new kind |
| P4 | Verb entries for the kinds of another language | S, after P2 and P3 | Medium to high |
| P5 | A check of verb coverage | S, after P3 | Medium |
| P6 | A structured editor from the contracts, with holes | M | High for the site |
| P7 | A language package format | M | Medium to high, after P2 |
| P8 | A boundary kind for a part in another language | M to L | Low today |

### P1: the composition checklist as spec tests

- **What.** One test file gives one test for each row of the checklist. The tests use two small languages of the examples.
- **Parts.** `SPEC.md` gets a section "Composition", and a new test file. No source file changes.
- **Risk.** COMPOSE.CONFLICT and COMPOSE.INCREMENTAL record the current behavior first. P2 then changes them.
- **Test.** COMPOSE.EXTEND, COMPOSE.RESTRICT, COMPOSE.UNIFY, COMPOSE.NO-SELF (an own entry with an unknown evaluator gives `#NOEVAL`), COMPOSE.INCREMENTAL and COMPOSE.CONFLICT.

### P2: one merge function with conflict rules

- **What.** `mergeWorlds` and `mergeMachines` replace each spread. The rules come from CUE and Julia:
  1. Two equal entries at one path give one entry. The contracts are equal by `docEquals`, and the evaluator names are the same.
  2. Two namespaces merge key by key. Two different fallbacks of one namespace are a conflict.
  3. Two different kinds at one path are a conflict, with the two sources. An entry with an explicit `replaces` wins, and its evaluator can use the entry before it (`prev`, as in Nix).
  4. Two different functions with one evaluator name are a conflict.
  5. The world keeps one fallback. Two different fallbacks are a conflict.
- **Parts.** `world.ts`, and `formulaMachine` in `formula.ts`. A conflict is an error when the machine is built, not an error value of an evaluation.
- **Risk.** A language that relies on a silent replacement breaks. One `replaces` mark repairs it. Before 1.0.0, this breaking change raises the MINOR version.
- **Test.** COMPOSE.CONFLICT, and a property test: without `replaces`, a merge is commutative, associative and idempotent.

### P3: each verb through the kernel

- **What.** `prepare(machine, doc, { verb })` and `check(machine, doc, { verb })` take a verb, and `eval` stays the default. One function gives the ladder of each verb. `deref` gets the default rung `World.defaults.deref`, and the standard world gives `plainStep` there. `step` gets the own rung and the default rung.
- **Parts.** `evaluate.ts` (`evaluatorOf`, `compileNode`), `static.ts` (`check`), `deref.ts` (`derefStep`) and `Machine`. The tables `evaluators`, `derefs` and `walkers` can stay, with one map from a verb to its table.
- **Demonstration.** A verb `format` writes a short text of a document. Its default reads the contract and writes `kind(part, part)`. `ref` gives `names.x`, and `ops.add` gives an infix form. The site shows the text beside the JSON.
- **Risk.** `deref` and `step` are hot paths (R1 P2). The ladder of each verb resolves at compile time, thus the cost stays in `prepare`.
- **Test.** LADDER.VERB (each verb visits the same three rungs), PLAN.VERB (a plan of `format` equals its traced evaluation) and STATIC.VERB (`check` with a verb finds `#NOEVAL` for that verb).

### P4: verb entries for the kinds of another language

- **What.** A language gives `extends: { [kindPath]: { [verb]: evaluator } }`. The merge of P2 adds each entry to the kind, with the same conflict rules. The rule against piracy: a language adds a verb to a foreign kind only for a verb that it owns.
- **Why.** A language that adds `format` or `type` to the formula kit does not copy its kinds. This is `extend-protocol` of Clojure, with the orphan rule of Haskell.
- **Parts.** The merge of P2. The ladder does not change.
- **Risk.** The owner of a verb is a new idea. P7 declares it.
- **Test.** COMPOSE.EXTEND-VERB, and COMPOSE.PIRACY (an entry for a foreign verb on a foreign kind is a conflict).

### P5: a check of verb coverage

- **What.** A language declares the verbs that each of its kinds must answer, for example `eval`, `view` and `type`. `checkWorld(machine, verbs)` lists each kind with no entry and no default for one of these verbs.
- **Why.** The static answers to the expression problem prove coverage with types. This check gives one world the same proof, before a document exists. Silver checks each extension alone in a similar way ([Kaminski and Van Wyk 2012](https://doi.org/10.1007/978-3-642-36089-3_20), cited in R3).
- **Parts.** `static.ts`. The check reads only the world.
- **Test.** STATIC.COVERAGE: a kind with no `view` entry, in a world with no `view` default, is in the list.

### P6: a structured editor from the contracts, with holes

- **What.** The playground reads the contract of each position, not fixed kind names:
  - A record shape gives one editor for each named field, and it marks the fields in `required`.
  - A data shape gives an input: a text, a number with its limits, or a menu for `one`.
  - A term position lists only the kinds that SHAPE.KINDS permits.
  - A reference editor lists the names that `walk` sees at its place.
  - An empty position holds a document of a kind `hole`. Its evaluation gives an error value with its place, thus each state of an edit evaluates, as in Hazelnut.
  - The verb `view` draws each card, as today (D8). The verb `format` of P3 gives the text form.
- **Why this step.** A full projectional editor costs too much for a site. A text syntax of coeval goes against D13. The contracts already hold each fact that a structured editor uses.
- **Parts.** `Playground.tsx` and `edit.ts` in the site, and a kind `hole` in the world of the site. The kernel does not change.
- **Risk.** The usability costs of projectional editors (Voelter and others 2014). The editor keeps "Edit the JSON" as a second form.
- **Test.** Site tests. Each kind of the site world gets an editor from its contract alone. A hole evaluates to an error value with its place.

### P7: a language package format

- **What.** `defineLanguage({ name, version, owns, verbs, requires, world, code, profile })` gives one value. The data half (`world`, `owns`, `verbs` and `requires`) is JSON. The code half binds evaluators by name. The identity of a language is its name, its version and a hash of the canonical JSON of its data half. Dhall pins an import by its normal form in the same way.
- **Composition.** `compose(...languages)` gives a machine through the merge of P2. It checks `requires` against the versions.
- **Parts.** A new module `language.ts`, or a new package. Each of the four languages exports one value.
- **Risk.** A format can freeze too early. It starts as a function with tests, not as a JSON Schema.
- **Test.** LANG.HASH (two equal data halves give one hash), LANG.REQUIRES and LANG.COMPOSE.

### P8: a boundary kind for a part in another language

- **What.** A kind `lang` holds the name of a language and a document in it. Its evaluator prepares the document with the machine of that language. This is the module boundary of Racket.
- **Risk.** Capabilities, effects and `check` cross the boundary, thus the static kit changes worlds there. The four languages do not need it today.
- **Test.** COMPOSE.BOUNDARY, after a decision of the owner.

## What coeval does not try to be

- **Not a workbench.** coeval has no grammar formalism, parser generator or metalanguage. Each language keeps its text syntax (D13).
- **Not an IDE.** The editor of P6 teaches the model and changes small documents. MPS shows the cost of a full projectional editor.
- **Not a language that extends itself.** A document does not bring the code of an evaluator. A new kind comes from a language that a host loads.
- **Not a macro system.** An evaluator does not read the syntax of its parts (D7). A rewrite is a function of the static kit or a forwarded tree (R3 P9).
- **Not total by construction.** Termination needs types or no recursion, as Dhall shows. coeval promises a result: an overflow of the stack gives `#DEPTH!`.
- **Not a unification language.** The rules of CUE apply to the merge of worlds only, not to the values of documents.
- **Not a package manager.** A language value carries a version and a hash. npm keeps and fetches the code.

## Open questions

1. **Base kinds.** MPS, CLOS and the hierarchies of Clojure have inheritance. Does a kind get a base kind as one more named rung, or do aliases and forwarding (R3 P9) cover the need?
2. **One ladder.** Is the different ladder of `deref` and `step` (fact 3) a decision, or a gap that P3 closes?
3. **Evaluator names.** Does each language qualify its evaluator names, or does the merge of P2 find each collision?
4. **The name of a language.** Does a document name its language? A header field changes D6, and a boundary kind (P8) does not.
5. **The form of a conflict.** Is a conflict of P2 a thrown error, or a list of issues, as `check` gives?
6. **Self-extension.** D1 says that an evaluator can be a document. Can a document then carry kinds with document evaluators, under a capability?
7. **The home of P7.** Does the package format live in the kernel, or in a separate package?

## Sources

- Berger, T., Völter, M., Jensen, H. P., Dangprasert, T. and Siegmund, J. (2016). ["Efficiency of projectional editing: a controlled experiment"](https://doi.org/10.1145/2950290.2950315). FSE 2016, 763–774.
- Bezanson, J., Edelman, A., Karpinski, S. and Shah, V. B. (2017). ["Julia: a fresh approach to numerical computing"](https://doi.org/10.1137/141000671). SIAM Review 59(1), 65–98.
- Carette, J., Kiselyov, O. and Shan, C. (2009). ["Finally tagless, partially evaluated"](https://doi.org/10.1017/S0956796809007205). "Journal of Functional Programming" 19(5), 509–543.
- Clifton, C., Leavens, G. T., Chambers, C. and Millstein, T. (2000). ["MultiJava: modular open classes and symmetric multiple dispatch for Java"](https://doi.org/10.1145/353171.353181). OOPSLA 2000.
- Clojure documentation. ["Protocols"](https://clojure.org/reference/protocols) and ["Multimethods and hierarchies"](https://clojure.org/reference/multimethods).
- Common Lisp HyperSpec. ["Chapter 7: Objects"](https://www.lispworks.com/documentation/HyperSpec/Body/07_.htm).
- CUE documentation. ["The logic of CUE"](https://cuelang.org/docs/concept/the-logic-of-cue/).
- Dhall documentation. ["Safety guarantees"](https://docs.dhall-lang.org/discussions/Safety-guarantees.html).
- Erdweg, S., Giarrusso, P. G. and Rendel, T. (2012). ["Language composition untangled"](https://doi.org/10.1145/2427048.2427055). LDTA 2012.
- Erdweg, S., Rendel, T., Kästner, C. and Ostermann, K. (2011). ["SugarJ: library-based syntactic language extensibility"](https://doi.org/10.1145/2048066.2048099). OOPSLA 2011.
- Erdweg, S., van der Storm, T., Völter, M. and others (2013). ["The state of the art in language workbenches"](https://doi.org/10.1007/978-3-319-02654-1_11). SLE 2013, LNCS 8225, 197–217.
- Erdweg, S., van der Storm, T., Völter, M. and others (2015). ["Evaluating and comparing language workbenches"](https://doi.org/10.1016/j.cl.2015.08.007). "Computer Languages, Systems and Structures" 44, 24–47.
- Eysholdt, M. and Behrens, H. (2010). ["Xtext: implement your language faster than the quick and dirty way"](https://doi.org/10.1145/1869542.1869625). SPLASH 2010 companion, 307–309.
- Felleisen, M., Findler, R. B., Flatt, M., Krishnamurthi, S., Barzilay, E., McCarthy, J. and Tobin-Hochstadt, S. (2018). ["A programmable programming language"](https://doi.org/10.1145/3127323). "Communications of the ACM" 61(3), 62–71.
- Fowler, M. (2005). ["Language workbenches: the killer-app for domain specific languages?"](https://martinfowler.com/articles/languageWorkbench.html).
- Haskell wiki. ["Orphan instance"](https://wiki.haskell.org/Orphan_instance).
- Julia documentation. ["Style guide: avoid type piracy"](https://docs.julialang.org/en/v1/manual/style-guide/#avoid-type-piracy).
- JsonLogic documentation. [jsonlogic.com](https://jsonlogic.com/).
- Jsonnet. ["Specification"](https://jsonnet.org/ref/spec.html).
- Kaminski, T. and Van Wyk, E. (2012). ["Modular well-definedness analysis for attribute grammars"](https://doi.org/10.1007/978-3-642-36089-3_20). SLE 2012.
- Kats, L. C. L. and Visser, E. (2010). ["The Spoofax language workbench"](https://doi.org/10.1145/1869459.1869497). OOPSLA 2010.
- Klint, P., van der Storm, T. and Vinju, J. (2009). ["Rascal: a domain specific language for source code analysis and manipulation"](https://doi.org/10.1109/SCAM.2009.28). SCAM 2009, 168–177.
- McCarthy, J. (1960). ["Recursive functions of symbolic expressions and their computation by machine"](https://doi.org/10.1145/367177.367199), the first of two parts. "Communications of the ACM" 3(4), 184–195.
- MPS documentation. ["Basic notions"](https://www.jetbrains.com/help/mps/basic-notions.html) and ["Structure"](https://www.jetbrains.com/help/mps/structure.html).
- Nixpkgs manual. ["Overlays"](https://nixos.org/manual/nixpkgs/stable/#chap-overlays).
- Oliveira, B. C. d. S. and Cook, W. R. (2012). ["Extensibility for the masses: practical extensibility with object algebras"](https://doi.org/10.1007/978-3-642-31057-7_2). ECOOP 2012, LNCS 7313, 2–27.
- Omar, C. and others (2017). ["Hazelnut: a bidirectionally typed structure editor calculus"](https://doi.org/10.1145/3009837.3009900). POPL 2017.
- Racket documentation. ["Module languages"](https://docs.racket-lang.org/guide/module-languages.html).
- Schwerdfeger, A. C. and Van Wyk, E. R. (2009). ["Verifiable composition of deterministic grammars"](https://doi.org/10.1145/1542476.1542499). PLDI 2009.
- Swierstra, W. (2008). ["Data types à la carte"](https://doi.org/10.1017/S0956796808006758). "Journal of Functional Programming" 18(4), 423–436.
- Teitelbaum, T. and Reps, T. (1981). ["The Cornell Program Synthesizer: a syntax-directed programming environment"](https://doi.org/10.1145/358746.358755). "Communications of the ACM" 24(9), 563–573.
- Tobin-Hochstadt, S., St-Amour, V., Culpepper, R., Flatt, M. and Felleisen, M. (2011). ["Languages as libraries"](https://doi.org/10.1145/1993498.1993514). PLDI 2011.
- van Antwerpen, H., Bach Poulsen, C., Rouvoet, A. and Visser, E. (2018). ["Scopes as types"](https://doi.org/10.1145/3276484). OOPSLA 2018.
- Visser, E. (2001). ["Stratego: a language for program transformation based on rewriting strategies"](https://doi.org/10.1007/3-540-45127-7_27). RTA 2001.
- Visser, E., Wachsmuth, G., Tolmach, A. and others (2014). ["A language designer's workbench"](https://doi.org/10.1145/2661136.2661149). Onward! 2014.
- Voelter, M., Siegmund, J., Berger, T. and Kolb, B. (2014). ["Towards user-friendly projectional editors"](https://doi.org/10.1007/978-3-319-11245-9_3). SLE 2014, LNCS 8706, 41–61.
- Ungar, D. and Smith, R. B. (1987). ["Self: the power of simplicity"](https://doi.org/10.1145/38765.38828). OOPSLA 1987.
- Wadler, P. (1998). ["The expression problem"](https://homepages.inf.ed.ac.uk/wadler/papers/expression/expression.txt). A message to the Java Genericity mailing list.
- Wand, M. (1998). ["The theory of fexprs is trivial"](https://doi.org/10.1023/A:1007720632734). "Lisp and Symbolic Computation" 10(3), 189–199.
