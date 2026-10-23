# Régler un conflit

Deux mods contiennent le même fichier, et tu veux choisir quelle copie va au jeu. BMM te prévient avant d'écrire quoi que ce soit, et ne change rien tant que tu n'as pas appuyé sur **Appliquer**.

[Montre-moi](show:view/library) [S'entraîner avec le tutoriel](show:tutorial/basics/conflicts)

**Il te faut :** deux mods actifs qui partagent des fichiers. Tu n'es pas sûr qu'ils en partagent ? Active le second : BMM te le dira.

![BMM voit venir le conflit](assets/docs/media/gifs/guide-conflict-warning.gif)

:::note[Un conflit n'est pas un bug]
Deux personnes ont modifié la même chose, donc deux mods fournissent le même chemin. Rien n'est cassé. Il faut seulement dire quelle copie doit gagner.
:::

## Étapes

- [ ] **Active le second mod.** *Tu vois :* un message qui dit que l'activer écrasera des fichiers d'un autre mod, avec la liste des **Fichiers en conflit** : les chemins exacts présents dans les deux.
- [ ] **Décide, ou regarde de plus près.** Continue si tu acceptes que le nouveau mod gagne. Pour regarder d'abord, annule et ouvre la vue Conflits.
- [ ] **Ouvre la vue Conflits.** Appuie sur le badge de conflit de la carte, ou :kbd[Ctrl+K] puis *Résoudre les conflits*. *Tu vois :* chaque fichier que deux mods actifs partagent, la copie de quel mod est sur le disque maintenant, et un résumé par paire de mods (combien de fichiers, qui en a combien).

![Choisir qui gagne les fichiers partagés](assets/docs/media/gifs/guide-conflict-resolve.gif)

- [ ] **Choisis qui gagne.** Il y a trois façons, et tu peux les mélanger. **Réordonner** : descends un mod pour qu'il soit appliqué plus tard et gagne plus souvent, ou appuie sur **Faire gagner X** pour le plus petit déplacement qui met X après l'autre mod. **Garder la copie de X** : un choix fichier par fichier, retenu pour ce profil, et tu peux cocher plusieurs fichiers pour décider de tous d'un coup. **Désactiver** l'un des mods.
- [ ] **Lis le plan.** Le pied de page dit combien de fichiers **Appliquer** recopierait. Appuie sur **Voir les changements** pour voir chacun. *Tu vois :* rien n'a encore changé. **Abandonner** oublie le plan.
- [ ] **Appuie sur Appliquer.** *Tu vois :* une tâche dans le centre d'activité qui recopie seulement ces fichiers, puis le badge de conflit se calme.

:::tip[Le choix par fichier l'emporte sur l'ordre]
Une copie gardée gagne tant que son mod est actif. Sinon, le dernier mod de l'ordre gagne. Si tu veux qu'un mod entier gagne, réordonne. Si tu veux un seul fichier d'un mod, garde cette copie.
:::

## Si ça ne marche pas

| Tu vois | Fais ceci |
|---|---|
| La liste des conflits est vide mais le jeu est faux | Le chevauchement est peut-être avec un mod désactivé ou un autre profil. Ouvre **Mods inactifs et autres profils** en bas de la vue. |
| Un mod désactivé a ramené un ancien fichier | Désactiver retombe sur le mod suivant qui a le fichier, puis sur l'original du jeu. C'est voulu. |
| Les fichiers sont au mauvais endroit dans le mod | Voir [Réparer un mod que le jeu ignore](doc-page:guide/fix-a-mod). |

## Ensuite

[Partage ton ordre](doc-page:guide/activate-and-order) ou [partage un modpack](doc-page:guide/share-a-modpack).
Détails : [Conflits](doc-page:how-it-works/conflicts), [Ordre d'activation](doc-page:how-it-works/load-order).
