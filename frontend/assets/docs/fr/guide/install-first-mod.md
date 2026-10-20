# Installer ton premier mod

Tu vas ajouter un mod à BMM, l'activer pour un profil, et vérifier qu'il est arrivé dans le dossier du jeu.

[Montre-moi](show:view/library) [S'entraîner avec le tutoriel](show:tutorial/basics/scan/s0)

**Il te faut :** BMM installé, un profil ([crée-en un d'abord](doc-page:guide/create-profile) si l'écran Profils est vide), et un mod en `.zip`, `.rar`, `.7z` ou un simple dossier.

![Ajouter un mod depuis son archive](assets/docs/media/gifs/guide-add-mods.gif)

:::note[Pourquoi on ajoute un mod avant de l'activer]
BMM range tes mods sur une étagère, la **Bibliothèque**, et un profil décide lesquels sont activés.
Ajouter un mod le met seulement sur l'étagère : le dossier du jeu n'est pas touché tant que tu ne l'actives pas.
:::

## Étapes

- [ ] **Ouvre la Bibliothèque.** Clique sur **Bibliothèque** dans la barre latérale. *Tu vois :* tes mods en cartes, ou une étagère vide sur une nouvelle installation.
- [ ] **Glisse le mod sur la fenêtre**, ou appuie sur **Ajouter un mod**. Un `.zip` (ou `.rar`, `.7z`, un dossier) convient : avec le bouton, choisis **Dossier** ou **Archive**. *Tu vois :* la fenêtre **Ajouter un mod**, remplie avec le chemin et un nom tiré du fichier, et une ligne qui dit que rien n'atteint le jeu tant que tu ne l'actives pas.
- [ ] **Confirme.** Vérifie le nom, la version et l'auteur, puis appuie sur **Ajouter un mod**. *Tu vois :* une nouvelle carte dans la Bibliothèque, désactivée, rangée dans le dossier des mods du profil actif.
- [ ] **Clique une fois sur la carte.** *Tu vois :* les détails du mod s'ouvrent dans un tiroir sur le côté : version, auteur, description, fichiers.
- [ ] **Active-le.** Appuie sur l'interrupteur de la carte, ou double-clique la carte. *Tu vois :* la carte passe par *En attente*, puis *Copie*, puis **Activé**, et la pastille d'activité dans la barre de titre compte les fichiers.

![Active le mod et regarde la carte changer](assets/docs/media/gifs/guide-enable.gif)

- [ ] **Vérifie le résultat.** Ouvre les détails du mod et regarde l'onglet **Fichiers**, et le bouclier d'intégrité sur la carte. *Tu vois :* pas de bouclier rouge. Un bouclier rouge veut dire qu'un fichier manque ou a changé.

## Si ça ne marche pas

| Tu vois | Fais ceci |
|---|---|
| La fenêtre ne s'ouvre pas quand tu déposes le fichier | Vérifie que l'écran **Bibliothèque** est bien affiché, puis dépose-le à nouveau. |
| La carte indique *Échec* | Ouvre le centre d'activité (le bouton de la barre de titre) pour la raison. La plus courante : un dossier de jeu en lecture seule ou en cours d'utilisation. |
| Il est activé, mais le jeu n'a pas changé | Les fichiers sont probablement au mauvais endroit dans le mod. Voir [Réparer un mod que le jeu ignore](doc-page:guide/fix-a-mod). |
| Un avertissement dit que le mod écrase des fichiers d'un autre | C'est un conflit, et BMM t'a arrêté exprès. Voir [Régler un conflit](doc-page:guide/fix-a-conflict). |

:::tip[Les archives restent des archives]
Un `.zip` reste zippé. BMM le décompresse dans un cache temporaire seulement quand quelque chose a besoin de ses fichiers, donc une grosse bibliothèque ne coûte pas d'espace disque inutile.
:::

## Ensuite

[Activer et ordonner les mods](doc-page:guide/activate-and-order), puis [Régler un conflit](doc-page:guide/fix-a-conflict) quand deux mods se rencontrent.
Détails de l'écran : [Bibliothèque](doc-page:features/library).

<div class="bmm-replay" data-src="assets/docs/media/replays/new-game.bmmreplay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/new-game.bmmreplay" data-page="guide/install-first-mod" data-title="Regarde toute l'histoire : un nouveau jeu, du premier mod au dossier du jeu"></div>
