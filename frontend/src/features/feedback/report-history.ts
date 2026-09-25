// report-history.ts — Settings → Feedback → "My recent reports", the DOM half.
//
// Moved here from the removed BetaHub modals (2026-09-25), which used to own this list even
// though the feedback dialog was the only thing still writing to it. The markup is in
// index.html (#bh-history-*: the ids kept their old prefix because the markup is not ours to
// rename); the logic that decides what is shown is in report-history-model.ts.
import { t } from '../../core/i18n.js';
import { feedbackWebUrl } from './bc-feedback.js';
import { HISTORY_KEY, parseHistory, historyPage, historyLink, withoutItem, escHtml, type HistoryType } from './report-history-model.js';

let tab: HistoryType = 'bug';
let showAll = false;

function read() {
    try { return parseHistory(localStorage.getItem(HISTORY_KEY)); } catch { return []; }
}

/** Wire the buttons once and draw the list. Safe to call again: it only redraws. */
export function initReportHistory(): void {
    const section = document.getElementById('bh-history-section');
    if (section && !section.dataset.wired) {
        section.dataset.wired = '1';
        document.getElementById('bh-history-refresh')?.addEventListener('click', () => { showAll = false; renderReportHistory(); });
        document.getElementById('bh-history-clear')?.addEventListener('click', () => {
            try { localStorage.removeItem(HISTORY_KEY); } catch { /* private mode */ }
            renderReportHistory();
        });
        document.getElementById('bh-history-view-older')?.addEventListener('click', () => { showAll = true; renderReportHistory(); });
        const tabs = section.querySelectorAll<HTMLElement>('.bh-explorer-tabs .bh-tab');
        tabs.forEach((b) => b.addEventListener('click', () => {
            tabs.forEach((x) => x.classList.remove('active'));
            b.classList.add('active');
            tab = b.getAttribute('data-bh-tab') === 'history-feedback' ? 'feedback' : 'bug';
            showAll = false;
            renderReportHistory();
        }));
        document.getElementById('bh-history-list')?.addEventListener('click', (e) => {
            const del = (e.target as Element | null)?.closest<HTMLElement>('.bh-history-del');
            if (!del) return;
            try { localStorage.setItem(HISTORY_KEY, JSON.stringify(withoutItem(read(), del.dataset.id || '', del.dataset.type || ''))); } catch { /* private mode */ }
            renderReportHistory();
        });
    }
    renderReportHistory();
}

export function renderReportHistory(): void {
    const list = document.getElementById('bh-history-list');
    const section = document.getElementById('bh-history-section');
    const older = document.getElementById('bh-history-view-older');
    if (!list || !section) return;

    const items = read();
    if (!items.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';

    const { shown, hasOlder } = historyPage(items, tab, showAll);
    if (older) older.style.display = hasOlder ? 'block' : 'none';
    if (!shown.length) {
        list.innerHTML = `<div class="bh-state">${escHtml(t('feedback.historyEmpty'))}</div>`;
        return;
    }
    const web = feedbackWebUrl();
    list.innerHTML = shown.map((item) => {
        const d = new Date(item.date);
        const date = isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const tone = item.type === 'bug' ? 'var(--bmm-danger)' : 'var(--bmm-success)';
        const icon = item.type === 'bug'
            ? '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>'
            : '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 1 1-7.6-11.7 8.3 8.3 0 0 1 3.2.6"/>';
        const url = historyLink(item, web);
        const link = url
            ? `<a href="${escHtml(url)}" target="_blank" rel="noreferrer" class="bh-history-link" data-tasky="feedback.historyViewTip" style="padding:6px; background:var(--bmm-s05); border-radius:6px; color:var(--bmm-text-secondary); display:flex; align-items:center; justify-content:center; border:1px solid var(--bmm-s05)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`
            : '';
        return `<div style="background:var(--bmm-s03); border:1px solid var(--bmm-s05); border-radius:8px; padding:10px; display:flex; align-items:center; gap:12px">
            <div style="width:28px; height:28px; border-radius:6px; background:color-mix(in srgb, ${tone} 9%, transparent); display:flex; align-items:center; justify-content:center; color:${tone}; flex-shrink:0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">${icon}</svg>
            </div>
            <div style="flex:1; overflow:hidden; display:flex; flex-direction:column; gap:2px">
                <div style="font-size:12px; font-weight:700; color:var(--bmm-text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escHtml(item.title)}</div>
                <div style="font-size:10px; color:var(--bmm-text-muted); display:flex; align-items:center; gap:8px"><span>${escHtml(date)}</span><span style="opacity:0.3">•</span><span style="font-family:monospace; opacity:0.6">ID: ${escHtml(item.id)}</span></div>
            </div>
            ${link}
            <button type="button" class="bh-history-link bh-history-del" data-id="${escHtml(item.id)}" data-type="${escHtml(item.type)}" style="padding:6px; background:color-mix(in srgb, var(--bmm-danger) 5%, transparent); border-radius:6px; color:var(--bmm-danger); display:flex; align-items:center; justify-content:center; border:1px solid color-mix(in srgb, var(--bmm-danger) 10%, transparent); cursor:pointer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg></button>
        </div>`;
    }).join('');
}
