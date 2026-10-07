// Optional AI — the part of the UI contract that can be pinned without a window.
//
// The network rules live in Rust (src-tauri/src/commands/ai_core.rs, whose tests prove that a
// master switch off sends NOTHING, whatever the provider). What the page must get right on its
// own is smaller and just as important:
//   · nothing is pre-ticked, and "Apply" sends only what was ticked — a hint (language, adult
//     content) can never reach the apply payload;
//   · one value per scalar field: ticking a second description unticks the first;
//   · the "already sent?" check finds a recent look-alike and ignores old or unrelated ones;
//   · the AI screens never talk to the network themselves (no fetch): every provider call is a
//     Tauri command, which is where the gate is.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/ai/ai-model.js')).href);

const SUGG = [
    { field: 'name', value: 'Cool Mod', source: 'file', origin: 'mod.json', confidence: 0.9, applicable: true },
    { field: 'description', value: 'From the manifest.', source: 'file', origin: 'mod.json', confidence: 0.85, applicable: true },
    { field: 'description', value: 'From the readme.', source: 'file', origin: 'README.md', confidence: 0.6, applicable: true },
    { field: 'tags', value: 't-weap', source: 'laya', origin: 'laya (local)', confidence: 0.91, applicable: true, note: 'Weapons' },
    { field: 'links', value: { url: 'https://github.com/a/b', label: 'repo', link_type: 'github' }, source: 'file', origin: 'README.md', confidence: 0.5, applicable: true },
    { field: 'language', value: 'fr', source: 'laya', origin: 'laya (local)', confidence: 0.8, applicable: false },
    { field: 'nsfw', value: false, source: 'bettercommunity', origin: 'BetterCommunity', confidence: 0.9, applicable: false },
    // A server that claims a hint is applicable must not make it so.
    { field: 'language', value: 'en', source: 'bettercommunity', origin: 'x', confidence: 0.5, applicable: true },
];
const MOD = { name: 'Cool_Mod', version: '1.0', author: '', description: '', tags: [], download_links: [] };
const tagName = (id) => ({ 't-weap': 'Weapons' }[id] || id);

describe('suggestion rows', () => {
    test('nothing is ticked, hints are not applicable', () => {
        const rows = M.rowsFromSuggestions(SUGG, MOD, tagName);
        assert.equal(rows.length, SUGG.length);
        assert.ok(rows.every((r) => r.checked === false));
        assert.deepEqual(rows.filter((r) => !r.applicable).map((r) => r.field), ['language', 'nsfw', 'language']);
        assert.equal(rows.find((r) => r.field === 'tags').display, 'Weapons');
        assert.equal(rows.find((r) => r.field === 'name').current, 'Cool_Mod');
        assert.deepEqual(M.buildFields(rows), {}, 'an untouched dialog applies nothing');
    });

    test('apply carries exactly the ticked fields', () => {
        let rows = M.rowsFromSuggestions(SUGG, MOD, tagName);
        const key = (f, i = 0) => rows.filter((r) => r.field === f)[i].key;
        rows = M.toggleRow(rows, key('name'), true);
        rows = M.toggleRow(rows, key('tags'), true);
        rows = M.toggleRow(rows, key('links'), true);
        rows = M.toggleRow(rows, key('language'), true); // a hint: refused
        rows = M.toggleRow(rows, key('language', 1), true); // "applicable" hint from a server: refused
        assert.deepEqual(M.buildFields(rows), {
            name: 'Cool Mod',
            tags: ['t-weap'],
            links: [{ url: 'https://github.com/a/b', label: 'repo', link_type: 'github' }],
        });
    });

    test('one value per scalar field', () => {
        let rows = M.rowsFromSuggestions(SUGG, MOD, tagName);
        const [a, b] = rows.filter((r) => r.field === 'description').map((r) => r.key);
        rows = M.toggleRow(rows, a, true);
        rows = M.toggleRow(rows, b, true);
        assert.deepEqual(M.buildFields(rows), { description: 'From the readme.' });
        rows = M.toggleRow(rows, b, false);
        assert.deepEqual(M.buildFields(rows), {});
    });

    test('garbage in, nothing out', () => {
        assert.deepEqual(M.rowsFromSuggestions(null, MOD, tagName), []);
        assert.equal(M.pct(1.7), 100);
        assert.equal(M.pct(-1), 0);
        assert.equal(M.pct(0.874), 87);
    });
});

describe('"already sent?"', () => {
    const now = Date.parse('2026-09-29T12:00:00Z');
    const day = 86_400_000;
    const hist = [
        { title: 'BMM crashes when enabling a zipped mod', date: new Date(now - 3 * day).toISOString() },
        { title: 'Theme editor colours reset', date: new Date(now - 2 * day).toISOString(), sig: M.reportSig('Theme editor colours reset', 'the colours go back') },
        { title: 'Crash when enabling zipped mod', date: new Date(now - 45 * day).toISOString() },
    ];
    test('a recent look-alike is found', () => {
        const hits = M.similarReports('Crash when enabling a zipped mod', 'It crashes every time', hist, now);
        assert.equal(hits.length, 1);
        assert.equal(hits[0].entry.title, 'BMM crashes when enabling a zipped mod');
    });
    test('old or unrelated reports are not', () => {
        assert.deepEqual(M.similarReports('Discord presence shows the wrong profile', '', hist, now), []);
        assert.deepEqual(M.similarReports('x', '', 'not an array', now), []);
    });
    test('the signature is words, not stop-words, accents folded', () => {
        assert.deepEqual(M.reportSig('Le thème se réinitialise'), ['theme', 'reinitialise']);
    });
});

describe('provider gate mirror (explains; Rust decides)', () => {
    test('off / no provider / no consent / ok', () => {
        assert.equal(M.providerBlock(null, 'mod'), 'ai_off');
        assert.equal(M.providerBlock({ enabled: false, classifier: 'local', bc_consent: false }, 'mod'), 'ai_off');
        assert.equal(M.providerBlock({ enabled: true, classifier: 'off', bc_consent: false }, 'mod'), 'no_provider');
        assert.equal(M.providerBlock({ enabled: true, classifier: 'bettercommunity', bc_consent: false }, 'report'), 'no_consent');
        assert.equal(M.providerBlock({ enabled: true, classifier: 'local', bc_consent: false, mod_suggest: false }, 'mod'), 'feature_off');
        assert.equal(M.providerBlock({ enabled: true, classifier: 'local', bc_consent: false }, 'mod'), '');
        // The built-in engine needs no consent (nothing is sent) but still the master switch.
        assert.equal(M.providerBlock({ enabled: true, classifier: 'embedded', bc_consent: false }, 'report'), '');
        assert.equal(M.providerBlock({ enabled: false, classifier: 'embedded', bc_consent: false }, 'mod'), 'ai_off');
    });
    test('sizes read like the installer', () => {
        assert.equal(M.fmtBytes(327125837), '327 MB');
        assert.equal(M.fmtBytes(0), '0 B');
        assert.equal(M.fmtBytes(1.5e9), '1.5 GB');
    });
});

describe('the AI screens never reach the network themselves', () => {
    const dir = join(ROOT, 'frontend/src/features/ai');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    test('files exist', () => assert.ok(files.length >= 5, files.join(', ')));
    for (const f of files) {
        test(`${f}: no fetch / XMLHttpRequest / WebSocket`, () => {
            const src = readFileSync(join(dir, f), 'utf8');
            assert.ok(!/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|sendBeacon/.test(src), `${f} talks to the network directly`);
        });
    }
    test('every ai_* command the screens call is registered in main.rs', () => {
        const used = new Set();
        for (const f of files) for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/invoke\(\s*'(ai_[a-z_]+)'/g)) used.add(m[1]);
        for (const f of ['frontend/src/features/mods/mods-details.ts', 'frontend/src/features/feedback/feedback-modal.ts']) {
            for (const m of readFileSync(join(ROOT, f), 'utf8').matchAll(/invoke\(\s*'(ai_[a-z_]+)'/g)) used.add(m[1]);
        }
        const main = readFileSync(join(ROOT, 'src-tauri/src/main.rs'), 'utf8');
        assert.ok(used.size >= 6, [...used].join(', '));
        // commands/ai.rs, or commands/ai_assist.rs (Laya in the feedback dialog, the crash manager, the debug menu).
        for (const c of used) assert.ok(main.includes(`commands::ai::${c},`) || main.includes(`commands::ai_assist::${c},`), `${c} is not registered`);
    });
    test('the Rust gate test that proves "off = no request" is still there', () => {
        const core = readFileSync(join(ROOT, 'src-tauri/src/commands/ai_core.rs'), 'utf8');
        assert.ok(core.includes('fn master_switch_off_means_no_network_anywhere'));
        assert.ok(/assert_eq!\(t\.calls\.get\(\), 0, "the master switch let a request through"\)/.test(core));
    });
});

describe('« Laya intégré »: one install state at a time', () => {
    const base = { installed: false, loaded: false, partialBytes: 0, outdated: false, neededBytes: 800e6, freeBytes: 50e9 };
    test('what Rust reports decides the resting state', () => {
        assert.equal(M.embState(base), 'absent');
        assert.equal(M.embState({ ...base, partialBytes: 1e6 }), 'partial');
        assert.equal(M.embState({ ...base, outdated: true }), 'outdated');
        assert.equal(M.embState({ ...base, installed: true }), 'installed');
        assert.equal(M.embState({ ...base, installed: true, loaded: true }), 'loaded');
        // Not enough room is said BEFORE the download starts, not at 99 %.
        assert.equal(M.embState({ ...base, freeBytes: 100e6 }), 'no_space');
        // Unknown free space never blocks.
        assert.equal(M.embState({ ...base, freeBytes: null }), 'absent');
    });
    test('a running install wins over the resting state; --no-ai wins over everything', () => {
        assert.equal(M.embState(base, { phase: 'download' }), 'downloading');
        assert.equal(M.embState(base, { phase: 'verify' }), 'verifying');
        assert.equal(M.embState(base, { phase: 'unpack' }), 'unpacking');
        assert.equal(M.embState(base, { error: 'unreachable' }), 'error');
        assert.equal(M.embState({ ...base, installed: true }, { phase: 'download' }, true), 'killed');
    });
    test('speed, time left and the no-space error read as people say them', () => {
        assert.equal(M.fmtSpeed(2_500_000), '3 MB/s');
        assert.equal(M.fmtSpeed(0), '');
        assert.equal(M.fmtEta(65), '1:05');
        assert.equal(M.fmtEta(3725), '1 h 02');
        assert.equal(M.fmtEta(null), '');
        assert.deepEqual(M.parseNoSpace('embedded:no_space:800000000:1000'), { needed: 800000000, free: 1000 });
        assert.equal(M.parseNoSpace('unreachable'), null);
    });
});

describe('« Ask Laya »: what the dialog shows', () => {
    const hits = [
        { kind: 'doc', id: 'doc:a', title: 'A', snippet: '', score: 1, action: { page: 'a' } },
        { kind: 'mod', id: 'mod:m1', title: 'M1', snippet: '', score: 0.7, action: { mod: 'm1' } },
        { kind: 'article', id: 'art:b', title: 'B', snippet: '', score: 0.6, action: { article: 'b' } },
        { kind: 'command', id: 'cmd:c', title: 'C', snippet: '', score: 0.5, action: { command: 'c' } },
    ];
    test('hits are grouped by kind in the order the intent asks for', () => {
        assert.deepEqual(M.groupHits({ intent: 'docs', hits }).map((g) => g.kind), ['doc', 'command', 'mod']);
        assert.deepEqual(M.groupHits({ intent: 'mods', hits }).map((g) => g.kind), ['mod', 'doc', 'command']);
        // Articles and doc pages are one group: both are documentation.
        assert.equal(M.groupHits({ intent: 'docs', hits })[0].hits.length, 2);
    });
    test('a top pick only when it clearly leads, never when Laya said « none »', () => {
        assert.equal(M.topPick({ hits, low_confidence: false })?.id, 'doc:a');
        assert.equal(M.topPick({ hits, low_confidence: true }), null);
        assert.equal(M.topPick({ hits: [hits[0], { ...hits[1], score: 0.95 }], low_confidence: false }), null);
    });
    test('smart search keeps the ranked mods only', () => {
        assert.deepEqual(M.rankedModIds({ hits }), ['m1']);
        assert.deepEqual(M.rankedModIds(null), []);
    });
});
