# R2: algebraic effects, handlers and the run side

This study compares the research on algebraic effects, effect handlers and effect systems with the run side of coeval (D9, D11). It ends with proposals, ranked by value for effort. It does not change the kernel. The coeval session decides which proposals go into `docs/ROADMAP.md`.

## The question

How do algebraic effects, handlers and effect types map onto the run side of coeval? What parts of this research does the kernel adopt, and in which order?

## The short answer

- The run side of coeval is already a small effect system. The root `perform` is one deep, one-shot handler, and the generators hold the continuation.
- The generators of the kernel carry only one effect: a wait. Each other effect goes from the place of the effect straight to the root, through the session.
- Thus the cheapest handler design evaluates a clause in place, with a handler frame that the context carries. This design is evidence passing.
- The static kit can infer the effects of a document from the contracts of its kinds, without type variables. Today it does not follow `pure` or a handler.
- A run records the payload of each effect, but not its outcome. Record and replay, tests with mocks and time travel each start with that outcome.

## Background

### Algebraic effects

Plotkin and Power describe an effect as a set of operations, with equations between them ([Plotkin and Power 2003](https://homepages.inf.ed.ac.uk/gdp/publications/alg_ops_gen_effects.pdf)). A program is a tree. Each node is an operation, and each branch is a possible result of the operation. The equations tell which trees mean the same thing. For example, two reads of the same cell commute, and a write followed by a read gives the written value.

For coeval, an operation is a call: an envelope whose type is the path of a procedure (D9). The equations are a new idea for the kernel. They tell a schedule which effects can change places (D3).

### Handlers

Plotkin and Pretnar add handlers ([Plotkin and Pretnar 2013](https://arxiv.org/abs/1312.1399)). A handler gives a meaning to some operations of a computation. Each clause of a handler gets the argument of the operation and a continuation: the rest of the computation. A clause can resume the continuation, ignore it, or resume it more than one time. Their examples include exceptions, state, rollback, timeouts and the redirection of a stream.

For coeval, a handler is a kind whose document intercepts the effects of its parts. A mock, a retry, a log of each call and a transaction are four handlers.

### Eff

Eff is a language that is built on algebraic effects and handlers ([Bauer and Pretnar 2015](https://arxiv.org/abs/1203.1539)). Its handlers are first-class values, and a program can make new instances of an effect at run time.

### Koka and effect rows

Koka gives each function a type with an effect row ([Leijen 2014](https://arxiv.org/abs/1406.2061)). A row is a list of effect labels with an optional tail variable. The tail variable makes a function polymorphic in the effects of its arguments. A `map` that takes a function `f` has the effects of `f`, and no more. The compiler of Koka uses the rows for a selective translation, thus only code with handled effects pays for the handlers ([Leijen 2017](https://www.microsoft.com/en-us/research/publication/type-directed-compilation-row-typed-algebraic-effects/)).

[Xie and others 2020](https://www.microsoft.com/en-us/research/publication/effect-handlers-evidently/) pass the handlers down as evidence, and each operation finds its handler at a known offset. A clause that resumes at its end (a tail-resumptive clause) runs in place, without a capture of the continuation. The authors report that most operations in practice are tail-resumptive.

### Effect handlers in OCaml 5

OCaml 5 adds effect handlers to a mature language ([Sivaramakrishnan and others 2021](https://arxiv.org/abs/2104.00250)). Each continuation is one-shot. A second resumption raises the exception `Continuation_already_resumed` ([the `Effect` module](https://ocaml.org/manual/5.2/api/Effect.html)). The design keeps the speed of existing code, and it gives generators, `async` and lightweight threads as libraries.

### Frank

Frank has no separate syntax for handlers ([Lindley, McBride and McLaughlin 2017](https://arxiv.org/abs/1611.09259)). A function that handles commands is an operator, and an operator can handle commands from several arguments at the same time (a multihandler). Frank uses shallow handlers. The effects of a function come from its context ("ambient" effects), thus the programmer writes few effect variables.

### Deep and shallow handlers

A deep handler stays around the continuation. It also handles the later operations of the same computation. A shallow handler handles only the first operation, and the program must install it again ([Kammar, Lindley and Oury 2013](https://doi.org/10.1145/2500365.2500590), [Hillerström and Lindley 2018](https://www.research.ed.ac.uk/en/publications/shallow-effect-handlers/)). The two kinds can simulate each other. A deep handler is a fold over the tree of operations. A shallow handler is one case split.

### One-shot and multi-shot continuations

A one-shot continuation resumes at most one time ([Bruggeman, Waddell and Dybvig 1996](https://doi.org/10.1145/231379.231395)). Its implementation does not copy the stack, thus it is fast. A multi-shot continuation can resume many times. Search, backtracking and the inference of probabilistic programs use multi-shot continuations: each resumption explores one branch.

### Generators as one-shot continuations

The `yield` of a mainstream language is a one-shot delimited continuation ([James and Sabry 2011](https://esdiscuss.org/topic/fyi-yield-mainstream-delimited-continuations-in-tpdc2011)). Asymmetric coroutines can express one-shot effect handlers and one-shot delimited control ([Kobayashi and Kameyama 2025](https://arxiv.org/abs/2509.11901)). No construct of this group can resume a continuation two times.

A JavaScript generator object has two more limits. A program cannot copy it, and a program cannot write its state to a store. A library that wants a copy starts the generator again from the start, with the same inputs. Durable workflow engines use the same method: they start the code again and give each effect its recorded result ([Temporal](https://docs.temporal.io/workflow-definition), [Durable Functions](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-code-constraints)). Thus the code must be deterministic.

### Capabilities

Effekt treats an effect as a capability ([Brachthäuser, Schuster and Ostermann 2020](https://doi.org/10.1145/3428194)). A handler binds a capability, and only code that holds the capability can use the effect. The capabilities are second-class values, thus they cannot escape their handler. The type system tracks the capabilities that a function closes over. This approach also prevents accidental handling: a handler does not catch the effects of a function that came from outside ([Zhang and Myers 2019](https://www.cs.cornell.edu/andru/papers/tunnel-eff/), [Biernacki and others 2019](https://ii.uni.wroc.pl/~ppolesiuk/papers/popl19.pdf)).

Object-capability security says that authority comes only from a reference that a component holds ([Miller 2006](https://papers.agoric.com/papers/robust-composition/full-text/)). A component can make a new capability, but the new capability has no authority that its maker did not have.

### Free and freer monads

A free monad writes a program as data: an operation, and a function that gives the rest of the program. A freer monad removes the need for a functor, and it keeps the continuation in a fast queue ([Kiselyov and Ishii 2015](https://okmij.org/ftp/Haskell/extensible/more.pdf)). An interpreter is a handler, and one program can have many interpreters. Libraries for JavaScript use the same idea with generators: a generator yields plain effect objects, and a test compares each object ([redux-saga](https://redux-saga.js.org/docs/basics/DeclarativeEffects)).

### Effect systems for static checks

Lucassen and Gifford add an effect to each type ([Lucassen and Gifford 1988](https://doi.org/10.1145/73560.73564)). A function type carries its latent effect: the effect of a call to the function. The checker computes the effect of an expression from its parts. Two expressions without conflicting effects can operate in parallel.

### Effects in probabilistic programs

Pyro builds its inference on a library of composable handlers, for example `trace`, `replay` and `condition` ([Pyro, `poutine`](https://docs.pyro.ai/en/stable/poutine.html)). An older method starts the whole program again for each proposal, and it names each random choice by its place in the execution ([Wingate, Stuhlmüller and Goodman 2011](https://proceedings.mlr.press/v15/wingate11a.html)). This structural name lets a run reuse the choices of an earlier run.

## How coeval relates today

The table maps each idea to the kernel. The files are in `packages/core/src`.

| Idea | coeval today | Where |
| --- | --- | --- |
| Operation | A call: an envelope whose type is a procedure path. `effects: "type"` in the contract. | D9, `world.ts` (`Kind.effects`) |
| Root handler | The host function `perform`. One handler for each effect of the run. | `evaluate.ts` (`Session.runEffect`), RUN.SEQ |
| Continuation | The generator of each runner. The driver resumes it one time when the host settles. | `driveWaiting`, RUN.EAGER |
| Tail resumption | A `perform` that gives a value at once. The run goes on without a wait. | `runEffect`, RUN.EAGER |
| Discontinue | A throw of the host gives `#CALC!` with the cause. A signal gives `#ABORT`. | RUN.CAUSE, RUN.ABORT |
| Scheduler | `all` drives several continuations, and it races their waits. | `Session.all`, RUN.ALL, RUN.FAIL-FAST |
| Dry-run handler | `evaluate` gives each effect its payload, and does nothing. | RUN.EVAL |
| Permission | `caps`: names and prefixes that only narrow for parts. | CAP.NAMESPACE, CAP.KEYS, CAP.NARROW, CAP.HOOK |
| Mask | `pure` gives its part no capabilities. | `stdlib.ts` (`control.pure`), CAP.PURE |
| Effect type | `side` and `effects` in the contract. `check` reports `#CAP!`. | `static.ts` (`check`), STATIC.CAP |
| "Can wait" bit | A part that waits needs a parent with a runner. | RUN.NESTED-WAIT, RUN.WAIT |

Seven facts follow from the code.

1. **The generators carry only waits.** A runner yields a promise, and `yield*` passes it up to `driveWaiting`. An effect does not travel up the generator stack. `runEffect` checks the capability, records the effect and starts `perform` directly. Thus no runner between the effect and the root can intercept it.
2. **The root handler is deep and one-shot.** `perform` handles each effect of the run, and each generator resumes one time. A synchronous answer is a tail resumption.
3. **`evaluate` is a fixed handler.** Each effect gives its payload (RUN.EVAL). In a `seq`, a later step thus reads the payload of the earlier effect as `last`, not a real result. A test cannot give `evaluate` other results.
4. **A run does not record outcomes.** `Effect` holds the kind, the payload, the place and the context. It does not hold the value or the error that `perform` gave. Thus a run log cannot drive a replay.
5. **The static kit does not narrow.** `check` compares each document with the capabilities of the root. It does not know that `pure` removes them, thus a call inside `pure` checks and then fails with `#CAP!`. This case breaks STATIC.AGREES. Also, the kinds `log` and `write` of `STD_WORLD` declare `side: "run"` but no `effects`, so `check` finds no `#CAP!` for them.
6. **The order of effects under `all` depends on the host.** In `evaluate`, each part of `all` goes to its end before the next part starts. In a run, the waits settle in the order of the host, and `Promise.race` takes the first one. Thus the global index of an effect is not stable from one run to the next.
7. **Capabilities are names, not references.** A part can cause each effect that its `caps` permit. Nothing designates who answers the effect. This is an access list on the context, not an object capability. In Effekt, the handler that grants a capability also answers it. In coeval, `caps` grant and the root `perform` answers.

## Proposals, ranked by value for effort

### P1: a synchronous `perform` for `evaluate`

- **What.** `Plan.evaluate` and `evaluate` accept a `perform` that answers at once. The answer becomes the result of the effect. A promise from this `perform` gives `#CALC!`, because an evaluation does not wait. Without `perform`, RUN.EVAL stays as it is.
- **Kernel parts.** `EvalOptions`, `Session.effect` and `Session.runEffect` in `evaluate.ts`.
- **Effort.** S.
- **Value.** High. Tests get mocks without promises. A dry run can show realistic values in the explorer of the site.
- **Risk.** Low. Two paths answer an effect, thus the rule for a promise must be clear.
- **Test.** A new ID, for example `RUN.MOCK`. A `seq` with a mock gives the mock result to `last`. A promise from the mock gives `#CALC!`.

### P2: outcomes, stable addresses, record and replay

- **What.** Each recorded effect gets its outcome (the value or the error of the host) and an address. The address is the chain of part keys from the root, with a count of the earlier evaluations of each part by the same parent. Inside `all`, the address uses the index of the item. Two helpers make a `perform`: `recorder(perform)` keeps a log, and `replayer(log)` answers each effect from the log by its address.
- **Mismatch.** A replay compares the kind and the payload of each effect with the log. A difference gives a new code, for example `#REPLAY!`. Durable workflow engines use the same check.
- **Order.** For an exact replay of `failFast`, the log also records the order in which the waits of each `all` settled. The replay then settles them in that order.
- **Kernel parts.** `Effect`, `Session.record`, `Session.runEffect`, `Session.all` and a new module for the two helpers.
- **Effort.** S for the outcomes and the helpers. M for the addresses and the settle order.
- **Value.** High. It gives golden tests of runs, a time-travel view in the explorer and a base for P5 and P7.
- **Risk.** An edit of a document changes its addresses. A log of a long run takes memory. A runner that is not deterministic breaks a replay.
- **Test.** New IDs, for example `RUN.OUTCOME`, `RUN.ADDRESS` and `RUN.REPLAY`. A property test starts a document with random delays under `all`. Each run gives the same set of addresses. A replay of the log does no host effect, and it gives the same result.

### P3: effect rules in contracts and effect inference

- **What.** A kind declares how it changes the capabilities of its parts, in the same way as its `scope` rules declare names. Three rules are enough at first:
  - `mask`: the parts get no capabilities (`pure`).
  - `grant`: the parts get more operations, which the kind answers itself (a handler, P5).
  - `same`: the default.
- **Walk.** `walk` keeps a set of capabilities for each visit, as it keeps the names. `check` then compares each declared effect with the narrowed set.
- **Inference.** A new function `effectsOf` gives the residual effects of a document. These are the operations that reach the host. The fold is first-order, thus it needs no row variables. A host can grant exactly these capabilities: the least authority.
- **Latent effects.** A world entry that is a procedure document can declare its latent effects. The check of a call uses this declaration, and a separate check compares it with the body of the procedure.
- **Kernel parts.** `Kind` in `world.ts`, `walk` and `check` in `static.ts`, and the contracts of `pure`, `log` and `write` in `stdlib.ts`.
- **Effort.** M.
- **Value.** High. It closes the gap of the fifth fact above, and it gives each host the list of capabilities that a document needs.
- **Risk.** An open world with a fallback gives a large set of operations. The prefix rule of `permits` keeps the set small.
- **Test.** New IDs, for example `STATIC.NARROW` and `STATIC.EFFECTS`. A call inside `pure` gives `#CAP!` in `check`. A property test compares `effectsOf` with the effects that `evaluate` records: the inferred set contains each recorded effect.

### P4: a static check of the "can wait" bit

- **What.** In the mode `run`, `check` reports `#CALC!` for a document with a runner under a parent without a runner. It can also report a kind that declares `effects` and has no runner, because in a run an evaluator cannot cause an effect.
- **Kernel parts.** `check` and `CheckOptions` in `static.ts`.
- **Effort.** S.
- **Value.** Medium. RUN.NESTED-WAIT becomes a static error, before the host does any effect.
- **Risk.** Low. The check reads only the names of the evaluators and of the runners.
- **Test.** A new ID, for example `STATIC.WAIT`. The document of the RUN.NESTED-WAIT test gives `#CALC!` in `check`.

### P5: a handler kind, with clauses that run in place

- **What.** A standard kind `handle` intercepts the effects of its body. Each clause names an operation by its keys, as a list, because a key with a dot is one key (CAP.KEYS). A clause is a run document (D1, D9). It reads `payload` from `names`.
  - A `do` clause resumes the effect with its own result.
  - An `abort` clause stops the body, and its result becomes the result of `handle`.
  - A `return` clause changes the result of the body, and it reads `result`.
- **Example.** A clause `do` that is a call with the same type forwards the effect to the next handler. In the document below, a `retry` kind around that call retries each push of the body. The clause for `log` is a mock. The body itself does not change.

```json
{
  "type": "handle",
  "value": {
    "with": [
      { "op": ["log"], "do": { "type": "text", "value": "logged" } },
      {
        "op": ["git", "push"],
        "do": {
          "type": "retry",
          "value": { "times": 3, "body": { "type": ["git", "push"], "value": { "type": "ref", "value": ["names", "payload"] } } }
        }
      }
    ],
    "body": { "type": "seq", "value": [{ "type": ["git", "push"], "value": "main" }, { "type": "log", "value": ["pushed"] }] }
  }
}
```

- **Frames.** The handler frame goes in the context that `handle` gives its body. `runEffect` finds the innermost frame whose operation is a prefix of the effect. Without a frame, the root capabilities and `perform` decide, as today. The frame stays in the context of the body, thus the handler is deep. Nested `handle` documents compose: a forwarded effect goes to the next frame out, and then to `perform`.
- **Context of a clause.** The clause gets the context of the `handle` document, without its own frame. Thus a clause has no authority that its parent does not have, as in object-capability security.
- **Abort.** An abort is an error value with a token of the frame. The standard runners already stop at a failed part (RUN.STOP), and `handle` changes its own token into the clause result.
- **Sealing.** A clause sees only the operation and the payload. It does not see the place or the context of the effect. Thus two bodies with the same results and the same effects can replace each other (EVAL.SEALED).
- **Lexical scope.** An evaluator selects the context of each part. A kind that uses a handler for its own work gives the parts of the user the outer context. This prevents accidental handling, as in Effekt.
- **Kernel parts.** `Context` or `Cap` in `deref.ts`, `narrow`, `Session.runEffect`, a runner in `stdlib.ts`, the rule `grant` of P3, and a new section `HANDLE.*` in the specification.
- **Effort.** M for clauses in place. L for a general resumption, refer to the next point.
- **General resumption.** A clause that resumes and then works on the rest of the body needs the body generator as a value. Then each effect travels up the generator stack as an object, and each driver forwards the effects that it does not handle. The type `Steps`, `drive`, `driveWaiting`, `all` and the trace change. Start with clauses in place, because most operations in practice are tail-resumptive.
- **Value.** High for hosts. Mocks, retries, logs and transactions become documents, not host code.
- **Risk.** D10 lists exactly five roots in a context. A frame in a new field changes D10, and a frame in `caps` changes the type `Cap`. CAP.NARROW changes its wording to "a part cannot cause a host effect that its parent cannot cause". A runner that treats an error as data can swallow an abort.
- **Test.** New IDs, for example `HANDLE.DO`, `HANDLE.ABORT`, `HANDLE.RETURN`, `HANDLE.FORWARD`, `HANDLE.DEEP`, `HANDLE.NARROW` and `HANDLE.SEALED`. A mock handler gives the same result as P1 with the same mock. A forwarded effect reaches `perform` one time.

### P6: equations for effect kinds

- **What.** A contract can declare which operations commute, for example two reads, or two writes with different keys. The schedule layer (S1, S2) can then reorder or parallelize steps whose effects commute. `check` can report a part of `all` whose effects do not commute with the effects of another part.
- **Kernel parts.** `Kind`, `order.ts` (`effectEdges`) and `check`.
- **Effort.** M.
- **Value.** Medium. It helps the schedule layer, and it explains the sixth fact above to a user.
- **Risk.** A wrong declaration gives a wrong order. Only the author of a kind knows its equations.
- **Test.** New IDs, for example `EFFECT.COMMUTE`. Two reads give no effect edge. A write and a read of the same key keep their edge.

### P7: multi-shot by evaluation again

- **What.** A kind `choose` explores each branch of a choice. It evaluates its sealed body again for each branch, with a handler frame that gives the next choice. The effects before the choice come from a replay log (P2), or they are pure. This is the method of Wingate and others, and of the durable engines.
- **Kernel parts.** None outside P2 and P5. The kind is a runner in a language that needs it.
- **Effort.** L.
- **Value.** Low today. The languages that use coeval (formulas, reactive formulas, a program format for procedures and the defs of a user interface) do not need multi-shot. A search or a probabilistic language needs it.
- **Risk.** The cost is the length of the prefix for each branch. A runner that is not deterministic gives wrong branches.
- **Test.** A `choose` over two choices of two values gives four results, and the host sees each effect of the prefix one time.

### A decision to record

The run side of coeval is one-shot and deep. The root `perform` is the outermost handler. A handler, when the kernel gets one, is found through the context, and its clauses run in place. Multi-shot comes only from evaluation again with a replay. This text can become a decision after D13, if the owner agrees.

## Open questions

1. Does a handler frame go in `caps`, as in Effekt, or in a new field outside the five roots of D10? A frame in `caps` unifies permission and meaning, but a reference to `caps` must not reveal the code of the frame.
2. Is the wording of CAP.NARROW "no new authority toward the host"? A handler adds operations to a part, but its clauses use only the authority of its parent.
3. Does a run-side language need procedures as values? If a procedure keeps the capabilities of the context that made it, a call site needs no effect variable. If it uses the capabilities of the caller, the static kit needs effect polymorphism. Today the `fn` of the formula kit makes a pure host function, thus a formula needs no effect polymorphism.
4. Does `side` stay a field of the contract when P3 infers the effects? `side` can mean only "has a runner", and the rows give the effects.
5. Which address scheme survives an edit of a document? Durable engines use explicit version markers. A coeval document can use the binding names of its steps.
6. Does an abort travel as an error value, or does `handle` stop its body with `return` on the generator? The second form needs the general resumption of P5.
7. Do handler clauses get state across effects (parameterized handlers)? A transaction that buffers writes needs it.
