// "Send errors live": the webview half. The rules against the COMPILED module
// (frontend/js/core/live-issues-core.js), the wiring against the sources. Redaction, grouping,
// the offline queue, the consent gate and the send to a fake server are tested in Rust
// (src-tauri/src/commands/live_issues.rs, `cargo test live_issues`).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = await import(pathToFileURL(join(ROOT, 'frontend/js/core/live-issues-core.js')).href);
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('what is reported', () => {
  test('only real errors from a command, never a cancel / offline / validation / quiet one', () => {
    assert.equal(C.shouldReportInvoke('error'), true);
    for (const k of ['cancel', 'network', 'validation', 'quiet']) assert.equal(C.shouldReportInvoke(k), false, k);
  });
  test("the reporter's own commands and telemetry's never report themselves", () => {
    for (const c of ['live_issue_report', 'live_issues_init', 'analytics_flush', 'log_frontend_line', 'replay_spool_append']) assert.ok(C.isIgnoredCommand(c), c);
    assert.equal(C.isIgnoredCommand('deploy_profile'), false);
  });
  test('failed commands are filed under their operation', () => {
    assert.equal(C.componentForCommand('deploy_profile'), 'deploy');
    assert.equal(C.componentForCommand('download_mod'), 'install');
    assert.equal(C.componentForCommand('create_backup'), 'backup');
    assert.equal(C.componentForCommand('sched_run_now'), 'scheduler');
    assert.equal(C.componentForCommand('get_settings'), 'ipc');
  });
  test('error text of anything thrown', () => {
    assert.equal(C.errorText('boom'), 'boom');
    assert.equal(C.errorText(new TypeError('x is undefined')), 'TypeError: x is undefined');
    assert.equal(C.errorText({ message: 'tauri err' }), 'tauri err');
    assert.equal(C.errorText(null), 'unknown error');
  });
});

describe('a burst does not flood the bridge', () => {
  test('the same text at most once per 2 s, at most 20 per 10 s', () => {
    const th = new C.Throttle();
    assert.equal(th.allow('a', 0), true);
    assert.equal(th.allow('a', 1000), false);
    assert.equal(th.allow('a', 2500), true);
    let n = 0;
    for (let i = 0; i < 100; i++) if (th.allow(`k${i}`, 3000)) n++;
    assert.equal(n, 18, 'two slots already used in the window');
    assert.equal(th.allow('late', 13_000), true, 'the window slides');
  });
});

describe('wiring', () => {
  const live = src('frontend/src/core/live-issues.ts');
  const api = src('frontend/src/core/api.ts');
  const analytics = src('frontend/src/core/analytics.ts');
  test('nothing crosses the bridge while the switch is off', () => {
    assert.match(live, /function report\([^)]*\)[^{]*\{\s*if \(!_on\) return;/);
    assert.match(live, /if \(!_on \|\| isIgnoredCommand\(command\) \|\| !shouldReportInvoke\(kind\)\) return;/);
  });
  test('a failed command hands over its name and error, never its arguments', () => {
    assert.match(api, /_onInvokeFailure\(command, err, /);
    assert.doesNotMatch(api, /_onInvokeFailure\([^)]*args/);
    assert.doesNotMatch(live, /args/);
  });
  test('boot, consent change and the privacy card are wired', () => {
    assert.match(analytics, /void initLiveIssues\(_sessionId\)/);
    assert.match(analytics, /set_analytics_consent[^\n]*\n\s*void refreshLiveIssues\(\)/);
    assert.match(analytics, /mountLiveIssuesToggle\(\)/);
    assert.match(analytics, /id="modal-live-toggle"(?![^>]*checked)/, 'the consent dialog does not pre-tick it');
  });
  test('every command this side calls is registered in Rust', () => {
    const main = src('src-tauri/src/main.rs');
    for (const c of ['live_issues_init', 'live_issues_set_enabled', 'live_issues_status', 'live_issue_report']) {
      assert.ok(main.includes(`commands::live_issues::${c}`), c);
    }
  });
});
