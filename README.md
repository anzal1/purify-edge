# purify-edge

DOMPurify without jsdom. Byte-identical output, small, runs on Workers and other edge runtimes.

purify-edge runs the unmodified [DOMPurify](https://github.com/cure53/DOMPurify) on a small DOM built on [parse5](https://github.com/inikulin/parse5) instead of jsdom. The sanitizer is DOMPurify. What this package adds is the window DOMPurify runs on: about 800 lines of commented JavaScript in `src/`.

Status: v0.1, not on npm yet.

It is verified against DOMPurify **3.4.16**, and only that version (see [Verified against DOMPurify 3.4.16](#verified-against-dompurify-3416)).

## Install

```sh
npm install purify-edge
```

Node 20 or later, or an edge runtime. The runtime code imports nothing from `node:` and uses no Node APIs. It is tested on Node 20, 22 and 24, in the `@edge-runtime/vm` isolate (the one Vercel's edge runtime is built on) and in workerd (Cloudflare Workers, through Miniflare, without the Node compatibility flag). Other runtimes such as Deno and Bun should work but are not tested.

```js
import DOMPurify from "purify-edge";

DOMPurify.sanitize('<img src=x onerror=alert(1)>hello');
// '<img src="x">hello'
```

The default export is a DOMPurify instance with the same API as DOMPurify in a browser: `sanitize`, `addHook`, `removeHook`, `setConfig`, `clearConfig`, `isValidAttribute`, `removed`, `isSupported`, `version`. Two extra named exports:

```js
import DOMPurify, { createDOMPurify, window } from "purify-edge";

const own = createDOMPurify();   // a fresh instance with its own config and hooks
window;                          // the shim window, for advanced use
```

CommonJS works too: `const DOMPurify = require("purify-edge")` returns the instance (with `.default`, `.createDOMPurify` and `.window` attached). The CJS build bundles parse5, which is ESM-only.

Types are DOMPurify's own, re-exported: `import type { Config } from "dompurify"` works, and so does `import type { Config } from "purify-edge"`.

## Migrating from isomorphic-dompurify

```diff
-import DOMPurify from "isomorphic-dompurify";
+import DOMPurify from "purify-edge";
```

If you build your own instance with jsdom today, replace this:

```js
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
const DOMPurify = createDOMPurify(new JSDOM("").window);
```

with the same one-line import. Options and hooks carry over unchanged because it is the same DOMPurify.

purify-edge always uses its own window, including in a browser. In the browser use `dompurify` itself, which has a real DOM. Hooks that read DOM properties beyond the few the shim reflects (see below) will see `undefined`.

## Why

jsdom is a very large piece of software to carry along just to give a sanitizer a parser and a tree.

- It is heavy. In the measurements below, DOMPurify on jsdom peaks at 600 MB resident on 2,000 chat-sized documents and 1,346 MB on 50 newsletters, against 185 MB and 435 MB for purify-edge.
- It leaks. In the fuzzing runs, jsdom grew about 30 KB per `sanitize()` call for the life of the process. The shim stayed flat.
- It cannot run on edge runtimes. DOMPurify's maintainers say a server needs a DOM, recommend jsdom, and have said they do not intend to support Workers (cure53/DOMPurify issues #577 and #1583). jsdom needs Node APIs that isolates do not have.

The obvious alternatives either change the output or change the security. Swapping jsdom for linkedom or happy-dom does not work with DOMPurify unpatched, and the maintainers do not consider happy-dom safe. Other sanitizers (sanitize-html, rehype-sanitize) have their own rules and their own serialization, so their output differs from DOMPurify's.

## Parity

Output compared byte for byte with DOMPurify on jsdom, default config, on DOMPurify's own `expect.mjs` fixture (223 vectors, tag 3.4.16). The other contenders ran the same vectors.

| Contender | Identical to DOMPurify on jsdom |
|---|---|
| purify-edge | 100% (223 of 223) |
| sanitize-html (DOMPurify's default tag and attribute lists) | 43.5% (97 of 223) |
| DOMPurify + linkedom (patched to start at all) | 13.5% (30 of 223) |
| rehype-sanitize (default schema) | 9.4% (21 of 223) |

Read this table with care. For sanitize-html and rehype-sanitize, different bytes mostly mean different serialization and different rules (`<img />` against `<img>`, `&#x3C;` against `&lt;`), not necessarily unsafe output. They are different sanitizers. The linkedom row is different: it is DOMPurify itself on a DOM that is not faithful enough, and event handlers survived in 326 of 2,000 chat outputs (a crude regex for `on*=` or `javascript:` in tag position; jsdom and purify-edge: 0). DOMPurify 3.4.16 does not initialise on linkedom at all without about 12 lines of compatibility patching, and then it still diverges from jsdom on most inputs.

On 2,000 marked-rendered LLM-style chat responses (about a quarter with injected hostile payloads) and 50 large newsletter documents (100 KB to 1 MB), purify-edge differed from jsdom 0 times.

## Speed and memory

Measured with the verification prototype of this code, before the packaging cleanup (the benchmark harness is not part of this repository; the behaviour of `src/` is unchanged). Apple M5 Max, macOS arm64, Node 24.20.0. DOMPurify 3.4.16, isomorphic-dompurify 4.4.0 (jsdom 30.1.2), parse5 8.0.1, linkedom 0.18.13. Default DOMPurify config everywhere.

- Corpus a: 2,000 marked-rendered chat responses, 2.1 KB on average.
- Corpus c: 50 generated newsletter documents, 100 KB to 1 MB each, 19.7 MB in total.

Throughput is operations per second (median of 5 runs for jsdom and purify-edge, a single run for the others). Memory is peak resident set size.

| Contender | a ops/s | a vs jsdom | c ops/s | c vs jsdom | peak RSS a | peak RSS c | idle RSS |
|---|---|---|---|---|---|---|---|
| DOMPurify on jsdom | 1,827 | 1.0x | 12.6 | 1.0x | 600 MB | 1,346 MB | 171 MB |
| DOMPurify + linkedom | 5,734 | 3.1x | 47.2 | 3.7x | 291 MB | 551 MB | 69 MB |
| sanitize-html | 9,206 | 5.0x | 69.1 | 5.5x | 193 MB | 391 MB | 61 MB |
| rehype-sanitize | 7,680 | 4.2x | 57.5 | 4.6x | 133 MB | 346 MB | 62 MB |
| **purify-edge** | 8,822 | 4.8x | 55.8 | 4.4x | 185 MB | 435 MB | 61 MB |

So purify-edge is 4.4x to 4.8x faster than DOMPurify on jsdom, with 3.1x to 3.2x lower peak memory. That is a little under the 5x I was aiming for. It is about as fast as sanitize-html and rehype-sanitize, which means parse5 and DOMPurify's own walk set the ceiling, not the shim. This was not profiled further. sanitize-html and rehype-sanitize are not substitutes for DOMPurify; they are in the table as a speed floor.

Bundle size, with parse5, DOMPurify and the shim, minified for a neutral platform: 218.5 KB, 65.6 KB gzipped (`npm test` prints the current numbers).

## Security model

**The sanitizer is DOMPurify, unchanged.** purify-edge imports the published `dompurify` package at an exact version and never patches it. Every allow list, hook, config option and mXSS defence is DOMPurify's.

**The shim is the added attack surface.** DOMPurify's maintainers treat the server-side DOM as part of the trusted computing base, and that is true here. `src/dom.js` (the tree) and `src/xml.js` (an XML parser and serializer, used only for `PARSER_MEDIA_TYPE: "application/xhtml+xml"` and non-HTML `NAMESPACE`) are kept small and commented. HTML parsing and serialization are parse5's. The shim implements what DOMPurify 3.4.x calls, and nothing else. Its correctness is argued by comparison with DOMPurify on jsdom, not by reading the code once: the official suite, a differential fuzzer and parity corpora, all described below, run in CI.

**No script execution.** There is no JavaScript engine in the shim. Nothing in sanitized or parsed input is ever run, and scripts, event handlers and `iframe` documents are inert data. `iframe.contentDocument` is a second, separate shim realm.

**Known differences from DOMPurify on jsdom.** All of them are fail-closed (purify-edge keeps less than jsdom, never more) or spec-correct:

- XHTML mode, prefixed `template` elements. In XML, the children of an XHTML-namespace `template` go into its template contents even when the tag is prefixed (`<m:template xmlns:m="http://www.w3.org/1999/xhtml">`). Browsers do this. jsdom appends them as ordinary children, so DOMPurify keeps the content of the removed element. purify-edge, like a browser, does not. Checked against Chrome.
- A literal `]]>` in XML text outside a CDATA section is an error under XML 1.0 section 2.4, so browsers throw and DOMPurify returns an empty string. purify-edge does the same. jsdom's XML parser accepts it and keeps the text.
- An unpaired surrogate in XML mode. jsdom's parser lets a high surrogate swallow the next character, so jsdom reports a parse error. The shim parses, and then the serializer throws. Both end with an empty or error result.
- `<body is="">` (an empty `is` value) is not remembered for `RETURN_DOM` serialization. jsdom does the same. Chrome would serialize it; it is inert, and leaving it out is the fail-closed side. A non-empty `is` value is remembered and serialized, as in browsers.
- Two jsdom bugs where the shim follows the HTML spec and parse5. jsdom 29 puts foster-parented text after the table (`<table>x</table>` gives `<table></table>x`, spec and parse5 give `x<table></table>`), and overwrites attributes on a second `<body>` instead of keeping the first (`<body a=1><body a=9>`). On stock jsdom these inputs differ from purify-edge; the fuzzer patches jsdom's source in memory to remove them from the comparison (`--stock-jsdom` shows the raw count: 2,836 differences in one 800,000-comparison run, all from these two).
- Selectors are tag names, `#id`, `[attr]` and comma lists. Anything else throws. DOMPurify and its suite use nothing more.
- Only a few string IDL properties are reflected from attributes (`href`, `target`, `rel` and a handful more on `a`, `area`, `base`, `link` and `form`), which is what makes the README's `'target' in node` hook work. A hook that reads other IDL properties gets `undefined`.

**Form named-property clobbering is not emulated.** DOMPurify's `SANITIZE_DOM` guards against `<form><input name=x>` shadowing `document` and `form` properties. jsdom does not implement that browser behaviour either, so that branch of DOMPurify is only exercised in real browsers. purify-edge answers DOMPurify's `value in document || value in formElement` check with property-name lists generated from jsdom (`scripts/gen-names.mjs`).

## Verified against DOMPurify 3.4.16

The parity guarantee is per DOMPurify version. For 3.4.16, with the verification and the packaged tests:

- DOMPurify's own official test suite, unmodified, run on the shim window: 984 tests, 1,247 assertions, identical to the jsdom run assertion by assertion, 0 failures. `sh scripts/official-suite.sh` reproduces it; CI runs it.
- A differential fuzzer against DOMPurify on jsdom: more than 250,000 inputs on the four default configs (default, `USE_PROFILES`, `FORBID_TAGS`, `ADD_ATTR` plus the README hook), 0 differences. A further 60,000 inputs on 12 extended configs (`RETURN_DOM`, `RETURN_DOM_FRAGMENT`, `IN_PLACE`, `SAFE_FOR_TEMPLATES`, `WHOLE_DOCUMENT`, `FORCE_BODY`, XHTML, custom elements, profiles, `removed[]`, `NAMESPACE`): 7 differences, all in the two documented XHTML classes above, each one checked to fail closed.
- 2,273 corpus cases (2,000 chat responses, 223 vectors, 50 newsletters), 0 differences.
- The package tests: a few hundred cases compared with DOMPurify on jsdom across several configs, one regression test per bug found during verification, and an edge isolate test.

The official suite does have gaps. Deliberately breaking the shim's shadow root, `textContent`, template-content cloning or `DOMParser` turns it red, but breaking custom-element `disconnectedCallback` handling or attribute case folding does not. The package tests catch case folding (each regression test was checked by reverting its fix). I have not shown that anything catches `disconnectedCallback`, so treat that as unverified.

**Upgrade policy.** The `dompurify` dependency is pinned to an exact version, and so is `parse5`. Moving either pin requires, in the same change: `scripts/official-suite.sh` passing at the new tag, the extended and default fuzz runs showing nothing unexplained, the package tests passing, and this section updated with the new version and numbers. There is no automatic dependency bump for either package.

### Running the checks yourself

```sh
npm ci
npm test                                  # package tests, edge isolate, Workers smoke test
sh scripts/official-suite.sh              # clones DOMPurify at the pinned tag; needs git, npm and network
node scripts/fuzz.mjs --cases 20000       # the CI smoke run, about 12 seconds
node scripts/fuzz.mjs --cases 200000      # the full default-config run, about 2 minutes
node scripts/fuzz.mjs --ext --cases 60000 # the extended configs, about 4.5 minutes; prints and classifies the known differences
```

The fuzzer runs jsdom in short-lived child processes because of the leak. Use `nice -n 19` for the long runs.

## Layout

- `src/dom.js`: the DOM (tree, selectors, shadow roots, custom elements, template contents, node iterators, DOMParser) and the parse5 tree adapter.
- `src/xml.js`: the XML parser and serializer.
- `src/names.js`: generated property-name lists for the clobber check.
- `src/index.js`: wires DOMPurify to the window.
- `scripts/`: official-suite runner, fuzzer, diff classifier, build.
- `test/`: parity, regression, API, types, edge isolate and Workers tests.

## Credits

All of the sanitizing is [DOMPurify](https://github.com/cure53/DOMPurify) by Cure53 and contributors. HTML parsing and serialization are [parse5](https://github.com/inikulin/parse5) by Ivan Nikulin and contributors. The tests use DOMPurify's published test vectors, and the shim's behaviour was checked against jsdom throughout. None of these projects endorses or maintains purify-edge, and bugs here should not be reported to them.

## License

MIT. See [LICENSE](LICENSE). DOMPurify is a dependency under its own Apache-2.0 or MPL-2.0 licence and is not redistributed here.
