# Changes of `@mark1russell7/coeval`

The GitHub release of a version shows the section of that version. Each decision `D<n>` is in `docs/DECISIONS.md`.

## 0.25.0

MINOR: before `1.0.0`, a breaking change increases MINOR. The entry `ref.resolve` of `STD_EVALUATORS` is an object, not a function, and `TypeInput` gets two methods. No export goes.

### Changes of behavior

- **The standard evaluator `ref.resolve` compiles its path in `prepare` (D133).** `STD_EVALUATORS["ref.resolve"]` is a compiled evaluator. Its type stays `Evaluator`. A host that calls the entry as a function calls `STD_DEFINITIONS.evaluators["ref.resolve"]`. Each result, error, place and read stays the same.
- **`TypeInput` gets the methods `readOf` and `provenBy` (D147).** The pass gives them. A host that makes its own `TypeInput` must add them.

### New features

- **A test with `proves` narrows a path in `if`, `and` and `or` (D147).** `Signature` gets the optional fields `proves` and `present`. `TypeRule` gets `first`, `usesProofs`, `reads` and `proves`. `PartType` gets `narrow` and `keep`. The new types are `Proof` and `Proven`. A document with a declared effect narrows only its names.
- **A language adds its own verbs to the kinds of other languages (D156).** `WorldPart` gets the optional fields `verbs` and `extends`. The merge adds each entry after each part, thus two languages commute. Piracy, a verb of the kernel, two owners, two entries for one verb and a path without a kind are conflicts. The new type is `VerbEntries`.

## 0.24.1

PATCH: before `1.0.0`, a new feature or a fix increases PATCH. Each change adds an export or an optional field, or corrects a fault. No export goes, and no type changes.

### New features

- **The agreement rule for types (D148).** `agreeTypes(machine, doc, context, options)` evaluates a document and examines that each value agrees with its type. The clauses are `value`, `argument` and `error`. The new exports are `agreeTypes`, `AgreeTypesOptions` and `TypeAgreement`.
- **Guards at the boundaries of types (D149).** `boundariesOf(typing, domains)` gives each place where a part with an imprecise type meets a position that needs a type. The new option `guards` of `prepare`, `evaluate` and `run` takes that list. The default is no list, thus a run without the option does not change. The new exports are `Boundary` and `boundariesOf`. `TypeRule` and `Typed` get the optional field `read`.
- **A map over the documents (D152).** `mapDocs(world, doc, change, options)` changes the documents of a tree from the root to the parts, and it can stop at a node. The new export is the type `DocChange`.
- **A runner for `if` (D153).** `ifRunner(truth)` gives a runner of `if` with the three failures and the order of the parts in one body.
- **A call form is the text of a domain value (D141).** `SyntaxForm` gets the optional field `domain`.
- **A field of data in a syntax form (D177).** `SyntaxForm` gets the optional field `data`. `WORLD_SYNTAX` gets a form for the kind `handle`, thus `print` writes a text for each document of D146.
- **A function evaluator can hold a type rule (D150).** `ruleOf` reads the field `type` of a function, as it reads the field of an object. The field must be a `TypeRule` with a function `synth`.

### Fixes

- **`print` gives an error for a dotted call without field steps (D142).** With `ops: true` and `fields: false`, it wrote `m.p(1)`, and `parse` refused that text.
- **A kept read that reaches a true cycle gives no false `#CYCLE!` (D145).** A node with a real read from the cycle stays on the cycle in each order. A node without one stays outside it.
- **A plain attribute of a node with a circular attribute takes the cell of the host (K244).**
- **`agreeTypes` gives its finding for a bigint or a record with a cycle (K245).** It threw a `TypeError` before.
- **`print` writes a record with the key `type` that is not an envelope as `sub` (K245).** `parse` refused the text that `print` gave before.
- **`factsOf` is 15 to 16 % faster on a tree with an equation (K238).** The walk reads the grant rules one time for each kind. A part with no grant keeps its capabilities with no copy. 0.24.0 read them again for each part.

### Tests and CI

These changes are not in the package. The dev dependencies `rigor-bench` and `rigor-statistics` move to `^0.2.29` and `^0.1.16`.

Speed reads one gate unit for each pair of jobs (D179). Its flip test seeds a real slowdown (D180), and each PR shows its gate line (D181). On a mixed CPU pair, a case takes the verdict of the two jobs only when they agree (D183). A block of the ladder gate gives a PR warning (D182). A group of split test parts above 0.0359 of the test time fails a full CI run (D174).

## 0.24.0

MINOR: before `1.0.0`, a breaking change increases MINOR. The union `CapsRule` gets a member, and a document of the kind `handle` gives a result where it gave an error. No export goes.

### Changes of behavior

- **The union `CapsRule` gets the rule `grant` (D146).** An exhaustive match over the union does not compile until it has the new member.
- **`STD_WORLD` gets the kind `handle` (D146).** In 0.23.0, a document of the kind `handle` gave an error. In 0.24.0, it answers the effects of its body.

### New features

- **Handlers as documents (D146).** The kind `handle` answers the effects of its body with its clauses `do` and `abort`, and its field `return` changes the result. Thus a mock, a log or a retry is a document. A clause has the capabilities of its `handle`, and `pure` still stops a handled effect. A handled effect does not reach the host, thus `check` and `effectsOf` do not give it. The new exports are the type `Clause` and `partGrants`. `RunPart` gets the optional method `handled`, and `DocVisit` gets the optional field `handled`.
- **The faults of a syntax profile (D140).** `checkSyntax(profile)` gives each clash of a syntax profile as a named finding with a place. Each finding is a small document that breaks `parse(print(doc))`.

### Tests and CI

These changes are not in the package. The limit of PLAN.LEAN reads the data spaces of the heap (D171). Both arms of Speed build under one resolved `tsconfig.json` (D168). The ladder starts on each change of the kernel, and two flips show that its report-only gate can block (D164).

## 0.23.0

MINOR: before `1.0.0`, a breaking change increases MINOR. `conforms` gives findings for host code that passed before, and some documents give another error. No export goes.

### Changes of behavior

- **`conforms` examines walkers, the code of a `deref` and the functions of a profile (D137).** In 0.22.0, `conforms` threw for the name of a walker or of the code of a `deref`. It examined `formula.op` and `formula.ext` only for the types in the option `types`. In 0.23.0, the name selects the code, and the default types hold each named function of a profile. Thus host code that passed before can get a finding.
- **The probe `all` of `conforms` keeps the rule ALL of the kernel (D128).** A scenario with a choice of waits runs in up to six orders. The new obligation `parallel` gives a finding when the result, the parts or the effects change with the order. The type `Obligation` gets the member `parallel`.
- **A certain cycle longer than the stack gives `#CYCLE!` (D139).** In 0.22.0, a long ring of nodes overflowed the stack of the host and gave `#DEPTH!`. In 0.23.0, a walk with its own stack finds the cycle at each length. A chain with no cycle keeps its `#DEPTH!`.
- **A kept read closes no false cycle (D136, D143).** In 0.22.0, a closure whose `self` refers to its own node gave `#CYCLE!`. A closure at `f` whose `self` refers to `g`, with a `g` that reads `f`, also gave `#CYCLE!`. In 0.23.0, both give their values. A true cycle gives `#CYCLE!` as before.
- **A failed `parse` gives each issue of a text (D138).** The field `issues` can hold more than one item, at most `MAX_SYNTAX_ISSUES`. The first item is the same issue as before. A valid text runs no recovery code. The new export is `MAX_SYNTAX_ISSUES`.
- **`STD_SYNTAX` has text forms for `record`, `let`, `fn` and `call` (D127).** In 0.22.0, `print` gave `#VALUE!` for these documents, and `parse` gave an issue for these texts. In 0.23.0, they have a text. Each text that parsed before gives the same document. A host that spreads `STD_SYNTAX` and adds an operator that starts with `{`, `}` or `=>`, or the word operator `let`, gets a `TypeError`.
- **The union `AttributeRung` and the list `ATTRIBUTE_RUNGS` get `"forward"` (D126).** An exhaustive match over the union does not compile until it has the new member. `STD_WORLD` gets the kind `tree.quote`.

### New features

- **Higher-order attributes and forwarding (D126).** An equation of `tree.attributes.<name>.higher` gives a document as data. The document evaluates with the node as `self`, as a new node under the node. `TreeContract.forwards` gives an attribute that no other rung answers from a node that an attribute gives. An endless generation gives `#DEPTH!` at `GENERATION_LIMIT` generated documents. The new exports are `documentKey` and `GENERATION_LIMIT`.
- **Text forms in a syntax profile (D127).** The new optional field `constructs` of a `SyntaxProfile` names the kind of each of the four forms. The new export is the type `SyntaxConstructs`.
- **A language compiles its own paths (D129).** A language outside the formula kit compiles a static path one time and reads it through `Runtime`. The new exports are `compilePath`, `resolveCompiled` and the type `CompiledPath`.
- **The laws of the codec of one domain (D130).** `codecLaws(machine, name, options)` examines the laws `samples`, `encode`, `json`, `stable`, `decode` and `roundtrip`. The new exports are `codecLaws`, `CodecFinding`, `CodecLaw`, `CodecLawsOptions` and `CodecProbe`.
- **Certain cycles as issues, with no run (D131).** `checkCycles(target)` gives one issue for each certain cycle of a schedule. Each issue is a cycle that a run reports. The new exports are `checkCycles` and the type `CycleIssue`.
- **A node of a schedule can have its own `self` (D135).** The option `ScheduleOptions.selfOf(id, host)` gives each node its own `self`. Nodes with one document share one plan. `agreeSchedule` gets the option `selves`, and `ScheduleAgreementCounts` gets two fields.
- **A kept read is marked for the schedule (D136).** The new optional member `HostThing.keeping(read)` wraps each kept read that resolves its path.

### Fixes

- **Recovery ends with an empty separator (K226).** In the code of D138 on `main`, `parse` did not end for a profile with `separator: ""` and a text with a call. Recovery ends the read at the second item at one offset. This fault was in no release.
- **Each parameter property is a plain field (D160).** The emitted JavaScript keeps the same members.

### Tests and CI

These changes are not in the package. Each failed test of the measure step turns the step red, and PLAN.LEAN also reads the data spaces of the heap (D161, D162, D170). The gates read a change of the lock file, and a slower reading holds a merge only when the arm hashes differ (D166). A Speed dispatch takes the number of rounds and jobs (K225).

## 0.22.0

MINOR: before `1.0.0`, a breaking change increases MINOR. A deep recursion through closures gives `#DEPTH!` at a lower depth than before. No export goes.

### Changes of behavior

- **A clock for `call` gives one `#DEPTH!` in each tier (D125).** Each application of a closure of `fn` counts one level. An application by `call` and an application by an operation of the host both count. The clock permits `ceil(maxDepth / 4)` levels, thus 250 for the default `maxDepth` of 1000.
  - In 0.21.0, an endless recursion stopped at the stack of the host. It gave `#DEPTH!` with a `RangeError` as its cause, at a place that changed with the tier.
  - In 0.22.0, it gives `#DEPTH!` with the reason "The applications of functions nest deeper than 250 levels." The document that applies the closure gets the place, in each tier.
  - The break: a finite recursion of 251 to approximately 1600 nested applications gave its value in 0.21.0. In 0.22.0, it gives `#DEPTH!`. A host that needs a deeper recursion sets a larger `maxDepth`.
  - The limit comes from one measure. On Node.js 24.21.0 on Windows, the reference tier overflowed the stack of the host after 937 applications, and the plan after 1595.
  - The test FORMULA.CALL-DEPTH runs the reference at twice the default limit with no `RangeError`. Thus a Node.js version with a smaller stack fails that test in CI first.

### New features

- **Attributes with parameters (D124).** The new table `tree.at` of a tree contract gives an attribute with parameters an entry `{ params, equation }`. The new standard step `tree.at` with the fields `attr` and `args` reads an instance of the node. For example, a parent asks for the height of a child at a given width.
  - The equation sees each parameter as a name, for example `names.width`. A missing or an extra argument gives `#VALUE!`.
  - Two arguments share one memo entry only when they are equal by DOC.EQUALS. A host with cells gets one cell for each instance.
  - `check` examines each entry and each step with literal arguments. The graph of attribute instances gives an exact vertex for such a step, with the new field `args`.
  - An entry cannot be `circular` or `collect`. The text syntax has no form for `args`, thus a step with arguments is a document.
  - The new exports are `AtArgs`, `AtEquation`, `AtRule`, `argsKey`, `atArgsOf` and `atRuleOf`.

## 0.21.0

MINOR: before `1.0.0`, a breaking change increases MINOR. `typeFromSchema` gives a narrower type for a schema with more than one of `type`, `anyOf` and `oneOf`. `check` finds more type issues. No export goes.

### Changes of behavior

- **`typeFromSchema` gives the meet of the keywords of a schema (D123).** In 0.20.1, a schema with more than one of `type`, `anyOf` and `oneOf` gave the type of the first keyword, with an issue. This rule came from D28. In 0.21.0, the type is the meet of all the keywords. For example, `{type:"number", anyOf:[{type:"string"}]}` was `number`, and in 0.21.0 it is `never`. Each reading only narrows, and each reading stays sound.
- **A step that reaches nothing in each run is a type issue (D120).** In 0.20.1, some steps gave the type `unknown` with no issue. They are a field step on a kernel base type, a step on a function, and an unknown step on a list. In 0.21.0, `check` gives the issue of a missing field, as for a closed record (TYPE.NO-STEP).
- **The reason of a missing field names a step document by its kind (D121).** In 0.20.1, the reason showed `[object Object]` for a step document. In 0.21.0, it shows the kind in parentheses.

### New features

- **`typeFromSchema` reads local references and `allOf` (D123).** A `$ref` to `#/$defs/<name>` or `#/definitions/<name>` reads that definition of the root schema. A reference to another file, a missing definition and a cycle of references read as `unknown`. The parts of `allOf` add their keywords to the schema.
- **Collection attributes and a registry of names (D122).** A declaration `collect: { unit, combine }` combines the contributions of a subtree. A kind contributes through its equation in `tree.contributes`. The form `collect: "names"` gives a registry from the header name of each node to its node. The new standard step `tree.named` reads the registry. Two nodes with one name give `#VALUE!` at the read of the registry. The new exports are `CollectDeclaration`, `CollectRule` and `collectOf`.
- **A walker holds the type rule of its step (D121).** A walker can hold an optional rule in its field `type`. The check then knows the type of what the walker reaches. A plain function stays a walker. The new export is `WalkTypeInput`.
- **A kind declares the parts that its runner drives (D119).** `KindFacts` gets the optional field `drives`. In a check of a run, a part that `drives` names gets no wait.
- **The hook `facts` gives the effects of a code (D118).** `KindFacts` gets the optional field `effects`. For the verb `eval`, the answer of the hook for the code wins over the contract. `effectsOf`, `check` and `factsOf` use that one declaration.

### Tests and CI

These changes are not in the package. The margin and the noise cap of each case family of the bench come from the A/A records of CI (D117).

## 0.20.1

PATCH: before `1.0.0`, a new feature increases PATCH. The new exports change nothing that exists.

### New features

- **A ladder of steps for each language (D116).** A language declares its steps, from the lowest to the highest, and the step of each construct as data with `stepLadder`. `stepOf` gives the lowest step that a document needs, with the first node that needs it. `checkStep` refuses a document above the highest step that the host accepts, and the refusal names the needed step. The new exports are `StepKey`, `StepLadder`, `StepNeed`, `StepReason`, `StepRefusal`, `StepWalk`, `checkStep`, `isStep`, `stepLadder`, `stepOf` and `stepRank`.

## 0.20.0

MINOR: before `1.0.0`, a breaking change increases MINOR. A node with the cells of a host gets a new key, and the place of such a node is a new array. Circular attributes are a new feature. No export goes.

### Changes of behavior

- **The cells of a host are kept for each node in its scope (D115).** In 0.19.0, the nodes that an equation plan makes had the same place in each document. A host that keeps cells by place thus gave the cell of one document to another, and two cards of one document shared one cell. In 0.20.0, the kit gives each node one key in its scope. The type of `AttributeCell` does not change. A host that keys cells by the identity of `place`, as D108 tells, needs no change.
- **A nested evaluation gets its own cycle marks (D115).** In 0.19.0, a cell compute that evaluated a second document of the same plan could get a false `#CYCLE!`. In 0.20.0, the marks and the tree of a root use the key of the node.
- **The place of a node with host cells is its key (D115).** `placeOf` and the place of an error give an array with the same items as before, but a new array.

### New features

- **Circular attributes (D113).** An attribute that declares `circular: { start, limit }` evaluates its cycle again until no value changes, by the demand algorithm of Magnusson and Hedin. A cycle that is not stable at the limit gives `#CYCLE!`. The default limit is 100 rounds. A cycle with a plain attribute gives `#CYCLE!` as before.
- **`check` and `attributeGraph` know circular cycles (D113).** They accept a certain cycle only when each of its attributes is circular. The new exports are `CircularDeclaration`, `CircularRule`, `CIRCULAR_LIMIT` and `circularOf`. Documents without `circular` evaluate as before.

### Tests and CI

These changes are not in the package. The bench uses `@mark1russell7/rigor-bench` for its runner, its orders, its medians, the A/A noise, the bound and the pooled verdict (D114). Its verdicts are same, faster, slower and cannot decide.

## 0.19.0

MINOR: before `1.0.0`, a breaking change increases MINOR. `check` finds more issues in trees, `encodeValue` can give a different document, and `factsOf` gives other facts for a verb other than `eval`. The type of `WorldIssue.code` gets a second value. No export goes.

### Changes of behavior

- **`check` finds attribute faults of a tree (D106).** In 0.18.0, `check` accepted a read of an attribute that no rung answers, and the run gave `#N/A`. In 0.19.0, `check` gives that `#N/A` at the same place before a run. It also gives `#NAME?` for an attribute named `parent` or `type`, and `#CALC!` for a tree kind of the run side.
- **`check` finds the cycles of attributes (D107).** In 0.18.0, a cycle of tree attributes gave `#CYCLE!` only in a run. In 0.19.0, `check` gives that `#CYCLE!` before a run for each certain cycle, with the same place and reason. A cycle through a lazy branch or an unknown read is not an issue.
- **`encodeValue` uses the codec of the most specific domain (D109).** In 0.18.0, it tried the domains with a codec in the order of their names. Thus a parent with an early name encoded the members of its subdomains. In 0.19.0, it tries the deepest domain first. Names decide only between domains of the same depth. A table where no codec domain has a parent gives the same documents as before.
- **`factsOf` gives the facts of a verb from its own contract (D111).** In 0.18.0, `factsOf` with a verb other than `eval` gave the side and the effects of the `eval` contract. In 0.19.0, it gives the effects that the entry of the verb in `verbEffects` declares. A kind is on the run side for that verb only when its entry declares an effect. A kind without an entry adds nothing, as in `check`.
- **`WorldIssue.code` can be `#TYPE!` (D110).** In 0.18.0, its type was only `"#NOEVAL"`. In 0.19.0, it is `"#NOEVAL" | "#TYPE!"`. Code that gives `issue.code` to the literal type `"#NOEVAL"` does not compile. Calls without the new option give the same issues as before.

### New features

- **`attributeGraph` gives the graph of the attribute instances of a tree (D107).** It gives one vertex for each node and attribute, one edge for each read, the edges with an unknown source, and the certain cycles. `attributeVertexId` gives the id of a vertex.
- **`treeNodeEvaluator({ cell })` takes the memo cells of a host (D108).** A host can keep the cell of each attribute between evaluations of one plan. A change of its store then computes only the attributes whose cells it drops. Without `cell`, the standard code does not change.
- **`checkWorld(machine, verbs, { types: true })` checks each value type of a machine (D110).** In 0.18.0, `check` found a bad value type of a contract, a domain or a signature only at the first document that used it. In 0.19.0, this option finds each bad value type before a document exists. Each bad term gives one `#TYPE!` issue, with its owner and its keys in `at`. A type rule lists what it reads with the new optional field `declared`.
- **`printReads` finds a host value that changed in place (D112).** In 0.18.0, `verifyReads` compared host values by identity, so a value changed in place kept a stale result. In 0.19.0, `printReads` and the `verifyReads` option `prints` find such a change, and give the changed read with `inPlace: true`. `durable` and `schedule` take the option `inPlace`. Without the new options, nothing changes.

### Tests and CI

These changes are not in the package. Each bench record names its mode (K199). The ladder of STATIC.LINEAR also measures the memory of each walk (D105).

## 0.18.0

MINOR: before `1.0.0`, a breaking change increases MINOR. `conforms` tests more members of a domain. Thus a profile that conformed under 0.17.0 can fail. No export goes.

### Changes of behavior

- **`conforms` tests the covers of a machine (D94).** In 0.17.0, `conforms` did not test a cover. In 0.18.0, the new check `cover` tests each covered domain with samples. A sample that no domain of the cover holds is a finding.
- **A domain gives samples of its members (D99).** In 0.17.0, the checks `truth` and `cover` tested `number` only with `1` and `2`. In 0.18.0, they also test `0` and `-1`. Thus a truth or a cover that passed in 0.17.0 can fail.
- **A cause that is a list or a record keeps its items (D100).** In 0.17.0, the cause `{ send: () => 1, code: 7 }` of an exception was the name `cause` in `dropped`. In 0.18.0, `causeParts` holds the record `code`, and `dropped` holds only `cause.send`. This rule applies also to an error value without an exception.
- **A shared list or record decodes as one object (D101).** In 0.17.0, the record `{ code: 7 }` in the fields `a` and `b` gave two term documents. `decodeLog` then gave two copies. In 0.18.0, `a` is the part `record`, and `b` is `{ share: 0 }`. `decodeLog` gives one object. A log of 0.17.0 decodes as two copies, as before.
- **`fits` tries each valid cover of a field (D102).** In 0.17.0, `{a: number}` did not fit `{a: lo} | {a: hi}` when `lo` and `hi` are the second cover of `number`. In 0.18.0, it fits. Thus a check accepts some programs that it refused before.
- **A run gives the host no effect that its parent cannot wait for (D91, RUN.HELD).** In 0.17.0, a host that waits did such an effect, and the run then dropped its result. In 0.18.0, the effect does not reach the host, and it keeps `#CALC!`.

### New features

- **`Obligation` has the new value `cover` (D94).** A switch over the obligations sees a new case.
- **`Domain.samples` is a new optional field (D99).** A merge of two domains that differ only in `samples` is a conflict.
- **`FormulaProfile.extTypes` gives the value type of each own extension (D103).** In 0.17.0, a check with types gave `unknown` to an own extension. In 0.18.0, an entry in `extTypes` gives the declared type. A use that does not fit it gets `#TYPE!`. A profile without `extTypes` gets the same types and issues as before.

### Tests and CI

These changes are not in the package. Each numeric limit of a unit test comes from CI runs (D95, D104). The bench starts each case in its own processes (D98). A ladder measures the slope of STATIC.LINEAR (D97).
