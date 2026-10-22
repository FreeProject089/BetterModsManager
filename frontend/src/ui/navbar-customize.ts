// navbar-customize.ts — the customisable sidebar: reorder, hide, rename and group BMM's own
// pages, add buttons of your own (a BMM page, a tool, a website, or a sandboxed page you build),
// and the editor for all of it (Settings → Customise navigation). State is in localStorage.

import { t } from '../core/i18n.js';
import { attachHighlight, type CodeEditorHandle } from './code-editor.js';
import { invoke, pickFile, pickFiles, pickFolder, saveFile } from '../core/api.js';
import { initPageBroker, refreshGrants } from './custom-page-broker.js';
import { runNavBundleImport, reviewAnswer } from './nav-bundle-import.js';
import { openGrantReview } from './nav-grant-review.js';
import { showConfirm } from './confirm.js';
import { uiIcon, isIconName, ICON_NAMES, type IconName } from './icons.js';

const LS_KEY = 'bmm_navbar_config';

// ── Custom sandboxed pages (Phase B) ──────────────────────────────────────
interface PageMeta { id: string; name: string; runtime: string; entry: string; }
let _pagesCache: PageMeta[] = [];
async function loadPages(): Promise<PageMeta[]> {
    try { _pagesCache = (await invoke('list_custom_pages')) as PageMeta[]; } catch { _pagesCache = []; }
    return _pagesCache;
}
const PROTECTED = new Set(['settings']); // never hideable (you'd lose access to the editor)

// ── Starter templates for custom pages ───────────────────────────────────────
//
// Three empty textareas are a poor invitation: the sandbox is deliberately strict
// (opaque origin, no BMM DOM, no Tauri, permissions default-deny), so the only way
// to learn what a page CAN do is to be shown working code. Each template is a
// complete, runnable page that demonstrates one capability and names the permission
// it needs — inline handlers are blocked, so they all use addEventListener.
interface PageTemplate { label: string; labelKey: string; html: string; css: string; js: string; }

// Hard-coded colours are CORRECT here, and the colour guard's baseline records
// that: this stylesheet ships INSIDE the user's sandboxed page, an opaque-origin
// iframe with no access to BMM's document — `var(--bmm-*)` would resolve to
// nothing there. A template that renders unstyled teaches the wrong thing.
const TPL_CSS_BASE = `body {
  margin: 0;
  padding: 28px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #0d1220;
  color: #e6edf3;
}
h1 { margin: 0 0 6px; font-size: 20px; }
p.sub { margin: 0 0 22px; color: #8b95a7; font-size: 13px; }
button {
  padding: 9px 16px; border-radius: 8px; cursor: pointer;
  background: #1b2435; color: #e6edf3; border: 1px solid #2c3away;
  font-size: 13px;
}
button:hover { border-color: #3b82f6; color: #fff; }
.out {
  margin-top: 18px; padding: 12px 14px; border-radius: 8px;
  background: #131b2b; border: 1px solid #232d42;
  font-family: ui-monospace, Consolas, monospace; font-size: 12px; white-space: pre-wrap;
}`.replace('#2c3away', '#2c3a52');

const PAGE_TEMPLATES: PageTemplate[] = [
    {
        label: 'Blank', labelKey: 'navedit.tplBlank',
        html: '<h1>My page</h1>\n<p class="sub">Everything here runs sandboxed.</p>',
        css: TPL_CSS_BASE,
        js: '',
    },
    {
        label: 'Notes (saved locally)', labelKey: 'navedit.tplNotes',
        html: `<h1>Notes</h1>
<p class="sub">Saved with the <b>storage</b> permission — nothing leaves this page.</p>
<textarea id="note" rows="10" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;background:#131b2b;color:#e6edf3;border:1px solid #232d42;font-family:inherit"></textarea>
<div style="margin-top:12px;display:flex;gap:8px">
  <button id="save">Save</button>
  <button id="clear">Clear</button>
</div>
<div class="out" id="status">Ready.</div>`,
        css: TPL_CSS_BASE,
        js: `// Needs the "storage" permission (tick it on this page's card).
const note = document.getElementById('note');
const status = document.getElementById('status');

bmm.storage.get('note').then(v => { note.value = v || ''; });

document.getElementById('save').addEventListener('click', async () => {
  await bmm.storage.set('note', note.value);
  status.textContent = 'Saved at ' + new Date().toLocaleTimeString();
});

document.getElementById('clear').addEventListener('click', async () => {
  note.value = '';
  await bmm.storage.set('note', '');
  status.textContent = 'Cleared.';
});`,
    },
    {
        label: 'Dashboard (app info)', labelKey: 'navedit.tplDashboard',
        html: `<h1>Dashboard</h1>
<p class="sub">Reads what BMM chooses to expose — with the <b>app info</b> permission.</p>
<button id="refresh">Refresh</button>
<div class="out" id="out">Press Refresh.</div>`,
        css: TPL_CSS_BASE,
        js: `// Needs "app info" (bmm.read) and, for the second block, "system info".
const out = document.getElementById('out');

// The sandbox API is bmm.read(scope) for app values and bmm.system.info() for
// hardware — there is no bmm.app.info(). See custom_pages.rs for the full surface.
const SCOPES = ['app.name', 'app.version', 'app.platform', 'app.lang',
                'app.online', 'theme.current', 'theme.dark', 'theme.accent'];

async function refresh() {
  const lines = [];
  for (const scope of SCOPES) {
    try {
      const v = await bmm.read(scope);
      lines.push(scope.padEnd(15) + (v === null ? '—' : v));
    } catch (e) {
      lines.push(scope.padEnd(15) + 'refused — tick "app info"');
    }
  }
  try {
    const sys = await bmm.system.info();
    lines.push('', '-- system (needs "system info") --');
    for (const k of Object.keys(sys)) lines.push(String(k).padEnd(15) + sys[k]);
  } catch (e) {
    lines.push('', 'system info: not granted');
  }
  out.textContent = lines.join('\\n');
}

document.getElementById('refresh').addEventListener('click', refresh);
refresh();`,
    },
    // The "Notifier" template was removed: it demonstrated bmm.notify() and nothing
    // else, so the page it produced did one thing the app already does everywhere,
    // and it was the template most likely to be picked by someone expecting a
    // starting point rather than a one-line demo. The remaining three each leave you
    // with something to build ON. bmm.notify is documented with the rest of the
    // sandbox API; it does not need a page of its own to advertise it.
    {
        label: 'Checklist (persisted)', labelKey: 'navedit.tplChecklist',
        html: `<h1>Checklist</h1>
<p class="sub">A real list, kept with the <b>storage</b> permission.</p>
<div style="display:flex;gap:8px;margin-bottom:14px">
  <input id="what" placeholder="Add something\u2026" style="flex:1;padding:9px 12px;border-radius:8px;background:#131b2b;color:#e6edf3;border:1px solid #232d42;font-family:inherit">
  <button id="add">Add</button>
</div>
<div id="list"></div>`,
        css: TPL_CSS_BASE + `
.row { display: flex; align-items: center; gap: 10px; padding: 7px 2px; border-bottom: 1px solid #1b2435; }
.row:last-child { border-bottom: 0; }
.row span { flex: 1; font-size: 14px; }
.x { background: none; border: 0; color: #64748b; font-size: 17px; cursor: pointer; padding: 0 4px; }
.x:hover { color: #ef4444; }`,
        js: `// Needs the "storage" permission.
//
// The list is re-read from storage on every change rather than kept only in a variable:
// two windows of the same page would otherwise each hold their own copy and the last one
// to save would win silently.
const KEY = 'items';
const listEl = document.getElementById('list');
const input = document.getElementById('what');

async function load() { try { return JSON.parse(await bmm.storage.get(KEY) || '[]'); } catch (e) { return []; } }
async function save(items) { await bmm.storage.set(KEY, JSON.stringify(items)); }

async function draw() {
  const items = await load();
  listEl.innerHTML = '';
  if (!items.length) { listEl.innerHTML = '<div class="sub">Nothing yet.</div>'; return; }
  items.forEach((it, i) => {
    const row = document.createElement('label');
    row.className = 'row';
    const box = document.createElement('input');
    box.type = 'checkbox'; box.checked = !!it.done;
    box.addEventListener('change', async () => {
      const cur = await load(); cur[i].done = box.checked; await save(cur); draw();
    });
    const txt = document.createElement('span');
    txt.textContent = it.text;
    if (it.done) txt.style.textDecoration = 'line-through';
    if (it.done) txt.style.opacity = '.55';
    const del = document.createElement('button');
    del.textContent = '\u00d7';
    del.className = 'x';
    del.addEventListener('click', async (e) => {
      e.preventDefault();
      const cur = await load(); cur.splice(i, 1); await save(cur); draw();
    });
    row.append(box, txt, del);
    listEl.append(row);
  });
}

document.getElementById('add').addEventListener('click', async () => {
  const text = input.value.trim();
  if (!text) return;
  const items = await load();
  items.push({ text: text, done: false });
  await save(items);
  input.value = '';
  draw();
});
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('add').click(); });

draw();`,
    },
    {
        label: 'System info', labelKey: 'navedit.tplSystem',
        html: `<h1>This machine</h1>
<p class="sub">Read-only values BMM chooses to expose \u2014 needs the <b>system info</b> permission.</p>
<button id="go">Read</button>
<div class="out" id="out">Press Read.</div>`,
        css: TPL_CSS_BASE + `
.kv { display: flex; justify-content: space-between; gap: 16px; padding: 5px 0; border-bottom: 1px solid #1b2435; }
.kv:last-child { border-bottom: 0; }
.kv span { color: #8b95a7; }`,
        js: `// Needs the "system info" permission.
//
// Every value here is read-only and chosen by BMM — there is no file access and no shell.
// A missing permission rejects rather than returning nothing, so the error is shown as
// itself instead of an empty table that looks like a bug.
const out = document.getElementById('out');

function row(k, v) { return '<div class="kv"><span>' + k + '</span><b>' + v + '</b></div>'; }

document.getElementById('go').addEventListener('click', async () => {
  out.textContent = 'Reading\u2026';
  try {
    const s = await bmm.system.info();
    const gb = (mb) => (mb / 1024).toFixed(1) + ' GB';
    out.innerHTML = row('OS', s.os + ' ' + (s.osVersion || ''))
      + row('Architecture', s.arch)
      + row('Kernel', s.kernelVersion || '\u2014')
      + row('CPU cores', s.cpuCount)
      + row('Memory', gb(s.memAvailableMb) + ' free of ' + gb(s.memTotalMb))
      + row('Up for', Math.round(s.uptimeSec / 3600) + ' h');
  } catch (e) {
    out.textContent = String(e);
  }
});`,
    },
    {
        label: 'Fetch a URL', labelKey: 'navedit.tplFetch',
        html: `<h1>Fetch</h1>
<p class="sub">Needs the <b>network</b> permission, and the origin on this page\u2019s allow-list.</p>
<div style="display:flex;gap:8px;margin-bottom:12px">
  <input id="url" value="https://api.github.com/repos/rust-lang/rust" style="flex:1;padding:9px 12px;border-radius:8px;background:#131b2b;color:#e6edf3;border:1px solid #232d42;font-family:inherit">
  <button id="go">Go</button>
</div>
<div class="out" id="out">Nothing yet.</div>`,
        css: TPL_CSS_BASE,
        js: `// Needs the "network" permission AND the origin on this page's allow-list.
//
// bmm.fetch, not window.fetch: the page runs at an opaque origin and the policy only
// relaxes for the hosts you named. An origin you forgot to add rejects here, which is the
// error you want \u2014 not a request that quietly goes nowhere.
const out = document.getElementById('out');
const url = document.getElementById('url');

document.getElementById('go').addEventListener('click', async () => {
  out.textContent = 'Fetching\u2026';
  try {
    const text = await bmm.fetch(url.value.trim());
    // Show it as text. Parsing is the page's job and depends on what you asked for.
    out.textContent = text.slice(0, 4000);
  } catch (e) {
    out.textContent = 'Refused or failed: ' + String(e)
      + '\n\nAdd the origin under this page\u2019s Network permission.';
  }
});`,
    },
    {
        label: 'Clipboard', labelKey: 'navedit.tplClipboard',
        html: `<h1>Clipboard</h1>
<p class="sub">Copy out and paste in \u2014 needs the <b>clipboard</b> permission.</p>
<textarea id="what" rows="5" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;background:#131b2b;color:#e6edf3;border:1px solid #232d42;font-family:inherit"></textarea>
<div style="margin-top:12px;display:flex;gap:8px">
  <button id="copy">Copy</button>
  <button id="paste">Paste</button>
</div>
<div class="out" id="out">Ready.</div>`,
        css: TPL_CSS_BASE,
        js: `// Needs the "clipboard" permission.
//
// Reading the clipboard is a real capability, so it is a separate grant from writing in
// most systems' minds \u2014 here one grant covers both, and the page says which it is using.
const out = document.getElementById('out');

document.getElementById('copy').addEventListener('click', async () => {
  const text = document.getElementById('what').value;
  try { await bmm.clipboard.write(text); out.textContent = 'Copied ' + text.length + ' characters.'; }
  catch (e) { out.textContent = String(e); }
});

document.getElementById('paste').addEventListener('click', async () => {
  try {
    const text = await bmm.clipboard.read();
    document.getElementById('what').value = text;
    out.textContent = 'Pasted ' + text.length + ' characters.';
  } catch (e) { out.textContent = String(e); }
});`,
    },
    {
        label: 'Two documents', labelKey: 'navedit.tplMulti',
        html: `<h1>Home</h1>
<p class="sub">A page can hold several documents. This one links to a second.</p>
<p><a href="about.html">About this page \u2192</a></p>
<div class="out">Add <b>about</b> under \u201cDocuments in this page\u201d, then reload.
Files you import (images, fonts) work the same way: <code>src="assets/logo.png"</code>.</div>
<p class="sub" style="margin-top:22px">\u00a9 <span id="year"></span></p>`,
        css: TPL_CSS_BASE + `
a { color: #60a5fa; }
code { background: #131b2b; padding: 1px 5px; border-radius: 4px; }`,
        js: `// No permissions needed.
//
// The link below is an ORDINARY relative link. The page bundle is served as a folder, so
// about.html sits beside index.html and <a href="about.html"> just works \u2014 add the second
// document from "Documents in this page" in the editor.
document.getElementById('year').textContent = new Date().getFullYear();`,
    },
];

/** What each starter does, and the permissions its code asks for. Parallel to PAGE_TEMPLATES
 *  by labelKey. The list is a SUGGESTION shown in the guided flow, never a grant: every
 *  permission still starts off and is turned on by the user, one switch at a time. */
const TPL_INFO: Record<string, { desc: string; caps: string[]; icon: IconName }> = {
    'navedit.tplBlank': { desc: 'nbx.tplDesc.blank', caps: [], icon: 'file' },
    'navedit.tplNotes': { desc: 'nbx.tplDesc.notes', caps: ['storage'], icon: 'file-text' },
    'navedit.tplDashboard': { desc: 'nbx.tplDesc.dashboard', caps: ['read'], icon: 'activity' },
    'navedit.tplChecklist': { desc: 'nbx.tplDesc.checklist', caps: ['storage'], icon: 'clipboard-list' },
    'navedit.tplSystem': { desc: 'nbx.tplDesc.system', caps: ['system'], icon: 'cpu' },
    'navedit.tplFetch': { desc: 'nbx.tplDesc.fetch', caps: ['network'], icon: 'globe' },
    'navedit.tplClipboard': { desc: 'nbx.tplDesc.clipboard', caps: ['clipboard'], icon: 'copy' },
    'navedit.tplMulti': { desc: 'nbx.tplDesc.multi', caps: [], icon: 'folders' },
};

interface CustomNavItem {
    id: string;                            // "custom:abc123"
    label: string;
    kind: 'view' | 'modal' | 'url' | 'page'; // internal view / modal / external URL / sandboxed custom page
    target: string;                        // viewId | modalId | https URL | pageId
    icon?: string;                         // an icon ref (see "Icons" below)
}

// ── Icons ────────────────────────────────────────────────────────────────────
//
// A nav icon is stored as a plain string, so it travels unchanged through the share link and
// the .bmmnav file:
//   ui:<name>            a glyph of BMM's own registry (ui/icons.ts): what the picker offers
//                        first, the same set as every other button in the app
//   lucide: si: iso: app: data:image/…
//                        a ref from the shared icon library (ui/icon-pack.ts, « More icons »);
//                        drawn once that library has loaded, a moment after start-up
//   nav:<viewId>         the icon one of BMM's own pages already wears
//   brand:<x>            older builds' Better* logos (the same pictures as app:<x>)
//   star, link, gear…    older builds' own small set: drawn with the registry glyph of the
//                        same meaning, so a saved navbar keeps its icons without rewriting it
// Nothing here puts a stored string into markup: a ref is a key into a table, a data: image
// goes in an escaped src, and the library escapes what it draws.

/** Older builds' icon keys → the registry glyph that means the same. */
const LEGACY_UI: Record<string, IconName> = {
    star: 'star', link: 'link', globe: 'globe', grid: 'grid', folder: 'folder', gear: 'settings',
    bolt: 'run', book: 'book', home: 'home', search: 'search', download: 'download', upload: 'upload',
    info: 'info', bell: 'bell', tag: 'tag', package: 'package', terminal: 'terminal', image: 'image',
    play: 'play', shield: 'shield', puzzle: 'mod', user: 'user',
    heart: 'heart', chart: 'chart', flag: 'flag', wrench: 'wrench',
};
/** The Better* logos and Tasky, full-colour bundled files. Fixed sources, never user input. */
const LOGOS: Record<string, { src: string; label: string }> = {
    bmm: { src: 'assets/BMm.png', label: 'BetterModsManager' },
    bc: { src: 'assets/BC.webp', label: 'BetterCommunity' },
    bi: { src: 'assets/bi.svg', label: 'BetterInstaller' },
    bd: { src: 'assets/bd.png', label: 'BetterDiscord' },
    tasky: { src: 'assets/Tasky.png', label: 'Tasky' },
};

type IconPack = typeof import('./icon-pack.js');
let _pack: IconPack | null = null;
let _packLoad: Promise<void> = Promise.resolve();
const _packAsked = new Set<string>();
const needsPack = (ref: string): boolean => /^(lucide|si|iso):/.test(ref);

/** Load the shared library for refs it draws, then redraw the navbar (and an open editor).
 *  Each ref is asked for once: a name the library does not have stays on the fallback
 *  instead of asking again on every redraw. */
function loadPackFor(refs: string[]): void {
    const want = refs.filter((r) => needsPack(r) && !_packAsked.has(r));
    if (!want.length) return;
    want.forEach((r) => _packAsked.add(r));
    _packLoad = _packLoad
        .then(async () => {
            if (!_pack) _pack = await import('./icon-pack.js');
            await _pack.ensurePacksFor(want);
        })
        .catch(() => { /* offline or missing: the fallback icon stays */ })
        .then(() => {
            renderCustomItems(load());
            document.dispatchEvent(new CustomEvent('bmm:nav-icons-ready'));
        });
}

/** Markup for an icon ref, or '' when it names nothing drawable (yet). */
function iconHtml(ref: string | undefined, size: 16 | 18 | 20 | 24 = 18): string {
    const r = String(ref || '');
    if (!r) return '';
    if (r.startsWith('data:image/')) return `<img class="nav-custom-img" src="${escAttr(r)}" alt="">`;
    if (r.startsWith('ui:')) { const n = r.slice(3); return isIconName(n) ? uiIcon(n, size) : ''; }
    if (r.startsWith('app:') || r.startsWith('brand:')) {
        const logo = LOGOS[r.slice(r.indexOf(':') + 1)];
        return logo ? `<img class="nav-custom-img" src="${escAttr(logo.src)}" alt="">` : '';
    }
    if (r.startsWith('nav:')) {
        const el = items().find((e) => e.dataset.view === r.slice(4));
        return el?.querySelector('.nav-icon')?.innerHTML.trim() || '';
    }
    if (needsPack(r)) {
        if (_pack) { const out = _pack.renderPackIcon(r, size); if (out) return out; }
        loadPackFor([r]);
        return '';
    }
    if (LEGACY_UI[r]) return uiIcon(LEGACY_UI[r], size);
    return '';
}

interface NavbarConfig {
    // `order` mixes item ids (built-in data-view + custom) and section dividers
    // ("group:<id>"). A section header is rendered for each "group:" entry; the items
    // that follow it visually belong to that section.
    order: string[];
    hidden: Record<string, boolean>;
    labels: Record<string, string>;        // id → custom label (rename)
    custom: CustomNavItem[];
    groups: Record<string, { label: string }>;
}

function load(): NavbarConfig {
    try {
        const c = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        return {
            order: Array.isArray(c.order) ? c.order : [], hidden: c.hidden || {}, labels: c.labels || {},
            custom: Array.isArray(c.custom) ? c.custom : [], groups: c.groups || {},
        };
    } catch { return { order: [], hidden: {}, labels: {}, custom: [], groups: {} }; }
}
const EMPTY_CFG: NavbarConfig = { order: [], hidden: {}, labels: {}, custom: [], groups: {} };
function save(c: NavbarConfig): void {
    try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

// ── Shareable config (short code / bmm:// link), mirroring card-order.ts ──
const NAV_CODE_PREFIX = 'BMMNAV1.';
function exportNavCode(): string {
    // The bmm:// link is the lightweight share: classic navbar + custom buttons.
    // Uploaded (data: URI) icons and custom pages are too big for a URL — those
    // travel in the .bmmnav file instead. Strip data-URI icons so the link stays short.
    const cfg = load();
    cfg.custom = cfg.custom.map(c => c.icon && c.icon.startsWith('data:') ? { ...c, icon: '' } : c);
    return NAV_CODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(cfg))));
}
// ── .bmmnav file: the FULL portable bundle (navbar config + custom icons +
//    custom pages' source/permissions). The bmm:// code link can't carry page
//    bundles or uploaded icons, so sharing those uses this file. ──
// `grants` / `netOrigins` are what the page held where it was exported. On import they are
// REQUESTS shown in the review step (nav-bundle-import.ts), never applied as they are.
interface NavBundlePage { id: string; name: string; html: string; css: string; js: string; grants: string[]; netOrigins: string[]; }
interface NavBundle { format: 'bmmnav'; version: 1; navbar: NavbarConfig; pages: NavBundlePage[]; }

async function exportNavBundle(): Promise<void> {
    const cfg = load();
    const pageIds = new Set(cfg.custom.filter(c => c.kind === 'page').map(c => c.target));
    const pages: NavBundlePage[] = [];
    for (const id of pageIds) {
        try {
            const src = await invoke('get_custom_page_source', { id }) as { name: string; html: string; css: string; js: string };
            const grants = await invoke('page_grants_get', { id }).catch(() => []) as string[];
            const netOrigins = await invoke('page_net_origins_get', { id }).catch(() => []) as string[];
            pages.push({ id, ...src, grants, netOrigins });
        } catch { /* page gone — skip */ }
    }
    const bundle: NavBundle = { format: 'bmmnav', version: 1, navbar: cfg, pages };
    const path = await saveFile({ defaultPath: 'my-navbar.bmmnav', filters: [{ name: 'BMM Navigation', extensions: ['bmmnav'] }] }).catch(() => null);
    if (!path) return;
    // Signed on the way to disk. A .bmmnav carries custom PAGES with their permissions and
    // network origins — it is the one export where "is this still what its author wrote"
    // decides whether importing it is safe.
    try { await invoke('write_signed_document', { path, json: JSON.stringify(bundle), format: 'bmmnav' }); (window as any).toast?.(t('navedit.bundleExported') || 'Navigation exported', 'success'); }
    catch (e) { (window as any).toast?.(String(e), 'error'); }
}

async function importNavBundle(): Promise<void> {
    const path = await pickFile({ filters: [{ name: 'BMM Navigation', extensions: ['bmmnav', 'json'] }] }).catch(() => null);
    if (!path) return;
    let bundle: NavBundle;
    try { bundle = JSON.parse(await invoke('read_nav_bundle', { path }) as string); } catch (e) { (window as any).toast?.(String(e), 'error'); return; }
    if (bundle.format !== 'bmmnav' || !bundle.navbar) { (window as any).toast?.(t('navedit.badBundle') || 'Not a valid .bmmnav file', 'error'); return; }

    // Check the signature BEFORE creating anything.
    //
    // Export signs this file precisely because of what the next twenty lines do: create pages
    // from somebody else's HTML/CSS/JS, and the review that follows shows what the file asks
    // for: both mean something only if the file is what its author wrote. Signing it and then
    // not reading the signature is the same as not signing it — the check has to sit in front
    // of the review, not beside it.
    //
    // UNSIGNED is not refused. Every .bmmnav written before signing existed is unsigned, and
    // so is one built by hand; refusing those would break sharing to protect nothing. What is
    // refused without an explicit yes is TAMPERED — a file that claims an author and no longer
    // matches, which is the only state that says something went wrong rather than unstated.
    try {
        const raw = await invoke('read_nav_bundle', { path }) as string;
        const v = await invoke('verify_bmm_document', { json: raw, format: 'bmmnav' }) as { state: string; authorId?: string };
        if (v.state === 'tampered' || v.state === 'malformed') {
            const go = await showConfirm(
                t('navedit.sigBadTitle'),
                t('navedit.sigBadBody'),
            );
            if (!go) return;
        }
    } catch (e) { console.warn('[nav] signature check failed', e); }

    // Recreate each shared page as a NEW page holding nothing, ask the user which of the
    // permissions and sites the file asks for to grant ("Grant none" is the default), apply
    // only that answer, then remap the custom buttons' targets. The file's lists are requests:
    // nothing here sets a grant or an origin directly, and an existing page is never written
    // to, so re-importing a file cannot raise any page's grants.
    const { idMap, applied } = await runNavBundleImport(bundle, { invoke, review: openGrantReview });
    for (const id of Object.values(idMap)) await refreshGrants(id);
    const anyGranted = Object.values(applied).some(a => a.caps.length > 0);
    const cfg: NavbarConfig = { ...EMPTY_CFG, ...bundle.navbar };
    for (const c of cfg.custom || []) { if (c.kind === 'page' && idMap[c.target]) c.target = idMap[c.target]; }
    save(cfg); applyNavbarConfig();
    (window as any).toast?.(!Object.keys(applied).length ? (t('navedit.bundleImported') || 'Navigation imported')
        : anyGranted ? t('navedit.reviewDoneSome') : t('navedit.reviewDoneNone'), 'success');
    openNavbarEditor();
}

function parseNavCode(input: string): NavbarConfig | null {
    try {
        const s = input.trim();
        const m = s.match(/[?&]code=([^&]+)/);          // accept a bmm:// link or a raw code
        const code = m ? decodeURIComponent(m[1]) : s;
        if (!code.startsWith(NAV_CODE_PREFIX)) return null;
        const cfg = JSON.parse(decodeURIComponent(escape(atob(code.slice(NAV_CODE_PREFIX.length)))));
        return { ...EMPTY_CFG, ...cfg };
    } catch { return null; }
}

function navEl(): HTMLElement | null { return document.querySelector('.sidebar-nav'); }
function items(): HTMLElement[] {
    const n = navEl();
    if (!n) return [];
    return (Array.from(n.querySelectorAll(':scope > .nav-item')) as HTMLElement[])
        .filter(el => el.id !== 'nav-customize-btn');   // the editor trigger stays last, not reorderable
}
function idOf(el: HTMLElement): string {
    return el.dataset.view || el.dataset.customId || el.id.replace(/^nav-/, '');
}
function cssEsc(s: string): string {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}
function customIcon(item: CustomNavItem): string {
    return iconHtml(item.icon) || uiIcon(KIND_ICON[item.kind] || 'link', 18);
}
function labelEl(el: HTMLElement): HTMLElement | null { return el.querySelector('.nav-label'); }

/** Render (or refresh) the custom nav buttons defined in the config. */
function renderCustomItems(cfg: NavbarConfig): void {
    const nav = navEl(); if (!nav) return;
    const wantedIds = new Set(cfg.custom.map(c => c.id));
    // Remove custom buttons (and their views) that no longer exist.
    nav.querySelectorAll('.nav-item[data-custom-id]').forEach(el => {
        const id = (el as HTMLElement).dataset.customId!;
        if (!wantedIds.has(id)) { document.getElementById(viewIdFor(id))?.remove(); el.remove(); }
    });
    for (const item of cfg.custom) {
        let btn = nav.querySelector(`.nav-item[data-custom-id="${cssEsc(item.id)}"]`) as HTMLButtonElement | null;
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'nav-item nav-item-custom';
            btn.dataset.customId = item.id;
            btn.addEventListener('click', () => activateCustom(item));
            nav.appendChild(btn);
        }
        btn.innerHTML = `<span class="nav-icon">${customIcon(item)}</span><span class="nav-label">${escAttr(item.label)}</span>`;
    }
}

function viewIdFor(customId: string): string { return 'view-' + customId.replace(/[^a-z0-9]/gi, '-'); }

/**
 * URL for a sandboxed page's entry file. Tauri v2 does NOT route `bmmpage://`
 * directly in the webview — on Windows/Android custom schemes are served at
 * `http://<scheme>.localhost/…`, elsewhere at `<scheme>://localhost/…`. The
 * Rust handler accepts both (id as first path segment for *.localhost hosts).
 */
function pageBundleUrl(id: string): string {
    const enc = encodeURIComponent(id);
    const isWin = /Windows|Android/i.test(navigator.userAgent);
    return isWin
        ? `http://bmmpage.localhost/${enc}/index.html`
        : `bmmpage://localhost/${enc}/index.html`;
}

/** Open a custom item: switch to an internal view, open a modal, or show a sandboxed URL. */
function activateCustom(item: CustomNavItem): void {
    if (item.kind === 'view') {
        (document.querySelector(`.nav-item[data-view="${cssEsc(item.target)}"]`) as HTMLElement | null)?.click();
        return;
    }
    if (item.kind === 'modal') {
        // Prefer the curated action (real opener, properly initialized).
        if (runModalAction(item.target)) return;
        // Legacy fallback: a raw modal element id from an older custom button.
        const m = document.getElementById(item.target) || document.querySelector(`.${cssEsc(item.target)}`);
        if (m) {
            // Many modals live INSIDE a view section (e.g. #view-modpacks); if that view
            // isn't active it's display:none, so the modal stays invisible. Portal it to
            // the top-level window so it shows from anywhere, like its normal trigger does.
            const host = document.getElementById('app-window-outer');
            if (host && m.parentElement !== host) host.appendChild(m);
            m.classList.add('open');
            m.classList.add('active');                 // some overlays use .active instead of .open
        }
        return;
    }
    if (item.kind === 'page') {
        // Custom sandboxed page served by the bmmpage:// protocol. The iframe has
        // NO allow-same-origin → opaque `null` origin → it cannot reach window.parent,
        // the BMM DOM, __TAURI__/invoke, cookies, or the network (CSP connect-src 'none').
        const pvid = viewIdFor(item.id);
        let pview = document.getElementById(pvid) as HTMLElement | null;
        if (!pview) {
            const host = document.querySelector('.content-area') || document.querySelector('main') || document.body;
            pview = document.createElement('section');
            pview.id = pvid; pview.className = 'view custom-url-view custom-page-view';
            // allow-modals: alert()/confirm() in a quick test page failed silently
            // without it. Dialogs only — the isolation story (no allow-same-origin,
            // opaque origin, CSP connect-src 'none') is unchanged.
            pview.innerHTML = `<iframe class="custom-url-frame custom-page-frame" referrerpolicy="no-referrer"
                sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
                data-page-id="${escAttr(item.target)}"
                data-src="${escAttr(pageBundleUrl(item.target))}" src="about:blank"></iframe>`;
            host.appendChild(pview);
        }
        refreshGrants(item.target);                            // load this page's permissions for the broker
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        pview.classList.add('active');
        (navEl()?.querySelector(`.nav-item[data-custom-id="${cssEsc(item.id)}"]`) as HTMLElement | null)?.classList.add('active');
        syncCustomFrames();
        return;
    }
    // kind === 'url' → show a sandboxed iframe IN the content area (navbar stays).
    if (!/^https?:\/\//i.test(item.target)) return;            // only real web URLs
    const vid = viewIdFor(item.id);
    let view = document.getElementById(vid) as HTMLElement | null;
    if (!view) {
        const host = document.querySelector('.content-area') || document.querySelector('main') || document.body;
        view = document.createElement('section');
        view.id = vid; view.className = 'view custom-url-view';
        // An external https site is cross-origin to BMM, so the browser already isolates
        // it from the app (it can't reach window.parent / __TAURI__). allow-same-origin
        // here refers to the *site's own* origin (so it actually works), NOT BMM's.
        // No allow-top-navigation → it can never replace the BMM window.
        // NB: many sites (YouTube, Google…) refuse embedding via X-Frame-Options /
        // frame-ancestors — that's the site's choice, not a BMM bug; hence the
        // "open in browser" escape + hint in the bar.
        view.innerHTML = `
            <div class="custom-url-bar">
                <span class="custom-url-addr" data-tooltip="${escAttr(item.target)}">${escAttr(item.target)}</span>
                <span class="custom-url-hint">${t('navedit.embedHint') || 'Some sites block embedding'}</span>
                <button class="custom-url-open" type="button">${uiIcon('external', 12)} ${t('navedit.openExternal') || 'Open in browser'}</button>
            </div>
            <iframe class="custom-url-frame" referrerpolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                data-src="${escAttr(item.target)}" src="about:blank"></iframe>`;
        view.querySelector('.custom-url-open')?.addEventListener('click', () => (window as any).openExternal?.(item.target));
        host.appendChild(view);
    }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    view.classList.add('active');
    (navEl()?.querySelector(`.nav-item[data-custom-id="${cssEsc(item.id)}"]`) as HTMLElement | null)?.classList.add('active');
    syncCustomFrames();
}

/**
 * Load the iframe of the *active* custom view from its `data-src`, and unload
 * every inactive one (`src=about:blank`) so it stops consuming CPU/memory/network
 * (e.g. a playing video) while you're on another tab. Cheap and idempotent.
 */
function syncCustomFrames(): void {
    document.querySelectorAll('.custom-url-view, .custom-page-view').forEach(view => {
        const f = view.querySelector('iframe') as HTMLIFrameElement | null;
        if (!f) return;
        const real = f.dataset.src || '';
        if (view.classList.contains('active')) {
            if (real && f.getAttribute('src') !== real) f.setAttribute('src', real);
        } else if (f.getAttribute('src') !== 'about:blank') {
            f.setAttribute('src', 'about:blank');
        }
    });
}

/** Apply the saved config to the real navbar (idempotent). */
export function applyNavbarConfig(): void {
    const nav = navEl(); if (!nav) return;
    const cfg = load();
    renderCustomItems(cfg);
    const byId = new Map(items().map(el => [idOf(el), el]));

    // 1) Reorder + section headers: walk `order`, appending a header for each "group:"
    //    entry and the matching item otherwise. Unknown/new items keep their spot after.
    nav.querySelectorAll('.nav-group-header').forEach(h => h.remove());
    for (const entry of cfg.order) {
        if (entry.startsWith('group:')) {
            const g = cfg.groups[entry];
            if (!g) continue;
            const h = document.createElement('div');
            h.className = 'nav-group-header';
            h.dataset.groupEntry = entry;
            h.textContent = g.label || '';
            nav.appendChild(h);
        } else {
            const el = byId.get(entry);
            if (el) nav.appendChild(el);
        }
    }
    // 2) Hide / show + 3) rename.
    for (const el of items()) {
        const id = idOf(el);
        el.classList.toggle('nav-item-hidden', !!cfg.hidden[id] && !PROTECTED.has(id));
        const lbl = labelEl(el);
        if (lbl) {
            const custom = cfg.labels[id];
            if (custom) {
                if (!lbl.dataset.i18nOrig) lbl.dataset.i18nOrig = lbl.getAttribute('data-i18n') || '';
                lbl.removeAttribute('data-i18n');     // stop i18n from overwriting the rename
                lbl.textContent = custom;
            } else if (lbl.dataset.i18nOrig !== undefined && !lbl.getAttribute('data-i18n') && lbl.dataset.i18nOrig) {
                lbl.setAttribute('data-i18n', lbl.dataset.i18nOrig); // restore original key
                lbl.textContent = t(lbl.dataset.i18nOrig);
            }
        }
    }
}

/** Apply the saved config at startup. The editor is opened from Settings (card-order bar). */
export function initNavbarCustomize(): void {
    applyNavbarConfig();
    initPageBroker();                          // the single postMessage bridge for sandboxed pages
    // When the user navigates to any built-in tab, the active custom view loses
    // `.active`; unload its iframe shortly after so it stops using resources.
    const nav = navEl();
    if (nav && !(nav as any)._bmmSyncWired) {
        (nav as any)._bmmSyncWired = true;
        nav.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.nav-item[data-view]')) {
                setTimeout(syncCustomFrames, 60);  // after app.ts switches the view
            }
        });
    }
}

/** Apply a shared navbar config from a bmm:// deep link code. Returns true on success. */
export function applyNavCodeFromLink(code: string): boolean {
    const cfg = parseNavCode(code);
    if (!cfg) return false;
    save(cfg); applyNavbarConfig();
    return true;
}

// ── The editor ────────────────────────────────────────────────────────────────
//
// Rebuilt for 1.0.4. The old dialog was one long column: the item list, then an « add a
// button » form, then a « custom pages » form with three code boxes and six unlabelled
// permission ticks, all open at once, so the screen asked everything before you had chosen
// anything. Now:
//
//   left   the sidebar as it will look: drag a row to move it (under a section header to
//          group it), the eye to hide it, a click to select it
//   right  what can be changed about the selected row, and nothing else
//   « Add a button »  a short guided flow in the right pane: what it opens, then a name and
//          an icon; for « My own page » also a starter, the permissions (each explained, all
//          off) and the page running in its sandbox before anything is added
//
// The security properties are the same ones, in the same places: a custom page runs in
// the bmmpage:// sandbox (opaque origin, its own CSP) and reaches BMM only through
// custom-page-broker.ts; every permission starts off and is changed only by a switch the user
// flips here; an imported .bmmnav creates new pages holding nothing and asks (nav-grant-review);
// re-importing never adds a permission to an existing page. The saved format is unchanged.

const KIND_ICON: Record<CustomNavItem['kind'], IconName> = { view: 'link', modal: 'grid', url: 'globe', page: 'file-text' };
const KINDS: CustomNavItem['kind'][] = ['view', 'modal', 'url', 'page'];
/** Every permission a page can be given, in the order shown, with how much it exposes. */
const CAPS: Array<{ cap: string; risk: 'low' | 'mid' | 'high' }> = [
    { cap: 'storage', risk: 'low' },
    { cap: 'notifications', risk: 'low' },
    { cap: 'read', risk: 'low' },
    { cap: 'system', risk: 'mid' },
    { cap: 'clipboard', risk: 'high' },
    { cap: 'network', risk: 'high' },
];
/** One-click sets. The clipboard and system info are never in one: each is its own switch. */
const PRESETS: Record<string, string[]> = {
    none: [],
    local: ['storage', 'notifications', 'read'],
    online: ['storage', 'notifications', 'read', 'network'],
};
function capLabel(cap: string): string {
    const k: Record<string, string> = {
        storage: 'navedit.capStorage', notifications: 'navedit.capNotify', network: 'navedit.capNetwork',
        read: 'navedit.capRead', clipboard: 'navedit.capClipboard', system: 'navedit.capSystem',
    };
    return k[cap] ? t(k[cap]) : cap;
}
function capRisk(cap: string): string {
    const k: Record<string, string> = {
        storage: 'navedit.riskStorage', notifications: 'navedit.riskNotifications', network: 'navedit.riskNetwork',
        read: 'navedit.riskRead', clipboard: 'navedit.riskClipboard', system: 'navedit.riskSystem',
    };
    return k[cap] ? t(k[cap]) : '';
}
const RISK_KEY = { low: 'nbx.riskLow', mid: 'nbx.riskMid', high: 'nbx.riskHigh' } as const;

// ── Icon picker (inline) ──────────────────────────────────────────────────────
//
// The registry glyphs (ui/icons.ts) by theme, BMM's own page icons and the Better* logos,
// a search over all of them, and the icons used last. « More icons » opens the shared
// library (2 000+ Lucide glyphs, brands, your uploads) for anything else.

const ICON_CATS: Array<{ id: string; key: string; names: IconName[] }> = [
    { id: 'places', key: 'nbx.icCat.places', names: ['home', 'grid', 'list', 'layers', 'map', 'globe', 'link', 'external', 'store', 'book', 'book-open', 'star', 'pin'] },
    { id: 'files', key: 'nbx.icCat.files', names: ['folder', 'folders', 'open-folder', 'file', 'file-text', 'archive', 'database', 'hard-drive', 'server', 'cloud', 'package', 'box', 'download', 'upload', 'save', 'clipboard-list'] },
    { id: 'create', key: 'nbx.icCat.create', names: ['image', 'palette', 'play', 'monitor', 'code', 'terminal', 'generate', 'pick', 'languages', 'lightbulb', 'ai'] },
    { id: 'tools', key: 'nbx.icCat.tools', names: ['settings', 'sliders', 'run', 'launch', 'workflow', 'git-branch', 'cpu', 'network', 'activity', 'scale', 'calendar', 'clock', 'bug', 'key', 'search'] },
    { id: 'people', key: 'nbx.icCat.people', names: ['user', 'users', 'message', 'send', 'bell', 'share', 'fingerprint'] },
    { id: 'status', key: 'nbx.icCat.status', names: ['info', 'help', 'warning', 'success', 'shield', 'shield-check', 'lock', 'eye', 'history'] },
    { id: 'games', key: 'nbx.icCat.games', names: ['game', 'mod', 'hexagon', 'tag'] },
];
/** Words people type that are not the glyph's name. */
const ICON_WORDS: Record<string, string> = {
    house: 'home', start: 'home', web: 'globe', internet: 'globe', site: 'globe', url: 'link', shop: 'store',
    gear: 'settings', cog: 'settings', options: 'sliders', trash: 'delete', bin: 'delete', pen: 'edit',
    photo: 'image', picture: 'image', video: 'play', music: 'play', chat: 'message', mail: 'send',
    person: 'user', people: 'users', team: 'users', note: 'file-text', notes: 'file-text', doc: 'file-text',
    puzzle: 'mod', mods: 'mod', gamepad: 'game', joystick: 'game', time: 'clock', date: 'calendar',
    bolt: 'run', fast: 'run', rocket: 'launch', alert: 'warning', danger: 'warning', ok: 'success',
    secure: 'shield', password: 'key', script: 'code', console: 'terminal', lang: 'languages', idea: 'lightbulb',
};
const RECENT_KEY = 'bmm_nav_icon_recent';
function recentIcons(): string[] {
    try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 12) : []; }
    catch { return []; }
}
function rememberIcon(ref: string): void {
    // An uploaded image is kept by the shared library already; a data: URL is too big to repeat here.
    if (!ref || ref.startsWith('data:')) return;
    try { localStorage.setItem(RECENT_KEY, JSON.stringify([ref, ...recentIcons().filter((r) => r !== ref)].slice(0, 12))); } catch { /* pref only */ }
}
/** The icon refs of BMM's own pages, harvested from the sidebar (built-in pages only). */
function bmmIconRefs(): string[] {
    return items().filter((el) => el.dataset.view && el.querySelector('.nav-icon')?.innerHTML.trim()).map((el) => 'nav:' + el.dataset.view);
}
function iconTitle(ref: string): string {
    if (ref.startsWith('ui:')) return ref.slice(3);
    if (ref.startsWith('nav:')) return origLabel(ref.slice(4));
    if (ref.startsWith('app:')) return LOGOS[ref.slice(4)]?.label || ref;
    return ref.replace(/^[a-z]+:/, '');
}

/** Mount the picker in `host`. `onPick` gets the chosen ref. */
function mountIconPicker(host: HTMLElement, current: string, onPick: (ref: string) => void): void {
    let cat = 'all';
    let query = '';
    host.innerHTML = `
        <div class="nbx-ipk">
            <div class="nbx-ipk-top">
                <label class="nbx-ipk-search">
                    ${uiIcon('search', 14)}
                    <input type="search" class="nbx-ipk-q" placeholder="${escAttr(t('nbx.icSearch'))}" aria-label="${escAttr(t('nbx.icSearch'))}" autocomplete="off" spellcheck="false">
                </label>
                <button type="button" class="btn btn-ghost btn-sm nbx-ipk-more">${uiIcon('grid', 14)}<span>${escAttr(t('nbx.icMore'))}</span></button>
            </div>
            <div class="nbx-ipk-cats" role="tablist" aria-label="${escAttr(t('nbx.icCats'))}"></div>
            <div class="nbx-ipk-grid" role="listbox" aria-label="${escAttr(t('navedit.icon'))}"></div>
        </div>`;
    const q = host.querySelector('.nbx-ipk-q') as HTMLInputElement;
    const catsEl = host.querySelector('.nbx-ipk-cats') as HTMLElement;
    const grid = host.querySelector('.nbx-ipk-grid') as HTMLElement;
    const cell = (ref: string) => {
        const markup = iconHtml(ref, 20);
        if (!markup) return '';
        const title = iconTitle(ref);
        return `<button type="button" class="nbx-ipk-cell${ref === current ? ' is-sel' : ''}" role="option" aria-selected="${ref === current}" data-ref="${escAttr(ref)}" aria-label="${escAttr(title)}" data-tooltip="${escAttr(title)}">${markup}</button>`;
    };
    const section = (label: string, refs: string[]) => {
        const cells = refs.map(cell).filter(Boolean).join('');
        return cells ? `<div class="nbx-ipk-sec">${escAttr(label)}</div><div class="nbx-ipk-cells">${cells}</div>` : '';
    };
    const logos = Object.keys(LOGOS).map((k) => 'app:' + k);
    const renderCats = () => {
        const recent = recentIcons();
        const tabs = [
            { id: 'all', label: t('nbx.icAll') },
            ...(recent.length ? [{ id: 'recent', label: t('nbx.icRecent') }] : []),
            ...ICON_CATS.map((c) => ({ id: c.id, label: t(c.key) })),
            { id: 'bmm', label: t('nbx.icCat.bmm') },
        ];
        catsEl.innerHTML = tabs.map((c) => `<button type="button" role="tab" class="nbx-chip${c.id === cat ? ' is-on' : ''}" aria-selected="${c.id === cat}" data-cat="${c.id}">${escAttr(c.label)}</button>`).join('');
    };
    const render = () => {
        renderCats();
        const words = query.toLowerCase().split(/[\s-]+/).filter(Boolean);
        if (words.length) {
            // A search looks through the WHOLE registry, not just the themed lists.
            const want = (name: string, label: string) => words.every((w) => name.includes(w) || label.includes(w) || ICON_WORDS[w] === name);
            const hits: string[] = [];
            for (const n of ICON_NAMES) if (want(n, '')) hits.push('ui:' + n);
            for (const r of bmmIconRefs()) if (want(r.slice(4), iconTitle(r).toLowerCase())) hits.push(r);
            for (const r of logos) if (want(r.slice(4), iconTitle(r).toLowerCase())) hits.push(r);
            const html = section(t('nbx.icResults'), hits);
            grid.innerHTML = html || `<p class="nbx-empty-line">${escAttr(t('nbx.icNone'))}</p>`;
            return;
        }
        const parts: string[] = [];
        const recent = recentIcons();
        if ((cat === 'all' || cat === 'recent') && recent.length) parts.push(section(t('nbx.icRecent'), recent));
        for (const c of ICON_CATS) if (cat === 'all' || cat === c.id) parts.push(section(t(c.key), c.names.map((n) => 'ui:' + n)));
        if (cat === 'all' || cat === 'bmm') parts.push(section(t('nbx.icCat.bmm'), [...bmmIconRefs(), ...logos]));
        grid.innerHTML = parts.join('');
    };
    render();
    catsEl.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('[data-cat]') as HTMLElement | null;
        if (!b) return;
        cat = b.dataset.cat || 'all';
        render();
    });
    let deb: ReturnType<typeof setTimeout> | undefined;
    q.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { query = q.value.trim(); render(); }, 90); });
    const pick = (ref: string) => { current = ref; rememberIcon(ref); onPick(ref); render(); };
    grid.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('[data-ref]') as HTMLElement | null;
        if (b?.dataset.ref) pick(b.dataset.ref);
    });
    host.querySelector('.nbx-ipk-more')?.addEventListener('click', async () => {
        try {
            const pack = _pack || (_pack = await import('./icon-pack.js'));
            const ref = await pack.openIconPicker({ current });
            if (!ref) return;
            await pack.ensurePackFor(ref).catch(() => undefined);
            _packAsked.add(ref);
            pick(ref);
        } catch (err) { (window as any).toast?.(String(err), 'error'); }
    });
    // A library icon picked in an earlier session draws once the library is in memory.
    const onReady = () => { if (host.isConnected) render(); else document.removeEventListener('bmm:nav-icons-ready', onReady); };
    document.addEventListener('bmm:nav-icons-ready', onReady);
}

// ── Small pieces of markup ────────────────────────────────────────────────────

function switchHtml(attrs: string, on: boolean, disabled = false): string {
    return `<span class="nbx-switch"><input type="checkbox" role="switch" ${attrs} ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="nbx-switch-track" aria-hidden="true"></span></span>`;
}
function itemName(id: string, cfg: NavbarConfig): string {
    const c = cfg.custom.find((x) => x.id === id);
    if (c) return c.label;
    return cfg.labels[id] || origLabel(id);
}
function builtinIcon(id: string): string {
    return items().find((e) => idOf(e) === id)?.querySelector('.nav-icon')?.innerHTML || '';
}

/** Open the customization editor (a modal). `select` preselects a row by id. */
export function openNavbarEditor(select?: string): void {
    document.getElementById('navbar-editor-overlay')?.remove();
    ensureEditorCss();
    const overlay = document.createElement('div');
    overlay.id = 'navbar-editor-overlay';
    overlay.className = 'modal-generic-overlay open';

    overlay.innerHTML = `
        <div class="modal bms modal--xl modal--tall nbx-modal" role="dialog" aria-modal="true" aria-labelledby="nbe-title">
            <div class="modal-header">
                <div class="bms-icon" aria-hidden="true">${uiIcon('panel-left-open', 18)}</div>
                <div class="bms-titles">
                    <h2 class="modal-title" id="nbe-title">${escAttr(t('navedit.title'))}</h2>
                    <p class="bms-sub">${escAttr(t('nbx.sub'))}</p>
                </div>
                <button type="button" class="modal-close" id="nbe-close" aria-label="${escAttr(t('common.close'))}">${uiIcon('close', 16)}</button>
            </div>
            <div class="modal-body modal-body--flush nbx-body">
                <div class="nbx-layout">
                    <aside class="nbx-side" aria-label="${escAttr(t('nbx.sideTitle'))}">
                        <div class="nbx-side-head">
                            <span class="nbx-side-title">${escAttr(t('nbx.sideTitle'))}</span>
                            <span class="nbx-side-hint">${escAttr(t('nbx.sideHint'))}</span>
                        </div>
                        <div class="nbx-preview" id="nbx-list" role="listbox" aria-label="${escAttr(t('nbx.sideTitle'))}"></div>
                        <div class="nbx-side-add">
                            <button type="button" class="btn btn-secondary btn-sm" id="nbx-add-btn">${uiIcon('add', 14)}<span>${escAttr(t('navedit.addBtn'))}</span></button>
                            <button type="button" class="btn btn-ghost btn-sm" id="nbe-add-section">${uiIcon('list', 14)}<span>${escAttr(t('navedit.addSection'))}</span></button>
                        </div>
                        <div class="nbx-orphans" id="nbx-orphans" hidden></div>
                    </aside>
                    <section class="nbx-pane" id="nbx-pane" aria-live="polite"></section>
                </div>
                <div class="nbe-import-row" id="nbe-import-row" style="display:none">
                    <input class="input" id="nbe-import-input" placeholder="${escAttr(t('cardorder.importPh'))}">
                    <button class="btn btn-xs btn-accent" id="nbe-import-apply">${escAttr(t('common.apply'))}</button>
                </div>
            </div>
            <!-- Share/import is one menu: every entry says what it carries (link = layout only,
                 file = everything). Buttons only, never a link: an anchor here once navigated
                 the main window (tests/navbar-editor-markup.test.mjs). -->
            <div class="modal-footer nbe-actions">
                <button class="btn btn-ghost nbe-act" id="nbe-reset"><span class="nbe-act-ic">${uiIcon('reset', 16)}</span><span class="nbe-act-tx">${escAttr(t('navedit.reset'))}</span></button>
                <span class="nbe-share-menu-wrap">
                    <button class="btn btn-ghost nbe-act" id="nbe-share-menu-btn" aria-haspopup="menu"><span class="nbe-act-ic">${uiIcon('share', 16)}</span><span class="nbe-act-tx">${escAttr(t('navedit.shareMenu'))}</span>${uiIcon('chevron-down', 14)}</button>
                    <span class="nbe-share-menu" id="nbe-share-menu" role="menu" hidden>
                        <button class="nbe-menu-item" id="nbe-share" role="menuitem"><span class="nbe-mi-title">${escAttr(t('navedit.shareLink'))}</span><span class="nbe-mi-hint">${escAttr(t('navedit.shareLinkHint'))}</span></button>
                        <button class="nbe-menu-item" id="nbe-import" role="menuitem"><span class="nbe-mi-title">${escAttr(t('navedit.importCode'))}</span><span class="nbe-mi-hint">${escAttr(t('navedit.importCodeHint'))}</span></button>
                        <button class="nbe-menu-item" id="nbe-export-file" role="menuitem"><span class="nbe-mi-title">${escAttr(t('navedit.exportFile'))}</span><span class="nbe-mi-hint">${escAttr(t('navedit.exportFileHint'))}</span></button>
                        <button class="nbe-menu-item" id="nbe-import-file" role="menuitem"><span class="nbe-mi-title">${escAttr(t('navedit.importFileNav'))}</span><span class="nbe-mi-hint">${escAttr(t('navedit.importFileHint'))}</span></button>
                    </span>
                </span>
                <button class="btn btn-primary nbe-act" id="nbe-done"><span class="nbe-act-ic">${uiIcon('check', 16)}</span><span class="nbe-act-tx">${escAttr(t('common.done'))}</span></button>
            </div>
        </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(overlay);

    const list = overlay.querySelector('#nbx-list') as HTMLElement;
    const pane = overlay.querySelector('#nbx-pane') as HTMLElement;
    const orphansEl = overlay.querySelector('#nbx-orphans') as HTMLElement;
    let sel: string | null = select && orderedIds().includes(select) ? select : null;
    let view: 'details' | 'wizard' | 'code' = 'details';
    /** Set while the guided flow holds a page it created and has not attached to a button yet. */
    let draftPageId: string | null = null;
    let codePageId: string | null = null;

    const toast = (m: string, kind = 'info') => (window as any).toast?.(m, kind);
    const commit = (cfg: NavbarConfig) => { save(cfg); applyNavbarConfig(); };

    // ── Left: the sidebar preview ──────────────────────────────────────────────
    const rowHtml = (id: string, cfg: NavbarConfig): string => {
        const isSel = id === sel;
        if (id.startsWith('group:')) {
            const label = cfg.groups[id]?.label || t('nbx.untitledSection');
            return `<div class="nbx-row nbx-row-sect${isSel ? ' is-sel' : ''}" data-id="${escAttr(id)}" role="option" tabindex="0" aria-selected="${isSel}">
                <span class="nbx-grip" aria-hidden="true">${uiIcon('grip', 14)}</span>
                <span class="nbx-sect-label">${escAttr(label)}</span>
            </div>`;
        }
        const item = cfg.custom.find((c) => c.id === id);
        const icon = item ? customIcon(item) : builtinIcon(id);
        const prot = PROTECTED.has(id);
        const hidden = !!cfg.hidden[id] && !prot;
        const badge = item ? t(`nbx.badge.${item.kind}`) : '';
        const eyeLabel = prot ? t('nbx.alwaysShown') : hidden ? t('nbx.show') : t('nbx.hide');
        return `<div class="nbx-row${hidden ? ' is-hidden' : ''}${isSel ? ' is-sel' : ''}" data-id="${escAttr(id)}" role="option" tabindex="0" aria-selected="${isSel}">
            <span class="nbx-grip" aria-hidden="true">${uiIcon('grip', 14)}</span>
            <span class="nbx-ic" aria-hidden="true">${icon}</span>
            <span class="nbx-name">${escAttr(itemName(id, cfg))}</span>
            ${badge ? `<span class="nbx-badge">${escAttr(badge)}</span>` : ''}
            <button type="button" class="nbx-eye" data-eye="${escAttr(id)}" aria-pressed="${!hidden}" aria-label="${escAttr(eyeLabel)}" data-tooltip="${escAttr(eyeLabel)}" ${prot ? 'disabled' : ''}>${uiIcon(hidden ? 'eye-off' : 'eye', 16)}</button>
        </div>`;
    };
    const renderSide = () => {
        const cfg = load();
        list.innerHTML = orderedIds().map((id) => rowHtml(id, cfg)).join('');
        void renderOrphans();
    };
    /** Pages that exist but no button opens: offered back, or deleted. */
    const renderOrphans = async () => {
        await loadPages();
        const used = new Set(load().custom.filter((c) => c.kind === 'page').map((c) => c.target));
        const lone = _pagesCache.filter((p) => !used.has(p.id) && p.id !== draftPageId);
        orphansEl.hidden = !lone.length;
        orphansEl.innerHTML = lone.length ? `
            <div class="nbx-orphans-head">${escAttr(t('nbx.orphans'))}</div>
            ${lone.map((p) => `<div class="nbx-orphan">
                <span class="nbx-ic" aria-hidden="true">${uiIcon('file-text', 16)}</span>
                <span class="nbx-name">${escAttr(p.name)}</span>
                <button type="button" class="btn btn-ghost btn-xs" data-attach="${escAttr(p.id)}">${escAttr(t('nbx.attach'))}</button>
                <button type="button" class="nbx-icon-btn nbx-danger" data-delpage="${escAttr(p.id)}" aria-label="${escAttr(t('nbx.deletePage'))}" data-tooltip="${escAttr(t('nbx.deletePage'))}">${uiIcon('delete', 14)}</button>
            </div>`).join('')}` : '';
    };
    orphansEl.addEventListener('click', async (e) => {
        const attach = (e.target as HTMLElement).closest('[data-attach]') as HTMLElement | null;
        const del = (e.target as HTMLElement).closest('[data-delpage]') as HTMLElement | null;
        if (attach) {
            const p = _pagesCache.find((x) => x.id === attach.dataset.attach);
            if (!p) return;
            const cfg = load();
            const id = 'custom:' + Math.random().toString(36).slice(2, 9);
            cfg.custom.push({ id, label: p.name, kind: 'page', target: p.id, icon: 'ui:file-text' });
            commit(cfg);
            sel = id; view = 'details';
            renderSide(); renderPane();
        } else if (del) {
            const p = _pagesCache.find((x) => x.id === del.dataset.delpage);
            if (!p || !(await showConfirm(t('nbx.deletePageT'), t('nbx.deletePageD').replace('{name}', p.name)))) return;
            try { await invoke('delete_custom_page', { id: p.id }); } catch (err) { toast(String(err), 'error'); }
            renderSide();
        }
    });

    const select_ = (id: string | null) => {
        sel = id; view = 'details';
        list.querySelectorAll('.nbx-row').forEach((r) => {
            const on = (r as HTMLElement).dataset.id === id;
            r.classList.toggle('is-sel', on);
            r.setAttribute('aria-selected', String(on));
        });
        renderPane();
    };
    const toggleHidden = (id: string) => {
        if (PROTECTED.has(id)) return;
        const cfg = load();
        if (cfg.hidden[id]) delete cfg.hidden[id]; else cfg.hidden[id] = true;
        commit(cfg);
        renderSide();
        if (sel === id && view === 'details') renderPane();
    };
    /** Move the row `id` by `delta` places in the order. */
    const move = (id: string, delta: number) => {
        const cfg = load();
        const ids = orderedIds();
        const i = ids.indexOf(id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        cfg.order = ids;
        commit(cfg);
        renderSide();
        (list.querySelector(`[data-id="${cssEsc(id)}"]`) as HTMLElement | null)?.focus();
    };

    // Drag a row (pointer events, reliable in WebView2). A press that does not move is a click.
    let suppressClick = false;
    list.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const row = (e.target as HTMLElement).closest('.nbx-row') as HTMLElement | null;
        if (!row || (e.target as HTMLElement).closest('.nbx-eye')) return;
        const sx = e.clientX, sy = e.clientY;
        let dragging = false;
        const onMove = (ev: MouseEvent) => {
            if (!dragging) {
                if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
                dragging = true;
                row.classList.add('is-dragging');
                list.classList.add('is-sorting');
                document.body.style.userSelect = 'none';
            }
            const rows = Array.from(list.querySelectorAll('.nbx-row')) as HTMLElement[];
            const target = rows.find((r) => r !== row && ev.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
            if (target) { if (row.nextElementSibling !== target) list.insertBefore(row, target); }
            else if (list.lastElementChild !== row) list.appendChild(row);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (!dragging) return;
            document.body.style.userSelect = '';
            row.classList.remove('is-dragging');
            list.classList.remove('is-sorting');
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 0);
            const cfg = readEditor(list);
            commit(cfg);
            renderSide();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
    list.addEventListener('click', (e) => {
        if (suppressClick) return;
        const eye = (e.target as HTMLElement).closest('[data-eye]') as HTMLButtonElement | null;
        if (eye) { e.stopPropagation(); if (!eye.disabled) toggleHidden(eye.dataset.eye!); return; }
        const row = (e.target as HTMLElement).closest('.nbx-row') as HTMLElement | null;
        if (row) select_(row.dataset.id || null);
    });
    list.addEventListener('keydown', (e) => {
        const row = (e.target as HTMLElement).closest('.nbx-row') as HTMLElement | null;
        if (!row || (e.target as HTMLElement).closest('button')) return;
        const id = row.dataset.id!;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select_(id); }
        else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey) { e.preventDefault(); move(id, e.key === 'ArrowUp' ? -1 : 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (row.previousElementSibling as HTMLElement | null)?.focus(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); (row.nextElementSibling as HTMLElement | null)?.focus(); }
    });

    overlay.querySelector('#nbe-add-section')?.addEventListener('click', () => {
        const cfg = load();
        const ids = orderedIds();
        const gid = 'group:' + Math.random().toString(36).slice(2, 9);
        cfg.groups[gid] = { label: t('navedit.newSection') };
        // Above the selected row, so the section starts where you are looking.
        const at = sel ? ids.indexOf(sel) : 0;
        ids.splice(Math.max(0, at), 0, gid);
        cfg.order = ids;
        commit(cfg);
        sel = gid; view = 'details';
        renderSide(); renderPane();
        (pane.querySelector('#nbx-sect-name') as HTMLInputElement | null)?.select();
    });
    overlay.querySelector('#nbx-add-btn')?.addEventListener('click', () => startWizard());

    // ── Right: the selected row ────────────────────────────────────────────────
    const paneHead = (icon: string, title: string, chip: string, sub: string) => `
        <header class="nbx-pane-head">
            <span class="nbx-pane-ic" aria-hidden="true">${icon}</span>
            <div class="nbx-pane-titles">
                <h3 class="nbx-pane-title">${escAttr(title)}${chip ? ` <span class="nbx-badge">${escAttr(chip)}</span>` : ''}</h3>
                ${sub ? `<p class="nbx-pane-sub">${escAttr(sub)}</p>` : ''}
            </div>
        </header>`;
    const orderHtml = (id: string) => {
        const ids = orderedIds();
        const i = ids.indexOf(id);
        return `<div class="nbx-field">
            <span class="nbx-label">${escAttr(t('nbx.position'))}</span>
            <div class="nbx-inline">
                <button type="button" class="btn btn-ghost btn-sm" data-move="-1" ${i <= 0 ? 'disabled' : ''}>${uiIcon('move-up', 14)}<span>${escAttr(t('nbx.moveUp'))}</span></button>
                <button type="button" class="btn btn-ghost btn-sm" data-move="1" ${i >= ids.length - 1 ? 'disabled' : ''}>${uiIcon('move-down', 14)}<span>${escAttr(t('nbx.moveDown'))}</span></button>
                <span class="nbx-hint">${escAttr(t('nbx.moveHint'))}</span>
            </div>
        </div>`;
    };
    const visibleHtml = (id: string, cfg: NavbarConfig) => {
        const prot = PROTECTED.has(id);
        return `<label class="nbx-setting">
            <span class="nbx-setting-text"><b>${escAttr(t('nbx.visible'))}</b><span>${escAttr(prot ? t('nbx.visibleProtected') : t('nbx.visibleHint'))}</span></span>
            ${switchHtml('id="nbx-visible"', prot || !cfg.hidden[id], prot)}
        </label>`;
    };
    const wireCommon = (id: string) => {
        pane.querySelectorAll<HTMLElement>('[data-move]').forEach((b) => b.addEventListener('click', () => { move(id, parseInt(b.dataset.move!, 10)); renderPane(); }));
        pane.querySelector('#nbx-visible')?.addEventListener('change', () => toggleHidden(id));
    };

    const renderPane = () => {
        if (view === 'wizard') return renderWizard();
        if (view === 'code' && codePageId) return void renderCode(codePageId);
        const cfg = load();
        if (!sel || !orderedIds().includes(sel)) {
            sel = null;
            pane.innerHTML = `<div class="nbx-empty">
                <span class="nbx-empty-ic" aria-hidden="true">${uiIcon('panel-left-open', 32)}</span>
                <h3>${escAttr(t('nbx.emptyTitle'))}</h3>
                <p>${escAttr(t('nbx.emptyText'))}</p>
                <div class="nbx-inline nbx-center">
                    <button type="button" class="btn btn-primary btn-sm" id="nbx-empty-add">${uiIcon('add', 14)}<span>${escAttr(t('navedit.addBtn'))}</span></button>
                </div>
            </div>`;
            pane.querySelector('#nbx-empty-add')?.addEventListener('click', () => startWizard());
            return;
        }
        const id = sel;
        if (id.startsWith('group:')) {
            pane.innerHTML = `${paneHead(uiIcon('list', 20), t('navedit.section'), '', t('nbx.sectionHint'))}
                <label class="nbx-field"><span class="nbx-label">${escAttr(t('navedit.sectionName'))}</span>
                    <input class="input" id="nbx-sect-name" maxlength="40" value="${escAttr(cfg.groups[id]?.label || '')}" placeholder="${escAttr(t('navedit.sectionName'))}"></label>
                ${orderHtml(id)}
                <div class="nbx-danger-zone">
                    <button type="button" class="btn btn-ghost btn-sm nbx-danger" id="nbx-del">${uiIcon('delete', 14)}<span>${escAttr(t('nbx.deleteSection'))}</span></button>
                    <span class="nbx-hint">${escAttr(t('nbx.deleteSectionHint'))}</span>
                </div>`;
            const name = pane.querySelector('#nbx-sect-name') as HTMLInputElement;
            name.addEventListener('input', () => {
                const c = load();
                c.groups[id] = { label: name.value.trim() };
                commit(c);
                const lbl = list.querySelector(`[data-id="${cssEsc(id)}"] .nbx-sect-label`);
                if (lbl) lbl.textContent = name.value.trim() || t('nbx.untitledSection');
            });
            pane.querySelector('#nbx-del')?.addEventListener('click', () => {
                const c = load();
                delete c.groups[id];
                c.order = orderedIds().filter((x) => x !== id);
                commit(c);
                sel = null; renderSide(); renderPane();
            });
            wireCommon(id);
            return;
        }
        const item = cfg.custom.find((c) => c.id === id);
        if (!item) {
            // One of BMM's own pages: rename, hide, move. Its icon and what it opens are BMM's.
            const orig = origLabel(id);
            const renamed = !!cfg.labels[id];
            pane.innerHTML = `${paneHead(builtinIcon(id), itemName(id, cfg), t('nbx.builtin'), t('nbx.builtinHint'))}
                <label class="nbx-field"><span class="nbx-label">${escAttr(t('nbx.name'))}</span>
                    <span class="nbx-inline">
                        <input class="input" id="nbx-name" maxlength="40" value="${escAttr(itemName(id, cfg))}" placeholder="${escAttr(orig)}">
                        <button type="button" class="btn btn-ghost btn-sm" id="nbx-name-reset" ${renamed ? '' : 'hidden'}>${uiIcon('reset', 14)}<span>${escAttr(t('nbx.nameReset'))}</span></button>
                    </span></label>
                ${visibleHtml(id, cfg)}
                ${orderHtml(id)}`;
            const name = pane.querySelector('#nbx-name') as HTMLInputElement;
            const resetBtn = pane.querySelector('#nbx-name-reset') as HTMLButtonElement;
            const setName = (v: string) => {
                const c = load();
                if (v && v !== orig) c.labels[id] = v; else delete c.labels[id];
                commit(c);
                resetBtn.hidden = !c.labels[id];
                const lbl = list.querySelector(`[data-id="${cssEsc(id)}"] .nbx-name`);
                if (lbl) lbl.textContent = v || orig;
                const title = pane.querySelector('.nbx-pane-title');
                if (title?.firstChild) title.firstChild.textContent = (v || orig) + ' ';
            };
            name.addEventListener('input', () => setName(name.value.trim()));
            resetBtn.addEventListener('click', () => { name.value = orig; setName(''); });
            wireCommon(id);
            return;
        }
        renderCustomPane(item, cfg);
    };

    // ── A custom button ────────────────────────────────────────────────────────
    const targetField = (kind: CustomNavItem['kind'], value: string): string => {
        if (kind === 'view') return `<select class="input" id="nbx-target">${builtinViewOptions(value)}</select>`;
        if (kind === 'modal') return `<select class="input" id="nbx-target">${modalActionOptions(value)}</select>`;
        if (kind === 'page') return `<select class="input" id="nbx-target">${pageOptions(value)}</select>`;
        return `<input class="input" id="nbx-target" type="url" inputmode="url" spellcheck="false" placeholder="https://example.com" value="${escAttr(value)}">
            <span class="nbx-hint" id="nbx-target-hint">${escAttr(t('nbx.urlHint'))}</span>`;
    };
    const kindCards = (current: CustomNavItem['kind'] | null, name: string) => `
        <div class="nbx-kinds" role="radiogroup" aria-label="${escAttr(t('nbx.opens'))}">
            ${KINDS.map((k) => `<label class="nbx-kind${k === current ? ' is-on' : ''}">
                <input type="radio" name="${name}" value="${k}" ${k === current ? 'checked' : ''}>
                <span class="nbx-kind-ic" aria-hidden="true">${uiIcon(KIND_ICON[k], 18)}</span>
                <span class="nbx-kind-text"><b>${escAttr(t(`nbx.kind.${k}`))}</b><span>${escAttr(t(`nbx.kind.${k}Hint`))}</span></span>
            </label>`).join('')}
        </div>`;

    const renderCustomPane = (item: CustomNavItem, cfg: NavbarConfig) => {
        const id = item.id;
        pane.innerHTML = `${paneHead(customIcon(item), item.label, t(`nbx.badge.${item.kind}`), t('nbx.customHint'))}
            <label class="nbx-field"><span class="nbx-label">${escAttr(t('nbx.name'))}</span>
                <input class="input" id="nbx-name" maxlength="40" value="${escAttr(item.label)}"></label>
            <div class="nbx-field">
                <span class="nbx-label">${escAttr(t('navedit.icon'))}</span>
                <div class="nbx-icon-row">
                    <span class="nbx-icon-now" id="nbx-icon-now" aria-hidden="true">${customIcon(item)}</span>
                    <button type="button" class="btn btn-ghost btn-sm" id="nbx-icon-toggle" aria-expanded="false">${escAttr(t('nbx.iconChange'))}</button>
                </div>
                <div id="nbx-icon-host" hidden></div>
            </div>
            <div class="nbx-field">
                <span class="nbx-label">${escAttr(t('nbx.opens'))}</span>
                ${kindCards(item.kind, 'nbx-kind')}
            </div>
            <label class="nbx-field" id="nbx-target-field"><span class="nbx-label">${escAttr(t(`nbx.target.${item.kind}`))}</span>
                <span class="nbx-target-wrap" id="nbx-target-wrap">${targetField(item.kind, item.target)}</span></label>
            <div id="nbx-page-block"></div>
            ${visibleHtml(id, cfg)}
            ${orderHtml(id)}
            <div class="nbx-danger-zone">
                <button type="button" class="btn btn-ghost btn-sm nbx-danger" id="nbx-del">${uiIcon('delete', 14)}<span>${escAttr(t('nbx.deleteButton'))}</span></button>
                ${item.kind === 'page' ? `<span class="nbx-hint">${escAttr(t('nbx.deleteButtonPageHint'))}</span>` : ''}
            </div>`;
        const update = (patch: Partial<CustomNavItem>) => {
            const c = load();
            const it = c.custom.find((x) => x.id === id);
            if (!it) return;
            Object.assign(it, patch);
            delete c.labels[id];
            commit(c);
            const row = list.querySelector(`[data-id="${cssEsc(id)}"]`);
            if (row) {
                const ic = row.querySelector('.nbx-ic'); if (ic) ic.innerHTML = customIcon(it);
                const nm = row.querySelector('.nbx-name'); if (nm) nm.textContent = it.label;
                const bd = row.querySelector('.nbx-badge'); if (bd) bd.textContent = t(`nbx.badge.${it.kind}`);
            }
            const head = pane.querySelector('.nbx-pane-ic'); if (head) head.innerHTML = customIcon(it);
            const now = pane.querySelector('#nbx-icon-now'); if (now) now.innerHTML = customIcon(it);
        };
        const name = pane.querySelector('#nbx-name') as HTMLInputElement;
        name.addEventListener('input', () => {
            const v = name.value.trim();
            if (!v) return;
            update({ label: v });
            const title = pane.querySelector('.nbx-pane-title');
            if (title?.firstChild) title.firstChild.textContent = v + ' ';
        });
        const iconHost = pane.querySelector('#nbx-icon-host') as HTMLElement;
        const iconBtn = pane.querySelector('#nbx-icon-toggle') as HTMLButtonElement;
        iconBtn.addEventListener('click', () => {
            const open = iconHost.hidden;
            iconHost.hidden = !open;
            iconBtn.setAttribute('aria-expanded', String(open));
            if (open && !iconHost.firstChild) mountIconPicker(iconHost, item.icon || '', (ref) => update({ icon: ref }));
        });
        const wireTarget = () => {
            const tgt = pane.querySelector('#nbx-target') as HTMLInputElement | HTMLSelectElement | null;
            if (!tgt) return;
            tgt.addEventListener('change', () => {
                const kind = (pane.querySelector('input[name="nbx-kind"]:checked') as HTMLInputElement | null)?.value as CustomNavItem['kind'] || item.kind;
                const v = tgt.value.trim();
                if (kind === 'url') {
                    const ok = /^https?:\/\/[^\s]+$/i.test(v);
                    pane.querySelector('#nbx-target-hint')?.classList.toggle('is-bad', !ok);
                    if (!ok) return;
                }
                if (!v) return;
                update({ kind, target: v });
                item.kind = kind; item.target = v;
                void renderPageBlock();
            });
        };
        wireTarget();
        pane.querySelectorAll<HTMLInputElement>('input[name="nbx-kind"]').forEach((r) => r.addEventListener('change', () => {
            const kind = r.value as CustomNavItem['kind'];
            pane.querySelectorAll('.nbx-kind').forEach((l) => l.classList.toggle('is-on', (l.querySelector('input') as HTMLInputElement).checked));
            const lbl = pane.querySelector('#nbx-target-field .nbx-label'); if (lbl) lbl.textContent = t(`nbx.target.${kind}`);
            (pane.querySelector('#nbx-target-wrap') as HTMLElement).innerHTML = targetField(kind, kind === item.kind ? item.target : '');
            wireTarget();
            // A select already holds a valid choice: take it. A URL waits for one.
            const tgt = pane.querySelector('#nbx-target') as HTMLInputElement | HTMLSelectElement | null;
            if (kind !== 'url' && tgt && tgt.value) tgt.dispatchEvent(new Event('change'));
            if (kind === 'page' && !_pagesCache.length) toast(t('nbx.noPagesYet'), 'warning');
        }));
        pane.querySelector('#nbx-del')?.addEventListener('click', async () => {
            if (!(await showConfirm(t('nbx.deleteButtonT'), t('nbx.deleteButtonD').replace('{name}', item.label)))) return;
            const c = load();
            c.custom = c.custom.filter((x) => x.id !== id);
            c.order = c.order.filter((x) => x !== id);
            delete c.labels[id]; delete c.hidden[id];
            commit(c);
            sel = null; renderSide(); renderPane();
        });
        wireCommon(id);

        // The page this button opens: its permissions, its code, a look at it.
        const renderPageBlock = async () => {
            const host = pane.querySelector('#nbx-page-block') as HTMLElement | null;
            if (!host) return;
            if (item.kind !== 'page' || !item.target) { host.innerHTML = ''; return; }
            await mountPermissions(host, item.target, { intro: true });
            const actions = document.createElement('div');
            actions.className = 'nbx-inline nbx-page-actions';
            actions.innerHTML = `
                <button type="button" class="btn btn-secondary btn-sm" id="nbx-edit-code">${uiIcon('code', 14)}<span>${escAttr(t('nbx.editCode'))}</span></button>
                <button type="button" class="btn btn-ghost btn-sm" id="nbx-preview-btn">${uiIcon('eye', 14)}<span>${escAttr(t('nbx.preview'))}</span></button>`;
            host.prepend(actions);
            const prevHost = document.createElement('div');
            prevHost.className = 'nbx-preview-host';
            prevHost.hidden = true;
            actions.after(prevHost);
            actions.querySelector('#nbx-edit-code')?.addEventListener('click', () => { codePageId = item.target; view = 'code'; renderPane(); });
            actions.querySelector('#nbx-preview-btn')?.addEventListener('click', () => {
                prevHost.hidden = !prevHost.hidden;
                if (prevHost.hidden) prevHost.innerHTML = '';
                else mountPreview(prevHost, item.target);
            });
        };
        void renderPageBlock();
    };

    // ── Permissions (one page) ─────────────────────────────────────────────────
    //
    // A switch per permission, each with what it lets the page do and how much that exposes.
    // Nothing here is on unless the backend says it is; an imported page waiting for its
    // review says so and holds nothing (page_apply_reviewed_grants decides what it gets).
    const mountPermissions = async (host: HTMLElement, pageId: string, opts: { intro?: boolean } = {}) => {
        let grants = new Set<string>();
        let origins: string[] = [];
        let review: { source?: string; requested?: string[]; requestedOrigins?: string[] } = {};
        try { grants = new Set((await invoke('page_grants_get', { id: pageId })) as string[]); } catch { /* deny */ }
        try { origins = (await invoke('page_net_origins_get', { id: pageId })) as string[]; } catch { /* none */ }
        try { review = (await invoke('page_grant_review_get', { id: pageId })) as typeof review; } catch { /* none */ }
        const pending = review.source === 'import-pending';
        host.innerHTML = `
            <div class="nbx-perms">
                <div class="nbx-perms-head">
                    <span class="nbx-pane-ic nbx-pane-ic--sm" aria-hidden="true">${uiIcon('shield-check', 16)}</span>
                    <div><b>${escAttr(t('nbx.permsTitle'))}</b>${opts.intro ? `<p>${escAttr(t('nbx.permsIntro'))}</p>` : ''}</div>
                </div>
                ${pending ? `<div class="nbx-note nbx-note--warn">${escAttr(t('navedit.reviewPending'))} <button type="button" class="btn btn-xs btn-secondary" id="nbx-review">${escAttr(t('navedit.reviewBtn'))}</button></div>`
                    : review.source === 'import-review' ? `<div class="nbx-note">${escAttr(t('navedit.reviewedNote'))}</div>` : ''}
                <div class="nbx-perm-list">
                    ${CAPS.map(({ cap, risk }) => `<label class="nbx-perm">
                        <span class="nbx-perm-text"><b>${escAttr(capLabel(cap))}</b><span>${escAttr(capRisk(cap))}</span></span>
                        <span class="nbx-risk nbx-risk--${risk}">${escAttr(t(RISK_KEY[risk]))}</span>
                        ${switchHtml(`data-cap="${cap}"`, grants.has(cap), pending)}
                    </label>
                    ${cap === 'network' ? `<label class="nbx-field nbx-origins" ${grants.has('network') ? '' : 'hidden'}>
                        <span class="nbx-label">${escAttr(t('nbx.origins'))}</span>
                        <textarea class="input" id="nbx-origins" rows="2" spellcheck="false" placeholder="https://api.example.com">${escAttr(origins.join('\n'))}</textarea>
                        <span class="nbx-hint">${escAttr(t('nbx.originsHint'))}</span>
                    </label>` : ''}`).join('')}
                </div>
                <div class="nbx-presets" ${pending ? 'hidden' : ''}>
                    <span class="nbx-label">${escAttr(t('nbx.quickSet'))}</span>
                    <button type="button" class="nbx-chip" data-preset="none" data-tooltip="${escAttr(t('nbx.presetNoneTip'))}">${escAttr(t('nbx.presetNone'))}</button>
                    <button type="button" class="nbx-chip" data-preset="local" data-tooltip="${escAttr(t('nbx.presetLocalTip'))}">${escAttr(t('nbx.presetLocal'))}</button>
                    <button type="button" class="nbx-chip" data-preset="online" data-tooltip="${escAttr(t('nbx.presetOnlineTip'))}">${escAttr(t('nbx.presetOnline'))}</button>
                </div>
            </div>`;
        const setCap = async (cap: string, on: boolean) => {
            await invoke('page_set_grant', { id: pageId, cap, granted: on });
            await refreshGrants(pageId);      // the broker sees the change at once
        };
        host.querySelectorAll<HTMLInputElement>('input[data-cap]').forEach((cb) => cb.addEventListener('change', async () => {
            try {
                await setCap(cb.dataset.cap!, cb.checked);
                if (cb.dataset.cap === 'network') (host.querySelector('.nbx-origins') as HTMLElement).hidden = !cb.checked;
            } catch (err) { cb.checked = !cb.checked; toast(String(err), 'error'); }
        }));
        host.querySelector('#nbx-origins')?.addEventListener('change', async (e) => {
            const raw = (e.target as HTMLTextAreaElement).value;
            const list2 = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
            try { await invoke('page_set_net_origins', { id: pageId, origins: list2 }); }
            catch (err) { toast(String(err), 'error'); }
        });
        host.querySelectorAll<HTMLElement>('[data-preset]').forEach((b) => b.addEventListener('click', async () => {
            const want = new Set(PRESETS[b.dataset.preset!] || []);
            try {
                for (const { cap } of CAPS) await invoke('page_set_grant', { id: pageId, cap, granted: want.has(cap) });
                await refreshGrants(pageId);
                await mountPermissions(host, pageId, opts);
            } catch (err) { toast(String(err), 'error'); }
        }));
        host.querySelector('#nbx-review')?.addEventListener('click', async () => {
            try {
                const r = (await invoke('page_grant_review_get', { id: pageId })) as { requested?: string[]; requestedOrigins?: string[] };
                const p = { id: pageId, name: _pagesCache.find((x) => x.id === pageId)?.name || pageId, requested: r.requested || [], requestedOrigins: r.requestedOrigins || [], unknown: [] };
                const ans = reviewAnswer(p, (await openGrantReview([p])).get(pageId));
                await invoke('page_apply_reviewed_grants', { id: pageId, caps: ans.caps, origins: ans.origins });
                await refreshGrants(pageId);
                await mountPermissions(host, pageId, opts);
            } catch (err) { toast(String(err), 'error'); }
        });
    };

    /** The page running in its sandbox: the same iframe attributes as its view in the app,
     *  so what you see here is what the button will show. The broker serves it by its
     *  data-page-id, with exactly the page's own permissions. */
    const mountPreview = (host: HTMLElement, pageId: string) => {
        void refreshGrants(pageId);
        host.innerHTML = `
            <div class="nbx-preview-bar">
                <span class="nbx-hint">${uiIcon('lock', 14)} ${escAttr(t('nbx.previewNote'))}</span>
                <button type="button" class="btn btn-ghost btn-xs" data-reload>${uiIcon('refresh', 14)}<span>${escAttr(t('nbx.reload'))}</span></button>
            </div>
            <iframe class="custom-page-frame nbx-preview-frame" referrerpolicy="no-referrer"
                sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
                data-page-id="${escAttr(pageId)}" src="${escAttr(pageBundleUrl(pageId))}" title="${escAttr(t('nbx.preview'))}"></iframe>`;
        host.querySelector('[data-reload]')?.addEventListener('click', () => {
            const f = host.querySelector('iframe') as HTMLIFrameElement | null;
            if (!f) return;
            f.setAttribute('src', 'about:blank');
            setTimeout(() => f.setAttribute('src', pageBundleUrl(pageId)), 30);
        });
    };

    // ── « Add a button »: the guided flow ──────────────────────────────────────
    interface Draft { step: number; kind: CustomNavItem['kind'] | null; name: string; icon: string; target: string; tpl: number; existing: string; caps: Set<string> }
    let wiz: Draft = { step: 0, kind: null, name: '', icon: '', target: '', tpl: 0, existing: '', caps: new Set() };
    const stepsFor = (k: Draft['kind']): string[] => k === 'page' ? ['kind', 'details', 'start', 'perms', 'preview'] : ['kind', 'details'];
    const startWizard = () => {
        wiz = { step: 0, kind: null, name: '', icon: '', target: '', tpl: 0, existing: '', caps: new Set() };
        view = 'wizard';
        list.querySelectorAll('.nbx-row.is-sel').forEach((r) => { r.classList.remove('is-sel'); r.setAttribute('aria-selected', 'false'); });
        renderPane();
    };
    const dropDraft = async () => {
        if (!draftPageId) return;
        const id = draftPageId;
        draftPageId = null;
        try { await invoke('delete_custom_page', { id }); } catch { /* already gone */ }
    };
    const leaveWizard = async () => {
        await dropDraft();
        view = 'details';
        renderSide(); renderPane();
    };

    const renderWizard = () => {
        const steps = stepsFor(wiz.kind);
        const stepId = steps[wiz.step];
        const last = wiz.step === steps.length - 1;
        const stepper = `<ol class="nbx-stepper" aria-label="${escAttr(t('nbx.steps'))}">
            ${steps.map((s, i) => `<li class="${i === wiz.step ? 'is-now' : i < wiz.step ? 'is-done' : ''}"${i === wiz.step ? ' aria-current="step"' : ''}>
                <span class="nbx-step-dot">${i < wiz.step ? uiIcon('check', 12) : String(i + 1)}</span><span class="nbx-step-name">${escAttr(t(`nbx.step.${s}`))}</span></li>`).join('')}
        </ol>`;
        let body = '';
        if (stepId === 'kind') {
            body = `<h3 class="nbx-q">${escAttr(t('nbx.qKind'))}</h3>${kindCards(wiz.kind, 'nbx-wkind')}`;
        } else if (stepId === 'details') {
            body = `<h3 class="nbx-q">${escAttr(t('nbx.qDetails'))}</h3>
                <div class="nbx-wiz-preview" aria-hidden="true"><span class="nbx-ic" id="nbx-w-ic">${iconHtml(wiz.icon) || uiIcon(KIND_ICON[wiz.kind!], 18)}</span><span class="nbx-name" id="nbx-w-name">${escAttr(wiz.name || t('nbx.namePh'))}</span></div>
                <label class="nbx-field"><span class="nbx-label">${escAttr(t('nbx.name'))}</span>
                    <input class="input" id="nbx-w-label" maxlength="40" value="${escAttr(wiz.name)}" placeholder="${escAttr(t('nbx.namePh'))}"></label>
                ${wiz.kind !== 'page' ? `<label class="nbx-field"><span class="nbx-label">${escAttr(t(`nbx.target.${wiz.kind}`))}</span>
                    <span class="nbx-target-wrap">${targetField(wiz.kind!, wiz.target)}</span></label>` : ''}
                ${wiz.kind === 'url' ? `<div class="nbx-note">${uiIcon('lock', 14)} ${escAttr(t('nbx.urlSandbox'))}</div>` : ''}
                <div class="nbx-field"><span class="nbx-label">${escAttr(t('navedit.icon'))}</span><div id="nbx-w-icons"></div></div>`;
        } else if (stepId === 'start') {
            body = `<h3 class="nbx-q">${escAttr(t('nbx.qStart'))}</h3>
                <div class="nbx-tpls" role="radiogroup" aria-label="${escAttr(t('navedit.pageTemplate'))}">
                    ${PAGE_TEMPLATES.map((tpl, i) => {
                        const info = TPL_INFO[tpl.labelKey] || { desc: '', caps: [], icon: 'file' as IconName };
                        const on = !wiz.existing && wiz.tpl === i;
                        return `<label class="nbx-tpl${on ? ' is-on' : ''}">
                            <input type="radio" name="nbx-tpl" value="${i}" ${on ? 'checked' : ''}>
                            <span class="nbx-kind-ic" aria-hidden="true">${uiIcon(info.icon, 18)}</span>
                            <span class="nbx-kind-text"><b>${escAttr(t(tpl.labelKey) || tpl.label)}</b><span>${escAttr(info.desc ? t(info.desc) : '')}</span>
                            ${info.caps.length ? `<span class="nbx-tpl-caps">${info.caps.map((c) => `<span class="nbx-badge">${escAttr(capLabel(c))}</span>`).join('')}</span>` : `<span class="nbx-tpl-caps"><span class="nbx-badge">${escAttr(t('nbx.noPerm'))}</span></span>`}</span>
                        </label>`;
                    }).join('')}
                </div>
                ${_pagesCache.filter((p) => p.id !== draftPageId).length ? `<label class="nbx-field nbx-existing"><span class="nbx-label">${escAttr(t('nbx.orExisting'))}</span>
                    <select class="input" id="nbx-w-existing"><option value="">${escAttr(t('nbx.newPage'))}</option>${_pagesCache.filter((p) => p.id !== draftPageId).map((p) => `<option value="${escAttr(p.id)}" ${p.id === wiz.existing ? 'selected' : ''}>${escAttr(p.name)}</option>`).join('')}</select></label>` : ''}
                <p class="nbx-hint">${escAttr(t('nbx.startHint'))}</p>`;
        } else if (stepId === 'perms') {
            const tpl = PAGE_TEMPLATES[wiz.tpl] || PAGE_TEMPLATES[0];
            const uses = (TPL_INFO[tpl.labelKey]?.caps || []);
            body = `<h3 class="nbx-q">${escAttr(t('nbx.qPerms'))}</h3>
                <p class="nbx-lead">${escAttr(t('nbx.permsIntro'))}</p>
                ${uses.length ? `<div class="nbx-note">${uiIcon('lightbulb', 14)} <span>${escAttr(t('nbx.tplUses').replace('{perms}', uses.map(capLabel).join(', ')))}</span>
                    <button type="button" class="btn btn-xs btn-secondary" id="nbx-w-suggest">${escAttr(t('nbx.turnOn'))}</button></div>` : `<div class="nbx-note">${uiIcon('success', 14)} <span>${escAttr(t('nbx.tplNoPerm'))}</span></div>`}
                <div class="nbx-perm-list">
                    ${CAPS.map(({ cap, risk }) => `<label class="nbx-perm">
                        <span class="nbx-perm-text"><b>${escAttr(capLabel(cap))}</b><span>${escAttr(capRisk(cap))}</span></span>
                        <span class="nbx-risk nbx-risk--${risk}">${escAttr(t(RISK_KEY[risk]))}</span>
                        ${switchHtml(`data-wcap="${cap}"`, wiz.caps.has(cap))}
                    </label>`).join('')}
                </div>
                ${wiz.caps.has('network') ? `<p class="nbx-hint">${escAttr(t('nbx.originsLater'))}</p>` : ''}`;
        } else if (stepId === 'preview') {
            body = `<h3 class="nbx-q">${escAttr(t('nbx.qPreview'))}</h3>
                <p class="nbx-lead">${escAttr(t('nbx.previewLead'))}</p>
                <div class="nbx-preview-host" id="nbx-w-preview"><p class="nbx-hint">${escAttr(t('common.loading'))}</p></div>`;
        }
        pane.innerHTML = `
            <div class="nbx-wiz">
                <div class="nbx-wiz-top">
                    <span class="nbx-wiz-title">${uiIcon('add', 16)} ${escAttr(t('navedit.addBtn'))}</span>
                    ${stepper}
                </div>
                <div class="nbx-wiz-body">${body}</div>
                <div class="nbx-wiz-foot">
                    <button type="button" class="btn btn-ghost btn-sm" id="nbx-w-cancel">${escAttr(t('common.cancel'))}</button>
                    <span class="nbx-grow"></span>
                    ${wiz.step > 0 ? `<button type="button" class="btn btn-ghost btn-sm" id="nbx-w-back">${uiIcon('chevron-left', 14)}<span>${escAttr(t('nbx.back'))}</span></button>` : ''}
                    <button type="button" class="btn btn-primary btn-sm" id="nbx-w-next" ${stepId === 'kind' && !wiz.kind ? 'disabled' : ''}>${last ? `${uiIcon('check', 14)}<span>${escAttr(t('nbx.create'))}</span>` : `<span>${escAttr(t('nbx.next'))}</span>${uiIcon('chevron-right', 14)}`}</button>
                </div>
            </div>`;

        const next = pane.querySelector('#nbx-w-next') as HTMLButtonElement;
        pane.querySelector('#nbx-w-cancel')?.addEventListener('click', () => void leaveWizard());
        pane.querySelector('#nbx-w-back')?.addEventListener('click', () => { wiz.step--; renderWizard(); });

        if (stepId === 'kind') {
            pane.querySelectorAll<HTMLInputElement>('input[name="nbx-wkind"]').forEach((r) => r.addEventListener('change', () => {
                wiz.kind = r.value as CustomNavItem['kind'];
                wiz.target = '';
                if (!wiz.icon || Object.values(KIND_ICON).some((n) => wiz.icon === 'ui:' + n)) wiz.icon = 'ui:' + KIND_ICON[wiz.kind];
                renderWizard();     // the steps differ for « My own page »
            }));
        }
        if (stepId === 'details') {
            const label = pane.querySelector('#nbx-w-label') as HTMLInputElement;
            const tgt = pane.querySelector('#nbx-target') as HTMLInputElement | HTMLSelectElement | null;
            // A tab or a tool names the button until you type a name of your own.
            const autoName = () => (tgt instanceof HTMLSelectElement ? tgt.options[tgt.selectedIndex]?.textContent?.trim() || '' : '');
            const syncName = () => {
                const own = label.value.trim();
                const auto = autoName();
                wiz.name = own || auto;
                label.placeholder = auto || t('nbx.namePh');
                (pane.querySelector('#nbx-w-name') as HTMLElement).textContent = wiz.name || t('nbx.namePh');
            };
            label.addEventListener('input', syncName);
            if (tgt) {
                const sync = () => { wiz.target = tgt.value.trim(); syncName(); };
                tgt.addEventListener('change', sync);
                tgt.addEventListener('input', sync);
                if (tgt instanceof HTMLSelectElement && wiz.target) tgt.value = wiz.target;
                sync();
            }
            mountIconPicker(pane.querySelector('#nbx-w-icons') as HTMLElement, wiz.icon, (ref) => {
                wiz.icon = ref;
                (pane.querySelector('#nbx-w-ic') as HTMLElement).innerHTML = iconHtml(ref) || uiIcon(KIND_ICON[wiz.kind!], 18);
            });
            label.focus();
        }
        if (stepId === 'start') {
            pane.querySelectorAll<HTMLInputElement>('input[name="nbx-tpl"]').forEach((r) => r.addEventListener('change', () => {
                wiz.tpl = parseInt(r.value, 10) || 0;
                wiz.existing = '';
                const ex = pane.querySelector('#nbx-w-existing') as HTMLSelectElement | null; if (ex) ex.value = '';
                pane.querySelectorAll('.nbx-tpl').forEach((l) => l.classList.toggle('is-on', (l.querySelector('input') as HTMLInputElement).checked));
            }));
            pane.querySelector('#nbx-w-existing')?.addEventListener('change', (e) => {
                wiz.existing = (e.target as HTMLSelectElement).value;
                pane.querySelectorAll<HTMLInputElement>('input[name="nbx-tpl"]').forEach((r) => { r.checked = !wiz.existing && parseInt(r.value, 10) === wiz.tpl; });
                pane.querySelectorAll('.nbx-tpl').forEach((l) => l.classList.toggle('is-on', (l.querySelector('input') as HTMLInputElement).checked));
                next.innerHTML = wiz.existing ? `${uiIcon('check', 14)}<span>${escAttr(t('nbx.create'))}</span>` : `<span>${escAttr(t('nbx.next'))}</span>${uiIcon('chevron-right', 14)}`;
            });
        }
        if (stepId === 'perms') {
            pane.querySelectorAll<HTMLInputElement>('input[data-wcap]').forEach((cb) => cb.addEventListener('change', () => {
                if (cb.checked) wiz.caps.add(cb.dataset.wcap!); else wiz.caps.delete(cb.dataset.wcap!);
            }));
            pane.querySelector('#nbx-w-suggest')?.addEventListener('click', () => {
                const tpl = PAGE_TEMPLATES[wiz.tpl] || PAGE_TEMPLATES[0];
                for (const c of TPL_INFO[tpl.labelKey]?.caps || []) wiz.caps.add(c);
                renderWizard();
            });
        }
        if (stepId === 'preview') void buildDraft();

        next.addEventListener('click', async () => {
            if (stepId === 'details') {
                const name = wiz.name.trim();
                if (!name) { toast(t('nbx.needName'), 'warning'); (pane.querySelector('#nbx-w-label') as HTMLInputElement)?.focus(); return; }
                if (wiz.kind === 'url' && !/^https?:\/\/[^\s]+$/i.test(wiz.target)) {
                    pane.querySelector('#nbx-target-hint')?.classList.add('is-bad');
                    toast(t('navedit.urlNeedsHttp'), 'warning');
                    return;
                }
                if (wiz.kind !== 'page' && !wiz.target) { toast(t('nbx.needTarget'), 'warning'); return; }
            }
            if (stepId === 'start' && wiz.existing) { finish(wiz.existing); return; }
            if (last) { if (wiz.kind === 'page') { if (draftPageId) finish(draftPageId); } else finish(wiz.target); return; }
            wiz.step++;
            renderWizard();
        });
    };

    /** The page exists from the preview step on, holding exactly the permissions switched on
     *  in the step before; Cancel deletes it. Going back and forth updates the same page. */
    const buildDraft = async () => {
        const host = pane.querySelector('#nbx-w-preview') as HTMLElement | null;
        const tpl = PAGE_TEMPLATES[wiz.tpl] || PAGE_TEMPLATES[0];
        try {
            if (draftPageId) {
                await invoke('update_custom_page', { id: draftPageId, name: wiz.name.trim(), html: tpl.html, css: tpl.css, js: tpl.js });
            } else {
                const meta = await invoke('create_custom_page', { name: wiz.name.trim(), html: tpl.html, css: tpl.css, js: tpl.js }) as PageMeta;
                draftPageId = meta.id;
            }
            for (const { cap } of CAPS) await invoke('page_set_grant', { id: draftPageId, cap, granted: wiz.caps.has(cap) });
            await refreshGrants(draftPageId!);
            if (host && host.isConnected) mountPreview(host, draftPageId!);
        } catch (err) {
            if (host) host.innerHTML = `<div class="nbx-note nbx-note--warn">${escAttr(String(err))}</div>`;
            const nxt = pane.querySelector('#nbx-w-next') as HTMLButtonElement | null;
            if (nxt) nxt.disabled = true;
        }
    };

    const finish = (target: string) => {
        const cfg = load();
        const id = 'custom:' + Math.random().toString(36).slice(2, 9);
        cfg.custom.push({ id, label: wiz.name.trim() || target, kind: wiz.kind!, target, icon: wiz.icon || 'ui:' + KIND_ICON[wiz.kind!] });
        // A new button goes at the end of the sidebar; drag it where it belongs.
        cfg.order = orderedIds();
        commit(cfg);
        if (wiz.icon) rememberIcon(wiz.icon);
        if (target === draftPageId) draftPageId = null;     // it belongs to a button now
        sel = id; view = 'details';
        renderSide(); renderPane();
        (list.querySelector(`[data-id="${cssEsc(id)}"]`) as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
        toast(t('nbx.added').replace('{name}', wiz.name.trim() || target), 'success');
    };

    // ── A page's code ──────────────────────────────────────────────────────────
    //
    // HTML, CSS and JS of the page a button opens, its other documents and its files. The CSS
    // and JS boxes belong to the whole bundle; the HTML box shows one document at a time
    // (null = the page's own index). Saving drops any open view of the page so it reloads.
    const renderCode = async (pageId: string) => {
        let src: { name: string; html: string; css: string; js: string };
        try { src = await invoke('get_custom_page_source', { id: pageId }) as typeof src; }
        catch (err) { toast(String(err), 'error'); view = 'details'; renderPane(); return; }
        let editingDoc: string | null = null;
        const owner = load().custom.find((c) => c.kind === 'page' && c.target === pageId);
        pane.innerHTML = `
            <div class="nbx-code">
                <div class="nbx-code-top">
                    <button type="button" class="btn btn-ghost btn-sm" id="nbx-code-back">${uiIcon('chevron-left', 14)}<span>${escAttr(owner ? owner.label : t('nbx.back'))}</span></button>
                    <span class="nbx-grow"></span>
                    <button type="button" class="btn btn-ghost btn-sm" id="nbx-code-preview">${uiIcon('eye', 14)}<span>${escAttr(t('nbx.saveAndPreview'))}</span></button>
                    <button type="button" class="btn btn-primary btn-sm" id="nbe-page-create">${uiIcon('save', 14)}<span>${escAttr(t('navedit.save'))}</span></button>
                </div>
                <label class="nbx-field"><span class="nbx-label">${escAttr(t('navedit.pageName'))}</span>
                    <input class="input" id="nbe-page-name" maxlength="60" value="${escAttr(src.name)}"></label>
                <div class="nbx-field">
                    <span class="nbx-label">${escAttr(t('navedit.subpages'))}</span>
                    <p class="nbx-hint">${escAttr(t('navedit.subpagesHint'))}</p>
                    <div id="nbe-subpages-list" class="nbe-subpages-list"></div>
                    <div class="nbe-subpage-add">
                        <input class="input" id="nbe-subpage-slug" placeholder="${escAttr(t('navedit.subpageSlug'))}">
                        <input class="input" id="nbe-subpage-title" placeholder="${escAttr(t('navedit.subpageTitle'))}">
                        <button type="button" class="btn btn-xs" id="nbe-subpage-add">${escAttr(t('common.add'))}</button>
                    </div>
                </div>
                <label class="nbx-field"><span class="nbx-label">HTML</span>
                    <textarea class="input nbe-code" id="nbe-page-html" rows="9" spellcheck="false"></textarea></label>
                <label class="nbx-field"><span class="nbx-label">CSS</span>
                    <textarea class="input nbe-code" id="nbe-page-css" rows="6" spellcheck="false"></textarea></label>
                <label class="nbx-field"><span class="nbx-label">JS <span class="nbx-hint">${escAttr(t('navedit.jsNote'))}</span></span>
                    <textarea class="input nbe-code" id="nbe-page-js" rows="8" spellcheck="false"></textarea></label>
                <div class="nbx-field">
                    <span class="nbx-label">${escAttr(t('navedit.pagefiles'))}</span>
                    <p class="nbx-hint">${escAttr(t('navedit.pagefilesHint'))}</p>
                    <div id="nbe-pagefiles-list" class="nbe-pagefiles-list"></div>
                    <div class="nbe-pagefile-add">
                        <input class="input" id="nbe-pagefile-dest" placeholder="${escAttr(t('navedit.pagefileDest'))}">
                        <button type="button" class="btn btn-xs" id="nbe-pagefile-add">${escAttr(t('navedit.addFiles'))}</button>
                        <button type="button" class="btn btn-xs" id="nbe-pagedir-add">${escAttr(t('navedit.addFolder'))}</button>
                    </div>
                </div>
                <div class="nbx-preview-host" id="nbx-code-prev" hidden></div>
            </div>`;
        const field = (sel2: string) => pane.querySelector(sel2) as HTMLInputElement & HTMLTextAreaElement;
        field('#nbe-page-html').value = src.html;
        field('#nbe-page-css').value = src.css;
        field('#nbe-page-js').value = src.js;
        // Syntax colours, attached once the boxes are in the document (the mirror copies the
        // live box's metrics). Assigning .value fires no event, so every fill repaints.
        const hl: Record<string, CodeEditorHandle | null> = {
            html: attachHighlight(pane.querySelector('#nbe-page-html'), 'markup'),
            css: attachHighlight(pane.querySelector('#nbe-page-css'), 'css'),
            js: attachHighlight(pane.querySelector('#nbe-page-js'), 'javascript'),
        };
        const repaintCode = () => { hl.html?.refresh(); hl.css?.refresh(); hl.js?.refresh(); };
        repaintCode();
        // Tab inserts a tab in the code boxes; Escape still leaves for keyboard users.
        pane.querySelectorAll('.nbe-code').forEach((ta) => ta.addEventListener('keydown', (e) => {
            const ev = e as KeyboardEvent;
            if (ev.key !== 'Tab') return;
            ev.preventDefault();
            const el = ta as HTMLTextAreaElement;
            const s = el.selectionStart, epos = el.selectionEnd;
            el.value = el.value.slice(0, s) + '\t' + el.value.slice(epos);
            el.selectionStart = el.selectionEnd = s + 1;
        }));

        const subList = pane.querySelector('#nbe-subpages-list') as HTMLElement;
        const persistCurrentDoc = async () => {
            if (!editingDoc) return;   // the index is saved by Save
            const cur = (await invoke('list_page_docs', { id: pageId }) as { slug: string; title: string }[]).find((d) => d.slug === editingDoc);
            await invoke('save_page_doc', { id: pageId, slug: editingDoc, title: cur?.title || editingDoc, html: field('#nbe-page-html').value });
        };
        const renderSubpages = async () => {
            let docs: { slug: string; title: string }[] = [];
            try { docs = await invoke('list_page_docs', { id: pageId }) as typeof docs; } catch { docs = []; }
            const chip = (slug: string | null, label: string) =>
                `<button type="button" class="nbe-subpage${editingDoc === slug ? ' is-current' : ''}" data-doc="${slug === null ? '' : escAttr(slug)}">${escAttr(label)}</button>`;
            subList.innerHTML = chip(null, t('navedit.mainDoc'))
                + docs.map((d) => chip(d.slug, d.title) + `<button type="button" class="nbe-subpage-del" data-deldoc="${escAttr(d.slug)}" aria-label="${escAttr(t('common.delete'))}">${uiIcon('close', 12)}</button>`).join('');
        };
        subList.addEventListener('click', async (e) => {
            const del = (e.target as HTMLElement).closest('[data-deldoc]') as HTMLElement | null;
            const doc = (e.target as HTMLElement).closest('[data-doc]') as HTMLElement | null;
            try {
                if (del) {
                    const slug = del.dataset.deldoc!;
                    if (!(await showConfirm(t('navedit.subpageDelT'), t('navedit.subpageDelD')))) return;
                    await invoke('delete_page_doc', { id: pageId, slug });
                    if (editingDoc === slug) {
                        field('#nbe-page-html').value = (await invoke('get_custom_page_source', { id: pageId }) as { html: string }).html;
                        editingDoc = null; repaintCode();
                    }
                    await renderSubpages();
                } else if (doc) {
                    const slug = doc.dataset.doc || null;
                    if (slug === editingDoc) return;
                    // Save what is on screen before switching: a tab strip must not lose typing.
                    await persistCurrentDoc();
                    field('#nbe-page-html').value = slug
                        ? (await invoke('get_page_doc', { id: pageId, slug }) as { html: string }).html
                        : (await invoke('get_custom_page_source', { id: pageId }) as { html: string }).html;
                    editingDoc = slug; repaintCode();
                    await renderSubpages();
                }
            } catch (err) { toast(String(err), 'error'); }
        });
        pane.querySelector('#nbe-subpage-add')?.addEventListener('click', async () => {
            const slugEl = field('#nbe-subpage-slug');
            const titleEl = field('#nbe-subpage-title');
            const slug = slugEl.value.trim();
            if (!slug) { toast(t('navedit.subpageSlug'), 'warning'); return; }
            try {
                await persistCurrentDoc();
                const title = titleEl.value.trim() || slug;
                // A starting document with the link back: the part only missed once you are lost.
                await invoke('save_page_doc', { id: pageId, slug, title, html: `<p><a href="index.html">← ${escAttr(t('navedit.backToMain'))}</a></p>\n<h1>${escAttr(title)}</h1>` });
                slugEl.value = ''; titleEl.value = '';
                const d = await invoke('get_page_doc', { id: pageId, slug }) as { html: string; slug: string };
                field('#nbe-page-html').value = d.html;
                editingDoc = d.slug; repaintCode();
                await renderSubpages();
            } catch (err) { toast(String(err), 'error'); }
        });

        const filesList = pane.querySelector('#nbe-pagefiles-list') as HTMLElement;
        const kb = (n: number) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
        const renderPageFiles = async () => {
            let files: { path: string; bytes: number; reserved: boolean }[] = [];
            try { files = await invoke('list_page_files', { id: pageId }) as typeof files; } catch { files = []; }
            filesList.innerHTML = files.length ? files.map((f2) => `
                <div class="nbe-pagefile${f2.reserved ? ' is-reserved' : ''}">
                    <span class="nbe-pagefile-path" title="${escAttr(f2.path)}">${escAttr(f2.path)}</span>
                    <span class="nbe-pagefile-size">${escAttr(kb(f2.bytes))}</span>
                    ${f2.reserved
                        ? `<span class="nbe-pagefile-lock" title="${escAttr(t('navedit.pagefileOwn'))}">${uiIcon('lock', 12)}</span>`
                        : `<button type="button" class="nbe-pagefile-del" data-delfile="${escAttr(f2.path)}" aria-label="${escAttr(t('common.delete'))}">${uiIcon('close', 12)}</button>`}
                </div>`).join('') : `<div class="nbx-hint">${escAttr(t('navedit.pagefilesNone'))}</div>`;
        };
        filesList.addEventListener('click', async (e) => {
            const b = (e.target as HTMLElement).closest('[data-delfile]') as HTMLElement | null;
            if (!b) return;
            const rel = b.dataset.delfile!;
            if (!(await showConfirm(t('navedit.pagefileDelT'), rel + ' — ' + t('navedit.pagefileDelD')))) return;
            try { await invoke('delete_page_file', { id: pageId, rel }); await renderPageFiles(); }
            catch (err) { toast(String(err), 'error'); }
        });
        pane.querySelector('#nbe-pagefile-add')?.addEventListener('click', async () => {
            const dest = field('#nbe-pagefile-dest').value.trim();
            try {
                const paths = await pickFiles();
                if (!paths.length) return;
                let ok = 0; const failed: string[] = [];
                for (const p of paths) {
                    const base = String(p).split(/[\\/]/).pop() || 'asset';
                    try { await invoke('import_page_path', { id: pageId, srcPath: p, destRel: dest ? `${dest}/${base}` : base }); ok++; }
                    catch (err) { failed.push(base + ': ' + String(err)); }
                }
                // Per file: a silent partial import sends somebody debugging CSS for a missing picture.
                toast(failed.length ? `${ok} ${t('navedit.imported')}, ${failed.length} ${t('navedit.skipped')} — ${failed[0]}` : `${ok} ${t('navedit.imported')}`, failed.length ? 'warning' : 'success');
                await renderPageFiles();
            } catch (err) { toast(String(err), 'error'); }
        });
        pane.querySelector('#nbe-pagedir-add')?.addEventListener('click', async () => {
            const dest = field('#nbe-pagefile-dest').value.trim();
            try {
                const dir = await pickFolder();
                if (!dir) return;
                const rep = await invoke('import_page_dir', { id: pageId, srcDir: dir, destRel: dest }) as { copied: string[]; skipped: string[]; bytes: number };
                toast(`${rep.copied.length} ${t('navedit.imported')} (${kb(rep.bytes)})` + (rep.skipped.length ? `, ${rep.skipped.length} ${t('navedit.skipped')}` : ''), rep.skipped.length ? 'warning' : 'success');
                await renderPageFiles();
            } catch (err) { toast(String(err), 'error'); }
        });

        const savePage = async (): Promise<boolean> => {
            const name = field('#nbe-page-name').value.trim();
            if (!name) { toast(t('navedit.pageName'), 'warning'); return false; }
            try {
                const css = field('#nbe-page-css').value;
                const js = field('#nbe-page-js').value;
                if (editingDoc) {
                    // The HTML box shows a sub-document: its markup goes to that document; the
                    // name, CSS and JS still belong to the bundle.
                    await persistCurrentDoc();
                    const html = (await invoke('get_custom_page_source', { id: pageId }) as { html: string }).html;
                    await invoke('update_custom_page', { id: pageId, name, html, css, js });
                } else {
                    await invoke('update_custom_page', { id: pageId, name, html: field('#nbe-page-html').value, css, js });
                }
                // An open view caches the old bundle: drop it so the next visit reloads.
                document.querySelectorAll(`.custom-page-frame[data-page-id="${cssEsc(pageId)}"]`).forEach((f) => (f.closest('.view') as HTMLElement | null)?.remove());
                await loadPages();
                toast(t('navedit.pageSaved'), 'success');
                return true;
            } catch (err) { toast(String(err), 'error'); return false; }
        };
        pane.querySelector('#nbe-page-create')?.addEventListener('click', () => void savePage());
        pane.querySelector('#nbx-code-preview')?.addEventListener('click', async () => {
            if (!(await savePage())) return;
            const host = pane.querySelector('#nbx-code-prev') as HTMLElement;
            host.hidden = false;
            mountPreview(host, pageId);
            host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
        pane.querySelector('#nbx-code-back')?.addEventListener('click', () => { view = 'details'; codePageId = null; renderPane(); });
        void renderSubpages();
        void renderPageFiles();
    };

    // A page can outgrow the highlighter: say so instead of letting the colours look broken.
    overlay.addEventListener('bmm:highlight-limit', (e: Event) => {
        const d = (e as CustomEvent).detail || {};
        const wrap = (e.target as HTMLElement).closest('.code-hl-wrap');
        wrap?.parentElement?.querySelectorAll(':scope > .code-hl-note').forEach((n) => n.remove());
        if (!d.off || !wrap) return;
        const note = document.createElement('div');
        note.className = 'code-hl-note';
        note.textContent = t('navedit.hlOff') + ` (${Math.round((d.chars || 0) / 1024)} KB)`;
        wrap.insertAdjacentElement('afterend', note);
    });

    // A library icon finishing its load redraws the rows that wear one.
    const onIcons = () => { if (overlay.isConnected) renderSide(); else document.removeEventListener('bmm:nav-icons-ready', onIcons); };
    document.addEventListener('bmm:nav-icons-ready', onIcons);

    // The Share/Import menu: opens upward (the footer is the bottom edge), closes on a choice
    // or a click elsewhere.
    {
        const btn = overlay.querySelector('#nbe-share-menu-btn') as HTMLElement | null;
        const menu = overlay.querySelector('#nbe-share-menu') as HTMLElement | null;
        if (btn && menu) {
            btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
            menu.addEventListener('click', () => { menu.hidden = true; });
            overlay.addEventListener('click', () => { menu.hidden = true; });
        }
    }

    const close = async () => {
        await dropDraft();          // a page the guided flow made and nobody attached
        overlay.remove();
    };
    // Escape presses the × (modal-shell's global keys), which runs close() above. An open
    // share menu takes the first Escape for itself.
    overlay.addEventListener('keydown', (e) => {
        const menu = overlay.querySelector('#nbe-share-menu') as HTMLElement | null;
        if (e.key === 'Escape' && menu && !menu.hidden) { menu.hidden = true; e.preventDefault(); }
    });
    overlay.querySelector('#nbe-close')?.addEventListener('click', () => void close());
    overlay.querySelector('#nbe-done')?.addEventListener('click', () => void close());
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) void close(); });
    overlay.querySelector('#nbe-reset')?.addEventListener('click', async () => {
        if (!(await showConfirm(t('nbx.resetT'), t('nbx.resetD')))) return;
        await dropDraft();
        save({ ...EMPTY_CFG });
        // Original labels, order and no custom views: cleanest from a fresh start of the page.
        location.reload();
    });

    // Share / import the whole navbar config (short code + bmm:// link, like card-order).
    overlay.querySelector('#nbe-share')?.addEventListener('click', async () => {
        const link = `bmm://settings/navbar?code=${encodeURIComponent(exportNavCode())}`;
        try { await navigator.clipboard.writeText(link); } catch { /* ignore */ }
        toast(t('navedit.copied'), 'success');
    });
    const importRow = overlay.querySelector('#nbe-import-row') as HTMLElement;
    overlay.querySelector('#nbe-import')?.addEventListener('click', () => {
        importRow.style.display = importRow.style.display === 'none' ? 'flex' : 'none';
        if (importRow.style.display === 'flex') (importRow.querySelector('input') as HTMLInputElement | null)?.focus();
    });
    // Full bundle (navbar + custom icons + custom pages) as a .bmmnav file.
    overlay.querySelector('#nbe-export-file')?.addEventListener('click', () => exportNavBundle());
    overlay.querySelector('#nbe-import-file')?.addEventListener('click', () => importNavBundle());
    overlay.querySelector('#nbe-import-apply')?.addEventListener('click', () => {
        const val = (overlay.querySelector('#nbe-import-input') as HTMLInputElement).value;
        const cfg = parseNavCode(val);
        if (!cfg) { toast(t('navedit.badCode'), 'error'); return; }
        save(cfg); applyNavbarConfig(); openNavbarEditor();
        toast(t('cardorder.applied'), 'success');
    });

    renderSide();
    renderPane();
    // A preselected row takes the focus; otherwise the dialog's own first stop does.
    if (sel) (list.querySelector(`[data-id="${cssEsc(sel)}"]`) as HTMLElement | null)?.focus();
}

/** The order the preview list shows right now, with the rest of the config as saved. */
function readEditor(list: HTMLElement): NavbarConfig {
    const cfg = load();
    cfg.order = Array.from(list.querySelectorAll<HTMLElement>('.nbx-row[data-id]')).map((r) => r.dataset.id!);
    return cfg;
}

function orderedIds(): string[] {
    const cfg = load();
    const present = new Set(items().map(idOf));
    // Keep valid group dividers + present items, in saved order; append any new items.
    const ordered = cfg.order.filter(e => e.startsWith('group:') ? !!cfg.groups[e] : present.has(e));
    for (const id of present) if (!ordered.includes(id)) ordered.push(id);
    return ordered;
}
function origLabel(id: string): string {
    const el = items().find(e => idOf(e) === id);
    const lbl = el ? labelEl(el) : null;
    const key = lbl?.dataset.i18nOrig || lbl?.getAttribute('data-i18n') || id;
    return t(key) || id;
}

const EDITOR_CSS_ID = 'navbar-editor-css';
function ensureEditorCss(): void {
    if (document.getElementById(EDITOR_CSS_ID)) return;
    const link = document.createElement('link');
    link.id = EDITOR_CSS_ID;
    link.rel = 'stylesheet';
    link.href = 'css/navbar-editor.css';
    document.head.appendChild(link);
}

/** Built-in (non-custom) nav items, for the « A BMM page » picker. */
function builtinViewOptions(selected = ''): string {
    return items()
        .filter(el => !idOf(el).startsWith('custom:') && el.dataset.view)
        .map(el => `<option value="${escAttr(el.dataset.view!)}" ${el.dataset.view === selected ? 'selected' : ''}>${escAttr(labelEl(el)?.textContent?.trim() || el.dataset.view!)}</option>`)
        .join('');
}
// Curated, known-good dialog actions. Each runs the REAL opener (which sets the
// modal up properly) instead of blindly toggling `.open` on an element that may
// need parameters — that is what made the raw modal-id list buggy/untranslated.
interface ModalActionDef { value: string; def: string; run: () => void; avail: () => boolean; }
function modalActionDefs(): ModalActionDef[] {
    const w = window as any;
    // A global opener exposed by a feature module (no parameters needed).
    const opener = (value: string, def: string, fn: string): ModalActionDef =>
        ({ value, def, run: () => w[fn]?.(), avail: () => typeof w[fn] === 'function' });
    // A standalone manager opened by clicking its existing trigger button.
    const trigger = (value: string, def: string, btnId: string): ModalActionDef =>
        ({ value, def, run: () => (document.getElementById(btnId) as HTMLElement | null)?.click(), avail: () => !!document.getElementById(btnId) });
    return [
        opener('newProfile', 'New profile', 'openNewProfileModal'),
        opener('license', 'License', 'openLicenseModal'),
        opener('privacy', 'Privacy policy', 'openPrivacyModal'),
        opener('tos', 'Terms of service', 'openTosModal'),
        opener('eula', 'EULA', 'openEulaModal'),
        opener('hashStats', 'Hashing stats', 'showHashingStats'),
        opener('tools', 'BMM Tools', 'openToolsHub'),
        trigger('storage', 'Storage manager', 'btn-open-storage'),
        trigger('benchmark', 'Benchmark', 'btn-open-benchmark'),
        trigger('themeEditor', 'Theme editor', 'btn-open-theme-editor'),
        trigger('bans', 'Bans manager', 'btn-open-bans'),
        trigger('whitelist', 'Whitelist manager', 'btn-open-whitelist'),
        trigger('monitoring', 'Monitoring', 'btn-open-monitoring'),
        trigger('debug', 'Debug', 'btn-open-debug'),
    ].filter(a => a.avail());
}
function modalActionLabel(d: ModalActionDef): string { return t('navedit.act.' + d.value) || d.def; }
function modalActionOptions(selected = ''): string {
    return modalActionDefs().map(d => `<option value="${escAttr(d.value)}" ${d.value === selected ? 'selected' : ''}>${escAttr(modalActionLabel(d))}</option>`).join('');
}
function runModalAction(value: string): boolean {
    const d = modalActionDefs().find(x => x.value === value);
    if (d) { d.run(); return true; }
    return false;
}
function pageOptions(selected = ''): string {
    if (!_pagesCache.length) return `<option value="" disabled selected>${escAttr(t('nbx.noPagesYet'))}</option>`;
    return _pagesCache.map(p => `<option value="${escAttr(p.id)}" ${p.id === selected ? 'selected' : ''}>${escAttr(p.name)}</option>`).join('');
}

function escAttr(s: string): string {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
