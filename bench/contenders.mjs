// The five contenders, each as { sanitize(html) -> string } with default DOMPurify config (or the closest equivalent).
//   isomorphic-dompurify   DOMPurify on jsdom. The reference everything is compared against.
//   sanitize-html          configured with DOMPurify's own default tag and attribute lists.
//   rehype-sanitize        default schema.
//   purify-edge            DOMPurify on the parse5-backed shim in ../src.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export const NAMES = ["isomorphic-dompurify", "sanitize-html", "rehype-sanitize", "purify-edge"];
export const LABELS = {
  "isomorphic-dompurify": "DOMPurify on jsdom (isomorphic-dompurify)",
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
