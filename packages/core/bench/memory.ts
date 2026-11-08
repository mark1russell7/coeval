/*
 * The memory of one call (K209, D105, K116). The ladder of STATIC.LINEAR and the study of a long chain use it.
 *
 * Each measure starts after a full collection by `gc()`. A `GCProfiler` gives each collection in the call, with the heap
 * before and after it. Thus a scavenge in the call loses no bytes.
 *
 * GAP: rigor-bench has no measure of the memory of a call. This module is the one copy in this repository.
 */
import { GCProfiler, setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

/** The memory of one call, in bytes. */
export interface CallMemory {
  /** The bytes that the call allocates: the growth of the heap plus the bytes that each collection frees. */
  readonly allocated: number;
  /** The bytes that the collections in the call free: the garbage that the call made and dropped. */
  readonly freed: number;
  /** The growth of `heapUsed` across the call. */
  readonly grown: number;
  /** The largest used heap in the call: before each collection, and at the end. */
  readonly peak: number;
  /** The number of collections in the call. */
  readonly collections: number;
}

/** This function gives the function `gc` of V8 in a process that started with no flags. */
export function exposedGc(): () => void {
  setFlagsFromString("--expose-gc");
  return runInNewContext("gc") as () => void;
}

/** This function measures the memory of one call of `call`. A full collection by `gc` starts the measure. */
export function callMemory(gc: () => void, call: () => unknown): CallMemory {
  gc();
  // A new profiler for each measure: the profiler of Node does not start again after `stop()`.
  const profiler = new GCProfiler();
  profiler.start();
  const before = process.memoryUsage().heapUsed;
  call();
  const after = process.memoryUsage().heapUsed;
  const { statistics } = profiler.stop();
  let freed = 0;
  let peak = after;
  for (const item of statistics) {
    freed += item.beforeGC.heapStatistics.usedHeapSize - item.afterGC.heapStatistics.usedHeapSize;
    peak = Math.max(peak, item.beforeGC.heapStatistics.usedHeapSize);
  }
  return { allocated: after - before + freed, freed, grown: after - before, peak, collections: statistics.length };
}

/** This function gives the bytes that one call of `call` allocates (D105). */
export function allocated(gc: () => void, call: () => unknown): number {
  return callMemory(gc, call).allocated;
}
