// Animation Studio model (sequences → GSAP timeline, storage compat, import validation,
// picker selectors) against the COMPILED module.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/debug/anim-timeline-model.js')).href);
const { normalizeAnim, normalizeList, compileTimeline, positionOf, parseAnimImport, exportAnims, moveItem,
  uniqueSelector, cssEscape, easeCurvePath, isPlausibleEase, defaultStep, withMirror } = M;

const legacy = { id: 'aold1', name: 'Cards', selector: '.mod-item', preset: 'slideUp', duration: 0.4, delay: 0.2, stagger: 0.05, ease: 'power2.out', auto: true };

describe('storage compatibility', () => {
  test('a legacy single animation becomes a one-step sequence, delay → offset', () => {
    const a = normalizeAnim(legacy);
    assert.equal(a.steps.length, 1);
    assert.deepEqual(a.steps[0], { selector: '.mod-item', preset: 'slideUp', duration: 0.4, stagger: 0.05, ease: 'power2.out', at: 'after', offset: 0.2 });
    assert.equal(a.auto, true);
  });
  test('a sequence keeps the legacy fields mirrored from its first step', () => {
    const a = withMirror({ id: 'x', name: '', auto: false, steps: [{ ...defaultStep('#a'), preset: 'pop', offset: 0.3 }, defaultStep('#b')] });
    assert.equal(a.selector, '#a');
    assert.equal(a.preset, 'pop');
    assert.equal(a.delay, 0.3);
  });
  test('junk in storage is skipped, duplicate ids re-issued', () => {
    const list = normalizeList([legacy, null, { preset: 'nope' }, legacy, 'x']);
    assert.equal(list.length, 2);
    assert.notEqual(list[0].id, list[1].id);
    assert.deepEqual(normalizeList('garbage'), []);
  });
  test('numbers are clamped and an executable-looking ease is refused', () => {
    const a = normalizeAnim({ ...legacy, duration: 9999, stagger: -3, ease: 'alert(1)//' });
    assert.equal(a.steps[0].duration, 30);
    assert.equal(a.steps[0].stagger, 0);
    assert.equal(a.steps[0].ease, 'power2.out');
    assert.ok(isPlausibleEase('back.out(1.7)'));
    assert.ok(isPlausibleEase('elastic.out(1, 0.4)'));
    assert.ok(!isPlausibleEase('x;y'));
  });
});

describe('compileTimeline', () => {
  const seq = withMirror({ id: 's', name: 'Seq', auto: false, steps: [
    { ...defaultStep('#a'), preset: 'fadeIn', duration: 1, stagger: 0, offset: 0.5 },
    { ...defaultStep('#b'), preset: 'fadeIn', duration: 1, stagger: 0.1, at: 'after', offset: 0.25 },
    { ...defaultStep('#c'), preset: 'pulse', duration: 0.5, stagger: 0, at: 'with', offset: 0 },
  ] });
  test('GSAP positions: absolute first, then relative to the previous step', () => {
    assert.deepEqual(seq.steps.map(positionOf), [0.5, '>0.25', '<']);
    assert.equal(positionOf({ ...defaultStep(), at: 'after', offset: -0.2 }, 1), '>-0.2');
  });
  test('layout follows the same rules, stagger widens a step, pulse yoyos', () => {
    const c = compileTimeline(seq, [1, 3, 1]);
    assert.deepEqual(c.layout, [{ start: 0.5, end: 1.5 }, { start: 1.75, end: 2.95 }, { start: 1.75, end: 2.75 }]);
    assert.equal(c.total, 2.95);
    assert.equal(c.ops[2].method, 'fromTo');
    assert.equal(c.ops[0].vars.opacity, 0);
  });
  test('the stagger preset keeps its historic defaults', () => {
    const c = compileTimeline(withMirror({ id: 'z', name: '', auto: false, steps: [{ ...defaultStep('#a'), duration: 0, stagger: 0, ease: '' }] }));
    assert.equal(c.ops[0].vars.duration, 0.5);
    assert.equal(c.ops[0].vars.stagger, 0.06);
  });
});

describe('import / export', () => {
  test('round trip', () => {
    const list = normalizeList([legacy]);
    const r = parseAnimImport(exportAnims(list), { existingIds: [] });
    assert.deepEqual(r.errors, []);
    assert.equal(r.anims.length, 1);
    assert.equal(r.anims[0].steps[0].selector, '.mod-item');
  });
  test('imports never auto-run, colliding ids are re-issued, bad records are named', () => {
    const r = parseAnimImport(JSON.stringify([legacy, { preset: 'x' }, { ...legacy, selector: '##bad' }]), {
      existingIds: ['aold1'], isValidSelector: (s) => !s.startsWith('##'),
    });
    assert.equal(r.anims.length, 1);
    assert.equal(r.anims[0].auto, false);
    assert.notEqual(r.anims[0].id, 'aold1');
    assert.deepEqual(r.errors, ['#2: invalid', '#3: selector']);
  });
  test('not JSON / wrong shape', () => {
    assert.deepEqual(parseAnimImport('{').errors, ['json']);
    assert.deepEqual(parseAnimImport('{"a":1}').errors, ['shape']);
  });
  test('moveItem', () => {
    assert.deepEqual(moveItem([1, 2, 3], 0, 2), [2, 3, 1]);
    assert.deepEqual(moveItem([1, 2, 3], 0, 5), [1, 2, 3]);
  });
});

describe('uniqueSelector', () => {
  // A tiny fake tree: body > main#app > ul.list > li.item × 3, plus a div with a data-id.
  const node = (tagName, props = {}, kids = []) => {
    const n = { tagName: tagName.toUpperCase(), id: '', className: '', parentElement: null, children: kids, getAttribute: (k) => (props.attrs || {})[k] ?? null, ...props };
    kids.forEach((k) => { k.parentElement = n; });
    return n;
  };
  const lis = [node('li', { className: 'item active' }), node('li', { className: 'item' }), node('li', { className: 'item' })];
  const ul = node('ul', { className: 'list' }, lis);
  const tagged = node('div', { className: 'card', attrs: { 'data-id': 'mod-7' } });
  const app = node('main', { id: 'app' }, [ul, tagged]);
  node('body', {}, [app]);
  const counts = { '#app': 1, 'div[data-id="mod-7"]': 1, 'li.item': 3, 'li.item:nth-of-type(2)': 3, 'ul.list > li.item:nth-of-type(2)': 1 };
  const count = (s) => counts[s] ?? 2;

  test('unique id first', () => { assert.equal(uniqueSelector(app, count), '#app'); });
  test('stable attribute before classes', () => { assert.equal(uniqueSelector(tagged, count), 'div[data-id="mod-7"]'); });
  test('a short nth-of-type path when classes are shared', () => { assert.equal(uniqueSelector(lis[1], count), 'ul.list > li.item:nth-of-type(2)'); });
  test('state classes (active) are never used', () => { assert.ok(!uniqueSelector(lis[0], count).includes('active')); });
  test('anchors on an ancestor id when nothing else is unique', () => {
    const c2 = (s) => (s === '#app' ? 1 : 2);
    assert.equal(uniqueSelector(lis[2], c2), '#app > ul.list > li.item:nth-of-type(3)');
  });
  test('only studio classes → still valid (no dangling "div.")', () => {
    const lone = node('div', { className: 'anim-panel rstudio-bar' });
    node('section', {}, [lone]);
    assert.equal(uniqueSelector(lone, () => 2), 'section > div');
  });
  test('cssEscape follows the spec for leading digits and specials', () => {
    assert.equal(cssEscape('1a'), '\\31 a');
    assert.equal(cssEscape('a:b'), 'a\\:b');
    assert.equal(cssEscape('-'), '\\-');
  });
});

describe('easeCurvePath', () => {
  test('linear runs corner to corner', () => {
    const p = easeCurvePath((x) => x, 100, 50, 2);
    assert.equal(p, 'M0.0,50.0 L50.0,25.0 L100.0,0.0');
  });
  test('an overshooting ease stays inside the box', () => {
    const p = easeCurvePath((x) => (x === 0.5 ? 1.5 : x), 100, 60, 2);
    const ys = [...p.matchAll(/,(-?[\d.]+)/g)].map((m) => +m[1]);
    assert.ok(ys.every((y) => y >= 0 && y <= 60), p);
  });
});
