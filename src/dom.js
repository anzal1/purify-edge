// A minimal DOM on top of parse5, implementing only what DOMPurify 3.4.x calls.
// parse5 does the HTML parsing and serialization. This file is the tree.
// Everything here is part of the attack surface that sits underneath DOMPurify, so it is kept small and commented. The behaviour is checked
// against DOMPurify-on-jsdom (see test/, scripts/official-suite.sh and scripts/fuzz.mjs), not against a spec reading of this file alone.
import { parse, parseFragment, serialize, serializeOuter } from "parse5";
import { DOC_NAMES, FORM_NAMES } from "./names.js";
import { parseXML, serializeXML, XMLSyntaxError } from "./xml.js";

export const HTML = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";
const XMLNS = "http://www.w3.org/2000/xmlns/";

const NameStart = ":A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}";
const NAME_RE = new RegExp(`^[${NameStart}][${NameStart}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`, "u");
// DOM case mapping is ASCII-only. String#toUpperCase would turn dotless i (U+0131) into I and long s (U+017F) into S, so "scrıpt" would become SCRIPT.
const lc = (s) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase()), uc = (s) => s.replace(/[a-z]+/g, (m) => m.toUpperCase());
function domError(name, msg) { const e = new Error(msg); e.name = name; return e; }
function checkName(n) { if (!NAME_RE.test(n)) throw domError("InvalidCharacterError", "invalid name: " + n); }

export const NodeFilter = {
  FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3,
  SHOW_ALL: 0xffffffff, SHOW_ELEMENT: 1, SHOW_ATTRIBUTE: 2, SHOW_TEXT: 4, SHOW_CDATA_SECTION: 8,
  SHOW_ENTITY_REFERENCE: 16, SHOW_ENTITY: 32, SHOW_PROCESSING_INSTRUCTION: 64, SHOW_COMMENT: 128,
  SHOW_DOCUMENT: 256, SHOW_DOCUMENT_TYPE: 512, SHOW_DOCUMENT_FRAGMENT: 1024, SHOW_NOTATION: 2048,
};

export class Node {
  constructor(doc) { this._doc = doc; this._parent = null; this._prev = null; this._next = null; this._first = null; this._last = null; this._kids = null; }
  get nodeType() { return this._t; }
  get nodeName() { return this._n; }
  get ownerDocument() { return this._doc; }
  get parentNode() { return this._parent; }
  get parentElement() { const p = this._parent; return p && p.nodeType === 1 ? p : null; }
  get firstChild() { return this._first; }
  get lastChild() { return this._last; }
  get nextSibling() { return this._next; }
  get previousSibling() { return this._prev; }
  get nodeValue() { return null; }
  get childNodes() {
    if (!this._kids) { const a = []; for (let c = this._first; c; c = c._next) a.push(c); this._kids = a; }
    return this._kids;
  }
  get firstElementChild() { for (let c = this._first; c; c = c._next) if (c.nodeType === 1) return c; return null; }
  hasChildNodes() { return this._first !== null; }
  contains(o) { for (; o; o = o._parent) if (o === this) return true; return false; }
  get isConnected() { let n = this; while (n._parent) n = n._parent; return n.nodeType === 9; }

  _link(c, ref) {
    c._parent = this;
    if (ref === null) { c._prev = this._last; c._next = null; if (this._last) this._last._next = c; else this._first = c; this._last = c; }
    else { c._next = ref; c._prev = ref._prev; if (ref._prev) ref._prev._next = c; else this._first = c; ref._prev = c; }
    this._kids = null;
  }
  _unlink(c) {
    const d = c._doc, wasConnected = ceDefs.size && c.isConnected;
    if (d && d._iters.length) for (const it of d._iters.slice()) it._preRemove(c);
    if (c._prev) c._prev._next = c._next; else this._first = c._next;
    if (c._next) c._next._prev = c._prev; else this._last = c._prev;
    c._parent = null; c._prev = null; c._next = null; this._kids = null;
    if (wasConnected) ceReact(c, "disconnectedCallback"); // custom-element reaction, runs before remove() returns
  }
  _setDoc(doc) {
    // adopt a subtree (iterative)
    const stack = [this];
    while (stack.length) {
      const n = stack.pop(); n._doc = doc;
      if (n._content) { n._content._doc = doc._inertDoc(); stack.push(n._content); }
      for (let c = n._first; c; c = c._next) stack.push(c);
    }
  }
  insertBefore(node, ref) {
    if (ref === undefined) ref = null;
    if (ref !== null && ref._parent !== this) throw domError("NotFoundError", "ref is not a child");
    if (node.nodeType === 11) {
      const kids = node.childNodes.slice();
      for (const k of kids) this.insertBefore(k, ref);
      return node;
    }
    if (node.contains(this)) throw domError("HierarchyRequestError", "cycle");
    if (ref === node) ref = node._next;
    if (node._parent) node._parent._unlink(node);
    const owner = this.nodeType === 9 ? this : this._doc;
    if (node._doc !== owner) node._setDoc(owner);
    this._link(node, ref);
    if (ceDefs.size && this.isConnected) ceReact(node, "connectedCallback", true);
    return node;
  }
  appendChild(node) { return this.insertBefore(node, null); }
  removeChild(c) {
    if (c._parent !== this) throw domError("NotFoundError", "not a child");
    this._unlink(c); return c;
  }
  get textContent() {
    const out = []; const stack = [this];
    while (stack.length) {
      const n = stack.pop();
      if (n.nodeType === 3 || n.nodeType === 4) out.push(n.data);
      else if (n.nodeType === 1 || n.nodeType === 11) for (let c = n._last; c; c = c._prev) stack.push(c);
    }
    return out.join("");
  }
  set textContent(v) {
    v = v == null ? "" : String(v);
    while (this._first) this._unlink(this._first);
    if (v) this.appendChild(this._doc.createTextNode(v));
  }
  normalize() {
    const stack = [this];
    while (stack.length) {
      const n = stack.pop();
      for (let c = n._first; c;) {
        const next = c._next;
        if (c.nodeType === 3) {
          if (c.data === "") n._unlink(c);
          else { let p = c._prev; if (p && p.nodeType === 3) { p.data += c.data; n._unlink(c); } }
        } else if (c.nodeType === 1) stack.push(c);
        c = next;
      }
    }
  }
  cloneNode(deep) { return this._cloneInto(this._doc, !!deep); }
  _cloneInto(doc, deep) {
    const n = this._shallow(doc);
    if (deep) {
      for (let c = this._first; c; c = c._next) n._link(c._cloneInto(doc, true), null);
      if (this._content) for (let c = this._content._first; c; c = c._next) n.content._link(c._cloneInto(n.content._doc, true), null);
    }
    return n;
  }
}

export class CharacterData extends Node {
  constructor(doc, data) { super(doc); this.data = data; }
  remove() { if (this._parent) this._parent._unlink(this); }
  get nodeValue() { return this.data; }
  set nodeValue(v) { this.data = String(v); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = v == null ? "" : String(v); }
  get length() { return this.data.length; }
}
export class Text extends CharacterData {
  _shallow(doc) { return new Text(doc, this.data); }
}
export class Comment extends CharacterData {
  _shallow(doc) { return new Comment(doc, this.data); }
}
export class CDATASection extends Text {
  _shallow(doc) { return new CDATASection(doc, this.data); }
}
export class ProcessingInstruction extends CharacterData {
  constructor(doc, target, data) { super(doc, data); this.target = target; this._n = target; }
  _shallow(doc) { return new ProcessingInstruction(doc, this.target, this.data); }
}
export class DocumentType extends Node {
  constructor(doc, name, publicId, systemId) { super(doc); this.name = name; this.publicId = publicId; this.systemId = systemId; this._n = name; }
  _shallow(doc) { return new DocumentType(doc, this.name, this.publicId, this.systemId); }
}

// Selector subset: comma lists of [tag|*]{#id|[attr]}* compounds. That is all DOMPurify and its suite use; anything else throws.
function compileSel(sel) {
  const alts = String(sel).split(",").map((x) => x.trim()).map((x) => {
    const m = /^(\*|[a-zA-Z][\w-]*)?((?:#[\w-]+|\[[\w:-]+\])*)$/.exec(x);
    if (!x || !m) throw domError("SyntaxError", "shim selector subset only: " + sel);
    const tag = m[1] && m[1] !== "*" ? m[1] : null, parts = m[2].match(/#[\w-]+|\[[\w:-]+\]/g) || [];
    return (e) => (!tag || e.localName === tag || (e.namespaceURI === HTML && e._doc._html && e.localName === lc(tag))) &&
      parts.every((q) => (q[0] === "#" ? e.getAttribute("id") === q.slice(1) : e.hasAttribute(q.slice(1, -1))));
  });
  return (e) => alts.some((f) => f(e));
}
function walkQuery(root, sel, first) {
  const match = compileSel(sel), out = [], stack = [];
  for (let c = root._last; c; c = c._prev) stack.push(c);
  while (stack.length) {
    const n = stack.pop();
    if (n.nodeType !== 1) continue;
    if (match(n)) { out.push(n); if (first) return out; }
    for (let c = n._last; c; c = c._prev) stack.push(c);
  }
  return out;
}

export class DocumentFragment extends Node {
  _shallow(doc) { return new DocumentFragment(doc); }
  querySelectorAll(sel) { return walkQuery(this, sel); }
  querySelector(sel) { return walkQuery(this, sel, true)[0] || null; }
  append(...ns) { appendAll(this, ns); }
}
// innerHTML for Element and ShadowRoot: HTML docs go through parse5, XML docs through xml.js.
const innerHTMLGet = function () {
  if (this._doc._html) return serialize(this, SER_OPTS);
  try { return this.childNodes.map((c) => serializeXML(c)).join(""); } catch (e) { throw domError("InvalidStateError", e.message); }
};
function lookupNs(el, prefix) { // in-scope namespace of an element (DOM lookupNamespaceURI)
  for (; el && el.nodeType === 1; el = el._parent) {
    if ((el.prefix || "") === (prefix || "") && el.namespaceURI) return el.namespaceURI;
    for (const a of el._attrs) if (a.namespaceURI === XMLNS && (prefix ? a.prefix === "xmlns" && a.localName === prefix : a.prefix === null && a.localName === "xmlns")) return a.value || null;
  }
  return null;
}
const innerHTMLSet = function (html) {
  const host = this.nodeType === 11 ? this.host : this, target = this._content || this;
  curDoc = target._doc; keepDoc = true;
  let frag;
  try {
    if (target._doc._html) frag = parseFragment(host, String(html), { treeAdapter: adapter, scriptingEnabled: false });
    else {
      frag = new DocumentFragment(target._doc);
      const scope = { "": lookupNs(host, "") || undefined };
      for (let e = host; e && e.nodeType === 1; e = e._parent) for (const a of e._attrs) if (a.namespaceURI === XMLNS && a.prefix === "xmlns" && !(a.localName in scope)) scope[a.localName] = a.value;
      if (scope[""] === undefined) delete scope[""];
      try { parseXML(String(html), xmlBuild(target._doc), frag, { fragment: true, scope }); } catch (e) { if (e instanceof XMLSyntaxError) throw domError("SyntaxError", e.message); throw e; }
    }
  } finally { keepDoc = false; }
  while (target._first) target._unlink(target._first);
  while (frag._first) target.appendChild(frag._first);
};
function appendAll(parent, nodes) { for (const n of nodes) parent.appendChild(typeof n === "string" ? parent._doc.createTextNode(n) : n); }
export class ShadowRoot extends DocumentFragment {
  constructor(doc, host, mode) { super(doc); this.host = host; this.mode = mode; }
  get innerHTML() { return innerHTMLGet.call(this); }
  set innerHTML(v) { innerHTMLSet.call(this, v); }
}

export class Attr {
  constructor(localName, prefix, ns, value) { this.localName = localName; this.prefix = prefix || null; this.namespaceURI = ns || null; this.value = value; this.ownerElement = null; }
  get name() { return this.prefix ? this.prefix + ":" + this.localName : this.localName; }
  get nodeName() { return this.name; }
}

export class Element extends Node {
  constructor(doc, ns, localName) {
    super(doc); this.namespaceURI = ns; this.localName = localName; this.prefix = null; this._attrs = [];
    this._nsAttr = false;
    this._n = ns === HTML && doc._html ? uc(localName) : localName;
  }
  get tagName() { return this._n; }
  get attributes() { return this._attrs; }
  get shadowRoot() { return this._shadow && this._shadow.mode === "open" ? this._shadow : null; }
  // Only elements the spec allows as shadow hosts (autonomous custom elements and a fixed HTML list).
  attachShadow({ mode }) {
    const ok = this.namespaceURI === HTML && (SHADOW_HOSTS.has(this.localName) || /^[a-z][^A-Z\s]*-[^A-Z\s]*$/.test(this.localName) && !RESERVED.has(this.localName));
    if (!ok || this._shadow) throw domError("NotSupportedError", "cannot attach a shadow root here");
    return (this._shadow = new ShadowRoot(this._doc, this, mode));
  }
  get id() { return this.getAttribute("id") ?? ""; }
  set id(v) { this.setAttribute("id", v); }
  get className() { return this.getAttribute("class") ?? ""; }
  set className(v) { this.setAttribute("class", v); }
  get classList() {
    const el = this, get = () => (el.getAttribute("class") || "").split(/\s+/).filter(Boolean), set = (a) => el.setAttribute("class", a.join(" "));
    return { add: (...t) => set([...new Set([...get(), ...t])]), remove: (...t) => set(get().filter((x) => !t.includes(x))), contains: (t) => get().includes(t),
      toggle(t) { const h = get().includes(t); h ? this.remove(t) : this.add(t); return !h; }, get length() { return get().length; }, toString: () => get().join(" ") };
  }
  // ChildNode.remove is on Element, not Node: DOMPurify caches Element.prototype.remove and relies on it throwing for a Comment/PI.
  remove() { if (this.nodeType !== 1) throw new TypeError("Illegal invocation"); if (this._parent) this._parent._unlink(this); }
  getAttributeNames() { return this._attrs.map((a) => a.name); }
  append(...ns) { appendAll(this, ns); }
  querySelector(sel) { return walkQuery(this, sel, true)[0] || null; }
  _norm(n) { return this.namespaceURI === HTML && this._doc._html ? lc(n) : n; }
  _find(qn) { const a = this._attrs; for (let i = 0; i < a.length; i++) if (a[i].name === qn) return a[i]; return null; }
  _add(attr) { attr.ownerElement = this; if (attr.namespaceURI) this._nsAttr = true; this._attrs.push(attr); }
  getAttribute(n) { const a = this._find(this._norm(String(n))); return a ? a.value : null; }
  getAttributeNode(n) { return this._find(this._norm(String(n))); }
  hasAttribute(n) { return this._find(this._norm(String(n))) !== null; }
  hasAttributes() { return this._attrs.length > 0; }
  setAttribute(n, v) {
    n = String(n); checkName(n); n = this._norm(n);
    const a = this._find(n);
    if (a) a.value = String(v); else this._add(new Attr(n, null, null, String(v)));
  }
  setAttributeNS(ns, qn, v) {
    qn = String(qn); checkName(qn); ns = ns || null;
    const i = qn.indexOf(":"), prefix = i < 0 ? null : qn.slice(0, i), local = i < 0 ? qn : qn.slice(i + 1);
    for (const a of this._attrs) if (a.namespaceURI === ns && a.localName === local) { a.value = String(v); return; }
    this._add(new Attr(local, prefix, ns, String(v)));
  }
  removeAttribute(n) { const a = this._find(this._norm(String(n))); if (a) this.removeAttributeNode(a); }
  removeAttributeNode(a) {
    const i = this._attrs.indexOf(a);
    if (i < 0) throw domError("NotFoundError", "attr not on element");
    this._attrs.splice(i, 1); a.ownerElement = null; return a;
  }
  querySelectorAll(sel) { return walkQuery(this, sel); }
  get innerHTML() { return innerHTMLGet.call(this); }
  set innerHTML(html) { innerHTMLSet.call(this, html); }
  get outerHTML() {
    if (this._doc._html) return serializeOuter(this, SER_OPTS);
    try { return serializeXML(this); } catch (e) { throw domError("InvalidStateError", e.message); }
  }
  _shallow(doc) {
    const e = makeElement(doc, this.namespaceURI, this.localName);
    for (const a of this._attrs) e._add(new Attr(a.localName, a.prefix, a.namespaceURI, a.value));
    e._isValue = this._isValue; // clone keeps the "is value" (DOM Standard, clone a node)
    return e;
  }
}
export class HTMLElement extends Element {}
export class HTMLTemplateElement extends HTMLElement {
  get content() { return this._content || (this._content = new DocumentFragment(this._doc._inertDoc())); }
}
export class HTMLFormElement extends HTMLElement {}
export class HTMLAnchorElement extends HTMLElement {}
export class HTMLAreaElement extends HTMLElement {}
export class HTMLBaseElement extends HTMLElement {}
export class HTMLLinkElement extends HTMLElement {}
// A few string-attribute IDL reflections (raw value, no URL resolution) so `"target" in node` and `node.href` hooks see what a browser shows.
// This is deliberately not all of HTML's IDL; hooks reading other IDL properties get undefined.
function reflect(C, ...names) {
  for (const n of names) Object.defineProperty(C.prototype, n, { get() { return this.getAttribute(n) ?? ""; }, set(v) { this.setAttribute(n, v); }, configurable: true });
}
reflect(HTMLAnchorElement, "href", "target", "rel", "download", "hreflang", "type");
reflect(HTMLAreaElement, "href", "target", "rel", "download", "alt");
reflect(HTMLBaseElement, "href", "target");
reflect(HTMLLinkElement, "href", "rel", "type", "media", "hreflang");
reflect(HTMLFormElement, "target", "action", "method", "name");
export class HTMLIFrameElement extends HTMLElement { // a second, separate realm once connected (see setRealmFactory)
  get contentDocument() { return this.isConnected ? this._frameDoc || (this._frameDoc = realmFactory()) : null; }
}
let realmFactory = () => new Document(true);
export function setRealmFactory(f) { realmFactory = f; }
const SHADOW_HOSTS = new Set(["article", "aside", "blockquote", "body", "div", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "main", "nav", "p", "section", "span"]);
const RESERVED = new Set(["annotation-xml", "color-profile", "font-face", "font-face-src", "font-face-uri", "font-face-format", "font-face-name", "missing-glyph"]);

// Custom elements: define()d names are upgraded (prototype swap, constructor not run) when connected; connected/disconnectedCallback fire.
const ceDefs = new Map();
function ceReact(root, cb, upgrade) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.nodeType !== 1) { for (let c = n._last; c; c = c._prev) stack.push(c); continue; }
    const C = n.namespaceURI === HTML && ceDefs.get(n.localName);
    if (C) {
      if (upgrade && !n._upgraded) { Object.setPrototypeOf(n, C.prototype); n._upgraded = true; }
      if (n._upgraded && typeof n[cb] === "function") n[cb]();
    }
    for (let c = n._last; c; c = c._prev) stack.push(c);
  }
}
export const customElements = {
  define(name, ctor) { ceDefs.set(name, ctor); },
  get(name) { return ceDefs.get(name); },
};

function makeElement(doc, ns, local) {
  if (ns === HTML) {
    switch (local) {
      case "template": return new HTMLTemplateElement(doc, ns, local);
      case "form": return new HTMLFormElement(doc, ns, local);
      case "a": return new HTMLAnchorElement(doc, ns, local);
      case "area": return new HTMLAreaElement(doc, ns, local);
      case "base": return new HTMLBaseElement(doc, ns, local);
      case "link": return new HTMLLinkElement(doc, ns, local);
      case "iframe": return new HTMLIFrameElement(doc, ns, local);
    }
    return new HTMLElement(doc, ns, local);
  }
  return new Element(doc, ns, local);
}

class NodeIterator {
  constructor(root, what, filter) { this.root = root; this.whatToShow = what >>> 0; this.filter = filter; this._ref = root; this._before = true; root._doc._iters.push(this); this._d = root._doc; }
  _next(n) {
    if (n._first) return n._first;
    for (; n && n !== this.root; n = n._parent) if (n._next) return n._next;
    return null;
  }
  nextNode() {
    let n = this._ref, before = this._before;
    for (;;) {
      if (!before) { n = this._next(n); if (!n) { this._done(); return null; } } else before = false;
      if (this.whatToShow & (1 << (n.nodeType - 1))) {
        let ok = true;
        if (this.filter) { const f = this.filter; ok = (typeof f === "function" ? f(n) : f.acceptNode(n)) === 1; }
        if (ok) { this._ref = n; this._before = false; return n; }
      }
    }
  }
  _done() { const i = this._d._iters.indexOf(this); if (i >= 0) this._d._iters.splice(i, 1); }
  detach() { this._done(); }
  _preRemove(rm) {
    if (rm === this.root || !rm.contains(this._ref)) return;
    if (this._before) {
      let n = rm; while (n && n !== this.root && !n._next) n = n._parent;
      if (n && n !== this.root) { this._ref = n._next; return; }
      this._before = false;
    }
    if (rm._prev) { let n = rm._prev; while (n._last) n = n._last; this._ref = n; } else this._ref = rm._parent;
  }
}

export class Document extends Node {
  constructor(html = true, inert = false) { super(null); this._html = html; this._iters = []; this._inert = inert ? this : null; this.documentURI = "about:blank"; }
  get ownerDocument() { return null; }
  get currentScript() { return null; }
  get implementation() {
    const doc = this;
    return this._impl || (this._impl = {
      createHTMLDocument(title) {
        const d = new Document(true), h = d.createElement("html"); d.appendChild(h);
        const head = d.createElement("head"); h.appendChild(head);
        if (title !== undefined) { const t = d.createElement("title"); t.appendChild(d.createTextNode(String(title))); head.appendChild(t); }
        h.appendChild(d.createElement("body")); return d;
      },
      createDocument(ns, qn) {
        const d = new Document(false); d._xhtml = ns === HTML; // content type application/xhtml+xml: createElement yields HTML-namespace elements
        if (qn) d.appendChild(d.createElementNS(ns, qn));
        return d;
      },
    });
  }
  _inertDoc() { return this._inert || (this._inert = new Document(this._html, true)); }
  get documentElement() { for (let c = this._first; c; c = c._next) if (c.nodeType === 1) return c; return null; }
  get doctype() { for (let c = this._first; c; c = c._next) if (c.nodeType === 10) return c; return null; }
  get head() { return this._htmlChild("head"); }
  get body() { return this._htmlChild("body") || this._htmlChild("frameset"); }
  _htmlChild(n) {
    const de = this.documentElement;
    if (!de || de.localName !== "html" || de.namespaceURI !== HTML) return null;
    for (let c = de._first; c; c = c._next) if (c.nodeType === 1 && c.localName === n && c.namespaceURI === HTML) return c;
    return null;
  }
  createElement(n) {
    n = String(n); checkName(n);
    return this._html ? makeElement(this, HTML, lc(n)) : makeElement(this, this._xhtml ? HTML : null, n);
  }
  createElementNS(ns, qn) {
    qn = String(qn); checkName(qn); const i = qn.indexOf(":");
    const e = makeElement(this, ns || null, i < 0 ? qn : qn.slice(i + 1));
    if (i >= 0) { e.prefix = qn.slice(0, i); e._n = qn; }
    return e;
  }
  createTextNode(d) { return new Text(this, String(d)); }
  createCDATASection(d) { if (this._html) throw domError("NotSupportedError", "HTML documents have no CDATA sections"); return new CDATASection(this, String(d)); }
  createProcessingInstruction(t, d) { return new ProcessingInstruction(this, String(t), String(d)); }
  createComment(d) { return new Comment(this, String(d)); }
  createDocumentFragment() { return new DocumentFragment(this); }
  createNodeIterator(root, what = 0xffffffff, filter = null) { return new NodeIterator(root, what, filter); }
  importNode(node, deep) {
    if (node.nodeType === 9) throw domError("NotSupportedError", "cannot import a document");
    return node._cloneInto(this, !!deep);
  }
  getElementsByTagName(name) {
    name = String(name);
    if (this._html && (name === "html" || name === "body" || name === "head")) {
      const de = this.documentElement;
      if (name === "html") return de && de.localName === "html" ? [de] : walkTag(this, name);
      const e = this._htmlChild(name);
      if (e) return [e];
    }
    return walkTag(this, name);
  }
  querySelectorAll(sel) { return walkQuery(this, sel); }
  querySelector(sel) { return walkQuery(this, sel, true)[0] || null; }
  getElementById(id) { return walkQuery(this, "*").find((e) => e.getAttribute("id") === id) || null; }
  get textContent() { return null; }
  set textContent(_) {}
}
function walkTag(root, name) {
  const out = [], stack = []; const lcName = lc(name);
  for (let c = root._last; c; c = c._prev) stack.push(c);
  while (stack.length) {
    const n = stack.pop();
    if (n.nodeType !== 1) continue;
    if (name === "*" || n.localName === name || (n.namespaceURI === HTML && (root._html ?? root._doc._html) && n.localName === lcName)) out.push(n);
    for (let c = n._last; c; c = c._prev) stack.push(c);
  }
  return out;
}

Text.prototype._t = 3; Text.prototype._n = "#text";
Comment.prototype._t = 8; Comment.prototype._n = "#comment";
CDATASection.prototype._t = 4; CDATASection.prototype._n = "#cdata-section"; ProcessingInstruction.prototype._t = 7;
DocumentType.prototype._t = 10;
DocumentFragment.prototype._t = 11; DocumentFragment.prototype._n = "#document-fragment";
Element.prototype._t = 1;
Document.prototype._t = 9; Document.prototype._n = "#document";

// Make `in` checks (DOMPurify SANITIZE_DOM: value in document / value in formElement) behave like a browser.
function addPlaceholders(proto, names) {
  for (const n of names) if (!(n in proto)) Object.defineProperty(proto, n, { value: undefined, writable: true, configurable: true });
}
addPlaceholders(Document.prototype, DOC_NAMES);
addPlaceholders(HTMLFormElement.prototype, FORM_NAMES);

// ---- parse5 tree adapter ----
let curDoc = null, keepDoc = false;
const adapter = {
  createDocument() { const d = new Document(true); if (!keepDoc) curDoc = d; return d; },
  createDocumentFragment() { return new DocumentFragment(curDoc); },
  createElement(tag, ns, attrs) {
    const e = makeElement(curDoc, ns, tag);
    for (let i = 0; i < attrs.length; i++) { const a = attrs[i]; e._add(new Attr(a.name, a.prefix, a.namespace, a.value)); if (a.name === "is" && !a.namespace && a.value) e._isValue = a.value; }  // truthy test like jsdom: an empty is="" (inert; Chrome would serialize it) is not remembered, so the shim stays fail-closed
    return e;
  },
  createCommentNode(d) { return new Comment(curDoc, d); },
  createTextNode(d) { return new Text(curDoc, d); },
  appendChild(p, c) { p.insertBefore(c, null); },
  insertBefore(p, c, ref) { p.insertBefore(c, ref); },
  setTemplateContent(t, frag) { frag._doc = t._doc._inertDoc(); t._content = frag; },
  getTemplateContent(t) { return t.content; },
  setDocumentType(doc, name, publicId, systemId) {
    for (let c = doc._first; c; c = c._next) if (c.nodeType === 10) { c.name = c._n = name; c.publicId = publicId; c.systemId = systemId; return; }
    doc.insertBefore(new DocumentType(doc, name, publicId, systemId), doc._first);
  },
  setDocumentMode(doc, m) { doc._mode = m; },
  getDocumentMode(doc) { return doc._mode; },
  detachNode(n) { if (n._parent) n._parent._unlink(n); },
  insertText(p, text) {
    const l = p._last;
    if (l && l.nodeType === 3) l.data += text; else p.insertBefore(new Text(p.nodeType === 9 ? p : p._doc, text), null);
  },
  insertTextBefore(p, text, ref) {
    const pr = ref._prev;
    if (pr && pr.nodeType === 3) pr.data += text; else p.insertBefore(new Text(p._doc, text), ref);
  },
  adoptAttributes(el, attrs) {
    for (const a of attrs) {
      const qn = a.prefix ? a.prefix + ":" + a.name : a.name;
      if (!el._find(qn)) el._add(new Attr(a.name, a.prefix, a.namespace, a.value));
    }
  },
  getFirstChild: (n) => n._first,
  getChildNodes: (n) => n.childNodes,
  getParentNode: (n) => n._parent,
  // HTML fragment serialization step: an element with an "is value" but no `is` attribute (removed after parsing) still serializes ` is="value"` before the other attributes (HTML Standard, "Serializing HTML fragments"; Chrome and jsdom do this). DOMPurify's RETURN_DOM on a `<body is=x>` root shows it.
  getAttrList: (el) => el._isValue != null && !el._find("is") ? [{ name: "is", value: el._isValue }, ...(el._nsAttr ? el._attrs.map((a) => ({ name: a.localName, namespace: a.namespaceURI || undefined, prefix: a.prefix || undefined, value: a.value })) : el._attrs)] : (el._nsAttr ? el._attrs.map((a) => ({ name: a.localName, namespace: a.namespaceURI || undefined, prefix: a.prefix || undefined, value: a.value })) : el._attrs),
  getTagName: (el) => el.localName,
  getNamespaceURI: (el) => el.namespaceURI,
  getTextNodeContent: (n) => n.data,
  getCommentNodeContent: (n) => n.data,
  getDocumentTypeNodeName: (n) => n.name,
  getDocumentTypeNodePublicId: (n) => n.publicId,
  getDocumentTypeNodeSystemId: (n) => n.systemId,
  isTextNode: (n) => n.nodeType === 3,
  isCommentNode: (n) => n.nodeType === 8,
  isDocumentTypeNode: (n) => n.nodeType === 10,
  isElementNode: (n) => n.nodeType === 1,
  setNodeSourceCodeLocation() {}, getNodeSourceCodeLocation() { return null; }, updateNodeSourceCodeLocation() {},
};
const SER_OPTS = { treeAdapter: adapter };

// Tree-building adapter for the XML parser. Parse errors yield a <parsererror> document, as DOMParser does in browsers.
function xmlBuild(doc) {
  return {
    element: (ns, prefix, local) => { const e = makeElement(doc, ns, local); if (prefix) { e.prefix = prefix; e._n = prefix + ":" + local; } return e; },
    attr: (el, ns, prefix, local, v) => el._add(new Attr(local, prefix, ns, v)),
    text: (d) => new Text(doc, d), cdata: (d) => new CDATASection(doc, d), comment: (d) => new Comment(doc, d), pi: (t, d) => new ProcessingInstruction(doc, t, d),
    doctype: (body) => {
      const m = /^\s*([^\s>\[]+)(?:\s+PUBLIC\s+"([^"]*)"\s+"([^"]*)"|\s+SYSTEM\s+"([^"]*)")?/i.exec(body);
      return new DocumentType(doc, m ? m[1] : "html", (m && m[2]) || "", (m && (m[3] || m[4])) || "");
    },
    append: (p, c) => (p instanceof HTMLTemplateElement ? p.content : p).appendChild(c), // like jsdom's XML parser: template children go to .content
  };
}
const XML_TYPES = { "application/xhtml+xml": HTML, "application/xml": null, "text/xml": null, "image/svg+xml": SVG };
export class DOMParser {
  parseFromString(str, type) {
    if (type === "text/html") return parse(String(str), { treeAdapter: adapter, scriptingEnabled: false });
    if (!(type in XML_TYPES)) throw domError("TypeError", "unsupported parser type " + type);
    const doc = new Document(false); doc._xhtml = type === "application/xhtml+xml";
    try { parseXML(String(str), xmlBuild(doc), doc); } catch (e) {
      if (!(e instanceof XMLSyntaxError)) throw e;
      while (doc._first) doc._unlink(doc._first);
      const pe = doc.createElementNS("http://www.mozilla.org/newlayout/xml/parsererror.xml", "parsererror");
      pe.appendChild(doc.createTextNode(e.message)); doc.appendChild(pe);
    }
    return doc;
  }
}

export function createWindow() {
  const document = new Document(true);
  return { document, Node, Element, HTMLElement, DocumentFragment, HTMLTemplateElement, HTMLFormElement, NodeFilter, DOMParser, customElements };
}
