// @ts-nocheck
/**
 * settings.js — Settings UI (PAT, Discord, Shortcuts, Storage, Language, Tags)
 */
import { invoke, getSettings, updateSettings, pickFile, saveFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { bcRoot, bcTestMode } from '../../core/links-config.js';
import { initI18nSandbox } from './i18n-sandbox.js';
import { renderShortcutsManager } from '../../core/commands.js';
import { parseCatalogIndex, planImport, STORE_KEY, rememberOrigin, addSource, removeSource, originOf, originLabel, forgetOrigin, readHistory, recordHistory, clearHistory, forgetHistoryAt, isDisabled, setDisabled, } from '../catalogs/catalog-index.js';
import { toast } from '../../ui/app.js';
import { getProfiles, getActiveProfileId } from '../profiles/profiles.js';
import { formatBytes, escHtml, escAttr } from '../../core/utils.js';
import { initBetaHub, openBugReportModal, openFeedbackModal } from '../betahub/betahub-modals.js';
import { initLaunchPackSettings } from './launch_packs.js';
import { initScheduler } from './scheduler.js';
import { initCardReorder } from './card-order.js';
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
                toast(t('settings.githubPatSaved'), 'success');
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
                toast(t('settings.githubPatCleared'), 'info');
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
                toast(t('settings.discordRpcEnabled'), 'success');
                await updateDiscordStatus();
            }
            else {
                await invoke('init_discord_rpc');
                toast(t('settings.discordRpcDisabled'), 'info');
            }
        }
        catch (err) {
            toast(t('common.error') + ' : ' + err, 'error');
        }
    });
}
/** Enable/disable Discord Rich Presence (used by the API + deep links). */
export async function setDiscordRpc(enabled) {
    const settings = await getSettings();
    settings.discord_rpc_enabled = enabled;
    await updateSettings(settings);
    await invoke('init_discord_rpc');
    if (enabled) {
        try {
            await updateDiscordStatus();
        }
        catch { /* ignore */ }
    }
    const chk = document.getElementById('chk-discord-rpc');
    if (chk)
        chk.checked = enabled;
}
// ── Sound / Animation Settings ───────────────────────────
async function initSoundSettings() {
    const chkSound = document.getElementById('chk-sound-effects');
    const volSlider = document.getElementById('setting-sound-volume');
    const volDisplay = document.getElementById('setting-sound-volume-display');
    if (!chkSound || !volSlider)
        return;
    try {
        const settings = await getSettings();
        chkSound.checked = settings.sound_effects_enabled !== false;
        volSlider.value = String(settings.sound_volume ?? 70);
        if (volDisplay)
            volDisplay.textContent = String(settings.sound_volume ?? 70) + '%';
    }
    catch (e) {
        console.error('Failed to load sound settings:', e);
    }
    const applySound = async () => {
        try {
            const settings = await getSettings();
            settings.sound_effects_enabled = chkSound.checked;
            settings.sound_volume = parseInt(volSlider.value) || 70;
            await updateSettings(settings);
            // Apply immediately via the exported functions from app.ts
            const app = await import('../../ui/app.js');
            app.setSoundEnabled(settings.sound_effects_enabled);
            app.setSoundVolume(settings.sound_volume / 100);
        }
        catch (err) {
            console.error(err);
        }
    };
    chkSound.addEventListener('change', applySound);
    volSlider.addEventListener('input', () => {
        if (volDisplay)
            volDisplay.textContent = volSlider.value + '%';
    });
    volSlider.addEventListener('change', applySound);
}
// ── SHA Settings ──────────────────────────────────────────
async function initShaSettings() {
    const chkStrict = document.getElementById('chk-sha-strict-mode');
    const chkLazy = document.getElementById('chk-sha-lazy-calc');
    if (!chkStrict || !chkLazy)
        return;
    try {
        const settings = await getSettings();
        chkStrict.checked = settings.require_valid_sha || false;
        chkLazy.checked = settings.enable_lazy_sha_calculation ?? true;
    }
    catch (e) {
        console.error('Failed to load SHA settings:', e);
    }
    chkStrict.addEventListener('change', async (e) => {
        try {
            const settings = await getSettings();
            settings.require_valid_sha = e.target.checked;
            await updateSettings(settings);
            toast(t('settings.shaStrictModeUpdated'), 'success');
        }
        catch (err) {
            toast(t('common.error') + ' : ' + err, 'error');
        }
    });
    chkLazy.addEventListener('change', async (e) => {
        try {
            const settings = await getSettings();
            settings.enable_lazy_sha_calculation = e.target.checked;
            await updateSettings(settings);
            toast(t('common.success'), 'success');
            // Sync modal toggle if open
            const modalToggle = document.getElementById('modal-chk-sha-lazy');
            if (modalToggle)
                modalToggle.checked = e.target.checked;
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
            const details = t('settings.discordRpcDetails', { name: activeProfile.name });
            const status = t('settings.discordRpcStatus', { count: activeProfile.active_mods.length });
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
                        toast(t('settings.shortcutUpdated', { key: newKey }), 'success');
                    }
                    catch (err) {
                        toast(t('settings.shortcutError', { err: String(err) }), 'error');
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
/** Reset all disk limits to null (Unlimited) */
export async function resetStorageLimits() {
    try {
        const disks = await invoke('get_system_disks');
        for (const disk of disks) {
            await invoke('set_disk_limit', { mountPoint: disk.mount_point, limitMbS: null });
        }
        toast(t('storage.limitsReset'), 'success');
        _renderStorageModal();
    }
    catch (e) {
        toast((window.t ? window.t('common.error') : 'Failed') + ': ' + e, 'error');
    }
}
/** Run benchmarks for all disks currently in use by profiles */
export async function runAutoBenchmarks(disksList, isBoot = false) {
    const inUseDisks = disksList.filter(d => d.profiles_using && d.profiles_using.length > 0);
    if (inUseDisks.length === 0)
        return;
    if (!isBoot)
        toast(t('storage.optimizing'), 'info');
    let successCount = 0;
    for (const disk of inUseDisks) {
        try {
            const result = await invoke('benchmark_disk', { mountPoint: disk.mount_point });
            await invoke('set_disk_limit', { mountPoint: disk.mount_point, limitMbS: result.suggested_limit });
            successCount++;
        }
        catch (e) {
            console.error(`Failed auto-bench for ${disk.mount_point}:`, e);
        }
    }
    if (!isBoot) {
        if (successCount > 0) {
            toast(t('storage.calibrationSuccess'), 'success');
        }
        else {
            toast(t('storage.calibrationError'), 'error');
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
        <div data-i18n="common.loading">${t('storage.loading')}</div></div>`;
    try {
        const disks = await invoke('get_system_disks');
        if (!disks || disks.length === 0) {
            container.innerHTML = `<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:30px;">${t('storage.noDisks')}</div>`;
            return;
        }
        const usageTypeLabels = {
            game_directory: { label: t('storage.gameDir') || 'Game Dir', color: '#60a5fa' },
            mod_folder: { label: t('storage.modsDir') || 'Mods', color: '#a78bfa' },
            backup: { label: t('storage.backupDir') || 'Backup', color: '#fbbf24' },
        };
        const settings = await getSettings();
        // Auto I/O calibration: defaults to ON when undefined (matches new Rust default).
        const isAuto = settings.auto_io_calibration !== false;
        // Smart I/O defaults to ON if undefined (matches Rust default_true)
        const smartIo = settings.smart_io_enabled !== false;
        const alertEnabled = settings.storage_alert_enabled || false;
        const warningPct = settings.storage_warning_space_pct !== undefined ? settings.storage_warning_space_pct : 40;
        const criticalPct = settings.storage_critical_space_pct !== undefined ? settings.storage_critical_space_pct : 30;
        // Publish threshold so profile cards use the same value (converted: warningPct% free → ratio)
        window.__storageWarnPct = Math.max(0, Math.min(99, 100 - warningPct)) / 100;
        // Storage alert thresholds block
        const thresholdsBlock = `
            <div style="position:relative; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:12px; padding:16px; margin-bottom:20px; overflow:hidden;" id="storage-alert-thresholds-block" class="${alertEnabled ? '' : 'config-disabled'}" data-i18n-content="settings.disabledOverlay" data-content="${alertEnabled ? '' : t('settings.disabledOverlay')}">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:${alertEnabled ? '12px' : '0px'}">
                    <div style="font-size:14px; font-weight:700; color:var(--text-primary); position:relative; z-index:60; pointer-events:auto;">${t('storage.alertThresholds')}</div>
                    <label class="bmm-switch" data-tooltip="${alertEnabled ? t('settings.disabledOverlay') : t('settings.disabledOverlay')}" style="position:relative; z-index:60; pointer-events:auto;">
                        <input type="checkbox" id="chk-alert-enabled" ${alertEnabled ? 'checked' : ''}>
                        <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                    </label>
                </div>
                ${alertEnabled ? `
                <div style="display:flex; gap:16px; flex-wrap:wrap;">
                    <div style="flex:1; min-width:200px;">
                        <label style="font-size:11px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:4px;">${t('storage.alertLimit')}</label>
                        <input type="number" id="input-warning-pct" class="form-input" value="${warningPct}" min="1" max="99" style="width:100%; font-size:13px; padding:8px 10px;">
                    </div>
                    <div style="flex:1; min-width:200px;">
                        <label style="font-size:11px; font-weight:600; color:var(--bmm-danger); display:block; margin-bottom:4px;">${t('storage.alertCritical')}</label>
                        <input type="number" id="input-critical-pct" class="form-input" value="${criticalPct}" min="0" max="99" style="width:100%; font-size:13px; padding:8px 10px; border-color:rgba(239,68,68,0.3);">
                    </div>
                </div>` : `
                <div style="padding-top:6px;">
                    <span style="font-size:12px;color:var(--text-muted)">${t('storage.alertDisabledHint')}</span>
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
                    <div style="font-size:14px; font-weight:800; color:var(--text-bright)">${t('storage.autoCalibTitle')}</div>
                    <div style="font-size:11px; color:var(--text-muted); line-height:1.4">${t('storage.autoCalibDesc')}</div>
                </div>
                <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
                    <label class="bmm-switch">
                        <input type="checkbox" id="chk-auto-io" ${isAuto ? 'checked' : ''}>
                        <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                    </label>
                    <button id="btn-reset-limits" class="btn btn-outline-danger btn-xs" style="font-size:9px; height:20px; padding:0 8px; border-radius:6px; font-weight:800; border-color:rgba(239, 68, 68, 0.2);">
                        ${t('storage.resetBtn')}
                    </button>
                </div>
            </div>

            <div style="background:rgba(34,197,94,0.05); border:1px solid rgba(34,197,94,0.2); border-radius:12px; padding:16px; margin-bottom:20px; display:flex; align-items:center; gap:16px">
                <div style="width:40px; height:40px; background:rgba(34,197,94,0.1); border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                </div>
                <div style="flex:1">
                    <div style="font-size:14px; font-weight:800; color:var(--text-bright)">${t('storage.smartIoTitle')}</div>
                    <div style="font-size:11px; color:var(--text-muted); line-height:1.4">${t('storage.smartIoDesc')}</div>
                </div>
                <label class="bmm-switch">
                    <input type="checkbox" id="chk-smart-io" ${smartIo ? 'checked' : ''}>
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
                toast(t('storage.autoCalibToast'), 'info');
                runAutoBenchmarks(disks);
            }
        });
        document.getElementById('btn-reset-limits')?.addEventListener('click', () => {
            resetStorageLimits();
        });
        // Smart I/O toggle
        document.getElementById('chk-smart-io')?.addEventListener('change', async (e) => {
            settings.smart_io_enabled = e.target.checked;
            await updateSettings(settings);
            toast(t(e.target.checked ? 'storage.smartIoOnToast' : 'storage.smartIoOffToast'), 'info');
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
                    return `<span style="background:rgba(245,158,11,0.15);color:var(--bmm-warning);padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">🌐 ${disk.cloud_provider}</span>`;
                return `<span style="background:rgba(168,85,247,0.15);color:var(--bmm-purple);padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">☁️ ${disk.cloud_provider}</span>`;
            }
            if (disk.kind === 'SSD')
                return '<span style="background:rgba(59,130,246,0.15);color:var(--bmm-accent);padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">SSD</span>';
            if (disk.kind === 'HDD')
                return '<span style="background:rgba(245,158,11,0.15);color:var(--bmm-warning);padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">HDD</span>';
            return '<span style="background:rgba(156,163,175,0.15);color:var(--bmm-text-muted);padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">' + disk.kind + '</span>';
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
            <div class="storage-disk-card">
                <div class="storage-disk-header">
                    <div class="storage-disk-identity">
                        <div style="width:42px;height:42px;background:var(--accent-dim);border:1px solid var(--border-accent);border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:var(--accent-glow);">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5">
                                <rect x="2" y="4" width="20" height="16" rx="2" ry="2"/>
                                <line x1="6" y1="12" x2="6.01" y2="12"/>
                            </svg>
                        </div>
                        <div class="storage-disk-meta">
                            <div class="storage-disk-name">
                                ${escHtml(disk.name)}
                                ${getKindBadge(disk)}
                                <span style="font-size:10px;color:var(--text-muted);background:rgba(255,255,255,0.04);padding:1px 6px;border-radius:4px;margin-left:4px;">${escHtml(disk.file_system)}</span>
                            </div>
                            <div class="storage-disk-path">${escHtml(disk.mount_point)}</div>
                        </div>
                    </div>
                    <div class="storage-disk-actions">
                        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
                            <span style="font-size:9px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Limit</span>
                            <div style="display:flex;align-items:center;gap:6px;">
                                <input type="number" min="0" step="10" class="form-input disk-limit-input" data-mount="${escHtml(disk.mount_point)}" value="${limitVal}" style="width:80px;font-size:12px;padding:4px 8px;text-align:right;border-radius:6px;background:rgba(0,0,0,0.2);" placeholder="0">
                                <span style="font-size:11px;color:var(--text-muted);font-weight:700;">MB/s</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="storage-usage-container">
                    <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:6px;font-family:var(--font-mono);">
                        <span style="font-weight:500;">USED: <span style="color:var(--text-secondary);">${formatBytes(disk.total_space_bytes - disk.available_space_bytes)}</span> / ${formatBytes(disk.total_space_bytes)}</span>
                        <span style="color:${usedColor};font-weight:900;">${usedPct}%</span>
                    </div>
                    <div class="storage-usage-bar">
                        <div class="storage-usage-fill" style="width:${usedPct}%;background:${usedColor};box-shadow:0 0 15px ${usedColor}66;"></div>
                    </div>
                </div>

                ${(() => {
                // Profile-aware section: show how much available space profiles need
                const profileTotal = (window.__profileTotalPerDisk
                    ?.get(disk.mount_point)) || 0;
                if (profileTotal === 0)
                    return '';
                const avail = disk.available_space_bytes;
                const ratio = avail > 0 ? profileTotal / avail : 1;
                const barPct = Math.min(ratio * 100, 100);
                const isCrit = profileTotal > avail;
                // Use configurable warningPct: warn when profiles use more than (100 - warningPct)% of available space
                // e.g. warningPct=40 → warn when profiles use > 60% of available space
                const warnThreshold = Math.max(0, Math.min(99, 100 - warningPct)) / 100;
                const isWarn = !isCrit && ratio > warnThreshold;
                const barCol = isCrit ? '#ef4444' : isWarn ? '#f59e0b' : '#10b981';
                const labelCol = isCrit ? '#f87171' : isWarn ? '#fbbf24' : 'var(--text-muted)';
                return `
                    <div class="storage-usage-container" style="margin-top:8px;">
                        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:6px;font-family:var(--font-mono);">
                            <span style="font-weight:500;display:flex;align-items:center;gap:5px;">
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="7" height="7" rx="1"/><rect x="15" y="3" width="7" height="7" rx="1"/><rect x="2" y="14" width="7" height="7" rx="1"/><rect x="15" y="14" width="7" height="7" rx="1"/></svg>
                                PROFILES: <span style="color:var(--text-secondary);">${formatBytes(profileTotal)}</span> / ${formatBytes(avail)} ${t('storage.available') || 'available'}
                            </span>
                            <span style="color:${labelCol};font-weight:900;">${Math.round(ratio * 100)}%</span>
                        </div>
                        <div class="storage-usage-bar">
                            <div class="storage-usage-fill" style="width:${barPct}%;background:${barCol};box-shadow:0 0 12px ${barCol}55;transition:width 0.4s ease;"></div>
                        </div>
                        ${isCrit ? `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin-top:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:10px;font-size:11px;color:var(--bmm-danger);font-weight:700;animation:pulse-danger 2s infinite;">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                            ${t('storage.profilesCritical') || 'Profile mods (' + formatBytes(profileTotal) + ') exceed available space (' + formatBytes(avail) + ')'}
                        </div>` : isWarn ? `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin-top:8px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:10px;font-size:11px;color:var(--bmm-warning);font-weight:600;">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                            ${t('storage.profilesWarning') || 'Profile mods are using ' + Math.round(ratio * 100) + '% of available disk space'}
                        </div>` : ''}
                    </div>`;
            })()}


                ${profilePills ? `<div style="display:flex;flex-wrap:wrap;gap:8px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.03);">${profilePills}</div>` : ''}

                <div style="display:flex;align-items:center;gap:8px;">
                    <button class="btn btn-add disk-bench-btn" data-mount="${disk.mount_point}" style="font-size:12px;gap:6px;padding:6px 14px;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                        <span data-i18n="storage.benchmark">${t('storage.benchmark')}</span>
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
                        toast(t('common.success'), 'success');
                    }
                    catch (err) {
                        toast((window.t ? window.t('common.error') : 'Error') + ': ' + err, 'error');
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
                btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> <span>${t('storage.benchmarking')}</span>`;
                try {
                    const res = await invoke('benchmark_disk', { mountPoint });
                    resultSpan.innerHTML = `
                        <span style="color:var(--bmm-accent);">↓ ${res.read_mb_s} MB/s</span>
                        <span style="margin:0 4px;">·</span>
                        <span style="color:var(--bmm-purple);">↑ ${res.write_mb_s} MB/s</span>
                        <span style="margin:0 4px;">·</span>
                        <span style="color:var(--bmm-success);">${t('storage.suggestedLimit')}: ${res.suggested_limit} MB/s</span>
                        <button class="btn btn-ghost btn-sm disk-apply-suggestion" data-mount="${mountPoint}" data-value="${res.suggested_limit}" style="font-size:10px;padding:2px 8px;margin-left:4px;">${t('storage.applySuggested')}</button>
                    `;
                    resultSpan.querySelector('.disk-apply-suggestion')?.addEventListener('click', async (ev) => {
                        const sugVal = parseInt(ev.target.getAttribute('data-value'), 10);
                        const mp = ev.target.getAttribute('data-mount');
                        const input = btn.closest('.storage-disk-card').querySelector('.disk-limit-input');
                        if (input)
                            input.value = sugVal;
                        try {
                            await invoke('set_disk_limit', { mountPoint: mp, limitMbS: sugVal });
                            toast(t('common.success'), 'success');
                        }
                        catch (err) {
                            toast((window.t ? window.t('common.error') : 'Error') + ': ' + err, 'error');
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
        container.innerHTML = `<div style="font-size:12px;color:var(--error);text-align:center;padding:30px;">${t('storage.error', { err: String(err) })}</div>`;
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
                ${languages.map(l => {
            const protectedLang = ['en', 'fr', 'template'].includes((l.code || '').toLowerCase());
            return `
                    <div class="nav-lang-row${l.active ? ' active' : ''}">
                        <button class="nav-lang-option" data-lang="${l.code}" style="flex:1;">
                            <span class="nav-lang-flag" style="margin-right:10px">${getFlag(l)}</span>
                            <span>${l.name}</span>
                            ${l.active ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="3" style="margin-left:auto"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                        </button>
                        ${protectedLang ? '' : `
                            <button class="nav-lang-dl" data-lang-dl="${l.code}" data-tooltip="${t('settings.langDownload') || 'Download .json'}">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            </button>
                            <button class="nav-lang-del" data-lang-del="${l.code}" data-lang-name="${escHtml(l.name)}" data-tooltip="${t('settings.langRemove') || 'Remove language'}">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>`}
                    </div>`;
        }).join('')}
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
            // Download a custom language's .json
            menu.querySelectorAll('.nav-lang-dl').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const code = btn.dataset.langDl || '';
                    try {
                        const content = await invoke('get_language_content', { lang: code });
                        const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${code}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                    }
                    catch (err) {
                        toast(String(err), 'error');
                    }
                });
            });
            // Remove a custom language (with confirm). Offers a download first if wanted.
            menu.querySelectorAll('.nav-lang-del').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const code = btn.dataset.langDel || '';
                    const name = btn.dataset.langName || code;
                    const ok = confirm((t('settings.langRemoveConfirm') || 'Remove language "{name}" ({code})? This deletes its .json file.')
                        .replace('{name}', name).replace('{code}', code.toUpperCase()));
                    if (!ok)
                        return;
                    try {
                        // if the removed language is active, fall back to English first
                        const langs = getLanguages();
                        if (langs.find(l => l.code === code && l.active))
                            setLang('en');
                        await invoke('delete_language_file', { code });
                        toast((t('settings.langRemoved') || 'Removed {name}').replace('{name}', name), 'success');
                        // reload language files in-memory, then re-render
                        const { reloadLanguages } = await import('../../core/i18n.js');
                        if (typeof reloadLanguages === 'function')
                            await reloadLanguages();
                        renderLangs();
                        if (typeof initNavbarLangDropdown === 'function')
                            initNavbarLangDropdown();
                    }
                    catch (err) {
                        toast(String(err), 'error');
                    }
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
            toast(t('common.success'), 'success');
        }
        catch (e) {
            toast(t('settings.langDownloadError', { err: String(e) }), 'error');
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
// The form's transient state. Module-scoped, NOT on window: as globals these
// outlived the form. Click the pencil on a tag, change your mind, type a NEW name
// and press the button — it still meant "update", so the old tag was renamed and
// no new tag was created. Nothing cleared the edit id but a successful save.
// Every render of the panel now resets it, and there is a visible way out.
let _tagIconRef = '';
let _tagEditId = null;
function _tagFormReset() {
    _tagIconRef = '';
    _tagEditId = null;
    const nameInput = document.getElementById('setting-tag-name');
    if (nameInput)
        nameInput.value = '';
    const prev = document.getElementById('setting-tag-icon-preview');
    if (prev)
        prev.textContent = '＋';
    const span = document.getElementById('btn-create-tag')?.querySelector('span');
    if (span)
        span.textContent = t('settings.tagCreate') || 'Creer';
    const cancel = document.getElementById('btn-cancel-tag-edit');
    if (cancel)
        cancel.style.display = 'none';
}
export async function renderSettingsTags() {
    const list = document.getElementById('settings-tags-list');
    if (!list)
        return;
    _tagFormReset();
    try {
        const tags = await invoke('get_tags');
        list.innerHTML = '';
        if (tags.length === 0) {
            list.innerHTML = `<span style="color:var(--text-muted);font-size:12px;font-style:italic">${t('settings.tagNoneYet')}</span>`;
            return;
        }
        // One renderer for every tag chip in the app (ui/icon-pack.ts) — five
        // hand-rolled copies had already drifted apart.
        const iconMod = await import('../../ui/icon-pack.js');
        await iconMod.ensurePacksFor(tags.map((tg) => tg.icon));
        tags.forEach(tag => {
            const wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;align-items:center;gap:4px';
            wrap.innerHTML = iconMod.renderTagChip(tag, { fontSize: 12, pad: '4px 10px' })
                + `<button data-id="${tag.id}" class="btn-edit-tag" title="${escHtml(t('common.edit') || 'Edit')}" style="background:none;border:none;color:${tag.color};cursor:pointer;padding:0;opacity:0.7">✎</button>`
                + `<button data-id="${tag.id}" class="btn-del-tag" onmouseenter="window.showTaskyHelp('settings.tagDeleteTip', 'trash')" onmouseleave="window.hideTaskyHelp()" style="background:none;border:none;color:${tag.color};cursor:pointer;padding:0;font-size:14px">&times;</button>`;
            list.appendChild(wrap);
        });
        // Edit: prefill the form, flip the create button to save (same handler).
        list.querySelectorAll('.btn-edit-tag').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tag = tags.find(tg => tg.id === btn.dataset.id);
                if (!tag)
                    return;
                document.getElementById('setting-tag-name').value = tag.name;
                document.getElementById('setting-tag-color').value = tag.color;
                const grad = document.getElementById('setting-tag-grad');
                const c2 = document.getElementById('setting-tag-color2');
                if (grad && c2) {
                    grad.checked = !!tag.color2;
                    c2.classList.toggle('tag-color2-hidden', !tag.color2);
                    if (tag.color2)
                        c2.value = tag.color2;
                }
                _tagIconRef = tag.icon || '';
                const prev = document.getElementById('setting-tag-icon-preview');
                if (prev)
                    prev.innerHTML = (iconMod.isPackIcon(tag.icon) && iconMod.renderPackIcon(tag.icon, 18)) || '＋';
                _tagEditId = tag.id;
                const cbtn = document.getElementById('btn-create-tag');
                const span = cbtn?.querySelector('span');
                if (span)
                    span.textContent = t('common.save') || 'Enregistrer';
                const cancel = document.getElementById('btn-cancel-tag-edit');
                if (cancel)
                    cancel.style.display = '';
            });
        });
        list.querySelectorAll('.btn-del-tag').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ok = await window.confirmCustom(t('common.delete') || 'Delete Tag', t('settings.tagDeleteConfirm'), 'danger', { yesLabel: t('common.delete') || 'Delete' });
                if (ok) {
                    try {
                        await invoke('delete_tag', { tagId: btn.dataset.id });
                        toast(t('settings.tagDeleted'), 'success');
                        renderSettingsTags();
                        if (window._refreshModsFn)
                            window._refreshModsFn();
                    }
                    catch (err) {
                        toast(t('settings.tagDeleteError', { err: String(err) }), 'error');
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
// ── Security Settings ──────────────────────────────────────
async function initSecuritySettings() {
    const cardFull = document.getElementById('settings-sec-full');
    const cardLimited = document.getElementById('settings-sec-limited');
    const btnApply = document.getElementById('btn-settings-apply-security');
    const applyMsg = document.getElementById('security-apply-msg');
    if (!cardFull || !cardLimited || !btnApply)
        return;
    let initialMode = 'full';
    let currentSelected = 'full';
    try {
        const settings = await getSettings();
        initialMode = settings.fs_security_mode || 'full';
        currentSelected = initialMode;
        updateUI(initialMode);
    }
    catch (e) {
        console.error('Failed to load security settings:', e);
    }
    function updateUI(mode) {
        currentSelected = mode;
        const ciFull = cardFull.querySelector('.check-indicator');
        const ciLim = cardLimited.querySelector('.check-indicator');
        const iconFull = document.getElementById('settings-sec-full-icon');
        const iconLimited = document.getElementById('settings-sec-limited-icon');
        if (mode === 'full') {
            cardFull.classList.add('active');
            cardLimited.classList.remove('active');
            if (ciFull)
                ciFull.style.display = 'flex';
            if (ciLim)
                ciLim.style.display = 'none';
            // Icon box: active card gets accent colour, inactive goes muted
            if (iconFull) {
                iconFull.style.background = 'rgba(59,130,246,0.15)';
                iconFull.style.color = 'var(--accent)';
                iconFull.style.border = '1px solid rgba(59,130,246,0.3)';
            }
            if (iconLimited) {
                iconLimited.style.background = 'rgba(255,255,255,0.05)';
                iconLimited.style.color = 'var(--text-muted)';
                iconLimited.style.border = '1px solid rgba(255,255,255,0.1)';
            }
        }
        else {
            cardFull.classList.remove('active');
            cardLimited.classList.add('active');
            if (ciFull)
                ciFull.style.display = 'none';
            if (ciLim)
                ciLim.style.display = 'flex';
            if (iconFull) {
                iconFull.style.background = 'rgba(255,255,255,0.05)';
                iconFull.style.color = 'var(--text-muted)';
                iconFull.style.border = '1px solid rgba(255,255,255,0.1)';
            }
            if (iconLimited) {
                iconLimited.style.background = 'rgba(59,130,246,0.15)';
                iconLimited.style.color = 'var(--accent)';
                iconLimited.style.border = '1px solid rgba(59,130,246,0.3)';
            }
        }
        btnApply.disabled = currentSelected === initialMode;
    }
    const addGlowEffect = (card) => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            card.style.setProperty('--x', `${x}px`);
            card.style.setProperty('--y', `${y}px`);
        });
    };
    addGlowEffect(cardFull);
    addGlowEffect(cardLimited);
    cardFull.onclick = () => updateUI('full');
    cardLimited.onclick = () => updateUI('limited');
    btnApply.onclick = async () => {
        btnApply.disabled = true;
        btnApply.innerHTML = `<span>${t('common.loading') || '...'}</span>`;
        try {
            const settings = await getSettings();
            settings.fs_security_mode = currentSelected;
            await updateSettings(settings);
            await invoke('apply_fs_security_mode_command');
            initialMode = currentSelected;
            btnApply.innerHTML = `<span>${t('security.modal.apply')}</span>`;
            if (applyMsg) {
                applyMsg.style.opacity = '1';
                setTimeout(() => { if (applyMsg)
                    applyMsg.style.opacity = '0'; }, 3000);
            }
            toast(t('common.success'), 'success');
        }
        catch (err) {
            console.error('Failed to apply security mode:', err);
            toast(t('common.error'), 'error');
            btnApply.disabled = false;
            btnApply.innerHTML = `<span>${t('security.modal.apply')}</span>`;
        }
    };
}
window.recalculateModSha = async (modId) => {
    try {
        toast(t('mods.sha.calculating') || 'Calculating hashes...', 'info');
        await invoke('recalculate_mod_sha', { modId });
        if (window._refreshModsFn)
            window._refreshModsFn();
    }
    catch (err) {
        toast(t('common.error') + ' : ' + err, 'error');
    }
};
window.deleteModHashes = async (modId) => {
    const ok = await window.confirmCustom(t('mods.sha.deleteConfirmTitle') || 'Delete Hashes', t('mods.sha.deleteConfirm') || 'Are you sure you want to delete the hashes for this mod?', 'danger', { yesLabel: t('common.delete') });
    if (ok) {
        try {
            await invoke('delete_mod_hashes', { modId });
            toast(t('mods.sha.deleted') || 'Hashes deleted', 'success');
            if (window._refreshModsFn)
                window._refreshModsFn();
            // Refresh detail panel if open
            const detailModId = document.getElementById('mod-detail-container')?._currentModId;
            if (detailModId === modId) {
                import('../mods/mods-details.js').then(m => m.renderModDetail(detailModId));
            }
        }
        catch (err) {
            toast(t('common.error') + ' : ' + err, 'error');
        }
    }
};
window.showHashingStats = async () => {
    try {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay open';
        overlay.id = 'modal-sha-stats';
        overlay.style.zIndex = '100002';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.pointerEvents = 'auto';
        overlay.style.animation = 'modal-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)';
        const content = document.createElement('div');
        content.className = 'modal glass';
        content.style.maxWidth = '850px';
        content.style.width = '95%';
        content.style.maxHeight = '90vh';
        content.style.display = 'flex';
        content.style.flexDirection = 'column';
        content.style.pointerEvents = 'auto';
        let currentProfileId = null;
        let profiles = [];
        try {
            profiles = await invoke('get_profiles');
        }
        catch (e) { }
        content.innerHTML = `
            <div class="modal-header">
                <div style="display:flex;align-items:center;gap:12px">
                    <div style="width:36px;height:36px;background:rgba(59,130,246,0.12);border-radius:10px;display:flex;align-items:center;justify-content:center">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
                    </div>
                    <div>
                        <h2 class="modal-title">${t('settings.shaStatsBtn') || 'Hashing Progress'}</h2>
                        <p style="font-size:11px;color:var(--text-muted);margin:2px 0 0">${t('settings.shaStatsDesc') || 'Monitor and manage mod file integrity calculation'}</p>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:12px">
                    <select id="sha-profile-select" class="form-select" style="background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:var(--text-primary);border-radius:8px;padding:6px 12px;font-size:12px;outline:none">
                        <option value="">${t('common.global') || 'Global (All)'}</option>
                        ${profiles.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}
                    </select>
                    <button class="modal-close" onclick="window.closeShaStats()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>
            </div>
            <div class="modal-body" id="sha-stats-body" style="overflow-y:auto;flex:1;padding:24px;display:flex;flex-direction:column;gap:20px;">
            </div>
            <div class="modal-footer" style="padding:18px 24px; border-top:1px solid rgba(255,255,255,0.05); display:flex; justify-content:flex-end; gap:12px; background:rgba(0,0,0,0.2)">
                <button class="btn btn-secondary" style="height:40px; padding:0 32px; font-weight:700; border-radius:10px" onclick="window.closeShaStats()">${t('common.close') || 'Close'}</button>
            </div>
        `;
        const profileSelect = content.querySelector('#sha-profile-select');
        profileSelect.onchange = () => {
            currentProfileId = profileSelect.value || null;
            renderContent();
        };
        const renderContent = async () => {
            try {
                const stats = await invoke('get_hashing_stats', { profileId: currentProfileId });
                const percent = stats.total_mods > 0 ? Math.round((stats.hashed_mods / stats.total_mods) * 100) : 0;
                const settings = await getSettings();
                const lazyEnabled = settings?.enable_lazy_sha_calculation ?? true;
                const body = content.querySelector('#sha-stats-body');
                if (!body)
                    return;
                body.innerHTML = `
                    <!-- Main Progress Card -->
                    <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:16px; padding:24px; position:relative; overflow:hidden; box-shadow:inset 0 0 20px rgba(0,0,0,0.2)">
                        <div style="display:flex; align-items:center; gap:24px; position:relative; z-index:1">
                            <div style="width:70px; height:70px; background:var(--accent); border-radius:18px; display:flex; align-items:center; justify-content:center; box-shadow: 0 10px 20px rgba(59, 130, 246, 0.3)">
                                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                            </div>
                            <div style="flex:1">
                                <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:12px">
                                    <div style="font-size:38px; font-weight:900; color:var(--text-bright); line-height:1; font-family:var(--font-mono); letter-spacing:-0.02em">${percent}%</div>
                                    <div style="font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:0.05em">
                                        ${stats.hashed_mods} / ${stats.total_mods} ${t('settings.shaStatsHashed') || 'Hashed'}
                                    </div>
                                </div>
                                <div style="height:10px; background:rgba(0,0,0,0.4); border-radius:10px; overflow:hidden; border:1px solid rgba(255,255,255,0.05)">
                                    <div style="width:${percent}%; height:100%; background:var(--accent); border-radius:10px; transition:width 1.2s cubic-bezier(0.34, 1.56, 0.64, 1); box-shadow:0 0 20px rgba(59, 130, 246, 0.4)"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Stats Grid -->
                    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:16px">
                        <!-- Valid -->
                        <div style="background:rgba(16, 185, 129, 0.05); border:1px solid rgba(16, 185, 129, 0.15); border-radius:14px; padding:16px; box-shadow:inset 0 0 15px rgba(0,0,0,0.1)">
                            <div style="font-size:11px; color:var(--bmm-success); text-transform:uppercase; font-weight:700; margin-bottom:6px; letter-spacing:0.05em; display:flex; align-items:center; gap:6px">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                                ${t('hashes.status.verified') || 'Valid'}
                            </div>
                            <div style="font-size:24px; font-weight:800; color:var(--text-bright); font-family:var(--font-mono)">${stats.valid_mods ?? 0}</div>
                        </div>
                        
                        <!-- Invalid -->
                        <div style="background:rgba(239, 68, 68, 0.05); border:1px solid rgba(239, 68, 68, 0.15); border-radius:14px; padding:16px; box-shadow:inset 0 0 15px rgba(0,0,0,0.1)">
                            <div style="font-size:11px; color:var(--bmm-danger); text-transform:uppercase; font-weight:700; margin-bottom:6px; letter-spacing:0.05em; display:flex; align-items:center; gap:6px">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                ${t('hashes.status.invalid') || 'Invalid'}
                            </div>
                            <div style="font-size:24px; font-weight:800; color:var(--text-bright); font-family:var(--font-mono)">${stats.invalid_mods ?? 0}</div>
                        </div>
                        
                        <!-- Missing -->
                        <div style="background:rgba(255, 255, 255, 0.02); border:1px solid rgba(255, 255, 255, 0.08); border-radius:14px; padding:16px; box-shadow:inset 0 0 15px rgba(0,0,0,0.1)">
                            <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:700; margin-bottom:6px; letter-spacing:0.05em; display:flex; align-items:center; gap:6px">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                                ${t('hashes.status.missing') || 'Missing'}
                            </div>
                            <div style="font-size:24px; font-weight:800; color:var(--text-bright); font-family:var(--font-mono)">${stats.missing_mods ?? 0}</div>
                        </div>
                        
                        <!-- Queue -->
                        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:14px; padding:16px; box-shadow:inset 0 0 15px rgba(0,0,0,0.1)">
                            <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:700; margin-bottom:6px; letter-spacing:0.05em; display:flex; align-items:center; gap:6px">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                                ${t('settings.shaStatsQueue') || 'Queue'}
                            </div>
                            <div style="font-size:24px; font-weight:800; color:var(--text-bright); font-family:var(--font-mono)">${stats.queue_size}</div>
                        </div>
                    </div>

                    ${stats.is_active && stats.current_mod_name ? `
                        <div style="background:rgba(99, 102, 241, 0.03); border:1px solid rgba(99, 102, 241, 0.1); border-radius:14px; padding:14px 20px; display:flex; align-items:center; gap:12px">
                            <span class="spinner-tiny" style="width:18px; height:18px; border:2px solid rgba(99, 102, 241, 0.2); border-top-color:var(--accent)"></span>
                            <div style="flex:1; overflow:hidden">
                                <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:700; margin-bottom:2px; letter-spacing:0.05em">${t('common.processing') || 'Processing'}</div>
                                <div style="font-size:13px; font-weight:600; color:var(--accent); white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${stats.current_mod_name}</div>
                            </div>
                        </div>
                    ` : ''}

                    <!-- Settings Card -->
                    <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:14px; overflow:hidden">
                         <div style="display:flex; justify-content:space-between; align-items:center; padding:18px 20px">
                            <div style="flex:1">
                                <div style="font-size:14px; font-weight:700; color:var(--text-primary)">${t('settings.shaEnableLazy') || 'Background Hashing'}</div>
                                <div style="font-size:12px; color:var(--text-muted); margin-top:2px">${t('settings.shaEnableLazyDesc') || 'Automatically calculate missing hashes in the background'}</div>
                            </div>
                            <label class="bmm-switch">
                                <input type="checkbox" id="modal-chk-sha-lazy" ${lazyEnabled ? 'checked' : ''}>
                                <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                            </label>
                        </div>
                    </div>
                `;
                // Wire up toggle
                const toggle = body.querySelector('#modal-chk-sha-lazy');
                if (toggle) {
                    toggle.onchange = async () => {
                        const settings = await getSettings();
                        settings.enable_lazy_sha_calculation = toggle.checked;
                        await updateSettings(settings);
                        if (toggle.checked) {
                            await invoke('trigger_sha_background_population');
                        }
                        // Sync main settings UI if it exists
                        const mainToggle = document.getElementById('chk-sha-lazy-calc');
                        if (mainToggle)
                            mainToggle.checked = toggle.checked;
                    };
                }
            }
            catch (err) {
                console.error('Render hashing stats error:', err);
            }
        };
        renderContent();
        const refreshInterval = setInterval(renderContent, 1000);
        window.closeShaStats = () => {
            clearInterval(refreshInterval);
            overlay.classList.remove('open');
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 250);
        };
        overlay.onclick = (e) => { if (e.target === overlay)
            window.closeShaStats(); };
        overlay.appendChild(content);
        (document.getElementById('app-window-outer') || document.body).appendChild(overlay);
    }
    catch (err) {
        toast(t('common.error') + ' : ' + err, 'error');
    }
};
window.recalculateAllHashesPrompt = async () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.id = 'modal-sha-recalc';
    overlay.style.zIndex = '100001';
    overlay.style.pointerEvents = 'auto';
    overlay.style.animation = 'modal-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)';
    const content = document.createElement('div');
    content.className = 'modal glass';
    content.style.maxWidth = '450px';
    content.style.width = '90%';
    content.style.pointerEvents = 'auto';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.innerHTML = `
        <div class="modal-header">
            <div style="display:flex;align-items:center;gap:12px">
                <div style="width:36px;height:36px;background:rgba(245,158,11,0.12);border-radius:10px;display:flex;align-items:center;justify-content:center">
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                </div>
                <div>
                    <h2 class="modal-title">${t('settings.shaRecalculateTitle')}</h2>
                    <p style="font-size:11px;color:var(--text-muted);margin:2px 0 0">${t('common.actionRequired') || 'Action Required'}</p>
                </div>
            </div>
            <button class="modal-close" id="btn-recalc-x">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>
        </div>
        
        <div class="modal-body" style="padding:32px; text-align:center;">
            <p style="font-size:13px; color:var(--text-secondary); margin-bottom:32px; line-height:1.6">
                ${t('settings.shaRecalculateDesc')}
            </p>
            
            <div style="display:flex; flex-direction:column; gap:12px;">
                <button class="btn btn-primary" id="btn-recalc-missing" style="height:44px; font-weight:700">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:8px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
                    ${t('settings.shaRecalcMissing')}
                </button>
                <button class="btn btn-secondary" id="btn-recalc-all" style="height:44px; font-weight:600">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:8px"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
                    ${t('settings.shaRecalcAll')}
                </button>
            </div>
        </div>
        
        <div class="modal-footer" style="padding:16px 20px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:12px; background:rgba(0,0,0,0.1)">
            <button class="btn btn-ghost" id="btn-recalc-cancel" style="height:36px; padding:0 24px">${t('common.cancel')}</button>
        </div>
    `;
    overlay.appendChild(content);
    (document.getElementById('app-window-outer') || document.body).appendChild(overlay);
    const cleanup = () => {
        overlay.classList.remove('open');
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 250);
    };
    overlay.onclick = (e) => { if (e.target === overlay)
        cleanup(); };
    document.getElementById('btn-recalc-missing').onclick = async () => {
        await invoke('recalculate_all_hashes', { onlyMissing: true });
        toast(t('mods.sha.queued'), 'success');
        cleanup();
    };
    document.getElementById('btn-recalc-all').onclick = async () => {
        await invoke('recalculate_all_hashes', { onlyMissing: false });
        toast(t('mods.sha.queued'), 'success');
        cleanup();
    };
    document.getElementById('btn-recalc-cancel').onclick = cleanup;
    document.getElementById('btn-recalc-x').onclick = cleanup;
};
// ── Link this creator id to a BetterCommunity account ──────────────
// Local-first: BMM works fully offline. This only reaches the server when the user
// explicitly links; the server returns a short code to enter on the website.
// TEST MODE is now driven by app.cfg (BCTestMode / BCTestBase), resolved once at
// startup in links-config.ts. `bcTestMode()` / `bcTestBase()` / `bcRoot()` are imported
// from there — Settings only DISPLAYS the state (read-only); to change it, edit app.cfg.
async function openAccountLinkFlow() {
    let creatorId = '';
    try {
        creatorId = (await invoke('get_creator_id'));
    }
    catch (_) { }
    if (!creatorId || creatorId === '—') {
        toast(t('settings.link.noCreator') || 'No creator id yet.', 'warning');
        return;
    }
    const base = bcBase();
    let data;
    // Go through the native process (bc_api_post) — a direct webview fetch to the
    // BCWEB API is cross-origin (tauri.localhost) and is blocked by CORS preflight.
    // Rust isn't subject to CORS, so the request actually goes through.
    try {
        const raw = await invoke('bc_api_post', { url: `${base}/api/link/request`, body: JSON.stringify({ creatorId }) }, { quiet: true });
        data = JSON.parse(raw);
    }
    catch (_) {
        toast(t('settings.link.offline') || 'Could not reach BetterCommunity (offline?). BMM keeps working locally.', 'warning');
        return;
    }
    if (data?.linked) {
        toast(t('settings.link.already') || 'This creator id is already linked to an account.', 'info');
        return;
    }
    if (!data?.code) {
        toast(t('common.error') || 'Failed to get a link code.', 'error');
        return;
    }
    showLinkCodeModal(data.code, base);
}
function showLinkCodeModal(code, base) {
    document.getElementById('bc-link-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'bc-link-modal';
    // Absolutely fill the APP window container (not the OS window) so the backdrop
    // stays inside BMM's rounded frame and clicks land on the modal, not behind it.
    modal.style.cssText = 'position:absolute;inset:0;z-index:10500;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px)';
    modal.innerHTML = `
      <div style="width:100%;max-width:420px;background:var(--bmm-bg-elevated,#15171e);border:1px solid rgba(249,115,22,0.3);border-radius:18px;padding:24px;text-align:center;box-shadow:0 24px 70px rgba(0,0,0,0.5)">
        <div style="font-size:16px;font-weight:800;margin-bottom:6px">${escHtml(t('settings.link.title') || 'Link your BetterCommunity account')}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">${escHtml(t('settings.link.desc') || 'Enter this code on the website (Profile → Creator IDs). It expires in 15 minutes.')}</div>
        <div style="font-family:var(--font-mono,monospace);font-size:28px;font-weight:800;letter-spacing:4px;color:var(--bmm-warning);padding:14px;border-radius:12px;background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.2);margin-bottom:14px">${escHtml(code)}</div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button id="bc-link-copy" class="btn btn-sm btn-accent">${escHtml(t('common.copy') || 'Copy')}</button>
          <button id="bc-link-open" class="btn btn-sm">${escHtml(t('settings.link.open') || 'Open website')}</button>
          <button id="bc-link-close" class="btn btn-sm btn-ghost">${escHtml(t('common.close') || 'Close')}</button>
        </div>
      </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal)
        modal.remove(); });
    document.getElementById('bc-link-close')?.addEventListener('click', () => modal.remove());
    document.getElementById('bc-link-copy')?.addEventListener('click', () => { navigator.clipboard.writeText(code); toast(t('update.copied') || 'Copied!', 'success'); });
    document.getElementById('bc-link-open')?.addEventListener('click', () => { invoke('open_external_url', { url: `${base}/profile` }).catch(() => window.open(`${base}/profile`, '_blank')); });
}
// (BetterCommunity discover modal removed — linking + Discord actions live in the identity card below.)
function bcBase() {
    return bcRoot();
}
// Poll the account-link status and reflect it in the identity card. Detects an unlink
// (the account was linked and no longer is) and notifies the user.
async function refreshBcLinkStatus() {
    const statusEl = document.getElementById('bc-link-status');
    const linkBtn = document.getElementById('btn-bc-link');
    const discordBtn = document.getElementById('btn-bc-discord');
    let creatorId = '';
    try {
        creatorId = (await invoke('get_creator_id'));
    }
    catch (_) { }
    if (!creatorId || creatorId === '—') {
        if (statusEl)
            statusEl.textContent = t('settings.link.noCreator') || 'No creator id yet.';
        if (discordBtn)
            discordBtn.style.display = 'none';
        return;
    }
    let data = null;
    // Via the native process (bc_api_get) — a webview fetch to the BCWEB API is
    // cross-origin (tauri.localhost) and trips CORS; Rust isn't subject to it.
    try {
        data = JSON.parse(await invoke('bc_api_get', { url: `${bcBase()}/api/link/status?creatorId=${encodeURIComponent(creatorId)}` }, { quiet: true }));
    }
    catch (_) { }
    if (!data) {
        if (statusEl)
            statusEl.textContent = t('settings.link.offline2') || 'BetterCommunity unreachable (offline?).';
        return;
    }
    const wasLinked = localStorage.getItem('bc_linked') === '1';
    if (data.linked) {
        localStorage.setItem('bc_linked', '1');
        const dtxt = data.discord?.linked
            ? ` · Discord: ${escHtml(data.discord.username || 'linked')}`
            : ` · ${escHtml(t('settings.link.noDiscord') || 'Discord not linked')}`;
        if (statusEl)
            statusEl.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#34d399;display:inline-block;flex-shrink:0"></span> ${escHtml(t('settings.link.linkedAs') || 'Linked as')} <b style="color:var(--text)">${escHtml(data.displayName || '')}</b>${dtxt}`;
        if (linkBtn)
            linkBtn.textContent = t('settings.link.relink') || 'Re-link account';
        if (discordBtn) {
            discordBtn.style.display = '';
            discordBtn.textContent = data.discord?.linked ? (t('settings.link.relinkDiscord') || 'Re-link Discord') : (t('settings.link.discord') || 'Link Discord');
        }
    }
    else {
        if (wasLinked) {
            try {
                toast(t('settings.link.unlinked') || 'Your BetterCommunity account was unlinked.', 'warning');
            }
            catch (_) { }
        }
        localStorage.setItem('bc_linked', '0');
        if (statusEl)
            statusEl.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:var(--text-muted);display:inline-block;flex-shrink:0"></span> ${escHtml(t('settings.link.notLinked') || 'Not linked to a BetterCommunity account.')}`;
        if (linkBtn)
            linkBtn.textContent = t('settings.link.button') || 'Link to BetterCommunity account';
        if (discordBtn)
            discordBtn.style.display = 'none'; // must link the account before Discord
    }
}
// Link a Discord account from BMM: enter the code from the Discord /link command.
async function openDiscordLinkFlow() {
    let creatorId = '';
    try {
        creatorId = (await invoke('get_creator_id'));
    }
    catch (_) { }
    if (!creatorId || creatorId === '—') {
        toast(t('settings.link.noCreator') || 'No creator id yet.', 'warning');
        return;
    }
    document.getElementById('bc-discord-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'bc-discord-modal';
    modal.style.cssText = 'position:absolute;inset:0;z-index:10500;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px)';
    modal.innerHTML = `
      <div style="width:100%;max-width:420px;background:var(--bmm-bg-elevated,#15171e);border:1px solid rgba(249,115,22,0.3);border-radius:18px;padding:24px;box-shadow:0 24px 70px rgba(0,0,0,0.55)">
        <div style="font-size:16px;font-weight:800;margin-bottom:6px">${escHtml(t('settings.link.discordTitle') || 'Link your Discord')}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;line-height:1.5">${escHtml(t('settings.link.discordDesc') || 'In the BetterCommunity Discord, run /link to get a code, then enter it here.')}</div>
        <input id="bc-discord-code" placeholder="XXXX-XXXX" maxlength="9" style="width:100%;box-sizing:border-box;font-family:var(--font-mono,monospace);font-size:18px;font-weight:800;letter-spacing:3px;text-align:center;text-transform:uppercase;padding:12px;border-radius:10px;background:rgba(249,115,22,0.06);border:1px solid rgba(249,115,22,0.25);color:var(--text);outline:none;margin-bottom:14px">
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="bc-discord-cancel" class="btn btn-sm btn-ghost">${escHtml(t('common.close') || 'Cancel')}</button>
          <button id="bc-discord-submit" class="btn btn-sm btn-accent">${escHtml(t('settings.link.discordBtn') || 'Link Discord')}</button>
        </div>
      </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(modal);
    const input = document.getElementById('bc-discord-code');
    input.addEventListener('input', () => { const s = input.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8); input.value = s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s; });
    setTimeout(() => input.focus(), 50);
    modal.addEventListener('click', e => { if (e.target === modal)
        modal.remove(); });
    document.getElementById('bc-discord-cancel')?.addEventListener('click', () => modal.remove());
    const submit = async () => {
        const code = input.value.trim();
        if (code.replace(/[^a-zA-Z0-9]/g, '').length < 8) {
            toast(t('settings.link.badCode') || 'Enter the full code.', 'warning');
            return;
        }
        try {
            let data = {};
            let ok = true;
            // Native-process POST (bc_api_post) to dodge webview CORS. bc_api_post
            // rejects on a non-2xx with an `http_<code>` message; a 4xx here still
            // carries a JSON error body, so fall back to a direct parse on failure.
            try {
                data = JSON.parse(await invoke('bc_api_post', { url: `${bcBase()}/api/link/discord`, body: JSON.stringify({ creatorId, code }) }, { quiet: true }));
            }
            catch (e) {
                ok = false;
                try {
                    data = JSON.parse(String(e?.message || e || '').replace(/^http_\d+\s*/, '') || '{}');
                }
                catch (_) {
                    data = {};
                }
            }
            if (!ok) {
                const err = data?.error;
                toast(err === 'account_not_linked' ? (t('settings.link.needAccount') || 'Link your BetterCommunity account first.')
                    : err === 'already_linked' ? (t('settings.link.discordTaken') || 'That Discord account is already linked.')
                        : err === 'invalid_or_expired' ? (t('settings.link.discordBad') || 'Invalid or expired code.')
                            : (t('common.error') || 'Failed.'), 'error');
                return;
            }
            toast(t('settings.link.discordOk') || 'Discord linked!', 'success');
            modal.remove();
            refreshBcLinkStatus();
        }
        catch (_) {
            toast(t('settings.link.offline') || 'Could not reach BetterCommunity (offline?).', 'warning');
        }
    };
    document.getElementById('bc-discord-submit')?.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter')
        submit(); });
}
// ── Identity & API card ────────────────────────────────────
async function initSecurityInfoCard() {
    const elCreatorId = document.getElementById('sic-creator-id');
    const elApiToken = document.getElementById('sic-api-token');
    const elVersion = document.getElementById('sic-bmm-version');
    // Load values
    try {
        const [creatorId, apiToken] = await Promise.all([
            invoke('get_creator_id').catch(() => '—'),
            invoke('get_api_token').catch(() => '—'),
        ]);
        if (elCreatorId)
            elCreatorId.textContent = creatorId;
        if (elApiToken)
            elApiToken.textContent = apiToken;
    }
    catch (_) { }
    // BetterCommunity account: live link status (detects unlink), link, link Discord.
    if (elCreatorId && !document.getElementById('btn-bc-link')) {
        const card = elCreatorId.closest('.settings-card') || elCreatorId.parentElement?.parentElement || elCreatorId.parentElement;
        const status = document.createElement('div');
        status.id = 'bc-link-status';
        status.style.cssText = 'margin-top:12px;font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:7px';
        status.textContent = t('settings.link.checking') || 'Checking BetterCommunity link…';
        card?.appendChild(status);
        const row = document.createElement('div');
        row.style.cssText = 'margin-top:8px;display:flex;gap:8px;flex-wrap:wrap';
        const btn = document.createElement('button');
        btn.id = 'btn-bc-link';
        btn.className = 'btn btn-sm btn-accent';
        btn.textContent = t('settings.link.button') || 'Link to BetterCommunity account';
        btn.addEventListener('click', async () => { await openAccountLinkFlow(); setTimeout(refreshBcLinkStatus, 400); });
        row.appendChild(btn);
        const dbtn = document.createElement('button');
        dbtn.id = 'btn-bc-discord';
        dbtn.className = 'btn btn-sm';
        dbtn.style.display = 'none'; // shown once the account is linked
        dbtn.textContent = t('settings.link.discord') || 'Link Discord';
        dbtn.addEventListener('click', openDiscordLinkFlow);
        row.appendChild(dbtn);
        card?.appendChild(row);
        // ── BetterCommunity API key ──────────────────────────────────────────
        // Beside the account link because they answer adjacent questions, but they
        // are NOT the same thing and the copy says so: linking proves which account
        // is yours, a key lets BMM read something on your behalf. Conflating them is
        // how a user ends up expecting notifications from a link that never carried
        // a credential.
        const keyBox = document.createElement('details');
        keyBox.style.cssText = 'margin-top:12px;font-size:12px';
        // Built as a function, not a one-shot string. applyTranslations() only reaches
        // elements carrying data-i18n attributes; anything with t() baked into a
        // template literal keeps whatever language it was built in. This panel is all
        // template literal, so it re-renders on the langChanged event instead — the
        // same idiom the shortcuts manager below already uses.
        const keyBoxHtml = () => `
            <summary style="cursor:pointer;color:var(--text-secondary)">${escHtml(t('settings.bcKey.title') || 'BetterCommunity notifications')}</summary>
            <div style="margin-top:8px;color:var(--text-muted);line-height:1.5">${escHtml(t('settings.bcKey.desc') || 'Paste an API key with the notifications:read scope and BMM will show your BetterCommunity notifications in its notification centre. Create one on the website under Profile \u2192 API keys.')}</div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <input type="password" id="bc-api-key" class="input" style="flex:1;min-width:200px" placeholder="${escAttr(t('settings.bcKey.ph') || 'Paste your key')}" autocomplete="off" spellcheck="false">
                <button id="btn-bc-key-save" class="btn btn-sm btn-accent">${escHtml(t('common.save') || 'Save')}</button>
                <button id="btn-bc-key-clear" class="btn btn-sm">${escHtml(t('common.remove') || 'Remove')}</button>
            </div>
            <div id="bc-key-state" style="margin-top:7px;color:var(--text-muted)"></div>`;
        // Render AND bind together. Re-rendering the markup alone would leave three
        // dead buttons behind, which is the failure mode of every "just refresh the
        // HTML" language fix.
        const paintKeyBox = () => {
            keyBox.innerHTML = keyBoxHtml();
            const keyState = keyBox.querySelector('#bc-key-state');
            const keyInput = keyBox.querySelector('#bc-api-key');
            // The field is never PREFILLED. The backend does not hand the key back — that
            // is the point of storing it there — so the only honest thing to show is
            // whether one exists.
            const paintKeyState = async () => {
                let has = false;
                try {
                    has = await invoke('has_bcweb_api_key');
                }
                catch { /* offline-safe */ }
                keyState.textContent = has
                    ? (t('settings.bcKey.set') || 'A key is stored. Paste a new one to replace it.')
                    : (t('settings.bcKey.none') || 'No key stored — BetterCommunity notifications are off.');
            };
            void paintKeyState();
            keyBox.querySelector('#btn-bc-key-save')?.addEventListener('click', async () => {
                const v = keyInput.value.trim();
                if (!v)
                    return;
                try {
                    await invoke('set_bcweb_api_key', { key: v });
                    keyInput.value = ''; // never leave a credential sitting in the DOM
                    const m = await import('../../core/bcweb-notifications.js');
                    m.stopBcwebNotifications();
                    await m.startBcwebNotifications();
                    // Pull once immediately: a key you just pasted that shows nothing for
                    // ten minutes is indistinguishable from a key that does not work.
                    const n = await m.pullBcwebNotifications();
                    toast(n > 0
                        ? (t('settings.bcKey.okN') || '{n} notification(s) fetched.').replace('{n}', String(n))
                        : (t('settings.bcKey.ok') || 'Key saved.'), 'success');
                }
                catch (e) {
                    toast((t('common.error') || 'Error') + ': ' + e, 'error');
                }
                void paintKeyState();
            });
            keyBox.querySelector('#btn-bc-key-clear')?.addEventListener('click', async () => {
                try {
                    await invoke('set_bcweb_api_key', { key: '' });
                    keyInput.value = '';
                    (await import('../../core/bcweb-notifications.js')).stopBcwebNotifications();
                    toast(t('settings.bcKey.removed') || 'Key removed.', 'info');
                }
                catch (e) {
                    toast((t('common.error') || 'Error') + ': ' + e, 'error');
                }
                void paintKeyState();
            });
        };
        paintKeyBox();
        card?.appendChild(keyBox);
        // setLang dispatches langChanged. Same wired-once idiom as the shortcuts
        // manager further down this file.
        if (!keyBox._bcKeyLangWired) {
            keyBox._bcKeyLangWired = true;
            document.addEventListener('langChanged', () => { if (keyBox.isConnected)
                paintKeyBox(); });
        }
        // Dev/test config is now driven by app.cfg (BCTestMode / BCTestBase). Shown here
        // read-only so it's clear WHERE the blog/account link points and how to change it.
        const cfg = document.createElement('details');
        cfg.style.cssText = 'margin-top:10px;font-size:12px;color:var(--text-muted)';
        const on = bcTestMode();
        cfg.innerHTML = `
          <summary style="cursor:pointer;user-select:none">${escHtml(t('settings.link.advanced') || 'Server / test mode')}</summary>
          <div style="margin-top:8px;display:flex;align-items:center;gap:7px">
            <span style="width:8px;height:8px;border-radius:50%;background:${on ? 'var(--bmm-warning,#f59e0b)' : 'var(--bmm-success,#22c55e)'}"></span>
            ${on ? escHtml(t('settings.link.testmodeOn') || 'Test mode ON (staging server)') : escHtml(t('settings.link.testmodeOff') || 'Production')}
          </div>
          <div style="margin-top:6px;font-family:var(--font-mono,monospace);word-break:break-all">${escHtml(bcRoot())}</div>`;
        card?.appendChild(cfg);
        refreshBcLinkStatus();
        // Keep checking so an unlink done on the website is detected while settings are open.
        const iv = setInterval(() => { if (document.getElementById('bc-link-status'))
            refreshBcLinkStatus();
        else
            clearInterval(iv); }, 30000);
    }
    try {
        const tauri = window.__TAURI__;
        const version = tauri?.app?.getVersion ? await tauri.app.getVersion() : '—';
        if (elVersion)
            elVersion.textContent = `v${version}`;
    }
    catch (_) {
        if (elVersion)
            elVersion.textContent = '—';
    }
    // Reveal / hide toggles
    const _setupReveal = (btnId, targetId, eyeId) => {
        const btn = document.getElementById(btnId);
        const target = document.getElementById(targetId);
        const eye = document.getElementById(eyeId);
        if (!btn || !target)
            return;
        let revealed = false;
        btn.addEventListener('click', () => {
            revealed = !revealed;
            target.classList.toggle('revealed', revealed);
            btn.classList.toggle('is-revealed', revealed);
            if (eye) {
                eye.innerHTML = revealed
                    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
                    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
            }
        });
    };
    _setupReveal('btn-sic-reveal-creator', 'sic-creator-id', 'sic-eye-creator');
    _setupReveal('btn-sic-reveal-token', 'sic-api-token', 'sic-eye-token');
    // Copy helpers
    const _setupCopy = (btnId, sourceId) => {
        document.getElementById(btnId)?.addEventListener('click', async () => {
            const val = document.getElementById(sourceId)?.textContent || '';
            try {
                await navigator.clipboard.writeText(val);
                toast(t('common.copied') || 'Copié !', 'success');
            }
            catch (_) { }
        });
    };
    _setupCopy('btn-sic-copy-creator', 'sic-creator-id');
    _setupCopy('btn-sic-copy-token', 'sic-api-token');
    _setupCopy('btn-sic-copy-url', 'sic-api-url');
    // ── Configurable API port ──
    // The displayed URL + port field reflect settings.api_port; changing the
    // port updates settings (server rebinds on next launch — restart needed).
    try {
        const { getSettings, apiBase, setApiPort } = await import('../../core/api.js');
        const { applyTranslations } = await import('../../core/i18n.js');
        const cfg = await getSettings();
        const urlEl = document.getElementById('sic-api-url');
        const portEl = document.getElementById('sic-api-port');
        if (urlEl)
            urlEl.textContent = apiBase();
        if (portEl)
            portEl.value = String(cfg.api_port || 51274);
        // Save settings, rebind the API server LIVE on the new port, then refresh
        // the displayed URL + docs examples from the port it actually bound.
        const applyPort = async (p) => {
            const fresh = await getSettings();
            fresh.api_port = p;
            await invoke('update_settings', { settings: fresh });
            try {
                const bound = await invoke('restart_api_server');
                setApiPort(bound);
                if (urlEl)
                    urlEl.textContent = apiBase();
                if (portEl)
                    portEl.value = String(bound);
                applyTranslations(); // re-substitute the port in the docs curl examples
                toast(t('settings.identity.apiPortApplied') || `API port applied — now on :${bound}`, 'success', 3500);
            }
            catch (e) {
                // Couldn't rebind live → fall back to "restart to apply".
                toast(t('settings.identity.apiPortSaved') || 'API port saved — restart BMM to apply', 'warning', 3500);
            }
        };
        document.getElementById('btn-sic-save-port')?.addEventListener('click', async () => {
            const p = parseInt(portEl?.value || '', 10);
            if (!p || p < 1 || p > 65535) {
                toast(t('settings.identity.apiPortInvalid') || 'Invalid port (1–65535)', 'warning');
                return;
            }
            await applyPort(p);
        });
        document.getElementById('btn-sic-reset-port')?.addEventListener('click', async () => {
            await applyPort(51274);
        });
    }
    catch (_) { }
    // Reset API token
    document.getElementById('btn-sic-reset-token')?.addEventListener('click', async () => {
        const ok = await window.confirmCustom(t('settings.identity.resetTokenTitle') || 'Régénérer le token ?', t('settings.identity.resetTokenDesc') || 'L\'ancien token sera immédiatement révoqué. Tous les plugins utilisant ce token devront être mis à jour.', 'danger').catch(() => false);
        if (!ok)
            return;
        try {
            const newToken = await invoke('reset_api_token');
            if (elApiToken) {
                elApiToken.textContent = newToken;
                // Re-hide after reset
                elApiToken.classList.remove('revealed');
                const btn = document.getElementById('btn-sic-reveal-token');
                if (btn)
                    btn.classList.remove('is-revealed');
                const eye = document.getElementById('sic-eye-token');
                if (eye)
                    eye.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
            }
            toast(t('settings.identity.tokenReset') || 'Token régénéré avec succès.', 'success');
        }
        catch (err) {
            toast(t('common.error') + ' : ' + err, 'error');
        }
    });
}
// ── Settings Initializer ──────────────────────────────────
/** The community-source list for a type, from wherever that type keeps it. */
function readSources(type) {
    const key = STORE_KEY[type];
    if (!key)
        return []; // apps live in the Rust backend, handled separately below
    try {
        return JSON.parse(localStorage.getItem(key) || '[]');
    }
    catch {
        return [];
    }
}
/**
 * What every type already follows, for the preview to compare against.
 *
 * Built from STORE_KEY rather than listed, because a hand-written list was wrong: it named
 * plugin and theme, so preset and repo catalogs you already followed were reported as "will
 * add" every time and the import then claimed to have added them. Nothing was corrupted — the
 * writer deduplicates — but a preview that overstates what it will do is a preview nobody reads
 * twice.
 *
 * Apps are asked of the Rust backend, which is the only place their list exists.
 */
async function readAllSources() {
    const out = {};
    for (const type of Object.keys(STORE_KEY))
        out[type] = readSources(type);
    try {
        const state = await invoke('get_apps_state');
        out.app = state?.community_sources || [];
    }
    catch {
        // An unreachable backend means the app list is unknown, not empty. Empty is the safe
        // reading here: the preview over-reports, and add_community_source deduplicates anyway.
        out.app = [];
    }
    return out;
}
/**
 * Import a catalog index: one URL that names catalogs of several types.
 *
 * Preview first, always. This adds sources that BMM will fetch on every startup, from a
 * document on somebody else's server — showing what would change, and requiring a second
 * click, is the difference between a convenience and a thing that silently grew your
 * startup fetch list.
 */
async function initCatalogIndexSettings() {
    const input = document.getElementById('cat-index-url');
    const previewBtn = document.getElementById('cat-index-preview');
    const importBtn = document.getElementById('cat-index-import');
    const out = document.getElementById('cat-index-result');
    if (!input || !previewBtn || !importBtn || !out)
        return;
    // A LIST, not a single address. Somebody following two communities had to choose which
    // one to keep, and the old single value was overwritten by whatever they previewed last
    // — including a URL they were only checking.
    //
    // The old key is read once and folded in, so an address already saved is not lost by
    // this change.
    const LIST = 'bmm_catalog_index_urls';
    const LAST = 'bmm_catalog_index_url';
    const readList = () => {
        let out = [];
        try {
            out = JSON.parse(localStorage.getItem(LIST) || '[]');
        }
        catch {
            out = [];
        }
        if (!Array.isArray(out))
            out = [];
        try {
            const legacy = localStorage.getItem(LAST);
            if (legacy && !out.includes(legacy))
                out.push(legacy);
        }
        catch { /* ignore */ }
        return out.filter((x) => typeof x === 'string' && x.trim());
    };
    const writeList = (v) => { try {
        localStorage.setItem(LIST, JSON.stringify(v));
    }
    catch { /* ignore */ } };
    const listHost = document.getElementById('cat-index-list');
    const renderList = () => {
        if (!listHost)
            return;
        const urls = readList();
        if (!urls.length) {
            listHost.innerHTML = '';
            return;
        }
        listHost.innerHTML = `<div class="cat-index-list-title">${escHtml(t('settings.catIndex.saved') || 'Sources you keep')}</div>`
            + urls.map((u) => `<div class="cat-index-row">
              <span class="cat-index-url" title="${escAttr(u)}">${escHtml(u)}</span>
              <button class="btn btn-ghost btn-sm cat-index-use" data-u="${escAttr(u)}">${escHtml(t('settings.catIndex.reuse') || 'Use')}</button>
              <button class="btn btn-ghost btn-sm cat-index-del" data-u="${escAttr(u)}">${escHtml(t('common.remove') || 'Remove')}</button>
           </div>`).join('');
        listHost.querySelectorAll('.cat-index-use').forEach((b) => b.addEventListener('click', () => {
            input.value = b.dataset.u || '';
            previewBtn.click();
        }));
        listHost.querySelectorAll('.cat-index-del').forEach((b) => b.addEventListener('click', () => {
            writeList(readList().filter((x) => x !== b.dataset.u));
            renderList();
        }));
    };
    renderList();
    const contentsHost = document.getElementById('cat-index-contents');
    const followHost = document.getElementById('cat-index-following');
    const histHost = document.getElementById('cat-index-history');
    const histQ = document.getElementById('cat-index-history-q');
    // ── Following: every source BMM actually fetches, whatever put it there ──────
    //
    // Not just what an index added. A deep link, another settings panel and this one all
    // write the same stores, and until now nothing showed them together — so a catalog you
    // did not remember following could only be removed by finding whichever screen owned it.
    const renderFollowing = async () => {
        if (!followHost)
            return;
        const all = await readAllSources();
        const rows = [];
        for (const type of Object.keys(all)) {
            for (const u of all[type]) {
                const from = originOf(u);
                const off = isDisabled(u);
                rows.push(`<div class="cat-index-row${off ? ' is-off' : ''}">
                    <span class="cat-index-type">${escHtml(t(`settings.catIndex.type.${type}`) || type)}</span>
                    <span class="cat-index-url" title="${escAttr(u)}">${escHtml(u)}</span>
                    ${from ? `<span class="cat-index-from" title="${escAttr(from)}">${escHtml(originLabel(from))}</span>` : ''}
                    <button class="btn btn-ghost btn-sm cat-index-toggle" data-u="${escAttr(u)}"
                            title="${escAttr(off ? (t('settings.catIndex.enable.h') || 'Fetch this one again') : (t('settings.catIndex.disable.h') || 'Keep it in the list but stop fetching it'))}">${escHtml(off ? (t('settings.catIndex.enable') || 'Off') : (t('settings.catIndex.disable') || 'On'))}</button>
                    <button class="btn btn-ghost btn-sm cat-index-unfollow"
                            data-t="${escAttr(type)}" data-u="${escAttr(u)}">${escHtml(t('common.remove') || 'Remove')}</button>
                  </div>`);
            }
        }
        followHost.innerHTML = rows.length
            ? rows.join('')
            : `<div class="cat-index-empty">${escHtml(t('settings.catIndex.noneFollowed') || 'You follow no community catalogs yet.')}</div>`;
        // On/off, which is NOT remove. Removing the only copy of a URL you might want back is
        // what makes people keep catalogs they do not want; this keeps it listed and skips it.
        followHost.querySelectorAll('.cat-index-toggle').forEach((b) => b.addEventListener('click', async () => {
            const u = b.dataset.u || '';
            setDisabled(u, !isDisabled(u));
            await renderFollowing();
            await renderContents();
        }));
        followHost.querySelectorAll('.cat-index-unfollow').forEach((b) => b.addEventListener('click', async () => {
            const el = b;
            const type = el.dataset.t || '';
            const u = el.dataset.u || '';
            try {
                if (type === 'app') {
                    await invoke('remove_community_source', { url: u });
                }
                else {
                    const key = STORE_KEY[type];
                    if (!key)
                        return;
                    // removeSource, matching addSource's case-insensitivity. An exact-match
                    // filter here would leave a source that was added under a different case
                    // unremovable by the button that says it removes it.
                    const { list, removed } = removeSource(readSources(type), u);
                    if (!removed)
                        return;
                    localStorage.setItem(key, JSON.stringify(list));
                }
                forgetOrigin(u);
                recordHistory({ action: 'remove', type, url: u });
                await renderFollowing();
                await renderHistory();
                await renderContents();
                toast(t('settings.catIndex.removed') || 'Removed.', 'success');
            }
            catch (e) {
                toast(`${t('common.failed') || 'Failed'} — ${String(e).slice(0, 80)}`, 'error');
            }
        }));
    };
    // ── History ─────────────────────────────────────────────────────────────────
    const renderHistory = async () => {
        if (!histHost)
            return;
        // Named `lines`, not `all`: `all` already means "every source that is followed" twelve
        // lines below, and re-using it here shadowed nothing — it collided, and the whole
        // settings module stopped parsing. A crash on load, from a name.
        const lines = readHistory();
        // Matches the address, the kind and the action word — the three things a line says.
        // The action is matched in the CURRENT language as well as its stored value, because
        // somebody reading a French list types "ajouté", not "add".
        const q = (histQ?.value || '').trim().toLowerCase();
        // The ORIGINAL position travels with the line. `forgetHistoryAt` deletes by index into
        // the whole history, so once a filter is applied the row's position in what you can see
        // is not the position of the thing it deletes — and "drop this line" would drop a
        // different one. The kind of bug a filter quietly introduces into a list with a delete
        // button.
        const h = q ? lines.map((e, i) => ({ e, i })).filter(({ e }) => {
            const words = [
                e.url, e.type, e.action, e.via || '',
                t(`settings.catIndex.type.${e.type}`) || '',
                (e.action === 'add' ? t('settings.catIndex.hAdded') : t('settings.catIndex.hRemoved')) || '',
            ];
            return words.some((w) => String(w).toLowerCase().includes(q));
        }) : lines.map((e, i) => ({ e, i }));
        // What is followed right now, so a "removed" row knows whether it can be put back —
        // a Bring-back button beside something you already follow again is a dead control.
        const all = await readAllSources();
        const followed = new Set(Object.values(all).flat().map((u) => u.toLowerCase()));
        histHost.innerHTML = h.length
            ? h.map(({ e, i }) => {
                const gone = e.action === 'remove' && !followed.has(e.url.toLowerCase());
                return `<div class="cat-index-row cat-index-hist-${escAttr(e.action)}">
                  <span class="cat-index-when">${escHtml(new Date(e.at).toLocaleString())}</span>
                  <span class="cat-index-act">${escHtml(e.action === 'add'
                    ? (t('settings.catIndex.hAdded') || 'added')
                    : (t('settings.catIndex.hRemoved') || 'removed'))}</span>
                  <span class="cat-index-type">${escHtml(t(`settings.catIndex.type.${e.type}`) || e.type)}</span>
                  <span class="cat-index-url" title="${escAttr(e.url)}">${escHtml(e.url)}</span>
                  ${e.via ? `<span class="cat-index-from" title="${escAttr(e.via)}">${escHtml(originLabel(e.via))}</span>` : ''}
                  ${gone ? `<button class="btn btn-ghost btn-sm cat-index-readd" data-t="${escAttr(e.type)}" data-u="${escAttr(e.url)}" data-v="${escAttr(e.via || '')}">${escHtml(t('settings.catIndex.readd') || 'Bring back')}</button>` : ''}
                  <button class="btn btn-ghost btn-sm cat-index-forget" data-i="${i}" title="${escAttr(t('settings.catIndex.forget.h') || 'Drop this line from the history')}">×</button>
               </div>`;
            }).join('')
            // Two different empty states. "Nothing yet" over a history that has 90 lines and a
            // search term in the box is a lie about the data.
            : `<div class="cat-index-empty">${escHtml(q
                ? (t('settings.catIndex.histNoMatch') || 'No line matches that.')
                : (t('settings.catIndex.noHistory') || 'Nothing yet.'))}</div>`;
        // The point of keeping a history at all: undoing a removal without going and finding
        // the address again. It re-follows through the same `follow()` the index import uses,
        // so it lands in the same store with the same provenance and records its own line.
        histHost.querySelectorAll('.cat-index-readd').forEach((b) => b.addEventListener('click', async () => {
            const el = b;
            const n = await follow([{ type: el.dataset.t || '', url: el.dataset.u || '' }], el.dataset.v || '');
            if (n)
                toast(added(n), 'success');
            await refreshAll();
        }));
        histHost.querySelectorAll('.cat-index-forget').forEach((b) => b.addEventListener('click', async () => {
            // By INDEX into the list this render was built from, not by URL: the same URL can
            // appear many times, and dropping every line about a catalog is not what "drop
            // this line" says.
            forgetHistoryAt(Number(b.dataset.i));
            await renderHistory();
        }));
    };
    // Typed-into rather than submitted: a history search is a filter, and waiting for Enter to
    // filter a list already on screen is a step for nothing.
    histQ?.addEventListener('input', () => { void renderHistory(); });
    document.getElementById('cat-index-history-clear')?.addEventListener('click', () => {
        clearHistory();
        void renderHistory();
    });
    // ── The index itself ────────────────────────────────────────────────────────
    /** Fetch and parse, or null with the reason already on screen. */
    const load = async (url) => {
        if (!/^https?:\/\//i.test(url)) {
            toast(t('settings.catIndex.badUrl') || 'Enter an http(s) address.', 'error');
            return null;
        }
        out.textContent = t('settings.catIndex.loading') || 'Fetching…';
        try {
            // Through the backend, so the same TLS + identity handling every other catalog
            // fetch gets applies here too.
            const text = await invoke('fetch_remote_json', { url });
            const parsed = parseCatalogIndex(JSON.parse(text));
            // Kept only once it has actually answered. Saving on every keystroke would fill
            // the list with half-typed addresses, and saving a URL that failed would keep a
            // dead one around forever.
            const urls = readList();
            if (!urls.includes(url)) {
                writeList([...urls, url]);
                renderList();
            }
            return parsed;
        }
        catch (e) {
            // The URL is shown back deliberately: a typo in a long address is the usual
            // cause and "failed" alone leaves you re-reading the field character by character.
            out.textContent = `${t('settings.catIndex.failed') || 'Could not read that index'} — ${String(e).slice(0, 120)}`;
            return null;
        }
    };
    /** The last index looked at, and what following it would change. Held so the per-entry
     *  buttons can act without re-fetching, and re-planned after every add. */
    let shown = null;
    let shownFrom = '';
    const renderContents = async () => {
        if (!contentsHost)
            return;
        if (!shown) {
            contentsHost.innerHTML = '';
            return;
        }
        const plan = planImport(shown, await readAllSources());
        const already = new Set(plan.already.map((e) => e.url.toLowerCase()));
        contentsHost.innerHTML = shown.catalogs.map((e) => {
            const have = already.has(e.url.toLowerCase());
            return `<div class="cat-index-row${have ? ' is-followed' : ''}">
                <span class="cat-index-type">${escHtml(t(`settings.catIndex.type.${e.type}`) || e.type)}</span>
                <span class="cat-index-name">${escHtml(e.name || e.url)}</span>
                ${e.items ? `<span class="cat-index-items">${escHtml(String(e.items))}</span>` : ''}
                ${e.owner ? `<span class="cat-index-owner">${escHtml(e.owner)}</span>` : ''}
                <span class="cat-index-url" title="${escAttr(e.url)}">${escHtml(e.url)}</span>
                ${have
                ? `<span class="cat-index-have">${escHtml(t('settings.catIndex.followed') || 'Following')}</span>`
                : `<button class="btn btn-ghost btn-sm cat-index-add1" data-u="${escAttr(e.url)}">${escHtml(t('settings.catIndex.addOne') || 'Add')}</button>`}
              </div>`;
        }).join('');
        contentsHost.querySelectorAll('.cat-index-add1').forEach((b) => b.addEventListener('click', async () => {
            const u = b.dataset.u || '';
            const entry = shown?.catalogs.find((c) => c.url === u);
            if (!entry)
                return;
            const n = await follow([entry], shownFrom);
            out.textContent = added(n);
            await refreshAll();
        }));
    };
    const added = (n) => (t('settings.catIndex.added') || 'Added {n} catalog source(s).').replace('{n}', String(n));
    const refreshAll = async () => { await renderFollowing(); await renderHistory(); await renderContents(); };
    /**
     * Follow these entries. Returns how many actually landed — not how many were asked for,
     * because an entry already followed adds nothing and saying otherwise is the count bug
     * this panel already had once.
     */
    const follow = async (entries, via) => {
        let ok = 0;
        for (const e of entries) {
            try {
                if (e.type === 'app') {
                    await invoke('add_community_source', { url: e.url });
                }
                else {
                    const key = STORE_KEY[e.type];
                    if (!key)
                        continue;
                    const list = readSources(e.type);
                    // addSource, not a second dedupe written here. The preview and this writer
                    // must agree on what "already followed" means, and when they were written
                    // separately they did not.
                    if (!addSource(list, e.url))
                        continue;
                    localStorage.setItem(key, JSON.stringify(list));
                }
                // Recorded only after the add succeeded, so a source that failed to be
                // added does not get an origin pointing at an index it never came from.
                rememberOrigin(e.url, via);
                recordHistory({ action: 'add', type: e.type, url: e.url, via });
                ok += 1;
            }
            catch { /* one bad entry must not abandon the rest of the index */ }
        }
        return ok;
    };
    // Look inside: READ ONLY. It shows what the index holds and changes nothing — which is
    // what the button now says, rather than being a required first step towards a second one.
    previewBtn.addEventListener('click', async () => {
        const url = input.value.trim();
        previewBtn.disabled = true;
        try {
            const parsed = await load(url);
            if (!parsed) {
                shown = null;
                await renderContents();
                return;
            }
            shown = parsed.index;
            shownFrom = url;
            const n = parsed.index.catalogs.length;
            out.textContent = (t('settings.catIndex.holds') || 'This index lists {n} catalog(s).').replace('{n}', String(n))
                + (parsed.dropped.length ? ` ${(t('settings.catIndex.skipped') || '{n} skipped.').replace('{n}', String(parsed.dropped.length))}` : '');
            await renderContents();
        }
        finally {
            previewBtn.disabled = false;
        }
    });
    // Add everything: fetches for itself. It no longer waits to be enabled by a preview
    // click — the person who typed an address and pressed Add meant Add.
    importBtn.addEventListener('click', async () => {
        const url = input.value.trim();
        importBtn.disabled = true;
        try {
            const parsed = await load(url);
            if (!parsed)
                return;
            shown = parsed.index;
            shownFrom = url;
            const n = await follow(parsed.index.catalogs, url);
            out.textContent = added(n);
            toast(added(n), n ? 'success' : 'info');
            await refreshAll();
        }
        finally {
            importBtn.disabled = false;
        }
    });
    await refreshAll();
}
export async function initSettings() {
    await initGithubPatSettings();
    await initShaSettings();
    await initDiscordRpcSettings();
    await initSoundSettings();
    await initCatalogIndexSettings();
    // Keyboard shortcuts are now a central, rebindable command registry (core/commands.ts) —
    // the global dispatcher is started once in app.ts. Here we just mount the manager UI.
    const skHost = document.getElementById('shortcuts-manager');
    if (skHost) {
        renderShortcutsManager(skHost);
        // The manager's strings are resolved at render time (tr()), not via data-i18n,
        // so a language switch left it in the old language until an app restart.
        // setLang dispatches 'langChanged' — re-render on it, once (guard the flag).
        if (!skHost._skLangWired) {
            skHost._skLangWired = true;
            document.addEventListener('langChanged', () => {
                if (skHost.isConnected)
                    renderShortcutsManager(skHost);
            });
        }
    }
    await initStorageSettings();
    await initLanguageSettings();
    initI18nSandbox();
    await initSecuritySettings();
    await initLaunchPackSettings();
    initScheduler().catch(() => { });
    try {
        initCardReorder();
    }
    catch (e) { }
    try {
        (await import('../../core/analytics.js')).initPrivacySettings();
    }
    catch (e) { }
    initSecurityInfoCard().catch(() => { });
    // Tags Settings — icon (lucide/simple-icons/upload), flat or gradient colour,
    // create AND edit through the same form (the button flips to "save").
    const btnCreateTag = document.getElementById('btn-create-tag');
    if (btnCreateTag) {
        const gradToggle = document.getElementById('setting-tag-grad');
        const color2Input = document.getElementById('setting-tag-color2');
        // Toggling only reveals the swatch — it never removes it from the flow, or
        // the whole row jumped sideways on every click (field report: "le bouton
        // pour activer le gradient change le style").
        gradToggle?.addEventListener('change', () => {
            color2Input?.classList.toggle('tag-color2-hidden', !gradToggle.checked);
        });
        document.getElementById('btn-tag-icon')?.addEventListener('click', async () => {
            const { openIconPicker, renderPackIcon } = await import('../../ui/icon-pack.js');
            const ref = await openIconPicker({ current: _tagIconRef });
            if (ref === null)
                return;
            _tagIconRef = ref;
            const prev = document.getElementById('setting-tag-icon-preview');
            if (prev)
                prev.innerHTML = renderPackIcon(ref, 18) || '＋';
        });
        document.getElementById('btn-cancel-tag-edit')?.addEventListener('click', () => _tagFormReset());
        btnCreateTag.addEventListener('click', async () => {
            const nameInput = document.getElementById('setting-tag-name');
            const colorInput = document.getElementById('setting-tag-color');
            const name = nameInput.value.trim();
            const color = colorInput.value;
            if (!name)
                return toast(t('settings.tagNameRequired'), 'error');
            const icon = _tagIconRef;
            const color2 = gradToggle?.checked ? (color2Input?.value || null) : null;
            const editingId = _tagEditId;
            try {
                if (editingId) {
                    await invoke('update_tag', { tagId: editingId, name, color, icon, color2 });
                    toast(t('settings.tagUpdated') || 'Tag updated', 'success');
                }
                else {
                    await invoke('create_tag', { name, color, icon, color2 });
                    toast(t('settings.tagCreated'), 'success');
                }
                renderSettingsTags(); // also resets the form state
                if (window._refreshModsFn)
                    window._refreshModsFn();
            }
            catch (err) {
                toast(t('settings.tagCreateError', { err: String(err) }), 'error');
            }
        });
        renderSettingsTags();
    }
    // Export/Import App Data
    const exportBtn = document.getElementById('btn-export-data');
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay open';
            overlay.style.zIndex = '100002';
            overlay.style.pointerEvents = 'auto';
            overlay.style.animation = 'modal-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)';
            const close = () => {
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 250);
            };
            const content = document.createElement('div');
            // Use the same clean container style as the Launch Pack modal
            // (solid #111827 background instead of the dark glass blur).
            content.className = 'modal';
            content.style.maxWidth = '430px';
            content.style.width = '430px';
            content.style.padding = '0';
            content.style.overflow = 'hidden';
            content.style.pointerEvents = 'auto';
            content.innerHTML = `
                <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid var(--border)">
                    <h3 style="margin:0; font-size:14px; font-weight:700; color:var(--text-bright); text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:8px">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        ${t('settings.exportTitle')}
                    </h3>
                    <button class="btn-close" style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:4px" onclick="this.closest('.modal-overlay').remove()">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                
                <div class="modal-body" style="padding:20px 22px; display:flex; flex-direction:column; gap:14px">
                    <div class="exp-opt-list">
                        <label class="exp-opt">
                            <span class="exp-opt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
                            <span class="exp-opt-txt">
                                <span class="exp-opt-title">${t('settings.exportProfiles')}</span>
                                <span class="exp-opt-desc">${t('settings.exportProfilesDesc') || 'Game profiles, paths and active mod lists'}</span>
                            </span>
                            <label class="bmm-switch">
                                <input type="checkbox" id="exp-profiles" checked>
                                <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                            </label>
                        </label>
                        <label class="exp-opt">
                            <span class="exp-opt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></span>
                            <span class="exp-opt-txt">
                                <span class="exp-opt-title">${t('settings.exportMods')}</span>
                                <span class="exp-opt-desc">${t('settings.exportModsDesc') || 'Scanned mod entries and metadata'}</span>
                            </span>
                            <label class="bmm-switch">
                                <input type="checkbox" id="exp-mods" checked>
                                <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                            </label>
                        </label>
                        <label class="exp-opt">
                            <span class="exp-opt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span>
                            <span class="exp-opt-txt">
                                <span class="exp-opt-title">${t('settings.exportTags')}</span>
                                <span class="exp-opt-desc">${t('settings.exportTagsDesc') || 'Your custom tags assigned to mods'}</span>
                            </span>
                            <label class="bmm-switch">
                                <input type="checkbox" id="exp-tags" checked>
                                <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                            </label>
                        </label>
                        <label class="exp-opt">
                            <span class="exp-opt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V12a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
                            <span class="exp-opt-txt">
                                <span class="exp-opt-title">${t('settings.exportSettings')}</span>
                                <span class="exp-opt-desc">${t('settings.exportSettingsDesc') || 'App preferences and configuration'}</span>
                            </span>
                            <label class="bmm-switch">
                                <input type="checkbox" id="exp-settings" checked>
                                <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                            </label>
                        </label>
                        <label class="exp-opt">
                            <span class="exp-opt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span>
                            <span class="exp-opt-txt">
                                <span class="exp-opt-title">${t('settings.exportPlugins') || 'Plugins'}</span>
                                <span class="exp-opt-desc">${t('settings.exportPluginsDesc') || 'Installed plugins and their permissions'}</span>
                            </span>
                            <label class="bmm-switch"><input type="checkbox" id="exp-plugins" checked><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>
                        </label>
                        <label class="exp-opt">
                            <span class="exp-opt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></span>
                            <span class="exp-opt-txt">
                                <span class="exp-opt-title">${t('settings.exportModpacks') || 'Modpacks & Launch Packs'}</span>
                                <span class="exp-opt-desc">${t('settings.exportModpacksDesc') || 'Your .BMP modpacks and application launch packs'}</span>
                            </span>
                            <label class="bmm-switch"><input type="checkbox" id="exp-modpacks" checked><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>
                        </label>
                        <label class="exp-opt">
                            <span class="exp-opt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></span>
                            <span class="exp-opt-txt">
                                <span class="exp-opt-title">${t('settings.exportThemes') || 'Themes'}</span>
                                <span class="exp-opt-desc">${t('settings.exportThemesDesc') || 'Your installed custom themes'}</span>
                            </span>
                            <label class="bmm-switch"><input type="checkbox" id="exp-themes" checked><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>
                        </label>
                        <label class="exp-opt">
                            <span class="exp-opt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg></span>
                            <span class="exp-opt-txt">
                                <span class="exp-opt-title">${t('settings.exportTranslations') || 'Translations'}</span>
                                <span class="exp-opt-desc">${t('settings.exportTranslationsDesc') || 'Custom & imported language files'}</span>
                            </span>
                            <label class="bmm-switch"><input type="checkbox" id="exp-translations" checked><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>
                        </label>
                        <label class="exp-opt">
                            <span class="exp-opt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l1-5h16l1 5"/><path d="M5 9v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M9 13h6"/></svg></span>
                            <span class="exp-opt-txt">
                                <span class="exp-opt-title">${t('settings.exportApps') || 'App Catalog & favourites'}</span>
                                <span class="exp-opt-desc">${t('settings.exportAppsDesc') || 'Community catalog sources, favourites, installed apps & server-repo favourites'}</span>
                            </span>
                            <label class="bmm-switch"><input type="checkbox" id="exp-apps" checked><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>
                        </label>
                        <!-- The sections that are FILES rather than fields in data.json. They exist only
                             in the archive: a JSON export can carry them only by inlining, which turns a
                             40 MB recording into a 55 MB string inside a document nothing can stream. -->
                        <label class="exp-opt">
                            <span class="exp-opt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
                            <span class="exp-opt-txt">
                                <span class="exp-opt-title">${t('settings.exportAutomations') || 'Automations'}</span>
                                <span class="exp-opt-desc">${t('settings.exportAutomationsDesc') || 'Your scheduled tasks, exactly as the scheduler saved them'}</span>
                            </span>
                            <label class="bmm-switch"><input type="checkbox" id="exp-automations" checked><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>
                        </label>
                        <label class="exp-opt">
                            <span class="exp-opt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="5 3 19 12 5 21 5 3"/></svg></span>
                            <span class="exp-opt-txt">
                                <span class="exp-opt-title">${t('settings.exportReplays') || 'Session recordings'}</span>
                                <span class="exp-opt-desc">${t('settings.exportReplaysDesc') || 'Everything the recorder kept (.bmmreplay) — often the largest part'}</span>
                            </span>
                            <label class="bmm-switch"><input type="checkbox" id="exp-replays"><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>
                        </label>
                        <label class="exp-opt">
                            <span class="exp-opt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></span>
                            <span class="exp-opt-txt">
                                <span class="exp-opt-title">${t('settings.exportNavigation') || 'Navigation & custom pages'}</span>
                                <span class="exp-opt-desc">${t('settings.exportNavigationDesc') || 'Your navbar layout plus every custom page — source, permissions and stored data'}</span>
                            </span>
                            <label class="bmm-switch"><input type="checkbox" id="exp-navigation" checked><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>
                        </label>
                        <label class="exp-opt">
                            <span class="exp-opt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
                            <span class="exp-opt-txt">
                                <span class="exp-opt-title">${t('settings.exportCrashes') || 'Crash reports'}</span>
                                <span class="exp-opt-desc">${t('settings.exportCrashesDesc') || 'Reports and their archive — what a maintainer asks for after a crash'}</span>
                            </span>
                            <label class="bmm-switch"><input type="checkbox" id="exp-crashes"><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>
                        </label>
                        <label class="exp-opt">
                            <span class="exp-opt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
                            <span class="exp-opt-txt">
                                <span class="exp-opt-title">${t('settings.exportDiagnostics') || 'Diagnostics'}</span>
                                <span class="exp-opt-desc">${t('settings.exportDiagnosticsDesc') || 'The diagnostic files BMM writes when something goes wrong'}</span>
                            </span>
                            <label class="bmm-switch"><input type="checkbox" id="exp-diagnostics"><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></label>
                        </label>
                    </div>

                    <div class="exp-note">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                        <span>${t('settings.exportNote2') || 'Writes one .DATABMM file — an archive holding everything you ticked, with a manifest saying what went in.'}</span>
                    </div>
                </div>
                
                <div class="modal-footer" style="padding:16px 20px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:12px; background:rgba(0,0,0,0.1)">
                    <button class="btn btn-secondary btn-cancel-exp" style="height:36px; padding:0 24px">${t('common.cancel')}</button>
                    <button class="btn btn-primary btn-confirm-exp" style="height:36px; padding:0 24px; min-width:100px">${t('common.export') || 'Export'}</button>
                </div>
            `;
            overlay.appendChild(content);
            (document.getElementById('app-window-outer') || document.body).appendChild(overlay);
            content.querySelector('.btn-cancel-exp').onclick = close;
            content.querySelector('.btn-close').onclick = close;
            content.querySelector('.btn-confirm-exp').onclick = async () => {
                const exportApps = content.querySelector('#exp-apps').checked;
                const options = {
                    profiles: content.querySelector('#exp-profiles').checked,
                    mods: content.querySelector('#exp-mods').checked,
                    settings: content.querySelector('#exp-settings').checked,
                    custom_tags: content.querySelector('#exp-tags').checked,
                    disk_limits: true,
                    plugins: content.querySelector('#exp-plugins').checked,
                    modpacks: content.querySelector('#exp-modpacks').checked,
                    launch_packs: content.querySelector('#exp-modpacks').checked,
                    themes: content.querySelector('#exp-themes').checked,
                    translations: content.querySelector('#exp-translations').checked,
                    apps: exportApps,
                };
                // Frontend-only data (localStorage) — bundled into the backup so a
                // restore is complete. Currently: server-repo favourites.
                let extras = null;
                if (exportApps) {
                    extras = {};
                    try {
                        const repoFav = localStorage.getItem('bmm_repo_favorites');
                        if (repoFav)
                            extras['bmm_repo_favorites'] = repoFav;
                    }
                    catch { }
                }
                close();
                // The archive carries the SAME filtered app data the JSON export builds, so the
                // two can never disagree about what "profiles" or "plugins" means — the rule for
                // that lives in one place and this is a second wrapper around it, not a copy.
                const bundle = {
                    app_data: true,
                    themes: content.querySelector('#exp-themes').checked,
                    theme_presets: content.querySelector('#exp-themes').checked,
                    translations: content.querySelector('#exp-translations').checked,
                    launch_packs: content.querySelector('#exp-modpacks').checked,
                    automations: content.querySelector('#exp-automations').checked,
                    navigation: content.querySelector('#exp-navigation').checked,
                    apps: exportApps,
                    replays: content.querySelector('#exp-replays').checked,
                    crashes: content.querySelector('#exp-crashes').checked,
                    diagnostics: content.querySelector('#exp-diagnostics').checked,
                };
                const destPath = await saveFile({
                    defaultPath: 'bmm-backup.DATABMM',
                    filters: [
                        { name: 'BMM data bundle', extensions: ['DATABMM'] },
                        // Still offered: a JSON backup is smaller, diffable and is what every
                        // older BMM can read. Removing it would strand the backups people have.
                        { name: 'App data (JSON)', extensions: ['json'] },
                    ],
                });
                if (destPath) {
                    const asJson = /\.json$/i.test(destPath);
                    try {
                        if (asJson) {
                            await invoke('export_app_data', { destPath, options, extras });
                            toast(t('settings.dataExported') || 'Data exported successfully', 'success');
                        }
                        else {
                            // The app_data section is built by the JSON exporter's own rules; the
                            // bundle command only decides which FILES ride along.
                            const appDataJson = JSON.parse(await invoke('export_app_data_json', { options, extras }));
                            // The navbar layout is in localStorage; Rust cannot read it, so it
                            // travels with the call. Read here rather than in the bundle command
                            // for the same reason appDataJson is: one place owns the shape.
                            let navbarConfig = null;
                            if (bundle.navigation) {
                                try {
                                    navbarConfig = JSON.parse(localStorage.getItem('bmm_navbar_config') || 'null');
                                }
                                catch {
                                    navbarConfig = null;
                                }
                            }
                            const r = await invoke('export_data_bundle', {
                                destPath, options: bundle, appDataJson, extras, navbarConfig,
                            });
                            // What it actually took, not what was asked for. A section that was
                            // ticked and turned out empty is the thing worth knowing.
                            const took = r.sections.filter((x) => x.files > 0).length;
                            const empty = r.sections.filter((x) => x.files === 0).map((x) => x.section);
                            toast((t('settings.bundleExported') || 'Wrote {mb} MB — {n} section(s).')
                                .replace('{mb}', (r.bytes / 1048576).toFixed(1)).replace('{n}', String(took))
                                + (empty.length ? ` ${(t('settings.bundleEmpty') || 'Nothing to take for: {x}.').replace('{x}', empty.join(', '))}` : ''), 'success');
                        }
                    }
                    catch (e) {
                        toast(t('settings.dataExportError', { err: String(e) }), 'error');
                    }
                }
            };
        });
    }
    // ── Library toolbar density (body class drives the CSS modes; auto = responsive) ──
    const applyToolbarDensity = (mode) => {
        const m = ['full', 'compact', 'stacked', 'stacked-labels'].includes(mode) ? mode : 'auto';
        // Remove EVERY mode class (the old list forgot `stacked-labels`, which left
        // it stuck when switching back to auto).
        document.body.classList.remove('bmm-toolbar-auto', 'bmm-toolbar-full', 'bmm-toolbar-compact', 'bmm-toolbar-stacked', 'bmm-toolbar-stacked-labels');
        document.body.classList.add('bmm-toolbar-' + m);
        // Force any width-based layout (and the responsive `auto` rules) to
        // re-evaluate immediately, so the change applies without an app refresh.
        try {
            window.dispatchEvent(new Event('resize'));
        }
        catch { }
    };
    {
        let mode = 'auto';
        try {
            mode = localStorage.getItem('bmm_toolbar_mode') || 'auto';
        }
        catch { }
        applyToolbarDensity(mode);
        const densityEl = document.getElementById('setting-toolbar-density');
        if (densityEl) {
            densityEl.value = mode;
            densityEl.addEventListener('change', () => {
                const m = densityEl.value || 'auto';
                try {
                    localStorage.setItem('bmm_toolbar_mode', m);
                }
                catch { }
                applyToolbarDensity(m);
            });
        }
    }
    // ── Library action-bar transparency (body class drives the CSS; default on) ──
    {
        const applyToolbarTransparency = (transparent) => {
            // `bmm-toolbar-opaque` makes the floating pill + filter shell solid.
            document.body.classList.toggle('bmm-toolbar-opaque', !transparent);
        };
        let transparent = true;
        try {
            transparent = localStorage.getItem('bmm_toolbar_transparent') !== 'false';
        }
        catch { }
        applyToolbarTransparency(transparent);
        const transpEl = document.getElementById('setting-toolbar-transparent');
        if (transpEl) {
            transpEl.checked = transparent;
            transpEl.addEventListener('change', () => {
                try {
                    localStorage.setItem('bmm_toolbar_transparent', String(transpEl.checked));
                }
                catch { }
                applyToolbarTransparency(transpEl.checked);
            });
        }
    }
    // ── Mod auto-scan interval (sec/min unit; stored as seconds in
    //    bmm_scan_interval_sec. 0 = use the default gap, handled in mods.ts) ──
    const scanValueEl = document.getElementById('scan-interval-value');
    const scanUnitEl = document.getElementById('scan-interval-unit');
    if (scanValueEl && scanUnitEl) {
        // Restore: prefer the user's chosen display unit, else show seconds.
        let storedSec = 0;
        try {
            storedSec = Math.max(0, parseInt(localStorage.getItem('bmm_scan_interval_sec') || '0', 10) || 0);
        }
        catch { }
        let unit = 'sec';
        try {
            unit = localStorage.getItem('bmm_scan_interval_unit') || 'sec';
        }
        catch { }
        scanUnitEl.value = (unit === 'min') ? 'min' : 'sec';
        scanValueEl.value = String(scanUnitEl.value === 'min' ? Math.round(storedSec / 60) : storedSec);
        const persist = () => {
            const unitNow = scanUnitEl.value === 'min' ? 'min' : 'sec';
            let v = Math.max(0, parseInt(scanValueEl.value || '0', 10) || 0);
            const maxForUnit = unitNow === 'min' ? 60 : 3600;
            v = Math.min(v, maxForUnit);
            scanValueEl.value = String(v);
            const secs = unitNow === 'min' ? v * 60 : v;
            try {
                localStorage.setItem('bmm_scan_interval_sec', String(secs));
                localStorage.setItem('bmm_scan_interval_unit', unitNow);
            }
            catch { }
        };
        scanValueEl.addEventListener('change', persist);
        scanUnitEl.addEventListener('change', () => {
            // Re-display the same stored seconds in the newly selected unit.
            let s = 0;
            try {
                s = Math.max(0, parseInt(localStorage.getItem('bmm_scan_interval_sec') || '0', 10) || 0);
            }
            catch { }
            scanValueEl.value = String(scanUnitEl.value === 'min' ? Math.round(s / 60) : s);
            persist();
        });
    }
    // ── Mod update check interval (minutes) + global update repos ──
    const updIntervalEl = document.getElementById('update-check-min');
    if (updIntervalEl) {
        try {
            updIntervalEl.value = String(parseInt(localStorage.getItem('bmm_update_check_min') || '0', 10) || 0);
        }
        catch {
            updIntervalEl.value = '0';
        }
        updIntervalEl.addEventListener('change', async () => {
            const v = Math.max(0, Math.min(1440, parseInt(updIntervalEl.value || '0', 10) || 0));
            updIntervalEl.value = String(v);
            try {
                localStorage.setItem('bmm_update_check_min', String(v));
            }
            catch { }
            try {
                (await import('../repo/mod-updates.js')).startAutoUpdateChecks();
            }
            catch { }
        });
    }
    const globalReposEl = document.getElementById('global-update-repos');
    if (globalReposEl) {
        try {
            const repos = JSON.parse(localStorage.getItem('bmm_update_repos') || '[]');
            globalReposEl.value = Array.isArray(repos) ? repos.join('\n') : '';
        }
        catch {
            globalReposEl.value = '';
        }
        globalReposEl.addEventListener('change', () => {
            const list = globalReposEl.value.split('\n').map(s => s.trim()).filter(Boolean);
            try {
                localStorage.setItem('bmm_update_repos', JSON.stringify(list));
            }
            catch { }
        });
    }
    const importBtn = document.getElementById('btn-import-data');
    if (importBtn) {
        importBtn.addEventListener('click', async () => {
            const srcPath = await pickFile([{ name: 'App Data Backup', extensions: ['json'] }]);
            if (srcPath) {
                if (confirm(t('settings.dataImportConfirm'))) {
                    try {
                        const extras = await invoke('import_app_data', { srcPath });
                        // Restore frontend-only data (localStorage) bundled in the backup.
                        if (extras && typeof extras === 'object') {
                            for (const [k, v] of Object.entries(extras)) {
                                try {
                                    if (typeof v === 'string')
                                        localStorage.setItem(k, v);
                                }
                                catch { }
                            }
                        }
                        toast(t('settings.dataImported'), 'success');
                        setTimeout(() => window.location.reload(), 2000);
                    }
                    catch (e) {
                        toast(t('settings.dataImportError', { err: String(e) }), 'error');
                    }
                }
            }
        });
    }
    // ── BetaHub ──────────────────────────────────────────────
    initBetaHub();
    document.getElementById('btn-settings-betahub-bugreport')
        ?.addEventListener('click', () => openBugReportModal());
    document.getElementById('btn-settings-betahub-feedback')
        ?.addEventListener('click', () => openFeedbackModal());
}
//# sourceMappingURL=settings.js.map