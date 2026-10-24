# The specification of the kernel

This file gives each rule of the kernel one requirement ID. Each ID has at least one test, and the title of the test starts with the ID in brackets. The test `spec.test.ts` makes sure that each ID of this file has a test, and that each ID of a test is in this file.

## Documents

| ID | Rule |
| --- | --- |
| DOC.STORED | A stored document can have the keys of its store beside its envelope. Only the keys in the given list can be there. |
| DOC.EQUALS | Two documents are equal when their values are equal. The order of the fields does not matter. A deep document does not overflow the stack. |
| DOC.RECORD | Only a plain object is a record. A date, a map and an instance of a class are not records. |
| DOC.HOST-EQUALS | `docEquals` compares only lists and plain records by their items and fields. Each other object, for example a date, a map or an instance of a class, is equal only to itself. A cycle does not stop the comparison. |
| DOC.PARTS-OF | `partsOf` gives the document, its kind and the split of its value, with the declared type for a bare value. The plan, the reference interpreter and the static kit read each document with it. |

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

## The merge of worlds and machines

`mergeWorlds` and `mergeMachines` are the one merge of worlds and machines (D17). Two languages compose only through them.

| ID | Rule |
| --- | --- |
| WORLD.MERGE | `mergeWorlds` merges worlds in the order of the parts. Two entries that are equal by `docEquals` give one entry. Two namespaces merge key by key at each depth, and their fallbacks merge too. The defaults merge verb by verb. A merge does not change its parts. |
| WORLD.CONFLICT | Two different entries at one path are a conflict. Examples are two different kinds, a kind and a namespace, and two different fallbacks or defaults. The merge throws one `MergeError` with each conflict, its path and its two parts. |
| WORLD.REPLACE | A part names in `replaces` the paths of the entries that it replaces. At such a path, the later entry wins, with no merge below it. The path of a conflict is the path that `replaces` names. A part can be a function of the merge before it (`prev`). |
| WORLD.LAWS | Without `replaces`, a merge of worlds or of machines is commutative, associative and idempotent. Parts in another order give an equal result, or a conflict in each order. |
| MACHINE.MERGE | `mergeMachines` merges the worlds, and the tables of the code name by name: evaluators, runners, derefs and walkers. A function is equal only to itself. Each other field, for example `permits`, `roots` or `maxDepth`, is one value, or a conflict. |
| MACHINE.RUNNER | A runner hides the evaluator of its name. Thus a name with a runner and an evaluator needs one part that gives both. A replacement of a name replaces its evaluator and its runner. |
| MACHINE.KNOWN | The hooks `known` compose in the order of the parts. The first answer that is not `true` wins. A hook does not answer for a name whose code a later part replaces. |
| MACHINE.AGREES | A merged machine of two languages evaluates through the plan, the reference interpreter and `agree`. The generated documents of its world agree. |
| WORLD.RESTRICT | `restrictWorld` removes the entries of a world at the given paths: kinds, aliases, namespaces, fallbacks and defaults. A path names an entry as `replaces` names it. A path that names no entry changes nothing. |
| MACHINE.RESTRICT | `restrictMachine` removes entries of the world and the code of names. A path to the evaluator or to the runner of a name removes both. Thus an own entry cannot reach the removed code. |

## Composition

The modes of composition come from Erdweg, Giarrusso and Rendel (2012), through the study R6. [`COMPOSITION.md`](COMPOSITION.md) gives an example of each mode. A mode that does not work today has a skipped test with its target behavior.

| ID | Rule |
| --- | --- |
| COMPOSE.EXTEND | A language extends a base with new kinds, aliases and operations. The base does not change, and it does not know the extension. The composed machine agrees with the reference. |
| COMPOSE.RESTRICT | A language removes kinds and their code, closes a namespace, permits fewer kinds at a position, or masks the capabilities of a part. A restriction of the world alone keeps the code for own entries. |
| COMPOSE.UNIFY | Two independent languages merge. Their equal kinds and their shared code give one entry, in each order. An alias and a kind of glue join them. |
| COMPOSE.SELF-EXTEND | A host merges kinds that a document gives as JSON, when each verb names an evaluator of the machine. A document cannot bring code: an own entry with an unknown evaluator gives `#NOEVAL`. |
| COMPOSE.EXTEND-UNIFY | Two independent extensions of one base compose without glue. Each order of the parts gives the same machine (WORLD.LAWS). Both extensions can add to one namespace of the base. |
| COMPOSE.INCREMENTAL | A language extends an extension, also at run time. It reads the entry that it replaces through `prev`. A plan keeps its machine, and a new plan uses the new machine. |
| COMPOSE.CONFLICT | Two extensions that each compose with the base can conflict. The merge throws one `MergeError` when the host builds the machine. The path of each conflict is the mark `replaces` that resolves it. |

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
| TREE.ONCE | An attribute of a node evaluates one time in an evaluation, also when two readers ask for it. |
| TREE.LAZY | A node of a tree is a host thing, and each part of the node is an attribute. A node in an attribute of an open tree gives its thing. An attribute evaluates only when something reads it. |
| TREE.SIBLING | A node reads an attribute of a sibling through its parent, for example `["self", "parent", "children", 0, "width"]`. The read does not recurse, also for a later sibling. |
| TREE.CYCLE | A demand that reaches an attribute in evaluation gives `#CYCLE!`. The reason gives the chain of attributes. The error has the place of the reference that closed the cycle. |
| TREE.ERROR | A reference to a failed attribute gives the error of that attribute, with its code, its reason, its place and its cause. |
| TREE.MEMO | Each node keeps one memo for each attribute, for one evaluation. Each evaluation makes new nodes, thus nothing stays from an earlier evaluation. |
| TREE.PURE | The kinds `panel` and `box` mask the capabilities of their parts. An attribute evaluates on demand, thus an effect in it gives `#CAP!`, and `check` finds it. |
| TREE.RESULT | The root of a tree gives the JSON of the tree: each attribute in the order of the parts, with the JSON of each node in a value. A node of a closed tree starts a new tree. |

## Evaluation and plans

| ID | Rule |
| --- | --- |
| PLAN.ONCE | A plan compiles a document one time. It evaluates many times with the same result as `evaluate`. |
| PLAN.FAIL-LATE | A document that does not compile gives a plan that fails when that document evaluates. A compiler that throws fails only its own document. The error has its place. |
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
| VALUE.DEPTH | An overflow of the stack of the host gives `#DEPTH!`. This is also true when the test of the overflow overflows the stack. |
| VALUE.FAILURES | The function `failures` lists the errors where they started. |
| TRACE.ORDER | A trace is in the order of the starts. Each start comes before its end. |

## One meaning

A reference interpreter reads the rules of this file directly and compiles nothing. A plan, the traced plan and the second tier of a language must give its results (D15).

| ID | Rule |
| --- | --- |
| PLAN.AGREES | A plan, a traced plan, a second evaluation of the plan and the reference interpreter give the same result for each generated document. |
| REF.DIRECT | The reference interpreter evaluates a document by the rules, and it compiles nothing. A compiled evaluator needs a definition, or the reference gives `#NOEVAL`. |
| REF.FORMULA | `formulaDefinitions` gives a definition for each evaluator of the formula kit: a function evaluator, written from this specification. |
| REF.TREE | The reference has its own definition of the evaluator `tree.node` in `STD_DEFINITIONS`. It uses that definition for the standard evaluator, also without the option `definitions`. |
| REF.EFFECTS | The reference records each effect with its kind, its payload and its place. It narrows the capabilities by the contracts of the kinds. |
| AGREE.VALUES | `sameValue` compares lists and plain records by their items and fields, and each other leaf with `Object.is`. Two closures of `fn` with the same parameters are the same. A rule of the caller compares other objects. Identity is not compared. |
| AGREE.ERRORS | Two errors agree when they have the same code, and the same place when both have one. With `strict`, they also have the same reason, and each has a place. An overflow of the stack of the host is the one permitted difference. |
| AGREE.EFFECTS | Two tiers agree only when they cause the same effects in the same order, with the same kinds, places and payloads. The host also sees the same calls. |
| AGREE.TIER | A language gives `agree` its second tier as a function. `agree` names the first tier that disagrees with the plan, and the reason. |
| AGREE.MUTANT | The harness finds a tier that changes the order of the parts, or that evaluates a branch that the reference does not evaluate. |
| GEN.SEED | `generate` gives the same document for the same seed and options. Its random numbers need no package. |
| GEN.CONTRACTS | Without malformed choices, a generated document follows the contracts of its kinds: the shapes, the declared types and the names in scope. `check` finds no problem in it. |
| GEN.MALFORMED | Malformed choices give unknown kinds, unknown names under a namespace with a fallback, values without their shape, bare values without a type, bad paths and names that nothing binds. |
| GEN.REACH | The documents of the property test reach each kind of their world, and they give values and errors. |
| GEN.PATHS | The option `roots` gives the roots of the paths, and the option `steps` gives their most steps. The defaults are each root and two steps. |

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
| RUN.WAIT | A part that waits under an evaluator gives `#CALC!`. The error has the place of the part. |
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
| CAP.CONTRACT | A kind declares in its contract the capabilities that it gives its parts: `same`, `mask` or `only`. The kernel narrows the context of each part by these rules, thus an evaluator cannot give the part more. |
| CAP.ONLY | A rule `only` gives a part only the effects that the capabilities of its document and the list of the rule both permit. |
| CAP.DECLARED | Each kind of the standard world that causes an effect declares the effect in its contract. Thus `check` finds a `#CAP!` for it. |

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
| STATIC.AGREES | A document that checks evaluates without the errors that `check` finds. When a run gives `#NAME?` for an unknown operation, or `#VALUE!` for a value without its shape, `check` gives the same code, place and reason. For a name that nothing binds, it gives the same code and place, unless the host adopts the names. A `#DEPTH!` from an overflow of the stack of the host is not an error of `check`. |
| STATIC.NARROW | `check` tests each effect against the capabilities of its own document: the capabilities at the root, narrowed by the rules of the kinds around it. |
| STATIC.LINEAR | A walk takes time and memory linear in the size of the document. A visit knows its parent and the path of its part. |
| STATIC.PATH | `check` finds a reference whose value is not a path: a list that starts with a root. |
| STATIC.AT | `check` gives the JSON path of each problem. For a value without its shape, the path goes to the value with the problem. |
| STATIC.STEPS | When the kind `ref` has parts, the static kit visits the step documents of a path. A reference in an address position is an address, not a read. |
| STATIC.KNOWN | `check` asks the hook `known` of the machine about the kind and the evaluator of each document. A name that the evaluator does not know gives `#NAME?` with the reason of a run, for example an unknown operation. |

## The formula kit

| ID | Rule |
| --- | --- |
| FORMULA.LIT | A bare value in the position of a term is a literal. The kind `lit` keeps a value with the shape of an envelope. |
| FORMULA.REF | A reference gives what its path reaches. A profile can say that a value is missing. |
| FORMULA.RECORD | A record evaluates each field. A profile can leave out a field with an absent value. |
| FORMULA.LIST | A list evaluates each item, and it stops at the first error. |
| FORMULA.LET | Each binding of a `let` sees the names around the `let`. A failed binding fails only when a term reads it. |
| FORMULA.FN | `fn` makes a function, and `call` applies it. An operation of the host can call the function. |
| FORMULA.FN-PARAMS | The contract of `fn` declares `params` as a list of different texts. Thus `check` and a run give the same `#VALUE!` for bad parameters. |
| FORMULA.IF | `if` evaluates only the branch that the test selects. A profile gives the truth of a value. |
| FORMULA.OTHERWISE | A profile gives the value of an `if` without `else`. A profile with the key `otherwise` gives its value, also `undefined`. |
| FORMULA.LOGIC | `and` and `or` stop early. A profile can give the value that decided. |
| FORMULA.OPS | An operation gets the values of its arguments, in order. It stops at the first error. |
| FORMULA.LAZY | A lazy operation evaluates only the arguments that it needs. |
| FORMULA.COMBINE | A profile can combine the errors of the parts of an operation, a `record` or a `list`. Then each part evaluates, and one failed part gives its own error. |
| FORMULA.STEPS | A language can replace the kind `ref` with a kind of a deep shape (WORLD.REPLACE). Then each step document of a path is a part. The parts evaluate first, in order, also before the path reads a name whose binding failed. The first error is the result. The walker gets the values. |
| FORMULA.ADDRESS | A term shape can declare an address. A reference there gives what its path reaches, not its value. Thus a host thing stays a thing. |
| FORMULA.EXT-CONTEXT | An extension gets the context of its document, for example the position of `self`. |
| FORMULA.EXT | The standard extensions give the values that JSON cannot write. |
| FORMULA.DEPTH | A deep formula evaluates up to the limit of the depth. |
| FORMULA.SPEED | A plan evaluates a small formula many times quickly. |
| FORMULA.EXTEND | `formulaMachine` merges the kit and the language with `mergeMachines`. A kind `ops.*` or a namespace `ops` of the language extends the namespace of the kit, and the fallback of the kit stays. A different kind or evaluator with the name of a kit entry is a conflict, unless the language replaces it. |

## The package

| ID | Rule |
| --- | --- |
| PKG.PURE | An import of the package does nothing. Each statement at the top of a module is free of side effects, or its expression has the mark `/* @__PURE__ */`. Thus a bundler that does not examine functions, for example esbuild, removes each unused part. |
