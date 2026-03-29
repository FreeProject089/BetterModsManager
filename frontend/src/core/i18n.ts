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

async function loadLang(lang: string): Promise<void> {
    try {
        const { invoke } = await import('./api.js');
        const jsonStr = await invoke('get_language_content', { lang }) as string;
        const data = JSON.parse(jsonStr);
        
        const info: LangInfo = data._info || { name: lang, flag: '⚪' };
        delete data._info;
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

export function getLanguages(): LanguageData[] {
    return Object.entries(langInfo).map(([code, info]) => ({
        code,
        name: info.name,
        flag: info.flag,
        active: code === currentLang,
    }));
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
