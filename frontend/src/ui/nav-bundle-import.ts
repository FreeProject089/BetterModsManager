// nav-bundle-import.ts — what importing a shared .bmmnav does to custom pages, with no DOM.
//
// A .bmmnav carries custom pages (somebody else's HTML/CSS/JS) and, for each one, the
// capabilities and network origins it held on the machine that exported it. The importer
// used to re-grant all of them: `page_set_grant` for every listed capability and
// `page_set_net_origins` for every listed origin, with nothing shown. A shared navbar was
// therefore a way to hand a stranger's script `network` + `clipboard` + `system` without the
// user ever ticking a box.
//
// Here the file's lists are REQUESTS. Each page is created new (`create_imported_custom_page`,
// which records the request and leaves the page with nothing), the user answers a review, and
// only that answer is applied (`page_apply_reviewed_grants`, which the backend accepts only
// for a page still awaiting its review, only for items the file asked for). No path here
// calls `page_set_grant` or `page_set_net_origins`, and no path writes to a page that already
// exists, so re-importing a file cannot raise anyone's grants.
//
// No imports: the tests load the compiled file directly.

/** Every capability a page can hold, in the order the review lists them (mildest first). */
export const PAGE_CAPS: readonly string[] = Object.freeze(['notifications', 'read', 'storage', 'clipboard', 'network', 'system']);

export interface NavBundlePageIn {
    id?: unknown; name?: unknown; html?: unknown; css?: unknown; js?: unknown;
    /** What the page held where it was exported. A REQUEST here, never applied as is. */
    grants?: unknown;
    netOrigins?: unknown;
}

export interface PlannedPage {
    sourceId: string;
    name: string;
    html: string;
    css: string;
    js: string;
    requested: string[];
    /** Listed by the file but not a BMM capability: shown as ignored. */
    unknown: string[];
    requestedOrigins: string[];
}

const str = (v: unknown, max = 5_000_000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Read a bundle's pages as requests. Nothing in the result is a grant. */
export function planNavBundleImport(bundle: { pages?: unknown }): PlannedPage[] {
    const pages = Array.isArray(bundle?.pages) ? (bundle.pages as NavBundlePageIn[]) : [];
    return pages.filter(p => p && typeof p === 'object').map(p => {
        const requested: string[] = [];
        const unknown: string[] = [];
        for (const c of strList(p.grants)) {
            const cap = c.trim();
            if (!cap) continue;
            if (PAGE_CAPS.includes(cap)) { if (!requested.includes(cap)) requested.push(cap); }
            else if (!unknown.includes(cap) && unknown.length < 20) unknown.push(cap.slice(0, 40));
        }
        const requestedOrigins: string[] = [];
        for (const o of strList(p.netOrigins)) {
            const t = o.trim();
            if (t && !requestedOrigins.some(x => x.toLowerCase() === t.toLowerCase()) && requestedOrigins.length < 50) requestedOrigins.push(t.slice(0, 255));
        }
        return {
            sourceId: str(p.id, 200),
            name: str(p.name, 200) || 'Page',
            html: str(p.html), css: str(p.css), js: str(p.js),
            requested: requested.sort((a, b) => PAGE_CAPS.indexOf(a) - PAGE_CAPS.indexOf(b)),
            unknown,
            requestedOrigins,
        };
    });
}

/** One created page waiting for the user's answer: the request as the BACKEND recorded it. */
export interface PendingReview {
    id: string;
    name: string;
    requested: string[];
    requestedOrigins: string[];
    unknown: string[];
}

export interface ReviewAnswer { caps: string[]; origins: string[]; }

/**
 * The answer to apply, from what the user ticked: only items that were asked for, origins only
 * alongside `network`. Anything missing or malformed is "grant none".
 */
export function reviewAnswer(p: Pick<PendingReview, 'requested' | 'requestedOrigins'>, ticked?: Partial<ReviewAnswer> | null): ReviewAnswer {
    const caps = strList(ticked?.caps).filter((c, i, a) => p.requested.includes(c) && a.indexOf(c) === i);
    const origins = caps.includes('network')
        ? strList(ticked?.origins).filter((o, i, a) => p.requestedOrigins.some(r => r.toLowerCase() === o.toLowerCase()) && a.indexOf(o) === i)
        : [];
    return { caps, origins };
}

export interface ImportDeps {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    /** Ask the user. Resolves with page id → ticked items; anything absent is "grant none". */
    review: (pages: PendingReview[]) => Promise<Map<string, Partial<ReviewAnswer>>>;
}

export interface ImportResult {
    /** Source page id in the file → id of the page created here. */
    idMap: Record<string, string>;
    /** What was applied per created page. */
    applied: Record<string, ReviewAnswer>;
    failed: number;
}

/** Create every page of the bundle with nothing, ask once, apply the answer. */
export async function runNavBundleImport(bundle: { pages?: unknown }, deps: ImportDeps): Promise<ImportResult> {
    const idMap: Record<string, string> = {};
    const applied: Record<string, ReviewAnswer> = {};
    const pending: PendingReview[] = [];
    let failed = 0;
    for (const p of planNavBundleImport(bundle)) {
        try {
            const res = await deps.invoke('create_imported_custom_page', {
                name: p.name, html: p.html, css: p.css, js: p.js,
                requested: p.requested, requestedOrigins: p.requestedOrigins,
            }) as { page?: { id?: string }; review?: { requested?: string[]; requestedOrigins?: string[] } };
            const id = res?.page?.id;
            if (!id) { failed++; continue; }
            if (p.sourceId) idMap[p.sourceId] = id;
            pending.push({
                id,
                name: p.name,
                requested: strList(res.review?.requested),
                requestedOrigins: strList(res.review?.requestedOrigins),
                unknown: p.unknown,
            });
        } catch { failed++; }
    }
    const ask = pending.filter(p => p.requested.length || p.requestedOrigins.length);
    let answers = new Map<string, Partial<ReviewAnswer>>();
    if (ask.length) {
        try { answers = await deps.review(ask); } catch { answers = new Map(); }
    }
    for (const p of pending) {
        const ans = reviewAnswer(p, answers.get(p.id));
        try {
            await deps.invoke('page_apply_reviewed_grants', { id: p.id, caps: ans.caps, origins: ans.origins });
            applied[p.id] = ans;
        } catch {
            // Refused: the page stays pending, which the backend treats as holding nothing.
            applied[p.id] = { caps: [], origins: [] };
        }
    }
    return { idMap, applied, failed };
}
