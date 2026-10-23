// Server Repo — « Advanced tools »: the part of each tab most people never need, one click away.
//
// Each tab shows its everyday path first (Sync: address → fetch → choose → sync; Host: folder →
// check → start → share). Everything else — the full export form, manifest-only, the hub, the
// mini-server, SSH, server options, who may connect, update checks, the new repo tools — sits in
// a <details class="rp-advanced"> at the bottom of the tab, one <details class="rp-tool"> per tool
// with a one-line description. This module only adds behaviour around that markup:
//
//   · open/closed is remembered per area and per tool (localStorage; private mode = this session);
//   · a search box filters the tools by their title, description, keywords and contents;
//   · each summary gets its icon; the area shows how many tools it holds;
//   · `revealRepoTool(name)` opens the tab, the area and the tool, for code that sends someone
//     to a tool (the API prefill, « create one » in step 1, the command palette).
//
// The markup is plain <details>, so the tutorial engine's reveal() opens it like any other
// fold: no special case for a lesson that points at a control inside.
import { t } from '../../core/i18n.js';
import { uiIcon, ICON_NAMES, type IconName } from '../../ui/icons.js';

const KEY = 'bmm_repo_advanced';

interface Saved { areas: Record<string, boolean>; tools: Record<string, boolean> }

function load(): Saved {
    try {
        const v = JSON.parse(localStorage.getItem(KEY) || '{}');
        return { areas: v?.areas && typeof v.areas === 'object' ? v.areas : {}, tools: v?.tools && typeof v.tools === 'object' ? v.tools : {} };
    } catch { return { areas: {}, tools: {} }; }
}
function save(s: Saved): void {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: remembered for this session only */ }
}

const isIcon = (n: string | undefined): n is IconName => !!n && (ICON_NAMES as string[]).includes(n);

/** Lower-case, accents off: « vérifier » finds « verifier ». */
const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function areaOf(el: Element | null): HTMLDetailsElement | null {
    return (el?.closest('details.rp-advanced') as HTMLDetailsElement | null) || null;
}

function paintCount(area: HTMLElement): void {
    const n = area.querySelectorAll('.rp-tool').length;
    const c = area.querySelector<HTMLElement>('[data-adv-count]');
    if (c) {
        c.textContent = String(n);
        c.title = t('repo.adv.count', { n: String(n) });
    }
}

function filter(area: HTMLElement, query: string): void {
    const words = fold(query).split(/\s+/).filter(Boolean);
    let shown = 0;
    area.querySelectorAll<HTMLElement>('.rp-tool').forEach((tool) => {
        const hay = fold(`${tool.querySelector('.rp-tool-h')?.textContent || ''} ${tool.dataset.keywords || ''} ${tool.querySelector('.rp-tool-body')?.textContent || ''}`);
        const ok = words.every((w) => hay.includes(w));
        tool.hidden = !ok;
        if (ok) shown++;
    });
    // A group with nothing left to show takes its heading (and the shared folder field) away too.
    area.querySelectorAll<HTMLElement>('.rp-tool-group').forEach((g) => {
        g.hidden = !g.querySelector('.rp-tool:not([hidden])');
    });
    const none = area.querySelector<HTMLElement>('[data-adv-none]');
    if (none) none.hidden = shown > 0;
}

/** Open the tab, the area and the tool `name`, and bring it into view. */
export function revealRepoTool(name: string, opts: { scroll?: boolean; focus?: boolean } = {}): HTMLDetailsElement | null {
    const tool = document.querySelector<HTMLDetailsElement>(`#view-repo details.rp-tool[data-tool="${CSS.escape(name)}"]`);
    if (!tool) return null;
    const panel = tool.closest<HTMLElement>('.repo-tab-panel');
    const tab = panel?.dataset.repoPanel;
    if (tab && !panel?.classList.contains('active')) (window as any).activateRepoTab?.(tab);
    const area = areaOf(tool);
    if (area) {
        // A search that hides the tool would make "go to it" land on nothing.
        const q = area.querySelector<HTMLInputElement>('[data-adv-search]');
        if (q?.value && tool.hidden) { q.value = ''; filter(area, ''); }
        area.open = true;
    }
    tool.open = true;
    if (opts.scroll !== false) {
        requestAnimationFrame(() => {
            tool.scrollIntoView({ behavior: 'smooth', block: 'start' });
            if (opts.focus !== false) {
                const first = tool.querySelector<HTMLElement>('.rp-tool-body :is(input:not([type=hidden]):not([readonly]), select, textarea, button):not([disabled])');
                setTimeout(() => first?.focus({ preventScroll: true }), 300);
            }
        });
    }
    return tool;
}

export function initRepoAdvanced(): void {
    const root = document.getElementById('view-repo');
    if (!root || root.dataset.rpAdvanced) return;
    root.dataset.rpAdvanced = '1';
    const saved = load();

    root.querySelectorAll<HTMLDetailsElement>('details.rp-advanced').forEach((area) => {
        const scope = area.dataset.advScope || area.id;
        if (saved.areas[scope]) area.open = true;
        area.addEventListener('toggle', () => {
            // `toggle` does not bubble: the tools' own toggles never reach this listener.
            saved.areas[scope] = area.open;
            save(saved);
        });
        paintCount(area);

        const q = area.querySelector<HTMLInputElement>('[data-adv-search]');
        // A handful of tools reads at a glance: the search box is for the long list.
        const find = q?.closest<HTMLElement>('.rp-advanced-find');
        if (find) find.hidden = area.querySelectorAll('.rp-tool').length < 6;
        if (q) {
            q.addEventListener('input', () => filter(area, q.value));
            q.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && q.value) { e.stopPropagation(); q.value = ''; filter(area, ''); }
            });
        }
    });

    root.querySelectorAll<HTMLDetailsElement>('details.rp-tool').forEach((tool) => {
        const id = tool.dataset.tool || tool.id;
        if (id && saved.tools[id]) tool.open = true;
        tool.addEventListener('toggle', () => {
            if (!id) return;
            saved.tools[id] = tool.open;
            save(saved);
        });
    });

    // Icons, from data-tool-icon: on the area's tile and at the start of every tool's summary.
    const paintIcons = () => {
        root.querySelectorAll<HTMLElement>('.rp-advanced-ic[data-tool-icon]').forEach((slot) => {
            const n = slot.dataset.toolIcon;
            if (isIcon(n) && !slot.firstElementChild) slot.innerHTML = uiIcon(n, 16);
        });
        root.querySelectorAll<HTMLDetailsElement>('details.rp-tool[data-tool-icon]').forEach((tool) => {
            const sum = tool.querySelector(':scope > .rp-tool-h');
            const n = tool.dataset.toolIcon;
            if (!sum || !isIcon(n) || sum.querySelector(':scope > .rp-tool-ic')) return;
            const ic = document.createElement('span');
            ic.className = 'rp-tool-ic';
            ic.setAttribute('aria-hidden', 'true');
            ic.innerHTML = uiIcon(n, 16);
            sum.prepend(ic);
        });
    };
    paintIcons();
    document.addEventListener('langChanged', () => {
        root.querySelectorAll<HTMLElement>('details.rp-advanced').forEach(paintCount);
    });

    // « Create one » in step 1, and any other button that names a tool.
    root.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-rp-tool-open]');
        if (!b?.dataset.rpToolOpen) return;
        e.preventDefault();
        revealRepoTool(b.dataset.rpToolOpen);
    });
}
