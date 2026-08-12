# BMM Internationalization (i18n) Reference Guide

This document serves as a reference for all translation keys used in Better Mod Manager. Each key is categorized to facilitate maintenance and the addition of new languages.

---

## ️ JSON File Structure
Language files are located in `frontend/Lang/`.
- `en.json`: Main reference (English).
- `fr.json`: French translation.
- `template.json`: Empty template for new translations.

**Sorting Rule**: Keys must be grouped by section prefix and logically sorted according to their appearance order in the interface.

---

##  Section Glossary

### ️ common
*Generic strings used across the entire application.*
- `common.error`: Generic title for errors.
- `common.success`: Confirmation message.
- `common.loading`: Waiting state.
- `common.close`: Close button.
- `common.pause` / `common.resume`: Used in progress bars (RepoSync).
- `common.loaded`: Displayed by Tasky after initial loading.

###  nav
*Navigation sidebar items.*
- `nav.library`: Link to the mod library.
- `nav.profiles`: Link to profile management.
- `nav.settings`: Access to settings.
- `nav.activeProfile`: Label for the currently loaded profile.

###  lib
*Mod Library view management.*
- `lib.title`: Page title.
- `lib.scan`: Triggers mod folder scan.
- `lib.addMod`: Opens selector to add a manual mod.
- `lib.filter*`: Filtering options (All, Enabled, Disabled).
- `lib.emptyTitle` / `lib.emptyDesc`: Displayed when no mods are present.

###  mod
*Mod cards and basic operations.*
- `mod.active` / `mod.inactive`: Status badges on cards.
- `mod.activate`: Action to activate a mod.
- `mod.deleteTitle`: Title of the deletion modal.
- `mod.conflictsTitle`: Alert when two mods use the same files.

###  prof
*Profile management system.*
- `prof.new`: Create a new profile.
- `prof.importOvgme`: Import from OvGME.
- `prof.gamePath` / `prof.modsPath`: Labels for folder configuration.

###  repo
*Server Repo (Full Server Mode).*
- `repo.hostTitle`: Section for hosting a repository.
- `repo.syncBtn`: Smart Sync button.
- `repo.tunnelHint`: Info about Cloudflare tunnel.

### ️ settings
*Application configuration page.*
- `settings.githubPatTitle`: GitHub token configuration.
- `settings.crashTitle`: Error report management.
- `settings.benchmarkTitle`: Performance monitoring activation.

###  docs (v0.9.9)
*Interactive Documentation & Gallery.*
- `docs.title`: Documentation page title.
- `docs.gallery.title`: Header for the Diagram Gallery.
- `docs.gallery.btn.*`: Labels for individual diagram buttons (e.g., `appArchitecture`, `modSync`).
- `docs.videos.tuto*.online`: YouTube embed URL for a tutorial.
- `docs.videos.tuto*.offline`: Local MP4 path for a tutorial.
- `docs.search.placeholder`: Search bar text in documentation.

###  onboard
*Tasky's tutorial messages.*
- `onboard.s1` to `onboard.s8`: Welcome tutorial steps.

---

## ️ i18n System Maintenance

As of this writing: **6868 keys**, identical in `en.json` and `fr.json`.

To add a new translation key:
1.  Add the key in `en.json` and `fr.json`.
2.  Add the key with the value `"..."` in `template.json`.
3.  Update this file `i18n_reference.md` if a new category is created.
4.  Use `t('my.key')` in JavaScript or `data-i18n="my.key"` in HTML.

### The guards are the real rule

Two scripts enforce this, and they are what actually fails a build — not review:

- **`scripts/check-i18n-parity.mjs`** — `en.json` and `fr.json` must hold exactly the
  same key set. Not "mostly": adding an English string without its French one fails
  here, which is why French is never a catch-up chore.
- **`scripts/check-i18n-keys.mjs`** — every *literal* `t('…')` in the source must
  resolve. Its `KNOWN_MISSING` set is empty and should stay that way; an entry there
  is a key someone decided to owe.

The word **literal** is the limit worth knowing. A key built at runtime —
`t('sched.act.' + action.type)`, `t('notif.f_' + kind)` — is invisible to the checker,
because it cannot know what the expression will produce. Those are real and useful
patterns, but they trade a compile-time guarantee for a runtime one, so a computed key
needs its own check. The reliable way is to extract the list the code will actually
build and diff it against the dictionary:

```js
// every declared scheduler action vs the dictionary
const acts = [...src.matchAll(/\{ v: '([a-zA-Z.]+)', label:/g)].map(m => m[1]);
const missing = acts.filter(v => !(`sched.act.${v}` in fr));
```

That exact check found `sched.act.custom.script` missing after an action was added and
its translation forgotten. Reading the file had not.

### `t(key, fallback)` and why the fallback is English

`t()` returns the fallback when a key is absent, so a missing translation degrades to
readable English rather than printing the raw key at the user. That is deliberate, and
it is also why the parity guard matters: without it, the fallback would quietly hide
every gap and French would rot in place while nothing ever looked broken.

### Units and symbols are still strings

The trap that is easy to miss: things that look too small to translate. A relative
time returning `${d} j` — the French abbreviation for *jour* — shipped to English
readers as a bare "3 j", and no guard could catch it because it never went through
`t()`. Where a platform API already knows the answer (`Intl.RelativeTimeFormat`,
`toLocaleDateString`), use it instead of hand-writing the unit.

Operators (`==`, `>=`), size codes (S/M/L/XL) and algorithm names (`blake3`,
`sha256`) are the opposite case: symbols and proper nouns, correctly left untranslated.
Translating them would be worse than leaving them alone.
