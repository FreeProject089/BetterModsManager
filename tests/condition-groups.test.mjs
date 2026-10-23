// Boolean groups in the scheduler's conditions.
//
// Until now every condition answered about ONE thing, which is right — what was missing was
// a way to say "these together". "When the game is closed AND it is after 18:00 AND a backup
// exists" had to be written as three nested ifs, each with its own else, and the moment one
// of them needed an OR it became a switch whose cases repeated most of each other.
//
// `all` and `any` hold a list in `params.of` and are themselves conditions, so they nest;
// `negate`, which every condition already had, gives NOT. That is the whole of boolean
// algebra in two more types.
//
// The evaluator lives inside scheduler.ts, which is 5000 lines of browser code and cannot be
// imported here. So this tests the LOGIC as written — the same short-circuiting walk — and
// the assertions are about the decisions somebody could get wrong: what an empty group
// means, and whether a group stops early.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/** The `all` / `any` cases from evalConditionRaw, with the leaf evaluation injected. */
async function evalCondition(cond, leaf) {
    const raw = async () => {
        const of = Array.isArray(cond.params?.of) ? cond.params.of : [];
        if (cond.type === 'all') {
            for (const c of of) { if (!(await evalCondition(c, leaf))) return false; }
            return true;
        }
        if (cond.type === 'any') {
            for (const c of of) { if (await evalCondition(c, leaf)) return true; }
            return false;
        }
        return leaf(cond);
    };
    const r = await raw();
    return cond.negate ? !r : r;
}

const yes = { type: 'always', params: {} };
const no = { type: 'always', params: {}, negate: true };
const leaf = (c) => c.type === 'always';

describe('all', () => {
    test('true only when every one holds', async () => {
        assert.equal(await evalCondition({ type: 'all', params: { of: [yes, yes] } }, leaf), true);
        assert.equal(await evalCondition({ type: 'all', params: { of: [yes, no] } }, leaf), false);
    });

    test('an EMPTY group is true', async () => {
        // The standard reading, and the one that makes a half-built group in the editor
        // behave predictably: adding an "all" and not filling it in yet must not block the
        // task somebody is in the middle of writing.
        assert.equal(await evalCondition({ type: 'all', params: { of: [] } }, leaf), true);
        assert.equal(await evalCondition({ type: 'all', params: {} }, leaf), true);
    });

    test('THE ONE: it stops at the first false', async () => {
        // Not an optimisation. A condition can run a command or reach the network, and
        // "A AND B" must not run B when A has already decided.
        const seen = [];
        const spy = (c) => { seen.push(c.type); return c.type === 'yes'; };
        await evalCondition({ type: 'all', params: { of: [{ type: 'no' }, { type: 'expensive' }] } }, spy);
        assert.deepEqual(seen, ['no'], 'the second condition was evaluated after the first failed');
    });
});

describe('any', () => {
    test('true when one holds', async () => {
        assert.equal(await evalCondition({ type: 'any', params: { of: [no, yes] } }, leaf), true);
        assert.equal(await evalCondition({ type: 'any', params: { of: [no, no] } }, leaf), false);
    });

    test('an EMPTY group is false', async () => {
        // The mirror of `all`: "at least one of nothing" is not satisfied.
        assert.equal(await evalCondition({ type: 'any', params: { of: [] } }, leaf), false);
    });

    test('it stops at the first true', async () => {
        const seen = [];
        const spy = (c) => { seen.push(c.type); return c.type === 'yes'; };
        await evalCondition({ type: 'any', params: { of: [{ type: 'yes' }, { type: 'expensive' }] } }, spy);
        assert.deepEqual(seen, ['yes']);
    });
});

describe('composition', () => {
    test('a group nests inside a group', async () => {
        // A and (B or C) — the shape that used to need a switch with repeated cases.
        const cond = {
            type: 'all',
            params: { of: [yes, { type: 'any', params: { of: [no, yes] } }] },
        };
        assert.equal(await evalCondition(cond, leaf), true);
    });

    test('NOT applies to the whole group, not to its first member', async () => {
        // negate is read after the group resolves. Applied per-member it would turn
        // "not (A and B)" into "(not A) and B", which is a different question.
        const notAllTrue = { type: 'all', params: { of: [yes, yes] }, negate: true };
        assert.equal(await evalCondition(notAllTrue, leaf), false);
        const notAllOfMixed = { type: 'all', params: { of: [yes, no] }, negate: true };
        assert.equal(await evalCondition(notAllOfMixed, leaf), true);
    });

    test('three levels deep still resolves', async () => {
        const cond = { type: 'any', params: { of: [
            { type: 'all', params: { of: [yes, { type: 'any', params: { of: [no, no] } }] } },
            { type: 'all', params: { of: [yes, yes] } },
        ] } };
        assert.equal(await evalCondition(cond, leaf), true);
    });

    test('a malformed group is not a crash', async () => {
        // `of` written as an object, or missing — the editor can produce neither, but a
        // hand-edited .bmmpa can.
        assert.equal(await evalCondition({ type: 'all', params: { of: 'nope' } }, leaf), true);
        assert.equal(await evalCondition({ type: 'any', params: { of: null } }, leaf), false);
    });
});
