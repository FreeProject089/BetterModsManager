# BMMScript — toutes les actions, conditions et valeurs

!!! info ""

    90 actions · 32 conditions · 31 valeurs · 8 sources de boucle

> Généré depuis le registre de BMM lui-même, donc cette page ne peut pas décrire une version de l'application qui n'existe pas. Si une action est dans l'éditeur de blocs, elle est dans cette liste.

Rien ici n'est une fonctionnalité BMMScript séparée. `do <nom>(…)` écrit ce que l'éditeur de blocs appelle l'action, et les noms de paramètres sont ceux que lit l'exécuteur — c'est pour cela que cette page est extraite du code plutôt qu'écrite à côté.

## Actions

S'écrit `do <nom>(param: valeur, …)`. Une action sans paramètre prend des parenthèses vides : `do mods.scan()`.

### Mods & profils

| Action | Ce qu'elle fait | Paramètres |
|---|---|---|
| `profile.activate` | Change le profil actif | `id` |
| `mod.enable` | Active un mod | `id` |
| `mod.disable` | Désactive un mod | `id` |
| `mods.order` | Déplace un mod dans l'ordre de déploiement. Deux mods actifs qui livrent le même fichier ne fusionnent pas — celui déployé en dernier est celui sur le disque. | `order` · `id` · `mode` |
| `modpack.enable` | Active tous les mods d'un modpack | `id` |
| `modpack.disable` | Désactive tous les mods d'un modpack | `id` |
| `modpack.create` | Crée un modpack depuis un profil | `name` · `profile` |
| `mod.add` | Télécharge & installe un mod depuis une URL | `url` · `name` |
| `modlist.export` | Enregistre les mods actuels en .mmlist | — |
| `modlist.import` | Charge des mods depuis un fichier .mmlist | — |
| `mods.enableAll` | Active tous les mods | — |
| `mods.disableAll` | Désactive tous les mods | — |
| `mods.scan` | Rescanne le dossier des mods | — |
| `plugin.apply` | Applique la modlist d'un plugin | `id` |
| `plugin.compare` | Compare un plugin aux mods actifs | `id` |
| `plugin.delete` | Désinstalle un plugin | `id` |
| `mods.checkUpdates` | Vérifie les MàJ des mods liés | — |
| `mods.autoImportOmm` | Importe les mods trouvés dans les dossiers OvGME/OMM connus de BMM. | — |
| `mods.clearHistory` | Vide la liste d’historique des mods. Les mods eux-mêmes ne sont pas touchés. | `id` |
| `mods.exportModpack` | Écrit le profil actif sous forme de modpack partageable. | `id` · `dir` |
| `modlist.apply` | Installe ce que la liste nomme et qui manque, puis active exactement ceux-là. | `path` · `url` · `install` · `exact` · `passphrase` |
| `plugin.asset` | En lire un dans une variable, le copier quelque part, ouvrir son dossier, ou l'exécuter. | `pluginId` · `path` · `mode` · `target` · `dir` · `engine` · `workingDir` · `into` |

### Repo & partage

| Action | Ce qu'elle fait | Paramètres |
|---|---|---|
| `repo.connect` | Ajoute un repo distant | `url` · `name` |
| `repo.sync` | Télécharge & intègre un profil distant | `url` · `profile` |
| `repo.gen` | Ouvre la génération de repo | — |
| `repo.update` | Met à jour un repo exporté | `dir` |
| `repo.host` | Sert un repo en HTTP | `dir` · `port` |
| `repo.manifest` | Lit le dossier, réécrit repo.json, et rapporte ce qui a changé. Se combine avec Publier par SSH à l'étape suivante. | `dir` · `name` · `author` |
| `repo.publishSsh` | Envoie le dossier exporté vers la cible SSH enregistrée dans Server Repo | `dir` · `target` · `into` |
| `repo.fetchSsh` | Récupère le dépôt depuis la cible SSH enregistrée, dans un dossier local | `dir` · `target` · `into` |
| `repo.syncNow` | Synchronise un dépôt serveur dans un profil local, sans surveillance. | `url` · `gameDir` · `modsDir` · `password` · `repoProfile` · `backupDir` · `targetProfile` · `overwriteAll` · `deleteExtra` · `downloadLimit` · `keepZipped` · `into` |
| `key.create` | Génère une paire de clés sur le trousseau. Un nom déjà pris est laissé tel quel, jamais remplacé. | `name` · `kind` · `bindUrl` |
| `catalog.follow` | Ajoute une source de catalogue via les écrans de l'app, pour qu'elle apparaisse dans la liste des suivis avec son origine. | `catType` · `url` · `unfollow` |

### Apps & lancement

| Action | Ce qu'elle fait | Paramètres |
|---|---|---|
| `app.launch` | Lance une app du catalogue | `id` · `exePath` |
| `app.stop` | Arrête un programme en cours, par nom ou par identifiant de processus. Nécessite la permission « Arrêter des programmes ». | `name` · `pid` · `into` |
| `file.open` | Ouvre ou lance un fichier / .exe | `path` |
| `folder.open` | Ouvre un dossier dans l'explorateur | `path` |
| `app.install` | Installe une app depuis une URL | `id` · `url` · `title` |
| `launchpack.run` | Lance un launch pack enregistré | `id` |
| `game.watch` | DCS reçoit un hook ; tous les autres jeux se résument au log à surveiller, transmis aux étapes suivantes. | `game` · `mode` · `dir` · `path` |

### Apparence

| Action | Ce qu'elle fait | Paramètres |
|---|---|---|
| `theme.set` | Change le thème actif | `id` |

### Benchmarks & stockage

| Action | Ce qu'elle fait | Paramètres |
|---|---|---|
| `benchmark.run` | Lance un benchmark de stockage | `dataset` · `size` · `customMb` · `sources` |
| `storage.diskBenchmark` | Benchmark lecture/écriture d'un disque | `mountPoint` |
| `storage.applyLimit` | Limite la vitesse I/O d'un disque | `mountPoint` · `limitMbS` |
| `storage.calibration` | Active la calibration auto | `enabled` |
| `storage.smartIo` | Active/désactive Smart I/O | `enabled` |
| `storage.flag` | Bascule un réglage avancé | `key` · `enabled` |
| `perf.diskSpace` | Lit l’espace libre et l’enregistre, pour qu’une condition puisse s’en servir. | `mountPoint` |

### Confidentialité & enregistreur

| Action | Ce qu'elle fait | Paramètres |
|---|---|---|
| `telemetry.consent` | Active/désactive le consentement | `enabled` |
| `telemetry.set` | Règle les options de télémétrie | `replay` · `full` · `bench` |
| `recorder.set` | Configure l'enregistreur de session | `on` · `full` · `rust` · `js` |
| `replay.export` | Exporte la session en cours | — |
| `replay.import` | Importe & lit un replay | `path` · `url` |

### Logique & maths

| Action | Ce qu'elle fait | Paramètres |
|---|---|---|
| `var.set` | Stocke une valeur (conditions/boucles) | `name` · `value` · `scope` |
| `math.set` | Calcule une expression dans une variable | `target` · `expr` |
| `var.ternary` | Définit une variable selon une condition (a si vrai, sinon b) | `condition` · `target` · `ifTrue` · `ifFalse` |
| `rule.table` | Associe une variable à un résultat via une table de décision | `source` · `target` · `rows` |
| `task.stop` | Arrête toute la tâche maintenant (dans un IF = garde) | `reason` |
| `code.run` | Exécute un extrait BMMScript dans cette tâche — mêmes variables, mêmes permissions. | `code` |
| `list.set` | Remplace toute la liste. Accepte un tableau JSON ou une simple ligne a, b, c. Relisez-la via {list.<nom>.length}, ou parcourez-la avec FOR EACH. | `name` · `value` · `sep` |
| `list.push` | Ajoute un élément à la fin. Contrairement à « la définir », exécuter deux fois ajoute deux fois. | `name` · `value` |
| `list.clear` | Vide la liste sans supprimer son nom : un ajout ultérieur repart de zéro. | `name` |
| `map.set` | Enregistre une valeur sous une clé. Une liste répond « lesquels » ; une table répond « quoi va avec quoi ». | `name` · `key` · `value` |
| `map.get` | Lit une clé dans une variable que vous nommez. Une clé absente enregistre une valeur vide — testez {map.hit} pour distinguer « absente » de « présente et vide ». | `name` · `key` · `into` |
| `map.clear` | Vide la table sans supprimer son nom. | `name` |
| `var.clear` | Retire une variable partagée, ou toutes. Les valeurs d’une exécution disparaissent avec elle de toute façon. | `name` |
| `text.extract` | Applique un motif aux derniers Ko d'un fichier, ou à une variable, et garde ce qu'il a trouvé. | `target` · `path` · `tailKb` · `source` · `regex` · `group` |
| `log.print` | Met une ligne dans le panneau d'exécution et dans le run.log de la tâche. En code, c'est `print "…"`. | `message` · `text` |
| `data.validate` | Détermine ce qu'un document EST d'après sa forme, et ce qui ne va pas dedans. À utiliser avant d'agir sur quelque chose de téléchargé. | `path` · `text` · `expect` · `strict` |
| `file.write` | Écrit ou ajoute du texte dans un fichier. Un chemin relatif atterrit dans le dossier de sortie de la tâche. | `path` · `text` · `append` |

### Système & flux

| Action | Ce qu'elle fait | Paramètres |
|---|---|---|
| `notify` | Affiche une notification | `message` |
| `discord.rpc` | Bascule la présence Discord | `enabled` |
| `data.exportAuto` | Sauvegarde automatique des données | `dir` · `name` · `increment` |
| `data.backup` | La même archive que l'écran Export de données — les sections que tu choisis, verrouillée si tu donnes une phrase. | `dir` · `sections` · `passphrase` · `name` · `increment` |
| `app.checkUpdate` | Vérifie s’il existe une mise à jour de BMM. Renseigne update.available ; ne télécharge rien. | `enabled` |
| `system.clearApiLog` | Vide le journal des requêtes API. | — |
| `system.clearResourceRecords` | Vide les relevés CPU/mémoire enregistrés. | — |
| `task.run` | Déclenche une autre tâche | `id` |
| `task.spawn` | Lance l’autre tâche et continue immédiatement. À utiliser quand la suite ne dépend pas du résultat — sinon prenez « Exécuter une autre tâche », qui attend. | `id` |
| `restart` | Redémarre BMM | — |
| `open.url` | Ouvre une URL ou un lien | `url` |
| `custom.command` | Lance un programme avec arguments | `args` · `program` · `workingDir` · `into` |
| `custom.script` | Exécute du PowerShell, CMD, Bash ou Python que vous écrivez. Exige « Exécuter des scripts ». | `keepGoing` · `engine` · `code` · `workingDir` · `into` |
| `folder.create` | Crée un dossier dans le dossier de données de BMM. Il ne peut pas en sortir. | `path` · `into` |
| `catalog.create` | Écrit un catalog.json dans un dossier, avec les fichiers qu’il référence. Tutoriels et plugins sont liés ; les thèmes sont intégrés. | `dir` · `kind` · `name` · `base` · `bundle` · `bundleOut` |
| `deeplink` | Déclenche n'importe quel deep link bmm:// | `url` |
| `http.request` | Envoie une requête à n’importe quelle adresse et capture la réponse. Exige « Exécuter des programmes externes ». | `url` · `headers` · `method` · `body` · `timeoutMs` · `jsonPath` · `allowAnyStatus` · `into` |
| `wait.http` | L'interroge jusqu'à ce qu'elle réponde, ou abandonne et le dit. | `url` · `everySeconds` · `timeoutSeconds` · `status` · `stopOnTimeout` |
| `wait.hook` | Dort jusqu'à ce que quelque chose poste sur /api/hook avec ce nom. | `name` · `everySeconds` · `timeoutSeconds` · `stopOnTimeout` |
| `import.file` | Prend un fichier ou une adresse et le lit dans le format BMM qui est le sien. | `path` · `url` · `password` · `kind` · `passphrase` · `apply` · `install` · `exact` · `catType` · `restore` · `sections` |

## Conditions

S'écrivent là où une condition va — après `if`, `case`, `waitfor`, `repeat while` et `repeat until`. `and` / `or` les combinent, `not` en inverse une, les parenthèses groupent.

| Condition | Ce qu'elle teste |
|---|---|
| `always` | Toujours |
| `all` | Toutes (ET) |
| `any` | Au moins une (OU) |
| `value` | Comparer une valeur (si X > Y …) |
| `textIs` | Une variable texte… |
| `fileContains` | Un fichier contient… |
| `enumIs` | la variable vaut un membre d’enum |
| `profileActive` | Profil actif |
| `modEnabled` | Mod activé |
| `modDisabled` | Mod désactivé |
| `modWins` | Le mod gagne ses fichiers partagés |
| `fileIsValid` | Le fichier est un document BMM valide |
| `modpackActive` | Modpack actif |
| `modpackInactive` | Modpack inactif |
| `allModsActive` | Tous les mods du profil actif sont activés |
| `appRunning` | L’app est lancée |
| `appNotRunning` | L’app n’est PAS lancée |
| `fileExists` | Le fichier/dossier existe |
| `pathIsDir` | Fichier ou dossier |
| `fileHash` | Hash du fichier égal à |
| `filesMatch` | Chaque fichier correspond encore à sa somme de contrôle |
| `fileSize` | Taille du fichier |
| `fileType` | Type de fichier (extension) |
| `fileName` | Nom du fichier contient |
| `fileNewer` | Fichier modifié récemment |
| `online` | Internet est disponible |
| `catalogOk` | Un catalogue répond |
| `repoOk` | Un dépôt répond |
| `timeReached` | Heure atteinte |
| `dayOfWeek` | Jour de la semaine |
| `timeRange` | Heure comprise dans |
| `commandSucceeds` | La commande réussit |

`all` et `any` sont les conditions de groupe ; en script on écrit normalement `and` et `or` à la place, pour le même résultat. `value` est la ligne de comparaison — c'est ce que `count >= 3` produit.

## Valeurs lisibles

Écrites dans la tâche par une action, puis lisibles dans une comparaison ou une expression — `if disk.free_gb < 5`, `set total = benchmark.mbps * 2`.

`disk.read_mbps` · `disk.write_mbps` · `disk.suggested_limit` · `disk.free_gb` · `disk.free_percent` · `disk.total_gb` · `benchmark.mbps` · `benchmark.total_ms` · `update.available` · `lasttask.ok` · `lasttask.spawned` · `list.length` · `backup.bytes` · `order.moved` · `valid.ok` · `valid.matched` · `valid.count` · `wait.ok` · `wait.tries` · `script.code` · `script.ok` · `import.count` · `catalog.entries` · `ssh.files` · `manifest.mods` · `manifest.added` · `manifest.removed` · `manifest.changed` · `http.status` · `map.size` · `map.hit`

Une valeur que rien n'a encore écrite vaut zéro. `lasttask.ok` vaut 1 ou 0, et ne veut dire quelque chose qu'après un `run`.

## Ce qu'une boucle peut parcourir

S'écrit `for item in <source>`. Dans la boucle, `{item.id}` et `{item.name}` sont remplacés dans toutes les valeurs texte.

`enabledMods` · `disabledMods` · `mods` · `profiles` · `modpacks` · `themes` · `list` · `mapKeys`

`list` et `mapKeys` demandent un nom : `for x in list "queue"`.

## Instructions

La grammaire elle-même qui, contrairement à tout ce qui précède, est fixe. L'explication complète de chacune est sur la [page principale BMMScript](doc-page:features/bmmscript.fr).

| | |
|---|---|
| `do <action>(k: v)` | Faire une action |
| `if <cond> { } else { }` | Brancher |
| `for x in <source> { }` | Boucler sur une liste |
| `repeat N times { }` | Boucler un nombre de fois |
| `repeat while|until <cond> { }` | Boucler jusqu'à ce que ça change |
| `wait 30s` | Attendre |
| `waitfor <cond> timeout 2h poll 10s` | Attendre qu'une condition devienne vraie |
| `try { } catch { }` | Continuer si une étape échoue |
| `switch { case <cond> { } default { } }` | Le premier cas vrai, et lui seul |
| `parallel { branch { } branch { } }` | Lancer des branches en même temps |
| `parallel settle { … }` | Laisser tout finir, puis dire ce qui a échoué |
| `set x = <expr>` | Un nombre, via l'évaluateur d'expressions |
| `set s = "text"` | Une variable texte |
| `set n: number = 0` | Typé, vérifié à l'écriture |
| `shared set k = "v"` | Une variable que toutes les tâches lisent |
| `clear x` | Supprimer une variable |
| `call "block name"` | Exécuter un bloc partagé ici |
| `run "Task" · spawn "Task"` | Une autre tâche, en attendant ou non |
| `script python { … }` | Du vrai code, pris tel quel |
| `break · continue · stop` | Quitter la boucle, passer, finir la tâche |

## Pourquoi cette page est générée

BMMScript ne contient aucune liste de noms d'actions : il compile vers les blocs, donc une action ajoutée à BMM est écrivable en script le jour même. Cela fait d'une référence écrite à la main la seule partie du langage qui puisse devenir fausse — elle continuerait d'annoncer l'ancien nombre pendant que l'application grandit. Cette page est extraite des mêmes tableaux que l'éditeur de blocs, et la CI échoue si elle n'est plus à jour.
