// The dry run of a task, and the preview of where it would take you.
//
// Two questions people have BEFORE they let a task run, and that neither the mod preview
// (sched-preview.ts: which mods it would turn on or off) nor the debugger (which runs for real)
// answers:
//
//   « What will this do? »   Every step, in order, with what kind of thing it does — moves the
//                            view, reads, changes BMM, deletes, reaches the network, starts a
//                            program — whether it is sure to run or sits in a branch, and what
//                            permission it still lacks. The upkeep steps that can MEASURE
//                            without acting (DRY_MEASURED) are run with `dryRun` and their answer
//                            is shown: « 1.4 GB in 3 caches », « 2 updates in 1 followed repo ».
//   « Where will it go? »    The navigation steps played for real in preview mode: pages, tabs,
//                            cards and items open and light up; a dialog is announced instead of
//                            opened; a click is a dashed ring with « would click » under it.
//                            Everything else is a line at the bottom saying what would run.
//
// The scheduler hands in what only it knows (labels, the measuring call, the permission rule)
// through `DryHost`, so this module imports nothing of it and stays out of its import cycles.

import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { openModal } from '../../ui/modal-shell.js';
import { uiIcon } from '../../ui/icons.js';
import {
    DRY_MEASURED, NAV_ACTING, controlById, isNavAction, modalById, pageById, planSteps, planSummary,
    type Effect, type PlanRow,
} from './sched-nav-model.js';
import { permNeeds } from './sched-flow-model.js';
import { clearNavPaint, ensureNavCss, runNav } from './sched-nav.js';

export interface DryTask {
    id?: string;
    name?: string;
    outputDir?: string;
    perms?: Record<string, boolean>;
    allowCustomCommands?: boolean;
    trigger?: any;
    steps: any[];
}

export interface DryHost {
    /** The step's name as the editor shows it. */
    stepLabel: (step: any) => string;
    /** Run one DRY_MEASURED action with `dryRun: true`; its one-line answer. */
    measure: (action: { type: string; params: Record<string, any> }, task: DryTask) => Promise<string>;
    /** The scheduler's own permission rule. */
    hasPerm: (task: DryTask, key: string) => boolean;
    /** Hide whatever covers the app while the preview plays, and bring it back after. */
    beforePlay?: () => void;
    afterPlay?: () => void;
}

const EFFECTS: Effect[] = ['nav', 'read', 'change', 'delete', 'network', 'external', 'flow'];

/** The step itself, found again from its plan path (`2.then.0`, `1.cases.0.3`). */
function stepAt(steps: any[], path: string): any {
    const parts = path.split('.');
    let list: any[] = steps;
    let cur: any = null;
    for (let i = 0; i < parts.length; i++) {
        const seg = parts[i];
        if (/^\d+$/.test(seg)) { cur = list?.[Number(seg)]; continue; }
        if (seg === 'cases' || seg === 'branches') {
            const idx = Number(parts[++i]);
            const holder = cur?.[seg]?.[idx];
            list = seg === 'cases' ? holder?.steps : holder;
            continue;
        }
        list = cur?.[seg];
    }
    return cur;
}

/** What a navigation step points at, in words. */
export function describeNav(type: string, p: Record<string, any>): string {
    const page = (id: string) => { const pg = pageById(id); return pg ? t(pg.key) : id; };
    switch (type) {
        case 'nav.page': return p.tab ? `${page(String(p.page || ''))} › ${p.tab}` : page(String(p.page || ''));
        case 'nav.settingsCard': return String(p.card || '');
        case 'nav.item': return `${t('sched.nv.kind.' + String(p.kind || 'mod'))}: ${String(p.id || '')}`;
        case 'nav.highlight':
        case 'nav.waitFor': {
            const c = controlById(String(p.target || ''));
            return c ? t(c.key) : String(p.target || '');
        }
        case 'nav.message': return String(p.title || p.message || '').slice(0, 80);
        case 'nav.modal': { const m = modalById(String(p.modal || '')); return m ? t(m.key) : String(p.modal || ''); }
        case 'nav.click': { const c = controlById(String(p.control || '')); return c ? t(c.key) : String(p.control || ''); }
    }
    return '';
}

/** Open the dry-run dialog for a task (or a draft, or a template). */
export function openDryRun(task: DryTask, host: DryHost): void {
    ensureNavCss();
    const rows = planSteps(task.steps || []);
    const needs = permNeeds(task.steps || [], task.trigger);
    const missingAt = new Map<string, string[]>();
    for (const n of needs) {
        if (host.hasPerm(task, n.perm)) continue;
        missingAt.set(n.path, [...(missingAt.get(n.path) || []), n.perm]);
    }
    const sum = planSummary(rows);
    const navCount = rows.filter((r) => r.kind === 'action' && !r.disabled && isNavAction(r.type)).length;

    const body = document.createElement('div');
    const chips = EFFECTS.filter((e) => e !== 'flow' && sum[e] > 0)
        .map((e) => `<span class="sdr-chip"><b>${sum[e]}</b> ${escHtml(t('sched.dr.e.' + e))}</span>`).join('');
    body.innerHTML = `
        <p class="sdr-lede">${escHtml(t('sched.dr.lede'))}</p>
        ${chips ? `<div class="sdr-chips">${chips}</div>` : ''}
        <div class="sdr-list">${rows.length ? '' : `<div class="sdr-row is-flow"><span></span><div class="sdr-what">${escHtml(t('sched.dr.empty'))}</div><span></span></div>`}</div>`;
    const list = body.querySelector('.sdr-list') as HTMLElement;

    const measured: { row: PlanRow; el: HTMLElement }[] = [];
    for (const r of rows) {
        const step = stepAt(task.steps || [], r.path);
        const el = document.createElement('div');
        el.className = `sdr-row${r.disabled ? ' is-off' : ''}${r.kind !== 'action' ? ' is-flow' : ''}`;
        el.style.marginLeft = `${Math.min(r.depth, 6) * 14}px`;
        const label = step ? host.stepLabel(step) : r.type || r.kind;
        let detail = '';
        if (r.disabled) detail = t('sched.dr.disabled');
        else if (r.kind === 'action' && isNavAction(r.type)) {
            const what = describeNav(r.type, r.params);
            detail = NAV_ACTING.includes(r.type) ? t('sched.dr.navActs', { w: what }) : t('sched.dr.navShows', { w: what });
        } else if (r.kind === 'action' && DRY_MEASURED.includes(r.type)) detail = t('sched.dr.measuring');
        else if (r.kind === 'action') detail = t('sched.dr.skipped.' + r.effect);
        const missing = missingAt.get(r.path) || [];
        el.innerHTML = `
            <span class="sdr-eff sdr-eff--${r.kind === 'action' ? r.effect : 'flow'}">${escHtml(t('sched.dr.e.' + (r.kind === 'action' ? r.effect : 'flow')))}</span>
            <div class="sdr-what">
                <div class="sdr-label">${escHtml(label)}</div>
                ${detail ? `<div class="sdr-detail">${escHtml(detail)}</div>` : ''}
            </div>
            <div class="sdr-tags">
                ${r.certain ? '' : `<span class="sdr-tag">${escHtml(t('sched.dr.maybe'))}</span>`}
                ${missing.map((m) => `<span class="sdr-tag sdr-tag--perm">${escHtml(t('sched.dr.needs', { p: t('sched.perm.' + m) }))}</span>`).join('')}
            </div>`;
        list.appendChild(el);
        if (!r.disabled && r.kind === 'action' && DRY_MEASURED.includes(r.type)) measured.push({ row: r, el });
    }

    const footer = document.createElement('div');
    footer.style.display = 'contents';
    footer.innerHTML = `
        <span class="sdr-foot-note">${escHtml(missingAt.size ? t('sched.dr.noteMissing', { n: String(missingAt.size) }) : t('sched.dr.note'))}</span>
        ${navCount ? `<button type="button" class="btn btn-sm btn-secondary" id="sdr-play">${uiIcon('play', 14)}<span>${escHtml(t('sched.dr.play', { n: String(navCount) }))}</span></button>` : ''}
        <button type="button" class="btn btn-sm btn-primary" id="sdr-close">${escHtml(t('common.close'))}</button>`;

    const m = openModal({
        title: t('sched.dr.title', { name: task.name || t('sched.untitled') }),
        subtitle: t('sched.dr.sub'),
        icon: uiIcon('search', 18),
        size: 'lg',
        tall: true,
        className: 'sdr-modal',
        body,
        footer,
    });
    m.q('#sdr-close')?.addEventListener('click', () => m.close());
    m.q('#sdr-play')?.addEventListener('click', () => {
        m.close();
        void playNavPreview(task, host);
    });

    // The measured steps, one after the other: each is a real (read-only) call.
    void (async () => {
        for (const { row, el } of measured) {
            const d = el.querySelector('.sdr-detail') as HTMLElement | null;
            try {
                const out = await host.measure({ type: row.type, params: { ...row.params } }, task);
                if (d) { d.textContent = out || t('sched.dr.nothing'); d.classList.add('is-ok'); }
            } catch (e) {
                if (d) { d.textContent = t('sched.dr.measureFailed', { e: String((e as Error)?.message || e) }); d.classList.add('is-bad'); }
            }
        }
    })();
}

let _playing = false;

/**
 * Play the task's navigation in preview mode. Branches are not evaluated, so every navigation
 * step is shown in order (the bar says when one sits in a branch); other actions get a line
 * saying what would run. Stop ends it at once and clears everything painted.
 */
export async function playNavPreview(task: DryTask, host: DryHost): Promise<void> {
    if (_playing) return;
    _playing = true;
    ensureNavCss();
    const rows = planSteps(task.steps || []).filter((r) => r.kind === 'action' && !r.disabled);
    let stopped = false;
    host.beforePlay?.();

    const layer = document.getElementById('app-window-outer') || document.body;
    const bar = document.createElement('div');
    bar.className = 'snav-layer';
    bar.innerHTML = `<div class="snav-bar" role="status">
        <span class="snav-bar-dot" aria-hidden="true"></span>
        <span class="snav-bar-text"></span>
        <span class="snav-bar-step"></span>
        <button type="button" class="btn btn-xs btn-secondary snav-bar-stop">${uiIcon('stop', 12)}<span>${escHtml(t('sched.dr.stop'))}</span></button>
    </div>`;
    layer.appendChild(bar);
    const say = (txt: string, i: number) => {
        (bar.querySelector('.snav-bar-text') as HTMLElement).textContent = txt;
        (bar.querySelector('.snav-bar-step') as HTMLElement).textContent = i ? `${i}/${rows.length}` : '';
    };
    bar.querySelector('.snav-bar-stop')?.addEventListener('click', () => { stopped = true; });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') stopped = true; };
    document.addEventListener('keydown', onKey, true);

    try {
        for (let i = 0; i < rows.length && !stopped; i++) {
            const r = rows[i];
            const step = stepAt(task.steps || [], r.path);
            const label = step ? host.stepLabel(step) : r.type;
            say(`${t('sched.dr.playing')} · ${label}${r.certain ? '' : ` (${t('sched.dr.maybe')})`}`, i + 1);
            if (isNavAction(r.type)) {
                try {
                    await runNav(r.type, { ...r.params }, { preview: true, canAct: false, cancelled: () => stopped });
                } catch (e) {
                    say(`${label}: ${String((e as Error)?.message || e)}`, i + 1);
                    await new Promise((res) => setTimeout(res, 2200));
                }
            } else {
                say(t('sched.dr.wouldRun', { s: label }), i + 1);
                await new Promise((res) => setTimeout(res, 900));
            }
        }
        if (!stopped) {
            say(t('sched.dr.finished'), 0);
            await new Promise((res) => setTimeout(res, 1400));
        }
    } finally {
        document.removeEventListener('keydown', onKey, true);
        clearNavPaint();
        bar.remove();
        _playing = false;
        host.afterPlay?.();
    }
}
