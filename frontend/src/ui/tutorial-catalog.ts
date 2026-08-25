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
import { raiseAboveAll } from './layer.js';
import { invoke } from '../core/api.js';
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


/**
 * Build a catalog.json from the tutorials you have.
 *
 * The catalogue screen could only READ one. This is the other half: pick from your own
 * documents, give the folder they will be served from, and write the file.
 *
 * It does NOT upload anything. A catalogue is a list of addresses, and the .bmmtut files
 * have to be reachable from somewhere — asking for the base URL up front is what stops this
 * writing a document full of links that resolve to nothing.
 */
export async function openTutorialCatalogBuilder(): Promise<void> {
    document.getElementById('tutcat-build')?.remove();

    const { listCustomDocs, getCustomDoc } = await import('./tutorial-custom.js');
    type Row = { id: string; name: string; desc: string; on: boolean };
    // OFF by default. Pre-ticking everything made "build a catalogue" mean "publish every
    // lesson I happen to have", and the only way to publish two was to untick twenty.
    const rows: Row[] = listCustomDocs().map((d) => ({
        id: d.id,
        name: d.title?.en || d.id,
        desc: d.desc?.en || '',
        on: false,
    }));

    const ov = document.createElement('div');
    ov.className = 'modal-overlay open';
    ov.id = 'tutcat-build';
    // Inside the app frame and above whatever opened it. It used to be a flat 11200,
    // which is above ordinary modals and far BELOW the tutorial hub (2000000) this is
    // always opened from — so it painted its dim underneath the hub and looked like the
    // button did nothing. `contain: paint` on the frame is the other half: an overlay on
    // <body> dims the desktop instead of the app.
    raiseAboveAll(ov, 11200);
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = () => {
        document.body.style.overflow = prevOverflow;
        document.removeEventListener('keydown', onKey);
        ov.remove();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey);

    let name = t('tutcat.b.defname') || 'My tutorials';
    let base = '';

    const paint = () => {
        const on = rows.filter((r) => r.on).length;
        ov.innerHTML = `
        <div class="modal glass" style="max-width:640px; width:94%; max-height:86vh; display:flex; flex-direction:column;">
            <div class="modal-header" style="flex-shrink:0;">
                <h3>${escHtml(t('tutcat.b.title') || 'Build a tutorial catalogue')}</h3>
                <button class="modal-close" type="button" data-x>&times;</button>
            </div>
            <div class="modal-body" style="flex:1; min-height:0; overflow:auto;">
                <label class="repo-cat-b-lbl">${escHtml(t('tutcat.b.name') || 'Catalogue name')}</label>
                <input class="input" id="tutcat-b-name" value="${escAttr(name)}" style="margin-bottom:14px;">

                <label class="repo-cat-b-lbl">${escHtml(t('tutcat.b.base') || 'Address the files will be served from (optional)')}</label>
                <input class="input" id="tutcat-b-base" value="${escAttr(base)}" placeholder="${escAttr(t('tutcat.b.basePh') || 'leave empty — they sit beside the catalogue')}" style="margin-bottom:4px;">
                <div class="cat-index-empty" style="margin-bottom:14px;">${escHtml(t('tutcat.b.baseHint')
                    || 'Leave it empty and the tutorials are written next to catalog.json, so you can upload the folder anywhere. Fill it in only if the files will live somewhere else.')}</div>

                <label class="repo-cat-b-lbl">${escHtml(t('tutcat.b.pick') || 'Tutorials to include')}</label>
                ${rows.length ? '' : `<div class="cat-index-empty">${escHtml(t('tutcat.b.none') || 'You have no tutorials of your own yet.')}</div>`}
                <div class="repo-cat-b-list">
                    ${rows.map((r, i) => `
                        <label class="repo-cat-b-row">
                            <input type="checkbox" data-i="${i}" ${r.on ? 'checked' : ''}>
                            <span class="repo-cat-b-name">${escHtml(r.name)}</span>
                            <span class="repo-cat-b-url" title="${escAttr(r.id)}">${escHtml(r.id)}.bmmtut</span>
                        </label>`).join('')}
                </div>
            </div>
            <div class="modal-footer" style="flex-shrink:0;">
                <button class="btn btn-xs" data-all>${escHtml(t('repo.cat.b.all') || 'All')}</button>
                <button class="btn btn-xs" data-none>${escHtml(t('repo.cat.b.none') || 'None')}</button>
                <span style="flex:1"></span>
                <button class="btn btn-primary" data-go ${on ? '' : 'disabled'}>
                    ${escHtml((t('tutcat.b.write') || 'Export the catalogue ({n})').replace('{n}', String(on)))}
                </button>
            </div>
        </div>`;

        ov.querySelector('[data-x]')?.addEventListener('click', close);
        ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
        (ov.querySelector('#tutcat-b-name') as HTMLInputElement | null)
            ?.addEventListener('input', (e) => { name = (e.target as HTMLInputElement).value; });
        (ov.querySelector('#tutcat-b-base') as HTMLInputElement | null)
            ?.addEventListener('input', (e) => { base = (e.target as HTMLInputElement).value; });
        ov.querySelectorAll('[data-i]').forEach((c) => c.addEventListener('change', (e) => {
            rows[Number((e.target as HTMLElement).dataset.i)].on = (e.target as HTMLInputElement).checked;
            paint();
        }));
        ov.querySelector('[data-all]')?.addEventListener('click', () => { rows.forEach((r) => { r.on = true; }); paint(); });
        ov.querySelector('[data-none]')?.addEventListener('click', () => { rows.forEach((r) => { r.on = false; }); paint(); });

        ov.querySelector('[data-go]')?.addEventListener('click', async () => {
            const b = base.trim().replace(/\/+$/, '');
            const chosen = rows.filter((r) => r.on);
            if (!chosen.length) return;

            // A FOLDER, not a filename: this writes catalog.json and one .bmmtut per
            // tutorial, and asking for "catalog.json" would leave the files nowhere.
            const { pickFolder } = await import('../core/api.js');
            const dir = await pickFolder().catch(() => null);
            if (!dir) return;

            // Relative when no address was given. The reader resolves an entry URL against
            // the catalogue's own address, so a folder uploaded as-is works from any host —
            // which is the whole reason the field is optional now.
            const entries = chosen.map((r) => ({
                id: r.id,
                name: r.name,
                description: r.desc,
                url: b ? `${b}/${r.id}.bmmtut` : `${r.id}.bmmtut`,
            }));
            // BOTH shapes, on purpose: `tutorials` is what this app's own reader prefers and
            // `items` with a kind is what BCWEB's pooled catalogues emit. Writing one and not
            // the other makes a catalogue that half the readers cannot see.
            const doc = JSON.stringify({
                name: name.trim() || 'My tutorials',
                generatedAt: new Date().toISOString(),
                tutorials: entries,
                items: entries.map((e) => ({ ...e, kind: 'tutorial' })),
            }, null, 2);

            try {
                // The lessons first. A catalog.json listing files that failed to write is
                // the one outcome worth avoiding — it looks finished and installs nothing.
                const failed: string[] = [];
                for (const r of chosen) {
                    const tut = getCustomDoc(r.id);
                    if (!tut) { failed.push(r.name); continue; }
                    try {
                        await invoke('write_text_file', { path: `${dir}/${r.id}.bmmtut`, content: JSON.stringify(tut, null, 2) });
                    } catch { failed.push(r.name); }
                }
                if (failed.length === chosen.length) { toast(t('tutcat.b.failAll') || 'Could not write the tutorials.', 'error'); return; }

                await invoke('write_text_file', { path: `${dir}/catalog.json`, content: doc });
                // Named, not counted: "wrote 4 of 5" leaves you hunting for which one.
                if (failed.length) {
                    toast((t('tutcat.b.savedPartial') || 'Wrote the catalogue, but these could not be exported: {names}')
                        .replace('{names}', failed.join(', ')), 'warning');
                } else {
                    toast((t('tutcat.b.saved') || 'Wrote catalog.json and {n} tutorial file(s) — upload the folder as it is.')
                        .replace('{n}', String(entries.length)), 'success');
                }
                close();   // NOT ov.remove(): the page would stay locked with the modal gone
            } catch (e) { toast(String(e), 'error'); }
        });
    };

    paint();
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
