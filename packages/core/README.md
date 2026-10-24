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
| Documents | `isEnvelope`, `stored`, `typePath`, `docEquals` | The envelope, the keys of a store beside it, and the equality of documents. A host value, for example a date, is equal only to itself |
| Parts | `partsOf`, `splitParts` | The kind and the parts of one document, with the declared type for a bare value. The plan, the reference and the static kit use it |
| World | `lookupKind`, `Kind`, `Namespace`, `PartShape`, `ScopeRule`, `CapsRule` | The kinds, with their contracts: the shape of the parts, the type of the data, the kinds that a position permits, the names that a kind binds, the capabilities that it gives its parts, and its effects. A namespace can have a fallback kind |
| Merges | `mergeWorlds`, `mergeMachines`, `MergeError`, `restrictWorld`, `restrictMachine` | The one merge of worlds and machines. Equal entries merge, and namespaces merge key by key. Each other clash is a conflict, unless the later part names its path in `replaces`. A restriction removes entries and their code. [`docs/COMPOSITION.md`](https://github.com/mark1russell7/coeval/blob/main/docs/COMPOSITION.md) shows each mode of composition |
| Ladder | `ask` | The evaluator of a verb: the own entry, then the kind, then the default |
| References | `resolve`, `HostThing`, `Navigator` | A path from a root of the context: `self`, `names`, `world`, `event` or `caps`. A step document can have computed parts, and a walker can give the code of its failure |
| Plans | `prepare`, `planner`, `evaluate`, `run` | A document compiles one time into code. An evaluator is a function or a compiler |
| The run side | `run`, `Runner`, `permits`, `narrow`, `partCaps` | Effects in order, parts at the same time, capabilities that only narrow, and an abort. The kernel narrows the capabilities of each part by the contract of its kind |
| Errors | `Result`, `EvalError`, `Failure`, `failures` | An error value has a code, a reason, a place and a cause. An evaluation does not throw |
| The static kit | `walk`, `refsOf`, `mapRefs`, `check` | The documents of a document in linear time, its free references, and its problems before a run, each with its place and its JSON path. A check narrows the capabilities as a run does. The hook `known` of a machine names the unknown operations |
| Trees | `STD_WORLD` (`panel`, `box`), `nearestWalker` | The decorated tree: each field of a node is an attribute that evaluates on demand, one time in an evaluation. A sibling is a path through the parent, and a cycle gives `#CYCLE!` with its chain |
| The formula kit | `formulaMachine`, `FormulaProfile`, `formulaKnown` | The shared constructs `lit`, `ref`, `record`, `list`, `let`, `fn`, `call`, `if`, `and`, `or`, and the namespaces `ops` and `ext`. A profile gives the rules of a language, for example how the errors of two parts combine. A language extends the kit through the merge. An address gives a thing, not its value |
| One meaning | `agree`, `reference`, `formulaDefinitions`, `STD_DEFINITIONS`, `generate` | A reference interpreter that compiles nothing, and `agree`, which compares a plan with it and with the second tier of a language. `generate` builds random documents from the kind contracts |

Each rule has an ID in [`docs/SPEC.md`](https://github.com/mark1russell7/coeval/blob/main/docs/SPEC.md), and each ID has a test. [The site](https://mark1russell7.github.io/coeval/) explains each idea with a live diagram.

## License

MIT
