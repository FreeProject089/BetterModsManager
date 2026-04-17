# BMM Internationalization (i18n) Reference Guide

Ce document sert de référence pour toutes les clés de traduction utilisées dans Better Mods Manager. Chaque clé est catégorisée pour faciliter la maintenance et l'ajout de nouvelles langues.

---

## ️ Structure des Fichiers JSON
Les fichiers de langue se trouvent dans `frontend/Lang/`.
- `en.json` : Référence principale (Anglais).
- `fr.json` : Traduction Française.
- `template.json` : Modèle vide pour les nouvelles traductions.

**Règle de tri** : Les clés doivent être regroupées par préfixe de section et triées logiquement selon l'ordre d'apparition dans l'interface.

---

##  Glossaire des Sections

### ️ common
*Generic strings used across the entire application.*
- `common.error` : Titre générique pour les erreurs.
- `common.success` : Message de confirmation.
- `common.loading` : État d'attente.
- `common.close` : Bouton de fermeture.
- `common.pause` / `common.resume` : Utilisé dans les barres de progression (RepoSync).
- `common.loaded` : Affiché par Tasky après le chargement initial.

###  nav
*Navigation sidebar items.*
- `nav.library` : Lien vers la bibliothèque de mods.
- `nav.profiles` : Lien vers la gestion des profils.
- `nav.settings` : Accès aux paramètres.
- `nav.activeProfile` : Label du profil actuellement chargé.

###  lib
*Mod Library view management.*
- `lib.title` : Titre de la page.
- `lib.scan` : Déclenche le scan du dossier mods.
- `lib.addMod` : Ouvre le sélecteur pour ajouter un mod manuel.
- `lib.filter*` : Options de filtrage (All, Enabled, Disabled).
- `lib.emptyTitle` / `lib.emptyDesc` : Affiché quand aucun mod n'est présent.

###  mod
*Mod cards and basic operations.*
- `mod.active` / `mod.inactive` : Badges d'état sur les cartes.
- `mod.activate` : Action pour activer un mod.
- `mod.deleteTitle` : Titre de la modal de suppression.
- `mod.conflictsTitle` : Alerte quand deux mods utilisent les mêmes fichiers.

###  prof
*Profile management system.*
- `prof.new` : Créer un nouveau profil.
- `prof.importOvgme` : Importation depuis OvGME.
- `prof.gamePath` / `prof.modsPath` : Labels pour la configuration des dossiers.

###  repo
*Server Repo (Full Server Mode).*
- `repo.hostTitle` : Section pour héberger un dépôt.
- `repo.syncBtn` : Bouton de synchronisation intelligente (Smart Sync).
- `repo.tunnelHint` : Info sur le tunnel Cloudflare.

### ️ settings
*Application configuration page.*
- `settings.githubPatTitle` : Configuration du token GitHub.
- `settings.crashTitle` : Gestion des rapports d'erreurs.
- `settings.benchmarkTitle` : Activation du monitoring de performance.

###  docs (v0.9.9)
*Documentation interactive et Galerie.*
- `docs.title` : Titre de la page de documentation.
- `docs.gallery.title` : Entête pour la galerie de diagrammes.
- `docs.gallery.btn.*` : Libellés pour les boutons de diagrammes individuels (ex: `appArchitecture`, `modSync`).
- `docs.videos.tuto*.online` : URL YouTube pour un tutoriel.
- `docs.videos.tuto*.offline` : Chemin local MP4 pour un tutoriel.
- `docs.search.placeholder` : Zone de recherche dans la documentation.

###  onboard
*Tasky's tutorial messages.*
- `onboard.s1` à `onboard.s8` : Étapes du tutoriel de bienvenue.

---

## ️ Maintenance du système i18n
Pour ajouter une nouvelle clé de traduction :
1.  Ajouter la clé dans `en.json` et `fr.json`.
2.  Ajouter la clé avec la valeur `"..."` dans `template.json`.
3.  Mettre à jour ce fichier `i18n_reference.md` si une nouvelle catégorie est créée.
4.  Utiliser `t('ma.cle')` dans le JavaScript ou `data-i18n="ma.cle"` dans le HTML.
