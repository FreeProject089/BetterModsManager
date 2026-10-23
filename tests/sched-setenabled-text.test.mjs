// `task.setEnabled` is described the way it behaves.
//
// The runner refuses a task that names ITSELF (`sched.arm.notSelf`), and the description the
// block editor, the in-app BMMScript reference and BMM Docs all show said the opposite: "a task
// can arm the one that follows it and disarm itself". The text is generated into three places
// from the dictionaries, so the dictionaries are what is checked, plus one generated copy to
// prove the generator was re-run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('the runner refuses a task arming or disarming itself', () => {
    const src = read('frontend/src/features/settings/scheduler.ts');
    const i = src.indexOf("case 'task.setEnabled':");
    assert.ok(i > 0);
    const body = src.slice(i, src.indexOf('break;\n        }', i));
    assert.match(body, /if \(id === task\.id\)[^\n]*sched\.arm\.notSelf/, 'the self-refusal moved — re-read what the description should say');
});

test('no description says a task can disarm itself', () => {
    const en = JSON.parse(read('frontend/Lang/en.json'))['sched.actd.task.setEnabled'];
    const fr = JSON.parse(read('frontend/Lang/fr.json'))['sched.actd.task.setEnabled'];
    assert.ok(en && fr);
    assert.ok(!/and disarm itself/i.test(en), `en: ${en}`);
    assert.ok(!/et se désarmer elle-même/i.test(fr), `fr: ${fr}`);
    // And says the refusal, so a reader does not have to find it by running it.
    assert.match(en, /cannot arm or disarm itself/i);
    assert.match(fr, /ne peut ni s’armer ni se désarmer elle-même/i);
    const gen = read('frontend/src/docs/bmms-reference.gen.ts');
    assert.ok(!/and disarm itself/.test(gen) && !/et se désarmer elle-même\./.test(gen), 'bmms-reference.gen.ts is stale — run node scripts/gen-bmms-reference.mjs');
});
