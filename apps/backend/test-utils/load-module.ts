import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve("esbuild", {
    paths: [require.resolve("convex/package.json")],
  }),
);

/** Execute actual Convex handlers offline; no generated files or deployment. */
export async function loadModule(path: string) {
  const result = await build({
    entryPoints: [new URL(path, import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
  });
  const loaded = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    require,
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}
