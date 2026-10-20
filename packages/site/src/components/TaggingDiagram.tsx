import { useState } from "react";
import { typed, type Json } from "@coeval/core";
import { View, WorldContext } from "../glyphs/View.tsx";
import type { World } from "@coeval/core";

const THINGS = [
  { id: "rule", label: "A rule (a record)", type: "rule", value: { use: "stack", gap: 8 } as Json },
  { id: "size", label: "A size (a number)", type: "size", value: 42 as Json },
  { id: "alert", label: "An alert with its own field type", type: "alert", value: { type: "warning", text: "low disk" } as Json },
  { id: "path", label: "A path (a list)", type: "path", value: ["header", "menu"] as Json },
] as const;

const WORLD: World = {
  kinds: { rule: { verbs: {} }, size: { verbs: {} }, alert: { verbs: {} }, path: { verbs: {} } },
  defaults: { view: "view.card" },
};

interface Verdict {
  readonly ok: boolean;
  readonly why: string;
}

interface Way {
  readonly id: string;
  readonly title: string;
  readonly json: Json | undefined;
  readonly tagAnything: Verdict;
  readonly untouched: Verdict;
  readonly header: Verdict;
  readonly known: Verdict;
}

function ways(type: string, value: Json): readonly Way[] {
  const isRecord = typeof value === "object" && value !== null && !Array.isArray(value);
  const record = isRecord ? (value as Record<string, Json>) : {};
  const collides = isRecord && Object.hasOwn(record, "type");
  return [
    {
      id: "internal",
      title: "A reserved key in the value",
      json: isRecord ? { type, ...record, ...(collides ? { type } : {}) } : undefined,
      tagAnything: isRecord ? { ok: true, why: "A record can hold the key." } : { ok: false, why: "A number or a list has no key for the tag." },
      untouched: collides
        ? { ok: false, why: "The value has its own field type. The tag overwrites it." }
        : isRecord
          ? { ok: false, why: "The tag is mixed into the fields of the value." }
          : { ok: false, why: "There is no value to keep." },
      header: { ok: false, why: "A name or an own entry needs one more reserved key." },
      known: { ok: true, why: "The key gives the type." },
    },
    {
      id: "envelope",
      title: "An envelope: { type, value }",
      json: { type, value },
      tagAnything: { ok: true, why: "The value can be any JSON value." },
      untouched: { ok: true, why: "The value is never changed." },
      header: { ok: true, why: "A name and own entries go beside type." },
      known: { ok: true, why: "The envelope gives the type." },
    },
    {
      id: "external",
      title: "The type as the only key",
      json: { [type]: value },
      tagAnything: { ok: true, why: "The value can be any JSON value." },
      untouched: { ok: true, why: "The value is not changed." },
      header: { ok: false, why: "The record has one key only. A name has no place." },
      known: { ok: true, why: "The key gives the type." },
    },
    {
      id: "untagged",
      title: "No tag: the shape decides",
      json: value,
      tagAnything: { ok: false, why: "There is no tag." },
      untouched: { ok: true, why: "The value is not changed." },
      header: { ok: false, why: "There is no header." },
      known: { ok: false, why: "A guess from the fields gives the type. Two shapes can match." },
    },
  ];
}

function Mark({ verdict }: { readonly verdict: Verdict }) {
  return (
    <td title={verdict.why}>
      <span className="ce-verdict" data-ok={verdict.ok}>
        {verdict.ok ? "yes" : "no"}
      </span>
      <span className="cv-why">{verdict.why}</span>
    </td>
  );
}

/**
 * The tagging diagram. It writes one thing with a type in four ways. A reader picks the thing. The table shows
 * which way can tag it and keep its value. It also shows the room for a header, and the type without a guess.
 */
export default function TaggingDiagram() {
  const [id, setId] = useState<string>("alert");
  const thing = THINGS.find((item) => item.id === id) ?? THINGS[0];
  const rows = ways(thing.type, thing.value);

  return (
    <figure className="ce-figure not-content" aria-label="Four ways to give a value a type">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="The thing to tag">
          <span className="ce-bar-label">Tag</span>
          {THINGS.map((item) => (
            <button key={item.id} type="button" className="ce-btn" aria-pressed={item.id === id} onClick={() => setId(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ce-stage ce-scroll">
        <table className="ce-table cv-ways">
          <thead>
            <tr>
              <th>Way</th>
              <th>JSON</th>
              <th>Tags any value</th>
              <th>Keeps the value</th>
              <th>Room for a header</th>
              <th>Type without a guess</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-chosen={row.id === "envelope"}>
                <th scope="row">{row.title}</th>
                <td>
                  {row.json === undefined ? (
                    <span className="cv-muted">not possible</span>
                  ) : (
                    <code className="cv-code">{JSON.stringify(row.json)}</code>
                  )}
                </td>
                <Mark verdict={row.tagAnything} />
                <Mark verdict={row.untouched} />
                <Mark verdict={row.header} />
                <Mark verdict={row.known} />
              </tr>
            ))}
          </tbody>
        </table>
        <div className="cv-envelope-demo">
          <p className="ce-panel-title">The envelope, drawn as a card</p>
          <WorldContext.Provider value={WORLD}>
            <View doc={typed(thing.type, thing.value)} />
            <View doc={typed(thing.type, thing.value, { name: "mine", own: { view: "special.view" } })} />
          </WorldContext.Provider>
          <p className="ce-bar-label">
            The tab is the type. The body is the value, as it was. The second card has a header with a name and an own
            entry.
          </p>
        </div>
      </div>
      <figcaption className="ce-caption">
        Only the envelope gets four times yes. It costs one level of nesting. A position that declares its type can hold
        a bare value, thus the nesting is necessary only where the type is open.
      </figcaption>
    </figure>
  );
}
