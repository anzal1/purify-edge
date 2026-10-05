import type { DOMPurify, WindowLike } from "dompurify";

declare const purify: DOMPurify & {
  default: DOMPurify;
  createDOMPurify: (win?: WindowLike) => DOMPurify;
  window: WindowLike;
};
export = purify;
