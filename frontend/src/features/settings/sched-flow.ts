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
    buildGraph, snap, setNudge, stampOf, resolve, slotOf, insertStep, removeSteps, duplicateStep, moveStep, relocateStep,
    neighbour, marksForDraft, missingPerms, ACTION_PERMS, findPath, lanesOf, bodiesOf, countInside,
    NODE_W, NODE_H, type FlowGraph, type FlowNode, type FlowEdge, type FlowLayout, type AnyStep, type PermKey, type RunMark,
} from './sched-flow-model.js';
import {
    normalizeUi, edgeKey, frameAround, insideFrame, hiddenBy, align, distribute, clipText, readClip, stepProblems,
    FRAME_HEAD, TONES, type FlowUi, type FlowFrame, type Tone, type AlignHow, type Box,
} from './sched-flow-ui.js';
import { bindFlowKeys, FLOW_KEYS, type FlowScope } from './sched-flow-keys.js';
import { varsOfStep } from './sched-debug-map.js';
import { uiIcon } from '../../ui/icons.js';

/** What a one-step test came back with (scheduler.ts testOneStep → sched-test.ts). */
export interface StepTestResult { ok: boolean; status?: number; excerpt?: string; message: string; skipped?: boolean }

/** The debugger's position, as the flow draws it (sched-debug.ts DebugEvent, the parts used). */
export interface FlowDebug { phase: 'paused' | 'running' | 'done' | 'failed' | 'closed'; path: string | null; rows: [string, string, string][]; error?: string }

type PickItem = { v: string; label: string; desc?: string; group: string };

/** What the scheduler lends the flow. Everything that decides something stays over there. */
export interface FlowHost {
    getDraft(): { id?: string; steps: AnyStep[]; trigger: any; layout?: FlowLayout; ui?: FlowUi };
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
    /** One line about what this step does, in the reader's language ('' when there is none). */
    describe(step: AnyStep): string;
    /** The "Learn more" link for this step's documentation (HTML, from core/learn-more.ts). */
    learnMore(step: AnyStep | null): string;
    /** Breakpoints live in the debugger (sched-debug.ts); the flow only shows and toggles them. */
    hasBreakpoint(path: string): boolean;
    toggleBreakpoint(path: string): void;
    /** Run this one step now, isolated, and say how it went. */
    testStep(path: string): Promise<StepTestResult>;
    /** The category an action belongs to (its registry group): the node's colour. */
    actionGroup(type: string): string;
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
/** Where a debug run stands, drawn on the nodes. Null when nothing is being debugged. */
let _dbg: FlowDebug | null = null;
/** A one-step test in flight or just finished, per node: the pulse, then the verdict. */
const _tests = new Map<string, 'testing' | 'ok' | 'fail'>();
let _tipEl: HTMLElement | null = null;
/** The frames layer, under the wires. */
let _framesEl: HTMLElement | null = null;
/** Nodes hidden by a folded frame, this render. */
let _hidden = new Map<string, FlowFrame>();
/** A frame picked with a click on its title bar (Delete removes the frame, never its nodes). */
let _selFrame: string | null = null;
/** Steps copied in the flow, for a paste when the system clipboard cannot be read. */
let _clip: AnyStep[] | null = null;
/** The open context menu or arrange menu. */
let _menu: HTMLElement | null = null;
/** Where the pointer last was over the canvas, in screen pixels (Tab opens the palette there). */
let _lastPointer: { x: number; y: number } | null = null;
/** Snap to the grid while dragging: on by default, remembered per person. */
let _snapOn = readSnap();

function readSnap(): boolean {
    try { return localStorage.getItem('bmm.sched.flow.snap') !== '0'; } catch { return true; }
}
function writeSnap(on: boolean): void {
    try { localStorage.setItem('bmm.sched.flow.snap', on ? '1' : '0'); } catch { /* private mode: this session only */ }
}
/** A dragged coordinate: on the grid when snapping is on. */
const sn = (v: number): number => (_snapOn ? snap(v) : Math.round(v));

/** The task's presentation block, never null. */
function uiOf(): FlowUi {
    return (_host?.getDraft().ui as FlowUi | undefined) || { v: 1 };
}
/** Store it back, checked; an empty block leaves no `ui` field at all. */
function setUi(next: FlowUi): void {
    const d = _host?.getDraft();
    if (!d) return;
    const n = normalizeUi(next);
    if (n) d.ui = n; else delete d.ui;
}

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
    _tipEl = null;
    _view = _views.get(draftKey()) || _view;
    const fresh = !_views.has(draftKey());
    pane.innerHTML = `
        <div class="sflow-canvas" tabindex="0" role="application" aria-label="${escAttr(t('sched.flow.canvasAria'))}">
            <div class="sflow-world">
                <div class="sflow-frames"></div>
                <svg class="sflow-edges" xmlns="${SVGNS}" aria-hidden="true"></svg>
                <div class="sflow-layer"></div>
            </div>
        </div>
        <div class="sflow-bar" role="toolbar" aria-label="${escAttr(t('sched.flow.toolbar'))}">
            <button type="button" class="sflow-tb sflow-tb-add" data-act="add" data-tooltip="${escAttr(tip('sched.flow.add', 'sched.flow.addNode'))}">
                ${uiIcon('add', 14)}
                <span>${escHtml(t('sched.flow.add'))}</span></button>
            <span class="sflow-tb-sep"></span>
            <button type="button" class="sflow-tb" data-act="zoomOut" aria-label="${escAttr(t('sched.flow.zoomOut'))}" data-tooltip="${escAttr(tip('sched.flow.zoomOut', 'sched.flow.zoomOut'))}">
                ${uiIcon('remove', 14)}</button>
            <span class="sflow-zoom" aria-live="polite">100%</span>
            <button type="button" class="sflow-tb" data-act="zoomIn" aria-label="${escAttr(t('sched.flow.zoomIn'))}" data-tooltip="${escAttr(tip('sched.flow.zoomIn', 'sched.flow.zoomIn'))}">
                ${uiIcon('add', 14)}</button>
            <button type="button" class="sflow-tb" data-act="fit" aria-label="${escAttr(t('sched.flow.fit'))}" data-tooltip="${escAttr(tip('sched.flow.fit', 'sched.flow.fit'))}">
                ${uiIcon('maximize', 14)}</button>
            <span class="sflow-tb-sep"></span>
            <button type="button" class="sflow-tb" data-act="arrange" aria-haspopup="menu" aria-label="${escAttr(t('sched.flow.arrange'))}" data-tooltip="${escAttr(t('sched.flow.arrange'))}">
                ${uiIcon('layers', 14)}<span>${escHtml(t('sched.flow.arrange'))}</span>${uiIcon('chevron-down', 12)}</button>
            <button type="button" class="sflow-tb" data-act="frame" aria-label="${escAttr(t('sched.flow.frame'))}" data-tooltip="${escAttr(tip('sched.flow.frame', 'sched.flow.frame'))}">
                ${uiIcon('maximize', 14)}</button>
            <button type="button" class="sflow-tb sflow-tb-toggle" data-act="snap" aria-pressed="${_snapOn ? 'true' : 'false'}" aria-label="${escAttr(t('sched.flow.snap'))}" data-tooltip="${escAttr(tip('sched.flow.snap', 'sched.flow.snap'))}">
                ${uiIcon('grid', 14)}</button>
            <span class="sflow-tb-sep"></span>
            <button type="button" class="sflow-tb" data-act="keys" aria-label="${escAttr(t('sched.flow.keys'))}" data-tooltip="${escAttr(t('sched.flow.keys'))}">
                ${uiIcon('keyboard', 14)}</button>
            <span class="sflow-run" hidden></span>
        </div>
        <div class="sflow-mini" aria-label="${escAttr(t('sched.flow.minimap'))}"></div>
        <aside class="sflow-insp" hidden aria-label="${escAttr(t('sched.flow.inspector'))}"></aside>`;
    _canvas = pane.querySelector('.sflow-canvas');
    _world = pane.querySelector('.sflow-world');
    _framesEl = pane.querySelector('.sflow-frames');
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
    _tipEl?.remove();
    _tipEl = null;
    closeMenu();
    _obs?.disconnect();
    _obs = null;
    _ro?.disconnect();
    _ro = null;
    closePalette();
    _host = null;
    _pane = null;
}

/**
 * Draw the debugger on the canvas: the node the run stands on glows (paused) or pulses (running),
 * a failed one turns red, and the view follows it. Values on hover come from `rows`.
 */
export function flowDebugPaint(ev: FlowDebug | null): void {
    _dbg = ev && ev.phase !== 'closed' && ev.phase !== 'done' ? ev : null;
    if (!_host || !_layer) return;
    render();
    if (_dbg?.path && (_dbg.phase === 'paused' || _dbg.phase === 'failed')) reveal(_dbg.path);
    if (_inspected && _insp && !_insp.hidden) refreshInspectorDebug();
}

/** The breakpoints changed somewhere (a brick, a gutter line): redraw the dots. */
export function flowRefresh(): void {
    if (_host && _layer) render();
    if (_inspected && _insp && !_insp.hidden) refreshInspectorDebug();
}

/** Select and show one step — the debugger's "jump to step". */
export function flowReveal(path: string): void {
    if (!_host || !_graph) return;
    if (!_graph.nodes.some((n) => n.id === path)) return;
    select([path]);
    reveal(path);
}

/** The step the keyboard would act on: the one selected. */
export function flowSelectedPath(): string | null {
    const id = _sel[_sel.length - 1];
    return id && id !== 'trigger' ? id : null;
}

/** Test the selected step (T). The pulse is on the node; the verdict in the inspector. */
export function flowTestSelected(): void {
    const id = flowSelectedPath();
    if (id) void runNodeTest(id);
}

async function runNodeTest(path: string): Promise<void> {
    const h = _host;
    if (!h) return;
    _tests.set(path, 'testing');
    render();
    paintTestOut(path, null);
    let res: StepTestResult;
    try { res = await h.testStep(path); } catch (e) { res = { ok: false, message: String(e) }; }
    if (res.skipped) { _tests.delete(path); render(); paintTestOut(path, null); return; }
    _tests.set(path, res.ok ? 'ok' : 'fail');
    render();
    paintTestOut(path, res);
    // The verdict stays long enough to be read, then the node goes back to normal. A failure
    // stays until the next test: it is the one thing on the canvas somebody has to act on.
    if (res.ok) setTimeout(() => { if (_tests.get(path) === 'ok') { _tests.delete(path); render(); } }, 4000);
}

function paintTestOut(path: string, res: StepTestResult | null): void {
    if (!_insp || _inspected !== path) return;
    const out = _insp.querySelector('.sflow-test-out') as HTMLElement | null;
    const btn = _insp.querySelector('[data-test]') as HTMLButtonElement | null;
    if (btn) btn.disabled = _tests.get(path) === 'testing';
    if (!out) return;
    if (!res) {
        out.className = `sflow-test-out${_tests.get(path) === 'testing' ? ' is-testing' : ''}`;
        out.textContent = _tests.get(path) === 'testing' ? t('sched.test.running') : '';
        return;
    }
    out.className = `sflow-test-out ${res.ok ? 'is-ok' : 'is-fail'}`;
    out.innerHTML = `<b>${escHtml(res.message)}</b>${res.status ? ` <span class="sflow-test-status">HTTP ${res.status}</span>` : ''}${res.excerpt ? `<code>${escHtml(res.excerpt)}</code>` : ''}`;
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
        'sched.flow.testNode': () => flowTestSelected(),
        'sched.flow.palette': () => openPaletteAt({ ...defaultInsertPoint(), ...(_lastPointer || {}) }),
        'sched.flow.copy': () => { void copySelection(false); },
        'sched.flow.cut': () => { void copySelection(true); },
        'sched.flow.paste': () => { void pasteClip(); },
        'sched.flow.frame': () => addFrame(),
        'sched.flow.snap': () => toggleSnap(),
        'sched.flow.alignLeft': () => alignSelection('left'),
        'sched.flow.alignTop': () => alignSelection('top'),
        'sched.flow.distributeH': () => distributeSelection('h'),
        'sched.flow.distributeV': () => distributeSelection('v'),
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
    // A required field left empty is said on the node, before the run says it.
    for (const n of g.nodes) {
        if (n.type !== 'step') continue;
        const probs = stepProblems(resolve(draft.steps, n.path!) as AnyStep);
        if (!probs.length) continue;
        const list = needsAt.get(n.id) || [];
        for (const p of probs) list.push(t('sched.flow.needsField', { p }));
        needsAt.set(n.id, list);
    }
    const ui = uiOf();
    _hidden = hiddenBy(ui.frames, g.nodes.filter((n) => n.id !== 'trigger').map(boxOf));
    if (_selFrame && !(ui.frames || []).some((f) => f.id === _selFrame)) _selFrame = null;
    let W = g.width + 400;
    let H = g.height + 300;
    for (const f of ui.frames || []) { W = Math.max(W, f.x + f.w + 200); H = Math.max(H, f.y + f.h + 200); }
    _world.style.width = `${W}px`;
    _world.style.height = `${H}px`;
    _svg.setAttribute('width', String(W));
    _svg.setAttribute('height', String(H));
    _svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    _svg.innerHTML = g.edges.map((e) => edgeSvg(g, e)).join('');
    if (_framesEl) _framesEl.innerHTML = (ui.frames || []).map((f) => frameHtml(f, g)).join('');

    const html: string[] = [];
    for (const n of g.nodes) {
        if (_hidden.has(n.id)) continue;
        if (n.type === 'join') {
            html.push(`<span class="sflow-join" style="left:${n.x}px;top:${n.y}px" data-tooltip="${escAttr(t('sched.flow.join'))}"></span>`);
            continue;
        }
        if (n.type === 'add') {
            const lbl = n.id.endsWith('#end') ? t('sched.flow.addEnd') : t('sched.flow.addHere');
            html.push(`<button type="button" class="sflow-addnode" style="left:${n.x}px;top:${n.y}px" data-slot="${escAttr(n.slot || '')}" data-index="${n.index || 0}"
                aria-label="${escAttr(lbl)}" data-tooltip="${escAttr(lbl)}">${uiIcon('add', 14)}</button>`);
            continue;
        }
        html.push(nodeHtml(n, draft, needsAt.get(n.id) || []));
    }
    // A "+" in the middle of every edge that can take a step, and a label on every lane.
    for (const e of g.edges) {
        const a = g.nodes.find((n) => n.id === e.from)!;
        const b = g.nodes.find((n) => n.id === e.to)!;
        if (!a || !b) continue;
        if (_hidden.has(a.id) || _hidden.has(b.id)) continue;
        if (e.kind === 'lane') {
            const st = resolve(draft.steps, e.from) as AnyStep | undefined;
            const label = laneLabel(st, e);
            const cond = e.lane === 'case' ? caseCond(st, (e.n || 1) - 1) : '';
            html.push(`<span class="sflow-lane" style="left:${b.x - 10}px;top:${b.y - 20}px"${cond ? ` data-tooltip="${escAttr(cond)}"` : ''}>${escHtml(label)}${cond ? `<i>${escHtml(cond)}</i>` : ''}</span>`);
        }
        if (e.insert && !ui.reroutes?.[edgeKey(e)]) {
            const [x1, y1] = outPort(a, e);
            const x2 = b.x;
            const y2 = b.y + b.h / 2;
            const mx = e.kind === 'lane' ? x2 - 22 : (x1 + x2) / 2;
            const my = e.kind === 'lane' ? y2 : (y1 + y2) / 2;
            html.push(`<button type="button" class="sflow-edgeadd" style="left:${mx - 10}px;top:${my - 10}px" data-slot="${escAttr(e.insert.slot)}" data-index="${e.insert.index}"
                aria-label="${escAttr(t('sched.flow.addHere'))}" data-tooltip="${escAttr(t('sched.flow.addHere'))}">${uiIcon('add', 12)}</button>`);
        }
    }
    // Reroute points: drag to bend a wire, double-click to take the point away.
    for (const [key, pts] of Object.entries(ui.reroutes || {})) {
        const [from, to] = key.split('>');
        if (_hidden.has(from) && _hidden.has(to)) continue;
        pts.forEach(([x, y], i) => {
            html.push(`<span class="sflow-reroute" data-rr="${escAttr(key)}" data-i="${i}" style="left:${x - 6}px;top:${y - 6}px"
                role="button" tabindex="-1" aria-label="${escAttr(t('sched.flow.reroute'))}" data-tooltip="${escAttr(t('sched.flow.rerouteTip'))}"></span>`);
        });
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
            <span class="sflow-port is-out" data-port="trigger" data-tooltip="${escAttr(t('sched.flow.portOut'))}"></span>
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
    const here = _dbg && _dbg.path === n.path;
    const dbgCls = here ? (_dbg!.phase === 'failed' ? 'is-dbg-fail' : _dbg!.phase === 'paused' ? 'is-dbg-here' : 'is-dbg-run') : '';
    const test = _tests.get(n.path!);
    const bp = h.hasBreakpoint(n.path!);
    const group = kind === 'action' ? h.actionGroup(String(st.action?.type || '')) : '';
    const cls = ['sflow-node', `k-${kind}`, group ? `g-${group}` : '', branchy ? 'is-branch' : '', loopy ? 'is-loop' : '', sel ? 'is-sel' : '', st.disabled ? 'is-off' : '', needs.length ? 'is-warn' : '',
        dbgCls, test ? `is-test-${test}` : '', bp ? 'has-bp' : ''].filter(Boolean).join(' ');
    const runTip = run ? `${t('sched.flow.run.' + run.mark)}${run.error ? ` — ${run.error}` : ''}` : '';
    return `<div class="${cls}" data-id="${escAttr(n.id)}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px"
        role="button" tabindex="-1" aria-label="${escAttr(`${title}${sub ? ' — ' + sub : ''}`)}">
        <span class="sflow-ic">${icon}</span>
        <span class="sflow-txt"><span class="sflow-title">${escHtml(title)}${st.disabled ? ` <em>${escHtml(t('sched.flow.off'))}</em>` : ''}</span>${sub ? `<span class="sflow-sub">${escHtml(sub)}</span>` : ''}</span>
        ${needs.length ? `<span class="sflow-warn" data-tooltip="${escAttr(needs.join('\n'))}">!</span>` : ''}
        ${run ? `<span class="sflow-dot run-${run.mark}" data-tooltip="${escAttr(runTip)}" aria-label="${escAttr(runTip)}"></span>` : ''}
        <button type="button" class="sflow-bp" data-bp="${escAttr(n.path!)}" aria-pressed="${bp ? 'true' : 'false'}"
            aria-label="${escAttr(t(bp ? 'sched.bp.remove' : 'sched.bp.add'))}" data-tooltip="${escAttr(t(bp ? 'sched.bp.remove' : 'sched.bp.add'))}"></button>
        <span class="sflow-port is-in" aria-hidden="true"></span>
        <span class="sflow-port is-out" data-port="${escAttr(n.id)}" data-tooltip="${escAttr(t('sched.flow.portOut'))}"></span>
    </div>`;
}

/** Where an edge leaves its node: the middle of its right edge. */
function outPort(a: FlowNode, _e: FlowEdge): [number, number] {
    return [a.x + a.w, a.y + a.h / 2];
}

/** A folded frame is a title bar: no wider than it needs to be. */
function foldedW(f: FlowFrame): number {
    return Math.min(f.w, 300);
}

/** A node as a box (frames, alignment). */
function boxOf(n: FlowNode): Box {
    return { id: n.id, x: n.x, y: n.y, w: n.w, h: n.h };
}

/** Where a wire ends: the node, or — when a folded frame hides it — that frame's title bar. */
function endpointOf(g: FlowGraph, id: string): FlowNode | undefined {
    const n = g.nodes.find((x) => x.id === id);
    if (!n) return undefined;
    const f = _hidden.get(id);
    return f ? { ...n, x: f.x, y: f.y, w: foldedW(f), h: FRAME_HEAD } : n;
}

function frameHtml(f: FlowFrame, g: FlowGraph): string {
    const inside = insideFrame(f, g.nodes.filter((n) => n.type === 'step').map(boxOf)).length;
    const title = f.title || t('sched.flow.frameUntitled');
    const fold = f.collapsed ? t('sched.flow.frameUnfold') : t('sched.flow.frameFold');
    return `<div class="sflow-frame t-${f.tone}${f.collapsed ? ' is-folded' : ''}${_selFrame === f.id ? ' is-sel' : ''}" data-frame="${escAttr(f.id)}"
        style="left:${f.x}px;top:${f.y}px;width:${f.collapsed ? foldedW(f) : f.w}px;height:${f.collapsed ? FRAME_HEAD : f.h}px">
        <div class="sflow-frame-head" data-frame-drag="${escAttr(f.id)}">
            <button type="button" class="sflow-frame-fold" data-frame-fold="${escAttr(f.id)}" aria-expanded="${f.collapsed ? 'false' : 'true'}"
                aria-label="${escAttr(fold)}" data-tooltip="${escAttr(fold)}">${uiIcon(f.collapsed ? 'chevron-right' : 'chevron-down', 12)}</button>
            <span class="sflow-frame-title" data-frame-title="${escAttr(f.id)}" data-tooltip="${escAttr(t('sched.flow.frameRename'))}">${escHtml(title)}</span>
            <span class="sflow-frame-n">${escHtml(t('sched.flow.frameN', { n: String(inside) }))}</span>
        </div>
        ${f.collapsed ? '' : `<span class="sflow-frame-resize" data-frame-resize="${escAttr(f.id)}" aria-hidden="true"></span>`}
    </div>`;
}

/** A wire bent through its reroute points, each leg a soft S like the straight ones. */
function bentPath(pts: [number, number][]): string {
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
        const [px, py] = pts[i - 1];
        const [qx, qy] = pts[i];
        const dx = Math.max(16, Math.abs(qx - px) * 0.5);
        d += ` C${px + dx} ${py} ${qx - dx} ${qy} ${qx} ${qy}`;
    }
    return d;
}

function edgeSvg(g: FlowGraph, e: FlowEdge): string {
    const a = endpointOf(g, e.from);
    const b = endpointOf(g, e.to);
    if (!a || !b) return '';
    const fa = _hidden.get(e.from), fb = _hidden.get(e.to);
    if (fa && fa === fb) return '';
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
    const key = edgeKey(e);
    const rr = uiOf().reroutes?.[key];
    let d: string;
    if (rr && rr.length) d = bentPath([[x1, y1], ...rr, [x2, y2]]);
    else {
        const dx = Math.max(24, Math.abs(x2 - x1) * 0.5);
        d = `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
    }
    // A wide invisible twin takes the pointer: double-click bends the wire, right-click offers it.
    return `<path class="${cls}" d="${d}"/><path class="sflow-edge-hit" data-edge="${escAttr(key)}" d="${d}"/>`;
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
/** What there is to see: the nodes and the frames (a frame's title sits above its nodes). */
function extent(): { x0: number; y0: number; w: number; h: number } {
    const g = _graph!;
    // The nodes on screen: a folded frame's nodes are not, and must not stretch the view.
    let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
    for (const n of g.nodes) {
        if (_hidden.has(n.id)) continue;
        x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h);
        x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    }
    for (const f of uiOf().frames || []) {
        x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y);
        x1 = Math.max(x1, f.x + (f.collapsed ? foldedW(f) : f.w)); y1 = Math.max(y1, f.y + (f.collapsed ? FRAME_HEAD : f.h));
    }
    return { x0, y0, w: x1 - x0, h: y1 - y0 };
}
function fit(maxK: number): void {
    if (!_canvas || !_graph) return;
    const cw = _canvas.clientWidth || 800, ch = _canvas.clientHeight || 500;
    const pad = 56;
    const e = extent();
    const k = Math.max(0.3, Math.min(maxK, (cw - pad * 2) / Math.max(1, e.w), (ch - pad * 2) / Math.max(1, e.h + 20)));
    _view = { k, x: Math.max(pad, (cw - e.w * k) / 2) - e.x0 * k, y: Math.max(pad, (ch - e.h * k) / 2) - e.y0 * k };
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
    const e = extent();
    const k = Math.min(1, (cw - pad * 2) / Math.max(1, e.w), (ch - pad * 2) / Math.max(1, e.h + 20));
    if (k >= 0.75) { fit(1); return; }
    const kk = Math.max(0.75, Math.min(1, (ch - pad * 2) / Math.max(1, e.h + 20)));
    _view = { k: kk, x: pad - e.x0 * kk, y: Math.max(pad + 24, (ch - e.h * kk) / 2) - e.y0 * kk };
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
        const bpEl = target.closest('.sflow-bp') as HTMLElement | null;
        if (bpEl && e.button === 0) {
            e.stopPropagation();
            _host?.toggleBreakpoint(bpEl.dataset.bp || '');
            render();
            return;
        }
        c.focus({ preventScroll: true });
        closeMenu();
        if (e.button === 0 && !_space) {
            const port = target.closest('[data-port]') as HTMLElement | null;
            if (port) { e.stopPropagation(); startWire(e, port.dataset.port!); return; }
            const fold = target.closest('[data-frame-fold]') as HTMLElement | null;
            if (fold) { e.stopPropagation(); toggleFrameFold(fold.dataset.frameFold!); return; }
            const rs = target.closest('[data-frame-resize]') as HTMLElement | null;
            if (rs) { e.stopPropagation(); startFrameResize(e, rs.dataset.frameResize!); return; }
            const fh = target.closest('[data-frame-drag]') as HTMLElement | null;
            if (fh) { e.stopPropagation(); startFrameDrag(e, fh.dataset.frameDrag!); return; }
            const rr = target.closest('.sflow-reroute') as HTMLElement | null;
            if (rr) { e.stopPropagation(); startRerouteDrag(e, rr.dataset.rr!, Number(rr.dataset.i)); return; }
        }
        const nodeEl = target.closest('.sflow-node') as HTMLElement | null;
        if (nodeEl && !_space && e.button === 0) { startNodeDrag(e, nodeEl.dataset.id!); return; }
        if (e.shiftKey && e.button === 0 && !_space) { startMarquee(e); return; }
        startPan(e, !nodeEl);
    });
    // While a debug run is paused (or has failed), hovering a node shows the values THAT step
    // reads or writes — not all forty variables, only the ones it names.
    c.addEventListener('pointerover', (e) => {
        const nodeEl = (e.target as HTMLElement).closest('.sflow-node') as HTMLElement | null;
        if (!nodeEl || !_dbg || (_dbg.phase !== 'paused' && _dbg.phase !== 'failed')) { hideTip(); return; }
        showTip(nodeEl);
    });
    c.addEventListener('pointerleave', hideTip);
    c.addEventListener('pointermove', (e) => { _lastPointer = { x: e.clientX, y: e.clientY }; });
    c.addEventListener('dblclick', (e) => {
        const target = e.target as HTMLElement;
        const title = target.closest('[data-frame-title]') as HTMLElement | null;
        if (title) { renameFrame(title.dataset.frameTitle!); return; }
        const rr = target.closest('.sflow-reroute') as HTMLElement | null;
        if (rr) { removeReroute(rr.dataset.rr!, Number(rr.dataset.i)); return; }
        const hit = target.closest('.sflow-edge-hit') as SVGElement | null;
        if (hit) { addReroute(hit.getAttribute('data-edge') || '', e.clientX, e.clientY); return; }
        const nodeEl = target.closest('.sflow-node') as HTMLElement | null;
        if (nodeEl) openInspector(nodeEl.dataset.id!, true);
    });
    // Right-click: on empty canvas, the search-to-add palette where the pointer is; on a node, a
    // frame or a wire, what can be done to it.
    c.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const target = e.target as HTMLElement;
        const fr = target.closest('[data-frame]') as HTMLElement | null;
        const frId = fr && target.closest('.sflow-frame-head') ? fr.dataset.frame! : '';
        if (frId) { frameMenu(frId, e.clientX, e.clientY); return; }
        const nodeEl = target.closest('.sflow-node') as HTMLElement | null;
        if (nodeEl) { nodeMenu(nodeEl.dataset.id!, e.clientX, e.clientY); return; }
        const hit = target.closest('.sflow-edge-hit') as SVGElement | null;
        if (hit) { edgeMenu(hit.getAttribute('data-edge') || '', e.clientX, e.clientY); return; }
        const rr = target.closest('.sflow-reroute') as HTMLElement | null;
        if (rr) { removeReroute(rr.dataset.rr!, Number(rr.dataset.i)); return; }
        openPaletteAt({ ...defaultInsertPoint(), x: e.clientX, y: e.clientY, drop: toWorld(e.clientX, e.clientY) });
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
        for (const el of els) if (el) el.style.transform = `translate(${sn(dx)}px, ${sn(dy)}px)`;
        drawEdgesWith(moving, sn(dx), sn(dy));
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
            const fx = sn(n.x + sn(dx)), fy = sn(n.y + sn(dy));
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

function showTip(nodeEl: HTMLElement): void {
    const id = nodeEl.dataset.id || '';
    const st = id === 'trigger' ? null : resolve(_host?.getDraft().steps || [], id);
    if (!st || !_dbg || !_pane) { hideTip(); return; }
    const names = varsOfStep(st);
    const rows = _dbg.rows.filter(([k]) => names.includes(k));
    if (!_tipEl) {
        _tipEl = document.createElement('div');
        _tipEl.className = 'sflow-dbgtip';
        _tipEl.setAttribute('role', 'tooltip');
        _pane.appendChild(_tipEl);
    }
    _tipEl.innerHTML = `<div class="sflow-dbgtip-h">${escHtml(t('sched.dbg.tipTitle'))}</div>${rows.length
        ? rows.map(([k, kind, v]) => `<div class="sflow-dbgtip-r"><code>${escHtml(k)}</code><span>${escHtml(kind)}</span><b>${escHtml(v.length > 120 ? v.slice(0, 120) + '\u2026' : v)}</b></div>`).join('')
        : `<p>${escHtml(names.length ? t('sched.dbg.tipUnset') : t('sched.dbg.tipNone'))}</p>`}`;
    const pr = _pane.getBoundingClientRect();
    const r = nodeEl.getBoundingClientRect();
    _tipEl.style.left = `${Math.max(8, Math.min(pr.width - 280, r.left - pr.left))}px`;
    _tipEl.style.top = `${Math.max(8, r.bottom - pr.top + 8)}px`;
    _tipEl.hidden = false;
}
function hideTip(): void { if (_tipEl) _tipEl.hidden = true; }

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
        else if (act === 'arrange') { const r = b.getBoundingClientRect(); arrangeMenu(r.left, r.bottom + 4); }
        else if (act === 'frame') addFrame();
        else if (act === 'snap') toggleSnap();
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
    const ui = uiOf();
    if (d.layout || ui.reroutes) {
        _host!.snapshot();
        delete d.layout;
        // The bends were drawn for the old places; they would point at nothing now.
        if (ui.reroutes) setUi({ ...ui, reroutes: undefined });
    }
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

function insertKind(slot: string, index: number, kind: string, drop?: { x: number; y: number }): void {
    if (!_host) return;
    const d = _host.getDraft();
    _host.snapshot();
    const stepObj = _host.makeStep(kind);
    const r = insertStep(d.steps, d.layout, slot, index, stepObj);
    d.layout = r.layout;
    // Where the person right-clicked or let go of a wire: the node lands there, not in the row.
    if (drop) {
        const n = buildGraph(d.steps, d.layout).nodes.find((x) => x.id === r.path);
        if (n) d.layout = setNudge(d.layout, r.path, sn(drop.x - n.w / 2) - n.ax, sn(drop.y - n.h / 2) - n.ay, stampOf(stepObj));
    }
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
    if (_selFrame && !_sel.some((id) => id !== 'trigger')) { deleteFrame(_selFrame); return; }
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

function openPaletteAt(at: { slot: string; index: number; x?: number; y?: number; drop?: { x: number; y: number } }): void {
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
            ${uiIcon('search', 14)}
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
        insertKind(at.slot, at.index, r.v, at.drop);
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

/** The inspector's debug section: whether a breakpoint sits here, and — while a run is paused —
 *  the values this step names. */
function refreshInspectorDebug(): void {
    if (!_insp || !_host || !_inspected || _inspected === 'trigger') return;
    const cb = _insp.querySelector('[data-bp-toggle]') as HTMLInputElement | null;
    if (cb) cb.checked = _host.hasBreakpoint(_inspected);
    const box = _insp.querySelector('.sflow-insp-vals') as HTMLElement | null;
    if (!box) return;
    const st = resolve(_host.getDraft().steps, _inspected);
    if (!_dbg || !st) { box.innerHTML = `<p class="sflow-insp-hint">${escHtml(t('sched.insp.debugHint'))}</p>`; return; }
    const names = varsOfStep(st);
    const rows = _dbg.rows.filter(([k]) => names.includes(k));
    box.innerHTML = rows.length
        ? rows.map(([k, kind, v]) => `<div class="sflow-dbgtip-r"><code>${escHtml(k)}</code><span>${escHtml(kind)}</span><b>${escHtml(v.length > 200 ? v.slice(0, 200) + '\u2026' : v)}</b></div>`).join('')
        : `<p class="sflow-insp-hint">${escHtml(names.length ? t('sched.dbg.tipUnset') : t('sched.dbg.tipNone'))}</p>`;
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
    const st = id !== 'trigger' ? resolve(d.steps || [], id) as AnyStep | undefined : undefined;
    const probs = st ? stepProblems(st) : [];
    const probNote = probs.length ? `<div class="sflow-note is-warn"><span>${escHtml(probs.map((p) => t('sched.flow.needsField', { p })).join(' · '))}</span></div>` : '';
    const run = id !== 'trigger' ? _marks.get(id) : undefined;
    const runNote = run ? `<div class="sflow-note run-${run.mark}"><span class="sflow-dot run-${run.mark}"></span><span>${escHtml(t('sched.flow.run.' + run.mark))}${run.error ? ` — ${escHtml(run.error)}` : ''}</span></div>` : '';
    return probNote + perm + runNote;
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
    const kindWord = st ? (st.kind === 'action' ? t('sched.do') : t('sched.flow.kind.' + st.kind)) : t('sched.fTrigger');
    const desc = st ? h.describe(st) : t('sched.flow.triggerHint');
    const isAction = st?.kind === 'action';
    // Sections, top to bottom in the order somebody works through a step: what it is, what is
    // wrong with it (permissions, last run), its settings, then trying it — and pausing on it.
    _insp.innerHTML = `<div class="sflow-insp-head">
            <span class="sflow-ic">${icon}</span>
            <span class="sflow-insp-titles"><b>${escHtml(title)}</b><span class="sflow-insp-kind">${escHtml(kindWord)}${st ? ` · ${escHtml(id)}` : ''}</span></span>
            <button type="button" class="sflow-insp-x" aria-label="${escAttr(t('common.close'))}">&times;</button>
        </div>
        <div class="sflow-insp-scroll">
            ${desc ? `<p class="sflow-insp-desc">${escHtml(desc)} ${h.learnMore(st)}</p>` : `<p class="sflow-insp-desc">${h.learnMore(st)}</p>`}
            <div class="sflow-insp-notes">${notesHtml(id)}</div>
            <section class="sflow-insp-sec">
                <h4 class="sflow-insp-h">${escHtml(t('sched.insp.settings'))}</h4>
                <div class="sflow-insp-body"></div>
            </section>
            ${isAction ? `<section class="sflow-insp-sec sflow-insp-test">
                <h4 class="sflow-insp-h">${escHtml(t('sched.insp.test'))}</h4>
                <p class="sflow-insp-hint">${escHtml(t('sched.insp.testHint'))}</p>
                <button type="button" class="btn btn-sm btn-secondary" data-test>${escHtml(t('sched.test.btn'))}</button>
                <div class="sflow-test-out" aria-live="polite"></div>
            </section>` : ''}
            ${st ? `<section class="sflow-insp-sec sflow-insp-dbg">
                <h4 class="sflow-insp-h">${escHtml(t('sched.insp.debug'))}</h4>
                <label class="sflow-insp-check"><input type="checkbox" data-bp-toggle ${h.hasBreakpoint(id) ? 'checked' : ''}> <span>${escHtml(t('sched.bp.here'))}</span></label>
                <div class="sflow-insp-vals"></div>
            </section>` : ''}
        </div>`;
    const body = _insp.querySelector('.sflow-insp-body') as HTMLElement;
    if (st) {
        h.renderInspector(body, st);
    } else {
        body.innerHTML = `<p class="sflow-insp-p">${escHtml(h.triggerTitle())}</p>
            <p class="sflow-insp-hint">${escHtml(t('sched.flow.triggerHint'))}</p>
            <button type="button" class="btn btn-sm" data-trigger>${escHtml(t('sched.flow.editTrigger'))}</button>`;
    }
    _insp.querySelector('.sflow-insp-x')?.addEventListener('click', () => { select([], false); _canvas?.focus({ preventScroll: true }); });
    _insp.querySelector('[data-bp-toggle]')?.addEventListener('change', () => { h.toggleBreakpoint(id); render(); });
    _insp.querySelector('[data-test]')?.addEventListener('click', () => { void runNodeTest(id); });
    refreshInspectorDebug();
    paintTestOut(id, null);
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

// ── Blueprint tools: wires, frames, reroutes, arranging, the clipboard ───────────────────────

/** Screen pixels to world units. */
function toWorld(cx: number, cy: number): { x: number; y: number } {
    const r = _canvas!.getBoundingClientRect();
    return { x: (cx - r.left - _view.x) / _view.k, y: (cy - r.top - _view.y) / _view.k };
}

function toggleSnap(): void {
    _snapOn = !_snapOn;
    writeSnap(_snapOn);
    _pane?.querySelector('[data-act="snap"]')?.setAttribute('aria-pressed', _snapOn ? 'true' : 'false');
    toast(t(_snapOn ? 'sched.flow.snapOn' : 'sched.flow.snapOff'), 'info', 1400);
}

/**
 * Drag a wire out of a node's output. Let go on another node: it moves to run right after this
 * one (the tree has no loose wires, so connecting IS ordering). Let go on empty canvas: the
 * palette opens there, and what is picked is added after this node, where the wire ended.
 */
function startWire(e: PointerEvent, from: string): void {
    const c = _canvas!;
    const n = _graph?.nodes.find((x) => x.id === from);
    if (!n || !_svg) return;
    const x1 = n.x + n.w, y1 = n.y + n.h / 2;
    const temp = document.createElementNS(SVGNS, 'path');
    temp.setAttribute('class', 'sflow-wire-temp');
    _svg.appendChild(temp);
    c.setPointerCapture(e.pointerId);
    c.classList.add('is-wiring');
    const mv = (ev: PointerEvent) => {
        const w = toWorld(ev.clientX, ev.clientY);
        const dx = Math.max(24, Math.abs(w.x - x1) * 0.5);
        temp.setAttribute('d', `M${x1} ${y1} C${x1 + dx} ${y1} ${w.x - dx} ${w.y} ${w.x} ${w.y}`);
    };
    const up = (ev: PointerEvent) => {
        c.removeEventListener('pointermove', mv);
        c.removeEventListener('pointerup', up);
        c.classList.remove('is-wiring');
        temp.remove();
        if (!_host) return;
        const hitEl = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        const target = hitEl?.closest('.sflow-node') as HTMLElement | null;
        const to = target?.dataset.id;
        if (to && to !== from && to !== 'trigger') { wireTo(from, to); return; }
        if (target) return;
        const w = toWorld(ev.clientX, ev.clientY);
        if (Math.hypot(w.x - x1, w.y - y1) < 24) return;
        const at = from === 'trigger' ? { slot: '', index: 0 } : (() => { const s = slotOf(from); return { slot: s.slot, index: s.index + 1 }; })();
        openPaletteAt({ ...at, x: ev.clientX, y: ev.clientY, drop: w });
    };
    c.addEventListener('pointermove', mv);
    c.addEventListener('pointerup', up);
}

function wireTo(from: string, to: string): void {
    const h = _host!;
    const d = h.getDraft();
    const moving = resolve(d.steps, to) as AnyStep | undefined;
    if (!moving) return;
    h.snapshot();
    let path: string | null = null;
    if (from === 'trigger') {
        // After the trigger: first in the task.
        const { slot, index } = slotOf(to);
        if (slot === '' && index === 0) return;
        d.layout = removeSteps(d.steps, d.layout, [moving]);
        const r = insertStep(d.steps, d.layout, '', 0, moving);
        d.layout = r.layout;
        path = r.path;
    } else {
        const r = relocateStep(d.steps, d.layout, to, from);
        if (!r) { toast(t('sched.flow.wireRefused'), 'info', 2400); return; }
        d.layout = r.layout;
        path = r.path;
    }
    select([path]);
    reveal(path);
}

// ── Frames ──

function framesOf(): FlowFrame[] { return [...(uiOf().frames || [])]; }
function saveFrames(frames: FlowFrame[]): void { setUi({ ...uiOf(), frames }); }

/** A frame around the selection, or an empty one in the middle of the view. */
function addFrame(): void {
    if (!_host || !_graph || !_canvas) return;
    const picked = _graph.nodes.filter((n) => _sel.includes(n.id) && (n.type === 'step' || n.type === 'trigger')).map(boxOf);
    const id = `f${Date.now().toString(36)}`;
    let f: FlowFrame;
    if (picked.length) f = frameAround(picked, id, '', 'accent');
    else {
        const mid = toWorld(_canvas.getBoundingClientRect().left + _canvas.clientWidth / 2, _canvas.getBoundingClientRect().top + _canvas.clientHeight / 2);
        f = { id, title: '', tone: 'accent', x: sn(mid.x - 180), y: sn(mid.y - 90), w: 360, h: 180 };
    }
    _host.snapshot();
    saveFrames([...framesOf(), f]);
    _selFrame = id;
    render();
    renameFrame(id);
}

function deleteFrame(id: string): void {
    if (!_host) return;
    _host.snapshot();
    saveFrames(framesOf().filter((f) => f.id !== id));
    _selFrame = null;
    render();
}

function toggleFrameFold(id: string): void {
    if (!_host) return;
    _host.snapshot();
    saveFrames(framesOf().map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)));
    render();
}

function setFrameTone(id: string, tone: Tone): void {
    if (!_host) return;
    _host.snapshot();
    saveFrames(framesOf().map((f) => (f.id === id ? { ...f, tone } : f)));
    render();
}

/** Edit a frame's title in place: Enter or leaving the field keeps it, Escape does not. */
function renameFrame(id: string): void {
    const el = _framesEl?.querySelector(`[data-frame-title="${CSS.escape(id)}"]`) as HTMLElement | null;
    const f = framesOf().find((x) => x.id === id);
    if (!el || !f || !_host) return;
    const input = document.createElement('input');
    input.className = 'sflow-frame-input';
    input.value = f.title;
    input.maxLength = 80;
    input.placeholder = t('sched.flow.frameUntitled');
    input.setAttribute('aria-label', t('sched.flow.frameRename'));
    el.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (keep: boolean) => {
        if (done) return;
        done = true;
        if (keep && input.value.trim() !== f.title) {
            _host!.snapshot();
            saveFrames(framesOf().map((x) => (x.id === id ? { ...x, title: input.value.trim() } : x)));
        }
        render();
        _canvas?.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
        else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (ev) => ev.stopPropagation());
}

/** Drag a frame by its title bar: the nodes inside it when the drag started come along. */
function startFrameDrag(e: PointerEvent, id: string): void {
    const c = _canvas!;
    const f = framesOf().find((x) => x.id === id);
    if (!f || !_graph || !_host) return;
    _selFrame = id;
    const inside = insideFrame(f, _graph.nodes.filter((n) => n.type === 'step' || n.type === 'trigger').map(boxOf));
    const frameEl = _framesEl?.querySelector(`[data-frame="${CSS.escape(id)}"]`) as HTMLElement | null;
    frameEl?.classList.add('is-sel');
    const els = inside.map((nid) => _layer!.querySelector(`.sflow-node[data-id="${CSS.escape(nid)}"]`) as HTMLElement | null);
    const x0 = e.clientX, y0 = e.clientY;
    let dx = 0, dy = 0, moved = false;
    c.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => {
        dx = sn((ev.clientX - x0) / _view.k);
        dy = sn((ev.clientY - y0) / _view.k);
        if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        moved = true;
        c.classList.add('is-dragging');
        if (frameEl) frameEl.style.transform = `translate(${dx}px, ${dy}px)`;
        for (const el of els) if (el) el.style.transform = `translate(${dx}px, ${dy}px)`;
        drawEdgesWith(inside, dx, dy);
    };
    const up = () => {
        c.removeEventListener('pointermove', mv);
        c.removeEventListener('pointerup', up);
        c.classList.remove('is-dragging');
        if (!moved || !_host || !_graph) { render(); return; }
        const d = _host.getDraft();
        _host.snapshot();
        let lay = d.layout;
        for (const nid of inside) {
            const n = _graph.nodes.find((x) => x.id === nid);
            if (!n) continue;
            lay = setNudge(lay, nid, n.x + dx - n.ax, n.y + dy - n.ay, nid === 'trigger' ? 'trigger' : stampOf(resolve(d.steps, nid)));
        }
        d.layout = lay;
        saveFrames(framesOf().map((x) => (x.id === id ? { ...x, x: x.x + dx, y: x.y + dy } : x)));
        render();
    };
    c.addEventListener('pointermove', mv);
    c.addEventListener('pointerup', up);
}

function startFrameResize(e: PointerEvent, id: string): void {
    const c = _canvas!;
    const f = framesOf().find((x) => x.id === id);
    const frameEl = _framesEl?.querySelector(`[data-frame="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (!f || !frameEl || !_host) return;
    const x0 = e.clientX, y0 = e.clientY;
    let w = f.w, h = f.h;
    c.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => {
        w = Math.max(160, sn(f.w + (ev.clientX - x0) / _view.k));
        h = Math.max(FRAME_HEAD + 40, sn(f.h + (ev.clientY - y0) / _view.k));
        frameEl.style.width = `${w}px`;
        frameEl.style.height = `${h}px`;
    };
    const up = () => {
        c.removeEventListener('pointermove', mv);
        c.removeEventListener('pointerup', up);
        if (w === f.w && h === f.h) return;
        _host!.snapshot();
        saveFrames(framesOf().map((x) => (x.id === id ? { ...x, w, h } : x)));
        render();
    };
    c.addEventListener('pointermove', mv);
    c.addEventListener('pointerup', up);
}

// ── Reroutes ──

function addReroute(key: string, cx: number, cy: number): void {
    if (!key || !_host) return;
    const ui = uiOf();
    const w = toWorld(cx, cy);
    const pts = [...(ui.reroutes?.[key] || [])];
    let at = pts.findIndex((p) => p[0] > w.x);
    if (at < 0) at = pts.length;
    pts.splice(at, 0, [sn(w.x), sn(w.y)]);
    _host.snapshot();
    setUi({ ...ui, reroutes: { ...(ui.reroutes || {}), [key]: pts } });
    render();
}

function removeReroute(key: string, i: number): void {
    if (!_host) return;
    const ui = uiOf();
    const pts = [...(ui.reroutes?.[key] || [])];
    if (!pts.length) return;
    pts.splice(i, 1);
    const rr = { ...(ui.reroutes || {}) };
    if (pts.length) rr[key] = pts; else delete rr[key];
    _host.snapshot();
    setUi({ ...ui, reroutes: rr });
    render();
}

function startRerouteDrag(e: PointerEvent, key: string, i: number): void {
    const c = _canvas!;
    const ui = uiOf();
    const pts = [...(ui.reroutes?.[key] || [])];
    if (!pts[i] || !_host || !_graph) return;
    const start = pts[i];
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    c.setPointerCapture(e.pointerId);
    const dot = e.target as HTMLElement;
    const mv = (ev: PointerEvent) => {
        const nx = sn(start[0] + (ev.clientX - x0) / _view.k), ny = sn(start[1] + (ev.clientY - y0) / _view.k);
        if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 3) return;
        if (!moved) _host!.snapshot();
        moved = true;
        pts[i] = [nx, ny];
        dot.style.left = `${nx - 6}px`;
        dot.style.top = `${ny - 6}px`;
        setUi({ ...uiOf(), reroutes: { ...(uiOf().reroutes || {}), [key]: pts } });
        if (_graph && _svg) _svg.innerHTML = _graph.edges.map((ed) => edgeSvg(_graph!, ed)).join('');
    };
    const up = () => {
        c.removeEventListener('pointermove', mv);
        c.removeEventListener('pointerup', up);
        if (moved) render();
    };
    c.addEventListener('pointermove', mv);
    c.addEventListener('pointerup', up);
}

// ── Arranging ──

/** The selected nodes that can be placed by hand, as boxes. */
function selectedBoxes(): Box[] {
    return (_graph?.nodes || []).filter((n) => _sel.includes(n.id) && (n.type === 'step' || n.type === 'trigger') && !_hidden.has(n.id)).map(boxOf);
}

function placeBoxes(moves: Record<string, { x: number; y: number }>): void {
    if (!_host || !_graph || !Object.keys(moves).length) return;
    const d = _host.getDraft();
    _host.snapshot();
    let lay = d.layout;
    for (const [id, p] of Object.entries(moves)) {
        const n = _graph.nodes.find((x) => x.id === id);
        if (!n) continue;
        lay = setNudge(lay, id, sn(p.x) - n.ax, sn(p.y) - n.ay, id === 'trigger' ? 'trigger' : stampOf(resolve(d.steps, id)));
    }
    d.layout = lay;
    render();
}

function alignSelection(how: AlignHow): void {
    const boxes = selectedBoxes();
    if (boxes.length < 2) { toast(t('sched.flow.pickTwo'), 'info', 2000); return; }
    placeBoxes(align(boxes, how));
}

function distributeSelection(axis: 'h' | 'v'): void {
    const boxes = selectedBoxes();
    if (boxes.length < 3) { toast(t('sched.flow.pickThree'), 'info', 2000); return; }
    placeBoxes(distribute(boxes, axis));
}

// ── Clipboard ──

/** The selected steps, outermost only (a step inside a selected block travels with it), in order. */
function topSelected(): string[] {
    const ids = _sel.filter((id) => id !== 'trigger' && !id.includes('#'));
    const order = _graph?.order || [];
    return ids.filter((id) => !ids.some((o) => o !== id && id.startsWith(o + '.')))
        .sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

async function copySelection(cut: boolean): Promise<void> {
    if (!_host) return;
    const d = _host.getDraft();
    const ids = topSelected();
    const steps = ids.map((id) => resolve(d.steps, id)).filter(Boolean).map((s) => JSON.parse(JSON.stringify(s)) as AnyStep);
    if (!steps.length) return;
    _clip = steps;
    try { await navigator.clipboard.writeText(clipText(steps)); } catch { /* the flow's own copy still pastes */ }
    if (cut) { await deleteSelection(); return; }
    toast(t('sched.flow.copied', { n: String(steps.length) }), 'info', 1600);
}

async function pasteClip(): Promise<void> {
    if (!_host) return;
    let steps: AnyStep[] | null = null;
    try { steps = readClip(await navigator.clipboard.readText()) as AnyStep[] | null; } catch { steps = null; }
    if (!steps && _clip) steps = JSON.parse(JSON.stringify(_clip)) as AnyStep[];
    if (!steps || !steps.length) { toast(t('sched.flow.nothingToPaste'), 'info', 1800); return; }
    const d = _host.getDraft();
    const at = defaultInsertPoint();
    _host.snapshot();
    const paths: string[] = [];
    let i = at.index;
    for (const st of steps) {
        const r = insertStep(d.steps, d.layout, at.slot, i++, st);
        d.layout = r.layout;
        paths.push(r.path);
    }
    select(paths, paths.length === 1);
    toast(t('sched.flow.pasted', { n: String(paths.length) }), 'success', 1600);
}

// ── Menus ──

interface MenuItem { label: string; icon?: string; run?: () => void; danger?: boolean; sep?: boolean; key?: string; swatches?: { tone: Tone; on: boolean; run: () => void }[] }

/** A frame colour, in words (one literal key each, so the dictionaries are checked). */
function toneLabel(tone: Tone): string {
    switch (tone) {
        case 'accent': return t('sched.flow.tone.accent');
        case 'info': return t('sched.flow.tone.info');
        case 'success': return t('sched.flow.tone.success');
        case 'warning': return t('sched.flow.tone.warning');
        case 'danger': return t('sched.flow.tone.danger');
        default: return t('sched.flow.tone.neutral');
    }
}

function closeMenu(): void {
    _menu?.remove();
    _menu = null;
}

/** A small menu at a screen point, kept inside the pane. Arrow keys move, Enter runs, Escape closes. */
function openMenu(cx: number, cy: number, items: MenuItem[], label: string): void {
    if (!_pane) return;
    closeMenu();
    const el = document.createElement('div');
    el.className = 'sflow-menu';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', label);
    el.innerHTML = items.map((it, i) => {
        if (it.sep) return '<div class="sflow-menu-sep" role="separator"></div>';
        if (it.swatches) {
            return `<div class="sflow-menu-sw" role="group" aria-label="${escAttr(it.label)}">${it.swatches.map((s, j) =>
                `<button type="button" class="sflow-sw t-${s.tone}${s.on ? ' is-on' : ''}" role="menuitemradio" aria-checked="${s.on}" data-i="${i}" data-j="${j}"
                    aria-label="${escAttr(toneLabel(s.tone))}" data-tooltip="${escAttr(toneLabel(s.tone))}"></button>`).join('')}</div>`;
        }
        const ch = it.key ? bindingOf(it.key) : null;
        return `<button type="button" class="sflow-menu-item${it.danger ? ' is-danger' : ''}" role="menuitem" data-i="${i}">
            <span class="sflow-menu-ic">${it.icon || ''}</span><span class="sflow-menu-l">${escHtml(it.label)}</span>${ch ? `<kbd>${escHtml(chordToStr(ch))}</kbd>` : ''}</button>`;
    }).join('');
    _pane.appendChild(el);
    _menu = el;
    const pr = _pane.getBoundingClientRect();
    const w = el.offsetWidth || 220, h = el.offsetHeight || 200;
    el.style.left = `${Math.max(8, Math.min(pr.width - w - 8, cx - pr.left))}px`;
    el.style.top = `${Math.max(8, Math.min(pr.height - h - 8, cy - pr.top))}px`;
    el.addEventListener('click', (ev) => {
        const b = (ev.target as HTMLElement).closest('[data-i]') as HTMLElement | null;
        if (!b) return;
        const it = items[Number(b.dataset.i)];
        closeMenu();
        if (b.dataset.j !== undefined) it?.swatches?.[Number(b.dataset.j)]?.run();
        else it?.run?.();
        if (!document.activeElement || document.activeElement === document.body) _canvas?.focus({ preventScroll: true });
    });
    el.addEventListener('keydown', (ev) => {
        const all = Array.from(el.querySelectorAll<HTMLElement>('button'));
        const at = all.indexOf(document.activeElement as HTMLElement);
        if (ev.key === 'ArrowDown') { ev.preventDefault(); all[(at + 1) % all.length]?.focus(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); all[(at - 1 + all.length) % all.length]?.focus(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeMenu(); _canvas?.focus({ preventScroll: true }); }
    });
    const away = (ev: PointerEvent) => {
        if (_menu === el && el.contains(ev.target as Node)) return;
        document.removeEventListener('pointerdown', away, true);
        if (_menu === el) closeMenu();
    };
    document.addEventListener('pointerdown', away, true);
    (el.querySelector('button') as HTMLElement | null)?.focus();
}

function arrangeItems(): MenuItem[] {
    return [
        { label: t('sched.flow.alignLeft'), icon: uiIcon('chevron-left', 14), run: () => alignSelection('left'), key: 'sched.flow.alignLeft' },
        { label: t('sched.flow.alignHCenter'), icon: uiIcon('menu', 14), run: () => alignSelection('hcenter') },
        { label: t('sched.flow.alignRight'), icon: uiIcon('chevron-right', 14), run: () => alignSelection('right') },
        { label: t('sched.flow.alignTop'), icon: uiIcon('chevron-up', 14), run: () => alignSelection('top'), key: 'sched.flow.alignTop' },
        { label: t('sched.flow.alignVCenter'), icon: uiIcon('menu', 14), run: () => alignSelection('vcenter') },
        { label: t('sched.flow.alignBottom'), icon: uiIcon('chevron-down', 14), run: () => alignSelection('bottom') },
        { sep: true, label: '' },
        { label: t('sched.flow.distributeH'), icon: uiIcon('sliders', 14), run: () => distributeSelection('h'), key: 'sched.flow.distributeH' },
        { label: t('sched.flow.distributeV'), icon: uiIcon('sliders', 14), run: () => distributeSelection('v'), key: 'sched.flow.distributeV' },
        { sep: true, label: '' },
        { label: t('sched.flow.autoLayout'), icon: uiIcon('layers', 14), run: () => autoLayout(), key: 'sched.flow.autoLayout' },
    ];
}

function arrangeMenu(cx: number, cy: number): void {
    openMenu(cx, cy, arrangeItems(), t('sched.flow.arrange'));
}

function nodeMenu(id: string, cx: number, cy: number): void {
    if (!_sel.includes(id)) select([id], false);
    const isStep = id !== 'trigger';
    const many = _sel.length > 1;
    const items: MenuItem[] = [
        { label: t('sched.flow.edit'), icon: uiIcon('edit', 14), run: () => openInspector(id, true), key: 'sched.flow.edit' },
    ];
    if (isStep) {
        items.push(
            { label: t('sched.flow.testNode'), icon: uiIcon('play', 14), run: () => { void runNodeTest(id); }, key: 'sched.flow.testNode' },
            { sep: true, label: '' },
            { label: t('sched.flow.copy'), icon: uiIcon('copy', 14), run: () => { void copySelection(false); }, key: 'sched.flow.copy' },
            { label: t('sched.flow.cut'), icon: uiIcon('copy', 14), run: () => { void copySelection(true); }, key: 'sched.flow.cut' },
            { label: t('sched.flow.duplicate'), icon: uiIcon('copy', 14), run: () => duplicateSelection(), key: 'sched.flow.duplicate' },
        );
    }
    items.push({ label: t('sched.flow.paste'), icon: uiIcon('import', 14), run: () => { void pasteClip(); }, key: 'sched.flow.paste' });
    items.push({ sep: true, label: '' }, { label: t('sched.flow.frame'), icon: uiIcon('maximize', 14), run: () => addFrame(), key: 'sched.flow.frame' });
    if (many) items.push(...arrangeItems().slice(0, 9));
    if (isStep) items.push({ sep: true, label: '' }, { label: t('sched.flow.deleteSel'), icon: uiIcon('delete', 14), danger: true, run: () => { void deleteSelection(); }, key: 'sched.flow.delete' });
    openMenu(cx, cy, items, t('sched.flow.nodeMenu'));
}

function frameMenu(id: string, cx: number, cy: number): void {
    const f = framesOf().find((x) => x.id === id);
    if (!f) return;
    _selFrame = id;
    render();
    openMenu(cx, cy, [
        { label: t('sched.flow.frameRename'), icon: uiIcon('edit', 14), run: () => renameFrame(id) },
        { label: f.collapsed ? t('sched.flow.frameUnfold') : t('sched.flow.frameFold'), icon: uiIcon(f.collapsed ? 'chevron-right' : 'chevron-down', 14), run: () => toggleFrameFold(id) },
        { label: t('sched.flow.frameTone'), swatches: TONES.map((tone) => ({ tone, on: f.tone === tone, run: () => setFrameTone(id, tone) })) },
        { sep: true, label: '' },
        { label: t('sched.flow.frameDelete'), icon: uiIcon('delete', 14), danger: true, run: () => deleteFrame(id) },
    ], t('sched.flow.frameMenu'));
}

function edgeMenu(key: string, cx: number, cy: number): void {
    const has = !!uiOf().reroutes?.[key]?.length;
    const items: MenuItem[] = [{ label: t('sched.flow.rerouteAdd'), icon: uiIcon('add', 14), run: () => addReroute(key, cx, cy) }];
    if (has) {
        items.push({ label: t('sched.flow.rerouteClear'), icon: uiIcon('clear', 14), run: () => {
            const ui = uiOf();
            const rr = { ...(ui.reroutes || {}) };
            delete rr[key];
            _host?.snapshot();
            setUi({ ...ui, reroutes: rr });
            render();
        } });
    }
    openMenu(cx, cy, items, t('sched.flow.edgeMenu'));
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
