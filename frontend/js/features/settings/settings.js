// @ts-nocheck
/**
 * settings.js — Settings UI (PAT, Discord, Shortcuts, Storage, Language, Tags)
 */
import { invoke, getSettings, updateSettings, pickFile, saveFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { getProfiles, getActiveProfileId } from '../profiles/profiles.js';
import { formatBytes } from '../../core/utils.js';
// ── GitHub PAT helper ─────────────────────────────────────
export async function getGithubPat() {
    try {
        const settings = await getSettings();
        return settings.github_token || '';
    }
    catch {
        return '';
    }
}
async function initGithubPatSettings() {
    const input = document.getElementById('setting-github-pat');
    const saveBtn = document.getElementById('btn-save-github-pat');
    const clearBtn = document.getElementById('btn-clear-github-pat');
    const toggleBtn = document.getElementById('btn-toggle-pat-visibility');
    const statusMsg = document.getElementById('pat-status-msg');
    if (!input)
        return;
    try {
        const settings = await getSettings();
        const stored = settings.github_token || '';
        if (stored) {
            input.value = stored;
            if (statusMsg)
                statusMsg.innerHTML = `<span style="color:var(--success)">&#10003; Token saved (${stored.length} chars)</span>`;
        }
    }
    catch (e) {
        console.error('Failed to load PAT:', e);
    }
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            const icon = document.getElementById('pat-eye-icon');
            if (icon) {
                if (isPassword) {
                    icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
                }
                else {
                    icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
                }
            }
        });
    }
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const val = input.value.trim();
            if (!val) {
                if (statusMsg)
                    statusMsg.innerHTML = `<span style="color:var(--warning)">⚠ No token entered. Use Clear to remove the stored token.</span>`;
                return;
            }
            try {
                const settings = await getSettings();
                settings.github_token = val;
                await updateSettings(settings);
                if (statusMsg)
                    statusMsg.innerHTML = `<span style="color:var(--success)">&#10003; Token saved (${val.length} chars)</span>`;
                toast(t('settings.githubPatSaved') || 'GitHub PAT saved.', 'success');
            }
            catch (e) {
                toast(t('common.error') + ' : ' + e, 'error');
            }
        });
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
            try {
                const settings = await getSettings();
                settings.github_token = '';
                await updateSettings(settings);
                input.value = '';
                input.type = 'password';
                const icon = document.getElementById('pat-eye-icon');
                if (icon)
                    icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
                if (statusMsg)
                    statusMsg.innerHTML = `<span style="color:var(--text-muted)">Token cleared.</span>`;
                toast(t('settings.githubPatCleared') || 'GitHub PAT cleared.', 'info');
            }
            catch (e) {
                toast(t('common.error') + ' : ' + e, 'error');
            }
        });
    }
    const helpBtn = document.getElementById('btn-pat-need-help');
    if (helpBtn) {
        helpBtn.addEventListener('click', () => {
            const docsNav = document.querySelector('.nav-item[data-view="docs"]');
            if (docsNav)
                docsNav.click();
            setTimeout(() => {
                const faqEl = document.getElementById('faq-github-pat');
                if (faqEl) {
                    faqEl.open = true;
                    faqEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    faqEl.classList.add('faq-highlight');
                    setTimeout(() => faqEl.classList.remove('faq-highlight'), 2000);
                }
            }, 200);
        });
    }
}
// ── Discord RPC ───────────────────────────────────────────
async function initDiscordRpcSettings() {
    const chk = document.getElementById('chk-discord-rpc');
    if (!chk)
        return;
    try {
        const settings = await getSettings();
        chk.checked = settings.discord_rpc_enabled || false;
    }
    catch (e) {
        console.error('Failed to load Discord RPC setting:', e);
    }
    chk.addEventListener('change', async (e) => {
        try {
            const settings = await getSettings();
            settings.discord_rpc_enabled = e.target.checked;
            await updateSettings(settings);
            if (e.target.checked) {
                await invoke('init_discord_rpc');
                toast(t('settings.discordRpcEnabled') || 'Discord Rich Presence activé', 'success');
                await updateDiscordStatus();
            }
            else {
                await invoke('init_discord_rpc');
                toast(t('settings.discordRpcDisabled') || 'Discord Rich Presence désactivé', 'info');
            }
        }
        catch (err) {
            toast(t('common.error') + ' : ' + err, 'error');
        }
    });
}
export async function updateDiscordStatus() {
    try {
        const settings = await getSettings();
        if (!settings.discord_rpc_enabled)
            return;
        const profiles = await getProfiles();
        const activeId = await getActiveProfileId();
        const activeProfile = profiles.find(p => p.id === activeId);
        if (activeProfile) {
            const details = t('settings.discordRpcDetails', { name: activeProfile.name }) || `Profil: ${activeProfile.name}`;
            const status = t('settings.discordRpcStatus', { count: activeProfile.active_mods.length }) || `${activeProfile.active_mods.length} mods activés`;
            await invoke('set_discord_presence', {
                details,
                status
            });
        }
    }
    catch (e) {
        console.error('Failed to update Discord status:', e);
    }
}
// ── Settings keyboard shortcuts ────────────────────────────
export async function getShortcuts() {
    try {
        const settings = await getSettings();
        return settings.shortcuts && Object.keys(settings.shortcuts).length > 0 ? settings.shortcuts : {
            "newProfile": "n",
            "addMod": "m",
            "exportModlist": "e",
            "importModlist": "i"
        };
    }
    catch {
        return {
            "newProfile": "n",
            "addMod": "m",
            "exportModlist": "e",
            "importModlist": "i"
        };
    }
}
async function initShortcuts() {
    document.addEventListener('keydown', async (e) => {
        if (e.ctrlKey) {
            const sc = await getShortcuts();
            const key = e.key.toLowerCase();
            if (key === sc.newProfile) {
                e.preventDefault();
                document.getElementById('nav-profiles').click();
                setTimeout(() => document.getElementById('btn-new-profile')?.click(), 50);
            }
            else if (key === sc.addMod) {
                e.preventDefault();
                document.getElementById('nav-library').click();
                setTimeout(() => document.getElementById('btn-add-mod')?.click(), 50);
            }
            else if (key === sc.exportModlist) {
                e.preventDefault();
                document.getElementById('nav-modlist').click();
                setTimeout(() => document.getElementById('btn-export-mm')?.click(), 100);
            }
            else if (key === sc.importModlist) {
                e.preventDefault();
                document.getElementById('nav-modlist').click();
                setTimeout(() => document.getElementById('btn-import-mm')?.click(), 100);
            }
        }
    });
}
async function renderSettingsShortcuts() {
    const sc = await getShortcuts();
    const updateShortcut = (id, keyName) => {
        const input = document.getElementById(id);
        if (input) {
            input.value = sc[keyName];
            input.addEventListener('keydown', async (e) => {
                e.preventDefault();
                const newKey = e.key.toLowerCase();
                if (newKey !== 'control' && newKey !== 'shift' && newKey !== 'alt') {
                    sc[keyName] = newKey;
                    try {
                        const settings = await getSettings();
                        settings.shortcuts = sc;
                        await updateSettings(settings);
                        input.value = newKey;
                        toast('Raccourci mis à jour (' + newKey + ')', 'success');
                    }
                    catch (err) {
                        toast('Erreur sauvegarde raccourci : ' + err, 'error');
                    }
                }
            });
        }
    };
    updateShortcut('sc-new-profile', 'newProfile');
    updateShortcut('sc-add-mod', 'addMod');
    updateShortcut('sc-export-mm', 'exportModlist');
    updateShortcut('sc-import-mm', 'importModlist');
}
// ── Storage Performance Settings ──
/** Run benchmarks for all disks currently in use by profiles */
export async function runAutoBenchmarks(disksList, isBoot = false) {
    const inUseDisks = disksList.filter(d => d.profiles_using && d.profiles_using.length > 0);
    if (inUseDisks.length === 0)
        return;
    if (!isBoot)
        toast('Optimisation en cours...', 'info');
    for (const disk of inUseDisks) {
        try {
            const result = await invoke('benchmark_disk', { mountPoint: disk.mount_point });
            await invoke('set_disk_limit', { mountPoint: disk.mount_point, limitMbS: result.suggested_limit });
            if (!isBoot)
                toast(`Optimisation réussie pour ${disk.name}: ${result.suggested_limit} MB/s`, 'success');
        }
        catch (e) {
            console.error(`Failed auto-bench for ${disk.mount_point}:`, e);
        }
    }
    // Refresh modal UI if it's open
    _renderStorageModal();
}
const _renderStorageModal = async () => {
    const container = document.getElementById('storage-disks-container');
    if (!container)
        return;
    container.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;margin-bottom:8px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
        <div data-i18n="common.loading">Chargement...</div></div>`;
    try {
        const disks = await invoke('get_system_disks');
        if (!disks || disks.length === 0) {
            container.innerHTML = `<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:30px;">Aucun disque détecté.</div>`;
            return;
        }
        const usageTypeLabels = {
            game_directory: { label: t('storage.gameDir') || 'Game Dir', color: '#60a5fa' },
            mod_folder: { label: t('storage.modsDir') || 'Mods', color: '#a78bfa' },
            backup: { label: t('storage.backupDir') || 'Backup', color: '#fbbf24' },
        };
        const settings = await getSettings();
        const isAuto = settings.auto_io_calibration || false;
        const alertEnabled = settings.storage_alert_enabled || false;
        const warningPct = settings.storage_warning_space_pct !== undefined ? settings.storage_warning_space_pct : 40;
        const criticalPct = settings.storage_critical_space_pct !== undefined ? settings.storage_critical_space_pct : 30;
        // Storage alert thresholds block
        const thresholdsBlock = `
            <div style="position:relative; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:12px; padding:16px; margin-bottom:20px; overflow:hidden;" id="storage-alert-thresholds-block" class="${alertEnabled ? '' : 'config-disabled'}" data-i18n-content="settings.disabledOverlay" data-content="${alertEnabled ? '' : (t('settings.disabledOverlay') || 'DÉSACTIVÉ')}">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:${alertEnabled ? '12px' : '0px'}">
                    <div style="font-size:14px; font-weight:700; color:var(--text-primary); position:relative; z-index:60; pointer-events:auto;">${t('storage.alertThresholds') || "Seuils d'Alerte de Stockage"}</div>
                    <label class="bmm-switch" title="${alertEnabled ? 'Désactiver' : 'Activer'}" style="position:relative; z-index:60; pointer-events:auto;">
                        <input type="checkbox" id="chk-alert-enabled" ${alertEnabled ? 'checked' : ''}>
                        <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                    </label>
                </div>
                ${alertEnabled ? `
                <div style="display:flex; gap:16px; flex-wrap:wrap;">
                    <div style="flex:1; min-width:200px;">
                        <label style="font-size:11px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:4px;">${t('storage.alertLimit') || 'Alerte Espace Limité (%)'}</label>
                        <input type="number" id="input-warning-pct" class="form-input" value="${warningPct}" min="1" max="99" style="width:100%; font-size:13px; padding:8px 10px;">
                    </div>
                    <div style="flex:1; min-width:200px;">
                        <label style="font-size:11px; font-weight:600; color:#ef4444; display:block; margin-bottom:4px;">${t('storage.alertCritical') || 'Alerte Espace Critique (%)'}</label>
                        <input type="number" id="input-critical-pct" class="form-input" value="${criticalPct}" min="0" max="99" style="width:100%; font-size:13px; padding:8px 10px; border-color:rgba(239,68,68,0.3);">
                    </div>
                </div>` : `
                <div style="padding-top:6px;">
                    <span style="font-size:12px;color:var(--text-muted)">${t('storage.alertDisabledHint') || 'Activez pour définir des seuils d\'alerte de stockage.'}</span>
                </div>`}
            </div>
        `;
        // Global auto/dynamic control
        container.innerHTML = `
            <div style="background:rgba(59,130,246,0.05); border:1px solid rgba(59,130,246,0.2); border-radius:12px; padding:16px; margin-bottom:20px; display:flex; align-items:center; gap:16px">
                <div style="width:40px; height:40px; background:rgba(59,130,246,0.1); border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2.5" style="${isAuto ? 'animation:pulse 2s infinite' : ''}"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                </div>
                <div style="flex:1">
                    <div style="font-size:14px; font-weight:800; color:var(--text-bright)">${t('storage.autoCalibTitle') || 'Auto-Calibration Performance'}</div>
                    <div style="font-size:11px; color:var(--text-muted); line-height:1.4">${t('storage.autoCalibDesc') || 'Optimise automatiquement vos vitesses d\'écriture au démarrage et à l\'activation.'}</div>
                </div>
                <label class="bmm-switch">
                    <input type="checkbox" id="chk-auto-io" ${isAuto ? 'checked' : ''}>
                    <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                </label>
            </div>

            ${thresholdsBlock}

            <div id="disks-list-subcontainer" style="display:flex; flex-direction:column; gap:12px"></div>
        `;
        // Setup dynamic toggle listener
        document.getElementById('chk-auto-io').addEventListener('change', async (e) => {
            const checked = e.target.checked;
            settings.auto_io_calibration = checked;
            await updateSettings(settings);
            _renderStorageModal();
            if (checked) {
                toast(t('storage.autoCalibToast') || 'Auto-Calibration activée. Optimisation en cours...', 'info');
                runAutoBenchmarks(disks);
            }
        });
        // Alert enabled toggle
        document.getElementById('chk-alert-enabled')?.addEventListener('change', async (e) => {
            settings.storage_alert_enabled = e.target.checked;
            await updateSettings(settings);
            _renderStorageModal();
        });
        const updateThresholds = async () => {
            let w = parseInt(document.getElementById('input-warning-pct')?.value, 10);
            let c = parseInt(document.getElementById('input-critical-pct')?.value, 10);
            if (isNaN(w) || w < 1)
                w = 40;
            if (isNaN(c) || c < 0)
                c = 30;
            if (w < c)
                w = c + 1;
            settings.storage_warning_space_pct = w;
            settings.storage_critical_space_pct = c;
            await updateSettings(settings);
            _renderStorageModal();
        };
        let thTimer;
        document.getElementById('input-warning-pct')?.addEventListener('input', () => {
            clearTimeout(thTimer);
            thTimer = setTimeout(updateThresholds, 800);
        });
        document.getElementById('input-critical-pct')?.addEventListener('input', () => {
            clearTimeout(thTimer);
            thTimer = setTimeout(updateThresholds, 800);
        });
        const getKindBadge = (disk) => {
            if (disk.is_cloud && disk.cloud_provider) {
                if (disk.kind === 'Network')
                    return `<span style="background:rgba(245,158,11,0.15);color:#fbbf24;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">🌐 ${disk.cloud_provider}</span>`;
                return `<span style="background:rgba(168,85,247,0.15);color:#c084fc;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">☁️ ${disk.cloud_provider}</span>`;
            }
            if (disk.kind === 'SSD')
                return '<span style="background:rgba(59,130,246,0.15);color:#60a5fa;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">SSD</span>';
            if (disk.kind === 'HDD')
                return '<span style="background:rgba(245,158,11,0.15);color:#fbbf24;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">HDD</span>';
            return '<span style="background:rgba(156,163,175,0.15);color:#9ca3af;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">' + disk.kind + '</span>';
        };
        const subContainer = document.getElementById('disks-list-subcontainer');
        subContainer.innerHTML = disks.map(disk => {
            const limitVal = disk.current_limit_mb_s || 0;
            const usedPct = disk.total_space_bytes > 0 ? ((disk.total_space_bytes - disk.available_space_bytes) / disk.total_space_bytes * 100).toFixed(0) : 0;
            const usedColor = usedPct > 90 ? '#ef4444' : usedPct > 70 ? '#fbbf24' : '#60a5fa';
            let profilePills = '';
            if (disk.profiles_using && disk.profiles_using.length > 0) {
                profilePills = disk.profiles_using.map(pu => {
                    const info = usageTypeLabels[pu.usage_type] || { label: pu.usage_type, color: '#9ca3af' };
                    return `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.05);border:1px solid ${info.color}33;color:${info.color};padding:2px 8px;border-radius:12px;font-size:10px;font-weight:500;">
                        <span style="width:6px;height:6px;border-radius:50%;background:${info.color};flex-shrink:0;"></span>
                        ${pu.profile_name} → ${info.label}
                    </span>`;
                }).join('');
            }
            return `
            <div style="background:rgba(0,0,0,0.25);border:1px solid ${usedPct > 90 ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.06)'};border-radius:12px;padding:16px;transition:border-color 0.2s;" class="storage-disk-card">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px;">
                    <div style="display:flex;align-items:center;gap:12px;min-width:0;">
                        <div style="width:38px;height:38px;background:rgba(59,130,246,0.08);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2">
                                <rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><line x1="6" y1="12" x2="6.01" y2="12"/>
                            </svg>
                        </div>
                        <div style="min-width:0;">
                            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                <span style="font-size:14px;font-weight:700;color:var(--text-bright);">${disk.name}</span>
                                ${getKindBadge(disk)}
                                <span style="font-size:10px;color:var(--text-muted);background:rgba(255,255,255,0.04);padding:1px 6px;border-radius:4px;">${disk.file_system}</span>
                            </div>
                            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${disk.mount_point}</div>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                        <input type="number" min="0" step="10" class="form-input disk-limit-input" data-mount="${disk.mount_point}" value="${limitVal}" style="width:90px;font-size:13px;padding:6px 8px;text-align:right;border-radius:8px;" placeholder="0">
                        <span style="font-size:12px;color:var(--text-muted);font-weight:600;">MB/s</span>
                    </div>
                </div>

                <div style="margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:4px;">
                        <span>${formatBytes(disk.total_space_bytes - disk.available_space_bytes)} / ${formatBytes(disk.total_space_bytes)}</span>
                        <span style="color:${usedColor};font-weight:600;">${usedPct}%</span>
                    </div>
                    <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
                        <div style="height:100%;width:${usedPct}%;background:${usedColor};border-radius:2px;transition:width 0.3s;"></div>
                    </div>
                </div>

                ${(() => {
                const freePct = disk.total_space_bytes > 0 ? (disk.available_space_bytes / disk.total_space_bytes) * 100 : 0;
                const hasProfiles = disk.profiles_using && disk.profiles_using.length > 0;
                if (hasProfiles && freePct <= criticalPct) {
                    return `<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;margin-bottom:8px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);border-radius:8px;font-size:11px;color:#f87171;font-weight:600"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>${t('storage.critical') || "Espace critique ! L'activation de mods pourrait échouer."}</div>`;
                }
                else if (hasProfiles && freePct <= warningPct) {
                    return `<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;margin-bottom:8px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:8px;font-size:11px;color:#fbbf24;font-weight:500"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${t('storage.warning') || "Espace limité — pensez à libérer de la place."}</div>`;
                }
                return '';
            })()}

                ${profilePills ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">${profilePills}</div>` : ''}

                <div style="display:flex;align-items:center;gap:8px;">
                    <button class="btn btn-add disk-bench-btn" data-mount="${disk.mount_point}" style="font-size:12px;gap:6px;padding:6px 14px;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                        <span data-i18n="storage.benchmark">${t('storage.benchmark') || 'Tester la vitesse'}</span>
                    </button>
                    <span class="disk-bench-result" style="font-size:11px;color:var(--text-muted);"></span>
                </div>
            </div>`;
        }).join('');
        // Listeners
        container.querySelectorAll('.disk-limit-input').forEach(input => {
            let timer;
            input.addEventListener('input', (e) => {
                clearTimeout(timer);
                timer = setTimeout(async () => {
                    let val = parseInt(e.target.value, 10);
                    if (isNaN(val) || val < 0)
                        val = 0;
                    const limitMbS = val === 0 ? null : val;
                    const mountPoint = e.target.getAttribute('data-mount');
                    try {
                        await invoke('set_disk_limit', { mountPoint, limitMbS });
                        toast(t('common.success') || 'Saved', 'success');
                    }
                    catch (err) {
                        toast('Error: ' + err, 'error');
                    }
                }, 800);
            });
        });
        container.querySelectorAll('.disk-bench-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const mountPoint = btn.getAttribute('data-mount');
                const resultSpan = btn.closest('div').querySelector('.disk-bench-result');
                const original = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> <span>${t('storage.benchmarking') || 'Test en cours...'}</span>`;
                try {
                    const res = await invoke('benchmark_disk', { mountPoint });
                    resultSpan.innerHTML = `
                        <span style="color:#60a5fa;">↓ ${res.read_mb_s} MB/s</span>
                        <span style="margin:0 4px;">·</span>
                        <span style="color:#a78bfa;">↑ ${res.write_mb_s} MB/s</span>
                        <span style="margin:0 4px;">·</span>
                        <span style="color:#34d399;">${t('storage.suggestedLimit') || 'Suggestion'}: ${res.suggested_limit} MB/s</span>
                        <button class="btn btn-ghost btn-sm disk-apply-suggestion" data-mount="${mountPoint}" data-value="${res.suggested_limit}" style="font-size:10px;padding:2px 8px;margin-left:4px;">${t('storage.applySuggested') || 'Appliquer'}</button>
                    `;
                    resultSpan.querySelector('.disk-apply-suggestion')?.addEventListener('click', async (ev) => {
                        const sugVal = parseInt(ev.target.getAttribute('data-value'), 10);
                        const mp = ev.target.getAttribute('data-mount');
                        const input = btn.closest('.storage-disk-card').querySelector('.disk-limit-input');
                        if (input)
                            input.value = sugVal;
                        try {
                            await invoke('set_disk_limit', { mountPoint: mp, limitMbS: sugVal });
                            toast(t('common.success') || 'Saved', 'success');
                        }
                        catch (err) {
                            toast('Error: ' + err, 'error');
                        }
                    });
                }
                catch (err) {
                    resultSpan.textContent = t('common.error') + ': ' + err;
                    resultSpan.style.color = 'var(--error)';
                }
                btn.disabled = false;
                btn.innerHTML = original;
            });
        });
    }
    catch (err) {
        console.error(err);
        container.innerHTML = `<div style="font-size:12px;color:var(--error);text-align:center;padding:30px;">Erreur: ${err}</div>`;
    }
};
async function initStorageSettings() {
    const openBtn = document.getElementById('btn-open-storage');
    if (openBtn) {
        openBtn.addEventListener('click', () => {
            const modal = document.getElementById('modal-storage');
            if (modal) {
                modal.classList.add('open');
                _renderStorageModal();
            }
        });
    }
    const faqBtn = document.getElementById('btn-storage-faq');
    if (faqBtn) {
        faqBtn.addEventListener('click', () => {
            document.getElementById('nav-docs')?.click();
            setTimeout(() => {
                const ioFaq = document.querySelector('[data-i18n="faq.qIo"]');
                if (ioFaq) {
                    const details = ioFaq.closest('details');
                    if (details) {
                        details.open = true;
                        details.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            }, 200);
        });
    }
}
window._renderStorageModal = _renderStorageModal;
// ── Language Settings ──
async function initLanguageSettings() {
    const langContainer = document.getElementById('settings-lang-container');
    if (!langContainer)
        return;
    const { getLanguages, setLang } = await import('../../core/i18n.js');
    const { initNavbarLangDropdown } = await import('../../ui/app.js');
    const getFlag = (l) => {
        if (!l || !l.flag)
            return '⚪';
        const f = l.flag.trim();
        if (f.length > 2)
            return f;
        if (f.length === 2) {
            const code = f.toLowerCase();
            return `<img src="https://flagcdn.com/w20/${code}.png" 
                         width="20" height="14" alt="${f.toUpperCase()}"
                         style="vertical-align: middle; border-radius: 2px; object-fit: cover;"
                         onerror="this.outerHTML='<span style=\\'font-size:10px; font-weight:700\\'>${f.toUpperCase()}</span>'">`;
        }
        return f;
    };
    const renderLangs = () => {
        const languages = getLanguages();
        const current = languages.find(l => l.active) || languages[0];
        langContainer.innerHTML = `
            <button class="nav-lang-btn" id="settings-lang-toggle" style="width: 240px; background: rgba(0,0,0,0.3);">
                <span class="nav-lang-flag" style="margin-right:8px">${getFlag(current)}</span>
                <span class="nav-lang-name">${current.name}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="nav-lang-chevron"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <div class="settings-lang-menu" id="settings-lang-menu">
                ${languages.map(l => `
                    <button class="nav-lang-option ${l.active ? 'active' : ''}" data-lang="${l.code}">
                        <span class="nav-lang-flag" style="margin-right:10px">${getFlag(l)}</span>
                        <span>${l.name}</span>
                        ${l.active ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="3" style="margin-left:auto"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                    </button>
                `).join('')}
            </div>
        `;
        const toggle = document.getElementById('settings-lang-toggle');
        const menu = document.getElementById('settings-lang-menu');
        if (toggle && menu) {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = menu.classList.contains('open');
                document.querySelectorAll('.settings-lang-menu, .nav-lang-menu').forEach(m => m.classList.remove('open'));
                document.querySelectorAll('.nav-lang-btn').forEach(b => b.classList.remove('open'));
                if (!isOpen) {
                    menu.classList.add('open');
                    toggle.classList.add('open');
                }
            });
            menu.querySelectorAll('.nav-lang-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    setLang(opt.dataset.lang);
                    menu.classList.remove('open');
                    toggle.classList.remove('open');
                    renderLangs();
                    if (typeof initNavbarLangDropdown === 'function')
                        initNavbarLangDropdown();
                });
            });
        }
    };
    document.addEventListener('click', () => {
        const menu = document.getElementById('settings-lang-menu');
        const toggle = document.getElementById('settings-lang-toggle');
        if (menu && toggle) {
            menu.classList.remove('open');
            toggle.classList.remove('open');
        }
    });
    renderLangs();
    document.getElementById('btn-show-lang-guide')?.addEventListener('click', () => {
        if (typeof window.checkPtbMode === 'function')
            window.checkPtbMode(true, "TranslationGuide");
    });
    document.getElementById('btn-download-lang-template')?.addEventListener('click', async () => {
        try {
            const resp = await fetch('Lang/template.json');
            const text = await resp.text();
            const blob = new Blob([text], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'template.json';
            a.click();
            URL.revokeObjectURL(url);
            toast(t('common.success') || 'OK', 'success');
        }
        catch (e) {
            toast('Erreur download : ' + e, 'error');
        }
    });
    document.getElementById('btn-import-lang')?.addEventListener('click', async () => {
        try {
            const res = await invoke('import_language');
            if (res) {
                toast(t('settings.langImportSuccess'), 'success');
                const { refreshLanguages } = await import('../../core/i18n.js');
                await refreshLanguages();
                renderLangs();
            }
        }
        catch (e) {
            if (e !== 'Canceled')
                toast(t('settings.langImportError', { err: e }), 'error');
        }
    });
}
// ── Tags Settings ──
export async function renderSettingsTags() {
    const list = document.getElementById('settings-tags-list');
    if (!list)
        return;
    try {
        const tags = await invoke('get_tags');
        list.innerHTML = '';
        if (tags.length === 0) {
            list.innerHTML = '<span style="color:var(--text-muted);font-size:12px;font-style:italic">Aucun tag personnalisé pour le moment.</span>';
            return;
        }
        tags.forEach(t => {
            const chip = document.createElement('div');
            chip.style.cssText = `display:flex;align-items:center;gap:4px;background:${t.color}20;color:${t.color};border:1px solid ${t.color}40;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600`;
            chip.innerHTML = `<span>${String(t.name).replace(/</g, '&lt;')}</span><button data-id="${t.id}" class="btn-del-tag" style="background:none;border:none;color:inherit;cursor:pointer;padding:0;margin-left:6px;font-size:14px" title="Supprimer">&times;</button>`;
            list.appendChild(chip);
        });
        list.querySelectorAll('.btn-del-tag').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm('Voulez-vous vraiment supprimer ce tag ? Il sera retiré de tous les mods.')) {
                    try {
                        await invoke('delete_tag', { tagId: btn.dataset.id });
                        toast('Tag supprimé.', 'success');
                        renderSettingsTags();
                        if (window._refreshModsFn)
                            window._refreshModsFn();
                    }
                    catch (err) {
                        toast('Erreur suppression tag : ' + err, 'error');
                    }
                }
            });
        });
    }
    catch (err) {
        console.error("Tags error", err);
    }
}
window.renderSettingsTags = renderSettingsTags;
// ── Settings Initializer ──────────────────────────────────
export async function initSettings() {
    await initGithubPatSettings();
    await initDiscordRpcSettings();
    await initShortcuts();
    renderSettingsShortcuts();
    await initStorageSettings();
    await initLanguageSettings();
    // Tags Settings
    const btnCreateTag = document.getElementById('btn-create-tag');
    if (btnCreateTag) {
        btnCreateTag.addEventListener('click', async () => {
            const nameInput = document.getElementById('setting-tag-name');
            const colorInput = document.getElementById('setting-tag-color');
            const name = nameInput.value.trim();
            const color = colorInput.value;
            if (!name)
                return toast('Le nom du tag est requis.', 'error');
            try {
                await invoke('create_tag', { name, color, icon: '' });
                nameInput.value = '';
                toast('Tag créé.', 'success');
                renderSettingsTags();
                if (window._refreshModsFn)
                    window._refreshModsFn();
            }
            catch (err) {
                toast('Erreur création tag : ' + err, 'error');
            }
        });
        renderSettingsTags();
    }
    // Export/Import App Data
    const exportBtn = document.getElementById('btn-export-data');
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            const destPath = await saveFile([{ name: 'App Data Backup', extensions: ['json'] }]);
            if (destPath) {
                try {
                    await invoke('export_app_data', { destPath });
                    toast('Configuration exportée.', 'success');
                }
                catch (e) {
                    toast('Erreur export : ' + e, 'error');
                }
            }
        });
    }
    const importBtn = document.getElementById('btn-import-data');
    if (importBtn) {
        importBtn.addEventListener('click', async () => {
            const srcPath = await pickFile([{ name: 'App Data Backup', extensions: ['json'] }]);
            if (srcPath) {
                if (confirm('Voulez-vous vraiment écraser votre configuration actuelle ?')) {
                    try {
                        await invoke('import_app_data', { srcPath });
                        toast('Configuration importée avec succès. Redémarrage...', 'success');
                        setTimeout(() => window.location.reload(), 2000);
                    }
                    catch (e) {
                        toast('Erreur import : ' + e, 'error');
                    }
                }
            }
        });
    }
}
//# sourceMappingURL=settings.js.map