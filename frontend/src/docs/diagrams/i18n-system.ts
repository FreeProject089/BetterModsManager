// i18n system — external Lang/*.json dictionaries, FR fallback, live switching, synonyms.
export const i18nSystem = {
    titleKey: 'docs.diagram.i18nSystem.title',
    explanationPrefix: 'docs.diagram.i18nSystem.node.',
    definition: `
graph TD
    LANGFILES["Lang/*.json (+ _info, _synonyms)"] --> LOAD["get_language_content (Rust)"]
    LOAD --> DICTS["In-memory dictionaries"]

    DICTS --> T["t(key, {params})"]
    T --> CUR{Key in current language?}
    CUR -- yes --> OUT["Translated string"]
    CUR -- no --> FRFALL["French fallback"]
    FRFALL -- "still missing" --> RAWKEY["Raw key shown"]

    OUT --> DOM["applyTranslations: data-i18n / -title / -placeholder"]
    SWITCH["setLang()"] --> DICTS
    SWITCH --> EVENTCH["langChanged event (live UI refresh)"]

    SYN["_synonyms groups"] --> SEARCH["Semantic search (palette + docs)"]

    style LANGFILES fill:#f97316,stroke:#fff,stroke-width:2px,color:#fff
    style FRFALL fill:#6366f1,stroke:#fff,stroke-width:2px,color:#fff
    style SEARCH fill:#22c55e,stroke:#fff,stroke-width:2px,color:#fff
    `
};
