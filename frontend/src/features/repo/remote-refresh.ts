// Server Repo → Host → "Update from the server".
//
// The third publish route, alongside the two that already existed and are untouched:
//   • Full export  — BMM copies every mod into a folder you upload.
//   • Manifest only — BMM describes a folder it can read on this machine.
//   • This one     — the mods are ONLY on the server, and BMM never sees them locally.
//
// It reads the server's own directory listing, works out what actually changed, downloads
// only that, and rewrites repo.json. You then upload that single file with the client you
// already use. BMM never needs write access to your server.

import { invoke, pickFolder } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { formatBytes } from '../../core/utils.js';

interface PlanReport {
    summary: string;
    toHash: string[];
    reused: number;
    removed: string[];
    fullRehash: string | null;
    warnings: string[];
    downloadBytes: number;
}

interface RefreshReport {
    manifestPath: string;
    mods: number;
    files: number;
    hashed: number;
    reused: number;
    removed: string[];
    downloadedBytes: number;
    signed: boolean;
    warnings: string[];
}

const $ = (id: string) => document.getElementById(id);

function inputs(): { baseUrl: string; manifestPath: string; forceFull: boolean } | null {
    const baseUrl = ($('remote-base-url') as HTMLInputElement | null)?.value?.trim() || '';
    const manifestPath = ($('remote-manifest-path') as HTMLInputElement | null)?.value?.trim() || '';
    if (!baseUrl) {
        toast(t('repo.remoteNeedUrl') || 'Enter the URL of the mods folder', 'error');
        return null;
    }
    if (!manifestPath) {
        toast(t('repo.remoteNeedManifest') || 'Choose your local repo.json', 'error');
        return null;
    }
    return {
        baseUrl,
        manifestPath,
        forceFull: ($('remote-force-full') as HTMLInputElement | null)?.checked || false,
    };
}

/// Build the result box. Every value goes in as text — a server-supplied path must never
/// become markup in the window that is about to sign a manifest describing it.
function show(lines: Array<[string, string, string?]>, title: string, tone: string) {
    const box = $('remote-result');
    if (!box) return;
    box.textContent = '';
    box.style.display = '';

    const head = document.createElement('div');
    head.style.cssText = `font-weight:700;margin-bottom:6px;color:${tone}`;
    head.textContent = title;
    box.append(head);

    for (const [label, value, colour] of lines) {
        if (!value) continue;
        const row = document.createElement('div');
        row.style.cssText = colour ? `color:${colour}` : '';
        row.textContent = `${label}: ${value}`;
        box.append(row);
    }
}

/// A handful of names plus a count, never the whole list — a repo with 400 changed files
/// would otherwise push the buttons off the card.
const preview = (ids: string[]) =>
    ids.length ? `${ids.length} — ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? '…' : ''}` : '';

async function run(which: 'plan' | 'refresh') {
    const args = inputs();
    if (!args) return;
    const btn = $(which === 'plan' ? 'btn-remote-plan' : 'btn-remote-refresh') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }

    try {
        if (which === 'plan') {
            const r = (await invoke('plan_remote_repo_refresh', args)) as PlanReport;
            show([
                [t('repo.remoteHashed') || 'To hash', preview(r.toHash), 'var(--warning)'],
                [t('repo.remoteReused') || 'Reused', String(r.reused), 'var(--success)'],
                [t('repo.remoteRemoved') || 'Gone from the server', preview(r.removed), 'var(--danger)'],
                [t('repo.remoteDownload') || 'To download', formatBytes(r.downloadBytes)],
                [t('repo.remoteFull') || 'Everything will be re-hashed', r.fullRehash || ''],
                ...r.warnings.map((w) => ['⚠', w, 'var(--warning)'] as [string, string, string]),
            ], t('repo.remotePlanned') || 'Nothing changed yet', 'var(--text)');
        } else {
            const r = (await invoke('refresh_repo_from_server', args)) as RefreshReport;
            show([
                ['', r.manifestPath, 'var(--text-muted)'],
                ['', `${r.mods} mods · ${r.files} files`],
                [t('repo.remoteHashed') || 'Hashed', String(r.hashed), 'var(--warning)'],
                [t('repo.remoteReused') || 'Reused', String(r.reused), 'var(--success)'],
                [t('repo.remoteRemoved') || 'Gone from the server', preview(r.removed), 'var(--danger)'],
                [t('repo.remoteDownload') || 'Downloaded', formatBytes(r.downloadedBytes)],
                ...(r.signed ? [] : [['⚠', t('repo.manifestUnsigned') || 'Written unsigned', 'var(--warning)'] as [string, string, string]]),
                ...r.warnings.map((w) => ['⚠', w, 'var(--warning)'] as [string, string, string]),
            ], t('repo.remoteDone') || 'repo.json updated — upload it to your server', 'var(--success)');

            // Removals are the one outcome worth interrupting for: a mistyped URL produces a
            // perfectly valid manifest describing an empty server, and it looks like success.
            if (r.removed.length) {
                toast(`${r.removed.length} ${t('repo.manifestRemovedWarn') || 'mods are gone from the server and were dropped from the manifest'}`, 'warning');
            } else {
                toast(t('repo.remoteDone') || 'repo.json updated', 'success');
            }
        }
    } catch (e) {
        toast(String(e), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
}

export function initRemoteRefresh() {
    $('btn-remote-browse')?.addEventListener('click', async () => {
        const dir = await pickFolder();
        if (!dir) return;
        const input = $('remote-manifest-path') as HTMLInputElement | null;
        // A folder picker, then repo.json inside it: there is no file picker wired here, and
        // the manifest always sits at that name.
        if (input) input.value = `${dir.replace(/[\\/]+$/, '')}/repo.json`;
    });
    $('btn-remote-plan')?.addEventListener('click', () => void run('plan'));
    $('btn-remote-refresh')?.addEventListener('click', () => void run('refresh'));
}
