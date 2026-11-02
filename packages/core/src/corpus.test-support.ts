/*
 * The parts of a seeded property test (K207, D96). Only the tests import this file. The index of the package does not
 * export it, and the npm package does not hold it.
 *
 * A property test examines a corpus: the documents of the indexes 0 up to a count, each from its seed. CI raises the
 * count, thus a test of the whole corpus can pass its timeout on a slow runner. `corpus` splits the indexes into parts
 * of a fixed size. Each part is one test with the name of the part, and a last test examines the totals of all parts.
 * The parts give the same indexes in the same order as one loop, thus the corpus does not change.
 *
 * The name of each test stays a literal at the call site: `it("[ID] text, " + part.name, ...)`. Thus the gate of
 * `spec.test.ts` finds the ID.
 */

/** One part of a corpus: the indexes from `start` up to `end`, without `end`, in order. */
export interface CorpusPart {
  /** The name of the part for the name of its test, for example `part 2 of 4`. */
  readonly name: string;
  /** The first index of the part. */
  readonly start: number;
  /** The index after the last index of the part. */
  readonly end: number;
  /**
   * This function gives the indexes of the part in order. The part is finished when a loop gets to its end. A loop
   * that stops with `break` or an error does not finish the part. A second loop over the part throws an error.
   */
  [Symbol.iterator](): Iterator<number>;
}

/** The parts of a corpus, in the order of their indexes. */
export interface Corpus {
  /** The number of indexes of the corpus. */
  readonly count: number;
  /** The parts. Each part holds `size` indexes, and the last part can hold fewer. */
  readonly parts: readonly CorpusPart[];
  /**
   * This function gives the names of the parts that did not finish. A last test examines it before the totals. Then a
   * filter that skips a part, or a part that fails, does not give wrong totals.
   */
  unfinished(): readonly string[];
}

/**
 * This function splits the indexes 0 up to `count` into parts of `size` indexes, in order.
 *
 * @param count - The number of indexes: a whole number, 0 or more.
 * @param size - The number of indexes of each part: a whole number, 1 or more.
 * @returns The parts, and the names of the parts that did not finish.
 */
export function corpus(count: number, size: number): Corpus {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`The count of a corpus must be a whole number, 0 or more. It is ${count}.`);
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`The size of a part must be a whole number, 1 or more. It is ${size}.`);
  const total = Math.ceil(count / size);
  const started = new Set<string>();
  const finished = new Set<string>();
  const parts: CorpusPart[] = [];
  for (let at = 0; at < total; at += 1) {
    const start = at * size;
    const end = Math.min(count, start + size);
    const name = `part ${at + 1} of ${total}`;
    parts.push({
      name,
      start,
      end,
      *[Symbol.iterator](): Generator<number, void, undefined> {
        // The totals count each part one time, thus a second loop is an error.
        if (started.has(name)) throw new Error(`The ${name} of the corpus already started. A part runs one time.`);
        started.add(name);
        for (let index = start; index < end; index += 1) yield index;
        finished.add(name);
      },
    });
  }
  return { count, parts, unfinished: () => parts.filter((part) => !finished.has(part.name)).map((part) => part.name) };
}

/**
 * This function gives the items of a stream in the order of their indexes. Use it when one source of random numbers
 * makes the items one after the other. It uses the function `make` one time for each index, in the order 0, 1, 2.
 * Thus a part that starts at a later index gets the same items as one loop.
 *
 * @param make - The function that makes the item of an index. It can advance a shared state, for example a `Random`.
 * @returns A function that gives the item of an index. It first makes each earlier item that it did not make.
 */
export function inOrder<T>(make: (index: number) => T): (index: number) => T {
  const items: T[] = [];
  return (index) => {
    if (!Number.isInteger(index) || index < 0) throw new RangeError(`The index of a stream must be a whole number, 0 or more. It is ${index}.`);
    while (items.length <= index) items.push(make(items.length));
    return items[index] as T;
  };
}
