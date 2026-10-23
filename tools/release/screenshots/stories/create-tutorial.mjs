// « Write an interactive tutorial »: a tutorial of your own, for the friends who join your
// Northwind Saga server. Opened from the tutorial hub, written in the creator (a step that
// points at a button taken with the element picker, a step that waits for something BMM
// announces, the French text beside the English), one step tried on the real app, then saved
// and exported as a .bmmtut to send.
//
// The only story with a tutorial on screen, since writing one is the subject: the preview
// shows the coach card for a few seconds and is closed again.
import { world, pick, until } from './world.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The tutorial store in the page (tutorial_custom.rs answers, without the signing). */
export function tutorialWorld() {
  const st = window.__demo;
  st.tuts = st.tuts || [];
  st.written = st.written || [];
  Object.assign(window.__gifMock, {
    tutorial_custom_list: () => JSON.parse(JSON.stringify(st.tuts)),
    // The backend checks, signs and stores the document, and hands it back.
    tutorial_custom_save: (a) => {
      const doc = JSON.parse(JSON.stringify(a.doc || {}));
      st.tuts = [...st.tuts.filter((d) => d.id !== doc.id), doc];
      return new Promise((r) => setTimeout(() => r(doc), 350));
    },
    tutorial_custom_delete: (a) => { st.tuts = st.tuts.filter((d) => d.id !== a.id); return null; },
    write_text_file: (a) => { st.written.push({ path: a.path, bytes: String(a.content || '').length }); return null; },
  });
}

const C = '#tutc';
/** The creator's controls, by structure (its labels are translated and its ids are counters). */
const SEL = {
  title: `${C} .tcr-side .tcr-card:first-child input.input-sm`,
  desc: `${C} .tcr-side .tcr-card:first-child textarea`,
  id: `${C} .tcr-side .tcr-card:first-child .tcr-field:last-child input`,
  partName: `${C} .tcr-side .tcr-part-row input`,
  stepTitle: `${C} .tcr-step-title`,
  stepText: `${C} .tcr-step-text`,
  // « Where it points » is the first card of the step editor, « Wait for the reader to… » the second.
  pageSelect: `${C} .tcr-step-editor > .tcr-card:nth-of-type(1) select`,
  target: `${C} .tcr-step-editor > .tcr-card:nth-of-type(1) .tcr-target-input`,
  pickBtn: `${C} .tcr-step-editor > .tcr-card:nth-of-type(1) .tcr-target-row > button:nth-of-type(1)`,
  status: `${C} .tcr-step-editor > .tcr-card:nth-of-type(1) .tcr-target-status`,
  waitKind: `${C} .tcr-step-editor > .tcr-card:nth-of-type(2) .tcr-field:nth-of-type(1) select`,
  waitWhich: `${C} .tcr-step-editor > .tcr-card:nth-of-type(2) .tcr-field:nth-of-type(2) select`,
  waitDesc: `${C} .tcr-step-editor > .tcr-card:nth-of-type(2) .tcr-field:last-child input`,
  addStep: `${C} .tcr-step-tools > button:nth-of-type(1)`,
  preview: `${C} .tcr-ed-head button`,
  lang: (l) => `${C} .tcr-lang button:nth-of-type(${l === 'fr' ? 2 : 1})`,
  save: `${C} .modal-footer .btn-primary`,
  exportBtn: `${C} .modal-footer-start > button:nth-of-type(2)`,
  close: `${C} .tcr-close`,
  stepRow: (n) => `${C} .tcr-steps .tcr-step-row:nth-child(${n})`,
};

/** Choose an option of a (custom-select enhanced) <select> by its value: open, then click it. */
async function choose(h, selectSel, value) {
  const idx = await h.eval((s, v) => {
    const sel = document.querySelector(s);
    return sel ? [...sel.options].findIndex((o) => o.value === v) : -2;
  }, selectSel, value);
  if (idx === -2) throw new Error(`no select ${selectSel}`);
  if (idx < 0) throw new Error(`${selectSel} has no option ${value}`);
  const trigger = await h.eval((s) => !!document.querySelector(s)?.nextElementSibling?.matches('.bmm-csel'), selectSel);
  if (!trigger) {
    // Not enhanced (custom selects off): set it the way a keyboard would.
    await h.click(selectSel, { pause: 300 });
    await h.eval((s, v) => { const sel = document.querySelector(s); sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); }, selectSel, value);
    return;
  }
  const trig = await h.page.evaluateHandle((s) => document.querySelector(s).nextElementSibling.querySelector('.bmm-csel-trigger'), selectSel);
  await h.click(trig.asElement(), { pause: 500 });
  await h.click(await h.nth('.bmm-csel-menu-open .bmm-csel-opt', idx), { pause: 600 });
}

/** Replace a field's text the way a person does: click it, select all, type. */
async function retype(h, sel, text, delay = 65) {
  await h.click(sel, { pause: 200 });
  await h.combo('Control', 'a', 150);
  await h.type(null, text, { delay });
}

/** The element picker: hold Ctrl, hover the element (outlined, its selector named), Ctrl+click. */
async function pickWithCtrl(h, target) {
  await h.click(SEL.pickBtn, { pause: 700 });
  await until(h, () => !!document.getElementById('tut-pick-layer'), { what: 'the element picker' });
  await h.move(target, 800);
  await h.page.keyboard.down('Control');
  // A small move with Ctrl down: the picker outlines what is under the pointer.
  await h.move({ x: h.mouse.x + 3, y: h.mouse.y + 2 }, 200);
  await wait(1300);
  await h.page.mouse.down(); await wait(70); await h.page.mouse.up();
  await h.page.keyboard.up('Control');
  await until(h, () => !document.getElementById('tut-pick-layer'), { what: 'the picker to close' });
}

export const createTutorial = {
  name: 'create-tutorial',
  title: { en: 'Write an interactive tutorial', fr: 'Écrire un tutoriel interactif' },
  desc: {
    en: 'A tutorial of your own for your friends: steps that point at the interface, a check that waits for an action, tried out, then exported.',
    fr: 'Un tutoriel à vous pour vos amis : des étapes qui pointent l’interface, une vérification qui attend une action, l’essai, puis l’export.',
  },
  topics: [],
  docs: ['reference/tips', 'features/settings'],
  pageInit: [world, tutorialWorld],
  async setup(h) { await h.nav('library', 1500); },
  steps: [
    {
      id: 'start',
      title: { en: 'Start a tutorial of your own', fr: 'Commencer un tutoriel à vous' },
      async run(h) {
        await h.click('#btn-restart-onboarding', { pause: 1300 });
        await until(h, () => !!document.querySelector('#tut-hub.open .thub-row'), { what: 'the tutorial hub' });
        // « Mine »: empty for now, with the invitation to write one.
        await h.click('#tut-hub .thub-tab:last-of-type', { pause: 1400 });
        await h.click('#tut-hub .thub-empty .btn-primary', { pause: 1200 });
        await until(h, () => !!document.querySelector('#tutc.open .tcr-step-editor'), { what: 'the tutorial creator' });
        await wait(600);
        await h.type(SEL.title, 'Install our server mods', { delay: 60 });
        await h.type(SEL.desc, 'Get the mods our Northwind server runs and switch them on, in two minutes.', { delay: 38 });
        await retype(h, SEL.id, 'server-mods');
        await retype(h, SEL.partName, 'Get set up');
        await wait(700);
      },
    },
    {
      id: 'point',
      title: { en: 'A step that points at a button', fr: 'Une étape qui montre un bouton' },
      async run(h) {
        await h.type(SEL.stepTitle, 'Add the server pack', { delay: 55 });
        await h.type(SEL.stepText, 'Press <b>Add a mod</b> and pick <code>Server Pack.zip</code> from our Discord.', { delay: 34 });
        await choose(h, SEL.pageSelect, 'library');
        await pickWithCtrl(h, '#btn-add-mod');
        await until(h, (s) => /add-mod/.test(document.querySelector(s)?.value || ''), { what: 'the picked selector' }, SEL.target);
        await h.move(SEL.status, 600);
        await wait(1600);
      },
    },
    {
      id: 'wait-for-it',
      title: { en: 'Wait until the reader has done it', fr: 'Attendre que le lecteur l’ait fait' },
      async run(h) {
        await choose(h, SEL.waitKind, 'action');
        await choose(h, SEL.waitWhich, 'bmm:action:mod-added');
        await h.type(SEL.waitDesc, 'Add the server pack', { delay: 55 });
        await wait(900);
        // A second step: switch it on, which BMM announces too.
        await h.click(SEL.addStep, { pause: 800 });
        await h.type(SEL.stepTitle, 'Switch it on', { delay: 55 });
        await h.type(SEL.stepText, 'Turn on the toggle of <b>Server Pack</b>. BMM copies it into the game.', { delay: 34 });
        await choose(h, SEL.waitKind, 'action');
        await choose(h, SEL.waitWhich, 'bmm:action:mod-activated');
        await wait(1200);
      },
    },
    {
      id: 'in-french',
      title: { en: 'The same steps in French', fr: 'Les mêmes étapes en français' },
      async run(h) {
        await h.click(SEL.lang('fr'), { pause: 900 });
        await h.type(SEL.stepTitle, 'L’activer', { delay: 60 });
        await h.type(SEL.stepText, 'Activez <b>Server Pack</b> : BMM le copie dans le jeu.', { delay: 36 });
        await wait(900);
        await h.click(SEL.lang('en'), { pause: 900 });
      },
    },
    {
      id: 'try-it',
      title: { en: 'Try a step on the real app', fr: 'Essayer une étape sur la vraie application' },
      async run(h) {
        await h.click(SEL.stepRow(1), { pause: 900 });
        await h.click(SEL.preview, { pause: 600 });
        await until(h, () => !!document.getElementById('tut-engine-panel'), { what: 'the tutorial window' });
        await wait(3600);
        await h.click('#btn-tut-close', { pause: 900 });
        await until(h, () => !document.getElementById('tut-engine-panel') && getComputedStyle(document.getElementById('tutc')).visibility !== 'hidden', { what: 'the creator to come back' });
        await wait(600);
      },
    },
    {
      id: 'save-share',
      title: { en: 'Save it and send it to friends', fr: 'L’enregistrer et l’envoyer aux amis' },
      async run(h) {
        await h.click(SEL.save, { pause: 1200 });
        await until(h, () => window.__demo.tuts.some((d) => d.id === 'server-mods'), { what: 'the tutorial to be saved' });
        await wait(800);
        await h.eval(() => window.__gifSaves.push('D:\\Shared\\server-mods.bmmtut'));
        await h.click(SEL.exportBtn, { pause: 1400 });
        await until(h, () => window.__demo.written.some((w) => /server-mods\.bmmtut$/.test(w.path)), { what: 'the export' });
        await wait(800);
        await h.click(SEL.close, { pause: 1200 });
        await until(h, () => !!document.querySelector('#tut-hub.open .thub-row[data-id="custom:server-mods"]'), { what: 'the tutorial in the hub' });
        await h.move('#tut-hub .thub-row[data-id="custom:server-mods"]', 700);
        await wait(1400);
        // Edit, Share (.bmmtut), Delete: it is an ordinary tutorial of the hub now.
        await h.move('#tut-hub .thub-d-own button:nth-of-type(2)', 800);
        await wait(1800);
      },
    },
  ],
};
