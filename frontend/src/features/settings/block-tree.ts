// The scripts inside a task, as a tree.
//
// A task's reusable blocks were a flat list of names. Eleven of them is a flat list of eleven
// things, and by the time somebody has that many they have already invented a naming
// convention to group them — `repair_fetch`, `repair_verify`, `nightly_scan` — because the
// list gave them nowhere else to put the structure.
//
// So the structure goes in the NAME: `repair/fetch`, `repair/verify`. The tree is not stored
// anywhere and there is nothing to keep in step — it is READ from the names every time, which
// means renaming a block moves it and deleting the last one in a folder removes the folder,
// with no bookkeeping that can disagree with reality.
//
// `call "repair/fetch"` takes the name verbatim, so nothing about running a block changes.

import { escHtml, escAttr } from '../../core/utils.js';
import { t } from '../../core/i18n.js';

/** One node. A folder has children and no block; a leaf has a block and no children. */
export interface TreeNode {
    /** The last segment — what is shown. */
    label: string;
    /** The full block name, for leaves. Empty for folders. */
    path: string;
    /** How deep, for indenting. */
    depth: number;
    children: TreeNode[];
    /** How many blocks are inside, for a folder. */
    count: number;
}

/**
 * Group block names into folders.
 *
 * Sorted so folders come before loose blocks at each level, and alphabetically within each —
 * which is what every file tree does, and the reason is the same: a folder is a place you go
 * INTO, and mixing the two makes the list read as one flat thing with odd icons.
 */
export function treeOf(names: string[]): TreeNode[] {
    const root: TreeNode = { label: '', path: '', depth: -1, children: [], count: 0 };

    for (const name of [...names].sort()) {
        const parts = name.split('/').filter(Boolean);
        if (!parts.length) continue;
        let node = root;
        for (let i = 0; i < parts.length; i++) {
            const leaf = i === parts.length - 1;
            const label = parts[i];
            let next = node.children.find((c) => c.label === label && (leaf ? !!c.path : !c.path));
            if (!next) {
                next = {
                    label,
                    path: leaf ? name : '',
                    depth: i,
                    children: [],
                    count: 0,
                };
                node.children.push(next);
            }
            node = next;
        }
    }

    // Counts, bottom-up. A folder shows how much is inside because that is the one fact its
    // name never gives you, and it is what tells you whether opening it is worth it.
    const count = (n: TreeNode): number => {
        n.count = n.path ? 1 : n.children.reduce((s, c) => s + count(c), 0);
        return n.count;
    };
    const sort = (n: TreeNode): void => {
        n.children.sort((a, b) => {
            const af = a.path ? 1 : 0;
            const bf = b.path ? 1 : 0;
            if (af !== bf) return af - bf;      // folders first
            return a.label.localeCompare(b.label);
        });
        n.children.forEach(sort);
    };
    root.children.forEach(count);
    sort(root);
    return root.children;
}

/** Every folder path in a tree, for remembering which are open. */
export function foldersOf(nodes: TreeNode[], prefix = ''): string[] {
    const out: string[] = [];
    for (const n of nodes) {
        if (n.path) continue;
        const here = prefix ? `${prefix}/${n.label}` : n.label;
        out.push(here);
        out.push(...foldersOf(n.children, here));
    }
    return out;
}

const FOLDER_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const FILE_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const CHEV = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';

/**
 * Render the tree, and say which node was clicked.
 *
 * `open` is the set of expanded folder paths, owned by the caller: it has to survive a repaint
 * after a rename, and a tree that collapses itself every time you touch it is a tree nobody
 * expands twice.
 */
export function renderTree(
    host: HTMLElement,
    nodes: TreeNode[],
    open: Set<string>,
    current: string,
    onPick: (path: string) => void,
    onToggle: (folder: string) => void,
): void {
    const rows: string[] = [];
    const walk = (list: TreeNode[], prefix: string): void => {
        for (const n of list) {
            if (n.path) {
                const on = n.path === current;
                rows.push(`<button type="button" class="bt-row bt-leaf${on ? ' is-on' : ''}"
                        data-path="${escAttr(n.path)}" style="padding-left:${8 + n.depth * 14}px" title="${escAttr(n.path)}">
                    <span class="bt-ic">${FILE_ICON}</span><span class="bt-label">${escHtml(n.label)}</span>
                </button>`);
                continue;
            }
            const here = prefix ? `${prefix}/${n.label}` : n.label;
            const isOpen = open.has(here);
            rows.push(`<button type="button" class="bt-row bt-folder" data-folder="${escAttr(here)}"
                    style="padding-left:${8 + n.depth * 14}px" aria-expanded="${isOpen}">
                <span class="bt-chev${isOpen ? ' is-open' : ''}">${CHEV}</span>
                <span class="bt-ic">${FOLDER_ICON}</span>
                <span class="bt-label">${escHtml(n.label)}</span>
                <span class="bt-count">${n.count}</span>
            </button>`);
            if (isOpen) walk(n.children, here);
        }
    };
    walk(nodes, '');

    host.innerHTML = rows.length ? rows.join('') : `<p class="bt-none">${escHtml(t('sched.tree.none'))}</p>`;
    host.querySelectorAll<HTMLElement>('.bt-leaf').forEach((el) => {
        el.addEventListener('click', () => onPick(el.dataset.path || ''));
    });
    host.querySelectorAll<HTMLElement>('.bt-folder').forEach((el) => {
        el.addEventListener('click', () => onToggle(el.dataset.folder || ''));
    });
}
