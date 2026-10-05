// A window for the test runners and the fuzzer: the shim window with its document replaced by a parsed HTML document, plus the few
// globals the DOMPurify test suite and jQuery expect. `dom` is the imported src/dom.js module (passed in so a second copy can stand in for another realm).
export function createTestWindow(dom, html) {
  const w = dom.createWindow();
  w.document = new dom.DOMParser().parseFromString(html, "text/html");
  w.name = ""; // jsdom 29 reports an empty window.name too (the suite's name == 'nodejs' branch is skipped on both)
  w.window = w; w.location = { href: "about:blank" };
  w.setTimeout = setTimeout; w.clearTimeout = clearTimeout; // jQuery's ready() calls these
  return w;
}
