# Benchmarks

Every number about speed, memory, parity and safety in the main README comes from this folder and can be rerun with one command. Nothing here is published to npm (`package.json` `files` is `src`, `dist` and the docs only), and the benchmark dependencies are `devDependencies`.

```sh
npm ci
npm run bench:parity    # about 15 seconds: parity vs DOMPurify on jsdom, and live event handlers after re-parse; writes bench/results/parity.json
npm run bench:speed     # about 1 minute:  ops/sec and peak RSS, median of 5 runs; writes bench/results/speed.json
npm run bench:mxss      # prints the worked example below
npm run bench:corpus    # regenerates the corpora and prints their sha1 (the run scripts do this on demand)
```

`npm run bench` runs parity and then speed. Use `nice -n 19 npm run bench:speed` on a machine you are working on. Nothing in the benchmark runs in parallel.

## What is measured

Contenders (`bench/contenders.mjs`), all on default settings:

| Name | What it is |
|---|---|
| isomorphic-dompurify 4.4.0 | DOMPurify 3.4.16 on jsdom 30.1.2. The reference. |
| DOMPurify + linkedom 0.18.13 | The same DOMPurify on linkedom, with a small compat patch so that it starts at all (see the comment in `contenders.mjs`). |
| sanitize-html 2.18.0 | Configured with DOMPurify's own default tag and attribute lists. |
| rehype-sanitize 6.0.0 | Default schema, through unified, rehype-parse and rehype-stringify. |
| purify-edge | `../src`. |

Corpora (`bench/gen-corpus.mjs`, seeded, generated at run time into the gitignored `bench/.cache/`, never committed):

- **a**: 2,000 chat responses rendered by marked (about 2.1 KB each), about a quarter with injected hostile payloads (469 documents contain one).
- **c**: 50 generated newsletter documents, 100 KB to 1 MB, 19.7 MB in total.
- **vectors**: the 223 inputs of DOMPurify's own `expect.mjs` at tag 3.4.16 (`test/fixtures/expect-payloads.json`).

`node bench/gen-corpus.mjs` prints `sha1 6b977df3fd6d` for a and `2181e8e6b51c` for c. If yours differ, the corpus (or the pinned `marked`) differs.

Measures:

- **Identical**: percent of the 223 vectors whose output is byte-identical to isomorphic-dompurify's.
- **Live handlers after re-parse**: the number of corpus-a outputs that contain at least one element with an `on*` attribute once the output string is re-parsed by parse5, a spec-compliant HTML parser, as `div.innerHTML = output` would in a browser (template contents included; `bench/reparse.mjs`). This is the honest measure of "becomes live XSS in a browser".
- **Raw matches**: the number of corpus-a outputs where a regex (`<tag ... on*=`) finds an event-handler attribute in the raw output string, with no re-parse. It over-counts: a payload that survives as the text of an attribute value matches the regex but is inert (the 18 extra in the linkedom row, all of the sanitize-html and rehype-sanitize matches).
- **javascript: URLs**: an extra column, outputs with a `javascript:` URL in `href`, `src`, `action`, `formaction`, `xlink:href`, `data` or `poster` after the same re-parse.
- **Speed**: ops/sec is `sanitize()` calls per second over the whole corpus after a warm-up (20 documents for a, 1 for c), median of 5 runs. A run is capped at 90 seconds (none hit it).
- **Memory**: peak resident set size of the process (`process.resourceUsage().maxRSS`). Every measurement is its own child process started with `node --max-old-space-size=4096`, so one contender's garbage never shows up in another's number. The peak includes the corpus held in memory, which is the same for every contender. Idle is the same process after loading the contender and sanitizing one tiny string.

## Machine

Apple M5 Max (18 cores), 48 GB, macOS 26.6.2 (Darwin 25.6.0, arm64), Node v24.20.0, run under `nice -n 19`. The raw numbers, with all five runs per cell, are in `bench/results/speed.json` and `bench/results/parity.json`.

## Results

### Parity and safety

Reference: DOMPurify on jsdom. Corpus a has 2,000 outputs.

| Contender | Identical to jsdom (223 vectors) | Live `on*` handlers after re-parse | Raw `on*` matches | Live `javascript:` URLs after re-parse | Outputs differing from jsdom (of 2,000) |
|---|---|---|---|---|---|
| DOMPurify on jsdom | 100% (223) | 0 | 0 | 0 | 0 |
| **purify-edge** | **100% (223)** | **0** | **0** | **0** | **0** |
| DOMPurify + linkedom | 13.5% (30) | **168** | 186 | **193** | 1,608 |
| sanitize-html | 43.5% (97) | 0 | 24 | 0 | 1,598 |
| rehype-sanitize | 9.4% (21) | 0 | 44 | 0 | 1,870 |

How to read it:

- sanitize-html and rehype-sanitize are different sanitizers with different rules and serialization (`<img />` against `<img>`, `&#x3C;` against `&lt;`). Differing bytes are not unsafe output, and the re-parse measure confirms it: zero live handlers. Their raw matches are payloads that survived as inert attribute text.
- DOMPurify + linkedom is DOMPurify on a DOM that is not faithful enough. After the compat patch it starts, but event handlers and `javascript:` URLs reach the output in 168 and 193 of 2,000 responses, and a browser would run them. I did not root-cause why DOMPurify's checks do not fire on linkedom (see the control line in the next section); the row measures this patched setup, not linkedom in general.

### Speed and memory

Median of 5 runs. "vs jsdom" is ops/sec divided by the jsdom row.

| Contender | a ops/s | a vs jsdom | c ops/s | c vs jsdom | peak RSS a | peak RSS c | idle RSS |
|---|---|---|---|---|---|---|---|
| DOMPurify on jsdom | 1,757 | 1.0x | 12.1 | 1.0x | 605 MB | 1,236 MB | 162 MB |
| DOMPurify + linkedom | 5,111 | 2.9x | 43.6 | 3.6x | 407 MB | 534 MB | 70 MB |
| sanitize-html | 9,097 | 5.2x | 71.2 | 5.9x | 328 MB | 413 MB | 63 MB |
| rehype-sanitize | 7,932 | 4.5x | 54.7 | 4.5x | 234 MB | 386 MB | 63 MB |
| **purify-edge** | 7,543 | 4.3x | 57.4 | 4.7x | 209 MB | 307 MB | 62 MB |

purify-edge peaks at 2.9x (a) and 4.0x (c) lower resident memory than DOMPurify on jsdom. sanitize-html and rehype-sanitize are in the table as a speed floor, not as substitutes: they do not produce DOMPurify's output.

Run-to-run spread on this machine is a few percent (see `allOpsPerSec` in `speed.json`), so the ordering on corpus a (sanitize-html, rehype-sanitize, purify-edge) is real, but all three are within about 20% of each other.

## Why parser compliance matters

DOMPurify parses the input, walks the tree, and serializes it. Its guarantees hold only if the DOM it runs on parses and serializes the way a browser does, because the output string is parsed a second time by the browser. A DOM that disagrees with the browser about where an element ends is the raw material of mutation XSS.

`npm run bench:mxss` runs this input through three setups and then re-parses each output with parse5, the way a browser would:

```html
<xmp><p title="</xmp><img src=x onerror=alert(1)>">
```

`<xmp>` is a raw-text element: the browser ends it at the first `</xmp>`, so the `<img>` after it is a real element in the page, and the `<p title="` before it is only text.

```text
isomorphic-dompurify (jsdom)
  output:      "<img src=\"x\">\"&gt;"
  live on*:    none

linkedom (DOMPurify + patched linkedom)
  output:      "<xmp>&lt;p title=\"</xmp><img src=\"x\" onerror=\"alert(1)\">\"&gt;"
  re-parsed:   <xmp>&lt;p title="</xmp><img src="x" onerror="alert(1)">"&gt;
  live on*:    <img onerror="alert(1)">

purify-edge
  output:      "<img src=\"x\">\"&gt;"
  live on*:    none
```

linkedom's output string still contains `<img src="x" onerror="alert(1)">` outside the `xmp`, and when a browser re-parses that string the handler is live: this is the "becomes live XSS" case the parity table counts. jsdom and purify-edge, both backed by the spec parser, drop the `xmp` element with its content, remove the handler, and agree byte for byte.

An honest caveat: this input is not what separates linkedom here. The control line printed by `npm run bench:mxss` shows that the same patched setup also returns the plain `<img src=x onerror=alert(1)>` with its handler intact, so DOMPurify's attribute and element checks are not taking effect on linkedom at all in this setup. The benchmark shows that DOMPurify on linkedom, with the minimum patch, is unsafe on this corpus. It does not isolate parser non-compliance as the cause. What the example does show is the failure mode, in a form you can paste into a browser: the sanitizer's output string, not its DOM, is what runs.
