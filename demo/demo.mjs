// The launch clip: the same payloads through isomorphic-dompurify (jsdom) and purify-edge,
// then purify-edge inside workerd, Cloudflare's Workers runtime.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import iso from "isomorphic-dompurify";
import edge from "../src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dim = (s) => `\x1b[2m${s}\x1b[0m`, ok = (s) => `\x1b[38;5;173m${s}\x1b[0m`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const payloads = [
  `<img src=x onerror=alert(1)>hello`,
  `<svg><g onload="alert(2)"><a xlink:href="javascript:alert(3)">x</a></g></svg>`,
  `<math><mtext><table><mglyph><style><img src=x onerror=alert(4)>`,
];

console.log(dim("same DOMPurify 3.4.16, two different DOMs\n"));
for (const p of payloads) {
  const a = iso.sanitize(p), b = edge.sanitize(p);
  console.log(dim("input        ") + p);
  console.log(dim("jsdom        ") + a);
  console.log(dim("purify-edge  ") + b + "  " + (a === b ? ok("identical") : "DIFFERENT"));
  console.log();
  await sleep(900);
}

const r = await build({
  stdin: { contents: `import P from ${JSON.stringify(path.join(root, "src/index.js"))};
    export default { async fetch(req) { const body = await req.json(); return Response.json({ hasDocument: typeof document, out: body.map((h) => P.sanitize(h)) }); } };`,
    resolveDir: root, sourcefile: "worker.js" },
  bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022", minify: true, logLevel: "silent",
});
const mf = new Miniflare({ modules: true, script: r.outputFiles[0].text, compatibilityDate: "2026-01-01" });
const res = await mf.dispatchFetch("http://worker.test/", { method: "POST", body: JSON.stringify(payloads) });
const j = await res.json();
await mf.dispose();
const same = j.out.filter((o, i) => o === iso.sanitize(payloads[i])).length;
console.log(dim("inside workerd (Cloudflare Workers), no nodejs_compat, typeof document: ") + j.hasDocument);
console.log(dim("purify-edge  ") + j.out[0]);
console.log(ok(`${same}/${payloads.length} identical to DOMPurify on jsdom`) + dim(`  ·  bundle ${(r.outputFiles[0].text.length / 1024).toFixed(0)} KB minified`));
