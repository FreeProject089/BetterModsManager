// The notification steps and the feed trigger (sched-feed.ts), and the permission that gates them.
//
// The network itself is tested in Rust against local servers (commands/sched_net.rs: a webhook
// through a local server, a feed read from a local server, the private-address guard, the
// redirect and size rules). This file holds the rules that live in the frontend and the wiring
// between the two.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(join(ROOT, p)).href);
const F = await load('frontend/js/features/settings/sched-feed.js');
const M = await load('frontend/js/features/settings/sched-flow-model.js');
const I = await load('frontend/js/features/settings/bmmpa-inspect.js');
const SCHED_TS = readFileSync(join(ROOT, 'frontend/src/features/settings/scheduler.ts'), 'utf8');
const NET_RS = readFileSync(join(ROOT, 'src-tauri/src/commands/sched_net.rs'), 'utf8');

const item = (id, title = id) => ({ id, title, link: `https://x.example/${id}`, published: '' });

describe('the feed trigger', () => {
  test('the first read only learns what is there', () => {
    const r = F.newFeedItems(undefined, [item('a'), item('b')]);
    assert.equal(r.baseline, true);
    assert.deepEqual(r.fresh, []);
    assert.deepEqual(r.seen, ['a', 'b']);
  });
  test('after that, only items not seen before fire — newest first, once', () => {
    const r = F.newFeedItems(['a', 'b'], [item('c', 'Third'), item('a'), item('b')]);
    assert.equal(r.baseline, false);
    assert.deepEqual(r.fresh.map((i) => i.id), ['c']);
    const again = F.newFeedItems(r.seen, [item('c'), item('a'), item('b')]);
    assert.deepEqual(again.fresh, [], 'the same item never fires twice');
  });
  test('the memory is capped and keeps the newest', () => {
    const many = Array.from({ length: 300 }, (_, i) => `id${i}`);
    const r = F.newFeedItems(many, [item('new')]);
    assert.equal(r.seen.length, F.FEED_SEEN_CAP);
    assert.equal(r.seen[0], 'new');
  });
  test('the run gets the newest new item as {event.*}', () => {
    const ev = F.feedEventData([item('c', 'Third'), item('d')], 'https://feeds.example/x.xml');
    assert.deepEqual(ev, { id: 'c', title: 'Third', link: 'https://x.example/c', published: '', count: 2, feed: 'feeds.example' });
  });
  test('the engine reads the feed only with the `network` grant, before the request', () => {
    const fired = SCHED_TS.slice(SCHED_TS.indexOf('async function rssFired('), SCHED_TS.indexOf('/** What each condition trigger saw last time'));
    const grant = fired.indexOf("hasPerm(task, 'network')");
    assert.ok(grant > 0, 'rssFired does not check the grant');
    assert.ok(fired.indexOf("invoke('sched_feed_fetch'") > grant, 'the feed is read before the grant is checked');
    assert.deepEqual(M.permNeeds([], { type: 'rss', url: 'https://x/f' }).map((n) => n.perm), ['network']);
  });
});

describe('what a webhook sends', () => {
  test('JSON templates escape their values', () => {
    const vals = { title: 'He said "hi"\nbye', n: '3' };
    const out = F.jsonTemplate('{"t":"{title}","n":"{n}","keep":"{missing}"}', (k) => vals[k]);
    assert.deepEqual(JSON.parse(out), { t: 'He said "hi"\nbye', n: '3', keep: '{missing}' });
  });
  test('a JSON body that does not parse is refused before sending, a text one is not judged', () => {
    assert.ok(F.webhookBody('{"a":', 'json').error);
    assert.equal(F.webhookBody('{"a":', 'text').error, undefined);
    assert.equal(F.webhookBody('', 'json').error, undefined);
  });
  test('header lines: a bad line is reported, not dropped', () => {
    assert.deepEqual(F.parseHeaderBlock('X-A: 1\n# note\n\nAuthorization: Bearer t'), { headers: { 'X-A': '1', Authorization: 'Bearer t' }, bad: [] });
    assert.deepEqual(F.parseHeaderBlock('no colon here').bad, ['no colon here']);
    assert.equal(F.maskHeaders({ Authorization: 'Bearer secret' }).includes('secret'), false);
  });
  test('Discord and Slack bodies, and their addresses', () => {
    assert.deepEqual(JSON.parse(F.discordBody('hi @everyone', 'BMM')), { content: 'hi @everyone', allowed_mentions: { parse: [] }, username: 'BMM' });
    assert.equal(JSON.parse(F.discordBody('x'.repeat(3000))).content.length, 2000);
    assert.deepEqual(JSON.parse(F.slackBody('hi')), { text: 'hi' });
    assert.equal(F.webhookUrlProblem('https://discord.com/api/webhooks/1/abc', 'discord'), null);
    assert.equal(F.webhookUrlProblem('https://evil.example/api/webhooks/1', 'discord'), 'not-discord');
    assert.equal(F.webhookUrlProblem('http://hooks.slack.com/services/a', 'slack'), 'not-https');
    assert.equal(F.webhookUrlProblem('file:///c:/x', 'webhook'), 'not-http');
    assert.equal(F.webhookUrlProblem('https://u:p@x.example/', 'webhook'), 'credentials');
    assert.equal(F.webhookUrlProblem('{hookUrl}', 'webhook'), null, 'a variable is judged at run time');
  });
  test('a summary shows the host, never the path that carries the token', () => {
    assert.equal(F.hostOf('https://discord.com/api/webhooks/1/SECRET'), 'discord.com');
    const summary = SCHED_TS.slice(SCHED_TS.indexOf('function flowSummary('), SCHED_TS.indexOf('function flowHost('));
    assert.match(summary, /'webhook\.send' \|\| ty === 'discord\.send' \|\| ty === 'slack\.send'\) return hostOf/);
  });
  test('inline validation rules', () => {
    assert.equal(F.fieldProblem('json', '{"text":"{title}"}'), null, 'a {variable} inside a string is fine');
    assert.equal(F.fieldProblem('json', '{"text": {title}}'), 'sched.v.json');
    assert.equal(F.fieldProblem('url:discord', 'https://x.example/'), 'sched.net.why.not-discord');
    assert.equal(F.fieldProblem('required', ' '), 'sched.v.required');
    assert.equal(F.fieldProblem('int:0-4', '9'), 'sched.v.range');
    assert.equal(F.fieldProblem('regex', '(a+)+$'), 'sched.v.regexNested');
    assert.equal(F.fieldProblem('headers', 'oops'), 'sched.v.headers');
  });
});

describe('the `network` permission', () => {
  test('is in the vocabulary, and the three sending steps need it', () => {
    assert.ok(I.RISK_KEYS.includes('network'));
    for (const type of ['webhook.send', 'discord.send', 'slack.send']) {
      assert.deepEqual(M.ACTION_PERMS[type], { perm: 'network', label: 'sched.permNetwork' }, type);
      const at = SCHED_TS.indexOf(`case '${type}':`);
      const body = SCHED_TS.slice(at, SCHED_TS.indexOf("case 'feed.publish':", at));
      assert.ok(body.indexOf("requirePerm(task, 'network'") > 0, `${type} does not require network`);
      assert.ok(body.indexOf("requirePerm(task, 'network'") < body.indexOf('sendNet('), `${type} sends before checking`);
    }
    assert.equal(M.ACTION_PERMS['feed.publish'], undefined, 'a local file needs no network');
  });
  test('an imported task never arrives with it', () => {
    assert.match(SCHED_TS, /perms: \{ command: false, script: false, deeplink: false, stopProcess: false, delete: false, resources: false, tasks: false, network: false \}/);
  });
  test('everything goes through the Rust guard, never a webview fetch', () => {
    const cases = SCHED_TS.slice(SCHED_TS.indexOf("case 'webhook.send':"), SCHED_TS.indexOf("case 'benchmark.run':"));
    assert.doesNotMatch(cases, /\bfetch\(/);
    assert.match(SCHED_TS, /invoke\('sched_webhook', \{ req \}\)/);
    assert.match(NET_RS, /pub fn ip_is_internal\(ip: IpAddr\) -> bool/);
    assert.match(NET_RS, /\.no_proxy\(\)/);
    assert.match(NET_RS, /resolve_to_addrs/);
  });
});
