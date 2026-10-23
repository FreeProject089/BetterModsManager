# Traduire Better Mods Manager — Guide de l'interface

Ce guide concerne la traduction de **toute l'interface de BMM** (menus, boutons,
messages). Les documents légaux sont séparés — voir `EulaTranslationGuide_FR.md`
(Conditions d'utilisation) et `PrivacyTranslationGuide_FR.md` (Confidentialité).

## 1. Comment fonctionnent les fichiers de langue
- Tout le texte de l'UI vit dans des fichiers JSON plats sous `frontend/Lang/`, un
  par langue : `en.json`, `fr.json`, … Chacun est une table plate de **clés en
  notation pointée → texte** :
  ```json
  { "common.save": "Enregistrer", "settings.title": "Paramètres" }
  ```
- `en.json` est la **référence** (anglais). `template.json` reprend chaque clé avec
  les valeurs anglaises — point de départ idéal.

## 2. Obtenir un fichier de départ
Au choix :
- **Paramètres → Langue → Télécharger le modèle** (crée `lang-template.json` avec toutes les clés), ou
- via l'API/deeplink : `GET /api/language/template` (même modèle), ou
- copiez simplement `frontend/Lang/en.json`.

## 3. Traduire
- Traduisez **uniquement les valeurs** — ne modifiez jamais les clés (avant le `:`).
- Conservez les variables **à l'identique** : `{name}`, `{count}`, `{path}`, etc.
  (ex. `"sched.runNow": "Run {name} now"` → `"Lancer {name} maintenant"`).
- Ne traduisez pas les noms de produits, URL, code ni extensions de fichiers.
- Conservez les balises HTML en ligne (`<b>…</b>`) et leur ordre.

## 4. Nommer & placer le fichier
- Enregistrez sous `{code}.json` où `{code}` est un code de langue court : `de.json`,
  `es.json`, `pt-br.json`, …
- Pour une langue **intégrée**, placez-le dans `frontend/Lang/` (livré avec le build).
- Pour une langue **personnelle/partagée**, gardez-le où vous voulez et importez-le.

## 5. L'importer
- **Paramètres → Langue → Importer une langue**, puis choisissez votre `{code}.json`, ou
- le deeplink `bmm://language/import?path=C:/chemin/de.json` (sans `path` → sélecteur),
  ou l'API `POST /api/language/import { "path": "…" }`.
- BMM bascule dessus immédiatement.

## 6. Garder la parité
- BMM retombe sur l'anglais pour toute clé **manquante** — une traduction partielle
  fonctionne donc, mais visez 100 %.
- N'ajoutez pas de clés absentes de `en.json` (elles sont ignorées). Si vous traduisez
  les fichiers intégrés, `en.json` et `fr.json` doivent avoir le **même jeu de clés**
  (le contrôle de parité i18n du dépôt exige 0 différence).

## 7. Tester
Lancez BMM, basculez dans votre langue, et parcourez les pages, modals et les
dialogues benchmark/scheduler pour repérer les débordements ou chaînes non traduites.

---
*Astuce : traduisez sur le `en.json` le plus récent pour ne pas rater les nouvelles clés.*
