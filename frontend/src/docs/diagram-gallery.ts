// The docs hub's "Interactive diagrams" page: every registered diagram as a card, grouped by
// category, with a filter box and category chips, and a schematic thumbnail drawn from the spec
// itself (its nodes ranked along the flow, coloured by kind), so each card shows the shape of
// the picture it opens. A card is a [data-diagram] button: the hub's own click handler opens it.
import { t } from '../core/i18n.js';
import { uiIcon, type IconName } from '../ui/icons.js';
import { CATEGORIES, nodeKey, rankNodes, type DiagramCategory, type DiagramSpec } from './diagram-spec.js';
import { ensureDiagramCss } from './diagram-viewer.js';

const CAT_ICON: Record<DiagramCategory, IconName> = {
    mods: 'mod', profiles: 'profile', integrity: 'shield-check', sharing: 'server',
    updates: 'download', automation: 'workflow', laya: 'ai', internals: 'cpu',
};

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** A small schematic of the diagram: ranks along its direction, one mark per node. */
export function specThumb(s: DiagramSpec): string {
    const W = 168, H = 92, pad = 10;
    const rank = rankNodes(s);
    const layers: string[][] = [];
    for (const n of s.nodes) (layers[rank.get(n.id) || 0] ||= []).push(n.id);
    const L = layers.length || 1;
    const pos = new Map<string, { x: number; y: number }>();
    const across = s.dir === 'LR' ? H : W;
    const along = s.dir === 'LR' ? W : H;
    layers.forEach((layer, r) => {
        const a = L === 1 ? along / 2 : pad + (r * (along - pad * 2)) / (L - 1);
        layer.forEach((id, i) => {
            const c = (across * (i + 1)) / (layer.length + 1);
            pos.set(id, s.dir === 'LR' ? { x: a, y: c } : { x: c, y: a });
        });
    });
    const lines = s.edges.map((e) => {
        const a = pos.get(e.from), b = pos.get(e.to);
        if (!a || !b) return '';
        return `<line class="dgt-e${e.thick ? ' dgt-main' : ''}${e.dashed ? ' dgt-weak' : ''}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
    }).join('');
    const marks = s.nodes.map((n) => {
        const p = pos.get(n.id)!;
        const w = 14, h = 8;
        if (n.kind === 'decision') return `<path class="dgt-n dgs-${n.kind}" d="M${p.x} ${p.y - 6}L${p.x + 7} ${p.y}L${p.x} ${p.y + 6}L${p.x - 7} ${p.y}Z"/>`;
        const rx = n.kind === 'outcome' ? 4 : n.kind === 'front' ? 3 : n.kind === 'data' ? 2.5 : 1.5;
        return `<rect class="dgt-n dgs-${n.kind}" x="${(p.x - w / 2).toFixed(1)}" y="${(p.y - h / 2).toFixed(1)}" width="${w}" height="${h}" rx="${rx}"/>`;
    }).join('');
    return `<svg class="dgt" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">${lines}${marks}</svg>`;
}

function cardHay(s: DiagramSpec): string {
    return fold([t(`${s.i18n}.title`), t(`${s.i18n}.summary`), s.id, t(`docs.diagram.cat.${s.category}`),
        ...s.nodes.map((n) => t(nodeKey(s, n.id))), ...s.nodes.flatMap((n) => n.refs)].join(' '));
}

/** The whole page body for the hub's `diagrams` view. */
export function diagramGalleryHtml(registry: Record<string, DiagramSpec>): string {
    void ensureDiagramCss();
    wireGallery();
    const all = Object.values(registry);
    const byCat = new Map<DiagramCategory, DiagramSpec[]>();
    for (const s of all) (byCat.get(s.category) || byCat.set(s.category, []).get(s.category)!).push(s);
    const cats = CATEGORIES.filter((c) => byCat.get(c)?.length);
    const chips = [`<button type="button" class="dgg-chip is-on" data-dgg-cat="" aria-pressed="true">${esc(t('docs.diagram.ui.all'))}<span>${all.length}</span></button>`,
        ...cats.map((c) => `<button type="button" class="dgg-chip" data-dgg-cat="${c}" aria-pressed="false">${uiIcon(CAT_ICON[c], 14)}${esc(t(`docs.diagram.cat.${c}`))}<span>${byCat.get(c)!.length}</span></button>`)].join('');
    const sections = cats.map((c) => {
        const list = byCat.get(c)!.slice().sort((a, b) => t(`${a.i18n}.title`).localeCompare(t(`${b.i18n}.title`)));
        const cards = list.map((s) => {
            const refs = s.nodes.reduce((n, x) => n + x.refs.length, 0);
            return `<button type="button" class="dgg-card" data-diagram="${esc(s.id)}" data-dgg-hay="${esc(cardHay(s))}">
                <span class="dgg-thumb">${specThumb(s)}</span>
                <span class="dgg-body">
                    <span class="dgg-title">${esc(t(`${s.i18n}.title`))}</span>
                    <span class="dgg-sum">${esc(t(`${s.i18n}.summary`))}</span>
                    <span class="dgg-meta"><span>${esc(t('docs.diagram.ui.nodes', { n: String(s.nodes.length) }))}</span><span>${uiIcon('code', 12)}${esc(t('docs.diagram.ui.refs', { n: String(refs) }))}</span></span>
                </span>
            </button>`;
        }).join('');
        return `<section class="dgg-sec" data-dgg-sec="${c}">
            <h3 class="dgg-sec-h"><span class="dgg-sec-ic">${uiIcon(CAT_ICON[c], 16)}</span>${esc(t(`docs.diagram.cat.${c}`))}<span class="dgg-sec-n">${list.length}</span></h3>
            <div class="dgg-grid">${cards}</div>
        </section>`;
    }).join('');
    return `
        <div class="dh-cat-head">${uiIcon('workflow', 24)}<div><h2>${esc(t('docs.diagram.ui.galleryTitle'))}</h2><p>${esc(t('docs.diagram.ui.gallerySub'))}</p></div></div>
        <div class="dgg">
            <div class="dgg-tools">
                <label class="dgg-find">${uiIcon('search', 16)}<input type="search" class="dgg-search" placeholder="${esc(t('docs.diagram.ui.gallerySearch'))}" aria-label="${esc(t('docs.diagram.ui.gallerySearch'))}" autocomplete="off" spellcheck="false"></label>
                <div class="dgg-chips" role="group" aria-label="${esc(t('docs.diagram.ui.categories'))}">${chips}</div>
            </div>
            ${sections}
            <p class="dgg-empty" hidden>${esc(t('docs.diagram.ui.noDiagram'))}</p>
        </div>`;
}

/** Filter by text and category, live. Delegated once on the document: the hub repaints its DOM. */
let wired = false;
function wireGallery(): void {
    if (wired) return;
    wired = true;
    const apply = (root: Element) => {
        const q = fold((root.querySelector('.dgg-search') as HTMLInputElement | null)?.value || '').split(/\s+/).filter(Boolean);
        const cat = root.querySelector('.dgg-chip.is-on')?.getAttribute('data-dgg-cat') || '';
        let shown = 0;
        root.querySelectorAll<HTMLElement>('.dgg-sec').forEach((sec) => {
            const inCat = !cat || sec.getAttribute('data-dgg-sec') === cat;
            let n = 0;
            sec.querySelectorAll<HTMLElement>('.dgg-card').forEach((card) => {
                const hay = card.getAttribute('data-dgg-hay') || '';
                const ok = inCat && q.every((w) => hay.includes(w));
                card.hidden = !ok;
                if (ok) n++;
            });
            sec.hidden = n === 0;
            shown += n;
        });
        const empty = root.querySelector<HTMLElement>('.dgg-empty');
        if (empty) empty.hidden = shown > 0;
    };
    document.addEventListener('input', (e) => {
        const el = e.target as HTMLElement;
        if (!el.classList?.contains('dgg-search')) return;
        const root = el.closest('.dgg');
        if (root) apply(root);
    });
    document.addEventListener('click', (e) => {
        const chip = (e.target as HTMLElement).closest?.('.dgg-chip') as HTMLElement | null;
        if (!chip) return;
        const root = chip.closest('.dgg');
        if (!root) return;
        root.querySelectorAll('.dgg-chip').forEach((c) => { c.classList.toggle('is-on', c === chip); c.setAttribute('aria-pressed', String(c === chip)); });
        apply(root);
    });
}
