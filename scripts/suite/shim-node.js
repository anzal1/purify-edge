/* jshint node: true, esnext: true */
/* global QUnit */
'use strict';

// Same as jsdom-node.js, but DOMPurify runs on the purify-edge window (src/dom.js in $PURIFY_EDGE_ROOT)
// instead of jsdom. scripts/official-suite.sh copies this file into the DOMPurify checkout's test/ directory. Tests (test-suite.js, bootstrap-test-suite.js) and DOMPurify
// are untouched. Only the window/document construction differs.
//
// SHIM_MODE=main      (default) every module except the four "XSS —" sink modules,
//                     window = shim window.
// SHIM_MODE=sinks     only the four "XSS —" modules. These test what a script-executing
//                     engine does with sanitized output, which the shim (no JS engine)
//                     cannot do. So the sinks (innerHTML, jQuery.html, iframe write) run
//                     on a jsdom window, while DOMPurify itself is built on the shim.
// SHIM_MODE=bootstrap only bootstrap-test-suite.js (UMD load via <script>), with a
//                     JSDOM look-alike backed by the shim + node:vm.
const path = require('path');
const vm = require('vm');
const fs = require('fs');
const { pathToFileURL } = require('url');
const MODE = process.env.SHIM_MODE || 'main';
const HTML = `<html><head></head><body><div id="qunit-fixture"></div></body></html>`;

// QUnit matches regex filters (case-sensitive here) against "module: test".
const SINK_RE = '/^(XSS — |Regression — mXSS: jQuery v3)/';
const NOT_SINK_RE = '!/^(XSS — |Regression — mXSS: jQuery v3)/';

async function startQUnit() {
  const shim = await import(
    pathToFileURL(path.join(process.env.PURIFY_EDGE_ROOT, 'src/dom.js')).href
  );
  // A second instance of the shim stands in for the iframe's separate realm: its classes
  // differ from the main window's, so instanceof across them fails like it does cross-realm.
  const shim2 = await import(
    pathToFileURL(path.join(process.env.PURIFY_EDGE_ROOT, 'src/dom.js')).href + '?realm2'
  );
  shim.setRealmFactory(
    () => createTestWindow(shim2, '<html><head></head><body></body></html>').document
  );
  const { createTestWindow } = await import(
    pathToFileURL(path.join(process.env.PURIFY_EDGE_ROOT, 'scripts/lib/test-window.mjs')).href
  );
  const createDOMPurify = require('../dist/purify.cjs');
  const { default: tests } = await import('./fixtures/expect.mjs');
  const xssTests = tests.filter((element) => /alert/.test(element.payload));

  QUnit.assert.contains = function (actual, expected, message) {
    const result = expected.indexOf(actual) > -1;
    this.pushResult({ result, actual, expected, message });
  };
  QUnit.config.autostart = false;

  if (MODE === 'bootstrap') {
    // A JSDOM look-alike: shim window, <script> children executed in a vm context
    // whose global is the window (DOMPurify's UMD wrapper picks up `window`).
    class ShimJSDOM {
      constructor(html) {
        const window = createTestWindow(
          shim,
          '<html><head></head><body></body></html>'
        );
        const ctx = vm.createContext(window);
        let current = null;
        Object.defineProperty(window.document, 'currentScript', {
          get: () => current,
        });
        // Append a <script> to <body> and its text runs once, like jsdom's
        // runScripts: 'dangerously'.
        const body = window.document.body;
        const append = body.appendChild.bind(body);
        body.appendChild = (node) => {
          append(node);
          if (node.localName === 'script' && node.textContent) {
            current = node;
            try {
              vm.runInContext(node.textContent, ctx);
            } finally {
              current = null;
            }
          }
          return node;
        };
        require('jquery')(window); // loadDOMPurify() calls this itself too; harmless
        this.window = window;
      }
    }
    const bootstrapTestSuite = require('./bootstrap-test-suite');
    QUnit.module('DOMPurify - bootstrap', bootstrapTestSuite(ShimJSDOM));
    QUnit.start();
    return;
  }

  const shimWindow = createTestWindow(shim, HTML);
  let window = shimWindow;
  if (MODE === 'sinks') {
    const { JSDOM, VirtualConsole } = require('jsdom');
    window = new JSDOM(HTML, {
      runScripts: 'dangerously',
      virtualConsole: new VirtualConsole(),
    }).window;
  }
  if (MODE === 'sinks') require('jquery')(window); // jQuery.html() sink; main mode filters it out

  QUnit.config.filter = MODE === 'sinks' ? SINK_RE : NOT_SINK_RE;
  QUnit.module('DOMPurify on parse5 shim');

  // DOMPurify is always built on the shim window.
  const DOMPurify = createDOMPurify(shimWindow);
  if (!DOMPurify.isSupported) {
    console.error('DOMPurify reports isSupported === false under the shim');
    process.exit(1);
  }

  window.alert = () => {
    window.xssed = true;
  };

  require('./test-suite')(DOMPurify, window, tests, xssTests);
  QUnit.start();
}

module.exports = startQUnit;
