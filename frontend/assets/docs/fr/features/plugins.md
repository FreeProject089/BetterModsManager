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


## Fichiers livrés par un plugin — `assets/`

Un plugin pouvait déjà transporter deux sortes de suppléments : des **scripts**, déclarés
pour pouvoir être exécutés, et des dossiers **`bundle/`**, copiés dans le jeu. Tout le
reste de ce qu'un auteur donne vraiment aux gens — un README, un modèle de config, un `.mm`
d'exemple, un tableau de codes, un petit outil — n'avait nulle part où aller. Ça finissait
dans un message Discord.

Mets-le dans `assets/`, dans le plugin :

```
mon-plugin/
  plugin.json
  assets/
    README.md
    setup.ps1
    docs/codes.csv
```

Le trombone sur la carte du plugin l'ouvre. Un README s'ouvre tout seul ; les autres
documents, les `.json`, les `.csv` et les scripts sont affichés en texte ; les images sont
affichées ; le reste propose **Enregistrer une copie…**.

!!! note "C'est le dossier qui fait foi, pas le manifeste"

    `plugin.json` gagne une liste `assets`, et elle est **écrite à partir du disque au moment
    où le plugin est empaqueté** — sinon un auteur qui ajoute un README et oublie d'éditer le
    manifeste publierait une liste de fichiers mensongère.

    La copie installée lit quand même le dossier. Un plugin dont le manifeste nomme un
    fichier absent n'affiche rien plutôt qu'une entrée qui refuse de s'ouvrir, et un plugin
    qui transporte un fichier que son manifeste n'a jamais mentionné l'affiche quand même —
    c'est le cas qui compte, parce qu'un fichier surprise est justement celui qu'il faut voir.

    La déclaration existe pour les lecteurs qui n'ont que le manifeste : l'inspecteur de
    BetterCommunity, une file de modération, une entrée de catalogue. Colle un `plugin.json`
    dans **Inspecter un fichier BMM** : il liste maintenant ce que le plugin livre, et nomme
    les scripts qui s'y trouvent.

!!! warning "Rien dans `assets/` ne s'exécute tout seul"

    Un script est listé, signalé comme script, et c'est son **dossier** qui s'ouvre — jamais
    le fichier, parce qu'ouvrir un `.ps1` le confie à ce que l'OS utilise pour les `.ps1`, et
    ce n'est pas ce que veut dire « montre-moi ça ».

    L'exécuter est une décision de tâche planifiée, ci-dessous.

### Depuis une automatisation

L'action **Utiliser un fichier livré par un plugin** (`plugin.asset`) a quatre modes.

| Mode | Ce qu'il fait |
|---|---|
| **Le lire dans une variable** | Tout le fichier, en texte, dans `{text.<nom>}`. |
| **Le copier quelque part** | Dans un dossier que tu choisis. N'écrase jamais — un nom déjà pris devient `nom (2).ext`. |
| **Ouvrir son dossier** | Le dossier, pas le fichier. |
| **L'exécuter (script)** | Lu, puis confié à PowerShell / cmd / bash / Python. |

**Le lire** est celui qui vaut le détour. Un plugin livre la liste des codes d'escadron, ou
le modèle de config, ou l'adresse du serveur — et la tâche la lit depuis le plugin au lieu
que cette valeur soit tapée dans la tâche, où elle diverge dès la première mise à jour du
plugin.

!!! danger "L'exécution demande la permission script de la tâche"

    Pas celle du plugin, et pas un réglage sur les plugins : celle de la **tâche**. Savoir si
    *cette automatisation* a le droit de lancer des programmes est une question à laquelle tu
    as répondu une fois, par écrit, sur la tâche — et cette réponse vaut pour un script livré
    exactement comme pour un script tapé. Sans elle, l'étape refuse à voix haute au lieu de
    passer son tour : un saut silencieux ressemblerait à un plugin qui livre un fichier cassé.

    Le moteur vient de l'extension sauf indication contraire. Personne ne livre `setup.ps1`
    en voulant dire « lance ça avec Python ».


### Depuis un script, la CLI ou un assistant

```bash
bmm plugin-assets dcs-helper
bmm plugin-asset dcs-helper README.md
```

Les deux marchent **BMM fermé** — `data.json` dit où est le plugin et le dossier dit ce
qu'il contient. Ça compte ici : la raison de demander ce qu'un plugin livre est en général
qu'on décide s'il faut l'installer, ce qui n'est pas un moment où l'app est ouverte sur cet
écran.

`GET /api/plugins/assets?id=…` fait la même chose en HTTP (`plugins.read`), et `&path=…`
renvoie le texte d'un fichier. Les outils MCP sont `bmm_plugin_assets` et
`bmm_read_plugin_asset`.

!!! note "En copier un vers l'extérieur n'est pas exposé"

    Un appelant qui nommerait à la fois la source et la destination serait une primitive de
    copie de fichier avec les privilèges de BMM. Tout ce qui peut appeler ces endpoints peut
    déjà lire les octets et les écrire où il veut de ses propres mains : l'endpoint
    ajouterait de la portée sans ajouter de capacité.

## Mettre un fichier dedans, et vérifier le plugin

Lire, lister et copier **hors** d'un plugin existaient déjà. Mettre un README **dedans**
voulait dire trouver le dossier d'installation dans l'Explorateur — pas quelque chose qu'un
auteur devrait avoir à savoir sur son propre plugin. L'écran des assets a maintenant les deux
moitiés, et une vérification.

### Ajouter un fichier… / Retirer

**Ajouter un fichier…** copie ce que tu choisis dans `assets/`. Un chemin avec un dossier
garde le dossier (`docs/codes.csv` atterrit dans `assets/docs/`).

!!! note "Ça ne remplace jamais en silence"

    Ajouter `README.md` deux fois veut dire que tu l'as modifié et que le second gagne.
    Ajouter un fichier *différent* qui porte le même nom veut dire que tu viens de perdre le
    premier — et toi seul peux dire lequel des deux c'était. Donc ça refuse, et ça nomme le
    fichier.

    Renomme le tien, ou retire d'abord celui qui est là.

**Retirer** supprime le fichier sélectionné du plugin. Ce n'est pas récupérable d'ici : c'est
pour ça que ça demande d'abord, en nommant ce qui va disparaître.

### Vérifier ce plugin

Tout ce qui est rapporté ici produit un plugin qui **s'installe puis ne fonctionne pas** — la
panne sans message d'erreur : le manifeste est du JSON valide, l'archive s'ouvre, et la chose
ne fait simplement rien sur la machine de quelqu'un d'autre.

| Rapporté | Pourquoi |
|---|---|
| Un script déclaré absent du dossier | Il s'installe, l'appliquer n'exécute rien, et rien ne dit pourquoi. |
| **Contient des scripts** coché sans aucun listé | L'appliquer proposera d'exécuter des scripts qui n'existent pas. |
| Un manifeste qui liste un asset absent | Cette liste est écrite depuis le disque à l'empaquetage : ça veut dire que le manifeste a été édité à la main. |
| L'appliquer ne ferait rien | Ni liste de mods, ni scripts. |
| Une liste de mods **stricte** et vide | Strict veut dire « ceux-là et rien d'autre ». Vide, ça se lit *tout désactiver*. |
| Aucun nom | Il s'affichera partout sous son id. |
| Aucune description, aucun auteur | Une entrée de catalogue sans description est une entrée que personne n'installe, et tu es la seule personne qui puisse l'écrire. |
| Un fichier présent que le manifeste ne mentionne pas | Pas une erreur — la copie installée lit le dossier — mais une file de modération n'a que le manifeste pour se prononcer. |

La première liste est ce qui l'empêchera de marcher ailleurs ; la seconde vaut la peine d'être
lue avant de publier. **« Aucun problème trouvé » est dit à voix haute aussi** — un
vérificateur qui ne parle que quand il est mécontent est un vérificateur auquel on ne fait
jamais confiance quand il se tait.
