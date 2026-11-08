/*
 * The records that accept a held slower reading (K239, D173).
 *
 * A slower case on different arms holds a merge (D117, D166). Before K239, `Speed OK` stayed green under that hold, and
 * only a person who read the line kept the merge back. Thus `Speed OK` is red under a hold, unless the pull request
 * has a record of each slower case in the folder `bench/accepted`:
 *
 *   [{ "case": "<name of the case>", "head": "<hash of the head arm>", "cost": "<the measured change>",
 *      "reason": "<why the cost is accepted>", "owner": "<who accepts it>" }]
 *
 * The file of a pull request has the number of the pull request as its name, for example `301.json`. The field `head`
 * is the hash of the head arm that the line `Arms (K232)` prints, with 12 or more of its characters. A record accepts
 * only the case of its name, on a head of that hash. A later change of the kernel gives another hash, thus a record on
 * `main` accepts nothing more, and it stays as the trail of the cost. The script imports no package.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The folder of the records. */
export const ACCEPTED_DIR = fileURLToPath(new URL("./accepted", import.meta.url));

/** One record that accepts the slower time of one case on one head. */
export interface Accepted {
  readonly case: string;
  readonly head: string;
  readonly cost: string;
  readonly reason: string;
  readonly owner: string;
  /** The name of the file of the record. */
  readonly file: string;
}

/** The records of the folder, and the faults of the files that are not correct. */
export interface AcceptedRead {
  readonly records: readonly Accepted[];
  readonly faults: readonly string[];
}

/** The fields of a record. Each one is a text that is not empty. */
const FIELDS = ["case", "head", "cost", "reason", "owner"] as const;

/** The field `head`: 12 to 64 characters of a hash in lower case, as the line `Arms (K232)` prints it. */
const HEAD = /^[0-9a-f]{12,64}$/;

/**
 * This function reads the records of a list of files. A file that is not a list of correct records gives a fault, and
 * none of its records count. Thus a record with an empty field stops the read of the run.
 *
 * @param files - The name and the text of each file.
 * @returns The records and the faults.
 */
export function acceptedRecords(files: readonly { readonly name: string; readonly text: string }[]): AcceptedRead {
  const records: Accepted[] = [];
  const faults: string[] = [];
  for (const { name, text } of files) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      faults.push(`The file accepted/${name} is not JSON (K239).`);
      continue;
    }
    if (!Array.isArray(data) || data.length === 0) {
      faults.push(`The file accepted/${name} is not a list of records (K239).`);
      continue;
    }
    const own: Accepted[] = [];
    const bad: string[] = [];
    data.forEach((item: unknown, index) => {
      const record = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
      const empty = FIELDS.filter((key) => typeof record[key] !== "string" || (record[key] as string).trim() === "");
      if (empty.length > 0) bad.push(`The record ${String(index + 1)} of accepted/${name} has no ${empty.join(", ")} (K239).`);
      else if (!HEAD.test(record["head"] as string)) bad.push(`The record ${String(index + 1)} of accepted/${name} has a head that is not 12 to 64 characters of a hash (K239).`);
      else own.push({ case: record["case"] as string, head: record["head"] as string, cost: record["cost"] as string, reason: record["reason"] as string, owner: record["owner"] as string, file: name });
    });
    if (bad.length > 0) faults.push(...bad);
    else records.push(...own);
  }
  return { records, faults };
}

/** This function reads the JSON files of the folder of the records. A folder that does not exist has no records. */
export function readAccepted(dir: string = ACCEPTED_DIR): AcceptedRead {
  if (!existsSync(dir)) return { records: [], faults: [] };
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return acceptedRecords(names.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") })));
}

/** The answer of the records to a hold: the records that accept a slower case, and the cases that have no record. */
export interface Acceptance {
  readonly accepted: readonly Accepted[];
  readonly missing: readonly string[];
  /** The line of each accepted case and of each case without a record. */
  readonly lines: readonly string[];
}

/**
 * This function gives the answer of the records to a hold. A case has a record when the record has its name, and the
 * head arm of each run has the hash of the record. Two runs with different heads accept nothing. A run without hashes accepts nothing.
 *
 * @param slower - The names of the slower cases.
 * @param heads - The hash of the head arm of each run.
 * @param records - The records of the folder.
 * @returns The accepted cases and the cases without a record.
 */
export function acceptHold(slower: readonly string[], heads: readonly (string | undefined)[], records: readonly Accepted[]): Acceptance {
  const head = heads.length > 0 && heads.every((item) => item !== undefined && item === heads[0]) ? heads[0] : undefined;
  const accepted: Accepted[] = [];
  const missing: string[] = [];
  const lines: string[] = [];
  for (const name of slower) {
    const record = head === undefined ? undefined : records.find((item) => item.case === name && head.startsWith(item.head));
    if (record === undefined) {
      missing.push(name);
      lines.push(`Not accepted (K239): ${name} has no record in bench/accepted for the head ${head === undefined ? "(the runs give no one head)" : head.slice(0, 12)}.`);
    } else {
      accepted.push(record);
      lines.push(`Accepted (K239): ${name}, ${record.cost}, by ${record.owner}: ${record.reason} (accepted/${record.file}).`);
    }
  }
  return { accepted, missing, lines };
}
