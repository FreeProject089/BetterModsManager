# Outil de publication

[English](README.md)

Une commande qui construit et vérifie tout ce qu'une version de BMM demande, étape par étape,
avec un journal par étape et un récapitulatif à la fin. Il ne fait jamais de commit, de tag, de
push ni de publication : la dernière étape affiche la commande `gh release create` et c'est une
personne qui la lance.

```bat
tools\release\release.bat
```

Sans argument, un menu s'affiche : choisissez la version, puis les étapes (`a` pour toutes,
`1,3,5-7`, `q` pour quitter). Sans aucune question :

```bat
tools\release\release.bat --all --version 1.0.3 --yes
tools\release\release.bat --version 1.0.3 --steps preflight,changelog,verify,media --yes
```

Tout arrive dans `Release/<version>/` (ignoré par git), les journaux dans
`Release/<version>/logs/`. Une étape en échec arrête la suite, sauf si vous répondez « continuer »
(mode interactif) ou passez `--continue`. Le récapitulatif s'exécute toujours.

## Les étapes

| # | Étape | Ce qu'elle fait | Produit |
|---|---|---|---|
| 1 | `preflight` | branche et état git (un arbre modifié est un avertissement), version précédente et commit où son historique s'arrête, versions des outils (node, npm, rustc, cargo, CLI Tauri, bpkg, gh, python, hyperfine, ffmpeg, Gource, Chrome), `check-release-versions`, présence du journal rédigé, machine occupée ou non. `--gates` lance `npm run ci`, `--tests` lance `npm test`, `--cargo-test` lance `cargo test` (proposés en mode interactif) | journal |
| 2 | `version` | affiche la version de chaque source (package.json, package-lock.json, tauri.conf.json, Cargo.toml, Cargo.lock, installer.toml de BetterInstaller), demande la nouvelle (`x.y.z`, `patch`, `minor`, `major`, `pre`), ne réécrit que les octets de la version (UTF-8 sans BOM ; refuse une réécriture qui changerait un accent ou le nombre de lignes), lance `check-release-versions` | les 6 fichiers |
| 3 | `changelog` | `git log <précédente>..HEAD` classé en sécurité / nouveautés / corrections / docs / CI / maintenance / autres (un préfixe Conventional l'emporte, sinon des mots-clés), avec empreintes, dates et **noms** d'auteurs (jamais d'adresse e-mail) ; plus l'historique de chaque gitlink (BMM Docs, BetterInstaller, BCW) entre le commit enregistré à la version précédente et maintenant. Avertit si `Update/changelog_v<version>_{EN,FR}.md` (rédigé à la main) manque | `COMMITS.md` |
| 4 | `build` | attend une machine libre, lance `BetterInstaller/examples/bmm/release.ps1 -Version <v>` (sans `-Publish`) : contrôle des versions, `npm run build`, paquet, signature, `BMM-Setup.exe`, delta, `update.json` et `update-manifest.json` signés. Puis `npx tauri build --bundles nsis,msi` pour les installateurs classiques | `BMM-Setup.exe`, `bmm.bpkg`, `update.json`, `update-manifest.json`, `lang-*.json`, `links.json`, `extras/` (NSIS + MSI, **pas pour GitHub**) |
| 5 | `verify` | `bpkg info` (version), `bpkg verify --key` (signature), `bpkg verify-manifest --setup` (setup ↔ manifeste), update.json liste `BMM-Setup.exe` avec le bon SHA-256, update-manifest.json liste exactement cet installateur, dates d'expiration affichées (avertit sous 6 jours), règles de la 0.9.11 (un seul installateur nommé `BMM-Setup.exe`, pas de .msi, pas de .zip), `check-release-versions --artifacts` (quand la racine `Release/` contient encore ce build), sommes de contrôle | `SHA256SUMS.txt` |
| 6 | `docs` | PDF anglais et français de BMM Docs sans WeasyPrint/GTK : un venv privé (`tools/release/.cache/docs-venv`) avec le `requirements.txt` haché des docs + `mkdocs-print-site-plugin`, un site d'une seule langue par langue, construit dans le cache à partir du `mkdocs.pdf-chrome.yml` des docs (`docs/lang_config.py` : avec le plugin i18n, la passe française écrasait l'unique page d'impression et le livre « anglais » sortait en français), puis Chrome sans interface imprime chaque `print_page/` une fois tous les diagrammes Mermaid dessinés | `docs/BMM-Docs-EN.pdf`, `docs/BMM-Docs-FR.pdf` |
| 7 | `media` | cartes de la version (`tools/release/media/cards.mjs`, texte dans `cards.<version>.json`), captures de la vraie interface avec des données de démonstration, **composées comme BMM sur un bureau** : la fenêtre arrondie entière sur un fond transparent et Tasky qui flotte sur son coin supérieur gauche (`--no-tasky` pour l'enlever), la bannière du README ; chaque visuel existe aussi en SVG à calques et en PSD à calques | `media/*.png`, `media/source/*.svg + .psd`, `media/screenshots/…`, `.github/screenshots/*.png`, `.github/screenshots/layers/`, `.github/screenshots/source/*.svg` |
| 8 | `readme` | README.md / README_EN.md / README_FR.md : badge de version, texte alternatif de la bannière, « Nouveautés de la X » et les liens du journal (les liens ne bougent que si le nouveau journal existe ; « nouveau en 1.0.2 » à côté d'une fonction est de l'historique et reste) | les 3 README |
| 9 | `bench` | attend une machine libre, lance Criterion, le collecteur mémoire, les micro-benchmarks JS et hyperfine, enregistre `benchmarks/results/<version>/summary.json` (versionné) + `raw/` (ignoré), compare avec la version antérieure la plus récente, écrit le rapport | `bench/BENCHMARK.md`, `BENCHMARK_FR.md`, `BENCHMARK.html`, `comparison.json`, `charts/*.png|svg`, `charts/overview.gif` |
| 10 | `gource` | vidéo de l'historique de BMM + BMM Docs + BetterInstaller + BCW (+ `../BetterCommunity-v2` s'il est là), un journal fusionné, légendes à chaque changement de version, taille/vitesse/graine fixes, look BMM ; MP4 (H.264, yuv420p, +faststart), un GIF léger et une image d'affiche ; réencode `frontend/assets/videos/credits_bg.mp4` à partir de ce rendu (muet, fondus pour une boucle propre, jamais plus lourd qu'avant) | `media/gource-<v>.mp4`, `.gif`, `-poster.png`, vidéo des crédits |
| 11 | `notes` | `github-release.md` : le commentaire « MAINTAINER NOTES » (titre, tag, ordre, fichiers, signature, vérification), le journal rédigé comme corps, tableau des téléchargements, tableau SHA-256, liens ; `github-release.body.md` sans le commentaire, pour `--notes-file`. Affiche la commande `gh release create`. Un `github-release.md` retouché à la main n'est jamais écrasé (le brouillon va dans `github-release.generated.md`) | les deux fichiers |
| 12 | récapitulatif | toujours : tableau des étapes, durées, sorties ; rafraîchit `SHA256SUMS.txt` | `RELEASE-SUMMARY.md` |

**Seul `BMM-Setup.exe` est publié comme installateur.** BMM 0.9.11 lance le premier `.msi`/`.exe`
d'une version (voir [RELEASE.md](../../RELEASE.md), « Bridging older installs ») : les builds
NSIS/MSI classiques restent dans `extras/` et ne vont jamais sur GitHub.

## Options

`release.bat --help` donne la liste complète. Les plus utiles :

| Option | Effet |
|---|---|
| `--version X.Y.Z` | la version (sinon celle de package.json, ou demandée) |
| `--all` / `--steps a,b` | quelles étapes (identifiants ou numéros) |
| `--yes` | aucune question ; arrêt au premier échec |
| `--continue` | continuer après un échec |
| `--from <ref>` / `--previous X.Y.Z` | imposer le début de l'historique |
| `--gates`, `--tests`, `--cargo-test` | les contrôles lourds du preflight |
| `--skip-bmm-build` | build : réutiliser l'exe déjà construit (`release.ps1 -SkipBmmBuild`) |
| `--no-bundles` | build : pas d'extras NSIS/MSI |
| `--lenient-artifacts` | verify : un échec de `check-release-versions --artifacts` n'est qu'un avertissement |
| `--no-screenshots`, `--no-tasky`, `--tasky app|br|off`, `--gifs` | options des médias (`--gifs` : enregistre aussi les clips d'usage) |
| `--bench-skip-run`, `--bench-only rust,js,hyperfine,mem` | options des benchmarks |
| `--gource-seconds N`, `--no-credits` | options de Gource |
| `--no-wait`, `--force` | ne pas attendre une machine libre ; lancer quand même |
| `--max-cpu N`, `--wait-minutes N` | bench : « libre » veut aussi dire que les autres programmes utilisent au plus N % du processeur (10 par défaut : un jeu ou un appel vidéo compte comme occupé) ; durée d'attente |

## Comment la version précédente est trouvée

1. `--from <ref>` s'il est donné ;
2. la première ligne du journal rédigé, « Changelog v1.0.2 (since 60b5f6d, …) » ;
3. un tag `v<précédente>`, **seulement** s'il est un ancêtre de HEAD et que son package.json dit
   cette version (dans ce dépôt, les tags v1.0.1 / v1.0.2 pointent vers un commit de main qui dit 0.9.9) ;
4. la version GitHub précédente (lue avec `gh release list`) : le dernier commit avant sa publication ;
5. le dernier commit dont package.json disait encore la version précédente.

La version précédente elle-même est la plus haute version inférieure parmi les tags et les versions GitHub.

## Benchmarks

`benchmarks/results/<version>/summary.json` contient chaque mesure d'une version : estimation,
intervalle à 95 %, nombre d'échantillons, débit, machine et outils. La version d'avant est le
`results/<version inférieure>/` le plus récent sur le disque, ou dans l'historique git. Un verdict
n'est **mieux** ou **moins bien** que si l'écart dépasse ±5 % (±15 % pour une mesure unique)
**et** que les deux intervalles ne se chevauchent pas (et que l'intervalle de variation de
Criterion, quand il a comparé à cette version, ne contient pas zéro) ; sinon **identique**.
`BENCHMARK_FR.md` explique chaque mesure simplement : ce qu'elle mesure, pourquoi c'est important,
unité, sens.

`benchmarks/results/1.0.0/summary.json` a été capturé à partir des résultats présents sur le disque
avant l'exécution de la 1.0.2 (Criterion juin 2026, JS juillet, mémoire juillet, clé créateur
septembre ; package.json disait 1.0.0 pour tous). Il n'existe pas de résultats pour la 1.0.1.

Le code des benchmarks a gagné trois chemins critiques de la 1.0.2 : `catalog_normalize` (le
normaliseur universel de catalogues, `catalog_format.rs` monté tel quel), `repo_hash` (le hachage
« Valider / Convertir » de Server Repo, `repo_format.rs` monté tel quel ; séquentiel, parallèle,
cache) et, côté JS, le registre d'activité et le normaliseur de catalogues de l'interface (les
modules compilés eux-mêmes).

Rapport seul (sans nouvelle exécution) : `node tools/release/bench/run.mjs --version 1.0.3 --skip-run`.

## Médias

- Texte des cartes par version : `tools/release/media/cards.<version>.json` (`en` / `fr` : `sub`,
  `chips`, `whatsNew` avec `{version}`, six `features`). Sans ce fichier, les cartes disent des
  choses génériques et l'étape avertit. La version affichée vient toujours de l'exécution.
- Captures : `tools/release/screenshots/` (`shoot.mjs`, `scenes.mjs`, `fixtures.mjs`, `hero.mjs`).
  L'outil sert lui-même `frontend/` sur un port local aléatoire ; sans Tauri, l'application utilise
  son simulateur intégré, alimenté **uniquement avec des données de démonstration** (`fixtures.mjs` :
  adresses example.org, un utilisateur « Demo »). Ajoutez une scène dans `scenes.mjs`. Aperçus des thèmes (THEMES.md) : `node tools/release/screenshots/themes.mjs --frontend <checkout>/frontend --out <checkout>/.github/themes`, une image de la Bibliothèque par thème intégré de ce checkout, même composition.
- Clips d'usage (GIF + MP4) : `tools/release/screenshots/gifs.mjs`, scènes dans `gif-scenes.mjs`
  (suivre un dépôt, résoudre un conflit, centre d'activité, éditeur de thème, créer un plugin,
  Outils BMM, notifications, paramètres). Même aperçu, mêmes données de démonstration et même
  composition que les captures, avec un pointeur dessiné. Le screencast DevTools enregistre chaque
  rafraîchissement ; ffmpeg (`C:\ffmpeg\bin`, ou `FFMPEG`) garde chaque image sa vraie durée et
  produit un MP4 (taille native, 30 i/s) et un GIF à palette optimisée (1000 px, 14 i/s, réduit
  jusqu'à passer sous 8 Mo). Une scène peut répondre elle-même à des commandes du mock (`mock`)
  quand les fixtures ne suffisent pas, et être accélérée (`speed`). Seul : `node tools/release/screenshots/gifs.mjs [--previews] [--width 1000] [--fps 14] [--max-mb 8] [scène …]` ;
  avec l'étape media : `--gifs`. Sortie : `Release/<version>/media/gifs/` (`<nom>.gif`, `.mp4`,
  `gifs.json`, `previews/`), à relire ; copiez à la main ceux qui sont validés dans `.github/gifs/`.
- Sources modifiables :
  - **SVG à calques** (calques Inkscape ; Illustrator et Affinity lisent les id des groupes comme
    noms de calques ; Photoshop importe un SVG aplati) : cartes `background / logo / title /
    version / subtitle / chips / footer` (ou `features`), bannière `background / screenshot back /
    screenshot front / logo / title / tagline / version`, captures `screenshot / Tasky`. Les
    polices sont notées dans chaque fichier : Segoe UI Variable Display / Segoe UI (cartes), Inter
    avec Segoe UI en secours (bannière).
  - **PSD à calques** (format Photoshop 1, RVB 8 bits, un calque matriciel par calque SVG, RLE),
    écrit par un petit module sans dépendance (`lib/psd.mjs`) et relu avec Pillow pendant le
    développement. Les calques sont des pixels : modifiez le texte dans le SVG.
  - Dans le dépôt, `.github/screenshots/source/` garde des SVG légers qui **lient** les PNG de
    `../` et `../layers/` ; les sources SVG + PSD autonomes sont dans `Release/<version>/media/`.

## Gource

Demande Gource (`C:\Program Files\Gource`, ou `GOURCE`) et ffmpeg (`C:\ffmpeg\bin`, ou `FFMPEG`).
Le journal que Gource écrit ne contient que les noms des auteurs ; rien ne quitte la machine. Les
avatars sont des images locales associées par nom (`frontend/assets/userpfp/<nom>.png`, les images
que `contributors.json` cite). Gource ouvre une fenêtre pendant le rendu.
`node tools/release/media/gource.mjs --version X` lance l'étape seule.

## Tests

```bash
node --test tools/release/test/*.test.mjs
```
