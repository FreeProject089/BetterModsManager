/**
 * profile-create.ts — the guided half of the "New profile" dialog (#modal-new-profile).
 *
 * profiles.ts still owns opening the dialog, the icon / background pickers and the
 * create_profile call; this file owns the three folder fields and what the dialog says about
 * them: does the folder exist, how much room is left on its drive, is the game folder shared
 * with another profile (and what that means), is the mods or backup folder one that must not
 * be shared, a mods folder to start from, and what still blocks Create.
 *
 * The rules themselves are pure and unit-tested (profile-folders-model.ts). Writability is
 * not probed here: no backend command answers it without writing into the game folder, so
 * the dialog does not claim to know.
 */
import { invoke, pickFolderAt } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { uiIcon } from '../../ui/icons.js';
import {
    folderNotes, missingForCreate, modsFolderCandidates, folderName, parentFolder, sameFolder,
    type FolderKind, type FolderNote, type ProfileLike,
} from './profile-folders-model.js';
import { formatSize } from '../mods/add-mod-model.js';

interface FieldIds { input: string; button: string; check: string }

const FIELDS: Record<FolderKind, FieldIds> = {
    game: { input: 'prof-game-path', button: 'btn-pick-game-path', check: 'prof-game-path-check' },
    mods: { input: 'prof-mods-path', button: 'btn-pick-mods-path', check: 'prof-mods-path-check' },
    backup: { input: 'prof-backup-path', button: 'btn-pick-backup-path', check: 'prof-backup-path-check' },
};
const KINDS: FolderKind[] = ['game', 'mods', 'backup'];

let profiles: ProfileLike[] = [];
const exists: Record<FolderKind, boolean | null> = { game: null, mods: null, backup: null };
const freeText: Record<FolderKind, string> = { game: '', mods: '', backup: '' };
const asked: Record<FolderKind, number> = { game: 0, mods: 0, backup: 0 };
let suggestGen = 0;
let nameTouched = false;
let wired = false;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const val = (id: string): string => ($<HTMLInputElement>(id)?.value || '').trim();

function ctxFor(kind: FolderKind) {
    return { exists: exists[kind], gamePath: val(FIELDS.game.input), modsPath: val(FIELDS.mods.input), backupPath: val(FIELDS.backup.input), profiles };
}

function notesFor(kind: FolderKind): FolderNote[] {
    return folderNotes(kind, val(FIELDS[kind].input), ctxFor(kind));
}

const NOTE_ICON: Record<string, 'success' | 'info' | 'warning' | 'alert'> = { ok: 'success', info: 'info', warn: 'warning', error: 'alert' };

function renderField(kind: FolderKind): void {
    const box = $(FIELDS[kind].check);
    const input = $<HTMLInputElement>(FIELDS[kind].input);
    if (!box || !input) return;
    const path = input.value.trim();
    const notes = notesFor(kind);
    const lines: string[] = [];
    if (path && exists[kind] === null) {
        lines.push(`<div class="np-note np-note--pending">${uiIcon('loader', 14, { cls: 'np-spin' })}<span>${escHtml(t('prof.chk.checking'))}</span></div>`);
    }
    for (const n of notes) {
        lines.push(`<div class="np-note np-note--${n.level}">${uiIcon(NOTE_ICON[n.level], 14)}<span>${escHtml(t(n.key, n.vars || {}))}</span></div>`);
    }
    if (path && exists[kind] && freeText[kind]) {
        lines.push(`<div class="np-note np-note--meta">${uiIcon('hard-drive', 14)}<span>${escHtml(freeText[kind])}</span></div>`);
    }
    box.innerHTML = lines.join('');
    const worst = notes.find((n) => n.level === 'error') ? 'error' : notes.find((n) => n.level === 'warn') ? 'warn' : '';
    const picker = input.closest('.path-picker');
    picker?.classList.toggle('np-picker--error', worst === 'error');
    picker?.classList.toggle('np-picker--warn', worst === 'warn');
    input.setAttribute('aria-invalid', worst === 'error' ? 'true' : 'false');
    input.title = path;
}

/** Recompute every field (they depend on each other: mods vs game, backup vs both). */
function renderAll(): void {
    for (const k of KINDS) renderField(k);
    renderFooter();
}

function renderFooter(): void {
    const hint = $('prof-create-hint');
    const btn = $<HTMLButtonElement>('btn-confirm-profile');
    const missing = missingForCreate(val('prof-name'), val(FIELDS.game.input), val(FIELDS.mods.input), KINDS.map(notesFor));
    const pending = KINDS.some((k) => val(FIELDS[k].input) && exists[k] === null);
    if (btn && !btn.classList.contains('is-busy')) btn.disabled = missing.length > 0 || pending;
    if (!hint || hint.classList.contains('np-hint--error')) return;
    if (pending) hint.textContent = t('prof.chk.checking');
    else if (missing.length) hint.textContent = t('prof.need.lead', { what: missing.map((k) => t(k)).join(', ') });
    else hint.textContent = t('prof.need.ready');
    hint.classList.toggle('np-hint--ready', !pending && !missing.length);
}

async function check(kind: FolderKind): Promise<void> {
    const path = val(FIELDS[kind].input);
    const ticket = ++asked[kind];
    exists[kind] = null;
    freeText[kind] = '';
    clearCreateError();
    renderAll();
    if (!path) { renderAll(); return; }
    let ok: boolean | null;
    try { ok = !!(await invoke('path_exists', { path }, { quiet: true })); } catch { ok = null; }
    if (ticket !== asked[kind]) return;
    exists[kind] = ok === null ? true : ok;
    if (ok) {
        try {
            const d: any = await invoke('check_disk_space', { path }, { quiet: true });
            if (ticket === asked[kind] && d && typeof d.available_bytes === 'number') {
                freeText[kind] = t('prof.chk.free', { free: formatSize(d.available_bytes), drive: String(d.mount_point || '') });
            }
        } catch { /* the free space is a courtesy */ }
    }
    if (ticket !== asked[kind]) return;
    renderAll();
    if (kind === 'game') void suggestModsFolder();
}

/** Fill one folder field and check it (the pickers, a suggestion chip, or a caller that
 *  already knows the folder, e.g. an import). */
export function setNewProfileFolder(kind: FolderKind, path: string): void {
    setPath(kind, path);
}

function setPath(kind: FolderKind, path: string): void {
    const input = $<HTMLInputElement>(FIELDS[kind].input);
    if (!input) return;
    input.value = path;
    if (kind === 'game') {
        const game = $<HTMLInputElement>('prof-game');
        if (game && !game.value.trim()) game.value = folderName(path);
        const name = $<HTMLInputElement>('prof-name');
        if (name && !name.value.trim() && !nameTouched) name.value = game?.value.trim() || folderName(path);
    }
    void check(kind);
    // The others are judged against this one.
    for (const k of KINDS) if (k !== kind) renderField(k);
}

/** Where the folder dialog opens: the folder already there, else next to the game. */
function startFor(kind: FolderKind): string | undefined {
    const own = val(FIELDS[kind].input);
    if (own) return own;
    const game = val(FIELDS.game.input);
    if (kind !== 'game' && game) return parentFolder(game) || game;
    return undefined;
}

async function suggestModsFolder(): Promise<void> {
    const box = $('prof-mods-suggest');
    if (!box) return;
    const gen = ++suggestGen;
    const game = val(FIELDS.game.input);
    if (!game || val(FIELDS.mods.input) || exists.game === false) { box.hidden = true; box.innerHTML = ''; return; }
    const found: string[] = [];
    for (const c of modsFolderCandidates(game, val('prof-game'))) {
        let ok = false;
        try { ok = !!(await invoke('path_exists', { path: c }, { quiet: true })); } catch { ok = false; }
        if (gen !== suggestGen) return;
        if (ok && !profiles.some((p) => sameFolder(p.mods_path, c))) found.push(c);
        if (found.length >= 2) break;
    }
    if (gen !== suggestGen || val(FIELDS.mods.input)) return;
    if (!found.length) {
        box.hidden = false;
        box.innerHTML = `<span class="np-suggest-lead">${escHtml(t('prof.suggest.none'))}</span>`;
        return;
    }
    box.hidden = false;
    box.innerHTML = `<span class="np-suggest-lead">${escHtml(t('prof.suggest.lead'))}</span>`
        + found.map((p) => `<button type="button" class="bms-chip np-suggest-chip" data-path="${escAttr(p)}" title="${escAttr(p)}">${uiIcon('folder', 14)}<span>${escHtml(p)}</span></button>`).join('');
}

export function clearCreateError(): void {
    const hint = $('prof-create-hint');
    if (!hint || !hint.classList.contains('np-hint--error')) return;
    hint.classList.remove('np-hint--error');
    hint.removeAttribute('role');
    renderFooter();
}

/** A refusal from create_profile, said where the button is rather than in a toast. */
export function showCreateError(message: string): void {
    const hint = $('prof-create-hint');
    if (!hint) return;
    hint.classList.remove('np-hint--ready');
    hint.classList.add('np-hint--error');
    hint.setAttribute('role', 'alert');
    hint.textContent = message;
}

export function setCreateBusy(busy: boolean): void {
    const btn = $<HTMLButtonElement>('btn-confirm-profile');
    if (!btn) return;
    btn.classList.toggle('is-busy', busy);
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (busy) btn.disabled = true;
    else renderFooter();
}

/** Ready to create? If not, the first thing to fix gets the focus and says why. */
export function newProfileReady(): boolean {
    const missing = missingForCreate(val('prof-name'), val(FIELDS.game.input), val(FIELDS.mods.input), KINDS.map(notesFor));
    if (!missing.length) return true;
    if (missing.includes('prof.need.name')) {
        showNameError(true);
        $('prof-name')?.focus();
    } else if (missing.includes('prof.need.game')) $(FIELDS.game.button)?.focus();
    else if (missing.includes('prof.need.mods')) $(FIELDS.mods.button)?.focus();
    renderFooter();
    return false;
}

function showNameError(on: boolean): void {
    const err = $('prof-name-error');
    const input = $<HTMLInputElement>('prof-name');
    if (err) { err.hidden = !on; err.textContent = on ? t('prof.need.nameErr') : ''; }
    input?.setAttribute('aria-invalid', on ? 'true' : 'false');
}

/** Once: the three Browse buttons, the suggestion chips, the name field. */
export function wireNewProfileForm(): void {
    if (wired) return;
    wired = true;
    for (const kind of KINDS) {
        $(FIELDS[kind].button)?.addEventListener('click', async () => {
            const picked = await pickFolderAt(startFor(kind));
            if (picked) setPath(kind, picked);
        });
    }
    $('prof-mods-suggest')?.addEventListener('click', (e) => {
        const chip = (e.target as HTMLElement).closest<HTMLElement>('.np-suggest-chip');
        if (!chip?.dataset.path) return;
        const box = $('prof-mods-suggest');
        if (box) { box.hidden = true; box.innerHTML = ''; }
        setPath('mods', chip.dataset.path);
    });
    const name = $<HTMLInputElement>('prof-name');
    name?.addEventListener('input', () => { nameTouched = true; if (name.value.trim()) showNameError(false); clearCreateError(); renderFooter(); });
    name?.addEventListener('blur', () => { if (nameTouched && !name.value.trim()) showNameError(true); });
    $('prof-game')?.addEventListener('input', () => { if (!val(FIELDS.mods.input)) void suggestModsFolder(); });
    // Enter in a text field means Create, as in every other form of the app.
    for (const id of ['prof-name', 'prof-game']) {
        $(id)?.addEventListener('keydown', (e) => {
            if ((e as KeyboardEvent).key !== 'Enter') return;
            e.preventDefault();
            $<HTMLButtonElement>('btn-confirm-profile')?.click();
        });
    }
}

/** Every time the dialog opens: fresh fields, the current profiles to compare against. */
export async function resetNewProfileForm(): Promise<void> {
    wireNewProfileForm();
    nameTouched = false;
    suggestGen++;
    for (const k of KINDS) { exists[k] = null; freeText[k] = ''; asked[k]++; }
    showNameError(false);
    const box = $('prof-mods-suggest');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    const hint = $('prof-create-hint');
    hint?.classList.remove('np-hint--error', 'np-hint--ready');
    hint?.removeAttribute('role');
    setCreateBusy(false);
    renderAll();
    try { profiles = ((await invoke('get_profiles', {}, { quiet: true })) as ProfileLike[]) || []; } catch { profiles = []; }
    renderAll();
}
