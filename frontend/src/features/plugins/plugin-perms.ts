// Which domains a plugin's permissions are grouped into, and what colour each wears.
//
// Its own module because two screens read it — the settings list and the per-plugin
// modal on a card — and the second cannot import the first: plugins.ts is where the
// card lives, so the import would point back at itself. A table of names and colours is
// not the sort of thing a 9000-line module should be the only owner of.

import { t } from '../../core/i18n.js';

export function permDomains(): { domain: string; color: string; scopes: string[] }[] {
    return [
        { domain: t('plugins.permDomMods')     || 'Mods',        color: '#3b82f6', scopes: ['mods.read', 'mods.write'] },
        { domain: t('plugins.permDomProfiles') || 'Profiles',    color: '#a855f7', scopes: ['profiles.read', 'profiles.write'] },
        { domain: t('plugins.permDomModpacks') || 'Modpacks',    color: '#8b5cf6', scopes: ['modpacks.read', 'modpacks.write'] },
        { domain: t('plugins.permDomPlugins')  || 'Plugins',     color: '#ec4899', scopes: ['plugins.read', 'plugins.write'] },
        { domain: t('plugins.permDomRepo')     || 'Server Repo', color: '#10b981', scopes: ['repo.read', 'repo.write'] },
        // Its own domain, not folded into Repo. An identity key is what proves you are you
        // to every protected source; granting "can publish a repo" must not also grant
        // "can mint the thing I sign with" — nor, now, "can see which identities exist".
        { domain: t('plugins.permDomKeys')      || 'Identity keys', color: '#eab308', scopes: ['keys.read', 'keys.write'] },
        { domain: t('plugins.permDomApps')     || 'App Catalog', color: '#f97316', scopes: ['app.read', 'app.write', 'catalog.read', 'catalog.write'] },
        // The three that had no checkbox at all, and are the ones worth reading twice.
        { domain: t('plugins.permDomData')      || 'Your data',    color: '#ef4444', scopes: ['data.read', 'data.write'] },
        { domain: t('plugins.permDomSchedules') || 'Automations',  color: '#06b6d4', scopes: ['schedules.read', 'schedules.write'] },
        { domain: t('plugins.permDomHooks')     || 'Hooks',        color: '#14b8a6', scopes: ['hooks.read', 'hooks.write'] },
        { domain: t('plugins.permDomSystem')    || 'The app itself', color: '#64748b', scopes: ['system.write'] },
        // Recording split from telemetry, and read split from write. Exporting a session is
        // reading a video of somebody's screen; it must not require — or imply — the power
        // to switch recording on.
        { domain: t('plugins.permDomTelemetry') || 'Privacy & recording', color: '#f43f5e', scopes: ['replay.read', 'replay.write', 'telemetry.write'] },
    ];
}

/**
 * How much a scope lets a plugin do, in three steps, for the creator's permission chooser
 * and the installed list's summary chip.
 *
 * Not a security boundary: the router enforces the scope itself. This is the answer to the
 * question an author or an installer actually asks ("is this one worth reading twice?"),
 * and it is kept beside permDomains() so a scope added there is one line away from its risk.
 *
 *  - low:    reads a list and changes nothing.
 *  - medium: changes your setup (mods, profiles, packs, catalogue entries, automations).
 *  - high:   runs programs, touches every file BMM holds, deletes plugins, signs as you,
 *            publishes to the network or watches your screen.
 */
export type ScopeRisk = 'low' | 'medium' | 'high';
const HIGH_SCOPES = new Set([
    'plugins.write', 'repo.write', 'keys.write', 'app.write', 'data.read', 'data.write',
    'system.write', 'replay.read', 'replay.write', 'telemetry.write',
]);
export function scopeRisk(scope: string): ScopeRisk {
    if (HIGH_SCOPES.has(scope)) return 'high';
    return scope.endsWith('.write') ? 'medium' : 'low';
}
/** The highest risk in a set of scopes, or null when it asks for nothing. */
export function maxScopeRisk(scopes: string[]): ScopeRisk | null {
    if (!scopes.length) return null;
    if (scopes.some((s) => scopeRisk(s) === 'high')) return 'high';
    if (scopes.some((s) => scopeRisk(s) === 'medium')) return 'medium';
    return 'low';
}
