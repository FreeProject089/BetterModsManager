/**
 * profiles.js — Profile management
 */
import { invoke, pickFolder, toast } from './app.js';
import { refreshMods } from './mods.js';
import { t } from './i18n.js';

export async function initProfiles() {
    document.getElementById('btn-new-profile').addEventListener('click', openNewProfileModal);
    document.getElementById('btn-confirm-profile').addEventListener('click', confirmCreateProfile);

    document.getElementById('btn-import-ovgme').addEventListener('click', async () => {
        const btn = document.getElementById('btn-import-ovgme');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;vertical-align:middle;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Importation...';

        try {
            const count = await invoke('import_ovgme_profiles');
            if (count > 0) {
                toast(`${count} profil(s) OvGME importé(s) avec succès.`, 'success');
                await renderProfiles();
                updateProfileChip();
            } else {
                toast('Aucun nouveau profil OvGME trouvé.', 'info');
            }
        } catch (err) {
            toast('Erreur import OvGME : ' + err, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    });

    document.getElementById('btn-pick-game-path').addEventListener('click', async () => {
        const path = await pickFolder();
        if (path) document.getElementById('prof-game-path').value = path;
    });

    document.getElementById('btn-pick-mods-path').addEventListener('click', async () => {
        const path = await pickFolder();
        if (path) document.getElementById('prof-mods-path').value = path;
    });

    document.getElementById('btn-pick-backup-path').addEventListener('click', async () => {
        const path = await pickFolder();
        if (path) document.getElementById('prof-backup-path').value = path;
    });

    // Edit profile specific buttons
    document.getElementById('btn-edit-pick-game-path').addEventListener('click', async () => {
        const path = await pickFolder();
        if (path) document.getElementById('edit-prof-game-path').value = path;
    });
    document.getElementById('btn-edit-pick-mods-path').addEventListener('click', async () => {
        const path = await pickFolder();
        if (path) document.getElementById('edit-prof-mods-path').value = path;
    });
    document.getElementById('btn-edit-pick-backup-path').addEventListener('click', async () => {
        const path = await pickFolder();
        if (path) document.getElementById('edit-prof-backup-path').value = path;
    });
    document.getElementById('btn-confirm-edit-profile').addEventListener('click', confirmEditProfile);

    // Icon Picker Previews
    const profIcon = document.getElementById('prof-icon');
    const profIconPreview = document.getElementById('prof-icon-preview');
    if (profIcon && profIconPreview) {
        profIcon.addEventListener('change', () => {
            profIconPreview.innerHTML = getProfileIconSvg(profIcon.value, 'opacity:1;') || '';
        });
    }

    const editProfIcon = document.getElementById('edit-prof-icon');
    const editProfIconPreview = document.getElementById('edit-prof-icon-preview');
    if (editProfIcon && editProfIconPreview) {
        editProfIcon.addEventListener('change', () => {
            editProfIconPreview.innerHTML = getProfileIconSvg(editProfIcon.value, 'opacity:1;') || '';
        });
    }

    await renderProfiles();
}

function openNewProfileModal() {
    // Clear fields
    ['prof-name', 'prof-game', 'prof-game-path', 'prof-mods-path', 'prof-backup-path']
        .forEach(id => document.getElementById(id).value = '');
    document.getElementById('prof-color').value = '#3b82f6';
    document.getElementById('prof-icon').value = '';
    const preview = document.getElementById('prof-icon-preview');
    if (preview) preview.innerHTML = '';
    document.getElementById('modal-new-profile').classList.add('open');
}

async function confirmCreateProfile() {
    const name = document.getElementById('prof-name').value.trim();
    const gameName = document.getElementById('prof-game').value.trim();
    const gamePath = document.getElementById('prof-game-path').value.trim();
    const modsPath = document.getElementById('prof-mods-path').value.trim();
    const backupPath = document.getElementById('prof-backup-path').value.trim();
    const color = document.getElementById('prof-color').value || '#3b82f6';
    const icon = document.getElementById('prof-icon').value || null;

    if (!name || !gamePath || !modsPath || !backupPath) {
        toast('Veuillez remplir tous les champs obligatoires.', 'error');
        return;
    }

    try {
        const profile = await invoke('create_profile', { name, gameName, gamePath, modsPath, backupPath, color, icon });
        document.getElementById('modal-new-profile').classList.remove('open');
        toast(`Profil "${profile.name}" créé avec succès.`, 'success');
        await renderProfiles();
        updateProfileChip();
    } catch (err) {
        toast('Erreur : ' + err, 'error');
    }
}

async function confirmEditProfile() {
    const profileId = document.getElementById('edit-prof-id').value;
    const name = document.getElementById('edit-prof-name').value.trim();
    const gameName = document.getElementById('edit-prof-game').value.trim();
    const gamePath = document.getElementById('edit-prof-game-path').value.trim();
    const modsPath = document.getElementById('edit-prof-mods-path').value.trim();
    const backupPath = document.getElementById('edit-prof-backup-path').value.trim();
    const color = document.getElementById('edit-prof-color').value || '#3b82f6';
    const icon = document.getElementById('edit-prof-icon').value || null;

    if (!name || !gamePath || !modsPath || !backupPath) {
        toast('Veuillez remplir tous les champs obligatoires.', 'error');
        return;
    }

    try {
        await invoke('update_profile', { profileId, name, gameName, gamePath, modsPath, backupPath, color, icon });
        document.getElementById('modal-edit-profile').classList.remove('open');
        toast(`Profil "${name}" mis à jour.`, 'success');
        await renderProfiles();
        updateProfileChip();
    } catch (err) {
        toast('Erreur : ' + err, 'error');
    }
}

export async function renderProfiles() {
    const grid = document.getElementById('profile-grid');
    const emptyEl = document.getElementById('empty-profiles');
    const badgeEl = document.getElementById('badge-profiles');

    const [profiles, activeId] = await Promise.all([
        invoke('get_profiles'),
        invoke('get_active_profile_id'),
    ]);

    // Fetch all mods for count display
    let allModsCache = [];
    try { allModsCache = await invoke('get_mods'); } catch { }

    // Badge
    const count = profiles.length;
    badgeEl.textContent = count;
    badgeEl.classList.toggle('show', count > 0);

    // Clear old cards (keep empty-state)
    Array.from(grid.children).forEach(c => { if (!c.id.startsWith('empty')) grid.removeChild(c); });

    if (count === 0) {
        emptyEl.style.display = '';
        return;
    }

    emptyEl.style.display = 'none';

    profiles.forEach(p => {
        const isActive = p.id === activeId;
        const card = document.createElement('div');
        card.className = 'profile-card' + (isActive ? ' active-profile' : '');
        card.dataset.id = p.id;
        const brandColor = p.color || '#3b82f6';

        // Count mods for this profile
        let modCountLabel = t('prof.noMods');
        try {
            const profileMods = allModsCache.filter(m => m.mod_folder_path && m.mod_folder_path.startsWith(p.mods_path));
            const enabledCount = profileMods.filter(m => m.enabled).length;
            if (profileMods.length > 0) {
                modCountLabel = t('prof.modsActive', { count: enabledCount }) + ' / ' + profileMods.length;
            }
        } catch { }

        card.innerHTML = `
      <div class="profile-card-header" style="display:flex;align-items:center;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.05);margin-bottom:16px;padding:0;min-height:36px">
        <div style="width:3px;height:28px;border-radius:2px;background:${brandColor};margin-right:12px;flex-shrink:0"></div>
        ${p.icon ? `<div style="color:${brandColor};display:flex;align-items:center;margin-right:12px;opacity:0.9">${getProfileIconSvg(p.icon, 'margin:0;')}</div>` : ''}
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center">
          <div style="font-weight:700;font-size:16px;color:var(--text-primary);line-height:1.2;word-break:break-word">${escHtml(p.name)}</div>
        </div>
        ${p.game_name ? `<div style="font-family:var(--font-mono);font-size:11px;padding:4px 10px;border-radius:6px;background:${brandColor}20;color:${brandColor};border:1px solid ${brandColor}30;margin-left:12px;flex-shrink:0;text-align:center;word-break:keep-all">${escHtml(p.game_name)}</div>` : ''}
      </div>
      <div class="profile-card-paths" style="margin-bottom:12px">
        <div class="profile-path" style="margin-bottom:8px">
          <span class="profile-path-label">${t('prof.gamePath')}</span>
          <span class="profile-path-value mono">${escHtml(p.game_path)}</span>
        </div>
        <div class="profile-path">
          <span class="profile-path-label">${t('prof.modsPath')}</span>
          <span class="profile-path-value mono">${escHtml(p.mods_path)}</span>
        </div>
        <div class="profile-path">
          <span class="profile-path-label">${t('prof.backupPath')}</span>
          <span class="profile-path-value mono">${escHtml(p.backup_path)}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">${modCountLabel}</span>
      </div>
      <div class="profile-card-actions">
        <button class="btn btn-secondary btn-sm flex-1 btn-activate" style="flex:1" data-id="${p.id}">
          ${isActive ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="vertical-align:middle;margin-right:4px"><polyline points="20 6 9 17 4 12"/></svg>' + t('prof.active') : t('mod.activate')}
        </button>
        <button class="btn btn-secondary btn-sm btn-edit-profile" data-id="${p.id}" title="${t('prof.editTitle')}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
        </button>
        <button class="btn btn-danger btn-sm btn-del-profile" data-id="${p.id}" title="${t('prof.confirmDelete')}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
          </svg>
        </button>
      </div>
    `;
        grid.appendChild(card);
    });

    // Events
    grid.querySelectorAll('.btn-activate').forEach(btn => {
        btn.addEventListener('click', async e => {
            const id = e.currentTarget.dataset.id;
            await invoke('set_active_profile', { profileId: id });
            await renderProfiles();
            updateProfileChip();
            await refreshMods();
        });
    });

    grid.querySelectorAll('.btn-edit-profile').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const id = e.currentTarget.dataset.id;
            const profile = profiles.find(p => p.id === id);
            if (profile) {
                document.getElementById('edit-prof-id').value = profile.id;
                document.getElementById('edit-prof-name').value = profile.name;
                document.getElementById('edit-prof-game').value = profile.game_name || '';
                document.getElementById('edit-prof-game-path').value = profile.game_path;
                document.getElementById('edit-prof-mods-path').value = profile.mods_path;
                document.getElementById('edit-prof-backup-path').value = profile.backup_path;
                document.getElementById('edit-prof-color').value = profile.color || '#3b82f6';
                document.getElementById('edit-prof-icon').value = profile.icon || '';
                const preview = document.getElementById('edit-prof-icon-preview');
                if (preview) preview.innerHTML = getProfileIconSvg(profile.icon, 'opacity:1;') || '';
                document.getElementById('modal-edit-profile').classList.add('open');
            }
        });
    });

    grid.querySelectorAll('.btn-del-profile').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const id = e.currentTarget.dataset.id;
            if (!confirm('Supprimer ce profil ?')) return;
            await invoke('delete_profile', { profileId: id });
            await renderProfiles();
            updateProfileChip();
            toast('Profil supprimé.', 'info');
        });
    });
}

export async function updateProfileChip() {
    const [profiles, activeId] = await Promise.all([
        invoke('get_profiles'),
        invoke('get_active_profile_id'),
    ]);
    const active = profiles.find(p => p.id === activeId);
    const nameEl = document.getElementById('chip-profile-name');
    nameEl.textContent = active ? active.name : '—';
}

export function getProfileIconSvg(iconName, extraStyle = '') {
    if (!iconName) return '';
    const style = `vertical-align:middle;${extraStyle}`;
    switch (iconName) {
        case 'gamepad': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><line x1="6" y1="12" x2="10" y2="12"></line><line x1="8" y1="10" x2="8" y2="14"></line><line x1="15" y1="13" x2="15.01" y2="13"></line><line x1="18" y1="11" x2="18.01" y2="11"></line><rect x="2" y="6" width="20" height="12" rx="2"></rect></svg>`;
        case 'sword': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"></polyline><line x1="13" y1="19" x2="19" y2="13"></line><line x1="16" y1="16" x2="20" y2="20"></line><line x1="19" y1="21" x2="21" y2="19"></line></svg>`;
        case 'plane': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.2-1.1.7l-1.2 3.3c-.2.5.1 1 .6 1.1l7.3 2-2.8 2.8-3.2-.8c-.5-.1-.9.2-1.1.7l-1 2.6c-.2.5.2 1 .7 1.1l5.5 1.4 1.4 5.5c.1.5.6.9 1.1.7l2.6-1c.5-.2.8-.6.7-1.1l-.8-3.2 2.8-2.8 2 7.3c.1.5.6.8 1.1.6l3.3-1.2c.5-.2.8-.6.7-1.1z"></path></svg>`;
        case 'car': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a2 2 0 0 0-1.6-.8H9.3a2 2 0 0 0-1.6.8L5 11l-5.16.86a1 1 0 0 0-.84.99V16h3m10 0a2 2 0 1 1-4 0m4 0a2 2 0 1 0-4 0m-6 0a2 2 0 1 1-4 0m4 0a2 2 0 1 0-4 0"></path></svg>`;
        case 'star': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        case 'shield': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`;
        case 'crosshair': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="18" y2="12"></line><line x1="6" y1="12" x2="2" y2="12"></line><line x1="12" y1="6" x2="12" y2="2"></line><line x1="12" y1="22" x2="12" y2="18"></line></svg>`;
        case 'rocket': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path></svg>`;
        case 'anchor': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="5" r="3"></circle><line x1="12" y1="22" x2="12" y2="8"></line><path d="M5 12H2a10 10 0 0 0 20 0h-3"></path></svg>`;
        case 'zap': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
        case 'cpu': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>`;
        case 'globe': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
        case 'map': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polygon points="1 6 8 2 16 6 23 2 23 18 16 22 8 18 1 22 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>`;
        case 'mountain': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="m8 3 4 8 5-5 5 15H2L8 3z"></path></svg>`;
        case 'music': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
        default: return '';
    }
}

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
