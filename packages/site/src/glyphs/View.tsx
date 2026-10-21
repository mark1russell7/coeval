import { createContext, useContext, type ComponentType } from "react";
import {
  STD_WORLD,
  ask,
  fromJson,
  isRecord,
  kindDocument,
  kindNamed,
  splitParts,
  typeName,
  typed,
  type Envelope,
  type Json,
  type Kind,
  type Rung,
  type World,
} from "@mark1russell7/coeval";
import Card from "./Card.tsx";
import { OverlayContext, STATIC_OVERLAY } from "./overlay.ts";
import ValueGlyph from "./Value.tsx";

/**
 * The world of the site: the standard world, and the kind `kind`. A kind is a document too, thus the site draws a
 * kind with a view, as it draws each other document.
 */
export const SITE_WORLD: World = {
  kinds: {
    ...STD_WORLD.kinds,
    kind: { verbs: { view: "view.kind" }, summary: "A kind: the evaluator of each verb, and the contract of its value." },
  },
  defaults: STD_WORLD.defaults,
};

/** The world that the views of a picture ask. */
export const WorldContext = createContext<World>(SITE_WORLD);

/**
 * This hook gives the world of the picture.
 *
 * @returns The world.
 */
export function useWorld(): World {
  return useContext(WorldContext);
}

/**
 * This function makes the document of a kind, so that a picture can draw the kind with its view.
 *
 * @param name - The name of the kind.
 * @param kind - The kind.
 * @returns The document of type `kind`.
 */
export function kindDoc(name: string, kind: Kind): Envelope {
  return kindDocument(name, kind);
}

/** The props of a view. */
export interface ViewProps {
  readonly doc: Envelope;
  readonly declared: boolean;
  readonly path: readonly string[];
  readonly rung?: Rung;
  readonly unknown: boolean;
}

const SYMBOLS: Readonly<Record<string, string>> = { add: "+", multiply: "×", greater: ">" };

/** The parts of a document, drawn with their own views, in the layout of the contract of its kind. */
function Parts({ doc, path }: { readonly doc: Envelope; readonly path: readonly string[] }) {
  const world = useWorld();
  const kind = kindNamed(world, doc.type);
  const split = splitParts(kind?.parts, doc.value);
  if (!split.ok) {
    return (
      <>
        <span className="cv-problem">{split.reason}</span>
        <ValueGlyph value={doc.value} />
      </>
    );
  }
  const data = split.data;
  const hasData = data !== null && !(isRecord(data) && Object.keys(data).length === 0);
  if (kind?.parts?.shape === "record") {
    return (
      <div className="cv-slots">
        {hasData && (
          <>
            <span className="cv-slot-label">data</span>
            <span>
              <ValueGlyph value={data} />
            </span>
          </>
        )}
        {split.parts.map((slot) => (
          <div key={slot.key} className="cv-slot">
            <span className="cv-slot-label">{slot.key}</span>
            <View doc={slot.item} path={[...path, slot.key]} {...(slot.of === undefined ? {} : { declaredType: slot.of })} />
          </div>
        ))}
      </div>
    );
  }
  if (kind?.parts?.shape === "list") {
    const symbol = SYMBOLS[typeName(doc.type)];
    return (
      <div className="cv-row">
        {split.parts.length === 0 && <span className="cv-problem">no parts</span>}
        {split.parts.map((slot, index) => (
          <span key={slot.key} className="cv-row-item">
            {index > 0 && symbol !== undefined && (
              <span className="cv-symbol" aria-hidden="true">
                {symbol}
              </span>
            )}
            <View doc={slot.item} path={[...path, slot.key]} {...(slot.of === undefined ? {} : { declaredType: slot.of })} />
          </span>
        ))}
      </div>
    );
  }
  return <ValueGlyph value={doc.value} />;
}

/** The view of a value document: a small card with the value. */
function ValueView({ doc, declared, path, rung, unknown }: ViewProps) {
  return (
    <Card doc={doc} declared={declared} path={path} unknown={unknown} variant="value" {...(rung === undefined ? {} : { rung })}>
      <ValueGlyph value={doc.value} size="large" />
    </Card>
  );
}

/** The view of a document with parts: its parts in the layout of its contract. */
function PartsView({ doc, declared, path, rung, unknown }: ViewProps) {
  const world = useWorld();
  return (
    <Card
      doc={doc}
      declared={declared}
      path={path}
      unknown={unknown}
      side={kindNamed(world, doc.type)?.side ?? "derive"}
      {...(rung === undefined ? {} : { rung })}
    >
      <Parts doc={doc} path={path} />
    </Card>
  );
}

/** The view of a reference: an arrow back to a name of the context. */
function RefView({ doc, declared, path, rung, unknown }: ViewProps) {
  const steps: readonly Json[] = Array.isArray(doc.value) ? doc.value : [];
  return (
    <Card doc={doc} declared={declared} path={path} unknown={unknown} variant="value" {...(rung === undefined ? {} : { rung })}>
      <PathChips steps={steps} />
    </Card>
  );
}

/**
 * The glyph of a path: the root first, in the color of its part of the context, then one chip for each step. A
 * step document is drawn with its own view.
 */
export function PathChips({ steps }: { readonly steps: readonly Json[] }) {
  if (steps.length === 0) return <span className="cv-problem">no path</span>;
  const [root, ...rest] = steps;
  const part = root === "self" ? "focus" : typeof root === "string" ? root : "names";
  return (
    <span className="cv-path" title="A path: a root of the context, then one step at a time">
      <span className="cv-path-root" data-part={part}>
        {String(root)}
      </span>
      {rest.map((step, index) =>
        typeof step === "string" || typeof step === "number" ? (
          <span key={index} className="cv-path-step">
            {String(step)}
          </span>
        ) : (
          <span key={index} className="cv-path-doc">
            <OverlayContext.Provider value={STATIC_OVERLAY}>
              <View doc={step} />
            </OverlayContext.Provider>
          </span>
        ),
      )}
    </span>
  );
}

/** The view of a sequence: its steps in their written order, with a number for each step. */
function SeqView({ doc, declared, path, rung, unknown }: ViewProps) {
  const items: readonly Json[] = Array.isArray(doc.value) ? doc.value : [];
  return (
    <Card doc={doc} declared={declared} path={path} unknown={unknown} {...(rung === undefined ? {} : { rung })}>
      <ol className="cv-steps">
        {items.map((item, index) => (
          <li key={index} className="cv-step">
            <span className="cv-step-number">{index + 1}</span>
            <View doc={item} path={[...path, String(index)]} />
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** The view of a kind: the evaluator of each verb, and the contract of the value. */
function KindView({ doc, declared, path, rung, unknown }: ViewProps) {
  const value = isRecord(doc.value) ? doc.value : {};
  const verbs = isRecord(value["verbs"] ?? null) ? (value["verbs"] as Record<string, Json>) : {};
  return (
    <Card doc={doc} declared={declared} path={path} unknown={unknown} {...(rung === undefined ? {} : { rung })}>
      <div className="cv-kind">
        <span className="cv-kind-name">{String(value["name"] ?? "?")}</span>
        {typeof value["summary"] === "string" && value["summary"] !== "" && (
          <span className="cv-kind-summary">{value["summary"]}</span>
        )}
        <table className="cv-kind-verbs">
          <tbody>
            {Object.entries(verbs).map(([verb, name]) => (
              <tr key={verb}>
                <th scope="row">{verb}</th>
                <td>{String(name)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">parts</th>
              <td>{String(value["parts"] ?? "none")}</td>
            </tr>
            <tr>
              <th scope="row">side</th>
              <td>
                <span className="ce-badge" data-side={value["side"] === "run" ? "run" : "derive"}>
                  {value["side"] === "run" ? "run" : "derive"}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** The default view: the value as data. */
function CardView({ doc, declared, path, rung, unknown }: ViewProps) {
  return (
    <Card doc={doc} declared={declared} path={path} unknown={unknown} {...(rung === undefined ? {} : { rung })}>
      <ValueGlyph value={doc.value} />
    </Card>
  );
}

/** The code of each view name. A world names the views. The site gives their code. */
export const VIEWS: Readonly<Record<string, ComponentType<ViewProps>>> = {
  "view.value": ValueView,
  "view.op": PartsView,
  "view.ref": RefView,
  "view.seq": SeqView,
  "view.kind": KindView,
  "view.card": CardView,
};

/** The props of the view of a document. */
export interface ViewOfProps {
  /** The document, as JSON: an envelope, or a bare value in a position that declares its type. */
  readonly doc: Json;
  /** The path of the document from the root of the picture. */
  readonly path?: readonly string[];
  /** The type that the position declares for a bare value. */
  readonly declaredType?: string;
}

/**
 * The view of a document. It asks the document the verb `view` through the ladder, and draws the view that
 * answers. A view draws the parts of its document with this component again. Thus the picture of a document is
 * made of the pictures of its parts, as the document is made of its parts.
 */
export function View({ doc, path = [], declaredType }: ViewOfProps) {
  const world = useWorld();
  const envelope = fromJson(doc);
  const shown = envelope ?? typed(declaredType ?? "?", doc);
  const answer = ask(world, envelope ?? {}, "view", declaredType === undefined ? {} : { declaredType });
  const name = answer.evaluator;
  const Component = (name !== undefined && Object.hasOwn(VIEWS, name) ? VIEWS[name] : undefined) ?? CardView;
  return (
    <Component
      doc={shown}
      declared={envelope === undefined}
      path={path}
      unknown={answer.error === "unknown-kind" || (envelope === undefined && declaredType === undefined)}
      {...(answer.rung === undefined ? {} : { rung: answer.rung })}
    />
  );
}
