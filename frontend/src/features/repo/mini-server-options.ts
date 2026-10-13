// Server Repo → Standalone mini-server: the status page and the scheduled tasks of the generated
// server (src-tauri/src/commands/mini_server_extras.rs → server.config.json → bmm-extras.js).
//
// Simple by default: three choices (check the files, back up repo.json, rotate the log) with
// presets. The rest — rewriting the hashes of an unsigned manifest, custom schedules (interval or
// cron line), a sync source, a rate limit, the public address — sits in an « Advanced » fold.
//
// The block is mounted into the mini-server card at run time so index.html stays untouched; the
// generator reads it through readMiniServerExtras(), whose shape is MiniServerExtras (camelCase).
import { t, applyTranslations } from '../../core/i18n.js';

const ID = 'repo-mini-extras';

export interface MiniServerExtras {
    statusPage: boolean;
    publicUrl: string;
    rateLimitPerMinute: number;
    rescan: string;
    rescanRewrite: boolean;
    bumpVersion: boolean;
    backup: string;
    backupKeep: number;
    rotateLogs: boolean;
    logMaxMb: number;
    syncKind: string;
    syncSource: string;
    syncSchedule: string;
    syncThenRescan: boolean;
}

function opt(value: string, key: string, selected = false): string {
    return `<option value="${value}"${selected ? ' selected' : ''} data-i18n="${key}">${t(key)}</option>`;
}

function markup(): string {
    return `
<div id="${ID}" class="rp-mini-extras" style="margin:4px 0 14px;">
  <div class="form-label" data-i18n="repo.mini.title">${t('repo.mini.title')}</div>
  <p class="rp-lede" data-i18n="repo.mini.hint">${t('repo.mini.hint')}</p>
  <div class="rp-form-grid">
    <label class="rp-field"><span class="form-label" data-i18n="repo.mini.rescan">${t('repo.mini.rescan')}</span>
      <select id="repo-mini-rescan" class="form-input">
        ${opt('', 'repo.mini.off')}${opt('1h', 'repo.mini.hourly')}${opt('6h', 'repo.mini.every6h', true)}${opt('1d', 'repo.mini.daily')}
      </select></label>
    <label class="rp-field"><span class="form-label" data-i18n="repo.mini.backup">${t('repo.mini.backup')}</span>
      <select id="repo-mini-backup" class="form-input">
        ${opt('', 'repo.mini.off')}${opt('0 3 * * *', 'repo.mini.daily3', true)}${opt('0 3 * * 0', 'repo.mini.weekly')}
      </select></label>
  </div>
  <div class="rp-checks">
    <label class="checkbox-container"><input type="checkbox" id="repo-mini-status" checked><span data-i18n="repo.mini.statusPage">${t('repo.mini.statusPage')}</span></label>
    <label class="checkbox-container"><input type="checkbox" id="repo-mini-rotate" checked><span data-i18n="repo.mini.rotateLogs">${t('repo.mini.rotateLogs')}</span></label>
  </div>
  <details class="rp-mini-adv" style="margin-top:8px;">
    <summary class="form-label" style="cursor:pointer;" data-i18n="repo.mini.advanced">${t('repo.mini.advanced')}</summary>
    <div class="rp-checks" style="margin-top:8px;">
      <label class="checkbox-container"><input type="checkbox" id="repo-mini-rewrite"><span data-i18n="repo.mini.rescanRewrite">${t('repo.mini.rescanRewrite')}</span></label>
      <label class="checkbox-container"><input type="checkbox" id="repo-mini-bump"><span data-i18n="repo.mini.bumpVersion">${t('repo.mini.bumpVersion')}</span></label>
    </div>
    <div class="rp-form-grid" style="margin-top:8px;">
      <label class="rp-field"><span class="form-label" data-i18n="repo.mini.rescanCustom">${t('repo.mini.rescanCustom')}</span>
        <input type="text" id="repo-mini-rescan-custom" class="form-input" placeholder="6h" data-i18n-tooltip="repo.mini.scheduleHint"></label>
      <label class="rp-field"><span class="form-label" data-i18n="repo.mini.backupCustom">${t('repo.mini.backupCustom')}</span>
        <input type="text" id="repo-mini-backup-custom" class="form-input" placeholder="0 3 * * *" data-i18n-tooltip="repo.mini.scheduleHint"></label>
      <label class="rp-field"><span class="form-label" data-i18n="repo.mini.backupKeep">${t('repo.mini.backupKeep')}</span>
        <input type="number" id="repo-mini-backup-keep" class="form-input" value="14" min="1" max="1000"></label>
      <label class="rp-field"><span class="form-label" data-i18n="repo.mini.sync">${t('repo.mini.sync')}</span>
        <select id="repo-mini-sync-kind" class="form-input">
          ${opt('', 'repo.mini.syncNone', true)}${opt('git', 'repo.mini.syncGit')}${opt('rsync', 'repo.mini.syncRsync')}${opt('folder', 'repo.mini.syncFolder')}
        </select></label>
      <label class="rp-field" data-mini-sync><span class="form-label" data-i18n="repo.mini.syncSource">${t('repo.mini.syncSource')}</span>
        <input type="text" id="repo-mini-sync-source" class="form-input" placeholder="/srv/bmm-export"></label>
      <label class="rp-field" data-mini-sync><span class="form-label" data-i18n="repo.mini.syncSchedule">${t('repo.mini.syncSchedule')}</span>
        <input type="text" id="repo-mini-sync-schedule" class="form-input" value="30m" data-i18n-tooltip="repo.mini.scheduleHint"></label>
      <label class="rp-field"><span class="form-label" data-i18n="repo.mini.rateLimit">${t('repo.mini.rateLimit')}</span>
        <input type="number" id="repo-mini-rate" class="form-input" value="0" min="0" step="60"></label>
      <label class="rp-field"><span class="form-label" data-i18n="repo.mini.publicUrl">${t('repo.mini.publicUrl')}</span>
        <input type="text" id="repo-mini-public-url" class="form-input" placeholder="https://repo.example.com"></label>
    </div>
    <div class="rp-checks" data-mini-sync>
      <label class="checkbox-container"><input type="checkbox" id="repo-mini-sync-rescan" checked><span data-i18n="repo.mini.syncThenRescan">${t('repo.mini.syncThenRescan')}</span></label>
    </div>
  </details>
</div>`;
}

const val = (id: string): string => ((document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value || '').trim();
const on = (id: string, dflt: boolean): boolean => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    return el ? el.checked : dflt;
};

function paintSync(): void {
    const kind = val('repo-mini-sync-kind');
    document.querySelectorAll<HTMLElement>(`#${ID} [data-mini-sync]`).forEach((el) => {
        // git pulls the folder's own remote: it needs a schedule, not a path.
        el.hidden = !kind || (kind === 'git' && !!el.querySelector('#repo-mini-sync-source'));
    });
}

/** Mount the block into the mini-server card, once. */
export function mountMiniServerOptions(): void {
    if (document.getElementById(ID)) return;
    const card = document.querySelector('.rp-tool[data-tool="mini"] .rp-tool-body');
    const generate = document.getElementById('btn-generate-mini-server');
    const row = generate?.parentElement;
    if (!card || !row || row.parentElement !== card) return;
    row.insertAdjacentHTML('beforebegin', markup());
    const block = document.getElementById(ID);
    if (block) applyTranslations(block);
    document.getElementById('repo-mini-sync-kind')?.addEventListener('change', paintSync);
    paintSync();
}

/** What the generator sends as `extras` (MiniServerExtras in Rust). */
export function readMiniServerExtras(): MiniServerExtras {
    const num = (id: string, dflt: number): number => {
        const n = parseInt(val(id), 10);
        return Number.isFinite(n) && n >= 0 ? n : dflt;
    };
    return {
        statusPage: on('repo-mini-status', true),
        publicUrl: val('repo-mini-public-url'),
        rateLimitPerMinute: num('repo-mini-rate', 0),
        rescan: val('repo-mini-rescan-custom') || (document.getElementById('repo-mini-rescan') ? val('repo-mini-rescan') : '6h'),
        rescanRewrite: on('repo-mini-rewrite', false),
        bumpVersion: on('repo-mini-bump', false),
        backup: val('repo-mini-backup-custom') || (document.getElementById('repo-mini-backup') ? val('repo-mini-backup') : '0 3 * * *'),
        backupKeep: num('repo-mini-backup-keep', 14) || 14,
        rotateLogs: on('repo-mini-rotate', true),
        logMaxMb: 10,
        syncKind: val('repo-mini-sync-kind'),
        syncSource: val('repo-mini-sync-source'),
        syncSchedule: val('repo-mini-sync-schedule') || '30m',
        syncThenRescan: on('repo-mini-sync-rescan', true),
    };
}
