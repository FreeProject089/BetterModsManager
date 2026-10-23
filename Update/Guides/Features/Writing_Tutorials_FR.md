# Écrire un tutoriel interactif

Les tutoriels de BMM ne sont ni des vidéos ni des captures d'écran. Ils **pilotent
l'application réelle** : ils ouvrent la vue dont ils parlent, mettent un projecteur sur le
bouton qu'ils désignent, et — quand ça compte — attendent que tu aies vraiment fait la chose
avant de te laisser avancer.

Tu peux écrire les tiens, les partager sous forme de fichier, et publier un catalogue.

---

## Où ça se trouve

Le hub des tutoriels (**Aide & Autres → Tutoriel interactif**, ou la mascotte) liste les
leçons à gauche. Au bas de cette liste :

| Bouton | Ce qu'il fait |
|---|---|
| **Créer…** | Ouvre l'éditeur sur un tutoriel vide. |
| **Importer…** | Lit un fichier `.bmmtut` depuis le disque et l'ajoute à la liste. |
| **Catalogues…** | Suit une adresse de catalogue et installe des tutoriels. |

Sélectionner un tutoriel que tu as écrit fait apparaître trois boutons de plus : **Modifier**,
**Partager (.bmmtut)** et **Supprimer**. Les tutoriels officiels n'en ont aucun, et c'est
voulu — ils ne t'appartiennent pas.

---

## La forme d'un tutoriel

Un tutoriel, ce sont des **parties**, et une partie ce sont des **étapes**. Toute la
hiérarchie tient là.

Une partie est un chapitre : quelque chose qu'un lecteur peut commencer et finir. Une étape
est une chose à comprendre ou à faire. Le lecteur voit les parties comme des chapitres entre
lesquels il saute : une partie d'une seule étape et une partie de trente se lisent aussi mal
l'une que l'autre — cinq à dix est confortable.

### Ce qu'une étape peut porter

| Champ | Signification |
|---|---|
| **Titre** | L'en-tête de la carte d'accompagnement. |
| **Texte** | L'explication. Balises autorisées : `<b>` `<i>` `<u>` `<ul>` `<li>` `<code>` `<kbd>` `<br>`. |
| **Page** | La vue que BMM ouvre à l'apparition de l'étape. Laisse *Rester sur la page actuelle* quand le lecteur y est déjà. |
| **Élément à surligner** | Un sélecteur CSS — `#un-id` ou `.une-classe`. Le projecteur assombrit le reste. |
| **Attendre que le lecteur…** | Une action. Tant qu'elle n'a pas lieu, **Suivant** reste verrouillé. |

Tout le reste du moteur — l'assombrissement, le placement de la carte, l'enregistrement de la
progression, la reprise là où on s'était arrêté — est le code que font tourner les tutoriels
officiels. Tu n'écris pas pour un exécuteur au rabais.

---

## Trouver un sélecteur

Le bouton **Tester**, à côté du champ de sélecteur, fait clignoter ce que le sélecteur trouve
*maintenant*, dans l'application en cours, et l'amène à l'écran. S'il ne trouve rien, il le
dit.

C'est un attrape-fautes-de-frappe, et le bouton l'annonce. Il ne peut pas te dire que
l'élément existera sur l'écran de quelqu'un d'autre — un sélecteur qui trouve une carte dans
*ta* bibliothèque ne trouve rien dans une bibliothèque vide. Préfère :

- **les id aux classes.** `#btn-add-mod` est une décision que quelqu'un a prise ;
  `.card:nth-child(3)` est un accident de tes données.
- **les éléments toujours présents** — un bouton de navigation, un en-tête de panneau, un
  encart « vide » — plutôt que ceux qui n'apparaissent qu'avec du contenu.
- **aucun sélecteur** pour une étape qui ne fait qu'expliquer. Un projecteur sur rien est pire
  que pas de projecteur.

---

## Conditionner une étape à une vraie action

*Attendre que le lecteur…* liste les actions que BMM annonce : un profil créé, un mod activé,
un dépôt connecté, un thème appliqué, etc. Choisis-en une et l'étape n'avancera pas tant que
ça n'arrive pas pour de bon.

Sers-t'en pour le moment que la leçon existe pour enseigner, et nulle part ailleurs. Un
tutoriel qui conditionne chaque étape devient une liste de corvées dont on veut sortir ; celui
qui conditionne la seule étape où faire vaut mieux que lire est la raison d'être des tutoriels
interactifs.

Marque une étape **facultative** si le lecteur peut raisonnablement ne pas pouvoir la faire —
il n'a pas de dépôt à connecter, pas de second profil à comparer.

---

## Deux langues

Chaque champ de texte a une valeur anglaise et une française facultative. Si tu laisses le
français vide, les lecteurs francophones voient l'anglais — le tutoriel reste entier au lieu
de voir la moitié de ses étapes devenir blanches.

Écris l'anglais d'abord. C'est le repli pour toutes les langues pour lesquelles BMM n'a pas de
valeur.

---

## Partager

**Partager (.bmmtut)** écrit un fichier unique. Il est signé avec ta clé de créateur : celui
qui l'importe se voit dire l'une de trois choses.

| Verdict | Signification |
|---|---|
| **signé par son auteur** | Le fichier est exactement ce qui a été signé. |
| **non signé** | Aucune signature. Importable — beaucoup de fichiers n'en ont légitimement pas. |
| **SIGNATURE INVALIDE** | Il a été **modifié après signature**. Ne l'importe que si tu sais pourquoi. |

L'id que tu choisis nomme le fichier et l'enregistrement de progression. Il se verrouille une
fois le tutoriel créé, parce que le changer créerait une copie plutôt qu'un renommage — les
lecteurs à mi-parcours recommenceraient sans le savoir.

### Ce qu'un tutoriel partagé ne peut pas faire

Il affiche du texte et surligne des parties de l'interface. C'est tout.

Le texte d'un fichier partagé est réduit aux balises de mise en forme listées plus haut :
scripts, liens, images, styles et attributs d'événement sont supprimés avant tout affichage.
Un tutoriel venu d'un inconnu ne peut pas exécuter de code, installer quoi que ce soit, ni
atteindre le réseau. Si tu veux ça, tu décris un **plugin** ou une **automatisation**, et les
deux ont leurs propres barrières de permission.

---

## Publier un catalogue

Un catalogue de tutoriels est un fichier JSON qui les liste :

```json
{
  "version": "1.0",
  "name": "Mes tutoriels",
  "tutorials": [
    {
      "id": "premiers-pas",
      "name": "Premiers pas avec le modding",
      "description": "Profils, mods et première synchronisation.",
      "url": "https://exemple.com/tutoriels/premiers-pas.bmmtut"
    }
  ]
}
```

`url` peut être relative au catalogue — `premiers-pas.bmmtut` à côté de `catalog.json`
fonctionne, et fait déménager le catalogue et ses fichiers ensemble.

Héberge-le n'importe où qui sert un fichier en HTTPS, ou sur BetterCommunity (**Proposer du
contenu → Héberger mon propre catalogue**, type *Tutorial*). Les lecteurs ajoutent l'adresse
dans **Catalogues…**.

Un catalogue peut être protégé par un mot de passe de téléchargement ou des clés autorisées,
exactement comme tous les autres catalogues BMM ; le bloc dans la fenêtre des catalogues est
l'endroit où les lecteurs les fournissent.

---

## Une liste de vérification avant de partager

- Le sélecteur de chaque étape trouve quelque chose sur une installation **neuve**, pas
  seulement la tienne.
- Aucune étape n'est conditionnée à une action qu'un lecteur pourrait ne pas pouvoir faire.
- La première étape de chaque partie a du sens comme point de départ — les lecteurs sautent
  d'une partie à l'autre.
- L'anglais est rempli partout, même là où le français l'est aussi.
- Tu l'as fait tourner toi-même, du début à la fin, au moins une fois.

---

## Voir aussi

- **Index de catalogues — une adresse pour plusieurs catalogues** — publier plusieurs
  catalogues sous une seule adresse, tutoriels compris.
- **Contrôle d'accès des Server-Repos** — le bloc mot de passe et clé, en détail.
