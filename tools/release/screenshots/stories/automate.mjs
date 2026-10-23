// « Automate the chores »: a scheduled task that, every evening at 21:00, checks the repos the
// player follows, says so only when one has an update, and backs up the profiles and settings
// to D:\Modding\Backups. Built in the Flow editor (trigger, actions, a condition), measured with
// the dry run before it is saved, then shown in the list with its next run, run once by hand,
// and its run log read.
import { world, pick, until } from './world.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * What the scheduler asks the backend for, on top of the world: the saved tasks and their run
 * log (commands/scheduler.rs, sched_runs.rs), the followed repos and their check
 * (repo_follow.rs, camelCase), and the .DATABMM writer (export_bundle.rs, settings.rs).
 */
export function automateMock() {
  const st = window.__demo;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MB = 1048576;
  st.tasks = st.tasks || [];
  st.runs = st.runs || {};
  st.backups = st.backups || [];
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const follow = (lastCheck, lastUpdates = 0) => ({ enabled: true, intervalMin: 360, action: 'notify', etag: null, lastModified: null, digest: null, lastCheck, lastVersion: null, lastUpdates, lastError: null });
  st.followed = st.followed || [
    { url: 'https://mods.example.org/northwind/repo.json', name: 'Northwind Community Pack', follow: follow(ago(300)), due: false, hasPassword: false },
    { url: 'http://192.168.1.20:8000/repo.json', name: 'Friday LAN server', follow: follow(ago(1440)), due: true, hasPassword: true },
    { url: 'https://maps.example.org/emberwood/repo.json', name: 'Emberwood Map Makers', follow: follow(ago(200)), due: false, hasPassword: false },
  ];
  // What each repo has that the library does not (ModUpdateInfo, snake_case).
  const updates = {
    'https://mods.example.org/northwind/repo.json': [
      { mod_id: 'nw-weather', name: 'Dynamic Weather Overhaul', current_version: '1.9.4', latest_version: '1.9.5' },
      { mod_id: 'nw-patch', name: 'Unofficial Patch', current_version: '4.0.1', latest_version: '4.0.2' },
    ],
  };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  Object.assign(window.__gifMock, {
    get_schedules: () => JSON.parse(JSON.stringify(st.tasks)),
    save_schedules: (a) => { st.tasks = JSON.parse(JSON.stringify(a.tasks || [])); return null; },
    register_os_schedule: () => sleep(300).then(() => null),
    unregister_os_schedule: () => null,
    sched_run_append: (a) => { (st.runs[a.taskId] = st.runs[a.taskId] || []).push(a.record); return null; },
    sched_runs_list: (a) => (st.runs[a.taskId] || []).slice().reverse(),
    sched_runs_clear: (a) => { delete st.runs[a.taskId]; return null; },
    repo_follow_list: () => st.followed.map((r) => ({ ...r, follow: { ...r.follow } })),
    repo_follow_due: () => st.followed.filter((r) => r.due).map((r) => r.url),
    repo_follow_check: (a) => {
      const r = st.followed.find((x) => x.url === a.url);
      const ups = updates[a.url] || [];
      if (r) { r.follow.lastCheck = new Date().toISOString(); r.follow.lastUpdates = ups.length; r.due = false; }
      return sleep(a.url.includes('192.168.') ? 900 : 600).then(() => ({ url: a.url, name: r?.name || a.url, notModified: false, version: null, updates: ups, action: 'notify', error: null }));
    },
    backup_dest_path: (a) => {
      const base = String(a.name || 'bmm-backup-{date}').replace('{date}', today()).replace('{time}', '21-00').replace('{datetime}', `${today()}_21-00`);
      const taken = st.backups.filter((p) => p.startsWith(`${a.dir}\\${base}`)).length;
      return `${a.dir}\\${base}${taken ? ` (${taken})` : ''}.${a.ext || 'DATABMM'}`;
    },
    export_app_data_json: () => JSON.stringify({ profiles: st.profiles, mods: st.mods.length }),
    export_data_bundle: (a) => {
      const o = a.options || {};
      const sections = [
        ['app_data', 3, 'mods, profiles and settings'], ['themes', 2], ['theme_presets', 1], ['translations', 0, 'nothing there'], ['launch_packs', 1],
        ['automations', 1], ['navigation', 1], ['apps', 1],
      ].filter(([k]) => o[k]).map(([section, files, note]) => ({ section, files, bytes: files * 180000, note: files ? null : note }));
      st.backups.push(a.destPath);
      return sleep(1300).then(() => ({ bytes: Math.round(3.4 * MB), sections }));
    },
  });
}

export const automate = {
  name: 'automate',
  title: { en: 'Automate the chores', fr: 'Automatiser les corvées' },
  desc: {
    en: 'A scheduled task that checks the followed repos and backs up the profiles every evening, previewed before it is saved.',
    fr: 'Une tâche planifiée qui vérifie les repos suivis et sauvegarde les profils chaque soir, prévisualisée avant d’être enregistrée.',
  },
  topics: ['other/automation', 'other/backup'],
  docs: ['features/scheduler'],
  pageInit: [world, automateMock],
  async setup(h) {
    await h.nav('plugins', 1600);
  },
  steps: [
    {
      id: 'new-task',
      title: { en: 'A new task, every evening at 21:00', fr: 'Une nouvelle tâche, chaque soir à 21 h' },
      topics: ['other/automation'], docs: ['features/scheduler'],
      async run(h) {
        await h.click('.plug-tab[data-tab="automations"]', { pause: 1300 });
        await h.click('#btn-create-schedule', { pause: 1100 });
        // The first task asks how tasks should be built: Flow, the graph.
        if (await h.eval(() => !!document.querySelector('.sched-modeask-opt[data-mode="flow"]'))) {
          await wait(900);
          await h.click('.sched-modeask-opt[data-mode="flow"]', { pause: 1200 });
        }
        await until(h, () => !!document.querySelector('#sched-name'), { what: 'the task editor' });
        if (await h.eval(() => !/flow/i.test(document.querySelector('.sched-mode-btn.on')?.textContent || ''))) {
          await h.click(await h.byText('.sched-mode-btn', /flow/i), { pause: 900 });
        }
        await h.type('#sched-name', 'Evening upkeep', { delay: 70 });
        await h.type('#sched-desc', 'Check the repositories I follow, then back up my profiles.', { delay: 38 });
        await wait(400);
        await h.click('#sched-tr-change', { pause: 900 });
        await h.click('.sched-tr-card[data-tr="dailyAt"]', { pause: 900 });
        // A time field: click the hours, type 2100.
        const box = await (await h.page.waitForSelector('#sched-tr-time', { visible: true, timeout: 8000 })).boundingBox();
        await h.click({ x: box.x + 18, y: box.y + box.height / 2 }, { pause: 250 });
        await h.type(null, '2100', { delay: 160 });
        await until(h, () => document.getElementById('sched-tr-time')?.value === '21:00', { what: 'the trigger time' });
        await wait(1200);
      },
    },
    {
      id: 'actions',
      title: { en: 'Check the repos, back up the profiles', fr: 'Vérifier les repos, sauvegarder les profils' },
      topics: ['other/automation', 'other/backup'], docs: ['features/scheduler'],
      async run(h) {
        // 1. The followed repos: read each one, install nothing.
        await h.click('.sflow-tb-add', { pause: 700 });
        await h.type(null, 'repos', { delay: 90 });
        await wait(500);
        await h.click(await h.byText('.sflow-pal-item', /checkFollowed|repos you follow/i), { pause: 1300 });
        await until(h, () => !!document.querySelector('.sflow-insp'), { what: 'the step inspector' });
        await wait(900);
        // The three followed repos are listed (none ticked: all of them). Its own message off:
        // the task says it only when there is news (next step).
        await h.scroll('.sflow-insp .sched-act-type', 220, 900);
        await wait(900);
        await h.click('.sflow-insp input[data-k="notify"]', { pause: 900 });
        await h.click('.sflow-insp-x', { pause: 600 });
        // 2. The backup: a .DATABMM archive of the profiles and settings, in D:\Modding\Backups.
        await h.click('.sflow-addnode[data-slot=""]', { pause: 700 });
        await h.type(null, 'back up', { delay: 90 });
        await wait(500);
        await h.click(await h.byText('.sflow-pal-item', /DATABMM/), { pause: 1300 });
        await pick(h, 'D:\\Modding\\Backups');
        await h.click('.sched-browse-bkdir', { pause: 900 });
        await h.type('.sched-p-bkname', 'northwind-{date}', { delay: 70 });
        await wait(500);
        await h.scroll('.sched-p-bkname', 260, 900);
        await h.move(await h.byText('.sflow-insp label', /profiles/i), 700);
        await wait(1600);
        await h.click('.sflow-insp-x', { pause: 700 });
      },
    },
    {
      id: 'condition',
      title: { en: 'Tell me only when a repo has news', fr: 'Me prévenir seulement quand un repo a du nouveau' },
      topics: ['other/automation'], docs: ['features/scheduler'],
      async run(h) {
        // Between the two steps: If repos.updates > 0, then a notification with the summary.
        await h.click('.sflow-edgeadd[data-slot=""][data-index="1"]', { pause: 700, force: true });
        await h.type(null, 'if', { delay: 110 });
        await wait(400);
        await h.click(await h.byText('.sflow-pal-item', /If\s*\/\s*Else/i), { pause: 1100 });
        await h.click('.sflow-insp .sched-cond-type', { pause: 700 });
        await h.type(null, 'value', { delay: 90 });
        await wait(400);
        await h.click('.skp-item[data-v="value"]', { pause: 900 });
        await h.type('.sflow-insp .sched-cp-src', 'repos.updates', { delay: 70 });
        await h.type('.sflow-insp .sched-cp-val', '0', { delay: 90 });
        await wait(700);
        await h.click('.sflow-insp-x', { pause: 700 });
        await h.click('.sflow-addnode[data-slot="1.then"]', { pause: 700 });
        await h.type(null, 'notif', { delay: 90 });
        await wait(400);
        await h.click(await h.byText('.sflow-pal-item', /notification/i), { pause: 1100 });
        await h.type('.sflow-insp input.sched-p', 'Repo news: {repos.summary}', { delay: 55 });
        await wait(700);
        await h.click('.sflow-insp-x', { pause: 700 });
        await h.click('.sflow-tb[data-act="fit"]', { pause: 1600 });
      },
    },
    {
      id: 'dry-run',
      title: { en: 'A dry run before saving', fr: 'Un essai à blanc avant d’enregistrer' },
      topics: ['other/automation'], docs: ['features/scheduler'],
      async run(h) {
        await h.click('#sched-dryrun', { pause: 1200 });
        await wait(3000);
        await h.key('Escape', 800);
      },
    },
    {
      id: 'saved',
      title: { en: 'Saved, with its next run', fr: 'Enregistrée, avec sa prochaine exécution' },
      topics: ['other/automation'], docs: ['features/scheduler'],
      async run(h) {
        await h.click('#sched-save', { pause: 1400 });
        await until(h, () => !!document.querySelector('#scheduler-list-container .sched-row'), { what: 'the task in the list' });
        await h.move('#scheduler-list-container .sched-row .sched-chip-next', 800);
        await wait(2200);
      },
    },
    {
      id: 'run-now',
      title: { en: 'Run it once and read the log', fr: 'La lancer une fois et lire le journal' },
      topics: ['other/automation', 'other/backup'], docs: ['features/scheduler'],
      async run(h) {
        await h.click('#scheduler-list-container .sched-row [data-act="run"]', { pause: 800 });
        await until(h, () => (window.__demo.tasks[0]?.history || []).length > 0, { timeout: 15000, what: 'the run to finish' });
        await wait(2500);
        await h.click('#scheduler-list-container .sched-row [data-act="edit"]', { pause: 1200 });
        await h.click('[data-sched-runlog]', { pause: 2600 });
      },
    },
  ],
};
