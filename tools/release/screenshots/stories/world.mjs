// The demo world the stories play in: a small, believable modding setup answered by a stateful
// mock in the page (no real path, account or address: D:\Games, D:\Modding, 192.168.1.x,
// example.org). The games are invented.
//
// `world` is a page function (gifs.mjs `pageInit`): it runs before the app and registers its
// commands in window.__gifMock, in front of the static fixtures. Its state lives in
// window.__demo, so a story's own pageInit (run after it) can read and extend it, and a story
// step can look at it (h.eval(() => window.__demo…)) to check what the interface really did.
//
// What it models, as the backend does (commands/*.rs), enough to be honest on screen:
//   profiles (create, switch, edit), each with a mods folder; the mods of a profile are the
//   mods stored in its folder; enable/disable per profile with an activation order (the mod
//   applied last wins a shared file); add a mod from an archive or a folder (preview of the
//   archive, then a copy that takes a moment); conflicts between enabled mods computed from
//   their files, the order view, « make X win » and apply.
//
// pageInitArgs: { start: 'configured' (default) | 'empty' }
//   empty: one profile of another game only, and Northwind Saga to be set up from nothing.

export function world(args = {}) {
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const MB = 1048576;
  const G = 'D:\\Games', M = 'D:\\Modding';
  const files = (dir, list) => list.map((f) => `${dir}/${f}`);
  // The mods a reader of a Nexus-style site would recognise the shape of. `files` are the paths
  // the mod puts in the game folder; two mods sharing one is a conflict.
  const LIB = {
    'nw-hd-textures': { name: 'HD Texture Pack', version: '3.2.0', author: 'Velkor', tags: ['graphics', 'hd'], bytes: 1060 * MB,
      description: '4K textures for terrain, architecture and armour. Needs 6 GB of video memory.',
      files: [...files('Data/textures/terrain', ['rock_01.dds', 'rock_02.dds', 'grass_01.dds', 'snow_01.dds']), ...files('Data/textures/sky', ['clouds_01.dds', 'clouds_02.dds', 'sunset.dds']), 'Data/textures/water/ripple.dds', 'Data/ui/hud.xml'] },
    'nw-weather': { name: 'Dynamic Weather Overhaul', version: '1.9.4', author: 'Marrow', tags: ['weather', 'graphics'], bytes: 369 * MB,
      description: 'Storms, fog banks and seasonal snow with matching skies and sounds.',
      files: [...files('Data/textures/sky', ['clouds_01.dds', 'clouds_02.dds', 'sunset.dds']), 'Data/textures/water/ripple.dds', 'Data/lighting/sun.ini', 'Data/sound/rain_loop.wav', 'Data/sound/footsteps_rain.wav'] },
    'nw-footsteps': { name: 'Quieter Footsteps', version: '1.0.3', author: 'Pell', tags: ['audio'], bytes: 12 * MB,
      description: 'Softer, surface-aware footstep sounds.', files: ['Data/sound/footsteps_rain.wav', 'Data/sound/footsteps_stone.wav', 'Data/sound/footsteps_wood.wav'] },
    'nw-inventory': { name: 'Better Inventory UI', version: '2.1.0', author: 'Nyx', tags: ['ui', 'quality-of-life'], bytes: 8 * MB,
      description: 'A sortable inventory grid with weight and value columns.', files: ['Data/ui/hud.xml', 'Data/ui/inventory_grid.xml', 'Data/ui/fonts/inter.ttf'] },
    'nw-companions': { name: 'Companion Rework', version: '0.9.7', author: 'Aster', tags: ['gameplay', 'ai'], bytes: 190 * MB,
      description: 'Companions comment on the world, keep their distance and stop blocking doors.', files: ['Data/scripts/companion_ai.lua', 'Data/dialogue/companions.xml'] },
    'nw-lighting': { name: 'Nightfall Lighting', version: '1.2.2', author: 'Marrow', tags: ['graphics', 'lighting'], bytes: 85 * MB,
      description: 'Darker nights, warmer torches, moonlight that casts shadows.', files: ['Data/lighting/sun.ini', 'Data/lighting/torch.ini', 'Data/lighting/moon.ini'] },
    'nw-patch': { name: 'Unofficial Patch', version: '4.0.1', author: 'Community', tags: ['gameplay'], bytes: 6 * MB,
      description: 'Over 900 fixes to quests, items and dialogue.', files: ['Data/scripts/quests_fix.lua', 'Data/dialogue/fixes.xml'] },
    'nw-water': { name: 'Realistic Water', version: '2.0.0', author: 'Velkor', tags: ['graphics'], bytes: 320 * MB,
      description: 'Reflections, foam and depth-based colour for lakes and the sea.', files: ['Data/textures/water/ripple.dds', 'Data/textures/water/foam.dds', 'Data/shaders/water.fx'] },
    'nw-fasttravel': { name: 'Fast Travel Tweaks', version: '1.1.0', author: 'Pell', tags: ['quality-of-life'], bytes: 1 * MB,
      description: 'Travel from anywhere outdoors, with a cost in time and food.', files: ['Data/scripts/travel.lua'] },
    // Another game, so the profile list is not one game only.
    'eb-map': { name: 'Detailed World Map', version: '1.4.0', author: 'Orrin', tags: ['ui'], bytes: 64 * MB, description: 'A hand-drawn world map with every landmark.', files: ['Content/ui/map.dds'], game: 'eb' },
    'eb-ui': { name: 'Minimal HUD', version: '2.2.0', author: 'Orrin', tags: ['ui'], bytes: 3 * MB, description: 'Hides the HUD out of combat.', files: ['Content/ui/hud.cfg'], game: 'eb' },
  };
  const NW = { game: 'Northwind Saga', gamePath: `${G}\\Northwind Saga`, mods: `${M}\\Northwind\\mods`, backups: `${M}\\Northwind\\backups` };
  const EB = { game: 'Emberwood', gamePath: `${G}\\Emberwood`, mods: `${M}\\Emberwood\\mods`, backups: `${M}\\Emberwood\\backups` };
  const modRec = (id, folder, order, extra = {}) => {
    const d = LIB[id];
    return {
      id, name: d.name, version: d.version, author: d.author, description: d.description, dependencies: [], enabled: false, conflicts: [],
      mod_folder_path: `${folder}\\${d.name}`, status: 'Installed', added_at: iso(60 * 24 * (30 - order)), installed_files: d.files.slice(),
      download_links: [], tags: d.tags.slice(), install_notes: '', activation_order: order, cached_files: null, last_scan_mtime: 1750000000 + order, file_hashes: null,
      size_bytes: d.bytes, ...extra,
    };
  };
  const prof = (id, name, place, color, icon, created, active = []) => ({
    id, name, game_name: place.game, game_path: place.gamePath, mods_path: place.mods, backup_path: place.backups,
    active_mods: active, color, icon, background_image: null, created_at: iso(created), origin_repo_profile_id: null,
  });
  const empty = args.start === 'empty';
  const st = {
    profiles: [], mods: [], active: null, order: {}, pins: {}, nextId: 1, log: [], LIB, NW, EB, MB,
    // Paths a file dialog may « pick » next (h.pick queues them), shared with gifs.mjs's picks.
  };
  st.profiles.push(prof('prof-emberwood', 'Emberwood', EB, '#f97316', '🔥', 60 * 24 * 120, ['eb-map', 'eb-ui']));
  st.mods.push(modRec('eb-map', EB.mods, 1), modRec('eb-ui', EB.mods, 2));
  st.order['prof-emberwood'] = ['eb-map', 'eb-ui'];
  if (!empty) {
    const ids = ['nw-patch', 'nw-hd-textures', 'nw-weather', 'nw-footsteps', 'nw-inventory', 'nw-companions', 'nw-lighting', 'nw-water', 'nw-fasttravel'];
    ids.forEach((id, i) => st.mods.push(modRec(id, NW.mods, i + 1)));
    const on = ['nw-patch', 'nw-hd-textures', 'nw-weather', 'nw-footsteps', 'nw-inventory', 'nw-companions'];
    st.profiles.unshift(prof('prof-nw-main', 'Main playthrough', NW, '#3b82f6', '🗡️', 60 * 24 * 40, on.slice()));
    st.profiles.splice(1, 0, prof('prof-nw-vanilla', 'Vanilla', NW, '#10b981', '🧪', 60 * 24 * 20, []));
    st.order['prof-nw-main'] = on.slice();
    st.order['prof-nw-vanilla'] = [];
    st.active = 'prof-nw-main';
  } else {
    st.active = 'prof-emberwood';
  }
  window.__demo = st;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const P = () => st.profiles.find((p) => p.id === st.active) || st.profiles[0];
  const under = (folder, m) => m.mod_folder_path.toLowerCase().startsWith(folder.toLowerCase() + '\\');
  const modsOf = (p) => (p ? st.mods.filter((m) => under(p.mods_path, m)) : []);
  const ord = (p) => (st.order[p.id] = st.order[p.id] || []);
  const view = (p) => {
    const order = ord(p);
    return modsOf(p).map((m) => {
      const on = p.active_mods.includes(m.id);
      return { ...m, enabled: on, activation_order: on ? order.indexOf(m.id) + 1 : 0, mod_folder_path: m.mod_folder_path };
    });
  };
  // Shared files between enabled mods of the active profile, the winner by the rule of
  // mod_order.rs: a pinned copy wins, else the mod applied last.
  const plan = (p, order = ord(p), pins = st.pins[p.id] || {}, off = []) => {
    const live = order.filter((id) => p.active_mods.includes(id) && !off.includes(id));
    const byFile = new Map();
    for (const id of live) for (const f of st.mods.find((m) => m.id === id)?.installed_files || []) byFile.set(f, [...(byFile.get(f) || []), id]);
    const out = [];
    for (const [path, mods] of byFile) {
      if (mods.length < 2) continue;
      const winner = pins[path] && mods.includes(pins[path]) ? pins[path] : mods.slice().sort((a, b) => live.indexOf(b) - live.indexOf(a))[0];
      out.push({ path, mods, winner, pinned: !!pins[path] });
    }
    return out;
  };
  const nameOf = (id) => st.mods.find((m) => m.id === id)?.name || id;
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mod';
  // What the archives a story « downloads » contain (add_mod reads it through preview_under).
  st.archives = st.archives || {};

  const cmds = {
    get_profiles: () => st.profiles.map((p) => ({ ...p, active_mods: p.active_mods.slice() })),
    get_active_profile_id: () => st.active,
    set_active_profile: (a) => { if (st.profiles.some((p) => p.id === a.profileId)) st.active = a.profileId; return null; },
    create_profile: (a) => {
      const q = a.payload || {};
      const id = `prof-${slug(q.name)}-${st.nextId++}`;
      const p = { id, name: q.name, game_name: q.gameName || '', game_path: q.gamePath, mods_path: q.modsPath, backup_path: q.backupPath || `${M}\\BMM\\backups\\${slug(q.name)}`,
        active_mods: [], color: q.color || '#3b82f6', icon: q.icon || null, background_image: null, created_at: new Date().toISOString(), origin_repo_profile_id: null };
      st.profiles.push(p);
      st.order[id] = [];
      return sleep(500).then(() => ({ ...p }));
    },
    update_profile: (a) => { const q = a.payload || a.profile || {}; const p = st.profiles.find((x) => x.id === (q.id || a.profileId)); if (p) Object.assign(p, { name: q.name ?? p.name, game_name: q.gameName ?? q.game_name ?? p.game_name, color: q.color ?? p.color, icon: q.icon ?? p.icon }); return null; },
    delete_profile: (a) => { st.profiles = st.profiles.filter((p) => p.id !== a.profileId); if (st.active === a.profileId) st.active = st.profiles[0]?.id || null; return null; },
    get_all_mods: () => view(P()),
    get_mods: () => view(P()),
    get_mods_all_profiles: () => Object.fromEntries(st.profiles.map((p) => [p.id, view(p)])),
    enable_mod: (a) => {
      const p = P();
      if (!p.active_mods.includes(a.modId)) p.active_mods.push(a.modId);
      const o = ord(p); if (!o.includes(a.modId)) o.push(a.modId);
      const m = st.mods.find((x) => x.id === a.modId);
      // Copying takes the time a real copy of that size would take on an SSD, capped.
      return sleep(Math.min(1400, 250 + (m?.size_bytes || 0) / (900 * MB) * 600)).then(() => null);
    },
    disable_mod: (a) => { const p = P(); p.active_mods = p.active_mods.filter((x) => x !== a.modId); st.order[p.id] = ord(p).filter((x) => x !== a.modId); return sleep(300).then(() => null); },
    toggle_all_mods: (a) => { const p = P(); if (a.enable) { p.active_mods = modsOf(p).map((m) => m.id); st.order[p.id] = p.active_mods.slice(); } else { p.active_mods = []; st.order[p.id] = []; } return sleep(800).then(() => null); },
    clear_mod_op_cancel: () => null,
    remove_mod: (a) => { st.mods = st.mods.filter((m) => m.id !== a.modId); for (const p of st.profiles) { p.active_mods = p.active_mods.filter((x) => x !== a.modId); st.order[p.id] = ord(p).filter((x) => x !== a.modId); } return null; },
    scan_mods_folder: () => sleep(600).then(() => ({ added: 0, removed: 0, updated: 0 })),
    list_mod_files_recursive: (a) => st.mods.find((m) => m.id === a.modId)?.installed_files || [],
    path_exists: (a) => /^[A-Z]:\\/i.test(String(a.path || '')),
    check_disk_space: (a) => ({ available_bytes: 612 * 1024 * MB, total_bytes: 1863 * 1024 * MB, mount_point: String(a.path || 'D:\\').slice(0, 3), free_percent: 32.8 }),
    get_folder_size: (a) => { const p = st.profiles.find((x) => x.mods_path === a.path); return p ? modsOf(p).reduce((s, m) => s + (m.size_bytes || 0), 0) : 0; },
    get_system_disks: () => [{ name: 'System', mount_point: 'C:\\', total_space: 512 * 1024 * MB, available_space: 141 * 1024 * MB, kind: 'SSD' }, { name: 'Games', mount_point: 'D:\\', total_space: 1863 * 1024 * MB, available_space: 612 * 1024 * MB, kind: 'SSD' }],
    // An archive picked in « Add a mod »: its listing (preview_under root=<folder> rel=<file>).
    preview_under: (a) => {
      const key = String(a.rel || '');
      const arc = st.archives[key] || Object.values(st.archives).find((x) => key.includes(x.match || '\u0000'));
      if (!arc) return { kind: 'archive', text: null, entries: [{ path: 'readme.txt', size: 1200, is_dir: false }], size: 4096, truncated: false };
      const entries = [];
      const dirs = new Set();
      for (const f of arc.files) {
        const parts = f.path.split('/');
        for (let i = 1; i < parts.length; i++) { const d = parts.slice(0, i).join('/'); if (!dirs.has(d)) { dirs.add(d); entries.push({ path: d, size: 0, is_dir: true }); } }
        entries.push({ path: f.path, size: f.size, is_dir: false });
      }
      return sleep(450).then(() => ({ kind: 'archive', text: null, entries, size: arc.packed, truncated: false }));
    },
    folder_tree: () => [],
    add_mod: (a) => {
      const q = a.payload || {};
      const p = P();
      const src = String(q.modFolderPath || '');
      const arc = Object.values(st.archives).find((x) => src.includes(x.match)) || null;
      const base = arc?.id || `mod-${slug(q.name)}`;
      const id = st.mods.some((m) => m.id === base) ? `${base}-${st.nextId++}` : base;
      const files = arc ? arc.files.map((f) => f.path.replace(/^[^/]+\/(?=Data\/)/, '')) : ['Data/readme.txt'];
      const rec = { id, name: q.name, version: q.version || '1.0.0', author: q.author || arc?.author || '', description: q.description || arc?.description || '', dependencies: q.dependencies || [], enabled: false, conflicts: [],
        mod_folder_path: `${p.mods_path}\\${q.name}`, status: 'Installed', added_at: new Date().toISOString(), installed_files: files, download_links: q.downloadLinks || [], tags: (q.tags && q.tags.length ? q.tags : arc?.tags) || [],
        install_notes: '', activation_order: 0, cached_files: null, last_scan_mtime: Math.floor(Date.now() / 1000), file_hashes: null, size_bytes: arc?.bytes || MB };
      st.mods.push(rec);
      return sleep(arc?.copyMs ?? 1400).then(() => ({ ...rec }));
    },
    get_tags: () => [
      { id: 'graphics', name: 'graphics', color: '#8b5cf6' }, { id: 'hd', name: 'hd', color: '#6366f1' }, { id: 'weather', name: 'weather', color: '#0ea5e9' },
      { id: 'lighting', name: 'lighting', color: '#eab308' }, { id: 'audio', name: 'audio', color: '#06b6d4' }, { id: 'ui', name: 'ui', color: '#f59e0b' },
      { id: 'gameplay', name: 'gameplay', color: '#10b981' }, { id: 'quality-of-life', name: 'quality-of-life', color: '#22c55e' }, { id: 'ai', name: 'ai', color: '#ec4899' },
    ],
    get_all_mod_conflicts: () => {
      const p = P(); const out = {};
      const o = ord(p);
      for (const f of plan(p)) for (const a of f.mods) for (const b of f.mods) {
        if (a === b) continue;
        const list = (out[a] = out[a] || []);
        let e = list.find((x) => x.other_mod_id === b);
        if (!e) { e = { category: 'Intra', status: 'Active', other_mod_id: b, other_mod_name: nameOf(b), other_profile_name: p.name, file_count: 0, activation_order: o.indexOf(b) }; list.push(e); }
        e.file_count++;
      }
      return out;
    },
    get_mod_conflicts: (a) => (cmds.get_all_mod_conflicts()[a.modId] || []),
    mod_order_get: () => {
      const p = P(); const o = ord(p).filter((id) => p.active_mods.includes(id)); const fl = plan(p);
      const rows = o.map((id, i) => ({ id, name: nameOf(id), position: i, contested: fl.filter((f) => f.mods.includes(id)).length, winning: fl.filter((f) => f.winner === id).length, archived: false, added_at: st.mods.find((m) => m.id === id)?.added_at }));
      return [rows, fl.map(({ path, mods, winner }) => ({ path, mods, winner }))];
    },
    mod_order_set: (a) => { const p = P(); const before = plan(p); st.order[p.id] = a.order.slice(); const after = plan(p); return after.filter((f) => before.find((b) => b.path === f.path)?.winner !== f.winner).length; },
    conflict_plan: (a) => {
      const p = P(); const saved = ord(p).filter((id) => p.active_mods.includes(id));
      const order = Array.isArray(a.order) ? a.order : saved; const pins = a.pins || st.pins[p.id] || {}; const off = a.disable || [];
      const fl = plan(p, order, pins, off);
      const pairs = new Map();
      for (const f of fl) {
        const [x, y] = f.mods.slice().sort(); const k = `${x}|${y}`;
        const e = pairs.get(k) || { a: x, b: y, files: 0, a_wins: 0, b_wins: 0, pinned: 0 };
        e.files++; if (f.winner === x) e.a_wins++; if (f.winner === y) e.b_wins++; if (f.pinned) e.pinned++; pairs.set(k, e);
      }
      const was = new Map(plan(p, saved, st.pins[p.id] || {}, []).map((f) => [f.path, f.winner]));
      const handovers = fl.filter((f) => was.get(f.path) && was.get(f.path) !== f.winner).map((f) => ({ path: f.path, from: was.get(f.path), to: f.winner }));
      return { profile_id: p.id, order, names: Object.fromEntries(saved.map((id) => [id, nameOf(id)])), pins, files: fl, files_total: fl.length, pairs: [...pairs.values()], handovers, handovers_total: handovers.length };
    },
    conflict_apply: (a) => {
      const p = P(); const before = plan(p);
      st.order[p.id] = a.order.slice(); st.pins[p.id] = { ...(a.pins || {}) };
      const moved = plan(p).filter((f) => before.find((b) => b.path === f.path)?.winner !== f.winner).length;
      return sleep(1100).then(() => moved);
    },
    get_conflict_file_tree: (a) => {
      const p = P(); const fl = plan(p).filter((f) => f.mods.includes(a.modId) && f.mods.includes(a.otherModId));
      return { mod_id: a.modId, other_mod_id: a.otherModId, files: fl.map((f) => ({ path: f.path, winner: f.winner })) };
    },
    // The game folder against the enabled mods: nothing altered (a story may set st.altered).
    verify_integrity: () => sleep(1600).then(() => st.altered || []),
    trigger_sha_background_population: () => null,
    recalculate_mod_sha: () => sleep(700).then(() => null),
  };
  Object.assign(window.__gifMock, cmds);
}

/** Queue the path the next native file dialog « picks » (the preview answers C:\mock\folder). */
export async function pick(h, path) {
  await h.eval((p) => window.__gifPicks.push(p), path);
}

/** An archive a story « downloaded »: add_mod / preview_under answer from it. */
export async function stageArchive(h, a) {
  await h.eval((x) => { window.__demo.archives[x.file] = x; }, a);
}

/** Wait until a condition on the page holds (a function run in the page), or throw. */
export async function until(h, fn, { timeout = 8000, what = 'condition' } = {}, ...args) {
  const t0 = Date.now();
  for (;;) {
    if (await h.page.evaluate(fn, ...args)) return;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}
