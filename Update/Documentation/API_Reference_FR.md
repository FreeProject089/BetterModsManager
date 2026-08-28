# Better Mod Manager — Référence API & Deeplink (FR)

> URL de base de l'API HTTP locale : `http://127.0.0.1:51274`
> Auth : la plupart des endpoints exigent l'en-tête `Authorization: Bearer <TOKEN_API>` (le token est affiché dans **Plugins & API → Token API**).
> Portée plugin : l'identité de l'appelant vient du JETON, jamais de l'en-tête `X-BMM-Plugin-Id`. Le jeton admin a l'accès complet ; un jeton de plugin est vérifié contre les permissions accordées à ce plugin (voir **Permissions**). Omettre ou falsifier l'en-tête ne change rien — c'est ce qui empêche un plugin de s'élever en le retirant.

Ce document est la source de vérité unique pour tout ce qui est pilotable par programme. Objectif : **tout ce que vous pouvez faire à la main dans BMM peut se faire via l'API / les deeplinks sans intervention humaine** (là où un dialogue de fichier natif est normalement nécessaire, un champ optionnel `path` / `destDir` permet de le contourner).

---

## Conventions

- Les endpoints **UI-driven** renvoient `202 Accepted` et pilotent l'interface BMM (ils émettent un événement `bmm://api-exec` auquel le frontend réagit). Ils se comportent exactement comme si un humain les avait déclenchés. Quand un fichier/dossier est requis, passez un `path`/`destDir` explicite pour tourner sans surveillance ; omettez-le pour ouvrir le sélecteur natif.
- Les endpoints **directs** s'exécutent de façon synchrone et renvoient `200 OK` avec un résultat JSON.
- Tous les corps sont en JSON. Les noms de champs sont en `snake_case` sauf indication ; les alias camelCase sont acceptés sur les endpoints app/catalog.

---

## Endpoints GET

| Chemin | Auth | Description | Retourne |
|---|---|---|---|
| `/api/health` | non | Sonde de disponibilité | `{ ok, service, port }` |
| `/api/status` | non | Quelle build, profil actif, compteurs | `{ ok, version, channel, built, os, arch, active_profile, mod_count, profile_count, plugin_count }` — `channel` vaut `Release`, `PTB` ou `FTB` ; `built` est la date de fabrication du binaire |
| `/api/check-update` | non | Compare la version en cours à la dernière release GitHub | `{ ok, has_update, current_version, latest_version, release_url }` |
| `/api/mods` | non | Tous les mods du profil actif | `{ ok, data:[{id,name,active,enabled,path}] }` |
| `/api/mods/active` | non | Uniquement les mods activés du profil actif | `{ ok, data:[…] }` |
| `/api/mods/all` | non | **Tous les mods de TOUS les profils**, groupés par profil + total | `{ ok, total_mods, profiles:[{profile_id,profile_name,mod_count,mods:[…]}] }` |
| `/api/modpacks` | non | Tous les modpacks (objets complets) | `{ ok, data:[{id,name,description,mods:[…],multi_profile,dependency_mode,…}] }` (nombre de mods = `mods.length`) |
| `/api/profiles` | non | Tous les profils (résumé, sans liste de mods) | `{ ok, data:[{id,name,game,active}] }` |
| `/api/plugins` | non | Plugins installés | `{ ok, data:[…] }` |
| `/api/creator-id` | non | Votre creator ID (clé publique) | `{ ok, creator_id }` |
| `/api/data` | oui | **Export complet des données BMM** (`data.json`) — profils, mods, modpacks, plugins, réglages, tags… | fichier JSON (`bmm-data.json`) |
| `/api/repo/info?url=` | non | Métadonnées d'un repo distant. `&password=` optionnel pour un dépôt auto-hébergé protégé (envoyé en `X-Repo-Password` ; absent/faux → 401) | résumé du manifeste repo |
| `/api/repo/list` | non | Repos connectés | `{ ok, data:[{url,name,…}] }` |
| `/api/apps` | oui · `app.read` | Apps installées du Catalogue + stats d'usage | `{ installed:{ id:{…} } }` |
| `/api/catalog` | oui · `catalog.read` | `apps-catalog.json` local | objet catalogue |
| `/api/language/template` | non | Télécharge `lang-template.json` (toutes les clés i18n → valeurs anglaises) | fichier JSON (`Content-Disposition: attachment`) |
| `/api/apps/permissions` | oui | Carte `plugin_id → [permissions]` | objet |
| `/api/apps/permissions/:id` | oui | Permissions d'un plugin | `{ plugin_id, permissions:[…] }` |

---

## Endpoints POST

### Mods
| Chemin | Auth · Perm | Corps |
|---|---|---|
| `/api/mods/enable` | oui · `mods.write` | `{ mod_id }` |
| `/api/mods/disable` | oui · `mods.write` | `{ mod_id }` |
| `/api/mods/order` | oui · `mods.read` | — (GET) l'ordre de déploiement, chaque fichier disputé et qui le gagne |
| `/api/mods/order` | oui · `mods.write` | `{ order[], profileId? }` — permutation obligatoire ; le dernier gagne un fichier partagé |
| `/api/schedules` | oui | — (GET) id, nom, activée, déclencheur. **Pas** les étapes |
| `/api/schedules/enabled` | oui | `{ id, enabled }` — seul `enabled` est modifiable |
| `/api/hook` | oui | `{ name, data? }` — sonne une clochette ; `GET ?name=` lit sans consommer |
| `/api/content-id` | oui | `{ kind, doc }` — l'id qui dit ce qu'un document EST plutôt que le nom que cette machine lui donne. `kind` vaut modpack, plugin, task, profile, theme, launchpack, repo, app ou modlist. Il prend le DOCUMENT, donc la réponse ne révèle rien de ce que cette installation contient ; une variante par id serait un oracle « cette machine a-t-elle X » et exigerait la portée de lecture de chaque type. |
| `/api/keys` | oui · `keys.write` | `{ name, algorithm? }` — GET liste, POST crée ; la moitié privée ne sort jamais |
| `/api/catalogs` | oui · `catalog.write` | `{ type, url, follow }` — GET liste, POST (dés)abonne |
| `/api/plugins/assets` | oui · `plugins.read` | — (GET `?id=&path=`) ce qu'un plugin livre, ou le texte d'un fichier |
| `/api/repo/extras` | oui · `repo.write` | `{ url, kind, name }` — l'entrée est cherchée dans le manifeste, jamais décrite par l'appelant |
| `/api/repo/modpacks` | oui · `repo.read` / `repo.write` | `GET ?dir=` — quels modpacks un dossier de repo sur cette machine partage. `POST { dir, shares[] }` définit toute la liste et re-signe le manifeste ; omettre `shares` lit au lieu d'écrire, parce que « dis-moi » et « n'en partage aucun » sont deux requêtes différentes. |
| `/api/repo/publish-ssh` | oui | `{ dir? }` — **téléverse immédiatement** vers le serveur SSH déjà enregistré dans l'app, et répond quand le transfert est fini. Ne porte ni hôte ni chemin de clé — un appelant capable de les nommer pourrait faire lire à BMM une clé privée de son choix et expédier un dépôt vers une machine de son choix. Une cible enregistrée réclamant une phrase secrète tapée est refusée : il n'y a personne pour la taper. |
| `/api/repo/fetch-ssh` | oui | `{ dir? }` — pareil, pour la récupération |
| `/api/view` | oui | `{ id }` — bascule l'app sur un écran |

### Profils
| Chemin | Auth · Perm | Corps |
|---|---|---|
| `/api/profiles` | oui · `profiles.write` | `{ name, game_path, mods_path, backup_path, game_name?, color?, icon? }` |
| `/api/profiles/activate` | oui · `profiles.write` | `{ profile_id }` |
| `/api/profiles/import/ovgme` | oui | *(UI-driven, scanne %PROGRAMDATA%/OvGME)* |
| `/api/profiles/import/omm` | oui | *(UI-driven, sélecteur `.omm/.omx`)* |

### Plugins
| Chemin | Auth · Perm | Corps |
|---|---|---|
| `/api/plugins/apply` | oui · `plugins.write` | `{ plugin_id, force_strict? }` |
| `/api/plugins/compare` | oui · `plugins.read` | `{ plugin_id }` |
| `/api/plugins/import` | oui | UI-driven — sélecteur (`.bmmplug`) |
| `/api/plugins/export` | oui | `{ id }` — dialogue d'enregistrement |

### Modpacks
| Chemin | Auth · Perm | Corps |
|---|---|---|
| `/api/modpacks/create` | oui · `modpacks.write` | `{ name, mod_ids?, source_profile_id?, description?, game_name?, sr_link?, multi_profile?, skip_integrity_check?, dependency_mode?, mod_overrides? }` |
| `/api/modpacks/enable` | oui · `modpacks.write` | `{ modpack_id }` |
| `/api/modpacks/disable` | oui · `modpacks.write` | `{ modpack_id }` |
| `/api/modpacks/import` | oui | `{ path? }` — chemin = import direct, sinon sélecteur |
| `/api/modpacks/export` | oui | `{ id, destDir? }` — `destDir` exporte direct dans ce dossier (sans dialogue) |

### Server Repo
| Chemin | Auth · Perm | Corps |
|---|---|---|
| `/api/repo/connect` | oui · `repo.write` | `{ url, name?, password? }` |
| `/api/repo/update-now` | oui · `repo.write` | `{ repoDir, authorName?, ops? }` — **réécrit le dépôt** et resigne son manifeste au lieu d’ouvrir la modale. `ops` = `{ removeModIds[], removeProfileIds[], addProfiles[], modChangelogs{} }`, tout facultatif |
| `/api/repo/host-now` | oui · `repo.write` | `{ path, port, uploadLimit?, downloadPassword?, authorizedKeys[]? }` — **démarre le service**. Aussi le seul moyen d’héberger un dépôt protégé par l’API |
| `/api/repo/gen-now` | oui · `repo.write` | `{ outputDir, authorName, profileIds[], seed?, zipOutput?, zipMods? }` — **écrit le dépôt** au lieu d’ouvrir l’écran. Une liste de profils vide est refusée, jamais « tous » |
| `/api/repo/sync-now` | oui · `repo.write` | `{ url, repoProfile, targetProfile, gameDir, modsDir, backupDir?, password?, overwriteAll?, deleteExtra? }` — **exécute la synchro** au lieu d'ouvrir le formulaire. Les cinq premiers champs sont obligatoires ; aucun profil n'est créé ; les deux options destructrices sont à off par défaut |
| `/api/repo/sync` | oui · `repo.write` | `{ url, game_dir?, mods_dir?, backup_dir?, choices?, download_limit?, password? }` (UI-driven ; `password` = mot de passe de téléchargement optionnel d'un dépôt protégé). **`creator_id` n'est pas accepté** — c'est l'identité de cette installation face à un dépôt, pas un choix de l'appelant |
| `/api/repo/gen` | oui · `repo.write` | `{ profileIds[], outputDir, authorName, … }` (UI-driven) |
| `/api/repo/update` | oui | `{ repoDir }` — ouvre le modal de mise à jour incrémentale pré-rempli |
| `/api/repo/host` | oui · `repo.write` | `{ serveDir, port?, uploadLimit? }` |

### Catalogue d'apps
| Chemin | Auth · Perm | Corps |
|---|---|---|
| `/api/apps/install` | oui · `app.write` | `{ appId, appTitle, downloadUrl, fileType, installPath, version?, category?, thumb? }` — `installPath` est requis ; `fileType` ∈ `exe·zip·msi·script` |
| `/api/apps/launch` | oui · `app.write` | `{ appId, exePath }` |
| `/api/catalog/new` | oui · `catalog.write` | `{ name?, description?, partner_catalogs?, community_imports?, apps? }` |
| `/api/catalog/apps` | oui · `catalog.write` | `{ id, title, description?, category?, price?, tags?, download:{url,file_type,size?}, requirements?, md_link?, images?, official?, partner? }` |
| `/api/catalog/entries` | oui · `catalog.write` | `{ type?, entry }` — `type` ∈ `app`·`plugin`·`theme`·`preset`·`modpack`·`repo`·`tutorial`·`list` (`app` par défaut) ; l’entrée est écrite sous le nom de tableau du format de ce type. Elle doit porter un `id` : la mise à jour et la suppression s’y réfèrent |

### Données / Langue / Listes de mods
| Chemin | Auth | Corps |
|---|---|---|
| `/api/data/export` | oui | UI-driven (toutes les données → JSON) |
| `/api/data/import` | oui | UI-driven, sélecteur |
| `/api/modlists/export` | oui | UI-driven (`.mmlist`) |
| `/api/modlists/import` | oui | UI-driven, sélecteur |
| `/api/language/import` | oui | `{ path? }` — chemin = import direct, sinon sélecteur ; le nom de fichier → code langue |
| `/api/restart` | oui | `{}` — redémarrage propre |

### Benchmark
| Chemin | Auth | Corps |
|---|---|---|
| `/api/benchmark` | oui | `{ dataset?: "sandbox"\|"real", size?: "S"\|"M"\|"L"\|"XL"\|"CUSTOM", mb?, mode?: "manual"\|"auto", sources?: string[] (dossiers, absolus ou relatifs au dossier de travail de BMM), profiles?: string[] (ids/noms → leur dossier de mods) }`. **auto** lance en arrière-plan et renvoie le rapport ; **manual** ouvre l'UI pré-remplie. Toute `sources`/`profiles` ⇒ exécution « real ». |

### Télémétrie & enregistreur local
| Chemin | Auth | Corps |
|---|---|---|
| `/api/telemetry/consent` | oui | `{ enabled: bool }` — bascule « Partager des données d'usage anonymes » |
| `/api/telemetry/settings` | oui | `{ replay?, full?, bench? }` — sous-options télémétrie (omis = inchangé) |
| `/api/recorder` | oui | `{ on?, full?, rust?, js? }` — configure l'enregistreur de session local |
| `/api/replay/export` | oui | `{}` — exporte la session locale courante en `.bmmreplay` |
| `/api/replay/import` | oui | `{ path? , url? }` — importe + rejoue un `.bmmreplay` (chemin ou URL) |

### Automatisation
| Chemin | Auth | Corps |
|---|---|---|
| `/api/mod/check-updates` | oui | `{}` — vérifie les mises à jour de chaque mod lié |
| `/api/mod/update` | oui | `{ repoUrl? }` — récupère les mises à jour des mods liés à ce dépôt ; sans `repoUrl`, couvre toutes les sources liées |
| `/api/mod/config` | `mods.write` | `{ modId, repoModId?, updateUrl?, updateSources?, directUrl? }` — définit où un mod vérifie ses propres mises à jour |
| `/api/repo/manifest` | `repo.write` | `{ modsDir, outputPath?, name?, author?, gameName?, filesBaseUrl?, filesLayout?, reuseExisting?, only? }` — écrit un `repo.json` pour un dossier déjà hébergé. Ne copie rien et n'exige aucun profil ; synchrone, donc un script de publication peut agir sur le diff renvoyé. `reuseExisting` vaut **true** par défaut : réexécuter produit une nouvelle révision du MÊME dépôt, pas un dépôt différent |
| `/api/discord/rpc` | oui | `{ enabled: bool }` — active/désactive Discord Rich Presence |
| `/api/data/export-auto` | oui | `{ dir, name? (modèle : `{date}` `{time}` `{datetime}`), increment?: "paren"\|"underscore"\|"timestamp"\|"overwrite" }` — sauvegarde automatique, renvoie le chemin écrit |
| `/api/launchpack/run` | oui | `{ id }` — lance un launch pack enregistré |
| `/api/schedule/run` | oui | `{ id }` — déclenche une tâche Scheduling & automation |

---

## Endpoints PUT

| Chemin | Auth · Perm | Corps |
|---|---|---|
| `/api/mods/:id` | oui · `mods.write` | `{ name?, version?, author?, description? }` |
| `/api/profiles/:id` | oui · `profiles.write` | `{ name?, game_name?, color?, icon?, game_path?, mods_path?, backup_path? }` |
| `/api/modpacks/:id` | oui · `modpacks.write` | `{ name?, description?, game_name?, sr_link?, mod_ids?, multi_profile?, skip_integrity_check?, dependency_mode?, mod_overrides? }` |
| `/api/catalog/apps/:id` | oui · `catalog.write` | Champs catalogue à modifier (seuls les champs envoyés changent) |
| `/api/catalog/entries/:id` | oui · `catalog.write` | `{ type?, …champs }` — fusionnés dans l’entrée portant cet id. `type` choisit le catalogue et n’est jamais écrit dans l’entrée |
| `/api/apps/permissions/:id` | oui | `{ permissions:[…] }` — remplace toute la liste de permissions du plugin |

---

## Endpoints DELETE

| Chemin | Auth · Perm | Corps |
|---|---|---|
| `/api/repo/sync/cancel` | oui | — annule la sync en cours |
| `/api/repo/gen/cancel` | oui | — annule la gen en cours |
| `/api/repo/host` | oui · `repo.write` | — arrête le host HTTP |
| `/api/repo` | oui · `repo.write` | `{ url }` — déconnecte un repo |
| `/api/mods/:id` | oui · `mods.write` | retire un mod (fichiers conservés) |
| `/api/profiles/:id` | oui · `profiles.write` | supprime un profil |
| `/api/modpacks/:id` | oui · `modpacks.write` | supprime un modpack |
| `/api/apps/:id` | oui · `app.write` | désinstalle une app du registre (fichiers conservés) |
| `/api/catalog/apps/:id` | oui · `catalog.write` | retire une app du catalogue local |
| `/api/catalog/entries/:id` | oui · `catalog.write` | requête `type` · retire une entrée de n'importe quel catalogue écrit. `404` s'il n'y en a pas, plutôt qu'annoncer une suppression qui n'a pas eu lieu |
| `/api/catalog` | oui · `catalog.write` | requête `type` · supprime tout le catalogue écrit de ce type. `404` s'il n'y en a jamais eu. Ne touche PAS ce que tu suis — ça, c'est `/api/catalogs` |

---

## Deeplinks (`bmm://`)

Les deeplinks sont des URL cliquables (pages web, Discord, scripts) qui pilotent BMM quand il tourne.

| Deeplink | Endpoint équivalent |
|---|---|
| `bmm://mod/enable?id=<mod_id>` | `POST /api/mods/enable` |
| `bmm://mod/disable?id=<mod_id>` | `POST /api/mods/disable` |
| `bmm://profile/activate?id=<profile_id>` | `POST /api/profiles/activate` |
| `bmm://plugin/activate?id=<plugin_id>` | `POST /api/plugins/apply` |
| `bmm://plugin/compare?id=<plugin_id>` | `POST /api/plugins/compare` |
| `bmm://modpack/enable?id=<id>` | `POST /api/modpacks/enable` |
| `bmm://modpack/disable?id=<id>` | `POST /api/modpacks/disable` |
| `bmm://repo/connect?url=<url>&password=<pw>` | `POST /api/repo/connect` |
| `bmm://repo/sync?url=<url>&profile=<repo_profile_id>[&password=<pw>]` | `POST /api/repo/sync` |
| `bmm://repo/gen` | ouvre la section Gen (sélection de profils requise) |
| `bmm://repo/update?dir=<repoDir>` | ouvre le modal de mise à jour incrémentale |
| `bmm://repo/host?dir=<serveDir>&port=<port>` | ouvre la section host HTTP |
| `bmm://app/install?id=<id>&url=<url>&type=<exe\|zip\|msi\|script>&title=<title>&path=<dir>` | `install_app` |
| `bmm://app/launch?id=<id>&exe=<exePath>` | `launch_app` |
| `bmm://modpack/create?name=<name>&profile=<profile_id>` | `POST /api/modpacks/create` |
| `bmm://language/import?path=<file>` | `import_language` (omettre `path` → sélecteur) |
| `bmm://benchmark/run?dataset=<sandbox\|real>&size=<S\|M\|L\|XL\|CUSTOM>&mb=<mb>&mode=<manual\|auto>&profiles=<id1;id2>&sources=<path1;path2>` | `POST /api/benchmark` (chemins relatifs OK ; profiles → dossiers de mods) |
| `bmm://mod/check-updates` | `POST /api/mod/check-updates` |
| `bmm://telemetry/consent?enabled=<1\|0>` | `POST /api/telemetry/consent` |
| `bmm://telemetry/set?replay=<1\|0>&full=<1\|0>&bench=<1\|0>` | `POST /api/telemetry/settings` |
| `bmm://recorder/set?on=<1\|0>&full=<1\|0>&rust=<1\|0>&js=<1\|0>` | `POST /api/recorder` |
| `bmm://replay/export` | `POST /api/replay/export` |
| `bmm://replay/import?path=<file>` · `?url=<downloadUrl>` | `POST /api/replay/import` |
| `bmm://discord/rpc?enabled=<1\|0>` | `POST /api/discord/rpc` |
| `bmm://data/export-auto?dir=<dossier>&name=<modèle>&increment=<paren\|underscore\|timestamp\|overwrite>` | `POST /api/data/export-auto` |
| `bmm://launchpack/run?id=<launchpack_id>` | `POST /api/launchpack/run` |
| `bmm://schedule/run?id=<task_id>` | `POST /api/schedule/run` |
| `bmm://mod/update?url=<repo_url>` | ouvre Dépôt → mises à jour de mods (avec `url`, pré-remplit la connexion ; sans, lance la vérification des mises à jour) |
| `bmm://plugin/delete?id=<plugin_id>` | `DELETE /api/plugins/:id` (désinstalle un plugin) |
| `bmm://catalog/<app\|plugin\|theme>/install?url=<download_url>&name=<label>&type=<exe\|zip\|msi\|script>` | installe en un clic un élément du catalogue BetterCommunity (`type` s'applique à `app` ; sans `url`, ouvre simplement la vue correspondante) |
| `bmm://catalog/<app\|plugin\|theme>/add-source?url=<catalog_url>` | s'abonner à un catalogue communautaire app/plugin/thème (demande confirmation) |
| `bmm://theme/apply?id=<theme_id>` | active un thème installé |
| `bmm://theme/import?url=<theme_json_url>` | importe + installe un thème depuis une URL JSON |
| `bmm://theme/editor` | ouvre l'éditeur de thèmes |
| `bmm://settings/layout?code=<code>` | applique un code de disposition des cartes Paramètres partagé |
| `bmm://settings/navbar?code=<code>` | applique un code de disposition de barre de navigation partagé |
| `bmm://restart` | redémarre BMM |
| `bmm://install?url=<mod_url>` (alias : `import`, `download`) | installation de mod en 1 clic |
| `bmm://api?method=<M>&path=<chemin_api>&<champ>=<valeur>…` | **passe-partout — atteint N'IMPORTE QUEL endpoint.** Les params deviennent le corps JSON (POST/PUT) ou la query string (GET/DELETE). Ex : `bmm://api?method=POST&path=/api/mods/enable&mod_id=abc` |

> Les deeplinks respectent le toggle global « Autoriser les deep links » dans **Plugins & API → Permissions**.

---

## Permissions

Les permissions qui s'appliquent sont décidées par le jeton que porte la requête. Accordées via `PUT /api/apps/permissions/:id`, qui exige le jeton **admin**.

| Permission | Autorise |
|---|---|
| `app.read` | lister les applications installées et leurs permissions |
| `app.write` | installer, lancer et retirer des applications |
| `catalog.read` | lire le catalogue d'applications local |
| `catalog.write` | créer, modifier et supprimer des entrées du catalogue |
| `data.read` | lire TOUT ce que BMM contient (`GET /api/data`) et l'exporter dans un fichier |
| `data.write` | importer des données par-dessus les vôtres |
| `hooks.read` | voir quels hooks ont sonné |
| `hooks.write` | sonner un hook qu'une automatisation attend peut-être |
| `keys.read` | voir quelles clés d'identité existent |
| `keys.write` | créer une clé d'identité — ce qui prouve que vous êtes vous auprès de chaque source protégée |
| `modpacks.read` | lister et exporter les modpacks |
| `modpacks.write` | créer, modifier, appliquer et supprimer les modpacks |
| `mods.read` | lister les mods, et voir lequel gagne un fichier partagé |
| `mods.write` | activer, désactiver, mettre à jour, supprimer et réordonner les mods |
| `plugins.read` | lister les plugins, comparer une modlist, lire les fichiers livrés |
| `plugins.write` | installer, appliquer et SUPPRIMER des plugins — y compris d'autres |
| `profiles.read` | lister les profils |
| `profiles.write` | créer, modifier, supprimer et activer des profils |
| `repo.read` | voir quels repos sont connectés et ce qu'ils contiennent |
| `repo.write` | connecter, synchroniser, publier et héberger des repos |
| `schedules.read` | lister les automatisations enregistrées |
| `schedules.write` | exécuter une automatisation, l'armer ou la désarmer |
| `system.write` | redémarrer BMM, changer l'écran ouvert, lancer un benchmark, importer une langue |
| `telemetry.write` | changer ce qui est enregistré et ce qui est envoyé |

> La liste vit dans le code sous le nom `api::PLUGIN_SCOPES`, et un test vérifie qu'elle correspond au routeur dans les deux sens — une portée exigée que rien ne peut accorder est une route inatteignable, et une portée qui ne protège aucune route est une case à cocher qui promet une protection inexistante. Ce sont exactement les cases de **Plugins & API → Permissions**.

> **Les lectures sont protégées.** Elles ne l'étaient pas : cinquante routes demandaient un jeton et aucune permission, et un jeton de plugin est un jeton valide — donc `GET /api/data`, `POST /api/data/import`, `POST /api/restart` et `DELETE /api/plugins/<id>` étaient atteignables par un plugin sans aucune permission. À la mise à jour, chaque plugin conserve la moitié lecture de chaque domaine sur lequel il avait déjà l'écriture ; rien d'autre n'est reporté, et un plugin qui s'appuyait sur un domaine jamais accordé reçoit un `403` qui nomme la portée.

> **La table des permissions exige le jeton admin**, jamais un jeton de plugin : un plugin capable de `PUT` ses propres autorisations pourrait tout s'accorder.

> Les chaînes de permission inconnues sont stockées telles quelles et ne protègent rien.

> Ces scopes sont appliqués côté serveur dans `src-tauri/src/api/mod.rs` via `require_permission(...)` et correspondent exactement aux cases affichées dans **Plugins & API → Permissions** (groupées par domaine). En accorder une dans l'UI débloque les endpoints correspondants pour ce plugin.

> **Il n'existe aucune permission de lecture pour mods, profiles, modpacks ou repo.** Ces routes GET (marquées *Auth : non* plus haut) n'ont aucun filtre de permission : il n'y a donc rien à accorder ni à refuser — un plugin peut déjà les lire. Seuls `app`, `catalog` et `plugins` contrôlent une lecture. Les permissions inconnues sont stockées telles quelles par `PUT /api/apps/permissions/:id` et ne contrôlent rien.

Sans l'en-tête → admin (tout autorisé). Avec l'en-tête → seules les permissions accordées passent, le reste renvoie `403`.

---

## Codes de statut

| Code | Signification |
|---|---|
| `200` | OK (résultat direct) |
| `202` | Accepté (action UI-driven démarrée) |
| `400` | Champs invalides/manquants |
| `401` | Token manquant/invalide |
| `403` | Le plugin n'a pas la permission requise |
| `404` | Ressource introuvable |
| `500` | Erreur interne |

---

*Généré dans le cadre de la refonte Plugins & API. À garder synchronisé avec `frontend/src/features/plugins/plugins.ts` (`getEndpointDefs`) et `frontend/src/core/deep_link_manager.ts`. Version anglaise : `API_Reference.md`.*
