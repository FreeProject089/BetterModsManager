// Tutorial catalogues: follow a catalog.json, install .bmmtut files from it.
//
// SAME CONTRACT AS EVERY OTHER CATALOGUE IN BMM
//
// A source is a URL to a catalog.json whose entries carry `{ id, name, description?, url }`
// under `tutorials:[]` (or a generic `items:[]` with kind==='tutorial' — the shape BCWEB's
// pooled catalogues emit). Fetching goes through fetchSourceText so ssh:// sources work, and
// the protected-source fold is mounted here like everywhere: a download password and a
// signed identity key, per origin. Installing = fetching the .bmmtut and handing it to the
// same import path a file picker uses, signature verdict included.
//
// The followed list lives in localStorage under its own key — these are ADDRESSES, not
// secrets, the same storage decision every other catalogue screen already made.

import { t } from '../core/i18n.js';
import { toast } from './app.js';
import { sourceAccessHtml, wireSourceAccess, closeOwningOverlay } from '../core/source-access.js';
import { fetchSourceText } from '../core/source-fetch.js';
import { importCustomTutorialText, signatureLabel } from './tutorial-custom.js';
import { escHtml, escAttr } from '../core/utils.js';

const STORE = 'bmm.tutorialCatalogs';

interface CatalogEntry { id: string; name: string; description?: string; url: string }

function sources(): string[] {
    try {
        const v = JSON.parse(localStorage.getItem(STORE) || '[]');
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch { return []; }
}
function saveSources(list: string[]): void {
    try { localStorage.setItem(STORE, JSON.stringify([...new Set(list)])); } catch { /* full */ }
}

/** Entries out of one fetched catalogue document, tolerant of the two shapes in the wild. */
function entriesOf(doc: unknown): CatalogEntry[] {
    const d = doc as { tutorials?: unknown[]; items?: Array<{ kind?: string }> };
    const raw = Array.isArray(d?.tutorials)
        ? d.tutorials
        : Array.isArray(d?.items) ? d.items.filter((x) => String(x?.kind || '').toLowerCase() === 'tutorial') : [];
    return (raw as Array<Record<string, unknown>>)
        .map((x) => ({
            id: String(x.id || ''),
            name: String(x.name || x.id || ''),
            description: typeof x.description === 'string' ? x.description : '',
            url: String(x.url || (x.meta as Record<string, unknown> | undefined)?.download_url || ''),
        }))
        .filter((x) => x.id && x.url);
}

export function openTutorialCatalog(onInstalled: () => void): void {
    document.querySelectorAll('.tutcat-overlay').forEach((n) => n.remove());
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay tutcat-overlay open';

    let results: Array<{ source: string; entries: CatalogEntry[]; error?: string }> = [];
    let loading = false;

    const paint = () => {
        overlay.innerHTML = `
      <div class="tutcat-panel">
        <div class="tutc-head">
          <h2 class="tutc-title">${escHtml(t('tutcat.title'))}</h2>
          <button type="button" class="modal-close" data-close>×</button>
        </div>
        <p class="tutcat-lede">${escHtml(t('tutcat.desc'))}</p>
        <div class="tutcat-addrow">
          <input type="text" class="input input-sm" id="tutcat-url" placeholder="https://…/catalog.json" spellcheck="false">
          <button type="button" class="btn btn-sm btn-accent" id="tutcat-follow">${escHtml(t('tutcat.follow'))}</button>
        </div>
        ${sourceAccessHtml('tutcat')}
        <div class="tutcat-sources">
          ${sources().map((u) => `
            <span class="tutcat-chip" title="${escAttr(u)}">${escHtml(u.length > 42 ? u.slice(0, 40) + '…' : u)}
              <button type="button" class="tutcat-drop" data-url="${escAttr(u)}" title="${escAttr(t('tutcat.unfollow'))}">×</button>
            </span>`).join('')}
          ${sources().length ? '' : `<span class="tutcat-none">${escHtml(t('tutcat.noSources'))}</span>`}
        </div>
        <div class="tutcat-list">
          ${loading ? `<div class="tutcat-none">${escHtml(t('common.loading'))}</div>` : results.map((r) => r.error
            ? `<div class="tutcat-err">${escHtml(r.source)}: ${escHtml(r.error)}</div>`
            : r.entries.map((e) => `
              <div class="tutcat-item">
                <div class="tutcat-item-mid">
                  <div class="tutcat-item-name">${escHtml(e.name)}</div>
                  ${e.description ? `<div class="tutcat-item-desc">${escHtml(e.description)}</div>` : ''}
                </div>
                <button type="button" class="btn btn-sm btn-accent tutcat-install"
                        data-url="${escAttr(e.url)}" data-src="${escAttr(r.source)}">${escHtml(t('tutcat.install'))}</button>
              </div>`).join('')).join('')}
        </div>
      </div>`;
        wire();
    };

    const refresh = async () => {
        loading = true;
        paint();
        results = [];
        for (const source of sources()) {
            try {
                const sep = source.includes('?') ? '&' : '?';
                const raw = await fetchSourceText(`${source}${sep}t=${Date.now()}`);
                const entries = entriesOf(JSON.parse(raw));
                results.push({ source, entries, ...(entries.length ? {} : { error: t('tutcat.empty') }) });
            } catch (e) {
                results.push({ source, entries: [], error: String(e).slice(0, 120) });
            }
        }
        loading = false;
        paint();
    };

    function wire(): void {
        overlay.querySelector('[data-close]')?.addEventListener('click', () => overlay.remove());
        wireSourceAccess('tutcat', (m, k) => toast(m, k === 'warning' ? 'warning' : 'success'),
            () => {
                closeOwningOverlay(overlay);
                (document.getElementById('nav-settings') as HTMLElement | null)?.click();
                setTimeout(() => document.getElementById('settings-identity-card')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
            },
            () => (overlay.querySelector('#tutcat-url') as HTMLInputElement | null)?.value?.trim() || '');

        overlay.querySelector('#tutcat-follow')?.addEventListener('click', () => {
            const url = (overlay.querySelector('#tutcat-url') as HTMLInputElement | null)?.value?.trim();
            if (!url) return;
            saveSources([...sources(), url]);
            void refresh();
        });
        overlay.querySelectorAll('.tutcat-drop').forEach((b) => b.addEventListener('click', () => {
            saveSources(sources().filter((u) => u !== (b as HTMLElement).dataset.url));
            void refresh();
        }));
        overlay.querySelectorAll('.tutcat-install').forEach((b) => b.addEventListener('click', async () => {
            const btn = b as HTMLButtonElement;
            const raw = btn.dataset.url || '';
            // Relative to its catalogue, so a catalogue and its files move hosts together.
            const url = /^[a-z]+:\/\//i.test(raw) ? raw : new URL(raw, btn.dataset.src).toString();
            btn.disabled = true;
            try {
                const text = await fetchSourceText(url);
                const res = await importCustomTutorialText(text);
                const sig = signatureLabel(res.signature);
                toast(`${t('tuthub.imported')} — ${sig.text}`, sig.tone === 'err' ? 'warning' : 'success');
                onInstalled();
            } catch (e) {
                toast(String(e).slice(0, 160), 'error');
            } finally {
                btn.disabled = false;
            }
        }));
    }

    // ATTACH FIRST. paint() ends in wire(), and wire() calls wireSourceAccess('tutcat'),
    // which finds its controls with document.getElementById — on a detached overlay those ids
    // are not in the document yet, wiring bails out, and the protected-source fold ships with
    // an unfilled key list and a dead "manage keys" button. The exact bug the automations
    // catalogue had, reproduced here by writing the same two lines in the same wrong order.
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    (document.getElementById('app-window-outer') || document.body).append(overlay);
    paint();
    if (sources().length) void refresh();
}
