# Privacy Policy Translation Guide — Better Mod Manager

Want to translate BMM's Privacy Policy into your language? It works exactly like the
Terms of Service guide, with its own file name.

## 1. Naming Convention
```
PRIVACY_{LANG_CODE}.md
```
`{LANG_CODE}` is the **uppercase** language code (the `frontend/Lang` file name before `.json`).

| Language File | Privacy File Name |
|---|---|
| `fr.json` | `PRIVACY_FR.md` |
| `en.json` | `PRIVACY_EN.md` |
| `de.json` | `PRIVACY_DE.md` |

## 2. File Location
Place it in the **application root directory** (next to `PRIVACY.md`, `TOS.md`, `LICENSE.md`).

## 3. Fallback Logic
BMM resolves the Privacy Policy in this order:
1. `PRIVACY_{YOUR_LANG}.md`
2. `PRIVACY.md` (English default)

## 4. Content Structure
Mirror `PRIVACY.md` section-for-section. Key sections to keep:
1. **What we collect** — specs, performance/benchmarks, feature usage & navigation, approximate location, anonymous Creator ID, optional masked session replay
2. **What we never collect** — names/emails, mod contents, file paths (unless full-replay is explicitly enabled)
3. **Consent & control** — opt-in, per-option toggles, export & erase from *Settings → Privacy*
4. **Retention & erasure** — limited retention, per-packet deletion requests
5. **Contact**

⚠️ Accuracy matters: keep the meaning identical to the English source — don't add or weaken any data-handling claim. Don't translate URLs, emails, or product names.

## 5. Quick Start
1. Copy `PRIVACY.md` → `PRIVACY_{YOUR_LANG}.md`
2. Translate the text only
3. Restart BMM — the policy follows the app language (shown in the first-run flow and *Settings → Privacy*)

## 6. For Bundlers
Add it to `tauri.conf.json` → `resources` (e.g. `"../PRIVACY_DE.md"`).

---
*`PRIVACY_FR.md` in the project root is a complete example. See also `EulaTranslationGuide_EN.md` (Terms of Service) and `TranslationGuide_EN.md` (whole interface).*
