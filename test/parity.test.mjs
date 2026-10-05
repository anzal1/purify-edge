// Parity: purify-edge must give byte-identical output to DOMPurify on jsdom (same DOMPurify build, same config) on every case.
// Cases: DOMPurify's 223 official vectors, marked-rendered chat responses with injected payloads, and hostile payloads mutated into chat shapes.
import test from "node:test";
import assert from "node:assert/strict";
import { createDOMPurify, window as edgeWindow } from "../src/index.js";
import { reference, run } from "./helpers.mjs";
import { vectors, chatDocs, mutatedPayloads } from "./corpus.mjs";

// The README's example hook: IDL reflection of `target` must behave like a browser for `'target' in node` to be true on anchors only.
const readmeHook = (node) => {
  if ("target" in node) { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener"); }
  if (node.hasAttribute && node.hasAttribute("data-x")) node.setAttribute("data-x", node.getAttribute("data-x").toUpperCase());
};
const CONFIGS = {
  default: [{}, null],
  "USE_PROFILES html": [{ USE_PROFILES: { html: true } }, null],
  FORBID_TAGS: [{ FORBID_TAGS: ["style", "form", "input", "textarea"] }, null],
  RETURN_DOM: [{ RETURN_DOM: true }, null],
  RETURN_DOM_FRAGMENT: [{ RETURN_DOM_FRAGMENT: true }, null],
  SAFE_FOR_TEMPLATES: [{ SAFE_FOR_TEMPLATES: true }, null],
  WHOLE_DOCUMENT: [{ WHOLE_DOCUMENT: true }, null],
  "ADD_ATTR + README hook": [{ ADD_ATTR: ["target", "data-x"] }, readmeHook],
};
function compare(t, label, inputs, names) {
  let total = 0, nonEmpty = 0; const bad = [];
  for (const name of names) {
    const [cfg, hook] = CONFIGS[name];
    // fresh instances per config so hooks and config never leak between configs
    const ej = reference(), ee = createDOMPurify();
    if (hook) { ej.purify.addHook("afterSanitizeAttributes", hook); ee.addHook("afterSanitizeAttributes", hook); }
    for (const input of inputs) {
      total++;
      const a = run(ej.purify, ej.window, input, cfg), b = run(ee, edgeWindow, input, cfg);
      if (b.length > 5) nonEmpty++; // guards against both sides silently returning ""
      if (a !== b) bad.push({ name, input: input.slice(0, 300), jsdom: a.slice(0, 300), edge: b.slice(0, 300) });
    }
    ej.window.close();
  }
  t.diagnostic(`${label}: ${inputs.length} inputs x ${names.length} configs = ${total} comparisons, ${bad.length} differences`);
  assert.ok(nonEmpty > total / 2, `only ${nonEmpty} of ${total} outputs were non-empty; the comparison is not exercising the sanitizer`);
  assert.equal(bad.length, 0, `${bad.length} of ${total} differ from DOMPurify-on-jsdom. First: ${JSON.stringify(bad[0], null, 1)}`);
  return total;
}

test("the corpus is the size the README claims", () => {
  assert.equal(vectors.length, 223);
  assert.ok(chatDocs().length >= 150);
  assert.ok(mutatedPayloads().length >= 200);
  assert.equal(JSON.stringify(chatDocs(5)), JSON.stringify(chatDocs(5)), "the corpus must be deterministic");
});

test("parity: DOMPurify's official vectors, 8 configs", (t) => {
  compare(t, "vectors", vectors.map((v) => v.payload), Object.keys(CONFIGS));
});

test("parity: marked-rendered chat responses with injected payloads, 3 configs", (t) => {
  compare(t, "chat", chatDocs(), ["default", "USE_PROFILES html", "ADD_ATTR + README hook"]);
});

test("parity: hostile payloads mutated into chat shapes, 4 configs", (t) => {
  compare(t, "mutated", mutatedPayloads(), ["default", "USE_PROFILES html", "RETURN_DOM", "SAFE_FOR_TEMPLATES"]);
});
