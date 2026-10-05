// Entry for the CommonJS build. `require("purify-edge")` returns the DOMPurify instance itself, as DOMPurify's own CJS build does,
// with `default`, `createDOMPurify` and `window` attached so ESM-style interop and destructuring both work.
const m = require("../src/index.js");
const purify = m.default;
for (const k of ["createDOMPurify", "window"]) Object.defineProperty(purify, k, { value: m[k], enumerable: false, configurable: true });
Object.defineProperty(purify, "default", { value: purify, enumerable: false, configurable: true });
module.exports = purify;
