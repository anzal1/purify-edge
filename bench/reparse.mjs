// What would a browser make of this string? Re-parse sanitizer OUTPUT with parse5, a spec-compliant HTML parser, the way `div.innerHTML = output` would,
// and report every element that carries an on* attribute. Template contents are walked too.
import { parseFragment, html, defaultTreeAdapter } from "parse5";

export function reparse(output) {
  return parseFragment(defaultTreeAdapter.createElement("div", html.NS.HTML, []), output);
}

// Returns [{ tag, attr, value }] for each on* attribute on any element of the re-parsed output.
export function liveHandlers(output) {
  const found = [];
  const walk = (n) => {
    if (n.attrs) for (const a of n.attrs) if (/^on/i.test(a.name)) found.push({ tag: n.tagName, attr: a.name, value: a.value });
    if (n.content) walk(n.content); // <template> contents
    if (n.childNodes) for (const c of n.childNodes) walk(c);
  };
  walk(reparse(output));
  return found;
}

// Same walk, for URL attributes that execute script when followed or loaded: href, src, action, formaction, xlink:href, data, poster whose value starts with
// "javascript:" once the control characters and whitespace a browser strips are removed. Returns [{ tag, attr, value }].
export function liveScriptUrls(output) {
  const found = [];
  const walk = (n) => {
    if (n.attrs) for (const a of n.attrs) if (/^(href|src|action|formaction|xlink:href|data|poster)$/i.test(a.name) && /^javascript:/i.test(a.value.replace(/[\u0000-\u0020]/g, ""))) found.push({ tag: n.tagName, attr: a.name, value: a.value });
    if (n.content) walk(n.content);
    if (n.childNodes) for (const c of n.childNodes) walk(c);
  };
  walk(reparse(output));
  return found;
}

// The naive check: an on*= attribute in tag position, found with a regex on the raw string. No parsing, so it also fires on harmless text that merely looks like a tag.
export const RAW_ON_ATTR = /<[a-z][^>]*\son[a-z]+\s*=/i;
