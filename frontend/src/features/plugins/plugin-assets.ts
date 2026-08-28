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
import { escHtml, escAttr } from '../../core/utils.js';
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

/**
 * One thing a plugin ships, whatever kind. Mirrors `commands::plugin_assets::PluginItem`.
 *
 * Four groups on one list, because they differ in what you can DO with one, not in what
 * they are — and "what is in this plugin" is one question.
 */
export interface PluginItem {
    group: 'asset' | 'script' | 'folder' | 'automation';
    path: string;
    name: string;
    kind: string;
    size: number;
    readable: boolean;
    present: boolean;
    count: number;
}

/** The order the groups appear in, and what each is called. */
const GROUPS: { g: PluginItem['group']; label: string; hint: string }[] = [
    { g: 'asset', label: 'plugins.contents.gAssets', hint: 'plugins.contents.hAssets' },
    { g: 'script', label: 'plugins.contents.gScripts', hint: 'plugins.contents.hScripts' },
    { g: 'folder', label: 'plugins.contents.gFolders', hint: 'plugins.contents.hFolders' },
    { g: 'automation', label: 'plugins.contents.gAutomations', hint: 'plugins.contents.hAutomations' },
];

/** What each kind is called on screen, and the icon that says it at a glance. */
const KIND: Record<string, { label: string; icon: string }> = {
    doc: { label: 'plugins.assets.kindDoc', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' },
    script: { label: 'plugins.assets.kindScript', icon: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>' },
    image: { label: 'plugins.assets.kindImage', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.35-4.35a2 2 0 0 0-2.83 0L4 21"/>' },
    data: { label: 'plugins.assets.kindData', icon: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>' },
    archive: { label: 'plugins.assets.kindArchive', icon: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>' },
    other: { label: 'plugins.assets.kindOther', icon: '<circle cx="12" cy="12" r="9"/>' },
    folder: { label: 'plugins.contents.gFolders', icon: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' },
    automation: { label: 'plugins.contents.gAutomations', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>' },
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
    // Everything the plugin ships, not only `assets/`. Four lists on three screens is why
    // this area read as unfinished: nowhere answered "what is actually IN this plugin".
    let items: PluginItem[] = [];
    try { items = await invoke('plugin_contents', { pluginId }) as PluginItem[]; }
    catch { items = (await listAssets(pluginId)).map((a) => ({
        group: 'asset' as const, path: `assets/${a.path}`, name: a.path,
        kind: a.kind, size: a.size, readable: a.readable, present: true, count: 0,
    })); }

    const ov = document.createElement('div');
    ov.className = 'modal-overlay open';
    // Opens on the README when there is one. It is the file an author writes FOR this moment,
    // and landing on `codes.csv` because it sorts first wastes the one they wrote.
    let current: PluginItem | null =
        items.find((a) => /(^|\/)readme\.(md|txt)$/i.test(a.path)) ||
        items.find((a) => a.kind === 'doc') ||
        items[0] ||
        null;

    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };

    const paint = async () => {
        const rows = GROUPS.map((grp) => {
            const mine = items.filter((i) => i.group === grp.g);
            if (!mine.length) return '';
            const body = mine.map((a) => {
                const on = current?.path === a.path;
                const meta = a.group === 'folder'
                    ? t('plugins.contents.nFiles').replace('{n}', String(a.count))
                    : size(a.size);
                return `<button type="button" class="pa-row${on ? ' is-on' : ''}${a.present ? '' : ' is-missing'}" data-path="${escHtml(a.path)}">
                    <span class="pa-row-icon">${icon(a.kind)}</span>
                    <span class="pa-row-name">${escHtml(a.name)}</span>
                    <span class="pa-row-meta">${escHtml(meta)}</span>
                    ${!a.present
                        // The most useful thing this screen can say. A declared script that is
                        // not there is exactly the plugin that installs and then does nothing,
                        // and hiding the row would hide the answer.
                        ? `<span class="pa-row-tag is-bad">${escHtml(t('plugins.contents.missing'))}</span>`
                        : a.kind === 'script'
                            // Marked, always. A shipped script is not a problem and it is also
                            // not a README; nobody scrolling eleven files should have to read
                            // extensions to notice there is a program in the list.
                            ? `<span class="pa-row-tag">${escHtml(t('plugins.assets.kindScript'))}</span>` : ''}
                </button>`;
            }).join('');
            // The hint is on the header, not under every row: it answers "what IS this group"
            // once, for somebody meeting the screen, and says nothing forever after.
            return `<div class="pa-group"><h5 class="pa-group-h" title="${escAttr(t(grp.hint))}">${escHtml(t(grp.label))}
                <span>${mine.length}</span></h5>
                <p class="pa-group-hint">${escHtml(t(grp.hint))}</p>${body}</div>`;
        }).join('');

        ov.innerHTML = `<div class="modal glass cm-modal pa-modal">
            <div class="modal-header">
                <h3>${escHtml(t('plugins.assets.title').replace('{p}', pluginName))}</h3>
                <button class="modal-close" type="button" id="pa-close" aria-label="${escHtml(t('common.close'))}">&times;</button>
            </div>
            ${items.length ? `
                <div class="modal-body pa-wrap">
                    <p class="pa-lede">${escHtml(t('plugins.assets.lede'))}</p>
                    <div class="pa-body">
                        <div class="pa-list">${rows}</div>
                        <div class="pa-view" id="pa-view"></div>
                    </div>
                </div>
                <div class="modal-footer">
                    <span class="pa-count">${escHtml(t('plugins.contents.count').replace('{n}', String(items.length)))}</span>
                    <button class="btn btn-sm btn-ghost" id="pa-check">${escHtml(t('plugins.check.run'))}</button>
                    <button class="btn btn-sm btn-secondary" id="pa-add">${escHtml(t('plugins.assets.add'))}</button>
                    <button class="btn btn-sm btn-ghost" id="pa-del" ${current?.group === 'asset' ? '' : 'disabled'}>${escHtml(t('plugins.assets.remove'))}</button>
                    <button class="btn btn-sm btn-secondary" id="pa-folder">${escHtml(t('plugins.openFolder'))}</button>
                    <button class="btn btn-sm btn-accent" id="pa-save" ${current?.group === 'asset' ? '' : 'disabled'}>${escHtml(t('plugins.assets.save'))}</button>
                </div>`
            : `<div class="modal-body"><p class="pa-lede">${escHtml(t('plugins.assets.none'))}</p></div>
               <div class="modal-footer">
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
                items = await invoke('plugin_contents', { pluginId }) as PluginItem[];
                current = items.find((a) => a.path === `assets/${rel}`) || current;
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
                await invoke('plugin_asset_remove', { pluginId, path: current!.name });
                items = await invoke('plugin_contents', { pluginId }) as PluginItem[];
                current = items[0] || null;
                await paint();
                toast(t('plugins.assets.removed').replace('{f}', gone), 'success', 6000);
            } catch (e) { toast(String(e), 'error', 9000); }
        });

        ov.querySelector('#pa-check')?.addEventListener('click', () => void runCheck(pluginId));
        ov.querySelectorAll<HTMLElement>('.pa-row').forEach((row) => {
            row.addEventListener('click', () => {
                current = items.find((a) => a.path === row.dataset.path) || null;
                void paint();
            });
        });
        ov.querySelector('#pa-folder')?.addEventListener('click', async () => {
            try {
                // The folder, not the file: opening a script would hand it to whatever the OS
                // runs .ps1 with, which is not what "show me this" means.
                //
                // Through the path resolver, so this works for every group — the old call was
                // rooted at assets/ and simply failed on a script or a bundled folder.
                const rel = current?.path || '';
                const full = await invoke('bmm_path_resolve', {
                    spec: rel ? `plugin:${pluginId}/${rel}` : `plugin:${pluginId}`,
                }) as string;
                const dir = current?.group === 'folder' || !rel ? full : full.replace(/[/\\][^/\\]*$/, '');
                await invoke('open_folder', { path: dir });
            } catch (e) { toast(String(e), 'error'); }
        });
        ov.querySelector('#pa-save')?.addEventListener('click', async () => {
            if (!current) return;
            const dir = await pickFolder().catch(() => null);
            if (!dir) return;
            try {
                const where = await invoke('plugin_asset_export', {
                    pluginId, path: current.name, destDir: dir,
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
        if (!current.present) {
            // Said here as well as in the row, because this is where somebody lands after
            // clicking it, and "nothing happened" is the worst possible answer.
            view.innerHTML = `<p class="pa-hint pa-hint-bad">${escHtml(t('plugins.contents.missingWhy').replace('{f}', current.name))}</p>`;
            return;
        }
        if (current.group === 'folder') {
            view.innerHTML = `<div class="pa-folder-card">
                <p class="pa-hint">${escHtml(t('plugins.contents.folderWhat')
                    .replace('{n}', String(current.count))
                    .replace('{s}', size(current.size)))}</p>
                <p class="pa-hint">${escHtml(t('plugins.contents.folderUse'))}</p>
                <code class="pa-spec">plugin:${escHtml(pluginId)}/${escHtml(current.path)}</code>
            </div>`;
            return;
        }
        if (current.group === 'automation') {
            await paintAutomation(view, pluginId, current);
            return;
        }
        if (current.group === 'script') {
            // The code, as text, always. A script is the one file where what is on screen has
            // to be exactly what is on disk — and reading it is the only way anybody decides
            // whether to let it run.
            try {
                const text = await invoke('plugin_file_read', { pluginId, path: current.path }) as string;
                view.innerHTML = `<p class="pa-hint pa-hint-warn">${escHtml(t('plugins.contents.scriptWarn'))}</p>
                    <pre class="pa-pre">${escHtml(text)}</pre>`;
            } catch (e) {
                view.innerHTML = `<p class="pa-hint">${escHtml(String(e))}</p>`;
            }
            return;
        }
        if (current.kind === 'image') {
            const p = await invoke('plugin_asset_path', { pluginId, path: current.name }).catch(() => '');
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
            const text = await invoke('plugin_asset_read', { pluginId, path: current.name }) as string;
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
    ov.className = 'modal-overlay open';
    ov.innerHTML = `<div class="modal glass cm-modal pa-check">
        <div class="modal-header">
            <h3>${escHtml(t('plugins.check.title'))}</h3>
            <button class="modal-close" type="button" id="pc-x" aria-label="${escHtml(t('common.close'))}">&times;</button>
        </div>
        <div class="modal-body pa-check-body">
            ${errors.length ? `<div class="pa-check-group">
                <h5 class="pa-check-h is-error">${escHtml(t('plugins.check.errors'))} <span>${errors.length}</span></h5>
                ${errors.map((p) => `<p class="pa-check-line">${escHtml(say(p))}</p>`).join('')}
            </div>` : ''}
            ${warns.length ? `<div class="pa-check-group">
                <h5 class="pa-check-h">${escHtml(t('plugins.check.warnings'))} <span>${warns.length}</span></h5>
                ${warns.map((p) => `<p class="pa-check-line">${escHtml(say(p))}</p>`).join('')}
            </div>` : ''}
        </div>
        <div class="modal-footer">
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


/**
 * What a shipped automation actually contains, before anything is set up.
 *
 * The steps and the permissions it ASKS for — which is the whole reason an automation is a
 * better thing to ship than a `.bat`. A script can only be read; this can be summarised, and
 * the summary is what somebody decides on.
 *
 * The permissions are shown as ASKED, and said to be removed on import. Both halves matter: a
 * task written to run a program is not a trap, it is a task that will not work until somebody
 * grants it — and hiding that would leave them wondering why it does nothing.
 */
async function paintAutomation(view: HTMLElement, pluginId: string, item: PluginItem): Promise<void> {
    let text: string;
    try { text = await invoke('plugin_file_read', { pluginId, path: item.path }) as string; }
    catch (e) { view.innerHTML = `<p class="pa-hint">${escHtml(String(e))}</p>`; return; }

    let doc: any;
    try { doc = JSON.parse(text); }
    catch { view.innerHTML = `<p class="pa-hint pa-hint-bad">${escHtml(t('plugins.contents.autoUnreadable'))}</p>`; return; }

    const tasks: any[] = Array.isArray(doc) ? doc : (doc?.tasks || []);
    if (!tasks.length) {
        view.innerHTML = `<p class="pa-hint pa-hint-bad">${escHtml(t('plugins.contents.autoNoTasks'))}</p>`;
        return;
    }
    const RISKY = ['command', 'script', 'deeplink', 'stopProcess', 'delete'];
    const countSteps = (steps: any[]): number => (steps || []).reduce((n, st) => {
        const inner = [st?.steps, st?.then, st?.else, st?.onError, st?.default]
            .filter(Array.isArray) as any[][];
        const branches = (st?.branches || []).filter(Array.isArray) as any[][];
        const cases = (st?.cases || []).map((c: any) => c?.steps).filter(Array.isArray) as any[][];
        return n + 1 + [...inner, ...branches, ...cases].reduce((m, b) => m + countSteps(b), 0);
    }, 0);

    view.innerHTML = `<div class="pa-auto">
        ${tasks.map((tk) => {
            const asked = RISKY.filter((k) => tk?.perms?.[k] === true);
            if (tk?.allowCustomCommands === true) for (const k of ['command', 'deeplink']) if (!asked.includes(k)) asked.push(k);
            return `<div class="pa-auto-task">
                <h5>${escHtml(tk?.name || t('plugins.contents.autoUnnamed'))}</h5>
                <p class="pa-hint">${escHtml(t('plugins.contents.autoSteps').replace('{n}', String(countSteps(tk?.steps))))}</p>
                ${tk?.describe ? `<p class="pa-hint">${escHtml(String(tk.describe))}</p>` : ''}
                ${asked.length
                    ? `<p class="pa-hint pa-hint-warn">${escHtml(t('plugins.contents.autoAsks').replace('{p}', asked.join(', ')))}</p>`
                    : `<p class="pa-hint">${escHtml(t('plugins.contents.autoAsksNothing'))}</p>`}
            </div>`;
        }).join('')}
        <p class="pa-hint">${escHtml(t('plugins.contents.autoHow'))}</p>
    </div>`;
}
