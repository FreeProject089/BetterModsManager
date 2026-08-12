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
/** Is this string an icon-pack ref this module can render? */
export function isPackIcon(ref) {
    return typeof ref === 'string'
        && (ref.startsWith('lucide:') || ref.startsWith('si:') || ref.startsWith('data:image/'));
}
/** Ensure the pack a ref needs is in memory (no-op for data: URIs). */
export async function ensurePackFor(ref) {
    if (ref.startsWith('lucide:'))
        await _loadLucide();
    else if (ref.startsWith('si:'))
        await _loadSimpleShard(ref.slice(3));
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
export function openIconPicker(opts = {}) {
    return new Promise((resolve) => {
        document.getElementById('bmm-icon-picker')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'bmm-icon-picker';
        overlay.className = 'modal-generic-overlay open';
        overlay.innerHTML = `
            <div class="modal ipk-modal">
                <div class="modal-generic-header">
                    <h3>${t('iconpack.title') || 'Choose an icon'}</h3>
                    <button class="modal-close" id="ipk-close">✕</button>
                </div>
                <div class="ipk-bar">
                    <input class="input" id="ipk-search" placeholder="${escAttr(t('iconpack.search') || 'Search 5000+ icons…')}" autocomplete="off">
                    <div class="ipk-tabs">
                        <button class="ipk-tab active" data-src="lucide">Lucide</button>
                        <button class="ipk-tab" data-src="si">${t('iconpack.brands') || 'Brands'}</button>
                        <label class="ipk-tab" for="ipk-upload">${t('iconpack.upload') || 'Upload…'}<input type="file" id="ipk-upload" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" hidden></label>
                    </div>
                </div>
                <div class="ipk-grid" id="ipk-grid"></div>
                <div class="ipk-foot"><span id="ipk-count"></span><button class="btn btn-ghost btn-sm" id="ipk-more" style="display:none">${t('iconpack.more') || 'Show more'}</button></div>
            </div>`;
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
            const pool = src === 'lucide' ? Object.keys(_lucide || {}) : Object.keys(_simple || {});
            const q = search.value.trim().toLowerCase();
            if (!q)
                return pool;
            return pool.filter(n => n.includes(q)
                || (src === 'si' && (_simple?.[n]?.t || '').toLowerCase().includes(q)));
        };
        const cellHtml = (n) => {
            const ref = `${src}:${n}`;
            const label = src === 'si' ? (_simple?.[n]?.t || n) : n;
            return `<button type="button" class="ipk-cell" data-ref="${escAttr(ref)}" title="${escAttr(label)}">${renderPackIcon(ref, 20)}<span class="ipk-name">${escHtml(label)}</span></button>`;
        };
        const render = () => {
            const all = names();
            grid.innerHTML = all.slice(0, shown).map(cellHtml).join('');
            countEl.textContent = `${all.length}`;
            moreBtn.style.display = all.length > shown ? '' : 'none';
        };
        grid.addEventListener('click', (e) => {
            const cell = e.target.closest('.ipk-cell');
            if (cell?.dataset.ref)
                done(cell.dataset.ref);
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
            render();
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
            reader.onload = () => { if (typeof reader.result === 'string')
                done(reader.result); };
            reader.readAsDataURL(file);
        });
        if (opts.current?.startsWith('si:')) {
            src = 'si';
            overlay.querySelectorAll('.ipk-tab').forEach(x => x.classList.toggle('active', x.dataset.src === 'si'));
        }
        void _loadLucide().then(() => (src === 'si' ? _loadSimpleAll() : Promise.resolve())).then(() => { render(); search.focus(); });
    });
}
//# sourceMappingURL=icon-pack.js.map