# Studio de traduction

Le Studio de traduction sert à traduire BMM, corriger une formulation ou démarrer une nouvelle
langue. Il remplace l'ancien bac à sable de traduction. Ouvre-le depuis **Paramètres → Langue**.

## Une fenêtre qui bouge

Le studio est une **fenêtre flottante** au-dessus de BMM, et il peut **se détacher** dans une fenêtre
à part (**Ouvrir dans sa propre fenêtre** dans son en-tête, ou fais glisser l'en-tête au-delà du bord
de BMM). Mets-le sur un autre écran et garde BMM à côté. Fermer la fenêtre, ou **Revenir dans la
fenêtre de BMM**, le ramène. Voir [Des panneaux dans leur propre fenêtre](doc-page:features/settings#des-panneaux-dans-leur-propre-fenetre).

## Traduire, clé par clé

Chaque texte de BMM est une **clé**. Le studio les liste avec la langue que tu édites à côté du texte
source, et affiche **{langue} : n sur total traduites** et une barre de progression par langue.

- **Afficher** filtre la liste : **Manquantes** (pas encore traduites), **Modifiées** (tu les as
  éditées) ou **Identiques** (pareilles que la source, ce qui est parfois juste et parfois une clé
  oubliée).
- Cherche par clé ou par texte.
- :kbd[Haut] et :kbd[Bas] parcourent la liste, :kbd[Entrée] édite, :kbd[Alt+Haut] et :kbd[Alt+Bas]
  changent de clé depuis l'éditeur, :kbd[Échap] revient à la liste. Le bouton **prochaine manquante**
  va de trou en trou.
- **Choisir un texte dans BMM** (le pointeur) : clique n'importe quel texte de l'app et sa clé s'ouvre
  dans le studio (:kbd[Échap] arrête). L'onglet **Texte non traduit** cherche à l'écran les textes qui
  ne sont pas du tout traduits.
- **Trouver dans l'app** entoure l'endroit où la clé apparaît sur l'écran courant, ou te dit d'ouvrir
  la vue qui la montre.

## Variables et vérifications

Beaucoup de textes portent des **variables** comme `{name}` ou `{n}`. L'éditeur les montre en
**pastilles** : clique-en une pour l'**insérer au curseur**. BMM vérifie ta traduction et prévient
quand :

- une variable manque ou a été ajoutée (le texte casserait),
- les **balises HTML** diffèrent de la source,
- l'**espace en début ou en fin** diffère de la source.

Quand tout concorde, il dit *Variables et balises concordent*. Voir la référence des [variables de
traduction](doc-page:reference/translation-variables) pour les variables de chaque clé.

## Brouillons, et les voir en direct

Ce que tu tapes est enregistré comme **brouillon**, pas dans les fichiers de langue de l'app.
L'en-tête compte les brouillons de la langue ; **Tout annuler** les abandonne (clique encore pour
confirmer).

Active **En direct dans l'app** et **toute l'app affiche tes brouillons** jusqu'à ce que tu
l'éteignes ou fermes le studio : le moyen le plus rapide de voir une traduction en contexte. Si tu
édites une autre langue que celle dans laquelle BMM est affiché, le studio le dit.

## Importer, exporter, nouvelle langue

- **Exporter** écrit la langue dans un fichier `.json` ; partage-le, ou envoie-le pour qu'il soit
  intégré à BMM.
- **Importer** lit un fichier de langue. S'il a les mêmes clés que celles de BMM, rien ne change ; s'il
  diffère, les différences sont chargées comme **brouillons** à relire ; si c'est une langue que BMM
  n'a pas, elle est installée comme **nouvelle langue**. Un fichier qui n'est pas un `.json` de
  langue est refusé.
- **Créer une langue** demande un **code** (deux ou trois lettres, avec au besoin une région : `de`,
  `es`, `pt-br`), son **nom dans cette langue**, et ce dont **partir** : rien (toutes les clés
  démarrent manquantes) ou une copie d'une langue existante. Le fichier va dans le dossier `Lang` de
  BMM.

**Le français est la base** : une clé non traduite dans une langue retombe sur le français, et une
clé absente partout affiche son id brut. `en`, `fr` et le modèle ne peuvent pas être supprimés.
