// Automation packages, the frontend half (Rust: src-tauri/src/commands/sched_pkg.rs).
//
// A task can carry files: the hook script a server asks for, the mod list to check against, a
// small mod. They live in a PACKAGE, a `.bmmbundle` with a signed `automation.bmmpa` (version 2)
// inside, and on this machine in the content-addressed store `AutomationPackages/<id>/`. A task
// points at its package with `task.pkg` ({ id, name, signature }); its steps name a file by its
// path inside the package (`files/BMM-JoinGate.lua`).
//
// This module holds three things, each kept out of scheduler.ts so that file does not grow
// another thousand lines:
//
//   · the RUN half of the package and game steps (pkg.install, pkg.verify, modlist.verify,
//     gate.report, game.launch, ui.ask). scheduler.ts's runAction calls these with what only it
//     knows (the permission check, the stop signal), passed in as `PkgEnv`;
//   · their FORMS in the editor (`PKG_NEEDS`, `renderPkgForm`);
//   · the package screens: attach files to a task, export it as a package, import one.
//
// What it never does: decide a permission (the executor's `requirePerm` does, through `env`),
// write outside the roots Rust resolves, or run a program without the `command` grant. Every
// placement is asked in a BMM dialog (never window.confirm) and leaves a receipt.

import { invoke, pickFile, pickFolder, saveFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { openModal } from '../../ui/modal-shell.js';
import { uiIcon } from '../../ui/icons.js';
import type { RunCtx } from './sched-vars.js';

// ── Types ────────────────────────────────────────────────────────────────────────────────────

/** What a task keeps about its package. Set by the importer or by « attach files », never by a
 *  file: `sanitiseImportedTask` removes it, so a plain .bmmpa cannot point at another package. */
export interface TaskPkg { id: string; name: string; signature: string }

import { kb, itemsOf, splitArgs, entryNameFor, type PkgFile } from './sched-pkg-model.js';
export { kb, itemsOf, splitArgs, entryNameFor, type PkgFile };

export interface PkgInfo {
    id: string;
    name: string;
    doc: string;
    signature: string;
    authorId?: string | null;
    files: PkgFile[];
    dir: string;
}

/** A toast, lent by the caller (this module stays out of the app shell's import graph). */
export type Say = (msg: string, kind: string, ms?: number) => void;

/** What the executor lends a package step. */
export interface PkgEnv {
    task: { id: string; name: string; pkg?: TaskPkg };
    ctx: RunCtx;
    /** Throws the executor's own « not permitted » error. */
    requirePerm: (key: 'files' | 'command', label: string) => void;
    toast: (msg: string, kind: string, ms?: number) => void;
}

export const ROOTS = ['dcs', 'game', 'mods'] as const;
export type Root = (typeof ROOTS)[number];

/** The step forms this module renders. scheduler.ts routes exactly these here. */
export const PKG_NEEDS = ['pkgInstall', 'pkgVerify', 'listVerify', 'gateReport', 'gameLaunch', 'uiAsk'] as const;

/** This feature's stylesheet, linked the first time one of its screens opens. */
export function ensurePkgCss(): void {
    if (document.getElementById('sched-pkg-css')) return;
    const link = document.createElement('link');
    link.id = 'sched-pkg-css';
    link.rel = 'stylesheet';
    link.href = 'css/sched-pkg.css';
    document.head.appendChild(link);
}

// ── Small helpers ────────────────────────────────────────────────────────────────────────────

/** A Rust error, in words: `pkg.errHash|files/x` → the sentence, with the detail after it. */
export function pkgError(e: unknown): string {
    const raw = String((e as any)?.message ?? e ?? '');
    const [key, ...rest] = raw.split('|');
    const said = key.startsWith('pkg.') || key.startsWith('game.') ? t(key) : raw;
    return rest.length && said !== raw ? `${said} (${rest.join('|')})` : said;
}

export function rootLabel(r: string): string {
    if (r === 'dcs') return t('sched.pkg.root.dcs');
    if (r === 'game') return t('sched.pkg.root.game');
    if (r === 'mods') return t('sched.pkg.root.mods');
    return r;
}

async function info(id: string): Promise<PkgInfo> {
    return await invoke('automation_package_info', { id }) as PkgInfo;
}

function needPkg(env: PkgEnv): TaskPkg {
    const p = env.task.pkg;
    if (!p || !p.id) throw new Error(t('sched.pkg.noPkg'));
    return p;
}

/** Ask with BMM's own dialog. Resolves true for the first button. Never window.confirm. */
export function askModal(opts: { title: string; message: string; yes: string; no: string; tone?: 'accent' | 'warn' | 'danger' | 'ok'; detail?: string }): Promise<boolean> {
    ensurePkgCss();
    return new Promise((resolve) => {
        let answered = false;
        const footer = document.createElement('div');
        footer.className = 'spkg-ask-foot';
        footer.innerHTML = `<button type="button" class="btn btn-secondary" data-no>${escHtml(opts.no)}</button>
            <button type="button" class="btn ${opts.tone === 'danger' ? 'btn-danger' : 'btn-primary'}" data-yes>${escHtml(opts.yes)}</button>`;
        const h = openModal({
            title: opts.title,
            icon: uiIcon(opts.tone === 'warn' || opts.tone === 'danger' ? 'warning' : 'help', 18),
            tone: opts.tone || 'accent',
            size: 'md',
            className: 'spkg-ask',
            body: `${opts.message ? `<p class="spkg-ask-msg">${escHtml(opts.message).replace(/\n/g, '<br>')}</p>` : ''}${opts.detail || ''}`,
            footer,
            onClose: () => { if (!answered) resolve(false); },
            initialFocus: '[data-yes]',
        });
        footer.querySelector('[data-yes]')?.addEventListener('click', () => { answered = true; h.close(); resolve(true); });
        footer.querySelector('[data-no]')?.addEventListener('click', () => { answered = true; h.close(); resolve(false); });
        h.dialog.querySelector('[data-show-file]')?.addEventListener('click', async (e) => {
            const b = e.currentTarget as HTMLButtonElement;
            const pre = h.dialog.querySelector('.spkg-file-pre') as HTMLElement | null;
            if (!pre) return;
            if (!pre.hidden) { pre.hidden = true; return; }
            b.disabled = true;
            try { pre.textContent = String(await invoke('automation_package_read', { id: b.dataset.id, file: b.dataset.file })); }
            catch (err) { pre.textContent = pkgError(err); }
            pre.hidden = false;
            b.disabled = false;
        });
    });
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────

/** Place a packaged file. Needs `files`, then the person's yes for this exact placement (once per
 *  package version, or every time). A « no » is an answer, not a failure: pkg.consent = 0. */
export async function runPkgInstall(p: Record<string, any>, env: PkgEnv): Promise<void> {
    const { ctx, task } = env;
    env.requirePerm('files', t('sched.permFiles'));
    const pkg = needPkg(env);
    const file = String(p.file || '').trim();
    const root = (ROOTS as readonly string[]).includes(String(p.root)) ? String(p.root) : 'dcs';
    const dest = String(p.dest ?? '').trim();
    if (!file) throw new Error(t('sched.pkg.noFile'));
    const pi = await info(pkg.id);
    const covered = pi.files.filter((f) => f.name === file || f.name.startsWith(file + '/'));
    if (!covered.length) throw new Error(`${t('pkg.errNoFile')} (${file})`);
    const size = covered.reduce((n, f) => n + f.size, 0);
    const where = `${rootLabel(root)}${p.dir ? ` (${p.dir})` : ''}${dest ? ` › ${dest}` : ''}`;

    const prior = p.askEachTime === true ? null : await invoke('automation_consent_find', {
        taskId: task.id, pkgId: pkg.id, file, root, dest,
    }).catch(() => null) as { choice?: string } | null;
    let yes = prior?.choice === 'accepted';
    if (!yes) {
        const sig = pi.signature === 'valid' ? t('sched.pkg.sigValid', { a: String(pi.authorId || '').slice(0, 12) })
            : pi.signature === 'builtin' ? t('sched.pkg.sigBuiltin')
            : pi.signature === 'local' ? t('sched.pkg.sigLocal') : t('sched.pkg.sigNone');
        const message = t('sched.pkg.askBody', { task: task.name, file: file.replace(/^files\//, ''), size: kb(size), n: String(covered.length), pkg: pi.name || pkg.name, where });
        const textual = covered.length === 1 && size < 256 * 1024;
        const detail = `<p class="spkg-ask-sig ${pi.signature === 'valid' || pi.signature === 'builtin' ? 'is-ok' : 'is-warn'}">${escHtml(sig)}</p>
            ${textual ? `<button type="button" class="btn btn-xs btn-ghost" data-show-file data-id="${escAttr(pkg.id)}" data-file="${escAttr(covered[0].name)}">${escHtml(t('sched.pkg.showFile'))}</button><pre class="spkg-file-pre" hidden></pre>` : ''}`;
        yes = await askModal({ title: t('sched.pkg.askTitle'), message, yes: t('sched.pkg.askYes'), no: t('sched.pkg.askNo'), tone: 'warn', detail });
        // The receipt: what was asked (hashed), and the answer. Best effort: the answer stands
        // even if the receipt cannot be written, and that failure is logged by Rust.
        await invoke('automation_consent_record', {
            input: { taskId: task.id, pkgId: pkg.id, file, root, dest, text: `${message}\n${sig}`, choice: yes ? 'accepted' : 'declined' },
        }).catch(() => null);
    }
    ctx.nums['pkg.consent'] = yes ? 1 : 0;
    if (!yes) {
        ctx.nums['pkg.installed'] = 0;
        env.toast(`${task.name}: ${t('sched.pkg.declined')}`, 'warning', 8000);
        return;
    }
    const placed = await invoke('automation_package_install', {
        id: pkg.id, file, root, dir: p.dir || null, dest, overwrite: p.overwrite !== false,
    }).catch((e) => { throw new Error(pkgError(e)); }) as { path: string; same: boolean }[];
    const written = placed.filter((x) => !x.same).length;
    ctx.nums['pkg.installed'] = written;
    ctx.text['pkg.paths'] = placed.map((x) => x.path).join('\n');
    env.toast(`${task.name}: ${written ? t('sched.pkg.installed', { n: String(written) }) : t('sched.pkg.already')}`, 'success', 7000);
}

/** Is the packaged file at its place, identical? Read-only, asks for nothing. */
export async function runPkgVerify(p: Record<string, any>, env: PkgEnv): Promise<void> {
    const { ctx } = env;
    const pkg = needPkg(env);
    const file = String(p.file || '').trim();
    if (!file) throw new Error(t('sched.pkg.noFile'));
    const root = (ROOTS as readonly string[]).includes(String(p.root)) ? String(p.root) : 'dcs';
    let rows: { path: string; ok: boolean; actual: string | null }[] = [];
    try {
        rows = await invoke('automation_package_verify', { id: pkg.id, file, root, dir: p.dir || null, dest: String(p.dest ?? '') }) as typeof rows;
    } catch (e) {
        ctx.nums['pkg.ok'] = 0;
        ctx.nums['pkg.missing'] = 1;
        ctx.text['pkg.report'] = pkgError(e);
        ctx.text['pkg.summary'] = ctx.text['pkg.report'];
        return;
    }
    const bad = rows.filter((r) => !r.ok);
    ctx.nums['pkg.ok'] = bad.length ? 0 : 1;
    ctx.nums['pkg.missing'] = bad.length;
    ctx.text['pkg.report'] = bad.map((r) => `${r.actual ? t('sched.pkg.differs') : t('sched.pkg.absent')}: ${r.path}`).join('\n');
    ctx.text['pkg.summary'] = bad.length ? t('sched.pkg.verifyBad', { n: String(bad.length) }) : t('sched.pkg.verifyOk', { n: String(rows.length) });
}

export interface ListReport {
    name: string; total: number; ok: boolean; missing: string[]; inactive: string[]; altered: string[];
    extra: string[]; undeployed: string[]; fingerprint: string; checkedFiles: number;
}

/** The report as lines a person can act on, the problems first. */
export function listReportLines(r: ListReport): string[] {
    const out: string[] = [];
    const add = (key: string, arr: string[]) => {
        if (!arr.length) return;
        out.push(`${t(key, { n: String(arr.length) })}: ${arr.slice(0, 8).join(', ')}${arr.length > 8 ? ', …' : ''}`);
    };
    add('sched.lv.missing', r.missing);
    add('sched.lv.inactive', r.inactive);
    add('sched.lv.altered', r.altered);
    add('sched.lv.undeployed', r.undeployed);
    add('sched.lv.extra', r.extra);
    return out;
}

/** Where a list comes from: a path, or a .mm the package carries (checked against its hash). */
async function listPath(p: Record<string, any>, env: PkgEnv): Promise<string> {
    const fromPkg = String(p.file || '').trim();
    if (fromPkg) {
        const pkg = needPkg(env);
        return await invoke('automation_package_path', { id: pkg.id, file: fromPkg }).catch((e) => { throw new Error(pkgError(e)); }) as string;
    }
    const path = String(p.path || '').trim();
    if (!path) throw new Error(t('sched.lv.noList'));
    return path;
}

/** Is this mod list active, in place and intact? Read-only: fixing is modlist.apply. */
export async function runListVerify(p: Record<string, any>, env: PkgEnv): Promise<ListReport> {
    const { ctx } = env;
    const path = await listPath(p, env);
    const r = await invoke('modlist_verify', {
        path, passphrase: p.passphrase ? String(p.passphrase) : null, exact: p.exact === true, hashes: p.hashes !== false,
    }).catch((e) => { throw new Error(pkgError(e)); }) as ListReport;
    ctx.nums['list.ok'] = r.ok ? 1 : 0;
    ctx.nums['list.missing'] = r.missing.length;
    ctx.nums['list.inactive'] = r.inactive.length;
    ctx.nums['list.altered'] = r.altered.length + r.undeployed.length;
    ctx.nums['list.extra'] = r.extra.length;
    ctx.text['list.name'] = r.name;
    ctx.text['list.path'] = path;
    ctx.text['list.fingerprint'] = r.fingerprint;
    const lines = listReportLines(r);
    ctx.text['list.report'] = lines.join('\n');
    ctx.text['list.summary'] = r.ok ? t('sched.lv.okSum', { n: String(r.total), fp: r.fingerprint }) : lines[0] || t('sched.lv.badSum');
    return r;
}

/** The result, where the game-side script reads it. Needs `files`; the place is fixed by Rust. */
export async function runGateReport(p: Record<string, any>, env: PkgEnv): Promise<void> {
    const { ctx, task } = env;
    env.requirePerm('files', t('sched.permFiles'));
    const root = String(p.root || 'dcs') === 'game' ? 'game' : 'dcs';
    const report = {
        server: String(p.server || '').slice(0, 200),
        ok: ctx.nums['list.ok'] === 1 && (ctx.nums['pkg.ok'] === undefined || ctx.nums['pkg.ok'] === 1),
        fingerprint: String(ctx.text['list.fingerprint'] || ''),
        list: String(ctx.text['list.name'] || ''),
        missing: Number(ctx.nums['list.missing'] || 0),
        inactive: Number(ctx.nums['list.inactive'] || 0),
        altered: Number(ctx.nums['list.altered'] || 0),
        extra: Number(ctx.nums['list.extra'] || 0),
        task: task.name.slice(0, 120),
    };
    const paths = await invoke('automation_gate_report', { root, dir: p.dir || null, report }).catch((e) => { throw new Error(pkgError(e)); }) as string[];
    ctx.nums['gate.written'] = paths.length;
    ctx.text['gate.paths'] = paths.join('\n');
}

async function copyText(text: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** Start a game with arguments, without waiting for it. Needs `command`, like any program. */
export async function runGameLaunch(p: Record<string, any>, env: PkgEnv): Promise<void> {
    const { ctx, task } = env;
    env.requirePerm('command', t('sched.permRunCommand'));
    const exe = String(p.exe || '').trim();
    if (!exe) throw new Error(t('sched.gl.noExe'));
    const clip = String(p.clipboard || '').trim();
    if (clip) ctx.nums['game.copied'] = (await copyText(clip)) ? 1 : 0;
    const pid = await invoke('launch_with_args', {
        exe, args: splitArgs(String(p.args || '')), workingDir: p.workingDir || null, allow: true,
    }).catch((e) => { throw new Error(pkgError(e)); }) as number;
    ctx.nums['game.pid'] = Number(pid) || 0;
    env.toast(`${task.name}: ${t('sched.gl.started')}${clip ? ` ${t('sched.gl.copied', { v: clip })}` : ''}`, 'success', 9000);
}

/** Ask the person, in BMM's own dialog, and keep the answer for the next steps (ask.yes). */
export async function runAsk(p: Record<string, any>, env: PkgEnv): Promise<void> {
    const yes = await askModal({
        title: String(p.title || env.task.name),
        message: String(p.message || ''),
        yes: String(p.yes || t('common.yes')),
        no: String(p.no || t('common.no')),
        tone: p.tone === 'warn' ? 'warn' : 'accent',
    });
    env.ctx.nums['ask.yes'] = yes ? 1 : 0;
}

// ── Forms ────────────────────────────────────────────────────────────────────────────────────

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const lab = (text: string) => `<label class="sched-cmd-label">${escHtml(text)}</label>`;
const hint = (text: string) => `<span class="sched-cmd-hint">${escHtml(text)}</span>`;

function sel(k: string, opts: [string, string][], cur: unknown): string {
    const c = str(cur);
    const known = opts.some(([v]) => v === c);
    return `<select class="input" data-k="${k}">${opts.map(([v, l]) => `<option value="${escAttr(v)}"${v === c ? ' selected' : ''}>${escHtml(l)}</option>`).join('')}${c && !known ? `<option value="${escAttr(c)}" selected>${escHtml(c)}</option>` : ''}</select>`;
}
function inp(k: string, cur: unknown, ph: string): string {
    return `<input class="input" data-k="${k}" placeholder="${escAttr(ph)}" value="${escAttr(str(cur))}">`;
}
function box(k: string, on: boolean, title: string, desc = ''): string {
    return `<label class="sched-opt"><input type="checkbox" data-k="${k}" data-bool="1"${on ? ' checked' : ''}><div><b>${escHtml(title)}</b>${desc ? `<span>${escHtml(desc)}</span>` : ''}</div></label>`;
}

function bind(host: HTMLElement, params: Record<string, any>, onChange?: () => void): void {
    host.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-k]').forEach((el) => {
        if (el.dataset.bound === '1') return;
        el.dataset.bound = '1';
        const isBox = (el as HTMLInputElement).type === 'checkbox';
        el.addEventListener(el.tagName === 'SELECT' || isBox ? 'change' : 'input', () => {
            const k = el.dataset.k || '';
            if (isBox) params[k] = (el as HTMLInputElement).checked;
            else if (el.value === '') delete params[k];
            else params[k] = el.value;
            onChange?.();
        });
    });
}

/** The package file picker of a form: the task's package items, or a field when it has none. */
function fileField(k: string, cur: unknown, items: { name: string; files: number; size: number }[], filter?: (n: string) => boolean): string {
    const rows = items.filter((i) => !filter || filter(i.name));
    if (!rows.length) return `${inp(k, cur, 'files/…')}${hint(t('sched.pkg.noItems'))}`;
    return sel(k, [['', t('sched.pkg.pickFile')], ...rows.map((i): [string, string] => [i.name, `${i.name.replace(/^files\//, '')} · ${i.files > 1 ? t('sched.pkg.nFiles', { n: String(i.files) }) : kb(i.size)}`])], cur);
}

function rootFields(params: Record<string, any>, dcs: string[], roots: readonly string[] = ROOTS): string {
    const root = str(params.root) || 'dcs';
    if (!params.root) params.root = root;
    return `${lab(t('sched.pkg.root'))}${sel('root', roots.map((r): [string, string] => [r, rootLabel(r)]), root)}
        <div class="spkg-dcsdir"${root === 'dcs' ? '' : ' hidden'}>${lab(t('sched.pkg.dcsDir'))}${sel('dir', [['', t('sched.pkg.dcsAll', { n: String(dcs.length) })], ...dcs.map((d): [string, string] => [d, d])], params.dir)}
        ${dcs.length ? '' : hint(t('sched.pkg.noDcs'))}</div>`;
}

/**
 * Render one of PKG_NEEDS into `host`. Synchronous markup first (the previous action's fields
 * must never stay on screen), then the package's file list and the DCS folders, filled in.
 */
export function renderPkgForm(host: HTMLElement, needs: string, params: Record<string, any>, pkg: TaskPkg | undefined, onChange?: () => void): void {
    ensurePkgCss();
    const wrap = (inner: string) => `<div class="sched-cmd-builder spkg-form">${inner}</div>`;
    const draw = (items: { name: string; files: number; size: number }[], dcs: string[]) => {
        const pkgLine = pkg ? `<p class="spkg-form-pkg">${uiIcon('package', 12)} ${escHtml(t('sched.pkg.from', { p: pkg.name || pkg.id }))}</p>` : '';
        switch (needs) {
            case 'pkgInstall':
                host.innerHTML = wrap(`${pkgLine}
                    ${lab(t('sched.pkg.file'))}${fileField('file', params.file, items)}
                    ${rootFields(params, dcs)}
                    ${lab(t('sched.pkg.dest'))}${inp('dest', params.dest, 'Scripts/Hooks')}${hint(t('sched.pkg.destHint'))}
                    ${box('askEachTime', params.askEachTime === true, t('sched.pkg.askEach'), t('sched.pkg.askEachHint'))}
                    ${hint(t('sched.pkg.installHint'))}`);
                break;
            case 'pkgVerify':
                host.innerHTML = wrap(`${pkgLine}
                    ${lab(t('sched.pkg.file'))}${fileField('file', params.file, items)}
                    ${rootFields(params, dcs)}
                    ${lab(t('sched.pkg.dest'))}${inp('dest', params.dest, 'Scripts/Hooks')}
                    ${hint(t('sched.pkg.verifyHint'))}`);
                break;
            case 'listVerify':
                host.innerHTML = wrap(`
                    ${lab(t('sched.lv.list'))}<div class="spkg-row">${inp('path', params.path, 'C:/…/server.mm')}<button type="button" class="btn btn-sm btn-secondary" data-browse="mm">${escHtml(t('sched.pkg.browse'))}</button></div>
                    ${items.some((i) => /\.mm$/i.test(i.name)) ? `${lab(t('sched.lv.orPkg'))}${fileField('file', params.file, items, (n) => /\.mm$/i.test(n))}` : ''}
                    ${box('exact', params.exact === true, t('sched.lv.exact'), t('sched.lv.exactHint'))}
                    ${box('hashes', params.hashes !== false, t('sched.lv.hashes'), t('sched.lv.hashesHint'))}
                    <div class="spkg-fp" aria-live="polite"></div>
                    ${hint(t('sched.lv.hint'))}`);
                break;
            case 'gateReport':
                host.innerHTML = wrap(`
                    ${lab(t('sched.gr.server'))}${inp('server', params.server, '203.0.113.10:10308')}
                    ${rootFields(params, dcs, ['dcs', 'game'])}
                    ${hint(t('sched.gr.hint'))}`);
                break;
            case 'gameLaunch':
                host.innerHTML = wrap(`
                    ${lab(t('sched.gl.exe'))}<div class="spkg-row">${inp('exe', params.exe, 'C:/…/DCS World/bin/DCS.exe')}<button type="button" class="btn btn-sm btn-secondary" data-browse="exe">${escHtml(t('sched.pkg.browse'))}</button></div>
                    ${lab(t('sched.gl.args'))}${inp('args', params.args, '--force_enable_VR')}${hint(t('sched.gl.argsHint'))}
                    ${lab(t('sched.gl.clip'))}${inp('clipboard', params.clipboard, '{server}')}${hint(t('sched.gl.clipHint'))}
                    ${lab(t('sched.gl.wd'))}${inp('workingDir', params.workingDir, '')}
                    ${hint(t('sched.gl.hint'))}`);
                break;
            case 'uiAsk':
                host.innerHTML = wrap(`
                    ${lab(t('sched.ask.title'))}${inp('title', params.title, t('sched.ask.titlePh'))}
                    ${lab(t('sched.ask.message'))}<textarea class="input" rows="3" data-k="message" placeholder="${escAttr(t('sched.ask.messagePh'))}">${escHtml(str(params.message))}</textarea>
                    <div class="spkg-row">${inp('yes', params.yes, t('common.yes'))}${inp('no', params.no, t('common.no'))}</div>
                    ${hint(t('sched.ask.hint'))}`);
                break;
            default:
                return;
        }
        bind(host, params, onChange);
        host.querySelector<HTMLSelectElement>('[data-k="root"]')?.addEventListener('change', (e) => {
            const d = host.querySelector<HTMLElement>('.spkg-dcsdir');
            if (d) d.hidden = (e.target as HTMLSelectElement).value !== 'dcs';
            if ((e.target as HTMLSelectElement).value !== 'dcs') delete params.dir;
        });
        host.querySelectorAll<HTMLButtonElement>('[data-browse]').forEach((b) => b.addEventListener('click', async () => {
            const kind = b.dataset.browse;
            const path = await pickFile(kind === 'exe' ? [{ name: 'Program', extensions: ['exe'] }] : [{ name: 'Mod list', extensions: ['mm', 'mmlist', 'json'] }]);
            if (!path) return;
            const k = kind === 'exe' ? 'exe' : 'path';
            params[k] = path;
            const el = host.querySelector<HTMLInputElement>(`[data-k="${k}"]`);
            if (el) el.value = path;
            onChange?.();
            if (kind === 'mm') void showFingerprint(host, path);
        }));
        if (needs === 'listVerify' && params.path) void showFingerprint(host, String(params.path));
    };
    draw([], []);
    void (async () => {
        const items = pkg?.id ? await info(pkg.id).then((i) => itemsOf(i.files)).catch(() => []) : [];
        const dcs = ['pkgInstall', 'pkgVerify', 'gateReport'].includes(needs) ? await (invoke('dcs_saved_games') as Promise<string[]>).catch(() => []) : [];
        if (!host.isConnected) return;
        if (items.length || dcs.length) draw(items, dcs);
    })();
}

/** The list's fingerprint under the field: the value a server admin puts in their script. */
async function showFingerprint(host: HTMLElement, path: string): Promise<void> {
    const out = host.querySelector<HTMLElement>('.spkg-fp');
    if (!out) return;
    try {
        const r = await invoke('modlist_verify', { path, passphrase: null, exact: false, hashes: false }) as ListReport;
        out.innerHTML = `${escHtml(t('sched.lv.fp'))} <code>${escHtml(r.fingerprint)}</code> · ${escHtml(t('sched.lv.nMods', { n: String(r.total) }))}`;
    } catch (e) {
        out.textContent = pkgError(e);
    }
}

// ── Attach, export, import ───────────────────────────────────────────────────────────────────

/** The « Files » section of the task editor: what the task carries, add or remove. */
export function renderPkgSection(host: HTMLElement, draft: { name: string; pkg?: TaskPkg }, onChange: () => void, say: Say): void {
    ensurePkgCss();
    const draw = async () => {
        const pkg = draft.pkg;
        let items: { name: string; files: number; size: number }[] = [];
        let sig = '';
        if (pkg?.id) {
            try { const i = await info(pkg.id); items = itemsOf(i.files); sig = i.signature; }
            catch { items = []; }
        }
        if (!host.isConnected) return;
        host.innerHTML = `
            <p class="spkg-side-lead">${escHtml(t('sched.pkg.sideLead'))}</p>
            ${items.length ? `<ul class="spkg-items">${items.map((i) => `<li><span class="spkg-item-ic">${uiIcon(i.files > 1 ? 'folder' : 'file', 12)}</span>
                <code title="${escAttr(i.name)}">${escHtml(i.name.replace(/^files\//, ''))}</code><span class="spkg-item-size">${escHtml(i.files > 1 ? t('sched.pkg.nFiles', { n: String(i.files) }) : kb(i.size))}</span>
                <button type="button" class="btn btn-xs btn-ghost" data-rm="${escAttr(i.name)}" aria-label="${escAttr(t('common.delete'))}" data-tooltip="${escAttr(t('common.delete'))}">${uiIcon('close', 12)}</button></li>`).join('')}</ul>
                ${sig ? `<p class="spkg-side-sig">${escHtml(sig === 'valid' ? t('sched.pkg.sigValidShort') : sig === 'builtin' ? t('sched.pkg.sigBuiltin') : sig === 'local' ? t('sched.pkg.sigLocal') : t('sched.pkg.sigNone'))}</p>` : ''}`
                : `<p class="spkg-side-empty">${escHtml(t('sched.pkg.none'))}</p>`}
            <div class="spkg-side-actions">
                <button type="button" class="btn btn-xs btn-secondary" data-add="file">${uiIcon('file', 12)}<span>${escHtml(t('sched.pkg.addFile'))}</span></button>
                <button type="button" class="btn btn-xs btn-secondary" data-add="folder">${uiIcon('folder', 12)}<span>${escHtml(t('sched.pkg.addFolder'))}</span></button>
            </div>`;
        host.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) => b.addEventListener('click', async () => {
            const path = b.dataset.add === 'folder' ? await pickFolder() : await pickFile([]);
            if (!path) return;
            await change([{ name: entryNameFor(path), src: path }], []);
        }));
        host.querySelectorAll<HTMLButtonElement>('[data-rm]').forEach((b) => b.addEventListener('click', () => { void change([], [b.dataset.rm || '']); }));
    };
    const change = async (add: { name: string; src: string }[], remove: string[]) => {
        try {
            const i = await invoke('automation_package_attach', { name: draft.name || 'automation', base: draft.pkg?.id || null, add, remove }) as PkgInfo;
            draft.pkg = i.files.length ? { id: i.id, name: draft.name || i.name, signature: 'local' } : undefined;
            onChange();
            void draw();
        } catch (e) {
            say(pkgError(e), 'error', 8000);
        }
    };
    void draw();
}

/** Export a task, with its files, as a package (.bmmbundle). `doc` is the scheduler's own
 *  .bmmpa document for the task (forExport), so the steps travel exactly as a .bmmpa would. */
export async function exportPackage(task: { name: string; pkg?: TaskPkg }, doc: Record<string, any>, stem: string, say: Say): Promise<boolean> {
    const pkg = task.pkg;
    const items = pkg?.id ? itemsOf((await info(pkg.id)).files) : [];
    const dir = pkg?.id ? (await info(pkg.id)).dir : '';
    const out = await saveFile({ defaultPath: `${stem}.bmmbundle`, filters: [{ name: 'BMM automation package', extensions: ['bmmbundle'] }] });
    if (!out) return false;
    const sep = dir.includes('\\') ? '\\' : '/';
    const files = items.map((i) => ({ name: i.name, src: `${dir}${sep}${i.name.split('/').join(sep)}` }));
    const full = {
        ...doc,
        package: { id: stem, name: task.name, items: items.map((i) => ({ name: i.name, files: i.files })) },
    };
    const r = await invoke('automation_package_pack', { out, doc: JSON.stringify(full), files }) as { signed: boolean; files: number; bytes: number };
    say(t(r.signed ? 'sched.pkg.exportedSigned' : 'sched.pkg.exported', { n: String(items.length), size: kb(r.bytes) }), 'success', 8000);
    return true;
}

/** What an imported package brought: its tasks, made safe by the caller, and the package. */
export interface PkgImport { info: PkgInfo; tasks: any[] }

/**
 * Open a package and show what it is BEFORE anything is added: who signed it, what it carries,
 * what its tasks ask for. Resolves null when the person cancels or the package is refused.
 */
export async function reviewPackage(path: string, permLabel: (k: string) => string, say: Say): Promise<PkgImport | null> {
    let pi: PkgInfo;
    try { pi = await invoke('automation_package_open', { path }) as PkgInfo; }
    catch (e) {
        say(pkgError(e), 'error', 10000);
        return null;
    }
    let doc: any = {};
    try { doc = JSON.parse(pi.doc); } catch { doc = {}; }
    const tasks: any[] = Array.isArray(doc.tasks) ? doc.tasks : [];
    const asks = new Set<string>();
    for (const tk of tasks) for (const [k, v] of Object.entries(tk?.perms || {})) if (v === true) asks.add(k);
    const sigCls = pi.signature === 'valid' ? 'is-ok' : 'is-warn';
    const sig = pi.signature === 'valid' ? t('sched.pkg.sigValid', { a: String(pi.authorId || '').slice(0, 12) }) : t('sched.pkg.sigNone');
    const body = `
        <p class="spkg-ask-sig ${sigCls}">${escHtml(sig)}</p>
        <h4 class="spkg-h">${escHtml(t('sched.pkg.revTasks', { n: String(tasks.length) }))}</h4>
        <ul class="spkg-rev">${tasks.map((tk) => `<li><b>${escHtml(String(tk?.name || '?'))}</b>${tk?.description ? `<span>${escHtml(String(tk.description))}</span>` : ''}</li>`).join('')}</ul>
        <h4 class="spkg-h">${escHtml(t('sched.pkg.revFiles', { n: String(pi.files.length) }))}</h4>
        <ul class="spkg-items">${itemsOf(pi.files).map((i) => `<li><span class="spkg-item-ic">${uiIcon(i.files > 1 ? 'folder' : 'file', 12)}</span><code>${escHtml(i.name.replace(/^files\//, ''))}</code><span class="spkg-item-size">${escHtml(i.files > 1 ? t('sched.pkg.nFiles', { n: String(i.files) }) : kb(i.size))}</span></li>`).join('') || `<li>${escHtml(t('sched.pkg.none'))}</li>`}</ul>
        <h4 class="spkg-h">${escHtml(t('sched.pkg.revAsks'))}</h4>
        <p class="spkg-rev-asks">${escHtml(asks.size ? [...asks].map(permLabel).join(', ') : t('sched.pkg.revAsksNone'))}</p>
        <p class="spkg-rev-note">${escHtml(t('sched.pkg.revNote'))}</p>`;
    const ok = await askModal({ title: t('sched.pkg.revTitle', { p: pi.name }), message: '', yes: t('sched.pkg.revImport'), no: t('common.cancel'), detail: body, tone: pi.signature === 'valid' ? 'accent' : 'warn' });
    return ok ? { info: pi, tasks } : null;
}
