# D'où viennent les liens de BMM, et comment il cherche les mises à jour


Toutes les adresses externes que BMM utilise — catalogues, liste des dépôts, télémétrie, flux
de mises à jour — vivent dans un seul fichier, `links.json`, pour que n'importe laquelle puisse
changer **sans publier une nouvelle version de BMM**.

Tout ce qui suit est tiré de `frontend/src/core/links-config.ts`,
`frontend/assets/links.json` et `src-tauri/src/commands/autoupdate.rs`. En cas de désaccord
avec cette page, ce sont eux qui ont raison et cette page est un bug.

## D'où le fichier est chargé

BMM essaie quatre sources dans l'ordre et s'arrête à la première qui répond :

| # | Source | Utilisée quand |
|---|---|---|
| 1 | `bettercommunity.ch/api/assets/links.json` | Toujours essayée en premier. **C'est la copie que l'on modifie.** |
| 2 | La copie sur GitHub | BetterCommunity est injoignable. |
| 3 | `assets/links.json`, embarqué dans l'app | Les deux sont injoignables — hors ligne, ou premier lancement sans réseau. |
| 4 | Valeurs par défaut dans le code | Le fichier est absent ou illisible. |

Conséquence pratique : un lien peut être corrigé sur BetterCommunity et chaque installation de
BMM le récupère au démarrage suivant. Modifier le fichier embarqué n'affecte que les
installations qui ne peuvent joindre ni 1 ni 2.

## Chercher les mises à jour

BMM demande à un flux de versions s'il en existe une plus récente. Il y en a **deux**, et le
second n'est consulté que si le premier ne peut pas répondre.

| | Adresse |
|---|---|
| Principal | `api.github.com/repos/FreeProject089/BetterModsManager/releases` |
| Secours | `bettercommunity.ch/api/updates/bmm` |

### Pourquoi un second existe

GitHub autorise **60 requêtes non authentifiées par heure et par adresse IP**. Ce quota n'est
pas par personne : il appartient à l'adresse. Derrière un réseau d'entreprise, une université
ou un opérateur mobile en CGNAT, il peut être entièrement consommé par d'autres, et BMM
signalerait une erreur réseau pendant le reste de l'heure sans que tu y sois pour quoi que ce
soit.

BetterCommunity sert les mêmes informations dans le même format, donc la vérification aboutit
et rien en aval ne sait lequel a répondu.

### Quand il bascule, et quand il ne bascule pas

| Situation | Comportement |
|---|---|
| Connexion échouée | Essaie le secours |
| Erreur serveur (5xx) | Essaie le secours |
| Quota dépassé (403 / 429) | Essaie le secours |
| **Aucune version trouvée (404)** | **Arrêt.** Ce flux n'en a réellement aucune, et l'autre n'en aura presque sûrement pas davantage. |

Si le secours échoue aussi, l'erreur affichée est **la sienne** — la dernière chose essayée est
celle qui décrit l'état actuel.

Pour le désactiver, mets `autoupdate_api_fallback` à une chaîne vide. Un `links.json` antérieur
à cette clé se comporte de la même façon.

!!! warning "Les deux flux n'utilisent pas le même chemin"

    GitHub liste les versions sur `<base>` et BetterCommunity sur `<base>/releases`, alors que
    les deux servent la plus récente sur `<base>/latest`. BMM choisit la bonne forme en
    vérifiant si l'adresse se termine par `/releases`.

    Ça compte si tu pointes un jour ces adresses ailleurs : échanger l'une pour l'autre sans en
    tenir compte renvoie un 404 sur la liste — et un 404 signifie *aucune version*, donc la
    panne s'afficherait comme **« vous êtes à jour »** au lieu d'une erreur.

## À quoi sert chaque entrée

### Catalogues et listes

| Clé | Ce qu'elle alimente |
|---|---|
| `plugin_catalog` | Le navigateur de plugins. Injoignable → liste vide. |
| `apps_catalog` | L'onglet des applications Better\*. |
| `preset_catalog` | Le flux officiel d'automatisations du planificateur. |
| `server_browse` | La liste publique des Server-Repos dans Parcourir. Tes propres dépôts ne sont pas concernés. |
| `contributors` | L'écran des crédits. Retombe sur ce qui est embarqué. |
| `plugin_github` | Où pointe « Voir sur GitHub » depuis l'écran des plugins. |

### Télémétrie — sur consentement

| Clé | Ce qu'elle fait |
|---|---|
| `analytics_endpoint` | Où les données d'usage anonymes sont envoyées. **Vide signifie que rien ne quitte ta machine** — les événements restent en mémoire tampon localement. |
| `analytics_key` | Une clé d'ingestion *publique*. Elle ne permet que d'envoyer de la télémétrie et elle est déjà présente dans l'app : ce n'est pas un secret. La clé qui permet de lire ou de supprimer des données ne vit que sur le serveur. |

### Discord Rich Presence

`WebSiteRPC1` / `WebSiteRPC2` et `github_RPC1` / `github_RPC2` sont les adresses candidates pour
les deux boutons affichés par Discord. `BoutonRPC1` et `BoutonRPC2` choisissent laquelle de
chaque paire est utilisée — `1` ou `2`.

## Tester contre un BetterCommunity local

Pour pointer BMM vers un BetterCommunity qui n'est pas le site public — un tunnel, une instance
locale — change l'hôte `bettercommunity.ch` dans `server_browse`, `contributors`,
`preset_catalog`, `catalog_index`, `analytics_endpoint` et `autoupdate_api_fallback`.

Comme la source 1 **est** BetterCommunity, modifier *sa* copie n'est pas la bonne méthode :
modifie la copie GitHub ou le fichier embarqué.

## Une réserve à connaître

Six entrées sont présentes dans `links.json` et **rien ne les lit** : `github_repo`, `reddit`,
`ed_forum`, `kofi_community`, `bettercommunity` et `catalog_index`. Ces adresses sont figées
dans le balisage de l'application, donc les changer ici n'a aucun effet. `kofi`, lui, **est**
lu et fonctionne.

Un exposé plus complet, destiné à qui maintient le fichier, se trouve dans
`frontend/assets/LINKS.md`.
