// « Show me » buttons, tickable steps and GIF cards in the guide pages of Help & other.
//
// What matters here: a page can only ever ask for a NAME from an allow-list (doc-actions.ts),
// and only our own (trusted) pages get the interactive leaves at all. Against the COMPILED
// modules; md-lite is rendered trusted, as the hub renders a bundled page.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const A = await imp('frontend/js/docs/doc-actions.js');
const { renderDocMarkdown, renderDocMarkup } = await imp('frontend/js/docs/md-lite.js');
const render = (md) => renderDocMarkdown(md, { trusted: true });

describe('parseShow: the allow-list', () => {
  test('known names parse', () => {
    assert.deepEqual(A.parseShow('show:view/profiles'), { kind: 'view', name: 'profiles' });
    assert.deepEqual(A.parseShow('tutorial/basics/profiles/s1'), { kind: 'tutorial', id: 'basics', part: 'profiles', step: 's1' });
    assert.equal(A.parseShow('tutorial/order/order').part, 'order');
    assert.deepEqual(A.parseShow('automations'), { kind: 'automations' });
    assert.deepEqual(A.parseShow('palette'), { kind: 'palette' });
    assert.deepEqual(A.parseShow('notes'), { kind: 'notes' });
    assert.deepEqual(A.parseShow('settings'), { kind: 'settings', name: '' });
    assert.deepEqual(A.parseShow('settings/updates'), { kind: 'settings', name: 'updates' });
    assert.deepEqual(A.parseShow('doc/guide/create-profile'), { kind: 'doc', path: 'guide/create-profile' });
  });

  test('anything else is refused', () => {
    for (const bad of [
      '', 'view', 'view/', 'view/unknown', 'view/library/extra', 'view/..%2f', 'view/__proto__',
      'settings/__proto__', 'settings/constructor', 'settings/nope', 'settings/updates/x',
      'tutorial', 'tutorial/', 'tutorial/Basics', 'tutorial/a/b/c/d', 'tutorial/a b',
      'javascript:alert(1)', 'eval/1', 'automations/x', 'doc/', 'doc/../x', 'doc//x', 'doc/a b', 'doc/<img>',
      'show:javascript:alert(1)', 'run/anything', 'palette/1',
    ]) assert.equal(A.parseShow(bad), null, `should refuse: ${bad}`);
  });

  test('every named view is a screen of the sidebar and every settings name maps to an id', () => {
    assert.ok(A.SHOW_VIEWS.includes('library') && A.SHOW_VIEWS.includes('repo'));
    for (const id of Object.values(A.SHOW_SETTINGS)) assert.match(id, /^settings-[a-z-]+-card$/);
  });
});

describe('runShow', () => {
  const calls = [];
  const deps = {
    startTutorial: (...a) => calls.push(['tut', ...a]), clickNav: (v) => calls.push(['nav', v]),
    goToSettings: (t) => calls.push(['settings', t]), openAutomations: () => calls.push(['auto']),
    openPalette: () => calls.push(['pal']), openNotes: () => calls.push(['notes']), openDoc: (p) => calls.push(['doc', p]),
  };
  test('runs exactly the named action', () => {
    calls.length = 0;
    assert.equal(A.runShow('view/modpacks', deps), true);
    assert.equal(A.runShow('tutorial/advanced/follow', deps), true);
    assert.equal(A.runShow('settings/updates', deps), true);
    assert.equal(A.runShow('notes', deps), true);
    assert.deepEqual(calls, [['nav', 'modpacks'], ['tut', 'advanced', 'follow', ''], ['settings', 'settings-auto-update-card'], ['notes']]);
  });
  test('a refused spec calls nothing', () => {
    calls.length = 0;
    assert.equal(A.runShow('view/not-a-view', deps), false);
    assert.equal(A.runShow('javascript:alert(1)', deps), false);
    assert.deepEqual(calls, []);
  });
});

describe('md-lite: Show me buttons', () => {
  test('a valid one is a button with the name, on a trusted page', () => {
    const html = render('[Show me](show:view/profiles)');
    assert.match(html, /<button type="button" class="dh-show" data-show="view\/profiles">/);
    assert.match(html, /<span>Show me<\/span>/);
  });
  test('an unknown name is plain text, not a button', () => {
    const html = render('[Hack](show:view/evil) and [x](show:javascript:alert(1))');
    assert.doesNotMatch(html, /data-show/);
    assert.match(html, /Hack/);
  });
  test('an UNTRUSTED render never produces one', () => {
    const html = renderDocMarkup('[Show me](show:view/profiles)');       // markup path: no trust granted
    assert.doesNotMatch(html, /data-show|<button/);
  });
  test('a name cannot smuggle an attribute', () => {
    const html = render('[x](show:view/profiles" onclick="alert(1))');
    assert.doesNotMatch(html, /onclick=/);
  });
});

describe('md-lite: tickable steps', () => {
  test('a list of [ ] items becomes checkboxes keyed by a hash of the text', () => {
    const html = render('- [ ] **Open it.** You see: a thing\n- [x] Do the other\n');
    assert.match(html, /<ul class="dh-tasks" data-ck-list>/);
    assert.equal((html.match(/type="checkbox"/g) || []).length, 2);
    assert.match(html, /data-ck="[a-z0-9]+"/);
    assert.match(html, /data-ck-default="1"/);
    assert.match(html, /<b>Open it\.<\/b>/);
  });
  test('a mixed list stays a plain list', () => {
    const html = render('- [ ] a task\n- not a task\n');
    assert.doesNotMatch(html, /type="checkbox"/);
  });
  test('untrusted markup keeps the text and never emits an input', () => {
    const html = renderDocMarkup('- [ ] a task\n- [ ] another\n');
    assert.doesNotMatch(html, /<input/);
    assert.match(html, /a task/);
  });
  test('stepKey is stable and differs per text', () => {
    assert.equal(A.stepKey('abc'), A.stepKey('abc'));
    assert.notEqual(A.stepKey('abc'), A.stepKey('abd'));
  });
});

describe('md-lite: GIFs', () => {
  test('a .gif gets the class the hub turns into a click-to-play still', () => {
    assert.match(render('![Clip](../a/b.gif)'), /class="dh-md-img dh-gif"/);
    assert.match(render('![Shot](../a/b.png)'), /class="dh-md-img"/);
    assert.doesNotMatch(render('![Shot](../a/b.png)'), /dh-gif/);
  });
});

describe('the checklist store', () => {
  test('toggling adds and removes, and an emptied page is dropped', () => {
    let s = {};
    s = A.toggleCheck(s, 'guide/x', 'k1', true);
    s = A.toggleCheck(s, 'guide/x', 'k2', true);
    assert.deepEqual(s, { 'guide/x': ['k1', 'k2'] });
    s = A.toggleCheck(s, 'guide/x', 'k1', false);
    s = A.toggleCheck(s, 'guide/x', 'k2', false);
    assert.deepEqual(s, {});
  });
  test('a damaged store reads as empty', () => {
    assert.deepEqual(A.readChecks('not json'), {});
    assert.deepEqual(A.readChecks('[1,2]'), {});
    assert.deepEqual(A.readChecks('{"p":[1,"a"],"q":5}'), { p: ['a'] });
    assert.deepEqual(A.readChecks(null), {});
  });
  test('the store is bounded', () => {
    let s = {};
    for (let i = 0; i < 200; i++) s = A.toggleCheck(s, `p${i}`, 'k', true);
    assert.ok(Object.keys(s).length <= 120);
  });
});

describe('the guide pages only ask for things that exist', () => {
  test('every show: link in BMM Docs parses, and its tutorial part exists', async () => {
    const { readFileSync, readdirSync, statSync, existsSync } = await import('node:fs');
    const docs = join(ROOT, 'BMM Docs', 'docs');
    if (!existsSync(docs)) return;                       // the docs repo is not checked out beside this one
    const tut = readFileSync(join(ROOT, 'frontend/src/ui/tutorial-data.ts'), 'utf8').split('\n');
    const parts = {};
    let cur = '';
    for (const l of tut) {
      let m = /^    id: '([a-z0-9-]+)'/.exec(l);
      if (m) { cur = m[1]; parts[cur] = new Set(); continue; }
      m = /^            id: '([a-z0-9-]+)',/.exec(l);
      if (m && cur) parts[cur].add(m[1]);
    }
    const files = [];
    (function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (n !== 'assets') walk(p); } else if (n.endsWith('.md')) files.push(p); } })(docs);
    let seen = 0;
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\]\((show:[^)\s]*)\)/g)) {
        seen++;
        const a = A.parseShow(m[1]);
        assert.ok(a, `${f}: ${m[1]} is not an allowed action`);
        if (a.kind === 'tutorial') {
          assert.ok(parts[a.id], `${f}: no tutorial ${a.id}`);
          if (a.part) assert.ok(parts[a.id].has(a.part), `${f}: tutorial ${a.id} has no part ${a.part}`);
        }
      }
    }
    assert.ok(seen > 0 || files.length === 0);
  });
});
