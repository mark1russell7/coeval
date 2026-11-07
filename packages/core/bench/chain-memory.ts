/*
 * The memory of the demands of a long chain (K116, D144).
 *
 *   pnpm exec tsx packages/core/bench/chain-memory.ts [<nodes>]
 *
 * The chain is the chain of SCHED.LONG-CHAIN: node i reads node i + 1, and the last node reads a name. The default is
 * 100000 nodes. The script measures three steps: the `set` of each node, the first `read` of the first node, and a
 * `changeData` with a second `read`. For each step, it gives the bytes that the step allocates, the garbage that the
 * collections in the step free, the peak of the heap and the heap after a full collection. The garbage of a step is the
 * bytes that it allocates, less the growth of the heap after a full collection.
 *
 * A second pass runs the same steps on a new schedule under the sampling heap profiler of V8. The profiler also keeps
 * the samples of objects that a collection frees, thus it names the functions that allocate the garbage. The first
 * pass has no profiler, thus its numbers do not include the cost of the profiler.
 *
 * The script is a study, not a gate. It prints its numbers, and its exit code is 0.
 */
import { appendFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { cpus } from "node:os";
import { basename } from "node:path";
import { context, formulaMachine, ref, schedule, type Schedule } from "../src/index.ts";
import { callMemory, exposedGc, type CallMemory } from "./memory.ts";

/** One node of a profile of the sampling heap profiler. */
export interface ProfileNode {
  readonly callFrame: { readonly functionName: string; readonly url: string; readonly lineNumber: number };
  readonly selfSize: number;
  readonly children: readonly ProfileNode[];
}

/** The bytes of one source of the samples. */
export interface Source {
  readonly name: string;
  readonly bytes: number;
  readonly share: number;
}

/** This function gives the sources of a profile by their self size, the largest first. */
export function sourcesOf(head: ProfileNode, top: number): { readonly total: number; readonly sources: readonly Source[] } {
  const bytes = new Map<string, number>();
  let total = 0;
  const visit = (node: ProfileNode): void => {
    const { functionName, url, lineNumber } = node.callFrame;
    // The loader of tsx gives the line 0 to each frame, thus a name has a line only when the profile gives one.
    const where = url === "" ? "(native)" : lineNumber > 0 ? `${basename(url)}:${lineNumber + 1}` : basename(url);
    const name = `${functionName === "" ? "(anonymous)" : functionName} ${where}`;
    if (node.selfSize > 0) bytes.set(name, (bytes.get(name) ?? 0) + node.selfSize);
    total += node.selfSize;
    for (const child of node.children) visit(child);
  };
  visit(head);
  const sources = [...bytes]
    .map(([name, size]) => ({ name, bytes: size, share: total === 0 ? 0 : size / total }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, top);
  return { total, sources };
}

const machine = formulaMachine({ pure: true });

/** This function gives a schedule with the chain of `nodes` nodes, and the three steps of the study. */
function steps(nodes: number): readonly { readonly name: string; readonly call: () => unknown }[] {
  let chain: Schedule | undefined;
  return [
    {
      name: "`set` of each node",
      call: () => {
        chain = schedule(machine, { declaredType: "lit", context: context({ names: { x: 7 } }) });
        for (let index = 0; index < nodes; index += 1) chain.set(`n${index}`, index === nodes - 1 ? ref("names", "x") : ref("world", `n${index + 1}`));
      },
    },
    { name: "the first `read`", call: () => chain?.read("n0") },
    {
      name: "`changeData` and a `read`",
      call: () => {
        chain?.changeData();
        return chain?.read("n0");
      },
    },
  ];
}

const MB = 1024 * 1024;
const mb = (bytes: number): string => (bytes / MB).toFixed(1);

async function study(nodes: number): Promise<void> {
  const gc = exposedGc();
  gc();
  const start = process.memoryUsage().heapUsed;
  const rows: { readonly name: string; readonly memory: CallMemory; readonly kept: number; readonly garbage: number }[] = [];
  let last = 0;
  for (const step of steps(nodes)) {
    const memory = callMemory(gc, step.call);
    gc();
    const kept = process.memoryUsage().heapUsed - start;
    rows.push({ name: step.name, memory, kept, garbage: memory.allocated - (kept - last) });
    last = kept;
  }
  const garbage = rows.reduce((sum, row) => sum + row.garbage, 0);
  const kept = (rows.at(-1) as (typeof rows)[number]).kept;

  // The second pass: the same steps under the sampling heap profiler, with the objects that a collection frees.
  const session = new Session();
  session.connect();
  await session.post("HeapProfiler.startSampling", { samplingInterval: 32_768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  for (const step of steps(nodes)) step.call();
  const { profile } = (await session.post("HeapProfiler.stopSampling")) as { profile: { head: ProfileNode } };
  session.disconnect();
  const { total, sources } = sourcesOf(profile.head, 10);
  const top3 = sources.slice(0, 3).reduce((sum, source) => sum + source.share, 0);

  const lines = [
    `## The memory of a long chain (K116, D144)`,
    "",
    `A chain of ${nodes} nodes on ${cpus()[0]?.model.trim() ?? "an unknown CPU"}, Node ${process.version}.`,
    "",
    "| Step | Allocated (MB) | Garbage (MB) | Freed in the step (MB) | Peak of the heap (MB) | Collections | Kept after a full collection (MB) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.name} | ${mb(row.memory.allocated)} | ${mb(row.garbage)} | ${mb(row.memory.freed)} | ${mb(row.memory.peak)} | ${row.memory.collections} | ${mb(row.kept)} |`),
    "",
    `The steps keep ${(kept / nodes).toFixed(0)} bytes for each node, and they make ${(garbage / nodes).toFixed(0)} bytes of garbage for each node.`,
    `The garbage is ${(garbage / Math.max(kept, 1)).toFixed(2)} times the kept memory.`,
    "",
    `The sampling heap profiler, with the objects that a collection frees: ${mb(total)} MB in all.`,
    "",
    "| Source | MB | Share |",
    "| --- | ---: | ---: |",
    ...sources.map((source) => `| \`${source.name}\` | ${mb(source.bytes)} | ${(100 * source.share).toFixed(1)} % |`),
    "",
    `The top 3 sources hold ${(100 * top3).toFixed(1)} % of the samples.`,
  ];
  const text = `${lines.join("\n")}\n`;
  process.stdout.write(text);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary !== undefined && summary !== "") appendFileSync(summary, `${text}\n`);
  const record = { id: "K116", nodes, node: process.version, steps: rows.map((row) => ({ name: row.name, ...row.memory, kept: row.kept, garbage: row.garbage })), garbage, kept, total, top3, sources };
  process.stdout.write(`MEASURE ${JSON.stringify(record)}\n`);
}

if (process.argv[1] !== undefined && basename(process.argv[1]).startsWith("chain-memory")) await study(Number(process.argv[2] ?? 100_000));
