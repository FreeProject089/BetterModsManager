#!/usr/bin/env node
// Generates frontend/Lang/template.json from frontend/Lang/en.json.
//
// Why: the template is what a translator downloads (Settings › Language › Download template,
// GET /api/language/template, and the `lang-template.json` release asset that
// gen-update-manifest.mjs copies from it). It was maintained by hand and drifted: in 1.0.4 it
// lacked 3 077 keys of en.json, still carried 10 keys en.json had dropped, and 94 values were
// older English wordings. A translator working from it left a fifth of the UI untranslated.
//
// The template IS en.json — same keys, same order, same sections, same `_synonyms`, English
// values — with its own `_info` block (name, flag, suffix, plus the version it matches, the date
// it was generated and how many keys it holds). It is built from en.json's TEXT, swapping only
// the `_info` block, so it is never re-serialised: escapes and layout stay byte-identical to
// en.json and a one-key change in en.json is a one-key change here.
//
//   node scripts/gen-lang-template.mjs          write template.json (only when it changed)
//   node scripts/gen-lang-template.mjs --check  CI gate: exit 1 when template.json is stale
//
// `date` is kept as it is when nothing else changed, so the check does not fail every day; it
// moves to today only when the content does. `keys` counts the translatable strings: every key
// except the meta ones that start with `_` (`_info`, `_synonyms`, `__SECTION_…__`).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EN = path.join(ROOT, 'frontend', 'Lang', 'en.json');
const TEMPLATE = path.join(ROOT, 'frontend', 'Lang', 'template.json');
const PKG = path.join(ROOT, 'package.json');

// The top-level `_info` object of a Lang file, as text: two-space indent, closing brace on its own line.
const INFO_RE = /^( {2})"_info": \{[^{}]*?\n {2}\}/m;

/** Number of translatable keys (meta keys starting with `_` excluded). */
export function countKeys(dict) {
  return Object.keys(dict).filter((k) => !k.startsWith('_')).length;
}

function infoBlock(version, date, keys, nl) {
  return [
    '  "_info": {',
    '    "name": "Template",',
    '    "flag": "⚪",',
    '    "suffix": "_TEMPLATE",',
    `    "version": ${JSON.stringify(version)},`,
    `    "date": ${JSON.stringify(date)},`,
    `    "keys": ${keys}`,
    '  }',
  ].join(nl);
}

/** Build the template text from en.json's text. Pure: everything comes in as arguments. */
export function buildTemplate(enText, { version, date }) {
  const en = JSON.parse(enText);
  if (!INFO_RE.test(enText)) throw new Error('en.json: no top-level "_info" block found');
  const nl = enText.includes('\r\n') ? '\r\n' : '\n';
  return enText.replace(INFO_RE, infoBlock(version, date, countKeys(en), nl));
}

/** Compare a template against en.json, for messages. Returns { missing, extra, changed }. */
export function diffAgainstEn(en, tpl) {
  const missing = Object.keys(en).filter((k) => !(k in tpl));
  const extra = Object.keys(tpl).filter((k) => !(k in en));
  const changed = Object.keys(en).filter((k) => k !== '_info' && k in tpl
    && JSON.stringify(en[k]) !== JSON.stringify(tpl[k]));
  return { missing, extra, changed };
}

const today = () => new Date().toISOString().slice(0, 10);

/** State of template.json on disk: { fresh, expected (with the current date kept), current, … }. */
export function templateState() {
  const enText = readFileSync(EN, 'utf8');
  const version = JSON.parse(readFileSync(PKG, 'utf8')).version;
  const current = existsSync(TEMPLATE) ? readFileSync(TEMPLATE, 'utf8') : '';
  let keptDate = today();
  try {
    const d = JSON.parse(current)?._info?.date;
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) keptDate = d;
  } catch { /* unreadable template: rebuilt below */ }
  const expected = buildTemplate(enText, { version, date: keptDate });
  return { fresh: current === expected, expected, current, enText, version };
}

function main() {
  const check = process.argv.includes('--check');
  const st = templateState();
  if (check) {
    if (st.fresh) {
      console.log(`✓ template.json matches en.json (${countKeys(JSON.parse(st.enText))} keys, v${st.version})`);
      return;
    }
    console.error('✗ frontend/Lang/template.json is out of date with en.json.');
    try {
      const d = diffAgainstEn(JSON.parse(st.enText), JSON.parse(st.current));
      if (d.missing.length) console.error(`  ${d.missing.length} key(s) missing: ${d.missing.slice(0, 10).join(', ')}${d.missing.length > 10 ? ', …' : ''}`);
      if (d.extra.length) console.error(`  ${d.extra.length} key(s) no longer in en.json: ${d.extra.slice(0, 10).join(', ')}${d.extra.length > 10 ? ', …' : ''}`);
      if (d.changed.length) console.error(`  ${d.changed.length} value(s) differ from en.json: ${d.changed.slice(0, 10).join(', ')}${d.changed.length > 10 ? ', …' : ''}`);
      if (!d.missing.length && !d.extra.length && !d.changed.length) console.error('  keys and values match: the _info block, the order or the layout differs.');
    } catch {
      console.error('  template.json is not valid JSON.');
    }
    console.error('  It is generated, never edited by hand: run `node scripts/gen-lang-template.mjs` and commit it.');
    process.exit(1);
  }
  if (st.fresh) {
    console.log('✓ template.json already up to date');
    return;
  }
  const enText = st.enText;
  const out = buildTemplate(enText, { version: st.version, date: today() });
  writeFileSync(TEMPLATE, out, 'utf8');
  console.log(`✓ wrote frontend/Lang/template.json (${countKeys(JSON.parse(enText))} keys, v${st.version}, ${today()})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
