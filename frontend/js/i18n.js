/**
 * i18n.js — Internationalization with external JSON files
 * Loads translations from /Lang/{lang}.json
 */

let translations = {};
let langInfo = {};
let currentLang = localStorage.getItem('bmm-lang') || 'fr';
let loaded = false;

async function loadLang(lang) {
    try {
        const resp = await fetch(`Lang/${lang}.json`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        // Extract _info and store it separately
        const info = data._info || { name: lang, flag: '⚪' };
        delete data._info;
        translations[lang] = data;
        langInfo[lang] = info;
    } catch (err) {
        console.warn(`[i18n] Failed to load Lang/${lang}.json:`, err);
    }
}

export async function initI18n() {
    try {
        const { getSettings, invoke } = await import('./api.js');
        const [langs, settings] = await Promise.all([
            invoke('get_available_languages').catch(() => ['fr', 'en']),
            getSettings().catch(() => ({ language: 'fr' }))
        ]);
        
        currentLang = settings.language || 'fr';
        await Promise.all(langs.map(l => loadLang(l)));
    } catch (e) {
        console.warn('[i18n] Failed to fetch language list, falling back:', e);
        await Promise.all([loadLang('fr'), loadLang('en')]);
    }
    loaded = true;
    applyTranslations();
}

export function t(key, params = {}) {
    const dict = translations[currentLang] || translations.fr || {};
    let str = dict[key] || (translations.fr && translations.fr[key]) || key;
    for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
    return str;
}

export function getLang() {
    return currentLang;
}

export async function setLang(lang) {
    if (translations[lang]) {
        currentLang = lang;
        const { getSettings, updateSettings } = await import('./api.js');
        try {
            const settings = await getSettings();
            settings.language = lang;
            await updateSettings(settings);
        } catch (e) {
            console.error('[i18n] Failed to save language setting to backend:', e);
            localStorage.setItem('bmm-lang', lang); // Fallback
        }
        applyTranslations();
    }
}

export function getLanguages() {
    return Object.entries(langInfo).map(([code, info]) => ({
        code,
        name: info.name,
        flag: info.flag,
        active: code === currentLang,
    }));
}

export function applyTranslations(root = document) {
    if (!loaded) return;
    root.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        const msg = t(key);
        // Debug fallback
        if (msg === key && key.startsWith('faq')) {
            console.warn(`[I18N] Critical Key not found: ${key}`);
        }
        el.innerHTML = msg;
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        el.placeholder = t(key);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.dataset.i18nTitle;
        el.title = t(key);
    });
    root.querySelectorAll('[data-i18n-content]').forEach(el => {
        const key = el.dataset.i18nContent;
        el.setAttribute('data-content', t(key));
    });
}
