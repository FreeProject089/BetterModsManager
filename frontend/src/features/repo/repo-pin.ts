// The signature the official repo list recorded for a repo URL, if it is listed there.
//
// `repo.ts` fills `window.__bmmRepoExpectedSig` from the OFFICIAL feed only (never from a
// followed catalogue, which would vouch for itself). Every caller of `sync_server_repo` passes
// this as `expectedSignature`: the backend then refuses a listed repo that serves no signature
// or another one (`check_repo_signature` in src-tauri/src/commands/repo.rs). Before, the pin was
// only compared for the badge, and the sync installed whatever the server sent.
//
// Same normalisation as `normRepoUrl` (repo.ts), kept here so the scheduler and the local API
// bridge can ask without importing the whole repo browser.
export function expectedRepoSignature(url: string | null | undefined): string | null {
    const key = String(url || '').trim().replace(/\/repo\.json$/i, '').replace(/\/+$/, '').toLowerCase();
    const map = (window as any).__bmmRepoExpectedSig as Record<string, string> | undefined;
    const sig = key && map ? map[key] : undefined;
    return typeof sig === 'string' && sig.trim() ? sig : null;
}
