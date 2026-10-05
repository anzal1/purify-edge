// Throughput and peak memory.
//
//   node bench/speed.mjs [--runs 5]        parent: runs every contender on corpus a, corpus c and "boot" (module load only, no corpus) and writes
//                                          bench/results/speed.json. Reported numbers are the median of the runs.
//   node bench/speed.mjs --child <name> <a|c|boot>   one measurement, one process. Not meant to be called by hand.
//
// Every measurement is its own child process (`node --max-old-space-size=4096`), so peak RSS is not polluted by an earlier contender. Peak RSS is
// process.resourceUsage().maxRSS read at the end of the child; it includes the corpus held in memory, the same for every contender. A run is cut at 90 s.
// Run it under `nice -n 19` on a loaded machine; nothing here is parallel.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NAMES, LABELS, REFERENCE } from "./contenders.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CAP_MS = 90_000;
const argv = process.argv.slice(2);

if (argv[0] === "--child") {
  const [, name, corpus] = argv;
  const { make } = await import("./contenders.mjs");
  const { load } = await import("./gen-corpus.mjs");
  const c = await make(name);
  const rssMB = () => process.resourceUsage().maxRSS / 1024; // libuv reports KB on Linux and macOS
  if (corpus === "boot") { c.sanitize("<p>warm</p>"); console.log(JSON.stringify({ name, corpus, peakRssMB: +rssMB().toFixed(1) })); process.exit(0); }
  const docs = load()[corpus];
  const warm = corpus === "a" ? 20 : 1;
  for (let i = 0; i < warm; i++) c.sanitize(docs[i]);
  let n = 0, bytes = 0;
  const t0 = performance.now();
  for (; n < docs.length; n++) {
    c.sanitize(docs[n]); bytes += docs[n].length;
    if (performance.now() - t0 > CAP_MS) { n++; break; }
  }
  const ms = performance.now() - t0;
  console.log(JSON.stringify({ name, corpus, n, of: docs.length, capped: n < docs.length, ms: Math.round(ms), opsPerSec: n / (ms / 1000), mbPerSec: bytes / 1e6 / (ms / 1000), peakRssMB: +rssMB().toFixed(1) }));
  process.exit(0);
}

const runs = +(argv[argv.indexOf("--runs") + 1] || 5);
const median = (xs) => { const s = [...xs].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

await import("./gen-corpus.mjs").then((m) => m.load()); // make sure the cache exists before any child starts

const results = {};
for (const name of NAMES) {
  results[name] = {};
  for (const corpus of ["boot", "a", "c"]) {
    const rs = [];
    for (let i = 0; i < runs; i++) {
      const p = spawnSync(process.execPath, ["--max-old-space-size=4096", fileURLToPath(import.meta.url), "--child", name, corpus], { encoding: "utf8", maxBuffer: 1 << 24 });
      if (p.status !== 0) throw new Error(`${name} ${corpus} failed: ${p.stderr || p.stdout}`);
      rs.push(JSON.parse(p.stdout.trim().split("\n").pop()));
    }
    results[name][corpus] = corpus === "boot"
      ? { peakRssMB: median(rs.map((r) => r.peakRssMB)) }
      : { n: rs[0].n, of: rs[0].of, capped: rs.some((r) => r.capped), opsPerSec: median(rs.map((r) => r.opsPerSec)), mbPerSec: median(rs.map((r) => r.mbPerSec)), peakRssMB: median(rs.map((r) => r.peakRssMB)), allOpsPerSec: rs.map((r) => +r.opsPerSec.toFixed(2)) };
    process.stderr.write(`${name} ${corpus} ${corpus === "boot" ? results[name][corpus].peakRssMB + " MB" : results[name][corpus].opsPerSec.toFixed(1) + " ops/s"}\n`);
  }
}

const ref = results[REFERENCE];
const f = (x, d = 0) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
console.log(`\nmedian of ${runs} runs\n` + ["contender".padEnd(22), "a ops/s".padStart(8), "vs ref".padStart(7), "c ops/s".padStart(8), "vs ref".padStart(7), "RSS a MB".padStart(9), "RSS c MB".padStart(9), "idle MB".padStart(8)].join("  "));
for (const name of NAMES) {
  const r = results[name];
  console.log([name.padEnd(22), f(r.a.opsPerSec).padStart(8), (r.a.opsPerSec / ref.a.opsPerSec).toFixed(1).padStart(6) + "x", f(r.c.opsPerSec, 1).padStart(8), (r.c.opsPerSec / ref.c.opsPerSec).toFixed(1).padStart(6) + "x", f(r.a.peakRssMB).padStart(9), f(r.c.peakRssMB).padStart(9), f(r.boot.peakRssMB).padStart(8)].join("  "));
}

fs.mkdirSync(path.join(here, "results"), { recursive: true });
fs.writeFileSync(path.join(here, "results/speed.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), runs, node: process.version, platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0].model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30),
  reference: REFERENCE, labels: LABELS, results,
}, null, 2) + "\n");
console.log("\nwrote bench/results/speed.json");
