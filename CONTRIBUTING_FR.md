# Contribuer à Better Mod Manager

[English](CONTRIBUTING.md) · Français

Merci de votre aide. Ce guide couvre l'installation, les commandes, les règles qu'une modification
doit suivre et comment l'envoyer. Où se trouvent les choses : [REPO_MAP_FR.md](REPO_MAP_FR.md).
Notes pour les agents de code IA : [AGENTS.md](AGENTS.md). Problèmes de sécurité :
[SECURITY_FR.md](SECURITY_FR.md), jamais une issue publique.

## Installation

Il vous faut :

- **Windows 10 ou 11** (BMM est une application Windows).
- **Node.js 22**, la version utilisée par la CI.
- **Rust stable** (`rustup default stable`).
- Les **[prérequis de Tauri v2](https://v2.tauri.app/start/prerequisites/)** : Microsoft C++ Build
  Tools et **WebView2** (déjà présent sur un Windows 10 ou 11 à jour).
- Facultatif : les sous-modules `BMM Docs` et `BetterInstaller`, pour la synchro de la doc et l'installateur.

```bash
git clone https://github.com/FreeProject089/BetterModsManager.git
cd BetterModsManager
git submodule update --init "BMM Docs" BetterInstaller   # facultatif
npm install
```

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Surveillance TypeScript et l'app en mode développement. |
| `npm run build` | Vérifications avant build, générateurs, synchro de la doc, compilation, `tauri build --no-bundle`, manifeste de mise à jour. |
| `npm run build:installer` | Construit l'installateur avec BetterInstaller (`BetterInstaller/examples/bmm/`). |
| `npm test` | Tests unitaires Node (`tests/*.test.mjs`). |
| `npm run ci` | Toutes les vérifications, dans l'ordre de la CI (inclut `tsc` et `npm test`). |
| `cargo check --all-targets`, `cargo test` | Vérifications Rust, à lancer dans `src-tauri/`. |
| `npm run gen` | Régénère les références générées (BMMScript, actions MCP, liens profonds, crédits). |

Le processus de release est décrit dans [RELEASE.md](RELEASE.md).

## Branches et commits

- Le développement se fait sur **`Tdev`** ; les versions partent de `main`, et une version est un tag `v*`.
  Ouvrez les pull requests vers `Tdev`.
- Une modification par commit. Le message tient en **une ligne descriptive** qui dit ce qui change et
  pourquoi, dans le style de `git log` (par exemple : *« Update dialog: the reason an installer could not
  be checked is shown in the reader's language »*).
- Pas de lignes d'attribution IA ni de `Co-Authored-By` dans les messages de commit.
- Ne commitez jamais de secrets, de fichiers `.env*`, de clés, ni rien sous `Release/`.

## Règles qu'une modification doit suivre

- **`npm run ci` passe.** Chaque vérification explique son échec. Corrigez la cause plutôt que
  d'assouplir la vérification ; les références (baselines) ne font que baisser.
- **Traductions** : chaque texte visible utilise une clé de traduction. Ajoutez chaque clé à
  `frontend/Lang/en.json`, `fr.json` et `template.json`, insérée à côté de ses voisines (ne
  re-sérialisez pas les fichiers). Voir `Update/Documentation/TranslationGuide_FR.md`.
- **Documentation** : une modification visible met à jour sa page dans `BMM Docs/docs` (EN `page.md` et
  FR `page.fr.md`), puis `node scripts/sync-docs.mjs`. Le Markdown est rendu par B.MD ; n'ajoutez pas
  d'autre moteur de rendu.
- **Changelog** : les changements visibles vont dans `Update/changelog_v<version>_EN.md` et `_FR.md`.
- **Fichiers générés** : jamais modifiés à la main ; lancez leur générateur (liste dans REPO_MAP_FR.md).
- **Encodage** : UTF-8 sans BOM. Ne réécrivez pas de fichiers avec `Get-Content`/`Set-Content` de PowerShell.
- **Rust** : lancez les processus via `crate::commands::proc`, faites passer le travail lourd par le
  gouverneur de ressources, enregistrez les nouvelles commandes dans `src-tauri/src/main.rs`.
- **Confidentialité** : un changement de ce qui quitte la machine met à jour `PRIVACY.md`/`PRIVACY_FR.md`
  et `ENDPOINTS.md` ; un nouvel écran de consentement enregistre un reçu de consentement.

## Tests

- La logique TypeScript reçoit un test dans `tests/<nom>.test.mjs` (le lanceur de tests intégré de Node).
- La logique Rust reçoit des tests unitaires dans son module ou dans un fichier `*_tests.rs` voisin ;
  les données de test vont dans `src-tauri/tests/`.
- Une correction de bug s'accompagne, quand c'est faisable, d'un test qui échoue sans la correction.

## Ajouter une vérification CI

1. Écrivez `scripts/check-<nom>.mjs`. Commencez par un commentaire qui dit ce qu'il détecte et pourquoi
   il existe, et sortez avec le code `1` et un message qui explique comment corriger.
2. Ajoutez `node scripts/check-<nom>.mjs` au script `ci` de `package.json` (la CI lance `npm run ci`).
   Un raccourci comme `"check:<nom>"` est bienvenu.
3. Si la vérification analyse quelque chose de non trivial, testez-la dans `tests/` (voir
   `tests/check-governed.test.mjs`).
4. Vérifiez qu'elle passe sur l'arbre actuel et qu'elle échoue sur le cas qu'elle doit attraper.

## Code de conduite

Il n'y a pas de fichier de code de conduite séparé. Restez respectueux et constructif dans les
issues, les pull requests et sur [Discord](https://discord.gg/CTaaEF9R75).

## Licence

En contribuant, vous acceptez que votre contribution soit publiée sous la
[GNU General Public License v3.0 ou ultérieure](LICENSE.md).
