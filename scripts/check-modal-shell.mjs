#!/usr/bin/env node
// A modal built in JavaScript whose classes no stylesheet defines.
//
// Six of them shipped like that: the plugin assets viewer, the plugin check, the two plugin
// inspect dialogs, the repo extras picker and two scheduler dialogs all wore `cm-overlay`,
// `cm-head`, `cm-x` and `cm-foot`. Not one of those four names had a single rule in any of
// the eighteen stylesheets.
//
// What that looks like is not a missing border. `position: fixed` and the backdrop and the
// centring all live on `.modal-overlay`, so without it the dialog is a static block dumped
// at the top of the document, behind whatever was already there. It reads as "I clicked the
// button and nothing happened" — which is exactly how all six were reported.
//
// Nothing catches it: tsc sees a string, the CSS-variable gate checks variables, the
// id-selector gate checks ids, and the app builds and runs perfectly.
//
// So: every class that a module assigns to an element it appends to the document as a
// dialog must exist in a stylesheet. Deliberately narrow — this is not a general
// unused/undefined class checker, which would be enormous and noisy. It looks only at the
// shells, which are the ones where being absent is invisible.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'frontend', 'src');
const CSSDIR = join(ROOT, 'frontend', 'css');

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

// Every class name that has a rule ANYWHERE — the stylesheets, and the <style> blocks some
// modules inject themselves. The command palette does exactly that, and reporting it as
// unstyled was the first thing this script got wrong.
const defined = new Set();
const collect = (css) => { for (const m of css.matchAll(/\.([A-Za-z][\w-]*)\s*[,{:>+~.\[]/g)) defined.add(m[1]); };
for (const f of readdirSync(CSSDIR).filter((f) => f.endsWith('.css'))) collect(readFileSync(join(CSSDIR, f), 'utf8'));

// `el.className = '…'` and `class="…"` inside a template literal, in modules that also
// append to the document — the shape every one of these dialogs is built with.
const CLASSNAME = /\.className\s*=\s*['"`]([^'"`]+)['"`]/g;
const problems = [];

const sources = walk(SRC).filter((f) => f.endsWith('.ts')).map((f) => [f, readFileSync(f, 'utf8')]);
// A module that injects its own rules defines those classes as surely as a .css file does.
for (const [, src] of sources) if (/<style|createElement\('style'\)|textContent\s*=/.test(src)) collect(src);

for (const [file, src] of sources) {
  // Only modules that actually put an element on the page. A class name in a helper that
  // returns markup for something already styled is not this bug.
  if (!/appendChild|append\(/.test(src)) continue;
  for (const m of src.matchAll(CLASSNAME)) {
    const classes = m[1].split(/\s+/).filter(Boolean);
    // One defined class in the list is enough. `modal-overlay open mpc-overlay` is a house
    // overlay with a hook on it, not an unstyled dialog — and flagging the hook is noise
    // that teaches people to ignore the gate.
    if (classes.some((c) => defined.has(c))) continue;
    // Positioned inline instead. `style.cssText = 'position:fixed; inset:0; …'` right after
    // the className is a complete shell; it just isn't in a stylesheet.
    const after = src.slice(m.index, m.index + 400);
    if (/style\.cssText\s*=\s*['"`][^'"`]*position\s*:\s*(fixed|absolute)/.test(after)) continue;
    for (const cls of classes) {
      // Tailwind-ish utilities and state flags are set from JS all over; the ones worth
      // failing on are the shells, which is what these two suffixes name.
      if (!/(overlay|modal)$/i.test(cls)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      problems.push(`${relative(ROOT, file)}:${line} — .${cls} is set on an element but no stylesheet defines it`);
    }
  }
}

// ── Not checked here: where a dialog is mounted ─────────────────────────────
//
// `#app-window-outer` is `position: relative; overflow: hidden` and carries BMM's rounded
// corners; a `.modal-overlay` appended to `document.body` is laid over the whole OS window
// instead, so its backdrop and shadow paint past that edge. Two dialogs shipped that way and
// looked, precisely, like the app's frame was broken.
//
// I wrote a check for it and took it out again. Three attempts:
//
//   1. flag any `document.body.appendChild` in a file that mentions an overlay
//      → 21 hits across eight files, nearly all deliberate. The tutorial spotlight has to
//        cover the frame; the Ko-fi card and the debug windows are their own shells.
//   2. pair the className with the append via a built RegExp
//      → escaped one level too far, matched nothing, and reported SUCCESS with the bug
//        planted in front of it.
//   3. the same pairing with a literal `includes`
//      → the condition is true when run by hand and the loop still did not fire.
//
// A gate that says green while the defect is present is worse than no gate: it is the thing
// people trust instead of looking. The rule is real and worth keeping in mind — every modal
// in this codebase mounts inside the frame — but it is written here rather than enforced,
// because I could not make the enforcement honest.

if (problems.length) {
  console.error('✗ modal shells with no CSS:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(`
  A dialog whose overlay class has no rule is not a dialog with a missing border: the
  fixed positioning, the backdrop and the centring all live on that class. Without it the
  content is a static block at the top of the document, usually behind something — which
  looks exactly like a button that does nothing.

  The house shell is:  .modal-overlay.open  >  .modal.glass  >  .modal-header / .modal-footer
`);
  process.exit(1);
}
console.log(`✓ every JS-built modal shell has a stylesheet (${defined.size} classes defined)`);
