#!/usr/bin/env node
// CI gate: index.html's structural tags must balance, and no modal may live inside another.
//
// WHY THIS EXISTS
//
// A rewrite of the server modals left SEVEN `</div>` unwritten. HTML has no syntax error for
// that — the browser simply keeps nesting, so every element that followed in the file was
// adopted as a child of the last unclosed container. Eight modal overlays ended up inside
// `#modal-server`, three of them behind an ancestor with `display:none`:
//
//     #modal-server (display:none)
//       └ .srv-modal
//          └ #srv-panel-monitoring
//             └ .modal-body
//                └ #monitoring-table-container      <- never closed
//                   └ #srv-panel-whitelist          <- meant to be a SIBLING
//                      └ .modal-body                <- never closed
//                         └ #modal-confirm-generic  <- trapped
//
// `#modal-confirm-generic` is the confirmation dialog the WHOLE app uses. Adding `.open` to
// it could not show it, because an ancestor was hidden. So every confirm in the app opened
// an invisible box and waited forever for a click that could not happen: delete a mod,
// delete a profile, delete an automation — nothing, no error, no log line. It looked like a
// dozen unrelated features had broken at once.
//
// Nothing caught it. tsc does not read index.html. check-markup only looks for typographic
// quotes. The app booted, rendered, and passed all 42 gates.
//
// Two checks, both cheap:
//   1. div / section / main open and close in balance, and never close more than are open.
//   2. no modal overlay is nested inside another modal overlay — the domain invariant that
//      actually broke, and the one that stays meaningful even if the markup is restructured.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'frontend/index.html');

const raw = readFileSync(FILE, 'utf8');
// Blank comments IN PLACE so offsets — and therefore line numbers — stay exact.
const src = raw.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));

const TRACK = ['div', 'section', 'main'];
const TAG = new RegExp(`<(/?)(${TRACK.join('|')})\\b([^>]*?)(/?)>`, 'gis');
const OVERLAY = /\b(modal-overlay|modal-generic-overlay)\b/;

const lineAt = (pos) => raw.slice(0, pos).split('\n').length;
const label = (attrs) => {
    const id = /id="([^"]+)"/i.exec(attrs);
    if (id) return `#${id[1]}`;
    const cls = /class="([^"]+)"/i.exec(attrs);
    return cls ? `.${cls[1].trim().split(/\s+/).join('.')}`.slice(0, 44) : '<div>';
};

const stack = [];
const errors = [];
let m;
while ((m = TAG.exec(src)) !== null) {
    const [, closing, tag, attrs, selfClose] = m;
    const line = lineAt(m.index);
    if (closing) {
        if (!stack.length) {
            errors.push(`line ${line}: </${tag}> with nothing open — more closing tags than opening.`);
            continue;
        }
        stack.pop();
        continue;
    }
    if (selfClose) continue;

    const isOverlay = OVERLAY.test(attrs);
    if (isOverlay) {
        const ancestor = stack.find((f) => f.isOverlay);
        if (ancestor) {
            errors.push(
                `line ${line}: modal ${label(attrs)} is nested inside modal ${ancestor.label} ` +
                `(opened line ${ancestor.line}).\n` +
                `      A modal inside another modal can never be shown on its own: the outer one\n` +
                `      is display:none until IT is opened. This is what an unclosed <div> looks\n` +
                `      like from the outside — check for a missing </div> above line ${line}.`
            );
        }
    }
    stack.push({ tag, line, label: label(attrs), isOverlay });
}

if (stack.length) {
    errors.push(
        `${stack.length} tag(s) never closed:\n` +
        stack.map((f) => `      line ${String(f.line).padEnd(6)} <${f.tag}> ${f.label}`).join('\n')
    );
}

if (errors.length) {
    console.error('check-html-nesting FAILED — frontend/index.html\n');
    for (const e of errors) console.error(`  - ${e}\n`);
    console.error(
        'An unclosed container silently adopts everything after it. The browser reports\n' +
        'nothing, the app still boots, and features that live further down the file stop\n' +
        'working for reasons that look unrelated to the edit that caused it.'
    );
    process.exit(1);
}

const overlays = (src.match(/class="[^"]*modal-(?:generic-)?overlay/g) || []).length;
console.log(`✓ index.html nesting OK — div/section/main balanced, ${overlays} modal overlay(s), none nested`);
