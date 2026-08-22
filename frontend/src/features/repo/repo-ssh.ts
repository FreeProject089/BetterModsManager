// Server Repo → publish over SSH.
//
// The backend does the work (src-tauri/src/commands/repo_ssh.rs); this is the form, the
// progress bar, and the translation of the backend's error codes.
//
// ERRORS ARRIVE AS CODES, not sentences. Rust returns `repo.ssh.errAuthRejected` or
// `repo.ssh.errConnect|host|detail` — a key and its arguments, pipe-separated. The backend
// has no language, and a message composed there would be English forever. Splitting on '|'
// here is what lets the same failure read correctly in both.

import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { pickFile } from '../../core/api.js';

interface SshTarget {
    host: string;
    port?: number | null;
    user: string;
    keyPath: string;
    remoteDir: string;
}

interface SshTestResult {
    fingerprint: string;
    remoteDirExists: boolean;
    writable: boolean;
    entries: number;
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

/** Where the settings live. Host/user/folder/key PATH — never the passphrase. */
const STORE = 'bmm.repo.ssh';

function loadTarget(): Partial<SshTarget> {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
}

function saveTarget(target: SshTarget): void {
    // The passphrase is deliberately absent from what gets written. It is read from the
    // field at the moment of use and never leaves this function's caller.
    try { localStorage.setItem(STORE, JSON.stringify(target)); } catch { /* storage full */ }
}

/** Read the form. Returns null (and says why) when something required is missing. */
function readForm(): { target: SshTarget; passphrase: string } | null {
    const host = el<HTMLInputElement>('repo-ssh-host')?.value.trim() || '';
    const user = el<HTMLInputElement>('repo-ssh-user')?.value.trim() || '';
    const keyPath = el<HTMLInputElement>('repo-ssh-key')?.value.trim() || '';
    const remoteDir = el<HTMLInputElement>('repo-ssh-remote')?.value.trim() || '';
    const portRaw = el<HTMLInputElement>('repo-ssh-port')?.value.trim() || '';
    if (!host || !user || !keyPath || !remoteDir) {
        status(t('repo.ssh.needFields'), 'err');
        return null;
    }
    const port = portRaw ? Number(portRaw) : null;
    return {
        target: { host, user, keyPath, remoteDir, port: Number.isFinite(port) ? port : null },
        passphrase: el<HTMLInputElement>('repo-ssh-pass')?.value || '',
    };
}

function status(text: string, tone: 'ok' | 'warn' | 'err' | '' = ''): void {
    const b = el('repo-ssh-status');
    if (!b) return;
    b.textContent = text;
    b.hidden = !text;
    if (tone) b.dataset.tone = tone; else delete b.dataset.tone;
}

/**
 * Turn `code|arg|arg` into a sentence in the user's language.
 *
 * The argument NAMES differ per message ({host}, {dir}, {fp}, {detail}), so the mapping is
 * per code rather than positional-for-everything: a generic {0}/{1} would read like a stack
 * trace in a place people go when something already went wrong.
 */
function explain(raw: unknown): string {
    const s = String(raw ?? '');
    const [code, ...args] = s.split('|');
    const named: Record<string, Record<string, string>> = {
        'repo.ssh.errKeyRead': { detail: args[1] || args[0] || '' },
        'repo.ssh.errKeyDecode': { detail: args[0] || '' },
        'repo.ssh.errConnect': { host: args[0] || '', detail: args[1] || '' },
        'repo.ssh.errAuth': { detail: args[0] || '' },
        'repo.ssh.errHostKeyChanged': { fp: args[0] || '' },
        'repo.ssh.errLocalDir': { dir: args[0] || '' },
        'repo.ssh.errSftp': { detail: args[0] || '' },
    };
    // A code we know about resolves; anything else is shown verbatim inside a generic
    // wrapper rather than swallowed — an unrecognised failure is still a failure to report.
    if (code.startsWith('repo.ssh.') && t(code) !== code) {
        let out = t(code);
        for (const [k, v] of Object.entries(named[code] || {})) out = out.replace(`{${k}}`, v);
        return out;
    }
    return t('repo.ssh.errGeneric').replace('{detail}', s);
}

const fmtBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
};

let busy = false;

function setBusy(on: boolean): void {
    busy = on;
    for (const id of ['repo-ssh-test', 'repo-ssh-publish']) {
        const b = el<HTMLButtonElement>(id);
        if (b) b.disabled = on;
    }
}

async function testConnection(): Promise<void> {
    const form = readForm();
    if (!form || busy) return;
    setBusy(true);
    status(t('repo.ssh.testing'));
    try {
        const r = (await invoke('ssh_test_connection', {
            target: form.target,
            passphrase: form.passphrase || null,
        })) as SshTestResult;
        saveTarget(form.target);
        el('repo-ssh-forget')!.hidden = false;
        if (!r.remoteDirExists) {
            status(t('repo.ssh.testNoDir').replace('{dir}', form.target.remoteDir), 'warn');
        } else if (!r.writable) {
            // The failure worth catching here: the upload version of it fails after
            // transferring everything.
            status(t('repo.ssh.testNotWritable').replace('{dir}', form.target.remoteDir), 'err');
        } else {
            status(t('repo.ssh.testOkWritable'), 'ok');
        }
        toast(t('repo.ssh.testOk').replace('{fp}', r.fingerprint), 'success', 6000);
    } catch (e) {
        status(explain(e), 'err');
        toast(explain(e), 'error', 8000);
    } finally {
        setBusy(false);
    }
}

async function publish(): Promise<void> {
    const form = readForm();
    if (!form || busy) return;
    const localDir = (el<HTMLInputElement>('repo-export-path')?.value || '').trim();
    if (!localDir) {
        status(t('repo.ssh.pickExportFirst'), 'err');
        return;
    }
    setBusy(true);
    const wrap = el('repo-ssh-progress');
    const fill = el('repo-ssh-bar-fill');
    const text = el('repo-ssh-progress-text');
    if (wrap) wrap.hidden = false;
    if (fill) fill.style.width = '0%';
    status('');

    try {
        const bytes = (await invoke('ssh_upload_repo', {
            target: form.target,
            passphrase: form.passphrase || null,
            localDir,
        })) as number;
        saveTarget(form.target);
        const done = text?.dataset.done || '?';
        status(t('repo.ssh.uploaded').replace('{n}', done).replace('{size}', fmtBytes(bytes)), 'ok');
        toast(t('repo.ssh.uploaded').replace('{n}', done).replace('{size}', fmtBytes(bytes)), 'success', 7000);
    } catch (e) {
        status(explain(e), 'err');
        toast(explain(e), 'error', 9000);
    } finally {
        setBusy(false);
        if (fill) fill.style.width = '100%';
    }
}

/** Wire the panel. Idempotent — a second call attaches nothing twice. */
export function initRepoSsh(): void {
    const card = el('repo-ssh-card');
    if (!card || card.dataset.bound) return;
    card.dataset.bound = '1';

    const saved = loadTarget();
    const set = (id: string, v: unknown) => {
        const input = el<HTMLInputElement>(id);
        if (input && v != null && v !== '') input.value = String(v);
    };
    set('repo-ssh-host', saved.host);
    set('repo-ssh-port', saved.port);
    set('repo-ssh-user', saved.user);
    set('repo-ssh-key', saved.keyPath);
    set('repo-ssh-remote', saved.remoteDir);
    if (saved.host) el('repo-ssh-forget')!.hidden = false;

    el('repo-ssh-test')?.addEventListener('click', () => { void testConnection(); });
    el('repo-ssh-publish')?.addEventListener('click', () => { void publish(); });

    el('repo-ssh-key-pick')?.addEventListener('click', async () => {
        const p = await pickFile();
        if (p) {
            const input = el<HTMLInputElement>('repo-ssh-key');
            if (input) input.value = p;
        }
    });

    el('repo-ssh-forget')?.addEventListener('click', async () => {
        const host = el<HTMLInputElement>('repo-ssh-host')?.value.trim();
        if (!host) return;
        const portRaw = el<HTMLInputElement>('repo-ssh-port')?.value.trim();
        await invoke('ssh_forget_host', { host, port: portRaw ? Number(portRaw) : null })
            .catch(() => {});
        status(t('repo.ssh.forgotten'), 'warn');
    });

    // Progress, emitted per file by the backend.
    void import('@tauri-apps/api/event').then(({ listen }) => {
        void listen<{ done: number; total: number; bytes: number; current: string }>(
            'repo-ssh-progress',
            (e) => {
                const { done, total, bytes, current } = e.payload;
                const fill = el('repo-ssh-bar-fill');
                const text = el('repo-ssh-progress-text');
                if (fill && total > 0) fill.style.width = `${Math.round((done / total) * 100)}%`;
                if (text) {
                    text.dataset.done = String(done);
                    text.textContent = t('repo.ssh.uploading')
                        .replace('{done}', String(done))
                        .replace('{total}', String(total))
                        .replace('{file}', current) + ` · ${fmtBytes(bytes)}`;
                }
            },
        );
    });
}

/** For the deeplink and the scheduler: publish with the STORED target, no UI.
 *
 *  A key with a passphrase cannot be used this way — there is nobody to ask, and prompting
 *  from a scheduled task at 04:00 is a task that silently never runs. It fails with a
 *  message that says so rather than hanging.
 */
export async function publishStoredTarget(localDir: string): Promise<number> {
    const saved = loadTarget();
    if (!saved.host || !saved.user || !saved.keyPath || !saved.remoteDir) {
        throw new Error(t('repo.ssh.needFields'));
    }
    return (await invoke('ssh_upload_repo', {
        target: saved as SshTarget,
        passphrase: null,
        localDir,
    })) as number;
}
