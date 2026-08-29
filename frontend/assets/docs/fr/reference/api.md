# Référence API & deeplinks


BMM expose deux façons de le piloter depuis l'extérieur : les **deeplinks** (`bmm://…`, sans token,
envoyés à la fenêtre en cours) et une **API HTTP locale** (token, `127.0.0.1` uniquement). Tout ce
qui suit vient des registres de l'app elle-même, donc c'est cohérent avec ce que montre *Plugins &
API* dans l'app.

!!! tip "Lequel choisir ?"

    Un deeplink est une URL — tout ce qui sait ouvrir un lien peut le déclencher (un `.bat`, un
    raccourci, un site, une autre app) et ça ne demande aucun secret. L'API HTTP sert à **relire**
    des données et à envoyer des payloads qu'une URL ne peut pas exprimer. Si la chose existe sous
    les deux formes, préfère le deeplink.

---

## Transport

| | |
|---|---|
| URL de base | `http://127.0.0.1:51274` |
| Adresse d'écoute | **`127.0.0.1` uniquement** — jamais `0.0.0.0`, donc rien hors de la machine n'y accède |
| Port | `51274` par défaut ; surchargeable via `settings.api_port` (`0` = retour au défaut). Nécessite un redémarrage |
| Port effectif | À lire à l'exécution sur `GET /api/health` → `port` |
| Limitation de débit | **Aucune.** N'expose pas ce port |

!!! warning "Si le port est déjà pris, l'API ne démarre pas du tout"

    Elle ne **bascule pas** sur un autre port. BMM écoute avec un handler d'arrêt propre ; si
    quelque chose occupe déjà 51274 — typiquement une instance zombie après un redémarrage
    in-app — l'API est **désactivée pour toute la session** et une ligne part dans le journal de
    crash. L'app continue de fonctionner normalement, donc le seul symptôme est un script qui
    n'arrive pas à se connecter. Commence toujours par `GET /api/health`.

**CORS.** En build release, les origines sont limitées à `https://tauri.localhost`,
`tauri://localhost`, `http://tauri.localhost`, `https://bettercommunity.ch`, plus ce que tu ajoutes
dans *Plugins & API → CORS* (une entrée `*` seule = tout autoriser). Un build `tauri dev` autorise
toutes les origines. La liste est lue **une seule fois au démarrage de l'API**. `curl` et les
deeplinks n'envoient pas d'`Origin`, donc rien de tout ça ne les concerne.

---

## S'authentifier

```bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:51274/api/mods
```

`Authorization: Bearer …` est la seule forme acceptée, et la comparaison est faite en **temps
constant**. Il y a deux sortes de token :

| | D'où il vient | Portée |
|---|---|---|
| **Token admin** | Un UUID v4 généré au premier lancement, stocké dans `data.json` sous `settings.api_token`. Rotation depuis *Plugins & API* | Tout. Contourne tous les contrôles de permission |
| **Token plugin** | Émis par plugin, stocké dans `settings.plugin_tokens` (`token → plugin_id`) | Uniquement ce qui a été accordé à ce plugin |

Le token est relu à **chaque** requête : une rotation prend effet immédiatement, sans redémarrage.

### Permissions

Pour un token plugin, l'identité de l'appelant vient **du token**, jamais de l'en-tête
`X-BMM-Plugin-Id` — un plugin ne peut donc pas s'élever en forgeant ou en omettant cet en-tête.
Accorde avec `PUT /api/apps/permissions/<plugin_id>` :

`app.read` · `app.write` · `catalog.read` · `catalog.write` · `data.read` · `data.write` ·
`hooks.read` · `hooks.write` · `keys.read` · `keys.write` · `modpacks.read` · `modpacks.write` ·
`mods.read` · `mods.write` · `plugins.read` · `plugins.write` · `profiles.read` · `profiles.write` ·
`repo.read` · `repo.write` · `schedules.read` · `schedules.write` · `system.write` · `telemetry.write`

Cette liste vit dans le code sous le nom `api::PLUGIN_SCOPES`, et un test vérifie qu'elle
correspond au routeur dans les deux sens : une portée exigée que rien ne peut accorder est une
route inatteignable, et une portée qui ne protège aucune route est une case à cocher qui promet
une protection inexistante.

!!! warning "`keys.write` ne fait exprès pas partie de `repo.write`"

    Une clé d'identité est ce qui prouve que vous êtes *vous* auprès de chaque source protégée.
    « Peut publier un repo » ne doit pas vouloir dire « peut créer ce avec quoi je signe » : c'est
    sa propre autorisation — et `keys.read`, voir quelles identités existent, en est encore une
    autre.

!!! note "Lecture et écriture sont séparées, et les lectures SONT protégées"

    Elles ne l'étaient pas. Cinquante routes demandaient un jeton et aucune permission, et
    `require_token` accepte **n'importe quel** jeton de plugin — donc `GET /api/data` (le dump
    complet), `POST /api/data/import`, `POST /api/restart` et `DELETE /api/plugins/<id>` étaient
    atteignables par un plugin sans aucune permission. C'est protégé désormais.

    À la mise à jour, chaque plugin conserve la moitié lecture de chaque domaine sur lequel il
    avait déjà l'écriture : avoir le droit de changer vos mods, c'est garder celui de les
    lister. Rien d'autre n'est reporté ; un plugin qui s'appuyait sur un domaine jamais accordé
    reçoit un `403` qui nomme la portée — à un clic d'être accordée, et bien préférable à un trou
    silencieux.

!!! danger "La table des permissions est réservée au jeton admin"

    `GET`/`PUT /api/apps/permissions*` exigent le **jeton admin**, jamais un jeton de plugin. Un
    plugin capable de `PUT` ses propres autorisations pourrait tout s'accorder, ce qui rendrait
    cette page entièrement décorative.

### Erreurs

| Statut | Corps |
|---|---|
| `401` | `{"error":"Unauthorized: invalid or missing token"}` |
| `403` | `{"error":"Forbidden: plugin '<id>' lacks permission '<perm>' — grant it with: PUT /api/apps/permissions/<id>"}` |
| `400` | corps JSON invalide |
| `404` / `405` / `500` | `{"error":"…"}` |

---

## Deeplinks

Envoyés à la fenêtre en cours — **sans token**. Depuis un script :

```bat
start "" "bmm://mod/enable?id=my-mod-folder"
```

```powershell
Start-Process "bmm://mod/enable?id=my-mod-folder"
```

`*` marque un paramètre obligatoire. Chacun affiche un toast à la réception, et un coupe-circuit
global (`bmm_deeplink_allow_global = blocked`) les refuse tous.

!!! warning "Trois d'entre eux s'arrêtent et demandent — ce qui compte surtout si vous scriptez"

    Les deeplinks d'action ci-dessous (`mod/enable`, `profile/activate`, …) agissent
    immédiatement. Trois font exception et ouvrent d'abord une confirmation :

    | Deeplink | Pourquoi |
    |---|---|
    | `bmm://api` avec une méthode autre que `GET` | C'est un passe-plat générique vers l'API locale. Selon les mots du code : *« n'importe quel site ou application peut déclencher un lien `bmm://`, donc un simple clic ne doit pas pouvoir muter l'état de l'app en silence via un passe-plat générique. »* |
    | `bmm://repo/connect` | Ajouter une source est une décision de confiance |
    | `bmm://language/import` | Il écrit un fichier dans `Lang/` |

    À lire dans les deux sens. C'est ce qui empêche une page web de reconfigurer BMM en douce —
    et c'est aussi pourquoi un script **sans surveillance** ne doit pas faire passer une écriture
    par `bmm://api` : il restera bloqué sur une boîte de dialogue que personne n'ouvrira. Pour
    l'automatisation, utilisez les deeplinks d'action ci-dessus, ou l'API HTTP avec un jeton, qui
    ne demande rien.

### Mods, profils, modpacks

| Deeplink | Params | Effet |
|---|---|---|
| `bmm://mod/enable` | `id`* | Active un mod dans le profil actif |
| `bmm://mod/disable` | `id`* | Le désactive |
| `bmm://profile/activate` | `id`* (UUID du profil) | Change le profil actif |
| `bmm://modpack/enable` | `id`* | Active tous les mods d'un modpack — `id` accepte un id de **modpack ou de profil** |
| `bmm://modpack/disable` | `id`* | L'inverse |
| `bmm://modpack/create` | `name`*, `profile` | Crée un modpack depuis les mods actifs d'un profil |
| `bmm://install` | `url`*, `name` | Télécharge un mod et ouvre la boîte d'installation (choisir ou créer le profil cible) |

### Plugins

| Deeplink | Params | Effet |
|---|---|---|
| `bmm://plugin/activate` | `id`* | Applique la modlist du plugin (et désactive le reste si `strict`) |
| `bmm://plugin/compare` | `id`* | Ouvre la comparaison modlist / mods actifs |
| `bmm://plugin/delete` | `id`* | Le désinstalle — registre, permissions et fichiers |

### Dépôt serveur & mises à jour

| Deeplink | Params | Effet |
|---|---|---|
| `bmm://repo/connect` | `url`*, `name`, `password` | Enregistre un dépôt distant (le dossier parent suffit). `password` est le mot de passe de téléchargement d'un dépôt protégé, envoyé en `X-Repo-Password` au moment de lire le nom dans `repo.json` — sans lui, un dépôt protégé se connectait sous un nom qui était juste son URL. |
| `bmm://repo/sync` | `url`*, `profile`*, `game_dir`, `mods_dir`, `backup_dir`, `local_profile`, `password` | Ouvre la synchro pré-remplie et lance la récupération. `password` est envoyé en `X-Repo-Password` |
| `bmm://repo/gen` | — | Ouvre la section Génération |
| `bmm://repo/update` | `dir` | Ouvre Mise à jour, pré-rempli |
| `bmm://repo/host` | `dir`, `port` | Ouvre Hébergement, pré-rempli |
| `bmm://mod/check-updates` | — | Lance la vérification des mises à jour |
| `bmm://mod/update` | `url` | Pré-remplit la connexion, ou lance la vérification si omis |

### Apps, thèmes, langue

| Deeplink | Params | Effet |
|---|---|---|
| `bmm://app/install` | `id`*, `url`*, `title`, `type`, `path` | Télécharge et installe une app |
| `bmm://app/launch` | `id`*, `exe`* | Lance une app installée |
| `bmm://theme/apply` | `id`* | Active un thème installé |
| `bmm://theme/import` | `url`* | Télécharge et installe un `.bmmtheme.json` |
| `bmm://theme/editor` | — | Ouvre l'éditeur de thème |
| `bmm://language/import` | `path` | Importe une traduction `.json` (sélecteur de fichier si omis) |

### Automatisation, confidentialité, divers

| Deeplink | Params | Effet |
|---|---|---|
| `bmm://schedule/run` | `id`*, `k` | Exécute une tâche planifiée — c'est le hook utilisé par le Planificateur Windows. **Demande d'abord**, sauf si `k` est la clé de planification OS de cette machine |
| `bmm://schedule/enable` | `id`*, `on` | Arme (`on=1`, par défaut) ou désarme (`on=0`) une tâche enregistrée. Demande d'abord |
| `bmm://catalog/follow` | `type`*, `url`*, `password`, `key` | Suivre un catalogue — `plugin`, `theme`, `preset`, `modpack`, `repo`, `tutorial`, `list`, `index`, `app`. Un `password` est retenu pour cette session seulement, jamais écrit sur le disque ; `key` désigne QUELLE clé d’identité signe la requête — un id ou un nom. Les ids vivent dans Réglages → Identité & API, sont affichés à côté de chaque clé et survivent à un renommage ; une référence absente du trousseau est signalée plutôt qu’ignorée, parce qu’une requête partie non signée revient en « impossible de le lire » sans rien qui désigne la clé |
| `bmm://catalog/unfollow` | `type`*, `url`* | Cesser de le suivre |
| `bmm://catalog/import` | `url`*, `type`, `password` | Lit le document à cette adresse et le suit **sans qu'on lui dise de quel type il s'agit**. Celui qui a un lien ignore en général lequel des huit c'est ; le document, lui, le sait. `type` restreint un index à un seul type |
| `bmm://catalog/entry` | `type`, `mode` (`add` · `update` · `delete`), `id`, `fields` (JSON) | Écrit une entrée du catalogue **que vous rédigez sur cette machine**. Un JSON invalide dans `fields` est refusé plutôt qu'enregistré comme la chaîne qu'il est |
| `bmm://catalog/delete` | `type` | Jette le catalogue rédigé de ce type. **Demande confirmation** — et ne touche pas à ce que vous SUIVEZ |
| `bmm://repo/publish-ssh` | `dir`* | **Téléverse immédiatement** vers le serveur SSH déjà enregistré dans l'app — il n'ouvre aucun écran. Ne porte ni hôte ni chemin de clé : un lien capable de les nommer pourrait diriger une publication vers un serveur que l'utilisateur n'a jamais choisi |
| `bmm://repo/fetch-ssh` | `dir` | Pareil, pour récupérer |
| `bmm://hook` | `name`*, `data` | Sonne un hook qu'une tâche peut attendre. `data` est lu en JSON, sinon passé en texte. Demande d'abord |
| `bmm://launchpack/run` | `id`* | Exécute un Launch Pack |
| `bmm://benchmark/run` | `dataset`, `size`, `mb`, `mode`, `sources`, `profiles`, `folders` | Ouvre le benchmark préconfiguré. **Se lance automatiquement sauf si `mode=manual`** |
| `bmm://telemetry/consent` | `enabled`* | Consentement télémétrie global ; refuser purge aussi la file locale |
| `bmm://telemetry/set` | `replay`, `full`, `bench` | Sous-options. `full` veut dire **non masqué** |
| `bmm://recorder/set` | `on`, `full`, `rust`, `js` | Configure l'enregistreur de session local |
| `bmm://replay/export` | — | Exporte la session en `.bmmreplay` |
| `bmm://replay/import` | `path`, `url` | Importe et joue un `.bmmreplay` |
| `bmm://discord/rpc` | `enabled`* | Discord Rich Presence |

!!! warning "Pourquoi trois de ces liens demandent, et pourquoi l'un ne demande parfois pas"

    Un lien `bmm://` peut être écrit par n'importe quelle page sur laquelle tu cliques. Les ids
    de tâches sont créés en `sched-<horodatage en millisecondes>` : ils sont devinables là où
    un id aléatoire ne l'est pas — et exécuter la tâche de quelqu'un, c'est
    exécuter ce qu'il y a écrit dedans, jusqu'à une étape de script. Donc `schedule/run`,
    `schedule/enable` et `hook` demandent tous, et la question nomme la tâche et dit si elle a
    le droit d'exécuter des programmes.

    Ça aurait laissé chaque tâche planifiée au niveau OS attendre un clic à 3h du matin, parce
    que le miroir du Planificateur Windows lance exactement ce lien. Il porte `k=`, une clé
    créée sur ta machine et gardée dans les paramètres — jamais affichée, jamais
    envoyée nulle part, et volontairement **pas** le token d'API, puisque réinitialiser
    celui-là est une chose ordinaire à faire et transformerait en silence chaque tâche
    enregistrée en une question.

| `bmm://data/export-auto` | `dir`*, `name`, `increment` | Sauvegarde de `data.json` sans intervention. `name` accepte `{date}` `{time}` `{datetime}` ; `increment` ∈ `paren` `underscore` `timestamp` `overwrite` |
| `bmm://settings/layout` | `code`* | Applique une disposition de cartes partagée |
| `bmm://docs/open` | `article` | Ouvre Aide & autres, éventuellement sur un id d'article |
| `bmm://restart` | — | Redémarre l'app |

### Fonctionnent aussi — jusqu'ici non documentés

Gérés par le routeur mais absents de la liste in-app. Ils sont réels et supportés ; plusieurs sont
ceux que génère le site BetterCommunity.

| Deeplink | Params | Effet |
|---|---|---|
| `bmm://catalog/app/install` | `url`, `name`, `type` | Installation en un clic depuis un flux de catalogue (sans `url` → ouvre Apps) |
| `bmm://catalog/plugin/install` | `url`, `name` | Idem, pour un plugin |
| `bmm://catalog/theme/install` | `url`, `name` | Idem, pour un thème (validé comme JSON d'abord) |
| `bmm://catalog/app/add-source` | `url`* | S'abonne à un catalogue d'apps communautaire (demande confirmation) |
| `bmm://catalog/plugin/add-source` | `url`* | S'abonne à un catalogue de plugins |
| `bmm://catalog/theme/add-source` | `url`* | S'abonne à un catalogue de thèmes |
| `bmm://language/import-inline` | `data`* (base64url), `code`, `gz` | Une traduction entière portée par le lien ; `gz=1` si gzippée |
| `bmm://theme/import-inline` | `data`* (JSON base64) | Installe **et active** un thème depuis le lien |
| `bmm://settings/navbar` | `code`* | Applique une disposition de barre de navigation partagée |
| `bmm://benchmark/open` | comme `benchmark/run` | Même handler, **défaut inversé** — ne se lance que si `mode=auto` |
| `bmm://import` · `bmm://download` | `url`*, `name` | Alias de `bmm://install` |

**Alias non documentés sur des schémas documentés :** `telemetry/consent` et `telemetry/set`
acceptent `consent` pour `enabled` et `replayFull` pour `full` ; `benchmark/run` lit aussi
`folders`, et découpe les listes sur `;` **ou** `|`.

### Lesquels demandent confirmation

Ceux-ci sont sûrs à donner à un utilisateur, parce qu'ils confirment avant d'agir :
`repo/connect`, `language/import` avec un `path` nu, tous les `catalog/*/add-source`, `bmm://api`
pour toute méthode autre que `GET`, et le flux `install` / `import` / `download`. Les paramètres URL
de `repo/connect`, `repo/sync` et `catalog/*/add-source` sont rejetés s'ils ne sont pas en
`http(s)`.

---

## Le passe-plat `bmm://api`

Tout endpoint sans deeplink dédié reste atteignable :

```
bmm://api?method=POST&path=/api/mods/enable&mod_id=my-mod
```

- `method` vaut `GET` par défaut ; `path` est **obligatoire et doit commencer par `/api/`**.
- Tous les autres paramètres deviennent le payload : une query string pour `GET`/`DELETE`, un
  **corps JSON** sinon, avec `"true"` / `"false"` / les entiers convertis en vrais types.
- Le **token admin est attaché automatiquement** : un lien passe-plat s'exécute donc avec tous les
  droits.
- Toute méthode autre que `GET` **demande confirmation** d'abord.

!!! warning "Deux limites dures"

    **Il ne peut pas exprimer de données imbriquées.** Les paramètres sont plats, donc les endpoints
    qui prennent un tableau ou un objet — `choices`, `mod_overrides`, `permissions`,
    `updateSources`, `addProfiles` — exigent un vrai client HTTP.

    **Il ne te rend jamais le corps de la réponse.** Tu obtiens un toast succès/statut et rien
    d'autre : c'est donc inutile pour relire des données. Passe par l'API HTTP pour ça.

---

## Endpoints

**Auth** — `—` = sans token · `token` = n'importe quel token valide · un nom de permission = ce
droit est requis (le token admin le contourne). **DL** = possède un deeplink dédié ; tout le reste
passe par `bmm://api`.

### L'enveloppe de réponse

Chaque endpoint qui renvoie une **liste** l'enveloppe :

```json
{ "ok": true, "data": [ … ] }
```

C'est donc `body.data`, pas `body.mods` / `body.profiles` / `body.modpacks`. Ça vaut pour
`/api/mods`, `/api/mods/active`, `/api/profiles`, `/api/plugins`, `/api/modpacks` et
`/api/repo/list`.

Deux formes échappent à la règle :

| Endpoint | Forme |
|---|---|
| `/api/mods/all` | `{ ok, profiles: […], total_mods }` — groupé, donc le tableau est nommé |
| `/api/health`, `/api/status`, `/api/creator-id` | objets plats ; ni `data`, ni enveloppe |

!!! warning "Ne devine pas ça d'après les noms de champs"

    Un client qui lit `body.profiles` sur `/api/profiles` récupère `undefined` puis échoue à la
    ligne suivante, en général sur un message sans rapport apparent du genre *« x.filter is not a
    function »*. Ça vaut le coup d'écrire le désenveloppage une fois — et de le tester contre
    l'app **réelle** plutôt que contre un bouchon, parce qu'un bouchon construit sur la même
    mauvaise hypothèse la confirmera avec plaisir.

### Lecture

| Méthode | Chemin | Auth | Renvoie |
|---|---|---|---|
| `GET` | `/api/health` | — | `{ok, service, port}` — la sonde de vie, et le moyen de connaître le vrai port |
| `GET` | `/api/status` | — | Quel BMM c'est — `version`, `channel` (`Release` / `PTB` / `FTB`), `built` (la date de fabrication du binaire), `os`, `arch` — plus le profil actif et le nombre de mods/profils/plugins. `1.0.0` désigne trois binaires différents, et un rapport incapable de les distinguer envoie quelqu'un chasser un bug déjà corrigé. |
| `GET` | `/api/check-update` | — | Dernière release GitHub vs actuelle : `has_update`, `release_url` |
| `GET` | `/api/mods` | `mods.read` | Mods visibles du profil actif |
| `GET` | `/api/mods/active` | `mods.read` | Uniquement les activés |
| `GET` | `/api/mods/all` | `mods.read` | Tous les mods de **tous** les profils, groupés, plus `total_mods` |
| `GET` | `/api/profiles` | `profiles.read` | Tous les profils avec leurs listes de mods |
| `GET` | `/api/plugins` | `plugins.read` | Plugins installés (manifest + `enabled`) |
| `GET` | `/api/modpacks` | `modpacks.read` | Tous les modpacks sauvegardés |
| `GET` | `/api/creator-id` | — | L'id créateur de cette installation (utilisé à l'export de plugins) |
| `GET` | `/api/repo/info` | `repo.read` | Récupère un `repo.json` distant. Query `url`*, `password`. `401` si protégé, `502` si le distant échoue |
| `GET` | `/api/repo/list` | `repo.read` | Dépôts distants enregistrés |
| `GET` | `/api/language/template` | — | `lang-template.json`, une map plate `{"clé": "English"}` |
| `GET` | `/api/data` | `data.read` | **Dump complet de `data.json`** — profils, mods, modpacks, plugins, settings, tags |
| `GET` | `/api/apps` | `app.read` | Apps installées via le catalogue |
| `GET` | `/api/apps/permissions` | admin token | `plugin_id → [permissions]` |
| `GET` | `/api/apps/permissions/:id` | admin token | Les permissions d'un plugin |
| `GET` | `/api/catalog` | `catalog.read` | Le catalogue d'apps local |

!!! danger "`GET /api/data` c'est toute la base"

    Il renvoie tout, `settings` inclus — et `settings` contient `api_token` et `plugin_tokens`.
    N'importe quel token capable de l'appeler peut lire le token admin et se fabriquer un accès
    total. Accorder cet endpoint équivaut à céder les droits admin.

### Mods & profils

| Méthode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| `POST` | `/api/mods/enable` | `mods.write` | `mod_id`* | ✓ |
| `POST` | `/api/mods/disable` | `mods.write` | `mod_id`* | ✓ |
| `GET` | `/api/mods/order` | `mods.read` | — · l'ordre de déploiement, plus chaque fichier disputé et qui le gagne | |
| `GET` | `/api/schedules` | `schedules.read` | — · un résumé de chaque tâche enregistrée : id, nom, activée ou non, son déclencheur. **Pas** ses étapes | |
| `POST` | `/api/schedules/enabled` | `schedules.write` | `id`*, `enabled`* · armer ou désarmer une tâche. Seul `enabled` est modifiable — une route qui pourrait écrire une tâche entière pourrait en installer une avec une étape de script dedans | |
| `POST` | `/api/hook` | `hooks.write` | `name`*, `data` · sonner une clochette nommée qu'une tâche peut attendre avec `wait.hook`, ou par laquelle elle peut être déclenchée avec `on event` | |
| `GET` | `/api/hook` | `hooks.read` | — · chaque nom qui a sonné pendant la session, avec le nombre de fois — pour l'écran qui demande « est-ce que mon webhook arrive vraiment ? » | |
| `GET` | `/api/hook/:name` | `hooks.read` | `?since=<ms>` · les sonneries elles-mêmes, avec leur contenu et leur horodatage — la même vue qu'obtient une tâche en attente, pour que « ça n'a jamais sonné » et « ça a sonné avec le mauvais contenu » cessent de se ressembler. La lecture ne consomme pas : deux tâches peuvent attendre la même clochette | |
| `DELETE` | `/api/hook` | `hooks.write` | — · oublier toutes les sonneries. Répond combien ont été supprimées | |
| `DELETE` | `/api/hook/:name` | `hooks.write` | — · oublier un seul nom | |
| `POST` | `/api/content-id` | token | `kind`*, `doc`* · l'id qui dit ce qu'un document EST plutôt que le nom que cette machine lui donne. Prend le document, donc il ne révèle rien de ce que cette installation contient — d'où le simple jeton plutôt qu'une portée de lecture par type |
| `GET` | `/api/catalogs` | `catalog.read` | — · les catalogues suivis, par type | |
| `POST` | `/api/catalogs` | `catalog.write` | `type`*, `url`*, `follow`, `password`, `key` · suivre ou cesser de suivre un catalogue. `password` pour un secret partagé, `key` pour désigner QUELLE clé d’identité signe — un id ou un nom, affichés dans Réglages → Identité & API. Une référence absente du trousseau est signalée, jamais ignorée : une requête partie non signée revient en « impossible de le lire » sans rien qui désigne la clé | |
| `GET` | `/api/plugins/assets` | `plugins.read` | `id`*, `path` · ce qu'un plugin livre ; avec `path`, le texte d'un fichier | |
| `POST` | `/api/mods/order` | `mods.write` | `order[]`*, `profileId` · doit être le même ensemble de mods que ceux actifs ; recopie les fichiers qui changent de main | |
| `PUT` | `/api/mods/:id` | `mods.write` | `name`, `version`, `author`, `description`, `tags[]`, `install_notes` | |
| `DELETE` | `/api/mods/:id` | `mods.write` | — · retire l'entrée, **garde les fichiers** | |
| `POST` | `/api/mod/config` | `mods.write` | `modId`*, `repoModId`, `updateUrl`, `directUrl`, `updateSources[]` · relie un mod aux dépôts qui peuvent le mettre à jour | |
| `POST` | `/api/profiles` | `profiles.write` | `name`*, `game_path`*, `mods_path`*, `backup_path`*, `game_name`, `color`, `icon` · **pas** activé | |
| `POST` | `/api/profiles/activate` | `profiles.write` | `profile_id`* | ✓ |
| `PUT` | `/api/profiles/:id` | `profiles.write` | `name`, `color`, `icon`, `game_path`, `mods_path`, `backup_path` | |
| `DELETE` | `/api/profiles/:id` | `profiles.write` | — · refuse le profil actif | |

### Modpacks & plugins

| Méthode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| `POST` | `/api/modpacks/create` | `modpacks.write` | `name`*, `mod_ids[]`, `source_profile_id`, `description`, `game_name`, `sr_link`, `multi_profile`, `skip_integrity_check`, `dependency_mode`, `mod_overrides[]` → `201` | ✓ |
| `POST` | `/api/modpacks/enable` | `modpacks.write` | `modpack_id`* (l'ancien `profile_id` est aussi accepté) | ✓ |
| `POST` | `/api/modpacks/disable` | `modpacks.write` | idem | ✓ |
| `PUT` | `/api/modpacks/:id` | `modpacks.write` | n'importe quel champ de création | |
| `DELETE` | `/api/modpacks/:id` | `modpacks.write` | — · irréversible, les mods locaux sont conservés | |
| `POST` | `/api/plugins/compare` | `plugins.read` | `plugin_id`* → `missing_required`, `strict_extra` | ✓ |
| `POST` | `/api/plugins/apply` | `plugins.write` | `plugin_id`*, `force_strict` → `enabled`, `not_found` | ✓ |
| `DELETE` | `/api/plugins/:id` | `plugins.write` | — · registre + permissions + fichiers | ✓ |

### Dépôt serveur

| Méthode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| `POST` | `/api/repo/connect` | `repo.write` | `url`*, `name` | ✓ |
| `DELETE` | `/api/repo` | `repo.write` | `url`* · fichiers conservés | |
| `POST` | `/api/repo/update-now` | `repo.write` | `repoDir`*, `authorName`, `ops` · **réécrit le dépôt** et resigne son manifeste, au lieu d’ouvrir la modale. Chaque opération est facultative — un corps qui n’en nomme aucune resigne sans rien changer d’autre, ce qu’on veut après avoir touché des fichiers à la main. Les extras en attente y entrent à la fin → `202` | |
| `POST` | `/api/repo/host-now` | `repo.write` | `path`*, `port`*, `uploadLimit`, `downloadPassword`, `authorizedKeys[]` · **démarre le service**. `/api/repo/host` n’ouvre que l’écran alors que son jumeau `/api/repo/host-stop` arrête réellement le serveur — voici la moitié qui fonctionne. Elle porte aussi un mot de passe et les clés publiques autorisées, que l’ancienne ne savait pas exprimer : héberger un dépôt PROTÉGÉ n’était pas atteignable par l’API → `202` | |
| `POST` | `/api/repo/gen-now` | `repo.write` | `outputDir`*, `authorName`*, `profileIds[]`*, `seed`, `zipOutput`, `zipMods` · **écrit le dépôt**, au lieu d’ouvrir l’écran d’hébergement. Un `profileIds` vide est REFUSÉ, jamais lu comme « tous » ; un profil nommé puis supprimé arrête l’appel au lieu d’être sauté. Les extras en attente y entrent à la fin → `202` | |
| `POST` | `/api/repo/sync-now` | `repo.write` | `url`*, `repoProfile`*, `targetProfile`*, `gameDir`*, `modsDir`*, `backupDir`, `password`, `overwriteAll`, `deleteExtra` · **exécute la synchro**, au lieu de remplir le formulaire et d'attendre qu'on presse Synchroniser. Chaque champ obligatoire est refusé avant que rien ne commence : chaque oubli est une façon de synchroniser vers un endroit que personne n'a choisi. Créer un profil local n'est volontairement pas proposé — un appelant capable d'en frapper un par appel remplit la liste. Les deux options destructrices sont à OFF par défaut → `202` | |
| `POST` | `/api/repo/sync` | `repo.write` | `url`*, `choices[]`*, `gameDir`, `modsDir`, `backupDir`, `password`, `overwriteAll`, `deleteExtra`, `downloadLimit` → `202 {job_id}`. **Un seul à la fois** (`409`). `creatorId` n'est **plus accepté** : c'est l'identité que BMM présente à un dépôt — la valeur sur laquelle une liste blanche et une liste de bannis sont indexées — donc un appelant capable de la fournir pourrait présenter l'identité de quelqu'un d'autre à un serveur qui décide l'accès avec. C'est l'id de cette installation qui est envoyé | ✓ |
| `DELETE` | `/api/repo/sync/cancel` | `repo.write` | — · s'arrête à la prochaine frontière de mod | |
| `POST` | `/api/repo/gen` | `repo.write` | `profileIds[]`*, `outputDir`*, `authorName`*, `seed`, `generateServer`, `port`, `uploadLimit`, `adminPassword`, `useCloudflare`, `useUpnp`, `autoStart`, `lang`, `serverVersion` (nombre), `serverType` (`std`/`lux`), `lightweight`, `zipOutput`, `useDocker`, `dockerOs` → `202` | ✓ |
| `DELETE` | `/api/repo/gen/cancel` | `repo.write` | — | |
| `POST` | `/api/repo/update` | `repo.write` | `repoDir`*, `authorName`, `removeModIds[]`, `removeProfileIds[]`, `addProfiles[]`, `modChangelogs{}` → `202` | ✓ |
| `POST` | `/api/repo/host` | `repo.write` | `serveDir`*, `port`, `uploadLimit` → `202`, `409` si déjà en service | ✓ |
| `DELETE` | `/api/repo/host` | `repo.write` | — | |
| `POST` | `/api/repo/manifest` | `repo.write` | `dir`*, `authorName` · écrit `repo.json` pour un dossier DÉJÀ hébergé. N'a besoin d'aucun profil et ne copie rien — il lit le dossier, écrit un fichier et renvoie le diff. Synchrone, pour qu'un script de publication puisse agir sur le résultat | |
| `POST` | `/api/repo/publish-ssh` | `repo.write` | `dir`* · envoie par SSH **en utilisant la connexion déjà enregistrée dans l'app**. L'hôte, l'utilisateur et la clé ne sont volontairement PAS des paramètres : un appelant capable de les nommer pourrait faire lire à BMM une clé privée de son choix et expédier un dépôt vers une machine de son choix. Piloté par l'UI, donc l'envoi est visible et annulable → `202` | |
| `POST` | `/api/repo/fetch-ssh` | `repo.write` | `dir`* · même règle, et elle compte davantage dans ce sens : publier écrit sur un serveur choisi par le propriétaire, récupérer écrit sur son propre disque. Seule la destination est un paramètre, et le backend refuse tout chemin distant qui en sortirait → `202` | |
| `POST` | `/api/repo/extras` | `repo.write` | `url`*, `kind`*, `id`*, `password` · prend UNE chose que le dépôt transporte en plus des mods. `creatorId` n'est pas accepté ici non plus, pour la même raison que `/api/repo/sync`. L'entrée est cherchée dans le manifeste que BMM récupère — un appelant ne peut pas fournir ses propres `{kind, url, sha256}` : ce serait se servir de l'installeur de BMM pour installer des fichiers arbitraires, et la vérification de hash vérifierait son propre chiffre. Un plugin ou une automatisation arrive **désactivé** ; un catalogue est suivi ; une liste de mods est enregistrée et son chemin renvoyé | |
| `GET` | `/api/repo/modpacks` | `repo.read` | `dir`* · quels modpacks un DOSSIER de repo sur cette machine partage, avec le mode de partage de chacun |
| `POST` | `/api/repo/modpacks` | `repo.write` | `dir`*, `shares[]`* · définit toute la liste et re-signe le manifeste. Omettre `shares` est une lecture, pas « n'en partager aucun » — ce sont deux requêtes différentes, et les confondre ferait qu'un POST vide dépublierait tout |
| `GET` | `/api/keys` | `keys.read` | — · noms et chemins uniquement. Aucun endpoint ne lit une clé privée | |
| `POST` | `/api/keys` | `keys.write` | `name`*, `kind` (`ed25519` par défaut · `ecdsa` · `rsa`) → `201 {path, public, ring}`. La réponse porte la ligne **publique** et l'endroit où la moitié privée a été écrite — jamais la moitié privée elle-même, parce que les réponses sont journalisées, relayées et lues dans des onglets. Un nom déjà sur le trousseau est refusé, pas écrasé | |
| `POST` | `/api/mod/check-updates` | `mods.write` | — → `202` | ✓ |
| `POST` | `/api/mod/update` | `mods.write` | `repoUrl` → `202` | ✓ |

### Apps & catalogue

| Méthode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| `POST` | `/api/apps/install` | `app.write` | `appId`*, `appTitle`*, `downloadUrl`*, `fileType`*, `installPath`, `version`, `category`, `thumb` → `202` | ✓ |
| `POST` | `/api/apps/launch` | `app.write` | `appId`*, `exePath`* | ✓ |
| `DELETE` | `/api/apps/:id` | `app.write` | — · désenregistre, fichiers conservés | |
| `PUT` | `/api/apps/permissions/:id` | admin token | `permissions[]`* · **remplace** la liste ; `[]` révoque tout | |
| `POST` | `/api/catalog/new` | `catalog.write` | `name`, `description`, `partner_catalogs[]`, `community_imports[]`, `apps[]` → `201` | |
| `POST` | `/api/catalog/apps` | `catalog.write` | `id`*, `title`*, `download`* `{url, file_type}`, `description`, `category`, `price`, `tags` (≤3), `requirements`, `md_link` → `201` | |
| `PUT` | `/api/catalog/apps/:id` | `catalog.write` | `title`, `description`, `version`, `category`, `download` | |
| `DELETE` | `/api/catalog/apps/:id` | `catalog.write` | — | |
| `POST` | `/api/catalog/import` | `catalog.write` | `url`*, `type`, `password` → `202`. Lit le document et décide : un index fait suivre chaque type qu'il liste (ou seulement `type`), un catalogue seul est confronté aux huit formes. Celui qui n'en suit aucune est refusé plutôt que deviné | ✓ |
| `POST` | `/api/catalog/entries` | `catalog.write` | `type` (`app` · `plugin` · `theme` · `preset` · `modpack` · `repo` · `tutorial` · `list` · `index`, `app` par défaut), `entry`* → `201`. Écrite sous le nom de tableau qu'utilise le format de ce type. L'entrée doit porter un `id` — la mise à jour et la suppression s'y réfèrent, donc une entrée sans id serait ajoutée dans un cul-de-sac | |
| `PUT` | `/api/catalog/entries/:id` | `catalog.write` | `type`, plus les champs à fusionner. `type` dit quel catalogue ouvrir et n'est jamais écrit dans l'entrée | |
| `DELETE` | `/api/catalog/entries/:id` | `catalog.write` | Requête `type` · `404` si l'entrée n'existe pas, plutôt qu'annoncer une suppression qui n'a pas eu lieu | |
| `DELETE` | `/api/catalog` | `catalog.write` | Requête `type` · jette tout le catalogue écrit pour ce type. `404` s'il n'y en a jamais eu. Ne touche PAS ce que tu SUIS — ça, c'est `/api/catalogs` | |

### Import / export — ceux-ci pilotent l'interface

Chacun ouvre le flux in-app correspondant et renvoie `202`. Ils ne sont **pas** headless ; la seule
exception est `data/export-auto`.

| Méthode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| `POST` | `/api/data/export` · `/api/data/import` | token | — | |
| `POST` | `/api/data/export-auto` | `data.read` | `dir`*, `name`, `increment` · **sans intervention**, aucune boîte de dialogue | ✓ |
| `POST` | `/api/modlists/export` · `/api/modlists/import` | token | — · `.mm`, métadonnées seules, aucun fichier de mod | |
| `POST` | `/api/modpacks/import` | `modpacks.write` | `path` | |
| `POST` | `/api/modpacks/export` | `modpacks.read` | `id`*, `destDir` | |
| `POST` | `/api/plugins/import` | `plugins.write` | — | |
| `POST` | `/api/plugins/export` | `plugins.read` | `id`* → `.bmmplug` | |
| `POST` | `/api/language/import` | `system.write` | `path` · le nom de fichier devient le code de langue ; `template.json` est refusé | ✓ |
| `POST` | `/api/profiles/import/ovgme` | `profiles.write` | — · scanne `%PROGRAMDATA%/OvGME` | |
| `POST` | `/api/profiles/import/omm` | `profiles.write` | — · OpenModManager `.omm`/`.omx` | |

### Automatisation & confidentialité

| Méthode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| `POST` | `/api/schedule/run` | `schedules.write` | `id`* | ✓ |
| `POST` | `/api/launchpack/run` | `app.write` | `id`* | ✓ |
| `POST` | `/api/benchmark` | `system.write` | `dataset`, `size`, `mode`, `sources[]`, `profiles[]` | ✓ |
| `POST` | `/api/telemetry/consent` | `telemetry.write` | `enabled`* | ✓ |
| `POST` | `/api/telemetry/settings` | `telemetry.write` | `replay`, `full`, `bench` | ✓ |
| `POST` | `/api/recorder` | `telemetry.write` | `on`, `full`, `rust`, `js` | ✓ |
| `POST` | `/api/replay/export` | `replay.read` | — | ✓ |
| `POST` | `/api/replay/import` | `replay.write` | `path`, `url` | ✓ |
| `POST` | `/api/discord/rpc` | `system.write` | `enabled`* | ✓ |
| `POST` | `/api/restart` | `system.write` | — · l'API est brièvement indisponible | ✓ |
| `POST` | `/api/view` | `system.write` | `id`* · affiche un écran. L'id est la valeur `data-view` de la barre latérale (`mapper`, `library`, …) ; un id inconnu ne fait rien et le dit dans la console de l'app, exactement comme le deeplink `bmm://view/open` | ✓ |

---

## Observer ce qui appelle

Chaque requête `/api/` émet un événement Tauri portant `{method, path, status}` — c'est ce qui
produit les toasts in-app et le journal API de la page *Plugins & API*. Les endpoints qui pilotent
l'interface émettent en plus un événement exec ou rejected. Tu peux donc voir arriver les appels
externes sans instrumenter ton propre script.

---

## Incohérences connues

Consignées parce que le registre in-app et le serveur ne s'accordent pas sur tous les détails :

- **Les barrières de permission sont plus étroites qu'elles n'y paraissent.** `mod/check-updates`,
  `mod/update`, `repo/update`, `repo/host` (les deux méthodes), les deux routes d'annulation,
  `DELETE /api/plugins/:id` et toutes les routes `/api/apps/permissions*` sont **token seul** — un
  token plugin sans aucune permission y passe.
- **`POST /api/repo/gen`** : la liste in-app montre `serverVersion` deux fois avec des types
  contradictoires. Le serveur a `serverVersion` (nombre) **et** `serverType` (`"std"` / `"lux"`) —
  la chaîne va dans `serverType`, un nom que la liste in-app ne mentionne jamais. `lightweight` est
  aussi accepté.
- **`POST /api/repo/host`** est décrit comme démarrant un serveur de fichiers statique ; en réalité
  il pilote l'UI native Dépôt Serveur et renvoie `202`, pas `200`.
- **`DELETE /api/plugins/:id`** a un deeplink fonctionnel (`bmm://plugin/delete`) mais est absent de
  la table endpoint→deeplink, donc le badge `bmm://` in-app ne s'affiche pas pour lui.
- **`bmm://telemetry/settings`** apparaît dans une description mais n'est **pas routé** — seul
  `bmm://telemetry/set` fonctionne.
- Les réponses d'erreur rajoutent `access-control-allow-origin: *` sans condition, même en release.

---

## Voir aussi

- [Référence du serveur MCP](doc-page:reference/mcp) — les 51 outils qu'un client IA peut appeler, et ceux qui exigent BMM ouvert
- [Référence des actions](doc-page:reference/actions) — toutes les actions du planificateur et du générateur de scripts
- [Plugins & API](doc-page:features/plugins) — le navigateur in-app, les tokens et le test rapide
- [Architecture](doc-page:how-it-works/architecture) — où se situe cette API dans l'app
