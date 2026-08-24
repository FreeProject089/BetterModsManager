/**
 * i18n.ts — Internationalization with external JSON files
 * Loads translations from /Lang/{lang}.json
 */

import type { AppSettings } from '../types/models.js';

interface LangInfo {
    name: string;
    flag: string;
}

interface LanguageData {
    code: string;
    name: string;
    flag: string;
    active: boolean;
}

let translations: Record<string, Record<string, string>> = {};
let langInfo: Record<string, LangInfo> = {};
let currentLang: string = localStorage.getItem('bmm-lang') || 'fr';
let loaded: boolean = false;

/** Synonym groups per language: { lang: { canonical: [synonyms] } } */
let synonymsStore: Record<string, Record<string, string[]>> = {};

async function loadLang(lang: string): Promise<void> {
    try {
        const { invoke } = await import('./api.js');
        const jsonStr = await invoke('get_language_content', { lang }) as string;
        const data = JSON.parse(jsonStr);
        
        const info: LangInfo = data._info || { name: lang, flag: '⚪' };
        delete data._info;

        // Extract synonyms if provided by the language file
        if (data._synonyms && typeof data._synonyms === 'object') {
            synonymsStore[lang] = data._synonyms as Record<string, string[]>;
            delete data._synonyms;
        }

        translations[lang] = data;
        langInfo[lang] = info;
        console.log(`[i18n] Successfully loaded: Lang/${lang}.json`);
    } catch (err) {
        console.error(`[i18n] Failed to load language ${lang}:`, err);
    }
}

export async function initI18n(): Promise<void> {
    try {
        const { getSettings, invoke } = await import('./api.js');
        const [langs, settings] = await Promise.all([
            invoke('get_available_languages').catch(() => ['fr', 'en']) as Promise<string[]>,
            getSettings().catch(() => ({ language: 'fr' }) as AppSettings)
        ]);
        
        currentLang = settings.language || 'fr';
        await Promise.all(langs.map((l: string) => loadLang(l)));
    } catch (e) {
        console.warn('[i18n] Failed to fetch language list, falling back:', e);
        await Promise.all([loadLang('fr'), loadLang('en')]);
    }
    loaded = true;
    applyTranslations();
}

// ── Sandbox overlay ──────────────────────────────────────────────────────────
//
// A test layer the translation sandbox can slip over the live dictionary, so an edit
// is seen EVERYWHERE — toasts, panels, TS-rendered markup — not only in static
// data-i18n elements. Read before the dictionary, one property probe on the hot path
// (t() runs hundreds of times per render; anything heavier would show). Never
// persisted: closing the sandbox clears it, and the real Lang files never change.
let _sandboxOverlay: Record<string, string> | null = null;

export function setSandboxOverlay(map: Record<string, string> | null): void {
    _sandboxOverlay = map && Object.keys(map).length ? map : null;
    applyTranslations();   // repaint the static half so both halves agree
}

// Runtime texts for CUSTOM tutorials (`ctut.*` keys), per language. Additive and
// session-only, like the sandbox overlay above but never cleared by closing anything:
// a custom tutorial's texts exist as long as its definition does. Never persisted —
// the .bmmtut document on disk is the source of truth, and these are derived from it
// on every load.
const _runtimeTexts: Record<string, Record<string, string>> = {};

export function registerRuntimeTexts(lang: string, map: Record<string, string>): void {
    _runtimeTexts[lang] = { ...(_runtimeTexts[lang] || {}), ...map };
}

/**
 * One key, in ONE named language, with no fallback chain and no placeholder substitution.
 *
 * `t()` answers in whatever language is current, which is the right behaviour for drawing a
 * screen and the wrong one for COPYING a bilingual document: forking a built-in tutorial has
 * to read both halves, and reading the other one by switching the app's language and back is
 * not a thing a copy operation should do.
 *
 * Returns '' rather than the key when there is no entry, so a caller can tell "not
 * translated" from "translated to something that looks like a key".
 */
export function tIn(lang: string, key: string): string {
    const dict = translations[lang] || {};
    if (dict[key] !== undefined) return dict[key];
    const rt = _runtimeTexts[lang];
    return rt && rt[key] !== undefined ? rt[key] : '';
}

export function t(key: string, params: Record<string, string> = {}): string {
    const dict = translations[currentLang] || translations.fr || {};
    let str: string = dict[key] || (translations.fr && translations.fr[key]) || key;
    // Checked only on a miss: t() runs hundreds of times per render and real keys must not
    // pay for a feature they do not use. A ctut.* key can never collide with a Lang file key.
    if (str === key && key.startsWith('ctut.')) {
        const rt = _runtimeTexts[currentLang] || _runtimeTexts.en || {};
        if (rt[key] !== undefined) str = rt[key];
        else {
            const en = _runtimeTexts.en || {};
            if (en[key] !== undefined) str = en[key];
        }
    }
    if (_sandboxOverlay) {
        const ov = _sandboxOverlay[key];
        if (ov !== undefined) str = ov;
    }
    // Single-pass {placeholder} substitution. t() runs hundreds of times per
    // render; the old code compiled a fresh RegExp per param on every call
    // (benchmarked ~6× slower — see benchmarks/js). One linear scan, no RegExp.
    if (str.indexOf('{') === -1) return str;
    let out = '';
    let i = 0;
    const n = str.length;
    while (i < n) {
        const open = str.indexOf('{', i);
        if (open === -1) { out += str.slice(i); break; }
        const close = str.indexOf('}', open + 1);
        if (close === -1) { out += str.slice(i); break; }
        out += str.slice(i, open);
        const name = str.slice(open + 1, close);
        out += Object.prototype.hasOwnProperty.call(params, name) ? params[name] : str.slice(open, close + 1);
        i = close + 1;
    }
    return out;
}

export function getLang(): string {
    return currentLang;
}

export async function setLang(lang: string): Promise<void> {
    if (translations[lang]) {
        currentLang = lang;
        const { getSettings, updateSettings } = await import('./api.js');
        try {
            const settings = await getSettings();
            settings.language = lang;
            await updateSettings(settings);
        } catch (e) {
            console.error('[i18n] Failed to save language setting to backend:', e);
            localStorage.setItem('bmm-lang', lang);
        }
        applyTranslations();
        document.dispatchEvent(new CustomEvent('langChanged', { detail: { lang } }));
    }
}

/** Returns the raw loaded translations map { lang: { key: value } } — used by the i18n sandbox. */
export function getAllTranslations(): Record<string, Record<string, string>> {
    return translations;
}

/** Re-sync the in-memory language list with what's on disk: prunes removed
 *  languages and loads newly added ones (translate tool / import / delete). */
export async function reloadLanguages(): Promise<void> {
    try {
        const { invoke } = await import('./api.js');
        const langs = await (invoke('get_available_languages') as Promise<string[]>)
            .catch(() => Object.keys(translations));
        // prune languages whose file no longer exists
        for (const code of Object.keys(translations)) {
            if (!langs.includes(code)) { delete translations[code]; delete langInfo[code]; }
        }
        // load any newly added language
        await Promise.all(langs.filter(l => !translations[l]).map(l => loadLang(l)));
    } catch (e) {
        console.warn('[i18n] reloadLanguages failed:', e);
    }
}

export function getLanguages(): LanguageData[] {
    return Object.entries(langInfo).map(([code, info]) => ({
        code,
        name: info.name,
        flag: info.flag,
        active: code === currentLang,
    }));
}

/**
 * Returns merged synonym groups from all loaded languages.
 * Each key is a canonical term; the value is the deduplicated list of synonyms.
 * Language files contribute via their `_synonyms` object.
 */
export function getSynonyms(): Record<string, string[]> {
    const merged: Record<string, string[]> = {};
    for (const langSynonyms of Object.values(synonymsStore)) {
        for (const [canonical, syns] of Object.entries(langSynonyms)) {
            if (!merged[canonical]) merged[canonical] = [];
            syns.forEach(s => {
                if (!merged[canonical].includes(s)) merged[canonical].push(s);
            });
            // Also ensure canonical itself is in its own list
            if (!merged[canonical].includes(canonical)) merged[canonical].unshift(canonical);
        }
    }
    return merged;
}

export function applyTranslations(root: Document | Element = document): void {
    if (!loaded) return;
    root.querySelectorAll('[data-i18n]').forEach((el: Element) => {
        const key = (el as HTMLElement).dataset.i18n!;
        const msg = t(key);
        if (msg === key && key.startsWith('faq')) {
            console.warn(`[I18N] Critical Key not found: ${key}`);
        }
        el.innerHTML = msg;
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el: Element) => {
        const key = (el as HTMLElement).dataset.i18nPlaceholder!;
        (el as HTMLInputElement).placeholder = t(key);
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el: Element) => {
        const key = (el as HTMLElement).dataset.i18nTitle!;
        (el as HTMLElement).title = t(key);
    });
    root.querySelectorAll('[data-i18n-content]').forEach((el: Element) => {
        const key = (el as HTMLElement).dataset.i18nContent!;
        el.setAttribute('data-content', t(key));
    });
    // Update data-tooltip from an i18n key — so Tasky tooltips are translated and
    // change instantly when the user switches language.
    root.querySelectorAll('[data-i18n-tooltip]').forEach((el: Element) => {
        const key = (el as HTMLElement).dataset.i18nTooltip!;
        el.setAttribute('data-tooltip', t(key));
    });

    // Substitute the default API port in docs/examples with the EFFECTIVE port
    // (settings.api_port may differ from 51274). Covers static HTML examples
    // (curl snippets, tables) and i18n strings mentioning the port.
    // Idempotent: replaces BOTH the default 51274 AND the previously-shown port,
    // so changing the port live (re-running applyTranslations) updates correctly.
    try {
        const port = localStorage.getItem('bmm_api_port') || '51274';
        const prev = _lastApiPortShown;
        if (port !== '51274' || prev !== '51274') {
            const scope = root;
            scope.querySelectorAll('#view-docs code, #view-docs pre, #view-docs td, #view-docs p, #view-docs strong, #view-docs .plug-doc-p').forEach((el: Element) => {
                let html = el.innerHTML;
                if (prev !== port && prev !== '51274' && html.includes(prev)) {
                    html = html.replace(new RegExp(prev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), port);
                }
                if (port !== '51274' && html.includes('51274')) {
                    html = html.replace(/51274/g, port);
                }
                if (html !== el.innerHTML) el.innerHTML = html;
            });
        }
        _lastApiPortShown = port;
    } catch { /* never break translations over this */ }
}

// Last API port substituted into the docs, so a live port change can rewrite it.
let _lastApiPortShown = '51274';

export async function refreshLanguages(): Promise<boolean> {
    try {
        const { invoke } = await import('./api.js');
        const langs = await invoke('get_available_languages') as string[];
        
        const existingLangs = Object.keys(langInfo);
        const newLangs = langs.filter((l: string) => !existingLangs.includes(l));
        
        if (newLangs.length > 0) {
            await Promise.all(newLangs.map((l: string) => loadLang(l)));
        }
        
        return true;
    } catch (e) {
        console.error('[i18n] Failed to refresh languages:', e);
        return false;
    }
}
