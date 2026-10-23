// icon-pack.ts — the shared icon library: 2000+ Lucide glyphs, 3400+ Simple Icons
// brands, and the user's own uploads, behind ONE picker and ONE renderer.
//
// An icon is a plain string ref, safe to store anywhere and to travel through every
// share path (profiles, tags, plugins, repos) because it is just data:
//   "lucide:<name>"   stroke glyph from assets/icons/lucide.json
//   "si:<slug>"       brand glyph from assets/icons/simple-icons.json
//   "iso:<name>"      full-colour isometric drawing, assets/icons/iso/<name>.svg (G5)
//   "data:image/..."  a user-uploaded image (small, embedded)
// Anything else is NOT an icon-pack ref — callers keep their legacy handling.
//
// The JSON packs are fetched ON DEMAND (first render/picker open), never imported —
// the boot-weight guard stays untouched. Renderers build the <svg> from data at use
// time; nothing here interpolates user strings into markup unescaped.

import { t } from '../core/i18n.js';
import { openModal } from './modal-shell.js';
import { escAttr, escHtml } from '../core/utils.js';
import { ISO_NAMES, isoIconUrl } from '../core/icon-cdn.js';
import { savedIcons, renameIcon, forgetIcons, importIconFiles, exportIcons } from './icon-mine.js';

type LucideNode = [string, Record<string, string>];
let _lucide: Record<string, LucideNode[]> | null = null;
let _simple: Record<string, { t: string; h: string; p: string }> | null = null;
let _lucideP: Promise<void> | null = null;
let _simpleP: Promise<void> | null = null;

function _loadLucide(): Promise<void> {
    if (!_lucideP) {
        _lucideP = fetch('assets/icons/lucide.json')
            .then(r => r.json()).then(j => { _lucide = j; })
            .catch(() => { _lucide = {}; });
    }
    return _lucideP;
}
/** The WHOLE brand pack (4.6 MB) — only for the picker's Brands tab, which needs
 *  every name to search. Rendering a stored ref must never come through here. */
function _loadSimpleAll(): Promise<void> {
    if (!_simpleP) {
        _simpleP = fetch('assets/icons/simple-icons.json')
            .then(r => r.json())
            .then(j => { _simple = { ..._simple, ...j }; })
            .catch(() => { _simple = _simple || {}; });
    }
    return _simpleP;
}

/** One shard (~150-420 KB) — enough to paint the refs actually in use. Loading
 *  4.6 MB on the startup path to draw a 9px glyph is how a manager starts
 *  feeling slow, so refs resolve shard-by-shard and merge into the same map. */
const _shardP: Record<string, Promise<void>> = {};
function _loadSimpleShard(slug: string): Promise<void> {
    const k = /^[a-z]/.test(slug) ? slug[0] : '_';
    if (_simpleP) return _simpleP;               // the full pack is already coming
    if (!_shardP[k]) {
        _shardP[k] = fetch(`assets/icons/si/${k}.json`)
            .then(r => r.json())
            .then(j => { _simple = { ..._simple, ...j }; })
            .catch(() => { _simple = _simple || {}; });
    }
    return _shardP[k];
}

// A ref may carry its colour: "lucide:star|#22c55e", or "si:github|auto" for the
// brand's official hex (Simple Icons ships one per brand). Keeping it IN the string
// is what preserves the property the whole design rests on — an icon is data, so it
// travels through every share path (profiles, tags, repos) with no extra plumbing.
function splitRef(ref: string): { base: string; colour: string | null } {
    const i = ref.lastIndexOf('|');
    // A data: URI can contain '|', and it carries no colour — never split those.
    if (i < 0 || ref.startsWith('data:')) return { base: ref, colour: null };
    return { base: ref.slice(0, i), colour: ref.slice(i + 1) || null };
}

/** Attach (or clear) a colour on a ref. `'auto'` means the brand's own hex. */
export function withIconColour(ref: string, colour: string | null): string {
    const { base } = splitRef(ref);
    return colour ? `${base}|${colour}` : base;
}

/** The colour carried by a ref, if any. */
export function iconColourOf(ref: string): string | null {
    return splitRef(ref).colour;
}

// ── Our own marks ──────────────────────────────────────────────────────────
// The Better* project logos + the Tasky mascot, as a built-in picker source ("Ours"). Full-
// colour bundled PNGs, referenced app:<key> and rendered as <img>. So a nav item / tag / profile
// can wear a BMM / BetterCommunity / Tasky logo without hunting for a file to upload.
const OUR_ICONS: Record<string, { src: string; label: string }> = {
    'app:bmm':   { src: 'assets/BMm.png',   label: 'BetterModsManager' },
    'app:bc':    { src: 'assets/BC.webp',   label: 'BetterCommunity' },
    'app:bi':    { src: 'assets/bi.svg',    label: 'BetterInstaller' },
    'app:bd':    { src: 'assets/bd.png',    label: 'BetterDiscord' },
    'app:tasky': { src: 'assets/Tasky.png', label: 'Tasky' },
    'app:tasky-happy': { src: 'assets/Tasky_Happy.png', label: 'Tasky (happy)' },
};

/** Is this string an icon-pack ref this module can render? */
export function isPackIcon(ref: unknown): ref is string {
    return typeof ref === 'string'
        && (ref.startsWith('lucide:') || ref.startsWith('si:') || ref.startsWith('data:image/') || ref.startsWith('app:')
            || ref.startsWith('iso:'));
}

/** Ensure the pack a ref needs is in memory (no-op for data: URIs). */
export async function ensurePackFor(ref: string): Promise<void> {
    const { base } = splitRef(ref);
    if (base.startsWith('lucide:')) await _loadLucide();
    else if (base.startsWith('si:')) await _loadSimpleShard(base.slice(3));
}

/** Warm every pack a list of refs needs. The one place that knows how to do this,
 *  so a new tag-rendering surface is one call instead of a copied incantation. */
export async function ensurePacksFor(refs: (string | undefined | null)[]): Promise<void> {
    const want = refs.filter((r): r is string => isPackIcon(r));
    if (!want.length) return;
    await Promise.all(want.map(ensurePackFor));
}

/** THE tag chip. Five hand-rolled copies had already drifted (alphas 15/20/22/26,
 *  gradient and icon on two surfaces only), so the same tag looked different in
 *  the card grid, the list rows, the details panel and Settings. One renderer. */
export function renderTagChip(tag: { name: string; color: string; color2?: string | null; icon?: string },
                              opts: { fontSize?: number; pad?: string; iconSize?: number } = {}): string {
    const fs = opts.fontSize ?? 10;
    const pad = opts.pad ?? '1px 6px';
    const bg = tag.color2
        ? `linear-gradient(90deg, ${tag.color}22, ${tag.color2}22)`
        : `${tag.color}18`;
    const ic = isPackIcon(tag.icon) ? renderPackIcon(tag.icon!, opts.iconSize ?? Math.round(fs * 1.1)) : '';
    return `<span class="bmm-tag-chip" style="display:inline-flex;align-items:center;gap:3px;background:${bg};`
        + `color:${escAttr(tag.color)};border:1px solid ${escAttr(tag.color)}33;padding:${pad};border-radius:4px;`
        + `font-size:${fs}px;font-weight:600">${ic}${escHtml(tag.name)}</span>`;
}

/** Render a ref to inline HTML (SVG or <img>). Returns '' when unknown — callers
 *  fall back to their legacy icon handling. Synchronous by design: call
 *  ensurePackFor() (or the picker, which loads eagerly) beforehand; a miss while
 *  the pack is still loading renders '' and the next re-render finds it. */
export function renderPackIcon(ref: string, size = 16, color?: string): string {
    // An explicit `color` argument still wins — a caller that needs the glyph to
    // match its surroundings (a tag chip tinting to the tag's colour) must be able
    // to say so. The ref's own colour is the default, not a lock.
    const parsed = splitRef(ref);
    if (parsed.colour) {
        ref = parsed.base;
        if (!color) {
            color = parsed.colour === 'auto'
                ? `#${_simple?.[ref.slice(3)]?.h || '888888'}`   // the brand's official hex
                : parsed.colour;
        }
    }
    if (ref.startsWith('data:image/')) {
        return `<img src="${escAttr(ref)}" alt="" style="width:${size}px;height:${size}px;border-radius:3px;object-fit:cover" />`;
    }
    if (ref.startsWith('app:')) {
        const our = OUR_ICONS[ref];
        if (!our) return '';
        // Just a white rounded background behind the mark — like a 512px app icon (~22% corner
        // radius) — so a transparent logo reads on any surface. No border, clean.
        const r = Math.max(4, Math.round(size * 0.22));
        const pad = Math.max(1, Math.round(size * 0.11));
        return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;background:#fff;border-radius:${r}px;padding:${pad}px;box-sizing:border-box;flex-shrink:0"><img src="${escAttr(our.src)}" alt="" style="max-width:100%;max-height:100%;object-fit:contain" /></span>`;
    }
    // Isometric (G5): a full-colour drawing, so an <img> and never a tint: a colour carried by
    // the ref is ignored rather than flattening the drawing into one silhouette. Bundled with
    // the app (no pack to load), and a name outside the closed list renders '' like any miss.
    if (ref.startsWith('iso:')) {
        const src = isoIconUrl(ref);
        return src ? `<img src="${escAttr(src)}" alt="" style="width:${size}px;height:${size}px;object-fit:contain;flex-shrink:0" />` : '';
    }
    if (ref.startsWith('lucide:')) {
        const node = _lucide?.[ref.slice(7)];
        if (!node) return '';
        const inner = node.map(([tag, attrs]) => {
            const at = Object.entries(attrs)
                .filter(([k]) => /^[a-zA-Z-]+$/.test(k))
                .map(([k, v]) => `${k}="${escAttr(String(v))}"`).join(' ');
            return /^[a-z]+$/.test(tag) ? `<${tag} ${at}/>` : '';
        }).join('');
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${escAttr(color || 'currentColor')}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    }
    if (ref.startsWith('si:')) {
        const ic = _simple?.[ref.slice(3)];
        if (!ic) return '';
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${escAttr(color || 'currentColor')}"><path d="${escAttr(ic.p)}"/></svg>`;
    }
    return '';
}

// ── The picker ───────────────────────────────────────────────────────────────

const PAGE = 120;      // cells appended per scroll step: the grid grows as you reach its end, 5000 nodes at once is jank

/** Open the icon picker. Resolves to a ref ("lucide:x" | "si:x" | "data:...") or
 *  null (cancelled). `current` pre-fills the search with the current ref's name. */

/** Words people type for icons that are filed under a different name.
 *
 *  Not a thesaurus — only the cases where the Lucide name is a word the searcher would not
 *  reach for. Every entry here is a search that returned NOTHING before. */
const ICON_SYNONYMS: Record<string, string[]> = {
    delete: ['trash'], bin: ['trash'], remove: ['trash', 'x'],
    settings: ['cog', 'settings', 'sliders'], preferences: ['sliders', 'settings'],
    picture: ['image'], photo: ['image', 'camera'], tick: ['check'], done: ['check'],
    cancel: ['x'], close: ['x'], add: ['plus'], new: ['plus'],
    edit: ['pencil', 'pen'], write: ['pencil', 'pen'],
    person: ['user'], people: ['users'], account: ['user'], profile: ['user'],
    folder: ['folder'], directory: ['folder'], save: ['save', 'download'],
    warning: ['triangle-alert', 'alert'], error: ['circle-x', 'octagon-alert'],
    back: ['arrow-left'], forward: ['arrow-right'], up: ['arrow-up'], down: ['arrow-down'],
    speed: ['gauge', 'zap'], fast: ['zap'], time: ['clock'], calendar: ['calendar'],
    lock: ['lock'], secure: ['lock', 'shield'], key: ['key'],
    game: ['gamepad', 'joystick'], music: ['music'], sound: ['volume'],
    graph: ['chart'], stats: ['chart'], money: ['coins', 'wallet', 'banknote'],
};

/**
 * Score one icon name against a query. Higher is better; 0 means "not a match".
 *
 * Ranking is the whole point. Every token must appear somewhere, so "arrow up" matches
 * `arrow-up` and `circle-arrow-up` and nothing else — but an exact name has to come FIRST,
 * or searching `star` buries `star` under `sparkle-star` and the search looks broken.
 */
function scoreIcon(name: string, label: string, tokens: string[]): number {
    const n = name.toLowerCase();
    const l = (label || '').toLowerCase();
    let score = 0;
    for (const tok of tokens) {
        const alts = [tok, ...(ICON_SYNONYMS[tok] || [])];
        let best = 0;
        for (let i = 0; i < alts.length; i++) {
            const a = alts[i];
            // The word actually typed beats a synonym at the same quality of match. Without
            // this, searching `settings` put `cog` first — a correct answer, ranked above
            // the icon literally named `settings`, which reads as the search being confused.
            const own = i === 0 ? 6 : 0;
            if (n === a) best = Math.max(best, 100 + own);
            else if (n.startsWith(a + '-') || n.startsWith(a)) best = Math.max(best, 60 + own);
            // A whole word inside a hyphenated name — `arrow` in `circle-arrow-up`.
            else if (n.split('-').includes(a)) best = Math.max(best, 45 + own);
            else if (n.includes(a)) best = Math.max(best, 20 + own);
            else if (l.includes(a)) best = Math.max(best, 15 + own);   // brand titles
        }
        if (!best) return 0;      // every token must hit, or it is not this icon
        score += best;
    }
    // A short name that matched is a closer answer than a long one that also matched.
    return score * 1000 - n.length;
}


export { savedIcons, saveIcon, forgetIcon } from './icon-mine.js';
export type { SavedIcon } from './icon-mine.js';

export function openIconPicker(opts: { current?: string } = {}): Promise<string | null> {
    return new Promise((resolve) => {
        document.getElementById('bmm-icon-picker')?.remove();
        const tabs = document.createElement('div');
        tabs.className = 'ipk-tabs';
        tabs.innerHTML = `
                        <button class="ipk-tab" data-src="ours">${t('iconpack.ours') || 'Better*'}</button>
                        <button class="ipk-tab active" data-src="lucide">Lucide</button>
                        <button class="ipk-tab" data-src="si">${t('iconpack.brands') || 'Brands'}</button>
                        <button class="ipk-tab" data-src="iso">${t('iconpack.iso') || 'Isometric'}</button>
                        <button class="ipk-tab" data-src="mine">${t('iconpack.mineTab') || 'My icons'}</button>
                        <label class="ipk-tab ipk-tab-upload" for="ipk-upload">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></svg>
                            ${t('iconpack.upload') || 'Import…'}
                            <input type="file" id="ipk-upload" multiple accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif,application/json,.json,.zip,application/zip" hidden></label>`;
        // The house shell (openModal): the sources ride in the header between the title and
        // the ×, the search is a toolbar band that never scrolls, the grid is the one scroller.
        // openModal measures the stack itself, so a picker opened from the tutorial creator
        // (2000100) still lands above it instead of under its dim.
        let picked: string | null = null;
        const m = openModal({
            id: 'bmm-icon-picker',
            title: t('iconpack.title') || 'Choose an icon',
            size: 'lg',
            tall: true,
            className: 'ipk-modal',
            headerEnd: tabs,
            closeLabel: t('common.close') || 'Close',
            body: '<div class="ipk-grid" id="ipk-grid"></div>',
            footer: `
                    <span class="ipk-count"><b id="ipk-count"></b> ${escHtml(t('iconpack.available') || 'available')}</span>
                    <span class="ipk-credit" id="ipk-iso-credit" style="display:none" title="${escAttr(t('iconpack.isoLicences') || 'Licences and attributions: assets/icons/iso/LICENSES.txt')}">${escHtml(t('iconpack.isoCredit') || 'Isoflow, MI2, Jolloficons (MIT)')}</span>
                    <div class="ipk-colour">
                        <label class="ipk-auto" id="ipk-auto-wrap" title="${escAttr(t('iconpack.autoTip') || 'Use each brand’s official colour')}">
                            <input type="checkbox" id="ipk-auto"> ${escHtml(t('iconpack.auto') || 'Brand colour')}
                        </label>
                        <label class="ipk-tint" title="${escAttr(t('iconpack.tintTip') || 'Tint the icon')}">
                            <input type="checkbox" id="ipk-tint-on"> ${escHtml(t('iconpack.tint') || 'Colour')}
                        </label>
                        <input type="color" id="ipk-tint" value="#3b82f6" disabled>
                    </div>`,
            onClose: () => resolve(picked),
        });
        m.footer?.classList.add('ipk-foot');
        const toolbar = document.createElement('div');
        toolbar.className = 'modal-toolbar';
        toolbar.innerHTML = `<div class="ipk-searchwrap">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                    <input id="ipk-search" placeholder="${escAttr(t('iconpack.search') || 'Search 5000+ icons…')}" autocomplete="off" spellcheck="false">
                </div>`;
        m.header.after(toolbar);
        const mineBar = document.createElement('div');
        mineBar.className = 'modal-toolbar ipk-minebar';
        mineBar.hidden = true;
        mineBar.innerHTML = `<button type="button" class="btn btn-ghost btn-sm" id="ipk-m-select">${escHtml(t('iconpack.select') || 'Select')}</button>
                    <button type="button" class="btn btn-ghost btn-sm" id="ipk-m-import">${escHtml(t('iconpack.importMany') || 'Import files…')}</button>
                    <button type="button" class="btn btn-ghost btn-sm" id="ipk-m-json">${escHtml(t('iconpack.exportJson') || 'Export JSON')}</button>
                    <button type="button" class="btn btn-ghost btn-sm" id="ipk-m-zip">${escHtml(t('iconpack.exportZip') || 'Export zip')}</button>
                    <button type="button" class="btn btn-ghost btn-sm ipk-danger" id="ipk-m-del" hidden>${escHtml(t('iconpack.deleteSel') || 'Delete selected')}</button>
                    <span class="ipk-drophint">${escHtml(t('iconpack.dropHint') || 'Drop SVG or PNG files anywhere to add them')}</span>`;
        toolbar.after(mineBar);
        const overlay = m.overlay;

        const grid = overlay.querySelector('#ipk-grid') as HTMLElement;
        const search = overlay.querySelector('#ipk-search') as HTMLInputElement;
        const countEl = overlay.querySelector('#ipk-count') as HTMLElement;
        let src: 'lucide' | 'si' | 'mine' | 'ours' | 'iso' = 'lucide';
        let shown = PAGE;
        let curAll: string[] = [];
        let selecting = false;
        const picks = new Set<string>();
        let mineMeta = new Map<string, { name: string }>();

        const done = (ref: string | null) => { picked = ref; m.close(); };

        const names = (): string[] => {
            if (src === 'ours') {
                const q = search.value.trim().toLowerCase();
                const keys = Object.keys(OUR_ICONS);
                return q ? keys.filter((k) => (k.slice(4) + ' ' + OUR_ICONS[k].label).toLowerCase().includes(q)) : keys;
            }
            if (src === 'mine') {
                const q = search.value.trim().toLowerCase();
                const mine = savedIcons();
                mineMeta = new Map(mine.map((x) => [x.id, { name: x.name }]));
                return q ? mine.filter((x) => x.name.toLowerCase().includes(q)).map((x) => x.id) : mine.map((x) => x.id);
            }
            const pool = src === 'lucide' ? Object.keys(_lucide || {}) : src === 'iso' ? [...ISO_NAMES] : Object.keys(_simple || {});
            const q = search.value.trim().toLowerCase();
            if (!q) return pool;
            // Split on spaces AND hyphens, so "arrow up" and "arrow-up" are the same query.
            const tokens = q.split(/[\s-]+/).filter(Boolean);
            if (!tokens.length) return pool;
            const scored: [string, number][] = [];
            for (const n of pool) {
                const sc = scoreIcon(n, src === 'si' ? (_simple?.[n]?.t || '') : '', tokens);
                if (sc > 0) scored.push([n, sc]);
            }
            scored.sort((a, b) => b[1] - a[1]);
            return scored.map(([n]) => n);
        };

        const cellHtml = (n: string): string => {
            if (src === 'ours') {
                // `n` is the app:<key> ref. Colour never applies to a full-colour logo.
                const our = OUR_ICONS[n];
                return `<button type="button" class="ipk-cell ipk-cell-mine" data-ref="${escAttr(n)}" title="${escAttr(our.label)}">`
                    + `${renderPackIcon(n, 22)}<span class="ipk-name">${escHtml(our.label)}</span></button>`;
            }
            if (src === 'iso') {
                // A full-colour drawing: no colour rides the ref, whatever the tint controls say.
                return `<button type="button" class="ipk-cell ipk-cell-mine" data-ref="${escAttr(`iso:${n}`)}" title="${escAttr(`iso:${n}`)}">`
                    + `${renderPackIcon(`iso:${n}`, 26)}<span class="ipk-name">${escHtml(n)}</span></button>`;
            }
            if (src === 'mine') {
                // `n` IS the data URL: a saved icon has no pack prefix, what the caller stores is the
                // image itself. Colour does not apply to somebody else's image.
                const label = mineMeta.get(n)?.name || 'icon';
                return `<button type="button" class="ipk-cell ipk-cell-mine${picks.has(n) ? ' ipk-selected' : ''}" data-ref="${escAttr(n)}" title="${escAttr(label)}">`
                    + `<img src="${escAttr(n)}" width="22" height="22" alt="" style="object-fit:contain">`
                    + `<span class="ipk-name">${escHtml(label)}</span>`
                    + `<span class="ipk-forget ipk-rename-btn" data-rename="${escAttr(n)}" title="${escAttr(t('iconpack.rename') || 'Rename')}">\u270e</span>`
                    + `<span class="ipk-forget" data-forget="${escAttr(n)}" title="${escAttr(t('iconpack.forget') || 'Remove from your icons')}">\u00d7</span></button>`;
            }
            const ref = withIconColour(`${src}:${n}`, chosenColour());
            const label = src === 'si' ? (_simple?.[n]?.t || n) : n;
            return `<button type="button" class="ipk-cell" data-ref="${escAttr(`${src}:${n}`)}" title="${escAttr(label)}">${renderPackIcon(ref, 20)}<span class="ipk-name">${escHtml(label)}</span></button>`;
        };

        // Infinite scroll: a sentinel after the last cell; when it comes into view the next chunk
        // is appended before it. Re-observing after each append re-fires the observer, so a tall
        // window fills itself without a scroll. Cells use content-visibility, so the browser does
        // not lay out or paint the ones that are off screen.
        const sentinel = document.createElement('div');
        sentinel.className = 'ipk-sentinel';
        const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore(); }, { root: grid, rootMargin: '400px' });
        const loadMore = () => {
            io.unobserve(sentinel);
            if (shown >= curAll.length) { sentinel.remove(); return; }
            const page = curAll.slice(shown, shown + PAGE);
            shown += PAGE;
            sentinel.insertAdjacentHTML('beforebegin', page.map(cellHtml).join(''));
            if (shown < curAll.length) io.observe(sentinel); else sentinel.remove();
        };
        const render = () => {
            curAll = names();
            grid.textContent = '';
            grid.insertAdjacentHTML('beforeend', curAll.slice(0, shown).map(cellHtml).join(''));
            grid.appendChild(sentinel);
            countEl.textContent = `${curAll.length}`;
            grid.scrollTop = 0;
            if (shown < curAll.length) io.observe(sentinel); else sentinel.remove();
            if (src === 'mine' && !curAll.length) grid.innerHTML = `<div class="ipk-loading">${escHtml(t('iconpack.mineEmpty') || 'Nothing here yet. Import SVG or PNG files, or drop them here.')}</div>`;
            syncMineBar();
        };
        const syncMineBar = () => {
            mineBar.hidden = src !== 'mine';
            (mineBar.querySelector('#ipk-m-select') as HTMLElement).classList.toggle('active', selecting);
            const del = mineBar.querySelector('#ipk-m-del') as HTMLElement;
            del.hidden = !picks.size;
            del.textContent = `${t('iconpack.deleteSel') || 'Delete selected'} (${picks.size})`;
            (mineBar.querySelector('#ipk-m-json') as HTMLElement).textContent = picks.size ? (t('iconpack.exportJsonSel') || 'Export selected (JSON)') : (t('iconpack.exportJson') || 'Export JSON');
            (mineBar.querySelector('#ipk-m-zip') as HTMLElement).textContent = picks.size ? (t('iconpack.exportZipSel') || 'Export selected (zip)') : (t('iconpack.exportZip') || 'Export zip');
        };

        // The colour is part of the answer, not a separate setting: it rides the ref
        // the caller stores, so it survives every share the icon does.
        const autoBox = overlay.querySelector('#ipk-auto') as HTMLInputElement;
        const tintOn = overlay.querySelector('#ipk-tint-on') as HTMLInputElement;
        const tint = overlay.querySelector('#ipk-tint') as HTMLInputElement;
        const chosenColour = (): string | null => {
            if (src === 'si' && autoBox.checked) return 'auto';
            return tintOn.checked ? tint.value : null;
        };
        const syncColourUi = () => {
            tint.disabled = !tintOn.checked;
            (overlay.querySelector('#ipk-auto-wrap') as HTMLElement).style.display = src === 'si' ? '' : 'none';
            (overlay.querySelector('.ipk-colour') as HTMLElement).style.display = (src === 'mine' || src === 'ours' || src === 'iso') ? 'none' : '';
            (overlay.querySelector('#ipk-iso-credit') as HTMLElement).style.display = src === 'iso' ? '' : 'none';
            if (src === 'si' && autoBox.checked) { tintOn.checked = false; tint.disabled = true; }
            render();
        };
        autoBox.addEventListener('change', syncColourUi);
        tintOn.addEventListener('change', () => { if (tintOn.checked) autoBox.checked = false; syncColourUi(); });
        tint.addEventListener('input', () => render());

        grid.addEventListener('click', (e) => {
            // The remove affordance sits INSIDE the cell, so it has to be checked first or
            // removing an icon would also choose it and close the picker.
            const forget = (e.target as HTMLElement).closest('[data-forget]') as HTMLElement | null;
            if (forget) {
                e.stopPropagation();
                picks.delete(forget.dataset.forget!);
                forgetIcons([forget.dataset.forget!]);
                shown = PAGE; render();
                return;
            }
            const ren = (e.target as HTMLElement).closest('[data-rename]') as HTMLElement | null;
            if (ren) {
                e.stopPropagation();
                const id = ren.dataset.rename!;
                const nameEl = ren.parentElement!.querySelector('.ipk-name') as HTMLElement;
                const inp = document.createElement('input');
                inp.className = 'ipk-rename'; inp.value = mineMeta.get(id)?.name || ''; inp.maxLength = 40;
                nameEl.replaceWith(inp); inp.focus(); inp.select();
                let fin = false;
                const commit = (ok: boolean) => { if (fin) return; fin = true; if (ok && inp.value.trim()) renameIcon(id, inp.value); render(); };
                inp.addEventListener('click', (ev) => ev.stopPropagation());
                inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') commit(true); else if (ev.key === 'Escape') commit(false); });
                inp.addEventListener('blur', () => commit(true));
                return;
            }
            const cell = (e.target as HTMLElement).closest('.ipk-cell') as HTMLElement | null;
            if (!cell?.dataset.ref) return;
            if (src === 'mine' && selecting) {
                const id = cell.dataset.ref;
                if (picks.has(id)) picks.delete(id); else picks.add(id);
                cell.classList.toggle('ipk-selected', picks.has(id));
                syncMineBar();
                return;
            }
            // A saved/our icon is already a complete answer; only tintable pack refs take a colour.
            done((src === 'mine' || src === 'ours' || src === 'iso') ? cell.dataset.ref : withIconColour(cell.dataset.ref, chosenColour()));
        });
        let deb: any;
        search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { shown = PAGE; render(); }, 120); });

        overlay.querySelectorAll('.ipk-tab[data-src]').forEach(tab =>
            tab.addEventListener('click', async () => {
                overlay.querySelectorAll('.ipk-tab').forEach(x => x.classList.toggle('active', x === tab));
                src = (tab as HTMLElement).dataset.src as any;
                shown = PAGE;
                // Opening Brands is the deliberate act that earns the full 4.6 MB.
                if (src === 'si') { grid.innerHTML = `<div class="ipk-loading">${escHtml(t('common.loading') || 'Loading…')}</div>`; await _loadSimpleAll(); }
                syncColourUi();
                // Colour controls are meaningless over an uploaded image, and an empty
                // "Yours" tab needs to say why rather than look broken.
            }));

        // Every way in goes through importIconFiles: several files at once, SVG sanitised, size
        // capped, bundles and zips accepted. One image from the Import tab is also the answer
        // (the old upload behaviour); several land in My icons.
        const importFiles = async (files: File[], pickSingle: boolean) => {
            if (!files.length) return;
            const res = await importIconFiles(files);
            const toast = (window as any).toast;
            if (res.skipped.length) toast?.((t('iconpack.skipped') || 'Skipped (not a usable image, or over 128 KB): {0}').replace('{0}', res.skipped.slice(0, 3).join(', ') + (res.skipped.length > 3 ? '…' : '')), 'warning');
            if (pickSingle && files.length === 1 && res.added.length === 1) { done(res.added[0].data); return; }
            if (res.added.length) toast?.((t('iconpack.imported') || '{0} icon(s) added to My icons').replace('{0}', String(res.added.length)), 'success');
            overlay.querySelector('.ipk-tab[data-src="mine"]')?.dispatchEvent(new Event('click'));
        };
        const upload = overlay.querySelector('#ipk-upload') as HTMLInputElement;
        upload.addEventListener('change', () => { const f = Array.from(upload.files || []); upload.value = ''; void importFiles(f, true); });
        mineBar.querySelector('#ipk-m-import')!.addEventListener('click', () => upload.click());
        const exp = (kind: 'json' | 'zip') => { const n = exportIcons(kind, [...picks]); if (!n) (window as any).toast?.(t('iconpack.nothingToExport') || 'No icons to export yet', 'warning'); };
        mineBar.querySelector('#ipk-m-json')!.addEventListener('click', () => exp('json'));
        mineBar.querySelector('#ipk-m-zip')!.addEventListener('click', () => exp('zip'));
        mineBar.querySelector('#ipk-m-select')!.addEventListener('click', () => { selecting = !selecting; if (!selecting) picks.clear(); render(); });
        mineBar.querySelector('#ipk-m-del')!.addEventListener('click', () => { forgetIcons([...picks]); picks.clear(); shown = PAGE; render(); });
        overlay.addEventListener('dragover', (e) => { if ((e as DragEvent).dataTransfer?.types.includes('Files')) { e.preventDefault(); overlay.classList.add('ipk-dropping'); } });
        overlay.addEventListener('dragleave', (e) => { if (e.target === overlay) overlay.classList.remove('ipk-dropping'); });
        overlay.addEventListener('drop', (e) => {
            const files = Array.from((e as DragEvent).dataTransfer?.files || []);
            if (!files.length) return;
            e.preventDefault(); overlay.classList.remove('ipk-dropping');
            void importFiles(files, false);
        });

        const initSrc = opts.current?.startsWith('si:') ? 'si' : opts.current?.startsWith('app:') ? 'ours' : opts.current?.startsWith('iso:') ? 'iso' : null;
        if (initSrc) { src = initSrc; overlay.querySelectorAll('.ipk-tab').forEach(x => x.classList.toggle('active', (x as HTMLElement).dataset.src === initSrc)); }
        void _loadLucide().then(() => (src === 'si' ? _loadSimpleAll() : Promise.resolve())).then(() => { syncColourUi(); search.focus(); });
    });
}
