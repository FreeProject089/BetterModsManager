// Tests for .github/scripts/security-gate.mjs, the one gate every security scan in
// .github/workflows/security.yml and dast.yml goes through.
//
//   node --test .github/scripts/security-gate.test.mjs
//
// The gate decides whether a build fails, so the thing to prove is not "it runs" but the
// three ways a gate lies:
//   · it lets through a finding at or above the threshold (a scan that finds a HIGH and
//     reports green);
//   · it blocks on something the policy says never blocks (LOW / INFO), which teaches people
//     to switch the gate off;
//   · it reads a report that is missing, truncated or empty-because-nothing-ran and calls
//     that "no findings". An audit that could not run is not an audit that found nothing.
//
// Every report below is built in the test. No fixture carries a secret-shaped value: the
// gitleaks entries use the redacted form gitleaks itself writes with --redact.
//
// Plain top-level test() calls on purpose: a describe() body that throws is reported as a
// pass by node --test and counts nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { resolveThreshold, normalise, evaluate, parseZapRules, SEVERITIES } from './security-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, 'security-gate.mjs');

// ── report builders ─────────────────────────────────────────────────────────
const semgrepReport = (sevs, scanned = ['a.js']) => ({
  results: sevs.map((s, i) => ({
    check_id: `rules.demo.rule-${i}`, path: `src/f${i}.js`, start: { line: i + 1 }, end: { line: i + 1 },
    extra: { severity: s, message: `demo finding ${i}`, lines: 'requires login' },
  })),
  errors: [],
  paths: { scanned },
});

const trivyReport = ({ vulns = [], misconf = [], secrets = [] } = {}) => ({
  SchemaVersion: 2,
  ArtifactName: 'demo',
  ArtifactType: 'filesystem',
  Results: [
    { Target: 'package-lock.json', Class: 'lang-pkgs', Type: 'npm',
      Vulnerabilities: vulns.map((s, i) => ({ VulnerabilityID: `CVE-2026-000${i}`, PkgName: `pkg${i}`, InstalledVersion: '1.0.0', FixedVersion: '1.0.1', Severity: s, Title: `vuln ${i}` })) },
    { Target: 'Dockerfile', Class: 'config', Type: 'dockerfile',
      Misconfigurations: misconf.map(([s, status], i) => ({ ID: `DS-00${i}`, Title: `misconf ${i}`, Severity: s, Status: status })) },
    { Target: 'app.env', Class: 'secret',
      Secrets: secrets.map((s, i) => ({ RuleID: `rule-${i}`, Title: `secret ${i}`, Severity: s, StartLine: i + 1 })) },
  ],
});

const zapReport = (alerts) => ({
  '@version': '2.17.0',
  site: [{ '@name': 'http://localhost:8080', alerts: alerts.map(([pluginid, riskcode, confidence = '2']) => ({
    pluginid: String(pluginid), alertRef: String(pluginid), alert: `alert ${pluginid}`, name: `alert ${pluginid}`,
    riskcode: String(riskcode), confidence: String(confidence), riskdesc: 'x', instances: [{ uri: 'http://localhost:8080/', method: 'GET' }], count: '1',
  })) }],
});

const nucleiLines = (sevs) => sevs.map((s, i) => JSON.stringify({
  'template-id': `demo-${i}`, info: { name: `nuclei ${i}`, severity: s }, 'matched-at': `http://localhost:8080/p${i}`, host: 'http://localhost:8080',
})).join('\n');

const gitleaksReport = (n) => Array.from({ length: n }, (_, i) => ({
  RuleID: 'generic-api-key', Description: 'demo', File: `f${i}.env`, StartLine: i + 1, Commit: 'abc123', Secret: 'REDACTED', Match: 'KEY=REDACTED', Fingerprint: `abc123:f${i}.env:generic-api-key:${i + 1}`,
}));

// ── thresholds ──────────────────────────────────────────────────────────────
test('the default threshold is high', () => {
  assert.equal(resolveThreshold('semgrep', {}).value, 'high');
  assert.equal(resolveThreshold('semgrep', { SECURITY_GATE_SEVERITY: '' }).value, 'high');
});

test('the per-tool variable wins over the global one, in any case', () => {
  const env = { SECURITY_GATE_SEVERITY: 'critical', SECURITY_GATE_SEVERITY_ZAP: 'Medium' };
  assert.equal(resolveThreshold('zap', env).value, 'medium');
  assert.equal(resolveThreshold('zap', env).source, 'SECURITY_GATE_SEVERITY_ZAP');
  assert.equal(resolveThreshold('semgrep', env).value, 'critical');
});

test('a threshold that is not one of the four values is refused, not guessed', () => {
  for (const bad of ['hgih', 'none', 'off', '0', 'info']) {
    assert.throws(() => resolveThreshold('trivy', { SECURITY_GATE_SEVERITY: bad }), /SECURITY_GATE_SEVERITY/);
  }
});

test('the four documented values are exactly the accepted ones', () => {
  assert.deepEqual(SEVERITIES.thresholds, ['critical', 'high', 'medium', 'low']);
});

// ── the policy, per severity ────────────────────────────────────────────────
test('semgrep: ERROR blocks at the default, WARNING only at medium, INFO never', () => {
  const f = normalise('semgrep', semgrepReport(['ERROR', 'WARNING', 'INFO']));
  assert.equal(f.findings.length, 3);
  assert.deepEqual(f.findings.map((x) => x.severity), ['high', 'medium', 'low']);
  assert.equal(evaluate(f.findings, 'high').blocking.length, 1);
  assert.equal(evaluate(f.findings, 'medium').blocking.length, 2);
  assert.equal(evaluate(f.findings, 'critical').blocking.length, 0);
});

test('INFO never blocks, even at the lowest threshold', () => {
  const f = normalise('nuclei', nucleiLines(['info', 'info']));
  assert.equal(evaluate(f.findings, 'low').blocking.length, 0);
});

test('LOW does not block at the default threshold or at medium', () => {
  const f = normalise('trivy', trivyReport({ vulns: ['LOW', 'LOW'] }));
  assert.equal(evaluate(f.findings, 'high').blocking.length, 0);
  assert.equal(evaluate(f.findings, 'medium').blocking.length, 0);
});

test('trivy: CRITICAL and HIGH block by default, MEDIUM does not', () => {
  const f = normalise('trivy', trivyReport({ vulns: ['CRITICAL', 'HIGH', 'MEDIUM'] }));
  assert.equal(evaluate(f.findings, 'high').blocking.length, 2);
  assert.equal(evaluate(f.findings, 'medium').blocking.length, 3);
});

test('trivy: an UNKNOWN (not yet rated) severity is treated as high, not waved through', () => {
  const f = normalise('trivy', trivyReport({ vulns: ['UNKNOWN'] }));
  assert.equal(f.findings[0].severity, 'high');
  assert.equal(evaluate(f.findings, 'high').blocking.length, 1);
});

test('trivy: misconfigurations count only when they FAIL; secrets count too', () => {
  const f = normalise('trivy', trivyReport({ misconf: [['HIGH', 'FAIL'], ['CRITICAL', 'PASS']], secrets: ['CRITICAL'] }));
  assert.equal(f.findings.length, 2);
  assert.equal(evaluate(f.findings, 'high').blocking.length, 2);
});

test('trivy: a finding suppressed by the reviewed ignore file is shown as ignored, with its statement', () => {
  const report = trivyReport({ vulns: ['LOW'] });
  report.Results[0].ExperimentalModifiedFindings = [{
    Type: 'vulnerability', Status: 'ignored', Statement: 'mirrors audit-ignore.json', Source: '.github/security/trivyignore.yaml',
    Finding: { VulnerabilityID: 'CVE-2026-85061', PkgName: 'maplibre-gl', InstalledVersion: '5.24.0', Severity: 'CRITICAL' },
  }];
  const f = normalise('trivy', report);
  assert.equal(f.findings.length, 1);
  assert.equal(f.ignored.length, 1);
  assert.equal(f.ignored[0].severity, 'critical');
  assert.match(f.ignored[0].reason, /audit-ignore/);
});

test('zap: riskcode 3 blocks, 2 only at medium, 1 and 0 never at the default', () => {
  const f = normalise('zap', zapReport([[40012, 3], [10038, 2], [10021, 1], [10027, 0]]));
  assert.deepEqual(f.findings.map((x) => x.severity), ['high', 'medium', 'low', 'info']);
  assert.equal(evaluate(f.findings, 'high').blocking.length, 1);
  assert.equal(evaluate(f.findings, 'medium').blocking.length, 2);
});

test('zap: an alert a person marked false positive (confidence 0) is not counted', () => {
  const f = normalise('zap', zapReport([[40012, 3, '0']]));
  assert.equal(f.findings.length, 0);
});

test('zap: an IGNORE rule with a reason removes the alert, and says so', () => {
  const rules = parseZapRules('# comment\n10038\tIGNORE\t(CSP is set at the edge by Caddy; reviewed)\n');
  const f = normalise('zap', zapReport([[10038, 2], [40012, 3]]), { zapRules: rules });
  assert.equal(f.findings.length, 1);
  assert.equal(f.ignored.length, 1);
  assert.match(f.ignored[0].reason, /Caddy/);
});

test('zap: an IGNORE rule with no reason is refused', () => {
  assert.throws(() => parseZapRules('10038\tIGNORE\n'), /reason/);
  assert.throws(() => parseZapRules('10038\tIGNORE\t()\n'), /reason/);
});

test('nuclei: JSONL and a JSON array read the same; an empty export is zero findings', () => {
  const lines = nucleiLines(['high', 'medium']);
  const arr = JSON.stringify(lines.split('\n').map((l) => JSON.parse(l)));
  assert.equal(normalise('nuclei', lines).findings.length, 2);
  assert.equal(normalise('nuclei', arr).findings.length, 2);
  assert.equal(normalise('nuclei', '').findings.length, 0);
});

test('gitleaks is binary: any unallowlisted secret blocks, whatever the threshold', () => {
  const f = normalise('gitleaks', gitleaksReport(1));
  assert.equal(evaluate(f.findings, 'critical').blocking.length, 1);
  assert.equal(evaluate(normalise('gitleaks', gitleaksReport(0)).findings, 'critical').blocking.length, 0);
});

// ── reports that cannot be trusted ──────────────────────────────────────────
test('a semgrep report that scanned no file is an error, not a pass', () => {
  assert.throws(() => normalise('semgrep', semgrepReport([], [])), /scanned no file/);
});

test('a report without the tool shape is an error, not a pass', () => {
  assert.throws(() => normalise('semgrep', { hello: 1 }), /semgrep/);
  assert.throws(() => normalise('trivy', { Results: [] }), /trivy/);
  assert.throws(() => normalise('zap', { nothing: [] }), /zap/);
  assert.throws(() => normalise('gitleaks', { not: 'an array' }), /gitleaks/);
  assert.throws(() => normalise('nuclei', '{"broken json'), /nuclei/);
});

test('an unknown tool name is refused', () => {
  assert.throws(() => normalise('grype', {}), /unknown tool/);
});

// ── the command line, end to end ────────────────────────────────────────────
function run(args, env = {}) {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('CLI: exit 1 on a blocking finding, 0 below the threshold, 2 on a missing report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'security-gate-test-'));
  try {
    const high = join(dir, 'semgrep.json');
    writeFileSync(high, JSON.stringify(semgrepReport(['ERROR', 'WARNING'])));
    const blocked = run(['--tool', 'semgrep', '--report', high]);
    assert.equal(blocked.code, 1, blocked.out);
    assert.match(blocked.out, /BLOCK/);
    assert.match(blocked.out, /threshold: high/);

    const passes = run(['--tool', 'semgrep', '--report', high], { SECURITY_GATE_SEVERITY_SEMGREP: 'critical' });
    assert.equal(passes.code, 0, passes.out);

    const missing = run(['--tool', 'semgrep', '--report', join(dir, 'nope.json')]);
    assert.equal(missing.code, 2, missing.out);

    const badThreshold = run(['--tool', 'semgrep', '--report', high], { SECURITY_GATE_SEVERITY: 'hihg' });
    assert.equal(badThreshold.code, 2, badThreshold.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: several reports of one tool are gated together, and a summary is written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'security-gate-test-'));
  try {
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    const summary = join(dir, 'summary.md');
    writeFileSync(a, JSON.stringify(trivyReport({ vulns: ['LOW'] })));
    writeFileSync(b, JSON.stringify(trivyReport({ vulns: ['CRITICAL'] })));
    const r = run(['--tool', 'trivy', '--report', a, '--report', b, '--summary', summary]);
    assert.equal(r.code, 1, r.out);
    const md = readFileSync(summary, 'utf8');
    assert.match(md, /\| critical \|/);
    assert.match(md, /1 blocking/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── --json verdicts and the --markdown PR comment ──────────────────────────
// Added for the sticky pull-request comment (BMM / BetterInstaller / BMM Docs / BCW share it).
// A scan job writes its verdict with --json; the comment job renders every verdict it finds
// with --markdown. The comment must say FAILED when any tool failed, and must not turn a tool
// that produced no verdict (its scan or its gate did not run) into a quiet pass.

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'security-gate-test-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('--json writes the verdict: counts, threshold, blocking, pass', () => withDir((dir) => {
  const rep = join(dir, 'semgrep.json');
  const out = join(dir, 'semgrep.result.json');
  writeFileSync(rep, JSON.stringify(semgrepReport(['ERROR', 'WARNING', 'INFO'])));
  const r = run(['--tool', 'semgrep', '--report', rep, '--label', 'semgrep (SAST)', '--json', out]);
  assert.equal(r.code, 1, r.out);
  const v = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(v.schema, 'security-gate-result/1');
  assert.equal(v.tool, 'semgrep');
  assert.equal(v.label, 'semgrep (SAST)');
  assert.equal(v.threshold, 'high');
  assert.equal(v.source, 'default');
  assert.deepEqual(v.counts, { critical: 0, high: 1, medium: 1, low: 1, info: 0 });
  assert.equal(v.total, 3);
  assert.equal(v.blocking, 1);
  assert.equal(v.pass, false);
  assert.equal(v.binary, false);
  const ok = run(['--tool', 'semgrep', '--report', rep, '--json', out], { SECURITY_GATE_SEVERITY: 'critical' });
  assert.equal(ok.code, 0, ok.out);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).pass, true);
}));

test('--json marks gitleaks as binary', () => withDir((dir) => {
  const rep = join(dir, 'gitleaks.json');
  const out = join(dir, 'gitleaks.result.json');
  writeFileSync(rep, JSON.stringify(gitleaksReport(1)));
  assert.equal(run(['--tool', 'gitleaks', '--report', rep, '--json', out]).code, 1);
  const v = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(v.binary, true);
  assert.equal(v.blocking, 1);
}));

test('--json is not written when the gate could not decide', () => withDir((dir) => {
  // Positive control: a readable report does write it.
  const okRep = join(dir, 'ok.json');
  const okOut = join(dir, 'ok.result.json');
  writeFileSync(okRep, JSON.stringify(trivyReport({ vulns: ['LOW'] })));
  assert.equal(run(['--tool', 'trivy', '--report', okRep, '--json', okOut]).code, 0);
  assert.equal(JSON.parse(readFileSync(okOut, 'utf8')).tool, 'trivy');
  const out = join(dir, 'x.result.json');
  const r = run(['--tool', 'trivy', '--report', join(dir, 'missing.json'), '--json', out]);
  assert.equal(r.code, 2, r.out);
  assert.throws(() => readFileSync(out, 'utf8'));
}));

test('--markdown: one table, marker first, FAILED when any tool failed, run link last', () => withDir((dir) => {
  const s = join(dir, 's.json'); const t = join(dir, 't.json'); const g = join(dir, 'g.json');
  writeFileSync(join(dir, 'sr.json'), JSON.stringify(semgrepReport(['WARNING'])));
  writeFileSync(join(dir, 'tr.json'), JSON.stringify(trivyReport({ vulns: ['CRITICAL', 'LOW'] })));
  writeFileSync(join(dir, 'gr.json'), JSON.stringify(gitleaksReport(0)));
  assert.equal(run(['--tool', 'semgrep', '--report', join(dir, 'sr.json'), '--label', 'semgrep | SAST', '--json', s]).code, 0);
  assert.equal(run(['--tool', 'trivy', '--report', join(dir, 'tr.json'), '--json', t]).code, 1);
  assert.equal(run(['--tool', 'gitleaks', '--report', join(dir, 'gr.json'), '--json', g]).code, 0);
  const url = 'https://github.com/o/r/actions/runs/42';
  const r = run(['--markdown', '--results', g, '--results', s, '--results', t, '--marker', 'bmm-security-gate', '--run-url', url]);
  assert.equal(r.code, 0, r.out); // the scan jobs fail the build; rendering the comment does not
  const lines = r.out.trimEnd().split('\n');
  assert.equal(lines[0], '<!-- bmm-security-gate -->');
  assert.match(r.out, /FAILED/);
  assert.match(r.out, /\| semgrep \\| SAST \| medium and above|\| semgrep \\| SAST \| high and above/);
  assert.match(r.out, /\| trivy \| high and above \| 1 \| 0 \| 0 \| 1 \| 0 \| \*\*1\*\* \| \*\*FAIL\*\* \|/);
  assert.match(r.out, /\| gitleaks \| any secret \| 0 \| 0 \| 0 \| 0 \| 0 \| \*\*0\*\* \| pass \|/);
  assert.ok(r.out.includes(`(${url})`), 'no link to the run');
  assert.ok(lines[lines.length - 1].includes(url), 'the run link is not the last line');
}));

test('--markdown: all passing says PASSED; a missing verdict says INCOMPLETE, never PASSED', () => withDir((dir) => {
  const s = join(dir, 's.json');
  writeFileSync(join(dir, 'sr.json'), JSON.stringify(semgrepReport([])));
  assert.equal(run(['--tool', 'semgrep', '--report', join(dir, 'sr.json'), '--json', s]).code, 0);
  const pass = run(['--markdown', '--results', s, '--marker', 'x-security-gate']);
  assert.equal(pass.code, 0, pass.out);
  assert.match(pass.out, /PASSED/);
  const inc = run(['--markdown', '--results', s, '--results', join(dir, 'trivy.result.json'), '--marker', 'x-security-gate']);
  assert.equal(inc.code, 0, inc.out);
  assert.match(inc.out, /INCOMPLETE/);
  assert.doesNotMatch(inc.out, /PASSED/);
  assert.match(inc.out, /trivy\.result\.json \| no result/);
}));

test('--markdown refuses what it cannot render honestly', () => withDir((dir) => {
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{ not json');
  assert.equal(run(['--markdown', '--results', bad]).code, 2);
  writeFileSync(bad, JSON.stringify({ tool: 'semgrep' })); // not a verdict
  assert.equal(run(['--markdown', '--results', bad]).code, 2);
  assert.equal(run(['--markdown']).code, 2);
  const s = join(dir, 's.json');
  writeFileSync(join(dir, 'sr.json'), JSON.stringify(semgrepReport([])));
  run(['--tool', 'semgrep', '--report', join(dir, 'sr.json'), '--json', s]);
  // Positive control: the same verdict renders; only the bad marker is refused.
  assert.equal(run(['--markdown', '--results', s, '--marker', 'ok-security-gate']).code, 0);
  assert.equal(run(['--markdown', '--results', s, '--marker', 'a -->b']).code, 2);
}));
