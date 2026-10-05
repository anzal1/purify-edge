import purify = require("purify-edge");
import type { Config } from "dompurify";

const cfg: Config = { ALLOWED_TAGS: ["b"] };
const a: string = purify.sanitize("<b>x</b>", cfg);
const b: string = purify.default.sanitize("<b>x</b>");
const c: string = purify.createDOMPurify().sanitize("<b>x</b>");
export = { a, b, c };
