// Completion for the BMMScript box, against the COMPILED module.
//
// Every test here is about the panel NOT appearing. Suggesting the right thing is easy and
// obvious when it goes wrong; the way a completer becomes hateful is by appearing over a
// string, over a Python body, on the first keystroke, or when you have already finished the
// word — and each of those looks fine in a screenshot of the one case somebody tried.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { completionsFor, KEYWORDS, ENGINES } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/settings/bmms-complete.js')).href
);

const V = {
  // `apps.notify` exists here purely so one query can match one entry by PREFIX and
  // another by substring — which is the only way to test that the two are ranked apart.
  actions: ['mods.scan', 'mod.disable', 'notify', 'repo.sync', 'apps.notify'],
  conditions: ['online', 'modEnabled', 'fileExists'],
  sources: ['disk.free_gb', 'lasttask.ok'],
  loops: ['mods', 'enabledMods'],
  params: {
    'repo.sync': ['url', 'profile'],
    'mods.scan': [],
    notify: ['message', 'level'],
  },
};

/** `|` marks the caret, so a case reads as the thing somebody typed. */
const at = (s, force = false) => {
  const caret = s.indexOf('|');
  assert.ok(caret >= 0, 'the case must mark the caret with |');
  return completionsFor(s.replace('|', ''), caret, V, force).items.map((c) => c.text);
};

describe('where it offers something', () => {
  test('after `do `, only actions', () => {
    assert.deepEqual(at('do mo|'), ['mods.scan', 'mod.disable']);
  });

  test('in a condition slot, conditions AND value sources', () => {
    // `if disk.free_gb < 5` is a comparison: the left side is a source, not a condition.
    assert.deepEqual(at('if onl|'), ['online']);
    assert.deepEqual(at('if disk.f|'), ['disk.free_gb']);
  });

  test('after `for x in`, only what a loop can walk', () => {
    assert.deepEqual(at('for a in enab|'), ['enabledMods']);
  });

  test('after `script`, only engines', () => {
    assert.deepEqual(at('script pyt|'), ['python']);
  });

  test('at the start of a statement, keywords', () => {
    assert.deepEqual(at('rep|'), ['repeat']);
  });

  test('a substring still matches, but below the prefix matches', () => {
    // `notify` STARTS with it; `apps.notify` only contains it.
    const r = at('do not|');
    assert.deepEqual(r, ['notify', 'apps.notify']);
  });
});

describe('where it stays shut', () => {
  test('one character is not enough', () => {
    assert.deepEqual(at('do m|'), []);
  });

  test('…unless it was asked for outright', () => {
    assert.deepEqual(at('do m|', true), ['mods.scan', 'mod.disable']);
  });

  test('inside a string', () => {
    assert.deepEqual(at('do notify(message: "sca|'), []);
  });

  test('a string that closed does NOT keep it shut afterwards', () => {
    // The counting is from the top of the file, so an even number of quotes has to leave
    // the position outside. Getting this backwards suppresses the panel for the rest of the
    // file after the first message: parameter.
    assert.deepEqual(at('do notify(message: "hi")\nrep|'), ['repeat']);
  });

  test('inside a script body — that text is not BMMScript', () => {
    assert.deepEqual(at('script python {\n  imp|'), []);
  });

  test('…and comes back once the body is closed', () => {
    assert.deepEqual(at('script python {\n  x = 1\n}\nrep|'), ['repeat']);
  });

  test('a brace inside the script body does not end it early', () => {
    assert.deepEqual(at('script python {\n  d = {"a": 1}\n  imp|'), []);
  });

  test('when the word is already exactly the only match', () => {
    // You typed it. A panel confirming that sits over the bracket you were about to type.
    assert.deepEqual(at('do repo.sync|'), []);
  });

  test('a caret outside the text is refused rather than guessed at', () => {
    assert.deepEqual(completionsFor('do mods', 99, V).items, []);
    assert.deepEqual(completionsFor('do mods', -1, V).items, []);
  });
});

describe("what the box could not tell you before", () => {
  test('inside an action\'s brackets, its parameters \u2014 from zero characters', () => {
    // The half nobody can remember. `do repo.sync(` used to offer keywords, because the
    // caret was "somewhere we cannot place" and keywords are the fallback.
    assert.deepEqual(at('do repo.sync(|'), ['url', 'profile']);
    assert.deepEqual(at('do repo.sync(u|'), ['url']);
  });

  test('a parameter already written is not offered twice', () => {
    assert.deepEqual(at('do repo.sync(url: "x", |'), ['profile']);
  });

  test('but not while typing a VALUE \u2014 that is not a name position', () => {
    // After the colon you are writing somebody\'s URL, and a list of parameter names over it
    // is the noise this module exists to avoid.
    assert.deepEqual(at('do repo.sync(url: htt|'), []);
  });

  test('an action with no parameters offers nothing rather than the fallback', () => {
    assert.deepEqual(at('do mods.scan(|'), []);
  });

  test('after `set n:`, the five types', () => {
    assert.deepEqual(at('set n: |'), ['text', 'number', 'whole', 'decimal', 'yesno']);
    assert.deepEqual(at('set n: wh|'), ['whole']);
    // A colon inside a call is a parameter, not a type.
    assert.ok(!at('do notify(message: |').includes('whole'));
  });

  test('variables the script has already named', () => {
    const src = 'set count = 0\nshared set team = "red"\nfor item in mods {\n    if cou|';
    assert.ok(at(src).includes('count'), 'a variable set above should be offered');
    // The line being typed is not a definition: `set tot` must not offer `tot` back.
    assert.ok(!at('set count = 0\nset tot|').includes('tot'));
  });

  test('a variable defined BELOW the caret is not offered', () => {
    // It does not exist yet at that point in the run; offering it is offering 0.
    const src = 'if lat|\nset later = 1';
    assert.ok(!at(src).includes('later'));
  });

  test('in-order letters match, but rank below a real prefix or substring', () => {
    // `mods.scan` as "mss". Three characters minimum, so two random letters cannot drag in
    // half the vocabulary.
    assert.ok(at('do mss|').includes('mods.scan'));
    assert.deepEqual(at('do ms|'), [], 'two characters do not get the loose tier');
    // And only as a FALLBACK: a query with real matches is not padded with fuzzy ones.
    assert.deepEqual(at('if onl|'), ['online']);
  });
});

describe('the vocabulary itself', () => {
  test('the grammar keywords are all there', () => {
    // Not an exhaustive list — a spot check that the constant was not emptied by an edit,
    // which would leave every statement-start case silently offering nothing.
    // The trigger words are in here on purpose: they are the ones a hand-maintained list
    // forgets, because nothing breaks when it does — the language accepts them, the editor
    // just never suggests them.
    for (const k of [
      'do', 'if', 'for', 'repeat', 'parallel', 'try', 'switch', 'call', 'set',
      'after', 'when', 'probe',
    ]) {
      assert.ok(KEYWORDS.includes(k), `missing keyword: ${k}`);
    }
  });

  test('every engine the script block accepts is offered', () => {
    assert.deepEqual([...ENGINES].sort(), ['bash', 'cmd', 'node', 'powershell', 'python', 'rust']);
  });

  test('the caret range replaces the word rather than appending to it', () => {
    const text = 'do mods';
    const r = completionsFor(text, text.length, V);
    assert.equal(text.slice(r.from, r.to), 'mods', 'the range must cover the typed word');
  });
});
