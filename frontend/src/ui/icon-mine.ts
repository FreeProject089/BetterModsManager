// icon-mine.ts — « My icons »: the user's own icon library behind the shared picker.
//
// Kept apart from icon-pack.ts so the picker file stays a picker. This module owns:
//   · the stored list (localStorage: a convenience copy, every icon already travels INSIDE
//     whatever uses it as a data: URL, so losing the list never breaks a button or a tag);
//   · import of several files at once (SVG, PNG, JPEG, WebP, GIF), of a JSON bundle and of a
//     zip, and export of all or selected icons as a JSON bundle or a zip;
//   · the SVG sanitiser. An SVG shown through <img> cannot run script, but the same bytes are
//     shared (profiles, repos) and may land somewhere that inlines them, so only an allow-list
//     of drawing elements and attributes is kept, and the result is what gets stored.
//
// No network, no new dependency: the zip writer stores entries uncompressed, the reader uses
// the browser's own DecompressionStream for deflated ones.

const MINE_KEY = 'bmm_icon_library';
export const MINE_MAX = 300;                 // a picker, not an asset manager
const MINE_MAX_CHARS = 3_500_000;            // localStorage is small and shared with the whole app
export const ICON_FILE_MAX = 128 * 1024;     // per icon: it is embedded in whatever carries it
export const BUNDLE_FORMAT = 'bmm-icons';

export interface SavedIcon { id: string; name: string; data: string; at: number }

export function savedIcons(): SavedIcon[] {
    try {
        const raw = JSON.parse(localStorage.getItem(MINE_KEY) || '[]');
        return Array.isArray(raw) ? raw.filter((x) => x && typeof x.data === 'string') : [];
    } catch { return []; }        // corrupt storage must not take the picker down
}

function persist(list: SavedIcon[]): void {
    const next = list.slice(0, MINE_MAX);
    // A hard byte ceiling: many 128 KB icons is a quota error that would surface as some
    // unrelated setting failing to save.
    while (next.length > 1 && next.reduce((n, x) => n + x.data.length, 0) > MINE_MAX_CHARS) next.pop();
    try { localStorage.setItem(MINE_KEY, JSON.stringify(next)); } catch { /* full: the icon still works, it just is not remembered */ }
}

const cleanName = (n: string): string => String(n || '').replace(/\.[a-z0-9]+$/i, '').replace(/[<>:"/\\|?*]/g, '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 40) || 'icon';

/** Remember one icon. Returns the ref the caller should use. */
export function saveIcon(name: string, dataUrl: string): string {
    const list = savedIcons();
    if (list.some((x) => x.data === dataUrl)) return dataUrl;   // same bytes twice is the same icon
    persist([{ id: dataUrl, name: cleanName(name), data: dataUrl, at: Date.now() }, ...list]);
    return dataUrl;
}

export function renameIcon(id: string, name: string): void {
    persist(savedIcons().map((x) => (x.id === id ? { ...x, name: cleanName(name) } : x)));
}

export function forgetIcons(ids: string[]): void {
    const gone = new Set(ids);
    try { localStorage.setItem(MINE_KEY, JSON.stringify(savedIcons().filter((x) => !gone.has(x.id)))); } catch { /* ignore */ }
}
export function forgetIcon(id: string): void { forgetIcons([id]); }

// ── SVG sanitiser ────────────────────────────────────────────────────────────

const SVG_TAGS = new Set(['svg', 'g', 'defs', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'lineargradient',
    'radialgradient', 'stop', 'clippath', 'mask', 'use', 'symbol', 'title', 'desc']);
const SVG_ATTRS = new Set(['d', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'viewbox', 'points', 'transform',
    'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
    'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'offset', 'stop-color', 'stop-opacity', 'gradientunits',
    'gradienttransform', 'fx', 'fy', 'id', 'class', 'style', 'xmlns', 'preserveaspectratio', 'clip-path', 'mask', 'href', 'version',
    'maskunits', 'clippathunits', 'spreadmethod']);

/** Sanitised markup of an SVG document, or null when it is not a usable SVG. */
export function sanitizeSvgText(text: string): string | null {
    if (!text || text.length > ICON_FILE_MAX * 4) return null;
    let doc: Document;
    try { doc = new DOMParser().parseFromString(text, 'image/svg+xml'); } catch { return null; }
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
    const walk = (el: Element): void => {
        for (const child of Array.from(el.children)) {
            if (!SVG_TAGS.has(child.localName.toLowerCase())) { child.remove(); continue; }
            walk(child);
        }
        for (const a of Array.from(el.attributes)) {
            const n = a.name.toLowerCase().replace(/^xlink:/, '');
            const v = a.value;
            const bad = n.startsWith('on') || !SVG_ATTRS.has(n)
                || (n === 'href' && !v.startsWith('#'))
                || /url\s*\(\s*['"]?\s*[^#\s'"]/i.test(v) || /javascript:|data:|@import|expression\s*\(/i.test(v);
            if (bad) el.removeAttribute(a.name);
        }
    };
    walk(root);
    if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!root.getAttribute('viewBox') && !(root.getAttribute('width') && root.getAttribute('height'))) return null;
    return new XMLSerializer().serializeToString(root);
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
function b64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...Array.from(bytes.subarray(i, i + 0x8000)));
    return btoa(bin);
}
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const RASTER = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i;
const SVG_URI = /^data:image\/svg\+xml;base64,([a-z0-9+/=]+)$/i;

/** A data: URL that is safe to store, or null. SVG is re-sanitised, whatever its source. */
export function cleanIconData(data: string): string | null {
    if (typeof data !== 'string' || data.length > ICON_FILE_MAX * 2) return null;
    if (RASTER.test(data)) return data;
    const m = SVG_URI.exec(data);
    if (!m) return null;
    let text = '';
    try { text = new TextDecoder().decode(unb64(m[1])); } catch { return null; }
    const clean = sanitizeSvgText(text);
    return clean ? `data:image/svg+xml;base64,${b64(utf8(clean))}` : null;
}

function mimeOf(name: string, type: string): string {
    const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    if (type.startsWith('image/')) return type === 'image/jpg' ? 'image/jpeg' : type;
    return ({ svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as Record<string, string>)[ext] || '';
}

// ── zip (store only to write, store/deflate to read) ─────────────────────────

let CRC: Uint32Array | null = null;
function crc32(buf: Uint8Array): number {
    if (!CRC) {
        CRC = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
    }
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const f of files) {
        const name = utf8(f.name);
        const crc = crc32(f.bytes);
        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
        lh.setUint32(14, crc, true); lh.setUint32(18, f.bytes.length, true); lh.setUint32(22, f.bytes.length, true); lh.setUint16(26, name.length, true);
        parts.push(new Uint8Array(lh.buffer), name, f.bytes);
        const ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
        ch.setUint32(16, crc, true); ch.setUint32(20, f.bytes.length, true); ch.setUint32(24, f.bytes.length, true); ch.setUint16(28, name.length, true);
        ch.setUint32(42, offset, true);
        central.push(new Uint8Array(ch.buffer), name);
        offset += 30 + name.length + f.bytes.length;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of all) { out.set(p, at); at += p.length; }
    return out;
}

export async function readZip(buf: Uint8Array): Promise<{ name: string; bytes: Uint8Array }[]> {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out: { name: string; bytes: Uint8Array }[] = [];
    for (let i = 0; i < Math.min(count, 2000); i++) {
        if (dv.getUint32(p, true) !== 0x02014b50) break;
        const method = dv.getUint16(p + 10, true);
        const csize = dv.getUint32(p + 20, true);
        const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
        const lho = dv.getUint32(p + 42, true);
        const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
        p += 46 + nlen + elen + clen;
        if (name.endsWith('/') || csize > ICON_FILE_MAX * 4) continue;
        const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
        const raw = buf.subarray(start, start + csize);
        if (method === 0) out.push({ name, bytes: raw });
        else if (method === 8) {
            const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            out.push({ name, bytes: new Uint8Array(await new Response(stream).arrayBuffer()) });
        }
    }
    return out;
}

// ── import / export ──────────────────────────────────────────────────────────

export interface ImportResult { added: SavedIcon[]; skipped: string[] }

function toData(bytes: Uint8Array, mime: string): string | null {
    if (bytes.length > ICON_FILE_MAX || !mime) return null;
    if (mime === 'image/svg+xml') {
        const clean = sanitizeSvgText(new TextDecoder().decode(bytes));
        return clean ? `data:image/svg+xml;base64,${b64(utf8(clean))}` : null;
    }
    return `data:${mime};base64,${b64(bytes)}`;
}

/** Import any mix of images, bundles (.json) and zips. Everything that passes is saved. */
export async function importIconFiles(files: File[]): Promise<ImportResult> {
    const added: SavedIcon[] = [];
    const skipped: string[] = [];
    const known = new Set(savedIcons().map((x) => x.data));
    const take = (name: string, data: string | null, label: string): void => {
        if (!data) { skipped.push(label); return; }
        if (known.has(data)) return;
        known.add(data);
        added.push({ id: data, name: cleanName(name), data, at: Date.now() });
    };
    for (const f of files) {
        try {
            const lower = f.name.toLowerCase();
            if (lower.endsWith('.json')) {
                const j = JSON.parse(await f.text());
                const list = j && j.format === BUNDLE_FORMAT && Array.isArray(j.icons) ? j.icons : null;
                if (!list) { skipped.push(f.name); continue; }
                for (const it of list.slice(0, MINE_MAX)) take(String(it?.name || 'icon'), cleanIconData(String(it?.data || '')), `${f.name}: ${String(it?.name || '?')}`);
            } else if (lower.endsWith('.zip')) {
                for (const e of await readZip(new Uint8Array(await f.arrayBuffer()))) {
                    take(e.name.split('/').pop() || 'icon', toData(e.bytes, mimeOf(e.name, '')), `${f.name}: ${e.name}`);
                }
            } else {
                take(f.name, toData(new Uint8Array(await f.arrayBuffer()), mimeOf(f.name, f.type)), f.name);
            }
        } catch { skipped.push(f.name); }
    }
    if (added.length) persist([...added, ...savedIcons()]);
    return { added, skipped };
}

function download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Export icons (all when `ids` is empty) as a JSON bundle or a zip of image files. */
export function exportIcons(kind: 'json' | 'zip', ids: string[] = []): number {
    const want = new Set(ids);
    const list = savedIcons().filter((x) => !want.size || want.has(x.id));
    if (!list.length) return 0;
    if (kind === 'json') {
        const body = { format: BUNDLE_FORMAT, version: 1, exported: new Date().toISOString(), icons: list.map((x) => ({ name: x.name, data: x.data })) };
        download(new Blob([JSON.stringify(body, null, 1)], { type: 'application/json' }), 'bmm-icons.json');
    } else {
        const used = new Set<string>();
        const files = list.map((x) => {
            const m = /^data:image\/([a-z+]+);base64,(.*)$/i.exec(x.data);
            const ext = m ? (m[1] === 'svg+xml' ? 'svg' : m[1] === 'jpeg' ? 'jpg' : m[1]) : 'png';
            let base = cleanName(x.name), n = 1;
            while (used.has(`${base}.${ext}`)) base = `${cleanName(x.name)}-${++n}`;
            used.add(`${base}.${ext}`);
            return { name: `${base}.${ext}`, bytes: m ? unb64(m[2]) : new Uint8Array() };
        });
        download(new Blob([makeZip(files) as BlobPart], { type: 'application/zip' }), 'bmm-icons.zip');
    }
    return list.length;
}
