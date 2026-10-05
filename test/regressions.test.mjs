// One test per bug found while verifying the prototype, plus the documented differences from jsdom.
// Where the bug only shows in the DOM, the test asserts on the DOM. Where it shows in sanitize() output, it compares with DOMPurify on jsdom.
import test from "node:test";
import assert from "node:assert/strict";
import edge, { window as ew, createDOMPurify } from "../src/index.js";
import { reference, run } from "./helpers.mjs";

const ref = reference();
const jp = ref.purify, jw = ref.window;
const XHTML = { PARSER_MEDIA_TYPE: "application/xhtml+xml" };
const SVG_NS = { NAMESPACE: "http://www.w3.org/2000/svg", ALLOWED_NAMESPACES: ["http://www.w3.org/2000/svg", "http://www.w3.org/1999/xhtml"] };
const both = (input, cfg = {}) => ({ jsdom: run(jp, jw, input, cfg), edge: run(edge, ew, input, cfg) });
const subsequence = (a, b) => { let i = 0; for (const c of b) if (i < a.length && a[i] === c) i++; return i === a.length; };

test("Unicode case mapping: DOM names fold ASCII only (scrıpt is not script)", () => {
  // String#toUpperCase would map dotless i (U+0131) to I and long s (U+017F) to S, turning `scrıpt` into SCRIPT and changing what DOMPurify does with it.
  for (const name of ["scrıpt", "ſvg", "Key", "café"]) {
    assert.equal(ew.document.createElement(name).tagName, jw.document.createElement(name).tagName, name);
  }
  assert.equal(ew.document.createElement("scrıpt").tagName, "SCRıPT");
  assert.equal(ew.document.createElement("ScRiPt").tagName, "SCRIPT");
  // an unknown tag keeps its text; a (wrongly) recognised script would drop it
  const r = both("<scrıpt>alert(1)</scrıpt>");
  assert.equal(r.edge, "alert(1)");
  assert.equal(r.edge, r.jsdom);
  const attr = both('<div ONCLİCK="x" title=t>a</div>');
  assert.equal(attr.edge, attr.jsdom);
});

test("remove() lives on Element, not Node, and throws for a comment (DOMPurify relies on it)", () => {
  assert.equal(typeof ew.Element.prototype.remove, "function");
  assert.equal(typeof ew.Node.prototype.remove, typeof jw.Node.prototype.remove);
  const c = ew.document.createComment("x");
  assert.throws(() => ew.Element.prototype.remove.call(c), TypeError);
  const parent = ew.document.createElement("div"), child = ew.document.createElement("b");
  parent.appendChild(child); child.remove();
  assert.equal(parent.childNodes.length, 0);
  // IN_PLACE sanitize removes comments through that cached remove; placement of the call decides whether the comment survives.
  const inPlace = (p, w, html) => { const d = w.document.createElement("div"); d.innerHTML = html; p.sanitize(d, { IN_PLACE: true }); return d.innerHTML; };
  for (const html of ["<div id=1><!--[if]><script>alert(115)</script -->\n<!--[if<img src=x onerror=alert(2)//]> -->//[\"'`-->]]>]</", "<div id=114>a</div><!--c--><div id=115>b</div>", "a<!--x-->b<?pi x?>c"]) {
    assert.equal(inPlace(edge, ew, html), inPlace(jp, jw, html), html);
  }
});

test("the README hook `'target' in node` sees IDL reflection like a browser", () => {
  assert.equal("target" in ew.document.createElement("a"), true);
  assert.equal("target" in ew.document.createElement("form"), true);
  assert.equal("target" in ew.document.createElement("div"), false);
  const hook = (node) => { if ("target" in node) { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener"); } };
  const run1 = (p, w) => { p.addHook("afterSanitizeAttributes", hook); try { return p.sanitize('<a href="https://example.com/">x</a><div>y</div><area href=# ><form action="/p"></form>', { ADD_ATTR: ["target"] }); } finally { p.removeHooks("afterSanitizeAttributes"); } };
  const out = run1(createDOMPurify(), ew);
  assert.equal(out, run1(reference().purify, jw));
  assert.match(out, /<a href="https:\/\/example\.com\/" target="_blank" rel="noopener">x<\/a><div>y<\/div>/);
});

test("XML whitespace is space, tab, LF and CR only: U+FEFF is a name character, not whitespace", () => {
  // JS \s and String#trimEnd match U+FEFF. Using them made a stray U+FEFF in a tag look like whitespace and let malformed XML parse.
  const parse = (w, s) => new w.DOMParser().parseFromString(s, "application/xhtml+xml");
  const ns = ' xmlns="http://www.w3.org/1999/xhtml"';
  const malformed = [`<div${ns} ﻿>x</div>`, `<div${ns}>x</div﻿>`, `<div${ns}>x</div>﻿`, `<div${ns}﻿ a="1">x</div>`];
  for (const src of malformed) {
    const mine = parse(ew, src).documentElement.localName, theirs = parse(jw, src).documentElement.localName;
    assert.equal(mine, theirs, JSON.stringify(src));
  }
  assert.equal(parse(ew, malformed[0]).documentElement.localName, "parsererror");
  assert.equal(parse(ew, malformed[1]).documentElement.localName, "parsererror");
  // as part of a name it is legal, and both parsers agree on the element
  const ok = `<a﻿b${ns}>x</a﻿b>`;
  assert.equal(parse(ew, ok).documentElement.localName, "a﻿b");
  assert.equal(parse(ew, ok).documentElement.localName, parse(jw, ok).documentElement.localName);
  for (const src of malformed) { const r = both(src, XHTML); assert.equal(r.edge, r.jsdom, JSON.stringify(src)); }
});

test("RETURN_DOM keeps the parser's `is` value on a <body is=x> root, as the HTML serializer does", () => {
  // The attribute is removed by DOMPurify but the element still has an "is value", and fragment serialization emits ` is="..."` for it. Chrome and jsdom do this.
  for (const input of ['<body is="x"></body>', '<body is="a\nb" draggable="&#9;"></body>']) {
    const r = both(input, { RETURN_DOM: true });
    assert.equal(r.edge, r.jsdom, input);
    assert.match(r.edge, /^EL:<body is="/);
  }
  // an empty is="" is not remembered (jsdom does the same truthiness test; Chrome would emit it): the fail-closed side
  const empty = both('<body is=""></body>', { RETURN_DOM: true });
  assert.equal(empty.edge, empty.jsdom);
  // the value survives removal of the attribute and cloning (DOM Standard, "clone a node")
  const body = new ew.DOMParser().parseFromString("<body is=x>", "text/html").body;
  body.removeAttribute("is");
  assert.equal(body.outerHTML, '<body is="x"></body>');
  assert.equal(body.cloneNode(true).outerHTML, '<body is="x"></body>');
});

test("documented difference, fail-closed: XHTML <prefix:template> content is not kept (jsdom keeps it, browsers do not)", () => {
  // In XML, children of an XHTML-namespace `template` element go to its template contents even when the tag is prefixed. jsdom appends them as ordinary children.
  // DOMPurify removes the prefixed element (it is not an allowed tag name) and keeps its child nodes, so jsdom keeps text DOMPurify would never see in a browser.
  const cases = [
    ['<m:template xmlns:m="http://www.w3.org/1999/xhtml"><b>keep</b>text</m:template>', ""],
    ['<x:template xmlns:x="http://www.w3.org/1999/xhtml"><isindex>İ</isindex></x:template>', ""],
    ['<m:template xmlns:m="http://www.w3.org/1999/xhtml">a<wbr/>b</m:template>', ""],
  ];
  for (const [input, expected] of cases) {
    const r = both(input, XHTML);
    assert.equal(r.edge, expected, input);
    assert.notEqual(r.edge, r.jsdom, "if this starts matching jsdom, update the README's list of differences");
    assert.ok(subsequence(r.edge, r.jsdom), "edge must only ever keep less than jsdom");
  }
  // the unprefixed template is allowed and identical in both
  const plain = both('<template xmlns="http://www.w3.org/1999/xhtml"><s>000</s></template>', XHTML);
  assert.equal(plain.edge, plain.jsdom);
});

test("documented difference, fail-closed: a literal ']]>' in XML text is an error, so DOMPurify returns an empty string", () => {
  // XML 1.0 section 2.4 forbids "]]>" in content outside CDATA. Browsers throw SyntaxError on it, DOMPurify's fallback returns "". jsdom (saxes) accepts it and keeps text.
  const x = both("<![CDATA[]]>ATA[]]>", XHTML);
  assert.equal(x.edge, ""); assert.equal(x.jsdom, "");
  const s = both("<![CDATA[]]>ATA[]]>", SVG_NS);
  assert.equal(s.edge, "");
  assert.notEqual(s.jsdom, "", "if jsdom starts rejecting this, update the README's list of differences");
  assert.ok(subsequence(s.edge, s.jsdom));
  assert.throws(() => { const d = ew.document.implementation.createDocument("http://www.w3.org/2000/svg", "template"); d.documentElement.innerHTML = "a]]>b"; }, { name: "SyntaxError" });
});

test("parse5 and the spec win over two jsdom bugs: foster-parented text and duplicate body attributes", () => {
  // jsdom 29's parse5 tree adapter drops the reference node when foster-parenting text and overwrites attributes on a second <body>. The HTML spec and parse5 do neither.
  assert.equal(run(edge, ew, "<table>x</table>", {}), "x<table></table>");
  assert.equal(run(edge, ew, "<table><tr><td>a</td>b</tr>c</table>d", {}), "bc<table><tbody><tr><td>a</td></tr></tbody></table>d");
  const body = (p, w) => { const d = new w.DOMParser().parseFromString("<body a=1><body a=9>", "text/html"); return d.body.getAttribute("a"); };
  assert.equal(body(edge, ew), "1");
});

test("a NodeIterator survives removal of the node it is on (DOMPurify removes while walking)", () => {
  const d = new ew.DOMParser().parseFromString("<div><p>1</p><p>2</p><p>3</p></div>", "text/html");
  const it = d.createNodeIterator(d.body, 1), seen = [];
  for (let n = it.nextNode(); n; n = it.nextNode()) { seen.push(n.localName); if (n.localName === "p") n.remove(); }
  assert.deepEqual(seen, ["body", "div", "p", "p", "p"]);
});
