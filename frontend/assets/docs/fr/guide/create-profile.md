# Créer un profil

Un profil est la configuration d'un jeu : quels mods sont activés, dans quel ordre, et quels dossiers ils utilisent. Tu en crées un pour qu'une mise à jour du jeu ou une réinstallation n'efface plus jamais ce que tu as construit.

[Montre-moi](show:view/profiles) [S'entraîner avec le tutoriel](show:tutorial/basics/profiles/s1)

**Il te faut :** le dossier du jeu (là où il garde les fichiers que les mods remplacent), et deux dossiers vides de ton choix : un pour les mods de ce profil, un pour ses sauvegardes.

![Créer un profil pour le jeu](assets/docs/media/gifs/guide-create-profile.gif)

:::note[Pourquoi trois dossiers]
La **destination** est le dossier du jeu, le seul endroit où BMM écrit des mods. Le **dossier des mods** contient les mods de ce profil. Le **dossier de sauvegarde** garde les fichiers d'origine du jeu et le journal d'activité. Les séparer est ce qui rend sûrs le changement de profil et l'annulation.
:::

## Étapes

- [ ] **Ouvre Profils.** Clique sur **Profils** dans la barre latérale. *Tu vois :* un écran vide qui dit que tu n'as pas de profil actif, ou tes profils existants en cartes.
- [ ] **Appuie sur Nouveau profil.** Le bouton est en haut à droite. *Tu vois :* une fenêtre avec **Nom du profil**, **Nom du jeu**, trois dossiers et une couleur.
- [ ] **Nomme-le d'après le jeu.** Par exemple *Partie principale* avec le jeu *Northwind Saga*. Ajoute une couleur et une icône si tu veux : avec cinq profils, une couleur se lit plus vite qu'un nom.
- [ ] **Choisis le dossier de destination.** Appuie sur **Parcourir** à côté de **Dossier de destination** et choisis le dossier du jeu. *Tu vois :* le chemin dans le champ, et BMM peut proposer des dossiers trouvés pour le jeu.
- [ ] **Choisis un dossier des mods, et un dossier de sauvegarde.** Utilise un **dossier des mods différent pour chaque profil**. Le dossier de sauvegarde est facultatif mais recommandé. *Tu vois :* un avertissement si un autre profil utilise déjà le dossier choisi. Prends-le au sérieux.
- [ ] **Appuie sur Créer.** *Tu vois :* la carte du profil, marquée **Actif**, et un message qui dit que ton premier profil est prêt. **Créer** reste grisé tant que le dossier du jeu et le dossier des mods ne sont pas remplis.

## Si ça ne marche pas

| Tu vois | Fais ceci |
|---|---|
| Un avertissement de dossier partagé | Choisis un autre dossier des mods. Deux profils dans un même dossier, c'est comme ça qu'on finit par déboguer un mod qu'on croyait désactivé. |
| Tu viens d'OvGME ou d'Open Mod Manager | Importe leurs profils depuis le même écran plutôt que de les refaire. |
| Les dossiers sont sur un disque externe | Garde ce disque branché tant que tu utilises le profil : BMM enregistre les chemins avec la lettre du lecteur. |

:::tip[Plusieurs profils, ça ne coûte presque rien]
Garde un profil *Quasi vanilla*, un *Lourd* et un *Test*. Un nouveau mod va d'abord dans *Test*, donc un mod défectueux ne touche jamais les deux autres. Les mods vivent dans la Bibliothèque et sont partagés : rien n'est téléchargé deux fois.
:::

## Ensuite

[Installer ton premier mod](doc-page:guide/install-first-mod). Pour donner une configuration à un ami : [Partager un modpack](doc-page:guide/share-a-modpack).
Détails : [Profils](doc-page:features/profiles).
