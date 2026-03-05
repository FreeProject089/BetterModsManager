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
    // Load both languages
    await Promise.all([loadLang('fr'), loadLang('en')]);
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

export function setLang(lang) {
    if (translations[lang]) {
        currentLang = lang;
        localStorage.setItem('bmm-lang', lang);
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
        el.textContent = t(key);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        el.placeholder = t(key);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.dataset.i18nTitle;
        el.title = t(key);
    });
}
