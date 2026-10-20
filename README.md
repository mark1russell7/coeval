# coeval

[![CI](https://github.com/mark1russell7/coeval/actions/workflows/ci.yml/badge.svg)](https://github.com/mark1russell7/coeval/actions/workflows/ci.yml) [![site](https://img.shields.io/badge/site-live%20diagrams-2346c4)](https://mark1russell7.github.io/coeval/) [![license](https://img.shields.io/badge/license-MIT-2346c4)](./LICENSE)

coeval is a base for declarative languages. Each language keeps its programs as JSON documents. A document gets its meaning from a question, not from a definition: its kind names the evaluator, and a ladder finds it.

**[The site](https://mark1russell7.github.io/coeval/)** explains each idea with a live diagram. The diagrams use the model package of this repository, thus each answer comes from real code.

## Status

The project is in the design stage. The model package is small, and its API changes without notice. The packages are not on npm. The plan is in [`docs/ROADMAP.md`](./docs/ROADMAP.md), and the decisions are in [`docs/DECISIONS.md`](./docs/DECISIONS.md).

## The model in six rules

1. **A program is a document.** It is a value in an envelope: `{ "type": "add", "value": [2, 3] }`. The type names a kind.
2. **A question finds the meaning.** The answer comes from the own entry of the document, then from its kind, then from the default.
3. **An evaluator evaluates its parts, and does not look inside them.** Thus equal parts can replace each other.
4. **A context is the only door.** A term reaches outside itself through five parts: names, focus, world, event and capabilities.
5. **Order has a meaning only for effects.** Pure work runs in any order that obeys its data. Effects keep their written order.
6. **A reference is a path from a root of the context.** Each step is a question to the thing that the path reached. A type is a path into the world.

## Packages

| Package | Contents |
| --- | --- |
| [`@mark1russell7/coeval`](./packages/core) | The model: envelopes, the ladder, sealed parts, the evaluation with its trace, error values, a small standard world, the order of a sequence and the parts of a context |
| [`@coeval/site`](./packages/site) | The site: a visual grammar where each concept has one glyph, a guide that adds glyphs one page at a time, and a playground. GitHub Pages serves it. |

## Commands

```sh
pnpm install
pnpm typecheck                       # the source and the tests of each package
pnpm test                            # the tests of each package
pnpm lint:ste                        # the writing rules
pnpm --filter @coeval/site dev       # the site, with the dev server of Astro
pnpm package add <name> --preset=ts  # make a new package
```

## Writing style

The prose of this repository follows ASD-STE100 Simplified Technical English (STE). STE is a style target. ASD does not certify this repository. The project glossary is in `ste.config.json`. Keep a local copy of the STE dictionary in `.ste/`, and do not commit it.

## Disclosure

An AI model (Claude, from Anthropic) wrote most of the text and the code of this repository, under the direction of the author. The STEMG of ASD-STE100 asks for this disclosure in its white paper on STE and artificial intelligence (June 2026).

## License

MIT. Refer to [`LICENSE`](./LICENSE).
