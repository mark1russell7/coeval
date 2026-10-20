# Instructions for Claude

## Writing style

Write all prose of this repository in the style of ASD-STE100 Simplified Technical English (STE). This prose is the README files, this file, the TSDoc comments and the text that the site shows. The linter [`ste-lint`](https://github.com/mark1russell7/ste-lint) examines it.

- After a change to prose, start `pnpm lint:ste` and correct each finding. CI fails when there is an error.
- Keep each instruction to 20 words or fewer, and each description to 25 words or fewer.
- Do not use the modal verbs (`should`, `may`, `might`, `would`), semicolons or Latin abbreviations (`e.g.`, `i.e.`, `etc.`).
- Use the active voice. Start each sentence of a doc comment with its subject: "This function returns the value", not "Returns the value".
- Put code, file names and commands in code font. The linter counts each code span as one word.
- Add a word to the glossary in `ste.config.json` only if it is a real technical term of the project.

## Packages

- Make a new package with `pnpm package add <name> --preset=<preset>`. Do not write `package.json` or `tsconfig.json` by hand.
- A package is a source package. Its `main` is `src/index.ts`, so other packages import its source.
- Each package has a `tsconfig.test.json`. `pnpm typecheck` checks the source and the tests.

## A public repository

- This repository is public. Do not name the private projects of the owner in it. Describe an idea in general terms.
- Run long and heavy work in CI. Locally, run only the checks of one package.

## The plan

- `docs/ROADMAP.md` is the one list of the open work. Keep it current.
- Record each decision in `docs/DECISIONS.md`. The page `design/decisions` of the site gives a summary.
- The roadmap tracker is the folder `~/git/fleet/artifacts/coeval`. Change the tracker and `docs/ROADMAP.md` together.

## The site

- Each idea has one page and one live diagram. A diagram uses `@coeval/core`, so each answer comes from real code.
- Each color of a diagram has one meaning, and a label or a shape goes with it. The tokens are in `diagrams.css`.
- Each diagram works with a keyboard, in the light and the dark theme, at the width of a phone, and with reduced motion.

## npm releases

- Do not publish to npm, and do not change npm settings. The owner and one named Claude session do all npm work.
- Do not edit `.github/workflows/release.yml` or `scripts/release/`.
- Is a package that is not on npm a block? Use `workspace:*`, or a `github:` specifier pinned to a commit.
- `RELEASING.md` tells how a release and a new package work.
