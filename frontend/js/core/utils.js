/**
 * utils.ts — Reusable Utility Functions
 */
export function escHtml(str) {
    if (str == null)
        return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
export function escAttr(str) {
    return escHtml(str);
}
/**
 * CWE-79: tagged template that HTML-escapes every interpolated `${}` by default.
 * Use it to build markup from untrusted data without remembering to wrap each
 * value in escHtml():
 *
 *   el.innerHTML = safeHtml`<h3>${mod.name}</h3><p>${mod.description}</p>`;
 *
 * Arrays are joined (already-built fragments). When a value is *known* trusted
 * markup (e.g. a sub-template you already escaped), wrap it in `trustedHtml(...)`
 * to opt out of escaping for that one slot.
 */
export class TrustedHtml {
    value;
    constructor(value) {
        this.value = value;
    }
    /** So a TrustedHtml also embeds correctly in a *plain* template literal
     *  (`${trustedFragment}`), not only inside safeHtml. safeHtml still checks
     *  `instanceof TrustedHtml` before any coercion, so this never double-escapes. */
    toString() { return this.value; }
}
export function trustedHtml(html) {
    return new TrustedHtml(html);
}
export function safeHtml(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v instanceof TrustedHtml) {
            out += v.value;
        }
        else if (Array.isArray(v)) {
            out += v.map(x => x instanceof TrustedHtml ? x.value : escHtml(String(x))).join('');
        }
        else {
            out += escHtml(v == null ? '' : String(v));
        }
        out += strings[i + 1];
    }
    return out;
}
export function escJs(str) {
    if (str == null)
        return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
}
export function formatBytes(bytes) {
    if (bytes === 0)
        return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
export function truncate(str, maxLen) {
    if (!str)
        return '';
    if (str.length <= maxLen)
        return str;
    return str.substring(0, maxLen) + '...';
}
//# sourceMappingURL=utils.js.map