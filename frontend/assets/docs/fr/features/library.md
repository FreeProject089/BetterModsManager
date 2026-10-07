# Bibliothèque


La **Bibliothèque**, c'est là que vit chacun de tes mods — installé ou non, quelle que soit
sa provenance. Si tu ne devais apprendre qu'un seul écran de BMM, prends celui-là : tout le
reste (profils, modpacks, listes) n'est qu'une façon différente d'organiser ce qu'elle
contient.

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/library.bmmreplay" data-page="features/library" data-title="Ajouter un mod et l'activer"></div>


## Ajouter ton premier mod

=== "Depuis un fichier"

    L'écran Bibliothèque ouvert, glisse un `.zip` (ou `.rar`, `.7z`, `.tar`…) ou un dossier
    de mod sur la fenêtre. La boîte **Ajouter un mod** s'ouvre pré-remplie — le chemin posé,
    le nom repris du fichier — il ne reste qu'à confirmer. Le mod est ajouté au dossier mods
    du **profil actif**.

=== "Depuis un dépôt"

    Voir [Dépôt Serveur](doc-page:features/repo). Un dépôt est une source partagée : connecte-le,
    **synchronise**, et les mods synchronisés atterrissent dans un profil (dédié, ou un que
    tu choisis) puis apparaissent ici à côté des tiens.
    <!-- On lie vers `repo.md`, pas `repo.fr.md` : avec docs_structure: suffix, l'i18n
         résout le lien vers la version FR si elle existe, et retombe sur l'EN sinon. -->


!!! tip "Un mod archivé reste archivé"

    Un `.zip` reste zippé. BMM ne l'extrait dans un cache temporaire que lorsque quelque
    chose a réellement besoin des fichiers — une grosse bibliothèque ne te coûte donc pas
    d'espace disque que tu n'utilises pas.

<a id="conflicts"></a>
## Les conflits
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

Pour le changer, ouvre l'**ordre d'activation** du profil (l'icône de liste sur sa carte, ou
`Ctrl+K` → **Ordre d'activation**) et glisse les mods : chaque ligne dit quels fichiers elle écrase
et lesquels des siens sont écrasés, et **Appliquer l'ordre** ne recopie que les fichiers qui changent
de main. Voir [Ordre d'activation](doc-page:how-it-works/load-order).

Depuis la bibliothèque elle-même : le panneau de détail d'un mod montre sa **position** et qui il
écrase, avec les boutons En haut / Monter / Descendre / En bas ; clic droit sur une carte pour les
mêmes déplacements ; `Alt+↑` / `Alt+↓` déplacent le mod sélectionné ; et l'icône de liste à côté du
menu de tri ouvre l'ordre complet. Un déplacement depuis la bibliothèque s'applique tout de suite.

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
[profil](doc-page:features/profiles). C'est la distinction sur laquelle butent les débutants :
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

## Pendant que des mods s'activent ou se désactivent

Activer ou désactiver un mod est une tâche de fond qui appartient à BMM, pas à l'écran
Bibliothèque. Tu peux aller n'importe où dans l'app pendant qu'elle tourne ; seul un **Annuler**
explicite l'arrête.

- **La pastille d'activité** dans la barre de titre montre le mod en cours de copie, où il en est
  dans son lot (`3/12`), les octets déjà copiés, combien de mods attendent, et un bouton
  **Annuler**. Elle apparaît sur toutes les vues et suit aussi les lots lancés ailleurs (Tout
  activer, une liste d'ordre).
- **Les cartes** passent par leurs états : *En attente*, puis *Copie 45 %* avec une fine barre en
  bas, puis *Activé* (un bref halo, et le numéro d'ordre d'activation apparaît) ou *Échec*. La
  désactivation suit le même chemin, en ambre, et finit sur *Désactivé*.
- **Plusieurs bascules d'affilée** se mettent en file et passent l'une après l'autre, dans l'ordre
  de tes clics.
- **Annuler** défait le mod en cours (sa copie partielle est revertie), laisse tels quels les mods
  déjà faits, et ne lance pas ceux qui attendent encore.
- Un **toast de résumé** à la fin dit combien sont passés et nomme ceux qui ont échoué.

L'animation suit **Paramètres › Graphismes et affichage › Réduire les animations** et le réglage Windows
« afficher moins d'animations » : les états restent visibles, ils ne bougent simplement plus.

Il n'y a pas de multi-sélection dans la liste elle-même — tu prends un mod à la fois. Quand tu
as besoin d'un lot (construire un [modpack](doc-page:features/modpacks), ou importer une [liste
`.MM`](doc-page:features/modlist)), le modal de sélection te donne des cases à cocher et un tout-sélectionner.
Détail complet dans [Astuces & contrôles](doc-page:reference/tips).
