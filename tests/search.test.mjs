// The Ctrl+K ranking, exercised against the COMPILED module the app actually loads.
//
// Ranking fails as "the results feel off" rather than as an error, so it is exactly the kind
// of thing that needs measuring. These assertions are the ones that were wrong before
// core/search.ts existed: the old scorer gave every hit a score of 1, and adding a word to a
// query WIDENED the result set instead of narrowing it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { rank, scoreTerm, scoreHit, terms } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/core/search.js')).href
);

const H = (kind, title, sub = '', keywords = '') => ({ id: title, kind, title, sub, keywords, run() {} });
const CORPUS = [
  H('command', 'Profiles', '', 'profil switch active'),
  H('command', 'Deploy mods', '', 'install apply profile'),
  H('command', 'Mod deployment troubleshooting', '', 'help profile'),
  H('command', 'Settings', '', 'preferences options'),
  H('doc', 'Thèmes personnalisés', 'features/themes.md', 'theme couleur'),
  H('mod', 'A-10C Warthog Skin Pack', 'by Jane · v2.1', 'livery skin'),
  H('profile', 'Multiplayer night ops', '12 mods'),
];

describe('score tiers', () => {
  test('are strictly decreasing: exact > prefix > word start > substring > subsequence', () => {
    const tiers = [
      scoreTerm('mods', 'mods'),                 // exact
      scoreTerm('mod', 'mods'),                  // prefix
      scoreTerm('deploy', 'mod deployment'),     // word start
      scoreTerm('eplo', 'deploy'),               // substring
      scoreTerm('dpl', 'deploy'),                // subsequence
    ];
    for (let i = 1; i < tiers.length; i++) {
      assert.ok(tiers[i] < tiers[i - 1], `tier ${i} (${tiers[i]}) should be below tier ${i - 1} (${tiers[i - 1]})`);
    }
  });

  test('no match at all scores zero', () => {
    assert.equal(scoreTerm('xyz', 'deploy'), 0);
  });

  test('a prefix of a short string beats a prefix of a long one', () => {
    assert.ok(scoreTerm('mod', 'mods') > scoreTerm('mod', 'mod deployment troubleshooting'));
  });
});

describe('ranking', () => {
  test('an exact title beats a keywords-only match', () => {
    // The old scorer counted substring hits, so both scored 1 and the order was arbitrary.
    assert.equal(rank(CORPUS, 'prof', 4)[0].title, 'Profiles');
  });

  test('a second word NARROWS the results', () => {
    const one = rank(CORPUS, 'mod', 20).length;
    const two = rank(CORPUS, 'mod deploy', 20);
    assert.ok(two.length < one, 'adding a word must not bring in more results');
    for (const h of two) {
      const hay = `${h.title} ${h.keywords}`.toLowerCase();
      assert.ok(hay.includes('deploy'), `${h.title} matched without the second term`);
    }
  });

  test('diacritics fold both ways', () => {
    assert.ok(rank(CORPUS, 'theme', 5).some((h) => h.kind === 'doc'), 'unaccented query must find accented text');
    assert.ok(rank(CORPUS, 'thèmes', 5).some((h) => h.kind === 'doc'), 'accented query must still work');
  });

  test('an unmatched query returns nothing rather than everything', () => {
    assert.equal(rank(CORPUS, 'zzzznope', 20).length, 0);
  });

  test('order is stable for the same query', () => {
    const a = rank(CORPUS, 'mod', 20).map((h) => h.title);
    const b = rank(CORPUS, 'mod', 20).map((h) => h.title);
    assert.deepEqual(a, b, 'a list that reshuffles under an unchanged query looks broken');
  });

  test('the limit is honoured', () => {
    assert.ok(rank(CORPUS, 'o', 2).length <= 2);
  });
});

describe('field weighting', () => {
  test('a title match outranks the same match in keywords', () => {
    const byTitle = scoreHit(H('command', 'Profiles'), terms('profiles'));
    const byKeyword = scoreHit(H('command', 'Deploy mods', '', 'profiles switch'), terms('profiles'));
    assert.ok(byTitle > byKeyword, `${byTitle} should beat ${byKeyword}`);
  });

  test('an empty query is a candidate-pass, not a match', () => {
    assert.equal(scoreHit(H('command', 'Anything'), terms('')), 1);
  });
});
