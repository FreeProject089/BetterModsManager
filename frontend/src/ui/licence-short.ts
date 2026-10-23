// licence-short.ts — a licence expression, short enough for a badge.
//
// The Technical Architecture list printed the declared expression as the badge, so
// "GPL-3.0-only OR LicenseRef-Slint-Royalty-free-2.0 OR LicenseRef-Slint-Software-3.0" became a
// three-line slab beside a one-line row. The badge says the family; the full text stays in the
// tooltip and the detail pane, where it is read. Pure and import-free, so it loads in node.

/**
 * "GPL-3.0-only OR LicenseRef-Slint-…" → "GPL-3.0 / Slint"; "MIT OR Apache-2.0" → "MIT / Apache-2.0";
 * "MIT, with glyphs from…" → "MIT"; "(MIT OR GPL-3.0-or-later)" → "MIT / GPL-3.0+".
 * More than three alternatives keep the first two and say how many more. `custom` names a
 * licence that is prose with no identifier in front.
 */
export function shortLicense(expr: string | null | undefined, custom = 'Custom'): string {
    const s = (expr || '').trim();
    if (!s) return '';
    // Prose (a sentence, a URL, a note in parentheses): keep the identifier it starts with.
    if (/[,:;'"]|\(\s*[a-z]/.test(s)) {
        const first = s.match(/^\(?([A-Z][A-Za-z0-9.+-]*)/);
        return first && (/\d/.test(first[1]) || /^[A-Z]{2,}$/.test(first[1])) ? first[1] : custom;
    }
    const parts: string[] = [];
    for (const raw of s.replace(/[()]/g, ' ').split(/\s+(?:OR|AND)\s+|\//)) {
        let tok = raw.trim().replace(/\s+WITH\s+.*$/i, '');
        if (!tok) continue;
        const ref = tok.match(/^LicenseRef-([A-Za-z0-9]+)/);
        if (ref) tok = ref[1];
        else if (/\s/.test(tok)) tok = /^[A-Z]{2,}\s/.test(tok) ? tok.split(/\s+/)[0] : custom;
        else tok = tok.replace(/-only$/i, '').replace(/-or-later$/i, '+');
        if (!parts.includes(tok)) parts.push(tok);
    }
    if (!parts.length) return custom;
    // Alternatives in a stable order, so "MIT OR Apache-2.0" and "Apache-2.0 OR MIT" are one badge.
    if (!/\sAND\s/.test(s)) parts.sort((a, b) => a.localeCompare(b));
    return parts.length > 3 ? `${parts.slice(0, 2).join(' / ')} +${parts.length - 2}` : parts.join(' / ');
}
