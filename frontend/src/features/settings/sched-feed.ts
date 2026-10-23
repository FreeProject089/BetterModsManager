// The notification steps and the feed trigger — the part with no app in it.
//
// What a webhook step sends, what a Discord or Slack message looks like on the wire, which
// headers are secret, which feed items are new: every one of those is a rule, and a rule that
// lives in scheduler.ts cannot be tested (that module reaches Tauri and the DOM before its first
// statement). So they are here, pure, and tests/sched-notify.test.mjs holds them.
//
// The network itself is not here and not in the webview: the Rust side (commands/sched_net.rs)
// sends, with the private-address guard, the timeout and the size cap that no step can lift.

import { regexProblem } from './regex-budget.js';

/** One feed item, as `sched_feed_fetch` returns it. */
export interface FeedItem { id: string; title: string; link: string; published: string }

/** How many item ids a feed trigger remembers. A feed shows its last 10–50; this is plenty. */
export const FEED_SEEN_CAP = 200;

/**
 * Which items of this poll are new.
 *
 * `seen` undefined means this task has never read the feed: the poll only LEARNS what is there
 * (a baseline) and fires nothing. Otherwise every item whose id was not seen is fresh, newest
 * first as the feed lists them. The returned `seen` is what to remember next — this poll's ids
 * first, then the older ones, capped — so an item that drops off the end of the feed and comes
 * back is still known.
 */
export function newFeedItems(seen: readonly string[] | undefined, items: readonly FeedItem[]): { baseline: boolean; fresh: FeedItem[]; seen: string[] } {
    const ids = items.map((i) => String(i.id || '')).filter(Boolean);
    const next = [...new Set([...ids, ...(seen || [])])].slice(0, FEED_SEEN_CAP);
    if (seen === undefined) return { baseline: true, fresh: [], seen: next };
    const known = new Set(seen);
    const fresh = items.filter((i) => i.id && !known.has(i.id));
    return { baseline: false, fresh, seen: next };
}

/** The variables a fired feed trigger hands the run, as `{event.*}`. */
export function feedEventData(fresh: readonly FeedItem[], url: string): Record<string, string | number> {
    const top = fresh[0];
    return {
        id: top?.id || '', title: top?.title || '', link: top?.link || '', published: top?.published || '',
        count: fresh.length, feed: hostOf(url),
    };
}

/**
 * Header lines, `Name: value` one per line, into a map. Blank lines and `#` comments are
 * skipped; a line without a colon is reported rather than silently dropped (a request that went
 * out without its Authorization line fails later as a 401 that looks like a wrong token).
 */
export function parseHeaderBlock(text: string): { headers: Record<string, string>; bad: string[] } {
    const headers: Record<string, string> = {};
    const bad: string[] = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const at = line.indexOf(':');
        if (at <= 0) { bad.push(line.slice(0, 40)); continue; }
        const name = line.slice(0, at).trim();
        if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) { bad.push(name.slice(0, 40)); continue; }
        headers[name] = line.slice(at + 1).trim();
    }
    return { headers, bad };
}

/** What a secret header looks like in anything shown: the name, never the value. */
export function maskHeaders(headers: Record<string, string>): string {
    return Object.keys(headers).map((k) => `${k}: ••••`).join('\n');
}

/** The host of a URL, lowercased, or '' — what a summary shows instead of a URL that is a secret. */
export function hostOf(url: string): string {
    try { return new URL(String(url || '').trim()).host.toLowerCase(); } catch { return ''; }
}

/** Why this address would be refused before the request (the Rust side decides for good). */
export function webhookUrlProblem(url: string, kind: 'webhook' | 'discord' | 'slack' = 'webhook'): string | null {
    const s = String(url || '').trim();
    if (!s) return 'empty';
    // A {variable} is allowed in a webhook address and resolved at run time: nothing to judge yet.
    if (/\{[^}]+\}/.test(s)) return null;
    let u: URL;
    try { u = new URL(s); } catch { return 'invalid'; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'not-http';
    if (u.username || u.password) return 'credentials';
    const host = u.hostname.toLowerCase();
    if (kind === 'discord') {
        if (u.protocol !== 'https:') return 'not-https';
        if (!['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com'].includes(host) || !u.pathname.startsWith('/api/webhooks/')) return 'not-discord';
    }
    if (kind === 'slack') {
        if (u.protocol !== 'https:') return 'not-https';
        if (host !== 'hooks.slack.com' || !/^\/(services|workflows|triggers)\//.test(u.pathname)) return 'not-slack';
    }
    return null;
}

/** Discord's limit on a message is 2000 characters; a longer one is refused outright. */
export function discordBody(text: string, username?: string): string {
    const content = String(text ?? '').slice(0, 2000);
    const body: Record<string, unknown> = { content, allowed_mentions: { parse: [] } };
    if (username && username.trim()) body.username = username.trim().slice(0, 80);
    return JSON.stringify(body);
}

/** Slack's incoming webhooks take `text`; mrkdwn is on by default there. */
export function slackBody(text: string): string {
    return JSON.stringify({ text: String(text ?? '').slice(0, 40000) });
}

/**
 * The body of a generic webhook. A template is text with `{variables}` already substituted;
 * when the step says it is JSON it must parse, and a template that does not is refused before
 * anything is sent — a half-formed JSON body is a 400 from the server with no hint of why.
 */
export function webhookBody(template: string, format: 'json' | 'text' = 'json'): { body: string; error?: string } {
    const body = String(template ?? '');
    if (format !== 'json' || !body.trim()) return { body };
    try { JSON.parse(body); return { body }; } catch (e) {
        return { body, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Substitute `{variables}` into a JSON template as JSON STRING CONTENT. A value holding a quote
 * or a newline would otherwise break the document — the common case, since what a task sends is
 * usually a message somebody else wrote (a feed title, a log line).
 */
export function jsonTemplate(template: string, lookup: (name: string) => string | undefined): string {
    return String(template ?? '').replace(/\{([A-Za-z_][\w.]*)\}/g, (all, name: string) => {
        const v = lookup(name);
        if (v === undefined) return all;
        return JSON.stringify(String(v)).slice(1, -1);
    });
}

/**
 * Why a field's value would be refused, as an i18n key, or null. The rules the inline
 * validation of the editors uses (blocks and the flow's inspector are the same editor): a
 * `data-validate` attribute on a field names its rule.
 */
export function fieldProblem(rule: string, value: string): string | null {
    const v = String(value ?? '');
    const [kind, arg] = rule.split(':');
    if (kind === 'required') return v.trim() ? null : 'sched.v.required';
    if (kind === 'url') {
        if (!v.trim()) return arg === 'optional' ? null : 'sched.v.required';
        const why = webhookUrlProblem(v, (arg === 'discord' || arg === 'slack') ? arg : 'webhook');
        return why ? 'sched.net.why.' + why : null;
    }
    if (kind === 'json') {
        if (!v.trim()) return null;
        // {variables} are substituted before sending: judge the template with each one
        // replaced by a harmless string, so "text": "{title}" is not refused as a template.
        const probe = v.replace(/\{[A-Za-z_][\w.]*\}/g, 'x');
        try { JSON.parse(probe); return null; } catch { return 'sched.v.json'; }
    }
    if (kind === 'regex') {
        const r = regexProblem(v);
        return r === 'invalid' ? 'sched.v.regexInvalid' : r === 'nested' ? 'sched.v.regexNested' : null;
    }
    if (kind === 'headers') return parseHeaderBlock(v).bad.length ? 'sched.v.headers' : null;
    if (kind === 'int') {
        if (!v.trim()) return null;
        const [lo, hi] = String(arg || '').split('-').map(Number);
        const n = Number(v);
        if (!Number.isInteger(n)) return 'sched.v.int';
        if ((Number.isFinite(lo) && n < lo) || (Number.isFinite(hi) && n > hi)) return 'sched.v.range';
        return null;
    }
    return null;
}
