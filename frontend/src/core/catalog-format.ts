// The universal catalogue format, in TypeScript — the FALLBACK reader.
//
// The reader of record is Rust (`src-tauri/src/commands/catalog_format.rs`, through the
// `catalog_normalize` command), because only it holds the trusted keys and can verify a signed
// catalogue. This file is the same conversion without the keys, for when there is no backend to
// ask (tests, a page opened outside the app) and for the cheap question every loader asks first:
// "is this a document I already understand?" — answered here without a round trip.
//
// The two implementations are held to ONE set of expected outputs: the Rust tests and
// tests/catalog-format.test.mjs read the same fixtures in src-tauri/tests/catalog_format and
// compare against the same expected/*.json. A change to one that the other does not make fails
// the build on that side.
//
// Pure: no Tauri, no DOM, no localStorage — imported by tests against the compiled file.

export const FORMAT = 'bmm-catalog';
export const FORMAT_VERSION = 1;
export const BMM_PAYLOAD_TYPE = 'application/vnd.bettermodsmanager.catalog+json; version=1';
/** BetterCommunity v2's feed type (`CATALOG_FEED_TYPE` in `@bc/contracts`). */
export const V2_FEED_TYPE = 'application/vnd.bettercommunity.catalog-feed+json; version=1';
export const MAX_SIGNATURES = 4;
export const MAX_ITEMS = 10_000;
const ISSUE_CAP = 200;

/** Item kind → the array its v1 document keeps entries in. Same pairs as the Rust KINDS. */
export const CATALOG_KIND_ARRAYS: ReadonlyArray<readonly [string, string]> = [
    ['app', 'apps'], ['plugin', 'plugins'], ['theme', 'themes'], ['preset', 'presets'],
    ['modpack', 'modpacks'], ['repo', 'repos'], ['tutorial', 'tutorials'], ['list', 'lists'],
];
export const CATALOG_KINDS = CATALOG_KIND_ARRAYS.map(([k]) => k);
export const isCatalogKind = (k: unknown): boolean => typeof k === 'string' && CATALOG_KINDS.includes(k);
const arrayOf = (kind: string): string | undefined => CATALOG_KIND_ARRAYS.find(([k]) => k === kind)?.[1];

/** v2 template → BMM kind, as v2's own v1 compat layer maps them. */
export const V2_TEMPLATE_KIND: Record<string, string> = {
    mods: 'app', plugins: 'plugin', themes: 'theme', presets: 'preset',
    resources: 'modpack', tutorials: 'tutorial', links: 'list',
};

export type Variant = 'universal' | 'dsse' | 'v2-feed' | 'v2-index' | 'bmm-index' | 'bmm-v1'
    | 'bcweb-items' | 'bare-array' | 'unknown';
export type Severity = 'error' | 'warning' | 'info';
export interface Issue { severity: Severity; code: string; path: string; message: string }
export type SigStatus = 'unsigned' | 'verified' | 'invalid' | 'unknown_key';
export interface SignatureReport { status: SigStatus; payloadType?: string; keyid?: string; reason?: string }

export interface CatalogDownload { url: string; sha256?: string; size?: number; file_type?: string }
export interface CatalogItem {
    kind: string; id: string; name?: string; name_i18n?: Record<string, string>;
    summary?: string; description?: string; description_i18n?: Record<string, string>;
    version?: string; author?: string; tags?: string[]; game?: string; icon?: string;
    homepage?: string; source_url?: string; license?: string; compatibility?: string[];
    download?: CatalogDownload; versions?: unknown[]; extra?: Record<string, unknown>;
}
export interface CatalogLink { kind: string; url: string; name?: string; description?: string; owner?: string; app?: string; items?: number; updated_at?: string }
export interface UniversalCatalog {
    format: typeof FORMAT; format_version: number; id?: string; name: string;
    name_i18n?: Record<string, string>; description?: string; description_i18n?: Record<string, string>;
    publisher?: string; homepage?: string; app?: string; issuer?: string; updated_at?: string;
    catalog_version?: string; partner_catalogs?: string[]; community_imports?: string[];
    items: CatalogItem[]; catalogs?: CatalogLink[];
}
export interface Normalized {
    catalog: UniversalCatalog;
    variant: Variant;
    variantLabel: string;
    innerVariant?: Variant;
    signature: SignatureReport;
    refused: boolean;
    issues: Issue[];
}

const LABEL: Record<Variant, string> = {
    'universal': 'bmm-catalog (universal)',
    'dsse': 'DSSE signed envelope',
    'v2-feed': 'BetterCommunity v2 feed',
    'v2-index': 'BetterCommunity v2 feed index',
    'bmm-index': 'catalogue index',
    'bmm-v1': 'BMM v1 catalogue',
    'bcweb-items': 'BCWEB pooled items',
    'bare-array': 'bare array (v1 themes / repo list)',
    'unknown': 'not a catalogue',
};

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

// ── detection ────────────────────────────────────────────────────────────────

const isEnvelope = (v: Obj): boolean => 'payloadType' in v && 'payload' in v && 'signatures' in v;

function looksLikeIndexDoc(v: Obj): boolean {
    const cats = Array.isArray(v.catalogs) ? v.catalogs : null;
    if (String(v.kind ?? '').toLowerCase() === 'catalog-index' && cats) return true;
    return !!cats && cats.length > 0 && cats.every((e: any) => isObj(e) && typeof e.url === 'string' && typeof e.type === 'string');
}

export function detectCatalog(v: unknown): Variant {
    if (Array.isArray(v)) return 'bare-array';
    if (!isObj(v)) return 'unknown';
    if (isEnvelope(v)) return 'dsse';
    if (v.format === FORMAT) return 'universal';
    if (v.kind === 'catalog' && isObj(v.catalog) && Array.isArray(v.items)) return 'v2-feed';
    if (v.kind === 'index' && Array.isArray(v.catalogs)) return 'v2-index';
    if (looksLikeIndexDoc(v)) return 'bmm-index';
    if (CATALOG_KIND_ARRAYS.some(([, a]) => Array.isArray(v[a]))) return 'bmm-v1';
    if (Array.isArray(v.items) && v.items.some((x: any) => isObj(x) && 'kind' in x)) return 'bcweb-items';
    return 'unknown';
}

/** True for what the v1 readers cannot read themselves: route these through normalisation. */
export function needsNormalizing(v: unknown): boolean {
    const d = detectCatalog(v);
    return d === 'universal' || d === 'dsse' || d === 'v2-feed' || d === 'v2-index';
}

// ── small readers (mirrors of the Rust helpers) ──────────────────────────────

function s(v: unknown, key: string): string | undefined {
    if (!isObj(v)) return undefined;
    const x = v[key];
    if (typeof x !== 'string') return undefined;
    const t = x.trim();
    return t ? Array.from(t).slice(0, 4000).join('') : undefined;
}
const first = (v: unknown, keys: string[]): string | undefined => {
    for (const k of keys) { const x = s(v, k); if (x !== undefined) return x; }
    return undefined;
};
function strings(v: unknown, cap: number): string[] {
    if (!Array.isArray(v)) return [];
    return v.filter((x) => typeof x === 'string').map((x: string) => x.trim()).filter(Boolean).slice(0, cap);
}
function i18n(v: unknown): Record<string, string> | undefined {
    if (!isObj(v)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, x] of Object.entries(v)) {
        const key = k.trim().toLowerCase();
        if (typeof x === 'string' && key && key.length <= 16) out[key] = x;
    }
    return Object.keys(out).length ? out : undefined;
}
function num(v: unknown, key: string): number | undefined {
    if (!isObj(v)) return undefined;
    const x = v[key];
    return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : undefined;
}
export function cleanSha(raw: string): string {
    let t = raw.trim();
    if (t.startsWith('sha256:') || t.startsWith('SHA256:')) t = t.slice(7);
    return /^[0-9a-fA-F]{64}$/.test(t) ? t.toLowerCase() : t;
}
export const isSha256 = (h: string): boolean => /^[0-9a-f]{64}$/.test(h);

function put(m: Obj, k: string, v: unknown): void { if (v !== undefined) m[k] = v; }

function download(url?: string, sha?: string, size?: number, fileType?: string): CatalogDownload | undefined {
    if (url === undefined) return undefined;
    const d: Obj = { url };
    put(d, 'sha256', sha === undefined ? undefined : cleanSha(sha));
    put(d, 'size', size);
    put(d, 'file_type', fileType);
    return d as CatalogDownload;
}

function base(kind: string, e: Obj, id?: string, name?: string): Obj {
    const m: Obj = { kind };
    put(m, 'id', id);
    put(m, 'name', name);
    put(m, 'name_i18n', i18n(e.name_i18n));
    put(m, 'summary', s(e, 'summary'));
    put(m, 'description', s(e, 'description'));
    put(m, 'description_i18n', i18n(e.description_i18n));
    put(m, 'version', s(e, 'version'));
    put(m, 'author', s(e, 'author'));
    const tags = strings(e.tags, 32);
    if (tags.length) m.tags = tags;
    return m;
}

const COMMON = ['kind', 'id', 'slug', 'name', 'title', 'name_i18n', 'summary', 'description', 'description_i18n', 'version', 'author', 'tags', 'sha256'];

function extraOf(e: Obj, extraKnown: string[]): Obj | undefined {
    const known = new Set([...COMMON, ...extraKnown]);
    const out: Obj = {};
    for (const [k, v] of Object.entries(e)) {
        if (!known.has(k) && !k.startsWith('_') && v !== null && v !== undefined) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
}

/** One v1 entry → one universal item. */
export function itemFromV1(kind: string, e: unknown): CatalogItem | undefined {
    if (!isObj(e)) return undefined;
    const id = first(e, ['id', 'slug']);
    let m: Obj;
    switch (kind) {
        case 'app': {
            m = base(kind, e, id, first(e, ['title', 'name']));
            const dl = isObj(e.download) ? e.download : {};
            put(m, 'download', download(s(dl, 'url'), s(dl, 'sha256'), num(dl, 'size'), s(dl, 'file_type')));
            put(m, 'icon', isObj(e.images) ? s(e.images, 'thumb') : undefined);
            put(m, 'extra', extraOf(e, ['download']));
            break;
        }
        case 'plugin':
            m = base(kind, e, id, first(e, ['name', 'title']));
            put(m, 'game', s(e, 'game'));
            put(m, 'download', download(first(e, ['download_url', 'downloadUrl']), s(e, 'sha256'), num(e, 'size')));
            put(m, 'icon', s(e, 'icon_url'));
            put(m, 'extra', extraOf(e, ['game', 'download_url', 'downloadUrl', 'size', 'icon_url']));
            break;
        case 'theme':
            m = base(kind, e, id, first(e, ['name', 'title']));
            put(m, 'download', download(first(e, ['download_url', 'downloadUrl', 'url']), s(e, 'sha256'), num(e, 'size')));
            put(m, 'extra', extraOf(e, ['download_url', 'downloadUrl', 'url', 'size']));
            break;
        case 'preset': case 'list': case 'tutorial': case 'modpack': case 'repo': {
            m = base(kind, e, id, first(e, ['name', 'title']));
            const meta = isObj(e.meta) ? e.meta : {};
            const url = first(e, ['download_url', 'downloadUrl', 'url']) ?? first(meta, ['download_url', 'downloadUrl']);
            if (kind === 'repo' && m.id === undefined) put(m, 'id', url);
            put(m, 'game', s(e, 'game'));
            put(m, 'download', download(url, s(e, 'sha256'), num(e, 'size')));
            put(m, 'extra', extraOf(e, ['download_url', 'downloadUrl', 'url', 'size', 'game', 'meta']));
            break;
        }
        default: return undefined;
    }
    return m as CatalogItem;
}

// ── issues ───────────────────────────────────────────────────────────────────

class Issues {
    list: Issue[] = [];
    push(severity: Severity, code: string, path: string, message: string) {
        if (this.list.length < ISSUE_CAP) this.list.push({ severity, code, path, message });
    }
    err(c: string, p: string, m: string) { this.push('error', c, p, m); }
    warn(c: string, p: string, m: string) { this.push('warning', c, p, m); }
    info(c: string, p: string, m: string) { this.push('info', c, p, m); }
}
function dedupeIssues(list: Issue[]): Issue[] {
    const seen = new Set<string>();
    return list.filter((i) => { const k = `${i.code}\u0000${i.path}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ── normalisation ────────────────────────────────────────────────────────────

export interface NormalizeOptions { kind?: string; sourceUrl?: string }

const emptyCatalog = (name = ''): UniversalCatalog => ({ format: FORMAT, format_version: FORMAT_VERSION, name, items: [] });

function headFromV1(v: Obj): Obj {
    const m: Obj = { format: FORMAT, format_version: FORMAT_VERSION };
    put(m, 'id', s(v, 'id'));
    m.name = s(v, 'name') ?? '';
    put(m, 'name_i18n', i18n(v.name_i18n));
    put(m, 'description', s(v, 'description'));
    put(m, 'description_i18n', i18n(v.description_i18n));
    put(m, 'publisher', first(v, ['publisher', 'owner', 'author']));
    put(m, 'homepage', s(v, 'homepage'));
    put(m, 'app', s(v, 'app'));
    put(m, 'updated_at', first(v, ['updated_at', 'updatedAt', 'generated_at']));
    put(m, 'catalog_version', s(v, 'version'));
    for (const k of ['partner_catalogs', 'community_imports']) {
        const l = strings(v[k], 200);
        if (l.length) m[k] = l;
    }
    return m;
}

function linksFromIndex(arr: unknown[], is: Issues, at: string): CatalogLink[] {
    const out: CatalogLink[] = [];
    arr.forEach((e, i) => {
        const kind = (s(e, 'type') ?? s(e, 'kind'))?.toLowerCase();
        const url = s(e, 'url');
        if (!kind || !url) { is.warn('index.entry', `${at}.catalogs[${i}]`, 'an index entry needs a type and a url'); return; }
        const m: Obj = { kind, url };
        for (const k of ['name', 'description', 'owner', 'app']) put(m, k, s(e, k));
        put(m, 'items', num(e, 'items'));
        put(m, 'updated_at', first(e, ['updated_at', 'updatedAt']));
        out.push(m as CatalogLink);
    });
    return out;
}

function convert(v: any, variant: Variant, opts: NormalizeOptions, is: Issues, at: string): UniversalCatalog {
    switch (variant) {
        case 'universal': {
            const c = JSON.parse(JSON.stringify(v));
            for (const it of Array.isArray(c.items) ? c.items : []) {
                if (isObj(it?.download) && typeof it.download.sha256 === 'string') it.download.sha256 = cleanSha(it.download.sha256);
            }
            return c;
        }
        case 'bmm-v1': case 'bare-array': case 'bcweb-items': {
            const head = headFromV1(isObj(v) ? v : {});
            const items: CatalogItem[] = [];
            const take = (kind: string, arr: unknown[], path: string) => {
                arr.forEach((e, i) => {
                    const it = itemFromV1(kind, e);
                    if (it) items.push(it); else is.warn('item.not_object', `${path}[${i}]`, 'not an object: dropped');
                });
            };
            if (Array.isArray(v)) {
                let kind = 'theme';
                if (opts.kind === 'theme' || opts.kind === 'repo') kind = opts.kind;
                else if (v.some((e) => isObj(e) && ('vars' in e || 'colors' in e))) kind = 'theme';
                else if (v.length && v.every((e) => isObj(e) && 'url' in e && !('vars' in e))) kind = 'repo';
                take(kind, v, at);
            } else {
                for (const [kind, key] of CATALOG_KIND_ARRAYS) if (Array.isArray(v[key])) take(kind, v[key], `${at}.${key}`);
                if (Array.isArray(v.items)) {
                    v.items.forEach((e: any, i: number) => {
                        const kind = (s(e, 'kind') ?? '').toLowerCase();
                        if (!isCatalogKind(kind)) { is.warn('item.kind', `${at}.items[${i}].kind`, `unknown kind ${JSON.stringify(kind)}: dropped`); return; }
                        const flat: Obj = { ...e };
                        if (isObj(e.meta)) for (const [k, x] of Object.entries(e.meta)) if (!(k in flat)) flat[k] = x;
                        const it = itemFromV1(kind, flat);
                        if (it) items.push(it);
                    });
                }
            }
            const seen = new Set<string>();
            head.items = items.filter((it) => {
                if (it.id === undefined) return true;
                const key = `${it.kind}\u0000${String(it.id).toLowerCase()}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            return head as UniversalCatalog;
        }
        case 'bmm-index': {
            const head = headFromV1(v);
            head.items = [];
            head.catalogs = linksFromIndex(Array.isArray(v.catalogs) ? v.catalogs : [], is, at);
            return head as UniversalCatalog;
        }
        case 'v2-feed': return fromV2Feed(v, is, at);
        case 'v2-index': {
            const head: Obj = { format: FORMAT, format_version: FORMAT_VERSION };
            const issuer = s(v, 'issuer');
            head.name = issuer ? `${issuer} catalogues` : '';
            put(head, 'issuer', issuer);
            put(head, 'updated_at', s(v, 'generated_at'));
            head.items = [];
            const links: CatalogLink[] = [];
            (Array.isArray(v.catalogs) ? v.catalogs : []).forEach((c: any, i: number) => {
                const kind = V2_TEMPLATE_KIND[s(c, 'template') ?? ''];
                const url = s(c, 'feed_url');
                if (!kind || !url) { is.warn('index.entry', `${at}.catalogs[${i}]`, 'a v2 index entry with no known template or no feed_url: dropped'); return; }
                const m: Obj = { kind, url };
                put(m, 'name', s(c, 'name'));
                put(m, 'description', s(c, 'summary'));
                put(m, 'items', num(c, 'items_count'));
                put(m, 'updated_at', s(c, 'updated_at'));
                links.push(m as CatalogLink);
            });
            head.catalogs = links;
            return head as UniversalCatalog;
        }
        case 'unknown':
            is.err('format.unknown', at, 'not a catalogue BMM can read');
            return emptyCatalog();
        default:
            return emptyCatalog();
    }
}

function fromV2Feed(v: Obj, is: Issues, at: string): UniversalCatalog {
    const cat = isObj(v.catalog) ? v.catalog : {};
    const template = s(cat, 'template') ?? '';
    const kind = V2_TEMPLATE_KIND[template];
    const head: Obj = { format: FORMAT, format_version: FORMAT_VERSION };
    put(head, 'id', s(cat, 'slug'));
    head.name = s(cat, 'name') ?? '';
    put(head, 'description', s(cat, 'summary'));
    put(head, 'homepage', s(cat, 'url'));
    put(head, 'publisher', isObj(cat.project) ? s(cat.project, 'name') : undefined);
    put(head, 'issuer', s(v, 'issuer'));
    put(head, 'updated_at', s(v, 'generated_at'));
    if (!kind) {
        is.err('v2.template', `${at}.catalog.template`, `unknown v2 template ${JSON.stringify(template)}`);
        head.items = [];
        return head as UniversalCatalog;
    }
    const items: CatalogItem[] = [];
    (Array.isArray(v.items) ? v.items : []).forEach((it: any, i: number) => {
        const meta = isObj(it?.meta) ? it.meta : {};
        const m: Obj = { kind };
        put(m, 'id', first(it, ['slug', 'id']));
        put(m, 'name', s(meta, 'name'));
        put(m, 'summary', s(meta, 'summary'));
        put(m, 'description', s(meta, 'description') ?? s(meta, 'summary'));
        const latest = s(it, 'latest_version');
        put(m, 'version', latest);
        const tags = strings(meta.tags, 32);
        if (tags.length) m.tags = tags;
        put(m, 'license', s(meta, 'licence'));
        const compat = strings(meta.compatibility, 20);
        if (compat.length) m.compatibility = compat;
        put(m, 'homepage', s(meta, 'homepage_url'));
        put(m, 'source_url', s(meta, 'source_url'));
        const versions: any[] = Array.isArray(it?.versions) ? it.versions : [];
        const current = versions.find((x) => s(x, 'version') === latest) ?? versions[0];
        const f = Array.isArray(current?.files) ? current.files[0] : undefined;
        if (f) put(m, 'download', download(s(f, 'url'), s(f, 'sha256'), num(f, 'size')));
        if (versions.length) {
            m.versions = versions.map((x) => {
                const vm: Obj = {};
                put(vm, 'version', s(x, 'version'));
                put(vm, 'published_at', s(x, 'published_at'));
                put(vm, 'changelog', s(x, 'changelog'));
                vm.files = (Array.isArray(x?.files) ? x.files : []).map((ff: any) => {
                    const fm: Obj = {};
                    put(fm, 'name', s(ff, 'name'));
                    put(fm, 'size', num(ff, 'size'));
                    const h = s(ff, 'sha256');
                    put(fm, 'sha256', h === undefined ? undefined : cleanSha(h));
                    put(fm, 'url', s(ff, 'url'));
                    return fm;
                });
                return vm;
            });
        }
        const extra: Obj = {};
        put(extra, 'external_id', s(it, 'id'));
        put(extra, 'revision', s(it, 'revision'));
        put(extra, 'rights_statement', s(meta, 'rights_statement'));
        if (Object.keys(extra).length) m.extra = extra;
        if (m.id === undefined) is.warn('item.no_id', `${at}.items[${i}]`, 'a v2 item with no slug or id');
        items.push(m as CatalogItem);
    });
    head.items = items;
    return head as UniversalCatalog;
}

// ── validation ───────────────────────────────────────────────────────────────

/** http(s), or a relative name. Never javascript:, file:, data:, protocol-relative. */
export function urlOk(u: string): boolean {
    const low = String(u).trim().toLowerCase();
    if (low.startsWith('https://') || low.startsWith('http://')) return true;
    const beforeSlash = low.split('/')[0];
    return !beforeSlash.includes(':') && !low.startsWith('//') && low.length > 0;
}

export function validateCatalog(v: unknown): Issue[] {
    const is = new Issues();
    validateInto(v, is);
    return dedupeIssues(is.list);
}

function validateInto(v: unknown, is: Issues): void {
    if (!isObj(v)) { is.err('format.not_object', '$', 'a catalogue is a JSON object'); return; }
    if (v.format === FORMAT) { /* ok */ }
    else if (typeof v.format === 'string') is.err('format.name', '$.format', `format is ${JSON.stringify(v.format)}, expected "${FORMAT}"`);
    else is.err('format.missing', '$.format', `no "format": "${FORMAT}"`);
    const fv = v.format_version;
    const ver = Number.isInteger(fv) && fv >= 0 ? fv : (typeof fv === 'string' && /^\s*\d+/.test(fv) ? parseInt(fv, 10) : undefined);
    if (ver === undefined) is.err('format.version', '$.format_version', 'format_version must be an integer');
    else if (ver > FORMAT_VERSION) is.err('format.too_new', '$.format_version', `format_version ${ver} is newer than this BMM reads (${FORMAT_VERSION})`);
    else if (ver === 0) is.err('format.version', '$.format_version', 'format_version starts at 1');
    else if (!Number.isInteger(fv)) is.warn('format.version_type', '$.format_version', 'write format_version as an integer');
    if (!(typeof v.name === 'string' && v.name.trim())) is.warn('catalog.no_name', '$.name', 'a catalogue should have a name');
    for (const k of ['name_i18n', 'description_i18n']) checkI18n(v[k], `$.${k}`, is);
    if (typeof v.homepage === 'string' && !/^https?:\/\//i.test(v.homepage)) is.warn('url.scheme', '$.homepage', 'homepage must be http(s)');
    let items: unknown[] = [];
    if (Array.isArray(v.items)) items = v.items;
    else if (v.items !== undefined) is.err('items.not_array', '$.items', 'items must be an array');
    else if (v.catalogs === undefined) is.err('items.missing', '$.items', 'no items array');
    if (items.length > MAX_ITEMS) is.err('items.too_many', '$.items', `${items.length} items: more than ${MAX_ITEMS}`);
    const seen = new Map<string, number>();
    items.slice(0, MAX_ITEMS).forEach((it, i) => {
        const at = `$.items[${i}]`;
        if (!isObj(it)) { is.err('item.not_object', at, 'an item is an object'); return; }
        const kind = typeof it.kind === 'string' ? it.kind : '';
        if (!kind) is.err('item.no_kind', `${at}.kind`, 'an item needs a kind');
        else if (!isCatalogKind(kind)) is.err('item.kind', `${at}.kind`, `unknown kind ${JSON.stringify(kind)} (one of: ${CATALOG_KINDS.join(', ')})`);
        const id = typeof it.id === 'string' ? it.id.trim() : '';
        if (!id) is.err('item.no_id', `${at}.id`, 'an item needs an id');
        else {
            const key = `${kind}\u0000${id.toLowerCase()}`;
            if (seen.has(key)) is.warn('item.duplicate', `${at}.id`, `${kind} ${JSON.stringify(id)} already listed at items[${seen.get(key)}]: the first wins`);
            else seen.set(key, i);
        }
        if (!(typeof it.name === 'string' && it.name.trim())) is.warn('item.no_name', `${at}.name`, 'an item should have a name');
        for (const k of ['name_i18n', 'description_i18n']) checkI18n(it[k], `${at}.${k}`, is);
        if ('tags' in it && !(Array.isArray(it.tags) && it.tags.every((x: unknown) => typeof x === 'string'))) is.warn('item.tags', `${at}.tags`, 'tags must be an array of strings');
        const inlineTheme = kind === 'theme' && isObj(it.extra) && 'vars' in it.extra;
        const cbmpPack = kind === 'modpack' && isObj(it.extra) && 'file' in it.extra;
        const d = it.download;
        if (d === undefined) {
            if (!inlineTheme && !cbmpPack) is.err('download.missing', `${at}.download`, kind === 'repo' ? 'a repo link needs download.url (the repo address)' : 'nothing to download: download.url is missing');
        } else {
            const u = isObj(d) ? d.url : undefined;
            if (typeof u !== 'string') is.err('download.no_url', `${at}.download.url`, 'download.url is missing');
            else if (!urlOk(u)) is.err('url.scheme', `${at}.download.url`, `${JSON.stringify(u)} is not an http(s) address or a relative name`);
            else if (u.toLowerCase().startsWith('http://')) is.info('url.http', `${at}.download.url`, 'plain http: prefer https');
            const h = isObj(d) ? d.sha256 : undefined;
            if (h === undefined) {
                if (kind !== 'repo' && kind !== 'tutorial') is.warn('download.no_sha256', `${at}.download.sha256`, kind === 'plugin' ? 'no sha256: BMM 1.1+ refuses to install a catalogue plugin without one' : 'no sha256: the file cannot be checked after download');
            } else if (typeof h !== 'string') is.err('download.bad_sha256', `${at}.download.sha256`, 'sha256 must be a string');
            else if (!isSha256(h)) is.err('download.bad_sha256', `${at}.download.sha256`, 'sha256 must be 64 lower-case hex digits');
            if (isObj(d) && 'size' in d && !(Number.isInteger(d.size) && d.size >= 0)) is.warn('download.size', `${at}.download.size`, 'size must be a whole number of bytes');
        }
        (Array.isArray(it.versions) ? it.versions : []).forEach((ver: any, vi: number) => {
            (Array.isArray(ver?.files) ? ver.files : []).forEach((f: any, fi: number) => {
                const fat = `${at}.versions[${vi}].files[${fi}]`;
                if (typeof f?.sha256 === 'string' && !isSha256(f.sha256)) is.err('download.bad_sha256', `${fat}.sha256`, 'sha256 must be 64 lower-case hex digits');
                if (typeof f?.url === 'string' && !urlOk(f.url)) is.err('url.scheme', `${fat}.url`, 'not an http(s) address');
            });
        });
        if ('signature' in it || 'signatures' in it) is.info('item.signature_ignored', `${at}.signature`, 'per-item signatures are not read: sign the whole catalogue (DSSE envelope)');
    });
    (Array.isArray(v.catalogs) ? v.catalogs : []).forEach((l: any, i: number) => {
        const at = `$.catalogs[${i}]`;
        const kind = typeof l?.kind === 'string' ? l.kind : '';
        if (!isCatalogKind(kind)) is.err('link.kind', `${at}.kind`, `unknown kind ${JSON.stringify(kind)}`);
        if (!(typeof l?.url === 'string' && /^https?:\/\//i.test(l.url))) is.err('link.url', `${at}.url`, 'a linked catalogue needs an http(s) url');
    });
}

function checkI18n(v: unknown, at: string, is: Issues): void {
    if (v === undefined) return;
    if (!isObj(v)) { is.warn('i18n.not_map', at, 'an i18n field is a map of language → text'); return; }
    for (const [k, x] of Object.entries(v)) {
        if (typeof x !== 'string') is.warn('i18n.value', `${at}.${k}`, 'translations are strings');
        if (!k || k.length > 16) is.warn('i18n.lang', `${at}.${k}`, 'not a language tag');
    }
}

// ── envelope (decoded, NOT verified — only the backend holds keys) ───────────

function b64ToBytes(b64: string): Uint8Array | null {
    const t = b64.trim();
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(t)) return null;
    try {
        const bin = atob(t.length % 4 ? t + '='.repeat(4 - (t.length % 4)) : t);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    } catch { return null; }
}

function openEnvelope(env: Obj): { report: SignatureReport; payload?: unknown } {
    const pt = typeof env.payloadType === 'string' ? env.payloadType : undefined;
    const bad = (reason: string) => ({ report: { status: 'invalid' as SigStatus, payloadType: pt, reason } });
    if (pt !== V2_FEED_TYPE && pt !== BMM_PAYLOAD_TYPE) return bad('unknown payloadType');
    const bytes = typeof env.payload === 'string' ? b64ToBytes(env.payload) : null;
    if (!bytes) return bad('payload is not base64');
    if (!Array.isArray(env.signatures) || !env.signatures.length || env.signatures.length > MAX_SIGNATURES) return bad('1 to 4 signatures expected');
    const keyid = env.signatures.map((x: any) => x?.keyid).find((k: unknown) => typeof k === 'string');
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { return bad('the signed payload is not JSON'); }
    return { report: { status: 'unknown_key', payloadType: pt, keyid, reason: 'not verified: no backend to check the signature' }, payload };
}

/** Any variant → universal. The fallback for `catalog_normalize`; signatures are not verified. */
export function normalizeCatalog(v: unknown, opts: NormalizeOptions = {}): Normalized {
    const variant = detectCatalog(v);
    const is = new Issues();
    let signature: SignatureReport = { status: 'unsigned' };
    let innerVariant: Variant | undefined;
    let refused = false;
    let catalog: UniversalCatalog;
    if (variant === 'dsse') {
        const o = openEnvelope(v as Obj);
        signature = o.report;
        if (o.report.status === 'invalid') {
            is.err('signature.invalid', '$.signatures', o.report.reason || 'the signature does not verify');
            refused = true;
            catalog = emptyCatalog();
        } else {
            innerVariant = detectCatalog(o.payload);
            if (innerVariant === 'dsse') {
                is.err('signature.nested', '$.payload', 'an envelope inside an envelope is not read');
                refused = true;
                catalog = emptyCatalog();
            } else catalog = convert(o.payload, innerVariant, opts, is, '$.payload');
        }
    } else {
        catalog = convert(v, variant, opts, is, '$');
    }
    if (signature.status === 'unknown_key') is.warn('signature.unknown_key', '$.signatures', 'signed, but by a key this BMM does not know: read as unverified');
    if (!refused) {
        const found = new Issues();
        validateInto(catalog, found);
        is.list.push(...found.list);
        if (is.list.some((i) => i.code === 'format.too_new')) refused = true;
        if (Array.isArray(catalog.items)) {
            catalog.items = catalog.items.filter((it) => typeof it?.id === 'string' && isCatalogKind(it?.kind));
        }
    }
    if (opts.kind && !refused && isCatalogKind(opts.kind)) {
        const any = (catalog.items || []).some((i) => i.kind === opts.kind);
        if (!any && !(catalog.catalogs || []).length) is.info('kind.none', '$.items', `no ${opts.kind} item in this catalogue`);
    }
    return { catalog, variant, variantLabel: LABEL[variant], ...(innerVariant ? { innerVariant } : {}), signature, refused, issues: dedupeIssues(is.list) };
}

// ── the reverse view, for the existing readers ──────────────────────────────

/** A universal catalogue as the v1 document of ONE kind (or `index`). Mirrors Rust `to_legacy`. */
export function toLegacy(u: UniversalCatalog, kind: string): Obj {
    const out: Obj = { version: s(u, 'catalog_version') ?? '1.0', name: s(u, 'name') ?? '', description: s(u, 'description') ?? '' };
    if (kind === 'index') {
        out.kind = 'catalog-index';
        out.catalogs = (u.catalogs || []).map((l) => { const { kind: k, ...rest } = l as Obj; return { ...rest, type: k }; });
        return out;
    }
    if (kind === 'app') for (const k of ['partner_catalogs', 'community_imports']) if ((u as Obj)[k] !== undefined) out[k] = (u as Obj)[k];
    const key = arrayOf(kind);
    if (!key) return out;
    out[key] = (u.items || []).filter((it) => it.kind === kind).map((it) => legacyEntry(kind, it)).filter(Boolean);
    return out;
}

function legacyEntry(kind: string, it: CatalogItem): Obj | null {
    const m: Obj = { ...(isObj(it.extra) ? it.extra : {}) };
    const id = s(it, 'id');
    if (!id) return null;
    const name = s(it, 'name') ?? id;
    const url = isObj(it.download) ? s(it.download, 'url') : undefined;
    const sha = isObj(it.download) ? s(it.download, 'sha256') : undefined;
    m.id = id;
    for (const k of ['description', 'author', 'version']) { const x = s(it, k); if (x !== undefined) m[k] = x; }
    if (it.tags !== undefined) m.tags = it.tags;
    if (it.name_i18n !== undefined) m.name_i18n = it.name_i18n;
    if (it.description_i18n !== undefined) m.description_i18n = it.description_i18n;
    switch (kind) {
        case 'app': {
            if (!url) return null;
            m.title = name;
            const d: Obj = isObj(it.download) ? it.download : {};
            const ext = url.split('.').pop() || '';
            const ft = s(d, 'file_type') ?? (ext.length <= 5 && !ext.includes('/') ? ext : 'zip').toLowerCase();
            const dm: Obj = { url, file_type: ft };
            if (d.size !== undefined) dm.size = d.size;
            if (sha !== undefined) dm.sha256 = sha;
            m.download = dm;
            if (!('description' in m)) m.description = '';
            const icon = s(it, 'icon');
            if (icon && !('images' in m)) m.images = { thumb: icon };
            if (!('requirements' in m) && Array.isArray(it.compatibility) && it.compatibility.length) {
                m.requirements = it.compatibility.filter((x) => typeof x === 'string').join(', ');
            }
            break;
        }
        case 'plugin': {
            if (!url) return null;
            m.name = name;
            m.download_url = url;
            if (sha !== undefined) m.sha256 = sha;
            const game = s(it, 'game') ?? (Array.isArray(it.compatibility) && typeof it.compatibility[0] === 'string' ? it.compatibility[0] : undefined);
            if (game !== undefined) m.game = game;
            const icon = s(it, 'icon');
            if (icon !== undefined) m.icon_url = icon;
            break;
        }
        case 'theme':
            m.name = name;
            if (!url && !('vars' in m)) return null;
            if (url) { m.url = url; m.download_url = url; }
            if (sha !== undefined) m.sha256 = sha;
            break;
        case 'tutorial':
            if (!url) return null;
            m.name = name; m.title = name; m.url = url;
            if (sha !== undefined) m.sha256 = sha;
            break;
        case 'repo':
            if (!url) return null;
            m.name = name; m.url = url;
            break;
        case 'modpack': {
            m.name = name;
            if (!url && !('file' in m)) return null;
            if (url) m.download_url = url;
            if (sha !== undefined) m.sha256 = sha;
            const game = s(it, 'game');
            if (game !== undefined) m.game = game;
            break;
        }
        default:
            if (!url) return null;
            m.name = name; m.download_url = url;
            if (sha !== undefined) m.sha256 = sha;
    }
    return m;
}

/** Does a normalised catalogue hold only links to other catalogues (an index)? */
export const isIndexOnly = (u: UniversalCatalog): boolean => !!(u.catalogs && u.catalogs.length) && !(u.items && u.items.length);

/**
 * The document a v1 reader of `kind` should parse: `doc` itself when it already understands it,
 * the converted view otherwise. Throws when the document is refused. Pure fallback of
 * core/catalog-read.ts `asLegacy`, which asks the backend first (it can verify signatures).
 */
export function legacyViewLocal(doc: unknown, kind: string): unknown {
    if (!needsNormalizing(doc)) return doc;
    const n = normalizeCatalog(doc, { kind });
    if (n.refused) throw new Error(`catalog refused: ${n.issues.find((i) => i.severity === 'error')?.message || 'refused'}`);
    return toLegacy(n.catalog, isIndexOnly(n.catalog) ? 'index' : kind);
}
