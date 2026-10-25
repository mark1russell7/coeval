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
| Ladder | `ask` | The evaluator of a verb: the own entry, then the kind, then the default. Each verb has this ladder, also `deref` and `step` |
| References | `resolve`, `HostThing`, `Navigator` | A path from a root of the context: `self`, `names`, `world`, `event` or `caps`. A step document can have computed parts, and a walker can give the code of its failure. The optional `has` of a host thing tells a field that holds `undefined` from a missing field |
| Plans | `prepare`, `planner`, `evaluate`, `run`, `PrepareOptions`, `EvalOptions`, `EvaluateOptions`, `RunOptions` | A document compiles one time into code. An evaluator is a function or a compiler. The option `perform` of `evaluate` and `plan.evaluate` is a mock: it answers each effect at once. The option `verb` of `prepare`, `evaluate` and `run` asks the ladder for another verb than `eval`, for example `format` |
| The run side | `run`, `Runner`, `Perform`, `Effect`, `permits`, `narrow`, `partCaps` | Effects in order, parts at the same time, capabilities that only narrow, and an abort. The kernel narrows the capabilities of each part by the contract of its kind. Each effect has a stable `address` and its `outcome` |
| Record and replay | `recorder`, `replayer`, `ReplayLog`, `ReplayEntry`, `ReplaySettle`, `ReplayOptions`, `Journal`, `JOURNAL` | A recorder logs each effect of a run with its address and its outcome, and the order of the waits. A replayer answers each effect from the log, and a different request gives `#REPLAY!` |
| Errors | `Result`, `EvalError`, `Failure`, `failures` | An error value has a code, a reason, a place and a cause. An evaluation does not throw |
| The static kit | `walk`, `refsOf`, `mapRefs`, `check`, `CheckOptions` | The documents of a document in linear time, its free references, and its problems before a run, each with its place and its JSON path. A check narrows the capabilities as a run does, and it asks the hook `permits` of the machine. The hook `known` of a machine names the unknown operations. The option `verb` of `check` checks the evaluators of another verb. The option `types` also checks the value types. The option `run` finds a runner under a parent that cannot wait |
| The effects | `effectsOf`, `checkLatent`, `EffectsOptions` | The effects of a document that can reach the host: the declared effects, without the effects that a mask or a rule `only` removes. A host can grant exactly these capabilities. `checkLatent` compares the latent effects that a procedure declares with its body (D27) |
| The static facts | `factsOf`, `DocFacts`, `StaticRead`, `FactsOptions`, `KindFacts`, `LazyRule` | The reads of a document with a mark for each read under a lazy part, its side, its effects and the marks `pure` and `volatile`. The contracts and the hook `facts` of a machine declare them (D24). The option `verb` names the verb |
| Trees | `STD_WORLD` (`panel`, `box`), `nearestWalker` | The decorated tree: each field of a node is an attribute that evaluates on demand, one time in an evaluation. A sibling is a path through the parent, and a cycle gives `#CYCLE!` with its chain |
| The formula kit | `formulaMachine`, `FormulaProfile`, `formulaKnown`, `formulaFacts` | The shared constructs `lit`, `ref`, `record`, `list`, `let`, `fn`, `call`, `if`, `and`, `or`, and the namespaces `ops` and `ext`. A profile gives the rules of a language, for example how the errors of two parts combine. A language extends the kit through the merge. An address gives a thing, not its value |
| One meaning | `agree`, `reference`, `formulaDefinitions`, `STD_DEFINITIONS`, `generate`, `TierInput` | A reference interpreter that compiles nothing, and `agree`, which compares a plan with it and with the second tier of a language. Each tier gets the mock `perform` and the `verb` of `agree`. `generate` builds random documents from the kind contracts |
| Conformance | `conforms`, `ConformOptions`, `Finding`, `Obligation`, `ConformProbe` | The obligations of host code, examined for one evaluator or runner with probe parts and a probe runtime. Each finding names the obligation, the reason and a probe that shows it (D36) |
| Early cutoff | `sameResult` | A safe equality of two results for a schedule. Plain JSON compares by structure, and each other object only as itself. Two errors need the same code, reason and place |
| Reads | `verifyReads`, `Read`, `ReadsCheck`, `VerifyOptions` | The option `reads` of an evaluation records each path that it resolves, with what the path reached. `verifyReads` resolves each free read again in a new context, and it tells if the old result stays valid (D26) |
| Durability | `durable`, `Durable`, `DurableOptions`, `DurableCounts`, `Epochs` | A cache of plans, facts and results with one epoch for the structure and one for the data. A change of data compiles nothing. A pure document verifies its reads, and another document evaluates again (D30) |
| Schedules | `schedule`, `Schedule`, `ScheduleOptions`, `ScheduleCounts`, `NodeRunOptions`, `edgesOf`, `NodeEdge`, `NodeInfo` | A graph of named nodes under the root `world`: the edges from the static reads, the side of each node, and an evaluation on demand through `durable`. Each node of a cycle gives `#CYCLE!`, and a node on the run side is a sink (D31). A demand of the host first demands the nodes of its eager edges, deepest first, thus a long chain gives no `#DEPTH!` (D33) |
| The analysis of a graph | `components`, `heights`, `nodeLayers`, `necessary`, `cycles`, `NodeGraph`, `GraphNode`, `GraphEdge`, `GraphCycle`, `GraphOptions` | The strongly connected components, the heights of a push schedule, the layers of independent nodes, the nodes that an observer needs, and the certain and the possible cycles. Each function has its own stack, thus a chain of 100000 nodes does not overflow. The graph of a schedule is such a graph (D33) |
| Types | `ValueType`, `Domain`, `fits`, `member`, `typeIssues`, `join`, `typeText`, `STD_DOMAINS`, `extendDomain`, `DomainExtension` | Value types as JSON terms, for the checks of types. A language adds its base types as domains of its machine, each with a membership test, parents and the types of its steps. `unknown` fits each type, and each type fits it. `join` gives one type for two types, and `typeText` gives the text of a type. `extendDomain` adds parents or steps to a domain of another language through the merge |
| The check of types | `typeCheck`, `Typing`, `Typed`, `TypeRule`, `TypeInput`, `PartType`, `TypeProblem`, `Signature` | A check that synthesizes the type of each document and checks it against the type that its position needs. The type rule of an evaluator, the signatures of a formula profile, and `result` and `expect` of a contract give the types. A wrong type gives the static issue `#TYPE!`, and an evaluation does not change |
| The types of the roots | `RootTypes`, `CAPS_TYPE`, `typeFromSchema`, `typeFromSamples`, `TypeReading`, `SampleOptions` | The host gives the types of its names and of the roots in the option `rootTypes`. A reference then gets the type that its path reaches, and a missing field of a closed record gives `#TYPE!`. A host makes such a type from a JSON Schema or from sample values |

Each rule has an ID in [`docs/SPEC.md`](https://github.com/mark1russell7/coeval/blob/main/docs/SPEC.md), and each ID has a test. [The site](https://mark1russell7.github.io/coeval/) explains each idea with a live diagram.

## Check the code of a language

`conforms` examines the code of an evaluator or a runner against the obligations of host code, C1 to C8 of [`docs/SEMANTICS.md`](https://github.com/mark1russell7/coeval/blob/main/docs/SEMANTICS.md). Start it in a test for each name of your machine. An empty list means that the code conforms.

```ts
import { conforms, formulaDefinitions } from "@mark1russell7/coeval";

for (const name of Object.keys(machine.evaluators)) {
  expect(conforms(machine, name, { definitions: formulaDefinitions(profile) })).toEqual([]);
}
```

- The kinds of the world that name the code give the probe documents. For code under a namespace, for example `formula.op`, give the types in the option `types`.
- The option `values` adds values for a type, for example data that the contract does not describe.
- The option `definitions` gives the code for the reference. Then `conforms` also compares the compiled code with it.
- Each finding has a `probe`: the document, the result of each part, the waits and the capabilities. The probe shows one case that breaks the obligation.

## License

MIT
