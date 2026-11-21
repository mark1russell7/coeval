/**
 * The measures of the file `kpi.json` of the site, format `kpi/1`. A reader outside the site takes the numbers from that
 * file. Each number comes from a committed file of the repository, so no number has a person as its source. The script
 * `src/write-kpi.ts` reads the files and writes `kpi.json` after the build.
 */

/** One measure of `kpi.json`. The writer of `@mark1russell7/site-pages` checks each field. */
export interface SiteMeasure {
  readonly id: string;
  readonly value: number;
  readonly unit: string;
  readonly notCounted?: string;
}

/** The class of the status of a roadmap row, as `parseRoadmap` of `@mark1russell7/site-pages` gives it. */
export type RowClass = "waiting" | "blocked" | "progress" | "open" | "later" | "done";

/** The texts that the measures read. */
export interface KpiSources {
  /** The text of `docs/SPEC.md`. */
  readonly spec: string;
  /** The text of `docs/DECISIONS.md`. */
  readonly decisions: string;
  /** The status class of each row of `docs/ROADMAP.md`. */
  readonly rows: readonly RowClass[];
  /** The text of each Lean file of `proofs/`. */
  readonly lean: readonly string[];
}

/** A rule ID of the specification: words in capital letters with points, for example `DOC.STORED` or `EVAL.SEALED`. */
const RULE_ROW = /^\| ([A-Z][A-Z0-9]*(?:\.[A-Z0-9][A-Z0-9-]*)+) \|/gmu;

/** A decision heading, for example `## D17 (2026-10-24): ...`. */
const DECISION = /^## (D\d+)\b/gmu;

/** A declaration of a theorem or a lemma at the start of a line, also with the modifier `private` or `protected`. */
const THEOREM = /^[ \t]*(?:(?:private|protected)[ \t]+)?(?:theorem|lemma)[ \t]/gmu;

/** A gap in a proof. Lean accepts a proof with `sorry` or `admit` with only a warning. */
const GAP = /\b(?:sorry|admit)\b/gu;

/** This function counts the rule IDs of the tables of the specification. Two rows of one ID count as one. */
export function specRules(spec: string): number {
  return new Set([...spec.matchAll(RULE_ROW)].map((match) => match[1])).size;
}

/** This function counts the decisions of the decision record. Two headings of one ID count as one. */
export function decisionCount(decisions: string): number {
  return new Set([...decisions.matchAll(DECISION)].map((match) => match[1])).size;
}

/**
 * This function removes the comments of a Lean text. A line comment starts with `--`. A block comment starts with `/-`
 * and ends with `-/`, and a block comment can contain another one. A string is not examined, so a `--` in a string
 * starts a comment for this function. The proofs have no such string.
 */
export function leanCode(text: string): string {
  let out = "";
  let depth = 0;
  for (let at = 0; at < text.length; at += 1) {
    const two = text.slice(at, at + 2);
    if (two === "/-") {
      depth += 1;
      at += 1;
    } else if (depth > 0 && two === "-/") {
      depth -= 1;
      at += 1;
    } else if (depth === 0 && two === "--") {
      const end = text.indexOf("\n", at);
      if (end === -1) break;
      at = end - 1;
    } else if (depth === 0 || text[at] === "\n") {
      out += text[at];
    }
  }
  return out;
}

/** This function counts the theorems and lemmas of the Lean files, outside the comments. */
export function leanTheorems(files: readonly string[]): number {
  return files.reduce((sum, text) => sum + (leanCode(text).match(THEOREM)?.length ?? 0), 0);
}

/** This function counts each `sorry` and `admit` of the Lean files, outside the comments. */
export function leanGaps(files: readonly string[]): number {
  return files.reduce((sum, text) => sum + (leanCode(text).match(GAP)?.length ?? 0), 0);
}

/** This function counts the roadmap rows of each group: done, open (waiting, blocked, in progress or open) and later. */
export function roadmapCounts(rows: readonly RowClass[]): { readonly done: number; readonly open: number; readonly later: number } {
  const done = rows.filter((row) => row === "done").length;
  const later = rows.filter((row) => row === "later").length;
  return { done, open: rows.length - done - later, later };
}

/** This function gives the measures of `kpi.json`, in a fixed order. */
export function coevalMeasures(sources: KpiSources): SiteMeasure[] {
  const rows = roadmapCounts(sources.rows);
  return [
    { id: "roadmap-open", value: rows.open, unit: "rows", notCounted: "the rows with the status later, and work with no row in docs/ROADMAP.md" },
    { id: "roadmap-done", value: rows.done, unit: "rows" },
    { id: "roadmap-later", value: rows.later, unit: "rows" },
    { id: "spec-rules", value: specRules(sources.spec), unit: "IDs", notCounted: "a rule of docs/SEMANTICS.md or docs/COMPOSITION.md with no row in docs/SPEC.md" },
    { id: "decisions", value: decisionCount(sources.decisions), unit: "decisions" },
    { id: "lean-theorems", value: leanTheorems(sources.lean), unit: "theorems", notCounted: "a proof that the build does not check. The workflow lean.yml checks each proof" },
    { id: "lean-gaps", value: leanGaps(sources.lean), unit: "places", notCounted: "an axiom. The count reads sorry and admit outside the comments" },
  ];
}
