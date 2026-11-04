import { useMemo, useState } from "react";
import type { Finding, Obligation } from "@mark1russell7/coeval";
import { CODE_BREAKS, OBLIGATION_ROWS, checkCode } from "../lib/conform.ts";
import { resultText } from "../lib/effects.ts";

/** The first finding of each obligation of a check. */
function firstOfEach(findings: readonly Finding[]): ReadonlyMap<Obligation, Finding> {
  const first = new Map<Obligation, Finding>();
  for (const finding of findings) if (!first.has(finding.obligation)) first.set(finding.obligation, finding);
  return first;
}

/** The record of one finding: its reason and the probe that shows it. */
function FindingPanel({ finding }: { readonly finding: Finding }) {
  const { probe } = finding;
  const parts = Object.entries(probe.results);
  return (
    <div className="ce-result" data-state="stop" style={{ display: "block" }}>
      <p style={{ margin: "0 0 var(--space-2)" }}>
        <strong>{finding.reason}</strong>
      </p>
      <p style={{ margin: "0 0 var(--space-1)" }}>The probe that shows it:</p>
      <pre className="ce-mono" style={{ margin: "0 0 var(--space-2)", overflowX: "auto", fontSize: "0.8rem" }}>{JSON.stringify(probe.doc)}</pre>
      {parts.length > 0 && (
        <p style={{ margin: 0 }}>
          The results of its parts: <span className="ce-mono">{parts.map(([key, result]) => `${key} = ${resultText(result)}`).join(", ")}</span>
        </p>
      )}
      <p style={{ margin: "var(--space-1) 0 0" }}>{probe.running ? "The probe is a run." : "The probe is an evaluation."}</p>
    </div>
  );
}

/** This component runs `conforms` on code that the reader breaks, and it shows each finding with its probe. */
export default function ConformDiagram() {
  const [breakId, setBreakId] = useState("good");
  const [permitted, setPermitted] = useState(false);
  const [open, setOpen] = useState<Obligation | undefined>(undefined);
  const item = CODE_BREAKS.find((each) => each.id === breakId) ?? CODE_BREAKS[0];
  const findings = useMemo(() => (item === undefined ? [] : checkCode(item, permitted)), [item, permitted]);
  const first = firstOfEach(findings);
  const shown = (open === undefined ? undefined : first.get(open)) ?? findings[0];

  const choose = (id: string): void => {
    setBreakId(id);
    setPermitted(false);
    setOpen(undefined);
  };

  return (
    <figure className="ce-figure not-content" aria-label="The check conforms on code that the reader breaks">
      <div className="ce-bar">
        <div className="ce-bar-group" role="group" aria-label="The code of the kind">
          <span className="ce-bar-label">The code</span>
          {CODE_BREAKS.map((each) => (
            <button key={each.id} type="button" className="ce-btn" aria-pressed={each.id === breakId} onClick={() => choose(each.id)}>
              {each.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ce-stage">
        <pre className="ce-mono" style={{ margin: "0 0 var(--space-3)", overflowX: "auto", fontSize: "0.85rem" }}>{item?.code}</pre>

        {item?.permit !== undefined && (
          <p style={{ margin: "0 0 var(--space-3)" }}>
            <button type="button" className="ce-btn" aria-pressed={permitted} onClick={() => setPermitted(!permitted)}>
              Declare it in the contract
            </button>{" "}
            <span className="ce-mono ce-bar-label">{JSON.stringify(item.permit)}</span>
          </p>
        )}

        <table className="ce-matrix">
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">What it asks</th>
              <th scope="col">Check</th>
            </tr>
          </thead>
          <tbody>
            {OBLIGATION_ROWS.map((row) => {
              const finding = first.get(row.id);
              return (
                <tr key={row.id} style={{ cursor: "default" }}>
                  <th scope="row">{row.label}</th>
                  <td>{row.rule}</td>
                  <td>
                    {finding === undefined ? (
                      <span>✓ holds</span>
                    ) : (
                      <button type="button" className="ce-btn" style={{ color: "var(--ce-stop)", background: "var(--ce-stop-wash)", borderColor: "var(--ce-stop)", borderWidth: shown?.obligation === row.id ? "2px" : undefined, fontWeight: shown?.obligation === row.id ? 700 : undefined, whiteSpace: "nowrap" }} aria-pressed={shown?.obligation === row.id} onClick={() => setOpen(row.id)}>
                        ✕ broken
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div aria-live="polite" style={{ marginTop: "var(--space-3)" }}>
          {shown === undefined ? (
            <div className="ce-result" data-state="go">
              <span>
                <code>conforms</code> gives no finding.
              </span>
            </div>
          ) : (
            <FindingPanel finding={shown} />
          )}
        </div>
      </div>

      <figcaption className="ce-caption">
        The site runs <code>conforms</code> in this page for each change. A check mark tells that the rule holds. A cross tells that a probe broke the rule. Select it to see the probe.
      </figcaption>
    </figure>
  );
}
