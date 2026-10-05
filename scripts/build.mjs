// Builds dist/index.cjs: a CommonJS bundle for require(). parse5 8 is ESM-only, so it is bundled in here; dompurify stays external.
// The ESM entry (src/index.js) is shipped as is and needs no build.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: [path.join(root, "scripts/cjs-entry.cjs")],
  outfile: path.join(root, "dist/index.cjs"),
  bundle: true,
  format: "cjs",
  platform: "neutral",
  mainFields: ["module", "main"],
  target: "es2020",
  external: ["dompurify"],
  legalComments: "none",
  logLevel: "warning",
});
