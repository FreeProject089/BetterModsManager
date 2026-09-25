// C8-C: BetterCommunity's key-pin refusals reach the Settings identity card.
//
// BCWEB refuses a creator proof with `key_fork`, `key_retired` or `upgraded_key_required`
// when it does not match the chain pinned for the id on first sight. bc-link.ts swallowed
// every failure of `/api/link/upgrade` as "offline, try again next time", so somebody
// else's chain could hold this install's id and nothing on screen ever said so.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const PROBLEMS = ['key_fork', 'key_retired', 'upgraded_key_required'];

describe('the refusal is recognised', () => {
    test('pinProblemOf reads the three pin errors out of a bc_api_post rejection, and nothing else', async () => {
        const { pinProblemOf, KEY_PIN_PROBLEMS } = await import(pathToFileURL(join(ROOT, 'frontend/js/core/key-pin.js')).href);
        assert.deepEqual([...KEY_PIN_PROBLEMS].sort(), [...PROBLEMS].sort());
        for (const p of PROBLEMS) {
            assert.equal(pinProblemOf(JSON.stringify({ error: p })), p);
            assert.equal(pinProblemOf(new Error(JSON.stringify({ error: p }))), p);
        }
        // Not fixable by resetting a pin, so not shown as if they were.
        for (const other of ['{"error":"replayed"}', '{"error":"invalid"}', '{"error":"unavailable"}', 'http_403', '', 'not json']) {
            assert.equal(pinProblemOf(other), null, other);
        }
        assert.equal(pinProblemOf(undefined), null);
    });
});

describe('bc-link keeps the refusal instead of swallowing it', () => {
    const src = read('frontend/src/core/bc-link.ts');
    const body = (sig) => {
        const s = src.indexOf(sig);
        assert.ok(s >= 0, `${sig} not found in bc-link.ts`);
        return src.slice(s, src.indexOf('\n}\n', s));
    };
    test('registerKeyV5 records a pin refusal and clears it on success', () => {
        const b = body('async function registerKeyV5');
        const c = b.slice(b.indexOf('catch'));
        assert.match(c, /pinProblemOf\(e\)/, 'the upgrade failure is not read for a pin refusal');
        assert.match(c, /recordPinProblem\(pin\b/, 'the upgrade failure is not recorded');
        assert.match(b, /clearPinProblem\(\)/, 'an accepted upgrade does not clear the old refusal');
    });
    test('the pairing request says it was a pin refusal, not "offline"', () => {
        const b = body('export async function openAccountLinkFlow');
        assert.match(b, /pinProblemOf\(/);
        assert.match(b, /result:\s*'pin'/);
    });
    test('the link state carries the stored refusal', () => {
        // Every return goes through withPin, which is what reads the stored refusal.
        const b = body('export async function bcLinkState');
        assert.equal((b.match(/return withPin\(/g) || []).length, (b.match(/\breturn\b/g) || []).length,
            'a return of bcLinkState skips withPin');
        assert.match(body('function withPin'), /readPinProblem\(\)/);
    });
});

describe('the identity card shows each refusal and the way out', () => {
    const settings = read('frontend/src/features/settings/settings.ts');
    const en = JSON.parse(read('frontend/Lang/en.json'));
    const fr = JSON.parse(read('frontend/Lang/fr.json'));
    test('one sentence per refusal, in both languages', () => {
        for (const p of PROBLEMS) {
            const key = `settings.link.pin.${p}`;
            assert.ok(settings.includes(`'${key}'`), `settings.ts never says ${key}`);
            assert.ok(en[key] && fr[key] && en[key] !== fr[key], `${key} missing or untranslated`);
        }
    });
    test('the card links to where the owner resets the pin', () => {
        const s = settings.indexOf('function renderKeyPinProblem');
        assert.ok(s >= 0, 'renderKeyPinProblem not found');
        const b = settings.slice(s, settings.indexOf('\n}\n', s));
        assert.match(b, /open_external_url/);
        assert.match(b, /\/profile/);
        assert.ok(en['settings.link.pin.reset'] && fr['settings.link.pin.reset']);
    });
});
