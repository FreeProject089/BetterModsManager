// The forms of the upkeep and navigation steps, in the task editor and in the task builder.
//
// One form per `needs`, like the other action forms in scheduler.ts's renderParams — kept here
// because these fifteen are new together and share their pickers with the task builder of
// Plugins & API (plugins/task-builder.ts), which renders exactly the same form for a step. A
// picker is only worth having if it is the same picker everywhere a step can be written.
//
// Every control carries `data-k` (the parameter it sets) and is bound by `bindParams`; nothing
// here keeps state of its own, so the editor's undo, its code view and the builder's live
// script all read the same `params` object.
//
// What is picked from a list is read from the app as it is: the pages and Settings cards from
// the live page, the mods/profiles/modpacks/apps from the editor's own pickers, the followed
// repos and catalogue items from the backend. A list written here would be a second copy of
// the app that could disagree with it.

import { invoke } from '../../core/api.js';
import { apiRoutes } from '../../core/script-engine.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import {
    NAV_CONTROLS, NAV_ITEM_KINDS, NAV_MODALS, NAV_PAGES, ITEM_PAGE, pageById, type NavItemKind,
} from './sched-nav-model.js';

/** What the editor already loaded, handed in so the forms do not reload it. */
export interface PickerData {
    profiles: any[];
    mods: any[];
    modpacks: any[];
    apps: any[];
}

/** The `needs` this module renders. scheduler.ts routes exactly these here. */
export const UPKEEP_NEEDS = [
    'navPage', 'navCard', 'navItem', 'navTarget', 'navWait', 'navMessage', 'navModal', 'navClick',
    'reposCheck', 'catUpdates', 'integrity', 'cacheClean', 'logsRotate', 'diskReport', 'repoServer',
    'catInstall', 'apiCall',
] as const;

const CACHE_TARGETS = ['catalog_cache', 'mod_cache', 'update_leftovers', 'crash_archive'];
const CACHE_DEFAULT = ['catalog_cache', 'mod_cache', 'update_leftovers'];

// ── Markup helpers ───────────────────────────────────────────────────────────────────────────

const lab = (text: string) => `<label class="sched-cmd-label">${escHtml(text)}</label>`;
const hint = (text: string) => `<span class="sched-cmd-hint">${escHtml(text)}</span>`;
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

function select(k: string, opts: [string, string][], cur: unknown, extra = ''): string {
    const c = str(cur);
    const known = opts.some(([v]) => v === c);
    return `<select class="input" data-k="${k}"${extra}>
        ${opts.map(([v, l]) => `<option value="${escAttr(v)}"${v === c ? ' selected' : ''}>${escHtml(l)}</option>`).join('')}
        ${c && !known ? `<option value="${escAttr(c)}" selected>${escHtml(c)}</option>` : ''}
    </select>`;
}

function num(k: string, cur: unknown, min: number, max: number, ph: string): string {
    return `<input class="input" type="number" data-k="${k}" data-num="1" min="${min}" max="${max}" step="any"
        style="max-width:130px" placeholder="${escAttr(ph)}" value="${escAttr(str(cur))}">`;
}

function text(k: string, cur: unknown, ph: string, extra = ''): string {
    return `<input class="input" data-k="${k}" placeholder="${escAttr(ph)}" value="${escAttr(str(cur))}"${extra}>`;
}

function check(k: string, on: boolean, title: string, desc = ''): string {
    return `<label class="sched-opt"><input type="checkbox" data-k="${k}" data-bool="1"${on ? ' checked' : ''}>
        <div><b>${escHtml(title)}</b>${desc ? `<span>${escHtml(desc)}</span>` : ''}</div></label>`;
}

/** A row: label above, control, optional hint. */
const field = (label: string, control: string, h = '') => `${lab(label)}${control}${h ? hint(h) : ''}`;

const dryBox = (params: Record<string, any>) => check('dryRun', params.dryRun === true, t('sched.up.dryRun'), t('sched.up.dryRunHint'));

// ── Binding ──────────────────────────────────────────────────────────────────────────────────

/**
 * Wire every `[data-k]` control to `params`. An emptied field removes its key, so the runner's
 * default applies again and the printed script stays short. `onChange` runs after each write.
 */
export function bindParams(host: HTMLElement, params: Record<string, any>, onChange?: (key: string) => void): void {
    host.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-k]').forEach((el) => {
        if (el.dataset.bound === '1') return;
        el.dataset.bound = '1';
        const isBox = (el as HTMLInputElement).type === 'checkbox';
        el.addEventListener(el.tagName === 'SELECT' || isBox ? 'change' : 'input', () => {
            const k = el.dataset.k || '';
            if (!k) return;
            if (isBox) params[k] = (el as HTMLInputElement).checked;
            else if (el.dataset.num) {
                const n = parseFloat(el.value);
                if (Number.isFinite(n)) params[k] = n; else delete params[k];
            } else if (el.value === '') delete params[k];
            else params[k] = el.value;
            onChange?.(k);
        });
    });
    // Checkbox groups: `data-klist="items"` on each box, the checked values as an array.
    const groups = new Set(Array.from(host.querySelectorAll<HTMLInputElement>('[data-klist]')).map((b) => b.dataset.klist || ''));
    for (const k of groups) {
        host.querySelectorAll<HTMLInputElement>(`[data-klist="${CSS.escape(k)}"]`).forEach((b) => {
            if (b.dataset.bound === '1') return;
            b.dataset.bound = '1';
            b.addEventListener('change', () => {
                params[k] = Array.from(host.querySelectorAll<HTMLInputElement>(`[data-klist="${CSS.escape(k)}"]`))
                    .filter((x) => x.checked).map((x) => x.value);
                onChange?.(k);
            });
        });
    }
}

/** The values of a list param, whatever shape it was saved in. */
function listOf(v: unknown): string[] {
    if (Array.isArray(v)) return v.map(String);
    const s = str(v).trim();
    if (!s) return [];
    if (s.startsWith('[')) { try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map(String); } catch { /* text */ } }
    return s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
}

function checkList(k: string, rows: { v: string; label: string; sub?: string }[], chosen: string[]): string {
    if (!rows.length) return `<div class="sched-cmd-hint">${escHtml(t('sched.up.nothingToPick'))}</div>`;
    return rows.map((r) => `<label class="sched-opt"><input type="checkbox" data-klist="${k}" value="${escAttr(r.v)}"${chosen.includes(r.v) ? ' checked' : ''}>
        <div><b>${escHtml(r.label)}</b>${r.sub ? `<span>${escHtml(r.sub)}</span>` : ''}</div></label>`).join('');
}

// ── Pickers read from the app ────────────────────────────────────────────────────────────────

/** The pages: the listed ones, then any screen the sidebar has that the list does not know. */
export function pageOptions(): [string, string][] {
    const out: [string, string][] = NAV_PAGES.map((p) => [p.id, t(p.key)]);
    document.querySelectorAll<HTMLElement>('.nav-item[data-view]').forEach((el) => {
        const id = el.dataset.view || '';
        if (id && !out.some(([v]) => v === id)) out.push([id, (el.textContent || id).replace(/\s+/g, ' ').trim()]);
    });
    return out;
}

/** The tabs of a page: the listed ones, then any tab on the live page the list does not know. */
export function tabOptions(page: string): [string, string][] {
    const out: [string, string][] = [['', t('sched.nv.noTab')]];
    for (const tb of pageById(page)?.tabs || []) out.push([tb.id, t(tb.key)]);
    document.querySelectorAll<HTMLElement>(`#view-${CSS.escape(page)} [role="tab"]`).forEach((b) => {
        const id = b.dataset.tab || b.dataset.repoTab || '';
        if (id && !out.some(([v]) => v === id || v.startsWith(`${id}/`) || v.endsWith(`/${id}`))) {
            out.push([id, (b.textContent || id).replace(/\s+/g, ' ').trim()]);
        }
    });
    return out;
}

/** The Settings cards, as the page has them (key = card-order's key, which nav.settingsCard reads). */
export function cardOptions(): [string, string][] {
    const out: [string, string][] = [];
    document.querySelectorAll<HTMLElement>('#view-settings .settings-sections > .glass-card').forEach((c) => {
        const key = c.dataset.cardKey || c.id;
        if (!key) return;
        const title = (c.querySelector('.card-title, h3')?.textContent || key).replace(/\s+/g, ' ').trim();
        out.push([key, title]);
    });
    return out;
}

/** The things of one kind a step can open, with their names. */
export async function itemOptions(kind: NavItemKind, data: PickerData): Promise<[string, string][]> {
    const named = (list: any[]) => (list || []).map((o): [string, string] => [String(o.id), String(o.name || o.title || o.id)]);
    switch (kind) {
        case 'mod': return named(data.mods);
        case 'profile': return named(data.profiles);
        case 'modpack': return named(data.modpacks);
        case 'app': return named(data.apps);
        case 'plugin': {
            const ps = (await invoke('get_installed_plugins').catch(() => [])) as { manifest?: { id: string; name?: string } }[];
            return (ps || []).filter((p) => p?.manifest?.id).map((p): [string, string] => [p.manifest!.id, p.manifest!.name || p.manifest!.id]);
        }
        case 'repo': {
            const rs = (await invoke('repo_follow_list').catch(() => [])) as { url: string; name: string }[];
            return (rs || []).map((r): [string, string] => [r.url, r.name || r.url]);
        }
    }
}

/** The controls nav.click may press, grouped by their page for an <optgroup> list. */
function controlSelect(cur: unknown): string {
    const c = str(cur);
    const pages = [...new Set(NAV_CONTROLS.map((x) => x.page))];
    return `<select class="input" data-k="control">
        <option value="">${escHtml(t('sched.nv.pickControl'))}</option>
        ${pages.map((pg) => `<optgroup label="${escAttr(t(pageById(pg)?.key || pg))}">
            ${NAV_CONTROLS.filter((x) => x.page === pg).map((x) => `<option value="${escAttr(x.id)}"${x.id === c ? ' selected' : ''}>${escHtml(t(x.key))}</option>`).join('')}
        </optgroup>`).join('')}
    </select>`;
}

/** Target suggestions: the listed controls by name, then a couple of selector shapes. */
function targetList(id: string): string {
    return `<datalist id="${id}">${NAV_CONTROLS.map((c) => `<option value="${escAttr(c.id)}">${escHtml(t(c.key))}</option>`).join('')}</datalist>`;
}

let _dl = 0;

// ── The forms ────────────────────────────────────────────────────────────────────────────────

/**
 * Render the form for one of UPKEEP_NEEDS into `host` and bind it. Synchronous markup first (the
 * previous action's fields must never stay on screen), the lists that come from the backend
 * filled a moment later.
 */
export function renderUpkeepForm(host: HTMLElement, needs: string, params: Record<string, any>, data: PickerData, onChange?: (key: string) => void): void {
    const wrap = (inner: string) => `<div class="sched-cmd-builder">${inner}</div>`;
    const done = () => bindParams(host, params, onChange);
    switch (needs) {
        case 'navPage': {
            const page = str(params.page);
            host.innerHTML = wrap(`
                ${field(t('sched.nv.page'), select('page', [['', t('sched.nv.pickPage')], ...pageOptions()], page))}
                <div class="snf-tab">${field(t('sched.nv.tab'), select('tab', tabOptions(page), params.tab), t('sched.nv.tabHint'))}</div>
                ${field(t('sched.nv.note'), text('note', params.note, t('sched.nv.notePh')))}
                ${field(t('sched.nv.seconds'), num('seconds', params.seconds, 0, 120, '2.5'))}`);
            done();
            host.querySelector<HTMLSelectElement>('[data-k="page"]')?.addEventListener('change', (e) => {
                delete params.tab;
                const box = host.querySelector<HTMLElement>('.snf-tab');
                if (box) box.innerHTML = field(t('sched.nv.tab'), select('tab', tabOptions((e.target as HTMLSelectElement).value), ''), t('sched.nv.tabHint'));
                done();
                onChange?.('tab');
            });
            return;
        }
        case 'navCard': {
            const cards = cardOptions();
            host.innerHTML = wrap(`
                ${field(t('sched.nv.card'), cards.length
                    ? select('card', [['', t('sched.nv.pickCard')], ...cards], params.card)
                    : text('card', params.card, t('sched.nv.cardPh')), t('sched.nv.cardHint'))}
                ${field(t('sched.nv.note'), text('note', params.note, t('sched.nv.notePh')))}
                ${field(t('sched.nv.seconds'), num('seconds', params.seconds, 0, 120, '2.5'))}`);
            done();
            return;
        }
        case 'navItem': {
            const kind = ((NAV_ITEM_KINDS as readonly string[]).includes(str(params.kind)) ? str(params.kind) : 'mod') as NavItemKind;
            if (!params.kind) params.kind = kind;
            host.innerHTML = wrap(`
                ${field(t('sched.nv.kind'), select('kind', NAV_ITEM_KINDS.map((k): [string, string] => [k, t('sched.nv.kind.' + k)]), kind))}
                <div class="snf-id">${field(t('sched.nv.which'), select('id', [['', t('sched.up.loading')]], params.id))}</div>
                ${hint(t('sched.nv.itemHint', { p: t(pageById(ITEM_PAGE[kind].page)?.key || '') }))}
                ${field(t('sched.nv.onMissing'), select('onMissing', [['', t('sched.nv.missAbort')], ['continue', t('sched.nv.missContinue')]], params.onMissing))}
                ${field(t('sched.nv.note'), text('note', params.note, t('sched.nv.notePh')))}`);
            done();
            const fillIds = async (k: NavItemKind) => {
                const opts = await itemOptions(k, data);
                const box = host.querySelector<HTMLElement>('.snf-id');
                if (!box) return;
                box.innerHTML = field(t('sched.nv.which'), opts.length
                    ? select('id', [['', t('sched.nv.pickItem')], ...opts], params.id)
                    : text('id', params.id, t('sched.nv.idPh')));
                done();
            };
            void fillIds(kind);
            host.querySelector<HTMLSelectElement>('[data-k="kind"]')?.addEventListener('change', (e) => {
                delete params.id;
                void fillIds((e.target as HTMLSelectElement).value as NavItemKind);
                onChange?.('id');
            });
            return;
        }
        case 'navTarget': {
            const dl = `snf-dl-${++_dl}`;
            host.innerHTML = wrap(`
                ${field(t('sched.nv.target'), text('target', params.target, t('sched.nv.targetPh'), ` list="${dl}" spellcheck="false"`), t('sched.nv.targetHint'))}
                ${targetList(dl)}
                ${field(t('sched.nv.onPage'), select('page', [['', t('sched.nv.anyPage')], ...pageOptions()], params.page), t('sched.nv.onPageHint'))}
                ${field(t('sched.nv.note'), text('note', params.note, t('sched.nv.notePh')))}
                ${field(t('sched.nv.seconds'), num('seconds', params.seconds, 0, 120, '3'))}
                ${field(t('sched.nv.onMissing'), select('onMissing', [['', t('sched.nv.missAbort')], ['continue', t('sched.nv.missContinue')]], params.onMissing))}`);
            done();
            return;
        }
        case 'navWait': {
            const dl = `snf-dl-${++_dl}`;
            host.innerHTML = wrap(`
                ${field(t('sched.nv.target'), text('target', params.target, t('sched.nv.targetPh'), ` list="${dl}" spellcheck="false"`), t('sched.nv.targetHint'))}
                ${targetList(dl)}
                ${field(t('sched.nv.timeout'), num('timeoutSec', params.timeoutSec, 1, 600, '15'))}
                ${field(t('sched.nv.onTimeout'), select('onTimeout', [['', t('sched.nv.missAbort')], ['continue', t('sched.nv.missContinue')]], params.onTimeout))}`);
            done();
            return;
        }
        case 'navMessage': {
            const dl = `snf-dl-${++_dl}`;
            host.innerHTML = wrap(`
                ${field(t('sched.nv.msgTitle'), text('title', params.title, t('sched.nv.msgTitlePh')))}
                ${lab(t('sched.nv.msgText'))}
                <textarea class="input" data-k="message" rows="3" placeholder="${escAttr(t('sched.nv.msgTextPh'))}">${escHtml(str(params.message))}</textarea>
                ${field(t('sched.nv.msgAnchor'), text('target', params.target, t('sched.nv.targetPh'), ` list="${dl}" spellcheck="false"`), t('sched.nv.msgAnchorHint'))}
                ${targetList(dl)}
                ${check('waitOk', params.waitOk === true, t('sched.nv.waitOk'), t('sched.nv.waitOkHint'))}
                ${field(t('sched.nv.seconds'), num('seconds', params.seconds, 0, 120, '5'))}`);
            done();
            return;
        }
        case 'navModal': {
            host.innerHTML = wrap(`
                ${field(t('sched.nv.modal'), select('modal', [['', t('sched.nv.pickModal')], ...NAV_MODALS.map((m): [string, string] => [m.id, t(m.key)])], params.modal))}
                ${hint(t('sched.nv.actPerm'))}`);
            done();
            return;
        }
        case 'navClick': {
            host.innerHTML = wrap(`
                ${field(t('sched.nv.control'), controlSelect(params.control), t('sched.nv.controlHint'))}
                ${hint(t('sched.nv.actPerm'))}`);
            done();
            return;
        }
        case 'reposCheck': {
            host.innerHTML = wrap(`
                ${field(t('sched.rf.mode'), select('mode', [
                    ['report', t('sched.rf.mode.report')], ['ask', t('sched.rf.mode.ask')], ['auto', t('sched.rf.mode.auto')],
                ], params.mode || 'report'), t('sched.rf.modeHint'))}
                ${lab(t('sched.rf.only'))}
                <div class="snf-repos">${hint(t('sched.up.loading'))}</div>
                ${hint(t('sched.rf.onlyHint'))}
                ${check('notify', params.notify !== false, t('sched.up.notify'))}
                ${dryBox(params)}`);
            done();
            void (async () => {
                const rs = (await invoke('repo_follow_list').catch(() => [])) as { url: string; name: string; follow?: { enabled: boolean; action: string } }[];
                const box = host.querySelector<HTMLElement>('.snf-repos');
                if (!box) return;
                box.innerHTML = rs.length
                    ? checkList('only', rs.map((r) => ({ v: r.url, label: r.name || r.url, sub: `${r.url} · ${t('sched.rf.act.' + (r.follow?.action || 'notify'))}${r.follow?.enabled ? '' : ` · ${t('sched.rf.off')}`}` })), listOf(params.only))
                    : hint(t('sched.rf.none'));
                done();
            })();
            return;
        }
        case 'catUpdates': {
            host.innerHTML = wrap(`
                ${field(t('sched.cu.mode'), select('mode', [
                    ['check', t('sched.cu.mode.check')], ['download', t('sched.cu.mode.download')], ['install', t('sched.cu.mode.install')],
                ], params.mode || 'check'), t('sched.cu.modeHint'))}
                ${lab(t('sched.cu.items'))}
                <div class="snf-items">${hint(t('sched.up.loading'))}</div>
                ${hint(t('sched.cu.itemsHint'))}
                ${check('notify', params.notify !== false, t('sched.up.notify'))}
                ${dryBox(params)}`);
            done();
            void (async () => {
                const { listSubscribed } = await import('./sched-maint.js');
                const items = await listSubscribed().catch(() => []);
                const box = host.querySelector<HTMLElement>('.snf-items');
                if (!box) return;
                box.innerHTML = items.length
                    ? checkList('items', items.map((i) => ({ v: i.key, label: i.name, sub: `${t('sched.cu.kind.' + i.kind)}${i.version ? ` · v${i.version}` : ''}` })), listOf(params.items))
                    : hint(t('sched.cu.noneInstalled'));
                done();
            })();
            return;
        }
        case 'integrity': {
            host.innerHTML = wrap(`
                ${field(t('sched.iv.scope'), select('scope', [['game', t('sched.iv.scope.game')], ['hashes', t('sched.iv.scope.hashes')]], params.scope || 'game'), t('sched.iv.scopeHint'))}
                ${check('enabledOnly', params.enabledOnly !== false, t('sched.iv.enabledOnly'))}
                ${field(t('sched.iv.max'), num('max', params.max, 1, 5000, '500'))}
                ${check('notifyClean', params.notifyClean === true, t('sched.iv.notifyClean'), t('sched.iv.notifyCleanHint'))}`);
            done();
            return;
        }
        case 'cacheClean': {
            const chosen = params.targets === undefined ? CACHE_DEFAULT : listOf(params.targets);
            host.innerHTML = wrap(`
                ${lab(t('sched.cc.targets'))}
                ${checkList('targets', CACHE_TARGETS.map((id) => ({ v: id, label: t('sched.cc.t.' + id), sub: t('sched.cc.d.' + id) })), chosen)}
                ${field(t('sched.cc.minMb'), num('minMb', params.minMb, 0, 1_000_000, '0'), t('sched.cc.minMbHint'))}
                ${check('notify', params.notify !== false, t('sched.up.notify'))}
                ${dryBox(params)}
                ${hint(t('sched.up.deletePerm'))}`);
            done();
            return;
        }
        case 'logsRotate': {
            host.innerHTML = wrap(`
                ${field(t('sched.lr.keepDays'), num('keepDays', params.keepDays, 1, 3650, '30'), t('sched.lr.keepDaysHint'))}
                ${field(t('sched.lr.maxKb'), num('maxKb', params.maxKb, 16, 1_048_576, '1024'), t('sched.lr.maxKbHint'))}
                ${check('notify', params.notify === true, t('sched.up.notify'))}
                ${dryBox(params)}
                ${hint(t('sched.up.deletePerm'))}`);
            done();
            return;
        }
        case 'diskReport': {
            host.innerHTML = wrap(`
                ${field(t('sched.du.top'), num('top', params.top, 1, 100, '10'))}
                ${check('write', params.write !== false, t('sched.du.write'), t('sched.du.writeHint'))}
                ${field(t('sched.du.file'), text('file', params.file, 'disk-usage.md'))}
                ${check('notify', params.notify !== false, t('sched.up.notify'))}`);
            done();
            return;
        }
        case 'repoServer': {
            host.innerHTML = wrap(`
                ${field(t('sched.srv.state'), select('state', [['start', t('sched.srv.state.start')], ['stop', t('sched.srv.state.stop')]], params.state || 'start'))}
                <div class="snf-start"${params.state === 'stop' ? ' hidden' : ''}>
                    ${lab(t('sched.srv.dir'))}
                    <div class="sched-cmd-row">
                        ${text('dir', params.dir, t('sched.srv.dirPh'), ' spellcheck="false"')}
                        <button type="button" class="btn btn-sm btn-secondary snf-browse">${escHtml(t('sched.choose'))}</button>
                    </div>
                    ${field(t('sched.srv.port'), num('port', params.port, 1, 65535, '8000'))}
                    ${field(t('sched.srv.upload'), num('uploadLimit', params.uploadLimit, 0, 1_000_000, '0'), t('sched.srv.uploadHint'))}
                    ${lab(t('sched.srv.password'))}
                    <input class="input" type="password" autocomplete="new-password" data-k="password" value="${escAttr(str(params.password))}" placeholder="${escAttr(t('sched.srv.passwordPh'))}">
                    ${hint(t('sched.srv.startHint'))}
                </div>
                ${check('notify', params.notify !== false, t('sched.up.notify'))}`);
            done();
            host.querySelector<HTMLSelectElement>('[data-k="state"]')?.addEventListener('change', (e) => {
                const box = host.querySelector<HTMLElement>('.snf-start');
                if (box) box.hidden = (e.target as HTMLSelectElement).value === 'stop';
            });
            host.querySelector('.snf-browse')?.addEventListener('click', async () => {
                const { pickFolder } = await import('../../core/api.js');
                const dir = await pickFolder().catch(() => null);
                if (!dir) return;
                params.dir = String(dir);
                const inp = host.querySelector<HTMLInputElement>('[data-k="dir"]');
                if (inp) inp.value = String(dir);
                onChange?.('dir');
            });
            return;
        }
        case 'catInstall': {
            host.innerHTML = wrap(`
                ${field(t('sched.ci.kind'), select('kind', [['app', t('sched.ci.kind.app')], ['plugin', t('sched.ci.kind.plugin')], ['theme', t('sched.ci.kind.theme')], ['modpack', t('sched.ci.kind.modpack')]], params.kind || 'app'))}
                ${field(t('sched.ci.id'), text('id', params.id, t('sched.ci.idPh'), ' spellcheck="false"'), t('sched.ci.idHint'))}
                ${field(t('sched.ci.onFail'), select('onFail', [['', t('sched.nv.missAbort')], ['continue', t('sched.nv.missContinue')]], params.onFail))}
                ${check('notify', params.notify !== false, t('sched.up.notify'))}
                ${hint(t('sched.ci.rules'))}`);
            done();
            return;
        }
        case 'apiCall': {
            const routes = apiRoutes();
            const cur = `${str(params.method || 'GET').toUpperCase()} ${str(params.path)}`;
            const opts = routes.map((r): [string, string] => [`${r.method} ${r.path}`, `${r.method} ${r.path}${r.desc ? ` · ${r.desc}` : ''}`]);
            host.innerHTML = wrap(`
                ${field(t('sched.api.route'), routes.length
                    ? `<select class="input snf-route">${[['', t('sched.api.pickRoute')], ...opts].map(([v, l]) => `<option value="${escAttr(v)}"${v === cur ? ' selected' : ''}>${escHtml(l)}</option>`).join('')}</select>`
                    : hint(t('sched.api.noRoutes')))}
                <div class="sched-cmd-row">
                    ${select('method', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m): [string, string] => [m, m]), params.method || 'GET', ' style="max-width:110px"')}
                    ${text('path', params.path, '/api/status', ' spellcheck="false"')}
                </div>
                ${lab(t('sched.api.body'))}
                <textarea class="input" data-k="body" rows="4" spellcheck="false" placeholder="{ }">${escHtml(str(params.body))}</textarea>
                <div class="snf-fields">${hint(t('sched.api.bodyHint'))}</div>
                ${check('anyStatus', params.anyStatus === true, t('sched.api.anyStatus'), t('sched.api.anyStatusHint'))}
                ${hint(t('sched.api.perm'))}`);
            done();
            const showFields = (key: string) => {
                const r = routes.find((x) => `${x.method} ${x.path}` === key);
                const box = host.querySelector<HTMLElement>('.snf-fields');
                if (!box) return;
                box.innerHTML = r?.fields?.length
                    ? hint(r.fields.map((fd) => `${fd.name}${fd.required ? '*' : ''} (${fd.type})`).join(' · '))
                    : hint(t('sched.api.bodyHint'));
            };
            showFields(cur);
            host.querySelector<HTMLSelectElement>('.snf-route')?.addEventListener('change', (e) => {
                const v = (e.target as HTMLSelectElement).value;
                if (!v) return;
                const [method, ...rest] = v.split(' ');
                const path = rest.join(' ');
                params.method = method;
                params.path = path;
                const r = routes.find((x) => x.method === method && x.path === path);
                // A body skeleton with the route's required fields, so it is filled rather than recalled.
                if (method !== 'GET' && !str(params.body).trim() && r?.fields?.length) {
                    const o: Record<string, string> = {};
                    for (const fd of r.fields) if (fd.required) o[fd.name] = '';
                    params.body = JSON.stringify(o, null, 2);
                }
                const m = host.querySelector<HTMLSelectElement>('[data-k="method"]');
                const pth = host.querySelector<HTMLInputElement>('[data-k="path"]');
                const b = host.querySelector<HTMLTextAreaElement>('[data-k="body"]');
                if (m) m.value = method;
                if (pth) pth.value = path;
                if (b) b.value = str(params.body);
                showFields(v);
                onChange?.('path');
            });
            return;
        }
    }
    host.innerHTML = '';
}
