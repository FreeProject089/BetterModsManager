// « Fix a badly packaged mod »: Lantern Mod 2.0 comes as an archive whose files sit two
// folders down (Lantern Mod v2/Lantern Mod/Data/…), so enabled as it is, it would put a
// « Lantern Mod v2 » folder in the game folder and the game would never read it. Added anyway,
// the Mapper's final preview shows where the files would land, the Data folder is moved up to
// the game root, checked again and applied, the leftover wrapper removed; then the mod's
// details are filled in and its files hashed and checked.
import { world, pick, stageArchive, until } from './world.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1048576;

const LANTERN = {
  id: 'nw-lantern', file: 'Lantern Mod v2.zip', match: 'Lantern Mod v2.zip', name: 'Lantern Mod', author: '', tags: ['lighting'],
  bytes: 46 * MB, packed: 29 * MB, description: '', copyMs: 1300,
  files: [
    ['Lantern Mod v2/readme.txt', 0.004],
    ['Lantern Mod v2/Lantern Mod/Data/lighting/lantern.ini', 0.01],
    ['Lantern Mod v2/Lantern Mod/Data/lighting/lantern_flicker.ini', 0.01],
    ['Lantern Mod v2/Lantern Mod/Data/textures/props/lantern_01.dds', 21],
    ['Lantern Mod v2/Lantern Mod/Data/textures/props/lantern_glow.dds', 16],
    ['Lantern Mod v2/Lantern Mod/Data/sound/lantern_creak.wav', 2.4],
    ['Lantern Mod v2/Lantern Mod/Data/scripts/lantern_carry.lua', 0.02],
  ].map(([path, size]) => ({ path, size: Math.round(size * MB) })),
};

/** The Mapper's side of the backend (mapper.rs), over the world's mods and a game folder. */
export function mapperWorld() {
  const st = window.__demo;
  const MBp = 1048576;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (p) => String(p || '').split(/[\\/]/).filter((s) => s && s !== '.').join('/');
  // The game folder as installed (a few vanilla files) plus what the enabled mods put there.
  const vanilla = ['Northwind.exe', 'Northwind_Launcher.exe', 'steam_api64.dll', 'Data/base.pak', 'Data/textures/props/lantern_01.dds', 'Data/textures/props/barrel_01.dds',
    'Data/lighting/sun.ini', 'Data/sound/ambient_wind.wav', 'Data/scripts/main.lua', 'Data/ui/hud.xml', 'Saves/slot1.sav'];
  const gameFiles = () => {
    const p = st.profiles.find((x) => x.id === st.active);
    const on = st.mods.filter((m) => p && p.active_mods.includes(m.id));
    return [...new Set([...vanilla, ...on.flatMap((m) => m.installed_files || [])])];
  };
  // Sizes of a mod's files: the archive's when it came from one, else a believable figure.
  st.sizes = st.sizes || {};
  const sizeOf = (mod, f) => st.sizes[`${mod.id}|${f}`] ?? Math.round((mod.size_bytes || MBp) / Math.max(1, (mod.installed_files || []).length));
  st.emptyDirs = st.emptyDirs || {};
  // FileTreeNode[]: { name, path (relative, `\`), is_dir, children } as get_directory_tree walks it.
  const tree = (files, dirs = []) => {
    const root = [];
    const dirNode = new Map();
    const ensure = (parts) => {
      let level = root;
      for (let i = 0; i < parts.length; i++) {
        const key = parts.slice(0, i + 1).join('\\');
        let n = dirNode.get(key);
        if (!n) { n = { name: parts[i], path: key, is_dir: true, children: [] }; dirNode.set(key, n); level.push(n); }
        level = n.children;
      }
      return level;
    };
    for (const d of dirs) ensure(norm(d).split('/'));
    for (const f of files) {
      const parts = norm(f).split('/');
      ensure(parts.slice(0, -1)).push({ name: parts.at(-1), path: parts.join('\\'), is_dir: false, children: null });
    }
    const sort = (l) => { l.sort((a, b) => (b.is_dir - a.is_dir) || a.name.localeCompare(b.name)); l.forEach((n) => n.children && sort(n.children)); return l; };
    return sort(root);
  };
  const modOf = (a) => st.mods.find((m) => m.id === a.modId);
  Object.assign(window.__gifMock, {
    get_directory_tree: (a) => {
      const path = String(a.path || '');
      const p = st.profiles.find((x) => x.id === st.active);
      if (p && path.toLowerCase() === p.game_path.toLowerCase()) return sleep(300).then(() => tree(gameFiles()));
      const m = st.mods.find((x) => x.mod_folder_path.toLowerCase() === path.toLowerCase());
      if (!m) return Promise.reject(new Error('NotFound: Le dossier n\'existe pas ou n\'est pas un répertoire'));
      return sleep(250).then(() => tree(m.installed_files || [], st.emptyDirs[m.id] || []));
    },
    list_mod_files_sized: (a) => { const m = modOf(a); return (m?.installed_files || []).map((f) => ({ path: norm(f).replace(/\//g, '\\'), size: sizeOf(m, f) })); },
    is_mod_archived: () => false,
    // The moved item keeps its name under the target folder; the folders it leaves stay, empty.
    restructure_mod_item: (a) => {
      const m = modOf(a); if (!m) return Promise.reject(new Error('mod not found'));
      const src = norm(a.itemRelPath), target = norm(a.targetGameFolderRel);
      const name = src.split('/').pop();
      const left = src.split('/').slice(0, -1);
      m.installed_files = m.installed_files.map((f) => {
        if (f !== src && !f.startsWith(src + '/')) return f;
        const nf = [target, name, f.slice(src.length + 1)].filter(Boolean).join('/');
        const k = `${m.id}|${f}`; if (k in st.sizes) { st.sizes[`${m.id}|${nf}`] = st.sizes[k]; }
        return nf;
      });
      for (let i = left.length; i > 0; i--) (st.emptyDirs[m.id] = st.emptyDirs[m.id] || []).push(left.slice(0, i).join('/'));
      return sleep(450).then(() => null);
    },
    delete_mod_item: (a) => {
      const m = modOf(a); if (!m) return null;
      const p = norm(a.itemRelPath);
      m.installed_files = m.installed_files.filter((f) => f !== p && !f.startsWith(p + '/'));
      st.emptyDirs[m.id] = (st.emptyDirs[m.id] || []).filter((d) => d !== p && !d.startsWith(p + '/'));
      return sleep(300).then(() => null);
    },
    update_mod_meta: (a) => {
      const m = modOf(a); const q = a.payload || {};
      if (m) Object.assign(m, { name: q.name ?? m.name, version: q.version ?? m.version, author: q.author ?? m.author, description: q.description ?? m.description, tags: q.tags ?? m.tags, download_links: q.downloadLinks ?? m.download_links, dependencies: q.dependencies ?? m.dependencies });
      return sleep(300).then(() => (m ? { ...m } : null));
    },
    // Hashing the mod's files, then the check of the files against those hashes.
    recalculate_mod_sha: (a) => {
      const m = modOf(a);
      if (m) m.file_hashes = Object.fromEntries((m.installed_files || []).map((f, i) => [f.replace(/\//g, '\\'), `b3:${(0x9e3779b1 * (i + 7) >>> 0).toString(16).padStart(8, '0')}`]));
      return sleep(900).then(() => null);
    },
    get_mod_integrity: (a) => {
      const m = modOf(a);
      return sleep(700).then(() => ({ missing: [], modified: [], added: [], total: (m?.installed_files || []).length, is_valid: true }));
    },
  });
}

/** Choose an option of a (custom-select enhanced) <select> by its value: open, then click it. */
async function choose(h, selectSel, value) {
  const idx = await h.eval((s, v) => {
    const sel = document.querySelector(s);
    return sel ? [...sel.options].findIndex((o) => o.value === v) : -2;
  }, selectSel, value);
  if (idx === -2) throw new Error(`no select ${selectSel}`);
  if (idx < 0) throw new Error(`${selectSel} has no option ${value}`);
  const enhanced = await h.eval((s) => !!document.querySelector(s)?.nextElementSibling?.matches('.bmm-csel'), selectSel);
  if (!enhanced) {
    await h.click(selectSel, { pause: 300 });
    await h.eval((s, v) => { const sel = document.querySelector(s); sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); }, selectSel, value);
    return;
  }
  const trig = await h.page.evaluateHandle((s) => document.querySelector(s).nextElementSibling.querySelector('.bmm-csel-trigger'), selectSel);
  await h.click(trig.asElement(), { pause: 600 });
  await h.click(await h.nth('.bmm-csel-menu-open .bmm-csel-opt', idx), { pause: 700 });
}

/** A row of the Mapper's mod tree by its relative path (`\` separated). */
const modRow = (p) => `#mapper-mod-tree .tree-item[data-path="${p.replace(/\\/g, '\\\\')}"]`;

/** Open the final preview, let it be read, close it with Back (or apply). */
async function preview(h, { apply = false, read = 2600 } = {}) {
  await h.click('#btn-mapper-preview', { pause: 900 });
  await until(h, () => !!document.querySelector('.mpv2-overlay .mpv2-row'), { what: 'the final preview' });
  await wait(read);
  await h.click(apply ? '#mpv2-apply' : '#mpv2-back', { pause: 800 });
}

export const fixAMod = {
  name: 'fix-a-mod',
  title: { en: 'Fix a badly packaged mod', fr: 'Réparer un mod mal empaqueté' },
  desc: {
    en: 'A mod whose archive puts its files one folder too deep: the Mapper shows where they would land, the root is moved, the result checked and the mod updated.',
    fr: 'Un mod dont l’archive range ses fichiers un dossier trop bas : le Mapper montre où ils arriveraient, la racine est déplacée, le résultat vérifié et le mod mis à jour.',
  },
  topics: ['basics/map', 'basics/moddetails', 'basics/integrity'],
  docs: ['features/mapper', 'how-it-works/mapper', 'features/library'],
  pageInit: [world, mapperWorld],
  async setup(h) {
    await h.nav('library', 1500);
    await stageArchive(h, LANTERN);
    await h.eval((a) => { for (const f of a.files) window.__demo.sizes[`${a.id}|${f.path}`] = f.size; }, LANTERN);
  },
  steps: [
    {
      id: 'add',
      title: { en: 'Add the mod from its archive', fr: 'Ajouter le mod depuis son archive' },
      topics: ['basics/scan'], docs: ['features/library'],
      async run(h) {
        await h.click('#btn-add-mod', { pause: 900 });
        await pick(h, `D:\\Downloads\\${LANTERN.file}`);
        await h.click('#btn-pick-mod-archive', { pause: 1500 });
        await until(h, () => !!document.querySelector('#modal-add-mod .am-stats'), { what: 'the archive preview' });
        // « Contains: Lantern Mod v2/ », where the other mods have Data/: the first hint.
        await h.move('#modal-add-mod .am-top', 700);
        await wait(2000);
        await h.click('#mod-name', { pause: 200 });
        await h.combo('Control', 'a', 150);
        await h.type(null, 'Lantern Mod', { delay: 65 });
        await wait(500);
        await h.click('#btn-confirm-add-mod', { pause: 400 });
        await until(h, () => !document.getElementById('modal-add-mod')?.classList.contains('open'), { timeout: 10000, what: 'the copy to finish' });
        await wait(1200);
      },
    },
    {
      id: 'see-problem',
      title: { en: 'See where its files would land', fr: 'Voir où ses fichiers arriveraient' },
      topics: ['basics/map'], docs: ['features/mapper', 'how-it-works/mapper'],
      async run(h) {
        await h.click('#nav-mapper', { pause: 1400 });
        await until(h, () => [...(document.getElementById('mapper-mod-select')?.options || [])].some((o) => o.value === 'nw-lantern'), { what: 'the mod list of the Mapper' });
        await choose(h, '#mapper-mod-select', 'nw-lantern');
        await until(h, () => !!document.querySelector('#mapper-mod-tree .tree-item[data-path="Lantern Mod v2"]'), { what: 'the mod tree' });
        await wait(800);
        // Inside: another folder, then Data. The game reads Data at its root.
        await h.click(modRow('Lantern Mod v2'), { pause: 700 });
        await h.click(modRow('Lantern Mod v2\\Lantern Mod'), { pause: 900 });
        await wait(600);
        // The final preview: every file in a « Lantern Mod v2 » folder of the game.
        await preview(h, { read: 3200 });
      },
    },
    {
      id: 'move-root',
      title: { en: 'Move Data up to the game folder', fr: 'Remonter Data dans le dossier du jeu' },
      topics: ['basics/map'], docs: ['features/mapper', 'how-it-works/mapper'],
      async run(h) {
        await h.click(modRow('Lantern Mod v2\\Lantern Mod\\Data'), { pause: 900 });
        // Double-click the game root: the selection is queued to land there.
        await h.move('#mapper-game-tree .game-root-target', 700);
        await wait(300);
        await h.page.mouse.down(); await h.page.mouse.up();
        await h.eval(() => document.querySelector('#mapper-game-tree .game-root-target').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        await until(h, () => !!document.querySelector('#mapper-mod-tree .pending-badge'), { what: 'the queued move' });
        await wait(1600);
        // Checked before anything moves: now under Data, one texture replacing the game's own.
        await preview(h, { apply: true, read: 3400 });
        await until(h, () => window.__demo.mods.find((m) => m.id === 'nw-lantern')?.installed_files.some((f) => f.startsWith('Data/')), { what: 'the move to be applied' });
        await until(h, () => !!document.querySelector('#mapper-mod-tree .tree-item[data-path="Data"]'), { what: 'the refreshed tree' });
        await wait(1400);
      },
    },
    {
      id: 'tidy',
      title: { en: 'Remove the empty wrapper', fr: 'Supprimer le dossier vide qui restait' },
      topics: ['basics/map'], docs: ['features/mapper'],
      async run(h) {
        await h.move(modRow('Lantern Mod v2'), 700);
        await h.page.mouse.click(h.mouse.x, h.mouse.y, { button: 'right' });
        await until(h, () => getComputedStyle(document.getElementById('mapper-context-menu')).display !== 'none', { what: 'the context menu' });
        await wait(700);
        await h.click('#ctx-mapper-delete', { pause: 900 });
        await h.click('#btn-mapper-confirm-ok', { pause: 1000 });
        await until(h, () => !!document.querySelector('#mapper-mod-tree .pending-delete'), { what: 'the folder marked for deletion' });
        await wait(1200);
        await h.click('#btn-mapper-save', { pause: 900 });
        await until(h, () => !document.querySelector('#mapper-mod-tree .tree-item[data-path="Lantern Mod v2"]'), { what: 'the wrapper to be removed' });
        await wait(1400);
      },
    },
    {
      id: 'details',
      title: { en: 'Fill in the mod’s details', fr: 'Compléter la fiche du mod' },
      topics: ['basics/moddetails'], docs: ['features/library'],
      async run(h) {
        await h.click('#nav-library', { pause: 1300 });
        await h.click('.mod-card[data-id="nw-lantern"] .mod-name, .mod-card[data-id="nw-lantern"]', { pause: 1200 });
        await until(h, () => !!document.getElementById('mod-detail-panel'), { what: 'the mod details' });
        await wait(700);
        await h.click('#mdd-tab-details', { pause: 900 });
        await h.click('#detail-version', { pause: 200 });
        await h.combo('Control', 'a', 150);
        await h.type(null, '2.0.1', { delay: 90 });
        await h.type('#detail-author', 'Ilsabeth', { delay: 70 });
        await h.type('#detail-desc', 'Carryable lanterns that flicker in the wind and creak on the move.', { delay: 32 });
        await h.click('#mdd-tab-updates', { pause: 1000 });
        await h.click('#btn-add-link', { pause: 600 });
        await h.type('#detail-links-list > div:last-child .detail-link-url', 'https://example.org/mods/lantern-mod', { delay: 38 });
        await h.type('#detail-links-list > div:last-child .detail-link-label', 'Mod page', { delay: 60 });
        await wait(500);
        await h.click('#btn-save-detail', { pause: 1400 });
        await until(h, () => window.__demo.mods.find((m) => m.id === 'nw-lantern')?.version === '2.0.1', { what: 'the details to be saved' });
        await wait(1200);
      },
    },
    {
      id: 'integrity',
      title: { en: 'Hash its files and check them', fr: 'Hacher ses fichiers et les vérifier' },
      topics: ['basics/integrity'], docs: ['features/library', 'how-it-works/integrity-hashing'],
      async run(h) {
        await h.click('#mdd-tab-files', { pause: 1000 });
        await until(h, () => !!document.getElementById('btn-verify-mod-integrity'), { what: 'the verify button' });
        await h.click('#btn-verify-mod-integrity', { pause: 900 });
        await until(h, () => !!document.querySelector('.modal-overlay.open .shc-report'), { timeout: 9000, what: 'the integrity report' });
        await wait(3000);
      },
    },
  ],
};
