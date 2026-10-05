// Differential fuzzer: DOMPurify on jsdom versus the same DOMPurify on the purify-edge window. Same build, same config, byte comparison of the output
// (or of the thrown error). Any difference is a finding, except the documented classes handled by scripts/classify-diffs.mjs.
//
//   node scripts/fuzz.mjs [--cases 20000] [--seed 1000] [--max-seconds 600] [--ext] [--stock-jsdom] [--batch 4000]
//
// Default configs: default, USE_PROFILES html, FORBID_TAGS, ADD_ATTR plus the README hook (4 configs per case).
// --ext runs the 12 extended configs instead (RETURN_DOM, FRAGMENT, IN_PLACE, SAFE_FOR_TEMPLATES, WHOLE_DOCUMENT, FORCE_BODY, XHTML, custom elements, profiles, removed[], NAMESPACE)
// and classifies what differs. Exit code is 0 only when there is nothing unexplained.
//
// jsdom 29 has two bugs in its parse5 tree adapter (browser/parser/html.js). By default this script patches that file's source in memory (nothing on disk changes)
// so the comparison is not dominated by them:
//  1. insertTextBefore calls parentNode._append(text, ref) but _append ignores ref, so foster-parented text ("<table>x</table>") lands AFTER the table.
//  2. adoptAttributes overwrites attributes ("<body a=1><body a=9>" gives a="9"); the spec and parse5 itself keep the existing value (a="1").
// The purify-edge window matches parse5 and the spec on both. --stock-jsdom skips the patch and reports the raw numbers (expect a few thousand differences per 200k cases, all from these two).
//
// The parent process runs short-lived worker processes of this same file, because jsdom leaks about 30 KB per sanitize for the life of the process.
import fs from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) => { const i = process.argv.indexOf("--" + name); return i < 0 ? dflt : process.argv[i + 1]; };
const flag = (name) => process.argv.includes("--" + name);
const EXT = flag("ext"), STOCK = flag("stock-jsdom"), WORKER = flag("worker");
const TOTAL = +arg("cases", 20000), SEED0 = +arg("seed", 1000), MAXS = +arg("max-seconds", 600), BATCH = +arg("batch", 4000);
const tag = (EXT ? "ext-" : "") + (STOCK ? "stock" : "fixed");
const outDir = path.join(root, "results");

if (!WORKER) await parent(); else await worker();

// ---------------------------------------------------------------- parent: run batches, merge, classify
async function parent() {
  const t0 = Date.now(), sum = { mode: tag, cases: 0, comparisons: 0, differences: 0, byCfg: {}, cov: {}, jsdomThrew: 0, known: 0, batches: 0, diffs: [] };
  fs.mkdirSync(outDir, { recursive: true });
  for (let b = 0; sum.cases < TOTAL && (Date.now() - t0) / 1000 < MAXS; b++) {
    const n = Math.min(BATCH, TOTAL - sum.cases), seed = SEED0 + b, out = path.join(outDir, `fuzz-batch-${process.pid}-${b}.json`);
    const r = spawnSync(process.execPath, ["--max-old-space-size=3500", fileURLToPath(import.meta.url), "--worker", "--cases", String(n), "--seed", String(seed),
      "--max-seconds", String(Math.max(30, MAXS - (Date.now() - t0) / 1000)), "--out", out, ...(EXT ? ["--ext"] : []), ...(STOCK ? ["--stock-jsdom"] : [])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (r.status !== 0) { console.error("batch", b, "failed", r.status, (r.stderr || "").slice(0, 600)); process.exit(2); }
    const j = JSON.parse(fs.readFileSync(out, "utf8")); fs.unlinkSync(out);
    sum.cases += j.cases; sum.comparisons += j.comparisons; sum.differences += j.differences; sum.batches++;
    for (const [k, v] of Object.entries(j.byCfg)) sum.byCfg[k] = (sum.byCfg[k] || 0) + v;
    for (const [k, v] of Object.entries(j.cov)) sum.cov[k] = (sum.cov[k] || 0) + v;
    sum.jsdomThrew += j.jsdomThrew || 0; sum.known += j.known || 0; sum.diffs.push(...j.diffs.slice(0, 50)); if (sum.diffs.length > 400) sum.diffs.length = 400;
    if (b % 5 === 4) console.error(`${sum.cases} cases, ${sum.differences} diffs, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  sum.seconds = +((Date.now() - t0) / 1000).toFixed(1);
  fs.writeFileSync(path.join(outDir, `fuzz-${tag}.json`), JSON.stringify(sum, null, 1));
  const { diffs, ...rest } = sum; console.log(JSON.stringify(rest));
  let bad = 0;
  if (EXT) {
    const { classify } = await import("./classify-diffs.mjs");
    const c = classify(diffs);
    console.log("classified:", JSON.stringify(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { n: v.n, failClosed: v.failClosed }]))));
    for (const [k, v] of Object.entries(c)) if (k === "UNCLASSIFIED" || v.ex.length) { bad += v.ex.length || v.n; for (const x of v.ex.slice(0, 3)) console.log(k, JSON.stringify(x).slice(0, 600)); }
    if (diffs.length < sum.differences) { console.log("more differences than were stored, cannot classify all"); bad++; }
  } else {
    bad = sum.differences;
    for (const d of diffs.slice(0, 5)) console.log(JSON.stringify(d).slice(0, 700));
  }
  if (sum.cases < TOTAL) console.log(`stopped early at ${sum.cases} of ${TOTAL} cases (time limit)`);
  console.log(bad ? `FAIL: ${bad} unexplained difference(s)` : `OK: ${sum.cases} cases, ${sum.comparisons} comparisons, nothing unexplained`);
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- worker: one batch
async function worker() {
const require = createRequire(import.meta.url);
if (!STOCK) {
  const ext = Module._extensions[".js"];
  Module._extensions[".js"] = function (m, filename) {
    if (filename.endsWith("jsdom/browser/parser/html.js")) {
      const src = fs.readFileSync(filename, "utf8")
        .replace("parentNode._append(textNode, referenceNode);", "parentNode._insert(textNode, referenceNode);")
        .replace("attributes.setAttributeValue(element, attr.name, attr.value, prefix, attr.namespace);", "if (!attributes.hasAttributeByNameNS(element, attr.namespace || null, attr.name)) attributes.setAttributeValue(element, attr.name, attr.value, prefix, attr.namespace);");
      if (!src.includes("_insert(textNode, referenceNode)") || !src.includes("hasAttributeByNameNS(element, attr.namespace")) throw new Error("jsdom fix patterns did not apply (jsdom version changed?)");
      return m._compile(src, filename);
    }
    return ext(m, filename);
  };
}
const createDOMPurify = require("dompurify"); // the published build that purify-edge depends on
const { JSDOM } = require("jsdom");
const dom = await import("../src/dom.js");
const { createTestWindow } = await import("./lib/test-window.mjs");

const N = TOTAL, SEED = SEED0, OUT = arg("out");
let st = SEED >>> 0;
const rnd = () => { st = (st + 0x6d2b79f5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (n) => Math.floor(rnd() * n), pick = (a) => a[ri(a.length)];

// ---- seeds: the expect.mjs payloads, plus every '<'-bearing string literal in DOMPurify's own test file when a checkout is available (scripts/fetch-dompurify.sh) ----
const seeds = JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/expect-payloads.json"), "utf8")).map((v) => v.payload);
const suiteFile = path.join(process.env.DOMPURIFY_DIR || path.join(root, ".cache/dompurify-" + require("../package.json").dependencies.dompurify), "test/test-suite.js");
if (fs.existsSync(suiteFile)) {
  const src = fs.readFileSync(suiteFile, "utf8");
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*<(?:[^'\\\n]|\\.)*)'/g)) { try { const s = new Function("return '" + m[1] + "'")(); if (s.length < 1500) seeds.push(s); } catch {} }
}
const short = seeds.filter((s) => s.length < 600);

const TAGS = ["div", "span", "p", "a", "b", "i", "img", "svg", "math", "template", "noscript", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext", "select", "option", "optgroup", "table", "tbody", "tr", "td", "th", "caption", "colgroup", "col", "form", "input", "button", "label", "object", "embed", "script", "link", "meta", "base", "br", "hr", "ul", "li", "details", "summary", "dialog", "selectedcontent", "isindex", "listing", "pre",
  "foreignObject", "foreignobject", "desc", "title", "g", "use", "image", "animate", "set", "text", "tspan", "path", "style", "script", "a", "switch", "annotation-xml", "mi", "mo", "mn", "mtext", "ms", "mglyph", "malignmark", "semantics", "mrow", "maction", "x-foo", "my-element", "a-b", "DIV", "ScRiPt", "SvG", "MATH", "Template", "STYLE", "ṡcript", "scrıpt", "svg:a", "xlink:a", "html:div", "o:p", "h1", "frameset", "frame", "body", "html", "head", "applet", "marquee", "font", "center", "tt", "big", "nobr", "rb", "rtc", "slot", "portal", "audio", "video", "source", "track", "picture", "map", "area", "canvas", "datalist", "fieldset", "legend", "meter", "progress", "output", "ruby", "rt", "time", "wbr"];
const ATTRS = ["onerror", "onload", "onclick", "onfocus", "onmouseover", "ONERROR", "OnLoad", "href", "xlink:href", "src", "srcdoc", "action", "formaction", "style", "id", "name", "class", "is", "slot", "target", "rel", "type", "value", "data-x", "data-foo-bar", "aria-label", "aria-hidden", "role", "title", "xmlns", "xmlns:xlink", "xmlns:x", "xml:lang", "xml:space", "encoding", "definitionurl", "attributename", "to", "from", "values", "begin", "dur", "fill", "d", "viewbox", "viewBox", "width", "height", "color", "face", "size", "background", "poster", "ping", "download", "shadowrootmode", "shadowrootclonable", "popover", "popovertarget", "nonce", "autofocus", "contenteditable", "draggable", "hidden", "tabindex", "on*", "onerror", "onerror", "\u0000", "'", "\"", "<", "=", "x:y", "xlink:xlink:href", "ꞏ", "svg:href"];
const NAMES = ["nodeName", "nodeType", "parentNode", "attributes", "children", "childNodes", "removeChild", "insertBefore", "ownerDocument", "firstChild", "namespaceURI", "tagName", "localName", "innerHTML", "outerHTML", "textContent", "cloneNode", "getAttribute", "setAttribute", "hasChildNodes", "location", "cookie", "implementation", "body", "documentElement", "forms", "images", "getElementsByTagName", "createElement", "currentScript", "defaultView", "all", "length", "elements", "action", "nextSibling", "removeAttribute", "removeAttributeNode", "normalize", "contains", "appendChild", "style", "id", "name"];
const VALS = ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "x", "#", "//evil.example/", "https://example.com/?a=1&b=2", "alert(1)", "&#106;avascript:alert(1)", "&Tab;", "&NewLine;", "&lt;img src=x onerror=alert(1)&gt;", "<img src=x onerror=alert(1)>", "</style><img src=x onerror=alert(1)>", "</textarea><img src=x onerror=alert(1)>", "</noscript><img src=x onerror=alert(1)>", "</title><img src=x onerror=alert(1)>", "</template><img src=x onerror=alert(1)>", "text/html", "application/xhtml+xml", "xlink", "http://www.w3.org/1999/xlink", "http://www.w3.org/2000/svg", "http://www.w3.org/1998/Math/MathML", "http://www.w3.org/1999/xhtml", "", " ", "\u0000", "a\u0000b", "`x`", "${x}", "{{x}}", "<%= x %>", "color:red", "background:url(javascript:x)", "expression(x)", "open", "closed", "true", "false", "HTML", "text/html;charset=utf-8", "annotation-xml"];
const WRAP = [["<svg>", "</svg>"], ["<math>", "</math>"], ["<template>", "</template>"], ["<noscript>", "</noscript>"], ["<style>", "</style>"], ["<textarea>", "</textarea>"], ["<title>", "</title>"], ["<xmp>", "</xmp>"], ["<iframe>", "</iframe>"], ["<noembed>", "</noembed>"], ["<noframes>", "</noframes>"], ["<select>", "</select>"], ["<table>", "</table>"], ["<form>", "</form>"], ["<svg><foreignObject>", "</foreignObject></svg>"], ["<svg><desc>", "</desc></svg>"], ["<svg><title>", "</title></svg>"], ["<math><mtext>", "</mtext></math>"], ["<math><annotation-xml encoding=\"text/html\">", "</annotation-xml></math>"], ["<math><annotation-xml encoding=\"application/xhtml+xml\">", "</annotation-xml></math>"], ["<svg><style>", "</style></svg>"], ["<math><style>", "</style></math>"], ["<template><template>", "</template></template>"], ["<form><input name=nodeName>", "</form>"], ["<form><input name=attributes>", "</form>"], ["<details open><summary>", "</summary></details>"], ["<!--", "-->"], ["<![CDATA[", "]]>"], ["<?php ", "?>"], ["<plaintext>", ""], ["<a href=\"", "\">x</a>"], ["<p title=\"", "\">"], ["<div ", ">"]];
const JUNK = ["<", ">", "\"", "'", "`", "=", "/", "\\", "&", ";", "\u0000", " ", " ", "﻿", "\t", "\n", "\r", " ", "&lt;", "&gt;", "&amp;", "&#x3C;", "&#0;", "&#x110000;", "</", "/>", "<!", "<!--", "-->", "<![CDATA[", "]]>", "<?", "?>", "--!>", "\"'", "'\"", "ı", "ſ", "K", "ǆ", "\ud800", "\udc00", "𝒜"];

const attrStr = (a) => { const r = rnd(); const v = pick(VALS); const n = a === "name" || a === "id" ? pick(NAMES) : a; return r < 0.15 ? ` ${n}` : r < 0.4 ? ` ${n}=${v.replace(/[\s>"']/g, "_")}` : r < 0.55 ? ` ${n}='${v}'` : r < 0.6 ? ` ${n}=${v}` : r < 0.65 ? ` ${n}="${v}` : ` ${n}="${v}"`; };
const randTag = () => { const t = pick(TAGS); let s = "<" + t; for (let k = ri(4); k > 0; k--) s += attrStr(pick(ATTRS)); return rnd() < 0.1 ? s + "/>" : s + ">"; };
const randTree = (d) => { if (d > 4 || rnd() < 0.25) return rnd() < 0.5 ? pick(["x", "hello", " ", "a<b", "&amp;", "1<2"]) : ""; let s = "", n = 1 + ri(3); for (let i = 0; i < n; i++) { const t = pick(TAGS), o = randTag().replace(/^<[^\s>/]+/, "<" + t); s += o + randTree(d + 1) + (rnd() < 0.8 ? `</${rnd() < 0.9 ? t : pick(TAGS)}>` : ""); } return s; };
const spans = (s) => [...s.matchAll(/<\/?([^\s>\/]+)/g)];

function mutate(s0) {
  let s = s0;
  const ops = 1 + ri(4);
  for (let k = 0; k < ops; k++) {
    const op = ri(14), L = s.length;
    if (op === 0) { const m = spans(s); if (m.length) { const x = pick(m); s = s.slice(0, x.index) + (x[0][1] === "/" ? "</" : "<") + pick(TAGS) + s.slice(x.index + x[0].length); } } // tag swap
    else if (op === 1) { const m = spans(s); if (m.length) { const x = pick(m); s = s.slice(0, x.index + x[0].length) + attrStr(pick(ATTRS)) + s.slice(x.index + x[0].length); } } // attribute insert
    else if (op === 2) { const m = [...s.matchAll(/ [^\s=>\/]+(=("[^"]*"|'[^']*'|[^\s>]*))?/g)]; if (m.length) { const x = pick(m); s = s.slice(0, x.index) + s.slice(x.index + x[0].length); } } // attribute drop
    else if (op === 3) { const w = pick(WRAP), a = ri(L + 1), b = a + ri(L - a + 1); s = s.slice(0, a) + w[0] + s.slice(a, b) + w[1] + s.slice(b); } // nest span
    else if (op === 4) { s = pick(WRAP)[0] + s + pick(WRAP)[1]; }
    else if (op === 5) { const i = ri(L + 1); s = s.slice(0, i) + pick(JUNK) + s.slice(i); } // junk insert (broken quoting)
    else if (op === 6) { const q = [...s.matchAll(/["']/g)]; if (q.length) { const x = pick(q); s = s.slice(0, x.index) + (rnd() < 0.5 ? "" : pick(["'", "\"", "`"])) + s.slice(x.index + 1); } } // quote delete/replace
    else if (op === 7) { const a = ri(L + 1), b = Math.min(L, a + 1 + ri(40)); s = s.slice(0, a) + s.slice(b); } // chunk delete
    else if (op === 8) { const a = ri(L + 1), b = Math.min(L, a + 1 + ri(60)); s = s.slice(0, b) + s.slice(a, b) + s.slice(b); } // chunk duplicate
    else if (op === 9) { s += pick(short); } // concat
    else if (op === 10) { const i = ri(L + 1); s = s.slice(0, i) + pick(short) + s.slice(i); } // splice another seed in
    else if (op === 11) { s = s.slice(0, ri(L + 1)); } // truncate
    else if (op === 12) { const m = [...s.matchAll(/<(\/?)([a-zA-Z][^\s>\/]*)/g)]; if (m.length) { const x = pick(m); const t = x[2]; const u = rnd() < 0.5 ? t.toUpperCase() : t.replace(/[a-z]/g, (c) => (rnd() < 0.5 ? c.toUpperCase() : c)); s = s.slice(0, x.index) + "<" + x[1] + u + s.slice(x.index + x[0].length); } } // case shuffle
    else if (op === 13) { const m = [...s.matchAll(/<(\/?)([a-zA-Z][^\s>\/]*)/g)]; if (m.length) { const x = pick(m), y = pick(m); const t = x[2], u = y[2]; s = s.replace(new RegExp("(</?)" + t.replace(/[^\w]/g, "\\$&") + "(?=[\\s/>])"), "$1" + u); } } // namespace/tag shuffle
  }
  return s;
}
// Mostly well-formed XML (namespaces, prefixes, entities, CDATA, PIs, comments), so the XHTML/NAMESPACE configs exercise the XML path and not only the error path.
const XNS = ["http://www.w3.org/1999/xhtml", "http://www.w3.org/2000/svg", "http://www.w3.org/1998/Math/MathML", "http://www.ibm.com/library", "urn:x", "http://www.w3.org/1999/xlink", ""];
const XNAME = TAGS.filter((t) => /^[A-Za-z][\w-]*$/.test(t));
const XATTR = ATTRS.filter((t) => /^[A-Za-z][\w:.-]*$/.test(t) && !t.endsWith(":") && t.split(":").length < 3 && !t.startsWith("xmlns"));
const XTEXT = ["x", "hello", " ", "a&amp;b", "1&lt;2", "&#65;", "&#x3C;b&#x3E;", "&quot;&apos;", "<![CDATA[<b>x</b>]]>", "<![CDATA[]]>", "<!--c-->", "<?pi data?>", "<?xml-stylesheet href=\"a\"?>", "\n", "ſ", "İ", "\u00a0", "&lt;/style&gt;", "&lt;img src=x onerror=alert(1)&gt;"];
function xmlTree(d, prefixes) {
  if (d > 3 || rnd() < 0.2) return pick(XTEXT);
  let out = "";
  for (let n = 1 + ri(3); n > 0; n--) {
    const p = rnd() < 0.2 ? pick(["a", "svg", "m", "x"]) : "", local = pick(XNAME), name = (p ? p + ":" : "") + local;
    let attrs = "", ps = prefixes;
    if (rnd() < 0.35) attrs += ` xmlns="${pick(XNS)}"`;
    if (p && (!prefixes.has(p) || rnd() < 0.3)) { attrs += ` xmlns:${p}="${pick(XNS.slice(0, 6))}"`; ps = new Set([...prefixes, p]); }
    if (rnd() < 0.15) attrs += ` xmlns:xlink="http://www.w3.org/1999/xlink"`;
    const seen = new Set();
    for (let k = ri(4); k > 0; k--) { const a = pick(XATTR); if (seen.has(a)) continue; seen.add(a); const q = rnd() < 0.8 ? '"' : "'"; attrs += ` ${a}=${q}${pick(["x", "javascript:alert(1)", "a&amp;b", "&lt;", "&#10;", "&#9;", "a\nb", "#", "http://www.w3.org/1999/xhtml", ""])}${q}`; }
    if (p && !ps.has(p)) continue;
    out += rnd() < 0.15 ? `<${name}${attrs}/>` : `<${name}${attrs}>${xmlTree(d + 1, ps)}</${name}>`;
  }
  return out;
}
const genXml = () => {
  let s = xmlTree(0, new Set());
  if (rnd() < 0.5) s = `<${pick(XNAME)} xmlns="${pick(XNS.slice(0, 4))}">${s}</${"X"}>`.replace(/<([A-Za-z][\w-]*) xmlns="([^"]*)">([\s\S]*)<\/X>$/, (m, t, ns, rest) => `<${t} xmlns="${ns}">${rest}</${t}>`);
  return rnd() < 0.25 ? mutate(s) : s;
};
function gen() {
  if (EXT && rnd() < 0.45) return genXml();
  const r = rnd();
  if (r < 0.08) return randTree(0);
  if (r < 0.12) return pick(WRAP)[0] + randTree(1) + pick(WRAP)[1];
  return mutate(pick(rnd() < 0.5 ? short : seeds));
}

// ---- the two implementations ----
const CONFIGS = [
  ["default", {}, null],
  ["USE_PROFILES html", { USE_PROFILES: { html: true } }, null],
  ["FORBID_TAGS", { FORBID_TAGS: ["style", "form", "input", "textarea"] }, null],
  // the README hook: IDL `target` reflection plus ADD_ATTR
  ["ADD_ATTR+hook", { ADD_ATTR: ["target", "data-x"] }, (node) => { if ("target" in node) { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener"); } if (node.hasAttribute && node.hasAttribute("data-x")) node.setAttribute("data-x", node.getAttribute("data-x").toUpperCase()); }],
];
// (EXT, set above, selects the extended configs: DOM-returning, IN_PLACE, template, document, XHTML, custom-element, removed[] ...)
if (EXT) CONFIGS.length = 0;
if (EXT) CONFIGS.push(
  ["RETURN_DOM", { RETURN_DOM: true }, null],
  ["RETURN_DOM_FRAGMENT", { RETURN_DOM_FRAGMENT: true }, null],
  ["IN_PLACE", { IN_PLACE: true }, null],
  ["SAFE_FOR_TEMPLATES", { SAFE_FOR_TEMPLATES: true }, null],
  ["WHOLE_DOCUMENT", { WHOLE_DOCUMENT: true }, null],
  ["FORCE_BODY", { FORCE_BODY: true }, null],
  ["XHTML", { PARSER_MEDIA_TYPE: "application/xhtml+xml" }, null],
  ["CUSTOM_ELEMENT_HANDLING", { CUSTOM_ELEMENT_HANDLING: { tagNameCheck: /^(x|my|a)-/, attributeNameCheck: /^data-|^on/, allowCustomizedBuiltInElements: true } }, null],
  ["ALLOWED_TAGS+KEEP_CONTENT false", { ALLOWED_TAGS: ["a", "b", "svg", "math", "mi", "template", "p"], ALLOWED_ATTR: ["href", "id", "style"], KEEP_CONTENT: false }, null],
  ["SVG+MathML profiles, no data attr", { USE_PROFILES: { svg: true, svgFilters: true, mathMl: true, html: true }, ALLOW_DATA_ATTR: false, SANITIZE_NAMED_PROPS: true }, null],
  ["removed[] after sanitize", {}, null],
  ["NAMESPACE svg", { NAMESPACE: "http://www.w3.org/2000/svg", ALLOWED_NAMESPACES: ["http://www.w3.org/2000/svg", "http://www.w3.org/1999/xhtml"] }, null],
);
// jsdom leaks ~30-50 KB per sanitize for the life of the process, even across new windows (measured); the shim stays flat at 41 MB.
// So this file is a worker for fuzz-run.mjs, which runs it in short-lived batches.
let jw = null;
const makeImpls = () => {
  if (jw) jw.close();
  jw = new JSDOM("<!doctype html><html><head></head><body></body></html>").window;
  const sw = createTestWindow(dom, "<!doctype html><html><head></head><body></body></html>");
  return CONFIGS.map(([name, cfg, hook]) => {
    const mk = (w) => { const p = createDOMPurify(w); if (hook) p.addHook("afterSanitizeAttributes", hook); return p; };
    return { name, cfg, j: mk(jw), s: mk(sw), jw, sw };
  });
};
const impls = makeImpls();
const ser = (r, w) => {
  if (typeof r === "string") return r;
  if (r && r.nodeType === 11) { const d = w.document.createElement("div"); d.appendChild(r); return "FRAG:" + d.innerHTML; }
  if (r && r.nodeType === 1) return "EL:" + r.outerHTML;
  return "OTHER:" + String(r);
};
const run = (p, s, cfg, w, name) => {
  try {
    if (name === "IN_PLACE") { const d = w.document.createElement("div"); d.innerHTML = s; p.sanitize(d, cfg); return "OUT:" + d.innerHTML; }
    const r = p.sanitize(s, cfg);
    let o = "OUT:" + ser(r, w);
    if (name.endsWith("removed[]")) o += "|" + JSON.stringify(p.removed.map((x) => (x.element ? "E:" + x.element.nodeName : "A:" + (x.attribute && x.attribute.name) + "@" + (x.from && x.from.nodeName))));
    return o;
  } catch (e) { return "ERR:" + (e && e.name) + ":" + String(e && e.message).slice(0, 120); }
};

const diffs = [], byCfg = {}, knownEx = []; let done = 0, nd = 0, errs = 0, known = 0;
// XML configs + an unpaired surrogate in the input: saxes (jsdom) lets a high surrogate swallow the next character (even "<"); documented difference, counted apart.
const XMLCFG = new Set(["XHTML", "NAMESPACE svg"]);
const cov = { nonEmptyOutput: 0, svg: 0, math: 0, template: 0, form: 0, table: 0, style: 0, textarea: 0, noscript: 0, hookTarget: 0 }; // default-config output coverage
const t0 = Date.now();
for (; done < N; done++) {
  if ((done & 255) === 0 && (Date.now() - t0) / 1000 > MAXS) break;
  const input = gen(); 
  for (const im of impls) {
    const a = run(im.j, input, im.cfg, im.jw, im.name), b = run(im.s, input, im.cfg, im.sw, im.name);
    if (a.startsWith("ERR:")) errs++;
    if (im.name === "default" && a.length > 4) { cov.nonEmptyOutput++; for (const k of ["svg", "math", "template", "form", "table", "style", "textarea", "noscript"]) if (a.includes("<" + k)) cov[k]++; }
    if (im.name === "ADD_ATTR+hook" && a.includes("target=")) cov.hookTarget++;
    if (a !== b && XMLCFG.has(im.name) && /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(input)) { known++; knownEx.length < 5 && knownEx.push({ cfg: im.name, input, jsdom: a, shim: b }); } else if (a !== b) { nd++; byCfg[im.name] = (byCfg[im.name] || 0) + 1; if (diffs.length < 400) diffs.push({ cfg: im.name, input, jsdom: a, shim: b }); }
  }
  if (done % 20000 === 0 && done) console.error(`${done} cases, ${nd} diffs, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
const secs = (Date.now() - t0) / 1000;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ cov, known, jsdomThrew: errs, cases: done, comparisons: done * CONFIGS.length, differences: nd, byCfg, seconds: secs, diffs }));
if (jw) jw.close();
}
