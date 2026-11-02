# Changes of `@mark1russell7/coeval`

The GitHub release of a version shows the section of that version. Each decision `D<n>` is in `docs/DECISIONS.md`.

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
