// Laya in the feedback dialog and the crash manager — the pure rules (features/ai/laya-assist-model.ts).
//
// The model calls, the gate and the masking are Rust's (commands/ai_assist.rs has its own
// tests). What the page must get right on its own:
//   · an abstained answer is no proposal, a kept guess is marked, a proposal that would change
//     nothing is not made, and accepting writes only the accepted field;
//   · « already reported? » finds a recent look-alike and ignores old or unrelated reports;
//   · the same crash on two runs lands in one group, a different one does not;
//   · the cause taxonomy (families, causes) matches Rust; the family/cause filters and the
//     « attach this crash » pick; « Expliquer » is untrusted B.MD;
//   · while typing, Laya only runs when nothing leaves the PC;
//   · these screens never talk to the network themselves.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/ai/laya-assist-model.js')).href);

const NOW = Date.parse('2026-10-07T12:00:00Z');
const day = (n) => new Date(NOW - n * 86_400_000).toISOString();

describe('proposals from Laya answers', () => {
    const triage = { category: 'crash', category_p: 0.71, severity: 'high', severity_p: 0.6, uncertain: false, show_probs: true };
    const assist = {
        kind: { labels: [{ id: 'crash', p: 0.8 }], abstained: false, uncertain: false, showProbs: true },
        area: { labels: [{ id: 'profiles', p: 0.55 }], abstained: false, uncertain: true, showProbs: true },
    };

    test('every field is proposed, with its confidence and its guess flag', () => {
        const p = M.proposalsFrom(triage, assist, { kind: 'bug', accepted: { tags: [] } }, 'It froze when I switched profile');
        const by = Object.fromEntries(p.map((x) => [x.field + ':' + x.value, x]));
        assert.equal(by['kind:crash'].p, 0.8);
        assert.equal(by['category:crash'].p, 0.71);
        assert.equal(by['severity:high'].uncertain, false);
        assert.equal(by['area:profiles'].uncertain, true);
        assert.ok(by['tag:profiles'], 'the area is a tag');
        assert.ok(by['tag:freeze'], 'a word of the text is a tag');
    });

    test('an abstention is no proposal, and the current kind is not proposed again', () => {
        const abst = { kind: { labels: [], abstained: true }, area: { labels: [], abstained: true } };
        const p = M.proposalsFrom(null, abst, { kind: 'bug', accepted: { tags: [] } }, '');
        assert.deepEqual(p, []);
        const same = M.proposalsFrom(null, assist, { kind: 'crash', accepted: { tags: [] } }, '');
        assert.ok(!same.some((x) => x.field === 'kind'));
    });

    test('hidden percentages stay hidden', () => {
        const p = M.proposalsFrom({ ...triage, show_probs: false }, null, { kind: 'bug', accepted: { tags: [] } }, '');
        assert.ok(p.every((x) => x.p === null));
    });

    test('without Laya\'s kind answer, the triage category gives the kind (suggestion is never guessed from it)', () => {
        const p = M.proposalsFrom({ category: 'performance', category_p: 0.5 }, null, { kind: 'feedback', accepted: { tags: [] } }, '');
        assert.ok(p.some((x) => x.id === 'kind:bug'));
        assert.equal(M.kindFromCategory('other'), null);
    });

    test('a label outside the vocabulary is ignored', () => {
        const bad = { kind: { labels: [{ id: 'delete_everything', p: 0.99 }] }, area: { labels: [{ id: '<img>', p: 1 }] } };
        assert.deepEqual(M.proposalsFrom(null, bad, { kind: 'bug', accepted: { tags: [] } }, ''), []);
    });

    test('accept writes only that field; unaccept removes it; meta is null when nothing was accepted', () => {
        assert.equal(M.metaOf({ tags: [] }), null);
        let acc = M.accept({ tags: [] }, { id: 'area:mods', field: 'area', value: 'mods', p: 0.5, uncertain: false });
        acc = M.accept(acc, { id: 'tag:slow', field: 'tag', value: 'slow', p: null, uncertain: false });
        acc = M.accept(acc, { id: 'tag:slow', field: 'tag', value: 'slow', p: null, uncertain: false });
        assert.deepEqual(M.metaOf(acc), { tags: ['slow'], area: 'mods' });
        acc = M.unaccept(acc, 'area', 'mods');
        assert.deepEqual(M.metaOf(acc), { tags: ['slow'] });
        // kind and attach are applied by the dialog, never stored as labels
        assert.deepEqual(M.accept({ tags: [] }, { id: 'kind:crash', field: 'kind', value: 'crash', p: 1, uncertain: false }), { tags: [] });
    });

    test('pending drops what was accepted or dismissed, and duplicates', () => {
        const list = [{ id: 'a:1' }, { id: 'b:2' }, { id: 'a:1' }];
        assert.deepEqual(M.pending(list, new Set(['b:2'])).map((x) => x.id), ['a:1']);
    });
});

describe('already reported?', () => {
    const history = [
        { id: 'r1', type: 'bug', title: 'Profile switch freezes the window', date: day(3), sig: ['profile', 'switch', 'freezes', 'window'] },
        { id: 'r2', type: 'bug', title: 'Profile switch freezes the window', date: day(200) },
        { id: 'r3', type: 'feedback', title: 'Add a dark theme for the editor', date: day(2) },
    ];

    test('a recent look-alike is found, an old one is not', () => {
        const d = M.likelyDuplicates('Profile switch freezes', 'when I switch profile the window freezes', 'bug', history, NOW);
        assert.deepEqual(d.map((x) => x.entry.id), ['r1']);
        assert.ok(d[0].score > 0.4 && d[0].score <= 1);
    });

    test('unrelated text finds nothing, and a broken history never throws', () => {
        assert.deepEqual(M.likelyDuplicates('Crash on download', 'the download of a catalog crashes', 'crash', history, NOW), []);
        assert.deepEqual(M.likelyDuplicates('x', '', 'bug', 'nope', NOW), []);
        assert.deepEqual(M.likelyDuplicates('Profile switch freezes', 'window', 'bug', [null, 3, { date: 'bad' }], NOW), []);
    });
});

describe('crash groups and filters', () => {
    const items = [
        { path: 'a.zip', reason: "panicked at src/profiles.rs:120:9: index out of bounds: the len is 3 but the index is 7", excerpt: '' },
        { path: 'b.zip', reason: "panicked at src/profiles.rs:131:9: index out of bounds: the len is 0 but the index is 1", excerpt: '' },
        { path: 'c.zip', reason: 'failed to open C:\\Games\\x\\data.json: Access is denied. (os error 5)', excerpt: '' },
        { path: 'd.zip', reason: '', excerpt: '' },
    ];

    test('the same failure on two runs is one group; a different one and an empty one stand alone', () => {
        const g = M.groupCrashes(items);
        assert.equal(g.length, 3);
        assert.deepEqual(g[0].members, ['a.zip', 'b.zip']);
        assert.equal(g[0].rep, 'a.zip');
        assert.deepEqual(g.map((x) => x.members.length), [2, 1, 1]);
    });

    test('a signature ignores numbers, paths and quoted values', () => {
        assert.deepEqual(M.crashSignature("error 0x1F at 'C:\\a' line 12"), M.crashSignature("error 0xAB at 'D:\\b' line 99"));
    });

    test('labels spread to the group, counts and filters read them, an abstention is « unknown »', () => {
        const g = M.groupCrashes(items);
        const byRep = new Map([
            ['a.zip', { labels: [{ id: 'internal_error', p: 0.7 }], abstained: false, uncertain: false, showProbs: true }],
            ['c.zip', { labels: [{ id: 'permission', p: 0.3 }], abstained: false, uncertain: true, showProbs: false }],
            ['d.zip', { labels: [], abstained: true }],
        ]);
        const labels = M.spreadLabels(g, byRep);
        assert.equal(labels.get('b.zip'), byRep.get('a.zip'));
        assert.deepEqual(M.labelCounts(labels), [{ id: 'internal_error', n: 2 }, { id: 'permission', n: 1 }, { id: 'unknown', n: 1 }]);
        assert.deepEqual(M.familyCounts(labels), [{ id: 'app_backend', n: 2 }, { id: 'disk', n: 1 }, { id: 'unknown', n: 1 }]);
        assert.deepEqual(M.labelCounts(labels, 'disk'), [{ id: 'permission', n: 1 }]);
        assert.deepEqual(M.causeOf(labels.get('c.zip')), { id: 'permission', family: 'disk', p: null, uncertain: true });
        assert.deepEqual(M.causeOf(labels.get('d.zip')), { id: 'unknown', family: 'unknown', p: null, uncertain: false });
        // A v1 label (the nine flat causes) is not a cause any more: it reads « unknown ».
        assert.equal(M.causeOf({ labels: [{ id: 'file_access', p: 0.9 }] }).id, 'unknown');
        const groups = M.groupOf(g);
        assert.equal(M.passes('b.zip', 'cause:internal_error', labels, groups), true);
        assert.equal(M.passes('c.zip', 'cause:internal_error', labels, groups), false);
        assert.equal(M.passes('b.zip', 'family:app_backend', labels, groups), true);
        assert.equal(M.passes('c.zip', 'family:disk', labels, groups), true);
        assert.equal(M.passes('d.zip', 'cause:unknown', labels, groups), true);
        assert.equal(M.passes('d.zip', 'family:unknown', labels, groups), true);
        assert.equal(M.passes('b.zip', 'internal_error', labels, groups), false, 'a bare id is not a filter');
        assert.equal(M.passes('b.zip', 'group:1', labels, groups), true);
        assert.equal(M.passes('c.zip', 'group:1', labels, groups), false);
        assert.equal(M.passes('c.zip', '', labels, groups), true);
        assert.equal(M.filterFamily('cause:permission'), 'disk');
        assert.equal(M.filterFamily('family:network'), 'network');
        assert.equal(M.filterFamily('cause:unknown'), 'unknown');
        assert.equal(M.filterFamily('group:2'), '');
        // Evidence spreads like the label.
        const ev = M.spreadLabels(g, new Map([['a.zip', M.evidenceOf({ words: ['index out of bounds'], lines: ['x'] })]]));
        assert.deepEqual(ev.get('b.zip'), { words: ['index out of bounds'], lines: ['x'] });
    });

    test('evidence is bounded strings only', () => {
        assert.deepEqual(M.evidenceOf(null), { words: [], lines: [] });
        const e = M.evidenceOf({ words: ['a', 3, '', 'b', 'c', 'd', 'e', 'f', 'g'], lines: ['l'.repeat(500), {}, 'm', 'n', 'o'] });
        assert.deepEqual(e.words, ['a', 'b', 'c', 'd', 'e', 'f']);
        assert.equal(e.lines.length, 3);
        assert.equal(e.lines[0].length, 200);
    });

    test('the page knows exactly the families and causes Rust asks about', () => {
        const rs = readFileSync(join(ROOT, 'src-tauri/src/commands/ai_assist.rs'), 'utf8');
        const famBlock = rs.slice(rs.indexOf('pub const CRASH_FAMILIES'), rs.indexOf('pub struct CrashCause'));
        const fams = [...famBlock.matchAll(/^\s*\("([a-z_]+)",/gm)].map((m) => m[1]);
        assert.deepEqual(fams, [...M.CRASH_FAMILIES]);
        const causeBlock = rs.slice(rs.indexOf('pub const CRASH_CAUSES'), rs.indexOf('pub const LABEL_VERSION'));
        const pairs = [...causeBlock.matchAll(/id: "([a-z_]+)",\s*family: "([a-z_]+)"/g)].map((m) => [m[1], m[2]]);
        assert.deepEqual(Object.fromEntries(pairs), M.CAUSE_FAMILY);
        assert.ok(pairs.length >= 10 && pairs.length <= 24, 'a reasonable number of causes');
    });

    test('every family, cause and next step has words in EN and FR', () => {
        const words = readFileSync(join(ROOT, 'frontend/src/features/ai/laya-words.ts'), 'utf8');
        for (const lang of ['en', 'fr']) {
            const dict = JSON.parse(readFileSync(join(ROOT, `frontend/Lang/${lang}.json`), 'utf8'));
            for (const f of M.CRASH_FAMILIES) assert.ok(dict[`laya.family.${f}`], `${lang}: laya.family.${f}`);
            for (const c of [...M.CRASH_CAUSES, 'unknown']) assert.ok(dict[`laya.cause.${c}`], `${lang}: laya.cause.${c}`);
            for (const c of M.CRASH_CAUSES) assert.ok(dict[`laya.cstep.${c}`], `${lang}: laya.cstep.${c}`);
        }
        for (const c of M.CRASH_CAUSES) assert.ok(words.includes(`'laya.cstep.${c}'`) && words.includes(`'laya.cause.${c}'`), `laya-words.ts names ${c}`);
        for (const f of M.CRASH_FAMILIES) assert.ok(words.includes(`'laya.family.${f}'`), `laya-words.ts names ${f}`);
    });

    test('the crash report that fits the description is proposed, unless already attached', () => {
        const zips = [
            { path: 'new.zip', reason: 'network timeout while downloading catalog', excerpt: '' },
            { path: 'old.zip', reason: 'panicked at profiles index out of bounds', excerpt: 'switch profile' },
        ];
        assert.equal(M.bestCrashFor('It crashed when I switched profile, index out of bounds', zips, [])?.path, 'old.zip');
        assert.equal(M.bestCrashFor('It crashed when I switched profile, index out of bounds', zips, ['old.zip']), null);
        assert.equal(M.bestCrashFor('hello', zips, []), null);
    });
});

describe('when Laya runs', () => {
    test('while typing only when nothing leaves this PC, and never with AI off', () => {
        assert.equal(M.autoAssist({ enabled: true, classifier: 'embedded' }), true);
        assert.equal(M.autoAssist({ enabled: true, classifier: 'local', local_allow_remote: false }), true);
        assert.equal(M.autoAssist({ enabled: true, classifier: 'local', local_allow_remote: true }), false);
        assert.equal(M.autoAssist({ enabled: true, classifier: 'bettercommunity' }), false);
        assert.equal(M.autoAssist({ enabled: false, classifier: 'embedded' }), false);
        assert.equal(M.autoAssist({ enabled: true, classifier: 'embedded', report_triage: false }), false);
        assert.equal(M.autoAssist(null), false);
    });

    test('the Laya screens make no network call of their own', () => {
        for (const f of ['laya-assist.ts', 'laya-crash.ts', 'laya-debug.ts', 'laya-assist-model.ts', 'laya-words.ts', 'laya-explain-md.ts']) {
            const src = readFileSync(join(ROOT, 'frontend/src/features/ai', f), 'utf8');
            assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(src), `${f} talks to the network`);
        }
    });

    test('the model file stays import-free', () => {
        const src = readFileSync(join(ROOT, 'frontend/src/features/ai/laya-assist-model.ts'), 'utf8');
        assert.ok(!/^import /m.test(src));
    });
});

describe('« Expliquer » is untrusted B.MD', () => {
    test('a script, a javascript: link, an image or an embed in the model output never becomes live markup', async () => {
        globalThis.localStorage ??= { getItem: () => 'en', setItem() {} };
        const X = await import(pathToFileURL(join(ROOT, 'frontend/js/features/ai/laya-explain-md.js')).href);
        const { renderDocMarkdown } = await import(pathToFileURL(join(ROOT, 'frontend/js/docs/md-lite.js')).href);
        const hostile = [
            'Try this <script>alert(1)</script> now',
            '[click me](javascript:alert(1)) or [this](JaVaScRiPt:alert(1))',
            '<img src=x onerror=alert(1)>',
            '![tracker](https://evil.example/pixel.png)',
            ':::replay[T]{src=https://evil.example/x.bmmreplay}\n:::',
            ':::card[C]{href=javascript:alert(1)}\nx\n:::',
            'x :button[Go]{href=javascript:alert(1)}',
        ].join('\n\n');
        const src = X.explainSource(hostile);
        assert.ok(!/</.test(src), 'no raw markup reaches the renderer');
        assert.ok(!/^\s*::/m.test(src) && !/!\[/.test(src), 'no directive, no image');
        // The renderer's own output (no sanitiser in node: this measures what it BUILDS).
        const built = renderDocMarkdown(src, { trusted: true });
        assert.ok(!/<script/i.test(built));
        assert.ok(!/(href|src|data-ext)="\s*javascript:/i.test(built), built);
        assert.ok(!/<(img|iframe|video|audio)\b/i.test(built));
        assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(built.replace(/"[^"]*"|'[^']*'/g, '""')));
        // The real path: untrusted render (DOMPurify, or escaped text when it is absent), no media.
        const html = X.explainHtml(hostile);
        assert.ok(!/<script/i.test(html), html);
        assert.ok(!/(href|src|data-ext)="\s*javascript:/i.test(html), html);
        assert.ok(!/<(img|iframe|video|audio|source)\b/i.test(html));
        // Plain prose still reads as B.MD.
        assert.match(renderDocMarkdown(X.explainSource('The **mod** failed.\n\n- check it'), { trusted: true }), /<b>mod<\/b>.*<li>check it<\/li>/);
        assert.equal(X.explainHtml('   '), '');
    });
});
