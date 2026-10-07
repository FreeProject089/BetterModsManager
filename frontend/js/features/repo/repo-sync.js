// @ts-nocheck
import { invoke } from '../../core/api.js';
import { fireEvent } from '../../core/bmm-events.js';
import { registerRepoSyncOpener } from './auto-sync.js';
import { toast, updateLibraryProfileSelector } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { renderProfiles } from '../profiles/profiles.js';
import { formatBytes, escHtml } from '../../core/utils.js';
import { checkModUpdates } from './mod-updates.js';
import { getLinks } from '../../core/links-config.js';
let lastFetchedRepo = null;
let lastFetchedRepoSaltedId = null;
// Download password for a password-protected self-hosted repo. The host sets an optional
// DOWNLOAD_PASSWORD on the mini-server; content requests then need `X-Repo-Password`.
// We remember what the user typed for this session so the follow-up fetch + the sync reuse it.
let lastRepoPassword = null;
/**
 * Ask for a password, or a passphrase.
 *
 * Moved to ui/ask-one.ts and re-exported here, because core/source-fetch needs it on a 401
 * and importing a repo feature from core dragged ui/app, profiles, mod-updates and the links
 * config into a cycle with it. Re-exported rather than moved-and-renamed so the callers that
 * know it by this name keep working.
 */
// Imported AND re-exported, not `export … from`. A re-export forwards the name to importers
// and does NOT bind it locally — and this file calls it itself (line ~175). Under @ts-nocheck
// tsc says nothing, so the first 401 would have been a ReferenceError. check-undefined-names
// caught it; that is the gate's whole job.
import { promptRepoPassword } from '../../ui/ask-one.js';
import { uiIcon } from '../../ui/icons.js';
import { expectedRepoSignature } from './repo-pin.js';
export { promptRepoPassword };
// Pre-seed the session download password (e.g. from a deeplink / API-driven sync that
// already carries it), so the auto-driven fetch doesn't have to prompt the user.
export function setRepoPassword(pw) { lastRepoPassword = pw && pw.length ? pw : null; }
/** The collapsed "this repo has a password" row under the URL field. Wired here rather
 *  than in app.ts so everything about repo passwords lives in one file. */
function initSyncPasswordField() {
    const toggle = document.getElementById('btn-sync-pass-toggle');
    const row = document.getElementById('repo-sync-pass-row');
    if (!toggle || !row)
        return;
    toggle.addEventListener('click', () => {
        const open = row.style.display !== 'none';
        row.style.display = open ? 'none' : '';
        // The chevron is the only thing on screen that says which way this goes.
        toggle.classList.toggle('is-open', !open);
        if (!open)
            document.getElementById('repo-sync-password')?.focus();
    });
}
/**
 * The collapsed "this repo requires a private key" row, and the SSH-server picker.
 *
 * The key field writes `set_key_auth_key` — THE SAME setting the Identity & API card writes.
 * It is one value with two doors, not two values: BMM presents one identity to every source
 * that asks, so a per-repo key would be a promise the protocol cannot keep. Both screens read
 * the stored path back, so whichever one you open shows what is actually in force.
 */
function initSyncKeyAndSshFields() {
    // Which key signs for THIS repo's server. MANAGE goes to Settings rather than opening a
    // second copy of the ring: a key list edited in two places would drift, and the copy you
    // edited would not be the one that signs.
    const keyToggle = document.getElementById('btn-sync-key-toggle');
    const keyRow = document.getElementById('repo-sync-key-row');
    const syncUrl = () => document.getElementById('repo-sync-url')?.value?.trim() || '';
    if (keyToggle && keyRow) {
        keyToggle.addEventListener('click', async () => {
            const open = keyRow.style.display !== 'none';
            keyRow.style.display = open ? 'none' : '';
            keyToggle.classList.toggle('is-open', !open);
            // Read on open rather than at start-up: the ring can have changed from either of
            // the other two screens since this panel was built.
            if (!open) {
                const kr = await import('../../core/identity-key.js');
                await kr.renderKeySelect('repo-sync-key-sel', syncUrl, (k, kind) => toast(t(k), kind, kind === 'warning' ? 6000 : 3000), t);
            }
        });
    }
    // NAVIGATE first, then scroll.
    //
    // This only scrolled. #settings-identity-card lives in the Settings view, and while
    // another view is showing it is in a hidden subtree — scrollIntoView on it moves nothing
    // and reports nothing, so the button did exactly nothing, forever. Every other screen
    // that offers this clicks nav-settings first; this one had been written without it.
    document.getElementById('btn-sync-key-manage')?.addEventListener('click', () => {
        document.getElementById('nav-settings')?.click();
        setTimeout(() => document.getElementById('settings-identity-card')
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
    });
    // Making or adding a key lives in Settings → Identity & API, where the ring is.
    //
    // Two doors onto one list is how the copy you edited stops being the one that signs.
    // This screen is where you DISCOVER that a source wants a key — Manage takes you to
    // where they are kept.
    // ── which SSH server an ssh:// source connects to ────────────────────────
    const sshRow = document.getElementById('repo-sync-ssh-row');
    const sel = document.getElementById('repo-sync-ssh-target');
    const urlInput = document.getElementById('repo-sync-url');
    // Only shown for an ssh:// source: on an https:// repo the control would be a question
    // about something the fetch never touches.
    const refresh = async () => {
        if (!sshRow || !sel || !urlInput)
            return;
        const isSsh = /^ssh:\/\//i.test(urlInput.value.trim());
        sshRow.style.display = isSsh ? '' : 'none';
        if (!isSsh)
            return;
        const m = await import('./repo-ssh.js');
        const names = m.sshTargetNames();
        const current = m.sshTargetName(urlInput.value.trim()) || m.DEFAULT_TARGET;
        sel.textContent = '';
        for (const n of names) {
            const o = document.createElement('option');
            o.value = n;
            o.textContent = n;
            if (n === current)
                o.selected = true;
            sel.appendChild(o);
        }
        if (!names.length) {
            const o = document.createElement('option');
            o.value = '';
            o.textContent = t('repo.sync.useSshNotSet');
            sel.appendChild(o);
        }
    };
    urlInput?.addEventListener('input', () => { void refresh(); });
    sel?.addEventListener('change', async () => {
        if (!urlInput || !sel.value)
            return;
        const m = await import('./repo-ssh.js');
        urlInput.value = sel.value === m.DEFAULT_TARGET ? m.SSH_SOURCE_URL : `${m.SSH_SOURCE_URL}${sel.value}`;
        urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // CONFIGURE opens the servers screen. It used to scroll to the form inside the export
    // card — one real form, which was the right instinct and the wrong place: that card is
    // on another screen, and from a dialog it is behind the overlay entirely.
    document.getElementById('btn-sync-ssh-config')?.addEventListener('click', () => {
        void import('./ssh-servers.js').then((m) => m.openSshServers());
    });
    void refresh();
}
/**
 * `{ target, secret }` when this URL means the saved SSH target, null otherwise.
 *
 * Loaded lazily so the sync screen does not pull the SSH panel's module on every open — and
 * so a build with the panel absent simply has no SSH sources rather than failing to load.
 */
async function sshSourceOrNull(url) {
    const m = await import('./repo-ssh.js');
    // The NAME lives in the URL: `ssh://` is the one called "default", `ssh://prod` is the
    // one called prod. That is what lets several repos — and every catalog, whose sources are
    // a plain list of strings — each point at a different server without a model change.
    const name = m.sshTargetName(url);
    if (!name)
        return null;
    const target = m.storedSshTarget(name);
    if (!target)
        throw new Error(t('repo.ssh.errNoSuchTarget').replace('{name}', name));
    return { target, secret: m.currentSshSecret(name) };
}
// fetch_repo_info, but transparently handling a password-protected repo: on the
// `repo.errPasswordRequired` signal from the backend, ask the user once, remember it
// for this session, and retry. Cancelling re-throws so the caller's normal error path runs.
async function fetchRepoInfoWithPassword(url, creatorId) {
    // An `ssh://` source is read over SFTP instead. The value carries no host on purpose:
    // everything about WHERE to connect comes from the target saved in the SSH panel, so a
    // deeplink, a scheduled task or an API call can no more point BMM at an arbitrary machine
    // for reading than the publish path lets one point it somewhere for writing.
    const ssh = await sshSourceOrNull(url);
    if (ssh)
        return await invoke('ssh_fetch_repo_info', ssh);
    try {
        return await invoke('fetch_repo_info', { url, creatorId, password: lastRepoPassword });
    }
    catch (e) {
        if (String(e) === 'repo.errPasswordRequired') {
            const pw = await promptRepoPassword();
            if (pw == null)
                throw e;
            lastRepoPassword = pw;
            return await invoke('fetch_repo_info', { url, creatorId, password: pw });
        }
        throw e;
    }
}
// ── the author, as a person ──────────────────────────────────────────────────
//
// A repo's manifest carries `author_id`: the creator id that SIGNED it. When the BMM that
// generated it was linked to a BetterCommunity account, that id resolves to a real profile —
// so the author line becomes something you can click through to, instead of a name with
// nothing behind it.
//
// Resolution is public but not unconditional: BCWEB's /users/search only returns accounts
// with a public profile, and never banned or closed ones. An unlinked creator id, or one
// whose owner keeps their profile private, simply yields no link and the name stays plain
// text — which is the correct outcome, not a failure to report.
/** BCWEB profile URL for a repo's signing creator id, or null when it leads nowhere. */
async function bcwebProfileForAuthor(authorId) {
    if (!authorId)
        return null;
    try {
        const base = (getLinks()?.bettercommunity || 'https://bettercommunity.ch/').replace(/\/+$/, '');
        // Through the native process, never a webview fetch: the webview is a cross-origin
        // client (tauri.localhost) and bettercommunity.ch sends no CORS headers, so a direct
        // fetch fails — and reports a permissions error even when the real problem was a 503.
        const txt = await invoke('bc_api_get', {
            url: `${base}/api/users/search?q=${encodeURIComponent(authorId)}`,
        });
        const hit = (JSON.parse(txt)?.users || []).find((u) => u?.matchedById && !u?.private);
        return hit?.id ? `${base}/u/${encodeURIComponent(hit.id)}` : null;
    }
    catch {
        // Offline, or BCWEB down. A missing link is not worth a message here.
        return null;
    }
}
/** Turn an author element into a link to its BetterCommunity profile, when there is one. */
async function decorateAuthorLink(el, authorId) {
    if (!el)
        return;
    el.classList.remove('repo-author-linked');
    delete el.dataset.bcwebUrl;
    el.removeAttribute('title');
    const url = await bcwebProfileForAuthor(authorId);
    if (!url)
        return;
    el.classList.add('repo-author-linked');
    el.dataset.bcwebUrl = url;
    el.title = t('repo.authorOpenProfile');
}
// One delegated listener rather than one per render: these two elements are rewritten on
// every fetch, and binding per render leaks a listener per repo the user looks at.
document.addEventListener('click', (e) => {
    const el = e.target?.closest('.repo-author-linked');
    const url = el?.dataset.bcwebUrl;
    if (url)
        invoke('open_external_url', { url }).catch(() => { });
});
// Is this BMM signed in to a BetterCommunity account? Verifies the (raw) creator id
// against BCWEB's link-status, falling back to the cached `bc_linked` flag offline.
async function isBcLinked() {
    try {
        const cid = await invoke('get_creator_id');
        if (!cid)
            return false;
        const base = (getLinks()?.bettercommunity || 'https://bettercommunity.ch/').replace(/\/+$/, '');
        // Go through the native process (bc_api_get) instead of a webview fetch —
        // the webview is a cross-origin (tauri.localhost) client and a direct fetch
        // trips CORS; the Rust side isn't subject to it.
        const txt = await invoke('bc_api_get', { url: `${base}/api/link/status?creatorId=${encodeURIComponent(cid)}` });
        const d = JSON.parse(txt);
        try {
            localStorage.setItem('bc_linked', d?.linked ? '1' : '0');
        }
        catch { }
        return !!d?.linked;
    }
    catch {
        try {
            return localStorage.getItem('bc_linked') === '1';
        }
        catch {
            return false;
        }
    }
}
export function repoSignatureState(repo, selfSigned, pin) {
    const claims = !!repo?.signature || !!repo?.author_id;
    if (claims && !selfSigned)
        return 'invalid';
    const p = (pin || '').trim();
    if (p) {
        if (!repo?.signature)
            return 'missing';
        if (String(repo.signature).trim().toLowerCase() !== p.toLowerCase())
            return 'mismatch';
    }
    return claims ? 'valid' : 'unsigned';
}
export const sigBlocked = (s) => s === 'invalid' || s === 'missing' || s === 'mismatch';
const SIG_UI = {
    valid: { tone: 'ok', icon: 'shield-check', chip: 'repo.sig.chipValid', title: 'repo.sig.valid', desc: 'repo.sig.validDesc' },
    unsigned: { tone: 'warn', icon: 'shield', chip: 'repo.sig.chipUnsigned', title: 'repo.sig.unsigned', desc: 'repo.sig.unsignedDesc' },
    invalid: { tone: 'bad', icon: 'alert', chip: 'repo.sig.chipBlocked', title: 'repo.sig.invalid', desc: 'repo.errSignatureInvalid' },
    missing: { tone: 'bad', icon: 'alert', chip: 'repo.sig.chipBlocked', title: 'repo.sig.missing', desc: 'repo.errSignatureMissing' },
    mismatch: { tone: 'bad', icon: 'alert', chip: 'repo.sig.chipBlocked', title: 'repo.sig.mismatch', desc: 'repo.errSignatureMismatch' },
};
/** The state currently shown on the sync card ('' = no repo fetched). */
let currentSigState = '';
/**
 * Paint the signature state on the sync card: the chip at its top, the panel under the
 * description, and the Sync button (disabled, with the reason beside it, when the backend
 * would refuse). `pinned` changes only the wording of a valid signature.
 */
export function paintSignature(state, pinned = false) {
    currentSigState = state;
    const card = document.getElementById('repo-sync-info-card');
    const chip = document.getElementById('repo-sync-author-badge');
    const btn = document.getElementById('btn-start-repo-sync');
    let panel = document.getElementById('repo-sync-sig');
    let note = document.getElementById('repo-sync-blocked-note');
    if (!state) {
        panel?.remove();
        note?.remove();
        if (btn) {
            btn.disabled = false;
            btn.removeAttribute('aria-describedby');
        }
        return;
    }
    const ui = SIG_UI[state];
    if (chip) {
        chip.removeAttribute('style');
        chip.className = `rp-sig-chip rp-tone--${ui.tone}`;
        chip.innerHTML = `${uiIcon(ui.icon, 12)}<span>${escHtml(t(ui.chip))}</span>`;
        chip.setAttribute('role', 'button');
        chip.tabIndex = 0;
        chip.title = t('repo.verifyDetail.clickHint');
    }
    if (card && !panel) {
        panel = document.createElement('div');
        panel.id = 'repo-sync-sig';
        panel.setAttribute('role', 'status');
        const desc = document.getElementById('repo-sync-desc-display');
        (desc || card.firstElementChild)?.after(panel);
    }
    if (panel) {
        panel.className = `rp-sig rp-tone--${ui.tone}`;
        const descKey = state === 'valid' && pinned ? 'repo.sig.validPinnedDesc' : ui.desc;
        panel.innerHTML = `<span class="rp-sig-ic">${uiIcon(ui.icon, 16)}</span>`
            + `<span class="rp-sig-txt"><b class="rp-sig-t">${escHtml(t(ui.title))}</b>`
            + `<span class="rp-sig-d">${escHtml(t(descKey))}</span></span>`
            + `<button type="button" class="btn btn-ghost btn-sm rp-sig-more" data-rp-sig-details>${escHtml(t('repo.sig.details'))}</button>`;
    }
    const blocked = sigBlocked(state);
    if (btn) {
        btn.disabled = blocked;
        if (blocked) {
            if (!note) {
                note = document.createElement('p');
                note.id = 'repo-sync-blocked-note';
                note.className = 'rp-blocked-note';
                btn.after(note);
            }
            note.innerHTML = `${uiIcon('lock', 12)}<span>${escHtml(t('repo.sig.syncBlocked'))}</span>`;
            btn.setAttribute('aria-describedby', 'repo-sync-blocked-note');
        }
        else {
            note?.remove();
            btn.removeAttribute('aria-describedby');
        }
    }
}
function _openRepoVerifyDetail(repo, state) {
    const modal = document.getElementById('modal-repo-verify-detail');
    if (!modal)
        return;
    const ui = SIG_UI[state] || SIG_UI.unsigned;
    const totalMods = repo.profiles ? repo.profiles.reduce((n, p) => n + (p.mods?.length || 0), 0) : 0;
    const totalProfs = repo.profiles ? repo.profiles.length : 0;
    // Status icon & label: the shell's own tone modifiers (modal-shell.css), tokens only.
    const statusIcon = document.getElementById('repo-vd-status-icon');
    const statusLabel = document.getElementById('repo-vd-status-label');
    if (statusIcon) {
        statusIcon.removeAttribute('style');
        statusIcon.className = `bms-icon bms-icon--${ui.tone === 'bad' ? 'danger' : ui.tone}`;
        statusIcon.innerHTML = uiIcon(ui.icon, 16);
    }
    if (statusLabel) {
        statusLabel.removeAttribute('style');
        statusLabel.className = `bms-sub rp-vd-state rp-tone--${ui.tone}`;
        statusLabel.textContent = t(ui.chip);
    }
    // Fields
    const set = (id, val) => { const el = document.getElementById(id); if (el)
        el.textContent = val || '—'; };
    set('repo-vd-name', repo.name || '—');
    set('repo-vd-author', repo.author || t('common.unknown') || 'Inconnu');
    void decorateAuthorLink(document.getElementById('repo-vd-author'), repo.author_id);
    // t() first: an OvGME-imported profile stores its game as an i18n KEY (so every
    // language renders its own text), and a repo generated from it carries that key in
    // game_name. Line ~845 below always did this; these two sites forgot, and the sync
    // card showed PROF.IMPORTSOURCEOVGME raw — photographed in the field. A real game
    // name is not a known key, and t() returns unknown inputs unchanged.
    set('repo-vd-game', (repo.game_name && (t(repo.game_name) || repo.game_name)) || '—');
    set('repo-vd-profiles', String(totalProfs));
    set('repo-vd-mods', String(totalMods));
    set('repo-vd-desc', repo.description || '—');
    // Signature box
    const sigBox = document.getElementById('repo-vd-sig-box');
    const sigIcon = document.getElementById('repo-vd-sig-icon');
    const sigTitle = document.getElementById('repo-vd-sig-title');
    const sigDesc = document.getElementById('repo-vd-sig-desc');
    if (sigBox && sigIcon && sigTitle && sigDesc) {
        sigBox.removeAttribute('style');
        sigBox.className = `rp-sig rp-tone--${ui.tone}`;
        sigIcon.className = 'rp-sig-ic';
        sigIcon.innerHTML = uiIcon(ui.icon, 16);
        sigTitle.removeAttribute('style');
        sigTitle.className = 'rp-sig-t';
        sigDesc.removeAttribute('style');
        sigDesc.className = 'rp-sig-d';
        sigTitle.textContent = t(ui.title);
        sigDesc.textContent = t(ui.desc);
    }
    modal.classList.add('open');
}
export function initRepoSync(elements) {
    initSyncPasswordField();
    initSyncKeyAndSshFields();
    // Lets the launch-time check hand this screen a repo: the toast says "N mods to
    // update", and the form behind it is already filled in for that repo and mode.
    registerRepoSyncOpener((url, mode) => {
        const input = document.getElementById('repo-sync-url');
        if (input)
            input.value = url;
        const modeSel = document.getElementById('repo-sync-mode');
        if (modeSel)
            modeSel.value = mode === 'all' ? 'all' : 'missing';
        const auto = document.getElementById('repo-sync-auto-check');
        if (auto)
            auto.checked = true;
    });
    // The SSH shortcut button used to live here. Removed: it wrote `ssh://` into the field
    // and fetched, which is one keystroke saved for a value you only ever use when you already
    // know you want it — and it sat among four buttons that do quite different things. The
    // server picker below the field covers the same ground and says which server.
    // Persisted on change rather than on sync: a user who ticks this and never syncs still
    // meant it, and losing the setting would look like the checkbox does nothing.
    document.getElementById('repo-sync-auto-check')?.addEventListener('change', (e) => {
        const on = e.target.checked;
        const url = document.getElementById('repo-sync-url')?.value?.trim();
        if (!url)
            return;
        const mode = document.getElementById('repo-sync-mode')?.value || 'missing';
        invoke('set_repo_auto_sync', { url, enabled: on, mode }).catch((err) => toast(String(err), 'error'));
    });
    const { inputSyncUrl, inputSyncGamePath, inputSyncModsPath, inputSyncBackupPath, btnStartSync, syncProgressContainer, syncStatus, syncPercent, syncFill, syncDetails, btnPauseSync, btnCancelSync, pauseText, pausedBadge, inputSyncDownloadLimit, btnFetchInfo, syncInfoCard, syncBadge, syncGameBadge, syncNameDisplay, syncAuthorDisplay, syncDescDisplay, btnClearFetchedRepo, profilesSelectionEl, syncPathsSection, syncUrlCard } = elements;
    const updateSyncPathsVisibility = () => {
        const sec = document.getElementById('repo-sync-paths-section');
        if (!sec)
            return;
        // Paths are only needed when creating a NEW profile. When syncing into an
        // existing local profile (incl. "Autre profil"), BMM reuses that profile's
        // own game/mods/backup paths — no manual paths required.
        const anyNew = Array.from(document.querySelectorAll('.repo-sync-choice-cb:checked'))
            .some((cb) => cb.value === 'NEW');
        sec.style.display = anyNew ? 'block' : 'none';
        const hint = document.getElementById('repo-sync-paths-existing-hint');
        if (hint)
            hint.style.display = (!anyNew && document.querySelectorAll('.repo-sync-choice-cb:checked').length > 0) ? 'block' : 'none';
        updateSyncTotalSize();
    };
    const updateSyncTotalSize = () => {
        const totalSizeEl = document.getElementById('repo-sync-total-size');
        if (!totalSizeEl || !lastFetchedRepo)
            return;
        const checkedBoxes = document.querySelectorAll('.repo-sync-choice-cb:checked');
        let total = 0;
        checkedBoxes.forEach(cb => {
            const profileId = cb.dataset.repoProfileId;
            const profile = lastFetchedRepo.profiles.find(p => p.id === profileId);
            if (profile && profile.mods) {
                profile.mods.forEach(m => {
                    if (m.files) {
                        m.files.forEach(f => total += f.size);
                    }
                });
            }
        });
        if (total > 0) {
            totalSizeEl.textContent = (t('repo.totalSize') || "Taille totale :") + " " + formatBytes(total);
        }
        else {
            totalSizeEl.textContent = "";
        }
    };
    if (btnFetchInfo) {
        btnFetchInfo.addEventListener('click', async () => {
            const url = inputSyncUrl.value.trim();
            if (!url)
                return toast(t('repo.errNoUrl'), 'warning');
            try {
                btnFetchInfo.disabled = true;
                // A password typed up front seeds the session store the 401 retry path
                // already uses — same variable, so the prompt never re-asks for a value
                // the user has already given. Empty field = leave whatever the session
                // learned earlier (a prompt answer must survive a re-fetch).
                const typedPw = document.getElementById('repo-sync-password')?.value?.trim();
                if (typedPw)
                    setRepoPassword(typedPw);
                let repo = await fetchRepoInfoWithPassword(url, null);
                let saltedCreatorId = null;
                if (repo.seed) {
                    saltedCreatorId = await invoke('get_salted_creator_id', { salt: repo.seed });
                    lastFetchedRepoSaltedId = saltedCreatorId;
                    repo = await fetchRepoInfoWithPassword(url, saltedCreatorId);
                }
                if (window.saveClientHistory)
                    window.saveClientHistory(url, repo);
                lastFetchedRepo = repo;
                // Telemetry (opt-in): record which server repos users connect to so
                // the team can map the community. Localhost/private IPs are filtered
                // out server-side. Sends the repo link + host (geolocated by the dash).
                try {
                    const { track } = await import('../../core/analytics.js');
                    let host = '';
                    try {
                        host = new URL(url.replace(/\/repo\.json$/i, '')).host;
                    }
                    catch { }
                    track('repo_connect', { url, host, repo_name: repo?.name || repo?.game_name || undefined });
                }
                catch { }
                // 1. Self-signature check: is the repo validly signed by its author?
                const selfSigned = await invoke('verify_repo_signature', { repo });
                // 2. The official list's pin, if this URL is in it: the same value the sync
                //    passes as expectedSignature, so card and backend judge with one input.
                const pin = expectedRepoSignature(url);
                const sigState = repoSignatureState(repo, !!selfSigned, pin);
                syncInfoCard.style.display = 'block';
                syncNameDisplay.textContent = repo.name;
                syncAuthorDisplay.textContent = (t('repo.authorShort') || "Auteur :") + " " + (repo.author || "Inconnu");
                void decorateAuthorLink(syncAuthorDisplay, repo.author_id);
                // A manifest synthesised from the server's directory listing (no repo.json
                // found — fetch_repo_info built one from what it saw). The card must SAY so,
                // not just carry the generic Unverified badge: the badge also covers "signed
                // but the signature failed", and those two situations call for different
                // levels of trust. Recognised by the marker profile id the fallback writes.
                const discovered = repo.profiles?.length === 1 && repo.profiles[0]?.id === 'discovered';
                syncDescDisplay.textContent = discovered
                    ? (t('repo.discoveredDesc') || 'No repo.json on this server — this list was read from its folder index. Nothing vouches for these files: they will install as unverified.')
                    : (repo.description || "");
                syncDescDisplay.style.color = discovered ? 'var(--warning)' : '';
                syncGameBadge.textContent = repo.game_name ? (t(repo.game_name) || repo.game_name) : '';
                // The chip, the panel under the description and the Sync button all say the
                // one state; the detail dialog opens from the chip or the panel's button.
                syncBadge._repoRef = repo;
                paintSignature(sigState, !!pin);
                if (profilesSelectionEl && repo.profiles) {
                    profilesSelectionEl.innerHTML = `<div class="rp-pick-h">${escHtml(t('repo.selectSyncTasks'))}</div>`;
                    const localProfiles = await invoke('get_profiles');
                    repo.profiles.forEach(rp => {
                        const rpSizeTotal = rp.mods.reduce((acc, m) => acc + (m.files ? m.files.reduce((a, f) => a + f.size, 0) : 0), 0);
                        // Classes (repo-page.css), not inline washes: rgba(255,255,255,…) was
                        // white on white under BMM White, and the group vanished.
                        const group = document.createElement('div');
                        group.className = 'rp-pick';
                        const title = document.createElement('div');
                        title.className = 'rp-pick-title';
                        title.innerHTML = `
                            <span class="rp-pick-name">${escHtml(rp.name)}</span>
                            <span class="rp-pick-meta">${escHtml(t('modpack.modsCount', { count: rp.mods?.length || 0 }))} · ${formatBytes(rpSizeTotal)}</span>
                        `;
                        group.appendChild(title);
                        const optionsContainer = document.createElement('div');
                        optionsContainer.className = 'rp-pick-opts';
                        const addOption = (label, value, checked = false) => {
                            const row = document.createElement('label');
                            row.className = 'rp-pick-opt';
                            const cb = document.createElement('input');
                            cb.type = 'checkbox';
                            cb.value = value;
                            cb.dataset.repoProfileId = rp.id;
                            cb.className = 'repo-sync-choice-cb';
                            cb.checked = checked;
                            cb.addEventListener('change', updateSyncPathsVisibility);
                            row.appendChild(cb);
                            row.appendChild(document.createTextNode(label));
                            optionsContainer.appendChild(row);
                        };
                        addOption(t('repo.syncNew'), "NEW", !localProfiles.some(lp => lp.origin_repo_profile_id === rp.id));
                        const matches = localProfiles.filter(lp => lp.origin_repo_profile_id === rp.id);
                        matches.forEach(m => {
                            addOption(`${t('repo.syncUpdate')} ${m.name}`, m.id, true);
                        });
                        if (localProfiles.length > matches.length) {
                            const selectRow = document.createElement('div');
                            selectRow.className = 'rp-pick-other';
                            const selectLabel = document.createElement('span');
                            selectLabel.className = 'rp-pick-other-l';
                            selectLabel.textContent = (t('repo.syncOther') || 'Autre profil :');
                            const select = document.createElement('select');
                            select.className = 'form-input select-sm repo-sync-manual-select';
                            select.setAttribute('aria-label', t('repo.selectLocal'));
                            select.innerHTML = `<option value="">${escHtml(t('repo.selectLocal'))}</option>` +
                                localProfiles.map(lp => `<option value="${escHtml(lp.id)}">${escHtml(lp.name)}</option>`).join('');
                            const cb = document.createElement('input');
                            cb.type = 'checkbox';
                            cb.dataset.repoProfileId = rp.id;
                            cb.className = 'repo-sync-choice-cb manual-sync-cb';
                            cb.setAttribute('aria-label', t('repo.syncOther'));
                            select.onchange = () => {
                                cb.checked = !!select.value;
                                cb.value = select.value;
                                updateSyncPathsVisibility();
                            };
                            selectRow.appendChild(cb);
                            selectRow.appendChild(selectLabel);
                            selectRow.appendChild(select);
                            optionsContainer.appendChild(selectRow);
                        }
                        group.appendChild(optionsContainer);
                        // ── Per-mod selection ──────────────────────────────
                        if (rp.mods && rp.mods.length > 0) {
                            const modSection = document.createElement('details');
                            modSection.className = 'rp-pick-mods';
                            const summary = document.createElement('summary');
                            summary.className = 'rp-pick-mods-h';
                            const sumTxt = document.createElement('span');
                            sumTxt.textContent = t('repo.selectMods') || 'Choisir les mods';
                            const sumCount = document.createElement('span');
                            sumCount.className = 'rp-count';
                            summary.appendChild(sumTxt);
                            summary.appendChild(sumCount);
                            modSection.appendChild(summary);
                            // Select all / none buttons
                            const modToolbar = document.createElement('div');
                            modToolbar.className = 'rp-pick-tools';
                            const makeSmallBtn = (label, onClick) => {
                                const b = document.createElement('button');
                                b.type = 'button';
                                b.className = 'btn btn-secondary btn-xs';
                                b.textContent = label;
                                b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
                                return b;
                            };
                            const modCheckboxes = [];
                            // "12 / 40": how many will download, on the fold itself, so a
                            // narrowed selection is visible without opening it.
                            const recount = () => {
                                const on = modCheckboxes.filter(c => c.checked).length;
                                sumCount.textContent = `${on} / ${modCheckboxes.length}`;
                            };
                            // Select all / none act on what is SHOWN, not on everything.
                            //
                            // With a filter typed, "Select all" meaning all four hundred is
                            // the opposite of what somebody who just narrowed the list means
                            // by it, and it is silent, so they would find out at download.
                            const visible = () => modCheckboxes.filter((c) => {
                                const row = c.closest('label');
                                return !row || !row.hidden;
                            });
                            modToolbar.appendChild(makeSmallBtn(t('common.selectAll') || 'Tout', () => { visible().forEach(c => c.checked = true); recount(); }));
                            modToolbar.appendChild(makeSmallBtn(t('common.unselectAll') || 'None', () => { visible().forEach(c => c.checked = false); recount(); }));
                            // A search box, for the profile with two hundred mods in it.
                            //
                            // It FILTERS rather than re-rendering: a tick is state that lives
                            // in the DOM here, and rebuilding the rows would silently reset
                            // every choice made before the search. A hidden row's checkbox is
                            // still in the form and still counts, which is what keeps
                            // "everything is ticked by default" true while you are looking at
                            // three of them.
                            const findWrap = document.createElement('label');
                            findWrap.className = 'rp-find';
                            findWrap.innerHTML = uiIcon('search', 12);
                            const find = document.createElement('input');
                            find.type = 'search';
                            find.placeholder = t('repo.sync.findMod');
                            find.setAttribute('aria-label', t('repo.sync.findMod'));
                            find.spellcheck = false;
                            findWrap.appendChild(find);
                            const found = document.createElement('span');
                            found.className = 'rp-find-n';
                            found.setAttribute('aria-live', 'polite');
                            const noHit = document.createElement('div');
                            noHit.className = 'rp-pick-none';
                            noHit.hidden = true;
                            noHit.textContent = t('repo.sync.noModMatch');
                            find.addEventListener('input', () => {
                                const q = find.value.trim().toLowerCase();
                                let n = 0;
                                for (const cb of modCheckboxes) {
                                    const row = cb.closest('label');
                                    if (!row)
                                        continue;
                                    const hit = !q || (row.dataset.find || '').includes(q);
                                    row.hidden = !hit;
                                    if (hit)
                                        n += 1;
                                }
                                found.textContent = q ? `${n}/${modCheckboxes.length}` : '';
                                noHit.hidden = n > 0;
                            });
                            modToolbar.appendChild(findWrap);
                            modToolbar.appendChild(found);
                            modSection.appendChild(modToolbar);
                            const modList = document.createElement('div');
                            modList.className = 'rp-pick-list';
                            rp.mods.forEach(mod => {
                                const modSize = mod.files ? mod.files.reduce((a, f) => a + f.size, 0) : 0;
                                const row = document.createElement('label');
                                row.className = 'rp-pick-row';
                                // What the search matches on, lowercased once here rather than
                                // on every keystroke for every row.
                                row.dataset.find = String(mod.name || '').toLowerCase();
                                const cb = document.createElement('input');
                                cb.type = 'checkbox';
                                cb.checked = true;
                                cb.dataset.repoProfileId = rp.id;
                                cb.dataset.modId = mod.id;
                                cb.className = 'repo-sync-mod-cb';
                                cb.addEventListener('change', recount);
                                modCheckboxes.push(cb);
                                const nameSpan = document.createElement('span');
                                nameSpan.className = 'rp-pick-row-n';
                                nameSpan.textContent = mod.name;
                                nameSpan.title = mod.name;
                                const sizeSpan = document.createElement('span');
                                sizeSpan.className = 'rp-pick-row-s';
                                sizeSpan.textContent = formatBytes(modSize);
                                row.appendChild(cb);
                                row.appendChild(nameSpan);
                                row.appendChild(sizeSpan);
                                modList.appendChild(row);
                            });
                            recount();
                            modSection.appendChild(modList);
                            modSection.appendChild(noHit);
                            group.appendChild(modSection);
                        }
                        profilesSelectionEl.appendChild(group);
                    });
                    // ── Modpacks selection ──────────────────────────────
                    if (repo.modpacks && repo.modpacks.length > 0) {
                        const mpGroup = document.createElement('div');
                        mpGroup.className = 'repo-sync-profile-group rp-pick';
                        mpGroup.innerHTML = `<div class="rp-pick-title"><span class="rp-pick-name">${uiIcon('box', 14)}<span>${escHtml(t('modpack.sharedModpacks') || 'Modpacks Partagés')}</span></span><span class="rp-count">${repo.modpacks.length}</span></div>`;
                        const mpList = document.createElement('div');
                        mpList.className = 'rp-pick-list rp-pick-list--packs';
                        repo.modpacks.forEach(mpShare => {
                            const mp = mpShare.modpack;
                            const item = document.createElement('label');
                            item.className = 'repo-modpack-item rp-pick-row';
                            const cb = document.createElement('input');
                            cb.type = 'checkbox';
                            cb.className = 'repo-sync-modpack-cb';
                            cb.dataset.modpack = JSON.stringify(mp);
                            cb.checked = true;
                            const name = document.createElement('span');
                            name.className = 'rp-pick-row-n';
                            name.textContent = mp.name;
                            const meta = document.createElement('span');
                            meta.className = 'rp-pick-row-s';
                            meta.textContent = t('modpack.modsCount', { count: mp.mods?.length || 0 });
                            item.appendChild(cb);
                            item.appendChild(name);
                            item.appendChild(meta);
                            mpList.appendChild(item);
                        });
                        mpGroup.appendChild(mpList);
                        profilesSelectionEl.appendChild(mpGroup);
                    }
                    // ── Everything else the repo carries ───────────────────
                    // Plugins, automations, themes, mod lists, catalogues to follow. Draws
                    // nothing when the repo carries none, which is every repo published
                    // before this existed.
                    const { renderRepoExtras } = await import('./repo-extras.js');
                    renderRepoExtras(repo.extras, profilesSelectionEl);
                    updateSyncPathsVisibility();
                }
                // Connecting to a repo → proactively detect updates for mods we
                // already have installed from it (or any tracked repo). Silent so
                // it never nags when everything is current; opens the modal if any
                // update is found.
                checkModUpdates(true).catch(() => { });
            }
            catch (err) {
                const errMsg = String(err);
                fireEvent('bmm.repo.syncFailed', { url: String(url || ''), error: errMsg.slice(0, 400) });
                // Handle common connection errors more gracefully
                if (errMsg.includes('tcp connect error') || errMsg.includes('connection refused')) {
                    toast(t('repo.errConnection') || 'Unable to connect to server. Check the URL and ensure the server is running.', 'error');
                }
                else if (errMsg.includes('invalid port')) {
                    toast(t('repo.errInvalidPort') || 'Invalid port number in URL.', 'error');
                }
                else if (errMsg.includes('repo.errInvalidRepo')) {
                    toast(t('repo.errInvalidRepo') || 'Invalid repository format.', 'error');
                }
                else {
                    toast(t(errMsg) || errMsg, 'error');
                }
            }
            finally {
                btnFetchInfo.disabled = false;
            }
        });
    }
    if (btnClearFetchedRepo) {
        btnClearFetchedRepo.addEventListener('click', () => {
            syncInfoCard.style.display = 'none';
            lastFetchedRepo = null;
            paintSignature('');
            if (profilesSelectionEl)
                profilesSelectionEl.innerHTML = '';
            const totalSizeEl = document.getElementById('repo-sync-total-size');
            if (totalSizeEl)
                totalSizeEl.textContent = '';
            updateSyncPathsVisibility();
        });
    }
    if (btnStartSync) {
        btnStartSync.addEventListener('click', async () => {
            const url = inputSyncUrl.value.trim();
            if (!url)
                return toast(t('repo.errNoUrl'), 'warning');
            const gameDir = inputSyncGamePath ? inputSyncGamePath.value.trim() : '';
            const modsDir = inputSyncModsPath ? inputSyncModsPath.value.trim() : '';
            const backupDir = inputSyncBackupPath ? inputSyncBackupPath.value.trim() : '';
            // Paths are only required when creating a NEW profile. When syncing into
            // existing profiles only, the Rust side reuses each profile's own paths.
            const anyNew = Array.from(document.querySelectorAll('.repo-sync-choice-cb:checked'))
                .some((cb) => cb.value === 'NEW');
            if (anyNew && (!gameDir || !modsDir || !backupDir)) {
                toast(t('repo.errSyncFolders'), 'warning');
                return;
            }
            const selectedBoxes = document.querySelectorAll('.repo-sync-choice-cb:checked');
            const choices = Array.from(selectedBoxes).map(cb => {
                const profileId = cb.dataset.repoProfileId;
                // Collect selected mod IDs for this profile
                const modCbs = document.querySelectorAll(`.repo-sync-mod-cb[data-repo-profile-id="${profileId}"]`);
                const allModCbs = Array.from(modCbs);
                const selectedModIds = allModCbs.length > 0
                    ? allModCbs.filter(m => m.checked).map(m => m.dataset.modId)
                    : null; // null = all mods
                return {
                    repoProfileId: profileId,
                    targetLocalProfileId: cb.value === 'NEW' ? null : cb.value,
                    selectedModIds: selectedModIds,
                };
            });
            if (choices.length === 0)
                return toast(t('repo.errNoSelection'), 'warning');
            let unlisten;
            try {
                // Mark the API guard busy so external API sync calls are rejected.
                try {
                    invoke('set_repo_busy', { kind: 'sync', busy: true });
                }
                catch (_) { }
                btnStartSync.disabled = true;
                syncProgressContainer.style.display = 'block';
                syncStatus.textContent = t('repo.syncing') || "Synchronisation...";
                syncPercent.textContent = "0%";
                syncFill.style.width = "0%";
                syncDetails.textContent = t('repo.syncStarting');
                toast(t('repo.syncStarted') || "Synchronization started", "info");
                if (btnPauseSync)
                    btnPauseSync.style.display = 'flex';
                if (btnCancelSync) {
                    btnCancelSync.style.display = 'flex';
                    btnCancelSync.disabled = false;
                }
                if (window.__TAURI__) {
                    const { listen } = window.__TAURI__.event;
                    unlisten = await listen('bmm://repo-sync-progress', (event) => {
                        const { step, progress, current_file } = event.payload;
                        if (progress !== undefined) {
                            const pct = Math.min(Math.round(progress), 100);
                            syncPercent.textContent = `${pct}%`;
                            syncFill.style.width = `${pct}%`;
                        }
                        if (step) {
                            if (step.startsWith('{')) {
                                try {
                                    const data = JSON.parse(step);
                                    syncStatus.textContent = t(data.key, data);
                                }
                                catch (e) {
                                    syncStatus.textContent = t(step) || step;
                                }
                            }
                            else {
                                syncStatus.textContent = t(step) || step;
                            }
                        }
                        if (current_file)
                            syncDetails.textContent = current_file;
                    });
                }
                // Repo owner requires a BetterCommunity login to download. Enforced in
                // the client for normal users (a hardened server-side proof is a follow-up).
                if ((lastFetchedRepo?.require_login || lastFetchedRepo?.requireLogin) && !(await isBcLinked())) {
                    toast(t('repo.requireLogin.blocked') || 'This repo requires a BetterCommunity account — sign in from Settings to download.', 'error');
                    return;
                }
                const finalCreatorId = lastFetchedRepoSaltedId || await invoke('get_creator_id');
                const syncMode = document.getElementById('repo-sync-mode')?.value || 'missing';
                const cleanExtra = document.getElementById('repo-sync-clean-extra')?.checked || false;
                const downloadLimit = parseInt(inputSyncDownloadLimit ? inputSyncDownloadLimit.value : "0") || 0;
                // Zipped mods: keep them as .zip archives, or extract them. Default = extract.
                const keepZipped = document.getElementById('repo-sync-keep-zipped')?.checked || false;
                // Defaults ON, and the element may not exist in older markup — so read it as
                // "not explicitly unticked" rather than "ticked", or a missing checkbox would
                // silently turn the option off.
                const addRepoSourceEl = document.getElementById('repo-sync-add-repo-source');
                const addRepoSource = addRepoSourceEl ? addRepoSourceEl.checked : true;
                // The same resolution as the manifest fetch above: one rule, so the
                // profile list and the files it installs can never come from two places.
                const sshSource = await sshSourceOrNull(url);
                const summary = await invoke('sync_server_repo', {
                    args: {
                        url, creatorId: finalCreatorId, gameDir, modsDir, backupDir, choices,
                        ...(sshSource ? { ssh: sshSource } : {}),
                        overwriteAll: syncMode === 'all', deleteExtra: cleanExtra, downloadLimit,
                        unzipArchives: !keepZipped, password: lastRepoPassword,
                        addRepoAsUpdateSource: addRepoSource,
                        expectedSignature: expectedRepoSignature(url),
                    }
                });
                // The extras, AFTER the mods. A plugin that drives a profile is useless
                // before the profile is there, and a failure here must not be able to
                // abandon a sync that already succeeded — which is why it is its own try.
                try {
                    const { installSelectedExtras } = await import('./repo-extras.js');
                    await installSelectedExtras(document.body, url, {
                        creatorId: finalCreatorId,
                        password: lastRepoPassword,
                    });
                }
                catch (e) {
                    console.error('[repo] extras:', e);
                }
                // Import modpacks if selected
                const modpackCbs = document.querySelectorAll('.repo-sync-modpack-cb:checked');
                for (const cb of modpackCbs) {
                    try {
                        const mp = JSON.parse(cb.dataset.modpack);
                        await invoke('save_modpack', { modpack: mp });
                    }
                    catch (e) {
                        console.error("Failed to import modpack:", e);
                    }
                }
                showSyncSummary(summary);
                fireEvent('bmm.repo.synced', { url: String(url || '') });
                syncStatus.textContent = t('repo.syncDone');
                toast(t('repo.syncSuccess') || "Synchronization completed successfully", "success");
                syncPercent.textContent = "100%";
                syncFill.style.width = "100%";
                syncDetails.textContent = t('repo.syncComplete');
                toast(t('repo.syncSuccess'), 'success');
                if (window._refreshModsFn)
                    window._refreshModsFn(true);
                await renderProfiles();
                updateLibraryProfileSelector();
            }
            catch (err) {
                const errMsg = String(err);
                if (errMsg.includes("Synchronisation annulée")) {
                    syncStatus.textContent = t('repo.syncCancelled');
                    syncPercent.textContent = "0%";
                    syncFill.style.width = "0%";
                    toast(t('repo.syncCancelled'), 'info');
                }
                else {
                    syncStatus.textContent = t('repo.syncError') || "Sync error";
                    toast(t(errMsg) || errMsg, 'error');
                    // A signature refusal is a state of the repo, not a passing error: the
                    // card keeps saying it (and why) after the toast is gone.
                    const refused = /repo\.errSignature(Invalid|Missing|Mismatch)/.exec(errMsg);
                    if (refused)
                        paintSignature(refused[1].toLowerCase());
                }
            }
            finally {
                btnStartSync.disabled = false;
                if (unlisten)
                    unlisten();
                if (btnPauseSync) {
                    btnPauseSync.style.display = 'none';
                    pausedBadge.style.display = 'none';
                    pauseText.textContent = "Pause";
                }
                if (btnCancelSync)
                    btnCancelSync.style.display = 'none';
                // Release the API "sync in progress" guard.
                try {
                    invoke('set_repo_busy', { kind: 'sync', busy: false });
                }
                catch (_) { }
            }
        });
    }
    if (btnPauseSync) {
        btnPauseSync.addEventListener('click', async () => {
            const isPaused = pausedBadge.style.display === 'block';
            try {
                if (isPaused) {
                    await invoke('resume_repo_sync');
                    pausedBadge.style.display = 'none';
                    pauseText.textContent = t('repo.pauseSync');
                    btnPauseSync.innerHTML = `${uiIcon('pause', 12)} <span>${t('repo.pauseSync')}</span>`;
                }
                else {
                    await invoke('pause_repo_sync');
                    pausedBadge.style.display = 'block';
                    pauseText.textContent = t('repo.resumeSync');
                    btnPauseSync.innerHTML = `${uiIcon('play', 12)} <span>${t('repo.resumeSync')}</span>`;
                }
            }
            catch (err) {
                toast(t('repo.syncError') + err, 'error');
            }
        });
    }
    if (btnCancelSync) {
        btnCancelSync.addEventListener('click', async () => {
            try {
                await invoke('cancel_repo_sync');
                toast(t('repo.syncCancelled') || "Canceling...", 'info');
                btnCancelSync.disabled = true;
            }
            catch (err) {
                toast(t('common.error') + ': ' + err, 'error');
            }
        });
    }
    // ── Verification badge → detail modal ──────────────────────────────────
    if (syncBadge) {
        syncBadge.addEventListener('click', () => {
            const repo = syncBadge._repoRef;
            if (!repo)
                return;
            _openRepoVerifyDetail(repo, currentSigState || 'unsigned');
        });
        syncBadge.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                syncBadge.click();
            }
        });
    }
    // The panel's "Details" button opens the same dialog as the chip.
    if (syncInfoCard && syncBadge) {
        syncInfoCard.addEventListener('click', (e) => {
            if (e.target.closest('[data-rp-sig-details]'))
                syncBadge.click();
        });
    }
    // Close verification modal
    document.getElementById('btn-close-repo-verify-detail')?.addEventListener('click', () => {
        document.getElementById('modal-repo-verify-detail')?.classList.remove('open');
    });
    document.getElementById('modal-repo-verify-detail')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('modal-repo-verify-detail')) {
            document.getElementById('modal-repo-verify-detail')?.classList.remove('open');
        }
    });
    return {
        updateSyncTotalSize,
        updateSyncPathsVisibility
    };
}
export function showSyncSummary(summary) {
    const body = document.getElementById('repo-sync-summary-body');
    const modal = document.getElementById('modal-repo-sync-summary');
    if (!body || !modal)
        return;
    if (!summary || !summary.profiles || summary.profiles.length === 0) {
        // "Nothing to do" is a result, not an absence — say what was checked and what it means.
        body.innerHTML = `<div class="empty-state" style="padding:22px 12px;">
            <div class="empty-icon" style="opacity:.55;color:var(--success);">${uiIcon('check', 32)}</div>
            <p class="empty-title" style="font-size:13px;">${escHtml(t('repo.noChanges'))}</p>
            <p class="empty-desc" style="font-size:11.5px;">${escHtml(t('repo.noChangesHint') || 'Every mod in this repo matches what you already have — nothing to download, nothing to remove.')}</p>
        </div>`;
    }
    else {
        // One card per profile: three counted outcomes and what crossed the wire. Classes in
        // repo-page.css (the old inline washes were black holes under BMM White).
        body.innerHTML = summary.profiles.map(p => `
            <div class="rp-sum">
                <div class="rp-sum-h">${uiIcon('profile', 14)}<span>${escHtml(p.name)}</span></div>
                <div class="rp-sum-grid">
                    <div class="rp-sum-tile rp-tone--ok"><b>${Number(p.mods_added) || 0}</b><span>${escHtml(t('repo.summaryAdded'))}</span></div>
                    <div class="rp-sum-tile rp-tone--info"><b>${Number(p.mods_updated) || 0}</b><span>${escHtml(t('repo.summaryUpdated'))}</span></div>
                    <div class="rp-sum-tile rp-tone--bad"><b>${Number(p.mods_removed) || 0}</b><span>${escHtml(t('repo.summaryRemoved'))}</span></div>
                    <div class="rp-sum-tile"><b>${formatBytes(p.bytes_downloaded)}</b><span>${Number(p.files_downloaded) || 0} ${escHtml(t('repo.summaryFiles') || 'files')}</span></div>
                </div>
            </div>
        `).join('');
    }
    // Synced, but nothing vouches for what came down: say so on the result too, not only on
    // the badge before it (check_repo_signature; a signature that FAILED never gets here).
    if (summary?.signature === 'unsigned') {
        body.insertAdjacentHTML('beforeend', `<div class="rp-sig rp-tone--warn"><span class="rp-sig-ic">${uiIcon('shield', 16)}</span><span class="rp-sig-txt"><b class="rp-sig-t">${escHtml(t('repo.sig.unsigned'))}</b><span class="rp-sig-d">${escHtml(t('repo.summaryUnsigned'))}</span></span></div>`);
    }
    modal.classList.add('open');
}
//# sourceMappingURL=repo-sync.js.map