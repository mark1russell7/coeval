import { useState } from "react";
import { evaluate, makeContext, type Json } from "@coeval/core";
import { SITE_MACHINE } from "../glyphs/Explorer.tsx";
import { View, SITE_WORLD, WorldContext } from "../glyphs/View.tsx";
import ValueGlyph from "../glyphs/Value.tsx";

type Cell = "c" | "d" | "e";
type Schedule = "push" | "pull" | "demand" | "once";

const CELLS: readonly Cell[] = ["c", "d", "e"];

const FORMULAS: Readonly<Record<Cell, Json>> = {
  c: { type: "add", value: [{ type: "ref", value: "a" }, { type: "ref", value: "b" }] },
  d: { type: "multiply", value: [{ type: "ref", value: "c" }, 2] },
  e: { type: "multiply", value: [{ type: "ref", value: "a" }, 10] },
};

const DEPS: Readonly<Record<Cell, readonly string[]>> = { c: ["a", "b"], d: ["c"], e: ["a"] };

const SCHEDULES: readonly { readonly id: Schedule; readonly title: string; readonly rule: string }[] = [
  { id: "push", title: "Push", rule: "A change computes each reader at once, in the order of the graph." },
  { id: "pull", title: "Pull", rule: "A change marks the readers as old. A read computes what is old." },
  { id: "demand", title: "Demand", rule: "Each read computes what it needs, one time for each cell." },
  { id: "once", title: "Once", rule: "Each read computes each cell again, as a page that a server renders." },
];

interface Column {
  readonly values: Readonly<Record<Cell, number | undefined>>;
  readonly old: ReadonlySet<Cell>;
  readonly counts: Readonly<Record<Cell, number>>;
  readonly last: ReadonlySet<Cell>;
  readonly read?: { readonly cell: Cell; readonly value: number | undefined };
}

interface State {
  readonly a: number;
  readonly b: number;
  readonly columns: Readonly<Record<Schedule, Column>>;
  readonly action: string;
}

function compute(cell: Cell, names: Readonly<Record<string, Json>>): number | undefined {
  const run = evaluate(SITE_MACHINE, FORMULAS[cell], makeContext(names, []));
  return run.result.ok && typeof run.result.value === "number" ? run.result.value : undefined;
}

function readersOf(name: string): readonly Cell[] {
  const direct = CELLS.filter((cell) => DEPS[cell].includes(name));
  return [...new Set([...direct, ...direct.flatMap((cell) => readersOf(cell))])];
}

/** This function computes cells in the order of the graph, and records each computation. */
function computeAll(cells: readonly Cell[], a: number, b: number, column: Column): Column {
  const values = { ...column.values };
  const counts = { ...column.counts };
  for (const cell of CELLS.filter((item) => cells.includes(item))) {
    values[cell] = compute(cell, { a, b, c: values.c ?? null });
    counts[cell] += 1;
  }
  const old = new Set([...column.old].filter((cell) => !cells.includes(cell)));
  return { ...column, values, counts, old, last: new Set(cells) };
}

function needs(cell: Cell): readonly Cell[] {
  const inner = DEPS[cell].filter((name): name is Cell => (CELLS as readonly string[]).includes(name));
  return [...inner.flatMap((item) => needs(item)), cell];
}

function start(a: number, b: number): State {
  const empty: Column = { values: { c: undefined, d: undefined, e: undefined }, old: new Set(), counts: { c: 0, d: 0, e: 0 }, last: new Set() };
  const ready = computeAll(CELLS, a, b, empty);
  const reset: Column = { ...ready, counts: { c: 0, d: 0, e: 0 }, last: new Set() };
  return { a, b, columns: { push: reset, pull: reset, demand: reset, once: reset }, action: "The cells start with their values." };
}

/**
 * The schedule diagram. Three formulas read two inputs. A reader changes an input and reads a cell. Four
 * schedules compute different cells at different times, and each read gives the same value under each schedule.
 */
export default function ScheduleDiagram() {
  const [state, setState] = useState<State>(() => start(2, 3));

  const change = (): void => {
    setState((current) => {
      const a = current.a + 1;
      const readers = readersOf("a");
      const columns = {
        push: computeAll(readers, a, current.b, current.columns.push),
        pull: { ...current.columns.pull, old: new Set([...current.columns.pull.old, ...readers]), last: new Set<Cell>() },
        demand: { ...current.columns.demand, old: new Set([...current.columns.demand.old, ...readers]), last: new Set<Cell>() },
        once: { ...current.columns.once, old: new Set([...current.columns.once.old, ...readers]), last: new Set<Cell>() },
      };
      return { ...current, a, columns, action: `The input a changes to ${a}.` };
    });
  };

  const read = (cell: Cell): void => {
    setState((current) => {
      const { a, b } = current;
      const push = { ...current.columns.push, last: new Set<Cell>(), read: { cell, value: current.columns.push.values[cell] } };
      const pullNeeded = needs(cell).filter((item) => current.columns.pull.old.has(item));
      const pullColumn = computeAll(pullNeeded, a, b, current.columns.pull);
      const pull = { ...pullColumn, read: { cell, value: pullColumn.values[cell] } };
      const demandColumn = computeAll(needs(cell), a, b, current.columns.demand);
      const demand = { ...demandColumn, read: { cell, value: demandColumn.values[cell] } };
      const onceColumn = computeAll(CELLS, a, b, current.columns.once);
      const once = { ...onceColumn, read: { cell, value: onceColumn.values[cell] } };
      return { ...current, columns: { push, pull, demand, once }, action: `A reader reads the cell ${cell}.` };
    });
  };

  const reads = SCHEDULES.map((schedule) => state.columns[schedule.id].read?.value);
  const lastRead = state.columns.push.read;
  const agree = lastRead !== undefined && reads.every((value) => value === reads[0]);

  return (
    <figure className="ce-figure not-content" aria-label="Four schedules for the same formulas">
      <div className="ce-bar">
        <div className="ce-bar-group">
          <button type="button" className="ce-btn" data-variant="primary" onClick={change}>
            Change a
          </button>
          <button type="button" className="ce-btn" onClick={() => read("d")}>
            Read d
          </button>
          <button type="button" className="ce-btn" onClick={() => read("e")}>
            Read e
          </button>
          <button type="button" className="ce-btn" onClick={() => setState(start(2, 3))}>
            Start again
          </button>
        </div>
        <span className="ce-bar-label">
          a = {state.a}, b = {state.b}. {state.action}
        </span>
      </div>
      <div className="ce-stage">
        <WorldContext.Provider value={SITE_WORLD}>
          <div className="cv-schedules">
            {SCHEDULES.map((schedule) => {
              const column = state.columns[schedule.id];
              const total = CELLS.reduce((sum, cell) => sum + column.counts[cell], 0);
              return (
                <section key={schedule.id} className="cv-schedule" aria-label={schedule.title}>
                  <h4 className="cv-schedule-title">{schedule.title}</h4>
                  <p className="cv-small cv-muted">{schedule.rule}</p>
                  {CELLS.map((cell) => (
                    <div
                      key={cell}
                      className="cv-cell"
                      data-old={column.old.has(cell)}
                      data-lit={column.last.has(cell)}
                    >
                      <span className="cv-cell-name">{cell}</span>
                      <View doc={FORMULAS[cell]} />
                      <span className="cv-cell-value">
                        {column.old.has(cell) ? <span className="cv-muted">old</span> : <ValueGlyph value={column.values[cell] ?? null} />}
                      </span>
                      <span className="cv-cell-count" title="The number of computations of this cell">
                        ×{column.counts[cell]}
                      </span>
                    </div>
                  ))}
                  <p className="cv-small">
                    Computations: <strong>{total}</strong>
                    {column.read !== undefined && (
                      <>
                        . The read of {column.read.cell} gives <strong>{String(column.read.value)}</strong>
                      </>
                    )}
                  </p>
                </section>
              );
            })}
          </div>
        </WorldContext.Provider>
      </div>
      <figcaption className="ce-caption" aria-live="polite">
        {lastRead === undefined
          ? "Select Change a, then Read d. Each schedule computes other cells at other times. A lit cell computed in the last step."
          : agree
            ? `Each schedule reads ${lastRead.cell} = ${String(reads[0])}. The work differs, and the value is the same, because the formulas are pure.`
            : "The schedules disagree. This happens only for a formula with an effect."}
      </figcaption>
    </figure>
  );
}
