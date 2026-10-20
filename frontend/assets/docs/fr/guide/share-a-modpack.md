# Partager un modpack

Tu vas transformer tes mods en un seul pack, et donner la même configuration à des amis : soit un fichier qu'ils importent, soit un dépôt qu'ils suivent.

[Montre-moi](show:view/modpacks) [S'entraîner avec le tutoriel](show:tutorial/basics/modpacks)

**Il te faut :** un profil avec les mods à partager, activés et fonctionnels.

![Faire un modpack depuis le profil](assets/docs/media/gifs/guide-make-modpack.gif)

:::note[Un pack transporte une signature, pas les mods]
Quand tu exportes un pack, BMM envoie l'empreinte de chaque mod. Le BMM de l'autre PC retrouve les mêmes mods grâce à cette empreinte : le fichier reste petit, et « le même mod » veut dire identique à l'octet près. Les mods que l'ami n'a pas sont listés, jamais appliqués à moitié.
:::

## Faire le pack

- [ ] **Ouvre Modpacks** et appuie sur **Créer un Modpack**. *Tu vois :* la fenêtre **Nouveau Modpack** en quatre étapes : Bases, Mods, Options, Revue.
- [ ] **Bases.** Donne-lui un nom, et au besoin un jeu cible et une description. **Suivant** continue ; **Créer maintenant** garde les valeurs par défaut et saute le reste.
- [ ] **Mods.** Choisis les mods, ou utilise le raccourci **Activés maintenant**. *Tu vois :* les mods non installés sur ce PC signalés.
- [ ] **Options.** Pour un pack qui quitte ta machine, mets **Mode des dépendances** sur **Toutes** pour qu'il emporte ses dépendances. Laisse **Ignorer la vérification d'intégrité** désactivé.
- [ ] **Revue et création.** *Tu vois :* BMM qui lit les fichiers des mods pour les empreindre, puis la carte du pack avec **Activer**.

## Choisir comment le remettre

| Tu veux | Fais ceci |
|---|---|
| Un ami qui a déjà certains mods | **Exporter et partager** dans le menu **…** de la carte, puis envoie le fichier `.bmp`. Il appuie sur **Importer** sur son écran Modpacks. |
| Un groupe qui reste synchronisé avec toi | Transforme le pack en **Dépôt Serveur** (section suivante), et ils le [suivent](doc-page:guide/follow-a-repo). |
| Juste l'ordre et les noms, sans fichiers | Exporte plutôt une [liste `.MM`](doc-page:features/modlist). |

## L'héberger comme Dépôt Serveur

- [ ] **Ouvre Dépôt Serveur** et choisis **Créer un dépôt en un clic**, depuis le pack. *Tu vois :* un dépôt signé écrit dans un dossier, prêt à héberger.
- [ ] **Héberge-le.** Appuie sur **Héberger**, choisis le dossier et un port. *Tu vois :* une carte d'état du serveur en marche avec son adresse.

![Un ami rejoint par l'adresse](assets/docs/media/gifs/guide-friend-joins.gif)

- [ ] **Envoie l'adresse.** Utilise **Lien de partage** pour obtenir un message prêt. Sur un réseau domestique, c'est l'adresse locale de ton PC et le port. *Tu vois :* le lien et des notes sur le mot de passe ou la clé si tu en as défini un.

:::warning[Le serveur tourne tant que BMM tourne]
Le serveur intégré de BMM est disponible tant que BMM est ouvert et que le port est joignable. Pour un dépôt qui doit rester en ligne toute la journée, héberge les fichiers sur un hébergeur statique, ou utilise le mini-serveur autonome.
:::

## Si ça ne marche pas

| Tu vois | Fais ceci |
|---|---|
| L'import de l'ami dit que certains mods ne sont pas installés | Normal : il n'a pas ces fichiers. Partage par un dépôt pour que les fichiers suivent. |
| La carte du pack indique *Certains mods sont manquants ou corrompus* | Appuie sur **Réparer et Appliquer** avant tout. |
| L'ami n'atteint pas ton adresse | Vérifie le pare-feu et le port, ou utilise un hébergeur statique. |

## Ensuite

[Suivre un dépôt](doc-page:guide/follow-a-repo) est le côté de l'ami. Détails : [Modpacks](doc-page:features/modpacks), [Dépôt Serveur](doc-page:features/repo).

<div class="bmm-replay" data-src="assets/docs/media/replays/share-setup.bmmreplay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/share-setup.bmmreplay" data-page="guide/share-a-modpack" data-title="Regarde : un profil devient un modpack, un dépôt, et la synchro d'un ami"></div>
