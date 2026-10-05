// Shared test helpers: the reference (DOMPurify on jsdom) and the subject (purify-edge), plus a serializer that makes DOM-returning configs comparable.
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const createDOMPurify = require("dompurify");

export const reference = () => {
  const w = new JSDOM("<!doctype html><html><head></head><body></body></html>").window;
  return { purify: createDOMPurify(w), window: w };
};

export const ser = (r, w) => {
  if (typeof r === "string") return r;
  if (r && r.nodeType === 11) { const d = w.document.createElement("div"); d.appendChild(r); return "FRAG:" + d.innerHTML; }
  if (r && r.nodeType === 1) return "EL:" + r.outerHTML;
  return "OTHER:" + String(r);
};

// Runs sanitize and returns the output string, or "ERR:name:message" when it throws, so thrown errors are compared too.
export const run = (p, w, input, cfg) => {
  try { return ser(p.sanitize(input, cfg), w); } catch (e) { return "ERR:" + (e && e.name) + ":" + String(e && e.message).slice(0, 120); }
};
