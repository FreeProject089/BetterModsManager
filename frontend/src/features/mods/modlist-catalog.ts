// Catalogues of shared MOD LISTS.
//
// A `.mm` is the oldest shareable thing in BMM — a named set of mods with their addresses,
// exported from a profile and sent to somebody — and it was the only BMM document with no
// catalogue of its own. Plugins, themes, automations, tutorials and modpacks all had a way
// to publish a set of them and follow somebody else's; mod lists were passed around one
// file at a time.
//
// **It differs from the other builders in one way that shapes this file.** BMM keeps no
// library of mod lists: a `.mm` is written out of the current profile and then belongs to
// the filesystem. So the builder takes FILES the publisher picks rather than rows out of an
// internal store — everything else (embed or link per entry, the bundle, the addresses) is
// the same machinery every other catalogue uses.
//
// The parsing half is pure and takes its source as an argument, so it can be tested without
// a network and without the app around it.

import { invoke, pickFiles, pickFolder, saveFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { toast } from '../../ui/app.js';
import { resolveEntryUrl } from '../../core/catalog-url.js';
import { bundleEntryKind, resolveBundleEntry } from '../../core/catalog-bundle.js';
import { planPublish, safeFileStem, type EntryChoice } from '../../core/catalog-publish.js';
import { fetchSourceText } from '../../core/source-fetch.js';

/** One row of a mod-list catalogue, after sanitising. */
export interface ListEntry {
    id: string;
    name: string;
    description: string;
    author: string;
    /** How many mods it holds, when the publisher said. Undefined is "not stated". */
    mods?: number;
    /** Where the `.mm` is: an http(s) URL, or a path inside an extracted bundle. */
    downloadUrl: string;
    /** True when `downloadUrl` is a file BMM extracted itself. */
    local?: boolean;
    source?: string;
}

const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Does this document claim to be a catalogue of mod lists? */
export function looksLikeListFeed(doc: unknown): boolean {
    return !!doc && typeof doc === 'object' && Array.isArray((doc as Record<string, unknown>).lists);
}

/**
 * Parse a mod-list catalogue.
 *
 * Returns what it could use AND why it dropped the rest — never a bare list, because
 * "3 of 20 loaded" is something the reader has to be told rather than left to notice.
 *
 * @param bundleDir when the catalogue came out of a bundle, the folder it was extracted
 *                  into. Entries naming a file then resolve inside it, through the same
 *                  guard every other catalogue uses.
 */
export function parseListFeed(raw: unknown, source = '', bundleDir = ''): { lists: ListEntry[]; dropped: string[] } {
    const dropped: string[] = [];
    const doc = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
    const rows = Array.isArray(doc.lists) ? doc.lists : [];
    const seen = new Set<string>();
    const lists: ListEntry[] = [];

    for (const e of rows) {
        if (!e || typeof e !== 'object') { dropped.push('not an object'); continue; }
        const addr = str(e.download_url ?? e.downloadUrl ?? e.url, 600);
        const id = str(e.id ?? e.slug, 120);
        const name = str(e.name ?? e.title, 200) || id;
        // A bundle may still point outward, per entry: the small lists travel with it, one
        // that lives on a CDN stays there.
        const inBundle = !!bundleDir && bundleEntryKind(addr) === 'inside';
        const url = inBundle ? resolveBundleEntry(addr, bundleDir) : resolveEntryUrl(addr, source);
        if (!url) { dropped.push(`${name || id || '(unnamed)'} — no usable address`); continue; }
        if (!id) { dropped.push(`${name || '(unnamed)'} — no id`); continue; }
        if (seen.has(id.toLowerCase())) { dropped.push(`${name} — listed twice`); continue; }
        seen.add(id.toLowerCase());
        lists.push({
            id,
            name,
            description: str(e.description, 1000),
            author: str(e.author, 120),
            // Only when it is a real count: a publisher who said nothing has not said zero.
            mods: Number.isFinite(e.mods) && e.mods >= 0 ? Number(e.mods) : undefined,
            downloadUrl: url,
            ...(inBundle ? { local: true } : {}),
            ...(source ? { source } : {}),
        });
    }
    return { lists, dropped };
}

const STORE = 'bmm_list_catalogs';

export function readListCatalogs(): string[] {
    try { const v = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(v) ? v : []; }
    catch { return []; }
}
export function writeListCatalogs(v: string[]): void {
    try { localStorage.setItem(STORE, JSON.stringify([...new Set(v)])); } catch { /* preference only */ }
}

/** Fetch one source, whatever kind of address it is. */
async function loadOne(src: string): Promise<{ lists: ListEntry[]; dropped: string[] }> {
    if (src.startsWith('bundle:')) {
        const res: any = await invoke('catalog_bundle_open', { path: src.slice('bundle:'.length) });
        return parseListFeed(JSON.parse(String(res?.catalog || '')), src, String(res?.dir || ''));
    }
    return parseListFeed(JSON.parse(await fetchSourceText(src, true)), src);
}

/**
 * Publish a catalogue of mod lists.
 *
 * The files are picked, not pulled from a store, because there is no store — a `.mm` lives
 * wherever it was saved. Each one is read once so its own name and mod count can go into the
 * catalogue: an entry that says "47 mods" because somebody typed 47 is a claim; one that
 * says it because the file holds 47 is a fact.
 */
export async function openListCatalogBuilder(): Promise<void> {
    const paths = await pickFiles([{ name: t('mm.cat.kind'), extensions: ['mm', 'json'] }]).catch(() => null);
    if (!paths?.length) return;

    type Row = { path: string; id: string; name: string; description: string; author: string;
                 mods?: number; mode: 'embed' | 'link'; url: string; content: string };
    const rows: Row[] = [];
    const unreadable: string[] = [];
    for (const p of paths) {
        const base = String(p).replace(/^.*[/\\]/, '');
        try {
            const text = await invoke('read_file_text', { path: p }) as string;
            const doc = JSON.parse(text);
            // The shape a .mm has, checked rather than assumed: picking the wrong file in a
            // folder full of JSON is the normal mistake, and publishing it as a mod list
            // would produce a catalogue whose entries install nothing.
            if (!doc || typeof doc !== 'object' || !Array.isArray(doc.mods)) { unreadable.push(base); continue; }
            rows.push({
                path: String(p),
                id: safeFileStem(doc.name || base.replace(/\.[^.]+$/, ''), 'list').toLowerCase(),
                name: String(doc.name || base.replace(/\.[^.]+$/, '')),
                description: String(doc.description || ''),
                author: String(doc.author || ''),
                mods: doc.mods.length,
                mode: 'embed',
                url: '',
                content: text,
            });
        } catch { unreadable.push(base); }
    }
    if (unreadable.length) {
        toast(t('mm.cat.notLists').replace('{list}', unreadable.slice(0, 4).join(', ')), 'warning', 7000);
    }
    if (!rows.length) return;

    const ov = document.createElement('div');
    ov.className = 'modal-overlay open';
    ov.style.zIndex = '11300';
    let name = t('mm.cat.defName');

    const paint = () => {
        const linked = rows.filter((r) => r.mode === 'link').length;
        ov.innerHTML = `
        <div class="modal glass" style="max-width:640px;width:94%;max-height:86vh;display:flex;flex-direction:column">
            <div class="modal-header">
                <h3>${escHtml(t('mm.cat.buildTitle'))}</h3>
                <button class="modal-close" type="button" data-x>&times;</button>
            </div>
            <div class="modal-body" style="flex:1;min-height:0;overflow:auto">
                <label class="sched-label">${escHtml(t('mm.cat.name'))}</label>
                <input class="input" id="mmc-name" value="${escAttr(name)}" style="margin-bottom:12px">
                <label class="sched-tg" style="margin-bottom:10px"><input type="checkbox" id="mmc-bundle"> ${escHtml(t('sched.tcb.bundle'))}</label>
                <div style="display:flex;flex-direction:column;gap:6px">
                    ${rows.map((r, i) => `
                        <div class="cat-pub-row">
                            <span class="cat-pub-pick" style="cursor:default">
                                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${escHtml(r.name)}</span>
                                <span style="flex:0 0 auto;font-size:10px;color:var(--text-muted)">${r.mods ?? 0} ${escHtml(t('modpack.cat.mods'))}</span>
                            </span>
                            <select class="input cat-pub-mode" data-m="${i}">
                                <option value="embed"${r.mode === 'embed' ? ' selected' : ''}>${escHtml(t('catpub.embed'))}</option>
                                <option value="link"${r.mode === 'link' ? ' selected' : ''}>${escHtml(t('catpub.link'))}</option>
                            </select>
                            ${r.mode === 'link' ? `<input class="input cat-pub-url" data-u="${i}" spellcheck="false"
                                   value="${escAttr(r.url)}" placeholder="${escAttr(t('catpub.urlPh'))}">` : ''}
                        </div>`).join('')}
                </div>
            </div>
            <div class="modal-footer">
                <span style="font-size:11px;color:var(--text-muted)">${escHtml(
                    linked ? t('catpub.split').replace('{f}', String(rows.length - linked)).replace('{l}', String(linked))
                           : t('mm.cat.countAll').replace('{n}', String(rows.length)))}</span>
                <div style="flex:1"></div>
                <button class="btn btn-sm btn-ghost" data-x>${escHtml(t('common.cancel'))}</button>
                <button class="btn btn-sm btn-accent" data-go>${escHtml(t('mm.cat.write'))}</button>
            </div>
        </div>`;
        ov.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => ov.remove()));
        (ov.querySelector('#mmc-name') as HTMLInputElement | null)
            ?.addEventListener('input', (e) => { name = (e.target as HTMLInputElement).value; });
        ov.querySelectorAll('[data-m]').forEach((sel) => sel.addEventListener('change', (e) => {
            const el = e.target as HTMLSelectElement;
            rows[Number(el.dataset.m)].mode = el.value === 'link' ? 'link' : 'embed';
            paint();
        }));
        // NOT repainted on input: paint() rebuilds the modal and would take the caret out of
        // the box being typed into.
        ov.querySelectorAll('[data-u]').forEach((box) => box.addEventListener('input', (e) => {
            const el = e.target as HTMLInputElement;
            rows[Number(el.dataset.u)].url = el.value;
        }));
        ov.querySelector('[data-go]')?.addEventListener('click', () => { void write(); });
    };

    const write = async () => {
        const plan = planPublish(rows as any, (r: any) => (r.mode === 'link' ? { mode: 'link', url: r.url } : { mode: 'embed' }),
            { ext: 'mm', fallback: 'list', nameOf: (r: any) => r.name });
        if (plan.errors.length) {
            toast(t('catpub.dropped').replace('{n}', String(plan.errors.length))
                + ' — ' + plan.errors.slice(0, 3).join(' · '), 'warning', 8000);
        }
        if (!plan.rows.length) { toast(t('catpub.nothing'), 'error'); return; }

        const wantBundle = !!(ov.querySelector('#mmc-bundle') as HTMLInputElement | null)?.checked
            && plan.rows.some((p) => p.embed);
        const slug = safeFileStem(name, 'lists');
        let dir: string | null = null;
        let bundleOut = '';
        if (wantBundle) {
            bundleOut = (await saveFile({
                defaultPath: `${slug}.bmmbundle`,
                filters: [{ name: t('catpub.bundleKind'), extensions: ['bmmbundle'] }],
            }).catch(() => null)) as string;
            if (!bundleOut) return;
            dir = (await invoke('catalog_bundle_stage').catch(() => null)) as string;
            if (!dir) { toast(t('catpub.stageFailed'), 'error'); return; }
        } else {
            dir = await pickFolder().catch(() => null);
            if (!dir) return;
        }
        const sep = dir.includes('\\') ? '\\' : '/';

        try {
            for (const p of plan.rows) {
                if (!p.embed) continue;
                // The bytes that were read, not a re-serialisation. A .mm may carry a
                // signature over its own text, and re-encoding it would break that while
                // leaving a file that still parses.
                await invoke('write_text_file', { path: `${dir}${sep}${p.file}`, content: (p.item as any).content });
            }
            const doc = {
                version: '1.0',
                name: name.trim() || t('mm.cat.defName'),
                lists: plan.rows.map((p) => {
                    const r = p.item as any;
                    return {
                        id: r.id, name: r.name, description: r.description, author: r.author,
                        mods: r.mods, download_url: p.address,
                    };
                }),
            };
            await invoke('write_text_file', { path: `${dir}${sep}catalog.json`, content: JSON.stringify(doc, null, 2) });

            if (bundleOut) {
                const res: any = await invoke('catalog_bundle_pack', { dir, out: bundleOut });
                if (res?.missing?.length) {
                    toast(t('plugins.catPackMissing').replace('{n}', String(res.missing.length))
                        .replace('{list}', res.missing.slice(0, 5).join(', ')), 'warning', 7000);
                }
                toast(t('mm.cat.doneBundle').replace('{n}', String(plan.embedded))
                    .replace('{f}', String(bundleOut).replace(/^.*[/\\]/, '')), 'success', 7000);
            } else {
                toast(t('mm.cat.doneFolder').replace('{n}', String(plan.embedded))
                    .replace('{l}', String(plan.linked)), 'success', 7000);
            }
            ov.remove();
        } catch (e) {
            toast(`${t('common.error')}: ${e}`, 'error');
        } finally {
            if (bundleOut && dir) await invoke('catalog_bundle_unstage', { dir }).catch(() => {});
        }
    };

    (document.getElementById('app-window-outer') || document.body).appendChild(ov);
    paint();
}

/**
 * Follow catalogues of mod lists, and open what is in them.
 *
 * Opening an entry hands the `.mm` to the importer that already exists — the same preview,
 * the same per-mod checkboxes, the same install. A catalogue is a way to FIND a list, not a
 * second way to install one.
 */
export async function openListCatalog(onImported: (doc: unknown) => void): Promise<void> {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay open';
    ov.style.zIndex = '11300';
    let entries: ListEntry[] = [];
    let problems: string[] = [];
    let loading = true;

    const paint = () => {
        ov.innerHTML = `
        <div class="modal glass" style="max-width:660px;width:94%;max-height:86vh;display:flex;flex-direction:column">
            <div class="modal-header">
                <h3>${escHtml(t('mm.cat.browseTitle'))}</h3>
                <button class="modal-close" type="button" data-x>&times;</button>
            </div>
            <div class="modal-body" style="flex:1;min-height:0;overflow:auto">
                <div class="cix-add">
                    <input class="input" id="mmc-src" spellcheck="false" placeholder="${escAttr(t('mm.cat.addPh'))}">
                    <button class="btn btn-sm btn-secondary" data-add>${escHtml(t('sched.pc.follow'))}</button>
                    <button class="btn btn-sm btn-ghost" data-bundle>${escHtml(t('sched.pc.openBundle'))}</button>
                </div>
                ${readListCatalogs().length ? `<div class="cix-added">${readListCatalogs().map((u) => `
                    <div class="cix-added-row">
                        <span class="cix-added-url">${escHtml(u.startsWith('bundle:') ? u.slice(7).replace(/^.*[/\\]/, '') : u)}</span>
                        <button type="button" class="btn btn-xs btn-ghost" data-drop="${escAttr(u)}">×</button>
                    </div>`).join('')}</div>` : ''}
                <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">
                    ${loading ? `<span style="font-size:12px;color:var(--text-muted)">${escHtml(t('common.loading'))}</span>`
                      : entries.length ? entries.map((e, i) => `
                        <div class="cat-pub-row" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px">
                            <div style="flex:1;min-width:0">
                                <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(e.name)}</div>
                                <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(e.description || e.author || '')}</div>
                            </div>
                            ${e.mods !== undefined ? `<span style="font-size:10px;color:var(--text-muted);flex:0 0 auto">${e.mods} ${escHtml(t('modpack.cat.mods'))}</span>` : ''}
                            <button class="btn btn-xs btn-accent" data-open="${i}">${escHtml(t('mm.cat.open'))}</button>
                        </div>`).join('')
                      : `<span style="font-size:12px;color:var(--text-muted)">${escHtml(t('mm.cat.empty'))}</span>`}
                </div>
                ${problems.length ? `<details class="sched-tcb-more" style="margin-top:10px">
                    <summary>${escHtml(t('mm.cat.dropped').replace('{n}', String(problems.length)))}</summary>
                    <p class="sched-tcb-hint">${escHtml(problems.slice(0, 8).join(' · '))}</p></details>` : ''}
            </div>
        </div>`;
        ov.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => ov.remove()));
        ov.querySelector('[data-add]')?.addEventListener('click', async () => {
            const box = ov.querySelector('#mmc-src') as HTMLInputElement;
            const url = (box?.value || '').trim();
            if (!/^https?:\/\//i.test(url)) { toast(t('settings.catIndex.addBadUrl'), 'warning'); return; }
            writeListCatalogs([...readListCatalogs(), url]);
            box.value = '';
            await reload();
        });
        ov.querySelector('[data-bundle]')?.addEventListener('click', async () => {
            const { pickFile } = await import('../../core/api.js');
            const path = await pickFile({ filters: [{ name: t('catpub.bundleKind'), extensions: ['bmmbundle', 'zip'] }] });
            if (!path) return;
            try {
                const res: any = await invoke('catalog_bundle_open', { path });
                if (!looksLikeListFeed(JSON.parse(String(res?.catalog || '')))) { toast(t('mm.cat.notFeed'), 'error'); return; }
                writeListCatalogs([...readListCatalogs(), `bundle:${path}`]);
                await reload();
            } catch (e) { toast(`${t('catpub.bundleKind')}: ${e}`, 'error'); }
        });
        ov.querySelectorAll<HTMLElement>('[data-drop]').forEach((b) => b.addEventListener('click', async () => {
            writeListCatalogs(readListCatalogs().filter((u) => u !== b.dataset.drop));
            await reload();
        }));
        ov.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => b.addEventListener('click', async () => {
            const e = entries[Number(b.dataset.open)];
            if (!e) return;
            try {
                // Read from disk when it came out of a bundle, fetched otherwise. Handing a
                // path to the downloader produces an error naming neither the file nor why.
                const text = e.local
                    ? await invoke('read_file_text', { path: e.downloadUrl }) as string
                    : await fetchSourceText(e.downloadUrl, true);
                const doc = JSON.parse(text);
                if (!doc || !Array.isArray(doc.mods)) { toast(t('mm.cat.notAList'), 'error'); return; }
                ov.remove();
                onImported(doc);
            } catch (err) { toast(`${t('common.error')}: ${err}`, 'error'); }
        }));
    };

    const reload = async () => {
        loading = true; paint();
        const all: ListEntry[] = [];
        const bad: string[] = [];
        for (const src of readListCatalogs()) {
            try {
                const r = await loadOne(src);
                all.push(...r.lists);
                bad.push(...r.dropped);
            } catch (e) {
                // Kept ON the source rather than pooled: when one server is down, which one
                // is the useful thing to see.
                bad.push(`${src} — ${String(e).slice(0, 80)}`);
            }
        }
        entries = all; problems = bad; loading = false;
        paint();
    };

    (document.getElementById('app-window-outer') || document.body).appendChild(ov);
    paint();
    await reload();
}
