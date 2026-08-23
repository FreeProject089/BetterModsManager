// @ts-nocheck
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { fetchSourceText } from '../../core/source-fetch.js';
import { sourceAccessHtml, wireSourceAccess } from '../../core/source-access.js';

// Browsing community MODPACK catalogues.
//
// A modpack catalogue is the same idea as a theme catalogue: a feed listing downloadable
// files. It is modelled on that screen deliberately rather than invented — people who have
// followed a theme catalogue already know how this works, and a second set of conventions for
// the same job is a second thing to learn and a second thing to get wrong.
//
// Sources live under the SAME key the catalogue index writes to, so a modpack catalogue
// followed from an index and one pasted here land in one list. That key existing without a
// reader was the thing to avoid: an index that can add modpack catalogues and no screen that
// shows them is data written and never read.

const STORE = 'bmm_modpack_catalogs';

/**
 * How this screen says something happened.
 *
 * Passed in rather than imported from ui/app.ts. The dep-graph gate counts that import as an
 * edge, and ui/app -> profiles -> mods -> modpack-creator -> here -> ui/app closes a cycle.
 * The caller already holds `toast`; handing it over costs one argument and keeps this module
 * independent of the layer above it.
 */
type Toast = (msg: string, kind?: string, ms?: number) => void;
let toast: Toast = () => {};

interface PackEntry {
    id: string;
    name: string;
    description: string;
    author: string;
    version: string;
    url: string;
    tags: string[];
    game: string;
    /** How many mods the pack holds, when the publisher said. */
    mods?: number;
    source: string;
}

export function readModpackCatalogs(): string[] {
    try {
        const v = JSON.parse(localStorage.getItem(STORE) || '[]');
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : [];
    } catch {
        return [];
    }
}

function writeModpackCatalogs(list: string[]): void {
    localStorage.setItem(STORE, JSON.stringify([...new Set(list.map((s) => s.trim()).filter(Boolean))]));
}

/**
 * Read a feed into entries.
 *
 * Anything without a name AND a download URL is dropped rather than shown as a row that
 * cannot be installed. `download_url` and `url` are both accepted because the platform feed
 * emits the first and hand-written ones tend to use the second; refusing one of them would be
 * refusing a feed that is obviously fine.
 */
export function parseModpackFeed(raw: unknown, source = ''): { packs: PackEntry[]; dropped: number } {
    const doc: any = raw;
    const rows: any[] = Array.isArray(doc?.modpacks) ? doc.modpacks : [];
    const packs: PackEntry[] = [];
    let dropped = 0;
    for (const r of rows) {
        const url = String(r?.download_url || r?.url || '').trim();
        const name = String(r?.name || '').trim();
        if (!url || !name) { dropped += 1; continue; }
        packs.push({
            id: String(r?.id || name).trim(),
            name,
            description: String(r?.description || '').trim(),
            author: String(r?.author || '').trim(),
            version: String(r?.version || '').trim(),
            url,
            tags: Array.isArray(r?.tags) ? r.tags.map(String) : [],
            game: String(r?.game || '').trim(),
            mods: Number.isFinite(r?.mods) ? Number(r.mods) : undefined,
            source,
        });
    }
    return { packs, dropped };
}

/** Does this document look like a modpack catalogue? Used to refuse the wrong feed politely. */
export function looksLikeModpackFeed(doc: any): boolean {
    return Array.isArray(doc?.modpacks);
}

let _overlay: HTMLElement | null = null;

/** Open the browser. Fetches every followed source, then draws. */
export async function openModpackCatalog(notify: Toast): Promise<void> {
    toast = notify;
    close();
    const ov = document.createElement('div');
    ov.className = 'modal-overlay open mpc-overlay';
    ov.innerHTML = `
      <div class="mpc-panel">
        <header class="mpc-head">
          <div>
            <h2 class="mpc-h1">${escHtml(t('modpack.cat.title'))}</h2>
            <p class="mpc-sub">${escHtml(t('modpack.cat.sub'))}</p>
          </div>
          <button class="mpc-x" id="mpc-close" aria-label="${escHtml(t('common.close'))}">&times;</button>
        </header>

        <div class="mpc-modes" role="group">
          <button type="button" class="mpc-mode is-on" id="mpc-tab-follow" aria-pressed="true">${escHtml(t('modpack.cat.tabFollow'))}</button>
          <button type="button" class="mpc-mode" id="mpc-tab-build" aria-pressed="false">${escHtml(t('modpack.cat.tabBuild'))}</button>
        </div>

        <section class="mpc-view" id="mpc-view-follow">
          <p class="mpc-lede">${escHtml(t('modpack.cat.desc'))}</p>
          <div class="mpc-row">
            <input type="text" class="input" id="mpc-src" placeholder="https://.../catalogue.cbmp" spellcheck="false">
            <button class="btn btn-sm btn-accent" id="mpc-add">${escHtml(t('common.add'))}</button>
            <button class="btn btn-sm btn-secondary" id="mpc-open">${escHtml(t('modpack.cat.openFile'))}</button>
          </div>
          ${sourceAccessHtml('mpc')}
          <div class="mpc-label">${escHtml(t('modpack.cat.followed'))}</div>
          <div id="mpc-sources" class="mpc-sources"></div>
          <div class="mpc-label">${escHtml(t('modpack.cat.available'))}</div>
          <div id="mpc-list" class="mpc-list"></div>
        </section>

        <section class="mpc-view" id="mpc-view-build" hidden>
          <p class="mpc-lede">${escHtml(t('modpack.cat.build.desc'))}</p>
          <input type="text" class="input" id="mpc-b-name"
                 placeholder="${escHtml(t('modpack.cat.build.namePh'))}" spellcheck="false">
          <div class="mpc-label">${escHtml(t('modpack.cat.build.pick'))}</div>
          <div id="mpc-b-list" class="mpc-list"></div>
          <footer class="mpc-foot">
            <span class="mpc-note">${escHtml(t('modpack.cat.build.oneFile'))}</span>
            <button class="btn btn-sm btn-accent" id="mpc-b-export">${escHtml(t('modpack.cat.build.export'))}</button>
          </footer>
        </section>
      </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);
    _overlay = ov;

    ov.querySelector('#mpc-close')?.addEventListener('click', close);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

    wireSourceAccess('mpc', (m, k) => toast(m, k === 'warning' ? 'warning' : 'success'),
        () => {
            (document.getElementById('nav-settings') as HTMLElement | null)?.click();
            setTimeout(() => document.getElementById('settings-identity-card')
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
        },
        () => (ov.querySelector('#mpc-src') as HTMLInputElement | null)?.value?.trim() || '');

    ov.querySelector('#mpc-open')?.addEventListener('click', async () => {
        const { pickFile } = await import('../../core/api.js');
        const path = await pickFile([{ name: 'BMM modpack catalogue', extensions: ['cbmp'] }]);
        if (!path) return;
        writeModpackCatalogs([...readModpackCatalogs(), path]);
        await refresh();
    });

    ov.querySelector('#mpc-add')?.addEventListener('click', async () => {
        const input = ov.querySelector('#mpc-src') as HTMLInputElement;
        const url = input.value.trim();
        if (!/^https?:\/\//i.test(url) && !/\.cbmp$/i.test(url)) { toast(t('modpack.cat.badUrl'), 'warning'); return; }
        // Checked by SHAPE before it is followed. A URL that answers with a theme catalogue
        // would otherwise be added and then show an empty list, which reads as "the catalogue
        // is empty" rather than "that is not a modpack catalogue".
        try {
            if (/\.cbmp(\?|$)/i.test(url)) {
                // Reading the index IS the check: a file that is not a .cbmp has no
                // catalog.json and says so precisely.
                await invoke('read_modpack_catalog', { source: url });
            } else {
                const doc = JSON.parse(await fetchSourceText(url, true));
                if (!looksLikeModpackFeed(doc)) { toast(t('modpack.cat.notFeed'), 'warning', 7000); return; }
            }
        } catch (e) {
            toast(t('modpack.cat.unreachable'), 'error', 7000);
            return;
        }
        writeModpackCatalogs([...readModpackCatalogs(), url]);
        input.value = '';
        await refresh();
    });

    const showTab = (build: boolean) => {
        (ov.querySelector('#mpc-view-follow') as HTMLElement).hidden = build;
        (ov.querySelector('#mpc-view-build') as HTMLElement).hidden = !build;
        for (const [id, on] of [['mpc-tab-follow', !build], ['mpc-tab-build', build]] as const) {
            const b = ov.querySelector(`#${id}`)!;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        if (build) void renderBuilder(ov);
    };
    ov.querySelector('#mpc-tab-follow')?.addEventListener('click', () => showTab(false));
    ov.querySelector('#mpc-tab-build')?.addEventListener('click', () => showTab(true));

    await refresh();
}

/** `My Great Pack` → `my-great-pack`, so a filled-in URL matches the file you will upload. */
function slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pack';
}

/**
 * The builder: tick the packs, name the catalogue, get ONE file.
 *
 * The first version asked for a download address per pack, because a catalogue was a JSON feed
 * and the packs had to live somewhere else. That is right for themes and plugins, whose
 * payloads are large; it is wrong here, because a `.bmp` is a small signed JSON document. So a
 * publisher was made to upload eleven files and type eleven addresses to distribute something
 * that fits in one — and the screen that asked for it was the screen nobody understood.
 *
 * A `.cbmp` holds the packs. There is nothing to host separately and nothing to type.
 */
async function renderBuilder(ov: HTMLElement): Promise<void> {
    const listEl = ov.querySelector('#mpc-b-list') as HTMLElement;
    let packs: any[] = [];
    try { packs = (await invoke('load_modpacks')) as any[]; } catch { packs = []; }
    if (!packs.length) {
        listEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${escHtml(t('modpack.cat.build.noPacks'))}</span>`;
        return;
    }
    listEl.innerHTML = packs.map((p, i) => `
      <label style="display:flex;align-items:center;gap:8px;min-width:0;cursor:pointer">
        <input type="checkbox" class="mpc-b-pick" data-i="${i}" checked style="flex:0 0 auto">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${escHtml(p.name || '')}</span>
        <span style="flex:0 0 auto;font-size:10px;color:var(--text-muted)">${Array.isArray(p.mods) ? p.mods.length : 0} ${escHtml(t('modpack.cat.mods'))}</span>
      </label>`).join('');

    const exportBtn = ov.querySelector('#mpc-b-export') as HTMLButtonElement | null;
    if (exportBtn && exportBtn.dataset.wired !== '1') {
        exportBtn.dataset.wired = '1';
        exportBtn.addEventListener('click', async () => {
            const name = (ov.querySelector('#mpc-b-name') as HTMLInputElement).value.trim()
                || t('modpack.cat.build.defName');
            const ids: string[] = [];
            listEl.querySelectorAll<HTMLInputElement>('.mpc-b-pick').forEach((box) => {
                if (box.checked) ids.push(packs[Number(box.dataset.i)]?.id);
            });
            if (!ids.filter(Boolean).length) { toast(t('modpack.cat.build.nothing'), 'warning'); return; }
            const { saveFile } = await import('../../core/api.js');
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'modpacks';
            const path = await saveFile({ defaultPath: `${slug}.cbmp`, filters: [{ name: 'BMM modpack catalogue', extensions: ['cbmp'] }] });
            if (!path) return;
            exportBtn.disabled = true;
            try {
                const n = await invoke('export_modpack_catalog', { name, ids: ids.filter(Boolean), destPath: path }) as number;
                toast(t('modpack.cat.build.done').replace('{n}', String(n)), 'success', 7000);
            } catch (e) {
                toast(String(e).startsWith('modpack.cat.errNoPacks') ? t('modpack.cat.build.nothing') : String(e), 'error', 8000);
            } finally { exportBtn.disabled = false; }
        });
    }
}

function close(): void {
    _overlay?.remove();
    _overlay = null;
}

async function refresh(): Promise<void> {
    const ov = _overlay;
    if (!ov) return;
    const srcEl = ov.querySelector('#mpc-sources') as HTMLElement;
    const listEl = ov.querySelector('#mpc-list') as HTMLElement;
    const sources = readModpackCatalogs();

    srcEl.innerHTML = sources.length
        ? sources.map((u) => `
            <div style="display:flex;align-items:center;gap:6px;font-size:11px;min-width:0">
              <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted)">${escHtml(u)}</span>
              <button class="btn btn-ghost btn-sm mpc-del" data-url="${escHtml(u)}">${escHtml(t('common.remove'))}</button>
            </div>`).join('')
        : `<span style="font-size:11px;color:var(--text-muted)">${escHtml(t('modpack.cat.none'))}</span>`;
    srcEl.querySelectorAll('.mpc-del').forEach((b) => b.addEventListener('click', async () => {
        writeModpackCatalogs(readModpackCatalogs().filter((x) => x !== (b as HTMLElement).dataset.url));
        await refresh();
    }));

    listEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${escHtml(t('modpack.cat.loading'))}</span>`;

    // Each source is fetched independently and its own failure stays its own: one unreachable
    // catalogue used to be able to empty the whole list, which looks like everything broke.
    const results = await Promise.all(sources.map(async (u) => {
        try {
            // A .cbmp carries its packs; a .json feed points at them. Told apart by the
            // suffix rather than by trying one and falling back, because "that was not a zip"
            // and "that server is down" both arrive as a thrown error and only one of them
            // is worth retrying differently.
            if (/\.cbmp(\?|$)/i.test(u)) {
                const cat = await invoke('read_modpack_catalog', { source: u }) as any;
                return (cat?.modpacks || []).map((m: any) => ({
                    id: String(m.id || ''), name: String(m.name || ''),
                    description: String(m.description || ''), author: '',
                    version: String(m.version || ''),
                    // The zip ENTRY, not a URL. install() branches on which it got.
                    url: String(m.file || ''), tags: [], game: '',
                    mods: Number.isFinite(m.mods) ? m.mods : undefined,
                    source: u,
                }));
            }
            return parseModpackFeed(JSON.parse(await fetchSourceText(u, true)), u).packs;
        } catch { return null; }
    }));
    const failed = results.filter((r) => r === null).length;
    const packs = results.flatMap((r) => r || []);

    if (!packs.length) {
        listEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${escHtml(
            failed ? t('modpack.cat.allFailed') : t('modpack.cat.empty'))}</span>`;
        return;
    }

    listEl.innerHTML = packs.map((p, i) => `
      <div class="mpc-row" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bmm-s03);min-width:0">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.name)}${p.version ? ` <span style="font-weight:400;color:var(--text-muted);font-size:11px">v${escHtml(p.version)}</span>` : ''}</div>
          <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.description || p.author || '')}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${
              [p.author && `${escHtml(t('modpack.cat.by'))} ${escHtml(p.author)}`,
               p.game && escHtml(p.game),
               p.mods !== undefined && `${p.mods} ${escHtml(t('modpack.cat.mods'))}`,
              ].filter(Boolean).join(' · ')}</div>
        </div>
        <button class="btn btn-sm btn-accent mpc-install" data-i="${i}">${escHtml(t('modpack.cat.install'))}</button>
      </div>`).join('');

    if (failed) {
        listEl.insertAdjacentHTML('beforeend',
            `<span style="font-size:11px;color:var(--bmm-warning)">${escHtml(
                t('modpack.cat.someFailed').replace('{n}', String(failed)))}</span>`);
    }

    listEl.querySelectorAll('.mpc-install').forEach((b) => b.addEventListener('click', async () => {
        const p = packs[Number((b as HTMLElement).dataset.i)];
        if (!p) return;
        const btn = b as HTMLButtonElement;
        btn.disabled = true;
        try {
            // From inside the .cbmp when that is where it came from, over the network
            // otherwise. `source` is the catalogue, `url` the entry inside it.
            if (/\.cbmp(\?|$)/i.test(p.source || '')) {
                await invoke('install_from_modpack_catalog', { source: p.source, entry: p.url });
            } else {
                await invoke('install_modpack_from_url', { downloadUrl: p.url });
            }
            toast(t('modpack.cat.installed').replace('{name}', p.name), 'success');
            // The list behind this modal is stale the moment a pack lands.
            window.dispatchEvent(new CustomEvent('bmm://modpacks-updated'));
        } catch (e) {
            const raw = String(e);
            toast(raw.startsWith('modpack.errDownload') ? t('modpack.cat.dlFailed') : raw, 'error', 8000);
        } finally {
            btn.disabled = false;
        }
    }));
}
