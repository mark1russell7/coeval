import { describe, expect, it } from "vitest";
import { createSequence, type Timers } from "./sequence.ts";

/** This function gives timers that start only when the test fires them. */
function manualTimers(): Timers & { readonly fire: () => void; readonly count: () => number } {
  const waiting = new Map<number, { readonly run: () => void; readonly delay: number }>();
  let next = 1;
  return {
    start: (run, delay) => {
      waiting.set(next, { run, delay });
      return next++;
    },
    stop: (id) => {
      waiting.delete(id);
    },
    fire: () => {
      const first = [...waiting.entries()].sort((a, b) => a[1].delay - b[1].delay || a[0] - b[0])[0];
      if (first === undefined) return;
      waiting.delete(first[0]);
      first[1].run();
    },
    count: () => waiting.size,
  };
}

describe("a sequence of steps", () => {
  it("shows the steps one at a time, then the idle phase", () => {
    const timers = manualTimers();
    const shown: string[] = [];
    const done: string[] = [];
    const sequence = createSequence<string>(timers, (phase: string) => shown.push(phase), "idle");
    sequence.play([["a", () => done.push("a")], ["b", () => done.push("b")]], false);
    expect(done).toEqual([]);
    timers.fire();
    expect([shown, done]).toEqual([["a"], ["a"]]);
    timers.fire();
    timers.fire();
    expect([shown, done]).toEqual([["a", "b", "idle"], ["a", "b"]]);
    expect(timers.count()).toBe(0);
  });

  it("makes the changes of the earlier play first, when a new play comes before its end", () => {
    const timers = manualTimers();
    let runs = 0;
    let store = 0;
    const sequence = createSequence<string>(timers, () => undefined, "idle");
    const click = (): void =>
      sequence.play([["run", () => (runs += 1)], ["store", () => (store += 1)]], false);
    click();
    timers.fire();
    // The second click comes before the store step of the first click.
    click();
    expect([runs, store]).toEqual([1, 1]);
    while (timers.count() > 0) timers.fire();
    expect([runs, store]).toEqual([2, 2]);
  });

  it("makes all of the changes at once with reduced motion", () => {
    const timers = manualTimers();
    const shown: string[] = [];
    let changes = 0;
    const sequence = createSequence<string>(timers, (phase: string) => shown.push(phase), "idle");
    sequence.play([["a", () => (changes += 1)], ["b", () => (changes += 1)]], true);
    expect([changes, shown, timers.count()]).toEqual([2, ["idle"], 0]);
  });

  it("stops without the changes of the steps that did not show", () => {
    const timers = manualTimers();
    let changes = 0;
    const sequence = createSequence<string>(timers, () => undefined, "idle");
    sequence.play([["a", () => (changes += 1)]], false);
    sequence.stop();
    expect([changes, timers.count()]).toEqual([0, 0]);
  });
});
