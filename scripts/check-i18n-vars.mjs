// Every {placeholder} in a translation must be one the code fills, in every language.
//
// t('key', { count: 3 }) replaces `{count}` and leaves anything else between braces exactly as
// written. So a value that says `{n}` while the call passes `count` renders a literal `{n}` on
// screen, and so does a French value that renamed `{count}` to `{nombre}`: the English screen
// is fine, the French one shows braces, and no other gate notices. The same goes the other way
// for a number glued in front of a translation (`${n} ${t('mod.scanAdded')}`): the value can't
// agree with the number, so it carries "nouveau(x) mod(s) ajouté(s)" and the reader sees the
// grammar scaffolding instead of a sentence. That toast is why this gate exists.
//
// What it reads:
//   · the Lang files (en, fr, and template where a value is non-empty), duplicates included:
//     JSON.parse keeps the LAST of two equal keys, so a duplicate silently replaces a value —
//     `sched.retry.again` held two texts, and the toast that wanted the first one got the
//     second, braces and all;
//   · every call with a literal key in frontend/src: t(), window.t(), tIn(), the local
//     helpers that forward vars (`fill(key, vars)`, benchmark `tt(key, en, vars)`), plus a
//     `.replace('{x}', …)` chain right after the call; and data-i18n attributes, which can
//     never pass a var.
//
// What fails:
//   1. a key whose languages disagree on the placeholder set (unless LITERAL);
//   2. a call that can't fill a placeholder its key's value contains (the literal-braces bug);
//   3. a call passing a var no language uses (a renamed placeholder left behind) — reported per
//      language, so "passes `count`, the French value has no {count}" is caught by name;
//   4. a duplicate key in a Lang file;
//   5. `${number} ${t('key')}` — a count glued to a translation that can't agree with it.
//
// A call whose vars aren't a literal object (`t(k, vars)`, a spread) is not judged: the gate
// only reports what it can prove.
//
//   node scripts/check-i18n-vars.mjs          # gate
//   node scripts/check-i18n-vars.mjs --json   # the audit, for gen-i18n-vars-reference.mjs
//
// The pure parts are exported for tests/i18n-vars.test.mjs.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LANGS = ['en', 'fr', 'template'];

/**
 * Values whose braces are TEXT for the reader, not t() placeholders: they show the scheduler's
 * own `{variable}` syntax, so a translator may (and does) translate the example word. Each
 * entry must stay a key no call passes vars to; the gate checks that, so the list can't hide a
 * real placeholder.
 */
export const LITERAL = new Map([
    ['sched.var.namePh', 'shows the scheduler {variable} syntax as an example'],
    ['sched.var.valuePh', 'shows the scheduler {variable} syntax as an example'],
    ['sched.ai.classifyHint', 'lists scheduler variables the classify block sets'],
    ['docs.diagram.i18n-system.n.T.desc', 'describes {placeholders} in prose'],
    ['repo.manifestLayoutHint', 'shows the mods/{id}/{path} layout template'],
    ['plugins.dl.data_export_auto.p.name', 'documents the {date}/{time}/{datetime} file-name tokens'],
    ['sched.bk.nameHint', 'documents the {date}/{time}/{datetime} file-name tokens'],
    ['sched.fw.textPh', 'tells the reader {variables} are substituted'],
    ['sched.list.itemPh', 'tells the reader {variables} are substituted'],
    ['sched.list.valuePh', 'tells the reader {variables} are substituted'],
    ['sched.map.keyPh', 'tells the reader {variables} are substituted'],
    ['sched.map.valuePh', 'tells the reader {variables} are substituted'],
    ['sched.map.intoPh', 'shows the scheduler {name} syntax'],
    ['sched.idof.idPh', 'tells the reader {variables} are substituted'],
    ['sched.idof.intoPh', 'shows the scheduler {name} syntax'],
    ['sched.wh.bodyHint', 'tells the reader {variables} are substituted'],
    ['sched.http.headersPh', 'shows a {token} variable in an example header'],
    ['sched.http.subst', 'tells the reader {variables} are substituted'],
    ['sched.ai.textPh', 'shows the scheduler {variable} syntax'],
    ['sched.ai.triageTextPh', 'shows the scheduler {variable} syntax'],
]);

/**
 * data-i18n elements whose text the code REPLACES with t(key, vars) before anyone sees it (the
 * attribute is the language-switch hook, not the renderer). The call that fills it is checked
 * like any other.
 */
export const ATTR_FILLED = new Map([
    ['prof.duplicateFolderMsg', 'profiles.ts fills {profile} when the dialog opens'],
]);

/**
 * Glued counts known before this gate, each a sentence to rewrite with a {count} placeholder.
 * Shrink this list, never grow it.
 */
export const KNOWN_GLUED = new Set([
    // Unit labels after a count in a chip or a header ("12 fichiers"): readable as they are.
    'analytics.packetEvents', 'bench.cmpRuns', 'conflict.active', 'conflict.files',
    'conflict.modsInConflict', 'conflict.potential', 'hub.parts', 'hub.steps',
    'modpack.dependenciesShort', 'modpack.modsAvailable', 'repo.autoSyncPending', 'repo.hub.found',
    'repo.manifestRemovedWarn', 'rstudio.events', 'settings.launchPackExes',
    // Still written with (s)/(x) in French: next in line for a .one/.many pair.
    'anim.matches', 'bench.selected', 'i18n.unsavedEdits', 'modpack.modsSelected',
    'navedit.imported', 'navedit.skipped', 'plugins.modsSelected', 'plugins.pluginsCount',
    'sched.imported', 'themes.unsaved',
]);

/** `{name}` placeholders t() would fill. Dotted `{event.name}` is scheduler syntax, never a t() var. */
export function placeholders(value) {
    if (typeof value !== 'string') return [];
    return [...new Set([...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]))].sort();
}

/** Keys that appear twice at the top level of a Lang file's text (JSON.parse keeps the last). */
export function duplicateKeys(text) {
    const seen = new Set();
    const dup = new Set();
    for (const m of text.matchAll(/^ {2}"((?:[^"\\]|\\.)+)"\s*:/gm)) {
        if (seen.has(m[1])) dup.add(m[1]);
        seen.add(m[1]);
    }
    return [...dup];
}

// ── reading calls ────────────────────────────────────────────────────────────

/** Index just past the string/template that starts at `i` (src[i] is the quote). */
function skipString(src, i) {
    const q = src[i];
    i++;
    while (i < src.length) {
        const c = src[i];
        if (c === '\\') { i += 2; continue; }
        if (c === q) return i + 1;
        if (q === '`' && c === '$' && src[i + 1] === '{') {
            i = skipBalanced(src, i + 1, '{', '}');
            continue;
        }
        i++;
    }
    return i;
}

/** From an opening bracket at `i`, the index just past its match; strings and comments skipped. */
function skipBalanced(src, i, open, close) {
    let depth = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === '"' || c === "'" || c === '`') { i = skipString(src, i); continue; }
        if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
        if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') {
            depth--;
            if (depth === 0) return i + 1;
        }
        i++;
    }
    return i;
}

/** Top-level comma split of the text between brackets. */
export function splitTop(inner) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (c === '"' || c === "'" || c === '`') { i = skipString(inner, i) - 1; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === ',' && depth === 0) { out.push(inner.slice(start, i).trim()); start = i + 1; }
    }
    const last = inner.slice(start).trim();
    if (last) out.push(last);
    return out;
}

/** Literal keys an argument can evaluate to: `'a'`, or `cond ? 'a' : 'b'`. Null when computed. */
export function literalKeys(arg) {
    const one = /^'([A-Za-z0-9_.-]+)'$|^"([A-Za-z0-9_.-]+)"$/.exec(arg);
    if (one) return [one[1] || one[2]];
    const tern = /^[^?'"`]+\?\s*'([A-Za-z0-9_.-]+)'\s*:\s*'([A-Za-z0-9_.-]+)'$/.exec(arg);
    if (tern) return [tern[1], tern[2]];
    return null;
}

/** The names an object-literal argument passes, or null when they can't be known statically. */
export function objectKeys(arg) {
    if (!arg.startsWith('{') || !arg.endsWith('}')) return null;
    const names = [];
    for (const part of splitTop(arg.slice(1, -1))) {
        if (part.startsWith('...') || part.startsWith('[')) return null;
        const m = /^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*|\d+))\s*(?::|$)/.exec(part);
        if (!m) return null;
        names.push(m[1] || m[2] || m[3]);
    }
    return names;
}

/** Callers that resolve a literal key: [regex for the callee, key arg index, vars arg index or -1]. */
const CALLERS = [
    [/(?<![\w$.])t\(/g, 0, 1],
    [/\b(?:window|api)\.t\(/g, 0, 1],
    [/(?<![\w$.])tIn\(/g, 1, -1],
    [/(?<![\w$.])fill\(/g, 0, 1],
    [/(?<![\w$.])tt\(/g, 0, 2],
];

const lineAt = (src, i) => src.slice(0, i).split('\n').length;

/**
 * The placeholders a `.replace('{x}', …)` / `?.replace` / replaceAll / `split('{x}').join(…)`
 * chain at the start of `rest` fills.
 */
export function readChain(rest) {
    const names = [];
    for (;;) {
        const r = /^\s*\??\.\s*(?:replace|replaceAll|split)\(\s*(?:'\{(\w+)\}'|"\{(\w+)\}"|\/\\\{(\w+)\\\}\/g?)/.exec(rest);
        if (!r) break;
        names.push(r[1] || r[2] || r[3]);
        const callOpen = rest.indexOf('(', r.index);
        rest = rest.slice(skipBalanced(rest, callOpen, '(', ')'));
        const join = /^\s*\.\s*join\(/.exec(rest);
        if (join) rest = rest.slice(skipBalanced(rest, join[0].length - 1, '(', ')'));
    }
    return names;
}

/** Index of the innermost '(' still open at `at`, on its own line; -1 if none. */
function enclosingParen(src, at, start = -1) {
    // From the start of the call's own line: earlier lines may be template text, whose quotes would
    // desync the string tracking.
    const from = start >= 0 ? start : src.lastIndexOf('\n', at - 1) + 1;
    const stack = [];
    for (let i = from; i < at; i++) {
        const c = src[i];
        if (c === '"' || c === "'") {
            const j = skipString(src, i);
            if (j > at) return -1;
            i = j - 1;
            continue;
        }
        if (c === '`') {
            // Walk the template; when `at` sits inside one of its ${…}, the parens that matter
            // are the ones inside that expression.
            let k = i + 1;
            while (k < at) {
                if (src[k] === '\\') { k += 2; continue; }
                if (src[k] === '`') break;
                if (src[k] === '$' && src[k + 1] === '{') {
                    const e = skipBalanced(src, k + 1, '{', '}');
                    if (e > at) return enclosingParen(src, at, k + 2);
                    k = e;
                    continue;
                }
                k++;
            }
            if (k >= at) return -1;
            i = k;
            continue;
        }
        if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? at : e; continue; }
        if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? at : e + 1; continue; }
        if (c === '(') stack.push(i);
        else if (c === ')') stack.pop();
    }
    return stack.length ? stack[stack.length - 1] : -1;
}

/**
 * Every call with a literal key: { key, vars: string[] | null, line, shared }. `vars` is [] for
 * a call passing none and null when they can't be read; `shared` marks `c ? 'a' : 'b'`, where
 * one vars object serves two keys and either may ignore some of it. Placeholders filled after
 * the call count as passed: a replace chain on the call, on the parenthesised group around it
 * (`(t('k') || 'fb').replace`, `(c ? t('a') : t('b')).replace`), or on the variable it is
 * assigned to (`const tpl = t('k'); … tpl.replace('{n}', …)`).
 */
export function findCalls(src) {
    const calls = [];
    for (const [re, keyAt, varsAt] of CALLERS) {
        re.lastIndex = 0;
        for (let m; (m = re.exec(src)); ) {
            const open = m.index + m[0].length - 1;
            const end = skipBalanced(src, open, '(', ')');
            const args = splitTop(src.slice(open + 1, end - 1));
            const keys = literalKeys(args[keyAt] || '');
            if (!keys) continue;
            let shared = keys.length > 1;
            let vars = varsAt < 0 || args.length <= varsAt ? [] : objectKeys(args[varsAt]);
            const filled = [...readChain(src.slice(end))];
            const g = enclosingParen(src, m.index);
            if (g >= 0) {
                const before = src.slice(Math.max(0, g - 12), g);
                // A grouping paren, not a call's: nothing callable right before it.
                if (!/[\w$)\]]\s*$/.test(before) || /\breturn\s*$/.test(before)) {
                    const gEnd = skipBalanced(src, g, '(', ')');
                    const fromGroup = readChain(src.slice(gEnd));
                    filled.push(...fromGroup);
                    // `(ok ? t('a') : t('b')).replace(…)`: one chain serves both keys.
                    if (fromGroup.length && (src.slice(g, gEnd).match(/(?<![\w$.])t\(/g) || []).length > 1) shared = true;
                }
            }
            const decl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*$/.exec(src.slice(Math.max(0, m.index - 80), m.index));
            if (decl) {
                const name = decl[1].replace(/\$/g, '\\$');
                const re2 = new RegExp(`(?<![\\w$.])${name}(?=\\s*\\??\\.\\s*(?:replace|replaceAll|split)\\()`, 'g');
                const scope = src.slice(end, end + 4000);
                for (const u of scope.matchAll(re2)) filled.push(...readChain(scope.slice(u.index + decl[1].length)));
            }
            if (vars) vars = [...new Set([...vars, ...filled])];
            for (const key of keys) calls.push({ key, vars, line: lineAt(src, m.index), shared });
        }
    }
    return calls;
}

/** data-i18n*="key" attributes: a key rendered with no vars at all. */
export function findAttrKeys(src) {
    const out = [];
    for (const m of src.matchAll(/data-i18n(?:-placeholder|-title|-tooltip|-filter|-panel|-tab)?="([A-Za-z0-9_.-]+)"/g)) {
        // `querySelector('[data-i18n="k"]')` finds an element; it renders nothing.
        if (src[m.index - 1] === '[') continue;
        out.push({ key: m[1], vars: [], line: lineAt(src, m.index), attr: true });
    }
    return out;
}

/** `${count} ${t('key')}`: a number spliced in front of a sentence that can't agree with it. */
export function findGlued(src) {
    const out = [];
    for (const m of src.matchAll(/\$\{\s*([A-Za-z_$][\w$.]*)\s*\}\s+\$\{\s*t\(\s*'([A-Za-z0-9_.-]+)'\s*\)/g)) {
        if (/(count|added|removed|diff|total|\bn\b|length|num|size)$/i.test(m[1])) {
            out.push({ key: m[2], expr: m[1], line: lineAt(src, m.index) });
        }
    }
    return out;
}

// ── the audit ────────────────────────────────────────────────────────────────

/**
 * dicts: { en: {...}, fr: {...}, template: {...} }; uses: [{ key, vars, file, line }].
 * Returns { keys: Map(key -> { vars, perLang, sites }), errors: string[] }.
 */
export function audit(dicts, uses, { literal = LITERAL, attrFilled = ATTR_FILLED } = {}) {
    const errors = [];
    const keys = new Map();
    const base = dicts.en || {};
    for (const key of Object.keys(base)) {
        if (typeof base[key] !== 'string') continue;
        const perLang = {};
        for (const lang of Object.keys(dicts)) {
            const v = dicts[lang]?.[key];
            if (typeof v === 'string' && v !== '') perLang[lang] = placeholders(v);
        }
        const all = [...new Set(Object.values(perLang).flat())].sort();
        if (!all.length) continue;
        keys.set(key, { vars: all, perLang, sites: [] });
        if (literal.has(key)) continue;
        const want = perLang.en.join(',');
        for (const [lang, got] of Object.entries(perLang)) {
            if (got.join(',') !== want) {
                errors.push(`${key}: ${lang} has {${got.join('}, {') || ''}} but en has {${perLang.en.join('}, {')}} — every language must use the same names`);
            }
        }
    }
    for (const u of uses) {
        const entry = keys.get(u.key);
        if (entry) entry.sites.push(u);
        if (u.vars === null) continue;
        const where = `${u.file}:${u.line}`;
        if (literal.has(u.key)) {
            if (u.vars.length) errors.push(`${u.key} (${where}) is listed in LITERAL but this call passes {${u.vars.join('}, {')}} — remove it from LITERAL`);
            continue;
        }
        if (entry && !(u.attr && attrFilled.has(u.key))) {
            for (const p of entry.vars) {
                if (!u.vars.includes(p)) errors.push(`${u.key} (${where}) never fills {${p}} — the screen shows the braces`);
            }
        }
        // One vars object for `c ? 'a' : 'b'`: either key may use only part of it.
        if (u.shared) continue;
        for (const v of u.vars) {
            for (const lang of Object.keys(dicts)) {
                const val = dicts[lang]?.[u.key];
                if (typeof val !== 'string' || val === '') continue;
                if (!placeholders(val).includes(v)) {
                    errors.push(`${u.key} (${where}) passes {${v}} but the ${lang} value has no {${v}} — that language drops it`);
                }
            }
        }
    }
    return { keys, errors: [...new Set(errors)] };
}

function walk(d, out = []) {
    for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.ts$/.test(n)) out.push(p);
    }
    return out;
}

/** The whole repo, read: dictionaries, duplicates, uses, glued counts. */
export function collect(root = ROOT) {
    const dicts = {};
    const dups = [];
    for (const lang of LANGS) {
        const text = readFileSync(join(root, `frontend/Lang/${lang}.json`), 'utf8');
        dicts[lang] = JSON.parse(text);
        for (const k of duplicateKeys(text)) dups.push(`${lang}.json: "${k}" appears twice — JSON keeps the last one, the first text is dead`);
    }
    const uses = [];
    const glued = [];
    const files = walk(join(root, 'frontend/src')).map((f) => [relative(root, f).replace(/\\/g, '/'), readFileSync(f, 'utf8')]);
    files.push(['frontend/index.html', readFileSync(join(root, 'frontend/index.html'), 'utf8')]);
    for (const [file, src] of files) {
        if (file.endsWith('.ts')) for (const c of findCalls(src)) uses.push({ ...c, file });
        for (const c of findAttrKeys(src)) uses.push({ ...c, file });
        if (file.endsWith('.ts')) for (const g of findGlued(src)) glued.push({ ...g, file });
    }
    return { dicts, dups, uses, glued };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const { dicts, dups, uses, glued } = collect();
    const { keys, errors } = audit(dicts, uses);
    const gluedErr = glued
        .filter((g) => !KNOWN_GLUED.has(g.key))
        .map((g) => `${g.key} (${g.file}:${g.line}) is glued after \${${g.expr}} — put a {count} placeholder in the value (and a .one/.many pair) instead`);
    // Lists that only shrink: an entry that no longer applies must go, or it hides the next one.
    const stale = [
        ...[...KNOWN_GLUED].filter((k) => !glued.some((g) => g.key === k)).map((k) => `${k} is in KNOWN_GLUED but no longer glued — remove it`),
        ...[...LITERAL.keys()].filter((k) => !(k in dicts.en)).map((k) => `${k} is in LITERAL but not in en.json — remove it`),
        ...[...ATTR_FILLED.keys()].filter((k) => !(k in dicts.en)).map((k) => `${k} is in ATTR_FILLED but not in en.json — remove it`),
    ];
    const all = [...dups, ...errors, ...gluedErr, ...stale];
    if (process.argv.includes('--json')) {
        process.stdout.write(JSON.stringify({ keys: [...keys].map(([k, v]) => ({ key: k, vars: v.vars, sites: v.sites.length })) }, null, 1));
        process.exit(0);
    }
    if (all.length) {
        console.error(`✗ ${all.length} translation-variable problem(s):`);
        for (const e of all.slice(0, 60)) console.error(`  ${e}`);
        if (all.length > 60) console.error(`  … and ${all.length - 60} more`);
        process.exit(1);
    }
    const judged = uses.filter((u) => u.vars !== null && keys.has(u.key)).length;
    console.log(`✓ translation variables agree: ${keys.size} keys with placeholders, ${judged} call sites checked, ${LITERAL.size} literal-brace keys`);
}
