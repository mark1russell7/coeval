import type { Key } from "./doc.ts";
import type { Cap } from "./deref.ts";
import { type Machine, capKeys, permits } from "./evaluate.ts";
import { type DocVisit, type Issue, declaredEffects, permitsOf, walk } from "./static.ts";

/*
 * The effects that reach the host (R2 P3, D27). The contract of each kind declares the effects of its documents, and
 * its capability rules narrow the capabilities of its parts (D14). One walk narrows the capabilities as a run does. An
 * effect that the capabilities of its document do not permit fails in the run, thus it does not reach the host.
 *
 * A procedure value keeps the capabilities of the document that made it, as the closure of `fn` does. Thus its latent
 * effects are the effects of its body, under the capabilities of the body, and the fold needs no effect variables.
 */

/** The options of `effectsOf`. */
export interface EffectsOptions {
  /** The type of a bare root value. */
  readonly declaredType?: string;
  /**
   * The capabilities at the root. With them, the result keeps only the effects that the rule of the machine permits at
   * their documents, as a run does (CAP.PERMITS). Without them, the root has each capability, and only the capability
   * rules of the kinds remove an effect.
   */
  readonly caps?: readonly Cap[];
}

/** Each capability: one capability with no keys. It permits each effect, because each kind starts with no keys (CAP.KEYS). */
const EACH: readonly Cap[] = /* @__PURE__ */ Object.freeze([[]]);

/** One declared effect that can reach the host: its keys and the visit of its document. */
interface Reaching {
  readonly kind: readonly Key[];
  readonly visit: DocVisit;
}

/**
 * This function finds each declared effect that can reach the host, in the order of the document. It is the one
 * inference of `effectsOf` and `checkLatent`. `check` and `factsOf` read the same declarations (`declaredEffects`).
 */
function reaching(machine: Machine, doc: unknown, options: EffectsOptions): readonly Reaching[] {
  const out: Reaching[] = [];
  // Without capabilities, the host has no rule to ask. The capability rules of the kinds still narrow each capability.
  const rule = options.caps === undefined ? permits : permitsOf(machine);
  walk(
    machine.world,
    doc,
    (v) => {
      const caps = v.caps ?? EACH;
      for (const kind of declaredEffects(v)) if (rule(caps, kind)) out.push({ kind, visit: v });
      return undefined;
    },
    { caps: options.caps ?? EACH, ...(options.declaredType === undefined ? {} : { declaredType: options.declaredType }) },
  );
  return out;
}

/**
 * This function gives the effects of a document that can reach the host (CAP.EFFECTS-OF, R2 P3). The result is the
 * effects that the contract of each kind declares, without the effects that the capability rules around them remove.
 * A rule `mask` removes each effect of its parts, and a rule `only` removes each effect outside its list.
 *
 * Without capabilities in the options, the result is the least authority of the document. A host that grants these
 * kinds as capabilities grants each effect that a run of the document can give it. With capabilities, the result keeps
 * only the effects that the rule of the machine permits at their documents.
 *
 * The result covers each effect that an evaluation or a run gives the host (CAP.EFFECTS-SOUND). A procedure value keeps
 * the capabilities of the document that made it, thus the effects of its body count at the body (CAP.LATENT). The
 * contract describes the code of its kind. The code of an own entry for another evaluator is outside the result.
 *
 * @param machine - The world and its contracts, and the hook `permits`.
 * @param doc - The document, as JSON.
 * @param options - The type of a bare root value and the capabilities at the root.
 * @returns The kinds of the effects, as texts with dots, each one time, in the order of the document.
 */
export function effectsOf(machine: Machine, doc: unknown, options: EffectsOptions = {}): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { kind } of reaching(machine, doc, options)) {
    const text = kind.join(".");
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/**
 * This function compares the latent effects that a procedure declares with the body of the procedure (CAP.LATENT). A
 * procedure entry is a kind whose code evaluates the document of a procedure. Its field `effects` declares the latent
 * effects: the effects that a call of the procedure can cause. `check` tests each call against this declaration.
 *
 * The function gives a `#CAP!` for each effect of the body that can reach the host and that the declaration does not
 * permit. An effect that a kind in the body masks fails in the body, thus it is not a latent effect.
 *
 * @param machine - The world and its contracts.
 * @param declared - The latent effects that the procedure declares, for example the field `effects` of its kind.
 * @param body - The document of the procedure, as JSON.
 * @param options - The type of a bare root value.
 * @returns The issues, in the order of the body.
 */
export function checkLatent(machine: Machine, declared: readonly Cap[], body: unknown, options: Omit<EffectsOptions, "caps"> = {}): readonly Issue[] {
  const issues: Issue[] = [];
  const list = declared.map((cap) => capKeys(cap).join(".")).join(", ");
  const head = declared.length === 0 ? "The procedure declares no latent effect" : `The procedure declares the latent effects ${list}`;
  for (const { kind, visit } of reaching(machine, body, options.declaredType === undefined ? {} : { declaredType: options.declaredType })) {
    if (permits(declared, kind)) continue;
    issues.push({ code: "#CAP!", place: visit.place, reason: `${head}, and its body can cause the effect ${kind.join(".")} here.`, at: visit.at });
  }
  return issues;
}
