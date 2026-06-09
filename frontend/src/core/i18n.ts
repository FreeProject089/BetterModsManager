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

export function t(key: string, params: Record<string, string> = {}): string {
    const dict = translations[currentLang] || translations.fr || {};
    let str: string = dict[key] || (translations.fr && translations.fr[key]) || key;
    for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
    return str;
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
    try {
        const port = localStorage.getItem('bmm_api_port') || '51274';
        if (port !== '51274') {
            const scope = root instanceof Document ? root : root;
            scope.querySelectorAll('#view-docs code, #view-docs pre, #view-docs td, #view-docs p, #view-docs strong, #view-docs .plug-doc-p').forEach((el: Element) => {
                if (el.innerHTML.includes('51274')) el.innerHTML = el.innerHTML.replace(/51274/g, port);
            });
        }
    } catch { /* never break translations over this */ }
}

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
