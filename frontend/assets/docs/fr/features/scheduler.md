# Planification & automatisation


> Planifiez des actions BMM (ponctuelles ou récurrentes) — activer un mod, un modpack, un
> profil… avec conditions (si/sinon), tes propres scripts et des programmes externes. Les tâches s’exécutent tant
> que BMM est ouvert.

Accessible depuis [Plugins & API](doc-page:features/plugins). C'est la partie de BMM qui agit sans que vous
la pilotiez.

!!! warning "Par défaut, BMM doit tourner"

    Le planificateur est une minuterie **dans l'application** : elle vérifie les tâches dues
    toutes les 20 secondes tant que la fenêtre est ouverte. Rien ne se déclenche quand BMM est
    fermé — une tâche ponctuelle dont l'heure passe entre-temps s'exécute au prochain
    lancement, pas au moment demandé.

    Sous Windows, vous pouvez lever cette limite. BMM enregistre une **tâche planifiée
    Windows** qui lance `BMM.exe "bmm://schedule/run?id=…"` à l'heure voulue ; BMM gère le
    schéma `bmm://`, donc Windows le démarre et le routeur de deeplinks exécute cette tâche.
    L'application s'ouvre — c'est un réveil de BMM, pas une exécution dans son dos.

![Le planificateur](assets/docs/media/screens/scheduler.annotated.png)

| | | |
|---|---|---|
| **1** | **Déclencheur** | *Quand* ça tourne. |
| **2** | **Règles** | *Si* ça tourne, et ce que ça fait. |
| **3** | **Nouvelle tâche** | Une tâche, un travail. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/scheduler.bmmreplay" data-page="features/scheduler" data-title="Créer une tâche planifiée"></div>


## Une tâche a trois parties

**Déclencheur → règles → action.** Le déclencheur demande *quand*, les règles demandent *si*,
l'action est *quoi*.

### 1. Déclencheur — quand

| Type | Se déclenche |
|---|---|
| `once` | Une fois, à une date et une heure. |
| `interval` | Toutes les N minutes. |
| `hourly` | Toutes les N heures. |
| `dailyAt` | Chaque jour à `HH:MM`. |
| `weeklyAt` | À une heure, les jours de semaine choisis. |
| `monthlyAt` | Un jour du mois (1–31) à une heure. |
| `appStart` | Une fois par lancement de BMM (quelques secondes après le démarrage). |
| `manual` | Jamais tout seul — seulement le bouton ▶ **Lancer maintenant** ou `bmm://schedule/run`. |

!!! warning "Les déclencheurs horaires ne partent que si BMM est éveillé"

    `dailyAt` / `weeklyAt` / `monthlyAt` sont vérifiés par la boucle interne de BMM, qui se réveille
    environ toutes les 20 secondes. Si BMM est **fermé** à cette minute précise, l'exécution est
    manquée et **non** rattrapée. C'est à ça que sert *Exécuter même quand BMM est fermé* (plus bas).

### 2. Règles — si

Une règle, c'est `SI <condition> ALORS <action>`. C'est là que le planificateur cesse d'être
une minuterie et devient utile. Les conditions :

| Condition | Vraie quand |
|---|---|
| `Toujours` | Sans condition (par défaut). |
| `Profil actif` | Un [profil](doc-page:features/profiles) donné est le courant. |
| `Mod activé` / `Mod désactivé` | L'état d'un mod donné. |
| `Modpack actif` / `Modpack inactif` | Tous les mods d'un [modpack](doc-page:features/modpacks) sont on / off. |
| `Tous les mods du profil actif sont on` | Rien n'est éteint dans le profil. |
| `App en cours` / `App non lancée` | Un processus (par nom) tourne ou non — le jeu, par exemple. |
| `En ligne` | La machine a une connexion internet. |
| `Jour de la semaine` | Aujourd'hui est un des jours choisis. |
| `Plage horaire` / `Heure atteinte` | L'horloge est dans une plage / a dépassé une heure. |
| `Fichier existe` / `hash` / `taille` / `type` | Vérifs de fichier — un chemin existe, ou son hash (blake3/sha256), sa taille ou son type correspond. |
| `La commande réussit` | Une commande externe s'exécute et sort en `0`. |
| `Comparaison de valeur` | Un nombre capté se compare à un seuil (plus bas). |

!!! warning "La première qui correspond gagne"

    D'après l'état vide du planificateur lui-même : *Aucune règle — ajoutes-en une. **La
    première ligne qui correspond gagne** (de haut en bas).*

    Ordonne tes règles **de la plus spécifique à la plus générale**, exactement comme des
    règles de pare-feu. Une règle `Toujours` en haut rend toutes celles du dessous du code
    mort — et rien ne te le dira, puisque du point de vue du planificateur, il a fait son
    travail.

### 3. Action — quoi

Il y a ~60 actions réparties en huit groupes :

| Groupe | Quelques actions |
|---|---|
| **Mods & profils** | Activer un profil · activer/désactiver un mod · activer/désactiver un modpack · créer un modpack · ajouter un mod depuis une URL · exporter/importer une liste · tout activer/désactiver · scanner le dossier · vérifier les MàJ de mods |
| **Dépôt & partage** | Connecter · synchroniser · générer · mettre à jour · héberger un dépôt |
| **Apps & lancement** | Lancer une app · installer une app · ouvrir un fichier/dossier · **lancer un [Launch Pack](doc-page:features/launch-packs)** |
| **Apparence** | Appliquer un thème |
| **Benchmarks & stockage** | Benchmark d'app · **benchmarker un disque** · **appliquer une limite de vitesse** · basculer **Smart I/O** / **Auto-calibration** · **vérifier l'espace libre** (voir [Stockage](doc-page:features/storage)) |
| **Confidentialité & enregistreur** | Consentement télémétrie · enregistreur de session · exporter/importer un replay |
| **Système & flux** | Afficher une notification · Discord RPC · exporter une sauvegarde · définir une variable · **lancer une autre tâche planifiée** · redémarrer BMM · ouvrir une URL · **lancer une commande personnalisée** · exécuter un deeplink `bmm://` brut |
| **Logique & maths** | Calcul mathématique dans une variable · ternaire · table de décision · garde d'arrêt de tâche |

Beaucoup d'actions s'exécutent en émettant un deeplink `bmm://` canonique via le gestionnaire de
l'app — la même plomberie qu'expose la page [Plugins & API](doc-page:features/plugins), d'où le fait que les deux
systèmes peuvent se piloter mutuellement.

## Tourner quand BMM est fermé

> Exécuter même quand BMM est fermé.

Ça enregistre la tâche auprès du **planificateur de ton système**, pas de la boucle interne
de BMM. Le système la réveille à l'heure, que l'app tourne ou non — tout l'intérêt d'un
« prépare mon modpack à 6h ».

Ça veut aussi dire que la tâche vit en dehors de BMM. La supprimer dans BMM supprime aussi la
tâche système ; si tu fouilles la liste des tâches de ton OS, ce sont ces entrées-là.

## Exécuter ton propre code

Deux étapes sortent de BMM. **Lancer un programme externe** démarre quelque chose avec des
arguments. **Exécuter un script** prend du code que tu écris — PowerShell, CMD, Bash ou
Python — directement dans la tâche.

Le script est enregistré dans un fichier temporaire et c'est *le fichier* qui est remis à
l'interpréteur. Rien de ce que tu tapes n'est jamais placé sur une ligne de commande : aucun
échappement à réussir, et un guillemet égaré ne peut pas changer ce qui s'exécute. Dans un
**Pour chaque**, `{item.name}` et `{item.id}` sont remplacés avant le démarrage, donc un seul
script peut agir sur chaque mod à son tour.

Dans *Avancé*, nomme une variable. La première ligne de sortie du script en devient la valeur,
et les étapes suivantes peuvent la tester :

```powershell
# compte les .dll ; un SI plus loin peut se brancher sur {dlls}
(Get-ChildItem -Recurse -Filter *.dll | Measure-Object).Count
```

Sans ça, un script ne pouvait que signaler une réussite ou un échec — « si le script dit oui,
alors… » n'avait aucun moyen d'être exprimé.

## Les permissions

Chaque tâche accorde quatre choses séparément, et chacune dit ce qu'elle débloque :

| Autorisation | Ce qu'elle permet |
|---|---|
| **Lancer des programmes externes** | Démarrer un programme avec des arguments |
| **Exécuter des scripts** | Exécuter du PowerShell / CMD / Bash / Python que tu as écrit |
| **Déclencher des deeplinks** | Déclencher des liens `bmm://` |
| **Arrêter un programme** | Terminer un processus en cours |

Les quatre sont désactivées tant que tu ne les actives pas, et une étape dont la permission
manque échoue avec un message indiquant laquelle accorder — elle ne s'exécute jamais en
silence.

Arrêter un programme est séparé de le lancer parce que le risque est d'une autre nature :
démarrer quelque chose s'annule, tuer quelque chose peut perdre un travail non enregistré sans
rien pour revenir en arrière.

!!! warning "Les deeplinks sont la plus large des quatre"

    Un lien `bmm://` atteint tout ce que l'app expose, y compris des actions sans étape dédiée
    dans le planificateur. Auparavant, rien ne les gardait.

!!! note "Migration depuis l'ancienne case unique"

    Une tâche construite avant la séparation garde tout ce qu'elle avait — mais aucune ne gagne
    **Exécuter des scripts** ni **Arrêter un programme**. Ces capacités n'existaient pas quand
    tu as coché *Autoriser les commandes personnalisées* : te les accorder maintenant
    reviendrait à inventer ton consentement plutôt qu'à l'honorer.

!!! danger "Une tâche qui arrive dans un FICHIER n'en reçoit aucune"

    Importer un `.bmmpa`, ou ajouter un `.bmmscript` partagé à tes tâches, retire les quatre
    autorisations et laisse la tâche **désactivée** — puis te dit ce que le fichier demandait.

    L'automatisation est intacte et à un interrupteur de fonctionner. Ce qu'elle ne peut pas
    faire, c'est arriver en tenant déjà le droit de lancer des programmes à intervalle
    régulier — ce qui était le cas avant : seul *Exécuter même quand BMM est fermé* était
    effacé, et tout le reste passait tel que l'auteur l'avait réglé.

## Un exemple

Le planificateur en fournit un, et c'est une bonne forme à copier :

> Toutes les heures, boucle 3× et affiche une notification à chaque fois.

Pars de là, remplace la notification par une vraie action, et ajoute une condition pour
qu'elle ne se déclenche que quand il le faut.

### La condition `Comparaison de valeur`

Elle compare un nombre que BMM a capté plus tôt dans l'exécution — par exemple la vitesse
d'écriture mesurée d'un disque (`disk.write_mbps`) ou un résultat de benchmark
(`benchmark.mbps`) — à un seuil que tu fixes, via l'un de six opérateurs :

`>` · `<` · `>=` · `<=` · `==` · `!=`

Ainsi « *si `disk.write_mbps` `<` 50, affiche un avertissement* » devient une vraie règle. Si
la valeur source n'a jamais été captée, la condition est simplement fausse — elle ne se
déclenche pas sur une donnée manquante. Chaque condition peut aussi être **niée**.

### Les groupes — `all` et `any`

`all` et `any` contiennent une **liste d'autres conditions**, pour qu'une garde pose plusieurs
questions sans un escalier de `si` imbriqués. « Quand le jeu est fermé **et** qu'il est plus de
18 h **et** qu'une sauvegarde existe » tient dans un seul `all` ; un `any` à la place donne un
*ou*. Ce sont eux-mêmes des conditions, donc ils s'imbriquent, et la négation que chaque
condition avait déjà donne le *non*.

Deux comportements à connaître, parce que ce sont ceux qu'on devine mal :

- Un groupe **s'arrête à la première réponse qui tranche**. `all` s'arrête au premier faux,
  `any` au premier vrai — les conditions suivantes ne sont donc jamais évaluées. Ça compte :
  une condition peut lancer une commande ou aller sur le réseau, alors mets la moins chère
  en premier.
- Un `all` **vide est vrai** ; un `any` vide est faux. Ajouter un groupe sans le remplir tout
  de suite ne bloque pas la tâche que tu es en train d'écrire.

## Les conditions — *si*

Une tâche peut porter des conditions pour n'agir que quand l'état est le bon. Chaque condition
peut être **niée** (« *pas* connecté »), et elles servent de deux façons : pour conditionner une
action (`if`), ou pour patienter jusqu'à ce que quelque chose devienne vrai (`waitFor`,
plus bas).

| Condition | Vraie quand |
|---|---|
| `always` | Toujours — le défaut, aucune barrière. |
| `profileActive` | Un profil précis est le profil actif. |
| `modEnabled` · `modDisabled` | Un mod précis est activé / désactivé. |
| `modpackActive` · `modpackInactive` | Tous les mods d'un modpack sont activés / désactivés. |
| `allModsActive` | Tous les mods du profil actif sont activés. |
| `appRunning` · `appNotRunning` | Un processus (par nom) tourne / ne tourne pas. |
| `online` | La machine a une connexion Internet. |
| `dayOfWeek` | Aujourd'hui fait partie des jours choisis. |
| `timeRange` · `timeReached` | L'heure est dans une plage / a dépassé une heure. |
| `fileExists` · `fileHash` · `fileSize` · `fileType` | Vérifications de fichier — un chemin existe, ou son hash (blake3/sha256), sa taille ou son type correspond. |
| `commandSucceeds` | Une commande externe s'exécute et sort avec `0`. |
| `value` | Un nombre capturé se compare à un seuil (plus bas). |
| `all` · `any` | Toutes / au moins une des conditions qu'elle contient sont vraies (plus bas). |

### Les groupes — `all` et `any`

`all` et `any` contiennent une **liste d'autres conditions**, pour qu'une barrière puisse poser
plus d'une question sans un escalier de `if` imbriqués. « Quand le jeu est fermé **et** qu'il
est après 18:00 **et** qu'une sauvegarde existe », c'est un seul `all` ; mets un `any` à la
place pour un *ou*. Ce sont elles-mêmes des conditions, donc elles s'imbriquent, et `negate` —
que chaque condition avait déjà — te donne le *non*.

Deux comportements à connaître, parce que ce sont ceux qu'on se trompe :

- Un groupe **s'arrête à la première réponse qui tranche**. `all` s'arrête au premier faux,
  `any` au premier vrai — les conditions suivantes ne s'exécutent donc pas. Ça compte parce
  qu'une condition peut lancer une commande ou atteindre le réseau : mets la vérification la
  moins coûteuse en premier.
- Un **`all` vide est vrai** ; un `any` vide est faux. Ajouter un groupe sans l'avoir encore
  rempli ne bloque pas la tâche que tu es en train d'écrire.

### La condition `value`

`value` compare un nombre que BMM a capturé plus tôt dans l'exécution — par exemple la vitesse
d'écriture mesurée d'un disque (`disk.write_mbps`) ou un résultat de benchmark
(`benchmark.mbps`) — à un seuil que tu définis, avec l'un de six opérateurs :

`>` · `<` · `>=` · `<=` · `==` · `!=`

« *si `disk.write_mbps` `<` 50, afficher un avertissement* » devient donc une vraie règle. Si la
valeur source n'a jamais été capturée, la condition est simplement fausse — elle ne se
déclenchera pas sur une donnée absente.

## Boucles & attente

Au-delà d'une liste plate d'actions, une tâche peut se ramifier et se répéter :

| Bloc | Rôle |
|---|---|
| **`si`** | Exécute un jeu d'étapes quand une condition tient, un autre (`sinon`) quand elle ne tient pas. |
| **`répéter`** | Exécute ses étapes en boucle — `tant que` une condition tient, `jusqu'à` ce qu'une tienne, ou un nombre fixe de `fois`. `everySec` fixe l'écart entre itérations, et **`maxIters` est un plafond de sécurité strict** pour qu'une boucle `tant que`/`jusqu'à` ne tourne jamais indéfiniment. |
| **`attendre`** | Met en pause jusqu'à ce qu'une condition devienne vraie, en sondant toutes les `pollSec`, jusqu'à `timeoutSec`. Au timeout, elle **abandonne** la tâche ou **continue** quand même — au choix. |
| **`pour chaque`** | Exécute ses étapes une fois **par élément d'une collection vivante** — mods activés, désactivés, tous, profils, modpacks ou thèmes, récupérée au moment de l'exécution. Dans le corps, `{item.id}` / `{item.name}` (n'importe quel champ de l'élément) sont substitués dans chaque paramètre d'action. Même plafond `maxIters` et pause par tour que `répéter`. |
| **`switch`** | Des cas ordonnés, chacun avec sa condition — le **premier** qui correspond s'exécute, sinon la branche `défaut`. Plus propre qu'un escalier de `si` imbriqués. |

`répéter` gagne aussi un mode **`do… while`** : le corps s'exécute D'ABORD, puis la condition
décide d'un autre tour — la boucle post-condition, pour « essaie une fois, continue tant que ça marche ».

L'exemple fourni est un `répéter` en mode `fois` (boucle 3×). Change le mode en
`tant que`/`jusqu'à` avec une condition `Comparaison de valeur` ou `App en cours`, et tu
obtiens des automatisations comme « *continue de vérifier jusqu'à ce que le processus du jeu
sorte, puis exporte mes données* ».

## Contrôles au quotidien

Chaque ligne de tâche porte : un interrupteur **activer/désactiver**, ▶ **Lancer maintenant** (part
tout de suite, en ignorant le déclencheur), **Dupliquer** (la copie est créée **désactivée** pour ne
pas double-partir), **Éditer** et **Supprimer**. Dans le constructeur, **Test** exécute une fois le
brouillon *non enregistré*, et le panneau latéral montre les dernières exécutions (heure · OK/ERR ·
durée). Pendant l'édition, :kbd[Ctrl+Z] / :kbd[Ctrl+Y] annulent et rétablissent, et chaque étape a
son propre bouton *lancer juste cette étape*.

## Partir d'un preset

Une nouvelle tâche s'ouvre avec un **sélecteur de presets** et un bouton **Depuis un
catalogue…**.

Choisir un preset **remplace le brouillon**, donc le sélecteur n'apparaît que sur une tâche
vierge : en choisir un par erreur ne coûte alors rien, puisqu'il n'y avait rien à perdre. La
description s'affiche sous le sélecteur au fil du choix, avant toute application.

| Preset | Ce qu'il construit |
|---|---|
| Sauvegarde hebdomadaire | Exporte vos données BMM chaque lundi matin et le signale |
| Me parler des mises à jour | Vérifie chaque jour, et ne prévient **que** s'il y a quelque chose |
| M'avertir avant que le disque soit plein | Deux fois par jour ; silencieux au-dessus du seuil |
| Rescanner les mods à l'ouverture de BMM | Récupère les changements faits hors de BMM |
| Ranger après la fermeture du jeu | Ménage une fois que vous arrêtez de jouer |
| S'arrêter si le disque est presque plein | Une **garde** à mettre en tête d'une autre tâche — s'arrête *proprement* sous 10 Go |
| Rescanner la bibliothèque chaque matin | Le même rescan, à l'heure plutôt qu'au démarrage |
| Me prévenir quand un serveur ne répond plus | Appelle une adresse toutes les 30 minutes ; ne se manifeste que sur un statut ≠ 200 |
| Partager une valeur avec vos autres tâches | Écrit une variable partagée comme point de départ |

Aucun n'arrive avec une permission déjà accordée. Un preset qui demanderait à exécuter des
scripts avant que vous l'ayez lu vous entraînerait à accorder sans regarder — l'inverse de ce
pour quoi les permissions ont été séparées. Les deux qui touchent à d'autres programmes le
disent dans leur description et laissent la case décochée.

## Les automatisations publiées par d'autres

**Depuis un catalogue…** reste disponible pendant l'édition, parce qu'il n'ouvre jamais qu'un
**rapport en lecture seule** : il n'importe rien.

La fenêtre liste vos sources à gauche, chacune indiquant son propre résultat. Un catalogue
injoignable le dit sur sa ligne : un résultat vide dont la raison est repliée se lit « vous ne
suivez rien », ce qui est autre chose — et plus décourageant — que « le serveur est en panne ».

Le flux officiel vient du registre de liens de BMM : il peut donc être pointé vers un autre
hôte — un serveur de test, un tunnel — sans livrer une nouvelle version de BMM. Les catalogues
communautaires se suivent en collant une adresse dans le même panneau. Tout ce qu'un catalogue
propose passe d'abord par **Inspecter** : vous voyez le déclencheur, les permissions demandées,
tout ce que la tâche atteint hors de BMM, et le texte complet de chaque script et commande
qu'elle transporte, avant de décider.

## Partager un jeu de tâches — `.BMMPA`

**Exporter .BMMPA** écrit tout ton jeu de tâches dans un fichier JSON ; **Importer .BMMPA** charge
celui de quelqu'un d'autre. Chaque ligne de tâche a aussi **son propre** export, qui n'écrit
que celle-là.

Exporter une seule tâche compte plus qu'il n'y paraît : partager une automatisation voulait
dire exporter toutes les autres et supprimer le reste à la main dans un éditeur — c'est ainsi
qu'un chemin privé ou un jeton d'API rangé dans une tâche sans rapport finit dans un fichier
que tu croyais propre. Les deux boutons écrivent la même forme — une tâche est une liste d'une
seule — donc tout ce qui lit un .bmmpa lit l'un comme l'autre.

!!! warning "Une variable partagée voyage avec le fichier"

    Les valeurs écrites avec la portée **Partagée** sont stockées en clair et transportées dans
    un .bmmpa exporté. Si l'une contient un jeton d'API, ce jeton part chez la personne à qui tu
    envoies le fichier. Vérifie avant de partager.

!!! note "Les imports ne partent jamais tout seuls"

    Une tâche importée reçoit un nouvel id, arrive **désactivée**, perd ses quatre autorisations,
    et n'enregistre jamais de tâche au niveau du système. BMM te dit ensuite ce que le fichier
    demandait, pour que tu accordes ce que tu veux vraiment plutôt que de chercher pourquoi une
    tâche importée ne fait rien. **Charger l'exemple** dépose une tâche prête (et désactivée)
    que tu peux décortiquer.

## Publier ton propre catalogue

**Depuis un catalogue… → Publier les miennes…** choisit tes automatisations et écrit un dossier :
un `.bmmpa` signé par automatisation, plus un `catalog.json` à côté. Téléverse le dossier sur
n'importe quel hébergement statique — un dépôt GitHub, GitHub Pages, ton propre serveur — et
donne aux gens l'adresse du `catalog.json`.

Les adresses écrites sont **relatives** (`nightly.bmmpa`, pas une URL complète). Un catalogue
qui nomme son propre hébergeur cesse de fonctionner dès qu'il est déplacé, copié ou forké — la
vie normale d'un dossier sur GitHub — donc BMM les résout par rapport à l'endroit d'où il a
récupéré le catalogue. Une base absolue est proposée pour les fichiers qui vivent vraiment
ailleurs.

Tout ce qu'une automatisation appelle voyage avec elle : sous-tâches, blocs partagés, launch
packs et plugins. Deux automatisations du même nom reçoivent des noms de fichier différents,
pour qu'une entrée ne serve jamais en silence le contenu d'une autre.


## Transporter des valeurs

Une tâche peut retenir des valeurs pendant qu'elle tourne, et les relire par leur nom avec des
`{accolades}`.

**Les variables** contiennent une seule chose. Une étape qui capture une sortie vous donne le
texte et, quand ça y ressemble, le nombre. `Définir une variable` en écrit une vous-même, et sa
**portée** décide de sa durée de vie : *cette exécution seulement*, ou **partagée** — conservée
entre les exécutions et visible par toutes les tâches. La colonne de gauche liste chaque variable
partagée avec sa valeur, pour voir ce qui est déjà pris avant de choisir un nom.

!!! note "Les variables partagées fonctionnent aussi dans les calculs"
    Elles y étaient invisibles : `count + 1` sur un compteur partagé lisait 0 et valait 1 à chaque
    exécution, alors que le même nom se substituait correctement dans un message deux lignes plus
    haut.

**Les listes** en contiennent plusieurs — les profils touchés, les URLs renvoyées par un flux.
`Liste — la définir` accepte un tableau JSON ou une simple ligne `a, b, c` ; `ajouter un élément`
complète. La taille se lit avec `{list.<nom>.length}`, et **Pour chaque** en parcourt une — son
sélecteur de source propose vos propres listes autant que les collections de l'app.

**Les tables** répondent à *quoi va avec quoi* plutôt qu'à *lesquels* — l'id derrière un nom,
l'URL derrière une étiquette. `Table — définir une clé`, `lire une clé dans une variable`,
`la vider`. **Pour chaque** peut parcourir les clés d'une table.

!!! warning "Une clé absente n'est pas une valeur vide"
    `map.get` sur une clé inexistante enregistre une valeur vide et met `map.hit` à 0. Testez
    `map.hit` quand la différence compte — sinon « absente » et « présente et vide » se
    ressemblent exactement.

## Enums, et un Switch qui dit ce que vous avez oublié

Déclarez un **enum** dans la colonne de gauche — un nom et ses valeurs, par exemple
`ok, echec, ignore`. Une condition peut alors tester *la variable vaut le membre X de l'enum E*,
ce qui donne un sujet à la branche au lieu d'une comparaison de texte libre.

Dès que tous les cas d'un **Switch** testent le même enum, le bloc liste les membres non traités.
L'avertissement est consultatif : en traiter trois sur cinq volontairement et laisser DEFAULT
absorber le reste est légitime, donc il ne bloque jamais l'enregistrement.

## Blocs réutilisables

Des étapes écrites une fois et exécutables partout. Construisez-les dans une tâche, nommez-les
dans la colonne de gauche avec **Enregistrer ces étapes**, puis placez **Exécuter un bloc** où
vous en avez besoin.

Un bloc s'exécute **avec les permissions de la tâche appelante**, jamais les siennes. C'est
délibéré : un bloc est écrit une fois et appelé depuis plusieurs endroits, donc des permissions
qui lui seraient attachées seraient accordées à un endroit et dépensées à un autre — et importer
un bloc deviendrait un moyen d'exécuter des actions que la tâche appelante s'est vu refuser.

!!! warning "Deux refus que vous rencontrerez"
    Supprimer un bloc qu'une tâche appelle encore est refusé, et un `Exécuter un bloc` pointant
    vers un nom disparu **arrête la tâche** au lieu de passer en silence. Un appel qui ne fait
    rien discrètement, c'est une tâche qui annonce un succès alors que la moitié n'a jamais
    tourné. Les blocs qui s'appellent entre eux sont plafonnés à 20 niveaux.
