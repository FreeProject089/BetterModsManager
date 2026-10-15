// « Share a setup with friends »: the Main playthrough profile of Northwind Saga becomes a
// modpack, the modpack becomes a signed Server Repo hosted on the LAN, and a friend joins it by
// its address, downloads it, then follows it so the next change arrives by itself.
//
// One app plays both PCs (the host at 192.168.1.20, then the friend): the step titles say which.
// The world (world.mjs) gives the profiles and the mods; shareMocks below answers what the
// Modpacks and Server Repo pages ask the backend, from the same state, as commands/modpack*.rs,
// repo*.rs and repo_follow.rs would (shapes checked against the Rust structs: LocalModpack,
// ModpackModRef, ServerRepo, RepoProfile, RepoMod, SyncSummary, the follow commands' camelCase).
import { world, pick, until } from './world.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PACK = 'Northwind co-op';
const HOST = '192.168.1.20';
const REPO_DIR = 'D:\\Modding\\Repos\\Northwind co-op';

/** In the page, after world(): the modpack, repo, server, sync and follow commands. */
function shareMocks() {
  const st = window.__demo;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MB = st.MB;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  // A stable fake SHA-256 per text (what the backend hashes is a file; here a name will do).
  const hex = (s) => {
    let out = '';
    for (let k = 0; out.length < 64; k++) {
      let h = 2166136261 ^ k;
      for (const c of `${s}#${k}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
      out += (h >>> 0).toString(16).padStart(8, '0');
    }
    return out.slice(0, 64);
  };
  // A mod's files with sizes that add up to its size (the big ones get the most).
  const filesOf = (m) => {
    const list = m.installed_files || [];
    const w = list.map((f) => (/\.(dds|wav|fx)$/i.test(f) ? 40 : 1));
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    return list.map((f, i) => ({ path: f, size: Math.max(2048, Math.round((m.size_bytes || MB) * w[i] / sum)) }));
  };
  const profileOf = (m) => st.profiles.find((p) => m.mod_folder_path.toLowerCase().startsWith(p.mods_path.toLowerCase() + '\\'));
  st.packs = st.packs || [];
  st.followed = st.followed || [];
  st.server = null;
  st.repo = null;
  st.checks = 0;

  const repoMod = (m) => ({
    id: m.id, name: m.name, version: m.version, author: m.author, description: m.description,
    tags: (m.tags || []).map((t) => ({ id: t, name: t, color_bg: '#1f2937', color_text: '#e5e7eb' })),
    files: filesOf(m).map((f) => ({ relative_path: f.path, size: f.size, sha256_hash: hex(m.id + f.path), chunks: null })),
    archive: null, download_links: [], dependencies: [], changelog: null, update_url: null, direct_url: null, update_sources: [],
  });

  Object.assign(window.__gifMock, {
    // ── Modpacks (commands/modpack.rs) ──
    load_modpacks: () => clone(st.packs),
    find_local_mods_by_hashes: (a) => Object.fromEntries((a.hashes || []).map((h) => [h, st.mods.find((m) => hex(m.id) === h)?.id || null])),
    build_modpack_mod_ref: (a) => {
      const m = st.mods.find((x) => x.id === a.modId);
      if (!m) throw new Error('mod not found');
      const p = st.profiles.find((x) => x.id === a.profileId) || profileOf(m);
      const ref = {
        mod_id: m.id, mod_name: m.name, mod_version: m.version, profile_id: p?.id || null, profile_name: p?.name || null,
        sha256: hex(m.id), file_manifest: filesOf(m).map((f) => ({ relative_path: f.path, sha256: hex(m.id + f.path), size: f.size })),
        include_dependencies: !!a.includeDependencies, download_link: a.downloadLink || null, fallback_link: a.fallbackLink || null, fallback_type: a.fallbackType || 'direct',
      };
      // Hashing a mod takes a moment: the bigger, the longer (capped).
      return sleep(Math.min(700, 180 + (m.size_bytes || 0) / (1200 * MB) * 500)).then(() => ref);
    },
    save_modpack: (a) => {
      const p = clone(a.modpack || {});
      const now = new Date().toISOString();
      if (!p.id) p.id = `mp-${String(p.name || 'pack').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${st.nextId++}`;
      p.created_at = p.created_at || now;
      p.updated_at = now;
      st.packs = [...st.packs.filter((x) => x.id !== p.id), p];
      return sleep(450).then(() => null);
    },
    export_modpack: () => null,
    get_creator_id: () => 'bmm-7f3a-91c2',
    get_salted_creator_id: () => 'bmm-7f3a-91c2',

    // ── Hosting (commands/repo*.rs, repo_format.rs, server) ──
    repo_format_inspect: (a) => {
      const path = String(a.path || '').replace(/[\\/]+$/, '');
      if (!st.repo || path.toLowerCase() !== String(st.repoDir || '').toLowerCase()) throw new Error('No repo.json in this folder');
      return { manifestPath: `${path}\\repo.json`, info: { version: '1.0', declared: true, status: 'current', missing: [] }, label: 'format 1.0', current: '1.0', signed: true };
    },
    write_text_file: (a) => {
      const path = String(a.path || '');
      if (/repo\.json$/i.test(path)) { st.repoDraft = JSON.parse(a.content || '{}'); st.repoDir = path.replace(/[\\/]repo\.json$/i, ''); }
      return null;
    },
    update_server_repo: (a) => {
      const add = (a.ops && a.ops.add_profiles) || [];
      const profiles = add.map(({ profile_id, mod_ids }) => {
        const p = st.profiles.find((x) => x.id === profile_id);
        return { id: `rp-${profile_id}`, name: p?.name || profile_id, game_name: p?.game_name || '', icon: null, color: p?.color || null, icon_image: null,
          mods: mod_ids.map((id) => st.mods.find((m) => m.id === id)).filter(Boolean).map(repoMod) };
      });
      const d = st.repoDraft || {};
      st.repo = {
        name: d.name || 'Repo', description: d.description || null, author: a.authorName || null, author_id: 'bmm-7f3a-91c2',
        signature: `ed25519:${hex('sig' + d.name).slice(0, 48)}`, version: '1.0.0', game_name: d.game_name || '', created_at: new Date().toISOString(),
        seed: null, upload_limit: null, require_login: false, profiles, modpacks: [], extras: [], icon: null,
      };
      const n = profiles.reduce((s, p) => s + p.mods.length, 0);
      // Copying the mods into the repo folder and hashing them.
      return sleep(2400).then(() => ({ mods_added: n, mods_updated: 0, mods_removed: 0 }));
    },
    repo_modpacks_apply: (a) => {
      if (st.repo) st.repo.modpacks = clone(a.shares || []);
      return (a.shares || []).length;
    },
    get_repo_require_login: () => false,
    set_repo_require_login: () => null,
    set_repo_busy: () => null,
    start_repo_server: (a) => {
      st.server = { port: a.port || 8000, path: a.path };
      return sleep(1300).then(() => ({ lan_url: `http://192.168.1.20:${st.server.port}`, public_url: null, upnp_success: false, tunnel_url: null, seed: null }));
    },
    get_repo_server_status: () => (st.server ? { port: st.server.port, lan_url: `http://192.168.1.20:${st.server.port}`, public_url: null, tunnel_url: null } : null),
    stop_repo_server: () => { st.server = null; return null; },

    // ── Joining, on the friend's PC (commands/repo.rs) ──
    fetch_repo_info: () => {
      if (!st.repo || !st.server) return sleep(700).then(() => { throw new Error('tcp connect error: connection refused'); });
      return sleep(900).then(() => clone(st.repo));
    },
    verify_repo_signature: () => true,
    sync_server_repo: (a) => {
      const args = a.args || {};
      const repo = st.repo;
      const picked = (args.choices || []).flatMap((c) => {
        const rp = repo?.profiles.find((p) => p.id === c.repoProfileId);
        return (rp?.mods || []).filter((m) => !c.selectedModIds || c.selectedModIds.includes(m.id)).map((m) => ({ rp, m }));
      });
      const name = picked[0]?.rp?.name || repo?.name || '';
      if (args.keepActiveProfile) {
        // A followed repo's update (repo-follow.ts install): the changed files only.
        return sleep(1600).then(() => ({ profiles: [{ name, mods_added: 0, mods_updated: picked.length, mods_removed: 0, files_downloaded: picked.length * 3, bytes_downloaded: 212 * MB }], signature: 'valid' }));
      }
      // The sync screen listens for bmm://repo-sync-progress; the preview has no event bus, so
      // the same fields that listener fills are filled here, file by file.
      const files = picked.flatMap(({ m }) => m.files.map((f) => ({ mod: m.name, f })));
      const total = files.reduce((s, x) => s + x.f.size, 0) || 1;
      const $ = (id) => document.getElementById(id);
      return (async () => {
        let done = 0;
        const t0 = Date.now();
        for (const x of files) {
          done += x.f.size;
          const pct = Math.min(99, Math.round(done / total * 100));
          if ($('repo-sync-status')) $('repo-sync-status').textContent = `${x.mod}`;
          if ($('repo-sync-details')) $('repo-sync-details').textContent = x.f.relative_path;
          if ($('repo-sync-percent')) $('repo-sync-percent').textContent = `${pct}%`;
          if ($('repo-sync-progress-fill')) $('repo-sync-progress-fill').style.width = `${pct}%`;
          await sleep(Math.max(60, Math.min(420, x.f.size / (4 * MB))));
          if (Date.now() - t0 > 6000) break;
        }
        const rows = new Map();
        for (const { rp, m } of picked) {
          const r = rows.get(rp.id) || { name: rp.name, mods_added: 0, mods_updated: 0, mods_removed: 0, files_downloaded: 0, bytes_downloaded: 0 };
          r.mods_added++; r.files_downloaded += m.files.length; r.bytes_downloaded += m.files.reduce((s, f) => s + f.size, 0);
          rows.set(rp.id, r);
        }
        st.synced = true;
        return { profiles: [...rows.values()], signature: 'valid' };
      })();
    },

    // ── Following (commands/repo_follow.rs) ──
    key_auth_list: { keys: [] },
    repo_addr_normalize: (a) => {
      const raw = String(a.input || '').trim();
      const m = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?/i.exec(raw);
      if (!m || !m[2]) throw new Error('repo.addr.errEmpty');
      const scheme = (m[1] || 'http').toLowerCase();
      const port = m[3] ? +m[3] : null;
      const base = `${scheme}://${m[2]}${port ? `:${port}` : ''}`;
      const lan = /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(m[2]);
      return { manifestUrl: `${base}/repo.json`, baseUrl: base, scheme, host: m[2], port, kind: lan ? 'lan' : 'public', note: scheme === 'https' ? null : (lan ? 'lanHttp' : 'publicHttp') };
    },
    repo_follow_probe: (a) => sleep(1100).then(() => {
      const r = st.repo || {};
      const mods = (r.profiles || []).reduce((s, p) => s + p.mods.length, 0);
      return {
        addr: { manifestUrl: a.url, baseUrl: String(a.url).replace(/\/repo\.json$/, ''), scheme: 'http', host: '192.168.1.20', port: 8000, kind: 'lan', note: 'lanHttp' },
        name: r.name || '', version: r.version || '1.0.0', author: r.author || '', game: r.game_name || '', format: '1.0', discovered: false,
        signature: 'valid', profiles: (r.profiles || []).length, mods, alreadyFollowed: st.followed.some((f) => f.url === a.url.replace(/\/repo\.json$/, '')), hasPassword: false,
      };
    }),
    repo_follow_list: () => clone(st.followed),
    repo_follow_set: (a) => {
      const p = a.patch || {};
      let f = st.followed.find((x) => x.url === a.url);
      if (!f) {
        f = { url: a.url, name: a.name || '', due: false, hasPassword: false,
          follow: { enabled: true, intervalMin: 360, action: 'notify', lastCheck: new Date().toISOString(), lastVersion: st.repo?.version || null, lastUpdates: 0, lastError: null } };
        st.followed.push(f);
      }
      if (a.name) f.name = a.name;
      Object.assign(f.follow, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
      return clone(f);
    },
    repo_follow_due: () => [],
    // The host has since moved HD Texture Pack to 3.3.0 and set the repo to 1.0.1: the first
    // check finds it, the check after the download finds nothing left.
    repo_follow_check: (a) => {
      const f = st.followed.find((x) => x.url === a.url) || st.followed[0];
      const first = st.checks++ === 0;
      const updates = first ? [{ mod_id: 'nw-hd-textures', name: 'HD Texture Pack', new_version: '3.3.0' }] : [];
      if (f) Object.assign(f.follow, { lastCheck: new Date().toISOString(), lastVersion: '1.0.1', lastUpdates: updates.length, lastError: null });
      const rp = st.repo?.profiles[0];
      return sleep(first ? 1200 : 300).then(() => ({
        url: a.url, name: f?.name || st.repo?.name || '', notModified: false, version: '1.0.1', updates, action: f?.follow.action || 'notify', error: null, gameRunning: false,
        plan: updates.length && rp ? [{ localProfileId: 'prof-friend-coop', repoProfileId: rp.id, repoModIds: ['nw-hd-textures'], localModIds: ['nw-hd-textures'], enabledLocalIds: [] }] : [],
      }));
    },
  });
}

/** Pick an option, by its value, of a select the app draws as a custom dropdown
 *  (ui/custom-select.ts): the trigger opens the menu, the option is clicked by its place. */
async function choose(h, select, value) {
  const idx = await h.eval((s, v) => [...(document.querySelector(s)?.options || [])].findIndex((o) => o.value === v), select, value);
  if (idx < 0) throw new Error(`no option ${value} in ${select}`);
  await h.click(`${select} + .bmm-csel .bmm-csel-trigger`, { pause: 550 });
  await h.click(`.bmm-csel-menu-open .bmm-csel-opt[id$="-opt-${idx}"]`, { pause: 600 });
}

export const shareSetup = {
  name: 'share-setup',
  title: { en: 'Share a setup with friends', fr: 'Partager une config avec des amis' },
  desc: {
    en: 'The profile becomes a modpack, the modpack is hosted as a Server Repo on the LAN, a friend follows it by its address and syncs.',
    fr: 'Le profil devient un modpack, le modpack est hébergé en Server Repo sur le réseau local, un ami le suit par son adresse et se synchronise.',
  },
  topics: ['basics/modpacks', 'advanced/repo', 'advanced/modpacks', 'basics/shared'],
  docs: ['features/modpacks', 'features/repo', 'how-it-works/sync-repos'],
  pageInit: [world, shareMocks],
  async setup(h) { await h.nav('modpacks', 1500); },
  steps: [
    {
      id: 'make-modpack',
      title: { en: 'Make a modpack from the profile', fr: 'Faire un modpack depuis le profil' },
      topics: ['basics/modpacks', 'advanced/modpacks'], docs: ['features/modpacks'],
      async run(h) {
        await h.click('#modpack-create-btn', { pause: 900 });
        await until(h, () => !!document.querySelector('#mp-wizard #mp-name'), { what: 'the modpack dialog' });
        await h.type('#mp-name', PACK, { delay: 70 });
        await wait(400);
        await h.type('#mp-desc', 'Our Saturday playthrough: textures, weather, the patch and the companions.', { delay: 30 });
        await wait(600);
        await h.click('#mp-next', { pause: 900 });
        // The profile's enabled mods: what is really played.
        await h.click('#mp-pick-enabled', { pause: 1300 });
        await until(h, () => document.querySelectorAll('#mp-pick-list .mpw-row.is-sel').length >= 6, { what: 'the enabled mods to be picked' });
        await wait(500);
        await h.click('#mp-next', { pause: 1300 });
        await h.click('#mp-next', { pause: 600 });
        // Each picked mod is hashed into the pack (its files, their SHA-256), then the review.
        await until(h, () => !!document.querySelector('#mp-wizard #mp-modlist'), { timeout: 12000, what: 'the review' });
        await wait(1000);
        await h.move('#mp-modlist', 700);
        await wait(1200);
        await h.click('#editor-save', { pause: 900 });
        await until(h, () => !!document.querySelector('.modpack-card'), { what: 'the new modpack card' });
        await wait(1400);
      },
    },
    {
      id: 'make-repo',
      title: { en: 'Turn the modpack into a Server Repo', fr: 'Transformer le modpack en Server Repo' },
      topics: ['advanced/repo', 'advanced/modpacks', 'basics/shared'], docs: ['features/repo', 'features/modpacks'],
      async run(h) {
        await h.click('#nav-repo', { pause: 1300 });
        await h.click('#btn-repo-tab-host', { pause: 1100 });
        await h.click('#repo-quick-create-row .rp-qc-btn', { pause: 1300 });
        await until(h, () => document.querySelector('details.rp-tool[data-tool="quick"]')?.open, { what: 'the quick-create tool' });
        await choose(h, '#repo-quick-kind', 'modpack');
        await until(h, (n) => (document.getElementById('repo-quick-src')?.textContent || '').includes(n), { what: 'the modpack in the list' }, PACK);
        await wait(500);
        await h.type('#repo-quick-author', 'Sam', { delay: 90 });
        await pick(h, REPO_DIR);
        await h.click('#btn-repo-quick-out', { pause: 900 });
        await h.click('#btn-repo-quick-go', { pause: 600 });
        await until(h, () => { const r = document.getElementById('repo-quick-result'); return r && !r.hidden; }, { timeout: 12000, what: 'the repo to be written' });
        await wait(1800);
      },
    },
    {
      id: 'start-server',
      title: { en: 'Host it on the LAN', fr: 'L’héberger sur le réseau local' },
      topics: ['advanced/repo', 'basics/shared'], docs: ['features/repo', 'how-it-works/sync-repos'],
      async run(h) {
        // Back up to the four steps: the folder and its repo.json are ticked off.
        await h.eval(() => document.getElementById('repo-host-flow')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
        await wait(900);
        await until(h, () => document.querySelector('#repo-host-flow [data-flow-step="manifest"]')?.classList.contains('is-done'), { what: 'the repo.json step to be done' });
        await h.move('#repo-host-flow [data-flow-step="manifest"]', 700);
        await wait(1100);
        await h.click('#btn-toggle-repo-server', { pause: 600 });
        await until(h, () => !!document.getElementById('repo-server-url')?.value, { timeout: 8000, what: 'the server address' });
        await wait(800);
        await h.move('#repo-server-url', 800);
        await wait(2000);
      },
    },
    {
      id: 'friend-joins',
      title: { en: 'On a friend’s PC: join by the address', fr: 'Sur le PC d’un ami : rejoindre par l’adresse' },
      topics: ['advanced/repo', 'basics/shared'], docs: ['features/repo', 'how-it-works/sync-repos'],
      async run(h) {
        await h.click('#btn-repo-tab-sync', { pause: 1000 });
        await h.type('#repo-sync-url', `${HOST}:8000`, { delay: 95 });
        await wait(500);
        await h.click('#btn-fetch-repo-info', { pause: 600 });
        await until(h, () => document.getElementById('repo-sync-info-card')?.style.display === 'block', { what: 'the repo card' });
        // Signed by its author, one profile, the shared modpack.
        await wait(1500);
        await h.click('#repo-sync-profiles-selection .rp-pick-mods-h', { pause: 1800 });
        await h.move('#repo-sync-profiles-selection .rp-pick-list--packs', 700);
        await wait(1200);
      },
    },
    {
      id: 'friend-syncs',
      title: { en: 'Choose the folders and sync', fr: 'Choisir les dossiers et synchroniser' },
      topics: ['advanced/repo'], docs: ['how-it-works/sync-repos', 'features/repo'],
      async run(h) {
        await pick(h, 'D:\\Games\\Northwind Saga');
        await h.click('#btn-pick-sync-game', { pause: 600 });
        await pick(h, 'D:\\Modding\\Northwind\\co-op mods');
        await h.click('#btn-pick-sync-mods', { pause: 600 });
        await pick(h, 'D:\\Modding\\Northwind\\co-op backups');
        await h.click('#btn-pick-sync-backup', { pause: 800 });
        await h.click('#btn-start-repo-sync', { pause: 600 });
        await until(h, () => document.getElementById('modal-repo-sync-summary')?.classList.contains('open'), { timeout: 15000, what: 'the sync summary' });
        await wait(2600);
        await h.click('#modal-repo-sync-summary .btn-primary[data-close]', { pause: 700 });
      },
    },
    {
      id: 'friend-follows',
      title: { en: 'Follow it, updates included', fr: 'Le suivre, mises à jour comprises' },
      topics: ['advanced/repo', 'basics/shared'], docs: ['how-it-works/sync-repos', 'features/repo'],
      async run(h) {
        await h.eval(() => document.getElementById('btn-repo-follow-joined')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        await wait(900);
        await h.click('#btn-repo-follow-joined', { pause: 1000 });
        await h.click('.rdlg-modal [data-r="test"]', { pause: 600 });
        await until(h, () => !!document.querySelector('.rdlg-modal .rdlg-result--ok'), { what: 'the test result' });
        await wait(1400);
        // « When there is an update »: download it, not only say so.
        await choose(h, '.rdlg-modal select[name="mode"]', 'download');
        await wait(1100);
        await h.click('.rdlg-modal [data-r="save"]', { pause: 1000 });
        await until(h, () => !!document.querySelector('#repo-follow-list .rp-follow-row'), { what: 'the followed repo' });
        await h.eval(() => document.getElementById('repo-follow-card')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        await wait(1000);
        await h.move('#repo-follow-list .rp-follow-row .rp-follow-id', 700);
        await wait(1500);
      },
    },
    {
      id: 'next-update',
      title: { en: 'Later: the host updates a mod, the friend gets it', fr: 'Plus tard : l’hôte met un mod à jour, l’ami le reçoit' },
      topics: ['advanced/repo'], docs: ['how-it-works/sync-repos'],
      async run(h) {
        // The scheduled check does this on its own; « Check » runs it now. The host has moved
        // HD Texture Pack to 3.3.0: the check finds it, downloads it, and checks again.
        await h.click('#repo-follow-list .rp-follow-row [data-f="check"]', { pause: 600 });
        await until(h, () => window.__demo.checks >= 2 && !!document.querySelector('#repo-follow-list .rp-follow-st.rp-tone--ok'), { timeout: 12000, what: 'the update to be downloaded' });
        await wait(2600);
      },
    },
  ],
};
