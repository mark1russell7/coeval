# R7: a formal semantics of the kernel

This file is a research study for the kernel. It changes no rule. The coeval session decides which proposals go into `docs/ROADMAP.md` and `docs/DECISIONS.md`.

## The question

The kernel has two tiers that must agree: the plan of `prepare` and the reference interpreter of D15. Today the reference is the specification, and `agree` compares the two tiers on generated documents. This study asks four questions:

1. What is the precise meaning of a coeval program? What does a formal semantics add to the reference, for documents, the ladder, paths, scopes, the run side and the decorated tree?
2. Which properties can we state? Which ones hold as tests today, and which ones do not?
3. How do we get confidence: proofs, an executable semantics, property tests, or a derivation of one tier from another? What gives the best value for a small team?
4. How does each idea relate to the literature?

The studies R1 to R6 cover staging, effects, attribute grammars, incremental computation, types and extensibility. This study refers to them and does not repeat them.

## The findings in short

1. The kernel is a fold with an open algebra. At each document, the plan and the reference apply the same five tests in the same order. Then they give an evaluator the data of the document, sealed parts and the context. Thus the meaning of a document is a function of the meanings of its parts. A small big-step calculus with five judgments describes it. The sketch below gives it.
2. Each soundness claim of the kernel is a claim about machines whose host code obeys its contract. Examples are STATIC.AGREES, TYPE.SOUND, FACTS.SOUND, READS.SOUND and CAP.EFFECTS-SOUND. The calculus names seven obligations of host code. No test examines an evaluator alone against them.
3. The calculus found three gaps:
   - A compiled evaluator can give a part more capabilities than its document has. A probe for this study shows it. The plan then causes an effect `log` without the capability, and the reference gives `#CAP!`. CAP.NARROW holds by construction only for evaluators and runners that are functions.
   - `EvalInput.doc` gives each evaluator the JSON of its parts. Thus the seal of D7 is a discipline, and EVAL.SEALED has one example test.
   - `#CYCLE!` comes after 64 collapses in one resolution, also for a long chain without a cycle. The specification does not state this bound.
4. `agree` compares two readings that share the lookup of a kind, the split of a value, the ladder and the steps of a path. A bug in these shared definitions is outside each comparison. Only a third reading from written rules covers them.
5. The best value for a small team is cheap: the written calculus, a fix of the narrowing gap, conformance tests for evaluators and law tests. A stepper machine from the functional correspondence of Danvy comes next. A full mechanization is out of reach. Only small slices in Lean are worth their cost, and later.

## Background

### Structural, natural and reduction semantics

Plotkin defines a structural operational semantics (SOS) with rules over the syntax of a program ([Plotkin, 1981, reprinted in 2004](https://doi.org/10.1016/j.jlap.2004.05.001)). Each rule gives one step of a transition relation. A label on a transition can record an action, for example an output. Kahn defines natural semantics: a relation from a program and a context to a final value, with inference rules ([Kahn 1987](https://doi.org/10.1007/BFb0039592)). A proof of one judgment is a derivation tree, and the tree has one node for each subterm that evaluates.

Felleisen and Hieb write a small-step semantics with evaluation contexts ([Felleisen and Hieb 1992](https://doi.org/10.1016/0304-3975(92)90014-7)). A context is a term with one hole, and the hole marks the next redex. One rule for each redex and one decomposition give the whole relation. Wright and Felleisen prove type soundness with these rules: progress and preservation ([Wright and Felleisen 1994](https://doi.org/10.1006/inco.1994.1093)). A well-typed term is a value, or it steps, and a step keeps its type.

Big-step rules repeat many premises for errors. Pretty-big-step semantics removes the repetition with intermediate results ([Charguéraud 2013](https://doi.org/10.1007/978-3-642-37036-6_3)). Big-step rules also cannot tell divergence from an error. A clock in a functional big-step semantics solves this: each recursive call takes one tick, and a run without ticks stops with a timeout ([Owens and others 2016](https://doi.org/10.1007/978-3-662-49498-1_23)). CakeML uses this style for its verified compiler ([Kumar and others 2014](https://doi.org/10.1145/2535838.2535841)).

For coeval, the evaluation of a document is natural semantics. The trace (PLAN.TRACE) is a derivation tree: one node for each document, with its rung, its context and its result. The place of an error is the path to the hole of an evaluation context. The depth limit of PLAN.DEPTH is a clock for the nesting.

### Definitional interpreters

Reynolds defines a language by an interpreter in another language ([Reynolds 1972, reprinted in 1998](https://doi.org/10.1023/A:1010027404223)). A higher-order interpreter uses the functions of the defining language. Then it inherits the order of evaluation of the defining language, unless a transformation into continuation-passing style (CPS) makes the order explicit. Reynolds also introduced defunctionalization: each function value becomes a record of data, and one `apply` function interprets the records.

For coeval, the reference is a higher-order definitional interpreter. A sealed part is a closure of the host, and the recursion of the reference uses the stack of the host. The order of evaluation is explicit, because each evaluator evaluates its parts in sequence. But the stack is not explicit, thus the overflow of the host stack is the one permitted difference between the tiers (VALUE.DEPTH).

### From an interpreter to a machine: the functional correspondence

Ager, Biernacki, Danvy and Midtgaard derive abstract machines from evaluators ([Ager and others 2003a](https://doi.org/10.1145/888251.888254)). A CPS transformation makes each continuation explicit, and defunctionalization makes each continuation a data structure. The evaluator becomes a machine with a stack of frames. They derive the CEK machine, the Krivine machine and the SECD machine this way.

[Danvy and Nielsen (2001)](https://doi.org/10.1145/773184.773202) show many uses of defunctionalization, and [Danvy (2008)](https://doi.org/10.1145/1411204.1411206) collects the method. The same authors also derive a compiler and a virtual machine from a compositional interpreter ([Ager and others 2003b](https://www.brics.dk/RS/03/14/)). [Bahr and Hutton (2015)](https://doi.org/10.1017/S0956796815000180) calculate a correct compiler from the specification of its source language.

For coeval, the correspondence gives a third tier from the reference: a stepper with an explicit stack. Each step is a pure function of a configuration. The stepper does not use the stack of the host, and its configurations are data. The plan is the other derivation: R1 showed that `prepare` is the first Futamura projection of the interpreter, written by hand.

### Abstracting abstract machines

<!-- ste-disable-next modal-verb -- the family name of an author -->
Van Horn and Might make an abstract machine finite: each recursive structure goes through a store, and the store becomes finite ([Van Horn and Might 2010](https://doi.org/10.1145/1863543.1863553), and the [journal version of 2012](https://doi.org/10.1017/S0956796812000238)). The finite machine is a sound static analysis, by construction. [Darais and others (2017)](https://doi.org/10.1145/3110256) do the same with a definitional interpreter and a change of its monad. [Wei, Decker and Rompf (2018)](https://doi.org/10.1145/3236800) connect the two approaches by refunctionalization.

For coeval, `check`, `typeCheck`, `factsOf` and `effectsOf` are four separate walks. Each one is an abstract interpretation (R5). A property test samples the soundness of each walk. AAM gives one machine for each analysis, with soundness by construction. The cost is a rewrite of four working walks.

### Executable semantics: PLT Redex and K

PLT Redex is a language for reduction semantics, embedded in Racket ([Felleisen, Findler and Flatt 2009](https://redex.racket-lang.org/sewpr-toc.html)). A model in Redex runs, and Redex generates random terms to test a property of the model. [Klein and others (2012)](https://doi.org/10.1145/2103656.2103691) modeled nine papers of ICFP 2009 in Redex, and they found mistakes in all nine. The K framework writes a semantics as rewrite rules over configurations, and it gives an interpreter and a model checker ([Roșu and Șerbănuță 2010](https://doi.org/10.1016/j.jlap.2010.03.012)). KJS is a full semantics of JavaScript in K, tested against the conformance suite test262 ([Park, Ștefănescu and Roșu 2015](https://doi.org/10.1145/2737924.2737991)).

For coeval, `agree` and `generate` are a lightweight mechanization in TypeScript. They give the main value that Klein and others measured: random tests of a model against its implementation. A model in Redex or K needs a second language and a model of the values of the host.

### Compiler correctness by simulation

CompCert proves that each pass of a C compiler keeps the observable behavior of the program ([Leroy 2009a](https://doi.org/10.1145/1538788.1538814), [Leroy 2009b](https://doi.org/10.1007/s10817-009-9155-4)). A simulation diagram relates each step of the source to steps of the target. When the target is deterministic, a forward simulation gives the full equivalence.

For coeval, PLAN.AGREES is a claim of compiler correctness. The plan compiles each document into a closure from the closures of its parts. Thus the simulation is compositional, and it reduces to one local lemma for each construct. The section "The simulation of the plan" below gives the argument.

### A small core with a precise specification

The specification of WebAssembly defines its semantics with formal rules, and a reference interpreter follows them ([Haas and others 2017](https://doi.org/10.1145/3062341.3062363)). [Watt (2018)](https://doi.org/10.1145/3167082) mechanized the specification in Isabelle and proved the soundness of its type system. The work found errors in the draft specification, and the editors corrected them before its publication. [Watt and others (2021)](https://doi.org/10.1007/978-3-030-90870-6_4) give two mechanizations of WebAssembly 1.0. SpecTec writes the rules one time and generates the prose, the formal rules and the definitions for proof assistants ([Youn and others 2024](https://doi.org/10.1145/3656440)).

JavaScript shows the other way. [Guha, Saftoiu and Krishnamurthi (2010)](https://doi.org/10.1007/978-3-642-14107-2_7) reduce JavaScript to a small core calculus, and they test the core against real implementations. JSCert is a semantics of ECMAScript 5 in Coq, and JSRef is an interpreter that comes from it ([Bodin and others 2014](https://doi.org/10.1145/2535838.2535876)). A review one year later found a small number of misreadings of the standard, and each one was in both JSCert and JSRef ([Gardner and others 2015](https://doi.org/10.1007/978-3-319-21690-4_1)).

For coeval, `docs/SPEC.md` is the prose with IDs, as the prose of WebAssembly is. The missing part is the formal rules beside the prose. The lesson of JSCert applies to D15: two readings by one team share their misreadings. A test against a separate statement of the rules finds them.

### The semantics of attribute grammars

Knuth defines the meaning of an attribute grammar as the solution of the equations of its attributes ([Knuth 1968](https://doi.org/10.1007/BF01692511)). A grammar is well defined when no tree has a circular dependency. [Johnsson (1987)](https://doi.org/10.1007/3-540-18317-5_10) evaluates the equations by lazy evaluation, and the order comes from the demands. [Magnusson and Hedin (2007)](https://doi.org/10.1016/j.scico.2005.06.005) evaluate circular reference attributes to a fixed point.

For coeval, the decorated tree of D16 is the demand semantics of Johnsson, with a memo. A demand that reaches an attribute in evaluation gives `#CYCLE!`. Thus each tree without a circular demand gets the unique solution of Knuth, in each order of the demands.

### The semantics of effects and handlers

Moggi describes effects with monads ([Moggi 1991](https://doi.org/10.1016/0890-5401(91)90052-4)). Plotkin and Power describe an effect as operations with equations ([Plotkin and Power 2003](https://doi.org/10.1023/A:1023064908962)). Plotkin and Pretnar add handlers, which give the operations a meaning ([Plotkin and Pretnar 2009](https://doi.org/10.1007/978-3-642-00590-9_7), [2013](https://doi.org/10.2168/LMCS-9(4:23)2013)). [Bauer and Pretnar (2014)](https://doi.org/10.2168/LMCS-10(4:9)2014) give an effect system for them.

Interaction trees represent a program with effects as a coinductive tree of events in Coq ([Xia and others 2020](https://doi.org/10.1145/3371119)). An interpreter of the events is a handler. R2 covers the rest of this literature.

For coeval, `Steps` is a one-shot resumption: a result, or a wait with the rest of the computation. `evaluate` and `run` are two handlers of the same computation. The equations of the effects are the row S4 (R2 P6).

### Testing a semantics, and the trusted base

QuickCheck tests properties with random inputs ([Claessen and Hughes 2000](https://doi.org/10.1145/351240.351266)). Csmith finds bugs in C compilers with random programs and a comparison of compilers ([Yang and others 2011](https://doi.org/10.1145/1993498.1993532)). [Hritcu and others (2013)](https://doi.org/10.1145/2500365.2500574) test a security property, noninterference, with random programs before a proof. They put bugs into a machine on purpose, and they measure how fast the tests find them.

Two works show how to treat code that a semantics cannot see. RustBelt proves the unsafe code of Rust libraries against a semantic contract of each type ([Jung and others 2018](https://doi.org/10.1145/3158154)). Safe code that uses such a library then keeps its guarantees. [Findler and Felleisen (2002)](https://doi.org/10.1145/581478.581484) check the contract of a higher-order function at run time, and a failure blames the side that broke the contract.

For coeval, a compiled evaluator and the code of an own entry are code that the static kit cannot see. Their contract is the contract of their kind. The kernel can check some parts of that contract at run time, as `narrow` does for a function evaluator. A test can check the other parts.

### Proof assistants

Lean 4 is a proof assistant and a programming language ([de Moura and Ullrich 2021](https://doi.org/10.1007/978-3-030-79876-5_37)). A definition in Lean compiles to native code, thus one model can be a proof object and a tier of tests. Ott writes the rules of a semantics one time and generates LaTeX and definitions for Coq, Isabelle and HOL ([Sewell and others 2010](https://doi.org/10.1017/S0956796809990293)). [Bodin and others (2019)](https://doi.org/10.1145/3290357) write a semantics as a skeleton, and they get a concrete interpreter and abstract interpreters from one description.

## How coeval relates today

| Idea | coeval today | Where |
| --- | --- | --- |
| Natural semantics | The reference: one recursive function over documents, with the rules in the order of the specification | `reference.ts` (`examine`, `evaluateSeen`) |
| A derivation tree | The trace: one node for each document, with its rung, its context and its result | `TraceNode`, PLAN.TRACE |
| The hole of an evaluation context | The place of an error. `placed` keeps the first place, thus an error keeps the place where it started. | `errors.ts`, K5 |
| Stuck terms | The static codes `#PART?`, `#KIND?`, `#NOEVAL`, `#VALUE!` and `#NAME?`. `check` predicts them, as a proof of progress does. | STATIC.AGREES |
| A higher-order definitional interpreter | Parts are closures of the host, and the recursion uses the stack of the host | `evalInput`, VALUE.DEPTH |
| A staged interpreter | The plan: the first Futamura projection, by hand (R1) | `compileNode` |
| An open algebra | The evaluators of a machine, by name, with sealed parts | `Machine.evaluators`, D7 |
| A one-shot resumption | `Steps`: a generator that yields a promise for each wait | `evaluate.ts`, D11 |
| Two handlers of one computation | `drive` refuses each wait, and `driveWaiting` waits | `evaluate.ts`, `reference.ts` |
| A clock | 1000 levels of nesting, 64 collapses in one resolution and 32 aliases in one lookup | PLAN.DEPTH, `deref.ts`, `world.ts` |
| Abstract interpreters | Four walks: `check`, `typeCheck`, `factsOf` and `effectsOf` | `static.ts`, `typing.ts`, `facts.ts`, `effects.ts` |
| Demand semantics of attributes | The decorated tree, with one memo cell for each node and attribute | D16, TREE.* |
| Random tests of two readings | `agree` and `generate`: 2000 documents for each configuration at each push, and 20000 with new seeds each night | D15, PLAN.AGREES |

Eight facts follow from the code.

1. **The kernel is a fold with an open algebra.** `compileNode` and `examine` make the same tests in the same order: `#PART?`, `#DEPTH!`, `#KIND?`, `#NOEVAL` and `#VALUE!`. Then each one gives the evaluator the data, the sealed parts and the context. The evaluator gives the result. Thus the meaning of a document depends on its parts only through their meanings.
2. **Parts are call by name.** The comment of `Part.evaluate` says "Each call is a new evaluation." The formula kit evaluates each part at most one time, except the body of a function at each call. The decorated tree adds a memo, which gives call by need.
3. **The seal is a discipline.** `EvalInput.doc` and `CompileInput.doc` hold the whole envelope, with the JSON of each part. An evaluator can read the syntax of a part there. The compilers of the kit read `doc.value` only in `lit`, `ref`, `step` and `ext`, for data and for the structure of a path. EVAL.SEALED has one example test with `multiply`.
4. **CAP.NARROW holds by construction only for function code.** `interpret` and `interpretRun` call `narrow` on each context that a function evaluator gives a part. The reference narrows in `contextOfPart` for each evaluator. A compiled evaluator gives `part.code(ctx, rt)` any context, and `gated` applies only the rules of the contract.

   A probe for this study gave a part the capabilities `log` and `write` from a compiled evaluator, under a root without capabilities. The plan caused the effect `log` and gave `"hi"`. The reference gave `#CAP!`. The compilers of the formula kit change only `names`, thus no kit kind widens. The test of CAP.NARROW examines the function `narrow` alone.
5. **The two readings share their definitions of the model.** D15 shares the ladder, the lookup of a kind, the split of the parts and the resolution of a path. The untraced plan uses `answerOf`, `resolveQuick` and, since K12, compiled paths. The reference uses `ask` and the full `resolve`. Thus `agree` compares these pairs. But `lookupKind`, `splitParts` and `derefStep` have one implementation, and `agree` cannot find a bug in them.
6. **Bounds act as a clock.** PLAN.DEPTH stops the nesting at 1000 documents. A resolution gives `#CYCLE!` after 64 collapses, also for a long chain of references without a cycle. A lookup gives the reason `cycle` after 32 aliases. A recursion of `fn` through `call` meets only the stack of the host, thus each tier stops at a different depth. The specification states only the first bound.
7. **A reference in the data resolves in the context of its reader.** `collapse` resolves the path of a reference document with the context of the resolution that reached it. Thus a stored `["names", "x"]` reads the `x` of the reader, not of the writer. DEREF.COLLAPSE does not say which context applies.
8. **The run side has no reference.** D15 covers evaluations. A run with `all` interleaves its items in the order of the host. RUN.ADDRESS gives each effect a name that does not depend on that order. The row K46 waits.

### The properties: stated, tested and missing

| Property | Statement in the calculus | Today | Its assumptions |
| --- | --- | --- | --- |
| Determinism | `⟦d⟧Γ` is a function of the machine, the document, the context and the mock | The tier `again` evaluates a plan two times | Host code that is a function |
| One meaning (PLAN.AGREES) | `C⟦d⟧(Γ) ≈ R⟦d⟧(Γ)`, with the same effects | A property test at each push and each night | C1, and the shared definitions (fact 5) |
| Narrowing (CAP.NARROW) | The capabilities of a part are a subset of the capabilities of its document | A unit test of `narrow` | C1. Compiled code breaks it (fact 4). |
| Compositionality (EVAL.SEALED) | Parts with the same meaning and the same header can replace each other | One example | C5 (fact 3) |
| Progress (STATIC.AGREES) | A document that checks reaches no stuck rule that `check` predicts | A property test | C7 |
| Type soundness (TYPE.SOUND, TYPE.ROOTS-SOUND) | Each value is a member of the type of its place | Property tests | C7, and type rules that describe their code |
| Sound reads (FACTS.SOUND, READS.SOUND) | Each resolution has a static read, and the same free reads give the same result | Property tests | C3 and C4 |
| Sound effects (CAP.EFFECTS-SOUND) | Each effect that reaches the host is in `effectsOf` | A property test | C1 and C2 (K64) |
| Sound waits (RUN.CAN-WAIT) | A document that passes the check of the waits gives no refused wait | A property test | C6 (K65) |
| The laws of the merge (WORLD.LAWS) | The merge is commutative, associative and idempotent, or it fails in each order | A property test of 1500 seeds | None: the merge is pure data |
| Conservative extension | A document of a language gives the same result in each merge that adds only new entries | No test | No fallback that catches a key of the base |
| Order independence of attributes | The order of the demands changes no attribute | No test | A tree without circular demands |
| Equations of effects | Effects that commute can change places | No test (S4) | Equations that the contracts declare |

## A sketch of the core calculus

The sketch covers the kernel and the formula kit, for evaluations. It names the code that each judgment describes, and the SPEC IDs that each rule gives. The reason and the cause of an error are left out.

### Syntax

```text
k   ::= s | i                                        a key: a text or an index
v   ::= null | true | false | n | s | [v, ...] | {s: v, ...}      JSON
u   ::= v | a value of the host                       a result (VALUE.ANY)
τ   ::= [k, ...]                                     a type: a path into the world
d   ::= ⟨τ, v⟩ | ⟨τ, v, o, x⟩                         an envelope, with own entries o and a binding name x
o   ::= {β: n, ...}                                  own entries: a verb to an evaluator name
ρ   ::= [k, ...]                                     a place: the keys from the root document
c   ::= #PART? | #DEPTH! | #KIND? | #NOEVAL | #VALUE! | #NAME? | #N/A | #REF! | #CYCLE! | #STEP? | #CAP! | #CALC!
r   ::= ok(u) | err(c, ρ)                            a result

κ   ::= { verbs: β ⇀ n, σ, scope, caps, side, effects, pure, lazy }      a kind and its contract
W   ::= { kinds, defaults: β ⇀ n, fallback }                              a world
M   ::= { W, E: n ⇀ evaluator, R: n ⇀ runner, derefs, walkers, permits, maxDepth }
Γ   ::= { self, names, world, event, caps }                               the five roots (D10)
```

### The judgments

```text
W ⊢ τ ⇒ κ   or   W ⊢ τ ⇒ ⊥              the lookup of a kind                lookupKind
ladder(o, κ̂, β) = n | none | stop        the ladder of a verb                ask, answerOf
σ ⊢ v ⇝ (p̄, δ, fill)   or   σ ⊢ v ⇝ ✗    the split of a value                splitParts
M, Γ ⊢ π ⇒ t   or   M, Γ ⊢ π ⇒ err(c)    the resolution of a path            resolve
M, Γ ⊢β d @ ρ, h ⇓ r ! ε                the evaluation of a document        evaluateAt, compileNode
```

In the last judgment, `β` is the verb, `h` is the depth and `ε` is the list of effects.

### The ladder

```text
ladder(o, κ̂, β) = o(β)               if β is an own key of o                LADDER.OWN, LADDER.OWN-ONLY
                = stop               else if κ̂ = ⊥                          LADDER.UNKNOWN
                = κ.verbs(β)         else if β is an own key of κ.verbs     LADDER.KIND
                = W.defaults(β)      else if β is an own key of defaults    LADDER.DEFAULT
                = none               else                                   LADDER.NO-ANSWER
```

`κ̂` is the kind of the type of the envelope, or of the type that the position declares (LADDER.DECLARED, LADDER.ENVELOPE-WINS). The same function serves each verb, also `deref` and `step` (VERB.LADDER).

### Paths

```text
P-PATH    π = [root, s1, ..., sm]     root ∈ {self, names, world, event, caps}
          t0 = collapse(Γ.root)       ti = collapse(step(t(i-1), si))
          ─────────────────────────────────────────────────────────────
          M, Γ ⊢ π ⇒ tm                                                    DEREF.ROOT

step(t, k) = t.deref(k)                          t is a host thing          DEREF.HOST
           = derefs(n)(t, k)                     t is an envelope, ladder(o, κ̂, deref) = n
           = field(t.value, k)                   t is an envelope, no rung answers     VERB.LADDER
           = field(t, k)                         else
step(t, s) = walkers(n)(s, t)                    s is a step document, ladder(o, κ̂, step) = n

collapse(t) = collapse(t')    if t is a reference document and M, Γ ⊢ t.value ⇒ t'    DEREF.COLLAPSE
            = err(#CYCLE!)    after 64 collapses in one resolution                    DEREF.CYCLE
            = t               else
```

A failed step gives `#NAME?` for the first name of `names`, and `#N/A` for each other step (DEREF.CODES). The inner path of `collapse` resolves in `Γ`, the context of the reader (fact 7).

### Documents

The rules apply in their order: the first rule whose premises hold gives the result.

```text
E-PART    d is no envelope, and its position declares no type    ⇓ err(#PART?, ρ) ! ·      EVAL.ERRORS
E-DEPTH   h > maxDepth                                           ⇓ err(#DEPTH!, ρ) ! ·     PLAN.DEPTH
E-KIND    ladder(o, κ̂, β) = stop                                 ⇓ err(#KIND?, ρ) ! ·      WORLD.NO-KIND
E-NOEVAL  ladder(o, κ̂, β) = none, or n names no code of M        ⇓ err(#NOEVAL, ρ) ! ·     LADDER.NO-ANSWER
E-SHAPE   κ.σ ⊢ v ⇝ ✗                                            ⇓ err(#VALUE!, ρ) ! ·     SHAPE.*

E-APPLY   ladder(o, κ̂, β) = n        κ.σ ⊢ v ⇝ (p̄, δ, fill)
          qi = seal(pi, ρ·ℓi, h + 1)  for each part pi at the path ℓi
          F(n)(δ, q̄, Γ, ρ) ⇓ r ! ε
          ────────────────────────────────────────────
          M, Γ ⊢β d @ ρ, h ⇓ place(r, ρ) ! ε                                              EVAL.OWN, K5

seal(p, ρ', h')  = the handle  (ℓ, x, λΓ'. the result of  M, Γ'' ⊢β p @ ρ', h' ⇓ r ! ε)
     where  Γ''  = rules(κ.caps, ℓ, narrow(Γ, Γ'))                     CAP.NARROW, CAP.CONTRACT
narrow(Γ, Γ')    = Γ' with caps := [c in Γ'.caps such that permits(Γ.caps, c)]
rules            : same keeps the capabilities, mask gives [], only L gives their meet with L
place(err(c), ρ) = err(c, ρ), and place(r, ρ) = r for each other r             the first place wins
```

`F(n)` is the meaning of the evaluator `n`: code of the host. It gets the data `δ`, the handles `q̄` and the context, and nothing else. This is the reading of D7. A runner gives a resumption, and `evaluate` drives it: a wait gives `#CALC!` at the place of the runner (RUN.WAIT).

Two theorems follow from the form of E-APPLY. First, the meaning of `d` depends on a part only through its handle (EVAL.SEALED), when `F(n)` obeys C5. Second, the meaning is a function of `M`, `Γ`, `d` and the mock (determinism), when each `F(n)`, each host thing and the mock are functions.

### The formula kit

The meanings of the constructs, as `formulaDefinitions` gives them. `q Γ` is the result of the handle `q` in the context `Γ`. "The first error" means the first failed result, in the order of the parts.

```text
F-LIT    F(lit)(v)            = ok(v)                                                FORMULA.LIT
F-REF    F(ref)(π)            = ok(value(t))  if M, Γ ⊢ π ⇒ t                        FORMULA.REF
                              = err(c)        if M, Γ ⊢ π ⇒ err(c)
F-LIST   F(list)(q1 ... qm)   = ok([u1 ... um])  if qi Γ = ok(ui) for each i         FORMULA.LIST
                              = the first error, else
F-IF     F(if)(t, a, b)       = a Γ  if t Γ = ok(u) and truthy(u) = true             EVAL.LAZY-IF
                              = b Γ  if truthy(u) = false
                              = err(#VALUE!)  if truthy(u) is not defined
F-LET    F(let)(bind, body)   = body Γ[names := names + {xi: held(qi Γ)}]            FORMULA.LET
F-FN     F(fn)(x̄, body)       = ok(closure(x̄, body, Γ))                              FORMULA.FN
F-CALL   F(call)(f, ā)        = body Γc[names := names + {x̄: ū}]                     FORMULA.FN
                                 if f Γ = ok(closure(x̄, body, Γc)) and ā Γ = ok(ū)
F-OP     F(op k)(q̄)           = ok(ops(k)(ū))  if q̄ Γ = ok(ū)                        FORMULA.OPS
```

A read of a name that holds `held(err(c))` gives `err(c)` (FORMULA.LET). A profile changes `truthy`, the result of `if` without `else`, the logic of `and` and `or`, and the combination of errors (FORMULA.COMBINE). A closure keeps its context `Γc`, thus a procedure keeps the capabilities of its maker (CAP.LATENT).

### Effects and the run side

```text
X-EFFECT  permits(Γ.caps, k) = true        a = address(ρ, scope)                    RUN.CAP, RUN.ADDRESS
          u' = mock(k, u), or u' = u without a mock                                 RUN.MOCK, RUN.EVAL
          ──────────────────────────────────────────
          effect(k, u) at ρ  ⇓  ok(u') ! [(k, u, ρ, a)]

X-CAP     permits(Γ.caps, k) = false   ⇒   effect(k, u) at ρ  ⇓  err(#CAP!, ρ) ! ·

Steps     = done(r)  |  wait(promise, value → Steps)                               a one-shot resumption
evaluate  : each effect gets the answer of the mock at once, and a wait gives #CALC!     drive
run       : each effect goes to perform, and a wait waits for its promise              driveWaiting
all(q̄)    : an interleaving of the resumptions of q̄, in the order of the host or of the journal
```

`permits` is the hook of the machine when it has one (CAP.HOOK). One computation and two handlers give RUN.SAME: a run and an evaluation with the same answers give the same derived values.

### The decorated tree

```text
state(ν, a) ∈ { new, pending, done(r) }        one cell for each node ν and attribute a

demand(ν, a) = r                    if state(ν, a) = done(r)                       TREE.ONCE, TREE.MEMO
             = err(#CYCLE!)         if state(ν, a) = pending                       TREE.CYCLE
             = r                    if state(ν, a) = new. Before: state := pending.
                                    Then r = qa(Γν[self := ν]). After: state := done(r).
```

A step on a node demands an attribute (TREE.LAZY), and a failed attribute gives its own error (TREE.ERROR).

### The simulation of the plan

```text
Plan:        C⟦d⟧ : (Γ, rt) → r        the closure that compileNode gives
Reference:   R⟦d⟧ : Γ → r               evaluateAt
Relation:    r ≈ r'   when the values are the same by sameValue, or the errors have one code and one place

Claim.  For a machine that obeys C1, each document d and each context Γ:
        C⟦d⟧(Γ, rt) ≈ R⟦d⟧(Γ), and the two lists of effects agree.           PLAN.AGREES, AGREE.EFFECTS

Sketch, by induction on the height of d.
  K.  The kernel step. compileNode and examine read d with the same partsOf and the same ladder.
      Thus they give the same error rule, or the same evaluator n and the same parts.
  N.  The narrowing. gated and narrow give the plan the contexts that contextOfPart gives
      the reference. For a compiled evaluator, this needs C1.
  L.  The local lemma of n. If each compiled part agrees with its handle in each context, then
      compile(n) of the compiled parts agrees with the definition of n on the handles.
  By K and N, the hypothesis of the induction gives the premise of L for the parts of d.
```

The proof is cheap because the plan is compositional. The kernel part (K and N) is one argument. Each kit then gives one lemma for each construct (L), and a test can check each lemma with probe parts. A whole document then needs no new argument.

Two limits apply. `sameValue` compares two closures by their parameters. The relation of the claim compares them by their results on the same arguments, thus `agree` is weaker than the claim there. And the claim holds only for the shared definitions as they are (fact 5).

### The obligations of host code

The soundness claims hold for a machine whose host code obeys these obligations. A function evaluator gets C1 from the kernel. Each other obligation is a promise of the author of the code.

| ID | Obligation | Who keeps it today | The claims that need it |
| --- | --- | --- | --- |
| C1 | Each context that an evaluator gives a part has only capabilities that the context of its document permits | The kernel for function code. The author for compiled code (fact 4). | CAP.NARROW, CAP.EFFECTS-SOUND, PLAN.AGREES |
| C2 | The code causes only the effects that its contract declares | The author. An own entry for another evaluator has no contract (K64). | CAP.EFFECTS-SOUND, STATIC.AGREES |
| C3 | Each part that no lazy rule covers evaluates in each evaluation that gives a value | The author | FACTS.LAZY |
| C4 | A kind with `pure` reads the context only through `resolve`, and causes no effect | The author | FACTS.SOUND, READS.SOUND |
| C5 | The code reads its parts only through their handles, not through `doc.value` | The author (fact 3) | EVAL.SEALED |
| C6 | A runner passes each wait of its parts through | The author (K65) | RUN.CAN-WAIT |
| C7 | The names that the code binds for a part are the names of the scope rules of its kind | The author | STATIC.AGREES, TYPE.SOUND |

### What the sketch leaves out

- The reason and the cause of an error, and the hops of a resolution.
- Host things with `resolve` and `adopt`, which change the steps of a path.
- The quick path of `resolve` and the compiled paths of K12. Both give the result of the full walk.
- The reads of D26 and the trace. Both are outputs beside `r` and `ε`, as the effects are.
- Verbs other than `eval` follow the same rules with another `β` (D23).
- The rules of `check`, the types and the facts. Each one is an abstract version of a rule above.

## Proposals ranked by value for effort

Effort S is one pull request of a day or less. Effort M is a few days. Effort L is a week or more.

| Rank | Proposal | Effort | Value | Row |
| --- | --- | --- | --- | --- |
| P1 | The core calculus as a page of the specification | S to M | High: it states each rule precisely, and it found three gaps | K90 |
| P2 | The narrowing of the parts of compiled code | S | Medium to high: it makes CAP.NARROW true as D14 states it | K91 |
| P3 | Conformance tests for evaluators | M | High: they test the assumptions of each soundness claim, one evaluator at a time | K92 |
| P4 | Law tests of the semantics | S to M | Medium to high: six properties without a test today | K93 |
| P5 | A clock for `call`, and the bounds in the specification | S | Medium: one depth for each tier, and `agree` loses its one exception for formulas | K94 |
| P6 | A third tier: a stepper from the functional correspondence | M to L | Medium to high: it covers the shared definitions, deep documents and data states | K95 |
| P7 | Slices in Lean 4 | L | Low to medium today | K96 |
| P8 | The analyses as abstractions of the stepper | L | Low today | K97 |

### P1: the core calculus as a page of the specification

- **What.** A new page `docs/SEMANTICS.md` holds the calculus of this study, completed for the kernel and the formula kit. It has the syntax, the five judgments and one rule for each rule of evaluation. It also has the two handlers of the run side, the obligations C1 to C7 and the simulation argument. Each rule names its SPEC ID.
- **Precisions.** The page fixes four facts that the specification does not state:
  - The bounds of 64 collapses and 32 aliases (DEREF.COLLAPSE-LIMIT, WORLD.ALIAS-LIMIT).
  - A reference in the data resolves in the context of its reader (DEREF.READER).
  - Each call of a part is a new evaluation (EVAL.BY-NAME).
  - EVAL.SEALED holds for code that keeps C5.
- **Kernel parts.** No code changes. `spec.test.ts` gets a check: each rule of the page names a SPEC ID that exists (SEM.RULES).
- **Risk.** The page and the code can drift apart. The test of the IDs, and the probes of P3 and P4, keep them near.
- **Why first.** The work on the rules found the three gaps of this study, as the mechanization of WebAssembly found errors in its draft. The page is also the input of P3, P6 and P7.

### P2: the narrowing of the parts of compiled code

- **What.** Two options. A decision selects one of them.
  1. The kernel narrows. A compiled evaluator or runner gets a view of the runtime for each evaluation of its document, with the context of the document in it. The code of each compiled part narrows its context against that view. A closure keeps the view of its maker, thus CAP.LATENT stays true. The cost is one small object for each evaluation of a compiled document with parts. The CI benchmark of FORMULA.SPEED decides.
  2. The kernel trusts. A decision records C1 as a promise of each compiled evaluator, as K64 and K65 record other promises. P3 then tests each compiled evaluator of a kit. The option `strict` of `prepare` applies option 1, and `agree` uses it.
- **Kernel parts.** `compileNode`, `gated`, `Runtime`, `PrepareOptions`, D14 and SPEC.
- **Risk.** Option 1 slows each plan with compiled parts. Option 2 keeps a claim that only tests support. Host code has the full authority of the host, thus the gap is a guard against mistakes, not against an attack.
- **Test.** CAP.NARROW-CODE: a compiled evaluator and a compiled runner that widen the context of a part cause no effect that the document cannot cause. The probe of this study becomes the test.

### P3: conformance tests for evaluators

- **What.** `conforms(machine, name, options)` evaluates one evaluator alone, as the local lemma L asks. It gives the evaluator probe parts and a probe runtime. A probe part records each call and the context of the call. It gives a chosen result: a value, an error or a held error. The probe runtime records each resolution and each effect.
- **The checks.** For each obligation, one check:
  - C1: Each context that the code gives a part has only the capabilities of the document.
  - C2: Each effect is a declared effect.
  - C3: Each eager part evaluates when the result is a value.
  - C4: The context is a proxy that records each read outside `resolve`, and a pure kind makes none.
  - C5: Two documents whose parts have other JSON, and the same probe results, give the same result.
  - C6: A probe part that waits makes the runner wait.
  - C7: The names in the context of each part are the names of the scope rules.
- **Local agreement.** For a compiled evaluator with a definition for the reference, the same probes go through both. The results, and the calls of the parts in their order, must agree. This is the test form of the lemma L, and it isolates a failure to one construct.
- **Kernel parts.** A new module `conform.ts`, exported as `agree` is. The formula kit and the standard machine use it in their tests, and a language uses it for its own evaluators.
- **Risk.** Probes cover chosen results only. A seed gives random results, and the harness counts the cases that it reaches, as GEN.REACH does.
- **Test.** CONFORM.NARROW, CONFORM.EFFECTS, CONFORM.LAZY, CONFORM.PURE, CONFORM.SEALED, CONFORM.WAIT, CONFORM.SCOPE and CONFORM.LOCAL. Each check also finds a mutant evaluator that breaks its obligation.

### P4: law tests of the semantics

- **What.** Property tests for the properties of the table above that have no test. Each one uses `generate` and the machines of the agreement harness.
  - EVAL.SEALED as a property. A pure part with a JSON result changes to `lit` of that result, with the same header. The parent gives the same result. Positions that permit no `lit` are skipped.
  - EVAL.DETERMINISTIC. The plan and the reference each evaluate a document two times. The results, the effects and the reads are the same.
  - CAP.MONOTONE. A document that gives a result without `#CAP!` under some capabilities gives the same result under more capabilities.
  - COMPOSE.CONSERVATIVE. A merge that adds only new entries, without a fallback, keeps the result of each document of the base.
  - TREE.ORDER-FREE. A change of the order of the attribute fields of a node changes no attribute value.
  - SEQ.LAWS. `seq` with one step gives the result of the step. Nested sequences without names give the result and the effects of one flat sequence.
- **Kernel parts.** None. A test file `laws.test.ts`, and the IDs in SPEC.
- **Later laws.** The equations of effects come with S4 (R2 P6). The laws of handlers of Plotkin and Pretnar come with L1a.
- **Risk.** A law with a wrong condition gives false failures. Each law first records the cases that it skips.

### P5: a clock for `call`, and the bounds in the specification

- **What.** Each application of a closure of `fn` counts one level of depth in the runtime. When the count passes `maxDepth`, the application gives `#DEPTH!` at its place. The reference keeps its own count. This answers the open question 3 of R1.
- **Why.** Today an endless recursion through `call` ends at the stack of the host, at a different place in each tier (VALUE.DEPTH). With the clock, each tier gives the same error at the same place, as the clock of Owens and others does. Determinism then holds without an exception for formula documents.
- **Kernel parts.** `formula.ts` (`fn`, `call`), `formulaDefinitions` and `Runtime`.
- **Risk.** An operation of the host can apply a closure many times in a loop. Thus the count must go down after each return.
- **Test.** FORMULA.CALL-DEPTH: an endless recursion through `call` gives `#DEPTH!` with one place in the plan and in the reference.

### P6: a third tier, a stepper from the functional correspondence

- **What.** A CPS transformation and a defunctionalization of the reference, for the kernel and the formula kit. The result is a stepper with two functions: `evaluate(d, Γ, ρ, k)` and `resume(k, r)`. The continuation `k` is a stack of frames, for example "the items of a list after the item 2". The stepper is a pure function from one configuration to the next. The word "stepper" keeps it apart from a coeval `Machine`.
- **Its own definitions.** The stepper reads the lookup, the split and the steps of a path from the rules of P1. It does not use `partsOf`, `lookupKind` or `resolve`. Thus `agree` compares the shared definitions too (fact 5).
- **Gains.**
  - A document deeper than the stack of the host evaluates, and the depth limit is exact.
  - A configuration of a formula document is data. This is a base for a run that a host can store and resume, and for multi-shot by a copy of the state (L1b). R2 found that a generator of the host cannot do either.
  - The stepper can cover runs, as K46 asks, with an explicit queue for `all`.
  - P8 builds on it.
- **Limits.** A host evaluator is opaque. The stepper starts it in one step, and its handles start a nested stepper on the stack of the host. Thus the stepper covers the kits whose constructs it defines: the formula kit, the standard kinds and later the document evaluators of K40.
- **Kernel parts.** A new module `stepper.ts`, and the tier `stepper` of `agree`.
- **Test.** AGREE.STEPPER (the property test of PLAN.AGREES with the new tier), STEPPER.DEEP (a list nested 100000 times evaluates) and STEPPER.DATA (a configuration of a pure formula document survives `JSON.stringify` and `JSON.parse`).

### P7: slices in Lean 4

- **What.** A model in Lean 4 of slices of the calculus. The candidates, ranked:
  1. The formula kit over JSON with a clock: determinism, compositionality, and the monotonicity of the clock. Lean compiles the model, and a nightly CI job uses it as a tier on generated documents, as JSRef serves JSCert.
  2. The merge of worlds: WORLD.LAWS.
  3. The rules of capabilities: CAP.NARROW for `same`, `mask` and `only`, and the meet of `intersectCaps`.
- **The honest cost.** The slices 2 and 3 have strong tests already. WORLD.LAWS has 1500 seeds, and a test of `intersectCaps` examines each pair of a small domain. A proof adds little there.
- **The cost of the slice 1.** It costs a week or more, and a skill that the team does not have today. Its main risk is a model that drifts from the code. The CI tier controls the drift, and P6 gives most of its value in TypeScript.
- **Kernel parts.** None. A folder `proofs/` and a CI job (`workflow_dispatch` and nightly).
- **Test.** AGREE.LEAN: the tier of the model agrees with the plan on generated formula documents.

### P8: the analyses as abstractions of the stepper

- **What.** With the stepper of P6, a store with finite addresses gives an abstract stepper, as in AAM. One abstract run gives the reads of `factsOf`, the effects of `effectsOf` and the type of each place. The soundness of each one follows from the abstraction, not from a sample.
- **Why later.** The four walks are cheap and tested today, and a rewrite has a risk. The method pays when a new analysis needs control flow, for example the graph of S2 or the graph of attribute instances of L2e.
- **Kernel parts.** A new module beside `stepper.ts`. The walks stay until the abstract stepper agrees with them.
- **Test.** ANALYSIS.AGREES: on generated documents, the abstract stepper finds each read and each effect that the walks find.

## What the study does not propose

- **A full mechanization of the kernel.** A result can be any value of the host (VALUE.ANY). Evaluators, operations, host things and `perform` are code of the host. A proof of the kernel needs a semantics of that code, and KJS and JSCert show the size of a semantics of JavaScript. The model also drifts from the code at each change.
- **A model in PLT Redex or K.** Both need a second language and a model of the values of the host. `agree` and `generate` already give random tests of a model against its implementation.
- **A derivation of the plan from the reference.** R1 found that the plan is a first Futamura projection by hand. A derived plan shares its code with the reference, and D15 wants two readings. P3 tests the local lemma instead.
- **One set of rules for each tier, in the style of SpecTec or Ott.** A generator of code from the rules is large work. The IDs of P1 give a weaker link at a small cost.

## Open questions

1. **Trust or narrow.** Does the kernel narrow the parts of compiled code at a cost, or does a decision trust compiled code with C1 (P2)?
2. **The seal.** Does a later MINOR version replace `doc` in `EvalInput` and `CompileInput` with the header and `data`? Then the kernel enforces C5, and each evaluator that reads `doc.value` changes.
3. **The context of a reference in data.** Is the context of the reader the intended reading of DEREF.COLLAPSE? A reference that a language stores in a node then reads the names of each reader.
4. **The bound of collapses.** Does `#CYCLE!` need a set of visited references, so that a long chain without a cycle resolves? Or does the specification keep the bound of 64?
5. **The home of the calculus.** Is `docs/SEMANTICS.md` a part of the specification that a change of a rule must update, or a note beside it?
6. **The relation of `agree` on closures.** Does `agree` call two closures on probe arguments, so that it compares their results and not only their parameters?
7. **The run side.** Does the stepper of P6 replace the row K46 for the runs, or does the reference get its own run first?

## Sources

- Ager, M. S., Biernacki, D., Danvy, O. and Midtgaard, J. (2003a). ["A functional correspondence between evaluators and abstract machines"](https://doi.org/10.1145/888251.888254). PPDP 2003, 8–19.
- Ager, M. S., Biernacki, D., Danvy, O. and Midtgaard, J. (2003b). ["From interpreter to compiler and virtual machine: a functional derivation"](https://www.brics.dk/RS/03/14/). BRICS report RS-03-14.
- Bahr, P. and Hutton, G. (2015). ["Calculating correct compilers"](https://doi.org/10.1017/S0956796815000180). "Journal of Functional Programming" 25.
- Bauer, A. and Pretnar, M. (2014). ["An effect system for algebraic effects and handlers"](https://doi.org/10.2168/LMCS-10(4:9)2014). "Logical Methods in Computer Science" 10(4).
- Bodin, M., Charguéraud, A., Filaretti, D., Gardner, P., Maffeis, S., Naudziuniene, D., Schmitt, A. and Smith, G. (2014). ["A trusted mechanised JavaScript specification"](https://doi.org/10.1145/2535838.2535876). POPL 2014, 87–100.
- Bodin, M., Gardner, P., Jensen, T. and Schmitt, A. (2019). ["Skeletal semantics and their interpretations"](https://doi.org/10.1145/3290357). "Proceedings of the ACM on Programming Languages" 3 (POPL).
- Charguéraud, A. (2013). ["Pretty-big-step semantics"](https://doi.org/10.1007/978-3-642-37036-6_3). ESOP 2013, LNCS 7792, 41–60.
- Claessen, K. and Hughes, J. (2000). ["QuickCheck: a lightweight tool for random testing of Haskell programs"](https://doi.org/10.1145/351240.351266). ICFP 2000, 268–279.
- Danvy, O. (2008). ["Defunctionalized interpreters for programming languages"](https://doi.org/10.1145/1411204.1411206). ICFP 2008, 131–142.
- Danvy, O. and Nielsen, L. R. (2001). ["Defunctionalization at work"](https://doi.org/10.1145/773184.773202). PPDP 2001, 162–174.
- de Moura, L. and Ullrich, S. (2021). ["The Lean 4 theorem prover and programming language"](https://doi.org/10.1007/978-3-030-79876-5_37). CADE 2021, LNCS 12699, 625–635.
- Darais, D., Labich, N., Nguyen, P. C. and Van Horn, D. (2017). ["Abstracting definitional interpreters"](https://doi.org/10.1145/3110256). "Proceedings of the ACM on Programming Languages" 1 (ICFP).
- Felleisen, M., Findler, R. B. and Flatt, M. (2009). ["Semantics Engineering with PLT Redex"](https://redex.racket-lang.org/sewpr-toc.html). MIT Press.
- Felleisen, M. and Hieb, R. (1992). ["The revised report on the syntactic theories of sequential control and state"](https://doi.org/10.1016/0304-3975(92)90014-7). "Theoretical Computer Science" 103(2), 235–271.
- Findler, R. B. and Felleisen, M. (2002). ["Contracts for higher-order functions"](https://doi.org/10.1145/581478.581484). ICFP 2002, 48–59.
- Gardner, P., Smith, G., Watt, C. and Wood, T. (2015). ["A trusted mechanised specification of JavaScript: one year on"](https://doi.org/10.1007/978-3-319-21690-4_1). CAV 2015, LNCS 9206, 3–10.
- Guha, A., Saftoiu, C. and Krishnamurthi, S. (2010). ["The essence of JavaScript"](https://doi.org/10.1007/978-3-642-14107-2_7). ECOOP 2010, LNCS 6183, 126–150.
- Haas, A., Rossberg, A., Schuff, D. L., Titzer, B. L., Holman, M., Gohman, D., Wagner, L., Zakai, A. and Bastien, J. F. (2017). ["Bringing the web up to speed with WebAssembly"](https://doi.org/10.1145/3062341.3062363). PLDI 2017, 185–200.
- Hritcu, C., Hughes, J., Pierce, B. C., Spector-Zabusky, A., Vytiniotis, D., Azevedo de Amorim, A. and Lampropoulos, L. (2013). ["Testing noninterference, quickly"](https://doi.org/10.1145/2500365.2500574). ICFP 2013, 455–468.
- Johnsson, T. (1987). ["Attribute grammars as a functional programming paradigm"](https://doi.org/10.1007/3-540-18317-5_10). FPCA 1987, LNCS 274, 154–173.
- Jung, R., Jourdan, J.-H., Krebbers, R. and Dreyer, D. (2018). ["RustBelt: securing the foundations of the Rust programming language"](https://doi.org/10.1145/3158154). "Proceedings of the ACM on Programming Languages" 2 (POPL).
- Kahn, G. (1987). ["Natural semantics"](https://doi.org/10.1007/BFb0039592). STACS 87, LNCS 247, 22–39.
- Klein, C., Clements, J., Dimoulas, C., Eastlund, C., Felleisen, M., Flatt, M., McCarthy, J. A., Rafkind, J., Tobin-Hochstadt, S. and Findler, R. B. (2012). ["Run your research: on the effectiveness of lightweight mechanization"](https://doi.org/10.1145/2103656.2103691). POPL 2012, 285–296.
- Knuth, D. E. (1968). ["Semantics of context-free languages"](https://doi.org/10.1007/BF01692511). "Mathematical Systems Theory" 2(2), 127–145.
- Kumar, R., Myreen, M. O., Norrish, M. and Owens, S. (2014). ["CakeML: a verified implementation of ML"](https://doi.org/10.1145/2535838.2535841). POPL 2014, 179–191.
- Leroy, X. (2009a). ["Formal verification of a realistic compiler"](https://doi.org/10.1145/1538788.1538814). "Communications of the ACM" 52(7), 107–115.
- Leroy, X. (2009b). ["A formally verified compiler back-end"](https://doi.org/10.1007/s10817-009-9155-4). "Journal of Automated Reasoning" 43(4), 363–446.
- Magnusson, E. and Hedin, G. (2007). ["Circular reference attributed grammars: their evaluation and applications"](https://doi.org/10.1016/j.scico.2005.06.005). "Science of Computer Programming" 68(1), 21–37.
- Moggi, E. (1991). ["Notions of computation and monads"](https://doi.org/10.1016/0890-5401(91)90052-4). "Information and Computation" 93(1), 55–92.
- Owens, S., Myreen, M. O., Kumar, R. and Tan, Y. K. (2016). ["Functional big-step semantics"](https://doi.org/10.1007/978-3-662-49498-1_23). ESOP 2016, LNCS 9632, 589–615.
- Park, D., Ștefănescu, A. and Roșu, G. (2015). ["KJS: a complete formal semantics of JavaScript"](https://doi.org/10.1145/2737924.2737991). PLDI 2015, 346–356.
- Plotkin, G. D. (1981, reprinted in 2004). ["A structural approach to operational semantics"](https://doi.org/10.1016/j.jlap.2004.05.001). Aarhus report DAIMI FN-19. "Journal of Logic and Algebraic Programming" 60–61, 17–139.
- Plotkin, G. and Power, J. (2003). ["Algebraic operations and generic effects"](https://doi.org/10.1023/A:1023064908962). "Applied Categorical Structures" 11(1), 69–94.
- Plotkin, G. and Pretnar, M. (2009). ["Handlers of algebraic effects"](https://doi.org/10.1007/978-3-642-00590-9_7). ESOP 2009, LNCS 5502, 80–94.
- Plotkin, G. D. and Pretnar, M. (2013). ["Handling algebraic effects"](https://doi.org/10.2168/LMCS-9(4:23)2013). "Logical Methods in Computer Science" 9(4).
- Reynolds, J. C. (1972, reprinted in 1998). ["Definitional interpreters for higher-order programming languages"](https://doi.org/10.1023/A:1010027404223). "Higher-Order and Symbolic Computation" 11(4), 363–397.
- Roșu, G. and Șerbănuță, T. F. (2010). ["An overview of the K semantic framework"](https://doi.org/10.1016/j.jlap.2010.03.012). "Journal of Logic and Algebraic Programming" 79(6), 397–434.
- Sewell, P., Zappa Nardelli, F., Owens, S., Peskine, G., Ridge, T., Sarkar, S. and Strniša, R. (2010). ["Ott: effective tool support for the working semanticist"](https://doi.org/10.1017/S0956796809990293). "Journal of Functional Programming" 20(1), 71–122.
<!-- ste-disable modal-verb -- the family name of an author -->

- Van Horn, D. and Might, M. (2010). ["Abstracting abstract machines"](https://doi.org/10.1145/1863543.1863553). ICFP 2010, 51–62.
- Van Horn, D. and Might, M. (2012). ["Systematic abstraction of abstract machines"](https://doi.org/10.1017/S0956796812000238). "Journal of Functional Programming" 22(4–5), 705–746.

<!-- ste-enable -->

- Watt, C. (2018). ["Mechanising and verifying the WebAssembly specification"](https://doi.org/10.1145/3167082). CPP 2018, 53–65.
- Watt, C., Rao, X., Pichon-Pharabod, J., Bodin, M. and Gardner, P. (2021). ["Two mechanisations of WebAssembly 1.0"](https://doi.org/10.1007/978-3-030-90870-6_4). FM 2021, LNCS 13047, 61–79.
- Wei, G., Decker, J. and Rompf, T. (2018). ["Refunctionalization of abstract abstract machines"](https://doi.org/10.1145/3236800). "Proceedings of the ACM on Programming Languages" 2 (ICFP).
- Wright, A. K. and Felleisen, M. (1994). ["A syntactic approach to type soundness"](https://doi.org/10.1006/inco.1994.1093). "Information and Computation" 115(1), 38–94.
<!-- ste-disable-next gendered-pronoun -- the family name of an author -->
- Xia, L., Zakowski, Y., He, P., Hur, C.-K., Malecha, G., Pierce, B. C. and Zdancewic, S. (2020). ["Interaction trees: representing recursive and impure programs in Coq"](https://doi.org/10.1145/3371119). "Proceedings of the ACM on Programming Languages" 4 (POPL).
- Yang, X., Chen, Y., Eide, E. and Regehr, J. (2011). ["Finding and understanding bugs in C compilers"](https://doi.org/10.1145/1993498.1993532). PLDI 2011, 283–294.
- Youn, D., Shin, W., Lee, J., Ryu, S., Breitner, J., Gardner, P., Lindley, S., Pretnar, M., Rao, X., Watt, C. and Rossberg, A. (2024). ["Bringing the WebAssembly standard up to speed with SpecTec"](https://doi.org/10.1145/3656440). "Proceedings of the ACM on Programming Languages" 8 (PLDI).
