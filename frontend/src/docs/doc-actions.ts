// doc-actions.ts — what a « Show me » button in a documentation page is allowed to do.
//
// A guide page can carry a button written as an ordinary Markdown link:
//
//     [Show me](show:view/profiles)
//     [Try it in the tutorial](show:tutorial/basics/profiles/s1)
//
// On the website `show:` is not a link, so the page's build turns it into plain text (see
// BMM Docs/tools/md_directives.py). In the app the link becomes a button, and this file is the
// whole list of what such a button can do. The author writes a NAME; the code decides what the
// name means. Nothing in a page reaches `eval`, an arbitrary selector, a URL or a command: an
// unknown name is not a button at all.
//
// Pure (no DOM, no app import): md-lite validates a spec here while it renders, and the hub runs
// it through `runShow`. tests/doc-actions.test.mjs loads the compiled file directly.

export type ShowAction =
  | { kind: 'tutorial'; id: string; part: string; step: string }
  | { kind: 'view'; name: string }
  | { kind: 'settings'; name: string }
  | { kind: 'automations' }
  | { kind: 'palette' }
  | { kind: 'notes' }
  | { kind: 'doc'; path: string };

/** The screens a button may open: each is a `.nav-item[data-view]` of the sidebar. */
export const SHOW_VIEWS: readonly string[] = [
  'library', 'profiles', 'modpacks', 'modlist', 'repo', 'plugins', 'mapper', 'apps', 'community', 'settings',
];

/** Named places in Settings. The value is the id `goToSettings` scrolls to. */
export const SHOW_SETTINGS: Readonly<Record<string, string>> = {
  updates: 'settings-auto-update-card',
  identity: 'settings-identity-card',
  security: 'settings-security-card',
  feedback: 'settings-feedback-card',
};

const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const ROUTE = /^[a-z0-9][a-z0-9/-]{0,80}$/;

/** The action a spec names, or null when it names nothing the list allows. */
export function parseShow(spec: string): ShowAction | null {
  const s = String(spec || '').trim().replace(/^show:/i, '');
  const p = s.split('/');
  switch (p[0]) {
    case 'tutorial': {
      const [, id, part = '', step = ''] = p;
      if (p.length > 4 || !id || !ID.test(id) || (part && !ID.test(part)) || (step && !ID.test(step))) return null;
      return { kind: 'tutorial', id, part, step };
    }
    case 'view':
      return p.length === 2 && SHOW_VIEWS.includes(p[1]) ? { kind: 'view', name: p[1] } : null;
    case 'settings':
      if (p.length === 1) return { kind: 'settings', name: '' };
      return p.length === 2 && Object.prototype.hasOwnProperty.call(SHOW_SETTINGS, p[1]) ? { kind: 'settings', name: p[1] } : null;
    case 'automations':
      return p.length === 1 ? { kind: 'automations' } : null;
    case 'palette':
      return p.length === 1 ? { kind: 'palette' } : null;
    case 'notes':
      return p.length === 1 ? { kind: 'notes' } : null;
    case 'doc': {
      const path = p.slice(1).join('/');
      return p.length >= 2 && ROUTE.test(path) && !path.includes('//') ? { kind: 'doc', path } : null;
    }
    default:
      return null;
  }
}

/** What the app lends this file. Everything else stays out of reach. */
export interface ShowDeps {
  startTutorial: (id: string, part: string, step: string) => void | Promise<void>;
  clickNav: (view: string) => void;
  goToSettings: (target?: string) => void;
  openAutomations: () => void;
  openPalette: () => void;
  openNotes: () => void;
  openDoc: (path: string) => void;
}

/** Run a spec. False when it is not an allowed one, so the caller can say so. */
export function runShow(spec: string, deps: ShowDeps): boolean {
  const a = parseShow(spec);
  if (!a) return false;
  switch (a.kind) {
    case 'tutorial': void deps.startTutorial(a.id, a.part, a.step); break;
    case 'view': deps.clickNav(a.name); break;
    case 'settings': deps.goToSettings(a.name ? SHOW_SETTINGS[a.name] : undefined); break;
    case 'automations': deps.openAutomations(); break;
    case 'palette': deps.openPalette(); break;
    case 'notes': deps.openNotes(); break;
    case 'doc': deps.openDoc(a.path); break;
  }
  return true;
}

/** The icon family a button wears, by what it does. */
export function showIconOf(a: ShowAction): 'play' | 'arrow-right' | 'book-open' {
  return a.kind === 'tutorial' ? 'play' : a.kind === 'doc' || a.kind === 'notes' ? 'book-open' : 'arrow-right';
}

// ── tickable checklists ──────────────────────────────────────────────────────
// `- [ ] Step` / `- [x] Step` in a page. The tick is a preference of the reader, remembered in
// localStorage under a key made of the page and the text of the step.

/** A short stable hash of a step's text (FNV-1a, 32 bits, base 36). */
export function stepKey(text: string): string {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

export const CHECK_STORE = 'bmm_dh_checks';

/** The ticked step keys of every page: { "guide/create-profile": ["k1","k2"] }. */
export function readChecks(raw: string | null): Record<string, string[]> {
  try {
    const v = JSON.parse(raw || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string[]> = {};
    for (const [k, arr] of Object.entries(v)) if (Array.isArray(arr)) out[k] = arr.filter((x) => typeof x === 'string').slice(0, 200);
    return out;
  } catch { return {}; }
}

/** The new store after ticking or unticking one step of one page. */
export function toggleCheck(store: Record<string, string[]>, page: string, key: string, on: boolean): Record<string, string[]> {
  const cur = new Set(store[page] || []);
  if (on) cur.add(key); else cur.delete(key);
  const next = { ...store };
  if (cur.size) next[page] = [...cur]; else delete next[page];
  // Bounded: a preference store must not grow without end.
  const pages = Object.keys(next);
  if (pages.length > 120) for (const k of pages.slice(0, pages.length - 120)) delete next[k];
  return next;
}
