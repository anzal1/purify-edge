// Parity and safety comparison.
//
//   identical:  percent of DOMPurify's 223 expect vectors (test/fixtures/expect-payloads.json) whose output is byte-identical to isomorphic-dompurify's.
//   live:       corpus-a outputs (of 2,000) that contain at least one element with an on* attribute once the OUTPUT is re-parsed with parse5. This is the honest
//               "becomes live XSS in a browser" measure. (elements = the total number of such elements across all outputs.)
//   raw:        corpus-a outputs where a regex finds an on*= attribute in tag position in the raw output string, with no re-parse.
//   js urls:    extra, not part of the on* measure: corpus-a outputs with a javascript: URL in href/src/action/... after the same re-parse.
//   differ:     corpus-a outputs that differ byte for byte from isomorphic-dompurify's.
//
//   node bench/parity.mjs        writes bench/results/parity.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAMES, LABELS, REFERENCE, make } from "./contenders.mjs";
import { liveHandlers, liveScriptUrls, RAW_ON_ATTR } from "./reparse.mjs";
import { load } from "./gen-corpus.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(fs.readFileSync(path.join(here, "../test/fixtures/expect-payloads.json"), "utf8"));
const { a: corpusA } = load();

const run = (c, inputs) => inputs.map((s) => { try { return c.sanitize(s); } catch (e) { return "ERR:" + e.message; } });

const outs = {};
for (const name of NAMES) {
  const c = await make(name);
  outs[name] = { vec: run(c, vectors.map((v) => v.payload)), a: run(c, corpusA) };
  process.stderr.write(name + " done\n");
}

const ref = outs[REFERENCE];
const rows = NAMES.map((name) => {
  const o = outs[name];
  const same = o.vec.filter((x, i) => x === ref.vec[i]).length;
  let live = 0, elements = 0, raw = 0, errors = 0, jsUrls = 0;
  for (const out of o.a) {
    if (out.startsWith("ERR:")) { errors++; continue; }
    const h = liveHandlers(out);
    if (h.length) { live++; elements += h.length; }
    if (liveScriptUrls(out).length) jsUrls++;
    if (RAW_ON_ATTR.test(out)) raw++;
  }
  return {
    contender: name, label: LABELS[name],
    vectors: vectors.length, identical: same, identicalPct: +(100 * same / vectors.length).toFixed(1),
    corpusA: corpusA.length, differ: o.a.filter((x, i) => x !== ref.a[i]).length,
    liveHandlerOutputs: live, liveHandlerElements: elements, liveJavascriptUrlOutputs: jsUrls, rawMatches: raw, errors,
  };
});

console.log("\n" + ["contender".padEnd(22), "identical (of " + vectors.length + ")".padEnd(18), "live after re-parse".padEnd(20), "raw matches".padEnd(12), "js urls".padEnd(8), "differ on a"].join("  "));
for (const r of rows) console.log([r.contender.padEnd(22), `${r.identicalPct.toFixed(1)}% (${r.identical})`.padEnd(18), `${r.liveHandlerOutputs} of ${r.corpusA}`.padEnd(20), String(r.rawMatches).padEnd(12), String(r.liveJavascriptUrlOutputs).padEnd(8), r.differ].join("  "));

fs.mkdirSync(path.join(here, "results"), { recursive: true });
fs.writeFileSync(path.join(here, "results/parity.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), node: process.version, reference: REFERENCE, rows,
}, null, 2) + "\n");
console.log("\nwrote bench/results/parity.json");
