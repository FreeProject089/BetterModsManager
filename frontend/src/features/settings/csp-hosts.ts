// What BMM actually connects to, and the CSP that allows exactly that and nothing else.
//
// Settings → Security shipped a "network" CSP preset written as a literal string:
//
//     connect-src 'self' … https://bettercommunity.ch https://api.github.com https://raw.githubusercontent.com
//
// An extra policy can only tighten (the browser intersects the two), so that list is not a
// suggestion — it is the complete set of hosts the app is still allowed to reach. It had
// drifted from the app, and every omission is a feature that stops working with no error
// anywhere, because a CSP violation is a console message in an app nobody has a console for:
//
//   • `https://telemetry.bettercommunity.ch` — the session-end packet goes out through
//     `navigator.sendBeacon`, which connect-src governs. Telemetry silently half-dies.
//   • `https://app.betahub.io` — bug reports are a direct webview fetch. Reporting a bug
//     stops working, which is also how you would have found out.
//   • The offline probes (`gstatic.com`, `cloudflare.com`). Both blocked ⇒ every probe
//     fails ⇒ the app decides it is offline and shows the banner for ever, online.
//   • A SELF-HOSTED or test BetterCommunity. `bcRoot()` exists precisely so the base can be
//     moved; the literal cannot follow it, so the preset cuts you off from your own server.
//
// So the list is DERIVED from the same links registry the app resolves its endpoints from,
// which makes it correct by construction and keeps it correct when BCWEB moves. The literal
// stays only as the last-resort fallback for the moment before links.json has loaded.
//
// Scope, deliberately: only what the WEBVIEW requests. Anything that goes out through the
// Rust side (`invoke`) — Server-Repo sync, catalog installs, the notification poller,
// analytics_flush — is not subject to a page CSP at all, and listing those hosts here would
// promise a control this policy does not have.
import type { BmmLinks } from '../../core/links-config.js';

/** Where a connection goes, and which part of the app needs it. */
export interface Connection {
    /** `scheme://host[:port]`, the form a CSP source expects. */
    origin: string;
    /** Translation keys describing what uses it — a LIST, because one origin serves several
      *  things and `t()` resolves one key, not a comma-joined string of them. Written as a
      *  string first: the panel then printed `csp.use.bc, csp.use.catalog, csp.use.updates`
      *  in place of a sentence, on the row for bettercommunity.ch. */
    whatKeys: string[];
    group: 'bc' | 'code' | 'support' | 'net';
}

/** `scheme://host[:port]` for an http(s) URL; '' for anything else (relative, data:, empty). */
export function originOf(url: string): string {
    const s = String(url || '').trim();
    if (!/^https?:\/\//i.test(s)) return '';
    try {
        const u = new URL(s);
        return u.origin;
    } catch { return ''; }
}

/** The hosts the offline detector probes. Blocked ⇒ BMM believes it is offline. */
export const PROBE_ORIGINS = ['https://www.gstatic.com', 'https://cloudflare.com'];

/** Bug reports (BetaHub) — a direct webview fetch, not an invoke. */
export const BETAHUB_ORIGIN = 'https://app.betahub.io';

/** Sources every build needs regardless of configuration: itself, the IPC bridge, and BMM's
 *  own local API server (the deep-link handler talks to it over 127.0.0.1). */
export const LOCAL_SOURCES = ["'self'", 'ipc:', 'tauri:', 'http://127.0.0.1:*', 'http://localhost:*'];

/**
 * Every origin the webview reaches, with what needs it.
 *
 * `bcRoot` is passed in rather than imported so this stays a pure function of its inputs —
 * that is what lets a test assert "a self-hosted base ends up in the policy" without a
 * running app, which is the case the literal preset got wrong.
 */
export function connections(links: Partial<BmmLinks>, bcRoot: string): Connection[] {
    const out: Connection[] = [];
    const add = (url: string, whatKey: string, group: Connection['group']) => {
        const o = originOf(url);
        if (!o) return;
        const seen = out.find((c) => c.origin === o);
        // One origin, one row: bettercommunity.ch serves half this list, and printing it
        // eight times would bury the two entries that are not it.
        if (seen) { if (!seen.whatKeys.includes(whatKey)) seen.whatKeys.push(whatKey); return; }
        out.push({ origin: o, whatKeys: [whatKey], group });
    };

    add(bcRoot, 'csp.use.bc', 'bc');
    add(links.analytics_endpoint || '', 'csp.use.telemetry', 'bc');
    // Catalogs may be a single URL or an array — catalogSources() flattens them for the app,
    // and a policy that only allowed the first entry would break the rest.
    for (const key of ['plugin_catalog', 'apps_catalog', 'preset_catalog', 'theme_catalog',
        'automation_catalog', 'tutorial_catalog', 'catalog_index', 'server_browse', 'contributors'] as const) {
        const v = links[key] as unknown;
        for (const u of Array.isArray(v) ? v : [v]) add(String(u || ''), 'csp.use.catalog', 'code');
    }
    add(links.autoupdate_api || '', 'csp.use.updates', 'code');
    add(links.autoupdate_api_fallback || '', 'csp.use.updates', 'code');
    add(BETAHUB_ORIGIN, 'csp.use.bugs', 'support');
    for (const p of PROBE_ORIGINS) add(p, 'csp.use.probe', 'net');
    return out;
}

/**
 * The tightening policy for those connections.
 *
 * `object-src 'none'` and `base-uri 'self'` ride along because they cost nothing and close
 * two injection routes the shipped policy leaves open — they were in the literal preset and
 * there is no reason to lose them.
 *
 * Image hosts are NOT restricted here. Flag icons come from flagcdn.com, mod and profile art
 * can come from anywhere a catalogue points at, and a connect-src mistake shows up as a
 * feature that stopped working while an img-src mistake shows up as every icon in the app
 * disappearing. Tightening what the app *talks to* is the part worth having.
 */
export function networkPolicy(conns: Connection[]): string {
    const origins = conns.map((c) => c.origin);
    const src = [...LOCAL_SOURCES, ...origins].join(' ');
    return `connect-src ${src}; object-src 'none'; base-uri 'self'`;
}

/** The whole thing, for the preset button. */
export function networkPolicyFor(links: Partial<BmmLinks>, bcRoot: string): string {
    return networkPolicy(connections(links, bcRoot));
}
