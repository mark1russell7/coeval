# The Lean model

This folder holds a model of the formula kit in Lean 4 (K96, D159). The file `Coeval/Formula.lean` defines the meaning of a document as a total function with a clock. The executable `coeval-model` reads documents and prints results.

The workflow `.github/workflows/lean.yml` builds the model and runs the test AGREE.LEAN. That test compares the model with the plan on generated documents. Run it in CI, not on a local computer.

The model covers `lit`, `ref`, `record`, `list`, `let`, `fn`, `call`, `if`, `and`, `or` and one operation, `add`. It does not cover `ext`, the field `own` of a document, the limit `maxDepth` or a number that is not a safe integer. D159 tells why.

The file `Coeval/Theorems.lean` holds theorems over the model (K223, D194). A result that the clock does not stop does not change with a larger clock. Two clocks that both give a result give the same result. A `let` evaluates its body in the scope of its bindings, and the bindings run in order. `lake build` checks each proof.
