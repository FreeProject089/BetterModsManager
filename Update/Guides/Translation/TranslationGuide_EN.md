# Translate Better Mod Manager — Interface Guide

This guide is for translating the **whole BMM interface** (menus, buttons, messages).
The legal documents are separate — see `EulaTranslationGuide_EN.md` (Terms of Service)
and `PrivacyTranslationGuide_EN.md` (Privacy Policy).

## 1. How language files work
- All UI text lives in flat JSON files at `frontend/Lang/`, one per language:
  `en.json`, `fr.json`, … Each is a flat map of **dot-keys → text**:
  ```json
  { "common.save": "Save", "settings.title": "Settings" }
  ```
- `en.json` is the **reference** (English). `template.json` mirrors every key with
  English defaults — use it as your starting point.

## 2. Get a starting file
Pick one:
- **Settings → Language → Download template** (writes `lang-template.json` with every key), or
- the API/deeplink: `GET /api/language/template` (downloads the same template), or
- simply copy `frontend/Lang/en.json`.

## 3. Translate
- Translate **values only** — never change the keys (the part before the `:`).
- Keep placeholders **exactly**: `{name}`, `{count}`, `{path}`, etc. stay untouched
  (e.g. `"sched.runNow": "Run {name} now"` → `"Lancer {name} maintenant"`).
- Don't translate product names, URLs, code, or file extensions.
- Keep any inline HTML tags (`<b>…</b>`) and their order.

## 4. Name & place the file
- Save as `{code}.json` where `{code}` is a short locale code: `de.json`, `es.json`,
  `pt-br.json`, …
- For a **bundled** language, drop it in `frontend/Lang/` (it ships with the build).
- For a **personal/shared** language, keep it anywhere and import it (next step).

## 5. Import it
- **Settings → Language → Import a language**, then pick your `{code}.json`, or
- the deeplink `bmm://language/import?path=C:/path/de.json` (omit `path` to open the
  picker), or the API `POST /api/language/import { "path": "…" }`.
- BMM switches to it immediately.

## 6. Keep parity
- BMM falls back to English for any **missing** key, so a partial translation still
  works — but aim for 100%.
- Don't add keys that aren't in `en.json` (they're ignored). If you translate the
  bundled files, `en.json` and `fr.json` must have the **same key set** (the repo's
  i18n parity check enforces 0 differences).

## 7. Test
Run BMM, switch to your language in Settings, and walk through the pages, modals,
and the benchmark/scheduler dialogs to catch overflow or untranslated strings.

---
*Tip: translate against the latest `en.json` so you don't miss newly-added keys.*
