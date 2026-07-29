// @ts-nocheck
import { invoke } from '../../core/api.js';
import { toast, updateLibraryProfileSelector } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { renderProfiles } from '../profiles/profiles.js';
import { formatBytes } from '../../core/utils.js';
import { checkModUpdates } from './mod-updates.js';
import { getLinks } from '../../core/links-config.js';
let lastFetchedRepo = null;
let lastFetchedRepoSaltedId = null;
// Download password for a password-protected self-hosted repo. The host sets an optional
// DOWNLOAD_PASSWORD on the mini-server; content requests then need `X-Repo-Password`.
// We remember what the user typed for this session so the follow-up fetch + the sync reuse it.
let lastRepoPassword = null;
// Small themed modal that asks the subscriber for the repo's download password.
// Resolves to the entered string, or null if the user cancels.
function promptRepoPassword() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);';
        const box = document.createElement('div');
        box.style.cssText = 'background:var(--bg-secondary,#1b1b1f);border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:12px;padding:22px;width:min(90vw,380px);box-shadow:0 20px 60px rgba(0,0,0,0.5);';
        const title = document.createElement('div');
        title.textContent = t('repo.passwordPrompt.title') || 'Password required';
        title.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:6px;color:var(--text-primary,#fff);';
        const desc = document.createElement('div');
        desc.textContent = t('repo.passwordPrompt.desc') || 'This repository is protected. Enter its download password to continue.';
        desc.style.cssText = 'font-size:12px;color:var(--text-secondary,#aaa);margin-bottom:14px;line-height:1.4;';
        const input = document.createElement('input');
        input.type = 'password';
        input.autocomplete = 'off';
        input.placeholder = t('repo.passwordPrompt.placeholder') || 'Download password';
        input.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;border-radius:8px;border:1px solid var(--border,rgba(255,255,255,0.15));background:var(--bg-primary,#111);color:var(--text-primary,#fff);font-size:13px;margin-bottom:16px;';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
        const cancel = document.createElement('button');
        cancel.textContent = t('common.cancel') || 'Cancel';
        cancel.style.cssText = 'padding:8px 14px;border-radius:8px;border:1px solid var(--border,rgba(255,255,255,0.15));background:transparent;color:var(--text-secondary,#ccc);cursor:pointer;font-size:13px;';
        const ok = document.createElement('button');
        ok.textContent = t('common.confirm') || 'Confirm';
        ok.style.cssText = 'padding:8px 14px;border-radius:8px;border:none;background:var(--accent,#5b8def);color:var(--bmm-text-on-accent);cursor:pointer;font-size:13px;font-weight:600;';
        const done = (val) => { try {
            overlay.remove();
        }
        catch { } resolve(val); };
        cancel.onclick = () => done(null);
        ok.onclick = () => done(input.value);
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                done(input.value);
            }
            else if (ev.key === 'Escape') {
                ev.preventDefault();
                done(null);
            }
        });
        row.append(cancel, ok);
        box.append(title, desc, input, row);
        overlay.append(box);
        document.body.append(overlay);
        setTimeout(() => input.focus(), 30);
    });
}
// Pre-seed the session download password (e.g. from a deeplink / API-driven sync that
// already carries it), so the auto-driven fetch doesn't have to prompt the user.
export function setRepoPassword(pw) { lastRepoPassword = pw && pw.length ? pw : null; }
// fetch_repo_info, but transparently handling a password-protected repo: on the
// `repo.errPasswordRequired` signal from the backend, ask the user once, remember it
// for this session, and retry. Cancelling re-throws so the caller's normal error path runs.
async function fetchRepoInfoWithPassword(url, creatorId) {
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
// ── Repo verification detail modal ───────────────────────────────────────────
// reason: optional override describing WHY verification failed.
//   'mismatch'  → live repo signature differs from the BMM-recorded one
//   'unsigned'  → no/invalid self-signature (default)
function _openRepoVerifyDetail(repo, isVerified, reason) {
    const modal = document.getElementById('modal-repo-verify-detail');
    if (!modal)
        return;
    const totalMods = repo.profiles ? repo.profiles.reduce((n, p) => n + (p.mods?.length || 0), 0) : 0;
    const totalProfs = repo.profiles ? repo.profiles.length : 0;
    // Status icon & label
    const statusIcon = document.getElementById('repo-vd-status-icon');
    const statusLabel = document.getElementById('repo-vd-status-label');
    if (statusIcon) {
        statusIcon.style.background = isVerified ? 'rgba(46,204,113,0.15)' : 'rgba(231,76,60,0.15)';
        statusIcon.style.border = isVerified ? '1px solid rgba(46,204,113,0.3)' : '1px solid rgba(231,76,60,0.3)';
        statusIcon.innerHTML = isVerified
            ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
            : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    }
    if (statusLabel) {
        statusLabel.textContent = isVerified ? (t('repo.verified') || 'Vérifié') : (t('repo.unverified') || 'Non vérifié');
        statusLabel.style.color = isVerified ? '#2ecc71' : '#e74c3c';
    }
    // Fields
    const set = (id, val) => { const el = document.getElementById(id); if (el)
        el.textContent = val || '—'; };
    set('repo-vd-name', repo.name || '—');
    set('repo-vd-author', repo.author || t('common.unknown') || 'Inconnu');
    set('repo-vd-game', repo.game_name || '—');
    set('repo-vd-profiles', String(totalProfs));
    set('repo-vd-mods', String(totalMods));
    set('repo-vd-desc', repo.description || '—');
    // Signature box
    const sigBox = document.getElementById('repo-vd-sig-box');
    const sigIcon = document.getElementById('repo-vd-sig-icon');
    const sigTitle = document.getElementById('repo-vd-sig-title');
    const sigDesc = document.getElementById('repo-vd-sig-desc');
    if (sigBox && sigIcon && sigTitle && sigDesc) {
        sigBox.style.borderColor = isVerified ? 'rgba(46,204,113,0.25)' : 'rgba(231,76,60,0.2)';
        sigBox.style.background = isVerified ? 'rgba(46,204,113,0.06)' : 'rgba(231,76,60,0.06)';
        sigIcon.innerHTML = isVerified
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
        if (isVerified) {
            sigTitle.textContent = t('repo.verifyDetail.sigOk') || 'Signature Ed25519 valide';
            sigDesc.textContent = t('repo.verifyDetail.sigOkDesc') || "Le contenu de ce dépôt a été signé par l'auteur et n'a pas été altéré.";
        }
        else if (reason === 'mismatch') {
            // Content changed since the BMM team verified this repo
            sigTitle.textContent = t('repo.verifyDetail.sigMismatch') || 'Signature ne correspond plus';
            sigDesc.textContent = t('repo.verifyDetail.sigMismatchDesc')
                || "Le contenu de ce dépôt a changé depuis sa vérification par l'équipe BMM. Sa signature ne correspond plus à celle enregistrée — vérifiez avant de synchroniser.";
        }
        else {
            sigTitle.textContent = t('repo.verifyDetail.sigFail') || 'Signature invalide ou absente';
            sigDesc.textContent = t('repo.verifyDetail.sigFailDesc') || "La signature n'a pas pu être vérifiée. Le dépôt peut être non signé ou potentiellement modifié.";
        }
        sigTitle.style.color = isVerified ? '#2ecc71' : '#e74c3c';
    }
    modal.classList.add('open');
}
export function initRepoSync(elements) {
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
                // 2. Content-integrity check: does the live signature still match the
                //    one the BMM team recorded in repos.json? If a server changed its
                //    repo content after verification, the signature won't match.
                let verifyReason;
                const normUrl = (url || '').trim().replace(/\/repo\.json$/i, '').replace(/\/+$/, '').toLowerCase();
                const expectedSig = window.__bmmRepoExpectedSig?.[normUrl];
                let isVerified = selfSigned;
                if (selfSigned && expectedSig) {
                    if (repo.signature !== expectedSig) {
                        isVerified = false;
                        verifyReason = 'mismatch';
                    }
                }
                else if (!selfSigned) {
                    verifyReason = 'unsigned';
                }
                syncInfoCard.style.display = 'block';
                syncNameDisplay.textContent = repo.name;
                syncAuthorDisplay.textContent = (t('repo.authorShort') || "Auteur :") + " " + (repo.author || "Inconnu");
                syncDescDisplay.textContent = repo.description || "";
                syncGameBadge.textContent = repo.game_name;
                if (isVerified) {
                    syncBadge.textContent = t('repo.verified');
                    syncBadge.style.background = 'rgba(46, 204, 113, 0.2)';
                    syncBadge.style.color = '#2ecc71';
                    syncBadge.style.border = '1px solid rgba(46, 204, 113, 0.3)';
                }
                else {
                    syncBadge.textContent = t('repo.unverified');
                    syncBadge.style.background = 'rgba(231, 76, 60, 0.2)';
                    syncBadge.style.color = '#e74c3c';
                    syncBadge.style.border = '1px solid rgba(231, 76, 60, 0.3)';
                }
                syncBadge.style.cursor = 'pointer';
                syncBadge.style.borderRadius = '100px';
                syncBadge.style.padding = '2px 8px';
                syncBadge.title = t('repo.verifyDetail.clickHint') || 'Cliquer pour les détails';
                // Cache repo + verification state for the detail modal
                syncBadge.dataset.isVerified = isVerified ? '1' : '0';
                syncBadge.dataset.verifyReason = verifyReason || '';
                syncBadge._repoRef = repo;
                if (profilesSelectionEl && repo.profiles) {
                    profilesSelectionEl.innerHTML = `<div style="font-size:11px; font-weight:700; color:var(--text-secondary); margin-bottom:10px; opacity:0.8;">${t('repo.selectSyncTasks')}</div>`;
                    const localProfiles = await invoke('get_profiles');
                    repo.profiles.forEach(rp => {
                        const rpSizeTotal = rp.mods.reduce((acc, m) => acc + (m.files ? m.files.reduce((a, f) => a + f.size, 0) : 0), 0);
                        const group = document.createElement('div');
                        group.style.background = 'rgba(255,255,255,0.02)';
                        group.style.border = '1px solid rgba(255,255,255,0.05)';
                        group.style.borderRadius = '8px';
                        group.style.padding = '10px';
                        group.style.marginBottom = '8px';
                        const title = document.createElement('div');
                        title.style.display = 'flex';
                        title.style.justifyContent = 'space-between';
                        title.style.alignItems = 'center';
                        title.innerHTML = `
                            <span style="font-size:12px; font-weight:700;">${rp.name}</span>
                            <span style="font-size:10px; color:var(--text-muted);">${formatBytes(rpSizeTotal)}</span>
                        `;
                        title.style.color = 'var(--accent)';
                        title.style.marginBottom = '8px';
                        group.appendChild(title);
                        const optionsContainer = document.createElement('div');
                        optionsContainer.style.display = 'flex';
                        optionsContainer.style.flexDirection = 'column';
                        optionsContainer.style.gap = '6px';
                        const addOption = (label, value, checked = false) => {
                            const row = document.createElement('label');
                            row.style.display = 'flex';
                            row.style.alignItems = 'center';
                            row.style.gap = '8px';
                            row.style.cursor = 'pointer';
                            row.style.fontSize = '11px';
                            row.style.color = 'var(--text-secondary)';
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
                            selectRow.style.display = 'flex';
                            selectRow.style.alignItems = 'center';
                            selectRow.style.gap = '8px';
                            selectRow.style.marginTop = '4px';
                            const selectLabel = document.createElement('span');
                            selectLabel.textContent = (t('repo.syncOther') || 'Autre profil :');
                            selectLabel.style.fontSize = '10px';
                            selectLabel.style.color = 'var(--text-muted)';
                            const select = document.createElement('select');
                            select.className = 'input-field repo-sync-manual-select';
                            select.style.fontSize = '10px';
                            select.style.padding = '2px 6px';
                            select.style.height = '24px';
                            select.style.flex = '1';
                            select.innerHTML = `<option value="">-- ${t('repo.selectLocal') || 'Choisir un profil local'} --</option>` +
                                localProfiles.map(lp => `<option value="${lp.id}">${lp.name}</option>`).join('');
                            const cb = document.createElement('input');
                            cb.type = 'checkbox';
                            cb.dataset.repoProfileId = rp.id;
                            cb.className = 'repo-sync-choice-cb manual-sync-cb';
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
                            modSection.style.marginTop = '10px';
                            const summary = document.createElement('summary');
                            summary.style.cursor = 'pointer';
                            summary.style.fontSize = '10px';
                            summary.style.color = 'var(--text-muted)';
                            summary.style.userSelect = 'none';
                            summary.textContent = `${t('repo.selectMods') || 'Choisir les mods'} (${rp.mods.length})`;
                            modSection.appendChild(summary);
                            // Select all / none buttons
                            const modToolbar = document.createElement('div');
                            modToolbar.style.display = 'flex';
                            modToolbar.style.gap = '6px';
                            modToolbar.style.margin = '6px 0 4px';
                            const makeSmallBtn = (label, onClick) => {
                                const b = document.createElement('button');
                                b.textContent = label;
                                b.style.cssText = 'font-size:9px;padding:2px 7px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--text-secondary);cursor:pointer;';
                                b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
                                return b;
                            };
                            const modCheckboxes = [];
                            modToolbar.appendChild(makeSmallBtn(t('common.selectAll') || 'Tout', () => modCheckboxes.forEach(c => c.checked = true)));
                            modToolbar.appendChild(makeSmallBtn(t('common.unselectAll') || 'None', () => modCheckboxes.forEach(c => c.checked = false)));
                            modSection.appendChild(modToolbar);
                            const modList = document.createElement('div');
                            modList.style.display = 'flex';
                            modList.style.flexDirection = 'column';
                            modList.style.gap = '3px';
                            modList.style.maxHeight = '160px';
                            modList.style.overflowY = 'auto';
                            modList.style.paddingRight = '4px';
                            rp.mods.forEach(mod => {
                                const modSize = mod.files ? mod.files.reduce((a, f) => a + f.size, 0) : 0;
                                const row = document.createElement('label');
                                row.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;padding:3px 4px;border-radius:4px;transition:background 0.15s;';
                                row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,0.04)');
                                row.addEventListener('mouseleave', () => row.style.background = '');
                                const cb = document.createElement('input');
                                cb.type = 'checkbox';
                                cb.checked = true;
                                cb.dataset.repoProfileId = rp.id;
                                cb.dataset.modId = mod.id;
                                cb.className = 'repo-sync-mod-cb';
                                modCheckboxes.push(cb);
                                const nameSpan = document.createElement('span');
                                nameSpan.textContent = mod.name;
                                nameSpan.style.cssText = 'font-size:10px;color:var(--text-primary);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                                const sizeSpan = document.createElement('span');
                                sizeSpan.textContent = formatBytes(modSize);
                                sizeSpan.style.cssText = 'font-size:9px;color:var(--text-muted);flex-shrink:0;';
                                row.appendChild(cb);
                                row.appendChild(nameSpan);
                                row.appendChild(sizeSpan);
                                modList.appendChild(row);
                            });
                            modSection.appendChild(modList);
                            group.appendChild(modSection);
                        }
                        profilesSelectionEl.appendChild(group);
                    });
                    // ── Modpacks selection ──────────────────────────────
                    if (repo.modpacks && repo.modpacks.length > 0) {
                        const mpGroup = document.createElement('div');
                        mpGroup.className = 'repo-sync-profile-group glass-card';
                        mpGroup.style.marginTop = '20px';
                        mpGroup.style.padding = '12px';
                        mpGroup.style.background = 'rgba(255,255,255,0.02)';
                        mpGroup.style.border = '1px solid rgba(255,255,255,0.08)';
                        mpGroup.style.borderRadius = '8px';
                        mpGroup.innerHTML = `<h4 style="margin:0 0 12px; font-size:13px; font-weight:700; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                            ${t('modpack.sharedModpacks') || 'Modpacks Partagés'}
                        </h4>`;
                        const mpList = document.createElement('div');
                        mpList.style.cssText = 'display:flex; flex-direction:column; gap:8px; max-height:300px; overflow-y:auto; padding-right:4px;';
                        repo.modpacks.forEach(mpShare => {
                            const mp = mpShare.modpack;
                            const item = document.createElement('div');
                            item.className = 'repo-modpack-item';
                            item.style.cssText = 'display:flex; flex-direction:column; padding:10px; margin-bottom:8px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:8px;';
                            const topRow = document.createElement('div');
                            topRow.style.cssText = 'display:flex; align-items:center; gap:10px; margin-bottom:8px;';
                            const cb = document.createElement('input');
                            cb.type = 'checkbox';
                            cb.className = 'repo-sync-modpack-cb';
                            cb.dataset.modpack = JSON.stringify(mp);
                            cb.checked = true;
                            const name = document.createElement('span');
                            name.style.cssText = 'font-size:13px; font-weight:600; color:var(--text-primary); flex:1;';
                            name.textContent = mp.name;
                            const badge = document.createElement('div');
                            badge.style.cssText = 'font-size:9px; font-weight:800; padding:3px 8px; border-radius:4px; background:rgba(59, 130, 246, 0.15); color:var(--accent); text-transform:uppercase; letter-spacing:0.5px;';
                            badge.textContent = t('modpack.modpackBadge') || 'MODPACK';
                            topRow.appendChild(cb);
                            topRow.appendChild(name);
                            topRow.appendChild(badge);
                            item.appendChild(topRow);
                            const infoRow = document.createElement('div');
                            infoRow.style.cssText = 'display:flex; align-items:center; gap:8px; padding-left:26px;';
                            infoRow.innerHTML = `<span style="font-size:11px; color:var(--text-muted);">
                                <span style="color:var(--accent); font-weight:600;">${mp.mods.length}</span> ${t('modpack.modsIncluded') || 'mods inclus'}
                            </span>`;
                            item.appendChild(infoRow);
                            mpList.appendChild(item);
                        });
                        mpGroup.appendChild(mpList);
                        profilesSelectionEl.appendChild(mpGroup);
                    }
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
                const summary = await invoke('sync_server_repo', {
                    args: {
                        url, creatorId: finalCreatorId, gameDir, modsDir, backupDir, choices,
                        overwriteAll: syncMode === 'all', deleteExtra: cleanExtra, downloadLimit,
                        unzipArchives: !keepZipped, password: lastRepoPassword
                    }
                });
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
                    btnPauseSync.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> <span>${t('repo.pauseSync')}</span>`;
                }
                else {
                    await invoke('pause_repo_sync');
                    pausedBadge.style.display = 'block';
                    pauseText.textContent = t('repo.resumeSync');
                    btnPauseSync.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> <span>${t('repo.resumeSync')}</span>`;
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
            const isVerified = syncBadge.dataset.isVerified === '1';
            _openRepoVerifyDetail(repo, isVerified, syncBadge.dataset.verifyReason || undefined);
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
        body.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">${t('repo.noChanges')}</div>`;
    }
    else {
        body.innerHTML = summary.profiles.map(p => `
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:12px; padding:15px; margin-bottom:12px;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
                    <div style="width:8px; height:8px; border-radius:50%; background:var(--accent);"></div>
                    <span style="font-weight:700; font-size:14px; color:var(--text-primary);">${p.name}</span>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                    <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                        <div style="font-size:9px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">MODS</div>
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <div style="font-size:12px; color:var(--success); font-weight:600;">+ ${p.mods_added} ${t('repo.summaryAdded')}</div>
                            <div style="font-size:12px; color:var(--accent); font-weight:600;">~ ${p.mods_updated} ${t('repo.summaryUpdated')}</div>
                            <div style="font-size:12px; color:var(--danger); font-weight:600;">- ${p.mods_removed} ${t('repo.summaryRemoved')}</div>
                        </div>
                    </div>
                    <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                        <div style="font-size:9px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">TRANSFERT</div>
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <div style="font-size:12px; color:var(--text-primary); font-weight:600;">${p.files_downloaded} ${t('repo.summaryFiles') || 'files'}</div>
                            <div style="font-size:12px; color:var(--cyan); font-weight:600;">${formatBytes(p.bytes_downloaded)}</div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }
    modal.classList.add('open');
}
//# sourceMappingURL=repo-sync.js.map