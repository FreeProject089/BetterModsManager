// When the report dialog shows an e-mail field, and when it demands one.
//
// The owner, signed in: « ça me dit qu'une adresse mail est requise pour ce rapport alors que
// je suis connecté, et du coup je ne peux même pas en mettre une ». The dialog hid the field
// because a screen said "linked"; the server that received the report did not recognise the
// sender and asked for an address. The rule below is the server's (needsContact in BCWEB
// routes/feedback.mjs), and "linked" only counts when that same server can see it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { contactPolicy, sameOrigin, looksLikeEmail } = await import(pathToFileURL(join(ROOT, 'frontend/js/features/feedback/feedback-contact.js')).href);

describe('contactPolicy', () => {
  test('linked on the receiving server: the account is used, no field, nothing required', () => {
    assert.deepEqual(contactPolicy({ state: 'linked', sameServer: true, requireContact: true }), { account: true, required: false });
  });
  test('not linked on a project that asks for a contact: the field is required', () => {
    assert.deepEqual(contactPolicy({ state: 'anonymous', sameServer: true, requireContact: true }), { account: false, required: true });
    assert.deepEqual(contactPolicy({ state: 'unknown', sameServer: true, requireContact: true }), { account: false, required: true });
  });
  test('not linked on a project that does not ask: shown, optional', () => {
    assert.deepEqual(contactPolicy({ state: 'anonymous', sameServer: true, requireContact: false }), { account: false, required: false });
  });
  test('linked on ANOTHER server does not count (the reported bug)', () => {
    assert.deepEqual(contactPolicy({ state: 'linked', sameServer: false, requireContact: true }), { account: false, required: true });
  });
  test('a refused key does not count either', () => {
    assert.deepEqual(contactPolicy({ state: 'linked', pinProblem: 'key_fork', sameServer: true, requireContact: true }), { account: false, required: true });
  });
});

describe('helpers', () => {
  test('sameOrigin compares scheme, host and port', () => {
    assert.equal(sameOrigin('https://bettercommunity.ch/api/feedback/bmm', 'https://bettercommunity.ch'), true);
    assert.equal(sameOrigin('https://bettercommunity.ch/api/feedback/bmm', 'http://localhost:5176'), false);
    assert.equal(sameOrigin('not a url', 'not a url'), false);
  });
  test('looksLikeEmail', () => {
    assert.equal(looksLikeEmail('me@example.org'), true);
    assert.equal(looksLikeEmail('me@example'), false);
    assert.equal(looksLikeEmail('me example.org'), false);
    assert.equal(looksLikeEmail(''), false);
  });
});

describe('the dialog', () => {
  const src = readFileSync(join(ROOT, 'frontend/src/features/feedback/feedback-modal.ts'), 'utf8');
  test('the e-mail field is always in the page, hidden while the account is used', () => {
    assert.match(src, /id="fbm-contact-fields" \$\{linked \? 'hidden' : ''\}/);
    assert.match(src, /id="fbm-email"/);
  });
  test('a contact_required answer reveals the field instead of only saying so', () => {
    assert.match(src, /e\.code === 'contact_required'[\s\S]{0,80}revealContact\(true\)/);
  });
});
