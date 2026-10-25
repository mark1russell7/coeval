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
| DEREF.HOST-UNDEFINED | A host thing tells a field that holds `undefined` from a missing field. When `deref` gives `undefined`, `has` tells which it is. `resolve` gives `{ thing: undefined }` for such a field. A thing without `has` reads `undefined` as a missing field. Each node of the standard tree has `has`. |
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

## Verbs

A verb is one question to each document, for example `eval` or `format`. Each verb has one ladder, and each verb goes through the plan, `check` and the reference (D23).

| ID | Rule |
| --- | --- |
| VERB.PREPARE | `prepare`, `evaluate` and `run` take a verb. At each document, the ladder answers for that verb, and each part evaluates with the same verb. A plan of another verb evaluates, runs and traces as a plan of `eval` does. |
| VERB.DEFAULT | The default verb is `eval`. Without a verb, `prepare`, `evaluate`, `run`, `check`, `reference` and `agree` give the results that they gave before. |
| VERB.LADDER | Each verb visits the same rungs: the own entry, then the kind, then the default of the world. `deref` and `step` visit them too. A kind that the world does not have stops the question. When no rung of `deref` answers, a step goes into the value. |
| VERB.CHECK | `check` takes a verb. `#NOEVAL` and the hook `known` follow the evaluator of that verb. The shapes, the paths and the names follow the contracts, thus they are the same for each verb. Only `eval` checks the declared effects. |
| VERB.CONTRACT | The contract of a kind serves each verb. For each verb, the kernel splits the parts and narrows their capabilities by it. `side` and `effects` tell what `eval` does. An effect of another verb passes the test of its capabilities when it happens (RUN.CAP). |
| VERB.FORMAT | A language adds a verb with a merge, without a change to the kernel. The verb `format` of the tests gives the text of a document. Its default writes `kind(part, part)`, and three kinds of the formula kit have their own entries. |
| VERB.AGREE | The reference reads each verb by the same rules. `agree` with a verb compares the plan of that verb with the reference, the traced plan and a second evaluation. The second tier of a language gets the verb. Generated documents agree for `format`. |

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
| AGREE.MOCK | `agree` gives its mock `perform` to each tier, also to the second tier of a language. Thus the tiers agree on documents with effects. When two tiers record the address or the outcome of an effect, these agree too. |
| AGREE.MUTANT | The harness finds a tier that changes the order of the parts, or that evaluates a branch that the reference does not evaluate. |
| RESULT.SAME | `sameResult` tells if two results are the same for an early cutoff. Two values compare by the rules of `docEquals`, thus each object that is not a list or a plain record is the same only as itself. `-0` is not `0`, and `NaN` is `NaN`. A rule of the host answers first for two values (D20). |
| RESULT.SAME-ERROR | For `sameResult`, two errors are the same when they have the same code, reason and place. The cause is not compared. A held error compares by the same rule. A value and an error are not the same. |
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
| RUN.CAN-WAIT | With the option `run`, `check` gives `#CALC!` for a runner under a parent without a runner, and for a kind that declares effects and has no runner. The issue has the place and the reason of the run. A document that passes this check gives no such `#CALC!` in a run. |
| RUN.EVAL | An evaluation of a run document records its effects, and it does none. |
| RUN.EFFECT | An effect has its kind, its keys, its place and its context. |
| RUN.CAUSE | An error of the host stays the cause of the error value. |
| RUN.ALL | Parts can run at the same time, with a limit. The results keep the order of the parts. |
| RUN.FAIL-FAST | With `failFast`, the first failed part stops the parts at the same time. The later parts do not start, and the results come at once. |
| RUN.ABORT | A run stops with `#ABORT` when the host aborts it. |
| RUN.MOCK | An evaluation can get a mock `perform`. The answer of the mock is the result of the effect, as in a run with the same `perform`. A promise from the mock gives `#CALC!`, because an evaluation does not wait. |
| RUN.OUTCOME | Each effect records its outcome: the result that it gave its document. A throw of the host gives `#CALC!` with the cause, and a `Failure` gives its own error value. An effect of a run that stopped at its wait has no outcome. |
| RUN.ADDRESS | Each effect has an address: the keys of its place and the count of the earlier effects at that place in its scope. The root is one scope, and each item of `all` is a scope. Thus the order of the host does not change an address. |
| RUN.RECORD | `recorder` wraps the `perform` of a host. Its log has each effect with its address, its kind, its payload and its outcome. The log also has the order in which the waits of each `all` settle. |
| RUN.REPLAY | `replayer` answers each effect from a log, by its address. A replay does no host effect, and it gives the result of the recorded run. The waits of each `all` settle in the recorded order, thus `failFast` gives the same result too. |
| RUN.REPLAY-MISMATCH | An effect that the log does not have at its address gives `#REPLAY!`: an unknown address, another kind or another payload. The run stops there, as at each failed step. |
| SEQ.LAST | A sequence gives the result of the step before under the name `last`. |
| SEQ.NAMES | A sequence gives the result of a named step to the later steps. |
| EFFECT.ORDER | The effects keep their order. |
| CAP.PURE | An effect inside `pure` fails, because `pure` gives its part no capability. |
| CAP.PURE-ONE | The kind `pure` takes exactly one part. A list with no part or with more than one part gives `#VALUE!`. |
| CAP.NAMESPACE | A capability permits a kind by its name, or by its namespace. |
| CAP.KEYS | A capability permits the kinds under it, key by key. A key with a dot is one key. |
| CAP.NARROW | A part cannot get more capabilities than its parent. |
| CAP.HOOK | A machine can give the rule of the host for an effect. |
| CAP.CONTRACT | A kind declares in its contract the capabilities that it gives its parts: `same`, `mask` or `only`. The kernel narrows the context of each part by these rules, thus an evaluator cannot give the part more. |
| CAP.ONLY | A rule `only` gives a part only the effects that the capabilities of its document and the list of the rule both permit. |
| CAP.DECLARED | Each kind of the standard world that causes an effect declares the effect in its contract. Thus `check` finds a `#CAP!` for it. |
| CAP.PERMITS | `check` and `effectsOf` ask the hook `permits` of the machine about each declared effect, with the capabilities of its document, as a run does. In a check, the hook gets a context with only the capabilities and the world. Without the hook, the function `permits` decides. |
| CAP.EFFECTS-OF | `effectsOf` gives the kinds of the effects that can reach the host: the declared effects, without the effects that a rule `mask` or `only` around them removes. Each kind comes one time, in the order of the document. With capabilities at the root, only the effects that the rule of the machine permits stay. |
| CAP.EFFECTS-SOUND | `effectsOf` permits each effect that an evaluation or a run gives the host, with the capabilities of the run and without capabilities. A property test examines generated documents with a recorder. |
| CAP.LATENT | A procedure value keeps the capabilities of the document that made it. Its latent effects are the effects of its body, thus `effectsOf` and `check` count them at the body. A procedure entry declares its latent effects in `effects`. `checkLatent` gives a `#CAP!` for each effect of a body that the declaration does not permit. |

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
| STATIC.AGREES | A document that checks evaluates without the errors that `check` finds. When a run gives `#NAME?` for an unknown operation, or `#VALUE!` for a value without its shape, `check` gives the same code, place and reason. For a name that nothing binds, it gives the same code and place, unless a host thing without `has` answers the names (DEREF.HOST-UNDEFINED). A `#DEPTH!` from an overflow of the stack of the host is not an error of `check`. |
| STATIC.NARROW | `check` tests each effect against the capabilities of its own document: the capabilities at the root, narrowed by the rules of the kinds around it. |
| STATIC.LINEAR | A walk takes time and memory linear in the size of the document. A visit knows its parent and the path of its part. |
| STATIC.PATH | `check` finds a reference whose value is not a path: a list that starts with a root. |
| STATIC.AT | `check` gives the JSON path of each problem. For a value without its shape, the path goes to the value with the problem. |
| STATIC.STEPS | When the kind `ref` has parts, the static kit visits the step documents of a path. A reference in an address position is an address, not a read. |
| STATIC.KNOWN | `check` asks the hook `known` of the machine about the kind and the evaluator of each document. A name that the evaluator does not know gives `#NAME?` with the reason of a run, for example an unknown operation. |

## The static facts

`factsOf` gives the static facts of a document for a schedule (R4 P2, D24). They depend only on the document and the machine.

| ID | Rule |
| --- | --- |
| FACTS.READS | Each free reference from a root is a read. A read has its root, its keys up to the first step document, its place and its JSON path. A read after a step document is not exact. A reference in an address position is an address. |
| FACTS.LAZY | A lazy rule of a kind names the parts that an evaluation can skip and still give a value. A read under a lazy part is lazy. An eager read evaluates in each evaluation in which each document around it gives a value. Each part of a document with an own entry for another evaluator is lazy. |
| FACTS.SIDE | The side of a document is `run` when one kind in it is on the run side. Else the side is `derive`. |
| FACTS.EFFECTS | The effects are the kinds of effects that the contracts declare, each one time, in the order of the document. The effects `"type"` of a kind give the type of the document. |
| FACTS.PURE | A document is pure when each kind in it declares `pure`, and it has no effect and is not volatile. An unknown kind and an own entry for another evaluator are not pure. A pure document gives the same result when each value that no read reaches changes. |
| FACTS.VOLATILE | A document is volatile when a kind, an operation or a kind of step documents declares `volatile`. A read that the host marks also makes it volatile. A read of `event` and an effect do not. |
| FACTS.HOOK | The hook `facts` of a machine gives the facts of the code of a name. Each field of its answer wins over the contract. `mergeMachines` composes the hooks in order, and a hook does not answer for replaced code. |
| FACTS.VERB | The option `verb` names the verb whose code the facts describe. The default is `eval`. A contract describes the code of `eval`, and of `step` for a step document. Only the hook describes the code of another verb. The reads, the side and the effects do not depend on the verb. |
| FACTS.PROFILE | `formulaMachine` gives the hook `facts` of its profile. A lazy operation has a lazy rule for each argument. The profile names its pure and volatile operations. A standard extension is pure, and an extension of the profile is not. |
| FACTS.SOUND | In each evaluation, each path that a plan resolves has a static read at the place of its document. The read has the root of the path, and its keys start the path. An exact read has the full path. |

## The reads of an evaluation

An evaluation can record its reads. `verifyReads` tells if an old result stays valid in a new context (R4 P3, D26). A schedule uses the list as a verifying trace.

| ID | Rule |
| --- | --- |
| READS.RECORD | `evaluate`, `plan.evaluate`, `run` and `plan.run` take a list `reads`. The list gets each resolution: the path, what it reached and the mark `free`. An exception of the host gives the error value of the read. A reference through a name that holds an error reads that name. Without the list, an evaluation records nothing and gives the same result. |
| READS.ORDER | The reads are in the order of the resolutions. The step documents of a path evaluate first, thus their reads come before the read of the path. |
| READS.FREE | A read is free when it reads the context at the root of the evaluation. A name that a kind binds, a `self` that a kind sets and a path without a root are not free. `verifyReads` skips each read that is not free. |
| READS.KEPT | A value that keeps the context adds a read of each whole root, one time in an evaluation. A closure of `fn` keeps the context. The first read of a `self` that a kind sets adds a read of the root `self`, because a node of a tree gives that `self` as its parent. |
| READS.VERIFY | `verifyReads` takes a machine or a plan, the reads and a new context. It resolves each free read again, and it compares the two answers with `sameResult`. The rule `equal` of the host answers first. When each read is the same, the old result stays valid. Code that asks for the hops gets them in its read, and the verification compares each hop. A longer path through a name that holds an error in the new context is changed. |
| READS.CHANGED | When a read is not the same, `verifyReads` gives the first such read, its index and what its path reaches in the new context. It does not resolve the later reads. |
| READS.LAZY | A part that the evaluation skips has no reads, for example the branch of `if` that the test did not select. A change that only such a part reads keeps the old result. |
| READS.DATA | A reference in the data that a resolution follows is a part of one read (DEREF.COLLAPSE), as `factsOf` counts it. A change of its target changes that read. |
| READS.SOUND | For the generated documents of six machines, the test changes the context at random. When each free read of a pure document is the same, a new evaluation gives the same result by `sameResult`. A list without the kept reads gives stale results of trees, and the test finds them. |
| READS.SUBSET | Each free read of an evaluation has a static read of `factsOf` with the same root, and the keys of the static read start its path. A kept read, the read of a name that holds an error and a name that a kind binds to the value of the context are the exceptions. |

## Types

A value type is a set of values that a result can have (R5 P2, D22). It is a JSON term that only a check reads. It is not a kind, and it does not go into an envelope. A check of types gives each part a type in two directions (R5 P3, D25). The host gives the types of the roots, and a reference gets the type that its path reaches (R5 P4, D28).

| ID | Rule |
| --- | --- |
| TYPE.BASE | A text names a base type. The kernel has `unknown`, `never`, `null`, `bool`, `number` and `text`. `unknown` holds each value, and `never` holds no value. `STD_DOMAINS` gives the tests of the other four. |
| TYPE.TERM | The terms `list`, `record`, `fn`, `union` and `one` make types from types. A record type holds only plain records. It can name optional fields, and a closed record has no other fields. A function type tests only that a value is a function. `one` compares with `docEquals`. |
| TYPE.MEMBER | `member` tells if a value is a member of a type. A member of a domain passes the test `is` of the domain and of each parent. A test that throws gives `false`. For types without `unknown`, a member of a type is a member of each type that it fits. |
| TYPE.FITS | `fits(found, expected)` tells if each value of `found` can be where `expected` must be. It is reflexive, and transitive for types without `unknown`. `never` fits each type. Lists are covariant, records have width, and the parameters of functions are contravariant. An open record without an optional field fits only when that field is `unknown`. |
| TYPE.UNKNOWN | `unknown` is the gradual top: it fits each type, and each type fits it. A term that is not a value type, a base type without a domain, and a term deeper than 256 terms read as `unknown`. `fits`, `member` and `typeIssues` do not throw. |
| TYPE.ISSUES | `typeIssues` lists the problems of a type: each term that is not a value type, each base type without a domain and a term that is too deep. Each problem has its keys in the term. |
| TYPE.DOMAIN | A domain gives a base type its membership test `is` and its parents `under`. A base type fits itself and each parent, through each level. A cycle of parents ends. |
| TYPE.OPEN | A language adds its domains in the table `domains` of its machine, without a change to the kernel. A domain of the kernel that the table does not name comes from `STD_DOMAINS`. A table entry with the name `unknown` or `never` has no effect. |
| TYPE.MERGE | `mergeMachines` merges the domains name by name. Two domains with the same test, parents, summary and steps give one domain. Two different domains with one name are a conflict, unless the later part names `["domains", name]` in `replaces`. `formulaMachine` and `STD_MACHINE` give `STD_DOMAINS`. `restrictMachine` removes a domain. |
| TYPE.JOIN | `join` gives a type that holds each member of two types. `unknown` absorbs each type, and `never` is the unit. Two lists join their items, and two records join their fields. Each other pair gives a union, without the members that fit other members. |
| TYPE.TEXT | `typeText` gives a short text of a type for the reason of an issue, for example `list<number>`, `{a: number, b?: text}` and `(number) => text`. It does not throw. |
| TYPE.RULE | The type rule of a document is the rule of the evaluator that the ladder gives for the verb of the check. An evaluator object holds it in its field `type`. A runner and an evaluator without a rule give `unknown`. A rule that throws gives a type issue. |
| TYPE.SIGNATURE | A formula profile gives each operation a signature or a list of overloads (`sigs`). One signature gives the types of the arguments before their check. The first overload that fits gives the result. A wrong count of arguments, or no overload that fits, is a type issue at the operation. A bad type of a signature is a type issue one time in a check. |
| TYPE.SYNTH | `typeCheck` synthesizes the type of each document from the types of its parts. `lit` gives `one`, and `record` gives a closed record. `list` gives a list of the join of its items. `let` gives the type of its body, and its names get the types of their bindings. `fn` gives a function type, and `call` gives the result of its function. `if` gives the join of its branches. The profile changes the types of a truth, of the logic, of `otherwise` and of `omit`. `Kind.result` gives the type of each document of its kind. |
| TYPE.CHECK | With `types: true`, `check` gives each part the type that its position needs, and it checks the type that the part synthesizes. The rule of the parent, the `expect` of a shape, or the option `expect` for the root gives that type. A part that does not fit gives `#TYPE!` with `expected` and `found`, and it gets the type `unknown`. A type issue does not change an evaluation. The value types of a contract describe `eval` only. |
| TYPE.GRADUAL | An operation without a signature takes and gives `unknown`. A kind without `result` and an evaluator without a rule give `unknown`. A less precise signature does not add a type issue. Without the option `types`, `check` gives the same issues as before. |
| TYPE.SOUND | A document checks with no issue, and each operation keeps its signatures. Then each value of its evaluation is a member of the type that `typeCheck` gives its place. A property test examines generated documents. |
| TYPE.ROOTS | The option `rootTypes` of `check` and `typeCheck` gives the types of `self`, `world`, `event` and the names of the host. The root `caps` has the type `CAPS_TYPE`. A kind that binds a name hides the name of the host. The parts of an evaluator without a type rule get `unknown` for `self`, `world` and `event`. A rule can give its parts other types of these roots. The check examines each type of the host one time. |
| TYPE.PATH | A reference gets the type that its path reaches. Each step asks the type that the path reached. A record gives its field, and a list gives its items, or `number` for `length`. A union joins the steps of its types, and `one` gives the values that the step reaches. A type whose member can be an envelope gives `unknown`, because a path asks the ladder and follows a reference document. The path `["names"]`, a name that is a key of a header, an address and a step document give `unknown`. |
| TYPE.CLOSED | A field that a closed record does not have is a type issue at the reference, and the reference gets `unknown`. A union and `one` give the issue only when no type or value of them has the field. An open record and `unknown` give `unknown` with no issue. |
| TYPE.SCHEMA | `typeFromSchema` makes a type from a JSON Schema. It reads `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, `anyOf` and `oneOf`. Each other keyword tests nothing, and an issue names it. A schema with `$ref` or `nullable` reads as `unknown`. The type holds each value that the schema accepts, and the function does not throw. |
| TYPE.SAMPLES | `typeFromSamples` infers a type from sample values. Base values give base types, and the items of the lists join. All records join into one record, and a key that a record does not have is optional. A record is open, unless the option `closed` is `true`. Each sample is a member of the type. |
| TYPE.STEPS | A domain gives the types of the steps into its members (`Domain.steps`). A path reads the steps of the domain first, then the steps of each parent. A key without a type gives `unknown`. Two domains with different steps are a conflict of the merge. |
| TYPE.PARENTS | `extendDomain` makes a part of a merge that adds parents or steps to a domain of an earlier part. It keeps the test of the domain, and it names `["domains", name]` in `replaces`. A new parent adds its test, thus `fits` stays sound. A change of a domain without `replaces` is a conflict. |
| TYPE.ROOTS-SOUND | The roots of a context hold plain data that are members of the root types. A document checks with no issue. Then each value of its evaluation is a member of the type of its place. A property test examines generated root types, contexts and documents. |

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
