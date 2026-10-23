// nav-grant-review.ts — the review step of a .bmmnav import.
//
// Lists, per imported page, every permission the file asks for with one plain line on what
// it lets the page do, and every site it wants to reach. Nothing starts ticked, and the
// default action is "Grant none": Enter on the opened dialog, Escape, the × and a click on the
// dim all answer "none". Only "Grant selected" applies ticks, and only the ticked items.
//
// The backend enforces the same rules (`page_apply_reviewed_grants`: page still pending,
// items asked for, origins only with `network`); this dialog is where the user decides.

import { t } from '../core/i18n.js';
import { openModal } from './modal-shell.js';
import { uiIcon } from './icons.js';
import type { PendingReview, ReviewAnswer } from './nav-bundle-import.js';

function capLabel(cap: string): string {
    switch (cap) {
        case 'storage': return t('navedit.capStorage') || 'storage';
        case 'notifications': return t('navedit.capNotify') || 'notify';
        case 'network': return t('navedit.capNetwork') || 'internet';
        case 'read': return t('navedit.capRead') || 'app info';
        case 'clipboard': return t('navedit.capClipboard') || 'clipboard';
        case 'system': return t('navedit.capSystem') || 'system info';
        default: return cap;
    }
}

/** What granting it lets the page do, in plain words. */
function capRisk(cap: string): string {
    switch (cap) {
        case 'storage': return t('navedit.riskStorage');
        case 'notifications': return t('navedit.riskNotifications');
        case 'network': return t('navedit.riskNetwork');
        case 'read': return t('navedit.riskRead');
        case 'clipboard': return t('navedit.riskClipboard');
        case 'system': return t('navedit.riskSystem');
        default: return '';
    }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function checkRow(label: string, hint: string, data: Record<string, string>): HTMLLabelElement {
    const row = el('label', 'ngr-item');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = false;
    for (const [k, v] of Object.entries(data)) cb.dataset[k] = v;
    const txt = el('span', 'ngr-item-text');
    txt.appendChild(el('span', 'ngr-item-label', label));
    if (hint) txt.appendChild(el('span', 'ngr-item-hint', hint));
    row.append(cb, txt);
    return row;
}

/**
 * Ask the user. Resolves with page id → ticked items for "Grant selected", or an empty map
 * for "Grant none" and every way of closing the dialog.
 */
export function openGrantReview(pages: PendingReview[]): Promise<Map<string, Partial<ReviewAnswer>>> {
    return new Promise((resolve) => {
        let answered = false;
        const finish = (m: Map<string, Partial<ReviewAnswer>>) => { if (!answered) { answered = true; resolve(m); } };

        const body = el('div', 'ngr-body');
        for (const p of pages) {
            const block = el('section', 'ngr-page');
            block.dataset.page = p.id;
            block.appendChild(el('h3', 'ngr-page-name', p.name));
            for (const cap of p.requested) {
                block.appendChild(checkRow(capLabel(cap), capRisk(cap), { cap }));
            }
            if (p.requestedOrigins.length) {
                const og = el('div', 'ngr-origins');
                og.appendChild(el('p', 'ngr-origins-title', t('navedit.reviewOrigins')));
                for (const o of p.requestedOrigins) og.appendChild(checkRow(o, '', { origin: o }));
                block.appendChild(og);
            }
            if (p.unknown.length) {
                block.appendChild(el('p', 'ngr-unknown', `${t('navedit.reviewUnknown')} ${p.unknown.join(', ')}`));
            }
            body.appendChild(block);
        }

        const footer = el('div');
        const selected = el('button', 'btn btn-secondary ngr-grant-selected', t('navedit.reviewGrantSelected'));
        selected.type = 'button';
        const none = el('button', 'btn btn-primary ngr-grant-none', t('navedit.reviewGrantNone'));
        none.type = 'button';
        footer.append(selected, none);

        const m = openModal({
            id: 'modal-nav-grant-review',
            title: t('navedit.reviewTitle'),
            subtitle: t('navedit.reviewSub'),
            icon: uiIcon('shield', 20),
            tone: 'warn',
            size: 'md',
            className: 'ngr-modal',
            body,
            footer,
            closeLabel: t('navedit.reviewGrantNone'),
            initialFocus: '.ngr-grant-none',
            onClose: () => finish(new Map()),
        });

        none.addEventListener('click', () => { finish(new Map()); m.close(); });
        selected.addEventListener('click', () => {
            const out = new Map<string, Partial<ReviewAnswer>>();
            m.dialog.querySelectorAll<HTMLElement>('.ngr-page').forEach((sec) => {
                const caps = Array.from(sec.querySelectorAll<HTMLInputElement>('input[data-cap]:checked')).map(i => i.dataset.cap!);
                const origins = Array.from(sec.querySelectorAll<HTMLInputElement>('input[data-origin]:checked')).map(i => i.dataset.origin!);
                out.set(sec.dataset.page!, { caps, origins });
            });
            finish(out);
            m.close();
        });
    });
}
