/**
 * profiles.js — Profile management
 */
import { invoke, pickFolder, toast } from './app.js';
import { refreshMods } from './mods.js';

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

    await renderProfiles();
}

function openNewProfileModal() {
    // Clear fields
    ['prof-name', 'prof-game', 'prof-game-path', 'prof-mods-path', 'prof-backup-path']
        .forEach(id => document.getElementById(id).value = '');
    document.getElementById('prof-color').value = '#3b82f6';
    document.getElementById('prof-icon').value = '';
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
        const colorStyle = p.color ? `style="--card-color: ${p.color}; border-left: 3px solid var(--card-color);"` : '';
        const iconSvg = getProfileIconSvg(p.icon);

        card.innerHTML = `
      <div class="profile-card-header" ${colorStyle}>
        <span class="profile-card-name">${iconSvg}${escHtml(p.name)}</span>
        ${p.game_name ? `<span class="profile-card-game">${escHtml(p.game_name)}</span>` : ''}
      </div>
      <div class="profile-card-paths">
        <div class="profile-path">
          <span class="profile-path-label">Jeu</span>
          <span class="profile-path-value mono">${escHtml(p.game_path)}</span>
        </div>
        <div class="profile-path">
          <span class="profile-path-label">Mods</span>
          <span class="profile-path-value mono">${escHtml(p.mods_path)}</span>
        </div>
        <div class="profile-path">
          <span class="profile-path-label">Backup</span>
          <span class="profile-path-value mono">${escHtml(p.backup_path)}</span>
        </div>
      </div>
      <div class="profile-card-actions">
        <button class="btn btn-secondary btn-sm flex-1 btn-activate" style="flex:1" data-id="${p.id}">
          ${isActive ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="vertical-align:middle;margin-right:4px"><polyline points="20 6 9 17 4 12"/></svg>Actif' : 'Activer'}
        </button>
        <button class="btn btn-secondary btn-sm btn-edit-profile" data-id="${p.id}" title="Éditer">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
        </button>
        <button class="btn btn-danger btn-sm btn-del-profile" data-id="${p.id}" title="Supprimer">
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

function getProfileIconSvg(iconName) {
    if (!iconName) return '';
    const style = 'vertical-align:middle;margin-right:6px;opacity:0.8';
    switch (iconName) {
        case 'gamepad':
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><line x1="6" y1="12" x2="10" y2="12"></line><line x1="8" y1="10" x2="8" y2="14"></line><line x1="15" y1="13" x2="15.01" y2="13"></line><line x1="18" y1="11" x2="18.01" y2="11"></line><rect x="2" y="6" width="20" height="12" rx="2"></rect></svg>`;
        case 'sword':
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"></polyline><line x1="13" y1="19" x2="19" y2="13"></line><line x1="16" y1="16" x2="20" y2="20"></line><line x1="19" y1="21" x2="21" y2="19"></line></svg>`;
        case 'plane':
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.2-1.1.7l-1.2 3.3c-.2.5.1 1 .6 1.1l7.3 2-2.8 2.8-3.2-.8c-.5-.1-.9.2-1.1.7l-1 2.6c-.2.5.2 1 .7 1.1l5.5 1.4 1.4 5.5c.1.5.6.9 1.1.7l2.6-1c.5-.2.8-.6.7-1.1l-.8-3.2 2.8-2.8 2 7.3c.1.5.6.8 1.1.6l3.3-1.2c.5-.2.8-.6.7-1.1z"></path></svg>`;
        case 'car':
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a2 2 0 0 0-1.6-.8H9.3a2 2 0 0 0-1.6.8L5 11l-5.16.86a1 1 0 0 0-.84.99V16h3m10 0a2 2 0 1 1-4 0m4 0a2 2 0 1 0-4 0m-6 0a2 2 0 1 1-4 0m4 0a2 2 0 1 0-4 0"></path></svg>`;
        case 'star':
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        default:
            return '';
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
