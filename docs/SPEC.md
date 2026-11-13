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
| COMPOSE.EXTEND-VERB | A part names the verbs that it owns in `verbs`, and it adds entries to the kinds of other parts in `extends`. A path as `replaces` names it finds the kind, at each depth, and a fallback kind too. The merge adds the entries after each part, thus the order of the parts does not change them. Two equal entries give one entry. The kind keeps each other field. The result of a merge has no `verbs` and no `extends`. |
| COMPOSE.PIRACY | An entry of a verb that the part does not own, on a kind that the part does not give, is a conflict. A part that owns a verb of the kernel, two different parts that own one verb, two different evaluators for one verb of a kind, and an entry for a path without a kind are conflicts too. The mark `replaces` of the path of a conflict resolves it. |
| COMPOSE.CONSERVATIVE | A merge without a conflict can add kinds, aliases, namespaces, code and the defaults of new verbs. Such a merge keeps the result and the effects of each document of the base. The document names no new kind and no new code, and it reads no entry of the world that the merge changes, for example the root `world`. A new key under a fallback of the base is new only for documents that do not name it. A property test examines generated documents of three machines. |
| COMPOSE.BOUNDARY | A document of the kind `lang` holds the name of a language and a document in that language. The machine of that language evaluates the inner document, and only its result crosses. The inner document gets no names and no capabilities. An unknown language gives `#NAME?` (K38, D193). |

## Languages

| ID | Rule |
| --- | --- |
| LANG.IDENTITY | `defineLanguage` gives one frozen value. Its text `data` is the canonical JSON of `requires` and `world`, with the keys in order. Two equal data halves give one text. The name, the version and this text identify a language. A value of the data half that is not JSON is an error. |
| LANG.REQUIRES | `compose` needs each language in `requires` before the language that names it. The version of that language is in the caret range of SemVer from the version in `requires`. Each other case is a conflict. |
| LANG.COMPOSE | `compose` gives the machine of `mergeMachines` over its languages. One language that comes twice counts once. Two versions of one name and two data halves under one name and one version are conflicts. A conflict of the merge also comes in one `MergeError`. |

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
| DEREF.CHAIN-REASON | The reason of `#CYCLE!` tells a cycle from a long chain. A reference that comes again in the evaluation of its own path gives the reason "The references form a cycle.". A resolution that follows more than 64 references without such a cycle gives a reason that names the bound. A lookup gives the reason `cycle` when it reaches a path again, and the reason `too-long` after 32 aliases without a cycle. |
| DEREF.READER | A reference in the data resolves in the context of its reader, not in the context of its writer. |
| DEREF.HOST | A host thing answers its own steps. |
| DEREF.PATH | A host thing can answer all the keys of a path in one call. |
| DEREF.HOST-UNDEFINED | A host thing tells a field that holds `undefined` from a missing field. When `deref` gives `undefined`, `has` tells which it is. `resolve` gives `{ thing: undefined }` for such a field. A thing without `has` reads `undefined` as a missing field. Each node of the standard tree has `has`. |
| DEREF.KIND-UNDEFINED | The code of a `deref` evaluator tells a field that holds `undefined` from a missing field, as a host thing does. When the code gives `undefined`, its optional `has` tells which it is. A code without `has` reads `undefined` as a missing field. A compiled path and `resolve` give the same answer. |
| DEREF.WALKER-UNDEFINED | A walker tells a field that holds `undefined` from a missing field. Its input has `has`, which answers through the ladder of `deref`. Each resolution gives it, with and without a record of hops. A compiled path and `resolve` give the same answer. |
| DEREF.QUICK | A resolution without hops asks a host thing for all the keys one time. The root `world` uses the same short path. |
| DEREF.PLAIN | A plain navigation reads a value with the shape of a reference as data. |
| DEREF.ROOTS | A navigation can close roots. A path from a closed root gives `#REF!`. |
| DEREF.ADOPT | A navigation can adopt each value that a path reaches as a thing, also a value that a `let` binds. |
| DEREF.HOPS | A resolution can skip the record of its hops. |
| DEREF.SYMBOL | The brand of a host thing is a global symbol. Two copies of the kernel know the things of each other. |
| FAILURE.SYMBOL | The brand of a `Failure` is a global symbol. Each engine, the formula kit and `conforms` give the error value of a `Failure` of another copy of the kernel (D208). |
| DEREF.WALK-CODE | A walker can give the code of its failure, for example `#REF!` for a position outside a space. The default code is `#N/A`. |
| DEREF.NO-WALKER | A step that is not a key, and not a document of a kind with the verb `step`, gives `#STEP?`. |
| TREE.PARENT | A node of a tree reads its parent through the field `parent`. |
| TREE.NEAREST-SELF | A walk `nearest` with `self: true` starts at the node itself. |
| TREE.NEAREST-MATCH | A host can give the walker `nearest` its own test of a type and its own limit of hops. |
| HOP.PLACE | `placeOf` gives the place of a node of the decorated tree: the keys from the root document to the document of the node. A view puts each hop on its node with it. A value, a plain record and another host thing give `undefined`. |
| HOP.EACH-STEP | The walker `nearest` with the option `eachStep` gives a resolution with hops one hop for each node on the way. Each such hop has the followed key as its step, and the hop of the whole walk comes after them. A failed walk keeps them. Without the option, the walk has one hop. A resolution without hops gives the walker no `visit`. |
| TREE.ONCE | An attribute of a node evaluates one time in an evaluation, also when two readers ask for it. |
| TREE.LAZY | A node of a tree is a host thing, and each part of the node is an attribute. A node in an attribute of an open tree gives its thing. An attribute evaluates only when something reads it. |
| TREE.SIBLING | A node reads an attribute of a sibling through its parent, for example `["self", "parent", "children", 0, "width"]`. The read does not recurse, also for a later sibling. |
| TREE.CYCLE | A demand that reaches an attribute in evaluation gives `#CYCLE!`. The reason gives the chain of attributes. The error has the place of the reference that closed the cycle. A chain of circular attributes gets an approximation in its place (TREE.CIRCULAR). |
| TREE.ERROR | A reference to a failed attribute gives the error of that attribute, with its code, its reason, its place and its cause. |
| TREE.MEMO | Each node keeps one memo for each attribute, for one evaluation. Each evaluation makes new nodes, thus nothing stays from an earlier evaluation. The cells of a host change this rule (TREE.CELL). |
| TREE.PURE | The kinds `panel` and `box` mask the capabilities of their parts. An attribute evaluates on demand, thus an effect in it gives `#CAP!`, and `check` finds it. |
| TREE.RESULT | The root of a tree gives the JSON of the tree: each attribute in the order of the parts, with the JSON of each node in a value. A node of a closed tree starts a new tree. |
| TREE.ORDER-FREE | The order of the demands changes no attribute of a tree without a cycle. Thus another order of the fields of each node gives each document in a node the same result. A root and each document around it give the same value in each order, or an error in each order. The root gives the first error of its attributes in their order, thus that error can differ. A property test examines generated trees. |
| TREE.LADDER | A kind can give equations in its contract `tree`. A step to an attribute of a node visits five rungs in this order: the own part of the node, the equation of its kind, the equation `down` of the kind of its parent, a copy from the parent, and the default. The first rung that answers gives the attribute. An equation evaluates with the node as `self`, without capabilities, and without the names of the document. When no rung answers, the step gives `#N/A`. |
| TREE.RUNGS | `attributeTrace` gives the record of an attribute of a node: the rungs that its demand visited, and the rung that answered. An attribute without a demand has no record. |
| TREE.DOWN | An equation of `down` gives an attribute of each child of the node. It sees the names `child`, `index` and `prev`: the child node, its position in the list `children`, and the item before it. A child outside the list `children` has the index `null`. |
| TREE.COPY | An attribute that its kind declares `copy` gives the same attribute of the parent, through each level of the tree. A root has no parent, thus its default answers. |
| TREE.FOLD | An attribute that its kind declares with a `fold` starts from the `unit`. The term `combine` then adds the attribute of each node in the list `children`, with the names `acc` and `item`. A value in the list that is not a node does not count. A node without children gives the unit. A child without an answer gives `#N/A`. |
| TREE.DOWN-NAMES | `check` examines the equations of each kind one time, each with the names of its rung. The names `child`, `index` and `prev` exist only in `down`. `check` finds an effect in an equation. Each issue has the place of the first document of the kind, and its reason names the equation. |
| TREE.CHECK-UNKNOWN | `check` finds a reference from `self` to an attribute that no rung answers, with the code `#N/A` and the place of the run. The steps `parent` go up the known nodes. `check` knows the self of a document only through the nodes and the standard code that keeps self. A parent that `check` does not know can be a node of each kind of the world, also of a fallback kind. |
| TREE.CHECK-RESERVED | `check` finds an attribute with the name of a structural step, `parent` or `type`, in a tree contract or in the parts of a node. It gives `#NAME?`. `check` also finds a tree kind of the run side, with `#CALC!`. |
| TREE.CHECK-COMPLETE | `check` examines each node of a document by the needs of its kind: each declared attribute, and each attribute of the node that an equation of the kind reads. When no rung answers a need, `check` gives `#N/A` at the node. An own part hides the equation of its name. |
| TREE.CELL | A host can give the tree kit its own memo cells with `treeNodeEvaluator({ cell })` at the name `tree.node`. The kit uses the cell of a place and an attribute at each demand. A cell that counts shows one computation for each node and attribute that an evaluation demands. Without a cell, the code is the standard code. |
| TREE.CELL-KEPT | A second evaluation of a plan with the kept cells of a host computes nothing, and it gives the same result. |
| TREE.CELL-PLAN | The array `place` of a cell is one object for each node of a plan in its scope. A new plan gives new arrays. Thus a changed document does not reuse a kept cell, and it gives its new values. |
| TREE.CELL-STORE | A host drops the cells that read a changed store. The next evaluation computes only those attributes. A node of an earlier evaluation in a kept value reads the new cells. |
| TREE.CELL-CYCLE | A cycle through the cells of a host gives the same `#CYCLE!` as the plain memo, because the kit marks an attribute before it uses its cell. An exception of a cell that `compute` did not throw gives `#CYCLE!` with the chain of the demands. The exception is its cause. A `Failure` and a stack overflow of the cell keep their own error value (D208). |
| TREE.CELL-DOCUMENT | The array `place` of a cell is the key of a node in its scope: the key of the node around it, or the demand that made its tree. The cached plan of an equation thus gives a new key in each document and for each node of its kind. Each document gets its own values, and a second evaluation computes nothing. The items of the key are the keys of the place. |
| TREE.CELL-NESTED | A cell that evaluates a second document during a demand gives that document its own marks, its own tree and its own cells. This is also true for the same plan with other names. Thus the nested evaluation gives its own values and no false `#CYCLE!`. |
| TREE.PLAN | The equations of a kind compile one time for each machine, through a cached planner. The plan of a document does not keep them, and a new plan uses the same compiled equations. |
| TREE.SELF | A node of a tree reads `self` only through `resolve` (C4), in the plan and in the reference. The read is in the list of reads, and `factsOf` gives it. A closed node does not fold. A machine that closes the root `self` makes each node the root of a new tree. |
| TREE.GRAPH | `attributeGraph` gives one vertex for each attribute of each node, and one edge for each read. A read of `self`, of the parent, of the previous sibling and of a `fold` gives an edge from a known vertex. A read through a value gives an edge with an unknown source. |
| TREE.GRAPH-CYCLE | `check` gives `#CYCLE!` before a run for each certain cycle that the eager reads reach, at the place and with the reason of the run. A cycle through a lazy branch or an unknown read is not an issue. |
| TREE.GRAPH-DEPTH | The graph of attribute instances keeps the depth limit of `check`. A document deeper than the limit has no vertex, and its reads have an unknown source. A vertex keeps its node and the name of its attribute. The texts of its name and of its place come only for the result of `attributeGraph` or for an issue. The order of a JSON read uses its own stack. Thus a deep tree with one reference to a node costs `check` time and memory linear in its size. |
| TREE.GRAPH-JSON | A read of the JSON of a node is one edge from the JSON vertex of the node. That vertex reads each own attribute of the node, and the JSON vertex of each node in their values. Its attribute is the empty text, its field `json` is true, and its name is the place of the node with `null` at the end. The list of a cycle has no JSON vertex. A cycle that closes through a JSON vertex has the place of the read of the node, as in the run. Thus R references to a node with A attributes under it give approximately R + A edges, not R × A. A list keeps its sorted items, and the previous sibling of a child comes from the index of the child. |
| TREE.GRAPH-AGREES | In the generated trees, each read of a run along a static edge is an edge of the graph, or a path through the JSON vertices of the nodes that the read reaches. A run that gives a value gets no `#CYCLE!` from `check`. |
| TREE.CIRCULAR | An attribute with the declaration `circular: { start, limit }` evaluates to a fixed point. In its cycle, a demand gets the current approximation, and the leader evaluates again until no value changes (DOC.EQUALS). The scrollbar example becomes stable in two rounds, and the reachable nodes of a loop give the least fixed point. |
| TREE.CIRCULAR-ORDER | For monotone equations, another order of the demands gives the same values. The attribute that a demand reaches first leads the fixed point. |
| TREE.CIRCULAR-MIXED | A cycle with a plain attribute gives `#CYCLE!` as before, in each order of the demands. A chain gets an approximation only when each attribute from the closed one to the demand is circular. `check` gives the same issue. |
| TREE.CIRCULAR-LIMIT | A fixed point that does not become stable within its limit gives `#CYCLE!` at the place of the node of the leader. The reason names the leader and the limit. Without a limit, the limit is `CIRCULAR_LIMIT`, 100 rounds. |
| TREE.CIRCULAR-CHECK | `check` gives no issue for a certain cycle of circular attributes. The graph keeps its edges, and it marks the cycle and its vertices `circular`. A declaration `circular` without a start value or with a bad limit gives `#VALUE!` in `check` and at its demand. |
| TREE.CIRCULAR-CELL | The cells of a host keep only final values. Only the cell of the leader gets a value of a fixed point, after the last round. A second evaluation with the kept cells computes nothing. |
| TREE.COLLECT | An attribute with the declaration `collect: { unit, combine }` combines the contributions of its subtree. The node visits itself, then each node of its tree in each list `children`, in the order of the lists. A node counts one time. A node contributes when its kind has the equation in `tree.contributes`. `combine` sees the names `acc` and `item`. The collection comes after a fold in the last rung. A bad declaration gives `#VALUE!` in `check` and at its demand. `check` and the graph of attribute instances see the contributions and the cycles. |
| TREE.NAMED | An attribute with the declaration `collect: "names"` is a registry: a record from the binding name of each node of its subtree to its node. The step `tree.named` goes up from the thing before it to the first thing that answers the registry, and it gives the node with its name. The field `in` names the registry, and the default is `names`. A missing name gives `#N/A`. Two nodes with one name give `#VALUE!` at the read of the registry. |
| TREE.AT | The step `tree.at` reads an attribute with parameters of the node before it. The field `attr` names the entry in `tree.at` of the kind, and `args` gives the arguments. The equation sees each parameter as a name. Two arguments that are equal by DOC.EQUALS give one instance, and the memo keeps one result for each instance. A missing or an extra argument gives `#VALUE!`. An attribute without an entry gives `#N/A`. A plain read does not see `tree.at`. An instance in evaluation gives `#CYCLE!`, also in a fixed point. |
| TREE.AT-CHECK | `check` gives `#VALUE!` for a bad entry of `tree.at` and for a step with missing or extra arguments. It gives `#N/A` for a step without an entry. It checks each equation with the parameters as its names. In the graph of attribute instances, a step with literal arguments reads one vertex for its instance. A document in the arguments gives an edge with an unknown source. |
| TREE.AT-CELL | The cells of a host keep each instance. The place of the cell is a second array with the keys of the node, and the attribute is the JSON text of the name and the arguments. A second evaluation with the kept cells computes nothing. |
| TREE.HIGHER | The field `higher` of `tree.attributes` gives the value of a node after the rungs before it miss. Its equation gives a document as data, and the kind `tree.quote` holds a literal document. The document evaluates as an equation, with the node as `self`, without names and without capabilities. Its root is a new node under the node, in the same build. The subtree is not in `children`. A value that is not JSON data gives `#VALUE!`, and so does a root that is not a node. |
| TREE.HIGHER-PLAN | `documentKey` gives the structural key of a document, and the fields of a record keep their order in it. One key means one document, and these documents are equal by DOC.EQUALS. Documents with one key share one plan. The table of documents holds at most 1000 documents and 16,000,000 characters of keys, and a full table starts again. |
| TREE.HIGHER-CYCLE | A cycle through a generated subtree gives `#CYCLE!` with the chain of the attributes. `check` gives the same issue when the equations alone show the cycle. |
| TREE.HIGHER-DEPTH | A generation under more than `GENERATION_LIMIT` generated documents gives `#DEPTH!` in each tier, with one reason. The limit is 64. Thus an equation that generates its own kind ends before the stack ends. |
| TREE.HIGHER-CELL | The cells of a host keep a generated subtree. The key of its root comes from the plan of the document and the key of the parent, thus two generators get two keys. A new object with a known key gets the same plan and the same keys. |
| TREE.HIGHER-CHECK | `check` examines the equation of `higher`. It does not examine the document that the equation gives. The graph gives the attribute the reads of its equation and one unknown edge, and a step after a generated subtree gets an unknown edge too. |
| TREE.FORWARD | The field `forwards` of a contract names an attribute that gives a node. The rung `forward` is the last rung of the ladder. An attribute that no other rung answers comes from that node, through its own ladder. The rung counts each node that it reaches, with the limit of TREE.HIGHER-DEPTH. A value that is not a node gives `#VALUE!`. The JSON of the node holds only its parts. |
| TREE.FORWARD-CHECK | `check` accepts each other name of a kind with `forwards`, because only the run knows the node. The attribute `forwards` needs a rung. A field that is not a text gives `#VALUE!`, and a structural name gives `#NAME?`. The graph gives the rung one edge from the attribute `forwards` and one unknown edge. |

## Evaluation and plans

| ID | Rule |
| --- | --- |
| PLAN.ONCE | A plan compiles a document one time. It evaluates many times with the same result as `evaluate`. |
| PLAN.FAIL-LATE | A document that does not compile gives a plan that fails when that document evaluates. A compiler that throws fails only its own document. The error has its place. |
| PLAN.TOTAL | The kits of the kernel mark compiled code that cannot fail (D50). Such code gives a value and throws nothing, and it does not read its context. The plan does not wrap it in the code that places errors. The formula kit marks `lit` and a step document without parts. Each result, each error and each place stay the same. A host cannot mark code. |
| PLAN.TRACE | A traced evaluation records each document. An evaluation of a plan without a trace records nothing. |
| PLAN.CACHE | A planner compiles one document object one time. |
| PLAN.CACHE-ZERO | A planner keeps the bare values `-0` and `0` apart, thus `-0` evaluates to `-0`. |
| PLAN.CACHE-OVERFLOW | A planner keeps no plan of a compilation with a stack overflow, because such a plan depends on the depth of the stack. The next call compiles the document again (D208). |
| PLAN.COMPILE-SPEED | A compilation without a trace does not record the rungs of the ladder, thus it compiles a small document quickly. The bench measures the time (K200). |
| PLAN.LEAN | A plan keeps only its compiled code. It does not keep its document or the split of the value, thus a store can keep many plans. A plan of one reference with a static path keeps less than 393.4 bytes in the data spaces of the heap, by a measure of the retained heap over 10000 plans. The data spaces are all spaces except the code space and the trusted space, which hold the code of the JIT (D170). The limit is the worst of 50 CI values plus their spread (K229, D171). The line of the measure also prints `bytes`, the change of `heapUsed`, and it gates nothing. Only the job `measure` of `measure.yml` applies it, because that job measured it (D104). The limit of 395 bytes was not enforced from K211 (2026-11-02) to K228 (2026-11-05), because a pipe hid each failed test. In that time it failed in 8 of 99 jobs that we read (D161). The values of `bytes` have two levels, and the values of `data` have one (D170). A flip row of that job adds 20 bytes to the value, and the step turns red (K227, D162). A second flip row makes each plan keep an array of 1 KB, and the step turns red (D171). |
| PLAN.DEPTH | The nesting of documents has a limit. The default is 1000. |
| PLAN.RUN-OPTIONS | A plan keeps the verb and the declared type of its `prepare`. Thus the options of `plan.run` (`PlanRunOptions`) do not have them. The options of `run` (`RunOptions`) add them for its `prepare`. |
| PLAN.PATH | A reference of the formula kit compiles its static path one time, in `prepare`. The compiled path reads the root and the open roots one time, and the ladder of `step` answers each step document one time. Each evaluation then examines only the values of the context. A trace and a runtime with another navigator resolve the steps again. The list of reads gets the steps of the document. |
| PLAN.PATH-SAME | A compiled path gives the same thing, error and reason as `resolve` without hops, and the host sees the same calls. A plan with compiled paths gives the result and the reads of a traced evaluation. Property tests examine random paths and generated documents. |
| PLAN.PATH-EXPORT | The package exports `compilePath`, `resolveCompiled` and the type `CompiledPath` (D129). The evaluator of a language calls `compilePath` one time, in its `compile`, with the field `machine` of its input. Each evaluation then examines only the values of the context, as for a reference of the formula kit. |
| PLAN.PATH-READS | A read through `resolveCompiled` gives the value, the error, the place, the list of reads and the host calls of `Runtime.resolve` with the same steps. This is true in a plan, a traced evaluation and a run. `agree` and `agreeRun` compare such a tier with the reference. The member `resolve` of a compiled path records no read, thus code in an evaluation does not use it. |
| PLAN.PATH-ROUTE | `resolveCompiled` needs no new member of `Runtime`. Each runtime other than the runtime of the kernel gets the steps through `resolve`, thus a runtime of a host keeps working and sees each path. The runtime of a fold also gets the steps, and it refuses a read of a free name. |
| PLAN.KIND-MEMO | A step on an envelope and the ladder of `step` look up the kind of a type one time for each world. The memo keeps each answer of the ladder: the own entry, the kind, the default and a kind that the world does not have. A memo with 1000 kinds starts again. |
| PLAN.PATH-STD | The standard evaluator `ref.resolve` is a compiled evaluator (D133). Its path is data of the document, thus `prepare` compiles the path one time, as PLAN.PATH tells for the formula kit. A value that is not a path gives `#VALUE!` at each evaluation, at the place of the document. |
| PLAN.PATH-STD-SAME | The compiled form gives the value, the error, the place and the reads of a function evaluator with the same steps. The host sees the same calls. This is true in a plan and in a traced evaluation. |
| PLAN.PATH-STD-AGREES | Strict `agree` passes for documents of each answer of a reference, in each context, with the standard navigator, a plain navigator, closed roots and `adopt`. Generated documents give the same result and the same reads in the two forms. |
| PLAN.PATH-STD-NAV | The field `machine` of the input of `compile` gives the navigator of the compiled path. A runtime with another navigator resolves the steps again, and its navigator decides. Each other runtime gets the steps of the document through `resolve`. |
| PLAN.PATH-STD-CACHE | A planner compiles a path one time for each document object. An equal document is another object, thus it compiles too. Each planner has one machine, thus a cached path does not have another navigator. |
| PLAN.PATH-STD-WRAP | A function under the name `ref.resolve` stays a function evaluator. The kernel calls it at each evaluation, and it can ask for hops. A host wraps the function in `STD_DEFINITIONS`, because the standard evaluator is not a function. |
| PLAN.FOLD | A part of a plan without a trace folds when it is closed and pure. A closed part reads no name that it does not bind (STATIC.REFS). A pure part has only code that the facts of D24 mark pure and not volatile, and no kind with effects or a run side. An extension of a formula profile is pure only when the profile names it in `pureExt` (D47). A folded part evaluates one time in `prepare`, with an empty context and a probe runtime. The probe resolves only the names that the part binds. A read of another root or of reference data, an effect, a kept context, an exception, `#DEPTH!` or a result that is not plain data cancels the fold. A plan whose evaluation records its reads evaluates a folded part that reads names again. The option `fold: false` stops the folds, and the reference does not fold. |
| PLAN.FOLD-OVERFLOW | A part does not fold when its probe catches a stack overflow, also when its result has no `#DEPTH!`. The fold compares the count of the overflows before and after the probe (D208). |
| PLAN.SHARED | A plan can give one result object to many evaluations. A folded part gives one deeply frozen copy of its result at each evaluation. The fold copies the data, thus the document of the host does not change. A host must not change a result in place. |
| PLAN.FIXED | The option `fixed` of `prepare` gives the host a value for each fixed name (D60). A name fixes only when its value is deeply frozen plain data. A pure part that reads only fixed names and the names that it binds folds, as in PLAN.FOLD. The probe resolves each fixed name to its declared value. At each evaluation, the folded part compares the value of each of its names with one own-key test and `Object.is`. Another value, a missing name, a list of reads and another runtime get the code without the fold. The results stay the results of the reference. A plan without folds ignores the option. |
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
| PLAN.AGREES | A plan, a traced plan, a second evaluation of the plan, the plan with the other choice of folds, the plan with fixed names and the reference interpreter give the same result for each generated document. With the option `observe`, the plan has no folds, and `agree` compares only the result and the effects of the tiers `folds` and `fixed`. |
| REF.DIRECT | The reference interpreter evaluates a document by the rules, and it compiles nothing. A compiled evaluator needs a definition, or the reference gives `#NOEVAL`. |
| REF.FORMULA | `formulaDefinitions` gives a definition for each evaluator of the formula kit: a function evaluator, written from this specification. |
| REF.TREE | The reference has its own definition of the evaluator `tree.node` in `STD_DEFINITIONS`. It uses that definition for the standard evaluator, also without the option `definitions`. |
| REF.RESOLVE | The reference has its own definition of the evaluator `ref.resolve` in `STD_DEFINITIONS`. It uses that definition for the standard evaluator, also without the option `definitions`. A compiled wrapper of the standard evaluator needs its own definition (REF.DIRECT). `conforms` finds no fault in the compiled form and the definition. |
| REF.EFFECTS | The reference records each effect with its kind, its payload and its place. It narrows the capabilities by the contracts of the kinds. |
| REF.RUN | `referenceRun` reads the rules of a run directly. The host does each effect of a runner, and a step waits for the host. `all` settles the waits in the order of the host, or in the order that the journal of the host chooses. An effect of an evaluator gives `#CALC!`, and a signal that aborts gives `#ABORT`. |
| REF.READS | `reference` and `referenceRun` take a list `reads`. The list gets each resolution in the shape of READS.RECORD: the path, what it reached and the mark `free`. A call of a closure and an equation of a tree record their reads in the list of the evaluation that made them. The reference adds no kept reads. |
| AGREE.VALUES | `sameValue` compares lists and plain records by their items and fields, and each other leaf with `Object.is`. Two closures of `fn` with the same parameters are the same. A rule of the caller compares other objects. Identity is not compared. |
| AGREE.ERRORS | Two errors agree when they have the same code, and the same place when both have one. With `strict`, they also have the same reason, and each has a place. An overflow of the stack of the host is the one permitted difference. |
| AGREE.EFFECTS | Two tiers agree only when they cause the same effects in the same order, with the same kinds, places and payloads. The host also sees the same calls. |
| AGREE.TIER | A language gives `agree` its second tier as a function. `agree` names the first tier that disagrees with the plan, and the reason. |
| AGREE.LEAN | The Lean model in `proofs/` gives the result of the plan for each generated document of the formula kit: the value, or the code of the error. The workflow `lean.yml` runs it. |
| AGREE.STEPPER | The tier `stepper` of `agree` gives the result of the plan for each generated document of the formula kit, with the effects. It is not a default tier, and `agree` takes the profile in its option `profile`. |
| AGREE.MOCK | `agree` gives its mock `perform` to each tier, also to the second tier of a language. Thus the tiers agree on documents with effects. When two tiers record the address or the outcome of an effect, these agree too. |
| AGREE.MUTANT | The harness finds a tier that changes the order of the parts, or that evaluates a branch that the reference does not evaluate. |
| RESULT.SAME | `sameResult` tells if two results are the same for an early cutoff. Two values compare by the rules of `docEquals`, thus each object that is not a list or a plain record is the same only as itself. `-0` is not `0`, and `NaN` is `NaN`. A rule of the host answers first for two values (D20). |
| RESULT.SAME-ERROR | For `sameResult`, two errors are the same when they have the same code, reason and place. The cause is not compared. A held error compares by the same rule. A value and an error are not the same. |
| GEN.SEED | `generate` gives the same document for the same seed and options. Its random numbers come from `mulberry32` of `@mark1russell7/rigor-generators` (D191). |
| GEN.CONTRACTS | Without malformed choices, a generated document follows the contracts of its kinds: the shapes, the declared types and the names in scope. `check` finds no problem in it. An own entry goes only on a kind without scope rules, because other code binds none of their names (C7). |
| GEN.MALFORMED | Malformed choices give unknown kinds, unknown names under a namespace with a fallback, values without their shape, bare values without a type, bad paths and names that nothing binds. |
| GEN.REACH | The documents of the property test reach each kind of their world, and they give values and errors. |
| GEN.PATHS | The option `roots` gives the roots of the paths, and the option `steps` gives their most steps. The defaults are each root and two steps. |
| GEN.STEPS | A step document of a path has a kind with the verb `step`. When the world has a default for `step`, a step document can also have each other kind, and the default walks it. A world without that default gives the same documents as before. |

## The run side and capabilities

| ID | Rule |
| --- | --- |
| RUN.SEQ | A run waits for each effect. The next step gets the result as `last`. |
| RUN.EAGER | The part of a run before the first wait happens at once, in the call. |
| RUN.STOP | A run stops at a failed step. The later effects do not happen. |
| RUN.CAP | A run refuses an effect without its capability. The host does not see the effect. |
| RUN.PURE | The kind `pure` refuses an effect, also in a run. |
| RUN.SAME | A run gives the same result as an evaluation with the same `perform`, when the host answers each effect at once and no evaluator causes an effect. Thus a document without effects runs to the result of its evaluation. |
| RUN.IF-TRUTH | `ifRunner` gives an `if` with a truth of the host, and a branch of it can wait for the host. A missing test and a test without a truth give `#VALUE!`. A failed test gives its failure. A missing branch gives `null`. |
| RUN.NESTED-WAIT | A step that waits inside a part that cannot wait gives `#CALC!`. |
| RUN.HELD | In a run, an effect under a runner whose parent cannot wait does not reach the host. The effect keeps `#CALC!`. |
| RUN.NEEDS-RUNNER | In a run, an effect of an evaluator gives `#CALC!` before the test of its capability, also when the host does not wait. |
| RUN.DRIVES | A kind declares in `drives` the parts that its runner evaluates with its code, without a wait, in the form of the lazy rules. The answer of the hook `facts` for the code wins. A check of a run gives such a part no wait, as under an evaluator. Thus its `#CALC!` is the `#CALC!` of the run. `conform` accepts the code of such a part in a runner (C6). |
| RUN.DRIVE-NESTED | A run drives a runner under an evaluator without a wait, as an evaluation does. Only a step that really waits gives `#CALC!`. A branch that does not run does not wait. |
| RUN.WAIT | A part that waits under an evaluator gives `#CALC!`. The error has the place of the part. |
| RUN.CAN-WAIT | With the option `run`, `check` gives `#CALC!` for a runner under a parent without a runner, when an effect of its runners can reach the host. It also gives `#CALC!` for a kind that declares effects and has no runner. The issue has the place and the reason of the run. A document that passes this check gives no such `#CALC!` in a run. |
| RUN.EVAL | An evaluation of a run document records its effects, and it does none. |
| RUN.EFFECT | An effect has its kind, its keys, its place and its context. |
| RUN.CAUSE | An error of the host stays the cause of the error value. |
| RUN.ALL | Parts can run at the same time, with a limit. The results keep the order of the parts. |
| RUN.FAIL-FAST | With `failFast`, the first failed part stops the parts at the same time. The later parts do not start, and the results come before a slow part finishes. |
| RUN.ABORT | A run stops with `#ABORT` when the host aborts it. |
| RUN.MOCK | An evaluation can get a mock `perform`. The answer of the mock is the result of the effect, as in a run with the same `perform`. A promise from the mock gives `#CALC!`, because an evaluation does not wait. |
| RUN.OUTCOME | Each effect records its outcome: the result that it gave its document. A throw of the host gives `#CALC!` with the cause, and a `Failure` gives its own error value. An effect of a run that stopped at its wait has no outcome. |
| RUN.OUTCOME-OVERFLOW | A stack overflow of the host in an effect gives `#DEPTH!` at the place of the effect: in a plan, the reference, the stepper and a run. The kernel counts the overflow (D208). |
| RUN.ADDRESS | Each effect has an address: the keys of its place and the count of the earlier effects at that place in its scope. The root is one scope, and each item of `all` is a scope. Thus the order of the host does not change an address. |
| RUN.RECORD | `recorder` wraps the `perform` of a host. Its log has each effect with its address, its kind, its payload and its outcome. The log also has the order in which the waits of each `all` settle. |
| RUN.REPLAY | `replayer` answers each effect from a log, by its address. A replay does no host effect, and it gives the result of the recorded run. The waits of each `all` settle in the recorded order, thus `failFast` gives the same result too. |
| RUN.REPLAY-MISMATCH | An effect that the log does not have at its address gives `#REPLAY!`: an unknown address, another kind or another payload. The run stops there, as at each failed step. |
| RUN.REPLAY-RUNS | One `replayer` serves more than one run, also two runs at the same time. The kernel tells the journal the count of the waits of each `all` that settled before. Thus a replayer keeps no state of a run, and a mismatch stays in its run. |
| RUN.REPLAY-ORDER | A `recorder` gives each call of its journal to the journal of the inner `perform`. Thus a recording of a replay settles the waits in the recorded order, and it gives the same log. |
| RUN.REPLAY-JSON | `encodeLog` writes a log as JSON, and `decodeLog` reads it again. Each value is a term document of `encodeValue`. A cause that is an exception keeps its name and its message (RUN.REPLAY-CAUSES). A value without a term document throws a `TypeError` with its address. Generated runs replay from the JSON text with the same result and the same log. |
| RUN.REPLAY-CAUSES | The JSON form of an exception keeps its own fields that `encodeValue` writes, and the chain of its causes. A cause that is an earlier exception of the chain is its index in `loop`, thus a cycle stays exact. A field or a cause without a term document is a name in `dropped`, not a refusal. `decodeLog` gives the chain again, and a log of the version 1 without these fields decodes as before. |
| RUN.REPLAY-HIDDEN | The JSON form of an exception keeps the hidden fields of the standard classes in `hidden`: `errors`, `error` and `suppressed`. An exception in them has the rule of a cause, also a `loop`. A value without a form is a name in `dropped`. An item of a list without a form is the mark `dropped` at its place, and `decodeLog` gives a hole there. `decodeLog` gives the standard class and keeps each hidden field not enumerable. |
| RUN.REPLAY-FIELDS | The JSON form of an exception keeps an own enumerable field without a term document in `parts` when it is an exception, a list or a plain record. A list is a list of parts with a mark at each item without a form, and a record is the part `record`, at each depth. A container without a form in it is one name in `dropped`. Each exception in it has the rule of a cause, also a `loop`. The walk takes `parts` in the order of the keys, then `hidden`, then the cause. `decodeLog` gives each field enumerable, and an old log decodes as before. |
| RUN.REPLAY-CAUSE-PARTS | A cause without a term document that is a list or a plain record with an exception at some depth is `causeParts`: a list of parts or the part `record` of RUN.REPLAY-FIELDS. The rule is the same for the cause of an exception and of an error value. Each exception in it has the rule of a cause, also a `loop`. A cause of an error value without an exception keeps its refusal (RUN.REPLAY-CAUSE-ITEMS). `decodeLog` gives the cause again. |
| RUN.REPLAY-CAUSE-ITEMS | A cause of an exception that is a list or a plain record without a term document gets the rule of RUN.REPLAY-FIELDS, also without an exception. It is `causeParts` when an item has a form, and `dropped` names each other item by its path. A container without a form in it stays the name `cause` in `dropped`. |
| RUN.REPLAY-SHARED | A list or a record of parts that an earlier place of the walk of one error holds is the part `share`. Its index counts the lists and the records of parts in the order of the walk. A container that holds itself is a share too. A container without a form stays a name in `dropped`, also at a share. `decodeLog` gives one object for each share, and an old log decodes as before. |
| RUN.REPLAY-SHARED-VALUES | A list or a plain record with a term document that two places of one error share is a container of parts at its first place. Each later place is the part `share`. A container that holds such a value is a container of parts too. A member of a domain stays a term document. `decodeLog` gives one object. |
| RUN.REPLAY-GOLDEN | A golden file in `packages/core/golden` keeps the JSON form of a log. A test compares the log of the run with the file, and it replays the file. |
| RUN.AGREES | `agreeRun` records a run of the plan. The reference run, the traced run, a second run and the plan with the other choice of folds replay its log. Each tier gives the same result and the same effects, and it settles the waits of each `all` in the recorded order. Generated documents agree. |
| RUN.AGREES-READS | `agreeRun` compares the free reads of the plan and of the reference run, in their order, without the kept reads. Another replay of the plan records the reads of the plan. When the plan keeps each root, it does not know its reads, and no read compares. Generated documents agree, and the result gives the reads that compared. |
| RUN.AGREES-ONE-REPLAYER | `agreeRun` makes one replayer of the log of the plan. Each tier and the replay for the reads use it (RUN.REPLAY-RUNS). The results of `agreeRun` do not change. |
| RUN.AGREES-EQUATIONS | Generated trees with generated equations agree in `agree` and in `agreeRun`, with their free reads. The equations read the event, `self`, their names, the capabilities and the world. Each free read of a plan has a static read of `factsOf` (READS.SUBSET). When `verifyReads` keeps a result in a changed context, a new evaluation gives the same result. |
| SEQ.LAST | A sequence gives the result of the step before under the name `last`. |
| SEQ.NAMES | A sequence gives the result of a named step to the later steps. |
| SEQ.LAWS | A sequence with one step gives the result and the effects of the step. The steps at the end of a sequence can go into a nested sequence, also with their names. The steps at the start can go into a nested sequence when only the last of them has a name, and the nested sequence gets that name. Each such change keeps the result and the effects. A name reaches only the later steps of its own sequence and of the sequences in them. A property test examines generated steps. |
| EFFECT.ORDER | The effects keep their order. |
| CAP.PURE | An effect inside `pure` fails, because `pure` gives its part no capability. |
| CAP.PURE-ONE | The kind `pure` takes exactly one part. A list with no part or with more than one part gives `#VALUE!`. |
| CAP.NAMESPACE | A capability permits a kind by its name, or by its namespace. |
| CAP.KEYS | A capability permits the kinds under it, key by key. A key with a dot is one key. |
| CAP.EACH | The capability with no keys, `[]`, permits each kind. Thus the meet `intersectCaps` of a list and `[]` is that list. An empty text is the one key `""`, not the capability with no keys. A clause with the `op` `[]` also answers each effect (HANDLE.DEEP). |
| CAP.NARROW | A part cannot get more capabilities than its parent. A rule `grant` gives clause kinds, not capabilities. Thus a part cannot cause a host effect that its parent cannot cause. |
| CAP.GRANT | A rule `grant` of a kind gives a part the kinds that the value of the document holds at a path, as clause kinds. The capabilities of the part do not change. `check` accepts such an effect in that part, and `effectsOf` leaves it out, because it does not reach the host. |
| HANDLE.DO | A clause `do` of `handle` answers each effect of the body under its `op`. Its result is the result of the effect, a failure of the clause is a failure of the effect, and the host does not get the effect. The clause reads `names.payload`. The first clause of the innermost frame wins. |
| HANDLE.ABORT | A clause `abort` stops the body. Its result is the result of `handle`, and the clause `return` does not run. |
| HANDLE.RETURN | A clause `return` gives the result of `handle` after a body without a failure. It reads `names.result`. |
| HANDLE.FORWARD | An effect of a clause goes to the next frame out, and then to the host. |
| HANDLE.DEEP | A frame stays in the context of the body, thus it answers each effect under the body, and each kind under its `op` (CAP.KEYS). |
| HANDLE.NARROW | A rule around an effect narrows a clause kind as it narrows a capability, also after a grant of the same kind. An effect in `pure` under `handle` gives `#CAP!`. A list of capabilities that code writes for a part also narrows its clause kinds. |
| HANDLE.KINDS | The clause kinds stay with the frame and out of the capabilities. A read of the root `caps` and the rule `permits` of the host do not see them. A context that code makes without a spread has none. A part keeps only the clause kinds that its parent can cause. The kernel finds a clause by its own rule. |
| HANDLE.CLAUSE | A clause gets the context of the `handle` document. It has no capability of its own frame, and it does not get its own frame. |
| HANDLE.ENDED | A context that leaves the body keeps the clause kinds of its frame. An effect from that context after the end of the body gives `#CAP!`, and the host does not get it. |
| HANDLE.SEALED | A clause sees only the payload. The place, the names and the context of the effect stay hidden. |
| HANDLE.VALUE | A clause with both `do` and `abort`, or with neither, gives `#VALUE!`. An `op` that is not a text or a list of keys also gives `#VALUE!`. |
| HANDLE.AGREES | The plan and the reference give one result, and they give the host one list of effects with the same addresses. |
| CAP.NARROW-CODE | A compiled evaluator or a compiled runner cannot give a part more capabilities than its document has. Each context carries the capabilities that the kernel gave its document, and a spread of the context keeps them. A part and an effect of compiled code keep only these capabilities. A context that compiled code makes without a spread has no capabilities. |
| CAP.CAPS-GRANT | Compiled code that resolves the root `caps` through the runtime reads the capabilities that both its context and the grant of that context permit. Thus a context that the code widened gives the capabilities of its document, as in the reference. A context that the code narrowed keeps its own list. A context without a grant gives no capabilities. |
| CAP.MEET | Each context that code gives a part, an effect or a resolution keeps the capabilities that both it and its document permit: the meet `intersectCaps`. This holds for function code and for compiled code. Thus a list that the code widened to a coarser capability gives what the document permits, as in the reference. A walker of a step document gets this context too. A context that the code narrowed keeps its own list. |
| CAP.NARROW-KEPT | A grant has an epoch: the list of capabilities that the host gave the root of its evaluation. An effect and a resolution read a context of another epoch as a context without a grant. Thus compiled code that keeps a context from an earlier evaluation causes no effect with it in a later evaluation. A function evaluator narrows a kept context to its document, as the reference does. A later evaluation with the same list of the host keeps the grant. |
| CAP.EPOCH-EQUAL | A later evaluation with a new list of the host that is equal to the epoch keeps the grant of a kept context, as the reference permits its effects. An equal list has the same length, and at each index the same text or the same keys in the same order. A wider list, a narrower list and the same entries in another order are other epochs. |
| CAP.MONOTONE | Fewer capabilities change an evaluation only at an effect that they refuse and more capabilities permit. Before that effect, the two evaluations ask about the same effects and get the same answers. Without such an effect, they give the same result and the same effects. Thus fewer capabilities do not permit an effect that more capabilities refuse. This holds for a document that does not read the root `caps`, under code that keeps C1. A property test examines generated documents. |
| CAP.HOOK | A machine can give the rule of the host for an effect. |
| CAP.CONTRACT | A kind declares in its contract the capabilities that it gives its parts: `same`, `mask` or `only`. The kernel narrows the context of each part by these rules, thus an evaluator cannot give the part more. |
| CAP.ONLY | A rule `only` gives a part only the effects that the capabilities of its document and the list of the rule both permit. |
| CAP.DECLARED | Each kind of the standard world that causes an effect declares the effect in its contract. Thus `check` finds a `#CAP!` for it. |
| CAP.PERMITS | `check` and `effectsOf` ask the hook `permits` of the machine about each declared effect, with the capabilities of its document, as a run does. In a check, the hook gets a context with only the capabilities and the world. Without the hook, the function `permits` decides. |
| CAP.EFFECTS-OF | `effectsOf` gives the kinds of the effects that can reach the host: the declared effects, without the effects that a rule `mask` or `only` around them removes. Each kind comes one time, in the order of the document. With capabilities at the root, only the effects that the rule of the machine permits stay. |
| CAP.EFFECTS-SOUND | `effectsOf` permits each effect that an evaluation or a run gives the host, with the capabilities of the run and without capabilities. A property test examines generated documents with a recorder. |
| CAP.OWN-EFFECTS | The answer of the hook `facts` for the code of `eval` of a document gives the effects of that code, in the form of the field `effects` of a kind. It wins over the contract of the kind. Thus `effectsOf`, `factsOf`, `check` and `checkLatent` see the effects of an own entry for another evaluator. Without the field in the answer, the contract gives the effects. |
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
| STATIC.MAPDOCS | `mapDocs` changes the documents of a document from the root to the parts. The function reads only the original documents and can stop at a node. A document without a change stays the same object. |
| STATIC.CHECK | `check` finds the problems of a document before a run. Each problem has its place. |
| STATIC.SEQ | `check` knows that a step reads only the steps before it. |
| STATIC.CAP | `check` finds an effect that the capabilities do not permit. |
| STATIC.AGREES | A document that checks evaluates without the errors that `check` finds. When a run gives `#NAME?` for an unknown operation, or `#VALUE!` for a value without its shape, `check` gives the same code, place and reason. For a name that nothing binds, it gives the same code and place, unless a host thing without `has` answers the names (DEREF.HOST-UNDEFINED). A `#DEPTH!` from an overflow of the stack of the host or from the clock of `call` (FORMULA.CALL-DEPTH) is not an error of `check`, and `#WORK!` (WORK.LIMIT) is not one. For the read of an unknown attribute of a node, it gives the same code and place (TREE.CHECK-UNKNOWN). |
| STATIC.NARROW | `check` tests each effect against the capabilities of its own document: the capabilities at the root, narrowed by the rules of the kinds around it. |
| STATIC.LINEAR | A walk takes time and memory linear in the size of the document. A visit knows its parent and the path of its part. A log-log ladder of 250 to 2000 levels measures the time of `refsOf` and `walk` on 5 CI runners (K208, D97). The slope of log t against log n was 0.998 and 1.000, with 90 % intervals inside 0.92 to 1.07. A memory phase after the timed rounds measures the bytes that one call allocates (K209, D105). A collection in the call loses no bytes. Its verdict is an upper bound: the upper end of the 90 % interval of the memory slope is at most 1.2. In the Measure run 41526166950, the memory slope of both walks was 0.991, with 90 % intervals inside 0.98 to 1.00. The check `Measure OK` does not read these verdicts: the gate is report only (K227, D164). The ladder also measures `check` on a deep tree of panels, with and without a reference of the root to its first child (K255, D202). A rung of n levels has n / 4 panels. A third tree of `check` is wide: n / 4 references to one node of n / 4 boxes (K256, D204). The time verdict reads the band 0.948 to 1.052, not the point 1. The band comes from 10 CI runs, because the collector of the heap adds a small slope on a real machine (D205). |
| STATIC.PATH | `check` finds a reference whose value is not a path: a list that starts with a root. |
| STATIC.AT | `check` gives the JSON path of each problem. For a value without its shape, the path goes to the value with the problem. |
| STATIC.STEPS | When the kind `ref` has parts, the static kit visits the step documents of a path. A reference in an address position is an address, not a read. |
| STATIC.KNOWN | `check` asks the hook `known` of the machine about the kind and the evaluator of each document. A name that the evaluator does not know gives `#NAME?` with the reason of a run, for example an unknown operation. |
| STATIC.COVERAGE | `checkWorld(machine, verbs)` checks the world before a document exists. It gives `#NOEVAL` for each kind and verb of the list when the kind has no entry and the world has no default for the verb. Thus a kind with no `view` entry, in a world with no `view` default, is in the list. The check visits each kind of each namespace and each fallback kind, and it does not follow an alias. A document of a kind in the list gives `#NOEVAL` in `check` with that verb. |

## The steps of a language

A step is a level of the power of a language (D116). A language declares its steps and the step of each construct as data. The host sets the highest step that it accepts.

| ID | Rule |
| --- | --- |
| STEPS.LADDER | `stepLadder(steps, constructs)` makes a ladder: the names of the steps from the lowest to the highest, and the step of each construct. An empty list, a name two times and a construct with a step that is not in the list throw a `TypeError`. The ladder is frozen. `isStep` tells if a value is a step, and `stepRank` gives its position. |
| STEPS.LOWEST | `stepOf(ladder, walk, root)` gives the lowest step that a document needs: the highest step of the constructs of its nodes. A node without a construct, or with a construct without an entry, needs the lowest step. The language gives the construct and the child nodes of a node in `walk`. |
| STEPS.REASON | The reason of the step is the first node in document order whose construct needs that step. It gives the construct, the step, the path of keys from the root and the node. A document of the lowest step has no reason. |
| STEPS.MAX | `checkStep(ladder, need, maxStep)` gives `undefined` when the step is `maxStep` or lower. Otherwise it gives a refusal with the needed step, the limit, the reason and a message that names them. A name that is not a step throws a `TypeError`. |
| STEPS.LINEAR | The walk of `stepOf` has its own stack, thus a chain of 100000 nodes does not overflow. It visits a shared node one time, and it stops at the first node of the highest step of the ladder. |

## The static facts

`factsOf` gives the static facts of a document for a schedule (R4 P2, D24). They depend only on the document and the machine.

| ID | Rule |
| --- | --- |
| FACTS.READS | Each free reference from a root is a read. A read has its root, its keys up to the first step document, its place and its JSON path. A read after a step document is not exact. A reference in an address position is an address. |
| FACTS.KIND-READS | A kind can declare in `reads` the roots that its code resolves as a whole. Each document of the kind then has an exact read of each root, with the path of the root alone, at its own place. The hook `facts` can give the roots too. |
| FACTS.STEP-READS | A walker reads the roots that the answer of the hook `facts` for its code gives, or else the roots in `reads` of the kind of the step document. Each one is an exact read of the whole root, at the place of the reference. The contract of the kind does not describe the walker of an own entry. |
| FACTS.EXT-READS | The field `extReads` of a formula profile gives the roots that an extension reads from its context. Each document of the extension then has an exact read of each root. A read of such a root refuses a fold, thus a pure extension with reads runs at each evaluation. |
| FACTS.EQUATIONS | The first document of a tree kind gets the static reads of the equations of its kind (D69). Each such read is lazy, and it has the place of that document. A read from `self` and a read of a name of the rung are not reads (READS.EQUATION). A tree kind in an equation adds the reads of its own equations, one time for each kind. An effect in an equation makes the document not pure. |
| FACTS.LAZY | A lazy rule of a kind names the parts that an evaluation can skip and still give a value. A read under a lazy part is lazy. An eager read evaluates in each evaluation in which each document around it gives a value. Each part of a document with an own entry for another evaluator is lazy. |
| FACTS.SIDE | The side of a document is `run` when one kind in it is on the run side. Else the side is `derive`. |
| FACTS.EFFECTS | The effects are the kinds of effects that the contracts declare, each one time, in the order of the document. The effects `"type"` of a kind give the type of the document. |
| FACTS.PURE | A document is pure when each kind in it declares `pure`, and it has no effect and is not volatile. An unknown kind and an own entry for another evaluator are not pure. A pure document gives the same result when each value that no read reaches changes. |
| FACTS.VOLATILE | A document is volatile when a kind, an operation or a kind of step documents declares `volatile`. A read that the host marks also makes it volatile. A read of `event` and an effect do not. |
| FACTS.HOOK | The hook `facts` of a machine gives the facts of the code of a name. Each field of its answer wins over the contract. `mergeMachines` composes the hooks in order, and a hook does not answer for replaced code. |
| FACTS.VERB | The option `verb` names the verb whose code the facts describe. The default is `eval`. The marks `pure`, `volatile` and `lazy` of a contract describe the code of `eval`, and of `step` for a step document. Only the hook describes the code of another verb. The roots and the keys of the reads do not depend on the verb. |
| FACTS.VERB-EFFECTS | For a verb other than `eval`, the effects of a document are the effects that the entry of the verb in `verbEffects` declares (D111). The field `effects` counts only for `eval`. The entry `"type"` gives the type of the document. |
| FACTS.VERB-SIDE | For a verb other than `eval`, a kind is on the run side when its entry in `verbEffects` declares an effect. The field `side` counts only for `eval`. |
| FACTS.VERB-UNDECLARED | For a verb other than `eval`, a kind without an entry in `verbEffects` declares nothing. It adds no effect and does not put the document on the run side. `check` also tests no effect for it (VERB.EFFECTS). Its code is not pure without an answer of the hook. |
| FACTS.VERB-CHECK | The facts and `check` agree for each verb. `check` without capabilities refuses each effect of the facts and no other effect. With the option `run`, an evaluator needs a runner when the facts give the run side. |
| FACTS.PROFILE | `formulaMachine` gives the hook `facts` of its profile. A lazy operation has a lazy rule for each argument. The profile names its pure and volatile operations. A standard extension is pure. An extension of the profile is pure only when the profile names it in `pureExt` (D47). The mark `pure: true` covers only the operations. |
| FACTS.SOUND | In each evaluation, each path that a plan resolves has a static read at the place of its document. The read has the root of the path, and its keys start the path. An exact read has the full path. |

## The reads of an evaluation

An evaluation can record its reads. `verifyReads` tells if an old result stays valid in a new context (R4 P3, D26). A schedule uses the list as a verifying trace.

| ID | Rule |
| --- | --- |
| READS.RECORD | `evaluate`, `plan.evaluate`, `run` and `plan.run` take a list `reads`. The list gets each resolution: the path, what it reached and the mark `free`. An exception of the host gives the error value of the read. A reference through a name that holds an error reads that name. Without the list, an evaluation records nothing and gives the same result. |
| READS.ORDER | The reads are in the order of the resolutions. The step documents of a path evaluate first, thus their reads come before the read of the path. |
| READS.FREE | A read is free when it reads the context at the root of the evaluation. A name that a kind binds, a `self` that a kind sets and a path without a root are not free. `verifyReads` skips each read that is not free. |
| READS.KEPT | A value that keeps the context without its static reads adds a read of each whole root, one time in an evaluation. An example is a closure of `fn` whose document is not pure. The first read of a `self` that a kind sets adds a read of the root `self`, because the kind can give the old `self` on. An earlier free read of the whole root `self` takes its place. |
| READS.CLOSURE | A closure of `fn` with a pure document adds a kept read of each static read of `fn`, one time in an evaluation. A name that a kind binds around the closure gives no kept read. A read after a step document keeps its whole root. The path of a kept read ends at the first host thing, unless that thing answers the step with `known` (SCHED.CLOSURE). A reference in the data on the path keeps each whole root. Thus a change of a name that no closure reads keeps the old result, also for a closure in `map`. |
| READS.EQUATION | An equation of a tree records its reads in the list of the evaluation that made the node, in the shape and the order of the reference (D68). The rules READS.FREE and READS.KEPT compare with the root of that evaluation. Thus a read from `self` or from a name of the equation is not free. A step out of the tree reads the outer `self`, and the free read of the whole root `self` covers it. `verifyReads` discards a result when a free read of an equation changes. |
| READS.VERIFY | `verifyReads` takes a machine or a plan, the reads and a new context. It resolves each free read again, and it compares the two answers with `sameResult`. The rule `equal` of the host answers first. When each read is the same, the old result stays valid. Code that asks for the hops gets them in its read, and the verification compares each hop. A longer path through a name that holds an error in the new context is changed. |
| READS.CHANGED | When a read is not the same, `verifyReads` gives the first such read, its index and what its path reaches in the new context. It does not resolve the later reads. |
| READS.LAZY | A part that the evaluation skips has no reads, for example the branch of `if` that the test did not select. A change that only such a part reads keeps the old result. |
| READS.DATA | A reference in the data that a resolution follows is a part of one read (DEREF.COLLAPSE), as `factsOf` counts it. A change of its target changes that read. |
| READS.IN-PLACE | `printReads` gives a print of the value of each free read: its lists, records, own enumerable fields, the time of a date and the entries of a map or a set. With the option `prints`, `verifyReads` compares the print of each read that is the same by `sameResult`. A change in place is then a changed read with the mark `inPlace`. Without the prints, the change stays hidden. A replaced value is a changed read without the mark. |
| READS.PRINT-LIMIT | A print visits each object one time, thus a cycle ends. A getter does not start, and the print keeps its function. A stamp of the host takes the place of the fields of an object. A value with more entries than the limit, or an exception of the host in the walk, gives no print, and `verifyReads` gives its read as changed. |
| READS.SOUND | For the generated documents of six machines, the test changes the context at random. When each free read of a pure document is the same, a new evaluation gives the same result by `sameResult`. A list without the reads of whole roots gives stale results of trees, and the test finds them. |
| READS.SUBSET | Each free read of an evaluation has a static read of `factsOf` with the same root, and the keys of the static read start its path. A kept read, the read of a name that holds an error and a name that a kind binds to the value of the context are the exceptions. A free read of an equation of a tree has a static read too (FACTS.EQUATIONS). |

## Two levels of durability

A host keeps one epoch for the structure and one for the data (R4 P7, D30). The structure is the machine and the documents. The data is each value that a context gives. `durable` keeps the plans and the facts across the changes of data.

| ID | Rule |
| --- | --- |
| DURABLE.EPOCHS | `durable` keeps two epochs. `changeData` adds one to the data epoch. `changeStructure` adds one to each epoch, because a change of the structure is also a change of the data. The epochs are a snapshot that does not change. |
| DURABLE.DATA | A change of data compiles nothing and computes no facts. After it, a pure document verifies its reads with `verifyReads`, and it keeps its result when each read is the same. Each other document evaluates again. The rule `equal` of the host goes to `verifyReads`. |
| DURABLE.STRUCTURE | A document object compiles one time for a machine, and it computes its facts one time. An edit gives a new document object, thus only that document compiles. A new machine drops each plan, each fact and each result. A value document has its own plan, also `-0` beside `0`. |
| DURABLE.REUSE | A key names one node of the host. In one data epoch, a key with the same plan gives its result again without an evaluation, also with a new context object. One document at two keys gives each key its own result. `forget` drops the result of a key. |
| DURABLE.IN-PLACE | With the option `inPlace`, `durable` keeps the prints of the reads of each pure document, and a verification compares them (READS.IN-PLACE). A value that changed in place then evaluates the document again. Without the option, the cache makes no prints, and the old result stays. |
| DURABLE.OVERFLOW | `durable` keeps no result of an evaluation with a stack overflow, also when the document catches the error. A verification with a stack overflow keeps no result too. The cache compares the count of the overflows before and after (D208). |
| DURABLE.SOUND | For the generated documents of three configurations, the test makes random edits, new machines, changes of data and new context objects. Each result of `durable` is the same as a new evaluation by `sameResult`. A host that does not tell a change of data gets stale results, and the test finds them. |

## Schedules

A host gives named documents to `schedule`. Each document is a node, and the root `world` of each node reaches the other nodes. The schedule gives the graph of the nodes and the side of each node, and it evaluates the nodes on demand (R4, D31). The functions of `graph.ts` analyze such a graph before a run (S2, D33).

| ID | Rule |
| --- | --- |
| SCHED.GRAPH | `schedule` keeps named documents as nodes. The root `world` of each node reaches the other nodes, and the context of the host gives the other roots. `graph()` gives each node with its facts, its side and its edges. The map stays one object in one structure epoch. |
| SCHED.EDGES | `edgesOf` changes each static read of `world` into an edge to the node of its first key, with the lazy mark of the read. A read without a key after `world` has no target node. A read of another root is not an edge. A read of `world` in an equation of a tree kind is a lazy edge (FACTS.EQUATIONS). |
| SCHED.GRAIN | An edge goes to a node, and it keeps the keys after the node as its field. A change of another field of the node evaluates the node again, and a reader of the field keeps its result. |
| SCHED.SIDE | The side of a node comes from `factsOf`. A node on the run side is a sink: a read of it gives `#REF!`, and the schedule does not evaluate it. The record of the root `world` has only the derive nodes. |
| SCHED.RUN | The schedule does not start a run. `run` starts a run of the document of a node with the context of the schedule and the event of the host. A demand and a change of data do not repeat a run. |
| SCHED.DEMAND | `read` evaluates a node and each node that its evaluation reads, through `durable`. Each node evaluates at most one time in a data epoch. A node that no read and no eager edge of a demand reaches does not evaluate. A missing node gives `#N/A`. |
| SCHED.STALE | After a change, a pure node verifies its reads, and a read of a node demands that node again. A node evaluates again only when a read changed, or when it is not pure. A new machine evaluates each node again. |
| SCHED.CLOSURE | A kept read of a closure reads a node through `known` of the root `world`, without a demand. Only a node with its result in the data epoch gives a value. Thus a change of another node keeps the old closure, and a change of the read node discards it. A node without its result ends the path at `world`, and the closure evaluates again. A closure that reads its own node gives no `#CYCLE!`. |
| SCHED.OWN-NODE | A kept read that a reference leads to the node in evaluation closes no cycle. Thus a closure at a node whose `self` or `event` refers to that node gives its value in each tier. A read of the evaluation still gives `#CYCLE!`, with the same reason. A kept read that reaches its node through another node that reads it gives `#CYCLE!` in each order (D136, Limits). |
| SCHED.OWN-NODE-READS | SCHED.OWN-NODE changes no list of reads. A kept read of a whole root still demands the node that a reference reaches, and it reaches the value of that node. The kept read of the node itself reaches the error of the node, at the record and at each verification. Each other read of the node verifies as before, thus no change gives a stale value. |
| SCHED.OWN-NODE-AGREES | `agreeSchedule` finds no false cycle and no stale answer for one node, with contexts of the host whose `self` and `event` refer to that node. Generated documents hold closures, calls and direct reads of those roots. |
| SCHED.KEPT-BELOW | A kept read that meets a node in evaluation below it closes no cycle. The nodes of that kept read evaluate again at their next real demand. A read of an evaluation still closes a cycle. |
| SCHED.KEPT-OPEN | A kept read that reaches a finished node of an open component joins no component. Its nodes evaluate again at their next real demand, thus each order of demands gives one set of values. |
| SCHED.KEPT-BELOW-AGREES | `agreeSchedule` finds no false cycle and no stale answer for three nodes, with a host context that refers to each of them. |
| SCHED.EQUATION | A node with a tree keeps the reads of its equations (READS.EQUATION). Thus a change of another node or of the event that an equation reads evaluates the node again. A change of a node that no equation reads keeps the old result. `agreeSchedule` finds no stale answer for nodes whose equations read other nodes, also for generated equations. |
| SCHED.CYCLE | Each node of a strongly connected component of the reads, and each node that reads itself, gives `#CYCLE!`. The reason names only the node, and the error has no place. Each order of demands gives the same values. A reader gets the error at its reference. A static cycle through a read that the evaluation skips is not a cycle. |
| SCHED.ONE-MEANING | For generated graphs of nodes, the test uses `agreeSchedule`. It makes random edits, new nodes, removed nodes, new machines and changes of data, and it reads the nodes in random orders. Each result is the same as an evaluation of the whole graph from scratch by `sameResult`, also for each cycle. A host that changes its data in place gets stale values, and the test finds them. The test reaches the demands ahead of SCHED.LONG-CHAIN. Each node that gives `#CYCLE!` is on a static cycle of `cycles`, unless a literal holds a reference to a node (S1d). |
| SCHED.AGREES | `agreeSchedule` examines the engine of a host against an evaluation of the whole graph from scratch. An engine sets a node, removes a node, changes the data and gives the answer of a demand. A new machine is optional. The same seed gives the same commands, and the outcome is the first read with a different answer, with its step, its node and the two answers. The demand schedule with verifying traces and the demand schedule with a memo only agree. An engine that keeps a stale answer or misses an edit disagrees. |
| SCHED.LONG-CHAIN | A demand with no node in evaluation, from the host or a run, first demands each node that the eager edges reach, deepest first. A chain of 2000 nodes gives its value with no `#DEPTH!`, also after a change of data. The same chain through lazy edges overflows the stack of the host, and the walk after the overflow gives its value too (S2b). A node behind a lazy edge is not a demand ahead. The values stay the values of D31. |
| SCHED.CYCLE-ISSUES | `checkCycles` takes a schedule, or another object with a function `graph`, and it gives one issue for each certain cycle of `cycles`. The issue has the code `#CYCLE!`, the place `[id]` and the reason of the first node of the cycle, and the list `nodes`. It evaluates no node. A graph with no certain cycle, and an empty schedule, give no issue. A node that reads itself gives an issue with one node. A reader of a cycle has no issue. Each node of a ring gives `#CYCLE!` with its own name in a read. |
| SCHED.CYCLE-CERTAIN | A possible cycle of `cycles` gives no issue, because a run can skip its lazy read. A certain cycle inside a possible cycle gives an issue with only its own nodes. A run that takes a lazy read gives `#CYCLE!` with no issue, thus the issues are not complete. A read can fail before it reaches a certain cycle. The issue stays, and the node gives the earlier error. |
| SCHED.CYCLE-ORDER | The order of the `set` calls does not change the issues. The list `nodes` of each issue is sorted by name, as the record of the root `world` sorts the nodes. The issues are sorted by their first nodes. |
| SCHED.CYCLE-AGREES | For generated graphs, each node of an issue gives no value. When only a read of a cycle can fail, such a node gives the code `#CYCLE!`. With only eager reads, each node that gives `#CYCLE!` with its own name has an issue, and each failed read names a node of an issue. An issue that reaches no other issue gets only reasons that name its own nodes. The documents of the harness of `agreeSchedule` also give no value at a node of an issue. |
| SCHED.NODE-CONTEXT | The option `selfOf` of `schedule` gives a node its own `self`, for each evaluation and each run of the node. The value `undefined` keeps the `self` of the host, and the other roots stay the roots of the host. Without the option, each node gets the context of the host. A closure keeps the `self` of its node. A reference in the value of a node resolves in the context of its reader. |
| SCHED.NODE-PLAN | Nodes with one document object share one plan, one facts object and one list of edges. `compiles` and `facts` count such a document one time, and each node keeps its own result and its own reads. Equal documents in new objects compile one time each (PLAN.CACHE). |
| SCHED.NODE-STALE | A new `self` of a node is a change of data, and the host tells it with `changeData`. A later demand gives `selfOf` the current context of the host. Each node verifies its reads with its new `self`. Only a node with a changed read evaluates again, and a new `self` compiles nothing. |
| SCHED.NODE-CYCLE | A reference in a `self` can lead a read to another node. The demand gives `#CYCLE!` for each node of such a cycle, in each order of demands. The facts and the edges belong to the document, thus `graph()` and `cycles` do not show such a read, and no demand goes ahead of it. A host that demands a long column in the order of its rows gets each value. |
| SCHED.NODE-AGREES | `agreeSchedule` with the option `selves` gives each node its own `self`, shares documents among the nodes and changes the `self` of one node. Each answer is the same as an evaluation of the whole graph from scratch. The harness finds an engine that ignores `selfOf`, and an engine that keeps the first `self` of a node. |
| SCHED.DEEP-CYCLE | Each node of a ring with more nodes than the stack of the host holds gives the `#CYCLE!` of a short ring: the reason names only the node, and the error has no place. This is true in each order of demands, through eager and lazy reads, and when each node catches the error. A reader gets the error at its reference, also behind a chain that overflows. |
| SCHED.DEEP-CYCLE-SELF | A walk evaluates each node with its own `self` (D135). Thus a long ring through references in the `self` of each node gives the `#CYCLE!` of a short ring, in each order of demands. |
| SCHED.DEEP-CYCLE-OWN | The evaluations of a walk do no kept read. Thus after an overflow, a closure that keeps a read of its own node gives its value (SCHED.OWN-NODE), and a ring keeps its error. |
| SCHED.DEEP-CYCLE-CHANGE | A change of data finds a long ring again. An edit that opens the ring gives values, and an edit that closes it gives `#CYCLE!`. A plan that a compilation near the limit of the stack made stays out of the cache of `durable`. |
| SCHED.DEEP-CYCLE-ENTRY | A long ring gives `#CYCLE!` through `read`, `run`, the host thing at the root `world`, the record of the root and an edge without a target. A plan, a traced plan, a run and the reference give it when they read the root `world` of a schedule. A node on the run side still gives `#REF!`, and a walk does not evaluate it. |
| SCHED.DEEP-CYCLE-REAL | Only reads that happen make a cycle. A ring with a node that fails before its read gives no `#CYCLE!`, and neither does a ring with a read that a test skips. A read after a long chain with a value does make a cycle, also when an earlier demand found no cycle. A value of a walk does not reach a host. |
| SCHED.DEEP-CYCLE-CHAIN | A deep chain with no cycle gives its value: through eager edges with no walk, and through lazy edges after a walk. After the walk, the schedule demands each node of the walk again, in the order in which the walk finished it. A node that catches the overflow gives the value of a plain evaluation. An overflow does not give such a chain a false `#CYCLE!`. |
| SCHED.DEEP-CYCLE-BOUND | The walks of one data epoch do at most two evaluations for each node that they enter, also for a node with many reads and for a chain that overflows at many demands. The demands after a walk add at most one evaluation for each such node. A walk whose own evaluation overflows keeps no result, thus this bound is for the other walks (D208). |
| SCHED.DEEP-CYCLE-AGREES | For generated graphs with an overflow at each demand, each node gives the result of the plain demand: the same `#CYCLE!` on a cycle, and the same value or error elsewhere (S2b). |
| SCHED.DEEP-CYCLE-OVERFLOW | The demands after a walk keep no result when one of them overflows the stack, also for a node that catches the error. A walk with an overflow of its own keeps no result, also for a node on a cycle of that walk (D208). |
| SCHED.SIGNALS | A reference adapter in the tests gives the meaning of D31 on push-pull signals, and `agreeSchedule` finds no stale answer. A change evaluates only its readers, and an equal result stops at the cutoff. A plan keeps no value, thus the library sees each read. A fold reads nothing outside, and a host thing does not fix a name. With `adopt` each key is a signal read, and a thing with `resolve` answers a path with one read. |
| GRAPH.SCC | `components` gives the strongly connected components of a graph of nodes, by the algorithm of Tarjan. Each component comes after each component that it reads. The walk has its own stack, thus a chain or a ring of 100000 nodes does not overflow. |
| GRAPH.SCC-SAME | The analyses give the answers of the old copy of the search of Tarjan in the core on 600 seeded graphs. The search of the strongly connected components is `strongComponentsCompact` of `@mark1russell7/collections` (K249). |
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
| TYPE.FITS-FINITE | When the rules of the shapes refuse a type with at most 64 members, `fits` tests each member against `expected` (D79). A domain declares its full list of members in `values`. `STD_DOMAINS` gives `[null]`, `[undefined]` and `[true, false]`. A value of the list that fails a test of the type does not count. A union, a `one`, a closed record of such types and a list of `never` also have few members. A record with a needed field without members has no members. The split rule comes last (D84). An open record, or a closed record with more than 64 members, splits a field with few members over a union. Each record of the split must fit, and a split builds at most 64 records, with each split inside its work (D89). |
| TYPE.FITS-PATH | A split also narrows a field of a record in a field by its path (D89). A path goes into a field that is a record without a finite list, and into a member of a union by a type split (D90). The fields of the record split first, then the paths of each next depth, in the order of the keys. An optional field at a depth also gives the absent case. One budget of 64 records serves the outer split and each split inside its work, at each depth. The search follows at most 4096 paths into records. A type with more paths ends the search after the level that reaches the limit (D200). |
| TYPE.FITS-SPLIT-TYPE | A split also has type splits (D90). A field of a base type with a valid cover in its line splits into the domains of a cover (TYPE.FITS-SPLIT-COVERS). A field of a union without a finite list splits into its members. The type splits come after each value split. A case that does not fit splits again at its path: by its members, a cover of its own domain, its union or the paths into its fields. The cases take from the budget of 64 records. |
| TYPE.FITS-SPLIT-COVERS | A field with more than one valid cover tries each cover until one fits (D102). The order is the order of the line, then the order of the covers of each domain. A case that splits again tries each cover of its own domain. A failed try keeps the records that it took from the budget of 64 records. Thus `{a: number}` fits `{a: lo}` and `{a: hi}` when `lo` and `hi` are the second cover of `number`. |
| TYPE.FITS-COVER | A domain declares its covers in `covers` (D85). A cover is a list of domains under the domain, and its domains together hold each member of the domain. After the finite rule, a base type fits a union or a `one` when a domain of its line has a cover, and each domain of the cover fits. A domain of a cover gets the rules of the shapes, the finite rule and its own covers. A cover that is empty, or that names the domain or a name that is not under it, does not count. The rule tests at most 64 domains of covers. `fits` trusts each cover. |
| TYPE.FITS-SOUND | For a seeded corpus of types without `unknown`, a sampled member of `found` is a member of `expected` for each pair that fits. A second corpus holds open records with finite fields against unions of records (D84). A third corpus holds a language with true covers (D85). A fourth corpus holds nested records with finite inner fields against unions of nested records (D89). A fifth corpus holds records with covered fields and union fields against unions of their type splits (D90). Each corpus has 0 counterexamples. A false cover gives a counterexample in the third and the fifth corpus. |
| TYPE.UNKNOWN | `unknown` is the gradual top: it fits each type, and each type fits it. A term that is not a value type, a base type without a domain, and a term deeper than 256 terms read as `unknown`. `fits`, `member` and `typeIssues` do not throw. |
| TYPE.ISSUES | `typeIssues` lists the problems of a type: each term that is not a value type, each base type without a domain and a term that is too deep. Each problem has its keys in the term. A term at two places of a type gives its problems one time for each depth, at its first place (D200). |
| TYPE.DOMAIN | A domain gives a base type its membership test `is` and its parents `under`. A base type fits itself and each parent, through each level. A cycle of parents ends. |
| TYPE.OPEN | A language adds its domains in the table `domains` of its machine, without a change to the kernel. A domain of the kernel that the table does not name comes from `STD_DOMAINS`. A table entry with the name `unknown` or `never` has no effect. |
| TYPE.MERGE | `mergeMachines` merges the domains name by name. Two domains with the same test, parents, summary, steps, `codec`, `values` and `covers` give one domain. Two codecs with the same functions `encode` and `decode` are the same. Two different domains with one name are a conflict, unless the later part names `["domains", name]` in `replaces`. `formulaMachine` and `STD_MACHINE` give `STD_DOMAINS`. `restrictMachine` removes a domain. |
| TYPE.JOIN | `join` gives a type that holds each member of two types. `unknown` absorbs each type, and `never` is the unit. Two lists join their items, and two records join their fields. Each other pair gives a union, without the members that fit other members. |
| TYPE.TEXT | `typeText` gives a short text of a type for the reason of an issue, for example `list<number>`, `{a: number, b?: text}` and `(number) => text`. It does not throw. The text has at most 4096 characters, and a shorter text does not change. A longer text ends with `…` (D200). |
| TYPE.SHARED | A host can build a type that shares a term between places, and a check of a `let` chain makes such types. `fits`, `join`, `member`, `typeIssues`, `typeText`, a check of types and `typeFromSchema` read a shared term one time for each depth. Thus their work grows with the count of terms, not with the count of ways to a term. The memos do not change an answer of `fits`, `join`, `member` or `typeFromSchema` (D200). |
| TYPE.RULE | The type rule of a document is the rule of the evaluator that the ladder gives for the verb of the check. An evaluator object holds it in its field `type`. A runner and an evaluator without a rule give `unknown`. A rule that throws gives a type issue. A function evaluator holds its rule in the same field. |
| TYPE.SIGNATURE | A formula profile gives each operation a signature or a list of overloads (`sigs`). One signature gives the types of the arguments before their check. The first overload that fits gives the result. A parameter at the end is optional when `undefined` is a member of its type, for example `unknown`. A wrong count of arguments, or no overload that fits, is a type issue at the operation. A bad type of a signature is a type issue one time in a check. |
| TYPE.SYNTH | `typeCheck` synthesizes the type of each document from the types of its parts. `lit` gives `one`, and `record` gives a closed record. `ext.undefined` gives `undefined`, and `ext.number` gives `number`. `list` gives a list of the join of its items. `let` gives the type of its body, and its names get the types of their bindings. `fn` gives a function type, and `call` gives the result of its function. `if` gives the join of its branches. The profile changes the types of a truth, of the logic, of `otherwise` and of `omit`. An `otherwise` of `undefined` gives `undefined`. `Kind.result` gives the type of each document of its kind. |
| TYPE.CHECK | With `types: true`, `check` gives each part the type that its position needs, and it checks the type that the part synthesizes. The rule of the parent, the `expect` of a shape, or the option `expect` for the root gives that type. A part that does not fit gives `#TYPE!` with `expected` and `found`, and it gets the type `unknown`. A type issue does not change an evaluation. The value types of a contract describe `eval` only. |
| TYPE.GRADUAL | An operation without a signature takes and gives `unknown`. A kind without `result` and an evaluator without a rule give `unknown`. A less precise signature does not add a type issue. Without the option `types`, `check` gives the same issues as before. |
| TYPE.SOUND | A document checks with no issue, and each operation keeps its signatures. Then each value of its evaluation is a member of the type that `typeCheck` gives its place. A property test examines generated documents. |
| TYPE.TRUTH | A profile with its own `truthy` declares the value type of a truth in `truthType`. Then a test of `if` and each term of `and` and `or` must fit it, or the check gives `#TYPE!`. Without `truthType`, an own `truthy` accepts each type there. The default truth needs `bool` and ignores `truthType`. A bad `truthType` is a type issue one time in a check. `and` and `or` give `bool`, or the join of their terms with the logic `value`. |
| TYPE.TRUTH-SOUND | A language keeps its `truthType`: its `truthy` gives a truth for each member. A document checks with no issue under it. Then no test or term of its evaluation gives the error of a value without a truth. A property test examines generated documents. |
| TYPE.EXT | A formula profile gives the value type of each own extension in `extTypes`. `typeCheck` synthesizes that type for each document of the extension, and a use that does not fit gives `#TYPE!`. An own extension without an entry gives `unknown`. An entry for a standard extension has no effect. A bad type in `extTypes` is a type issue one time in a check, and the extension then gives `unknown`. |
| TYPE.ROOTS | The option `rootTypes` of `check` and `typeCheck` gives the types of `self`, `world`, `event` and the names of the host. The root `caps` has the type `CAPS_TYPE`. A kind that binds a name hides the name of the host. The parts of an evaluator without a type rule get `unknown` for `self`, `world` and `event`. A rule can give its parts other types of these roots. The check examines each type of the host one time. |
| TYPE.PATH | A reference gets the type that its path reaches. Each step asks the type that the path reached. A record gives its field, and a list gives its items, or `number` for `length`. A union joins the steps of its types, and `one` gives the values that the step reaches. A type whose member can be an envelope gives `unknown`, because a path asks the ladder and follows a reference document. The path `["names"]`, a name that is a key of a header, and an address give `unknown`. A step document gets its type from its walker (TYPE.WALKER). |
| TYPE.WALKER | A walker can hold a type rule in its field `type`. The rule gets the data of the step document and the type before the step. It gives the type of each thing that the walker reaches, and the path goes on from that type. A walker without a rule, and a step document with parts, give `unknown`. The check examines the type that a rule gives. |
| TYPE.CLOSED | A field that a closed record does not have is a type issue at the reference, and the reference gets `unknown`. A union and `one` give the issue only when no type or value of them has the field. An open record and `unknown` give `unknown` with no issue. |
| TYPE.NO-STEP | A step into a base type of the kernel without a step of its domain is a type issue at the reference: `null`, `undefined`, `bool`, `number` and `text`. A step into a function type, and a step into a list with a key that is not an index or `length`, are type issues too. The run gives `#N/A` there. A base type outside the kernel can hold host things, thus such a step gives `unknown`. |
| TYPE.SCHEMA | `typeFromSchema` makes a type from a JSON Schema. It reads `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, `anyOf`, `oneOf`, `allOf` and `$ref`. Each other keyword tests nothing, and an issue names it. A schema with `nullable` or `$dynamicRef` reads as `unknown`. The type holds each value that the schema accepts, and the function does not throw. |
| TYPE.SCHEMA-REF | A `$ref` to `#/$defs/<name>` or `#/definitions/<name>` reads that definition of the same schema. Each keyword beside `$ref` tests nothing. Each definition reads one time. Another reference, a missing definition, a reference inside a schema with its own `$id` and a reference in a cycle read as `unknown`. |
| TYPE.SCHEMA-ALLOF | The parts of `allOf` and the other keywords of a schema give the meet of their types. Two records merge their fields, and a common field gets the meet of its types. A closed part keeps the merge closed. A part without `type` narrows only the records or the lists. Two types without a common value give `never`. |
| TYPE.SAMPLES | `typeFromSamples` infers a type from sample values. Base values give base types, also `undefined`, and the items of the lists join. All records join into one record, and a key that a record does not have is optional. A record is open, unless the option `closed` is `true`. Each sample is a member of the type. |
| TYPE.STEPS | A domain gives the types of the steps into its members (`Domain.steps`). A path reads the steps of the domain first, then the steps of each parent. A key without a type gives `unknown`. Two domains with different steps are a conflict of the merge. |
| TYPE.PARENTS | `extendDomain` makes a part of a merge that adds parents, steps or covers to a domain of an earlier part. It keeps the test, the summary, the codec, the `values` and the `covers` of the domain, thus a member keeps its document. It names `["domains", name]` in `replaces`. A new parent adds its test, thus `fits` stays sound. A change of a domain without `replaces` is a conflict. |
| TYPE.ROOTS-SOUND | The roots of a context hold plain data that are members of the root types. A document checks with no issue. Then each value of its evaluation is a member of the type of its place. A property test examines generated root types, contexts and documents. |
| STATIC.TYPES-AGREE | `agreeTypes` examines a document that checks with no issue, in a run where each position of an imprecise type gets a value that it needs. Each value of its trace is a member of the type of its place. A value of a precise type is a member of the type that its position needs. A kind with parts of precise types and declared needs gives no type error of the kernel: `#NAME?` of an operation, and `#VALUE!` of a test or a term. |
| PLAN.GUARD | A plan with `guards` tests the value of each boundary. A value that is not a member of the type of its boundary gives `#VALUE!` at that place, and a failed part keeps its own error. The rule of STATIC.TYPES-AGREE then holds for a context that does not obey its root types. |
| PLAN.GUARD-NONE | A plan without `guards` has no test, and it gives the same results and the same speed as before. |
| PLAN.GUARD-BOUNDARY | `boundariesOf` names each part of an imprecise type at a position that needs a type, with the needed type. It also names each read of a known type, with that type. |
| STATIC.OCCURRENCE | A signature with `proves` tells that an operation gives a true result for each member of the type, and for no other value. A test of `if` that applies such an operation to a path narrows the path in `then`, and gives the reverse in `else`. The types of the names and the roots of the branch change, thus a binding of the same name hides the narrowing. |
| STATIC.OCCURRENCE-PRESENT | A signature with `present` tells that a true result proves a value at the first argument. Such a test makes an optional field needed in `then`, and removes it in `else`. A proof with a type does the same when the type leaves no other case. |
| STATIC.OCCURRENCE-LOGIC | `and` narrows its later terms with the proofs of a true term, and `or` with the proofs of a false term. A test with `and` gives its branch `then` each proof of its terms, and `or` gives its branch `else` each reverse. |
| STATIC.OCCURRENCE-PATH | Only a path of keys narrows, and only through the fields of records. A computed step, a step into a list or a union, a computed test and an operation with overloads prove nothing. |
| STATIC.OCCURRENCE-EFFECT | A document with a declared effect narrows only its names, because an effect can change a root between two reads. |
| TYPE.WORLD | `checkWorld(machine, verbs, { types: true })` examines each value type of a machine before a document exists (D110). It reads the `result` and each `expect` of each kind, the parents and the steps of each domain, and the declarations of each type rule. Each bad term gives one `#TYPE!` with its owner and its keys in `at`. A malformed signature, an overload with the parameters of an earlier overload, and a kind of `kinds` whose `result` does not fit `expect` are issues too. |
| TYPE.WORLD-CLEAN | The standard machines and the profiles of the tests give no type issue in `checkWorld`. A path of `kinds` to a fallback kind (WORLD.OPEN) or through an alias gives no issue. Without the option `types`, `checkWorld` gives only the issues of the verbs. |

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
| FORMULA.CALL-DEPTH | Each application of a closure of `fn` counts one level on the evaluation that made the closure. An application by `call` and by an operation of the host both count. The count goes down after each application. More than a quarter of `maxDepth` levels (250 by default) give `#DEPTH!` at the document that applies the closure. The plan, the traced plan and the reference give the same code, place and reason (D125). |
| FORMULA.SPEED | A plan evaluates a small formula many times quickly. The bench measures the time (K200). |
| FORMULA.EXTEND | `formulaMachine` merges the kit and the language with `mergeMachines`. A kind `ops.*` or a namespace `ops` of the language extends the namespace of the kit, and the fallback of the kit stays. A different kind or evaluator with the name of a kit entry is a conflict, unless the language replaces it. |

## The limit of work

| ID | Rule |
| --- | --- |
| WORK.LIMIT | One evaluation has one count of work, and the field `maxWork` of the machine is its limit. Each application of a closure of `fn` counts one point, after the clock of FORMULA.CALL-DEPTH. The point past the limit gives `#WORK!`, with one code, place and reason in each tier. When more than one part of an operator fails, `#WORK!` stays the code of the result, and the code is not `#ARGS`. |
| WORK.DEFAULT | The default limit is `WORK_LIMIT`, 200000 points. It stops a recursion of 20 levels with two branches, and a recursion of 16 levels stays legal (D134). |
| WORK.OPTION | The field `maxWork` sets the limit, and `Infinity` removes it. `mergeMachines` keeps it as one value (MACHINE.MERGE). |
| WORK.HOST | An application of a closure by an operation of the host counts one point, as an application by `call` does. |
| WORK.RUN | A run has the count and the error of an evaluation. `plan.run`, `run` and `referenceRun` give the same result. |
| WORK.AFTER | A closure can leave its evaluation. After the end of the evaluation, each entry from the host starts a new count. Thus an application by the host stops only for its own work. |
| WORK.AFTER-EQUATION | A call from the host keeps one count across each runtime of the evaluation. A node that an equation makes in the body of a kept closure adds to the count of the call, and it does not start a new count. The reference evaluates such a node with the machine of the evaluation that made the closure. |
| WORK.KEEPS | A plan marks the end of its evaluation only if it holds a runner, an evaluator that is a function, or a compiled evaluator with the field `keeps`. Each other plan has the code of a plan without the count. |
| WORK.PREPARE | `prepare` does no counted work. A fold stops at the first counted point, and a node is a counted point in a fold. Thus a recursion or a tree costs no time in `prepare`. |
| WORK.HIGHER | A kind with `higher` attributes that generate two subtrees at each level gives `#WORK!`, because each generated node counts (WORK.NODE). |
| WORK.NODE | A node that an equation makes counts 8 points, the constant `NODE_WORK`. A generated document and an equation that gives a node both make such nodes. A node of the text of the root document counts nothing. |
| WORK.EQUATION | An equation of a tree has its own runtime, and its work goes in the count of the evaluation around it. |
| WORK.SHARED | The JSON of a tree counts one point for each second visit of a node, a list or a record. Thus a chain of shared values gives `#WORK!`, and the walk does not double at each level without a limit. |
| WORK.AGREES | `agree` in strict mode finds no difference between the tiers on generated documents, at each limit around the true work of the document. |

## The codec of values

A document holds a value that JSON cannot write as a standard extension (D40). Thus the same value has the same document in each language (D12).

| ID | Requirement |
|---|---|
| EXT.DOMAIN | `ext.domain` holds a record with only the text `domain` and the JSON `data`. The codec of that domain of the machine reads the data. A domain without a codec gives `#NAME?`. Data that the codec cannot read gives `#VALUE!`, and so does a value that is not a member of the domain. The plan and the reference agree. |
| EXT.ENCODE | `encodeValue` writes a host value as a term document. JSON stays as it is, and a literal with the shape of an envelope goes into `lit`. `NaN`, an infinity, `-0` and `undefined` use `ext.number` and `ext.undefined`. A member of a domain with a codec uses `ext.domain`. A cycle and a value without a codec throw. |
| EXT.ROUNDTRIP | `decodeValue(machine, encodeValue(machine, v))` gives `v` again by `sameValue`. A property test examines generated values. |
| EXT.SPECIFIC | When two domains with codecs hold a value and one is under the other, `encodeValue` uses the codec of the lower domain. The names do not change this. A chain through a domain without a codec counts. A cycle of parents ends, and a parent that is not a domain ends its chain. The round trip holds. |
| EXT.TIE | The depth of a domain with a codec is the count of the other domains with a codec in its line. `encodeValue` tries the deeper domain first, then the first name. |
| EXT.TYPE | The check of types gives `ext.domain` the type of its domain when the domain has a codec. |
| CODEC.STD | Each codec of the tests of the kernel keeps each law of `codecLaws`, and so do `encodeValue` and `decodeValue` as one codec over the values with a document. |
| CODEC.LAWS | `codecLaws(machine, name, options)` gives the first finding of each law that the codec of the domain breaks, in the order of the laws. A finding has `obligation`, `reason` and `probe`. A name without a domain or without a codec throws. An empty list means that each member keeps each law. |
| CODEC.JSON | The data of `encode` breaks the law `json` when `JSON.parse(JSON.stringify(data))` does not give equal data. `NaN`, `-0`, an infinity, `undefined`, a function, a symbol, a large integer of the host, a cycle, a host object and a hole of a list are found, also inside a container. |
| CODEC.STABLE | A second `encode` of a member that gives other data breaks the law `stable`, and so does an `encode` of the decoded member. The check compares data by DOC.EQUALS, thus the order of the fields does not matter. |
| CODEC.DECODE | The JSON copy of the data goes through `decodeDomain`. A throw of `decode` and a result outside the domain or a parent break the law `decode`, and so does a `decode` that reads a data object by its identity. |
| CODEC.ROUNDTRIP | A decoded member that does not equal the member by `sameValue` and the option `equal` breaks the law `roundtrip`. A lost `-0`, a lost precision and two members with one document are found. A date without the option `equal` is found too. |
| CODEC.SAMPLES | The members are the list `values` of the domain, or else the option `samples`, the edge values and the lists `samples` of the domains. A value outside the domain gets no test. Without a member, the law `samples` gives a finding. |

## The syntax kit

A syntax profile gives the text of a language: its operators, literals, references and calls (D41). One parser and one printer read the profile.

| ID | Requirement |
|---|---|
| SYNTAX.PARSE | `parse(profile, text)` gives a document of the formula kit. The precedence and the grouping of each operator decide the tree. A literal that JSON cannot write uses `ext.number` or `ext.undefined`. |
| SYNTAX.SPAN | A bad text gives an issue with a 0-based offset, a length and a message. `parse` does not throw for a bad text. |
| SYNTAX.DEPTH | A text or a document too deep for the stack of the host gives an issue or `#DEPTH!`. The kernel counts each such overflow, thus a cache finds it (D208). |
| SYNTAX.PRINT | `print(profile, doc)` writes the fewest parentheses that keep the tree. A document without a text form gives `#VALUE!` at its place. `syntaxFormat` adds the printer as the default of the verb `format`, and an own entry of a part still wins. |
| SYNTAX.ROUNDTRIP | `parse(profile, print(profile, doc))` gives `doc` again for each document that the profile writes. A property test examines generated documents of eight profiles. |
| SYNTAX.PROFILE | A profile describes the syntax of another language, for example a spreadsheet with `A1`, `&`, `^` and `<>`, or an algebra with named knobs and only `min`, `max` and `floor`. A profile with two readings of one symbol throws a `TypeError`. |
| SYNTAX.HEADER | A profile with the bind symbol `header.bind` reads `name = expr` as `expr` with the header `name` (D62). A bare literal goes into `lit`, or into its data envelope with `literals.envelopes` (D65). `print` writes the name and puts parentheses around a named term of an operator. A longer operator that starts with the symbol wins. A symbol that an infix or a postfix operator reads throws a `TypeError`. Without the symbol, a name has no text. The own entries have no text in each profile. |
| SYNTAX.FORM-PATH | A call form can have plain names with dots between them, for example `math.product` (D62). The parser matches the full name of a call against the forms, and `print` writes it. A name with dots and no `(` stays a reference. |
| SYNTAX.DATA | A call form with `args: "literal"` takes one literal that JSON writes, and the literal is the value of its document (D63). Thus `text("big")` is `{ type: "text", value: "big" }`. A document, `NaN`, `-0` or a second argument gives an issue. A bare literal keeps its text. |
| SYNTAX.DATA-FIELD | A field in `data` of a call form reads a list between brackets and a record between braces, with documents in them (D177). A literal stays its data, and a record of data has no key `type`. `print` writes the same text. Thus `WORLD_SYNTAX` reads `handle(with: [{op: "log", do: payload}], body: log("a"))`. |
| SYNTAX.RECORD | A call form with `args: "named"` reads each argument as a key, a `:` and a document, and its value is a record (D63). Thus `panel(width: 300)` is `{ type: "panel", value: { width: 300 } }`. The field `fields` of the form limits the keys. A key is a plain name or a name in backticks. A second key with the same name gives an issue. |
| SYNTAX.STEP | A step of a path in parentheses after a dot is a document, for example `self.parent.(nearest(type: "panel")).width` (D63). `print` writes a step that is an envelope in parentheses. A path with a step document is not the name of a call. |
| SYNTAX.WORLD | `WORLD_SYNTAX` is the profile of `STD_WORLD` (D64). An operator, a call form or the reference syntax gives a text for each kind and each alias of the world. A test lists the kinds, and a kind without a text needs a pinned reason. `STD_MACHINE` evaluates the documents of its texts. A host profile spreads it and adds its forms. |
| SYNTAX.ENVELOPE | With `literals.envelopes`, a literal in a place that takes a document gets its data envelope (D65). Such a place is the whole text, the document after a header name, or an argument in the field `wrap` of its form. `print` writes the envelope there as the bare literal, and a bare literal there has no text. `WORLD_SYNTAX` turns the rule on, thus `list(1, 2)` evaluates with `STD_MACHINE`. |
| SYNTAX.FEW-TERMS | The forms `add`, `multiply` and `greater` of `WORLD_SYNTAX` write an operator document that its operator does not write, for example `add(5)` and `add()` (D65). The operator wins when it fits. The type reads back as the kind. |
| SYNTAX.RECORD-TEXT | With `constructs.record`, braces read and write a record of documents, for example ``{a: 1, `b c`: x}`` (D127). A key is a plain name or a name in backticks, and a reserved word is a good key. A second key with the same name gives an issue. A record is one term. A call form of the kind wins in `print`. |
| SYNTAX.LET-TEXT | With `constructs.let`, the text `let {a: 1} in a + 1` reads `{a: 1}` into `bind` and `a + 1` into `body` (D127). The body goes as far as it can, thus `print` puts parentheses around the form as a term of an operator. A value with other keys has no text. |
| SYNTAX.FN-TEXT | With `constructs.fn`, the text `(x, y) => x + y` reads `x` and `y` into `params` and `x + y` into `body` (D127). A parameter is a plain name or a name in backticks, and each word is a good parameter. Without `=>`, the text is a group as before. The body goes as far as it can, thus `print` puts parentheses around the form as a term of an operator. A value with other keys has no text. |
| SYNTAX.CALL-TEXT | With `constructs.call`, arguments after a group read a call of a value, for example `(f)(1, 2)` (D127). A name before arguments stays an operation, thus `f(1)` is `ops.f`. The text `(f)()` reads `args: []`, thus a document without `args` has no text. The text `f(1)(2)` stays an issue. |
| SYNTAX.CALL-DOTTED | A call name with dots needs the field steps. Without them, `print` gives an error, and `parse` refuses the text. |
| SYNTAX.CONSTRUCTS | The field `constructs` of a profile names the kind of each form, and a form without a kind stays an issue (D127). Each form was an issue before, thus each text of before reads the same document. No name becomes reserved: `let`, `in`, `fn`, `call` and `record` stay names and operations. An operator that reads the text of a form throws a `TypeError`. |
| SYNTAX.ISSUES-ALL | The field `issues` of a failed answer holds each issue that recovery finds, with rising offsets (D138). The type `ParseResult` does not change. A later issue is a fault in a list, a group, an escape or the text after a bracket, or a rule of a form. |
| SYNTAX.ISSUES-FIRST | The first item of `issues` is the issue of the first read, thus each text that failed before gives the same offset, length and message (D138). A valid text gives the same document and runs no recovery code. |
| SYNTAX.ISSUES-SYNC | Recovery moves to the separator of the profile, to `)`, or to `}` of a profile with braces, and it skips quoted texts and inner brackets (D138). A fault outside brackets ends the read. A text with an open quote or an open bracket gives one issue. |
| SYNTAX.ISSUES-CASCADE | Recovery adds no issue of its own (D138). Offsets rise, and the first token after a synchronising token gets no issue. A colon in a list skips the rest of the list. A separator in a group ends the item around the group. |
| SYNTAX.ISSUES-BOUND | `parse` gives at most `MAX_SYNTAX_ISSUES` issues, and each read ends (D138). Each step of recovery moves forward, and an error of a host in a later text keeps the issues so far. |
| SYNTAX.ISSUES-GENERATED | Printed documents with faults from a seeded generator give the first issue of the parser before D138, by a digest (D138). Offsets rise. One fault gives one issue, except for a fault in a quote mark. |
| SYNTAX.PROFILE-CHECK | `checkSyntax(profile)` gives the faults of a profile as findings with `code`, `place` and `reason`, at most one for each code and place (D140). A profile that `compileProfile` refuses gives one finding `invalid`. `parse` and `print` do not call the check. |
| SYNTAX.PROFILE-CHECK-CLEAN | The default profile, `STD_SYNTAX`, `WORLD_SYNTAX` and each profile of the round-trip generators give no finding (D140). |
| SYNTAX.PROFILE-CHECK-SETTLED | A clash that the parser settles gives no finding, and its documents come back (D140). Examples are `-` as prefix and infix, `<` with `<=`, `in` as an operator with `let`, and a form name that a pattern matches. |
| SYNTAX.PROFILE-CHECK-LAW | A generated profile with no finding keeps `parse(print(doc))` for generated documents (D140). |
| SYNTAX.PROFILE-CHECK-OPERATOR | An operator with its own document lost gives `operator` at `["operators", i]`: a negative precedence, or a kind with its own text (D140). |
| SYNTAX.PROFILE-CHECK-GROUPING | Two operators that give two parses give `grouping` (D140): a precedence gap under `1`, a postfix operator at the precedence of a `right` infix operator, or a precedence at `2 ** 53`. |
| SYNTAX.PROFILE-CHECK-LONGEST | Two postfix operators that a longer symbol reads give `longest-match` (D140). With `!` and `!!`, a document with `!` two times prints `a!!`, and that text reads `!!`. |
| SYNTAX.PROFILE-CHECK-WORD | A literal word that does not read as its value gives `word` at `["literals", "words", word]` (D140). A word operator reads first, and a word that is not a plain name has no token. |
| SYNTAX.PROFILE-CHECK-ROOT | A root that does not come back gives `root` at `["refs", "roots", i]` (D140). A word operator or a literal word reads first, and a default root has its place in the default list. |
| SYNTAX.PROFILE-CHECK-PATTERN | A pattern that reads a text with another meaning gives `pattern` at `["refs", "patterns", i]` (D140). The text can be a word operator, a literal, a number, a dotted form name or a dotted call. |
| SYNTAX.PROFILE-CHECK-FORM | A call form that does not come back gives `form` at `["calls", "forms", i]` (D140). A word operator reads first, the last form of a name wins, and a `min` above the fields permits no text. |
| SYNTAX.PROFILE-CHECK-CALL | A name of `calls.ops` that does not come back gives `call` at `["calls", "ops", i]` (D140). A form or a word operator takes the name, and a dotted name needs the field steps. |
| SYNTAX.PROFILE-CHECK-SEPARATOR | A separator that does not end an argument gives `separator` at `["calls", "separator"]` (D140). The control is the same document with a neutral separator. |
| SYNTAX.PROFILE-CHECK-CONSTRUCT | A construct form that does not come back gives `construct` at `["constructs", name]` (D140). Examples are two forms of one kind, and the kind `ref`. |
| SYNTAX.FORM-DOMAIN | A form `literal` of the kind `ext.domain` with the field `domain` reads its one literal as the data of that domain. `print` writes that document as the form. |
| SYNTAX.FORM-DOMAIN-VALUE | The syntax does not read the data. The codec of the machine reads it at evaluation, and the codec gives each error of the data. |
| SYNTAX.FORM-DOMAIN-ROUND | `parse` of `print` gives the same document for each literal data of each domain with a form. |
| SYNTAX.FORM-DOMAIN-NONE | A domain without a form, data that is not a literal, and a value with another key have no text. |
| SYNTAX.FORM-DOMAIN-CHECK | A form `literal` of `ext.domain` needs a domain. Each other form with the field `domain` throws when the profile compiles. |

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
| CONFORM.TRUTH | The own `truthy` of a profile with a `truthType` gives `true` or `false` for each member, or `formula.if`, `formula.and` and `formula.or` break `truth` (D86). The members come from the lists `values`, or from the palette and the samples of the domains. A value outside the type gets no test. |
| CONFORM.COVER | Each sample of a covered domain of the machine is in one domain of each valid cover, or each evaluator and each runner breaks `cover` (D94). The samples come from the list `values`, or from the palette and the samples of the domains. A cover that does not count by the line rule of D85 gets no test. |
| CONFORM.SAMPLES | The checks `truth` and `cover` add the list `samples` of each domain to the palette, after its results (D99). The domain `number` gives `0` and `-1`. A sample outside the type gets no test. |
| CONFORM.PARALLEL | Code whose result, parts or effects change with the order of the waits of `all` breaks `parallel` (D128). The probe `all` keeps the rule ALL. Each scenario with a choice of waits runs in up to six orders, from the probe document and the option `seed`. The order of the effects, and a stop by `failFast`, give no finding. |
| CONFORM.WALKER-STD | Each walker of `STD_MACHINE` and a correct walker give no finding. A name that no evaluator and no runner has selects its walker, and then its `deref`. The option `verb` selects that code by force (D137). |
| CONFORM.WALKER-RESULT | A walker that gives no `WalkResult`, a promise or a failure code without `#` breaks `result`. A throw breaks it too, except a `Failure` (D137). The probe context is frozen, thus a write to the context throws. |
| CONFORM.WALKER-LOCAL | A walker that gives another outcome or other steps for the same input in a later call breaks `local`. A volatile kind gets no such test. |
| CONFORM.WALKER-LADDER | A walker that reads a host thing outside `deref` and `has` of its input breaks `ladder` (R-WALKER, D137). |
| CONFORM.WALKER-HOPS | A `visit` that names no step of the input breaks `hops`. A walk that changes without `visit` breaks it too (DEREF.HOPS). |
| CONFORM.WALKER-PURE | The walker of a pure kind breaks C4 when other values in the roots of the context change its walk (FACTS.VERB). |
| CONFORM.WALKER-TYPE | A walker that reaches a thing outside the type of its rule breaks `typed` (TYPE.WALKER). The probes ask the rule for `unknown` and for the plain type of the thing before the step. A rule that throws gets no finding here. A reached reference gets no test. |
| CONFORM.DEREF-STD | Correct code of a `deref` gives no finding, with a function `has` and without one (D137). |
| CONFORM.DEREF-RESULT | Code of a `deref` or its `has` that throws breaks `result`, except a `Failure`. The probe of the finding names the key. |
| CONFORM.DEREF-LOCAL | Code of a `deref` that gives another answer for the same document and key in a later call breaks `local`. A volatile kind gets no such test. |
| CONFORM.DEREF-HAS | A function `has` that gives no truth breaks `has`. A function `has` that gives `false` for a key that the code answers breaks it too (D137). |
| CONFORM.PROFILE-STD | The kit with a typed profile gives no finding, with the default types of each evaluator (D137). |
| CONFORM.PROFILE-NAMES | The default types of `formula.op` and `formula.ext` hold each name that the tables of the profile list, except a volatile name. The option `types` replaces them. |
| CONFORM.PROFILE-SIGNATURE | An operation that gives a value outside the result of a signature that its arguments match breaks `typed`. The value is the value after the hook `check`. A throw, an error and a bad type get no finding. |
| CONFORM.PROFILE-EXT | An extension that gives a value outside its entry in `extTypes` breaks `typed`. The data comes from the fixed list and from the option `values`. |
| CONFORM.PROFILE-FORM | A function `ext`, `lazy`, `check`, `omit`, `missing` or `combine` that gives another form than its type breaks `result`. A throw gets no finding here (E-THROW). |

## The stepper

| ID | Rule |
| --- | --- |
| STEPPER.FORMULA | `stepper` gives the result of `reference` for each construct of the formula kit, with the place of each error. |
| STEPPER.SPLIT | The stepper reads each shape itself. It gives the parts, the data and the reason of each error of `partsOf`. |
| STEPPER.LOOKUP | The stepper reads the lookup itself. It gives the kind of `lookupKind` through aliases, namespaces and fallbacks. |
| STEPPER.PATH | The stepper walks a path itself. It gives the value or the error of `resolve` for keys, references, cycles, deref code and walkers. |
| STEPPER.CLOSURE | A closure in a configuration is a value that only the stepper makes. Host code gets a function, and a call of that function starts a nested stepper. |
| STEPPER.FORGE | A record from data is data, also with the key `coeval.closure` or `coeval.held`. A call of it gives the `#VALUE!` of `reference` with no effect. A read of it gives the record. |
| STEPPER.LIMIT | The applications of functions have the limit of `reference`: the count of the active applications, with a nested stepper too. |
| STEPPER.WORK | The stepper counts one point for each application of a closure, by `call` or by an operation of the host. The point past `maxWork` gives the `#WORK!` of `reference`, at the same place. After the end, each call from the host starts a new count. A configuration from `stepperNext` holds the count. |
| STEPPER.STD | A compiled evaluator of the standard machine gets the definition of `reference`, unless the option `definitions` gives another one. Thus the standard `ref` gives the result of `reference`. |
| STEPPER.PROFILE | An exception of a rule of the profile gives the error of `reference`, with the name of the evaluator of the document. |
| STEPPER.EFFECT | An effect of a host evaluator has the capability test, the address, the mock and the outcome of `reference`. A runner gives `#NOEVAL`. |
| STEPPER.DEEP | A list nested 100000 times evaluates, because the stepper does not use the stack of the host for the nesting. The limit `maxDepth` stays. |
| STEPPER.DATA | A configuration of a document of the formula kit goes through JSON with `encodeConfiguration` and `decodeConfiguration` at each step. The run gives the same result, and a record of data stays data. |
| STEPPER.NEXT-STATE | Each call of `stepperNext` has a new program. Thus a configuration from it holds the count of work, the count of the effects at each place and the number of effects. Steps give each effect the address and the index of `stepper`, also through JSON. |
| STEPPER.PURE | `stepperNext` leaves its configuration as it is. A host can step one configuration twice, and it gets equal configurations. |

## The calculus

| ID | Rule |
| --- | --- |
| SEM.RULES | Each inference rule of `SEMANTICS.md` names the IDs of this file that it covers. Each of these IDs is in this file and has a test. |

## The package

| ID | Rule |
| --- | --- |
| PKG.PURE | An import of the package does nothing. Each statement at the top of a module is free of side effects, or its expression has the mark `/* @__PURE__ */`. Thus a bundler that does not examine functions, for example esbuild, removes each unused part. |
