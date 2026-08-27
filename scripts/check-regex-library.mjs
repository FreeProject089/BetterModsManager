// Every pattern on the shelf must compile, and must capture something.
//
// A pattern with no group matches and stores nothing, which on screen is indistinguishable
// from a pattern that did not match — the exact confusion this shelf exists to remove.
import fs from 'node:fs';

const src = fs.readFileSync('frontend/src/features/settings/scheduler.ts', 'utf8');
const block = src.match(/const REGEX_LIBRARY[^=]*= \[([\s\S]*?)\n\];/);
if (!block) { console.error('REGEX_LIBRARY not found'); process.exit(2); }

const rows = [...block[1].matchAll(/\{ label: '([^']+)', re: '((?:[^'\\]|\\.)*)' \}/g)];
let bad = 0;
for (const [, label, raw] of rows) {
  // The source is a JS single-quoted literal; unescape it the way the compiler will.
  const re = raw.replace(/\\'/g, "'");
  try {
    const rx = new RegExp(re);
    // The reliable count: appending an empty alternative makes the whole pattern match the
    // empty string, so exec always returns an array whose length is 1 + the number of
    // CAPTURING groups. Looking for an opening bracket counts non-capturing ones too.
    void rx;
    const groups = new RegExp(re + '|').exec('').length - 1;
    if (groups < 1) { console.log('NO CAPTURE GROUP:', label, re); bad++; }
  } catch (e) { console.log('INVALID:', label, re, '—', e.message); bad++; }
}
console.log(`${rows.length} patterns, ${bad} problem(s)`);
process.exit(bad ? 1 : 0);
