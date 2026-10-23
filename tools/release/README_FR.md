# Outil de publication

[English](README.md)

Une commande qui construit et vérifie tout ce qu'une version de BMM demande, étape par étape,
avec un journal par étape et un récapitulatif à la fin. Il ne fait jamais de commit. Il ne crée le
tag, ne pousse et ne publie que dans l'étape `publish`, qui ne s'exécute que si on la nomme
(`--steps publish`, jamais dans `--all`) et ne lance ces commandes qu'avec `--yes-publish` ; sinon
elle les affiche et c'est une personne qui les lance.

```bat
tools\release\release.bat
```

Sans argument, un menu s'affiche : choisissez la version, puis les étapes (`a` pour toutes,
`1,3,5-7`, `q` pour quitter). Sans aucune question :

```bat
tools\release\release.bat --all --version 1.0.4 --yes
tools\release\release.bat --version 1.0.4 --steps preflight,changelog,verify,media --yes
tools\release\release.bat --version 1.0.4 --steps publish --yes                 re-signe, revérifie, affiche les commandes
tools\release\release.bat --version 1.0.4 --steps publish --yes --yes-publish   … et les lance
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
| 4 | `gource` | AVANT le build, pour que l'installeur embarque la nouvelle vidéo des crédits. Vidéo de l'historique de BMM + BMM Docs + BetterInstaller + BCW (+ `../BetterCommunity-v2` s'il est là), un journal fusionné, **sans légende ni numéro de version** : les noms de fichiers lisibles, le logo BMM (`frontend/assets/brand/bmm-wordmark-dark.svg` dessiné en PNG, `--logo`), fond sombre ; MP4 (H.264, yuv420p, +faststart), un GIF léger et une affiche ; ré-encode `frontend/assets/videos/credits_bg.mp4` (sans son, fondus pour une boucle propre, jamais plus lourd qu'avant). Le build avertit si la vidéo des crédits est plus ancienne que le dernier commit | `media/gource-<v>.mp4`, `.gif`, `-poster.png`, vidéo des crédits |
| 5 | `build` | attend une machine libre, lance `BetterInstaller/examples/bmm/release.ps1 -Version <v>` (sans `-Publish`) : contrôle des versions, `npm run build`, paquet, signature, `BMM-Setup.exe`, delta, `update.json` et `update-manifest.json` signés. Puis `npx tauri build --bundles nsis,msi` pour les installateurs classiques | `BMM-Setup.exe`, `bmm.bpkg`, `update.json`, `update-manifest.json`, `lang-*.json`, `links.json`, `extras/` (NSIS + MSI, **pas pour GitHub**) |
| 6 | `verify` | `bpkg info` (version), `bpkg verify --key` (signature), `bpkg verify-manifest --setup` (setup ↔ manifeste), update.json liste `BMM-Setup.exe` avec le bon SHA-256, update-manifest.json liste exactement cet installateur et sa signature se vérifie (`sign-update-manifest.mjs verify`), dates d'expiration affichées (avertit sous 6 jours), règles de la 0.9.11 (un seul installateur nommé `BMM-Setup.exe`, pas de .msi, pas de .zip), `check-release-versions --artifacts` (quand la racine `Release/` contient encore ce build), sommes de contrôle | `SHA256SUMS.txt` |
| 7 | `docs` | PDF anglais et français de BMM Docs sans WeasyPrint/GTK : un venv privé (`tools/release/.cache/docs-venv`) avec le `requirements.txt` haché des docs (il fixe déjà le plugin print-site et pypdf : installation simple, plus de `--no-deps`), un site d'une seule langue par langue construit par le `language_config` de BMM Docs lui-même (`docs/lang_config.py` l'appelle ; plus de copie locale), puis Chrome sans interface met en page chaque `print_page/` comme un livre (`docs/print-style.mjs`) : couverture (logo, titre, version, date), sommaire avec liens et numéros de page (lus dans les signets d'une première impression), texte noir sur blanc au niveau AA (mesuré), code, tableaux bordés, GIF remplacés par une image fixe, rejeux remplacés par un lien, en-tête (nom BMM, version) et pied (page x / y), signets PDF | `docs/BMM-Docs-EN.pdf`, `docs/BMM-Docs-FR.pdf` |
| 8 | `media` | compile d'abord le frontend (`npx tsc --project frontend`) et **échoue** si un fichier compilé est plus ancien que sa source ou si les sources ne disent pas la version publiée (les images montrent l'application telle qu'elle est maintenant, servie depuis `frontend/` : les mêmes fichiers que Tauri embarque, donc le build n'est pas nécessaire ; `--no-compile` pour sauter tsc) ; cartes de la version (`tools/release/media/cards.mjs`, texte dans `cards.<version>.json`), captures de la vraie interface avec des données de démonstration, **composées comme BMM sur un bureau** : la fenêtre arrondie entière sur un fond transparent et Tasky qui flotte sur son coin supérieur gauche (`--no-tasky` pour l'enlever), la bannière du README ; chaque visuel existe aussi en SVG à calques et en PSD à calques | `media/bmm-<v>-<format>[.fr].png`, `media/source/{svg,psd}/` + `README.md`, `media/screenshots/…` (avec `hero.png`, `hero@2x.png`, `hero.mp4/.webm/.gif`, `hero-flat.png`), `.github/screenshots/*.png`, `.github/screenshots/layers/`, `.github/screenshots/source/*.svg` |
| 9 | `readme` | README.md / README_EN.md / README_FR.md : badge de version, texte alternatif de la bannière, « Nouveautés de la X » et les liens du journal (les liens ne bougent que si le nouveau journal existe ; « nouveau en 1.0.2 » à côté d'une fonction est de l'historique et reste) | les 3 README |
| 10 | `bench` | attend une machine libre, lance Criterion, le collecteur mémoire, les micro-benchmarks JS et hyperfine, enregistre `benchmarks/results/<version>/summary.json` (versionné) + `raw/` (ignoré), compare avec la version antérieure la plus récente, écrit le rapport | `bench/BENCHMARK.md`, `BENCHMARK_FR.md`, `BENCHMARK.html`, `comparison.json`, `charts/*.png|svg`, `charts/overview.gif` |
| 11 | `notes` | `github-release.md` : le commentaire « MAINTAINER NOTES » (titre, tag, ordre, fichiers, signature, vérification), le journal rédigé comme corps, tableau des téléchargements, tableau SHA-256, liens ; `github-release.body.md` sans aucun commentaire (ni la marque de génération ni les notes du mainteneur), pour `--notes-file`. Affiche la commande `gh release create`. Un `github-release.md` retouché à la main n'est jamais écrasé (le brouillon va dans `github-release.generated.md`) | les deux fichiers |
| 12 | `publish` | **seulement si on la nomme** (`--steps publish` ; pas dans `--all`, pas dans le « a » du menu). Si `update.json` ou `update-manifest.json` a moins de 14 jours devant lui (ou a expiré), re-signe **les deux** (`bpkg resign-manifest`, `node scripts/sign-update-manifest.mjs sign --require-signed` ; la clé `BetterInstaller/examples/bmm/keys/private.key` est passée par son chemin et jamais affichée). Les signatures durent 7 jours aujourd'hui : c'est donc à chaque publication. Copie les fichiers frais dans `Release/update.json` et `dist/release-assets-v<v>/` quand ils sont du même build. Relance ensuite `verify` (signatures, setup ↔ manifeste, SHA-256, `SHA256SUMS.txt`), rafraîchit le tableau SHA-256 (l'étape notes pour un `github-release.md` généré ; le tableau seul, sur place, pour un fichier retouché à la main) et écrit `github-release.body.md` sans commentaire. Refuse si l'envoi contiendrait un fichier de `extras/`, un second `.exe`/`.msi` ou un `.zip`, ou s'il manque un fichier requis. Affiche `git tag v<v>`, `git push origin v<v>`, `gh release create v<v> <les fichiers> --title "Better Mods Manager <v>" --latest --notes-file Release/<v>/github-release.body.md` ; ne les lance, dans cet ordre, qu'avec `--yes-publish` | manifestes re-signés, `SHA256SUMS.txt`, texte de la version |
| 13 | récapitulatif | toujours : tableau des étapes, durées, sorties ; rafraîchit `SHA256SUMS.txt` | `RELEASE-SUMMARY.md` |

**Seul `BMM-Setup.exe` est publié comme installateur.** BMM 0.9.11 lance le premier `.msi`/`.exe`
d'une version (voir [RELEASE.md](../../RELEASE.md), « Bridging older installs ») : les builds
NSIS/MSI classiques restent dans `extras/` et ne vont jamais sur GitHub.

## Options

`release.bat --help` donne la liste complète. Les plus utiles :

| Option | Effet |
|---|---|
| `--version X.Y.Z` | la version (sinon celle de package.json, ou demandée) |
| `--all` / `--steps a,b` | quelles étapes (identifiants ou numéros) ; `--all` laisse `publish` de côté |
| `--yes` | aucune question ; arrêt au premier échec |
| `--continue` | continuer après un échec |
| `--from <ref>` / `--previous X.Y.Z` | imposer le début de l'historique |
| `--gates`, `--tests`, `--cargo-test` | les contrôles lourds du preflight |
| `--skip-bmm-build` | build : réutiliser l'exe déjà construit (`release.ps1 -SkipBmmBuild`) |
| `--no-bundles` | build : pas d'extras NSIS/MSI |
| `--lenient-artifacts` | verify : un échec de `check-release-versions --artifacts` n'est qu'un avertissement |
| `--no-compile`, `--no-screenshots`, `--no-loop`, `--no-tasky`, `--tasky app|br|off`, `--gifs` | options des médias (`--gifs` : enregistre aussi les clips d'usage) |
| `--bench-skip-run`, `--bench-only rust,js,hyperfine,mem` | options des benchmarks |
| `--gource-seconds N`, `--no-credits` | options de Gource |
| `--no-wait`, `--force` | ne pas attendre une machine libre ; lancer quand même |
| `--yes-publish` | publish : lance vraiment `git tag`, `git push origin v<v>` et `gh release create` (`--yes` ne l'implique pas) |
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

Rapport seul (sans nouvelle exécution) : `node tools/release/bench/run.mjs --version 1.0.4 --skip-run`.

## Médias

- Cartes de version (`media/cards.mjs`) : réseaux 1200×630, Discord 960×540, en-tête de blog
  1600×600, carré 1080, « nouveautés » 1200×675, chacune en anglais et en français : 10 PNG nommés
  `bmm-<v>-<format>[.fr].png`, sans Tasky. Chaque format est composé pour son ratio : le logo et un
  badge `v<version>` en Bricolage Grotesque, le titre, une sous-ligne, jusqu'à trois points forts, et
  de **grandes captures** en perspective qui entrent par le bord droit ou le bas (`media/stage.mjs`) :
  l'éditeur d'Automatisations en mode Flux devant (`VIEW.flow` : le panneau de l'éditeur seul, sans
  fond assombri) et la fenêtre de la Bibliothèque de mods (`VIEW.window`) derrière, jamais une boîte de
  dialogue sur l'application. Un fin trait ambre court le long du bord supérieur. Le fond est marine avec une **grille déformée** (un maillage
  bombé par une lentille autour des captures, un champ d'ondes et une perspective, tiré d'une graine
  fixe : chaque exécution dessine la même) et du grain. Tout texte reste dans `cardSpecs().safe`
  (recadrage 1.91:1 de X et Mastodon, coins de Discord, grille 3:4 d'Instagram, aperçus de lien de
  l'en-tête de blog) et est AAA (7:1) sur ce qu'il recouvre (`cardContrast()`) ; les tests vérifient
  la zone sûre, qu'aucune capture ne couvre de texte, et que l'éditeur Flux est devant la Bibliothèque. Le texte est coupé et ajusté avec les largeurs mesurées des polices
  (`media/metrics.mjs`).
- Texte des cartes par version : `tools/release/media/cards.<version>.json` : `en` / `fr` avec
  chacun `headline` (6 mots au plus), `subline` (12 au plus), `whatsNew` avec `{version}`, trois
  `highlights` (`icon` Lucide, `title` de 5 mots au plus, `shot` + `crop` pour la tuile des
  nouveautés), et `shots` (la capture de chaque format). L'étape avertit quand un texte dépasse une
  limite ou ne tient pas dans sa boîte. Les anciens fichiers (`sub`, `chips`, `features`) se lisent
  encore. Sans fichier, les cartes disent des choses génériques et l'étape avertit. La version
  affichée vient toujours de l'exécution.
- Bannière du README (`screenshots/hero3d.mjs`), 1600×800 : deux vraies fenêtres empilées en grand
  et en perspective, la Bibliothèque de mods derrière et l'éditeur d'Automatisations en mode Flux
  devant, avec des ombres de profondeur, un halo aux couleurs de la marque et un reflet au sol, le logo, l'accroche et la version à gauche : `hero.png`, `hero@2x.png`, et une boucle de
  6 s où chaque fenêtre flotte sur sa propre sinusoïde : `hero.mp4` (H.264), `hero.webm` (VP9),
  `hero.gif` (800 px, 15 i/s) ; `--no-loop` la saute. L'ancienne bannière plate est gardée sous
  `hero-flat.png` (`screenshots/hero.mjs`). Seule :
  `node tools/release/screenshots/hero3d.mjs --version <v> --shots <dossier des captures> [--no-loop]`.
- Captures : `tools/release/screenshots/` (`shoot.mjs`, `scenes.mjs`, `fixtures.mjs`). Scènes :
  library, profiles, repo-sync, repo-host, settings (Analyse), intro, apps, activity, tools, et
  depuis la 1.0.4 mod-details, notifications, conflicts, automations-flow, laya, translation-studio,
  theme-editor, modpacks, modpack-wizard, history, catalogue-builder, settings-interface
  (`library-light` a été retirée). WebGL annonce une carte graphique de démonstration : aucun
  matériel réel n'apparaît.
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
- Sources modifiables, toutes dans `Release/<version>/media/source/` avec un `README.md` (EN/FR)
  qui liste chaque fichier et ses calques :
  - `svg/` : **SVG à calques** (calques Inkscape en groupes ; Illustrator et Affinity lisent les id
    comme noms de calques) : cartes `Background (Field and glow, Grid) / Product shot / Brand
    (Wordmark, Badge) / Text (Headline, Subline, Highlights, Footer)`, les nouveautés ajoutent
    `Screenshots`, bannières `Background / Windows / Brand / Text`, captures
    `screenshot-<nom>.svg` (fenêtre, Tasky, liés depuis `../../screenshots/layers/`). Le texte reste
    du texte ; les polices sont nommées dans chaque fichier.
  - `psd/` : **PSD à calques** pour chaque image (cartes × variantes × langues, `hero.psd`,
    `hero-flat.psd`, `screenshot-<nom>.psd`) : format Photoshop 1, RVB 8 bits, RLE, les mêmes
    groupes en dossiers, le profil **sRGB** intégré (`lib/icc.mjs`), écrits par `lib/psd.mjs` sans
    dépendance. Les calques de texte sont des pixels ; le `.txt` à côté du PSD de chaque carte en
    donne les mots.
  - Après écriture, l'étape **relit chaque PSD** (`readPsd` : taille, calques, groupes, profil) et
    compare son image aplatie au PNG ; un PSD illisible ou différent fait échouer l'étape
    (`media/sources.mjs`).
  - Dans le dépôt, `.github/screenshots/source/` garde des SVG légers qui **lient** les PNG de
    `../` et `../layers/` ; les sources SVG + PSD autonomes sont dans `Release/<version>/media/`.

## Gource

Demande Gource (`C:\Program Files\Gource`, ou `GOURCE`) et ffmpeg (`C:\ffmpeg\bin`, ou `FFMPEG`).
Le journal que Gource écrit ne contient que les noms des auteurs ; rien ne quitte la machine. Les
avatars sont des images locales associées par nom (`frontend/assets/userpfp/<nom>.png`, les images
que `contributors.json` cite). Gource ouvre une fenêtre pendant le rendu.
`node tools/release/media/gource.mjs --version X` lance l'étape seule.

L'image n'a ni légende ni numéro de version : les noms de fichiers (lisibles, affichés 2 s), les noms des dépôts
comme étiquettes de dossiers, le logo BMM, un fond sombre. L'étape tourne **avant** `build` : la vidéo des
crédits qu'elle écrit (`frontend/assets/videos/credits_bg.mp4`) est embarquée dans l'installeur.

## Tests

```bash
node --test tools/release/test/*.test.mjs
```
