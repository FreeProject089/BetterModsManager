// What address does a catalog entry actually mean?
//
// Every kind of BMM catalog — apps, plugins, themes, modpacks, tutorials, automations —
// is a document listing things that live somewhere else, and each of them had its own
// answer to this. Some accepted only absolute addresses, one resolved relative ones without
// re-checking the result, and the difference was invisible until somebody published a
// catalog one reader could follow and another could not.
//
// Pure, and deliberately importing nothing, so the modules that parse catalog documents can
// keep being testable without a network — which is the property that lets the dangerous case
// below be pinned by a test rather than argued about.

/**
 * Resolve an entry's address against the catalog it came from.
 *
 * Returns '' for anything that must not be fetched, so a caller has exactly one thing to
 * test rather than a scheme check of its own.
 *
 * **The order is the security property.** Resolution is not a narrowing operation: `new URL`
 * gives an absolute URL its own scheme regardless of the base, so `javascript:…` and
 * `file:///…` come out of it completely unchanged. Checking the INPUT and trusting the
 * output therefore lets through exactly the thing the check exists to stop. The check is on
 * the result, always.
 *
 * A relative address is allowed, and is the point: a folder of files with a catalog.json
 * beside them, dropped on GitHub or any static host, works without naming its own host
 * anywhere — so it survives being moved, mirrored or forked.
 *
 * A catalog read from a local file has no base to resolve against, and a relative name there
 * resolves to nothing rather than to a path on this machine.
 */
export function resolveEntryUrl(raw: unknown, source: unknown): string {
    const v = String(raw || '').trim();
    if (!v) return '';
    const base = String(source || '').trim();
    if (/^https?:\/\//i.test(v)) return v;
    if (!/^https?:\/\//i.test(base)) return '';
    try {
        const out = new URL(v, base).toString();
        return /^https?:\/\//i.test(out) ? out : '';
    } catch { return ''; }
}
