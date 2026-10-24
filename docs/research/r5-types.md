# R5: types and abstract interpretation for `check`

This file is a research study for the kernel. It changes no rule. The coeval session decides which proposals go into `docs/ROADMAP.md` and `docs/DECISIONS.md`.

## The question

`check` (K3, `static.ts`) finds many problems before a run, but it knows no types of values. It cannot tell that `["ops", "add"]` gets a text, or that a reference reads a field that a record does not have. K2 promises "the contract of a kind: … its types". How does coeval add types to the contracts and find type errors in `check`? Three properties must stay true: D2 (names, not shapes), totality, and open languages that each bring their own value domains.

## The answer in short

1. A type check is an abstract interpretation of the plan. Each kind gets an abstract evaluator, its type rule. The ladder finds the rule by name with the verb `type`, thus D2 stays true.
2. The base types are open. A language registers its value domains, each with a membership test. The formula kit adds signatures to its table of operations.
3. `check` becomes bidirectional. A part synthesizes its type, or the contract of its parent gives the type that the part must have. The gradual type `unknown` is the default, thus a language without types gets no new issues.
4. The roots get types from the host: the types of the names, the schema of the world and the type of `self`. Each step of a path asks the type that the path reached, as D10 asks the thing.
5. STATIC.AGREES extends to types. In a traced evaluation of a document that checks, the value of each node is in the type that `check` gave it. EVAL.SEALED makes the test of each kind local.

## Two meanings of the word "type"

In coeval, the `type` of an envelope is the name of a kind (D6, D10). This study uses "value type" for a set of values that a result can have, for example "a number" or "a record with a text field `name`". The kind is a name that selects the evaluator. The value type is a claim that only `check` reads. A value type does not go into an envelope, and it does not change the result of an evaluation.

## Background

### Abstract interpretation

Cousot and Cousot define a static analysis as an evaluation of a program over abstract values that form a lattice ([Cousot and Cousot 1977](https://doi.org/10.1145/512950.512973)). An analysis is sound when each concrete result is in the concretization of the abstract result. A loop gives an equation, and its least fixed point is the result. A lattice with an infinite height, for example the intervals of numbers, needs a widening operator that makes the iteration stop ([Cousot and Cousot 1976](https://cs.nyu.edu/~pmc309/COUSOTpapers/ISOP76.shtml), [Cousot and Cousot 1992](https://doi.org/10.1007/3-540-55844-6_142)).

Cousot shows that a type is an abstract value, and a type rule is an abstract evaluator ([Cousot 1997](https://doi.org/10.1145/263699.263744)). Darais and others change only the monad of one definitional interpreter: one instance evaluates the program, and a second instance analyzes it ([Darais and others 2017](https://doi.org/10.1145/3110256)).

For coeval, a type check is the walk of the plan with abstract values. The formula kit has no loops and no recursion, because a binding of `let` does not see the other bindings (FORMULA.LET). Thus one pass from the leaves to the root gives the result, without widening. Only cycles need widening: circular attributes of the tree kit (R3 P6, L2f), or formulas of a reactive store that read each other.

### JSON Schema as types

JSON Schema describes a set of JSON values with keywords, for example `type`, `properties`, `required`, `items`, `anyOf` and `not` ([JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-core), [Pezoa and others 2016](https://doi.org/10.1145/2872427.2883029)). With dynamic references, validation is PSPACE-complete in the size of the schema ([Attouche and others 2024](https://arxiv.org/abs/2307.10034)). The inclusion of one schema in another schema is hard to decide, because of `not` and `anyOf`. Habib and others decide it through a canonical form, and found 43 bugs with it ([Habib and others 2021](https://doi.org/10.1145/3460319.3464796)).

JSON Schema describes values, not programs: it has no type of a function and no rule for an expression. For coeval, it is a good source of types, for example the inputs of procedures, but a bad type language for `check`. The keywords `type`, `properties`, `required`, `items`, `enum`, `const` and `anyOf` convert well, and the others convert to `unknown`.

### Structural types and row types

TypeScript compares object types by their members, not by their names ([TypeScript, Type Compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility.html)). A record with more fields is a subtype of a record with fewer fields (width subtyping). TypeScript is unsound on purpose at some points ([Bierman, Abadi and Torgersen 2014](https://doi.org/10.1007/978-3-662-44202-9_11)). Row types give a record type a variable for "the other fields" ([Wand 1987](https://lics.siglog.org/1987/Wand-CompleteTypeInferen.html)). Rémy gives each field a flag, present or absent, and keeps the inference of ML ([Rémy 1989](https://doi.org/10.1145/75277.75284)).

For coeval, value types are structural and kinds stay names. D2 forbids a guess of the kind from a shape, but it does not forbid a check of a shape. Record types need width subtyping and a closed form, as SHAPE.CLOSED. Only a generic operation that adds a field to a record needs a row variable.

### Gradual typing and its guarantees

Gradual typing mixes typed and untyped code in one program ([Siek and Taha 2006](http://scheme2006.cs.uchicago.edu/13-siek.pdf)). The unknown type `?` is consistent with each type. Consistency is not transitive, thus `?` does not make each program check. A cast at each boundary tests the value at run time, and a failed cast blames the boundary ([Wadler and Findler 2009](https://doi.org/10.1007/978-3-642-00590-9_1)).

Siek and others state two gradual guarantees ([Siek and others 2015](https://doi.org/10.4230/LIPIcs.SNAPL.2015.274)). A less precise type does not add a static error. A less precise type does not change the result of a run that succeeds. Garcia, Clark and Tanter derive gradual typing from abstract interpretation: `?` is the abstraction of the set of all static types ([Garcia, Clark and Tanter 2016](https://doi.org/10.1145/2837614.2837670)). Casts have a cost at run time ([Takikawa and others 2016](https://doi.org/10.1145/2837614.2837630)).

For coeval, `unknown` is the type of each part that no contract types. A language without types gets no new issues, and this is the static guarantee. The membership test of a domain is the cast.

### Occurrence typing

Typed Racket narrows the type of a variable in each branch of a test ([Tobin-Hochstadt and Felleisen 2008](https://doi.org/10.1145/1328438.1328486)). The type of a predicate tells what a true result proves, and what a false result proves ([Tobin-Hochstadt and Felleisen 2010](https://doi.org/10.1145/1863543.1863561)). TypeScript does the same with `typeof` and with type predicates ([TypeScript, Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)).

For coeval, an `if` whose test applies a predicate operation to a reference narrows the type of that path in `then` and in `else`. The signature of the operation declares what it proves.

### Bidirectional type checking

Bidirectional checking gives each rule two modes ([Pierce and Turner 2000](https://doi.org/10.1145/345099.345100), [Dunfield and Krishnaswami 2021](https://doi.org/10.1145/3450952)). In the synthesis mode, a term gives its type. In the checking mode, the context gives the type that the term must have. A function without annotations checks against an expected function type, which gives the types of its parameters. Local type inference finds the type arguments of a generic call from its arguments, without global unification. Hazel makes the check total: an ill-typed term becomes a marked hole, and the check continues ([Zhao and others 2024](https://doi.org/10.1145/3632910), [Omar and others 2019](https://doi.org/10.1145/3290327)).

For coeval, a part shape tells where a part is, thus it can also tell the type that the part must have. The type rule of a kind gives the type of its result. A part with an issue gets the type `unknown`, thus one error does not give a chain of errors.

### Refinement types

A refinement type is a base type with a predicate, for example `{ v: number | v >= 0 }` ([Freeman and Pfenning 1991](https://doi.org/10.1145/113445.113468)). Liquid types infer the predicates from a set of qualifiers with an SMT solver ([Rondon, Kawaguchi and Jhala 2008](https://doi.org/10.1145/1375581.1375602)). For coeval, SHAPE.DATA already refines data with `min`, `max`, `whole` and `one`. An interval domain for numbers is the cheap form. A solver does not fit in `check`, because `check` must stay small, fast and total.

### Type and effect systems

Lucassen and Gifford give each expression a type and an effect, and a function type carries its latent effect ([Lucassen and Gifford 1988](https://doi.org/10.1145/73560.73564)). Talpin and Jouvelot infer types, regions and effects together ([Talpin and Jouvelot 1992](https://doi.org/10.1017/S0956796800000393), [Talpin and Jouvelot 1994](https://doi.org/10.1006/inco.1994.1046)).

For coeval, the judgment of `check` becomes "the document has the value type T and the effects E". K8 (D14) and R2 P3 (K18) give E from `effects` and from the capability rules of the contracts. A procedure in the world gets a type with its input, its output and its latent effects. The `fn` of the formula kit is pure (R2, question 3), thus its function types have no effects.

### Types from data

An F# type provider makes types at compile time from an external schema or from samples ([Syme and others 2013](https://doi.org/10.1145/2429376.2429378), [Petricek, Guerra and Syme 2016](https://doi.org/10.1145/2908080.2908115)). For coeval, a provider gives the type of the root `world` from a store schema, from the JSON Schema of a procedure or from samples. A classifier is the same idea for kinds (CLASSIFY.*). A shape can propose a type for a check, but the ladder does not read it.

### How language workbenches type a language

Scope graphs model the names of a program with scopes, declarations, references and edges to a parent scope ([Néron and others 2015](https://doi.org/10.1007/978-3-662-46669-8_9)). Statix, in Spoofax, writes a type system as constraints over a scope graph ([van Antwerpen and others 2016](https://doi.org/10.1145/2847538.2847543)). A declaration carries a type, and a record type is a scope with its fields as declarations ([van Antwerpen and others 2018](https://doi.org/10.1145/3276484)). The solver asks a query only when no later edge can change its answer ([Rouvoet and others 2020](https://doi.org/10.1145/3428248)).

JastAdd writes type analysis as attributes: a synthesized attribute `type()`, and inherited attributes that find the declaration of a name ([Ekman and Hedin 2007](https://lup.lub.lu.se/record/772748)). In JetBrains MPS, overloaded operation rules give the result type of a binary operation from the types of its operands ([MPS, Typesystem](https://www.jetbrains.com/help/mps/typesystem.html)).

For coeval, the scope rules of a contract (K2) already build a scope graph, and `sequential` makes a chain of scopes. A type on each declaration gives the types of names. A table of signatures for `ops.*` is the table of overloaded operation rules. An attribute `type` and an inherited attribute `expected` give the bidirectional check as an attribute grammar, which the tree kit of R3 can evaluate.

## How coeval relates today

| Idea | coeval today | Where |
| --- | --- | --- |
| Types of data | `text`, `number` with limits, `one`, `required` and `closed` | `world.ts` (`Shape`), SHAPE.DATA, SHAPE.CLOSED |
| Syntactic sorts | A term shape names the kinds that it permits | SHAPE.KINDS |
| A scope graph | Scope rules: `fixed`, `keysAt`, `listAt`, `textAt`, `headers` and `sequential` | `world.ts` (`ScopeRule`), STATIC.SEQ |
| Effects | `side`, `effects` and the capability rules (`caps`) of K8 | STATIC.CAP, STATIC.NARROW, D14 |
| Untyped operations | The profile maps a name to a host function | `formula.ts` (`FormulaProfile.ops`) |
| A cast after an operation | The `check` of a profile tests each result, for example "finite" | `formula.ts` (`FormulaProfile.check`) |
| Open values | A value is any value of the host | D13, VALUE.ANY |
| Agreement | One example test | STATIC.AGREES |

Five facts follow from the code.

1. **`check` misses each error of a value type.** An operation that gets a text for a number passes `check`. So do a `call` whose `fn` is not a function, and an `if` whose test is not a truth value. Each one gives `#VALUE!` in an evaluation. A missing field gives `#N/A`.
2. **An unknown operation passes `check`.** The namespace `ops` has a fallback kind, thus `["ops", "nope"]` names a kind with an evaluator. The evaluation gives `#NAME?`, a code that `check` lists. This breaks the letter of STATIC.AGREES, and `ext` has the same gap.
3. **The kit does not declare all of its contracts.** The contract of `fn` lists `params` in `required`, but it gives no shape for it. Thus `"params": [1]` passes `check` and fails with `#VALUE!`. SHAPE.DISTINCT can express the rule today.
4. **`check` does not know the arity of an operation.** A signature gives the arity, the types and the names of the operations in one table.
5. **A language keeps its own types.** The formula language over the positions of a space declares the kinds of the parameters and of the result of each operation. Each of its value domains has a membership test, and its compiler tier reads the kinds. D13 wanted one copy of such machinery.

## Proposals, ranked by value for effort

| Rank | Proposal | Effort | Value |
| --- | --- | --- | --- |
| P1 | Close the gaps of names: operations, extensions and `fn` | S | High: it repairs STATIC.AGREES with no new concept |
| P2 | Value types and value domains | S | High, as the base of each later proposal |
| P3 | Signatures of operations and a bidirectional `check` | M | High: the most frequent errors of a formula |
| P4 | Types of the roots, of names and of paths | M | High: missing fields and wrong reads of a store |
| P5 | The agreement rule and its property tests | M | High: it makes each claim of `check` true |
| P6 | Narrowing in `if`, `and` and `or` | S to M | Medium |
| P7 | Casts at the boundaries of `unknown` | M | Medium: agreement for documents with some types |
| P8 | Types of the run side: procedures, steps and effects | M | Medium to high for the program format of procedures |
| P9 | Generic signatures and functions as arguments | M | Medium, for operations that take a function |
| P10 | Intervals with widening, and type rules as documents | L | Low today |

### P1: close the gaps of names

- **What.** A machine gets an optional hook `known(path)`. The formula kit gives it from the profile: a name of `ops.*` or `ext.*` is known when the profile has it. `check` reports an unknown name with `#NAME?` and its place. The contract of `fn` declares `params` as a distinct list of texts.
- **Kernel parts.** `Machine` in `evaluate.ts`, `formulaMachine` and `formulaKinds` in `formula.ts`, and `check`.
- **Risk.** A profile can give `ops` as a function. `check` then uses it for each name, thus the function must be pure.
- **Test.** A new ID STATIC.KNOWN: `["ops", "nope"]` gives `#NAME?` in `check`. A case of FORMULA.FN checks `"params": [1]`.

### P2: value types and value domains

- **What.** A value type is a JSON term (the sketch follows P4). A text names a base type, and the set of base types is open. The kernel has `unknown`, `never`, `null`, `bool`, `number` and `text`. A language adds its domains, for example a point, each with its membership test `is`.
- **The relation.** `fits(found, expected)` decides each check. `unknown` fits each type, and each type fits `unknown`. A base type fits itself and the parents that its domain names (`under`). Lists are covariant, records have width subtyping unless they are closed, and functions are contravariant in their parameters.
- **Kernel parts.** A new module `types.ts`, and `Machine.domains`.
- **Risk.** Each claim of `check` depends on `fits`. A wrong rule makes `check` unsound.
- **Test.** New IDs TYPE.FITS and TYPE.MEMBER. `fits` is reflexive, and transitive for types without `unknown`. A member of `found` is a member of each type that `found` fits.

### P3: signatures of operations and a bidirectional `check`

- **What.** `FormulaProfile.sigs` gives each operation a signature, or a list of overloads. A part shape gets `expect`: the type that the part must have. A kind gets `result`: the type of its result when it is fixed. A kind can also name a type rule with the verb `type`.
- **The ladder.** The rule of a kind comes from the ladder, as `eval` does: an own entry, then the kind, then `world.defaults.type`. The default rule reads `result` and `expect`, or else gives `unknown`. An overload selects a type for the check, not an implementation. Thus D2 stays true, and a plan with types gives the same values as a plan without types.
- **The pass.** `check` gets one more visit for each document, in post-order with an explicit stack, thus STATIC.LINEAR stays true. A tool can read the type of each place, for example the explorer of the site.
- **The rules of the kit.** `lit`, `record` and `list` synthesize. `let` gives each name the type of its binding. Under the strict profile, `if` checks `test` against `bool`. It joins the types of the branches.
- **The rules of calls.** Each `ops.*` checks its arguments against its signature. `call` checks `fn` against a function type. `fn` checks against an expected function type, or gives its parameters `unknown`.
- **Issues.** A type issue keeps the code of the evaluation, for example `#VALUE!`, and adds `expected` and `found`. A part with an issue gets the type `unknown`, as a marked hole of Hazel.
- **Risk.** The profile changes the rules. A JavaScript truth (`jsTruthy`) accepts each type as a test, `logic: "value"` gives the union of the terms, and `omit` makes fields optional. P5 tests each combination.
- **Test.** A new ID STATIC.TYPES, with one document for each rule of the kit.

### P4: types of the roots, of names and of paths

- **What.** `CheckOptions.types` gives the type of each root: `names`, `self`, `event` and `world`. The type of `world` can be a function from a path to a type, as a type provider. A scope rule gives a type to its names. `keysAt` gives the type of the part at the key, and `headers` the type of the step. A new source `"previous"` gives `last` the type of the step before.
- **Paths.** Each step asks the type that the path reached. A record type gives the type of its field, and a list type the type of its items. A domain can give the types of its steps, for example the moves of a position. A field that a closed record does not have gives `#N/A`.
- **Providers.** `typeFromJsonSchema` converts the subset of JSON Schema above. `typeFromSamples` joins the types of sample values.
- **Risk.** A store schema can be wrong. P7 finds such a value at run time.
- **Test.** New IDs STATIC.ROOTS and STATIC.FIELD.

### A sketch of typed contracts

```ts
/** A value type. A text names a base type: a domain of the language, "unknown" or "never". */
export type ValueType =
  | string
  | { readonly list: ValueType }
  | { readonly record: Readonly<Record<string, ValueType>>; readonly optional?: readonly string[]; readonly closed?: boolean }
  | { readonly fn: readonly ValueType[]; readonly to: ValueType }
  | { readonly union: readonly ValueType[] }
  | { readonly one: readonly Json[] }
  | { readonly var: string };

/** A value domain of a language: its membership test, its parents and the types of its steps. */
export interface Domain {
  readonly is: (value: unknown) => boolean;
  readonly under?: readonly string[];
  readonly steps?: Readonly<Record<string, ValueType>>;
}

/** The signature of an operation. In a list of overloads, the first that fits wins. */
export interface Signature {
  readonly params: readonly ValueType[];
  readonly rest?: ValueType;
  readonly to: ValueType;
  /** The type that a true result proves of the first argument (P6). */
  readonly proves?: ValueType;
}

// New optional fields:
//   Shape (term, list, map, a field of a record): expect?: ValueType
//   Kind: result?: ValueType, and verbs.type: the name of a type rule
//   NamesSource: type?: ValueType | "part" | "previous"
//   Machine: domains?: Record<string, Domain>, typers?: Record<string, TypeRule>, known?: (path) => boolean
//   FormulaProfile: sigs?: Record<string, Signature | readonly Signature[]>
//   CheckOptions: types?: { names?, self?, event?, world? }
```

The signatures of the example below:

```json
{
  "add": { "params": ["number", "number"], "to": "number" },
  "gt": { "params": ["number", "number"], "to": "bool" },
  "concat": { "params": ["text"], "rest": "text", "to": "text" },
  "count": { "params": [{ "list": "unknown" }], "to": "number" },
  "upper": { "params": ["text"], "to": "text" },
  "isText": { "params": ["unknown"], "to": "bool", "proves": "text" }
}
```

### A typed check of one example

The store schema gives the type of `world`:

```json
{
  "record": {
    "order": {
      "record": { "price": "number", "note": "text", "items": { "list": { "record": { "sku": "text", "qty": "number" } } } },
      "optional": ["note"],
      "closed": true
    }
  }
}
```

The document:

```json
{
  "type": "let",
  "value": {
    "bind": {
      "n": { "type": ["ops", "count"], "value": [{ "type": "ref", "value": ["world", "order", "items"] }] },
      "price": { "type": "ref", "value": ["world", "order", "price"] }
    },
    "body": {
      "type": "if",
      "value": {
        "test": { "type": ["ops", "gt"], "value": [{ "type": "ref", "value": ["names", "n"] }, 3] },
        "then": { "type": ["ops", "concat"], "value": ["Bulk order: ", { "type": "ref", "value": ["names", "price"] }] },
        "else": { "type": ["ops", "upper"], "value": [{ "type": "ref", "value": ["world", "order", "notes"] }] }
      }
    }
  }
}
```

Today `check` gives no issue for this document. The typed check visits each place:

| Place | Mode | Expected | Found | Result |
| --- | --- | --- | --- | --- |
| `["bind", "n", 0]` | check | `{ "list": "unknown" }` | a list of records | fits |
| `["bind", "n"]` | synthesis | | `number` | the type of the name `n` |
| `["bind", "price"]` | synthesis | | `number` | the type of the name `price` |
| `["body", "test", 0]` | check | `number` | `number`, from the scope | fits |
| `["body", "test"]` | check | `bool` (strict profile) | `bool` | fits |
| `["body", "then", 1]` | check | `text` | `number` | `#VALUE!` |
| `["body", "else", 0]` | synthesis | | no field `notes` | `#N/A`, then `unknown` |
| `["body"]` | synthesis | | `text`, the join of the branches | |

The two issues:

```json
[
  {
    "code": "#VALUE!",
    "place": ["body", "then", 1],
    "at": ["value", "body", "value", "then", "value", 1],
    "reason": "Argument 2 of ops.concat is a number. The operation expects a text.",
    "expected": "text",
    "found": "number"
  },
  {
    "code": "#N/A",
    "place": ["body", "else", 0],
    "at": ["value", "body", "value", "else", "value", 0, "value", 2],
    "reason": "The record at world.order has no field notes. Its fields are price, note and items."
  }
]
```

The reference with the issue gets `unknown`, thus `upper` gives no second issue. With the correct field `note`, the type is an optional `text`. A read of it can give `#N/A`, and open question 1 decides if that is an issue. An `if` with the test `isText` removes the doubt (P6).

### P5: the agreement rule and its property tests

- **The rule.** A document checks with no issue under the root types `R`. A context has roots that are members of `R`. Then a traced evaluation (PLAN.TRACE) obeys three clauses:
  1. Each node that gives a value gives a member of the type of its place.
  2. Each operation gets arguments that are members of its parameter types.
  3. No node gives a type error of the kernel. These are `#NAME?` of an operation, `#VALUE!` of a `call` or a test, and `#N/A` of a closed record.
- **The obligations of a language.** Each `is` has no false positives. Each operation gives a member of its result type. Each type rule of code is sound for its kind.
- **The local test.** EVAL.SEALED says that a part can change to a part with the same result. Thus a test changes each part of a kind to a `lit` of a sample of its type, and evaluates the kind. The result must be a member of the synthesized type. When each kind passes, the whole check is sound by induction on the tree.
- **The generators.** The generator of K9 (R1 P1) reads the contracts. A typed generator selects, at each position, a kind whose result fits the expected type. A test kit gives samples for each domain.
- **The gradual guarantee.** A test changes a random type of a contract or a root to `unknown`. The issues must not grow in number.
- **Totality and precision.** `check` gets random JSON, and it must not throw. The share of type issues where the evaluation really fails is a measure that a CI job reports, not a rule.
- **Kernel parts.** A new ID STATIC.TYPES-AGREE, and a helper that a language can import, next to `agree` of K9.
- **Risk.** A weak generator gives false confidence. The harness counts how many times it reaches each kind and each signature.

### P6: narrowing in `if`, `and` and `or`

- **What.** A test that applies an operation with `proves` to a reference narrows the type of that path in `then`, and the reverse in `else`. `and` narrows its later terms. A test of presence narrows an optional field. A path with a computed step does not narrow.
- **Risk.** A host thing can give two different values to two reads of one path. On the run side, a step with an effect can change the world, thus a narrowing ends at that step.
- **Test.** A new ID STATIC.OCCURRENCE.

### P7: casts at the boundaries of `unknown`

- **What.** `check` records each boundary: a part of type `unknown` at a position with a known type, or a read from a typed root. With an option `guards`, `prepare` adds a membership test at each boundary. A failed test gives `#VALUE!` at the boundary, and blames it.
- **Value.** The agreement rule then holds for a document with some types, and for a store whose values do not obey its schema.
- **Kernel parts.** `PrepareOptions`, `compileNode` and `types.ts`.
- **Risk.** A test of a deep record takes time. Without the option, a plan has no guard, thus PLAN.COMPILE-SPEED and FORMULA.SPEED stay true.
- **Test.** A new ID PLAN.GUARD: a store value against its schema gives `#VALUE!` at the reference.

### P8: types of the run side

- **What.** A procedure in the world gets a type: its input from its JSON Schema, its output and its latent effects. The check of a call checks its value against the input, and gives the output. A `seq` gives each named step its type for the later steps, and `last` the type of the step before. The effects come from K8 and K18.
- **Test.** A step that reads a field that the output of an earlier call does not have gives `#N/A` in `check`.

### P9: generic signatures and functions as arguments

- **What.** A signature can have type variables. For example, `map` takes a list of `A` and a function from `A` to `B`, and gives a list of `B`. Local type inference first synthesizes the arguments that are not functions. Then it checks each `fn` against its expected function type, which gives the types of its parameters.
- **Risk.** The order of the arguments decides what the check can find. A variable without a solution becomes `unknown`.

### P10: intervals with widening, and type rules as documents

- **What.** Numbers get intervals from the limits of SHAPE.DATA, thus `check` can find a size that can be negative. A cycle needs a fixed point with widening: after some rounds, a bound goes to infinity and a type goes to `unknown`. A type rule can also be a document (D1), and the tree kit of R3 evaluates it as an attribute.
- **Why later.** No language has the cycles yet, and a rule of code is enough for the kit.

## Open questions

1. Is a possible failure an issue? Today each issue of `check` is certain when the evaluation reaches its place. An optional field gives only a possible `#N/A`. `Issue` can get a field `certain`, or `check` can report only certain issues.
2. Does a type issue keep the code of the evaluation, or does it get a new code `#TYPE!`? The code of the evaluation obeys STATIC.CHECK, and a new code is easy to filter.
3. Are value types documents in envelopes, so that the site can draw them (D8)? This study uses a compact JSON term to keep them apart from kinds.
4. Does a type rule live in the contract as data, or in the machine as code? The proposals use both, and the local test of P5 must cover each rule of code.
5. Does a language with domains get a strict mode that reports each part without a type?
6. Is a record of a store schema closed by default? A closed record finds a wrong field, and an open record accepts a new field of the store.
