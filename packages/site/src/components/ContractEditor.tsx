import { Fragment, useId, useState } from "react";
import { docEquals, type Json } from "@mark1russell7/coeval";
import type { DataEditor, Editor } from "../lib/contract.ts";
import { isHole } from "../lib/contract.ts";
import { dataField, dataText, dropStep, followData, followPath, numberOfText, pathField, readPath, typeNumber, typePath, type NumberEditor, type PathField } from "../lib/fields.ts";
import { stepText } from "../lib/moves.ts";

/**
 * The input of a number. It keeps the text that the reader types, and it writes a value only when the text is a number
 * that the contract accepts. Thus an empty field stays empty, and the document keeps its last number (K274, D214).
 */
function NumberInput({ editor, value, onValue }: { readonly editor: NumberEditor; readonly value: Json | undefined; readonly onValue: (next: Json) => void }) {
  const [field, setField] = useState(() => dataField(value));
  const shown = followData(field, value);
  if (shown !== field) setField(shown);
  return (
    <input
      type="number"
      value={shown.text}
      step={editor.whole ? 1 : "any"}
      min={editor.min}
      max={editor.max}
      aria-invalid={shown.text.trim() !== "" && numberOfText(shown.text, editor) === undefined}
      onChange={(event) => {
        const next = typeNumber(shown, event.target.value, editor);
        setField(next);
        if (next.value !== undefined && !docEquals(next.value, shown.value)) onValue(next.value);
      }}
      onBlur={() => setField(dataField(shown.value))}
    />
  );
}

/** One input for data, from a shape of a contract. */
function DataInput({ editor, label, value, onValue }: { readonly editor: DataEditor; readonly label: string; readonly value: Json | undefined; readonly onValue: (next: Json) => void }) {
  return (
    <label className="cv-field-edit">
      <span>{label}</span>
      {editor.form === "one" ? (
        <select value={JSON.stringify(value ?? null)} onChange={(event) => onValue(JSON.parse(event.target.value) as Json)}>
          {editor.values.map((option) => (
            <option key={JSON.stringify(option)} value={JSON.stringify(option)}>
              {JSON.stringify(option)}
            </option>
          ))}
        </select>
      ) : editor.form === "number" ? (
        <NumberInput editor={editor} value={value} onValue={onValue} />
      ) : (
        <input type="text" value={dataText(value)} onChange={(event) => onValue(event.target.value)} />
      )}
    </label>
  );
}

/** The props of the editor of a value. */
export interface ContractEditorProps {
  /** The editor that the contract of the kind gives. */
  readonly editor: Editor;
  /** The value of the document. */
  readonly value: Json | undefined;
  /** The names that a reference can read at this position. */
  readonly names: readonly string[];
  /** This function replaces the value. */
  readonly onValue: (next: Json) => void;
  /** This function selects the document in a field. */
  readonly onSelectField: (key: string) => void;
  /** This function puts a hole in a field. */
  readonly onFillField: (key: string) => void;
  /** This function removes a field. */
  readonly onClearField: (key: string) => void;
}

/**
 * The editor of a reference: the keys of its path, and a button for each name that the scope binds here. The field
 * keeps the text that the reader types, and it reads the text on blur or Enter. A step that no text holds, for example
 * a step document, is a chip between two texts (K274, D214).
 */
function PathEditor({ value, names, onValue }: Pick<ContractEditorProps, "value" | "names" | "onValue">) {
  const help = useId();
  const first = useId();
  const path = Array.isArray(value) ? (value as readonly Json[]) : [];
  const [field, setField] = useState(() => pathField(path));
  const shown = followPath(field, path);
  if (shown !== field) setField(shown);
  const use = (next: PathField): void => {
    setField(next);
    if (!docEquals(next.path, path)) onValue(next.path);
  };
  return (
    <>
      <div className="cv-field-edit">
        <label htmlFor={first}>Path</label>
        <div className="cv-path-edit">
          {shown.texts.map((text, index) => {
            const step = index === 0 ? undefined : shown.steps[index - 1];
            const name = step === undefined ? undefined : stepText(step);
            return (
              <Fragment key={index}>
                {name !== undefined && (
                  <>
                    <span className="ce-chip" title={JSON.stringify(step)}>
                      {name}
                    </span>
                    <button type="button" className="ce-btn" aria-label={`Remove the step ${name}`} onClick={() => use(dropStep(shown, index - 1))}>
                      ×
                    </button>
                  </>
                )}
                <input
                  type="text"
                  {...(index === 0 ? { id: first } : { "aria-label": `The keys after the step ${name ?? ""}` })}
                  aria-describedby={help}
                  value={text}
                  onChange={(event) => setField(typePath(shown, index, event.target.value))}
                  onBlur={() => use(readPath(shown))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") use(readPath(shown));
                  }}
                />
              </Fragment>
            );
          })}
        </div>
        <span id={help} className="cv-small cv-muted" style={{ gridColumn: "2" }}>
          A root (self, names, world, event or caps), then the keys, with a comma between them. Press Enter or leave the field to use the text.
        </span>
      </div>
      {names.length > 0 && (
        <div className="ce-bar-group" role="group" aria-label="The names at this place">
          <span className="cv-small cv-muted">Names at this place</span>
          {names.map((name) => (
            <button key={name} type="button" className="ce-btn" aria-pressed={path[0] === "names" && path[1] === name} onClick={() => onValue(["names", name])}>
              {name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** The fields of a record, from its contract. A necessary field has a mark, and a field with data has an input. */
function RecordEditor({ editor, value, onValue, onSelectField, onFillField, onClearField }: Omit<ContractEditorProps, "editor" | "names"> & { readonly editor: Extract<Editor, { readonly form: "record" }> }) {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, Json>>) : {};
  return (
    <ul className="cv-fields">
      {editor.fields.map((field) => {
        const held = Object.hasOwn(record, field.key) ? record[field.key] : undefined;
        if (field.data !== undefined) {
          return (
            <li key={field.key}>
              <DataInput editor={field.data} label={field.key} value={held} onValue={(next) => onValue({ ...record, [field.key]: next })} />
            </li>
          );
        }
        return (
          <li key={field.key} className="cv-field-row">
            <span className="ce-mono">{field.key}</span>
            <span className="cv-small cv-muted">{field.required ? "necessary" : "optional"}</span>
            {held === undefined ? (
              <button type="button" className="ce-btn" onClick={() => onFillField(field.key)}>
                Add this field
              </button>
            ) : (
              <button type="button" className="ce-btn" onClick={() => onSelectField(field.key)}>
                {isHole(held) ? "Select the empty place" : "Select it"}
              </button>
            )}
            {!field.required && held !== undefined && (
              <button type="button" className="ce-btn" onClick={() => onClearField(field.key)}>
                Remove this field
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * This component gives the editor of a value from the contract of its kind. It names no kind. A form without an
 * input gives no element, because the parts of a list are cards of the picture.
 */
export default function ContractEditor(props: ContractEditorProps) {
  const { editor, value, onValue } = props;
  switch (editor.form) {
    case "text":
    case "number":
    case "one":
      return <DataInput editor={editor} label="Value" value={value} onValue={onValue} />;
    case "path":
      return <PathEditor value={value} names={props.names} onValue={onValue} />;
    case "record":
      return <RecordEditor {...props} editor={editor} />;
    default:
      return null;
  }
}
