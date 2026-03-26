/**
 * utils.js — Reusable Utility Functions
 */

export function escHtml(str) {
    if (str == null) return '';
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
    if (str == null) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
}
export function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
