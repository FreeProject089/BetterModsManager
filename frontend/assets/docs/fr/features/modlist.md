# Listes .MM

Un fichier `.MM`, c'est ta **configuration complète, écrite** — et contrairement à un
[modpack](doc-page:features/modpacks), il embarque les liens de téléchargement : la personne qui le reçoit
n'a pas besoin de posséder les mods au préalable.

La définition de BMM lui-même :

> Un fichier JSON contenant votre liste complète de mods, liens de téléchargement, ordre
> d'installation et configuration.

Toute la différence est là. Un modpack dit *quels mods* ; une liste `.MM` dit *quels mods,
où les prendre, et dans quel ordre*.

![L'écran Listes .MM](assets/docs/media/screens/modlist.annotated.png)

| | | |
|---|---|---|
| **1** | **Exporter** | Écrit le fichier `.MM`. |
| **2** | **Importer** | En lit un, puis télécharge et installe. |
| **3** | **Profil auto** | Génère un profil dédié pour la liste importée. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/modlist.bmmreplay" data-page="features/modlist" data-title="Exporter et importer une liste .MM"></div>


## Le partage

> Envoie ton fichier `.MM` à d'autres utilisateurs pour reproduire exactement ta
> configuration.

*Exactement* est le mot qui compte, et c'est pourquoi l'ordre voyage avec la liste : les
mods forment un tableau JSON, et un `.MM` reproduit cette séquence de l'autre côté. Deux
personnes avec les mêmes mods dans un ordre d'activation différent n'ont **pas** le même
jeu — voir [les conflits](doc-page:features/library#conflicts).

!!! note "Ce qu'un `.MM` ne transporte pas"
    Les *règles* de conflit ne font pas partie du format. Un `.MM` enregistre l'arborescence
    de fichiers et les notes d'installation de chaque mod, si bien que le BMM qui le reçoit
    détecte les mêmes recouvrements que vous — mais les décisions que vous avez prises à leur
    sujet restent sur votre machine.

### Inclure les hashes ?

Une option d'export, et un vrai compromis, dans les mots de BMM :

> Vérifiable par les destinataires — plus lent pour les gros mods.

Inclus-les quand l'exactitude compte (tu publies une liste, ou tu débogues celle de
quelqu'un). Passe-t'en pour un envoi rapide à un ami avec une bonne connexion.

## L'import

BMM récupère les archives et les extrait (*Installation en cours…*), puis respecte l'ordre
porté par la liste. Coche **profil auto** et il construit un [profil](doc-page:features/profiles) dédié
plutôt que de tout mélanger à ta configuration actuelle — ce qui est presque toujours ce
qu'on veut en essayant la config de quelqu'un d'autre.

## Ce qui voyage réellement dans un `.MM`

C'est un seul fichier JSON. À côté des métadonnées de la liste (nom, jeu, auteur, date),
chaque mod porte tout le nécessaire pour le reproduire :

| Par mod | À quoi ça sert |
|---|---|
| **Liens de téléchargement** | Une ou plusieurs URL — étiquetées `github`, `google_drive`, `direct`, `mega`, ou `other` — pour que le destinataire récupère le mod sans le posséder d'abord. |
| **Arbre de fichiers** | La disposition des fichiers du mod (chemins et tailles), et des **hachages** par fichier optionnels. C'est ce qui alimente la vérification et ce que BMM compare pour trouver les [conflits](doc-page:features/library#conflicts). |
| **Notes d'installation** | Les instructions de placement ou de configuration attachées par l'auteur. |
| **Ordre** | La place du mod dans la liste. |

!!! note "« Règles de conflit » = l'ordre"

    Un `.MM` ne porte pas de règlement séparé pour les conflits. Ce qu'il porte, c'est
    l'**ordre**, et l'ordre *est* la résolution : quand deux mods livrent le même fichier,
    celui activé en dernier gagne (voir [conflits](doc-page:features/library#conflicts)). Reproduire « à
    l'identique » la config de quelqu'un, c'est reproduire son ordre — ce que fait justement
    l'import d'un `.MM`.
