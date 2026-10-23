// « Share a mod list and an order »: the Northwind Saga setup of « Main playthrough » handed on.
// The activation order is settled (textures over weather) and kept as a named order list, with
// its share code and .bmmorder file; the mods go out as a .MM list, come back into « Vanilla »
// (its own mods folder, nothing but the Unofficial Patch) with the plan of what is new and what
// is already there, are installed, and the saved order list switches them on in its order.
import { world, pick, until } from './world.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SAVED_MM = 'D:\\Modding\\Shared\\Northwind - Main playthrough.mm';
const SAVED_ORDER = 'D:\\Modding\\Shared\\Textures over weather.bmmorder';

/**
 * The page side of the story (runs after world): Vanilla gets a mods folder of its own, and the
 * commands of the .MM lists (commands/modlist.rs, mods.rs install_from_modlist) and of the saved
 * order lists (commands/order_lists.rs) answer from window.__demo.
 */
export function listsWorld() {
  const st = window.__demo;
  const MB = st.MB;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const van = st.profiles.find((p) => p.id === 'prof-nw-vanilla');
  van.mods_path = 'D:\\Modding\\Northwind\\vanilla';
  van.backup_path = 'D:\\Modding\\Northwind\\vanilla-backups';
  const patch = st.mods.find((m) => m.id === 'nw-patch');
  st.mods.push({ ...patch, id: 'nw-patch-v', mod_folder_path: `${van.mods_path}\\Unofficial Patch`, installed_files: patch.installed_files.slice(), tags: patch.tags.slice() });
  van.active_mods = ['nw-patch-v'];
  st.order['prof-nw-vanilla'] = ['nw-patch-v'];
  st.files = {};
  st.olists = [];

  // Tauri events, for modlist.js only: its export waits on bmm://mm-export-progress and its install
  // shows bmm://mod-download-progress. The preview has no event bridge, and a global __TAURI__
  // would switch the whole app to the native path, so only a read from modlist.js sees one.
  const bus = {};
  const fake = { event: { listen: async (name, cb) => { (bus[name] ||= []).push(cb); return () => { bus[name] = (bus[name] || []).filter((x) => x !== cb); }; } } };
  Object.defineProperty(window, '__TAURI__', { configurable: true, get() { return /\/modlist\.js/.test(new Error().stack || '') ? fake : undefined; } });
  const emit = (name, payload) => (bus[name] || []).forEach((cb) => { try { cb({ payload }); } catch { /* a listener never breaks the mock */ } });

  const P = () => st.profiles.find((p) => p.id === st.active);
  const under = (folder, m) => m.mod_folder_path.toLowerCase().startsWith(folder.toLowerCase() + '\\');
  const modsOf = (p) => st.mods.filter((m) => under(p.mods_path, m));
  const hex = (s) => { let h = 2166136261; let out = ''; for (let k = 0; k < 8; k++) { for (const c of s + k) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; out += h.toString(16).padStart(8, '0'); } return out; };
  const tagDefs = (ids) => {
    const all = window.__gifMock.get_tags();
    return all.filter((d) => ids.includes(d.id));
  };
  // The file tree a .mm carries: folders, then files with their size and SHA-256.
  const tree = (m) => {
    const files = m.installed_files;
    const dirs = new Set();
    for (const f of files) { const parts = f.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
    const weight = files.map((f) => (/\.(dds|wav|fx)$/.test(f) ? 40 : 1));
    const sum = weight.reduce((a, b) => a + b, 0);
    return [...[...dirs].sort().map((d) => ({ relative_path: d, is_directory: true, size: 0 })),
      ...files.map((f, i) => ({ relative_path: f, is_directory: false, size: Math.round((m.size_bytes || MB) * weight[i] / sum), sha256: hex(`${m.name}/${f}`) }))];
  };

  Object.assign(window.__gifMock, {
    // ── .MM lists ──────────────────────────────────────────────────────────────────────────
    export_modlist: async (a) => {
      const p = P();
      const order = st.order[p.id] || [];
      const on = order.filter((id) => p.active_mods.includes(id)).map((id) => st.mods.find((m) => m.id === id)).filter(Boolean);
      const total = on.length;
      for (let i = 0; i < total; i++) {
        emit('bmm://mm-export-progress', { current: i, total, mod_name: on[i].name, done: false });
        await sleep(Math.min(900, 250 + (on[i].size_bytes || 0) / MB));
      }
      emit('bmm://mm-export-progress', { current: total, total, mod_name: '', done: true });
      st.files[a.outputPath] = {
        format_version: '2', name: a.listName, description: a.description || null, game_name: p.game_name, game_path_hint: p.game_path,
        author: a.author || null, created_at: new Date().toISOString(),
        mods: on.map((m) => ({ name: m.name, version: m.version, author: m.author, description: m.description, download_links: [], file_tree: a.includeHashes === false ? tree(m).map(({ sha256, ...f }) => f) : tree(m),
          dependencies: [], update_sources: [], install_notes: '', tags: m.tags.slice(), id: m.id, content_id: `cid-${hex(m.name).slice(0, 24)}` })),
        tag_defs: tagDefs([...new Set(on.flatMap((m) => m.tags))]), modpacks: [],
        load_order: { name: p.name, entries: on.map((m) => ({ name: m.name, version: m.version, id: m.id })) },
      };
      return null;
    },
    cancel_export_modlist: () => null,
    import_modlist: async (a) => {
      await sleep(500);
      const list = st.files[a.path];
      if (!list) throw new Error('mm.errRead');
      return JSON.parse(JSON.stringify(list));
    },
    // The mods the list has that this profile lacks are copied into the destination folder (the
    // path the import screen shows: the active profile's mods folder when « Create a profile » is
    // off); a mod already there by name is reported and left alone. Nothing is switched on.
    install_from_modlist: async (a) => {
      const list = JSON.parse(a.modlistJson);
      const p = P();
      const dest = list.game_path_hint || p.mods_path;
      const out = [];
      for (let i = 0; i < list.mods.length; i++) {
        const e = list.mods[i];
        const prog = (progress, status) => emit('bmm://mod-download-progress', { mod_index: i, total_mods: list.mods.length, mod_name: e.name, progress, status });
        prog(0, 'Starting…');
        if (modsOf(p).some((m) => m.name === e.name)) { await sleep(200); prog(100, 'Already present'); out.push(`✅ ${e.name} — Already present`); continue; }
        const bytes = e.file_tree.reduce((s, f) => s + (f.size || 0), 0);
        const ms = Math.min(1500, 350 + bytes / MB * 1.2);
        for (let k = 1; k <= 5; k++) { await sleep(ms / 5); prog(k * 20, k < 5 ? 'Copying files…' : 'Done'); }
        const src = st.mods.find((m) => m.name === e.name);
        const id = `${src?.id || 'mod'}-${p.id.replace(/^prof-/, '')}`;
        st.mods.push({ ...(src || {}), id, name: e.name, version: e.version, author: e.author || '', description: e.description || '', enabled: false,
          mod_folder_path: `${dest}\\${e.name}`, added_at: new Date().toISOString(), installed_files: e.file_tree.filter((f) => !f.is_directory).map((f) => f.relative_path),
          tags: e.tags.slice(), size_bytes: bytes, dependencies: [], conflicts: [], download_links: [], status: 'Installed', activation_order: 0 });
        out.push(`✅ ${e.name} — Copied locally`);
      }
      return out;
    },
    cancel_install_from_modlist: () => 0,

    // ── Saved order lists ──────────────────────────────────────────────────────────────────
    order_list_all: () => JSON.parse(JSON.stringify(st.olists)),
    order_list_save: (a) => {
      const l = JSON.parse(JSON.stringify(a.list));
      const now = new Date().toISOString();
      if (!l.id) { l.id = `ol-${st.nextId++}`; l.created_at = now; }
      l.updated_at = now;
      st.olists = [l, ...st.olists.filter((x) => x.id !== l.id)];
      return sleep(250).then(() => JSON.parse(JSON.stringify(l)));
    },
    order_list_delete: (a) => { st.olists = st.olists.filter((x) => x.id !== a.id); return null; },
    // Each entry resolved against the library (order_share.rs resolve_entries): the copy in the
    // profile's own folder first, by id, then by name and version; else the library by id.
    order_list_plan: (a) => window.__olPlan(a.entries || [], a.profileId || st.active),
    order_list_export: (a) => {
      const l = st.olists.find((x) => x.id === a.id);
      const text = l.entries.map((e, i) => `${i + 1}. ${e.name}${e.version ? ` ${e.version}` : ''}`).join('\n');
      const code = `BMMO1-${btoa(unescape(encodeURIComponent(JSON.stringify({ n: l.name, e: l.entries.map((e) => [e.name, e.version]) })))).replace(/=+$/, '')}`;
      const file = JSON.stringify({ format: 'bmmorder', version: 1, name: l.name, game: l.game || 'Northwind Saga', notes: l.description || '', entries: l.entries }, null, 2);
      return { code, code_len: code.length, code_max: 1800, text, file, file_name: `${l.name.replace(/[<>:"/\\|?*]/g, '-')}.bmmorder`, notes_len: (l.description || '').length };
    },
    write_text_file: () => sleep(300).then(() => null),
    // Turn the list's installed mods on in the active profile, then place them on top in its
    // order (order_lists.rs order_list_activate / order_after_activation).
    order_list_activate: async (a) => {
      const l = st.olists.find((x) => x.id === a.id);
      const p = P();
      const plan = window.__olPlan(l.entries, p.id);
      for (const m of plan.to_activate) {
        const rec = st.mods.find((x) => x.id === m.id);
        await sleep(Math.min(1100, 250 + (rec?.size_bytes || 0) / (900 * MB) * 600));
        if (!p.active_mods.includes(m.id)) p.active_mods.push(m.id);
      }
      const listed = plan.rows.map((r) => r.mod_id).filter(Boolean);
      const cur = (st.order[p.id] || []).filter((id) => p.active_mods.includes(id));
      for (const id of p.active_mods) if (!cur.includes(id)) cur.push(id);
      const after = [...listed.filter((id) => p.active_mods.includes(id)), ...cur.filter((id) => !listed.includes(id))];
      const moved = after.filter((id, i) => cur[i] !== id).length;
      st.order[p.id] = after;
      await sleep(500);
      return { enabled: plan.to_activate.length, already_active: plan.already_active, missing: plan.missing, disabled: 0, failed: [], moved, cancelled: false };
    },
  });

  window.__olPlan = (entries, pid) => {
    const p = st.profiles.find((x) => x.id === pid) || P();
    const mine = modsOf(p);
    const order = (st.order[p.id] || []).filter((id) => p.active_mods.includes(id));
    const rows = [];
    const toActivate = [];
    let already = 0, missing = 0;
    entries.forEach((e, i) => {
      let m = mine.find((x) => e.id && x.id === e.id); let quality = 'id';
      if (!m) { m = mine.find((x) => x.name === e.name && (!e.version || x.version === e.version)); quality = 'name_version'; }
      if (!m) { m = st.mods.find((x) => e.id && x.id === e.id); quality = 'id'; }
      if (!m) { m = st.mods.find((x) => x.name === e.name); quality = 'name'; }
      if (!m) quality = 'missing';
      const position = m ? order.indexOf(m.id) + 1 : 0;
      const state = !m ? 'missing' : position > 0 ? 'active' : 'inactive';
      if (state === 'active') already++; else if (state === 'inactive') toActivate.push({ id: m.id, name: m.name }); else missing++;
      rows.push({ index: i + 1, name: e.name, version: e.version || '', mod_id: m?.id || null, quality, candidates: m ? 1 : 0, version_differs: !!(m && e.version && m.version !== e.version),
        mod_name: m && m.name !== e.name ? m.name : null, mod_version: m?.version || null, state, position, in_profile: !!(m && mine.includes(m)) });
    });
    const listed = rows.map((r) => r.mod_id).filter((id) => id && order.includes(id));
    let q = 0;
    const after = order.map((id) => (listed.includes(id) ? listed[q++] : id));
    return { profile_id: p.id, rows, to_activate: toActivate, already_active: already, missing, ambiguous: 0, to_deactivate: order.filter((id) => !rows.some((r) => r.mod_id === id)).map((id) => ({ id, name: st.mods.find((m) => m.id === id)?.name || id })),
      placed: listed.length, order_after: after, order_changed: after.some((id, i) => id !== order[i]), handovers: 0 };
  };
}

export const shareList = {
  name: 'share-list',
  title: { en: 'Share a mod list and an order', fr: 'Partager une liste de mods et un ordre' },
  desc: {
    en: 'An activation order settled and kept as a named list with its share code; the mods exported as a .MM list, imported into another profile with the plan of what is new, installed, and switched on in the saved order.',
    fr: 'Un ordre d’activation réglé et gardé en liste nommée avec son code de partage ; les mods exportés en liste .MM, importés dans un autre profil avec le plan de ce qui est nouveau, installés, puis activés dans l’ordre enregistré.',
  },
  topics: ['advanced/mm', 'order/order', 'order/lists'],
  docs: ['features/modlist', 'how-it-works/load-order'],
  pageInit: [world, listsWorld],
  async setup(h) {
    await h.nav('library', 1500);
    await h.page.browserContext().overridePermissions(new URL(h.page.url()).origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  },
  steps: [
    {
      id: 'order',
      title: { en: 'Settle who wins the shared files', fr: 'Régler qui gagne les fichiers partagés' },
      topics: ['order/order'], docs: ['how-it-works/load-order'],
      async run(h) {
        await h.click('#btn-lib-order', { pause: 1400 });
        await until(h, () => document.querySelectorAll('#lo-list .lo-row').length >= 6, { what: 'the activation order' });
        await h.move('#lo-list .lo-row[data-id="nw-hd-textures"] .lo-rivals', 700);
        await wait(1500);
        // The textures applied after the weather: they win the sky and water files.
        await h.click('#lo-list .lo-row[data-id="nw-hd-textures"] .lo-mv-down', { pause: 1600 });
        await h.move('#lo-list .lo-row[data-id="nw-hd-textures"] .lo-rivals', 600);
        await wait(1200);
        await h.click('#lo-apply', { pause: 600 });
        await until(h, (x) => (window.__demo.order[x] || []).indexOf('nw-hd-textures') > (window.__demo.order[x] || []).indexOf('nw-weather'), { what: 'the order to be applied' }, 'prof-nw-main');
        await wait(1600);
      },
    },
    {
      id: 'order-list',
      title: { en: 'Keep the order as a list and share it', fr: 'Garder l’ordre en liste et le partager' },
      topics: ['order/lists'], docs: ['how-it-works/load-order'],
      async run(h) {
        await h.click('#lo-lists', { pause: 1200 });
        await h.click('.olm-from', { pause: 1300 });
        await until(h, () => document.querySelectorAll('.olm-entries .olm-entry').length >= 6, { what: 'the list from the profile' });
        await h.click('#olm-name', { pause: 200 });
        await h.combo('Control', 'a', 150);
        await h.type(null, 'Textures over weather', { delay: 55 });
        await wait(500);
        // Meant for Vanilla too: the chip of that profile.
        await h.click('.olm-scope[data-pid="prof-nw-vanilla"]', { pause: 900 });
        await h.click('.olm-foot .olm-save', { pause: 600 });
        await until(h, () => window.__demo.olists.length === 1, { what: 'the list to be saved' });
        await wait(900);
        await h.click('.olm-foot .olm-share', { pause: 1300 });
        await h.click('.olms-copy', { pause: 1300 });
        await h.eval((p) => window.__gifSaves.push(p), SAVED_ORDER);
        await h.click('.olms-save', { pause: 1500 });
        await h.click('.olms-done', { pause: 700 });
        await h.click('.olm-foot .olm-done', { pause: 700 });
        await h.click('#lo-x', { pause: 800 });
      },
    },
    {
      id: 'export-mm',
      title: { en: 'Export the mods as a .MM list', fr: 'Exporter les mods en liste .MM' },
      topics: ['advanced/mm'], docs: ['features/modlist'],
      async run(h) {
        await h.click('#nav-modlist', { pause: 1200 });
        await h.click('#btn-export-mm', { pause: 1000 });
        await h.type('#mm-list-name', 'Northwind — Main playthrough', { delay: 55 });
        await h.type('#mm-author', 'Rowan', { delay: 70 });
        await h.type('#mm-description', 'HD textures over dynamic weather, quieter footsteps and a better inventory.', { delay: 32 });
        await wait(500);
        await h.move('#mm-hashes-badge', 600);
        await wait(700);
        await h.eval((p) => window.__gifSaves.push(p), SAVED_MM);
        await h.click('#btn-confirm-export', { pause: 400 });
        await until(h, (p) => !!window.__demo.files[p], { timeout: 12000, what: 'the .mm to be written' }, SAVED_MM);
        await wait(1600);
      },
    },
    {
      id: 'import-mm',
      title: { en: 'Import it into another profile', fr: 'L’importer dans un autre profil' },
      topics: ['advanced/mm'], docs: ['features/modlist'],
      async run(h) {
        await h.click('#nav-library', { pause: 1000 });
        await h.click('.profile-select-icon-wrap .bmm-csel-trigger', { pause: 700 });
        await h.click(await h.byText('.bmm-csel-menu-open .bmm-csel-opt', /^Vanilla/), { pause: 600 });
        await until(h, () => window.__demo.active === 'prof-nw-vanilla', { what: 'Vanilla to be the active profile' });
        await wait(1400);
        await h.click('#nav-modlist', { pause: 1000 });
        await pick(h, SAVED_MM);
        await h.click('#btn-import-mm', { pause: 600 });
        await until(h, () => document.getElementById('imported-preview')?.style.display !== 'none' && !!document.querySelector('#imported-content .mm-mod-checkbox'), { what: 'the imported list' });
        await wait(1500);
        // Into Vanilla itself, not a new profile: the destination becomes its mods folder.
        await h.click('label.switch:has(#chk-import-as-profile)', { pause: 1400 });
        await h.scroll('#imported-content', 380, 1400);
        await wait(1400);
        await h.scroll('#imported-content', 420, 1400);
        await wait(1200);
      },
    },
    {
      id: 'install',
      title: { en: 'Install what is missing', fr: 'Installer ce qui manque' },
      topics: ['advanced/mm'], docs: ['features/modlist'],
      async run(h) {
        await h.scroll('#imported-content', -1000, 1100);
        await wait(400);
        await h.click('#btn-install-from-mm', { pause: 600 });
        await until(h, () => !!document.querySelector('#imported-preview .install-results-container'), { timeout: 20000, what: 'the install results' });
        await wait(2400);
        // The report sits under the list.
        await h.scroll('#imported-content', 1400, 1500);
        await wait(2200);
        await h.click('#nav-library', { pause: 1800 });
      },
    },
    {
      id: 'activate-list',
      title: { en: 'Switch them on in the saved order', fr: 'Les activer dans l’ordre enregistré' },
      topics: ['order/lists'], docs: ['how-it-works/load-order'],
      async run(h) {
        await h.click('#btn-lib-order', { pause: 1200 });
        await h.click('#lo-lists', { pause: 1200 });
        await h.click(await h.byText('.olm-lists .olm-pick', /Textures over weather/), { pause: 1600 });
        await h.click('.olm-foot .olm-go-activate', { pause: 1800 });
        await h.click('.olm-foot .olm-activate-go', { pause: 600 });
        await until(h, () => (window.__demo.profiles.find((p) => p.id === 'prof-nw-vanilla')?.active_mods.length || 0) >= 6, { timeout: 15000, what: 'the mods to be switched on' });
        await wait(2600);
        // The end toast sits over the footer's Close: the dialog's own ×.
        await h.click('.olm-modal .osh-x', { pause: 2200 });
        await h.click('#lo-x', { pause: 1600 });
      },
    },
  ],
};
