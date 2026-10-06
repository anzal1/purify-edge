# Recipes

Copy-paste examples for the places people actually run purify-edge. Each recipe says how it was checked. "Run" means the code in this file, extracted as written, was executed; "code only" means it was not.

Checked with purify-edge 0.1.1 (DOMPurify 3.4.16), Node 24, Miniflare 4 (workerd, no Node compatibility flag), Hono 4.13, marked 18.0.14 and markdown-it 14.

Every recipe sanitizes with the default DOMPurify config. If you pass a config (`ALLOWED_TAGS`, `ADD_ATTR` and so on), the same config works here as it does in DOMPurify.

- [1. Cloudflare Worker](#1-cloudflare-worker)
- [2. Hono on Workers](#2-hono-on-workers)
- [3. Markdown to safe HTML for AI chat output](#3-markdown-to-safe-html-for-ai-chat-output)
- [4. Next.js App Router, edge runtime](#4-nextjs-app-router-edge-runtime)
- [5. Astro and SvelteKit on the Cloudflare adapter](#5-astro-and-sveltekit-on-the-cloudflare-adapter)
- [6. Migrating from isomorphic-dompurify](#6-migrating-from-isomorphic-dompurify)

## 1. Cloudflare Worker

Sanitize an HTML request body inside `fetch()`. No `nodejs_compat` flag is needed.

```js
// file: worker.js
import DOMPurify from "purify-edge";

const MAX_CHARS = 256 * 1024;

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return new Response("POST an HTML body to this URL.", { status: 405, headers: { Allow: "POST" } });
    }
    const dirty = await request.text();
    if (dirty.length > MAX_CHARS) {
      return new Response("Body too large.", { status: 413 });
    }
    const html = DOMPurify.sanitize(dirty);
    return Response.json({ html });
  },
};
```

`wrangler.toml`:

```toml
name = "sanitize"
main = "worker.js"
compatibility_date = "2026-01-01"
```

Return the result as JSON (as above) or in a response you control. Do not serve user HTML back with `Content-Type: text/html` from the same origin as your app, because sanitized is not the same as trusted for navigation.

Status: run in Miniflare. A POST with `<img src=x onerror=alert(1)><script>alert(2)</script><p>hi</p>` returned `{"html":"<img src=\"x\"><p>hi</p>"}`, and a GET returned 405.

## 2. Hono on Workers

A POST route that sanitizes, plus a small middleware that sanitizes the HTML body once and hands it to later handlers.

```ts
// file: app.ts
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import DOMPurify from "purify-edge";

type Env = { Variables: { cleanHtml: string } };

const app = new Hono<Env>();

app.use("/sanitize", bodyLimit({ maxSize: 256 * 1024 }));

// Middleware: read the body as text, sanitize it, expose it as c.var.cleanHtml.
app.use("/sanitize", async (c, next) => {
  if (c.req.method === "POST") {
    c.set("cleanHtml", DOMPurify.sanitize(await c.req.text()));
  }
  await next();
});

app.post("/sanitize", (c) => c.json({ html: c.var.cleanHtml }));

export default app;
```

Hono apps are Workers modules as they stand, so `export default app` is the whole entry point. To sanitize a JSON field instead of a raw HTML body:

```ts
// file: json-route.ts
import { Hono } from "hono";
import DOMPurify from "purify-edge";

const app = new Hono();

app.post("/comments", async (c) => {
  const { body } = await c.req.json<{ body?: unknown }>();
  if (typeof body !== "string") return c.json({ error: "body must be a string" }, 400);
  return c.json({ body: DOMPurify.sanitize(body) });
});

export default app;
```

Status: run with `app.request()` in Node (Hono 4.13) for both files, and run in Miniflare for the first. Output for the hostile sample matched recipe 1, the oversized body got 413, and a non-string JSON field got 400.

## 3. Markdown to safe HTML for AI chat output

Markdown renderers do not sanitize. Model output is untrusted text, so render first and sanitize the rendered HTML last. One module covers both marked and markdown-it:

```js
// file: render-markdown.mjs
import { marked } from "marked";
import MarkdownIt from "markdown-it";
import { createDOMPurify } from "purify-edge";

// Own instance, so the link hook below does not touch the shared default export.
const purify = createDOMPurify();
purify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function renderWithMarked(markdown) {
  const html = marked.parse(markdown, { async: false, gfm: true, breaks: true });
  return purify.sanitize(html);
}

// markdown-it ships with html: false, which escapes raw HTML. Keep that for chat.
const md = new MarkdownIt({ linkify: true, breaks: true });

export function renderWithMarkdownIt(markdown) {
  return purify.sanitize(md.render(markdown));
}
```

Use it in a Worker:

```js
// file: md-worker.js
import { renderWithMarked } from "./render-markdown.mjs";

export default {
  async fetch(request) {
    const { markdown } = await request.json();
    return Response.json({ html: renderWithMarked(String(markdown)) });
  },
};
```

Notes:

- Sanitize the whole accumulated message on each update when you stream tokens. A half-finished markdown string renders to half-finished HTML, and the sanitizer will close and drop whatever is broken. Do not sanitize individual chunks and concatenate them.
- `marked` passes raw HTML through, so it relies entirely on the sanitizer. `markdown-it` with the default `html: false` escapes it first, so the sanitizer is a second layer. markdown-it was checked with `html: true` as well, to show the sanitizer alone is enough.
- The hook adds `target` and `rel` after DOMPurify has filtered attributes, so it is not stripped. Drop the hook if you do not want links to open in a new tab.
- markdown-it's own `validateLink` already refuses `javascript:`, `vbscript:` and most `data:` URLs. Do not turn that off and rely on the sanitizer alone unless you have to.

Status: run in Node and in Miniflare, with this hostile sample:

```md
# Hello
[click me](javascript:alert(1))
[entity](java&#115;cript:alert(2))
<img src=x onerror=alert(3)>
<a href="/ok" onclick="alert(4)">raw link</a>
<script>alert(5)</script>
**bold** and `code`
```

For marked, the output had no `onerror`, no `onclick`, no `javascript:` and no `<script`, and kept `<strong>bold</strong>` and `<code>code</code>`. The two `javascript:` links came out as bare `<a>` tags with the `href` removed, and the surviving raw link got `target` and `rel` from the hook. markdown-it behaves differently because its own link validation refuses `javascript:` URLs: those two lines stay as literal, inert text. With the default `html: false` the raw tags are escaped, so the word `onerror` is still in the output as visible text; re-parsing that output with parse5 found no element with an `on*` attribute, no `javascript:` link and no `script`. With `html: true`, the sanitizer removed `<script>`, `onerror` and `onclick` (checked by string match and by the same re-parse). The Miniflare run of the marked path returned the same bytes as Node.

## 4. Next.js App Router, edge runtime

`app/api/sanitize/route.ts`:

```ts
// file: route.ts
import DOMPurify from "purify-edge";

export const runtime = "edge";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.html !== "string") {
    return Response.json({ error: "html must be a string" }, { status: 400 });
  }
  return Response.json({ html: DOMPurify.sanitize(body.html) });
}
```

Status: code only for Next itself. I did not install or run Next. The handler is plain Web `Request` and `Response`, and I ran the same function body, with the same dependency bundled for a neutral platform, inside `@edge-runtime/vm`, which is the isolate Next's edge runtime is built on. That shows the handler logic and the library work in that isolate. It does not show that Next's bundler resolves the package the way you want, so check one build before relying on it.

If you delete the `runtime` line, the route runs on the Node runtime and still works, with no jsdom to install.

## 5. Astro and SvelteKit on the Cloudflare adapter

Both run server code in workerd, so the Worker recipe applies unchanged.

Astro (`@astrojs/cloudflare`), `src/pages/api/sanitize.ts`:

```ts
// file: astro-sanitize.ts
import type { APIRoute } from "astro";
import DOMPurify from "purify-edge";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { html } = await request.json();
  if (typeof html !== "string") return Response.json({ error: "html must be a string" }, { status: 400 });
  return Response.json({ html: DOMPurify.sanitize(html) });
};
```

In a page, sanitize before `set:html`:

```astro
---
import DOMPurify from "purify-edge";
const { cmsHtml } = Astro.props;
const safe = DOMPurify.sanitize(cmsHtml);
---
<article set:html={safe} />
```

SvelteKit (`@sveltejs/adapter-cloudflare`), `src/routes/api/sanitize/+server.ts`:

```ts
// file: sveltekit-sanitize.ts
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import DOMPurify from "purify-edge";

export const POST: RequestHandler = async ({ request }) => {
  const { html } = await request.json();
  if (typeof html !== "string") return json({ error: "html must be a string" }, { status: 400 });
  return json({ html: DOMPurify.sanitize(html) });
};
```

And in a `+page.server.ts` load function, sanitize once on the server so the page can use `{@html data.safe}`:

```ts
// file: sveltekit-load.ts
import type { PageServerLoad } from "./$types";
import DOMPurify from "purify-edge";

export const load: PageServerLoad = async ({ fetch }) => {
  const res = await fetch("/api/article");
  const { html } = await res.json();
  return { safe: DOMPurify.sanitize(html) };
};
```

Status: code only. Neither Astro nor SvelteKit was installed. The route bodies are standard `Request` handling, the same as recipe 1.

One thing to watch with SvelteKit: a `+page.svelte` that imports `purify-edge` for client-side rendering would bundle the shim into the browser. In the browser, use `dompurify`, or sanitize on the server as above.

## 6. Migrating from isomorphic-dompurify

The swap:

```diff
-import DOMPurify from "isomorphic-dompurify";
+import DOMPurify from "purify-edge";
```

Then remove `isomorphic-dompurify` and `jsdom` from your dependencies. Options, hooks and `sanitize()` calls stay as they are, because it is the same DOMPurify.

What to watch for:

- **Pin the DOMPurify version.** purify-edge depends on `dompurify` at exactly 3.4.16 and is only verified against that version. isomorphic-dompurify asks for a range (`^3.4.12` in 4.4.0). If your own `package.json` also lists `dompurify` with a caret, you may end up with two copies, or with a copy newer than the one purify-edge was checked against. Run `npm ls dompurify` after the swap and make sure there is one copy, 3.4.16. If you must list `dompurify` yourself, pin it exactly.
- **Browser bundles.** isomorphic-dompurify hands the browser the real DOMPurify. purify-edge always uses its shim window, even in a browser, which is correct but wasteful there. For code that ships to the client, import `dompurify` directly, and keep purify-edge for server and edge code.
- **Hooks that read DOM properties.** A hook that reaches for properties beyond the few the shim reflects will see `undefined`. Hooks that read tag names, attributes and text, such as the link hook in recipe 3, work.
- **`RETURN_DOM` and `RETURN_DOM_FRAGMENT`.** These return shim nodes, not jsdom nodes. Serialize with `outerHTML` or `innerHTML` if you need a string.
- **Custom jsdom windows.** Code of the form `createDOMPurify(new JSDOM("").window)` becomes the single import above. There is no jsdom option to pass through.
- **Output.** Output is byte-identical to DOMPurify on jsdom in the project's parity corpus, so snapshots should not change. Run your own tests once anyway.

Status: run. In the check, 9 inputs (the hostile HTML from recipe 1, the marked and markdown-it renderings of the recipe 3 sample, and six classic mXSS and clobbering strings) plus one input through a hook all produced identical strings from isomorphic-dompurify 4.4.0 and purify-edge. `npm ls dompurify` in this repo shows one copy, 3.4.16, because isomorphic-dompurify dedupes to it.
