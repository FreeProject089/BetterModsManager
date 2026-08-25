// icon-pack.ts — the shared icon library: 2000+ Lucide glyphs, 3400+ Simple Icons
// brands, and the user's own uploads, behind ONE picker and ONE renderer.
//
// An icon is a plain string ref, safe to store anywhere and to travel through every
// share path (profiles, tags, plugins, repos) because it is just data:
//   "lucide:<name>"   stroke glyph from assets/icons/lucide.json
//   "si:<slug>"       brand glyph from assets/icons/simple-icons.json
//   "data:image/..."  a user-uploaded image (small, embedded)
// Anything else is NOT an icon-pack ref — callers keep their legacy handling.
//
// The JSON packs are fetched ON DEMAND (first render/picker open), never imported —
// the boot-weight guard stays untouched. Renderers build the <svg> from data at use
// time; nothing here interpolates user strings into markup unescaped.
import { t } from '../core/i18n.js';
import { raiseAboveAll } from './layer.js';
import { escAttr, escHtml } from '../core/utils.js';
let _lucide = null;
let _simple = null;
let _lucideP = null;
let _simpleP = null;
function _loadLucide() {
    if (!_lucideP) {
        _lucideP = fetch('assets/icons/lucide.json')
            .then(r => r.json()).then(j => { _lucide = j; })
            .catch(() => { _lucide = {}; });
    }
    return _lucideP;
}
/** The WHOLE brand pack (4.6 MB) — only for the picker's Brands tab, which needs
 *  every name to search. Rendering a stored ref must never come through here. */
function _loadSimpleAll() {
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
const _shardP = {};
function _loadSimpleShard(slug) {
    const k = /^[a-z]/.test(slug) ? slug[0] : '_';
    if (_simpleP)
        return _simpleP; // the full pack is already coming
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
function splitRef(ref) {
    const i = ref.lastIndexOf('|');
    // A data: URI can contain '|', and it carries no colour — never split those.
    if (i < 0 || ref.startsWith('data:'))
        return { base: ref, colour: null };
    return { base: ref.slice(0, i), colour: ref.slice(i + 1) || null };
}
/** Attach (or clear) a colour on a ref. `'auto'` means the brand's own hex. */
export function withIconColour(ref, colour) {
    const { base } = splitRef(ref);
    return colour ? `${base}|${colour}` : base;
}
/** The colour carried by a ref, if any. */
export function iconColourOf(ref) {
    return splitRef(ref).colour;
}
/** Is this string an icon-pack ref this module can render? */
export function isPackIcon(ref) {
    return typeof ref === 'string'
        && (ref.startsWith('lucide:') || ref.startsWith('si:') || ref.startsWith('data:image/'));
}
/** Ensure the pack a ref needs is in memory (no-op for data: URIs). */
export async function ensurePackFor(ref) {
    const { base } = splitRef(ref);
    if (base.startsWith('lucide:'))
        await _loadLucide();
    else if (base.startsWith('si:'))
        await _loadSimpleShard(base.slice(3));
}
/** Warm every pack a list of refs needs. The one place that knows how to do this,
 *  so a new tag-rendering surface is one call instead of a copied incantation. */
export async function ensurePacksFor(refs) {
    const want = refs.filter((r) => isPackIcon(r));
    if (!want.length)
        return;
    await Promise.all(want.map(ensurePackFor));
}
/** THE tag chip. Five hand-rolled copies had already drifted (alphas 15/20/22/26,
 *  gradient and icon on two surfaces only), so the same tag looked different in
 *  the card grid, the list rows, the details panel and Settings. One renderer. */
export function renderTagChip(tag, opts = {}) {
    const fs = opts.fontSize ?? 10;
    const pad = opts.pad ?? '1px 6px';
    const bg = tag.color2
        ? `linear-gradient(90deg, ${tag.color}22, ${tag.color2}22)`
        : `${tag.color}18`;
    const ic = isPackIcon(tag.icon) ? renderPackIcon(tag.icon, opts.iconSize ?? Math.round(fs * 1.1)) : '';
    return `<span class="bmm-tag-chip" style="display:inline-flex;align-items:center;gap:3px;background:${bg};`
        + `color:${escAttr(tag.color)};border:1px solid ${escAttr(tag.color)}33;padding:${pad};border-radius:4px;`
        + `font-size:${fs}px;font-weight:600">${ic}${escHtml(tag.name)}</span>`;
}
/** Render a ref to inline HTML (SVG or <img>). Returns '' when unknown — callers
 *  fall back to their legacy icon handling. Synchronous by design: call
 *  ensurePackFor() (or the picker, which loads eagerly) beforehand; a miss while
 *  the pack is still loading renders '' and the next re-render finds it. */
export function renderPackIcon(ref, size = 16, color) {
    // An explicit `color` argument still wins — a caller that needs the glyph to
    // match its surroundings (a tag chip tinting to the tag's colour) must be able
    // to say so. The ref's own colour is the default, not a lock.
    const parsed = splitRef(ref);
    if (parsed.colour) {
        ref = parsed.base;
        if (!color) {
            color = parsed.colour === 'auto'
                ? `#${_simple?.[ref.slice(3)]?.h || '888888'}` // the brand's official hex
                : parsed.colour;
        }
    }
    if (ref.startsWith('data:image/')) {
        return `<img src="${escAttr(ref)}" alt="" style="width:${size}px;height:${size}px;border-radius:3px;object-fit:cover" />`;
    }
    if (ref.startsWith('lucide:')) {
        const node = _lucide?.[ref.slice(7)];
        if (!node)
            return '';
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
        if (!ic)
            return '';
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${escAttr(color || 'currentColor')}"><path d="${escAttr(ic.p)}"/></svg>`;
    }
    return '';
}
// ── The picker ───────────────────────────────────────────────────────────────
const PAGE = 240; // grid cells rendered per "show more" — 5000 nodes at once is jank
/** Open the icon picker. Resolves to a ref ("lucide:x" | "si:x" | "data:...") or
 *  null (cancelled). `current` pre-fills the search with the current ref's name. */
/** Words people type for icons that are filed under a different name.
 *
 *  Not a thesaurus — only the cases where the Lucide name is a word the searcher would not
 *  reach for. Every entry here is a search that returned NOTHING before. */
const ICON_SYNONYMS = {
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
function scoreIcon(name, label, tokens) {
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
            if (n === a)
                best = Math.max(best, 100 + own);
            else if (n.startsWith(a + '-') || n.startsWith(a))
                best = Math.max(best, 60 + own);
            // A whole word inside a hyphenated name — `arrow` in `circle-arrow-up`.
            else if (n.split('-').includes(a))
                best = Math.max(best, 45 + own);
            else if (n.includes(a))
                best = Math.max(best, 20 + own);
            else if (l.includes(a))
                best = Math.max(best, 15 + own); // brand titles
        }
        if (!best)
            return 0; // every token must hit, or it is not this icon
        score += best;
    }
    // A short name that matched is a closer answer than a long one that also matched.
    return score * 1000 - n.length;
}
// ── Your own icons ───────────────────────────────────────────────────────────
//
// An uploaded image used to be handed straight back and forgotten, so using the same icon
// on a second button meant finding the file and uploading it again. They are kept here
// instead, and become a third source in the picker.
//
// localStorage, not a file: an icon is already stored INSIDE whatever uses it (a data URL on
// the tag, the profile, the nav item), so this is a convenience list, not the copy of record.
// Losing it costs a re-upload and breaks nothing that already uses one.
const MINE_KEY = 'bmm_icon_library';
const MINE_MAX = 40; // a picker, not an asset manager
const MINE_MAX_BYTES = 2_000_000; // localStorage is small and shared with the whole app
export function savedIcons() {
    try {
        const raw = JSON.parse(localStorage.getItem(MINE_KEY) || '[]');
        return Array.isArray(raw) ? raw.filter((x) => x && typeof x.data === 'string') : [];
    }
    catch {
        return [];
    } // corrupt storage must not take the picker down
}
/** Remember one uploaded icon. Returns the ref the caller should use. */
export function saveIcon(name, dataUrl) {
    const list = savedIcons();
    // Same bytes twice is the same icon — uploading a file you already have should not
    // fill the list with copies of it.
    const existing = list.find((x) => x.data === dataUrl);
    if (existing)
        return existing.data;
    const entry = { id: dataUrl, name: name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || 'icon', data: dataUrl, at: Date.now() };
    let next = [entry, ...list].slice(0, MINE_MAX);
    // And a hard byte ceiling, because one 128 KB icon times forty is a quota error that
    // would surface as some unrelated setting failing to save.
    while (next.length > 1 && next.reduce((n, x) => n + x.data.length, 0) > MINE_MAX_BYTES)
        next.pop();
    try {
        localStorage.setItem(MINE_KEY, JSON.stringify(next));
    }
    catch { /* full — the icon still works, it just is not remembered */ }
    return dataUrl;
}
export function forgetIcon(id) {
    try {
        localStorage.setItem(MINE_KEY, JSON.stringify(savedIcons().filter((x) => x.id !== id)));
    }
    catch { /* ignore */ }
}
export function openIconPicker(opts = {}) {
    return new Promise((resolve) => {
        document.getElementById('bmm-icon-picker')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'bmm-icon-picker';
        overlay.className = 'modal-generic-overlay open';
        overlay.innerHTML = `
            <div class="modal ipk-modal">
                <div class="ipk-head">
                    <h3 class="ipk-title">${t('iconpack.title') || 'Choose an icon'}</h3>
                    <div class="ipk-tabs">
                        <button class="ipk-tab active" data-src="lucide">Lucide</button>
                        <button class="ipk-tab" data-src="si">${t('iconpack.brands') || 'Brands'}</button>
                        <button class="ipk-tab" data-src="mine">${t('iconpack.mine') || 'Yours'}</button>
                        <label class="ipk-tab ipk-tab-upload" for="ipk-upload">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></svg>
                            ${t('iconpack.upload') || 'Upload…'}
                            <input type="file" id="ipk-upload" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" hidden></label>
                    </div>
                    <button class="ipk-close" id="ipk-close" data-tooltip="${escAttr(t('common.close') || 'Close')}">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <div class="ipk-searchwrap">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                    <input id="ipk-search" placeholder="${escAttr(t('iconpack.search') || 'Search 5000+ icons…')}" autocomplete="off" spellcheck="false">
                </div>
                <div class="ipk-grid" id="ipk-grid"></div>
                <div class="ipk-foot">
                    <span class="ipk-count"><b id="ipk-count"></b> ${escHtml(t('iconpack.available') || 'available')}</span>
                    <div class="ipk-colour">
                        <label class="ipk-auto" id="ipk-auto-wrap" title="${escAttr(t('iconpack.autoTip') || 'Use each brand’s official colour')}">
                            <input type="checkbox" id="ipk-auto"> ${escHtml(t('iconpack.auto') || 'Brand colour')}
                        </label>
                        <label class="ipk-tint" title="${escAttr(t('iconpack.tintTip') || 'Tint the icon')}">
                            <input type="checkbox" id="ipk-tint-on"> ${escHtml(t('iconpack.tint') || 'Colour')}
                        </label>
                        <input type="color" id="ipk-tint" value="#3b82f6" disabled>
                    </div>
                    <button class="btn btn-ghost btn-sm" id="ipk-more" style="display:none">${t('iconpack.more') || 'Show more'}</button>
                </div>
            </div>`;
        // Measured, not fixed: this picker is opened from ordinary modals (11000) and from
        // the tutorial creator (2000100). A single number is wrong for one of them, and the
        // symptom there is not "it looks wrong" but "the button does nothing" — you see the
        // dim of a panel painted underneath the thing that opened it.
        raiseAboveAll(overlay, 10000);
        (document.getElementById('app-window-outer') || document.body).appendChild(overlay);
        const grid = overlay.querySelector('#ipk-grid');
        const search = overlay.querySelector('#ipk-search');
        const countEl = overlay.querySelector('#ipk-count');
        const moreBtn = overlay.querySelector('#ipk-more');
        let src = 'lucide';
        let shown = PAGE;
        const done = (ref) => { overlay.remove(); resolve(ref); };
        overlay.querySelector('#ipk-close')?.addEventListener('click', () => done(null));
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay)
            done(null); });
        const names = () => {
            if (src === 'mine') {
                const q = search.value.trim().toLowerCase();
                const mine = savedIcons();
                return q ? mine.filter((x) => x.name.toLowerCase().includes(q)).map((x) => x.id) : mine.map((x) => x.id);
            }
            const pool = src === 'lucide' ? Object.keys(_lucide || {}) : Object.keys(_simple || {});
            const q = search.value.trim().toLowerCase();
            if (!q)
                return pool;
            // Split on spaces AND hyphens, so "arrow up" and "arrow-up" are the same query.
            const tokens = q.split(/[\s-]+/).filter(Boolean);
            if (!tokens.length)
                return pool;
            const scored = [];
            for (const n of pool) {
                const sc = scoreIcon(n, src === 'si' ? (_simple?.[n]?.t || '') : '', tokens);
                if (sc > 0)
                    scored.push([n, sc]);
            }
            scored.sort((a, b) => b[1] - a[1]);
            return scored.map(([n]) => n);
        };
        const cellHtml = (n) => {
            if (src === 'mine') {
                // `n` IS the data URL — a saved icon has no pack prefix, because what the
                // caller stores is the image itself. Colour does not apply: tinting somebody
                // else's PNG is not something this can honestly offer.
                const meta = savedIcons().find((x) => x.id === n);
                const label = meta?.name || 'icon';
                return `<button type="button" class="ipk-cell ipk-cell-mine" data-ref="${escAttr(n)}" title="${escAttr(label)}">`
                    + `<img src="${escAttr(n)}" width="20" height="20" alt="">`
                    + `<span class="ipk-name">${escHtml(label)}</span>`
                    + `<span class="ipk-forget" data-forget="${escAttr(n)}" title="${escAttr(t('iconpack.forget') || 'Remove from your icons')}">\u00d7</span></button>`;
            }
            const ref = withIconColour(`${src}:${n}`, chosenColour());
            const label = src === 'si' ? (_simple?.[n]?.t || n) : n;
            return `<button type="button" class="ipk-cell" data-ref="${escAttr(`${src}:${n}`)}" title="${escAttr(label)}">${renderPackIcon(ref, 20)}<span class="ipk-name">${escHtml(label)}</span></button>`;
        };
        const render = () => {
            const all = names();
            grid.innerHTML = all.slice(0, shown).map(cellHtml).join('');
            countEl.textContent = `${all.length}`;
            moreBtn.style.display = all.length > shown ? '' : 'none';
        };
        // The colour is part of the answer, not a separate setting: it rides the ref
        // the caller stores, so it survives every share the icon does.
        const autoBox = overlay.querySelector('#ipk-auto');
        const tintOn = overlay.querySelector('#ipk-tint-on');
        const tint = overlay.querySelector('#ipk-tint');
        const chosenColour = () => {
            if (src === 'si' && autoBox.checked)
                return 'auto';
            return tintOn.checked ? tint.value : null;
        };
        const syncColourUi = () => {
            tint.disabled = !tintOn.checked;
            overlay.querySelector('#ipk-auto-wrap').style.display = src === 'si' ? '' : 'none';
            overlay.querySelector('.ipk-colour').style.display = src === 'mine' ? 'none' : '';
            if (src === 'si' && autoBox.checked) {
                tintOn.checked = false;
                tint.disabled = true;
            }
            render();
        };
        autoBox.addEventListener('change', syncColourUi);
        tintOn.addEventListener('change', () => { if (tintOn.checked)
            autoBox.checked = false; syncColourUi(); });
        tint.addEventListener('input', () => render());
        grid.addEventListener('click', (e) => {
            // The remove affordance sits INSIDE the cell, so it has to be checked first or
            // removing an icon would also choose it and close the picker.
            const forget = e.target.closest('[data-forget]');
            if (forget) {
                e.stopPropagation();
                forgetIcon(forget.dataset.forget);
                shown = PAGE;
                render();
                return;
            }
            const cell = e.target.closest('.ipk-cell');
            if (!cell?.dataset.ref)
                return;
            // A saved icon is already a complete answer; only pack refs take a colour.
            done(src === 'mine' ? cell.dataset.ref : withIconColour(cell.dataset.ref, chosenColour()));
        });
        // Append the new page instead of re-rendering everything: a full rebuild
        // made each successive click slower (quadratic over 15 pages of brands).
        moreBtn.addEventListener('click', () => {
            const all = names();
            const page = all.slice(shown, shown + PAGE);
            shown += PAGE;
            grid.insertAdjacentHTML('beforeend', page.map(cellHtml).join(''));
            moreBtn.style.display = all.length > shown ? '' : 'none';
        });
        let deb;
        search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { shown = PAGE; render(); }, 120); });
        overlay.querySelectorAll('.ipk-tab[data-src]').forEach(tab => tab.addEventListener('click', async () => {
            overlay.querySelectorAll('.ipk-tab').forEach(x => x.classList.toggle('active', x === tab));
            src = tab.dataset.src;
            shown = PAGE;
            // Opening Brands is the deliberate act that earns the full 4.6 MB.
            if (src === 'si') {
                grid.innerHTML = `<div class="ipk-loading">${escHtml(t('common.loading') || 'Loading…')}</div>`;
                await _loadSimpleAll();
            }
            syncColourUi();
            // Colour controls are meaningless over an uploaded image, and an empty
            // "Yours" tab needs to say why rather than look broken.
            if (src === 'mine' && !savedIcons().length) {
                grid.innerHTML = `<div class="ipk-loading">${escHtml(t('iconpack.mineEmpty') || 'Nothing here yet — upload an icon and it stays in this tab.')}</div>`;
            }
        }));
        overlay.querySelector('#ipk-upload').addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            // Embedded in whatever carries the icon (tag, profile, share) — keep it small.
            if (file.size > 128 * 1024) {
                window.toast?.(t('iconpack.tooBig') || 'Image must be under 128 KB', 'warning');
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result !== 'string')
                    return;
                // Remembered before it is returned, so the same icon is one click away next
                // time instead of another trip through the file dialog.
                done(saveIcon(file.name, reader.result));
            };
            reader.readAsDataURL(file);
        });
        if (opts.current?.startsWith('si:')) {
            src = 'si';
            overlay.querySelectorAll('.ipk-tab').forEach(x => x.classList.toggle('active', x.dataset.src === 'si'));
        }
        void _loadLucide().then(() => (src === 'si' ? _loadSimpleAll() : Promise.resolve())).then(() => { syncColourUi(); search.focus(); });
    });
}
//# sourceMappingURL=icon-pack.js.map