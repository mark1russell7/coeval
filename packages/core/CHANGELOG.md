# Changes of `@mark1russell7/coeval`

The GitHub release of a version shows the section of that version. Each decision `D<n>` is in `docs/DECISIONS.md`.

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
