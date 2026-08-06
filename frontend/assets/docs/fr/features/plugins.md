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

<div class="bmm-replay" data-page="features/plugins" data-title="Accorder et utiliser un plugin (clip placeholder)"></div>

*Enregistrement placeholder — un clip ciblé de cet écran le remplacera.*

## Ce que tu peux accorder à un plugin

Chaque autorisation est une capacité d'**écriture** — le pouvoir de *modifier* quelque chose.
Il n'y a pas de permission de « lecture » à distribuer pour tes mods ou profils, parce que la
lecture n'est de toute façon pas contrôlée (l'API n'écoute que sur ta propre machine). Une
autorisation donne à un plugin le droit d'agir, pas de regarder.

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

<!-- TODO(contenu) : la référence de l'API, la liste des endpoints et les commandes
     personnalisées méritent leurs propres pages — c'est 960+ chaînes de surface. -->
