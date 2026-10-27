# The core calculus

This page gives the rules of the kernel as a small calculus. [`SPEC.md`](SPEC.md) gives each rule a requirement ID in prose. This page gives the same rules as inference rules, and each rule names the IDs that it covers.

The reference interpreter in [`reference.ts`](../packages/core/src/reference.ts) is the executable form of these rules (D15). The study [R7](research/r7-semantics.md) made the first sketch, and this page completes it (K90). A change of a rule changes `SPEC.md`, this page and the reference together (D34).

The page covers the kernel, the formula kit, the decorated tree and the run side. It has five judgments, the two handlers of the run side, the obligations of host code and the argument for one meaning.

## How to read the rules

- The rules are in code blocks. GitHub can show math, but the linter of the prose reads math as text. Thus the page uses code blocks and Unicode symbols.
- Each rule starts with a line that gives its name and its SPEC IDs, for example `E-KIND  [WORLD.NO-KIND]`. The test `[SEM.RULES]` reads these lines. Each ID must be in `SPEC.md` and have a test.
- The premises are above the line, and the conclusion is below it. A rule without a line is a definition.
- In a group of rules with an order, the first rule whose premises hold gives the result. The text before each group tells if the group has an order.
- The reason and the cause of an error, the hops of a path, the trace and the list of reads are outputs beside the result. The rules leave them out.

## Syntax

```text
k     ::= s | i                                     a key: a text, or a whole number from 0
v     ::= null | true | false | n | s | [v, …] | {s: v, …}                  a JSON value
u     ::= v | a value of the host                   a result value (VALUE.ANY)
τ     ::= s | [k, …] | ⟨ref, [world, k, …]⟩         a type: a path into the world (D10)
d     ::= ⟨τ, v⟩ | ⟨τ, v, x, o⟩                     an envelope, with a binding name x and own entries o (D6)
o     ::= {β: n, …}                                 own entries: a verb to the name of code
β     ::= eval | deref | step | format | …          a verb (D23)
n     ::= s                                         the name of an evaluator, a runner, a deref or a walker
ρ, ℓ  ::= [k, …]                                    a place from the root document, and a path in a value
c     ::= #PART? | #DEPTH! | #KIND? | #NOEVAL | #VALUE! | #NAME? | #N/A | #REF!
        | #CYCLE! | #STEP? | #CAP! | #CALC! | #ABORT | #ARGS | …          the code of an error
r     ::= ok(u) | err(c, ρ?)                        a result: a value, or an error with an optional place

σ     ::= none | term | list | map | record | deep | text | number | one   a shape
γ     ::= same(in?) | mask(in?) | only(caps, in?)   a capability rule (D14)
κ     ::= {verbs: β ⇀ n, parts: σ, scope, caps: [γ, …], side, effects, pure, lazy, tree}    a kind and its contract
e     ::= κ | ns({s: e, …}, κ?) | alias([world, k, …])                      an entry of the world
W     ::= {kinds: {s: e, …}, defaults: β ⇀ n, fallback: κ?}                a world
M     ::= {W, E: n ⇀ code, R: n ⇀ code, derefs, walkers, permits?, maxDepth?, plain?, roots?, adopt?}
Γ     ::= {self, names, world, event, caps}         a context: the five roots (D10)
ε     ::= [(kind, payload, ρ, Γ, address), …]       the effects, in their order
S     ::= done(r) | wait(p, a ↦ S)                  the steps of a run: a one-shot resumption (D11)
```

Some words of the rules:

- An envelope is a plain record with the keys `type` and `value`, and the optional keys `name` and `own`. Its type is a type, its `name` is a text and its `own` is a record. A record with another key is data.
- A bare value is a document only where its position declares a type. `τd` is that type, or `·` when the position declares none.
- `κ̂` is a kind, or `⊥` when the world has no kind for the type. `⊥.parts` is `none`.
- A host thing is an object with the global symbol `coeval.thing` as its own key. It answers its own steps (DEREF.HOST, DEREF.SYMBOL).
- The code of an evaluator is a function of its input, or a compiler of its document. The code of a runner is a generator function, or a compiler. A runner hides the evaluator of its name (MACHINE.RUNNER).
- `M.E` and `M.R` are the tables `evaluators` and `runners`. The verbs share them (D23).

## The five judgments

| Judgment | Its form | Code |
| --- | --- | --- |
| 1. The parts of a document | `W ⊢ v : τd ⇝ ⟨d, κ̂, s⟩` | `partsOf`, `splitParts` |
| 2. The ladder | `W ⊢ τ ⇒ κ̂` and `ladder(H, o, κ̂, β)` | `lookupKind`, `ask`, `answerOf` |
| 3. The steps of a path | `M, Γ ⊢ π ⇒ t` | `resolve`, `derefStep`, `walkerOf` |
| 4. The evaluation of a document | `M, Γ ⊢ᵦ v : τd @ ρ, h ⇓ r ! ε` | `evaluateAt` in `reference.ts`, `compileNode` |
| 5. The run side | `M, Γ ⊢ᵦ v : τd @ ρ, h ⇓ S ! ε` | `stepsAt`, `Session`, `drive`, `driveWaiting` |

In the judgments 4 and 5, `β` is the verb and `ρ` is the place. `h` is the depth, and `ε` is the list of the effects. The root document has the place `[]` and the depth `0`.

The plan and the reference share the code of the judgments 1 to 3 (D15). Thus `agree` cannot find a bug in that code. A third reading of these rules can find it (K95).

## 1. The parts of a document

`partsOf` reads a value by the contracts of the world. The plan, the reference and the static kit read each document with it (DOC.PARTS-OF). The three rules have an order.

```text
P-PART  [EVAL.ERRORS, LADDER.NO-GUESS]
    v is no envelope        τd = ·
    ──────────────────────────────
    W ⊢ v : τd ⇝ ✗

P-ENVELOPE  [DOC.PARTS-OF, LADDER.ENVELOPE-WINS]
    v = ⟨τ, v'⟩ is an envelope        W ⊢ τ ⇒ κ̂        κ̂.parts ⊢ v' ⇝ s
    ──────────────────────────────────────────────────────────────────
    W ⊢ v : τd ⇝ ⟨v, κ̂, s⟩

P-BARE  [LADDER.DECLARED, EVAL.DECLARED]
    v is no envelope        τd ≠ ·        W ⊢ τd ⇒ κ̂        κ̂.parts ⊢ v ⇝ s
    ──────────────────────────────────────────────────────────────────
    W ⊢ v : τd ⇝ ⟨⟨τd, v⟩, κ̂, s⟩
```

In P-ENVELOPE, the declared type has no effect. In P-BARE, the document has no own entries. A type without a kind gives `κ̂ = ⊥`, and the value is data. The ladder then gives `#KIND?` (E-KIND). The ladder does not read the shape of a value, thus P-PART does not guess a type.

### The split of a value

`σ ⊢ v ⇝ s` splits a value by a shape (SHAPE.\*). The result is `ok(p̄, δ, fill)`, or `bad(ℓ)` with the path `ℓ` of the problem in the value. Each part has its path `ℓ`, its JSON, the type `of` that its position declares and the mark `address`. The split visits the value in its order, and the first problem stops it.

```text
SPLIT-NONE  [SHAPE.RECORD]
    σ = none, or the kind has no shape
    ──────────────────────────────────
    σ ⊢ v ⇝ ok([], v, q̄ ↦ v)

SPLIT-DATA  [SHAPE.DATA]
    σ = text, number(whole?, min?, max?) or one(v̄)        v is a member of σ
    ──────────────────────────────────
    σ ⊢ v ⇝ ok([], v, q̄ ↦ v)            a value that is not a member gives bad

SPLIT-TERM  [SHAPE.KINDS, FORMULA.ADDRESS]
    σ = term(of?, kinds?, address?)
    kinds is absent, or the type of v starts with one of kinds (a bare v has the type [of])
    ──────────────────────────────────
    σ ⊢ v ⇝ one part (ℓ, v, of, address)            else bad

SPLIT-LIST  [SHAPE.DISTINCT, EVAL.DECLARED]
    σ = list(item?, of?, distinct?)        v is a list
    with distinct, no two items are equal by docEquals
    each item splits by item, or by term(of) when item is absent
    ──────────────────────────────────
    σ ⊢ v ⇝ the parts of the items, in order            a list of a data shape is data

SPLIT-RECORD  [SHAPE.RECORD, SHAPE.REQUIRED, SHAPE.CLOSED, SHAPE.PROTO]
    σ = record(fields, rest?, required?, closed?), or σ = map(item?, of?)        v is a plain record
    each name of required is an own field of v
    with closed, each field of v is a named field
    a named field splits by its shape, and each other field by rest, or by none
    a map splits each field by item, or by term(of)
    ──────────────────────────────────
    σ ⊢ v ⇝ the parts of the fields, in the order of the own keys of v

SPLIT-DEEP  [SHAPE.DEEP]
    σ = deep(of?)
    ──────────────────────────────────
    σ ⊢ v ⇝ a part for each envelope at each depth of v, and the rest is data

SPLIT-FILL  [EVAL.FILL]
    σ ⊢ v ⇝ ok(p̄, δ, fill)
    ──────────────────────────────────
    fill(q̄) is v with qi at the path ℓi of each part pi
    the containers on the way to a part are new, and the other data stays the same objects
    δ is v without the parts: a field that holds a part is absent, and a list of only parts gives null
```

A list shape needs a list, and a record shape or a map needs a plain record. The reason of `bad(ℓ)` names the path `ℓ` and the kind. A field with the name `__proto__` stays a field.

## 2. The ladder

### The lookup of a kind

`W ⊢ τ ⇒ κ̂` walks the keys of a type from the root of the world. The state holds the keys `k̄` that stay, the entries `T` and the fallback `φ` of one level, and the count `a` of aliases. The rules apply to the first key `k` of the keys, in their order.

```text
K-START  [WORLD.ALIAS, WORLD.EXPANDED, COMPOSE.CONSERVATIVE]
    keys(τ) = k̄        W.kinds, W.fallback, 0 ⊢ k̄ ⇒ κ̂
    ─────────────────────────────────────
    W ⊢ τ ⇒ κ̂
    keys(s) = [s]        keys([k, …]) = [k, …]        keys(⟨ref, [world, k, …]⟩) = [k, …]

K-COMPUTED  [WORLD.NO-KIND]
    τ = ⟨ref, [world, …]⟩ has a step that is not a key
    ─────────────────────────────────────
    W ⊢ τ ⇒ ⊥

K-FALLBACK  [WORLD.FALLBACK, WORLD.OPEN]
    T has no entry k        φ = κ
    ─────────────────────────────────────
    T, φ, a ⊢ k k̄ ⇒ κ                  the keys after k are not read

K-UNKNOWN  [WORLD.NO-KIND]
    T has no entry k        the level has no fallback
    ─────────────────────────────────────
    T, φ, a ⊢ k k̄ ⇒ ⊥

K-ALIAS  [WORLD.ALIAS, WORLD.ALIAS-EVAL]
    T(k) = alias([world, j̄])        j̄ are keys        a + 1 ≤ 32
    W.kinds, W.fallback, a + 1 ⊢ j̄ k̄ ⇒ κ̂
    ─────────────────────────────────────
    T, φ, a ⊢ k k̄ ⇒ κ̂

K-ALIAS-LIMIT  [WORLD.ALIAS-LIMIT]
    T(k) is an alias        a + 1 > 32
    ─────────────────────────────────────
    T, φ, a ⊢ k k̄ ⇒ ⊥

K-NAMESPACE  [WORLD.FALLBACK]
    T(k) = ns(T', φ')        k̄ ≠ []        T', φ', a ⊢ k̄ ⇒ κ̂
    ─────────────────────────────────────
    T, φ, a ⊢ k k̄ ⇒ κ̂

K-KIND  [WORLD.ALIAS]
    T(k) = κ        k̄ = []
    ─────────────────────────────────────
    T, φ, a ⊢ k ⇒ κ

K-NOT-A-KIND  [WORLD.NO-KIND]
    no rule above applies: a kind before the last key, a namespace at the last key, no keys,
    or an alias whose target is not a list of keys from world
    ─────────────────────────────────────
    T, φ, a ⊢ k̄ ⇒ ⊥
```

An alias starts the walk again at the root of the world. Thus the fallback of the world serves only the first key, and the fallback of a namespace serves only the keys in it.

### The ladder of a verb

`ladder(H, o, κ̂, β)` finds the code that answers the verb `β` for a document with the own entries `o` and the kind `κ̂`. `H` is a test of a name. For the verb of an evaluation, `H` passes each name. For `deref` and `step`, `H` passes only the names of code that the machine has. The rules have an order.

```text
L-OWN  [LADDER.OWN, LADDER.OWN-ONLY, EVAL.OWN]
    β is an own key of o        H(o(β))
    ─────────────────────────────────────
    ladder(H, o, κ̂, β) = own o(β)

L-STOP  [LADDER.UNKNOWN]
    κ̂ = ⊥
    ─────────────────────────────────────
    ladder(H, o, κ̂, β) = stop

L-KIND  [LADDER.KIND, VERB.LADDER]
    κ̂ = κ        β is an own key of κ.verbs        H(κ.verbs(β))
    ─────────────────────────────────────
    ladder(H, o, κ̂, β) = kind κ.verbs(β)

L-DEFAULT  [LADDER.DEFAULT, COMPOSE.CONSERVATIVE]
    β is an own key of W.defaults        H(W.defaults(β))
    ─────────────────────────────────────
    ladder(H, o, κ̂, β) = default W.defaults(β)

L-NONE  [LADDER.NO-ANSWER]
    ─────────────────────────────────────
    ladder(H, o, κ̂, β) = none
```

One function serves each verb (VERB.LADDER, VERB.PREPARE). `ask` gives the answer with the record of each rung, and `answerOf` gives it without the record. A document always has a type here, because P-PART stops a value without one. A classifier can propose a kind from the shape of a value, but only before the ladder, as a tag (CLASSIFY.TAG).

## 3. The steps of a path

`M, Γ ⊢ π ⇒ t` resolves a path from a root of the context. One resolution keeps one count `c` of collapses, also through the paths of the references that it follows. `adopt` is the function `adopt` of the machine, or the identity.

```text
R-NO-ROOT  [DEREF.NO-ROOT]
    π = [], or π0 is not self, names, world, event or caps
    ─────────────────────────────────────
    M, Γ ⊢ π ⇒ err(#REF!)

R-CLOSED  [DEREF.ROOTS]
    the machine gives the open roots, and π0 is not one of them
    ─────────────────────────────────────
    M, Γ ⊢ π ⇒ err(#REF!)

R-WALK  [DEREF.ROOT, DEREF.ADOPT]
    t0 = collapse(adopt(Γ.π0))
    ti = collapse(adopt(hop(t(i-1), πi, i)))        for i = 1 … m, and the first error stops the walk
    ─────────────────────────────────────
    M, Γ ⊢ [π0, π1, …, πm] ⇒ tm

R-HOST-PATH  [DEREF.PATH]
    t(i-1) is a host thing with resolve        πi, …, πm are keys
    ─────────────────────────────────────
    the walk ends with collapse(adopt(u)) when t(i-1).resolve([πi, …, πm]) = {thing: u}
    the walk ends with err(#N/A) when that call gives undefined
```

The hop of one step is the code of the verb `deref` for a key, or of the verb `step` for a step document. These rules have an order.

```text
R-KEY  [DEREF.ROOT, DEREF.CODES]
    πi = k is a key        step(t, k) = t'
    ─────────────────────────────────────
    hop(t, k, i) = t'

R-NAME  [DEREF.CODES, EVAL.NAME]
    πi = k is a key        step(t, k) = miss        π0 = names        i = 1
    ─────────────────────────────────────
    hop(t, k, i) = err(#NAME?)

R-MISS  [DEREF.MISS, DEREF.CODES]
    πi = k is a key        step(t, k) = miss
    ─────────────────────────────────────
    hop(t, k, i) = err(#N/A)

R-WALKER  [VERB.LADDER, DEREF.WALK-CODE]
    πi = s is an envelope        ladder(H, own(s), lookup(type(s)), step) = w, with H for the walkers
    walkers(w)(data = s.value, here = t, context = Γ, deref = adopt ∘ step) = ok(u)
    ─────────────────────────────────────
    hop(t, s, i) = u
    a failure with a code c gives err(c), and a failure without a code gives err(#N/A)

R-NO-WALKER  [VERB.LADDER, DEREF.NO-WALKER]
    πi is no key, and it is no envelope, or no rung of step answers for it
    ─────────────────────────────────────
    hop(t, πi, i) = err(#STEP?)
```

A step with a key. These rules have an order.

```text
S-HOST  [DEREF.HOST, DEREF.HOST-UNDEFINED, DEREF.SYMBOL]
    t is a host thing
    ─────────────────────────────────────
    step(t, k) = t.deref(k)        when that is not undefined
               = undefined         when t.deref(k) is undefined and t.has(k) = true
               = miss              else

S-CODE  [VERB.LADDER]
    t is an envelope        the machine is not plain
    ladder(H, own(t), lookup(type(t)), deref) = n, with H for the derefs
    ─────────────────────────────────────
    step(t, k) = derefs(n)(t, k), and miss when that is undefined

S-VALUE  [VERB.LADDER]
    t is an envelope        the machine is not plain        no rung of deref answers, also after a stop
    ─────────────────────────────────────
    step(t, k) = field(t.value, k)

S-FIELD  [DEREF.CODES, DEREF.PLAIN]
    no rule above applies
    ─────────────────────────────────────
    step(t, k) = field(t, k)

FIELD  [DEREF.CODES]
    field(v, k) = the length of v        v is a list, and k = length
                = v[i]                   v is a list, and k is an index i in it, or the text of i
                = v[k]                   v is an object with the own field k, also when it holds undefined
                = miss                   else
```

The collapse follows a reference document that a step reaches. A reference document is an envelope of the type `ref` with a list as its value. These rules have an order.

```text
C-PLAIN  [DEREF.PLAIN]
    the machine is plain
    ─────────────────────────────────────
    collapse(t) = t

C-REF  [DEREF.COLLAPSE, DEREF.READER, WORLD.WALK]
    t = ⟨ref, π'⟩ is a reference document        c + 1 ≤ 64
    M, Γ ⊢ π' ⇒ t'        with the same Γ and the count c + 1
    ─────────────────────────────────────
    collapse(t) = collapse(adopt(t'))

C-LIMIT  [DEREF.CYCLE, DEREF.COLLAPSE-LIMIT]
    t is a reference document        c + 1 > 64
    ─────────────────────────────────────
    collapse(t) = err(#CYCLE!)

C-DONE  [DEREF.COLLAPSE]
    t is no reference document
    ─────────────────────────────────────
    collapse(t) = t
```

In C-REF, the inner path resolves in `Γ`: the context of the resolution that reached the reference. This is the context of the reader, not the context of the writer (DEREF.READER). The thing of the root `world` holds each alias as a reference document, thus a walk through the world follows an alias.

```text
R-SAME  [DEREF.QUICK, PLAN.PATH-SAME, PLAN.KIND-MEMO]
    the short path of a resolution without hops, a compiled path and the memo of the kinds
    give the thing, the error and the reason of the rules above, and the host sees the same calls
```

## 4. The evaluation of a document

In these rules, `⟨d, κ̂, s⟩` are the parts of `v`, and `o` holds the own entries of `d`. `ladder` is `ladder(H, o, κ̂, β)`, where the test `H` passes each name. The rules have an order, from E-PART to E-RUNNER.

```text
E-PART  [EVAL.ERRORS, DOC.PARTS-OF]
    W ⊢ v : τd ⇝ ✗
    ─────────────────────────────────────
    M, Γ ⊢ᵦ v : τd @ ρ, h ⇓ err(#PART?, ρ) ! []

E-DEPTH  [PLAN.DEPTH, FORMULA.DEPTH]
    h > maxDepth        the default of maxDepth is 1000
    ─────────────────────────────────────
    M, Γ ⊢ᵦ v : τd @ ρ, h ⇓ err(#DEPTH!, ρ) ! []

E-KIND  [WORLD.NO-KIND, LADDER.UNKNOWN]
    ladder = stop
    ─────────────────────────────────────
    M, Γ ⊢ᵦ v : τd @ ρ, h ⇓ err(#KIND?, ρ) ! []

E-NOEVAL  [LADDER.NO-ANSWER, COMPOSE.SELF-EXTEND]
    ladder = none, or ladder = n and the machine has no runner and no evaluator n
    ─────────────────────────────────────
    M, Γ ⊢ᵦ v : τd @ ρ, h ⇓ err(#NOEVAL, ρ) ! []

E-SHAPE  [SHAPE.REQUIRED, SHAPE.DATA, SHAPE.CLOSED]
    s = bad(ℓ)
    ─────────────────────────────────────
    M, Γ ⊢ᵦ v : τd @ ρ, h ⇓ err(#VALUE!, ρ) ! []

E-GAP  [REF.DIRECT]
    in the reference only: the code of n is compiled, and the definitions have no code for n
    ─────────────────────────────────────
    M, Γ ⊢ᵦ v : τd @ ρ, h ⇓ err(#NOEVAL, ρ) ! []

E-APPLY  [EVAL.OWN, EVAL.SEALED, VALUE.ANY, EVAL.DETERMINISTIC]
    ladder = n        s = ok(p̄, δ, fill)        F = M.E(n), and M.R has no n
    qi = seal(pi, ρ, h)        for each part pi
    F⟨d, δ, fill(q̄), q̄, Γ, ρ⟩ = r ! ε
    ─────────────────────────────────────
    M, Γ ⊢ᵦ v : τd @ ρ, h ⇓ place(r, ρ) ! ε

E-RUNNER  [RUN.WAIT, RUN.DRIVE-NESTED, MACHINE.RUNNER]
    ladder = n        M.R(n) = G        M, Γ ⊢ᵦ v : τd @ ρ, h ⇓ S ! ε, by the rule ST-RUNNER
    ─────────────────────────────────────
    M, Γ ⊢ᵦ v : τd @ ρ, h ⇓ place(drive(S), ρ) ! ε

E-THROW  [VALUE.THROW, VALUE.DEPTH, PLAN.FAIL-LATE]
    the code F or G throws x, when it compiles d or when it evaluates d
    ─────────────────────────────────────
    M, Γ ⊢ᵦ v : τd @ ρ, h ⇓ place(thrown(x), ρ) ! ε
    thrown(Failure(e)) = e
    thrown(an overflow of the stack of the host) = err(#DEPTH!)
    thrown(x) = err(#CALC!), with the cause x
```

In the reference, `F` is the definition of `n` when the definitions give one. In the plan, a compiler makes code from `d` and the compiled parts one time. Then the code gets the context and the runtime at each evaluation.

The handle of a part, and the context of a part:

```text
H-SEAL  [EVAL.SEALED, EVAL.BY-NAME]
    seal(p, ρ, h) = ⟨the key and the path ℓ of p, the name x of p, eval⟩
    eval(Γ') = r        when        M, part(Γ, Γ', ℓ) ⊢ᵦ p : of @ ρ·ℓ, h + 1 ⇓ r ! ε'
    each call of eval is a new evaluation, and ε' joins the effects in the order of the calls

H-CONTEXT  [CAP.NARROW, CAP.CONTRACT, CAP.ONLY, CAP.MONOTONE]
    part(Γ, Γ', ℓ) = rules(κ.caps, ℓ, narrow(Γ, Γ'))        Γ' = Γ when the code gives no context
    narrow(Γ, Γ') = Γ' with caps = [c in Γ'.caps such that permits(Γ.caps, c)]
    rules(γ̄, ℓ, Γ) = Γ with caps = []                when a rule mask covers ℓ
                   = Γ with caps = Γ.caps ⊓ L1 ⊓ …   for each rule only Li that covers ℓ
                   = Γ                               else

H-GRANT  [CAP.NARROW-CODE, CAP.LATENT]
    in the plan, a context Γ can carry a grant g(Γ): the capabilities that the kernel gave its document
    a spread of Γ keeps g(Γ), and a context that the code makes without a spread has no grant
    at the start of each document, and at each effect of compiled code, the kernel takes grant(Γ):
        grant(Γ) = Γ                                    when g(Γ) is the same list as Γ.caps
                 = Γ with caps = [] and g = []          when Γ has no grant
                 = Γ with caps = C and g = C            else, with C = [c in Γ.caps such that permits(g(Γ), c)]
    the root gets g = the capabilities of the host, and a part of a function evaluator gets g = the caps of narrow
    the rules of the contract apply after this step, as in H-CONTEXT

H-PLACE  [VALUE.FAILURES]
    place(err(c), ρ) = err(c, ρ)        place(r, ρ) = r for each other r
    thus an error keeps the place of the document where it started
```

`permits(caps, k̄)` holds when one capability is a prefix of the keys `k̄` of the effect, key by key (CAP.KEYS, CAP.NAMESPACE). `⊓` is the meet of two lists of capabilities (`intersectCaps`). A rule covers a part when one of its patterns `in` matches the path, or when it has no patterns.

`F` gets the data `δ`, the handles `q̄`, the context and also `d`. Thus the seal of D7 holds for code that keeps the obligation C5: it reads its parts only through their handles (EVAL.SEALED). A compiled evaluator gives its compiled parts a context directly, without a handle. Since K91, the grant of H-GRANT keeps C1 for such code (D32). The reference has no grant, because its definitions are function evaluators.

### The formula kit

These rules give the meaning `F(n)` of each construct of the formula kit, as `formulaDefinitions` writes it. `q()` is the result of the handle `q` in the context of the document, and `q(Γ')` is its result in the context `Γ'`.

`values(q̄)` evaluates the handles in order, and the first error stops it. With the rule `combine` of the profile, each handle evaluates. One error stays itself, and two or more errors give `combine(errors)` (FORMULA.COMBINE). The rules F-REF-STEPS, F-STEP and F-CALL use `values` without `combine`.

```text
F-LIT  [FORMULA.LIT]
    F(lit)⟨d⟩ = ok(d.value)

F-REF  [FORMULA.REF, EVAL.PATH, FORMULA.ADDRESS, FORMULA.LET]
    F(ref)⟨d⟩, with π = d.value, in this order:
        π is no list, or π = []                       ⇒  err(#VALUE!)
        π = [names, x, …] and Γ.names(x) = held(e)    ⇒  err(e)
        M, Γ ⊢ π ⇒ err(c)                             ⇒  err(c)
        M, Γ ⊢ π ⇒ t, and d is at an address          ⇒  ok(t)
        value(t) = held(e)                            ⇒  err(e)
        the rule missing of the profile holds         ⇒  err(#N/A)
        else                                          ⇒  ok(value(t))
    value(t) = t.toJson() for a host thing, and t for each other thing

F-REF-STEPS  [FORMULA.STEPS]
    a language gives the kind ref a deep shape, thus the step documents of π are the parts q̄
    F(ref)⟨d⟩ = the first error of values(q̄), or F-REF with the path fill(values(q̄))
    the steps evaluate before the test of a held name

F-STEP  [FORMULA.STEPS]
    F(step)⟨d⟩ = ok(d) without parts, and ok(d with the value fill(values(q̄))) with parts

F-RECORD  [FORMULA.RECORD, FORMULA.COMBINE]
    F(record)⟨q̄⟩ = ok({ℓ1: u1, …}) when values(q̄) = ū
    a field whose error e passes the rule omit of the profile is absent

F-LIST  [FORMULA.LIST, FORMULA.COMBINE]
    F(list)⟨q̄⟩ = ok([u1, …, um]) when values(q̄) = ū, and the error else

F-LET  [FORMULA.LET]
    bi = qi()        for each binding xi, in order: each binding sees the names around the let
    F(let)⟨q̄⟩ = q_body(Γ with names = Γ.names + {xi: ui when bi = ok(ui), and held(e) when bi = err(e)})

F-FN  [FORMULA.FN, FORMULA.FN-PARAMS, CAP.LATENT]
    params is a list of different texts x̄, else err(#VALUE!)
    F(fn)⟨q̄⟩ = ok(f), and f(ū) = u when q_body(Γ with names = Γ.names + {x̄: ū}) = ok(u)
    f(ū) throws Failure(e) when the body gives err(e)
    the closure keeps Γ, thus it keeps the capabilities of the document that made it

F-CALL  [FORMULA.FN]
    q_fn() = err(e) ⇒ err(e)        q_fn() = ok(f), and f is no function ⇒ err(#VALUE!)
    q_fn() = ok(f)        values(q_args) = ū        ⇒ ok(f(ū)), and a throw of f follows E-THROW

F-IF  [FORMULA.IF, EVAL.LAZY-IF, FORMULA.OTHERWISE]
    q_test() = err(e) ⇒ err(e)
    q_test() = ok(u):  truthy(u) = true ⇒ q_then()        truthy(u) = false ⇒ q_else()
                       no else ⇒ ok(otherwise), and the default of otherwise is null
                       truthy(u) is not a truth ⇒ err(#VALUE!)

F-AND  [FORMULA.LOGIC]
    the terms evaluate in order: an error stops them, and a value without a truth gives err(#VALUE!)
    the first false term gives ok(false), and ok(true) comes after the last term
    with the logic value of the profile, the result is the term that decided, or the last term

F-OR  [FORMULA.LOGIC]
    as F-AND, with true and false in the place of each other

F-OP  [FORMULA.OPS, FORMULA.LAZY, FORMULA.COMBINE]
    x = the keys of the type after ops, with dots between them
    x is a lazy operation λ of the profile        ⇒  λ([q1, …, qm])
    the profile has no operation x                ⇒  err(#NAME?), and no argument evaluates
    values(q̄) = ū                                ⇒  check(op(ū), x) when that gives a result, else ok(op(ū))

F-EXT  [FORMULA.EXT, FORMULA.EXT-CONTEXT]
    x = the keys of the type after ext
    the profile, or the standard extensions, give the handler g of x        ⇒  g(d.value, Γ, M.domains)
    no handler                                                              ⇒  err(#NAME?)

F-EXT-DOMAIN  [EXT.DOMAIN]
    x = domain, the profile has no extension x, and d.value = { domain: n, data: j }
    M.domains has no domain n, or n has no codec                            ⇒  err(#NAME?)
    decode_n(j) throws, or decode_n(j) = v and v is not a member of n       ⇒  err(#VALUE!)
    decode_n(j) = v and v is a member of n                                  ⇒  ok(v)
    another form of d.value                                                 ⇒  err(#VALUE!)
```

### The decorated tree

The evaluator `tree.node` of the kinds `panel` and `box` gives the decorated tree of D16. Each node `ν` is a host thing, and each part `qa` is an attribute `a`. Each node keeps one cell `state(ν, a)` for each attribute, for one evaluation. The node reads `Γ.self` only through `resolve` (C4, D44). Thus the list of reads and the static facts hold the read of `self`.

```text
T-NODE  [TREE.LAZY, TREE.RESULT, TREE.PURE, TREE.SELF]
    resolve(self) gives a node of an open tree  ⇒  F(tree.node) = ok(ν), and no attribute evaluates
    else                                    ⇒  ν is the root of a new tree, and F(tree.node) = json(ν)
    json(ν) gives each attribute in the order of the parts, with the JSON of each node in a value

T-STEP  [TREE.PARENT, TREE.SIBLING]
    step(ν, parent) = resolve(self)        step(ν, type) = the kind of ν        step(ν, a) = demand(ν, a)

T-DEMAND  [TREE.ONCE, TREE.MEMO, TREE.ORDER-FREE]
    state(ν, a) = done(r)        ⇒  demand(ν, a) = r
    state(ν, a) = new            ⇒  state(ν, a) := pending, r = rungs(ν, a),
                                    state(ν, a) := done(r), and demand(ν, a) = r

T-CYCLE  [TREE.CYCLE]
    state(ν, a) = pending        ⇒  demand(ν, a) = err(#CYCLE!), with the chain of the attributes
    the error gets the place of the reference that closed the cycle

T-ERROR  [TREE.ERROR]
    demand(ν, a) = err(e) in a step        ⇒  the reference gives e, with its code, reason, place and cause
```

The contract `κ.tree` of a kind gives equations (D42). `κ.tree.equations(a)` gives the attribute `a` of a node of the kind. `κ.tree.down(a)` gives the attribute `a` of each child. `κ.tree.attributes(a)` declares `copy`, a `fold` or a `default`. In these rules, `μ` is the parent of `ν` in the same tree, and `κν` is the kind of `ν`. `eq(ν, t, N)` evaluates the term `t` with `self = ν`, the names `N` and no capabilities. `rungs(ν, a)` takes the first rule that applies, in this order.

```text
T-LADDER  [TREE.LADDER, TREE.RUNGS]
    qa is a part of ν                       ⇒  rungs(ν, a) = qa(Γ with self = ν)                  own
    κν.tree.equations(a) = t                ⇒  rungs(ν, a) = eq(ν, t, {})                         kind
    κμ.tree.down(a) = t                     ⇒  rungs(ν, a) = eq(μ, t, names(μ, ν))                parent
    κν.tree.attributes(a) declares copy     ⇒  rungs(ν, a) = demand(μ, a)                         copy
    κν.tree.attributes(a) declares a fold   ⇒  rungs(ν, a) = fold(ν, a)                           default
    κν.tree.attributes(a).default = t       ⇒  rungs(ν, a) = eq(ν, t, {})                         default
    else                                    ⇒  rungs(ν, a) = err(#N/A)
    trace(ν, a) gives the rungs that the demand visited, and the rung that answered

T-DOWN  [TREE.DOWN, TREE.DOWN-NAMES]
    demand(μ, children) = ok([u0, …, un])
    names(μ, ν) = {child: ν, index: i, prev: ui-1}        when ui = ν, with prev = null when i = 0
    names(μ, ν) = {child: ν, index: null, prev: null}     when ν is no item of the list

T-COPY  [TREE.COPY]
    ν has no parent μ        ⇒  the rung copy does not apply, and the rung default tries

T-FOLD  [TREE.FOLD]
    fold(ν, a) = eq(ν, unit, {})                          when ν has no attribute children
    fold(ν, a) = combine(… combine(eq(ν, unit, {}), demand(ν1, a)) …, demand(νk, a))
        where ν1 … νk are the nodes of the tree in demand(ν, children), in their order
        and combine(x, y) = eq(ν, κν.tree.attributes(a).fold.combine, {acc: x, item: y})
    the first err of the unit, of a child or of combine is the result of the fold
```

The equations of a kind are not parts of a document. Thus the plan of a document holds none of them, and a cache of the machine keeps each compiled equation (TREE.PLAN).

## 5. The run side

The run judgment gives steps `S`: `done(r)`, or `wait(p, k)` with a promise `p` of the host and the rest `k` of the computation. A runner takes the steps of a part or of an effect with `yield*`. The error rules E-PART to E-SHAPE give `done(err(c, ρ))`.

```text
ST-EVALUATOR  [RUN.SAME, RUN.EAGER]
    the code of d is an evaluator, and E-APPLY gives r ! ε
    ─────────────────────────────────────
    M, Γ ⊢ᵦ v : τd @ ρ, h ⇓ done(r) ! ε            the code runs in the first step

ST-RUNNER  [RUN.SEQ, RUN.EAGER, SEQ.LAST, SEQ.NAMES]
    ladder = n        M.R(n) = G        qi is the run handle of the part pi
    qi(Γ') = S'        when        M, part(Γ, Γ', ℓi) ⊢ᵦ pi : of @ ρ·ℓi, h + 1 ⇓ S'
    G⟨d, δ, fill(q̄), q̄, Γ, ρ, effect, all⟩ = S
    ─────────────────────────────────────
    M, Γ ⊢ᵦ v : τd @ ρ, h ⇓ S, with place(·, ρ) on its result

ST-SEQ  [SEQ.LAST, SEQ.NAMES, SEQ.LAWS]
    the runner control.seq gets the steps q1 … qm, and xi is the header of qi when qi has one
    Γ1 = Γ        qi(Γi) = ok(ui)        Γ(i+1) = Γi with names + {last: ui} + {xi: ui}
    ─────────────────────────────────────
    the sequence gives ok(um), or ok(null) when m = 0
    the first step that gives err(e) stops the steps, and the sequence gives err(e)
```

The steps of a sequence see the names around it. A step sees `last` and the headers of the earlier steps of its own sequence, and of each sequence around it (C7).

### Effects

The rules X-CAP and X-RECORD apply to each effect in each handler, after the rule X-NEEDS-RUNNER of a run.

```text
X-CAP  [RUN.CAP, CAP.HOOK, CAP.PURE, RUN.PURE, CAP.MONOTONE]
    allowed(Γ, k̄) = M.permits(Γ.caps, k̄, Γ) when the machine has the hook, else permits(Γ.caps, k̄)
    allowed(Γ, k̄) is false
    ─────────────────────────────────────
    effect(k̄, u) at ρ gives err(#CAP!, ρ), and the host does not see the effect

X-RECORD  [RUN.ADDRESS, RUN.EFFECT, EFFECT.ORDER]
    allowed(Γ, k̄)        a = prefix · placeText(ρ) · # · count(ρ)
    ─────────────────────────────────────
    effect(k̄, u) at ρ adds (k̄, u, ρ, Γ, a) to ε, and count(ρ) goes up by one
    the root has one scope with the prefix "" and its own counts
    the item i of the n-th all of a scope is a scope with the prefix: prefix · all<n>.<i>/
```

### The two handlers

An evaluation and a run evaluate the same steps. The handler `evaluate` does not wait, and the handler `run` waits for the host (D11). The plan, `evaluate` and the reference use the first handler. `run` and `plan.run` use the second handler.

```text
X-EVALUATE  [RUN.EVAL, RUN.MOCK, RUN.OUTCOME]
    the handler evaluate, or an effect of a runner in a run without perform: the effect does not wait
        no mock                         ⇒  ok(u)
        the mock gives a                ⇒  ok(a)
        the mock throws Failure(e)      ⇒  place(err(e), ρ)
        the mock throws x               ⇒  err(#CALC!, ρ), with the cause x
        the mock gives a promise        ⇒  err(#CALC!, ρ)
    the outcome of the effect is this result

X-RUN  [RUN.SEQ, RUN.CAUSE, RUN.OUTCOME]
    the handler run with perform, for an effect of a runner
        perform(e) = a, and a is no promise      ⇒  done(ok(a))
        perform(e) = a promise p                 ⇒  wait(p, a ↦ done(ok(a))), and a rejection x gives done(failed(x))
        perform throws x                         ⇒  done(failed(x))
    failed(Failure(e)) = place(err(e), ρ), and failed(x) = err(#CALC!, ρ) with the cause x
    the outcome of the effect is this result, and a run that stops at the wait gives it no outcome

X-NEEDS-RUNNER  [RUN.NEEDS-RUNNER]
    the handler run:
        an effect of an evaluator                        ⇒  err(#CALC!, ρ), before X-CAP

DRIVE  [RUN.WAIT, RUN.EVAL, RUN.DRIVE-NESTED, RUN.NESTED-WAIT]
    drive(done(r)) = r
    drive(wait(p, k)) = err(#CALC!), and the steps stop
    both handlers drive the code of a runner document under an evaluator, by the rule E-RUNNER
    in a run, its effects go to perform, and a promise of perform reaches drive as a wait
    the effect of that wait gets no outcome

WAIT  [RUN.SEQ, RUN.EAGER]
    run(done(r)) = r
    run(wait(p, k)) = run(k(a)) when p gives a, and run(k throws x) when p rejects with x
    the steps before the first wait happen in the call

ABORT  [RUN.ABORT]
    the signal of the host aborts the run        ⇒  err(#ABORT), and the steps stop

ALL  [RUN.ALL, RUN.FAIL-FAST, RUN.REPLAY]
    all(q̄, limit, failFast) starts the items in order, with at most limit items at one time
    each item goes on until it gives done(r) or waits, in its own scope of addresses
    the handler evaluate: a wait of an item makes all wait, thus drive gives #CALC!
    the handler run: the next wait that settles resumes its item, and more items start
    a replay settles the waits in the order of its journal
    with failFast, the first error stops all: the items that wait stop, the items that did not start
    do not start, and each of these items gives err(#ABORT)
    all gives the results in the order of the items
```

Only two things make the handlers differ: an effect of an evaluator (X-NEEDS-RUNNER), and a promise of `perform`. A runner under an evaluator does not make them differ (K110). Thus one meaning holds without a condition of the check:

```text
RUN-SAME  [RUN.SAME, RUN.MOCK, RUN.DRIVE-NESTED]
    no evaluator of d causes an effect      the code of M keeps C2 and C6
    perform answers each effect at once, with the answers of the mock
    ─────────────────────────────────────
    run(M, d, Γ, perform) and evaluate(M, d, Γ, mock) give the same result
```

## The obligations of host code

The soundness claims hold for a machine whose host code keeps these obligations. The kernel keeps C1 (H-CONTEXT and H-GRANT). Each other obligation is a promise of the author of the code.

| ID | Obligation | Who keeps it today | The claims that need it |
| --- | --- | --- | --- |
| C1 | Each context that an evaluator gives a part has only capabilities that the context of its document permits. | The kernel: H-CONTEXT for function code, and H-GRANT for compiled code since K91 (D32). A context that compiled code keeps from an earlier call escapes H-GRANT (K120). | CAP.NARROW, CAP.NARROW-CODE, CAP.EFFECTS-SOUND, PLAN.AGREES |
| C2 | The code causes only the effects that its contract declares. | The author. An own entry for another evaluator has no contract (K64). | CAP.EFFECTS-SOUND, STATIC.AGREES |
| C3 | Each part that no lazy rule covers evaluates in each evaluation that gives a value. | The author | FACTS.LAZY |
| C4 | A kind with the mark `pure` reads the context only through `resolve`, and it causes no effect. | The author. The probe of a fold refuses a direct read of `self`, `event` and `names` (D43). The tree node keeps C4 since K149 (D44). | FACTS.SOUND, READS.SOUND, PLAN.FOLD |
| C5 | The code reads its parts only through their handles, not through `doc.value`. | The author | EVAL.SEALED |
| C6 | Only a runner waits, and it passes each wait of its parts through. | The author (K65) | RUN.CAN-WAIT |
| C7 | The names that the code binds for a part are the names of the scope rules of its kind. | The author | STATIC.AGREES, TYPE.SOUND |
| C8 | A formula profile, and each table that compiled code reads, gives the same answer for the same name at each time. | The author (K111) | PLAN.AGREES |

The plan reads a profile when it compiles, and the reference reads it when it evaluates. C8 makes the two reads give one answer.

`conforms(machine, name)` examines one evaluator or runner against these obligations (K92, D36). It starts the code directly with probe parts and a probe runtime. Each probe part records when it evaluates, how often, in which order and with which context. The probe runtime records each resolution, each effect and each wait. The contract of the kind gives the probe documents: the shape of the parts, the scope rules, the lazy rules and the effects.

| Obligation | The check of `conforms` | ID |
| --- | --- | --- |
| C1 | Each context that the code gives a part or an effect has only the capabilities of the document. The check sees the context before the kernel narrows it. | CONFORM.NARROW |
| C2 | Each effect is one that the contract declares. | CONFORM.EFFECTS |
| C3 | A result that is a value comes after each eager part evaluates. Each lazy part that evaluates has some result that changes the result. | CONFORM.LAZY |
| C4 | A pure kind causes no effect. Other values in the roots, with the same answers of `resolve`, give the same result. | CONFORM.PURE |
| C5 | Two documents whose parts have other JSON and the same results give the same result. | CONFORM.SEALED |
| C6 | An evaluator does not wait. A runner gives each wait of its parts to the host, and it gives back the answer of the host. | CONFORM.WAIT |
| C7 | Each part gets the names of its scope rules and the names of its document, and no other name. | CONFORM.SCOPE |
| C8 | Code of an earlier compilation and new code give the same record for each probe. | CONFORM.PROFILE |

The checks `local` and `agree` examine the premise of SIM-PLAN (CONFORM.LOCAL). `local` evaluates each probe again in another order and expects the same record. `agree` compares compiled code with its definition for the reference.

## Facts that SPEC did not state

The work on the rules found six facts that the code has and `SPEC.md` did not state. Each one has a requirement ID in `SPEC.md` and a test in `semantics.test.ts`.

| Fact | Rule | ID |
| --- | --- | --- |
| One resolution follows at most 64 references, also through the paths of the references. A long chain without a cycle also gives `#CYCLE!`. | C-LIMIT | DEREF.COLLAPSE-LIMIT |
| One lookup follows at most 32 aliases. A longer chain gives no kind, thus a document of that type gives `#KIND?`. | K-ALIAS-LIMIT | WORLD.ALIAS-LIMIT |
| A reference in the data resolves in the context of its reader. | C-REF | DEREF.READER |
| Each call of a handle is a new evaluation. The part evaluates again, and its effects happen again. | H-SEAL | EVAL.BY-NAME |
| In a run, an effect of an evaluator gives `#CALC!` at once, also without a wait. A runner under an evaluator starts, and only a real wait fails. | X-NEEDS-RUNNER, DRIVE | RUN.NEEDS-RUNNER, RUN.DRIVE-NESTED |
| A step that is not a key, and not a document of a kind with the verb `step`, gives `#STEP?`. | R-NO-WALKER | DEREF.NO-WALKER |

Two rows of `SPEC.md` got a condition. EVAL.SEALED holds for code that keeps C5. RUN.SAME holds when no evaluator causes an effect and the host answers at once.

## The simulation of the plan

The plan and the reference are two readings of the judgment 4. The relation `r ≈ r'` holds when two values are the same by `sameValue`, or when two errors have one code and one place.

```text
SIM-PLAN  [PLAN.AGREES, AGREE.EFFECTS]
    each code of M keeps the local lemma of the step 3        d is a document        Γ is a context
    ─────────────────────────────────────
    C⟦d⟧(Γ, rt) ≈ R⟦d⟧(Γ), and the two lists of effects are the same
    C⟦d⟧ is the code that compileNode gives, and R⟦d⟧ is evaluateAt
```

The argument goes by induction on the height of `d`.

1. **The kernel step.** `compileNode` and `examine` read `d` with the same `partsOf` and the same ladder. Thus they give the same error rule, or the same code `n` and the same parts.
2. **The narrowing.** `gated` and `narrow` give the plan the contexts that `contextOfPart` gives the reference. For compiled code, H-GRANT gives the same narrowing for each context that the code makes with a spread (K91, D32).
3. **The local lemma of `n`.** Each compiled part agrees with its handle in each context. Then the code of `n` over the compiled parts agrees with the definition of `n` over the handles.

By the steps 1 and 2, the hypothesis of the induction gives the premise of the step 3 for the parts of `d`. Each kit gives one lemma for each construct. `conforms` examines each lemma with probe parts, and the lemma of a kit with a profile needs C8.

Two limits apply. `sameValue` compares two closures by their parameters, thus `agree` is weaker than the claim for closures. And the claim holds only for the shared code of the judgments 1 to 3. An overflow of the stack of the host is the one permitted difference between the tiers (AGREE.ERRORS).

### The folds of the plan

A plan without a trace can fold a closed pure part (K13, D43). The part evaluates one time, when the plan compiles, and its code then gives that one result. The reference does not fold at any time.

```text
P-FREE  [PLAN.FOLD]
    free(⟨ref, [names, x, k̄]⟩) = {x}                           each step of k̄ is a key
    free(⟨ref, π⟩) = ⊤                                          for each other path π
    free(d) = ⋃ (free(pi) − sees(κ, i))                        for each other document, with its parts pi
    free(d) = ⊤                                                 when a part gives ⊤, or when d is not pure
    sees(κ, i) is the list of the names that the scope rules of κ give the part i (STATIC.REFS)

P-FOLD  [PLAN.FOLD, PLAN.SHARED]
    the plan has no trace, and the option fold is not false        free(d) = ∅
    d is not a runner, and the facts mark its code pure and not volatile        κ.side ≠ run        κ.effects = []
    C⟦d⟧(Γ₀, probe) = r, without a refusal and without an exception        r ≠ err(#DEPTH!)        r is plain data
    ─────────────────────────────────────
    C⟦d⟧(Γ, rt) = v at each evaluation, with v = freeze(copy(r)), the same object each time
    Γ₀ has traps for self, event and names, the world of M and no capabilities
    the probe resolves a path [names, x, k̄] only when the code bound x, and it refuses each other read
    a read that reaches reference data, an effect, a wait and a kept context are refusals too
```

The facts of the rule are the facts of D24, as `factsOf` reads them. A trap of a root refuses each read of a field, thus code that reads its context directly cannot fold. A copy of the names reads no field, thus `let` can fold. `copy` takes plain data: primitives, lists without holes, and records with the prototype of an object or no prototype. It keeps each object that an earlier fold made.

P-FOLD keeps SIM-PLAN. A pure code keeps C4, thus its result depends only on its data, its parts and what its paths reach. A closed part reaches only the names that it binds, and these are the same in each context. Thus `r` is the result of the part in each context, and the copy gives a value that `sameValue` finds the same. A list of reads gets each read of the part. Thus a folded part that reads its own names evaluates again when the evaluation records reads (READS.RECORD). The tier `folds` of `agree` compares the plan with folds and the plan without folds.

## The laws of the semantics

Property tests examine six laws on generated documents and machines (K93, D37). Each law follows from the rules of its row, and it holds only under its conditions. Each test counts the cases that a condition skips. The equations of effects come with S4.

| Law | ID | Rules | Conditions |
| --- | --- | --- | --- |
| A part that evaluates one time to a JSON value can change into a literal of that value. The parent gives the same result. | EVAL.SEALED | E-APPLY, H-SEAL | The code keeps C5. A kind whose code reads `doc.value` breaks the law, and the test finds it. |
| The same machine, document, context and mock give the same result, effects and reads, also after an evaluation in another context. | EVAL.DETERMINISTIC | E-APPLY, H-SEAL, T-DEMAND | Each code, each host thing and the mock are functions, and each formula profile keeps C8. An overflow of the stack of the host is the one exception (K94). |
| Fewer capabilities change an evaluation only at an effect that they refuse and more capabilities permit. | CAP.MONOTONE | H-CONTEXT, H-GRANT, X-CAP | The document does not read the root `caps`. The code keeps C1, and the hook `permits` permits more for more capabilities. |
| A merge that adds only new entries keeps the result of each document of the base. | COMPOSE.CONSERVATIVE | K-START, K-FALLBACK, L-DEFAULT | The document names no new kind and no new code. It reads no changed entry of the world. No new default answers a verb of the base. |
| The order of the demands changes no attribute. | TREE.ORDER-FREE | T-DEMAND, T-CYCLE | The tree has no cycle. A root gives the first error of its attributes in their order, thus that error can differ. |
| A sequence with one step gives the step. The steps at the end can go into a nested sequence. The steps at the start can too, when only the last of them has a name. | SEQ.LAWS | ST-SEQ | A name reaches only the later steps of its own sequence and of the sequences in them. |

Why each law holds:

- **EVAL.SEALED.** By E-APPLY, the code `F` reads a part only through its handle, when it keeps C5. A literal with the same result gives the same handle results, thus `F` gives the same result.
- **EVAL.DETERMINISTIC.** Each rule gives one conclusion for its premises. The only state of an evaluation is the memo of a tree and the counts of the addresses, and each evaluation makes them new (TREE.MEMO, X-RECORD).
- **CAP.MONOTONE.** The capabilities appear only in H-CONTEXT, H-GRANT and X-CAP. `narrow`, the meet and `permits` give more for more capabilities. Thus two evaluations are the same up to the first effect whose answers differ, and there the fewer capabilities refuse.
- **COMPOSE.CONSERVATIVE.** A new entry does not change the lookup of a key of the base, unless a fallback answered that key before (K-FALLBACK). A new default changes only a verb that no rung of the base answered (L-DEFAULT).
- **TREE.ORDER-FREE.** By T-DEMAND, an attribute is a function of the attributes that it demands. Only T-CYCLE reads the state `pending`, and the order of the demands decides where a cycle closes.
- **SEQ.LAWS.** By ST-SEQ, the names of a step depend only on the names before it and on the earlier results of its own sequence. A nested sequence starts with the names around it, and its names stay in it.

## What the calculus leaves out

- The reason and the cause of an error, the hops of a path, the trace and the list of reads.
- The rules of `check`, of the types and of the facts. Each one is an abstract version of a rule of this page (R5).
- The schedule and the durable cache. They evaluate documents by the judgment 4 (D30, D31).
- The kinds of the standard world other than the tree and `seq`. Their evaluators are host code, as each evaluator of a language is.
- A recursion of `fn` through `call` meets only the stack of the host, thus each tier stops at a different depth (K94).
