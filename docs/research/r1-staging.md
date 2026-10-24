# R1: staging and partial evaluation

This file is a research study for the kernel. It changes no rule. The coeval session decides which proposals go into `docs/ROADMAP.md` and `docs/DECISIONS.md`.

## The question

A plan changes a document into closures one time (PLAN.ONCE). This is a first step in the direction of Futamura: the kernel is an interpreter, and `prepare` specializes it to one document. This study asks what the theory says about the next steps, and what coeval does about them.

## The findings in short

1. `prepare` is a first Futamura projection, written by hand. Each `compile` function is a generating extension, and the types `CompileInput` and `Code` fix the binding times. The kernel needs no automatic partial evaluator.
2. A plan still pays a cost for each node: two closure calls, one `Result` object, and a generic resolution for each reference. V8 cannot remove it, because the closures of one creation site share their type feedback.
3. Two cheap gains are in the kernel. A reference can compile its static path. A closed and pure subtree can fold into a constant, and EVAL.SEALED (D7) already gives the license for this.
4. Only a tier of generated JavaScript removes the cost for each node. It is large work with strict preconditions.
5. A harness that proves one meaning comes first. The traced plan and the plan share each compiler, thus a comparison of the two cannot find a bug in a compiler.

## Background

### Partial evaluation and the Futamura projections

A partial evaluator (a specializer) takes a program and its static input. It gives a residual program that takes the dynamic input and gives the same output as the original program. Futamura described three projections in 1971 (["Partial Evaluation of Computation Process"](https://doi.org/10.1023/A:1010095604496), reprinted in 1999). An interpreter, specialized to a source program, gives a target program. The specializer, specialized to the interpreter, gives a compiler. The specializer, specialized to itself, gives a compiler generator.

Jones, Gomard and Sestoft give the full theory in ["Partial Evaluation and Automatic Program Generation"](https://raspi.itu.dk/people/sestoft/pebook/pebook.html) (1993, free online). Three of its ideas apply to coeval:

- A generating extension of a program `p` takes the static input of `p` and gives the residual program. A compiler is the generating extension of an interpreter, and a person can write one by hand.
- An optimal specializer removes all the cost of interpretation: a self-interpreter, specialized to `p`, is as fast as `p`. Later work names this property Jones-optimality. The tags of a typed interpreter are its main obstacle (["Tag Elimination and Jones-Optimality"](https://doi.org/10.1007/3-540-44978-7_15), 2001).
- A partially static structure has a static shape and dynamic contents, for example an environment with known names and unknown values.

### Binding-time analysis, online and offline

A binding-time analysis (BTA) marks each expression as static or dynamic before the specialization. An offline specializer obeys these marks and does not look at the static values. It is fast and predictable. An online specializer decides at each step from the real static values. It finds more static work, but it is slower, and its end is harder to prove.

A binding-time improvement changes a program so that more of it is static. In "The Trick", a dynamic value with only a few possible static values gets a case split, and each branch becomes static ([Danvy, Malmkjær and Palsberg](https://www.brics.dk/RS/96/17/), 1996). An inline cache is The Trick at run time.

### Multi-stage programming

Multi-stage programming puts the binding times into the program text. MetaML has brackets that make a code value, an escape that splices one, `run` and lift ([Taha and Sheard](https://doi.org/10.1016/S0304-3975(00)00053-0), 2000, and [the thesis of Taha](https://www.cs.tufts.edu/~nr/cs257/archive/walid-taha/thesis.pdf)). [BER MetaOCaml](https://okmij.org/ftp/ML/MetaOCaml.html) continues this work in OCaml ([Kiselyov](https://doi.org/10.1007/978-3-319-07151-0_6), 2014). A program can splice a code value, but it cannot look inside it. The generated code is hygienic: a splice does not capture a name of the code around it.

Lightweight Modular Staging (LMS) puts the binding time into the type: `Rep[T]` is a value of the next stage ([Rompf and Odersky](https://doi.org/10.1145/1942788.1868314), 2010). Tahboub, Essertel and Rompf write a query engine as an interpreter and stage it with LMS. The result competes with the best query compilers on TPC-H ([SIGMOD 2018](https://www.cs.purdue.edu/homes/rompf/papers/tahboub-sigmod18.pdf)).

Carette, Kiselyov and Shan write each construct of a language one time, against an abstract interface (["Finally tagless, partially evaluated"](https://www.cas.mcmaster.ca/~carette/publications/jfp.pdf), 2009). Different implementations of the interface give an evaluator, a compiler and a partial evaluator.

### Closure generation

Feeley and Lapalme compile each node of a Scheme program into a closure of the host (["Using closures for code generation"](https://ftp.math.utah.edu/pub/tex/bib/idx/complngs/12/1/47_66.html), 1987). The closure does the work of the node and starts the closures of its children. The analysis of a node happens one time. This is the technique of `prepare`. Its cost is one indirect call for each node in each evaluation.

### Self-specializing interpreters: Truffle and Graal

Truffle is an interpreter of syntax trees whose nodes rewrite themselves from the types that they see ([Würthinger and others, 2012](https://doi.org/10.1145/2384577.2384587)). A node starts uninitialized, changes to a specialized node at its first evaluation, and changes to a generic node when a guard fails. The Truffle DSL generates this state machine from annotations ([Humer and others, 2014](https://research.jku.at/en/publications/a-domain-specific-language-for-building-self-optimizing-ast-inter/)).

Graal partially evaluates the interpreter with the tree as a constant, and inlines the `execute` methods of the nodes into one unit ([One VM to Rule Them All](https://lafo.ssw.uni-linz.ac.at/pub/papers/2013_Onward_OneVMToRuleThemAll.pdf), 2013). When a guess fails, the code goes back to the interpreter, the tree changes, and Graal compiles again ([PLDI 2017](https://doi.org/10.1145/3062341.3062381)). This is the first Futamura projection at run time, with profile data. The PLDI paper reports JavaScript at 0.83 times the speed of V8, and Ruby at 3.8 times JRuby.

Meta-tracing (RPython) gives a similar speed with fewer changes to the interpreter ([Marr and Ducasse](https://stefan-marr.de/papers/oopsla-marr-ducasse-meta-tracing-vs-partial-evaluation/), 2015). Type feedback started with polymorphic inline caches ([Hölzle, Chambers and Ungar](https://bibliography.selflanguage.org/pics.html), 1991).

### Supercompilation

A supercompiler drives a program with symbolic values ([Turchin](https://doi.org/10.1145/5956.5957), 1986). It carries the information of a test into each branch, folds a configuration that comes again, and generalizes to stop. It is stronger than partial evaluation, but its end needs a check of growth, and the size of its output is hard to predict. A formula of coeval is small and total, thus the gain is small. One case is useful: a path into a `record` literal can read the field at compile time.

### Plans in query engines

Volcano evaluates a query plan with iterators: each operator gives the next tuple when its parent asks ([Graefe](https://15721.courses.cs.cmu.edu/spring2016/papers/graefe-ieee1994.pdf), 1994). The cost is one virtual call for each operator and each tuple. MonetDB/X100 moves a vector of tuples at each call, thus a batch shares the cost ([Boncz, Zukowski and Nes](https://ir.cwi.nl/pub/16497/), 2005). HyPer compiles each pipeline into one loop with LLVM, with the values in registers ([Neumann](https://www.vldb.org/pvldb/vol4/p539-neumann.pdf), 2011).

Compiled code needs fewer instructions, and vectors hide the latency of memory better ([Kersten and others](https://doi.org/10.14778/3275366.3275370), 2018). Kohn, Leis and Neumann start each query in an interpreter, and change to compiled code only when the change pays ([ICDE 2018](https://db.in.tum.de/~leis/papers/adaptiveexecution.pdf)). Many queries are too short to pay for a compilation.

For coeval, a plan is a Volcano plan for one value, and a context is a tuple. A language that evaluates one formula at each position of a space evaluates one plan for many tuples.

## How coeval relates today

| Idea | coeval today | Where |
| --- | --- | --- |
| The interpreter | The traced plan: `evaluate` compiles with `trace: true` and records each node | `evaluate.ts` (`evaluate`, `finish`), PLAN.TRACE |
| The specializer | `prepare`: the ladder, the kinds, the split of the parts and the depth limit, one time | `compileNode`, PLAN.ONCE, PLAN.COMPILE-SPEED |
| Generating extensions by hand | Each `CompiledEvaluator.compile`, one for each construct of the formula kit | `formula.ts`, L4, D13 |
| A trivial generating extension | `interpret` wraps an `EvalFn`, and builds the sealed parts at each evaluation | `interpret` |
| Binding times | Static: the document, the world, the machine and the profile (`CompileInput`). Dynamic: `ctx` and `rt` (`Code`) | `evaluate.ts` |
| A code value that cannot be opened | A sealed part: `CompiledPart` has a key, a path, a name and code, but no value | D7, K7, EVAL.SEALED |
| Closure generation | Each node is a closure, and a plan keeps only its closures | PLAN.LEAN |
| Specialization on static data | `formula.op` selects its code by the count of arguments and by `combine` | `formula.ts` |
| A partial resolution | `resolveQuick`: a fast path for a path of keys without hops | `deref.ts`, DEREF.QUICK |
| A second tier | A language keeps its own compiler, with the plan as its reference | D13 |

The plan of a small formula takes approximately 22 ns for each node. For each node, it still pays for these items:

- Two closure calls: the code from `placedCode`, which catches an exception and places an error, and the code of the evaluator.
- One `Result` object, also when the parent reads only the value.
- For a reference: `Session.resolve`, `resolve` and `resolveQuick`. At each evaluation, the fast path examines the root, the open roots, `adopt` and the type of each step. But the path and the navigator are static.
- For a step on an envelope: a `lookupKind` at evaluation time, though the world does not change after `prepare`.
- For `let` and `fn`: a copy of the record of the names at each evaluation or application.

V8 does not remove these costs. The [V8 document on function architecture](https://chromium.googlesource.com/v8/v8.git/+/main/docs/runtime/function-architecture.md) says that closures can share a feedback cell, with one cell for each creation site in the outer function. Thus all two-argument `formula.op` nodes of one machine share the call sites `a.code(ctx, rt)` and `fn(x.value, y.value)`. These sites see many targets, and V8 does not inline them.

There is also a problem of the oracle. `evaluate` is `prepare` with a trace, thus the traced plan and the plan differ only in `finish` and in the ladder (`ask` against `evaluatorOf`). A test that compares them cannot find a bug in a compiler. Today the tests of the spec IDs are the only oracle of a compiler.

## What must stay true

A tier is the traced plan, the plan, a plan with folds, a generated tier, or the second tier of a language. Each tier gives one meaning:

1. The same value. The comparison is structural, and each leaf compares with `Object.is`.
2. The same error: code, place and reason.
3. The same effects, in the same order, with the same kind, payload and place. In a run, `perform` sees the same sequence.
4. The same laziness: a part that the reference does not evaluate stays unevaluated (EVAL.LAZY-IF, FORMULA.LOGIC, FORMULA.LAZY).
5. The same order of the parts, thus the same first error (FORMULA.OPS, FORMULA.LIST).
6. Totality: no tier throws out of `evaluate` (VALUE.THROW). A closure of `fn` keeps the `Failure` protocol.
7. The same limits: PLAN.DEPTH gives the same `#DEPTH!` at the same place. An overflow of the host stack (VALUE.DEPTH) is the one permitted difference, because the tiers use different numbers of frames.
8. Stable repetition: the first and the hundredth evaluation agree, also when the types in the context change between them.
9. Identity is not part of the meaning. Today `lit` gives the same object at each evaluation, and `record` gives a new one. A spec rule must say this.

### The design of a property test

- **The oracle.** A definitional interpreter of the formula kit, for tests only: one `EvalFn` for each construct, in the most direct style ([Reynolds](https://doi.org/10.1023/A:1010027404223), 1972). It shares no compiler with the plan.
- **The documents.** A generator reads the kind contracts. At a `term` position, it selects a kind that SHAPE.KINDS permits, or a literal. It reads the scope rules to select a name in scope for each `ref`. A depth budget and a size budget stop the growth.
- **The contexts.** The names hold hard values: `NaN`, `-0`, `undefined` and a record with the key `__proto__`. They also hold an envelope, a reference document, a cycle, and host things with and without `resolve`.
- **The profiles.** Each combination of `truthy`, `logic`, `combine`, `omit` and `missing`, with an operation that throws, one that counts its calls, and one lazy operation.
- **Metamorphic checks.** EVAL.SEALED: a part changes to a `lit` of its JSON result, and the parent gives the same result. STATIC.AGREES: a document that checks gives none of the errors that `check` finds.
- **Reproduction.** The generator has a seed, and a failure shows its seed and its document. The shrink step changes a subtree to a literal, which EVAL.SEALED makes legal. The library [fast-check](https://fast-check.dev/) can do this work.
- **Speed.** A CI job (`workflow_dispatch`) compares each tier with a hand-written JavaScript function for the same formula. The ratio is the distance from Jones-optimality.

## Proposals, ranked by value for effort

| Rank | Proposal | Effort | Value |
| --- | --- | --- | --- |
| P1 | A harness for one meaning | M | High: each other proposal and each second tier of a language depends on it |
| P2 | Compiled paths and a memo of the deref ladder | S | Medium to high: references are the most frequent node |
| P3 | Folds of closed pure subtrees | S to M | Medium, and high for documents with much data |
| P4 | Binding times that the host declares | M | Medium, for a host with a stable registry |
| P5 | A tier of generated JavaScript for hot pure regions | L | High for hot plans, low for plans that evaluate a few times |
| P6 | Nodes that specialize themselves | M | Low alone, and the profile data for P5 |
| P7 | One plan at many positions | L | High for a language over positions, later |

### P1: a harness for one meaning

- **What.** The definitional interpreter, the generator and the comparison of the test design above. The kernel exports `agree`, so that a language can test its second tier against the plan (D13).
- **Kernel parts.** A new module `agree.ts` and new spec IDs: PLAN.AGREE for the rules of one meaning, PLAN.SHARED for identity.
- **Risk.** A weak generator gives false confidence. The harness counts how many times it reaches each kind and each option of the profile.
- **Test.** A mutant tier that changes the order of two parts fails the harness.

### P2: compiled paths and a memo of the deref ladder

- **What.** `compilePath(nav, path)` in `deref.ts` gives a resolver for one static path and one static navigator: `resolveQuick`, partially evaluated by hand. It reads the root one time. Then it examines only the dynamic conditions: an object, not a reference, not an envelope, an own key, or a host thing. Each other case goes to `resolve`.
- **More in the same change.** `derefStep` keeps a memo of `lookupKind` for each world and type. A compiler can mark its code as total, and then `compileNode` does not wrap it in `placedCode`. The kit marks only `lit`, which halves the calls of a literal.
- **Kernel parts.** `deref.ts`, `compileNode`, `formula.ref` and `formula.lit`.
- **Risk.** The fast path and `resolve` can disagree at an edge of DEREF.CODES. Examples are a missing field, a field with the value `undefined`, the field `length` of a list and an index as a text. Thus `compilePath` and `resolveQuick` come from one step function.
- **Test.** A property test of `compilePath(nav, path)(ctx)` against `resolve(nav, ctx, path, { hops: false })`, with random paths, values and navigators (`plain`, `roots`, `adopt`).

### P3: folds of closed pure subtrees

- **What.** In a plan without a trace, a static subtree evaluates one time at compile time, and its code becomes a constant. A subtree is static when each of its kinds is pure and it has no free reference (STATIC.REFS).
- **Why it is legal.** EVAL.SEALED says that two parts with the same result can replace each other. A constant part is such a replacement.
- **The declaration.** The kernel cannot know that an evaluator is pure, thus the contract of a kind declares it. With `pure: true`, the evaluator reads only its parts and its data, and it causes no effect. The same results of its parts give the same result. The formula kit marks `lit`, `record`, `list`, `if`, `and`, `or` and `let`. A profile names its pure operations, and the default is none.
- **What does not fold.** `ref` reads the context. The closure of `fn` keeps the runtime of the evaluation that made it. `ext` gets the context (FORMULA.EXT-CONTEXT).
- **A safety net.** The fold uses an empty context and a probe runtime. The probe resolves the names that the subtree binds, and it refuses each other root and each effect. A refusal or a result `#DEPTH!` cancels the fold.
- **Gain.** A record of 20 literal fields makes 20 closure calls, 20 `Result` objects and one record at each evaluation. After the fold, it costs one call. The defs of a user interface and the output of a text syntax have many such records.
- **Kernel parts.** `Kind` in `world.ts`, `compileNode`, `formula.ts`, and SPEC (PLAN.FOLD, PLAN.SHARED). The analysis stops at the first kind that is not pure, thus PLAN.COMPILE-SPEED stays true.
- **Risk.** A folded record is one object for all evaluations, thus a host that changes a result sees the change later. The kernel freezes each folded value, or PLAN.SHARED forbids the change. A wrong mark (an operation that reads the clock) is a second risk.
- **Test.** P1 with folds on and off. An operation that counts its calls shows that an impure operation does not fold.

### P4: binding times that the host declares

- **What.** An option of `prepare` names the roots that stay the same for the life of the plan. Examples are `names` of a configuration and `world` of a registry. A path from such a root resolves at compile time.
- **The profile and the kinds.** These are static today: a machine captures its profile, and `prepare` asks the ladder.
- **Precondition.** The host keeps its promise, or it discards the plan. For a store that changes, the planner needs the dependencies of each plan, which is the graph of the data of S1 (D3). Truffle uses assumptions for the same purpose.
- **Kernel parts.** `PrepareOptions`, `CompileInput`, `deref.ts` and `planner`.
- **Risk.** A stale plan gives an old value without an error. **Test.** A test changes a fixed root and expects the planner to compile again.

### P5: a tier of generated JavaScript for hot pure regions

- **What.** A kind can give `emit` beside `compile`. The kernel joins a region of nodes with `emit` into one function with `new Function`. The planner changes a plan to this tier after a count of evaluations, as in adaptive execution.
- **One definition for two tiers.** The formula kit writes each construct one time against a small code interface, in the tagless style. One implementation gives closures, and the other gives source. Thus the tiers cannot drift apart construct by construct.
- **Sealed parts (D7).** `emit` gets each part as an opaque hole, through a tagged template. It can splice a part, but it cannot read the source of the part, as with a code value of MetaOCaml.
- **Data stays out of the source.** Each value of the document and each operation goes into an array of constants (`k[3]`), and only the kernel writes names. This stops code injection from a document and keeps the code hygienic.
- **Errors.** Before each call to host code, a region writes the place of the node into one variable. One `try` and `catch` for each region converts an exception with `thrown`, thus a `Failure` stays its error value.
- **Laziness.** `if`, `and`, `or` and lazy operations become control flow, and the parts keep their order.
- **Size.** Node 24 optimizes a function only up to 61440 bytes of bytecode, and inlines one only up to 460 bytes (`--max-optimized-bytecode-size`, `--max-inlined-bytecode-size`). A node budget splits a large region, as the inlining budget of Truffle does.
- **Limits.** PLAN.DEPTH stays the limit. A traced plan does not use this tier. A [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src) without `'unsafe-eval'` refuses `new Function`, thus the kernel tests it one time and keeps the closures.
- **Why it pays.** Each generated function has its own call sites. A call of an operation sees one target, thus V8 can inline it, keep values in registers and remove most `Result` objects.
- **Kernel parts.** `CompiledEvaluator`, the planner, a new module `emit.ts`, and `formula.ts`. The planner keeps the document as a key, thus the change of tier compiles from the document, and PLAN.LEAN stays true.
- **Risk.** Drift, security, stack traces (a `//# sourceURL` comment names each region), and memory. A reactive language compiles at each write, and most of its plans are too short to pay for this tier.
- **Test.** P1 for each shape of region. First, a CI benchmark measures a prototype for `lit`, `ref`, `op` and `if`. The work continues only for a large gain.

### P6: nodes that specialize themselves

- **What.** A compiled node keeps a small state (uninitialized, one shape, generic), as in the Truffle DSL. A `ref` node remembers that its root value is a plain record, or a host thing with `resolve`.
- **Value.** Alone, the value is low, because V8 collects type feedback and P2 removes most generic work. The real value is profile data for P5: the types that a node saw select the guards of the generated code.
- **Risk.** A state that changes a result (rule 8). **Test.** P1 with contexts whose types change between evaluations.

### P7: one plan at many positions

- **What.** `plan.evaluateEach(contexts)`, with an optional batched compiler in the style of X100: each node works on a vector of contexts, and `if` uses a selection vector. With P5, the batch can instead be one generated loop, in the style of HyPer.
- **Why later.** D13 already lets a language over positions keep its own compiler to loops, and P1 gives that language its test. The kernel adds a batch only after a language asks.

## Open questions

1. Does the kernel promise a new object at each evaluation, or does it permit shared results (PLAN.SHARED)? P3 and P5 depend on the answer.
2. Is `pure` a field of the contract of a kind (K2), or a property of its evaluator? A kind with an `EvalFn` of the host cannot prove it.
3. PLAN.DEPTH limits the nesting. But a recursion of `fn` through `call` meets only the host stack, thus its `#DEPTH!` differs between tiers. Does `call` get a counter of depth?
4. Lexical addresses for `names` (a frame with slots in place of a copy of a record for each `let`) change the public type `Context`. Is the gain worth a MINOR version?
5. Can a language give `emit` for its operations (`add` as `a + b`)? Each operation then has two definitions, and P1 must test each one. Without it, V8 inlines the operation from a call site with one target.
6. The proposals cover the derive side only. A runner waits for the host, thus its speed matters less. Does the run side need any of them?
