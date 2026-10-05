// The five contenders, each as { sanitize(html) -> string } with default DOMPurify config (or the closest equivalent).
//   isomorphic-dompurify   DOMPurify on jsdom. The reference everything is compared against.
//   linkedom               unmodified DOMPurify on linkedom, with the compat patch below so that it starts at all.
//   sanitize-html          configured with DOMPurify's own default tag and attribute lists.
//   rehype-sanitize        default schema.
//   purify-edge            DOMPurify on the parse5-backed shim in ../src.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export const NAMES = ["isomorphic-dompurify", "linkedom", "sanitize-html", "rehype-sanitize", "purify-edge"];
export const LABELS = {
  "isomorphic-dompurify": "DOMPurify on jsdom (isomorphic-dompurify)",
  linkedom: "DOMPurify + linkedom (patched to start at all)",
  "sanitize-html": "sanitize-html (DOMPurify's tag and attribute lists)",
  "rehype-sanitize": "rehype-sanitize (default schema)",
  "purify-edge": "purify-edge",
};
export const REFERENCE = "isomorphic-dompurify";

// Read one of DOMPurify's frozen allow lists (html, html$1, ...) out of the installed dompurify source, so sanitize-html gets exactly DOMPurify's defaults.
function listFrom(name) {
  const src = fs.readFileSync(require.resolve("dompurify"), "utf8");
  const m = src.match(new RegExp("const " + name.replace("$", "\\$") + " = freeze\\(\\[([\\s\\S]*?)\\]\\);"));
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

export async function make(name) {
  switch (name) {
    case "isomorphic-dompurify": { // = DOMPurify(new JSDOM("<!DOCTYPE html>").window)
      const m = await import("isomorphic-dompurify");
      const D = m.default;
      return { sanitize: (h) => D.sanitize(h) };
    }
    case "linkedom": {
      const [{ default: createDOMPurify }, { parseHTML }] = await Promise.all([import("dompurify"), import("linkedom")]);
      const BLANK = "<!DOCTYPE html><html><head></head><body></body></html>";
      const w = parseHTML(BLANK);
      const NodeFilter = { FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3, SHOW_ALL: 0xffffffff, SHOW_ELEMENT: 1, SHOW_ATTRIBUTE: 2, SHOW_TEXT: 4, SHOW_CDATA_SECTION: 8, SHOW_PROCESSING_INSTRUCTION: 64, SHOW_COMMENT: 128, SHOW_DOCUMENT: 256, SHOW_DOCUMENT_TYPE: 512, SHOW_DOCUMENT_FRAGMENT: 1024 };

      // ---- linkedom compat patch -------------------------------------------------------------------------------------------------------------
      // This is the minimum needed for DOMPurify 3.4 to boot on linkedom; it only adds missing getters and document.implementation.
      // Without it DOMPurify feature-detects linkedom as unsupported and every sanitize() returns "". It changes no parsing and no serialization:
      // everything the benchmark reports about linkedom's output (entity handling, attribute serialization, mXSS) is linkedom's own behaviour.
      const mkGetter = (proto, prop) => { if (!Object.getOwnPropertyDescriptor(proto, prop)) Object.defineProperty(proto, prop, { configurable: true, get() { return null; }, set(v) { Object.defineProperty(this, prop, { value: v, writable: true, configurable: true, enumerable: true }); } }); };
      mkGetter(w.Element.prototype, "parentNode");
      const mkFwd = (proto, prop) => { if (Object.getOwnPropertyDescriptor(proto, prop)) return; Object.defineProperty(proto, prop, { configurable: true, get() { const own = Object.getOwnPropertyDescriptor(this, prop); if (own) return own.get ? own.get.call(this) : own.value; for (let o = Object.getPrototypeOf(this); o && o !== proto; o = Object.getPrototypeOf(o)) { const d = Object.getOwnPropertyDescriptor(o, prop); if (d) return d.get ? d.get.call(this) : d.value; } return null; }, set(v) { Object.defineProperty(this, prop, { value: v, writable: true, configurable: true, enumerable: true }); } }); };
      mkFwd(w.Node.prototype, "nodeType"); mkFwd(w.Node.prototype, "ownerDocument");
      const DocProto = Object.getPrototypeOf(w.document);
      const impl = { createHTMLDocument: () => parseHTML(BLANK).document, createDocument: () => parseHTML("<template></template>").document };
      if (!("implementation" in w.document)) Object.defineProperty(DocProto, "implementation", { configurable: true, get() { return impl; } });
      // ---- end of compat patch ---------------------------------------------------------------------------------------------------------------

      const win = { document: w.document, Node: w.Node, Element: w.Element, DocumentFragment: w.DocumentFragment, HTMLTemplateElement: w.HTMLTemplateElement, HTMLFormElement: w.HTMLFormElement, DOMParser: class { parseFromString(h) { return parseHTML("<!DOCTYPE html><html><head></head><body>" + h + "</body></html>").document; } }, NodeFilter };
      const P = createDOMPurify(win);
      if (!P.isSupported) throw new Error("linkedom: DOMPurify unsupported");
      return { sanitize: (h) => P.sanitize(h) };
    }
    case "sanitize-html": {
      const { default: sanitizeHtml } = await import("sanitize-html");
      const tags = listFrom("html$1"), attrs = listFrom("html");
      const opts = {
        allowedTags: tags, allowedAttributes: { "*": attrs },
        allowedSchemes: ["http", "https", "ftp", "mailto", "tel", "callto", "sms", "cid", "xmpp"], allowProtocolRelative: true,
        allowedSchemesAppliedToAttributes: ["href", "src", "cite", "action", "poster", "background"],
        disallowedTagsMode: "discard", allowVulnerableTags: true, nonTextTags: ["style", "script", "textarea", "option", "noscript"],
      };
      return { sanitize: (h) => sanitizeHtml(h, opts) };
    }
    case "rehype-sanitize": {
      const [{ unified }, { default: rehypeParse }, { default: rehypeSanitize }, { default: rehypeStringify }] = await Promise.all([import("unified"), import("rehype-parse"), import("rehype-sanitize"), import("rehype-stringify")]);
      const p = unified().use(rehypeParse, { fragment: true }).use(rehypeSanitize).use(rehypeStringify).freeze();
      return { sanitize: (h) => String(p.processSync(h)) };
    }
    case "purify-edge": {
      const { default: D } = await import("../src/index.js");
      return { sanitize: (h) => D.sanitize(h) };
    }
  }
  throw new Error("unknown contender " + name);
}
