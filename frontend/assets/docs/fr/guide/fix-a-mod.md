# Réparer un mod que le jeu ignore

Le mod est activé, BMM dit qu'il est installé, et le jeu se comporte comme s'il n'était pas là. Neuf fois sur dix, les fichiers du mod sont un dossier trop profond. Le Mapper te montre où ils atterriraient, et te laisse les déplacer.

[Montre-moi](show:view/mapper) [S'entraîner avec le tutoriel](show:tutorial/basics/map)

**Il te faut :** le mod déjà dans ta Bibliothèque, et sa cible en tête : le dossier du jeu où un fichier doit finir.

![Voir où les fichiers du mod atterriraient](assets/docs/media/gifs/guide-see-problem.gif)

:::note[Pourquoi ça arrive]
L'auteur d'un mod emballe son zip comme il veut. Si l'archive enveloppe tout dans un dossier en plus, les fichiers atterrissent dans `Jeu/Enveloppe/Data/...` au lieu de `Jeu/Data/...`, et le jeu ne regarde jamais là. BMM a copié exactement ce que le mod contenait, et c'est le problème.
:::

## Étapes

- [ ] **Ouvre le Mapper.** Clique sur **Mapper** dans la barre latérale et choisis le mod dans **Structure du Mod**. *Tu vois :* les dossiers du mod à gauche, et à droite le **Dossier de destination** : l'arborescence propre au jeu.
- [ ] **Trouve le premier dossier que le jeu connaît.** Pour beaucoup de jeux, c'est `Data`, `Mods` ou `Assets`. *Tu vois :* il se trouve un ou deux niveaux sous le haut du mod, dans un dossier enveloppe.
- [ ] **Fais-en la racine.** Sélectionne ce dossier et dépose-le sur la racine du jeu dans la destination (elle est marquée **Racine**). *Tu vois :* une note qui dit que le dossier est en attente comme racine, et le bouton **Appliquer structure** s'allume.
- [ ] **Lis l'Aperçu final.** Appuie sur **Aperçu final**, ou sur **Appliquer structure**. *Tu vois :* l'arbre des fichiers qui seront écrits, le nombre de fichiers déplacés et écrasés, et un avertissement si certains remplacent des fichiers du jeu (ils sont sauvegardés d'abord).

![Remonter Data jusqu'au dossier du jeu](assets/docs/media/gifs/guide-move-root.gif)

- [ ] **Appuie sur Appliquer.** *Tu vois :* la copie du mod réécrite dans la nouvelle forme. Supprime le dossier enveloppe s'il en reste un, vide.
- [ ] **Désactive puis réactive le mod.** *Tu vois :* la carte recopie ses fichiers aux nouveaux endroits.
- [ ] **Vérifie les fichiers.** Calcule les empreintes du mod et regarde le bouclier d'intégrité. *Tu vois :* pas de bouclier rouge.

![Vérifier le résultat](assets/docs/media/gifs/guide-verify.gif)

:::warning[Déplacer des fichiers modifie le mod]
Le Mapper modifie la copie que BMM garde, pas le dossier du jeu. Si le mod est mis à jour plus tard depuis un dépôt, revérifie sa forme : une mise à jour ramène les dossiers de l'auteur.
:::

## Si ça ne marche pas

| Tu vois | Fais ceci |
|---|---|
| La forme semble bonne mais rien ne change | Vérifie que le mod n'est pas en conflit avec un autre qui écrase les mêmes fichiers : [Régler un conflit](doc-page:guide/fix-a-conflict). |
| Tu ne sais pas quel dossier le jeu lit | Ouvre un autre mod qui marche et copie sa forme. |
| Le bouclier devient rouge après le déplacement | Recalcule les empreintes : l'empreinte du mod était celle de l'ancienne forme. |

## Ensuite

Remplis les détails du mod (nom, version, auteur) pour le retrouver plus tard. Détails : [Mapper](doc-page:features/mapper), [Comment fonctionne le Mapper](doc-page:how-it-works/mapper).
