/** A step of a sequence: the phase that it shows, and the change of state that it makes. */
export type Step<P> = readonly [P, () => void];

/** The functions that start and stop a timer. The page gives the functions of the window, and a test gives its own. */
export interface Timers {
  readonly start: (run: () => void, delay: number) => number;
  readonly stop: (id: number) => void;
}

/** A sequence shows its steps one at a time. */
export interface Sequence<P> {
  /**
   * This function shows the steps one at a time. It first makes the changes of the earlier steps that did not show yet.
   * Thus a new play loses no change of an earlier play.
   *
   * @param steps - The steps to show.
   * @param reduced - `true` when the reader asks for less motion. Then all of the steps show at once.
   */
  readonly play: (steps: readonly Step<P>[], reduced: boolean) => void;
  /** This function stops the timers, and does not make the changes of the steps that did not show yet. */
  readonly stop: () => void;
}

/**
 * This function makes a sequence.
 *
 * @param timers - The functions that start and stop a timer.
 * @param show - The function that shows a phase.
 * @param idle - The phase after the last step.
 * @param interval - The time between two steps, in milliseconds.
 * @returns The sequence.
 */
export function createSequence<P>(timers: Timers, show: (phase: P) => void, idle: P, interval = 650): Sequence<P> {
  let pending: { id: number; readonly effect: () => void }[] = [];
  let end: number | undefined;
  const stop = (): void => {
    for (const entry of pending) timers.stop(entry.id);
    pending = [];
    if (end !== undefined) timers.stop(end);
    end = undefined;
  };
  const play = (steps: readonly Step<P>[], reduced: boolean): void => {
    const left = pending;
    stop();
    for (const entry of left) entry.effect();
    if (reduced) {
      for (const [, effect] of steps) effect();
      show(idle);
      return;
    }
    pending = steps.map(([phase, effect], index) => {
      const entry = { id: 0, effect };
      entry.id = timers.start(() => {
        pending = pending.filter((other) => other !== entry);
        show(phase);
        effect();
      }, index * interval);
      return entry;
    });
    end = timers.start(() => {
      end = undefined;
      show(idle);
    }, steps.length * interval + 400);
  };
  return { play, stop };
}
