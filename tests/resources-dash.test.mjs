// The resources dashboard's pure parts (G6): the rolling history and the sparkline points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { pushHistory, sparkPoints } = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/resources-spark.js')).href);

test('the history keeps the last N values, oldest first, and a NaN counts as 0', () => {
  let h = [];
  for (let i = 0; i < 65; i++) h = pushHistory(h, i);
  assert.equal(h.length, 60);
  assert.equal(h[0], 5);
  assert.equal(h[59], 64);
  assert.deepEqual(pushHistory([1], NaN, 3), [1, 0]);
});

test('sparkline points span the width and put the ceiling at the top', () => {
  assert.equal(sparkPoints([], 120, 28, 100), '');
  const pts = sparkPoints([0, 50, 100], 120, 28, 100).split(' ').map((p) => p.split(',').map(Number));
  assert.deepEqual(pts[0], [0, 28]);
  assert.deepEqual(pts[1], [60, 14]);
  assert.deepEqual(pts[2], [120, 0]);
});

test('a value above the ceiling rescales instead of leaving the box', () => {
  const pts = sparkPoints([0, 4], 100, 20, 1).split(' ').map((p) => p.split(',').map(Number));
  assert.equal(Math.min(...pts.map(([, y]) => y)), 0);
});

test('a matrix row becomes the rule to store: empty = inherit, garbage dropped, nothing = remove', async () => {
  const { ruleFromInputs } = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/resources-spark.js')).href);
  assert.equal(ruleFromInputs({ rate: '', parallel: '', buffer: '', io: '' }), null);
  assert.deepEqual(ruleFromInputs({ rate: '40', parallel: ' 3 ', buffer: 'abc', io: '' }), { rate_mb_s: 40, parallel: 3 });
  assert.deepEqual(ruleFromInputs({ rate: '0', io: 'low' }), { io_priority: 'low' }, 'a 0 rate is not stored (it would block for ever)');
  assert.deepEqual(ruleFromInputs({ buffer: '512.9', io: 'high' }), { buffer_kib: 512 }, 'only low / normal priorities exist');
});

// Owner card 2 (pentest R13): a task or plugin that paused everything and never resumed left
// every later deploy waiting with nothing on screen to say why. The status now carries
// `paused_all` ({ by, age_ms, remaining_ms }); the dashboard says who and offers Resume.
test('the "everything is paused" line says who paused and when it ends by itself', async () => {
  const { pausedAllText } = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/resources-spark.js')).href);
  const none = () => '';                      // no dictionary: the English fallbacks
  const task = pausedAllText({ by: 'task:Nightly', age_ms: 0, remaining_ms: 29.5 * 60000 }, none);
  assert.match(task, /Everything is paused/);
  assert.match(task, /the task “Nightly”/);
  assert.match(task, /Resumes by itself in 30 min/);
  assert.match(pausedAllText({ by: 'plugin:p1', age_ms: 0, remaining_ms: 1 }, none), /plugin p1\..*in 1 min/);
  const user = pausedAllText({ by: 'user', age_ms: 5000, remaining_ms: null }, none);
  assert.match(user, /Paused by you/);
  assert.doesNotMatch(user, /Resumes by itself/, "the user's own pause has no end");
  assert.match(pausedAllText({ by: 'task:', age_ms: 0, remaining_ms: 60000 }, none), /by an automation/);
  // The dictionary wins when it answers.
  assert.equal(pausedAllText({ by: 'api', age_ms: 0, remaining_ms: null }, (k) => `<${k}>`), '<res.pausedAll> <res.pausedBy.api>');
});

test('the dashboard paints the pause from both feeds, with a Resume, and its own pause is the user\'s', () => {
  const src = readFileSync(join(ROOT, 'frontend/src/features/settings/resources-dash.ts'), 'utf8');
  assert.match(src, /paintPausedAll\(st\.paused_all\)/, 'the first status read must show the pause');
  assert.match(src, /paintPausedAll\(s\.paused_all\)/, 'the live tick must show the pause');
  const box = src.match(/<div class="res-paused-all"[\s\S]*?<\/div>/);
  assert.ok(box, 'no "everything is paused" box on the dashboard');
  assert.match(box[0], /data-a="resume_all"/, 'the box must offer Resume (resume_all)');
  assert.match(src, /invoke\('resources_queue', \{[^}]*by: 'user'/, "the dashboard's pause must be the user's (no end)");
  const sched = readFileSync(join(ROOT, 'frontend/src/features/settings/scheduler.ts'), 'utf8');
  const step = sched.match(/case 'resources\.queue':[\s\S]*?break;/);
  assert.ok(step, 'the resources.queue step was not found (renamed?)');
  assert.match(step[0], /by: `task:/, 'a task step must name itself, which also bounds its pause');
});
