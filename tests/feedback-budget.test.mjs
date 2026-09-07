// What fits in a feedback submission — against the COMPILED module.
//
// There are two ceilings and they are easy to confuse, because both are "a size in MB" and one
// of them is 4/3 of the other. The app has now got it wrong in both directions:
//
//   · Budgeting only DECODED bytes against maxAttachMB let it build a request a third larger
//     than it believed. Attachments travel base64 inside the JSON, so "25 MB of files, within
//     budget" is a ~34 MB body — and anything in front of the API with a smaller body limit
//     answers a bare `413 Content Too Large`, with no JSON and no explanation, to an app that
//     had already decided it was inside the limit.
//   · Budgeting only ENCODED bytes against maxAttachMB fixed that and broke the other end: the
//     server decodes each attachment and compares the DECODED size to that number, so the app
//     refused files the server was happy to take, at a limit the server itself advertised.
//
// Neither failure raises anything. The first is a 413 nobody can explain; the second is a toast
// saying a file is too big when it is not. So both directions are pinned here, and so is the
// boundary between them — the sizes below are small only so the strings fit in memory; the
// arithmetic is identical at 25 MB.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { attachLimits, decodedLen, fitsBudget } = await import(
    pathToFileURL(join(here, '../frontend/js/features/feedback/feedback-budget.js')).href
);

const MB = 1024 * 1024;
const fresh = () => ({ count: 0, bytes: 0, wire: 0 });
/** A base64 string that decodes to exactly `bytes` bytes, padding and all. */
const b64of = (bytes) => {
    const groups = Math.ceil(bytes / 3);
    const pad = groups * 3 - bytes;               // 0, 1 or 2
    return 'A'.repeat(groups * 4 - pad) + '='.repeat(pad);
};
/** Add an attachment, exactly the way the send path does. */
const put = (used, b64, lim) => {
    if (!fitsBudget(used, b64, lim)) return false;
    used.count += 1; used.bytes += decodedLen(b64); used.wire += b64.length;
    return true;
};

describe('feedback attachment budget', () => {
    test('the fixture is honest: b64of decodes to what it claims', () => {
        // Every case below rests on this. A fixture that is off by a byte would make the
        // boundary tests agree with a wrong implementation.
        for (const n of [0, 1, 2, 3, 4, 5, 100, 999, 1000]) {
            assert.equal(decodedLen(b64of(n)), n, `n=${n}`);
            assert.equal(b64of(n).length % 4, 0, `n=${n} — base64 comes in groups of four`);
        }
    });

    test('the two ceilings come from different fields', () => {
        const lim = attachLimits({ maxAttachments: 6, maxAttachMB: 25, maxRequestMB: 64 });
        assert.equal(lim.maxBytes, 25 * MB);
        assert.equal(lim.maxWire, 64 * MB);
        assert.equal(lim.maxAttachments, 6);
    });

    test('exactly the advertised budget FITS — the server said 1 MB and means it', () => {
        // The regression that budgeting encoded bytes against maxAttachMB introduced: files
        // totalling exactly the advertised limit were refused by the app before the server ever
        // saw them. A budget you cannot fill is a budget that is wrong.
        const lim = attachLimits({ maxAttachments: 6, maxAttachMB: 1, maxRequestMB: 64 });
        assert.equal(put(fresh(), b64of(1 * MB), lim), true, 'exactly 1 MB must fit a 1 MB budget');
        assert.equal(put(fresh(), b64of(1 * MB + 1), lim), false, 'and one byte over must not');
    });

    test('the wire ceiling still bites when it is the smaller one', () => {
        // A server that allows big files but a small request. Without the second check the app
        // packs 25 MB of files into a 34 MB request and takes the 413.
        const lim = attachLimits({ maxAttachments: 6, maxAttachMB: 25, maxRequestMB: 1 });
        const used = fresh();
        // 700 KB of file is ~933 KB on the wire — two of them clear maxAttachMB and blow a 1 MB
        // request.
        assert.equal(put(used, b64of(700 * 1024), lim), true);
        assert.equal(put(used, b64of(700 * 1024), lim), false, 'the second would blow the request ceiling');
        assert.ok(used.bytes < lim.maxBytes, 'and it was NOT the file budget that stopped it');
        assert.ok(used.wire <= lim.maxWire);
    });

    test('the file ceiling still bites when IT is the smaller one', () => {
        const lim = attachLimits({ maxAttachments: 6, maxAttachMB: 2, maxRequestMB: 64 });
        const used = fresh();
        assert.equal(put(used, b64of(1.5 * MB), lim), true);
        assert.equal(put(used, b64of(1.5 * MB), lim), false, '3 MB of files does not fit a 2 MB budget');
        assert.ok(used.wire < lim.maxWire, 'and it was NOT the request ceiling that stopped it');
    });

    test('the count is a ceiling of its own, whatever the sizes are', () => {
        const lim = attachLimits({ maxAttachments: 2, maxAttachMB: 999, maxRequestMB: 999 });
        const used = fresh();
        assert.equal(put(used, b64of(9), lim), true);
        assert.equal(put(used, b64of(9), lim), true);
        assert.equal(put(used, b64of(9), lim), false);
    });

    test('a server that does not publish maxRequestMB gets a ceiling that cannot be too high', () => {
        // An older BCWEB has no such field. Guessing HIGH would reintroduce the 413; the safe
        // reading is the encoded size of a full attachment budget, which is exactly what that
        // server was already accepting.
        const lim = attachLimits({ maxAttachments: 6, maxAttachMB: 1 });
        assert.ok(lim.maxWire >= lim.maxBytes, 'a request is never smaller than its payload');
        assert.equal(lim.maxWire, Math.ceil(1 * 4 / 3) * MB);
        // …and a full budget of files still fits, so the fallback does not refuse what the
        // server would take.
        assert.equal(put(fresh(), b64of(1 * MB), lim), true);
    });

    test('no config at all still yields workable limits rather than zero', () => {
        // fetchFeedbackConfig returns null when BetterCommunity is unreachable, and the report
        // is written offline and queued. A budget of 0 there would silently drop every
        // attachment from a report the user then watches send successfully.
        for (const cfg of [null, undefined, {}]) {
            const lim = attachLimits(cfg);
            assert.ok(lim.maxAttachments > 0 && lim.maxBytes > 0 && lim.maxWire > 0, JSON.stringify(cfg));
        }
    });

    test('decodedLen reads the padding rather than estimating around it', () => {
        // Estimating from the length alone is off by up to two bytes, and those two bytes are
        // visible: a submission of exactly the advertised 25 MB came out over the 25 MB budget.
        assert.equal(decodedLen('AAAA'), 3, 'no padding');
        assert.equal(decodedLen('AAA='), 2, 'one pad character');
        assert.equal(decodedLen('AA=='), 1, 'two pad characters');
        assert.equal(decodedLen(''), 0);
        assert.equal(decodedLen('AA'), 0, 'a truncated group is not a byte and a half');
    });

    test('a single file larger than everything is refused, not truncated', () => {
        const lim = attachLimits({ maxAttachments: 6, maxAttachMB: 1, maxRequestMB: 1 });
        assert.equal(fitsBudget(fresh(), b64of(4 * MB), lim), false);
    });
});
