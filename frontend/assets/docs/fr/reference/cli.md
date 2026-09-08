# Référence CLI

L'exécutable qui sert les [outils MCP](doc-page:reference/mcp.fr) de BMM est aussi un **outil en ligne de
commande**. Même binaire, même dossier d'installation — `bmm-mcp-server.exe`, à côté de
`BetterModsManager.exe` — et l'appeler avec une sous-commande au lieu de `serve` donne 62
commandes utilisables depuis un terminal, un `.bat`, une tâche planifiée ou une étape de CI.

```bash
bmm-mcp-server profiles
bmm-mcp-server enable mon-id-de-mod
bmm-mcp-server call GET /api/status
```

!!! tip "Trois portes, un seul cœur"

    L'[API HTTP locale](doc-page:reference/api.fr) est pour les plugins et les scripts, [MCP](doc-page:reference/mcp.fr) est
    pour les clients IA, et ceci est pour une personne devant un prompt. Les trois atteignent
    le même cœur. Prends la plus proche de ce qui tourne déjà : un `.bat` veut la CLI, un
    plugin veut l'API, un assistant veut MCP.

---

## Avec BMM ouvert, et sans

Certaines commandes lisent les fichiers de données de BMM directement sur le disque et
fonctionnent **app fermée** — `profiles`, `mods`, `schedules`, `actions`, `bmms-compile`.
D'autres demandent à l'app en cours d'exécution de faire quelque chose, et exigent qu'elle
soit **ouverte** : tout ce qui change un état, ouvre un écran, ou porte la mention
_(app ouverte)_ ci-dessous. Une commande qui a besoin de l'app et ne la trouve pas le dit et
sort en code non nul, plutôt que d'annoncer qu'il ne s'est rien passé.

`api` affiche l'URL, le port et le token de l'API locale — c'est ainsi qu'un script
s'authentifie pour tout ce que la CLI n'enveloppe pas :

```bash
bmm-mcp-server api --reveal
```

---

## Les commandes

62 au total. `*` marque un argument obligatoire ; une valeur entre parenthèses est la valeur
par défaut. Les arguments positionnels s'écrivent `<comme-ceci>`, les options `--comme-ceci`.

### Pour se repérer

| Commande | Arguments | Ce que ça fait |
|---|---|---|
| `serve` | — | Démarre le serveur MCP (JSON-RPC sur stdio). C'est ce que lance un client MCP, et c'est aussi le comportement par défaut sans sous-commande |
| `info` | — | Où BMM range ses données, quelle version est installée, si l'app tourne |

### Profils

| Commande | Arguments | Ce que ça fait |
|---|---|---|
| `profiles` | — | Liste tous les profils |
| `active-profile` | — | Détaille le profil actif |
| `set-profile` | `<profile-id>`\* | Change le profil actif |

### Mods

| Commande | Arguments | Ce que ça fait |
|---|---|---|
| `mods` | `--profile`, `--filter` (`all`) | Liste les mods, d'un profil si tu en donnes un. `--filter` vaut `all`, `enabled` ou `disabled` |
| `mod` | `<mod-id>`\* | Détaille un mod |
| `search` | `<query>`\* | Cherche parmi les mods, par nom et description |
| `enable` | `<mod-id>`\* | Active un mod dans le profil actif |
| `disable` | `<mod-id>`\* | Désactive un mod |
| `sync` | — | Applique le profil actif : déploie ce qui est activé, retire le reste |

### Dépôts serveur

| Commande | Arguments | Ce que ça fait |
|---|---|---|
| `generate-repo` | `--name`\*, `--mod-ids` | Génère un dépôt de mods, signé avec l'identité de cette installation |
| `start-server` | `--path`\*, `--port` (`8080`) | Démarre le serveur HTTP du dépôt, avec un tunnel Cloudflare s'il est configuré |
| `generate-lightweight` | `--repo-path`\*, `--port` (`8000`), `--auto-start` (`false`), `--cloudflare` (`false`), `--upnp` (`false`), `--upload-limit` (`0`), `--server-version` (`2`), `--password` (`admin`) | Écrit un `.bat` autonome qui sert un dossier de dépôt, pour une machine qui n'aura pas BMM |

### Diagnostic

| Commande | Arguments | Ce que ça fait |
|---|---|---|
| `stats` | — | Statistiques globales : mods, profils, disque |
| `crashes` | `--limit` (`10`) | Liste les rapports de crash récents |
| `crash` | `<report-path>`\* | Lit et analyse un rapport de crash |
| `export-config` | `<target-path>`\* | Écrit le `data.json` de BMM dans un fichier |

### Launch packs

| Commande | Arguments | Ce que ça fait |
|---|---|---|
| `launchpacks` | — | Liste tous les launch packs |
| `run-pack` | `<id>`\* | Lance un launch pack |
| `delete-pack` | `<id>`\* | Supprime un launch pack |
| `open-pack` | `<id>`\* | Ouvre le dossier d'un launch pack |

### Plugins, apps et le reste de la bibliothèque

| Commande | Arguments | Ce que ça fait |
|---|---|---|
| `api` | `--reveal` (`false`) | L'URL, le port et le token de l'API Plugin locale. Le token reste masqué sans `--reveal`, donc la commande nue est sûre à lancer devant quelqu'un |
| `plugins` | — | Plugins installés : id, nom, version, permissions |
| `plugin` | `<plugin-id>`\* | La fiche complète d'un plugin — manifeste, permissions, état |
| `plugin-assets` | `<plugin-id>`\* | Les fichiers qu'un plugin embarque dans son dossier `assets/` |
| `plugin-asset` | `<plugin-id>`\*, `<path>`\* | Affiche un de ces fichiers. Texte uniquement, et rien n'est exécuté |
| `apps` | — | L'état du Catalogue d'apps : apps installées, favoris, sources communautaires |
| `modpacks` | — | Liste les modpacks |
| `create-modpack` | `<name>`\*, `<mod-ids>` | Crée un modpack à partir d'ids (ou de noms) de mods |
| `tags` | — | Les tags de mods que tu as créés |
| `repos` | — | Les Server-Repos auxquels ce BMM est connecté |
| `themes` | — | Les thèmes d'interface installés, et celui qui est actif |
| `verify-mod` | `<mod-id>`\* | Vérifie les fichiers d'un mod sur le disque contre ses empreintes SHA-256 |
| `delete-mod` | `<mod-id>`\*, `--files` (`false`) | Retire un mod de BMM. `--files` supprime aussi son dossier |

### Ce qu'un dépôt porte en plus des mods

| Commande | Arguments | Ce que ça fait |
|---|---|---|
| `catalogs` | — | Les catalogues que ce BMM suit, par type |
| `follow` | `--type`\*, `<url>`\*, `--off` (`false`) | Suit un catalogue ; `--off` arrête de le suivre |
| `repo-extras` | `<url>`\*, `--password` | Ce qu'un dépôt porte en plus des mods — plugins, automatisations, thèmes, listes de mods, catalogues à suivre. Lit le manifeste et ne télécharge rien |
| `repo-take` | `<url>`\*, `<kind>`\*, `<id>`\*, `--password` | En prend UN, nommé par type et id d'après `repo-extras`. Un plugin ou une automatisation arrive **désactivé** ; un catalogue est suivi plutôt que téléchargé ; une liste de mods est enregistrée et son chemin affiché |

### Clés d'identité

| Commande | Arguments | Ce que ça fait |
|---|---|---|
| `keys` | — | Les clés d'identité avec lesquelles BMM peut prouver — noms et chemins seulement |
| `new-key` | `<name>`\*, `--kind` | Crée une paire de clés. Affiche la ligne PUBLIQUE et où la moitié privée a été écrite ; la moitié privée elle-même n'est jamais affichée |

### La porte de sortie

| Commande | Arguments | Ce que ça fait |
|---|---|---|
| `call` | `<method>`\*, `<path>`\*, `<body>` | Appelle directement l'[API locale](doc-page:reference/api.fr) de l'app en cours — `call GET /api/status`. Tout ce que la CLI n'enveloppe pas est atteignable ainsi |

### Vie privée, enregistreur et sessions

| Commande | Arguments | Ce que ça fait |
|---|---|---|
| `recorder` | `--on`, `--full`, `--rust`, `--js` | Configure l'enregistreur de session local _(app ouverte)_ |
| `sessions` | — | Liste les rapports de session enregistrés |
| `telemetry-consent` | `<enabled>`\* | Règle le consentement à la télémétrie anonyme _(app ouverte)_ |
| `telemetry-settings` | `--replay`, `--full`, `--bench` | Règle les sous-options Vie privée &amp; télémétrie _(app ouverte)_. Une option omise reste inchangée |

### Planification et automatisation

| Commande | Arguments | Ce que ça fait |
|---|---|---|
| `schedules` | — | Les tâches enregistrées : id, nom, et si chacune est armée |
| `schedule-set` | `<id>`\*, `--off` (`false`) | Arme ou désarme une tâche |
| `signal` | `<name>`\*, `<data>` | Sonne une cloche qu'une tâche attend peut-être (`wait.hook`) |
| `run-schedule` | `<id>`\* | Lance une tâche enregistrée maintenant _(app ouverte)_ |
| `create-schedule` | `--file`, `--json` | Crée ou met à jour une tâche depuis un fichier JSON (`-` pour stdin) ou du JSON en ligne. La forme est celle que le constructeur in-app enregistre, et une nouvelle tâche est créée **désactivée** sauf si le JSON dit `enabled: true` — pour qu'on puisse la lire avant qu'elle ne se déclenche |
| `delete-schedule` | `<id>`\* | Supprime une tâche |

### Écriture : plugins et BMMScript

| Commande | Arguments | Ce que ça fait |
|---|---|---|
| `create-plugin` | `--file`, `--json`, `--scripts` | Échafaude un brouillon de plugin — `plugin.json`, README, scripts embarqués — dans `<app-data>/plugin-drafts/<id>/`. Écriture seulement : zippe le brouillon et installe-le par le chemin normal de BMM, et les scripts ne tournent toujours que derrière la permission unsafe-plugins |
| `actions` | — | Tous les types d'action qu'une étape de tâche peut utiliser, depuis le registre que montre le constructeur in-app. Une étape s'écrit `{kind:'action', action:{type:<un de ceux-ci>, params:{…}}}` |
| `bmms-reference` | — | Tout le vocabulaire [BMMScript](doc-page:features/bmmscript-reference.fr) en JSON : actions et leurs paramètres, conditions, sources de valeurs, sources de boucle, mots-clés, permissions, moteurs de script |
| `bmms-compile` | `--file`, `--source` | Compile du BMMScript vers le JSON de tâche que `create-schedule` accepte |
| `bmms-decompile` | `--file`, `--json` | Réaffiche une tâche enregistrée en BMMScript — la façon de l'éditer comme du texte plutôt que comme un arbre |

La paire est tout l'intérêt :

```bash
bmm-mcp-server bmms-compile --file nightly.bmms | bmm-mcp-server create-schedule --file -
```

`bmms-compile` sort en code non nul et n'affiche **rien** sur stdout quand la source ne
compile pas : ce tube ne peut donc pas enregistrer une tâche à moitié lue. Écrire le JSON à
la main, c'est assembler un arbre imbriqué et découvrir qu'il est faux au moment où la tâche
tourne ; ici la ligne et la colonne sont nommées. Aucune des deux n'a besoin de l'app ouverte.

### Benchmarks

| Commande | Arguments | Ce que ça fait |
|---|---|---|
| `benchmark` | `--dataset` (`sandbox`), `--size` (`M`), `--mb`, `--source`, `--profile`, `--auto` (`false`) | Lance un benchmark _(app ouverte)_. `--dataset sandbox` génère ses propres données ; `real` utilise les dossiers `--source` et les ids `--profile`. Sans `--auto`, ça ouvre l'écran de benchmark pré-rempli au lieu de tourner sans interface |

### Langue et thèmes

| Commande | Arguments | Ce que ça fait |
|---|---|---|
| `lang-template` | `--out` | Télécharge le JSON modèle de traduction — chaque clé avec son défaut anglais _(app ouverte)_ |
| `import-language` | `<path>`\* | Installe un `.json` traduit _(app ouverte)_ |
| `theme-apply` | `<theme-id>`\* | Définit le thème actif ; il s'applique au prochain rechargement des thèmes |
| `theme-info` | `<theme-id>`\* | La définition complète d'un thème personnalisé installé |

---

## Garder cette page honnête

Ce tableau est vérifié contre l'énumération `Commands` de
`src-tauri/src/extra_tools/mcp_server.rs` — les mêmes déclarations à partir desquelles clap
construit l'arbre de commandes — par `scripts/check-cli-reference.mjs`, qui tourne en CI.
Chaque commande doit figurer ici, chaque argument doit être nommé, et le total ci-dessus doit
être le vrai.

C'est le même dispositif que pour la [référence MCP](doc-page:reference/mcp.fr), et pour la même raison : une
liste de soixante-deux choses tenue à la main se trompe la première fois que quelqu'un en
ajoute une soixante-troisième, et rien, dans une page de référence fausse, ne refuse de
compiler.

---

## Voir aussi

- [Référence du serveur MCP](doc-page:reference/mcp.fr) — l'autre moitié du même binaire, et ses 69 outils
- [API locale &amp; deeplinks](doc-page:reference/api.fr) — ce que `call` appelle
- [Référence BMMScript](doc-page:features/bmmscript-reference.fr) — le langage que lit `bmms-compile`
- [Référence des actions](doc-page:reference/actions.fr) — ce que liste `actions`
