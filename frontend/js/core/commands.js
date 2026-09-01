// Command system — one registry that powers BOTH the app-wide command palette (Ctrl/⌘+K)
// and the rebindable keyboard-shortcuts manager in Settings. Every navigable/actionable thing
// is a Command with an id, a bilingual title, keywords, a run(), and an optional default chord.
//
// - Chords are full combinations (Ctrl / Shift / Alt + key), not the old "Ctrl + single letter".
// - Custom bindings persist in localStorage (bmm_cmd_bindings) layered over the defaults, so a
//   user can rebind or clear any shortcut from Settings → Raccourcis Clavier.
// - A single global dispatcher matches a keypress against every bound command and runs it.
// - The palette does classic + semantic (synonym-expanded, Algolia-style) search over commands.
import { getLang, t, getSynonyms } from './i18n.js';
import { registerSearchProvider, searchAll } from './search.js';
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
    // `e.key` is not always there. IME composition, some autofill paths and any synthetic
    // event dispatched without it all reach here, and the crash landed on EVERY keystroke
    // afterwards because the listener threw before any binding could run.
    const raw = typeof e.key === 'string' ? e.key.toLowerCase() : '';
    if (!raw)
        return false;
    const k = raw === ' ' ? 'space' : raw;
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
// Commands are now just one SOURCE among several. The palette searches everything registered
// (see core/search.ts): commands, installed mods, profiles, documentation pages…
//
// Semantic mode still widens the query through the synonym table, but it does so by handing
// the expanded terms to the SAME scorer rather than by counting substring hits — so a synonym
// match can surface a result without outranking the thing you literally typed.
registerSearchProvider('commands', (q) => {
    const expanded = expand(q);
    const extra = pMode === 'semantic' ? expanded.join(' ') : '';
    return allCommands().map((c) => ({
        id: c.id,
        kind: 'command',
        title: tr(c.title),
        sub: tr(CAT_LABEL[c.category]),
        // Both languages are searchable whichever one is displayed: people search in the language
        // they think in, not the one the UI happens to be showing.
        keywords: `${c.title.en} ${c.title.fr} ${c.keywords || ''} ${c.category} ${extra}`,
        run: () => c.run(),
    }));
});
// Titles now come from USER data — a mod name, a profile name — not only from our own
// string table, so they are escaped before they reach innerHTML.
const esc = (v) => String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const KIND_LABEL = {
    command: { en: 'Command', fr: 'Commande' }, mod: { en: 'Mod', fr: 'Mod' },
    profile: { en: 'Profile', fr: 'Profil' }, doc: { en: 'Doc', fr: 'Doc' },
    theme: { en: 'Theme', fr: 'Thème' }, plugin: { en: 'Plugin', fr: 'Plugin' },
    setting: { en: 'Setting', fr: 'Réglage' }, app: { en: 'App', fr: 'App' },
    element: { en: 'On this page', fr: 'Sur la page' },
};
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
    list.innerHTML = pResults.map((h, i) => {
        // A shortcut only exists for commands; for a mod or a page the same slot shows what KIND
        // of thing it is, so a list mixing sources stays readable.
        const ch = h.kind === 'command' ? bindingOf(h.id) : null;
        return `<button class="cp-item ${i === pActive ? 'on' : ''}" data-i="${i}">
      <span class="cp-cat cp-kind-${h.kind}">${esc(h.kind === 'command' ? (h.sub || '') : tr(KIND_LABEL[h.kind] || KIND_LABEL.command))}</span>
      <span class="cp-title">${esc(h.title)}</span>
      ${h.kind !== 'command' && h.sub ? `<span class="cp-sub">${esc(h.sub)}</span>` : ''}
      ${ch ? `<kbd class="cp-kbd">${chordToStr(ch)}</kbd>` : ''}
    </button>`;
    }).join('');
    const act = list.querySelector('.cp-item.on');
    act?.scrollIntoView({ block: 'nearest' });
}
// Async now, because providers may be. A sequence number drops a stale response: type fast
// and an older, slower query must not land after a newer one and replace its results.
let _searchSeq = 0;
async function updateResults(q) {
    const ticket = ++_searchSeq;
    const hits = await searchAll(q, 40);
    if (ticket !== _searchSeq || !paletteOpen)
        return;
    pResults = hits;
    pActive = 0;
    renderPalette();
}
function runActive() {
    const h = pResults[pActive];
    closePalette();
    if (h) {
        try {
            h.run();
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
// ── App-data providers ─────────────────────────────────────────────────────────────────
//
// Registered here, but every app module is reached through a DYNAMIC import inside the
// provider. commands.ts is imported by much of the app, so a static import of a feature
// module would close an import cycle; doing it lazily also means a source nobody searches
// costs nothing to have registered.
//
// Each returns candidates unfiltered — ranking and cutoff are search.ts's job, and a provider
// that pre-filters on its own would apply a second, different notion of "matches".
registerSearchProvider('mods', async (q) => {
    if (!q)
        return []; // an empty query should list COMMANDS, not every mod you own
    const { appState } = await import('./state.js');
    const mods = (appState.state.allMods || []);
    return mods.map((m) => ({
        id: `mod:${m.id}`,
        kind: 'mod',
        title: m.name,
        sub: [m.author || null, m.version ? `v${m.version}` : null].filter(Boolean).join(' · '),
        keywords: (m.tags || []).join(' '),
        run: () => {
            // Route through the mods view's own search rather than inventing a second way to focus
            // a mod — whatever that view does about filters and scrolling keeps working.
            try {
                document.dispatchEvent(new CustomEvent('bmm:search:open-mod', { detail: { id: m.id, name: m.name } }));
            }
            catch { /* ignore */ }
        },
    }));
});
registerSearchProvider('themes', async (q) => {
    if (!q)
        return [];
    try {
        const m = await import('../features/themes/theme-engine.js');
        const seen = new Set();
        const all = [...(m.BUILTIN_THEMES || []), ...(m.getInstalledThemes?.() || [])]
            .filter((th) => th && th.id && !seen.has(th.id) && seen.add(th.id));
        return all.map((th) => ({
            id: `theme:${th.id}`,
            kind: 'theme',
            title: th.name || th.id,
            sub: th.author || '',
            // Applying it IS the action — for a theme, "take me to it" and "use it" are the same
            // intent, and a list of themes you then have to find again would be busywork.
            run: () => { void m.activateTheme?.(th.id); },
        }));
    }
    catch {
        return [];
    }
});
registerSearchProvider('plugins', async (q) => {
    if (!q)
        return [];
    try {
        const { invoke } = await import('./api.js');
        // `get_installed_plugins`, NOT `list_plugins` — the latter is a plugin-ACTION name mapped
        // to GET /api/plugins, not a Tauri command. Calling it would have thrown into the catch
        // below and left this provider silently returning nothing for ever.
        const list = (await invoke('get_installed_plugins', {}, { quiet: true }));
        return (list || []).map((p) => {
            const man = (p.manifest || {});
            return {
                id: `plugin:${man.id ?? man.name}`,
                kind: 'plugin',
                title: String(man.name ?? man.id ?? ''),
                sub: [man.version ? `v${man.version}` : null, man.author || null, p.enabled === false ? 'disabled' : null].filter(Boolean).join(' · '),
                keywords: String(man.description ?? ''),
                run: () => { document.querySelector('.nav-item[data-view="plugins"]')?.click(); },
            };
        });
    }
    catch {
        return [];
    }
});
// Settings cards, read from the DOM the same way the nav commands are — the settings view is
// authored in index.html, so scraping it is what keeps this list from going stale the moment
// a card is added or renamed. A hardcoded copy would be a second source of truth.
registerSearchProvider('settings', (q) => {
    if (!q)
        return [];
    const cards = document.querySelectorAll('#view-settings .settings-sections > .glass-card');
    const hits = [];
    cards.forEach((card, i) => {
        const h = card.querySelector('.card-title');
        // textContent picks up the inline <svg> too; the icon contributes no text, but trimming
        // guards against whitespace-only titles on a card that has no heading yet.
        const title = (h?.textContent || '').replace(/\s+/g, ' ').trim();
        if (!title)
            return;
        hits.push({
            id: `setting:${i}`,
            kind: 'setting',
            title,
            sub: tr({ en: 'Settings', fr: 'Paramètres' }),
            run: () => {
                document.querySelector('.nav-item[data-view="settings"]')?.click();
                setTimeout(() => card.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
            },
        });
    });
    return hits;
});
// Documentation pages. Silent on an empty query, like the other data providers: with no
// query every hit scores the same, so returning 36 pages would interleave them with the
// commands and bury the list the palette opens on. Discovering the docs hub is the nav
// item's job; the palette's is to find a page you are already looking for.
//
// The manifest is fetched once and cached by docs-hub, so this costs one request per session.
registerSearchProvider('docs', async (q) => {
    if (!q)
        return [];
    try {
        const mod = await import('../docs/docs-hub.js');
        return (await mod.docsSearchHits?.()) || [];
    }
    catch {
        return [];
    }
});
registerSearchProvider('profiles', async (q) => {
    if (!q)
        return [];
    try {
        const mod = await import('../features/profiles/profiles.js');
        const list = (await mod.getProfiles?.()) || [];
        return list.map((p) => ({
            id: `profile:${p.id}`,
            kind: 'profile',
            title: String(p.name || p.id),
            sub: typeof p.mod_count === 'number' ? `${p.mod_count} mods` : '',
            run: () => { try {
                document.dispatchEvent(new CustomEvent('bmm:search:open-profile', { detail: { id: p.id } }));
            }
            catch { /* ignore */ } },
        }));
    }
    catch {
        return [];
    }
});
// ── In-page element search ──────────────────────────────────────────────────
// "Search elements INSIDE the current page." The palette already finds commands, mods, docs…;
// this finds the actual controls on the view you're looking at — a specific setting row, a
// button, a section heading, a mod in the list — and jumps to it. It is the precise "where is
// that thing on this screen" search, so a dense view (Settings, the mod library, Server-Repo)
// is navigable by name instead of by scrolling.
function flashElement(el) {
    try {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('cp-flash');
        setTimeout(() => el.classList.remove('cp-flash'), 1400);
        // Focus if it can take focus, so keyboard users land ON it, not just near it.
        const focusable = el.matches('a,button,input,select,textarea,summary,[tabindex]');
        if (focusable)
            setTimeout(() => { try {
                el.focus({ preventScroll: true });
            }
            catch { /* ignore */ } }, 260);
    }
    catch { /* a detached node — nothing to do */ }
}
registerSearchProvider('page', (q) => {
    if (!q || q.trim().length < 1 || typeof document === 'undefined')
        return [];
    // The active view (BMM toggles `.view.active`); fall back to the app root, never the whole doc.
    const root = document.querySelector('.view.active')
        || document.getElementById('app') || document.body;
    if (!root)
        return [];
    // Two families: STRUCTURED controls (headings, buttons, setting rows — jump to a thing), and
    // CONTENT (paragraphs, list items, descriptions — jump to where the page SAYS something). The
    // content family is what makes this "search the content of the page you're on", not just its
    // controls.
    const SEL = 'h1,h2,h3,h4,h5,.card-title,.section-title,.setting-title,[data-setting],'
        + 'button,a[href],[role="button"],.nav-item,summary,legend,label,th,'
        + '[data-searchable],[data-mod-id],[data-name],[data-tab],'
        + 'p,li,td,dd,.setting-desc,.hint,.card-desc,.field-hint,.desc';
    const CONTENT_TAG = new Set(['P', 'LI', 'TD', 'DD']);
    const hits = [];
    const seen = new Set();
    let n = 0;
    for (const node of Array.from(root.querySelectorAll(SEL))) {
        if (n > 600)
            break; // a hard scan cap so a giant list can't stall a keystroke
        n++;
        const el = node;
        // Skip the aria-hidden measuring copies (e.g. ActionBar's hidden button clones), and
        // anything not currently laid out (display:none / collapsed) — you can't jump to it.
        if (el.closest('[aria-hidden="true"]'))
            continue;
        if (!el.offsetParent && getComputedStyle(el).position !== 'fixed')
            continue;
        const isContent = CONTENT_TAG.has(el.tagName) || el.classList.contains('setting-desc')
            || el.classList.contains('hint') || el.classList.contains('card-desc')
            || el.classList.contains('field-hint') || el.classList.contains('desc');
        // A content node that WRAPS a control (a <li> holding a button, a <p> with a link) is
        // indexed through that control already — indexing the wrapper too would duplicate it and
        // grab a blob of concatenated text. Let the leaf win.
        if (isContent && el.querySelector('button,a[href],input,select,textarea,[role="button"]'))
            continue;
        const raw = (el.getAttribute('aria-label') || el.getAttribute('data-name')
            || el.textContent || '').replace(/\s+/g, ' ').trim();
        // Skip empties and whole-container blobs (a paragraph over ~400 chars is a section, not a
        // line to jump to — and it would be found via a heading anyway).
        if (!raw || raw.length < 2 || raw.length > 400)
            continue;
        const key = `${el.tagName}:${raw.slice(0, 60).toLowerCase()}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        // Show a snippet, but MATCH the whole text: a query hits anywhere in a paragraph, and the
        // full string rides in `keywords` (matched, not shown) when the title is truncated.
        const title = raw.length > 80 ? `${raw.slice(0, 78).trimEnd()}…` : raw;
        const isHeading = /^H[1-5]$/.test(el.tagName) || el.classList.contains('card-title') || el.classList.contains('section-title');
        hits.push({
            id: `page:${n}:${key}`,
            kind: 'element',
            title,
            keywords: raw.length > 80 ? raw : undefined,
            sub: tr(isHeading ? { en: 'Section', fr: 'Section' } : { en: 'On this page', fr: 'Sur la page' }),
            // Content sits a touch below controls, and both below real commands — so "Settings" the
            // command beats a "Settings" label, and a control beats a paragraph that mentions it.
            boost: isContent ? 0.6 : 0.8,
            run: () => flashElement(el),
        });
    }
    return hits;
});
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
    registerCommand({
        id: 'mods.graph', category: 'mods',
        title: { en: 'Dependencies & conflicts…', fr: 'Dépendances et conflits…' },
        keywords: 'dependency dependencies conflict conflicts tree graph require needs dépendance conflit arbre',
        // Lazy, like style.open: this pulls in the graph module and reads the whole mod list,
        // and most launches never open it.
        run: () => { void import('../features/mods/mod-graph-view.js').then((m) => m.showModGraph()); },
        defaultChord: null,
    });
    // The four legacy actions — same defaults as before (Ctrl+letter), now rebindable + in the palette.
    registerCommand({
        id: 'style.open', category: 'settings',
        title: { en: 'Style your BMM…', fr: 'Style de ton BMM…' },
        keywords: 'theme look style appearance tasky apparence thème couleur skin',
        // Imported lazily: the palette registers at boot, and the modal is a screen most
        // launches never open — same rule that got mermaid out of the boot path.
        run: () => { void import('../ui/style-modal.js').then((m) => m.openStyleModal()); },
        defaultChord: null,
    });
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
    // ── Cancelling what is running ──────────────────────────────────────────────
    //
    // Both of these existed and could only be reached with the mouse: the cancel button's
    // click is "stop the current one", and its right-click is "stop everything". A long
    // enable that is going to the wrong profile is exactly the moment somebody's hand is not
    // on the mouse.
    //
    // NOT Ctrl+Z. The dispatcher runs on capture and fires modified chords even while typing,
    // so binding it here would reach into the scheduler's editor and undo a step of somebody's
    // task instead. Ctrl+Alt+Z is free, and every one of these is rebindable in Settings.
    const cancelOps = (all) => () => {
        void import('../features/mods/mods-actions.js').then((m) => {
            if (!m.hasCancellableOps()) {
                // Said out loud. A shortcut that does nothing when there is nothing to do is
                // indistinguishable from one that is broken, and people press it again harder.
                // window.toast, like the clash warning above: commands.ts is imported by the app
                // shell, and reaching ui/app.js from here closes a cycle.
                try {
                    window.toast?.(t('lib.cancelNothing') || 'Nothing is running to cancel.', 'info');
                }
                catch { /* ignore */ }
                return;
            }
            if (all)
                void m.requestCancelModOps();
            else
                m.requestCancelCurrentOnly();
        });
    };
    registerCommand({
        id: 'mods.cancelLast', category: 'mods',
        title: { en: 'Cancel the running mod operation', fr: 'Annuler l\u2019op\u00e9ration en cours' },
        keywords: 'cancel stop abort undo last current annuler arr\u00eater stopper derni\u00e8re',
        run: cancelOps(false),
        defaultChord: { ctrl: true, alt: true, key: 'z' },
    });
    registerCommand({
        id: 'mods.cancelAll', category: 'mods',
        title: { en: 'Cancel every queued mod operation', fr: 'Annuler toutes les op\u00e9rations' },
        keywords: 'cancel all stop everything abort queue annuler tout tous file',
        run: cancelOps(true),
        defaultChord: { ctrl: true, alt: true, shift: true, key: 'z' },
    });
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
    // The CSP panel sits at the bottom of the Identity & API card, which is the right place
    // for it and not a place anyone browses. Reachable by typing "CSP" is the difference
    // between a setting that exists and a setting that can be used.
    registerCommand({
        id: 'settings.csp',
        category: 'settings',
        title: { en: 'Content-Security-Policy', fr: 'Politique de sécurité du contenu' },
        keywords: 'csp content security policy script-src harden strict sécurité politique durcir',
        run: () => {
            // Click the real nav item rather than toggling classes: it is what every other jump
            // in this app does, so whatever else switching views entails happens too. (An earlier
            // draft called `window.showSettings()`, which does not exist — with `?.` that opens
            // nothing at all, silently.)
            document.querySelector('.nav-item[data-view="settings"]')?.click();
            // The card is built asynchronously by initSecurityInfoCard(); wait for it rather than
            // scrolling to nothing on a cold open.
            // Scroll, then CHECK, then retry. Switching views resets the content area's scroll
            // position, and it does so after this runs — so a single scrollIntoView lands and is
            // immediately undone, leaving the user at the top of a very long page with no sign
            // anything happened. Verifying the rect is the difference between issuing a scroll
            // and having scrolled.
            let tries = 0;
            const go = () => {
                const el = document.getElementById('csp-extra')?.closest('.setting-card');
                if (el) {
                    // Instant, not smooth: the panel sits ~8700px down, and a smooth ride that long
                    // is a journey to somewhere the user already asked to be.
                    el.scrollIntoView({ block: 'center' });
                    const r = el.getBoundingClientRect();
                    // isConnected and a real height, not just `top` in range. Switching views detaches
                    // and rebuilds this card, and a DETACHED element reports a rect of all zeros — so
                    // `top === 0` passed for "it is at the top of the screen" and the loop stopped
                    // proudly, having scrolled nothing, every single time.
                    if (el.isConnected && r.height > 0 && r.top > -50 && r.top < window.innerHeight)
                        return;
                }
                if (++tries < 40)
                    setTimeout(go, 100);
            };
            go();
        },
    });
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
  .cp-title{flex:1;font-size:14px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  /* Second line for non-command hits: a mod's author and version, a page's path. It must not
     compete with the title, and it must not push the shortcut off the row — hence the cap and
     the ellipsis rather than letting a long path grow the item. */
  .cp-sub{font-size:11.5px;color:var(--bmm-text-muted,#7c8698);max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none;}
  /* The kind chip takes the colour of what it is, so a mixed list is scannable by shape and
     colour rather than by reading every row. Tokens only — a theme moves these. */
  .cp-kind-mod{color:var(--bmm-success,#22c55e);}
  .cp-kind-profile{color:var(--bmm-purple,#a855f7);}
  .cp-kind-doc{color:var(--bmm-info,#3b82f6);}
  .cp-kind-theme{color:var(--bmm-warning,#f59e0b);}
  .cp-kind-plugin{color:var(--bmm-accent,#3b82f6);}
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
  /* Flash a page element the palette jumped to (in-page 'element' hits). Global, not scoped to
     the overlay — the target lives out on the page. */
  .cp-flash{animation:cp-flash-kf 1.4s ease-out;border-radius:8px;}
  @keyframes cp-flash-kf{
    0%,100%{box-shadow:0 0 0 0 transparent;background-color:transparent;}
    12%{box-shadow:0 0 0 3px var(--bmm-accent,#3b82f6),0 0 0 7px var(--bmm-accent-glow,rgba(59,130,246,.28));background-color:var(--bmm-accent-glow,rgba(59,130,246,.12));}
  }
  `;
    document.head.appendChild(s);
}
//# sourceMappingURL=commands.js.map