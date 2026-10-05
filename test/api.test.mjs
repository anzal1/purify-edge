// The public API: same shape as DOMPurify, for ESM and CJS, resolved through package.json "exports" the way a consumer would.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
// Self-reference by package name goes through "exports", exactly like an installed copy would.
const esm = await import("purify-edge");
const cjs = require("purify-edge");

test("package.json pins dompurify and parse5 exactly, and the installed dompurify is that version", () => {
  assert.match(pkg.dependencies.dompurify, /^\d+\.\d+\.\d+$/);
  assert.match(pkg.dependencies.parse5, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.dependencies.dompurify, "3.4.16");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "node_modules/dompurify/package.json"), "utf8")).version, pkg.dependencies.dompurify);
  assert.equal(esm.default.version, pkg.dependencies.dompurify);
  assert.equal(pkg.sideEffects, false);
  assert.equal(pkg.engines.node, ">=20");
});

test("default export is a DOMPurify instance with the full API", () => {
  const P = esm.default;
  for (const m of ["sanitize", "addHook", "removeHook", "removeHooks", "removeAllHooks", "setConfig", "clearConfig", "isValidAttribute"]) assert.equal(typeof P[m], "function", m);
  assert.equal(P.isSupported, true);
  assert.ok(Array.isArray(P.removed));
  assert.equal(P.sanitize("<img src=x onerror=alert(1)>hi"), '<img src="x">hi');
  assert.deepEqual(Object.keys(esm).sort(), ["createDOMPurify", "default", "window"]);
});

test("sanitize, config, hooks, removed and isValidAttribute behave like DOMPurify", () => {
  const P = esm.createDOMPurify();
  assert.equal(P.sanitize("<b onclick=x>a</b><script>1</script>"), "<b>a</b>");
  P.setConfig({ ALLOWED_TAGS: ["i"] });
  assert.equal(P.sanitize("<b>a</b><i>b</i>"), "a<i>b</i>");
  P.clearConfig();
  assert.equal(P.sanitize("<b>a</b>"), "<b>a</b>");
  const hook = (node) => { if (node.nodeName === "B") node.setAttribute("data-seen", "1"); };
  P.addHook("afterSanitizeAttributes", hook);
  assert.equal(P.sanitize("<b>a</b>"), '<b data-seen="1">a</b>');
  P.removeHook("afterSanitizeAttributes", hook);
  assert.equal(P.sanitize("<b>a</b>"), "<b>a</b>");
  P.sanitize("<p onclick=1>a</p><script>x</script>");
  assert.ok(P.removed.length >= 2);
  assert.equal(P.isValidAttribute("a", "href", "https://example.com"), true);
  assert.equal(P.isValidAttribute("a", "href", "javascript:alert(1)"), false);
  assert.equal(P.isValidAttribute("div", "onclick", "x"), false);
  // RETURN_DOM variants return nodes from the shim window
  const frag = P.sanitize("<b>a</b>", { RETURN_DOM_FRAGMENT: true });
  assert.equal(frag.nodeType, 11);
  assert.equal(P.sanitize("<b>a</b>", { RETURN_DOM: true }).nodeName, "BODY");
});

test("createDOMPurify() gives independent instances (own config and hooks)", () => {
  const a = esm.createDOMPurify(), b = esm.createDOMPurify();
  assert.notEqual(a, b); assert.notEqual(a, esm.default);
  a.setConfig({ ALLOWED_TAGS: ["i"] }); a.addHook("afterSanitizeAttributes", (n) => n.setAttribute && n.setAttribute("x", "1"));
  assert.equal(b.sanitize("<b>a</b>"), "<b>a</b>");
  assert.equal(esm.default.sanitize("<b>a</b>"), "<b>a</b>");
  assert.equal(a.sanitize("<b>a</b>"), "a");
  // an explicit window can be passed, like DOMPurify(window)
  assert.equal(esm.createDOMPurify(esm.window).sanitize("<u>a</u>"), "<u>a</u>");
});

test("the exported window is the shim window", () => {
  const w = esm.window;
  assert.equal(w.document.nodeType, 9);
  for (const k of ["Node", "Element", "HTMLElement", "DocumentFragment", "HTMLTemplateElement", "HTMLFormElement", "NodeFilter", "DOMParser"]) assert.ok(w[k], k);
  const d = new w.DOMParser().parseFromString("<p>x</p>", "text/html");
  assert.equal(d.body.innerHTML, "<p>x</p>");
});

test("CommonJS: require() returns the instance, with default, createDOMPurify and window attached", () => {
  assert.equal(typeof cjs.sanitize, "function");
  assert.equal(cjs.isSupported, true);
  assert.equal(cjs.default, cjs);
  assert.equal(typeof cjs.createDOMPurify, "function");
  assert.equal(cjs.window.document.nodeType, 9);
  assert.equal(cjs.sanitize("<img src=x onerror=alert(1)>hi"), esm.default.sanitize("<img src=x onerror=alert(1)>hi"));
  assert.equal(cjs.createDOMPurify().sanitize("<script>1</script>x"), "x");
  assert.deepEqual(Object.keys(cjs).filter((k) => ["default", "createDOMPurify", "window"].includes(k)), [], "extras are non-enumerable");
});

test("the CommonJS build runs in plain Node with no ESM loader (parse5 is bundled in)", () => {
  const out = execFileSync(process.execPath, ["-e", "const P = require('purify-edge'); process.stdout.write(P.sanitize('<svg onload=alert(1)><circle r=1/></svg>'))"], { cwd: root, encoding: "utf8" });
  assert.equal(out, esm.default.sanitize("<svg onload=alert(1)><circle r=1/></svg>"));
});

test("TypeScript: types re-export DOMPurify's own, for both ESM and CJS consumers", () => {
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", path.join(root, "test/types/tsconfig.json")], { cwd: root, encoding: "utf8" });
});
