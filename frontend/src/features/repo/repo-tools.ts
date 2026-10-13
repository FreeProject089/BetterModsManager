// Server Repo — the repo tools in « Advanced tools » that did not exist before:
//
//   quick     a repo in one click, from a profile (export), a modpack (an empty manifest, then
//             the update path with only the pack's mods, then the pack itself) or a folder of
//             mods (manifest-only, in place);
//   validate  one readable report: manifest, format version, signature, files and hashes;
//   version   set the number subscribers see, re-signed;
//   preview   the card a subscriber gets after Fetch, from the folder or the running server;
//   share     a bmm://repo/connect link and a message, with the password and key notes;
//   static    the instructions and configuration for GitHub Pages / Nginx / any static host.
//
// Nothing here decides anything a Rust command already decides. Every check is the existing
// command's answer: repo_format_inspect (format), read_local_repo (the manifest as BMM reads
// it), verify_repo_signature (the badge subscribers see), repo_format_convert as a DRY RUN with
// re-hash (files and hashes — it writes nothing), export_server_repo / update_server_repo /
// generate_repo_manifest / repo_modpacks_apply (creation), repo_format_convert with
// `setVersion` (the version, backed up and re-signed like a conversion), write_text_file (the
// hosting files: .md, .yml, .conf are on its allow-list).
import { invoke, pickFolder, askConfirm } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr, formatBytes } from '../../core/utils.js';
import { uiIcon, type IconName } from '../../ui/icons.js';
import { openConvertDialog } from './repo-format.js';
import { revealRepoTool } from './repo-advanced.js';

// window.toast rather than ui/app.js: ui/app.ts imports repo.ts, which imports this module, so
// a static import here would close one more import cycle (the same choice as repo-format.ts).
const toast = (msg: string, type = 'info', duration?: number): void => {
    try { (window as any).toast?.(msg, type, duration); } catch { /* the shell is not up */ }
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const val = (id: string): string => ($<HTMLInputElement>(id)?.value || '').trim();

/** An error from Rust is an i18n key, sometimes with `:detail` or `|detail` after it. */
function errText(e: unknown): string {
    const raw = String(e ?? '');
    const m = /^([\w.]+)[:|](.*)$/s.exec(raw);
    const key = m ? m[1] : raw;
    const said = t(key);
    if (said && said !== key) return m ? `${said} (${m[2].trim()})` : said;
    return raw;
}

const sepOf = (p: string) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');
const join = (dir: string, ...parts: string[]) => {
    const s = sepOf(dir);
    return [dir.replace(/[\\/]+$/, ''), ...parts].join(s);
};
const dirname = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
const basename = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

const hostDir = () => val('repo-host-path');
/** The folder the check/version/preview/share/static tools work on. */
function toolsDir(): string {
    const inp = $<HTMLInputElement>('repo-tools-dir');
    if (inp?.dataset.manual === '1' && inp.value.trim()) return inp.value.trim();
    return hostDir();
}
function needDir(): string | null {
    const d = toolsDir();
    if (!d) { toast(t('repo.adv.needDir'), 'warning'); $('btn-repo-tools-dir')?.focus(); return null; }
    return d;
}
const serverRunning = () => !!$('repo-run-panel')?.classList.contains('is-on');

function busy(barId: string, btn: HTMLButtonElement | null, on: boolean): void {
    const bar = $(barId);
    if (bar) bar.hidden = !on;
    if (btn) btn.disabled = on;
}

function showResult(id: string, html: string, tone: 'ok' | 'warn' | 'bad' | 'info' = 'ok'): void {
    const el = $(id);
    if (!el) return;
    el.className = `rp-result rp-tone--${tone}`;
    el.innerHTML = html;
    el.hidden = false;
}

// ── Shared folder field ─────────────────────────────────────────────────────────────────────

function paintToolsDir(): void {
    const inp = $<HTMLInputElement>('repo-tools-dir');
    if (!inp || inp.dataset.manual === '1') return;
    inp.value = hostDir();
}

// ── Quick create ────────────────────────────────────────────────────────────────────────────

let packsCache: any[] = [];

async function fillQuickSources(): Promise<void> {
    const kind = ($<HTMLSelectElement>('repo-quick-kind')?.value || 'profile');
    const sel = $<HTMLSelectElement>('repo-quick-src');
    const srcField = $('repo-quick-src-field');
    const folderField = $('repo-quick-folder-field');
    const outHint = $('repo-quick-out-field');
    if (srcField) srcField.hidden = kind === 'folder';
    if (folderField) folderField.hidden = kind !== 'folder';
    if (outHint) outHint.hidden = kind === 'folder';
    if (!sel || kind === 'folder') return;
    sel.innerHTML = '';
    try {
        if (kind === 'profile') {
            const profiles = (await invoke('get_profiles').catch(() => [])) as any[];
            for (const p of profiles || []) {
                const o = document.createElement('option');
                o.value = String(p.id);
                o.textContent = p.game_name ? `${p.name} (${t(p.game_name) || p.game_name})` : String(p.name);
                sel.appendChild(o);
            }
        } else {
            packsCache = ((await invoke('load_modpacks').catch(() => [])) as any[]) || [];
            for (const p of packsCache) {
                const o = document.createElement('option');
                o.value = String(p.id);
                o.textContent = `${p.name} (${t('repo.quick.modsN', { n: String(p.mods?.length || 0) })})`;
                sel.appendChild(o);
            }
        }
    } catch { /* an empty list says it */ }
    if (!sel.options.length) {
        const o = document.createElement('option');
        o.value = '';
        o.textContent = t(kind === 'profile' ? 'repo.quick.noProfiles' : 'repo.quick.noModpacks');
        sel.appendChild(o);
    }
}

/** True when the folder already holds a repo.json BMM can read. */
async function hasManifest(dir: string): Promise<boolean> {
    try { await invoke('repo_format_inspect', { path: dir }); return true; } catch { return false; }
}

async function useAsHostFolder(dir: string): Promise<void> {
    const input = $<HTMLInputElement>('repo-host-path');
    if (!input) return;
    input.value = dir;
    // `.value =` fires nothing: the four steps and the format badge listen for input.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const req = $<HTMLInputElement>('repo-host-require-login');
    if (req) invoke('get_repo_require_login', { repoDir: dir }).then((v) => { req.checked = !!v; }).catch(() => {});
    paintToolsDir();
}

async function quickCreate(): Promise<void> {
    const btn = $<HTMLButtonElement>('btn-repo-quick-go');
    const kind = $<HTMLSelectElement>('repo-quick-kind')?.value || 'profile';
    const src = $<HTMLSelectElement>('repo-quick-src')?.value || '';
    const author = val('repo-quick-author').slice(0, 25);
    const out = val('repo-quick-out');
    const folder = val('repo-quick-folder');

    if (kind === 'folder' && !folder) { toast(t('repo.quick.needFolder'), 'warning'); return; }
    if (kind !== 'folder') {
        if (!src) { toast(t(kind === 'profile' ? 'repo.quick.noProfiles' : 'repo.quick.noModpacks'), 'warning'); return; }
        if (!out) { toast(t('repo.errNoOutDir'), 'warning'); $('btn-repo-quick-out')?.focus(); return; }
        if (!author) { toast(t('repo.errNoAuthor'), 'warning'); $('repo-quick-author')?.focus(); return; }
    }
    if (author) { try { localStorage.setItem('bmm_last_author', author); } catch { /* private mode */ } }

    const status = $('repo-quick-result');
    let unlisten: (() => void) | null = null;
    busy('repo-quick-progress', btn, true);
    if (status) status.hidden = true;
    try {
        try { await invoke('set_repo_busy', { kind: 'gen', busy: true }); } catch { /* the guard is advisory */ }
        const ev = (window as any).__TAURI__?.event;
        if (ev?.listen) {
            unlisten = await ev.listen('bmm://repo-export-progress', (e: { payload: any }) => {
                const step = e.payload?.step;
                if (!step || !status) return;
                let txt = '';
                try {
                    const j = JSON.parse(step);
                    txt = t(j.key, { mod: String(j.mod ?? ''), current: String(j.current ?? ''), total: String(j.total ?? '') });
                } catch { txt = t(step) || step; }
                status.className = 'rp-result rp-tone--info';
                status.textContent = txt;
                status.hidden = false;
            });
        }

        let repoDir = '';
        let summary = '';
        if (kind === 'profile') {
            if (await hasManifest(out) && !(await askConfirm(t('repo.quick.overwrite', { dir: out }), { title: t('repo.tool.quick.t'), type: 'warning' }))) return;
            await invoke('export_server_repo', {
                profileIds: [src], outputDir: out, authorName: author, creds: null, seed: null,
                modpacksShareConfig: null, zipOutput: false, zipMods: false, compression: null, serverOptions: null,
            });
            repoDir = out;
            summary = t('repo.quick.doneProfile', { dir: out });
        } else if (kind === 'modpack') {
            const pack = packsCache.find((p) => String(p.id) === src);
            if (!pack) { toast(t('repo.quick.noModpacks'), 'warning'); return; }
            if (await hasManifest(out)) { toast(t('repo.quick.alreadyRepo'), 'warning', 8000); return; }
            // An empty manifest first: the update path adds exactly the pack's mods to it.
            const empty = { name: String(pack.name || basename(out)), description: pack.description || null, game_name: pack.game_name || '', profiles: [] };
            await invoke('write_text_file', { path: join(out, 'repo.json'), content: JSON.stringify(empty, null, 2) });
            // Mods carry the profile they live in; an old pack may not, and then every profile
            // is asked (update_server_repo only takes a mod from the profile that holds it).
            const byProfile = new Map<string, string[]>();
            const orphans: string[] = [];
            for (const m of pack.mods || []) {
                if (m.profile_id) byProfile.set(m.profile_id, [...(byProfile.get(m.profile_id) || []), m.mod_id]);
                else orphans.push(m.mod_id);
            }
            if (orphans.length) {
                const profiles = (await invoke('get_profiles').catch(() => [])) as any[];
                for (const p of profiles || []) byProfile.set(String(p.id), [...(byProfile.get(String(p.id)) || []), ...orphans]);
            }
            const addProfiles = [...byProfile].map(([profile_id, mod_ids]) => ({ profile_id, mod_ids }));
            const res = await invoke('update_server_repo', { repoDir: out, authorName: author, ops: { add_profiles: addProfiles } }) as any;
            await invoke('repo_modpacks_apply', { repoDir: out, shares: [{ modpack: pack, share_mode: 'public', custom_whitelist: null }], replace: false });
            repoDir = out;
            summary = t('repo.quick.doneModpack', { n: String(res?.mods_added ?? 0), dir: out });
        } else {
            const report = await invoke('generate_repo_manifest', {
                args: {
                    sources: [{ dir: folder, onlyDirs: null, label: null }],
                    profileIds: null, outputPath: null, author: author || null,
                    filesBaseUrl: null, filesLayout: null, modpackIds: [], reuseExisting: true,
                },
            }) as any;
            repoDir = dirname(String(report?.output_path || join(folder, 'repo.json')));
            summary = t('repo.quick.doneFolder', { n: String(report?.mods ?? 0), dir: repoDir });
        }

        if ($<HTMLInputElement>('repo-quick-host')?.checked) await useAsHostFolder(repoDir);
        showResult('repo-quick-result', `${uiIcon('success', 14)} <span>${escHtml(summary)}</span>
            <div class="rp-tool-actions"><button type="button" class="btn btn-sm btn-secondary" data-rp-tool-open="validate">${escHtml(t('repo.quick.thenValidate'))}</button></div>`);
        toast(t('repo.exportSuccess'), 'success');
    } catch (e) {
        const msg = errText(e);
        showResult('repo-quick-result', `${uiIcon('error', 14)} <span>${escHtml(msg)}</span>`, 'bad');
        if (!/cancel/i.test(String(e))) toast(msg, 'error');
    } finally {
        unlisten?.();
        try { await invoke('set_repo_busy', { kind: 'gen', busy: false }); } catch { /* advisory */ }
        busy('repo-quick-progress', btn, false);
    }
}

// ── Validate ────────────────────────────────────────────────────────────────────────────────

type Tone = 'ok' | 'warn' | 'bad' | 'info';
interface Row { tone: Tone; title: string; detail?: string; act?: { id: string; label: string } }

const TONE_ICON: Record<Tone, IconName> = { ok: 'success', warn: 'warning', bad: 'error', info: 'info' };

function rowsHtml(rows: Row[]): string {
    return `<ul class="rp-checklist">${rows.map((r) => `<li class="rp-ck rp-tone--${r.tone}">
        <span class="rp-ck-ic">${uiIcon(TONE_ICON[r.tone], 14)}</span>
        <span class="rp-ck-txt"><b>${escHtml(r.title)}</b>${r.detail ? `<span>${escHtml(r.detail)}</span>` : ''}</span>
        ${r.act ? `<button type="button" class="btn btn-sm btn-secondary" data-ck-act="${escAttr(r.act.id)}">${escHtml(r.act.label)}</button>` : ''}
    </li>`).join('')}</ul>`;
}

/** Totals of a manifest as BMM reads it. */
function totals(repo: any): { profiles: number; mods: number; files: number; bytes: number } {
    let mods = 0, files = 0, bytes = 0;
    for (const p of repo?.profiles || []) {
        mods += p.mods?.length || 0;
        for (const m of p.mods || []) for (const f of m.files || []) { files++; bytes += Number(f.size) || 0; }
    }
    return { profiles: repo?.profiles?.length || 0, mods, files, bytes };
}

async function validate(): Promise<void> {
    const dir = needDir();
    if (!dir) return;
    const btn = $<HTMLButtonElement>('btn-repo-validate');
    const out = $('repo-validate-report');
    busy('repo-validate-progress', btn, true);
    if (out) out.hidden = true;
    const rows: Row[] = [];
    try {
        // 1. A manifest at all, and its format.
        let fmt: any;
        try { fmt = await invoke('repo_format_inspect', { path: dir }); }
        catch (e) {
            rows.push({ tone: 'bad', title: t('repo.validate.noManifest'), detail: errText(e) });
            return;
        }
        const st: string = fmt?.info?.status || 'invalid';
        const v = String(fmt?.info?.version ?? '');
        if (st === 'current') rows.push({ tone: 'ok', title: t('repo.validate.formatOk', { v }) });
        else if (st === 'legacy' || st === 'needs_conversion') rows.push({ tone: 'warn', title: t('repo.validate.formatOld', { v, cur: String(fmt?.current ?? '') }), detail: t('repo.validate.formatOldHint'), act: { id: 'convert', label: t('repo.validate.convert') } });
        else if (st === 'newer_minor') rows.push({ tone: 'info', title: t('repo.validate.formatNewer', { v }) });
        else if (st === 'too_new') rows.push({ tone: 'bad', title: t('repo.validate.formatTooNew', { v }) });
        else rows.push({ tone: 'bad', title: t('repo.validate.formatInvalid') });

        // 2. The manifest as BMM reads it.
        let repo: any = null;
        try { repo = await invoke('read_local_repo', { repoDir: dir }); }
        catch (e) { rows.push({ tone: 'bad', title: t('repo.validate.unreadable'), detail: errText(e) }); }
        if (repo) {
            const n = totals(repo);
            rows.unshift({
                tone: 'info',
                title: `${repo.name || basename(dir)} · v${repo.version || '?'}`,
                detail: t('repo.validate.summary', { profiles: String(n.profiles), mods: String(n.mods), files: String(n.files), size: formatBytes(n.bytes) }),
            });
            if (!n.profiles) rows.push({ tone: 'warn', title: t('repo.validate.noProfiles') });
            const empty = (repo.profiles || []).filter((p: any) => !(p.mods?.length)).map((p: any) => p.name);
            if (empty.length) rows.push({ tone: 'warn', title: t('repo.validate.emptyProfiles', { n: String(empty.length) }), detail: empty.join(', ') });
            if (!repo.author) rows.push({ tone: 'warn', title: t('repo.validate.noAuthor') });

            // 3. The signature subscribers will see.
            if (!repo.signature || !repo.author_id) {
                rows.push({ tone: 'warn', title: t('repo.validate.unsigned'), detail: t('repo.validate.unsignedHint'), act: { id: 'convert', label: t('repo.validate.repair') } });
            } else {
                const ok = await invoke('verify_repo_signature', { repo }).catch(() => false);
                rows.push(ok
                    ? { tone: 'ok', title: t('repo.validate.signed'), detail: String(repo.author_id).slice(0, 16) + '…' }
                    : { tone: 'bad', title: t('repo.validate.badSignature'), detail: t('repo.validate.badSignatureHint'), act: { id: 'convert', label: t('repo.validate.repair') } });
            }
        }

        // 4. Files and hashes: the conversion's dry run re-hashes every listed file and writes nothing.
        if (repo?.files_base_url) {
            rows.push({ tone: 'info', title: t('repo.validate.filesElsewhere'), detail: String(repo.files_base_url) });
        } else if (st !== 'too_new' && st !== 'newer_minor' && st !== 'invalid') {
            try {
                const plan = await invoke('repo_format_convert', { args: { path: dir, dryRun: true, rehash: true, sign: false } }) as any;
                const c = plan?.counts || {};
                const problems = (c.filesMissing || 0) + (c.hashesChanged || 0);
                if (c.filesMissing) rows.push({ tone: 'bad', title: t('repo.validate.missing', { n: String(c.filesMissing) }), detail: t('repo.validate.missingHint') });
                if (c.hashesChanged) rows.push({ tone: 'bad', title: t('repo.validate.changed', { n: String(c.hashesChanged) }), detail: t('repo.validate.changedHint'), act: { id: 'convert', label: t('repo.validate.repair') } });
                if (c.hashesFilled) rows.push({ tone: 'warn', title: t('repo.validate.filled', { n: String(c.hashesFilled) }), act: { id: 'convert', label: t('repo.validate.repair') } });
                if (!problems && !c.hashesFilled) rows.push({ tone: 'ok', title: t('repo.validate.filesOk') });
            } catch (e) {
                rows.push({ tone: 'warn', title: t('repo.validate.filesUnchecked'), detail: errText(e) });
            }
        }
    } finally {
        busy('repo-validate-progress', btn, false);
        if (out && rows.length) {
            const bad = rows.filter((r) => r.tone === 'bad').length;
            const warn = rows.filter((r) => r.tone === 'warn').length;
            const verdict: Row = bad
                ? { tone: 'bad', title: t('repo.validate.verdictBad', { n: String(bad) }) }
                : warn ? { tone: 'warn', title: t('repo.validate.verdictWarn', { n: String(warn) }) }
                    : { tone: 'ok', title: t('repo.validate.verdictOk') };
            out.innerHTML = rowsHtml([verdict, ...rows]);
            out.hidden = false;
            out.dataset.dir = dir;
        }
    }
}

// ── Version ─────────────────────────────────────────────────────────────────────────────────

let currentVersion = '';

async function readVersion(): Promise<void> {
    const out = $('repo-version-current');
    const dir = toolsDir();
    currentVersion = '';
    if (out) out.textContent = '-';
    if (!dir) return;
    try {
        const repo = await invoke('read_local_repo', { repoDir: dir }) as any;
        currentVersion = String(repo?.version || '');
        if (out) out.textContent = currentVersion || '-';
    } catch { /* no manifest: the dash says it */ }
}

function bump(kind: string): void {
    const base = (val('repo-version-new') || currentVersion || '1.0.0').replace(/^v/i, '');
    const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(base);
    if (!m) { toast(t('repo.version.notNumeric'), 'warning'); return; }
    let [maj, min, pat] = [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
    if (kind === 'major') { maj++; min = 0; pat = 0; } else if (kind === 'minor') { min++; pat = 0; } else pat++;
    const inp = $<HTMLInputElement>('repo-version-new');
    if (inp) { inp.value = `${maj}.${min}.${pat}`; inp.focus(); }
}

async function applyVersion(): Promise<void> {
    const dir = needDir();
    if (!dir) return;
    const v = val('repo-version-new').replace(/^v(?=\d)/i, '');
    if (!/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/.test(v)) { toast(t('repo.version.invalid'), 'warning'); $('repo-version-new')?.focus(); return; }
    const btn = $<HTMLButtonElement>('btn-repo-version-apply');
    if (btn) btn.disabled = true;
    try {
        const plan = await invoke('repo_format_convert', { args: { path: dir, dryRun: true, rehash: false, sign: true, setVersion: v } }) as any;
        if (plan?.upToDate) { toast(t('repo.version.same', { v }), 'info'); return; }
        const notes = [t('repo.version.confirm', { from: currentVersion || '?', to: v })];
        const st = plan?.from?.status;
        if (st === 'legacy' || st === 'needs_conversion') notes.push(t('repo.version.alsoConverts', { v: String(plan?.to ?? '') }));
        if (plan?.signerChanges) notes.push(t('repo.version.signerChanges'));
        if (!(await askConfirm(notes.join('\n\n'), { title: t('repo.tool.version.t'), type: plan?.signerChanges ? 'warning' : 'info' }))) return;
        const done = await invoke('repo_format_convert', { args: { path: dir, dryRun: false, rehash: false, sign: true, setVersion: v } }) as any;
        showResult('repo-version-result', `${uiIcon('success', 14)} <span>${escHtml(t('repo.version.done', { v, backup: basename(String(done?.backupPath || '')) }))}</span>`);
        toast(t('repo.version.done', { v, backup: basename(String(done?.backupPath || '')) }), 'success', 6000);
        await readVersion();
    } catch (e) {
        showResult('repo-version-result', `${uiIcon('error', 14)} <span>${escHtml(errText(e))}</span>`, 'bad');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ── Preview ─────────────────────────────────────────────────────────────────────────────────

async function preview(): Promise<void> {
    const out = $('repo-preview-out');
    const src = $<HTMLSelectElement>('repo-preview-src')?.value || 'folder';
    const btn = $<HTMLButtonElement>('btn-repo-preview');
    if (!out) return;
    let repo: any;
    if (btn) btn.disabled = true;
    try {
        if (src === 'server') {
            const url = val('repo-server-url');
            if (!serverRunning() || !url) { toast(t('repo.preview.needServer'), 'warning'); return; }
            const creatorId = await invoke('get_creator_id').catch(() => null);
            repo = await invoke('fetch_repo_info', { url, creatorId, password: val('repo-server-download-password') || null });
        } else {
            const dir = needDir();
            if (!dir) return;
            repo = await invoke('read_local_repo', { repoDir: dir });
        }
    } catch (e) {
        out.innerHTML = `<p class="rp-hint-t">${escHtml(errText(e))}</p>`;
        out.hidden = false;
        return;
    } finally {
        if (btn) btn.disabled = false;
    }
    const signed = !!(repo?.signature && repo?.author_id);
    const valid = signed ? await invoke('verify_repo_signature', { repo }).catch(() => false) : false;
    const sig = !signed
        ? `<span class="rp-chip rp-tone--warn">${uiIcon('warning', 12)}<span>${escHtml(t('repo.validate.unsigned'))}</span></span>`
        : valid
            ? `<span class="rp-chip rp-tone--ok">${uiIcon('shield-check', 12)}<span>${escHtml(t('repo.validate.signed'))}</span></span>`
            : `<span class="rp-chip rp-tone--bad">${uiIcon('error', 12)}<span>${escHtml(t('repo.validate.badSignature'))}</span></span>`;
    const n = totals(repo);
    const game = repo?.game_name ? (t(repo.game_name) || repo.game_name) : '';
    const profiles = (repo?.profiles || []).map((p: any) => {
        let bytes = 0;
        for (const m of p.mods || []) for (const f of m.files || []) bytes += Number(f.size) || 0;
        return `<div class="rp-pick"><div class="rp-pick-title"><span class="rp-pick-name">${uiIcon('profile', 14)}<span>${escHtml(p.name)}</span></span>
            <span class="rp-pick-meta">${escHtml(t('repo.quick.modsN', { n: String(p.mods?.length || 0) }))} · ${escHtml(formatBytes(bytes))}</span></div></div>`;
    }).join('');
    const packs = repo?.modpacks?.length ? `<div class="rp-hint-t">${escHtml(t('repo.preview.modpacks', { n: String(repo.modpacks.length) }))}</div>` : '';
    const extras = repo?.extras?.length ? `<div class="rp-hint-t">${escHtml(t('repo.preview.extras', { n: String(repo.extras.length) }))}</div>` : '';
    out.innerHTML = `<div class="rp-joined rp-preview-card">
        <div class="rp-joined-top">${sig}<span class="rp-joined-game">${escHtml([game, repo?.version ? `v${repo.version}` : ''].filter(Boolean).join(' · '))}</span></div>
        <div class="rp-joined-name">${escHtml(repo?.name || '')}</div>
        <div class="rp-joined-author">${escHtml(t('repo.authorShort'))} ${escHtml(repo?.author || '?')}</div>
        <div class="rp-joined-desc">${escHtml(repo?.description || '')}</div>
        <div class="rp-joined-picks">${profiles || `<span class="rp-hint-t">${escHtml(t('repo.validate.noProfiles'))}</span>`}</div>
        ${packs}${extras}
        <div class="rp-joined-total">${escHtml(t('repo.preview.total', { files: String(n.files), size: formatBytes(n.bytes) }))}</div>
    </div>`;
    out.hidden = false;
}

// ── Share ───────────────────────────────────────────────────────────────────────────────────

let shareName = '';

function shareAddresses(): Array<{ value: string; label: string }> {
    const list: Array<{ value: string; label: string }> = [];
    if (serverRunning()) {
        const add = (id: string, key: string) => { const v = val(id); if (v) list.push({ value: v, label: `${t(key)} · ${v}` }); };
        add('repo-server-tunnel-url', 'repo.share.addrTunnel');
        add('repo-server-public-url', 'repo.share.addrPublic');
        add('repo-server-url', 'repo.share.addrLan');
    }
    list.push({ value: '', label: t('repo.share.addrOther') });
    return list;
}

async function refreshShare(rebuildList = false): Promise<void> {
    const sel = $<HTMLSelectElement>('repo-share-addr');
    if (!sel) return;
    if (rebuildList || !sel.options.length) {
        const keep = sel.value;
        sel.innerHTML = shareAddresses().map((a) => `<option value="${escAttr(a.value)}">${escHtml(a.label)}</option>`).join('');
        if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
        const dir = toolsDir();
        shareName = dir ? basename(dir) : '';
        if (dir) {
            try { const r = await invoke('read_local_repo', { repoDir: dir }) as any; if (r?.name) shareName = String(r.name); } catch { /* the folder name will do */ }
        }
    }
    const custom = $<HTMLInputElement>('repo-share-custom');
    const isCustom = !sel.value;
    if (custom) custom.hidden = !isCustom;
    const url = isCustom ? (custom?.value.trim() || '') : sel.value;
    const pw = val('repo-server-download-password');
    const passRow = $('repo-share-pass-row');
    if (passRow) passRow.hidden = isCustom || !pw;
    const withPw = !isCustom && !!pw && !!$<HTMLInputElement>('repo-share-pass')?.checked;

    const notes: string[] = [];
    if (!serverRunning()) notes.push(t('repo.share.noteNotRunning'));
    if (!isCustom && pw && !withPw) notes.push(t('repo.share.notePassword'));
    if (withPw) notes.push(t('repo.share.notePasswordIn'));
    if (!isCustom && val('repo-server-authorized-keys')) notes.push(t('repo.share.noteKeys'));
    if (!isCustom && $<HTMLInputElement>('repo-host-require-login')?.checked) notes.push(t('repo.share.noteLogin'));
    if (/^(https?:\/\/)?(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url)) notes.push(t('repo.share.noteLan'));
    const ul = $('repo-share-notes');
    if (ul) ul.innerHTML = notes.map((n) => `<li>${uiIcon('info', 12)}<span>${escHtml(n)}</span></li>`).join('');

    const text = $<HTMLTextAreaElement>('repo-share-text');
    if (!url) { if (text) text.value = ''; return; }
    const link = `bmm://repo/connect?url=${encodeURIComponent(url)}${shareName ? `&name=${encodeURIComponent(shareName)}` : ''}${withPw ? `&password=${encodeURIComponent(pw)}` : ''}`;
    if (text) {
        text.value = t('repo.share.message', { name: shareName || basename(url), link, url });
        text.dataset.link = link;
    }
}

async function copy(textValue: string): Promise<void> {
    if (!textValue) { toast(t('repo.share.needAddr'), 'warning'); return; }
    try { await navigator.clipboard.writeText(textValue); toast(t('common.copied'), 'success'); }
    catch { toast(t('repo.share.copyFailed'), 'error'); }
}

// ── Static host ─────────────────────────────────────────────────────────────────────────────

function pagesWorkflow(): string {
    // Deploy the folder as it is: the Pages artifact path skips Jekyll, so files whose names
    // start with « _ » or « . » inside mods/ are served too (Jekyll would drop them).
    return [
        '# Publishes this BMM repo folder on GitHub Pages, as is (no Jekyll).',
        '# Settings > Pages > Source: GitHub Actions.',
        'name: Publish BMM repo',
        'on:',
        '  push:',
        '    branches: [main]',
        '  workflow_dispatch:',
        'permissions:',
        '  contents: read',
        '  pages: write',
        '  id-token: write',
        'concurrency:',
        '  group: pages',
        '  cancel-in-progress: true',
        'jobs:',
        '  deploy:',
        '    runs-on: ubuntu-latest',
        '    environment:',
        '      name: github-pages',
        '      url: ${{ steps.deployment.outputs.page_url }}',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - uses: actions/configure-pages@v5',
        '      - uses: actions/upload-pages-artifact@v3',
        '        with:',
        '          path: .',
        '      - id: deployment',
        '        uses: actions/deploy-pages@v4',
        '',
    ].join('\n');
}

function nginxConf(dir: string, url: string): string {
    let host = 'example.com';
    try { if (url) host = new URL(url).hostname || host; } catch { /* keep the placeholder */ }
    return [
        '# BMM repo served by nginx as plain static files.',
        `# Copy the repo folder (${basename(dir)}) to the server, point "root" at it, reload nginx.`,
        'server {',
        '    listen 80;',
        `    server_name ${host};`,
        `    root /var/www/${basename(dir).replace(/[^\w.-]+/g, '-')};`,
        '',
        '    location / {',
        '        try_files $uri =404;',
        '        autoindex off;',
        '    }',
        '    # Always the latest manifest: subscribers compare it with what they have.',
        '    location = /repo.json {',
        '        add_header Cache-Control "no-cache";',
        '    }',
        '    # Backups the converter keeps beside repo.json are not for the public.',
        '    location ~ \\.bak$ { deny all; }',
        '}',
        '',
    ].join('\n');
}

function hostingMd(dir: string, url: string, gh: boolean, nginx: boolean): string {
    const at = url ? url.replace(/\/+$/, '') + '/' : t('repo.static.md.yourAddress');
    const lines = [
        `# ${t('repo.static.md.title')}`,
        '',
        t('repo.static.md.intro'),
        '',
        `## ${t('repo.static.md.anyTitle')}`,
        '',
        t('repo.static.md.any'),
        '',
    ];
    if (gh) lines.push(`## GitHub Pages`, '', t('repo.static.md.gh'), '');
    if (nginx) lines.push(`## Nginx`, '', t('repo.static.md.nginx'), '');
    lines.push(`## ${t('repo.static.md.shareTitle')}`, '', t('repo.static.md.share', { url: at }), '',
        `## ${t('repo.static.md.limitsTitle')}`, '', t('repo.static.md.limits'), '');
    return lines.join('\n');
}

async function writeStatic(): Promise<void> {
    const dir = needDir();
    if (!dir) return;
    if (!(await hasManifest(dir))) { toast(t('repo.validate.noManifest'), 'warning'); return; }
    const url = val('repo-static-url');
    const gh = !!$<HTMLInputElement>('repo-static-gh')?.checked;
    const nginx = !!$<HTMLInputElement>('repo-static-nginx')?.checked;
    const btn = $<HTMLButtonElement>('btn-repo-static-go');
    if (btn) btn.disabled = true;
    const written: string[] = [];
    try {
        const files: Array<[string[], string]> = [[['HOSTING.md'], hostingMd(dir, url, gh, nginx)]];
        if (gh) files.push([['.github', 'workflows', 'bmm-repo-pages.yml'], pagesWorkflow()]);
        if (nginx) files.push([['nginx-bmm-repo.conf'], nginxConf(dir, url)]);
        for (const [parts, content] of files) {
            await invoke('write_text_file', { path: join(dir, ...parts), content });
            written.push(parts.join('/'));
        }
        showResult('repo-static-result', `${uiIcon('success', 14)} <span>${escHtml(t('repo.static.done', { n: String(written.length) }))}</span>
            <ul class="rp-notes">${written.map((f) => `<li>${uiIcon('file-text', 12)}<span class="rp-mono">${escHtml(f)}</span></li>`).join('')}</ul>
            <span class="rp-hint-t">${escHtml(t('repo.static.next'))}</span>`);
    } catch (e) {
        showResult('repo-static-result', `${uiIcon('error', 14)} <span>${escHtml(errText(e))}</span>`, 'bad');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ── Wiring ──────────────────────────────────────────────────────────────────────────────────

export function initRepoTools(): void {
    const root = document.getElementById('view-repo');
    if (!root || root.dataset.rpTools) return;
    root.dataset.rpTools = '1';

    // The shared folder: mirrors step 1 until the user picks another one here.
    paintToolsDir();
    $('repo-host-path')?.addEventListener('input', () => { paintToolsDir(); });
    $('btn-repo-tools-dir')?.addEventListener('click', async () => {
        const d = await pickFolder();
        if (!d) return;
        const inp = $<HTMLInputElement>('repo-tools-dir');
        if (inp) { inp.value = d; inp.dataset.manual = '1'; }
        void readVersion();
        void refreshShare(true);
    });

    // Quick create.
    const author = $<HTMLInputElement>('repo-quick-author');
    if (author && !author.value) { try { author.value = localStorage.getItem('bmm_last_author') || ''; } catch { /* private mode */ } }
    $('repo-quick-kind')?.addEventListener('change', () => { void fillQuickSources(); });
    $('btn-repo-quick-out')?.addEventListener('click', async () => {
        const d = await pickFolder();
        const inp = $<HTMLInputElement>('repo-quick-out');
        if (d && inp) inp.value = d;
    });
    $('btn-repo-quick-folder')?.addEventListener('click', async () => {
        const d = await pickFolder();
        const inp = $<HTMLInputElement>('repo-quick-folder');
        if (d && inp) inp.value = d;
    });
    $('btn-repo-quick-go')?.addEventListener('click', () => { void quickCreate(); });

    // Validate, and its « Convert » / « Repair » buttons (the existing dialog: dry run first).
    $('btn-repo-validate')?.addEventListener('click', () => { void validate(); });
    $('repo-validate-report')?.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ck-act="convert"]');
        const dir = ($('repo-validate-report') as HTMLElement | null)?.dataset.dir || toolsDir();
        if (b && dir) void openConvertDialog(dir).then(() => validate());
    });

    // Version.
    root.querySelectorAll<HTMLElement>('[data-bump]').forEach((b) => b.addEventListener('click', () => bump(b.dataset.bump || 'patch')));
    $('btn-repo-version-apply')?.addEventListener('click', () => { void applyVersion(); });

    // Preview.
    $('btn-repo-preview')?.addEventListener('click', () => { void preview(); });

    // Share.
    $('repo-share-addr')?.addEventListener('change', () => { void refreshShare(); });
    $('repo-share-custom')?.addEventListener('input', () => { void refreshShare(); });
    $('repo-share-pass')?.addEventListener('change', () => { void refreshShare(); });
    $('btn-repo-share-link')?.addEventListener('click', () => { void copy(($('repo-share-text') as HTMLElement | null)?.dataset.link || ''); });
    $('btn-repo-share-msg')?.addEventListener('click', () => { void copy(($('repo-share-text') as HTMLTextAreaElement | null)?.value || ''); });

    // Static host.
    $('btn-repo-static-go')?.addEventListener('click', () => { void writeStatic(); });

    // What a tool shows depends on the folder and the server at the moment it is opened.
    root.querySelectorAll<HTMLDetailsElement>('details.rp-tool').forEach((tool) => {
        tool.addEventListener('toggle', () => {
            if (!tool.open) return;
            paintToolsDir();
            const id = tool.dataset.tool;
            if (id === 'quick') void fillQuickSources();
            else if (id === 'version') void readVersion();
            else if (id === 'share') void refreshShare(true);
            else if (id === 'preview') {
                const opt = root.querySelector<HTMLOptionElement>('#repo-preview-src option[value="server"]');
                if (opt) opt.disabled = !serverRunning();
                const sel = $<HTMLSelectElement>('repo-preview-src');
                if (sel && opt?.disabled && sel.value === 'server') sel.value = 'folder';
            }
        });
        if (tool.open) tool.dispatchEvent(new Event('toggle'));
    });
    // The share addresses follow the server (and the language of their labels). The tool is
    // looked up once, here: the listeners below read no attribute of anything.
    const share = root.querySelector<HTMLDetailsElement>('details.rp-tool[data-tool="share"]');
    const repaintShare = () => { if (share?.open) void refreshShare(true); };
    const panel = $('repo-run-panel');
    if (panel) new MutationObserver(repaintShare).observe(panel, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('langChanged', repaintShare);
}

export { revealRepoTool };
