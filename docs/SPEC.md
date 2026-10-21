# The specification of the kernel

This file gives each rule of the kernel one requirement ID. Each ID has at least one test, and the title of the test starts with the ID in brackets. The test `spec.test.ts` makes sure that each ID of this file has a test, and that each ID of a test is in this file.

## Documents

| ID | Rule |
| --- | --- |
| DOC.STORED | A stored document can have the keys of its store beside its envelope. Only the keys in the given list can be there. |
| DOC.EQUALS | Two documents are equal when their values are equal. The order of the fields does not matter. A deep document does not overflow the stack. |
| DOC.RECORD | Only a plain object is a record. A date, a map and an instance of a class are not records. |

## The world and the ladder

| ID | Rule |
| --- | --- |
| LADDER.OWN | The own entry of a document answers first. |
| LADDER.KIND | The kind answers when the document has no own entry. |
| LADDER.DECLARED | A bare value gets the type that its position declares. |
| LADDER.ENVELOPE-WINS | The type of an envelope wins over the type that the position declares. |
| LADDER.DEFAULT | The default of the world answers when the kind has no entry for the verb. |
| LADDER.NO-GUESS | The ladder does not guess a type from the shape of a value. |
| LADDER.UNKNOWN | A question stops at a kind that the world does not have. |
| LADDER.NO-ANSWER | A question gives no answer when no rung has the verb. |
| LADDER.OWN-ONLY | The ladder reads only own entries, not inherited members. |
| WORLD.WALK | A path can walk the world, and it follows an alias. |
| WORLD.ALIAS | A lookup finds a kind by its path, and it follows each alias. |
| WORLD.ALIAS-EVAL | A document whose type is a path to an alias evaluates with the kind of the alias. |
| WORLD.EXPANDED | A type can be the expanded form: a reference document from the root `world`. |
| WORLD.NO-KIND | A path that reaches no kind gives `#KIND?`. |
| WORLD.FALLBACK | A namespace with a fallback gives the fallback kind for each key that it does not have. |
| WORLD.OPEN | A world with a fallback gives the fallback kind for each first key that it does not have. |
| CLASSIFY.SPECIFIC | A classifier proposes the kind of the most specific shape. |
| CLASSIFY.AMBIGUOUS | A classifier reports two shapes that match equally well. |
| CLASSIFY.NONE | A classifier reports a value that no shape matches. |
| CLASSIFY.TAG | A tag puts a value in an envelope, and then the ladder answers by the type. |

## Parts and contracts

| ID | Rule |
| --- | --- |
| SHAPE.RECORD | A record shape names a shape for each field. The other fields have the shape `rest`, and the default is data. |
| SHAPE.REQUIRED | A value without a field that `required` names, or without the form of its shape, gives a reason and a place. |
| SHAPE.DEEP | A deep shape makes each envelope at any depth a part, and keeps the rest as data. |
| SHAPE.PROTO | A field with the name `__proto__` stays a field. It does not change a prototype. |
| SHAPE.DATA | A data shape gives the type of a value: a text, a number with optional limits, or one of some values. Another value gives a reason and a place. |
| SHAPE.CLOSED | A closed record shape permits only its named fields. Another field gives a reason and its place. |
| SHAPE.KINDS | A term shape can name the kinds that it permits. A part whose type does not start with one of them gives a reason. |
| SHAPE.DISTINCT | A list shape can permit no two equal items. |
| EVAL.SEALED | An evaluator gets each part sealed. Two parts with the same result can replace each other. |
| EVAL.FILL | An evaluator can put the result of each part in the place of the part. The data around the parts stays the same objects. |

## References

| ID | Rule |
| --- | --- |
| DEREF.ROOT | A path starts at a root of the context. Then it goes into fields and items. |
| DEREF.NO-ROOT | A path without a root gives `#REF!`. |
| DEREF.MISS | A step that reaches nothing gives `#N/A`, with the hops before it. |
| DEREF.CODES | An unknown name gives `#NAME?`. A missing field gives `#N/A`. A field with the value `undefined` gives that value. A list has the field `length`. |
| DEREF.COLLAPSE | A path follows a reference that a step reaches. |
| DEREF.CYCLE | A cycle of references gives `#CYCLE!`. |
| DEREF.HOST | A host thing answers its own steps. |
| DEREF.PATH | A host thing can answer all the keys of a path in one call. |
| DEREF.QUICK | A resolution without hops asks a host thing for all the keys one time. The root `world` uses the same short path. |
| DEREF.PLAIN | A plain navigation reads a value with the shape of a reference as data. |
| DEREF.ROOTS | A navigation can close roots. A path from a closed root gives `#REF!`. |
| DEREF.ADOPT | A navigation can adopt each value that a path reaches as a thing, also a value that a `let` binds. |
| DEREF.HOPS | A resolution can skip the record of its hops. |
| DEREF.SYMBOL | The brand of a host thing is a global symbol. Two copies of the kernel know the things of each other. |
| DEREF.WALK-CODE | A walker can give the code of its failure, for example `#REF!` for a position outside a space. The default code is `#N/A`. |
| TREE.PARENT | A node of a tree reads its parent through the field `parent`. |
| TREE.NEAREST-SELF | A walk `nearest` with `self: true` starts at the node itself. |
| TREE.NEAREST-MATCH | A host can give the walker `nearest` its own test of a type and its own limit of hops. |
| TREE.ONCE | A field of a node evaluates one time, also when two readers ask for it. |

## Evaluation and plans

| ID | Rule |
| --- | --- |
| PLAN.ONCE | A plan compiles a document one time. It evaluates many times with the same result as `evaluate`. |
| PLAN.FAIL-LATE | A document that does not compile gives a plan that fails when it evaluates. The error has its place. |
| PLAN.TRACE | A traced evaluation records each document. An evaluation of a plan without a trace records nothing. |
| PLAN.CACHE | A planner compiles one document object one time. |
| PLAN.COMPILE-SPEED | A compilation without a trace does not record the rungs of the ladder, thus it compiles a small document quickly. |
| PLAN.LEAN | A plan keeps only its compiled code. It does not keep its document or the split of the value, thus a store can keep many plans. |
| PLAN.DEPTH | The nesting of documents has a limit. The default is 1000. |
| EVAL.DECLARED | A bare value in a list gets the type that the list declares. |
| EVAL.LAZY-IF | The kind `if` evaluates only the branch that the test selects. |
| EVAL.PATH | A reference reads a field of a name by a path. |
| EVAL.NAME | A name that the context does not have gives `#NAME?`. |
| EVAL.ERRORS | An unknown kind gives `#KIND?`. A value without a type gives `#PART?`. |
| EVAL.ARGS | Two failed parts give `#ARGS`. |
| EVAL.OWN | The own entry of a document answers first in an evaluation. |
| VALUE.ANY | A value can be any value of the host, not only JSON. |
| VALUE.THROW | An evaluator that throws gives `#CALC!`. The exception is the cause. |
| VALUE.DEPTH | An overflow of the stack of the host gives `#DEPTH!`. |
| VALUE.FAILURES | The function `failures` lists the errors where they started. |
| TRACE.ORDER | A trace is in the order of the starts. Each start comes before its end. |

## The run side and capabilities

| ID | Rule |
| --- | --- |
| RUN.SEQ | A run waits for each effect. The next step gets the result as `last`. |
| RUN.EAGER | The part of a run before the first wait happens at once, in the call. |
| RUN.STOP | A run stops at a failed step. The later effects do not happen. |
| RUN.CAP | A run refuses an effect without its capability. The host does not see the effect. |
| RUN.PURE | The kind `pure` refuses an effect, also in a run. |
| RUN.SAME | A run gives the same derived values as an evaluation. |
| RUN.NESTED-WAIT | A step that waits inside a part that cannot wait gives `#CALC!`. |
| RUN.WAIT | A part that waits under an evaluator gives `#CALC!`. |
| RUN.EVAL | An evaluation of a run document records its effects, and it does none. |
| RUN.EFFECT | An effect has its kind, its keys, its place and its context. |
| RUN.CAUSE | An error of the host stays the cause of the error value. |
| RUN.ALL | Parts can run at the same time, with a limit. The results keep the order of the parts. |
| RUN.FAIL-FAST | With `failFast`, the first failed part stops the parts at the same time. The later parts do not start, and the results come at once. |
| RUN.ABORT | A run stops with `#ABORT` when the host aborts it. |
| SEQ.LAST | A sequence gives the result of the step before under the name `last`. |
| SEQ.NAMES | A sequence gives the result of a named step to the later steps. |
| EFFECT.ORDER | The effects keep their order. |
| CAP.PURE | An effect inside `pure` fails, because `pure` gives its part no capability. |
| CAP.NAMESPACE | A capability permits a kind by its name, or by its namespace. |
| CAP.KEYS | A capability permits the kinds under it, key by key. A key with a dot is one key. |
| CAP.NARROW | A part cannot get more capabilities than its parent. |
| CAP.HOOK | A machine can give the rule of the host for an effect. |

## Order of steps

| ID | Rule |
| --- | --- |
| ORDER.EDGES | The steps give data edges and effect edges. |
| ORDER.ALLOWED | Each order that obeys the edges is permitted. |
| ORDER.LAYERS | Independent steps are in one layer. |
| ORDER.CHECK | A check finds a read of a later step and a read of an unknown name. |

## The static kit

| ID | Rule |
| --- | --- |
| STATIC.WALK | A walk visits each document with its place and the names that it sees. |
| STATIC.REFS | `refsOf` finds the references of a document. A reference is free when no kind around it binds its name. |
| STATIC.MAP | `mapRefs` changes the free references. It shares each part that does not change. |
| STATIC.CHECK | `check` finds the problems of a document before a run. Each problem has its place. |
| STATIC.SEQ | `check` knows that a step reads only the steps before it. |
| STATIC.CAP | `check` finds an effect that the capabilities do not permit. |
| STATIC.AGREES | A document that checks evaluates without the errors that `check` finds. |
| STATIC.LINEAR | A walk takes time and memory linear in the size of the document. A visit knows its parent and the path of its part. |
| STATIC.PATH | `check` finds a reference whose value is not a path: a list that starts with a root. |
| STATIC.AT | `check` gives the JSON path of each problem. For a value without its shape, the path goes to the value with the problem. |
| STATIC.STEPS | When the kind `ref` has parts, the static kit visits the step documents of a path. A reference in an address position is an address, not a read. |

## The formula kit

| ID | Rule |
| --- | --- |
| FORMULA.LIT | A bare value in the position of a term is a literal. The kind `lit` keeps a value with the shape of an envelope. |
| FORMULA.REF | A reference gives what its path reaches. A profile can say that a value is missing. |
| FORMULA.RECORD | A record evaluates each field. A profile can leave out a field with an absent value. |
| FORMULA.LIST | A list evaluates each item, and it stops at the first error. |
| FORMULA.LET | Each binding of a `let` sees the names around the `let`. A failed binding fails only when a term reads it. |
| FORMULA.FN | `fn` makes a function, and `call` applies it. An operation of the host can call the function. |
| FORMULA.IF | `if` evaluates only the branch that the test selects. A profile gives the truth of a value. |
| FORMULA.OTHERWISE | A profile gives the value of an `if` without `else`. A profile with the key `otherwise` gives its value, also `undefined`. |
| FORMULA.LOGIC | `and` and `or` stop early. A profile can give the value that decided. |
| FORMULA.OPS | An operation gets the values of its arguments, in order. It stops at the first error. |
| FORMULA.LAZY | A lazy operation evaluates only the arguments that it needs. |
| FORMULA.COMBINE | A profile can combine the errors of the parts of an operation, a `record` or a `list`. Then each part evaluates, and one failed part gives its own error. |
| FORMULA.STEPS | A language can give the kind `ref` a deep shape. Then each step document of a path is a part. The parts evaluate first, in order, and the first error is the result. The walker gets the values. |
| FORMULA.ADDRESS | A term shape can declare an address. A reference there gives what its path reaches, not its value. Thus a host thing stays a thing. |
| FORMULA.EXT-CONTEXT | An extension gets the context of its document, for example the position of `self`. |
| FORMULA.EXT | The standard extensions give the values that JSON cannot write. |
| FORMULA.DEPTH | A deep formula evaluates up to the limit of the depth. |
| FORMULA.SPEED | A plan evaluates a small formula many times quickly. |
