// Deterministic parity corpus: the same generator the verification used (marked-rendered LLM-style responses with injected hostile payloads),
// plus hostile payloads mutated into the shapes chat output puts them in. No randomness outside the fixed seed, so a failure is reproducible.
import { marked } from "marked";
import fs from "node:fs";

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

// Marked-rendered chat responses, about a quarter with a hostile payload injected.
export function chatDocs(n = 160) {
  seed = 12345;
  const docs = [];
  for (let i = 0; i < n; i++) {
    const count = int(3, 14); const blocks = Array.from({ length: count }, block);
    if (rnd() < 0.4) for (let k = int(1, 2); k > 0; k--) blocks.splice(int(0, blocks.length), 0, rnd() < 0.5 ? "Some text " + pick(hostile) + " more text" : pick(hostile));
    docs.push(marked.parse(blocks.join("\n\n")));
  }
  return docs;
}

// Every HTML-looking hostile payload in a handful of mutated shapes: upper-cased, mixed-case and Unicode-lookalike names, odd attribute whitespace, NUL after "<",
// entity-encoded, and nested in chat-rendered paragraphs, tables, lists and foreign-content wrappers.
export function mutatedPayloads() {
  const out = [];
  const tags = hostile.filter((h) => h.startsWith("<"));
  const wrappers = [["<svg>", "</svg>"], ["<math><mtext>", "</mtext></math>"], ["<template>", "</template>"], ["<noscript>", "</noscript>"], ["<table><tr><td>", "</td></tr></table>"], ["<select><option>", "</option></select>"], ["<form>", "</form>"]];
  tags.forEach((p, i) => {
    out.push(p);
    out.push(p.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*/g, (m) => m.toUpperCase()));
    out.push(p.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*/g, (m) => m.replace(/i/g, "\u0131").replace(/s/g, "\u017f").replace(/k/g, "\u212a"))); // tag names that only fold to ASCII under Unicode case mapping
    out.push(p.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*/g, (m, o) => m.split("").map((c, k) => ((k + o) % 2 ? c.toUpperCase() : c)).join("")));
    out.push(p.replace(/ (?=[a-zA-Z:-]+=)/g, i % 2 ? "\n" : "\t"));
    out.push(p.replace(/ (?=[a-zA-Z:-]+=)/g, "/"));
    out.push(p.replace(/^<([a-zA-Z])/, "<\u0000$1"));
    out.push(p.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
    out.push(marked.parse("Here is the result:\n\n" + p + "\n\n- item with " + p + "\n\n| a | b |\n|---|---|\n| " + p + " | `x` |\n"));
    const w = wrappers[i % wrappers.length]; out.push(w[0] + p + w[1]);
    out.push("<p>" + p + "</p><!--" + p + "-->");
  });
  return out;
}

// DOMPurify's own test vectors (payloads only; the expected strings stay in DOMPurify's repository). See test/fixtures/README.md.
export const vectors = JSON.parse(fs.readFileSync(new URL("./fixtures/expect-payloads.json", import.meta.url), "utf8"));
