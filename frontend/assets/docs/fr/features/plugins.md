# Plugins & API


> Étends BMM avec des plugins communautaires et automatise des actions.

Si BMM ne fait pas ce dont tu as besoin, c'est ici que ça s'ajoute — sans attendre une
version.

![L'écran Plugins](assets/docs/media/screens/plugins.annotated.png)

| | | |
|---|---|---|
| **1** | **Installés** | Tes plugins. |
| **2** | **Parcourir** | Les plugins communautaires. |
| **3** | **API** | Les endpoints qu'un plugin peut appeler. |

!!! warning "Les plugins communautaires ne sont pas relus"

    BMM le dit franchement sur sa bannière : ces plugins sont créés par la communauté et ne
    sont **pas officiellement relus**. Installe depuis des gens en qui tu as une raison
    d'avoir confiance, comme pour n'importe quel autre exécutable.

    Ils sont toutefois **bornés** : un plugin agit via l'[API](doc-page:reference/api) avec son
    propre token, et ne fait que ce que tu lui as accordé. Relis ces autorisations dans
    **Plugins → Permissions**.

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/plugins.bmmreplay" data-page="features/plugins" data-title="Accorder une permission et utiliser un plugin"></div>


## Ce que tu peux accorder à un plugin

Dix autorisations, dont la plupart sont des capacités d'**écriture** — le pouvoir de
*modifier* quelque chose.

Il n'existe pas de `mods.read` ni de `profiles.read` à distribuer, parce que ces points de
lecture ne sont pas contrôlés du tout : l'API n'écoute que sur `127.0.0.1`, donc un plugin qui
détient déjà votre jeton peut lire vos mods et vos profils. Les lectures qui, elles, exigent
une autorisation sont les trois ci-dessous — `app.read`, `catalog.read`, `plugins.read`.

| Autorisation | Permet au plugin de |
|---|---|
| `mods.write` | Activer / désactiver / éditer / supprimer des mods |
| `profiles.write` | Créer / activer / éditer / supprimer des profils |
| `modpacks.write` | Créer / activer / désactiver / éditer / supprimer des modpacks |
| `repo.write` | Connecter / déconnecter / synchroniser / générer des dépôts serveur |
| `plugins.read` · `plugins.write` | Comparer une modlist · en appliquer une |
| `app.read` · `app.write` | Lire les apps installées · installer / lancer / désinstaller |
| `catalog.read` · `catalog.write` | Lire le catalogue local · créer / éditer / supprimer des entrées |

Accorde l'ensemble le plus étroit qui fait le travail. Un plugin qui réclame `repo.write` alors
qu'il ne fait qu'activer des mods mérite un second regard.

!!! tip "L'API n'est pas réservée aux plugins"

    La même API locale répond à tes propres scripts, un fichier `.bat`, PowerShell, ou un
    deeplink `bmm://` sur une page web — n'importe quoi sur ton PC. Les interrupteurs
    **globaux** dans **Plugins → Permissions** (et le mode bac à sable dans
    [Paramètres](doc-page:features/settings)) gouvernent *tous* ces appelants d'un coup, pas seulement les
    plugins installés.

<a id="strict-mode"></a>
## Le mode strict
Certains plugins appliquent une liste de mods. Le mode *strict* décide du sort de tout le
reste :

> Ce plugin va désactiver tous les mods absents de la liste.

Le mode non-strict ajoute ; le strict fait **correspondre** ta configuration à la liste,
exactement. BMM demande confirmation et te montre les mods qu'il s'apprête à éteindre — lis
cette liste plutôt que de cliquer à travers.

## Planification & automatisation

Accessible d'ici, et la raison d'être de l'API :

> Planifie des actions BMM (ponctuelles ou récurrentes) — activer un mod, un modpack, un
> profil…

Une tâche peut s'exécuter **même quand BMM est fermé** (elle s'enregistre auprès du
planificateur du système). Les règles sont évaluées de haut en bas et *la première qui
correspond gagne* — ordonne-les donc de la plus spécifique à la plus générale, exactement
comme un pare-feu.

## Ce qu'est un plugin, sur le disque

Un plugin est un dossier avec un manifeste. Rien n'est compilé, rien n'est installé dans BMM —
tu peux en lire un dans un éditeur de texte, et la personne à qui tu l'envoies aussi.

| Champ | À quoi il sert |
|---|---|
| `id`, `name`, `version`, `author` | L'identité. C'est sur `id` que BMM dédoublonne |
| `description`, `website`, `tags`, `game` | Ce qu'affiche le catalogue |
| `permissions` | Les capacités demandées. C'est l'intégralité de ce qu'il a le droit de faire |
| `modlist` | Les mods qu'il veut présents, avec leurs versions |
| `scripts` | Les scripts externes qu'il embarque, en chemins relatifs à son dossier |
| `has_scripts` | Déclare qu'il contient des scripts, pour que l'activation te prévienne |
| `folders` | Les dossiers embarqués sous `bundle/` |
| `apply_mode` | `modlist`, `script` ou `both` — ce que l'appliquer fait réellement |

`apply_mode` est le champ à lire avant d'accorder ta confiance. Un plugin `modlist` demande
seulement à BMM d'activer un ensemble de mods ; un plugin `script` exécute un programme sur ta
machine. L'exécution de scripts est derrière sa propre permission, et activer un plugin qui en
déclare te demande d'abord — mais le manifeste te dit de quel type il s'agit *avant* même de
l'installer.

!!! note "Il n'existe pas de commandes définies par un plugin"
    Un plugin ne peut pas ajouter sa propre entrée dans la palette de commandes ni inventer une
    nouvelle action. Toute sa surface est la liste ci-dessus : un ensemble de mods, des scripts
    optionnels, et les permissions qu'on lui a accordées. Tout le reste, il le fait via l'API,
    comme n'importe quel autre client.

## La référence complète

Tout ce qu'un plugin — ou un script, ou un assistant IA, ou `curl` — peut appeler est réuni au
même endroit, généré à partir du code :

- **[Référence API & deeplinks](doc-page:reference/api)** — chaque endpoint HTTP et chaque lien
  `bmm://`, avec la forme des réponses, ceux qui exigent un token et ceux qui demandent avant
  d'agir.
- **[Référence des actions](doc-page:reference/actions)** — chaque action que BMM peut exécuter
  pour toi, y compris celles que le planificateur sait lancer.

Les deux valent un coup d'œil même si tu n'écris jamais de plugin : c'est l'inventaire le plus
clair de ce qu'on peut faire faire à BMM.
