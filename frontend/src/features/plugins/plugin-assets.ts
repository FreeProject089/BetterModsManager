// The files a plugin ships alongside its code.
//
// A plugin could already carry scripts (declared so they can be run) and `bundle/` folders
// (copied into the game). Everything else an author actually hands people — a README, a
// config template, a sample list, a spreadsheet of codes, a small tool — had nowhere to go.
// It went in a Discord message.
//
// This is the screen for `assets/`. It shows what is there, renders the documents, and lets
// you take a copy out. It does not RUN anything: a script asset is listed, marked as a
// script, and opened in a folder — running one is the scheduler's `plugin.asset` action,
// behind the automation's own script permission, where the decision is made once and in
// writing.

import { invoke, pickFile, pickFolder, convertFileSrc } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { toast } from '../../ui/app.js';
import { raiseAboveAll } from '../../ui/layer.js';
import { showConfirm } from '../../ui/confirm.js';

/** One shipped file, as the backend reports it. Mirrors `commands::plugin_assets::PluginAsset`. */
export interface PluginAsset {
    path: string;
    /** `doc` · `script` · `image` · `data` · `archive` · `other`. */
    kind: string;
    size: number;
    readable: boolean;
}

/** What each kind is called on screen, and the icon that says it at a glance. */
const KIND: Record<string, { label: string; icon: string }> = {
    doc: { label: 'plugins.assets.kindDoc', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' },
    script: { label: 'plugins.assets.kindScript', icon: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>' },
    image: { label: 'plugins.assets.kindImage', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.35-4.35a2 2 0 0 0-2.83 0L4 21"/>' },
    data: { label: 'plugins.assets.kindData', icon: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>' },
    archive: { label: 'plugins.assets.kindArchive', icon: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>' },
    other: { label: 'plugins.assets.kindOther', icon: '<circle cx="12" cy="12" r="9"/>' },
};

const icon = (kind: string): string =>
    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${(KIND[kind] || KIND.other).icon}</svg>`;

const size = (n: number): string =>
    n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** What a plugin ships, or an empty list. Never throws: this decorates a card. */
export async function listAssets(pluginId: string): Promise<PluginAsset[]> {
    try {
        return (await invoke('plugin_assets_list', { pluginId })) as PluginAsset[];
    } catch {
        return [];
    }
}

/**
 * The assets screen for one plugin.
 *
 * Two panes: what is in the folder, and whatever you last clicked. A README opens by
 * itself, because a plugin that ships one is a plugin whose author expects it to be the
 * first thing read — and a screen that opens on an empty right-hand pane teaches people
 * that clicking is required before anything is worth looking at.
 */
export async function openPluginAssets(pluginId: string, pluginName: string): Promise<void> {
    const assets = await listAssets(pluginId);

    const ov = document.createElement('div');
    ov.className = 'cm-overlay';
    let current: PluginAsset | null =
        assets.find((a) => /^readme\.(md|txt)$/i.test(a.path)) ||
        assets.find((a) => a.kind === 'doc') ||
        null;

    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };

    const paint = async () => {
        const rows = assets.map((a) => {
            const on = current?.path === a.path;
            return `<button type="button" class="pa-row${on ? ' is-on' : ''}" data-path="${escHtml(a.path)}">
                <span class="pa-row-icon">${icon(a.kind)}</span>
                <span class="pa-row-name">${escHtml(a.path)}</span>
                <span class="pa-row-meta">${escHtml(size(a.size))}</span>
                ${a.kind === 'script'
                    // Marked, always. A shipped script is not a problem and it is also not a
                    // README; somebody scrolling a list of eleven files should not have to
                    // read extensions to notice there is a program in it.
                    ? `<span class="pa-row-tag">${escHtml(t('plugins.assets.kindScript'))}</span>` : ''}
            </button>`;
        }).join('');

        ov.innerHTML = `<div class="cm-modal pa-modal">
            <div class="cm-head">
                <h3>${escHtml(t('plugins.assets.title').replace('{p}', pluginName))}</h3>
                <button class="cm-x" id="pa-close" aria-label="${escHtml(t('common.close'))}">&times;</button>
            </div>
            ${assets.length ? `
                <p class="pa-lede">${escHtml(t('plugins.assets.lede'))}</p>
                <div class="pa-body">
                    <div class="pa-list">${rows}</div>
                    <div class="pa-view" id="pa-view"></div>
                </div>
                <div class="cm-foot">
                    <span class="pa-count">${assets.length}</span>
                    <button class="btn btn-sm btn-ghost" id="pa-check">${escHtml(t('plugins.check.run'))}</button>
                    <button class="btn btn-sm btn-secondary" id="pa-add">${escHtml(t('plugins.assets.add'))}</button>
                    <button class="btn btn-sm btn-ghost" id="pa-del" ${current ? '' : 'disabled'}>${escHtml(t('plugins.assets.remove'))}</button>
                    <button class="btn btn-sm btn-secondary" id="pa-folder">${escHtml(t('plugins.openFolder'))}</button>
                    <button class="btn btn-sm btn-accent" id="pa-save" ${current ? '' : 'disabled'}>${escHtml(t('plugins.assets.save'))}</button>
                </div>`
            : `<p class="pa-lede">${escHtml(t('plugins.assets.none'))}</p>
               <div class="cm-foot">
                    <button class="btn btn-sm btn-ghost" id="pa-check">${escHtml(t('plugins.check.run'))}</button>
                    <button class="btn btn-sm btn-accent" id="pa-add">${escHtml(t('plugins.assets.add'))}</button>
                    <button class="btn btn-sm btn-secondary" id="pa-folder">${escHtml(t('plugins.openFolder'))}</button>
               </div>`}
        </div>`;

        ov.querySelector('#pa-close')?.addEventListener('click', close);

        // Adding one. The half that was missing: getting a README in there used to mean
        // finding the install folder in Explorer, which is not a thing an author should have
        // to know about their own plugin.
        ov.querySelector('#pa-add')?.addEventListener('click', async () => {
            const picked = await pickFile({ filters: [{ name: t('plugins.assets.anyFile'), extensions: ['*'] }] }).catch(() => null);
            if (!picked) return;
            try {
                const rel = await invoke('plugin_asset_add', { pluginId, srcPath: picked, rel: null }) as string;
                assets.splice(0, assets.length, ...(await listAssets(pluginId)));
                current = assets.find((a) => a.path === rel) || current;
                await paint();
                toast(t('plugins.assets.added').replace('{f}', rel), 'success', 7000);
            } catch (e) {
                // errExists is the ordinary case, not a fault: two files with one name.
                toast(String(e).includes('errExists')
                    ? t('plugins.assets.errExists').replace('{f}', String(picked).replace(/^.*[/\\]/, ''))
                    : String(e), 'warning', 9000);
            }
        });

        ov.querySelector('#pa-del')?.addEventListener('click', async () => {
            if (!current) return;
            const gone = current.path;
            const ok = await showConfirm(gone, t('plugins.assets.removeAsk'), true);
            if (!ok) return;
            try {
                await invoke('plugin_asset_remove', { pluginId, path: gone });
                assets.splice(0, assets.length, ...(await listAssets(pluginId)));
                current = assets[0] || null;
                await paint();
                toast(t('plugins.assets.removed').replace('{f}', gone), 'success', 6000);
            } catch (e) { toast(String(e), 'error', 9000); }
        });

        ov.querySelector('#pa-check')?.addEventListener('click', () => void runCheck(pluginId));
        ov.querySelectorAll<HTMLElement>('.pa-row').forEach((row) => {
            row.addEventListener('click', () => {
                current = assets.find((a) => a.path === row.dataset.path) || null;
                void paint();
            });
        });
        ov.querySelector('#pa-folder')?.addEventListener('click', async () => {
            try {
                // The folder, not the file: opening a script asset would hand it to whatever
                // the OS runs .ps1 with, which is not what "show me this" means.
                const p = await invoke('plugin_asset_path', {
                    pluginId, path: current?.path || (assets[0]?.path ?? ''),
                }) as string;
                await invoke('open_folder', { path: p.replace(/[/\\][^/\\]*$/, '') });
            } catch (e) { toast(String(e), 'error'); }
        });
        ov.querySelector('#pa-save')?.addEventListener('click', async () => {
            if (!current) return;
            const dir = await pickFolder().catch(() => null);
            if (!dir) return;
            try {
                const where = await invoke('plugin_asset_export', {
                    pluginId, path: current.path, destDir: dir,
                }) as string;
                toast(t('plugins.assets.saved').replace('{f}', where.replace(/^.*[/\\]/, '')), 'success', 7000);
            } catch (e) { toast(String(e), 'error', 9000); }
        });

        const view = ov.querySelector('#pa-view') as HTMLElement | null;
        if (!view) return;
        if (!current) {
            view.innerHTML = `<p class="pa-hint">${escHtml(t('plugins.assets.pick'))}</p>`;
            return;
        }
        if (current.kind === 'image') {
            const p = await invoke('plugin_asset_path', { pluginId, path: current.path }).catch(() => '');
            view.innerHTML = p
                ? `<img class="pa-img" src="${escHtml(convertFileSrc(String(p)))}" alt="${escHtml(current.path)}">`
                : `<p class="pa-hint">${escHtml(t('plugins.assets.cannotShow'))}</p>`;
            return;
        }
        if (!current.readable) {
            view.innerHTML = `<p class="pa-hint">${escHtml(t('plugins.assets.cannotShow'))}</p>`;
            return;
        }
        try {
            const text = await invoke('plugin_asset_read', { pluginId, path: current.path }) as string;
            if (/\.(md|markdown)$/i.test(current.path)) {
                const { renderDocMarkdown } = await import('../../docs/md-lite.js');
                view.innerHTML = `<div class="pa-doc">${renderDocMarkdown(text)}</div>`;
            } else {
                // Everything else stays TEXT, escaped. A .json or a .ps1 rendered as markdown
                // would silently eat its own punctuation, and a script is the one file where
                // what is on screen has to be what is on disk.
                view.innerHTML = `<pre class="pa-pre">${escHtml(text)}</pre>`;
            }
        } catch (e) {
            view.innerHTML = `<p class="pa-hint">${escHtml(String(e))}</p>`;
        }
    };

    await paint();
    // #app-window-outer has `contain: paint`, so an overlay on document.body escapes the
    // rounded window and loses the stacking contest.
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);
    raiseAboveAll(ov, 11400);
    document.addEventListener('keydown', onKey, true);
}

/**
 * What is wrong with this plugin, before it goes out.
 *
 * Everything it reports produces a plugin that INSTALLS and then does not work — the failure
 * with no error message: the manifest is valid JSON, the archive unpacks, and the thing
 * simply does nothing on somebody else's machine.
 *
 * Nothing wrong is said out loud too. "No problems found" is the answer somebody is looking
 * for, and a check that only speaks when it is unhappy is one you never trust when it is
 * quiet.
 */
export async function runCheck(pluginId: string): Promise<void> {
    let problems: { level: string; key: string; subject?: string }[];
    try {
        problems = await invoke('plugin_check', { pluginId }) as typeof problems;
    } catch (e) {
        toast(String(e), 'error', 9000);
        return;
    }
    if (!problems.length) {
        toast(t('plugins.check.clean'), 'success', 6000);
        return;
    }
    const say = (p: { key: string; subject?: string }) =>
        t(p.key).replace('{f}', p.subject || '');
    const errors = problems.filter((p) => p.level === 'error');
    const warns = problems.filter((p) => p.level !== 'error');

    const ov = document.createElement('div');
    ov.className = 'cm-overlay';
    ov.innerHTML = `<div class="cm-modal pa-check">
        <div class="cm-head">
            <h3>${escHtml(t('plugins.check.title'))}</h3>
            <button class="cm-x" id="pc-x" aria-label="${escHtml(t('common.close'))}">&times;</button>
        </div>
        <div class="pa-check-body">
            ${errors.length ? `<div class="pa-check-group">
                <h5 class="pa-check-h is-error">${escHtml(t('plugins.check.errors'))} <span>${errors.length}</span></h5>
                ${errors.map((p) => `<p class="pa-check-line">${escHtml(say(p))}</p>`).join('')}
            </div>` : ''}
            ${warns.length ? `<div class="pa-check-group">
                <h5 class="pa-check-h">${escHtml(t('plugins.check.warnings'))} <span>${warns.length}</span></h5>
                ${warns.map((p) => `<p class="pa-check-line">${escHtml(say(p))}</p>`).join('')}
            </div>` : ''}
        </div>
        <div class="cm-foot">
            <span class="pa-count">${escHtml(errors.length ? t('plugins.check.blocked') : t('plugins.check.onlyWarn'))}</span>
            <button class="btn btn-sm btn-accent" id="pc-ok">${escHtml(t('common.close'))}</button>
        </div>
    </div>`;
    const shut = () => ov.remove();
    ov.querySelector('#pc-x')?.addEventListener('click', shut);
    ov.querySelector('#pc-ok')?.addEventListener('click', shut);
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);
    raiseAboveAll(ov, 11500);
}
