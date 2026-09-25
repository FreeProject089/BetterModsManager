// The scheduler's third editing mode: the task as a flow of nodes (sched-flow-model.ts has the
// rules; this file only draws them and turns gestures into edits of the SAME draft).
//
// What it deliberately does not have:
//   · a model of its own. Every render rebuilds the graph from `draft.steps`, so a change made
//     in Blocks or Code is simply there the next time this draws, and the reverse;
//   · field editors of its own. The inspector is the brick editor for one step, passed in by
//     the scheduler (FlowHost.renderInspector);
//   · a keyboard of its own. Every shortcut is a command in core/commands.ts (sched-flow-keys.ts):
//     listed in Ctrl+K and in Settings → Keyboard shortcuts, rebindable, scoped to this canvas;
//   · a permission check of its own. What a node will be refused is read from the executor's
//     list (ACTION_PERMS mirrors requirePerm, and a test proves it) through the scheduler's own
//     `hasPerm`; the flow only says it sooner, in the executor's own words.

import { t, getLang } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { toast } from '../../ui/app.js';
import { bindingOf, chordToStr } from '../../core/commands.js';
import {
    buildGraph, snap, setNudge, stampOf, resolve, slotOf, insertStep, removeSteps, duplicateStep, moveStep,
    neighbour, marksForDraft, missingPerms, ACTION_PERMS, findPath, lanesOf, bodiesOf, countInside,
    NODE_W, NODE_H, type FlowGraph, type FlowNode, type FlowEdge, type FlowLayout, type AnyStep, type PermKey, type RunMark,
} from './sched-flow-model.js';
import { bindFlowKeys, FLOW_KEYS, type FlowScope } from './sched-flow-keys.js';

type PickItem = { v: string; label: string; desc?: string; group: string };

/** What the scheduler lends the flow. Everything that decides something stays over there. */
export interface FlowHost {
    getDraft(): { id?: string; steps: AnyStep[]; trigger: any; layout?: FlowLayout };
    snapshot(): void;
    undo(): void;
    redo(): void;
    makeStep(kind: string): AnyStep;
    renderInspector(host: HTMLElement, step: AnyStep): void;
    hasPerm(key: PermKey): boolean;
    permLabel(key: string): string;
    stepTitle(step: AnyStep): string;
    stepSummary(step: AnyStep): string;
    triggerTitle(): string;
    kindIcon(kind: string): string;
    actionIcon(type: string): string;
    triggerIcon(): string;
    actionItems(): PickItem[];
    actionGroups(): { g: string; label: string; icon?: string }[];
    focusSidebar(selector: string): void;
    lastRun(): Promise<any | null>;
    /** The steps as saved — what the last run actually ran. */
    savedSteps(): AnyStep[] | null;
    switchMode(m: 'bricks' | 'code' | 'flow'): void;
}

// ── State. Module-level on purpose: an undo re-renders the whole editor, and the view and the
//    selection have to survive that. ─────────────────────────────────────────────────────────
let _host: FlowHost | null = null;
let _pane: HTMLElement | null = null;
let _canvas: HTMLElement | null = null;
let _world: HTMLElement | null = null;
let _svg: SVGSVGElement | null = null;
let _layer: HTMLElement | null = null;
let _insp: HTMLElement | null = null;
let _mini: HTMLElement | null = null;
let _zoomLbl: HTMLElement | null = null;
let _runLbl: HTMLElement | null = null;
let _palette: HTMLElement | null = null;
let _graph: FlowGraph | null = null;
const _views = new Map<string, { x: number; y: number; k: number }>();
let _view = { x: 40, y: 40, k: 1 };
let _sel: string[] = [];
let _inspected: string | null = null;
let _marks = new Map<string, { mark: RunMark; error?: string }>();
let _runRec: any = null;
let _runAt = 0;
let _needFirstView = false;
let _space = false;
let _pending = 0;
let _obs: MutationObserver | null = null;
let _keysBound = false;
let _ro: ResizeObserver | null = null;
/** The canvas had the focus when the Ctrl+K palette took it: the palette still offers the flow's commands. */
let _focusToPalette = false;

const SVGNS = 'http://www.w3.org/2000/svg';
const reduced = (): boolean => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const draftKey = (): string => _host?.getDraft().id || 'draft';

/** The stylesheet is this feature's own file, linked the first time the flow opens. */
function ensureCss(): void {
    if (document.getElementById('sched-flow-css')) return;
    const link = document.createElement('link');
    link.id = 'sched-flow-css';
    link.rel = 'stylesheet';
    link.href = 'css/sched-flow.css';
    document.head.appendChild(link);
}

// ── Mount ─────────────────────────────────────────────────────────────────────────────────────

export function mountFlow(pane: HTMLElement, host: FlowHost): void {
    ensureCss();
    bindKeys();
    _host = host;
    _pane = pane;
    _runRec = null;
    _view = _views.get(draftKey()) || _view;
    const fresh = !_views.has(draftKey());
    pane.innerHTML = `
        <div class="sflow-canvas" tabindex="0" role="application" aria-label="${escAttr(t('sched.flow.canvasAria'))}">
            <div class="sflow-world">
                <svg class="sflow-edges" xmlns="${SVGNS}" aria-hidden="true"></svg>
                <div class="sflow-layer"></div>
            </div>
        </div>
        <div class="sflow-bar" role="toolbar" aria-label="${escAttr(t('sched.flow.toolbar'))}">
            <button type="button" class="sflow-tb sflow-tb-add" data-act="add" data-tooltip="${escAttr(tip('sched.flow.add', 'sched.flow.addNode'))}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
                <span>${escHtml(t('sched.flow.add'))}</span></button>
            <span class="sflow-tb-sep"></span>
            <button type="button" class="sflow-tb" data-act="zoomOut" aria-label="${escAttr(t('sched.flow.zoomOut'))}" data-tooltip="${escAttr(tip('sched.flow.zoomOut', 'sched.flow.zoomOut'))}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
            <span class="sflow-zoom" aria-live="polite">100%</span>
            <button type="button" class="sflow-tb" data-act="zoomIn" aria-label="${escAttr(t('sched.flow.zoomIn'))}" data-tooltip="${escAttr(tip('sched.flow.zoomIn', 'sched.flow.zoomIn'))}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
            <button type="button" class="sflow-tb" data-act="fit" aria-label="${escAttr(t('sched.flow.fit'))}" data-tooltip="${escAttr(tip('sched.flow.fit', 'sched.flow.fit'))}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
            <button type="button" class="sflow-tb" data-act="layout" aria-label="${escAttr(t('sched.flow.autoLayout'))}" data-tooltip="${escAttr(tip('sched.flow.autoLayout', 'sched.flow.autoLayout'))}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="4" width="6" height="5" rx="1"/><rect x="15" y="15" width="6" height="5" rx="1"/><path d="M9 6.5h6M18 9v6"/></svg></button>
            <span class="sflow-tb-sep"></span>
            <button type="button" class="sflow-tb" data-act="keys" aria-label="${escAttr(t('sched.flow.keys'))}" data-tooltip="${escAttr(t('sched.flow.keys'))}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg></button>
            <span class="sflow-run" hidden></span>
        </div>
        <div class="sflow-mini" aria-label="${escAttr(t('sched.flow.minimap'))}"></div>
        <aside class="sflow-insp" hidden aria-label="${escAttr(t('sched.flow.inspector'))}"></aside>`;
    _canvas = pane.querySelector('.sflow-canvas');
    _world = pane.querySelector('.sflow-world');
    _svg = pane.querySelector('.sflow-edges');
    _layer = pane.querySelector('.sflow-layer');
    _insp = pane.querySelector('.sflow-insp');
    _mini = pane.querySelector('.sflow-mini');
    _zoomLbl = pane.querySelector('.sflow-zoom');
    _runLbl = pane.querySelector('.sflow-run');
    wireCanvas();
    wireToolbar();
    render();
    applyView();
    const keep = _inspected;
    if (keep && (keep === 'trigger' || resolve(host.getDraft().steps, keep))) openInspector(keep, false);
    // After the modal is on screen: the canvas has no size before, so a fit would measure
    // nothing, and a hidden element cannot take the focus.
    // A timer and not requestAnimationFrame: rAF does not run in a window that is not visible,
    // and the first view must not depend on the window having been looked at.
    setTimeout(() => {
        if (!_canvas || !_canvas.isConnected) return;
        if (fresh) { if (_canvas.clientWidth) firstView(); else _needFirstView = true; }
        // Keyboard first: the canvas takes the focus, so the arrows and / work straight away.
        if (!_insp || _insp.hidden) focusCanvasSoon();
    }, 0);
    void loadRun();
}

/**
 * The modal fades in, and an element that is not visible yet refuses the focus without a word.
 * So: try a few times while it opens, and stop the moment anything else has the focus — the
 * person clicking a field first wins.
 */
function focusCanvasSoon(tries = 6): void {
    const c = _canvas;
    if (!c || !c.isConnected) return;
    const a = document.activeElement;
    if (a && a !== document.body && a !== c && !a.closest?.('.sflow-canvas')) return;
    c.focus({ preventScroll: true });
    if (document.activeElement !== c && tries > 0) setTimeout(() => focusCanvasSoon(tries - 1), 80);
}

export function unmountFlow(): void {
    _obs?.disconnect();
    _obs = null;
    _ro?.disconnect();
    _ro = null;
    closePalette();
    _host = null;
    _pane = null;
}

/** The flow owns the keyboard only while it is on screen and has the focus (or nothing has). */
function scopeActive(scope: FlowScope): boolean {
    const modal = document.getElementById('modal-scheduler');
    if (!modal || !modal.classList.contains('open')) return false;
    if (scope === 'editor') return !_palette;
    if (!_host || !_pane || _pane.hidden || !_pane.isConnected || _palette) return false;
    const a = document.activeElement;
    if (a?.closest?.('.cp-overlay')) return _focusToPalette;
    return !a || a === document.body || a === modal || !!_canvas?.contains(a);
}

function bindKeys(): void {
    if (_keysBound) return;
    _keysBound = true;
    bindFlowKeys({
        'sched.flow.addNode': () => openPaletteAt(defaultInsertPoint()),
        'sched.flow.edit': () => { const id = _sel[_sel.length - 1]; if (id) openInspector(id, true); },
        'sched.flow.delete': () => { void deleteSelection(); },
        'sched.flow.duplicate': () => duplicateSelection(),
        'sched.flow.undo': () => _host?.undo(),
        'sched.flow.redo': () => _host?.redo(),
        'sched.flow.selectAll': () => { if (_graph) select(_graph.nodes.filter((n) => n.type === 'step').map((n) => n.id)); },
        'sched.flow.next': () => step('right'),
        'sched.flow.prev': () => step('left'),
        'sched.flow.up': () => step('up'),
        'sched.flow.down': () => step('down'),
        'sched.flow.moveEarlier': () => reorder(-1),
        'sched.flow.moveLater': () => reorder(1),
        'sched.flow.zoomIn': () => zoomBy(1.2),
        'sched.flow.zoomOut': () => zoomBy(1 / 1.2),
        'sched.flow.fit': () => fit(1.25),
        'sched.flow.autoLayout': () => autoLayout(),
        'sched.mode.blocks': () => _modeSwitch('bricks'),
        'sched.mode.code': () => _modeSwitch('code'),
        'sched.mode.flow': () => _modeSwitch('flow'),
    }, scopeActive);
}
/** The mode commands work from any mode, so they go through the modal's own buttons. */
function _modeSwitch(m: 'bricks' | 'code' | 'flow'): void {
    const b = document.querySelector(`#modal-scheduler .sched-mode-btn[data-mode="${m}"]`) as HTMLElement | null;
    b?.click();
}

/** "Add a node (/)" — the current binding, not the default: it is the user's keyboard. */
function tip(labelKey: string, cmdId: string): string {
    const ch = bindingOf(cmdId);
    return ch ? `${t(labelKey)} (${chordToStr(ch)})` : t(labelKey);
}

// ── Render ────────────────────────────────────────────────────────────────────────────────────

function scheduleRender(): void {
    if (_pending) return;
    _pending = window.setTimeout(() => { _pending = 0; render(); }, 16);
}

function laneLabel(step: AnyStep | undefined, e: FlowEdge): string {
    switch (e.lane) {
        case 'then': return t('sched.then');
        case 'else': return t('sched.else');
        case 'fix': return t('sched.ensure.fix');
        case 'try': return t('sched.tryDo');
        case 'catch': return t('sched.tryCatch');
        case 'default': return t('sched.switchDefault');
        case 'branch': return t('sched.par.branch').replace('{n}', String(e.n || 1));
        case 'case': return `${t('sched.switchCase')} ${e.n || 1}`;
        case 'body': return step?.kind === 'forEach' ? t('sched.fe.body') : step?.kind === 'retry' ? t('sched.retry.body') : t('sched.loopBody');
        default: return '';
    }
}

function render(): void {
    if (!_host || !_layer || !_svg || !_world) return;
    const draft = _host.getDraft();
    const g = buildGraph(draft.steps || [], draft.layout);
    _graph = g;
    _marks = marksForDraft(_host.savedSteps(), _runRec, draft.steps || []);
    // Drop a selection that no longer points at anything (an undo, an edit in another mode).
    _sel = _sel.filter((id) => g.nodes.some((n) => n.id === id));
    const missing = missingPerms({ steps: draft.steps || [], trigger: draft.trigger }, (k) => _host!.hasPerm(k));
    const needsAt = new Map<string, string[]>();
    for (const m of missing) {
        const list = needsAt.get(m.path) || [];
        const what = _host.permLabel(m.label);
        const line = t('sched.permDenied').replace('{what}', what);
        if (!list.includes(line)) list.push(line);
        needsAt.set(m.path, list);
    }
    const W = g.width + 400;
    const H = g.height + 300;
    _world.style.width = `${W}px`;
    _world.style.height = `${H}px`;
    _svg.setAttribute('width', String(W));
    _svg.setAttribute('height', String(H));
    _svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    _svg.innerHTML = g.edges.map((e) => edgeSvg(g, e)).join('');

    const html: string[] = [];
    for (const n of g.nodes) {
        if (n.type === 'join') {
            html.push(`<span class="sflow-join" style="left:${n.x}px;top:${n.y}px" data-tooltip="${escAttr(t('sched.flow.join'))}"></span>`);
            continue;
        }
        if (n.type === 'add') {
            const lbl = n.id.endsWith('#end') ? t('sched.flow.addEnd') : t('sched.flow.addHere');
            html.push(`<button type="button" class="sflow-addnode" style="left:${n.x}px;top:${n.y}px" data-slot="${escAttr(n.slot || '')}" data-index="${n.index || 0}"
                aria-label="${escAttr(lbl)}" data-tooltip="${escAttr(lbl)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>`);
            continue;
        }
        html.push(nodeHtml(n, draft, needsAt.get(n.id) || []));
    }
    // A "+" in the middle of every edge that can take a step, and a label on every lane.
    for (const e of g.edges) {
        const a = g.nodes.find((n) => n.id === e.from)!;
        const b = g.nodes.find((n) => n.id === e.to)!;
        if (!a || !b) continue;
        if (e.kind === 'lane') {
            const st = resolve(draft.steps, e.from) as AnyStep | undefined;
            const label = laneLabel(st, e);
            const cond = e.lane === 'case' ? caseCond(st, (e.n || 1) - 1) : '';
            html.push(`<span class="sflow-lane" style="left:${b.x - 10}px;top:${b.y - 20}px"${cond ? ` data-tooltip="${escAttr(cond)}"` : ''}>${escHtml(label)}${cond ? `<i>${escHtml(cond)}</i>` : ''}</span>`);
        }
        if (e.insert) {
            const [x1, y1] = outPort(a, e);
            const x2 = b.x;
            const y2 = b.y + b.h / 2;
            const mx = e.kind === 'lane' ? x2 - 22 : (x1 + x2) / 2;
            const my = e.kind === 'lane' ? y2 : (y1 + y2) / 2;
            html.push(`<button type="button" class="sflow-edgeadd" style="left:${mx - 10}px;top:${my - 10}px" data-slot="${escAttr(e.insert.slot)}" data-index="${e.insert.index}"
                aria-label="${escAttr(t('sched.flow.addHere'))}" data-tooltip="${escAttr(t('sched.flow.addHere'))}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>`);
        }
    }
    if (!(draft.steps || []).length) {
        html.push(`<div class="sflow-emptyhint" style="left:${NODE_W + 110}px;top:${NODE_H / 2 - 10}px">${escHtml(tip('sched.flow.empty', 'sched.flow.addNode'))}</div>`);
    }
    _layer.innerHTML = html.join('');
    renderMini();
    if (_inspected && !_insp?.hidden) refreshInspectorHead();
}

function caseCond(st: AnyStep | undefined, i: number): string {
    const c = st?.cases?.[i]?.condition;
    if (!c?.type) return '';
    const label = t('sched.cond.' + c.type) || c.type;
    return c.negate ? `${t('sched.condNot')} ${label}` : label;
}

function nodeHtml(n: FlowNode, draft: ReturnType<FlowHost['getDraft']>, needs: string[]): string {
    const h = _host!;
    const sel = _sel.includes(n.id);
    if (n.type === 'trigger') {
        return `<div class="sflow-node sflow-trigger${sel ? ' is-sel' : ''}" data-id="trigger" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px"
            role="button" tabindex="-1" aria-label="${escAttr(t('sched.fTrigger') + ': ' + h.triggerTitle())}">
            <span class="sflow-ic">${h.triggerIcon()}</span>
            <span class="sflow-txt"><span class="sflow-title">${escHtml(t('sched.fTrigger'))}</span><span class="sflow-sub">${escHtml(h.triggerTitle())}</span></span>
            ${needs.length ? `<span class="sflow-warn" data-tooltip="${escAttr(needs.join('\n'))}">!</span>` : ''}
        </div>`;
    }
    const st = resolve(draft.steps, n.path!) as AnyStep;
    if (!st) return '';
    const kind = st.kind;
    const icon = kind === 'action' ? h.actionIcon(String(st.action?.type || '')) : h.kindIcon(['break', 'continue', 'stop'].includes(kind) ? 'signal' : kind);
    const title = kind === 'break' ? t('sched.break') : kind === 'continue' ? t('sched.continue') : kind === 'stop' ? t('sched.stop') : h.stepTitle(st);
    let sub = h.stepSummary(st);
    if (st.collapsed && lanesOf(st, n.path!).length) sub = (t('sched.flow.folded') || '').replace('{n}', String(countInside(st))) + (sub ? ` · ${sub}` : '');
    const run = _marks.get(n.path!);
    const branchy = ['if', 'switch', 'ensure'].includes(kind);
    const loopy = ['repeat', 'forEach', 'retry'].includes(kind);
    const cls = ['sflow-node', `k-${kind}`, branchy ? 'is-branch' : '', loopy ? 'is-loop' : '', sel ? 'is-sel' : '', st.disabled ? 'is-off' : '', needs.length ? 'is-warn' : ''].filter(Boolean).join(' ');
    const runTip = run ? `${t('sched.flow.run.' + run.mark)}${run.error ? ` — ${run.error}` : ''}` : '';
    return `<div class="${cls}" data-id="${escAttr(n.id)}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px"
        role="button" tabindex="-1" aria-label="${escAttr(`${title}${sub ? ' — ' + sub : ''}`)}">
        <span class="sflow-ic">${icon}</span>
        <span class="sflow-txt"><span class="sflow-title">${escHtml(title)}${st.disabled ? ` <em>${escHtml(t('sched.flow.off'))}</em>` : ''}</span>${sub ? `<span class="sflow-sub">${escHtml(sub)}</span>` : ''}</span>
        ${needs.length ? `<span class="sflow-warn" data-tooltip="${escAttr(needs.join('\n'))}">!</span>` : ''}
        ${run ? `<span class="sflow-dot run-${run.mark}" data-tooltip="${escAttr(runTip)}" aria-label="${escAttr(runTip)}"></span>` : ''}
    </div>`;
}

/** Where an edge leaves its node: the middle of its right edge. */
function outPort(a: FlowNode, _e: FlowEdge): [number, number] {
    return [a.x + a.w, a.y + a.h / 2];
}

function edgeSvg(g: FlowGraph, e: FlowEdge): string {
    const a = g.nodes.find((n) => n.id === e.from);
    const b = g.nodes.find((n) => n.id === e.to);
    if (!a || !b) return '';
    const hot = _sel.includes(e.from) || _sel.includes(e.to);
    const cls = `sflow-edge e-${e.kind}${hot ? ' is-hot' : ''}${e.lane === 'catch' ? ' is-catch' : ''}`;
    if (e.kind === 'loop') {
        // From under the join, along the bottom, back up into the step.
        const x1 = a.x + a.w / 2, y1 = a.y + a.h;
        const x2 = b.x + b.w / 2, y2 = b.y + b.h;
        const v = e.via!;
        return `<path class="${cls}" d="M${x1} ${y1} C${x1} ${v} ${x1} ${v} ${x1 - 16} ${v} L${x2 + 16} ${v} C${x2} ${v} ${x2} ${v} ${x2} ${y2}"/>`;
    }
    if (e.kind === 'bypass') {
        const x1 = a.x + a.w / 2, y1 = a.y;
        const x2 = b.x + b.w / 2, y2 = b.y;
        const v = e.via!;
        return `<path class="${cls}" d="M${x1} ${y1} C${x1} ${v} ${x1} ${v} ${x1 + 16} ${v} L${x2 - 16} ${v} C${x2} ${v} ${x2} ${v} ${x2} ${y2}"/>`;
    }
    const [x1, y1] = outPort(a, e);
    const x2 = b.x, y2 = b.y + b.h / 2;
    const dx = Math.max(24, Math.abs(x2 - x1) * 0.5);
    return `<path class="${cls}" d="M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}"/>`;
}

// ── Minimap ───────────────────────────────────────────────────────────────────────────────────

function renderMini(): void {
    if (!_mini || !_graph || !_canvas) return;
    const g = _graph;
    const MW = 168, MH = 96;
    const s = Math.min(MW / Math.max(1, g.width + 40), MH / Math.max(1, g.height + 40));
    const rects = g.nodes.filter((n) => n.type === 'step' || n.type === 'trigger')
        .map((n) => `<rect class="${_sel.includes(n.id) ? 'is-sel' : ''}" x="${(n.x + 20) * s}" y="${(n.y + 20) * s}" width="${Math.max(2, n.w * s)}" height="${Math.max(2, n.h * s)}" rx="1.5"/>`).join('');
    const cw = _canvas.clientWidth, ch = _canvas.clientHeight;
    const vx = (-_view.x / _view.k + 20) * s, vy = (-_view.y / _view.k + 20) * s;
    const vw = (cw / _view.k) * s, vh = (ch / _view.k) * s;
    _mini.innerHTML = `<svg width="${MW}" height="${MH}" viewBox="0 0 ${MW} ${MH}" xmlns="${SVGNS}">${rects}<rect class="sflow-mini-view" x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="2"/></svg>`;
    // Hidden when everything already fits: an overview of what you can already see is noise.
    const fitsX = g.width * _view.k + 80 < cw, fitsY = g.height * _view.k + 80 < ch;
    _mini.classList.toggle('is-idle', fitsX && fitsY);
    (_mini as any)._scale = s;
}

// ── View ──────────────────────────────────────────────────────────────────────────────────────

function applyView(): void {
    if (!_world) return;
    _world.style.transform = `translate(${_view.x}px, ${_view.y}px) scale(${_view.k})`;
    // The dot grid moves and scales with the world, so panning reads as moving the paper.
    if (_canvas) {
        _canvas.style.backgroundPosition = `${_view.x}px ${_view.y}px`;
        _canvas.style.backgroundSize = `${20 * _view.k}px ${20 * _view.k}px`;
    }
    if (_zoomLbl) _zoomLbl.textContent = `${Math.round(_view.k * 100)}%`;
    _views.set(draftKey(), { ..._view });
    renderMini();
}

function zoomAt(k: number, cx: number, cy: number): void {
    const nk = Math.max(0.3, Math.min(2, k));
    const wx = (cx - _view.x) / _view.k, wy = (cy - _view.y) / _view.k;
    _view = { k: nk, x: cx - wx * nk, y: cy - wy * nk };
    applyView();
}
function zoomBy(f: number): void {
    if (!_canvas) return;
    zoomAt(_view.k * f, _canvas.clientWidth / 2, _canvas.clientHeight / 2);
}
function fit(maxK: number): void {
    if (!_canvas || !_graph) return;
    const cw = _canvas.clientWidth || 800, ch = _canvas.clientHeight || 500;
    const pad = 56;
    const k = Math.max(0.3, Math.min(maxK, (cw - pad * 2) / Math.max(1, _graph.width), (ch - pad * 2) / Math.max(1, _graph.height + 20)));
    _view = { k, x: Math.max(pad, (cw - _graph.width * k) / 2), y: Math.max(pad, (ch - _graph.height * k) / 2) };
    applyView();
}
/**
 * The view a task opens with. The whole task when it fits at a readable size; otherwise the
 * start of it — trigger on the left, at a size where the words can be read — because a
 * twenty-step task squeezed to 30% is a picture of boxes, not something to work in.
 */
function firstView(): void {
    if (!_canvas || !_graph) return;
    const cw = _canvas.clientWidth, ch = _canvas.clientHeight;
    if (!cw || !ch) { fit(1); return; }
    const pad = 56;
    const k = Math.min(1, (cw - pad * 2) / Math.max(1, _graph.width), (ch - pad * 2) / Math.max(1, _graph.height + 20));
    if (k >= 0.75) { fit(1); return; }
    const kk = Math.max(0.75, Math.min(1, (ch - pad * 2) / Math.max(1, _graph.height + 20)));
    _view = { k: kk, x: pad, y: Math.max(pad + 24, (ch - _graph.height * kk) / 2) };
    applyView();
}

/** Bring a node into view without moving the canvas when it already is. */
function reveal(id: string): void {
    if (!_canvas || !_graph) return;
    const n = _graph.nodes.find((x) => x.id === id);
    if (!n) return;
    // The inspector floats over the right of the canvas: a node behind it is not "in view".
    const cover = _insp && !_insp.hidden ? _insp.offsetWidth + 20 : 0;
    const cw = _canvas.clientWidth - cover, ch = _canvas.clientHeight;
    const sx = n.x * _view.k + _view.x, sy = n.y * _view.k + _view.y;
    const sw = n.w * _view.k, sh = n.h * _view.k;
    const m = 40;
    let { x, y } = _view;
    if (sx < m) x += m - sx; else if (sx + sw > cw - m) x -= sx + sw - (cw - m);
    if (sy < m) y += m - sy; else if (sy + sh > ch - m) y -= sy + sh - (ch - m);
    if (x !== _view.x || y !== _view.y) { _view = { ..._view, x, y }; applyView(); }
}

// ── Selection ─────────────────────────────────────────────────────────────────────────────────

function select(ids: string[], inspect = true): void {
    _sel = ids.filter((id, i) => ids.indexOf(id) === i);
    render();
    if (_sel.length === 1 && inspect) { openInspector(_sel[0], false); reveal(_sel[0]); }
    else if (_sel.length !== 1) closeInspector();
}
function step(dir: 'left' | 'right' | 'up' | 'down'): void {
    if (!_graph) return;
    const cur = _sel[_sel.length - 1];
    const next = cur ? neighbour(_graph, cur, dir) : _graph.order[0];
    if (!next) return;
    select([next]);
    reveal(next);
}

// ── Canvas gestures ───────────────────────────────────────────────────────────────────────────

function wireCanvas(): void {
    const c = _canvas!;
    c.addEventListener('focusin', () => { _focusToPalette = false; });
    c.addEventListener('focusout', (e) => { _focusToPalette = !!(e.relatedTarget as Element | null)?.closest?.('.cp-overlay'); });
    c.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        // A pinch on a trackpad arrives as ctrl+wheel; so does Ctrl + a mouse wheel.
        if (e.ctrlKey || e.metaKey) zoomAt(_view.k * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
        else { _view = { ..._view, x: _view.x - e.deltaX, y: _view.y - e.deltaY }; applyView(); }
    }, { passive: false });
    // Space held = a hand, like every canvas tool. A held modifier for the mouse, not a command.
    c.addEventListener('keydown', (e) => { if (e.code === 'Space' && !_space) { _space = true; c.classList.add('is-hand'); e.preventDefault(); } });
    c.addEventListener('keyup', (e) => { if (e.code === 'Space') { _space = false; c.classList.remove('is-hand'); } });
    c.addEventListener('blur', () => { _space = false; c.classList.remove('is-hand'); });

    c.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.button !== 1) return;
        const target = e.target as HTMLElement;
        const plus = target.closest('.sflow-addnode, .sflow-edgeadd') as HTMLElement | null;
        if (plus) {
            e.stopPropagation();
            const r = plus.getBoundingClientRect();
            openPaletteAt({ slot: plus.dataset.slot || '', index: Number(plus.dataset.index) || 0, x: r.left + r.width / 2, y: r.bottom + 6 });
            return;
        }
        c.focus({ preventScroll: true });
        const nodeEl = target.closest('.sflow-node') as HTMLElement | null;
        if (nodeEl && !_space && e.button === 0) { startNodeDrag(e, nodeEl.dataset.id!); return; }
        if (e.shiftKey && e.button === 0 && !_space) { startMarquee(e); return; }
        startPan(e, !nodeEl);
    });
    c.addEventListener('dblclick', (e) => {
        const nodeEl = (e.target as HTMLElement).closest('.sflow-node') as HTMLElement | null;
        if (nodeEl) openInspector(nodeEl.dataset.id!, true);
    });
    _ro?.disconnect();
    _ro = new ResizeObserver(() => {
        // Opened while the editor had no width yet (a window being resized): the first view
        // waits for a real size instead of fitting to nothing.
        if (_needFirstView && c.clientWidth) { _needFirstView = false; firstView(); }
        renderMini();
    });
    _ro.observe(c);
}

function startPan(e: PointerEvent, clearOnClick: boolean): void {
    const c = _canvas!;
    const x0 = e.clientX, y0 = e.clientY, v0 = { ..._view };
    let moved = false;
    c.setPointerCapture(e.pointerId);
    c.classList.add('is-panning');
    const mv = (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 3) moved = true;
        _view = { ...v0, x: v0.x + ev.clientX - x0, y: v0.y + ev.clientY - y0 };
        applyView();
    };
    const up = () => {
        c.removeEventListener('pointermove', mv);
        c.removeEventListener('pointerup', up);
        c.classList.remove('is-panning');
        if (!moved && clearOnClick) select([]);
    };
    c.addEventListener('pointermove', mv);
    c.addEventListener('pointerup', up);
}

function startMarquee(e: PointerEvent): void {
    const c = _canvas!;
    const r = c.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'sflow-marquee';
    c.appendChild(box);
    const x0 = e.clientX - r.left, y0 = e.clientY - r.top;
    c.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => {
        const x1 = ev.clientX - r.left, y1 = ev.clientY - r.top;
        Object.assign(box.style, { left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`, width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px` });
    };
    const up = (ev: PointerEvent) => {
        c.removeEventListener('pointermove', mv);
        c.removeEventListener('pointerup', up);
        box.remove();
        const x1 = ev.clientX - r.left, y1 = ev.clientY - r.top;
        const toW = (sx: number, sy: number) => [(sx - _view.x) / _view.k, (sy - _view.y) / _view.k];
        const [ax, ay] = toW(Math.min(x0, x1), Math.min(y0, y1));
        const [bx, by] = toW(Math.max(x0, x1), Math.max(y0, y1));
        const hit = (_graph?.nodes || []).filter((n) => n.type === 'step' && n.x < bx && n.x + n.w > ax && n.y < by && n.y + n.h > ay).map((n) => n.id);
        select([..._sel, ...hit]);
    };
    c.addEventListener('pointermove', mv);
    c.addEventListener('pointerup', up);
}

function startNodeDrag(e: PointerEvent, id: string): void {
    const c = _canvas!;
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
        // Add to / take out of the selection; no drag.
        select(_sel.includes(id) ? _sel.filter((x) => x !== id) : [..._sel, id]);
        return;
    }
    if (!_sel.includes(id)) select([id]);
    const moving = _sel.filter((x) => x === 'trigger' || _graph?.nodes.some((n) => n.id === x && n.type === 'step'));
    const x0 = e.clientX, y0 = e.clientY;
    let dx = 0, dy = 0, dragging = false;
    c.setPointerCapture(e.pointerId);
    const els = moving.map((mid) => _layer!.querySelector(`.sflow-node[data-id="${CSS.escape(mid)}"]`) as HTMLElement | null);
    const mv = (ev: PointerEvent) => {
        dx = (ev.clientX - x0) / _view.k;
        dy = (ev.clientY - y0) / _view.k;
        if (!dragging && Math.abs(dx) + Math.abs(dy) < 4 / _view.k) return;
        dragging = true;
        c.classList.add('is-dragging');
        for (const el of els) if (el) el.style.transform = `translate(${snap(dx)}px, ${snap(dy)}px)`;
        drawEdgesWith(moving, snap(dx), snap(dy));
    };
    const up = () => {
        c.removeEventListener('pointermove', mv);
        c.removeEventListener('pointerup', up);
        c.classList.remove('is-dragging');
        if (!dragging || !_host || !_graph) return;
        const draft = _host.getDraft();
        _host.snapshot();
        let lay = draft.layout;
        for (const mid of moving) {
            const n = _graph.nodes.find((x) => x.id === mid);
            if (!n) continue;
            const fx = snap(n.x + snap(dx)), fy = snap(n.y + snap(dy));
            const stamp = mid === 'trigger' ? 'trigger' : stampOf(resolve(draft.steps, mid));
            lay = setNudge(lay, mid, fx - n.ax, fy - n.ay, stamp);
        }
        draft.layout = lay;
        render();
    };
    c.addEventListener('pointermove', mv);
    c.addEventListener('pointerup', up);
}

/** Live edges while dragging: the same drawing, with the moving nodes shifted. */
function drawEdgesWith(ids: string[], dx: number, dy: number): void {
    if (!_graph || !_svg) return;
    const g: FlowGraph = { ..._graph, nodes: _graph.nodes.map((n) => (ids.includes(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) };
    _svg.innerHTML = g.edges.map((e) => edgeSvg(g, e)).join('');
}

// ── Toolbar ───────────────────────────────────────────────────────────────────────────────────

function wireToolbar(): void {
    _pane!.querySelector('.sflow-bar')?.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'add') openPaletteAt(defaultInsertPoint());
        else if (act === 'zoomIn') zoomBy(1.2);
        else if (act === 'zoomOut') zoomBy(1 / 1.2);
        else if (act === 'fit') fit(1.25);
        else if (act === 'layout') autoLayout();
        else if (act === 'keys') toggleKeysSheet(b);
    });
    _mini?.addEventListener('pointerdown', (e) => {
        const s = (_mini as any)._scale as number;
        if (!s || !_canvas) return;
        const r = _mini!.getBoundingClientRect();
        const wx = (e.clientX - r.left) / s - 20, wy = (e.clientY - r.top) / s - 20;
        _view = { ..._view, x: _canvas.clientWidth / 2 - wx * _view.k, y: _canvas.clientHeight / 2 - wy * _view.k };
        applyView();
    });
}

function autoLayout(): void {
    const d = _host?.getDraft();
    if (!d) return;
    if (d.layout) { _host!.snapshot(); delete d.layout; }
    render();
    fit(1.25);
    toast(t('sched.flow.laidOut'), 'info', 1600);
}

/** The flow's keyboard, read from the registry — so a rebound key shows as rebound. */
function toggleKeysSheet(anchor: HTMLElement): void {
    const open = _pane?.querySelector('.sflow-keys');
    if (open) { open.remove(); return; }
    const rows = FLOW_KEYS.map((k) => {
        const ch = bindingOf(k.id);
        const title = getLang() === 'fr' ? k.title.fr : k.title.en;
        return `<li><span>${escHtml(title.replace(/^[^:]+:\s*/, ''))}</span><kbd>${escHtml(ch ? chordToStr(ch) : t('sched.flow.unbound'))}</kbd></li>`;
    }).join('');
    const el = document.createElement('div');
    el.className = 'sflow-keys';
    el.innerHTML = `<div class="sflow-keys-h">${escHtml(t('sched.flow.keysTitle'))}</div><ul>${rows}
        <li><span>${escHtml(t('sched.flow.gPan'))}</span><kbd>${escHtml(t('sched.flow.gPanKey'))}</kbd></li>
        <li><span>${escHtml(t('sched.flow.gZoom'))}</span><kbd>${escHtml(t('sched.flow.gZoomKey'))}</kbd></li>
        <li><span>${escHtml(t('sched.flow.gSelect'))}</span><kbd>${escHtml(t('sched.flow.gSelectKey'))}</kbd></li></ul>
        <p>${escHtml(t('sched.flow.keysRebind'))}</p>`;
    _pane!.appendChild(el);
    void anchor;
}

// ── Edits ─────────────────────────────────────────────────────────────────────────────────────

function defaultInsertPoint(): { slot: string; index: number; x?: number; y?: number } {
    const d = _host!.getDraft();
    const id = _sel[_sel.length - 1];
    if (id && id !== 'trigger' && resolve(d.steps, id)) {
        const { slot, index } = slotOf(id);
        return { slot, index: index + 1 };
    }
    if (id === 'trigger') return { slot: '', index: 0 };
    return { slot: '', index: (d.steps || []).length };
}

function insertKind(slot: string, index: number, kind: string): void {
    if (!_host) return;
    const d = _host.getDraft();
    _host.snapshot();
    const stepObj = _host.makeStep(kind);
    const r = insertStep(d.steps, d.layout, slot, index, stepObj);
    d.layout = r.layout;
    _sel = [r.path];
    render();
    openInspector(r.path, true);
    reveal(r.path);
    // Said at the moment it is added, in the words the run would use to refuse it.
    const miss = missingPerms({ steps: d.steps, trigger: null }, (k) => _host!.hasPerm(k)).filter((m) => m.path === r.path || m.path.startsWith(r.path + '.'));
    if (miss.length) toast(t('sched.permDenied').replace('{what}', _host.permLabel(miss[0].label)), 'warning', 6000);
}

async function deleteSelection(): Promise<void> {
    if (!_host) return;
    const d = _host.getDraft();
    const targets = _sel.filter((id) => id !== 'trigger').map((id) => resolve(d.steps, id) as AnyStep).filter(Boolean);
    if (!targets.length) return;
    const withBodies = targets.some((st) => bodiesOf(st).some((b) => b.length > 0));
    if (withBodies || targets.length > 1) {
        const ok = await (window as any).confirmCustom?.(
            t('sched.delTitle'),
            targets.length > 1 ? t('sched.flow.delMany').replace('{n}', String(targets.length)) : t('sched.delConfirm'),
            'danger', { yesLabel: t('common.delete'), noLabel: t('common.cancel') });
        if (!ok) return;
    }
    // Where the selection goes next: the step before the first one removed, or its container.
    const first = _sel.find((id) => id !== 'trigger')!;
    const { slot, index } = slotOf(first);
    _host.snapshot();
    d.layout = removeSteps(d.steps, d.layout, targets);
    const after = index > 0 ? (slot ? `${slot}.${index - 1}` : String(index - 1)) : (slot ? slot.split('.').slice(0, -1).join('.').replace(/\.(cases|branches)$/, '') : 'trigger');
    _sel = [];
    closeInspector();
    render();
    const target = _graph?.nodes.some((n) => n.id === after) ? after : 'trigger';
    select([target], false);
    _canvas?.focus({ preventScroll: true });
}

function duplicateSelection(): void {
    if (!_host) return;
    const d = _host.getDraft();
    const targets = _sel.filter((id) => id !== 'trigger').map((id) => resolve(d.steps, id) as AnyStep).filter(Boolean);
    if (!targets.length) return;
    _host.snapshot();
    const copies: AnyStep[] = [];
    for (const st of targets) {
        const p = findPath(d.steps, st);
        if (p === null) continue;
        const r = duplicateStep(d.steps, d.layout, p);
        d.layout = r.layout;
        copies.push(resolve(d.steps, r.path));
    }
    const ids = copies.map((c) => findPath(d.steps, c)).filter((x): x is string => x !== null);
    select(ids);
}

function reorder(dir: -1 | 1): void {
    if (!_host || _sel.length !== 1 || _sel[0] === 'trigger') return;
    const d = _host.getDraft();
    _host.snapshot();
    const r = moveStep(d.steps, d.layout, _sel[0], dir);
    if (!r) return;
    d.layout = r.layout;
    select([r.path]);
    reveal(r.path);
}

// ── Node palette ──────────────────────────────────────────────────────────────────────────────

const CONTROL_KINDS: [string, string, string][] = [
    ['if', 'sched.addIf', 'sched.legendIf'], ['switch', 'sched.addSwitch', 'sched.legendSwitch'],
    ['ensure', 'sched.addEnsure', 'sched.legendEnsure'], ['repeat', 'sched.addLoop', 'sched.legendLoop'],
    ['forEach', 'sched.addForEach', 'sched.legendForEach'], ['parallel', 'sched.addParallel', 'sched.legendPar'],
    ['retry', 'sched.addRetry', 'sched.retry.hint'], ['try', 'sched.addTry', 'sched.legendTry'],
    ['waitFor', 'sched.addWaitFor', 'sched.legendWait'], ['delay', 'sched.addDelay', 'sched.legendDelay'],
    ['call', 'sched.addCall', 'sched.legendCall'], ['break', 'sched.addBreak', 'sched.legendBreak'],
    ['continue', 'sched.addContinue', 'sched.legendContinue'], ['stop', 'sched.addStop', 'sched.legendStop'],
];

function closePalette(): void {
    _palette?.remove();
    _palette = null;
}

function openPaletteAt(at: { slot: string; index: number; x?: number; y?: number }): void {
    if (!_host || !_pane) return;
    closePalette();
    const h = _host;
    type Row = { v: string; label: string; desc: string; group: string; icon: string; needs: string };
    const need = (type: string): string => {
        const r = ACTION_PERMS[type];
        if (!r || (r.when && !r.when({})) || h.hasPerm(r.perm)) return '';
        return t('sched.flow.needs').replace('{what}', h.permLabel(r.label));
    };
    const control: Row[] = CONTROL_KINDS.map(([k, lk, dk]) => ({
        v: k, label: t(lk), desc: t(dk), group: 'control', icon: h.kindIcon(['break', 'continue', 'stop'].includes(k) ? 'signal' : k), needs: '',
    }));
    const groups = h.actionGroups();
    const actions: Row[] = h.actionItems().map((a) => ({
        v: `action:${a.v}`, label: a.label, desc: a.desc || '', group: a.group,
        icon: groups.find((g) => g.g === a.group)?.icon || h.kindIcon('action'), needs: need(a.v),
    }));
    const all = [...control, ...actions];
    const groupLabel = (g: string) => (g === 'control' ? t('sched.flow.grpControl') : groups.find((x) => x.g === g)?.label || g);

    const el = document.createElement('div');
    el.className = 'sflow-palette';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', t('sched.flow.add'));
    el.innerHTML = `<div class="sflow-pal-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="search" class="sflow-pal-q" spellcheck="false" autocomplete="off" placeholder="${escAttr(t('sched.flow.search'))}" aria-label="${escAttr(t('sched.flow.search'))}">
        </div>
        <div class="sflow-pal-list" role="listbox"></div>
        <div class="sflow-pal-foot"><kbd>↑↓</kbd> ${escHtml(t('sched.flow.palMove'))} <kbd>↵</kbd> ${escHtml(t('sched.flow.palPick'))} <kbd>Esc</kbd> ${escHtml(t('sched.flow.palClose'))}</div>`;
    _pane.appendChild(el);
    _palette = el;
    // Placed at the "+" that opened it, kept inside the pane.
    const pr = _pane.getBoundingClientRect();
    const w = Math.min(380, pr.width - 24);
    let left = (at.x ?? pr.left + pr.width / 2 - w / 2) - pr.left - (at.x !== undefined ? w / 2 : 0);
    let top = (at.y ?? pr.top + 64) - pr.top;
    left = Math.max(12, Math.min(pr.width - w - 12, left));
    top = Math.max(12, Math.min(pr.height - 300, top));
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${w}px` });

    const q = el.querySelector('.sflow-pal-q') as HTMLInputElement;
    const list = el.querySelector('.sflow-pal-list') as HTMLElement;
    let rows: Row[] = [];
    let active = 0;
    const draw = () => {
        const toks = q.value.toLowerCase().split(/\s+/).filter(Boolean);
        rows = all.filter((r) => toks.every((tk) => `${r.label} ${r.desc} ${r.v} ${groupLabel(r.group)}`.toLowerCase().includes(tk)));
        // With a query, best first: the words in the NAME beat the words in the description.
        // Without one, the catalogue order, by group.
        if (toks.length) {
            const score = (r: Row) => {
                const l = r.label.toLowerCase();
                let n = 0;
                for (const tk of toks) n += l.startsWith(tk) ? 4 : new RegExp(`\\b${tk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(l) ? 3 : l.includes(tk) ? 2 : 0;
                return n;
            };
            rows = rows.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.r);
        }
        active = Math.min(active, Math.max(0, rows.length - 1));
        if (!rows.length) { list.innerHTML = `<div class="sflow-pal-empty">${escHtml(t('sched.flow.noMatch'))}</div>`; return; }
        let lastG = '';
        const ranked = !!q.value.trim();
        list.innerHTML = rows.map((r, i) => {
            const head = !ranked && r.group !== lastG ? `<div class="sflow-pal-g">${escHtml(groupLabel(r.group))}</div>` : '';
            lastG = r.group;
            return `${head}<button type="button" class="sflow-pal-item${i === active ? ' is-on' : ''}" role="option" aria-selected="${i === active}" data-i="${i}">
                <span class="sflow-ic">${r.icon}</span>
                <span class="sflow-pal-txt"><b>${escHtml(r.label)}</b>${r.desc ? `<span>${escHtml(r.desc)}</span>` : ''}</span>
                ${r.needs ? `<em class="sflow-pal-need" data-tooltip="${escAttr(r.needs)}">${escHtml(r.needs)}</em>` : ranked ? `<small class="sflow-pal-grp">${escHtml(groupLabel(r.group))}</small>` : ''}
            </button>`;
        }).join('');
        (list.querySelector('.is-on') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
    };
    const pick = (i: number) => {
        const r = rows[i];
        if (!r) return;
        closePalette();
        insertKind(at.slot, at.index, r.v);
    };
    q.addEventListener('input', () => { active = 0; draw(); });
    // The palette's own keys: a list widget's, not the app's shortcuts.
    q.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(rows.length - 1, active + 1); draw(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
        else if (e.key === 'Enter') { e.preventDefault(); pick(active); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); _canvas?.focus({ preventScroll: true }); }
    });
    list.addEventListener('mousedown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('.sflow-pal-item') as HTMLElement | null;
        if (b) pick(Number(b.dataset.i));
    });
    const away = (e: PointerEvent) => {
        if (_palette === el && el.contains(e.target as Node)) return;
        document.removeEventListener('pointerdown', away, true);
        if (_palette === el) closePalette();
    };
    document.addEventListener('pointerdown', away, true);
    draw();
    q.focus();
}

// ── Inspector ─────────────────────────────────────────────────────────────────────────────────

function closeInspector(): void {
    _obs?.disconnect();
    _obs = null;
    _inspected = null;
    if (_insp) { _insp.hidden = true; _insp.innerHTML = ''; }
}

function refreshInspectorHead(): void {
    if (!_insp || !_host || !_inspected) return;
    const head = _insp.querySelector('.sflow-insp-notes') as HTMLElement | null;
    if (head) head.innerHTML = notesHtml(_inspected);
}

function notesHtml(id: string): string {
    const h = _host!;
    const d = h.getDraft();
    const miss = missingPerms({ steps: d.steps || [], trigger: d.trigger }, (k) => h.hasPerm(k)).filter((m) => m.path === id);
    const seen = new Set<string>();
    const perm = miss.filter((m) => !seen.has(m.perm) && seen.add(m.perm)).map((m) => `<div class="sflow-note is-warn">
        <span>${escHtml(t('sched.permDenied').replace('{what}', h.permLabel(m.label)))}</span>
        <button type="button" class="btn btn-xs" data-grant="${escAttr(m.perm)}">${escHtml(t('sched.flow.grant'))}</button></div>`).join('');
    const run = id !== 'trigger' ? _marks.get(id) : undefined;
    const runNote = run ? `<div class="sflow-note run-${run.mark}"><span class="sflow-dot run-${run.mark}"></span><span>${escHtml(t('sched.flow.run.' + run.mark))}${run.error ? ` — ${escHtml(run.error)}` : ''}</span></div>` : '';
    return perm + runNote;
}

function openInspector(id: string, focus: boolean): void {
    if (!_insp || !_host) return;
    const h = _host;
    const d = h.getDraft();
    _obs?.disconnect();
    _inspected = id;
    if (id !== 'trigger' && !resolve(d.steps, id)) { closeInspector(); return; }
    const st = id === 'trigger' ? null : (resolve(d.steps, id) as AnyStep);
    const title = st ? h.stepTitle(st) : t('sched.fTrigger');
    const icon = st ? (st.kind === 'action' ? h.actionIcon(String(st.action?.type || '')) : h.kindIcon(st.kind)) : h.triggerIcon();
    _insp.hidden = false;
    _insp.innerHTML = `<div class="sflow-insp-head">
            <span class="sflow-ic">${icon}</span><b>${escHtml(title)}</b>
            <button type="button" class="sflow-insp-x" aria-label="${escAttr(t('common.close'))}">&times;</button>
        </div>
        <div class="sflow-insp-notes">${notesHtml(id)}</div>
        <div class="sflow-insp-body"></div>`;
    const body = _insp.querySelector('.sflow-insp-body') as HTMLElement;
    if (st) {
        h.renderInspector(body, st);
    } else {
        body.innerHTML = `<p class="sflow-insp-p">${escHtml(h.triggerTitle())}</p>
            <p class="sflow-insp-hint">${escHtml(t('sched.flow.triggerHint'))}</p>
            <button type="button" class="btn btn-sm" data-trigger>${escHtml(t('sched.flow.editTrigger'))}</button>`;
    }
    _insp.querySelector('.sflow-insp-x')?.addEventListener('click', () => { select([], false); _canvas?.focus({ preventScroll: true }); });
    _insp.addEventListener('click', onInspectorClick);
    // Anything edited in the inspector redraws the canvas (the title, the one-line summary,
    // a case added to a switch). The inspector itself is left alone so the caret stays put.
    _insp.oninput = () => scheduleRender();
    _insp.onchange = () => scheduleRender();
    _obs = new MutationObserver(() => scheduleRender());
    _obs.observe(body, { childList: true, subtree: true });
    if (focus) {
        const first = body.querySelector('input, select, textarea, button.sched-pickbtn, button') as HTMLElement | null;
        (first || (_insp.querySelector('.sflow-insp-x') as HTMLElement | null))?.focus();
    }
}

function onInspectorClick(e: Event): void {
    const el = e.target as HTMLElement;
    const g = el.closest('[data-grant]') as HTMLElement | null;
    if (g) { _host?.focusSidebar(`[data-perm="${g.dataset.grant}"]`); return; }
    if (el.closest('[data-trigger]')) { _host?.focusSidebar('#sched-trigger'); return; }
    // A click can change what the step is without typing (a checkbox, a picker), so redraw.
    scheduleRender();
}

// ── Last run ──────────────────────────────────────────────────────────────────────────────────

async function loadRun(): Promise<void> {
    const h = _host;
    if (!h) return;
    const rec = await h.lastRun();
    if (h !== _host) return;
    _runRec = rec;
    _runAt = rec?.at || 0;
    _marks = marksForDraft(h.savedSteps(), rec, h.getDraft().steps || []);
    if (_runLbl) {
        _runLbl.hidden = !rec;
        if (rec) {
            const ok = rec.ok === true;
            _runLbl.className = `sflow-run ${ok ? 'run-ok' : 'run-error'}`;
            _runLbl.innerHTML = `<span class="sflow-dot run-${ok ? 'ok' : 'error'}"></span>${escHtml(t('sched.flow.lastRun').replace('{when}', new Date(_runAt).toLocaleString()))}`;
            if (!_marks.size) _runLbl.setAttribute('data-tooltip', t('sched.flow.noPaths'));
        }
    }
    render();
}
