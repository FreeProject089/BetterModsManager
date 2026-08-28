// The two questions somebody asks about a plugin before trusting it.
//
// "What can it do to my machine" and "what is actually in it". Both were answerable only by
// leaving the screen: the permissions lived on a separate settings page listing every plugin
// at once, and the contents lived in a folder you had to open yourself. A plugin card offered
// eleven buttons and neither answer.
//
// Two modals, deliberately small. Neither installs, applies or changes anything except the
// permissions the person is looking at — which is the one thing they came to that dialog to
// decide.

import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { raiseAboveAll } from '../../ui/layer.js';
import { permDomains } from './plugin-perms.js';
import { humanSize, treeRows, treeSummary, type TreeEntry } from './plugin-tree.js';
export { humanSize, treeRows, treeSummary, type TreeEntry } from './plugin-tree.js';

/** A modal shell shared by both dialogs. Escape closes; the backdrop closes. */
function shell(title: string, sub: string, bodyHtml: string, footHtml = ''): HTMLElement {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay open';
    ov.innerHTML = `<div class="modal glass cm-modal pi-modal">
        <div class="modal-header">
            <h3>${escHtml(title)}</h3>
            <button class="modal-close" type="button" data-pi-close aria-label="${escAttr(t('common.close') || 'Close')}">&times;</button>
        </div>
        <div class="modal-body pi-body">
            ${sub ? `<p class="pi-sub">${escHtml(sub)}</p>` : ''}
            ${bodyHtml}
        </div>
        ${footHtml ? `<div class="modal-footer">${footHtml}</div>` : ''}
    </div>`;
    // Inside the app's window frame, like every other dialog here.
    //
    // `#app-window-outer` is `position: relative; overflow: hidden` and carries BMM's rounded
    // corners. An overlay on `document.body` is laid over the whole OS window instead — its
    // backdrop and the dialog's shadow paint past the rounded edge, which is what "a shadow
    // on an invisible div" looks like and why it read as BMM's frame being broken. Every
    // other modal in the codebase already mounted here; these two were the exception.
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);
    raiseAboveAll(ov, 11900);
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    ov.querySelector('[data-pi-close]')?.addEventListener('click', close);
    (ov as any)._close = close;
    return ov;
}

/**
 * What this plugin may do, the chance to change it, and — the part that was missing — what
 * it ASKED for.
 *
 * A plugin declares `permissions` in its manifest, and installing grants exactly none of
 * them: the Rust side logs "installed, disabled, no permissions" and means it. That is the
 * right default and it left a hole, because the request was then shown to nobody. Twenty-six
 * scopes in a flat list say nothing about which two this plugin actually wants, so the only
 * way to find out was to grant something and see whether it stopped erroring.
 *
 * Asked and granted are kept visibly apart. Ticking still GRANTS — unlike the create form,
 * where ticking is asking — and a scope granted that was never requested is worth seeing too:
 * it is usually left over from an older version of the plugin.
 */
export async function openPluginPermissions(
    pluginId: string,
    pluginName: string,
    notify: (m: string, k: 'success' | 'error') => void,
    opts: { requested?: string[]; firstRun?: boolean } = {},
): Promise<void> {
    const granted = await invoke('get_plugin_permissions', { pluginId }).catch(() => []) as string[];
    const asked = (opts.requested || []).filter((x) => typeof x === 'string');
    const domains = permDomains();
    const all = domains.flatMap((d) => d.scopes);
    // Only what this BMM knows about. A manifest can name a scope from a newer version, and
    // counting it would report "asks for 3" beside two rows.
    const askedHere = asked.filter((x) => all.includes(x));
    const extra = granted.filter((g) => askedHere.length && !askedHere.includes(g));

    const summary = askedHere.length
        ? (t('plugins.perm.asksN') || 'Asks for {n} of {all}')
            .replace('{n}', String(askedHere.length)).replace('{all}', String(all.length))
        : (t('plugins.perm.asksNone') || 'Asks for nothing — the safest plugin there is');

    const body = `<div class="pi-perms">
        <div class="pi-perm-bar">
            <span class="pi-perm-sum${askedHere.length ? '' : ' is-none'}">${escHtml(summary)}</span>
            <span class="pi-perm-acts">
                ${askedHere.length ? `<button type="button" class="btn btn-xs btn-ghost" id="pi-perm-asked">${escHtml(t('plugins.perm.grantAsked'))}</button>` : ''}
                <button type="button" class="btn btn-xs btn-ghost" id="pi-perm-none">${escHtml(t('plugins.perm.grantNone'))}</button>
            </span>
        </div>
        ${extra.length ? `<p class="pi-perm-extra">${escHtml((t('plugins.perm.extra') || 'Granted but not asked for: {x}').replace('{x}', extra.join(', ')))}</p>` : ''}
        ${domains.map((d) => `
        <div class="pi-perm-dom">
            <span class="pi-perm-dom-h" style="color:${d.color};">${escHtml(d.domain)}</span>
            ${d.scopes.map((sc) => `
                <label class="pi-perm-row${askedHere.includes(sc) ? ' is-asked' : ''}">
                    <input type="checkbox" data-scope="${escAttr(sc)}"${granted.includes(sc) ? ' checked' : ''}
                        style="accent-color:${d.color};">
                    <code style="color:${d.color};">${escHtml(sc)}</code>
                    <span class="pi-perm-what">${escHtml(t('plugins.scope.' + sc) || '')}</span>
                    ${askedHere.includes(sc) ? `<span class="pi-perm-tag">${escHtml(t('plugins.perm.askedTag'))}</span>` : ''}
                </label>`).join('')}
        </div>`).join('')}</div>`;

    const ov = shell(
        opts.firstRun
            ? (t('plugins.perm.titleAsk') || 'This plugin is asking for permissions')
            : (t('plugins.perm.title') || 'What this plugin may do'),
        `${pluginName} — ${t('plugins.perm.sub') || 'ticking here GRANTS. Nothing is asked again afterwards.'}`,
        body,
        `<button class="btn btn-sm btn-ghost" data-pi-close>${escHtml(
            opts.firstRun ? (t('plugins.perm.later') || 'Not now') : (t('common.cancel') || 'Cancel'))}</button>
         <button class="btn btn-sm btn-accent" id="pi-perm-save">${escHtml(t('plugins.savePerms') || 'Save')}</button>`,
    );
    // Both set the boxes and leave saving to the Save button. A shortcut that WROTE would be
    // a second way to grant a permission, and one of the two would eventually skip a check
    // the other has.
    ov.querySelector('#pi-perm-asked')?.addEventListener('click', () => {
        ov.querySelectorAll<HTMLInputElement>('input[data-scope]').forEach((cb) => {
            cb.checked = askedHere.includes(cb.dataset.scope || '');
        });
    });
    ov.querySelector('#pi-perm-none')?.addEventListener('click', () => {
        ov.querySelectorAll<HTMLInputElement>('input[data-scope]').forEach((cb) => { cb.checked = false; });
    });
    ov.querySelectorAll('[data-pi-close]').forEach((b) => b.addEventListener('click', () => (ov as any)._close()));
    ov.querySelector('#pi-perm-save')?.addEventListener('click', async () => {
        const perms = Array.from(ov.querySelectorAll<HTMLInputElement>('input[data-scope]:checked'))
            .map((cb) => cb.dataset.scope as string);
        try {
            await invoke('set_plugin_permissions', { pluginId, permissions: perms });
            notify(t('plugins.permsSaved') || 'Saved', 'success');
            (ov as any)._close();
        } catch (e) {
            notify(`${t('common.error')}: ${e}`, 'error');
        }
    });
}

/** The listing itself, as markup. Shared by the plugin modal and the create-form preview. */
export function treeHtml(entries: TreeEntry[]): string {
    if (!entries.length) return `<p class="pi-none">${escHtml(t('plugins.tree.empty') || 'Nothing in there.')}</p>`;
    const s = treeSummary(entries);
    const head = `<p class="pi-tree-sum">${escHtml(
        (t('plugins.tree.sum') || '{f} file(s) in {d} folder(s) · {b}')
            .replace('{f}', String(s.files))
            .replace('{d}', String(s.folders))
            .replace('{b}', humanSize(s.bytes) || '0 B'))}</p>`;
    const rows = treeRows(entries).map(({ depth, name, entry }) => `
        <div class="pi-tree-row${entry.is_dir ? ' is-dir' : ''}" style="padding-left:${8 + depth * 14}px">
            <span class="pi-tree-name">${escHtml(name)}${entry.is_dir ? '/' : ''}</span>
            ${entry.is_dir ? '' : `<span class="pi-tree-size">${escHtml(humanSize(entry.size))}</span>`}
        </div>`).join('');
    return head + `<div class="pi-tree">${rows}</div>`;
}

/**
 * Everything the plugin holds — scripts, bundled folders, automations, assets, the lot.
 *
 * Not `assets/` alone, which is what the existing viewer shows. "What did the author put in
 * assets" and "what IS this" are different questions, and the second is the one somebody asks
 * before running something they downloaded.
 */
export async function openPluginContent(pluginId: string, pluginName: string): Promise<void> {
    let entries: TreeEntry[] = [];
    let failed = '';
    try {
        entries = await invoke('plugin_tree', { pluginId }) as TreeEntry[];
    } catch (e) {
        failed = String(e);
    }
    shell(
        t('plugins.tree.title') || 'What is in this plugin',
        pluginName,
        failed
            ? `<p class="pi-none">${escHtml(t('plugins.assets.errNoFolder') || failed)}</p>`
            : treeHtml(entries),
    );
}

/**
 * The same listing for a folder somebody is ABOUT to bundle into a plugin.
 *
 * The create screen let you import a folder and then showed you its name. Everything that
 * decides whether shipping it is a good idea — how many files, how big, whether the build
 * output or a .env crept in — was invisible until after other people had downloaded it.
 */
export async function openFolderContent(path: string): Promise<void> {
    let entries: TreeEntry[] = [];
    let failed = '';
    try {
        entries = await invoke('folder_tree', { path }) as TreeEntry[];
    } catch (e) {
        failed = String(e);
    }
    shell(
        t('plugins.tree.folderTitle') || 'What is in this folder',
        path,
        failed ? `<p class="pi-none">${escHtml(t('plugins.assets.errNoFolder') || failed)}</p>` : treeHtml(entries),
    );
}

/** How much a folder would add, for the chip that names it. Never throws. */
export async function folderFacts(path: string): Promise<{ files: number; bytes: number } | null> {
    try {
        const entries = await invoke('folder_tree', { path }) as TreeEntry[];
        const s = treeSummary(entries);
        return { files: s.files, bytes: s.bytes };
    } catch {
        return null;
    }
}
