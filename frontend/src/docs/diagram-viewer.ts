// The interactive diagram viewer: the #modal-docs-diagram dialog, drawn from a DiagramSpec.
//
// Layout: a toolbar (back, find a node, zoom out / in / fit), the drawing (mermaid, panned and
// zoomed by svg-pan-zoom), and a side panel that answers "what is this?" for the node in hand:
// its kind, its description, WHERE IN THE CODE it lives (copyable references the diagram gate
// keeps true), what leads to it and where it goes. With nothing selected the panel is the
// diagram's overview: summary, legend of the kinds it uses, related article and diagrams.
//
// Interactions: hover a node to light its edges and neighbours; left click (or Enter) to select it;
// arrow keys move to the nearest node in that direction; / focuses the search; + - 0 zoom;
// Escape clears the search, then the selection, then closes. A node that drills into another
// diagram opens it, and Back returns.
//
// Colours: none here. css/diagrams.css paints kinds, tones and focus states from the live
// tokens, so a theme (BMM White included) restyles a diagram like any other surface.
import { t } from '../core/i18n.js';
import { ensureMermaid, ensureSvgPanZoom } from '../ui/lazy-vendor.js';
import { uiIcon } from '../ui/icons.js';
import { mermaidTheme } from './md-mermaid.js';
import {
    buildMermaid, parseRef, nodeKey, groupKey, groupDomId, NODE_KINDS,
    type DiagramSpec, type DiagramNode, type DiagramEdge, type NodeKind,
} from './diagram-spec.js';

type Registry = Record<string, DiagramSpec>;

interface EdgeView { e: DiagramEdge; path: SVGPathElement | null; label: Element | null }
interface Drawn {
    spec: DiagramSpec;
    svg: SVGSVGElement;
    nodes: Map<string, SVGGElement>;
    edges: EdgeView[];
}

let registry: Registry = {};
let drawn: Drawn | null = null;
let panZoom: any = null;
let selected: string | null = null;
let hovered: string | null = null;
let searchHits: string[] = [];
let searchCursor = -1;
const history: string[] = [];
let renderSeq = 0;

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * The feature's stylesheet, linked the first time a diagram (or the gallery) needs it. The
 * promise matters: mermaid measures each label before drawing its box, and a label measured
 * before this sheet applies is boxed for unstyled text and then clipped.
 */
let cssReady: Promise<void> | null = null;
export function ensureDiagramCss(): Promise<void> {
    if (cssReady) return cssReady;
    const existing = document.getElementById('diagrams-css') as HTMLLinkElement | null;
    if (existing) return (cssReady = Promise.resolve());
    const link = document.createElement('link');
    link.id = 'diagrams-css';
    link.rel = 'stylesheet';
    link.href = 'css/diagrams.css';
    cssReady = new Promise<void>((resolve) => {
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', () => resolve(), { once: true });
        setTimeout(resolve, 3000); // never hold a diagram hostage to a stylesheet
    });
    document.head.appendChild(link);
    return cssReady;
}

/** The translated label of a node, for the panel, the search and the gallery. */
export const nodeLabel = (s: DiagramSpec, id: string) => t(nodeKey(s, id));
const nodeDesc = (s: DiagramSpec, id: string) => t(`${nodeKey(s, id)}.desc`);
const kindName = (k: NodeKind) => t(`docs.diagram.kind.${k}`);

// ── the shell ──────────────────────────────────────────────────────────────────────────────

/** Build the toolbar, stage and panel inside the modal once. */
function ensureShell(): HTMLElement | null {
    const body = $('#modal-docs-diagram .modal-docs-content');
    if (!body) return null;
    let root = $('.dgv', body);
    if (root) return root;
    const wrapper = $('.diagram-wrapper', body);
    root = document.createElement('div');
    root.className = 'dgv';
    root.innerHTML = `
        <div class="dgv-bar" role="toolbar">
            <button type="button" class="dgv-btn dgv-back" hidden>${uiIcon('arrow-left', 16)}<span></span></button>
            <label class="dgv-find">${uiIcon('search', 16)}<input type="search" class="dgv-search" autocomplete="off" spellcheck="false"><span class="dgv-count" aria-live="polite"></span></label>
            <span class="dgv-spacer"></span>
            <button type="button" class="dgv-btn dgv-icon" data-zoom="out">${uiIcon('remove', 16)}</button>
            <button type="button" class="dgv-btn dgv-icon" data-zoom="in">${uiIcon('add', 16)}</button>
            <button type="button" class="dgv-btn dgv-icon" data-zoom="fit">${uiIcon('maximize', 16)}</button>
        </div>
        <div class="dgv-main">
            <div class="dgv-stage" tabindex="0" role="application"></div>
            <aside class="dgv-panel" aria-live="polite"></aside>
        </div>`;
    body.appendChild(root);
    const stage = $('.dgv-stage', root)!;
    if (wrapper) stage.appendChild(wrapper);
    const legend = document.createElement('div');
    legend.className = 'dgv-legend';
    stage.appendChild(legend);
    wireShell(root);
    return root;
}

function labelShell(root: HTMLElement): void {
    const input = $<HTMLInputElement>('.dgv-search', root)!;
    input.placeholder = t('docs.diagram.ui.search');
    input.setAttribute('aria-label', t('docs.diagram.ui.search'));
    const named: Array<[string, string]> = [['[data-zoom="out"]', 'docs.diagram.ui.zoomOut'], ['[data-zoom="in"]', 'docs.diagram.ui.zoomIn'], ['[data-zoom="fit"]', 'docs.diagram.ui.fit']];
    for (const [sel, key] of named) {
        const b = $(sel, root);
        if (b) { b.setAttribute('aria-label', t(key)); b.setAttribute('title', t(key)); }
    }
    const stage = $('.dgv-stage', root)!;
    stage.setAttribute('aria-label', t('docs.diagram.ui.keys'));
    const back = $('.dgv-back span', root);
    if (back) back.textContent = t('docs.diagram.ui.back');
}

function wireShell(root: HTMLElement): void {
    root.addEventListener('click', (e) => {
        const el = e.target as HTMLElement;
        const zoom = el.closest('[data-zoom]')?.getAttribute('data-zoom');
        if (zoom) { doZoom(zoom); return; }
        if (el.closest('.dgv-back')) { goBack(); return; }
        // Clicks on the drawing are answered by the stage's pointerup (below), which can tell a
        // click from a pan. Mermaid also stamps data-node="true" on every node <g>: reading that
        // attribute here used to select the node "true", i.e. clear the pick the pointerup had just
        // made, so a LEFT click on a node did nothing and only a right click (no click event)
        // opened its detail. The panel's own links are [data-pick].
        if (el.closest('.dgv-stage svg')) return;
        const pick = el.closest('[data-pick]')?.getAttribute('data-pick');
        if (pick) { select(pick, true); return; }
        const open = el.closest('[data-open-diagram]')?.getAttribute('data-open-diagram');
        if (open) { void openSpec(open, { push: true }); return; }
        const art = el.closest('[data-article]')?.getAttribute('data-article');
        if (art) { openArticle(art); return; }
        const copy = el.closest('[data-copy]')?.getAttribute('data-copy');
        if (copy) { void copyRef(copy, el.closest('[data-copy]') as HTMLElement); return; }
        if (el.closest('[data-clear]')) { select(null); return; }
    });
    const input = $<HTMLInputElement>('.dgv-search', root)!;
    input.addEventListener('input', () => runSearch(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); stepSearch(e.shiftKey ? -1 : 1); }
        else if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; runSearch(''); }
    });
    const stage = $('.dgv-stage', root)!;
    stage.addEventListener('keydown', onStageKey);
    // A click on the empty canvas clears the selection; a drag (a pan) does not.
    let down: { x: number; y: number } | null = null;
    // LEFT button only: a node's detail opens on a left click (or Enter); a right click keeps the
    // platform's default and selects nothing.
    stage.addEventListener('pointerdown', (e) => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; });
    stage.addEventListener('pointerup', (e) => {
        if (!down || e.button !== 0) { down = null; return; }
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
        down = null;
        if (moved) return;
        const target = e.target as Element;
        if (target.closest('.dgv-legend')) return;
        const node = target.closest('g.node') as SVGGElement | null;
        const id = node ? idOfNode(node) : null;
        if (id) { select(id); stage.focus({ preventScroll: true }); }
        else if (target.closest('svg')) select(null);
    });
}

// ── open / close ───────────────────────────────────────────────────────────────────────────

export function setDiagramRegistry(reg: Registry): void { registry = reg; }

export function currentDiagramId(): string | null { return drawn?.spec.id ?? null; }

/**
 * Open (or switch the open dialog to) a diagram. `push`: remember the current one for Back
 * (a drill-down from a node, or a related diagram); a fresh open from elsewhere starts clean.
 */
export async function openSpec(id: string, opts: { push?: boolean; keep?: boolean; highlight?: string | null } = {}): Promise<boolean> {
    const spec = registry[id];
    if (!spec) return false;
    const modal = document.getElementById('modal-docs-diagram');
    const container = document.getElementById('mermaid-diagram-container');
    const title = document.getElementById('docs-diagram-title');
    if (!modal || !container || !title) return false;
    await ensureDiagramCss();
    const root = ensureShell();
    if (!root) return false;
    labelShell(root);

    const wasOpen = modal.classList.contains('active');
    if (opts.push && wasOpen && drawn && drawn.spec.id !== id) history.push(drawn.spec.id);
    else if (!opts.push && !opts.keep) history.length = 0;
    const back = $<HTMLButtonElement>('.dgv-back', root)!;
    back.hidden = history.length === 0;
    if (history.length) back.title = t(registry[history[history.length - 1]]?.titleKey || '');

    title.textContent = t(`${spec.i18n}.title`);
    modal.style.display = 'flex';
    if (!wasOpen) setTimeout(() => modal.classList.add('active'), 10);

    selected = null; hovered = null; searchHits = []; searchCursor = -1;
    const input = $<HTMLInputElement>('.dgv-search', root)!;
    input.value = '';
    $('.dgv-count', root)!.textContent = '';
    renderPanel(spec);
    renderLegend(spec);

    const seq = ++renderSeq;
    container.innerHTML = `<div class="dgv-loading">${esc(t('docs.diagram.ui.loading'))}</div>`;
    try {
        const mermaid = await ensureMermaid();
        if (!mermaid?.render) throw new Error('mermaid unavailable');
        const base = mermaidTheme('loose');
        try {
            mermaid.initialize({
                ...base,
                flowchart: { ...base.flowchart, useMaxWidth: false, htmlLabels: true, nodeSpacing: 38, rankSpacing: 54, padding: 14, curve: 'basis' },
            });
        } catch { /* keep the configuration in place */ }
        const source = buildMermaid(spec, t);
        const { svg } = await mermaid.render(`dgv-svg-${id}-${seq}`, source);
        if (seq !== renderSeq) return true; // another diagram was asked for meanwhile
        container.innerHTML = svg;
        const el = container.querySelector('svg') as SVGSVGElement | null;
        if (!el) throw new Error('no svg');
        drawn = index(spec, el);
        decorate(drawn);
        await initPanZoom(el);
        wireNodes(drawn);
        const want = opts.highlight && drawn.nodes.has(opts.highlight) ? opts.highlight : null;
        if (want) setTimeout(() => select(want, true), 80);
        $<HTMLElement>('.dgv-stage', root)?.focus({ preventScroll: true });
    } catch (err) {
        console.error('[Docs] diagram render error:', err);
        container.innerHTML = `<p class="dgv-error">${esc(t('docs.diagram.ui.renderError'))}</p>`;
        drawn = null;
    }
    return true;
}

export function closeViewer(): void {
    history.length = 0;
    selected = null;
    hovered = null;
    drawn = null;
    renderSeq++;
    if (panZoom) { try { panZoom.destroy(); } catch { /* already gone */ } panZoom = null; }
}

function goBack(): void {
    const prev = history.pop();
    if (prev) void openSpec(prev, { keep: true });
}

function openArticle(articleId: string): void {
    const w = window as any;
    const close = document.getElementById('btn-close-docs-diagram') as HTMLElement | null;
    if (typeof w.openDocsArticleById === 'function') {
        close?.click();
        w.openDocsArticleById(articleId);
    }
}

async function copyRef(text: string, btn: HTMLElement | null): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        btn?.classList.add('is-done');
        setTimeout(() => btn?.classList.remove('is-done'), 1200);
        (window as any).showToast?.(t('docs.diagram.ui.copied'), 'success');
    } catch {
        (window as any).showToast?.(t('docs.diagram.ui.copyFailed'), 'error');
    }
}

// ── reading the drawing back ───────────────────────────────────────────────────────────────

/** A mermaid node group's spec id: `data-id`, else the id mermaid builds (flowchart-ID-n). */
function idOfNode(g: Element): string | null {
    const d = g.getAttribute('data-id');
    if (d) return d;
    const m = /^flowchart-(.+)-\d+$/.exec(g.id || '');
    return m ? m[1] : null;
}

function index(spec: DiagramSpec, svg: SVGSVGElement): Drawn {
    const nodes = new Map<string, SVGGElement>();
    const known = new Set(spec.nodes.map((n) => n.id));
    svg.querySelectorAll<SVGGElement>('g.node').forEach((g) => {
        const id = idOfNode(g);
        if (id && known.has(id)) nodes.set(id, g);
    });
    // Edges: the path carries LS-<from> LE-<to> classes (unique per pair, the gate sees to it);
    // a label is found by the index written into its own span.
    const labels = new Map<number, Element>();
    svg.querySelectorAll('.dg-el[data-e]').forEach((span) => {
        const i = Number(span.getAttribute('data-e'));
        const host = span.closest('.edgeLabel') || span;
        if (Number.isFinite(i)) labels.set(i, host);
    });
    const edges: EdgeView[] = spec.edges.map((e, i) => {
        const path = svg.querySelector<SVGPathElement>(`path.LS-${cssId(e.from)}.LE-${cssId(e.to)}`);
        return { e, path, label: labels.get(i) || null };
    });
    return { spec, svg, nodes, edges };
}
const cssId = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, (c) => `\\${c}`);

/** Classes the stylesheet needs that mermaid cannot write itself. */
function decorate(d: Drawn): void {
    d.svg.classList.add('dgv-svg');
    d.svg.removeAttribute('style');
    for (const n of d.spec.nodes) {
        const g = d.nodes.get(n.id);
        if (!g) continue;
        g.classList.add('dgv-node', `dgk-${n.kind}`);
        if (n.link) g.classList.add('dgv-drill');
        g.setAttribute('tabindex', '-1');
        g.setAttribute('role', 'button');
        g.setAttribute('aria-label', `${kindName(n.kind)}: ${nodeLabel(d.spec, n.id)}`);
    }
    for (const ev of d.edges) {
        const cls = ['dgv-edge', `dgv-tone-${ev.e.tone || 'none'}`];
        if (ev.e.thick) cls.push('dgv-main');
        if (ev.e.dashed) cls.push('dgv-weak');
        ev.path?.classList.add(...cls);
        ev.label?.classList.add('dgv-elabel', `dgv-tone-${ev.e.tone || 'none'}`);
    }
    (d.spec.groups || []).forEach((g) => {
        d.svg.querySelector(`#${cssId(groupDomId(g.id))}`)?.classList.add('dgv-group');
    });
}

// ── interactions on the drawing ────────────────────────────────────────────────────────────

function wireNodes(d: Drawn): void {
    for (const [id, g] of d.nodes) {
        g.addEventListener('mouseenter', () => { hovered = id; paintFocus(); });
        g.addEventListener('mouseleave', () => { if (hovered === id) { hovered = null; paintFocus(); } });
        g.addEventListener('dblclick', (e) => {
            const link = d.spec.nodes.find((n) => n.id === id)?.link;
            if (link) { e.stopPropagation(); void openSpec(link, { push: true }); }
        });
    }
}

const neighbours = (spec: DiagramSpec, id: string) => {
    const out = new Set<string>();
    for (const e of spec.edges) { if (e.from === id) out.add(e.to); if (e.to === id) out.add(e.from); }
    return out;
};

/** Light the node in focus (hovered, else selected), its edges and its neighbours; dim the rest.
 *  With a search running and nothing in focus, the matches are lit instead. */
function paintFocus(): void {
    const d = drawn;
    if (!d) return;
    const focus = hovered || selected;
    const svg = d.svg;
    svg.querySelectorAll('.dg-hl, .dg-hl-edge, .dg-match, .dg-sel').forEach((el) => el.classList.remove('dg-hl', 'dg-hl-edge', 'dg-match', 'dg-sel'));
    if (selected) d.nodes.get(selected)?.classList.add('dg-sel');
    if (focus) {
        svg.classList.add('dg-focus');
        d.nodes.get(focus)?.classList.add('dg-hl');
        neighbours(d.spec, focus).forEach((n) => d.nodes.get(n)?.classList.add('dg-hl'));
        for (const ev of d.edges) {
            if (ev.e.from === focus || ev.e.to === focus) {
                ev.path?.classList.add('dg-hl-edge');
                ev.label?.classList.add('dg-hl-edge');
            }
        }
    } else if (searchHits.length) {
        svg.classList.add('dg-focus');
        searchHits.forEach((n) => d.nodes.get(n)?.classList.add('dg-hl', 'dg-match'));
    } else {
        svg.classList.remove('dg-focus');
    }
    searchHits.forEach((n) => d.nodes.get(n)?.classList.add('dg-match'));
}

function select(id: string | null, center = false): void {
    const d = drawn;
    if (!d) return;
    selected = id && d.nodes.has(id) ? id : null;
    paintFocus();
    renderPanel(d.spec, selected);
    if (selected && center) centerOn(d.nodes.get(selected)!);
}

function onStageKey(e: KeyboardEvent): void {
    const d = drawn;
    if (!d) return;
    const k = e.key;
    if (k === '/' || (k === 'f' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        $<HTMLInputElement>('#modal-docs-diagram .dgv-search')?.focus();
        return;
    }
    if (k === '+' || k === '=') { e.preventDefault(); doZoom('in'); return; }
    if (k === '-' || k === '_') { e.preventDefault(); doZoom('out'); return; }
    if (k === '0') { e.preventDefault(); doZoom('fit'); return; }
    if (k === 'Escape') {
        if (selected) { e.preventDefault(); select(null); }
        return; // nothing selected: let the dialog close
    }
    if (k === 'Enter' || k === ' ') {
        if (!selected) { e.preventDefault(); select(firstNode(d), true); return; }
        const link = d.spec.nodes.find((n) => n.id === selected)?.link;
        if (link && k === 'Enter') { e.preventDefault(); void openSpec(link, { push: true }); }
        return;
    }
    const dir = ({ ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] } as Record<string, [number, number]>)[k];
    if (dir) {
        e.preventDefault();
        if (!selected) { select(firstNode(d), true); return; }
        const next = nearestInDirection(d, selected, dir);
        if (next) select(next, true);
    }
    if (k === 'Home') { e.preventDefault(); select(firstNode(d), true); }
}

const centre = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

/** The top-left-most node in reading order. */
function firstNode(d: Drawn): string | null {
    let best: string | null = null;
    let score = Infinity;
    for (const [id, g] of d.nodes) {
        const c = centre(g);
        const s = c.y * 4 + c.x;
        if (s < score) { score = s; best = id; }
    }
    return best;
}

/** The node closest to `from` within a 50° cone of the arrow key's direction. */
function nearestInDirection(d: Drawn, from: string, [dx, dy]: [number, number]): string | null {
    const a = centre(d.nodes.get(from)!);
    let best: string | null = null;
    let bestScore = Infinity;
    for (const [id, g] of d.nodes) {
        if (id === from) continue;
        const b = centre(g);
        const vx = b.x - a.x, vy = b.y - a.y;
        const along = vx * dx + vy * dy;
        if (along <= 2) continue;
        const across = Math.abs(vx * dy - vy * dx);
        if (across > along * 1.2) continue;
        const s = along + across * 2;
        if (s < bestScore) { bestScore = s; best = id; }
    }
    return best;
}

// ── search ─────────────────────────────────────────────────────────────────────────────────

function runSearch(q: string): void {
    const d = drawn;
    const count = $('#modal-docs-diagram .dgv-count');
    const terms = fold(q).split(/\s+/).filter(Boolean);
    searchCursor = -1;
    if (!d || !terms.length) {
        searchHits = [];
        if (count) count.textContent = '';
        paintFocus();
        return;
    }
    searchHits = d.spec.nodes.filter((n) => {
        const hay = fold([nodeLabel(d.spec, n.id), nodeDesc(d.spec, n.id), kindName(n.kind), ...n.refs].join(' '));
        return terms.every((term) => hay.includes(term));
    }).map((n) => n.id);
    if (count) count.textContent = searchHits.length ? t('docs.diagram.ui.matches', { n: String(searchHits.length) }) : t('docs.diagram.ui.noMatch');
    // Typing must not steal the panel from a node the reader picked.
    hovered = null;
    paintFocus();
}

function stepSearch(step: number): void {
    if (!searchHits.length) return;
    searchCursor = (searchCursor + step + searchHits.length) % searchHits.length;
    select(searchHits[searchCursor], true);
}

// ── zoom ───────────────────────────────────────────────────────────────────────────────────

async function initPanZoom(svg: SVGSVGElement): Promise<void> {
    const svgPanZoom = await ensureSvgPanZoom().catch(() => null);
    // Fit to what was actually drawn. Mermaid's own viewBox can be offset from the content (a
    // cluster title or an edge label laid out past it), and svg-pan-zoom fits and centres on the
    // viewBox: the picture then lands off-centre with one side cut.
    try {
        const bb = svg.getBBox();
        if (bb.width > 0 && bb.height > 0) {
            const pad = 12;
            svg.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${bb.width + pad * 2} ${bb.height + pad * 2}`);
        }
    } catch { /* not rendered (hidden): keep mermaid's */ }
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.maxWidth = 'none';
    svg.style.width = '100%';
    svg.style.height = '100%';
    if (panZoom) { try { panZoom.destroy(); } catch { /* gone */ } panZoom = null; }
    if (!svgPanZoom) return; // still readable, just not draggable
    panZoom = svgPanZoom(svg, {
        zoomEnabled: true, controlIconsEnabled: false, fit: true, center: true,
        minZoom: 0.1, maxZoom: 12, zoomScaleSensitivity: 0.3, dblClickZoomEnabled: false,
    });
    // The dialog animates in; measure again once it has its real size.
    setTimeout(() => { try { panZoom?.resize(); panZoom?.fit(); panZoom?.center(); capZoom(); } catch { /* closed meanwhile */ } }, 60);
}

/** A tiny diagram fitted to a big stage would be drawn at 300%: cap the fit at a readable 1.6. */
function capZoom(): void {
    if (!panZoom) return;
    const z = panZoom.getZoom();
    if (z > 1.6) { panZoom.zoom(1.6); panZoom.center(); }
}

function doZoom(how: string): void {
    if (!panZoom) return;
    if (how === 'in') panZoom.zoomIn();
    else if (how === 'out') panZoom.zoomOut();
    else { panZoom.resize(); panZoom.fit(); panZoom.center(); capZoom(); }
}

function centerOn(el: Element): void {
    if (!panZoom) { (el as any).scrollIntoView?.({ block: 'center', inline: 'center' }); return; }
    const stage = $('#modal-docs-diagram .dgv-stage');
    if (!stage) return;
    const s = stage.getBoundingClientRect();
    const c = centre(el);
    if (panZoom.getZoom() < 0.7) panZoom.zoomAtPoint(0.9, { x: c.x - s.left, y: c.y - s.top });
    const c2 = centre(el);
    panZoom.panBy({ x: s.left + s.width / 2 - c2.x, y: s.top + s.height / 2 - c2.y });
}

// ── panel and legend ───────────────────────────────────────────────────────────────────────

function kindChip(k: NodeKind): string {
    return `<span class="dgp-kind dgk-${k}"><span class="dgp-swatch dgs-${k}"></span>${esc(kindName(k))}</span>`;
}

function refHtml(ref: string): string {
    const { path, symbol } = parseRef(ref);
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
    const file = slash >= 0 ? path.slice(slash + 1) : path;
    return `<li class="dgp-ref">
        <code class="dgp-path"><span class="dgp-dir">${esc(dir)}</span><span class="dgp-file">${esc(file)}</span>${symbol ? `<span class="dgp-sep"> › </span><span class="dgp-sym">${esc(symbol)}</span>` : ''}</code>
        <button type="button" class="dgp-copy" data-copy="${esc(ref)}" title="${esc(t('docs.diagram.ui.copy'))}" aria-label="${esc(t('docs.diagram.ui.copy'))}">${uiIcon('copy', 14)}</button>
    </li>`;
}

function nodeButtons(spec: DiagramSpec, ids: string[]): string {
    if (!ids.length) return `<span class="dgp-none">${esc(t('docs.diagram.ui.none'))}</span>`;
    return ids.map((id) => {
        const n = spec.nodes.find((x) => x.id === id)!;
        return `<button type="button" class="dgp-link" data-pick="${esc(id)}"><span class="dgp-swatch dgs-${n.kind}"></span>${esc(nodeLabel(spec, id))}</button>`;
    }).join('');
}

function edgeNote(spec: DiagramSpec, e: DiagramEdge): string {
    if (!e.label) return '';
    const key = e.label.startsWith('~') ? `docs.diagram.common.${e.label.slice(1)}` : `${spec.i18n}.e.${e.label}`;
    return ` <span class="dgp-elabel dgv-tone-${e.tone || 'none'}">${esc(t(key))}</span>`;
}

function renderPanel(spec: DiagramSpec, id: string | null = null): void {
    const panel = $('#modal-docs-diagram .dgv-panel');
    if (!panel) return;
    const n = id ? spec.nodes.find((x) => x.id === id) : null;
    if (n) { panel.innerHTML = nodePanel(spec, n); return; }
    panel.innerHTML = overviewPanel(spec);
}

function nodePanel(spec: DiagramSpec, n: DiagramNode): string {
    const ins = spec.edges.filter((e) => e.to === n.id);
    const outs = spec.edges.filter((e) => e.from === n.id);
    const group = n.group ? `<span class="dgp-group">${esc(t(groupKey(spec, n.group)))}</span>` : '';
    const link = n.link && registry[n.link]
        ? `<button type="button" class="dgp-cta" data-open-diagram="${esc(n.link)}">${uiIcon('workflow', 16)}<span>${esc(t('docs.diagram.ui.openDiagram', { title: t(`${registry[n.link].i18n}.title`) }))}</span></button>`
        : '';
    const list = (edges: DiagramEdge[], side: 'from' | 'to') => edges.length
        ? edges.map((e) => {
            const other = side === 'from' ? e.from : e.to;
            const o = spec.nodes.find((x) => x.id === other)!;
            return `<button type="button" class="dgp-link" data-pick="${esc(other)}"><span class="dgp-swatch dgs-${o.kind}"></span><span class="dgp-link-t">${esc(nodeLabel(spec, other))}</span>${edgeNote(spec, e)}</button>`;
        }).join('')
        : `<span class="dgp-none">${esc(t('docs.diagram.ui.none'))}</span>`;
    return `
        <div class="dgp-head">
            <button type="button" class="dgp-backlink" data-clear>${uiIcon('chevron-left', 14)}<span>${esc(t('docs.diagram.ui.overview'))}</span></button>
            <div class="dgp-meta">${kindChip(n.kind)}${group}</div>
            <h3 class="dgp-title">${esc(nodeLabel(spec, n.id))}</h3>
        </div>
        <p class="dgp-desc">${esc(nodeDesc(spec, n.id))}</p>
        ${link}
        <h4 class="dgp-h">${uiIcon('code', 14)}<span>${esc(t('docs.diagram.ui.where'))}</span></h4>
        <ul class="dgp-refs">${n.refs.map(refHtml).join('')}</ul>
        <h4 class="dgp-h">${uiIcon('arrow-left', 14)}<span>${esc(t('docs.diagram.ui.from'))}</span></h4>
        <div class="dgp-links">${list(ins, 'from')}</div>
        <h4 class="dgp-h">${uiIcon('arrow-right', 14)}<span>${esc(t('docs.diagram.ui.to'))}</span></h4>
        <div class="dgp-links">${list(outs, 'to')}</div>`;
}

function overviewPanel(spec: DiagramSpec): string {
    const kinds = NODE_KINDS.filter((k) => spec.nodes.some((n) => n.kind === k));
    const legend = kinds.map((k) => `<li class="dgp-leg"><span class="dgp-shape dgsh-${k}"></span><span><b>${esc(kindName(k))}</b><small>${esc(t(`docs.diagram.kind.${k}.desc`))}</small></span></li>`).join('');
    const groups = (spec.groups || []).map((g) => {
        const ids = spec.nodes.filter((n) => n.group === g.id).map((n) => n.id);
        return `<div class="dgp-gblock"><div class="dgp-gname">${esc(t(groupKey(spec, g.id)))}</div><div class="dgp-links">${nodeButtons(spec, ids)}</div></div>`;
    }).join('');
    const loose = spec.nodes.filter((n) => !n.group).map((n) => n.id);
    const looseHtml = loose.length && spec.groups?.length ? `<div class="dgp-gblock"><div class="dgp-links">${nodeButtons(spec, loose)}</div></div>` : '';
    const article = spec.article
        ? `<button type="button" class="dgp-cta" data-article="${esc(spec.article)}">${uiIcon('book-open', 16)}<span>${esc(t('docs.diagram.ui.article'))}</span></button>`
        : '';
    const related = (spec.related || []).filter((r) => registry[r]).map((r) =>
        `<button type="button" class="dgp-rel" data-open-diagram="${esc(r)}">${uiIcon('workflow', 14)}<span>${esc(t(`${registry[r].i18n}.title`))}</span></button>`).join('');
    const refs = spec.nodes.reduce((s, n) => s + n.refs.length, 0);
    return `
        <p class="dgp-summary">${esc(t(`${spec.i18n}.summary`))}</p>
        <div class="dgp-stats"><span>${esc(t('docs.diagram.ui.nodes', { n: String(spec.nodes.length) }))}</span><span>${esc(t('docs.diagram.ui.refs', { n: String(refs) }))}</span><span>${esc(t(`docs.diagram.cat.${spec.category}`))}</span></div>
        ${article}
        <p class="dgp-hint">${uiIcon('info', 14)}<span>${esc(t('docs.diagram.ui.hint'))}</span></p>
        <h4 class="dgp-h">${uiIcon('layers', 14)}<span>${esc(t('docs.diagram.ui.steps'))}</span></h4>
        ${groups || `<div class="dgp-links">${nodeButtons(spec, spec.nodes.map((n) => n.id))}</div>`}${looseHtml}
        <h4 class="dgp-h">${uiIcon('map', 14)}<span>${esc(t('docs.diagram.ui.legend'))}</span></h4>
        <ul class="dgp-legend">${legend}</ul>
        ${related ? `<h4 class="dgp-h">${uiIcon('workflow', 14)}<span>${esc(t('docs.diagram.ui.related'))}</span></h4><div class="dgp-rels">${related}</div>` : ''}
        <p class="dgp-keys">${esc(t('docs.diagram.ui.keys'))}</p>`;
}

/** The compact on-canvas legend: the kinds this diagram uses, shape and name. */
function renderLegend(spec: DiagramSpec): void {
    const el = $('#modal-docs-diagram .dgv-legend');
    if (!el) return;
    const kinds = NODE_KINDS.filter((k) => spec.nodes.some((n) => n.kind === k));
    el.innerHTML = kinds.map((k) => `<span class="dgv-leg" title="${esc(t(`docs.diagram.kind.${k}.desc`))}"><span class="dgp-shape dgsh-${k}"></span>${esc(kindName(k))}</span>`).join('');
    el.setAttribute('aria-label', t('docs.diagram.ui.legend'));
}
