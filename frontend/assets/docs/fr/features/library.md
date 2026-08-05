# Bibliothèque


La **Bibliothèque**, c'est là que vit chacun de tes mods — installé ou non, quelle que soit
sa provenance. Si tu ne devais apprendre qu'un seul écran de BMM, prends celui-là : tout le
reste (profils, modpacks, listes) n'est qu'une façon différente d'organiser ce qu'elle
contient.

![L'écran Bibliothèque](../assets/screens/library.annotated.png)

| | | |
|---|---|---|
| **1** | **Recherche** | Filtre à la frappe, sur les noms, les auteurs et les tags. |
| **2** | **Filtres** | Restreint par jeu, catégorie ou état d'installation. |
| **3** | **Installer** | Ajoute le mod sélectionné au profil sur lequel tu es. |

<div class="bmm-replay"
     data-src="../assets/replays/library.bmmreplay"
     data-title="La Bibliothèque en action (clip placeholder)"></div>

*Enregistrement placeholder — un clip ciblé de cet écran le remplacera.*

## Ajouter ton premier mod

=== "Depuis un fichier"

    Glisse un `.zip` ou un dossier de mod n'importe où sur la fenêtre. BMM le lit, déduit à
    quel jeu il appartient et le range — sans boîte de dialogue.

=== "Depuis un dépôt"

    Voir [Dépôt Serveur](doc-page:repo). Un dépôt est une source partagée ; une fois ajouté,
    ses mods apparaissent ici à côté des tiens, marqués du nom du dépôt.
    <!-- On lie vers `repo.md`, pas `repo.fr.md` : avec docs_structure: suffix, l'i18n
         résout le lien vers la version FR si elle existe, et retombe sur l'EN sinon. -->


!!! tip "Un mod archivé reste archivé"

    Un `.zip` reste zippé. BMM ne l'extrait dans un cache temporaire que lorsque quelque
    chose a réellement besoin des fichiers — une grosse bibliothèque ne te coûte donc pas
    d'espace disque que tu n'utilises pas.

## Les conflits {#conflicts}

Deux mods qui livrent le **même fichier** sont en conflit. Ce n'est un bug ni de l'un ni de
l'autre — c'est ce qui arrive quand deux personnes modifient la même chose — et le travail de
BMM est de te le faire savoir *avant* que tu valides, pas après que le jeu a cassé.

Quand tu actives un mod qui en recouvre un autre, BMM s'arrête et annonce :

> Activer ce mod va écraser des fichiers des mods suivants.

Tu obtiens ensuite le détail, pas juste un avertissement : **Fichiers en conflit** liste les
chemins exacts présents dans les deux mods, car *ces fichiers existent dans les deux mods et
créent un conflit direct*.

### La règle

**Le dernier mod activé gagne.** Sa version du fichier partagé écrase celle de l'autre. C'est
pour ça que l'**ordre d'activation** compte et que BMM te laisse le fixer : l'ordre *est* la
résolution. Deux personnes avec les mêmes mods dans un ordre différent n'ont pas le même jeu.

### Vue globale des conflits

Plutôt que de découvrir les conflits un par un, la vue globale montre d'un coup tous les
chevauchements du profil courant. À regarder après un gros import : une liste `.MM` ou un
modpack peuvent amener une douzaine de mods qui ne se sont jamais croisés.

### Mods liés

À distinguer des conflits, et facile à confondre :

> Les mods suivants sont liés à celui-ci et pourraient être désactivés.

C'est une dépendance, pas un chevauchement. BMM demande au lieu de désactiver en cascade en
silence — si tu coupes un mod sur lequel d'autres s'appuient, tu choisis s'ils tombent avec.

## Ce que « installé » veut dire ici

Un mod dans la Bibliothèque est *disponible* ; un mod n'est *installé* que par rapport à un
[profil](doc-page:profiles). C'est la distinction sur laquelle butent les débutants :
désinstaller depuis un profil ne supprime pas le mod, ça arrête juste ce profil de
l'utiliser. Le mod reste en Bibliothèque, prêt pour un autre profil.

## Contrôles à connaître

La Bibliothèque récompense quelques gestes :

- **Clic simple** sur une carte pour la sélectionner et ouvrir son **panneau détail** —
  version, auteur, identité cross-machine, conflits, dépendances, vérification d'intégrité, et
  tags.
- **Double-clic** sur une carte pour l'activer ou la désactiver instantanément.
- **Clic droit** sur une carte *pendant son activation* pour annuler l'opération.
- **Glisser-déposer** un `.zip` ou un dossier sur la fenêtre pour l'ajouter.

Il n'y a pas de multi-sélection dans la liste elle-même — tu prends un mod à la fois. Quand tu
as besoin d'un lot (construire un [modpack](doc-page:modpacks), ou importer une [liste
`.MM`](doc-page:modlist)), le modal de sélection te donne des cases à cocher et un tout-sélectionner.
Détail complet dans [Astuces & contrôles](doc-page:../reference/tips).
