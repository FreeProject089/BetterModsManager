# EULA Translation Guide - Better Mod Manager

Want to translate the EULA (End User License Agreement) into your language? Follow these simple steps!

## 1. Naming Convention
The EULA file name must follow this exact pattern:

```
EULA_{LANG_CODE}.md
```

Where `{LANG_CODE}` is the **uppercase** version of the language file name from the `frontend/Lang` folder (before `.json`).

**Examples:**
| Language File | EULA File Name |
|---|---|
| `fr.json` | `EULA_FR.md` |
| `en.json` | `EULA_EN.md` |
| `de.json` | `EULA_DE.md` |
| `es.json` | `EULA_ES.md` |

## 2. File Location
Place your translated EULA file in the **application root directory** (same location as `EULA.md` and `LICENSE.md`).

## 3. Fallback Logic
BMM uses a smart fallback mechanism:
1. **First**, it looks for `EULA_{YOUR_LANG}.md` (e.g., `EULA_DE.md` for German).
2. **If not found**, it falls back to the default `EULA.md` (English).

This means you only need to provide translations for your language — English is always the default.

## 4. Content Structure
Your translated EULA should follow the same section structure as `EULA.md`:

1. **LICENSE GRANT** — Explain that it's GPL-3.0
2. **WARRANTY DISCLAIMER** — "AS IS" clause
3. **USER RESPONSIBILITY** — Modding risks
4. **PRIVACY & DATA** — What data is/isn't collected
5. **COMMUNITY & SUPPORT** — Support channels

## 5. Quick Start
1. Copy `EULA.md` to `EULA_{YOUR_LANG}.md`
2. Translate the content
3. Restart BMM — your EULA will be automatically loaded!

## 6. For App Bundlers / Distributors
If you are packaging BMM for distribution, make sure to include your `EULA_{LANG}.md` file in the `tauri.conf.json` resources array:

```json
"resources": [
    "../EULA.md",
    "../EULA_FR.md",
    "../EULA_DE.md"
]
```

---
*Tip: Reference the existing `EULA_FR.md` file as a perfect example of a translated EULA!*
