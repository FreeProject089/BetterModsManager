import { t } from './i18n.js';
import { appState } from './state.js';

// "Include credentials for protected sources", on every screen that publishes something.
//
// It existed once, on the .mm export, written inline: markup in index.html, the host list in
// one listener, the reading of it in the middle of the export handler. That was fine while
// one screen published — and a repository is the other thing this app hands to strangers, so
// there were about to be two copies of a block whose entire subject is secrets.
//
// One module, two mount points. The passwords, the passphrase and the refusal rules are the
// same rules wherever the block appears, and two implementations of a rule about secrets is
// one implementation that will be a version behind.
//
// What it does NOT do, deliberately: it never reads a private key. The passwords are here
// because the frontend is the only place they exist — BMM keeps them for the run and never
// writes them down — but key material stays in Rust and is gathered there. Routing it
// through the webview to hand it straight back would be a copy of it in a second place for
// no reason at all.

/** What the backend's `CredsRequest` expects. */
export interface CredsRequest {
    passwords: Record<string, string>;
    includeKeys: boolean;
    passphrase: string;
}

/**
 * Markup for the fold. `p` prefixes every id so two can coexist on one page.
 *
 * The strings are the `mm.creds.*` set, unchanged: they were written for this block and they
 * say the same thing about a repository as about a list. Renaming them would have meant
 * translating the same six sentences a second time under a second prefix.
 */
export function credsFoldHtml(p: string): string {
    return `
    <details class="mm-creds" id="${p}-creds">
      <summary>${t('mm.creds.title')}</summary>
      <p class="mm-creds-note">${t('mm.creds.desc')}</p>
      <label class="mm-creds-row">
        <input type="checkbox" id="${p}-creds-pw">
        <span>${t('mm.creds.pw')}</span>
      </label>
      <label class="mm-creds-row">
        <input type="checkbox" id="${p}-creds-keys">
        <span>${t('mm.creds.keys')}</span>
      </label>
      <input type="password" class="input input-sm" id="${p}-creds-pass"
             autocomplete="new-password" placeholder="${t('mm.creds.passPh')}">
      <p class="mm-creds-note" id="${p}-creds-hosts"></p>
    </details>`;
}

/**
 * Name the hosts, when the fold is opened.
 *
 * "Include download passwords" with nothing else on screen is a decision made blind: whether
 * it is safe depends entirely on WHICH hosts, and that is knowable before anything is ticked.
 *
 * `origins` is called on open rather than at wire time, because on both screens the answer
 * depends on what has been selected since.
 */
export function wireCredsFold(p: string, origins: () => string[]): void {
    const fold = document.getElementById(`${p}-creds`) as HTMLDetailsElement | null;
    if (!fold) return;
    fold.addEventListener('toggle', () => {
        const hostsEl = document.getElementById(`${p}-creds-hosts`);
        if (!hostsEl || !fold.open) return;
        const list = origins();
        hostsEl.textContent = list.length
            ? t('mm.creds.hosts').replace('{list}', list.map((o) => {
                try { return new URL(o).host; } catch { return o; }
            }).join(', ')) + ' — ' + t('mm.creds.sessionOnly')
            : t('mm.creds.sessionOnly');
    });
}

/**
 * What to send, or `undefined` when nothing was asked for.
 *
 * Returns `null` when the fold was used and the passphrase is missing — a distinct answer
 * from "nothing was asked for", because the caller must STOP rather than publish without the
 * credentials somebody just ticked. Refused here as well as in Rust: failing at the far end
 * after the export has walked every mod costs minutes for a mistake visible before it began.
 *
 * The caller reports that refusal (`mm.creds.noPass`). This module does not toast: `toast`
 * lives in ui/app, half the application imports ui/app, and a core module reaching for it
 * closes a dependency cycle for the sake of one sentence.
 */
export async function readCredsFold(p: string, origins: () => string[]): Promise<CredsRequest | undefined | null> {
    const wantPw = (document.getElementById(`${p}-creds-pw`) as HTMLInputElement | null)?.checked ?? false;
    const wantKeys = (document.getElementById(`${p}-creds-keys`) as HTMLInputElement | null)?.checked ?? false;
    const pass = (document.getElementById(`${p}-creds-pass`) as HTMLInputElement | null)?.value || '';
    if (!wantPw && !wantKeys) return undefined;
    if (!pass) return null;

    const { knownSourcePasswords } = await import('./source-fetch.js');
    // Only the hosts THIS thing points at. Handing over every password the session happens to
    // hold would be exporting credentials for sources it does not even mention.
    const wanted = new Set(origins());
    const all = wantPw ? knownSourcePasswords() : {};
    const passwords: Record<string, string> = {};
    for (const [origin, pw] of Object.entries(all)) if (wanted.has(origin)) passwords[origin] = pw;
    return { passwords, includeKeys: wantKeys, passphrase: pass };
}

/**
 * Every host the installed mods point at.
 *
 * Two jobs, and both are why it lives beside the fold rather than in one screen: it NAMES the
 * hosts under the checkbox, and it FILTERS which passwords are sealed. A host missing from it
 * is a host the reader is not told about AND whose password is quietly dropped.
 *
 * It read `s.url` on the additional sources. The field is `repo_url` — so a private repo
 * attached as a fallback never appeared in the sentence and never made it into the block, and
 * the recipient was refused by precisely the source there had been a password for.
 */
export function exportOrigins(): string[] {
    const out = new Set<string>();
    const add = (u: unknown) => {
        if (typeof u !== 'string' || !u) return;
        try { out.add(new URL(u).origin); } catch { /* not an address */ }
    };
    for (const m of (appState.get('allMods') as any[]) || []) {
        add(m?.source_repo);
        add(m?.update_url);
        add(m?.direct_url);
        for (const s of m?.update_sources || []) add(s?.repo_url);
    }
    return [...out];
}
