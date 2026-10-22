// The screenshot scenes: one entry per picture. `run` drives the page (demo data only) after
// boot; `theme` overrides the run's theme; `readme: false` keeps a picture out of .github/screenshots;
// `pre` runs in the page before the app boots (localStorage), with { lang, theme }.
//
// Every scene is the whole BMM window with Tasky at its top-left corner (shoot.mjs composes it).
// The demo data the pages read comes from fixtures.mjs.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const away = async (p) => { await p.mouse.move(1560, 980); await sleep(600); };
const nav = (v) => async (p) => { await p.click(`#nav-${v}`); await away(p); await sleep(2500); };
/** Click the first element of `sel` whose text or title matches `re` (a RegExp source). */
const clickText = (p, sel, re) => p.evaluate((s, r) => {
  const el = [...document.querySelectorAll(s)].find((x) => new RegExp(r, 'i').test(`${x.title || ''} ${x.textContent || ''}`));
  el?.click(); return !!el;
}, sel, re);

export const scenes = [
  { name: 'library', run: nav('library') },
  { name: 'profiles', run: nav('profiles') },
  { name: 'repo-sync', run: async (p) => {
      await nav('repo')(p);
      await p.evaluate(() => { document.querySelector('[data-repo-tab="sync"]')?.click(); });
      await sleep(800);
      await p.evaluate(() => {
        const i = [...document.querySelectorAll('input')].find(x => x.offsetParent && /repo\.json/.test(x.placeholder || ''));
        if (i) { i.value = 'https://mods.example.org/repo.json'; i.dispatchEvent(new Event('input', { bubbles: true })); }
      });
      await away(p);
  } },
  { name: 'repo-host', run: async (p) => {
      await nav('repo')(p);
      await p.evaluate(() => { document.querySelector('[data-repo-tab="host"]')?.click(); });
      await away(p); await sleep(1500);
  } },
  { name: 'settings', run: async (p) => {
      await nav('settings')(p);
      await clickText(p, '.stg-nav-link', 'Scanning');
      await away(p); await sleep(1500);
  } },
  { name: 'intro', motion: true, bootWait: 900, readme: false, run: async () => {} },
  { name: 'apps', run: nav('apps') },
  { name: 'activity', run: async (p) => {
      await nav('library')(p);
      await p.evaluate(async () => {
        const a = await import('/js/core/activity.js');
        a.startActivity({ kind: 'sync', title: 'Sync « Community Pack »', detail: 'Downloading 3 of 7 files', progress: 0.42, cancel: () => {} });
        a.startActivity({ kind: 'hash', title: 'Integrity check: Playthrough', detail: 'Hashing Enhanced Textures', progress: 0.71, cancel: () => {} });
        a.startActivity({ kind: 'activation', title: 'Enable 2 mods', detail: 'Copying files', progress: 0.18 });
        a.startActivity({ kind: 'export', title: 'Export modpack « Weekend »' }).done('Saved');
        a.startActivity({ kind: 'scan', title: 'Scan mods folder' }).done('7 mods');
        a.startActivity({ kind: 'download', title: 'Download Save Keeper 1.8.1' }).done();
        const c = await import('/js/ui/activity-center.js');
        c.toggleActivityCenter();
      });
      await sleep(1500);
  } },
  { name: 'tools', run: async (p) => {
      await nav('library')(p);
      await p.evaluate(async () => { const m = await import('/js/features/tools/tools-hub.js'); await m.openToolsHub('disk'); });
      await sleep(1000);
      await p.evaluate(() => { const b = [...document.querySelectorAll('.tools-pane button')].find(x => /Run/i.test(x.textContent)); b?.click(); });
      await sleep(2000);
  } },

  // ── 1.0.4: more pages ──────────────────────────────────────────────────────────────────
  { name: 'mod-details', run: async (p) => {
      await nav('library')(p);
      await p.evaluate(async () => { const m = await import('/js/features/mods/mods-details.js'); await m.selectMod('demo-mod-01'); });
      await away(p); await sleep(1500);
  } },
  { name: 'notifications', run: async (p) => {
      await nav('library')(p);
      await p.evaluate(async () => {
        // The preview boot leaves notices of its own (no keyring in a browser): not part of the picture.
        await (await import('/js/ui/notification-center.js')).clearAll();
        window.toast('Community Pack: 2 mods have an update', 'info', 3500, '', 'Repo');
        window.toast('Save Keeper 1.8.1 installed', 'success', 3500, '', 'Apps');
        window.toast('Disk space low on D: (4.2 GB left)', 'warning', 3500, '', 'BMM');
        window.toast('Nightly mod check finished: everything is up to date', 'success', 3500, '', 'Scheduler');
      });
      await sleep(1200);
      await p.click('#btn-notif-center');
      await away(p); await sleep(1500);
  } },
  { name: 'conflicts', run: async (p) => {
      await nav('library')(p);
      await p.evaluate(async () => { const m = await import('/js/features/mods/conflicts-view.js'); await m.openConflictsView('demo-mod-01'); });
      await away(p); await sleep(1500);
  } },
  { name: 'automations-flow',
    pre: () => { try { localStorage.setItem('bmm.sched.editorMode', 'flow'); localStorage.setItem('bmm.sched.editorModeAsked', '1'); } catch { /* storage off */ } },
    run: async (p) => {
      await nav('plugins')(p);
      await p.evaluate(async () => {
        const m = await import('/js/features/settings/scheduler.js');
        await m.openTaskEditorWith({
          name: 'Nightly mod check', description: 'Scan, check for updates, sync, tell me.',
          trigger: { type: 'dailyAt', time: '03:00' },
          steps: [
            { kind: 'action', action: { type: 'mods.checkUpdates', params: {} } },
            { kind: 'if', condition: { type: 'textIs', params: { source: 'updates', op: 'notEmpty' } },
              then: [{ kind: 'action', action: { type: 'repo.syncNow', params: { url: 'https://mods.example.org/repo.json' } } }],
              else: [{ kind: 'action', action: { type: 'notify', params: { message: 'Everything is up to date.' } } }] },
          ],
        });
      });
      await sleep(1500);
      await p.evaluate(() => document.querySelector('.sflow-tb[data-act="fit"]')?.click());
      await away(p); await sleep(1200);
  } },
  { name: 'laya',
    fixtures: (f) => { f.ai_get_settings = { ...f.ai_get_settings, settings: { ...f.ai_get_settings.settings, enabled: true, classifier: 'embedded', classifier_chosen: true, generative: 'local', gen_local_url: 'http://127.0.0.1:1234/v1', gen_local_model: 'qwen2.5-7b-instruct' } }; },
    run: async (p) => {
      await nav('settings')(p);
      await p.evaluate(async () => { const m = await import('/js/features/ai/laya-hub.js'); m.openLaya('general'); });
      await away(p); await sleep(1500);
  } },
  { name: 'translation-studio', run: async (p) => {
      await nav('settings')(p);
      await p.evaluate(async () => { const m = await import('/js/features/settings/translation-studio.js'); await m.openTranslationStudio(); });
      await away(p); await sleep(1800);
  } },
  { name: 'theme-editor', run: async (p) => {
      await nav('settings')(p);
      await p.evaluate(async () => { const m = await import('/js/features/themes/theme-editor.js'); m.openEditor(); });
      await sleep(1200);
      await p.evaluate(() => document.querySelector('#bmm-theme-editor [data-bte="starter"][data-id="bmm-cobalt"]')?.click());
      await away(p); await sleep(1500);
  } },
  { name: 'modpacks', run: nav('modpacks') },
  { name: 'modpack-wizard', run: async (p) => {
      await nav('modpacks')(p);
      await clickText(p, '#view-modpacks button', 'Create Modpack');
      await sleep(1200);
      // Step 1 filled in, then step 2: the mods to pick.
      await p.evaluate(() => {
        const set = (el, v) => { if (!el) return; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
        const box = [...document.querySelectorAll('input, textarea')].filter((x) => x.offsetParent);
        set(box.filter((x) => /modpack/i.test(x.placeholder || '') && !/search/i.test(x.placeholder || '')).pop(), 'Weekend');
        set(box.find((x) => x.tagName === 'TEXTAREA'), 'The relaxed set: sharper textures, real weather, quiet footsteps.');
      });
      await sleep(300);
      await clickText(p, 'button', '^\\s*Next');
      await sleep(900);
      await p.evaluate(() => {
        const boxes = [...document.querySelectorAll('input[type=checkbox]')].filter((x) => x.offsetParent && !x.checked).slice(0, 3);
        for (const b of boxes) b.click();
      });
      await away(p); await sleep(1200);
  } },
  { name: 'history', run: async (p) => {
      await nav('library')(p);
      await p.evaluate(async () => { const m = await import('/js/features/mods/history.js'); await m.openHistory('all'); });
      await away(p); await sleep(1500);
  } },
  { name: 'catalogue-builder',
    pre: () => {
      const e = (id, name, version, author, description, tags) => ({ id, name, version, author, description, game: 'Demo Game', official: false, download_url: `https://mods.example.org/plugins/${id}.bmmplug`, tags });
      try { localStorage.setItem('bmm_my_plugin_catalogs', JSON.stringify([{ id: 'cat-demo', name: 'Community Pack plugins', version: '1.3', plugins: [
        e('server-modlist', 'Server mod list', '2.1.0', 'Demo Host', 'Applies the mod list of the server you join.', ['servers', 'mod lists']),
        e('nightly-check', 'Nightly check', '1.4.2', 'Demo', 'Scans, checks for updates and syncs at night.', ['automation']),
        e('screenshot-tags', 'Screenshot tags', '0.9.0', 'Aster', 'Tags screenshots with the active modpack.', ['screenshots']),
        e('backup-saves', 'Backup saves', '3.0.1', 'Pell', 'Copies the save folder before a mod is enabled.', ['saves', 'backup']),
      ] }])); } catch { /* storage off */ }
    },
    run: async (p) => {
      await nav('plugins')(p);
      await p.evaluate(() => document.querySelector('.plug-tab[data-tab="catalog"]')?.click());
      await sleep(1500);
      await p.evaluate(() => document.getElementById('plug-my-catalogs')?.click());
      await sleep(800);
      await p.evaluate(() => document.querySelector('.plug-cat-edit')?.click());
      await away(p); await sleep(1200);
  } },
  { name: 'settings-interface', run: async (p) => {
      await nav('settings')(p);
      await clickText(p, '.stg-nav-link', '^\\s*Interface');
      await away(p); await sleep(1500);
  } },
];
