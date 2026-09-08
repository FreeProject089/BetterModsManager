// The hosts the "network" CSP preset allows, against the COMPILED module.
//
// This preset is not advice: an extra policy is intersected with the shipped one, so its
// connect-src list is the complete set of hosts the app may still reach. Every host missing
// from it is a feature that stops working with no error a user can see — a CSP violation is
// a console message, and BMM has no console.
//
// It shipped as a hardcoded literal and had drifted. Each test below is one thing that
// literal broke; they are here so the list cannot drift again without going red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { originOf, connections, networkPolicy, networkPolicyFor, PROBE_ORIGINS, BETAHUB_ORIGIN, LOCAL_SOURCES } =
  await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/csp-hosts.js')).href);

/** What links.json ships by default. */
const PROD = {
  bettercommunity: 'https://bettercommunity.ch/',
  analytics_endpoint: 'https://telemetry.bettercommunity.ch/batch/',
  plugin_catalog: 'https://raw.githubusercontent.com/BetterDCS/BetterModsManager_Plugins/main/catalog.json',
  apps_catalog: 'https://raw.githubusercontent.com/BetterDCS/BMM_App_Catalogue/main/catalog.json',
  preset_catalog: 'https://bettercommunity.ch/api/catalog.json?project=bmm&kind=PRESET',
  catalog_index: 'https://bettercommunity.ch/api/catalogs.json',
  server_browse: 'https://bettercommunity.ch/api/repos.json',
  contributors: 'https://bettercommunity.ch/api/assets/contributors.json',
  autoupdate_api: 'https://api.github.com/repos/FreeProject089/BetterModsManager/releases',
  autoupdate_api_fallback: 'https://bettercommunity.ch/api/updates/bmm',
};
const policyProd = () => networkPolicyFor(PROD, 'https://bettercommunity.ch');

describe('originOf', () => {
  test('keeps the port, drops the path and query', () => {
    assert.equal(originOf('https://bc.example:8443/api/catalog.json?kind=THEME'), 'https://bc.example:8443');
  });
  test('anything that is not http(s) is not a connect-src source', () => {
    for (const v of ['', '  ', 'ipc://x', 'data:text/plain,hi', 'assets/links.json', 'javascript:alert(1)', null, undefined]) {
      assert.equal(originOf(v), '', `${String(v)} should not produce an origin`);
    }
  });
});

describe('the preset covers what the webview actually calls', () => {
  const p = policyProd();

  test('telemetry — the session-end beacon is connect-src, and the old literal blocked it', () => {
    assert.match(p, /https:\/\/telemetry\.bettercommunity\.ch/);
  });
  test('bug reports — BetaHub is a direct fetch, not an invoke', () => {
    assert.ok(p.includes(BETAHUB_ORIGIN), 'app.betahub.io missing: reporting a bug would stop working');
  });
  test('the offline probes — block both and BMM shows the offline banner for ever, online', () => {
    for (const o of PROBE_ORIGINS) assert.ok(p.includes(o), `${o} missing: the connectivity probe can never succeed`);
  });
  test('BetterCommunity itself, and the code hosts the catalogues live on', () => {
    for (const o of ['https://bettercommunity.ch', 'https://raw.githubusercontent.com', 'https://api.github.com']) {
      assert.ok(p.includes(o), `${o} missing`);
    }
  });
  test('the app itself, the IPC bridge and its own local API server', () => {
    for (const src of LOCAL_SOURCES) assert.ok(p.includes(src), `${src} missing`);
  });
  test('it closes the two cheap injection routes it always did', () => {
    assert.match(p, /object-src 'none'/);
    assert.match(p, /base-uri 'self'/);
  });
});

describe('it follows the app instead of a literal', () => {
  test('a self-hosted BetterCommunity ends up in the policy, and the default does not sneak in', () => {
    const p = networkPolicyFor({ ...PROD, bettercommunity: 'https://bc.myserver.lan:8443/' }, 'https://bc.myserver.lan:8443');
    assert.ok(p.includes('https://bc.myserver.lan:8443'), 'the self-hosted base is not allowed — the app is cut off from its own server');
  });
  test('a moved telemetry collector is followed', () => {
    const p = networkPolicyFor({ ...PROD, analytics_endpoint: 'https://t.example.org/batch/' }, 'https://bettercommunity.ch');
    assert.ok(p.includes('https://t.example.org'));
  });
  test('a catalogue given as an ARRAY has every entry allowed, not just the first', () => {
    const p = networkPolicyFor({ ...PROD, theme_catalog: ['https://a.example/c.json', 'https://b.example/c.json'] }, 'https://bettercommunity.ch');
    assert.ok(p.includes('https://a.example') && p.includes('https://b.example'));
  });
  test('an empty registry still produces a usable policy rather than a broken directive', () => {
    const p = networkPolicyFor({}, '');
    assert.match(p, /^connect-src 'self'/);
    assert.ok(p.includes(BETAHUB_ORIGIN), 'the fixed hosts must survive an empty registry');
    assert.ok(!/\s\s/.test(p), 'an empty source left a double space — the directive is malformed');
  });
});

describe('the connections table', () => {
  const c = connections(PROD, 'https://bettercommunity.ch');

  test('one row per ORIGIN — bettercommunity.ch serves six of these and must not be listed six times', () => {
    const origins = c.map((x) => x.origin);
    assert.equal(new Set(origins).size, origins.length, `duplicate origins: ${origins.join(', ')}`);
  });
  test('an origin used for several things keeps every reason, as separate keys', () => {
    const bc = c.find((x) => x.origin === 'https://bettercommunity.ch');
    assert.ok(bc.whatKeys.length > 1, 'bettercommunity.ch carries the site, the catalogues and updates — one reason is not the truth');
  });
  test('every reason is a WHOLE translation key — a joined string resolves to nothing', () => {
    // The first version concatenated the keys into one string, and the panel duly printed
    // "csp.use.bc, csp.use.catalog, csp.use.updates" where a sentence belonged.
    for (const row of c) {
      assert.ok(Array.isArray(row.whatKeys) && row.whatKeys.length, `${row.origin} has no reason`);
      for (const k of row.whatKeys) {
        assert.match(k, /^csp\.use\.[a-z]+$/, `"${k}" is not a single key and would render as itself`);
      }
      assert.equal(new Set(row.whatKeys).size, row.whatKeys.length, `${row.origin} repeats a reason`);
      assert.ok(['bc', 'code', 'support', 'net'].includes(row.group), `${row.origin} has group ${row.group}`);
    }
  });
  test('every key it emits exists in BOTH languages', async () => {
    const { readFileSync } = await import('node:fs');
    const en = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/en.json'), 'utf8'));
    const fr = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/fr.json'), 'utf8'));
    for (const row of c) for (const k of row.whatKeys) {
      assert.ok(en[k], `${k} missing from en.json`);
      assert.ok(fr[k], `${k} missing from fr.json`);
    }
    for (const k of ['csp.conns', 'csp.conns.note']) {
      assert.ok(en[k] && fr[k], `${k} missing from a language file`);
    }
  });
  test('every listed origin is in the policy, and the policy invents nothing else', () => {
    const p = networkPolicy(c);
    const sources = p.split(';')[0].replace('connect-src ', '').trim().split(/\s+/);
    const extra = sources.filter((s) => !LOCAL_SOURCES.includes(s));
    assert.deepEqual([...extra].sort(), c.map((x) => x.origin).sort());
  });
});

describe('the result is a policy the editor will accept', () => {
  test('it passes the same validation csp-boot.js applies at startup', async () => {
    const { validate, parsePolicy } = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/csp-editor.js')).href);
    const p = policyProd();
    // A policy the editor refuses is a preset button that writes an error message.
    assert.equal(validate(p), null);
    assert.ok(p.length <= 4096, `the derived policy is ${p.length} chars; the editor refuses over 4096`);
    const names = parsePolicy(p).map((d) => d.name);
    assert.deepEqual(names, ['connect-src', 'object-src', 'base-uri']);
  });
  test('it carries no source the editor would flag as weakening — a tightening preset that widens is a lie', async () => {
    const { parsePolicy } = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/csp-editor.js')).href);
    for (const d of parsePolicy(policyProd())) {
      assert.deepEqual(d.risks, [], `${d.name} carries ${d.risks.map((r) => r.source).join(', ')}`);
    }
  });
});
