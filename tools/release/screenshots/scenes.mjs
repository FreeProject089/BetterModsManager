// The screenshot scenes: one entry per picture. `run` drives the page (demo data only) after
// boot; `theme` overrides the run's theme; `readme: false` keeps a picture out of .github/screenshots.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const away = async (p) => { await p.mouse.move(1560, 980); await sleep(600); };
const nav = (v) => async (p) => { await p.click(`#nav-${v}`); await away(p); await sleep(2500); };
export const scenes = [
  { name: 'library', run: nav('library') },
  { name: 'library-light', theme: 'light', run: nav('library') },
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
      await p.evaluate(() => { const l = [...document.querySelectorAll('.stg-nav-link')].find(x => /Scanning/i.test(x.title || x.textContent)); l?.click(); });
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
];
