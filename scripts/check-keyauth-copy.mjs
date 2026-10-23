// The key verifier a generated server runs must be the SAME FILE BetterCommunity runs.
//
// A generated standalone server and the platform both decide whether a client holds an
// authorised key. Two implementations of that would be two chances to disagree — and the way
// they disagree is that a proof works against one server and not the other, which reads to
// the person holding the key as "my key is broken".
//
// So the template is a byte-for-byte copy rather than a port, and this is what keeps it one.
// It fails loudly when they drift and says nothing when BCW is not checked out beside BMM,
// because that is an ordinary state for someone working on BMM alone.

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const template = path.join(here, '..', 'src-tauri', 'src', 'templates', 'mini-server', 'keyauth.mjs.template');
const source = path.join(here, '..', 'BCW', 'BCWEB', 'apps', 'api', 'src', 'lib', 'keyauth.mjs');

if (!existsSync(template)) {
  console.error('✗ keyauth.mjs.template is missing — a generated server cannot check keys without it');
  process.exit(1);
}
if (!existsSync(source)) {
  console.log('• keyauth copy: BCW not checked out here, nothing to compare against');
  process.exit(0);
}

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const a = sha(source), b = sha(template);
if (a !== b) {
  console.error('✗ keyauth verifier has drifted between BCWEB and the server template.');
  console.error(`    BCWEB    ${path.relative(process.cwd(), source)}   ${a.slice(0, 16)}`);
  console.error(`    template ${path.relative(process.cwd(), template)} ${b.slice(0, 16)}`);
  console.error('  They must be identical. Copy the BCWEB file over the template — and if the');
  console.error('  change was made in the template, move it to BCWEB first: that one is the source.');
  process.exit(1);
}
console.log('✓ keyauth verifier is byte-identical in BCWEB and the server template');
