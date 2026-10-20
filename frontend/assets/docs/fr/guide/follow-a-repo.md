# Suivre un dépôt

Un ami ou une communauté héberge un dépôt. Tu vas le synchroniser une fois dans un profil, puis le suivre pour que BMM te prévienne, ou mette à jour pour toi, quand il change.

[Montre-moi](show:view/repo) [S'entraîner : synchroniser](show:tutorial/advanced/repo) [S'entraîner : le suivre](show:tutorial/advanced/follow)

**Il te faut :** l'adresse du dépôt (une adresse web, ou une IP et un port comme `192.168.1.20:8000`), et son mot de passe ou sa clé s'il est protégé.

![Rejoindre un dépôt par son adresse](assets/docs/media/gifs/guide-friend-joins.gif)

:::note[Pourquoi suivre plutôt que synchroniser à la main]
Une synchro ne télécharge que les fichiers qui ont changé : mettre à jour un gros dépôt après un petit correctif coûte quelques mégaoctets. Suivre confie la vérification à BMM, selon un rythme, et il ne télécharge ni n'applique jamais rien pendant qu'un jeu tourne.
:::

## La synchroniser une fois

- [ ] **Ouvre Dépôt Serveur** et reste sur l'onglet **Se synchroniser**.
- [ ] **Colle l'adresse et appuie sur Récupérer.** Le champ est **URL de repo.json** ; une adresse nue comme `192.168.1.20:8000` suffit. *Tu vois :* la carte du dépôt : nom, version, signature (*Signé, signature valide* est ce que tu veux) et combien de mods il propose. S'il est protégé, tape le mot de passe de téléchargement dans la ligne sous le champ avant de récupérer.
- [ ] **Choisis où vont les mods.** Les dossiers du jeu, des mods et de sauvegarde du profil, ou des dossiers de ton choix. *Tu vois :* les trois chemins.

![Choisir les dossiers et synchroniser](assets/docs/media/gifs/guide-friend-syncs.gif)

- [ ] **Appuie sur Synchroniser** (le bouton **Synchroniser** du haut fait pareil). *Tu vois :* la progression dans le centre d'activité. Les mods du dépôt apparaissent dans ta Bibliothèque, marqués du nom du dépôt.

## Le suivre

- [ ] **Appuie sur Suivre un dépôt** dans la carte **Dépôts suivis**, ou sur le bouton **Suivre** à côté d'un dépôt que tu viens de récupérer. *Tu vois :* une fenêtre avec l'adresse déjà remplie.
- [ ] **Appuie sur Tester la connexion.** *Tu vois :* le nom, la version et la signature du dépôt. Une signature qui ne correspond pas veut dire que le manifeste a été modifié après sa signature : ne le suis que si tu sais pourquoi.
- [ ] **Choisis le rythme.** Vérifier toutes les 15 minutes, heures, 6 heures, jours ou semaines, et quoi faire lors d'une mise à jour : **Me prévenir** (par défaut), **La télécharger**, ou **La télécharger et l'appliquer**.
- [ ] **Appuie sur Suivre.** *Tu vois :* le dépôt dans la liste des dépôts suivis. **Vérifier maintenant** vérifie tous les dépôts suivis d'un coup.

:::tip[Commence par Me prévenir]
**La télécharger et l'appliquer** désactive puis réactive les mods activés du profil actif pour que le jeu reçoive les nouveaux fichiers. Utilise-le quand tu fais confiance au propriétaire du dépôt.
:::

## Si ça ne marche pas

| Tu vois | Fais ceci |
|---|---|
| Rien ne répond à l'adresse | Vérifie l'adresse, le port et que le BMM de l'hôte tourne. |
| Il demande un mot de passe | Tape le mot de passe de téléchargement. Il est enregistré scellé sur ce PC, jamais dans un fichier de réglages. |
| *La signature ne correspond PAS* | Arrête. Demande au propriétaire. Ne synchronise pas avant de savoir pourquoi. |
| Une mise à jour attend et n'arrive jamais | BMM ne touche aux fichiers pendant qu'un jeu tourne. Ferme le jeu et appuie sur **Vérifier maintenant**. |

## Ensuite

[Mettre BMM à jour](doc-page:guide/update-bmm) garde l'application elle-même à jour. Détails : [Dépôt Serveur](doc-page:features/repo), [Comment fonctionne la synchro](doc-page:how-it-works/sync-repos).

<div class="bmm-replay" data-src="assets/docs/media/replays/share-setup.bmmreplay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/share-setup.bmmreplay" data-page="guide/follow-a-repo" data-title="Regarde : rejoindre, synchroniser et suivre, puis la mise à jour suivante arrive"></div>
