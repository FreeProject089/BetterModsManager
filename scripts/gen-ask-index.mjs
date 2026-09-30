// The « Ask Laya » knowledge index — what BMM can answer a question from, offline.
//
// « Ask Laya » (src-tauri/src/commands/ask_core.rs) finds the answer to « c'est quoi le mode
// jeu ? » in BMM's own documentation, never in invented text. The app AND the CLI/MCP binary
// answer it, and the CLI has no webview to read the docs hub from — so the documentation is
// extracted here, once, into one JSON file that both binaries compile in:
//
//   · the bundled BMM Docs pages (frontend/assets/docs/{en,fr}/**/*.md), cut at their headings;
//   · the docs hub articles (frontend/src/docs/docs-hub.ts: CATEGORIES + devArticle(...));
//   · the command palette's commands (frontend/src/core/commands.ts: registerCommand({...})).
//
// Read with the TypeScript parser, not with regexes: the articles are object literals whose
// bodies are string concatenations, and a regex that half-reads one produces an index that
// answers confidently from a truncated paragraph.
//
// `--check` runs in CI: a docs page or an article changed without regenerating fails the build
// instead of shipping an assistant that quotes last month's documentation.
//
// Run:            node scripts/gen-ask-index.mjs
// Verify (CI):    node scripts/gen-ask-index.mjs --check

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src-tauri/src/commands/ask_index.gen.json');
const DOCS = path.join(ROOT, 'frontend/assets/docs');
const HUB = path.join(ROOT, 'frontend/src/docs/docs-hub.ts');
const CMDS = path.join(ROOT, 'frontend/src/core/commands.ts');
const CAP = 700;

function bail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

const clean = (s) => String(s)
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[*_`>|#]+/g, ' ')
  .replace(/^\s*:::.*$/gm, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const cap = (s, n = CAP) => (s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, '')} …`);

// ── BMM Docs pages ───────────────────────────────────────────────────────────────────────────
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out.sort();
}
// md-lite's slugForAnchor (mkdocs'), so « Open » lands on the heading. Kept identical.
const slug = (h) => h.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');

function pages(lang) {
  const base = path.join(DOCS, lang);
  if (!fs.existsSync(base)) bail(`${base} is missing — refusing to write an index without the docs`);
  const out = [];
  for (const file of walk(base)) {
    const rel = path.relative(base, file).replace(/\\/g, '/').replace(/\.md$/, '');
    const page = rel.endsWith('/index') ? rel.slice(0, -6) || 'index' : rel;
    const md = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, ' ');
    let title = '';
    let cur = { h: '', lines: [] };
    const sections = [];
    for (const line of md.split(/\r?\n/)) {
      const m = /^(#{1,3})\s+(.*)$/.exec(line);
      if (m) {
        if (m[1] === '#' && !title) { title = clean(m[2]); continue; }
        sections.push(cur);
        cur = { h: clean(m[2]), lines: [] };
      } else cur.lines.push(line);
    }
    sections.push(cur);
    for (const s of sections) {
      const text = clean(s.lines.join('\n'));
      if (text.length < 40) continue;
      out.push({
        k: 'doc', lang, id: `doc:${page}${s.h ? `#${slug(s.h)}` : ''}`,
        t: s.h ? `${title} › ${s.h}` : title,
        x: cap(text),
        a: { page, anchor: s.h ? slug(s.h) : '' },
      });
    }
  }
  return out;
}

// ── Evaluating the literals the TS files hold ────────────────────────────────────────────────
function str(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return str(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = str(node.left), b = str(node.right);
    return a == null || b == null ? null : a + b;
  }
  // `…${BMMS_REFERENCE}…` and the like: keep the literal parts.
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => s.literal.text).join(' ');
  return null;
}
function prop(obj, name) {
  const p = obj.properties.find((x) => ts.isPropertyAssignment(x) && (x.name.text === name || x.name.escapedText === name));
  return p ? p.initializer : null;
}
function bi(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  const en = str(prop(node, 'en')), fr = str(prop(node, 'fr'));
  return en == null && fr == null ? null : { en: en || fr || '', fr: fr || en || '' };
}
function parse(file) {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

function articles() {
  const out = [];
  const seen = new Set();
  const add = (id, title, summary, body, keywords) => {
    if (!id || !title || seen.has(id)) return;
    seen.add(id);
    for (const lang of ['en', 'fr']) {
      out.push({
        k: 'article', lang, id: `art:${id}`,
        t: title[lang],
        x: cap(clean(`${summary ? summary[lang] : ''} ${body ? body[lang] : ''}`)),
        kw: keywords || '',
        a: { article: id },
      });
    }
  };
  const visit = (n) => {
    if (ts.isObjectLiteralExpression(n)) {
      const id = str(prop(n, 'id'));
      const body = bi(prop(n, 'body'));
      const title = bi(prop(n, 'title'));
      if (id && title && body) add(id, title, bi(prop(n, 'summary')), body, str(prop(n, 'keywords')));
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'devArticle') {
      const [idN, titleN, sumN, kwN, bodyN] = n.arguments;
      add(str(idN), bi(titleN), bi(sumN), bi(bodyN), str(kwN));
    }
    ts.forEachChild(n, visit);
  };
  visit(parse(HUB));
  if (out.length < 40) bail(`read only ${out.length / 2} docs hub article(s) — the parser no longer matches docs-hub.ts`);
  return out;
}

function commands() {
  const out = [];
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'registerCommand' && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
      const o = n.arguments[0];
      const id = str(prop(o, 'id'));
      const title = bi(prop(o, 'title'));
      if (id && title) {
        for (const lang of ['en', 'fr']) out.push({ k: 'command', lang, id: `cmd:${id}`, t: title[lang], x: '', kw: `${str(prop(o, 'keywords')) || ''} ${str(prop(o, 'category')) || ''}`.trim(), a: { command: id } });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(parse(CMDS));
  if (out.length < 40) bail(`read only ${out.length / 2} command(s) — the parser no longer matches commands.ts`);
  return out;
}

const entries = [...pages('en'), ...pages('fr'), ...articles(), ...commands()];
const text = `${JSON.stringify({ note: 'GENERATED by scripts/gen-ask-index.mjs from the bundled docs, the docs hub and the command palette. Do not edit.', entries }, null, 0).replace(/\},\{"k"/g, '},\n{"k"')}\n`;

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== text) bail(`${path.relative(ROOT, OUT)} is stale — run: node scripts/gen-ask-index.mjs`);
  console.log(`✓ ask index up to date (${entries.length} entries)`);
} else {
  fs.writeFileSync(OUT, text);
  const by = entries.reduce((m, e) => ((m[e.k] = (m[e.k] || 0) + 1), m), {});
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${entries.length} entries ${JSON.stringify(by)}, ${(text.length / 1024).toFixed(0)} KB`);
}
