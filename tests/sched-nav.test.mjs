// The navigation vocabulary of scheduled tasks (features/settings/sched-nav-model.ts).
//
// What is pinned here is the safety half: which controls a task may click and which dialogs it
// may open are lists, every listed control is an id that exists in the page, nothing on the
// lists deletes or consents, the runtime guard refuses what looks dangerous at the moment of the
// click, and the dry-run plan says « may not run » for exactly the steps that may not.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/sched-nav-model.js')).href);
const EN = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/en.json'), 'utf8'));
const FR = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/fr.json'), 'utf8'));
const HTML = readFileSync(join(ROOT, 'frontend/index.html'), 'utf8');
const SCHED = readFileSync(join(ROOT, 'frontend/src/features/settings/scheduler.ts'), 'utf8');

describe('allow-lists', () => {
  test('every clickable control is a plain id selector', () => {
    assert.ok(M.NAV_CONTROLS.length >= 8);
    for (const c of M.NAV_CONTROLS) assert.match(c.sel, /^#[A-Za-z][\w-]*$/, c.id);
  });

  test('the controls drawn by the static page exist in it', () => {
    // Plugins draws its own head at run time; every other listed control is in index.html.
    for (const c of M.NAV_CONTROLS.filter((x) => x.page !== 'plugins' && x.page !== 'apps')) {
      assert.ok(HTML.includes(`id="${c.sel.slice(1)}"`), `${c.id}: ${c.sel} is not in index.html`);
    }
  });

  test('no listed control or dialog deletes, consents or asks for a secret', () => {
    const bad = /delete|remove|uninstall|reset|wipe|consent|accept|password|token|secret/i;
    for (const c of M.NAV_CONTROLS) assert.doesNotMatch(`${c.id} ${c.sel}`, bad, c.id);
    for (const m of M.NAV_MODALS) assert.doesNotMatch(m.id, bad, m.id);
  });

  test('a dialog opener only ever calls a listed global', () => {
    for (const m of M.NAV_MODALS) {
      if (m.open.kind === 'global') assert.ok(M.MODAL_GLOBALS.includes(m.open.name), m.id);
      else assert.match(m.open.sel, /^#[A-Za-z][\w-]*$/, m.id);
    }
  });

  test('every page, tab, control and dialog has words in both languages', () => {
    const keys = [
      ...M.NAV_PAGES.flatMap((p) => [p.key, ...p.tabs.map((t) => t.key)]),
      ...M.NAV_CONTROLS.map((c) => c.key),
      ...M.NAV_MODALS.map((m) => m.key),
    ];
    for (const k of keys) {
      assert.ok(EN[k], `en.json misses ${k}`);
      assert.ok(FR[k], `fr.json misses ${k}`);
    }
  });

  test('the eight steps are in the scheduler registry, and only modal and click ask navigate', () => {
    for (const a of M.NAV_ACTIONS) assert.match(SCHED, new RegExp(`\\{ v: '${a.replace('.', '\\.')}'`), a);
    assert.deepEqual([...M.NAV_ACTING].sort(), ['nav.click', 'nav.modal']);
    for (const a of M.NAV_ACTING) {
      const at = SCHED.indexOf(`case '${a}':`);
      assert.ok(at > 0, a);
      const body = SCHED.slice(at, SCHED.indexOf('break;', at));
      assert.match(body, /requirePerm\(task, 'navigate'/, `${a} must ask navigate`);
    }
  });
});

describe('the guard read at the moment of the click', () => {
  const ok = { tag: 'BUTTON', id: 'btn-lib-check-updates', classes: ['btn'], text: 'Check for updates' };
  test('an ordinary button passes', () => assert.equal(M.sensitiveReason(ok), null));
  test('fields, consents, credentials and danger are refused', () => {
    assert.equal(M.sensitiveReason({ ...ok, tag: 'INPUT' }), 'field');
    assert.equal(M.sensitiveReason({ ...ok, type: 'password' }), 'field');
    assert.equal(M.sensitiveReason({ ...ok, inConsent: true }), 'consent');
    assert.equal(M.sensitiveReason({ ...ok, inCredentialForm: true }), 'credentials');
    assert.equal(M.sensitiveReason({ ...ok, classes: ['btn', 'btn-danger'] }), 'danger');
    assert.equal(M.sensitiveReason({ ...ok, text: 'Delete this profile' }), 'danger');
    assert.equal(M.sensitiveReason({ ...ok, text: 'Supprimer' }), 'danger');
    assert.equal(M.sensitiveReason({ ...ok, id: 'btn-accept-terms' }), 'danger');
    assert.equal(M.sensitiveReason({ ...ok, disabled: true }), 'disabled');
  });
  test('a selector to highlight is bounded', () => {
    assert.equal(M.selectorProblem('#repo-follow-card'), null);
    assert.equal(M.selectorProblem(''), 'empty');
    assert.equal(M.selectorProblem('<img src=x>'), 'invalid');
    assert.equal(M.selectorProblem('a'.repeat(301)), 'long');
  });
  test('ids that land in a selector are plain words', () => {
    assert.ok(M.validPageId('plugins'));
    assert.ok(!M.validPageId('plugins"] , *'));
    assert.ok(M.validTabPath('scripts/tasks'));
    assert.ok(!M.validTabPath('a/b/c'));
    assert.ok(!M.validTabPath('x"]'));
  });
});

describe('effects and the dry-run plan', () => {
  test('what a step does', () => {
    assert.equal(M.effectOf('nav.page'), 'nav');
    assert.equal(M.effectOf('nav.click', { control: 'library.history' }), 'nav');
    assert.equal(M.effectOf('nav.click', { control: 'library.verify' }), 'read');
    assert.equal(M.effectOf('nav.click', { control: 'repo.followCheckAll' }), 'change');
    assert.equal(M.effectOf('cache.clean'), 'delete');
    assert.equal(M.effectOf('catalog.updates', { mode: 'check' }), 'read');
    assert.equal(M.effectOf('catalog.updates', { mode: 'install' }), 'network');
    assert.equal(M.effectOf('repos.checkFollowed', { mode: 'auto' }), 'change');
    assert.equal(M.effectOf('custom.command'), 'external');
    assert.equal(M.effectOf('var.set'), 'flow');
  });

  test('a branch is a maybe, a try body is not, a disabled step is not walked into', () => {
    const act = (type) => ({ kind: 'action', action: { type, params: {} } });
    const rows = M.planSteps([
      act('nav.page'),
      { kind: 'if', condition: { type: 'always', params: {} }, then: [act('cache.clean')], else: [act('notify')] },
      { kind: 'try', steps: [act('logs.rotate')], onError: [act('notify')] },
      { kind: 'repeat', mode: 'times', times: 2, maxIters: 2, everySec: 0, steps: [act('nav.highlight')], disabled: true },
    ]);
    const by = (p) => rows.find((r) => r.path === p);
    assert.equal(by('0').certain, true);
    assert.equal(by('1.then.0').certain, false);
    assert.equal(by('1.else.0').certain, false);
    assert.equal(by('2.steps.0').certain, true);
    assert.equal(by('2.onError.0').certain, false);
    assert.equal(by('3').disabled, true);
    assert.equal(by('3.steps.0'), undefined);
    const sum = M.planSummary(rows);
    assert.equal(sum.nav, 1);
    assert.equal(sum.delete, 2);
  });

  test('the measured dry runs are steps the runner knows', () => {
    for (const a of M.DRY_MEASURED) assert.ok(SCHED.includes(`case '${a}':`), a);
  });
});
