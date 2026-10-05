import DOMPurify, { createDOMPurify, window } from "purify-edge";
import type { Config } from "dompurify";
import type { DOMPurify as DOMPurifyType, Config as ReExportedConfig, WindowLike } from "purify-edge";

const cfg: Config = { ALLOWED_TAGS: ["b"], RETURN_DOM: false };
const same: ReExportedConfig = cfg;
const s: string = DOMPurify.sanitize("<b>x</b>", cfg);
const el: Node = DOMPurify.sanitize("<b>x</b>", { RETURN_DOM: true });
const frag: DocumentFragment = DOMPurify.sanitize("<b>x</b>", { RETURN_DOM_FRAGMENT: true });
const fresh: DOMPurifyType = createDOMPurify();
const w: WindowLike = window;
const fresh2: DOMPurifyType = createDOMPurify(w);
DOMPurify.addHook("afterSanitizeAttributes", (node) => { node.nodeName; });
const supported: boolean = DOMPurify.isSupported;
const removed: unknown[] = DOMPurify.removed;
// @ts-expect-error sanitize takes a string, node or similar, not a number
DOMPurify.sanitize(42);
export { s, el, frag, fresh, fresh2, supported, removed, same };
