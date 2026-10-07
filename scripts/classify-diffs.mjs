// Buckets the remaining jsdom-versus-purify-edge fuzz differences into the documented classes (see README, "Security model") and checks that each one fails closed:
// the purify-edge output must be a character subsequence of jsdom's, so purify-edge only ever keeps less.
// usage: node scripts/classify-diffs.mjs results/fuzz-ext-fixed.json
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const norm = (t) => t.replace(/\s*\/>/g, ">"); // void/empty elements serialize "<x />" vs "<x></x>" shapes; compare content, not shape
export const subseq = (a, b) => { let i = 0; for (const c of b) if (i < a.length && a[i] === c) i++; return i === a.length; };

// true when the purify-edge result keeps no more than jsdom's: a character subsequence after normalizing empty-element shapes,
// or purify-edge throwing where jsdom returned an empty string (nothing is emitted either way)
export const failsClosed = (jsdomOut, shimOut) => /^ERR:/.test(shimOut) && !/^ERR:/.test(jsdomOut) && /^OUT:$/.test(jsdomOut) || subseq(norm(shimOut.replace(/^(OUT|EL|FRAG):/, "")), norm(jsdomOut.replace(/^(OUT|EL|FRAG):/, "")));

export function classify(diffs) {
  const out = {};
  for (const x of diffs) {
    const j = x.jsdom.replace(/^(OUT|EL|FRAG):/, ""), s = x.shim.replace(/^(OUT|EL|FRAG):/, "");
    const raw = x.input.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ""); // "]]>" outside CDATA sections
    const cls = x.cfg === "RETURN_DOM" && /^<body\b/.test(x.input.trim()) && /\bis=/.test(j) ? "is-value"
      : /^(XHTML|NAMESPACE)/.test(x.cfg) && raw.includes("]]>") ? "raw-]]>-in-text"
      : x.cfg === "XHTML" && /<[A-Za-z][\w.-]*:template[\s>]/.test(x.input) ? "prefixed-template-removed"
      : /^(XHTML|NAMESPACE)/.test(x.cfg) && /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(x.input) ? "unpaired-surrogate" : "UNCLASSIFIED";
    const fc = failsClosed(x.jsdom, x.shim);
    (out[cls] ||= { n: 0, failClosed: 0, ex: [] }); out[cls].n++; if (fc) out[cls].failClosed++; else out[cls].ex.push(x);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const d = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), out = classify(d.diffs);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { n: v.n, failClosed: v.failClosed, nonClosedExamples: v.ex.length }])), null, 1));
  for (const [k, v] of Object.entries(out)) if (k === "UNCLASSIFIED" || v.ex.length) for (const x of v.ex.slice(0, 3)) console.log(k, JSON.stringify(x).slice(0, 600));
}

