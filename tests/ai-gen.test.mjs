// « Rédaction » — the pure rules of the writer setup and the drafting tool (features/ai/ai-gen-model.ts).
//
// The network, the prompts and the gate are Rust's (commands/ai_gen.rs has its own tests, with a
// loopback HTTP server standing in for LM Studio and Ollama). What the page must get right:
//   · an address as people type it (LM Studio shows « http://127.0.0.1:1234 », no /v1) reads the
//     same as Rust reads it, so « will use … » never lies;
//   · a probe outcome is worded by the step that failed, with the right hint;
//   · the model picker proposes a loaded writing model, never an embedding model;
//   · applying a draft replaces, inserts at the cursor or appends, and the diff is word-level;
//   · every dynamic i18n family the screens build exists in both languages;
//   · the AI screens ask through BMM dialogs (no window.confirm / alert / prompt, no askConfirm)
//     and never talk to the network themselves.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/ai/ai-gen-model.js')).href);
const G = await import(pathToFileURL(join(ROOT, 'scripts/check-native-dialogs.mjs')).href);
const en = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/en.json'), 'utf8'));
const fr = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/fr.json'), 'utf8'));
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('the address', () => {
    test('LM Studio, Ollama and pasted endpoints become the /v1 base (same rule as Rust)', () => {
        assert.equal(M.normalizeBase('http://127.0.0.1:1234'), 'http://127.0.0.1:1234/v1');
        assert.equal(M.normalizeBase('localhost:1234'), 'http://localhost:1234/v1');
        assert.equal(M.normalizeBase(' http://localhost:1234/v1/ '), 'http://localhost:1234/v1');
        assert.equal(M.normalizeBase('http://localhost:1234/v1/models'), 'http://localhost:1234/v1');
        assert.equal(M.normalizeBase('http://localhost:1234/v1/chat/completions'), 'http://localhost:1234/v1');
        assert.equal(M.normalizeBase('http://localhost:1234/api/v0/models'), 'http://localhost:1234/v1');
        assert.equal(M.normalizeBase('http://localhost:11434/api/tags'), 'http://localhost:11434/v1');
        assert.equal(M.normalizeBase('http://0.0.0.0:1234'), 'http://127.0.0.1:1234/v1');
        assert.equal(M.normalizeBase('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1');
        assert.equal(M.normalizeBase(''), '');
    });
    test('presets by port', () => {
        assert.equal(M.presetOfUrl('http://127.0.0.1:1234'), 'lmstudio');
        assert.equal(M.presetOfUrl('http://localhost:11434/v1'), 'ollama');
        assert.equal(M.presetOfUrl('http://127.0.0.1:8080/v1'), 'llamacpp');
        assert.equal(M.presetOfUrl('http://127.0.0.1:5000/v1'), 'custom');
        for (const p of M.GEN_PRESETS) if (p.url) assert.equal(M.normalizeBase(p.url), p.url, p.id);
    });
});

const step = (o) => ({ step: 'models', ok: false, url: 'http://127.0.0.1:1234/v1/models', status: null, error: null, detail: null, optional: false, ms: 3, ...o });
const probe = (o) => ({ ok: false, base: 'http://127.0.0.1:1234/v1', server: '', models: [], suggested: null, steps: [], error: null, detail: null, chatOk: null, latencyMs: 5, ...o });

describe('the probe, worded', () => {
    test('nothing listening → « start the server »', () => {
        const k = M.probeKeys(probe({ error: 'refused', steps: [step({ error: 'refused' })] }));
        assert.equal(k.tone, 'err');
        assert.equal(k.head, 'ai.gen.errRefused');
        assert.equal(k.hint, 'ai.gen.hintRefused');
    });
    test('LM Studio root without /v1 (200 with an error body) → « use the base address »', () => {
        const k = M.probeKeys(probe({ error: 'wrong_path', detail: 'Unexpected endpoint', steps: [step({ error: 'wrong_path', status: 200 })] }));
        assert.equal(k.head, 'ai.gen.errWrongPath');
        assert.equal(k.hint, 'ai.gen.hintWrongPath');
        assert.equal(k.vars.detail, 'Unexpected endpoint');
    });
    test('an optional step failing does not decide the outcome', () => {
        const p = probe({ ok: true, models: [{ id: 'm', kind: '', loaded: null }], steps: [step({ ok: true }), step({ step: 'lmstudio', optional: true, error: 'http_404' })] });
        assert.equal(M.failedStep(p), null);
        assert.equal(M.probeKeys(p).head, 'ai.gen.okModels');
        assert.equal(M.probeKeys({ ...p, chatOk: true }).head, 'ai.gen.okChat');
    });
    test('no models is a warning; a refused key and a bad address say so', () => {
        assert.equal(M.probeKeys(probe({ error: 'no_models', steps: [step({ ok: true })] })).tone, 'warn');
        assert.equal(M.probeKeys(probe({ error: 'http_401', steps: [step({ error: 'http_401', status: 401 })] })).head, 'ai.gen.errAuth');
        const bad = M.probeKeys(probe({ error: 'ai.url.notLoopback', steps: [step({ step: 'address', error: 'ai.url.notLoopback' })] }));
        assert.equal(bad.head, 'ai.gen.badAddress');
        assert.equal(bad.hint, 'ai.url.notLoopback');
        assert.equal(M.probeKeys(probe({ error: 'http_502', steps: [step({ error: 'http_502', status: 502 })] })).head, 'ai.gen.errHttp');
    });
    test('every key a probe can produce exists in both languages', () => {
        const codes = ['refused', 'timeout', 'unreachable', 'wrong_path', 'bad_response', 'no_models', 'model_error', 'http_401', 'http_404', 'http_500', 'weird', 'ai.url.invalid'];
        for (const code of codes) {
            const k = M.probeKeys(probe({ error: code, steps: [step({ error: code })] }));
            for (const key of [k.head, k.hint].filter(Boolean)) {
                assert.ok(en[key], `en ${key}`);
                assert.ok(fr[key], `fr ${key}`);
            }
        }
    });
});

describe('models', () => {
    const list = [
        { id: 'text-embedding-nomic', kind: 'embedding', loaded: false },
        { id: 'qwen2.5-7b', kind: 'llm', loaded: false },
        { id: 'llama-3.2-3b', kind: 'llm', loaded: true },
    ];
    test('loaded first, embedding last', () => {
        assert.deepEqual(M.sortModels(list).map((m) => m.id), ['llama-3.2-3b', 'qwen2.5-7b', 'text-embedding-nomic']);
    });
    test('the current model is kept when the server has it, else the suggestion', () => {
        assert.equal(M.pickModel(list, 'qwen2.5-7b', 'llama-3.2-3b'), 'qwen2.5-7b');
        assert.equal(M.pickModel(list, 'gone', 'llama-3.2-3b'), 'llama-3.2-3b');
        assert.equal(M.pickModel(list, '', null), '');
    });
});

describe('drafts', () => {
    test('replace, insert at the cursor, append after a blank line', () => {
        assert.deepEqual(M.applyDraft('old', ' new ', 'replace'), { value: 'new', caret: 3 });
        assert.equal(M.applyDraft('Hello world', 'big ', 'insert', 6, 6).value, 'Hello big world');
        assert.equal(M.applyDraft('Hello world', 'there', 'insert', 6, 11).value, 'Hello there');
        assert.equal(M.applyDraft('First.  \n', 'Second.', 'append').value, 'First.\n\nSecond.');
        assert.equal(M.applyDraft('   ', 'Only.', 'append').value, 'Only.', 'an empty field is replaced');
    });
    test('the default mode follows the preset', () => {
        assert.equal(M.defaultMode('clarify', 'some text'), 'replace');
        assert.equal(M.defaultMode('release_notes', 'some text'), 'append');
        assert.equal(M.defaultMode('release_notes', ''), 'replace');
    });
    test('maxlength clips', () => {
        assert.deepEqual(M.clipTo('abcdef', 4), { value: 'abcd', clipped: true });
        assert.deepEqual(M.clipTo('abc', -1), { value: 'abc', clipped: false });
    });
    test('the diff is word-level and complete', () => {
        const parts = M.wordDiff('The mod adds maps.', 'The mod adds new maps.');
        assert.equal(parts.filter((p) => p.op !== 'del').map((p) => p.text).join(''), 'The mod adds new maps.');
        assert.equal(parts.filter((p) => p.op !== 'add').map((p) => p.text).join(''), 'The mod adds maps.');
        assert.deepEqual(M.diffStats(parts), { added: 1, removed: 0 });
        assert.deepEqual(M.wordDiff('', 'Hi'), [{ op: 'add', text: 'Hi' }]);
    });
    test('missing input, as Rust says it', () => {
        assert.equal(M.missingInput('translate', '', 'ctx', false), 'ai.draft.noText');
        assert.equal(M.missingInput('release_notes', '', '- fixed', false), null);
        assert.equal(M.missingInput('describe_mod', '', '', true), null);
        assert.equal(M.missingInput('describe_mod', '', '', false), 'ai.draft.noFacts');
        assert.equal(M.missingInput('free', '', '', false, 'write a haiku'), null);
    });
    test('the mod list keeps enabled mods only, capped', () => {
        const txt = M.modListText([{ name: 'A', version: '1.0', enabled: true }, { name: 'B', enabled: false }, { name: ' C ' }]);
        assert.equal(txt, '- A (1.0)\n- C');
        assert.match(M.modListText(Array.from({ length: 5 }, (_, i) => ({ name: `M${i}` })), 3), /\+2$/);
    });
});

describe('words and rules of the screens', () => {
    test('every dynamic key family exists in both languages', () => {
        const fam = [
            ...['lmstudio', 'ollama', 'llamacpp', 'custom'].map((p) => `ai.gen.preset.${p}`),
            ...['address', 'models', 'lmstudio', 'ollama', 'chat'].map((p) => `ai.gen.step.${p}`),
            ...['refused', 'timeout', 'unreachable', 'wrong_path', 'bad_response', 'no_models', 'model_error', 'http'].map((p) => `ai.gen.code.${p}`),
            ...['lmstudio', 'ollama', 'openai'].map((p) => `ai.gen.server.${p}`),
            ...M.DRAFT_PRESETS.flatMap((p) => [`ai.draft.p.${p}`, `ai.draft.ph.${p}`]),
            ...['short', 'medium', 'long'].map((p) => `ai.draft.length.${p}`),
            ...['precise', 'balanced', 'creative'].map((p) => `ai.draft.creativity.${p}`),
            ...['replace', 'insert', 'append'].map((p) => `ai.draft.mode.${p}`),
            'ai.draft.noText', 'ai.draft.noContext', 'ai.draft.noFacts',
        ];
        for (const k of fam) { assert.ok(en[k], `en ${k}`); assert.ok(fr[k], `fr ${k}`); }
    });
    test('the AI screens ask through BMM dialogs, never a native one', () => {
        for (const f of ['ai-settings.ts', 'ai-tuning.ts', 'laya-draft.ts', 'laya-hub.ts', 'ai-suggest.ts', 'ai-library.ts', 'ai-ask.ts', 'laya-assist.ts', 'laya-crash.ts', 'laya-debug.ts']) {
            const rel = `frontend/src/features/ai/${f}`;
            assert.deepEqual(G.count(rel, src(rel)), {}, rel);
        }
        assert.match(src('frontend/src/features/ai/ai-settings.ts'), /confirmAction\(/);
    });
    test('the gate sees through comments and strings, and ignores methods and local bindings', () => {
        assert.deepEqual(G.count('x.ts', "// confirm('x')\nconst s = 'alert(1)';\nobj.confirm(1);\nasync confirm(p: P) {}\n"), {});
        assert.deepEqual(G.count('x.ts', "if (confirm('sure?')) go();\nwindow.prompt('a');\nawait askConfirm('b');"), { confirm: 1, 'window.prompt': 1, askConfirm: 1 });
        assert.deepEqual(G.count('x.ts', 'const confirm = (window as any).confirmCustom;\nawait confirm(a);'), {});
        assert.deepEqual(G.count('x.ts', 'const u = `https://a//b ${confirm(1)}`;'), { confirm: 1 });
    });
    test('the writer and drafting screens only talk to Rust', () => {
        for (const f of ['ai-settings.ts', 'laya-draft.ts', 'ai-gen-model.ts']) {
            const s = src(`frontend/src/features/ai/${f}`);
            assert.doesNotMatch(s, /\bfetch\(|XMLHttpRequest|new WebSocket/, f);
        }
    });
});
