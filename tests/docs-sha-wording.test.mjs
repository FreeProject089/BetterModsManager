// BMM Docs must not promise more than the app does about an app's SHA-256.
//
// "SHA-256 verified before it can run" read as a hard refusal. It is one only on a link
// install (`link_install_app`, deeplink-guard): the in-app catalogue install turns a mismatch
// into a warning the user may accept (`install_app` with `allow_bad_checksum`, apps.rs). A doc
// promising MORE than the code is the direction nobody checks, so this one is checked — in the
// BMM Docs source and in the copy bundled into the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('the override still exists, so the docs must say it', () => {
    const apps = read('src-tauri/src/commands/apps.rs');
    assert.match(apps, /allow_bad_checksum/, 'the in-app override is gone — the docs can say "refused" again');
});

const PAGES = {
    en: ['BMM Docs/docs/how-it-works/security.md', 'frontend/assets/docs/en/how-it-works/security.md'],
    fr: ['BMM Docs/docs/how-it-works/security.fr.md', 'frontend/assets/docs/fr/how-it-works/security.md'],
};
for (const [lang, files] of Object.entries(PAGES)) {
    for (const rel of files) {
        test(`${rel}: link installs refuse, the in-app install warns and lets you decide`, (t) => {
            if (!existsSync(join(ROOT, rel))) { t.skip('BMM Docs not checked out'); return; }
            const row = read(rel).split('\n').find((l) => /^\| (App catalog download|Téléchargement depuis le catalogue d'apps) \|/.test(l));
            assert.ok(row, 'the app-catalogue row of the integrity table is gone');
            if (lang === 'en') {
                assert.ok(!/verified before it can run/.test(row), row);
                assert.match(row, /link/i);
                assert.match(row, /refus/i);
                assert.match(row, /warn/i);
            } else {
                assert.ok(!/vérifié avant toute exécution/.test(row), row);
                assert.match(row, /lien/i);
                assert.match(row, /refus/i);
                assert.match(row, /avertit|prévient/i);
            }
        });
    }
}
