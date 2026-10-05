// Regenerates src/names.js: the property names reachable with `in` on a Document and on an HTMLFormElement, taken from jsdom.
// DOMPurify's SANITIZE_DOM check is `value in document || value in formElement`, so the shim must answer `in` like a browser does.
// usage: node scripts/gen-names.mjs   (needs the jsdom devDependency)
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const w = new JSDOM("").window;
const t = w.document.createElement("template").content.ownerDocument;
const names = (o) => { const s = new Set(); for (; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const n of Object.getOwnPropertyNames(o)) s.add(n); return s; };
const d = names(t), f = names(w.document.createElement("form"));
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/names.js");
const list = (s) => JSON.stringify([...s].filter((n) => n !== "constructor"));
fs.writeFileSync(file, `// generated from jsdom by scripts/gen-names.mjs: property names reachable via \`in\` on Document and HTMLFormElement (DOMPurify SANITIZE_DOM clobber check)\nexport const DOC_NAMES = ${list(d)};\nexport const FORM_NAMES = ${list(f)};\n`);
console.log(d.size, f.size);
