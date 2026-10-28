# The specification of the kernel

This file gives each rule of the kernel one requirement ID. Each ID has at least one test, and the title of the test starts with the ID in brackets. The test `spec.test.ts` makes sure that each ID of this file has a test, and that each ID of a test is in this file.

[`SEMANTICS.md`](SEMANTICS.md) gives the same rules as a small calculus. Each inference rule of that page names the IDs of this file that it covers.

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
| WORLD.ALIAS-LIMIT | A lookup follows at most 32 aliases. A longer chain gives no kind, thus a document of that type gives `#KIND?`. |
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
| COMPOSE.UNIFY | Two independent languages merge. Their equal kinds and their shared code give one entry, in each order. An alias and a kind of glue join them. Two calls of `formulaMachine` with equal profiles give the same evaluators and hooks of the kit, thus their machines merge. Two profiles are equal when they have the same fields that the kit reads. A function, a record or a host value is equal only to itself, and two lists are equal by their items. Two profiles that differ give a conflict at each evaluator name of the kit. |
| COMPOSE.SELF-EXTEND | A host merges kinds that a document gives as JSON, when each verb names an evaluator of the machine. A document cannot bring code: an own entry with an unknown evaluator gives `#NOEVAL`. |
| COMPOSE.EXTEND-UNIFY | Two independent extensions of one base compose without glue. Each order of the parts gives the same machine (WORLD.LAWS). Both extensions can add to one namespace of the base. |
| COMPOSE.INCREMENTAL | A language extends an extension, also at run time. It reads the entry that it replaces through `prev`. A plan keeps its machine, and a new plan uses the new machine. |
| COMPOSE.CONFLICT | Two extensions that each compose with the base can conflict. The merge throws one `MergeError` when the host builds the machine. The path of each conflict is the mark `replaces` that resolves it. |
| COMPOSE.CONSERVATIVE | A merge without a conflict can add kinds, aliases, namespaces, code and the defaults of new verbs. Such a merge keeps the result and the effects of each document of the base. The document names no new kind and no new code, and it reads no entry of the world that the merge changes, for example the root `world`. A new key under a fallback of the base is new only for documents that do not name it. A property test examines generated documents of three machines. |

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
| EVAL.SEALED | An evaluator gets each part sealed. Two parts with the same result can replace each other. This holds for code that reads its parts only through their handles, not through `doc.value` (C5). A property test changes a part of a generated document that evaluates one time to a JSON value into a literal of that value. The parent gives the same result, and the effects outside the part stay the same. A kind whose code reads `doc.value` breaks the law, and the test finds it. |
| EVAL.BY-NAME | Each call of the handle of a part is a new evaluation. The part evaluates again, and its effects happen again. |
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
| DEREF.COLLAPSE-LIMIT | One resolution follows at most 64 references, also through the paths of the references that it follows. A long chain without a cycle also gives `#CYCLE!`. |
| DEREF.READER | A reference in the data resolves in the context of its reader, not in the context of its writer. |
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
| DEREF.NO-WALKER | A step that is not a key, and not a document of a kind with the verb `step`, gives `#STEP?`. |
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
| TREE.ORDER-FREE | The order of the demands changes no attribute of a tree without a cycle. Thus another order of the fields of each node gives each document in a node the same result. A root and each document around it give the same value in each order, or an error in each order. The root gives the first error of its attributes in their order, thus that error can differ. A property test examines generated trees. |
| TREE.LADDER | A kind can give equations in its contract `tree`. A step to an attribute of a node visits five rungs in this order: the own part of the node, the equation of its kind, the equation `down` of the kind of its parent, a copy from the parent, and the default. The first rung that answers gives the attribute. An equation evaluates with the node as `self`, without capabilities, and without the names of the document. When no rung answers, the step gives `#N/A`. |
| TREE.RUNGS | `attributeTrace` gives the record of an attribute of a node: the rungs that its demand visited, and the rung that answered. An attribute without a demand has no record. |
| TREE.DOWN | An equation of `down` gives an attribute of each child of the node. It sees the names `child`, `index` and `prev`: the child node, its position in the list `children`, and the item before it. A child outside the list `children` has the index `null`. |
| TREE.COPY | An attribute that its kind declares `copy` gives the same attribute of the parent, through each level of the tree. A root has no parent, thus its default answers. |
| TREE.FOLD | An attribute that its kind declares with a `fold` starts from the `unit`. The term `combine` then adds the attribute of each node in the list `children`, with the names `acc` and `item`. A value in the list that is not a node does not count. A node without children gives the unit. A child without an answer gives `#N/A`. |
| TREE.DOWN-NAMES | `check` examines the equations of each kind one time, each with the names of its rung. The names `child`, `index` and `prev` exist only in `down`. `check` finds an effect in an equation. Each issue has the place of the first document of the kind, and its reason names the equation. |
| TREE.PLAN | The equations of a kind compile one time for each machine, through a cached planner. The plan of a document does not keep them, and a new plan uses the same compiled equations. |
| TREE.SELF | A node of a tree reads `self` only through `resolve` (C4), in the plan and in the reference. The read is in the list of reads, and `factsOf` gives it. A closed node does not fold. A machine that closes the root `self` makes each node the root of a new tree. |

## Evaluation and plans

| ID | Rule |
| --- | --- |
| PLAN.ONCE | A plan compiles a document one time. It evaluates many times with the same result as `evaluate`. |
| PLAN.FAIL-LATE | A document that does not compile gives a plan that fails when that document evaluates. A compiler that throws fails only its own document. The error has its place. |
| PLAN.TRACE | A traced evaluation records each document. An evaluation of a plan without a trace records nothing. |
| PLAN.CACHE | A planner compiles one document object one time. |
| PLAN.CACHE-ZERO | A planner keeps the bare values `-0` and `0` apart, thus `-0` evaluates to `-0`. |
| PLAN.COMPILE-SPEED | A compilation without a trace does not record the rungs of the ladder, thus it compiles a small document quickly. |
| PLAN.LEAN | A plan keeps only its compiled code. It does not keep its document or the split of the value, thus a store can keep many plans. A plan of one reference with a static path keeps less than 600 bytes, by a measure of the heap over 10000 plans. |
| PLAN.DEPTH | The nesting of documents has a limit. The default is 1000. |
| PLAN.PATH | A reference of the formula kit compiles its static path one time, in `prepare`. The compiled path reads the root and the open roots one time, and the ladder of `step` answers each step document one time. Each evaluation then examines only the values of the context. A trace and a runtime with another navigator resolve the steps again. The list of reads gets the steps of the document. |
| PLAN.PATH-SAME | A compiled path gives the same thing, error and reason as `resolve` without hops, and the host sees the same calls. A plan with compiled paths gives the result and the reads of a traced evaluation. Property tests examine random paths and generated documents. |
| PLAN.KIND-MEMO | A step on an envelope and the ladder of `step` look up the kind of a type one time for each world. The memo keeps each answer of the ladder: the own entry, the kind, the default and a kind that the world does not have. A memo with 1000 kinds starts again. |
| PLAN.FOLD | A part of a plan without a trace folds when it is closed and pure. A closed part reads no name that it does not bind (STATIC.REFS). A pure part has only code that the facts of D24 mark pure and not volatile, and no kind with effects or a run side. An extension of a formula profile is pure only when the profile names it in `pureExt` (D47). A folded part evaluates one time in `prepare`, with an empty context and a probe runtime. The probe resolves only the names that the part binds. A read of another root or of reference data, an effect, a kept context, an exception, `#DEPTH!` or a result that is not plain data cancels the fold. A plan whose evaluation records its reads evaluates a folded part that reads names again. The option `fold: false` stops the folds, and the reference does not fold. |
| PLAN.SHARED | A plan can give one result object to many evaluations. A folded part gives one deeply frozen copy of its result at each evaluation. The fold copies the data, thus the document of the host does not change. A host must not change a result in place. |
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
| EVAL.DETERMINISTIC | An evaluation is a function of the machine, the document, the context and the mock. A plan gives the same result, effects and reads again, also after an evaluation in another context. A new plan and the reference give the same result and effects too. An overflow of the stack of the host is the one exception (K94). A property test examines generated documents of six machines. |

## Verbs

A verb is one question to each document, for example `eval` or `format`. Each verb has one ladder, and each verb goes through the plan, `check` and the reference (D23).

| ID | Rule |
| --- | --- |
| VERB.PREPARE | `prepare`, `evaluate` and `run` take a verb. At each document, the ladder answers for that verb, and each part evaluates with the same verb. A plan of another verb evaluates, runs and traces as a plan of `eval` does. |
| VERB.DEFAULT | The default verb is `eval`. Without a verb, `prepare`, `evaluate`, `run`, `check`, `reference` and `agree` give the results that they gave before. |
| VERB.LADDER | Each verb visits the same rungs: the own entry, then the kind, then the default of the world. `deref` and `step` visit them too. A kind that the world does not have stops the question. When no rung of `deref` answers, a step goes into the value. |
| VERB.CHECK | `check` takes a verb. `#NOEVAL` and the hook `known` follow the evaluator of that verb. The shapes, the paths and the names follow the contracts, thus they are the same for each verb. The effects that `effects` declares count only for `eval`. |
| VERB.CONTRACT | The contract of a kind serves each verb. For each verb, the kernel splits the parts and narrows their capabilities by it. `side` and `effects` tell what `eval` does. An effect of another verb passes the test of its capabilities when it happens (RUN.CAP). |
| VERB.EFFECTS | A contract declares the effects of a verb other than `eval` in its field `verbEffects`, by verb, in the form of `effects`. `check` with that verb tests each declared effect against the capabilities of its document, as for `eval`: `#CAP!`, and `#CALC!` with the option `run`. A verb without an entry has no declaration, thus `check` gives no effect issue for it. `conforms` checks C2 for a verb with an entry. A run does not read the declarations of any verb (RUN.CAP). |
| VERB.FORMAT | A language adds a verb with a merge, without a change to the kernel. The verb `format` of the tests gives the text of a document. Its default writes `kind(part, part)`, and three kinds of the formula kit have their own entries. |
| VERB.AGREE | The reference reads each verb by the same rules. `agree` with a verb compares the plan of that verb with the reference, the traced plan and a second evaluation. The second tier of a language gets the verb. Generated documents agree for `format`. |

## One meaning

A reference interpreter reads the rules of this file directly and compiles nothing. A plan, the traced plan and the second tier of a language must give its results (D15).

| ID | Rule |
| --- | --- |
| PLAN.AGREES | A plan, a traced plan, a second evaluation of the plan, the plan with the other choice of folds and the reference interpreter give the same result for each generated document. With the option `observe`, the plan has no folds, and `agree` compares only the result and the effects of the tier `folds`. |
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
| RUN.SAME | A run gives the same result as an evaluation with the same `perform`, when the host answers each effect at once and no evaluator causes an effect. Thus a document without effects runs to the result of its evaluation. |
| RUN.NESTED-WAIT | A step that waits inside a part that cannot wait gives `#CALC!`. |
| RUN.NEEDS-RUNNER | In a run, an effect of an evaluator gives `#CALC!` before the test of its capability, also when the host does not wait. |
| RUN.DRIVE-NESTED | A run drives a runner under an evaluator without a wait, as an evaluation does. Only a step that really waits gives `#CALC!`. A branch that does not run does not wait. |
| RUN.WAIT | A part that waits under an evaluator gives `#CALC!`. The error has the place of the part. |
| RUN.CAN-WAIT | With the option `run`, `check` gives `#CALC!` for a runner under a parent without a runner, when an effect of its runners can reach the host. It also gives `#CALC!` for a kind that declares effects and has no runner. The issue has the place and the reason of the run. A document that passes this check gives no such `#CALC!` in a run. |
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
| SEQ.LAWS | A sequence with one step gives the result and the effects of the step. The steps at the end of a sequence can go into a nested sequence, also with their names. The steps at the start can go into a nested sequence when only the last of them has a name, and the nested sequence gets that name. Each such change keeps the result and the effects. A name reaches only the later steps of its own sequence and of the sequences in them. A property test examines generated steps. |
| EFFECT.ORDER | The effects keep their order. |
| CAP.PURE | An effect inside `pure` fails, because `pure` gives its part no capability. |
| CAP.PURE-ONE | The kind `pure` takes exactly one part. A list with no part or with more than one part gives `#VALUE!`. |
| CAP.NAMESPACE | A capability permits a kind by its name, or by its namespace. |
| CAP.KEYS | A capability permits the kinds under it, key by key. A key with a dot is one key. |
| CAP.NARROW | A part cannot get more capabilities than its parent. |
| CAP.NARROW-CODE | A compiled evaluator or a compiled runner cannot give a part more capabilities than its document has. Each context carries the capabilities that the kernel gave its document, and a spread of the context keeps them. A part and an effect of compiled code keep only these capabilities. A context that compiled code makes without a spread has no capabilities. |
| CAP.MONOTONE | Fewer capabilities change an evaluation only at an effect that they refuse and more capabilities permit. Before that effect, the two evaluations ask about the same effects and get the same answers. Without such an effect, they give the same result and the same effects. Thus fewer capabilities do not permit an effect that more capabilities refuse. This holds for a document that does not read the root `caps`, under code that keeps C1. A property test examines generated documents. |
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
| STATIC.COVERAGE | `checkWorld(machine, verbs)` checks the world before a document exists. It gives `#NOEVAL` for each kind and verb of the list when the kind has no entry and the world has no default for the verb. Thus a kind with no `view` entry, in a world with no `view` default, is in the list. The check visits each kind of each namespace and each fallback kind, and it does not follow an alias. A document of a kind in the list gives `#NOEVAL` in `check` with that verb. |

## The static facts

`factsOf` gives the static facts of a document for a schedule (R4 P2, D24). They depend only on the document and the machine.

| ID | Rule |
| --- | --- |
| FACTS.READS | Each free reference from a root is a read. A read has its root, its keys up to the first step document, its place and its JSON path. A read after a step document is not exact. A reference in an address position is an address. |
| FACTS.KIND-READS | A kind can declare in `reads` the roots that its code resolves as a whole. Each document of the kind then has an exact read of each root, with the path of the root alone, at its own place. The hook `facts` can give the roots too. |
| FACTS.LAZY | A lazy rule of a kind names the parts that an evaluation can skip and still give a value. A read under a lazy part is lazy. An eager read evaluates in each evaluation in which each document around it gives a value. Each part of a document with an own entry for another evaluator is lazy. |
| FACTS.SIDE | The side of a document is `run` when one kind in it is on the run side. Else the side is `derive`. |
| FACTS.EFFECTS | The effects are the kinds of effects that the contracts declare, each one time, in the order of the document. The effects `"type"` of a kind give the type of the document. |
| FACTS.PURE | A document is pure when each kind in it declares `pure`, and it has no effect and is not volatile. An unknown kind and an own entry for another evaluator are not pure. A pure document gives the same result when each value that no read reaches changes. |
| FACTS.VOLATILE | A document is volatile when a kind, an operation or a kind of step documents declares `volatile`. A read that the host marks also makes it volatile. A read of `event` and an effect do not. |
| FACTS.HOOK | The hook `facts` of a machine gives the facts of the code of a name. Each field of its answer wins over the contract. `mergeMachines` composes the hooks in order, and a hook does not answer for replaced code. |
| FACTS.VERB | The option `verb` names the verb whose code the facts describe. The default is `eval`. A contract describes the code of `eval`, and of `step` for a step document. Only the hook describes the code of another verb. The reads, the side and the effects do not depend on the verb. |
| FACTS.PROFILE | `formulaMachine` gives the hook `facts` of its profile. A lazy operation has a lazy rule for each argument. The profile names its pure and volatile operations. A standard extension is pure. An extension of the profile is pure only when the profile names it in `pureExt` (D47). The mark `pure: true` covers only the operations. |
| FACTS.SOUND | In each evaluation, each path that a plan resolves has a static read at the place of its document. The read has the root of the path, and its keys start the path. An exact read has the full path. |

## The reads of an evaluation

An evaluation can record its reads. `verifyReads` tells if an old result stays valid in a new context (R4 P3, D26). A schedule uses the list as a verifying trace.

| ID | Rule |
| --- | --- |
| READS.RECORD | `evaluate`, `plan.evaluate`, `run` and `plan.run` take a list `reads`. The list gets each resolution: the path, what it reached and the mark `free`. An exception of the host gives the error value of the read. A reference through a name that holds an error reads that name. Without the list, an evaluation records nothing and gives the same result. |
| READS.ORDER | The reads are in the order of the resolutions. The step documents of a path evaluate first, thus their reads come before the read of the path. |
| READS.FREE | A read is free when it reads the context at the root of the evaluation. A name that a kind binds, a `self` that a kind sets and a path without a root are not free. `verifyReads` skips each read that is not free. |
| READS.KEPT | A value that keeps the context adds a read of each whole root, one time in an evaluation. A closure of `fn` keeps the context. The first read of a `self` that a kind sets adds a read of the root `self`, because the kind can give the old `self` on. An earlier free read of the whole root `self` takes its place. |
| READS.VERIFY | `verifyReads` takes a machine or a plan, the reads and a new context. It resolves each free read again, and it compares the two answers with `sameResult`. The rule `equal` of the host answers first. When each read is the same, the old result stays valid. Code that asks for the hops gets them in its read, and the verification compares each hop. A longer path through a name that holds an error in the new context is changed. |
| READS.CHANGED | When a read is not the same, `verifyReads` gives the first such read, its index and what its path reaches in the new context. It does not resolve the later reads. |
| READS.LAZY | A part that the evaluation skips has no reads, for example the branch of `if` that the test did not select. A change that only such a part reads keeps the old result. |
| READS.DATA | A reference in the data that a resolution follows is a part of one read (DEREF.COLLAPSE), as `factsOf` counts it. A change of its target changes that read. |
| READS.SOUND | For the generated documents of six machines, the test changes the context at random. When each free read of a pure document is the same, a new evaluation gives the same result by `sameResult`. A list without the reads of whole roots gives stale results of trees, and the test finds them. |
| READS.SUBSET | Each free read of an evaluation has a static read of `factsOf` with the same root, and the keys of the static read start its path. A kept read, the read of a name that holds an error and a name that a kind binds to the value of the context are the exceptions. |

## Two levels of durability

A host keeps one epoch for the structure and one for the data (R4 P7, D30). The structure is the machine and the documents. The data is each value that a context gives. `durable` keeps the plans and the facts across the changes of data.

| ID | Rule |
| --- | --- |
| DURABLE.EPOCHS | `durable` keeps two epochs. `changeData` adds one to the data epoch. `changeStructure` adds one to each epoch, because a change of the structure is also a change of the data. The epochs are a snapshot that does not change. |
| DURABLE.DATA | A change of data compiles nothing and computes no facts. After it, a pure document verifies its reads with `verifyReads`, and it keeps its result when each read is the same. Each other document evaluates again. The rule `equal` of the host goes to `verifyReads`. |
| DURABLE.STRUCTURE | A document object compiles one time for a machine, and it computes its facts one time. An edit gives a new document object, thus only that document compiles. A new machine drops each plan, each fact and each result. A value document has its own plan, also `-0` beside `0`. |
| DURABLE.REUSE | A key names one node of the host. In one data epoch, a key with the same plan gives its result again without an evaluation, also with a new context object. One document at two keys gives each key its own result. `forget` drops the result of a key. |
| DURABLE.SOUND | For the generated documents of three configurations, the test makes random edits, new machines, changes of data and new context objects. Each result of `durable` is the same as a new evaluation by `sameResult`. A host that does not tell a change of data gets stale results, and the test finds them. |

## Schedules

A host gives named documents to `schedule`. Each document is a node, and the root `world` of each node reaches the other nodes. The schedule gives the graph of the nodes and the side of each node, and it evaluates the nodes on demand (R4, D31). The functions of `graph.ts` analyze such a graph before a run (S2, D33).

| ID | Rule |
| --- | --- |
| SCHED.GRAPH | `schedule` keeps named documents as nodes. The root `world` of each node reaches the other nodes, and the context of the host gives the other roots. `graph()` gives each node with its facts, its side and its edges. The map stays one object in one structure epoch. |
| SCHED.EDGES | `edgesOf` changes each static read of `world` into an edge to the node of its first key, with the lazy mark of the read. A read without a key after `world` has no target node. A read of another root is not an edge. |
| SCHED.GRAIN | An edge goes to a node, and it keeps the keys after the node as its field. A change of another field of the node evaluates the node again, and a reader of the field keeps its result. |
| SCHED.SIDE | The side of a node comes from `factsOf`. A node on the run side is a sink: a read of it gives `#REF!`, and the schedule does not evaluate it. The record of the root `world` has only the derive nodes. |
| SCHED.RUN | The schedule does not start a run. `run` starts a run of the document of a node with the context of the schedule and the event of the host. A demand and a change of data do not repeat a run. |
| SCHED.DEMAND | `read` evaluates a node and each node that its evaluation reads, through `durable`. Each node evaluates at most one time in a data epoch. A node that no read and no eager edge of a demand reaches does not evaluate. A missing node gives `#N/A`. |
| SCHED.STALE | After a change, a pure node verifies its reads, and a read of a node demands that node again. A node evaluates again only when a read changed, or when it is not pure. A new machine evaluates each node again. |
| SCHED.CYCLE | Each node of a strongly connected component of the reads, and each node that reads itself, gives `#CYCLE!`. The reason names only the node, and the error has no place. Each order of demands gives the same values. A reader gets the error at its reference. A static cycle through a read that the evaluation skips is not a cycle. |
| SCHED.ONE-MEANING | For generated graphs of nodes, the test makes random edits, new nodes, removed nodes, new machines and changes of data, and it reads the nodes in random orders. Each result is the same as an evaluation of the whole graph from scratch by `sameResult`, also for each cycle. A host that changes its data in place gets stale values, and the test finds them. The test reaches the demands ahead of SCHED.LONG-CHAIN. Each node that gives `#CYCLE!` is on a static cycle of `cycles`, unless a literal holds a reference to a node (S1d). |
| SCHED.LONG-CHAIN | A demand with no node in evaluation, from the host or a run, first demands each node that the eager edges reach, deepest first. A chain of 100000 nodes gives its value with no `#DEPTH!`, also after a change of data. A node behind a lazy edge is not a demand ahead. The values stay the values of D31. |
| GRAPH.SCC | `components` gives the strongly connected components of a graph of nodes, by the algorithm of Tarjan. Each component comes after each component that it reads. The walk has its own stack, thus a chain or a ring of 100000 nodes does not overflow. |
| GRAPH.ORDER | `heights` gives the order of a push schedule. A node that reads no node outside its component has the height 0. Each other node is one higher than the highest node that it reads outside its component. |
| GRAPH.LAYERS | `nodeLayers` puts the nodes of each height in one layer, in linear time. Two nodes of one layer read each other only inside one component. Each layer keeps the order of the graph. |
| GRAPH.NECESSARY | `necessary` gives each observed node, and each node with a path of edges from an observed node. A name that is not a node adds nothing. |
| GRAPH.CYCLE | `cycles` gives each component with two or more nodes, and each node that reads itself. A cycle of eager edges with a target is certain, and each other cycle is possible. The demand of D31 still gives the value of each node. |
| GRAPH.UNKNOWN | An edge without a target reads each node that is not a sink. An edge to a sink, or to a name that is not a node, is no edge of the analysis. The option `eager` keeps only the eager edges with a target. |

## Types

A value type is a set of values that a result can have (R5 P2, D22). It is a JSON term that only a check reads. It is not a kind, and it does not go into an envelope. A check of types gives each part a type in two directions (R5 P3, D25). The host gives the types of the roots, and a reference gets the type that its path reaches (R5 P4, D28).

| ID | Rule |
| --- | --- |
| TYPE.BASE | A text names a base type. The kernel has `unknown`, `never`, `null`, `undefined`, `bool`, `number` and `text`. `unknown` holds each value, and `never` holds no value. `STD_DOMAINS` gives the tests of the other five. `undefined` holds only the value `undefined`. JSON has no such value, thus a document holds it as `ext.undefined`, and no `one` holds it (D48). |
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
| TYPE.SIGNATURE | A formula profile gives each operation a signature or a list of overloads (`sigs`). One signature gives the types of the arguments before their check. The first overload that fits gives the result. A parameter at the end is optional when `undefined` is a member of its type, for example `unknown`. A wrong count of arguments, or no overload that fits, is a type issue at the operation. A bad type of a signature is a type issue one time in a check. |
| TYPE.SYNTH | `typeCheck` synthesizes the type of each document from the types of its parts. `lit` gives `one`, and `record` gives a closed record. `ext.undefined` gives `undefined`, and `ext.number` gives `number`. `list` gives a list of the join of its items. `let` gives the type of its body, and its names get the types of their bindings. `fn` gives a function type, and `call` gives the result of its function. `if` gives the join of its branches. The profile changes the types of a truth, of the logic, of `otherwise` and of `omit`. An `otherwise` of `undefined` gives `undefined`. `Kind.result` gives the type of each document of its kind. |
| TYPE.CHECK | With `types: true`, `check` gives each part the type that its position needs, and it checks the type that the part synthesizes. The rule of the parent, the `expect` of a shape, or the option `expect` for the root gives that type. A part that does not fit gives `#TYPE!` with `expected` and `found`, and it gets the type `unknown`. A type issue does not change an evaluation. The value types of a contract describe `eval` only. |
| TYPE.GRADUAL | An operation without a signature takes and gives `unknown`. A kind without `result` and an evaluator without a rule give `unknown`. A less precise signature does not add a type issue. Without the option `types`, `check` gives the same issues as before. |
| TYPE.SOUND | A document checks with no issue, and each operation keeps its signatures. Then each value of its evaluation is a member of the type that `typeCheck` gives its place. A property test examines generated documents. |
| TYPE.ROOTS | The option `rootTypes` of `check` and `typeCheck` gives the types of `self`, `world`, `event` and the names of the host. The root `caps` has the type `CAPS_TYPE`. A kind that binds a name hides the name of the host. The parts of an evaluator without a type rule get `unknown` for `self`, `world` and `event`. A rule can give its parts other types of these roots. The check examines each type of the host one time. |
| TYPE.PATH | A reference gets the type that its path reaches. Each step asks the type that the path reached. A record gives its field, and a list gives its items, or `number` for `length`. A union joins the steps of its types, and `one` gives the values that the step reaches. A type whose member can be an envelope gives `unknown`, because a path asks the ladder and follows a reference document. The path `["names"]`, a name that is a key of a header, an address and a step document give `unknown`. |
| TYPE.CLOSED | A field that a closed record does not have is a type issue at the reference, and the reference gets `unknown`. A union and `one` give the issue only when no type or value of them has the field. An open record and `unknown` give `unknown` with no issue. |
| TYPE.SCHEMA | `typeFromSchema` makes a type from a JSON Schema. It reads `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, `anyOf` and `oneOf`. Each other keyword tests nothing, and an issue names it. A schema with `$ref` or `nullable` reads as `unknown`. The type holds each value that the schema accepts, and the function does not throw. |
| TYPE.SAMPLES | `typeFromSamples` infers a type from sample values. Base values give base types, also `undefined`, and the items of the lists join. All records join into one record, and a key that a record does not have is optional. A record is open, unless the option `closed` is `true`. Each sample is a member of the type. |
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

## The codec of values

A document holds a value that JSON cannot write as a standard extension (D40). Thus the same value has the same document in each language (D12).

| ID | Requirement |
|---|---|
| EXT.DOMAIN | `ext.domain` holds a record with only the text `domain` and the JSON `data`. The codec of that domain of the machine reads the data. A domain without a codec gives `#NAME?`. Data that the codec cannot read gives `#VALUE!`, and so does a value that is not a member of the domain. The plan and the reference agree. |
| EXT.ENCODE | `encodeValue` writes a host value as a term document. JSON stays as it is, and a literal with the shape of an envelope goes into `lit`. `NaN`, an infinity, `-0` and `undefined` use `ext.number` and `ext.undefined`. A member of a domain with a codec uses `ext.domain`. A cycle and a value without a codec throw. |
| EXT.ROUNDTRIP | `decodeValue(machine, encodeValue(machine, v))` gives `v` again by `sameValue`. A property test examines generated values. |
| EXT.TYPE | The check of types gives `ext.domain` the type of its domain when the domain has a codec. |

## The syntax kit

A syntax profile gives the text of a language: its operators, literals, references and calls (D41). One parser and one printer read the profile.

| ID | Requirement |
|---|---|
| SYNTAX.PARSE | `parse(profile, text)` gives a document of the formula kit. The precedence and the grouping of each operator decide the tree. A literal that JSON cannot write uses `ext.number` or `ext.undefined`. |
| SYNTAX.SPAN | A bad text gives an issue with a 0-based offset, a length and a message. `parse` does not throw for a bad text. |
| SYNTAX.PRINT | `print(profile, doc)` writes the fewest parentheses that keep the tree. A document without a text form gives `#VALUE!` at its place. `syntaxFormat` adds the printer as the default of the verb `format`, and an own entry of a part still wins. |
| SYNTAX.ROUNDTRIP | `parse(profile, print(profile, doc))` gives `doc` again for each document that the profile writes. A property test examines generated documents of three profiles. |
| SYNTAX.PROFILE | A profile describes the syntax of another language, for example a spreadsheet with `A1`, `&`, `^` and `<>`, or an algebra with named knobs and only `min`, `max` and `floor`. A profile with two readings of one symbol throws a `TypeError`. |

## Conformance

`conforms(machine, name)` examines one evaluator or runner against the obligations of `SEMANTICS.md` (D36). It gives one finding for each obligation that the code breaks.

| ID | Rule |
| --- | --- |
| CONFORM.STD | Each evaluator and each runner of `STD_MACHINE`, and each evaluator of the formula kit with three profiles, conforms. `conforms` throws for a name without code, and for code that no kind names. |
| CONFORM.NARROW | Code that gives a part or an effect more capabilities than its document has breaks C1. A spread, a context from an earlier call and a function evaluator are found. |
| CONFORM.EFFECTS | Code that causes an effect that its contract does not declare breaks C2. The effects `type` declare the type of the document. For a verb other than `eval`, the entry of the verb in `verbEffects` is the declaration (VERB.EFFECTS). |
| CONFORM.LAZY | Code that skips an eager part, or that evaluates a lazy part whose result does not change the result, breaks C3. The check applies only to the verb `eval`. |
| CONFORM.PURE | The code of a pure kind that causes an effect breaks C4. Code that reads a root of the context outside `resolve` breaks C4 too. |
| CONFORM.SEALED | Code whose result changes with the JSON of its parts, when the results of the parts stay the same, breaks C5. The names of the parts are permitted. |
| CONFORM.WAIT | A runner that drops a wait, makes its own wait or evaluates a part with code that cannot wait breaks C6. An evaluator that gives a promise breaks it too. |
| CONFORM.SCOPE | Code that binds another name for a part, does not bind a name of the scope rules, or hides a name of the document breaks C7. |
| CONFORM.LOCAL | Code that gives another record for the same probe in a later call breaks the local lemma. Compiled code that disagrees with its definition for the reference breaks it too. |
| CONFORM.PROFILE | Compiled code that reads a table whose answer changes after the compilation breaks C8. Code of an earlier compilation and new code differ on the same probe. |

## The calculus

| ID | Rule |
| --- | --- |
| SEM.RULES | Each inference rule of `SEMANTICS.md` names the IDs of this file that it covers. Each of these IDs is in this file and has a test. |

## The package

| ID | Rule |
| --- | --- |
| PKG.PURE | An import of the package does nothing. Each statement at the top of a module is free of side effects, or its expression has the mark `/* @__PURE__ */`. Thus a bundler that does not examine functions, for example esbuild, removes each unused part. |
