# Personnaliser la navigation

La barre latérale est à toi. Appuie sur le **crayon en bas de la barre latérale** (ou utilise
**Paramètres → Navigation et pages personnalisées**) pour ouvrir l'éditeur. Il a été refait en 1.0.4
autour d'un aperçu que tu peux faire glisser, et d'une façon guidée d'ajouter des boutons.

## Ta barre latérale

L'éditeur montre **ta barre latérale** en aperçu vivant. Choisis une ligne pour la modifier.

- **Fais glisser** une ligne pour la déplacer, ou appuie sur :kbd[Alt+↑] / :kbd[Alt+↓]. Dépose-la sous
  une section pour la ranger dedans.
- **Renomme** une ligne (**Nom d'origine** le rétablit), **change son icône**, et **affiche-la ou
  masque-la**. Une page masquée s'ouvre toujours depuis des liens et des raccourcis. **Les Paramètres
  restent toujours**, puisque cet éditeur y vit.
- Les **sections** sont des titres : les boutons dessous leur appartiennent. Supprimer une section
  laisse ses boutons où ils sont.
- Chaque ligne porte un badge : **Page BMM** (fait partie de BMM) ou, pour ce que tu as ajouté,
  **Raccourci**, **Outil**, **Site web** ou **Ma page**.
- **Pages sans bouton** liste tes pages qui n'ont plus de bouton : **Ajouter à la barre**, ou supprime
  la page.
- **Réinitialiser la barre** remet l'ordre, les noms et les sections par défaut et retire tes
  boutons. Tes pages sont conservées.

## Ajouter un bouton

**Ajouter un bouton** est un parcours guidé avec une barre d'étapes (*Type, Nom et icône, Point de
départ, Permissions, Aperçu* ; les trois dernières seulement pour ta propre page) :

1. **Que doit ouvrir le bouton ?**
    - **Une page BMM** : une deuxième entrée vers l'une des pages de BMM.
    - **Un outil BMM** : l'éditeur de thème, le stockage, le benchmark et d'autres outils.
    - **Un site web** : affiché dans BMM, isolé de lui (il ne peut atteindre ni BMM, ni tes fichiers,
      ni tes mods). L'adresse commence par `https://` ; certains sites refusent d'être affichés dans
      une autre app.
    - **Ma propre page** : du HTML, CSS et JS que tu écris, exécuté dans un bac à sable.
2. **Donne-lui un nom et choisis une icône.** Le sélecteur d'icônes a une recherche, des **thèmes
   d'icônes** (Lieux, Fichiers et données, Créer, Outils, Personnes, État, Jeux et mods, BMM), tes
   icônes **récentes** et **plus d'icônes**.
3. **Point de départ** (page perso) : un modèle prêt à l'emploi, qui fonctionne tel quel, ou une page
   que tu as déjà faite.
4. **Permissions** (page perso) : voir plus bas.
5. **Aperçu** : la page, exécutée dans son bac à sable exactement comme le bouton la montrera. Tu
   peux modifier son code ensuite (**Modifier la page**).

Les modèles sont : vide, notes (un bloc-notes qui garde ce que tu écris), tableau de bord (version,
langue et thème de BMM), liste de tâches (une to-do list conservée entre les sessions), système (ton
système, la mémoire et le nombre de processeurs), récupération (charge des données depuis un site que
tu autorises), presse-papiers (copie et colle du texte) et multi (deux pages liées, pour grandir).
Chacun dit quelles permissions il utilise.

## Permissions de tes pages

Tout démarre **désactivé** : une page n'atteint jamais tes fichiers, tes mods ni BMM lui-même. **Ce
que cette page peut faire** liste les permissions, chacune avec un **niveau de risque** (risque
faible, risque moyen, risque plus élevé), et tu n'actives que ce dont la page a besoin. **Sites
qu'elle peut contacter** est une liste d'origines, une par ligne (`https://api.example.com`) ; rien
d'autre n'est accessible.

**Réglage rapide** active un groupe raisonnable en un clic :

| Réglage rapide | Active |
|---|---|
| **Rien** | Rien : totalement isolée |
| **Local seulement** | Le stockage, les notifications et les infos de l'app |
| **Local + internet** | Local seulement, plus les sites que tu listes. **Il n'active plus le presse-papiers** : accorde-le toi-même si la page en a besoin |

L'aperçu est en **bac à sable** avec seulement les permissions que tu as activées. Voir le [modèle de
sécurité](doc-page:how-it-works/security#custom-pages-review) pour savoir comment un `.bmmnav` importé
est examiné : ses pages arrivent sans aucune permission.

!!! tip "Sauvegardes"

    La disposition, la source de chaque page et ses permissions sont trois choses séparées. La section
    **Navigation et pages personnalisées** d'une [sauvegarde `.DATABMM`](doc-page:features/settings#donnees) prend les
    trois.
