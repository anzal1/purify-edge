#!/bin/sh
# Runs DOMPurify's own official test suite (QUnit, same files, unmodified) with DOMPurify built on the purify-edge window, and compares every assertion with the stock jsdom run.
# Passes only if the shim run has no failures and every test's assertions are identical to jsdom's.
#
# The suite is run three ways, because the shim has no script engine:
#   main       every module except the "XSS" sink modules, window = purify-edge window
#   sinks      the "XSS" modules (innerHTML, jQuery.html, iframe.write) and the jQuery mXSS test: DOMPurify on purify-edge, the sink itself on a jsdom window
#   bootstrap  the UMD load via <script>, with a JSDOM look-alike backed by purify-edge and node:vm
#
# usage: sh scripts/official-suite.sh        (clones DOMPurify at the pinned tag on first use; needs network, git, npm)
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$(sh "$ROOT/scripts/fetch-dompurify.sh")
OUT="$ROOT/results/suite"; mkdir -p "$OUT"
cd "$DIR"
if [ ! -d node_modules/qunit ]; then
  # --ignore-scripts: DOMPurify's husky/prepare hooks are not needed to run the suite. Playwright is a devDependency there; no browser download happens.
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 nice -n 19 npm ci --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null
fi
# The runners are new files that sit beside the suite. They are copies of test/jsdom-node-runner.js and jsdom-node.js where only the window construction differs.
cp "$ROOT/scripts/suite/shim-node.js" "$ROOT/scripts/suite/shim-node-runner.js" test/
export NODE_ENV=test PURIFY_EDGE_ROOT="$ROOT"
nice -n 19 node test/jsdom-node-runner.js > "$OUT/jsdom.tap" 2>&1 || true
nice -n 19 env SHIM_MODE=bootstrap node test/shim-node-runner.js > "$OUT/shim-bootstrap.tap" 2>&1 || true
nice -n 19 env SHIM_MODE=sinks node test/shim-node-runner.js > "$OUT/shim-sinks.tap" 2>&1 || true
nice -n 19 node test/shim-node-runner.js > "$OUT/shim-main.tap" 2>&1 || true
cat "$OUT/shim-bootstrap.tap" "$OUT/shim-sinks.tap" "$OUT/shim-main.tap" > "$OUT/shim-all.tap"
rm -f test/shim-node.js test/shim-node-runner.js   # leave the clone as the tag has it
cd "$ROOT"
node scripts/tap-compare.mjs "$OUT/jsdom.tap" "$OUT/shim-all.tap"
