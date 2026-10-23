// « Réponses de Laya » — the settings model of the Settings card (features/ai/ai-tuning-model.ts).
//
// Rust (src-tauri/src/commands/ai_tuning.rs) validates and applies the settings; its tests cover
// thresholds, margins, temperature, abstention, custom tasks, bounds and injection through
// labels. What the page must get right on its own:
//   · a preset keeps the user's « show percentages » and « apply without asking » choices, and
//     « Personnalisé » starts from the numbers that applied until then;
//   · a task is refused here for the same reasons Rust refuses it (so Save says why);
//   · an export reads back as itself, and a file from a newer BMM or of another kind is refused
//     before it reaches Rust;
//   · every word the card builds from a list (presets, features, sources, actions, reasons)
//     exists in both languages, and none has an em dash;
//   · the card never talks to the network itself.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/ai/ai-tuning-model.js')).href);

// What Rust's `presets_table` answers for two features (shape and numbers).
const PRESETS = {
    mod_suggest: {
        prudent: { ...M.defaultTuning(), preset: 'prudent', threshold: 0.55, margin: 0.1, max_labels: 2, multi_label: true, top_k: 3 },
        balanced: { ...M.defaultTuning(), threshold: 0.35, max_labels: 3, multi_label: true, top_k: 3 },
        permissive: { ...M.defaultTuning(), preset: 'permissive', threshold: 0.2, abstain: 'flag', max_labels: 3, multi_label: true, top_k: 3 },
    },
    tasks: { balanced: M.defaultTuning(), prudent: { ...M.defaultTuning(), preset: 'prudent', threshold: 0.5, margin: 0.1 } },
};

describe('tuning values', () => {
    test('defaults are « Équilibré », percentages shown, nothing applied by itself', () => {
        const c = M.defaultConfig();
        assert.equal(c.global.preset, 'balanced');
        assert.equal(c.global.show_probs, true);
        assert.equal(c.global.auto_apply, false);
        assert.equal(c.allow_program_changes, false);
        assert.ok(M.AREAS.every((a) => c.features[a] === null));
    });

    test('numbers are clamped and garbage becomes the default', () => {
        const t = M.normTuning({ preset: 'weird', threshold: 7, top_k: -3, temperature: 'x', margin: NaN, max_labels: 99, abstain: 'maybe' });
        assert.deepEqual([t.preset, t.threshold, t.top_k, t.temperature, t.margin, t.max_labels, t.abstain], ['balanced', 0.99, 1, 1, 0, 10, 'unknown']);
    });

    test('a preset expands through the Rust table and keeps the user preferences', () => {
        const c = M.setOverride(M.defaultConfig(), 'mod_suggest', true);
        c.features.mod_suggest = { ...c.features.mod_suggest, preset: 'prudent', show_probs: false, auto_apply: true };
        const e = M.effective(c, 'mod_suggest', PRESETS);
        assert.equal(e.threshold, 0.55);
        assert.equal(e.show_probs, false);
        assert.equal(e.auto_apply, true);
        // An area without an override follows the global preset, through ITS row.
        assert.equal(M.effective(c, 'tasks', PRESETS).threshold, 0);
    });

    test('« Personnalisé » starts from what applied, not from zeros', () => {
        const now = M.effective(M.defaultConfig(), 'mod_suggest', PRESETS);
        const c = M.withPreset(M.defaultTuning(), 'custom', now);
        assert.equal(c.preset, 'custom');
        assert.equal(c.threshold, 0.35);
        assert.equal(c.max_labels, 3);
        assert.equal(M.withPreset(c, 'permissive').preset, 'permissive');
    });

    test('an override can be turned off again', () => {
        let c = M.setOverride(M.defaultConfig(), 'triage', true);
        assert.ok(c.features.triage);
        c = M.setOverride(c, 'triage', false);
        assert.equal(c.features.triage, null);
        assert.equal(M.storedFor(c, 'triage'), c.global);
    });
});

describe('tasks', () => {
    test('ids are slugs, unique, ascii', () => {
        assert.equal(M.slugId('Genre des mods', []), 'genre-des-mods');
        assert.equal(M.slugId('Été à Noël!', []), 'ete-a-noel');
        assert.equal(M.slugId('kind', ['kind', 'kind-2']), 'kind-3');
        assert.equal(M.slugId('###', []), 'task');
        assert.ok(M.slugId('x'.repeat(100), []).length <= 40);
    });

    test('examples are split, trimmed and bounded', () => {
        assert.deepEqual(M.parseExamples(' new rifle ; sniper\n\n;pistol'), ['new rifle', 'sniper', 'pistol']);
        assert.equal(M.parseExamples('a;b;c;d;e;f;g').length, 5);
        assert.equal(M.parseExamples('x'.repeat(500))[0].length, 200);
    });

    test('the same problems Rust refuses, in the same words', () => {
        const ok = { ...M.newTask('Kind', []), labels: [{ id: 'cars', description: '', examples: [] }, { id: 'maps', description: '', examples: [] }] };
        assert.equal(M.taskProblem(ok, [ok]), null);
        assert.equal(M.taskProblem({ ...ok, labels: ok.labels.slice(0, 1) }, []), 'laya.cfg.taskLabels');
        assert.equal(M.taskProblem({ ...ok, labels: [...ok.labels, { id: 'CARS', description: '', examples: [] }] }, []), 'laya.cfg.dupLabel');
        assert.equal(M.taskProblem({ ...ok, labels: [...ok.labels, { id: 'none', description: '', examples: [] }] }, []), 'laya.cfg.dupLabel');
        assert.equal(M.taskProblem({ ...ok, id: 'Bad Id' }, []), 'laya.cfg.badTaskId');
        assert.equal(M.taskProblem({ ...ok, source: 'text', action: 'tag' }, []), 'laya.cfg.actionNeedsMod');
        const twin = { ...ok };
        assert.equal(M.taskProblem(twin, [ok, twin]), 'laya.cfg.dupTaskId');
        assert.equal(M.taskProblem({ ...ok, labels: [...ok.labels, { id: 'x', description: 'y'.repeat(301), examples: [] }] }, []), 'laya.cfg.tooLong');
    });

    test('a new task starts with two empty rows, which are not saved', () => {
        const t = M.newTask('Kind', []);
        assert.equal(t.labels.length, 2);
        const c = { ...M.defaultConfig(), tasks: [{ ...t, labels: [...t.labels, { id: 'a', description: '', examples: [] }] }] };
        assert.deepEqual(M.forSave(c).tasks[0].labels.map((l) => l.id), ['a']);
    });
});

describe('import / export', () => {
    test('an export reads back as itself', () => {
        const c = M.defaultConfig();
        c.tasks = [{ ...M.newTask('Kind', []), labels: [{ id: 'a', description: 'x', examples: ['e1'] }, { id: 'b', description: '', examples: [] }] }];
        c.labels.mod_tags = [{ id: 'Weapons', description: 'guns', examples: [] }, { id: 'Empty', description: '', examples: [] }];
        const r = M.parseImport(M.exportText(c));
        assert.equal(r.ok, true);
        assert.equal(r.value.kind, 'bmm-laya-config');
        const back = M.normConfig(r.value.config);
        assert.equal(back.tasks[0].labels[0].examples[0], 'e1');
        assert.deepEqual(back.labels.mod_tags.map((l) => l.id), ['Weapons'], 'an empty hint is not exported');
    });

    test('other files are refused before Rust sees them', () => {
        assert.deepEqual(M.parseImport('{nope'), { ok: false, error: 'laya.cfg.badJson' });
        assert.deepEqual(M.parseImport('[1,2]'), { ok: false, error: 'laya.cfg.badJson' });
        assert.deepEqual(M.parseImport(JSON.stringify({ kind: 'bmm-theme' })), { ok: false, error: 'laya.cfg.badJson' });
        assert.deepEqual(M.parseImport(JSON.stringify({ kind: 'bmm-laya-config', version: 9, config: {} })), { ok: false, error: 'laya.cfg.badVersion' });
        assert.deepEqual(M.parseImport(JSON.stringify({ version: 2 })), { ok: false, error: 'laya.cfg.badVersion' });
        assert.deepEqual(M.parseImport('x'.repeat(M.LIMITS.bytes + 1)), { ok: false, error: 'laya.cfg.tooBig' });
        // A bare config is passed on (Rust refuses unknown fields with its own key).
        assert.equal(M.parseImport(JSON.stringify(M.defaultConfig())).ok, true);
    });
});

describe('percent bars', () => {
    test('best first, rounded, bounded, hidden on demand', () => {
        const rows = [{ id: 'b', p: 0.2049 }, { id: 'a', p: 0.7 }, { id: 'c', p: 7 }, { id: 'd', p: NaN }];
        assert.deepEqual(M.bars(rows, true), [{ id: 'c', pct: 100 }, { id: 'a', pct: 70 }, { id: 'b', pct: 20 }]);
        assert.deepEqual(M.bars(rows, false), []);
        assert.equal(M.bars(rows, true, 1).length, 1);
    });
});

describe('the card', () => {
    const src = readFileSync(join(ROOT, 'frontend/src/features/ai/ai-tuning.ts'), 'utf8');
    const en = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/en.json'), 'utf8'));
    const fr = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/fr.json'), 'utf8'));

    test('every word built from a list exists in both languages', () => {
        const keys = [
            ...M.PRESETS.flatMap((p) => [`ai.lt.preset.${p}`, `ai.lt.presetHint.${p}`]),
            ...['global', ...M.AREAS].map((a) => `ai.lt.area.${a}`),
            ...M.SOURCES.map((s) => `ai.lt.src.${s}`),
            ...M.ACTIONS.map((a) => `ai.lt.act.${a}`),
            ...['threshold', 'margin', 'temperature', 'top_k', 'max_labels'].flatMap((k) => [`ai.lt.f.${k}`, `ai.lt.fh.${k}`]),
            ...['none', 'below_threshold', 'ambiguous'].map((w) => `ai.lt.why.${w}`),
        ];
        // And every literal t('…') of the card.
        for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) keys.push(m[1]);
        for (const k of keys) {
            assert.ok(en[k], `en: ${k}`);
            assert.ok(fr[k], `fr: ${k}`);
            assert.ok(!/—/.test(en[k] + fr[k]), `em dash in ${k}`);
        }
    });

    test('the Rust refusal keys are translated', () => {
        const rust = readFileSync(join(ROOT, 'src-tauri/src/commands/ai_tuning.rs'), 'utf8');
        const found = new Set([...rust.matchAll(/"(laya\.(?:cfg|task)\.[a-zA-Z]+)/g)].map((m) => m[1]));
        assert.ok(found.size >= 10, 'read the keys');
        for (const k of found) assert.ok(en[k] && fr[k], k);
    });

    test('no network from the page: every call is a Tauri command', () => {
        assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket/.test(src));
        assert.ok(/invoke\('ai_laya_save'/.test(src));
    });
});
