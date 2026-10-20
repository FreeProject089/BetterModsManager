// The guided form of the « DCS server join gate » template (sched-dcs-gate.ts builds the task).
//
// It asks only what the gate needs — the server, whether it checks players, the mod list, where
// DCS is — shows the list's fingerprint as soon as a list is picked (the value the server admin
// puts in BMM-JoinGate-Server.lua), and offers a dry run BEFORE anything is created. The two
// permissions the gate uses are unticked boxes: ticking one is the person's grant, in writing,
// on the screen that explains what it is for.

import { invoke, pickFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { openModal } from '../../ui/modal-shell.js';
import { uiIcon } from '../../ui/icons.js';
import { buildJoinGate, gateWords as wordsWith, HOOK_FILE, SERVER_HOOK_FILE, type GateOptions } from './sched-dcs-gate.js';
import { ensurePkgCss, entryNameFor, pkgError, type PkgInfo, type ListReport } from './sched-pkg.js';

export interface GateFormHost {
    /** Put the built task in the editor (like a template): the person reviews it and saves. */
    apply(task: Record<string, any>): Promise<void> | void;
    /** The dry run of a task that is not saved yet. */
    dryRun(task: Record<string, any>, cover: HTMLElement | null): Promise<void> | void;
}

/** Where DCS probably is: the active profile's game folder, if it looks like DCS. A guess shown
 *  in the field, checked on disk, and always the person's to change. */
async function guessDcsExe(): Promise<string> {
    try {
        const profiles = await invoke('get_profiles') as { id: string; game_name?: string; game_path?: string }[];
        const active = await invoke('get_active_profile_id') as string | null;
        const order = [...profiles].sort((a, b) => (a.id === active ? -1 : b.id === active ? 1 : 0));
        for (const p of order) {
            const g = String(p.game_path || '');
            if (!g || !/dcs/i.test(`${p.game_name || ''} ${g}`)) continue;
            const exe = `${g.replace(/[\\/]+$/, '')}\\bin\\DCS.exe`;
            if (await invoke('path_exists', { path: exe }).catch(() => false)) return exe;
        }
    } catch { /* no guess */ }
    return '';
}

async function asset(name: string): Promise<string> {
    const r = await fetch(`assets/automation/dcs-join-gate/${name}`);
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    return await r.text();
}

export async function openJoinGateForm(host: GateFormHost): Promise<void> {
    ensurePkgCss();
    const v = {
        server: '', serverName: '', whitelist: true, listPath: '', exact: true,
        dcsExe: await guessDcsExe(), dcsArgs: '', hookPath: '', grantFiles: false, grantCommand: false,
    };
    const body = document.createElement('div');
    body.className = 'sdg';
    body.innerHTML = `
        <p class="sdg-lede">${escHtml(t('sched.dg.lede'))}</p>
        <div class="sdg-grid">
            <label class="sched-cmd-label" for="sdg-server">${escHtml(t('sched.dg.server'))}</label>
            <input class="input" id="sdg-server" placeholder="203.0.113.10:10308" autocomplete="off">
            <label class="sched-cmd-label" for="sdg-name">${escHtml(t('sched.dg.serverName'))}</label>
            <input class="input" id="sdg-name" placeholder="${escAttr(t('sched.dg.serverNamePh'))}" autocomplete="off">
            <label class="sched-cmd-label" for="sdg-list">${escHtml(t('sched.dg.list'))}</label>
            <div class="spkg-row"><input class="input" id="sdg-list" placeholder="C:/…/server.mm"><button type="button" class="btn btn-sm btn-secondary" data-pick="list">${escHtml(t('sched.pkg.browse'))}</button></div>
            <div class="sdg-fp" aria-live="polite"></div>
            <label class="sched-opt"><input type="checkbox" id="sdg-exact" checked><div><b>${escHtml(t('sched.lv.exact'))}</b><span>${escHtml(t('sched.lv.exactHint'))}</span></div></label>
            <label class="sched-opt"><input type="checkbox" id="sdg-wl" checked><div><b>${escHtml(t('sched.dg.whitelist'))}</b><span>${escHtml(t('sched.dg.whitelistHint'))}</span></div></label>
            <div class="sdg-hook">
                <p class="sched-cmd-hint">${escHtml(t('sched.dg.hookHint'))}</p>
                <div class="spkg-row">
                    <button type="button" class="btn btn-xs btn-ghost" data-show="client">${uiIcon('code', 12)}<span>${escHtml(t('sched.dg.showHook'))}</span></button>
                    <button type="button" class="btn btn-xs btn-ghost" data-show="server">${uiIcon('server', 12)}<span>${escHtml(t('sched.dg.showServerHook'))}</span></button>
                    <button type="button" class="btn btn-xs btn-ghost" data-pick="hook">${uiIcon('file', 12)}<span>${escHtml(t('sched.dg.ownHook'))}</span></button>
                </div>
                <div class="sdg-hook-own sched-cmd-hint"></div>
                <pre class="spkg-file-pre" hidden></pre>
            </div>
            <label class="sched-cmd-label" for="sdg-exe">${escHtml(t('sched.gl.exe'))}</label>
            <div class="spkg-row"><input class="input" id="sdg-exe" placeholder="C:/…/DCS World/bin/DCS.exe"><button type="button" class="btn btn-sm btn-secondary" data-pick="exe">${escHtml(t('sched.pkg.browse'))}</button></div>
            <label class="sched-cmd-label" for="sdg-args">${escHtml(t('sched.gl.args'))}</label>
            <input class="input" id="sdg-args" placeholder="--force_enable_VR">
            <p class="sched-cmd-hint">${escHtml(t('sched.dg.noJoinArg'))}</p>
            <div class="sdg-perms">
                <b>${escHtml(t('sched.dg.permsTitle'))}</b>
                <label class="sched-opt"><input type="checkbox" id="sdg-pf"><div><b>${escHtml(t('sched.allowFilesTitle'))}</b><span>${escHtml(t('sched.dg.permFiles'))}</span></div></label>
                <label class="sched-opt"><input type="checkbox" id="sdg-pc"><div><b>${escHtml(t('sched.allowCmdTitle'))}</b><span>${escHtml(t('sched.dg.permCmd'))}</span></div></label>
            </div>
            <div class="sdg-err" role="alert" hidden></div>
        </div>`;
    const footer = document.createElement('div');
    footer.className = 'spkg-ask-foot';
    footer.innerHTML = `<button type="button" class="btn btn-secondary" data-dry>${uiIcon('search', 14)}<span>${escHtml(t('sched.dr.run'))}</span></button>
        <button type="button" class="btn btn-primary" data-make>${uiIcon('check', 14)}<span>${escHtml(t('sched.dg.create'))}</span></button>`;
    const m = openModal({ title: t('sched.dg.title'), subtitle: t('sched.dg.subtitle'), icon: uiIcon('game', 18), size: 'lg', tall: true, className: 'sdg-modal', body, footer, initialFocus: '#sdg-server' });
    const $ = <T extends HTMLElement = HTMLInputElement>(sel: string) => body.querySelector(sel) as T;
    $('#sdg-exe').value = v.dcsExe;
    const read = () => {
        v.server = $('#sdg-server').value.trim();
        v.serverName = $('#sdg-name').value.trim();
        v.listPath = $('#sdg-list').value.trim();
        v.exact = $('#sdg-exact').checked;
        v.whitelist = $('#sdg-wl').checked;
        v.dcsExe = $('#sdg-exe').value.trim();
        v.dcsArgs = $('#sdg-args').value.trim();
        v.grantFiles = $('#sdg-pf').checked;
        v.grantCommand = $('#sdg-pc').checked;
        $<HTMLElement>('.sdg-hook').hidden = !v.whitelist;
    };
    const fp = async () => {
        const out = $<HTMLElement>('.sdg-fp');
        if (!v.listPath) { out.textContent = ''; return; }
        try {
            const r = await invoke('modlist_verify', { path: v.listPath, passphrase: null, exact: false, hashes: false }) as ListReport;
            out.innerHTML = `${escHtml(t('sched.lv.fp'))} <code>${escHtml(r.fingerprint)}</code> · ${escHtml(t('sched.lv.nMods', { n: String(r.total) }))}`;
        } catch (e) { out.textContent = pkgError(e); }
    };
    body.addEventListener('input', read);
    body.addEventListener('change', read);
    $('#sdg-list').addEventListener('change', () => { void fp(); });
    body.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
        const kind = b.dataset.pick;
        const path = await pickFile(kind === 'exe' ? [{ name: 'DCS', extensions: ['exe'] }] : kind === 'list' ? [{ name: 'Mod list', extensions: ['mm', 'mmlist', 'json'] }] : [{ name: 'Lua', extensions: ['lua'] }]);
        if (!path) return;
        if (kind === 'exe') $('#sdg-exe').value = path;
        else if (kind === 'list') { $('#sdg-list').value = path; read(); void fp(); }
        else { v.hookPath = path; $<HTMLElement>('.sdg-hook-own').textContent = t('sched.dg.ownHookSet', { f: path }); }
        read();
    }));
    body.querySelectorAll<HTMLButtonElement>('[data-show]').forEach((b) => b.addEventListener('click', async () => {
        const pre = $<HTMLElement>('.spkg-file-pre');
        try { pre.textContent = await asset(b.dataset.show === 'server' ? 'BMM-JoinGate-Server.lua' : 'BMM-JoinGate.lua'); }
        catch (e) { pre.textContent = String(e); }
        pre.hidden = false;
    }));
    const problem = (): string => {
        if (!v.server) return t('sched.dg.needServer');
        if (!v.listPath) return t('sched.dg.needList');
        if (!v.dcsExe) return t('sched.dg.needExe');
        return '';
    };
    const say = (msg: string) => { const e = $<HTMLElement>('.sdg-err'); e.textContent = msg; e.hidden = !msg; };
    /** The task without its package, for the dry run: nothing is stored before « Create ». */
    const draft = (): GateOptions => ({
        server: v.server, serverName: v.serverName, whitelist: v.whitelist,
        listPath: v.listPath, exact: v.exact, dcsExe: v.dcsExe, dcsArgs: v.dcsArgs,
        grantFiles: v.grantFiles, grantCommand: v.grantCommand,
    });
    footer.querySelector('[data-dry]')?.addEventListener('click', async () => {
        read();
        const p = problem();
        say(p);
        if (p) return;
        await host.dryRun(buildJoinGate(draft(), wordsWith(t)), m.overlay);
    });
    footer.querySelector('[data-make]')?.addEventListener('click', async () => {
        read();
        const p = problem();
        say(p);
        if (p) return;
        const btn = footer.querySelector('[data-make]') as HTMLButtonElement;
        btn.disabled = true;
        try {
            // The package: the hook (BMM's, or the one the server gave), the server-side script
            // for an admin who exports the gate, and the list itself, so the gate travels whole.
            const listName = entryNameFor(v.listPath);
            const add = [
                v.hookPath ? { name: HOOK_FILE, src: v.hookPath } : { name: HOOK_FILE, text: await asset('BMM-JoinGate.lua') },
                { name: SERVER_HOOK_FILE, text: await asset('BMM-JoinGate-Server.lua') },
                { name: listName, src: v.listPath },
            ];
            const words = wordsWith(t);
            const pi = await invoke('automation_package_attach', { name: (v.serverName || v.server), base: null, add, remove: [] }) as PkgInfo;
            const task = buildJoinGate({ ...draft(), listFile: listName, listPath: '' }, words, { id: pi.id, name: words.name.split('{name}').join(v.serverName || v.server), signature: pi.signature });
            m.close();
            await host.apply(task);
        } catch (e) {
            say(pkgError(e));
            btn.disabled = false;
        }
    });
    read();
}
