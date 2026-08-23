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
let toast = () => { };
export function readModpackCatalogs() {
    try {
        const v = JSON.parse(localStorage.getItem(STORE) || '[]');
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : [];
    }
    catch {
        return [];
    }
}
function writeModpackCatalogs(list) {
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
export function parseModpackFeed(raw, source = '') {
    const doc = raw;
    const rows = Array.isArray(doc?.modpacks) ? doc.modpacks : [];
    const packs = [];
    let dropped = 0;
    for (const r of rows) {
        const url = String(r?.download_url || r?.url || '').trim();
        const name = String(r?.name || '').trim();
        if (!url || !name) {
            dropped += 1;
            continue;
        }
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
export function looksLikeModpackFeed(doc) {
    return Array.isArray(doc?.modpacks);
}
let _overlay = null;
/** Open the browser. Fetches every followed source, then draws. */
export async function openModpackCatalog(notify) {
    toast = notify;
    close();
    const ov = document.createElement('div');
    ov.className = 'modal-overlay open mpc-overlay';
    ov.innerHTML = `
      <div class="modal" style="max-width:760px;width:92vw">
        <div class="modal-header">
          <h2 class="modal-title" style="margin:0;font-size:1.1rem">${escHtml(t('modpack.cat.title'))}</h2>
          <button class="modal-close" id="mpc-close">&times;</button>
        </div>
        <div class="modal-body" style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
          <p style="font-size:12px;color:var(--text-muted);margin:0">${escHtml(t('modpack.cat.desc'))}</p>
          <div style="display:flex;gap:6px;align-items:center">
            <input type="text" class="input" id="mpc-src" style="flex:1;min-width:0"
                   placeholder="https://.../catalog.json" spellcheck="false">
            <button class="btn btn-sm btn-accent" id="mpc-add">${escHtml(t('common.add'))}</button>
          </div>
          ${sourceAccessHtml('mpc')}
          <div id="mpc-sources" style="display:flex;flex-direction:column;gap:4px"></div>
          <div id="mpc-list" style="display:flex;flex-direction:column;gap:8px"></div>
        </div>
      </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);
    _overlay = ov;
    ov.querySelector('#mpc-close')?.addEventListener('click', close);
    ov.addEventListener('click', (e) => { if (e.target === ov)
        close(); });
    wireSourceAccess('mpc', (m, k) => toast(m, k === 'warning' ? 'warning' : 'success'), () => {
        document.getElementById('nav-settings')?.click();
        setTimeout(() => document.getElementById('settings-identity-card')
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
    }, () => ov.querySelector('#mpc-src')?.value?.trim() || '');
    ov.querySelector('#mpc-add')?.addEventListener('click', async () => {
        const input = ov.querySelector('#mpc-src');
        const url = input.value.trim();
        if (!/^https?:\/\//i.test(url)) {
            toast(t('modpack.cat.badUrl'), 'warning');
            return;
        }
        // Checked by SHAPE before it is followed. A URL that answers with a theme catalogue
        // would otherwise be added and then show an empty list, which reads as "the catalogue
        // is empty" rather than "that is not a modpack catalogue".
        try {
            const doc = JSON.parse(await fetchSourceText(url, true));
            if (!looksLikeModpackFeed(doc)) {
                toast(t('modpack.cat.notFeed'), 'warning', 7000);
                return;
            }
        }
        catch (e) {
            toast(t('modpack.cat.unreachable'), 'error', 7000);
            return;
        }
        writeModpackCatalogs([...readModpackCatalogs(), url]);
        input.value = '';
        await refresh();
    });
    await refresh();
}
function close() {
    _overlay?.remove();
    _overlay = null;
}
async function refresh() {
    const ov = _overlay;
    if (!ov)
        return;
    const srcEl = ov.querySelector('#mpc-sources');
    const listEl = ov.querySelector('#mpc-list');
    const sources = readModpackCatalogs();
    srcEl.innerHTML = sources.length
        ? sources.map((u) => `
            <div style="display:flex;align-items:center;gap:6px;font-size:11px;min-width:0">
              <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted)">${escHtml(u)}</span>
              <button class="btn btn-ghost btn-sm mpc-del" data-url="${escHtml(u)}">${escHtml(t('common.remove'))}</button>
            </div>`).join('')
        : `<span style="font-size:11px;color:var(--text-muted)">${escHtml(t('modpack.cat.none'))}</span>`;
    srcEl.querySelectorAll('.mpc-del').forEach((b) => b.addEventListener('click', async () => {
        writeModpackCatalogs(readModpackCatalogs().filter((x) => x !== b.dataset.url));
        await refresh();
    }));
    listEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${escHtml(t('modpack.cat.loading'))}</span>`;
    // Each source is fetched independently and its own failure stays its own: one unreachable
    // catalogue used to be able to empty the whole list, which looks like everything broke.
    const results = await Promise.all(sources.map(async (u) => {
        try {
            return parseModpackFeed(JSON.parse(await fetchSourceText(u, true)), u).packs;
        }
        catch {
            return null;
        }
    }));
    const failed = results.filter((r) => r === null).length;
    const packs = results.flatMap((r) => r || []);
    if (!packs.length) {
        listEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${escHtml(failed ? t('modpack.cat.allFailed') : t('modpack.cat.empty'))}</span>`;
        return;
    }
    listEl.innerHTML = packs.map((p, i) => `
      <div class="mpc-row" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bmm-s03);min-width:0">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.name)}${p.version ? ` <span style="font-weight:400;color:var(--text-muted);font-size:11px">v${escHtml(p.version)}</span>` : ''}</div>
          <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.description || p.author || '')}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${[p.author && `${escHtml(t('modpack.cat.by'))} ${escHtml(p.author)}`,
        p.game && escHtml(p.game),
        p.mods !== undefined && `${p.mods} ${escHtml(t('modpack.cat.mods'))}`,
    ].filter(Boolean).join(' · ')}</div>
        </div>
        <button class="btn btn-sm btn-accent mpc-install" data-i="${i}">${escHtml(t('modpack.cat.install'))}</button>
      </div>`).join('');
    if (failed) {
        listEl.insertAdjacentHTML('beforeend', `<span style="font-size:11px;color:var(--bmm-warning)">${escHtml(t('modpack.cat.someFailed').replace('{n}', String(failed)))}</span>`);
    }
    listEl.querySelectorAll('.mpc-install').forEach((b) => b.addEventListener('click', async () => {
        const p = packs[Number(b.dataset.i)];
        if (!p)
            return;
        const btn = b;
        btn.disabled = true;
        try {
            await invoke('install_modpack_from_url', { downloadUrl: p.url });
            toast(t('modpack.cat.installed').replace('{name}', p.name), 'success');
            // The list behind this modal is stale the moment a pack lands.
            window.dispatchEvent(new CustomEvent('bmm://modpacks-updated'));
        }
        catch (e) {
            const raw = String(e);
            toast(raw.startsWith('modpack.errDownload') ? t('modpack.cat.dlFailed') : raw, 'error', 8000);
        }
        finally {
            btn.disabled = false;
        }
    }));
}
//# sourceMappingURL=modpack-catalog.js.map