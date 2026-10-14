# Carte du dépôt

[English](REPO_MAP.md) · Français

Où se trouvent les choses dans Better Mod Manager (BMM), comment les morceaux s'assemblent, et par
où commencer pour les tâches courantes. Pour les règles de travail (vérifications, i18n, encodage,
sécurité), voir [AGENTS.md](AGENTS.md) et [CONTRIBUTING_FR.md](CONTRIBUTING_FR.md).

---

## Racine

| Chemin | Contenu |
|---|---|
| `frontend/` | L'interface (le `frontendDist` de Tauri) : `index.html`, sources TypeScript, CSS, traductions, ressources et documentation embarquées. |
| `src-tauri/` | Le cœur Rust : commandes Tauri, API HTTP locale, serveur MCP et CLI, gouverneur de ressources, configuration Tauri. |
| `scripts/` | Vérifications Node (`check-*.mjs`), générateurs (`gen-*.mjs`), cartes, synchro de la doc, outils de release. |
| `tests/` | Tests unitaires Node (`*.test.mjs`, lancés par `npm test`) et `fixtures/`. |
| `Update/` | Changelogs par version, `Documentation/` (références techniques, EN + FR), `Guides/`, anciennes notes de version (`Old/`, `Updates/`). |
| `BMM Docs/` | Sous-module git : le site de documentation (mkdocs, EN + FR). Ses pages sont copiées dans l'app par `scripts/sync-docs.mjs`. |
| `BetterInstaller/` | Sous-module git : l'installateur et le système de mise à jour qui livrent BMM (`examples/bmm/` contient la configuration et les scripts de BMM). |
| `BCW/` | Sous-module git : BetterCommunity Web (BCWEB : site, API et bot Discord). BMM lui parle en HTTP ; rien ici ne le construit. |
| `.github/` | Workflows CI, vérification de sécurité, règles Semgrep, captures du README. |
| `benchmarks/` | Benchmarks Criterion, JS et hyperfine (voir `benchmarks/README.md`). |
| `dev-pages/` | Pages de développement autonomes, jamais livrées (voir `dev-pages/README.md`). |
| `dist-assets/` | `bmms-vocabulary.json`, généré par `scripts/gen-bmms-reference.mjs`. |
| `video-out/` | Vidéos des animations de chargement et de sortie, rendues par `scripts/record-*.mjs`. |
| `app.cfg` | Options de build lues au démarrage (documentées dans `APP_CFG.md`). |
| `laya-model.lock.json` | Empreintes du pack de modèle IA hors ligne (vérifiées par `scripts/check-laya-pins.mjs`). |
| `progress.json` | Avancement de la feuille de route lu par le site (expliqué dans `PROGRESS_TRACKER.md`). |
| `ENDPOINTS.md` | Toutes les URL que BMM contacte et ce qui casse si elles échouent. |
| `RELEASE.md` | Comment une version est construite, signée et publiée. |
| `PRIVACY.md`, `TOS.md` (+ `_FR`) | Politique de confidentialité et conditions affichées aux utilisateurs. |

Hors git (ignorés) : `node_modules/`, `dist/`, `src-tauri/target/`, `src-tauri/gen/`, `Release/`
(sortie de l'installateur), `.Assets/` (plans et ressources du propriétaire), `.claude/` (réglages et
worktrees des agents), `tmp/` (brouillons, et dossier de travail par défaut de `scripts/laya/build_pack.py`).

---

## frontend/

| Chemin | Contenu |
|---|---|
| `src/core/` | Services partagés : `state.ts`, `api.ts` (appels `invoke` vers Tauri), `i18n.ts`, `commands.ts` (palette Ctrl+K), `deep_link_manager.ts`, `consent.ts`, `links-config.ts`, client BetterCommunity (`bc-*.ts`). |
| `src/features/` | Un dossier par fonctionnalité : `ai`, `apps`, `bench`, `catalogs`, `community`, `debug`, `dev`, `feedback`, `mapper`, `misc`, `mods`, `plugins`, `profiles`, `repo`, `settings` (dont le planificateur), `themes`, `tools`. |
| `src/ui/` | Coquille de l'app et UI partagée : `app.ts` (démarrage), modales, `modal-shell.ts`, `custom-select.ts`, tutoriels, accueil, barre de titre, notifications. |
| `src/docs/` | Documentation intégrée : `docs-hub.ts`, les moteurs B.MD (`md-lite.ts`, `md-safe.ts`, `md-hydrate.ts`), diagrammes, replays. |
| `src/types/` | Types partagés (`models.ts`) et typages Tauri. |
| `js/` | Sortie compilée de `src/` (`tsc --project frontend`). `js/lib/` contient les bibliothèques embarquées (DOMPurify et autres), le reste est généré. |
| `css/` | Feuilles de style ; `tokens.css` contient les jetons de thème. |
| `Lang/` | `en.json`, `fr.json` (mêmes clés obligatoires) et `template.json` (modèle pour les traducteurs). |
| `assets/` | Images, icônes, `links.json` (registre des liens), code embarqué, `docs/` (copie synchronisée de BMM Docs), crédits générés. |
| `index.html` | Tout le balisage statique, dont chaque carte des Paramètres (attributs `data-i18n`). |
| `deeplinks.json` | Table générée des routes `bmm://`. |

## src-tauri/

| Chemin | Contenu |
|---|---|
| `src/main.rs` | Point d'entrée : plugins, état, et l'`invoke_handler` qui enregistre chaque commande Tauri. |
| `src/state.rs` | Données persistantes de l'app, dont `AppSettings`. |
| `src/commands/` | Commandes Tauri, un module par domaine (`mods.rs`, `profile.rs`, `repo*.rs`, `catalog_*.rs`, `scheduler.rs`, `autoupdate.rs`, `consent_ledger.rs`, `ai_*.rs`, ...). `proc.rs` est la seule façon autorisée de lancer un processus. |
| `src/api/mod.rs` | API HTTP locale (warp), liée à `127.0.0.1`, port 51274 par défaut (réglage `api_port`), jeton et permissions par plugin. |
| `src/mcp/` | Serveur MCP : `server.rs`, `tools/` (groupes d'outils), `state_bridge.rs` (appelle l'app en cours via l'API locale), `actions.gen.json`. |
| `src/extra_tools/mcp_server.rs` | Le binaire `bmm-mcp-server` (un `[[example]]` cargo) : MCP sur stdio et la CLI (enum clap `Commands`). Livré comme sidecar dans `binaries/`. |
| `src/governor/` | Gouverneur de ressources : files, priorités de processus, cadence des E/S, mode jeu. Le travail lourd passe par lui. |
| `src/models/` | Modèles de données (mods, profils, modpacks, repos, catalogues, packs de lancement). |
| `src/templates/` | Fichiers écrits pour l'utilisateur : `docker/` (Dockerfiles, compose) et `mini-server/` (serveur de repo autonome). |
| `tests/` | Données de test Rust (formats de repo et de catalogue, jeux d'évaluation Laya). |
| `capabilities/` | Jeux de permissions Tauri. |
| `tauri.conf.json`, `Cargo.toml` | Configuration et version de l'app. |

## scripts/

- `check-*.mjs` : vérifications CI. `npm run ci` (dans `package.json`) les enchaîne, avec `tsc`,
  `npm test` et `sync-docs --check`.
- `gen-*.mjs`, `deeplink-map.mjs`, `dep-graph.mjs` : générateurs ; la plupart ont un mode `--check` utilisé par la CI.
- `sync-docs.mjs` : copie `BMM Docs/docs` vers `frontend/assets/docs`.
- `security-guard.mjs` : bloque l'exécution de code depuis une chaîne, les nouveaux gestionnaires d'événements inline et les pages de dev dans `frontend/`.
- `gen-update-manifest.mjs`, `sign-update-manifest.mjs`, `publish-bcweb-asset.mjs` : ressources de release.
- `laya/` : outils Python du pack IA hors ligne.
- Références et listes autorisées JSON utilisées par les vérifications (`governed-allowlist.json`, `dep-graph.baseline.json`, ...).

## .github/

- `workflows/ci.yml` : chaîne de vérifications (`npm run ci`), `cargo check`/`cargo test`, audits npm et cargo. Tourne sur `main` et `Tdev`.
- `workflows/security.yml` : gitleaks, Semgrep et la vérification de sécurité (`.github/scripts/security-gate.mjs`).
- `workflows/release.yml` : construit et publie une version sur un tag `v*`.
- `workflows/resign-manifests.yml` : renouvelle les manifestes de mise à jour signés avant leur expiration.
- `workflows/laya-model.yml` : construit le pack de modèle IA hors ligne.

---

## Comment les morceaux s'assemblent

- **TypeScript vers JavaScript** : `frontend/src/**/*.ts` est compilé vers `frontend/js/**` (`npm run watch`
  en dev, `tsc --project frontend` au build et en CI). `index.html` charge les fichiers compilés.
  `check-compiled-fresh.mjs` vérifie que le JS commité correspond au TypeScript.
- **Interface vers cœur** : l'interface appelle des commandes Tauri (`invoke`). Une commande est une
  fonction Rust de `src-tauri/src/commands/` enregistrée dans `main.rs`. `check-invoke-names.mjs` vérifie l'accord des deux côtés.
- **API HTTP locale** : plugins, pages personnalisées et CLI/MCP passent par `src-tauri/src/api/mod.rs`.
  Référence : `BMM Docs/docs/reference/api.fr.md` et `Update/Documentation/API_Reference_FR.md`.
- **CLI et MCP** : un seul binaire, `bmm-mcp-server`. Il travaille hors ligne sur le dossier de données et,
  quand BMM tourne, transmet les actions en direct par l'API locale (`state_bridge.rs`).
- **Documentation** : écrite dans `BMM Docs/docs` (`page.md` + `page.fr.md`), publiée en site, et copiée
  dans l'app par `sync-docs.mjs` pour Aide et autres. Le Markdown est rendu par B.MD.
- **Release** : `npm run build` (vérifications, compilation, `tauri build --no-bundle`, manifeste de mise à jour),
  puis `npm run build:installer` (BetterInstaller, `BetterInstaller/examples/bmm/`), puis manifestes signés et
  ressources. Détails dans [RELEASE.md](RELEASE.md).

---

## Par où commencer

| Tâche | Point de départ |
|---|---|
| Ajouter un réglage | Champ avec valeur par défaut serde dans `AppSettings` (`src-tauri/src/state.rs`) ; carte dans `frontend/index.html` ; logique dans `frontend/src/features/settings/settings.ts` ; clés dans `frontend/Lang/` ; mention dans la page BMM Docs concernée. |
| Ajouter une commande Tauri | Fonction dans un module de `src-tauri/src/commands/`, enregistrée dans `generate_handler!` de `src-tauri/src/main.rs`, appelée depuis `frontend/src/core/api.ts` ou la fonctionnalité. Processus uniquement via `commands::proc`. |
| Ajouter une route d'API | `src-tauri/src/api/mod.rs` (avec `require_permission`), puis les pages de référence de l'API (`check-api-docs`, `check-api-perms`). |
| Ajouter un outil MCP ou une commande CLI | `src-tauri/src/mcp/tools/` ou l'enum `Commands` de `src-tauri/src/extra_tools/mcp_server.rs`, puis `BMM Docs/docs/reference/mcp.md` / `cli.md` (`check-mcp-tools`, `check-cli-reference`). |
| Ajouter une traduction | Clés dans `frontend/Lang/en.json`, `fr.json` et `template.json` ; voir `Update/Documentation/TranslationGuide_FR.md`. |
| Ajouter une page de doc | `BMM Docs/docs/<section>/<page>.md` + `.fr.md`, navigation dans `BMM Docs/mkdocs.yml`, puis `node scripts/sync-docs.mjs`. |
| Ajouter une vérification CI | `scripts/check-<nom>.mjs`, à ajouter à `ci` dans `package.json` (voir [CONTRIBUTING_FR.md](CONTRIBUTING_FR.md)). |
| Ajouter une action du planificateur | `ACTION_TYPES` dans `frontend/src/features/settings/scheduler.ts`, puis `npm run gen`. |

---

## Fichiers générés

Ne pas les modifier à la main ; lancer le générateur.

| Fichier | Générateur |
|---|---|
| `frontend/js/**` (sauf `js/lib/`) | `tsc --project frontend` |
| `frontend/assets/docs/**`, `frontend/assets/docs/manifest.json` | `node scripts/sync-docs.mjs` |
| `src-tauri/src/commands/ask_index.gen.json` | `node scripts/gen-ask-index.mjs` |
| `src-tauri/src/mcp/actions.gen.json` | `node scripts/gen-mcp-actions.mjs` |
| `frontend/src/docs/bmms-reference.gen.ts`, `dist-assets/bmms-vocabulary.json`, pages de référence BMMScript | `node scripts/gen-bmms-reference.mjs` |
| `frontend/assets/credits-*.gen.json` | `node scripts/gen-credits.mjs` |
| `frontend/deeplinks.json` | `node scripts/deeplink-map.mjs --json` |
| `BMM Docs/docs/reference/translation-variables*.md` | `node scripts/gen-i18n-vars-reference.mjs` |
| `frontend/assets/icons/` | `node scripts/gen-icon-pack.mjs` |
| `frontend/assets/vendor/prism.min.js` | `node scripts/vendor-prism.mjs` |
| `scripts/dep-graph.baseline.json` | `node scripts/dep-graph.mjs --update` (seulement pour la baisser) |
| `dist/release-assets-v*/update-manifest.json` | `node scripts/gen-update-manifest.mjs` |

`npm run gen` lance ensemble les générateurs BMMScript, actions MCP, liens profonds et crédits.
