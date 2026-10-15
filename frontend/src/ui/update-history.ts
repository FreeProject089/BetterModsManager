// update-history.ts — the « Versions » tab of the release-notes window (ui/update-notes.ts).
//
// The window used to open on a file tree of everything under Update/: changelogs, release
// notes, PTB notes, guides and reference documents, all as files. Reading « what changed in
// each version » meant knowing which file was which. This tab is that question answered: one
// row per version, newest first, the installed one marked, with what each brought (new,
// improved, fixed) counted from its headings, and its notes beside it.
//
// The notes come from files in Update/ and are rendered by B.MD's SAFE path
// (renderDocMarkdown without `trusted`: sanitised, no raw HTML), then hydrated like every md-lite
// surface. The documents tree stays, as the « Documents » tab, unchanged.
//
// One file per version is shown: the changelog when there is one, else the release notes, else
// the GitHub release text, else the PTB notes. The others for that version are linked.

import { invoke } from '../core/api.js';
import { t } from '../core/i18n.js';
import { escHtml, escAttr } from '../core/utils.js';
import { uiIcon } from './icons.js';
import { groupVersions, kindOf, cmpVersion, type NoteFile, type Version } from './update-history-model.js';

export type { NoteFile } from './update-history-model.js';

const CSS_ID = 'update-history-css';

function ensureCss(): void {
    if (document.getElementById(CSS_ID)) return;
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = 'css/update-history.css';
    document.head.appendChild(link);
}

const BADGE = /\[(NEW|NOUVEAU|IMPROVED|AMÉLIORÉ|FIXED|FIXÉ|REFINE|RAFFINEMENT|VISUAL|VISUEL|MAJOR|MAJEUR)\]/g;
const BADGE_CLASS: Record<string, [string, string]> = {
    NEW: ['new', 'update.badge.new'], NOUVEAU: ['new', 'update.badge.new'],
    IMPROVED: ['improved', 'update.badge.improved'], 'AMÉLIORÉ': ['improved', 'update.badge.improved'],
    FIXED: ['fixed', 'update.badge.fixed'], 'FIXÉ': ['fixed', 'update.badge.fixed'],
    REFINE: ['refine', 'update.badge.refine'], RAFFINEMENT: ['refine', 'update.badge.refine'],
    VISUAL: ['visual', 'update.badge.visual'], VISUEL: ['visual', 'update.badge.visual'],
    MAJOR: ['major', 'update.badge.major'], MAJEUR: ['major', 'update.badge.major'],
};

/** The notes through B.MD's safe path; the `[NEW]` tags of the headings become badges. */
async function renderNotes(host: HTMLElement, md: string): Promise<void> {
    try {
        const [{ renderDocMarkdown }, { hydrateMdLite }] = await Promise.all([import('../docs/md-lite.js'), import('../docs/md-hydrate.js')]);
        // The badges are our own fixed markup put in AFTER the sanitiser, in place of fixed text.
        host.innerHTML = renderDocMarkdown(md).replace(BADGE, (m, tag) => {
            const b = BADGE_CLASS[tag];
            return b ? `<span class="md-badge md-badge-${b[0]}">${escHtml(t(b[1]))}</span>` : m;
        });
        hydrateMdLite(host);
    } catch {
        host.textContent = md;
    }
}

export interface VersionHistory { showTab: (tab: 'versions' | 'docs') => void }

/**
 * Fill `.un-versions` inside the window and wire the tabs. `openDoc(path)` opens a file in the
 * Documents tab (the sidebar's own click handler).
 */
export async function mountVersionHistory(modal: HTMLElement, notes: NoteFile[], openDoc: (path: string) => void): Promise<VersionHistory> {
    ensureCss();
    const versions = groupVersions(notes);
    let installed = '';
    try { installed = String(await invoke('get_app_version') || ''); } catch { installed = ''; }
    const listEl = modal.querySelector('#un-vlist') as HTMLElement | null;
    const notesEl = modal.querySelector('#un-vnotes') as HTMLElement | null;
    const search = modal.querySelector('#un-vsearch') as HTMLInputElement | null;
    let sel = versions.find((v) => v.version === installed)?.version || versions[0]?.version || '';
    let query = '';

    const showTab = (tab: 'versions' | 'docs') => {
        modal.querySelectorAll<HTMLElement>('[data-un-tab]').forEach((b) => {
            const on = b.dataset.unTab === tab;
            b.setAttribute('aria-selected', String(on));
            b.tabIndex = on ? 0 : -1;
        });
        modal.querySelectorAll<HTMLElement>('[data-un-panel]').forEach((p) => { p.hidden = p.dataset.unPanel !== tab; });
    };

    const kindLabel = (k: Version['kind']) => t(k === 'changelog' ? 'update.kind.changelog' : k === 'release' ? 'update.kind.release' : k === 'github' ? 'update.kind.github' : 'update.kind.ptb');
    const chips = (c: Version['counts']) => [
        c.added ? `<span class="un-count is-new">${escHtml(t('update.countNew', { n: String(c.added) }))}</span>` : '',
        c.improved ? `<span class="un-count is-improved">${escHtml(t('update.countImproved', { n: String(c.improved) }))}</span>` : '',
        c.fixed ? `<span class="un-count is-fixed">${escHtml(t('update.countFixed', { n: String(c.fixed) }))}</span>` : '',
    ].join('');

    const renderList = () => {
        if (!listEl) return;
        const shown = versions.filter((v) => !query || v.version.includes(query) || v.main.content.toLowerCase().includes(query));
        if (!shown.length) {
            listEl.innerHTML = `<p class="un-empty">${escHtml(versions.length ? t('update.noMatch') : t('update.noVersions'))}</p>`;
            return;
        }
        listEl.innerHTML = shown.map((v) => {
            const state = installed && v.version === installed ? 'installed' : installed && cmpVersion(v.version, installed) > 0 ? 'newer' : '';
            return `<button type="button" class="un-vrow${v.version === sel ? ' is-sel' : ''}" role="option" aria-selected="${v.version === sel}" data-version="${escAttr(v.version)}">
                <span class="un-dot${state ? ` is-${state}` : ''}" aria-hidden="true"></span>
                <span class="un-vmain">
                    <span class="un-vtop"><span class="un-vnum">${escHtml(v.version)}</span>
                        ${state === 'installed' ? `<span class="un-tag is-installed">${escHtml(t('update.installedTag'))}</span>` : state === 'newer' ? `<span class="un-tag is-newer">${escHtml(t('update.newerTag'))}</span>` : ''}</span>
                    <span class="un-vkind">${escHtml(kindLabel(v.kind))}</span>
                    <span class="un-counts">${chips(v.counts)}</span>
                </span>
            </button>`;
        }).join('');
    };

    const renderSel = async () => {
        if (!notesEl) return;
        const v = versions.find((x) => x.version === sel);
        if (!v) { notesEl.innerHTML = `<p class="un-empty">${escHtml(t('update.noVersions'))}</p>`; return; }
        notesEl.innerHTML = `<header class="un-nhead">
                <span class="un-nver">${escHtml(t('update.versionN', { v: v.version }))}</span>
                <span class="un-vkind">${escHtml(kindLabel(v.kind))}</span>
                <button type="button" class="btn btn-ghost btn-xs un-open-doc" data-un-doc="${escAttr(v.main.path)}">${uiIcon('file', 12)}<span>${escHtml(t('update.openFile'))}</span></button>
            </header>
            ${v.others.length ? `<div class="un-others"><span>${escHtml(t('update.alsoFor'))}</span>${v.others.map((o) => `<button type="button" class="btn btn-ghost btn-xs" data-un-doc="${escAttr(o.path)}">${escHtml(kindLabel(kindOf(o.filename)!))}</button>`).join('')}</div>` : ''}
            <div class="dh-content un-md"></div>`;
        notesEl.scrollTop = 0;
        await renderNotes(notesEl.querySelector('.un-md') as HTMLElement, v.main.content);
    };

    modal.querySelectorAll<HTMLElement>('[data-un-tab]').forEach((b) => b.addEventListener('click', () => showTab((b.dataset.unTab as 'versions' | 'docs') || 'versions')));
    listEl?.addEventListener('click', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('.un-vrow');
        if (!row?.dataset.version || row.dataset.version === sel) return;
        sel = row.dataset.version;
        renderList();
        void renderSel();
    });
    listEl?.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const rows = [...listEl.querySelectorAll<HTMLElement>('.un-vrow')];
        const at = rows.findIndex((r) => r.dataset.version === sel);
        const next = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (!next) return;
        e.preventDefault();
        next.click();
        (listEl.querySelector('.un-vrow.is-sel') as HTMLElement | null)?.focus();
    });
    notesEl?.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-un-doc]');
        if (!b?.dataset.unDoc) return;
        e.preventDefault();
        e.stopPropagation();
        showTab('docs');
        openDoc(b.dataset.unDoc);
    });
    search?.addEventListener('input', () => { query = search.value.toLowerCase().trim(); renderList(); });

    renderList();
    await renderSel();
    showTab(versions.length ? 'versions' : 'docs');
    return { showTab };
}
