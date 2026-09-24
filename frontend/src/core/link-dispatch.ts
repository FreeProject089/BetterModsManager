// The TRUSTED way into the deep-link handler.
//
// `window.__bmmDeeplink` stays for the callers that are not the app acting for the user
// (a theme's button, the deep-link tester), and it can no longer claim a trusted origin
// (deeplink-guard.ts `windowOrigin`): anything that can name a window function can call it.
//
// The scheduler (a task the user saved) and the local API (a caller holding the token) are
// trusted — no dialog — and reach the handler through this module instead. It is a leaf with
// no imports so both can use it without pulling deep_link_manager.ts (and the plugins page it
// imports) into their own load, and so no cycle appears between them.
//
// Nothing here is on `window`. That is the whole point.

export type TrustedLinkOrigin = 'scheduler' | 'api';
type Dispatch = (url: string, origin: TrustedLinkOrigin) => Promise<void>;

let _dispatch: Dispatch | null = null;

/** Called once by deep_link_manager.initDeepLinks. */
export function setTrustedLinkDispatcher(fn: Dispatch): void { _dispatch = fn; }

/** The handler, or null before initDeepLinks ran (no Tauri, or too early in boot). */
export function trustedLinkDispatcher(): Dispatch | null { return _dispatch; }
