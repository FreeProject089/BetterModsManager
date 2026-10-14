// The usage clips recorded by gifs.mjs: one entry per GIF. Demo data only (example.org, the
// 192.168.1.x LAN, « Demo » paths).
//
//   name     file name (<name>.gif / .mp4)
//   title    one line for VISUALS.md and gifs.json; desc: what the clip shows
//   mock     { command: value | (args, state, fixtures) => value | Promise } answered in the page
//            in front of the fixtures (functions are serialised: no outer variables)
//   storage  localStorage entries set before boot
//   setup(h) brings the app where the clip starts (not recorded); run(h) is the recorded part
//   speed    play the recording this much faster (default 1); tail: ms recorded after run
//   skip     a reason: the scene is listed but not recorded
// h: move(target), click(target), type(target|null, text), key(k), combo(mod, k), scroll(target, px),
//    byText(selector, /re/), nth(selector, i), nav(view), tap(selector), eval(fn), sleep(ms), page.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Conflicts ────────────────────────────────────────────────────────────────────────────────
// `conflict_plan` is answered by a small model of the backend rule (mod_order.rs winner_of):
// a pinned copy wins, else the mod applied LAST. Enough to show « make X win » honestly.
const conflictPlan = (args, st) => {
  const names = { 'demo-mod-01': 'Enhanced Textures', 'demo-mod-02': 'Weather Overhaul', 'demo-mod-03': 'Quiet Footsteps', 'demo-mod-04': 'Extended Inventory' };
  const T = ['demo-mod-01', 'demo-mod-02'];
  const files = [
    ['Data/textures/sky/clouds_01.dds', T], ['Data/textures/sky/clouds_02.dds', T], ['Data/textures/sky/sunset.dds', T],
    ['Data/textures/water/ripple.dds', T], ['Data/textures/terrain/rock_01.dds', T], ['Data/lighting/sun.ini', T],
    ['Data/ui/hud.xml', ['demo-mod-01', 'demo-mod-04']], ['Data/ui/inventory_grid.xml', ['demo-mod-01', 'demo-mod-04']],
    ['Data/sound/footsteps_rain.wav', ['demo-mod-02', 'demo-mod-03']],
  ].map(([path, mods]) => ({ path, mods }));
  const saved = st.cvSaved || ['demo-mod-01', 'demo-mod-02', 'demo-mod-03', 'demo-mod-04'];
  const order = Array.isArray(args.order) ? args.order : saved;
  const pins = args.pins || {}, off = args.disable || [];
  const win = (f, ord, p, d) => {
    const live = f.mods.filter((m) => !d.includes(m));
    if (p[f.path] && live.includes(p[f.path])) return p[f.path];
    return live.slice().sort((a, b) => ord.indexOf(b) - ord.indexOf(a))[0] || '';
  };
  const out = files.map((f) => ({ path: f.path, mods: f.mods, winner: win(f, order, pins, off), pinned: !!pins[f.path] }));
  const pairs = new Map();
  for (const f of out) {
    const [a, b] = f.mods.slice().sort();
    const k = `${a}|${b}`;
    const p = pairs.get(k) || { a, b, files: 0, a_wins: 0, b_wins: 0, pinned: 0 };
    p.files++; if (f.winner === a) p.a_wins++; if (f.winner === b) p.b_wins++; if (f.pinned) p.pinned++;
    pairs.set(k, p);
  }
  const handovers = files.map((f) => ({ path: f.path, from: win(f, saved, {}, []), to: win(f, order, pins, off) })).filter((m) => m.from !== m.to);
  return { profile_id: 'demo-profile-main', order, names, pins, files: out, files_total: out.length, pairs: [...pairs.values()], handovers, handovers_total: handovers.length };
};

const MORE = [
  {
    name: 'resolve-conflict',
    title: 'Resolve a conflict',
    desc: 'The conflicts view from a library badge: « Make Enhanced Textures win », preview the files that change hands, Apply.',
    mock: {
      conflict_plan: conflictPlan,
      conflict_apply: (args, st) => new Promise((ok) => setTimeout(() => { st.cvSaved = args.order; ok(6); }, 1100)),
    },
    async setup(h) { await h.nav('library', 1500); },
    async run(h) {
      await h.click('.tag-intra-conflict', { pause: 1400 });
      await h.click(await h.byText('.cv-modal [data-cv="win"]', /Enhanced Textures/), { pause: 1300 });
      await h.click('.cv-modal [data-cv="moves"]', { pause: 1800 });
      await h.click('.cv-modal [data-cv="apply"]', { pause: 1900 });
    },
  },
  {
    name: 'activity-centre',
    title: 'Activity centre',
    desc: 'Long jobs show in the title bar ring; the panel lists them live and one is cancelled.',
    async setup(h) { await h.nav('library', 1500); },
    async run(h) {
      await h.eval(async () => {
        const a = await import('/js/core/activity.js');
        window.__gifJobs = (o, speed, endText) => {
          let p = 0, stop = false;
          const j = a.startActivity({ ...o, progress: 0, cancel: () => { stop = true; j.cancelled(); } });
          const tick = setInterval(() => {
            if (stop) { clearInterval(tick); return; }
            p = Math.min(1, p + speed);
            j.update({ progress: p });
            if (p >= 1) { clearInterval(tick); j.done(endText); }
          }, 250);
        };
        window.__gifJobs({ kind: 'sync', title: 'Sync « Community Pack »', detail: 'Downloading 3 of 7 files' }, 0.012, '7 files');
      });
      await wait(900);
      await h.eval(() => window.__gifJobs({ kind: 'hash', title: 'Integrity check: Playthrough', detail: 'Hashing Enhanced Textures' }, 0.03, 'All files match'));
      await wait(700);
      await h.eval(() => window.__gifJobs({ kind: 'export', title: 'Export modpack « Weekend »', detail: 'Packing 4 mods' }, 0.05, 'Saved'));
      await wait(900);
      await h.click('#btn-activity-center', { pause: 2200 });
      const cancel = await h.page.evaluateHandle(() => {
        const items = [...document.querySelectorAll('#activity-center-panel [data-cancel]')];
        return items.find((b) => /Community Pack/.test(b.closest('li, .actc-item, .actc-row')?.textContent || '')) || items[0] || null;
      });
      if (cancel.asElement()) await h.click(cancel.asElement(), { pause: 2200, quick: true });
      await wait(1500);
    },
  },
  {
    name: 'theme-editor',
    speed: 1.2,
    title: 'Theme editor',
    desc: 'Start from a built-in theme, generate a palette from one colour, fix the contrast it flags, save it as a new theme.',
    async setup(h) {
      await h.nav('settings', 1800);
      await h.eval(() => document.getElementById('btn-open-theme-editor')?.scrollIntoView({ block: 'center' }));
      await wait(500);
    },
    async run(h) {
      await h.click('#btn-open-theme-editor', { pause: 1300 });
      await h.click('#bmm-theme-editor [data-bte="starter"][data-id="bmm-cobalt"]', { pause: 1100 });
      // The colour well opens the system picker, which a recording cannot show: the value is set.
      await h.move('#bte-gen-colour', 600);
      await h.eval(() => { const i = document.getElementById('bte-gen-colour'); i.value = '#f59e0b'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
      await wait(500);
      await h.click('#bmm-theme-editor [data-bte="generate"]', { pause: 1300 });
      // A muted text too dark for its background: the contrast list flags it and offers a fix.
      await h.click('#bmm-theme-editor .bte-row[data-row="--bmm-text-muted"] input.bte-input', { pause: 200 });
      await h.combo('Control', 'a', 100);
      await h.type(null, '#3f4a5c', { delay: 80 });
      await h.key('Tab', 1300);
      await h.click('#bmm-theme-editor [data-bte="fix-all"]', { pause: 1400 });
      await h.click('#bte-save', { pause: 900 });
      await h.combo('Control', 'a', 150);
      await h.type(null, 'Golden Hour', { delay: 70 });
      await wait(400);
      await h.key('Enter', 1800);
    },
  },
  {
    name: 'create-plugin',
    speed: 1.3,
    title: 'Create a plugin',
    desc: 'Plugins & API → Create: pick a template, fill in the identity, choose permissions, check the live preview.',
    async setup(h) { await h.nav('plugins', 1800); },
    async run(h) {
      await h.click('#view-plugins [data-tab="create"]', { pause: 1100 });
      await h.click('.pc-tpl[data-tpl="server"]', { pause: 900 });
      await h.type('#pc-name', 'Weekend Server Mods', { delay: 55 });
      await h.type('#pc-game', 'Demo Game', { delay: 55 });
      await h.type('#pc-desc', 'Our weekend server mods.', { delay: 40 });
      await wait(500);
      await h.click('.pc-step[data-step="perms"]', { pause: 1100 });
      for (const i of [0, 1]) await h.click(await h.nth('#pc-perms .pc-perm-cb', i), { pause: 500 });
      await wait(600);
      await h.move('#pc-pv-name', 700);
      await wait(900);
    },
  },
  {
    name: 'bmm-tools',
    speed: 1.12,
    title: 'BMM Tools',
    desc: 'Ctrl+K → BMM Tools, search « disk », run Disk usage, copy the result as JSON.',
    async setup(h) {
      await h.nav('library', 1500);
      await h.page.browserContext().overridePermissions(new URL(h.page.url()).origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
    },
    async run(h) {
      await h.combo('Control', 'k', 900);
      await h.type(null, 'tools', { delay: 90 });
      await wait(700);
      await h.key('Enter', 1400);
      await h.type('#tools-search', 'disk', { delay: 110 });
      await wait(600);
      await h.click('.tools-rail-item[data-tool="disk"]', { pause: 800 });
      await h.click('.tools-pane [data-act="run"]', { pause: 2200 });
      await h.scroll('.tools-pane', 240, 800);
      await wait(600);
      await h.click('.tools-pane [data-act="copy"]', { pause: 1300 });
    },
  },
  {
    name: 'notifications',
    title: 'Notifications',
    desc: 'A few toasts arrive; the bell opens the centre, grouped by source; one is snoozed for an hour; Do not disturb goes on.',
    async setup(h) {
      await h.nav('library', 1500);
      // The preview boot leaves notices of its own (no keyring in a browser): not part of the clip.
      await h.eval(async () => (await import('/js/ui/notification-center.js')).clearAll());
    },
    async run(h) {
      await h.eval(() => window.toast('Community Pack: 2 mods have an update', 'info', 3500, '', 'Repo'));
      await wait(1100);
      await h.eval(() => window.toast('Save Keeper 1.8.1 installed', 'success', 3500, '', 'Apps'));
      await wait(1100);
      await h.eval(() => window.toast('Disk space low on D: (4.2 GB left)', 'warning', 3500, '', 'BMM'));
      await wait(2600);
      await h.click('#btn-notif-center', { pause: 1600 });
      await h.click('.nc-item [data-snooze-menu]', { pause: 800 });
      await h.click('[data-snooze="1h"]', { pause: 1300 });
      await h.click('#nc-dnd', { pause: 1300 });
    },
  },
  {
    name: 'settings',
    speed: 1.15,
    title: 'Settings',
    desc: 'Ctrl+F finds a setting; the index edits the page layout (hide a card, move one), then folds away.',
    async setup(h) { await h.nav('settings', 2000); },
    async run(h) {
      await h.combo('Control', 'f', 600);
      await h.type(null, 'backup', { delay: 110 });
      await wait(1800);
      await h.click('#settings-search-clear', { pause: 900 });
      await h.click('#settings-index-foot .stg-foot-edit', { pause: 1000 });
      // First group (rows follow its heading): hide the 5th card, then move the 3rd one up.
      const row = (n) => `#settings-index-nav .stg-nav-group:first-child .stg-nav-row:nth-child(${n + 1}) button`;
      await h.click(await h.nth(row(5), -1), { pause: 1000 });
      await h.click(await h.nth(row(3), 1), { pause: 1100 });
      await h.click('#settings-index-foot .stg-foot-done', { pause: 900 });
      await h.click('#settings-index-hide', { pause: 1500 });
      await h.click('#settings-index-show', { pause: 600 });
    },
  },
];

export const gifScenes = [
  {
    name: 'follow-repo',
    title: 'Follow a repo',
    desc: 'Server Repo → Followed repos → « Follow a repo »: type a LAN address, test it, follow it.',
    mock: {
      key_auth_list: { keys: [] },
      repo_addr_normalize: (args) => {
        const raw = String(args.input || '').trim();
        const m = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?/i.exec(raw);
        if (!m || !m[2]) throw new Error('repo.addr.errEmpty');
        const scheme = (m[1] || 'http').toLowerCase();
        const port = m[3] ? +m[3] : null;
        const base = `${scheme}://${m[2]}${port ? `:${port}` : ''}`;
        const lan = /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(m[2]);
        return { manifestUrl: `${base}/repo.json`, baseUrl: base, scheme, host: m[2], port, kind: lan ? 'lan' : 'public', note: scheme === 'https' ? null : (lan ? 'lanHttp' : 'publicHttp') };
      },
      repo_follow_probe: (args) => new Promise((ok) => setTimeout(() => ok({
        addr: { manifestUrl: args.url, baseUrl: String(args.url).replace(/\/repo\.json$/, ''), scheme: 'http', host: '192.168.1.20', port: 8000, kind: 'lan', note: 'lanHttp' },
        name: 'LAN Party Pack', version: '1.4.0', author: 'Demo Host', game: 'Demo Game', format: '2', discovered: false,
        signature: 'valid', profiles: 2, mods: 14, alreadyFollowed: false, hasPassword: false,
      }), 1300)),
      repo_follow_list: (_a, st) => {
        st.followed = st.followed || [{ url: 'https://mods.example.org', name: 'Community Pack', due: false,
          follow: { enabled: true, intervalMin: 360, action: 'notify', lastCheck: new Date(Date.now() - 42 * 60000).toISOString(), lastVersion: '3.2.0', lastUpdates: 2, lastError: null } }];
        return st.followed;
      },
      repo_follow_set: (args, st) => {
        st.followed = st.followed || [];
        const p = args.patch || {};
        st.followed.push({ url: args.url, name: args.name || '', due: false,
          follow: { enabled: true, intervalMin: p.intervalMin || 360, action: p.action || 'notify', lastCheck: new Date().toISOString(), lastVersion: '1.4.0', lastUpdates: 0, lastError: null } });
        return null;
      },
    },
    async setup(h) {
      await h.nav('repo');
      await h.tap('[data-repo-tab="sync"]');
      await wait(900);
      await h.eval(() => document.getElementById('repo-follow-card')?.scrollIntoView({ block: 'center' }));
      await wait(600);
    },
    async run(h) {
      await h.click('#btn-repo-follow-add', { pause: 700 });
      await h.type(null, '192.168.1.20:8000', { delay: 85 });
      await wait(700);
      await h.click('.rdlg-modal [data-r="test"]');
      await wait(2300);
      await h.move('.rdlg-modal [data-r="mode-hint"]', 500);
      await wait(500);
      await h.click('.rdlg-modal [data-r="save"]', { pause: 900 });
      await h.scroll('#repo-follow-list', 260, 700);
      await wait(1400);
    },
    tail: 600,
  },
  ...MORE,
];
