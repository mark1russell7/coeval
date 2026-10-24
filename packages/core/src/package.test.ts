import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("the package", () => {
  it("[PKG.PURE] an import that uses nothing leaves nothing in a bundle", async () => {
    // The plugin marks each module as one with side effects. Then the field
    // `sideEffects` of package.json does not remove the modules, and only their
    // statements decide. esbuild does not examine the bodies of functions, so
    // each call at the top of a module needs the mark of a pure call.
    const result = await build({
      stdin: { contents: `import ${JSON.stringify(join(here, "index.ts"))};`, loader: "ts", resolveDir: here },
      bundle: true,
      write: false,
      format: "esm",
      treeShaking: true,
      logLevel: "silent",
      plugins: [
        {
          name: "effects",
          setup: (b) =>
            b.onResolve({ filter: /.*/ }, async (args) => {
              if (args.pluginData === "inner") return undefined;
              const found = await b.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: "inner" });
              return found.errors.length > 0 ? undefined : { path: found.path, sideEffects: true };
            }),
        },
      ],
    });
    const code = (result.outputFiles[0]?.text ?? "").replace(/^\s*\/\/.*$/gm, "").trim();
    expect(code).toBe("");
  });
});
