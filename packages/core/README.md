# @mark1russell7/coeval

The kernel of coeval: a base for declarative languages. A program is a JSON document in an envelope, `{ type, value }`. The kind of the document names its evaluator, and a ladder finds it. A language evaluates through this kernel and keeps only what is its own.

```sh
npm install @mark1russell7/coeval
```

## A formula language in a few lines

```ts
import { context, formulaMachine, prepare } from "@mark1russell7/coeval";

const machine = formulaMachine({ ops: { add: (a: number, b: number) => a + b } });
const doc = { type: ["ops", "add"], value: [{ type: "ref", value: ["names", "x"] }, 1] };

const plan = prepare(machine, doc); // the ladder, the kinds and the parts, one time
plan.evaluate(context({ names: { x: 2 } })); // { ok: true, value: 3 }
```

A plan evaluates many times without a trace. `evaluate(machine, doc)` gives the same result with a full trace, for a debugger or an explanation.

## What the kernel holds

| Part | Exports | What it does |
| --- | --- | --- |
| Documents | `isEnvelope`, `stored`, `typePath`, `docEquals` | The envelope, the keys of a store beside it, and the equality of documents |
| World | `lookupKind`, `Kind`, `Namespace`, `PartShape`, `ScopeRule` | The kinds, with their contracts: the shape of the parts, the names that a kind binds, and its effects. A namespace can have a fallback kind |
| Ladder | `ask` | The evaluator of a verb: the own entry, then the kind, then the default |
| References | `resolve`, `HostThing`, `Navigator` | A path from a root of the context: `self`, `names`, `world`, `event` or `caps` |
| Plans | `prepare`, `planner`, `evaluate`, `run` | A document compiles one time into code. An evaluator is a function or a compiler |
| The run side | `run`, `Runner`, `permits`, `narrow` | Effects in order, parts at the same time, capabilities that only narrow, and an abort |
| Errors | `Result`, `EvalError`, `Failure`, `failures` | An error value has a code, a reason, a place and a cause. An evaluation does not throw |
| The static kit | `walk`, `refsOf`, `mapRefs`, `check` | The documents of a document, its free references, and its problems before a run |
| The formula kit | `formulaMachine`, `FormulaProfile` | The shared constructs `lit`, `ref`, `record`, `list`, `let`, `fn`, `call`, `if`, `and`, `or`, and the namespaces `ops` and `ext` |

Each rule has an ID in [`docs/SPEC.md`](https://github.com/mark1russell7/coeval/blob/main/docs/SPEC.md), and each ID has a test. [The site](https://mark1russell7.github.io/coeval/) explains each idea with a live diagram.

## License

MIT
