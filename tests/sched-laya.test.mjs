// Laya's building blocks in a scheduled task (Oct 2026): the actions `ai.classify_mod`,
// `ai.library_check`, `ai.crash_label`, `ai.explain_crash`, `ai.triage_report`, `ai.run_task`,
// `ai.status`; the conditions `aiScore`, `aiAbstained`, `aiAvailable`, `crashCause`,
// `aiLibraryCount`, `modAiTag`; the `onEvent` filter and the three Laya events.
//
// The rules each must keep, and what this file pins:
//   · the `ai` grant before Laya is called, the run's budget for every step that runs a model;
//   · the master switch (Rust: commands/ai_ops.rs tests — `local_only`, `laya_state`);
//   · nothing a model made up reaches a variable: causes, kinds, tags are re-checked here;
//   · free text (the crash explanation) is tainted, the rest is not;
//   · the per-area answer settings (abstain, flagged guess) survive into the variables.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(join(ROOT, 'frontend/js', p)).href);
const L = await load('features/settings/sched-laya.js');
const A = await load('features/settings/sched-ai.js');
const V = await load('features/settings/sched-vars.js');
const F = await load('features/settings/sched-flow-model.js');
const T = await load('features/settings/sched-test.js');
const P = await load('features/settings/sched-preview.js');
const D = await load('features/settings/sched-debug-map.js');
const M = await load('features/ai/laya-assist-model.js');
const sched = readFileSync(join(ROOT, 'frontend/src/features/settings/scheduler.ts'), 'utf8');
const en = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/en.json'), 'utf8'));
const fr = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/fr.json'), 'utf8'));

const NEW_STEPS = ['ai.run_task', 'ai.classify_mod', 'ai.library_check', 'ai.crash_label', 'ai.explain_crash', 'ai.triage_report', 'ai.status'];
const BUDGETED = NEW_STEPS.filter((s) => s !== 'ai.status');
const ctx = () => ({ nums: {}, text: {}, lists: {}, maps: {} });

/** The body of one `case` of runAction, up to its `break;`. */
function caseBody(type) {
    const run = sched.slice(sched.indexOf('async function runAction'));
    const at = run.indexOf(`case '${type}':`);
    assert.ok(at > 0, `${type} has no case in runAction`);
    return run.slice(at, run.indexOf('break;', at));
}

describe('the grant and the budget', () => {
    test('every new step asks for the `ai` grant before it calls anything', () => {
        for (const type of NEW_STEPS) {
            const body = caseBody(type);
            const perm = body.indexOf("requirePerm(task, 'ai'");
            const call = body.search(/aiCall\(|invoke\(/);
            assert.ok(perm >= 0 && call > perm, `${type}: requirePerm('ai') must come before the call`);
        }
    });
    test('every step that runs a model takes a step of the run budget; the state read does not', () => {
        for (const type of BUDGETED) assert.match(caseBody(type), /await aiCall\(ctx,/, `${type} must go through aiCall`);
        assert.doesNotMatch(caseBody('ai.status'), /aiCall\(/, 'ai.status runs no model and costs no budget');
    });
    test('the budget refuses the 21st Laya step of a run, whichever step it is', () => {
        const c = {};
        for (let i = 0; i < A.AI_MAX_STEPS; i++) assert.equal(A.takeAiStep(c), null);
        assert.equal(A.takeAiStep(c), 'steps');
    });
    test('a remote writer needs the network grant on top', () => {
        const body = caseBody('ai.explain_crash');
        assert.ok(body.indexOf("requirePerm(task, 'network'") > 0 && body.indexOf("requirePerm(task, 'network'") < body.indexOf('aiCall('));
        const needs = F.permNeeds([{ kind: 'action', action: { type: 'ai.explain_crash', params: { allowRemote: true } } }]);
        assert.deepEqual(needs.map((n) => n.perm).sort(), ['ai', 'network']);
        assert.deepEqual(F.permNeeds([{ kind: 'action', action: { type: 'ai.explain_crash', params: {} } }]).map((n) => n.perm), ['ai']);
    });
    test('the flow knows every new step and the condition that reaches out need `ai`', () => {
        for (const type of NEW_STEPS) assert.equal(F.ACTION_PERMS[type]?.perm, 'ai', type);
        assert.equal(F.CONDITION_PERMS.aiAvailable?.perm, 'ai');
        const cond = sched.slice(sched.indexOf("case 'aiAvailable':"), sched.indexOf("case 'aiAvailable':") + 400);
        assert.ok(cond.indexOf("needPerm('ai'") >= 0 && cond.indexOf("needPerm('ai'") < cond.indexOf('invoke('), 'aiAvailable asks before it invokes');
    });
    test('a refusal from Rust (AI off) reads as words, in both languages', () => {
        assert.deepEqual(A.aiErrorParts(new Error('ai.task.blocked|ai_off')), ['ai.task.blocked', 'ai_off']);
        for (const k of ['ai.task.blocked', 'ai.task.why.ai_off', 'ai.task.why.no_provider', 'ai.task.noWriter', 'ai.task.remoteWriter', 'ai.task.noCrash']) {
            assert.ok(en[k] && fr[k], `${k} must exist in en and fr`);
        }
    });
});

describe('taint', () => {
    test('the crash explanation is free text: tainted, and refused where it would act', () => {
        assert.match(caseBody('ai.explain_crash'), /taint\(ctx, 'ai\.explanation', 'last\.out'/);
        const c = {};
        A.taint(c, 'ai.explanation');
        assert.equal(A.taintProblem('custom.command', { program: '{ai.explanation}' }, c), 'program');
        assert.equal(A.taintProblem('notify', { message: 'Laya: {ai.explanation}' }, c), null);
    });
    test('a tainted reference cannot pick the mod, the report or the file a Laya step reads', () => {
        const c = {};
        A.taint(c, 'answer');
        assert.equal(A.taintProblem('ai.classify_mod', { id: '{answer}' }, c), 'id');
        assert.equal(A.taintProblem('ai.explain_crash', { report: '{answer}' }, c), 'report');
        assert.equal(A.taintProblem('ai.triage_report', { path: '{answer}' }, c), 'path');
        assert.equal(A.taintProblem('ai.triage_report', { text: 'is this a bug? {answer}' }, c), null, 'its text may be read');
    });
    test('the new conditions only compare: a tainted value is accepted there', () => {
        const c = {};
        A.taint(c, 'answer');
        const cases = {
            aiScore: { var: '{answer}', label: '{answer}', value: '{answer}' },
            aiAbstained: { var: '{answer}' },
            crashCause: { field: 'family', value: '{answer}' },
            aiLibraryCount: { kind: 'findings', value: '{answer}' },
            modAiTag: { id: '{answer}', tag: '{answer}' },
        };
        for (const [type, params] of Object.entries(cases)) assert.equal(A.condTaintProblem(type, params, c), null, type);
        assert.equal(A.condTaintProblem('aiScore', { path: '{answer}' }, c), 'path', 'a field the condition does not have is still refused');
    });
    test('the other Laya steps are clean: they never call taint()', () => {
        for (const type of ['ai.run_task', 'ai.classify_mod', 'ai.library_check', 'ai.crash_label', 'ai.triage_report', 'ai.status']) {
            assert.doesNotMatch(caseBody(type), /\btaint\(/, type);
        }
    });
});

describe('the onEvent filter', () => {
    test('key=value, | between choices, every key must match', () => {
        const data = { family: 'disk', cause: 'disk_full', p: 0.8, abstained: false };
        assert.equal(L.eventMatches('', data), true, 'no filter = every event');
        assert.equal(L.eventMatches('family=disk', data), true);
        assert.equal(L.eventMatches('family=DISK|memory', data), true, 'case-insensitive');
        assert.equal(L.eventMatches('family=memory', data), false);
        assert.equal(L.eventMatches('family=disk, abstained=false', data), true);
        assert.equal(L.eventMatches('family=disk, cause=permission', data), false);
        assert.equal(L.eventMatches('event.family=disk', data), true, 'the event. prefix is accepted');
        assert.equal(L.eventMatches('missing=x', data), false, 'a key the event does not carry does not match');
        assert.equal(L.eventMatches('nonsense', data), true, 'a part with no = is ignored');
        assert.equal(L.eventMatches('family=disk', null), false);
    });
    test('the trigger keeps it: the type, the poll, and BMMScript', () => {
        assert.match(sched, /\{ type: 'onEvent'; event: string; where\?: string \}/);
        assert.match(sched, /eventMatches\(tr\.where, h\?\.data\)/);
        const rs = readFileSync(join(ROOT, 'src-tauri/src/commands/bmms.rs'), 'utf8');
        assert.match(rs, /eat_word\("where"\)/);
    });
    test('the three Laya events are offered, named, and their variables known', () => {
        const ev = readFileSync(join(ROOT, 'frontend/src/core/bmm-events.ts'), 'utf8');
        for (const e of ['bmm.ai.crashLabelled', 'bmm.ai.crashGroup', 'bmm.ai.ready']) {
            assert.ok(ev.includes(`'${e}'`), e);
            assert.ok(en['sched.ev.' + e] && fr['sched.ev.' + e], e);
        }
        const vars = D.variablesOf([], { type: 'onEvent', event: 'bmm.ai.crashLabelled' }).map((v) => v.name);
        for (const n of ['event.family', 'event.cause', 'event.p', 'event.report']) assert.ok(vars.includes(n), n);
        assert.ok(D.variablesOf([], { type: 'onEvent', event: 'bmm.ai.ready' }).some((v) => v.name === 'event.what'));
        const rs = readFileSync(join(ROOT, 'src-tauri/src/commands/ai_embedded.rs'), 'utf8');
        assert.match(rs, /"bmm\.ai\.ready"/);
    });
    test('the variable picker offers what a Laya step writes, under its fixed names', () => {
        const names = (type) => D.variablesOf([{ kind: 'action', action: { type, params: {} } }], { type: 'manual' }).map((v) => v.name);
        for (const n of ['ai.crash.family', 'ai.crash.count', 'ai.crashes']) assert.ok(names('ai.crash_label').includes(n), n);
        assert.ok(names('ai.run_task').includes('ai.scores'), 'a custom task is a sort');
        assert.ok(names('ai.library_check').includes('ai.library.untagged'));
        assert.ok(!names('notify').some((n) => n.startsWith('ai.')), 'no Laya step, no Laya names');
    });
});

describe('sorts: scores and abstentions', () => {
    test('scores keep the task’s labels only, as probabilities', () => {
        const s = L.scoresOf([{ label: 'crash', p: 0.7 }, { label: 'ui', p: 1.4 }, { label: 'rm -rf /', p: 0.99 }, { label: 'none', p: 0.1 }], ['crash', 'ui']);
        assert.deepEqual(s, { crash: '0.7', ui: '1', none: '0.1' });
        assert.equal(L.scoresName(''), 'ai.scores');
        assert.equal(L.scoresName('kind'), 'kind.scores');
    });
    test('aiScore compares any label’s score, not only the winner’s', () => {
        const c = ctx();
        c.maps['ai.scores'] = { crash: '0.7', ui: '0.25' };
        c.maps['kind.scores'] = { ui: '0.9' };
        assert.equal(L.aiScoreHolds(c, { label: 'UI', op: '>=', value: 0.2 }), true);
        assert.equal(L.aiScoreHolds(c, { label: 'ui', op: '>', value: 0.3 }), false);
        assert.equal(L.aiScoreHolds(c, { label: 'crash', op: '<', value: 0.5 }), false);
        assert.equal(L.aiScoreHolds(c, { var: 'kind', label: 'ui', value: 0.8 }), true);
        assert.equal(L.aiScoreHolds(c, { label: 'absent', op: '<', value: 0.1 }), true, 'a label Laya did not rank scores 0');
        assert.equal(L.aiScoreHolds(ctx(), { label: 'crash', value: 0 }), false, 'no sort yet');
    });
    test('aiAbstained reads <var>.abstained (ai, ai.mod, ai.report)', () => {
        const c = ctx();
        c.nums['ai.abstained'] = 1; c.nums['ai.mod.abstained'] = 0;
        assert.equal(L.aiAbstainedHolds(c, {}), true);
        assert.equal(L.aiAbstainedHolds(c, { var: 'ai.mod' }), false);
        assert.equal(L.aiAbstainedHolds(c, { var: 'ai.report' }), false, 'nothing written = no');
    });
    test('the runner writes abstention and scores for a sort', () => {
        const ks = sched.slice(sched.indexOf('function keepSort'), sched.indexOf('function keepSort') + 1500);
        assert.match(ks, /ctx\.nums\['ai\.abstained'\] = abst/);
        assert.match(ks, /res\?\.abstained === true \|\| label === 'none'/, 'Laya’s « je ne sais pas » (the area setting) is an abstention');
        assert.match(caseBody('ai.run_task'), /task: lt/);
    });
});

describe('a mod’s tags', () => {
    test('only well-formed tags, applied ones among them, flagged guesses kept as such', () => {
        const c = L.modClassOf({ tags: [{ id: 't1', name: 'Maps', p: 0.9 }, { id: 't2', name: 'Sounds', p: 0.55, uncertain: true }, { id: 3, name: 'bad' }, { name: 'no id' }], adult: true, adultP: 0.8, applied: ['t1', 'zz'], autoApply: true });
        assert.deepEqual(c.tags.map((t) => t.id), ['t1', 't2']);
        assert.deepEqual(c.applied, ['t1'], 'an applied id that is not one of the tags is dropped');
        assert.equal(L.topTag(c), 'Maps', 'the category is the best SURE tag');
        assert.equal(L.topTag(L.modClassOf({ tags: [{ id: 'x', name: 'X', p: 0.5, uncertain: true }] })), 'none');
        assert.equal(L.modClassOf({}).abstained, true);
    });
    test('modAiTag: by id or name, the last mod when none is named, never a flagged guess', () => {
        const c = ctx();
        L.rememberModTags(c, 'm1', L.modClassOf({ tags: [{ id: 't1', name: 'Maps', p: 0.9 }, { id: 't2', name: 'Sounds', p: 0.5, uncertain: true }] }));
        assert.equal(L.modAiTagHolds(c, { tag: 'maps' }), true);
        assert.equal(L.modAiTagHolds(c, { id: 'm1', tag: 't1' }), true);
        assert.equal(L.modAiTagHolds(c, { tag: 'Sounds' }), false);
        assert.equal(L.modAiTagHolds(c, { id: 'm2', tag: 'Maps' }), false);
        assert.equal(L.modAiTagHolds(ctx(), { tag: 'Maps' }), false);
    });
    test('the step applies only through Rust, which applies only « apply without asking » tags', () => {
        assert.match(caseBody('ai.classify_mod'), /invoke\('ai_task_classify_mod', \{ modId: id, apply: p\.apply === true \}\)/);
        const rs = readFileSync(join(ROOT, 'src-tauri/src/commands/ai_ops.rs'), 'utf8');
        assert.match(rs, /if auto_apply && s\.applicable && !s\.uncertain/);
        assert.match(rs, /settings\.laya\.resolve\(ai_tuning::Area::Library\)\.auto_apply/);
    });
    test('a Test of the step that may write tags asks first, and the preview says so', () => {
        assert.equal(T.testNeedsConfirm({ kind: 'action', action: { type: 'ai.classify_mod', params: { apply: true } } }), true);
        assert.equal(T.testNeedsConfirm({ kind: 'action', action: { type: 'ai.classify_mod', params: {} } }), false);
        const plan = P.planOf([{ kind: 'action', action: { type: 'ai.classify_mod', params: { id: 'm1', apply: true } } }]);
        assert.deepEqual(plan, [{ what: 'tags', id: 'm1', certain: false }]);
        assert.deepEqual(P.planOf([{ kind: 'action', action: { type: 'ai.classify_mod', params: { id: 'm1' } } }]), []);
        assert.ok(en['sched.prev.w.tags'] && fr['sched.prev.w.tags']);
    });
});

describe('the library check', () => {
    const res = {
        total: 40,
        untagged: [{ id: 'u1', name: 'Clouds' }, { id: 'u2', name: 'Trees' }],
        duplicates: [{ a: { id: 'a', name: 'Sky' }, b: { id: 'b', name: 'sky v2' } }],
        conflicts: [{ a: { id: 'c', name: 'HUD' }, b: { id: 'd', name: 'HUD+' } }],
        suggested: [{ id: 'u1', name: 'Clouds', tags: ['Weather'] }],
    };
    test('counts, readable lines, and the ids a for each can walk', () => {
        const v = L.libraryOf(res);
        assert.deepEqual(v.counts, { total: 40, untagged: 2, duplicates: 1, conflicts: 1, suggested: 1, findings: 4 });
        assert.deepEqual(v.untaggedIds, ['u1', 'u2']);
        assert.deepEqual(v.duplicateIds, ['b']);
        assert.ok(v.lines.includes('duplicate: Sky / sky v2'));
        assert.ok(v.lines.some((l) => l.startsWith('suggested tags: Clouds → Weather')));
        assert.deepEqual(L.libraryOf(null).counts.findings, 0);
    });
    test('aiLibraryCount compares one count (>= 1 by default)', () => {
        const c = ctx();
        c.nums['ai.lib.findings'] = 4; c.nums['ai.lib.duplicates'] = 0;
        assert.equal(L.libraryCountHolds(c, {}), true);
        assert.equal(L.libraryCountHolds(c, { kind: 'duplicates' }), false);
        assert.equal(L.libraryCountHolds(c, { kind: 'findings', op: '>', value: 4 }), false);
        assert.equal(L.libraryCountHolds(c, { kind: 'conflicts' }), false, 'no check yet');
        assert.equal(L.libraryCountHolds(c, { kind: 'evil' }), true, 'an unknown kind is « findings »');
    });
    test('a for each over a list of ids reaches {item.id}', () => {
        assert.match(sched, /typeof item === 'string' \? \{ id: item, name: item \}/);
    });
});

describe('crash labels', () => {
    const res = { items: [
        { report: 'a.zip', date: 10, cause: 'disk_full', family: 'disk', p: 0.81 },
        { report: 'b.zip', date: 30, cause: 'format c:', family: 'evil', p: 0.99 },
        { report: 'c.zip', date: 20, cause: 'mod_conflict', p: 0.4, uncertain: true, cached: true },
    ], newest: 30, pending: 0 };
    test('a cause outside the fixed list is unknown, and its family is recomputed', () => {
        const items = L.crashItemsOf(res, M.CAUSE_FAMILY);
        assert.deepEqual(items.map((c) => [c.cause, c.family, c.abstained]), [['disk_full', 'disk', false], ['unknown', 'unknown', true], ['mod_conflict', 'mod_files', false]]);
        assert.equal(items[1].p, 0, 'no probability for « unknown »');
        const sum = L.crashSummary(items);
        assert.equal(sum.latest.report, 'b.zip');
        assert.deepEqual([sum.count, sum.unknown], [3, 1]);
        assert.deepEqual(L.crashLines(items), ['a.zip: disk/disk_full (81%)', 'b.zip: unknown/unknown', 'c.zip: mod_files/mod_conflict (40%) ?']);
    });
    test('crashCause: latest, any, with a minimum, and from the event when nothing ran', () => {
        const c = ctx();
        L.rememberCrashes(c, L.crashItemsOf(res, M.CAUSE_FAMILY));
        assert.equal(L.crashCauseHolds(c, { field: 'family', value: 'disk' }), false, 'the latest is b.zip (unknown)');
        assert.equal(L.crashCauseHolds(c, { field: 'family', value: 'disk', scope: 'any' }), true);
        assert.equal(L.crashCauseHolds(c, { field: 'cause', value: 'mod_conflict', scope: 'any', min: 0.5 }), false);
        assert.equal(L.crashCauseHolds(c, { field: 'family', value: 'unknown', scope: 'any' }), false, 'an abstention is not a cause');
        const ev = ctx();
        ev.text['event.family'] = 'memory'; ev.text['event.p'] = '0.7'; ev.text['event.abstained'] = 'false';
        assert.equal(L.crashCauseHolds(ev, { field: 'family', value: 'memory', min: 0.6 }), true);
        assert.equal(L.crashCauseHolds(ev, { field: 'family', value: 'memory', min: 0.8 }), false);
        assert.equal(L.crashCauseHolds(ctx(), { field: 'family', value: 'disk' }), false);
    });
    test('the first run looks back 7 days, later runs from where they stopped', () => {
        assert.equal(L.crashSince({}, 't1', 1_000_000), 1_000_000 - L.FIRST_LOOK_SECS);
        assert.equal(L.crashSince({ t1: 500 }, 't1', 1_000_000), 500);
        assert.equal(L.crashSince({ t1: 'x' }, 't1', 100), 0);
    });
    test('a new failure is one new group, even twice in one call', () => {
        const a = { reason: 'panicked at index out of bounds in mods scan' };
        const b = { reason: 'panicked at index out of bounds in mods scan (again)' };
        const z = { reason: 'access is denied writing profile' };
        const g = M.newCrashGroups([], [a, b, z]);
        assert.deepEqual(g.fresh, [0, 2]);
        assert.deepEqual(M.newCrashGroups(g.seen, [b]).fresh, [], 'remembered');
        assert.ok(M.newCrashGroups(Array.from({ length: 150 }, (_, i) => [`w${i}`, `x${i}`]), [z]).seen.length <= M.SEEN_GROUPS_MAX);
    });
    test('the step rings the events through the shared helper and keeps its marker per task', () => {
        const body = caseBody('ai.crash_label');
        assert.match(body, /announceCrashLabels\(items\)/);
        assert.match(body, /writeCrashMarker\(task\.id/);
        const page = readFileSync(join(ROOT, 'frontend/src/features/ai/laya-crash.ts'), 'utf8');
        assert.match(page, /announceCrashLabels\(told\)/, 'the crash page rings them too');
    });
});

describe('triage and state', () => {
    test('triage keeps the fixed lists only', () => {
        const r = L.triageOf({ kind: { label: 'bug', p: 0.7 }, area: { label: 'rm -rf', p: 0.9 } }, M.REPORT_KINDS, M.APP_AREAS);
        assert.deepEqual(r.kind, { label: 'bug', p: 0.7, abstained: false, uncertain: false });
        assert.deepEqual(r.area, { label: 'none', p: 0, abstained: true, uncertain: false });
        assert.equal(L.triageOf({ kind: { label: 'bug', p: 0.4, abstained: true } }, M.REPORT_KINDS, M.APP_AREAS).kind.label, 'none');
    });
    test('the state and the aiAvailable condition', () => {
        const off = L.stateOf({ enabled: false, provider: 'embedded', installed: true });
        assert.equal(L.statusHolds(off, 'available'), false);
        assert.equal(L.statusHolds(off, 'installed'), true);
        const on = L.stateOf({ enabled: true, available: true, loaded: true, writer: true, provider: 'nonsense' });
        assert.equal(on.provider, 'none');
        assert.equal(L.statusHolds(on, undefined), true, '« available » by default');
        assert.equal(L.statusHolds(on, 'writer'), true);
        assert.equal(L.statusHolds(L.stateOf(null), 'enabled'), false);
    });
    test('reading the state and sorting are quiet to test; crashes and explanations are not', () => {
        for (const type of ['ai.status', 'ai.library_check', 'ai.triage_report', 'ai.run_task']) assert.equal(T.testNeedsConfirm({ kind: 'action', action: { type } }), false, type);
        for (const type of ['ai.crash_label', 'ai.explain_crash']) assert.equal(T.testNeedsConfirm({ kind: 'action', action: { type } }), true, type);
    });
});

describe('the variables and the editor', () => {
    test('every name in LAYA_VARS is written by the runner, and every number can be read by a condition', () => {
        const values = (/const VALUE_SOURCES = \[([\s\S]*?)\];/.exec(sched) || [])[1] || '';
        assert.ok(V.LAYA_VARS.length >= 40);
        for (const v of V.LAYA_VARS) {
            if (v.name === 'ai.scores') { assert.match(sched, /ctx\.maps\[scoresName\(''\)\]/); continue; }
            if (v.name === 'ai.library' || v.name === 'ai.crashes') { assert.ok(sched.includes(`|| '${v.name}'`), v.name); continue; }
            assert.ok(sched.includes(`['${v.name}'] =`), `${v.name} is never written`);
            if (v.kind === 'num') assert.ok(values.includes(`'${v.name}'`), `${v.name} is not in VALUE_SOURCES`);
        }
    });
    test('every new step has a form and every new condition an editor branch', () => {
        for (const n of ['aiRunTask', 'aiModClassify', 'aiLibrary', 'aiCrash', 'aiExplain', 'aiTriage', 'aiStatus']) assert.ok(sched.includes(`needs === '${n}'`), n);
        for (const c of ['aiScore', 'aiAbstained', 'aiAvailable', 'crashCause', 'aiLibraryCount', 'modAiTag']) {
            assert.ok(sched.includes(`cond.type === '${c}'`), `${c} has no editor`);
            assert.ok(sched.includes(`case '${c}':`), `${c} is not evaluated`);
            assert.ok(en['sched.cond.' + c] && fr['sched.cond.' + c] && en['sched.condd.' + c] && fr['sched.condd.' + c], c);
        }
    });
    test('the templates ask for the grant, never grant it', () => {
        for (const key of ['layaTagMods', 'layaCrashNotify', 'layaWeeklyCheck']) {
            const at = sched.indexOf(`key: '${key}'`);
            assert.ok(at > 0, key);
            const body = sched.slice(at, sched.indexOf('make: () =>', at) + 400);
            assert.match(body, /permissions: \{ ai: true \}/, key);
            assert.doesNotMatch(body, /perms: \{/, `${key} must not pre-grant`);
        }
        assert.ok(sched.includes("key: 'layaNewCrashKind'"));
    });
});
