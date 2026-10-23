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

À la date de rédaction : **6868 clés**, identiques dans `en.json` et `fr.json`.

Pour ajouter une clé de traduction :
1.  Ajoutez la clé dans `en.json` et `fr.json`.
2.  Ajoutez la clé avec la valeur `"..."` dans `template.json`.
3.  Mettez à jour ce fichier `i18n_reference.md` si une nouvelle catégorie est créée.
4.  Utilisez `t('ma.cle')` en JavaScript ou `data-i18n="ma.cle"` en HTML.

### Ce sont les guards qui font la règle

Deux scripts l'appliquent, et ce sont eux qui font échouer un build — pas la relecture :

- **`scripts/check-i18n-parity.mjs`** — `en.json` et `fr.json` doivent contenir
  exactement le même ensemble de clés. Pas « à peu près » : ajouter une chaîne anglaise
  sans sa française échoue ici, et c'est pour ça que le français n'est jamais une
  corvée de rattrapage.
- **`scripts/check-i18n-keys.mjs`** — chaque `t('…')` *littéral* du code doit résoudre.
  Son ensemble `KNOWN_MISSING` est vide et doit le rester : une entrée dedans est une
  clé que quelqu'un a décidé de devoir.

Le mot **littéral** est la limite à connaître. Une clé construite à l'exécution —
`t('sched.act.' + action.type)`, `t('notif.f_' + kind)` — est invisible au vérificateur,
qui ne peut pas savoir ce que l'expression produira. Ces motifs sont réels et utiles,
mais ils échangent une garantie à la compilation contre une garantie à l'exécution :
une clé calculée demande donc sa propre vérification. La méthode fiable est d'extraire
la liste que le code va réellement construire et de la comparer au dictionnaire :

```js
// toutes les actions déclarées du planificateur, contre le dictionnaire
const acts = [...src.matchAll(/\{ v: '([a-zA-Z.]+)', label:/g)].map(m => m[1]);
const missing = acts.filter(v => !(`sched.act.${v}` in fr));
```

C'est exactement cette vérification qui a trouvé `sched.act.custom.script` manquante
après l'ajout d'une action dont la traduction avait été oubliée. La relecture, non.

### `t(cle, repli)` et pourquoi le repli est en anglais

`t()` renvoie le repli quand une clé est absente : une traduction manquante dégrade
donc vers de l'anglais lisible au lieu d'afficher la clé brute à l'utilisateur. C'est
voulu — et c'est aussi pourquoi le guard de parité compte : sans lui, le repli
masquerait discrètement chaque trou et le français pourrirait sur place sans que rien
n'ait l'air cassé.

### Les unités et les symboles sont des chaînes aussi

Le piège facile à manquer : ce qui semble trop petit pour être traduit. Un temps
relatif renvoyant `${d} j` — abréviation française de *jour* — est parti tel quel vers
des lecteurs anglophones sous la forme d'un « 3 j » incompréhensible, et aucun guard ne
pouvait l'attraper puisque ça n'était jamais passé par `t()`. Quand une API de la
plateforme connaît déjà la réponse (`Intl.RelativeTimeFormat`, `toLocaleDateString`),
utilisez-la plutôt que d'écrire l'unité à la main.

Les opérateurs (`==`, `>=`), les codes de taille (S/M/L/XL) et les noms d'algorithmes
(`blake3`, `sha256`) sont le cas inverse : des symboles et des noms propres,
correctement laissés non traduits. Les traduire serait pire que de les laisser.
