// usage: node scripts/tap-compare.mjs jsdom.tap shim.tap
// Compares per-test assertion lines (numbering stripped) between two TAP runs and exits non-zero unless the shim run is clean and identical.
import fs from "node:fs";

function load(f) {
  const res = new Map(); let mod = "", test = null;
  for (const l0 of fs.readFileSync(f, "utf8").split("\n")) {
    const l = l0.trim();
    if (l.startsWith("# module:")) { mod = l.slice(9).trim(); continue; }
    if (l.startsWith("# test:")) { test = mod + " :: " + l.slice(7).trim(); let k = test, n = 2; while (res.has(k)) k = test + " #" + n++; test = k; res.set(test, []); continue; }
    const m = /^(not ok|ok) \d+\s*-?\s*(.*)$/.exec(l);
    if (m && test) res.get(test).push((m[1] === "ok" ? "ok " : "NOT OK ") + m[2].replace(/, test: .*$/, "").replace(/in \d+ms/, "in Nms").slice(0, 400));
  }
  return res;
}
const count = (f) => { const t = fs.readFileSync(f, "utf8"); return { tests: (t.match(/^# test:/gm) || []).length, ok: (t.match(/^\s*ok \d+/gm) || []).length, notOk: (t.match(/^\s*not ok/gm) || []).length, skip: (t.match(/# skip/gi) || []).length }; };
const [fa, fb] = process.argv.slice(2), A = load(fa), B = load(fb), ca = count(fa), cb = count(fb);
let same = 0, diff = 0, missing = 0; const failB = [];
for (const [k, a] of A) {
  const b = B.get(k);
  if (!b) { missing++; console.log("MISSING on shim run:", k); continue; }
  if (b.some((x) => x.startsWith("NOT OK"))) failB.push(k);
  if (JSON.stringify(a) === JSON.stringify(b)) same++;
  else { diff++; console.log("DIFF:", k, "\n   jsdom:", JSON.stringify(a).slice(0, 500), "\n   shim :", JSON.stringify(b).slice(0, 500)); }
}
const extraB = [...B.keys()].filter((k) => !A.has(k)).length;
console.log("jsdom :", JSON.stringify(ca));
console.log("shim  :", JSON.stringify(cb));
console.log({ identical: same, different: diff, notRunOnShim: missing, onlyOnShim: extraB, shimTestsWithFailures: failB.length });
const ok = cb.notOk === 0 && ca.notOk === 0 && diff === 0 && missing === 0 && extraB === 0 && cb.tests === ca.tests && cb.ok === ca.ok && ca.tests > 0 && cb.skip === ca.skip;
console.log(ok ? `PASS: ${cb.tests} tests, ${cb.ok} assertions, identical to jsdom` : "FAIL");
process.exit(ok ? 0 : 1);
