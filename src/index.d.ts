import type { Config, DOMPurify, WindowLike } from "dompurify";

export type {
  Config,
  DOMPurify,
  DocumentFragmentHook,
  ElementHook,
  HookName,
  NodeHook,
  RemovedAttribute,
  RemovedElement,
  UponSanitizeAttributeHook,
  UponSanitizeAttributeHookEvent,
  UponSanitizeElementHook,
  UponSanitizeElementHookEvent,
  WindowLike,
} from "dompurify";

/** The shim window DOMPurify runs on. For advanced use. */
export const window: WindowLike;

/** Create a fresh DOMPurify instance (own config and hooks). Defaults to the shared shim `window`. */
export function createDOMPurify(win?: WindowLike): DOMPurify;

declare const purify: DOMPurify;
export default purify;
