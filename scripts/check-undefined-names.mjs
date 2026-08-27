// check-undefined-names.mjs — a name that does not exist is an error even in a
// `@ts-nocheck` file.
//
// 38 files in frontend/src carry `// @ts-nocheck`. That comment does not weaken the check
// for those files, it switches it OFF: tsc reports nothing at all about them, including
// names that are not declared anywhere. `tsc --project frontend` was green while
// repo.ts read `repoList` from a function that does not contain it. The button that
// depended on it threw `ReferenceError` on its first click and had never once worked.
//
// The trap is that the code looked defended. `(repoList || [])` reads like a fallback, but
// `||` must evaluate its left side before it can choose, and evaluating an undeclared
// identifier throws. An `undefined` variable falls back; an *undeclared* one does not.
//
// So: re-check the nocheck'd files with the suppression removed, and report exactly one
// diagnostic — TS2304, "Cannot find name". Nothing else. Full type checking on files
// written without it would produce thousands of errors and this gate would be turned off
// within a day; "this name does not exist" is never a style opinion, and always a bug.

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = 'frontend';
const SRC = path.join(ROOT, 'src');

// Walk the sources rather than trusting a glob library to agree with tsconfig's `include`.
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) files.push(p);
  }
})(SRC);
if (!files.length) { console.error('✗ no TypeScript sources found — refusing to report success'); process.exit(2); }

const NOCHECK = /^\s*\/\/\s*@ts-nocheck.*$/m;
const suppressed = files.filter((f) => NOCHECK.test(fs.readFileSync(f, 'utf8')));

const { config } = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);

// Strip the suppression in memory only — nothing on disk is touched. Replaced with a
// same-length blank line so every reported line number still matches the real file.
const patched = new Map(suppressed.map((f) => [
  path.resolve(f),
  fs.readFileSync(f, 'utf8').replace(NOCHECK, ''),
]));

const host = ts.createCompilerHost({ ...parsed.options, noEmit: true });
const readFile = host.readFile.bind(host);
const getSourceFile = host.getSourceFile.bind(host);
host.readFile = (f) => patched.get(path.resolve(f)) ?? readFile(f);
host.getSourceFile = (f, lang, onErr, shouldCreate) => {
  const override = patched.get(path.resolve(f));
  if (override === undefined) return getSourceFile(f, lang, onErr, shouldCreate);
  return ts.createSourceFile(f, override, lang, true);
};

const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true }, host);

// FOUR codes, not one, and the missing three were the common case.
//
// TypeScript reports 2304 for a name it cannot resolve — unless a similar name is in scope,
// in which case it reports 2552, "Cannot find name 'X'. Did you mean 'Y'?". That is exactly
// the shape of the bug this gate exists for: a typo, a renamed export, a helper somebody
// forgot to import next to a sibling with a near-identical name. The gate matched only 2304
// and reported clean on a file calling `showConfirmZZZ`, verified by trying it.
//
// 2662 and 2663 are the same failure inside a class — the name resolves to a member that
// needs `this.` or the class name. All four end the same way at run time: ReferenceError.
const CANNOT_FIND_NAME = new Set([2304, 2552, 2662, 2663]);

// Two kinds of "cannot find name" cannot throw at runtime, and reporting them would make
// this gate fail on correct code — which is how a gate gets deleted. Both were found by
// running it: neither was predicted.
//
// 1. A name in TYPE position. `let ov!: ElementOverride` with no import is a real typing
//    problem, but types are erased before the code runs. It is not this gate's business.
// 2. A name the file itself guards with `typeof NAME`. `typeof` is the one operator that
//    does not throw on an undeclared identifier, so `if (typeof marked !== 'undefined')`
//    is the correct way to reach a global that a <script> tag may or may not have
//    provided. Using it IS the author saying "this may not exist" — a decision, the same
//    way `var(--x, fallback)` is in check-css-vars.
const inTypePosition = (node) => {
  for (let n = node; n; n = n.parent) {
    if (ts.isTypeNode(n) || ts.isTypeReferenceNode(n)) return true;
    // Stop at the first statement/expression boundary: a type inside a call argument
    // would otherwise let a value-position name upstream look like a type.
    if (ts.isStatement(n) || ts.isExpressionStatement(n)) return false;
  }
  return false;
};

const hits = [];
for (const f of suppressed) {
  const sf = program.getSourceFile(path.resolve(f));
  if (!sf) continue;
  const text = sf.getFullText();
  for (const d of program.getSemanticDiagnostics(sf)) {
    if (!CANNOT_FIND_NAME.has(d.code)) continue;
    const pos = d.start ?? 0;
    const name = text.slice(pos, pos + (d.length ?? 0));
    if (new RegExp(`typeof\\s+${name}\\b`).test(text)) continue;
    const node = (function at(n) {
      for (const c of n.getChildren(sf)) {
        if (c.getStart(sf) <= pos && pos < c.getEnd()) return at(c);
      }
      return n;
    })(sf);
    if (inTypePosition(node)) continue;
    const { line } = sf.getLineAndCharacterOfPosition(pos);
    hits.push(`${f}:${line + 1} — ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  }
}

if (!hits.length) {
  console.log(`✓ no undefined names in ${suppressed.length} @ts-nocheck file(s)`);
  process.exit(0);
}
for (const h of hits) console.error(`✗ ${h}`);
console.error(`\n  ${hits.length} name(s) that do not exist, in files tsc was told to skip.`);
console.error('  These throw ReferenceError the first time the line runs. A `x || fallback`');
console.error('  around one does not help: `||` evaluates x before it can fall back.');
process.exit(1);
