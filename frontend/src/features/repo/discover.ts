// Server Repo → Sync → "No repo.json? Inspect the server".
//
// FETCH needs a manifest. A server that just serves a folder of mods has none, and until
// now that made it unusable even though every file is right there. This reads the listing
// instead and shows what the server offers, marking anything a manifest does not vouch for.
//
// The marking is the feature, not a caveat on it. A hash is what tells a good download from
// a corrupted or substituted one; without it there is nothing to compare against, and
// folding those mods in with verified ones would hand out a guarantee that does not exist.

import { invoke } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { formatBytes } from '../../core/utils.js';

interface DiscoveredMod {
    id: string;
    files: number;
    bytes: number;
    verified: boolean;
    uncovered: string[];
}

interface DiscoveryReport {
    manifestUrl: string | null;
    manifestTrusted: boolean;
    mods: DiscoveredMod[];
    verifiedCount: number;
    unverifiedCount: number;
}

const $ = (id: string) => document.getElementById(id);

function line(text: string, style = ''): HTMLElement {
    const el = document.createElement('div');
    if (style) el.style.cssText = style;
    // textContent throughout: every value here is a path or URL the SERVER chose, and this
    // is the panel deciding whether to trust that server.
    el.textContent = text;
    return el;
}

function modRow(m: DiscoveredMod): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;justify-content:space-between;gap:10px;padding:3px 0';
    const left = document.createElement('span');
    left.style.cssText = m.verified ? 'color:var(--text)' : 'color:var(--warning)';
    left.textContent = `${m.verified ? '✓' : '⚠'} ${m.id}`;
    const right = document.createElement('span');
    right.style.cssText = 'color:var(--text-muted);font-family:var(--font-mono);font-size:10px';
    right.textContent = `${m.files} · ${formatBytes(m.bytes)}`;
    el.append(left, right);
    return el;
}

async function discover() {
    const url = ($('repo-sync-url') as HTMLInputElement | null)?.value?.trim();
    if (!url) {
        toast(t('repo.discoverNeedUrl') || 'Enter the URL of the mods folder first', 'error');
        return;
    }
    const btn = $('btn-discover-server') as HTMLButtonElement | null;
    const box = $('discover-result');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }

    try {
        const r = (await invoke('discover_server_repo', { baseUrl: url })) as DiscoveryReport;
        if (!box) return;
        box.textContent = '';
        box.style.display = '';

        // A close button, because this panel is an answer to a question you asked once.
        // It used to need a page refresh to go away, so a "no manifest found" verdict sat
        // there long after you had dealt with it and read like a live warning.
        const close = document.createElement('button');
        close.className = 'btn btn-ghost btn-sm';
        close.style.cssText = 'float:right;margin:-2px 0 0 8px;padding:2px 8px;line-height:1';
        close.textContent = '×';
        close.title = t('common.close') || 'Close';
        close.addEventListener('click', () => { box.textContent = ''; box.style.display = 'none'; });
        box.append(close);

        if (!r.mods.length) {
            box.append(line(t('repo.discoverEmpty') || 'The server listing produced no mods',
                'color:var(--text-muted)'));
            return;
        }

        // State of the manifest first: it is what decides whether anything below is trusted,
        // so reading the mod list before knowing it would be reading it wrong.
        if (!r.manifestUrl) {
            box.append(line(t('repo.discoverNoManifest') || 'No manifest found — everything below is unverified',
                'color:var(--warning);font-weight:700;margin-bottom:6px'));
        } else if (!r.manifestTrusted) {
            box.append(line(t('repo.discoverUntrusted') || 'A manifest was found but its signature does not verify — treated as absent',
                'color:var(--danger);font-weight:700;margin-bottom:6px'));
            box.append(line(`${t('repo.discoverManifest') || 'Manifest'}: ${r.manifestUrl}`,
                'color:var(--text-muted);font-size:10px;word-break:break-all;margin-bottom:6px'));
        } else {
            box.append(line(`${t('repo.discoverManifest') || 'Manifest'}: ${r.manifestUrl}`,
                'color:var(--success);margin-bottom:6px;word-break:break-all'));
        }

        box.append(line(
            `${t('repo.discoverVerified') || 'Verified mods'}: ${r.verifiedCount}   ·   ` +
            `${t('repo.discoverUnverified') || 'Unverified mods'}: ${r.unverifiedCount}`,
            'margin-bottom:6px',
        ));

        const list = document.createElement('div');
        list.style.cssText = 'max-height:180px;overflow-y:auto;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px';
        // Unverified first: they are the ones that need a decision.
        for (const m of [...r.mods].sort((a, b) => Number(a.verified) - Number(b.verified))) {
            list.append(modRow(m));
        }
        box.append(list);

        if (r.unverifiedCount > 0) {
            box.append(line(t('repo.discoverWhy') || 'Unverified means BMM cannot tell a good download from a corrupted or substituted one.',
                'margin-top:8px;color:var(--text-muted);font-size:10px;line-height:1.5'));
        }
    } catch (e) {
        toast(String(e), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
}

export function initDiscover() {
    $('btn-discover-server')?.addEventListener('click', () => void discover());
}
