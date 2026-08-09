# Planification & automatisation


> Planifiez des actions BMM (ponctuelles ou récurrentes) — activer un mod, un modpack, un
> profil… avec conditions (si/sinon) et commandes personnalisées. Les tâches s’exécutent tant
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

## Les commandes personnalisées

> Autoriser les commandes personnalisées.

Désactivé par défaut, et à raison : une tâche planifiée capable d'exécuter n'importe quelle
commande est une tâche capable de tout, à une heure où tu ne regardes pas. Active-la quand tu
en as besoin, et sache ce que fait la commande.

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

## Boucles & attente

Au-delà d'une liste plate d'actions, une tâche peut se ramifier et se répéter :

| Bloc | Rôle |
|---|---|
| **`si`** | Exécute un jeu d'étapes quand une condition tient, un autre (`sinon`) quand elle ne tient pas. |
| **`répéter`** | Exécute ses étapes en boucle — `tant que` une condition tient, `jusqu'à` ce qu'une tienne, ou un nombre fixe de `fois`. `everySec` fixe l'écart entre itérations, et **`maxIters` est un plafond de sécurité strict** pour qu'une boucle `tant que`/`jusqu'à` ne tourne jamais indéfiniment. |
| **`attendre`** | Met en pause jusqu'à ce qu'une condition devienne vraie, en sondant toutes les `pollSec`, jusqu'à `timeoutSec`. Au timeout, elle **abandonne** la tâche ou **continue** quand même — au choix. |

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

## Partager un jeu de tâches — `.BMMPA`

**Exporter .BMMPA** écrit tout ton jeu de tâches dans un fichier JSON ; **Importer .BMMPA** charge
celui de quelqu'un d'autre.

!!! note "Les imports ne partent jamais tout seuls"

    Les tâches importées reçoivent de nouveaux ids et *Exécuter même quand BMM est fermé* est forcé à
    **off**, pour qu'importer un fichier n'enregistre pas silencieusement des tâches au niveau du
    système. Relis-les et active-les toi-même. **Charger l'exemple** dépose une tâche prête (et
    désactivée) que tu peux décortiquer.
