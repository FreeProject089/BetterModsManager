// report-history-model.ts — the pure half of Settings → Feedback → "My recent reports".
//
// Import-free on purpose, so tests/feedback-no-betahub.test.mjs can load it in node without a
// DOM or a Tauri bridge. The DOM half is report-history.ts.
//
// The list lives in localStorage (`bmm_report_history`), written by the feedback dialog after a
// report was accepted. Entries written before 2026-09-25 may say `source: 'betahub'`: that
// client is gone, and so is any page to send the reader to, so such an entry keeps its row
// (the person may still want the id) but loses its link.

export type HistoryType = 'bug' | 'feedback';

export interface HistoryItem {
    id: string;
    type: HistoryType;
    title: string;
    /** 'bc' for the BetterCommunity feedback centre; anything else is a legacy entry. */
    source: string;
    date: string;
}

export const HISTORY_KEY = 'bmm_report_history';
/** Rows shown before "View older". */
export const HISTORY_PAGE = 5;

/** Whatever localStorage held, as a list of well-formed entries. Never throws. */
export function parseHistory(raw: string | null | undefined): HistoryItem[] {
    let v: unknown;
    try { v = JSON.parse(raw || '[]'); } catch { return []; }
    if (!Array.isArray(v)) return [];
    const out: HistoryItem[] = [];
    for (const x of v) {
        if (!x || typeof x !== 'object') continue;
        const o = x as Record<string, unknown>;
        const type = o.type === 'feedback' ? 'feedback' : o.type === 'bug' ? 'bug' : null;
        if (!type) continue;
        out.push({
            id: String(o.id ?? ''),
            type,
            title: String(o.title ?? ''),
            source: String(o.source ?? ''),
            date: String(o.date ?? ''),
        });
    }
    return out;
}

/** The rows of one tab, and whether older ones are hidden behind "View older". */
export function historyPage(items: HistoryItem[], tab: HistoryType, showAll: boolean): { shown: HistoryItem[]; hasOlder: boolean } {
    const all = items.filter((i) => i.type === tab);
    return { shown: showAll ? all : all.slice(0, HISTORY_PAGE), hasOlder: !showAll && all.length > HISTORY_PAGE };
}

/** Where "view" goes: the BetterCommunity dashboard for a report sent there, nowhere otherwise. */
export function historyLink(item: HistoryItem, feedbackWeb: string): string {
    if (item.source !== 'bc') return '';
    return /^https?:\/\//i.test(feedbackWeb) ? feedbackWeb : '';
}

/** The list without one entry (the delete button). */
export function withoutItem(items: HistoryItem[], id: string, type: string): HistoryItem[] {
    return items.filter((i) => !(i.id === String(id) && i.type === type));
}

/** Text for innerHTML: a title is whatever the person typed, an id whatever a server answered. */
export function escHtml(s: unknown): string {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
