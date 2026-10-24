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
| World | `lookupKind`, `Kind`, `Namespace`, `PartShape`, `ScopeRule`, `CapsRule` | The kinds, with their contracts: the shape of the parts, the type of the data, the kinds that a position permits, the names that a kind binds, the capabilities that it gives its parts, and its effects. A namespace can have a fallback kind |
| Ladder | `ask` | The evaluator of a verb: the own entry, then the kind, then the default |
| References | `resolve`, `HostThing`, `Navigator` | A path from a root of the context: `self`, `names`, `world`, `event` or `caps`. A step document can have computed parts, and a walker can give the code of its failure |
| Plans | `prepare`, `planner`, `evaluate`, `run` | A document compiles one time into code. An evaluator is a function or a compiler |
| The run side | `run`, `Runner`, `permits`, `narrow`, `partCaps` | Effects in order, parts at the same time, capabilities that only narrow, and an abort. The kernel narrows the capabilities of each part by the contract of its kind |
| Errors | `Result`, `EvalError`, `Failure`, `failures` | An error value has a code, a reason, a place and a cause. An evaluation does not throw |
| The static kit | `walk`, `refsOf`, `mapRefs`, `check` | The documents of a document in linear time, its free references, and its problems before a run, each with its place and its JSON path. A check narrows the capabilities as a run does |
| The formula kit | `formulaMachine`, `FormulaProfile` | The shared constructs `lit`, `ref`, `record`, `list`, `let`, `fn`, `call`, `if`, `and`, `or`, and the namespaces `ops` and `ext`. A profile gives the rules of a language, for example how the errors of two parts combine. An address gives a thing, not its value |
| One meaning | `agree`, `reference`, `formulaDefinitions`, `generate` | A reference interpreter that compiles nothing, and `agree`, which compares a plan with it and with the second tier of a language. `generate` builds random documents from the kind contracts |

Each rule has an ID in [`docs/SPEC.md`](https://github.com/mark1russell7/coeval/blob/main/docs/SPEC.md), and each ID has a test. [The site](https://mark1russell7.github.io/coeval/) explains each idea with a live diagram.

## License

MIT
