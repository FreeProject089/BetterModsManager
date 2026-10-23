// The in-app blog's tag dropdown, against the COMPILED module (frontend/js).
//
// The rule under test is the one the owner asked for: the options are the tags the feed
// actually carries — never a hard-coded list — each once, with how many posts carry it.
// A tag no post carries must not be produced at all.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { tagOf, blogTags, effectiveTag, ALL_TAGS, PROJ_LOGO } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/community/blog-tags.js')).href
);

const proj = (key, name) => ({ project: { key, name } });
const page = (slug, name, icon) => ({ project: null, showcaseProject: { slug, name, icon } });

describe('tagOf — BCWEB TypeTag precedence and labels', () => {
  test('a project post is tagged with its project, BCWEB label and the bundled logo', () => {
    assert.deepEqual(tagOf(proj('bmm', 'BetterModsManager')), { key: 'bmm', projectKey: 'bmm', label: 'BMM', logo: PROJ_LOGO.bmm });
    assert.equal(tagOf(proj('installer', 'Installer')).label, 'BetterInstaller');
    assert.equal(tagOf(proj('bsm', 'x')).label, 'BSM');
  });
  test('a project with no bundled logo keeps an empty logo (the caller draws a monogram)', () => {
    assert.equal(tagOf(proj('bsm', 'x')).logo, '');
  });
  test('an unknown project falls back to its own name, then its key', () => {
    assert.equal(tagOf(proj('newthing', 'New Thing')).label, 'New Thing');
    assert.equal(tagOf(proj('newthing')).label, 'NEWTHING');
  });
  test('a showcase page is its own tag, with its own name and icon, ahead of any project', () => {
    const t = tagOf({ ...page('my-page', 'My Page', '/api/media/x.png'), project: { key: 'bmm' } });
    assert.deepEqual(t, { key: 'page:my-page', projectKey: 'community', label: 'My Page', logo: '/api/media/x.png' });
  });
  test('a post with neither is Community (label left for the caller to translate)', () => {
    for (const p of [{}, { project: null, showcaseProject: null }, proj('community', 'Community'), null, undefined]) {
      assert.deepEqual(tagOf(p), { key: 'community', projectKey: 'community', label: null, logo: PROJ_LOGO.community });
    }
  });
  test('never produces the All key, even for a project keyed "all"', () => {
    assert.notEqual(tagOf(proj('all', 'All the things')).key, ALL_TAGS);
    assert.equal(tagOf(proj('all', 'All the things')).label, 'All the things');
  });
});

describe('blogTags — options come from the posts, nothing else', () => {
  test('an empty or missing feed has no tags', () => {
    assert.deepEqual(blogTags([]), []);
    assert.deepEqual(blogTags(null), []);
  });
  test('only tags some post carries, each once, with its count', () => {
    const tags = blogTags([proj('bmm'), proj('bmm'), page('p', 'Page'), {}, proj('bmm')]);
    assert.deepEqual(tags.map((t) => [t.key, t.count]), [['bmm', 3], ['community', 1], ['page:p', 1]]);
    // BSM and BetterInstaller were options of the old fixed list; nobody posted there here.
    assert.equal(tags.some((t) => t.key === 'bsm' || t.key === 'installer'), false);
  });
  test('the counts add up to the number of posts', () => {
    const posts = [proj('bmm'), proj('bsm'), proj('installer'), page('a', 'A'), page('b', 'B'), {}, {}];
    assert.equal(blogTags(posts).reduce((n, t) => n + t.count, 0), posts.length);
  });
  test('most posts first, then by name — stable between two loads', () => {
    const a = blogTags([proj('installer'), proj('bsm'), proj('bmm'), proj('bsm')]);
    const b = blogTags([proj('bsm'), proj('bmm'), proj('bsm'), proj('installer')]);
    assert.deepEqual(a.map((t) => t.key), ['bsm', 'installer', 'bmm']); // BetterInstaller sorts before BMM by name
    assert.deepEqual(a, b);
  });
});

describe('effectiveTag — the remembered choice', () => {
  const tags = blogTags([proj('bmm'), {}]);
  test('kept while the feed still carries it', () => assert.equal(effectiveTag('bmm', tags), 'bmm'));
  test('falls back to All once the feed no longer carries it', () => assert.equal(effectiveTag('bsm', tags), ALL_TAGS));
  test('kept while there is no feed (loading / offline), so it applies once posts arrive', () => assert.equal(effectiveTag('bsm', null), 'bsm'));
  test('All stays All', () => assert.equal(effectiveTag(ALL_TAGS, []), ALL_TAGS));
});
