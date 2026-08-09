# Profils


Un profil est une réponse enregistrée à « quels mods sont actifs, dans quel ordre, pour ce
jeu ». C'est l'écran sur lequel tout le reste s'appuie — l'onboarding de BMM l'appelle
lui-même *ton point de départ*.

Son vrai rôle est écrit sur l'écran vide :

> Un profil, c'est votre filet de sécurité : activez, désactivez et réordonnez vos mods
> librement, et une mise à jour ou réinstallation du jeu n'efface plus jamais votre setup.

![L'écran Profils](assets/docs/media/screens/profiles.annotated.png)

| | | |
|---|---|---|
| **1** | **Carte de profil** | Clique pour l'activer. Tout ce que tu actives atterrit ici. |
| **2** | **Dossier du jeu** | Là où ce profil se déploie. Voir l'avertissement ci-dessous. |
| **3** | **Nouveau profil** | Un par *configuration*, pas un par jeu — tu peux en avoir plusieurs. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/profiles.bmmreplay" data-page="features/profiles" data-title="Créer un profil et basculer dessus"></div>


## Pourquoi plusieurs profils pour un même jeu

Parce qu'un profil n'est qu'une fiche légère, et que ses mods vivent déjà dans la Bibliothèque —
en garder quelques-uns ne coûte presque rien. Donne à chacun son **propre dossier de mods** (voir
l'avertissement plus bas) et ils deviennent de vrais loadouts séparés. Un découpage typique :

- **Presque vanilla** — deux ou trois correctifs, pour quand tu veux le vrai jeu.
- **Chargé** — la pile complète, pour quand tu ne veux pas.
- **Test** — là où un nouveau mod atterrit d'abord, pour qu'un mod foireux ne touche jamais
  les deux autres.

Changer de profil ne retélécharge rien : les mods vivent déjà dans la
[Bibliothèque](doc-page:features/library).

## L'erreur qui fait mal : partager un dossier

BMM prévient explicitement, et ça mérite d'être répété.

!!! danger "Deux profils, un seul dossier de jeu"

    D'après l'avertissement de BMM lui-même : partager le même dossier entre plusieurs
    profils est *une source majeure d'erreur humaine*.

    Les deux profils se déploient au même endroit, et aucun ne sait ce que l'autre y a mis.
    Des fichiers survivent au changement de profil, et tu finis par déboguer un mod que tu
    croyais désactivé. Donne à chaque profil son propre dossier, sauf si tu sais exactement
    pourquoi tu fais autrement.

## Les rendre tiens

Chaque profil accepte une **couleur d'accent**, une **icône** (un préréglage ou ta propre
image), et une **image de fond** pour la carte (avec une étape de recadrage pour respecter le
format). Ce n'est pas de la déco gratuite : avec cinq profils, un coup d'œil à une couleur et
une icône va plus vite que lire cinq noms — et se tromper de profil est précisément l'erreur
que cet écran existe pour éviter. Donne à ton profil *Test* risqué une couleur que tu ne
confondras jamais avec ton profil principal.

## Ton premier profil

Dès sa création, BMM te dit ce qui vient de changer :

> Ton premier profil est prêt ! Tout ce que tu actives désormais est enregistré ici — à
> l'abri des mises à jour et des réinstallations.

C'est le contrat. À partir de là, [ajoute un mod](doc-page:features/library) et active-le.

## Emmener un profil ailleurs

Il n'y a pas de bouton « exporter ce profil », et c'est voulu : un profil est un *choix*
(quels mods, dans quel ordre, pointés vers quel dossier), pas un paquet. Trois choses portent
ce choix, et laquelle tu veux dépend de qui est en face :

| Tu veux | Utilise | Ce qui voyage |
|---|---|---|
| Donner la même config à quelqu'un qui a déjà les mods | Une [liste `.MM`](doc-page:features/modlist) | Les noms, versions et l'ordre — un fichier texte, quelques Ko |
| Donner la même config, mods compris | Un [modpack](doc-page:features/modpacks) | La liste *et* les fichiers |
| Garder la même config pour un groupe, et la tenir à jour | Un [dépôt serveur](doc-page:features/repo) | Tout, plus chaque changement ultérieur |
| Déplacer tout ton BMM sur une autre machine | **Paramètres → Exporter les données** | Profils, mods scannés, tags, réglages, plugins — ce que tu coches |

**Paramètres → Exporter les données** est celui qu'on rate. Il écrit un seul fichier, et chaque
partie a son interrupteur : profils, mods, tags, réglages, plugins. L'import relit le même
fichier. C'est une *sauvegarde*, pas un partage : il embarque tes chemins, qui ne
correspondront pas sur une autre machine.

!!! tip "Tu viens d'un autre gestionnaire"
    BMM importe directement les profils d'**OpenModManager** et d'**OVGME**, tu n'as donc pas à
    les refaire à la main. Il lit leurs fichiers de profil et crée les profils BMM équivalents.

## Le journal d'activité

Chaque profil tient son propre relevé de ce qui a été fait à ses mods. Il s'ouvre depuis la
Bibliothèque.

| Il enregistre | Il n'enregistre pas |
|---|---|
| L'activation d'un mod, et si des dépendances ont suivi | Ce que tu as fait sur un *autre* profil |
| Sa désactivation | La lecture, la recherche, le lancement du jeu |
| Sa suppression | Le détail fichier par fichier de ce qui a été écrit |
| Sa modification, avec ce qui a changé | |

Chaque entrée est un mod, une action, un horodatage. Il répond bien à une seule question :
*quand ce profil a-t-il changé pour la dernière fois, et en quoi ?* — celle que tu poses
vraiment quand un jeu qui marchait hier ne marche plus aujourd'hui.

Deux choses à savoir, parce qu'aucune des deux n'est évidente :

- **Le journal vit à côté des sauvegardes du profil**, dans son dossier de backup. Si celui-ci
  est sur un disque externe et que le disque est débranché, le journal est indisponible jusqu'à
  son retour — la même règle que les sauvegardes elles-mêmes.
- **Les vieilles entrées sont purgées à l'ouverture** du journal, pas par une tâche de fond. La
  durée de rétention est un réglage ; ce qui la dépasse disparaît à la prochaine lecture, donc
  un profil que tu n'ouvres jamais garde son historique jusqu'à ce que tu le regardes.

Tu peux vider le journal d'un profil, et ça ne vide que celui-là.
