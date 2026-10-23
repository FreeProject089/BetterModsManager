// Reads a .bmmreplay, plain JSON or gzip, in every envelope BMM has written.
//
// Long recordings are stored gzipped under their .bmmreplay name (tools/release/shrink-replays.mjs
// compresses the ones still over the docs budget once their images and pointer noise are gone),
// and the server sends them as plain bytes, not with Content-Encoding: gzip. So the body is
// sniffed: the gzip magic (1f 8b) is inflated with DecompressionStream, anything else is JSON.
// The BMM Docs player (docs/assets/rrweb/bmm-replay.js) reads both forms the same way.
//
// « The .bmmreplay from crash reports and sessions don't work: unreadable. » Every reader of the
// in-app viewer now goes through `parseReplayText` / `parseReplayBytes`, which accept:
//   · the envelope every writer produces now, `{ bmmReplay, …, events: [...] }` (the spool
//     finalize in src-tauri/src/commands/analytics.rs, Replay Studio, the release recorder);
//   · a bare rrweb event array, `events` stored as a JSON string, and the event list under
//     `data` / `replay` / `recording` / `bundle` (older exports);
//   · one event per line (a spool segment copied out by hand);
//   · a recording whose first events are not the Meta + FullSnapshot rrweb needs to start (a
//     recorder joined late): it starts at the first FullSnapshot, with a Meta made up if none.
// And they say WHY a file cannot be played, instead of one « Unreadable file » for everything.

export async function readReplayBody(res: Response): Promise<any> {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return JSON.parse(await new Response(stream).text());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
}

/** rrweb event types used here. */
const META = 4;
const FULL_SNAPSHOT = 2;

export type ReplayProblem = 'parse' | 'empty' | 'noSnapshot';

export type ReplayRead =
    | { ok: true; bundle: { events: any[]; [k: string]: unknown }; repaired: boolean }
    | { ok: false; problem: ReplayProblem; detail: string };

function isEvent(e: unknown): boolean {
    return !!e && typeof e === 'object' && typeof (e as { type?: unknown }).type === 'number';
}

/** The event list of whatever was parsed, and the envelope's other fields. */
function eventsOf(data: unknown): { events: unknown[] | null; rest: Record<string, unknown> } {
    if (Array.isArray(data)) return { events: data, rest: {} };
    if (!data || typeof data !== 'object') return { events: null, rest: {} };
    const o = data as Record<string, unknown>;
    let ev: unknown = o.events;
    if (typeof ev === 'string') { try { ev = JSON.parse(ev); } catch { ev = null; } }
    if (!Array.isArray(ev)) {
        for (const k of ['data', 'replay', 'recording', 'bundle']) {
            const inner = o[k];
            if (inner && typeof inner === 'object') {
                const got = eventsOf(inner);
                if (got.events) return { events: got.events, rest: { ...o, ...got.rest } };
            }
        }
        return { events: null, rest: o };
    }
    return { events: ev, rest: o };
}

/** Normalise a parsed replay: an envelope with a playable `events` array, or why not. */
export function normalizeReplay(data: unknown): ReplayRead {
    const { events: raw, rest } = eventsOf(data);
    if (!raw) return { ok: false, problem: 'parse', detail: 'no event list in this file' };
    const events = raw.filter(isEvent) as Array<{ type: number; timestamp?: number; data?: any }>;
    if (events.length < 2) return { ok: false, problem: 'empty', detail: `${events.length} event(s)` };
    const full = events.findIndex((e) => e.type === FULL_SNAPSHOT);
    if (full < 0) return { ok: false, problem: 'noSnapshot', detail: `${events.length} event(s), none is a full snapshot` };
    let out: any[];
    let repaired: boolean;
    if (full > 0 && events[full - 1].type === META) {
        out = events.slice(full - 1);
        repaired = full - 1 > 0;
    } else {
        // No Meta right before the snapshot: rrweb's Replayer needs one for the viewport.
        const meta = events.find((e) => e.type === META && e.data && e.data.width);
        const at = events[full].timestamp ?? 0;
        out = [{ type: META, timestamp: at, data: meta?.data || { href: '', width: 1280, height: 800 } }, ...events.slice(full)];
        repaired = true;
    }
    if (out.length !== raw.length) repaired = true;
    const bundle: { events: any[]; [k: string]: unknown } = { ...rest, events: out };
    return { ok: true, bundle, repaired };
}

/** Parse the text of a replay file (JSON, or one event per line). */
export function parseReplayText(text: string): ReplayRead {
    const s = String(text ?? '').replace(/^﻿/, '').trim();
    if (!s) return { ok: false, problem: 'empty', detail: 'the file is empty' };
    try {
        return normalizeReplay(JSON.parse(s));
    } catch (e) {
        // One event per line (a spool segment).
        const lines = s.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length > 1) {
            const evs: unknown[] = [];
            for (const l of lines) { try { evs.push(JSON.parse(l)); } catch { /* a cut last line */ } }
            if (evs.length > 1) return normalizeReplay(evs);
        }
        return { ok: false, problem: 'parse', detail: String((e as Error)?.message || e) };
    }
}

/** Parse the bytes of a replay file: gzip inflated, then `parseReplayText`. */
export async function parseReplayBytes(bytes: Uint8Array): Promise<ReplayRead> {
    let text: string;
    try {
        if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
            const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
            text = await new Response(stream).text();
        } else {
            text = new TextDecoder().decode(bytes);
        }
    } catch (e) {
        return { ok: false, problem: 'parse', detail: `the file looks gzipped but does not inflate (${String((e as Error)?.message || e)})` };
    }
    return parseReplayText(text);
}

/** The i18n key of a problem (watcher.*), for the viewer's message. */
export function replayProblemKey(p: ReplayProblem): string {
    return p === 'empty' ? 'watcher.empty' : p === 'noSnapshot' ? 'watcher.noSnapshot' : 'watcher.badFile';
}
