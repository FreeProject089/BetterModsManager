// « Export in the BMM DevTools doesn't work — we must know that it exports and where. » The
// owner's log: `Click: Button [debug-btn-export]` ten times, nothing on screen. The DevTools
// exports clicked an <a download> (silent at best in the Tauri webview) after a JSON.stringify
// that threw on the state. They now go through frontend/src/ui/export-file-core.ts (compiled,
// tested here with a fake dialog / writer / toast) and every one says where the file went.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const E = await import(pathToFileURL(join(ROOT, 'frontend/js/ui/export-file-core.js')).href);
const src = (p) => readFileSync(join(ROOT, p), 'utf8').split(String.fromCharCode(13)).join('');
const en = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/en.json'), 'utf8'));
const fr = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/fr.json'), 'utf8'));

function fakes({ pick = 'C:\\Users\\me\\Desktop\\session.json', writeFails = null, saveThrows = null } = {}) {
  const log = { toasts: [], writes: [], saves: [], decorated: [] };
  return {
    log,
    deps: {
      save: async (o) => { log.saves.push(o); if (saveThrows) throw saveThrows; return pick; },
      write: async (path, content) => { if (writeFails) throw writeFails; log.writes.push([path, content]); },
      open: async () => {},
      toast: (msg, kind, ms, icon, source, opts) => log.toasts.push({ msg, kind, opts }),
      t: (k, v) => (v ? `${k}${JSON.stringify(v)}` : k),
      decorate: (folder) => log.decorated.push(folder),
    },
  };
}

describe('an export says what it did and where', () => {
  test('saved: the file is written where the person chose, the toast carries the full path and « Open folder »', async () => {
    const { deps, log } = fakes();
    const path = await E.exportText({ what: 'DevTools session', defaultName: 'bmm-debug-session-1.json', content: '{"a":1}', ext: 'json', filterName: 'JSON' }, deps);
    assert.equal(path, 'C:\\Users\\me\\Desktop\\session.json');
    assert.deepEqual(log.saves[0], { defaultPath: 'bmm-debug-session-1.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    assert.deepEqual(log.writes, [['C:\\Users\\me\\Desktop\\session.json', '{"a":1}']]);
    const t = log.toasts[0];
    assert.equal(t.kind, 'success');
    assert.ok(t.msg.endsWith(': C:\\Users\\me\\Desktop\\session.json'), t.msg);
    assert.deepEqual(t.opts.action, { kind: 'open-folder', arg: 'C:\\Users\\me\\Desktop', label: 'dev.export.openFolder' });
    assert.deepEqual(log.decorated, ['C:\\Users\\me\\Desktop'], 'the inline Open folder button');
  });

  test('cancelled: nothing written, and it says so', async () => {
    const { deps, log } = fakes({ pick: null });
    assert.equal(await E.exportText({ what: 'x', defaultName: 'x.txt', content: 'x', ext: 'txt', filterName: 'Text' }, deps), null);
    assert.deepEqual(log.writes, []);
    assert.deepEqual(log.toasts.map((x) => [x.msg, x.kind]), [['dev.export.cancelled', 'info']]);
  });

  test('a write that fails is reported with its reason, never silently', async () => {
    const { deps, log } = fakes({ writeFails: "Refused: '.exe' is not an allowed export type" });
    assert.equal(await E.exportText({ what: 'patches', defaultName: 'p.txt', content: 'x', ext: 'txt', filterName: 'Text' }, deps), null);
    assert.equal(log.toasts.length, 1);
    assert.equal(log.toasts[0].kind, 'error');
    assert.match(log.toasts[0].msg, /dev\.export\.failed.*patches.*Refused: '\.exe'/);
  });

  test('a dialog that throws is a failure in words too', async () => {
    const { deps, log } = fakes({ saveThrows: new Error('dialog plugin missing') });
    assert.equal(await E.exportText({ what: 'x', defaultName: 'x.txt', content: 'x', ext: 'txt', filterName: 'Text' }, deps), null);
    assert.match(log.toasts[0].msg, /dialog plugin missing/);
  });

  test('a file the core wrote by itself (diagnostics, memory, report) gets the same toast', () => {
    const { deps, log } = fakes();
    E.showSaved('Diagnostic exported', 'C:/Users/me/AppData/Roaming/com.bettermm.desktop/diagnostics/diag-1.json', deps);
    assert.equal(log.toasts[0].msg, 'Diagnostic exported: C:/Users/me/AppData/Roaming/com.bettermm.desktop/diagnostics/diag-1.json');
    assert.equal(log.toasts[0].opts.action.arg, 'C:/Users/me/AppData/Roaming/com.bettermm.desktop/diagnostics');
  });

  test('the session snapshot serialises a state with Sets, Maps, cycles and functions', () => {
    const state = { processingMods: new Set(['a', 'b']), cache: new Map([['k', 1]]), fn() {}, big: 10n };
    state.self = state;
    const out = JSON.parse(E.safeStringify({ state }));
    assert.deepEqual(out.state.processingMods, ['a', 'b']);
    assert.deepEqual(out.state.cache, { k: 1 });
    assert.equal(out.state.self, '[circular]');
    assert.equal(out.state.big, '10');
    assert.match(out.state.fn, /^\[function/);
    // The plain stringify the button used to run throws on the same state.
    assert.throws(() => JSON.stringify({ state }));
  });

  test('folderOf takes either separator', () => {
    assert.equal(E.folderOf('C:\\a\\b.json'), 'C:\\a');
    assert.equal(E.folderOf('/home/x/b.json'), '/home/x');
  });
});

describe('every DevTools export goes through it', () => {
  const ui = src('frontend/src/features/debug/debug-ui.ts');
  test('no Blob + <a download> left in the DevTools exports', () => {
    const exportSession = ui.slice(ui.indexOf('async exportSession()'), ui.indexOf('async exportSession()') + 900);
    assert.ok(exportSession.includes('exportText('), 'EXPORT (debug-btn-export)');
    assert.ok(exportSession.includes('safeStringify(session)'));
    assert.doesNotMatch(exportSession, /a\.download|createObjectURL/);
    const patches = ui.slice(ui.indexOf("this._get('playground-export')"), ui.indexOf("this._get('playground-export')") + 700);
    assert.ok(patches.includes('exportText('), 'EXPORT PATCH');
    assert.doesNotMatch(patches, /a\.download/);
  });

  test('EXPORT DIAG, REPORT and MEMORY show the full path with Open folder, and errors in words', () => {
    for (const cmd of ['export_diagnostics', 'generate_diagnostic_report', 'capture_memory_snapshot']) {
      const at = ui.indexOf(`invoke('${cmd}'`);
      assert.ok(at > 0, cmd);
      const near = ui.slice(at, at + 400);
      assert.ok(near.includes('showSaved('), `${cmd}: showSaved`);
      assert.ok(near.includes('showExportError('), `${cmd}: showExportError`);
    }
  });

  test('Replay Studio, the session recorder and the crash dump fallback say where or why', () => {
    const studio = src('frontend/src/features/debug/replay-studio.ts');
    assert.match(studio, /save_local_replay[\s\S]{0,500}showSaved\(/);
    assert.match(studio, /stopCapture\(\)[\s\S]{0,600}showSaved\(/);
    assert.match(src('frontend/src/features/settings/replay-watcher.ts'), /writeBundle\('list', path\)[\s\S]{0,300}showSaved\(/);
    const dbg = src('frontend/src/features/debug/debug.ts');
    assert.match(dbg, /_fallbackDownload\(dumpStr: string, reason: string, err\?: unknown\)[\s\S]{0,700}_a\.click\(\)/);
    assert.match(dbg, /dev\.export\.crashDumpFail/);
  });

  test('the notification centre can open the folder of an export', () => {
    assert.match(src('frontend/src/ui/notification-center.ts'), /registerNotifAction\('open-folder'[\s\S]{0,200}open_folder/);
  });

  test('the words exist in English and French with the same variables', () => {
    const vars = (s) => (s.match(/\{[a-z]+\}/gi) || []).sort().join(',');
    for (const k of Object.keys(en).filter((k) => k.startsWith('dev.export.')).concat(['watcher.noSnapshot'])) {
      assert.ok(fr[k], `${k} in fr`);
      assert.equal(vars(en[k]), vars(fr[k]), k);
    }
    assert.ok(Object.keys(en).filter((k) => k.startsWith('dev.export.')).length >= 14);
  });
});
