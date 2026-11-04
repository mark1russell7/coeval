import { sameValue } from "./agree.ts";
import { codecOf, decodeDomain } from "./codec.ts";
import { type Json, docEquals } from "./doc.ts";
import { type Result, describe, fail, ok } from "./errors.ts";
import type { Machine } from "./evaluate.ts";
import { domainOf, membersOf } from "./types.ts";

/*
 * The check of the laws of a codec (K141, D130). D40 states the laws, and `codecLaws` examines them for one domain of
 * a machine. It stays apart from `conforms`: a codec has no document and no parts, thus no probe of `conforms` fits it.
 */

/**
 * A law of a codec that `codecLaws` checks.
 *
 * - `samples`: the check has at least one member of the domain. Without a member, the check proves nothing.
 * - `encode`: `encode` writes each member, and it does not throw.
 * - `json`: the data of `encode` is JSON. `JSON.parse(JSON.stringify(data))` gives equal data, thus the data has no
 *   `NaN`, no `-0`, no infinity, no `undefined`, no function, no host object and no cycle.
 * - `stable`: the same member has one document. A second `encode` of the member gives equal data, and so does an
 *   `encode` of the decoded member. The check compares with `docEquals`.
 * - `decode`: `decodeDomain` reads the JSON copy of the data, and it gives a member of the domain.
 * - `roundtrip`: the decoded member equals the member by `sameValue`.
 */
export type CodecLaw = "samples" | "encode" | "json" | "stable" | "decode" | "roundtrip";

/** The probe of a finding of `codecLaws`: the domain, the member and the data of the member. */
export interface CodecProbe {
  /** The name of the domain. */
  readonly domain: string;
  /** The member that shows the finding. The law `samples` has no member, thus the value is `undefined`. */
  readonly value: unknown;
  /** The data that `encode` gave for the member. The laws `samples` and `encode` have no data. */
  readonly data?: unknown;
}

/** One law that a codec breaks, with the reason and the first probe that shows it. The form is the form of `Finding`. */
export interface CodecFinding {
  readonly obligation: CodecLaw;
  /** One sentence that tells what the codec did. */
  readonly reason: string;
  readonly probe: CodecProbe;
}

/** The options of `codecLaws`. */
export interface CodecLawsOptions {
  /** More members of the domain. They come first. A value that is not a member of the domain gets no test. */
  readonly samples?: readonly unknown[];
  /**
   * This function compares two values that the rules of `sameValue` do not know, as in `agree`. A member that is an
   * object needs this rule, for example a date, because `sameValue` compares an object only with itself.
   *
   * @param a - The first value.
   * @param b - The second value.
   * @returns `true` or `false`, or `undefined` for the rules of `sameValue`.
   */
  readonly equal?: (a: unknown, b: unknown) => boolean | undefined;
}

/** The order of the laws in the list of findings. */
const ORDER: readonly CodecLaw[] = ["samples", "encode", "json", "stable", "decode", "roundtrip"];

/** This function gives the result of a function, or a failure with the text of the error that it throws. */
function attempt<V>(act: () => V): Result<V> {
  try {
    return ok(act());
  } catch (error) {
    return fail("#VALUE!", describe(error));
  }
}

/**
 * This function gives the edge values of each base type: the values that a codec loses first. `codecLaws` tests the
 * values that are members of the domain. The function makes new values at each call, thus a codec that changes a
 * value changes no later test.
 */
function edgeValues(): readonly unknown[] {
  const proto = JSON.parse('{ "__proto__": 1 }') as unknown;
  const numbers = [0, -0, 1, -1, 0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const limits = [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 2 ** 53, Number.MAX_VALUE, Number.MIN_VALUE];
  const texts = ["", " ", "a", "\u0000", "\ud800", "\u{1f600}", "__proto__"];
  const wholes = [0n, -1n, 2n ** 53n, 2n ** 70n];
  const lists = [[], [[]], [undefined], [Number.NaN], [-0]];
  const records = [{}, { a: {} }, { a: undefined }, { a: Number.NaN }, proto];
  const hosts = [new Date(0), new Date(Number.NaN), new Map(), new Set()];
  return [null, undefined, true, false, ...numbers, ...limits, ...texts, ...wholes, ...lists, ...records, ...hosts];
}

/** This function gives the JSON copy of data, or a failure that tells why the data is not JSON. */
function jsonCopy(data: unknown): Result<Json> {
  const copy = attempt(() => {
    const text = JSON.stringify(data) as string | undefined;
    return text === undefined ? undefined : (JSON.parse(text) as Json);
  });
  if (!copy.ok) return fail("#VALUE!", `JSON cannot write the data of encode: ${copy.error.reason}`);
  if (copy.value !== undefined && docEquals(copy.value, data)) return ok(copy.value);
  return fail("#VALUE!", "The data of encode is not JSON: JSON.parse(JSON.stringify(data)) does not give equal data.");
}

/** This function tells if a function of a codec gives data equal to `data`. A throw gives `false`. */
function sameData(act: () => unknown, data: unknown): boolean {
  const again = attempt(act);
  return again.ok && docEquals(again.value, data);
}

/**
 * This function examines the laws of the codec of one domain of a machine (K141, D130). A test of a language starts it
 * for each domain with a codec. The members are the list `values` of the domain, or else the given samples, the edge
 * values and the lists `samples` of the domains. Each value that is not a member gets no test.
 *
 * The law `decode` reads the JSON copy of the data through `decodeDomain`, as an evaluation of `ext.domain` does. Thus
 * a codec that reads a data object by its identity breaks a law. The finding of a law names the first member that
 * breaks it. An empty list means that each member keeps each law.
 *
 * @param machine - The machine, or only its domains.
 * @param name - The name of the domain.
 * @param options - The samples and the rule of equality.
 * @returns The first finding of each law that the codec breaks, in the order of the laws.
 * @throws {Error} The machine has no domain with the name, or the domain has no codec.
 */
export function codecLaws(machine: Pick<Machine, "domains">, name: string, options: CodecLawsOptions = {}): readonly CodecFinding[] {
  const domains = machine.domains;
  const domain = domainOf(name, domains);
  const codec = domain === undefined ? undefined : codecOf(domain);
  if (codec === undefined) throw new Error(`The machine has no domain ${name} with a codec.`);
  const found = new Map<CodecLaw, CodecFinding>();
  const report = (obligation: CodecLaw, reason: string, value: unknown, more: { readonly data?: unknown } = {}): void => {
    if (!found.has(obligation)) found.set(obligation, { obligation, reason, probe: { domain: name, value, ...more } });
  };
  const members = membersOf(name, domains, [...(options.samples ?? []), ...edgeValues()]);
  if (members.length === 0) report("samples", `The check has no member of the domain ${name}. Give members in the option samples.`, undefined);
  for (const value of members) {
    const written = attempt(() => codec.encode(value));
    if (!written.ok) {
      report("encode", `encode throws for a member: ${written.error.reason}`, value);
      continue;
    }
    const data = written.value;
    const probe = { data };
    const copy = jsonCopy(data);
    if (!copy.ok) report("json", copy.error.reason, value, probe);
    if (!sameData(() => codec.encode(value), data)) report("stable", "A second encode of the member does not give equal data.", value, probe);
    const back = decodeDomain({ domain: name, data: copy.ok ? copy.value : data }, domains);
    if (!back.ok) {
      report("decode", back.error.reason, value, probe);
      continue;
    }
    if (!sameValue(back.value, value, options.equal)) report("roundtrip", "The decoded member does not equal the member by sameValue. An object needs the option equal.", value, probe);
    if (!sameData(() => codec.encode(back.value), data)) report("stable", "An encode of the decoded member does not give equal data.", value, probe);
  }
  return ORDER.filter((law) => found.has(law)).map((law) => found.get(law) as CodecFinding);
}
