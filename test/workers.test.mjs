// Workers smoke test: the library, bundled as a module worker for a neutral platform, runs in workerd (Cloudflare's Workers runtime) via Miniflare,
// with no Node compatibility flag, and sanitizes with the same bytes as the Node run.
// Skipped when workerd cannot start on this platform, unless REQUIRE_WORKERS=1 (CI sets it).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import edge, { window as ew } from "../src/index.js";
import { run } from "./helpers.mjs";
import { vectors, mutatedPayloads } from "./corpus.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let Miniflare = null;
try { ({ Miniflare } = await import("miniflare")); } catch (e) { if (process.env.REQUIRE_WORKERS) throw e; }

test("sanitizes inside workerd (Miniflare), no nodejs_compat", { skip: !Miniflare && "miniflare is not available on this platform" }, async (t) => {
  const r = await build({
    stdin: { contents: `import P from ${JSON.stringify(path.join(root, "src/index.js"))};
      export default { async fetch(req) {
        const body = await req.json();
        return Response.json({ supported: P.isSupported, hasProcess: typeof process, hasDocument: typeof document, hasWindow: typeof window, out: body.map((h) => { try { return P.sanitize(h); } catch (e) { return "ERR:" + e.name + ":" + String(e.message).slice(0, 120); } }) });
      } };`, resolveDir: root, sourcefile: "worker.js" },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022", minify: true, legalComments: "none", logLevel: "silent",
  });
  const mf = new Miniflare({ modules: true, script: r.outputFiles[0].text, compatibilityDate: "2026-01-01" });
  try {
    const inputs = [...vectors.map((v) => v.payload), ...mutatedPayloads()];
    const res = await mf.dispatchFetch("http://worker.test/", { method: "POST", body: JSON.stringify(inputs) });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.supported, true);
    assert.equal(j.hasProcess, "undefined"); assert.equal(j.hasDocument, "undefined"); assert.equal(j.hasWindow, "undefined");
    let same = 0; inputs.forEach((input, i) => { if (j.out[i] === run(edge, ew, input, {})) same++; });
    t.diagnostic(`workerd: ${same}/${inputs.length} identical to the Node run`);
    assert.equal(same, inputs.length);
  } finally { await mf.dispose(); }
});
