#!/usr/bin/env node
// Every dialog in BMM is one shell: css/modal-shell.css (the look) + ui/modal-shell.ts (the
// behaviour). This gate keeps it that way.
//
// Before it existed (Oct 2026 inventory): ~40 static dialogs and ~75 built ones, in more than
// twenty shell families. Close buttons were `.modal-close`, `.bc-x`, `.ld-x`, `.btn-close`, a
// ghost "Close", a bare "×" or nothing; titles were h2, h3, a styled div or a <b>; widths were
// set inline in fifteen different numbers; footers repainted their own background (a black wash
// that was a smudge on BMM White); and about thirty dialogs ignored Escape. Each one looked
// fine on its own, which is why nothing caught it.
//
// What fails:
//   HTML  a static overlay without the anatomy  .modal > .modal-header(.modal-title + .modal-close)
//         (a question answered by its own buttons may drop the × with data-modal-kind="question");
//         an inline style that restyles the shell (width, padding, background, border, radius,
//         shadow, max-height, overflow) on .modal / .modal-header / .modal-body / .modal-footer.
//   TS    a module that builds a .modal-overlay without a header, a title and a close, unless it
//         uses openModal / buildModalHeader; the same inline shell styles in a template; a
//         `.style.maxWidth = …` (and kin) on a card it created; a NEW overlay family that is
//         not the house shell (`*-overlay` or `*-backdrop`); a full-window overlay built from
//         inline styles (position:fixed on all four edges with a dim), which carries no class
//         for any other rule to see — seven dialogs hid that way until Oct 2026.
//   CSS   a feature stylesheet rule that repaints the shell (padding, background, border,
//         radius, shadow, size) on .modal / .modal-header / .modal-body / .modal-footer /
//         .modal-title / .modal-close / the overlays.
//
// Existing exceptions are listed below WITH a reason, and the lists only shrink: an entry that
// no longer matches anything fails too, so a cleaned dialog cannot stay excused.
//
// Usage: node scripts/check-modal-consistency.mjs [--report]   (--report prints the inventory)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── The rules, as data ──────────────────────────────────────────────────────────────────────

/** Inline properties that restyle the shell. Layout INSIDE a band (text-align, a grid body,
 *  a fixed height for a browser-type dialog, a z-index on the overlay) stays allowed. */
export const SHELL_PROPS = /^(width|max-width|min-width|max-height|padding(?:-\w+)?|margin(?:-\w+)?|background(?:-\w+)?|border(?:-\w+)?|box-shadow|backdrop-filter|overflow(?:-[xy])?)$/;
/** In a feature stylesheet, the same list minus the sizes a CONTENT rule may legitimately set
 *  on the body (its own padding stays forbidden). */
const CSS_SHELL_PROPS = /^(padding(?:-\w+)?|background(?:-\w+)?|border(?:-(?:top|bottom|left|right|color|width|style))?|border-radius|box-shadow|backdrop-filter|max-width|width)$/;
const SHELL_CLASSES = ['modal', 'modal-header', 'modal-body', 'modal-footer', 'modal-title', 'modal-close', 'modal-overlay', 'modal-generic-overlay'];

/** Static dialogs (index.html) that keep their own shell, and why. */
export const HTML_BESPOKE = {};

/** Built dialogs that keep their own shell, and why. Keyed by module path under frontend/src. */
export const TS_BESPOKE = {
    'ui/launch-deck.ts': 'the start-up deck: a paged card with its own step header (ld-head) and focus handling',
    'ui/tutorial-creator.ts': 'a workspace panel (tutc-panel) hosted in the house overlay',
    'features/settings/replay-watcher.ts': 'a session-replay player surface, not a dialog card',
    'features/feedback/feedback-modal.ts': 'feedback form with its own head (fbm-head); Escape and focus handled in-module',
    'ui/bettercommunity-modal.ts': 'branded hero header (bc-hero)',
    'core/analytics.ts': 'the consent question has no × by design (Escape = later); promptEmail is answered by its buttons',
    'ui/ask-one.ts': 'one-field prompt answered by its buttons',
    'core/source-access.ts': 'access gate question answered by its buttons',
    'features/profiles/order-share.ts': 'dialog() helper: house shell with an .osh-body content region',
    'features/settings/bmmscript-open.ts': 'review dialog: house shell, header built in a template the gate cannot follow',
    'features/bench/benchmark.ts': 'built through .bms-head / .bms-title (the shell alias)',
    'features/ai/laya-hub.ts': 'tabbed hub without a footer; house shell',
    'features/debug/debug-ui.ts': 'DevTools surfaces (debug-modal-*), developer-only',
    'features/apps/apps-catalog.ts': 'apps-modal-overlay templates render inside the Apps view, not over the app',
    'core/learn-more.ts': 'Learn-more reader hosted in the house overlay with its own reader header',
    'ui/catalog-modal.ts': 'header built from a spec; house shell',
    'ui/legacy-import.ts': 'header built with buildModalHeader',
    'features/settings/restore-bundle.ts': 'header built with buildModalHeader',
};

/** Overlay families that are not the house shell, and why. A new one fails. */
export const OVERLAY_FAMILIES = {
    'kofi-overlay': 'support card with injected styles (ui/kofi-modal.ts)',
    'onboarding-overlay': 'first-run language step that blocks the app shell',
    'tut-hub-overlay': 'tutorial hub: must sit above everything for lesson spotlights',
    'tut-unsaved-overlay': 'tutorial engine guard, above the tutorial layer',
    'cp-overlay': 'command palette, not a dialog card',
    'bte-confirm-overlay': 'theme editor inline confirm/prompt, above the editor',
    'community-history-overlay': 'community history/comments panels',
    'flappy-overlay': 'easter-egg game',
    'mod-loading-overlay': 'the library loading veil, not a dialog',
    'debug-modal-overlay': 'DevTools prompt, developer-only',
    'debug-crash-overlay': 'DevTools crash screen, developer-only',
    'apps-modal-overlay': 'Apps view in-page panels',
    'ld-overlay': 'launch deck (house overlay + hook class)',
    'lo-overlay': 'activation order (house overlay + hook class)',
    'osh-overlay': 'order share (house overlay + hook class)',
    'ai-overlay': 'Laya dialogs (house overlay + hook class)',
    'fbm-overlay': 'feedback (house overlay + hook class)',
    'mpv2-overlay': 'mapper preview (house overlay + hook class)',
    'mpc-overlay': 'modpack catalogue (house overlay + hook class)',
    'spg-overlay': 'preset gallery (house overlay + hook class)',
    'sched-pc-overlay': 'preset catalogue (generic overlay + hook class)',
    'legacy-overlay': 'legacy import (house overlay + stacking hook)',
    // -backdrop classes, caught since the family rule learnt the second suffix:
    'update-modal-backdrop': 'update notes / test-build welcome: a notes reader with a folder tree (ui/update-notes.ts)',
    'lom-backdrop': 'click-catcher behind the library order menu, not a dialog',
};

/** Modules (and index.html elements, as index.html#id) that still build a full-window overlay
 *  from inline styles, and why. */
export const INLINE_OVERLAYS = {
    'index.html#app-loader': 'the boot splash: covers the frame while the app starts, not a dialog',
};

/** Feature stylesheet rules that still repaint the shell, and why. Selector text as written. */
export const CSS_BASELINE = {
    'launch-deck.css .ld-hosted.modal': 'the deck hosted INSIDE another surface (no overlay): a panel, not a dialog',
    'launch-deck.css .ld-hosted .modal-body': 'same hosted deck',
    'launch-deck.css .ld-hosted .modal-footer': 'same hosted deck',
    'main.css .i18n-overlay-active .modal': 'Translation Sandbox pick mode: the dialog outlines itself while you pick on screen',
    'main.css body.i18nsb-docked #modal-i18n-sandbox .modal': 'Translation Sandbox docked as a side panel',
    'mapper.css .modal-large .modal-body': 'the mapper borrows the confirm as its large preview (modals.ts resets it)',
    'mapper.css .modal-large .modal.glass': 'same borrowed preview',
};

// ── Static dialogs ──────────────────────────────────────────────────────────────────────────

const TAG = /<(\/?)div\b[^>]*>/g;
function spanOf(src, start) {
    let depth = 0;
    TAG.lastIndex = start;
    let m;
    while ((m = TAG.exec(src))) {
        depth += m[1] ? -1 : 1;
        if (depth === 0) return m.index + m[0].length;
    }
    return src.length;
}
const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];
const hasClass = (tag, cls) => new RegExp(`\\bclass="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"`).test(tag);

/** Declarations in an inline style that restyle the shell. */
export function shellDecls(style) {
    return (style || '').split(';').map((d) => d.trim()).filter(Boolean)
        .map((d) => d.split(':')[0].trim().toLowerCase())
        .filter((k) => !k.includes('${') && SHELL_PROPS.test(k));
}

/** Audit index.html. Returns { dialogs: [...], problems: [...] }. */
export function auditHtml(html) {
    const problems = [];
    const dialogs = [];
    const re = new RegExp(String.raw`<div\b[^>]*\bclass="[^"]*${OV}[^"]*"[^>]*>`, 'g');
    let m;
    while ((m = re.exec(html))) {
        const open = m[0];
        const id = attr(open, 'id') || `(line ${html.slice(0, m.index).split('\n').length})`;
        const end = spanOf(html, m.index);
        const body = html.slice(m.index, end);
        const line = html.slice(0, m.index).split('\n').length;
        const say = (msg) => problems.push(`index.html:${line} #${id} — ${msg}`);
        dialogs.push(id);
        if (HTML_BESPOKE[id]) continue;
        const cardM = body.match(/<div\b[^>]*\bclass="modal(?:\s[^"]*)?"[^>]*>/);
        if (!cardM) { say('no .modal card inside the overlay'); continue; }
        const card = cardM[0];
        const headM = body.match(/<div\b[^>]*\bclass="modal-header(?:\s[^"]*)?"[^>]*>/);
        if (!headM) say('no .modal-header');
        const headEnd = headM ? spanOf(body, body.indexOf(headM[0])) : -1;
        const head = headM ? body.slice(body.indexOf(headM[0]), headEnd) : '';
        if (headM && !/class="(?:[^"]*\s)?(?:modal-title|bms-title)(?:\s[^"]*)?"/.test(head)) say('header has no .modal-title');
        const question = attr(open, 'data-modal-kind') === 'question';
        if (headM && !/class="(?:[^"]*\s)?modal-close(?:\s[^"]*)?"/.test(head)) {
            if (!question) say('header has no .modal-close (a question answered by its buttons says data-modal-kind="question")');
            else if (!/class="(?:[^"]*\s)?modal-close(?:\s[^"]*)?"/.test(body)) say('a question needs a Cancel carrying .modal-close (Escape presses it)');
        }
        // Inline restyling of the shell.
        for (const [cls, tag] of [['modal', card], ...[...body.matchAll(/<div\b[^>]*\bclass="(modal-(?:header|body|footer))(?:\s[^"]*)?"[^>]*>/g)].map((x) => [x[1], x[0]])]) {
            const bad = shellDecls(attr(tag, 'style'));
            if (bad.length) say(`inline ${bad.join(', ')} on .${cls} (use a size modifier / the shell)`);
        }
        if (!/\bmodal--(?:sm|md|lg|xl|full)\b/.test(attr(card, 'class') || '') && !/\bmodal-large\b/.test(card)) {
            // Default width is md; that is fine, but say it in the report.
        }
    }
    return { dialogs, problems };
}

// ── Built dialogs ───────────────────────────────────────────────────────────────────────────

// Class TOKENS, not \b: `\bmodal-overlay\b` also matches `modal-overlay-security`, because a
// hyphen is a word boundary — which is how the first run of this gate flagged a family it was
// meant to leave alone.
const OV = String.raw`(?<![\w-])(?:modal-overlay|modal-generic-overlay)(?![\w-])`;
const OVERLAY_IN_TS = new RegExp(String.raw`(?:className\s*=\s*[` + '`' + String.raw`'"][^` + '`' + String.raw`'"]*${OV}|el\(\s*'div'\s*,\s*'[^']*${OV}|class="[^"]*${OV})`);

/** Audit one TS module. `rel` is its path under frontend/src with forward slashes. */
export function auditTs(rel, src) {
    const problems = [];
    const say = (at, msg) => problems.push(`frontend/src/${rel}:${src.slice(0, at).split('\n').length} — ${msg}`);
    if (rel === 'ui/modal-shell.ts') return { builds: false, problems };
    const builds = OVERLAY_IN_TS.test(src);
    if (builds && !TS_BESPOKE[rel]) {
        const helper = /\b(openModal|buildModalHeader)\(/.test(src);
        const at = src.search(OVERLAY_IN_TS);
        if (!helper) {
            if (!/modal-header/.test(src)) say(at, 'builds a .modal-overlay with no .modal-header (use openModal / buildModalHeader)');
            if (!/modal-title|bms-title/.test(src)) say(at, 'builds a .modal-overlay with no .modal-title');
            if (!/modal-close/.test(src)) say(at, 'builds a .modal-overlay with no .modal-close');
        }
    }
    // Inline shell styles in a template.
    for (const m of src.matchAll(/class="(modal(?:-header|-body|-footer)?)(?:\s[^"$]*)?"(?:\s+[\w-]+="[^"]*")*?\s+style="([^"]*)"/g)) {
        const bad = shellDecls(m[2]);
        if (bad.length) say(m.index, `inline ${bad.join(', ')} on .${m[1]} in a template`);
    }
    // `card.style.maxWidth = …` on a card this module made.
    for (const m of src.matchAll(/(\w+)\.className\s*=\s*['"`]modal(?:\s[^'"`]*)?['"`]/g)) {
        const v = m[1];
        const re = new RegExp(`\\b${v}\\.style\\.(maxWidth|width|padding|borderRadius|background|boxShadow|border|maxHeight)\\s*=`, 'g');
        for (const s of src.matchAll(re)) say(s.index, `${v}.style.${s[1]} on a .modal card (use a size modifier)`);
    }
    // Overlay families (a -backdrop is an overlay under another name: the update dialogs wore one).
    for (const m of src.matchAll(/(?:className\s*=\s*|class=|el\(\s*'div'\s*,\s*)[`'"]([^`'"]*)[`'"]/g)) {
        for (const cls of m[1].split(/\s+/)) {
            if (!FAMILY_CLASS.test(cls) || cls === 'modal-overlay' || cls === 'modal-generic-overlay') continue;
            if (!OVERLAY_FAMILIES[cls]) say(m.index, `new overlay family .${cls} — use the house .modal-overlay (or list it in OVERLAY_FAMILIES with a reason)`);
        }
    }
    // A full-window overlay built from inline styles: no class for the gate to see, so it was the
    // way a dialog escaped every rule above (seven of them, Oct 2026).
    const inline = inlineOverlays(src);
    if (inline.length && !INLINE_OVERLAYS[rel]) {
        for (const o of inline) say(o.at, `a full-window overlay built from inline styles (${o.decls}) — use openModal / the house .modal-overlay (or list the module in INLINE_OVERLAYS with a reason)`);
    }
    return { builds, problems, inline: inline.length };
}

const FAMILY_CLASS = /^[a-z][\w-]*-(?:overlay|backdrop)$/;

/**
 * Inline declaration lists in `src` that paint a full-window dim: `position:fixed`, pinned to
 * all four edges (`inset:0`, or top/left 0 with right/bottom 0 or a 100% size), and a scrim (a
 * background that is not transparent, or a backdrop-filter). Looked for where a dialog is
 * styled by hand: `style="…"` attributes, `.style.cssText = '…'` (also `[…].join('')`).
 * A stylesheet in a string (it has braces) is not a declaration list and is skipped.
 * Returns [{ at, decls }]. Pure.
 */
export function inlineOverlays(src) {
    const out = [];
    const lists = [];
    for (const m of src.matchAll(/\bstyle="([^"]*)"/g)) lists.push([m.index, m[1]]);
    for (const m of src.matchAll(/\.cssText\s*=\s*(['"`])([\s\S]*?)\1/g)) lists.push([m.index, m[2]]);
    for (const m of src.matchAll(/\.cssText\s*=\s*\[([\s\S]*?)\]\s*\.join/g)) {
        lists.push([m.index, [...m[1].matchAll(/(['"`])([\s\S]*?)\1/g)].map((x) => x[2]).join('')]);
    }
    for (const [at, text] of lists) {
        if (/[{}]/.test(text.replace(/\$\{[^}]*\}/g, ''))) continue;
        const d = {};
        for (const part of text.split(';')) {
            const i = part.indexOf(':');
            if (i < 0) continue;
            d[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim().toLowerCase().replace(/\s+/g, ' ');
        }
        if (d.position !== 'fixed') continue;
        const zero = (v) => v != null && /^0(px)?$/.test(v);
        const full = (v) => v === '100%' || v === '100vw' || v === '100vh';
        const covers = zero(d.inset) || (zero(d.top) && zero(d.left) && (zero(d.right) || zero(d.bottom) || full(d.width) || full(d.height)));
        if (!covers) continue;
        const bg = d.background ?? d['background-color'];
        const dims = (bg != null && !/^(transparent|none)$/.test(bg)) || d['backdrop-filter'] != null;
        if (!dims) continue;
        out.push({ at, decls: ['position:fixed', d.inset != null ? 'inset:0' : 'top/left:0', bg != null ? `background:${bg}` : 'backdrop-filter'].join('; ') });
    }
    return out;
}

// ── Feature stylesheets ─────────────────────────────────────────────────────────────────────

/** Rules in `css` that repaint the shell. Returns [{ selector, props }]. */
export function shellOverrides(css) {
    const out = [];
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    // Flatten one level of @media / @supports: their bodies are scanned like top-level rules.
    for (const m of clean.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
        const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean);
        const props = [...m[2].matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)].map((p) => p[1].toLowerCase()).filter((p) => CSS_SHELL_PROPS.test(p));
        if (!props.length) continue;
        for (const sel of selectors) {
            // The LAST compound of the selector is what gets painted.
            const last = sel.split(/\s+|>|\+|~/).filter(Boolean).pop() || '';
            const classes = [...last.matchAll(/\.([\w-]+)/g)].map((c) => c[1]);
            if (!classes.some((c) => SHELL_CLASSES.includes(c))) continue;
            // The overlays are positioned per family (mascot.css pins them in the frame); only
            // their dim and inset are the shell's.
            const onlyOverlay = classes.every((c) => !SHELL_CLASSES.includes(c) || /overlay$/.test(c));
            const hit = onlyOverlay ? props.filter((p) => /^(background|backdrop-filter|padding)/.test(p)) : props;
            if (!hit.length) continue;
            out.push({ selector: sel.replace(/\s+/g, ' '), props: hit });
        }
    }
    return out;
}

// ── Run ─────────────────────────────────────────────────────────────────────────────────────

function walk(dir) {
    return readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

export function run({ report = false } = {}) {
    const problems = [];
    const inlineSeen = new Set();
    const html = readFileSync(join(ROOT, 'frontend/index.html'), 'utf8');
    const h = auditHtml(html);
    problems.push(...h.problems);
    for (const id of Object.keys(HTML_BESPOKE)) {
        if (!h.dialogs.includes(id)) problems.push(`HTML_BESPOKE lists #${id}, which no longer exists — remove the entry`);
    }
    for (const o of inlineOverlays(html)) {
        const tag = html.slice(html.lastIndexOf('<', o.at), html.indexOf('>', o.at) + 1);
        const key = `index.html#${attr(tag, 'id') || '?'}`;
        if (INLINE_OVERLAYS[key]) { inlineSeen.add(key); continue; }
        problems.push(`index.html:${html.slice(0, o.at).split('\n').length} — a full-window overlay built from inline styles (${o.decls}) — use the house .modal-overlay`);
    }

    const SRC = join(ROOT, 'frontend/src');
    let built = 0;
    const seenBespoke = new Set();
    const famSeen = new Set();
    for (const f of walk(SRC).filter((p) => p.endsWith('.ts'))) {
        const rel = relative(SRC, f).split(sep).join('/');
        const src = readFileSync(f, 'utf8');
        const r = auditTs(rel, src);
        if (r.builds) built++;
        if (TS_BESPOKE[rel]) seenBespoke.add(rel);
        if (r.inline) inlineSeen.add(rel);
        for (const m of src.matchAll(/(?<![\w-])[\w-]+-(?:overlay|backdrop)(?![\w-])/g)) famSeen.add(m[0]);
        problems.push(...r.problems);
    }
    for (const rel of Object.keys(TS_BESPOKE)) if (!seenBespoke.has(rel)) problems.push(`TS_BESPOKE lists ${rel}, which no longer exists — remove the entry`);
    for (const rel of Object.keys(INLINE_OVERLAYS)) if (!inlineSeen.has(rel)) problems.push(`INLINE_OVERLAYS lists ${rel}, which builds no inline overlay any more — remove the entry`);
    for (const fam of Object.keys(OVERLAY_FAMILIES)) if (!famSeen.has(fam)) problems.push(`OVERLAY_FAMILIES lists .${fam}, which nothing uses any more — remove the entry`);

    const CSSDIR = join(ROOT, 'frontend/css');
    const cssSeen = new Set();
    let overrides = 0;
    for (const f of readdirSync(CSSDIR).filter((x) => x.endsWith('.css') && x !== 'modal-shell.css')) {
        for (const o of shellOverrides(readFileSync(join(CSSDIR, f), 'utf8'))) {
            const key = `${f} ${o.selector}`;
            if (CSS_BASELINE[key]) { cssSeen.add(key); continue; }
            overrides++;
            problems.push(`css/${f}: \`${o.selector}\` repaints the shell (${o.props.join(', ')}) — the shell is css/modal-shell.css`);
        }
    }
    for (const key of Object.keys(CSS_BASELINE)) if (!cssSeen.has(key)) problems.push(`CSS_BASELINE lists \`${key}\`, which no longer matches — remove the entry`);

    if (report) {
        console.log(`static dialogs: ${h.dialogs.length} (${Object.keys(HTML_BESPOKE).length} bespoke)`);
        console.log(`modules building a house overlay: ${built}; bespoke modules: ${Object.keys(TS_BESPOKE).length}; other overlay families: ${Object.keys(OVERLAY_FAMILIES).length}; inline-built overlays excused: ${Object.keys(INLINE_OVERLAYS).length}`);
    }
    return { problems, dialogs: h.dialogs.length, built };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const { problems, dialogs, built } = run({ report: process.argv.includes('--report') });
    if (problems.length) {
        console.error(`✗ modal consistency: ${problems.length} problem(s)\n`);
        for (const p of problems) console.error(`  ${p}`);
        console.error(`
  The anatomy (css/modal-shell.css):
    .modal-overlay.open > .modal.modal--{sm|md|lg|xl} > .modal-header(.modal-title, .modal-close)
                                                       + .modal-body + .modal-footer
  Size with a modifier, tone with .bms-icon--*, primary action last in the footer.
  New dialogs: openModal() / buildModalHeader() from ui/modal-shell.ts.`);
        process.exit(1);
    }
    console.log(`✓ modal consistency: ${dialogs} static dialog(s) and ${built} building module(s) on the one shell`);
}
