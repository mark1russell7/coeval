import { type Json, type Key, docEquals, isEnvelope, typePath } from "./doc.ts";
import { type Kind, type ScopeRule, type Shape, type World, type WorldEntry, isAlias, isKind, isNamespace, lookupKind } from "./world.ts";
import { pathMatches } from "./parts.ts";
import { ROOTS, type Root } from "./deref.ts";

/** A source of random numbers with a seed. The same seed gives the same numbers. */
export interface Random {
  /** This function gives a number from 0 up to 1, without 1. */
  next(): number;
  /** This function gives a whole number from 0 up to `below`, without `below`. */
  int(below: number): number;
  /** This function gives `true` with the chance `p`. */
  chance(p: number): boolean;
  /** This function gives one item of a list that is not empty. */
  pick<T>(items: readonly T[]): T;
}

/**
 * This function makes a source of random numbers with a seed (the algorithm mulberry32). It needs no package.
 *
 * @param seed - The seed: a whole number.
 * @returns The source.
 */
export function random(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (below: number): number => Math.floor(next() * below);
  return { next, int, chance: (p) => next() < p, pick: (items) => items[int(items.length)] as never };
}

/** The options of `generate`. */
export interface GenerateOptions {
  /** The seed. The same seed and the same options give the same document. */
  readonly seed: number;
  /** The types that a document can have. The default is `typesOf(world)`. A namespace with a fallback needs its keys here. */
  readonly types?: readonly (readonly Key[])[];
  /** The type of a bare root value. */
  readonly declaredType?: string;
  /** The names that the host binds at the root. */
  readonly names?: readonly string[];
  /** The deepest nesting of documents. The default is 4. */
  readonly maxDepth?: number;
  /** The most documents in one document. The default is 24. */
  readonly maxSize?: number;
  /** The chance of a malformed choice at each document. The default is 0.05. */
  readonly malformed?: number;
  /**
   * This function gives the data of a document of a type without parts, for example a number for the kind `number`.
   *
   * @param type - The keys of the type.
   * @param random - The source of random numbers.
   * @returns The data, or `undefined` for a random JSON value.
   */
  readonly data?: (type: readonly Key[], random: Random) => Json | undefined;
  /**
   * This function gives the types to prefer for a part, for example a function for the field `fn` of `call`.
   *
   * @param type - The keys of the type of the parent.
   * @param path - The path of the part in the value of the parent.
   * @returns The types, or `undefined` for no preference.
   */
  readonly hints?: (type: readonly Key[], path: readonly Key[]) => readonly (readonly Key[])[] | undefined;
  /** The evaluator names for own entries. The default is none. */
  readonly own?: readonly string[];
  /** The keys for the steps of a path after its root and its name. */
  readonly keys?: readonly Key[];
  /** The roots that a path can start at. The default is each root. */
  readonly roots?: readonly Root[];
  /** The most steps of a path after its root and its name. The default is 2. */
  readonly steps?: number;
}

/**
 * This function lists the types of a world: each kind and each alias, also in a namespace. A namespace with a
 * fallback gives no types, because each key names a kind.
 *
 * @param world - The world.
 * @returns The keys of each type.
 */
export function typesOf(world: World): readonly (readonly Key[])[] {
  const out: (readonly Key[])[] = [];
  const visit = (entries: Readonly<Record<string, WorldEntry>>, prefix: readonly Key[]): void => {
    for (const key of Object.keys(entries)) {
      const entry = entries[key];
      if (isKind(entry) || isAlias(entry)) out.push([...prefix, key]);
      else if (isNamespace(entry)) visit(entry.kinds, [...prefix, key]);
    }
  };
  visit(world.kinds, []);
  return out;
}

const NAMES = ["a", "b", "x", "n", "last", "__proto__"] as const;
const FIELDS = ["a", "b", "c", "1", "__proto__"] as const;
const KEYS: readonly Key[] = ["a", "b", "x", 0, 1, "0", "length", "type", "value", "parent"];

/** This function tells if a kind can be a leaf: it needs no part. */
function leafKind(kind: Kind | undefined): boolean {
  const shape = kind?.parts;
  return shape === undefined || shape.shape === "none" || shape.shape === "list" || shape.shape === "map" || shape.shape === "text" || shape.shape === "number" || shape.shape === "one";
}

/** A position of a document: the type that it declares, the kinds that it permits, the names that it sees and its depth. */
interface Position {
  readonly declared: string | undefined;
  readonly kinds: readonly (readonly Key[])[] | undefined;
  readonly names: readonly string[];
  readonly depth: number;
  readonly hint: readonly (readonly Key[])[] | undefined;
}

/** The names that the scope rules of one document bind, and the parts that see them. */
interface Scope {
  readonly rules: readonly ScopeRule[];
  /** The names of each rule, or the names of the headers so far for a rule `headers`. */
  readonly names: string[][];
  /** The number of parts that each rule covered so far. */
  readonly covered: number[];
  /** The data of a source of names, by its path as one text. */
  readonly sources: Map<string, { readonly keys: readonly string[] } | { readonly list: readonly string[] } | { readonly text: string }>;
}

/**
 * This function builds a random document for a world from the contracts of its kinds. It reads the shapes of the
 * parts, the declared types, the permitted kinds and the names that the scope rules bind. Some choices are malformed
 * on purpose, for example an unknown kind or an unknown name under a namespace with a fallback. Other examples are a
 * value without its shape, a bare value without a type and a name that nothing binds. The depth and the size have
 * limits.
 *
 * @param world - The world.
 * @param options - The seed, the types, the limits and the data of the leaves.
 * @returns The document, as JSON.
 */
export function generate(world: World, options: GenerateOptions): unknown {
  const rng = random(options.seed);
  const types = options.types ?? typesOf(world);
  const maxDepth = options.maxDepth ?? 4;
  const maxSize = options.maxSize ?? 24;
  const malformed = options.malformed ?? 0.05;
  const keys = options.keys ?? KEYS;
  const steps = options.steps ?? 2;
  const roots: readonly Root[] = options.roots ?? ROOTS;
  // A kind with the verb step walks a step document. With a default of step, each other kind walks one too (GEN.STEPS).
  const defaultStep = Object.hasOwn(world.defaults, "step");
  const stepTypes = types.filter((type) => {
    const found = lookupKind(world, type);
    return found.ok && (defaultStep || Object.hasOwn(found.kind.verbs, "step"));
  });
  // A name under each namespace with a fallback that no evaluator knows, for example ["ops", "nope"].
  const unknownNames: readonly (readonly Key[])[] = Object.keys(world.kinds)
    .filter((key) => {
      const entry = world.kinds[key];
      return isNamespace(entry) && entry.fallback !== undefined;
    })
    .map((key) => [key, "nope"]);
  let size = 0;

  const kindOf = (type: readonly Key[]): Kind | undefined => {
    const found = lookupKind(world, type);
    return found.ok ? found.kind : undefined;
  };

  const anyJson = (depth = 0): Json => {
    const roll = rng.int(depth > 1 ? 6 : 8);
    if (roll === 0) return null;
    if (roll === 1) return rng.chance(0.5);
    if (roll === 2) return rng.pick([0, 1, 2, -1, 0.5, 1e21]);
    if (roll === 3) return rng.pick(["", "a", "text", "0"]);
    if (roll === 4) return rng.int(10);
    if (roll === 5) return rng.pick(NAMES);
    if (roll === 6) return Array.from({ length: rng.int(3) }, () => anyJson(depth + 1));
    const out: Record<string, Json> = {};
    for (let index = rng.int(3); index > 0; index -= 1) Object.defineProperty(out, rng.pick(FIELDS), { value: anyJson(depth + 1), enumerable: true, writable: true, configurable: true });
    return out;
  };

  const dataOf = (type: readonly Key[]): Json => options.data?.(type, rng) ?? anyJson();

  const renderType = (type: readonly Key[]): Json => {
    const roll = rng.next();
    if (roll < 0.06) return { type: "ref", value: ["world", ...type] };
    if (type.length === 1 && roll < 0.8) return type[0] as Json;
    return [...type];
  };

  const permitted = (type: readonly Key[], kinds: readonly (readonly Key[])[] | undefined): boolean =>
    kinds === undefined || kinds.some((kind) => kind.length <= type.length && kind.every((key, index) => String(key) === String(type[index])));

  const pickName = (names: readonly string[]): string => (names.length === 0 || rng.chance(malformed) ? rng.pick(["unbound", "zz"]) : rng.pick(names));

  const someNames = (): string[] => {
    const out = new Set<string>();
    for (let index = 1 + rng.int(2); index > 0; index -= 1) out.add(rng.pick(NAMES));
    return [...out];
  };

  const envelope = (type: readonly Key[], value: Json, header?: string): Json => {
    const out: Record<string, Json> = { type: renderType(type), value };
    if (header !== undefined) out["name"] = header;
    if (options.own !== undefined && options.own.length > 0 && rng.chance(0.03)) out["own"] = { eval: rng.pick(options.own) };
    return out;
  };

  /**
   * A path from a root (D10). It uses the names in scope, and sometimes a step document. The kind of a step document
   * has the verb `step`, or the default of the world for `step` serves it.
   */
  const pathFor = (pos: Position, refKind: Kind | undefined): Json => {
    if (rng.chance(malformed)) return rng.pick<Json>(["names", [], { names: "a" }, ["nowhere", "a"]]);
    const others = roots.filter((name) => name !== "names");
    const named = roots.includes("names") && pos.names.length > 0 && (others.length === 0 || rng.chance(0.75));
    const root = named || others.length === 0 ? "names" : rng.pick(others);
    const path: Json[] = [root];
    if (root === "names") path.push(pickName(pos.names));
    if (root === "world") path.push(String(rng.pick(types)[0]));
    for (let index = rng.int(steps + 1); index > 0; index -= 1) {
      if (stepTypes.length > 0 && rng.chance(0.2)) {
        const type = rng.pick(stepTypes);
        const kind = kindOf(type);
        // With a deep shape of the kind ref, the value of a step document can hold parts.
        const value = refKind?.parts?.shape === "deep" && kind?.parts !== undefined ? valueOf(kind.parts, [], { ...pos, depth: pos.depth + 1 }, emptyScope()) : dataOf(type);
        path.push({ type: renderType(type), value });
      } else {
        path.push(rng.pick(keys) as Json);
      }
    }
    return path;
  };

  const emptyScope = (): Scope => ({ rules: [], names: [], covered: [], sources: new Map() });

  /** This function decides the names of the scope rules before the parts, so that each part knows what it sees. */
  const scopeOf = (kind: Kind): Scope => {
    const rules = kind.scope ?? [];
    const scope: Scope = { rules, names: [], covered: rules.map(() => 0), sources: new Map() };
    for (const rule of rules) {
      const source = rule.names;
      let names: string[] = [];
      if ("fixed" in source) names = [...source.fixed];
      else if ("keysAt" in source) {
        names = someNames();
        scope.sources.set(source.keysAt.join("."), { keys: names });
      } else if ("listAt" in source) {
        names = someNames();
        scope.sources.set(source.listAt.join("."), { list: rng.chance(malformed) ? [...names, ...names] : names });
      } else if ("textAt" in source) {
        names = [rng.pick(NAMES)];
        scope.sources.set(source.textAt.join("."), { text: names[0] as string });
      }
      scope.names.push(names);
    }
    return scope;
  };

  /** The names that a part sees from the scope rules of its parent. A rule `sequential` shows only earlier names. */
  const seenBy = (scope: Scope, path: readonly Key[]): { readonly names: readonly string[]; readonly headers: boolean } => {
    const names: string[] = [];
    let headers = false;
    scope.rules.forEach((rule, index) => {
      if (!rule.in.some((pattern) => pathMatches(path, pattern))) return;
      const ruleNames = scope.names[index] ?? [];
      if ("headers" in rule.names) headers = true;
      if (rule.sequential !== true || "headers" in rule.names || (scope.covered[index] ?? 0) > 0) names.push(...ruleNames);
    });
    return { names, headers };
  };

  /** This function records the part at a path, and the header name that it got, for the rules that cover it. */
  const saw = (scope: Scope, path: readonly Key[], part: Json): void => {
    const header = isEnvelope(part) && typeof (part as { readonly name?: unknown }).name === "string" ? (part as { readonly name: string }).name : undefined;
    scope.rules.forEach((rule, index) => {
      if (!rule.in.some((pattern) => pathMatches(path, pattern))) return;
      scope.covered[index] = (scope.covered[index] ?? 0) + 1;
      if ("headers" in rule.names && header !== undefined) scope.names[index]?.push(header);
    });
  };

  const partAt = (pos: Position, scope: Scope, path: readonly Key[], spec: Extract<Shape, { readonly shape: "term" }> | { readonly shape: "term"; readonly of?: string }, parentType: readonly Key[] | undefined): Json => {
    const seen = seenBy(scope, path);
    const header = seen.headers && rng.chance(0.5) ? rng.pick(NAMES) : undefined;
    const part = docAt(
      {
        declared: spec.of,
        kinds: "kinds" in spec ? spec.kinds : undefined,
        names: seen.names.length === 0 ? pos.names : [...pos.names, ...seen.names],
        depth: pos.depth + 1,
        hint: parentType === undefined ? undefined : options.hints?.(parentType, path),
      },
      header,
    );
    saw(scope, path, part);
    return part;
  };

  /** This function builds a value of a shape (SHAPE.*). A part is a document at the next depth. */
  const valueOf = (shape: Shape | undefined, path: readonly Key[], pos: Position, scope: Scope, type?: readonly Key[]): Json => {
    const source = scope.sources.get(path.join("."));
    if (source !== undefined && "list" in source) return [...source.list];
    if (source !== undefined && "text" in source) return source.text;
    const term = (of: string | undefined): { readonly shape: "term"; readonly of?: string } => (of === undefined ? { shape: "term" } : { shape: "term", of });
    const small = (): number => (pos.depth >= maxDepth ? 0 : size >= maxSize ? rng.int(2) : rng.int(4));
    if (shape === undefined || shape.shape === "none") return path.length === 0 && type !== undefined ? dataOf(type) : anyJson();
    switch (shape.shape) {
      case "term":
        return partAt(pos, scope, path, shape, type);
      case "list": {
        const items = Array.from({ length: small() }, (_, index) => valueOf(shape.item ?? term(shape.of), [...path, index], pos, scope, type));
        if (shape.distinct !== true || rng.chance(malformed)) return items;
        return items.filter((item, index) => !items.slice(0, index).some((before) => docEquals(before, item)));
      }
      case "map": {
        const out: Record<string, Json> = {};
        const names = source !== undefined && "keys" in source ? source.keys : Array.from({ length: small() }, () => rng.pick(FIELDS));
        for (const key of names) Object.defineProperty(out, key, { value: valueOf(shape.item ?? term(shape.of), [...path, key], pos, scope, type), enumerable: true, writable: true, configurable: true });
        return out;
      }
      case "record": {
        const named: Readonly<Record<string, Shape>> = Array.isArray(shape.fields)
          ? Object.fromEntries((shape.fields as readonly string[]).map((name) => [name, term(shape.of)]))
          : (shape.fields as Readonly<Record<string, Shape>>);
        const fieldKeys = new Set<string>([...(shape.required ?? []), ...Object.keys(named).filter(() => rng.chance(0.75))]);
        if (shape.closed !== true && shape.rest === undefined && rng.chance(0.15)) fieldKeys.add("extra");
        const ordered = rng.chance(0.2) ? [...fieldKeys].reverse() : [...fieldKeys];
        const out: Record<string, Json> = {};
        for (const key of ordered) {
          if (rng.chance(malformed / 2) && (shape.required ?? []).includes(key)) continue;
          const fieldShape = Object.hasOwn(named, key) ? named[key] : shape.rest;
          Object.defineProperty(out, key, { value: valueOf(fieldShape, [...path, key], pos, scope, type), enumerable: true, writable: true, configurable: true });
        }
        if (shape.closed === true && rng.chance(malformed)) out["stray"] = 1;
        return out;
      }
      case "deep":
        return rng.chance(0.5)
          ? [partAt(pos, scope, [...path, 0], term(shape.of), type), anyJson()]
          : { at: partAt(pos, scope, [...path, "at"], term(shape.of), type), data: anyJson() };
      case "text":
        return rng.chance(malformed) ? 1 : rng.pick(["", "a", "label"]);
      case "number": {
        if (rng.chance(malformed)) return "1";
        const low = shape.min ?? -2;
        const value = low + rng.int(5) + (shape.whole === true ? 0 : rng.pick([0, 0.5]));
        return shape.max !== undefined && value > shape.max ? shape.max : value;
      }
      case "one":
        return rng.chance(malformed) ? "other" : (rng.pick(shape.values) as Json);
    }
  };

  /**
   * A malformed document: an unknown kind, or an unknown name under a namespace with a fallback. It can also be a
   * bad shape, a bare value without a type, or a bad reference.
   */
  const brokenAt = (pos: Position): Json => {
    const roll = rng.int(5);
    if (roll === 0 && unknownNames.length > 0 && rng.chance(0.5)) {
      // The fallback kind answers the name, and its evaluator does not know it, for example an unknown operation.
      const type = rng.pick(unknownNames);
      const kind = kindOf(type);
      return envelope(type, kind?.parts === undefined ? dataOf(type) : valueOf(kind.parts, [], pos, scopeOf(kind), type));
    }
    if (roll === 0) return { type: rng.pick<Json>(["nothing", ["no", "such"]]), value: 1 };
    if (roll === 1) return pos.declared === undefined ? rng.pick<Json>([7, "bare", [1]]) : { type: "ref", value: ["names", "unbound"] };
    if (roll === 2) {
      const shaped = types.filter((type) => kindOf(type)?.parts !== undefined);
      if (shaped.length > 0) return envelope(rng.pick(shaped), rng.pick<Json>([7, "x", null]));
    }
    if (roll === 3) return { type: "ref", value: rng.pick<Json>([["names", "unbound"], ["nowhere"], "names"]) };
    return { type: rng.pick(types) as Json, value: anyJson() };
  };

  const docAt = (pos: Position, header?: string): Json => {
    size += 1;
    const leaf = pos.depth >= maxDepth || size >= maxSize;
    if (rng.chance(malformed)) return brokenAt(pos);
    if (pos.declared !== undefined && rng.chance(leaf ? 0.7 : 0.3)) {
      const bare = dataOf([pos.declared]);
      // A bare value with the form of an envelope is a document of its own type, and the position must permit that type.
      if (!isEnvelope(bare) || permitted(typePath(bare.type) ?? [], pos.kinds)) return bare;
    }
    let candidates = types.filter((type) => permitted(type, pos.kinds) && (!leaf || leafKind(kindOf(type))));
    if (pos.hint !== undefined && rng.chance(0.6)) {
      const hinted = candidates.filter((type) => pos.hint?.some((hint) => hint.length === type.length && hint.every((key, index) => key === type[index])));
      if (hinted.length > 0) candidates = hinted;
    }
    if (candidates.length === 0) candidates = [...types];
    const type = rng.pick(candidates);
    const kind = kindOf(type);
    if (type.length === 1 && type[0] === "ref") return envelope(type, pathFor(pos, kind), header);
    const value = kind === undefined ? dataOf(type) : valueOf(kind.parts, [], pos, scopeOf(kind), type);
    return envelope(type, value, header);
  };

  return docAt({ declared: options.declaredType, kinds: undefined, names: options.names ?? [], depth: 0, hint: undefined });
}
