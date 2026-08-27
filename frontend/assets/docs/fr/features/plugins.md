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


## Ce que vous pouvez accorder à un plugin

Vingt-quatre autorisations, en douze domaines, et chaque domaine sépare **lecture** et
**écriture** — savoir n'est pas la même permission que changer.

| Domaine | Lecture | Écriture |
|---|---|---|
| Mods | lister les mods, voir lequel gagne un fichier partagé | activer, désactiver, mettre à jour, supprimer, réordonner |
| Profils | lister les profils | créer, modifier, supprimer, activer |
| Modpacks | lister et exporter | créer, modifier, appliquer, supprimer |
| Plugins | lister, comparer une modlist, lire les fichiers livrés | installer, appliquer, **supprimer** — y compris d'autres |
| Repo serveur | voir ce qui est connecté et ce qu'il contient | connecter, synchroniser, publier, héberger |
| Clés d'identité | voir quelles clés existent | **en créer une** |
| Applications | lister les applications installées et leurs permissions | installer, lancer, retirer |
| Catalogue d'apps | lire le catalogue local | ajouter, modifier, retirer des entrées |
| Vos données | lire **tout** ce que BMM contient, et l'exporter | importer par-dessus les vôtres |
| Automatisations | lister les tâches enregistrées | en exécuter une, l'armer ou la désarmer |
| Hooks | voir ce qui a sonné | en sonner un qu'une tâche attend peut-être |
| L'application | — | redémarrer BMM, changer l'écran, benchmark, importer une langue |
| Confidentialité | — | changer ce qui est enregistré et ce qui est envoyé |

Accordez le minimum qui fait le travail. Un plugin qui demande `repo.write` alors qu'il ne
fait qu'activer des mods mérite un second regard, et un qui demande `data.read` demande à
tout lire d'un coup.

!!! warning "Les lectures n'étaient pas protégées, elles le sont"

    Cinquante routes demandaient un jeton et aucune permission — et un jeton de plugin est un
    jeton valide, donc un plugin avec une liste **vide** pouvait lire le dump complet,
    importer des données par-dessus, redémarrer BMM, supprimer d'autres plugins et exécuter
    n'importe quelle automatisation.

    À la mise à jour, chaque plugin conserve la moitié lecture de chaque domaine sur lequel il
    avait déjà l'écriture. Rien d'autre n'est reporté, donc un plugin qui s'appuyait sur un
    domaine jamais accordé échoue avec un `403` qui nomme la portée — à un clic d'être
    accordée, dans **Plugins & API → Permissions**.

!!! danger "La liste des permissions n'est pas quelque chose qu'un plugin peut toucher"

    `PUT /api/apps/permissions/<id>` écrit les autorisations, et exige le jeton **admin**. Un
    plugin capable de définir ses propres permissions pourrait s'accorder les vingt-quatre, ce
    qui ferait de cette page la description de rien.

!!! tip "L'API n'est pas réservée aux plugins"

    La même API locale répond à vos propres scripts, un fichier `.bat`, PowerShell, ou un
    deeplink `bmm://` sur une page web — n'importe quoi sur votre PC. Les interrupteurs
    **globaux** dans **Plugins → Permissions** (et le mode bac à sable dans
    [Paramètres](doc-page:features/settings)) gouvernent *tous* ces appelants d'un coup, pas seulement les
    plugins installés.

## Déclarer ce dont votre plugin a besoin

L'onglet **Créer** a une section *Ce dont il a besoin*. Y cocher une portée ne l'accorde pas
— ça la **demande**. La personne qui installe voit la demande pré-cochée sur l'écran des
permissions et décide.

Demandez le minimum qui fonctionne. Un plugin qui demande tout est un plugin dont personne ne
lit la liste.

Le même onglet écrit désormais trois champs qu'il laissait vides quoi que vous tapiez :
**auteur**, **site web** et **tags** — la carte du plugin affiche les tags, elle dessinait
donc une ligne que rien ne pouvait remplir. Et l'**id** est vérifié pendant la frappe : il
devient un dossier sur le disque, un segment de lien `bmm://` et une clé de catalogue, donc
un espace dedans échoue de trois façons différentes — en silence, jusqu'ici.

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

## Automatisations livrées par un plugin — `automations/`

Un plugin peut porter des fichiers `.bmmpa`. **Importer une automatisation…** dans l'éditeur en
met une, et le quatrième mode d'application — **Mettre en place ses automatisations** — fait
que l'installation du plugin les met en place.

```
mon-plugin/
  plugin.json
  automations/
    rangement-nocturne.bmmpa
```

Ça existe à cause de ce que les gens livraient à la place : un `.bat`, et un message qui dit où
est le dossier. Un script est opaque — BMM ne peut pas dire ce qu'il fait, ne peut pas le
montrer, et ne peut rien lui retirer : la seule chose honnête à faire avec, c'est te prévenir.

Une automatisation, c'est l'inverse. Elle a des étapes, des permissions et un déclencheur, tout
ça peut être montré avant que quoi que ce soit arrive — et tout ça peut être **retiré**.

!!! danger "Ce qu'une automatisation livrée ne peut pas faire"

    Chacune passe par la même porte que n'importe quel autre `.bmmpa` : **désactivée**, et
    privée des quatre capacités qui sortent de BMM — exécuter des programmes, exécuter des
    scripts, ouvrir des deeplinks, arrêter des processus.

    Elles sont accordées par la personne qui va vivre avec, jamais par l'auteur du plugin. Un
    plugin est un fichier d'un inconnu comme un autre.

    C'est exactement ce qui permet à **Mettre en place ses automatisations** de proposer de les
    lancer tout de suite : une tâche qui ne peut pas démarrer de programme a pour pire cas de
    changer dans BMM quelque chose que tu viens de demander en appliquant le plugin. Sans ce
    retrait, le même bouton serait de l'exécution de code arbitraire à l'installation sous un
    nom sympathique — la confirmation dit donc à voix haute ce que les tâches ne peuvent pas
    faire, plutôt que de te demander de le croire. Elles restent éteintes ensuite dans tous les
    cas.

Appliquer un plugin pour sa **liste de mods** importe aussi ses automatisations, et ne les lance
jamais : qui applique une liste de mods a demandé une liste de mods.

!!! note "Vérifié à l'entrée, pas à la sortie"

    Un fichier est validé par sa forme au moment où tu l'ajoutes au plugin — l'extension ne
    prouve rien, et renommer un `.txt` par erreur est le cas ordinaire. Refusé là, l'auteur
    corrige ; refusé à l'application, quelqu'un d'autre apprend juste que le plugin ne marche
    pas.

    Le contrôle est volontairement superficiel. Si chaque tâche est valide se décide sur la
    machine qui l'exécutera, contre le registre de ce BMM-là — un deuxième avis écrit dans
    l'empaqueteur serait faux le jour où quelqu'un ajoute une action.

## La carte, et les deux questions qu'on se pose

Une carte de plugin proposait onze boutons-icônes sur une ligne. Chacun faisait autre chose et
tous se ressemblaient : impossible de dire lesquels ne faisaient que *regarder* et lesquels
*changeaient* quelque chose — et aucune des deux questions qu'on se pose vraiment avant de
faire confiance à un plugin ne trouvait de réponse là.

Deux verbes restent visibles : **Comparer** et **Appliquer**. Puis trois boutons qui ne font
que demander :

| | |
|---|---|
| **Permissions** | Les vingt-quatre autorisations, pour CE plugin, sur sa carte. Elles vivaient sur un écran de réglages listant tous les plugins d'un coup. Cocher ici **accorde** — plus rien n'est redemandé ensuite. |
| **Contenu** | Tout ce que le plugin contient : scripts, dossiers embarqués, automatisations, assets, l'ensemble. |
| **Analyser** | Ce qu'il changerait si tu l'appliquais. |

Tout ce qui *change* quelque chose passe derrière un menu **⋮** qui le nomme en toutes
lettres : mise à jour auto, fichiers, ouvrir le dossier, éditer, dupliquer, exporter, et
**désinstaller en dernier, après un séparateur, en rouge**. Supprimer un plugin n'est pas
l'égal de le dupliquer. Le menu se ferme avec ++esc++, sur un clic à l'extérieur, et dès qu'on
choisit quelque chose — un menu qui ne se ferme qu'en repressant son propre bouton est un menu
qu'on laisse ouvert.

!!! note "Contenu n'est pas la visionneuse d'assets"

    **Ajouter un fichier…** plus bas montre `assets/`, ce qui répond à « qu'a mis l'auteur dans
    assets ». **Contenu** parcourt tout le dossier du plugin, ce qui répond à « qu'est-ce que
    c'est » — et c'est la seconde qu'on se pose avant de lancer un truc téléchargé. Les liens
    symboliques sont listés mais jamais suivis, la liste est triée pour que deux lectures
    concordent, et elle s'arrête à 5000 entrées ou 24 niveaux de profondeur.

## Voir un dossier avant de l'embarquer

Créer un plugin permet d'importer un répertoire. Ça n'affichait que son **nom** — combien de
fichiers, quelle taille, si `node_modules` ou une sortie de build ou un `.env` avaient suivi
restait invisible jusqu'à ce que le plugin soit construit, publié, et téléchargé par d'autres.

Chaque dossier choisi porte maintenant son **nombre de fichiers et sa taille**, et un bouton
œil ouvre la même liste que la modale Contenu. Les chiffres sont demandés ligne par ligne
après l'affichage, pour qu'un dossier sur un disque lent ne bloque pas celui d'à côté.

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
