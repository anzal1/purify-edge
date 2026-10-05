# Security policy

## Reporting a vulnerability

Please report privately through GitHub private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue or pull request for a suspected vulnerability.

Include the input, the config, the output you got, the output you expected, and the purify-edge, DOMPurify and Node (or runtime) versions. If you can show that DOMPurify on jsdom gives a different, safe output for the same input and config, say so; that is the signature of a bug in this package.

## Scope

In scope:

- Anything in `src/` (the DOM and the XML parser and serializer that DOMPurify runs on) that makes `sanitize()` return output that DOMPurify on jsdom, or on a browser, would not return, where the difference could execute script or smuggle markup. This includes parse differences, mutation (mXSS) differences, serialization differences, and crashes or hangs on crafted input.
- The package metadata and build output (`dist/`) as published to npm.

Out of scope:

- Bugs in DOMPurify itself. Report those to https://github.com/cure53/DOMPurify (see their security policy). If the same bug reproduces on DOMPurify with jsdom, it is a DOMPurify bug.
- Bugs in parse5 itself, reported to https://github.com/inikulin/parse5. If the output differs from DOMPurify-on-jsdom only because of parse5, still tell us, because we pin parse5.
- The documented differences listed in the README under "Security model", which are fail-closed or spec-correct by design.
- What your application does with sanitized output after `sanitize()` returns, and unsafe configs (for example `ALLOW_UNKNOWN_PROTOCOLS`, `ADD_TAGS: ["script"]`).

## What to expect

This is a one-person project. I aim to acknowledge a report within 3 working days and to give a first assessment within 7 days. A confirmed issue gets a fix and a patch release as soon as the fix is verified against the official DOMPurify suite and the fuzzer, and the advisory is published through GitHub once users can upgrade. Reporters are credited unless they ask not to be. There is no bug bounty.

## Supported versions

Only the latest release is supported. Each release is verified against exactly one DOMPurify version, the one pinned in `package.json`.
