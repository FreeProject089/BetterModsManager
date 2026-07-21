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

type L = { en: string; fr: string };
const tr = (s: L): string => (getLang() === 'fr' ? s.fr : s.en);

export interface Chord { ctrl?: boolean; shift?: boolean; alt?: boolean; key: string; }
export interface Command {
  id: string;
  category: 'nav' | 'mods' | 'profiles' | 'tools' | 'help';
  title: L;
  keywords?: string;
  run: () => void;
  defaultChord?: Chord | null;
  contextual?: boolean;   // palette-only (never globally dispatched)
}

// ── chord helpers ──────────────────────────────────────────────────────────────
const MOD_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'os']);
export function chordFromEvent(e: KeyboardEvent): Chord | null {
  const k = e.key.toLowerCase();
  if (MOD_KEYS.has(k)) return null;                 // a modifier alone isn't a chord
  return { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, key: k === ' ' ? 'space' : k };
}
export function chordToStr(c: Chord | null): string {
  if (!c || !c.key) return '';
  const p: string[] = [];
  if (c.ctrl) p.push('Ctrl'); if (c.shift) p.push('Shift'); if (c.alt) p.push('Alt');
  p.push(c.key.length === 1 ? c.key.toUpperCase() : c.key.replace(/^\w/, (m) => m.toUpperCase()));
  return p.join('+');
}
function chordEq(a: Chord | null, b: Chord | null): boolean {
  if (!a || !b) return false;
  return !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.alt === !!b.alt && a.key === b.key;
}
function matches(e: KeyboardEvent, c: Chord | null): boolean {
  if (!c || !c.key) return false;
  const k = (e.key.toLowerCase() === ' ' ? 'space' : e.key.toLowerCase());
  return (e.ctrlKey || e.metaKey) === !!c.ctrl && e.shiftKey === !!c.shift && e.altKey === !!c.alt && k === c.key;
}

// ── registry + persistence ─────────────────────────────────────────────────────
const _cmds = new Map<string, Command>();
export function registerCommand(cmd: Command): void { _cmds.set(cmd.id, cmd); }
export function allCommands(): Command[] { return [..._cmds.values()]; }

const LS = 'bmm_cmd_bindings';
function loadOverrides(): Record<string, string> { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } }
function saveOverrides(o: Record<string, string>): void { try { localStorage.setItem(LS, JSON.stringify(o)); } catch { /* ignore */ } }

/** Effective chord for a command: a user override (may be "" = intentionally unbound) wins over the default. */
export function bindingOf(id: string): Chord | null {
  const o = loadOverrides();
  if (Object.prototype.hasOwnProperty.call(o, id)) return o[id] ? parseChord(o[id]) : null;
  return _cmds.get(id)?.defaultChord ?? null;
}
export function parseChord(s: string): Chord | null {
  if (!s) return null;
  const parts = s.split('+').map((x) => x.trim().toLowerCase());
  const key = parts.pop() || '';
  return { ctrl: parts.includes('ctrl'), shift: parts.includes('shift'), alt: parts.includes('alt'), key };
}
/** Set (chord), clear (null), or reset-to-default (undefined) a command's binding. */
export function setBinding(id: string, chord: Chord | null | undefined): void {
  const o = loadOverrides();
  if (chord === undefined) delete o[id];           // reset → fall back to default
  else o[id] = chord ? chordToStr(chord) : '';     // "" = explicitly unbound
  saveOverrides(o);
}
/** The command currently bound to a chord, if any (for conflict detection). Excludes `exceptId`. */
export function conflictFor(chord: Chord | null, exceptId?: string): Command | null {
  if (!chord) return null;
  for (const c of _cmds.values()) { if (c.id === exceptId) continue; if (chordEq(bindingOf(c.id), chord)) return c; }
  return null;
}

// ── global dispatcher ──────────────────────────────────────────────────────────
function isTyping(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n) return false;
  const tag = n.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || n.isContentEditable;
}
function onKeydown(e: KeyboardEvent) {
  // Let the palette handle its own keys when open.
  if (paletteOpen) return;
  const typing = isTyping(e.target);
  for (const c of _cmds.values()) {
    if (c.contextual) continue;
    const ch = bindingOf(c.id);
    if (!ch) continue;
    // While typing, only fire chords that use a modifier (so plain letters don't hijack typing).
    if (typing && !ch.ctrl && !ch.alt) continue;
    if (matches(e, ch)) { e.preventDefault(); try { c.run(); } catch { /* ignore */ } return; }
  }
}

// ── the command palette (Ctrl/⌘+K) ───────────────────────────────────────────────
let overlay: HTMLElement | null = null;
let paletteOpen = false;
let pMode: 'classic' | 'semantic' = 'classic';
let pResults: Command[] = [];
let pActive = 0;

function expand(q: string): string[] {
  const base = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (pMode === 'classic') return base;
  const syn = getSynonyms() || {};
  const set = new Set(base);
  for (const tok of base) for (const [k, list] of Object.entries(syn))
    if (k.toLowerCase() === tok || (list || []).some((s) => s.toLowerCase() === tok)) { set.add(k.toLowerCase()); (list || []).forEach((s) => set.add(s.toLowerCase())); }
  return [...set];
}
function searchCommands(q: string): Command[] {
  const terms = expand(q);
  const scored = allCommands().map((c) => {
    const hay = `${tr(c.title)} ${c.title.en} ${c.title.fr} ${c.keywords || ''} ${c.category}`.toLowerCase();
    let s = 0; for (const term of terms) if (term && hay.includes(term)) s += 1;
    return { c, s };
  }).filter((x) => !q || x.s > 0);
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.c);
}
const CAT_LABEL: Record<Command['category'], L> = {
  nav: { en: 'Go to', fr: 'Aller à' }, mods: { en: 'Mods', fr: 'Mods' }, profiles: { en: 'Profiles', fr: 'Profils' },
  tools: { en: 'Tools', fr: 'Outils' }, help: { en: 'Help', fr: 'Aide' },
};
function renderPalette() {
  const list = overlay?.querySelector('.cp-list') as HTMLElement | null;
  if (!list) return;
  if (!pResults.length) { list.innerHTML = `<div class="cp-empty">${tr({ en: 'No commands match.', fr: 'Aucune commande.' })}</div>`; return; }
  list.innerHTML = pResults.map((c, i) => {
    const ch = bindingOf(c.id);
    return `<button class="cp-item ${i === pActive ? 'on' : ''}" data-i="${i}">
      <span class="cp-cat">${tr(CAT_LABEL[c.category])}</span>
      <span class="cp-title">${tr(c.title)}</span>
      ${ch ? `<kbd class="cp-kbd">${chordToStr(ch)}</kbd>` : ''}
    </button>`;
  }).join('');
  const act = list.querySelector('.cp-item.on') as HTMLElement | null;
  act?.scrollIntoView({ block: 'nearest' });
}
function updateResults(q: string) { pResults = searchCommands(q).slice(0, 40); pActive = 0; renderPalette(); }
function runActive() {
  const c = pResults[pActive];
  closePalette();
  if (c) { try { c.run(); } catch { /* ignore */ } }
}
export function openCommandPalette() {
  if (paletteOpen) return;
  ensurePaletteStyles();
  paletteOpen = true;
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
  document.body.appendChild(overlay);
  const input = overlay.querySelector('.cp-input') as HTMLInputElement;
  updateResults('');
  input.focus();

  input.addEventListener('input', () => updateResults(input.value.trim()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); pActive = Math.min(pResults.length - 1, pActive + 1); renderPalette(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); pActive = Math.max(0, pActive - 1); renderPalette(); }
    else if (e.key === 'Enter') { e.preventDefault(); runActive(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  overlay.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el === overlay) { closePalette(); return; }
    const mode = el.closest('.cp-mode') as HTMLElement | null;
    if (mode) { pMode = (mode.getAttribute('data-mode') as any) || 'classic'; overlay!.querySelectorAll('.cp-mode').forEach((m) => m.classList.toggle('on', m === mode)); updateResults(input.value.trim()); return; }
    const item = el.closest('.cp-item') as HTMLElement | null;
    if (item) { pActive = parseInt(item.getAttribute('data-i') || '0', 10); runActive(); }
  });
}
export function closePalette() { paletteOpen = false; overlay?.remove(); overlay = null; }

// ── Settings: the rebindable shortcuts manager ────────────────────────────────────
let recording: { id: string; row: HTMLElement } | null = null;
export function renderShortcutsManager(container: HTMLElement) {
  ensurePaletteStyles();   // the .sk-* rules live in the same injected sheet as the palette
  const groups: Command['category'][] = ['nav', 'profiles', 'mods', 'tools', 'help'];
  const catTitle: Record<Command['category'], L> = {
    nav: { en: 'Navigation', fr: 'Navigation' }, profiles: { en: 'Profiles', fr: 'Profils' }, mods: { en: 'Mods', fr: 'Mods' },
    tools: { en: 'Tools', fr: 'Outils' }, help: { en: 'Help', fr: 'Aide' },
  };
  const rowFor = (c: Command) => {
    const ch = bindingOf(c.id);
    return `<div class="sk-row" data-id="${c.id}">
      <span class="sk-label">${tr(c.title)}</span>
      <button class="sk-chord ${ch ? '' : 'sk-none'}" data-act="record">${ch ? chordToStr(ch) : tr({ en: 'Not set', fr: 'Non défini' })}</button>
      <button class="sk-reset" data-act="reset" title="${tr({ en: 'Reset to default', fr: 'Réinitialiser' })}">⟲</button>
      <button class="sk-clear" data-act="clear" title="${tr({ en: 'Clear', fr: 'Effacer' })}">✕</button>
    </div>`;
  };
  container.innerHTML = groups.map((g) => {
    const items = allCommands().filter((c) => c.category === g);
    if (!items.length) return '';
    return `<div class="sk-group"><div class="sk-group-h">${tr(catTitle[g])}</div>${items.map(rowFor).join('')}</div>`;
  }).join('') + `<div class="sk-hint">${tr({ en: 'Click a shortcut, then press the keys. Modifier combos (Ctrl/Shift/Alt) are recommended.', fr: 'Cliquez un raccourci puis appuyez sur les touches. Les combinaisons (Ctrl/Maj/Alt) sont recommandées.' })}</div>`;

  const stopRecording = () => { if (recording) { recording.row.classList.remove('sk-recording'); recording = null; } };
  container.onclick = (e) => {
    const el = e.target as HTMLElement;
    const row = el.closest('.sk-row') as HTMLElement | null;
    if (!row) return;
    const id = row.getAttribute('data-id')!;
    const act = el.getAttribute('data-act');
    if (act === 'reset') { setBinding(id, undefined); renderShortcutsManager(container); return; }
    if (act === 'clear') { setBinding(id, null); renderShortcutsManager(container); return; }
    if (act === 'record') {
      stopRecording();
      recording = { id, row };
      row.classList.add('sk-recording');
      const btn = row.querySelector('.sk-chord') as HTMLElement;
      btn.textContent = tr({ en: 'Press keys…', fr: 'Appuyez…' });
    }
  };
  // Capture the chord for the row being recorded.
  const onRec = (e: KeyboardEvent) => {
    if (!recording) return;
    if (e.key === 'Escape') { stopRecording(); renderShortcutsManager(container); return; }
    const ch = chordFromEvent(e);
    if (!ch) return; // waiting for a non-modifier key
    e.preventDefault(); e.stopPropagation();
    const clash = conflictFor(ch, recording.id);
    setBinding(recording.id, ch);
    stopRecording();
    renderShortcutsManager(container);
    if (clash) { try { (window as any).toast?.(`${tr({ en: 'Also used by', fr: 'Aussi utilisé par' })}: ${tr(clash.title)}`, 'warning'); } catch { /* ignore */ } }
  };
  // one listener while this manager is mounted
  (container as any)._skRec && document.removeEventListener('keydown', (container as any)._skRec, true);
  (container as any)._skRec = onRec;
  document.addEventListener('keydown', onRec, true);
}

// ── register BMM's commands + start the dispatcher ────────────────────────────────
const clickNav = (view: string) => () => (document.querySelector(`.nav-item[data-view="${view}"]`) as HTMLElement | null)?.click();
const clickAfterNav = (view: string, btnId: string, delay = 60) => () => {
  (document.querySelector(`.nav-item[data-view="${view}"]`) as HTMLElement | null)?.click();
  setTimeout(() => document.getElementById(btnId)?.click(), delay);
};

function registerCore() {
  const NAV: Array<[string, L]> = [
    ['library', { en: 'Library', fr: 'Bibliothèque' }], ['profiles', { en: 'Profiles', fr: 'Profils' }],
    ['modlist', { en: 'Mod list', fr: 'Liste des mods' }], ['modpacks', { en: 'Modpacks', fr: 'Modpacks' }],
    ['mapper', { en: 'Mod mapper', fr: 'Mappeur' }], ['repo', { en: 'Server repos', fr: 'Dépôts serveur' }],
    ['plugins', { en: 'Plugins & API', fr: 'Plugins et API' }], ['apps', { en: 'Apps', fr: 'Applis' }],
    ['community', { en: 'Community', fr: 'Communauté' }], ['docs', { en: 'Help & docs', fr: 'Aide et docs' }],
    ['credits', { en: 'Credits', fr: 'Crédits' }], ['settings', { en: 'Settings', fr: 'Réglages' }],
  ];
  for (const [view, label] of NAV) registerCommand({
    id: `nav.${view}`, category: 'nav', title: { en: `Go to ${label.en}`, fr: `Aller à ${label.fr}` },
    keywords: `${label.en} ${label.fr} open navigate view page`, run: clickNav(view), defaultChord: null,
  });

  // The four legacy actions — same defaults as before (Ctrl+letter), now rebindable + in the palette.
  registerCommand({ id: 'profiles.new', category: 'profiles', title: { en: 'New profile', fr: 'Nouveau profil' }, keywords: 'create profile add', run: clickAfterNav('profiles', 'btn-new-profile', 50), defaultChord: { ctrl: true, key: 'n' } });
  registerCommand({ id: 'mods.add', category: 'mods', title: { en: 'Add a mod', fr: 'Ajouter un mod' }, keywords: 'import add mod install', run: clickAfterNav('library', 'btn-add-mod', 50), defaultChord: { ctrl: true, key: 'm' } });
  registerCommand({ id: 'mods.export', category: 'mods', title: { en: 'Export mod list', fr: 'Exporter la liste' }, keywords: 'export modlist save', run: clickAfterNav('modlist', 'btn-export-mm', 100), defaultChord: { ctrl: true, key: 'e' } });
  registerCommand({ id: 'mods.import', category: 'mods', title: { en: 'Import mod list', fr: 'Importer la liste' }, keywords: 'import modlist load', run: clickAfterNav('modlist', 'btn-import-mm', 100), defaultChord: { ctrl: true, key: 'i' } });

  // Tools
  registerCommand({ id: 'palette.open', category: 'tools', title: { en: 'Open command palette', fr: 'Ouvrir la palette de commandes' }, keywords: 'palette search command ctrl k', run: () => openCommandPalette(), defaultChord: { ctrl: true, key: 'k' } });
  registerCommand({ id: 'help.search', category: 'help', title: { en: 'Search the documentation', fr: 'Rechercher dans la documentation' }, keywords: 'docs help search find', run: () => { (window as any).openDocsHome?.(); (document.querySelector('.nav-item[data-view="docs"]') as HTMLElement)?.click(); setTimeout(() => (document.querySelector('#view-docs .dh-search') as HTMLInputElement)?.focus(), 80); }, defaultChord: null });
}

/** Wire the command system: register commands + start the global keyboard dispatcher. */
export function initCommands() {
  registerCore();
  document.addEventListener('keydown', onKeydown, true);
}

// ── palette styles (self-contained, injected once) ────────────────────────────────
function ensurePaletteStyles() {
  if (document.getElementById('cp-styles')) return;
  const s = document.createElement('style');
  s.id = 'cp-styles';
  s.textContent = `
  .cp-overlay{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:flex-start;justify-content:center;
    padding-top:14vh;background:rgba(0,0,0,.5);backdrop-filter:blur(3px);}
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
  .cp-mode.on{background:var(--bmm-accent,#3b82f6);color:#fff;}
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
