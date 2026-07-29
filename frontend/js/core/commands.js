// Command system — one registry that powers BOTH the app-wide command palette (Ctrl/⌘+K)
// and the rebindable keyboard-shortcuts manager in Settings. Every navigable/actionable thing
// is a Command with an id, a bilingual title, keywords, a run(), and an optional default chord.
//
// - Chords are full combinations (Ctrl / Shift / Alt + key), not the old "Ctrl + single letter".
// - Custom bindings persist in localStorage (bmm_cmd_bindings) layered over the defaults, so a
//   user can rebind or clear any shortcut from Settings → Raccourcis Clavier.
// - A single global dispatcher matches a keypress against every bound command and runs it.
// - The palette does classic + semantic (synonym-expanded, Algolia-style) search over commands.
import { getLang, getSynonyms } from './i18n.js';
const tr = (s) => (getLang() === 'fr' ? s.fr : s.en);
// ── chord helpers ──────────────────────────────────────────────────────────────
const MOD_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'os']);
export function chordFromEvent(e) {
    const k = e.key.toLowerCase();
    if (MOD_KEYS.has(k))
        return null; // a modifier alone isn't a chord
    return { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, key: k === ' ' ? 'space' : k };
}
export function chordToStr(c) {
    if (!c || !c.key)
        return '';
    const p = [];
    if (c.ctrl)
        p.push('Ctrl');
    if (c.shift)
        p.push('Shift');
    if (c.alt)
        p.push('Alt');
    p.push(c.key.length === 1 ? c.key.toUpperCase() : c.key.replace(/^\w/, (m) => m.toUpperCase()));
    return p.join('+');
}
function chordEq(a, b) {
    if (!a || !b)
        return false;
    return !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.alt === !!b.alt && a.key === b.key;
}
function matches(e, c) {
    if (!c || !c.key)
        return false;
    const k = (e.key.toLowerCase() === ' ' ? 'space' : e.key.toLowerCase());
    return (e.ctrlKey || e.metaKey) === !!c.ctrl && e.shiftKey === !!c.shift && e.altKey === !!c.alt && k === c.key;
}
// ── registry + persistence ─────────────────────────────────────────────────────
const _cmds = new Map();
export function registerCommand(cmd) { _cmds.set(cmd.id, cmd); }
export function allCommands() { return [..._cmds.values()]; }
const LS = 'bmm_cmd_bindings';
function loadOverrides() { try {
    return JSON.parse(localStorage.getItem(LS) || '{}');
}
catch {
    return {};
} }
function saveOverrides(o) { try {
    localStorage.setItem(LS, JSON.stringify(o));
}
catch { /* ignore */ } }
/** Effective chord for a command: a user override (may be "" = intentionally unbound) wins over the default. */
export function bindingOf(id) {
    const o = loadOverrides();
    if (Object.prototype.hasOwnProperty.call(o, id))
        return o[id] ? parseChord(o[id]) : null;
    return _cmds.get(id)?.defaultChord ?? null;
}
export function parseChord(s) {
    if (!s)
        return null;
    const parts = s.split('+').map((x) => x.trim().toLowerCase());
    const key = parts.pop() || '';
    return { ctrl: parts.includes('ctrl'), shift: parts.includes('shift'), alt: parts.includes('alt'), key };
}
/** Set (chord), clear (null), or reset-to-default (undefined) a command's binding. */
export function setBinding(id, chord) {
    const o = loadOverrides();
    if (chord === undefined)
        delete o[id]; // reset → fall back to default
    else
        o[id] = chord ? chordToStr(chord) : ''; // "" = explicitly unbound
    saveOverrides(o);
}
/** The command currently bound to a chord, if any (for conflict detection). Excludes `exceptId`. */
export function conflictFor(chord, exceptId) {
    if (!chord)
        return null;
    for (const c of _cmds.values()) {
        if (c.id === exceptId)
            continue;
        if (chordEq(bindingOf(c.id), chord))
            return c;
    }
    return null;
}
// ── global dispatcher ──────────────────────────────────────────────────────────
function isTyping(el) {
    const n = el;
    if (!n)
        return false;
    const tag = n.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || n.isContentEditable;
}
function onKeydown(e) {
    // Let the palette handle its own keys when open.
    if (paletteOpen)
        return;
    const typing = isTyping(e.target);
    for (const c of _cmds.values()) {
        if (c.contextual)
            continue;
        const ch = bindingOf(c.id);
        if (!ch)
            continue;
        // While typing, only fire chords that use a modifier (so plain letters don't hijack typing).
        if (typing && !ch.ctrl && !ch.alt)
            continue;
        if (matches(e, ch)) {
            e.preventDefault();
            try {
                c.run();
            }
            catch { /* ignore */ }
            return;
        }
    }
}
// ── the command palette (Ctrl/⌘+K) ───────────────────────────────────────────────
let overlay = null;
let paletteOpen = false;
let pMode = 'classic';
let pResults = [];
let pActive = 0;
function expand(q) {
    const base = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (pMode === 'classic')
        return base;
    const syn = getSynonyms() || {};
    const set = new Set(base);
    for (const tok of base)
        for (const [k, list] of Object.entries(syn))
            if (k.toLowerCase() === tok || (list || []).some((s) => s.toLowerCase() === tok)) {
                set.add(k.toLowerCase());
                (list || []).forEach((s) => set.add(s.toLowerCase()));
            }
    return [...set];
}
function searchCommands(q) {
    const terms = expand(q);
    const scored = allCommands().map((c) => {
        const hay = `${tr(c.title)} ${c.title.en} ${c.title.fr} ${c.keywords || ''} ${c.category}`.toLowerCase();
        let s = 0;
        for (const term of terms)
            if (term && hay.includes(term))
                s += 1;
        return { c, s };
    }).filter((x) => !q || x.s > 0);
    scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.c);
}
const CAT_LABEL = {
    nav: { en: 'Go to', fr: 'Aller à' }, mods: { en: 'Mods', fr: 'Mods' }, profiles: { en: 'Profiles', fr: 'Profils' },
    repo: { en: 'Server Repo', fr: 'Dépôt serveur' }, tools: { en: 'Tools', fr: 'Outils' },
    settings: { en: 'Settings', fr: 'Paramètres' }, help: { en: 'Help', fr: 'Aide' },
};
function renderPalette() {
    const list = overlay?.querySelector('.cp-list');
    if (!list)
        return;
    if (!pResults.length) {
        list.innerHTML = `<div class="cp-empty">${tr({ en: 'No commands match.', fr: 'Aucune commande.' })}</div>`;
        return;
    }
    list.innerHTML = pResults.map((c, i) => {
        const ch = bindingOf(c.id);
        return `<button class="cp-item ${i === pActive ? 'on' : ''}" data-i="${i}">
      <span class="cp-cat">${tr(CAT_LABEL[c.category])}</span>
      <span class="cp-title">${tr(c.title)}</span>
      ${ch ? `<kbd class="cp-kbd">${chordToStr(ch)}</kbd>` : ''}
    </button>`;
    }).join('');
    const act = list.querySelector('.cp-item.on');
    act?.scrollIntoView({ block: 'nearest' });
}
function updateResults(q) { pResults = searchCommands(q).slice(0, 40); pActive = 0; renderPalette(); }
function runActive() {
    const c = pResults[pActive];
    closePalette();
    if (c) {
        try {
            c.run();
        }
        catch { /* ignore */ }
    }
}
export function openCommandPalette() {
    if (paletteOpen)
        return;
    ensurePaletteStyles();
    refreshNavCommands(); // palette always shows the current navbar (custom pages included)
    paletteOpen = true;
    // Tutorial hook — lets the interactive tutorial gate a step on "open the palette".
    try {
        document.dispatchEvent(new CustomEvent('bmm:action:palette-opened', { detail: {} }));
    }
    catch { /* ignore */ }
    overlay = document.createElement('div');
    overlay.className = 'cp-overlay';
    overlay.innerHTML = `
    <div class="cp-box" role="dialog" aria-modal="true">
      <div class="cp-search">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="cp-input" type="text" autocomplete="off" spellcheck="false" placeholder="${tr({ en: 'Type a command or search…', fr: 'Tapez une commande ou recherchez…' })}">
        <div class="cp-modes">
          <button class="cp-mode ${pMode === 'classic' ? 'on' : ''}" data-mode="classic">${tr({ en: 'Classic', fr: 'Classique' })}</button>
          <button class="cp-mode ${pMode === 'semantic' ? 'on' : ''}" data-mode="semantic">${tr({ en: 'Semantic', fr: 'Sémantique' })}</button>
        </div>
      </div>
      <div class="cp-list"></div>
      <div class="cp-foot"><kbd>↑</kbd><kbd>↓</kbd> ${tr({ en: 'navigate', fr: 'naviguer' })} · <kbd>↵</kbd> ${tr({ en: 'run', fr: 'exécuter' })} · <kbd>Esc</kbd> ${tr({ en: 'close', fr: 'fermer' })}</div>
    </div>`;
    // Mount inside the visible, rounded, clipped app window (#app-window-outer) so the backdrop
    // and the box's drop-shadow can't bleed into the transparent OS-webview margin around BMM.
    // Falls back to <body> if the frame element isn't present.
    (document.getElementById('app-window-outer') || document.body).appendChild(overlay);
    const input = overlay.querySelector('.cp-input');
    updateResults('');
    input.focus();
    input.addEventListener('input', () => updateResults(input.value.trim()));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            pActive = Math.min(pResults.length - 1, pActive + 1);
            renderPalette();
        }
        else if (e.key === 'ArrowUp') {
            e.preventDefault();
            pActive = Math.max(0, pActive - 1);
            renderPalette();
        }
        else if (e.key === 'Enter') {
            e.preventDefault();
            runActive();
        }
        else if (e.key === 'Escape') {
            e.preventDefault();
            closePalette();
        }
    });
    overlay.addEventListener('click', (e) => {
        const el = e.target;
        if (el === overlay) {
            closePalette();
            return;
        }
        const mode = el.closest('.cp-mode');
        if (mode) {
            pMode = mode.getAttribute('data-mode') || 'classic';
            overlay.querySelectorAll('.cp-mode').forEach((m) => m.classList.toggle('on', m === mode));
            updateResults(input.value.trim());
            return;
        }
        const item = el.closest('.cp-item');
        if (item) {
            pActive = parseInt(item.getAttribute('data-i') || '0', 10);
            runActive();
        }
    });
}
export function closePalette() { paletteOpen = false; overlay?.remove(); overlay = null; }
// ── Settings: the rebindable shortcuts manager ────────────────────────────────────
let recording = null;
export function renderShortcutsManager(container) {
    ensurePaletteStyles(); // the .sk-* rules live in the same injected sheet as the palette
    refreshNavCommands(); // reflect the current navbar (custom pages, renames, reorders)
    const groups = ['nav', 'profiles', 'mods', 'repo', 'tools', 'settings', 'help'];
    const catTitle = {
        nav: { en: 'Navigation', fr: 'Navigation' }, profiles: { en: 'Profiles', fr: 'Profils' }, mods: { en: 'Mods', fr: 'Mods' },
        repo: { en: 'Server Repo', fr: 'Dépôt serveur' }, tools: { en: 'Tools', fr: 'Outils' },
        settings: { en: 'Settings', fr: 'Paramètres' }, help: { en: 'Help', fr: 'Aide' },
    };
    const rowFor = (c) => {
        const ch = bindingOf(c.id);
        return `<div class="sk-row" data-id="${c.id}">
      <span class="sk-label">${tr(c.title)}</span>
      <button class="sk-chord ${ch ? '' : 'sk-none'}" data-act="record">${ch ? chordToStr(ch) : tr({ en: 'Not set', fr: 'Non défini' })}</button>
      <button class="sk-reset" data-act="reset" data-tooltip="${tr({ en: 'Reset to default', fr: 'Réinitialiser' })}">⟲</button>
      <button class="sk-clear" data-act="clear" data-tooltip="${tr({ en: 'Clear', fr: 'Effacer' })}">✕</button>
    </div>`;
    };
    container.innerHTML = groups.map((g) => {
        const items = allCommands().filter((c) => c.category === g);
        if (!items.length)
            return '';
        return `<div class="sk-group"><div class="sk-group-h">${tr(catTitle[g])}</div>${items.map(rowFor).join('')}</div>`;
    }).join('') + `<div class="sk-hint">${tr({ en: 'Click a shortcut, then press the keys. Modifier combos (Ctrl/Shift/Alt) are recommended.', fr: 'Cliquez un raccourci puis appuyez sur les touches. Les combinaisons (Ctrl/Maj/Alt) sont recommandées.' })}</div>`;
    const stopRecording = () => { if (recording) {
        recording.row.classList.remove('sk-recording');
        recording = null;
    } };
    container.onclick = (e) => {
        const el = e.target;
        const row = el.closest('.sk-row');
        if (!row)
            return;
        const id = row.getAttribute('data-id');
        const act = el.getAttribute('data-act');
        if (act === 'reset') {
            setBinding(id, undefined);
            renderShortcutsManager(container);
            return;
        }
        if (act === 'clear') {
            setBinding(id, null);
            renderShortcutsManager(container);
            return;
        }
        if (act === 'record') {
            stopRecording();
            recording = { id, row };
            row.classList.add('sk-recording');
            const btn = row.querySelector('.sk-chord');
            btn.textContent = tr({ en: 'Press keys…', fr: 'Appuyez…' });
        }
    };
    // Capture the chord for the row being recorded.
    const onRec = (e) => {
        if (!recording)
            return;
        if (e.key === 'Escape') {
            stopRecording();
            renderShortcutsManager(container);
            return;
        }
        const ch = chordFromEvent(e);
        if (!ch)
            return; // waiting for a non-modifier key
        e.preventDefault();
        e.stopPropagation();
        const clash = conflictFor(ch, recording.id);
        setBinding(recording.id, ch);
        stopRecording();
        renderShortcutsManager(container);
        if (clash) {
            try {
                window.toast?.(`${tr({ en: 'Also used by', fr: 'Aussi utilisé par' })}: ${tr(clash.title)}`, 'warning');
            }
            catch { /* ignore */ }
        }
    };
    // one listener while this manager is mounted
    container._skRec && document.removeEventListener('keydown', container._skRec, true);
    container._skRec = onRec;
    document.addEventListener('keydown', onRec, true);
}
// ── register BMM's commands + start the dispatcher ────────────────────────────────
const clickNav = (view) => () => document.querySelector(`.nav-item[data-view="${view}"]`)?.click();
const clickAfterNav = (view, btnId, delay = 60) => () => {
    document.querySelector(`.nav-item[data-view="${view}"]`)?.click();
    setTimeout(() => document.getElementById(btnId)?.click(), delay);
};
// Go to a view, switch one of its inner tabs, then (optionally) click a button inside that tab.
const clickTab = (view, tabSel, delay = 70) => () => {
    document.querySelector(`.nav-item[data-view="${view}"]`)?.click();
    setTimeout(() => document.querySelector(tabSel)?.click(), delay);
};
const clickTabThen = (view, tabSel, btnId, d1 = 70, d2 = 150) => () => {
    document.querySelector(`.nav-item[data-view="${view}"]`)?.click();
    setTimeout(() => document.querySelector(tabSel)?.click(), d1);
    setTimeout(() => document.getElementById(btnId)?.click(), d2);
};
// A button that lives outside any view (present in the static shell) — click it directly.
const clickId = (btnId) => () => document.getElementById(btnId)?.click();
// A window-global entry point (modal openers exposed on window); no-op if not yet wired.
const callGlobal = (name) => () => { try {
    window[name]?.();
}
catch { /* ignore */ } };
// Nav commands are built from the LIVE navbar so they always match what's actually there —
// including custom pages, reordered/renamed items, and anything hidden/shown via navbar
// customisation. Rebuilt on demand (Settings render + palette open). Bindings persist by id.
export function refreshNavCommands() {
    for (const id of [..._cmds.keys()])
        if (id.startsWith('nav.'))
            _cmds.delete(id);
    const seen = new Set();
    // Built-in views carry data-view; user-added custom buttons AND custom sandboxed pages carry
    // data-custom-id (they have no data-view). Include both so a custom nav item is rebindable.
    document.querySelectorAll('.nav-item[data-view], .nav-item[data-custom-id]').forEach((el) => {
        const node = el;
        if (node.id === 'nav-customize-btn')
            return; // the "customize" button isn't a destination
        const view = node.getAttribute('data-view');
        const custom = node.getAttribute('data-custom-id');
        const key = view || custom; // stable id for the command + its binding
        if (!key || seen.has(key))
            return;
        seen.add(key);
        const lbl = (node.querySelector('.nav-label')?.textContent
            || node.getAttribute('title') || key).trim();
        const clickIt = view
            ? clickNav(view)
            : () => document.querySelector(`.nav-item[data-custom-id="${CSS.escape(custom)}"]`)?.click();
        registerCommand({
            id: `nav.${key}`, category: 'nav', title: { en: `Go to ${lbl}`, fr: `Aller à ${lbl}` },
            keywords: `${lbl} open navigate view page custom aller`, run: clickIt, defaultChord: null,
        });
    });
}
function registerCore() {
    refreshNavCommands();
    // The four legacy actions — same defaults as before (Ctrl+letter), now rebindable + in the palette.
    registerCommand({ id: 'profiles.new', category: 'profiles', title: { en: 'New profile', fr: 'Nouveau profil' }, keywords: 'create profile add', run: clickAfterNav('profiles', 'btn-new-profile', 50), defaultChord: { ctrl: true, key: 'n' } });
    registerCommand({ id: 'mods.add', category: 'mods', title: { en: 'Add a mod', fr: 'Ajouter un mod' }, keywords: 'import add mod install', run: clickAfterNav('library', 'btn-add-mod', 50), defaultChord: { ctrl: true, key: 'm' } });
    registerCommand({ id: 'mods.export', category: 'mods', title: { en: 'Export mod list', fr: 'Exporter la liste' }, keywords: 'export modlist save', run: clickAfterNav('modlist', 'btn-export-mm', 100), defaultChord: { ctrl: true, key: 'e' } });
    registerCommand({ id: 'mods.import', category: 'mods', title: { en: 'Import mod list', fr: 'Importer la liste' }, keywords: 'import modlist load', run: clickAfterNav('modlist', 'btn-import-mm', 100), defaultChord: { ctrl: true, key: 'i' } });
    // ── Library / mods actions ──────────────────────────────────────────────────
    registerCommand({ id: 'mods.scan', category: 'mods', title: { en: 'Scan mods folder', fr: 'Scanner le dossier de mods' }, keywords: 'scan rescan refresh detect library analyser', run: clickAfterNav('library', 'btn-scan-mods'), defaultChord: null });
    registerCommand({ id: 'mods.verify', category: 'mods', title: { en: 'Verify mod integrity', fr: 'Vérifier l’intégrité des mods' }, keywords: 'verify integrity hash checksum corrupt vérifier', run: clickAfterNav('library', 'btn-verify-integrity'), defaultChord: null });
    registerCommand({ id: 'mods.history', category: 'mods', title: { en: 'Show mod history', fr: 'Afficher l’historique des mods' }, keywords: 'history log recent activity historique', run: clickAfterNav('library', 'btn-show-history'), defaultChord: null });
    registerCommand({ id: 'mods.enableAll', category: 'mods', title: { en: 'Enable all mods', fr: 'Activer tous les mods' }, keywords: 'enable all activate deploy tout activer', run: clickAfterNav('library', 'btn-enable-all'), defaultChord: null });
    registerCommand({ id: 'mods.disableAll', category: 'mods', title: { en: 'Disable all mods', fr: 'Désactiver tous les mods' }, keywords: 'disable all off remove tout désactiver', run: clickAfterNav('library', 'btn-disable-all-alt'), defaultChord: null });
    registerCommand({ id: 'mods.checkUpdates', category: 'mods', title: { en: 'Check mods for updates', fr: 'Vérifier les mises à jour des mods' }, keywords: 'update updates check mods mise à jour', run: clickAfterNav('library', 'btn-lib-check-updates'), defaultChord: null });
    // ── Profiles ────────────────────────────────────────────────────────────────
    registerCommand({ id: 'profiles.import', category: 'profiles', title: { en: 'Import a profile (OvGME / OMM)', fr: 'Importer un profil (OvGME / OMM)' }, keywords: 'import ovgme omm migrate profile importer', run: clickAfterNav('profiles', 'btn-import-menu'), defaultChord: null });
    registerCommand({ id: 'profiles.disableAllGlobal', category: 'profiles', title: { en: 'Disable every profile', fr: 'Désactiver tous les profils' }, keywords: 'disable all profiles global clear tout désactiver', run: clickAfterNav('profiles', 'btn-disable-all-global'), defaultChord: null });
    // ── Server Repo ─────────────────────────────────────────────────────────────
    registerCommand({ id: 'repo.sync', category: 'repo', title: { en: 'Sync from a server repo', fr: 'Synchroniser depuis un dépôt serveur' }, keywords: 'sync subscribe download repo server synchroniser abonner', run: clickTab('repo', '[data-repo-tab="sync"]'), defaultChord: null });
    registerCommand({ id: 'repo.host', category: 'repo', title: { en: 'Host a server repo', fr: 'Héberger un dépôt serveur' }, keywords: 'host publish serve share repo server héberger publier', run: clickTab('repo', '[data-repo-tab="host"]'), defaultChord: null });
    registerCommand({ id: 'repo.browse', category: 'repo', title: { en: 'Browse saved repos', fr: 'Parcourir les dépôts enregistrés' }, keywords: 'browse repos saved list history parcourir', run: clickAfterNav('repo', 'btn-browse-repos'), defaultChord: null });
    registerCommand({ id: 'repo.generateServer', category: 'repo', title: { en: 'Generate a standalone server', fr: 'Générer un serveur autonome' }, keywords: 'generate server standalone mini node docker générer', run: clickTabThen('repo', '[data-repo-tab="host"]', 'btn-generate-mini-server'), defaultChord: null });
    registerCommand({ id: 'repo.toggleServer', category: 'repo', title: { en: 'Start / stop the built-in server', fr: 'Démarrer / arrêter le serveur intégré' }, keywords: 'start stop server toggle host démarrer arrêter', run: clickAfterNav('repo', 'btn-toggle-repo-server'), defaultChord: null });
    registerCommand({ id: 'repo.monitoring', category: 'repo', title: { en: 'Open server monitoring', fr: 'Ouvrir le monitoring du serveur' }, keywords: 'monitoring dashboard traffic downloads stats surveiller', run: clickAfterNav('repo', 'btn-open-monitoring'), defaultChord: null });
    registerCommand({ id: 'repo.checkUpdates', category: 'repo', title: { en: 'Check subscribed repos for updates', fr: 'Vérifier les mises à jour des dépôts' }, keywords: 'check updates repo sync new version mise à jour', run: clickAfterNav('repo', 'btn-check-mod-updates'), defaultChord: null });
    registerCommand({ id: 'repo.copyCreatorId', category: 'repo', title: { en: 'Copy my creator ID', fr: 'Copier mon ID créateur' }, keywords: 'copy creator id whitelist identity copier', run: clickAfterNav('repo', 'btn-copy-my-creator-id'), defaultChord: null });
    // ── Tools ───────────────────────────────────────────────────────────────────
    registerCommand({ id: 'palette.open', category: 'tools', title: { en: 'Open command palette', fr: 'Ouvrir la palette de commandes' }, keywords: 'palette search command ctrl k', run: () => openCommandPalette(), defaultChord: { ctrl: true, key: 'k' } });
    registerCommand({ id: 'tools.checkAppUpdates', category: 'tools', title: { en: 'Check for app updates', fr: 'Vérifier les mises à jour de l’app' }, keywords: 'update app version check upgrade mise à jour application', run: clickId('btn-check-updates'), defaultChord: null });
    registerCommand({ id: 'tools.restartOnboarding', category: 'tools', title: { en: 'Restart the onboarding tour', fr: 'Relancer la visite d’accueil' }, keywords: 'onboarding tour welcome restart guide accueil tutoriel', run: clickId('btn-restart-onboarding'), defaultChord: null });
    // ── Settings ────────────────────────────────────────────────────────────────
    registerCommand({ id: 'settings.storage', category: 'settings', title: { en: 'Storage & disk usage', fr: 'Stockage & espace disque' }, keywords: 'storage disk space usage dedupe stockage disque', run: callGlobal('_renderStorageModal'), defaultChord: null });
    registerCommand({ id: 'settings.hashing', category: 'settings', title: { en: 'Hashing statistics', fr: 'Statistiques de hachage' }, keywords: 'hash hashing blake3 cache stats hachage', run: callGlobal('showHashingStats'), defaultChord: null });
    // ── Help ────────────────────────────────────────────────────────────────────
    registerCommand({ id: 'help.search', category: 'help', title: { en: 'Search the documentation', fr: 'Rechercher dans la documentation' }, keywords: 'docs help search find', run: () => { window.openDocsHome?.(); document.querySelector('.nav-item[data-view="docs"]')?.click(); setTimeout(() => document.querySelector('#view-docs .dh-search')?.focus(), 80); }, defaultChord: null });
}
/** Wire the command system: register commands + start the global keyboard dispatcher. */
export function initCommands() {
    registerCore();
    document.addEventListener('keydown', onKeydown, true);
}
// ── palette styles (self-contained, injected once) ────────────────────────────────
function ensurePaletteStyles() {
    if (document.getElementById('cp-styles'))
        return;
    const s = document.createElement('style');
    s.id = 'cp-styles';
    s.textContent = `
  .cp-overlay{position:absolute;inset:0;z-index:2147483646;isolation:isolate;pointer-events:auto;
    display:flex;align-items:flex-start;justify-content:center;
    padding-top:14vh;background:rgba(0,0,0,.5);backdrop-filter:blur(3px);
    border-radius:inherit;overflow:hidden;}
  .cp-box{width:min(620px,92vw);max-height:66vh;display:flex;flex-direction:column;border-radius:16px;overflow:hidden;
    background:var(--bmm-bg-elevated,#1a2130);border:1px solid var(--bmm-border,#2a3242);box-shadow:0 24px 70px -18px rgba(0,0,0,.7);
    font-family:var(--bmm-font-sans,system-ui,sans-serif);animation:cp-in .12s ease;}
  @keyframes cp-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
  .cp-search{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--bmm-border,#2a3242);}
  .cp-search>svg{color:var(--bmm-text-muted,#7c8698);flex-shrink:0;}
  .cp-input{flex:1;border:0;background:transparent;outline:none;font-size:16px;color:var(--bmm-text-primary,#e6edf3);font-family:inherit;}
  .cp-input::placeholder{color:var(--bmm-text-muted,#7c8698);}
  .cp-modes{display:inline-flex;gap:2px;padding:3px;border-radius:8px;background:var(--bmm-bg-base,#0f1420);border:1px solid var(--bmm-border,#2a3242);}
  .cp-mode{cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;border:0;background:transparent;color:var(--bmm-text-secondary,#a3adba);}
  .cp-mode.on{background:var(--bmm-accent,#3b82f6);color:var(--bmm-text-on-accent);}
  .cp-list{overflow:auto;padding:8px;}
  .cp-item{display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;font-family:inherit;
    padding:10px 12px;border-radius:10px;border:0;background:transparent;color:var(--bmm-text-primary,#e6edf3);}
  .cp-item.on,.cp-item:hover{background:var(--bmm-bg-hover,#222b3b);}
  .cp-cat{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--bmm-accent,#3b82f6);min-width:70px;}
  .cp-title{flex:1;font-size:14px;font-weight:600;}
  .cp-kbd,.cp-foot kbd{font-family:var(--bmm-font-mono,ui-monospace,monospace);font-size:11px;font-weight:600;padding:2px 7px;border-radius:6px;
    border:1px solid var(--bmm-border,#2a3242);background:var(--bmm-bg-base,#0f1420);color:var(--bmm-text-secondary,#a3adba);}
  .cp-empty{padding:26px;text-align:center;color:var(--bmm-text-muted,#7c8698);font-size:14px;}
  .cp-foot{padding:9px 16px;border-top:1px solid var(--bmm-border,#2a3242);font-size:11px;color:var(--bmm-text-muted,#7c8698);display:flex;gap:6px;align-items:center;}
  .cp-foot kbd{padding:1px 6px;}
  /* Settings shortcuts manager */
  .sk-group{margin-bottom:16px;}
  .sk-group-h{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--bmm-text-muted,#7c8698);margin:0 0 8px;}
  .sk-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;border:1px solid var(--bmm-border,#2a3242);
    background:var(--bmm-bg-base,#0f1420);margin-bottom:6px;}
  .sk-row.sk-recording{border-color:var(--bmm-accent,#3b82f6);box-shadow:0 0 0 3px var(--bmm-accent-glow,rgba(59,130,246,.18));}
  .sk-label{flex:1;font-size:13.5px;color:var(--bmm-text-primary,#e6edf3);}
  .sk-chord{min-width:110px;text-align:center;cursor:pointer;font-family:var(--bmm-font-mono,ui-monospace,monospace);font-size:12px;font-weight:700;
    padding:6px 10px;border-radius:8px;border:1px solid var(--bmm-border,#2a3242);background:var(--bmm-bg-elevated,#1a2130);color:var(--bmm-text-primary,#e6edf3);}
  .sk-chord.sk-none{color:var(--bmm-text-muted,#7c8698);font-weight:500;font-family:var(--bmm-font-sans,system-ui);}
  .sk-reset,.sk-clear{cursor:pointer;width:30px;height:30px;border-radius:8px;border:1px solid var(--bmm-border,#2a3242);
    background:transparent;color:var(--bmm-text-muted,#7c8698);font-size:13px;}
  .sk-reset:hover,.sk-clear:hover{color:var(--bmm-text-primary,#e6edf3);border-color:var(--bmm-border-hover,#3a4556);}
  .sk-hint{font-size:11.5px;color:var(--bmm-text-muted,#7c8698);margin-top:4px;line-height:1.5;}
  `;
    document.head.appendChild(s);
}
//# sourceMappingURL=commands.js.map