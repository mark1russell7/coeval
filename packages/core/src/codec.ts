import { type Json, isEnvelope, isRecord } from "./doc.ts";
import { type Result, describe, fail, ok } from "./errors.ts";
import { type Machine, makeContext, prepare } from "./evaluate.ts";
import { type Domain, type DomainCodec, domainOf, member } from "./types.ts";

/*
 * The codec of the values that JSON cannot write (K140, D40). A document holds such a value as a standard extension:
 * `ext.number` for `NaN`, an infinity and `-0`, `ext.undefined` for `undefined`, and `ext.domain` for a member of a
 * domain with a codec. Thus the same value has the same document in each language (D12).
 */

/** The domains of a machine, by their names. */
type Domains = Readonly<Record<string, Domain>> | undefined;

/** This function gives the codec of a domain, or `undefined` when the domain has no codec. */
function codecOf(domain: Domain): DomainCodec | undefined {
  const codec: unknown = domain.codec;
  if (typeof codec !== "object" || codec === null) return undefined;
  const { encode, decode } = codec as Partial<DomainCodec>;
  return typeof encode === "function" && typeof decode === "function" ? (codec as DomainCodec) : undefined;
}

/**
 * This function reads the value of an extension `ext.domain` (EXT.DOMAIN). The value is a record with only the text
 * `domain` and the JSON `data`. The codec of the named domain reads the data, and the result must be a member of the
 * domain.
 *
 * @param data - The value of the extension document.
 * @param domains - The domains of the machine.
 * @returns The member, `#NAME?` for a domain without a codec, or `#VALUE!` for data that the codec cannot read.
 */
export function decodeDomain(data: Json, domains: Domains): Result {
  if (!isRecord(data) || typeof data["domain"] !== "string" || !Object.hasOwn(data, "data") || Object.keys(data).length !== 2) {
    return fail("#VALUE!", "The value of ext.domain is a record with only the text domain and the data.");
  }
  const name = data["domain"];
  const domain = domainOf(name, domains);
  if (domain === undefined) return fail("#NAME?", `The machine has no domain ${name}.`);
  const codec = codecOf(domain);
  if (codec === undefined) return fail("#NAME?", `The domain ${name} has no codec.`);
  let value: unknown;
  try {
    value = codec.decode(data["data"] as Json);
  } catch (error) {
    return fail("#VALUE!", `The codec of the domain ${name} cannot read the data: ${describe(error)}`, { cause: error });
  }
  if (!member(value, name, domains)) return fail("#VALUE!", `The codec of the domain ${name} gives a value that is not a member of the domain.`);
  return ok(value);
}

/**
 * This function gives the static type of an extension `ext.domain`: the name of its domain when that domain has a
 * codec. A run then gives a member of the domain or an error, because `decodeDomain` tests the membership.
 *
 * @param data - The value of the extension document.
 * @param domains - The domains of the machine.
 * @returns The name of the domain, or `unknown`.
 */
export function domainTypeOf(data: unknown, domains: Domains): string {
  if (!isRecord(data) || typeof data["domain"] !== "string") return "unknown";
  const domain = domainOf(data["domain"], domains);
  return domain !== undefined && codecOf(domain) !== undefined ? data["domain"] : "unknown";
}

/** This function sets an own data property. Only the key `__proto__` needs `defineProperty`. */
function setOwn(target: Record<string, Json>, key: string, value: Json): void {
  if (key === "__proto__") Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

/** The state of one call of `encodeValue`. */
interface Encoder {
  readonly domains: Domains;
  /** The domains with a codec, in the order of their names. */
  readonly codecs: readonly (readonly [string, DomainCodec])[];
  /** The answer of `isJson` for each container that it examined. */
  readonly json: WeakMap<object, boolean>;
  /** The containers on the way from the root to the value. A container on the way again is a cycle. */
  readonly open: Set<object>;
}

/**
 * This function tells if JSON writes a value exactly. Such a value is a finite number other than `-0`, a text, a truth
 * value, `null`, or a container of such values.
 */
function isJson(value: unknown, encoder: Encoder): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0);
  const list = Array.isArray(value);
  if (!list && !isRecord(value)) return false;
  const container = value as object;
  const known = encoder.json.get(container);
  if (known !== undefined) return known;
  // A cycle is not JSON. The mark stays false until each item is JSON.
  encoder.json.set(container, false);
  let all = true;
  if (list) {
    const items = value as readonly unknown[];
    for (let index = 0; index < items.length && all; index += 1) all = isJson(items[index], encoder);
  } else {
    const record = value as Readonly<Record<string, unknown>>;
    for (const key of Object.keys(record)) {
      if (!isJson(record[key], encoder)) {
        all = false;
        break;
      }
    }
  }
  encoder.json.set(container, all);
  return all;
}

/** This function gives the text of a number that JSON cannot write, for `ext.number`. */
function numberText(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  return "-0";
}

/** This function gives the term document of a value in one call of `encodeValue`. */
function encodeTerm(value: unknown, encoder: Encoder): Json {
  if (isJson(value, encoder)) return isEnvelope(value) ? { type: "lit", value: value as Json } : (value as Json);
  if (value === undefined) return { type: ["ext", "undefined"], value: null };
  if (typeof value === "number") return { type: ["ext", "number"], value: numberText(value) };
  for (const [name, codec] of encoder.codecs) {
    if (member(value, name, encoder.domains)) return { type: ["ext", "domain"], value: { domain: name, data: codec.encode(value) } };
  }
  if (!Array.isArray(value) && !isRecord(value)) {
    throw new TypeError(`encodeValue cannot write the value ${describe(value)}: no domain of the machine with a codec holds it.`);
  }
  if (encoder.open.has(value)) throw new TypeError("encodeValue cannot write a value with a cycle.");
  encoder.open.add(value);
  let out: Json;
  if (Array.isArray(value)) {
    // `Array.from` visits each hole of a sparse list as `undefined`.
    out = { type: "list", value: Array.from(value as readonly unknown[], (item) => encodeTerm(item, encoder)) };
  } else {
    const fields: Record<string, Json> = {};
    const record = value as Readonly<Record<string, unknown>>;
    for (const key of Object.keys(record)) setOwn(fields, key, encodeTerm(record[key], encoder));
    out = { type: "record", value: fields };
  }
  encoder.open.delete(value);
  return out;
}

/**
 * This function writes a host value as a term document of the formula kit (EXT.ENCODE, D40). Thus the same value has
 * the same document in each language (D12).
 *
 * - A value that JSON writes exactly stays as it is. A literal with the shape of an envelope goes into `lit`.
 * - `NaN`, an infinity and `-0` become `ext.number`, and `undefined` becomes `ext.undefined`.
 * - A member of a domain with a codec becomes `ext.domain`. The domains go in the order of their names.
 * - A list or a plain record with such a value becomes the construct `list` or `record`.
 *
 * @param machine - The machine, or only its domains.
 * @param value - The host value.
 * @returns The document. `decodeValue` gives the value again (EXT.ROUNDTRIP).
 * @throws {TypeError} The value has a cycle, or it is not JSON and no domain with a codec holds it.
 */
export function encodeValue(machine: Pick<Machine, "domains">, value: unknown): Json {
  const domains = machine.domains;
  const codecs: (readonly [string, DomainCodec])[] = [];
  if (domains !== undefined) {
    for (const name of Object.keys(domains).sort()) {
      const domain = domainOf(name, domains);
      const codec = domain === undefined ? undefined : codecOf(domain);
      if (codec !== undefined) codecs.push([name, codec]);
    }
  }
  return encodeTerm(value, { domains, codecs, json: new WeakMap(), open: new Set() });
}

/**
 * This function reads a document of `encodeValue` again: it evaluates the document as a term, in an empty context.
 * A bare root value is a literal.
 *
 * @param machine - A machine of the formula kit, with the domains of the document.
 * @param doc - The document.
 * @returns The value, or the error of the evaluation.
 */
export function decodeValue(machine: Machine, doc: unknown): Result {
  return prepare(machine, doc, { declaredType: "lit" }).evaluate(makeContext());
}
