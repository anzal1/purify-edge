// Seeded corpus generator. Nothing large is committed: the corpora are generated at run time (and cached in bench/.cache, which is gitignored).
//
//   a: 2,000 marked-rendered LLM-style chat responses (about 2.1 KB each), roughly a quarter with injected hostile payloads.
//   c: 50 generated newsletter/email HTML documents, 100 KB to 1 MB (log spaced), about 19.7 MB in total.
//
// Both come from one linear congruential generator with a fixed seed (12345), and c continues the stream after a, so the output is the same on every machine.
// The corpus also depends on the pinned `marked` version (devDependencies). `node bench/gen-corpus.mjs` prints a sha1 of each corpus; compare them to detect drift.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".cache");

export function generate() {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const words = "the of and to in is that for it as with was on be at by this have from or one had but not what all were when we there can an your which their said if do will each about how up out them then she many some so these would other into has more her two like him see time could no make than first been its who now people my made over did down only way find use may water long little very after words called just where most know get through back much before go good new write our used me man too any day same right look think also around another came come work three word must because does part even place well such here take why help put different away again off went old number great tell men say small every found still between name should home big give air line set own under read last never us left end along while might next sound below saw something thought both few those always looked show large often together asked house don't world going want school important until form food keep children feet land side without boy once animals life enough took sometimes four head above kind began almost live page got earth need far hand high year mother light parts country father let night following picture being study second eyes soon times story boys since white days ever paper hard near sentence better best across during today however sure knew it's try told young sun thing whole hear example heard several change answer room sea against top turned learn point city play toward five using himself usually".split(" ");
  const sent = (n = int(6, 22)) => { const w = Array.from({ length: n }, () => pick(words)); w[0] = w[0][0].toUpperCase() + w[0].slice(1); return w.join(" ") + "."; };
  const inline = () => { const s = sent(); const r = rnd(); if (r < 0.15) return s.replace(/\b(\w+)\b/, "**$1**"); if (r < 0.3) return s.replace(/\b(\w+)\b/, "`$1()`"); if (r < 0.4) return s + " See [the docs](https://example.com/docs/" + pick(words) + "?a=1&b=2)."; if (r < 0.45) return s + " " + "![diagram](https://cdn.example.com/img/" + int(1, 999) + ".png)"; if (r < 0.5) return s.replace(/\b(\w+)\b/, "_$1_") + " <br> next line"; if (r < 0.53) return "Use <kbd>Ctrl</kbd>+<kbd>C</kbd> to copy; H<sub>2</sub>O and x<sup>2</sup>."; return s; };
  const langs = ["js", "python", "ts", "bash", "json", "rust", "go", "html", "sql", "css"];
  const code = (l) => ({
    js: "const res = await fetch(url);\nif (!res.ok) throw new Error(`HTTP ${res.status}`);\nconst data = await res.json();\nconsole.log(data.items.map(i => i.id < 10 && i.name));",
    python: "def f(xs: list[int]) -> int:\n    return sum(x for x in xs if x > 0 and x < 100)\n\nprint(f([1, -2, 3]))",
    ts: "type Pair<A, B> = { a: A; b: B };\nfunction mk<A, B>(a: A, b: B): Pair<A, B> { return { a, b }; }\nconst p: Array<Pair<number, string>> = [];",
    bash: "for f in *.log; do\n  grep -E 'ERROR|WARN' \"$f\" | sort | uniq -c > \"$f.summary\" && echo done >&2\ndone",
    json: '{\n  "name": "demo",\n  "tags": ["a", "b"],\n  "html": "<div class=\\"x\\">hi</div>"\n}',
    rust: "fn main() {\n    let v: Vec<u32> = (1..=5).collect();\n    let s: u32 = v.iter().filter(|&&x| x % 2 == 1).sum();\n    println!(\"{s} <- odd\");\n}",
    go: "func main() {\n\tch := make(chan int, 3)\n\tgo func() { for i := 0; i < 3; i++ { ch <- i }; close(ch) }()\n\tfor v := range ch { fmt.Println(v) }\n}",
    html: '<div class="card" onclick="open()">\n  <img src="a.png" alt="a">\n  <script>alert(1)</script>\n</div>',
    sql: "SELECT u.id, COUNT(*) AS n\nFROM users u JOIN orders o ON o.uid = u.id\nWHERE o.total > 100 AND u.name LIKE '%<x>%'\nGROUP BY u.id HAVING COUNT(*) > 2;",
    css: ".a > .b:hover { color: #fff; background: url(\"x.png\"); }\n@media (max-width: 600px) { .a { display: none } }",
  }[l]);
  const table = () => { const c = int(2, 5), r = int(2, 6); const h = Array.from({ length: c }, (_, i) => "Col " + (i + 1)); return "| " + h.join(" | ") + " |\n| " + h.map(() => "---").join(" | ") + " |\n" + Array.from({ length: r }, () => "| " + h.map(() => pick(words) + (rnd() < 0.2 ? " `x`" : "")).join(" | ") + " |").join("\n"); };
  const list = (o) => Array.from({ length: int(2, 6) }, (_, i) => (o ? i + 1 + ". " : rnd() < 0.15 ? "- [x] " : "- ") + inline() + (rnd() < 0.2 ? "\n   - " + sent(5) + "\n   - " + sent(4) : "")).join("\n");
  const hostile = [
    '<script>alert(document.cookie)</script>', '<img src=x onerror=alert(1)>', '<svg onload=alert(1)>', '<svg><script>alert(1)</script></svg>',
    '<iframe src="javascript:alert(1)"></iframe>', '<a href="javascript:alert(1)">click</a>', '<a href="  JaVaScRiPt:alert(1)">x</a>', '<math><mi xlink:href="data:x,<script>alert(1)</script>"></mi></math>',
    '<form><input name="cookie"><input id="getElementById"></form>', '<form id="x"><button formaction="javascript:alert(1)">go</button></form>', '<noscript><p title="</noscript><img src=x onerror=alert(1)>">', '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;/mglyph&gt;&lt;img src=1 onerror=alert(1)&gt;">',
    '<svg><style><img src=x onerror=alert(1)></style></svg>', '<div style="background:url(javascript:alert(1))">x</div>', '<object data="javascript:alert(1)"></object>', '<embed src="data:text/html,<script>alert(1)</script>">',
    '<details open ontoggle=alert(1)>', '<video><source onerror="alert(1)"></video>', '<base href="javascript:alert(1)//"><a href="x">x</a>', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
    '<style>@import "javascript:alert(1)";</style>', '<template><script>alert(1)</script></template>', '<table><caption><svg><desc><a><style><!--</style></a></desc></svg></caption></table><img src=x onerror=alert(1)>', '<p id=a onclick=alert(1)>text</p><svg><foreignObject><p onmouseover=alert(1)>x</p></foreignObject></svg>',
    '[x](javascript:alert(1))', '![x](javascript:alert(1))', '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)', '<xmp><p title="</xmp><img src=x onerror=alert(1)>">',
  ];
  const block = () => { const r = rnd(); if (r < 0.28) return inline() + " " + inline(); if (r < 0.38) return "#".repeat(int(2, 4)) + " " + sent(int(2, 6)); if (r < 0.5) return list(false); if (r < 0.58) return list(true); if (r < 0.74) { const l = pick(langs); return "```" + l + "\n" + code(l) + "\n```"; } if (r < 0.82) return table(); if (r < 0.88) return "> " + sent() + "\n> " + sent(); if (r < 0.9) return "---"; return sent() + " " + inline(); };
  const docs = [];
  for (let i = 0; i < 2000; i++) {
    const n = int(3, 14); const blocks = Array.from({ length: n }, block);
    if (rnd() < 0.25) for (let k = int(1, 2); k > 0; k--) blocks.splice(int(0, blocks.length), 0, rnd() < 0.5 ? "Some text " + pick(hostile) + " more text" : pick(hostile));
    docs.push(marked.parse(blocks.join("\n\n")));
  }

  // (c) 50 large newsletter/email HTML docs, 100KB..1MB
  const style = "body{margin:0;padding:0;background:#f4f4f4}table{border-collapse:collapse}.btn{background:#0a66c2;color:#fff;padding:12px 24px;border-radius:4px}@media only screen and (max-width:600px){.col{display:block!important;width:100%!important}}";
  const cell = () => `<td class="col" width="${pick([200, 300, 600])}" valign="top" style="padding:${int(4, 24)}px;font-family:Arial,Helvetica,sans-serif;font-size:${int(12, 18)}px;color:#${pick(["333", "555", "111", "0a66c2"])};line-height:1.5" bgcolor="#ffffff" align="${pick(["left", "center", "right"])}">` +
    (rnd() < 0.35 ? `<a href="https://track.example.com/c?u=${int(1, 1e6)}&amp;e=${int(1, 1e6)}" target="_blank" style="color:#0a66c2;text-decoration:underline">${sent(5)}</a> ` : "") + `<p style="margin:0 0 10px 0">${sent(int(10, 30))} <b>${pick(words)}</b> <i>${pick(words)}</i> <span style="color:#c00">${pick(words)}</span></p>` +
    (rnd() < 0.3 ? `<img src="https://img.example.com/${int(1, 9999)}.jpg" width="${pick([120, 300, 600])}" height="${pick([80, 200])}" alt="${pick(words)}" border="0" style="display:block;outline:none">` : "") +
    (rnd() < 0.08 ? `<a href="https://example.com/x" class="btn" style="display:inline-block;background:#0a66c2;color:#fff">${pick(words)}</a>` : "") + `</td>`;
  const row = () => `<tr>${Array.from({ length: int(1, 3) }, cell).join("")}</tr>`;
  const mso = () => `<!--[if mso]><table role="presentation" width="600"><tr><td><![endif]-->`;
  const big = [];
  for (let i = 0; i < 50; i++) {
    const target = Math.round(100e3 * Math.pow(10, (i / 49) * 1)); // 100KB .. 1MB log spaced
    let h = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><meta name="viewport" content="width=device-width"><title>Newsletter ${i}</title><style type="text/css">${style}</style></head><body bgcolor="#f4f4f4"><center>`;
    let t = `<table width="600" cellpadding="0" cellspacing="0" border="0" align="center" role="presentation">`;
    while (h.length + t.length < target) { if (rnd() < 0.05) t += mso(); t += row(); if (rnd() < 0.002) t += "<tr><td>" + pick(hostile.filter((x) => x.startsWith("<"))) + "</td></tr>"; if (rnd() < 0.01) t += `<tr><td><img src="https://t.example.com/open.gif?i=${i}" width="1" height="1" alt=""></td></tr>`; }
    big.push(h + t + `</table></center></body></html>`);
  }
  return { a: docs, c: big };
}

// Load the corpora from the cache, generating them first when missing. Returns { a, c } as arrays of strings.
export function load() {
  const fa = path.join(CACHE, "a.json"), fc = path.join(CACHE, "c.json");
  if (!fs.existsSync(fa) || !fs.existsSync(fc)) {
    const { a, c } = generate();
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(fa + ".tmp", JSON.stringify(a)); fs.renameSync(fa + ".tmp", fa);
    fs.writeFileSync(fc + ".tmp", JSON.stringify(c)); fs.renameSync(fc + ".tmp", fc);
  }
  return { a: JSON.parse(fs.readFileSync(fa, "utf8")), c: JSON.parse(fs.readFileSync(fc, "utf8")) };
}

const sha = (docs) => crypto.createHash("sha1").update(JSON.stringify(docs)).digest("hex").slice(0, 12);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.rmSync(CACHE, { recursive: true, force: true });
  const { a, c } = load();
  const sz = a.map((d) => d.length), bs = c.map((d) => d.length);
  console.log("a: n =", a.length, "avg bytes", Math.round(sz.reduce((x, y) => x + y) / sz.length), "max", Math.max(...sz), "hostile docs ~", a.filter((d) => /onerror|<script|javascript:|onload/i.test(d)).length, "sha1", sha(a));
  console.log("c: n =", c.length, "min", Math.min(...bs), "max", Math.max(...bs), "total MB", (bs.reduce((x, y) => x + y) / 1e6).toFixed(1), "sha1", sha(c));
}
