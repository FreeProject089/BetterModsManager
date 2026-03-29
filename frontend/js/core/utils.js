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
//# sourceMappingURL=utils.js.map