# Écran de démarrage & annonces


Quand BMM a quelque chose à vous dire au lancement, il le dit dans **une seule fenêtre** avec
**Précédent** et **Suivant** — pas dans une série de fenêtres qui s'ouvrent l'une après l'autre.
Quand il n'a rien à dire, rien ne s'ouvre.

## Ce qu'elle peut contenir

Chaque sujet est une **étape**. Seules les étapes qui concernent ce lancement s'affichent, toujours
dans cet ordre — les questions d'abord, pour qu'une fois répondues vous puissiez fermer à tout moment :

| Étape | Quand elle apparaît | Ce qui est retenu |
|---|---|---|
| Langue | Premier lancement, jusqu'à ce qu'une langue soit confirmée | La langue choisie |
| Conditions d'utilisation | Quand elles doivent être acceptées (premier lancement, ou texte modifié) | Votre acceptation de *ce* texte |
| Politique de confidentialité | Avec les conditions | Que vous avez lu *cette* version |
| Accès aux fichiers | Une fois, dès le deuxième lancement, jusqu'à votre choix | Accès complet ou limité |
| Télémétrie | Une fois, dès le deuxième lancement, jusqu'à votre réponse | Votre réponse et les trois options |
| Plantage | Après une session terminée par un plantage | Le rapport qui vous a été montré |
| Nouveautés | Une fois par version de BMM | Que les notes de cette version ont été affichées |
| Build de test | À chaque lancement d'une build PTB | — |
| Annonces | Quand BetterCommunity en a publié une pour votre version | Combien de fois vous l'avez vue |
| BetterCommunity | À chaque lancement, jusqu'à *Ne plus afficher au démarrage* | Votre refus |
| Ko-fi | À chaque lancement, jusqu'à *Plus tard* (un mois) ou *jamais* | Votre réponse |

Au tout premier lancement, seules la langue, les conditions et la politique de confidentialité
(et un plantage, s'il y en a un) s'affichent ; le reste attend le deuxième lancement, et la visite
guidée démarre une fois la fenêtre fermée.

## Les questions qui attendent une réponse

La langue, les conditions, la politique de confidentialité, l'accès aux fichiers et la télémétrie
sont des **questions** : l'étape attend votre réponse. Tant qu'une question n'a pas de réponse,
**Suivant** reste désactivé, les étapes suivantes sont inaccessibles, et **Fermer** (ou
<kbd>Échap</kbd>) vous ramène à elle au lieu de fermer. Ce qui est enregistré est exactement ce
qu'enregistraient les anciennes fenêtres séparées — les mêmes réglages, les mêmes valeurs. Refuser
les conditions quitte toujours BMM.

Tout le reste est de l'**information** : passez, fermez dessus, ou cochez **Ne plus afficher** en
bas à gauche quand l'étape le propose.

## Clavier

| Touche | Effet |
|---|---|
| <kbd>→</kbd> / <kbd>←</kbd> | Étape suivante / précédente |
| <kbd>Entrée</kbd> | Le bouton principal (Suivant, ou la confirmation de l'étape) |
| <kbd>Échap</kbd> | Fermer — ou revenir à une question encore en attente |
| <kbd>Tab</kbd> | Ne circule que dans la fenêtre, jamais derrière |

Les points en bas sont cliquables, et **2 / 5** en haut indique où vous en êtes. Les lecteurs
d'écran annoncent chaque étape par son numéro et son titre.

## La revoir

- Palette de commandes (<kbd>Ctrl</kbd>+<kbd>K</kbd>) → **Afficher les nouveautés** : les notes de
  cette version et les annonces BetterCommunity en cours, même celles déjà vues.
- **Paramètres → Tasky & Paramètres BMM → Écran de démarrage → Afficher les nouveautés** fait de même.

## Réglages

Deux interrupteurs dans **Paramètres → Tasky & Paramètres BMM**, juste sous *Notifications
BetterCommunity* :

- **Écran de démarrage** — désactivé : seules les questions qui exigent une réponse s'affichent
  encore (langue, conditions, confidentialité, accès aux fichiers, télémétrie). Notes de version,
  annonces et rappels, non.
- **Annonces BetterCommunity au démarrage** — désactivé : BMM ne les demande même pas au site.

## Les annonces BetterCommunity

L'équipe BetterCommunity peut placer une carte dans l'écran de démarrage : un article de blog
choisi, automatiquement le dernier article du blog BMM, ou une annonce libre. Elle décide combien
de fois elle s'affiche — **à chaque lancement**, **une fois** ou **un nombre de fois fixé** —, entre
quelles dates, et pour quelles versions de BMM.

Comment BMM s'y prend :

- **Le démarrage n'est jamais ralenti.** La requête part tôt et la fenêtre l'attend au plus environ
  une seconde et demie. Une réponse plus lente est ajoutée à la fenêtre si elle est encore ouverte,
  ou affichée au lancement suivant depuis la copie enregistrée.
- **Hors ligne, rien ne se passe.** Pas d'erreur, pas de nouvelle tentative : la copie enregistrée,
  ou rien.
- **Un flux inchangé ne coûte rien.** BMM garde la dernière réponse avec son `ETag` et demande
  « est-ce que ça a changé ? » — un flux inchangé répond *304*, sans contenu.
- **Rien ne vous identifie.** La requête porte votre version de BMM et votre langue, et aucun compte,
  identifiant de créateur ni clé.
- **Le décompte est local.** BMM compte combien de fois il a montré chaque carte sur ce PC. Quand
  l'équipe publie une nouvelle révision d'une carte, le décompte repart de zéro — *Ne plus
  afficher* aussi.
- **Rien dans une carte n'est pris pour du balisage.** Le titre et le résumé s'affichent en texte
  brut ; un lien s'ouvre dans votre navigateur et seulement s'il est en `https://` ; une image
  n'est affichée que si elle vient de BetterCommunity même, sinon la carte n'en a simplement pas.

Pour le format exact du flux, voir *GET /api/bmm/launch* dans la référence de l'API BetterCommunity.

## Pour les développeurs (plugins et cœur)

Une étape s'enregistre une fois, la fenêtre fait le reste :

```ts
registerLaunchStep({
  id: 'mon-etape',
  priority: 85,                       // plus bas = plus tôt ; les questions sont entre 10 et 50
  required: false,                    // true = une question à laquelle il faut répondre
  when: (ctx) => !ctx.firstRun,       // peut renvoyer une Promise ; plafonné à 4 s, erreur = non
  title: () => t('mon.etape.titre'),
  render: (el, api) => { /* dessiner dans el ; api.complete(), api.next(), api.closeThen(fn) */ },
});
```

`when` est interrogé une seule fois, en parallèle avec toutes les autres étapes. Une étape qui
lève une erreur ou dépasse le délai est écartée ; la fenêtre n'est jamais bloquée par elle. Une
étape obligatoire appelle `api.complete()` quand le choix est fait, ou fournit `commit()`, exécuté
quand on appuie sur **Suivant**.
