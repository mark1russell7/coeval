# The composition of languages

This page tells how two languages compose in coeval. The modes come from [Erdweg, Giarrusso and Rendel (2012)](https://doi.org/10.1145/2427048.2427055), through the study [R6](research/r6-workbenches.md). Each mode has a requirement ID in [`SPEC.md`](SPEC.md) and a test in `packages/core/src/compose.test.ts`. Each test evaluates its documents with `prepare`, examines them with `check`, and compares the plan with the reference interpreter through `agree`.

| Mode | ID | Today |
| --- | --- | --- |
| Extension | COMPOSE.EXTEND | It works. |
| Restriction | COMPOSE.RESTRICT | It works, with `restrictMachine` (version 0.6.1). |
| Unification | COMPOSE.UNIFY | It works. Two machines from `formulaMachine` with equal profiles merge (K41, D46). |
| Self-extension | COMPOSE.SELF-EXTEND | A host merges kinds that a document gives as data. An evaluator that is a document waits for K40. |
| Extension unification | COMPOSE.EXTEND-UNIFY | It works. |
| Incremental extension | COMPOSE.INCREMENTAL | It works. |
| Conflict | COMPOSE.CONFLICT | It works. No modular check finds a conflict before the merge. |

## The languages of the examples

The base is the formula kit with the operations `add` and `mul`. The extension `STATS` adds the kind `mean`, the alias `avg` and the operation `ops.twice`. The extension `TEXT` adds the kind `upper` and the operation `ops.join`. The two extensions do not know each other.

## Extension

A language adds kinds, aliases and operations to a base. The base does not change, and it does not know the extension.

```ts
const stats = mergeMachines(formulaMachine(profile), STATS);
prepare(stats, { type: "avg", value: [{ type: ["ops", "add"], value: [1, 2] }, 5] }).evaluate(); // 4
```

## Restriction

A language removes kinds and their code from a base with `restrictMachine`. A path names an entry as `replaces` names it. In this example, the language has no `fn` and no `call`. Thus each document stops, as in JsonLogic.

```ts
const total = restrictMachine(base, [
  ["world", "kinds", "fn"],
  ["world", "kinds", "call"],
  ["evaluators", "formula.fn"],
  ["evaluators", "formula.call"],
]);
check(total, { type: "fn", value: { params: ["x"], body: 1 } }); // #KIND?
```

Remove the code too. An own entry names an evaluator directly. Thus this document applies a function in a world without the kind `call`:

```json
{ "type": "record", "own": { "eval": "formula.call" }, "value": { "fn": { "type": "ref", "value": ["names", "f"] } } }
```

Three more restrictions work through the contracts. The path `["world", "kinds", "ops", "fallback"]` closes the namespace of the operations. The field `kinds` of a term shape permits fewer kinds at a position. The rule `mask` in `Kind.caps` gives a part no capabilities.

## Unification

Two independent languages merge. Their equal kinds and their shared code give one entry, in each order. Glue joins the two languages: an alias, or a kind whose part declares a type of the other language.

```json
{
  "type": "concat",
  "value": ["n=", { "type": "show", "value": { "type": "plus", "value": [1, { "type": "len", "value": "abc" }] } }]
}
```

This document gives `"n=4"`. The kinds `concat` and `str` come from one language. The kinds `sum` and `num` come from the other language. Both languages give the kind `show` with the same contract and the same code. The glue gives the alias `plus` and the kind `len`.

Two languages can each build the formula kit. Equal profiles give the same evaluators and the same hooks of the kit (D46). Thus the two machines merge, in each order, and the result is the machine of the kit with both languages.

```ts
const unified = mergeMachines(formulaMachine(profile, STATS), formulaMachine(profile, TEXT));
// The same machine as mergeMachines(formulaMachine(profile), STATS, TEXT)
```

Two profiles are equal when they have the same fields that the kit reads. A function, a record and a host value are equal only to themselves, and two lists are equal by their items. Thus a profile in a new object with the same fields gives the same kit. Two profiles that differ, for example in `otherwise` or in a function `truthy`, give a conflict at each evaluator name of the kit. The kit of one language then replaces the kit of the other language with `replaces`.

You can also build the kit one time, and add each language as a part. This gives the same machine.

## Self-extension

In SugarJ, a program extends its own language. In coeval, a document can give kinds as JSON, and the host merges them into the machine. Each verb must name an evaluator of the machine.

```json
{
  "kinds": {
    "plus": { "type": "ref", "value": ["world", "ops", "add"] },
    "pair": { "verbs": { "eval": "formula.list" }, "parts": { "shape": "list", "of": "lit" } }
  }
}
```

A document alone cannot bring code. An own entry that names an unknown evaluator gives `#NOEVAL`. In one document, `let`, `fn` and `call` give a name to a function. This is an abstraction, not a new kind.

An evaluator is code today: a function or a compiler. K40 proposes an evaluator that is a formula document (D1). A language is then data only. The open question 6 of R6 comes first.

## Extension unification

Two extensions of one base compose without glue. Each order of the parts gives the same machine (WORLD.LAWS). Both extensions add to the namespace `ops` of the kit, and the fallback of the kit stays.

```ts
const both = mergeMachines(base, STATS, TEXT); // the same machine as mergeMachines(base, TEXT, STATS)
```

```json
{
  "type": ["ops", "join"],
  "value": [
    { "type": "upper", "value": { "type": "ref", "value": ["names", "s"] } },
    "=",
    { "type": ["ops", "twice"], "value": [{ "type": "mean", "value": [1, 5] }] }
  ]
}
```

When the name `s` holds `"ab"`, this document gives `"AB=6"`.

## Incremental extension

A language extends an extension. A part that is a function of the merge before it (`prev`) reads the entry that it replaces, and it can wrap that entry.

```ts
const later = mergeMachines(stats, (prev) => ({
  evaluators: { "stats.mean": rounded(prev.evaluators["stats.mean"]) },
  replaces: [["evaluators", "stats.mean"]],
}));
```

A host can merge a language into a machine at run time. A plan keeps the machine that it compiled against. A new plan uses the new machine.

## Conflict

Two extensions can each compose with the base, and still conflict together. The merge throws one `MergeError` when the host builds the machine, before a document evaluates.

```ts
mergeMachines(base, STATS, RIVAL);
// MergeError: ["world","kinds","mean"], ["world","kinds","ops","kinds","twice"], ["evaluators","stats.twice"]
mergeMachines(base, STATS, { ...RIVAL, replaces: paths }); // RIVAL wins at each path
```

The path of each conflict is the mark `replaces` that resolves it. No modular check finds the conflict before the merge. [Schwerdfeger and Van Wyk (2009)](https://doi.org/10.1145/1542476.1542499) give such a check for grammars. The language format of K37 declares the names that each language owns, and a check can use them.
