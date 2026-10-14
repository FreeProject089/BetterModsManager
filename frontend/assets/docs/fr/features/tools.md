# Outils BMM

Les **Outils BMM** rassemblent dans une seule fenêtre les vérifications dont une bibliothèque de
mods finit par avoir besoin. Tous les outils sauf un se contentent de **lire** : rien n'est
supprimé, déplacé ni réécrit. L'exception est le **Nettoyage des caches**, qui ne vide que ce que
tu coches, après confirmation. Quand un outil trouve quelque chose, il montre où c'est (avec
**Ouvrir le dossier**) et c'est toi qui décides.

## L'ouvrir

- :kbd[Ctrl+K] → **Outils BMM…**, ou directement un outil (*Trouver les mods et fichiers en double*,
  *Comparer deux profils*, *Trouver les mods manquants et orphelins*…).
- La barre de navigation, une fois que tu l'y as ajouté : dans l'[éditeur de navbar](doc-page:features/plugins), un élément *Ouvrir une modale* réglé sur **BMM Tools**.
- Les DevTools de BMM, dans leur section **Outils**.

## Les outils

La liste a une case de recherche et des groupes (**Bibliothèque**, **Profils**, **Espace disque**,
**BMM**, **Fichiers et auteurs**), avec une ligne sous chaque outil.

| Outil | Ce qu'il t'apprend |
|---|---|
| **Détecteur de doublons** | Les mods enregistrés plusieurs fois, et les fichiers identiques portés par plusieurs mods, avec l'espace qu'ils gaspillent. Les fichiers sont comparés par taille, puis par empreinte de contenu BLAKE3. Tu peux ignorer les fichiers sous une taille donnée. |
| **Résumé des conflits** | Chaque paire de mods qui écrivent les mêmes fichiers, pour un profil ou pour tous. Les conflits actifs d'abord ; chaque paire liste ses fichiers. Voir [Conflits](doc-page:how-it-works/conflicts). |
| **Vérification des fichiers déployés** | Pour chaque mod actif : les fichiers disparus du dossier du jeu, les liens qui ne pointent nulle part, les fichiers manquants du mod dans la bibliothèque, et les liens cassés restés à côté. |
| **Manquants et orphelins** | Les profils qui nomment des mods disparus, les mods dont le dossier n'existe plus, les dossiers qu'aucun mod n'enregistre, les dossiers de profil disparus. Chaque résultat dit comment corriger. |
| **Noms et versions** | Les noms et versions de mods à ranger (espaces en trop, version dans le nom, version vide ou bizarre), avec une suggestion pour chacun. Rien n'est renommé. |
| **Comparer des profils** | Deux profils côte à côte : les mods présents dans un seul, une version différente, activé dans l'un et pas dans l'autre, un ordre d'activation différent. |
| **Profils en double** | Les profils qui ont les mêmes mods actifs (ou presque), ou qui partagent un dossier de jeu ou de mods. |
| **Espace disque** | Ce que pèsent les mods et les sauvegardes de chaque profil, mod par mod, et ce que contient le dossier de données de BMM. |
| **Gros fichiers** | Les plus gros fichiers des dossiers de mods et de sauvegardes d'un profil, avec leur mod. |
| **Nettoyage des caches** | Mesure le cache des catalogues, les archives de mods extraites, les restes de mises à jour et les rapports archivés, puis ne vide que ceux que tu coches, après une confirmation qui montre la taille. Il refuse de toucher aux archives extraites pendant l'activation d'un mod. |
| **Lecteur de journaux** | Le journal de cette session et les rapports de session et de plantage enregistrés, filtrés par niveau et par mots. |
| **Vérificateur d'empreinte** | L'empreinte BLAKE3 ou SHA-256 d'un fichier, comparée à celle que tu colles depuis une page de téléchargement ou un catalogue. |
| **Validateur de manifestes et catalogues** | Ce qu'est un fichier BMM (liste de mods, modpack, catalogue, dépôt, thème…) et ce qui ne va pas, depuis un fichier ou un texte collé. Les formats sont décrits dans [Format des catalogues](doc-page:reference/catalog-format), [Index des catalogues](doc-page:reference/catalog-index) et [Format des dépôts](doc-page:reference/repo-format). |
| **Différences de catalogues** | Deux versions d'un catalogue ou d'un `repo.json` : les entrées ajoutées, retirées et modifiées, avec les champs qui ont changé. |

La zone des résultats dit toujours où elle en est : **pas encore lancé**, **en cours** (avec la
progression et **Annuler**), **échoué** (avec la raison et **Réessayer**), ou **terminé** (un
résumé et les résultats). Un outil annulé marque ses résultats comme partiels. Les longues
analyses (doublons, espace disque, gros fichiers, fichiers déployés, mesure des caches)
apparaissent aussi dans le [centre d'activité](doc-page:features/activity) et peuvent être arrêtées depuis là.

## Garder les résultats

Le résultat de chaque outil peut être **copié en JSON**, ou enregistré en fichier **JSON** ou **CSV**
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
