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

/** Is this string an icon-pack ref this module can render? */
export function isPackIcon(ref: unknown): ref is string {
    return typeof ref === 'string'
        && (ref.startsWith('lucide:') || ref.startsWith('si:') || ref.startsWith('data:image/'));
}

/** Ensure the pack a ref needs is in memory (no-op for data: URIs). */
export async function ensurePackFor(ref: string): Promise<void> {
    if (ref.startsWith('lucide:')) await _loadLucide();
    else if (ref.startsWith('si:')) await _loadSimpleShard(ref.slice(3));
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
    if (ref.startsWith('data:image/')) {
        return `<img src="${escAttr(ref)}" alt="" style="width:${size}px;height:${size}px;border-radius:3px;object-fit:cover" />`;
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

const PAGE = 240;      // grid cells rendered per "show more" — 5000 nodes at once is jank

/** Open the icon picker. Resolves to a ref ("lucide:x" | "si:x" | "data:...") or
 *  null (cancelled). `current` pre-fills the search with the current ref's name. */
export function openIconPicker(opts: { current?: string } = {}): Promise<string | null> {
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
                    <button class="btn btn-ghost btn-sm" id="ipk-more" style="display:none">${t('iconpack.more') || 'Show more'}</button>
                </div>
            </div>`;
        (document.getElementById('app-window-outer') || document.body).appendChild(overlay);

        const grid = overlay.querySelector('#ipk-grid') as HTMLElement;
        const search = overlay.querySelector('#ipk-search') as HTMLInputElement;
        const countEl = overlay.querySelector('#ipk-count') as HTMLElement;
        const moreBtn = overlay.querySelector('#ipk-more') as HTMLElement;
        let src: 'lucide' | 'si' = 'lucide';
        let shown = PAGE;

        const done = (ref: string | null) => { overlay.remove(); resolve(ref); };
        overlay.querySelector('#ipk-close')?.addEventListener('click', () => done(null));
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(null); });

        const names = (): string[] => {
            const pool = src === 'lucide' ? Object.keys(_lucide || {}) : Object.keys(_simple || {});
            const q = search.value.trim().toLowerCase();
            if (!q) return pool;
            return pool.filter(n => n.includes(q)
                || (src === 'si' && (_simple?.[n]?.t || '').toLowerCase().includes(q)));
        };

        const cellHtml = (n: string): string => {
            const ref = `${src}:${n}`;
            const label = src === 'si' ? (_simple?.[n]?.t || n) : n;
            return `<button type="button" class="ipk-cell" data-ref="${escAttr(ref)}" title="${escAttr(label)}">${renderPackIcon(ref, 20)}<span class="ipk-name">${escHtml(label)}</span></button>`;
        };

        const render = () => {
            const all = names();
            grid.innerHTML = all.slice(0, shown).map(cellHtml).join('');
            countEl.textContent = `${all.length}`;
            (moreBtn as HTMLElement).style.display = all.length > shown ? '' : 'none';
        };

        grid.addEventListener('click', (e) => {
            const cell = (e.target as HTMLElement).closest('.ipk-cell') as HTMLElement | null;
            if (cell?.dataset.ref) done(cell.dataset.ref);
        });
        // Append the new page instead of re-rendering everything: a full rebuild
        // made each successive click slower (quadratic over 15 pages of brands).
        moreBtn.addEventListener('click', () => {
            const all = names();
            const page = all.slice(shown, shown + PAGE);
            shown += PAGE;
            grid.insertAdjacentHTML('beforeend', page.map(cellHtml).join(''));
            (moreBtn as HTMLElement).style.display = all.length > shown ? '' : 'none';
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
                render();
            }));

        (overlay.querySelector('#ipk-upload') as HTMLInputElement).addEventListener('change', (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            // Embedded in whatever carries the icon (tag, profile, share) — keep it small.
            if (file.size > 128 * 1024) { (window as any).toast?.(t('iconpack.tooBig') || 'Image must be under 128 KB', 'warning'); return; }
            const reader = new FileReader();
            reader.onload = () => { if (typeof reader.result === 'string') done(reader.result); };
            reader.readAsDataURL(file);
        });

        if (opts.current?.startsWith('si:')) { src = 'si'; overlay.querySelectorAll('.ipk-tab').forEach(x => x.classList.toggle('active', (x as HTMLElement).dataset.src === 'si')); }
        void _loadLucide().then(() => (src === 'si' ? _loadSimpleAll() : Promise.resolve())).then(() => { render(); search.focus(); });
    });
}
