/**
 * security-modal.ts — Premium Security Access Mode Selection
 */

import { invoke } from '../core/api.js';
import { t } from '../core/i18n.js';
import { openModal } from './modal-shell.js';
import { uiIcon } from './icons.js';

export async function checkSecurityMode(): Promise<void> {
    try {
        const settings = await invoke('get_settings');
        // @ts-ignore
        if (!settings.fs_security_mode) {
            await showSecurityModal();
        }
    } catch (e) {
        console.error('[Security] Failed to check security mode:', e);
    }
}

// The first-run file-access question, on the house shell (openModal). It must be answered:
// no ×, Escape does nothing, a click on the dim does nothing. The same two cards and the same
// four calls as the launch deck's file-access step (launch-steps.ts).
function showSecurityModal(): Promise<void> {
    return new Promise((resolve) => {
        document.getElementById('modal-security-choice')?.remove();
        let selected: 'full' | 'limited' = 'full';

        const body = document.createElement('div');
        body.className = 'secm-body';
        const lede = document.createElement('p');
        lede.className = 'modal-message';
        lede.textContent = t('security.modal.desc');
        const list = document.createElement('div');
        list.className = 'secm-choices';
        list.setAttribute('role', 'radiogroup');
        list.setAttribute('aria-label', t('security.modal.title'));
        const card = (mode: 'full' | 'limited', title: string, desc: string): HTMLElement => {
            const row = document.createElement('label');
            row.className = 'secm-choice' + (mode === selected ? ' is-on' : '');
            const r = document.createElement('input');
            r.type = 'radio';
            r.name = 'secm-fs-mode';
            r.value = mode;
            r.checked = mode === selected;
            r.id = `btn-sec-${mode}`;
            r.addEventListener('change', () => {
                if (!r.checked) return;
                selected = mode;
                list.querySelectorAll('.secm-choice').forEach((n) => n.classList.toggle('is-on', n === row));
            });
            const txt = document.createElement('span');
            txt.className = 'secm-choice-txt';
            const name = document.createElement('span');
            name.className = 'secm-choice-name';
            name.textContent = title;
            const d = document.createElement('span');
            d.className = 'secm-choice-desc';
            d.textContent = desc;
            txt.append(name, d);
            row.append(r, txt);
            return row;
        };
        // The title already says "(recommended)" in both languages; no badge saying it twice.
        list.append(
            card('full', t('security.modal.full'), t('security.modal.fullDesc')),
            card('limited', t('security.modal.limited'), t('security.modal.limitedDesc')),
        );
        const err = document.createElement('p');
        err.className = 'secm-error';
        err.hidden = true;
        body.append(lede, list, err);

        const btnSave = document.createElement('button');
        btnSave.type = 'button';
        btnSave.className = 'btn btn-primary';
        btnSave.id = 'btn-sec-confirm';
        btnSave.textContent = t('security.modal.apply');

        const m = openModal({
            id: 'modal-security-choice',
            title: t('security.modal.title'),
            icon: (uiIcon('shield-check', 20)),
            size: 'sm',
            body,
            footer: btnSave,
            dismissible: false,
            initialFocus: btnSave,
        });
        // The global Escape handler leaves it alone too (it is bound, but say it on the overlay).
        m.overlay.setAttribute('data-prevent-close', 'true');

        btnSave.addEventListener('click', async () => {
            btnSave.disabled = true;
            err.hidden = true;
            try {
                const settings: any = await invoke('get_settings');
                settings.fs_security_mode = selected;
                await invoke('update_settings', { settings });
                await invoke('apply_fs_security_mode_command');
                m.close();
                resolve();
            } catch (e) {
                console.error('[Security] Error saving mode:', e);
                err.textContent = `${t('common.error')}: ${e}`;
                err.hidden = false;
                btnSave.disabled = false;
            }
        });
    });
}
