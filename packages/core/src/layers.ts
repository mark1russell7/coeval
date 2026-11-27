// The layers of a document: the records of the add-ons of a library.
//
// A library with one topic-free core and many add-ons keeps one JSON document. The core has its own records in the
// document. Each add-on has one layer: a value under the name of its format in the field `layers`.
// The core keeps each layer, and it does not read one. An add-on reads its own layer and examines its meaning.
// Thus each add-on composes on the core, and the add-ons do not know each other.
//
// This module is the entry `@mark1russell7/coeval/layers`. It imports nothing, so a core that uses it gets no
// other code of the package (LAYERS.ALONE).

/** A document with layers: the records of each add-on, by the name of the format of its layer. */
export interface Layered {
  /** The layers. The key of a layer is the name of its format, for example `spend/1`. `isLayerName` tells the form of a name. */
  readonly layers?: Readonly<Record<string, unknown>> | undefined;
}

/** The result of the read of a layer: the layer, or the faults of its form. */
export type LayerParse<Layer> = { readonly ok: true; readonly layer: Layer } | { readonly ok: false; readonly errors: readonly string[] };

/** These are the levels of a fault. An error is a fault that stops the use of the records. A warning does not stop it. */
export const LAYER_LEVELS: readonly ["error", "warning"] = ["error", "warning"];

/** A level of a fault. */
export type LayerLevel = (typeof LAYER_LEVELS)[number];

/** A fault that an add-on finds in the meaning of its layer. */
export interface LayerFault {
  readonly level: LayerLevel;
  /** The code of the fault. The add-on gives its own codes. */
  readonly code: string;
  /** The `id` of the record with the fault. For a fault of the layer, it is empty. */
  readonly at: string;
  /** The fault in plain words, with the values. */
  readonly message: string;
  /** The `id` of the second record of the fault. A fault of one record has none. */
  readonly other?: string | undefined;
}

/**
 * An add-on: one topic on a core. A host gives a list of add-ons to `checkLayers`, and the core knows only this type.
 *
 * `Layer` is the type of the records of the add-on. `Context` is what the core gives to each add-on for its check,
 * for example the records of the core. A core can extend this type with more functions.
 */
export interface AddOn<Layer, Context> {
  /** The name of the format of the layer, for example `spend/1`. It is the key of the layer in `Layered.layers`. */
  readonly schema: string;
  /**
   * This function reads the JSON of a layer.
   *
   * @param value - The value of the layer in the document.
   * @returns The layer, or the faults of its form.
   */
  parse(value: unknown): LayerParse<Layer>;
  /**
   * This function gives the faults of the meaning of a layer.
   *
   * @param layer - The layer that `parse` gave.
   * @param context - The context of the core.
   * @returns The faults. A layer with no fault gives an empty list.
   */
  check(layer: Layer, context: Context): readonly LayerFault[];
}

/** These are the codes of the faults that `checkLayers` finds itself. Each other code comes from an add-on. */
export const LAYER_CODES: readonly ["layer-name", "layer-unknown", "layer-form"] = ["layer-name", "layer-unknown", "layer-form"];

/** A code of `LAYER_CODES`. */
export type LayerCode = (typeof LAYER_CODES)[number];

/** A finding of `checkLayers`: a fault of the name or of the form of a layer, or a fault of its meaning from its add-on. */
export interface LayerFinding extends LayerFault {
  /** The key of the layer in `Layered.layers`. */
  readonly layer: string;
}

/**
 * This function tells if a text is the name of a layer: a word, a slash and a version, for example `spend/1`.
 * The word starts with a lowercase letter, and it has lowercase letters, digits and hyphens. The version has digits only.
 * Thus a name has no colon and no space, and a host can join it with the `id` of a record.
 *
 * @param text - The text to examine.
 * @returns `true` for the name of a layer.
 */
export function isLayerName(text: string): boolean {
  return /^[a-z][a-z0-9-]*\/[0-9]+$/.test(text);
}

/** This function compares two texts by their code units, so the order does not change with the language of a computer. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** This function gives the message of the error `layer-name`. */
function nameMessage(name: string): string {
  return `The layer "${name}" has a name that is not a word, a slash and a version, for example "spend/1".`;
}

/**
 * This function reads the layer of one add-on in a document. It reads only an own field of `layers`.
 *
 * @param doc - The document.
 * @param addOn - The add-on. The function uses only its `schema` and its `parse`.
 * @returns The result of the read, or `undefined` when the document has no layer of the add-on.
 */
export function readLayer<Layer>(doc: Layered, addOn: Pick<AddOn<Layer, never>, "schema" | "parse">): LayerParse<Layer> | undefined {
  const layers = doc.layers ?? {};
  return Object.hasOwn(layers, addOn.schema) ? addOn.parse(layers[addOn.schema]) : undefined;
}

/**
 * This function gives the findings of the layers of a document, with a list of add-ons.
 *
 * - A layer with a name that `isLayerName` refuses gets the error `layer-name`. No add-on reads it.
 * - A layer of no add-on of the list gets the warning `layer-unknown`. The document keeps the layer.
 * - A layer that its add-on cannot read gets one error `layer-form` for each fault of its form.
 * - Each other layer gets the faults of its meaning from `check` of its add-on.
 *
 * The findings are in the order of the layer names, and the faults of one layer keep the order of its add-on.
 * Thus the order of the fields of `layers` and the order of the add-ons do not change the findings.
 * The first add-on of a name reads the layer.
 *
 * @param doc - The document.
 * @param addOns - The add-ons of the check.
 * @param context - The context that each `check` gets.
 * @returns The findings. A document with no layers gives an empty list.
 */
export function checkLayers<Context>(doc: Layered, addOns: readonly AddOn<unknown, Context>[], context: Context): readonly LayerFinding[] {
  const byName = new Map<string, AddOn<unknown, Context>>();
  for (const addOn of addOns) if (!byName.has(addOn.schema)) byName.set(addOn.schema, addOn);
  const layers = doc.layers ?? {};
  const findings: LayerFinding[] = [];
  for (const name of Object.keys(layers).sort(compareText)) {
    if (!isLayerName(name)) {
      findings.push({ level: "error", code: "layer-name", layer: name, at: "", message: nameMessage(name) });
      continue;
    }
    const addOn = byName.get(name);
    if (addOn === undefined) {
      findings.push({ level: "warning", code: "layer-unknown", layer: name, at: "", message: `The document has the layer "${name}", and no add-on of the check reads it. The document keeps the layer.` });
      continue;
    }
    const read = addOn.parse(layers[name]);
    if (!read.ok) {
      for (const message of read.errors) findings.push({ level: "error", code: "layer-form", layer: name, at: "", message });
      continue;
    }
    for (const fault of addOn.check(read.layer, context)) findings.push({ ...fault, layer: name });
  }
  return findings;
}

// The join of the layers of a document that has fragments.
//
// A document can have many fragments: one file for each owner or for each topic. Each fragment is a document.
// The join gives the layers of the one document. It knows no topic: an add-on joins its own layers.

/** A fragment of a document: the document of one file or of one owner. */
export interface LayerFragment {
  /** The name of the fragment, for example the path of its file. A finding names its fragments with it. */
  readonly name: string;
  /** The document of the fragment. The join reads only its field `layers`. */
  readonly doc: Layered;
}

/** The layer of one fragment, as `join` of an add-on gets it. */
export interface LayerPiece<Layer> {
  /** The name of the fragment of the layer. */
  readonly from: string;
  /** The layer that `parse` gave. */
  readonly layer: Layer;
}

/**
 * The join of an add-on: the function that makes one layer from the layers of two or more fragments.
 * It has `schema` and `parse` of `AddOn`. Thus one value can be an add-on and its join.
 */
export interface LayerJoiner<Layer> {
  /** The name of the format of the layer, for example `spend/1`. */
  readonly schema: string;
  /**
   * This function reads the JSON of a layer.
   *
   * @param value - The value of the layer in a fragment.
   * @returns The layer, or the faults of its form.
   */
  parse(value: unknown): LayerParse<Layer>;
  /**
   * This function joins the layers of two or more fragments. The joined layer becomes the value of the layer in the
   * joined document, so `parse` must read it.
   *
   * @param pieces - The layers that `parse` gave, in the order of the fragments. The list has two or more items.
   * @returns The joined layer, or the faults of the join, for example two records with one `id`.
   */
  join(pieces: readonly LayerPiece<Layer>[]): LayerParse<Layer>;
}

/** These are the codes of the findings of `joinLayers`. Each one is an error. */
export const JOIN_CODES: readonly ["layer-name", "layer-twice", "layer-form", "layer-join"] = ["layer-name", "layer-twice", "layer-form", "layer-join"];

/** A code of `JOIN_CODES`. */
export type JoinCode = (typeof JOIN_CODES)[number];

/** A finding of `joinLayers`: a layer that the fragments cannot become one layer. */
export interface JoinFinding extends LayerFinding {
  readonly code: JoinCode;
  /** The names of the fragments of the finding, in the order of the fragments. */
  readonly from: readonly string[];
}

/** The result of `joinLayers`: the layers of the one document, or the findings. A join with a finding gives no layers. */
export type LayersJoin = { readonly ok: true; readonly layers: Readonly<Record<string, unknown>> } | { readonly ok: false; readonly findings: readonly JoinFinding[] };

/** This function gives the names of some fragments as one text for a message. */
function quoted(names: readonly string[]): string {
  return names.map((name) => `"${name}"`).join(", ");
}

/**
 * This function joins the layers of the fragments of a document.
 *
 * - A layer of one fragment stays as it is. The function does not examine it, and no add-on reads it.
 * - A layer of two or more fragments goes to `join` of the first add-on of its name, in the order of the fragments.
 * - Such a layer with a name that `isLayerName` refuses gets the error `layer-name`. No add-on reads it.
 * - With no add-on of its name, such a layer gets the error `layer-twice`. The function does not join records itself.
 * - A layer that its add-on cannot read gets one error `layer-form` for each fault of its form, with its fragment.
 *   Then `join` does not start for that layer.
 * - Each fault of `join` is one error `layer-join`, with the fragments of the layer.
 *
 * The layers of the result and the findings are in the order of the layer names. The function does not change a
 * fragment. It does not examine the names of the fragments: a core gives a different name to each fragment.
 * `checkLayers` examines the joined layers afterward, as for each other document.
 *
 * @param fragments - The fragments, in the order that each `join` gets.
 * @param joiners - The joins of the add-ons.
 * @returns The joined layers, or the findings. No fragment gives `{ ok: true, layers: {} }`.
 */
export function joinLayers(fragments: readonly LayerFragment[], joiners: readonly LayerJoiner<unknown>[]): LayersJoin {
  const byName = new Map<string, LayerJoiner<unknown>>();
  for (const joiner of joiners) if (!byName.has(joiner.schema)) byName.set(joiner.schema, joiner);
  const values = new Map<string, { readonly from: string; readonly value: unknown }[]>();
  for (const fragment of fragments) {
    const layers = fragment.doc.layers ?? {};
    for (const name of Object.keys(layers)) {
      const list = values.get(name) ?? [];
      if (list.length === 0) values.set(name, list);
      list.push({ from: fragment.name, value: layers[name] });
    }
  }
  const joined: [string, unknown][] = [];
  const findings: JoinFinding[] = [];
  for (const [name, list] of [...values].sort((a, b) => compareText(a[0], b[0]))) {
    const [first, second] = list;
    if (first === undefined) continue;
    if (second === undefined) {
      joined.push([name, first.value]);
      continue;
    }
    const from = list.map((item) => item.from);
    if (!isLayerName(name)) {
      findings.push({ level: "error", code: "layer-name", layer: name, at: "", from, message: nameMessage(name) });
      continue;
    }
    const joiner = byName.get(name);
    if (joiner === undefined) {
      findings.push({ level: "error", code: "layer-twice", layer: name, at: "", from, message: `The fragments ${quoted(from)} each have the layer "${name}", and no add-on of the join joins it.` });
      continue;
    }
    const pieces: LayerPiece<unknown>[] = [];
    let readable = true;
    for (const item of list) {
      const read = joiner.parse(item.value);
      if (read.ok) pieces.push({ from: item.from, layer: read.layer });
      else {
        readable = false;
        for (const message of read.errors) findings.push({ level: "error", code: "layer-form", layer: name, at: "", from: [item.from], message });
      }
    }
    if (!readable) continue;
    const join = joiner.join(pieces);
    if (join.ok) joined.push([name, join.layer]);
    else for (const message of join.errors) findings.push({ level: "error", code: "layer-join", layer: name, at: "", from, message });
  }
  // `Object.fromEntries` defines each field. Thus a layer with the name `__proto__` stays a field of the result.
  return findings.length === 0 ? { ok: true, layers: Object.fromEntries(joined) } : { ok: false, findings };
}

// The tools of `join` of an add-on. An add-on gives the list and the key of its records, so these functions know no topic.

/** A key that two or more fragments have in one list of records. */
export interface RecordTwice {
  /** The key of the records. */
  readonly key: string;
  /** The names of the fragments with a record of the key, in the order of the fragments. */
  readonly from: readonly string[];
  /** The fault in plain words, with the key and the fragments. With the options `equal` and `text` of `joinRecords`, it also gives the records. */
  readonly message: string;
}

/** The result of `joinRecords`. */
export interface RecordsJoin<Item> {
  /** The records of each piece, in the order of the pieces. Each piece keeps the order of its records. */
  readonly items: readonly Item[];
  /** Each key that two or more fragments have, in the order of the first record of each key. */
  readonly twice: readonly RecordTwice[];
  /** The message of each item of `twice`. Each one is a fault for the result of `join`. */
  readonly errors: readonly string[];
}

/** The options of `joinRecords`. */
export interface RecordsJoinOptions<Item> {
  /**
   * This function tells if two records of one key are equal. With it, equal records of two or more fragments are one record.
   *
   * - The first record of a key is the record of the join. The first record of the key in a later fragment joins it when the two are equal.
   * - A later fragment with a different record is a fault. The message names the first fragment and each fragment with a different record.
   * - Use it for a record that each fragment can declare, for example a unit. Two copies are equal only until one file changes, and then the join gives the fault.
   *
   * The module imports nothing, so the add-on gives the equality, for example a comparison of canonical JSON.
   */
  readonly equal?: (first: Item, other: Item) => boolean;
  /**
   * This function gives the text of a record for a message, for example its canonical JSON.
   *
   * - With `equal`, the message of a fault gives the first record of the key in each fragment of `from`. Thus the reader sees which field is different.
   * - Each record is on a new line after the message, with the name of its fragment. The text of a record can have commas.
   * - With no `equal`, the function does not use this option. Each record of a key is then a fault, also an equal record.
   */
  readonly text?: (item: Item) => string;
}

/**
 * This function joins one list of records of the pieces. Its rule is that each record has one fragment.
 *
 * - The records are in the order of the pieces, and each piece keeps the order of its records.
 * - A key that two or more fragments have is a fault, also when the records are equal.
 * - A key that one fragment has two times is not a fault of the join. `check` of the add-on reads the joined layer.
 * - With the option `equal`, a record that is equal to the first record of its key joins that record, as `RecordsJoinOptions` tells.
 * - With the options `equal` and `text`, the message of a fault gives the record of each fragment.
 *
 * The function counts the fragments by their position. Thus two fragments with one name are two fragments.
 *
 * @param pieces - The pieces, as `join` of an add-on gets them.
 * @param list - This function gives the records of a layer. `undefined` tells that the layer has none.
 * @param key - This function gives the key of a record, for example its `id`.
 * @param noun - The name of a record with a key for a message, for example `record of the part`.
 * @param options - The rule for equal records, and the text of a record for a message. With no option, each key that two or more fragments have is a fault.
 */
export function joinRecords<Layer, Item>(
  pieces: readonly LayerPiece<Layer>[],
  list: (layer: Layer) => readonly Item[] | undefined,
  key: (item: Item) => string,
  noun: string,
  options: RecordsJoinOptions<Item> = {},
): RecordsJoin<Item> {
  if (options.equal !== undefined) return joinEqualRecords(pieces, list, key, noun, options.equal, options.text);
  const items: Item[] = [];
  // The pieces come in sequence. Thus the last position of a key tells if the piece has the key already.
  const owners = new Map<string, { last: number; readonly from: string[] }>();
  pieces.forEach((piece, position) => {
    for (const item of list(piece.layer) ?? []) {
      items.push(item);
      const id = key(item);
      const owner = owners.get(id);
      if (owner === undefined) owners.set(id, { last: position, from: [piece.from] });
      else if (owner.last !== position) {
        owner.last = position;
        owner.from.push(piece.from);
      }
    }
  });
  const twice: RecordTwice[] = [];
  for (const [id, owner] of owners) {
    if (owner.from.length > 1) twice.push({ key: id, from: owner.from, message: `The fragments ${quoted(owner.from)} each have the ${noun} "${id}".` });
  }
  return { items, twice, errors: twice.map((item) => item.message) };
}

/** This function is `joinRecords` with the option `equal`. */
function joinEqualRecords<Layer, Item>(
  pieces: readonly LayerPiece<Layer>[],
  list: (layer: Layer) => readonly Item[] | undefined,
  key: (item: Item) => string,
  noun: string,
  equal: (first: Item, other: Item) => boolean,
  text: ((item: Item) => string) | undefined,
): RecordsJoin<Item> {
  const items: Item[] = [];
  // The first record of each key, the fragments with a different record and their first records. The last position tells if a piece has the key already.
  const owners = new Map<string, { readonly first: Item; last: number; readonly from: string[]; readonly records: Item[] }>();
  pieces.forEach((piece, position) => {
    for (const item of list(piece.layer) ?? []) {
      const id = key(item);
      const owner = owners.get(id);
      if (owner === undefined) owners.set(id, { first: item, last: position, from: [piece.from], records: [item] });
      else if (owner.last !== position) {
        // The first record of the key in a later fragment.
        owner.last = position;
        if (equal(owner.first, item)) continue;
        owner.from.push(piece.from);
        owner.records.push(item);
      }
      items.push(item);
    }
  });
  const twice: RecordTwice[] = [];
  for (const [id, owner] of owners) {
    if (owner.from.length <= 1) continue;
    const message = `The fragments ${quoted(owner.from)} each have the ${noun} "${id}", and the records are not equal.`;
    // Each record has its own line, because a text of a record can have commas.
    const records = text === undefined ? "" : owner.from.map((from, index) => `\n  "${from}": ${text(owner.records[index] as Item)}`).join("");
    twice.push({ key: id, from: owner.from, message: message + records });
  }
  return { items, twice, errors: twice.map((item) => item.message) };
}

/** The result of `joinSetting`. */
export interface SettingJoin<Value> {
  /** The value of the first piece that gives the setting. No such piece gives `undefined`. */
  readonly value: Value | undefined;
  /** One message for each piece that gives a different value. Each one is a fault for the result of `join`. */
  readonly errors: readonly string[];
}

/**
 * This function joins one setting of a whole layer, for example its currency. Its rule is that a layer has one value.
 *
 * - A piece with `undefined` gives no value.
 * - Each other piece must give the value of the first piece that gives one.
 * - Each piece with a different value is one fault, with the two fragments and the two values.
 *
 * @param pieces - The pieces, as `join` of an add-on gets them.
 * @param setting - This function gives the setting of a layer.
 * @param noun - The name of the setting for a message, for example `currency`.
 */
export function joinSetting<Layer, Value extends string | number | boolean>(pieces: readonly LayerPiece<Layer>[], setting: (layer: Layer) => Value | undefined, noun: string): SettingJoin<Value> {
  let first: { readonly from: string; readonly value: Value } | undefined;
  const errors: string[] = [];
  for (const piece of pieces) {
    const value = setting(piece.layer);
    if (value === undefined) continue;
    if (first === undefined) first = { from: piece.from, value };
    else if (value !== first.value) {
      errors.push(`The fragment "${first.from}" has the ${noun} ${JSON.stringify(first.value)}, and the fragment "${piece.from}" has ${JSON.stringify(value)}.`);
    }
  }
  return { value: first?.value, errors };
}
