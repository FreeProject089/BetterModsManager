# Historique des changements & notes de version

BMM garde une **chronologie de ce qui a changé** et te laisse annuler une partie. Une seconde vue,
séparée, garde les **notes de version** de chaque version de BMM.

## L'historique des changements

Ouvre **Historique** depuis la Bibliothèque ou la palette de commandes (*Afficher l'historique*). Il
liste, jour par jour (*Aujourd'hui*, *Hier*, puis les dates), tout ce qui a changé dans BMM : mods
activés, désactivés, modifiés ou supprimés ; profils changés, créés, modifiés ou supprimés ;
réglages modifiés ; dépôts suivis ou non suivis ; sources de catalogue ajoutées ou retirées ;
vérifications et installations de mises à jour.

- **Filtres.** Les pastilles de type restreignent la liste : **Tout, Mods, Profils, Réglages, Mises à
  jour, Dépôts, Autre**.
- **Recherche.** Tape dans la case pour trouver une entrée par son texte. Quand rien ne correspond,
  **Tout afficher** efface les filtres.
- **Ce qui a changé.** Ouvre une entrée pour voir un tableau avec le **Champ**, sa valeur **Avant** et
  **Après** (une valeur vide se lit *(vide)*). Les entrées qui ont échoué ou ont été annulées le
  disent.

### Annuler

Certaines entrées ont un bouton d'annulation :

| Entrée | Bouton |
|---|---|
| Les détails d'un mod ont été modifiés | **Remettre les anciens détails** |
| Un mod a été activé | **Le désactiver de nouveau** |
| Un mod a été désactivé | **Le réactiver** |
| Des réglages ont été modifiés | **Restaurer ces réglages** |

Si le mod n'est plus dans la bibliothèque, l'entrée le dit.

### Combien de temps c'est gardé

**Conserver pendant** règle la rétention : **7, 30 ou 90 jours**, **Toujours**, ou un nombre de jours
à toi. **Effacer** vide l'historique (clique encore pour confirmer).

### Exporter

**CSV** et **Exporter en JSON** enregistrent les entrées que tu regardes, filtres compris, pour les
joindre à un rapport de bug ou garder une trace. Un filtre qui ne laisse rien dit *Rien à exporter
avec ce filtre*.

!!! note "Les secrets ne sont jamais stockés"

    Mots de passe, jetons et clés sont exclus de l'historique : quand un réglage qui contient un
    secret change, l'entrée note qu'il a changé, jamais sa valeur.

## Notes de version : l'onglet Versions

**Notes de version** (depuis la fenêtre de mise à jour, ou *Afficher les nouveautés* dans la palette
de commandes) a deux onglets :

- **Versions** : les notes de chaque version dans une seule liste, la plus récente d'abord. Chaque
  version porte des compteurs (*n nouveautés, n améliorations, n corrections*) et une étiquette :
  **Installée** pour la tienne, **Plus récente** pour les versions au-dessus. La recherche trouve les
  versions qui mentionnent un mot, et dit *Aucune version ne mentionne ceci* sinon. Quand une version
  a plusieurs documents (changelog, notes de version, release GitHub, notes de build de test),
  *Aussi pour cette version* les liste, et **Ouvrir le fichier** ouvre la source.
- **Documents** : les notes en documents séparés.
