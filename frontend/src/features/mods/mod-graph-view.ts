// The dependency and conflict tree, on screen.
//
// mod-graph.ts is the logic and is tested; this is the part that fetches and draws. Kept
// apart for the reason every module in this folder is: anything importing Tauri cannot be
// loaded by a test, so the thinking lives where it can be checked and only the plumbing
// lives here.

import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { toast } from '../../ui/app.js';
import {
    buildTree, findRoots, renderTreeText, missingDependencies,
    type GraphMod, type GraphConflict, type TreeNode,
} from './mod-graph.js';
import { uiIcon } from '../../ui/icons.js';

/**
 * `get_all_mod_conflicts` returns { modId: ConflictReport[] } — one entry per side, so the
 * same pair arrives twice. Flattened to unique pairs here, keyed on the sorted ids, because
 * a tree that showed "A conflicts with B" and "B conflicts with A" as two findings would
 * double every count in the summary.
 */
function toPairs(map: Record<string, any[]>): GraphConflict[] {
    const seen = new Set<string>();
    const out: GraphConflict[] = [];
    for (const [a, reports] of Object.entries(map || {})) {
        for (const r of reports || []) {
            const b = String((r as any)?.other_mod_id ?? (r as any)?.otherModId ?? (r as any)?.mod_id ?? '');
            if (!b || b === a) continue;
            const key = [a, b].sort().join('\u0000');
            if (seen.has(key)) continue;
            seen.add(key);
            // `file_count`, read from the Rust struct rather than guessed — my first attempt
            // invented `conflicting_files.length`, which would have shown 0 for every pair.
            const files = Number((r as any)?.file_count ?? 0) || 0;
            out.push({ a, b, files });
        }
    }
    return out;
}

/** One node and its children, as nested rows. Indentation is a margin rather than the box
 *  characters: the DOM version can colour a marker, and the text version — which is what
 *  people paste elsewhere — draws the box art. */
function nodeHtml(n: TreeNode): string {
    const tags = [
        n.missing ? `<span class="mg-tag is-missing">${escHtml(t('mg.missing') || 'not installed')}</span>` : '',
        n.cycle ? `<span class="mg-tag is-cycle">${escHtml(t('mg.cycle') || 'cycle')}</span>` : '',
        n.repeat ? `<span class="mg-tag">${escHtml(t('mg.repeat') || 'seen above')}</span>` : '',
        n.conflicts.length ? `<span class="mg-tag is-conflict">${escHtml((t('mg.conflicts') || '{n} conflict(s)').replace('{n}', String(n.conflicts.length)))}</span>` : '',
    ].filter(Boolean).join('');
    return `
        <div class="mg-node" style="margin-left:${n.depth * 16}px">
            <span class="mg-name">${escHtml(n.name)}</span>${tags}
        </div>
        ${n.children.map(nodeHtml).join('')}`;
}

export async function showModGraph(rootId?: string): Promise<void> {
    let mods: GraphMod[] = [];
    let conflicts: GraphConflict[] = [];
    try {
        mods = (await invoke('get_mods') as any[]).map((m) => ({
            id: String(m?.id ?? ''), name: String(m?.name ?? m?.id ?? ''),
            dependencies: Array.isArray(m?.dependencies) ? m.dependencies.map(String) : [],
            enabled: !!m?.enabled,
        })).filter((m) => m.id);
    } catch (e) {
        toast(`${t('mg.failed') || 'Could not read the mod list'} — ${String(e).slice(0, 100)}`, 'error');
        return;
    }
    // Conflicts are optional: they need an active profile, and a dependency tree is still
    // worth seeing without them. Failing the whole view because half the data is missing
    // would be the wrong trade.
    try { conflicts = toPairs(await invoke('get_all_mod_conflicts') as Record<string, any[]>); } catch { /* see above */ }

    const roots = rootId ? [rootId] : findRoots(mods);
    const missing = missingDependencies(mods);

    const overlay = document.createElement('div');
    overlay.className = 'modal-generic-overlay open';
    const esc = (x: unknown) => escHtml(String(x ?? ''));

    const trees = roots.map((id) => buildTree(id, mods, conflicts)).filter(Boolean) as TreeNode[];
    const asText = trees.map(renderTreeText).join('\n\n');

    overlay.innerHTML = `
        <div class="modal glass modal--lg mg-modal">
            <div class="modal-header">
                <div class="bms-titles">
                    <h2 class="modal-title">${esc(t('mg.title') || 'Dependencies & conflicts')}</h2>
                    <p class="bms-sub mg-summary">
                ${esc((t('mg.summary') || '{m} mods · {r} top-level · {c} conflicting pair(s)')
                    .replace('{m}', String(mods.length))
                    .replace('{r}', String(roots.length))
                    .replace('{c}', String(conflicts.length)))}</p>
                </div>
                <div class="bms-head-end">
                    <button class="btn btn-ghost btn-sm" id="mg-copy"
                        data-tooltip="${escAttr(t('mg.copyTip') || 'Copy the tree as text — searchable and quotable, unlike a screenshot')}">${esc(t('mg.copy') || 'Copy as text')}</button>
                </div>
                <button type="button" class="modal-close" id="mg-close" aria-label="${escAttr(t('common.close') || 'Close')}">${uiIcon('close', 16)}</button>
            </div>
            <div class="modal-body">
            ${missing.length ? `<div class="mg-warn">${esc((t('mg.missingSummary')
                || '{n} dependency/ies named by a mod and provided by nothing:').replace('{n}', String(missing.length)))}
                ${missing.slice(0, 8).map((x) => `<code>${esc(x.missing)}</code>`).join(' ')}</div>` : ''}
            <div class="mg-body">
                ${trees.length
                    ? trees.map(nodeHtml).join('<div class="mg-sep"></div>')
                    : `<p class="sched-pc-empty">${esc(t('mg.none') || 'No mods to draw.')}</p>`}
            </div>
            </div>
        </div>`;

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#mg-close')?.addEventListener('click', close);
    overlay.querySelector('#mg-copy')?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(asText);
            toast(t('mg.copied') || 'Tree copied.', 'success');
        } catch { toast(t('sched.insp.copyFail') || 'Could not reach the clipboard.', 'error'); }
    });
    (document.getElementById('app-window-outer') || document.body).appendChild(overlay);
}
