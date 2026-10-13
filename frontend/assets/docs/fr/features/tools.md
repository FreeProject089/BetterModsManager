# Outils BMM

Les **Outils BMM** rassemblent dans une seule fenêtre les vérifications dont une bibliothèque de
mods finit par avoir besoin. Chaque outil se contente de **lire** : rien n'est supprimé, déplacé ni
réécrit. Quand un outil trouve quelque chose, il montre où c'est (avec **Ouvrir le dossier**) et
c'est toi qui décides.

## L'ouvrir

- :kbd[Ctrl+K] → **Outils BMM…**, ou directement un outil (*Trouver les mods et fichiers en double*,
  *Comparer deux profils*, *Trouver les mods manquants et orphelins*…).
- La barre de navigation, une fois que tu l'y as ajouté : dans l'[éditeur de navbar](doc-page:features/plugins), un élément *Ouvrir une modale* réglé sur **BMM Tools**.
- Les DevTools de BMM, dans leur section **Outils**.

## Les sept outils

| Outil | Ce qu'il t'apprend |
|---|---|
| **Détecteur de doublons** | Les mods enregistrés plusieurs fois, et les fichiers identiques portés par plusieurs mods, avec l'espace qu'ils gaspillent. Les fichiers sont comparés par taille, puis par empreinte de contenu BLAKE3. Tu peux ignorer les fichiers sous une taille donnée. |
| **Résumé des conflits** | Chaque paire de mods qui écrivent les mêmes fichiers, pour un profil ou pour tous. Les conflits actifs d'abord ; chaque paire liste ses fichiers. Voir [Conflits](doc-page:how-it-works/conflicts). |
| **Espace disque** | Ce que pèsent les mods et les sauvegardes de chaque profil, mod par mod, et ce que contient le dossier de données de BMM. |
| **Comparer des profils** | Deux profils côte à côte : les mods présents dans un seul, une version différente, activé dans l'un et pas dans l'autre, un ordre d'activation différent. |
| **Manquants et orphelins** | Les profils qui nomment des mods disparus, les mods dont le dossier n'existe plus, les dossiers qu'aucun mod n'enregistre, les dossiers de profil disparus. Chaque résultat dit comment corriger. |
| **Vérificateur d'empreinte** | L'empreinte BLAKE3 ou SHA-256 d'un fichier, comparée à celle que tu colles depuis une page de téléchargement ou un catalogue. |
| **Validateur de manifestes et catalogues** | Ce qu'est un fichier BMM (liste de mods, modpack, catalogue, dépôt, thème…) et ce qui ne va pas, depuis un fichier ou un texte collé. Les formats sont décrits dans [Format des catalogues](doc-page:reference/catalog-format), [Index des catalogues](doc-page:reference/catalog-index) et [Format des dépôts](doc-page:reference/repo-format). |

Un outil long montre sa progression et peut être arrêté avec **Annuler** ; les résultats sont alors
marqués comme partiels.

## Garder les résultats

Chaque résultat peut être **copié en JSON**, ou enregistré en fichier **JSON** ou **CSV**
(`bmm-<outil>-<date>.json`), pour le joindre à un rapport de bug ou l'ouvrir dans un tableur.

## Replay Studio et Animation Studio

Deux autres outils se trouvent dans les **DevTools de BMM** (**Paramètres → Debug & Dépannage →
Ouvrir le Menu Debug**, ou :kbd[Ctrl+Alt+D], sur une build où le menu debug est activé : voir
[`app.cfg`](doc-page:reference/app-cfg)). Chaque studio s'ouvre dans son propre panneau flottant et
reste ouvert après la fermeture des DevTools. C'est avec eux que sont faits les rejeux de session de
cette documentation.

**Replay Studio** enregistre l'app dans un fichier `.bmmreplay` (ou une vidéo), avec un cadre de
capture déplaçable et une pause. Après une prise, la **timeline** permet de :

- sélectionner une plage et la **couper**, n'importe où dans la prise, ou **raccourcir** le début et
  la fin ;
- ajouter des **marqueurs** ;
- **annuler** et **rétablir** chaque modification, avec un **aperçu** en direct ;
- retirer les mouvements du curseur pour un fichier plus léger, et masquer des éléments de
  l'enregistrement.

Clavier sur la timeline : les flèches déplacent, :kbd[I] et :kbd[O] marquent une plage, :kbd[X]
coupe, :kbd[M] ajoute un marqueur, `[` et `]` raccourcissent, :kbd[Espace] lit. Une
modification qui ne pourrait pas être relue est refusée et peut être annulée. **Exporter le .bmmreplay**
enregistre la prise dans le dossier Replays ; le studio peut aussi copier l'intégration pour une page
de documentation ou un article de blog.

**Animation Studio** ajoute des animations aux éléments de BMM, pour un enregistrement ou pour le
plaisir. Une animation peut être une **suite d'étapes**, chacune avec sa cible, son preset, son
easing, sa durée et son délai, qui démarre *après* ou *avec* la précédente. Les étapes se
prévisualisent en direct et se réordonnent avec **Monter** / **Descendre**. **Copier tout en JSON**
exporte tes animations ; **Importer** les relit depuis du JSON collé ou un fichier (1 Mo au plus).
Une animation marquée *Lancer à l'apparition* se joue quand sa cible apparaît, sauf si les
animations réduites sont activées.

:::note[Ce que contient un enregistrement]
Un rejeu enregistre ce qui était à l'écran. Lis [Confidentialité](doc-page:features/privacy-telemetry) avant d'en
partager un.
:::
