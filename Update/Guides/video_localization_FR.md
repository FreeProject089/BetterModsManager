# Système de Tutoriels Vidéo Localisés

BMM prend désormais en charge un système de tutoriels vidéo localisés et hybrides. Cela signifie que l'application peut afficher différentes vidéos en fonction de la langue de l'utilisateur, et peut basculer automatiquement entre un lien YouTube (en ligne) et un fichier local (hors ligne).

## Comment ça fonctionne

Le système utilise les fichiers de traduction standard (en.json, fr.json) pour définir les sources vidéo.

1.  Mode en ligne : Si Internet est disponible, BMM tente de charger l'iframe YouTube définie dans la clé de traduction.
2.  Mode hors ligne : Si l'utilisateur est hors ligne, BMM bascule automatiquement vers une balise <video> lisant un fichier .mp4 local.

## Configuration

Pour mettre à jour ou ajouter des vidéos, modifiez les clés suivantes dans vos fichiers de langue :

### Anglais (en.json)
```json
"docs.videos.tuto1.online": "https://www.youtube.com/embed/VIDEO_ID_EN",
"docs.videos.tuto1.offline": "assets/videos/tuto1_en.mp4",
"docs.videos.tuto2.online": "https://www.youtube.com/embed/VIDEO_ID2_EN",
"docs.videos.tuto2.offline": "assets/videos/tuto2_en.mp4"
```

### Français (fr.json)
```json
"docs.videos.tuto1.online": "https://www.youtube.com/embed/VIDEO_ID_FR",
"docs.videos.tuto1.offline": "assets/videos/tuto1_fr.mp4",
"docs.videos.tuto2.online": "https://www.youtube.com/embed/VIDEO_ID2_FR",
"docs.videos.tuto2.offline": "assets/videos/tuto2_fr.mp4"
```

## Placement des Assets

- Vidéos locales : Placez vos fichiers .mp4 dans frontend/assets/videos/.
- Nommage : Assurez-vous que le nom du fichier dans le dossier correspond au chemin dans la clé de traduction hors ligne.

## Note Technique

La logique est gérée dans frontend/src/docs/docs-ui.ts au sein de la fonction setupVideoPlayers(). Elle utilise navigator.onLine et l'outil de traduction t() pour déterminer dynamiquement quelle source afficher.
