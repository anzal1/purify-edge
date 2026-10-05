// purify-edge: unmodified DOMPurify running on the small parse5-backed DOM in ./dom.js instead of jsdom.
// DOMPurify is imported as published and is never patched. The only thing this package adds is the window it runs on.
import DOMPurify from "dompurify";
import { createWindow } from "./dom.js";

// The shim window. Exported for advanced use (building your own DOMPurify instance, parsing with its DOMParser).
export const window = createWindow();

// A fresh DOMPurify instance with its own config and hooks. Pass a window to run on a different shim window; the default is the shared one.
export function createDOMPurify(win = window) {
  return DOMPurify(win);
}

// A ready-to-use instance, the same shape as `import DOMPurify from "dompurify"` in a browser.
export default createDOMPurify();
