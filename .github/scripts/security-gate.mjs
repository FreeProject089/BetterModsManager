#!/usr/bin/env node
// The security gate: ONE decision rule for every scanner in .github/workflows/security.yml and
// .github/workflows/dast.yml.
//
//   node .github/scripts/security-gate.mjs --tool <gitleaks|semgrep|trivy|zap|nuclei> \
//        --report <file> [--report <file> ...] [--summary <file.md>] [--label <text>] \
//        [--zap-rules .github/security/zap-rules.tsv] [--json <verdict.json>]
//
//   node .github/scripts/security-gate.mjs --markdown --results <verdict.json> [--results …] \
//        [--marker <repo>-security-gate] [--run-url <url of the run>]
//
// --json writes the verdict of a normal run (tool, label, threshold, counts, blocking, pass) for
// the pull-request comment. It is written only when the gate DECIDED (exit 0 or 1), never on 2.
// --markdown renders every verdict given as ONE table, for the sticky PR comment: the hidden
// marker `<!-- <marker> -->` on the first line (so a later run finds and edits the same comment),
// FAILED / INCOMPLETE / PASSED, a row per tool, the run link last. A --results file that does not
// exist is a row saying "no result" and makes the whole comment INCOMPLETE — a scan that did not
// run is never shown as a pass. It exits 0 once rendered (the scan jobs are what fail the build)
// and 2 on a verdict it cannot read.
//
// Each scanner writes its own report (JSON, or JSONL for nuclei) and exits 0 whatever it found;
// this script reads the report, puts every finding on one scale, prints a table and decides.
// The scanners' own exit codes are NOT the gate, because each has its own idea of what fails
// (ZAP fails on WARN, Trivy on --exit-code, Semgrep on --error) and the point is one policy.
//
// The scale: critical > high > medium > low > info.
//   semgrep  ERROR→high  WARNING→medium  INFO→low  (and CRITICAL/HIGH/MEDIUM/LOW as written)
//   trivy    CRITICAL/HIGH/MEDIUM/LOW as written; UNKNOWN (not yet rated)→high, fail closed
//   zap      riskcode 3→high  2→medium  1→low  0→info; confidence 0 (marked false positive)→dropped
//   nuclei   critical/high/medium/low/info as written; unknown→high, fail closed
//   gitleaks every finding is a secret and blocks: there is no "low" leaked credential
//
// The threshold (the LOWEST severity that fails the build):
//   SECURITY_GATE_SEVERITY_<TOOL>  if set and not empty, else
//   SECURITY_GATE_SEVERITY         if set and not empty, else
//   high
// Accepted values: critical, high, medium, low. Anything else is refused (exit 2) rather than
// guessed: a typo in a repository variable must not quietly become "nothing blocks".
// INFO never blocks under any threshold. LOW blocks only if somebody sets the threshold to
// `low` on purpose; the default and `medium` never block on it. SECURITY_GATE_SEVERITY_GITLEAKS
// is ignored (and said to be): gitleaks is binary.
//
// Exit codes: 0 = nothing at or above the threshold, 1 = at least one finding blocks,
// 2 = the gate could not decide (missing, unreadable or implausible report, bad threshold).
// A report that does not look like its tool's output FAILS with 2. An audit that could not run
// is not an audit that found nothing — the same rule as dep-audit.mjs.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
export const SEVERITIES = Object.freeze({
  scale: ['critical', 'high', 'medium', 'low', 'info'],
  thresholds: ['critical', 'high', 'medium', 'low'],
});
export const TOOLS = ['gitleaks', 'semgrep', 'trivy', 'zap', 'nuclei'];

class GateError extends Error {}

/** Which threshold applies to `tool`, and where it came from. Throws on a value it cannot use. */
export function resolveThreshold(tool, env = process.env) {
  const perTool = `SECURITY_GATE_SEVERITY_${tool.toUpperCase()}`;
  for (const name of [perTool, 'SECURITY_GATE_SEVERITY']) {
    const raw = env[name];
    if (raw === undefined || String(raw).trim() === '') continue;
    const value = String(raw).trim().toLowerCase();
    if (!SEVERITIES.thresholds.includes(value)) {
      throw new GateError(`${name}=${JSON.stringify(raw)} is not one of ${SEVERITIES.thresholds.join(', ')}`);
    }
    return { value, source: name };
  }
  return { value: 'high', source: 'default' };
}

const SEMGREP_SEV = { ERROR: 'high', WARNING: 'medium', INFO: 'low', CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', EXPERIMENT: 'info', INVENTORY: 'info' };
const TRIVY_SEV = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', UNKNOWN: 'high' };
const ZAP_SEV = { 3: 'high', 2: 'medium', 1: 'low', 0: 'info' };
const NUCLEI_SEV = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'info', unknown: 'high' };

/** A severity label the table cannot place is treated as HIGH and flagged, never dropped. */
function mapSev(table, raw, notes) {
  const key = raw == null ? '' : String(raw);
  const hit = table[key] ?? table[key.toUpperCase()] ?? table[key.toLowerCase()];
  if (hit) return hit;
  notes.push(`unrecognised severity ${JSON.stringify(raw)} treated as high`);
  return 'high';
}

/**
 * The ZAP rules file (.github/security/zap-rules.tsv), the same format zap-baseline.py reads
 * with -c: `<plugin id>\t<IGNORE|WARN|FAIL|INFO>\t<reason>`. Only IGNORE changes what the gate
 * counts; an IGNORE with no reason is refused, so every exclusion says why it exists.
 */
export function parseZapRules(text) {
  const ignore = new Map();
  for (const [i, line] of String(text).split(/\r?\n/).entries()) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const [id, action, ...rest] = line.split('\t');
    if (!/^\d+$/.test((id || '').trim())) throw new GateError(`zap rules line ${i + 1}: "${id}" is not a plugin id`);
    const act = (action || '').trim().toUpperCase();
    if (!['IGNORE', 'WARN', 'FAIL', 'INFO', 'OUTOFSCOPE'].includes(act)) throw new GateError(`zap rules line ${i + 1}: unknown action "${action}"`);
    const reason = rest.join('\t').trim().replace(/^\(|\)$/g, '').trim();
    if (act === 'IGNORE') {
      if (!reason) throw new GateError(`zap rules line ${i + 1}: IGNORE ${id} has no reason — write why it is not a finding`);
      ignore.set(id.trim(), reason);
    }
  }
  return { ignore };
}

function parseJson(text, tool) {
  try { return typeof text === 'string' ? JSON.parse(text) : text; } catch (e) {
    throw new GateError(`${tool}: the report is not valid JSON (${e.message})`);
  }
}

/**
 * One tool's report → { findings: [{ severity, id, location, title }], ignored: [], notes: [] }.
 * `input` is the report's text (or an already parsed object, for the tests).
 */
export function normalise(tool, input, { zapRules } = {}) {
  const notes = [];
  const ignored = [];
  const findings = [];
  switch (tool) {
    case 'gitleaks': {
      const j = parseJson(input, tool);
      if (!Array.isArray(j)) throw new GateError('gitleaks: expected a JSON array of findings (--report-format json)');
      for (const f of j) {
        findings.push({ severity: 'critical', id: f.RuleID, location: `${f.File}:${f.StartLine}${f.Commit ? ` @${String(f.Commit).slice(0, 8)}` : ''}`, title: `${f.Description || 'secret'} (fingerprint ${f.Fingerprint || '?'})`, binary: true });
      }
      break;
    }
    case 'semgrep': {
      const j = parseJson(input, tool);
      if (!j || !Array.isArray(j.results) || !j.paths) throw new GateError('semgrep: expected {results, paths} (semgrep --json)');
      const scanned = Array.isArray(j.paths.scanned) ? j.paths.scanned.length : 0;
      if (!scanned) throw new GateError('semgrep: the report scanned no file — the scan tested nothing');
      notes.push(`${scanned} file(s) scanned`);
      if (Array.isArray(j.errors) && j.errors.length) notes.push(`${j.errors.length} semgrep error(s) (parse errors / timeouts: those files were partly scanned)`);
      for (const r of j.results) {
        findings.push({ severity: mapSev(SEMGREP_SEV, r.extra?.severity, notes), id: String(r.check_id || '').replace(/^.*?rules\./, ''), location: `${r.path}:${r.start?.line ?? '?'}`, title: String(r.extra?.message || '').split('\n')[0].slice(0, 160) });
      }
      break;
    }
    case 'trivy': {
      const j = parseJson(input, tool);
      if (!j || j.SchemaVersion === undefined || !j.ArtifactName) throw new GateError('trivy: expected {SchemaVersion, ArtifactName, Results} (trivy --format json)');
      const seen = new Set();
      for (const r of j.Results || []) {
        for (const v of r.Vulnerabilities || []) {
          const key = `${r.Target}|${v.VulnerabilityID}|${v.PkgName}|${v.InstalledVersion}`;
          if (seen.has(key)) continue;
          seen.add(key);
          findings.push({ severity: mapSev(TRIVY_SEV, v.Severity, notes), id: v.VulnerabilityID, location: `${r.Target} ${v.PkgName}@${v.InstalledVersion}${v.FixedVersion ? ` (fixed ${v.FixedVersion})` : ' (no fix)'}`, title: String(v.Title || '').slice(0, 160) });
        }
        for (const m of r.Misconfigurations || []) {
          if (m.Status && m.Status !== 'FAIL') continue;
          findings.push({ severity: mapSev(TRIVY_SEV, m.Severity, notes), id: m.ID || m.AVDID, location: `${r.Target}${m.CauseMetadata?.StartLine ? `:${m.CauseMetadata.StartLine}` : ''}`, title: String(m.Title || '').slice(0, 160) });
        }
        for (const s of r.Secrets || []) {
          findings.push({ severity: mapSev(TRIVY_SEV, s.Severity, notes), id: s.RuleID, location: `${r.Target}:${s.StartLine ?? '?'}`, title: String(s.Title || 'secret').slice(0, 160) });
        }
        // What .github/security/trivyignore.yaml suppressed (trivy --show-suppressed). Printed so
        // an exclusion stays visible in every run instead of silently shrinking the report.
        for (const m of [...(r.ExperimentalModifiedFindings || []), ...(r.ModifiedFindings || [])]) {
          const f = m.Finding || {};
          ignored.push({
            severity: mapSev(TRIVY_SEV, f.Severity, notes),
            id: f.VulnerabilityID || f.ID || f.AVDID || f.RuleID || m.Type,
            location: `${r.Target}${f.PkgName ? ` ${f.PkgName}@${f.InstalledVersion}` : ''}`,
            title: String(f.Title || '').slice(0, 160),
            reason: `${m.Status || 'ignored'} by ${m.Source || 'an ignore file'}: ${m.Statement || '(no statement)'}`,
          });
        }
      }
      notes.push(`${(j.Results || []).length} target(s) in ${j.ArtifactName}`);
      break;
    }
    case 'zap': {
      const j = parseJson(input, tool);
      if (!j || !Array.isArray(j.site)) throw new GateError('zap: expected {site: [...]} (zap -J report)');
      for (const site of j.site) {
        for (const a of site.alerts || []) {
          if (String(a.confidence) === '0') { notes.push(`alert ${a.pluginid} marked false positive in ZAP, not counted`); continue; }
          const id = String(a.pluginid);
          const f = { severity: mapSev(ZAP_SEV, a.riskcode, notes), id: `${id} ${a.alert || a.name || ''}`.trim(), location: `${site['@name']} (${a.count || (a.instances || []).length} instance(s), e.g. ${a.instances?.[0]?.uri || '?'})`, title: String(a.name || a.alert || '').slice(0, 160) };
          const reason = zapRules?.ignore?.get(id);
          if (reason) ignored.push({ ...f, reason });
          else findings.push(f);
        }
      }
      break;
    }
    case 'nuclei': {
      let items;
      const text = typeof input === 'string' ? input : JSON.stringify(input);
      const t = text.trim();
      if (!t) items = [];
      else if (t.startsWith('[')) items = parseJson(t, tool);
      else {
        items = t.split(/\r?\n/).filter((l) => l.trim()).map((l, i) => {
          try { return JSON.parse(l); } catch { throw new GateError(`nuclei: line ${i + 1} of the export is not JSON`); }
        });
      }
      if (!Array.isArray(items)) throw new GateError('nuclei: expected JSONL (-jsonl-export) or a JSON array (-json-export)');
      for (const r of items) {
        if (!r || typeof r !== 'object' || !r.info) throw new GateError('nuclei: an entry has no "info" block — not a nuclei result');
        findings.push({ severity: mapSev(NUCLEI_SEV, r.info.severity, notes), id: r['template-id'], location: r['matched-at'] || r.host || '?', title: String(r.info.name || '').slice(0, 160) });
      }
      break;
    }
    default:
      throw new GateError(`unknown tool "${tool}" (expected one of ${TOOLS.join(', ')})`);
  }
  return { findings, ignored, notes };
}

/** Split findings into blocking / not, for a threshold. INFO never blocks; gitleaks always does. */
export function evaluate(findings, threshold) {
  const min = RANK[threshold];
  if (min === undefined) throw new GateError(`bad threshold ${threshold}`);
  const blocking = [];
  const passing = [];
  for (const f of findings) {
    const r = RANK[f.severity];
    const blocks = f.binary ? true : (r > RANK.info && r >= min);
    (blocks ? blocking : passing).push({ ...f, blocks });
  }
  return { blocking, passing };
}

function countBySeverity(list) {
  const c = Object.fromEntries(SEVERITIES.scale.map((s) => [s, 0]));
  for (const f of list) c[f.severity] = (c[f.severity] || 0) + 1;
  return c;
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');

function renderText({ label, threshold, source, all, blocking, ignored, notes, cap }) {
  const out = [];
  out.push(`== ${label} — threshold: ${threshold} (${source}); INFO never blocks`);
  for (const n of notes) out.push(`   note: ${n}`);
  const sorted = [...all].sort((a, b) => RANK[b.severity] - RANK[a.severity] || String(a.id).localeCompare(String(b.id)));
  const rows = sorted.slice(0, cap);
  if (rows.length) {
    out.push('   SEVERITY  GATE   ID / LOCATION');
    for (const f of rows) {
      out.push(`   ${f.severity.padEnd(9)} ${f.blocks ? 'BLOCK' : 'pass '}  ${f.id}  ${f.location}${f.title ? `  — ${f.title}` : ''}`);
    }
    if (sorted.length > cap) out.push(`   … ${sorted.length - cap} more (see the report artifact)`);
  }
  for (const f of ignored) out.push(`   ignored   ${f.id}  ${f.location} — ${f.reason}`);
  const c = countBySeverity(all);
  out.push(`   totals: ${SEVERITIES.scale.map((s) => `${s} ${c[s]}`).join(', ')}; ${ignored.length} ignored by a reviewed rule`);
  out.push(blocking.length
    ? `   RESULT: ${blocking.length} finding(s) at or above "${threshold}" — the gate FAILS`
    : `   RESULT: nothing at or above "${threshold}" — the gate passes`);
  return out.join('\n');
}

function renderMarkdown({ label, threshold, source, all, blocking, ignored, notes, cap }) {
  const c = countBySeverity(all);
  const md = [];
  md.push(`### ${label}`);
  md.push('');
  md.push(`Threshold **${threshold}** (${source}) — ${blocking.length} blocking, ${all.length - blocking.length} below the threshold, ${ignored.length} ignored by a reviewed rule.`);
  md.push('');
  md.push('| severity | count |');
  md.push('|---|---|');
  for (const s of SEVERITIES.scale) md.push(`| ${s} | ${c[s]} |`);
  md.push('');
  const sorted = [...all].sort((a, b) => RANK[b.severity] - RANK[a.severity]);
  if (sorted.length) {
    md.push('| gate | severity | id | location |');
    md.push('|---|---|---|---|');
    for (const f of sorted.slice(0, cap)) md.push(`| ${f.blocks ? '**BLOCK**' : 'pass'} | ${f.severity} | ${cell(f.id)} | ${cell(f.location)} |`);
    if (sorted.length > cap) md.push(`| … | | ${sorted.length - cap} more | see the report artifact |`);
    md.push('');
  }
  for (const n of notes) md.push(`- ${cell(n)}`);
  md.push('');
  return md.join('\n');
}

// ── verdicts (--json) and the pull-request comment (--markdown) ───────────────
const VERDICT_SCHEMA = 'security-gate-result/1';

/** A verdict file, or { missing: path } when it does not exist. Anything else unreadable → exit 2. */
function readVerdict(path) {
  if (!existsSync(path)) return { missing: path };
  let v;
  try { v = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    throw new GateError(`verdict ${path} is not valid JSON (${e.message})`);
  }
  const ok = v && v.schema === VERDICT_SCHEMA && TOOLS.includes(v.tool) && v.counts
    && SEVERITIES.scale.every((s) => Number.isInteger(v.counts[s]))
    && Number.isInteger(v.blocking) && typeof v.pass === 'boolean';
  if (!ok) throw new GateError(`${path} is not a security-gate verdict (${VERDICT_SCHEMA}, written by --json)`);
  return v;
}

/** The sticky PR comment: marker, overall verdict, one row per tool, the run link last. */
function renderComment(verdicts, { marker, runUrl }) {
  if (marker !== undefined && !/^[A-Za-z0-9._-]+$/.test(marker)) {
    throw new GateError(`--marker "${marker}" must be letters, digits, dot, dash or underscore (it goes inside an HTML comment)`);
  }
  const failed = verdicts.some((v) => !v.missing && !v.pass);
  const incomplete = verdicts.some((v) => v.missing);
  const status = failed ? 'FAILED' : incomplete ? 'INCOMPLETE' : 'PASSED';
  const md = [];
  if (marker) md.push(`<!-- ${marker} -->`);
  md.push(`### Security gate: ${status}`);
  md.push('');
  md.push(failed
    ? 'At least one scan has findings at or above its threshold; that job fails the run.'
    : incomplete
      ? 'At least one scan produced no verdict (its scan or its gate did not run): nothing is known about it, so this is not a pass.'
      : 'No scan has a finding at or above its threshold.');
  md.push('');
  md.push('| tool | fails at | critical | high | medium | low | info | blocking | result |');
  md.push('|---|---|---:|---:|---:|---:|---:|---:|---|');
  for (const v of verdicts) {
    if (v.missing) { md.push(`| ${cell(v.missing)} | no result | | | | | | | **NO RESULT** |`); continue; }
    const at = v.binary ? 'any secret' : `${v.threshold} and above`;
    md.push(`| ${cell(v.label || v.tool)} | ${at} | ${SEVERITIES.scale.map((s) => v.counts[s]).join(' | ')} | **${v.blocking}** | ${v.pass ? 'pass' : '**FAIL**'} |`);
  }
  md.push('');
  md.push('INFO never blocks; LOW only if the threshold is set to `low`. Thresholds: repository variables `SECURITY_GATE_SEVERITY` / `SECURITY_GATE_SEVERITY_<TOOL>`. Reviewed exclusions live in the config of each tool, with their reason.');
  if (runUrl) {
    md.push('');
    md.push(`Details, reports and SARIF: [the run and its artifacts](${runUrl})`);
  }
  return md.join('\n');
}

function parseArgs(argv) {
  const a = { reports: [], cap: 200 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--tool') { a.tool = v; i++; }
    else if (k === '--report') { a.reports.push(v); i++; }
    else if (k === '--summary') { a.summary = v; i++; }
    else if (k === '--label') { a.label = v; i++; }
    else if (k === '--zap-rules') { a.zapRules = v; i++; }
    else if (k === '--max-rows') { a.cap = Number(v) || 200; i++; }
    else if (k === '--json') { a.json = v; i++; }
    else if (k === '--markdown') { a.markdown = true; }
    else if (k === '--results') { (a.results ||= []).push(v); i++; }
    else if (k === '--marker') { a.marker = v; i++; }
    else if (k === '--run-url') { a.runUrl = v; i++; }
    else throw new GateError(`unknown argument ${k}`);
  }
  if (a.markdown) {
    if (!a.results?.length) throw new GateError('--markdown needs at least one --results <verdict.json>');
    if (a.tool || a.reports.length) throw new GateError('--markdown renders verdicts; it takes --results, not --tool/--report');
    return a;
  }
  if (a.results) throw new GateError('--results is only for --markdown');
  if (!a.tool) throw new GateError('--tool is required');
  if (!a.reports.length) throw new GateError('at least one --report is required');
  return a;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  let args;
  try {
    args = parseArgs(argv);
    if (args.markdown) {
      console.log(renderComment(args.results.map(readVerdict), args));
      return 0;
    }
    if (!TOOLS.includes(args.tool)) throw new GateError(`unknown tool "${args.tool}" (expected one of ${TOOLS.join(', ')})`);
    const { value: threshold, source } = resolveThreshold(args.tool, env);
    const zapRules = args.zapRules ? parseZapRules(readFileSync(args.zapRules, 'utf8')) : undefined;
    const all = [];
    const ignored = [];
    const notes = [];
    if (args.tool === 'gitleaks' && env.SECURITY_GATE_SEVERITY_GITLEAKS) notes.push('SECURITY_GATE_SEVERITY_GITLEAKS is ignored: any unallowlisted secret fails');
    for (const file of args.reports) {
      if (!existsSync(file)) throw new GateError(`${args.tool}: report ${file} does not exist — the scan did not run or wrote elsewhere`);
      const r = normalise(args.tool, readFileSync(file, 'utf8'), { zapRules });
      all.push(...r.findings);
      ignored.push(...r.ignored);
      for (const n of r.notes) notes.push(args.reports.length > 1 ? `${file}: ${n}` : n);
    }
    const { blocking, passing } = evaluate(all, threshold);
    const decided = [...blocking, ...passing];
    const view = { label: args.label || args.tool, threshold, source, all: decided, blocking, ignored, notes, cap: args.cap };
    console.log(renderText(view));
    for (const f of blocking) {
      // One annotation per blocking finding, capped: the job page shows them without opening the log.
      if (blocking.indexOf(f) >= 50) break;
      console.log(`::error title=${args.tool} ${f.severity}::${cell(f.id)} ${cell(f.location)}`);
    }
    const md = renderMarkdown(view);
    if (args.summary) writeFileSync(args.summary, md);
    if (args.json) {
      const verdict = {
        schema: VERDICT_SCHEMA, tool: args.tool, label: view.label, threshold, source,
        binary: args.tool === 'gitleaks', counts: countBySeverity(decided), total: decided.length,
        blocking: blocking.length, ignored: ignored.length, pass: blocking.length === 0, reports: args.reports,
      };
      writeFileSync(args.json, JSON.stringify(verdict, null, 2) + '\n');
    }
    if (env.GITHUB_STEP_SUMMARY) { try { appendFileSync(env.GITHUB_STEP_SUMMARY, md + '\n'); } catch { /* the log already has it */ } }
    return blocking.length ? 1 : 0;
  } catch (e) {
    if (e instanceof GateError) {
      console.log(`::error title=security gate::${e.message}`);
      console.log('The gate could not decide, so it fails. Fix the scan or the setting; do not remove the step.');
      return 2;
    }
    throw e;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(main());
