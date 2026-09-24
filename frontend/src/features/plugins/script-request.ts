// What a generated script actually SENDS.
//
// One function, `apiBodyFor`, turning a script-generator card into the method, path and body
// of a request. It is the last thing between what somebody clicks and what leaves the
// machine, so it is the piece worth executing in a test rather than reading as text: three
// CI gates check this list statically and none of them can see that a pruned `0` disappears
// or that a comma list arrives as one string.
//
// Lifted out of plugins.ts unchanged. That module imports the DOM, the toast layer and the
// app frame, so nothing in `tests/` could import it at all.

/**
 * A field the route wants as JSON, not as a string holding JSON.
 *
 * `{"doc": "{\"a\":1}"}` is valid JSON and is a STRING to the server, which then reads no
 * fields out of it and answers with the id of an empty document — a wrong answer rather
 * than an error. Unparseable text is left as-is so the generated script carries what was
 * typed and the server says what is wrong with it.
 */
export function _json(raw: string): any {
    const t = (raw || '').trim();
    if (!t) return {};
    try { return JSON.parse(t); } catch { return raw; }
}
/**
 * A comma-separated box as a list, or '' when it holds nothing.
 *
 * The '' is the point: `_prune` drops it, so an untouched field sends no key at all rather
 * than an empty array. An empty array is a REQUEST — "order these zero mods" — and the
 * answer to it is a message about permutations rather than about the box you left blank.
 */
export function _list(raw: string): string[] | '' {
    const xs = (raw || '').split(',').map((x) => x.trim()).filter(Boolean);
    return xs.length ? xs : '';
}

export function _prune(o: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(o)) if (v !== '' && v != null) out[k] = v;
    return out;
}
// Maps a repo/modpack/mod action to its HTTP call. Bodies use the exact
// camelCase field names the warp API expects (see src-tauri/src/api/mod.rs).
// Reads individual typed keys from `extra` (set in _collectActions) so values
// with spaces survive intact. Returns null for non-API actions.
export function apiBodyFor(a: any): { method: string; path: string; body: Record<string, any> } | null {
    const ex = a.extra || {};
    const s = (k: string) => (typeof ex[k] === 'string' ? ex[k] : (ex[k] != null ? String(ex[k]) : ''));
    const bool = (k: string) => ex[k] === true || ex[k] === 'true';
    const num = (k: string, d = 0) => { const v = parseInt(ex[k], 10); return isNaN(v) ? d : v; };
    switch (a.action_type) {
        case 'enable_mod':       return { method: 'POST', path: '/api/mods/enable',       body: { mod_id: a.target_id } };
        case 'disable_mod':      return { method: 'POST', path: '/api/mods/disable',      body: { mod_id: a.target_id } };
        case 'activate_profile': return { method: 'POST', path: '/api/profiles/activate', body: { profile_id: a.target_id } };
        case 'apply_plugin':     return { method: 'POST', path: '/api/plugins/apply',     body: { plugin_id: a.target_id, force_strict: false } };
        case 'compare_plugin':   return { method: 'POST', path: '/api/plugins/compare',   body: { plugin_id: a.target_id } };
        case 'enable_modpack':   return { method: 'POST', path: '/api/modpacks/enable',   body: { profile_id: a.target_id } };
        case 'disable_modpack':  return { method: 'POST', path: '/api/modpacks/disable',  body: { profile_id: a.target_id } };
        case 'update_modpack':   return { method: 'PUT', path: `/api/modpacks/${s('modpack_id') || 'MODPACK_ID'}`,
            body: { name: s('name'), dependency_mode: s('dependency_mode') || 'none' } };
        case 'sync_repo':        return { method: 'POST', path: '/api/repo/sync', body: {
            url: s('url') || 'REPO_URL', modsDir: s('mods_dir'), backupDir: s('backup_dir'), gameDir: s('game_dir'),
            choices: [], overwriteAll: bool('overwrite_all'), deleteExtra: bool('delete_extra'), downloadLimit: num('download_limit'),
            ...(s('password') ? { password: s('password') } : {}) } };
        case 'gen_repo':         return { method: 'POST', path: '/api/repo/gen', body: {
            profileIds: s('profile_id') ? [s('profile_id')] : [], outputDir: s('output_dir'), authorName: s('author') || 'Author',
            lightweight: bool('lightweight'), zipOutput: bool('zip'), zipMods: bool('zip_mods'), generateServer: bool('generate_server'),
            ...(s('compression') ? { compression: s('compression') } : {}),
            autoStart: bool('auto_start'), port: num('port', 8080) || 8080, adminPassword: s('admin_pass'), uploadLimit: num('upload_limit') } };
        case 'http_host':        return { method: 'POST', path: '/api/repo/host', body: {
            serveDir: s('serve_dir'), port: num('port', 8080) || 8080, uploadLimit: num('upload_limit') } };
        case 'cancel_sync':      return { method: 'DELETE', path: '/api/repo/sync/cancel', body: {} };
        case 'cancel_gen':       return { method: 'DELETE', path: '/api/repo/gen/cancel',  body: {} };
        case 'stop_http_host':   return { method: 'DELETE', path: '/api/repo/host',        body: {} };

        // ── Read-only (GET, unauthenticated) ──────────────────────────────
        case 'get_status':       return { method: 'GET', path: '/api/status',       body: {} };
        case 'list_mods':        return { method: 'GET', path: '/api/mods',         body: {} };
        case 'list_active_mods': return { method: 'GET', path: '/api/mods/active',  body: {} };
        case 'list_all_mods':    return { method: 'GET', path: '/api/mods/all',     body: {} };
        case 'list_profiles':    return { method: 'GET', path: '/api/profiles',     body: {} };
        case 'list_plugins':     return { method: 'GET', path: '/api/plugins',      body: {} };
        case 'list_modpacks':    return { method: 'GET', path: '/api/modpacks',     body: {} };
        case 'check_update':     return { method: 'GET', path: '/api/check-update', body: {} };
        case 'get_creator_id':   return { method: 'GET', path: '/api/creator-id',   body: {} };
        case 'api_health':       return { method: 'GET', path: '/api/health',       body: {} };
        case 'repo_list':        return { method: 'GET', path: '/api/repo/list',    body: {} };
        case 'repo_info':        return { method: 'GET',
            path: `/api/repo/info?url=${encodeURIComponent(s('url') || 'REPO_URL')}${s('password') ? `&password=${encodeURIComponent(s('password'))}` : ''}`, body: {} };

        // ── Mods / profiles / modpacks (writes — snake_case bodies) ───────
        case 'delete_mod':       return { method: 'DELETE', path: `/api/mods/${a.target_id || 'MOD_ID'}`, body: {} };
        case 'update_mod':       return { method: 'PUT', path: `/api/mods/${a.target_id || 'MOD_ID'}`,
            body: _prune({ name: s('name'), version: s('version'), author: s('author'), description: s('description') }) };
        case 'create_profile':   return { method: 'POST', path: '/api/profiles', body: {
            name: s('name'), game_name: s('game_name'), game_path: s('game_path'),
            mods_path: s('mods_path'), backup_path: s('backup_path') } };
        case 'update_profile':   return { method: 'PUT', path: `/api/profiles/${a.target_id || 'PROFILE_ID'}`,
            body: _prune({ name: s('name'), game_name: s('game_name'), color: s('color'), icon: s('icon'),
                game_path: s('game_path'), mods_path: s('mods_path'), backup_path: s('backup_path') }) };
        case 'delete_profile':   return { method: 'DELETE', path: `/api/profiles/${a.target_id || 'PROFILE_ID'}`, body: {} };
        case 'restart':          return { method: 'POST', path: '/api/restart', body: {} };
        case 'create_modpack':   return { method: 'POST', path: '/api/modpacks/create',
            body: _prune({ name: s('name'), description: s('description'), game_name: s('game_name'),
                sr_link: s('sr_link'), dependency_mode: s('dependency_mode') || 'none' }) };
        case 'delete_modpack':   return { method: 'DELETE', path: `/api/modpacks/${s('modpack_id') || 'MODPACK_ID'}`, body: {} };
        case 'repo_connect':     return { method: 'POST', path: '/api/repo/connect', body: { url: s('url') || 'REPO_URL' } };
        case 'repo_remove':      return { method: 'DELETE', path: '/api/repo', body: { url: s('url') || 'REPO_URL' } };
        case 'update_repo':      return { method: 'POST', path: '/api/repo/update', body: { repoDir: s('repoDir') || 'C:/MyRepo' } };

        // ── App Catalog ───────────────────────────────────────────────────
        case 'install_app':      return { method: 'POST', path: '/api/apps/install', body: _prune({
            appId: s('appId') || 'my-app', appTitle: s('appTitle') || s('appId') || 'My App',
            downloadUrl: s('downloadUrl') || 'https://…', fileType: s('fileType') || 'exe', installPath: s('installPath') }) };
        case 'launch_app':       return { method: 'POST', path: '/api/apps/launch', body: {
            appId: s('appId') || 'my-app', exePath: s('exePath') || 'C:/Apps/app.exe' } };
        case 'uninstall_app':    return { method: 'DELETE', path: `/api/apps/${s('appId') || 'APP_ID'}`, body: {} };
        case 'list_installed_apps': return { method: 'GET', path: '/api/apps', body: {} };

        case 'check_mod_updates':  return { method: 'POST', path: '/api/mod/check-updates',  body: {} };
        case 'run_launchpack':     return { method: 'POST', path: '/api/launchpack/run',      body: { id: a.target_id } };
        case 'run_task':           return { method: 'POST', path: '/api/schedule/run',        body: { id: a.target_id } };
        case 'run_benchmark': {
            const sources = s('sources').split(';').map(x => x.trim()).filter(Boolean);
            const dataset = (s('dataset') === 'real' || sources.length) ? 'real' : 'sandbox';
            return { method: 'POST', path: '/api/benchmark', body: { dataset, size: s('size') || 'M', mode: 'auto', sources } };
        }
        // The endpoints added with the doorbell, the keys, the catalogue sources and what a
        // repo carries. A generated script speaks this API, so an action in the catalogue
        // with no case here is one that renders a step and emits nothing.
        case 'signal': {
            // The payload is sent as JSON when it parses as JSON and as a string when it
            // does not — somebody typing a plain word should not have to quote it into one.
            const raw = s('data');
            let data: unknown = null;
            if (raw) { try { data = JSON.parse(raw); } catch { data = raw; } }
            return { method: 'POST', path: '/api/hook', body: { name: s('name'), data } };
        }
        case 'new_key':            return { method: 'POST', path: '/api/keys',                  body: _prune({ name: s('name'), kind: s('kind') || 'ed25519' }) };
        // `_prune` so an untouched field is ABSENT rather than empty: the route reads an empty
        // password as "the password is the empty string" and remembers it as one.
        case 'follow_catalog':     return { method: 'POST', path: '/api/catalogs',              body: { type: s('type') || 'plugin', url: s('url'), follow: bool('follow'), ..._prune({ password: s('password'), key: s('key'), passphrase: s('passphrase') }) } };
        case 'repo_take':          return { method: 'POST', path: '/api/repo/extras',           body: _prune({ url: s('url'), kind: s('kind'), id: s('id'), password: s('password') }) };
        case 'repo_sync_now':      return { method: 'POST', path: '/api/repo/sync-now',         body: _prune({ url: s('url'), repoProfile: s('repoProfile'), targetProfile: s('targetProfile'), gameDir: s('gameDir'), modsDir: s('modsDir'), backupDir: s('backupDir'), password: s('password'), overwriteAll: bool('overwriteAll'), deleteExtra: bool('deleteExtra') }) };
        // Typed as a comma-separated list, because a generated script has no place for a
        // multi-select. Split here so the body carries the array the route expects.
        case 'repo_gen_now':       return { method: 'POST', path: '/api/repo/gen-now',          body: _prune({ outputDir: s('outputDir'), authorName: s('authorName'), profileIds: s('profileIds').split(',').map((x) => x.trim()).filter(Boolean), seed: s('seed'), zipOutput: bool('zipOutput'), zipMods: bool('zipMods'), compression: s('compression') }) };
        case 'repo_host_now':      return { method: 'POST', path: '/api/repo/host-now',         body: _prune({ path: s('path'), port: parseInt(s('port'), 10) || 0, downloadPassword: s('downloadPassword') }) };
        case 'repo_update_now':    return { method: 'POST', path: '/api/repo/update-now',       body: _prune({ repoDir: s('repoDir'), authorName: s('authorName') }) };
        case 'content_id':         return { method: 'POST', path: '/api/content-id',            body: { kind: s('kind'), doc: _json(s('doc')) } };

        // Import / export. `_prune` matters here: these routes read an ABSENT path as
        // "open the picker" and an empty string as a path that is empty, which fails.
        case 'import_modlist':     return { method: 'POST', path: '/api/modlists/import',        body: _prune({ path: s('path') }) };
        case 'export_modlist':     return { method: 'POST', path: '/api/modlists/export',        body: _prune({ path: s('path') }) };
        case 'import_modpack':     return { method: 'POST', path: '/api/modpacks/import',        body: _prune({ path: s('path') }) };
        case 'export_modpack':     return { method: 'POST', path: '/api/modpacks/export',        body: _prune({ id: s('id'), destDir: s('destDir') }) };
        case 'import_plugin':      return { method: 'POST', path: '/api/plugins/import',         body: {} };
        case 'export_plugin':      return { method: 'POST', path: '/api/plugins/export',         body: _prune({ id: s('id'), destDir: s('destDir') }) };
        case 'uninstall_plugin':   return { method: 'DELETE', path: `/api/plugins/${s('id') || 'PLUGIN_ID'}`, body: {} };
        case 'import_data':        return { method: 'POST', path: '/api/data/import',            body: {} };
        case 'import_language':    return { method: 'POST', path: '/api/language/import',        body: _prune({ path: s('path') }) };

        // Reads a script can branch on
        case 'list_schedules':     return { method: 'GET', path: '/api/schedules',               body: {} };
        case 'list_catalogs':      return { method: 'GET', path: '/api/catalogs',                body: {} };
        case 'list_keys':          return { method: 'GET', path: '/api/keys',                    body: {} };
        case 'read_hook':          return { method: 'GET', path: `/api/hook/${encodeURIComponent(s('name') || 'HOOK_NAME')}`, body: {} };
        case 'clear_hooks':        return { method: 'DELETE', path: '/api/hook',                 body: {} };
        case 'schedule_runs':      return { method: 'GET', path: `/api/schedules/${encodeURIComponent(s('id') || 'TASK_ID')}/runs`, body: {} };

        // The resource governor (A4). A NAMED preset, never a per-disk rule: that route takes
        // the admin token only, which a generated script does not hold.
        case 'resources_status':   return { method: 'GET', path: '/api/resources',              body: {} };
        case 'hardware_info':      return { method: 'GET', path: '/api/resources/hardware',     body: {} };
        case 'resources_preset':   return { method: 'POST', path: '/api/resources/preset',      body: _prune({ name: s('name') || 'balanced', scope: s('scope'), ttlSecs: s('ttlSecs') ? num('ttlSecs') : '' }) };
        case 'resources_game_mode': return { method: 'POST', path: '/api/resources/game-mode', body: { mode: s('mode') || 'auto' } };
        case 'resources_queue':    return { method: 'POST', path: '/api/resources/queue',       body: _prune({ action: s('action') || 'pause_all', id: s('id') ? num('id') : '' }) };

        case 'mod_config':         return { method: 'POST', path: '/api/mod/config',             body: _prune({ modId: s('modId'), updateUrl: s('updateUrl'), repoModId: s('repoModId'), directUrl: s('directUrl') }) };
        case 'update_mods':        return { method: 'POST', path: '/api/mod/update',             body: _prune({ repoUrl: s('repoUrl') }) };
        // Typed as a comma-separated list for the same reason repo_gen_now's profileIds is:
        // a generated script has no place for a multi-select.
        // `_list`, so an empty box is pruned rather than sent as `[]`. Unlike repo_gen_now's
        // profileIds, which REFUSES an empty list by name, this route compares the list
        // against what is active: `[]` is "not a permutation" on a full profile — a message
        // about the wrong thing — and a silent no-op on an empty one. Absent, the answer
        // names the field. Kept on one line because three CI gates read these as text.
        case 'set_mod_order':      return { method: 'POST', path: '/api/mods/order',             body: _prune({ order: _list(s('order')), profileId: s('profileId') }) };

        case 'api_call':           return { method: (s('method') || 'GET').toUpperCase(), path: s('path') || '/api/status', body: _json(s('body')) };
        case 'open_view':          return { method: 'POST', path: '/api/view',                  body: { id: s('id') } };
        // `modsDir`, not `dir`. GenerateManifestArgs is camelCase and has no `dir` at all, so
        // serde dropped it without a word and the route ran with no source — the folder you
        // typed was ignored on every run of this action.
        case 'repo_manifest':      return { method: 'POST', path: '/api/repo/manifest',         body: _prune({ modsDir: s('dir') }) };
        case 'set_schedule':       return { method: 'POST', path: '/api/schedules/enabled',     body: { id: s('id'), enabled: bool('enabled') } };
        case 'discord_rpc':        return { method: 'POST', path: '/api/discord/rpc',          body: { enabled: bool('enabled') } };
        case 'export_data':        return { method: 'POST', path: '/api/data/export-auto',     body: _prune({ dir: s('dir'), name: s('name'), increment: s('increment') || 'paren' }) };

        // ── Privacy & telemetry / Session recorder / replay ───────────────
        case 'telemetry_consent':  return { method: 'POST', path: '/api/telemetry/consent',  body: { enabled: bool('enabled') } };
        case 'telemetry_settings': return { method: 'POST', path: '/api/telemetry/settings', body: { replay: bool('replay'), full: bool('full'), bench: bool('bench') } };
        case 'recorder_set':       return { method: 'POST', path: '/api/recorder',           body: { on: bool('on'), full: bool('full'), rust: bool('rust'), js: bool('js') } };
        case 'replay_export':      return { method: 'POST', path: '/api/replay/export',      body: {} };
        case 'replay_import':      return { method: 'POST', path: '/api/replay/import',      body: _prune({ path: s('path'), url: s('url') }) };
        default: return null;
    }
}