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
To add a new translation key:
1.  Add the key in `en.json` and `fr.json`.
2.  Add the key with the value `"..."` in `template.json`.
3.  Update this file `i18n_reference.md` if a new category is created.
4.  Use `t('my.key')` in JavaScript or `data-i18n="my.key"` in HTML.
