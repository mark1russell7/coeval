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
      findings.push({ level: "error", code: "layer-name", layer: name, at: "", message: `The layer "${name}" has a name that is not a word, a slash and a version, for example "spend/1".` });
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
