// « Make BMM yours »: a theme made in the theme editor (a built-in to start from, a palette from
// one colour, the contrast it flags fixed, saved as a theme of its own, the app following), the
// sidebar rearranged in the navigation editor, a page of your own added through its guided « Add
// a custom button » (a sandboxed bmmpage:// page with one permission), and BMM translated in the
// translation studio, live in the app.
import { world, until } from './world.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The backend of what this story touches, in the page (stateful, gone with the page):
 *   themes          install_theme / list_installed_themes / set_active_theme (themes.rs: the list
 *                   is a JSON string of theme objects);
 *   custom pages    create/update/delete/list_custom_pages, get_custom_page_source, the grants
 *                   (page_grants_get / page_set_grant, GrantsMeta camelCase), the per-page storage
 *                   the page SDK reaches through the broker (custom_pages.rs);
 *   languages       create_language_file / import_language_data / get_all_languages_content
 *                   (i18n.rs: file contents as strings, keyed by code).
 * The preview cannot serve bmmpage://: an iframe pointed at http://bmmpage.localhost/<id>/ is given
 * the same document as a blob instead (page HTML, its style.css inline, the page SDK and app.js as
 * blob scripts, which the app's CSP allows), still sandboxed without allow-same-origin, so the
 * page talks to BMM only through postMessage and the broker, as it does in the app.
 */
export function yoursExtras() {
  const st = window.__demo;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  st.themes = [];
  st.pages = {};
  st.langs = {};
  let n = 0;
  // The SDK every page bundle gets (custom_pages.rs PAGE_SDK_JS), the same calls.
  const SDK = `(function(){var seq=0,pending={};function call(cap,method,args){return new Promise(function(res,rej){var reqId=++seq;pending[reqId]={res:res,rej:rej};parent.postMessage({__bmm:true,reqId:reqId,cap:cap,method:method,args:args||{}},'*');});}
window.addEventListener('message',function(e){var d=e.data;if(!d||d.__bmmReply!==true)return;var p=pending[d.reqId];if(!p)return;delete pending[d.reqId];if(d.error)p.rej(new Error(d.error));else p.res(d.ok);});
window.bmm={storage:{get:function(k){return call('storage','get',{key:k});},set:function(k,v){return call('storage','set',{key:String(k),value:String(v)});},remove:function(k){return call('storage','remove',{key:k});},keys:function(){return call('storage','keys',{});},clear:function(){return call('storage','clear',{});}},
notify:function(msg,type){return call('notifications','notify',{msg:String(msg),type:type});},fetch:function(url){return call('network','fetch',{url:String(url)});},read:function(scope){return call('read','get',{scope:String(scope)});},
clipboard:{write:function(t){return call('clipboard','write',{text:String(t)});},read:function(){return call('clipboard','read',{});}},system:{info:function(){return call('system','info',{});}}};})();`;
  // The preview cannot serve bmmpage://: the harness answers http://bmmpage.localhost/<id>/<file>
  // from here (gifs.mjs), so the frame keeps the app's own sandbox (no allow-same-origin).
  window.__bmmPageFile = (id, file) => {
    const p = st.pages[id];
    if (!p) return null;
    if (file === '_sdk.js') return { type: 'text/javascript', body: SDK };
    if (file === 'app.js') return { type: 'text/javascript', body: p.js || '' };
    const css = String(p.css).replace(/<\/style/gi, '<\\/style');
    const app = p.js && p.js.trim() ? '<script src="app.js" defer></script>' : '';
    return { type: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><script src="_sdk.js" defer></script>${app}</head><body>${p.html}</body></html>` };
  };

  const meta = (id) => ({ id, name: st.pages[id].name, runtime: st.pages[id].js?.trim() ? 'js' : 'html', entry: 'index.html' });
  Object.assign(window.__gifMock, {
    // Themes (themes.rs).
    list_installed_themes: () => JSON.stringify(st.themes),
    install_theme: (a) => {
      const th = JSON.parse(a.themeJson || '{}');
      st.themes = st.themes.filter((x) => x.id !== th.id).concat(th);
      return sleep(250).then(() => null);
    },
    set_active_theme: (a) => { st.activeTheme = a.themeId; return null; },
    delete_theme: (a) => { st.themes = st.themes.filter((x) => x.id !== a.themeId); return null; },
    // Custom pages (custom_pages.rs).
    list_custom_pages: () => Object.keys(st.pages).map(meta),
    create_custom_page: (a) => {
      const id = `p${(Date.now() + n++).toString(16)}`;
      st.pages[id] = { name: a.name, html: a.html, css: a.css, js: a.js || '', grants: [], storage: {} };
      return sleep(300).then(() => meta(id));
    },
    update_custom_page: (a) => { const p = st.pages[a.id]; if (!p) throw new Error('page not found'); Object.assign(p, { name: a.name, html: a.html, css: a.css, js: a.js || '', url: null }); return null; },
    delete_custom_page: (a) => { delete st.pages[a.id]; return null; },
    get_custom_page_source: (a) => { const p = st.pages[a.id]; if (!p) throw new Error('page not found'); return { name: p.name, html: p.html, css: p.css, js: p.js }; },
    page_grants_get: (a) => (st.pages[a.id]?.grants || []).slice(),
    page_set_grant: (a) => {
      const p = st.pages[a.id]; if (!p) throw new Error('invalid id');
      p.grants = p.grants.filter((c) => c !== a.cap).concat(a.granted ? [a.cap] : []);
      return p.grants.slice();
    },
    page_grant_review_get: (a) => ({ source: st.pages[a.id] ? 'user' : '', requested: [], requestedOrigins: [], reviewedAt: null }),
    page_net_origins_get: () => [],
    page_set_net_origins: () => [],
    page_require_grant: (a) => { if (!(st.pages[a.id]?.grants || []).includes(a.cap)) throw new Error('permission not granted'); return null; },
    page_storage_get: (a) => st.pages[a.id]?.storage[a.key] ?? null,
    page_storage_set: (a) => { const p = st.pages[a.id]; if (p) p.storage[a.key] = a.value; return null; },
    page_storage_remove: (a) => { const p = st.pages[a.id]; if (p) delete p.storage[a.key]; return null; },
    page_storage_keys: (a) => Object.keys(st.pages[a.id]?.storage || {}),
    page_storage_clear: (a) => { const p = st.pages[a.id]; if (p) p.storage = {}; return null; },
    list_page_docs: () => [],
    list_page_files: () => [],
    // Languages (i18n.rs).
    create_language_file: (a) => {
      const from = a.copyFrom ? st.langs[a.copyFrom] : null;
      return sleep(300).then(() => from || '{}');
    },
    import_language_data: (a) => { st.langs[a.code] = a.content; return sleep(200).then(() => null); },
    get_all_languages_content: () => ({ ...st.langs }),
  });
}

/** Set a colour input the way the system picker would (a recording cannot show that picker). */
async function setColour(h, sel, value) {
  await h.move(sel, 600);
  await wait(250);
  await h.eval((s, v) => {
    const i = document.querySelector(s);
    if (!i) throw new Error(`no colour input ${s}`);
    i.value = v;
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
  }, sel, value);
  await wait(500);
}

/** Drag a handle to a point with the mouse held, at a hand's pace. */
async function drag(h, from, to) {
  await h.move(from, 600);
  await wait(150);
  await h.page.mouse.down();
  await wait(120);
  await h.move(to, 900);
  await wait(250);
  await h.page.mouse.up();
  await wait(500);
}

const TE = '#bmm-theme-editor';

export const makeItYours = {
  name: 'make-it-yours',
  title: { en: 'Make BMM yours', fr: 'Personnaliser BMM' },
  desc: {
    en: 'A theme made in the theme editor, a navigation bar rearranged with a custom page of your own, and a string translated in the translation studio.',
    fr: 'Un thème créé dans l’éditeur de thèmes, une barre de navigation réorganisée avec une page personnalisée, et une chaîne traduite dans le studio de traduction.',
  },
  topics: ['other/themes', 'other/translate'],
  docs: ['features/themes', 'features/making-themes', 'features/settings'],
  pageInit: [world, yoursExtras],
  async setup(h) {
    await h.nav('settings', 1800);
  },
  steps: [
    {
      id: 'theme-palette',
      title: { en: 'A palette from one colour', fr: 'Une palette à partir d’une couleur' },
      topics: ['other/themes'], docs: ['features/making-themes', 'features/themes'],
      async run(h) {
        await h.click('#btn-open-theme-editor', { pause: 1300 });
        // The app behind follows every change from here on.
        await h.click(`${TE} #bte-live`, { pause: 700 });
        await h.click(`${TE} [data-bte="starter"][data-id="bmm-cobalt"]`, { pause: 1300 });
        await setColour(h, '#bte-gen-colour', '#f59e0b');
        await h.click(`${TE} [data-bte="generate"]`, { pause: 1800 });
        await wait(900);
      },
    },
    {
      id: 'theme-save',
      title: { en: 'Fix the contrast, save it as a new theme', fr: 'Corriger le contraste, l’enregistrer comme nouveau thème' },
      topics: ['other/themes'], docs: ['features/making-themes', 'features/themes'],
      async run(h) {
        const faint = `${TE} .bte-row[data-row="--bmm-text-muted"]`;
        await h.eval((s) => document.querySelector(s)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), faint);
        await wait(900);
        // A faint text a little too dark for its cards: the contrast list flags it at once.
        await h.click(`${faint} input.bte-input`, { pause: 250 });
        await h.combo('Control', 'a', 120);
        await h.type(null, '#3f4a5c', { delay: 90 });
        await h.key('Tab', 1500);
        await h.click(`${TE} [data-bte="fix-all"]`, { pause: 1600 });
        await h.click('#bte-save', { pause: 900 });
        await h.combo('Control', 'a', 150);
        await h.type(null, 'Golden Hour', { delay: 85 });
        await wait(400);
        await h.key('Enter', 1400);
        await until(h, () => window.__demo.themes.some((t) => t.name === 'Golden Hour'), { what: 'the theme to be saved' });
        await wait(800);
        await h.click(`${TE} [data-bte="close"]`, { pause: 1200 });
      },
    },
    {
      id: 'nav-rearrange',
      title: { en: 'Rearrange the sidebar', fr: 'Réorganiser la barre latérale' },
      topics: ['other/themes'], docs: ['features/settings'],
      async run(h) {
        await h.click('#cardorder-navbar', { pause: 1300 });
        // Hide a page this player never opens.
        await h.click(await h.byText('.nbx-row', /^\s*Mapper\s*$/), { pause: 900 });
        await h.click('#nbx-visible', { pause: 1000, force: true });
        // Drag the App Catalog up, under the Library.
        const grip = await h.eval(() => {
          const rows = [...document.querySelectorAll('.nbx-row')];
          const r = rows.find((x) => /App Catalog/.test(x.textContent));
          const p = rows.find((x) => /Profiles/.test(x.textContent));
          if (!r || !p) return null;
          const a = r.querySelector('.nbx-grip').getBoundingClientRect(), b = p.getBoundingClientRect();
          return { from: { x: a.x + a.width / 2, y: a.y + a.height / 2 }, to: { x: a.x + a.width / 2, y: b.y + 6 } };
        });
        if (!grip) throw new Error('no App Catalog or Profiles row in the navigation editor');
        await drag(h, grip.from, grip.to);
        // Rename one: select it, type a shorter name.
        await h.click(await h.byText('.nbx-row', /Help & other/), { pause: 900 });
        await h.click('#nbx-name', { pause: 200 });
        await h.combo('Control', 'a', 120);
        await h.type(null, 'Help', { delay: 110 });
        await wait(1200);
      },
    },
    {
      id: 'nav-own-page',
      title: { en: 'Add a page of your own', fr: 'Ajouter sa propre page' },
      topics: ['other/themes'], docs: ['features/settings'],
      async run(h) {
        await h.click('#nbx-add-btn', { pause: 900 });
        await h.click(await h.byText('.nbx-kind', /own page|propre page/i), { pause: 800 });
        await h.click('#nbx-w-next', { pause: 900 });
        await h.type('#nbx-w-label', 'Mod checklist', { delay: 80 });
        await wait(300);
        await h.click('.nbx-ipk-cell[data-ref="ui:clipboard-list"]', { pause: 700 });
        await h.click('#nbx-w-next', { pause: 1000 });
        await h.click(await h.byText('.nbx-tpl', /checklist|liste/i), { pause: 900 });
        await h.click('#nbx-w-next', { pause: 1200 });
        // Every permission starts off: the template says what it needs, one click turns it on.
        await h.click('#nbx-w-suggest', { pause: 1300 });
        await h.click('#nbx-w-next', { pause: 900 });
        await until(h, () => !!document.querySelector('#nbx-w-preview iframe'), { what: 'the page preview' });
        await wait(1600);
        await h.click('#nbx-w-next', { pause: 1300 });
        await until(h, () => Object.values(window.__demo.pages).some((p) => p.name === 'Mod checklist'), { what: 'the page to be created' });
        await until(h, () => !!document.querySelector('.nbx-row.is-sel[data-id^="custom:"]'), { what: 'the new button in the list' });
        await wait(700);
        // The new row, picked again: what the button opens and the one permission its page holds.
        await h.click(await h.byText('.nbx-row', /Mod checklist/), { pause: 900 });
        await h.scroll('#nbx-pane', 260, 900);
        await wait(1200);
      },
    },
    {
      id: 'open-own-page',
      title: { en: 'Your page in the sidebar', fr: 'Votre page dans la barre latérale' },
      topics: ['other/themes'], docs: ['features/settings'],
      async run(h) {
        await h.click('#nbe-done', { pause: 1200 });
        await h.click(await h.byText('.nav-item[data-custom-id]', /Mod checklist/), { pause: 1500 });
        // The page runs sandboxed; its list is kept with the one permission it was given.
        const frame = '.custom-page-view.active iframe';
        await until(h, (s) => !!document.querySelector(s)?.getBoundingClientRect().width, { what: 'the page view' }, frame);
        await wait(1200);
        const box = await h.eval((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; }, frame);
        const field = { x: box.x + Math.min(260, box.w / 2), y: box.y + 112 };
        for (const item of ['Back up the saves', 'Disable the HD textures for the boss fight', 'Check the patch notes']) {
          await h.click(field, { pause: 250 });
          await h.type(null, item, { delay: 55 });
          await h.key('Enter', 700);
        }
        await wait(1200);
      },
    },
    {
      id: 'translate',
      title: { en: 'Translate BMM, live in the app', fr: 'Traduire BMM, en direct dans l’application' },
      topics: ['other/translate'], docs: ['features/settings'],
      async run(h) {
        await h.click('#nav-settings', { pause: 1500 });
        await h.eval(() => document.getElementById('btn-open-i18n-sandbox')?.scrollIntoView({ block: 'center' }));
        await wait(400);
        await h.click('#btn-open-i18n-sandbox', { pause: 1500 });
        // A new language, started empty.
        await h.click('#tst-new-lang', { pause: 900 });
        await h.type('#tst-nl-code', 'de', { delay: 140 });
        await h.type('#tst-nl-name', 'Deutsch', { delay: 90 });
        await wait(400);
        await h.click('[data-ts="nl-create"]', { pause: 1600 });
        await until(h, () => (document.getElementById('tst-target')?.value || '') === 'de', { what: 'the new language to be the target' });
        await h.click('.tst-live .plug-toggle-slider', { pause: 1200, force: true });
        // The pointer: click any text of BMM and its key opens.
        for (const [nav, text] of [['#nav-library', 'Bibliothek'], ['#nav-profiles', 'Profile']]) {
          await h.click('#tst-pick', { pause: 900 });
          await h.click(`${nav} [data-i18n]`, { pause: 1000, force: true });
          await h.type('#tst-value', text, { delay: 110 });
          await wait(1400);
        }
        await h.move('#nav-library', 700);
        await wait(1200);
      },
    },
  ],
};
