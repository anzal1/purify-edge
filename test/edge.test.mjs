// Edge isolate test: bundle the library for a neutral platform (no Node built-ins available), load the bundle in an @edge-runtime/vm isolate
// where `process`, `require` and `document` do not exist, and check it sanitizes with the same bytes as the Node run and as DOMPurify-on-jsdom.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { EdgeVM } from "@edge-runtime/vm";
import edge, { window as ew } from "../src/index.js";
import { reference, run } from "./helpers.mjs";
import { vectors, mutatedPayloads } from "./corpus.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "src/index.js");

// platform "neutral" has no Node built-ins: an import of fs, node:vm, etc. anywhere in the dependency tree fails the build.
async function bundle({ minify, format }) {
  const r = await build({
    stdin: { contents: format === "iife"
      ? `import P, { createDOMPurify } from ${JSON.stringify(entry)}; globalThis.P = P; globalThis.createDOMPurify = createDOMPurify; globalThis.sanitize = (h, c) => P.sanitize(h, c);`
      : `export { default, createDOMPurify, window } from ${JSON.stringify(entry)};`, resolveDir: root, sourcefile: "edge-entry.js" },
    bundle: true, write: false, metafile: true, format, platform: "neutral", target: "es2022", minify, legalComments: "none", logLevel: "silent",
  });
  return { code: r.outputFiles[0].text, meta: r.metafile };
}

test("runtime source has no node: imports, require() or process access", () => {
  for (const f of fs.readdirSync(path.join(root, "src")).filter((x) => x.endsWith(".js"))) {
    const text = fs.readFileSync(path.join(root, "src", f), "utf8");
    assert.doesNotMatch(text, /from\s+["']node:|require\(|\bprocess\./, f);
    assert.doesNotMatch(text, /\bimport\s+[^"']*from\s+["'](fs|path|vm|url|util|stream|buffer|os|module|crypto|events)["']/, f);
  }
});

test("the bundle for a neutral platform has no Node built-ins and runs in an isolate", async (t) => {
  const min = await bundle({ minify: true, format: "iife" });
  const esm = await bundle({ minify: true, format: "esm" });
  const external = Object.values(esm.meta.outputs).flatMap((o) => o.imports).filter((i) => i.external);
  assert.deepEqual(external, [], "nothing may be left as an external import");
  assert.doesNotMatch(min.code, /\brequire\(|\bfrom\s*["']node:|\bimport\s*\(\s*["']node:/);
  const bytes = Buffer.byteLength(min.code), gz = zlib.gzipSync(min.code, { level: 9 }).length;
  t.diagnostic(`bundle (parse5 + DOMPurify + shim, minified, neutral platform, ESM): ${Buffer.byteLength(esm.code)} bytes min, ${zlib.gzipSync(esm.code, { level: 9 }).length} bytes gzip`);
  t.diagnostic(`bundle (same, IIFE): ${bytes} bytes min, ${gz} bytes gzip`);
  fs.mkdirSync(path.join(root, "results"), { recursive: true });
  fs.writeFileSync(path.join(root, "results/edge-size.json"), JSON.stringify({ esmMin: Buffer.byteLength(esm.code), esmGzip: zlib.gzipSync(esm.code, { level: 9 }).length, iifeMin: bytes, iifeGzip: gz }));

  const vm = new EdgeVM();
  vm.evaluate(min.code);
  assert.equal(vm.evaluate("typeof process"), "undefined");
  assert.equal(vm.evaluate("typeof require"), "undefined");
  assert.equal(vm.evaluate("typeof document"), "undefined");
  assert.equal(vm.evaluate("typeof window"), "undefined");
  assert.equal(vm.evaluate("P.isSupported"), true);
  assert.equal(vm.evaluate("P.sanitize('<img src=x onerror=alert(1)>ok')"), '<img src="x">ok');

  const inputs = [...vectors.map((v) => v.payload), ...mutatedPayloads()];
  vm.context.__inputs = inputs;
  const inIsolate = vm.evaluate("__inputs.map((p) => { try { return sanitize(p); } catch (e) { return 'ERR:' + e.name + ':' + String(e.message).slice(0, 120); } })");
  const ref = reference();
  let sameAsNode = 0, sameAsJsdom = 0;
  inputs.forEach((input, i) => {
    if (inIsolate[i] === run(edge, ew, input, {})) sameAsNode++;
    if (inIsolate[i] === run(ref.purify, ref.window, input, {})) sameAsJsdom++;
  });
  t.diagnostic(`isolate: ${sameAsNode}/${inputs.length} identical to the Node run, ${sameAsJsdom}/${inputs.length} identical to DOMPurify-on-jsdom`);
  assert.equal(sameAsNode, inputs.length);
  assert.equal(sameAsJsdom, inputs.length);

  // config, hooks and fresh instances work inside the isolate too
  vm.context.__cfg = { ALLOWED_TAGS: ["b"] };
  assert.equal(vm.evaluate("createDOMPurify().sanitize('<b>x</b><i>y</i>', __cfg)"), "<b>x</b>y");
  assert.equal(vm.evaluate("(() => { const q = createDOMPurify(); q.addHook('afterSanitizeAttributes', (n) => { if ('target' in n) n.setAttribute('target', '_blank'); }); return q.sanitize('<a href=\"#\">a</a>', { ADD_ATTR: ['target'] }); })()"), '<a href="#" target="_blank">a</a>');
  assert.equal(vm.evaluate("P.sanitize('<a href=\"javascript:alert(1)\">x</a>')"), "<a>x</a>");
});
