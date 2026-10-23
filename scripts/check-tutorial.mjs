// Every element a tutorial step points at must exist somewhere, and every i18n key it names
// must be translated.
//
// A step pointing at a selector that is nowhere in the app renders as a dimmed screen with
// nothing lit up. The lesson looks broken and no error is raised anywhere, because the
// engine simply finds no element — so this is invisible until someone walks the whole
// tutorial by hand.
//
// WHAT COUNTS AS EVIDENCE
//
// The engine resolves a bare name as an id first, then as a class (tutorial-engine
// _resolveFieldEl). Most of BMM's markup is rendered by TypeScript rather than written in
// index.html — mod cards, the command palette, the scheduler — so the sources count too, but
// only where they RENDER the name: `id="x"`, `el.id = 'x'`, `class="… x …"`, `className = '… x'`,
// `classList.add('x')`, an `el('div', 'x …')` helper call. The previous version accepted the
// name anywhere in quotes, which a `querySelector('#x')` against a screen that no longer
// draws `x` satisfies forever — a lookup is not a rendering.
//
// Every place a step names an element is checked: `selector`, `modal_selector`, `selectors`,
// and the field guides (`fields` / `modal_fields`, `{ sel: … }`), which were not checked at
// all. A compound selector (`#a .b`, `.x[data-y]`) is split into its #id / .class parts and
// each part is checked; `[data-…]`, pseudo-classes and runtime-built strings are not
// statically checkable and are skipped part by part, not whole.
//
// It also flags, as warnings rather than failures, a selector that exists but sits inside a
// modal, so the step dims the screen and highlights something nobody can reach until that
// modal is opened. Whether a given step is wrong depends on what the previous one left on
// screen — a judgement — so these are listed for review. A step declaring `modal_selector`
// is doing this on purpose and is skipped.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The #id / .class / bare-name parts of a selector that can be checked statically. A bare
 *  name (no # or .) is what tutorial data mostly uses: id-or-class, resolved by the engine.
 *  Returns [] for anything built at runtime. */
export function selectorParts(sel) {
    const s = String(sel || '').trim();
    if (!s || /[$`]|\$\{/.test(s)) return [];
    if (/^[A-Za-z][\w-]*$/.test(s)) return [{ kind: 'any', name: s }];
    // Drop attribute selectors and pseudo-classes (their insides can hold dots), then take
    // every #id and .class that remains.
    const bare = s.replace(/\[[^\]]*\]/g, ' ').replace(/::?[\w-]+(\([^)]*\))?/g, ' ');
    const out = [];
    for (const m of bare.matchAll(/([#.])([A-Za-z_][\w-]*)/g)) out.push({ kind: m[1] === '#' ? 'id' : 'class', name: m[2] });
    return out;
}

/** Whether `name` is RENDERED (as an id or as a class) by these TS/JS sources. */
export function renderedBy(sources, name, kind = 'any') {
    const n = esc(name);
    const q = `["'\`]`;
    const idPats = [
        new RegExp(`\\bid=\\\\?["']${n}\\\\?["']`),               // id="x" in a template
        new RegExp(`\\.id\\s*=\\s*${q}${n}${q}`),                 // el.id = 'x'
        new RegExp(`\\bid\\s*:\\s*${q}${n}${q}`),                 // { id: 'x' } handed to a builder
        new RegExp(`setAttribute\\(\\s*${q}id${q}\\s*,\\s*${q}${n}${q}`),
        // const CARD_ID = 'x' — an id named once and used as `id="${CARD_ID}"` (laya-hub).
        new RegExp(`\\b[A-Z][A-Z0-9_]*_ID\\s*=\\s*${q}${n}${q}`),
        // A list of [id, label, …] tuples a loop turns into buttons with `b.id = id` (the
        // scheduler's "more" menu): the tuple, followed in the same module by that loop.
        new RegExp(`\\[\\s*${q}${n}${q}\\s*,[\\s\\S]{0,6000}?\\.id\\s*=\\s*id\\b`),
    ];
    const W = `(?<![\\w-])${n}(?![\\w-])`;
    const clsPats = [
        new RegExp(`\\bclass=\\\\?["'][^"'\\n]*${W}`),            // class="a x b" in a template
        new RegExp(`className\\s*[+]?=\\s*${q}[^"'\`\\n]*${W}`),  // el.className = 'a x'
        new RegExp(`\\bclassName\\s*:\\s*${q}[^"'\`\\n]*${W}`),   // { className: 'a x' }
        new RegExp(`\\bcls\\s*:\\s*${q}[^"'\`\\n]*${W}`),         // { cls: 'a x' }
        new RegExp(`classList\\.(?:add|toggle)\\([^)]*${q}${n}${q}`),
        // el('div', 'a x') / h('button', 'x') — the DOM helpers most modules define.
        new RegExp(`\\b(?:el|h|mk|make|node|elt|createEl)\\(\\s*${q}[a-z0-9]+${q}\\s*,\\s*${q}[^"'\`\\n]*${W}`),
    ];
    const pats = kind === 'id' ? idPats : kind === 'class' ? clsPats : [...idPats, ...clsPats];
    return pats.some((p) => p.test(sources));
}

/** Every place a tutorial step names an element, with the property it came from. */
export function targetsOf(data) {
    const out = [];
    for (const m of data.matchAll(/\b(modal_selector|selector):\s*'([^']+)'/g)) out.push({ where: m[1], sel: m[2] });
    for (const block of data.matchAll(/\bselectors:\s*\[([^\]]*)\]/g)) {
        for (const one of block[1].matchAll(/'([^']+)'/g)) out.push({ where: 'selectors', sel: one[1] });
    }
    for (const m of data.matchAll(/\bsel:\s*'([^']+)'/g)) out.push({ where: 'field', sel: m[1] });
    return out;
}

/** The targets that resolve nowhere. `ids`/`classes` come from index.html. */
export function missingTargets(data, { ids, classes, sources }) {
    const bad = [];
    for (const t of targetsOf(data)) {
        for (const p of selectorParts(t.sel)) {
            const inHtml = p.kind === 'id' ? ids.has(p.name)
                : p.kind === 'class' ? classes.has(p.name)
                    : ids.has(p.name) || classes.has(p.name);
            if (!inHtml && !renderedBy(sources, p.name, p.kind)) bad.push(`${t.sel}  (${t.where})`);
        }
    }
    return [...new Set(bad)].sort();
}

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.ts$/.test(name)) out.push(p);
    }
    return out;
}

function main() {
    const data = readFileSync(join(ROOT, 'frontend/src/ui/tutorial-data.ts'), 'utf8');
    const html = readFileSync(join(ROOT, 'frontend/index.html'), 'utf8');
    const en = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/en.json'), 'utf8'));
    const fr = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/fr.json'), 'utf8'));

    // tutorial-data itself is excluded: a selector cannot vouch for its own existence. The
    // TS sources, not the compiled JS: the JS is derived and some of it is stale until the
    // next compile.
    const sources = walk(join(ROOT, 'frontend/src'))
        .filter((f) => !f.endsWith('tutorial-data.ts'))
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n');

    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const classes = new Set(
        [...html.matchAll(/\bclass="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean),
    );

    const missingSel = missingTargets(data, { ids, classes, sources });

    const missingKey = [];
    const missingFr = [];
    const keyRefs = [
        ...[...data.matchAll(/\b(?:title|text|desc|name|usage)_key:\s*'([^']+)'/g)].map((m) => m[1]),
        // Field-explanation keys too ({ sel: …, key: 'tut.…' }). Anchored on the tut. prefix
        // so unrelated `key:` properties cannot false-positive.
        ...[...data.matchAll(/\bkey:\s*'(tut\.[^']+)'/g)].map((m) => m[1]),
    ];
    for (const k of keyRefs) {
        if (!(k in en)) missingKey.push(k);
        else if (!(k in fr)) missingFr.push(k);
    }

    // ── reachability: selectors that live inside a modal ─────────────────────
    //
    // Built from index.html by walking each `id="modal-…"` element to its matching close tag,
    // so nesting is respected.
    const regions = [];
    for (const m of html.matchAll(/<div[^>]*\bid="(modal-[^"]+)"/g)) {
        let depth = 0;
        for (const tag of html.slice(m.index).matchAll(/<div\b|<\/div>/g)) {
            depth += tag[0] === '</div>' ? -1 : 1;
            if (depth === 0) { regions.push([m[1], m.index, m.index + tag.index]); break; }
        }
    }
    const insideModal = (name) => {
        const at = html.indexOf(`id="${name}"`);
        if (at < 0) return null;
        const hit = regions.find(([, a, b]) => at > a && at < b);
        return hit ? hit[0] : null;
    };
    const deliberate = new Set(
        [...data.matchAll(/modal_selector:\s*'([^']+)'/g)].map((m) => m[1].replace(/^[#.]/, '')),
    );
    const gated = [];
    for (const m of data.matchAll(/\bselector:\s*'([^']+)'/g)) {
        const name = m[1].trim().replace(/^[#.]/, '');
        if (!/^[\w-]+$/.test(name) || deliberate.has(name)) continue;
        const modal = insideModal(name);
        if (modal) gated.push(`${m[1]}  (inside ${modal})`);
    }

    // ── every `nav:` must reach a real nav item ───────────────────────────────
    //
    // _navigate() does `querySelector('.nav-item[data-view=…]')?.click()`. On a typo the
    // optional chain swallows it: no error, no navigation. The engine's alias table is read
    // out of the source rather than copied here, so the two cannot drift apart.
    const views = new Set([...html.matchAll(/data-view="([a-z-]+)"/g)].map((m) => m[1]));
    const aliasBlock = sources.match(/VIEW_ALIAS[^=]*=\s*\{([^}]*)\}/);
    const alias = {};
    if (aliasBlock) for (const a of aliasBlock[1].matchAll(/(\w+)\s*:\s*'([^']+)'/g)) alias[a[1]] = a[2];
    const badNav = [];
    for (const m of data.matchAll(/nav:\s*'([^']+)'/g)) {
        const key = alias[m[1]] ?? m[1];
        if (!views.has(key)) badNav.push(alias[m[1]] ? `${m[1]} (aliased to ${key})` : m[1]);
    }

    // ── ids unique where the engine keys progress on them ─────────────────────
    //
    // Progress is stored under `${part}:${step}` per tutorial. Two steps with one id in a
    // part share a tick: finishing one marks the other done.
    const dupes = [];
    for (const tut of data.split(/\nconst [A-Z_]+: TutorialDef = \{/).slice(1)) {
        const tid = tut.match(/\bid:\s*'([^']+)'/)?.[1];
        for (const part of tut.split(/\n {12}id: '/).slice(1)) {
            const pid = part.match(/^([^']+)'/)?.[1];
            const seen = new Set();
            for (const s of part.matchAll(/\n\s{16,20}(?:\{\s*)?id:\s*'([^']+)'/g)) {
                if (seen.has(s[1])) dupes.push(`${tid}/${pid}/${s[1]}`);
                seen.add(s[1]);
            }
        }
    }

    const uniq = (a) => [...new Set(a)].sort();
    let bad = false;

    if (uniq(badNav).length) {
        bad = true;
        console.error(`✗ ${uniq(badNav).length} step nav target(s) match no nav item:`);
        for (const n of uniq(badNav)) console.error(`  ${n}`);
        console.error('  _navigate() swallows these: the step simply does not move, silently.');
    }
    if (missingSel.length) {
        bad = true;
        console.error(`✗ ${missingSel.length} tutorial target(s) are rendered nowhere (index.html or a TS template):`);
        for (const s of missingSel) console.error(`  ${s}`);
        console.error('\n  These dim the screen and highlight nothing, with no error anywhere.');
    }
    if (uniq(missingKey).length) {
        bad = true;
        console.error(`✗ ${uniq(missingKey).length} tutorial i18n key(s) are missing from en.json:`);
        for (const k of uniq(missingKey)) console.error(`  ${k}`);
    }
    if (uniq(missingFr).length) {
        bad = true;
        console.error(`✗ ${uniq(missingFr).length} tutorial i18n key(s) are missing from fr.json:`);
        for (const k of uniq(missingFr)) console.error(`  ${k}`);
    }
    if (uniq(dupes).length) {
        bad = true;
        console.error(`✗ ${uniq(dupes).length} duplicate step id(s) in one part (they share a progress tick):`);
        for (const d of uniq(dupes)) console.error(`  ${d}`);
    }
    if (bad) process.exit(1);

    if (uniq(gated).length) {
        console.warn(`\n⚠ ${uniq(gated).length} step selector(s) live inside a modal — check a prior step opens it:`);
        for (const g of uniq(gated)) console.warn(`  ${g}`);
        console.warn('  (warning only: whether this is wrong depends on the step before it)');
    }
    console.log(`✓ every tutorial target (${targetsOf(data).length}) is rendered and every i18n key resolves`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
