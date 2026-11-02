/*
 * The settings of the samples of a bench run (K199). `cases.ts` measures with them, and `paths.ts` writes them into
 * its record. A child process gets the environment of `paths.ts`, thus both files read the same values.
 */

/** The time of one sample in milliseconds (`BENCH_MS`). */
export const TARGET_MS = Number(process.env["BENCH_MS"] ?? 25);

/** The first samples of each case in one process (`BENCH_WARMUP`). They only warm up the code, and they do not count. */
export const WARMUP = Number(process.env["BENCH_WARMUP"] ?? 3);

/** The samples of each case in one process that count (`BENCH_SAMPLES`). */
export const SAMPLES = Number(process.env["BENCH_SAMPLES"] ?? 5);
