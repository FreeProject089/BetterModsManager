# Terms of Service (TOS) Translation Guide — Better Mod Manager

> This guide replaces the old "EULA" guide. BMM now shows **Terms of Service**. The
> old `EULA_*.md` files still work as a legacy fallback, but please use `TOS_*.md`.

Want to translate the Terms of Service into your language? Follow these simple steps!

## 1. Naming Convention
The TOS file name must follow this exact pattern:

```
TOS_{LANG_CODE}.md
```

Where `{LANG_CODE}` is the **uppercase** version of the language file name from the `frontend/Lang` folder (before `.json`).

**Examples:**
| Language File | TOS File Name |
|---|---|
| `fr.json` | `TOS_FR.md` |
| `en.json` | `TOS_EN.md` |
| `de.json` | `TOS_DE.md` |
| `es.json` | `TOS_ES.md` |

## 2. File Location
Place your translated file in the **application root directory** (same place as `TOS.md`, `PRIVACY.md` and `LICENSE.md`).

## 3. Fallback Logic
BMM resolves the Terms in this order:
1. `TOS_{YOUR_LANG}.md` (e.g. `TOS_DE.md` for German)
2. `TOS.md` (English default)
3. `EULA_{YOUR_LANG}.md` — *legacy*
4. `EULA.md` — *legacy*

So you only need to provide a translation for your language — English is always the default.

## 4. Content Structure
Mirror the same section structure as `TOS.md`:

1. **LICENSE GRANT** — it's GPL-3.0
2. **WARRANTY DISCLAIMER** — the "AS IS" clause
3. **USER RESPONSIBILITY** — modding risks
4. **PRIVACY & DATA** — points to the Privacy Policy (translated separately — see `PrivacyTranslationGuide`)
5. **COMMUNITY & SUPPORT** — support channels

Keep the headings and section order identical so the in-app reader stays consistent.

## 5. Quick Start
1. Copy `TOS.md` to `TOS_{YOUR_LANG}.md`
2. Translate the content (don't translate code, URLs, or product names)
3. Restart BMM — your Terms load automatically (they follow the app language)

## 6. For App Bundlers / Distributors
Include your file in the `tauri.conf.json` resources array so it ships with the build:

```json
"resources": [
    "../TOS.md",
    "../TOS_FR.md",
    "../TOS_DE.md"
]
```

---
*Tip: `TOS_FR.md` in the project root is a complete, ready-to-read example. The Privacy Policy is translated separately — see `PrivacyTranslationGuide_EN.md`. To translate the whole interface, see `TranslationGuide_EN.md`.*
