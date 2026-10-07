// XML side of the shim. parse5 only parses HTML, but DOMPurify's PARSER_MEDIA_TYPE=application/xhtml+xml
// path (and its non-HTML NAMESPACE fallback) needs an XML parser and the XML fragment serializer.
// Whitespace is XML whitespace only (space, tab, LF, CR), never JS \s (it matches U+FEFF, which is a legal name character).
// Pure functions: dom.js passes a `build` adapter, so this file never touches the DOM classes.
export class XMLSyntaxError extends Error {}

const XML = "http://www.w3.org/XML/1998/namespace", XMLNS = "http://www.w3.org/2000/xmlns/";
const NS = ":A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}";
const NAME = new RegExp(`^[${NS}][${NS}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`, "u");
const XML_CHAR = /^(?:[\t\n\r -\uD7FF\uE000-\uFFFD]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/;
// saxes (jsdom's XML parser) accepts a lone high surrogate in text, comments and attribute values, then the serializer rejects it; mirror that split.
const PARSE_CHAR = /^(?:[\t\n\r\u0020-\uD7FF\uE000-\uFFFD]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF]))*$/;
// Null prototype, so names like "constructor" or "__proto__" never resolve to Object.prototype members.
const ENTS = Object.assign(Object.create(null), { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" });
const fail = (m) => { throw new XMLSyntaxError(m); };

// build: { element(ns, prefix, local), attr(el, ns, prefix, local, value), text, cdata, comment, pi, doctype, append(parent, child) }
// scope: prefix -> namespace for the context (fragment parsing); "" is the default namespace.
export function parseXML(src, build, root, { fragment = false, scope = {} } = {}) {
  const s = src.replace(/\r\n?/g, "\n"), n = s.length, ents = Object.assign(Object.create(null), ENTS);
  const stack = [{ node: root, qn: null, scope: Object.assign(Object.create(null), { xml: XML, xmlns: XMLNS }, scope) }];
  let i = 0, seenRoot = false, ended = false;
  const top = () => stack[stack.length - 1];
  const expand = (t) => {
    if (/&(?!(?:#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_:][\w.:-]*);)/.test(t)) fail("malformed entity reference");
    return t.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_:][\w.:-]*);/g, (_, e) => {
      if (e[0] === "#") {
        const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (cp > 0x10ffff || !XML_CHAR.test(String.fromCodePoint(cp))) fail("malformed character entity");
        return String.fromCodePoint(cp);
      }
      if (!Object.hasOwn(ents, e)) fail("unknown entity: &" + e + ";");
      return ents[e];
    });
  };
  while (i < n) {
    if (s[i] !== "<") {
      let j = s.indexOf("<", i); if (j < 0) j = n;
      const raw = s.slice(i, j);
      if (raw.includes("]]>")) fail("the string ]]> is not allowed in text");
      if (stack.length === 1 && !fragment) { if (/[^ \t\n\r]/.test(raw)) fail("text data outside of root node"); }
      else { const t = expand(raw); if (!PARSE_CHAR.test(t)) fail("disallowed character"); build.append(top().node, build.text(t)); }
      i = j; continue;
    }
    if (s.startsWith("<!--", i)) {
      const j = s.indexOf("-->", i + 4); if (j < 0) fail("unterminated comment");
      const d = s.slice(i + 4, j); if (d.includes("--") || d.endsWith("-") || !PARSE_CHAR.test(d)) fail("malformed comment");
      build.append(top().node, build.comment(d)); i = j + 3;
    } else if (s.startsWith("<![CDATA[", i)) {
      if (stack.length === 1 && !fragment) fail("cdata outside of root node");
      const j = s.indexOf("]]>", i); if (j < 0) fail("unterminated CDATA");
      build.append(top().node, build.cdata(s.slice(i + 9, j))); i = j + 3;
    } else if (s.startsWith("<?", i)) {
      const j = s.indexOf("?>", i); if (j < 0) fail("unterminated processing instruction");
      const m = /^([^ \t\n\r?]+)(?:[ \t\n\r]+([\s\S]*))?$/.exec(s.slice(i + 2, j));
      if (!m || !NAME.test(m[1]) || m[1].includes(":")) fail("malformed processing instruction");
      if (m[1].toLowerCase() === "xml") { if (i !== 0 || fragment) fail("xml declaration is only allowed at the start"); }
      else build.append(top().node, build.pi(m[1], m[2] || ""));
      i = j + 2;
    } else if (s.startsWith("<!DOCTYPE", i) || s.startsWith("<!doctype", i)) {
      if (fragment || stack.length > 1 || seenRoot) fail("doctype not allowed here");
      let j = i + 9, depth = 0;
      for (; j < n; j++) { const c = s[j]; if (c === "[") depth++; else if (c === "]") depth--; else if (c === ">" && depth <= 0) break; }
      if (j >= n) fail("unterminated doctype");
      const body = s.slice(i + 9, j);
      for (const m of body.matchAll(/<!ENTITY[ \t\n\r]+([^ \t\n\r%]+)[ \t\n\r]+"([^"]*)"/g)) if (!Object.hasOwn(ents, m[1])) ents[m[1]] = m[2];
      build.append(root, build.doctype(body)); i = j + 1;
    } else if (s.startsWith("</", i)) {
      const j = s.indexOf(">", i); if (j < 0) fail("unterminated end tag");
      const qn = s.slice(i + 2, j).replace(/[ \t\n\r]+$/, "");
      if (stack.length === 1 || top().qn !== qn) fail("unexpected close tag: " + qn);
      stack.pop(); i = j + 1; if (stack.length === 1 && !fragment) ended = true;
    } else {
      if (stack.length === 1 && !fragment && (seenRoot || ended)) fail("documents may contain only one root.");
      // start tag
      const m = /^<([^ \t\n\r/>=]+)/.exec(s.slice(i, i + 4096)) || fail("malformed start tag");
      const qn = m[1]; if (!NAME.test(qn) || qn.split(":").length > 2 || qn.startsWith(":") || qn.endsWith(":")) fail("invalid element name: " + qn);
      let j = i + m[0].length; const raw = [];
      for (;;) {
        const ws = /^[ \t\n\r]*/.exec(s.slice(j, j + 4096))[0].length;
        const c = s[j + ws];
        if (c === ">" || c === "/" || c === undefined) { j += ws; break; }
        if (!ws) fail("attributes must be separated by whitespace");
        const am = /^([^ \t\n\r=/>]+)[ \t\n\r]*=[ \t\n\r]*("([^"]*)"|'([^']*)')/.exec(s.slice(j + ws, j + ws + 1e6)) || fail("malformed attribute");
        const an = am[1], av = am[3] ?? am[4];
        if (!NAME.test(an) || an.split(":").length > 2) fail("invalid attribute name: " + an);
        if (av.includes("<")) fail("< not allowed in attribute values");
        if (raw.some((r) => r[0] === an)) fail("duplicate attribute: " + an);
        const v = expand(av.replace(/[\t\n]/g, " ")); if (!PARSE_CHAR.test(v)) fail("disallowed character");
        raw.push([an, v]); j += ws + am[0].length;
      }
      const selfClose = s[j] === "/"; if (selfClose) { j++; if (s[j] !== ">") fail("malformed empty-element tag"); }
      if (s[j] !== ">") fail("unterminated start tag"); j++;
      const sc = Object.assign(Object.create(null), top().scope);
      for (const [an, av] of raw) {
        if (an === "xmlns") sc[""] = av;
        else if (an.startsWith("xmlns:")) {
          const p = an.slice(6);
          if (p === "xmlns" || (p === "xml" && av !== XML) || (av === XML && p !== "xml") || av === XMLNS) fail("reserved namespace use");
          if (!av) fail("cannot undeclare a prefix"); sc[p] = av;
        }
      }
      const ci = qn.indexOf(":"), prefix = ci < 0 ? "" : qn.slice(0, ci), local = ci < 0 ? qn : qn.slice(ci + 1);
      if (prefix && !Object.hasOwn(sc, prefix)) fail("unbound namespace prefix: " + prefix);
      const el = build.element(sc[prefix] || null, prefix || null, local);
      const seen = new Set();
      for (const [an, av] of raw) {
        const k = an.indexOf(":"), ap = k < 0 ? "" : an.slice(0, k), al = k < 0 ? an : an.slice(k + 1);
        let ns = null;
        if (an === "xmlns" || ap === "xmlns") ns = XMLNS; else if (ap) { if (!Object.hasOwn(sc, ap)) fail("unbound namespace prefix: " + ap); ns = sc[ap]; }
        const key = ns + "|" + al; if (seen.has(key)) fail("duplicate attribute: " + an); seen.add(key);
        build.attr(el, ns, ap || null, al, av);
      }
      build.append(top().node, el);
      if (!selfClose) stack.push({ node: el, qn, scope: sc }); else if (stack.length === 1 && !fragment) ended = true;
      seenRoot = true; i = j;
    }
  }
  if (stack.length > 1) fail("unclosed tag: " + top().qn);
  if (!fragment && !seenRoot) fail("document must contain a root element.");
}

// ---- XML serialization (DOM Parsing, "XML serialization" with the require-well-formed flag, as innerHTML/outerHTML do) ----
const VOID = new Set(["area", "base", "basefont", "bgsound", "br", "col", "embed", "frame", "hr", "img", "input", "keygen", "link", "menuitem", "meta", "param", "source", "track", "wbr"]);
const HTMLNS = "http://www.w3.org/1999/xhtml";
const esc = (v, attr) => { let r = v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); if (attr) r = r.replace(/"/g, "&quot;").replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;"); return r; };
const bad = (m) => { throw new XMLSyntaxError("Failed to serialize XML: " + m); };

export function serializeXML(node) {
  const map = Object.assign(Object.create(null), { [XML]: ["xml"] }), refs = { idx: 1 };
  return ser(node, null, map, refs);
}
function ser(node, ns, map, refs) {
  switch (node.nodeType) {
    case 1: return serEl(node, ns, map, refs);
    case 9: case 11: { let m = ""; for (const c of node.childNodes) m += ser(c, ns, map, refs); return m; }
    case 3: if (!XML_CHAR.test(node.data)) bad("text node data is not well-formed."); return esc(node.data);
    case 4: return `<![CDATA[${node.data}]]>`;
    case 8:
      if (!XML_CHAR.test(node.data) || node.data.includes("--") || node.data.endsWith("-")) bad("comment node data is not well-formed.");
      return `<!--${node.data}-->`;
    case 7:
      if (node.target.includes(":") || node.target.toLowerCase() === "xml" || !XML_CHAR.test(node.data) || node.data.includes("?>")) bad("processing instruction is not well-formed.");
      return `<?${node.target} ${node.data}?>`;
    case 10: {
      let m = `<!DOCTYPE ${node.name}`;
      if (node.publicId) m += ` PUBLIC "${node.publicId}"`; else if (node.systemId) m += " SYSTEM";
      return (node.systemId ? m + ` "${node.systemId}"` : m) + ">";
    }
    default: return "";
  }
}
function prefixFor(map, ns, pref) { const l = map[ns]; return !l ? null : l.includes(pref) ? pref : l[l.length - 1]; }
function serEl(el, inherited, parentMap, refs) {
  if (el.localName.includes(":") || !NAME.test(el.localName)) bad("element node localName is not a valid XML name.");
  const map = Object.assign(Object.create(null), parentMap), local = Object.create(null); let defNs = null, ignoreDef = false, qn, out = "<";
  for (const a of el.attributes) if (a.namespaceURI === XMLNS) {
    if (a.prefix === null) { defNs = a.value; continue; }
    if (a.value === XML) continue;
    if (map[a.value]?.includes(a.localName)) continue;
    (map[a.value] ||= []).push(a.localName); local[a.localName] = a.value;
  }
  const ns = el.namespaceURI;
  if (inherited === ns) { if (defNs !== null) ignoreDef = true; qn = ns === XML ? "xml:" + el.localName : el.localName; out += qn; }
  else {
    let p = el.prefix; const cand = prefixFor(map, ns, p);
    if (p === "xmlns") bad("element nodes can't have a prefix of \"xmlns\".");
    if (cand !== null) { qn = cand + ":" + el.localName; if (defNs !== null && defNs !== XML) inherited = defNs === "" ? null : defNs; out += qn; }
    else if (p !== null) {
      if (p in local) { p = "ns" + refs.idx++; map[ns] = [p]; }
      (map[ns] ||= []).push(p); qn = p + ":" + el.localName; out += `${qn} xmlns:${p}="${esc(ns ?? "", true)}"`;
      if (defNs !== null) inherited = defNs === "" ? null : defNs;
    } else if (defNs === null || defNs !== ns) { ignoreDef = true; qn = el.localName; inherited = ns; out += `${qn} xmlns="${esc(ns ?? "", true)}"`; }
    else { qn = el.localName; inherited = ns; out += qn; }
  }
  const seen = new Set();
  for (const a of el.attributes) {
    const k = a.namespaceURI + "|" + a.localName; if (seen.has(k)) bad("duplicate attribute"); seen.add(k);
    let cp = null;
    if (a.namespaceURI !== null) {
      cp = prefixFor(map, a.namespaceURI, a.prefix);
      if (a.namespaceURI === XMLNS) {
        if (a.value === XML || (a.prefix === null && ignoreDef) || (a.prefix !== null && local[a.localName] !== a.value && map[a.value]?.includes(a.localName))) continue;
        if (a.value === XMLNS || a.value === "") bad("invalid namespace declaration");
        if (a.prefix === "xmlns") cp = "xmlns";
      } else if (cp === null) { cp = "ns" + refs.idx++; map[a.namespaceURI] = [cp]; out += ` xmlns:${cp}="${esc(a.namespaceURI, true)}"`; }
    }
    if (a.localName.includes(":") || !NAME.test(a.localName) || (a.localName === "xmlns" && a.namespaceURI === null)) bad("invalid attribute localName");
    out += ` ${cp !== null ? cp + ":" : ""}${a.localName}="${esc(a.value, true)}"`;
  }
  const kids = ns === HTMLNS && el.localName === "template" ? el.content.childNodes : el.childNodes;
  if (ns === HTMLNS && !kids.length && VOID.has(el.localName)) return out + " />";
  if (ns !== HTMLNS && !kids.length) return out + "/>";
  out += ">"; for (const c of kids) out += ser(c, inherited, map, refs);
  return out + `</${qn}>`;
}
