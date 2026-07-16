# Better Mod Manager — Référence API & Deeplink (FR)

> URL de base de l'API HTTP locale : `http://127.0.0.1:51274`
> Auth : la plupart des endpoints exigent l'en-tête `Authorization: Bearer <TOKEN_API>` (le token est affiché dans **Plugins & API → Token API**).
> Portée plugin : une requête peut inclure `X-BMM-Plugin-Id: <id>`. Si présent, l'appel est vérifié contre les permissions accordées à ce plugin (voir **Permissions**). Sans cet en-tête, l'appel a un accès complet (admin).

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
| `/api/status` | non | Version de l'app, profil actif, compteurs | `{ ok, version, active_profile, mod_count, profile_count, plugin_count }` |
| `/api/check-update` | non | Compare la version en cours à la dernière release GitHub | `{ ok, has_update, current_version, latest_version, release_url }` |
| `/api/mods` | non | Tous les mods du profil actif | `{ ok, data:[{id,name,active,enabled,path}] }` |
| `/api/mods/active` | non | Uniquement les mods activés du profil actif | `{ ok, data:[…] }` |
| `/api/mods/all` | non | **Tous les mods de TOUS les profils**, groupés par profil + total | `{ ok, total_mods, profiles:[{profile_id,profile_name,mod_count,mods:[…]}] }` |
| `/api/modpacks` | non | Tous les modpacks (objets complets) | `{ ok, data:[{id,name,description,mods:[…],multi_profile,dependency_mode,…}] }` (nombre de mods = `mods.length`) |
| `/api/profiles` | non | Tous les profils (résumé, sans liste de mods) | `{ ok, data:[{id,name,game,active}] }` |
| `/api/plugins` | non | Plugins installés | `{ ok, data:[…] }` |
| `/api/creator-id` | non | Votre creator ID (clé publique) | `{ ok, creator_id }` |
| `/api/data` | oui | **Export complet des données BMM** (`data.json`) — profils, mods, modpacks, plugins, réglages, tags… | fichier JSON (`bmm-data.json`) |
| `/api/repo/info?url=` | non | Métadonnées d'un repo distant | résumé du manifeste repo |
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
| `/api/repo/connect` | oui · `repo.write` | `{ url, name? }` |
| `/api/repo/sync` | oui · `repo.write` | `{ url, creator_id?, game_dir?, mods_dir?, backup_dir?, choices?, download_limit? }` (UI-driven) |
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
| `bmm://repo/connect?url=<url>` | `POST /api/repo/connect` |
| `bmm://repo/sync?url=<url>&profile=<repo_profile_id>` | `POST /api/repo/sync` |
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

Les permissions ne s'appliquent que lorsqu'une requête porte `X-BMM-Plugin-Id`. Accordées via `PUT /api/apps/permissions/:id`.

| Permission | Accorde |
|---|---|
| `app.read` | lire les apps installées (`GET /api/apps`) |
| `app.write` | installer / lancer / désinstaller des apps |
| `catalog.read` | lire le catalogue local |
| `catalog.write` | créer / éditer / supprimer des entrées de catalogue |
| `mods.write` | activer / désactiver / éditer / supprimer des mods |
| `profiles.write` | créer / éditer / supprimer / activer des profils |
| `modpacks.write` | créer / activer / désactiver / éditer / supprimer des modpacks |
| `plugins.read` | comparer la modlist d'un plugin |
| `plugins.write` | appliquer un plugin |
| `repo.write` | connecter / déconnecter / synchroniser / générer des repos |

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
